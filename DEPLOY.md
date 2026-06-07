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
| `SLACK_WEBHOOK_URL` | Slack App → Incoming Webhooks (optional, for scraper alerts) |

Both `NEXT_PUBLIC_*` vars are safe to expose — they use the row-level-security anon key.

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
| `/leads` | Full lead database with search, filters, EFB risk bars, detail panel |
| `/pipeline` | LOI Kanban — 6-stage pipeline with one-click stage advance |
| `/jobs` | Job tracker — revenue summary, status filter, full job table |
| `/intel` | EFB Intelligence Hub — action queue columns, composite risk cards, detail panel |

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
