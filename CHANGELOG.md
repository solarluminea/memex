# Zmeny

## 0.26.0 — Codex a ChatGPT

Memex doteraz rozumel len Claude Code. Pribudol archív relácií Codexu
(`scripts/codex.mjs`) do toho istého archívu a formátu, MCP server bez
závislostí (`scripts/mcp.mjs`, stdio pre Codex a HTTP s tokenom pre konektor
v ChatGPT) a natívny Codex plugin (`.codex-plugin/plugin.json`) so
zručnosťami a hookmi `SessionStart` a `Stop`. Redakcia tajomstiev a riadok
zlyhania sa presunuli do `scripts/prevod.mjs`, aby platili pre oboch
hostiteľov rovnako. Návod a zoznam neoverených vecí je v `CODEX.md`.

## 0.25.0 — otázka do pamäte stojí pätnásťkrát menej

Odpoveď na otázku do pamäte začínala prečítaním celého rozcestníka. Namerané
na skutočnom projekte: **11 891 tokenov** pri 260 témach, a rastie o riadok
s každou ďalšou — kým jedno hľadanie v úsekoch stojí okolo šesťsto. Štúdia so
slepými sudcami dala stope 100 % a fulltextu 98 %; tie dve percentá sú jedna
otázka v jednom behu z troch a platili sa dvadsaťnásobkom.

Hľadanie má odteraz tri úrovne v jednej odpovedi: kurátorské témy zo stopy,
témy odvodené z archívu a pasáže. Merané na piatich skutočných otázkach:
**832 tokenov namiesto 12 723, teda 15,3×.** Celý rozcestník sa číta až
vtedy, keď ani jedna úroveň nesedí — a to nie je formalita: otázka poskladaná
tak, aby zdieľala slová s nadpisom, sa v nadpisoch nájde v 57,7 % prípadov,
ale čistá parafráza v **0 %**. Preto sú úrovne lacné a omylné, a plné čítanie
zostáva ako drahá istota.

Odvodené témy sú nová vec a zadarmo: nadpis, ktorý si Claude napísal v
odpovedi, a otázka, ktorú položil používateľ. Merané proti hotovej stope so
436 ukazovateľmi — nadpis pokrýva 53,2 %, otázka 30,5 %, aspoň jedno
**69,3 %**. Na `ponuka-app` to je 5 493 tém popri 436 kurátorských. Nie sú
stopa a do `TRAIL.md` sa nezapisujú: je ich rádovo tisíce, takže sa nedajú
čítať celé, len prehľadať, a vo výpise sú označené ako odvodené.

**Mapa vie povedať aj riadok, nie len súbor.** ROADMAP odmietal krájanie
súboru tým, že medián zdrojového súboru je 123 riadkov. To číslo bolo o
nesprávnej veci: medián jedného veľkého **čítania** je 210 riadkov a upraví sa
z neho päť. Overené na 152 skutočných dvojiciach čítanie → úprava — kde je nad
úpravou vidieť deklaráciu, úprava leží medián **12 riadkov** pod ňou a 74 % do
štyridsiatich. `map.mjs outline <súbor>` vypíše deklarácie s číslami riadkov,
čo je 3 % dĺžky súboru, a `map find` pripíše riadok najlepšie sediaceho
symbolu aj k súborom bez popisku z rozhrania.

Meno symbolu sa číta cez `\p{L}`, nie `[A-Za-z]`. Prvá verzia zoznamu bola
ASCII a `staréNázvy` sa v osnove zjavilo ako `star` — tretí výskyt tej istej
pasce v tomto repozitári.

**Zoradenie mapy: pokrytie sa počíta vzácnosťou, nie počtom slov.** Dovtedy
dve časté slová vážili viac než jedno vzácne, hoci vzácne je práve to, čo
otázku odlišuje. Namerané na 300 zadaniach: MRR 0,576 → **0,597**, R@1 47,3 →
50,0 %, R@12 78,0 → 80,0 %. Drží na štyroch poloviciach zo štyroch, pričom
`BENCH_MOD` je nové striedavé delenie sady — obdobie je v oboch polovicach
rovnaké, takže rozdiel môže byť už len vzorka. Jednoslovný dotaz ani
pravdivosť ukazovateľov sa nezmenili: mení sa poradie, nie množina.

