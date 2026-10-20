---
description: Walk the archive and build a trail — topics pointing at exact line ranges
---

Launch the `memex-distiller` subagent **in the background**
(`run_in_background: true`), tell the user in one sentence that it is running,
and carry on with whatever they were doing.

This is a batch job that takes tens of minutes and covers every transcript that
has no trail entries yet. Do not launch it on your own outside this command.
Run in the foreground it holds the session for all of that time, and nothing
it reads belongs in the main context anyway — the transcripts it walks are
exactly what it exists to keep out.

**Put this absolute path in the subagent's prompt, verbatim:**
`${CLAUDE_PLUGIN_ROOT}/scripts` — that is where its scripts are.

Why it has to be passed in: the placeholder is substituted in commands and
hooks, and it is not documented to be substituted inside an agent's own
instruction file. If it is not, the distiller runs `node /scripts/search.mjs`,
the outline step fails, and it falls back to reading whole transcripts — which
is the 156× more expensive path it exists to avoid. Passing the resolved path
costs one line and removes the question.

When it finishes, pass its one-line report on to the user as it is. Do not run
`status.mjs` again and do not expand on the report — the distiller has already
checked, and repeating it here only puts its output back into this context.
