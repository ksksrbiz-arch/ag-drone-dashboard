# Drone Ops Dashboard — Vercel Deployment

## Prerequisites

- Node 18+ installed locally
- Supabase project with schema applied (`supabase_schema.sql`)
- GitHub account + repo
- Vercel account (free tier works)

---

## 1. Push to GitHub

```bash
cd outputs/drone-dashboard
git init
git add .
git commit -m "Initial drone ops dashboard"
gh repo create 1commerce-drone-dashboard --private --push --source .
```

Or manually create a repo on GitHub and push:

```bash
git remote add origin https://github.com/YOUR_ORG/drone-dashboard.git
git branch -M main
git push -u origin main
```

---

## 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository**
3. Select `drone-dashboard`
4. Framework: **Next.js** (auto-detected)
5. Root directory: leave blank (or set to `drone-dashboard/` if repo contains other folders)

---

## 3. Set Environment Variables

In the Vercel project settings → **Environment Variables**, add:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → `anon public` key |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys (enables AI lead research) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (server-side writes) |
| `CRON_SECRET` | Any random string — protects the automation endpoint |
| `APOLLO_API_KEY` | Apollo.io → Settings → API (optional contact enrichment) |
| `SLACK_WEBHOOK_URL` | Slack App → Incoming Webhooks (optional, for scraper alerts) |

Both `NEXT_PUBLIC_*` vars are safe to expose — they use the row-level-security anon key.
The rest are **server-side only** — set them in Vercel and never commit them.

---

## 4. Deploy

Click **Deploy**. Vercel builds with `next build` and serves on `https://drone-dashboard-xxx.vercel.app`.

Subsequent pushes to `main` auto-redeploy.

---

## 5. Custom Domain (Optional)

In Vercel → Domains, add `ops.1commerce.online` or similar, then add the CNAME record Vercel provides at your DNS registrar.

---

## Local Development

```bash
cd drone-dashboard
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm run dev
# Opens at http://localhost:3000
```

---

## Environment Variable Reference

```bash
# .env.local (local dev only — never commit)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
```

---

## Dashboard Pages

| Route | Description |
|---|---|
| `/` | Overview — KPIs, EFB action queue, vertical breakdown, top leads, recent jobs |
| `/assistant` | AI Ops Assistant — plain-English Q&A over leads/customers/jobs/fields/finance via read-only tools (needs `ANTHROPIC_API_KEY`) |
| `/leads` | Full lead database with search, filters, EFB risk bars, detail panel |
| `/discover` | Lead discovery — AI web search finds new prospects by drone-service category, dedupes, and adds them (auto-enriched) |
| `/pipeline` | LOI Kanban — 6-stage pipeline with one-click stage advance |
| `/customers` | Customer CRM — customers, contracts, service history; convert leads to customers |
| `/jobs` | Job tracker — revenue summary, status filter, full job table |
| `/intel` | EFB Intelligence Hub — action queue columns, composite risk cards, detail panel |
| `/field-ops` | Field Ops — 7-day spray-window forecast (Open-Meteo) + job scheduling |
| `/fields` | Fields — mapped field boundaries (GeoJSON import) with auto-acreage over satellite imagery |
| `/finance` | Financial Intelligence — revenue, A/R aging, weighted pipeline forecast |
| `/alerts` | Alerts — urgent lead transitions + daily ops digest (set `SLACK_WEBHOOK_URL` to auto-post the digest on the daily cron) |
| `/automation` | Lead Intelligence Automation — engine health, priority distribution, run history, manual trigger |

---

## Lead Intelligence Engine

An automated pipeline that researches and prioritizes leads, keeping the
dashboard current with no manual data entry.

**What it does each run:**

1. **Algorithmic prioritization** — a deterministic 0–100 score (P1–P4 tiers)
   from proximity to Canby, treatable acreage, crop value, EFB urgency, revenue
   potential, pipeline warmth, and contactability. Transparent factor breakdown
   is stored per lead.
2. **AI web research + reasoning** — Claude (`claude-opus-4-8`) with the
   web-search tool confirms/fills business name, owner & contact, crop types,
   phone/email/website, and writes a **"best approach for us specifically."**
3. **Optional Apollo.io** contact booster fills remaining phone/email gaps.
4. Writes everything back to Supabase → the dashboard updates automatically
   (with live realtime on the Automation page).

**How it runs:**

- **Scheduled:** Vercel Cron hits `/api/enrich/run` daily at 08:00 UTC
  (`vercel.json`). Vercel Hobby allows one cron run/day; on the Pro plan you can
  increase the frequency (e.g. `0 */6 * * *` for every 6 hours).
- **On demand:** the **Run automation now** button on `/automation`, or the
  **Refresh intel** button on any lead in `/leads`.
- **Endpoints:** `POST /api/enrich/run`, `POST /api/enrich/lead/[id]`,
  `GET /api/enrich/status`.

### Supabase backend intelligence layer

`supabase/migrations/20260614010000_intelligence_backend.sql` moves operational
logic into Postgres so the platform is more autonomous:

- **Triggers** — new leads are auto-enqueued (`enrichment_status='pending'`) so
  they enter the research queue with no manual step; `updated_at` is auto-maintained.
- **`mark_stale_leads(days)`** — re-queues leads whose enrichment has aged out
  (called by the engine each run; can also be scheduled via pg_cron).
- **`get_ops_kpis()`** — one-call aggregated KPI payload for the dashboards.
- **Views** — `lead_priority_queue` (the canonical work queue) and
  `next_best_actions` (outreach-ready leads, hottest first — surfaced on `/automation`).

Apply it the same way (Supabase → SQL Editor). Additive and idempotent.

**Setup:**

1. Apply the migrations in `supabase/migrations/` in order
   (`…000000_lead_intelligence_engine.sql`, `…010000_intelligence_backend.sql`,
   `…020000_alerts.sql`) via Supabase Dashboard → SQL Editor. All are additive
   and safe to run on the existing database.
2. Set `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel. (Without
   `ANTHROPIC_API_KEY` the engine still runs the algorithmic prioritization.)
3. Set `CRON_SECRET`; set `ENRICHMENT_REQUIRE_SECRET=true` to lock down manual
   triggers.

> The engine degrades gracefully: missing AI key → algorithmic scoring only;
> migration not yet applied → it writes the columns it can and reports the rest.

---

## Supabase Setup

If starting fresh, run the schema in Supabase SQL Editor:

```bash
# In Supabase Dashboard → SQL Editor
# Paste and run: outputs/supabase_schema.sql
```

The Python scrapers (`scrape_all.py`) write to the same Supabase instance. Set:

```bash
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_KEY=<service_role_key>   # server-side only, not anon key
```

The GitHub Actions workflow (`.github/workflows/scrape.yml`) uses these as secrets.