`search.mjs --file` pripíše k nálezu najbližšiu tému nad ním. Formulácia je
opatrná zámerne — z jednej strany vyzerá signál silno (66 % tém má do tristo
riadkov za sebou úpravu), z druhej strany, ktorá tu platí, slabo: tému do
tristo riadkov pred sebou má len **12 %** zo 6 824 úprav. Tém je 436, úprav
pätnásťnásobok. Vypisuje sa preto vzdialenosť, nie príčina.

Zamietnuté meraním, aby sa k tomu nemuselo vracať. **Slová zo správ commitov
ako skryté pojmy**: horná hranica sľubovala 65 % zlyhaní mapy, postavené a
merané s časovou hranicou to dalo 0,576 → 0,571 a pravdivosť 92,4 → 89,9 %;
tri varianty, tri ploché čiary, kód odstránený. **Čerstvosť z gitu ako signál
zoradenia**: správny súbor je medzi poslednými dvadsiatimi commitmi v 50 %
zlyhaní, kým čerstvých kandidátov je 6 % — a napriek tomu ako násobok kupuje
R@12 za R@1 a druhú polovicu, ako remíza nerobí nič.

A jedna metodická lekcia, ktorú stálo za to zaplatiť dvoma prehľadmi:
**varianty ladenia sa nesčítavajú.** Na starom základe vyzeralo zníženie váhy
popisu (+0,007) aj zvýšenie váhy skrytého pojmu (+0,003) ako malé zisky. Po
zapnutí váženého pokrytia dajú tie isté zmeny −0,006 a −0,008, spolu −0,012.
Všetky štyri odpovedali na tú istú otázku — koľko má ktorý druh dôkazu vážiť —
a vážené pokrytie ju rieši pri koreni, takže z ostatných zostali korekcie
niečoho, čo už nie je pokazené. Prehľad platí len voči základu, na ktorom
bežal.

Pribudli testy prvej úrovne hľadania a mapy; spolu ich je 33.

**Údržba pamäte už nedrží reláciu.** Destilátor bol podagent aj predtým, no
spúšťal sa v popredí, takže relácia naňho čakala desiatky minút. Keď skončil,
hlavný agent ešte raz spustil `status.mjs` a výsledok prerozprával. Odteraz
beží na pozadí, kontrolu si spraví sám a odovzdá jeden riadok. Archív s
indexom, `status --oprav` a prestavba mapy bežia tiež na pozadí, no ako
obyčajný príkaz, nie podagent. Model v nich nič nerozhoduje, takže
podagent by len pridal réžiu v tokenoch, aby zavolal jeden skript.
Prestavba indexu pritom na skutočnom projekte trvala 98,9 s. Archív a index
sú jeden príkaz spojený cez `&&`, aby index nevznikol nad rozpísaným archívom.
Ručné behy nepoužívajú `--quiet`. V tom režime by index na starom Node a mapa
v novom projekte skončili mlčky s nulou a hlásenie „hotovo“ by klamalo.

## 0.24.0 — pripomienka, ktorá klamala pri každom otvorení

Hook na začiatku relácie hlásil „1 session is not in the archive yet" vždy.
Porovnával počet súborov v archíve s počtom relácií v Claude Code a tá
prebiehajúca tam pochopiteľne nie je: jej `.jsonl` vznikne skôr, než hook
dobehne. Namerané na tomto projekte — prvý riadok relácie 00:10:18, archív
predošlej dopísaný 00:10:03. Hook teraz číta `session_id`, ktoré mu hostiteľ
podá na stdin, a porovnáva množiny namiesto počtov, takže vie povedať aj
ktoré relácie chýbajú. Keď ID nedostane, vynechá všetko, čo sa hýbalo za
poslednú pol hodinu.

