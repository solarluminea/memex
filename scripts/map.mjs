#!/usr/bin/env node
/**
 * Code map — one line per module, so an agent knows which file to open.
 *
 * The archive answers "what did we decide". This answers "where does it live".
 * Both are pointers: neither repeats the content, so neither can drift away
 * from it. What drifts here is staleness, and that is why the map is a
 * generated file rebuilt in under a second rather than something written by
 * hand.
 *
 * Three sources of a module's description, in this order:
 *
 *   1. **The header comment.** First sentence only — the rest is reasoning.
 *      Written by a human, so it says *why the module exists*, which no parser
 *      can infer from the syntax.
 *   2. **The interface strings.** For UI files with no header: the labels a
 *      person actually reads on screen. Measured on a real project — of 48
 *      files with no header, 47 got a usable description this way and one did
 *      not. No AST tool looks here, because in an English codebase the button
 *      says "Deals" and the file is DealsTable.tsx, so there is nothing to
 *      translate. In a codebase whose interface is not in English, this is the
 *      only place the user's own vocabulary is written down.
 *   3. **Nothing.** A dash. It is a work list, not an error.
 *
 * A label is paired with its key in the code when one sits next to it, so a
 * column reads `Power (powerKwp)`. That single parenthesis is what makes the
 * map findable by the word in the data as well as the word on screen — the
 * two are rarely the same.
 *
 * ⚠️ **The map does not replace reading.** It says which file to open, not
 * what is in it. An agent that infers the contents from one line makes exactly
 * the mistake that costs a day of rework.
 *
 * ⚠️ **It does not replace grep either.** The map answers "which file deals
 * with offers"; grep answers "where is this exact string". Do not try to make
 * the map know everything — a stale map is worse than no map, and every extra
 * term is another thing that can go stale.
 *
 *   memex/scripts/map.mjs               rebuild .memex/MAP.md
 *   memex/scripts/map.mjs find <word>   lines that mention it
 *   memex/scripts/map.mjs --quiet       rebuild, print only on change
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname, sep } from 'node:path';

const ROOT = process.env.MEMEX_PROJECT_ROOT || process.cwd();
const MEMEX = process.env.MEMEX_ROOT || join(ROOT, '.memex');
const TARGET = process.env.MEMEX_MAP || join(MEMEX, 'MAP.md');
const CONFIG = join(MEMEX, 'map.json');

/*
  Čo sa mapuje.

  Zdrojový kód, nie všetko. Testy vypadávajú — ležia vedľa modulu a v mape by
  ho len zdvojili. Vygenerované a stiahnuté priečinky tiež: sú to státisíce
  riadkov, ktoré nikto nehľadá a ktoré by mapu utopili.
*/
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|py|go|rs|rb|php|java|kt|swift|cs|ex|exs)$/;
const UI = /\.(tsx|jsx|vue|svelte)$/;
const TESTS = /(\.|_)(test|spec)\.|__tests__|_test\.go$/;
const SKIP_DIR = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target',
  'vendor', 'coverage', '__pycache__', '.venv', 'venv', 'env', '.next',
  '.nuxt', '.svelte-kit', '.turbo', '.cache', 'generated', 'migrations',
  '.memex', '.claude', 'bin', 'obj', 'Pods', 'deps', '_build',
]);
/* Priečinky, kde zdrojový kód býva. Keď ani jeden neexistuje, mapuje sa koreň. */
const ROOTS = ['src', 'lib', 'app', 'source', 'packages', 'internal', 'pkg', 'cmd', 'scripts', 'components'];

const config = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {};
const MAX_TERMS = config.maxTerms ?? 6;
const MAX_LINE = config.maxLine ?? 120;
/*
  Skratky a jednotky, ktoré stoja v kóde a nikdy nie na obrazovke.

  Zámerne krátky a doménový zoznam. `vs` a `ks` v ňom nie sú: sú to dve
  písmená, ktoré sa trafia doprostred bežných slov — namerané, `vs` označilo
  kľúč `vsetky` za skratku.
*/
const SKRATKA = new RegExp(
  `(${(config.abbreviations ?? ['kwp', 'kwh', 'mwh', 'dph', 'ico', 'dic', 'iban', 'pdf', 'csv', 'xml', 'url', 'api', 'eur', 'ean', 'gps', 'html']).join('|')})`,
  'i',
);
const skipDirs = new Set([...SKIP_DIR, ...(config.skip ?? [])]);

