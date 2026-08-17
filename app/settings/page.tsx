import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/settings";
import { updateSettings } from "@/app/actions";
import { HeaderNav } from "@/components/HeaderNav";
import { MAX_LEVEL, MIN_LEVEL, LEVEL_GUIDANCE } from "@/lib/level";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const settings = await getOrCreateSettings(supabase, user.id);

  const wordStats = await supabase
    .from("word_lookups")
    .select("state")
    .eq("user_id", user.id);
  const counts = { unknown: 0, seen: 0, mastered: 0 };
  for (const row of wordStats.data ?? []) {
    const s = row.state as keyof typeof counts;
    if (counts[s] !== undefined) counts[s] += 1;
  }

  return (
    <>
      <HeaderNav currentLevel={settings.current_level} />
      <main className="mx-auto max-w-2xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>

        <form
          action={updateSettings}
          className="mt-4 space-y-5 rounded-xl border border-slate-200 bg-white p-5"
        >
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="current_level" className="text-sm font-medium text-slate-700">
                Difficulty level
              </label>
              <span className="text-sm text-slate-500">
                {settings.current_level} / {MAX_LEVEL}
              </span>
            </div>
            <input
              id="current_level"
              name="current_level"
              type="range"
              min={MIN_LEVEL}
              max={MAX_LEVEL}
              defaultValue={settings.current_level}
              step={1}
              className="mt-2 w-full accent-slate-900"
            />
            <p className="mt-2 text-xs text-slate-500">
              {LEVEL_GUIDANCE[settings.current_level]}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Auto-adjusts based on how often you tap unknown words.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-700">Focus</div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="focus_nouns"
                defaultChecked={settings.focus_nouns}
                className="h-4 w-4 rounded border-slate-300"
              />
              Nouns
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="focus_verbs"
                defaultChecked={settings.focus_verbs}
                className="h-4 w-4 rounded border-slate-300"
              />
              Verbs
            </label>
          </div>

          <div className="border-t border-slate-100 pt-4 text-sm text-slate-600">
            Target language:{" "}
            <span className="font-medium text-slate-900">Spanish</span> · Native
            language: <span className="font-medium text-slate-900">English</span>
            <div className="mt-1 text-xs text-slate-400">
              (More language pairs coming later.)
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Save
          </button>
        </form>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">
            Vocabulary
          </h2>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-red-100 px-3 py-3">
              <div className="text-2xl font-semibold text-red-900">{counts.unknown}</div>
              <div className="text-xs text-red-900/70">Unknown</div>
            </div>
            <div className="rounded-lg bg-red-50 px-3 py-3">
              <div className="text-2xl font-semibold text-red-800">{counts.seen}</div>
              <div className="text-xs text-red-800/70">Seen</div>
            </div>
            <div className="rounded-lg bg-slate-100 px-3 py-3">
              <div className="text-2xl font-semibold text-slate-900">{counts.mastered}</div>
              <div className="text-xs text-slate-600">Mastered</div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
