# learnmcp — Claude Code plugin

This plugin is what makes learnmcp **live in your session**. It's two small,
dependency-free scripts plus four slash commands — no build step, no sibling package,
because a marketplace install only ever ships this directory.

## How it fits together

```
Claude Code
  │
  ├─ hooks/learnmcp-hook.mjs ───── POST signals ────┐
  │    SessionStart      → scan the project          │
  │    UserPromptSubmit  → catch slash commands       ▼
  │    PostToolUse       → catch tool calls    https://learnmcp.ai/mcp
  │                                                    ▲
  ├─ hooks/mcp-proxy.mjs ───────── tools/call ─────────┘
  │    (this is what .mcp.json actually spawns)
  │
  └─ commands/ → /learn /badges /progress /cartridges /cartridge
       (call the tools mcp-proxy exposes)
```

Progress lives entirely on the hosted server, not on this machine. Both scripts share one
identity: the first call mints an anonymous learner and saves a bearer token to
`~/.learnmcp/token`; every call after that sends it. That file is the only local state
this plugin keeps.

**Why two scripts instead of one.** Claude Code's actual MCP client — the thing the model
calls tools through — has no way to attach a custom header to a `type: "http"` server
declaration, and no way to persist a token the server hands back. So `mcp-proxy.mjs` exists
purely to bridge that gap: it's a local stdio MCP server that reads the same token file and
forwards every request over HTTP with the right `Authorization` header. Without it,
interactive tool calls (you asking "what's my progress?") and passive hook-driven signals
would be two different, disconnected identities.

## What's in here

- **`.claude-plugin/plugin.json`** — the plugin manifest.
- **`.mcp.json`** — spawns `hooks/mcp-proxy.mjs` as the `learnmcp` MCP server (`learn_next`,
  `record_activity`, `list_badges`, `progress`, `my_progress`, `leaderboard`,
  `list_cartridges`, `add_cartridge`, `generate_cartridge`, `claim_profile`, …).
- **`hooks/hooks.json`** — the passive-monitoring layer, all running `learnmcp-hook.mjs`:
  - `SessionStart` → scans the project *and your installed plugins* (a plugin-supplied MCP
    server is invisible to a project-only scan), then shows a one-line progress summary.
  - `UserPromptSubmit` → catches slash commands. Most plugins expose their value as
    commands rather than MCP tools — `/postman:mock` is a command, not an
    `mcp__postman__mock` call — so without this the whole surface is invisible.
  - `PostToolUse` (Bash / Edit / Write / Skill / SlashCommand / MCP tools) → records the
    resulting signal and, when you earn something, prints it.
- **`commands/`** — `/learn`, `/badges`, `/progress`, `/cartridges`, `/cartridge`.

Neither script imports anything beyond Node built-ins, and neither depends on
`@learnmcp/server` — that package is the portable core used by the *hosted* server and by
anyone running learnmcp from source (see [RUNNING.md](../../RUNNING.md)), but this plugin
doesn't need it installed to work.

## Install

```bash
claude plugin marketplace add quintonwall/learnmcp
claude plugin install learnmcp@quintonwall
```

Restart Claude Code. On the next session start you'll see learnmcp check in; use a tool it
knows (add an MCP server, run `npx playwright test`, run a Postman command, …) and watch
the badges roll in. `/badges` and `/progress` any time.

By default it talks to `https://learnmcp.ai`. Point `LEARNMCP_URL` at a self-hosted
deployment instead, or set `LEARNMCP_LOCAL=1` to opt out of sending anything — see the
[main README](../../README.md) and [HOSTING.md](../../HOSTING.md).

## Releasing a change to this plugin

`claude plugin update` compares **versions, not content** — editing a hook without bumping
`version` in both `.claude-plugin/plugin.json` and the matching entry in the repo root's
`.claude-plugin/marketplace.json` means every installed copy silently stays on the old
code. CI fails if the two disagree. See [RUNNING.md](../../RUNNING.md#staying-up-to-date).