// ── collecting files ───────────────────────────────────────────────────────

function walk(dir, out = []) {
  let items;
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const x of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (x.name.startsWith('.') && x.name !== '.') continue;
    const path = join(dir, x.name);
    if (x.isDirectory()) {
      if (!skipDirs.has(x.name)) walk(path, out);
    } else if (SOURCE.test(x.name) && !TESTS.test(x.name)) {
      out.push(path);
    }
  }
  return out;
}

function collect() {
  if (config.areas?.length) {
    return config.areas.flatMap((a) => walk(join(ROOT, a)));
  }
  const present = ROOTS.filter((d) => existsSync(join(ROOT, d)) && statSync(join(ROOT, d)).isDirectory());
  return present.length ? present.flatMap((d) => walk(join(ROOT, d))) : walk(ROOT);
}

// ── 1. the header comment ──────────────────────────────────────────────────

/**
 * First sentence of the file's header comment.
 *
 * Only at the top of the file — a comment thirty lines down is a note about a
 * function, not a description of the module. Imports and pragmas above it are
 * skipped, because in components they come first.
 */
function header(text) {
  const head = text.slice(0, 4000);
  const m = /\/\*\*?\s*\n?([\s\S]*?)\*\//.exec(head) ?? /"""\s*\n?([\s\S]*?)"""/.exec(head);
  if (!m) return null;
  if (head.slice(0, m.index).split('\n').length > 14) return null;

  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/^\s*\*?\s?/, '').trim();
    if (!line || /^[-=─_]+$/.test(line)) continue;
    // First sentence, not the whole paragraph: the period ends the label and
    // everything after it is the reasoning.
    const end = line.search(/\.(\s|$)/);
    return clean(end > 0 ? line.slice(0, end) : line);
  }
  return null;
}

const clean = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

// ── 2. the interface strings ───────────────────────────────────────────────

