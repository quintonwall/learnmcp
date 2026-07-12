# learnmcp — web app

Next.js (App Router) app for the public side of learnmcp: the cartridge gallery, the
points-ranked leaderboard, and cartridge submission.

## Runs with or without a backend

- **No env vars** → the gallery reads the repo's **bundled first-party cartridges** from
  disk, and the leaderboard shows a "connect Supabase" notice. Great for local dev — no
  backend to stand up.
- **With Supabase** (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`) → the
  gallery reads the live registry (install counts, community cartridges) and the
  leaderboard shows real rankings synced from developers' sessions (see
  [`supabase/migrations`](../../supabase/migrations) for the schema).

## Develop

```bash
npm install                 # from the repo root (installs all workspaces)
cp packages/web/.env.example packages/web/.env.local   # optional — for Supabase
npm run dev  --workspace @learnmcp/web
# or: npm run build --workspace @learnmcp/web && npm run start --workspace @learnmcp/web
```

## Structure

- `app/` — routes: `/` (overview), `/cartridges` (gallery), `/leaderboard`, `/submit`
- `lib/data.ts` — data layer with the Supabase-or-bundled fallback
- `lib/supabase.ts` — client factory (returns `null` when unconfigured)

The submit form validates pasted cartridge JSON against `@learnmcp/schema` **in the
browser** before submission — the same validator the engine uses — so invalid cartridges
never reach the moderation queue.
