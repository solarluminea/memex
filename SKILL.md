---
name: memex
description: Project memory across sessions. Use when the user asks about the project's past ("why did we do it this way", "did we already try…", "what did we measure back then"), when transcripts need archiving or searching, or when they mention memory, history, decisions made earlier, or distilling. Do not use for finding code — that's what grep is for.
---

# Memex — remembers where, not what

In 1945 Vannevar Bush described a machine that stores documents and, more
importantly, the **trails between them**. Storage was the easy part. The trail
— the path back to the thing — was the contribution.

This is that, for Claude Code sessions.

## Three layers

**Archive** (`.memex/archive/`) — session transcripts saved before Claude Code
deletes them at 30 days. Only the conversation is kept; tool results and
screenshots are dropped. Measured: of 467 MB of raw transcripts, the actual
conversation was 3.6 MB — **0.8%**. The rest was base64 screenshots and test
output nobody will ever search for.

**Full-text** (`.memex/archive/.search.db`) — SQLite FTS5 over the archive,
chunked by paragraph with overlap. Every chunk is indexed twice, with and
without diacritics, so `ziadost` finds `žiadosť`.

**Trail** (`.memex/TRAIL.md` + `trail/`) — a list of topics, each pointing at
an **exact line range** in a transcript. Not a summary. The text is not
repeated here, on purpose.

## Why a trail and not a summary

This is the one claim the whole design rests on, and it was measured.

Four memory systems, 22 questions drawn from a real project's history, three
runs each, three blind judges. Every system **in isolation** — each saw only
its own corpus, nothing else:

| memory | answers containing the key fact | tokens per correct answer |
|---|---|---|
| trail + archive | **100%** | **5k** |
| archive + full-text | 98% | 8k |
| summary-style distillate | 55% | 8k |

Summaries lose. Not by lying — of 264 ratings exactly **one** contradicted the
reference answer. They simply had nothing to say: the topic was there, the
specific fact was gone. And nobody finds out, because nothing looks missing.

A pointer has nothing to lose. The transcript does not change, so a pointer
into it cannot go stale.

It also came out cheaper than searching the raw archive — a third fewer
tokens, because the reader picks from headings instead of hunting.

## What to run when

| situation | command |
|---|---|
| regularly, so history isn't lost | `/memex:archive` |
| "why did we do it this way?" | `/memex:search <topic>` |
| after new sessions pile up | `/memex:distill` |
| "how's the memory doing?" | `/memex:status` |

A SessionEnd hook runs the archiver too, so it cannot be forgotten.

## Answering a question from the past

1. Read **all** of `.memex/TRAIL.md`. It's headings only; it fits.
2. Pick by heading, open the referenced line range in `.memex/archive/`.
3. If the topic isn't in the trail, search the archive directly with
   `scripts/search.mjs`.
4. **Always cite file and line numbers.** A claim from memory that can't be
   checked is worse than no claim — in six months nobody will question it and
   people will build on it.

## What does not belong in it

Anything readable from the code, `git log`, or `CLAUDE.md`. This is not
documentation. It is the record of what the code cannot show: what was tried,
why it was abandoned, and what the numbers were.

## Configuration

| variable | default |
|---|---|
| `MEMEX_ROOT` | `.memex` |
| `MEMEX_ARCHIVE` | `.memex/archive` |
| `MEMEX_TRAIL` | `.memex/trail` |
| `MEMEX_PROJECT` | derived from the project path |

Commit the archive. Do not commit `.search.db` — it's tens of megabytes and
rebuilds in seconds.
