# What is deliberately not built yet

Every item here was proposed, considered, and postponed — not forgotten. Each
one carries the condition that would make it worth doing, and that condition is
a **number you can check**, not a feeling that the time has come.

The reason for the format: a plugin that grows every good idea it is offered
ends up large, slow, and mostly unused. A plugin that refuses every idea stops
improving. The difference between the two is whether "not yet" is written down
with its trigger.

Most triggers below are readable from `/memex:stats` or a one-line command.
Check them; don't estimate them.

---

## Waiting on scale

These are correct designs for a project bigger than the one they were written
for. Building them now would add code that carries risk and returns nothing.

### Incremental full-text index

`search.mjs` drops and rebuilds the whole FTS table on every `--index`. Now
that the hook runs it at the end of every session, that cost is paid often.

**Trigger:** the index step takes more than ~3 seconds, or the archive passes
roughly 150 transcripts. Time it with
`time node memex/scripts/search.mjs --index`.

**Shape:** a table of `file → mtime`, and `DELETE FROM useky WHERE subor = ?`
for the changed ones only. Around twenty lines.

**Today:** 37 transcripts, well under a second.

### Hot and cold memory

Keep the last few weeks at full granularity and older sessions as topics only,
so the index stays small as the archive grows for years.

**Trigger:** `.search.db` passes ~50 MB, or a search takes longer than a second.

**Today:** the database is small enough that the question has not come up. Note
that this and the incremental index solve overlapping problems — do the
incremental one first and re-measure before starting this.

### Compressing the cold end of the archive

Transcripts are plain markdown. Measured on a real project: **65 MB across 37
sessions**, so a year of work runs to gigabytes. `node:zlib` would cut that by
roughly 85 % with no dependency.

**Trigger:** the archive passes ~500 MB, or archiving noticeably slows a
session end. Check with `du -sh .memex/archive`.

⚠️ **Weigh it against what the measurement rewarded.** The arm that scored
highest of everything tested was the raw archive searched with plain grep. A
gzipped file is not greppable by the tools an agent actually has, so this
trades away the strongest property for disk space, which is cheap. If it is
ever built: compress only sessions older than the trail already covers, and
leave recent ones as text.

### Decision threads

A topic that develops over months lives as a dozen unrelated trail entries.
Answering "how did our pricing rule evolve" means opening all of them.

This is the one weakness that measurement actually found: on questions whose
answer is the join of two entries from different sessions, **every** system
tested scored 2/6 to 4/6 — pointer, vector, and summary alike.

**Trigger:** `TRAIL.md` passes roughly 30k tokens, so it no longer fits
comfortably in one read. Check with `wc -c` on it and divide by three.

**Today:** 8k tokens on a real project. And measured there, only about six
topics recur across three or more days out of 153 — the phenomenon is real but
still small.

**Shape:** a `thread_key` in the entry, assigned explicitly by the distiller or
automatically only on an exact slug match within 30 days. Never fuzzy: merging
two unrelated decisions about "pricing" is worse than not merging them.

⚠️ Be honest about one thing when building it: a timeline of one-line summaries
("switched to margin by capacity") **is** a small retelling. Trail headings
already are. That is not a reason to avoid it, only a reason not to claim it is
a pure pointer.

### Checking `Superseded by`

The distiller is told to mark a replaced entry, but nothing verifies it
happened. `status.mjs` detects `Valid until:` and stops there.

**Trigger:** build it together with decision threads — alone it is a warning
about a field almost nothing uses yet.

---

## Waiting on evidence

These would help if a specific thing is true. Telemetry can now say whether it
is, so the honest move is to look before building.

### Typo tolerance in `map find`

A misspelt query returns nothing and the agent falls back to blind searching.
Roughly 25 lines of trigram matching, run only when a lookup returns zero, so
it costs nothing otherwise.

**Trigger:** lookups returning nothing are common. This is not counted yet —
adding a counter to `map.mjs find` is the first step, and it is smaller than
the feature.

### Carrying yesterday into today

A tiny `LAST_SESSION.json` — last edited files, open question, last commit — so
a fresh session resumes without asking.

**Trigger:** `steps before 1st edit` in `/memex:stats` is consistently high and
the transcripts show sessions opening with orientation rather than work.

**Cost to weigh:** something has to read it every session, which makes it
always-on. Memex's current always-on cost is about 310 tokens; this would
roughly double it. Claude Code's own `--continue` and `--resume` already cover
part of the need.

