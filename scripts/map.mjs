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
 * with offers"; grep answers "where is this exact string".
 *
 * ⚠️ **What is displayed and what is searched are two different lists.** A
 * printed term is read by a person and can go stale, so the line stays one
 * line and every word on it has to earn its place. The searchable list behind
 * it is derived from the files at build time, costs no reading, and is rebuilt
 * in a second — it cannot go stale, so it can be generous. Measured: matching
 * on distinctive identifiers that are never printed took MRR from 0.374 to
 * 0.535 and truthful pointers from 68 % to 93 %, with the output unchanged.
 *
 *   memex/scripts/map.mjs               rebuild .memex/MAP.md
 *   memex/scripts/map.mjs find <word>   lines that mention it
 *   memex/scripts/map.mjs --quiet       rebuild, print only on change
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname, sep } from 'node:path';
import { kde } from './kde.mjs';

const ROOT = process.env.MEMEX_PROJECT_ROOT || process.cwd();
const CESTY = kde(ROOT);
const MEMEX = CESTY.root;
const TARGET = CESTY.map;
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

/*
  Vypínač jednotlivých vylepšení, pre meranie.

  Bez neho sa dá povedať len „mapa nájde správny súbor v polovici prípadov" —
  nie, ktorá jej časť to spôsobuje. `MEMEX_ABLATE=seeds,stem` odstaví polia zo
  schémy a kmeň slova, takže rozdiel v úspešnosti je ich príspevok.

  Je to háčik na meranie, nie nastavenie: prázdna premenná znamená plnú
  funkčnosť a nikde inde sa nečíta. Bez neho by sa každé ďalšie vylepšenie
  pridávalo na vieru.
*/
const ABLATE = new Set((process.env.MEMEX_ABLATE ?? '').split(',').map((x) => x.trim()).filter(Boolean));

const config = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {};
const MAX_TERMS = config.maxTerms ?? 6;
const MAX_LINE = config.maxLine ?? 120;
/*
  Skratky a jednotky, ktoré stoja v kóde a nikdy nie na obrazovke.

  Zámerne krátky a doménový zoznam. `vs` a `ks` v ňom nie sú: sú to dve
  písmená, ktoré sa trafia doprostred bežných slov — namerané, `vs` označilo
  kľúč `vsetky` za skratku.
*/
const SKRATKY = config.abbreviations ?? ['kwp', 'kwh', 'mwh', 'dph', 'ico', 'dic', 'iban',
  'pdf', 'csv', 'xml', 'url', 'api', 'eur', 'ean', 'gps', 'html'];
const SKRATKA = new RegExp(`(${SKRATKY.join('|')})`, 'i');
// Koľko súborov smie skratka označiť. Tri, lebo odpoveďou má byť súbor na
// otvorenie — nie zoznam. `kwh` je v 132 súboroch a všetky nepomôžu ani jeden.
const ABBR_TOP = config.abbrevTop ?? 3;
/*
  V koľkých súboroch smie skrytý pojem byť, aby ešte rozlišoval.

  Prehľadané na dotazoch celou vetou: 2 → MRR 0,461, 8 → 0,503, 32 → 0,535,
  64 → 0,536, 300 → 0,540. Plató začína na tridsiatich dvoch a ďalej sa už
  kupuje R@12 za R@1. Tridsaťdva je teda hranica, kde sa to prestáva
  oplácať, nie najvyššie číslo v tabuľke.
*/
const SKRYTE_MAX = config.hiddenMax ?? 32;
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
    .filter((v, i, a) => a.indexOf(v) === i && !ABLATE.has('abbrev') && SKRATKA.test(v) && !uzTam.includes(undiacritic(v)));

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

