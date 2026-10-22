import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function príprava() {
  const p = mkdtempSync(join(tmpdir(), 'memex-hladanie-'));
  const archív = join(p, '.memex/archive'); mkdirSync(archív, { recursive: true });
  const beh = args => spawnSync(process.execPath, [resolve('scripts/search.mjs'), ...args], { cwd: p, encoding: 'utf8', env: { ...process.env, MEMEX_PROJECT_ROOT: p, MEMEX_ARCHIVE: archív, MEMEX_INDEX: join(archív, '.search.db') } });
  return { p, archív, beh };
}
test('Prestavba nahradí existujúci index a nájde aj nové správy', () => {
  const f = príprava(); writeFileSync(join(f.archív, 'a.md'), 'Pôvodná žiadosť.');
  assert.equal(f.beh(['--index']).status, 0); writeFileSync(join(f.archív, 'b.md'), 'Rozhodnutie druhého kola.');
  assert.equal(f.beh(['--index']).status, 0); assert.match(f.beh(['rozhodnutie']).stdout, /b\.md:/);
});
test('Neúspešná prestavba ponechá predošlý index neporušený', () => {
  const f = príprava(); writeFileSync(join(f.archív, 'a.md'), 'Platná žiadosť.'); f.beh(['--index']);
  const pred = readFileSync(join(f.archív, '.search.db')); mkdirSync(join(f.archív, 'necitaj.md'));
  assert.notEqual(f.beh(['--index']).status, 0); assert.deepEqual(readFileSync(join(f.archív, '.search.db')), pred);
  assert.match(f.beh(['ziadost']).stdout, /a\.md:/);
});
test('Zhoda prvých 300 znakov nevymaže rozdielny fakt', () => {
  const f = príprava(); const úvod = 'Opis rozhodnutia. '.repeat(30);
  writeFileSync(join(f.archív, 'a.md'), úvod + 'Limit je 15.'); writeFileSync(join(f.archív, 'b.md'), úvod + 'Limit je 42.'); f.beh(['--index']);
  const výsledok = f.beh(['limit']).stdout; assert.match(výsledok, /a\.md:/); assert.match(výsledok, /b\.md:/);
});
test('Značka udalosti sa neindexuje ani nevypisuje', () => {
  const f = príprava();
  writeFileSync(join(f.archív, 'a.md'),
    '## CLAUDE - 2026-09-06 10:00 <!-- memex:34be00cce225a4f5e52e6bd4 -->\n\nRozhodnutie o limite.\n');
  f.beh(['--index']);
  const výsledok = f.beh(['rozhodnutie']).stdout;
  assert.match(výsledok, /a\.md:/);
  assert.doesNotMatch(výsledok, /memex:[a-f0-9]/);
});
/*
  Prerušená stavba nechávala súbor ležať navždy: ďalší beh mal iné PID, takže
  naň nesiahol. Namerané na skutočnom projekte po dvoch dňoch — 11 súborov,
  254 MB, teda pätnásťkrát viac než samotný index, a ticho.
*/
test('Rozostavaný index po cudzom behu sa uprace', () => {
  const f = príprava();
  writeFileSync(join(f.archív, 'a.md'), 'Rozhodnutie o limite.');
  f.beh(['--index']);
  const zvysok = join(f.archív, '.search.db.99999.stavia');
  const cerstvy = join(f.archív, '.search.db.99998.stavia');
  writeFileSync(zvysok, 'x'.repeat(1000));
  writeFileSync(cerstvy, 'x'.repeat(1000));
  // Starý zvyšok je z prerušeného behu, čerstvý môže patriť bežiacej stavbe.
  const davno = new Date(Date.now() - 7200_000);
  utimesSync(zvysok, davno, davno);
  assert.equal(f.beh(['--index']).status, 0);
  assert.ok(!existsSync(zvysok), 'starý rozostavaný index mal zmiznúť');
  assert.ok(existsSync(cerstvy), 'čerstvý sa mazať nesmie — môže ho práve písať iný proces');
});

test('Rovnaký celý úsek sa vráti len raz', () => {
  const f = príprava(); for (const n of ['a', 'b']) writeFileSync(join(f.archív, n + '.md'), 'Totožné rozhodnutie.'); f.beh(['--index']);
  assert.equal((f.beh(['rozhodnutie']).stdout.match(/\.md:\d+-\d+/g) || []).length, 1);
});

