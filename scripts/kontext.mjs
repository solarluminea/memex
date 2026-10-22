#!/usr/bin/env node
/**
 * Kam idú tokeny — rozpočet kontextu zo surových prepisov.
 *
 * Prečo vôbec, keď je tu `stats.mjs`. Telemetria počíta „čerstvé vstupné
 * tokeny na zásah", teda vstup a zápis do cache. Na projekte, kde memex beží,
 * to je **štvrtina ceny**. Tri štvrtiny sú čítanie z cache: model pri každom
 * volaní znova prečíta celý kontext, a čítanie stojí desatinu — ale volaní sú
 * desaťtisíce a kontext má stovky tisíc tokenov. Namerané na 68 tisícoch
 * volaní: priemerný kontext 257 tisíc tokenov, čítanie z cache 71 % ceny,
 * zápis 25 %, výstup 4,5 %.
 *
 * Z toho plynie, čo sa oplatí šetriť. Nie stovky tokenov vo výpise nástroja,
 * ale **veľkosť kontextu krát počet volaní, ktoré ho ešte nesú**. Výstup
 * nástroja z dvadsiateho volania sa platí pri každom ďalšom, až po kompakciu.
 *
 * Tri otázky, každá na jeden pohľad:
 *
 *   · cena podľa veľkosti kontextu — koľko sa platí pri volaniach nad 200k
 *   · vypršaná cache — volania, pri ktorých sa celý kontext zapisoval znova
 *   · podagenti — koľko z celku stoja oni
 *
 * a `--strop`: čo by stáli tie isté relácie, keby sa kompaktovalo skôr.
 *
 * ⚠️ Váhy cien sú pomerné (vstup 1, zápis do cache 1,25, čítanie 0,1,
 * výstup 5), nie doláre. Podiely a porovnania platia, absolútne sumy nie.
 *
 * ⚠️ `--strop` je simulácia nad tými istými volaniami, nie meranie. Nevie, že
 * model po kompakcii niečo znova číta — preto sa počíta aj s prirážkou na
 * doplnené čítanie — ani to, či by súhrn kompakcie stratil fakt, ktorý by
 * potom chýbal. Hovorí, koľko je na stole, nie koľko sa naozaj ušetrí.
 *
 *   node memex/scripts/kontext.mjs            prehľad
 *   node memex/scripts/kontext.mjs --strop    + simulácia skoršej kompakcie
 *   node memex/scripts/kontext.mjs --kompakcie  + opätovné čítanie po kompakcii a využitie pamäte
 */
import { createReadStream, readdirSync, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, relative } from 'node:path';
import { kde } from './kde.mjs';

const CESTY = kde();
const ZDROJ = process.env.MEMEX_TRANSCRIPTS || CESTY.zdroj.cesta;
const STROP = process.argv.includes('--strop');
const W = { in: 1, cw: 1.25, cr: 0.1, out: 5 };

if (!ZDROJ || !existsSync(ZDROJ)) {
  console.error(`Prepisy tohto projektu sa nenašli (${join(CESTY.zdroj.zaklad, CESTY.zdroj.kluc)}).`);
  process.exit(1);
}

/** Hlavné relácie aj podagenti — tí ležia v `<relácia>/subagents/`. */
function subory() {
  const out = [];
  for (const f of readdirSync(ZDROJ)) {
    const p = join(ZDROJ, f);
    if (f.endsWith('.jsonl')) out.push({ p, sub: false });
    else if (existsSync(join(p, 'subagents')) && statSync(p).isDirectory()) {
      for (const g of readdirSync(join(p, 'subagents'))) if (g.endsWith('.jsonl')) out.push({ p: join(p, 'subagents', g), sub: true });
    }
  }
  return out;
}

/*
  Jedno volanie API raz.

  Claude Code zapisuje jednu odpoveď ako viac riadkov s tým istým `usage` —
  tá istá pasca, ktorá v `stats.mjs` zdvojnásobila vstup. Kompakcia sa
  poznačí, aby simulácia vedela, kde kontext v skutočnosti klesol.
*/
async function volania(p) {
  const out = [];
  const videne = new Set();
  let hranica = false;
  const rl = createInterface({ input: createReadStream(p), crlfDelay: Infinity });
  for await (const l of rl) {
    if (l.includes('"compact_boundary"')) { hranica = true; continue; }
    if (!l.includes('"usage"')) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    const m = j.message;
    if (j.type !== 'assistant' || !m?.usage) continue;
    if (m.id && videne.has(m.id)) continue;
    if (m.id) videne.add(m.id);
    const u = m.usage;
    const x = { i: u.input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, o: u.output_tokens ?? 0, h: hranica };
    x.k = x.i + x.cr + x.cw;
    out.push(x);
    hranica = false;
  }
  return out;
}

const cena = (x) => x.i * W.in + x.cw * W.cw + x.cr * W.cr + x.o * W.out;
/*
  Vypršaná cache: väčšina kontextu sa zapisuje znova, hoci to nie je prvé
  volanie ani volanie po kompakcii. Hlavná relácia má cache hodinu len na
  predplatnom, inak päť minút; podagenti päť minút vždy.
*/
const vyprsala = (x) => x.k > 50e3 && x.cw > 0.5 * x.k && !x.h;

