# Plán merania: koľko stoja výstupy nástrojov a čo sa dá ušetriť

Vznikol z porovnania s `context-mode` (2026-09-09). Jeho myšlienka je, že model
nemá čítať surový výstup, ale napísať skript, ktorý ho spracuje mimo kontextu.
Otázka nie je, či je myšlienka správna — je. Otázka je, **koľko by na našich
dátach ušetrila a čo by pritom pokazila**.

Preto má každý kandidát dve merania, nie jedno:

- **Koľko ušetrí.** Spočítateľné zo surových transkriptov, bez volania modelu.
- **Či práca aj tak dobehne.** Bez tohto je meranie bezcenné. Vlastný benchmark
  tohto projektu našiel, že sumarizácia neklame — **ztíchne**. Téma tam je,
  konkrétny fakt zmizol, a nikomu to nechýba, lebo nič *nevyzerá* chýbajúce.
  Zúžený výstup nástroja je presne tá istá operácia s tým istým rizikom.

Zmena, ktorá má len prvé číslo, sa neprijíma. Úspora bez dôkazu dostatočnosti
je to, čo sa v tomto projekte už raz zmeralo ako 90 % a v izolácii to bolo 55 %.

> **Zmerané 2026-09-09, okrem obrázkov. Všetci traja kandidáti prepadli** —
> každý na inom čísle a každý z iného dôvodu. Výsledky sú na konci dokumentu.
>
> ⚠ **Pozor na jeden nález, ktorý tu chvíľu stál a bol nepravdivý:** že stopa
> ani archív na tomto stroji neexistujú. Neexistovali len na predvolených
> cestách. `ponuka-app` má `memex.json`, ktorý ich presmeroval do `docs/`, a je
> tam 82 prepisov a 260 tém. Rozbor omylu je na konci.

---

## Odkiaľ berieme dáta

Surové transkripty v `~/.claude/projects/<projekt>/*.jsonl`. Merané
2026-09-09 na projekte `ponuka-app`, **84 transkriptov**:

| zdroj | volaní | výstupy spolu | z toho nad 5 kB |
|---|---|---|---|
| Read obrázky | 503 | 109 MB base64 | — |
| Bash | 38 100 | 34,6 MB | 780 volaní = 6,5 MB |
| Read text | 1 447 | 3,3 MB | 162 volaní = 1,7 MB |
| MCP Make | ~50 | 1,7 MB | takmer všetky |
| Grep, WebFetch, Agent | ~620 | 0,8 MB | 23 volaní = 0,2 MB |

Na porovnanie samotný Memex, 3 transkripty: Bash 566 kB, z toho 11 volaní nad
5 kB = 99 kB. **Rozdiel je stonásobný**, takže plán sa robí na `ponuka-app` a
Memex je jeho kontrola — zmena, ktorá pomôže tam aj tu, je zmena; zmena, ktorá
pomôže len na jednom projekte, je vlastnosť toho projektu.

---

## Nález, ktorý zmenil zadanie

Prvé odporúčanie z rozhovoru bolo: *pravidlo do CLAUDE.md, aby sa dlhé výstupy
rúrovali cez `head`*. Po rozbalení príkazov (veľká časť má pred sebou `cd …&&`,
takže agregát podľa prvého slova ukazuje `cd`) to vyzerá inak:

| skutočný príkaz | volaní nad 5 kB | objem | priem. riadkov | už rúrovaných |
|---|---|---|---|---|
| `sed -n` | 267 | 1 864 kB | 181 | 10 |
| `echo "===` | 31 | 239 kB | 166 | 15 |
| `cat -n` | 19 | 189 kB | 238 | 3 |
| `grep -rn` | 15 | 141 kB | 117 | 14 |
| `cat <súbor>` | ~25 | ~390 kB | 333–543 | 3 |
| `wc -l` | 12 | 108 kB | 231 | 0 |

