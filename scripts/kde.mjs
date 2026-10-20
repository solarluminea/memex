/**
 * Kde má tento projekt pamäť — jedno miesto pre všetky skripty.
 *
 * Prečo to vzniklo. Plugin má predvolené anglické cesty (`.memex/archive`,
 * `.memex/trail`). Projekt, ktorý si ich pomenoval po svojom, ich musel podať
 * pri každom volaní ako prepínač alebo premennú prostredia. Ktorýkoľvek beh,
 * ktorý to zabudol — a hook ich nepodáva nikdy — si založil vlastný archív
 * vedľa toho skutočného.
 *
 * Namerané na jednom projekte: 39 prepisov ležalo dvakrát (65 MB a 102 MB),
 * ukazovateľ mal 153 odkazov do priečinka, ktorý neexistoval, a index bol
 * postavený nad kópiou, do ktorej nikto neukazoval. Nič z toho nezlyhalo
 * nahlas — všetko sa zapísalo a vyzeralo hotovo.
 *
 * Preto `memex.json` v koreni projektu. Nie v `.memex/`: ten býva v
 * `.gitignore`, a nastavenie, ktoré sa neprenesie na ďalší klon, tento problém
 * len presunie.
 *
 * Poradie platnosti: prepínač → premenná prostredia → `memex.json` → predvolené.
 * Prepínač vyhráva, lebo jednorazový beh musí vedieť prebiť zápis na disku.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

const SUBOR = 'memex.json';

/**
 * Kľúč, pod ktorým Claude Code drží prepisy tohto projektu.
 *
 * Skladá sa z absolútnej cesty tak, že dvojbodka a obe lomítka sa menia na
 * pomlčku — `C:\\Users\\ja\\projekt` je `C--Users-ja-projekt`. Odvodzuje sa,
 * nikdy sa nenastavuje: kľúč zapísaný do nastavenia prestane sedieť pri prvom
 * presune priečinka a archivácia potom ticho nerobí nič.
 */
export const projektKluc = (cesta) => cesta.replace(/\\/g, '/').replace(/[:/]/g, '-');

/**
 * Kde leží zdroj — priečinok s prepismi, ktoré Claude Code po 30 dňoch zmaže.
 *
 * Presunuté sem z `archive.mjs`, aby existovala jedna definícia. Kontrola
 * stavu musí porovnať archív so zdrojom, a keby si kľúč odvodzovala po svojom,
 * dve definície by sa raz rozišli — a hlásenie by tvrdilo, že je
 * zarchivované všetko, len preto, že sa pozeralo na iný priečinok.
 *
 * Hľadá sa aj bez ohľadu na veľkosť písmen: na Windowse je písmeno disku raz
 * malé a raz veľké, súborovému systému je to jedno, ale kľúč sa tým zmení.
 */
export function zdrojPrepisov(koren) {
  const zaklad = join(homedir(), '.claude', 'projects');
  const kluc = process.env.MEMEX_PROJECT ?? projektKluc(koren);
  if (existsSync(join(zaklad, kluc))) return { kluc, cesta: join(zaklad, kluc), zaklad };
  if (existsSync(zaklad)) {
    const zhoda = readdirSync(zaklad).find((f) => f.toLowerCase() === kluc.toLowerCase());
    if (zhoda) return { kluc, cesta: join(zaklad, zhoda), zaklad };
  }
  return { kluc, cesta: null, zaklad };
}

/** Prepisy v zdroji, od najstaršieho, s vekom v dňoch a veľkosťou. */
export function prepisyVZdroji(cesta) {
  if (!cesta || !existsSync(cesta)) return [];
  return readdirSync(cesta)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const s = statSync(join(cesta, f));
      return {
        subor: f,
        id: f.replace(/\.jsonl$/, ''),
        zmenene: s.mtimeMs,
        bajtov: s.size,
        dni: Math.floor((Date.now() - s.mtimeMs) / 86400000),
      };
    })
    .sort((a, b) => a.zmenene - b.zmenene);
}

