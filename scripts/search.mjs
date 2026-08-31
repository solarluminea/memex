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
 * Indexuje sa preto **po odstavcoch s prekryvom**, aby veta na hranici nezmizla,
 * a vracia sa okno riadkov, ktoré sa dá otvoriť.
 *
 * Slovenčina:
 *   · Text sa indexuje **dvakrát** — raz s diakritikou, raz bez nej. Bez toho
 *     „ziadost" a „žiadosť" sú dve rôzne slová a človek, ktorý píše rýchlo,
 *     nenájde nič.
 *
 *     ⚠️ Dôvod, ktorý tu stál pôvodne — že `unicode61 remove_diacritics`
 *     nezvládne `ľ`, `ô` a `ĺ` — **neplatí**. Preverené 31. 8. 2026 na SQLite
 *     3.53.3: `remove_diacritics 1` aj `2` nájdu všetky štyri tvary. Buď to
 *     bola staršia verzia, alebo omyl. Dvojitá indexácia teda rieši niečo,
 *     čo tokenizer vie sám, a dá sa zjednodušiť — nechávam ju len preto, že
 *     funguje a zmena by znamenala prestavať index. Kto sa toho chytí, nech
 *     najprv zopakuje ten pokus na svojej verzii SQLite.
 *   · `\b` sa v hľadaní nepoužíva vôbec. V JavaScripte je ASCII, takže hranica
 *     slova za „ž" neexistuje a filter ticho prepadne. Namerané trikrát za deň.
 *
 * Použitie:
 *   memex/scripts/search.mjs --index [priečinok]   postaví index
 *   memex/scripts/search.mjs "výraz" [--n 8]       hľadá
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
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

/** Bez diakritiky a malými písmenami — druhá podoba každého úseku. */
const bezDiakritiky = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Rozdelí prepis na úseky po odstavcoch, s prekryvom jedného odstavca.
 *
 * Prekryv je tam preto, že odpoveď často stojí na dvojici „otázka + odpoveď"
 * a tie sú v prepise dva susedné odstavce. Bez prekryvu by sa každá druhá
 * takáto dvojica rozpadla presne na hranici.
 */
function useky(text, maxZnakov = 2000) {
  const riadky = text.split('\n');
  const out = [];
  let zac = 0, buf = [], dlzka = 0, predosly = null;
  const uloz = (koniec) => {
    if (!buf.length) return;
    out.push({ od: zac + 1, do: koniec, text: (predosly ? predosly.text + '\n' : '') + buf.join('\n') });
    predosly = { text: buf.join('\n') };
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
  if (existsSync(cesta)) {
    // Prestavba je lacná a čiastočne dopísaný index je horší než žiadny.
    try { readFileSync(cesta); } catch { /* ignoruje sa */ }
  }
  const db = new DatabaseSync(cesta);
  db.exec('DROP TABLE IF EXISTS useky');
  db.exec(`CREATE VIRTUAL TABLE useky USING fts5(
    subor UNINDEXED, od UNINDEXED, doo UNINDEXED, text, bez, tokenize='unicode61')`);

  const vloz = db.prepare('INSERT INTO useky (subor, od, doo, text, bez) VALUES (?, ?, ?, ?, ?)');
  let spolu = 0, suborov = 0;
  for (const f of readdirSync(priecinok)) {
    if (!f.endsWith('.md') || f.startsWith('.')) continue;
    const t = readFileSync(join(priecinok, f), 'utf8');
    for (const u of useky(t)) { vloz.run(f, u.od, u.do, u.text, bezDiakritiky(u.text)); spolu++; }
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
  // Dopyt sa pýta na obe podoby naraz — kto napíše bez diakritiky, nájde
  // rovnako ako ten, kto ju napíše.
  const slova = vyraz.trim().split(/\s+/).filter(Boolean);
  const dopyt = slova.map((s) => `("${s.replace(/"/g, '')}"* OR "${bezDiakritiky(s).replace(/"/g, '')}"*)`).join(' AND ');
  let r;
  try {
    r = db.prepare(
      `SELECT subor, od, doo, snippet(useky, 3, '»', '«', ' … ', 24) AS ukazka, bm25(useky) AS skore
       FROM useky WHERE useky MATCH ? ORDER BY skore LIMIT ?`,
    ).all(dopyt, n);
  } catch (e) {
    console.error(`Could not parse the query: ${e.message}`);
    process.exit(1);
  }
  if (!r.length) { console.log('Nothing. Try fewer words, or different ones.'); return; }
  for (const x of r) console.log(`${x.subor}:${x.od}-${x.doo}\n   ${String(x.ukazka).replace(/\s+/g, ' ').slice(0, 220)}\n`);
  db.close();
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
else if (!arg.length) console.log('Usage: search.mjs --index | --file <path> | "query" [--n 8]');
else hladaj(arg.filter((a) => !a.startsWith('--') && a !== arg[arg.indexOf('--n') + 1]).join(' '), Number(arg[arg.indexOf('--n') + 1]) || 8);
