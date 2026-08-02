# learnmcp — web app

Next.js (App Router) app with two jobs: the public gallery/leaderboard, **and** the hosted
remote MCP server itself — `app/mcp/route.ts` is what `learnmcp.ai/mcp` runs.

## Runs with or without a backend

- **No env vars** → the gallery reads the repo's own bundled `cartridges/` directory from
  disk (the same registry the MCP server reads from GitHub), the leaderboard shows a
  "connect Supabase" notice, and `/mcp` returns a 503. Fine for local dev of the gallery —
  no backend to stand up.
- **With `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`** → the gallery adds
  real install/popularity counts per cartridge, and the leaderboard shows real rankings —
  both read-only, via the anon key.
- **With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `GITHUB_TOKEN`** → `/mcp` comes
  alive: it mints anonymous learners, records their progress, and serves the cartridge
  registry pulled live from GitHub. This is server-only; the service_role key must never
  reach the browser. See [`../../HOSTING.md`](../../HOSTING.md) for the full variable list
  and why each is needed.

## Develop

```bash
npm install                 # from the repo root (installs all workspaces)
cp packages/web/.env.example packages/web/.env.local   # see the file for what each var enables
npm run dev  --workspace @learnmcp/web
# or: npm run build --workspace @learnmcp/web && npm run start --workspace @learnmcp/web
```

## Structure

- `app/` — routes: `/` (overview + platform stats), `/cartridges` (gallery), `/leaderboard`,
  `/submit` (contribute-a-cartridge validator + PR guide), `/mcp` (the remote MCP server)
- `lib/data.ts` — data layer with the Supabase-or-bundled fallback
- `lib/supabase.ts` — client factory (returns `null` when unconfigured)

`/submit` validates pasted cartridge JSON against `@learnmcp/schema` **in the browser** —
the same validator the engine uses — then walks through opening a PR. There's no
submission queue: the registry is the `cartridges/` directory in this repo, and a PR
merging *is* publishing.
