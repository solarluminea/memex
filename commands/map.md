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
2. **When a result carries a line number** (`PripadyTabulka.tsx:246`), read a
   window around it rather than the whole file — `offset` about ten lines
   earlier, `limit` thirty — and widen only if what you need is not there. The
   number is a starting point, not a promise.

   It comes from one of two places: the first interface label in the file, or
   the declaration whose name best matches your question. Measured on 152 real
   read-then-edit pairs from the transcripts: where a declaration is visible
   above the edit, the edit sits a **median 12 lines** below it and 74 % within
   forty. The same measurement is the reason to bother — the median large read
   is **210 lines for 5 edited**.

3. **To see where things are in a file you already know:**
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs outline <file>`
   One line per top-level declaration with its line number — about 3 % the
   length of reading the file. Pick a declaration, then `Read` a window around
   it. Use this instead of opening a large file to find your bearings.
4. With no argument, rebuild the map:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.mjs`, in the background
   (`run_in_background: true`). It prints a single line — modules and how many
   lack a description — so pass that on and do not open the map. Not
   `--quiet`: that is the hook's mode, and in a project with no map yet it exits
   without creating one. Searching it (`find`, `outline`) stays in the
   foreground: you need that answer now.

If nothing comes back, the map is the wrong tool for that question. Two things
it deliberately does not do:

- **An exact string** — `grep`/`Grep` is for that, and it is cheaper. The map
  answers "which file deals with offers"; grep answers "where is this text".
- **A past decision** — that is `/memex:search`.

The map is generated from the code, so it can be stale but it cannot be wrong
about a file it lists. When a description does not match the file you opened,
rebuild it before concluding anything.
