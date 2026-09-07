# Spoločná projektová pamäť pre Claude Code a Codex

Implementačný plán pre GPT-5.6 Sol, 6. september 2026.

Tento dokument je zadanie ďalšej implementácie, nie opis hotových funkcií. Nahrádza stručný návrh `NAVRH-PAMATE-CODEX.md`. Cieľom je jedna pamäť aplikácie, do ktorej priebežne prispievajú Claude Code aj Codex a z ktorej obaja dokážu pokračovať v práci s overiteľným pôvodom informácií.

## 1. Výsledok a hranice

Po implementácii musí fungovať tento scenár: používateľ s Claudom rozhodne o správaní aplikácie a začne úpravu; neskôr otvorí Codex v tej istej aplikácii, prípadne v inom gitovom worktree. Codex nájde rozhodnutie, jeho dôvod, príslušnú vetvu a overenia. Pokračuje na správnom stave kódu. Keď rozhodnutie používateľ zmení, Claude pri ďalšom otvorení nájde zmenu aj starší dôvod, nie dve nerozlíšiteľné platné pravdy.

„Úplná pamäť“ tu znamená integrované zachytávanie, vyhľadávanie, odovzdanie práce, aktualizáciu a viditeľné medzery. Neznamená neobmedzený kontext, dokonalé vybavenie všetkých informácií ani bezstratovú zálohu každého obrázka a výstupu nástroja.

Záväzný rozsah prvej verzie:

- Lokálny Claude Code a lokálny Codex, jeden používateľ, rovnaká aplikácia, postupná aj súbežná práca.
- Rovnaký checkout aj samostatné worktrees jedného repozitára. Mapa kódu a rozpracované zmeny sa nesmú zameniť medzi vetvami.
- Manuálny prenos pamäte medzi samostatnými klonmi cez overiteľný export/import. Automatická synchronizácia medzi počítačmi nie je podmienkou prvej verzie.
- Windows je povinné overované prostredie; Linux doplniť do automatických testov. Ostatné kombinácie uviesť ako neoverené, kým neprejdú skúškami.
- Rovnaká nová verzia Memexu musí podporovať oba nástroje. Súbežný zápis starým Memexom 0.19/0.20 do migrovaného úložiska nie je podporovaný. Čitateľnosť starého archívu a kompatibilné príkazy sa zachovajú.

Memex nemení internú pamäť modelu ani nespravuje adresár `~/.codex/memories`. Spoločnú pamäť vedie vo vlastnom úložisku projektu. Nezdieľa históriu medzi rôznymi projektmi len preto, že majú podobný názov alebo rovnaký vzdialený Git server.

## 2. Z čoho vychádzame

Pracovný strom už obsahuje necommitnuté opravy verzie 0.20.0. Zachovať ich; nezačínať resetom na posledný commit. Doterajšie výsledky sú v `audit/2026-09-06/POSUDOK.md` a `audit/2026-09-06/aplikovane-vysledky.json`.

Existujúce opravy zrýchlili zostavenie indexu na približne jednu sekundu na skúmanej vzorke 66 prepisov/28 344 blokov. Existuje 14 regresných testov archivácie a vyhľadávania. Z 15 cielených auditných scenárov prešlo 13; import a telemetria Codexu zostávajú nepodporované. Toto sú výsledky konkrétnej vzorky, nie všeobecná spoľahlivosť integrácie.

Pred ďalšou prácou zopakovať existujúce testy a zaznamenať stav. Nové benchmarky nemajú prepísať historické výsledky. Doterajší experiment nedokázal čistú úsporu tokenov oproti zručnému vyhľadávaniu cez `rg`; tú treba zmerať samostatne.

Technické dlhy relevantné pre tento plán:

- `scripts/archive.mjs` rozumie Claudovi, nie Codexu; `scripts/stats.mjs` z neho pri Codexe nezíska správne počítadlá.
- `scripts/archivator.mjs` má užitočné ochrany, ale opakovane číta celý vstup a používa spoločný súbor stavu a zámok s PID. Prenos na iný stroj a všetky pády počas obnovy nie sú vyriešené.
- Dočasný SQLite index ochráni starý index pri chybe, ale dva zostavovače môžu publikovať staršiu dokončenú snímku po novšej.
- Štyri samostatné príkazy v `hooks/hooks.json` nie sú spoľahlivá sekvenčná pipeline. Celá údržba patrí mimo krátkeho koncového hooku.
- `scripts/kde.mjs` vychádza z pracovného adresára. Nemá spoločnú identitu worktrees.
- V aktuálne dostupnej inštalácii Codexu boli viditeľné pomocné zručnosti, nie hlavná zručnosť Memexu. Nové balenie musí byť overené skutočnou inštaláciou.

## 3. Overené rozhrania hostiteľov

