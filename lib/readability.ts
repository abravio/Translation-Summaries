import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const MAX_CHARS = 20_000; // cap what we send to the LLM — one Sonnet request

export type ExtractedArticle = {
  title: string | null;
  text: string;
  charCount: number;
  truncated: boolean;
};

export async function fetchAndExtract(url: string): Promise<ExtractedArticle> {
  // A real browser UA gets past most sites that block bare fetch calls.
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; TranslationSummariesBot/0.1; +https://github.com/abravio/translation-summaries)",
      Accept: "text/html,application/xhtml+xml",
    },
    // Some slow news sites take a while; 20s is a generous ceiling.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.textContent) {
    throw new Error(
      "Could not extract article body. The page may be behind a paywall or use dynamic rendering."
    );
  }

  const raw = article.textContent.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = raw.length > MAX_CHARS;
  const text = truncated ? raw.slice(0, MAX_CHARS) : raw;
  return {
    title: article.title ?? null,
    text,
    charCount: raw.length,
    truncated,
  };
}
