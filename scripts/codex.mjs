#!/usr/bin/env node
/**
 * Archív relácií Codexu — ten istý archív, ten istý formát ako pri Claude Code.
 *
 * Prečo zvlášť. Claude Code drží prepisy projektu v jednom priečinku
 * `~/.claude/projects/<kľúč>/`. Codex ich ukladá po dňoch do
 * `~/.codex/sessions/RRRR/MM/DD/rollout-*.jsonl` a všetky projekty spolu, takže
 * sa najprv musí zistiť, ktoré relácie patria sem. Rozhoduje `cwd` z prvého
 * riadka (`session_meta`), nie názov priečinka ani podobnosť cesty.
 *
 * Zápis robí `archivator.mjs` — rovnaké značky, zámok, stav a ochrana starých
 * riadkov. Tento súbor len vyberá zdroje a prevádza riadok Codexu na ťah.
 *
 * Formát prepisu Codexu nie je stabilné verejné rozhranie. Číta sa len to, čo
 * sme videli v skutočných reláciách (Codex Desktop 0.153): `response_item`
 * so správou, volaním nástroja a jeho výsledkom. `event_msg` nesie tie isté
 * správy druhýkrát, preto sa ignoruje celý.
 *
 * Použitie:
 *   node scripts/codex.mjs                  všetky relácie tohto projektu
 *   node scripts/codex.mjs --quiet          z hooku: nič nezakladá, mlčí
 *   node scripts/codex.mjs --transcript <rollout.jsonl>   len jedna relácia
 *   node scripts/codex.mjs --list           len vypíše, čo by archivoval
 *
 * Zdroj: `--sessions <priečinok>` → `MEMEX_CODEX_SESSIONS` → `$CODEX_HOME/sessions`
 * → `~/.codex/sessions`.
 */
import { existsSync, mkdirSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { kde, prepinac, hookVstup } from './kde.mjs';
import { archivuj } from './archivator.mjs';
import { redakcia, failureLine, prvyArgument } from './prevod.mjs';

export const priecinokRelacii = () =>
  prepinac('sessions') ??
  process.env.MEMEX_CODEX_SESSIONS ??
  join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');

/*
  Cesta v podobe, ktorá sa dá porovnať.

  V jednom priečinku relácií sme našli ten istý projekt trikrát inak:
  `file:///C:/Users/…/memex`, `C:\\Users\\…\\memex` a `c:\\Users\\…\\memex`.
  Na Windowse veľkosť písmen nerozhoduje, takže sa porovnáva malými písmenami.
*/
export function normalizujCestu(c) {
  let s = String(c ?? '');
  if (s.startsWith('file://')) {
    try { s = decodeURIComponent(s.replace(/^file:\/\/\/?/, '')); } catch { s = s.replace(/^file:\/\/\/?/, ''); }
  }
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' || /^[a-z]:\//i.test(s) ? s.toLowerCase() : s;
}

/** Patrí `cwd` relácie k projektu? Podpriečinok projektu áno, susedný priečinok s rovnakým začiatkom nie. */
export function patriProjektu(cwd, koren) {
  const a = normalizujCestu(cwd), b = normalizujCestu(resolve(koren));
  return !!a && (a === b || a.startsWith(b + '/'));
}

/** Prvé riadky prepisu — `session_meta` a začiatok prvého ťahu. Celý súbor sa nečíta. */
async function hlavicka(cesta) {
  const prud = createReadStream(cesta);
  const citacka = createInterface({ input: prud, crlfDelay: Infinity });
  const riadky = [];
  for await (const r of citacka) {
    if (r.trim()) riadky.push(r);
    if (riadky.length >= 3) break;
  }
  // `close()` zavrie čítačku riadkov, nie súbor: 200 z 200 prepisov nad 64 kB
  // zostalo otvorených, a prechádzajú sa relácie všetkých projektov.
  citacka.close();
  prud.destroy();
  let meta = null;
  try { meta = JSON.parse(riadky[0] ?? ''); } catch { /* nečitateľný začiatok = nie je náš */ }
  /*
    Relácie, ktoré Codex sám importoval z Claude Code (`external-import-turn-*`).

    Ich obsah je kópia Claudovho prepisu, ktorý memex archivuje zo zdroja.
    Druhá kópia v archíve by zdvojila každý zásah vo vyhľadávaní.
  */
  const import_ = riadky.slice(1).some((r) => r.includes('"turn_id":"external-import'));
  return { meta: meta?.type === 'session_meta' ? meta.payload ?? {} : null, import_ };
}

function* rollouty(priecinok) {
  if (!existsSync(priecinok)) return;
  for (const f of readdirSync(priecinok, { withFileTypes: true })) {
    const p = join(priecinok, f.name);
    if (f.isDirectory()) yield* rollouty(p);
    else if (f.name.startsWith('rollout-') && f.name.endsWith('.jsonl')) yield p;
  }
}

/** Relácie Codexu, ktoré patria tomuto projektu, s ich identifikátorom. */
export async function relacieProjektu(koren, priecinok = priecinokRelacii(), len = null) {
  const out = [];
  for (const cesta of len ? [len] : rollouty(priecinok)) {
    if (!existsSync(cesta)) continue;
    const { meta, import_ } = await hlavicka(cesta);
    if (!meta || import_ || !patriProjektu(meta.cwd, koren)) continue;
    const id = String(meta.id ?? meta.session_id ?? '').replace(/[^A-Za-z0-9-]/g, '');
    if (!id) continue;
    out.push({ cesta, id, kluc: `codex-${id}`, bajtov: statSync(cesta).size, cwd: meta.cwd });
  }
  return out;
}

/*
  Vložené bloky, ktoré nie sú slová človeka.

  Codex lepí pred používateľovu správu celé bloky kontextu —
  `<recommended_plugins>`, `<environment_context>`, `<ide_opened_file>` — často
  viac za sebou a niekedy s ozajstnou vetou za nimi. Majú rolu `user`, ale
  napísal ich nástroj. Rovnaké pravidlo ako `SYSTEM_BLOCK` v `archive.mjs`:
  reč nástroja sa nevydáva za reč človeka. Odstraňujú sa len bloky na
  začiatku, ktoré sa aj zatvoria; čo zostane, je veta používateľa.
*/
const VLOZENE_POKYNY = /^# AGENTS\.md instructions/;

export function bezVlozenych(t) {
  let s = String(t).trim();
  for (;;) {
    const m = /^<([a-z_][\w-]*)[\s>]/i.exec(s);
    if (!m) break;
    const koniec = s.indexOf(`</${m[1]}>`);
    if (koniec < 0) break;
    s = s.slice(koniec + m[1].length + 3).trim();
  }
  return VLOZENE_POKYNY.test(s) ? '' : s;
}

const textSpravy = (content) =>
  (Array.isArray(content) ? content : [])
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .join('');

const cisty = (t) => redakcia(String(t).replace(/data:[a-z/]+;base64,[A-Za-z0-9+/=]+/g, '[image]')).trim();

const cestyZPatchu = (t) =>
  [...String(t).matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1].trim());