/*
  Reťazce, ktoré vyzerajú ako text pre človeka, ale nikto ich na obrazovke
  nevidí. Bez tejto listiny vyhrá `Content-Type` nad názvom stĺpca v každom
  druhom súbore — má veľké písmeno aj slovo, len nie je pre človeka.
*/
const TECHNICAL = new Set([
  'Content-Type', 'application/json', 'text/plain', 'multipart/form-data',
  'POST', 'GET', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS',
  'Enter', 'Escape', 'Tab', 'Alt', 'Shift', 'Control', 'Meta', 'Backspace',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Home', 'End',
  'true', 'false', 'null', 'undefined', 'use client', 'use server', 'use strict',
  'Authorization', 'Bearer', 'no-store', 'no-cache', 'force-cache',
]);
const NOT_TEXT = /[/\\@#{}<>|$]|^[a-z]+([A-Z]\p{L}*)+$|^\d/u;
const HAS_WORD = /\p{L}{3,}/u;
/* Text pre človeka má veľké začiatočné písmeno alebo znak mimo ASCII. */
const HUMAN = /^\p{Lu}/u;
const NON_ASCII = /[^\x00-\x7F]/;

/** Komentáre preč — inak sa z nich vyberajú útržky viet v úvodzovkách. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/**
 * Labels a person reads on screen, in the order they appear in the file.
 *
 * Order matters and alphabetical order is wrong: in a table the source order
 * *is* the column order, which is itself information. Sorting by frequency is
 * wrong too — it puts the most repeated string first, and that is usually
 * "Cancel".
 */
function labels(source) {
  const src = stripComments(source);
  const lines = src.split('\n');
  const found = new Map();

  const add = (raw, weight, line) => {
    if (!raw) return;
    const t = clean(raw);
    if (t.length < 3 || t.length > 34) return;
    if (TECHNICAL.has(t) || NOT_TEXT.test(t) || !HAS_WORD.test(t)) return;
    if (!HUMAN.test(t) && !NON_ASCII.test(t)) return;
    const seen = found.get(t);
    if (!seen || weight > seen.weight) found.set(t, { weight, line, order: seen?.order ?? found.size });
  };

  lines.forEach((l, i) => {
    // A column header outranks every other label. It names a field of the
    // domain, while a filter or a button names an action — and the field is
    // what someone asks about when they say "move the power column".
    for (const m of l.matchAll(/\bheader\s*[:=]\s*'([^'\n]{3,34})'/g)) add(m[1], 4, i);
    // Where a label otherwise lives: a field label, a title, a placeholder.
    //
    // The accented spellings are not decoration. A codebase written in the
    // language of its interface names the field `názov:`, and `\b(?:nazov)`
    // never matches it — `\b` in JavaScript is ASCII, so the boundary a Slovak
    // word needs is not there. Measured on a real project: `názov:` appears
    // six times and `hlavička:` once, all of them invisible until now.
    for (const m of l.matchAll(/\b(?:label|title|placeholder|name|nazov|názov|popis|titulok|hlavicka|hlavička)\s*[:=]\s*'([^'\n]{3,34})'/gu)) add(m[1], 3, i);
    for (const m of l.matchAll(/\b(?:title|label|placeholder|aria-label|alt)="([^"\n]{3,34})"/g)) add(m[1], 3, i);
    // Text sitting directly in the markup — what is on the screen.
    for (const m of l.matchAll(/>\s*([^<>{}\n]{3,34}?)\s*</g)) add(m[1], 2, i);
    // Any other literal, last.
    for (const m of l.matchAll(/'([^'\n\\]{3,34})'/g)) add(m[1], 1, i);
  });

  return [...found.entries()]
    .sort((a, b) => b[1].weight - a[1].weight || a[1].order - b[1].order)
    .map(([text, meta]) => ({ text, line: meta.line }));
}

/**
 * The key in the code that belongs to a label.
 *
 * `header: 'Power'` and `accessorKey: 'powerKwp'` sit in the same column
 * definition but on different lines, so they are paired through a window of
 * lines rather than a single regex. Without the key the map is findable by
 * "power" but not by "kWp", and those are the same column.
 */
function keys(source) {
  const out = [];
  stripComments(source).split('\n').forEach((l, i) => {
    const m = /\b(?:id|accessorKey|key|field|name)\s*:\s*'([a-zA-Z][a-zA-Z0-9_]*)'/.exec(l);
    if (m) out.push({ value: m[1], line: i });
  });
  return out;
}

/* Escape sekvencia, nie doslovné kombinačné znaky — tie sú v zdroji neviditeľné
   a prvá úprava riadku ich ticho zmaže. */
const undiacritic = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function fromInterface(source) {
  const found = labels(source);
  if (!found.length) return null;
  const allKeys = keys(source);

  const terms = found.slice(0, MAX_TERMS).map(({ text, line }) => {
    const near = allKeys
      .filter((k) => Math.abs(k.line - line) <= 6)
      .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];
    // A key that is merely the label transliterated adds nothing.
    if (!near || undiacritic(text) === undiacritic(near.value)) return text;
    return `${text} (${near.value})`;
  });

  /*
    Kľúč, ktorý nesie skratku alebo jednotku.

    Prvý pokus dopĺňať osirelé kľúče som vrátil, a správne: výber „prvé dva
    v poradí" pridal `mesacnaPlatba` a hľadaný `vykonKwp` minul. Chyba ale
    nebola v myšlienke, bola vo výbere.

    Skratka je iná trieda. `kWp`, `DPH`, `IČO`, `PDF` sa v popisku nikdy
    neobjavia — na obrazovke stojí „Výkon", nie „vykonKwp" — a zároveň sú to
    presne tie slová, ktorými sa človek pýta. Kľúč ako `meno` alebo `stav` je
    v popisku obsiahnutý a nepridáva nič.

    Namerané na šestnástich súboroch s kľúčmi: **dva** majú takýto kľúč mimo
    popisku, a jeden z nich je práve `PripadyTabulka.tsx → vykonKwp`. Úzke
    zámerne — heuristika, ktorá pridá jedno slovo do dvoch súborov, je lepšia
    než tá, čo pridá dve slová do všetkých.

    Zoznam skratiek je doménový; `map.json` ho vie prepísať cez `abbreviations`.
  */
  const uzTam = undiacritic(terms.join(' '));
  const skratky = allKeys
    .map((k) => k.value)
    .filter((v, i, a) => a.indexOf(v) === i && SKRATKA.test(v) && !uzTam.includes(undiacritic(v)));

  let text = [...terms, ...skratky].join(' · ');
  while (text.length > MAX_LINE && terms.length > 1) {
    terms.pop();
    text = [...terms, ...skratky].join(' · ');
  }
  /*
    Aj riadok, na ktorom prvý popisok stojí.

    Bez neho nájde agent správny súbor a hneď musí grepnúť, kde v ňom tie
    stĺpce sú — celé jedno kolo volania navyše. S ním prečíta rovno okno okolo
    toho miesta. Riadok prvého popisku, nie zhody: definícia začína tam
    a čítať sa aj tak bude blok, nie jeden riadok.

    Pri popise z hlavičkového komentára sa neuvádza — bol by to vždy riadok
    jedna a to nie je informácia.
  */
  return { text, line: found[0].line + 1 };
}

