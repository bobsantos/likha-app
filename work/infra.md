# Likha Infrastructure Plan

**Created:** 2026-03-01
**Status:** Decided (pre-deployment)
**Scope:** MVP deployment for 5-10 beta users

---

## Current Inventory

| Component | Status | Config Files |
|---|---|---|
| Backend hosting | Railway configured | `backend/railway.json`, `backend/Dockerfile` |
| Frontend hosting | No deploy config yet | `frontend/next.config.js` |
| Database/Auth/Storage | Supabase (15 migrations) | `supabase/migrations/` |
| AI | Claude API (Sonnet) | `anthropic` in `requirements.txt` |
| Email inbound | Provider-agnostic adapter (Postmark + Resend) | `backend/app/services/inbound_email_adapter.py` |
| CI/CD | None (local pre-push hook only) | — |
| Monitoring/Error tracking | None | Health endpoints: `/health`, `/health/db`, `/health/storage` |
| Local dev | Docker Compose + `start.sh` | `docker-compose.yml`, `start.sh` |

### Environment Variables

**Backend** (`backend/.env.local`):
- `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY`
- `ENVIRONMENT`, `DEBUG`
- `INBOUND_WEBHOOK_SECRET`
- Production additions: `CORS_ORIGINS`, `EMAIL_PROVIDER`

