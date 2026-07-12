# learnmcp 🎓

**A dynamic, in-session learning system for building with LLMs.**

Traditional learning platforms hand you pre-authored modules and a fixed path. learnmcp
does the opposite: it lives inside your Claude Code / Codex session, **watches what you
actually build**, **suggests the next best practice or feature to try**, and **rewards
you with badges** when you do it — all driven by pluggable **cartridges** that any
provider can write (or that learnmcp can generate on the fly from a docs page).

> The loop is simple: **observe → recommend → reward.**

---

## Why this exists

The best way to learn a tool is to use it well while you're already using it. But nobody
stops mid-build to read the docs, and generic tutorials don't know what *you're* working
on. learnmcp turns your real session into the curriculum:

- You add the **Postman** MCP → it teaches you Postman, right there.
- You deploy to **Vercel** → it surfaces Vercel best practices as you go.
- You commit a `.env` file → it nudges you (and rewards you for fixing it).

No context switch, no pre-built path. Just the next useful thing, exactly when it's
relevant, with a badge when you nail it.

---

## What it looks like: adding the Postman MCP

A real end-to-end walkthrough (this exact flow is exercised in
[`packages/server/test/detection.test.ts`](packages/server/test/detection.test.ts)
against the shipped [Postman cartridge](cartridges/postman/postman.json)):

**1. You add the Postman MCP server.** A hook notices the config change and emits an
`mcp.added` signal. learnmcp does two things at once:

> 🎓 **Postman detected** — installed the Postman learning track (0/6).
> 🏅 **Plugged In** earned — you added your first MCP server.

**2. It suggests what to do next — automatically.** On session start it scans your
project and surfaces *one* ranked suggestion (and again the moment you complete something,
so the reward is followed by the next step). You can also pull it any time with `/learn`.
Never a wall of text:

> **Next: Generate an OpenAPI spec from your codebase.** A spec makes your API
> documented, mockable, and testable. → Docs · Try the `generate-spec` skill · Badge: *Spec Author* 🥉

*Cadence, on purpose:* it proactively suggests at the two moments that aren't naggy —
session start and right after you earn something — and stays quiet otherwise. `/learn` is
there for everything in between.

**3. You do it, and the badge fires automatically.** You never tell learnmcp "I did the
thing." The cartridge's objective is satisfied *either* by invoking Postman's
`generate-spec` tool **or** by an `openapi.yaml` appearing — either signal counts:

> ✅ **Spec Author** 🥉 — Postman track 1/6. Next: run your collection as tests.

**4. It compounds.** Mock server, run collection, security audit — each advances the
track. Run your collection **10 times** and *Test Runner* 🥉 upgrades to *Marathoner* 🥇.

**5. Even subjective practices get rewarded.** "Are your endpoints described well enough
for an AI agent to consume?" isn't mechanically detectable — so that objective uses an
`llm_judge` matcher (a rubric, not code, gated at 0.8 confidence). Clear the bar and:

> ✅ **Agent-Ready** 🥇 — your API is described well enough for agents to use.

**6. You rank up.** Every badge is worth points (bronze 10 · silver 25 · gold 100), and
points carry across *every* cartridge you touch. Cross a threshold and you climb the
global ladder — **Novice → Initiate → Apprentice → Journeyman → Adept → Expert → Master
→ Grandmaster → Legend** (at 10 / 100 / 500 / 1k / 10k / 100k / 500k / 1M points):

> ⬆️ **Rank up: Apprentice** — 120 pts. 380 to Journeyman.

**7. It becomes public.** Progress syncs to Supabase; your profile, the leaderboard
(ranked by points), and the cartridge's install count all update in the web gallery.

> **And if no Postman cartridge existed?** The same `mcp.added` signal triggers
> cartridge *generation* — point learnmcp at postman.com/docs and it authors the track
> for you (`trust: "generated"`). From your seat the experience is identical.

---

## How it works

Three ideas do all the heavy lifting.

### 1. Signals vs. matchers (detection you can trust)
- A **signal** is anything observable in your session (a shell command ran, a file
  changed, an MCP server was added, a tool was invoked). The hooks/scan layer emits them.
