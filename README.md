# Job Application Suite

AI-powered job application assistant — analyze job fit, generate tailored CV/cover letter/email, track applications, and prep for interviews.

## Features

- **Cari Loker (auto-search)** — search live vacancies from Adzuna (Indonesia), auto-ranked by a local fit estimate against your profile, save any result to the tracker in one click
- **Analyze & Generate** — fetch job from URL or upload an image poster, get ATS match score, generate CV / cover letter / email, export as PDF or DOCX
- **Job Tracker** — list **or Kanban board** (drag cards between statuses), plus a dashboard with a conversion funnel and upcoming-deadline reminders
- **AI CV improver** — actionable, honest edit suggestions + a rewritten summary tailored to a specific job
- **Follow-up & thank-you emails** — generate a post-apply follow-up and a post-interview thank-you note from the application's data
- **Interview Prep** — company overview, salary range, 6 interview Q&A with STAR-method answers (cached per job)
- **Image job posters** — Gemini vision reads Instagram/image-only postings and auto-fills job fields
- **Onboarding & dark mode** — a first-login setup checklist gets new users started, and a light/dark theme toggle (remembered across sessions) lives in the sidebar

## Tech Stack

### Frontend

| Layer | Library / Tool |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| PDF export | pdfmake (client-side, ATS-selectable text) |
| DOCX export | docx |
| File download | file-saver |
| Alerts | SweetAlert2 |
| Icons | lucide-react |

### Backend

> No separate server — all backend logic runs as **Next.js Route Handlers** (`app/api/*/route.ts`) within the same project.

| Layer | Detail |
|---|---|
| Runtime | Node.js via Next.js 14 (server-side) |
| API style | Next.js Route Handlers — no Express |
| ORM | Prisma 6 |
| Database | SQLite (`prisma/dev.db`) — swap to PostgreSQL for production |
| Auth | NextAuth v5 (Google OAuth), sessions stored in DB |
| API key storage | Per-user encrypted Gemini keys in DB |
| AI | Google Gemini via `@google/generative-ai` — text + multimodal vision |
| AI model fallback | gemini-2.0-flash → gemini-2.5-flash → gemini-2.5-flash-lite → gemini-flash-latest |
| Web scraping | axios + cheerio (auto-fetch job details from URL) |
| PDF parsing | pdf-parse + pdfjs-dist (read uploaded CV) |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
GEMINI_API_KEY=your_key_here
AUTH_SECRET=generate_with_openssl_rand_-base64_32
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
```

Get a free Gemini key: https://aistudio.google.com/app/apikey

**For job search (Cari Loker):** register a free app at https://developer.adzuna.com/ to get an **App ID** and **App Key**, then paste both into **Settings → Adzuna** in the app. Stored encrypted, per-user.

### 3. Set up database

```bash
npm run db:push
```

### 4. Run development server

```bash
npm run dev
```

Open http://localhost:3000

## Usage

### Cari Loker (auto-search)

1. Set your Adzuna **App ID** + **App Key** in **Settings** (one-time)
2. Type a role/keyword (and optional location) → **Cari**
3. Results are ranked by estimated fit with your profile — click **Simpan ke Tracker** on any you like
4. Open a saved job in **Analyze & Generate** for the precise AI ATS score and tailored documents

### Analyze & Generate

1. Paste a job URL **or** upload an image poster (Instagram, flyer, etc.)
2. Fill/confirm Company, Role, Location
3. Click **Analyze Match** — get ATS score, strengths, gaps, keywords
4. Generate **CV**, **Cover Letter**, or **Email** (tailored to the job)
5. Export as **PDF** or **DOCX** — filename auto-formatted as `Name_DocType_Company`
6. Save to Job Tracker

### Job Tracker

- View all saved applications in one place
- Update status, edit company/role, add notes and salary expectation
- Open the document generator from any saved job (no need to re-paste)

### Interview Prep

- Select a saved job
- Generate company overview, salary insights, and 6 interview questions with STAR-method suggested answers

## Available Scripts

```bash
npm run dev          # start dev server
npm run build        # prisma generate + next build
npm run db:push      # sync Prisma schema to SQLite (no migration history)
npm run db:migrate   # create a named migration
npm run db:studio    # open Prisma Studio (DB GUI)
```
