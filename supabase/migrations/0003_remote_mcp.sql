-- learnmcp remote MCP: anonymous-first learners and server-side progress.
--
-- The remote MCP has no access to a user's disk, so everything the local SqliteStore
-- keeps (signals, badges, objectives, judge verdicts) needs a home here, keyed by a
-- learner rather than a project path.
--
-- Identity is anonymous by default: the first tool call mints a learner row and returns a
-- bearer token. Nobody has to create an account before earning a badge. Claiming links
-- that same row to an auth.users identity and puts a handle on the leaderboard.
--
-- Everything here is written by the MCP server with the service_role key, so these tables
-- are RLS-deny-by-default with explicit public read only where a leaderboard needs it.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Learners
-- ---------------------------------------------------------------------------
create table if not exists learners (
  id          uuid primary key default gen_random_uuid(),
  -- sha256 of the bearer token; the raw token is shown once and never stored.
  token_hash  text not null unique,
  handle      text unique,
  -- null until claimed; claiming is what makes a learner non-anonymous.
  user_id     uuid references auth.users(id) on delete set null,
  points      int  not null default 0,
  rank        text not null default 'Novice',
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_learners_points on learners(points desc);
create index if not exists idx_learners_user   on learners(user_id);

-- ---------------------------------------------------------------------------
-- Progress, mirroring the local SqliteStore tables
-- ---------------------------------------------------------------------------
create table if not exists learner_signals (
  id         bigserial primary key,
  learner_id uuid not null references learners(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_signals_learner on learner_signals(learner_id, id);

-- State signals must not inflate counts when a project is re-scanned. Activity signals
-- (bash, mcp_tool, command) are deliberately NOT deduped — repetition is the count, which
-- is what drives `gte` thresholds like the 10-run gold badge.
create unique index if not exists idx_signals_idempotent
  on learner_signals (learner_id, kind, md5(payload::text))
  where kind in ('file','dependency','mcp.added','skill','env');

create table if not exists learner_badges (
  learner_id   uuid not null references learners(id) on delete cascade,
  cartridge_id text not null,
  badge_id     text not null,
  name         text not null,
  points       int  not null default 0,
  earned_at    timestamptz not null default now(),
  primary key (learner_id, cartridge_id, badge_id)
);

create table if not exists learner_objectives (
  learner_id   uuid not null references learners(id) on delete cascade,
  cartridge_id text not null,
  objective_id text not null,
  completed_at timestamptz not null default now(),
  primary key (learner_id, cartridge_id, objective_id)
);

create table if not exists learner_judgements (
  learner_id uuid not null references learners(id) on delete cascade,
  key        text not null,
  confidence real not null,
  primary key (learner_id, key)
);

-- ---------------------------------------------------------------------------
-- Leaderboards
-- ---------------------------------------------------------------------------
-- Anonymous learners still rank — that's the point of anonymous-first — but they show up
-- under a stable pseudonym rather than a real handle.
create or replace view learner_leaderboard as
  select
    row_number() over (order by points desc, created_at asc) as position,
    id as learner_id,
    coalesce(handle, 'learner-' || substr(id::text, 1, 4)) as display_name,
    handle is not null as claimed,
    points,
    rank
  from learners
  where points > 0;

create or replace view learner_cartridge_leaderboard as
  select
    b.cartridge_id,
    row_number() over (
      partition by b.cartridge_id order by sum(b.points) desc, min(b.earned_at) asc
    ) as position,
    l.id as learner_id,
    coalesce(l.handle, 'learner-' || substr(l.id::text, 1, 4)) as display_name,
    sum(b.points)::int as points
  from learner_badges b
  join learners l on l.id = b.learner_id
  group by b.cartridge_id, l.id, l.handle;

-- Cartridge popularity: how many distinct learners have earned anything from each one.
-- This is the number that shows which cartridges are actually being used.
create or replace view cartridge_popularity as
  select
    cartridge_id,
    count(distinct learner_id)::int as learners,
    sum(points)::int as points_awarded,
    max(earned_at) as last_earned_at
  from learner_badges
  group by cartridge_id;

-- ---------------------------------------------------------------------------
-- Claiming: attach an anonymous learner to a signed-in account.
-- ---------------------------------------------------------------------------
-- If the account already has a learner row (a second machine, say), fold the anonymous
-- one into it rather than stranding the progress on a duplicate identity.
create or replace function claim_learner(p_learner_id uuid, p_user_id uuid, p_handle text)
returns uuid language plpgsql security definer as $$
declare
  existing uuid;
begin
  select id into existing from learners
    where user_id = p_user_id and id <> p_learner_id limit 1;

  if existing is null then
    update learners set user_id = p_user_id, handle = p_handle, last_seen_at = now()
      where id = p_learner_id;
    return p_learner_id;
  end if;

  -- Merge: move progress across, ignoring rows the target already has.
  insert into learner_badges select existing, cartridge_id, badge_id, name, points, earned_at
    from learner_badges where learner_id = p_learner_id
    on conflict do nothing;
  insert into learner_objectives select existing, cartridge_id, objective_id, completed_at
    from learner_objectives where learner_id = p_learner_id
    on conflict do nothing;
  insert into learner_judgements select existing, key, confidence
    from learner_judgements where learner_id = p_learner_id
    on conflict do nothing;
  update learner_signals set learner_id = existing where learner_id = p_learner_id;

  update learners set
      points = (select coalesce(sum(points),0) from learner_badges where learner_id = existing),
      handle = coalesce(p_handle, handle),
      last_seen_at = now()
    where id = existing;

  delete from learners where id = p_learner_id;
  return existing;
end;
$$;

-- `security definer` runs as the owner and bypasses RLS, and Postgres grants EXECUTE to
-- PUBLIC by default — which would let any anonymous caller claim someone else's learner
-- by guessing its id. Only the server (service_role) may call it.
revoke execute on function claim_learner(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function claim_learner(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The MCP server holds the service_role key and bypasses all of this. These policies
-- exist so that the anon key (used by the web app) can read boards and nothing else —
-- in particular it must never be able to read token_hash.
alter table learners           enable row level security;
alter table learner_signals    enable row level security;
alter table learner_badges     enable row level security;
alter table learner_objectives enable row level security;
alter table learner_judgements enable row level security;

-- No permissive policies on learners/signals/judgements: deny-all for anon and
-- authenticated. Boards are served by the views below, which don't expose tokens.
drop policy if exists badges_public_read on learner_badges;
create policy badges_public_read on learner_badges for select using (true);

grant select on learner_leaderboard, learner_cartridge_leaderboard, cartridge_popularity
  to anon, authenticated;
