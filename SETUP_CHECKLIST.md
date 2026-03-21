# Bloom Intelligence — Setup Checklist
Things to configure before going live. Check off as you complete them.

---

## SQL Migrations (run in Supabase SQL Editor)

- [ ] **Migration 009** — `onboarding_step`, `funnel_config`, `venue_profile` on venues
- [ ] **Migration 010** — `calendly_api_key`, `briefing_email` on venues + `venue_invites` table
- [ ] **Migration 011** — `hold_expires_at`, `lost_reason`, `lost_reason_note` on clients
- [ ] **Migration 012** — `stripe_customer_id`, `stripe_subscription_id`, `plan_status`, `trial_ends_at` on venues

All migration files are in `supabase/migrations/`.

---

## Environment Variables (add to Vercel → Settings → Environment Variables)

### Already needed (existing features)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `ANTHROPIC_API_KEY` — from console.anthropic.com
- [ ] `GOOGLE_CLIENT_ID` — for Gmail OAuth
- [ ] `GOOGLE_CLIENT_SECRET` — for Gmail OAuth
- [ ] `NEXT_PUBLIC_APP_URL` — your production URL (no trailing slash, e.g. `https://app.bloomhq.co`)

### New — Stripe billing
- [ ] `STRIPE_SECRET_KEY` — from Stripe Dashboard → Developers → API Keys
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — from same place
- [ ] `STRIPE_WEBHOOK_SECRET` — after creating webhook below
- [ ] `STRIPE_PRICE_ID` — after creating product below

### New — Email (Resend)
- [ ] `RESEND_API_KEY` — from resend.com → API Keys
- [ ] `BRIEFING_FROM_EMAIL` — e.g. `briefing@bloomhq.co` (must be a verified domain in Resend)

### New — FRED economic data
- [ ] `FRED_API_KEY` — free registration at https://fred.stlouisfed.org/docs/api/api_key.html

### New — Cron security
- [ ] `CRON_SECRET` — any random string, e.g. generate with `openssl rand -hex 32`

### New — Error monitoring (Sentry)
- [ ] `NEXT_PUBLIC_SENTRY_DSN` — from Sentry project settings
- [ ] `SENTRY_ORG` — your Sentry org slug
- [ ] `SENTRY_PROJECT` — your Sentry project slug
- [ ] `SENTRY_AUTH_TOKEN` — from Sentry → Settings → Auth Tokens (for source map upload)

---

## External Service Setup

### Stripe
1. [ ] Create a Stripe account at stripe.com
2. [ ] Create a Product: "Bloom Intelligence" → Price: $250/month recurring
3. [ ] Copy the Price ID (starts with `price_`) → `STRIPE_PRICE_ID`
4. [ ] Add a Webhook endpoint pointing to `https://your-domain.com/api/stripe/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
5. [ ] Copy Webhook Signing Secret → `STRIPE_WEBHOOK_SECRET`
6. [ ] Enable Customer Portal: Stripe Dashboard → Settings → Billing → Customer portal → Activate

### Resend (email sending)
1. [ ] Create account at resend.com
2. [ ] Add and verify your sending domain (e.g. bloomhq.co)
   - Add the DNS records Resend provides to your domain registrar
3. [ ] Create an API key → `RESEND_API_KEY`
4. [ ] Set `BRIEFING_FROM_EMAIL` to a verified address on that domain

### FRED (Federal Reserve economic data)
1. [ ] Register at https://fred.stlouisfed.org/docs/api/api_key.html (free)
2. [ ] Copy API key → `FRED_API_KEY`
3. [ ] After adding env var, trigger first ingestion: POST to `/api/macro/fred` once manually

### Sentry (error monitoring)
1. [ ] Create account at sentry.io
2. [ ] Create a new Next.js project
3. [ ] Copy DSN → `NEXT_PUBLIC_SENTRY_DSN`
4. [ ] Copy org slug + project slug → `SENTRY_ORG`, `SENTRY_PROJECT`
5. [ ] Create auth token → `SENTRY_AUTH_TOKEN`

### Google OAuth (Gmail)
1. [ ] Confirm redirect URI in Google Console includes:
   - `https://your-domain.com/api/auth/google/callback`
   - **No trailing slash**
2. [ ] If using invite page: no additional OAuth scopes needed

### Vercel Cron
1. [ ] Cron config is in `vercel.json` at repo root — Vercel picks it up automatically on deploy
2. [ ] Add `CRON_SECRET` env var to Vercel — cron routes verify this header
3. [ ] Cron schedules:
   - FRED ingestion: 1st of every month at 6am UTC
   - Briefing email: Every Monday at 8am UTC
   - General cron: Every hour

---

## One-time Calibration (per venue after signup)
1. [ ] After a venue signs up, `/api/onboard` is called automatically — this sets NOAA station, Google Trends metro, Fed district from their city/state
2. [ ] If a venue's weather/trends data looks wrong, they can manually update in Settings → Intelligence Calibration
3. [ ] After `FRED_API_KEY` is added, trigger `/api/macro/fred` once to backfill 3 years of economic data

---

## npm install (run after pulling latest)
```bash
cd apps/web
npm install
# New packages added:
# - stripe (billing)
# - @sentry/nextjs (error monitoring)
```

---

## Deploy checklist (before first paid customer)
- [ ] All migrations run
- [ ] All env vars in Vercel
- [ ] Stripe webhook configured and verified
- [ ] Resend domain verified
- [ ] FRED backfill run
- [ ] Test signup → onboard → dashboard flow end-to-end
- [ ] Test Stripe checkout (use test mode cards first)
- [ ] Test Gmail OAuth connection
- [ ] Verify Sentry receives test errors
