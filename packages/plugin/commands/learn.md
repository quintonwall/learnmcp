---
description: Show the next best practice or feature to try
argument-hint: "[tool name]"
---

The user ran `/learn $ARGUMENTS`.

If an argument names a specific tool (e.g. `/learn postman`, or a chat question like
"what's next for supabase?" or "I just added X, what should I do first?"), first call
`list_cartridges` to map that name to its cartridge id, then call `learn_next` with
`cartridge` set to that id — this works even if the tool has never been used yet.
Otherwise call `learn_next` with no `cartridge`.

Present the result conversationally: the objective title, why it matters, the docs
link, and the badge earned. Keep it to a few lines — one suggestion, not a syllabus. If
the user asks for more detail ("tell me more", "explain that") or the objective's `why`
isn't enough to act on, fetch the `docs` URL and summarize it rather than repeating the
title.

If `learn_next` returns nothing for a named cartridge, say so plainly — it's either
fully complete or the name didn't match anything in `list_cartridges`. If it returns
nothing globally, say no cartridge is active yet and suggest adding an MCP server or
framework it knows about.
