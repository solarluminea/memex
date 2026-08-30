#!/usr/bin/env node
/**
 * Telemetry: what navigation actually costs, per session.
 *
 * Every number quoted while this plugin was built came from a one-off
 * experiment — run once, by hand, on a good day. That is enough to choose a
 * direction and not enough to know whether the direction worked. This reads
 * the transcripts Claude Code already writes and turns them into a number that
 * accumulates on its own.
 *
 * ⚠️ **It does not report savings, on purpose.** "This saved 7k tokens" is a
 * claim about a session that never happened, and any tool that prints it is
 * quoting its author's hopes. What is here are facts — tokens spent, calls
 * made, how far into a session the first edit landed — and the comparison is
 * left between two periods of real work.
 *
 * Two of those facts are worth more than the rest:
 *
 *   · **Steps before the first edit.** Navigation is the part between "I was
 *     asked" and "I changed something". If a map helps, this falls.
 *   · **Cache share.** A cached input token costs about a tenth of a fresh
 *     one, so a raw token count without it describes the wrong thing.
 *
 * Counting is deliberately generous about what a lookup is: in a project that
 * works through the shell, `grep` inside Bash is a lookup exactly as much as
 * the Grep tool, and `sed -n` is a read. Measured on one real project: 13 038
 * Bash calls against 1 050 Read calls. Count only the tools and you would be
 * describing someone else's workflow.
 *
 *   memex/scripts/stats.mjs           rescan what changed, then report
 *   memex/scripts/stats.mjs --quiet   rescan silently (for the hook)
 *   memex/scripts/stats.mjs --json    machine-readable rows
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const ROOT = process.env.MEMEX_PROJECT_ROOT || process.cwd();
const MEMEX = process.env.MEMEX_ROOT || join(ROOT, '.memex');
const STATS = process.env.MEMEX_STATS || join(MEMEX, 'stats.jsonl');
const STATE = join(MEMEX, '.stats-state.json');

/** Kľúč, pod ktorým Claude Code drží prepisy tohto projektu. */
const projectKey = (p) => p.replace(/\\/g, '/').replace(/[:/]/g, '-');
const SOURCE =
  process.env.MEMEX_TRANSCRIPTS || join(homedir(), '.claude', 'projects', projectKey(ROOT));

// ── čo sa počíta ───────────────────────────────────────────────────────────

/*
  Hľadanie proti čítaniu proti zásahu.

  Bash sa posudzuje podľa príkazu, nie podľa názvu nástroja. Bez toho by
  projekt, ktorý pracuje cez shell, vyzeral, že nehľadá vôbec — a jeho čísla
  by boli o niekom inom.
*/
const HLADANIE = /^(grep|rg|ag|find|fd|glob)\b|\b(grep|rg)\b|map\.mjs|search\.mjs/;
const CITANIE = /^(cat|head|tail|less|more)\b|\bsed -n\b/;
/*
  Zásah cez shell je zápis do súboru, nič iné.

  Prvá verzia sem brala `git add`, `git commit` a každé presmerovanie — a
  vyšlo z toho 142 „zásahov" na reláciu, čo je nezmysel. Commit nie je zmena
  kódu, je to zápis do histórie, a `> /dev/null` nie je zápis vôbec.
*/
const ZASAH = /<<\s*'?[A-Z]|>\s*[\w./-]+\.\w+|\btee\s+[\w./-]+/;

const NASTROJE = {
  lookup: new Set(['Grep', 'Glob', 'WebSearch']),
  read: new Set(['Read', 'NotebookRead', 'WebFetch']),
  edit: new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']),
};

function zaradBash(prikaz) {
  const p = String(prikaz || '').trim();
  // Zápis sa skúša prvý: `cat <<'EOF' > súbor` je zásah, nie čítanie.
  if (ZASAH.test(p)) return 'edit';
  if (HLADANIE.test(p)) return 'lookup';
  if (CITANIE.test(p)) return 'read';
  return null;
}

