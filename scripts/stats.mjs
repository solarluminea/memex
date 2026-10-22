#!/usr/bin/env node
/**
 * Telemetry: what navigation actually costs, per session.
 *
 * Every number quoted while this plugin was built came from a one-off
 * experiment — run once, by hand, on a good day. That is enough to choose a
 * direction and not enough to know whether the direction worked. This reads
 * the transcripts Claude Code already writes and turns them into a number that
 * accumulates on its own.
 *
 * ⚠️ **It does not report savings, on purpose.** "This saved 7k tokens" is a
 * claim about a session that never happened, and any tool that prints it is
 * quoting its author's hopes. What is here are facts — tokens spent, calls
 * made, how far into a session the first edit landed — and the comparison is
 * left between two periods of real work.
 *
 * Two of those facts are worth more than the rest:
 *
 *   · **Steps before the first edit.** Navigation is the part between "I was
 *     asked" and "I changed something". If a map helps, this falls.
 *   · **Cache share.** A cached input token costs about a tenth of a fresh
 *     one, so a raw token count without it describes the wrong thing.
 *
 * Counting is deliberately generous about what a lookup is: in a project that
 * works through the shell, `grep` inside Bash is a lookup exactly as much as
 * the Grep tool, and `sed -n` is a read. Measured on one real project: 13 038
 * Bash calls against 1 050 Read calls. Count only the tools and you would be
 * describing someone else's workflow.
 *
 *   memex/scripts/stats.mjs           rescan what changed, then report
 *   memex/scripts/stats.mjs --quiet   rescan silently (for the hook)
 *   memex/scripts/stats.mjs --json    machine-readable rows
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { kde } from './kde.mjs';

const ROOT = process.env.MEMEX_PROJECT_ROOT || process.cwd();
const CESTY = kde(ROOT);
const MEMEX = CESTY.root;
const STATS = CESTY.stats;
const STATE = join(MEMEX, '.stats-state.json');

// Kde ležia prepisy, hovorí `kde.mjs` — bola to štvrtá kópia toho istého kľúča.
const SOURCE =
  process.env.MEMEX_TRANSCRIPTS || CESTY.zdroj.cesta || join(CESTY.zdroj.zaklad, CESTY.zdroj.kluc);

/*
  Verzia riadku telemetrie.

  Riadok staršej verzie sa zahodí a relácia sa prepočíta. Bez toho by oprava
  dvojitého účtovania tokenov (nižšie) platila len na nové relácie a prehľad by
  porovnával polovicu meranú jedným pravidlom s polovicou meranou druhým — čo
  je horší nezmysel než pôvodná chyba, lebo vyzerá ako zmena v práci.
*/
/*
  Verzia 3 počíta aj podagentov a veľkosť kontextu.

  Podagenti ležia v `<relácia>/subagents/` a telemetria ich nevidela. Na
  skutočnom projekte stoja 56 % ceny. A „čerstvé tokeny" sú štvrtina ceny:
  71 % je čítanie kontextu z cache pri každom volaní (pozri `kontext.mjs`).
  Riadky starších verzií sa prepočítajú, aby polovice merali to isté.
*/
const VERZIA = 3;
const VAHY = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

// ── čo sa počíta ───────────────────────────────────────────────────────────

/*
  Hľadanie proti čítaniu proti zásahu.

  Bash sa posudzuje podľa príkazu, nie podľa názvu nástroja. Bez toho by
  projekt, ktorý pracuje cez shell, vyzeral, že nehľadá vôbec — a jeho čísla
  by boli o niekom inom.
*/
/*
  Vzory pokrývajú aj PowerShell.

  Nástroj `PowerShell` sa sem posielal od začiatku, ale triedil sa unixovými
  vzormi, takže `Get-Content` ani `Select-String` sa nepočítali. Na Windowse,
  kde je PowerShell hlavný shell, to znamenalo telemetriu, ktorá tvrdí, že sa
  nehľadá a nečíta — presne ten omyl, pred ktorým varuje komentár vyššie, len
  obrátený na druhú platformu.
*/
const HLADANIE = /^(grep|rg|ag|find|fd|glob)\b|\b(grep|rg)\b|map\.mjs|search\.mjs|\b(Select-String|Get-ChildItem|gci)\b/;
const CITANIE = /^(cat|head|tail|less|more|type)\b|\bsed -n\b|\b(Get-Content|gc)\b/;
/*
  Zásah cez shell je zápis do súboru, nič iné.

  Prvá verzia sem brala `git add`, `git commit` a každé presmerovanie — a
  vyšlo z toho 142 „zásahov" na reláciu, čo je nezmysel. Commit nie je zmena
  kódu, je to zápis do histórie, a `> /dev/null` nie je zápis vôbec.
*/
const ZASAH = /<<\s*'?[A-Z]|>\s*[\w./-]+\.\w+|\btee\s+[\w./-]+|\b(Set-Content|Add-Content|Out-File|Tee-Object)\b/;

