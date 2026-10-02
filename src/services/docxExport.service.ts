import * as cheerio from "cheerio";
import HTMLtoDOCX from "@turbodocx/html-to-docx";

/**
 * LE-027 — Word (.docx) export.
 *
 * Done on the server rather than in the browser so that one conversion answers
 * every caller: the editor's File menu, a version download and anything later
 * (email, the portal) all get byte-identical output from the same HTML.
 *
 * `@turbodocx/html-to-docx` does the conversion. It takes the page's own HTML,
 * which is what makes the acceptance criterion ("opens in Word and LibreOffice
 * looking like the page") achievable — the alternative, `docx`, builds a
 * document node by node and would mean re-deriving every heading, list, table
 * and image from the markup by hand. The turbodocx fork is the maintained one
 * and ships its own types.
 */

/** A4 at 96dpi, in twentieths of a point — the editor's page. */
const A4 = { width: 11906, height: 16838 };
const LETTER = { width: 12240, height: 15840 };
/** 1 inch margins. */
const MARGIN = 1440;

/**
 * Strips everything that belongs to the screen rather than the document.
 *
 * Comment highlights are the one the spec calls out explicitly: a filed or
 * circulated .docx must not carry the firm's internal annotations. The text
 * inside a comment stays — only the anchor span is unwrapped.
 */
export function stripEditorOnlyMarkup(html: string): string {
  const $ = cheerio.load(html, null, false);

  // Comment anchors (CommentMark renders `span[data-comment-id]`).
  $("span[data-comment-id], span.le-comment, span.le-comment-resolved").each((_i, el) => {
    $(el).replaceWith($(el).contents());
  });
  // Any highlight left behind by the comment styling.
  $("[data-comment-resolved]").removeAttr("data-comment-resolved");

  // ProseMirror's own furniture: selection carets, gap cursors, column resize
  // handles and the trailing break it keeps at the end of a block.
  $(".ProseMirror-separator, .ProseMirror-trailingBreak, .ProseMirror-gapcursor").remove();
  $(".column-resize-handle, .tableWrapper > .resize-cursor").remove();

  return $.html();
}

export interface DocxExportInput {
  /** The document body as HTML. */
  html: string;
  /** Used for the footer and reported in the filename. */
  documentName: string;
  versionNumber: number;
  pageSize?: "A4" | "Letter";
}

/**
 * LE-027: "Downloads and exports say which version they are" — hence the
 * version in both the footer and the filename.
 */
export function docxFileName(documentName: string, versionNumber: number): string {
  // Keep the em dash the spec asks for, drop only what a filesystem rejects.
  const safe = documentName.replace(/[\\/:*?"<>|]/g, "-").trim() || "Document";
  // A document is often already named "Retainer.docx"; appending the extension
  // again gives "Retainer.docx — v3.docx".
  const base =
    safe
      .replace(/\.(docx?|pdf|rtf|odt)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || "Document";
  return `${base} — v${versionNumber}.docx`;
}

function footerHtml(documentName: string, versionNumber: number): string {
  const escaped = documentName.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string
  );
  return `<p style="font-size:9pt;color:#666666">${escaped} — v${versionNumber}</p>`;
}

/** Converts the editor's HTML to a .docx buffer. */
export async function htmlToDocxBuffer(input: DocxExportInput): Promise<Buffer> {
  const page = input.pageSize === "Letter" ? LETTER : A4;
  const body = stripEditorOnlyMarkup(input.html || "<p></p>");

  const result = await HTMLtoDOCX(
    `<!doctype html><html><body>${body}</body></html>`,
    footerHtml(input.documentName, input.versionNumber),
    {
      orientation: "portrait",
      pageSize: page,
      margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      title: input.documentName,
      footer: true,
      pageNumber: true,
      // A row split across a page break is what makes an exported schedule
      // unreadable in Word; the header row repeating is what fixes it.
      table: { row: { cantSplit: true } },
      font: "Times New Roman",
      fontSize: 24, // half-points — 12pt body text.
    }
  );

  // The library returns a Buffer on Node and a Blob in the browser.
  return Buffer.isBuffer(result) ? result : Buffer.from(await (result as Blob).arrayBuffer());
}
