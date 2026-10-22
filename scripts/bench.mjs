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
 * `vyzvy`   Nájde mapa súbor, ktorý agent upravil po zadaní človeka? Kľúč je
 *           z archívu: veta používateľa a nasledujúce `[Tool: Edit …]`.
 *
 * `parafraza` Nájde sa téma stopy, keď sa pýta slovami z rozhovoru, nie z
 *           nadpisu? Úroveň tém pozri pri funkcii `parafraza()`.
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
/*
  Druhé, nezávislé delenie sady: párne proti nepárnym úlohám.

  `BENCH_SKIP` delí sadu chronologicky, čo je správne, keď sa overuje, že
  zlepšenie nie je vlastnosťou jedného obdobia projektu. Nestačí to však na
  otázku „nie je to trafené do vzorky": obe polovice sa líšia aj tým, čo sa
  vtedy programovalo, takže rozdiel medzi nimi má dva možné dôvody naraz.

  `BENCH_MOD=0` a `BENCH_MOD=1` rozdelia tie isté úlohy striedavo. Obdobie je
  v oboch polovicach rovnaké, takže rozdiel môže byť už len vzorka. Zmena,
  ktorá drží na chronologickom aj na striedavom delení, je nález.
*/
const MOD = process.env.BENCH_MOD === undefined ? null : Number(process.env.BENCH_MOD);

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
  let preskocene = 0, videnych = 0;
  for (const blok of raw.split('\0').slice(1)) {
    const [sprava, ...riadky] = blok.split('\n');
    const subory = riadky.map((r) => r.trim())
      .filter((r) => /^(src|scripts)\//.test(r) && /\.(ts|tsx|mjs|mts)$/.test(r));
    if (!subory.length || subory.length > 6) continue;
    const slova = dotazyZo(sprava);
    if (!slova.length) continue;
    if (preskocene < SKIP) { preskocene++; continue; }
    if (MOD !== null && (videnych++ % 2) !== MOD) continue;
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
      const ok = suboryStermom.has(c);
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
/** To isté preosiatie opakovaní ako v `search.mjs` — merať sa má to, čo beží. */
function bezOpakovani(r, n) {
  const norm = (t) => undia(t).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 300);
  const videne = new Set();
  const okna = [];
  return r.filter((x) => {
    const k = norm(x.text);
    if (videne.has(k)) return false;
    if (okna.some((o) => o.subor === x.subor && x.od <= o.doo + 2 && x.doo >= o.od - 2)) return false;
    videne.add(k);
    okna.push(x);
    return true;
  }).slice(0, n);
}

function pamat() {
  const { trail } = kde();
  if (!existsSync(trail)) return `ukazovateľ nie je v ${trail}`;

  const sada = [];
  for (const f of readdirSync(trail).filter((x) => x.endsWith('.md'))) {
    const t = readFileSync(join(trail, f), 'utf8');
    const h = /^# (20\d\d-\d\d-\d\d)\s*·\s*(.+)$/m.exec(t);
    if (!h) continue;
    const body = [...t.matchAll(/\]\(([^)#]+)#L(\d+)(?:-L(\d+))?\)/g)]
      .map((m) => ({ subor: m[1].split('/').pop(), od: +m[2], do: +(m[3] ?? m[2]) }));
    if (body.length) sada.push({ nadpis: h[2].trim(), body });
  }
  if (!sada.length) return `žiadne použiteľné záznamy v ${trail}`;
  const vzorka = sada.slice(SKIP, SKIP + (N === 300 ? sada.length : N));

  /*
    Pýta sa cez `search.mjs`, nie cez vlastnú kópiu dotazu.

    Predtým si benchmark skladal výraz sám a chodil do SQLite priamo. Meral
    tým vlastný kód, nie ten, čo sa spúšťa — a tak prežila chyba, ktorá
    rozbila každý dotaz bez `--n`. Benchmark ňou neprechádzal.

    Dotaz je celý nadpis, tak ako by ho napísal človek. Rozdelenie na slová,
    kmeň, preosiatie opakovaní aj kontrola schémy sú vnútri skriptu, kde
    patria — a merajú sa tým, že tadiaľ prejde každý dotaz.
  */
  const vystup = execFileSync(
    'node',
    [fileURLToPath(new URL('./search.mjs', import.meta.url)), '--batch', '--n', '8'],
    {
      cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28,
      input: vzorka.map((u) => u.nadpis.replace(/\s+/g, ' ')).join('\n'),
    },
  );
  const bloky = vystup.split(String.fromCharCode(0));

  let r1 = 0, r3 = 0, r8 = 0, mrr = 0, prazdne = 0;
  for (let i = 0; i < vzorka.length; i++) {
    const r = (bloky[i] ?? '').split('\n')
      .map((x) => /^([\w.-]+\.md):(\d+)-(\d+)$/.exec(x.trim()))
      .filter(Boolean)
      .map((m) => ({ subor: m[1], od: +m[2], doo: +m[3] }));
    if (!r.length) { prazdne++; continue; }
    const u = vzorka[i];
    const p = r.findIndex((x) => u.body.some((b) => b.subor === x.subor && x.od <= b.do && x.doo >= b.od));
    if (p < 0) continue;
    mrr += 1 / (p + 1);
    if (p < 1) r1++;
    if (p < 3) r3++;
    if (p < 8) r8++;
  }
  const pc = (x) => ((x / vzorka.length) * 100).toFixed(1).padStart(5);
  return `n=${String(vzorka.length).padStart(3)}  R@1 ${pc(r1)}%  R@3 ${pc(r3)}%  R@8 ${pc(r8)}%  MRR ${(mrr / vzorka.length).toFixed(3)}  prázdne ${pc(prazdne)}%`;
}

/*
  Benchmark úrovne tém — nájde sa téma stopy, keď sa pýta inými slovami?

  `pamat` meria úseky a dotazom je celý nadpis, takže úroveň tém by v ňom
  našla samu seba. Skutočná otázka býva iná: človek si pamätá detail
  rozhovoru, nie to, ako ho niekto nadpísal. Preto dve sady dotazov nad tými
  istými témami:

  · `rozsah` — štyri slová z textu, na ktorý téma ukazuje, a žiadne z nadpisu.
    Slová sa berú z tých, čo sú aspoň v dvoch a najviac v tristo rozsahoch:
    jedinečné by to mali zadarmo, všadeprítomné by nič nemerali.
  · `nadpis` — štyri slová z nadpisu.

  Zásah je, keď medzi prvými štyrmi témami (rôznymi nadpismi) je rozsah, ktorý
  sa prekrýva s ukazovateľom záznamu. Pýta sa cez `search.mjs --batch`, teda
  cez kód, ktorý beží.

  ⚠️ Slová z rozsahu sú zároveň v archíve, takže sada `rozsah` je ľahšia než
  skutočná parafráza. Meria, či úroveň tém parafrázu vôbec dosiahne, nie s akou
  úspešnosťou ju dosiahne pri otázke človeka.
*/
function parafraza() {
  const { trail, archive } = kde();
  if (!existsSync(trail)) return `ukazovateľ nie je v ${trail}`;
  const riadky = new Map();
  const prepis = (f) => {
    if (!riadky.has(f)) {
      try { riadky.set(f, readFileSync(join(archive, f), 'utf8').replace(/ <!-- memex:[a-f0-9]{24,64} -->/g, '').split('\n')); }
      catch { riadky.set(f, null); }
    }
    return riadky.get(f);
  };
  const zaznamy = [];
  for (const f of readdirSync(trail).filter((x) => x.endsWith('.md')).sort()) {
    const t = readFileSync(join(trail, f), 'utf8');
    const h = /^# (20\d\d-\d\d-\d\d)\s*·\s*(.+)$/m.exec(t);
    if (!h) continue;
    const body = [...t.matchAll(/\]\(([^)#]+)#L(\d+)(?:-L(\d+))?\)/g)]
      .map((m) => ({ subor: m[1].split('/').pop(), od: +m[2], do: +(m[3] ?? m[2]) }));
    if (!body.length) continue;
    const text = body.map((b) => (prepis(b.subor) ?? []).slice(b.od - 1, b.do).join('\n')).join('\n');
    zaznamy.push({ nadpis: h[2].trim(), body, text });
  }
  if (!zaznamy.length) return `žiadne použiteľné záznamy v ${trail}`;
  const df = new Map();
  for (const z of zaznamy) for (const w of new Set(undia(z.text).match(/\p{L}{5,}/gu) ?? [])) df.set(w, (df.get(w) ?? 0) + 1);
  let semienko = 11;
  const nahoda = () => ((semienko = (semienko * 1103515245 + 12345) % 2147483648) / 2147483648);
  const vyber = (zoznam, k) => { const z = [...zoznam], out = []; while (z.length && out.length < k) out.push(z.splice(Math.floor(nahoda() * z.length), 1)[0]); return out; };
  const pocet = N === 300 ? 600 : N;
  const krok = Math.max(1, Math.floor(zaznamy.length / pocet));
  const sada = [];
  for (let i = 0; i < zaznamy.length && sada.length < pocet; i += krok) {
    const z = zaznamy[i];
    const vNadpise = undia(z.nadpis).match(/\p{L}{4,}/gu) ?? [];
    const kandidati = [...new Set(undia(z.text).match(/\p{L}{5,}/gu) ?? [])]
      .filter((w) => !vNadpise.some((h) => h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5))))
      .filter((w) => (df.get(w) ?? 0) >= 2 && (df.get(w) ?? 0) <= 300);
    if (kandidati.length < 4) continue;
    const zNadpisu = z.nadpis.split(/\s+/).map((x) => x.replace(/"/g, '')).filter((x) => x.length >= 4);
    sada.push({ z, rozsah: vyber(kandidati, 4).join(' '), nadpis: vyber(zNadpisu, 4).join(' ') });
  }
  const zmeraj = (pole) => {
    const vystup = execFileSync(
      'node',
      [fileURLToPath(new URL('./search.mjs', import.meta.url)), '--batch', '--n', '8'],
      { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28, input: sada.map((u) => u[pole]).join('\n') },
    );
    const bloky = vystup.split(String.fromCharCode(0));
    let r1 = 0, r4 = 0, mrr = 0;
    const pol = [0, 0];
    sada.forEach((u, i) => {
      const blok = bloky[i] ?? '';
      const zac = blok.indexOf('Trail topics');
      if (zac < 0) return;
      const sekcia = blok.slice(zac).split('\n\n')[0];
      const temy = sekcia.split('\n').filter((r) => r.trim().startsWith('→')).map((r) => {
        let subor = null;
        return r.trim().slice(1).trim().split(', ').map((x) => {
          const m = /^(?:([\w.-]+\.md):)?(\d+)-(\d+)$/.exec(x.trim());
          if (!m) return null;
          if (m[1]) subor = m[1];
          return { subor, od: +m[2], doo: +m[3] };
        }).filter(Boolean);
      });
      const p = temy.findIndex((rozsahy) => rozsahy.some((x) => u.z.body.some((b) => b.subor === x.subor && x.od <= b.do && x.doo >= b.od)));
      if (p < 0) return;
      mrr += 1 / (p + 1); pol[i % 2] += 1 / (p + 1);
      if (p === 0) r1++;
      r4++;
    });
    const n = sada.length, pc = (x) => ((x / n) * 100).toFixed(1).padStart(5);
    return `${pole.padEnd(8)} n=${n}  R@1 ${pc(r1)}%  R@4 ${pc(r4)}%  MRR ${(mrr / n).toFixed(3)}  (párne ${(pol[0] / Math.ceil(n / 2)).toFixed(3)}, nepárne ${(pol[1] / Math.floor(n / 2)).toFixed(3)})`;
  };
  return `témy stopy, ${zaznamy.length} záznamov\n  ${zmeraj('rozsah')}\n  ${zmeraj('nadpis')}`;
}

/*
  Benchmark mapy na zadaniach človeka, nie na správach commitov.

  Správa commitu sa píše potom, keď je jasné, čo sa zmenilo — a pomenúva to.
  Zadanie sa píše predtým a opisuje problém: „na zákazkách nejde uložiť
  poznámka". Archív má obe polovice kľúča: vetu používateľa a cesty, ktoré
  agent potom upravil (`[Tool: Edit …]`). Nikto ich nepísal pre test.

  Namerané na skutočnom projekte, 400 zadaní: **MRR 0,183**, R@3 20,8 %,
  R@12 32,3 % — proti 0,735 na správach commitov toho istého repozitára.
  Benchmark z commitov teda mapu preceňuje zhruba štvornásobne, a práve tam,
  kde by mala pomáhať: pred prvým krokom. Časť zadaní sa ani nedá trafiť —
  „pokračuj", „oprav to" — ale to je aj skutočná otázka, akú dostane.

  Upravený súbor sa počíta, len keď je to kód, ktorý dnes existuje: mapa je
  o dnešnom repozitári, rovnako ako pri commitoch.
*/
function vyzvy() {
  const { archive } = kde();
  if (!existsSync(archive)) return `archív nie je v ${archive}`;
  const rel = (c) => /(?:^|[\\/])((?:src|scripts)[\\/].+)$/.exec(c.trim())?.[1]?.replace(/\\/g, '/') ?? null;
  const ulohy = [];
  for (const f of readdirSync(archive).filter((x) => x.endsWith('.md') && !x.startsWith('.')).sort()) {
    const t = readFileSync(join(archive, f), 'utf8').replace(/ <!-- memex:[a-f0-9]+ -->/g, '');
    let u = null;
    for (const tah of t.split(/\n(?=## (?:USER|CLAUDE|CODEX) - )/)) {
      if (tah.startsWith('## USER - ')) {
        if (u) ulohy.push(u);
        u = { text: tah.split('\n').slice(1).join(' ').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim(), subory: new Set() };
        continue;
      }
      if (!u) continue;
      for (const r of tah.split('\n')) {
        const m = /^\[Tool: (?:Edit|Write|MultiEdit) (.+)\]$/.exec(r.trim());
        const c = m && rel(m[1]);
        if (c && /\.(ts|tsx|mjs|mts|js)$/.test(c) && existsSync(join(APP, c))) u.subory.add(c);
      }
    }
    if (u) ulohy.push(u);
  }
  const platne = ulohy.filter((u) => u.text.length >= 30 && u.text.length <= 2000 && u.subory.size && u.subory.size <= 6);
  const pocet = N === 300 ? 400 : N;
  const krok = Math.max(1, Math.floor(platne.length / pocet));
  const sada = platne.filter((_, i) => i % krok === 0).slice(0, pocet);
  if (!sada.length) return 'žiadne zadania s úpravou kódu v archíve';
  const vys = odpovede(sada.map((u) => undia(u.text.slice(0, 400))));
  let r1 = 0, r3 = 0, r12 = 0, mrr = 0;
  const pol = [0, 0];
  sada.forEach((u, i) => {
    const p = (vys[i]?.cesty ?? []).findIndex((c) => u.subory.has(c));
    if (p < 0) return;
    mrr += 1 / (p + 1); pol[i % 2] += 1 / (p + 1);
    if (p < 1) r1++; if (p < 3) r3++; if (p < 12) r12++;
  });
  const n = sada.length, pc = (x) => ((x / n) * 100).toFixed(1).padStart(5);
  return `n=${String(n).padStart(3)}  R@1 ${pc(r1)}%  R@3 ${pc(r3)}%  R@12 ${pc(r12)}%  MRR ${(mrr / n).toFixed(3)}  (párne ${(pol[0] / Math.ceil(n / 2)).toFixed(3)}, nepárne ${(pol[1] / Math.floor(n / 2)).toFixed(3)})`;
}

const stitok = (process.env.MEMEX_ABLATE ? `bez: ${process.env.MEMEX_ABLATE}` : 'plná mapa').padEnd(22);
if (REZIM === 'parafraza') { console.log(parafraza()); process.exit(0); }
if (REZIM === 'vyzvy') { console.log(`${stitok}${vyzvy()}`); process.exit(0); }
if (REZIM === 'pravda') console.log(`${stitok}\n${pravda(ulohy(zoSlov))}`);
else if (REZIM === 'skratky') console.log(`${stitok}${recall(ulohy(zoSkratiek))}`);
else if (REZIM === 'veta') console.log(`${stitok}${recall(ulohy(zVety))}`);
else if (REZIM === 'pamat') console.log(`${'archív'.padEnd(22)}${pamat()}`);
else console.log(`${stitok}${recall(ulohy(zoSlov))}`);
