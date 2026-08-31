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
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const SUBOR = 'memex.json';

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
    // Nastavenia, ktoré nie sú cestami — nech ich netreba čítať druhýkrát.
    volby: c,
    nastavenieExistuje: existsSync(join(koren, SUBOR)),
  };
}
