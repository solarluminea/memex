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

A module's description comes from the first sources that yield one:
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
description this way.

The key in parentheses matters as much as the label. A column reads *Power* on
screen and lives as `powerKwp` in the data; without the pair, the map is findable
by one and not the other. On the project this was built for, searching `kWp` went
from nothing to exactly one file — the right one.

**And two hours later it returned nothing again.** Another session moved the
power figure next to the name, the `Power` column stopped existing, and the label
the map had been matching on went with it. Nothing broke: the map reported the
code as it now is, which is the whole point of generating it.

It is worth stating plainly, because it bounds what any measurement of this tool
can claim. **A number about the map is a number about a moment in a repository.**
The method — read what the interface says, pair it with the key beside it — is
what carries over; the example does not. When the map comes up empty for a string
that is not a label, that is grep's job, and `grep -rl kWp src/` answers it in
milliseconds.

## Measuring instead of hoping

Every number in this README came from an experiment run once, by hand. That is
enough to pick a direction and not enough to know the direction worked.

`/memex:stats` reads the transcripts Claude Code already writes and reports what
navigation costs — **steps between being asked and changing something**, lookups
and reads per edit, fresh tokens per edit, cache share. It compares the older
half of your sessions against the newer one.

It does **not** report savings, on purpose. "This saved 7k tokens" is a claim
about a session that never happened. The rows are counts; the judgement is left
to a person looking at two periods of real work.

Building it immediately caught a mistake in its own first draft: averaging per
session showed everything dropping 80 %, which measured how long sessions were,
not how well they navigated. Per edit, the same data reads 1.2 lookups and 36k
fresh tokens — numbers that mean something.

## Commands

| | |
|---|---|
| `/memex:map <word>` | which file to open |
| `/memex:archive` | save transcripts, rebuild the index |
| `/memex:search <topic>` | find where something was decided |
| `/memex:distill` | build the trail (batch job, tens of minutes) |
| `/memex:status` | health: what's archived, indexed, uncovered |
| `/memex:stats` | what navigation costs: steps and tokens per edit |
| `scripts/bench.mjs` | does the map find the right file? measured against git |
| `search.mjs --file <path>` | which sessions touched this file, and where |

A SessionEnd hook runs the archiver, refreshes the full-text index and rebuilds
the map, so none of them can be forgotten — without the index step the first
search of a fresh install answers `No index` and costs a whole turn to fix. Always-on cost is about **310 tokens** per session; everything else
is paid on use.

## Configuration

| variable | default |
|---|---|
| `MEMEX_ROOT` | `.memex` |
| `MEMEX_ARCHIVE` | `.memex/archive` |
| `MEMEX_TRAIL` | `.memex/trail` |
| `MEMEX_MAP` | `.memex/MAP.md` |
| `MEMEX_STATS` | `.memex/stats.jsonl` |
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

## Does the map actually find the right file?

The memory half was measured against blind judges. The map had no equivalent —
every claim about it was "the problem is real" plus reasoning. `scripts/bench.mjs`
closes that, and it needs nobody to grade it.

**The answer key is already in git.** A commit message is a task and the files it
changed are the correct answer: *"Power belongs next to the name, offer button
right after"* → `DealsTable.tsx`. Nobody wrote those for this test, so they cannot
be tuned to what the map happens to know.

### Recall, over 300 real commits

| | R@1 | R@3 | R@12 | MRR | found nothing |
|---|---|---|---|---|---|
| **full map** | 37.0 % | 50.3 % | 65.0 % | **0.455** | 35.0 % |
| without stem fallback | 34.0 % | 46.3 % | 58.3 % | 0.414 | 41.7 % |
| without schema seeds | 36.0 % | 50.3 % | 64.3 % | 0.449 | 35.7 % |
| without ranking | 36.3 % | 50.7 % | 63.0 % | 0.451 | 37.0 % |
| without abbreviations | 37.0 % | 50.3 % | 65.0 % | 0.455 | 35.0 % |
| nothing but exact match | 33.3 % | 45.7 % | 55.7 % | 0.407 | 44.3 % |

