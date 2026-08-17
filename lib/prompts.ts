import { LEVEL_GUIDANCE } from "@/lib/level";
import { langName } from "@/lib/types";

// The summary generator is one Claude call that returns strict JSON with:
//   - summary_target:  the Spanish (target-language) summary
//   - summary_native:  the same summary translated verbatim to English (native)
//   - tokens:          [{surface, lemma, pos, is_word}, ...] covering summary_target
// One structured call is cheaper and keeps the target/native/tokens aligned;
// splitting into three prompts risks drift.

export function summarySystemPrompt(args: {
  level: number;
  targetLang: string;
  nativeLang: string;
  focusNouns: boolean;
  focusVerbs: boolean;
  unmasteredWords: Array<{ lemma: string; translation: string | null }>;
}): string {
  const target = langName(args.targetLang);
  const native = langName(args.nativeLang);
  const focus: string[] = [];
  if (args.focusNouns) focus.push("nouns");
  if (args.focusVerbs) focus.push("verbs");
  const focusLine =
    focus.length > 0
      ? `The user wants to focus on ${focus.join(" and ")}. Bias vocabulary choice toward those parts of speech where natural.`
      : "";

  const priorityBlock =
    args.unmasteredWords.length > 0
      ? `\nThe user is actively learning these words (do not translate or gloss them in the summary — just use them naturally where they fit):\n${args.unmasteredWords
          .slice(0, 25)
          .map(
            (w) =>
              `- ${w.lemma}${w.translation ? ` — ${w.translation}` : ""}`
          )
          .join("\n")}\n`
      : "";

  return `You produce reading-practice summaries for a language learner.

Language pair: source article is arbitrary (usually ${native}), you summarize into ${target} at a specific difficulty level, and you also provide a verbatim ${native} translation of your ${target} summary for the learner to reveal on demand.

Difficulty level: ${args.level}/10. ${LEVEL_GUIDANCE[args.level] ?? ""}
${focusLine}
${priorityBlock}
Length: 1-2 short paragraphs (roughly 90-180 words of ${target}).

Output rules:
- Respond with ONE JSON object and nothing else. No prose, no code fences.
- Shape: {"summary_target": string, "summary_native": string, "tokens": [{"surface": string, "lemma": string, "pos": string, "is_word": boolean}, ...], "featured_lemmas": [string, ...]}
- \`tokens\` must cover EVERY visible character of \`summary_target\` in order — words AND punctuation AND spaces between them. Concatenating every \`surface\` in order (no separators) must reproduce \`summary_target\` byte-for-byte.
- For word tokens set \`is_word\`: true and give the base form as \`lemma\` (lowercase, e.g. "corrió" → "correr", "casas" → "casa"). \`pos\` is one of: noun, verb, adj, adv, pron, det, prep, conj, num, other.
- For non-word tokens (spaces, punctuation, digits, symbols) set \`is_word\`: false and repeat the character(s) as \`surface\`; \`lemma\` and \`pos\` may be empty strings.
- \`featured_lemmas\` lists the priority learning words you actually used in the summary.
`;
}

export function summaryUserPrompt(args: {
  articleTitle: string | null;
  articleText: string;
}): string {
  const titleLine = args.articleTitle ? `Title: ${args.articleTitle}\n\n` : "";
  return `${titleLine}Article:\n"""\n${args.articleText}\n"""\n\nProduce the JSON summary now.`;
}

// Single-word translation. Called on-demand when the reader taps a word we
// don't yet have cached. The response is stored in word_lookups so a repeat
// tap is free.
export function translateWordSystemPrompt(args: {
  targetLang: string;
  nativeLang: string;
}): string {
  return `You translate single words from ${langName(
    args.targetLang
  )} to ${langName(args.nativeLang)} for a language learner.

Given a word (possibly inflected) and the sentence it appears in, respond with ONE JSON object and nothing else:
{"lemma": string, "pos": string, "translation": string}

- \`lemma\` is the dictionary base form of the word, lowercase.
- \`pos\` is one of: noun, verb, adj, adv, pron, det, prep, conj, num, other.
- \`translation\` is a concise ${langName(
    args.nativeLang
  )} gloss for the sense used in this sentence (a couple of words at most; commas are fine for close synonyms).
`;
}

export function translateWordUserPrompt(args: {
  word: string;
  sentence: string;
}): string {
  return `Word: ${args.word}\nSentence: ${args.sentence}\n\nRespond with the JSON now.`;
}
