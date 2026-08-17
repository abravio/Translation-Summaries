import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/settings";
import { HeaderNav } from "@/components/HeaderNav";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  level: number;
  created_at: string;
  articles: { title: string | null; url: string } | { title: string | null; url: string }[] | null;
};

export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const settings = await getOrCreateSettings(supabase, user.id);
  const { data } = await supabase
    .from("summaries")
    .select("id, level, created_at, articles(title, url)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];

  return (
    <>
      <HeaderNav currentLevel={settings.current_level} />
      <main className="mx-auto max-w-2xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold text-slate-900">History</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every summary you&apos;ve generated. Tap one to re-read.
        </p>

        <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {rows.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              No summaries yet. Paste a URL on the home page to start.
            </li>
          )}
          {rows.map((r) => {
            const article = Array.isArray(r.articles) ? r.articles[0] : r.articles;
            return (
              <li key={r.id}>
                <Link
                  href={`/s/${r.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">
                      {article?.title ?? "Untitled"}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {article?.url}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-500">
                    <time>{new Date(r.created_at).toLocaleDateString()}</time>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      L{r.level}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
