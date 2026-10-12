-- House — full schema for one couple's space.
--
-- New space: create a Supabase project, replace the two emails below
-- (__EMAIL_1__ / __EMAIL_2__, every occurrence), run this whole file in the SQL Editor.
-- Idempotent: safe to re-run. Keep it in sync with every schema change, and run
-- each change on every project (each deployment has its own database).

-- ---------------------------------------------------------------- listings
create table if not exists listings (
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
  lat float8,
  lng float8,
  archived_at timestamptz,   -- null = active
  contacted_at timestamptz,  -- "Agence contactée"
  visited_at timestamptz,    -- "Visitée"
  created_at timestamptz default now()
);
alter table listings enable row level security;

drop policy if exists "household read" on listings;
create policy "household read" on listings for select
  using (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));
drop policy if exists "household write" on listings;
create policy "household write" on listings for insert
  with check (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));
drop policy if exists "household update" on listings;
create policy "household update" on listings for update
  using (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'))
  with check (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));
drop policy if exists "household delete" on listings;
create policy "household delete" on listings for delete
  using (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));

-- --------------------------------------------------------------- reactions
create table if not exists reactions (
  listing_id uuid references listings(id) on delete cascade,
  user_name text not null,
  reaction text not null check (reaction in ('dislike','like','love')),
  primary key (listing_id, user_name)
);
alter table reactions enable row level security;
drop policy if exists "household all" on reactions;
create policy "household all" on reactions for all
  using (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'))
  with check (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));

-- ---------------------------------------------------------------- comments
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz default now()
);
alter table comments enable row level security;
drop policy if exists "household all" on comments;
create policy "household all" on comments for all
  using (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'))
  with check (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));

-- ------------------------------------------------------ push_subscriptions
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_email text unique not null,
  subscription jsonb not null,
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists "household read" on push_subscriptions;
create policy "household read" on push_subscriptions for select
  using (auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));
drop policy if exists "household insert" on push_subscriptions;
create policy "household insert" on push_subscriptions for insert
  with check (auth.jwt() ->> 'email' = user_email);
drop policy if exists "household update" on push_subscriptions;
create policy "household update" on push_subscriptions for update
  using (auth.jwt() ->> 'email' = user_email);

-- ------------------------------------------------- screenshots (storage)
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;
drop policy if exists "household upload screenshots" on storage.objects;
create policy "household upload screenshots" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'screenshots' and auth.jwt() ->> 'email' in ('__EMAIL_1__','__EMAIL_2__'));

-- ---------------------------------------------------------------- realtime
do $$
declare t text;
begin
  foreach t in array array['listings','reactions','comments'] loop
    if not exists (
      select 1 from pg_publication_rel r
      join pg_publication p on p.oid = r.prpubid
      join pg_class c on c.oid = r.prrelid
      where p.pubname = 'supabase_realtime' and c.relname = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
