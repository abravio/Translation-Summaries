import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { translateWord } from "@/lib/summarize";
import { getOrCreateSettings } from "@/lib/settings";
import { lookupKey } from "@/lib/tokenize";

export const runtime = "nodejs";
export const maxDuration = 30;

type Payload = {
  word?: string;
  lemma?: string;
  sentence?: string;
};

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
  const surface = (body.word ?? "").trim();
  if (!surface) return NextResponse.json({ error: "Missing word." }, { status: 400 });

  const settings = await getOrCreateSettings(supabase, user.id);
  const preLemma = body.lemma ? lookupKey(body.lemma) : "";

  // Cache hit by known lemma (from the tokenizer)?
  if (preLemma) {
    const hit = await supabase
      .from("word_lookups")
      .select("lemma, translation, part_of_speech")
      .eq("user_id", user.id)
      .eq("lemma", preLemma)
      .eq("target_lang", settings.target_lang)
      .maybeSingle();
    if (hit.data?.translation) {
      return NextResponse.json({
        lemma: hit.data.lemma,
        translation: hit.data.translation,
        pos: hit.data.part_of_speech ?? "other",
        cached: true,
      });
    }
  }

  // Call the model for lemma + translation.
  let result;
  try {
    result = await translateWord({
      word: surface,
      sentence: body.sentence ?? "",
      targetLang: settings.target_lang,
      nativeLang: settings.native_lang,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Translation failed." },
      { status: 500 }
    );
  }

  const finalLemma = preLemma || result.lemma;
  // Upsert the lookup; keep existing state if a row already exists.
  const existing = await supabase
    .from("word_lookups")
    .select("id")
    .eq("user_id", user.id)
    .eq("lemma", finalLemma)
    .eq("target_lang", settings.target_lang)
    .maybeSingle();
  if (existing.data) {
    await supabase
      .from("word_lookups")
      .update({ translation: result.translation, part_of_speech: result.pos })
      .eq("id", existing.data.id);
  } else {
    await supabase.from("word_lookups").insert({
      user_id: user.id,
      lemma: finalLemma,
      target_lang: settings.target_lang,
      native_lang: settings.native_lang,
      translation: result.translation,
      part_of_speech: result.pos,
      state: "unknown",
      times_tapped: 0,
    });
  }

  return NextResponse.json({
    lemma: finalLemma,
    translation: result.translation,
    pos: result.pos,
    cached: false,
  });
}
