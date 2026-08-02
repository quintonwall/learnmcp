# Walkthrough: learning Postman with learnmcp

The full loop, start to finish, using the official **Postman Claude Code plugin**. Twenty
minutes gets you a dozen badges and a working API.

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
> Active learning tracks: **postman (0/13)**.
> Suggested next: **Send a request against your API** — Seeing a real response is the
> fastest way to find out your API doesn't behave the way the spec claims.

It read your installed plugins, saw Postman's MCP server, and loaded the matching
cartridge. Nothing in your repo mentions Postman and you configured nothing.

You also just earned **Plugged In** 🥉 from the always-on `general` cartridge, for adding
your first MCP server.

---

## 2. Work the track

You don't run commands — you just ask for what you want, the way you'd ask a colleague.
Claude decides whether that means running a `/postman:…` command or calling an MCP tool
directly; learnmcp catches it either way, so the badge fires regardless of which one it
picked. Roughly first-run to advanced:

### "Can you send a GET request to /users and show me the response?" → **First Contact** 🥉

### "Generate an OpenAPI spec for this codebase" → **Spec Author** 🥉

> learnmcp — 🏅 **Spec Author** (+10) · ✅ Generate an OpenAPI spec from your codebase
> · Initiate · 20 pts (80 to Apprentice) · Next: **Search for an existing API before
> building your own**

### "Is there already a Stripe collection I can use instead of building this myself?" → **Scout** 🥉

The integration you're about to hand-roll may already exist as a maintained collection.

### "Turn that spec into a Postman collection" → **Single Source** 🥉

Keeps the spec and your requests from drifting apart.

### "Spin up a mock server for this API so the frontend team can start building" → **Great Pretender** 🥉

### "Save an example response on this request" → **Exemplary** 🥉

There's no `/postman:` command for this one — Claude just calls the `createCollectionResponse`
tool directly. Examples are what your mock server returns and what your published docs
show, so without them both are empty shells.

### "Move the base URL and API key into an environment instead of hardcoding them" → **Environmentalist** 🥈

Also MCP-only, no slash command behind it. Hardcoded hosts and tokens in requests leak into
git and make the same collection unusable against staging.

### "Run my collection as a test suite" → **Test Runner** 🥉

Do this ten times over the life of the project and it upgrades to **Marathoner** 🥇.

### "Audit this API against the OWASP API Top 10" → **Locked Down** 🥈

### "Publish documentation for this API" → **Documentarian** 🥉

### "Trigger my onboarding Flow" → **Flow State** 🥇

Chaining calls in a Flow beats a scratch script nobody else can run or debug.

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
of a tool that can't be tracked one single way — and it's *why* asking naturally in §2 above
works at all rather than requiring you to memorize command names.

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

The installed plugin's hook is a plain script — you can drive it directly to see
detection work, against your real hosted progress:

```bash
cd ~/.claude/plugins/cache/quintonwall/learnmcp/*/

# a slash command
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/postman:mock"}' \
  | node hooks/learnmcp-hook.mjs post-tool-use

# the MCP tool underneath it
echo '{"tool_name":"mcp__postman__createMock","tool_input":{}}' \
  | node hooks/learnmcp-hook.mjs post-tool-use

# the CLI path
echo '{"tool_name":"Bash","tool_input":{"command":"postman collection run abc"}}' \
  | node hooks/learnmcp-hook.mjs post-tool-use
```

Each prints the JSON the hook feeds back to Claude Code — a `systemMessage` when
something is newly earned, nothing when it's already been credited. Since this talks to
your real hosted learner, use a throwaway `HOME` to try things without touching your
actual progress: prefix any of the above with `HOME=$(mktemp -d)`.
