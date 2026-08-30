# Memex

**Project memory for Claude Code that remembers where, not what.**

In 1945 Vannevar Bush described a machine that stores documents and, more
importantly, the *trails between them*. Storage was the easy part. The trail —
the path back to the thing — was the contribution.

Memex archives your Claude Code sessions before they're deleted, indexes them
for search, and builds a trail of topics pointing at exact line ranges. It does
not summarise them, and the reason why is the rest of this document.

```
/plugin marketplace add solarluminea/memex
/plugin install memex
```

Needs Node 22.5+ for full-text search (`node:sqlite`). Everything else — the
archive and the trail — is plain files and works on any version. No npm
dependencies at all.

---

## The finding

Every memory tool for coding agents does roughly the same thing: read the
transcripts, extract what matters, write it down as notes. We built one of
those. Then we measured it, and it lost to *doing nothing but keeping the raw
transcripts*.

Four memory systems, 22 questions drawn from a real project's history, three
runs each, three blind judges, every system **in isolation** — each saw only
its own corpus and nothing else:

| memory | run 1 | run 2 | run 3 | mean | spread | tokens/correct |
|---|---|---|---|---|---|---|
| **trail + archive** | 22 | 22 | 22 | **100%** | ±0 | **5k** |
| archive + full-text | 22 | 22 | 21 | **98%** | ±1 | 8k |
| memem (distillate) | 13 | 13 | 13 | 59% | ±0 | 6k |
| summary-style register | 12 | 11 | 13 | 55% | ±2 | 8k |

264 ratings. **Exactly one** contradicted the reference answer.

That last number is the interesting one. Summary-style memory doesn't lie — it
goes quiet. The topic is there; the specific fact is gone. And nobody notices,
because nothing *looks* missing. It just quietly answers half your questions.

A pointer has nothing to lose. The transcript never changes, so a pointer into
it cannot drift, go stale, or omit the sentence you needed.

## The three things that surprised us

**Semantic search wasn't the missing piece.** One question group was built
specifically so no question shared a single content word with any stored
heading — the case embeddings are supposed to win. The keyword-only systems
scored 5/6 and 6/6 anyway. Finding the topic was never the problem. Having the
answer inside the topic was.

**Distillation is a lottery, not a function.** We mined the same 9.3 MB
transcript twice with the same tool and the same model: 21 entries one time, 18
the other, and exactly **one heading in common**. A single distillation pass is
one draw from a distribution, not a summary of the source.

**Our own first two measurements were wrong, in our favour.** Both gave every
memory arm access to the raw archive underneath. We were measuring "distillate
*plus* archive" and reading it as "distillate". Under that setup the summary
register scored 90%. In isolation it scores 55%. The archive was doing the
work.

## How it works

**Archive** — session transcripts saved before Claude Code's 30-day cleanup.
Only the conversation is kept. Measured on 467 MB of raw transcripts:

| | size | share |
|---|---|---|
| base64 screenshots | 281 MB | 60.2% |
| tool results | 106 MB | 22.8% |
| tool inputs | 23 MB | 4.9% |
| **the conversation** | **3.6 MB** | **0.8%** |

The conversation is 1/130th of the archive. What *is* kept alongside it is a
one-line summary of every tool call — without it the archive records what was
said but not what was done, and "fixed it" with no `[Tool: Edit foo.ts]` beside
it is untraceable six months later.

**Full-text** — SQLite FTS5 over the archive, chunked by paragraph with
overlap so an exchange split across two turns still matches. Every chunk is
indexed twice, with and without diacritics, so `ziadost` finds `žiadosť`.

**Trail** — one file per topic, containing a heading and a line range. No
content. The heading is written so you can decide whether to open it without
opening it; everything else lives in the transcript.

```
# 2026-08-20 · Task steps can't be edited from the settings screen

Where this is in the transcript:

- [`3f9c1a20.md` lines 1840–1855](../archive/3f9c1a20.md#L1840-L1855)
```

## The map: the same idea, pointed at the code

The archive answers *why did we do it this way*. It has nothing to say about
*which file does this* — and on a large project that question is asked far more
often, several times an hour.

So the map is the same trick aimed at the code: one generated line per module,
saying which file to open and nothing more. It costs no tokens to build, because
it is a script rather than a model — 1,297 modules in **0.44 seconds** on the
project it was written for.

A module's description comes from the first of three sources that yields one:
the **header comment** (a human wrote it, so it says why the module exists), the
**interface strings** for UI files without one, or a dash.

That middle one is the part no other tool does:

```
src/app/crm/DealsTable.tsx — Deal (name) · Power (powerKwp) · Offer · Stage
```

