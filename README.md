# Annie's List

One grocery budget across every store. Set what you can spend, scan items as you shop at Sam's Club, BJ's, the supermarket or CVS, confirm the shelf price, and watch the budget count down. The app remembers every price paid and tells you when something is running high or is a good deal.

## Phase one (this build)

- Budget setup and a huge, high-contrast "left to spend" number
- Barcode scanning with the phone camera (UPC/EAN), with typed-barcode and add-by-name fallbacks
- Product names from Open Food Facts (free, no key); unknown items are named once and remembered
- Cents-style price pad: type 3-4-9 to get $3.49; last paid price is pre-filled for repeat items
- Price signal on every item: good price / right on usual / running high, plus lowest price paid and where
- Store switcher, per-store spending breakdown, quantities, remove items, change budget, start a new budget (price history carries over)
- Installable to the home screen (web app manifest + icon)

## Data

- **Cloud mode:** Supabase. Each phone gets an anonymous account automatically (no sign-up), with row-level security so people only see their own data. Upgradable to email login in Phase two.
- **Preview mode:** if Supabase keys are not set, everything saves on the phone so the app can be tried right away.

## Setup

1. Supabase: create a project, open SQL Editor, run `supabase/schema.sql`.
2. Supabase: Authentication → Sign In / Providers → enable **Anonymous sign-ins**.
3. Vercel: add env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`), then redeploy.

```bash
npm install
npm run dev   # http://localhost:3000
```

Camera scanning needs HTTPS (works on the Vercel URL, or localhost).

## Phase two (next)

- Email login, linking the anonymous account
- Shared community price pool (store + product + price + date, no personal details)
- Guardrails against bad entries (outlier filtering, minimum reports before showing a community average)
