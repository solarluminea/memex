import test from 'node:test';
import assert from 'node:assert/strict';
import { redakcia, failureLine, prvyArgument } from '../scripts/prevod.mjs';

// Kľúče sa skladajú až tu, aby ich kontrola tajomstiev v gite nebrala za skutočné.
const k = (...casti) => casti.join('');
const NAHODNE = 'aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY';

test('Známe tvary kľúčov sa zredigujú', () => {
  const pripady = [
    [k('sk-', 'proj-', NAHODNE, 'zz'), 'openai'],
    [k('sk-', NAHODNE, 'zzzz'), 'openai'],
    [k('sk-', 'ant-', 'api03-', NAHODNE), 'sk-ant'],
    [k('gh', 'p_', NAHODNE, 'zzzz'), 'github'],
    [k('github', '_pat_', NAHODNE, '_', NAHODNE), 'github'],
    [k('AS', 'IA', 'ABCDEFGHIJKLMNOP'), 'aws'],
    [k('AI', 'za', NAHODNE, 'abc'), 'google'],
    [k('sk', '_live_', NAHODNE), 'stripe'],
    [k('https://hooks.slack.com/services/', 'T000/B000/', NAHODNE), 'slack webhook'],
  ];
  for (const [kluc, meno] of pripady) {
    const t = redakcia(`kľúč: ${kluc} koniec`);
    assert.equal(t, `kľúč: [redacted:${meno}] koniec`, kluc.slice(0, 12));
  }
});

test('Kľúč za doslovným \\n z JSON-u sa zachytí tiež', () => {
  const t = redakcia(`{"out":"riadok\\n${k('gh', 'p_', NAHODNE)}"}`);
  assert.doesNotMatch(t, new RegExp(NAHODNE));
});

test('Heslo v adrese a tajná premenná prostredia', () => {
  assert.equal(redakcia('postgres://admin:Tajne123@db:5432/x'), 'postgres://admin:[redacted:password]@db:5432/x');
  assert.equal(redakcia('export DATABASE_PASSWORD=Tajne1234'), 'export DATABASE_PASSWORD=[redacted:env]');
  assert.equal(redakcia('OPENAI_API_KEY="abcdefgh12345"'), 'OPENAI_API_KEY="[redacted:env]"');
  assert.match(redakcia('authorization: bearer ' + NAHODNE), /\[redacted:bearer\]/);
});

test('Bežný text, hash commitu a krátke hodnoty zostanú', () => {
  for (const t of [
    'commit 01b4d51c9a2e8f7d3b6a5c4e1f0a9b8c7d6e5f4a',
    'TOKEN_LIMIT=500 a MAX_TOKENS=4096',
    'Overenie tokenu prebieha cez bearer schému.',
    'https://example.com/cesta?x=1',
    'Žiadosť o 6,99 % úver — skontrolované.',
    'process.env.MEMEX_MCP_TOKEN || randomBytes(18)',
    // Falošné poplachy nájdené nad skutočným archívom.
    'ONLYOFFICE_JWT_SECRET=…set…',
    'KROS_FIRMA_SECRET=nastavené',
    'grep "ONLYOFFICE_JWT_SECRET=.*…"',
    'SECRET_KEY=required',
  ]) assert.equal(redakcia(t), t);
});

test('Riadok zlyhania a prvý argument volania idú cez redakciu', () => {
  const chyba = failureLine(`Error: Command failed: curl -H "Authorization: Bearer ${NAHODNE}"`);
  assert.match(chyba, /\[redacted:bearer\]/);
  assert.doesNotMatch(chyba, new RegExp(NAHODNE));
  assert.equal(prvyArgument({ token: k('gh', 'p_', NAHODNE) }), ' token=[redacted:github]');
  assert.equal(prvyArgument({ scenarioId: 769715 }), ' scenarioId=769715');
});