`sed -n` je 29 % veľkých volaní a najväčší jediný zdroj. To **nie je ušlý
výstup — to je čítanie zdrojového kódu**, ktoré si režim práce priamo vyžiada
(„read files with cat, head, or sed -n"). Rúrovať to cez `head` by znamenalo
odrezať kód, ktorý si model vyžiadal úmyselne.

Takže pravidlo o rúrovaní je zamietnuté ešte pred testom, a na jeho mieste
stojí iná otázka: **nie ako výstup skrátiť, ale prečo bolo treba čítať 181
riadkov.** Na to má tento projekt nástroj — mapu — a to sa dá zmerať.

---

## Kandidát A — Zúženie čítania: 181 riadkov na koľko upravených?

Najväčší objem, a je to otázka o Memexe, nie o `context-mode`.

**Meranie.** Pre každé veľké čítanie (`sed -n`, `cat`, `cat -n`) nájdi v tom
istom transkripte najbližšiu následnú `Edit` v tom istom súbore. Zapíš:

1. koľko riadkov sa prečítalo a koľko riadkov `Edit` naozaj zmenil,
2. či zmenené riadky ležali **vnútri** prečítaného rozsahu.

**Čo rozhoduje.** Medián podielu prečítané : zmenené. Pri 181 : 8 je rezerva
dvadsaťnásobná. Druhé číslo je poistka: podiel úprav *mimo* prečítaného rozsahu
— to sú prípady, kde by zúženie čítanie pokazilo.

**Spúšťač na stavbu:** medián podielu nad 10 **a** podiel úprav mimo rozsahu
pod 10 %.

**Ako sa toto meranie môže zmýliť v náš prospech.** Číta sa aj pre porozumenie,
nie len pre úpravu. Osemriadková zmena môže legitímne potrebovať 180 riadkov
kontextu, a potom podiel 20 : 1 nie je plytvanie, ale správna práca. Podiel sám
teda nič nedokazuje. Kontrola: či nasledujúca odpoveď modelu odkazuje na obsah
**mimo** zmenených riadkov. Kde neodkazuje, tam bola široká čítačka naozaj
zbytočná.

---

## Kandidát B — Zúžený výstup z Make

Najdrahšie na jedno volanie a jediné miesto, kde by `context-mode` naozaj
pomohol — ale nevie, lebo jeho sandbox nevidí tvoje konektory. Musí sa spraviť
ručne.

Merané: `scenarios_get` 30 volaní, medián 33 kB, max 72 kB. `scenarios_list`
9 volaní, medián 45 kB. `executions_list` 5 volaní, medián 27 kB. Jedno volanie
je 8 až 20 tisíc tokenov.

**Meranie úspory sa robí na sedenie, nie v súčte.** 1,7 MB delené 84 sedeniami
je zanedbateľných 20 kB, ale Make sa použil v hŕstke sedení a tam bol
dominantný. Zmena, ktorá nespraví nič v osemdesiatich sedeniach a ušetrí 40 %
vstupu v štyroch, sa vyplatí — pokiaľ tie štyri boli tie, čo narazili na
strop.

**Meranie dostatočnosti.** Pre každý výstup `scenarios_get` vytiahni názvy polí
z JSON-u, potom skontroluj, ktoré z nich sa vyskytujú v nasledujúcich troch
správach modelu. To je množina polí, ktoré sa **naozaj použili**. Kandidátsky
súhrn (názvy modulov, ich typ, stav, prepojenia) musí túto množinu pokryť.

**Spúšťač na stavbu:** súhrn pokrýva aspoň 90 % skutočne použitých polí **a** v
sedeniach s Make je jeho výstup aspoň 10 % vstupu.

**Ako sa toto meranie môže zmýliť v náš prospech.** Pole sa mohlo použiť na
rozhodnutie bez toho, aby ho model odcitoval. Pokrytie podľa výskytu v texte
teda dostatočnosť **nadhodnocuje**. Preto sa tri najväčšie prípady prečítajú
ručne, nie štatisticky.

---

## Kandidát C — Obrázky: najväčšia položka, najhoršie testovateľná

503 obrázkov, 109 MB base64, medián 207 kB. V tokenoch sa obrázok neúčtuje po
bajtoch, ale po rozmeroch, približne šírka × výška / 750. Pri snímke obrazovky
je to rádovo 1 500 až 2 000 tokenov, teda spolu asi 700 tisíc — okolo **8 tisíc
tokenov na sedenie**, viac ako čokoľvek textové.

**Meranie.** Rozmery sa dajú prečítať z hlavičky PNG, čo je 24 bajtov po
dekódovaní, takže presný tokenový súčet je lacný. Druhá otázka: koľko snímok
bolo takmer duplikátom predchádzajúcej v tom istom sedení — rovnaké rozmery a
podobná veľkosť znamená pravdepodobne opakovanú snímku po malej zmene.

**Prečo tu nie je spúšťač na stavbu.** Dostatočnosť sa u obrázkov spätne zmerať
nedá. Nevieme z transkriptu zistiť, či by menšia snímka stačila na ten istý
záver, a hádať to je presne ten druh úsudku, ktorý tento projekt inde zamieta.
Preto kandidát C **zostáva meraním**, nie zmenou. Až keď bude presné číslo,
bude sa dať povedať, či sa oň vôbec stojí pokúšať.

---

## Kandidát D — Trigramový tokenizér (jediná vec prevzatá z context-mode)

`context-mode` skladá Porterov stemming s trigramovým indexom a spája výsledky
cez reciprocal rank fusion. Stemming je pre slovenčinu nepoužiteľný, ale
trigramový tokenizér FTS5 by riešil skloňovanie — `žiadosť`, `žiadosti`,
`žiadostiach` — bez slovníka a bez závislostí.

**Infraštruktúra už existuje**, takže toto je najlacnejší test zo štyroch:
`bench.mjs pamat` meria presne to, čo treba (nájde hľadanie pasáž, na ktorú
ukazuje ukazovateľ), `MEMEX_ABLATE` odstaví jednotlivé vylepšenia a
`BENCH_SKIP` rozdelí sadu na polovice.

**Meranie.** Pridať ablačný prepínač `trigram`, potom:

| čo | čím |
|---|---|
| výťažnosť | `bench.mjs pamat`, obe polovice |
| cena na presnosti | `bench.mjs pravda` — trigram pasuje aj vnútro slova |
| veľkosť indexu | `.search.db` pred a po |
| čas prestavby | `time node scripts/search.mjs --index` |

**Spúšťač na stavbu:** výťažnosť vyššia aspoň o 3 body **na oboch polovicách**,
strata presnosti pod 2 body, index nie viac než dvojnásobný, prestavba stále
pod 3 sekundy (dnes 1,2 s — to je hranica, za ktorou sa začne riešiť
inkrementálny index, a nemá zmysel ju prekročiť kvôli tokenizéru).

**Ako sa toto meranie môže zmýliť v náš prospech.** Kľúč pre `pamat` tvoria
nadpisy ukazovateľov, ktoré model písal s otvoreným transkriptom — delia teda s
pasážou slovnú zásobu vrátane tvarov slov. Skutočná otázka od človeka je
skloňovaná inak. Test tak **podhodnocuje** prínos trigramu, čo je bezpečný
smer, ale znamená, že zamietnutie treba brať s rezervou. Kontrola: druhá sada
otázok, prepísaná do iných tvarov než nadpis.

---

## Čo sa netestuje a prečo

**PreCompact snímka stavu.** Navrhnutá a v tom istom rozhovore zamietnutá.
Kompakcia už zanecháva súhrn, ich snímka je druhý súhrn, a vlastné meranie
tohto projektu hovorí, že súhrny stratia práve konkrétny fakt. Navyše Claude
Code po kompakcii nezahodí obsah zo súboru transkriptu — zapíše doň hranicu a
súhrn — takže archív po kompakcii dieru nemá a značka nemá čo označovať.

**Sandbox `ctx_execute` ako taký.** Neprepája cudzie MCP servery, takže na
najdrahšie volania v tomto projekte nemá kam smerovať. Jeho hranica je 5 kB, a
28 z 34 MB nášho výstupu z Bash prejde v kúskoch pod ňou.

**Pravidlo o rúrovaní výstupov.** Zamietnuté nálezom vyššie: 29 % veľkých
volaní je úmyselné čítanie kódu.

---

## Poradie a čo to stojí

| # | kandidát | potrebuje | tokeny modelu |
|---|---|---|---|
| 1 | D — trigram | ablačný prepínač, ~20 riadkov | žiadne |
| 2 | A — zúženie čítania | nový skript nad transkriptami | žiadne |
| 3 | B — Make | ten istý skript + 3 prípady ručne | pár tisíc |
| 4 | C — obrázky | čítanie hlavičiek PNG | žiadne |

Prvé tri sa dajú zmerať bez toho, aby model niečo generoval, čo je celý dôvod
tohto poradia. Jeden nový nástroj, `scripts/vystupy.mjs`, pokrýva A, B aj C:
prejde surové transkripty, vypíše cenu výstupu na sedenie a na nástroj, a v
režime `--co-ak` aplikuje kandidátske zúženie a vypíše **obe** čísla — úsporu aj
to, či použitý obsah prežil.

**Spoločné pravidlo.** Každé číslo na oboch polovicách sady. Žiadna zmena sa
neprijíma na súhrne — v tomto projekte už raz vyšlo, že vylepšenie držalo na
jednej polovici a bola to náhoda vydávaná za nález.

---

# Výsledky, merané 2026-09-09

Merané na `ponuka-app` (84 transkriptov) a pri kandidátovi D na vlastnom
archíve Memexu (1 001 úsekov). Nástroj: `scripts/vystupy.mjs`.

## Falošný poplach, a čo sa z neho postavilo

Tu chvíľu stálo, že stopa ani archív neexistujú ani v jednom projekte, a že
z troch častí Memexu beží jedna. **Nie je to pravda.** `ponuka-app` má
`memex.json`:

```json
{ "archive": "docs/archiv-relacii", "trail": "docs/agent-plany/ukazovatel",
  "trailIndex": "docs/agent-plany/UKAZOVATEL.md" }
```

Skutočný stav tam je 82 prepisov, 16,7 MB, index nad 80 z nich, **260 tém a
436 ukazovateľov**. Memex tam beží. Chýba málo: 2 relácie nie sú
zarchivované, index je 2 prepisy pozadu a 5 prepisov nemá záznam v stope.

**Ako omyl vznikol.** Kontrola sa robila príkazmi `ls .memex/` a
`find -name TRAIL.md -o -type d -name trail`, teda hľadaním **predvolených**
názvov. Tento projekt si ich pomenoval po slovensky, takže `find` nemal čo
nájsť. Pritom `kde.mjs` existuje presne na to, aby sa cesty nehádali — a bol v
tej istej relácii prečítaný.

**Čo z toho vzniklo v kóde.** Falošný poplach je iná porucha než tichý súhlas,
ale rovnako drahá: viedol k odporúčaniu zapnúť niečo, čo bežalo. Preto
`status.mjs` teraz vypíše riadok `Config` s tým, kam sú archív a stopa
prestavené, kedykoľvek `memex.json` existuje. Jeden riadok, a tento omyl sa
druhýkrát nestane.

**Čo z pôvodného nálezu platí.** `bench.mjs pamat` sa naozaj nedá spustiť
v samotnom Memexe, lebo ten stopu nemá — ale na `ponuka-app` s 260 témami sa
spustiť dá. Kandidát D sa teda meral na náhradnom kľúči z archívu, hoci nemusel.
To je vec na zopakovanie, nie na prepísanie: hodnotenie kandidáta D znelo
„zamietnuté na veľkosti indexu 3,4×", a to platí bez ohľadu na kľúč.

## Kandidát A — zamietnutý na poistke, nie na pomere

Veľkých čítaní kódu bez rúry: **395**.

| | počet | poznámka |
|---|---|---|
| spárované s úpravou vnútri prečítaného | 89 | tu sa dá počítať pomer |
| úprava toho súboru bola **mimo** prečítaného | 57 | 39 % — poistka prepadla |
| bez následnej úpravy toho súboru | 249 | 1 996 kB, čítanie pre porozumenie |

Pre spárované: prečítaných riadkov medián **210**, upravených medián **5**,
pomer medián **38 : 1** (kvartily 18 a 104).

Prvý spúšťač splnený s veľkou rezervou, druhý prepadol trojnásobne. **Zamietnuté.**

**Overenie, či nejde o artefakt merania.** „Mimo" sa zisťuje hľadaním
`old_string` vo výstupe čítania, takže `cat -n` s predsadenými číslami riadkov
by nikdy nesedel a podiel by umelo nadhodnotil. Rozbor podľa druhu príkazu:

| druh | vnútri | mimo | z mimo sa našiel aspoň prvý riadok |
|---|---|---|---|
| `sed -n` | 41 | 51 | **1** |
| `cat` | 46 | 6 | 4 |
| `cat -n` | 2 | 0 | — |

`cat -n` sú dva prípady, takže artefakt to nie je. A z 51 minutých `sed -n` sa
ani prvý riadok nenašiel v 50 — úprava bola naozaj v inej časti súboru.

**Druhá podoba kandidáta, tiež zamietnutá.** Ak rozsahové čítanie míňa v 55 %
prípadov, čakalo by sa, že sa číta opakovane a cena je v druhom čítaní. Nie je:
veľkých čítaní na jeden upravený súbor je medián **1**, priemer 1,10, viac než
jedno len v **9 %**, a druhé a ďalšie čítania stoja dokopy **51 kB**.

Zostáva teda toto: z 3,0 MB veľkého čítania kódu je **357 čítaní súborov, ktoré
sa nikdy neupravili**. To nie je plytvanie, ktoré by sa dalo odrezať pravidlom.
To je hľadanie a porozumenie, a je to presne to, na čo je mapa.

## Kandidát B — zamietnutý na dostatočnosti

47 veľkých výstupov z Make, spolu 1 769 kB. Súhrn sa nezhadoval, ale postavil a
zvážil:

| nástroj | volaní | kB pôv. | kB súhrn | úspora | pokrytie citovaného |
|---|---|---|---|---|---|
| `scenarios_get` | 29 | 1 228 | 14,1 | 99 % | **23 %** |
| `scenarios_list` | 8 | 368 | 11,9 | 97 % | **79 %** |
| `executions_list` | 5 | 118 | 0,0 | 100 % | 0 % |
| `connections_list` | 1 | 12 | 1,6 | 86 % | 33 % |
| `hooks_list` | 1 | 8 | 0,3 | 96 % | 50 % |

Úspora je obrovská, dostatočnosť nie. Spúšťač 90 % nesplnil ani jeden nástroj.
**Zamietnuté.**

Prečo: model po výstupe pracoval s **hodnotami parametrov**, nie so štruktúrou.
Súhrn stratil veci ako `769715`, `1360998212018409`, `leadIdFb` a slovenské
texty výziev (`zadajte`, `strechu`, `vykurovania`). Kto si vyžiada scenár,
potrebuje jeho nastavenie, nie zoznam modulov.

**Úzka verzia sa preverila a tiež nestačí.** `scenarios_list` s 79 % vyzeral
ako ten prípad, čo sa dá dotiahnuť — stráca len názvy modulov vnútri scenárov.
Súhrn obohatený o názvy modulov a spojení dal **znovu 79 %**. Navyše vzorka je
19 citovaných vecí z 8 volaní, čo je na rozhodovanie o 90 % hranici málo.

**Prvé meranie tohto kandidáta bolo nepravdivé, a v náš prospech.** Účtovalo
bajty pod názvami polí a vyšlo „súhrn zahodí 20 % objemu". `blueprint` obsahuje
`flow`, ten obsahuje `mapper`, takže tie isté bajty sa počítali na každej
úrovni. Preto `vystupy.mjs make` súhrn stavia a váži, a účtovanie polí v ňom
nie je.

## Kandidát D — zamietnutý na dvoch spúšťačoch z troch

Premisa bola slabšia, než sa zdalo: `search.mjs` skloňovanie **už rieši** a má
to zmerané. Pre slová od 7 znakov skladá dotaz ako `("žiadostiach"* OR
"žiadost"*)` — plný tvar a kmeň skrátený o tri znaky. Kandidát D sa teda musel
porovnať s tým, nie s ničím.

Kľúč: z archívu sa vzali páry tvarov toho istého slova, oba sa v ňom naozaj
vyskytujú, a cieľom sú úseky, kde je len druhý tvar a prvý nie. **5 227 úloh.**
Tri vetvy nad identickými úsekmi.

| vetva | zásah | prvá polovica | druhá polovica |
|---|---|---|---|
| dnes (unicode61 + predpona a kmeň) | 35,5 % | 29,8 % | 41,3 % |
| trigram sám | 34,9 % | 29,5 % | 40,4 % |
| zjednotenie oboch | **38,1 %** | 32,4 % | 43,7 % |

Trigram sám je o pol bodu **horší** než dnešný stav. Zjednotenie pridá **+2,6
bodu** a drží na oboch poloviciach (+2,6 a +2,4), takže prínos je pravý, nie
náhoda vo vzorke. Ale spúšťač žiadal 3 body, a index narastie z 1,2 MB na
3,9 MB, teda **3,4×** proti hranici dvojnásobku. Dva spúšťače z troch
nesplnené. **Zamietnuté** — prestavba by pritom bola v poriadku, 0,40 s.

Presnosť sa nemerala. Nebolo treba, rozhodnutie padlo už na výťažnosti a
veľkosti, a trigram pasuje aj vnútro slova, takže presnosť by klesla, nie
stúpla.

## Čo z toho zostáva

Zamietnutie troch kandidátov nie je nulový výsledok, je to ušetrená práca. Za
tri merania bez jediného tokenu modelu:

- **Pravidlo o rúrovaní výstupov** by odrezalo kód, ktorý si model vypýtal
  úmyselne, a v 39 % prípadov je úprava aj tak inde než čítanie.
- **Zúžený výstup z Make** by ušetril 99 % objemu a zahodil hodnoty
  parametrov, s ktorými model potom pracuje.
- **Trigramový tokenizér** dá +2,6 bodu za 3,4× index, a to na probléme, ktorý
  je už riešený lacnejšie.

A namiesto všetkých troch jedna vec, ktorá naozaj chýbala: **hlásenie, ktoré
vydá verdikt.** Kontrola stavu doteraz vypisovala fakty a úsudok nechávala na
čitateľa, takže sa dalo v dobrej viere odpovedať „áno, funguje", aj keď
archív zaostával. Teraz porovnáva archív so zdrojom, varuje pred 30-dňovým
mazaním, vypisuje prestavené cesty a končí nenulovo. Merateľné na tom nie je
percento — merateľné je, že tá otázka sa už nedá zodpovedať odhadom.
