---
description: Which file to open — a generated one-line-per-module map of the code
argument-hint: [the task in a sentence, or nothing to rebuild]
---

Code map for: **$ARGUMENTS**

How:

1. **Ask it with the whole task, not one word.**
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs find "$ARGUMENTS"`
   Give it the sentence the user gave you — "move the offer button right after
   the deal name and put the kWp figure there too" — not `offer`. Measured on
   300 real tasks: a single word answers 0.263 (MRR), the whole sentence
   **0.574**. Each word is weighted by how rare it is and files touching more of
   the question rank higher, so more words is more signal, not more noise.

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
