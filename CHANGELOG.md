# Zmeny

## 0.20.0 — spoľahlivosť archívu a rýchlejšie indexovanie

Index sa vytvára jednou transakciou a hotový súbor nahrádza starý bez jeho
predchádzajúceho vymazania. Samostatné procesy používajú odlišné dočasné súbory.
Opravený je aj prepínač `--index-into` a tichý beh bez aktivovaného archívu.

Archivátor rozlišuje udalosti podľa odtlačku zdrojovej identity a správy,
namiesto zahadzovania podobných dávok. Nové hlavičky obsahujú krátku značku
udalosti bez pridania riadka. Existujúca časť prepisu sa pri aktualizácii nemení.
Celý prepis sa zapisuje cez dočasný súbor a až potom sa potvrdí stav.
Zámok bráni súčasnému zápisu dvoch archivátorov.

Neúplný JSONL riadok sa skúsi znova pri ďalšom behu. Chýbajúci prepis sa obnoví
aj pri zachovanom stave. Stratený alebo zaostávajúci stav sa overí podľa
zachovaných udalostí; pri starom formáte podľa obsahu. Nesúlad zdroja,
poškodený stav a neznámy formát sa hlásia bez prepísania prepisu. Bežné nadpisy
v odpovediach sa už nepovažujú za cudzí formát archívu; hlavičky ťahov iného
archivára (`## TY ·`, `## JA ·`) áno a taký prepis sa nemení.

Prevod ťahu orezáva koniec bloku volaní tak ako 0.19.0 — refaktor to stratil
a useknutý príkaz Basha nechával pred zatváracím plotom prázdny riadok. Na
archíve s 1117 ťahmi stačil jediný taký ťah na to, aby obnova bez stavu
prestala sedieť už na 378. mieste a prepis sa prestal aktualizovať natrvalo,
lebo zastavený beh o relácii do stavu nič nezapísal. Prepis spred značiek sa
preto porovnáva bez ohľadu na biele znaky a nezhoda beh nezastaví: pripíše sa
len to, čo v prepise nie je, a čo zdroj už nemá, sa nahlási. Overené na
skutočnom archíve — obnova bez stavu dá bajt na bajt to isté ako beh so
stavom a čerstvá stavba sa od archívu 0.19.0 líši len dátumom v hlavičke
(začiatok relácie namiesto konca).

Značka udalosti sa neindexuje ani nevypisuje vo výsledkoch. Riadky sa pritom
neposúvajú, takže ukazovatele ďalej sedia. Už spracované riadky JSONL sa pri
označkovanom prepise neparsujú znova; ustálený beh nad týmto archívom klesol
z 262 na 198 ms.

Vyhľadávanie nezahadzuje susedné pasáže ani odlišné konce po rovnakom úvode.
Porovnáva celý text a zachováva rozdiely v číslach, diakritike aj veľkosti písmen.
Mapa zachováva čísla riadkov pri odstraňovaní komentárov a používa skryté pojmy
aj pri jednoslovnom hľadaní podľa kmeňa. Kontrola stavu odhalí neplatné rozsahy;
benchmark pravdivosti už neuznáva rovnaký názov súboru na inej ceste.

Overenie na pôvodnej snímke: mapa na 300 zadaniach bez zmeny (62,7 % do troch
výsledkov), pamäť na 225 témach 84,0 → 84,4 % do ôsmich. Index 28 344 úsekov
sa po aplikovaní vytvoril za 1,00 s na skúšobnom Windows stroji. Časy závisia
od stroja. Podklady k meraniu vznikli na súkromnom projekte, takže v tomto
repozitári nie sú — nesú jeho štruktúru aj nadpisy tém.

Prestavba indexu, zmeraná naostro na archíve so 69 prepismi: 128,5 s → 1,19 s,
28 505 úsekov. Predtým sa index neprestavoval preto, že dvojminútová práca
nestihla dobehnúť, kým sa relácia zatvárala.

Automatické regresné skúšky: `node --test tests/*.test.mjs`.
Pôvodná cielená sada po opravách spĺňa 13 z 15 požiadaviek; zostávajúce dve
sa týkajú importu a telemetrie Codexu, ktoré táto verzia ešte nedopĺňa.
Verzia nemení limity radenia a počtu výsledkov ani nepridáva embeddingy.
