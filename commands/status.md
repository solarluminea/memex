---
description: Memory health — what's archived, what's indexed, what has no trail yet
---

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.mjs` and summarise the output in
your own words — do not paste it.

**Never answer "yes, it works" from anything but this script's verdict.** The
last line is either `Healthy: …` or `NOT HEALTHY — n problem(s)`, and the exit
code matches. If you did not run the script in this session, say you have not
checked instead of reassuring. Zeros are not health: a project with `0
transcripts` is one where nothing is being archived at all.

Do not check by hand with `ls .memex/` or by searching for `TRAIL.md`. Paths are
configurable in `memex.json` and a project may keep its archive and trail under
names of its own — the script prints a `Config` line when that is the case.
Looking for the default names and concluding "it does not exist" is a mistake
that has already been made.

If transcripts have no trail entries, suggest running the distiller. If it
reports pointers into nothing or past the end of a transcript, report that as a
defect to fix and offer to go through those entries.

If the report says sessions are missing from the archive or the index is behind,
offer `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.mjs --oprav`, which archives
what is missing, rebuilds the index and rewrites the trail index. It will not
create the archive in a project that never opted in, and it will not write trail
entries — that needs the distiller. When the user accepts, run it in the
background (`run_in_background: true`) — the index rebuild can take minutes —
and when it finishes report one line: healthy now, or what is still wrong.

If it warns that unarchived sessions are near the 30-day deletion, treat it as
urgent: those transcripts cannot be recovered afterwards.
