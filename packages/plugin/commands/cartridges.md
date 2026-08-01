---
description: Show everything learnmcp can teach, and which tracks are active for you
---

Call the learnmcp `list_cartridges` MCP tool, then present the catalogue as a table:

| | Cartridge | Objectives | Badges | Status |

- Use the cartridge's `icon` and `name`.
- **Status** is "active" when `active` is true, otherwise show what would switch it on,
  taken from `activatedBy` (e.g. "using the supabase MCP server").
- Sort active cartridges first, then alphabetically.

Below the table, mention how many are active out of the total, and that new cartridges are
contributed by pull request to the `registry` URL the tool returns.

If the user asks about one in particular, use its `teaches` list to show what that track
covers, and point at `/learn` for the next step.
