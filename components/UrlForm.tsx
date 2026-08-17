"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_LEVEL, MIN_LEVEL } from "@/lib/level";

type Mode = "url" | "paste";

export function UrlForm({ currentLevel }: { currentLevel: number }) {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState(currentLevel);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const payload: Record<string, unknown> = { level };
      if (mode === "url") {
        payload.url = url;
      } else {
        payload.text = text;
        if (title.trim()) payload.title = title.trim();
      }
      const res = await fetch("/api/summaries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { summary?: { id: string }; error?: string };
      if (!res.ok || !body.summary) {
        setError(body.error ?? "Failed to generate summary.");
        return;
      }
      router.push(`/s/${body.summary.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate.");
    } finally {
      setPending(false);
    }
  }

  const canSubmit = mode === "url" ? url.length > 0 : text.trim().length >= 200;

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`rounded px-3 py-1 ${
            mode === "url"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          URL
        </button>
        <button
          type="button"
          onClick={() => setMode("paste")}
          className={`rounded px-3 py-1 ${
            mode === "paste"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Paste text
        </button>
      </div>

      {mode === "url" ? (
        <div>
          <label
            htmlFor="url"
            className="block text-sm font-medium text-slate-700"
          >
            Article URL
          </label>
          <input
            id="url"
            type="url"
            required
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">
            Blocked by a paywall? Switch to <span className="font-medium">Paste text</span> and copy the article body directly.
          </p>
        </div>
      ) : (
        <>
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-slate-700"
            >
              Title <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="title"
              type="text"
              placeholder="e.g. Iran's plan to escalate"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="text"
              className="block text-sm font-medium text-slate-700"
            >
              Article text
            </label>
            <textarea
              id="text"
              required
              rows={10}
              placeholder="Paste the article body here…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base focus:border-slate-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">
              {text.trim().length} characters
              {text.trim().length > 0 && text.trim().length < 200 && (
                <span className="text-red-600"> — need at least 200</span>
              )}
            </p>
          </div>
        </>
      )}

      <div>
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="level"
            className="block text-sm font-medium text-slate-700"
          >
            Difficulty
          </label>
          <span className="text-sm text-slate-500">
            Level <span className="font-semibold text-slate-900">{level}</span> / {MAX_LEVEL}
          </span>
        </div>
        <input
          id="level"
          type="range"
          min={MIN_LEVEL}
          max={MAX_LEVEL}
          step={1}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="mt-2 w-full accent-slate-900"
        />
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>Beginner</span>
          <span>Native</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending || !canSubmit}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Generating…" : "Generate summary"}
      </button>

      <p className="text-center text-xs text-slate-500">
        First generation calls Claude. Re-generating at the same level is free (cached).
      </p>
    </form>
  );
}
