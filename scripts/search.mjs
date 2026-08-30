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
 *     nenájde nič. Unicode61 s `remove_diacritics` rieši len časť; `ľ`, `ô`
 *     a `ĺ` mu prejdú.
 *   · `\b` sa v hľadaní nepoužíva vôbec. V JavaScripte je ASCII, takže hranica
 *     slova za „ž" neexistuje a filter ticho prepadne. Namerané trikrát za deň.
 *
 * Použitie:
 *   memex/scripts/search.mjs --index [priečinok]   postaví index
 *   memex/scripts/search.mjs "výraz" [--n 8]       hľadá
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
// node:sqlite landed in Node 22.5 and stabilised in 24. Without this guard the
// failure is a bare "Cannot find module 'node:sqlite'", which reads like a
// broken install rather than an old runtime.
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error(`Full-text search needs Node 22.5 or newer for node:sqlite (you have ${process.version}).`);
  console.error('Everything else in memex works without it — the archive and the trail are plain files.');
  process.exit(1);
}

const ARCHIVE = process.env.MEMEX_ARCHIVE || join(process.cwd(), '.memex', 'archive');
const INDEX = process.env.MEMEX_INDEX || join(ARCHIVE, '.search.db');

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
  const cesta = process.env.MEMEX_INDEX || join(priecinok, '.search.db');
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
  console.log(`Index: ${spolu} chunks from ${suborov} transcripts -> ${cesta}`);
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
if (arg[0] === '--index') { mkdirSync(ARCHIVE, { recursive: true }); postavIndex(arg[1] || ARCHIVE); }
else if (!arg.length) console.log('Usage: search.mjs --index | "query" [--n 8]');
else hladaj(arg.filter((a) => !a.startsWith('--') && a !== arg[arg.indexOf('--n') + 1]).join(' '), Number(arg[arg.indexOf('--n') + 1]) || 8);