/*
  Kde skratka býva, nie kde sa mihne.

  Namerané: `kwh` je v 132 súboroch a mapa naň nevracala nič — do popisku sa
  nedostal, lebo pôvodné pravidlo čítalo len kľúče vedľa popiskov na obrazovke.
  Pridať ho do všetkých 132 by ale bolo horšie než nevracať nič.

  Rozhoduje počet výskytov: `lib/calc/engine.ts` má `kwh` stoštyrikrát, zvyšok
  repozitára dokopy 557 rozdrobených do 130 súborov. Prvý je o tom, ostatné to
  spomenú. To isté `iban`: `qrPlatba.ts` jedenásťkrát, ostatné po jednom.

  Skratka sa počíta len ako celý úsek identifikátora. Podreťazcom by `ean`
  sedelo v `boolean` a `ico` v `unicode` — pri prvom meraní to tak vyšlo:
  168 nálezov `ean`, z toho pravých nula.
*/
function skratkyVSubore(text) {
  const out = new Map();
  for (const id of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    for (const usek of id.split(/[_$]|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      const k = usek.toLowerCase();
      if (SKRATKY.includes(k)) out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
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
  const polia = ABLATE.has('seeds') ? new Set() : schemaFields();
  const chceSkratky = !ABLATE.has('abbrev');
  const vSubore = new Map();
  const pocet = new Map();
  const kdeSkratka = new Map();
  const idSubor = new Map();
  const idPocet = new Map();
  const chceSkryte = !ABLATE.has('skryte');
  if (polia.size || chceSkratky || chceSkryte) {
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      if (chceSkryte) {
        // Identifikátory súboru. Ktoré z nich niečo rozlišujú, sa rozhodne až
        // potom — dovtedy nie je známe, v koľkých súboroch ktorý je.
        const vlastne = new Set();
        /*
          `\b` je v JavaScripte ASCII a to je tu chyba, nie detail.

          Pôvodne tu stálo `/\b[a-zA-Z][a-zA-Z0-9]{5,}\b/`, čiže sa zbierali len
          slová bez diakritiky. Slovenské slovo z komentára alebo z popisku sa
          doň nedostalo nikdy — a práve tým sa človek pýta. Namerané na jednom
          module: 90 zachytených pojmov proti 116, teda 44 zahodených, medzi
          nimi `prečítanie`, `požiadavky`, `prehliadača`, `orezávajú`.

          Je to presne tá pasca, ktorú má tento projekt zapísanú vo vlastných
          pravidlách — a porušoval ju vo vlastnom kóde.

          Namerané po oprave: MRR 0,535 → 0,574, R@12 73,7 → 81,7 %, jedno slovo
          0,242 → 0,263 a prázdnych odpovedí zo 7,0 na 2,3 %. Drží na oboch
          poloviciach. Stavba mapy stojí 1,76 s namiesto 1,16.
        */
        for (const m of text.matchAll(/[\p{L}][\p{L}\p{N}]{5,}/gu)) vlastne.add(undiacritic(m[0]));
        idSubor.set(f, vlastne);
        for (const w of vlastne) idPocet.set(w, (idPocet.get(w) ?? 0) + 1);
      }
      if (polia.size) {
        const found = identifiers(text, polia);
        if (found.size) {
          vSubore.set(f, found);
          for (const p of found) pocet.set(p, (pocet.get(p) ?? 0) + 1);
        }
      }
      if (chceSkratky) {
        for (const [sk, n] of skratkyVSubore(text)) {
          // Jediný výskyt je zmienka, nie domov.
          if (n < 2) continue;
          let z = kdeSkratka.get(sk);
          if (!z) kdeSkratka.set(sk, (z = []));
          z.push({ f, n });
        }
      }
    }
  }
  // Skratka označí len tie súbory, kde jej je najviac — inak neoznačí nič použiteľné.
  const domov = new Map();
  for (const [sk, zoznam] of kdeSkratka) {
    for (const { f } of zoznam.sort((a, b) => b.n - a.n).slice(0, ABBR_TOP)) {
      let z = domov.get(f);
      if (!z) domov.set(f, (z = []));
      z.push(sk);
    }
  }
  // Most je pole, ktoré spája niekoľko súborov. Jeden nespája nič, dvesto tiež nie.
  const mosty = new Set([...pocet.entries()].filter(([, n]) => n >= SEED_MIN && n <= SEED_MAX).map(([p]) => p));

  const modules = files.map((f) => {
    const zaklad = describe(f);
    const seeds = [...(vSubore.get(f) ?? [])].filter((p) => mosty.has(p)).slice(0, 2);
    seeds.push(...(domov.get(f) ?? []));
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
    /*
      Skryté pojmy: mapa hľadá viac, než zobrazuje.

      Riadok mapy zostáva jeden — mení sa len to, že sa hľadá aj v pojmoch,
      ktoré na ňom nestoja. Varovanie „každý pojem navyše je ďalšia vec, čo môže
      zostarnúť" platí na to, čo sa vypisuje a číta; toto sa stavia znova pri
      každom behu, takže zostarnúť nemá kedy.

      Vzácny identifikátor rozlišuje: `prebitieZTela` je v troch súboroch a
      spája ich, `useState` je v tristo a nespája nič. Strop je preto na počte
      súborov, nie na dĺžke slova.

      Namerané, dotaz celou vetou: MRR 0,374 → 0,535, R@1 30,0 → 44,3 %,
      R@12 56,7 → 73,7 %. Jedno slovo 0,206 → 0,242 a prázdnych odpovedí z 11,0
      na 7,0 %. Drží na oboch poloviciach sady (+0,176 a +0,146).

      A pravdivosť ukazovateľov stúpla z 68,1 na 92,9 %: súbor sa teraz nájde
      preto, že to slovo naozaj obsahuje, nie preto, že sa trafil kmeň. Kmeň sa
      spúšťa trikrát menej často a práve on bol tá nepresná časť.

      Cena: mapa sa stavia 1,16 s namiesto 1,0 a dotaz zasiahne v priemere 18,8
      modulov namiesto 7,2. Výpis je aj tak orezaný na dvanásť, takže sa to
      prejaví len na čísle „z koľkých" a na `--all`.
    */
    const skryte = chceSkryte
      ? [...(idSubor.get(f) ?? [])].filter((w) => (idPocet.get(w) ?? 0) <= SKRYTE_MAX)
      : [];
    return { path: relative(ROOT, f).split(sep).join('/'), ...zaklad, description: popis, skryte };
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

/**
 * One lookup.
 *
 * A function rather than a straight branch because of `--batch`: building the
 * map takes about half a second, and a benchmark that runs a few hundred
 * queries spends all its time rebuilding the same thing. Batching turns twelve
 * minutes into seconds, which is the difference between measuring a change and
 * assuming it helped.
 */
function lookup(word, { all: showAll = false } = {}) {
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

  const score = (m, slovo = word) => {
    const file = undiacritic(basename(m.path));
    const dir = undiacritic(dirname(m.path));
    const desc = undiacritic(m.description ?? '');
    /*
      Presná zhoda je iná trieda dôkazu než podreťazec.

      Namerané zlyhanie: „Na Zákazkách vidno zákazky, nie štrnásť filtrov" má
      správne `src/app/zakazky/Zoznam.tsx`, a mapa vrátila `PoznamkaZakazky.tsx`
      a `RiadokZakazky.tsx`. Slovo pomenúvalo obrazovku — teda priečinok — a
      vyhrali súbory, ktoré ho mali len ako kus názvu.

      `zakazky` ako celý úsek cesty a `zakazky` uprostred `PoznamkaZakazky` sú
      dve rôzne veci; predtým to bolo jedno číslo. To isté pri názve súboru:
      názov, ktorý sa slovu rovná, verzus názov, ktorý ho obsahuje.

      Namerané (MRR): veta 0,421 → 0,443, jednoslovný dotaz 0,251 → 0,264,
      skratky 0,270 → 0,372. Drží na oboch poloviciach sady, čo predchádzajúci
      pokus — dvíhať váhu popisu — nesplnil: +0,020 na prvej, nula na druhej.
      Plató je široké, nie špička, takže to nie je trafené do vzorky.
    */
    const useky = dir.split('/').filter(Boolean);
    const holy = file.replace(/\.[^.]+$/, '');
    let where =
      (useky.includes(slovo) ? 5 : dir.includes(slovo) ? 2 : 0) +
      (holy === slovo ? 5 : file.includes(slovo) ? 3 : 0) +
      (desc.includes(slovo) ? 2 : 0) +
      // Najnižšie zo všetkého: skrytý pojem hovorí „toto slovo v tom súbore je",
      // nie „ten súbor je o tom".
      (m.skryte?.some((w) => w.includes(slovo)) ? 1 : 0);
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
    return ABLATE.has('rank') ? 1 : where + slovo.length / (file.length + 1);
  };
  let all = map.modules.map((m) => ({ ...m, score: score(m) })).filter((m) => m.score > 0);

  /*
    Dotaz o viacerých slovách.

    Doslovná zhoda hľadá celú vetu ako jeden reťazec, takže „odoslanie faktúry
    klientovi" nevrátilo nikdy nič — namerané na 300 zadaniach: **sto percent**
    prepadlo. Pritom presne takto sa pýta človek a takto zadanie ďalej podá
    agent, ktorý ho od človeka dostal. Bola to najväčšia diera v mape a
    benchmark ju nevidel, lebo jej podsúval jednotlivé slová.

    Tri veci naraz, každá zmeraná zvlášť (MRR z 0,000):

    - **Váha podľa vzácnosti.** Slovo, ktoré sedí na tristo modulov,
      nerozlišuje nič; slovo na tri rozlišuje všetko. Zoznam bezvýznamných
      slov netreba — „pre" a „cez" sa umlčia samy. → 0,351
    - **Kmeň po slovách.** Záchrana za celý dotaz tu nestačí: stačí, aby jedno
      slovo trafilo čokoľvek, a ostatné sa už v inom tvare neskúsia. → 0,365
    - **Pokrytie otázky.** Súbor, ktorý sa dotýka viacerých slov zadania, je
      pravdepodobnejšie ten hľadaný než súbor s jedným slovom v názve. → 0,424

    Váha pokrytia je 1 — skóre krát počet trafených slov. Vyššie hodnoty merali
    o 0,005 lepšie a to je pri tejto vzorke šum; jednotka má aspoň význam, ktorý
    sa dá povedať vetou.
  */
  if (!all.length && !ABLATE.has('veta')) {
    const slova = [...new Set(word.match(/[a-z0-9]{3,}/g) ?? [])];
    if (slova.length > 1) {
      const N = map.modules.length;
      const suma = new Map();
      const pokrytie = new Map();
      for (const t of slova) {
        let zasahy = map.modules.map((m) => [m, score(m, t)]).filter(([, sc]) => sc > 0);
        // Slovo, ktoré nesedí v tvare, v akom bolo napísané, sa skúsi v kmeni.
        // Hlas má tichší: kmeň je dohad, doslovná zhoda nie.
        let istota = 1;
        if (!zasahy.length && t.length >= 6 && !ABLATE.has('stem')) {
          const kmen = t.slice(0, Math.max(4, t.length - 3));
          zasahy = map.modules.map((m) => [m, score(m, kmen)]).filter(([, sc]) => sc > 0);
          istota = 0.6;
        }
        // Slovo na viac než tretinu projektu nie je otázka, je to výplň.
        if (!zasahy.length || zasahy.length > N / 3) continue;
        const vaha = Math.log(N / zasahy.length) * istota;
        for (const [m, sc] of zasahy) {
          suma.set(m, (suma.get(m) ?? 0) + sc * vaha);
          pokrytie.set(m, (pokrytie.get(m) ?? 0) + 1);
        }
      }
      all = [...suma].map(([m, sc]) => ({ ...m, score: sc * pokrytie.get(m) }));
    }
  }

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
  if (!all.length && word.length >= 6 && !ABLATE.has('stem')) {
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
  const shown = showAll ? all : all.slice(0, LIMIT);
  for (const m of shown) console.log(`${m.path}${m.line ? `:${m.line}` : ''} — ${m.description ?? '—'}`);
  if (!all.length) {
    console.log('Nothing. Try grep, or the archive: node memex/scripts/search.mjs "words"');
  } else if (all.length > shown.length) {
    console.log(`\n${shown.length} of ${all.length} modules, best match first. All of them: --all`);
  } else {
    console.log(`\n${all.length} modules.`);
  }
}

if (argv[0] === 'find') {
  if (argv.includes('--batch')) {
    // Dotaz na riadok zo stdin, výsledky oddelené znakom, ktorý sa v cestách
    // ani popisoch nevyskytuje.
    const vstup = readFileSync(0, 'utf8');
    for (const r of vstup.split('\n')) {
      const q = undiacritic(r.trim());
      if (!q) continue;
      lookup(q, { all: false });
      // Oddeľovač záznamov: NUL sa nevyskytuje v ceste ani v popise.
      process.stdout.write(String.fromCharCode(0) + String.fromCharCode(10));
    }
  } else {
    lookup(undiacritic(argv.slice(1).filter((a) => !a.startsWith('--')).join(' ')), {
      all: argv.includes('--all'),
    });
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