/**
 * Jedna relácia: tokeny, volania a to, kde padol prvý zásah.
 *
 * Číta sa po riadkoch. Prepisy majú desiatky tisíc riadkov a stovky megabajtov
 * — načítať taký súbor naraz je pamäťová špička bez dôvodu.
 */
async function precitaj(cesta) {
  const r = {
    session: basename(cesta, '.jsonl'),
    day: null,
    turns: 0,
    input: 0, cacheWrite: 0, cacheRead: 0, output: 0,
    lookup: 0, read: 0, edit: 0,
    map: 0,
    beforeFirstEdit: null,
  };
  let krokov = 0;

  const rl = createInterface({ input: createReadStream(cesta), crlfDelay: Infinity });
  for await (const riadok of rl) {
    if (!riadok) continue;
    let j;
    try { j = JSON.parse(riadok); } catch { continue; }
    if (!r.day && j.timestamp) r.day = j.timestamp.slice(0, 10);

    const u = j.message?.usage;
    if (u) {
      r.turns++;
      r.input += u.input_tokens ?? 0;
      r.cacheWrite += u.cache_creation_input_tokens ?? 0;
      r.cacheRead += u.cache_read_input_tokens ?? 0;
      r.output += u.output_tokens ?? 0;
    }

    for (const c of j.message?.content ?? []) {
      if (c.type !== 'tool_use') continue;
      let druh = null;
      if (NASTROJE.lookup.has(c.name)) druh = 'lookup';
      else if (NASTROJE.read.has(c.name)) druh = 'read';
      else if (NASTROJE.edit.has(c.name)) druh = 'edit';
      else if (c.name === 'Bash' || c.name === 'PowerShell') druh = zaradBash(c.input?.command);
      if (!druh) continue;

      if (/map\.mjs/.test(String(c.input?.command ?? ''))) r.map++;
      r[druh]++;
      if (druh === 'edit') {
        // Kroky pred prvým zásahom — jadro celého merania.
        if (r.beforeFirstEdit === null) r.beforeFirstEdit = krokov;
      } else {
        krokov++;
      }
    }
  }
  return r;
}

// ── zber ───────────────────────────────────────────────────────────────────

