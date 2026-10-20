#!/usr/bin/env node
/**
 * Údržba pamäte po relácii — jeden proces, jedno poradie.
 *
 * Prečo to vzniklo. `hooks.json` mal pod `SessionEnd` štyri samostatné
 * príkazy: archív, index, mapa, telemetria. Čítalo sa to ako postupnosť a nie
 * je to postupnosť — Claude Code spúšťa hooky tej istej udalosti **súbežne** a
 * poradie dokončenia nezaručuje. Index sa teda môže postaviť nad archívom,
 * do ktorého sa práve zapisuje posledná relácia, a výsledok je index, ktorý
 * ju nepozná. Nič pritom nezlyhá: oba kroky skončia nulou.
 *
 * Namerané v tomto projekte: archív dopísaný o 03.586 s, index postavený o
 * 03.897 s. Rozdiel tristo milisekúnd, a stačí, aby bol raz opačný.
 *
 * Poradie je vecné, nie ľubovoľné:
 *
 *   1. **archív** — jediný krok, ktorý zachraňuje dáta pred zmazaním.
 *   2. **index** — čítá archív, takže patrí za neho.
 *   3. **mapa** — nezávislá, ale lacná.
 *   4. **telemetria** — číta surové prepisy, nikoho nezdržuje.
 *
 * Zlyhanie jedného kroku nezastaví ostatné. Archív, ktorý sa nedá dopísať,
 * nie je dôvod nechať mapu zastarať — a naopak, tichý preskok celej údržby
 * kvôli jednej chybe je presne to, ako sa stratia tri prepisy.
 *
 * Stdin číta tento proces, nie podskripty: hostiteľ ho podá raz a `stdio`
 * podskriptov je zámerne prázdny, aby oň nesúperili.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookVstup } from './kde.mjs';

const TU = dirname(fileURLToPath(import.meta.url));
const TICHO = process.argv.includes('--quiet');
// Prečítané, aby to podskriptom neprekážalo; `session_id` sa zatiaľ nikde
// ďalej nepodáva — archivátor prechádza všetky relácie, čo je správne aj vtedy,
// keď predošlý beh niečo nestihol.
hookVstup();

const KROKY = [
  ['archive.mjs', []],
  ['search.mjs', ['--index']],
  ['map.mjs', []],
  ['stats.mjs', []],
];

let zlyhalo = 0;
for (const [skript, args] of KROKY) {
  const argumenty = [join(TU, skript), ...args, ...(TICHO ? ['--quiet'] : [])];
  try {
    const out = execFileSync(process.execPath, argumenty, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1 << 24,
    });
    if (out.trim()) console.log(out.trim());
  } catch (e) {
    zlyhalo++;
    // Hlási sa nahlas aj v tichom režime: tichá neúspešná údržba je ten stav,
    // v ktorom všetko vyzerá zdravo a pamäť medzitým zaostáva.
    const preco = String(e.stderr || e.message).trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
    console.error(`memex: ${skript} failed — ${preco}`);
  }
}
process.exit(zlyhalo ? 1 : 0);
