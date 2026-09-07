# Memex ako projektová pamäť Codexu

Podrobný implementačný plán pre spoločnú pamäť Claude Code a Codexu je v [PLAN-INTEGRACIE-CLAUDE-CODEX.md](PLAN-INTEGRACIE-CLAUDE-CODEX.md). Pri implementácii má prednosť pred týmto pôvodným stručným návrhom.

Návrh zo 6. septembra 2026. Toto je návrh ďalšej integrácie, nie opis už nasadených funkcií.

Cieľ: Codex automaticky zachová dostupnú históriu projektu, pri ďalšej práci
vyhľadá relevantné dôvody a nadviaže na rozpracovanú úlohu. Úplná integrácia
neznamená záruku dokonalej pamäte ani neobmedzené kontextové okno.

## Zápis

Doplniť adaptér formátu Codexu vedľa adaptéra Claude Code. Oba majú vytvárať
spoločné udalosti: projekt, pôvod, relácia, ťah, čas, text, volanie nástroja,
výsledok a odkaz na dôkaz. Uchovať používateľove správy, odpovede, zmenené
súbory, dôležité výsledky a merania. Nerozpoznaný formát hlásiť, nie počítať
ako úspešne archivovaných nula správ.

Projekt musí mať stabilnú identitu aj pri práci vo viacerých gitových pracovných
kópiách. Pamäť Claude Code a Codexu môže byť spoločná pre ten istý projekt,
s označením pôvodu. História iných projektov sa nepripája automaticky.

Prírastky ukladať pri dokončení ťahu; pred zhutnením kontextu zachytiť aj
rozpracovanú prácu. Koniec relácie používať ako dodatočnú poistku. Udalosti
Codexu poskytujú identifikátory a prípadnú cestu k prepisu; jeho formát však
nie je stabilné verejné rozhranie. Adaptér potrebuje vzorky skutočných prepisov
a kontrolu kompatibility. [Dokumentácia hookov](https://learn.chatgpt.com/docs/hooks)

Existujúci archív treba jednorazovo doplniť o dostupné staršie relácie Codexu.
Neprítomné prepisy nemožno spätne zrekonštruovať bez iného zdroja.

## Vyvolanie

Nainštalovať a overiť hlavnú zručnosť Memexu aj zručnosti vyhľadávania a mapy.
Pri štarte a po zhutnení kontextu načítať krátku informáciu, kde je pamäť a
ako ju používať. Historické pasáže vyhľadávať až podľa aktuálnej otázky.
Do kontextu nevkladať celý archív ani automaticky celý zoznam tém.

Zručnosť má rozlišovať presný reťazec (`rg`), opis činnosti (mapa), historický
dôvod (archív) a pokračovanie práce (krátky záznam stavu). Automatické vyvolanie
závisí od dostupného popisu zručnosti; musí sa overiť v novom rozhovore.
[Dokumentácia zručností](https://learn.chatgpt.com/docs/build-skills)

## Pokračovanie a aktuálnosť

Pridať krátky záznam rozpracovanej úlohy: cieľ, dokončené kroky, otvorené otázky,
relevantné súbory, overenia a odkazy na dôkazy. Stanoviť pevný rozpočtový limit.
Pri načítaní skontrolovať gitový stav a platnosť odkazov. Záznam môže obsahovať
stručné zhrnutie, no konkrétne historické tvrdenia sa overujú v zdrojoch.

Pri každom prepise evidovať poslednú spracovanú polohu. Témy dopĺňať len z nových
častí, s rozpočtom na modelové spracovanie. Staršie rozhodnutia zachovať a
prepojiť s tým, čo ich nahradilo. Zastaralý alebo neúplný index nesmie pôsobiť
ako úplná pamäť. Vyhľadávanie má vedieť prírastky doindexovať alebo uviesť medzeru.

## Overenie hotovej integrácie

V oddelených rozhovoroch overiť zachovanie konkrétneho rozhodnutia a jeho dôvodu,
pokračovanie rozpracovanej úlohy, návrat po zhutnení kontextu, výber novšieho
rozhodnutia, spoločnú históriu Claude Code a Codexu a dostupnosť presného dôkazu.
Pri výpadku importu musí kontrola stavu uviesť chybu.

Doplniť meranie spotreby Codexu vrátane cache, vnorených volaní a kumulatívnych
počítadiel. Rovnaké nové úlohy porovnať s pamäťou a bez nej; do nákladov zahrnúť
aj vytváranie tém a záznamov rozpracovanej práce.

Poradie realizácie: adaptér a spätný import; zručnosti a automatické zachytávanie;
pokračovanie a aktuálnosť; skúšky medzi rozhovormi a porovnanie nákladov.
Na prvú funkčnú integráciu postačujú existujúce súbory, SQLite a Node skripty.
