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

**Update, 2026-09-07 — the trigger fired, and then stopped firing.** Measured on
a real archive of 69 transcripts (15.4 MB, 28 505 chunks): the rebuild took
**128.5 seconds**, because `vloz.run()` ran in autocommit — 28 505 separate
transactions, each with its own fsync. One `BEGIN`/`COMMIT` pair around the
loop brought it to **1.19 seconds** with identical indexed rows, confirmed
afterwards at 1.221 s running from the installed 0.20.0.

The cost was not the point. The SessionEnd hook started the rebuild, the
session closed, and two minutes of work never finished — so the index sat three
transcripts behind while the archive and the map looked healthy and
`/memex:status` said one word about it: `built`. It was reported as a
persistent bug, and it was never the hook.

So the trigger above is now **unmet** — 1.2 seconds against a threshold of
three. This item stays deferred. Measure again before building it.

↳ **2026-10-22 — the trigger has fired on both counts.** The same project now
has 170 transcripts (30 MB, 50 424 chunks) and a full rebuild takes **5.3 to
8.8 s**. On the installed 0.23.0, whose four SessionEnd hooks still ran in
parallel, five rebuilds in three days were cut off mid-write and left 165 MB
of half-built indexes behind. Built in 0.27.0 — see "Built since this file was written". Note the trail now costs more to
read than the archive: 10 540 small files take 12.7 s to open on Windows
against 0.44 s for all 30 MB of transcripts, so an incremental index has to
skip unchanged trail files too, not only transcripts.

### Hot and cold memory

Keep the last few weeks at full granularity and older sessions as topics only,
so the index stays small as the archive grows for years.

**Trigger:** `.search.db` passes ~50 MB, or a search takes longer than a second.

**Today:** the database is small enough that the question has not come up. Note
that this and the incremental index solve overlapping problems — do the
incremental one first and re-measure before starting this.

↳ **2026-10-22: half of the trigger.** The index is 65.6 MB, and 85.5 MB with
the hidden text of trail topics (0.27.0). A search takes about 100 ms, far
under the second. Size alone is disk, which is cheap; leave it until a search
gets slow.

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

↳ **A cheaper version of this now exists and covers part of it.**
`search.mjs --file` lists sessions oldest first with their dates, so "how did
this file evolve" is answered without threading anything. A file is a better
axis than a topic: it is unambiguous and cannot merge with another by mistake.
What it does **not** cover is a decision that spans files — pricing rules living
in three modules — which is what the entry below is still for.

**Trigger:** `TRAIL.md` passes roughly 30k tokens, so it no longer fits
comfortably in one read. Check with `wc -c` on it and divide by three.

**Today:** 8k tokens on a real project. And measured there, only about six
topics recur across three or more days out of 153 — the phenomenon is real but
still small.

↳ **2026-09-09: 11.9k tokens at 260 topics** (38 kB), still under the
threshold. What changed is that the number stopped being the price of every
question: tiered lookup (built in 0.25.0, see below) answers one for 832
tokens and reads the index only as a fallback. The pressure this entry was
under came from that cost, not from threading — and threading remains the only
answer to a decision that spans files.

↳ **2026-10-22: 3.1 MB, about a million tokens, at 10 536 topics** — the
trigger is passed a hundred times over, and the full read stopped being a
fallback at all: it cannot be read. What took its place is cheaper than
threading: trail topics are now searched in the text they point at (0.27.0),
which brings a paraphrase from 2.4 % to 80.8 % within the first four. Threads
remain the answer only to the narrower question — one decision across files
and months — and that question now has no measurement behind it. Build a
test set of such questions before building this.

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

**Trigger:** lookups returning nothing are common.

↳ **The counter now exists** (0.24.0). A lookup that returns nothing appends one
line to `.memex/map-misses.jsonl` — the query and the time, nothing else. It is
skipped in `--batch`, so a benchmark's three hundred queries cannot poison the
sample, and in a project with no `.memex/`, which never asked for it.

So the trigger is now readable instead of estimated: `wc -l` on that file
against the number of lookups in `/memex:stats`. Nothing has been collected
yet — the honest state is "counting has started", not "the misses are rare".
Read it after a few weeks of real work, and look at *what* missed as well as
how often: a misspelling is the case this feature is for, while a query for a
word that genuinely is not in the repository is grep's cue and no amount of
trigram matching will help it.

### Carrying yesterday into today

