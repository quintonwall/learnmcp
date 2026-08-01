# Walkthrough: learning Postman with learnmcp

The full loop, start to finish, using the official **Postman Claude Code plugin**. Twenty
minutes gets you eight badges and a working API.

New to learnmcp? Install it first — see the [README](README.md).

---

## Setup

```bash
claude plugin install postman@claude-plugins-official
```

Restart Claude Code, then authenticate:

```
/postman:setup
```

---

## 1. learnmcp finds the track by itself

Start a session in the project you're working on. Before you do anything Postman-related:

> learnmcp is tracking this project. Rank Initiate · 10 pts · 1 badges.
> Active learning tracks: **postman (0/8)**.
> Suggested next: **Generate an OpenAPI spec from your codebase** — A spec makes your API
> documented, mockable, and testable.

It read your installed plugins, saw Postman's MCP server, and loaded the matching
cartridge. Nothing in your repo mentions Postman and you configured nothing.

You also just earned **Plugged In** 🥉 from the always-on `general` cartridge, for adding
your first MCP server.

---

## 2. Work the track

Each step is a Postman command. Run it, and the badge fires on its own.

### Generate a spec → **Spec Author** 🥉

```
/postman:generate-spec
```

> learnmcp — 🏅 **Spec Author** (+10) · ✅ Generate an OpenAPI spec from your codebase
> · Initiate · 10 pts (90 to Apprentice) · Next: **Sync your spec to a Postman collection**

### Sync it to a collection → **Single Source** 🥉

```
/postman:sync
```

Keeps the spec and your requests from drifting apart.

### Stand up a mock → **Great Pretender** 🥉

```
/postman:mock
```

The frontend can now build against realistic responses before the API exists.

### Run it as tests → **Test Runner** 🥉

```
/postman:run-collection
```

Do this ten times over the life of the project and it upgrades to **Marathoner** 🥇.

### Publish the docs → **Documentarian** 🥉

```
/postman:docs
```

### Audit it → **Locked Down** 🥈

```
/postman:security
```

Checks against the OWASP API Top 10. Silver, because it's worth more than the rest.

### The gold one → **Agent-Ready** 🥇

This one you can't earn by running a command. It asks a question no regex can answer:

> *"Do the operations have clear summaries/descriptions and named, described parameters
> suitable for an AI agent to call?"*

learnmcp reads your `openapi.yaml` and has an LLM score it against that rubric, gated at
0.8 confidence. A thin spec sits **pending** indefinitely — no partial credit. Flesh out
your summaries and parameter descriptions and it clears.

Postman's own `/postman:agent-ready-apis` skill targets the same bar, so run that first.

### The one you earn by not screwing up

`POSTMAN_API_KEY` staying out of git is tracked as a best practice. No badge — just a nudge
if it ever shows up in a committed file.

---

## 3. Check in

```
/badges       # everything earned, by tier
/progress     # rank, points, how far to the next one
/learn        # just tell me the next thing
```

---

## How the detection actually works

Worth understanding if you're writing your own cartridge, because Postman is a good example
of a tool that can't be tracked one single way.

**A plugin's commands and its MCP tools are different names for the same action.**
`/postman:mock` is a slash command; underneath it calls the MCP tool `createMock`. Match
only one and you miss half the ways a user gets there. So the cartridge accepts either:

```jsonc
"criteria": {
  "anyOf": [
    { "type": "command",  "name": "postman:mock" },
    { "type": "mcp_tool", "server": "postman", "tool": "createMock" },
    { "type": "mcp_tool", "server": "postman", "tool": "publishMock" }
  ]
}
```

**Some actions never touch an MCP tool at all.** `/postman:run-collection` shells out to
the Postman CLI, so a `bash` matcher is the only thing that sees it:

```jsonc
{ "type": "bash", "matches": "postman\\s+collection\\s+run" }
```

**And some have no tool of their own.** `/postman:security` is composed from generic reads
(`getWorkspaces`, `getAllSpecs`, `getSpecDefinition`) that any other command might also
call — matching those would hand out the badge for unrelated work. The command invocation
itself is the only trustworthy signal.

The full cartridge is [`cartridges/postman/postman.json`](cartridges/postman/postman.json),
and the walkthrough above is executed as tests in
[`packages/server/test/detection.test.ts`](packages/server/test/detection.test.ts) —
including a guard that every tool name it references is one the Postman MCP really exposes.

---

## Try it without touching Postman

You can drive the hooks directly to see detection work:

```bash
export LEARNMCP_DB=/tmp/learnmcp-demo.sqlite

# a slash command
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/postman:mock","cwd":"'$PWD'"}' \
  | node packages/server/dist/cli.js post-tool-use

# the MCP tool underneath it
echo '{"tool_name":"mcp__postman__createMock","tool_input":{},"cwd":"'$PWD'"}' \
  | node packages/server/dist/cli.js post-tool-use

# the CLI path
echo '{"tool_name":"Bash","tool_input":{"command":"postman collection run abc"},"cwd":"'$PWD'"}' \
  | node packages/server/dist/cli.js post-tool-use
```

Each prints the JSON the hook feeds back to Claude Code. Clean up with
`rm $LEARNMCP_DB*`, or `rm ~/.learnmcp/state.sqlite` to reset your real progress.
