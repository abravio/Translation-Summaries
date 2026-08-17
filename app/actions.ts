"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/settings";
import { clampLevel, MAX_LEVEL, MIN_LEVEL, suggestedLevelDelta } from "@/lib/level";
import { lookupKey } from "@/lib/tokenize";
import type { WordState } from "@/lib/types";
import { nextState } from "@/lib/types";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signIn(
  _prev: { error: string } | undefined,
  formData: FormData
): Promise<{ error: string } | undefined> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const level = clampLevel(Number(formData.get("current_level")));
  const focus_nouns = formData.get("focus_nouns") === "on";
  const focus_verbs = formData.get("focus_verbs") === "on";

  await getOrCreateSettings(supabase, user.id);
  const { error } = await supabase
    .from("user_settings")
    .update({ current_level: level, focus_nouns, focus_verbs })
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/settings");
}

// ---------------------------------------------------------------------------
// Word taps — cycle unknown → seen → mastered → unknown
// ---------------------------------------------------------------------------

export async function tapWord(input: {
  lemma: string;
  targetLang: string;
  nativeLang: string;
}): Promise<{ state: WordState; translation: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const lemma = lookupKey(input.lemma);
  const existing = await supabase
    .from("word_lookups")
    .select("id, state, translation, times_tapped")
    .eq("user_id", user.id)
    .eq("lemma", lemma)
    .eq("target_lang", input.targetLang)
    .maybeSingle();

  if (existing.data) {
    const nxt = nextState(existing.data.state as WordState);
    const patch: Record<string, unknown> = {
      state: nxt,
      times_tapped: (existing.data.times_tapped ?? 0) + 1,
      last_tapped_at: new Date().toISOString(),
    };
    if (nxt === "mastered") patch.mastered_at = new Date().toISOString();
    if (nxt !== "mastered") patch.mastered_at = null;
    const { error } = await supabase
      .from("word_lookups")
      .update(patch)
      .eq("id", existing.data.id);
    if (error) throw new Error(error.message);
    return { state: nxt, translation: existing.data.translation ?? null };
  }

  // First tap → row starts in "unknown".
  const { error } = await supabase.from("word_lookups").insert({
    user_id: user.id,
    lemma,
    target_lang: input.targetLang,
    native_lang: input.nativeLang,
    state: "unknown",
    times_tapped: 1,
  });
  if (error) throw new Error(error.message);
  return { state: "unknown", translation: null };
}

// ---------------------------------------------------------------------------
// Log a completed reading session and auto-calibrate the user's level
// ---------------------------------------------------------------------------

export async function finishReading(input: {
  summaryId: string;
  level: number;
  totalWords: number;
  taps: number;
  newUnknownWords: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  await supabase.from("reading_events").insert({
    user_id: user.id,
    summary_id: input.summaryId,
    level: input.level,
    total_words: input.totalWords,
    taps: input.taps,
    new_unknown_words: input.newUnknownWords,
  });

  const delta = suggestedLevelDelta(input.taps, input.totalWords);
  if (delta !== 0) {
    const settings = await getOrCreateSettings(supabase, user.id);
    const nextLevel = Math.max(
      MIN_LEVEL,
      Math.min(MAX_LEVEL, settings.current_level + delta)
    );
    if (nextLevel !== settings.current_level) {
      await supabase
        .from("user_settings")
        .update({ current_level: nextLevel })
        .eq("user_id", user.id);
    }
  }
  revalidatePath("/");
}
