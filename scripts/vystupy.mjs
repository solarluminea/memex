/**
 * Čo stoja výstupy nástrojov — merané na surových transkriptoch.
 *
 * Tri režimy, tri otázky z PLAN-MERANIA-VYSTUPOV.md:
 *
 * `cena`     Koľko bajtov výstupu prišlo do kontextu, podľa nástroja a podľa
 *            sedenia. Súčet je zavádzajúci: zmena, ktorá nespraví nič v
 *            osemdesiatich sedeniach a ušetrí 40 % v štyroch, sa vyplatí.
 *            Preto sa vypisuje aj rozdelenie na sedenia, nie len súčet.
 *
 * `citanie`  Kandidát A. Koľko riadkov sa prečítalo a koľko sa z nich naozaj
 *            upravilo. Kľúč nikto pre tento test nepísal: `old_string` z
 *            nasledujúcej úpravy je odpoveď, výstup čítania je to, čo model
 *            mal k dispozícii. Či úprava ležala vnútri prečítaného, sa zistí
 *            hľadaním `old_string` priamo vo výstupe čítania — takže sa
 *            nemusí siahať na súbory, ktoré sa odvtedy zmenili.
 *
 * `make`     Kandidát B. Ktoré polia z výstupu Make sa v ďalších správach
 *            naozaj použili, a koľko z objemu tvoria polia, ktoré by súhrn
 *            zahodil. Pokrytie podľa výskytu v texte dostatočnosť
 *            NADHODNOCUJE — pole sa mohlo použiť bez toho, aby ho model
 *            odcitoval. Preto sa najväčšie prípady čítajú ručne.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { kde } from './kde.mjs';

const REZIM = process.argv[2] ?? 'cena';
/*
  Predvolene tento projekt, nie ten, na ktorom sa to kedysi meralo.

  Tu stál natvrdo kľúč súkromného projektu autora. Na cudzom stroji to znamená
  „Nenašiel som…" a na autorovom tichú zámenu: nástroj by meral iný projekt,
  než v ktorom stojíte, a čísla by vyzerali platne.
*/
const PROJEKT = process.argv[3] ?? kde().zdroj.kluc;
const KOREN = kde().zdroj.cesta && !process.argv[3]
  ? kde().zdroj.cesta
  : join(homedir(), '.claude', 'projects', PROJEKT);
const VELKY = Number(process.env.VYSTUPY_HRANICA ?? 5120);

if (!existsSync(KOREN)) {
  console.error(`Nenašiel som ${KOREN}`);
  console.error('Iný projekt: node scripts/vystupy.mjs <režim> <kľúč projektu v ~/.claude/projects>');
  process.exit(1);
}

const norm = (s) => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
const kB = (n) => (n / 1024).toFixed(0);
const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);

/** Prejde transkript a zavolá `navstev` na každý blok v poradí, s menom nástroja a vstupom. */
function prejdi(subor, navstev) {
  const ids = {};
  const inp = {};
  for (const line of readFileSync(subor, 'utf8').split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const c = j.message?.content;
    const rola = j.message?.role;
    if (typeof c === 'string') { navstev({ typ: 'text', rola, text: c }); continue; }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'tool_use') { ids[b.id] = b.name; inp[b.id] = b.input; }
      if (b.type === 'text') navstev({ typ: 'text', rola, text: b.text ?? '' });
      if (b.type === 'tool_result') {
        const obsah = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
        navstev({
          typ: 'vysledok',
          nastroj: ids[b.tool_use_id] ?? '?',
          vstup: inp[b.tool_use_id] ?? {},
          text: obsah,
          bajtov: Buffer.byteLength(obsah),
          obrazok: Array.isArray(b.content) && b.content.some((x) => x.type === 'image'),
        });
      }
    }
  }
}

const transkripty = readdirSync(KOREN).filter((f) => f.endsWith('.jsonl')).map((f) => join(KOREN, f));

