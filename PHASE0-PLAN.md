# Phase 0 — Foundation: Auth + Database + Migration

> Goal: move the current single-user, `localStorage`-only app to a **multi-user
> app with accounts and a real database**, *without breaking* the existing manual
> Analyze / Generate / Prep features. This is the prerequisite for everything else
> (discovery, auto-apply, analytics).
>
> Companion to [REQUIREMENTS.md](REQUIREMENTS.md).
>
> **Status: BUILT (2026-06-24)** — code complete, `tsc --noEmit` clean, `next build`
> passes. Not yet run against a live DB/OAuth (needs the secrets in §6). Auth =
> Google social login (Auth.js v5 + Prisma 6 + Postgres). See "How to run" below.

## How to run (remaining manual steps — needs your accounts)
1. **Database:** create a free Postgres at https://neon.tech, copy its connection
   string into `DATABASE_URL`.
2. **Google OAuth:** create an OAuth client at
   https://console.cloud.google.com/apis/credentials → set redirect URI
   `http://localhost:3000/api/auth/callback/google` → put the id/secret into
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
3. **Secrets:** `cp .env.local.example .env.local`, then fill `AUTH_SECRET` and
   `ENCRYPTION_KEY` (both: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
4. **Create tables:** `npm run db:migrate` (or `npm run db:push` for a quick start).
5. **Run:** `npm run dev` → open http://localhost:3000 → "Sign in with Google".
6. **Migrate old data:** in the app go to Settings → "Import dari browser ini"
   (run once, in the browser that has your old localStorage data).

## Files added/changed in this build
- `prisma/schema.prisma` — User, ApiKey, Application + Auth.js models
- `app/lib/db.ts`, `app/lib/crypto.ts`, `app/lib/auth.ts`, `app/lib/session.ts`, `app/lib/keys.ts`
- `app/api/auth/[...nextauth]/route.ts` — Auth.js handler
- `app/api/applications/route.ts`, `app/api/applications/[id]/route.ts`
- `app/api/profile/route.ts`, `app/api/keys/route.ts`, `app/api/import/route.ts`
- `app/api/{analyze,generate,prep}/route.ts` — now load the user's key from the DB
- `app/providers.tsx`, `app/layout.tsx`, `types/next-auth.d.ts`
- `app/page.tsx` — auth gate, Google sign-in/out, server-backed data (no more localStorage)

## 0. Recommended answers to open questions (defaults — override if you disagree)
| # | Question | Recommendation | Why |
|---|---|---|---|
| OQ-2 | Auth method | **Google OAuth** via Auth.js (NextAuth v5), email/password optional later | No password storage to secure; friends likely have Google accounts |
| OQ-3 | Hosting + DB | **Vercel** + **Neon Postgres** (serverless) + **Prisma** ORM | Matches Next.js 14; free tiers fit a small group; easy migrations |
| OQ-4 | AI API keys | Keep **BYO-key** (as today) but store **encrypted server-side** per user | Already built; avoids you paying for everyone's AI usage |
| OQ-1 | Discovery source (Phase 1, not 0) | Start with **Adzuna API** | Free tier, REST, covers many countries incl. ID; legal |

## 1. Scope of Phase 0
**In scope**
- User accounts (sign in / sign out).
- Postgres database + Prisma schema.
- Per-user persistence of the 3 things currently in `localStorage`:
  `job-applications`, `user-profile`, `api-keys`.
- Rewrite the existing API routes to be **session-aware** (know which user).
- One-time **import** of a user's existing browser `localStorage` data into their
  account (so current data isn't lost).
- Encrypt stored AI API keys at rest.

**Out of scope (later phases)**
- Job discovery / matching feed (Phase 1).
- Auto-apply lanes (Phase 4).
- PDF/DOCX export, multiple CV versions, analytics dashboards.

## 2. Dependencies to add
- `next-auth@5` (Auth.js) + `@auth/prisma-adapter`
- `prisma` + `@prisma/client`
- `@neondatabase/serverless` (or standard `pg`)
- A crypto helper for key encryption (Node `crypto` AES-256-GCM — no new dep).

## 3. Data model (Phase 0 subset of REQUIREMENTS §6)
```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  image         String?
  profileText   String?  @db.Text          // was localStorage "user-profile"
  apiKeys       ApiKey[]
  applications  Application[]
  accounts      Account[]                  // Auth.js
  sessions      Session[]                  // Auth.js
  createdAt     DateTime @default(now())
}

model ApiKey {
  id          String @id @default(cuid())
  userId      String
  provider    String                       // "gemini" | "anthropic" | "openai"
  ciphertext  String @db.Text              // AES-256-GCM encrypted key
  iv          String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, provider])
}

model Application {            // was localStorage "job-applications" (JobApplication)
  id          String   @id @default(cuid())
  userId      String
  company     String
  role        String
  location    String?
  url         String?
  jobDesc     String   @db.Text
  status      String   @default("saved")   // saved|applied|interview|offer|rejected
  matchScore  Int      @default(0)
  appliedDate String?
  deadline    String?
  notes       String?  @db.Text
  salary      String?
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
// + Auth.js standard models: Account, Session, VerificationToken
```
Note: keep field names aligned with the existing TS `JobApplication` interface in
[app/page.tsx](app/page.tsx) to minimize frontend churn.

## 4. Work breakdown (suggested order)
1. **DB + Prisma setup** — add Neon connection string to `.env.local`, write
   `schema.prisma` (§3), run `prisma migrate dev`, add a `lib/db.ts` client.
2. **Auth.js** — configure Google provider + Prisma adapter, add `lib/auth.ts`,
   wrap app, add sign-in / sign-out UI in the header (replaces the static
   "Ferrari Mayrareno" label).
3. **Server data layer** — replace `localStorage` reads/writes in
   [app/page.tsx](app/page.tsx) with API calls:
   - `GET/POST/PATCH/DELETE /api/applications`
   - `GET/PUT /api/profile`
   - `GET/PUT /api/keys` (encrypt on write, decrypt only server-side)
   All scoped to the authenticated user's `id`.
4. **Key encryption** — `lib/crypto.ts` (AES-256-GCM, key from `ENCRYPTION_KEY`
   env). The existing AI routes (`/api/analyze`, `/generate`, `/prep`) currently
   read keys from request headers; switch them to load the user's stored key
   server-side instead (more secure than sending keys from the browser each call).
5. **Import flow** — a one-time "Import my old data" button that reads the three
   `localStorage` keys in the browser and POSTs them to the new endpoints.
6. **Guard rails** — every API route checks the session; return 401 if absent.

## 5. Migration / no-data-loss notes
- Existing users have data only in their browser. The import button (step 5) is
  how they carry it over — must run it once while logged in, on the same browser.
- After import, the app reads from the server; `localStorage` becomes legacy.

## 6. New environment variables
```
DATABASE_URL=postgres://...neon...
AUTH_SECRET=...                 # openssl rand -base64 32
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
ENCRYPTION_KEY=...              # 32-byte base64, for AES-256-GCM
```
(Existing `GEMINI_API_KEY` becomes optional once keys are per-user in DB.)

## 7. Risks / watch-outs
- **Security:** `ENCRYPTION_KEY` must never be committed; keys decrypted only on
  the server, never returned to the client.
- **Serverless + Prisma:** use a single cached client (`lib/db.ts`) to avoid
  connection exhaustion on Vercel.
- **Frontend churn:** swapping `localStorage` for async API calls means adding
  loading/error states the current synchronous code doesn't have.

## 8. Definition of done for Phase 0
- A user can sign in with Google.
- Their profile, applications, and API keys persist server-side and are private
  to them.
- All existing tabs (Tracker, Analyze & Generate, Interview Prep, Profile,
  Settings) work exactly as before, but backed by the DB.
- Existing local data can be imported once.
