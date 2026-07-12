-- Per-cartridge leaderboards.
-- user_badges is RLS-private (each user reads only their own), so it can't back a public
-- board. Mirror the pattern used for the global board: a public, denormalized scores
-- table that sync maintains, plus a ranked view over it.

create table if not exists cartridge_scores (
  user_id      uuid not null references auth.users(id) on delete cascade,
  cartridge_id text not null,
  handle       text,
  points       int  not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, cartridge_id)
);

create or replace view cartridge_leaderboard as
  select
    cartridge_id,
    user_id,
    handle,
    points,
    row_number() over (partition by cartridge_id order by points desc, updated_at asc) as position
  from cartridge_scores
  where points > 0;

alter table cartridge_scores enable row level security;

-- Public read (for the board); each user writes only their own scores.
create policy cscores_read_all on cartridge_scores for select using (true);
create policy cscores_insert_own on cartridge_scores
  for insert with check (user_id = auth.uid());
create policy cscores_update_own on cartridge_scores
  for update using (user_id = auth.uid());
