---
name: reclaim-handle
description: Use when a learnmcp user reports "handle already taken", "lost/deleted my token and want my name back", or otherwise can't reclaim a leaderboard handle after their `~/.learnmcp/token` was deleted or overwritten. Walks through diagnosing why (anonymous-first identity, no merge, no recovery by design — see README's "Using more than one machine?" section) and producing the admin-only SQL fix against the `learners` table in Supabase.
---

# Reclaim a learnmcp handle

## Why this happens

learnmcp identity is *only* the bearer token (`packages/server/src/identity.ts`). Deleting or
overwriting `~/.learnmcp/token` doesn't delete a user — it just orphans their old `learners` row
and mints a new one. The handle is still set on the old row, so `claim_profile` (which is just a
`PATCH .../learners?id=eq.<id>` on the unique `handle` column) correctly rejects it as taken.
There is no account layer and no automatic merge — see the README section "Using more than one
machine?" for the user-facing version of this, and `0005_handle_case_insensitive.sql` for the
`lower(handle)` uniqueness rule that also matters here.

This is a **server-side DB fix**, not something the user or `claim_profile` can do themselves.
Only whoever holds the Supabase project (service_role / SQL Editor access) can run it.

## Steps

1. **Get the handle and, if possible, the requester's current `learnerId`.** `my_progress` returns
   `learnerId` for whoever is calling it — ask the requester to run it if they're the one you're
   helping live, so you have the exact id of the row to move the handle *to*.

2. **Find the old row and confirm it's really theirs** before touching anything:
   ```sql
   select id, points, rank, created_at, last_seen_at
   from learners
   where lower(handle) = lower('<handle>');
   ```
   Sanity-check the story against what the requester tells you (roughly when they last used it,
   points/badges in the right ballpark).

3. **Ask which resolution they want** — don't assume:
   - **Just move the handle** (simpler): old row keeps its points/badges but becomes permanently
     unreachable (no token points to it anymore). Fine if the old progress doesn't matter to them
     or their new learner already has progress they don't want to entangle.
   - **Merge into the current learner**: transfer badges/objectives/judgements/signals from the old
     row onto the current one, sum points, delete the old row. Preserves everything. Use this if
     they care about the old row's points/badges too.

4a. **Simple move** — must run as two statements in one transaction (can't set a value that
   still violates the `lower(handle)` unique index in the same statement):
   ```sql
   begin;
   update learners set handle = null where lower(handle) = lower('<handle>');
   update learners set handle = '<handle>' where id = '<current_learner_id>';
   commit;
   ```

4b. **Merge** — same shape as the existing `claim_learner()` function in
   `0003_remote_mcp.sql`, just keyed on learner id instead of `auth.users.id` (this flow has no
   OAuth account to hang it off):
   ```sql
   do $$
   declare
     old_id uuid;
     new_id uuid := '<current_learner_id>';
     the_handle text := '<handle>';
   begin
     select id into old_id from learners where lower(handle) = lower(the_handle);
     if old_id is null then
       raise exception 'no learner currently holds that handle';
     end if;

     insert into learner_badges select new_id, cartridge_id, badge_id, name, points, earned_at
       from learner_badges where learner_id = old_id
       on conflict do nothing;
     insert into learner_objectives select new_id, cartridge_id, objective_id, completed_at
       from learner_objectives where learner_id = old_id
       on conflict do nothing;
     insert into learner_judgements select new_id, key, confidence
       from learner_judgements where learner_id = old_id
       on conflict do nothing;
     update learner_signals set learner_id = new_id where learner_id = old_id;

     update learners set
         points = (select coalesce(sum(points),0) from learner_badges where learner_id = new_id),
         handle = the_handle
       where id = new_id;

     delete from learners where id = old_id;
   end $$;
   ```

5. **Hand the SQL to whoever runs the Supabase SQL Editor** — don't run it yourself unless you
   have a tool wired to that project's DB. Tell them to run step 2 first and eyeball the result
   before running step 4a/4b.

6. **Verify**: have the requester run `my_progress` again and confirm `handle` and `claimed: true`
   are set, and (for a merge) that points/badges reflect the combined total.

## Guardrails

- Never skip the confirm-the-row step (2) — matching purely on a requested handle string with no
  other corroboration risks reassigning someone else's name.
- This is a production data mutation on shared state — treat it like any other destructive DB
  operation: transaction-wrapped, reviewed before running, no blind execution.
- Don't offer this as something `claim_profile` or any other tool can do — by design there is no
  user-facing recovery path. If asked to "just add a recovery feature," that's a product decision
  for the maintainer, not a support fix.
