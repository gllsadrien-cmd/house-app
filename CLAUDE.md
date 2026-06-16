# CLAUDE.md — House

Context for Claude Code working on this project. Read this fully before editing.

## What this is

A private web app for two people (a couple) to centralize their house/flat search.
Paste a listing URL → it best-effort auto-fills (photo, title, sometimes price) → they
complete the rest → it lands in a shared, sortable collection. Sort by date, by who added
it, and by price. The product value is the *shared collection both partners enjoy adding to*,
NOT the scraping. Optimize for that.

Two users only. This is not a multi-tenant app and should never be built like one.

## Stack (decided — don't relitigate without asking)

- **Frontend:** React (Vite), single-file component style as in `House.jsx`. Inline style
  objects + one injected `<style>` block for pseudo-classes/media queries. No CSS framework,
  no component library. Keep it dependency-light.
- **Auth + DB:** Supabase. Magic-link (passwordless) email login. Security boundary is a
  two-email allowlist enforced in Postgres RLS policies — NOT in client code.
- **Enrichment:** one Vercel serverless function at `api/enrich.js`, reads OpenGraph tags
  server-side (avoids the browser CORS wall).
- **Hosting:** Vercel free tier. Supabase free tier.

Full setup steps live in `SETUP.md`. The SQL schema and RLS policies are there — treat that
file as the source of truth for the data layer and keep it in sync if the schema changes.

## Current state

`House.jsx` is complete and runs in **demo mode** (`DEMO_MODE = true` at top of file):
seeded listings, mocked `mockEnrich()`. The UI, sorting, filtering, and add-sheet flow all
work against in-memory React state. The production wiring (Supabase client, real `/api/enrich`
call, login gate) is described in `SETUP.md` but NOT yet implemented in code.

### The job, when going live

1. Flip `DEMO_MODE = false`.
2. Replace the in-memory data layer (`useState(SEED)`, `addListing`, `removeListing`) with
   Supabase reads/writes. The component's data-flow shape stays the same — `listings` array
   in, `addListing(obj)` / `removeListing(id)` out. Wire those to Supabase, don't restructure
   the component.
3. Add a login gate: no session → single email input + "send me a link"; session → the app.
4. `added_by` must be derived from the logged-in user's email (map email → display name),
   set automatically on insert. Users NEVER manually tag who added a listing.

## Data model

Table `listings`: `id, url, title, image_url, price (int), location (text), surface (int),
rooms (int), notes, added_by, created_at`. See `SETUP.md` for the exact DDL + RLS.

## Design rules (these are decisions, hold the line)

- **Glass for chrome only.** Top bar, controls strip, and the add-sheet are frosted glass
  (`.glass` class). Listing cards are SOLID surfaces. This was a deliberate choice over the
  user's initial "glassmorphism all the way" because frosted panels hurt readability when
  scanning many prices. Do not glassify the cards without the user explicitly asking — and if
  asked, push back once before complying.
- **One accent.** Warm amber (`--amber`) is reserved for the primary action and active states
  only. Don't spread it. Don't add a second accent color.
- **Restraint over decoration.** Quiet everything that isn't the signature. No gradients on
  text, no extra shadows, no emoji in UI copy.
- **UI copy is in French** (the users are French, searching in France). Keep it plain,
  active-voice, sentence case. Errors explain what to do, they don't apologize.
- **Quality floor:** responsive to mobile, visible keyboard focus, `prefers-reduced-motion`
  respected (already wired in the CSS block — preserve it).

## Enrichment: expectations, not hopes

`og:title` and `og:image` work on most French property sites (Leboncoin, SeLoger, PAP).
Price is a crude regex — catches the common case, misses plenty. Surface and rooms are
almost always typed manually. This is acceptable and by design.

- Do NOT build a general-purpose scraper. The search lasts months; scraper maintenance is a
  bad trade.
- If enrichment needs to improve, prefer adding site-specific parsing for the 2–3 sites the
  users actually use over a generic solution.
- Enrichment must degrade gracefully: when it returns nothing, the manual fields absorb it.
  Never let a failed fetch block saving a listing.

## Roadmap (don't build ahead of the user)

- **Map view** (next likely ask): geocode `location` → `lat`/`lng` on save via Nominatim/OSM
  (free, rate-limited — fine for two users), store the coords, render with Leaflet + OSM tiles
  (no API key). Add a grid/map toggle. ~40 lines. Don't pre-build it; wait for the go.

## Working agreement with this user

The user is an exploratory thinker who wants honest challenge, not validation. If a request
will produce a worse result (e.g. glass cards, a fragile scraper, scope creep before the core
is live), say so plainly with the reason, propose the better path, then do what they decide.
Don't pad responses with enthusiasm. Be concise and specific.
