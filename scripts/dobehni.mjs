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
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kde, prepisyVZdroji, hookVstup } from './kde.mjs';

const TICHO = process.argv.includes('--quiet');
const CESTY = kde();
/*
  Ktorá relácia je práve táto — od hostiteľa, nie odhadom.

  Bez toho hook hlásil, že jedna relácia chýba v archíve, pri každom otvorení
  okna: vlastný `.jsonl` vznikne skôr, než hook dobehne, a v archíve
  pochopiteľne nie je. Namerané na tomto projekte — prvý riadok prebiehajúcej
  relácie 00:10:18, archív predošlej dopísaný 00:10:03, a hlásenie „1 session
  is not in the archive yet" sedelo v kontexte oboch.
*/
const VSTUP = hookVstup();
const TATO_RELACIA = typeof VSTUP.session_id === 'string' ? VSTUP.session_id : null;

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

/*
  `--po-kompakcii` — jedna veta hneď po kompakcii, z hooku `SessionStart`
  s matcherom `compact`.

  Súhrn kompakcie je presne ten druh pamäte, ktorý tento projekt meral a
  zamietol: tému drží, konkrétny fakt nie — a nikto si to nevšimne, lebo nič
  nevyzerá chýbajúce. Hook `PreCompact` (`udrzba.mjs --pred-kompakciou`)
  predtým zarchivoval a zaindexoval všetko, čo sa zhrnulo. Toto povie
  agentovi, že to existuje a ako sa k tomu dostane. Dve vety, lebo sa
  pripomínajú po každej kompakcii a nesú sa v kontexte až do ďalšej.
*/
if (process.argv.includes('--po-kompakcii')) {
  const subor = TATO_RELACIA ? join(CESTY.archive, `${TATO_RELACIA}.md`) : null;
  if (!subor || !existsSync(subor)) process.exit(0);
  const riadkov = readFileSync(subor, 'utf8').split('\n').length;
  const lomitka = (c) => c.split(sep).join('/');
  const skript = lomitka(join(dirname(fileURLToPath(import.meta.url)), 'search.mjs'));
  console.log(`memex: everything before this compaction is archived word for word in ${lomitka(relative(CESTY.koren, subor))}, lines 1-${riadkov}.`);
  console.log(`The summary drops specifics. To recover a number, an error or a reason: node "${skript}" "<words>" and read the range it returns.`);
  process.exit(0);
}

const zaostava = [];
/** „1 session is" verzus „3 sessions are" — hlásenie sa číta, nie parsuje. */
const kus = (n, jedno, viac) => (n === 1 ? `1 ${jedno} is` : `${n} ${viac} are`);

/*
  Ktoré relácie nie sú v archíve — množiny, nie počty.

  Porovnávali sa počty a kľúč projektu si tento súbor odvodzoval po svojom, čo
  bola tretia kópia tej istej funkcie. Oboje je odteraz v `kde.mjs`: počet
  nepovie, ktorá relácia chýba, a rozchádzajúce sa definície kľúča sú presne
  to, pred čím ten súbor varuje.

  Prebiehajúca relácia sa nepočíta. Keď hostiteľ jej ID nepodal — ručný beh,
  starší Claude Code — vypadne namiesto nej všetko, čo sa hýbalo v poslednej
  pol hodine. Je to hrubšie, ale správnym smerom: hook, ktorý raz za čas
  zamlčí čerstvú reláciu, je lepší než hook, ktorý klame vždy.
*/
const NEDAVNO_MS = 30 * 60 * 1000;
const vZdroji = prepisyVZdroji(CESTY.zdroj.cesta);
const zarchivovane = new Set(prepisy.map((f) => f.replace(/\.md$/, '')));
const chybaju = vZdroji.filter((x) => {
  if (zarchivovane.has(x.id)) return false;
  if (TATO_RELACIA) return x.id !== TATO_RELACIA;
  return Date.now() - x.zmenene > NEDAVNO_MS;
});
if (chybaju.length) {
  zaostava.push(`${kus(chybaju.length, 'session', 'sessions')} not in the archive yet — /memex:archive`);
}

/*
  Relácia, ktorá po zarchivovaní pokračovala.

  Toto archív nevidel vôbec: porovnávalo sa, ktoré relácie existujú, nie kam v
  nich archív došiel. Relácia pritom beží ďalej po tom, čo ju `SessionEnd`
  spracoval — namerané tu, 443 zarchivovaných riadkov proti 513 v zdroji, teda
  štyri minúty rozhovoru, ktoré v pamäti nie sú a nič to nehlásilo.

  Porovnáva sa veľkosť v bajtoch, ktorú si archivátor zapisuje pri potvrdení.
  Je to jeden `stat` na reláciu, žiadne čítanie. Stav bez `bytes` je spred
  tejto verzie a preskočí sa — archív sa tým nezneistí, len sa o ňom zatiaľ
  nedá povedať viac.
*/
const STAV = join(CESTY.archive, '.state.json');
if (existsSync(STAV)) {
  try {
    const stav = JSON.parse(readFileSync(STAV, 'utf8'));
    const narastene = vZdroji.filter(
      (x) => x.id !== TATO_RELACIA && Number.isFinite(stav[x.id]?.bytes) && x.bajtov > stav[x.id].bytes,
    );
    if (narastene.length) {
      const kolko = narastene.length === 1 ? '1 archived session has' : `${narastene.length} archived sessions have`;
      zaostava.push(`${kolko} grown since — /memex:archive`);
    }
  } catch { /* Poškodený stav rieši archivátor hlasno; hook kvôli nemu nemlčí o zvyšku. */ }
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
      const kolko = novsie === 1 ? '1 transcript has' : `${novsie} transcripts have`;
      zaostava.push(`${kolko} changed since the index was built — memex/scripts/search.mjs --index`);
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

/*
  `--treba-destilovat` — spínač pre plánovanú úlohu, nie pre človeka.

  Vypíše jednu vetu a skončí s nulou, keď je ukazovateľ aspoň `distilDays` dní
  pozadu; inak mlčí a skončí s jednotkou. Tým sa dá zreťaziť s čímkoľvek, čo
  destiláciu spustí:

      node dobehni.mjs --treba-destilovat && claude -p "/memex:distill" …

  Prečo spínač a nie rovno spustenie: destilácia je jediná časť memexu, ktorá
  stojí modelové tokeny, a nástroj, ktorý ich míňa sám od seba, si to musí dať
  schváliť inde než vo vlastnom kóde. Toto povie „už je čas"; kto to spustí a
  za koľko, rozhoduje ten, kto tú úlohu založil.
*/
if (process.argv.includes('--treba-destilovat')) {
  const DNI = Number(CESTY.volby.distilDays ?? 3);
  if (slepota && slepota.dnovDozadu >= DNI) {
    console.log(`trail is ${slepota.dnovDozadu} days behind (${slepota.pocet} transcripts, oldest ${slepota.odkedy})`);
    process.exit(0);
  }
  process.exit(1);
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
