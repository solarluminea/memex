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
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { kde } from './kde.mjs';
import { archivuj } from './archivator.mjs';

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

const PROJECT = process.env.MEMEX_PROJECT ?? projectKey(process.env.MEMEX_PROJECT_ROOT || process.cwd());
const SOURCE = findTranscripts(PROJECT);
if (!SOURCE) {
  console.error(`Could not find this project's transcripts: ${join(PROJECTS, PROJECT)}`);
  console.error('Claude Code creates them on the first session inside the project directory.');
  console.error('If the directory is elsewhere, set MEMEX_PROJECT to its name.');
  process.exit(1);
}

const TARGET = kde().archive;

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

/*
  The one line of a tool result worth keeping.

  Dropping tool results is what makes this archive 3.6 MB instead of 467 MB, and
  a truncation experiment (first 500 characters of everything) grew it fourfold
  while adding no searchable sentence. That measurement is what this rule is
  carved out of, and the carve-out is narrow on purpose: **one line**, and only
  when it names a failure.

  Measured on three real transcripts: 32 such lines, 8.3 kB, which is 0.047 % of
  the archive. The reason to keep them is that a compiler error or a failing
  assertion is the one kind of tool output somebody searches for later — "we've
  seen this before" is worth a tenth of a percent.

  The pattern is deliberately anchored to line starts and known formats. An
  unanchored /error/ matches every JSON payload with an `error` field, which is
  how the first version filled up with API responses that failed at nothing.
*/
const FAILURE = /^\s*(Error:|Uncaught |[\w./\\-]+\(\d+,\d+\): error TS\d+|error TS\d+|FAIL |AssertionError|Traceback \(most recent)/;

function failureLine(result) {
  const text = typeof result === 'string' ? result : '';
  if (!text) return null;
  for (const l of text.split('\n')) {
    if (FAILURE.test(l)) return l.trim().slice(0, 160);
  }
  return null;
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

await archivuj({
  zdroj: SOURCE, cieľ: TARGET, projekt: PROJECT, ticho: quiet,
  preved(j, zlyhania) {
    if (j.type !== 'user' && j.type !== 'assistant') return null;
    if (!j.message) return null;
    const texty = [], volania = [];
    for (const b of blocks(j.message.content)) {
      if (b.type === 'text') texty.push(cleanText(b.text));
      else if (b.type === 'tool_use') volania.push(toolSummary(b));
      else if (b.type === 'tool_result') {
        const chyba = failureLine(b.content);
        if (chyba && !zlyhania.has(chyba)) { zlyhania.add(chyba); volania.push('[Failed] ' + chyba); }
      }
    }
    const text = texty.filter(Boolean).join('');
    const plot = String.fromCharCode(96).repeat(3);
    /*
      `trimEnd()` na konci bloku volaní, nie ozdoba.

      Príkaz Basha sa do zhrnutia orezáva na 200 znakov a rez môže padnúť na
      koniec riadku. Bez orezania zostane pred zatváracím plotom prázdny
      riadok — a keďže je *vnútri* bloku, neodstráni ho ani normalizácia,
      ktorá čistí len konce riadkov a okraje ťahu.

      Kým sa ťahy pripisovali naslepo, bol to kozmetický kaz. Odkedy sa stratený
      stav obnovuje porovnaním obsahu, je z neho porucha: prepis prestane sedieť
      so zdrojom. Namerané na tomto archíve — 1117 ťahov, z toho jediný s takto
      useknutým príkazom, a zhoda v poradí padla na 378. S orezaním 1117/1117.

      Verzia 0.19.0 orezávala (`calls.trimEnd()`); refaktor to stratil.
    */
    const telo = [text, volania.length ? plot + '\n' + volania.join('\n').trimEnd() + '\n' + plot : ''].filter(Boolean).join('\n\n');
    if (!telo) return null;
    return '\n\n## ' + (j.type === 'user' ? 'USER' : 'CLAUDE') + ' - ' + (j.timestamp?.slice(0, 16).replace('T', ' ') ?? '?') + '\n\n' + telo;
  },
});
