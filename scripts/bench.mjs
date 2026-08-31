/**
 * Benchmark mapy — tri otázky, na každú iný test.
 *
 * `slova`   Nájde mapa správny súbor? Kľúč správnych odpovedí berie z gitu:
 *           správa commitu je zadanie, jeho zmenené súbory sú odpoveď. Nikto
 *           ich nepísal pre tento test, takže sa nedajú prispôsobiť tomu, čo
 *           mapa vie.
 *
 * `skratky` To isté, ale dotazom je samotná skratka (`kwp`, `dph`, `pdf`).
 *           Vlastný test, lebo `slova` berie slová od šiestich znakov a
 *           trojpísmenovej skratky sa nikdy nedotkne — merané: 0,0 % dotazov.
 *           Vylepšenie, ktoré test nemôže vyskúšať, nevyzerá neúčinne; vyzerá
 *           neexistujúco.
 *
 * `pamat`   Nájde hľadanie v archíve tú pasáž, na ktorú ukazuje ukazovateľ?
 *           Nadpis záznamu je dotaz, jeho rozsah riadkov je správna odpoveď —
 *           kľúč, ktorý nikto pre tento test nepísal, rovnako ako pri commitoch.
 *
 * `pravda`  Koľko ukazovateľov je nepravdivých? Recall vidí len to, čo mapa
 *           našla, nie čo si vymyslela. Súbor sa počíta ako pravdivý, keď
 *           hľadané slovo naozaj obsahuje. Toto je jediné miesto, kde vidno
 *           cenu kmeňa slova — ten recall dvíha, ale platí sa zaň nepresnosťou.
 *
 * MEMEX_ABLATE odstaví jednotlivé vylepšenia, takže rozdiel v úspešnosti je
 * ich príspevok — nie súčet všetkého naraz.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { kde } from './kde.mjs';
import { fileURLToPath } from 'node:url';

const APP = process.env.MEMEX_PROJECT_ROOT || process.cwd();
const MAP = fileURLToPath(new URL('./map.mjs', import.meta.url));
const REZIM = process.argv[2] ?? 'slova';
const N = Number(process.env.BENCH_N ?? 300);
const SLOV = Number(process.env.BENCH_W ?? 5);
/*
  Koľko úloh preskočiť — aby sa dala sada rozdeliť na dve polovice.

  Vylepšenie, ktoré vyjde len na jednej polovici, je náhoda vydávaná za nález.
  `BENCH_SKIP=150 BENCH_N=150` dá druhých stopäťdesiat úloh a odpoveď na to,
  či zmena drží, alebo sa len trafila do vzorky.
*/
const SKIP = Number(process.env.BENCH_SKIP ?? 0);

const STOP = new Set(['ktora', 'ktore', 'ktory', 'nielen', 'namiesto', 'pretoze', 'preto',
  'tlacidlo', 'pridane', 'pridany', 'opravene', 'oprava', 'zmena', 'zmenene', 'presun',
  'vsetky', 'vsetko', 'druhy', 'prvy', 'novy', 'nova', 'nove', 'nemusi', 'musia', 'nedostali']);
const SKRATKA = /\b(kwp|kwh|mwh|dph|ico|dic|iban|pdf|csv|xml|api|eur|ean|gps|html|crm|env|dns|smtp|jwt|url)\b/gi;
const undia = (s) => s.normalize('NFD').replace(new RegExp('[\u0300-\u036f]','g'), '').toLowerCase();

