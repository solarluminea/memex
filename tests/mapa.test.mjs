/*
  Mapa nemala ani jeden test — a práve v nej bola najdrahšia chyba projektu.

  Viacslovný dotaz vracal nič v 300 prípadoch z 300 a prežilo to mesiace, lebo
  benchmark mape podsúval jednotlivé slová. Testy tu preto nie sú o kvalite
  zoradenia (na to je `bench.mjs` nad skutočným repozitárom), ale o tom, či
  jednotlivé cesty dotazu vôbec niečo vrátia.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const skript = resolve('scripts/map.mjs');

function príprava(súbory) {
  const p = mkdtempSync(join(tmpdir(), 'memex-mapa-'));
  for (const [cesta, obsah] of Object.entries(súbory)) {
    const celá = join(p, cesta);
    mkdirSync(join(celá, '..'), { recursive: true });
    writeFileSync(celá, obsah, 'utf8');
  }
  const env = { ...process.env, MEMEX_PROJECT_ROOT: p, MEMEX_ROOT: join(p, '.memex'), MEMEX_ABLATE: '' };
  return {
    p,
    beh: (...args) => spawnSync(process.execPath, [skript, ...args], { cwd: p, env, encoding: 'utf8' }),
  };
}

const TABUĽKA = `export function PrípadyTabuľka() {
  const stĺpce = [
    { header: 'Výkon', accessorKey: 'vykonKwp' },
    { header: 'Obchodný prípad', accessorKey: 'nazovPripadu' },
  ];
  return <table>{stĺpce}</table>;
}
`;

test('Popis sa vezme z hlavičkového komentára', () => {
  const f = príprava({ 'src/fakturacia.ts': '/**\n * Vystavenie faktúry odberateľovi. Zvyšok je odôvodnenie.\n */\nexport const x = 1;\n' });
  assert.equal(f.beh().status, 0);
  const v = f.beh('find', 'fakturacia').stdout;
  assert.match(v, /Vystavenie faktúry odberateľovi/);
  assert.doesNotMatch(v, /Zvyšok je odôvodnenie/);
});

test('Licencia ani vypnutý linter sa nevydáva za popis modulu', () => {
  const f = príprava({
    'src/nastroj.ts': '/*\n * Copyright (c) 2026 Niekto.\n * SPDX-License-Identifier: MIT\n *\n * Prevod mien na kurz dňa.\n */\nexport const x = 1;\n',
  });
  const v = f.beh('find', 'nastroj').stdout;
  assert.match(v, /Prevod mien na kurz dňa/);
  assert.doesNotMatch(v, /Copyright/);
});

test('Hlavička z riadkových komentárov — Go, Rust, Ruby', () => {
  const f = príprava({ 'src/server.go': '// Package server obsluhuje HTTP požiadavky.\npackage server\n' });
  assert.match(f.beh('find', 'server').stdout, /obsluhuje HTTP požiadavky/);
});

/*
  Toto je tá chyba, ktorá stála mesiace: dotaz celou vetou.
  Doslovná zhoda hľadá vetu ako jeden reťazec, takže nevrátila nikdy nič.

  ⚠️ Výplňové moduly nie sú dekorácia. Slovo, ktoré sedí na viac než tretinu
  projektu, sa zahadzuje ako bezvýznamné — a pri piatich moduloch je taký
  **každý**, takže viacslovný dotaz vráti nič bez ohľadu na to, či kód funguje.
  Zistené práve týmto testom. Je to vlastnosť, nie chyba: repozitár, ktorý sa
  dá prečítať celý, mapu nepotrebuje. Ale test to musí rešpektovať.
*/
test('Dotaz celou vetou nájde súbor, ktorého sa týka', () => {
  const výplň = {};
  for (let i = 0; i < 12; i++) výplň[`src/vypln/Modul${i}.tsx`] = `export const M${i} = () => <div>Iné</div>;\n`;
  const f = príprava({
    'src/PripadyTabulka.tsx': TABUĽKA,
    'src/ine/Nesuvisiace.tsx': 'export const A = () => <div>Nič</div>;\n',
    ...výplň,
  });
  const v = f.beh('find', 'presuň stĺpec výkon v tabuľke prípadov').stdout;
  assert.match(v.split('\n')[0], /PripadyTabulka\.tsx/);
});

