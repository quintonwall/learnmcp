# learnmcp 🎓

[![status: beta](https://img.shields.io/badge/status-beta-orange?style=flat-square)](https://github.com/quintonwall/learnmcp)
[![ci](https://img.shields.io/github/actions/workflow/status/quintonwall/learnmcp/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/quintonwall/learnmcp/actions/workflows/ci.yml)
[![last commit](https://img.shields.io/github/last-commit/quintonwall/learnmcp?style=flat-square)](https://github.com/quintonwall/learnmcp/commits/main)
[![cartridges](https://img.shields.io/github/directory-file-count/quintonwall/learnmcp/cartridges?type=dir&style=flat-square&label=cartridges&color=0b7285)](cartridges/)
[![open issues](https://img.shields.io/github/issues/quintonwall/learnmcp?style=flat-square)](https://github.com/quintonwall/learnmcp/issues)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](cartridges/)
[![MCP](https://img.shields.io/badge/MCP-remote-0b7285?style=flat-square)](https://modelcontextprotocol.io)
[![sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2?style=flat-square)](https://github.com/sponsors/quintonwall)

**Add one plugin. Learn the tools you already use, as you use them.**

learnmcp watches what you build, tells you the next best practice worth trying, and awards
points and badges when you do it. No courses, no fixed path — your real work is the
curriculum.

```
You: Can you generate an OpenAPI spec for this codebase?

🎓 learnmcp — 🏅 Spec Author (+10) · ✅ Generate an OpenAPI spec from your codebase
              · Initiate · 10 pts (90 to Apprentice)
              · Next: Sync your spec to a Postman collection
```

---

## Get started

Two commands:

```bash
claude plugin marketplace add quintonwall/learnmcp
claude plugin install learnmcp@quintonwall
```

Restart Claude Code. That's it — no account, no API key, nothing to configure. The plugin
talks to the hosted server at **[learnmcp.ai](https://learnmcp.ai)**, and the moment it
sees you do something worth rewarding, it starts tracking you automatically.

---

## Use it

You don't do anything differently. Just work, and when you touch a tool learnmcp knows,
it rewards you for the good stuff:

```
You: Can you generate an OpenAPI spec for this codebase?

🎓 learnmcp — 🏅 Spec Author (+10) · ✅ Generate an OpenAPI spec from your codebase
              · Initiate · 10 pts (90 to Apprentice)
              · Next: Sync your spec to a Postman collection
```

That's the whole loop. You never tell learnmcp what you did — running the command,
calling the tool, or the file simply appearing all count as the signal. Keep going and
it compounds: bronze badges are worth 10 points, silver 25, gold 100, adding up across
every tool into one rank from Novice all the way to Legend.

Check in anytime:

| | |
|---|---|
| `/learn [tool]` | the next thing worth doing — for everything, or one tool by name |
| `/badges` | what you've earned |
| `/progress` | your points, rank, and standing |
| `/cartridges` | everything learnmcp can teach, and what's active for you |

Or just ask, in plain language — *"what should I do next?"*, *"I just added Supabase,
where do I start?"*, *"where am I on the leaderboard?"*. In a terminal that supports
clickable links, the "Next:" line goes straight to the docs.

**No account, ever.** The first thing learnmcp records creates an anonymous learner and
starts saving immediately — nothing is lost by staying anonymous. Want your name on the
leaderboard instead of `learner-7f3c`? Just say "claim the handle quinton" — no sign-in,
the request itself proves it's your progress to name.

**Using more than one machine?** Your identity is nothing but the token at
`~/.learnmcp/token` — copy it to the second machine (before it earns anything of its own)
and both resolve to the same learner from then on:

```bash
# on the machine with the progress you want to keep
cat ~/.learnmcp/token
# on the other machine
echo '<paste>' > ~/.learnmcp/token && chmod 600 ~/.learnmcp/token
```

There's no merge — whichever token a machine ends up with wins, and any progress already
under a token you overwrite is abandoned. There's also no recovery if a token is lost:
it's the only thing identifying you, by design.

**Prefer to keep everything off the cloud?** `export LEARNMCP_LOCAL=1` opts out of
tracking entirely — no leaderboard, no cartridge popularity, nothing sent. Want a fully
private leaderboard-free deployment instead of an opt-out? See [HOSTING.md](HOSTING.md).

---

## Not on Claude Code?

Everything above is the **plugin** — Claude Code specifically, hooks and all. learnmcp is
also a plain MCP server, so anything that speaks MCP can use it (Codex, Cursor, Windsurf,
your own agent). Two ways to connect, and each gives up something:

**Point at the hosted server directly** — no plugin, just the MCP config:

```jsonc
{ "mcpServers": { "learnmcp": { "type": "http", "url": "https://learnmcp.ai/mcp" } } }
```

This gets you every tool — `learn_next`, `list_cartridges`, the leaderboard — with two
real limitations, both because the plugin's hooks are what paper over them:

- **No passive detection.** Nothing is watching your session, so nothing is recorded
  automatically. The model has to explicitly call `record_activity` after doing something,
  or `scan_project` at the start of a session — tell it to, or it won't happen.
- **No persistent identity, unless your client can hold a header.** The server hands back
  an anonymous learner's token on first contact; the plugin's hooks save and resend it
  automatically, but a generic MCP client has no reason to. If yours can't be configured
  with a static `Authorization: Bearer <token>` header, every session mints a fresh learner
  and progress won't accumulate. Check whether your client's MCP config supports custom
  headers — if it does, call any tool once, grab the token from the `x-learnmcp-token`
  response header, and hardcode it.

**Or run the engine locally** — real SQLite, scoped to your project, no cloud and no token
to manage. Not published to npm yet, so it means building from source:

```bash
git clone https://github.com/quintonwall/learnmcp && cd learnmcp
npm install && npm run build
```

```jsonc
{ "mcpServers": { "learnmcp": { "command": "node", "args": ["/path/to/learnmcp/packages/server/dist/bin.js"] } } }
```

Same caveat applies: no hooks means no passive detection here either — call `scan_project`
at session start and lean on `record_activity`. Full env var reference in
[RUNNING.md](RUNNING.md#run-the-mcp-server-stdio).

---

## Contributing a cartridge

A **cartridge** is what teaches one service — plain JSON, no code. The registry is a
directory in this repo:

### 👉 [`cartridges/`](cartridges/)

Adding support for a new service means opening a PR there. Once it merges, every learnmcp
instance picks it up on its next refresh — nothing is rebuilt, redeployed, or restarted.

**Fastest way to a first draft:** ask learnmcp itself.

```
Generate a cartridge from https://vercel.com/docs
```

That calls the `generate_cartridge` tool, which reads the docs and drafts objectives,
badges, and matchers for you (`trust: "generated"`) — review it, then PR it. The rest of
this section is for writing one by hand, or fixing up what it generated.

Copy an existing cartridge as a starting point. The shape:

```json
{
  "id": "vercel",
  "version": "1.0.0",
  "trust": "community",
  "provider": { "name": "Vercel", "homepage": "https://vercel.com", "icon": "▲" },
  "detect": [{ "type": "file", "path": "**/vercel.json", "exists": true }],
  "objectives": [
    {
      "id": "preview-deploy",
      "title": "Ship a preview deployment before merging",
      "why": "Preview URLs let reviewers click the change instead of imagining it.",
      "docs": "https://vercel.com/docs/deployments/preview-deployments",
      "badge": "previewer",
      "criteria": { "type": "bash", "matches": "vercel\\s+(deploy|--prod)" }
    }
  ],
  "bestPractices": [],
  "badges": [
    { "id": "previewer", "name": "Previewer", "tier": "bronze",
      "description": "Shipped a preview deployment." }
  ]
}
```

`detect` decides when the track switches on. `criteria` decides when a badge is earned.
Both are **matchers** — declarative predicates the engine evaluates. Cartridges carry no
executable code, which is what makes running someone else's safe.

| Matcher | Fires when |
|---|---|
| `bash` | a shell command matched your regex |
| `file` | a path exists / its contents match |
| `dependency` | a package appeared in a manifest |
| `mcp` | an MCP server is configured |
| `mcp_tool` | a specific MCP tool was called (`gte` times) |
| `command` | a slash command or skill was invoked (`gte` times) |
| `env` | a key is present, or provably absent from git |
| `skill` | a Claude Code skill was authored |
| `count` | N signals of some kind accumulated |
| `allOf` / `anyOf` / `not` | combine the above |
| `llm_judge` | an LLM scores a rubric past a confidence bar |

`llm_judge` is the escape valve for what you can't detect mechanically — *"are these
endpoints described well enough for an agent to call?"* Gated at 0.8 confidence, so a badge
is never granted on a hunch.

### Two rules that matter

**Match the tool's real surface.** Run it once and look at what it actually emits. A
plugin's slash commands (`/postman:mock`) and its MCP tools (`createMock`) are different
names for the same action, and some actions only ever appear as a shell command — accept
all of them with `anyOf`. Getting this wrong is the most common way a cartridge silently
never fires.

**Prefer several narrow matchers to one loose regex.** A badge that's easy to earn by
accident isn't worth earning.

### Before you open the PR

```bash
npm install && npm test          # validates every cartridge in the repo
LEARNMCP_CARTRIDGES=./cartridges # makes your local copy outrank the published registry
```

Validate against
[`packages/schema/cartridge.schema.json`](packages/schema/cartridge.schema.json), and add a
case to [`packages/server/test/cartridges.test.ts`](packages/server/test/cartridges.test.ts).
This applies whether you wrote the cartridge by hand or started from `generate_cartridge` —
a generated one still needs its matchers checked against the product's real tool names
before it's PR-ready.

---

## Sponsor

learnmcp is free, open source, and the hosted server is free to use — someone pays for the
database and the bandwidth behind it, and right now that's me.

### 💜 [Sponsor this project](https://github.com/sponsors/quintonwall)

Sponsoring keeps the hosted instance running for everyone, and funds the next round of
work: more first-party cartridges and a public gallery.

Not in a position to sponsor? [Contributing a cartridge](#contributing-a-cartridge),
filing an issue, or telling someone about it all help just as much.

---

## More

- **[POSTMAN.md](POSTMAN.md)** — a full track end to end, and how detection really works
- **[HOSTING.md](HOSTING.md)** — running your own server, database, and leaderboards
- **[RUNNING.md](RUNNING.md)** — building from source
