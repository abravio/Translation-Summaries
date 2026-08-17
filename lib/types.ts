// One token from a generated summary. Words are tappable; non-words render as-is.
// `l` is the base form (lemma) — that's the key we look words up by, so
// "corres" and "corrió" both count as "correr".
export type Token = {
  t: string; // surface text as it appears in the summary
  w: boolean; // is this a translatable word?
  ws: boolean; // does this token need leading whitespace before it?
  l?: string; // lemma / base form (only present when w)
  pos?: string; // part of speech (only present when w)
};

export type WordState = "unknown" | "seen" | "mastered";

export type UserSettings = {
  user_id: string;
  target_lang: string; // "es"
  native_lang: string; // "en"
  current_level: number; // 1..10
  focus_nouns: boolean;
  focus_verbs: boolean;
};

export type Article = {
  id: string;
  user_id: string;
  url: string;
  title: string | null;
  source_lang: string;
  original_text: string;
  char_count: number;
  fetched_at: string;
};

export type Summary = {
  id: string;
  article_id: string;
  user_id: string;
  level: number;
  target_lang: string;
  native_lang: string;
  summary_target: string;
  summary_native: string;
  tokens: Token[];
  featured_lemmas: string[];
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  created_at: string;
};

export type WordLookup = {
  id: string;
  user_id: string;
  lemma: string;
  target_lang: string;
  native_lang: string;
  translation: string | null;
  part_of_speech: string | null;
  state: WordState;
  times_tapped: number;
  first_seen_at: string;
  last_tapped_at: string;
  mastered_at: string | null;
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

export function langName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

// Cycle a word's state on tap.
// Normal (mastered or brand new) → unknown → seen → mastered → unknown → ...
export function nextState(current: WordState): WordState {
  if (current === "unknown") return "seen";
  if (current === "seen") return "mastered";
  return "unknown";
}
