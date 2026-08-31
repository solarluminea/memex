#!/usr/bin/env node
/**
 * Fulltextové vyhľadávanie nad archívom relácií (SQLite FTS5).
 *
 * Prečo vôbec: v poslednom meraní vyhralo rameno, ktoré malo archív a **žiadny
 * index** — hľadalo obyčajným grepom. To je najlepší dôvod dať mu poriadne
 * vyhľadávanie: posilňuje sa presne to, čo sa ukázalo ako nosné.
 *
 * Prečo nie len grep: grep nájde riadok, nie miesto v rozhovore. Archív má
 * relácie po stovkách kilobajtov a odpoveď býva rozložená do niekoľkých ťahov.
 * Indexuje sa preto **po krátkych odstavcoch** a vracia sa okno riadkov, ktoré
 * sa dá otvoriť — dosť úzke na to, aby sa dalo prečítať celé.
 *
 * Slovenčina:
 *   · Diakritiku rieši tokenizer, nie druhá kópia textu. `remove_diacritics 2`
 *     zloží „ziadost" a „žiadosť" na jedno slovo pri indexovaní aj pri dotaze,
 *     takže kto píše rýchlo, nájde rovnako ako ten, kto píše presne.
 *
 *     ⚠️ Pôvodne sa text indexoval dvakrát, raz s diakritikou a raz bez, lebo
 *     `remove_diacritics` vraj nezvládne `ľ`, `ô` a `ĺ`. Neplatí to a stálo to
 *     **44 % veľkosti indexu**: na 32 MB archívu 151,3 MB oproti 84,8 MB.
 *     Overené na 15 dotazoch v oboch podobách — počet zhôd sedel na kus
 *     v každom. Kto to bude meniť ďalej, nech ten pokus zopakuje na svojej
 *     verzii SQLite: `detail=column` zmenší index na 71,5 MB, ale rozbije
 *     `snippet()`, čiže ukážku, kvôli ktorej sa hľadá.
 *   · `\b` sa v hľadaní nepoužíva vôbec. V JavaScripte je ASCII, takže hranica
 *     slova za „ž" neexistuje a filter ticho prepadne. Namerané trikrát za deň.
 *
 * Použitie:
 *   memex/scripts/search.mjs --index [priečinok]   postaví index
 *   memex/scripts/search.mjs "výraz" [--n 8]       hľadá
 *   memex/scripts/search.mjs --osnova [prepis]     nadpisy s číslami riadkov
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { kde } from './kde.mjs';
// node:sqlite landed in Node 22.5 and stabilised in 24. Without this guard the
// failure is a bare "Cannot find module 'node:sqlite'", which reads like a
// broken install rather than an old runtime.
const TICHO = process.argv.includes('--quiet');
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // Ticho a s nulou, keď to volá hook. Starý Node je stav, nie porucha — a hook,
  // ktorý pri každom zatvorení okna zakričí o niečom, čo používateľ práve
  // nerieši, sa naučí prehliadať aj vtedy, keď povie niečo dôležité.
  if (TICHO) process.exit(0);
  console.error(`Full-text search needs Node 22.5 or newer for node:sqlite (you have ${process.version}).`);
  console.error('Everything else in memex works without it — the archive and the trail are plain files.');
  process.exit(1);
}

const CESTY = kde();
const ARCHIVE = CESTY.archive;
const INDEX = CESTY.index;

/**
 * Rozdelí prepis na úseky po odstavcoch, predvolene ~400 znakov na úsek.
 *
 * **Prečo tak krátke.** Dvetisíc tu stálo od začiatku a nikdy sa nemeralo.
 * Prehľadané na 202 témach z ukazovateľa, kde je správna odpoveď rozsah
 * riadkov, a s cenou vyjadrenou v riadkoch, ktoré musí čitateľ prejsť:
 *
 *    400 znakov   MRR 0,584   R@8 75,2 %   25 riadkov na správnu odpoveď
 *    700          0,599       78,7 %       41
 *   1200          0,601       82,2 %       64
 *   2000          0,629       81,7 %      102
 *   3000          0,605       82,2 %      159
 *
 * Dvetisíc má najlepšie MRR, o osem percent lepšie než štyristo — a stojí
 * štyrikrát viac čítania. Pri nástroji, ktorého celý zmysel je lacný
 * ukazovateľ, to nie je blízke rozhodnutie. Zásah na prvom mieste ukazujúci
 * na 110 riadkov nie je to isté ako zásah na prvom mieste ukazujúci na deväť,
 * a MRR ten rozdiel nevidí.
 *
 * Kto potrebuje radšej úspešnosť než lacnotu, prepíše `chunk` v `memex.json`.
 *
 * ⚠️ Prvé meranie tejto tabuľky vyšlo naopak — štyristo znakov vraj poráža
 * dvetisíc aj v MRR. Meralo sa nad archívom, do ktorého sa omylom pripísalo
 * všetko druhýkrát; duplicity krivia bm25. Čísla vyššie sú z obnoveného
 * archívu.
 *
 * **Bez prekryvu.** Kedysi sa ku každému úseku pridal predošlý odstavec, aby
 * sa dvojica „otázka + odpoveď" nerozpadla na hranici. Bolo to zle dvakrát:
 *
 * · Ukazovateľ klamal. Prekrytý text sa pridal, rozsah riadkov sa nerozšíril.
 *   Namerané na skutočnom úseku: 2002 zo 4064 znakov ležalo mimo hláseného
 *   rozsahu. Zhoda v tej polovici vrátila riadky, v ktorých to slovo nie je —
 *   presne to, o čom celý projekt tvrdí, že sa ukazovateľu stať nemôže.
 * · Horšie hľadalo. Každý odstavec bol v indexe dvakrát, konkuroval si sám so
 *   sebou a krivil bm25.
 */
