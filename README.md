# Translation Summaries

Paste a link → get a level-calibrated Spanish summary of the article →
tap words to translate and mark unknown → the app prioritizes your
unlearned words in the next summary and auto-adjusts difficulty over
time. Next.js + Supabase + Anthropic, deployed on Vercel.

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in real values (see below)
npm run dev                        # http://localhost:3000
```

### Environment variables

| Variable | Where to find it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Safe for the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key | Safe for the browser (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key | **Server-side only.** Used by `scripts/create-user.mjs`; never shipped to the client |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | **Server-side only.** Powers summary generation + word translation |

## Database migrations

Migrations live in `supabase/migrations/` and are idempotent
(`IF NOT EXISTS` / `ON CONFLICT`). Two ways to apply them:

**Option A — Supabase Dashboard:** open the SQL Editor in your Supabase
project, paste the migration file(s) in filename order, run.

**Option B — Supabase CLI:**

```bash
npx supabase db push --db-url "postgresql://postgres:[DB_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```

The initial migration creates all tables with RLS enabled and a default
`user_settings` row is created on first sign-in.

## Auth setup (one-time)

There is no signup page. Create your single login user with:

```bash
node scripts/create-user.mjs you@example.com "a-strong-password"
```

Or in the Supabase Dashboard: Authentication → Users → Add user → check
"Auto Confirm".

## Deploying (Vercel)

- Point Vercel at this repo; every push to `main` auto-deploys.
- Add the four env vars from `.env.local` in Vercel → Project → Settings
  → Environment Variables (all environments). Redeploy after changes.
- Add the migration workflow's secrets on GitHub:
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.
  (See `.github/workflows/migrate.yml`.)

## Project structure

```
app/                       Routes (App Router)
  page.tsx                 Reader (URL input + level slider + summary + tap-to-translate)
  login/                   Email/password login
  history/                 Log of past summaries
  settings/                Language + focus preferences
  actions.ts               Server actions (auth, article ingest, tap logging, settings)
  api/summaries/generate/  Generate a summary via Claude
  api/translate/           Translate a single word via Claude (cached in word_lookups)
components/                Reader UI, level slider, header nav
lib/                       Supabase clients, types, prompts, tokenization + level math
middleware.ts              Auth gate — every route except /login requires sign-in
supabase/migrations/       Version-controlled SQL migrations
scripts/                   create-user.mjs (seed the single auth user)
```

## The core loop, in one paragraph

The reader page asks for a URL and a level (1–10). On submit, the server
fetches the article, cleans it with Mozilla Readability, and asks Claude
to produce a Spanish summary at the requested level plus its verbatim
English translation and a token list with lemmas. The client renders each
token as a tappable span. Tapping cycles a word through unknown → seen →
mastered, colored deep-red / light-red / normal. Word state is per-lemma
so the state persists across every article. Next time you generate a
summary, the system prompt is seeded with your top unmastered words so
the model naturally weaves them in. After each reading session the app
records taps-per-100-words and nudges your level up or down.
