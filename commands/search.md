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

Answer in two to four sentences and **always cite the file and line numbers**.
If the answer isn't in the archive, say so plainly — guessing is worse than
admitting it.