function useky(text, maxZnakov = CESTY.volby.chunk ?? 400) {
  const riadky = text.split('\n');
  const out = [];
  let zac = 0, buf = [], dlzka = 0;
  const uloz = (koniec) => {
    if (!buf.length) return;
    out.push({ od: zac + 1, do: koniec, text: buf.join('\n') });
  };
  for (let i = 0; i < riadky.length; i++) {
    buf.push(riadky[i]);
    dlzka += riadky[i].length + 1;
    const koniecOdstavca = riadky[i].trim() === '' && dlzka > maxZnakov;
    if (koniecOdstavca) { uloz(i + 1); zac = i + 1; buf = []; dlzka = 0; }
  }
  uloz(riadky.length);
  return out;
}

function postavIndex(priecinok = ARCHIVE) {
  const cesta = priecinok === ARCHIVE ? INDEX : join(priecinok, '.search.db');
  /*
    Starý index sa zmaže, nie prepíše.

    `DROP TABLE` v SQLite uvoľnené stránky súboru nevráti — ostanú v ňom ako
    voľné miesto. Namerané: po zmenšení schémy na polovicu mal súbor na disku
    presne tých istých 178,9 MB, čo predtým. Skript hlásil hotovo a jediné,
    čo sa naozaj zmenilo, bolo nič.

    Index je odvodený súbor, ktorý sa postaví za sekundy, takže niet čo
    zachraňovať. Zmazať a postaviť nanovo je aj jediný spôsob, ako zmena
    schémy naozaj platí.
  */
  if (existsSync(cesta)) rmSync(cesta, { force: true });
  const db = new DatabaseSync(cesta);
  db.exec(`CREATE VIRTUAL TABLE useky USING fts5(
    subor UNINDEXED, od UNINDEXED, doo UNINDEXED, text,
    tokenize='unicode61 remove_diacritics 2')`);

  const vloz = db.prepare('INSERT INTO useky (subor, od, doo, text) VALUES (?, ?, ?, ?)');
  let spolu = 0, suborov = 0;
  for (const f of readdirSync(priecinok)) {
    if (!f.endsWith('.md') || f.startsWith('.')) continue;
    const t = readFileSync(join(priecinok, f), 'utf8');
    for (const u of useky(t)) { vloz.run(f, u.od, u.do, u.text); spolu++; }
    suborov++;
  }
  db.close();
  if (!TICHO) console.log(`Index: ${spolu} chunks from ${suborov} transcripts -> ${cesta}`);
}

