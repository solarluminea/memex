import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/*
  Zvyšky prerušených stavieb indexu.

  Na skutočnom projekte ich bolo 165 MB, päťkrát viac než archív, a kontrola
  stavu o nich mlčala. Čerstvý súbor (bežiaca stavba) sa nesmie dotknúť.
*/
test('Kontrola stavu nahlási starý rozostavaný index a --oprav ho zmaže, čerstvý nechá', () => {
  const p = mkdtempSync(join(tmpdir(), 'memex-stav-'));
  const archiv = join(p, '.memex/archive');
  mkdirSync(archiv, { recursive: true });
  const stary = join(archiv, '.search.db.4242.stavia');
  const cerstvy = join(archiv, '.search.db.4343.stavia');
  writeFileSync(stary, 'x'.repeat(1000));
  writeFileSync(cerstvy, 'x');
  const pred = (Date.now() - 2 * 3600_000) / 1000;
  utimesSync(stary, pred, pred);
  const env = { ...process.env, MEMEX_PROJECT_ROOT: p, MEMEX_ARCHIVE: archiv, MEMEX_PROJECT: 'neexistuje', USERPROFILE: p, HOME: p };
  const beh = (...a) => spawnSync(process.execPath, [resolve('scripts/status.mjs'), ...a], { cwd: p, env, encoding: 'utf8' });

  const v = beh();
  assert.match(v.stdout, /1 leftover index build file/);
  beh('--oprav');
  assert.ok(!existsSync(stary), 'starý zvyšok mal zmiznúť');
  assert.ok(existsSync(cerstvy), 'čerstvý súbor môže patriť bežiacej stavbe');
});

/*
  Po kompakcii povie hook, kde je zvyšok relácie — a len keď naozaj je.
*/
test('Po kompakcii hook ukáže archív tejto relácie a ako v ňom hľadať', () => {
  const p = mkdtempSync(join(tmpdir(), 'memex-kompakcia-'));
  const archiv = join(p, '.memex/archive');
  mkdirSync(archiv, { recursive: true });
  writeFileSync(join(archiv, 'abc-123.md'), '---\nsession: abc-123\n---\n\nRiadok.\n');
  const env = { ...process.env, MEMEX_PROJECT_ROOT: p, MEMEX_ARCHIVE: archiv, MEMEX_PROJECT: 'neexistuje', USERPROFILE: p, HOME: p };
  const beh = (id) => spawnSync(process.execPath, [resolve('scripts/dobehni.mjs'), '--po-kompakcii'], {
    cwd: p, env, encoding: 'utf8', input: JSON.stringify({ session_id: id, source: 'compact' }),
  });
  const v = beh('abc-123');
  assert.equal(v.status, 0);
  assert.match(v.stdout, /\.memex\/archive\/abc-123\.md, lines 1-6/);
  assert.match(v.stdout, /search\.mjs" "<words>"/);
  assert.equal(beh('ina-relacia').stdout, '', 'relácia bez archívu nedostane nič');
});
