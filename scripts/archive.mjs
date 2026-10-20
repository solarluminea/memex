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
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { kde } from './kde.mjs';
import { archivuj } from './archivator.mjs';
import { redakcia, failureLine } from './prevod.mjs';

/*
  Kľúč projektu a hľadanie zdroja sú v `kde.mjs`.

  Boli tu, a kontrola stavu si ich odvodzovala po svojom — čo je presne ten
  druh dvojitej definície, ktorá sa raz rozíde a hlásenie potom tvrdí, že je
  zarchivované všetko, len preto, že sa pozeralo inam.
*/
const CESTY = kde();
const PROJECT = CESTY.zdroj.kluc;
const SOURCE = CESTY.zdroj.cesta;
if (!SOURCE) {
  console.error(`Could not find this project's transcripts: ${join(CESTY.zdroj.zaklad, PROJECT)}`);
  console.error('Claude Code creates them on the first session inside the project directory.');
  console.error('If the directory is elsewhere, set MEMEX_PROJECT to its name.');
  process.exit(1);
}

const TARGET = CESTY.archive;

/** Content blocks that carry meaning. Everything else is tool exhaust. */
const blocks = (c) => (Array.isArray(c) ? c : typeof c === 'string' ? [{ type: 'text', text: c }] : []);

/*
  Prvý identifikátor zo vstupu volania.

  Bez neho je volanie MCP v archíve holé meno: `[Tool: scenarios_get]`
  osemkrát pod sebou, a ktorý scenár to bol, sa nedozvie nikto. Pritom práve
  hodnoty ID sú to, s čím model po výstupe pracuje — namerané pri zamietaní
  zúženého výstupu z Make: súhrn stratil `769715` a `1360998212018409` a
  pokrytie spadlo na 23 %.

  Berie sa prvá skalárna hodnota, ktorá vyzerá ako identifikátor, nie ako veta:
  bez medzier a do šesťdesiatich znakov. Prompt ani dlhý text sa tým nedostane
  dnu, a `--file` zároveň získa druhú os — „ktoré relácie sa dotkli scenára
  769715" sa dá grepnúť rovnako ako cesta k súboru.
*/
function prvyArgument(i) {
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === 'number' || typeof v === 'boolean') return ` ${k}=${v}`;
    if (typeof v === 'string' && v.length <= 60 && v.length > 0 && !/\s/.test(v)) return ` ${k}=${v}`;
  }
  return '';
}

/** One line per tool call — what was done, not what came back. */
function toolSummary(b) {
  const i = b.input ?? {};
  if (['Read', 'Glob', 'Grep'].includes(b.name)) return `[Tool: ${b.name} ${i.file_path ?? i.pattern ?? ''}]`;
  if (['Edit', 'Write', 'NotebookEdit'].includes(b.name)) return `[Tool: ${b.name} ${i.file_path ?? i.notebook_path ?? ''}]`;
  // PowerShell je na Windowse hlavný shell a jeho príkaz nesie to isté, čo Bash.
  if (b.name === 'Bash' || b.name === 'PowerShell') {
    return `[Tool: ${b.name}] ${redakcia(String(i.command ?? '')).slice(0, 200)}`;
  }
  return `[Tool: ${b.name}${prvyArgument(i)}]`;
}

/*
  System injections are nobody's words — they don't belong in the archive.

  `task-notification` a bloky editora pribudli neskôr: oznámenie o dokončenom
  podagentovi má `type: 'user'`, takže sa archivovalo ako veta používateľa.
  Namerané v tomto archíve: dva výskyty, teda málo — ale je to reč nástroja
  vydávaná za reč človeka, a práve tú archív oddeľuje.
*/
const SYSTEM_BLOCK = /^<(system-reminder|command-name|local-command|command-message|task-notification|ide_selection|ide_opened_file)/;

function cleanText(t) {
  if (!t || SYSTEM_BLOCK.test(t.trim())) return '';
  // Drop base64 images — 281 MB of the 467 MB archive, and unsearchable anyway.
  return redakcia(t.replace(/data:[a-z/]+;base64,[A-Za-z0-9+/=]+/g, '[image]')).trim();
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