- A **matcher** is a declarative predicate a *cartridge author* writes to say "this best
  practice was performed." The **engine** — never the cartridge — evaluates it.

Matchers contain **no executable code** — only a fixed (but growing) vocabulary:
`bash`, `file`, `dependency`, `mcp`, `mcp_tool`, `env`, `skill`, `count`, `sequence`,
`allOf`/`anyOf`/`not`, and `llm_judge` (the escape valve for subjective practices). That
"no code" rule is what makes it safe to run untrusted community and generated cartridges.

Badges roll up into **points**, and points into a **global rank** (Novice → … → Legend)
so there's one number that climbs across every tool you learn. See
[`packages/schema/src/ranks.ts`](packages/schema/src/ranks.ts).

### 2. Cartridges are data, not code
A cartridge is a plain JSON document — objectives, best practices, badges, and the
matchers that detect them. Because it's pure data, the engine loads it at runtime from:

1. **Project** — `.learnmcp/cartridges/` (checked into your repo)
2. **User** — `~/.learnmcp/cartridges/` (where generated cartridges land)
3. **Registry** — Supabase, cached locally (published / community cartridges)

**Adding a cartridge never requires redeploying the server.** A filesystem watcher
hot-reloads the moment you drop, edit, or remove one; `reload_cartridges` (a.k.a.
`/cartridge reload`) forces an explicit refresh and pulls new registry cartridges.
Invalid cartridges are skipped with a warning — they never crash the engine.

### 3. MCP core + Claude Code plugin wrapper
The **MCP server** is the portable brain (works in Claude Code *and* Codex). The
**Claude Code plugin** wraps it with the one thing MCP can't do — **hooks** for passive
monitoring — plus slash commands.

---

## Repo layout

```
learnmcp/
  packages/
    schema/        # ✅ cartridge schema (Zod + JSON Schema) + the pure matcher evaluator
    server/        # ✅ engine + MCP server + SQLite store + hook CLI + sync + cartridge generation
    plugin/        # ✅ Claude Code plugin: hooks (passive monitoring) + slash commands
    web/           # ✅ Next.js gallery, leaderboard, submit-a-cartridge (Supabase + bundled fallback)
  cartridges/      # ✅ postman, playwright, exa, context7, github, supabase, slack, general
    postman/       #    the walkthrough above
  supabase/        # ✅ migrations: cartridges, progress, badges, leaderboard, RLS
```

✅ = built and tested  ·  ⏳ = planned

---

## Using it

There are two ways to add learnmcp to your workflow. Most people want the plugin.

### Option A — the Claude Code plugin (recommended)

Gets you the full experience: **passive monitoring** (badges earned automatically as you
work) plus slash commands `/learn`, `/badges`, `/progress`, `/cartridge`. It bundles the
MCP server, so you don't add it separately.

Install [`packages/plugin`](packages/plugin) as a Claude Code plugin (via a plugin
marketplace entry or a local plugin path in your settings), then restart Claude Code.
On your next session it picks up your project and starts suggesting + rewarding.

### Option B — just the MCP server (Claude Code **or** Codex)

The portable core. You get the tools (`learn_next`, `list_badges`, `progress`,
`generate_cartridge`, …) but not the passive hooks — you (or the model) call `learn_next`
and friends explicitly. This is the path for Codex, which has no hook system.

Register it as an MCP server:

```jsonc
{
  "mcpServers": {
    "learnmcp": { "command": "learnmcp-server" }
  }
}
```

In Claude Code you can also run `claude mcp add learnmcp -- learnmcp-server`.

> Running or deploying the server yourself (build, env vars, Supabase, the web app)?
> See **[RUNNING.md](RUNNING.md)**.

---

## Roadmap

Built and tested today: the detection engine, the MCP server + persistent store, the
Claude Code plugin (passive monitoring), the Supabase schema + sync layer, docs-URL
cartridge generation, and the web app.

Still ahead:

- First-class **Codex** support (it has no hook system, so monitoring leans on
  `scan_project` + tool calls rather than live hooks)
- Community **moderation** and cartridge **signing** for the public registry
- Wiring the web app's **submit** form to real auth + the moderation queue