A tiny `LAST_SESSION.json` — last edited files, open question, last commit — so
a fresh session resumes without asking.

**Trigger:** `steps before 1st edit` in `/memex:stats` is consistently high and
the transcripts show sessions opening with orientation rather than work.

**Cost to weigh:** something has to read it every session, which makes it
always-on. Memex's current always-on cost is about 310 tokens; this would
roughly double it. Claude Code's own `--continue` and `--resume` already cover
part of the need.

↳ **2026-10-22: the cost side of this was weighed in the wrong unit.**
`kontext.mjs` over 68 000 API calls: the average context is 257k tokens, and
reading it again from cache on every call is 71 % of the price. A few hundred
always-on tokens are a tenth of a percent of one call. What does cost is
context that grows: 74 % of the price falls on calls above 200k. So the
question for this entry is no longer "is 300 tokens too many" but "does it
let a session be cleared or compacted earlier" — a small pointer that makes
a fresh session as good as a 600k one pays for itself many times over. Still
unmeasured; measure it as that.

### Reverse import index ("blast radius")

Telling the agent which files import the one it is about to change. Measured on
a real project: **504 of 1015 import targets are used from more than one
place**, so the risk is real.

**Trigger:** telemetry shows edits clustering — a change followed by more
edits to other files shortly after, i.e. regressions being chased.

**Cost to weigh:** TypeScript's own typecheck already catches interface breaks,
so the graph only adds value for changes that compile and still break something.

**The regex-versus-parser question is settled, and regex won.** Both methods
were run over 1 341 real source files and their results compared:

| | |
|---|---|
| identical result | 1 325 files (98.8 %) |
| false positives from regex | **1**, in the whole project |
| missed by regex | 23, all of one kind: `import './x.css'` with no `from` |
| AST parse time | 1 441 ms total, 1.1 ms per file |

The one systematic gap is side-effect imports, which a single extra pattern
fixes and which an impact graph does not care about anyway. So a parser here
would buy 1.2 % accuracy that is free by other means.

Note what this does **not** settle. Imports are the easy case: the module name
is a string literal in a fixed position. A **call graph** — needed for tracing a
button through to a database write — is where regex fails structurally: it
cannot tell a definition from a call, cannot follow a function through a
variable or an object property, and cannot resolve a re-export. If that is ever
wanted, it needs a real parser, and Serena already does it well enough that
writing another one would be hard to justify.

### Files that change together

Counting how often two files appear in the same commit, and showing the strong
pairs beside a lookup. It answers the same question as the import index — "what
else does this touch" — from history rather than from parsing, which cannot be
wrong about aliases or re-exports.

Measured on 400 commits of a real project: **68 strong pairs out of 6 890**
(four or more shared commits and a 60 % overlap). The pairs are sensible —
a component with its logic module, a module with its test, a schema with its
data layer.

**Trigger:** the same one as the import index — telemetry showing edits
clustering, i.e. regressions being chased. Build **this** rather than the
import graph if it comes to that: git history is a fact, a regex over imports
is a guess.

**Cost to weigh:** 1 % of pairs are strong, so most files gain nothing, and
most of the strong ones are already obvious from the filename (`x.ts` with
`x.test.ts`). Big commits have to be excluded or everything correlates with
`package-lock.json`.

### Shared keys across layers

A field name is a contract: `vykonKwp` appears as a column key in the table, as
a form field in the action, and as a column in the schema. Listing where one key
appears gives the vertical slice — UI to database — that a call graph would,
without a parser, and it cannot be wrong: an identifier either occurs or it does
not.

Measured: of 121 keys found in the source, **24 span two or more layers and 20
of those are also columns in the Prisma schema**. The examples are exactly the
ones you would want — `dealId` across an action, three screens and two logic
modules; `vykonMenicovKw` across an API route and three screens.

**Trigger:** evidence that finding the other end of a contract costs turns.
Not built, for one reason: `grep -rl vykonKwp src/` already returns the same
files. The gap it would close is narrow — knowing **which** keys are worth
grepping without being told — and that is a list of 24 lines, not a feature.

### Better questions, not better ranking

The map's remaining loss is ordering (see *Where the map's loss actually is*),
and two ideas aimed at it were measured and rejected. What neither tried is a
signal about the **question** rather than about the file: which of its words
name the subject and which are incidental. "Move the power column in the deals
table" is about a table and a column; "so that the offer does not send twice"
is about sending. Today every word above the rarity floor votes equally.

