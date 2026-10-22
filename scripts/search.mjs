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
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, renameSync, statSync } from 'node:fs';
import { join, basename, dirname, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

/*
  Značka udalosti patrí archivátoru, nie čitateľovi.

  Archivátor si od 0.20.0 píše do hlavičky ťahu `<!-- memex:… -->`, aby po
  strate stavu vedel, čo už zapísal. V indexe nemá čo robiť: dvadsaťštyri
  znakov náhodného hexu na každý ťah sa vracia v ukážkach a míňa presne to,
  čo má tento nástroj šetriť.

  Odstraňuje sa len značka, nie riadok — čísla riadkov v ukazovateli musia
  ďalej sedieť na súbor na disku.
*/
const ZNACKA = / <!-- memex:[a-f0-9]{24,64} -->/g;

/*
  Témy — prvá, lacná úroveň hľadania.

  Prečo vôbec. Odpoveď na otázku do pamäte začínala prečítaním celého
  rozcestníka: **11 891 tokenov** pri 260 témach, a rastie o riadok s každou
  ďalšou. Jedno hľadanie v úsekoch stojí okolo 600. Štúdia so slepými sudcami
  dala stope 100 % a fulltextu 98 % — jedna otázka v jednom behu z troch — a
  tie dve percentá sa dnes platia dvadsaťnásobkom.

  Merané, či by stačilo hľadať v nadpisoch: otázka poskladaná z ôsmich
  najvzácnejších slov cieľovej pasáže nájde správny záznam v prvých desiatich
  nadpisoch v **57,7 %** prípadov. Keď sa z otázky vyhodia slová, ktoré v
  nadpise stoja — teda čistá parafráza — je to **0 %**.

  Z toho plynie tvar: nadpisy sú prvá úroveň, nie náhrada. Vypisujú sa **spolu**
  s úsekmi, takže nesprávny zásah v nadpisoch nie je jediné, čo agent dostane,
  a celý rozcestník sa číta až vtedy, keď ani jedno nesedí.

  Dva druhy záznamov v jednej tabuľke:

  · `trail` — kurátorské, z priečinka stopy. Napísal ich model s otvoreným
    prepisom a človek ich má prečítať; sú prvé v poradí.
  · `auto` — odvodené z archívu, zadarmo. Nadpis, ktorý si Claude napísal v
    odpovedi, a otázka používateľa. Merané proti hotovej stope: nadpis pokrýva
    53,2 % jej ukazovateľov, otázka 30,5 %, aspoň jedno **69,3 %**.

  ⚠️ `auto` nie je stopa a nikdy sa nezapisuje do `TRAIL.md`. Je ich rádovo
  tisíce (2 296 otázok v 84 prepisoch, 27 na prepis), takže sa nedajú čítať
  celé — dajú sa len prehľadať. Nadpis od modelu je malé prerozprávanie a to
  je v tomto projekte cena, ktorá sa priznáva, nie zamlčuje.
*/
const HLAVICKA = /^## (USER|CLAUDE|CODEX) - /;

/*
  Koľko textu z rozsahu sa k téme stopy zaindexuje navyše — hľadá sa v ňom,
  nevypisuje sa. Ten istý princíp, ktorý mape dal +53 % MRR.

  Prečo. Nadpis témy je jediné, čo sa v nej dalo nájsť, takže otázka položená
  inými slovami než nadpis ju nenašla nikdy — namerané 0 %, a jediná záchrana
  bolo prečítať celý rozcestník. Ten mal pri 260 témach 12 tisíc tokenov; na
  projekte, kde stopa narástla na 10 536 tém, má 3,1 MB, teda okolo milióna
  tokenov, a prečítať sa nedá vôbec.

  Namerané cez `bench.mjs parafraza` na stope s 9 944 záznamami, 537 tém,
  dotaz zo štyroch slov rozsahu, ktoré v nadpise nie sú: správna téma medzi
  prvými štyrmi v **2,4 %** → **80,8 %**, MRR 0,019 → **0,688**, na párnych
  aj nepárnych rovnako (0,706 a 0,669). Dotaz zo slov nadpisu 0,993 → 0,988.

  Nadpis váži trojnásobok textu. Pri šesťnásobku je nadpisový dotaz 0,996, ale
  parafráza len 0,610 — za päť tisícin na ľahkej sade sa tu kupuje osem
  stotín na ťažkej, kvôli ktorej to celé je.

  Vypisuje sa ďalej len nadpis a rozsah. Text je len kľúč, nie odpoveď.
*/
const SKRYTE_ZNAKOV = 2000;

/** Ukazovatele jedného záznamu stopy — jeden riadok na každý rozsah. */
function temyZoSuboruStopy(f, t) {
  const h = /^# (20\d\d-\d\d-\d\d)\s*·\s*(.+)$/m.exec(t);
  if (!h) return [];
  return [...t.matchAll(/\]\(([^)#]+)#L(\d+)(?:-L(\d+))?\)/g)].map((m) => ({
    druh: 'trail', den: h[1], nadpis: h[2].trim(), zdroj: f,
    subor: m[1].split('/').pop(), od: +m[2], doo: +(m[3] ?? m[2]),
  }));
}

function temyZoStopy() {
  if (!existsSync(CESTY.trail)) return [];
  const out = [];
  for (const f of readdirSync(CESTY.trail).filter((x) => x.endsWith('.md'))) {
    let t;
    try { t = readFileSync(join(CESTY.trail, f), 'utf8'); } catch { continue; }
    out.push(...temyZoSuboruStopy(f, t));
  }
  return out;
}

/*
  Auto-témy z jedného prepisu.

  Otázka používateľa siaha po ďalšiu otázku (to je „otázka aj odpoveď na ňu"),
  najviac 120 riadkov — dlhší rozsah prestáva byť ukazovateľ. Nadpis Clauda
  siaha po ďalší nadpis, najviac 60.

  Krátke a dlhé sa vynechávajú z rovnakého dôvodu ako v osnove: pod desať
  znakov to nie je téma, nad stodvadsať to je veta z odpovede.
*/
function autoTemy(nazov, text) {
  const riadky = text.split('\n');
  const den = /^(?:date|den):\s*(\d{4}-\d{2}-\d{2})/m.exec(text.slice(0, 300))?.[1] ?? '';
  const otazky = [], nadpisy = [];
  riadky.forEach((r, i) => {
    if (/^## USER - /.test(r)) otazky.push(i);
    else if (/^#{2,4} /.test(r) && !HLAVICKA.test(r)) nadpisy.push(i);
  });
  const out = [];
  otazky.forEach((i, k) => {
    // Prvá neprázdna veta pod hlavičkou ťahu je to, na čo sa človek pýtal.
    let veta = '';
    for (let j = i + 1; j < Math.min(i + 12, riadky.length); j++) {
      const l = riadky[j].trim();
      if (!l || l.startsWith('```') || l.startsWith('[Tool:')) continue;
      veta = l.replace(/^[-*#>\s]+/, '').slice(0, 120);
      break;
    }
    if (veta.length < 10) return;
    const koniec = Math.min(otazky[k + 1] ?? riadky.length, i + 120);
    out.push({ druh: 'auto', den, nadpis: veta, subor: nazov, od: i + 1, doo: koniec });
  });
  nadpisy.forEach((i, k) => {
    const t = riadky[i].replace(/^#+\s*/, '').replace(/[*`]/g, '').trim();
    if (t.length < 10 || t.length > 120) return;
    /*
      Aspoň pätnásť riadkov, aj keď ďalší nadpis prichádza hneď.

      Zoznam nadpisov pod sebou dával rozsahy po päť riadkov — ukazovateľ,
      ktorý neukazuje na nič. Rozsahy sa tu smú prekrývať: nie sú to úseky
      indexu, ktoré si konkurujú v bm25, sú to miesta na otvorenie.
    */
    const koniec = Math.min(Math.max(nadpisy[k + 1] ?? riadky.length, i + 15), riadky.length, i + 60);
    out.push({ druh: 'auto', den, nadpis: t, subor: nazov, od: i + 1, doo: koniec });
  });
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
  /*
    Stavia sa vedľa a až hotové sa premenuje.

    Prerušená prestavba nechávala index, ktorý vyzeral platne — správna schéma,
    čitateľné úseky — a odpovedal z tretiny archívu. Namerané, keď sa to stalo
    naozaj: 436 úsekov z troch prepisov namiesto 31 559 z tridsiatich deviatich,
    najvyšší zaindexovaný riadok 3504 pri prepise dlhom 172 383. Hľadanie
    fungovalo, len takmer nič nenašlo, a MRR spadlo z 0,622 na 0,222.

    Stačilo na to `| head` na konci príkazu: rúra sa zavrie, proces dostane
    EPIPE a skončí v polovici zápisu. Kto to spustí z hooku alebo prerušením
    Ctrl+C, dopadne rovnako.

    Premenovanie je v rámci jedného priečinka atomické, takže buď je tam starý
    index, alebo celý nový — nikdy polovica.
  */
  mkdirSync(dirname(cesta), { recursive: true });
  const docasny = `${cesta}.${process.pid}.stavia`;
  // Aj žurnál: po zabitom behu zostane `-journal` vedľa a bez neho by SQLite
  // otvorilo rozostavaný súbor ako rozrobenú transakciu.
  for (const x of [docasny, `${docasny}-journal`]) if (existsSync(x)) rmSync(x, { force: true });
  /*
    Rozostavané indexy po cudzích behoch sa upratujú.

    Stavba beží do `<index>.<pid>.stavia` a premenuje sa až hotová — to je
    ochrana proti prerušeniu a funguje. Čo nefungovalo: prerušený beh ten súbor
    nechal ležať a ďalší beh mal iné PID, takže naň nikdy nesiahol.

    Namerané na skutočnom projekte po dvoch dňoch: **11 súborov, 254 MB**,
    teda pätnásťkrát viac než samotný index. Ticho, lebo súbor s bodkou na
    začiatku nikto nevidí a `du` nikto nespúšťa.

    Maže sa len to, čo je staršie než hodina — bežiaca stavba trvá sekundy,
    takže hodina je bezpečná aj vtedy, keď dva procesy stavajú naraz.
  */
  upracZvysky(cesta, docasny);
  const db = new DatabaseSync(docasny);
  let spolu = 0, suborov = 0, tem = 0, auto = 0;
  try {
    for (const s of [SCHEMA, SCHEMA_TEMY, SCHEMA_SUBORY, SCHEMA_STOPA, SCHEMA_META]) db.exec(s);
    // Jedna transakcia odstráni potvrdenie každého jednotlivého úseku.
    db.exec('BEGIN');
    const p = prikazy(db);
    for (const [k, v] of Object.entries(META)) p.meta.run(k, v);
    // Riadky prepisov zostanú po ruke pre text tém stopy — archív sa nečíta druhýkrát.
    const riadkyPrepisov = new Map();
    for (const f of readdirSync(priecinok)) {
      if (!f.endsWith('.md') || f.startsWith('.')) continue;
      const cestaPrepisu = join(priecinok, f);
      const st = statSync(cestaPrepisu);
      const t = readFileSync(cestaPrepisu, 'utf8').replace(ZNACKA, '');
      // Auto-témy len pre archív, ktorý k tejto stope patrí. Pri `--index <iný
      // priečinok>` by ukazovali do prepisov, o ktorých rozcestník nič nevie.
      const r = zapisPrepis(p, f, t, st, priecinok === ARCHIVE);
      spolu += r.usekov; auto += r.tem;
      if (priecinok === ARCHIVE) riadkyPrepisov.set(f, t.split('\n'));
      suborov++;
    }
    if (priecinok === ARCHIVE && existsSync(CESTY.trail)) {
      for (const tf of readdirSync(CESTY.trail).filter((x) => x.endsWith('.md'))) {
        tem += zapisStopu(p, tf, (s) => riadkyPrepisov.get(s));
      }
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  // Starý index zostáva dostupný až do nahradenia hotovým súborom.
  renameSync(docasny, cesta);
  if (!TICHO) {
    console.log(`Index: ${spolu} chunks from ${suborov} transcripts -> ${cesta}`);
    console.log(`Topics: ${tem} from the trail, ${auto} derived from the archive`);
  }
}

/*
  Rozostavané indexy po cudzích behoch sa upratujú.

  Stavba beží do `<index>.<pid>.stavia` a premenuje sa až hotová — to je
  ochrana proti prerušeniu a funguje. Čo nefungovalo: prerušený beh ten súbor
  nechal ležať a ďalší beh mal iné PID, takže naň nikdy nesiahol.

  Namerané na skutočnom projekte po dvoch dňoch: **11 súborov, 254 MB**,
  teda pätnásťkrát viac než samotný index. Ticho, lebo súbor s bodkou na
  začiatku nikto nevidí a `du` nikto nespúšťa.

  Maže sa len to, čo je staršie než hodina — bežiaca stavba trvá sekundy,
  takže hodina je bezpečná aj vtedy, keď dva procesy stavajú naraz.
*/
function upracZvysky(cesta, vlastny = null) {
  try {
    const kde = dirname(cesta);
    const zaciatok = `${basename(cesta)}.`;
    for (const f of readdirSync(kde)) {
      if (!f.startsWith(zaciatok) || !/\.\d+\.stavia(-journal)?$/.test(f)) continue;
      const plna = join(kde, f);
      if (vlastny && (plna === vlastny || plna === `${vlastny}-journal`)) continue;
      if (Date.now() - statSync(plna).mtimeMs < 3600_000) continue;
      rmSync(plna, { force: true });
    }
  } catch { /* Upratovanie nesmie zabrániť stavbe indexu. */ }
}

function prikazy(db) {
  return {
    usek: db.prepare('INSERT INTO useky (subor, od, doo, text) VALUES (?, ?, ?, ?)'),
    tema: db.prepare('INSERT INTO temy (druh, den, subor, od, doo, zdroj, nadpis, skryte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    subor: db.prepare('INSERT OR REPLACE INTO subory (subor, velkost, zmena, posl_od, zaciatok, zaciatok_dlzka) VALUES (?, ?, ?, ?, ?, ?)'),
    stopa: db.prepare('INSERT OR REPLACE INTO stopa (subor, velkost, zmena) VALUES (?, ?, ?)'),
    meta: db.prepare('INSERT OR REPLACE INTO meta (kluc, hodnota) VALUES (?, ?)'),
  };
}

const odtlacok = (s) => createHash('sha1').update(s).digest('hex');

/**
 * Úseky a odvodené témy jedného prepisu.
 *
 * `odRiadku` > 1 znamená prírastok: úseky pred týmto riadkom v indexe sú a
 * nezmenili sa, takže sa delí len zvyšok. Delenie na úseky je od začiatku
 * úseku deterministické — začína s prázdnym zásobníkom — takže úseky od
 * začiatku posledného úseku vyjdú rovnaké, ako keby sa delil celý súbor.
 */
function zapisPrepis(p, f, t, st, sTemami, odRiadku = 1) {
  const riadky = t.split('\n');
  const zvysok = odRiadku > 1 ? riadky.slice(odRiadku - 1).join('\n') : t;
  let usekov = 0, tem = 0, poslOd = odRiadku;
  for (const u of useky(zvysok)) {
    p.usek.run(f, u.od + odRiadku - 1, u.do + odRiadku - 1, u.text);
    poslOd = u.od + odRiadku - 1;
    usekov++;
  }
  // Skrytý text odvodené témy nemajú: ich rozsah siaha po ďalšiu otázku, takže
  // by z nich boli druhé úseky, a to sa nemeralo. Prepočítajú sa celé —
  // koniec poslednej závisí od toho, čo pribudlo, a je ich málo.
  if (sTemami) {
    for (const x of autoTemy(f, t)) { p.tema.run(x.druh, x.den, x.subor, x.od, x.doo, f, x.nadpis, ''); tem++; }
  }
  // Odtlačok textu pred posledným úsekom: nabudúce rozhodne, či sa súbor len dopísal.
  const zaciatok = riadky.slice(0, poslOd - 1).join('\n');
  p.subor.run(f, st.size, st.mtimeMs, poslOd, odtlacok(zaciatok), zaciatok.length);
  return { usekov, tem };
}

/** Témy jedného súboru stopy so skrytým textom ich rozsahov. */
function zapisStopu(p, tf, riadkyPre) {
  const cesta = join(CESTY.trail, tf);
  let t, st;
  try { t = readFileSync(cesta, 'utf8'); st = statSync(cesta); } catch { return 0; }
  let n = 0;
  for (const x of temyZoSuboruStopy(tf, t)) {
    const skryte = (riadkyPre(x.subor) ?? []).slice(x.od - 1, x.doo).join('\n').slice(0, SKRYTE_ZNAKOV);
    p.tema.run(x.druh, x.den, x.subor, x.od, x.doo, tf, x.nadpis, skryte);
    n++;
  }
  p.stopa.run(tf, st.size, st.mtimeMs);
  return n;
}

/*
  Prírastkový index — preindexuje sa len to, čo sa zmenilo.

  Spúšťač z ROADMAP („prestavba nad tri sekundy alebo nad 150 prepisov") je
  splnený oboma číslami: 170 prepisov, prestavba 5,3 až 8,8 s. Na
  nainštalovanej verzii, kde bežali hooky súbežne, sa za tri dni päť prestavieb
  prerušilo uprostred zápisu. A stopa sa číta dlhšie než archív — 10 540
  malých súborov za 12,7 s proti 0,44 s za všetkých 30 MB prepisov — takže
  preskakovať treba aj nezmenené záznamy stopy, nie len prepisy.

  Zmena sa pozná podľa veľkosti a času zmeny súboru. Prepis, ktorý sa zmenil,
  sa celý zmaže a vloží znova; témy stopy, ktoré doňho ukazujú, tiež, lebo
  ich skrytý text je z neho. Všetko v jednej transakcii nad živým indexom:
  prerušenie ju SQLite pri ďalšom otvorení vráti späť, takže index je buď
  starý, alebo nový — rovnaká záruka, akú dávalo premenovanie, bez stavby
  celého súboru nanovo.

  Celá stavba sa robí, keď index chýba, keď nesedí schéma alebo nastavenie
  (`meta`), alebo na `--index --full`.
*/
function aktualizujIndex() {
  if (!existsSync(INDEX)) return postavIndex();
  let db;
  try { db = new DatabaseSync(INDEX); } catch { return postavIndex(); }
  if (!sediSchema(db)) { db.close(); return postavIndex(); }
  upracZvysky(INDEX);
  db.exec('PRAGMA busy_timeout = 10000');
  let usekov = 0, prepisov = 0, tem = 0, zaznamov = 0;
  try {
    const subory = readdirSync(ARCHIVE).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
    const znamy = new Map(db.prepare('SELECT * FROM subory').all().map((r) => [r.subor, r]));
    const zmenene = [];
    for (const f of subory) {
      const st = statSync(join(ARCHIVE, f));
      const z = znamy.get(f);
      if (!z || z.velkost !== st.size || z.zmena !== st.mtimeMs) zmenene.push([f, st]);
    }
    const vArchive = new Set(subory);
    const zmazane = [...znamy.keys()].filter((f) => !vArchive.has(f));

    const zoStopy = existsSync(CESTY.trail) ? readdirSync(CESTY.trail).filter((x) => x.endsWith('.md')) : [];
    const znamaStopa = new Map(db.prepare('SELECT * FROM stopa').all().map((r) => [r.subor, r]));
    const prepocitat = new Set();
    for (const tf of zoStopy) {
      const st = statSync(join(CESTY.trail, tf));
      const z = znamaStopa.get(tf);
      if (!z || z.velkost !== st.size || z.zmena !== st.mtimeMs) prepocitat.add(tf);
    }
    const vStope = new Set(zoStopy);
    for (const tf of znamaStopa.keys()) if (!vStope.has(tf)) prepocitat.add(tf);

    if (!zmenene.length && !zmazane.length && !prepocitat.size) {
      db.close();
      if (!TICHO) console.log(`Index: up to date (${subory.length} transcripts) -> ${INDEX}`);
      return;
    }

    db.exec('BEGIN');
    const p = prikazy(db);
    /*
      Dopísaný, alebo prepísaný?

      Archív sa len dopisuje — archivátor staré riadky nemení — takže skoro
      vždy stačí zahodiť posledný úsek a deliť od neho ďalej. Overí sa to, nie
      predpokladá: text pred posledným úsekom musí mať ten istý odtlačok. Inak
      sa súbor preindexuje celý.

      Namerané na kópii skutočného archívu: najdlhšia relácia (167 tisíc
      riadkov) sa preindexovala celá — 13 200 úsekov a 1 730 záznamov stopy,
      ktoré do nej ukazujú, 7,5 s pri každom zatvorení okna kvôli deviatim
      novým ťahom.
    */
    const texty = new Map();
    const odKedy = new Map();
    for (const [f] of zmenene) {
      const t = readFileSync(join(ARCHIVE, f), 'utf8').replace(ZNACKA, '');
      texty.set(f, t);
      const z = znamy.get(f);
      const dopisany = z && z.posl_od > 1 && t.length > z.zaciatok_dlzka && t[z.zaciatok_dlzka] === '\n'
        && odtlacok(t.slice(0, z.zaciatok_dlzka)) === z.zaciatok;
      odKedy.set(f, dopisany ? z.posl_od : 1);
    }
    for (const f of zmazane) odKedy.set(f, 1);

    const zmazUseky = db.prepare('DELETE FROM useky WHERE subor = ? AND od >= ?');
    const zmazAuto = db.prepare("DELETE FROM temy WHERE druh = 'auto' AND zdroj = ?");
    for (const [f, od] of odKedy) {
      zmazUseky.run(f, od);
      zmazAuto.run(f);
      if (!texty.has(f)) db.prepare('DELETE FROM subory WHERE subor = ?').run(f);
    }
    // Témy stopy, ktorých rozsah siaha do zmenenej časti, majú zastaraný skrytý text.
    const riadkyStopy = db.prepare("SELECT rowid AS id, zdroj, subor, doo FROM temy WHERE druh = 'trail'").all();
    for (const r of riadkyStopy) {
      const od = odKedy.get(r.subor);
      if (od !== undefined && Number(r.doo) >= od) prepocitat.add(r.zdroj);
    }
    const zmazTemu = db.prepare('DELETE FROM temy WHERE rowid = ?');
    for (const r of riadkyStopy) if (prepocitat.has(r.zdroj)) zmazTemu.run(r.id);

    const riadkyPrepisov = new Map();
    const riadkyPre = (s) => {
      if (!riadkyPrepisov.has(s)) {
        try { riadkyPrepisov.set(s, readFileSync(join(ARCHIVE, s), 'utf8').replace(ZNACKA, '').split('\n')); }
        catch { riadkyPrepisov.set(s, null); }
      }
      return riadkyPrepisov.get(s);
    };
    for (const [f, st] of zmenene) {
      const t = texty.get(f);
      riadkyPrepisov.set(f, t.split('\n'));
      usekov += zapisPrepis(p, f, t, st, true, odKedy.get(f)).usekov;
      prepisov++;
    }
    const zmazStopu = db.prepare('DELETE FROM stopa WHERE subor = ?');
    for (const tf of prepocitat) {
      if (vStope.has(tf)) { tem += zapisStopu(p, tf, riadkyPre); zaznamov++; }
      else zmazStopu.run(tf);
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* transakcia nezačala */ }
    db.close();
    throw e;
  }
  db.close();
  if (!TICHO) {
    console.log(`Index: ${prepisov} transcript(s) re-indexed (${usekov} chunks), ${zaznamov} trail entr${zaznamov === 1 ? 'y' : 'ies'} (${tem} topics) -> ${INDEX}`);
  }
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

  /*
    Najbližšia téma nad nálezom — a poctivo len to.

    Zoznam relácií hovorí, kde sa súbor menil, nie prečo. To býva zapísané v
    stope o kus vyššie v tom istom prepise, lebo poradie je vecné: najprv sa
    rozhodne, potom sa mení kód.

    ⚠️ Ako silný ten signál je, závisí od toho, z ktorej strany sa meria, a
    rozdiel je poučný. Zo strany tém: **66 %** ukazovateľov má do tristo
    riadkov za sebou úpravu. Zo strany úprav — čo je strana, ktorá platí tu —
    má tému do tristo riadkov pred sebou len **12 %** zo 6 824 úprav. Tém je
    436, úprav je pätnásťnásobok, takže prvé číslo o užitočnosti tohto výpisu
    nehovorí takmer nič.

    Preto sa vypisuje ako to, čo naozaj je: najbližšia téma nad nálezom, so
    vzdialenosťou. Žiadne tvrdenie o príčine — na to je 12 % primálo a
    „ukazovateľ, ktorý je správny väčšinou" je v tomto projekte zamietnutý
    tvar. Keď téma nie je, riadok nie je; nič sa nedopĺňa dohadom.
  */
  const OKNO = 300;
  const temy = temyZoStopy();
  const podlaPrepisu = new Map();
  for (const t of temy) {
    let z = podlaPrepisu.get(t.subor);
    if (!z) podlaPrepisu.set(t.subor, (z = []));
    z.push(t);
  }
  const predchadzajucaTema = (subor, riadok) => {
    const kandidati = (podlaPrepisu.get(subor) ?? [])
      .filter((t) => t.doo <= riadok && riadok - t.doo <= OKNO)
      .sort((a, b) => b.doo - a.doo);
    return kandidati[0] ?? null;
  };

  for (const x of zoradene.slice(-n)) {
    console.log(`${x.den ?? '????-??-??'}  ${x.subor}:${x.riadok}  (${x.krat}x)\n   ${x.text}`);
    const t = predchadzajucaTema(x.subor, x.riadok);
    if (t) console.log(`   ↳ nearest topic ${x.riadok - t.doo} lines above: ${t.nadpis}  (${t.subor}:${t.od}-${t.doo})`);
    console.log('');
  }
  console.log(`${podlaRelacie.size} session(s), oldest first. Open a line range to see what was said.`);
  if (temy.length) {
    console.log('"nearest topic N lines above" is proximity in the transcript, not a proven cause —');
    console.log('measured, only 12 % of edits have a trail topic within 300 lines before them.');
  }
}

/*
  Schéma indexu, na jednom mieste — aby sa dala aj overiť, nielen vytvoriť.

  Index je odvodený súbor a môže doň písať aj niekto iný. Namerané na
  skutočnom projekte: mal vlastný `scripts/pamat_hladanie.mjs`, staršiu podobu
  tohto kódu, ktorá píše do toho istého `.hladanie.db` so stĺpcom `bez` a
  tokenizérom bez skladania diakritiky. `npm run pamat:index` tým prepísal
  index a **nič nespadlo** — dotazy fungovali ďalej, len nad starou schémou:
  bez skladania diakritiky, s úsekmi 2000 znakov a s prekryvom, o ktorom už
  vieme, že ukazuje vedľa.

  Ticho horšie výsledky sú horšie než hlásená chyba. Preto sa schéma pri
  otvorení porovná a keď nesedí, index sa postaví nanovo — je to sekunda a
  správna odpoveď.
*/
const SCHEMA = `CREATE VIRTUAL TABLE useky USING fts5(
    subor UNINDEXED, od UNINDEXED, doo UNINDEXED, text,
    tokenize='unicode61 remove_diacritics 2')`;
const SCHEMA_TEMY = `CREATE VIRTUAL TABLE temy USING fts5(
    druh UNINDEXED, den UNINDEXED, subor UNINDEXED, od UNINDEXED, doo UNINDEXED, zdroj UNINDEXED, nadpis, skryte,
    tokenize='unicode61 remove_diacritics 2')`;
// Čo index pozná: prepis a jeho rozsah riadkov v tabuľkách, súbor stopy.
// `posl_od` je riadok, kde začína posledný úsek; `zaciatok` odtlačok textu pred ním.
const SCHEMA_SUBORY = 'CREATE TABLE subory (subor TEXT PRIMARY KEY, velkost INTEGER, zmena REAL, posl_od INTEGER, zaciatok TEXT, zaciatok_dlzka INTEGER)';
const SCHEMA_STOPA = 'CREATE TABLE stopa (subor TEXT PRIMARY KEY, velkost INTEGER, zmena REAL)';
const SCHEMA_META = 'CREATE TABLE meta (kluc TEXT PRIMARY KEY, hodnota TEXT)';
/*
  Nastavenie, s ktorým bol index postavený. Prírastok nad indexom s inou
  veľkosťou úseku by miešal dve delenia v jednej tabuľke — rovnaká chyba
  ako stará schéma, ktorú niekto prepísal, len tichšia.
*/
const META = { verzia: '0.27.1', chunk: String(CESTY.volby.chunk ?? 400), skryte: String(SKRYTE_ZNAKOV) };

/*
  Dotaz pre FTS5 z toho, čo človek napísal.

  Slovo do dvoch znakov sa hľadá celé, nie ako predpona. `"z"*` zahrnie každé
  slovo na „z" — v slovenčine predložka, ktorá je skoro v každej vete — a
  `"na"*` všetko od „nasadenia" po „návrh". Bm25 si také slovo umlčí sám, takže
  poradie sa tým nezmení, ale databáza musí prejsť tisíce tvarov.

  Namerané na 600 témach nad archívom so 50 tisíc úsekmi: MRR 0,832 → 0,833,
  R@8 rovnaké, a dotaz **391 → 104 ms**. Obe polovice vzorky rovnako. Zahodiť
  krátke slová celkom je horšie (0,813): čísla ako „35" alebo „36" sú v otázke
  často to najvzácnejšie.
*/
function dopytFts(vyraz) {
  return vyraz.trim().split(/\s+/)
    .map((s) => s.replace(/"/g, ''))
    .filter(Boolean)
    .map((w) => {
      if (w.length >= 7) return `("${w}"* OR "${w.slice(0, w.length - 3)}"*)`;
      return [...w].length <= 2 ? `"${w}"` : `"${w}"*`;
    })
    .join(' OR ');
}

function sediSchema(db) {
  try {
    const rovnake = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
    const u = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='useky'").get();
    if (!rovnake(u?.sql, SCHEMA)) return false;
    // Index spred úrovne tém je platný, len neúplný — prestavia sa rovnako.
    const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='temy'").get();
    if (!rovnake(t?.sql, SCHEMA_TEMY)) return false;
    const meta = Object.fromEntries(db.prepare('SELECT kluc, hodnota FROM meta').all().map((r) => [r.kluc, r.hodnota]));
    if (Object.entries(META).some(([k, v]) => meta[k] !== v)) return false;
    for (const [meno, sql] of [['subory', SCHEMA_SUBORY], ['stopa', SCHEMA_STOPA]]) {
      const r = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(meno);
      if (!rovnake(r?.sql, sql)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hladaj(vyraz, n = 8) {
  if (!existsSync(INDEX)) { console.error('No index. Build it first: --index'); process.exit(1); }
  let db = new DatabaseSync(INDEX);
  if (!sediSchema(db)) {
    db.close();
    if (!TICHO) console.error('The index was written by something else — rebuilding it.');
    postavIndex();
    db = new DatabaseSync(INDEX);
  }
  // Diakritiku skladá tokenizer na oboch stranách, takže dotaz je jedna vetva.
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
  /*
    Každé slovo aj v kmeni — slovenčina mení koniec, nie začiatok.

    Predpona v FTS5 (`"faktur"*`) pokrýva ohýbanie len vtedy, keď človek napíše
    ten kratší tvar. Kto napíše „faktúrami", dostane `"fakturami"*` a to nenájde
    „faktúra" ani „faktúrach". Mapa to rieši kmeňom už dávno; hľadanie ho
    nemalo vôbec.

    Pridáva sa, nie nahrádza: plný tvar je istejší, kmeň je záchrana. Namerané
    na 202 témach — MRR 0,603 → 0,622, R@1 49,5 → 52,0 %, R@3 69,3 → 71,3 %.
    Drží na oboch poloviciach sady (+0,009 a +0,030). Samotný kmeň bez plného
    tvaru je horší (0,600), čiže obe vetvy sú tam zaslúžene.
  */
  const dopyt = dopytFts(vyraz);
  if (!dopyt) {
    console.error('Nothing to search for. Usage: search.mjs "query" [--n 8]');
    db.close();
    return;
  }
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

      Porovnáva sa celý text. Rovnaký úvod alebo susedné okno nezaručujú
      rovnaký fakt: môžu obsahovať iné číslo či neskoršie rozhodnutie.
    */
    const surove = db.prepare(
      `SELECT subor, od, doo, text, snippet(useky, 3, '»', '«', ' … ', 24) AS ukazka, bm25(useky) AS skore
       FROM useky WHERE useky MATCH ? ORDER BY skore LIMIT ?`,
    ).all(dopyt, n * 4);
    // Odlišné čísla, veľkosť písmen aj diakritika môžu meniť význam.
    const kluc = (t) => String(t).replace(/\r\n/g, '\n').trim();
    const videne = new Set();
    r = surove.filter((x) => {
      const k = kluc(x.text);
      if (videne.has(k)) return false;
      videne.add(k);
      return true;
    }).slice(0, n);
  } catch (e) {
    console.error(`Could not parse the query: ${e.message}`);
    process.exit(1);
  }
  /*
    Témy sa pýtajú tým istým dotazom, len inej tabuľky.

    Kurátorské pred odvodenými a oboje pred úsekmi: nadpis, ktorý niekto
    napísal s otvoreným prepisom, je silnejší dôkaz než veta, ktorú vytiahol
    regex. Počty sú malé zámerne — celý zmysel tejto úrovne je, že stojí
    stovky tokenov namiesto dvanástich tisíc.
  */
  let temy = { trail: [], auto: [] };
  try {
    // Nadpis váži trojnásobok skrytého textu — pozri SKRYTE_ZNAKOV.
    const surove = db.prepare(
      `SELECT druh, den, subor, od, doo, nadpis, bm25(temy, 0, 0, 0, 0, 0, 0, 3, 1) AS skore
       FROM temy WHERE temy MATCH ? ORDER BY skore LIMIT 60`,
    ).all(dopyt);
    /*
      Jedna téma je jeden riadok, aj keď ukazuje na dve miesta.

      Záznam stopy s dvoma ukazovateľmi je v tabuľke dvakrát a vypisoval sa
      dvakrát s tým istým nadpisom — miesto zo štyroch premrhané na opakovanie.
      Rozsahy sa teraz pripíšu k prvému výskytu.
    */
    const podlaNadpisu = new Map();
    const videne = new Set();
    for (const x of surove) {
      const k = `${x.subor}:${x.od}`;
      if (videne.has(k)) continue;
      videne.add(k);
      const rozsah = { subor: x.subor, od: x.od, doo: x.doo };
      const uz = x.druh === 'trail' ? podlaNadpisu.get(`${x.den}·${x.nadpis}`) : null;
      if (uz) { uz.rozsahy.push(rozsah); continue; }
      const kam = x.druh === 'trail' ? temy.trail : temy.auto;
      if (kam.length >= (x.druh === 'trail' ? 4 : 3)) continue;
      const tema = { ...x, rozsahy: [rozsah] };
      kam.push(tema);
      if (x.druh === 'trail') podlaNadpisu.set(`${x.den}·${x.nadpis}`, tema);
    }
  } catch { /* Index spred tejto verzie témy nemá; úseky odpovedia samy. */ }

  // Zavrieť sa musí aj po prázdnom výsledku — inak zostane otvorený handle,
  // čo je na Windowse rozdiel medzi „súbor sa dá nahradiť" a „nedá".
  db.close();

  // Druhý rozsah v tom istom prepise sa píše bez mena súboru — to je 40 znakov, ktoré nič nehovoria.
  const rozsahy = (z) => z.map((r, i) => (i && r.subor === z[i - 1].subor ? '' : `${r.subor}:`) + `${r.od}-${r.doo}`).join(', ');
  const temaRiadok = (x) => `   ${x.den || '????-??-??'}  ${x.nadpis}\n      → ${rozsahy(x.rozsahy)}`;
  if (temy.trail.length) {
    console.log('Trail topics (written by hand, strongest evidence):');
    for (const x of temy.trail) console.log(temaRiadok(x));
    console.log('');
  }
  if (temy.auto.length) {
    console.log('Topics derived from the transcripts (generated, not curated):');
    for (const x of temy.auto) console.log(temaRiadok(x));
    console.log('');
  }

  if (!r.length) {
    if (!temy.trail.length && !temy.auto.length) console.log('Nothing. Try fewer words, or different ones.');
    else console.log('No passage matched, but the topics above point somewhere — open one.');
    cerstvost();
    return;
  }
  if (temy.trail.length || temy.auto.length) console.log('Passages:');
  for (const x of r) console.log(`${x.subor}:${x.od}-${x.doo}\n   ${String(x.ukazka).replace(/\s+/g, ' ').slice(0, 220)}\n`);
  /*
    Kedy sa oplatí prečítať celý rozcestník — a kedy nie.

    Toto je poistka proti tomu, čo na tejto zmene môže pokaziť odpoveď: agent
    sa uspokojí s prvým zásahom prvej úrovne a celú stopu, kde by odpoveď
    bola, neotvorí. Meranie hovorí, že nadpisy trafia 57,7 % a pri parafráze
    nič, takže veta o zvyšku musí byť vidieť práve vtedy, keď je vhodná.
  */
  if (!temy.trail.length && existsSync(CESTY.trailIndex)) zvysok();
  cerstvost();
}

/*
  Keď nesedí ani jedna kurátorská téma: prečítať celý rozcestník — ale len
  vtedy, keď sa to dá.

  Rada „prečítaj celý rozcestník" bola správna pri 260 témach a 12 tisícoch
  tokenov. Na projekte, kde stopa narástla na 10 536 tém, má rozcestník 3,1 MB,
  teda okolo milióna tokenov. Agent, ktorý tú radu poslúchne, buď narazí na
  limit čítania a uvidí prvé dva týždne, alebo zaplatí za čítanie viac než za
  celú reláciu — a v oboch prípadoch si myslí, že prečítal všetko.

  Hranica 120 kB je zhruba 40 tisíc tokenov slovenského textu. Nad ňou sa radí
  to, čo zostáva lacné: iné slová a viac úsekov. Témy sa od tejto verzie hľadajú
  aj v texte, na ktorý ukazujú, takže parafráza nadpisu už nie je dôvod čítať
  rozcestník celý.
*/
function zvysok() {
  const cesta = relative(CESTY.koren, CESTY.trailIndex).split(sep).join('/');
  let bajtov = 0;
  try { bajtov = statSync(CESTY.trailIndex).size; } catch { return; }
  if (bajtov <= 120 * 1024) {
    console.log('No curated topic matched. If the passages above do not answer it,');
    console.log(`read the whole trail index: ${cesta}`);
  } else {
    console.log(`No curated topic matched. The trail index (${cesta}) is ${(bajtov / 1048576).toFixed(1)} MB,`);
    console.log(`roughly ${Math.round(bajtov / 3 / 1000)}k tokens — do not read it whole. Try other words, or more passages: --n 20`);
  }
}

/*
  Čerstvosť odpovede, jednou vetou a len keď je čo povedať.

  Hook na začiatku relácie hlási, čo zaostalo, ale rozhoduje sa až tu: kto
  dostane osem ukazovateľov a nič viac, uzavrie, že v pamäti nič nie je — aj
  keď index nepozná posledné tri prepisy. Tichá neúplná odpoveď je horšia než
  hlásená medzera, čo je to isté pravidlo, na ktorom stojí kontrola stavu.

  Stojí to jeden `stat` na prepis nad hotovým zoznamom, žiadne čítanie.
*/
function cerstvost() {
  // V dávke nie: benchmark meria odpovede, nie stav stroja, na ktorom beží.
  if (TICHO || process.argv.includes('--batch') || !existsSync(ARCHIVE) || !existsSync(INDEX)) return;
  try {
    const kedy = statSync(INDEX).mtimeMs;
    const novsie = readdirSync(ARCHIVE)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .filter((f) => statSync(join(ARCHIVE, f)).mtimeMs > kedy).length;
    if (novsie) {
      console.log(`⚠ ${novsie} transcript(s) are newer than the index, so this answer may miss them.`);
      console.log('  Rebuild: node memex/scripts/search.mjs --index');
    }
  } catch { /* Poznámka o čerstvosti nesmie zhodiť samotnú odpoveď. */ }
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
const HLAVICKA_TAHU = /^## (?:USER - |CLAUDE - |CODEX - |TY · |JA · )/;

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
  if (TICHO && !existsSync(ARCHIVE)) process.exit(0);
  mkdirSync(ARCHIVE, { recursive: true });
  // Prvý argument, ktorý nie je prepínač. `arg[1]` samo o sebe nestačí: pri
  // `--index --quiet` z hooku by sa za priečinok vzalo `--quiet` a index by
  // sa staval do cesty, ktorá neexistuje — a v tichom režime by to nikto
  // nevidel.
  const priecinok = arg[1] && !arg[1].startsWith('--') ? arg[1] : ARCHIVE;
  // Iný priečinok alebo `--full` stavia celý index; inak sa dopĺňa, čo sa zmenilo.
  if (priecinok !== ARCHIVE || arg.includes('--full')) postavIndex(priecinok);
  else aktualizujIndex();
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
else if (arg[0] === '--batch') {
  /*
    Dotaz na riadok zo vstupu — aby sa dalo merať to, čo sa naozaj spúšťa.

    Benchmark si dotaz doteraz skladal sám a pýtal sa databázy priamo. Meral
    tým vlastnú kópiu, nie tento skript — a presne tak prežila chyba, ktorá
    rozbila každý dotaz bez `--n`: benchmark ňou neprechádzal a všetky ručné
    skúšky boli písané s `--n`.

    Oddeľovač je NUL, ktorý sa v ceste ani v ukážke nevyskytuje.
  */
  const pocet = Number(arg[arg.indexOf('--n') + 1]) || 8;
  for (const r of readFileSync(0, 'utf8').split('\n')) {
    if (r.trim()) hladaj(r.trim(), pocet);
    process.stdout.write(String.fromCharCode(0) + '\n');
  }
}
else if (!arg.length) console.log('Usage: search.mjs --index | --file <path> | --osnova [transcript] | --batch | "query" [--n 8]');
else {
  /*
    `--n` sa hľadá raz a jeho index sa overí.

    Tu stálo `arg.indexOf('--n') + 1` na dvoch miestach naraz. Keď `--n` v
    príkaze nie je, `indexOf` vráti −1, takže sa za jeho hodnotu vzal `arg[0]`
    — a to je celý dotaz. Ten sa potom z dotazu odfiltroval.

    Následok: `search.mjs "žiadosť"` nevrátilo nič a ohlásilo chybu syntaxe
    FTS5 nad prázdnym výrazom. Nešlo o jednoslovné dotazy, ako sa zdalo —
    nefungoval **žiadny** dotaz bez `--n`, čiže presne ten tvar, ktorý je
    napísaný v nápovede. Chyba prežila, lebo každý test bol písaný s `--n`.
  */
  /*
    Všetko za samotným `--` je dotaz, aj keď začína pomlčkami.

    MCP server podáva otázku od modelu ako argument. Otázka `--index` tu
    prestavala index namiesto hľadania a `--batch` čakala na vstup, kým ju
    nezabil časový limit. Za oddeľovačom sa prepínače nehľadajú.
  */
  const iSep = arg.indexOf('--');
  const prepinace = iSep > -1 ? arg.slice(0, iSep) : arg;
  const iN = prepinace.indexOf('--n');
  const pocet = iN > -1 ? Number(prepinace[iN + 1]) || 8 : 8;
  const vyraz = iSep > -1
    ? arg.slice(iSep + 1).join(' ')
    : arg.filter((a, i) => !a.startsWith('--') && !(iN > -1 && i === iN + 1)).join(' ');
  if (!vyraz.trim()) {
    console.error('Nothing to search for. Usage: search.mjs "query" [--n 8]');
    process.exit(1);
  }
  hladaj(vyraz, pocet);
}