Relácia, ktorá po zarchivovaní pokračovala, bola dovtedy neviditeľná. Archív
aj kontrola stavu porovnávali, ktoré relácie existujú, nie kam v nich archív
došiel — namerané tu, 443 zarchivovaných riadkov proti 513 v zdroji, čiže
štyri minúty rozhovoru mimo pamäte. Archivátor si preto do stavu zapisuje
veľkosť zdroja v bajtoch a hook ju porovná jedným `stat`. Stav bez tohto
údaja je spred tejto verzie a preskočí sa.

**Telemetria účtovala vstupné tokeny dvakrát.** Claude Code zapisuje jednu
odpoveď ako viac riadkov — text zvlášť, každé volanie nástroja zvlášť — a
`usage` v nich nesie rovnaké čísla, lebo patria tomu istému volaniu API.
Namerané: 2 090 riadkov s `usage` proti 1 031 unikátnym `message.id`, čiže
vstup vyšiel **1,98×** vyšší. Prepočítané na 84 reláciách skutočného projektu
klesli čerstvé tokeny na zásah z 38 263 na **15 085**. Porovnanie polovíc tým
skreslené nebolo — chyba je násobok, nie posun — ale absolútne číslo v README
áno, a je opravené. Riadok telemetrie má odteraz verziu a staršie sa
prepočítajú.

Štyri príkazy pod `SessionEnd` boli štyri paralelné procesy, nie postupnosť.
Claude Code hooky tej istej udalosti spúšťa súbežne a poradie dokončenia
nezaručuje, takže index sa mohol postaviť nad archívom, do ktorého sa práve
zapisovalo — a oba kroky by skončili nulou. Nahradil ich `scripts/udrzba.mjs`,
ktorý ich spustí v poradí archív → index → mapa → telemetria a zlyhanie
jedného nezastaví ostatné. Celý beh nad týmto archívom trvá 0,9 s. Hooky majú
aj vlastný časový limit a `SessionStart` sa obmedzil na `startup|resume|clear`,
takže výstraha o zaostalej pamäti už neskočí doprostred práce po zhutnení
kontextu.

Do archívu sa nezapisujú známe tvary tajomstiev — kľúče Anthropic a GitHubu,
AWS, Slack, JWT, súkromné kľúče a hlavičky `Bearer`. README hovorí archív
commitnúť, takže kľúč vložený do rozhovoru alebo do príkazu shellu by skončil
v gite. Vzory sú úzke zámerne: široký vzor na „niečo dlhé a náhodné" by zožral
hashe commitov. Nie je to záruka, je to poistka na formáty, ktoré sa dajú
rozpoznať. Oznámenia o dokončených podagentoch a bloky editora sa už
neukladajú ako reč používateľa.

Zhrnutie volania nesie prvý identifikátor zo vstupu, takže `[Tool: Agent]` je
teraz `[Tool: Agent subagent_type=claude-code-guide]` a volanie MCP konečne
hovorí, ktorého záznamu sa týkalo. Berie sa prvá skalárna hodnota bez medzier
do šesťdesiatich znakov, čiže prompt ani dlhý text dnu neprejde. Tým sa
`--file` rozšíri aj na hľadanie podľa ID. Príkazy PowerShellu sa archivujú
a triedia ako Bash — dovtedy telemetria na Windowse tvrdila, že sa nehľadá
a nečíta, lebo poznala len unixové názvy.

Skratka v popise mapy sa hľadala ako podreťazec kľúča, hoci pravidlo v README
aj v druhej polovici kódu hovorí „celý úsek identifikátora". Overené na bežných
menách: `icon → ico`, `cleanup → ean`, `medical → dic`, `capital → api`,
`europe → eur`. Mapa už tiež nevydáva licenciu ani vypnutý linter za popis
modulu a číta hlavičku písanú riadkovými komentármi, takže Go, Rust a Ruby
dostanú popis, ktorý dovtedy nedostali nikdy.