**Why it is not obvious.** Word order and part of speech would need a parser
for Slovak, which does not exist here and is the kind of dependency this tool
refuses. A cheap proxy might be position — a sentence in this repository's
commits tends to name its subject early — or the query word that matches the
*fewest* files carrying the most weight, which is a sharper version of what
rarity weighting already does.

**Trigger:** none proposed yet. This entry exists so the next person aiming at
ranking starts from where the loss is rather than from the weights, which have
now been swept twice with nothing to show for it.

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

**Filling descriptions with *any* unpaired key.** Tried and reverted: a table
has fifteen keys and "the first two" added `mesacnaPlatba` while missing the
`vykonKwp` that was wanted.

↳ **The narrow version of this was later built and works.** The flaw was the
selection, not the idea. A key carrying an abbreviation or a unit — `kWp`,
`DPH`, `IČO` — is never in the label, because the screen says "Power", and is
exactly what a person searches by. Measured: of 16 files with keys, **2** have
such a key outside the label, one of them the case that started all this. A
heuristic that adds one word to two files beats one that adds two words to
every file.

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

**Indexing *whole* tool outputs to catch errors.** Dropping tool results is
what makes the archive 3.6 MB instead of 467 MB, and truncating everything to
500 characters grew it fourfold while adding no searchable sentence.

↳ **One line per failure was measured separately and built.** The rejection
had generalised from "all output" to "any output", and the numbers are not
close: keeping a single line, deduplicated per session, and only where it names
a compiler error or a failed assertion, costs **0.28 %** of the archive — 403
lines across 38 sessions, of which 383 point at real source files. A failing
type-check is the one kind of tool output somebody looks for again later.

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

**Tracing UI → action → database automatically.** Presented as showing the
whole vertical slice in four lines. To do it correctly needs a call graph, which
needs an AST parser, which is the thing this plugin does not have and Serena
does better. A regex approximation would be right most of the time, and a trace
that is right most of the time is worse than none: it is confidently wrong in
exactly the cases nobody checks.

**Inferring where new code should go.** The idea is to answer "where does an
invoice exporter belong" from the shape of the repository. Conventions worth
following are usually already written down — this project states them in
`CLAUDE.md` in four lines — and inferring them from folder layout produces a
confident answer with nothing behind it. A convention a human wrote is a
decision; one a script guessed is a coincidence.