/*
  Jeden riadok na volanie — čo sa spravilo, nie čo sa vrátilo.

  Codex Desktop volá takmer všetko cez `exec`: kúsok JavaScriptu, ktorý vnútri
  volá `tools.exec_command({cmd: …})` alebo `tools.apply_patch(…)`. Vnorené
  volania sa z textu vytiahnu regulárnym výrazom; kód sa nikdy nespúšťa. Keď
  sa nič nerozpozná, zostane prvých 160 znakov — radšej neúplná stopa než žiadna.
*/
export function suhrnVolania(p) {
  const meno = p.namespace ? `${p.namespace}.${p.name}` : String(p.name ?? '?');
  const vstup = p.type === 'custom_tool_call' ? String(p.input ?? '') : String(p.arguments ?? '');
  if (p.name === 'apply_patch') {
    const cesty = cestyZPatchu(vstup);
    return cesty.length ? cesty.map((c) => `[Tool: apply_patch ${c}]`) : ['[Tool: apply_patch]'];
  }
  if (p.name === 'exec' && p.type === 'custom_tool_call') {
    const out = [];
    for (const m of vstup.matchAll(/tools\.(\w+)\(\s*\{\s*cmd\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g)) {
      let cmd = m[2].slice(1, -1);
      try { if (m[2][0] === '"') cmd = JSON.parse(m[2]); } catch { /* nechá sa surový */ }
      out.push(`[Tool: ${m[1]}] ${redakcia(cmd).replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    for (const c of cestyZPatchu(vstup.replace(/\\n/g, '\n'))) out.push(`[Tool: apply_patch ${c}]`);
    for (const m of vstup.matchAll(/tools\.(\w+)\(/g)) {
      if (m[1] !== 'exec_command' && m[1] !== 'apply_patch') out.push(`[Tool: ${m[1]}]`);
    }
    return out.length ? [...new Set(out)] : [`[Tool: exec] ${redakcia(vstup).replace(/\s+/g, ' ').slice(0, 160)}`];
  }
  let args = {};
  try { args = JSON.parse(vstup || '{}'); } catch { /* nie JSON */ }
  const prikaz = Array.isArray(args.command) ? args.command.join(' ') : typeof args.command === 'string' ? args.command : args.cmd;
  if (typeof prikaz === 'string') return [`[Tool: ${meno}] ${redakcia(prikaz).replace(/\s+/g, ' ').slice(0, 200)}`];
  return [`[Tool: ${meno}${prvyArgument(args)}]`];
}

function textVystupu(o) {
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return o.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('\n');
  if (o && typeof o.output === 'string') return o.output;
  return '';
}

/** Riadok prepisu Codexu → ťah archívu, alebo `null`. */
export function prevedCodex(j, zlyhania) {
  if (j?.type !== 'response_item' || !j.payload) return null;
  const p = j.payload;
  let rola, telo = '';
  const plot = String.fromCharCode(96).repeat(3);
  if (p.type === 'message') {
    if (p.role !== 'user' && p.role !== 'assistant') return null;
    const surovy = p.role === 'user' ? bezVlozenych(textSpravy(p.content)) : textSpravy(p.content).trim();
    if (!surovy) return null;
    rola = p.role === 'user' ? 'USER' : 'CODEX';
    telo = cisty(surovy);
  } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
    rola = 'CODEX';
    const riadky = p.type === 'local_shell_call'
      ? [`[Tool: shell] ${redakcia([].concat(p.action?.command ?? []).join(' ')).slice(0, 200)}`]
      : suhrnVolania(p);
    telo = plot + '\n' + riadky.join('\n').trimEnd() + '\n' + plot;
  } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
    const t = textVystupu(p.output).replace(/\\r\\n|\\n/g, '\n');
    const chyba = failureLine(t);
    if (!chyba || zlyhania.has(chyba)) return null;
    zlyhania.add(chyba);
    rola = 'CODEX';
    telo = plot + '\n[Failed] ' + chyba + '\n' + plot;
  } else return null;
  if (!telo) return null;
  return '\n\n## ' + rola + ' - ' + (j.timestamp?.slice(0, 16).replace('T', ' ') ?? '?') + '\n\n' + telo;
}

// Spustené priamo, nie importované z testu alebo MCP servera.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const TICHO = process.argv.includes('--quiet');
  const LEN_ZOZNAM = process.argv.includes('--list');
  const CESTY = kde();
  const TARGET = CESTY.archive;
  /*
    Hook `Stop` podá cestu k prepisu práve skončeného ťahu. Vtedy sa nečíta
    celý priečinok relácií — ten má všetky projekty a rastie každým dňom.
  */
  const vstup = TICHO ? hookVstup() : {};
  const jedna = prepinac('transcript') ?? (typeof vstup.transcript_path === 'string' ? vstup.transcript_path : null);
  const relacie = await relacieProjektu(CESTY.koren, priecinokRelacii(), jedna);

  if (LEN_ZOZNAM) {
    console.log(`Codex relácie projektu ${CESTY.koren}: ${relacie.length}`);
    for (const r of relacie) console.log(`  ${r.kluc}  ${(r.bajtov / 1024).toFixed(0)} kB  ${r.cesta}`);
    process.exit(0);
  }
  /*
    Hook archív nezakladá — rovnaké pravidlo ako `archive.mjs`.

    Plugin beží v každom projekte, ktorý Codex otvorí. Priečinok, ktorý si
    projekt nepýtal, môže rozbiť build (Tailwind skenuje všetko mimo
    `.gitignore`) a je zlý aj vtedy, keď nič nerozbije.
  */
  if (!existsSync(TARGET)) {
    if (TICHO) process.exit(0);
    mkdirSync(TARGET, { recursive: true });
  }
  if (!relacie.length) {
    if (!TICHO) console.log(`Žiadna relácia Codexu s cwd v ${CESTY.koren} (hľadané v ${priecinokRelacii()}).`);
    process.exit(0);
  }
  // Výstup hooku `Stop` ide hostiteľovi. Súhrn „Relácií: …" tam nepatrí; chyby idú na stderr.
  if (TICHO) console.log = () => {};
  await archivuj({
    súbory: relacie.map((r) => r.cesta),
    kľúčPre: (cesta) => relacie.find((r) => r.cesta === cesta).kluc,
    cieľ: TARGET,
    projekt: `codex:${CESTY.koren}`,
    ticho: TICHO,
    preved: prevedCodex,
  });
}
