# learnmcp — Claude Code plugin

This plugin is what makes learnmcp **live in your session**. It wraps the portable
[`@learnmcp/server`](../server) MCP server with the one thing MCP alone can't do —
**hooks for passive monitoring** — plus slash commands.

## How it fits together

```
Claude Code
  │
  ├─ hooks (this plugin) ───────────────┐   writes signals
  │    SessionStart  → learnmcp scan     │
  │    PostToolUse   → learnmcp record   ▼
  │                                  ┌──────────────┐
  │                                  │  SQLite store│  (~/.learnmcp/state.sqlite, WAL)
  │                                  └──────────────┘
  ├─ MCP server (this plugin) ───────────▲   reads for the model
  │    learn_next / list_badges / progress / …
  │
  └─ slash commands → call those MCP tools
```

The key idea: **hooks write, MCP tools read.** Hooks are short-lived processes and can't
call MCP tools, so they translate Claude Code events into signals and write them straight
to the same SQLite store the MCP server reads. That's how badges get earned *passively*
as you work, while `/learn` and `/badges` surface progress to the model on demand.

## What's in here

- **`.claude-plugin/plugin.json`** — the plugin manifest.
- **`.mcp.json`** — bundles the `learnmcp` MCP server (`learn_next`, `record_activity`,
  `list_badges`, `progress`, `scan_project`, `reload_cartridges`, …).
- **`hooks/hooks.json`** — the passive-monitoring layer:
  - `SessionStart` → `learnmcp session-start`: scans the project *and your installed
    plugins* (a plugin-supplied MCP server is invisible to a project-only scan), then
    injects a progress summary + next suggestion as session context.
  - `UserPromptSubmit` → `learnmcp post-tool-use`: catches slash commands. Most plugins
    expose their value as commands rather than MCP tools — `/postman:mock` is a command,
    not an `mcp__postman__mock` call — so without this the whole surface is invisible.
  - `PostToolUse` (Bash / Edit / Write / Skill / SlashCommand / MCP tools) →
    `learnmcp post-tool-use`: records the resulting signal and, when you earn something,
    surfaces it as a system message.
- **`commands/`** — `/learn`, `/badges`, `/progress`, `/cartridge`.

Both the hook commands and the MCP server come from `@learnmcp/server`'s compiled `dist/`,
referenced via `${CLAUDE_PLUGIN_ROOT}/../server/dist/…`. Build it first:

```bash
npm run build   # from the repo root — compiles @learnmcp/server
```

## Install (local / dev)

From the repo root, add this directory as a plugin (via a marketplace entry or a local
plugin path in your Claude Code settings), then restart Claude Code. On the next session
start you'll see learnmcp pick up your project; use a tool it knows (add the Postman MCP,
run `npx playwright test`, edit `.gitignore`, …) and watch the badges roll in. Check
`/badges` and `/progress` anytime.

> Passive monitoring (hooks) is Claude-Code-only. Codex uses the same MCP server via
> `scan_project` + tool calls — see the [implementation plan](../../requirements/implementation-plan.md).