### Reverse import index ("blast radius")

Telling the agent which files import the one it is about to change. Measured on
a real project: **504 of 1015 import targets are used from more than one
place**, so the risk is real.

**Trigger:** telemetry shows edits clustering — a change followed by more
edits to other files shortly after, i.e. regressions being chased.

**Cost to weigh:** a regex import graph is wrong on aliases, re-exports and
dynamic imports, and a wrong impact list is worse than none. TypeScript's own
typecheck already catches interface breaks.

### Slicing a file to one function

`Read` with `offset`/`limit` already does this when the range is known.

**Trigger:** the median source file passes ~400 lines. Measured on a real
project: **median 123, 90th percentile 346** — nine files in ten are small
enough that reading the whole thing is cheap.

---

## Waiting on a different project

### Reading i18n dictionaries

Where the interface text lives in `messages/sk.json` rather than in the
component, the map extracts translation keys instead of words. The fix is a
small JSON loader that resolves `t('deals.kwp')` to its string.

**Trigger:** memex is used on a project that has `locales/`, `messages/` or
`i18n/`. The project it was built for has none, so the code would be untested
from the day it was written.

---

## Decided against

Not "later". These were considered and rejected, with the reason, so they don't
come back around every few months.

**A hand-written synonym glossary** (`kWp → vykonKwp, vykon, …`). It would be a
third list of the same thing beside the map and the code, and it is the one
that would drift, because nothing generates it. The pairing that ships —
`Power (powerKwp)`, read out of the source — is the same idea maintained by a
script. And a glossary flattens real distinctions: "power" is inverter power,
panel power, reserved capacity, and AC power, and one alias entry would merge
them all.

**Filling descriptions with unpaired keys.** Tried and reverted (the reasoning
is in `map.mjs`). A table has fifteen keys and there is no way to know which
two someone will search for; picking the first two added noise and missed the
one that was wanted.

**JSON output as a saving.** Measured on a real row: 111 characters against 90,
so **23 % longer**, not 40 % shorter. Field names and quotes are not free.

**A hard read limit** ("never open more than 3 files"). A quota gets satisfied
by reading in slices, which costs more calls and more tokens while looking
compliant. The principle — don't read widely before locating — is right; the
number is not.

**Formatting output for prompt cache alignment.** A CLI result arrives as a
tool result at the end of the prompt, past the cache breakpoints, which Claude
Code sets and a plugin cannot see. The instinct is right and the mechanism does
not apply.

**Indexing error messages from tool output.** It would require keeping tool
results, and dropping them is what makes the archive 3.6 MB instead of 467 MB.
Errors that were actually discussed are already in the archive as text;
measured, 1 transcript in 37 contains one.

**Writing generated descriptions back into source headers.** A plugin that
edits source files to improve its own index is a plugin that can corrupt a
repository. And the generated line is the weaker of the two: a human header
says *why the module exists*, which no extractor infers. Writing the weak
version in permanently is how the strong one never gets written.

**A scratchpad for work in progress.** Claude Code has `TodoWrite` and a
scratchpad directory already — measured on one project, `TodoWrite` appears 80
times across three sessions. A second mechanism for the same thing splits
state across two places, which is worse than either alone.

**Context modes per task type** (a "UI fix" not being allowed to read the
archive). Something has to classify the task before the work starts, and that
classification is itself a judgement that can be wrong — at which point the
rule blocks the lookup that would have helped. What it saves is one cheap
command.

**A hand-maintained entity ledger** (`Deal` → `deal.ts`, `DealsTable.tsx`,
table `deals`). Same objection as the glossary: a third list nothing
generates. The generated version of this idea is the reverse import index,
listed above with its trigger.

**Embeddings or a vector index.** On questions deliberately worded to share no
word with the stored entry — the case embeddings exist for — a plain index over
a greppable archive scored 6/6, the same as a vector one. Do not revisit this
without a measurement that beats that one.

---

## Built since this file was written

**File → sessions** (`search.mjs --file <path>`). The archive records a summary
of every tool call, so an edited path is written in it verbatim — measured, 35
of 37 transcripts carry them. That made the planned git-blame route
unnecessary: no commit trailers, no joining on dates, and it works on history
that already exists.

---

## How to use this file

When an idea arrives that is already here, the answer is the trigger, not a
fresh debate. When one arrives that is not here, it is worth thinking about.

And when a trigger fires, check the item still matters before building it — the
project may have moved somewhere the idea no longer fits.
