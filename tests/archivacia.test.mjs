import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const skript = resolve('scripts/archive.mjs');
const správa = (id, text) => ({ type: 'assistant', uuid: id, timestamp: '2026-09-06T10:00:00Z', message: { content: [{ type: 'text', text }] } });
function príprava(správy) {
  const p = mkdtempSync(join(tmpdir(), 'memex-test-'));
  const zdroj = join(p, '.claude/projects/skuska'); mkdirSync(zdroj, { recursive: true });
  const súbor = join(zdroj, 'relacia.jsonl');
  writeFileSync(súbor, správy.map(JSON.stringify).join('\n') + '\n');
  const cieľ = join(p, '.memex/archive/relacia.md');
  const stav = join(p, '.memex/archive/.state.json');
  const env = { ...process.env, USERPROFILE: p, HOME: p, MEMEX_PROJECT: 'skuska', MEMEX_PROJECT_ROOT: p, MEMEX_ARCHIVE: join(p, '.memex/archive') };
  const beh = () => spawnSync(process.execPath, [skript], { cwd: p, env, encoding: 'utf8' });
  return { p, súbor, cieľ, stav, beh, čítaj: () => readFileSync(cieľ, 'utf8'), pridaj: j => appendFileSync(súbor, JSON.stringify(j) + '\n') };
}