/*
  Prírastkový index musí dať to isté, čo stavba od nuly.

  Zmenený prepis sa preindexuje, zmazaný zmizne, nový záznam stopy pribudne
  a skrytý text témy sa obnoví, keď sa zmení prepis, do ktorého ukazuje.
  Porovnáva sa výstup hľadania, nie súbor — poradie riadkov v tabuľkách sa
  líšiť smie, odpoveď nie.
*/
test('Prírastkový index odpovedá rovnako ako stavba od nuly', () => {
  const f = príprava();
  const stopa = join(f.p, '.memex/trail'); mkdirSync(stopa, { recursive: true });
  const env = { MEMEX_TRAIL: stopa, MEMEX_TRAIL_INDEX: join(f.p, '.memex/TRAIL.md') };
  const beh = (args) => spawnSync(process.execPath, [resolve('scripts/search.mjs'), ...args], {
    cwd: f.p, encoding: 'utf8',
    env: { ...process.env, MEMEX_PROJECT_ROOT: f.p, MEMEX_ARCHIVE: f.archív, MEMEX_INDEX: join(f.archív, '.search.db'), ...env },
  });
  writeFileSync(join(f.archív, 'a.md'), '---\ndate: 2026-09-01\n---\n\nPrvý odsek o faktúrach.\n\nDruhý odsek o katastri.\n');
  writeFileSync(join(f.archív, 'b.md'), 'Zmazaný prepis o rozpočte.\n');
  assert.equal(beh(['--index']).status, 0);
  assert.match(beh(['--index']).stdout, /up to date/);

  writeFileSync(join(f.archív, 'a.md'), '---\ndate: 2026-09-01\n---\n\nPrvý odsek o faktúrach.\n\nDruhý odsek o katastri.\n\nTretí odsek: limit dávky je 15.\n');
  writeFileSync(join(f.archív, 'c.md'), 'Nový prepis o vikendovej údržbe.\n');
  spawnSync(process.execPath, ['-e', `require('fs').rmSync(${JSON.stringify(join(f.archív, 'b.md'))})`]);
  writeFileSync(join(stopa, '2026-09-01-limit.md'), '# 2026-09-01 · Rozhodnutie o veľkosti dávky\n\n- [a](../archive/a.md#L9-L9)\n');
  const v = beh(['--index']);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /2 transcript\(s\) re-indexed/);

  const otazky = ['faktúrach', 'rozpočte', 'limit dávky', 'vikendovej', 'katastri'];
  const pred = otazky.map((q) => beh([q]).stdout);
  assert.equal(beh(['--index', '--full']).status, 0);
  const po = otazky.map((q) => beh([q]).stdout);
  assert.deepEqual(pred, po);
  assert.doesNotMatch(pred[1], /b\.md/);
  // Téma sa nájde slovom, ktoré je len v jej rozsahu.
  assert.match(beh(['limit 15']).stdout, /Trail topics[\s\S]*veľkosti dávky/);
});

/*
  Dopísaný prepis sa indexuje od posledného úseku, prepísaný celý.
  Oboje musí dať tú istú odpoveď ako stavba od nuly.
*/
test('Dopísaný aj prepísaný prepis dá tú istú odpoveď ako stavba od nuly', () => {
  const f = príprava();
  const odsek = (i) => `Odsek ${i}: ${'rozhodnutie o limite '.repeat(30)}\n\n`;
  let text = Array.from({ length: 6 }, (_, i) => odsek(i)).join('');
  writeFileSync(join(f.archív, 'a.md'), text);
  assert.equal(f.beh(['--index']).status, 0);
  text += 'Dopísaný odsek o vikiere a meradle.\n\n' + odsek(7);
  writeFileSync(join(f.archív, 'a.md'), text);
  assert.equal(f.beh(['--index']).status, 0);
  const otazky = ['vikiere meradle', 'odsek 7', 'odsek 3 limite'];
  const dopisane = otazky.map((q) => f.beh([q]).stdout);
  assert.match(dopisane[0], /a\.md:/);
  assert.equal(f.beh(['--index', '--full']).status, 0);
  assert.deepEqual(otazky.map((q) => f.beh([q]).stdout), dopisane);
  // Prepísaný začiatok: odtlačok nesedí, súbor sa preindexuje celý.
  writeFileSync(join(f.archív, 'a.md'), 'Celkom iný začiatok o katastri.\n\n' + text.slice(200));
  assert.equal(f.beh(['--index']).status, 0);
  const prepisane = ['katastri', ...otazky].map((q) => f.beh([q]).stdout);
  assert.equal(f.beh(['--index', '--full']).status, 0);
  assert.deepEqual(['katastri', ...otazky].map((q) => f.beh([q]).stdout), prepisane);
  assert.match(prepisane[0], /a\.md:1-/);
});
