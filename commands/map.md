---
description: Which file to open — a generated one-line-per-module map of the code
argument-hint: [word to look for, or nothing to rebuild]
---

Code map for: **$ARGUMENTS**

How:

1. With an argument, look it up:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs find "$ARGUMENTS"`
   It prints one line per module — path and description. Open the file that
   matches; do **not** guess its contents from the line.
2. **When a result carries a line number** (`PripadyTabulka.tsx:246`), that is
   where the description was read from. Read a window around it rather than the
   whole file — `offset` about ten lines earlier, `limit` thirty — and widen
   only if what you need is not there. The number is a starting point, not a
   promise: it marks the first label in the file, and the thing you want may sit
   further down the same block.
3. With no argument, rebuild the map:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs`

If nothing comes back, the map is the wrong tool for that question. Two things
it deliberately does not do:

- **An exact string** — `grep`/`Grep` is for that, and it is cheaper. The map
  answers "which file deals with offers"; grep answers "where is this text".
- **A past decision** — that is `/memex:search`.

The map is generated from the code, so it can be stale but it cannot be wrong
about a file it lists. When a description does not match the file you opened,
rebuild it before concluding anything.
