import { Response } from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { AdminRequest } from "../../types";
import { sendSuccess, sendBadRequest, sendError } from "../../utils/response";

const LAW_KEYWORDS: Record<string, string[]> = {
  "Criminal Law": ["criminal", "murder", "theft", "robbery", "assault", "manslaughter", "felony"],
  "Constitutional Law": [
    "constitution",
    "fundamental rights",
    "section 33",
    "section 34",
    "legislature",
  ],
  "Land Law": ["land", "property", "trespass", "possession", "title", "lease", "tenure"],
  "Contract Law": ["contract", "agreement", "breach", "consideration", "offer", "acceptance"],
  "Tort Law": ["negligence", "damages", "duty of care", "nuisance", "defamation", "tort"],
  "Company Law": [
    "company",
    "director",
    "shareholder",
    "corporation",
    "winding up",
    "incorporation",
  ],
  "Family Law": ["marriage", "divorce", "custody", "matrimonial", "inheritance", "succession"],
  "Evidence Law": ["evidence", "admissibility", "hearsay", "confession", "exhibit", "witness"],
  "Administrative Law": ["judicial review", "natural justice", "ultra vires", "public authority"],
  "Commercial Law": ["trade", "bill of exchange", "sale of goods", "commercial", "merchant"],
};

function inferLawType(text: string): string {
  const lower = text.toLowerCase();
  let best = { type: "General Law", count: 0 };
  for (const [type, keywords] of Object.entries(LAW_KEYWORDS)) {
    const count = keywords.filter((kw) => lower.includes(kw)).length;
    if (count > best.count) best = { type, count };
  }
  return best.type;
}

function extractCaseName(text: string, title: string): string {
  // Try "X v Y" / "X v. Y" pattern from first 500 chars
  const vPattern = /([A-Z][A-Za-z\s,.']{2,40})\s+v\.?\s+([A-Z][A-Za-z\s,.']{2,40})/;
  const match = text.slice(0, 500).match(vPattern) ?? title.match(vPattern);
  if (match) {
    const party1 = match[1].trim();
    // Strip trailing suit numbers, brackets, parentheticals
    const party2 = match[2]
      .replace(/\s*[[(].*$/, "")
      .replace(/\s+\d.*$/, "")
      .trim();
    return `${party1} v ${party2}`;
  }
  // Fall back to page title stripped of everything after first bracket/parenthesis
  return title
    .replace(/\s*[[(].*$/, "")
    .replace(/\s*[-|]\s*.+$/, "")
    .trim()
    .slice(0, 120);
}

const NOISE_LINES =
  /^(share|skip|report|document detail|related documents?|opens in new tab|whatsapp|facebook|linkedin|twitter|email|×|close|menu|search|home|back to top)$/i;

function cleanText(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NOISE_LINES.test(l));
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const extractFromUrl = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      sendBadRequest(res, "url is required");
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      sendBadRequest(res, "Invalid URL");
      return;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      sendBadRequest(res, "Only http/https URLs are supported");
      return;
    }

    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LegalErrandBot/1.0; +https://legalerrand.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      maxContentLength: 5 * 1024 * 1024, // 5 MB cap
    });

    const $ = cheerio.load(response.data as string);

    // Remove non-content elements
    $(
      "script, style, nav, header, footer, aside, [class*='menu'], [class*='sidebar'], [class*='ad'], iframe, noscript"
    ).remove();
    // Remove social share, report, and document-meta noise
    $(
      "[class*='share'], [class*='social'], [class*='report'], [class*='related'], [class*='detail'], [aria-label*='share'], [aria-label*='Share']"
    ).remove();
    $("button, [role='button']").each((_, el) => {
      const text = $(el).text().toLowerCase();
      if (text.includes("share") || text.includes("report") || text.includes("whatsapp"))
        $(el).remove();
    });

    const pageTitle = $("title").first().text().trim();

    // Try to find the main content block — AKN (NigeriaLII) selectors first
    const candidates = [
      "[class*='akn']",
      "[class*='judgment']",
      "[class*='decision']",
      "[id*='judgment']",
      "[id*='content']",
      "article",
      "main",
      "[class*='content']",
      "[class*='case']",
      "body",
    ];

    let rawText = "";
    for (const sel of candidates) {
      const el = $(sel).first();
      if (el.length) {
        rawText = el.text();
        if (rawText.trim().length > 300) break;
      }
    }

    if (rawText.trim().length < 100) {
      sendBadRequest(
        res,
        "Could not extract readable text from this URL. The page may require JavaScript or be behind a login."
      );
      return;
    }

    const text = cleanText(rawText);
    const caseName = extractCaseName(text, pageTitle);
    const lawType = inferLawType(text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    sendSuccess(
      res,
      { caseName, lawType, text, wordCount, pageTitle },
      "Text extracted successfully"
    );
  } catch (err) {
    const axiosErr = err as { response?: { status: number }; code?: string };
    if (axiosErr.code === "ECONNABORTED") {
      sendError(res, "Request timed out — the site took too long to respond", 408);
      return;
    }
    if (axiosErr.response?.status === 403) {
      sendError(res, "Access denied by the target site (403 Forbidden)", 422);
      return;
    }
    sendError(res, "Failed to fetch URL", 500, (err as Error).message);
  }
};