const NASTROJE = {
  lookup: new Set(['Grep', 'Glob', 'WebSearch']),
  read: new Set(['Read', 'NotebookRead', 'WebFetch']),
  edit: new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']),
};

function zaradBash(prikaz) {
  const p = String(prikaz || '').trim();
  // Zápis sa skúša prvý: `cat <<'EOF' > súbor` je zásah, nie čítanie.
  if (ZASAH.test(p)) return 'edit';
  if (HLADANIE.test(p)) return 'lookup';
  if (CITANIE.test(p)) return 'read';
  return null;
}

/**
 * Jedna relácia: tokeny, volania a to, kde padol prvý zásah.
 *
 * Číta sa po riadkoch. Prepisy majú desiatky tisíc riadkov a stovky megabajtov
 * — načítať taký súbor naraz je pamäťová špička bez dôvodu.
 */
async function precitaj(cesta, podagenti = []) {
  const r = {
    v: VERZIA,
    session: basename(cesta, '.jsonl'),
    day: null,
    turns: 0,
    input: 0, cacheWrite: 0, cacheRead: 0, output: 0,
    lookup: 0, read: 0, edit: 0,
    map: 0,
    beforeFirstEdit: null,
    // Volania s kontextom nad 200k a cena podagentov (váhy VAHY), oboje pre prehľad.
    over200k: 0, subCost: 0, subagents: podagenti.length,
  };
  await prejdi(r, cesta, true);
  for (const p of podagenti) await prejdi(r, p, false);
  return r;
}

/*
  Jeden prepis — hlavný alebo podagenta — pripočítaný k riadku relácie.

  Zásahy a hľadania podagenta sa počítajú do relácie: je to tá istá práca,
  len delegovaná. „Kroky pred prvým zásahom" sú len z hlavnej relácie, lebo
  podagent začína od nuly a jeho poradie s hlavnou nie je v jednom súbore.
*/
async function prejdi(r, cesta, hlavna) {
  let krokov = 0;
  /*
    Jedna odpoveď sa účtuje raz.

    Claude Code zapisuje jednu odpoveď modelu ako viac riadkov — text zvlášť,
    každé volanie nástroja zvlášť — a `usage` v nich nesie **rovnaké** čísla,
    lebo patria tomu istému volaniu API. Sčítať ich po riadkoch znamená
    zaplatiť ten istý vstup toľkokrát, na koľko kusov sa odpoveď rozpadla.

    Namerané na štyroch prepisoch tohto projektu: 2 090 riadkov s `usage`, ale
    len 1 031 unikátnych `message.id`, a vstupné tokeny vyšli **1,98×** vyššie.
    Číslo „36k čerstvých tokenov na zásah" bolo teda zhruba dvojnásobok.

    Porovnanie polovíc tým skreslené nebolo — chyba je násobok, nie posun — ale
    absolútne číslo áno, a práve to sa cituje.
  */
  const zapocitane = new Set();

  const rl = createInterface({ input: createReadStream(cesta), crlfDelay: Infinity });
  for await (const riadok of rl) {
    if (!riadok) continue;
    let j;
    try { j = JSON.parse(riadok); } catch { continue; }
    if (hlavna && !r.day && j.timestamp) r.day = j.timestamp.slice(0, 10);

    const u = j.message?.usage;
    // Bez `id` sa započíta — je to jediný záznam o tom volaní, aký existuje.
    const id = j.message?.id;
    if (u && !(id && zapocitane.has(id))) {
      if (id) zapocitane.add(id);
      const x = {
        input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0,
      };
      r.turns++;
      for (const k in x) r[k] += x[k];
      if (x.input + x.cacheWrite + x.cacheRead > 200_000) r.over200k++;
      if (!hlavna) r.subCost += Object.entries(x).reduce((a, [k, n]) => a + n * VAHY[k], 0);
    }

    for (const c of j.message?.content ?? []) {
      if (c.type !== 'tool_use') continue;
      let druh = null;
      if (NASTROJE.lookup.has(c.name)) druh = 'lookup';
      else if (NASTROJE.read.has(c.name)) druh = 'read';
      else if (NASTROJE.edit.has(c.name)) druh = 'edit';
      else if (c.name === 'Bash' || c.name === 'PowerShell') druh = zaradBash(c.input?.command);
      if (!druh) continue;

      if (/map\.mjs/.test(String(c.input?.command ?? ''))) r.map++;
      r[druh]++;
      if (!hlavna) continue;
      if (druh === 'edit') {
        // Kroky pred prvým zásahom — jadro celého merania.
        if (r.beforeFirstEdit === null) r.beforeFirstEdit = krokov;
      } else {
        krokov++;
      }
    }
  }
}