// ── 3. schema fields that bridge layers ────────────────────────────────────

/*
  Polia z databázovej schémy, ktoré spájajú málo súborov.

  Meno poľa je dátový kontrakt: to isté slovo stojí v tabuľke, v API aj v
  komponente, a spája ich bez parsera — identifikátor sa buď vyskytuje, alebo
  nie. Je to vertikálny rez, aký by dal graf volaní, za cenu jedného Setu.

  Prah je celá vec. Namerané na schéme s 510 poľami:

    všetky polia          981 z 1070 súborov, medián 6 polí na súbor
    pole v 2–6 súboroch   218 z 1070 súborov, medián 1

  Prvé číslo je zaplavená mapa — `dealId` je v 250 súboroch a nespája nič, len
  ich všetky. Druhé sú skutočné mosty: `refreshToken` cez klienta, OAuth a
  synchronizáciu; `priecinokId` cez route, obrazovku a dotazy.
*/
const SCHEMA_FILES = ['prisma/schema.prisma', 'db/schema.ts', 'src/db/schema.ts', 'drizzle/schema.ts'];
const SEED_MIN = config.seedMin ?? 2;
const SEED_MAX = config.seedMax ?? 6;

function schemaFields() {
  for (const rel of [...(config.schema ? [config.schema] : []), ...SCHEMA_FILES]) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const fields = new Set([
      ...[...text.matchAll(/^\s{2}([a-z][a-zA-Z0-9]*)\s+\w/gm)].map((m) => m[1]),
      ...[...text.matchAll(/^\s*([a-z][a-zA-Z0-9]*)\s*:\s*\w+\(/gm)].map((m) => m[1]),
    ]);
    // Krátke meno je skoro vždy spoločné viacerým modelom a nerozlišuje nič.
    return new Set([...fields].filter((f) => f.length >= 8));
  }
  return new Set();
}

/** Identifikátory v súbore ako množina — jeden prechod, nie regex na pole. */
function identifiers(text, medzi) {
  const out = new Set();
  for (const m of text.matchAll(/\b[a-z][a-zA-Z0-9]{7,}\b/g)) {
    if (medzi.has(m[0])) out.add(m[0]);
  }
  return out;
}

// ── building the map ───────────────────────────────────────────────────────

function describe(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { description: null, line: null };
  }
  const fromHeader = header(text);
  if (fromHeader) return { description: fromHeader, line: null };
  const fromUi = UI.test(path) ? fromInterface(text) : null;
  return fromUi ? { description: fromUi.text, line: fromUi.line } : { description: null, line: null };
}