/**
 * Names this file used to have, from git.
 *
 * A path is not a stable identity. Measured on a real project: 24 renames in
 * 300 commits, including a whole folder moving from `src/app/vykup/` to
 * `src/components/sprostredkovanie/`. Everything said about those files before
 * the move is written in the archive under the old path, and a lookup by the
 * new one silently returns a fraction of the history — the worst kind of wrong,
 * because it looks like an answer.
 *
 * Failing quietly is deliberate: no git, no repository, or a file that was
 * never committed are all ordinary, and none of them should turn a search into
 * an error.
 */
function staréNázvy(cesta) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--follow', '--diff-filter=R', '--name-status', '--format=', '--', cesta],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 },
    );
    const mená = new Set();
    for (const r of out.split('\n')) {
      const m = /^R\d*\t(.+?)\t(.+)$/.exec(r);
      if (m) mená.add(m[1]);
    }
    return [...mená];
  } catch {
    return [];
  }
}

/**
 * Which sessions touched this file, and where in them.
 *
 * The archive records a summary of every tool call, so a path that was edited
 * is written in it verbatim. That turns the archive into a backlink index for
 * free — the question "why does this file look like this" is answered by the
 * conversation that changed it, not by the commit message someone wrote after.
 *
 * No table, no index. The archive is greppable and that is the property the
 * measurement kept rewarding: the arm with the raw archive and no index scored
 * highest of everything tested. Adding a schema here would trade that away for
 * milliseconds nobody is waiting on.
 *
 * Paths are compared by their tail, normalised: the archive holds absolute
 * Windows paths, the caller says `src/app/…`, and neither should have to know
 * about the other.
 */
/**
 * Deň relácie, z frontmatteru prepisu.
 *
 * Čítajú sa prvé riadky, nie celý súbor — prepis má stovky kilobajtov a dátum
 * stojí v prvej päťke. Anglický aj slovenský kľúč, lebo archívy staršie než
 * plugin nesú `den:`.
 */
function denRelacie(nazovSuboru) {
  try {
    const hlava = readFileSync(join(ARCHIVE, nazovSuboru), 'utf8').slice(0, 300);
    return /^(?:date|den):\s*(\d{4}-\d{2}-\d{2})/m.exec(hlava)?.[1] ?? null;
  } catch {
    return null;
  }
}

function podlaSuboru(cesta, n = 8) {
  const orez = (c) => c.replace(/\\/g, '/').toLowerCase().replace(/^.*?(?=src\/|scripts\/|lib\/|app\/)/, '');
  const staré = staréNázvy(cesta);
  const hladane = [orez(cesta), ...staré.map(orez)].filter((v, i, a) => v && a.indexOf(v) === i);
  if (staré.length) {
    console.log(`Also searching former path(s): ${staré.join(', ')}\n`);
  }
  const nalezy = [];

  for (const f of readdirSync(ARCHIVE).sort()) {
    if (!f.endsWith('.md') || f.startsWith('.')) continue;
    const riadky = readFileSync(join(ARCHIVE, f), 'utf8').split('\n');
    riadky.forEach((r, i) => {
      if (!r.includes('[Tool:') && !r.includes('[Nástroj:')) return;
      const norm = r.replace(/\\/g, '/').toLowerCase();
      const vzor = hladane.find((h) => norm.includes(h));
      if (!vzor) return;
      const kde = norm.indexOf(vzor);
      /*
        Výrez okolo zhody, nie prvých sto znakov.

        Bashový príkaz býva reťaz s desiatimi cestami a hľadaná je často až
        na jeho konci — orezanie od začiatku potom ukáže úryvok, v ktorom to
        slovo nie je, a nález vyzerá ako omyl nástroja.
      */
      const od = Math.max(0, kde - 30);
      const text = (od ? '…' : '') + r.trim().slice(od, kde + vzor.length + 40) + '…';
      nalezy.push({ subor: f, riadok: i + 1, text });
    });
  }

  if (!nalezy.length) {
    console.log(`Nothing in the archive touched ${cesta}.`);
    console.log('The archive only goes back as far as it was first run.');
    return;
  }

  // Jedna relácia mohla ten súbor otvoriť dvadsaťkrát; zaujíma prvý raz,
  // lebo tam sa o ňom hovorilo, a počet, lebo ten hovorí o váhe.
  const podlaRelacie = new Map();
  for (const x of nalezy) {
    const m = podlaRelacie.get(x.subor);
    if (m) m.krat++;
    else podlaRelacie.set(x.subor, { ...x, krat: 1, den: denRelacie(x.subor) });
  }

  /*
    Chronologicky, nie podľa názvu súboru.

    Otázka nad súborom skoro nikdy neznie „ktoré relácie sa ho dotkli", znie
    „ako sa vyvíjal". Poradie je pri tom polovica odpovede: prvý záznam je
    vznik, posledný je terajší stav, a to medzi nimi je dôvod, prečo vyzerá
    takto. Relácie majú deň vo frontmatteri, takže to nie je odhad.

    Toto je zároveň to, čo sa inde stavia ako „vlákna rozhodnutí" s témami
    a zlučovaním. Súbor je lepšia os než téma: je jednoznačný a nemá ako sa
    zliať s iným.
  */
  const zoradene = [...podlaRelacie.values()].sort((a, b) => (a.den ?? '').localeCompare(b.den ?? ''));

  for (const x of zoradene.slice(-n)) {
    console.log(`${x.den ?? '????-??-??'}  ${x.subor}:${x.riadok}  (${x.krat}x)\n   ${x.text}\n`);
  }
  console.log(`${podlaRelacie.size} session(s), oldest first. Open a line range to see what was said.`);
}