- **Stem fallback is the clear win.** Removing it costs 9.3 points of recall and
  raises "found nothing" from 35 % to 42 %. This is the case embeddings are
  usually bought for, and here it is a `slice`.
- **Schema seeds and ranking are small**: 0.006 and 0.004 of MRR. Ranking earns
  its keep on "found nothing" (37 % → 35 %) rather than on position.
- **Abbreviations do nothing here** — and that turned out to be a fact about the
  test, not the feature.

### Ask it in a sentence, not a word

The table above gives each task up to five separate single-word queries and
keeps the best. Nobody gets five tries. Measured on the same 300 tasks, one
query each:

| one query, as a person would type it | R@1 | R@3 | R@12 | MRR |
|---|---|---|---|---|
| a single word | 18.7 % | 32.0 % | 44.7 % | 0.264 |
| **the whole sentence** | 35.7 % | 51.0 % | 65.7 % | **0.443** |

The sentence is worth **68 % more** than the best single word a person is
likely to pick. Until recently it was worth nothing at all: the map matched
the query as one literal string, so every multi-word question returned empty —
300 of 300. The benchmark had never noticed, because it fed the map one word
at a time.

What makes a sentence work is three things, each measured on its own:

| | MRR |
|---|---|
| matching the whole phrase literally | 0.000 |
| each word weighted by how rare it is | 0.351 |
| + the stem tried per word, not per query | 0.365 |
| + files that touch more of the question ranked higher | 0.424 |
| + an exact path segment counted apart from a substring | 0.443 |

Rarity weighting is what removes the need for a stopword list: a word that
hits a third of the project is dropped by its own weight, and `pre`, `cez`,
`the` and `for` need no special-casing in any language.

The last line is the one worth stealing. `zakazky` as a **whole path segment**
names a screen; `zakazky` inside `PoznamkaZakazky` is a fragment of a name.
Counting them as the same number is what made "on the Orders screen you see
orders, not fourteen filters" return `PoznamkaZakazky.tsx`. Splitting them
moved every mode at once — sentence 0.421 → 0.443, single word 0.251 → 0.264,
abbreviations 0.270 → 0.372.

### How a tuning idea gets rejected here

The obvious neighbouring idea — give the description more weight, since it is
the one part a person wrote — measured **+0.013 MRR** over 300 tasks. It was
dropped, because splitting the set in half showed +0.020 on one half and
**0.000** on the other. An improvement that lives in one half of the sample is
the sample, not an improvement.

`BENCH_SKIP=150 BENCH_N=150` exists for exactly this. It costs one extra run
and it has already killed one change that a single number said to keep.

### The test that could not test

A query in the table above is a word of six letters or more taken from a commit
message. `kwp` has three. Measured: **0.0 % of the 1114 queries were an
abbreviation** — not few, none. A feature the benchmark cannot reach does not
look ineffective; it looks absent. That is the more dangerous failure, because
the row is full of numbers and reads like a result.

So `bench.mjs skratky` asks the same repository the same way, but the query *is*
the abbreviation, over the 30 commits whose message contains one:

| | R@1 | R@3 | R@12 | MRR | found nothing |
|---|---|---|---|---|---|
| **full map** | 16.7 % | 33.3 % | 53.3 % | **0.270** | 46.7 % |
| without abbreviations | 13.3 % | 20.0 % | 40.0 % | 0.198 | 60.0 % |
| nothing but exact match | 3.3 % | 6.7 % | 36.7 % | 0.106 | 63.3 % |

n = 30 is small and the figures should be read as a direction, not a decimal.

### What the abbreviation rule had to become

The first version read keys sitting beside on-screen labels. Measured after the
fact: it changed **one line of 2478**. `kwh` is in 132 files and the map returned
nothing for it; `iban`, `xml` and `mwh` likewise.

Adding the abbreviation to all 132 would have been worse than returning nothing.
What works is **where the abbreviation lives, not where it is mentioned**:
`lib/calc/engine.ts` says `kwh` 104 times, the other 131 files 557 times between
them. Top three by count, nothing else. `iban` now answers `qrPlatba.ts`.