/* ─────────────────────────── cena ─────────────────────────── */
if (REZIM === 'cena') {
  const podlaNastroja = {};
  const podlaSedenia = [];
  for (const t of transkripty) {
    let sum = 0;
    prejdi(t, (b) => {
      if (b.typ !== 'vysledok' || b.obrazok) return;
      const v = (podlaNastroja[b.nastroj] ??= { volani: 0, bajtov: 0, velkych: 0, velkeBajty: 0 });
      v.volani++; v.bajtov += b.bajtov;
      if (b.bajtov > VELKY) { v.velkych++; v.velkeBajty += b.bajtov; }
      sum += b.bajtov;
    });
    podlaSedenia.push(sum);
  }
  console.log(`${transkripty.length} transkriptov, hranica veľkého výstupu ${kB(VELKY)} kB\n`);
  console.log('nástroj'.padEnd(30) + 'volaní'.padStart(8) + 'kB'.padStart(9) + 'veľkých'.padStart(9) + 'kB v nich'.padStart(11));
  for (const [n, v] of Object.entries(podlaNastroja).sort((a, b) => b[1].bajtov - a[1].bajtov).slice(0, 14)) {
    console.log(n.slice(0, 29).padEnd(30) + String(v.volani).padStart(8) + kB(v.bajtov).padStart(9) + String(v.velkych).padStart(9) + kB(v.velkeBajty).padStart(11));
  }
  const s = podlaSedenia.slice().sort((a, b) => a - b);
  const sucet = s.reduce((a, b) => a + b, 0);
  console.log(`\ntextový výstup na sedenie: medián ${kB(median(s))} kB, priemer ${kB(sucet / s.length)} kB, max ${kB(s[s.length - 1])} kB`);
  console.log(`horných 10 % sedení nesie ${((s.slice(-Math.ceil(s.length / 10)).reduce((a, b) => a + b, 0) / sucet) * 100).toFixed(0)} % objemu`);
}