test('Opakovanie uuid nepridá druhú správu, iné uuid zachová', () => {
  const a = správa('a', 'Rozhodnutie.'); const f = príprava([a, a, správa('b', 'Rozhodnutie.')]);
  assert.equal(f.beh().status, 0); assert.equal((f.čítaj().match(/Rozhodnutie\./g) || []).length, 2);
  const pred = f.čítaj(); assert.equal(f.beh().status, 0); assert.equal(f.čítaj(), pred);
});
test('Stratený stav obnoví identity a pôvodné riadky zostanú', () => {
  const f = príprava([správa('a', '## Bežný nadpis\n\nFakt.')]); assert.equal(f.beh().status, 0);
  const pred = f.čítaj(); unlinkSync(f.stav); f.pridaj(správa('b', 'Ďalší fakt.'));
  assert.equal(f.beh().status, 0); assert.ok(f.čítaj().startsWith(pred)); assert.equal((f.čítaj().match(/Bežný nadpis/g) || []).length, 1);
});
test('Stav zaostávajúci za prepisom po prerušení nespôsobí duplicitu', () => {
  const f = príprava([správa('a', 'Prvý fakt.')]); f.beh(); const starý = readFileSync(f.stav);
  f.pridaj(správa('b', 'Druhý fakt.')); f.beh(); const pred = f.čítaj(); writeFileSync(f.stav, starý);
  assert.equal(f.beh().status, 0); assert.equal(f.čítaj(), pred);
});
test('Chýbajúci prepis sa obnoví aj pri zachovanom stave', () => {
  const f = príprava([správa('a', 'Zachované rozhodnutie.')]); f.beh(); const pred = f.čítaj(); unlinkSync(f.cieľ);
  assert.equal(f.beh().status, 0); assert.equal(f.čítaj(), pred);
});
test('Nedokončený riadok sa potvrdí až po úspešnom čítaní', () => {
  const f = príprava([správa('a', 'Prvý fakt.')]); const ďalší = JSON.stringify(správa('b', 'Druhý fakt.'));
  appendFileSync(f.súbor, ďalší.slice(0, 25)); assert.equal(f.beh().status, 1);
  appendFileSync(f.súbor, ďalší.slice(25) + '\n'); assert.equal(f.beh().status, 0); assert.ok(f.čítaj().includes('Druhý fakt.'));
});
test('Starý prepis bez značiek sa overí obsahom a neskráti', () => {
  const f = príprava([správa('a', '## Dôvod\n\nPrvý fakt.')]); f.beh();
  const starý = f.čítaj().replace(/ <!-- memex:[a-f0-9]{24,64} -->/g, ''); writeFileSync(f.cieľ, starý); unlinkSync(f.stav);
  f.pridaj(správa('b', 'Nový fakt.')); assert.equal(f.beh().status, 0); assert.ok(f.čítaj().startsWith(starý));
});
test('Skrátený zdroj nezmaže zachovaný archív ani nezresetuje stav', () => {
  const f = príprava([správa('a', 'Prvý fakt.'), správa('b', 'Druhý fakt.')]); f.beh(); const pred = f.čítaj(), stav = readFileSync(f.stav, 'utf8');
  writeFileSync(f.súbor, JSON.stringify(správa('a', 'Prvý fakt.')) + '\n');
  assert.equal(f.beh().status, 1); assert.equal(f.čítaj(), pred); assert.equal(readFileSync(f.stav, 'utf8'), stav);
});
test('Zámok živého procesu bráni druhému zapisovateľovi', () => {
  const f = príprava([správa('a', 'Fakt.')]); f.beh(); const pred = f.čítaj();
  const zámok = join(f.p, '.memex/archive/.archive.lock'); writeFileSync(zámok, JSON.stringify({ pid: process.pid, token: 'test' }));
  f.pridaj(správa('b', 'Nový fakt.')); assert.equal(f.beh().status, 1); assert.equal(f.čítaj(), pred);
  unlinkSync(zámok); assert.equal(f.beh().status, 0); assert.ok(f.čítaj().includes('Nový fakt.'));
});
test('Opakovanie starej udalosti po migrácii nezväčší prepis', () => {
  const a = správa('a', 'Pôvodný fakt.'); const f = príprava([a]); f.beh();
  const starý = f.čítaj().replace(/ <!-- memex:[a-f0-9]{24,64} -->/g, ''); writeFileSync(f.cieľ, starý);
  writeFileSync(f.stav, JSON.stringify({ relacia: { lines: 1, day: '2026-09-06' } }));
  f.pridaj(a); assert.equal(f.beh().status, 0); assert.equal(f.čítaj(), starý);
});
/*
  Prevodník sa medzi verziami hýbe a prepis to nesmie zamknúť.

  Presne toto sa stalo: 0.19.0 orezávala koniec bloku volaní, refaktor to
  stratil, a jediný príkaz Basha useknutý na konci riadku stačil na to, aby sa
  po strate stavu prepis prestal aktualizovať — navždy, lebo zastavený beh
  o relácii do stavu nič nezapísal.
*/
test('Rozdiel v bielych znakoch nezamkne prepis a nezdvojí ťah', () => {
  const f = príprava([správa('a', 'Prvý fakt.'), správa('b', 'Druhý fakt.')]); f.beh();
  const starý = f.čítaj().replace(/ <!-- memex:[a-f0-9]{24,64} -->/g, '').replace('Prvý fakt.', 'Prvý  fakt.');
  writeFileSync(f.cieľ, starý); unlinkSync(f.stav);
  f.pridaj(správa('c', 'Tretí fakt.'));
  assert.equal(f.beh().status, 0);
  assert.ok(f.čítaj().startsWith(starý));
  assert.equal((f.čítaj().match(/fakt\./g) || []).length, 3);
  const pred = f.čítaj(); assert.equal(f.beh().status, 0); assert.equal(f.čítaj(), pred);
});
test('Ťah, ktorý zdroj už nemá, sa hlási, ale prepis nezamkne', () => {
  const f = príprava([správa('a', 'Prvý fakt.')]); f.beh();
  const starý = f.čítaj().replace(/ <!-- memex:[a-f0-9]{24,64} -->/g, '') +
    '\n\n## CLAUDE - 2026-09-06 10:01\n\nStratený fakt.\n';
  writeFileSync(f.cieľ, starý); unlinkSync(f.stav);
  const prvý = f.beh();
  assert.equal(prvý.status, 1); assert.match(prvý.stderr, /nenašlo/);
  assert.ok(f.čítaj().includes('Stratený fakt.'));
  // Podstatné je toto: ďalší beh už na tú istú nezhodu nenarazí.
  f.pridaj(správa('b', 'Nový fakt.'));
  assert.equal(f.beh().status, 0); assert.ok(f.čítaj().includes('Nový fakt.'));
});
/*
  Bez tejto poistky obnova podľa obsahu ťah zdvojí: cudzí ťah `hlavička`
  nezachytí, prilepí sa k predošlému memexovému záznamu, ten prestane sedieť
  so zdrojom — a pôvodný ťah sa pripíše druhýkrát.
*/
test('Prepis s ťahmi iného archivára sa nemení', () => {
  const f = príprava([správa('a', 'Prvý fakt.')]); f.beh();
  const sCudzím = f.čítaj().replace(/ <!-- memex:[a-f0-9]{24,64} -->/g, '') +
    '\n\n## TY · 6.9.2026 10:00\n\nPoznámka iného nástroja.\n';
  writeFileSync(f.cieľ, sCudzím); unlinkSync(f.stav);
  f.pridaj(správa('b', 'Nový fakt.'));
  const v = f.beh();
  assert.equal(v.status, 1); assert.match(v.stderr, /iného archivára/);
  assert.equal(f.čítaj(), sCudzím);
});
test('Zámok ukončeného procesu sa bezpečne obnoví', () => {
  const f = príprava([správa('a', 'Prvý fakt.')]); f.beh();
  const ukončený = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  writeFileSync(join(f.p, '.memex/archive/.archive.lock'), JSON.stringify({ pid: ukončený.pid, token: 'ukončený' }));
  f.pridaj(správa('b', 'Nový fakt.')); assert.equal(f.beh().status, 0); assert.ok(f.čítaj().includes('Nový fakt.'));
});