One trap on the way: an abbreviation must be matched as a whole segment of an
identifier. As a substring, `ean` sits inside `boolean` and `ico` inside
`unicode` — the first measurement reported 168 hits for `ean`, of which the
number that were real was zero.

### What recall cannot see

Recall counts what was found and says nothing about what was invented.
`bench.mjs pravda` checks whether the file a pointer names actually contains the
word that was asked for, over 829 queries:

| | pointers that hold up | modules hit, on average |
|---|---|---|
| exact match | 98.3 % | 7.3 |
| stem fallback | 29.1 % | 13.4 |

The 29 % is not a lie count. A stem match is *meant* to return a different form
of the word, so literal containment is the wrong test for it — the number that
matters beside it is the second column. The stem buys 9.3 points of recall and
pays with roughly twice the list to read, in the 28 % of queries where it fires.
That is a trade worth making, and now it is a trade with a price on it.

### What an answer costs

Ten realistic queries, measured as characters of output — what the agent
actually reads:

| | characters |
|---|---|
| ten answers from the map | 7 017 |
| the same ten as `git grep -il` | 37 646 |
| listing `src` once | 41 610 |
| the whole of `MAP.md` | 108 248 |

5.4× less than grep, and that understates it: grep returns paths, the map
returns paths **with a sentence about each**, so the reader stops there instead
of opening four files to find out which one it was. It also overstates it in the
other direction — grep is exact and the map can be stale. They answer different
questions; the point of the number is that asking the map first is cheap.

The map itself costs no model tokens to build. It is a script: 1301 modules in
under a second, run by a hook, never by a model.

### Reproducing it

```
node memex/scripts/bench.mjs                        # recall, words from commits
node memex/scripts/bench.mjs skratky                # recall, the query is an abbreviation
node memex/scripts/bench.mjs pravda                 # do the pointers hold up
MEMEX_ABLATE=stem node memex/scripts/bench.mjs      # with one part switched off
```

⚠️ These numbers describe **one repository at one moment**. Run it on yours; the
method transfers, the figures do not.

## What is measured, and what is only reasoned

The memory half of this plugin was measured properly: 22 questions, three runs,
blind judges, six arms, described further down. The map and the telemetry were
not, and it would be dishonest to let the first table lend them credibility.

The distinction that matters is between measuring that a **problem exists** and
measuring that a **fix helped**. Almost everything below is the first kind.

**Measured — the problem was real:**

| finding | number |
|---|---|
| components beside pages missing from the map | 223, of which 159 already had a header |
| files with no header that got a usable description from interface strings | 47 of 48 |
| reading the whole map vs. one lookup | ~34k tokens vs. 50–800 |
| `\b(?:nazov)` never matching the accented `názov:` | 6 occurrences invisible |
| a broad query before ranking was added | 145 hits, alphabetical |
| `unicode61 remove_diacritics` on Slovak | works, in both modes |
| JSON output proposed as a saving | 23 % **longer** than text |
| transcripts carrying edited file paths | 35 of 37 |
| median source file (against the case for slicing) | 123 lines |
| import targets used from more than one place | 504 of 1015 |

**Not measured — the fix is reasoning, not evidence:**

That the map lowers what a real task costs. That printing `file.tsx:246` saves a
round trip. That better ranking means less reading. That building the index in
the hook saves the turn it would take to build it by hand. Each is plausible and
none is demonstrated.

The plainest evidence for how open this is comes from the telemetry itself:

```
map used in 0 of 37 sessions
```

At the time of writing, the map has not been used once in real work. Every
number about it comes from its author testing it. The telemetry rows are
therefore a **baseline taken before**, not a result.

This is the reason `/memex:stats` refuses to print savings. The honest claim
today is: *the problems were verified, the design follows from them, and the
measurement to judge it is running.* Anything stronger would be advertising.

## What is not built yet

[ROADMAP.md](ROADMAP.md) lists every idea that was proposed and postponed, each
with the **measurable condition** that would make it worth building — index
slower than three seconds, trail past 30k tokens, median file past 400 lines.
It also records what was decided against and why, so those ideas do not come
back around every few months.

## Licence

MIT.
