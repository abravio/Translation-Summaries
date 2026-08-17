import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/settings";
import { HeaderNav } from "@/components/HeaderNav";
import { Reader } from "@/components/Reader";
import { lookupKey } from "@/lib/tokenize";
import type { Summary, Token, WordState } from "@/lib/types";

export default async function SummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const settings = await getOrCreateSettings(supabase, user.id);

  const { data } = await supabase
    .from("summaries")
    .select("*, articles(title, url)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) notFound();

  const summary = data as Summary & {
    articles: { title: string | null; url: string } | { title: string | null; url: string }[] | null;
  };
  const article = Array.isArray(summary.articles) ? summary.articles[0] : summary.articles;

  // Preload per-lemma state for every word actually in this summary.
  const lemmas = Array.from(
    new Set(
      (summary.tokens ?? [])
        .filter((t: Token) => t.w)
        .map((t: Token) => lookupKey(t.l ?? t.t))
    )
  );
  const initialStates: Record<string, { state: WordState; translation: string | null; pos: string | null }> = {};
  if (lemmas.length > 0) {
    const lookups = await supabase
      .from("word_lookups")
      .select("lemma, state, translation, part_of_speech")
      .eq("user_id", user.id)
      .eq("target_lang", summary.target_lang)
      .in("lemma", lemmas);
    for (const row of lookups.data ?? []) {
      initialStates[row.lemma] = {
        state: row.state as WordState,
        translation: row.translation ?? null,
        pos: row.part_of_speech ?? null,
      };
    }
  }

  return (
    <>
      <HeaderNav currentLevel={settings.current_level} />
      <main className="flex-1">
        <Reader
          summary={summary}
          articleTitle={article?.title ?? null}
          articleUrl={article?.url ?? null}
          initialStates={initialStates}
        />
      </main>
    </>
  );
}