function hladaj(vyraz, n = 8) {
  if (!existsSync(INDEX)) { console.error('No index. Build it first: --index'); process.exit(1); }
  const db = new DatabaseSync(INDEX);
  // Diakritiku skladá tokenizer na oboch stranách, takže dotaz je jedna vetva.
  const slova = vyraz.trim().split(/\s+/).filter(Boolean);
  /*
    OR, nie AND — poradie rozhodne bm25.

    AND žiada všetky slová v jednom úseku. Čím je úsek presnejší, tým menej
    pravdepodobná taká zhoda, takže presnosť ukazovateľa sa platila tým, že
    hľadanie nenašlo nič. OR tú podmienku ruší a poradie necháva na bm25,
    ktoré vzácne slovo váži samo — tá istá myšlienka ako pri viacslovnom
    dotaze do mapy.

    Namerané na 202 témach pri úseku 400 znakov: MRR 0,368 → 0,543,
    R@1 33,7 → 47,5 %, a prázdnych odpovedí z 11,9 % na nulu. Drží na oboch
    poloviciach sady (0,505 a 0,580).
  */
  const dopyt = slova.map((s) => `"${s.replace(/"/g, '')}"*`).join(' OR ');
  let r;
  try {
    /*
      Naberie sa štvornásobok a to isté sa nezobrazí dvakrát.

      Archív je pripisovaný, prepisy sa opakujú a rovnaká pasáž leží v ňom
      viackrát. Namerané na 202 témach: **21,7 % vrátených úsekov bolo
      doslovným opakovaním niečoho vyššie** a v 62,4 % dotazov sa premrhalo
      aspoň jedno miesto z ôsmich. Miesto v odpovedi je to jediné, čo tu je
      vzácne — osem ukazovateľov, z ktorých dva sú ten istý, je odpoveď na
      šesť.

      Vynecháva sa aj susedné okno v tom istom prepise: dva úseky, medzi
      ktorými nie je medzera, sú jedna pasáž ukázaná dvakrát.

      MRR 0,584 → 0,603, R@8 75,2 → 78,7 %, pri rovnakom počte prečítaných
      riadkov. Drží na oboch poloviciach sady (+0,020 a +0,017).
    */
    const surove = db.prepare(
      `SELECT subor, od, doo, text, snippet(useky, 3, '»', '«', ' … ', 24) AS ukazka, bm25(useky) AS skore
       FROM useky WHERE useky MATCH ? ORDER BY skore LIMIT ?`,
    ).all(dopyt, n * 4);
    const kluc = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 300);
    const videne = new Set();
    const okna = [];
    r = surove.filter((x) => {
      const k = kluc(x.text);
      if (videne.has(k)) return false;
      if (okna.some((o) => o.subor === x.subor && x.od <= o.doo + 2 && x.doo >= o.od - 2)) return false;
      videne.add(k);
      okna.push(x);
      return true;
    }).slice(0, n);
  } catch (e) {
    console.error(`Could not parse the query: ${e.message}`);
    process.exit(1);
  }
  if (!r.length) { console.log('Nothing. Try fewer words, or different ones.'); return; }
  for (const x of r) console.log(`${x.subor}:${x.od}-${x.doo}\n   ${String(x.ukazka).replace(/\s+/g, ' ').slice(0, 220)}\n`);
  db.close();
}