/** Úlohy z histórie: čo bolo zadanie a ktoré súbory sú správna odpoveď. */
function ulohy(dotazyZo) {
  const raw = execFileSync('git', ['log', '--no-merges', '-n', '3000', '--format=%x00%s', '--name-only'],
    { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  let preskocene = 0;
  for (const blok of raw.split('\0').slice(1)) {
    const [sprava, ...riadky] = blok.split('\n');
    const subory = riadky.map((r) => r.trim())
      .filter((r) => /^(src|scripts)\//.test(r) && /\.(ts|tsx|mjs|mts)$/.test(r));
    if (!subory.length || subory.length > 6) continue;
    const slova = dotazyZo(sprava);
    if (!slova.length) continue;
    if (preskocene < SKIP) { preskocene++; continue; }
    out.push({ sprava: sprava.trim(), subory, slova });
    if (out.length >= N) break;
  }
  return out;
}

const zoSlov = (s) => [...new Set(undia(s).match(/[a-z]{6,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, SLOV);
const zoSkratiek = (s) => [...new Set((s.match(SKRATKA) ?? []).map((x) => x.toLowerCase()))];
/*
  Celá veta ako jeden dotaz.

  Takto sa pýta človek a takto zadanie podá agent, ktorý ho dostal od človeka.
  Predchádzajúce dva režimy rozdelia vetu na slová a tým zakryjú, či to mapa
  vôbec zvládne — treba to merať tak, ako sa to naozaj použije.
*/
const zVety = (s) => (undia(s).match(/[a-z]{3,}/g) ?? []).length ? [undia(s).replace(/\s+/g, ' ').trim()] : [];

/** Jeden beh mapy na všetky dotazy naraz — inak sa mapa stavia znova pre každý. */
function odpovede(dotazy) {
  const vystup = execFileSync('node', [MAP, 'find', '--batch'], {
    cwd: APP, encoding: 'utf8', input: dotazy.join('\n'), maxBuffer: 1 << 28,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return vystup.split(String.fromCharCode(0)).map((b) => ({
    kmen: b.includes('No exact match for'),
    // Koľko modulov dotaz zasiahol spolu — výpis je orezaný na dvanásť, ale
    // veľkosť zásahu je práve to, čo hovorí, či je odpoveď ukazovateľ, či zoznam.
    zasiahnutych: Number(/(?:of|^)\s*(\d+) modules/m.exec(b)?.[1] ?? 0),
    cesty: b.split('\n').map((r) => /^([\w./[\]-]+\.\w+)(?::\d+)? — /.exec(r)?.[1]).filter(Boolean),
  }));
}

/*
  Čo sa počíta ako zásah: celá cesta.

  Pôvodne stačil názov súboru — s odôvodnením, že cesta sa v histórii mohla
  presunúť a úloha spred pol roka by inak zlyhala na presťahovaní priečinka.
  Znie to rozumne a bolo to draho zaplatené: `route.ts` je v tomto projekte
  248-krát a `page.tsx` 56-krát, takže pri takej úlohe znamenalo „správne"
  ktorýkoľvek z dvestoštyridsiatich ôsmich.

  Overené na 958 gólových súboroch: **97,7 % z nich leží dodnes na tej istej
  ceste** a názov inde má 0,7 %. Zhovievavosť teda kryla sedem prípadov zo
  938 a za to nafukovala výsledok o 17 % pri vete a 31 % pri jednom slove.

  `BENCH_LENIENT=1` vráti staré správanie, keby bolo treba porovnať so
  staršími číslami. Predvolené je prísne, lebo tak je to pravda.
*/
const LENIENT = process.env.BENCH_LENIENT === '1';
const zasah = (cesta, subory) =>
  subory.some((s) => cesta === s || (LENIENT && cesta.endsWith('/' + s.split('/').pop())));

function recall(sada) {
  const vys = odpovede(sada.flatMap((u) => u.slova));
  let i = 0, r1 = 0, r3 = 0, r12 = 0, mrr = 0, prazdne = 0;
  for (const u of sada) {
    let naj = null, nieco = false;
    for (const _ of u.slova) {
      const v = vys[i++];
      if (v?.cesty.length) nieco = true;
      const p = (v?.cesty ?? []).findIndex((c) => zasah(c, u.subory));
      if (p >= 0 && (naj === null || p + 1 < naj)) naj = p + 1;
    }
    /*
      Prázdna odpoveď, nie „nenašlo správne".

      Predtým tu stál stĺpec `nič`, ktorý bol presne `100 − R@12` — tá istá vec
      napísaná dvakrát a k tomu pomenovaná zle. Toto meria niečo iné a
      užitočné: koľkokrát mapa nevrátila vôbec nič a treba siahnuť po grepe.
    */
    if (!nieco) prazdne++;
    if (naj === null) continue;
    mrr += 1 / naj;
    if (naj <= 1) r1++;
    if (naj <= 3) r3++;
    if (naj <= 12) r12++;
  }
  const p = (n) => ((n / sada.length) * 100).toFixed(1).padStart(5);
  return `n=${String(sada.length).padStart(3)}  R@1 ${p(r1)}%  R@3 ${p(r3)}%  R@12 ${p(r12)}%  MRR ${(mrr / sada.length).toFixed(3)}  prázdne ${p(prazdne)}%`;
}

/**
 * Slovník tokenov zo zdrojov — na overenie, či súbor hľadané slovo naozaj má.
 * Dotaz je podreťazec, nie slovo, takže sa hľadá cez slovník, nie cez obsah:
 * inak by to bolo 1500 súborov × 1100 dotazov nad megabajtmi textu.
 */
function slovnik() {
  const zoznam = execFileSync('git', ['ls-files', 'src', 'scripts'], { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n').filter((f) => /\.(ts|tsx|mjs|mts)$/.test(f));
  const vSuboroch = new Map();
  for (const f of zoznam) {
    let t = '';
    try { t = readFileSync(`${APP}/${f}`, 'utf8'); } catch { continue; }
    for (const w of new Set(undia(t).match(/[a-z0-9]{2,}/g) ?? [])) {
      let s = vSuboroch.get(w); if (!s) vSuboroch.set(w, (s = new Set()));
      s.add(f);
    }
  }
  return vSuboroch;
}

function pravda(sada) {
  const dotazy = [...new Set(sada.flatMap((u) => u.slova))];
  const vys = odpovede(dotazy);
  const vSuboroch = slovnik();
  const tokeny = [...vSuboroch.keys()];
  let vratenych = 0, pravdivych = 0, kmenVratenych = 0, kmenPravdivych = 0, kmenDotazov = 0;
  const velkostPresna = [], velkostKmen = [];
  for (let i = 0; i < dotazy.length; i++) {
    const q = dotazy[i], v = vys[i]; if (!v) continue;
    const suboryStermom = new Set();
    for (const t of tokeny) if (t.includes(q)) for (const f of vSuboroch.get(t)) suboryStermom.add(f);
    if (v.zasiahnutych) (v.kmen ? velkostKmen : velkostPresna).push(v.zasiahnutych);
    if (v.kmen) kmenDotazov++;
    for (const c of v.cesty) {
      const ok = [...suboryStermom].some((f) => f === c || f.endsWith('/' + c.split('/').pop()));
      vratenych++; if (ok) pravdivych++;
      if (v.kmen) { kmenVratenych++; if (ok) kmenPravdivych++; }
    }
  }
  const presna = vratenych - kmenVratenych, presnaP = pravdivych - kmenPravdivych;
  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '  —  ').padStart(5);
  /*
    Veľkosť zásahu, nie len pravdivosť.

    Kmeň doslovnú zhodu mať nemôže — na to je: hľadá iný tvar slova. Číslo pri
    ňom preto nehovorí, že klame, ale koľko z neho treba prečítať. Odpoveď na
    dvestopäťdesiat modulov nie je ukazovateľ, je to znovu ten adresár.
  */
  const priemer = (v) => (v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—').padStart(6);
  return [
    `dotazov ${dotazy.length}, z toho cez kmeň ${kmenDotazov}`,
    `pravdivých ukazovateľov spolu   ${pc(pravdivych, vratenych)}%  (${pravdivych}/${vratenych})`,
    `  z presnej zhody               ${pc(presnaP, presna)}%  (${presnaP}/${presna})`,
    `  z kmeňa slova                 ${pc(kmenPravdivych, kmenVratenych)}%  (${kmenPravdivych}/${kmenVratenych})`,
    `priemerne zasiahnutých modulov  presná zhoda ${priemer(velkostPresna)}   kmeň ${priemer(velkostKmen)}`,
    `dotazov nad 30 modulov          presná zhoda ${velkostPresna.filter((n) => n > 30).length}   kmeň ${velkostKmen.filter((n) => n > 30).length}`,
  ].join('\n');
}

/*
  Benchmark pamäte — nájde hľadanie tú pasáž, na ktorú ukazuje ukazovateľ?

  Kľúč správnych odpovedí je hotový a nikto ho pre tento test nepísal. Záznam
  ukazovateľa má nadpis (téma vetou) a odkaz na presný rozsah riadkov
  v prepise: nadpis je dotaz, rozsah je správna odpoveď. Ten istý trik ako
  s commitmi, len na druhej polovici projektu.

  Odhalil, že prekryv úsekov bol dvojitá chyba — pozri komentár pri `useky()`
  v `search.mjs`.
*/
async function pamat() {
  const { DatabaseSync } = await import('node:sqlite');
  const { trail, index } = kde();
  if (!existsSync(trail)) return `ukazovateľ nie je v ${trail}`;
  if (!existsSync(index)) return `index nie je postavený — node memex/scripts/search.mjs --index`;

  const sada = [];
  for (const f of readdirSync(trail).filter((x) => x.endsWith('.md'))) {
    const t = readFileSync(join(trail, f), 'utf8');
    const h = /^# (20\d\d-\d\d-\d\d)\s*·\s*(.+)$/m.exec(t);
    if (!h) continue;
    const body = [...t.matchAll(/\]\(([^)#]+)#L(\d+)-L(\d+)\)/g)]
      .map((m) => ({ subor: m[1].split('/').pop(), od: +m[2], do: +m[3] }));
    if (body.length) sada.push({ nadpis: h[2].trim(), body });
  }
  if (!sada.length) return `žiadne použiteľné záznamy v ${trail}`;
  const vzorka = sada.slice(SKIP, SKIP + (N === 300 ? sada.length : N));

  const db = new DatabaseSync(index);
  const dopyt = db.prepare('SELECT subor, od, doo FROM useky WHERE useky MATCH ? ORDER BY bm25(useky) LIMIT 8');
  let r1 = 0, r3 = 0, r8 = 0, mrr = 0, prazdne = 0;
  for (const u of vzorka) {
    const slova = [...new Set(undia(u.nadpis).match(/[a-z0-9]{4,}/g) ?? [])].slice(0, 6);
    if (!slova.length) continue;
    // Rovnaká podoba dotazu ako v search.mjs — inak sa meria niečo iné.
    let r = [];
    try { r = dopyt.all(slova.map((w) => `"${w}"*`).join(' OR ')); } catch { /* nič */ }
    if (!r.length) { prazdne++; continue; }
    const p = r.findIndex((x) => u.body.some((b) => b.subor === x.subor && x.od <= b.do && x.doo >= b.od));
    if (p < 0) continue;
    mrr += 1 / (p + 1);
    if (p < 1) r1++;
    if (p < 3) r3++;
    if (p < 8) r8++;
  }
  db.close();
  const pc = (x) => ((x / vzorka.length) * 100).toFixed(1).padStart(5);
  return `n=${String(vzorka.length).padStart(3)}  R@1 ${pc(r1)}%  R@3 ${pc(r3)}%  R@8 ${pc(r8)}%  MRR ${(mrr / vzorka.length).toFixed(3)}  prázdne ${pc(prazdne)}%`;
}

const stitok = (process.env.MEMEX_ABLATE ? `bez: ${process.env.MEMEX_ABLATE}` : 'plná mapa').padEnd(22);
if (REZIM === 'pravda') console.log(`${stitok}\n${pravda(ulohy(zoSlov))}`);
else if (REZIM === 'skratky') console.log(`${stitok}${recall(ulohy(zoSkratiek))}`);
else if (REZIM === 'veta') console.log(`${stitok}${recall(ulohy(zVety))}`);
else if (REZIM === 'pamat') console.log(`${'archív'.padEnd(22)}${await pamat()}`);
else console.log(`${stitok}${recall(ulohy(zoSlov))}`);
