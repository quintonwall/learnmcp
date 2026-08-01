# Deploying learnmcp

Standing up your own learnmcp: a Supabase database for progress, and a Vercel deploy that
serves both the remote MCP endpoint and the web gallery.

You don't need this to *use* learnmcp — the plugin points at the hosted instance by
default, and `LEARNMCP_LOCAL=1` keeps everything on your own machine.

---

## What you're deploying

```
Claude Code
  ├─ plugin hooks ──── POST signals ────┐
  └─ MCP client ────── tools/call ──────┤
                                        ▼
                          https://<you>.vercel.app/mcp
                            (packages/web/app/mcp/route.ts)
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
                     Supabase                  GitHub cartridges/
                (learners, badges,           (the registry — PRs,
                 points, leaderboards)        no redeploy needed)
```

Cartridges come from GitHub, not the database. The database only holds *people* — who
learned what, and how many points they have.

---

## 1. Supabase

Create a project, then **SQL Editor** → run these in order:

| Migration | What it creates |
|---|---|
| [`0001_init.sql`](supabase/migrations/0001_init.sql) | base tables + `auth` wiring |
| [`0002_cartridge_leaderboard.sql`](supabase/migrations/0002_cartridge_leaderboard.sql) | per-cartridge scores |
| [`0003_remote_mcp.sql`](supabase/migrations/0003_remote_mcp.sql) | **the one that matters** — `learners`, progress tables, leaderboard views, `claim_learner` |

Or with the CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

Then grab both keys from **Project Settings → API**:

- **anon** — public, RLS-gated, safe in the browser
- **service_role** — bypasses RLS entirely; the MCP server needs it, and it must never
  reach the browser or git

### Why the server needs service_role

Learner rows are deny-all under RLS: the MCP server writes progress on behalf of everyone,
including anonymous learners who have no `auth.uid()` at all. The anon key can read the
leaderboard views and nothing else — in particular it can never read `token_hash`.

---

## 2. Vercel

[`vercel.json`](vercel.json) is already set up for the monorepo — it builds the two
workspace packages before the Next.js app, which is required because the MCP route imports
them.

```bash
npm i -g vercel
vercel link
vercel --prod
```

Or import the repo in the Vercel dashboard. **Leave the root directory as the repo root** —
don't set it to `packages/web`, or the workspace build won't run.

### Environment variables

Set these in **Project Settings → Environment Variables**:

| Var | Value | Why |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key | writes progress for every learner |
| `NEXT_PUBLIC_SUPABASE_URL` | same URL | the web gallery |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key | the web gallery |
| `GITHUB_TOKEN` | a fine-grained PAT, public-repo read | **see below** |
| `NEXT_PUBLIC_WEB_URL` | `https://<you>.vercel.app` | used in the claim link |

**`GITHUB_TOKEN` is not optional in practice.** Unauthenticated GitHub allows 60 requests
per hour *per IP*, and every learner's cartridge refresh comes from your server's IP — so
one shared budget for everyone. A token raises it to 5,000/hour. Without it the registry
will rate-limit almost immediately and the server will serve a stale cache.

### Verify

```bash
curl -sS -X POST https://<you>.vercel.app/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
```

A 503 with `learnmcp server is not configured` means the two `SUPABASE_*` server vars
aren't set. A tool list means you're live.

Then check a learner was minted:

```sql
select id, points, handle, created_at from learners order by created_at desc limit 5;
```

---

## 3. Point clients at it

The plugin defaults to `https://learnmcp-chi.vercel.app/mcp`. For your own deployment, either:

**Set `LEARNMCP_URL`** in `~/.claude/settings.json` — this reaches both the MCP client and
the hooks:

```json
{ "env": { "LEARNMCP_URL": "https://<you>.vercel.app/mcp" } }
```

**Or change the default** in
[`packages/server/src/remoteClient.ts`](packages/server/src/remoteClient.ts)
(`DEFAULT_REMOTE_URL`) and [`packages/plugin/.mcp.json`](packages/plugin/.mcp.json), then
publish your own marketplace entry.

---

## Operating it

### Adding a cartridge

Merge a PR into `cartridges/`. Instances refresh within their cache TTL (5 minutes on a
warm Vercel instance, immediately on a cold start). Nothing to redeploy.

There's no moderation queue — the PR review *is* the moderation. Review matchers, not just
metadata: a cartridge can't execute code, but a sloppy one can hand out badges for nothing,
and an `llm_judge` rubric is free text that reaches a model.

### Useful queries

```sql
-- who's winning
select * from learner_leaderboard limit 20;

-- which cartridges people actually use
select * from cartridge_popularity order by learners desc;

-- how many have claimed vs stayed anonymous
select count(*) filter (where user_id is not null) as claimed,
       count(*) filter (where user_id is null)     as anonymous
from learners;

-- reset one learner
delete from learner_badges where learner_id = '<uuid>';
delete from learner_signals where learner_id = '<uuid>';
update learners set points = 0, rank = 'Novice' where id = '<uuid>';
```

### Costs

Supabase free tier covers a lot — rows are small and writes are batched one round trip per
tool call. The MCP route is a Node serverless function capped at 30s. The real scaling
concern is GitHub rate limits, which the token handles.

---

## Known gaps

- **The `/claim` page doesn't exist.** `claim_profile` returns a URL to
  `<web>/claim?learner=<id>`, but nothing serves it. Claiming needs that page to sign the
  user in with GitHub and call `claim_learner` with the service_role key. Until then
  everyone stays anonymous — which works, they just show as `learner-7f3c`.
- **Migrations 0001/0002 are partly vestigial.** Their `cartridges` and `user_profiles`
  tables predate the GitHub registry and the `learners` model. Nothing writes them now.
  They're kept because 0003 builds on the same `auth` setup; a later migration should drop
  the dead tables.
- **No `/claim` page means nobody can be non-anonymous yet.** Everything else works; the
  leaderboard just shows pseudonyms.
