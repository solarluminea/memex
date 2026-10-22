/** Bezpečný zápis archívu: pôvodné riadky zostávajú, opakovania rozlišuje identita udalosti. */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, openSync, closeSync, unlinkSync, readSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const normalizuj = t => t.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
const hlavička = /^## (?:USER|CLAUDE|CODEX) - (?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\?)(?: <!-- memex:([a-f0-9]{24,64}) -->)?\r?$/gm;
/*
  Hlavička ťahu od iného archivára.

  Niektoré projekty majú vlastný archivár s vlastným formátom (`## TY ·`,
  `## JA ·`) a píše do tých istých súborov. Memex ich vidieť nemôže — `hlavička`
  ich nezachytí — takže cudzí ťah sa pri čítaní prilepí k predošlému memexovému
  záznamu. Ten potom nesedí so zdrojom a pôvodný ťah sa pripíše druhýkrát.

  Overené na tomto scenári: po strate stavu bol jeden ťah v prepise dvakrát.
  Na skutočnom projekte to bolo horšie — 55 016 cudzích ťahov proti 3 716
  vlastným a prepis narástol zo 172 383 na 345 646 riadkov.

  Rieši sa to tak, ako v 0.19.0: taký prepis sa nechá na pokoji. Zámerne sa
  hľadá len tento úzky tvar, nie každý nadpis — `## Prečo tak` si Claude píše
  v odpovediach bežne a kvôli tomu sa kedysi preskakovali zdravé prepisy.
*/
const cudzíŤah = /^## (?:TY|JA) · /m;
const odtlačok = t => createHash('sha256').update(t).digest('hex');
// Skrátený odtlačok šetrí text v čítaných rozsahoch; stav celého súboru používa plný SHA-256.
const identita = (j, riadok) => odtlačok(JSON.stringify([j.uuid ?? `riadok:${riadok}`, j.type, j.message])).slice(0, 24);

function prepis(text) {
  const hlavy = [...text.matchAll(hlavička)];
  return hlavy.map((h, i) => ({
    id: h[1]?.slice(0, 24) || null,
    text: normalizuj(text.slice(h.index, hlavy[i + 1]?.index ?? text.length).replace(/ <!-- memex:[a-f0-9]{24,64} -->/, '')),
  }));
}

/*
  Ako starý môže byť zámok, kým sa mu prestane veriť.

  `process.kill(pid, 0)` na Windowse nerozlišuje spoľahlivo: pre proces, ktorý
  už neexistuje, vie vrátiť EPERM namiesto ESRCH, a PID sa po čase pridelí
  inému procesu. Na skutočnom projekte zostal zámok s PID z predošlého dňa,
  tasklist ten proces nepoznal, `kill` vracal EPERM — a archivácia siedmich
  relácií padala, kým zámok nezmazal človek.

  Archivácia trvá sekundy, aj pri prepise s pol druha gigabajta minútu. Zámok
  starší než pol hodiny teda nedrží nikto, kto ešte pracuje.
*/
const ZAMOK_STARY_MS = 30 * 60_000;
const vekSuboru = (c) => { try { return Date.now() - statSync(c).mtimeMs; } catch { return 0; } };

function zamkni(cesta) {
  const značka = JSON.stringify({ pid: process.pid, token: randomUUID() });
  for (let pokus = 0; pokus < 2; pokus++) {
    try {
      const fd = openSync(cesta, 'wx');
      try { writeFileSync(fd, značka); } finally { closeSync(fd); }
      return () => { if (existsSync(cesta) && readFileSync(cesta, 'utf8') === značka) unlinkSync(cesta); };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Zámok po ukončenom procese možno obnoviť; nečitateľný zámok nezmažeme naslepo.
      let vlastník;
      try { vlastník = JSON.parse(readFileSync(cesta, 'utf8')); } catch { throw new Error(`Nečitateľný zámok archívu: ${cesta}`); }
      if (!Number.isInteger(vlastník.pid) || vlastník.pid <= 0) throw new Error(`Neplatný vlastník zámku: ${cesta}`);
      let mrtvy = false;
      try { process.kill(vlastník.pid, 0); }
      catch (chyba) {
        if (chyba.code === 'ESRCH') mrtvy = true;
        else if (chyba.code !== 'EPERM') throw chyba;
      }
      // Živý alebo nejasný vlastník sa rešpektuje, kým je zámok čerstvý.
      if (!mrtvy && vekSuboru(cesta) < ZAMOK_STARY_MS) {
        throw new Error(`Archív práve spracúva proces ${vlastník.pid}. Skúste to po jeho dokončení.`);
      }
      if (pokus > 0) throw new Error(`Zámok archívu sa nepodarilo obnoviť: ${cesta}`);
      // Dva procesy nesmú pri obnove odstrániť čerstvý zámok toho druhého.
      const obnova = `${cesta}.obnova`;
      // Obnova trvá milisekundy; jej zvyšok po spadnutom behu by inak blokoval navždy.
      if (existsSync(obnova) && vekSuboru(obnova) > 60_000) unlinkSync(obnova);
      const fd = openSync(obnova, 'wx');
      try {
        const aktuálny = existsSync(cesta) ? JSON.parse(readFileSync(cesta, 'utf8')) : null;
        if (aktuálny?.pid === vlastník.pid && aktuálny?.token === vlastník.token) unlinkSync(cesta);
      } finally { closeSync(fd); unlinkSync(obnova); }
    }
  }
}