/**
 * Čo hostiteľ podal hooku na stdin.
 *
 * `SessionStart` aj `SessionEnd` dostávajú JSON so `session_id` a
 * `transcript_path`. Doteraz sa to zahadzovalo a kľúč projektu sa hádal z
 * pracovného adresára — takže hook nevedel, ktorá relácia je práve tá jeho.
 * Následok bol falošný poplach pri každom otvorení okna: prepis prebiehajúcej
 * relácie v archíve pochopiteľne nie je, a hlásenie z toho spravilo „1 session
 * is not in the archive yet". Pripomienka, ktorá klame vždy, sa naučí
 * prehliadať — čo je presne to, čomu má tento súbor brániť.
 *
 * Z terminálu je stdin terminál a čítanie by čakalo na Enter, takže sa ani
 * neskúša. Čokoľvek nečakané je prázdny objekt: hook nesmie zlyhať na tvare
 * vstupu, ktorý si nepýtal.
 *
 * ⚠️ Volať len tam, kde stdin naozaj patrí hostiteľovi. Skript, ktorý si sám
 * číta vstup (`search.mjs --batch`), by oň prišiel.
 */
export function hookVstup() {
  if (process.stdin.isTTY) return {};
  try {
    const s = readFileSync(0, 'utf8');
    if (!s.trim()) return {};
    const j = JSON.parse(s);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/*
  Prepínač `--meno hodnota` z príkazového riadka.

  Hodnota, ktorá sama začína pomlčkami, sa neberie. `search.mjs --index --quiet`
  má `--index` ako príkaz, nie ako cestu, a bez tejto poistky by sa index
  postavil do priečinka menom `--quiet`. Presne to sa už raz stalo a nikto si
  toho nevšimol, lebo zápis prebehol.
*/
export const prepinac = (meno, argv = process.argv) => {
  const i = argv.indexOf(`--${meno}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
};

function precitaj(koren) {
  const p = join(koren, SUBOR);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    // Pokazené nastavenie sa nesmie prejsť ticho — inak sa opäť píše inam.
    console.error(`⚠ ${p} sa nedá prečítať: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Cesty pre tento projekt.
 *
 * `koren` je koreň projektu; všetko relatívne sa počíta od neho, aby sa
 * nastavenie dalo napísať prenosne a fungovalo aj pri volaní z podpriečinka.
 */
export function kde(koren = process.env.MEMEX_PROJECT_ROOT || process.cwd(), argv = process.argv) {
  const c = precitaj(koren);
  const abs = (x) => (isAbsolute(x) ? x : join(koren, x));
  const vyber = (flag, env, zNastavenia, predvolene) =>
    abs(prepinac(flag, argv) ?? process.env[env] ?? zNastavenia ?? predvolene);

  const root = vyber('root', 'MEMEX_ROOT', c.root, '.memex');
  const archive = vyber('archive', 'MEMEX_ARCHIVE', c.archive, join(root, 'archive'));
  return {
    koren,
    root,
    archive,
    // `--index-into`, nie `--index`: to druhé je v `search.mjs` príkaz.
    index: vyber('index-into', 'MEMEX_INDEX', c.index, join(archive, '.search.db')),
    trail: vyber('trail-dir', 'MEMEX_TRAIL', c.trail, join(root, 'trail')),
    trailIndex: vyber('trail-into', 'MEMEX_TRAIL_INDEX', c.trailIndex, join(root, 'TRAIL.md')),
    map: vyber('map', 'MEMEX_MAP', c.map, join(root, 'MAP.md')),
    stats: vyber('stats', 'MEMEX_STATS', c.stats, join(root, 'stats.jsonl')),
    // Zdroj, ktorý sa archivuje — aby kontrola mala s čím porovnávať.
    zdroj: zdrojPrepisov(koren),
    // Nastavenia, ktoré nie sú cestami — nech ich netreba čítať druhýkrát.
    volby: c,
    nastavenieExistuje: existsSync(join(koren, SUBOR)),
  };
}
