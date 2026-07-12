-- learnmcp initial schema
-- Cartridges are public-read; a user's progress is private to that user.
-- Everything keys off auth.uid() so RLS can enforce ownership.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Cartridges (public registry) + versions
-- ---------------------------------------------------------------------------
create table if not exists cartridges (
  id            text primary key,               -- kebab-case cartridge id (e.g. "postman")
  name          text not null,
  provider      text not null,
  homepage      text,
  icon          text,
  trust         text not null default 'community'
                  check (trust in ('official','community','generated')),
  latest_version text not null,
  install_count int  not null default 0,
  submitted_by  uuid references auth.users(id) on delete set null,
  approved      boolean not null default false, -- moderation gate for community cartridges
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists cartridge_versions (
  cartridge_id text not null references cartridges(id) on delete cascade,
  version      text not null,
  -- the full validated cartridge document (matches @learnmcp/schema)
  document     jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (cartridge_id, version)
);

-- ---------------------------------------------------------------------------
-- Per-user progress
-- ---------------------------------------------------------------------------
-- One row per user: their global points + rank snapshot (denormalized for the board).
create table if not exists user_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  handle      text unique,
  points      int  not null default 0,
  rank        text not null default 'Novice',
  updated_at  timestamptz not null default now()
);

create table if not exists user_badges (
  user_id      uuid not null references auth.users(id) on delete cascade,
  cartridge_id text not null,
  badge_id     text not null,
  name         text not null,
  points       int  not null default 0,
  earned_at    timestamptz not null default now(),
  primary key (user_id, cartridge_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- Leaderboard (points-ranked) — a view so it always reflects current profiles
-- ---------------------------------------------------------------------------
create or replace view leaderboard as
  select
    row_number() over (order by points desc, updated_at asc) as position,
    user_id,
    handle,
    points,
    rank
  from user_profiles
  order by points desc;

-- ---------------------------------------------------------------------------
-- Install counter (atomic; callable by anyone to record adoption)
-- ---------------------------------------------------------------------------
create or replace function increment_install(p_cartridge_id text)
returns void language sql security definer as $$
  update cartridges set install_count = install_count + 1, updated_at = now()
  where id = p_cartridge_id;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table cartridges         enable row level security;
alter table cartridge_versions enable row level security;
alter table user_profiles      enable row level security;
alter table user_badges        enable row level security;

-- Cartridges: anyone can read approved ones; authors can read/write their own drafts.
create policy cartridges_read_approved on cartridges
  for select using (approved or submitted_by = auth.uid());
create policy cartridges_insert_own on cartridges
  for insert with check (submitted_by = auth.uid());
create policy cartridges_update_own on cartridges
  for update using (submitted_by = auth.uid());

create policy versions_read on cartridge_versions
  for select using (
    exists (select 1 from cartridges c
            where c.id = cartridge_id and (c.approved or c.submitted_by = auth.uid()))
  );
create policy versions_insert_own on cartridge_versions
  for insert with check (
    exists (select 1 from cartridges c
            where c.id = cartridge_id and c.submitted_by = auth.uid())
  );

-- Profiles: public read (for the leaderboard); only you write your own.
create policy profiles_read_all on user_profiles for select using (true);
create policy profiles_upsert_own on user_profiles
  for insert with check (user_id = auth.uid());
create policy profiles_update_own on user_profiles
  for update using (user_id = auth.uid());

-- Badges: only you read/write your own.
create policy badges_rw_own on user_badges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