/*
  Riadky zdroja s bajtom, na ktorom končia — a s tým, či sú dopísané.

  `readline` nehovorí ani jedno. Bez polohy v bajtoch sa každý beh musel
  prečítať od začiatku: na skutočnom projekte 4,1 GB prepisov pri každom
  zatvorení okna, 8,3 s aj vtedy, keď nebolo nič nové, a jediná relácia mala
  1,5 GB. A bez vedomia, či je riadok ukončený, sa nedalo rozlíšiť riadok,
  ktorý sa práve zapisuje, od riadku, ktorý je pokazený navždy.
*/
async function* riadkyZdroja(cesta, zaciatok) {
  let zvysok = Buffer.alloc(0), poz = zaciatok;
  for await (const kus of createReadStream(cesta, { start: zaciatok })) {
    const buf = zvysok.length ? Buffer.concat([zvysok, kus]) : kus;
    let od = 0, i;
    while ((i = buf.indexOf(10, od)) !== -1) {
      const koniec = i > od && buf[i - 1] === 13 ? i - 1 : i;
      poz += i + 1 - od;
      yield { r: buf.toString('utf8', od, koniec), bajt: poz, ukonceny: true };
      od = i + 1;
    }
    zvysok = buf.subarray(od);
  }
  if (zvysok.length) yield { r: zvysok.toString('utf8'), bajt: poz + zvysok.length, ukonceny: false };
}

function bajtNa(cesta, poz) {
  const fd = openSync(cesta, 'r');
  try {
    const b = Buffer.alloc(1);
    return readSync(fd, b, 0, 1, poz) === 1 ? b[0] : -1;
  } finally { closeSync(fd); }
}

function atomicky(cesta, text) {
  const dočasný = `${cesta}.${process.pid}.tmp`;
  try { writeFileSync(dočasný, text, 'utf8'); renameSync(dočasný, cesta); }
  finally { if (existsSync(dočasný)) unlinkSync(dočasný); }
}

