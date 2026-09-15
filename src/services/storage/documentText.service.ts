import { PDFParse } from "pdf-parse";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, S3_BUCKET } from "../../config/s3";
import { logger } from "../../utils/logger";

/**
 * Extensible source kinds for Library (reader + AI).
 * Add new kinds here as scrapers / upload types grow — keep FE viewer switch in sync.
 */
export type DocumentKind =
  | "pdf"
  | "text"
  | "html"
  | "markdown"
  | "json"
  | "xml"
  | "rtf"
  | "image"
  | "office"
  | "binary";

const MAX_EXTRACT_CHARS = 120_000;
const MIN_PDF_TEXT = 40;

const TEXT_EXTS = new Set([
  "txt",
  "text",
  "log",
  "csv",
  "tsv",
  "md",
  "markdown",
  "mdx",
  "rst",
  "asciidoc",
  "adoc",
]);

const HTML_EXTS = new Set(["html", "htm", "xhtml"]);
const XML_EXTS = new Set(["xml", "xsl", "xsd", "svg"]);
const JSON_EXTS = new Set(["json", "jsonl", "ndjson"]);
const RTF_EXTS = new Set(["rtf"]);
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "avif",
]);
const OFFICE_EXTS = new Set([
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "odp",
  "pages",
  "numbers",
  "key",
]);
const PDF_EXTS = new Set(["pdf"]);

function extensionOf(s3Key: string): string {
  const base = (s3Key.split("/").pop() ?? "").split("?")[0];
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function detectDocumentKind(s3Key: string, mimeHint?: string): DocumentKind {
  const mime = (mimeHint ?? "").toLowerCase();
  const ext = extensionOf(s3Key);

  if (mime.includes("pdf") || PDF_EXTS.has(ext)) return "pdf";
  if (mime.includes("html") || HTML_EXTS.has(ext)) return "html";
  if (mime.includes("markdown") || ext === "md" || ext === "markdown" || ext === "mdx") {
    return "markdown";
  }
  if (mime.includes("json") || JSON_EXTS.has(ext)) return "json";
  if (mime.includes("xml") || XML_EXTS.has(ext)) return "xml";
  if (mime.includes("rtf") || RTF_EXTS.has(ext)) return "rtf";
  if (mime.startsWith("image/") || IMAGE_EXTS.has(ext)) return "image";
  if (
    mime.includes("msword") ||
    mime.includes("officedocument") ||
    mime.includes("opendocument") ||
    (OFFICE_EXTS.has(ext) && ext !== "rtf")
  ) {
    return "office";
  }
  if (mime.startsWith("text/") || TEXT_EXTS.has(ext)) return "text";

  // Scraped judgments often land in S3 without an extension as UTF-8 text.
  if (!ext) return "text";

  return "binary";
}

/** Kinds that should use the styled text reader when a transcript exists. */
export function isTextReadableKind(kind: DocumentKind): boolean {
  return (
    kind === "text" ||
    kind === "html" ||
    kind === "markdown" ||
    kind === "json" ||
    kind === "xml" ||
    kind === "rtf"
  );
}

function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACT_CHARS);
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const text = cleanExtractedText(parsed.text ?? "");
    return text.length >= MIN_PDF_TEXT ? text : "";
  } finally {
    await parser.destroy();
  }
}

function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripRtf(text: string): string {
  return text
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-z]+\d* ?/gi, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ");
}

function extractFromUtf8(buffer: Buffer, kind: DocumentKind): string {
  const text = buffer.toString("utf-8");
  const sample = text.slice(0, 500);
  const nonPrintable = Array.from(sample).filter((ch) => {
    const code = ch.charCodeAt(0);
    return !(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126));
  }).length;
  if (sample.length > 40 && nonPrintable / sample.length > 0.3) {
    return "";
  }

  if (kind === "html" || kind === "xml") {
    return cleanExtractedText(stripHtml(text));
  }
  if (kind === "rtf") {
    return cleanExtractedText(stripRtf(text));
  }
  if (kind === "json") {
    try {
      return cleanExtractedText(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      return cleanExtractedText(text);
    }
  }

  return cleanExtractedText(text);
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  kind: DocumentKind
): Promise<{ text: string; kind: DocumentKind }> {
  if (kind === "pdf") {
    try {
      const text = await extractFromPdf(buffer);
      return { text, kind: "pdf" };
    } catch (err) {
      logger.warn("PDF text extraction failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { text: "", kind: "pdf" };
    }
  }

  if (kind === "image" || kind === "office") {
    // OCR / Office parsers can plug in later without changing the API shape.
    return { text: "", kind };
  }

  if (
    kind === "text" ||
    kind === "html" ||
    kind === "markdown" ||
    kind === "json" ||
    kind === "xml" ||
    kind === "rtf"
  ) {
    return { text: extractFromUtf8(buffer, kind), kind };
  }

  // Unknown binary: try UTF-8 heuristic, else empty.
  const asText = extractFromUtf8(buffer, "text");
  if (asText) return { text: asText, kind: "text" };
  return { text: "", kind: "binary" };
}

async function downloadS3Object(s3Key: string): Promise<Buffer> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Extract readable text for Library reader + AI. Safe for mixed source types. */
export async function extractDocumentText(params: {
  s3Key: string;
  buffer?: Buffer;
  mimeHint?: string;
}): Promise<{ text: string; kind: DocumentKind }> {
  let kind = detectDocumentKind(params.s3Key, params.mimeHint);
  const buffer = params.buffer ?? (await downloadS3Object(params.s3Key));

  // Magic-byte override: if extension lied, trust the payload.
  if (buffer.slice(0, 5).toString("utf-8") === "%PDF-") {
    return extractTextFromBuffer(buffer, "pdf");
  }
  if (
    buffer.slice(0, 15).toString("utf-8").toLowerCase().includes("<!doctype html") ||
    buffer.slice(0, 20).toString("utf-8").toLowerCase().includes("<html")
  ) {
    kind = "html";
  }

  return extractTextFromBuffer(buffer, kind);
}