Pre Codex použiť príkazové hooky. Dokumentácia uvádza udalosti `SessionStart`, `Stop`, `PreCompact`, `PostCompact` a `SessionEnd`; cesta `transcript_path` môže chýbať a formát prepisu nie je stabilné rozhranie. `SessionEnd` má predvolene jednu sekundu, maximum tri. Plugin môže určiť vlastnú cestu hookov v manifeste. Codex poskytuje aj kompatibilné premenné `CLAUDE_PLUGIN_ROOT`, preto nimi nemožno rozlišovať hostiteľa. Zmenené hooky vyžadujú dôveru používateľa. [Oficiálna dokumentácia Codexu](https://learn.chatgpt.com/docs/hooks)

Claude Code má vlastný kontrakt vstupu, výstupu a životného cyklu hookov. Pri `SubagentStop` rozlišovať prepis hlavnej relácie a `agent_transcript_path`. Neprenášať koncové časové limity Codexu do Clauda ako jeho vlastnosť. [Oficiálna dokumentácia Claude Code](https://code.claude.com/docs/en/hooks)

Zručnosti majú stručný popis dostupný pred aktiváciou; podrobné pokyny sa načítavajú pri použití. Preto treba otestovať vyvolanie v novej úlohe, nestačí existencia súboru. [Zručnosti Codexu](https://learn.chatgpt.com/docs/build-skills)

Pluginový kód a projektové dáta oddeliť; inštalovaná cesta pluginu sa môže meniť medzi verziami. [Balenie Claude Code pluginov](https://code.claude.com/docs/en/plugins-reference)

Konkrétnu verziu Claude Code, Codex CLI, Codex desktopu a Node zaznamenať pri implementácii do `tests/compatibility/overene-verzie.json`. Neodhadovať minimálnu podporovanú verziu podľa existencie dokumentácie. Schémy hookov validovať vzorkami z oboch skutočných hostiteľov. Cloudové prostredia bez lokálnych prepisov neoznačiť za plne integrované.

## 4. Architektúra: jedno jadro, dva adaptéry

Tok dát:

```text
Claude JSONL ─ adaptér Claude ─┐
                             ├─ normalizované udalosti ─ nemenné segmenty
Codex JSONL ── adaptér Codex ──┘             │
                                           ├─ archív Markdown + odkazy
                                           ├─ spoločný SQLite index
                                           ├─ rozhodnutia a stav úloh
                                           └─ telemetria s pôvodom

Claude skills/commands ─┐
                       ├─ rovnaké CLI jadro ─ výber dôkazov podľa úlohy
Codex skills ───────────┘

Mapa kódu: samostatne pre každý worktree.
```

Nepísať dve archivácie s rozdielnou sémantikou. Hostiteľský adaptér iba rozpoznáva vstup a prevedie ho na spoločný kontrakt. Pravidlá identity, zápisu, vyhľadávania, odovzdania a konfliktov sú spoločné. Hook adaptér osobitne rieši protokol konkrétneho hostiteľa.

Ponechať Node a SQLite, bez povinného servera, embeddingovej služby či ďalšieho modelu. Použiť `node:sqlite`; presnú minimálnu verziu Node stanoviť po testoch a uviesť v kontrole prostredia. Nevytvárať povinný MCP server pre funkcie dostupné rovnakým CLI obom hostiteľom.

## 5. Identita projektu a umiestnenie dát

### 5.1 Konfigurácia

Rozšíriť `memex.json` bez zmeny významu existujúcich polí. Nasledujúce hodnoty sú návrh nového kontraktu:

```json
{
  "schemaVersion": 2,
  "projectId": "<UUID vytvorené pri init>",
  "archive": "docs/archiv-relacii",
  "index": "docs/archiv-relacii/.hladanie.db",
  "trail": "docs/agent-plany/ukazovatel",
  "trailIndex": "docs/agent-plany/UKAZOVATEL.md",
  "map": ".memex/MAP.md",
  "stats": ".memex/stats.jsonl",
  "integration": {
    "hosts": ["claude", "codex"],
    "capture": "turn",
    "sharedStore": "git-common-dir",
    "startupMaxChars": 1600,
    "recallMaxChars": 12000,
    "checkpointMaxChars": 6000,
    "distill": "manual"
  }
}
```

`projectId` je stabilné UUID, nie hash cesty ani remote URL. `init` ho vytvorí raz; do Gitu ho zaradiť bežným postupom používateľa. Pri novom klone rovnaké UUID umožní overený import, samo osebe však neznamená prístup k pamäti iného počítača.

Rozlíšenie koreňa: explicitný argument `--project-root`, potom existujúce `MEMEX_PROJECT_ROOT`, potom najbližší nadradený `memex.json`, potom Git toplevel, napokon aktuálny adresár pre neinicializovaný režim. Zachovať existujúci `--root`/`MEMEX_ROOT` ako cestu dát Memexu, nezameniť s koreňom projektu. Existujúce pravidlo prepínač → prostredie → konfigurácia → predvolené zostáva pre jednotlivé cesty.

Pri vnorených projektoch rešpektovať najbližší `memex.json`; podprojekt nemá automaticky prístup k pamäti nadradeného. Worktrees prepojiť cez `git rev-parse --git-common-dir` a overiť rovnaké UUID. Nesúhlas UUID znamená chybu, nie automatické zlúčenie.

### 5.2 Jedno lokálne úložisko

V novom integrovanom režime zvoliť kanonické úložisko `<git-common-dir>/memex/<projectId>/`. Je spoločné pre worktrees a prežije odstránenie dočasného worktree. Nie je verzované Gitom. Pre projekt bez Gitu použiť `.memex/shared/`; ďalšie checkouty sa pripájajú explicitnou lokálnou väzbou, nie heuristikou.

```text
store.json                         verzia schémy, UUID, vznik úložiska
events/<host>/<sessionKey>/<segmentId>.json
records/<recordId>/<revisionId>.json
legacy/<snapshotId>/...             nezmenené staré archívy a témy
derived/memory.db                   obnoviteľný index, pracovná fronta
derived/archive/...                obnoviteľné Markdown projekcie
local/sources/...                   privátne cesty k prepisom a kurzory
local/receipts/...                  prijaté udalosti hookov
local/health.json                   stav importu, medzery, chyby
```

`events`, `records` a `legacy` sú zdroj pravdy. `derived` možno obnoviť. `local` sa neexportuje. Názvy priečinkov relácií odvodiť hashom, nedovoliť identifikátoru z prepisu vytvárať cestu s `../`.

Existujúce `archive`, `trail` a `trailIndex` zostávajú čitateľné na pôvodných miestach. Migračný krok uloží aj ich presnú snímku do `legacy`, aby odkaz prežil zmazanie worktree. Nové Markdown projekcie sú v spoločnom úložisku; pôvodné príkazy čítajú oba zdroje cez nový resolver. Nepresúvať staré súbory ani meniť existujúce riadky. Toto je zámerná zmena vnútorného umiestnenia nových dát, ktorú musí `status` a migračný prehľad jasne ukázať.

`index` zo starého nastavenia zostáva platný v starom režime. V integrovanom režime sa používa spoločný index a stará cesta sa zobrazí ako neaktívna kompatibilná konfigurácia; nesmú vedľa seba potichu vzniknúť dva aktuálne indexy. Rovnako telemetriu čítať zo spoločných udalostí, starý súbor ponechať ako historický zdroj s označenou verziou.

Mapa zostáva na `map` danej pracovnej kópie. Jej metadáta obsahujú worktree, HEAD, hash relevantnej konfigurácie a odtlačok aktuálnych zdrojov vrátane necommitnutých zmien. Samotný HEAD nestačí na kontrolu aktuálnosti. Absolútna cesta mapy zdieľaná viacerými worktrees je v integrovanom režime konfiguračná chyba, pokiaľ nevytvára oddelené súbory podľa identity worktree.

## 6. Kontrakt udalostí a import

### 6.1 Spoločná udalosť

Vytvoriť validátor a schému `schemas/event-v1.schema.json`. Názvy verejných polí sú stabilný technický kontrakt, nezávislý od jazyka pokynov:

```json
{
  "schemaVersion": 1,
  "eventId": "sha256:<64 hex>",
  "projectId": "<UUID>",
  "host": "codex",
  "sessionId": "<pôvodné id>",
  "parentSessionId": null,
  "sourceGeneration": "<id generácie vstupu>",
  "source": { "recordId": null, "byteFrom": 1200, "byteTo": 1580 },
  "time": "2026-09-06T12:00:00Z",
  "turnId": null,
  "kind": "message",
  "role": "user",
  "content": { "text": "Zachovaj existujúce odkazy do archívu." },
  "scope": { "worktreeId": "<id>", "branch": "codex/integracia", "head": "<sha>" },
  "evidence": { "sourceHash": "sha256:<hex>", "truncated": false }
}
```

Povolené druhy: `message`, `tool_call`, `tool_result`, `usage`, `session_meta`, `gap`. Údaje neznáme vo vstupe sú `null`, nie vymyslené hodnoty. Čas pozorovania importérom viesť samostatne od času udalosti. Pri spätnom importe nepripisovať aktuálny HEAD historickému rozhodnutiu; neznámy historický stav je `null`.

Identita relácie je dvojica hostiteľ + pôvodné ID, nie samotné ID ani basename prepisu. `eventId` vypočítať z kanonického JSON poľa `[projectId, host, sessionId, sourceGeneration, recordIdentity, partIndex]`. `recordIdentity` používa stabilné natívne ID, ak existuje, inak bajtový začiatok záznamu v nezmenenej generácii. Pre jednu správu s viacerými blokmi použiť stabilný `partIndex`. Hash obsahu uložiť osobitne: rovnaké ID s iným obsahom znamená konflikt, nie tiché zahodenie.

Kanonický JSON: rekurzívne zoradiť kľúče objektov, zachovať poradie polí a presný text, odmietnuť nečíselné hodnoty typu NaN/Infinity. Identitu generácie prideľuje spoločný register zdrojov v krátkej SQLite transakcii, nie každý importér nezávisle. Po strate DB ju rekonštruovať z publikovaných segmentov. Natívne ID viesť aj v sekundárnom registri bez generácie, aby opravený/prekopírovaný zdroj nevytváral druhú udalosť s rovnakou preukázanou identitou. Pri exporte/importe sa už existujúce ID neprepočítavajú.

Rovnaký text v dvoch samostatných používateľských správach sú dve udalosti. Nemazať ich deduplikáciou podľa textu. Cudzí fork s novou identitou relácie sa tiež zachová; prevzatá história sa môže pri vyhľadávaní zoskupiť, nie zničiť.

### 6.2 Čítanie prírastkov

Čítať binárne od potvrdeného bajtového offsetu, dekódovať iba úplné JSONL riadky. Uložiť odtlačok začiatku vstupu a bloku pred kurzorom, veľkosť a identitu súboru, ak ju systém poskytuje. Neukladať kurzor za neúplný riadok. Ošetriť UTF-8 znak aj CRLF rozdelené medzi čítaniami.

Ak sa súbor skráti alebo zmení pred kurzorom, zastaviť prírastkový import a hlásiť novú/nejasnú generáciu. Úplný import novej generácie spustiť samostatne; natívne ID možno párovať s pôvodnými, udalosti bez ID nezlučovať iba podľa textu. Pri obsahu identickom s predchádzajúcim zdrojom možno prevziať existujúcu generáciu po overení celého hashu. Vyššia pamäťová náročnosť je prípustná pri explicitnom opravnom behu, nie po každom ťahu.

Známe neobsahové udalosti preskočiť a počítať. Neznámy typ zaznamenať ako medzeru so zdrojovým rozsahom a odtlačkom; import môže pokračovať, ale zdravie ostáva neúplné. Neplatný úplný JSON riadok zastaví kurzor pred poškodením. Neskorší opravený adaptér musí vedieť medzery znovu spracovať. Nepísať „0 správ, úspech“ pri nerozpoznanom formáte.

### 6.3 Adaptér Claude

Preniesť existujúcu serializáciu do `scripts/adapters/claude.mjs`, pôvodný príkaz zachovať ako obal. Podporiť používateľské a asistentské textové bloky, volania nástrojov, výsledky a natívne identifikátory. Systémové pokyny nearchivovať ako používateľove rozhodnutia. Pre podagenta viesť samostatnú reláciu s rodičom; nečítať omylom znovu iba hlavný prepis.

Používateľské správy nevyvodzovať zo samotného vonkajšieho typu, ak obsah predstavuje iba výsledok nástroja. Existujúce formáty starého Markdownu vrátane `CLAUDE` nadpisov zostávajú čitateľné.

### 6.4 Adaptér Codex

Implementovať `scripts/adapters/codex.mjs` podľa anonymizovaných skutočných vzoriek: `session_meta`, `turn_context`, `response_item`, `event_msg`. Primárny obsah brať z `response_item`; paralelné zobrazenie tej istej správy v `event_msg` nezapočítať znovu. Nepárovať dve správy len časom a textom. Ak sa použije náhradná vetva bez `response_item`, označiť nižšiu istotu a pokryť konkrétnou vzorkou.

Zachytiť `function_call` a zodpovedajúci výsledok podľa `call_id`, aj keď ležia v rôznych prírastkoch. Zachovať názov, argumenty, výsledok a informáciu o skrátení. Volanie `functions.exec` môže obsahovať viac vnorených operácií; pri importe nikdy nespúšťať jeho JavaScript. V prvej verzii viesť vykonané vonkajšie volanie presne, vnorené operácie len tam, kde ich samostatný výsledok alebo deterministický parser preukazuje. Neznáme kategórie vykazovať samostatne; nevydávať počet vonkajších volaní za počet zmien súborov.

Neukladať interné uvažovanie ako používateľský obsah. Z počítadiel možno zachovať počet reasoning tokenov, ak je dostupný. Prílohy majú metadáta a informáciu o dostupnosti; bez skutočného importu ich obsahu nesľubovať vyhľadávanie v obrázkoch.

### 6.5 Výber historických relácií

Nový príkaz `backfill --host claude|codex|all --dry-run --json` vypíše kandidátov, dôvod priradenia k projektu, objem a nejasné prípady. Priradenie overovať metadátami projektu/cwd a explicitne známymi worktrees. Podobná cesta alebo názov priečinka nestačí. Následný beh používa uložený zoznam kandidátov s hashmi; pri zmene zdroja opätovne overí vstup.

Nájsť dostupné lokálne prepisy oboch hostiteľov, podporiť explicitné `--source` pre exporty. Prepisy zmazané pred importom nemožno obnoviť. Skenovanie všetkých používateľových relácií nesmie prebiehať po každom ťahu.

## 7. Zápis, súbeh a obnova

Nové dáta ukladať do nemenných segmentov po najviac 128 udalostiach alebo 256 KiB; veľký obsah ukladať osobitne podľa hashu, s limitom a informáciou o skrátení. Segment obsahuje schému, identitu zdroja, rozsah, udalosti a hash kanonického obsahu. Nezávislé relácie zapisujú do samostatných adresárov.

Poradie zápisu je záväzné:

1. Načítať úplné riadky, normalizovať a validovať segment.
2. Vytvoriť dočasný súbor v cieľovom adresári, zapísať, vykonať `fsync` súboru a uzavrieť.
3. Publikovať pod názvom odvodeným od hashu; existujúci zhodný segment znamená opakovanie. Existujúci nezhodný obsah pod rovnakým hashovým menom znamená poškodenie. Použiť publikovanie bez prepisu existujúceho súboru; na overenom lokálnom FS možno vytvoriť hardlink z uzavretého dočasného súboru. Ak atómové publikovanie platforma neposkytuje, skončiť chybou alebo použiť otestovaný ekvivalent, nie predpoklad.
4. V jednej SQLite transakcii zaregistrovať segment, vložiť nové udalosti cez unikátny `eventId`, aktualizovať FTS a potvrdiť kurzor. Pri konflikte ID porovnať hash obsahu.
5. Markdown projekcie a súhrnnú telemetriu aktualizovať ako obnoviteľné výstupy. Kurzor tém a súhrnov ostáva samostatný od kurzora importu.

Pád pred bodom 3 zanechá iba dočasný súbor. Pád medzi 3 a 4 sa obnoví registráciou platných segmentov. Pád po 4 nestratí zdroj pravdy; chýbajúca projekcia sa obnoví. Poškodené segmenty sa nesmú indexovať. Pri obnove databázy zo segmentov preveriť kontinuitu zdrojových rozsahov; nevyberať iba najvyšší offset cez medzeru.

SQLite používa WAL, krátke transakcie a obmedzený `busy_timeout`. Je koordinátorom odvodených dát, nie jedinou zálohou pamäte. Počas zápisovej transakcie nerobiť modelové volania ani dlhý sken disku. Pri obsadení po uplynutí limitu zostane segment/fronta na ďalší beh.

Minimálna databázová schéma: `segments(segment_id PRIMARY KEY, host, session_id, generation, byte_from, byte_to, hash)`, `events(event_id PRIMARY KEY, segment_id, part_index, kind, time, content_hash)`, `native_ids(host, session_id, native_id, part_index, event_id)` s unikátnym zloženým kľúčom, `sources(source_key PRIMARY KEY, generation, committed_offset, fingerprint)`, `record_revisions(revision_id PRIMARY KEY, record_id, task_id, kind, state)`, `revision_parents(revision_id, parent_id)`, `gaps(gap_id PRIMARY KEY, source_key, byte_from, byte_to, reason, resolved_by)`, `consumer_cursors(consumer, source_key, revision, cursor)` a FTS tabuľka odkazujúca na ID udalostí/záznamov. Obsah môže index držať ako cache, nesmie sa stať jedinou kópiou. SQL migrácie majú vlastné číslo verzie a prebehnú v transakcii; novšiu nepodporovanú schému otvoriť len diagnosticky bez zápisu.

Nové Markdown projekcie vytvárať po nemenných segmentoch, s verziou rendereru. Ich riadky sa nemenia pri príchode ďalšieho segmentu alebo neskoršieho výsledku nástroja. Spojenie volania a výsledku rieši index. Pri zmene rendereru vytvoriť novú verziu projekcie; starý odkaz stále riešiť cez ID alebo pôvodnú projekciu.

Plnú prestavbu indexu vykonáva najviac jeden zostavovač. Ostatní používajú posledný úplný index. Publikovanie musí pod koordinovaným zámkom overiť generáciu zdrojov a dohnať nové segmenty; staršia snímka nesmie prepísať novšiu. Zvážiť prestavbu FTS v existujúcej databázovej transakcii, ak benchmark potvrdí prijateľný čas; pri výmene celého DB súboru výslovne vyriešiť otvorené spojenia na Windows.

Nepoužiť starý globálny `.archive.lock` ako koordinátor celého nového systému. Starý archivátor ponechať len pre nemigrovaný režim. Nové úložisko nepodporuje súbežné zapisovanie cez sieťový disk/Dropbox/OneDrive ani kopírovanie otvorenej SQLite databázy. Na prenos slúži export segmentov.

Garanciu otestovať pre zabitie procesu. Odolnosť proti výpadku napájania deklarovať len v rozsahu skutočne overených vlastností súborového systému; samotné premenovanie nie je dôkaz úplnej odolnosti.

## 8. Automatické zachytávanie a balenie pluginu

Vytvoriť `scripts/hook.mjs --host claude|codex`. Hostiteľa odovzdať explicitne z príslušného manifestu. Vstup čítať zo stdin, výstup vytvárať hostiteľským serializerom; bežné diagnostiky smerovať do lokálneho stavu a stderr. Žiadny výstup benchmarku na stdout hooku.

| Udalosť | Spoločná práca jadra | Limit práce Memexu |
|---|---|---|
| SessionStart | Overiť projekt, spracovať malý zvyšok fronty, vrátiť smerovanie na pamäť | Cieľ p95 do 300 ms pri prázdnej fronte; výstup do 1 600 znakov |
| Stop | Zapísať prijatie hooku, importovať prírastok aktuálnej relácie | Interný rozpočet 500 ms; zvyšok zostáva vo fronte |
| PreCompact | Zachytiť dostupný prírastok a označiť bod zhutnenia | Bez modelovej sumarizácie a bez blokovania |
| SessionStart po compact / PostCompact | Obnoviť krátke smerovanie; deduplikovať podľa relácie a bodu zhutnenia | Nepridávať celý archív ani opakovane ten istý text |
| SessionEnd | Zapísať prijatie, vykonať iba malý dostupný prírastok | Interný rozpočet 500 ms; bez mapy, plného indexu a distilácie |
| SubagentStop | Ak existuje cesta, importovať podagenta s rodičom | Rovnaké obmedzenie; závisí od overeného kontraktu hostiteľa |

Čísla v tabuľke sú nové návrhové ciele, nie namerané výsledky. Čas merať vrátane štartu Node procesu. Pri veľkom prírastku ukladať po segmentoch a kontrolovať deadline medzi nimi. Ak už samotný štart platformy prekračuje cieľ, uviesť skutočný výsledok a zmenšiť synchronickú prácu.

Hooky nikdy nespúšťajú model, nedávajú `decision: block` na pokračovanie asistenta a nemenia rozhodnutie používateľa o ukončení. Chyba pamäte sa zobrazí v `status/doctor`; bežnú prácu asistenta neblokuje. Zápis prijatia hooku je len fronta, nie dôkaz archivácie. Ak zdroj pred dobehnutím zmizne, uviesť medzeru. Nepredstierať, že proces odpojený na pozadí je zaručene dokončený po zatvorení hostiteľa.

Pred vyhľadávaním a pri `maintenance` dohnať frontu v rozpočte; odpoveď vyhľadávania vždy uvádza čerstvosť. Bez ďalšej aktivity a bez samostatnej služby nemožno zaručiť okamžité dobehnutie zvyšku po zatvorení aplikácie. Prvá verzia službu nevyžaduje.

Zachovať `.claude-plugin/plugin.json`, `commands/*` a `agents/distiller.md`. Pridať natívny `.codex-plugin/plugin.json` a zručnosti pre Codex; presné manifestové polia overiť podľa aktuálneho balenia. Claude použije `hooks/hooks.json`, Codex explicitne `hooks/codex-hooks.json`, oba jediný dispatcher na udalosť. Zabrániť dvojitému načítaniu predvolených aj explicitných hookov.

Hlavné zručnosti umiestniť do `skills/memex/SKILL.md`, `skills/search/SKILL.md`, `skills/map/SKILL.md`, `skills/handoff/SKILL.md`; pomocné archive/status/stats/distill zachovať alebo vytvoriť ekvivalent. Spoločné pravidlá dať do jedného referenčného súboru, odlišnosti hostiteľov do krátkych obalov. V inštalačnom teste overiť, že manifesty naozaj objavia požadované súbory a Claude zároveň nestratí staré príkazy. Neprepisovať globálny `AGENTS.md` ani `CLAUDE.md` bez samostatného zadania.

## 9. Vyvolanie pamäte, dôkazy a rozpočty

Hlavná zručnosť vysvetlí štyri voľby: presný symbol/reťazec → `rg`; hľadanie súboru podľa funkcie → mapa; historický dôvod → pamäť; pokračovanie úlohy → stav úlohy. Nerozširovať každú jednoduchú otázku na vyhľadávanie histórie.

`SessionStart` vkladá iba deterministické smerovanie: projekt, dostupnosť, cestu/príkaz pre vyhľadanie a počet relevantných otvorených úloh. Historické správy ani rozhodnutia nevkladať ako autoritatívne systémové pokyny. Aktuálne pokyny používateľa a hostiteľa majú prednosť. Vyhľadaný text je citovaný obsah, aj keď v ňom niekto napísal „ignoruj pravidlá“.

Nové CLI `recall` má tvar:

```text
node scripts/memex.mjs recall --query "Prečo je záujem zelený?" --max-chars 12000 --json
```

Výstup obsahuje `schemaVersion`, `projectId`, `results`, `freshness`, `budget`, `warnings`. Každý výsledok má `eventId` alebo `recordId`, hostiteľa, reláciu, čas, rozsah platnosti, úryvok a dôkaz. `freshness` obsahuje potvrdené segmenty, počet nespracovaných zdrojov, medzery a prípadnú nedostupnosť vstupu. Rozpočet zahŕňa aj metadáta; pri prekročení skracovať počet výsledkov, nikdy vrátiť nevalidný orezaný JSON.

`evidence read --id <id> --max-chars N` vráti presný obsah zo segmentu alebo nezmenenej starej snímky. Markdown odkaz obsahuje súbor, riadky a hash citovaného úseku. Stabilný ID odkaz je primárny; pri presune súboru sa resolver opiera o ID/snímku. Pri zmene starého zdroja sa nevydáva obsah z rovnakých riadkov za pôvodný dôkaz.

FTS zachovať ako základ. Pridať filtre projekt/hostiteľ/úloha/vetva/čas a výber aktuálnych revízií. Samotná novosť neznamená pravdivosť. Rozhodnutie na nesúvisiacej vetve možno ukázať ako historický kontext, nie automaticky odporučiť ako platné.

Rozpočty sú najprv v znakoch, pretože sú deterministicky vynútiteľné. Tokeny merať pri reálnych skúškach; pevný pomer znaky/tokeny neoznačovať za presný. Celý zoznam tém ani celú mapu pri štarte nečítať.

## 10. Odovzdanie práce a životnosť rozhodnutí

Samotný import správ nevytvorí kvalitné odovzdanie. Pridať explicitné záznamy `checkpoint` a `decision`, ktoré používa tá istá zručnosť v oboch hostiteľoch. Model ich pripravuje v bežnom ťahu, nie v shellovom hooku. Pred zhutnením hook uloží iba dostupné dáta; nevymyslí chýbajúci súhrn.

```json
{
  "schemaVersion": 1,
  "recordId": "<UUID>",
  "revisionId": "sha256:<hex>",
  "parents": [],
  "kind": "checkpoint",
  "projectId": "<UUID>",
  "taskId": "<UUID>",
  "author": { "host": "claude", "sessionId": "<id>" },
  "scope": { "branch": "feature/crm", "head": "<sha>", "worktreeId": "<id>" },
  "state": "open",
  "goal": "Dokončiť zobrazenie záujmu v CRM.",
  "done": [],
  "next": [],
  "questions": [],
  "files": [],
  "checks": [],
  "evidenceIds": [],
  "createdAt": "2026-09-06T12:00:00Z"
}
```

`checks` musí obsahovať príkaz, výsledok, čas a stav kódu pri overení, ak je známy. „Testy prešli“ bez pôvodu sa uloží ako tvrdenie asistenta, nie overená vlastnosť aktuálneho kódu. Stav necommitnutých súborov opisovať cestami a hashmi; pamäť nie je záloha samotných zmien a pokračovanie vyžaduje dostupný checkout/commit/patch.

Pri novej úlohe ponúknuť kandidátov podľa vetvy, súborov a cieľa. Jeden `LAST_SESSION.md` pre celý projekt je zakázaná skratka: súbežné úlohy by sa prepisovali. `taskId` je spoločné ID práce nezávislé od hostiteľskej relácie; prevzatie existujúceho ID je explicitný výber zručnosti/používateľa.

`handoff write --input <json> --expected-revision <id>` vytvorí novú nemennú revíziu. Pri nesúlade sa obsah nestratí ani neprepíše; príkaz vráti konflikt s oboma revíziami. Pri súbežnom offline importe vzniknú dve hlavy; ďalšia revízia má oboch rodičov a výslovne vyrieši rozdiel. Nepoužívať pravidlo „posledný čas vyhráva“.

Lokálny zápis revízie: najprv pripraviť a synchronizovať dočasný súbor, potom pod krátkou zápisovou DB transakciou overiť očakávanú hlavu, publikovať revíziu rovnakým postupom ako segment a zaregistrovať ju. Pri zistenom konflikte pred publikovaním ostáva používateľov vstup nezmenený a nezaradí sa ako platná revízia. Po páde medzi publikovaním a DB commitom obnovovať graf z rodičov; ak medzitým vznikla konkurenčná revízia, zachovať obe hlavy a vyžiadať vyriešenie pri ďalšom používaní. Pri prvom vytvorení použiť `--expected-revision none`; pri zlúčení explicitný zoznam rodičov.

Rozhodnutie navyše obsahuje `statement`, `rationale`, `status` (`proposed`, `accepted`, `superseded`, `rejected`), `supersedes` a dôkazy. `accepted` smie označiť explicitné rozhodnutie používateľa alebo schválený projektový zdroj, nie neoverenú domnienku asistenta. Nové používateľovo rozhodnutie nahradí konkrétne staré; staré sa nemaže. Rozpor bez jasného nahradenia zostáva viditeľný.

Zručnosť pri načítaní porovná HEAD a súbory, rozlíši zmenu relevantných častí a upozorní na potrebné opätovné overenie. Nemá zahodiť celý záznam len preto, že pribudol nesúvisiaci commit.

Distilácia tém má kurzor po segmentoch a verziu použitého postupu. Úspešný zápis témy a posun jej kurzora patria do jednej potvrdenej operácie; neúspech ponechá vstup na opakovanie. Opakovanie rovnakých vstupov nesmie vytvoriť ďalšie identické témy. Modelové spracovanie zostáva predvolene manuálne a s rozpočtom. Existujúci Claude distiller môže zostať optimalizáciou Clauda; Codex vykoná rovnaký kontrakt vlastnou zručnosťou bez povinnej dostupnosti modelu Sonnet.

## 11. Zdieľanie medzi klonmi a ochrana hraníc

Na jednom počítači v rovnakom repozitári obaja hostitelia vidia spoločné úložisko okamžite po potvrdení segmentu. Žiadne vzájomné posielanie správ medzi asistentmi nie je potrebné.

Pre samostatné klony implementovať `export --to <directory>` a `import --from <directory> --dry-run`. Balík obsahuje manifest s UUID projektu, schémou, zoznamom súborov a SHA-256, nemenné segmenty, revízie a potrebné staré snímky. Neobsahuje SQLite, lokálne cesty k prepisom, zámky ani frontu. Exportuje konzistentný zoznam už publikovaných súborov; rozpracované dočasné súbory ignoruje.

Import overí UUID, podporovanú schému, hashe a bezpečné relatívne cesty, potom idempotentne pridá chýbajúce objekty. Konflikty revízií zachová. Pri inom UUID skončí chybou; prípadná migrácia identity je samostatný explicitný administrátorský krok. Záznam s rovnakým ID a inými dátami nikdy neprepíše lokálny.

Balík možno preniesť používateľovým spôsobom vrátane Gitu, ale plugin sám nič necommitne ani neodošle. Samotný `git push` aplikácie neprenáša lokálne úložisko v `.git`; túto vlastnosť jasne uviesť v README aj `status`.

Predvolene nearchivovať hodnoty prostredia, celé prečítané tajné súbory a nesúvisiace výstupy nástrojov. Citlivé polia redigovať pred kanonickým zápisom; testovať známe tokenové formáty a označiť redakciu. Filter nie je záruka odstránenia všetkých tajomstiev. Export musí ukázať rozsah dát a umožniť výber relácií; neodosielať automaticky nič do cudzej služby. Surové prepisy zostávajú u hostiteľa.

## 12. Telemetria a dôkaz užitočnosti

Ukladať hostiteľa, model, reláciu, zdrojové počítadlá, čas a kvalitu merania. Rozlišovať nezistené údaje od nuly. Pri Codexe spracovať kumulatívne počítadlá rozdielmi medzi nasledujúcimi odlišnými vzorkami; opakovanie tej istej vzorky nepočítať dvakrát. Pokles znamená reset/generáciu, nie zápornú spotrebu. Prvú kumulatívnu vzorku viesť ako doterajší súčet s neznámym rozdelením po ťahoch.

Pri Claudovi účtovať unikátne dokončené odpovede podľa formátu vzorky, nie každý priebežný záznam ako novú odpoveď. Nepripočítavať cache k vstupu bez overenia významu príslušného hostiteľského poľa. Uchovať pôvodné počítadlá aj normalizované hodnoty s verziou konverzie. Cenové prepočty sú voliteľné, s dátumom cenníka; žiadna natvrdo univerzálna cena cache.

Merania vyhľadávania: počet výsledkov, zobrazené znaky, čas, čerstvosť, použitý dôkaz a úspech úlohy. Počet navigačných krokov uvádzať s mierou pokrytia klasifikátora. Pri vnorených alebo nerozpoznaných volaniach neprisudzovať presnosť, ktorú parser nemá.

Porovnanie so stavom bez pamäte zahŕňa všetky náklady: zachytávanie v kontexte modelu, vyhľadávanie, súhrny, distiláciu a opravné kroky. CPU čas hooku nie je tokenový náklad, ale je súčasťou latencie. Menší výstup vyhľadávania sám o sebe nedokazuje lacnejšie dokončenie úlohy.

## 13. Konkrétne súbory a verejné príkazy

| Súbor/modul | Zodpovednosť |
|---|---|
| `scripts/memex.mjs` | Jednotné CLI, validácia argumentov, verzovaný JSON výstup |
| `scripts/kde.mjs`, `scripts/project.mjs` | Staré cesty, nový koreň, UUID, worktrees a lokálne úložisko |
| `scripts/adapters/claude.mjs`, `codex.mjs` | Čistá normalizácia prepisov bez zápisu na disk |
| `scripts/source-reader.mjs` | Bajtové prírastky, generácie, neúplné riadky |
| `scripts/event-store.mjs` | Validácia, segmenty, deduplikácia a obnova |
| `scripts/memory-index.mjs` | SQLite schéma, migrácie, FTS, čerstvosť a revízie |
| `scripts/archive-projector.mjs` | Markdown a stabilné odkazy, čítanie legacy |
| `scripts/hook.mjs`, `scripts/hooks/claude.mjs`, `codex.mjs` | Deadline, fronta a hostiteľský vstup/výstup |
| `scripts/records.mjs` | Stav úloh, rozhodnutia, revízie a konflikty |
| `scripts/transfer.mjs` | Export/import nemenných objektov |
| `scripts/doctor.mjs` | Schémy, runtime, hooky, zdroje, index a medzery |
| `schemas/*.schema.json` | Kontrakty event/segment/record/bundle/config |
| `tests/fixtures/{claude,codex,legacy}/` | Anonymizované malé skutočné vstupy a očakávania |
| `tests/compatibility/` | Inštalácia, hostiteľské verzie a živé skúšky |

Nové príkazy: `init`, `migrate`, `capture`, `backfill`, `maintenance`, `recall`, `evidence read`, `handoff list/read/write`, `decision list/write`, `export`, `import`, `doctor`. Všetky čitateľské príkazy podporujú `--json` a nesmú meniť konfiguráciu. Dohnanie indexu je prípustný odvodený zápis; vypína sa cez `--no-refresh`.

Staré `archive.mjs`, `search.mjs`, `map.mjs`, `stats.mjs`, `status.mjs` zostanú verejné obaly. Existujúce argumenty a čitateľný výstup zachovať; nové diagnostiky nesmú rozbiť doterajšie parsovanie JSON. Nepridávať nové významy starému `--index`, ktoré by sa plietli s cestou `--index-into`.

Pre nové CLI: návratový kód 0 = úspech, 1 = chyba vstupu/IO, 3 = konflikt identity alebo revízie, 4 = neúplný import/nepodporovaná schéma. Úplné vyhľadanie bez výsledku je úspech s prázdnym poľom. Výsledky z neúplného indexu sa môžu vrátiť s kódom 4 a explicitnou čerstvosťou. Hook obal prekladá chyby do neblokujúcej hostiteľskej odpovede a uchová skutočný stav v diagnostike; nepoužíva slepo CLI exit kódy ako rozhodnutia hostiteľa.

## 14. Migračný a implementačný postup pre Sol

Každá etapa má vlastný kontrolovateľný výsledok. Nevydávať čiastočnú integráciu za dokončenú.

### Etapa 0 — základ a kontrakty

Prečítať tento plán, `AGENTS.md`, aktuálne zdroje a audit. Zaznamenať `git status`, verzie prostredia, spustiť `node --test tests/*.test.mjs`. Vytvoriť anonymizované vstupné vzorky oboch hostiteľov; skutočné súkromné prepisy nevkladať do repozitára. Pridať JSON schémy a testy validácie.

Hotovo: existujúce testy prechádzajú; každé dokumentované podporované vstupné pole má konkrétnu vzorku. Neznáme typy sú testované ako medzera.

### Etapa 1 — projekt a bezpečná migrácia

Implementovať resolver, `init`, `migrate --dry-run`, snímkovanie starých súborov a kontrolu UUID. `migrate` pripraví úložisko vedľa pôvodných dát, overí hashe a počty, až potom atómovo aktivuje nový režim konfigurácie. Zálohu konfigurácie a manifest migrácie ponechá. `--dry-run` nesmie vytvoriť UUID, databázu ani adresáre.

Staré archívy naimportovať ako nemenné legacy zdroje. Ak chýbajú surové prepisy, nič si nedopĺňať. Ak sú dostupné, nový import nesmie zdvojiť už archivovanú históriu: priradenie session/udalostí overiť existujúcimi markermi; pri nemarkerovanom obsahu použiť kontrolovaný sekvenčný súlad. Nejasné párovanie ponechať ako kandidáta, nevymazať ani neskrývať automaticky.

Hotovo: staré súbory majú rovnaké SHA-256 a pôvodné riadkové odkazy fungujú; dva worktrees sa pripoja k jednej pamäti a majú dve mapy. Druhý beh migrácie je bez zmeny dát.

### Etapa 2 — import a obnova

Implementovať adaptéry, prírastkový reader, segmenty, index a spätný import. Najprv explicitné CLI bez hookov. Prepojiť staré obaly na nové jadro iba pri aktivovanom integrovanom režime.

Hotovo: obe formy prepisov produkujú očakávané udalosti; opakované a súbežné čítanie nevytvorí duplikáty; pády na každej hranici zápisu sa zotavia; Codex scenáre z auditu už nemajú tichý nulový výsledok.

### Etapa 3 — obidve inštalácie a životný cyklus

Pridať dispatcher, oddelené hook konfigurácie a natívne balenie zručností. Overiť priamo v čerstvom Claude Code a Codexe. Pri chýbajúcej dôvere hooku `doctor` nesmie tvrdiť, že je zber funkčný len preto, že existuje súbor; rozlíšiť konfiguráciu, pozorované spustenie a overený import. Žiadne obchádzanie hostiteľskej kontroly dôvery.

Hotovo: správy z oboch hostiteľov sa zachytia po ťahu, po obnovení relácie a po zhutnení; merania latencie a výstupných protokolov sú uložené. Nedostupný prepis je viditeľný stav.

### Etapa 4 — použitie spoločnej pamäte

Implementovať `recall`, dôkazy, zručnosť odovzdania, revízie rozhodnutí a prírastkovú distiláciu. Overiť výber podľa vetvy a zachovanie konfliktov. Zjednotiť telemetriu bez zmeny významu historických meraní.

Hotovo: Claude → Codex aj Codex → Claude pokračovanie prejde na nových izolovaných reláciách; rozhodnutie sa dá dohľadať s presným zdrojom a staršia verzia nie je vydaná za aktuálnu.

### Etapa 5 — prenos, hodnotenie a vydanie

Implementovať export/import, overiť druhý klon, dokončiť porovnanie nákladov a aktualizovať README/CHANGELOG/ROADMAP. Navrhovaná verzia balenia je 0.21.0, verzie dátových schém sú samostatné. Oba manifesty musia mať rovnakú verziu. Testovať vydávaný balík, nie iba zdrojový adresár.

Inštaláciu z aktualizovaného balíka overiť novou reláciou; stará otvorená relácia môže mať načítanú predchádzajúcu verziu. Postup preinštalácie vykonať podľa aktuálneho pluginového návodu/skill pri implementácii. Needitovať ručne kópiu v pluginovej cache ako výslednú opravu.

Rollback: vypnúť nové hooky, obnoviť zálohu konfigurácie, ponechať nové úložisko nezmenené na neskoršie obnovenie. Starý plugin môže čítať pôvodné archívy, ale neuvidí automaticky nové segmenty. Pred návratom, ak treba nové dáta v starom formáte, vytvoriť samostatný export Markdownu; nikdy neprepísať staré súbory alebo ich riadky.

## 15. Akceptačné testy

### 15.1 Automatické testy správnosti

| ID | Scenár | Povinný výsledok |
|---|---|---|
| A01 | Existujúcich 14 testov | Všetky prejdú bez zoslabenia tvrdení |
| A02 | Rovnaké session ID u Clauda a Codexu | Dve relácie, správny pôvod |
| A03 | Opakovaný záznam vs. dva rovnaké používateľské texty | Replay raz, odlišné správy obe |
| A04 | `response_item` plus jeho zrkadlo v `event_msg` | Jedna obsahová správa |
| A05 | Volanie a výsledok v rôznych prírastkoch | Jedno správne spojenie podľa ID |
| A06 | Polovica JSON, rozdelená diakritika, CRLF | Bez straty a posunu kurzora za neúplný vstup |
| A07 | Skrátenie/rotácia zdroja | Nová generácia alebo viditeľná medzera, žiadne tiché preskočenie |
| A08 | Neznámy typ a neplatný JSON | Rozlíšená medzera/poškodenie, žiadny falošný úspech |
| A09 | Zabitie pred/po publikovaní segmentu a pred/po DB commite | Opakovanie obnoví presne tie isté udalosti |
| A10 | Súbeh dvoch hostiteľov, dvoch procesov tej istej relácie | Žiadna strata, duplicitné ID ani poškodená DB |
| A11 | Starší index sa dokončí po novšom | Novšia generácia ostane dostupná |
| A12 | Migrácia archívu s riadkovými odkazmi | Byte-for-byte rovnaké staré súbory, platné odkazy |
| A13 | Podpriečinok, medzery/diakritika v ceste, dva worktrees | Jedno správne UUID a úložisko, samostatné mapy |
| A14 | Iný projekt, nesúhlas UUID, vnorený projekt | Žiadny automatický únik alebo zlúčenie pamäte |
| A15 | Dve súbežné revízie rozhodnutia | Zachovaný konflikt; žiadne last-write-wins |
| A16 | Zmena rozhodnutia používateľom | Nové označené aktuálne, staré dostupné ako nahradené |
| A17 | Poškodený/chýbajúci dôkaz | Stav neoveriteľný, nie nesprávna citácia |
| A18 | Reset a opakovanie tokenových počítadiel | Žiadne záporné hodnoty ani dvojité účtovanie |
| A19 | Hook timeout, chýbajúca cesta, zamknutá DB | Neblokuje asistenta; medzera/fronta viditeľná |
| A20 | Export/import dvakrát, rozdielne UUID, poškodený hash | Idempotentnosť a bezpečné odmietnutie nesúladu |
| A21 | Historický text sa snaží meniť pokyny | Vrátený ako citácia, nikdy ako pravidlo hooku |
| A22 | Prekročenie rozpočtu vrátane dlhých metadát | Platný JSON v limite, explicitné skrátenie |
| A23 | Surový zdroj zmazaný po zachytení | Potvrdené dôkazy fungujú zo segmentov |
| A24 | Odstránený worktree a rekonštrukcia derived | Pamäť zachovaná v common-dir, staré dôkazy zo snímky |

Použiť riadené body pádu v testovacom procese, nie iba ručné prerušenie. Pri súbehu použiť procesové bariéry na vynútenie poradia. Pre testy poškodenia meniť iba dočasné kópie.

### 15.2 Živé skúšky medzi hostiteľmi

Pripraviť 12 úloh: 2 odovzdania Claude → Codex, 2 Codex → Claude, 2 po zhutnení, 2 po zmene rozhodnutia, 2 medzi vetvami a 2 s nedostupným dôkazom/konfliktom. Použiť jedinečné kontrolné rozhodnutia, ktoré nie sú uhádnuteľné z kódu. V novom rozhovore neposkytnúť správnu odpoveď v zadaní.

Pre každú skúšku uložiť anonymizované zadanie, očakávaný dôkaz, verzie, dostupné zručnosti, hook receipts, skutočnú odpoveď, nájdené ID a náklady. Úspech znamená správny obsah aj pôvod a rozsah platnosti; uhádnutý správny text bez zdroja nestačí. Pri konfliktnej úlohe je úspech explicitne rozpoznať konflikt, nie zvoliť ľubovoľnú odpoveď.

Ak jeden hostiteľ nie je dostupný, automatické fixture testy ho nenahrádzajú. Označiť etapu ako čiastočne overenú a uviesť presnú chýbajúcu skúšku; nevymyslieť výsledky.

### 15.3 Výkon a tokeny

Použiť dve oddelené sady: historické benchmarky bez zmeny úloh na regresiu a nové nezávislé úlohy na hodnotenie integrácie. Zachovať mapové váhy a predvolený počet výsledkov, kým nové dáta neukážu zlepšenie; integračná práca nie je dôvod meniť ranking naslepo.

Škálovací test: 10, 100 a 1 000 relácií; pri každej rovnaký 4 KiB prírastok. Aspoň 30 behov, p50/p95, objem prečítaných bajtov, RAM a veľkosť indexu. Syntetické dáta použiť pre súbeh a výkon, nie ako dôkaz kvality vyhľadávania. Povinné je preukázať, že bežný import nečíta celú doterajšiu históriu; prázdny beh nemá lineárne rásť s jej objemom.

Porovnanie užitočnosti: aspoň 24 párovaných úloh, rovnaký model/verzia/nastavenie v rámci páru, čerstvé izolované relácie a checkouty. Vetva A má kód a bežné nástroje; vetva B navyše Memex s vopred pripravenou rovnakou históriou. Oddeliť úlohy o kóde, kde baseline môže uspieť, od úloh o minulých rozhodnutiach, kde baseline historický zdroj nemá. Poradie vyvážiť, výsledky nevracať do pamäte použitej v ďalších pokusoch. Spotrebné experimenty spustiť v dohodnutom rozpočte; nevytvárať automaticky desiatky platených relácií iba kvôli testu.

Reportovať úspešnosť s dôkazom, nesprávne prijaté zastarané rozhodnutia, latenciu, vstup/výstup/cache, náklady na prípravu pamäte a ich amortizáciu pri 1/10/100 použití. Párované rozdiely uviesť s intervalmi neistoty. Pri malej vzorke nerozhodný výsledok zostáva nerozhodný.

Podmienky vydania: všetky deterministické testy prejdú; všetkých 12 živých scenárov splní očakávanie na overovaných hostiteľoch; žiadne tiché poškodenie a žiadne autoritatívne použitie zastaraného rozhodnutia. Úsporu tokenov komunikovať iba pri nameranom zlepšení bez zhoršenia úspešnosti. Funkčná kompatibilita a ekonomická výhodnosť sú dve samostatné záverečné hodnotenia.

## 16. Čo teraz nepridávať

Nepridávať vektorovú databázu, graf vzťahov, viacstupňové modelové prehodnocovanie každého výsledku, automatické sumarizovanie celého archívu ani trvalý synchronizačný server. Tieto rozšírenia najprv potrebujú konkrétnu zlyhávajúcu vzorku a porovnávací experiment. Väčší počet informácií sám osebe ešte nevyberá správne riešenie.

Pripraviť verzované rozhrania tak, aby sa neskôr dal doplniť nový vyhľadávač či dopravný mechanizmus. Teraz majú prednosť import Codexu, spoločná identita, spoľahlivý zápis, dostupná zručnosť a overiteľné odovzdanie práce.

## 17. Zadanie na odovzdanie GPT-5.6 Sol

> Implementuj `PLAN-INTEGRACIE-CLAUDE-CODEX.md` po etapách 0–5. Zachovaj aktuálne necommitnuté opravy Memexu 0.20.0, kompatibilitu Claude Code príkazov a nezmenené staré archívy. Vytvor jedno jadro projektovej pamäte s adaptérmi Claude/Codex, spoločným úložiskom pre worktrees a samostatnými mapami kódu. Dodrž kontrakty udalostí, obnovu po páde, revízie rozhodnutí a rozpočty hookov. Najprv vytvor a over testovateľnú lokálnu implementáciu; nepublikuj plugin ani neprepisuj používateľove globálne nastavenia. Pri chýbajúcom hostiteľovi alebo rozpočte na živé experimenty dokonči nezávislú implementáciu a presne označ neoverené kritériá. Výsledky ukladaj do novej datovanej zložky v `audit/`, historické merania neprepisuj. Na konci uveď splnené etapy, testy, skutočne overené hostiteľské verzie, migračný postup, rollback a zostávajúce obmedzenia. Nevyhlasuj úsporu tokenov bez párovaného merania.
