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
import { kde, prepisyVZdroji } from './kde.mjs';

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
      /*
        Kotva smie byť rozsah aj jediný riadok.

        Počítal sa len tvar `#L12-L34`. Záznam s kotvou `#L12` sa tým nerátal
        medzi ukazovatele vôbec — prepis, ktorý spracovaný bol, sa hlásil ako
        nespracovaný a destilátor sa naň posielal znova. Zlyhanie, ktoré vyzerá
        ako práca navyše, nie ako chyba.

        Jednoriadková kotva je legitímna: niekedy je to jedna veta a rozsah
        `#L12-L12` je len horšie napísané to isté.
      */
      pointers: [...t.matchAll(/\]\(([^)#]+)#L(\d+)(?:-L(\d+))?\)/g)]
        .map((m) => ({ path: m[1], from: +m[2], to: +(m[3] ?? m[2]) })),
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

/*
  ── oprava ────────────────────────────────────────────────────────────────

  Opraví sa len to, čo je mechanické a čo sa dá zopakovať: dopísať archív zo
  zdroja, prestaviť index, prepísať rozcestník. Všetko tri sú funkcie svojho
  vstupu, takže druhý beh dá to isté.

  Čo sa tu **nerobí**, a zámerne:

  · Nezakladá archív. To je jednorazové rozhodnutie pre daný projekt a patrí
    `/memex:archive`. Hook to nerobí z toho istého dôvodu — nástroj, ktorý si
    píše do projektu, ktorý o to nepožiadal, je chyba aj keď nič nepokazí.
  · Nedopisuje stopu. Ukazovateľ zámerne neobsahuje text, len nadpis a rozsah,
    takže sám sa preložiť inam nevie a hádať by znamenalo vymeniť hlasnú chybu
    za tichú. Na to je destilátor a ten stojí tokeny, čiže si to má vyžiadať
    človek.

  Po oprave sa pokračuje do hlásenia, aby bolo vidieť stav po nej, nie sľub.
*/
if (process.argv.includes('--oprav') || process.argv.includes('--fix')) {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const TU = dirname(fileURLToPath(import.meta.url));
  const kroky = [];
  if (existsSync(ARCHIVE)) {
    kroky.push(['archive.mjs', []], ['search.mjs', ['--index']]);
  } else {
    console.log(`Archive is not set up in this project — that is a deliberate one-time step: /memex:archive`);
  }
  if (existsSync(TRAIL) && readdirSync(TRAIL).some((x) => x.endsWith('.md'))) kroky.push(['status.mjs', ['--trail']]);
  for (const [skript, args] of kroky) {
    try {
      const out = execFileSync(process.execPath, [join(TU, skript), ...args], { encoding: 'utf8', cwd: CESTY.koren });
      console.log(`✓ ${skript} ${args.join(' ')}`.trimEnd());
      for (const l of out.trim().split('\n').filter(Boolean).slice(-3)) console.log(`    ${l}`);
    } catch (e) {
      // Zlyhaná oprava sa musí hlásiť, nie prejsť ticho — inak sa opäť tvrdí, že je zdravo.
      console.log(`✗ ${skript} ${args.join(' ')} failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`.trimEnd());
    }
  }
  console.log('');
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

/*
  Archív sa porovná so zdrojom, nehlási sa len svoj vlastný obsah.

  Toto je oprava skutočného zlyhania. Na jednom projekte bolo 84 relácií v
  Claude Code a nula v archíve, pretože `/memex:archive` tam nikto nikdy
  nespustil a hook pri chýbajúcom priečinku ticho končí nulou (zámerne — nesmie
  si zakladať archív v projekte, ktorý o to nepožiadal).

  Hlásenie na to vypísalo `Archive 0 transcripts, 0.0 MB` a nič viac. Tri
  riadky s nulami vyzerajú ako čistý stav, nie ako nezapnutý nástroj, a na
  otázku „funguje memex?" sa nad tým dá v dobrej viere odpovedať „áno".
  Chýbajúce číslo bolo to jediné, ktoré to prezradilo: **koľko relácií je v
  zdroji.**

  Preto sa tu porovnáva, a preto má hlásenie na konci verdikt a nenulový
  koniec. Ticho horšie výsledky sú horšie než hlásená chyba.
*/
const ZIVOTNOST = 30;          // cleanupPeriodDays, predvolená hodnota Claude Code
const VAROVAT_OD = 23;         // ostáva týždeň — ešte sa to dá zachrániť
const zdroj = CESTY.zdroj;
const vZdroji = prepisyVZdroji(zdroj.cesta);
const zarchivovane = new Set(transcripts.map((f) => f.replace(/\.md$/, '')));
const nezarchivovane = vZdroji.filter((x) => !zarchivovane.has(x.id));
const hrozi = nezarchivovane.filter((x) => x.dni >= VAROVAT_OD);
const problemy = [];

/*
  Keď je pamäť prestavená, hlásenie povie kde. Inak sa hľadá na predvolenom
  mieste a nenájde sa nič.

  Toto vzniklo zo skutočného omylu, a nie používateľovho. Projekt s
  `memex.json` presmeroval archív do `docs/archiv-relacii` a stopu do
  `docs/agent-plany/ukazovatel`. Kontrola sa robila príkazmi `ls .memex/` a
  `find -name TRAIL.md` — teda podľa predvolených názvov — a záver bol, že
  archív ani stopa neexistujú. Pritom tam bolo 82 prepisov a 260 tém.

  Falošný poplach je iná porucha než tichý súhlas, ale rovnako drahá: viedol k
  odporúčaniu zapnúť niečo, čo bežalo. Jeden riadok s cestami to zaváži.
*/
if (CESTY.nastavenieExistuje) {
  console.log(`Config     memex.json — archive: ${relative(CESTY.koren, ARCHIVE) || '.'}, trail: ${relative(CESTY.koren, TRAIL) || '.'}`);
}
console.log(`Archive    ${transcripts.length} transcripts, ${MB(bytes)} MB`);
if (!zdroj.cesta) {
  console.log(`           ! no transcript directory for this project — expected ${join(zdroj.zaklad, zdroj.kluc)}`);
  problemy.push('the transcript directory was not found');
} else {
  console.log(`Source     ${vZdroji.length} sessions in Claude Code, ${nezarchivovane.length} not archived`);
  if (!existsSync(ARCHIVE) && vZdroji.length) {
    console.log('\n!! MEMEX IS NOT ARCHIVING THIS PROJECT.');
    console.log(`   ${vZdroji.length} sessions exist only inside Claude Code, which deletes them after ${ZIVOTNOST} days.`);
    console.log('   The SessionEnd hook deliberately will not create the archive on its own.');
    console.log('   Start it once, here, with:  /memex:archive');
    problemy.push('the archive is not set up although sessions exist');
  } else if (nezarchivovane.length) {
    console.log(`           ! ${nezarchivovane.length} session(s) missing from the archive — /memex:archive`);
    problemy.push(`${nezarchivovane.length} session(s) missing from the archive`);
  }
  if (hrozi.length) {
    const najstarsi = hrozi[0];
    console.log(`\n!! ${hrozi.length} unarchived session(s) are about to be deleted for good.`);
    console.log(`   The oldest is ${najstarsi.dni} days old — roughly ${Math.max(ZIVOTNOST - najstarsi.dni, 0)} day(s) left: ${najstarsi.subor}`);
    problemy.push(`${hrozi.length} session(s) about to be deleted`);
  }
}
/*
  Index sa neoveruje tým, že súbor existuje.

  Dvakrát za dva dni sa stalo, že index bol na mieste, mal správnu schému,
  odpovedal — a pritom pokrýval zlomok archívu. Raz preto, že ho prepísal iný
  nástroj so staršou schémou; raz preto, že prestavbu zabil `| head` a zostalo
  436 úsekov z troch prepisov namiesto 37 080 z tridsiatich deviatich.

  V oboch prípadoch trvalo pol hodiny zistiť, že pokazený je korpus a nie kód,
  lebo hlásenie hovorilo len „built". Tieto tri riadky by to boli povedali
  hneď: koľko prepisov index pozná, či nezmeškal niečo novšie, a koľko úsekov
  v ňom vlastne je.

  Číta sa len počet — je to jeden dotaz nad hotovým indexom, nie prehľadanie.
*/
async function stavIndexu() {
  if (!existsSync(CESTY.index)) return { hlaska: 'MISSING — node memex/scripts/search.mjs --index' };
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return { hlaska: 'built (Node 22.5+ needed to inspect it)' }; }
  try {
    const db = new DatabaseSync(CESTY.index);
    const useky = db.prepare('SELECT count(*) c FROM useky').get().c;
    const suborov = db.prepare('SELECT count(DISTINCT subor) c FROM useky').get().c;
    db.close();
    const kedy = statSync(CESTY.index).mtimeMs;
    const novsie = transcripts.filter((f) => statSync(join(ARCHIVE, f)).mtimeMs > kedy);
    return { useky, suborov, novsie };
  } catch (e) {
    return { hlaska: `UNREADABLE — ${String(e.message).slice(0, 60)}` };
  }
}

/*
  Rozostavané indexy, ktoré po sebe nikto neupratal.

  Stavba ide do `<index>.<pid>.stavia` a premenuje sa až hotová. Prerušená
  stavba ten súbor nechá ležať, a upratuje ho až ďalšia stavba — od 0.21.0.
  Kto má nainštalovanú staršiu verziu, toho upratovanie nikdy nezbehne.
  Namerané na skutočnom projekte s 0.23.0: **165 MB** v piatich súboroch za tri
  dni, päťkrát viac než celý archív, a hlásenie o tom nepovedalo nič.

  Hodina je tá istá hranica ako pri stavbe: bežiaca stavba trvá sekundy.
  Žurnál hlavného indexu patrí sem tiež — hľadanie do indexu nezapisuje,
  takže starý `-journal` vedľa neho je zvyšok po niečom, čo sa neskončilo.
*/
function zvysky() {
  const kde = dirname(CESTY.index);
  const meno = CESTY.index.split(/[\\/]/).pop();
  if (!existsSync(kde)) return [];
  const out = [];
  for (const f of readdirSync(kde)) {
    const zvysok = (f.startsWith(`${meno}.`) && /\.stavia(-journal)?$/.test(f)) || f === `${meno}-journal`;
    if (!zvysok) continue;
    try {
      const s = statSync(join(kde, f));
      if (Date.now() - s.mtimeMs > 3600_000) out.push({ cesta: join(kde, f), bajtov: s.size });
    } catch { /* zmizol medzi výpisom a statom */ }
  }
  return out;
}

if (process.argv.includes('--oprav') || process.argv.includes('--fix')) {
  const { rmSync } = await import('node:fs');
  const z = zvysky();
  for (const x of z) { try { rmSync(x.cesta, { force: true }); } catch { /* ďalší beh to skúsi znova */ } }
  if (z.length) console.log(`✓ removed ${z.length} leftover index build file(s), ${MB(z.reduce((a, x) => a + x.bajtov, 0))} MB\n`);
}

const ix = await stavIndexu();
if (ix.hlaska) {
  console.log(`Full-text  ${ix.hlaska}`);
  if (/MISSING|UNREADABLE/.test(ix.hlaska)) problemy.push('the index is unusable');
} else {
  console.log(`Full-text  ${ix.useky} chunks from ${ix.suborov} of ${transcripts.length} transcripts`);
  // Prepis, ktorý index nepozná, sa nedá nájsť — a nič to inak nepovie.
  if (ix.suborov < transcripts.length) {
    console.log(`! the index is missing ${transcripts.length - ix.suborov} transcripts — node memex/scripts/search.mjs --index`);
    problemy.push(`the index is missing ${transcripts.length - ix.suborov} transcript(s)`);
  } else if (ix.novsie.length) {
    const koľko = ix.novsie.length === 1 ? '1 transcript has' : `${ix.novsie.length} transcripts have`;
    console.log(`! ${koľko} changed since the index was built — node memex/scripts/search.mjs --index`);
    problemy.push('the index is behind the archive');
  }
}
const zvyskyIndexu = zvysky();
if (zvyskyIndexu.length) {
  console.log(`! ${zvyskyIndexu.length} leftover index build file(s), ${MB(zvyskyIndexu.reduce((a, x) => a + x.bajtov, 0))} MB — status.mjs --oprav removes them`);
  problemy.push('leftover index build files waste disk space');
}
console.log(`Trail      ${z.length} topics, ${z.reduce((a, x) => a + x.pointers.length, 0)} pointers`);
if (z.some((x) => x.expired)) console.log(`           ${z.filter((x) => x.expired).length} marked "Valid until"`);
/*
  Prázdna stopa je nález, nie nula.

  Meranie, ktoré tento nástroj postavilo, dalo *stopa + archív* 100 % a
  sumarizáciu 55 %. Projekt bez jediného záznamu teda nemá „0 tém" — má
  vypnutú tú polovicu pamäte, ktorá v tom meraní vyhrala.
*/
if (!z.length && transcripts.length) {
  console.log(`           ! nothing distilled yet — the best-measured half of the memory is off`);
  console.log('             Run the distiller: "distill the archive"');
  problemy.push('the trail is empty');
}

/*
  Prepis sa načíta raz, nie raz na ukazovateľ.

  Kontrola otvárala cieľový súbor pre každý ukazovateľ zvlášť. Pri 436
  ukazovateľoch do 84 prepisov to je 436 čítaní stoviek kilobajtov namiesto
  84 — a odteraz sa z rovnakého obsahu overuje aj to nižšie, takže bez cache
  by to bolo dvakrát toľko.
*/
const prepisCache = new Map();
function riadkyPrepisu(cesta) {
  if (!prepisCache.has(cesta)) {
    try { prepisCache.set(cesta, readFileSync(cesta, 'utf8').split('\n')); }
    catch { prepisCache.set(cesta, null); }
  }
  return prepisCache.get(cesta);
}

/*
  Ukazovateľ, ktorý ukazuje do rozsahu bez svojej témy.

  Doteraz sa overovalo len to, či rozsah **existuje** — teda že súbor je na
  mieste a čísla riadkov dávajú zmysel. To je málo: ukazovateľ, ktorý sedí na
  riadku 1840 namiesto 1740, prejde ako zdravý a čitateľa pošle na nesprávne
  miesto. Presne pred tým varuje zadanie destilátora vetou „the range must
  actually contain the thing", a nič to nekontrolovalo.

  Test je hrubý zámerne: aspoň jedno slovo z nadpisu, skrátené o dva znaky
  kvôli ohýbaniu, sa musí v rozsahu vyskytnúť. Nadpis býva parafráza, takže
  nezhoda nie je dôkaz chyby — je to zoznam na prezretie, a preto je vypísaný
  ako poznámka, nie ako porucha.

  Namerané na skutočnej stope so 436 ukazovateľmi: 27 (6,2 %) nemá v rozsahu
  ani jedno slovo svojho nadpisu.
*/
const KRATKE = new Set(['ktora', 'ktore', 'ktory', 'preco', 'lebo', 'kedy', 'alebo', 'este',
  'este', 'tak', 'ako', 'nad', 'pod', 'this', 'that', 'with', 'from', 'when', 'what', 'nie', 'ale']);
const bezDiakritiky = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function temaVRozsahu(nadpis, riadky, od, doo) {
  const slova = [...new Set(bezDiakritiky(nadpis).match(/[a-z0-9]{5,}/g) ?? [])]
    .filter((w) => !KRATKE.has(w))
    .map((w) => w.slice(0, Math.max(4, w.length - 2)));
  if (!slova.length) return true;
  const text = bezDiakritiky(riadky.slice(od - 1, doo).join('\n'));
  return slova.some((w) => text.includes(w));
}

// A pointer into nothing is worse than a missing one — it sends the reader
// away and they don't come back.
let broken = 0, past = 0, mimoTemy = 0;
const chybne = new Map();
const podozrive = [];
for (const x of z) {
  for (const p of x.pointers) {
    const c = join(TRAIL, p.path);
    if (!existsSync(c)) { broken++; chybne.set(x.file, (chybne.get(x.file) ?? 0) + 1); continue; }
    const riadky = riadkyPrepisu(c);
    if (!riadky) { broken++; chybne.set(x.file, (chybne.get(x.file) ?? 0) + 1); continue; }
    if (p.from < 1 || p.to < p.from || p.to > riadky.length) {
      past++;
      chybne.set(x.file, (chybne.get(x.file) ?? 0) + 1);
      continue;
    }
    if (!temaVRozsahu(x.heading, riadky, p.from, p.to)) {
      mimoTemy++;
      if (podozrive.length < 5) podozrive.push(`${x.file} → ${p.path.split('/').pop()}:${p.from}-${p.to}`);
    }
  }
}
if (broken) console.log(`! ${broken} pointers reference a transcript that does not exist`);
if (past) console.log(`! ${past} pointers have invalid line ranges`);
/*
  Ktoré záznamy, nie koľko ukazovateľov.

  „16 rozbitých" sa nedá opraviť — kým sa nevie, ktorých deviatich záznamov sa
  to týka. A opraviť ich musí človek alebo destilátor: ukazovateľ zámerne
  neobsahuje text, len nadpis, takže sám sa preložiť inam nevie a hádať by
  znamenalo vymeniť hlasnú chybu za tichú.
*/
if (chybne.size) {
  console.log(`  in ${chybne.size} entries — redistil these:`);
  for (const [f, n] of [...chybne].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   ${f}${n > 1 ? `  (${n})` : ''}`);
  }
  if (chybne.size > 10) console.log(`   … and ${chybne.size - 10} more`);
}

/*
  Poznámka, nie porucha.

  Nadpis je často parafráza toho, čo v rozsahu naozaj stojí, takže nezhoda
  neznamená chybný ukazovateľ. Preto sa nezapočítava medzi problémy a
  nemení verdikt — je to zoznam miest, kde sa oplatí pozrieť, čo je presne
  ten druh práce, ktorý sa inak nikdy neurobí, lebo o ňom nikto nevie.
*/
if (mimoTemy) {
  const podiel = ((mimoTemy / z.reduce((a, x) => a + x.pointers.length, 0)) * 100).toFixed(1);
  console.log(`\n${mimoTemy} pointers (${podiel} %) land on a range with no word from their heading.`);
  console.log('Not necessarily wrong — a heading can paraphrase — but worth a look:');
  for (const p of podozrive) console.log(`   ${p}`);
  if (mimoTemy > podozrive.length) console.log(`   … and ${mimoTemy - podozrive.length} more`);
}

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
if (broken || past) problemy.push('some pointers do not resolve');
if (uncovered.length) problemy.push(`${uncovered.length} transcript(s) with no trail entry`);

/*
  Verdikt jednou vetou, a nenulový koniec.

  Bez tohto hlásenie vypisovalo fakty a úsudok nechávalo na čitateľa. Keď sú
  všetky čísla nuly, čítajú sa ako čistý stav — a práve tak sa stalo, že sa na
  otázku „funguje memex v tomto projekte?" odpovedalo „áno", kým tam
  nearchivoval a nedestiloval vôbec.

  Koniec je nenulový, aby sa na to dal napojiť aj skript, nie len oko.
*/
if (problemy.length) {
  console.log(`\nNOT HEALTHY — ${problemy.length} problem(s):`);
  for (const p of problemy) console.log(`  · ${p}`);
  console.log('\nRepair what can be repaired mechanically:  node memex/scripts/status.mjs --oprav');
  process.exit(1);
}
console.log('\nHealthy: the archive matches the source, the index matches the archive, the trail resolves.');
