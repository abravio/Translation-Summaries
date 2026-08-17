# Translation Summaries — agent working notes

Reading-practice web app: paste a URL, get a level-calibrated Spanish summary
of the article, tap unknown words to see translations, and let the app
prioritize words you haven't learned yet in future summaries.

Stack: Next.js 16 (App Router, TypeScript) + Tailwind 4 + Supabase
(Postgres + Auth) + Anthropic SDK, deployed on Vercel.
See `README.md` for setup, env vars, and project structure.

## Ship-to-live workflow

- **Code** — pushing to `main` triggers Vercel's production deploy
  automatically. Commit straight to `main` for normal changes. (Managed
  remote sessions may be pinned to a feature branch by the harness — push
  the branch and let the owner merge; that still reaches `main`.)
- **Database** — put every schema change in a `supabase/migrations/*.sql`
  file. The `.github/workflows/migrate.yml` Action applies pending
  migrations to production whenever a migration file lands on `main`.
  Never hand the owner SQL to paste; add a migration file instead. Keep
  migrations idempotent (`IF NOT EXISTS` / `ON CONFLICT`).

### The one guardrail — pause before destructive schema changes

Additive migrations (new table, new nullable/defaulted column, new index)
ship automatically. **Do NOT auto-commit a destructive migration.** Stop
and confirm with the owner if a migration would drop or rename a column
or table, narrow a type, delete/bulk-update data, or change a primary or
foreign key.

## Conventions

- Types live in `lib/types.ts`.
- Server actions in `app/actions.ts` parse `FormData` and call
  `revalidatePath` after writes.
- API routes in `app/api/**/route.ts` do the LLM work; they always check
  `supabase.auth.getUser()` before doing anything.
- Prompts live in `lib/prompts.ts` — one file, easy to iterate on.
- Before pushing a non-trivial change, run `npx tsc --noEmit`,
  `npx eslint .`, and `npm run build`.

## Core mental model

- An **article** is a URL that got fetched + cleaned. One row per URL per user.
- A **summary** is a Spanish summarization of an article at a specific level.
  Cached by (article_id, level, langs), so re-generating at the same level
  reuses the row.
- A **word_lookup** is per-user, per-lemma. Its `state` is `unknown` →
  `seen` → `mastered`. The reader taps cycle through these; the summary
  generator weaves the top unmastered words into the next summary.
- A **reading_event** records taps-per-word for calibration. The current
  level nudges up when taps are rare, down when taps are frequent.