**Automatically extracting rules from corrections.** Watching for "no, in this
project we do X" and turning it into a permanent rule injected into every
session. Two problems and both are bad: most corrections are local ("not in
this file"), so promoting them to global produces rules that are wrong in most
places they now apply; and nothing deletes them, so a mistaken rule outlives
everyone who remembers where it came from. `CLAUDE.md` does this already, and
the fact that a person writes it is the feature, not the friction.

**A tighter output format** (`path|line|desc` instead of `path:line — desc`).
Measured on a real record: 74 characters against 82, so **10 % shorter** — about
30 tokens across a twelve-line result. That is not worth a format that a person
reading the map has to decode. The same measurement kills JSON again at +20 %.

**A linter for the rules in `CLAUDE.md`.** Proposed as the safe version of
learning rules automatically, and the reframing is right — guard the rules a
person wrote instead of inventing new ones. But the rules worth guarding are
prose ("Slovak everywhere", "no hex colours in components"), and turning them
into machine-checkable patterns means maintaining a second list beside them.
ESLint exists, is already in most projects, and is better at this.

**A scaffold command** showing the file layout of a similar module. `ls` shows
the same thing, and grouping the result by role (page, table, actions) needs the
guessing the idea was meant to avoid.

**Carrying yesterday forward on demand** (`--last`). The always-on objection was
answered properly: read it only when someone says "continue". What remains is
that Claude Code has `--continue` and `--resume`, which restore the actual
conversation rather than a summary of it. Revisit if that stops being true.

**Returning only the top hit when its score is far ahead.** The reasoning is
sound — extra candidates in the context are things the model can be distracted
by. But the failure mode is asymmetric: three results of which one is right
costs a little attention; **one result that is wrong costs a whole search**, and
the agent has nothing to fall back on. The scoring here is deliberately crude
(where the word matched, then what share of the filename it is), which is enough
to order a list and not enough to bet a turn on. Where the evidence really is
unambiguous the list is already short: measured across ten queries, `kwp`
returns 1 result, `zmluva` and `dotacia` 2.

**Stripping diacritics from tool output to save tokens.** Claimed at 45 %.
Two problems. First the size: a typical result line is 82 characters of which
**3 carry diacritics** — the rest is an ASCII path — so there is almost nothing
to strip. Second and worse, the descriptions are *quotations from the source*.
Print `Obchodny pripad` and an agent that greps for it finds nothing, because
the code says `Obchodný prípad`. It would trade a rounding error in tokens for
a class of silent search failures.

The underlying observation is still true and worth knowing: an inflected
language with diacritics costs meaningfully more tokens per character than
English. It is not measurable from transcripts alone — `output_tokens` includes
reasoning that never appears in the text — so no number is quoted here rather
than a wrong one.

**"You are forbidden to look for alternative files."** The third framing of a
hard rule on how many things may be read, and it fails the same way as the
first two: a quota gets satisfied, not obeyed. There is a real point inside it
though — an agent handed `file.tsx:246` should read a window there rather than
the whole file — and that is now in `commands/map.md` as guidance, phrased as
what to do rather than what is banned.

**"Do not search for the same thing twice in one session."** Long sessions do
accumulate stale search results, but the remedy is context compaction, which
the harness already does. A rule cannot know whether the second lookup is
redundant or whether the file changed underneath in the meantime — and on this
project it demonstrably does: a column disappeared between two runs of the same
query, two hours apart.

**Embeddings or a vector index.** On questions deliberately worded to share no
word with the stored entry — the case embeddings exist for — a plain index over
a greppable archive scored 6/6, the same as a vector one. Do not revisit this
without a measurement that beats that one.

↳ **But that measurement tested synonyms, not inflection**, and the gap was
real. In Slovak — in any inflected language — the ending changes and the stem
does not: "faktúrami", "faktúr", "faktúrou". Measured on eight such queries,
five returned nothing at all. The fix is not vectors, it is `slice`: when an
exact lookup finds nothing, retry on the stem. Those five then returned 52, 82,
37, 15 and 1 module. Built, and only as a fallback — a stem applied eagerly
turns fifteen hits into a hundred and fifty.

---

## Built since this file was written

**Incremental full-text index** (0.27.0). The trigger above fired. The index
remembers which transcripts and trail files it knows by size and time; a
transcript that grew is re-indexed from its last chunk — chunking restarts
cleanly at a chunk boundary, and a hash of everything before it proves the
file was only appended to — and trail topics are redone only where their
range reaches the changed part. One transaction over the live index. On a
copy of the real archive: 7.7 s → 1.5 s, 0.9 s with nothing new. The same
release made the archiver incremental (8.3 s → 0.18 s) and found that it had
been stuck for a week on one corrupt source line.

**Compaction hooks** (0.27.0). `PreCompact` archives and indexes; a
`SessionStart` hook on `compact` points at the archive in two sentences.

**Trail topics searched in what they point at** (0.27.0). The paraphrase
weakness above, closed without embeddings: up to 2 000 characters of each
pointer's range are indexed beside the heading and never printed. Heading
weighted 3 : 1 against that text. `bench.mjs parafraza`, 537 topics: R@4
2.4 % → 80.8 %, MRR 0.019 → 0.688 on questions built from words the heading
does not contain; heading-word questions 0.993 → 0.988. At 6 : 1 the second
set is 0.996 and the first only 0.610.

**Map cache** (0.27.0). Every `find` rebuilt the whole map: 12–14 s on 2 593
modules. Per-file analysis is kept in the system temp directory and reused
while the file's time and size match; output identical, `bench.mjs veta`
identical to three decimals, a repeated lookup 2.0 s.

**Where the tokens go** (`kontext.mjs`, 0.27.0). See the entry on carrying
yesterday into today: read from cache is 71 % of the price, and the measure
that matters is context size times the calls that carry it.

**Tiered memory lookup** (0.25.0). Every memory question used to start by
reading the whole trail index — measured, **11 891 tokens** at 260 topics, and
one line longer with every topic. A search now returns curated trail topics,
derived topics and passages in one answer: **832 tokens on five real
questions, 15.3× less**. The full read stays as the fallback because it is the
only tier that survives a paraphrase — heading search finds the right entry
57.7 % of the time and **0 %** when the question deliberately shares no word
with the heading.

**Auto-trail, as a searchable tier** (0.25.0). The trail is the best-measured
half of the memory and the one that falls behind, because only a model can
write it. Two things already in the archive are shaped like entries and cost
nothing: a heading Claude wrote in an answer, and a question the user asked.
Measured against a real trail of 436 pointers — headings reach 53.2 %, user
questions 30.5 %, either **69.3 %**. On that project it is 5 493 derived topics
beside 436 curated ones.

They are never written into `TRAIL.md` and never called a trail: there are
thousands, so they can be searched and not read, and a heading from a model is
a small retelling, which this file concedes rather than hides. What is still
unmeasured is their **precision** — coverage says they land near what a person
recorded, not that a match is right. Sample fifty before trusting them further.

**Symbol outline** (0.25.0). This file rejected "slicing a file to one
function" because the median source file is 123 lines. That was the wrong
number: the median large **read** is 210 lines and 5 of them get edited. On 152
real read-then-edit pairs, where a declaration is visible above the edit it
sits a median **12 lines** below it and 74 % within forty; the outline is 3 %
of the length of the read. `map.mjs outline <file>` prints declarations with
line numbers, and `map find` now carries a line for non-UI files too.

⚠️ Lower bound, not a ceiling: 70 of those 152 reads began mid-function, so no
declaration was in view at all. A whole-file outline reaches those; the
measurement could not.

**Trail topic beside a file's history** (0.25.0). `search.mjs --file` prints
the nearest trail topic above each hit, with the distance. Deliberately
phrased as proximity: from the topics' side the signal looks strong (66 % have
an edit within 300 lines after them), but from the side that applies here only
**12 %** of 6 824 edits have a topic within 300 lines before them. There are
436 topics and fifteen times as many edits, so the first number says almost
nothing about this feature.