**Frontend** (`frontend/.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL`

---

## Recommended Stack

| Layer | Choice | Plan | Monthly Cost |
|---|---|---|---|
| Backend hosting | **Railway** | Hobby | $5.00 |
| Frontend hosting | **Vercel** | Hobby (free) | $0.00 |
| Database/Auth/Storage | **Supabase** | Free (upgrade to Pro before real users) | $0.00 |
| Email inbound | **Resend** | Free (3K emails/mo) | $0.00 |
| AI | **Anthropic Claude API** | Pay-as-you-go | ~$3.00 |
| Error tracking | **Sentry** | Free (5K errors/mo) | $0.00 |
| CI/CD | **GitHub Actions** | Free (2K min/mo) | $0.00 |
| Uptime monitoring | **UptimeRobot** | Free | $0.00 |
| Domain | likha.app | Annual | ~$1.25 |
| **Total** | | | **~$9.25/mo** |

Post-beta (with real user data): Supabase Pro adds $25/mo, bringing total to **~$34.25/mo**.

---

## Decision Rationale

### Backend Hosting: Railway ($5/mo)

**Evaluated:** Railway vs Fly.io vs Render

- **Railway** — $5/mo Hobby plan includes $5 usage credit. Always-on (no cold starts). `railway.json` already configured with health checks and restart policy. Simplest path to deploy.
- **Fly.io** — No true free tier (usage-based billing). Requires `fly.toml` and CLI tooling. More ops knowledge needed for VM management. Better region co-location with Vercel (`iad`), but the latency difference is negligible for MVP.
- **Render** — $7/mo minimum (Starter plan). No free tier for web services since late 2024. Would require new config (`render.yaml`).

**Decision:** Railway. Already configured, cheapest always-on option, least migration effort.

### Email: Resend (free) over Postmark ($16.50/mo)

**Evaluated:** Resend vs Postmark for inbound email webhooks

| Criteria | Postmark | Resend |
|---|---|---|
| Inbound email support | Mature, battle-tested | Launched late 2025, newer |
| Attachment delivery | Base64-encoded inline in webhook JSON | May require separate API calls (verify before launch) |
| Inbound pricing | **$16.50/mo minimum** (Pro tier required) | **Free** (included in free tier, 3K emails/mo) |
| Free tier | 100 emails/mo, outbound only | 3,000 emails/mo, inbound + outbound |
| Webhook auth | Custom header support | Custom header support |

**Decision:** Resend. The $16.50/mo cost difference is significant for MVP. The adapter pattern in `inbound_email_adapter.py` already supports both providers — switching later is a config change.

**Action required:** Verify Resend's inbound webhook delivers base64 attachment content inline vs metadata-only. If metadata-only, update `normalize_resend()` to call the Resend Attachments API. Fix is isolated to one function.

### Frontend Hosting: Vercel (free)

Free Hobby tier includes 100 GB bandwidth, 150K serverless function calls, 6K build minutes. Massively overkill for 5-10 users. Built by the Next.js team — first-class support. Git push to deploy with automatic preview deploys on PRs. No `vercel.json` needed for standard Next.js.

### Database/Auth/Storage: Supabase (free)

Free tier: 500 MB database, 1 GB file storage, 50K MAU auth, 2 projects. More than enough for beta. Plan to upgrade to Pro ($25/mo) before onboarding real users with real data — free tier has no automated backups.

### AI: Claude API (~$3/mo)

Pay-as-you-go. A typical contract extraction: ~5K input tokens, ~1K output tokens = ~$0.03 per extraction. At 50-100 contracts/month: ~$1.50-$3.00. Negligible cost. AI column mapping adds minimal additional usage.

---

## Missing Pieces to Add

### Essential for Launch

| Component | Tool | Setup Effort | Why |
|---|---|---|---|
| **Error tracking** | Sentry (free) | Medium | Blind to production errors without it. Add `sentry-sdk[fastapi]` to backend, `@sentry/nextjs` to frontend. |
| **CI/CD** | GitHub Actions (free) | Low | Tests only run via local pre-push hook. Untested code can reach production if someone pushes without the hook. Add `.github/workflows/ci.yml`. |
| **Uptime monitoring** | UptimeRobot (free) | Low | Ping `/health` every 5 min. Also prevents Supabase free tier from auto-pausing after 7 days of inactivity. |

### Nice-to-Have (Post-Launch)

| Component | Tool | Why |
|---|---|---|
| Log aggregation | Railway built-in logs | Already available, no setup needed |
| Performance monitoring | Sentry Performance (free tier) | Track slow endpoints |
| Database backups | Supabase Pro ($25/mo) | Automated daily backups |

---

## Gotchas and Risks

### 1. Resend Attachment Handling (verify before launch)

`normalize_resend()` in `inbound_email_adapter.py` assumes attachments arrive base64-encoded inline in the webhook payload. Resend may deliver metadata only, requiring separate API calls to fetch attachments. **Test with a real inbound email before launch.** Fix is isolated to one normalizer function.

### 2. Supabase Free Tier Auto-Pause

Free tier projects pause after 7 days of inactivity. If paused, the backend API fails until the project wakes up (~30 seconds). An UptimeRobot ping to `/health/db` every 5 minutes prevents this. **Set up monitoring immediately after deploying.**

### 3. CORS Not Set for Production

`main.py` defaults to `localhost:3000` and `localhost:3001`. Must set `CORS_ORIGINS` env var in Railway to include the production frontend URL (Vercel domain or custom domain). Without this, all frontend API calls will be blocked.

### 4. Single Uvicorn Worker

`Dockerfile` and `railway.json` run 1 worker (needed for in-memory upload store in `sales_upload.py`). A slow Claude extraction (~10-30s) blocks other requests. Fine for 5-10 users. To scale: move upload store to Redis or Supabase, then increase workers.

### 5. No CI/CD Pipeline

No `.github/workflows/` directory exists. Without GitHub Actions, someone can push untested code that breaks production. Priority: add a basic workflow that runs `pytest` and `jest` on every PR.

### 6. Database Migrations Are Manual

Per architecture, migrations must be applied manually in Supabase Dashboard SQL Editor or via `supabase db reset`. Consider enabling Supabase's GitHub integration to auto-apply migrations on push to main (post-MVP).

---

## Deployment Checklist

### Config Changes Needed

**No changes needed:**
- [x] `railway.json` — already configured
- [x] `Dockerfile` / `Dockerfile.dev` — already separated
- [x] `docker-compose.yml` — local dev only
- [x] `next.config.js` — works as-is

**Changes needed before deploy:**

- [ ] Set Railway env vars: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `CORS_ORIGINS`, `EMAIL_PROVIDER=resend`, `INBOUND_WEBHOOK_SECRET`, `ENVIRONMENT=production`
- [ ] Set Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL=https://<railway-domain>.up.railway.app`
- [ ] Add Sentry: `sentry-sdk[fastapi]` to backend, `@sentry/nextjs` to frontend, init in `main.py` and `sentry.client.config.ts`
- [ ] Add GitHub Actions: `.github/workflows/ci.yml` (run backend + frontend tests on PR)
- [ ] Set up UptimeRobot: ping `https://<railway-domain>.up.railway.app/health` every 5 min
- [ ] Verify Resend inbound webhook attachment format with a real test email
- [ ] DNS: point `likha.app` to Vercel, set MX records for `inbound.likha.app` to Resend's inbound servers
- [ ] Apply all Supabase migrations to production project
