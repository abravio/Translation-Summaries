import Anthropic from "@anthropic-ai/sdk";
import {
  summarySystemPrompt,
  summaryUserPrompt,
  translateWordSystemPrompt,
  translateWordUserPrompt,
} from "@/lib/prompts";
import { surfaceTokenize } from "@/lib/tokenize";
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
//
// Tokens/lemmas are NOT model-generated — a model-generated token list is
// most of the output volume and dominates latency. We surface-tokenize on
// the server after the call returns; lemmas are filled in on demand when
// the reader taps a word (that call was already happening anyway).
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
      featured_lemmas: {
        type: "array",
        description: "Priority learning words the summary intentionally used.",
        items: { type: "string" },
      },
    },
    required: ["summary_target", "summary_native", "featured_lemmas"],
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
  // Server-side tokenize. Lemmas fill in on demand as the reader taps words.
  const tokens = surfaceTokenize(summary_target);

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
