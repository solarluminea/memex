#!/usr/bin/env node
/**
 * Save session transcripts before Claude Code deletes them.
 *
 * Transcripts in `~/.claude/projects/<project>/` have a **30-day lifetime**
 * (`cleanupPeriodDays`, the default). Without this the project's entire
 * history is silently erased and nothing can be recovered afterwards.
 *
 * Why not archive the whole JSONL — measured on eleven sessions of a real
 * project:
 *
 *   full archive                 467 MB
 *   of that base64 (screenshots) 281 MB  60.2%
 *   tool results                 106 MB  22.8%
 *   tool inputs                   23 MB   4.9%
 *   THE CONVERSATION             3.6 MB   0.8%  <- the only part with memory value
 *
 * The conversation is 1/130th of the archive. Nobody will ever go looking for
 * a Playwright screenshot or an `npm test` dump a month later; the sentence
 * "we tried it this way and it failed because…" they will. So only the
 * conversation is kept — 1.17M tokens instead of 35M, which is the difference
 * between "read the whole history" costing cents and costing hundreds.
 *
 * Tried and rejected: keeping truncated tool results (first 500 characters).
 * The archive grew 4x and did not gain a single searchable sentence — table
 * headers and file paths are not knowledge.
 *
 * What IS kept is a **compact summary of each tool call** (tool name, path,
 * Bash command up to 200 chars). Without it the archive records what was SAID
 * but not what was DONE: "fixed it" with no `[Tool: Edit src/lib/foo.ts]` next
 * to it cannot be traced back. Measured: the summaries cost 0.99M tokens on
 * top of 1.20M tokens of text, so the archive grows 45% and gains a trace of
 * every change.
 *
 * Incremental: a second run appends only new turns, based on the line count in
 * `.state.json`, so it is safe to run daily.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

/**
 * The project key Claude Code stores transcripts under.
 *
 * It is built from the absolute path by replacing the colon and both slash
 * kinds with a hyphen — `C:\Users\me\project` becomes `C--Users-me-project`.
 * Derived, never configured: a key written into a config file stops matching
 * the first time the directory is moved, and archiving then silently does
 * nothing.
 */
function projectKey(path) {
  return path.replace(/\\/g, '/').replace(/[:/]/g, '-');
}

const PROJECTS = join(homedir(), '.claude', 'projects');

/**
 * Locate the transcript directory: exact key first, then case-insensitively.
 *
 * Why both: on Windows the drive letter is sometimes upper- and sometimes
 * lower-case and the filesystem doesn't care — but on Linux that mismatch
 * would mean archiving from a directory that doesn't exist while the script
 * cheerfully reports "nothing new". A backup that silently doesn't run is
 * worse than no backup.
 */
function findTranscripts(key) {
  if (existsSync(join(PROJECTS, key))) return join(PROJECTS, key);
  if (!existsSync(PROJECTS)) return null;
  const hit = readdirSync(PROJECTS).find((f) => f.toLowerCase() === key.toLowerCase());
  return hit ? join(PROJECTS, hit) : null;
}

const PROJECT = process.env.MEMEX_PROJECT ?? projectKey(process.cwd());
const SOURCE = findTranscripts(PROJECT);
if (!SOURCE) {
  console.error(`Could not find this project's transcripts: ${join(PROJECTS, PROJECT)}`);
  console.error('Claude Code creates them on the first session inside the project directory.');
  console.error('If the directory is elsewhere, set MEMEX_PROJECT to its name.');
  process.exit(1);
}

const TARGET = process.env.MEMEX_ARCHIVE ?? join(process.cwd(), '.memex', 'archive');
const STATE = join(TARGET, '.state.json');

/** Content blocks that carry meaning. Everything else is tool exhaust. */
const blocks = (c) => (Array.isArray(c) ? c : typeof c === 'string' ? [{ type: 'text', text: c }] : []);

