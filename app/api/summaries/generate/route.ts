import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { fetchAndExtract } from "@/lib/readability";
import { generateSummary } from "@/lib/summarize";
import { getOrCreateSettings } from "@/lib/settings";
import { clampLevel } from "@/lib/level";

export const runtime = "nodejs";
export const maxDuration = 60;

// Either give a URL (we fetch + parse) or paste text directly (paywall escape).
type Payload = {
  url?: string;
  text?: string;
  title?: string;
  level?: number;
};

const MAX_PASTE_CHARS = 20_000;

function normalizeUrl(input: string): string {
  const u = new URL(input);
  // Strip tracking params + fragments so the (user, url) unique index works.
  const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"];
  for (const k of drop) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

// Pasted content gets a synthetic URL keyed by content hash so re-pasting the
// same article still hits the (user, url) dedup index and reuses the summary.
function pasteKey(text: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `paste:sha256:${hash}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  const pastedText = (body.text ?? "").trim();
  if (!body.url && !pastedText) {
    return NextResponse.json({ error: "Give a URL or paste article text." }, { status: 400 });
  }
  if (pastedText && pastedText.length < 200) {
    return NextResponse.json(
      { error: "Pasted text is too short — need at least a few paragraphs." },
      { status: 400 }
    );
  }

  let url: string;
  if (pastedText) {
    url = pasteKey(pastedText);
  } else {
    try {
      url = normalizeUrl(body.url!);
    } catch {
      return NextResponse.json({ error: "That doesn't look like a URL." }, { status: 400 });
    }
  }

  const settings = await getOrCreateSettings(supabase, user.id);
  const level = clampLevel(body.level ?? settings.current_level);

  // 1. Ingest the article — one row per (user, url).
  const existingArticle = await supabase
    .from("articles")
    .select("id, title, original_text, char_count")
    .eq("user_id", user.id)
    .eq("url", url)
    .maybeSingle();

  let articleId: string;
  let articleTitle: string | null;
  let articleText: string;
  if (existingArticle.data) {
    articleId = existingArticle.data.id;
    articleTitle = existingArticle.data.title ?? null;
    articleText = existingArticle.data.original_text;
  } else if (pastedText) {
    const capped =
      pastedText.length > MAX_PASTE_CHARS ? pastedText.slice(0, MAX_PASTE_CHARS) : pastedText;
    const title = (body.title ?? "").trim() || "Pasted article";
    const ins = await supabase
      .from("articles")
      .insert({
        user_id: user.id,
        url,
        title,
        source_lang: settings.native_lang,
        original_text: capped,
        char_count: pastedText.length,
      })
      .select("id")
      .single();
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    articleId = ins.data.id;
    articleTitle = title;
    articleText = capped;
  } else {
    let extracted;
    try {
      extracted = await fetchAndExtract(url);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            (e instanceof Error ? e.message : "Failed to fetch article.") +
            " Tip: switch to \"Paste text\" and copy the article body directly.",
        },
        { status: 400 }
      );
    }
    const ins = await supabase
      .from("articles")
      .insert({
        user_id: user.id,
        url,
        title: extracted.title,
        source_lang: settings.native_lang,
        original_text: extracted.text,
        char_count: extracted.charCount,
      })
      .select("id")
      .single();
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    articleId = ins.data.id;
    articleTitle = extracted.title;
    articleText = extracted.text;
  }

  // 2. Cached summary?
  const cached = await supabase
    .from("summaries")
    .select("*")
    .eq("article_id", articleId)
    .eq("level", level)
    .eq("target_lang", settings.target_lang)
    .eq("native_lang", settings.native_lang)
    .maybeSingle();
  if (cached.data) {
    return NextResponse.json({ summary: cached.data, articleTitle, level });
  }

  // 3. Grab the user's top unmastered words to seed the prompt.
  const unmastered = await supabase
    .from("word_lookups")
    .select("lemma, translation")
    .eq("user_id", user.id)
    .eq("target_lang", settings.target_lang)
    .in("state", ["unknown", "seen"])
    .order("last_tapped_at", { ascending: false })
    .limit(25);

  // 4. Generate.
  let result;
  try {
    result = await generateSummary({
      articleTitle,
      articleText,
      level,
      targetLang: settings.target_lang,
      nativeLang: settings.native_lang,
      focusNouns: settings.focus_nouns,
      focusVerbs: settings.focus_verbs,
      unmasteredWords: (unmastered.data ?? []).map((w) => ({
        lemma: w.lemma,
        translation: w.translation,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Summary generation failed." },
      { status: 500 }
    );
  }

  const ins = await supabase
    .from("summaries")
    .insert({
      article_id: articleId,
      user_id: user.id,
      level,
      target_lang: settings.target_lang,
      native_lang: settings.native_lang,
      summary_target: result.summary_target,
      summary_native: result.summary_native,
      tokens: result.tokens,
      featured_lemmas: result.featured_lemmas,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      model: result.model,
    })
    .select("*")
    .single();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

  return NextResponse.json({ summary: ins.data, articleTitle, level });
}