Aider and Serena parse the AST. Memory tools read conversations. **Nobody reads
the strings the app puts on screen** — and in an English codebase there's no
reason to, because the button says "Deals" and the file is `DealsTable.tsx`.

In a codebase whose interface isn't in English, that's the only place the user's
own vocabulary is written down, and it's the vocabulary they phrase tasks in.
Measured on such a project: of 48 files with no header comment, 47 got a usable
description this way. Searching for `kWp` returned nothing before and returns
exactly one file after — the right one.

The key in parentheses matters as much as the label. The column reads *Power* on
screen and lives as `powerKwp` in the data; without the pair, the map is findable
by one and not the other.

## Commands

| | |
|---|---|
| `/memex:map <word>` | which file to open |
| `/memex:archive` | save transcripts, rebuild the index |
| `/memex:search <topic>` | find where something was decided |
| `/memex:distill` | build the trail (batch job, tens of minutes) |
| `/memex:status` | health: what's archived, indexed, uncovered |

A SessionEnd hook runs the archiver and rebuilds the map, so neither can be
forgotten. Always-on cost is about **310 tokens** per session; everything else
is paid on use.

## Configuration

| variable | default |
|---|---|
| `MEMEX_ROOT` | `.memex` |
| `MEMEX_ARCHIVE` | `.memex/archive` |
| `MEMEX_TRAIL` | `.memex/trail` |
| `MEMEX_MAP` | `.memex/MAP.md` |
| `MEMEX_PROJECT` | derived from the project path |

The map picks its own source folders (`src`, `lib`, `app`, `packages`, …) and
skips the generated ones. Override it with `.memex/map.json`:

```json
{ "areas": ["src", "scripts"], "skip": ["legacy"], "maxTerms": 6 }
```

Commit the archive — it's the actual memory. Commit `MAP.md` too, so a fresh
clone can be navigated before anything has been run. Don't commit `.search.db`;
it's tens of megabytes and rebuilds in seconds.

## How the measurement was run

Published because most memory tools publish none of this.

**Isolation.** Each system lived in its own directory containing only its own
corpus. An earlier round asked the searchers not to look elsewhere, and both of
them broke it with one wide `grep` and said so afterwards. What isn't reachable
can't be reached: the questions, the reference answers and the other arms' work
were moved outside the repository entirely.

**Binary grading.** Judges answer one question — *is the key fact in this
answer?* An earlier round used a four-point scale with a noise metric, and the
same judge moved 2 to 5 points on unchanged data. A binary question has no
calibration to lose.

**Three runs, three judges.** Searcher variance and judge variance were
previously mixed together and indistinguishable.

**A no-memory control.** Nobody publishes this one. Code and `git log` alone
answered 65% of a comparable question set — so part of what memory tools claim
as their contribution is just an agent reading the repository.

**Blinding.** Answers are stripped of their source lines, system names are
neutralised in the body text, and letters are reshuffled per question. A leak
detector runs over the result; it found and we fixed a case where an arm named
itself mid-sentence.

## What this measurement does not show

**Whether a trail beats a retelling at equal density.** Our trail had 101
entries for the tested sessions; the summary register had 12. You can argue the
density is a *consequence* of a pointer costing one line — but that's an
argument, not a measurement.

**Where the archive starts failing.** Both archive-based arms hit the ceiling
at 98–100%, so the test can't say where the limit is. It needs harder questions
or a bigger corpus.

**How this holds up at scale.** The corpus was ten sessions and a week of
history. A hundred sessions may not behave the same way.

**Two questions were dropped** because the project moved underneath the
reference answers — a row count corrected itself mid-transcript, and a UI
constraint stopped being true. One of them was our best illustration of what
summaries lose, so dropping it cost us rhetorically. A question with a stale
answer key doesn't measure memory; it measures which snapshot you happened to
hit.

## What Memex is not

It isn't a code search. The map says which file to open; **grep says where a
string is**, and grep is cheaper and better at it. When the map comes up empty
that's grep's cue, not a defect — trying to make the map know everything is how
you get a large map that's quietly out of date.

It isn't a semantic index either. We measured that: on questions deliberately
worded to share no word with the stored entry — the case embeddings are supposed
to win — a plain index over a greppable archive scored the same as a vector one.
Six out of six, both.

It doesn't replace `CLAUDE.md`; on a conflict, `CLAUDE.md` and the newer commit
win, not the memory. And it doesn't remember everything.

That last one is the point of the name we didn't use. In Borges' story, Ireneo
Funes remembers every leaf of every tree and, as a result, cannot think — he
has no way to generalise or forget. Remembering everything isn't the goal.
Knowing where to look is.

## Licence

MIT.