const HRANICE = [50e3, 100e3, 200e3, 400e3, 700e3, Infinity];
const NAZVY = ['<50k', '<100k', '<200k', '<400k', '<700k', '≥700k'];
const STROPY = [150e3, 200e3, 300e3, 500e3];
/*
  Koľko sa po kompakcii znova prečíta — tri predpoklady.

  Namerané (`--kompakcie`) na 67 kompakciách skutočného projektu: v prvých
  štyridsiatich nástrojoch po kompakcii je 43 % čítaní súbor, ktorý sa čítal
  už pred ňou, okolo 7,4 tisíca tokenov na kompakciu. Desať tisíc je teda to,
  čo sa stalo, so zaokrúhlením nahor; tridsať je rezerva pre prípad, že pri
  častejšej kompakcii bude agent čítať viac. Pri strope 200k to dáva 62 %
  dnešnej ceny, s rezervou 66 %.
*/
const PRERAZKY = [0, 10e3, 30e3];
const KOMPAKCIE = process.argv.includes('--kompakcie');

/**
 * Tie isté volania pri strope kontextu `C`.
 *
 * Kontext rastie o to, o čo rástol naozaj. Keď prekročí strop, kompakcia
 * prečíta celý kontext, napíše súhrn (10k výstupu) a kontext klesne na
 * základ + súhrn (15k) + `R` doplneného čítania. Kde cache v skutočnosti
 * vypršala, vyprší aj tu — zapíše sa celý vtedajší kontext.
 */
function simuluj(r, C, R) {
  const zaklad = Math.min(...r.slice(0, 3).map((x) => x.k));
  let sk = r[0].k, spolu = 0, predch = r[0].k;
  for (let n = 0; n < r.length; n++) {
    const x = r[n];
    const d = n === 0 || x.h ? 0 : Math.max(0, x.k - predch);
    predch = x.k;
    sk += d;
    if (sk > C) {
      spolu += sk * W.cr + 10e3 * W.out;
      sk = zaklad + 15e3 + R;
      spolu += sk * W.cw + x.o * W.out;
      continue;
    }
    if (x.h) sk = Math.min(sk, x.k);
    spolu += vyprsala(x) ? sk * W.cw + x.o * W.out : (sk - d) * W.cr + d * W.cw + x.o * W.out;
  }
  return spolu;
}

const zoznam = subory();
let spolu = 0, hlavne = 0, podagenti = 0, vyprsane = 0, pocet = 0, kontext = 0;
const podlaVelkosti = HRANICE.map(() => 0);
const sim = {};
for (const s of zoznam) {
  const r = await volania(s.p);
  if (!r.length) continue;
  for (const x of r) {
    const c = cena(x);
    spolu += c; pocet++; kontext += x.k;
    if (s.sub) podagenti += c; else hlavne += c;
    podlaVelkosti[HRANICE.findIndex((h) => x.k < h)] += c;
    if (vyprsala(x)) vyprsane += x.cw * W.cw;
  }
  if (STROP) for (const C of STROPY) PRERAZKY.forEach((R, i) => {
    const k = `${C / 1000}k`;
    sim[k] ??= PRERAZKY.map(() => 0);
    sim[k][i] += simuluj(r, C, R);
  });
}
if (!pocet) { console.log('Žiadne volania API v prepisoch.'); process.exit(0); }

const pc = (x) => `${((x / spolu) * 100).toFixed(1)} %`;
console.log(`${zoznam.length} prepisov, ${pocet} volaní API, priemerný kontext ${Math.round(kontext / pocet / 1000)}k tokenov.\n`);
console.log('Cena podľa veľkosti kontextu pri volaní:');
console.log('  ' + NAZVY.map((n, i) => `${n} ${pc(podlaVelkosti[i])}`).join(' · '));
console.log(`\nVypršaná cache (celý kontext zapísaný znova): ${pc(vyprsane)} ceny.`);
console.log(`Podagenti: ${pc(podagenti)} ceny, hlavné relácie ${pc(hlavne)}.`);
if (STROP) {
  console.log('\nKeby sa kompaktovalo pri strope — cena oproti skutočnosti, pri 0 / 10k / 30k doplneného čítania po kompakcii:');
  for (const [k, hodnoty] of Object.entries(sim)) {
    console.log(`  ${k.padEnd(6)}` + hodnoty.map((v) => `${((v / spolu) * 100).toFixed(0).padStart(4)} %`).join('  '));
  }
  console.log('\nSimulácia, nie meranie: nevie, čo by súhrn kompakcie stratil. Strop sa nastavuje');
  console.log('v Claude Code — nastavenie autoCompactWindow alebo príkaz /autocompact.');
}
console.log('\nVáhy sú pomerné (vstup 1, zápis 1,25, čítanie 0,1, výstup 5) — podiely platia, sumy nie.');

