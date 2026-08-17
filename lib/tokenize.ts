import type { Token } from "@/lib/types";

// Splits a raw text into whitespace-aware tokens without lemma info. Used as a
// fallback when the model didn't return a lemma list (or a lemma didn't line up
// with the summary text). The reader stays functional even with no lemma data;
// each word just uses its surface form as the lookup key.
//
// A "word" here is a run of letters (including Spanish diacritics) plus
// intra-word apostrophes. Everything else — punctuation, digits, symbols —
// renders as a non-word token and is skipped by taps.
const WORD_RE = /[A-Za-zÀ-ÿñÑ]+(?:['’][A-Za-zÀ-ÿñÑ]+)*/g;

export function surfaceTokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let leadingWs = false;
  const push = (segment: string, isWord: boolean) => {
    if (!segment) return;
    tokens.push({ t: segment, w: isWord, ws: leadingWs });
    leadingWs = false;
  };
  const flushGap = (gap: string) => {
    if (!gap) return;
    // Walk the gap splitting whitespace runs from non-whitespace runs.
    // Whitespace collapses into the leading-ws flag on the NEXT emitted token;
    // non-whitespace (punctuation, digits, symbols) becomes a non-word token.
    const parts = gap.match(/\s+|\S+/g);
    if (!parts) return;
    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        leadingWs = true;
      } else {
        push(part, false);
      }
    }
  };

  const re = new RegExp(WORD_RE);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) flushGap(text.slice(last, m.index));
    push(m[0], true);
    last = m.index + m[0].length;
  }
  if (last < text.length) flushGap(text.slice(last));
  return tokens;
}

// Rejoin a token stream into plain text — used server-side to store the
// summary_target verbatim from tokens and client-side for the "reveal English"
// swap when the model gave us tokens but not a rejoined string.
export function detokenize(tokens: Token[]): string {
  let out = "";
  for (const tok of tokens) {
    if (tok.ws && out) out += " ";
    out += tok.t;
  }
  return out;
}

// Word lookup key. We store lookups by (lemma, target_lang), lowercased.
export function lookupKey(surfaceOrLemma: string): string {
  return surfaceOrLemma.toLocaleLowerCase("es").trim();
}
