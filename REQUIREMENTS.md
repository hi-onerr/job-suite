# Job Application Suite — Requirements

> Status: Draft v2 · Owner: Ferrari Mayrareno · Last updated: 2026-06-24

> **Direction locked (v2):** Goal is a **hands-off** experience — the app applies
> for the user so they can do other work. Auto-submit is enabled **only on
> permitted sources** (ATS like Greenhouse/Lever/Workable + open boards). LinkedIn
> & JobStreet stay **review/manual** (auto-submit there would risk the user's own
> account). Apply strategy = **volume** (apply to as many matching jobs as
> possible on safe sources), with per-day caps and a kill switch.

## 1. Vision

Evolve the current single-user manual assistant into a **multi-user, AI-driven
auto-apply platform** for a small group of users (friends / private beta).
Inspired by LoopCV, Job Copilot, and Sonora: the app should **discover** matching
jobs, **tailor** application materials, **auto-apply** on the user's behalf, and
give **analytics** on the whole funnel.

## 2. Target users & scale

- **Audience:** a small, trusted group (≈ 5–50 users), not a public launch yet.
- **Deployment:** hosted web app with user accounts and a real database.
  Light infrastructure — no enterprise multi-tenancy, billing, or SSO required yet.
- **Implication:** must move off `localStorage` to server-side auth + DB. Per-user
  data isolation is required even in a small group (CVs and credentials are sensitive).

## 3. Scope summary

| Capability | Current app | Target |
|---|---|---|
| CV / profile storage | localStorage, single user | Per-user, server DB, multiple CV versions |
| Job intake | Manual paste / single-URL fetch | Automated discovery + matching across sources |
| Match analysis | Per-job, on demand | Automatic scoring on every discovered job |
| Document generation | CV / cover letter / email | Same + per-job tailoring, versioning |
| Applying | Manual (copy-paste) | **Auto-apply on safe sources**; review/manual on LinkedIn & JobStreet |
| Tracking | Manual status updates | Auto-updated from apply events + analytics |
| AI provider | Gemini only | Gemini active; Anthropic/OpenAI pluggable (already scaffolded) |

## 4. Functional requirements

### 4.1 Accounts & profile (NEW — foundational)
- FR-1 Users can sign up / log in (email + password or OAuth).
- FR-2 Each user has an isolated profile: contact info, base CV(s), preferences.
- FR-3 Users can store **multiple CV versions** and pick a default.
- FR-4 Users define **search criteria**: titles, locations (incl. remote),
  seniority, salary floor, keywords to include/exclude, companies to avoid.
- FR-5 Migrate existing localStorage data model (`JobApplication`, profile,
  API keys) into per-user server records.

### 4.2 Job discovery & matching
- FR-6 Aggregate jobs from one or more sources (see §7 — start with a legal
  source such as an official jobs API or RSS, not scraping).
- FR-7 De-duplicate jobs across sources.
- FR-8 Auto-score every discovered job against the user's selected CV
  (reuse the existing `/api/analyze` match logic: score, strengths, gaps).
- FR-9 Rank and present a match feed; user can save, dismiss, or queue for apply.
- FR-10 Scheduled/background discovery runs (e.g. daily) per user criteria.

### 4.3 CV / cover letter tailoring
- FR-11 Generate a per-job tailored CV, cover letter, and outreach email
  (extends existing `/api/generate`).
- FR-12 Store generated documents per application, with version history.
- FR-13 Export to PDF / DOCX (current app only does plain text + copy).
- FR-14 Keep AI provider pluggable (Gemini active; Anthropic/OpenAI scaffolded
  in `API_PROVIDERS`).

### 4.4 Auto-apply (source-gated — see §8)
Two lanes, decided by the job's source:
- **Safe-source lane (AUTO):** ATS (Greenhouse, Lever, Workable) and open job
  boards → app fills **and submits** automatically. This is the hands-off path.
- **Risky-source lane (REVIEW/MANUAL):** LinkedIn & JobStreet → app prepares the
  application but the **user submits** (protects the user's own account from ToS
  bans). No server-side automated submission to these.

Requirements:
- FR-15 User explicitly opts in per search/criteria before any auto-apply runs.
- FR-16 The app routes each matched job to AUTO or REVIEW lane based on its source
  (source allow-list configurable; LinkedIn/JobStreet default to REVIEW).
- FR-17 Autofill standard application fields from the user profile.
- FR-18 Support common ATS form patterns (Greenhouse, Lever, Workable) in the AUTO
  lane; "Easy Apply"-style flows on LinkedIn/JobStreet are REVIEW only.
- FR-19 **Volume strategy:** apply to as many matching safe-source jobs as
  possible, bounded by per-run and per-day caps (anti-spam, anti-ban).
- FR-20 Jobs with non-standard forms / screening questions the app can't safely
  answer are escalated to REVIEW instead of being submitted blindly.
- FR-21 Full audit log of every auto-applied job (what was sent, when, to where).
- FR-22 Kill switch: user can pause/stop all automation instantly.

