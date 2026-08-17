// Difficulty auto-calibration. Signal is taps-per-100-words on a summary.
// If the reader tapped a lot of words, the summary was too hard → level down.
// If they tapped few or none, they're comfortable → level up.
//
// Targets are chosen to be forgiving: 3-7 taps per 100 words is "just right".
// Outside that band, nudge by 1 level. Beyond a wide band, nudge by 2.

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

export function tapsPer100(taps: number, totalWords: number): number {
  if (totalWords <= 0) return 0;
  return (taps / totalWords) * 100;
}

export function suggestedLevelDelta(
  taps: number,
  totalWords: number
): -2 | -1 | 0 | 1 | 2 {
  const rate = tapsPer100(taps, totalWords);
  if (rate >= 15) return -2;
  if (rate > 7) return -1;
  if (rate < 1) return 2;
  if (rate < 3) return 1;
  return 0;
}

export function clampLevel(level: number): number {
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
}

// Per-level guidance surfaced in the summary prompt so the model has a
// concrete rubric instead of "make it easy" vs "make it hard".
export const LEVEL_GUIDANCE: Record<number, string> = {
  1: "CEFR A1. Present tense only. Very short sentences. ~500 most common words. Avoid subjunctive, avoid idioms.",
  2: "CEFR A1+. Present and near-future (ir a + infinitive). Short sentences. Common vocabulary.",
  3: "CEFR A2. Present + preterite + imperfect. Simple connectors (y, pero, porque). Everyday vocabulary.",
  4: "CEFR A2+. Add conditional and future tense. Basic subordinate clauses.",
  5: "CEFR B1. Full indicative, occasional simple subjunctive. Medium-length sentences. Some abstract vocabulary.",
  6: "CEFR B1+. Regular subjunctive, more idiomatic phrasing. Longer sentences.",
  7: "CEFR B2. Fluent, register-appropriate. Complex clauses, hypotheticals, nuance.",
  8: "CEFR B2+. Journalistic register. Idioms and register shifts allowed.",
  9: "CEFR C1. Native-like prose. Advanced vocabulary and rhetorical structure.",
  10: "CEFR C2. Fully native register with idioms, wordplay, and cultural references. No simplification.",
};
