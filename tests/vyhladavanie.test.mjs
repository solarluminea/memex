import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
test('Rovnaký celý úsek sa vráti len raz', () => {
  const f = príprava(); for (const n of ['a', 'b']) writeFileSync(join(f.archív, n + '.md'), 'Totožné rozhodnutie.'); f.beh(['--index']);
  assert.equal((f.beh(['rozhodnutie']).stdout.match(/\.md:\d+-\d+/g) || []).length, 1);
});