/** One line per tool call — what was done, not what came back. */
function toolSummary(b) {
  const i = b.input ?? {};
  if (['Read', 'Glob', 'Grep'].includes(b.name)) return `[Tool: ${b.name} ${i.file_path ?? i.pattern ?? ''}]`;
  if (['Edit', 'Write', 'NotebookEdit'].includes(b.name)) return `[Tool: ${b.name} ${i.file_path ?? i.notebook_path ?? ''}]`;
  if (b.name === 'Bash') return `[Tool: Bash] ${String(i.command ?? '').slice(0, 200)}`;
  return `[Tool: ${b.name}]`;
}

/** System injections are nobody's words — they don't belong in the archive. */
const SYSTEM_BLOCK = /^<(system-reminder|command-name|local-command|command-message)/;

function cleanText(t) {
  if (!t || SYSTEM_BLOCK.test(t.trim())) return '';
  // Drop base64 images — 281 MB of the 467 MB archive, and unsearchable anyway.
  return t.replace(/data:[a-z/]+;base64,[A-Za-z0-9+/=]+/g, '[image]').trim();
}

/**
 * The SessionEnd hook must never create the archive on its own.
 *
 * The plugin is installed per user, so its hook fires in every project you
 * open — and the first version happily created `.memex/archive/` in all of
 * them. In one project that broke the build outright: Tailwind v4 scans
 * everything not in `.gitignore`, session transcripts contain arbitrary text
 * including CSS escapes, and the build died on `Invalid code point`.
 *
 * A tool that writes into a project which never asked for it is wrong even
 * when nothing breaks. So: `/memex:archive` creates the directory once,
 * deliberately; the hook only keeps it up to date.
 */
const quiet = process.argv.includes('--quiet');
if (!existsSync(TARGET)) {
  if (quiet) process.exit(0);
  mkdirSync(TARGET, { recursive: true });
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
let newTurns = 0, newChars = 0, touched = 0;

const sessions = readdirSync(SOURCE).filter((f) => f.endsWith('.jsonl'));

for (const file of sessions) {
  const path = join(SOURCE, file);
  const key = basename(file, '.jsonl');
  const from = state[key]?.lines ?? 0;

  const out = join(TARGET, `${key}.md`);
  const firstTime = !existsSync(out);
  let line = 0, added = '';
  let day = state[key]?.day ?? '';

  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const r of reader) {
    line++;
    if (line <= from) continue;
    let j;
    try { j = JSON.parse(r); } catch { continue; }
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    const m = j.message;
    if (!m) continue;
    if (j.timestamp) day = j.timestamp.slice(0, 10);

    let text = '', calls = '';
    for (const b of blocks(m.content)) {
      if (b.type === 'text') text += cleanText(b.text);
      else if (b.type === 'tool_use') calls += toolSummary(b) + '\n';
    }
    if (text || calls) {
      const who = j.type === 'user' ? 'USER' : 'CLAUDE';
      const when = j.timestamp?.slice(0, 16).replace('T', ' ') ?? '?';
      const body = [text, calls && '```\n' + calls.trimEnd() + '\n```'].filter(Boolean).join('\n\n');
      added += `\n\n## ${who} - ${when}\n\n${body}`;
      newTurns++;
      newChars += body.length;
    }
  }

  if (firstTime) {
    const start = statSync(path).mtime.toISOString().slice(0, 10);
    writeFileSync(out, `---\nsession: ${key}\nproject: ${PROJECT}\ndate: ${day || start}\n---\n\n# Session ${day || start}\n`);
  }
  if (added) { appendFileSync(out, added); touched++; }
  state[key] = { lines: line, day };
}

writeFileSync(STATE, JSON.stringify(state, null, 2));

// `--quiet` is for the SessionEnd hook: when nothing was added there is nothing
// to print. A hook that says something every time you close a window starts
// being ignored — and with it the message that actually matters.
const mb = (x) => (x / 1048576).toFixed(2);
if (!quiet || touched > 0) {
  console.log(`Sessions: ${sessions.length}, appended to: ${touched}`);
  console.log(`New turns: ${newTurns} (${mb(newChars)} MB, ~${Math.round(newChars / 3.2 / 1000)}k tokens)`);
  console.log(`Archive: ${TARGET}`);
}
