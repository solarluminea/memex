---
description: Save session transcripts out of Claude Code before it deletes them
---

Run this as **one** Bash command **in the background**
(`run_in_background: true`):

`node "${CLAUDE_PLUGIN_ROOT}/scripts/archive.mjs" && node "${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs" --index`

Not `--quiet` on either: that is the hook's mode, and it exits with zero and no
word when Node is too old for the index or the archive was never created — a
manual run would then report "done" over an index that was never built.

The first appends new turns to `.memex/archive/` (incrementally, so it is safe
to run daily); the second rebuilds the full-text index over them. Rebuilding
the index has taken 98.9 s on a real project, which is why it does not run in
the foreground. It is one command joined by `&&`, not two background jobs: the
index has to be built after the archive is written, and two jobs started
together give no order — the same race `udrzba.mjs` exists to prevent.

Tell the user it is running in one sentence and carry on. When it finishes,
report **one line**: how many sessions were added, or that nothing was new. If
it failed, say which step and the last line of the error.

Transcripts in `~/.claude/projects/` have a 30-day lifetime. Without this, the
project's history is silently erased and cannot be recovered afterwards.