/*
  `súbory` je zoznam absolútnych ciest namiesto celého priečinka `zdroj`.

  Claude Code drží prepisy projektu v jednom priečinku, Codex ich rozhadzuje
  po dňoch do `~/.codex/sessions/RRRR/MM/DD/` spolu so všetkými ostatnými
  projektmi. Výber, ktoré patria sem, robí adaptér; archivátor len zapisuje.
  `kľúčPre` dá prepisu meno v archíve — Codex potrebuje predponu, aby sa jeho
  relácia nikdy nezrazila s Claudovou pod rovnakým identifikátorom.
*/
export async function archivuj({ zdroj, súbory: zoznam, kľúčPre, cieľ, projekt, ticho, preved }) {
  const odomkni = zamkni(join(cieľ, '.archive.lock'));
  try {
    const stavCesta = join(cieľ, '.state.json');
    let stav = {};
    if (existsSync(stavCesta)) {
      try { stav = JSON.parse(readFileSync(stavCesta, 'utf8')); }
      catch { throw new Error(`Poškodený stav ${stavCesta}. Archív zostal nezmenený.`); }
    }
    const súbory = zoznam ?? readdirSync(zdroj).filter(f => f.endsWith('.jsonl')).map(f => join(zdroj, f));
    let nové = 0, znakov = 0, upravených = 0, opakovaní = 0;
    for (const cesta of súbory) {
      const súbor = basename(cesta), kľúč = kľúčPre ? kľúčPre(cesta) : basename(súbor, '.jsonl');
      const výstup = join(cieľ, `${kľúč}.md`);
      /*
        Relácia, na ktorej sa od posledného behu nič nezmenilo, sa nečíta.

        Zdroj má tú istú veľkosť, ktorú archivátor videl pri poslednom celom
        prečítaní, a prepis tú, ktorú vtedy zapísal. Väčšina relácií je pri
        zatvorení okna presne taká — mení sa jedna, zvyšné šesťdesiat nie.
      */
      const s0 = stav[kľúč];
      let veľkosťZdroja = 0;
      try { veľkosťZdroja = statSync(cesta).size; } catch { /* zmizol — prejde sa bežnou cestou a nahlási */ }
      if (Number.isFinite(s0?.offset) && s0.bytes === veľkosťZdroja && s0.offset === veľkosťZdroja
        && existsSync(výstup) && statSync(výstup).size === s0.mdBytes) continue;
      const pôvodný = existsSync(výstup) ? readFileSync(výstup, 'utf8') : '';
      const záznamy = prepis(pôvodný);
      if (pôvodný && (!pôvodný.startsWith(`---\nsession: ${kľúč}\n`) && !pôvodný.startsWith(`---\r\nsession: ${kľúč}\r\n`))) {
        console.error(`! ${kľúč}: neznámy formát archívu, súbor sa nemení.`); process.exitCode = 1; continue;
      }
      if (cudzíŤah.test(pôvodný)) {
        console.error(`! ${kľúč}: v prepise sú ťahy iného archivára, súbor sa nemení.`);
        console.error(`  Vyberte jeden archivár: zastavte ten druhý, alebo memexu určte iný priečinok.`);
        process.exitCode = 1; continue;
      }
      // Ak stav zaostáva po prerušení, značky už zapísaných udalostí zabránia opakovaniu.
      const videné = new Set(záznamy.map(x => x.id).filter(Boolean));
      const staré = záznamy.filter(x => !x.id);
      /*
        Čo z prepisu spred značiek treba pri strate stavu ešte nájsť v zdroji.

        Porovnáva sa nepresne — súvislá postupnosť bielych znakov je jedna
        medzera. Prevodník sa medzi verziami hýbe (0.19.0 orezávala koniec bloku
        volaní, refaktor to stratil) a taký rozdiel nesmie znamenať, že prepis
        prestane sedieť so zdrojom. Namerané na archíve s 1117 ťahmi: jediný
        useknutý príkaz Basha zrazil zhodu v poradí na 378 a prepis sa zamkol.

        Presné poradie sa nevyžaduje, stačí počet: úloha je zistiť, čo v prepise
        ešte nie je, nie kde presne to leží.
      */
      const zhruba = (t) => t.replace(/\s+/g, ' ').trim();
      const zvyšné = new Map();
      for (const z of staré) { const k = zhruba(z.text); zvyšné.set(k, (zvyšné.get(k) ?? 0) + 1); }
      const overenéStaré = new Set();
      const zhodnýStav = pôvodný && stav[kľúč] && (!stav[kľúč].hash || stav[kľúč].hash === odtlačok(pôvodný));
      const od = zhodnýStav ? stav[kľúč].lines ?? 0 : 0;
      let riadok = 0, potvrdené = 0, deň = stav[kľúč]?.day || '', chyba = false;
      const prírastky = [];
      const zlyhania = new Set(od ? [...pôvodný.matchAll(/^\[Failed\] (.*)$/gm)].map(m => m[1]) : []);
      /*
        Veľkosť zdroja pred čítaním, aby sa dalo zistiť, že prepis zaostal.

        Relácia môže pokračovať po tom, čo ju `SessionEnd` zarchivoval — okno
        sa zavrie neskôr, alebo hook dobehne skôr než posledný ťah. Namerané na
        tomto archíve: stav 443 riadkov proti 513 v zdroji, teda štyri minúty
        rozhovoru mimo archívu. Nevidela to ani kontrola stavu, ani hook: oba
        porovnávajú, ktoré relácie existujú, nie kam v nich archív došiel.

        Meria sa **pred** čítaním zámerne. Keď súbor medzitým narastie, uloží
        sa menšie číslo a ďalšia kontrola správne povie „zaostáva"; opačné
        poradie by rozdiel zamlčalo.
      */
      const bajtovPred = statSync(cesta).size;
      /*
        Čítanie od miesta, kde sa minule skončilo.

        Platí len pri zhodnom stave, úplne označkovanom prepise a keď bajt pred
        uloženou polohou je naozaj koniec riadka. Inak sa číta od začiatku ako
        doteraz — pomalšie, ale bez predpokladov.
      */
      let začiatok = 0;
      if (od && !staré.length && Number.isFinite(s0?.offset) && s0.offset > 0 && s0.offset <= bajtovPred) {
        try { if (bajtNa(cesta, s0.offset - 1) === 10) začiatok = s0.offset; } catch { /* od začiatku */ }
      }
      if (začiatok) { riadok = od; potvrdené = od; }
      let potvrdenýBajt = začiatok, poškodených = 0, prvýPoškodený = 0;
      for await (const { r, bajt, ukonceny } of riadkyZdroja(cesta, začiatok)) {
        riadok++;
        if (!r.trim()) { if (ukonceny) { potvrdené = riadok; potvrdenýBajt = bajt; } continue; }
        /*
          Pokazený riadok, ktorý sa už nikdy neopraví.

          Neplatný JSON na konci súboru je riadok, ktorý sa práve zapisuje, a
          skúsi sa nabudúce. Ukončený neplatný riadok — s ďalšími za sebou — sa
          už nedopíše nikdy. Doteraz sa medzi nimi nerozlišovalo a archív na
          takom riadku zastal **natrvalo**: na skutočnom projekte 252 025
          nulových bajtov po páde stroja 15. 10. a odvtedy z najdlhšej relácie
          neprišlo do archívu nič — 78 tisíc riadkov, týždeň práce. Hlásenie
          „ďalší beh skúsi tento riadok znova" bolo pravdivé a bezcenné.
        */
        if (ukonceny && /^\0+$/.test(r)) {
          poškodených++; prvýPoškodený ||= riadok; potvrdené = riadok; potvrdenýBajt = bajt; continue;
        }
        /*
          Už spracovaný riadok sa neparsuje, ak je prepis celý označkovaný.

          Parsovať ho treba len kvôli identitám, ktoré v prepise zapísané nie sú
          — a to je práve archív spred 0.20.0. Keď má každá hlavička značku, je
          `videné` poskladané z nich a `JSON.parse` nad celým JSONL pri každom
          behu hooku je práca navyše. Rastie s dĺžkou relácie, nie s prírastkom.
        */
        /*
          Potvrdzuje sa len ukončený riadok. Posledný riadok bez konca sa
          spracuje hneď, ale poloha za neho nejde: ďalší beh ho prečíta znova
          a značka udalosti v prepise zabráni tomu, aby sa zapísal dvakrát.
        */
        const potvrď = () => { if (ukonceny) { potvrdené = riadok; potvrdenýBajt = bajt; } };
        if (riadok <= od && !staré.length) { potvrď(); continue; }
        let j;
        try { j = JSON.parse(r); }
        catch {
          if (ukonceny) { poškodených++; prvýPoškodený ||= riadok; potvrď(); continue; }
          console.error(`! ${súbor}:${riadok}: neúplný JSON na konci súboru; ďalší beh skúsi tento riadok znova.`);
          chyba = true; break;
        }
        if (riadok <= od) {
          // Aj staré prepisy bez značiek môžu mať neskôr v JSONL zopakované udalosti.
          if (j.uuid) videné.add(identita(j, riadok));
          potvrď(); continue;
        }
        const text = preved(j, zlyhania);
        potvrď();
        if (!text) continue;
        if (!deň && j.timestamp) deň = j.timestamp.slice(0, 10);
        // Bez uuid sa neodhadujú duplicity podľa podobnosti zredukovaného textu.
        const id = identita(j, riadok);
        if (videné.has(id)) { opakovaní++; continue; }
        /*
          Staré archívy nemajú identity, tak sa poloha obnoví podľa obsahu.

          Kým je čo hľadať, každý ťah zo zdroja buď odškrtne jeden záznam
          prepisu, alebo je opakovaním niečoho už odškrtnutého — a v oboch
          prípadoch v prepise už stojí. Čo neplatí ani jedno, sa pripíše.

          Nezhoda nesmie beh zastaviť. Predtým zastavila a záznam o relácii sa
          do stavu nezapísal, takže ďalší beh narazil na to isté: prepis bol
          odvtedy navždy len na čítanie. Tichá strata pamäte je horšia porucha
          než ťah pripísaný na koniec namiesto do stredu — a pripísať na koniec
          je aj tak jediná možnosť, lebo vsúvanie do stredu by posunulo riadky,
          na ktoré ukazuje celý ukazovateľ.
        */
        if (!od && zvyšné.size) {
          const k = zhruba(normalizuj(text));
          const koľko = zvyšné.get(k) ?? 0;
          if (koľko) {
            if (koľko === 1) zvyšné.delete(k); else zvyšné.set(k, koľko - 1);
            overenéStaré.add(k);
            videné.add(id);
            continue;
          }
          if (overenéStaré.has(k)) { videné.add(id); opakovaní++; continue; }
        }
        videné.add(id);
        prírastky.push(text.replace(/^(\n*## [^\n]+)/, `$1 <!-- memex:${id} -->`));
      }
      if (riadok < od) {
        console.error(`! ${kľúč}: zdroj nesúhlasí so zachovaným archívom; nič sa neprepísalo.`);
        process.exitCode = 1; continue;
      }
      /*
        Hlási sa nahlas, ale prepis sa nezahadzuje ani nezamyká.

        Toto znamená, že zdroj už neobsahuje ťahy, ktoré v prepise sú — buď sa
        JSONL skrátil, alebo ho prepísal iný nástroj. Archív je jediná kópia,
        takže sa z neho neuberá; dopíše sa len to, čo v ňom nie je, a značky
        zaručia, že ďalší beh už porovnávať obsah nemusí.

        Po prerušenom čítaní sa nehlási nič: nedočítaný zdroj pochopiteľne
        nemá čím pokryť zvyšok prepisu a hlásenie by ukazovalo na nesprávnu
        príčinu. Tá už bola vypísaná pri tom zlom riadku.
      */
      if (!od && zvyšné.size && !chyba) {
        const koľko = [...zvyšné.values()].reduce((a, b) => a + b, 0);
        console.error(`! ${kľúč}: ${koľko} ťahov prepisu sa v zdroji nenašlo; prepis zostáva, pripísalo sa len nové.`);
        process.exitCode = 1;
      }
      const dátum = deň || statSync(cesta).mtime.toISOString().slice(0, 10);
      const základ = pôvodný || `---\nsession: ${kľúč}\nproject: ${projekt}\ndate: ${dátum}\n---\n\n# Session ${dátum}\n`;
      const pridané = prírastky.join('');
      const hotové = základ + pridané;
      if (hotové !== pôvodný) atomicky(výstup, hotové);
      // Poradie je podstatné: najprv celý prepis, potom poloha. Staré riadky sa nemenia.
      // `bytes` sa zapíše len po celom prečítaní: po prerušenom čítaní by tvrdilo,
      // že je pokryté aj to, čo sa nedočítalo.
      // `offset` je bajt za posledným potvrdeným riadkom, `mdBytes` veľkosť zapísaného
      // prepisu — z oboch sa nabudúce pozná relácia, ktorú netreba čítať.
      stav[kľúč] = {
        lines: potvrdené, day: dátum, hash: odtlačok(hotové), offset: potvrdenýBajt,
        mdBytes: Buffer.byteLength(hotové, 'utf8'), ...(chyba ? {} : { bytes: bajtovPred }),
      };
      atomicky(stavCesta, JSON.stringify(stav, null, 2) + '\n');
      if (poškodených) {
        console.error(`! ${súbor}: ${poškodených} pokazených riadkov preskočených (prvý ${prvýPoškodený}) — ukončené, ale nie JSON, napr. nulové bajty po páde stroja.`);
      }
      nové += prírastky.length; znakov += pridané.length; if (pridané) upravených++;
      if (chyba) process.exitCode = 1;
    }
    if (!ticho || upravených) console.log(`Relácií: ${súbory.length}, aktualizovaných: ${upravených}\nNových ťahov: ${nové}, znakov: ${znakov}, opakovaných udalostí: ${opakovaní}\nArchív: ${cieľ}`);
  } finally { odomkni(); }
}