function build(files) {
  const polia = schemaFields();
  const vSubore = new Map();
  const pocet = new Map();
  if (polia.size) {
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      const found = identifiers(text, polia);
      if (!found.size) continue;
      vSubore.set(f, found);
      for (const p of found) pocet.set(p, (pocet.get(p) ?? 0) + 1);
    }
  }
  // Most je pole, ktoré spája niekoľko súborov. Jeden nespája nič, dvesto tiež nie.
  const mosty = new Set([...pocet.entries()].filter(([, n]) => n >= SEED_MIN && n <= SEED_MAX).map(([p]) => p));

  const modules = files.map((f) => {
    const zaklad = describe(f);
    const seeds = [...(vSubore.get(f) ?? [])].filter((p) => mosty.has(p)).slice(0, 2);
    // Až za popis a len keď tam ešte nie sú — popis je o obrazovke, toto je most.
    const nove = seeds.filter((p) => !undiacritic(zaklad.description ?? '').includes(p.toLowerCase()));
    /*
      Strop platí aj na most.

      Prvá verzia pridávala polia až za orezanie, takže popis, ktorý sa mal
      zmestiť do stodvadsiatich znakov, mal stotridsať. Keď sa nezmestí oboje,
      ustupuje most — popis hovorí, čo je na obrazovke, a to je hlavná otázka.
    */
    let popis = zaklad.description;
    for (const p of nove) {
      const skus = [popis, p].filter(Boolean).join(' · ');
      if (skus.length > MAX_LINE && popis) break;
      popis = skus;
    }
    return { path: relative(ROOT, f).split(sep).join('/'), ...zaklad, description: popis };
  });

  const missing = modules.filter((m) => !m.description).length;
  const kTokens = Math.round((modules.length * 80) / 3 / 1000);
  const out = [
    '# Code map',
    '',
    `${modules.length} modules, ${missing} without a description. **Generated** —`,
    'the source is the code itself, not this file.',
    '',
    // The whole point is a cheap lookup, and reading the file defeats it. On a
    // real project this file is ~34k tokens while one lookup is ~50 — so the
    // warning goes first, in the words an agent is most likely to act on.
    `⛔ **Do not read this file.** It is roughly ${kTokens}k tokens; one lookup is`,
    'under a hundred. Run this instead, and read only what it prints:',
    '',
    '```',
    'node memex/scripts/map.mjs find <word>',
    '```',
    '',
    'Rebuild with no argument. The lookup ignores case and diacritics, and',
    'searches the paths as well as the descriptions.',
    '',
    '⚠️ The map says **which file to open** — not what is in it. Inferring the',
    'contents from one line is exactly the mistake that costs a day of rework.',
    '',
  ];

  let folder = null;
  for (const m of modules) {
    const dir = dirname(m.path);
    if (dir !== folder) {
      folder = dir;
      out.push('', `**${dir}/**`, '');
    }
    out.push(`- \`${basename(m.path)}\`${m.line ? `:${m.line}` : ''} — ${m.description ?? '—'}`);
  }
  out.push('');
  return { text: `${out.join('\n')}\n`, count: modules.length, missing, modules };
}

// ── entry point ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const map = build(collect());