/*
  `--kompakcie` — čo kompakcia stojí v práci, nie v tokenoch súhrnu.

  Skoršia kompakcia je lacnejšia len vtedy, keď ju agent nezaplatí znova
  čítaním. Toto meria presne to: v prvých štyridsiatich volaniach nástrojov
  po každej kompakcii, koľko čítaní je súbor, ktorý sa čítal už pred ňou, a
  koľko je ich výstupu. A či sa po kompakcii siahlo do archívu — na to sú
  hooky `PreCompact` a `SessionStart` (compact), a toto je ich skúška.

  Druhá vec je využitie pamäte vôbec: koľkokrát sa zavolalo hľadanie, ako
  často agent potom naozaj otvoril vrátený prepis, a koľko sa do archívu
  siahlo priamo grepom alebo čítaním. Namerané na skutočnom projekte za dva a
  pol mesiaca: 27 volaní `search.mjs` proti tisícom priamych čítaní archívu.
*/
if (KOMPAKCIE) {
  const archivVKoreni = relative(CESTY.koren, CESTY.archive).replace(/\\/g, '/').toLowerCase();
  const doArchivu = (s) => s.replace(/\\/g, '/').toLowerCase().includes(archivVKoreni);
  const CESTA = /(?:[A-Za-z]:)?[\w./\\[\]-]*\.(?:tsx?|jsx?|mjs|cjs|json|md|css|sql|py|prisma|ya?ml|html|txt)\b/g;
  const citane = (name, input) => {
    if (name === 'Read') return [String(input?.file_path ?? '')];
    if (name !== 'Bash' && name !== 'PowerShell') return [];
    const p = String(input?.command ?? '');
    return /(^|[;&|]\s*)(cat|head|tail|sed -n)\b|\bGet-Content\b/.test(p) ? (p.match(CESTA) ?? []) : [];
  };
  const norm = (c) => c.replace(/\\/g, '/').toLowerCase();
  const K = { n: 0, citani: 0, znova: 0, znovaZnakov: 0, doArchivu: 0 };
  const P = { hladani: 0, otvorene: 0, priamo: 0 };
  for (const s of zoznam) {
    const nastroje = [], vysledky = new Map();
    const rl = createInterface({ input: createReadStream(s.p), crlfDelay: Infinity });
    for await (const l of rl) {
      if (l.includes('"compact_boundary"')) { nastroje.push({ kompakcia: true }); continue; }
      if (!l.includes('"tool_use"') && !l.includes('"tool_result"')) continue;
      let j; try { j = JSON.parse(l); } catch { continue; }
      for (const b of Array.isArray(j.message?.content) ? j.message.content : []) {
        if (b.type === 'tool_use') nastroje.push({ name: b.name, input: b.input, id: b.id });
        if (b.type === 'tool_result') vysledky.set(b.tool_use_id, typeof b.content === 'string' ? b.content.length : JSON.stringify(b.content ?? '').length);
      }
    }
    let predtym = new Set(), segment = new Set(), od = -1;
    nastroje.forEach((t, i) => {
      if (t.kompakcia) { if (!s.sub) { K.n++; predtym = segment; segment = new Set(); od = 0; } return; }
      const cmd = String(t.input?.command ?? '');
      const sub = citane(t.name, t.input).map(norm).filter(Boolean);
      const jeHladanie = /search\.mjs/.test(cmd) && !/--index|--osnova|--batch/.test(cmd);
      if (jeHladanie) {
        P.hladani++;
        if (nastroje.slice(i + 1, i + 7).some((x) => !x.kompakcia && citane(x.name, x.input).some(doArchivu))) P.otvorene++;
      } else if (sub.some(doArchivu) || (['Grep', 'Glob'].includes(t.name) && doArchivu(JSON.stringify(t.input ?? '')))) P.priamo++;
      if (!s.sub && od >= 0 && od < 40) {
        if (jeHladanie || sub.some(doArchivu)) K.doArchivu++;
        if (sub.length) {
          K.citani++;
          if (sub.some((x) => predtym.has(x))) { K.znova++; K.znovaZnakov += vysledky.get(t.id) ?? 0; }
        }
        od++;
      }
      for (const x of sub) segment.add(x);
    });
  }
  const p = (a, b) => `${((a / (b || 1)) * 100).toFixed(0)} %`;
  console.log(`\nKompakcie v hlavných reláciách: ${K.n}.`);
  if (K.n) {
    console.log(`  V prvých 40 nástrojoch po nich ${K.citani} čítaní, z toho ${K.znova} (${p(K.znova, K.citani)}) súbor čítaný už pred kompakciou —`);
    console.log(`  okolo ${(K.znovaZnakov / K.n / 2.6 / 1000).toFixed(1)}k tokenov na kompakciu. Do archívu sa po kompakcii siahlo ${K.doArchivu}-krát.`);
  }
  console.log(`Pamäť: search.mjs ${P.hladani}-krát, po ňom sa prepis otvoril v ${p(P.otvorene, P.hladani)}; priamo do archívu ${P.priamo}-krát.`);
}
