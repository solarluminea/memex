---
description: Find where in the session history something was decided
argument-hint: [what to look for]
---

Search the project's memory for: **$ARGUMENTS**

How:

1. If `.memex/TRAIL.md` exists, read it **in full** and check whether the topic
   is listed. The trail is cheaper than searching — headings are written so you
   can decide without opening anything.
2. If the topic is there, open the referenced line range in `.memex/archive/`.
3. If it isn't, search directly:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs "keywords" --n 8`
   It prints file, line range and a snippet; read the spot with `Read` using
   `offset`/`limit`. Diacritics don't matter — the index knows both forms.

To go the other way — from a file to the conversations that changed it — use
`node ${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs --file <path>`. The archive
records every tool call, so an edited path is written in it verbatim; this is
the answer to "why does this file look like this" that a commit message cannot
give.

Answer in two to four sentences and **always cite the file and line numbers**.
If the answer isn't in the archive, say so plainly — guessing is worse than
admitting it.
