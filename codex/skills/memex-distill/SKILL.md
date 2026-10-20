---
name: memex-distill
description: Build the memex trail — walk archived session transcripts and write topics that point at exact line ranges. Use only when the user explicitly asks to distill, "go through the archive" or "update the memory". It is a long batch job that costs model tokens; never start it on your own.
---

# Distill the archive into a trail

The full procedure is the Claude Code distiller's instruction file:
`<plugin>/agents/distiller.md` (two directories up from this skill). Read it and
follow it, with these substitutions:

- `${CLAUDE_PLUGIN_ROOT}` means the plugin directory — the one that contains
  `scripts/` and `agents/`. Resolve it to a real absolute path **before** the
  first command. Never run a step with the literal placeholder: the outline
  step fails and the fallback is reading whole transcripts, which costs ~156×
  more.
- `/memex:archive` means `node <plugin>/scripts/codex.mjs` (Codex sessions)
  and `node <plugin>/scripts/archive.mjs` (Claude Code sessions, if any).
- Run it as a background or delegated task if your environment allows it; the
  transcripts it reads do not belong in the main conversation.

Write a trail, never a summary: a heading plus a pointer to `file#Lfrom-Lto`.
When done, report one line — how many transcripts and topics were added.