/* ─────────────────────────── citanie (kandidát A) ─────────────────────────── */
if (REZIM === 'citanie') {
  const pary = [];
  let bezUpravy = 0, bezUpravyBajtov = 0, mimo = 0;
  for (const t of transkripty) {
    const citania = [];
    prejdi(t, (b) => {
      if (b.typ !== 'vysledok') return;
      if (b.nastroj === 'Bash' && b.bajtov > VELKY) {
        let cmd = (b.vstup.command ?? '').replace(/^cd\s+("[^"]*"|\S+)\s*(&&|;)\s*/i, '').trim();
        if (/[|]/.test(cmd)) return;              // už rúrované — nepatrí do vzorky
        let subor = null;
        let m = cmd.match(/^sed\s+-n\s+['"]?(\d+),(\d+)p['"]?\s+['"]?([^'"\s]+)/);
        if (m) subor = m[3];
        else {
          m = cmd.match(/^cat\s+(?:-n\s+)?['"]?([^'"\s]+\.(?:ts|tsx|js|mjs|jsx|md|json|css|sql|py))['"]?\s*$/);
          if (m) subor = m[1];
        }
        if (!subor) return;
        citania.push({
          subor: subor.replace(/^\.\//, '').replace(/\\/g, '/'),
          vystup: norm(b.text),
          riadkov: b.text.split('\n').length,
          bajtov: b.bajtov,
          pouzite: false,
        });
      }
      if (b.nastroj === 'Edit' && b.vstup.old_string) {
        const os = norm(b.vstup.old_string);
        const zmen = b.vstup.old_string.split('\n').length;
        const cesta = (b.vstup.file_path ?? '').replace(/\\/g, '/');
        for (let i = citania.length - 1; i >= 0; i--) {
          const ct = citania[i];
          if (ct.pouzite || !cesta.endsWith(ct.subor)) continue;
          ct.pouzite = true;
          const vnutri = ct.vystup.includes(os);
          if (vnutri) pary.push({ riadkov: ct.riadkov, zmen, bajtov: ct.bajtov, pomer: ct.riadkov / Math.max(zmen, 1) });
          else mimo++;
          break;
        }
      }
    });
    for (const ct of citania) if (!ct.pouzite) { bezUpravy++; bezUpravyBajtov += ct.bajtov; }
  }
  const vnutri = pary.length;
  console.log(`veľké čítania kódu bez rúry: ${vnutri + mimo + bezUpravy}`);
  console.log(`  spárované s úpravou vnútri prečítaného: ${vnutri}`);
  console.log(`  úprava toho súboru bola mimo prečítaného: ${mimo}`);
  console.log(`  bez následnej úpravy toho súboru:        ${bezUpravy}  (${kB(bezUpravyBajtov)} kB)`);
  if (!vnutri) process.exit(0);
  const pomery = pary.map((p) => p.pomer).sort((a, b) => a - b);
  console.log(`\npre spárované (${vnutri}):`);
  console.log(`  prečítaných riadkov  medián ${median(pary.map((p) => p.riadkov))}`);
  console.log(`  upravených riadkov   medián ${median(pary.map((p) => p.zmen))}`);
  console.log(`  POMER prečítané:upravené  medián ${pomery[pomery.length >> 1].toFixed(1)}` +
    `, dolný kvartil ${pomery[pomery.length >> 2].toFixed(1)}` +
    `, horný kvartil ${pomery[Math.floor(pomery.length * 0.75)].toFixed(1)}`);
  const podiel = (mimo / (vnutri + mimo)) * 100;
  console.log(`\nspúšťač: medián pomeru nad 10 → ${pomery[pomery.length >> 1] > 10 ? 'SPLNENÉ' : 'nesplnené'}` +
    `; úpravy mimo rozsahu pod 10 % → ${podiel.toFixed(0)} % ${podiel < 10 ? 'SPLNENÉ' : 'NESPLNENÉ'}`);
}

/* ─────────────────────────── make (kandidát B) ─────────────────────────── */
if (REZIM === 'make') {
  /*
    Účtovanie podľa názvov polí sa neosvedčilo a nie je tu.

    Prvá verzia sčítavala bajty pod každým názvom poľa a vyšlo, že súhrn
    zahodí 20 % objemu. Bola to nepravda: `blueprint` obsahuje `flow`, ten
    obsahuje `mapper`, takže tie isté bajty sa počítali na každej úrovni.

    Preto sa súhrn nezhaduje, ale postaví a zváži. Úspora je rozdiel dvoch
    veľkostí, dostatočnosť je podiel vecí, ktoré model po výstupe spomenul a
    ktoré v súhrne zostali.
  */
  /** Súhrn: jeden riadok na modul — poradie, typ, názov. Nič viac. */
  function suhrn(uzol, out = [], hlbka = 0) {
    if (Array.isArray(uzol)) { for (const x of uzol) suhrn(x, out, hlbka); return out; }
    if (uzol && typeof uzol === 'object') {
      if (uzol.module) {
        const meno = uzol.metadata?.designer?.name ?? uzol.label ?? uzol.name ?? '';
        out.push(`${'  '.repeat(hlbka)}${uzol.id ?? '?'} ${uzol.module}${meno ? ' — ' + meno : ''}`);
      } else if (uzol.name !== undefined && uzol.id !== undefined) {
        out.push(`${uzol.id} ${uzol.name} ${uzol.isActive ?? uzol.status ?? ''}`);
      }
      for (const [k, v] of Object.entries(uzol)) {
        if (v && typeof v === 'object') suhrn(v, out, k === 'routes' || k === 'flow' ? hlbka + 1 : hlbka);
      }
    }
    return out;
  }
  const pripady = [];
  for (const t of transkripty) {
    const cakajuce = [];
    prejdi(t, (b) => {
      if (b.typ === 'text' && b.rola === 'assistant') {
        for (const c of cakajuce) if (c.sprav < 3) { c.text += '\n' + b.text; c.sprav++; }
        return;
      }
      if (b.typ !== 'vysledok') return;
      if (!/^mcp__claude_ai_Make__/.test(b.nastroj) || b.bajtov <= VELKY) return;
      // Výsledok z MCP prichádza zabalený: [{type:'text', text:'<json>'}].
      // Bez rozbalenia by sa merali polia obálky, nie odpovede.
      let j = null;
      const rozbal = (s) => {
        let v = null;
        try { v = JSON.parse(s); } catch {
          const m = s.match(/[[{][\s\S]*[\]}]/);
          if (m) try { v = JSON.parse(m[0]); } catch { return null; }
        }
        if (Array.isArray(v) && v.length && v.every((x) => x && x.type === 'text' && typeof x.text === 'string')) {
          return rozbal(v.map((x) => x.text).join('\n'));
        }
        return v;
      };
      j = rozbal(b.text);
      const riadky = j ? suhrn(j) : [];
      const p = {
        nastroj: b.nastroj.replace('mcp__claude_ai_Make__', ''),
        bajtov: b.bajtov, raw: b.text,
        suhrn: riadky.join('\n'), suhrnBajtov: Buffer.byteLength(riadky.join('\n')),
        text: '', sprav: 0,
      };
      pripady.push(p); cakajuce.push(p);
      if (cakajuce.length > 4) cakajuce.shift();
    });
  }
  console.log(`veľkých výstupov z Make: ${pripady.length}, spolu ${kB(pripady.reduce((a, p) => a + p.bajtov, 0))} kB\n`);
  const podla = {};
  for (const p of pripady) (podla[p.nastroj] ??= []).push(p);
  console.log('nástroj'.padEnd(24) + 'volaní'.padStart(7) + 'kB pôv.'.padStart(9) + 'kB súhrn'.padStart(10) + 'úspora'.padStart(8) + 'pokrytie'.padStart(10));
  for (const [k, arr] of Object.entries(podla).sort((a, b) => b[1].reduce((x, p) => x + p.bajtov, 0) - a[1].reduce((x, p) => x + p.bajtov, 0))) {
    let vSuhrne = 0, stratene = 0;
    const ukazky = [];
    for (const p of arr) {
      if (!p.text.trim()) continue;
      // Berú sa len dosť dlhé identifikátory a čísla, nie bežné slová — a len tie,
      // ktoré v pôvodnom výstupe naozaj boli, inak ich model nebral odtiaľ.
      for (const tk of new Set(p.text.match(/[A-Za-z0-9_.:-]{6,}/g) ?? [])) {
        if (!p.raw.includes(tk)) continue;
        if (p.suhrn.includes(tk)) vSuhrne++;
        else { stratene++; if (ukazky.length < 4) ukazky.push(tk); }
      }
    }
    const b = arr.reduce((x, p) => x + p.bajtov, 0);
    const sb = arr.reduce((x, p) => x + p.suhrnBajtov, 0);
    const spolu = vSuhrne + stratene;
    console.log(k.slice(0, 23).padEnd(24) + String(arr.length).padStart(7) + kB(b).padStart(9) + (sb / 1024).toFixed(1).padStart(10) +
      (((1 - sb / b) * 100).toFixed(0) + '%').padStart(8) +
      (spolu ? ((vSuhrne / spolu) * 100).toFixed(0) + '%' : '—').padStart(10) +
      (ukazky.length ? '  stratí: ' + ukazky.join(', ') : ''));
  }
  console.log('\nspúšťač: pokrytie aspoň 90 %. Pozor — pokrytie podľa výskytu v texte');
  console.log('dostatočnosť NADHODNOCUJE (pole sa mohlo použiť bez odcitovania) aj');
  console.log('podhodnocuje (slovo sa mohlo trafiť náhodou). Rozhodujú veľké prípady čítané ručne.');
}
