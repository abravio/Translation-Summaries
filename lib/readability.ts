import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const MAX_CHARS = 20_000; // cap what we send to the LLM
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type ExtractedArticle = {
  title: string | null;
  text: string;
  charCount: number;
  truncated: boolean;
  source: "direct" | "jina";
};

function normalize(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Try to pull the article body straight from the site.
async function extractDirect(url: string): Promise<{ title: string | null; text: string } | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const html = await res.text();
  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article || !article.textContent || article.textContent.length < 200) return null;
    return { title: article.title ?? null, text: article.textContent };
  } catch {
    return null;
  }
}

// Fall back to Jina Reader — a free, key-less proxy that runs a headless
// browser and returns clean article text. Handles most paywall bypass +
// bot-block cases (WSJ, NYT, FT).
async function extractJina(url: string): Promise<{ title: string | null; text: string } | null> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/plain",
      // Ask Jina for markdown-ish output.
      "X-Return-Format": "markdown",
    },
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = await res.text();
  if (!body || body.length < 200) return null;

  // Jina prepends metadata lines like "Title: …" / "URL Source: …" / "Markdown Content:"
  // Split those off so the article body reaches the model clean.
  let title: string | null = null;
  const lines = body.split("\n");
  let contentStart = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const l = lines[i];
    if (/^Title:\s*/i.test(l)) title = l.replace(/^Title:\s*/i, "").trim();
    if (/^Markdown Content:\s*$/i.test(l) || /^Content:\s*$/i.test(l)) {
      contentStart = i + 1;
    }
  }
  const text = lines.slice(contentStart).join("\n");
  if (text.length < 200) return null;
  return { title, text };
}

export async function fetchAndExtract(url: string): Promise<ExtractedArticle> {
  // Try direct → jina.
  let picked: { title: string | null; text: string; source: "direct" | "jina" } | null = null;

  const direct = await extractDirect(url);
  if (direct) picked = { ...direct, source: "direct" };
  if (!picked) {
    const jina = await extractJina(url);
    if (jina) picked = { ...jina, source: "jina" };
  }
  if (!picked) {
    throw new Error(
      "Couldn't extract that article. The site may block scrapers or require a subscription."
    );
  }

  const normalized = normalize(picked.text);
  const truncated = normalized.length > MAX_CHARS;
  const text = truncated ? normalized.slice(0, MAX_CHARS) : normalized;
  return {
    title: picked.title,
    text,
    charCount: normalized.length,
    truncated,
    source: picked.source,
  };
}
