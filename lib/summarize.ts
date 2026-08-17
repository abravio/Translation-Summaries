import Anthropic from "@anthropic-ai/sdk";
import {
  summarySystemPrompt,
  summaryUserPrompt,
  translateWordSystemPrompt,
  translateWordUserPrompt,
} from "@/lib/prompts";
import { surfaceTokenize, detokenize } from "@/lib/tokenize";
import type { Token } from "@/lib/types";

const SUMMARY_MODEL = "claude-sonnet-5";
const TRANSLATE_MODEL = "claude-haiku-4-5-20251001";

export type SummaryResult = {
  summary_target: string;
  summary_native: string;
  tokens: Token[];
  featured_lemmas: string[];
  input_tokens: number;
  output_tokens: number;
  model: string;
};

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractTextBlocks(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Fall back to a surface-only token list if the model's tokens don't line up
// with summary_target byte-for-byte. Tap-to-translate still works — it'll just
// use the surface form as the lookup key until the on-demand /api/translate
// call fills in the lemma.
function reconcileTokens(summary: string, modelTokens: unknown): Token[] {
  if (Array.isArray(modelTokens)) {
    const rebuilt: Token[] = [];
    let leadingWs = false;
    for (const raw of modelTokens) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const surface = typeof r.surface === "string" ? r.surface : "";
      if (!surface) continue;
      // Pure whitespace token → carry the flag onto the next token.
      if (/^\s+$/.test(surface)) {
        leadingWs = true;
        continue;
      }
      // Whitespace baked into the surface — split it off.
      const wsMatch = surface.match(/^\s+/);
      if (wsMatch) leadingWs = true;
      const core = wsMatch ? surface.slice(wsMatch[0].length) : surface;
      if (!core) continue;

      const isWord = r.is_word === true;
      const lemma = typeof r.lemma === "string" && r.lemma ? r.lemma.toLowerCase() : undefined;
      const pos = typeof r.pos === "string" && r.pos ? r.pos : undefined;
      rebuilt.push({
        t: core,
        w: isWord,
        ws: leadingWs,
        ...(isWord && lemma ? { l: lemma } : {}),
        ...(isWord && pos ? { pos } : {}),
      });
      leadingWs = false;
    }
    if (detokenize(rebuilt).trim() === summary.trim()) {
      return rebuilt;
    }
  }
  // Model output didn't round-trip → derive tokens from the summary directly.
  return surfaceTokenize(summary);
}

export async function generateSummary(args: {
  articleTitle: string | null;
  articleText: string;
  level: number;
  targetLang: string;
  nativeLang: string;
  focusNouns: boolean;
  focusVerbs: boolean;
  unmasteredWords: Array<{ lemma: string; translation: string | null }>;
}): Promise<SummaryResult> {
  const client = new Anthropic();
  const system = summarySystemPrompt({
    level: args.level,
    targetLang: args.targetLang,
    nativeLang: args.nativeLang,
    focusNouns: args.focusNouns,
    focusVerbs: args.focusVerbs,
    unmasteredWords: args.unmasteredWords,
  });
  const user = summaryUserPrompt({
    articleTitle: args.articleTitle,
    articleText: args.articleText,
  });

  const msg = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });

  const raw = stripJsonFence(extractTextBlocks(msg));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model did not return valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned an unexpected shape.");
  }
  const p = parsed as Record<string, unknown>;
  const summary_target = typeof p.summary_target === "string" ? p.summary_target : "";
  const summary_native = typeof p.summary_native === "string" ? p.summary_native : "";
  if (!summary_target || !summary_native) {
    throw new Error("Model omitted summary_target or summary_native.");
  }
  const featured_lemmas = Array.isArray(p.featured_lemmas)
    ? p.featured_lemmas.filter((x): x is string => typeof x === "string")
    : [];
  const tokens = reconcileTokens(summary_target, p.tokens);

  return {
    summary_target,
    summary_native,
    tokens,
    featured_lemmas,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    model: SUMMARY_MODEL,
  };
}

export type TranslationResult = {
  lemma: string;
  pos: string;
  translation: string;
  model: string;
};

export async function translateWord(args: {
  word: string;
  sentence: string;
  targetLang: string;
  nativeLang: string;
}): Promise<TranslationResult> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: TRANSLATE_MODEL,
    max_tokens: 256,
    system: translateWordSystemPrompt({
      targetLang: args.targetLang,
      nativeLang: args.nativeLang,
    }),
    messages: [
      {
        role: "user",
        content: translateWordUserPrompt({
          word: args.word,
          sentence: args.sentence,
        }),
      },
    ],
  });

  const raw = stripJsonFence(extractTextBlocks(msg));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Translator did not return valid JSON.");
  }
  const p = (parsed ?? {}) as Record<string, unknown>;
  const lemma = typeof p.lemma === "string" && p.lemma ? p.lemma.toLowerCase() : args.word.toLowerCase();
  const pos = typeof p.pos === "string" ? p.pos : "other";
  const translation = typeof p.translation === "string" ? p.translation : "";
  if (!translation) throw new Error("Translator returned no translation.");
  return { lemma, pos, translation, model: TRANSLATE_MODEL };
}
