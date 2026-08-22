---
description: Save session transcripts out of Claude Code before it deletes them
---

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/archive.mjs`, then
`node ${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs --index`.

The first appends new turns to `.memex/archive/` (incrementally, so it is safe
to run daily); the second rebuilds the full-text index over them.

Tell the user two lines only: how many sessions were added and how large the
archive is. If nothing was found, say so in one sentence and stop.

Transcripts in `~/.claude/projects/` have a 30-day lifetime. Without this, the
project's history is silently erased and cannot be recovered afterwards.
