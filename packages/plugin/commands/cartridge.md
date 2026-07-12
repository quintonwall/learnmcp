---
description: List installed cartridges, or reload them (usage: /cartridge [list|reload])
argument-hint: "[list|reload]"
---

The user ran `/cartridge $ARGUMENTS`.

- If the argument is `reload` (or a cartridge was just added/edited), call the learnmcp
  `reload_cartridges` MCP tool and report how many are now loaded.
- Otherwise (or if the argument is `list` or empty), call `list_cartridges` and show me
  each cartridge: name, id, trust level, and how many objectives and badges it defines.
