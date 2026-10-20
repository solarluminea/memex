/** Bezpečný zápis archívu: pôvodné riadky zostávajú, opakovania rozlišuje identita udalosti. */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
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
      try { process.kill(vlastník.pid, 0); }
      catch (chyba) {
        if (chyba.code === 'ESRCH' && pokus === 0) {
          // Dva procesy nesmú pri obnove odstrániť čerstvý zámok toho druhého.
          const obnova = `${cesta}.obnova`;
          const fd = openSync(obnova, 'wx');
          try {
            const aktuálny = existsSync(cesta) ? JSON.parse(readFileSync(cesta, 'utf8')) : null;
            if (aktuálny?.pid === vlastník.pid && aktuálny?.token === vlastník.token) unlinkSync(cesta);
          } finally { closeSync(fd); unlinkSync(obnova); }
          continue;
        }
        throw chyba;
      }
      throw new Error(`Archív práve spracúva proces ${vlastník.pid}. Skúste to po jeho dokončení.`);
    }
  }
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
      const čítačka = createInterface({ input: createReadStream(cesta), crlfDelay: Infinity });
      for await (const r of čítačka) {
        riadok++;
        if (!r.trim()) { potvrdené = riadok; continue; }
        /*
          Už spracovaný riadok sa neparsuje, ak je prepis celý označkovaný.

          Parsovať ho treba len kvôli identitám, ktoré v prepise zapísané nie sú
          — a to je práve archív spred 0.20.0. Keď má každá hlavička značku, je
          `videné` poskladané z nich a `JSON.parse` nad celým JSONL pri každom
          behu hooku je práca navyše. Rastie s dĺžkou relácie, nie s prírastkom.
        */
        if (riadok <= od && !staré.length) { potvrdené = riadok; continue; }
        let j;
        try { j = JSON.parse(r); }
        catch {
          console.error(`! ${súbor}:${riadok}: neúplný alebo neplatný JSON; ďalší beh skúsi tento riadok znova.`);
          chyba = true; break;
        }
        if (riadok <= od) {
          // Aj staré prepisy bez značiek môžu mať neskôr v JSONL zopakované udalosti.
          if (j.uuid) videné.add(identita(j, riadok));
          potvrdené = riadok; continue;
        }
        const text = preved(j, zlyhania);
        potvrdené = riadok;
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
      stav[kľúč] = { lines: potvrdené, day: dátum, hash: odtlačok(hotové), ...(chyba ? {} : { bytes: bajtovPred }) };
      atomicky(stavCesta, JSON.stringify(stav, null, 2) + '\n');
      nové += prírastky.length; znakov += pridané.length; if (pridané) upravených++;
      if (chyba) process.exitCode = 1;
    }
    if (!ticho || upravených) console.log(`Relácií: ${súbory.length}, aktualizovaných: ${upravených}\nNových ťahov: ${nové}, znakov: ${znakov}, opakovaných udalostí: ${opakovaní}\nArchív: ${cieľ}`);
  } finally { odomkni(); }
}
