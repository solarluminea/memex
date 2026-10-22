import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { normalizujCestu, patriProjektu, bezVlozenych, suhrnVolania, prevedCodex } from '../scripts/codex.mjs';

const riadok = (type, payload, ts = '2026-10-20T10:00:00.000Z') => JSON.stringify({ timestamp: ts, type, payload });

function rollout(cwd, id, extra = []) {
  return [
    riadok('session_meta', { id, session_id: id, cwd, originator: 'Codex Desktop' }),
    riadok('event_msg', { type: 'task_started', turn_id: 't1' }),
    riadok('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'pokyny' }] }),
    riadok('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>x</cwd>\n</environment_context>' }] }),
    riadok('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Prečo je limit 15 žiadostí?' }] }),
    riadok('event_msg', { type: 'user_message', message: 'Prečo je limit 15 žiadostí?' }),
    riadok('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Limit 15 sme zvolili kvôli API.' }] }),
    ...extra,
  ].join('\n') + '\n';
}

function priprava() {
  const p = mkdtempSync(join(tmpdir(), 'memex-codex-'));
  const projekt = join(p, 'projekt'); mkdirSync(projekt);
  const archiv = join(projekt, '.memex/archive');
  const relacie = join(p, 'sessions/2026/10/20'); mkdirSync(relacie, { recursive: true });
  const env = { ...process.env, MEMEX_PROJECT_ROOT: projekt, MEMEX_CODEX_SESSIONS: join(p, 'sessions'), MEMEX_ARCHIVE: archiv, MEMEX_INDEX: join(archiv, '.search.db') };
  const beh = (skript, args = [], input) => spawnSync(process.execPath, [resolve('scripts', skript), ...args], { cwd: projekt, encoding: 'utf8', env, input });
  return { p, projekt, archiv, relacie, env, beh };
}

test('Cesty Codexu sa porovnajú bez ohľadu na tvar zápisu', () => {
  assert.equal(normalizujCestu('file:///C:/Users/Ja/Projekt'), normalizujCestu('c:\\Users\\ja\\projekt\\'));
  assert.ok(patriProjektu('C:\\Users\\ja\\projekt\\src', 'C:/Users/ja/projekt'));
  assert.ok(!patriProjektu('C:\\Users\\ja\\projekt-2', 'C:/Users/ja/projekt'));
});

test('Vložené bloky kontextu sa odstránia, veta používateľa zostane', () => {
  assert.equal(bezVlozenych('<recommended_plugins>\n- a\n</recommended_plugins><environment_context>x</environment_context>'), '');
  assert.equal(bezVlozenych('<ide_opened_file>súbor</ide_opened_file> Oprav tlačidlo.'), 'Oprav tlačidlo.');
  assert.equal(bezVlozenych('<b>tučné</b> nie je blok kontextu? áno, ale zatvára sa'), 'nie je blok kontextu? áno, ale zatvára sa');
});

test('Volanie exec sa zhrnie podľa vnorených príkazov, kód sa nespúšťa', () => {
  const r = suhrnVolania({ type: 'custom_tool_call', name: 'exec', input: 'text(await tools.exec_command({cmd:"rg -n limit src"}));\nawait tools.apply_patch("*** Begin Patch\\n*** Update File: src/a.ts\\n*** End Patch")' });
  assert.deepEqual(r, ['[Tool: exec_command] rg -n limit src', '[Tool: apply_patch src/a.ts]']);
  assert.deepEqual(suhrnVolania({ type: 'function_call', name: 'shell', arguments: '{"command":["git","status"]}' }), ['[Tool: shell] git status']);
});

test('Tajomstvo v príkaze sa do archívu nezapíše', () => {
  const t = prevedCodex(JSON.parse(riadok('response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"' }) })), new Set());
  assert.match(t, /\[redacted:bearer\]/);
  assert.doesNotMatch(t, /abcdefghijklmnop/);
});

test('Archivuje len relácie tohto projektu, bez importov z Claude a bez zdvojenia', () => {
  const f = priprava();
  writeFileSync(join(f.relacie, 'rollout-a.jsonl'), rollout(`file:///${f.projekt.replace(/\\/g, '/')}`, 'aaa-1'));
  writeFileSync(join(f.relacie, 'rollout-b.jsonl'), rollout(join(f.p, 'iny'), 'bbb-2'));
  writeFileSync(join(f.relacie, 'rollout-c.jsonl'), rollout(f.projekt, 'ccc-3').replace('"turn_id":"t1"', '"turn_id":"external-import-turn-1"'));
  const r = f.beh('codex.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(f.archiv).filter((x) => x.endsWith('.md')), ['codex-aaa-1.md']);
  const md = readFileSync(join(f.archiv, 'codex-aaa-1.md'), 'utf8');
  assert.match(md, /## USER - 2026-10-20 10:00 <!-- memex:[a-f0-9]{24} -->\n\nPrečo je limit 15 žiadostí\?/);
  assert.match(md, /## CODEX - .*\n\nLimit 15 sme zvolili kvôli API\./);
  assert.doesNotMatch(md, /environment_context|pokyny/);
  assert.equal(md.match(/Prečo je limit/g).length, 1, 'event_msg nesmie správu zdvojiť');
  // Druhý beh nepripíše nič; prírastok sa pripíše raz.
  f.beh('codex.mjs');
  assert.equal(readFileSync(join(f.archiv, 'codex-aaa-1.md'), 'utf8'), md);
  writeFileSync(join(f.relacie, 'rollout-a.jsonl'), rollout(f.projekt, 'aaa-1', [riadok('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Doplnok.' }] })]));
  f.beh('codex.mjs');
  assert.equal(readFileSync(join(f.archiv, 'codex-aaa-1.md'), 'utf8').match(/Doplnok/g).length, 1);
});

