/*
  Prvá úroveň hľadania — témy.

  Meria sa tu tvar, nie kvalita: či sa kurátorská téma nájde, či je pred
  odvodenou, či odvodená vznikne aj bez stopy, a či rozsah ukazuje na niečo.
  Kvalitu meria `bench.mjs pamat` nad skutočným archívom.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const skript = resolve('scripts/search.mjs');

function príprava({ stopa = true } = {}) {
  const p = mkdtempSync(join(tmpdir(), 'memex-temy-'));
  const archív = join(p, '.memex/archive');
  const stopaDir = join(p, '.memex/trail');
  mkdirSync(archív, { recursive: true });
  mkdirSync(stopaDir, { recursive: true });

  const prepis = [
    '---', 'session: r1', 'project: skuska', 'date: 2026-09-01', '---', '',
    '# Session 2026-09-01', '',
    '## USER - 2026-09-01 10:00', '',
    'Prečo sa faktúry generujú dvakrát pri hromadnom odoslaní?', '',
    '## CLAUDE - 2026-09-01 10:01', '',
    '### Dvojité generovanie faktúr má na svedomí fronta', '',
    'Fronta spustí úlohu druhýkrát, keď prvý beh neodpovie do minúty.',
    'Riešenie je zámok na identifikátore dávky, nie predĺženie limitu.', '',
    ...Array.from({ length: 20 }, (_, i) => `Podrobnosť číslo ${i} o zámku a fronte.`),
    '', '## USER - 2026-09-01 10:30', '',
    'A čo kataster, dá sa z neho ťahať výmera automaticky?', '',
    '## CLAUDE - 2026-09-01 10:31', '', 'Dá, cez WFS službu.',
  ].join('\n');
  writeFileSync(join(archív, 'r1.md'), prepis, 'utf8');

  if (stopa) {
    writeFileSync(join(stopaDir, '2026-09-01-fronta.md'),
      '# 2026-09-01 · Zámok na dávke rieši dvojité generovanie faktúr\n\n' +
      'Kde to je:\n\n- [`r1.md` riadky 14–18](../archive/r1.md#L14-L18)\n', 'utf8');
  }

  const env = {
    ...process.env, MEMEX_PROJECT_ROOT: p,
    MEMEX_ARCHIVE: archív, MEMEX_TRAIL: stopaDir,
    MEMEX_INDEX: join(archív, '.search.db'),
    MEMEX_TRAIL_INDEX: join(p, '.memex/TRAIL.md'),
  };
  const beh = (...a) => spawnSync(process.execPath, [skript, ...a], { cwd: p, env, encoding: 'utf8' });
  beh('--index');
  return { p, archív, beh };
}

test('Kurátorská téma sa nájde a stojí pred odvodenými', () => {
  const f = príprava();
  const v = f.beh('dvojite generovanie faktur', '--n', '3').stdout;
  assert.match(v, /Trail topics/);
  assert.match(v, /Zámok na dávke/);
  assert.match(v, /r1\.md:14-18/);
  assert.ok(v.indexOf('Trail topics') < v.indexOf('Passages'), 'témy majú byť pred pasážami');
});

test('Odvodené témy vzniknú aj v projekte bez stopy', () => {
  const f = príprava({ stopa: false });
  const v = f.beh('kataster vymera', '--n', '3').stdout;
  assert.match(v, /derived from the transcripts/);
  assert.doesNotMatch(v, /Trail topics/);
});

/*
  Otázka používateľa je téma. Pokrytie hotovej stopy takto vyšlo 30,5 %
  a spolu s nadpismi Clauda 69,3 % — preto sú v indexe obe.
*/
test('Otázka používateľa aj nadpis odpovede sú samostatné témy', () => {
  const f = príprava({ stopa: false });
  const v = f.beh('kataster', '--n', '2').stdout;
  assert.match(v, /kataster/i);
  const n = f.beh('fronta zamok davka', '--n', '2').stdout;
  assert.match(n, /Dvojité generovanie|generovanie faktúr/);
});

test('Rozsah odvodenej témy nie je jeden riadok', () => {
  const f = príprava({ stopa: false });
  const v = f.beh('kataster', '--n', '2').stdout;
  const m = /r1\.md:(\d+)-(\d+)/.exec(v);
  assert.ok(m, 'téma má ukazovať rozsah');
  assert.ok(+m[2] - +m[1] >= 5, `rozsah je príliš úzky: ${m[0]}`);
});

test('Keď kurátorská téma nesedí, výpis navedie na celý rozcestník', () => {
  const f = príprava();
  spawnSync(process.execPath, [resolve('scripts/status.mjs'), '--trail'], {
    cwd: f.p, encoding: 'utf8',
    env: { ...process.env, MEMEX_PROJECT_ROOT: f.p, MEMEX_TRAIL: join(f.p, '.memex/trail'), MEMEX_TRAIL_INDEX: join(f.p, '.memex/TRAIL.md') },
  });
  const v = f.beh('kataster vymera wfs', '--n', '2').stdout;
  assert.doesNotMatch(v, /Trail topics/);
  assert.match(v, /read the whole trail index/);
});

/*
  Index staršej schémy sa musí prestavať, inak by prvá úroveň ticho chýbala
  a odpoveď by vyzerala úplne.
*/
test('Index bez tabuľky tém sa prestaví sám', () => {
  const f = príprava({ stopa: false });
  const cesta = join(f.archív, '.search.db');
  const maTemy = () => spawnSync(process.execPath, ['-e',
    `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(cesta)});` +
    `const r=d.prepare("SELECT count(*) c FROM sqlite_master WHERE name='temy'").get();d.close();process.stdout.write(String(r.c))`],
    { encoding: 'utf8' }).stdout;
  // Simulácia indexu spred tejto verzie: tabuľku tém zahodíme.
  const kod = `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(cesta)});d.exec('DROP TABLE temy');d.close()`;
  assert.equal(spawnSync(process.execPath, ['-e', kod], { encoding: 'utf8' }).status, 0);
  assert.equal(maTemy(), '0', 'príprava testu: tabuľka mala zmiznúť');
  const v = f.beh('kataster', '--n', '2');
  assert.match(v.stderr + v.stdout, /rebuilding it|derived from the transcripts/);
  // Prestavba nad tými istými dátami dá byte-identický súbor, takže sa
  // kontroluje schéma, nie veľkosť.
  assert.equal(maTemy(), '1', 'tabuľka tém sa mala vrátiť');
});