// ── zber ───────────────────────────────────────────────────────────────────

async function zozbieraj(ticho) {
  if (!existsSync(SOURCE)) {
    if (!ticho) console.error(`No transcripts at ${SOURCE}`);
    return null;
  }
  /*
    Hook si nezaloží `.memex/` v projekte, ktorý oň nepožiadal.

    `archive.mjs` túto poistku má a je pri nej napísané prečo; telemetria a
    mapa ju nemali, takže hook, ktorý beží v každom otvorenom priečinku, si
    zakladal pamäť všade. Nájdené na tomto stroji: `~/.memex/MAP.md` s nula
    modulmi a `stats.jsonl` v domovskom priečinku, to isté v `Temp`.

    Ručný beh zakladá ďalej — kto skript spustil sám, o pamäť požiadal.
  */
  if (ticho && !existsSync(MEMEX) && !CESTY.nastavenieExistuje) return null;
  mkdirSync(MEMEX, { recursive: true });
  const stav = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  const hotove = new Map(
    (existsSync(STATS) ? readFileSync(STATS, 'utf8') : '')
      .split('\n').filter(Boolean)
      .map((r) => { try { const j = JSON.parse(r); return [j.session, j]; } catch { return null; } })
      .filter(Boolean)
      // Riadok staršej verzie sa neprevezme, takže sa relácia prepočíta.
      .filter(([, j]) => j.v === VERZIA),
  );

  let novych = 0;
  for (const f of readdirSync(SOURCE)) {
    if (!f.endsWith('.jsonl')) continue;
    const cesta = join(SOURCE, f);
    const s = statSync(cesta);
    // Podagenti relácie a ich veľkosti patria do známky: podagent na pozadí
    // dopisuje svoj súbor aj vtedy, keď hlavná relácia stojí.
    const priecinokPodagentov = join(SOURCE, basename(f, '.jsonl'), 'subagents');
    const podagenti = existsSync(priecinokPodagentov)
      ? readdirSync(priecinokPodagentov).filter((x) => x.endsWith('.jsonl')).map((x) => join(priecinokPodagentov, x))
      : [];
    let velkostPodagentov = 0;
    for (const p of podagenti) { try { velkostPodagentov += statSync(p).size; } catch { /* zmizol */ } }
    const znamka = `${s.size}:${Math.floor(s.mtimeMs)}:${podagenti.length}:${velkostPodagentov}`;
    // Prepis, ktorý sa nezmenil, sa neprechádza znova — inak by prehľad rástol
    // z minút na desiatky minút, ako archív pribúda.
    if (stav[f] === znamka && hotove.has(basename(f, '.jsonl'))) continue;
    hotove.set(basename(f, '.jsonl'), await precitaj(cesta, podagenti));
    stav[f] = znamka;
    novych++;
  }

  const riadky = [...hotove.values()].sort((a, b) => (a.day ?? '').localeCompare(b.day ?? ''));
  writeFileSync(STATS, riadky.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  writeFileSync(STATE, JSON.stringify(stav, null, 2), 'utf8');
  return { riadky, novych };
}

// ── prehľad ────────────────────────────────────────────────────────────────

// Desatinné miesto pod desiatkou: „1,4 hľadania na zásah" je iné číslo než
// „1" a práve v tom rozsahu sa pohybuje to, čo má toto meranie rozlíšiť.
const k = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n >= 10 ? String(Math.round(n)) : n.toFixed(1);
const priemer = (xs, f) => (xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0);

function prehlad(riadky) {
  if (!riadky.length) return console.log('No sessions measured yet.');

  // Polovica na polovicu, nie „posledných sedem dní": korpus býva malý a pevné
  // okno by pri desiatich reláciách porovnávalo dve s ôsmimi.
  const stred = Math.floor(riadky.length / 2);
  const [staré, nové] = [riadky.slice(0, stred), riadky.slice(stred)];

  const riadok = (nazov, f, jednotka = '') => {
    const a = priemer(staré, f), b = priemer(nové, f);
    const zmena = staré.length && a ? ((b - a) / a) * 100 : null;
    const smer = zmena === null ? '' : `${zmena >= 0 ? '+' : ''}${zmena.toFixed(0)} %`;
    console.log(`  ${nazov.padEnd(26)}${(k(b) + jednotka).padStart(8)}   ${smer.padStart(7)}`);
  };

  const dni = new Set(riadky.map((x) => x.day).filter(Boolean));
  console.log(`Sessions ${riadky.length}, ${dni.size} days.`);
  console.log(`Change against the older half (${staré.length} vs ${nové.length}).\n`);

  /*
    Delené počtom zásahov, nie počtom relácií.

    Prvá verzia počítala priemer na reláciu a všetko v nej padalo o osemdesiat
    percent — nie preto, že by sa navigácia zlepšila, ale preto, že staršie
    relácie boli dlhšie. Relácia je ľubovoľne dlhá, zásah je jednotka práce.
  */
  const naZasah = (f) => (x) => (x.edit ? f(x) / x.edit : 0);

  console.log('  Navigation');
  riadok('steps before 1st edit', (x) => x.beforeFirstEdit ?? 0);
  riadok('lookups per edit', naZasah((x) => x.lookup));
  riadok('reads per edit', naZasah((x) => x.read));
  console.log('');
  console.log('  Cost per edit');
  /*
    Vážená cena, nie len čerstvé tokeny.

    Čerstvé tokeny sú vstup a zápis do cache — na skutočnom projekte štvrtina
    ceny. Čítanie celého kontextu pri každom volaní stojí desatinu tokenu, ale
    je ho toľko, že tvorí 71 %. Riadok v jednotkách „čerstvého tokenu" sčíta
    všetko podľa pomerných cien (1 / 1,25 / 0,1 / 5) — dolár to nie je,
    porovnanie polovíc áno.
  */
  const vazene = (x) => x.input * VAHY.input + x.cacheWrite * VAHY.cacheWrite + x.cacheRead * VAHY.cacheRead + x.output * VAHY.output;
  riadok('weighted cost', naZasah(vazene));
  riadok('fresh input tokens', naZasah((x) => x.input + x.cacheWrite));
  riadok('output tokens', naZasah((x) => x.output));
  console.log('');
  console.log('  Context');
  riadok('mean context per call', (x) => (x.turns ? (x.input + x.cacheWrite + x.cacheRead) / x.turns : 0));
  riadok('calls over 200k', (x) => (x.turns ? (x.over200k / x.turns) * 100 : 0), ' %');
  riadok('subagents, share of cost', (x) => { const c = vazene(x); return c ? (x.subCost / c) * 100 : 0; }, ' %');
  console.log('');
  console.log('  Volume');
  riadok('edits', (x) => x.edit);
  riadok('turns', (x) => x.turns);

  /*
    Podiel cache. Prečítaný token z cache stojí zlomok čerstvého, takže bez
    tohto čísla hovorí súčet vstupu o niečom inom, než čo sa naozaj platí.
    Sčítava sa cez všetky volania zámerne — každé z nich ten token naozaj
    zaplatilo, aj keď lacnejšie.
  */
  const cache = priemer(riadky, (x) => x.cacheRead) /
    (priemer(riadky, (x) => x.cacheRead + x.input + x.cacheWrite) || 1);
  console.log(`\n  cache share ${(cache * 100).toFixed(0)} % of input`);

  const sMapou = riadky.filter((x) => x.map > 0).length;
  console.log(`  map used in ${sMapou} of ${riadky.length} sessions`);

  /*
    Bez porovnania je číslo len číslo. Táto veta hovorí, čo s ním — a zámerne
    nehovorí „ušetrili ste", lebo to by bolo tvrdenie o relácii, ktorá nikdy
    nebežala.
  */
  console.log('\nThese are counts, not savings. To judge a change, compare the');
  console.log('halves after it has been in use for a while — not against a guess.');
}

// ── vstup ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const ticho = argv.includes('--quiet');
const vysledok = await zozbieraj(ticho);
if (!vysledok) process.exit(ticho ? 0 : 1);

if (ticho) {
  // Hook mlčí, kým nie je čo povedať. Správa pri každom zatvorení okna sa
  // naučí prehliadať aj vtedy, keď raz povie niečo dôležité.
  if (vysledok.novych) console.log(`Telemetry: ${vysledok.novych} session(s) measured.`);
} else if (argv.includes('--json')) {
  for (const r of vysledok.riadky) console.log(JSON.stringify(r));
} else {
  prehlad(vysledok.riadky);
}
