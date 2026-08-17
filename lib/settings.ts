import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSettings } from "@/lib/types";

// Fetch (or lazily create) the signed-in user's settings row. The middleware
// guarantees a user; row inserts respect RLS because user_id = auth.uid().
export async function getOrCreateSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<UserSettings> {
  const { data } = await supabase
    .from("user_settings")
    .select("user_id, target_lang, native_lang, current_level, focus_nouns, focus_verbs")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as UserSettings;

  const inserted = await supabase
    .from("user_settings")
    .insert({ user_id: userId })
    .select("user_id, target_lang, native_lang, current_level, focus_nouns, focus_verbs")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data as UserSettings;
}