**File → sessions** (`search.mjs --file <path>`). The archive records a summary
of every tool call, so an edited path is written in it verbatim — measured, 35
of 37 transcripts carry them. That made the planned git-blame route
unnecessary: no commit trailers, no joining on dates, and it works on history
that already exists.

**Renamed files** (`search.mjs --file`). A path is not a stable identity:
measured, 24 renames in 300 commits, including a whole folder moving from
`src/app/vykup/` to `src/components/sprostredkovanie/`. The lookup now asks git
for former names and searches under those too. Before the fix it returned a
fraction of the history and looked like a complete answer, which is the worst
way to be wrong.

**Stem fallback, abbreviation keys, and failure lines** — all three came out of
re-reading the rejections above and finding that each had thrown out a good
idea along with a bad implementation. Details in the entries they belong to.

**File history in date order** (`search.mjs --file`). Sessions now print oldest
first with the day from the transcript frontmatter, which turns "which sessions
touched this" into "how did this file evolve" for the cost of one sort.

---

## Measured and left out

These were proposed as concrete patches, applied to a copy, and run against
`bench.mjs` on 300 commits. None is a bad idea; none showed a benefit here.
They are written down so the next person offering them gets a number instead
of an opinion — and so that a repository where they *would* help can tell.

### Wider capture of interface keys

Read `name="sadzbaDph"` and `data-testid=` as well as `key: 'value'`, and widen
the label-to-key window from 6 lines to 12.

Applied: changed 2 modules of 1301, R@1/R@3/R@12/MRR identical to three
decimals. Looking at the two lines explains why. One gained key names and lost
"Nový obchodný prípad" to the line limit — a label a person would actually type,
traded for `mesacnaPlatba`. The other gained `(q)`, the key of a search box.

**Trigger:** a repository whose forms are JSX-attribute-driven rather than
column-definition-driven. Check with
`git grep -c 'name="' -- src | wc -l` against `git grep -c "accessorKey" -- src | wc -l`.
If the first is several times the second, this is worth re-running.

### Shorter schema fields as bridges

Lower the minimum field length from 8 characters to 6. Note that the length is
written in two places — `schemaFields()` and `identifiers()` — and changing only
the first does nothing at all; the proposal as offered was inert.

Changed properly, it touches 34 modules and moves no metric. The additions
split evenly between real bridges (`vozidlo`, `clenovia`, `odbory`, `krosRad`)
and words that bridge nothing (`pridane`, `pouzita`, `zacalo`).

**Trigger:** `bench.mjs` R@3 rising by more than 1.5 points with the threshold
lowered in both places. Until then the rule stands: do not add what cannot be
shown to help, because every added term is one more thing that can go stale.

### Different ranking weights