Mapa a telemetria si už nezaložia `.memex/` v projekte, ktorý o to nepožiadal.
Archivátor túto poistku mal od začiatku, tie dve nie — nájdené na tomto stroji:
`~/.memex/MAP.md` s nula modulmi a to isté v `Temp`. Ručné spustenie zakladá
ďalej; hook nie.

Kontrola stavu overuje aj to, či rozsah ukazovateľa obsahuje aspoň jedno slovo
zo svojho nadpisu. Dovtedy overovala len to, že rozsah existuje — ukazovateľ
posunutý o sto riadkov prešiel ako zdravý. Namerané na stope so 436
ukazovateľmi: 27 (6,2 %) nemá v rozsahu ani jedno slovo nadpisu. Hlási sa ako
poznámka, nie ako porucha: nadpis býva parafráza, takže je to zoznam na
prezretie, nie zoznam chýb. Prepis sa pritom číta raz, nie raz na ukazovateľ.

Hľadanie povie, keď je index starší než archív, aby sa osem ukazovateľov
nečítalo ako „v pamäti nič nie je". Prázdny výsledok už databázu aj zavrie.

Mapa dostala prvé testy — deväť, vrátane dotazu celou vetou, teda toho miesta,
kde mesiace prežila chyba, pri ktorej prepadlo 300 zadaní z 300. Spolu ich je
27. Jeden z nich zistil hranicu, ktorú treba poznať: pri projekte s menej než
deviatimi modulmi zahodí pravidlo „slovo na viac než tretinu projektu je
výplň" každé slovo dotazu. Je to vlastnosť — repozitár, ktorý sa dá prečítať
celý, mapu nepotrebuje — ale test to musí rešpektovať.

Dotaz do mapy, ktorý nevrátil nič, sa zapíše do `.memex/map-misses.jsonl`.
ROADMAP tým podmieňuje toleranciu preklepov a sám hovorí, že počítadlo je
menšie než tá funkcia; odteraz sa dá spočítať namiesto odhadovať.

## 0.21.0 — mapa ukazovala vedľa

Mapa vypisuje za názvom súboru číslo riadku a `stripComments` ho posúvala:
blokový komentár sa nahrádzal jednou medzerou aj s koncami riadkov, takže
všetko za ním sa vypísalo vyššie, než v súbore naozaj stojí. Ukazovateľ
ukazoval vedľa presne v tej veci, na ktorú je. Komentár sa teraz nahrádza
medzerami a riadky zostávajú.

Benchmark pravdivosti uznával zhodu podľa názvu súboru, takže ukazovateľ na
`src/a/Zoznam.tsx` sa počítal ako pravdivý, keď slovo obsahoval
`src/b/Zoznam.tsx`. Po sprísnení na presnú cestu padla pravdivosť cez kmeň
z 23,6 % na 9,4 % — nie zhoršené hľadanie, len číslo bez kolízií mien.
Kontrola stavu hlási aj rozsahy, ktoré začínajú pred prvým riadkom alebo
končia skôr, než začínajú; predtým videla len ten druhý koniec.

Zoradenie sa nepohlo, a tak to má byť: dotaz vetou MRR 0,569 proti 0,570 na
tých istých 300 úlohách. Sú to opravy správnosti, nie zoradenia.

README a ROADMAP hovoria, prečo sa index neprestavoval — SessionEnd hook
prestavbu spustil a relácia sa zavrela skôr, než dvojminútová práca dobehla.
Namerané na ostrom archíve so 69 prepismi: 128,5 s → 1,19 s. Spúšťač pre
prírastkové indexovanie („viac než ~3 sekundy") je preto nesplnený a položka
zostáva odložená.

Podklady meraní z auditu sú v `.gitignore`. Vznikli na súkromnom projekte
a nesú jeho štruktúru, správy commitov aj nadpisy tém; tento repozitár je
verejný. Pribudlo zadanie spoločnej pamäte pre Claude Code a Codex — plán
ďalšej práce, nie opis hotového.

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
