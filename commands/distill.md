---
description: Walk the archive and build a trail — topics pointing at exact line ranges
---

Launch the `memex-distiller` subagent.

This is a batch job that takes tens of minutes and covers every transcript that
has no trail entries yet. Do not launch it on your own outside this command.

When it finishes, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.mjs` and tell
the user how many topics were added and whether anything is still uncovered.