Filename 6, description 4, directory 1, instead of 4 / 1 / 2.

Moved R@3 by 0.4 points — one task of 300 — and nothing else. Ranking as a
whole is worth 0.004 of MRR (see the ablation table in the README), so tuning
its weights is polishing a part that is not where the loss is.

**Trigger:** none proposed. If ranking ever becomes worth more than ~0.02 of
MRR in the ablation, the weights inside it become worth arguing about.

### A note on where these numbers came from

The proposals arrived with a before/after table showing +9.3 points of recall.
Those figures are this project's own ablation rows — "full map" and "nothing but
exact match" — relabelled as before and after. The worked examples named
`DetailKlienta.tsx`, `FakturacnyFormular.tsx`, `kalkulackaSpotreby.ts` and
`src/db/schema.ts`; none of the four exists in the repository. Two "found
nothing" claims were also wrong: `kwp` returned one module and `ico` twelve.

This is not a reason to ignore proposals from a model — the capture-width idea
was worth the twenty minutes it took to disprove, and the abbreviation finding
came out of taking the criticism seriously. It is a reason to apply the patch
to a copy and run the benchmark before believing the table that came with it.

---

### A linguistically correct stem

The stem is a blunt cut: three characters off, four left at minimum. The
obvious improvement is to strip real Slovak endings instead — `ami`, `ach`,
`och`, `ou`, `mi`, `ia`.

Measured on sentence queries: the crude cut 0.374, the ending list **0.370**,
a two-character cut 0.366, and trying progressively shorter cuts 0.369. On
single-word queries the ending list is worse again (0.199 against 0.206).

The reason is worth keeping: the terms in the map are inflected and compounded
too, so a *correct* stem lands on a form that may not appear on either side.
A shorter prefix is more forgiving than a right answer. Linguistic precision
lost to a `slice`, and it lost on every mode tried.

**Trigger:** none. If someone wants to revisit it, the bar is beating 0.374 on
`bench.mjs veta` and 0.206 on `BENCH_W=1 bench.mjs`, on both halves.

### A short passage scored by its neighbours

Chunk size is a trade — 2 000 characters had the best MRR and four times the
reading. The idea was to keep 400-character pointers but score each by its
own bm25 plus a share of its neighbours', so a short pointer would rank as if
it were long. Measured on 600 topics over 50 424 chunks, 2026-10-22: on whole
headings +0.006 at a neighbour weight of 0.3 and −0.015 at 0.5; on
four-word questions **−0.032 and −0.096**. A neighbour that matches is as
often another topic as the same one.

**Trigger:** none.

### A longer list of results

The map prints twelve. Recall keeps climbing past that: R@6 49.0 %, R@12
56.7 %, R@20 62.0 %, R@30 65.7 %, R@50 73.7 % — but MRR only moves 0.366 →
0.381 across the whole range, because everything gained sits at ranks nobody
reaches without reading the twelve above it.

Going from 12 to 20 costs eight lines on **every** query and buys sixteen more
correct answers over three hundred — about 150 extra lines per answer gained.

**Trigger:** a use where the reader does not pay per line, such as a tool that
filters the list itself rather than putting it in a context window.

---

### Weighting a hidden term by how often it appears

Hidden terms are yes/no. A term appearing forty times in a file is what the
file is about; a term appearing once is a mention. Doubling the weight above a
frequency threshold: 3 → 0.578, 5 → 0.563, 10 → 0.568, 20 → 0.571, against
0.572 for the flat version. The best of those is inside the noise and the rest
are worse.

**Trigger:** none proposed. Rarity across files already does the work that
frequency within a file was supposed to add.

### Files that change together

Co-change coupling from git: if a query lands on one file, its frequent
co-committed siblings are probably relevant too. A real technique, and it can
be measured without leaking the answer by learning only from commits **older**
than the evaluated ones.

