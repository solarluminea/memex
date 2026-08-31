/**
 * Benchmark mapy — dávkovo, aby sa dal spustiť dosť veľký, aby čísla niečo vážili.
 *
 * Kľúč správnych odpovedí berie z gitu: správa commitu je zadanie, jeho zmenené
 * súbory sú odpoveď. Nikto ich nepísal pre tento test, takže sa nedajú
 * prispôsobiť tomu, čo mapa vie.
 *
 * MEMEX_ABLATE odstaví jednotlivé vylepšenia, takže rozdiel v úspešnosti je ich
 * príspevok — nie súčet všetkého naraz.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = process.env.MEMEX_PROJECT_ROOT || process.cwd();
const MAP = fileURLToPath(new URL('./map.mjs', import.meta.url));
const N = Number(process.env.BENCH_N ?? 200);
const SLOV = Number(process.env.BENCH_W ?? 5);

const STOP = new Set(['ktora', 'ktore', 'ktory', 'nielen', 'namiesto', 'pretoze', 'preto',
  'tlacidlo', 'pridane', 'pridany', 'opravene', 'oprava', 'zmena', 'zmenene', 'presun',
  'vsetky', 'vsetko', 'druhy', 'prvy', 'novy', 'nova', 'nove', 'nemusi', 'musia', 'nedostali']);
const undia = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function ulohy() {
  const raw = execFileSync('git', ['log', '--no-merges', '-n', '900', '--format=%x00%s', '--name-only'],
    { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  for (const blok of raw.split('\0').slice(1)) {
    const [sprava, ...riadky] = blok.split('\n');
    const subory = riadky.map((r) => r.trim())
      .filter((r) => /^(src|scripts)\//.test(r) && /\.(ts|tsx|mjs|mts)$/.test(r));
    if (!subory.length || subory.length > 6) continue;
    const slova = [...new Set(undia(sprava).match(/[a-z]{6,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, SLOV);
    if (!slova.length) continue;
    out.push({ sprava: sprava.trim(), subory, slova });
    if (out.length >= N) break;
  }
  return out;
}

const sada = ulohy();
const dotazy = sada.flatMap((u) => u.slova);

const vystup = execFileSync('node', [MAP, 'find', '--batch'], {
  cwd: APP, encoding: 'utf8', input: dotazy.join('\n'), maxBuffer: 1 << 28,
  env: { ...process.env, MSYS_NO_PATHCONV: '1' },
});

// Výsledky sú oddelené riadkom s jedinou medzerou.
const bloky = vystup.split(String.fromCharCode(0));
const cesty = bloky.map((b) => b.split('\n')
  .map((r) => /^([\w./[\]-]+\.\w+)(?::\d+)? — /.exec(r)?.[1]).filter(Boolean));

let i = 0, r1 = 0, r3 = 0, r12 = 0, mrr = 0, nic = 0;
for (const u of sada) {
  let naj = null;
  for (const _ of u.slova) {
    const zoznam = cesty[i++] ?? [];
    const p = zoznam.findIndex((c) => u.subory.some((s) => c === s || c.endsWith('/' + s.split('/').pop())));
    if (p >= 0 && (naj === null || p + 1 < naj)) naj = p + 1;
  }
  if (naj === null) { nic++; continue; }
  mrr += 1 / naj;
  if (naj <= 1) r1++;
  if (naj <= 3) r3++;
  if (naj <= 12) r12++;
}

const p = (n) => ((n / sada.length) * 100).toFixed(1).padStart(5);
const stitok = process.env.MEMEX_ABLATE ? `bez: ${process.env.MEMEX_ABLATE}` : 'plná mapa';
console.log(`${stitok.padEnd(22)} n=${sada.length}  R@1 ${p(r1)}%  R@3 ${p(r3)}%  R@12 ${p(r12)}%  MRR ${(mrr / sada.length).toFixed(3)}  nič ${p(nic)}%`);
