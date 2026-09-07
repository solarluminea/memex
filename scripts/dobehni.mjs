#!/usr/bin/env node
/**
 * Čo z pamäte zaostáva — kontrola na začiatku relácie.
 *
 * Prečo vôbec. Prepisy, index a mapa sa udržiavajú hookom na konci relácie.
 * To je správne miesto, ale nie spoľahlivé: `SessionEnd` nemusí dobehnúť, keď
 * sa okno zavrie, keď proces dostane ranu, alebo keď práca, ktorú má spraviť,
 * trvá dlhšie než zatváranie relácie. Namerané na skutočnom projekte —
 * prestavba indexu trvala 98,9 sekundy a index bol pozadu o tri prepisy;
 * archív a mapa boli pritom v poriadku, takže nič nevyzeralo pokazene.
 *
 * Toto sa preto pýta na začiatku, keď je istota, že sa to spustí: **je to,
 * čo mám v pamäti, ešte pravda?** Nič neprestavuje. Prestavba patrí na
 * koniec relácie, kde nikoho nezdržuje; sem patrí len veta, keď niečo
 * zaostalo.
 *
 * Mlčí, keď je všetko v poriadku. Hook, ktorý povie niečo pri každom
 * otvorení okna, sa naučí prehliadať aj vtedy, keď povie niečo dôležité —
 * a to je presne ten spôsob, akým sa tri zaostalé prepisy stratili.
 *
 * Lacné zámerne: číta časy zmeny súborov a dva počty z hotového indexu.
 * Žiadne čítanie prepisov, žiadne prehľadávanie.
 */
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { kde } from './kde.mjs';

const TICHO = process.argv.includes('--quiet');
const CESTY = kde();

/** Prepisy v archíve. Bodka na začiatku je pracovný súbor, nie relácia. */
const prepisy = existsSync(CESTY.archive)
  ? readdirSync(CESTY.archive).filter((f) => f.endsWith('.md') && !f.startsWith('.'))
  : [];

/*
  Bez archívu sa nehlási nič.

  Plugin je nainštalovaný pre používateľa, takže tento hook beží v každom
  projekte, ktorý otvorí — aj v tých, ktoré o memexe nikdy nepočuli. Projekt,
  ktorý si archív nezaložil, si ho nepýtal.
*/
if (!prepisy.length) process.exit(0);

const zaostava = [];
/** „1 session is" verzus „3 sessions are" — hlásenie sa číta, nie parsuje. */
const kus = (n, jedno, viac) => (n === 1 ? `1 ${jedno} is` : `${n} ${viac} are`);

/*
  Nový prepis, ktorý ešte nie je archivovaný.

  Porovnáva sa počet relácií Claude Code proti počtu súborov v archíve. Je to
  hrubé — nehovorí to, ktoré chýbajú — ale je to jediné, čo sa dá zistiť bez
  čítania stoviek megabajtov JSONL.
*/
function projectKey(path) {
  return path.replace(/\\/g, '/').replace(/[:/]/g, '-');
}
const zdroj = join(homedir(), '.claude', 'projects', process.env.MEMEX_PROJECT ?? projectKey(process.cwd()));
if (existsSync(zdroj)) {
  const relacii = readdirSync(zdroj).filter((f) => f.endsWith('.jsonl')).length;
  if (relacii > prepisy.length) {
    zaostava.push(`${kus(relacii - prepisy.length, 'session', 'sessions')} not in the archive yet — /memex:archive`);
  }
}

/*
  Index, ktorý nepozná celý archív.

  Dva počty nad hotovým indexom, nie prehľadanie. Prepis, ktorý index nepozná,
  sa nedá nájsť a nič iné to nepovie — hlásenie „built" bolo dvakrát pravdivé
  a zároveň bezcenné.
*/
if (existsSync(CESTY.index)) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(CESTY.index);
    const suborov = db.prepare('SELECT count(DISTINCT subor) c FROM useky').get().c;
    db.close();
    const kedy = statSync(CESTY.index).mtimeMs;
    const novsie = prepisy.filter((f) => statSync(join(CESTY.archive, f)).mtimeMs > kedy).length;
    if (suborov < prepisy.length) {
      zaostava.push(`the index is missing ${prepisy.length - suborov} transcripts — memex/scripts/search.mjs --index`);
    } else if (novsie) {
      zaostava.push(`${kus(novsie, 'transcript', 'transcripts')} changed since the index was built — memex/scripts/search.mjs --index`);
    }
  } catch {
    zaostava.push('the index cannot be read — memex/scripts/search.mjs --index');
  }
} else {
  zaostava.push('there is no full-text index — memex/scripts/search.mjs --index');
}

