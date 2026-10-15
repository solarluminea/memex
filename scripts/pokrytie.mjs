#!/usr/bin/env node
/**
 * Pokrytie archívu po RIADKOCH, nie po súboroch.
 *
 * Prečo to vzniklo (16. 10. 2026, ponuka-app). `status.mjs` rátal prepis za spracovaný, keď naň ukazoval
 * aspoň jeden záznam ukazovateľa. Jediný odkaz do prepisu so 114 000 riadkami (7990bd2f) tak stačil, aby sa
 * celý tváril hotový, a destilátor ho ďalej obchádzal. Diera sa objavila až vtedy, keď jeden beh porovnal
 * skutočné odkazy s dĺžkou prepisu — po dvoch mesiacoch.
 *
 * Pokrytý riadok = (a) zapísaný v zázname prečítaných úsekov `<trail>/.precitane.json` — destilátor ho tam
 * zapíše po každom prečítanom úseku, aj keď v ňom nič nenašiel, alebo (b) leží medzi dvoma odkazmi do toho
 * istého prepisu, ktoré sú od seba najviac `--medzera` riadkov (predvolene 400). Bod (b) je odhad pre úseky,
 * ktoré sa čítali predtým, než záznam prečítaného existoval: destilátor píše odkaz zhruba každých 100–300
 * riadkov, takže dlhý úsek bez odkazu je takmer isto neprečítaný.
 *
 *   node pokrytie.mjs [--archive A --trail-dir T]               súhrn: koľko riadkov je bez pokrytia, kde najviac
 *   node pokrytie.mjs --medzery [prepis.md] [--min 300]         zoznam neprečítaných úsekov „prepis od–do" (pre destilátor)
 *   node pokrytie.mjs --precitane prepis.md OD DO               zapíše prečítaný úsek (destilátor po každom úseku)
 *
 * Bez tokenov — je to skript, nie model. Na otázku „vynechalo sa niekde niečo?" odpovie za sekundy.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { kde, prepinac } from './kde.mjs';

const CESTY = kde();
const ARCHIVE = CESTY.archive;
const TRAIL = CESTY.trail;
const ZAZNAM = join(TRAIL, '.precitane.json');
const MEDZERA = Number(prepinac('medzera') ?? 400);
const MIN = Number(prepinac('min') ?? 300);
const argv = process.argv;

const citajZaznam = () => (existsSync(ZAZNAM) ? JSON.parse(readFileSync(ZAZNAM, 'utf8')) : {});

/** zlúči rozsahy [od, do] (vrátane), zoradené */
function zluc(r) {
  const s = r.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    if (out.length && a <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

if (argv.includes('--precitane')) {
  const i = argv.indexOf('--precitane');
  const subor = basename(argv[i + 1] ?? '');
  const od = Number(argv[i + 2]), doo = Number(argv[i + 3]);
  if (!subor.endsWith('.md') || !(od >= 1) || !(doo >= od)) {
    console.error('Použitie: --precitane <prepis.md> <od> <do>');
    process.exit(1);
  }
  if (!existsSync(join(ARCHIVE, subor))) {
    console.error(`Prepis ${subor} v archíve ${ARCHIVE} nie je.`);
    process.exit(1);
  }
  const z = citajZaznam();
  z[subor] = zluc([...(z[subor] ?? []), [od, doo]]);
  writeFileSync(ZAZNAM, JSON.stringify(z, null, 1) + '\n');
  const spolu = z[subor].reduce((a, [x, y]) => a + y - x + 1, 0);
  console.log(`${subor}: zapísané ${od}–${doo}; prečítaných riadkov spolu ${spolu}`);
  process.exit(0);
}

// odkazy z ukazovateľa: [text](cesta/prepis.md#L12-L34) alebo #L12
const odkazy = new Map();
if (existsSync(TRAIL)) {
  for (const f of readdirSync(TRAIL).filter((x) => x.endsWith('.md'))) {
    const t = readFileSync(join(TRAIL, f), 'utf8');
    for (const m of t.matchAll(/\]\(([^)#]+)#L(\d+)(?:-L(\d+))?\)/g)) {
      const p = basename(m[1]);
      odkazy.set(p, [...(odkazy.get(p) ?? []), [+m[2], +(m[3] ?? m[2])]]);
    }
  }
}
const zaznam = citajZaznam();
const prepisy = readdirSync(ARCHIVE).filter((x) => x.endsWith('.md') && !x.startsWith('.'));

const vysledky = [];
for (const f of prepisy) {
  const text = readFileSync(join(ARCHIVE, f), 'utf8');
  let riadkov = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) riadkov++;
  const o = zluc(odkazy.get(f) ?? []);
  // odhad z hustoty odkazov: susedné odkazy do MEDZERA riadkov → úsek medzi nimi sa čítal
  const odhad = [];
  for (let i = 0; i < o.length; i++) {
    odhad.push(o[i]);
    if (i + 1 < o.length && o[i + 1][0] - o[i][1] <= MEDZERA) odhad.push([o[i][1], o[i + 1][0]]);
  }
  const kryte = zluc([...odhad, ...(zaznam[f] ?? [])]).map(([a, b]) => [Math.max(1, a), Math.min(riadkov, b)]);
  const medzery = [];
  let pos = 1;
  for (const [a, b] of kryte) {
    if (a - pos >= MIN) medzery.push([pos, a - 1]);
    pos = Math.max(pos, b + 1);
  }
  if (riadkov - pos + 1 >= MIN) medzery.push([pos, riadkov]);
  const nekryte = medzery.reduce((s, [a, b]) => s + b - a + 1, 0);
  vysledky.push({ f, riadkov, nekryte, medzery, bezOdkazu: !o.length });
}

if (argv.includes('--medzery')) {
  const i = argv.indexOf('--medzery');
  const len = argv[i + 1] && argv[i + 1].endsWith('.md') ? basename(argv[i + 1]) : null;
  const zoz = vysledky.filter((v) => !len || v.f === len).flatMap((v) => v.medzery.map(([a, b]) => ({ f: v.f, a, b })));
  zoz.sort((x, y) => (y.b - y.a) - (x.b - x.a));
  for (const m of zoz) console.log(`${m.f} ${m.a}–${m.b} (${m.b - m.a + 1})`);
  process.exit(0);
}

const spolu = vysledky.reduce((a, v) => a + v.riadkov, 0);
const nekryte = vysledky.reduce((a, v) => a + v.nekryte, 0);
const zle = vysledky.filter((v) => v.nekryte > 0).sort((a, b) => b.nekryte - a.nekryte);
console.log(`Prepisov ${vysledky.length}, riadkov ${spolu.toLocaleString('sk-SK')}; bez pokrytia ${nekryte.toLocaleString('sk-SK')} (${((nekryte / Math.max(spolu, 1)) * 100).toFixed(1)} %)`);
console.log(`  pokrytie = záznam prečítaných úsekov (${Object.keys(zaznam).length} prepisov) + odkazy bližšie než ${MEDZERA} riadkov; diery pod ${MIN} riadkov sa nerátajú`);
console.log(`  prepisov s dierou: ${zle.length}, z toho úplne bez odkazu: ${zle.filter((v) => v.bezOdkazu).length}`);
for (const v of zle.slice(0, 15)) {
  console.log(`   ${v.f.padEnd(14)} ${String(v.nekryte).padStart(7)} z ${String(v.riadkov).padStart(7)} riadkov bez pokrytia (${v.medzery.length} dier)${v.bezOdkazu ? ' — bez jediného odkazu' : ''}`);
}
if (zle.length > 15) console.log(`   … a ďalších ${zle.length - 15}`);
if (zle.length) console.log('  Zoznam dier pre destilátor: node pokrytie.mjs --medzery');
process.exit(zle.length ? 1 : 0);
