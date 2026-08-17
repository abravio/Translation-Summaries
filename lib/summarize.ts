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

// Force structured output via tool_use. `tool_choice` names the tool the
// model must call, so its `input` is guaranteed to match this schema —
// no freeform-JSON parsing gymnastics.
const SUMMARY_TOOL: Anthropic.Tool = {
  name: "emit_summary",
  description:
    "Emit the learner-facing summary as structured data. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      summary_target: {
        type: "string",
        description:
          "The summary in the target language (Spanish), 1-2 short paragraphs.",
      },
      summary_native: {
        type: "string",
        description:
          "Verbatim translation of summary_target into the native language (English).",
      },
      tokens: {
        type: "array",
        description:
          "Ordered token list covering summary_target end-to-end (words + punctuation + spaces).",
        items: {
          type: "object",
          properties: {
            surface: {
              type: "string",
              description: "Exact substring as it appears in summary_target.",
            },
            lemma: {
              type: "string",
              description: "Base form (lowercase). Empty string for non-words.",
            },
            pos: {
              type: "string",
              description:
                "Part of speech: noun, verb, adj, adv, pron, det, prep, conj, num, other. Empty for non-words.",
            },
            is_word: {
              type: "boolean",
              description: "True for translatable words; false for punctuation/spaces/digits.",
            },
          },
          required: ["surface", "is_word"],
        },
      },
      featured_lemmas: {
        type: "array",
        description: "Priority learning words the summary intentionally used.",
        items: { type: "string" },
      },
    },
    required: ["summary_target", "summary_native", "tokens", "featured_lemmas"],
  },
};

const TRANSLATE_TOOL: Anthropic.Tool = {
  name: "emit_translation",
  description:
    "Emit a single-word translation. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      lemma: { type: "string", description: "Dictionary base form, lowercase." },
      pos: {
        type: "string",
        description: "noun, verb, adj, adv, pron, det, prep, conj, num, other.",
      },
      translation: {
        type: "string",
        description: "Concise gloss in the native language for the sense used in the sentence.",
      },
    },
    required: ["lemma", "pos", "translation"],
  },
};

function firstToolInput(msg: Anthropic.Message, name: string): Record<string, unknown> | null {
  for (const block of msg.content) {
    if (block.type === "tool_use" && block.name === name) {
      return block.input as Record<string, unknown>;
    }
  }
  return null;
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
    max_tokens: 8192,
    system,
    tools: [SUMMARY_TOOL],
    tool_choice: { type: "tool", name: SUMMARY_TOOL.name },
    messages: [{ role: "user", content: user }],
  });

  const input = firstToolInput(msg, SUMMARY_TOOL.name);
  if (!input) {
    console.error("Summary tool_use missing. Stop reason:", msg.stop_reason);
    throw new Error("Model did not return a structured summary.");
  }
  const summary_target = typeof input.summary_target === "string" ? input.summary_target : "";
  const summary_native = typeof input.summary_native === "string" ? input.summary_native : "";
  if (!summary_target || !summary_native) {
    throw new Error("Model omitted summary_target or summary_native.");
  }
  const featured_lemmas = Array.isArray(input.featured_lemmas)
    ? input.featured_lemmas.filter((x): x is string => typeof x === "string")
    : [];
  const tokens = reconcileTokens(summary_target, input.tokens);

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
    max_tokens: 512,
    system: translateWordSystemPrompt({
      targetLang: args.targetLang,
      nativeLang: args.nativeLang,
    }),
    tools: [TRANSLATE_TOOL],
    tool_choice: { type: "tool", name: TRANSLATE_TOOL.name },
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

  const input = firstToolInput(msg, TRANSLATE_TOOL.name);
  if (!input) throw new Error("Translator did not return a structured result.");
  const lemma =
    typeof input.lemma === "string" && input.lemma
      ? input.lemma.toLowerCase()
      : args.word.toLowerCase();
  const pos = typeof input.pos === "string" ? input.pos : "other";
  const translation = typeof input.translation === "string" ? input.translation : "";
  if (!translation) throw new Error("Translator returned no translation.");
  return { lemma, pos, translation, model: TRANSLATE_MODEL };
}