Learned from 330 older commits: 2096 co-changed pairs, of which 58 are strong
enough to mean anything (three or more shared commits, and at least a third of
either file's changes). That covers 59 files of 1304.

The upper bound was measured before building anything: of the 55 tasks the map
currently fails, coupling would reach the right file in **one**. 0.3 % of the
set, for a git dependency in the map and a scoring branch.

**Trigger:** a repository with a much longer history — the coupling table is
thin because only 330 commits were available to learn from. Re-run the
upper-bound check first; it costs one script and no implementation.

---

### Commit messages as hidden terms

A commit message is a sentence a person wrote about a file, in their own
words. The upper bound looked excellent: of 66 tasks the map fails, **43
(65 %)** have a query word somewhere in the older commits of the right file.

Built and measured, 2026-09-09, learning only from commits older than every
evaluated task (`MEMEX_GIT_PRED`), which is stricter than production:

| sentence query, MRR | whole | 1st half | 2nd half |
|---|---|---|---|
| baseline | 0.576 | 0.610 | 0.542 |
| all words, ≤15 commits per file | 0.571 | 0.599 | 0.542 |
| only words in ≤3 % of commits | 0.571 | 0.599 | 0.542 |
| only words in ≤1 % of commits | 0.572 | 0.603 | 0.541 |

Single-word queries 0.451 → 0.445. Truthful pointers 92.4 % → 89.9 %. The
words that would have rescued the 43 rescued them and pulled other files up
by the same amount; an upper bound counts the first and not the second.
Removed from the code. **Trigger:** none — three variants, three flat lines.

### Recency as a ranking signal

Of 50 tasks where the right file is in the candidate set but ranked past
twelve, **50 %** had that file in the 20 commits before the task, while only
6 % of candidates are that fresh — a likelihood ratio near eight. Measured
per task, with recency computed from commits before each one:

| 20 commits, sentence query | R@1 | R@12 | MRR whole | 2nd half |
|---|---|---|---|---|
| baseline | 47.3 % | 78.0 % | 0.582 | 0.548 |
| score × 1.25 if fresh | 47.0 % | 79.0 % | 0.581 | 0.539 |
| score × 1.5 | 46.7 % | 80.0 % | 0.578 | 0.536 |
| score × 2 | 44.7 % | 80.3 % | 0.567 | 0.521 |
| fresh wins ties only | 47.3 % | 78.0 % | 0.582 | 0.548 |
| + 0.3 × median score | 47.3 % | 78.0 % | 0.583 | 0.549 |

As a multiplier it buys the tail with the head — R@12 up, R@1 and the second
half down. As a tie-break or an additive nudge it does nothing. The signal is
real and the ranker cannot use it: the files it would promote are already
ranked by evidence, and freshness is not evidence about *this* question.
**Trigger:** none.

### Tuning variants do not add up — measure them in combination

Not a rejected feature but a rejected *method*, and it cost two sweeps to see.
Three knobs of the ranker were swept on the old baseline, where coverage was a
count of matched words. Two of them looked like small wins. Then coverage was
changed to sum the words' rarity, and the same knobs were swept again:

| variant | on the old baseline | on the new one |
|---|---|---|
| baseline | 0.576 | **0.597** |
| description weight 2 → 1 | 0.583 (+0.007) | 0.591 (−0.006) |
| hidden-term weight 1 → 2 | 0.579 (+0.003) | 0.589 (−0.008) |
| both | — | 0.585 (−0.012) |

Every knob that helped before hurts now, and it is not noise: all three point
the same way and the effect is larger than the gains they originally showed.

The reason is that all four were answering the same question — how much each
kind of evidence should count — and weighting coverage by rarity answers it at
the root. Once the principled version is in, the compensating hacks become
what they always were: corrections for a mis-weighted term.

Two of them do raise R@12 (80.0 → 81.3 %, and 81.7 % together) while lowering
MRR and R@1. That is the same trade recency offered and it is refused for the
same reason: a first result the reader can act on beats a longer list they
have to work through.

**The rule this leaves:** a sweep is valid only against the baseline it was run
on. When any part of the ranker changes, previous sweeps expire — re-run them
before quoting them, and never sum two measured gains.

### Where the map's loss actually is

Worth writing down because it reframes two entries above. Of 300 sentence
tasks, 66 miss the top twelve. In **50 of them the right file is in the
candidate set** and ranked lower — median position 31 — and in only 16 is it
absent. So three quarters of the remaining loss is ordering, not vocabulary,
which is the opposite of what the ablation table suggests (ranking worth
0.027). The ablation measured removing the ranker; this measures its ceiling.
Neither recency nor commit words closed it. What might: a signal about the
*question*, not the file — which of the query's words is the subject and
which are incidental. Nothing cheap does that yet.

## How to use this file

When an idea arrives that is already here, the answer is the trigger, not a
fresh debate. When one arrives that is not here, it is worth thinking about.

And when a trigger fires, check the item still matters before building it — the
project may have moved somewhere the idea no longer fits.
