# House — setup & deploy

The artifact you're looking at runs in **demo mode** (seeded data, mocked URL reading).
This guide turns it into the real thing: magic-link email login, a shared database
you and your wife both write to, and best-effort URL enrichment. All on free tiers.

Total time: ~30–40 min, most of it copy-paste.

---

## 1. Supabase (auth + database) — ~10 min

1. Create a free project at supabase.com. Pick a region close to you (Frankfurt/Paris).
2. In **SQL Editor**, run this to create the table:

```sql
create table listings (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text,
  image_url text,
  price integer,
  location text,
  surface integer,
  rooms integer,
  notes text,
  added_by text,
  created_at timestamptz default now()
);

alter table listings enable row level security;

-- Only the two of you can read/write. Replace the emails.
create policy "household read"  on listings for select
  using (auth.jwt() ->> 'email' in ('you@example.com','wife@example.com'));
create policy "household write" on listings for insert
  with check (auth.jwt() ->> 'email' in ('you@example.com','wife@example.com'));
create policy "household delete" on listings for delete
  using (auth.jwt() ->> 'email' in ('you@example.com','wife@example.com'));
```

3. **Authentication → Providers → Email**: enable it, turn ON "Confirm email" off /
   magic link on (passwordless). Under **URL Configuration**, set your site URL
   (your Vercel URL once you have it, e.g. `https://house-xyz.vercel.app`).
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
   You'll paste these in step 3.

> The two-email allowlist in the RLS policies is your real security boundary — even if
> someone guesses the URL, they can't read the data without a magic link sent to one of
> those two inboxes.

---

## 2. The enrichment function — ~5 min

Create `api/enrich.js` (Vercel serverless). It fetches the pasted page server-side
(no CORS wall) and reads OpenGraph tags. Best-effort: returns what it finds, nulls otherwise.

```js
export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "missing url" });
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HouseBot/1.0)" },
    });
    const html = await r.text();
    const og = (p) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, "i"))
            || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${p}["']`, "i"));
      return m ? m[1] : null;
    };
    // crude price grab — French listings vary wildly; this catches the common case
    const priceMatch = html.match(/(\d[\d\s.,]{3,})\s*€/);
    const price = priceMatch ? Number(priceMatch[1].replace(/[\s.]/g, "").replace(",", ".")) : null;

    res.setHeader("Cache-Control", "s-maxage=86400");
    res.json({
      title: og("title"),
      image_url: og("image"),
      location: "", surface: null, rooms: null,
      price: Number.isFinite(price) ? price : null,
    });
  } catch (e) {
    res.json({ title: null, image_url: null, price: null, location: "", surface: null, rooms: null });
  }
}
```

**Expectations, honestly:** title + photo work on most French property sites. Price is
hit-or-miss. Surface and rooms you'll usually type yourself. That's the deal you signed up
for — enrichment saves keystrokes, manual fields guarantee correctness.

---

## 3. Wire the frontend — ~10 min

In a fresh Vite React project (`npm create vite@latest house -- --template react`):

1. `npm install @supabase/supabase-js`
2. Create `src/supabase.js`:

```js
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

3. Drop in `House.jsx` (the artifact code) and set `const DEMO_MODE = false;` at the top.
4. Replace the demo data layer with these four functions and a login gate. The component
   already calls `addListing` / `removeListing` / reads `listings` — point them here:

```js
// load
const { data } = await supabase.from("listings").select("*").order("created_at", { ascending: false });

// add (added_by comes from the logged-in user, so it's automatic)
await supabase.from("listings").insert({ ...listing, added_by: displayNameFromEmail });

// delete
await supabase.from("listings").delete().eq("id", id);

// login gate (magic link)
await supabase.auth.signInWithOtp({ email });
// on load: const { data:{ session } } = await supabase.auth.getSession();
// show the app if session exists, else a single email input + "Send me a link".
```

5. `.env.local`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

> Tip: map email → display name once (`you@ → "Adrien"`, `wife@ → her name`) so the
> "added by" pill and the owner sort populate themselves. Neither of you ever tags manually.

---

## 4. Deploy free — ~5 min

1. Push to a private GitHub repo.
2. Import it on **Vercel** (free). It auto-detects Vite and the `api/` function.
3. Add the two env vars in Vercel project settings.
4. Copy the deployed URL back into Supabase → Auth → URL Configuration.
5. Done. Each of you visits the URL, types your email, clicks the link in your inbox, you're in.

---

## Later: map view

You already store `location` as text. To map:
- Geocode address → lat/long once on save (free: Nominatim / OpenStreetMap, rate-limited but
  fine for two people), store `lat`/`lng` columns.
- Render with **Leaflet** + OpenStreetMap tiles (free, no key). A toggle between grid and map
  is ~40 lines. We can do this as a second pass once the core is live.

---

## What I'd watch

- **Scraping breakage** is the one thing that *will* age. When a site changes layout the
  enrichment quietly returns less; the manual fields absorb it, so it degrades gracefully
  rather than breaking. Don't over-invest in the regex.
- **Supabase free tier pauses** a project after ~1 week of zero activity. For an active
  house search that won't bite; if you pause the search for a month, the first visit back
  just needs a click to unpause.