### 4.5 Tracking & analytics
- FR-23 Auto-create a tracker entry when a job is applied (no manual step).
- FR-24 Funnel stats: discovered → matched → applied → interview → offer/rejected.
- FR-25 Response-rate metrics (e.g. % of applications that get a reply/interview).
- FR-26 Per-criteria and per-CV performance comparison.
- FR-27 Deadlines & follow-up reminders.
- FR-28 Separate AUTO-lane vs REVIEW-lane stats so volume on safe sources and
  manual conversions on LinkedIn/JobStreet are visible side by side.

## 5. Non-functional requirements
- NFR-1 **Security:** CVs, contact data, and API keys are sensitive. API keys
  must not live in `localStorage` in the multi-user version — store encrypted
  server-side or use a per-user secrets approach.
- NFR-2 **Privacy:** clear data ownership; users can export and delete all data.
- NFR-3 **Reliability:** background discovery/apply jobs must be idempotent and
  retry-safe; failures logged, never silently double-apply.
- NFR-4 **Rate limiting / politeness:** respect source rate limits and robots
  rules; throttle to avoid IP/account bans.
- NFR-5 **Observability:** logs and audit trail for all automated actions.
- NFR-6 **Cost control:** AI calls per discovered job can get expensive — cache
  analyses, batch where possible, allow per-user quotas.

## 6. Data model (target, replacing localStorage)
- `User` — auth, contact info, settings.
- `CV` — many per user; text + parsed structure + default flag.
- `SearchCriteria` — many per user; filters + auto-apply opt-in + threshold/caps.
- `Job` — discovered posting; source, dedupe key, raw JD, parsed fields.
- `Match` — (User × Job) score, strengths, gaps, status (new/saved/dismissed/queued).
- `Application` — applied job; status, documents used, applied channel, audit data.
- `Document` — generated CV/cover letter/email; versioned, linked to Application.
- `AutomationRun` — log of each discovery/apply batch; counts, errors.

## 7. Integrations & sources (decision needed)
Auto-discovery and auto-apply depend on where jobs come from. Options, roughly
from lowest to highest legal/technical risk:
1. **Official / partner job APIs & RSS feeds** (e.g. Greenhouse, Lever, Workable
   public job boards, Adzuna API). *Recommended starting point — legal and stable.*
2. **Aggregator APIs** (paid third-party job-data providers).
3. **Browser-automation against major boards** (LinkedIn/Indeed Easy Apply).
   High value but **violates those sites' Terms of Service** and risks user
   account bans — see §8.

## 8. Legal / ToS / ethical constraints (must read)
Auto-apply is the headline feature **and** the biggest risk. Posture (locked v2):
- LinkedIn, **JobStreet (SEEK)**, Indeed, and most large boards **prohibit
  automated access and auto-apply** in their ToS. Automating them can get the
  *user's own* account banned and exposes the project to legal risk.
- **Decision:** auto-submit is restricted to a **source allow-list** — ATS
  vendors (Greenhouse, Lever, Workable) and open boards that permit programmatic
  applications. **LinkedIn & JobStreet are never auto-submitted** by the server;
  they go to the REVIEW lane (user submits, ideally from their own browser session
  via paste/extension).
- Safeguards: explicit per-criteria opt-in, show what will be submitted, per-day
  caps, full audit log, and a global kill switch (FR-19, FR-21, FR-22).
- Note: even single-page *fetching* of LinkedIn/JobStreet to read a JD can hit
  login walls and ToS limits — prefer user-paste or a user-session browser
  extension over server-side scraping (do not build a bot-detection-evasion layer).

## 9. Suggested MVP phasing
- **Phase 0 (foundation):** auth + DB + migrate current localStorage model to
  per-user records. Keep existing manual Analyze/Generate/Prep working.
- **Phase 1 (discovery):** integrate one legal job source (e.g. Adzuna or an ATS
  feed), auto-score discovered jobs, match feed.
- **Phase 2 (tailoring+):** PDF/DOCX export, document versioning, multiple CVs.
- **Phase 3 (assisted apply):** autofill + REVIEW-lane submit (incl. LinkedIn/
  JobStreet via paste/extension), auto-tracker.
- **Phase 4 (auto-apply):** AUTO lane — hands-off submit on the safe-source
  allow-list (ATS + open boards) with volume + per-day caps, escalation of
  non-standard forms to REVIEW, audit log, kill switch.
- **Phase 5 (analytics):** funnel + response-rate dashboards.

## 10. Open questions
- OQ-1 Which job sources are we allowed to use for auto-apply? (drives §7/§8)
- OQ-2 Auth method: email/password vs Google OAuth?
- OQ-3 Hosting target (Vercel + managed Postgres? something else)?
- OQ-4 Do users bring their own AI API keys, or does the app provide a shared
  key with per-user quotas? (current app is BYO-key.)
- OQ-5 Background-job runner choice (cron, queue) for scheduled discovery/apply.
- OQ-6 PDF/DOCX generation approach (template engine vs library).
```
