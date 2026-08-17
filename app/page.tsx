import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/settings";
import { HeaderNav } from "@/components/HeaderNav";
import { UrlForm } from "@/components/UrlForm";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware guarantees a user, but TS doesn't know that.
  if (!user) return null;

  const settings = await getOrCreateSettings(supabase, user.id);

  const recent = await supabase
    .from("summaries")
    .select("id, level, created_at, article_id, articles(title, url)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  type RecentRow = {
    id: string;
    level: number;
    created_at: string;
    articles: { title: string | null; url: string } | { title: string | null; url: string }[] | null;
  };
  const rows = (recent.data ?? []) as RecentRow[];

  return (
    <>
      <HeaderNav currentLevel={settings.current_level} />
      <main className="flex-1">
        <UrlForm currentLevel={settings.current_level} />

        {rows.length > 0 && (
          <section className="mx-auto max-w-2xl px-4 pb-16">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">
              Recent
            </h2>
            <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
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
                      <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        L{r.level}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
