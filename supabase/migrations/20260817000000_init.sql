-- Translation Summaries: initial schema
-- Re-runnable: uses IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_settings — one row per authenticated user, auto-created on first read
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_lang text not null default 'es',
  native_lang text not null default 'en',
  current_level int not null default 5 check (current_level between 1 and 10),
  focus_nouns boolean not null default true,
  focus_verbs boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- articles — one row per (user, url); dedup means re-pasting a URL is free
-- ---------------------------------------------------------------------------
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  title text,
  source_lang text not null default 'en',
  original_text text not null,
  char_count int not null,
  fetched_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists articles_user_fetched_at_idx
  on public.articles (user_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- summaries — cached per (article, level, langs)
-- ---------------------------------------------------------------------------
create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level int not null check (level between 1 and 10),
  target_lang text not null,
  native_lang text not null,
  summary_target text not null,
  summary_native text not null,
  -- tokens: array of {t: text, l?: lemma, pos?: part-of-speech, w: is-word, ws: leading-whitespace}
  tokens jsonb not null,
  featured_lemmas text[] not null default '{}',
  input_tokens int,
  output_tokens int,
  model text,
  created_at timestamptz not null default now(),
  unique (article_id, level, target_lang, native_lang)
);

create index if not exists summaries_user_created_at_idx
  on public.summaries (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- word_lookups — per-user, per-lemma state. State cycles unknown → seen → mastered.
-- ---------------------------------------------------------------------------
create table if not exists public.word_lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lemma text not null,
  target_lang text not null,
  native_lang text not null,
  translation text,
  part_of_speech text,
  state text not null default 'unknown' check (state in ('unknown', 'seen', 'mastered')),
  times_tapped int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_tapped_at timestamptz not null default now(),
  mastered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lemma, target_lang)
);

drop trigger if exists word_lookups_updated_at on public.word_lookups;
create trigger word_lookups_updated_at
  before update on public.word_lookups
  for each row execute function public.set_updated_at();

create index if not exists word_lookups_user_state_idx
  on public.word_lookups (user_id, state, last_tapped_at desc);

-- ---------------------------------------------------------------------------
-- reading_events — used to auto-calibrate difficulty
-- ---------------------------------------------------------------------------
create table if not exists public.reading_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_id uuid references public.summaries(id) on delete set null,
  level int not null,
  total_words int not null,
  taps int not null default 0,
  new_unknown_words int not null default 0,
  finished_at timestamptz not null default now()
);

create index if not exists reading_events_user_finished_at_idx
  on public.reading_events (user_id, finished_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — every table is per-user; the anon key can only see rows
-- belonging to the signed-in user.
-- ---------------------------------------------------------------------------
alter table public.user_settings enable row level security;
alter table public.articles enable row level security;
alter table public.summaries enable row level security;
alter table public.word_lookups enable row level security;
alter table public.reading_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_settings', 'articles', 'summaries', 'word_lookups', 'reading_events'
  ]
  loop
    execute format('drop policy if exists "owner full access" on public.%I', t);
    execute format(
      'create policy "owner full access" on public.%I
         for all to authenticated
         using (user_id = auth.uid())
         with check (user_id = auth.uid())', t);
  end loop;
end;
$$;
