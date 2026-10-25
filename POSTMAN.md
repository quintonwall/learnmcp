# Walkthrough: learning Postman with learnmcp

The full loop, start to finish, using the official **Postman Claude Code plugin**. Twenty
minutes gets you a dozen badges and a working API.

New to learnmcp? Install it first — see the [README](README.md).

---

## Setup

```bash
claude plugin install postman@claude-plugins-official
```

Or install it into every compatible agent on your machine:

```bash
npx @postman/postman-plugin
```

Restart Claude Code, then sign in to Postman's MCP server with `/mcp`. The plugin is
**skills-based**: it ships a set of skills (`api-mocking`, `api-simulation`,
`api-testing`, …) plus the `postman` MCP server and works with the Postman CLI. There are
no `/postman:…` slash commands to memorize.

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
Claude decides whether that means loading one of the plugin's skills, calling an MCP tool,
or running the Postman CLI; learnmcp catches all three, so the badge fires regardless of
which one it picked. Roughly first-run to advanced:

### "Bootstrap Postman for this repo" → **Grounded** 🥉

The `bootstrap` skill (or `postman init`) binds the repo to a workspace and creates local
API files, so everything after it produces something you can review in Git.

### "Can you send a GET request to /users and show me the response?" → **First Contact** 🥉

### "Generate an OpenAPI spec for this codebase" → **Spec Author** 🥉

> learnmcp — 🏅 **Spec Author** (+10) · ✅ Generate an OpenAPI spec from your codebase
> · Initiate · 20 pts (80 to Apprentice) · Next: **Search for an existing API before
> building your own**

### "Is there already a Stripe collection I can use instead of building this myself?" → **Scout** 🥉

The `api-discovery` skill. The integration you're about to hand-roll may already exist as
a maintained collection.

### "Turn that spec into a Postman collection" → **Single Source** 🥉

Keeps the spec and your requests from drifting apart.

### "Spin up a mock server for this API so the frontend team can start building" → **Great Pretender** 🥉

The `api-mocking` skill.

### "Save an example response on this request" → **Exemplary** 🥉

No skill for this one — Claude just calls the `createCollectionResponse` tool directly.
Examples are what your mock server returns and what your published docs show, so without
them both are empty shells.

### "Move the base URL and API key into an environment instead of hardcoding them" → **Environmentalist** 🥈

The `variables` skill, or the `createEnvironment` tool. Hardcoded hosts and tokens in
requests leak into git and make the same collection unusable against staging.

### "Run my collection as a test suite" → **Test Runner** 🥉

The `api-testing` skill, the `runCollection` tool, or `postman collection run`. Do this ten
times over the life of the project and it upgrades to **Marathoner** 🥇.

### "Drive this collection from a dataset" → **Data Driven** 🥉

### "Audit this API against the OWASP API Top 10" → **Locked Down** 🥈

### "Publish documentation for this API" → **Documentarian** 🥉

The `api-documentation` skill.

### "Run this service against simulated dependencies" → **Simulator** 🥈

The `api-simulation` skill (`postman simulation run`). It runs your code for real against
stand-ins for the HTTP services it calls, so you see how it behaves when a dependency is
slow, wrong or down.

### "Check my Playwright tests' network traffic against the collection" → **Contract Checker** 🥈

The `application-testing` skill (`postman app test`).

### "Monitor this endpoint" → **Watchtower** 🥈

### "Capture and replay webhooks while I debug" → **Hook Catcher** 🥉

### "Load-test this API" → **Load Tester** 🥈

### "Score how ready this API is for AI agents" → **Readiness Assessor** 🥈

The `ai-readiness` skill turns "agents struggle with our API" into a list of specific
contract gaps.

### "Trigger my onboarding Flow" → **Flow State** 🥇

The `flows` skill. Chaining calls in a Flow beats a scratch script nobody else can run or
debug.

### "Gate CI on the collection tests and lint" → **Gatekeeper** 🥇

The `ci-integration` skill. A recommended practice rather than a core objective, but it
earns a badge like the rest.

### The gold one → **Agent-Ready** 🥇

This one you can't earn by running a command. It asks a question no regex can answer:

> *"Do the operations have clear summaries/descriptions and named, described parameters
> suitable for an AI agent to call?"*

learnmcp reads your `openapi.yaml` and has an LLM score it against that rubric, gated at
0.8 confidence. A thin spec sits **pending** indefinitely — no partial credit. Flesh out
your summaries and parameter descriptions and it clears.

Postman's `ai-readiness` skill targets the same bar, so run that first.

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

**A plugin's skills, its MCP tools, and its CLI are different routes to the same action.**
Loading the `api-mocking` skill, calling the MCP tool `createMock`, and running a CLI
command can all stand up a mock. Match only one and you miss most of the ways a user gets
there. So the cartridge accepts any of them:

```jsonc
"criteria": {
  "anyOf": [
    { "type": "command",  "name": "(?:postman:)?(?:api-mocking)" },
    { "type": "mcp_tool", "server": "postman", "tool": "createMock" },
    { "type": "mcp_tool", "server": "postman", "tool": "publishMock" }
  ]
}
```

The optional `postman:` prefix is there because a skill can be reported bare or prefixed
with its plugin name.

**Some actions never touch an MCP tool at all.** Simulation and application testing shell
out to the Postman CLI, so a `bash` matcher sits alongside the skill:

```jsonc
{ "type": "bash", "matches": "postman\\s+simulation\\s+run" }
```

**And some have no tool of their own.** A skill like `ai-readiness` is composed from
generic reads and CLI calls that any other skill might also make — matching those would
hand out the badge for unrelated work. The skill invocation itself is the only trustworthy
signal.

**Older plugin versions.** Before 2.1 the plugin shipped slash commands (`/postman:mock`,
`/postman:run-collection`). The cartridge still accepts those names, so nobody loses
badges by not having upgraded.

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

# a skill invocation
echo '{"tool_name":"Skill","tool_input":{"skill":"postman:api-mocking"}}' \
  | node hooks/learnmcp-hook.mjs post-tool-use

# the MCP tool it can call
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