/*
  Ukazovateľ, ktorý zaostal za archívom.

  Toto je to jediné, čo hook spraviť nemôže — destilácia stojí modelové tokeny
  a musí ju spustiť človek. Preto sa aspoň ozve, a preto má prah: jedna-dve
  nespracované relácie sú normálny stav uprostred týždňa, dvadsať znamená, že
  pamäť oslepla presne na tom, čo sa práve rozhoduje.
*/
const PRAH = Number(CESTY.volby.distilAfter ?? 10);
let slepota = null;
if (existsSync(CESTY.trail)) {
  const pokryte = new Set();
  for (const f of readdirSync(CESTY.trail).filter((x) => x.endsWith('.md'))) {
    const t = readFileSync(join(CESTY.trail, f), 'utf8');
    for (const m of t.matchAll(/\]\(([^)#]+)#L\d+/g)) pokryte.add(m[1].split('/').pop());
  }
  const bez = prepisy.filter((f) => !pokryte.has(f));
  if (bez.length >= PRAH) {
    /*
      Dokedy pamäť nevidí, nie koľko súborov chýba.

      „26 prepisov bez záznamu" je počet, ktorý nič neznamená. „Pamäť nevidí
      od 1. septembra" je stav, ktorý sa dá posúdiť — a je to presne to, čo je
      v stávke: nie súbory, ale posledný týždeň rozhodnutí.
    */
    const dni = [];
    for (const f of bez) {
      const d = /^(?:date|den):\s*(\d{4}-\d{2}-\d{2})/m
        .exec(readFileSync(join(CESTY.archive, f), 'utf8').slice(0, 300));
      if (d) dni.push(d[1]);
    }
    dni.sort();
    const odkedy = dni[0] ?? null;
    const dnovDozadu = odkedy ? Math.round((Date.now() - Date.parse(odkedy)) / 86400000) : 0;
    slepota = { pocet: bez.length, odkedy, dnovDozadu };
  }
}

if (!zaostava.length && !slepota) process.exit(0);
if (TICHO && process.env.MEMEX_TICHO === '1') process.exit(0);

if (zaostava.length) {
  console.log('memex: memory is behind');
  for (const x of zaostava) console.log(`  · ${x}`);
}

/*
  Pripomienka, ktorá silnie — a hovorí to používateľovi, nie len agentovi.

  Stdout zo `SessionStart` ide do kontextu agenta, nie pred oči človeku. Sám
  o sebe je to teda lístok, o ktorom sa agent môže rozhodnúť pomlčať — a keď
  rovnaký riadok vidí desiaty raz, pomlčí. Preto sú tu dve veci naraz:

  · **Prikáže sa to povedať.** Nie „poznámka pre teba", ale veta pre
    používateľa, v jeho jazyku, na začiatku odpovede. Agent nemá čo posudzovať,
    či to je dosť dôležité.
  · **Silnie to.** Rovnaká veta pri desiatich aj pri stopäťdesiatich prepisoch
    je vzor, ktorý sa naučí prehliadať. Text sa mení s tým, ako dlho je pamäť
    slepá — lebo v stávke nie sú súbory, ale dni rozhodnutí.

  Destilácia je jediná vec v memexe, ktorú hook spraviť nemôže: stojí modelové
  tokeny. Preto je toto jediné miesto, kde si nástroj pýta pozornosť.
*/
if (slepota) {
  const { pocet, odkedy, dnovDozadu } = slepota;
  const odkdy = odkedy ? ` — the archive covers it, the trail does not, so nothing since ${odkedy} can be pointed at` : '';
  console.log('');
  if (dnovDozadu >= 14) {
    console.log(`⛔ MEMEX: the project's memory has been blind for ${dnovDozadu} days.`);
    console.log(`${pocet} transcripts have no trail entry${odkdy}.`);
    console.log('TELL THE USER THIS FIRST, in their own language, before answering anything');
    console.log('else: the memory cannot answer questions about the last few weeks until');
    console.log('the distiller is run (/memex:distill). It is a batch job and costs model');
    console.log('tokens, so only they can start it. Do not bury this at the end of a reply.');
  } else if (dnovDozadu >= 7 || pocet >= PRAH * 2) {
    console.log(`⚠️ MEMEX: the trail is ${dnovDozadu} days behind — ${pocet} transcripts have no entry${odkdy}.`);
    console.log('Say this to the user in their own language near the start of your first');
    console.log('reply: questions about the last week have nothing to point at until');
    console.log('/memex:distill is run. It costs model tokens, so it is their call.');
  } else {
    console.log(`memex: ${pocet} transcripts have no trail entry — mention /memex:distill to the user.`);
  }
}