async function zozbieraj(ticho) {
  if (!existsSync(SOURCE)) {
    if (!ticho) console.error(`No transcripts at ${SOURCE}`);
    return null;
  }
  mkdirSync(MEMEX, { recursive: true });
  const stav = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  const hotove = new Map(
    (existsSync(STATS) ? readFileSync(STATS, 'utf8') : '')
      .split('\n').filter(Boolean)
      .map((r) => { try { const j = JSON.parse(r); return [j.session, j]; } catch { return null; } })
      .filter(Boolean),
  );

  let novych = 0;
  for (const f of readdirSync(SOURCE)) {
    if (!f.endsWith('.jsonl')) continue;
    const cesta = join(SOURCE, f);
    const s = statSync(cesta);
    const znamka = `${s.size}:${Math.floor(s.mtimeMs)}`;
    // Prepis, ktorý sa nezmenil, sa neprechádza znova — inak by prehľad rástol
    // z minút na desiatky minút, ako archív pribúda.
    if (stav[f] === znamka && hotove.has(basename(f, '.jsonl'))) continue;
    hotove.set(basename(f, '.jsonl'), await precitaj(cesta));
    stav[f] = znamka;
    novych++;
  }

  const riadky = [...hotove.values()].sort((a, b) => (a.day ?? '').localeCompare(b.day ?? ''));
  writeFileSync(STATS, riadky.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  writeFileSync(STATE, JSON.stringify(stav, null, 2), 'utf8');
  return { riadky, novych };
}

// ── prehľad ────────────────────────────────────────────────────────────────

// Desatinné miesto pod desiatkou: „1,4 hľadania na zásah" je iné číslo než
// „1" a práve v tom rozsahu sa pohybuje to, čo má toto meranie rozlíšiť.
const k = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n >= 10 ? String(Math.round(n)) : n.toFixed(1);
const priemer = (xs, f) => (xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0);

function prehlad(riadky) {
  if (!riadky.length) return console.log('No sessions measured yet.');

  // Polovica na polovicu, nie „posledných sedem dní": korpus býva malý a pevné
  // okno by pri desiatich reláciách porovnávalo dve s ôsmimi.
  const stred = Math.floor(riadky.length / 2);
  const [staré, nové] = [riadky.slice(0, stred), riadky.slice(stred)];

  const riadok = (nazov, f, jednotka = '') => {
    const a = priemer(staré, f), b = priemer(nové, f);
    const zmena = staré.length && a ? ((b - a) / a) * 100 : null;
    const smer = zmena === null ? '' : `${zmena >= 0 ? '+' : ''}${zmena.toFixed(0)} %`;
    console.log(`  ${nazov.padEnd(26)}${(k(b) + jednotka).padStart(8)}   ${smer.padStart(7)}`);
  };

  const dni = new Set(riadky.map((x) => x.day).filter(Boolean));
  console.log(`Sessions ${riadky.length}, ${dni.size} days.`);
  console.log(`Change against the older half (${staré.length} vs ${nové.length}).\n`);

  /*
    Delené počtom zásahov, nie počtom relácií.

    Prvá verzia počítala priemer na reláciu a všetko v nej padalo o osemdesiat
    percent — nie preto, že by sa navigácia zlepšila, ale preto, že staršie
    relácie boli dlhšie. Relácia je ľubovoľne dlhá, zásah je jednotka práce.
  */
  const naZasah = (f) => (x) => (x.edit ? f(x) / x.edit : 0);

  console.log('  Navigation');
  riadok('steps before 1st edit', (x) => x.beforeFirstEdit ?? 0);
  riadok('lookups per edit', naZasah((x) => x.lookup));
  riadok('reads per edit', naZasah((x) => x.read));
  console.log('');
  console.log('  Cost per edit');
  riadok('fresh input tokens', naZasah((x) => x.input + x.cacheWrite));
  riadok('output tokens', naZasah((x) => x.output));
  console.log('');
  console.log('  Volume');
  riadok('edits', (x) => x.edit);
  riadok('turns', (x) => x.turns);

  /*
    Podiel cache. Prečítaný token z cache stojí zlomok čerstvého, takže bez
    tohto čísla hovorí súčet vstupu o niečom inom, než čo sa naozaj platí.
    Sčítava sa cez všetky volania zámerne — každé z nich ten token naozaj
    zaplatilo, aj keď lacnejšie.
  */
  const cache = priemer(riadky, (x) => x.cacheRead) /
    (priemer(riadky, (x) => x.cacheRead + x.input + x.cacheWrite) || 1);
  console.log(`\n  cache share ${(cache * 100).toFixed(0)} % of input`);

  const sMapou = riadky.filter((x) => x.map > 0).length;
  console.log(`  map used in ${sMapou} of ${riadky.length} sessions`);

  /*
    Bez porovnania je číslo len číslo. Táto veta hovorí, čo s ním — a zámerne
    nehovorí „ušetrili ste", lebo to by bolo tvrdenie o relácii, ktorá nikdy
    nebežala.
  */
  console.log('\nThese are counts, not savings. To judge a change, compare the');
  console.log('halves after it has been in use for a while — not against a guess.');
}

// ── vstup ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const ticho = argv.includes('--quiet');
const vysledok = await zozbieraj(ticho);
if (!vysledok) process.exit(ticho ? 0 : 1);

if (ticho) {
  // Hook mlčí, kým nie je čo povedať. Správa pri každom zatvorení okna sa
  // naučí prehliadať aj vtedy, keď raz povie niečo dôležité.
  if (vysledok.novych) console.log(`Telemetry: ${vysledok.novych} session(s) measured.`);
} else if (argv.includes('--json')) {
  for (const r of vysledok.riadky) console.log(JSON.stringify(r));
} else {
  prehlad(vysledok.riadky);
}
