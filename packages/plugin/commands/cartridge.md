---
description: "Refresh cartridges from the registry (usage: /cartridge [reload])"
argument-hint: "[reload]"
---

The user ran `/cartridge $ARGUMENTS`.

Call the learnmcp `reload_cartridges` MCP tool, which refetches the registry from GitHub
and reloads local sources. Report how many are loaded, how many came from the registry,
and anything in `skipped` (a contribution that failed validation) — those are worth
surfacing, since the author probably wants to know.

To simply *list* what's available, prefer `/cartridges`, which shows the full catalogue and
which tracks are active.
