#!/usr/bin/env node
/**
 * Memory health, and rebuilding the trail index.
 *
 * Two jobs in one script on purpose: the index has to be rebuilt every time
 * somebody touches the trail entries, and health is the first thing you look
 * at afterwards. Splitting them would mean one of the two gets forgotten.
 *
 * Usage:
 *   node status.mjs            health report
 *   node status.mjs --trail    rewrite .memex/TRAIL.md from the directory
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { kde } from './kde.mjs';

const CESTY = kde();
const ROOT = CESTY.root;
const ARCHIVE = CESTY.archive;
const TRAIL = CESTY.trail;
const INDEX = CESTY.trailIndex;
/*
  Odkaz sa počíta z ciest, nehádajú sa z názvu.

  Tu stálo natvrdo `trail/`, hoci priečinok sa dá prestaviť cez `--trail-dir`
  aj `MEMEX_TRAIL`. Projekt, ktorý si ho pomenoval po svojom, dostal rozcestník
  so 153 odkazmi a všetkých 153 viedlo do priečinka, ktorý neexistuje. Nič
  nezlyhalo nahlas: súbor sa zapísal, vyzeral správne a otvoril sa až ten,
  kto naň klikol.

  Cesta z miesta, kde rozcestník leží, do miesta, kde ležia záznamy — to je
  jediná definícia, ktorá platí pre každé nastavenie.
*/
const PREFIX = (relative(dirname(INDEX), TRAIL) || '.').split(sep).join('/');

const kB = (x) => (x / 1024).toFixed(1);
const MB = (x) => (x / 1048576).toFixed(1);

function entries() {
  if (!existsSync(TRAIL)) return [];
  const out = [];
  for (const f of readdirSync(TRAIL).filter((x) => x.endsWith('.md'))) {
    const t = readFileSync(join(TRAIL, f), 'utf8');
    const h = /^# (20\d\d-\d\d-\d\d)\s*·\s*(.+)$/m.exec(t);
    if (!h) { console.error(`! ${f}: missing heading of the form "# 2026-08-19 · Topic"`); continue; }
    out.push({
      file: f,
      date: h[1],
      heading: h[2].trim(),
      pointers: [...t.matchAll(/\]\(([^)#]+)#L(\d+)-L(\d+)\)/g)].map((m) => ({ path: m[1], from: +m[2], to: +m[3] })),
      expired: /^Valid until:/m.test(t),
    });
  }
  return out;
}

function writeTrail(z) {
  z.sort((a, b) => (a.date === b.date ? a.heading.localeCompare(b.heading) : b.date.localeCompare(a.date)));
  let out = `# Trail into the archive

Topics, each pointing at **exact line ranges in a session transcript**. This is
not a summary — the text is deliberately absent so it cannot drift from what
actually happened.

How to use it: read the whole list of headings, pick by heading, open the
referenced range in \`archive/\`. If a topic isn't here, search the archive
directly with \`memex/scripts/search.mjs\`.

Generated — do not edit by hand.

---
`;
  let d = '';
  for (const x of z) {
    if (x.date !== d) { out += `\n## ${x.date}\n\n`; d = x.date; }
    out += `- ${x.expired ? '~~' : ''}[${x.heading}](${PREFIX}/${x.file})${x.expired ? '~~ *(superseded)*' : ''}\n`;
  }
  writeFileSync(INDEX, out, 'utf8');
  return out.length;
}

const z = entries();

if (process.argv.includes('--trail')) {
  if (!z.length) { console.error(`No trail entries in ${TRAIL}.`); process.exit(1); }
  const n = writeTrail(z);
  console.log(`Trail: ${z.length} topics, ${kB(n)} kB -> ${INDEX}`);
  /*
    Odkaz sa overí, nepredpokladá.

    Rozcestník s rozbitými odkazmi je horší než žiadny: vyzerá ako hotová
    pamäť, a že nikam nevedie, sa zistí až pri kliknutí. Toto je lacné —
    jeden `existsSync` — a chytí každý ďalší preklep v cestách.
  */
  const rozbite = z.filter((x) => !existsSync(join(dirname(INDEX), PREFIX, x.file)));
  if (rozbite.length) {
    console.error(`\n⚠ ${rozbite.length} of ${z.length} links do not resolve — e.g. ${PREFIX}/${rozbite[0].file}`);
    console.error(`  The index is at ${INDEX}, the entries are in ${TRAIL}.`);
    process.exit(1);
  }
  process.exit(0);
}

// ── health report ──────────────────────────────────────────────────────────
/*
  Prepisy, nie všetko s príponou `.md`.

  Bodka na začiatku znamená pracovný súbor — `.davka.md` je dávka pre
  destilátor, nie relácia. Bez tejto podmienky ju hlásenie počítalo medzi
  prepisy a večne pýtalo záznam do ukazovateľa pre súbor, ktorý žiadna relácia
  nie je.
*/
const transcripts = existsSync(ARCHIVE)
  ? readdirSync(ARCHIVE).filter((f) => f.endsWith('.md') && !f.startsWith('.'))
  : [];
const bytes = transcripts.reduce((a, f) => a + statSync(join(ARCHIVE, f)).size, 0);

console.log(`Archive    ${transcripts.length} transcripts, ${MB(bytes)} MB`);
console.log(`Full-text  ${existsSync(CESTY.index) ? 'built' : 'MISSING — node memex/scripts/search.mjs --index'}`);
console.log(`Trail      ${z.length} topics, ${z.reduce((a, x) => a + x.pointers.length, 0)} pointers`);
if (z.some((x) => x.expired)) console.log(`           ${z.filter((x) => x.expired).length} marked "Valid until"`);

// A pointer into nothing is worse than a missing one — it sends the reader
// away and they don't come back.
let broken = 0, past = 0;
for (const x of z) {
  for (const p of x.pointers) {
    const c = join(TRAIL, p.path);
    if (!existsSync(c)) { broken++; continue; }
    if (p.to > readFileSync(c, 'utf8').split('\n').length) past++;
  }
}
if (broken) console.log(`! ${broken} pointers reference a transcript that does not exist`);
if (past) console.log(`! ${past} pointers reference lines past the end of the transcript`);

// A transcript with no trail entry at all is a hole in the memory — exactly
// what the measurement showed as the difference between 55% and 100%.
const covered = new Set(z.flatMap((x) => x.pointers.map((p) => p.path.split('/').pop())));
const uncovered = transcripts.filter((f) => !covered.has(f));
if (uncovered.length) {
  console.log(`\n${uncovered.length} transcripts have no trail entry yet:`);
  for (const f of uncovered.slice(0, 8)) console.log(`   ${f}`);
  if (uncovered.length > 8) console.log(`   … and ${uncovered.length - 8} more`);
  console.log('  Run the distiller: "distill the archive"');
}
if (!broken && !past && !uncovered.length && z.length) console.log('\nNothing to report.');