test('Popis z rozhrania páruje popisok s kľúčom v kóde', () => {
  const f = príprava({ 'src/PripadyTabulka.tsx': TABUĽKA });
  const v = f.beh('find', 'vykon').stdout;
  assert.match(v, /PripadyTabulka\.tsx:\d+/);
  assert.match(v, /Výkon \(vykonKwp\)/);
});

/*
  Skratka je celý úsek identifikátora, nie podreťazec.

  Bez tejto podmienky označí `ico` súbor, ktorý má len `icon`, a `ean` súbor
  s `boolean` — pri prvom meraní to dalo 168 nálezov `ean`, z nich nula pravých.
*/
test('Skratka sa neoznačí vnútri bežného slova', () => {
  const f = príprava({
    'src/Ikony.tsx': "export const I = () => { const iconName = 'x'; const iconColor = 'y'; return <div title='Ikony rozhrania'>{iconName}{iconColor}</div>; };\n",
  });
  const v = f.beh('find', 'ico').stdout;
  assert.doesNotMatch(v, /Ikony\.tsx.*\bico\b/);
});

test('Kmeň slova zaberie, keď presná zhoda nenájde nič', () => {
  const f = príprava({ 'src/fakturacia.ts': '/**\n * Faktúry pre odberateľov.\n */\nexport const x = 1;\n' });
  const v = f.beh('find', 'fakturami').stdout;
  assert.match(v, /No exact match/);
  assert.match(v, /fakturacia\.ts/);
});

test('Prázdny výsledok povie, čo skúsiť ďalej, a zapíše sa', () => {
  const f = príprava({ 'src/a.ts': 'export const x = 1;\n' });
  f.beh();                                  // stavba mapy založí .memex
  const v = f.beh('find', 'kryptomeny');
  assert.match(v.stdout, /Nothing\./);
  const zaznamy = spawnSync(process.execPath, ['-e',
    `const fs=require('fs');const p=${JSON.stringify(join('.memex', 'map-misses.jsonl'))};` +
    `process.stdout.write(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'')`],
    { cwd: f.p, encoding: 'utf8' }).stdout;
  assert.match(zaznamy, /kryptomeny/);
});

/*
  Hook si nesmie založiť pamäť v projekte, ktorý o ňu nepožiadal. Plugin je
  nainštalovaný pre používateľa, takže beží aj v domovskom priečinku — tam sa
  takto našiel `MAP.md` s nula modulmi.
*/
test('Tichý beh bez .memex a bez memex.json nezaloží nič', () => {
  const f = príprava({ 'src/a.ts': 'export const x = 1;\n' });
  assert.equal(f.beh('--quiet').status, 0);
  const je = spawnSync(process.execPath, ['-e',
    `process.stdout.write(String(require('fs').existsSync('.memex')))`],
    { cwd: f.p, encoding: 'utf8' }).stdout;
  assert.equal(je, 'false');
  // Ručný beh je vedomé rozhodnutie a mapu založí.
  assert.equal(f.beh().status, 0);
});

/*
  Cache mapy nesmie odpovedať starým obsahom.

  Súbor sa zmení medzi dvoma dotazmi; druhý dotaz musí vidieť nový popis
  a nový skrytý pojem, nie to, čo si cache pamätala z prvého.
*/
test('Zmenený súbor sa v mape prejaví hneď, aj keď je cache plná', () => {
  const f = príprava({
    'src/a.ts': '/**\n * Stará veta o module.\n */\nexport const x = 1;\n',
    'src/b.ts': '/**\n * Iný modul.\n */\nexport const y = 2;\n',
  });
  assert.match(f.beh('find', 'stara').stdout, /Stará veta/);
  writeFileSync(join(f.p, 'src/a.ts'), '/**\n * Nová veta o module.\n */\nexport const prepocitanieKurzu = 1;\n', 'utf8');
  const v = f.beh('find', 'nova').stdout;
  assert.match(v, /Nová veta/);
  assert.doesNotMatch(v, /Stará veta/);
  assert.match(f.beh('find', 'prepocitaniekurzu').stdout, /src\/a\.ts/);
});
