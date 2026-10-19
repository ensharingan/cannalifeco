# Cannalife Co POS

Cannabis POS, membership and club management platform for Cannalife Co — a white label of Budify, operated by TJ Spares (Pty) Ltd t/a Lereko Digital.

## Stack
- React + Vite
- Supabase (Auth + Database + Storage + Edge Functions)
- Tailwind CSS + shadcn/ui
- Vercel (hosting)

## Branding
All customer-visible identity lives in `src/lib/brand.js`. Logo: `src/cannalife-logo.png`. Icons: `public/icon-*.png`, `public/cannalife-icon.svg`. Placeholder logo/icons were generated; replace with the client's artwork (same filenames and sizes). Domain assumed to be `cannalife.co.za` — search-and-replace if different.

## Setup
1. Create a **dedicated** Supabase project for Cannalife Co (do not reuse the Budify or CannaGQ project).
2. Apply the base Budify schema, then everything in `supabase/migrations/` in order. (`budify-schema.sql` in the source zip was empty — export the schema from the Budify project.)
3. `cp .env.example .env` and fill in the new project's URL and anon key.
4. Deploy `supabase/functions/*` and follow `supabase/functions/PAYCLOUD_SETUP.md` with Cannalife's own PayCloud app credentials.
5. `npm install && npm run dev`
6. Deploy to Vercel; add the custom domain.

## Android (TWA)
`public/.well-known/assetlinks.json` is empty. After building the TWA, add its package name (e.g. `za.co.cannalife.pos.twa`) and signing-cert SHA-256 fingerprint.

## Support
support@cannalife.co.za