test('Hook Stop archív nezakladá a nič nevypisuje', () => {
  const f = priprava();
  const cesta = join(f.relacie, 'rollout-a.jsonl');
  writeFileSync(cesta, rollout(f.projekt, 'aaa-1'));
  let r = f.beh('codex.mjs', ['--quiet'], JSON.stringify({ transcript_path: cesta }));
  assert.equal(r.status, 0); assert.ok(!existsSync(f.archiv));
  mkdirSync(f.archiv, { recursive: true });
  r = f.beh('codex.mjs', ['--quiet'], JSON.stringify({ transcript_path: cesta }));
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, '');
  assert.ok(existsSync(join(f.archiv, 'codex-aaa-1.md')));
});

function mcp(env, spravy) {
  return new Promise((res, rej) => {
    const ch = spawn(process.execPath, [resolve('scripts/mcp.mjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    const caka = spravy.filter((s) => s.id !== undefined).length;
    ch.stdout.on('data', (d) => {
      out += d;
      const hotove = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      if (hotove.length >= caka) { ch.kill(); res(Object.fromEntries(hotove.map((x) => [x.id, x]))); }
    });
    ch.on('error', rej);
    for (const s of spravy) ch.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...s }) + '\n');
    setTimeout(() => { ch.kill(); rej(new Error('MCP neodpovedal: ' + out)); }, 60000);
  });
}

test('MCP server: nástroje, hľadanie s dobehnutím indexu a čítanie len z archívu', async () => {
  const f = priprava();
  mkdirSync(f.archiv, { recursive: true });
  writeFileSync(join(f.relacie, 'rollout-a.jsonl'), rollout(f.projekt, 'aaa-1'));
  f.beh('codex.mjs');
  writeFileSync(join(f.projekt, 'tajne.txt'), 'nečítať');
  const r = await mcp(f.env, [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'memex_search', arguments: { query: 'ziadosti limit' } } },
    { id: 4, method: 'tools/call', params: { name: 'memex_read', arguments: { file: 'codex-aaa-1.md', from: 1, to: 12 } } },
    { id: 5, method: 'tools/call', params: { name: 'memex_read', arguments: { file: '../../tajne.txt' } } },
    { id: 6, method: 'nic' },
  ]);
  assert.equal(r[1].result.serverInfo.name, 'memex');
  assert.ok(r[2].result.tools.some((t) => t.name === 'memex_search'));
  assert.match(r[3].result.content[0].text, /codex-aaa-1\.md:\d+-\d+/);
  assert.match(r[4].result.content[0].text, /Prečo je limit 15/);
  assert.equal(r[5].result.isError, true);
  assert.doesNotMatch(r[5].result.content[0].text, /nečítať/);
  assert.equal(r[6].error.code, -32601);
});

/*
  Hranice čítania cez MCP. Každý prípad bol overený ako skutočná diera:
  `to: -1` obišlo limit štyristo riadkov, sieťová cesta otvorila spojenie von,
  otázka `--index` prestavala index a notifikácia `tools/call` sa vykonala.
*/
test('MCP server: rozsah čítania, sieťové cesty, otázka ako prepínač a notifikácie', async () => {
  const f = priprava();
  mkdirSync(f.archiv, { recursive: true });
  writeFileSync(join(f.archiv, 'dlhy.md'), Array.from({ length: 1000 }, (_, i) => `riadok ${i + 1}`).join('\n'));
  const r = await mcp(f.env, [
    { id: 1, method: 'tools/call', params: { name: 'memex_read', arguments: { file: 'dlhy.md', from: 1, to: -1 } } },
    { id: 2, method: 'tools/call', params: { name: 'memex_read', arguments: { file: String.raw`\\192.0.2.1\share\x.md` } } },
    { method: 'tools/call', params: { name: 'memex_read', arguments: { file: 'dlhy.md' } } },
    { id: 3, method: 'tools/call', params: { name: 'memex_search', arguments: { query: '--index' } } },
    { id: 4, method: 'tools/call', params: { name: 'memex_outline', arguments: { file: resolve('scripts/kde.mjs') } } },
  ]);
  const riadky = r[1].result.content[0].text.split('\n').filter((l) => /^\s+\d+ {2}riadok/.test(l));
  assert.ok(riadky.length <= 400, `prečítaných ${riadky.length} riadkov`);
  assert.equal(r[2].result.isError, true);
  assert.doesNotMatch(r[3].result.content[0].text, /^Index: /m);
  assert.equal(r[4].result.isError, true, 'osnova mimo projektu');
  assert.equal(Object.keys(r).length, 4, 'na notifikáciu sa neodpovedá');
});
