# Running & deploying learnmcp

Maintainer guide — building the packages, running the MCP server, applying the Supabase
schema, and deploying the web app. If you just want to *use* learnmcp in your own coding
sessions, see the **Using it** section of the [README](README.md) instead.

## Prerequisites

- Node 20+ (developed on 25). No native modules — the store uses Node's built-in
  `node:sqlite`.
- npm (workspaces).

## Staying up to date

Four things ship on different clocks. Only one needs you to do anything.

| What | How it updates |
|---|---|
| **Cartridges** | Automatic. Read from GitHub at runtime; a merged PR is live within 5 minutes (sooner on a cold start). No deploy. |
| **The server** (learnmcp.ai) | Automatic. Vercel builds on every push to `main`. |
| **The plugin** (hooks, commands, `.mcp.json`) | **Manual** — see below. |
| **A local checkout** | `git pull && npm install && npm run build` |

### Releasing a plugin change

`claude plugin update` compares **versions, not content**. Change a hook without bumping
the version and it reports "already at the latest version" — every installed copy stays
stale, silently. So a plugin change is only released once you:

1. Bump `version` in **both**
   [`packages/plugin/.claude-plugin/plugin.json`](packages/plugin/.claude-plugin/plugin.json)
   and the matching entry in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).
   CI fails if the two disagree.
2. Push to `main`.

Users then pick it up with:

```bash
claude plugin marketplace update quintonwall   # refresh the marketplace clone
claude plugin update learnmcp@quintonwall      # install the new version
```

and a restart of Claude Code. Nothing about the *server* or *cartridges* needs this — only
files that live inside the plugin directory.

## Build & test

```bash
npm install
npm run build   # compiles every workspace (schema, server, and the Next.js web app)
npm test        # 77 tests: evaluator, ranks, registry hot-loading, store/service,
                # hooks, sync, generation, and all 8 first-party cartridges
```

`@learnmcp/server` depends on the compiled `@learnmcp/schema`, so build schema first if you
build packages individually (`npm run build --workspace @learnmcp/schema`).

## Run the MCP server (stdio)

The binary is `packages/server/dist/bin.js` (exposed as `learnmcp-server`). Configure it
with env vars:

| Var | Purpose | Default |
|---|---|---|
| `LEARNMCP_PROJECT` | Project dir = progress scope | cwd |
| `LEARNMCP_DB` | SQLite path | `~/.learnmcp/state.sqlite` |
| `LEARNMCP_CARTRIDGES` | Extra cartridge dirs (`:`-separated, highest precedence) | — |
| `LEARNMCP_SERVER_URL` | Supabase project URL — enables sync ([HOSTING.md](HOSTING.md)) | — |
| `LEARNMCP_SERVER_KEY` | Access token for that project | — |
| `LEARNMCP_USER_ID` | Your `auth.users` UUID | — |
| `LEARNMCP_HANDLE` | Leaderboard display name | — |

Sync is off unless the first three server vars are all set; everything else works offline.

```bash
node packages/server/dist/bin.js
```

Cartridge sources load in precedence order: project `.learnmcp/cartridges/` → user
`~/.learnmcp/cartridges/` → registry cache → the repo's bundled `cartridges/`. A filesystem
watcher hot-reloads any of them without a restart.

## The hook CLI

The Claude Code plugin's hooks shell out to `packages/server/dist/cli.js`. You can drive it
directly:

```bash
# session-start: scan a project, emit the progress summary + next suggestion
echo '{"hook_event_name":"SessionStart","cwd":"'$PWD'"}' | node packages/server/dist/cli.js session-start

# post-tool-use: record a tool use (earns badges passively)
echo '{"tool_name":"Bash","tool_input":{"command":"npx playwright test"},"cwd":"'$PWD'"}' \
  | node packages/server/dist/cli.js post-tool-use

# user-prompt-submit: a slash command counts as a command signal
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/postman:mock","cwd":"'$PWD'"}' \
  | node packages/server/dist/cli.js post-tool-use

# record a raw signal / scan a directory / push to the server
node packages/server/dist/cli.js record '{"kind":"mcp.added","server":"postman"}'
node packages/server/dist/cli.js scan .
node packages/server/dist/cli.js sync
```

## Generate a cartridge from a docs URL

Needs an Anthropic API key (read from the environment — never commit it):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node packages/server/dist/cli.js generate https://www.postman.com/docs
```

The result is written to `~/.learnmcp/cartridges/<id>.json` as `trust: "generated"` and
hot-loaded. Also available as the `generate_cartridge` MCP tool.

## Supabase

Applying the schema, seeding cartridges, connecting clients, and moderating the registry
all live in **[HOSTING.md](HOSTING.md)**.

## The web app

```bash
cp packages/web/.env.example packages/web/.env.local   # add the Supabase URL + anon key
npm run dev   --workspace @learnmcp/web                 # http://localhost:3000
npm run build --workspace @learnmcp/web && npm run start --workspace @learnmcp/web
```

Without Supabase env vars the gallery falls back to the bundled cartridges and the
leaderboard shows a "connect Supabase" notice — so it runs with zero backend. Deploy to
Vercel (or any Node host); set the two `NEXT_PUBLIC_SUPABASE_*` vars in the host's
environment.