if (argv[0] === 'find') {
  const word = undiacritic(argv.slice(1).filter((a) => !a.startsWith('--')).join(' '));
  if (!word) {
    console.error('Usage: node memex/scripts/map.mjs find <word>');
    process.exit(1);
  }
  /*
    Hľadá sa aj v ceste, nie len v popise — názov súboru je popis sám o sebe.
    A bez diakritiky na oboch stranách, aby „ponuka" našlo „Ponúk".

    Zoradenie, nie len filter. Široké slovo vráti desiatky modulov — namerané:
    „pripad" 42, „faktura" 29 — a nezoradený zoznam núti čitateľa prejsť
    všetky. Skóre je zámerne hlúpe: kde sa slovo našlo, váži viac než koľkokrát.
    Názov súboru je najsilnejší signál, lebo ho písal človek s úmyslom.
  */
  /*
    Dotaz odpísaný z adresného riadku.

    Človek nehlási „v priečinku crm/[id]", hlási „na /crm/482 nejde uložiť".
    Číslo je konkrétny záznam, v strome stojí `[id]`, a doslovná zhoda ich
    nespojí. Preto sa okrem dotazu skúša aj jeho podoba bez číselných úsekov
    proti ceste bez dynamických — `/crm/482` aj `src/app/crm/[id]/page.tsx`
    sa zredukujú na `/crm/`.

    Len ako druhý pokus a s nižším skóre: doslovná zhoda je vždy istejšia.
  */
  const bezCisel = word.replace(/\/\d+(?=\/|$)/g, '/');
  const bezDynamickych = (p) => p.replace(/\[[^\]]+\]/g, '');
  const akoUrl = bezCisel !== word ? bezCisel : null;

  const score = (m) => {
    const file = undiacritic(basename(m.path));
    const dir = undiacritic(dirname(m.path));
    const desc = undiacritic(m.description ?? '');
    let where =
      (file.includes(word) ? 4 : 0) + (dir.includes(word) ? 2 : 0) + (desc.includes(word) ? 1 : 0);
    if (!where && akoUrl && bezDynamickych(dir).includes(akoUrl)) where = 1.5;
    if (!where) return 0;
    /*
      Rozhodnutie pri remíze: koľko z názvu tvorí hľadané slovo.

      Bez toho vyhrá abeceda a na „pripad" vyjde osem overovacích skriptov
      pred `PripadyTabulka.tsx` — všetky majú to slovo v názve, tak majú
      rovnaké skóre. Podiel je hrubý, ale hovorí to, čo treba: v `Pripady…`
      je prípad témou súboru, v `overenie_cisel_pripadu` je len upresnením.
      Zlomok, aby nikdy neprebil to, KDE sa slovo našlo.
    */
    return where + word.length / (file.length + 1);
  };
  let all = map.modules.map((m) => ({ ...m, score: score(m) })).filter((m) => m.score > 0);

  /*
    Keď presná zhoda nevráti nič, skús kmeň slova.

    Slovenčina — a každý flektívny jazyk — mení koniec slova, nie začiatok:
    „faktúrami", „faktúr", „faktúrou". Kto píše dotaz, píše tvar, ktorý mu
    práve prišiel na um, a ten sa s tvarom v kóde zhoduje málokedy.

    Namerané na ôsmich takých dotazoch: päť nevrátilo nič a s kmeňom vrátili
    52, 82, 37, 15 a 1 modul. To je presne ten prípad, na ktorý sa inde
    nasadzujú embeddingy — a tu ho rieši `slice`.

    Len ako záchrana pri nule, nikdy nie namiesto presnej zhody: kmeň rozšíri
    aj dotaz, ktorý zásahy má, a z pätnástich nálezov spraví stopäťdesiat.
  */
  if (!all.length && word.length >= 6) {
    const kmen = word.slice(0, Math.max(4, word.length - 3));
    all = map.modules
      .map((m) => ({ ...m, score: undiacritic(`${m.path} ${m.description ?? ''}`).includes(kmen) ? 1 : 0 }))
      .filter((m) => m.score > 0);
    if (all.length) console.log(`No exact match for "${word}" — showing "${kmen}…" instead.\n`);
  }

  all.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  // Orezané, lebo cieľom je otvoriť súbor, nie prečítať zoznam. `--all` je pre
  // prípad, keď hľadaný pojem je naozaj roztrúsený a treba vidieť rozsah.
  const LIMIT = 12;
  const shown = argv.includes('--all') ? all : all.slice(0, LIMIT);
  for (const m of shown) console.log(`${m.path}${m.line ? `:${m.line}` : ''} — ${m.description ?? '—'}`);
  if (!all.length) {
    console.log('Nothing. Try grep, or the archive: node memex/scripts/search.mjs "words"');
  } else if (all.length > shown.length) {
    console.log(`\n${shown.length} of ${all.length} modules, best match first. All of them: --all`);
  } else {
    console.log(`\n${all.length} modules.`);
  }
  process.exit(0);
}

const before = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;
if (before !== map.text) {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, map.text, 'utf8');
}

// `--quiet` is for the hook: a map that says something every time you close a
// window starts being ignored, and with it the message that matters.
if (!quiet || before !== map.text) {
  const where = relative(ROOT, TARGET).split(sep).join('/');
  console.log(`${where} — ${map.count} modules, ${map.missing} without a description.`);
}
