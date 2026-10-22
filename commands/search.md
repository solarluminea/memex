---
description: Find where in the session history something was decided
argument-hint: [what to look for]
---

Search the project's memory for: **$ARGUMENTS**

How:

1. **Run this first.** It is the cheap tier and it answers most questions:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs "$ARGUMENTS" --n 8`

   It prints up to three things, in descending order of how much they can be
   trusted:

   - **Trail topics** — headings a distiller wrote with the transcript open,
     each with an exact line range. Strongest evidence; open the range.
   - **Topics derived from the transcripts** — the same shape, but generated
     from the archive by a regex: a heading Claude wrote in an answer, or a
     question the user asked. Useful pointers, *not* curated. Treat a match
     here as a place to look, never as a conclusion.
   - **Passages** — chunks of the archive with a snippet, file and line range.

2. **Open the line range** with `Read` using `offset`/`limit`. The pointer is
   the answer's address, not the answer.

3. **If nothing fits, search again with other words or `--n 20`** before
   anything else. Trail topics are searched in the text they point at as well
   as in their heading, so a question worded differently from the heading
   still reaches them — measured, 80.8 % of such questions find the right
   topic among the first four, where heading-only search found 2.4 %.

   Read the whole trail index (`.memex/TRAIL.md`, or wherever `memex.json`
   puts it) **only when the search output says it is small enough**. At 260
   topics it was 12k tokens; on a project with 10 000 topics it is 3 MB,
   about a million tokens, and reading it is not possible. The search prints
   which case you are in.

To go the other way — from a file to the conversations that changed it — use
`node ${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs --file <path>`. The archive
records every tool call, so an edited path is written in it verbatim. Sessions
come back oldest first with their dates, so the answer reads as a history of the
file rather than a list. This is the answer to "why does this file look like
this" that a commit message cannot give.

Answer in two to four sentences and **always cite the file and line numbers**.
If the answer isn't in the archive, say so plainly — guessing is worse than
admitting it.

⚠️ If the output warns that transcripts are newer than the index, say so in the
answer. An incomplete search that reads as complete is the failure this whole
tool exists to prevent.
