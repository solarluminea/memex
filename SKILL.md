---
name: memex
description: Project memory and a code map across sessions. Use when the user asks about the project's past ("why did we do it this way", "did we already try…", "what did we measure back then"), when transcripts need archiving or searching, when they mention memory, history, decisions made earlier, or distilling — and when the question is "which file does X" in a codebase too large to grep blind. Not for finding an exact string; grep is cheaper and better at that.
---

# Memex — remembers where, not what

In 1945 Vannevar Bush described a machine that stores documents and, more
importantly, the **trails between them**. Storage was the easy part. The trail
— the path back to the thing — was the contribution.

This is that, for Claude Code sessions.

## Two questions, one idea

**"Why did we do it this way?"** — the archive and the trail.
**"Which file does this?"** — the map.

Both answer with a **pointer**, never with a retelling. A pointer has nothing
to lose: the thing it points at is still there in full, so it cannot quietly
drift away from the truth the way a summary does.

They are not interchangeable and neither replaces `grep`. The map says which
file deals with offers; grep says where a given string is written; the archive
says why the column was added in the first place. Reach for the cheapest one
that answers the question actually asked.

## Three layers of memory

**Archive** (`.memex/archive/`) — session transcripts saved before Claude Code
deletes them at 30 days. Only the conversation is kept; tool results and
screenshots are dropped. Measured: of 467 MB of raw transcripts, the actual
conversation was 3.6 MB — **0.8%**. The rest was base64 screenshots and test
output nobody will ever search for.

**Full-text** (`.memex/archive/.search.db`) — SQLite FTS5 over the archive,
chunked into ~400-character paragraphs. `ziadost` finds `žiadosť` because the
tokenizer folds diacritics on both sides, not because anything is stored twice.

Query words are joined with `OR` and bm25 decides the order. `AND` looks safer
and is not: it demands every word inside one chunk, which is exactly the case
short chunks make rare. Measured on 202 topics — MRR 0.396 → 0.584, and queries
returning nothing fell from 11.9 % to zero.

⚠️ The index has no business being several times the archive. It was 5.5× and is
now 1.7×, from removing two copies of every chunk that fixed nothing.

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

## The map (`.memex/MAP.md`)

One line per module: which file to open. Generated from the code in under a
second, so it is never written by hand and never has to be maintained.

A module's description comes from the first of three sources that yields one:

1. **The header comment.** Written by a person, so it says *why the module
   exists* — something no parser can infer from the syntax.
2. **The interface strings.** For UI files with no header: the labels a person
   reads on screen, paired with the key beside them in the code, so a column
   reads `Power (powerKwp)`. Measured: of 48 files with no header, 47 got a
   usable description this way.
3. **A schema field that bridges layers.** A column name is a data contract:
   the same word stands in the table, the API and the component. Fields that
   appear in only a handful of files are appended to the description, so
   `refreshToken` finds the client, the OAuth module and the sync route at
   once. Fields that are everywhere (`dealId`, in 250 files) are excluded —
   they connect nothing, they connect everything.
4. **An abbreviation, where it lives.** `kWp`, `IBAN`, `XML` are how people ask
   and never how a screen reads. An abbreviation is appended to the three files
   that use it most, and nowhere else: `kwh` is in 132 files, and naming all of
   them answers nothing. Measured: this is worth 13 points of R@12 on
   abbreviation queries and changes nothing on the rest.
5. **Nothing.** A dash — a work list, not an error.

Point two is the part no other tool does. Aider and Serena read the AST;
memory tools read conversations; **nobody reads the strings the app displays.**
In an English codebase there is no reason to — the button says "Deals" and the
file is `DealsTable.tsx`. In a codebase whose interface is in another language,
that is the only place the user's own vocabulary is written down, and it is
exactly the vocabulary they phrase tasks in.

⚠️ **The map says which file to open, not what is in it.** Inferring the
contents from one line is the mistake that costs a day of rework.

⚠️ **Do not try to make it know everything.** Every extra term is another thing
that can go stale, and a stale map is worse than no map — it sends the reader
somewhere that no longer exists. When the map comes up empty, that is grep's
cue, not a defect.

## What to run when

| situation | command |
|---|---|
| "which file does X?" | `/memex:map <word>` |
| regularly, so history isn't lost | `/memex:archive` |
| "why did we do it this way?" | `/memex:search <topic>` |
| after new sessions pile up | `/memex:distill` |
| "how's the memory doing?" | `/memex:status` |
| "is any of this actually helping?" | `/memex:stats` |
| "did a change help?" | `scripts/bench.mjs` (`veta`, `skratky`, `pamat`, `pravda`) |
| "why does this file look like this?" | `search.mjs --file <path>` |
| "what is in this transcript?" | `search.mjs --osnova <transcript>` |

A SessionEnd hook runs the archiver, refreshes the full-text index and rebuilds
the map, so none of them can be forgotten. The map costs no tokens to rebuild — it is a script, not a model.

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

A project that keeps its memory somewhere other than `.memex/` writes it once in
**`memex.json`** at the project root, and every command and hook follows:

```json
{
  "archive": "docs/session-archive",
  "trail": "docs/trail",
  "trailIndex": "docs/TRAIL.md"
}
```

⚠️ Do this **before** running anything, and put the file in git. Paths passed
per-invocation are the failure mode this replaces: one project ran the distiller
with flags and the hook without them, and ended up with the same 39 transcripts
in two places, a trail index whose 153 links all pointed at a folder that did
not exist, and a full-text index built over the copy nobody referenced. Nothing
errored — every write succeeded.

| key in `memex.json` | env var | default |
|---|---|---|
| `root` | `MEMEX_ROOT` | `.memex` |
| `archive` | `MEMEX_ARCHIVE` | `<root>/archive` |
| `index` | `MEMEX_INDEX` | `<archive>/.search.db` |
| `trail` | `MEMEX_TRAIL` | `<root>/trail` |
| `trailIndex` | `MEMEX_TRAIL_INDEX` | `<root>/TRAIL.md` |
| `map` | `MEMEX_MAP` | `<root>/MAP.md` |
| `stats` | `MEMEX_STATS` | `<root>/stats.jsonl` |
| — | `MEMEX_PROJECT` | derived from the project path |

A flag wins over the env var, which wins over `memex.json`, which wins over the
default — a one-off run has to be able to override what is on disk.

The map picks its own source folders (`src`, `lib`, `app`, `packages`, …) and
skips the generated ones. To override that, put `.memex/map.json` next to it:

```json
{ "areas": ["src", "scripts"], "skip": ["legacy"], "maxTerms": 6 }
```

Commit the archive. Do not commit `.search.db` — it's tens of megabytes and
rebuilds in seconds.

Commit `MAP.md` as well, even though it's generated. It's a small text file
with a readable diff, and committing it means a fresh clone can be navigated
before anything has been run.
