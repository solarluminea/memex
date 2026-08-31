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

## How to use this file

When an idea arrives that is already here, the answer is the trigger, not a
fresh debate. When one arrives that is not here, it is worth thinking about.

And when a trigger fires, check the item still matters before building it — the
project may have moved somewhere the idea no longer fits.
