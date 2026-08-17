"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { Summary, Token, WordState } from "@/lib/types";
import { nextState } from "@/lib/types";
import { lookupKey } from "@/lib/tokenize";
import { tapWord, finishReading } from "@/app/actions";

// Per-lemma state map for this reading session. It's seeded from the summary's
// word tokens (starting at "mastered"/absent so nothing is highlighted) and
// mutated on tap. When the reader hits "Finish", we ship the tap stats to the
// server so it can log the event and adjust the level.
type WordEntry = {
  state: WordState | undefined; // undefined = default (normal) — hasn't been touched this session
  translation: string | null;
  taps: number;
  isNewUnknown: boolean;
};

type Props = {
  summary: Summary;
  articleTitle: string | null;
  articleUrl: string | null;
  initialStates: Record<string, { state: WordState; translation: string | null }>;
};

export function Reader(props: Props) {
  const [showEnglish, setShowEnglish] = useState(false);
  const [selected, setSelected] = useState<{
    lemma: string;
    surface: string;
    translation: string | null;
    state: WordState | undefined;
  } | null>(null);
  const [entries, setEntries] = useState<Record<string, WordEntry>>(() => {
    const seed: Record<string, WordEntry> = {};
    for (const [k, v] of Object.entries(props.initialStates ?? {})) {
      seed[k] = { state: v.state, translation: v.translation, taps: 0, isNewUnknown: false };
    }
    return seed;
  });
  const [pending, startTransition] = useTransition();
  const [finished, setFinished] = useState(false);

  const wordTokens = useMemo(
    () => (props.summary.tokens ?? []).filter((t) => t.w),
    [props.summary.tokens]
  );

  // Recover the sentence a tapped token sits in — the translation endpoint
  // does better when it can see context.
  const sentenceFor = useCallback((idx: number): string => {
    const tokens = props.summary.tokens ?? [];
    let start = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const t = tokens[i];
      if (!t.w && /[.!?¿¡]/.test(t.t)) {
        start = i + 1;
        break;
      }
    }
    let end = tokens.length;
    for (let i = idx; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t.w && /[.!?]/.test(t.t)) {
        end = i + 1;
        break;
      }
    }
    let out = "";
    for (let i = start; i < end; i++) {
      const t = tokens[i];
      if (t.ws && out) out += " ";
      out += t.t;
    }
    return out.trim();
  }, [props.summary.tokens]);

  const handleTap = useCallback(
    async (tok: Token, tokenIdx: number) => {
      if (!tok.w) return;
      const key = lookupKey(tok.l ?? tok.t);
      const prevEntry = entries[key];
      const prev = prevEntry?.state ?? "mastered";
      const nxt = nextState(prev === "mastered" ? "mastered" : prev);
      // From mastered/normal → unknown (nextState("mastered") returns "unknown")
      // From unknown → seen; from seen → mastered.

      setEntries((cur) => ({
        ...cur,
        [key]: {
          state: nxt,
          translation: prevEntry?.translation ?? null,
          taps: (prevEntry?.taps ?? 0) + 1,
          isNewUnknown:
            prevEntry?.isNewUnknown ||
            (prev !== "unknown" && nxt === "unknown"),
        },
      }));
      setSelected({
        lemma: key,
        surface: tok.t,
        translation: prevEntry?.translation ?? null,
        state: nxt,
      });

      // Persist tap state.
      startTransition(async () => {
        try {
          const res = await tapWord({
            lemma: tok.l ?? tok.t,
            targetLang: props.summary.target_lang,
            nativeLang: props.summary.native_lang,
          });
          setEntries((cur) => ({
            ...cur,
            [key]: {
              ...(cur[key] ?? { taps: 1, isNewUnknown: false }),
              state: res.state,
              translation: cur[key]?.translation ?? res.translation ?? null,
            },
          }));
          if (!prevEntry?.translation && !res.translation) {
            // Fetch a translation on demand.
            const r = await fetch("/api/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                word: tok.t,
                lemma: tok.l,
                sentence: sentenceFor(tokenIdx),
              }),
            });
            if (r.ok) {
              const j = (await r.json()) as { translation?: string };
              const translation = j.translation ?? null;
              setEntries((cur) => ({
                ...cur,
                [key]: { ...(cur[key] ?? { state: "unknown", taps: 1, isNewUnknown: true }), translation },
              }));
              setSelected((cur) =>
                cur && cur.lemma === key ? { ...cur, translation } : cur
              );
            }
          }
        } catch {
          // Swallow — offline / server hiccup shouldn't break the reader.
        }
      });
    },
    [entries, props.summary.native_lang, props.summary.target_lang, sentenceFor]
  );

  const totalTaps = Object.values(entries).reduce((n, e) => n + e.taps, 0);
  const newUnknown = Object.values(entries).filter((e) => e.isNewUnknown).length;

  const handleFinish = useCallback(async () => {
    setFinished(true);
    await finishReading({
      summaryId: props.summary.id,
      level: props.summary.level,
      totalWords: wordTokens.length,
      taps: totalTaps,
      newUnknownWords: newUnknown,
    });
  }, [props.summary.id, props.summary.level, wordTokens.length, totalTaps, newUnknown]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <div className="truncate">
          {props.articleTitle && (
            <span className="font-medium text-slate-800">{props.articleTitle}</span>
          )}
          {props.articleUrl && (
            <>
              {" · "}
              <a
                href={props.articleUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-slate-300 hover:decoration-slate-500"
              >
                source
              </a>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowEnglish((v) => !v)}
          className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-500"
        >
          {showEnglish ? "Hide English" : "Reveal English"}
        </button>
      </div>

      <article className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-lg leading-relaxed text-slate-900 shadow-sm">
        {showEnglish ? (
          <p className="whitespace-pre-wrap">{props.summary.summary_native}</p>
        ) : (
          <p className="whitespace-pre-wrap">
            {(props.summary.tokens ?? []).map((tok, i) => {
              if (!tok.w) {
                return (
                  <span key={i}>
                    {tok.ws ? " " : ""}
                    {tok.t}
                  </span>
                );
              }
              const key = lookupKey(tok.l ?? tok.t);
              const entry = entries[key];
              const state = entry?.state;
              const cls = state ? ` state-${state}` : "";
              return (
                <span key={i}>
                  {tok.ws ? " " : ""}
                  <span
                    className={`word${cls}`}
                    onClick={() => handleTap(tok, i)}
                    role="button"
                    tabIndex={0}
                  >
                    {tok.t}
                  </span>
                </span>
              );
            })}
          </p>
        )}
      </article>

      {selected && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-base font-semibold text-slate-900">
                {selected.surface}
              </span>
              {selected.lemma !== selected.surface.toLowerCase() && (
                <span className="ml-2 text-xs text-slate-500">
                  ({selected.lemma})
                </span>
              )}
            </div>
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {selected.state ?? "mastered"}
            </span>
          </div>
          <div className="mt-1 text-slate-700">
            {selected.translation ?? (pending ? "translating…" : "—")}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Tap again to cycle: unknown → seen → mastered.
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 text-sm">
          <div className="text-slate-600">
            {wordTokens.length} words · {totalTaps} taps
            {newUnknown > 0 && ` · ${newUnknown} new unknown`}
          </div>
          <button
            type="button"
            onClick={handleFinish}
            disabled={finished}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {finished ? "Saved" : "Finish"}
          </button>
        </div>
      </div>
    </div>
  );
}
