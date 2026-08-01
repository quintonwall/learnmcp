# learnmcp 🎓

**Add one plugin. Learn the tools you already use, as you use them.**

learnmcp watches what you build, tells you the next best practice worth trying, and awards
points and badges when you do it. No courses, no fixed path — your real work is the
curriculum.

```
You: /postman:generate-spec

learnmcp — 🏅 Spec Author (+10) · ✅ Generate an OpenAPI spec from your codebase
           · Initiate · 10 pts (90 to Apprentice)
           · Next: Sync your spec to a Postman collection
```

---

## Install

```bash
claude plugin marketplace add quintonwall/learnmcp
claude plugin install learnmcp@learnmcp
```

Restart Claude Code. Under a minute, and you're done.

**No account required.** The first time learnmcp records anything it creates an anonymous
learner for you and starts saving straight away — badges, points, rank. You only sign in if
you want your *name* on the leaderboard instead of `learner-7f3c`:

```
Claim my learnmcp profile
```

Nothing is lost either way; claiming just puts a handle on progress you already have.

The plugin gives you two things: a **remote MCP server** that holds the curriculum and your
progress, and **hooks** that notice what you do. The hooks are the reason it's a plugin
rather than a bare MCP — they're what let badges land passively instead of only when the
model thinks to look.

---

## Using it

Just work. When you use a tool learnmcp knows, the matching track activates on its own and
you'll see the next suggestion at session start.

### A first session, start to finish

Say you have the [Postman plugin](https://github.com/Postman-Devrel/postman-claude-code-plugin)
installed. Open Claude Code in any project:

> learnmcp is tracking your progress. Rank Novice · 0 pts.
> Active learning tracks: **postman**.
> Suggested next: **Generate an OpenAPI spec from your codebase** — A spec makes your API
> documented, mockable, and testable.

You didn't configure anything; it saw the Postman MCP and loaded the matching track. Follow
the suggestion using Postman's own command:

```
/postman:generate-spec
```

```
learnmcp — 🏅 Spec Author (+10) · ✅ Generate an OpenAPI spec from your codebase
           · Initiate · 10 pts (90 to Apprentice)
           · Next: Sync your spec to a Postman collection
```

Keep going and it compounds — `/postman:security` is worth silver:

```
learnmcp — 🏅 Locked Down (+25) · ✅ Security-audit your API (OWASP API Top 10)
           · Initiate · 35 pts (65 to Apprentice)
```

Then check where you stand:

```
/progress
```

```json
{ "points": 35, "rank": "Initiate", "nextRank": "Apprentice",
  "pointsToNextRank": 65, "badges": 2, "leaderboardPosition": 1,
  "claimed": false }
```

You never told learnmcp you did anything. Running the command *is* the signal.

### Commands

| | |
|---|---|
| `/learn` | the next thing worth doing |
| `/badges` | what you've earned |
| `/progress` | your points, rank, and standing |
| `/cartridge` | what it can teach; refresh from the registry |

Or just ask in plain language — *"where am I on the leaderboard?"*, *"what can learnmcp
teach me?"*, *"claim my profile"*. The tools behind those are `my_progress`, `my_badges`,
`leaderboard`, `cartridge_popularity`, `claim_profile`, `learn_next`, `list_cartridges`,
`add_cartridge`, and `generate_cartridge`.

Points are bronze 10, silver 25, gold 100, accumulating across every tool into one rank:
Novice → Initiate → Apprentice → Journeyman → Adept → Expert → Master → Grandmaster →
Legend. There's a global leaderboard and a per-cartridge one.

### Keeping progress local instead

Progress goes to the cloud by default, which is what makes leaderboards and cartridge
popularity work. To keep everything on your machine in `~/.learnmcp/state.sqlite` and send
nothing:

```bash
export LEARNMCP_LOCAL=1
```

Self-hosting the server instead? Point `LEARNMCP_URL` at your deployment — see
[HOSTING.md](HOSTING.md).

---

## Contributing a cartridge

A **cartridge** is what teaches one service — plain JSON, no code. The registry is a
directory in this repo:

### 👉 [`cartridges/`](cartridges/)

Adding support for a new service means opening a PR there. Once it merges, every learnmcp
instance picks it up on its next refresh — nothing is rebuilt, redeployed, or restarted.

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

**Don't want to write it by hand?** Ask learnmcp to
`generate a cartridge from https://vercel.com/docs` — it reads the docs and drafts the
track. Review it, then PR it.

---

## More

- **[POSTMAN.md](POSTMAN.md)** — a full track end to end, and how detection really works
- **[HOSTING.md](HOSTING.md)** — running your own server, database, and leaderboards
- **[RUNNING.md](RUNNING.md)** — building from source