/*
  Osnova prepisu — nadpisy, ktoré si Claude v odpovediach napísal sám.

  Destilátor musí prejsť archív a rozhodnúť, čo stojí za záznam. Doteraz to
  znamenalo prečítať prepisy: 16,7 MB, teda **5,5 milióna tokenov**. Osnova
  tých istých prepisov má 109 kB — **35 tisíc**, čiže 156× menej — a hovorí
  presne to, čo destilátor pre rozhodovanie potrebuje: aké témy tam sú a na
  ktorom riadku.

  Overené proti hotovému ukazovateľu: 66,8 % jeho záznamov má takýto nadpis
  priamo v rozsahu, na ktorý ukazujú, alebo do štyridsiatich riadkov nad ním.
  Nie je to teda náhrada destilátora — dve tretiny tém trafí a zvyšok nie —
  ale je to zoznam miest, kde sa oplatí pozrieť, namiesto čítania všetkého.

  Hlavičky ťahov sa vynechávajú: `## CLAUDE - 2026-08-19 14:22` je značka,
  nie téma. Vynechávajú sa aj slovenské podoby, lebo archív môže niesť
  záznamy staršieho nástroja.
*/
const HLAVICKA_TAHU = /^## (?:USER - |CLAUDE - |TY · |JA · )/;

function osnova(nazovSuboru) {
  const cesta = join(ARCHIVE, nazovSuboru);
  if (!existsSync(cesta)) { console.error(`Not in the archive: ${nazovSuboru}`); return; }
  const riadky = readFileSync(cesta, 'utf8').split('\n');
  let n = 0;
  for (let i = 0; i < riadky.length; i++) {
    if (!/^#{2,4} /.test(riadky[i]) || HLAVICKA_TAHU.test(riadky[i])) continue;
    const t = riadky[i].replace(/^#+\s*/, '').replace(/[*`]/g, '').trim();
    // Príliš krátke je značka, príliš dlhé je veta z odpovede, nie nadpis.
    if (t.length < 8 || t.length > 90) continue;
    console.log(`${String(i + 1).padStart(7)}  ${t}`);
    n++;
  }
  if (!n) console.log(`No headings in ${nazovSuboru} — read it with --file or search it.`);
}

const arg = process.argv.slice(2);
if (arg[0] === '--index') {
  mkdirSync(ARCHIVE, { recursive: true });
  // Prvý argument, ktorý nie je prepínač. `arg[1]` samo o sebe nestačí: pri
  // `--index --quiet` z hooku by sa za priečinok vzalo `--quiet` a index by
  // sa staval do cesty, ktorá neexistuje — a v tichom režime by to nikto
  // nevidel.
  postavIndex(arg.slice(1).find((a) => !a.startsWith('--')) || ARCHIVE);
}
else if (arg[0] === '--file') {
  const c = arg.slice(1).find((a) => !a.startsWith('--'));
  if (!c) { console.error('Usage: search.mjs --file <path>'); process.exit(1); }
  podlaSuboru(c, Number(arg[arg.indexOf('--n') + 1]) || 8);
}
else if (arg[0] === '--osnova') {
  const f = arg.slice(1).find((a) => !a.startsWith('--'));
  if (f) osnova(f.endsWith('.md') ? f : `${f}.md`);
  else {
    // Bez argumentu: osnova celého archívu, po prepisoch.
    for (const x of readdirSync(ARCHIVE).filter((y) => y.endsWith('.md') && !y.startsWith('.')).sort()) {
      console.log(`\n## ${x}`);
      osnova(x);
    }
  }
}
else if (!arg.length) console.log('Usage: search.mjs --index | --file <path> | --osnova [transcript] | "query" [--n 8]');
else hladaj(arg.filter((a) => !a.startsWith('--') && a !== arg[arg.indexOf('--n') + 1]).join(' '), Number(arg[arg.indexOf('--n') + 1]) || 8);
