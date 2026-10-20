# Memex pre Codex a ChatGPT

Memex bol pôvodne plugin pre Claude Code. Od tejto verzie má aj tri veci pre
OpenAI stranu: archív relácií Codexu, MCP server a natívny Codex plugin
s hookmi. Archív je spoločný — rozhodnutie z relácie v Claude Code nájde
Codex a naopak.

Čo funguje bez akejkoľvek integrácie, platí naďalej: indexovanie a hľadanie
v Markdown archíve aj mapa kódu sú obyčajné Node skripty (Node 22.5+, žiadne
npm závislosti).

## Čo pribudlo

`scripts/codex.mjs` archivuje relácie Codexu. Codex ich ukladá do
`~/.codex/sessions/RRRR/MM/DD/rollout-*.jsonl`, všetky projekty spolu; skript
vyberie tie, ktorých `cwd` leží v tomto projekte, a zapíše ich do toho istého
archívu ako Claude (`.memex/archive/codex-<id>.md`). Ťahy majú hlavičku
`## USER` / `## CODEX`, volania nástrojov sú zhrnuté jedným riadkom
(`[Tool: exec_command] rg -n …`, `[Tool: apply_patch src/a.ts]`), tajomstvá
sa redigujú rovnako ako pri Claudovi. Relácie, ktoré Codex sám importoval
z Claude Code, sa preskakujú — tie už v archíve sú zo zdroja.

`scripts/mcp.mjs` je MCP server bez závislostí. Nástroje:

| nástroj | čo robí |
|---|---|
| `memex_search` | hľadá v histórii; pred hľadaním dobehne index, ak zaostáva |
| `memex_read` | presné riadky z archívu alebo stopy (len odtiaľ, nie z celého disku) |
| `memex_file_history` | ktoré relácie menili daný súbor |
| `memex_map` | ktorý súbor otvoriť — celou vetou; bez úlohy mapu prestaví |
| `memex_outline` | osnova súboru s číslami riadkov |
| `memex_status` | zdravie pamäte |
| `memex_sync` | zarchivuje Codex aj Claude relácie a prestaví index |

`.codex-plugin/plugin.json` je natívny Codex manifest: zručnosti z
`codex/skills/` a dva hooky — `SessionStart` vloží trojriadkové smerovanie na
pamäť (nie pamäť samotnú) a `Stop` po každom ťahu dopíše aktuálnu reláciu do
archívu.

## Inštalácia pre Codex

1. **Archív založ raz, ručne.** Hooky ho v projekte, ktorý si ho nepýtal,
   nikdy nezaložia. V koreni projektu:

   ```
   node C:/cesta/k/memex/scripts/codex.mjs
   node C:/cesta/k/memex/scripts/search.mjs --index
   ```

2. **MCP server.** Do `~/.codex/config.toml`:

   ```toml
   [mcp_servers.memex]
   command = "node"
   args = ["C:/cesta/k/memex/scripts/mcp.mjs"]
   ```

   alebo príkazom `codex mcp add memex -- node C:/cesta/k/memex/scripts/mcp.mjs`.
   Nástroje berú voliteľný argument `project` (absolútna cesta k projektu);
   zručnosť Codexu ho tam dáva. Ak chceš server pevne pre jeden projekt,
   pridaj `env = { MEMEX_PROJECT_ROOT = "C:/cesta/k/projektu" }`.

3. **Plugin (zručnosti + hooky).** Pridaj marketplace a nainštaluj plugin
   `memex`. Z GitHubu:

   ```toml
   [marketplaces.memex]
   source_type = "git"
   source = "https://github.com/solarluminea/memex.git"
   ```

   alebo z lokálneho klonu `source_type = "local"`, `source = 'C:\cesta\k\memex'`.
   Codex sa pri zmenených hookoch spýta na dôveru — treba potvrdiť.

4. **Bez pluginu** stačí MCP server a odstavec v `AGENTS.md` projektu —
   hotový text je v [codex/AGENTS-memex.md](codex/AGENTS-memex.md). Relácie
   potom archivuj ručne (`memex_sync` alebo `codex.mjs`).

Over to v novej relácii otázkou typu „prečo sme v tomto projekte zvolili X?" —
Codex by mal zavolať `memex_search` a citovať súbor s riadkami.

## ChatGPT (konektor)

ChatGPT sa nepripája na lokálny proces, potrebuje verejnú HTTPS adresu.
Server má preto aj HTTP režim:

```
cd C:/cesta/k/projektu
set MEMEX_MCP_TOKEN=dlhy-nahodny-retazec
node C:/cesta/k/memex/scripts/mcp.mjs --http 8765
cloudflared tunnel --url http://127.0.0.1:8765
```

V ChatGPT: Settings → Apps & Connectors → Advanced → Developer mode, potom
nový konektor s adresou `https://<adresa-tunela>/mcp/<token>`, bez
autentifikácie. Token je súčasť cesty: bez neho server vráti 404.

Na čo myslieť: archív obsahuje celé rozhovory a cez konektor odchádza k
OpenAI. Server počúva len na 127.0.0.1 a v HTTP režime ignoruje argument
`project`, aby vzdialený volajúci nemohol ukázať na iný priečinok. Bežný
(nevývojársky) režim ChatGPT očakáva nástroje `search` a `fetch` v presnom
tvare — tie zatiaľ nie sú, funguje to v Developer mode.

## Čo zatiaľ nie je overené

- Formát prepisov Codexu nie je verejné stabilné rozhranie. Adaptér je
  postavený na skutočných reláciách Codex Desktop 0.153 (`response_item`
  so správou, `function_call`, `custom_tool_call` / `exec`, výstupy).
  Iná verzia môže tvar zmeniť; nerozpoznané riadky sa preskočia, nič sa
  nepokazí, ale môžu v archíve chýbať.
- Či Codex v hookoch pluginu dosadí `${CLAUDE_PLUGIN_ROOT}` (Claude Code to
  robí; Codex podľa dokumentácie poskytuje kompatibilné premenné). Ak hook
  hlási, že nenašiel skript, nahraď premennú absolútnou cestou.
- Kontrola stavu (`status.mjs`, hlásenie „memory is behind") porovnáva archív
  zatiaľ len so zdrojom Claude Code, nie s reláciami Codexu.
- Telemetria (`stats.mjs`) Codex nemeria.
- Destilácia stopy (`memex-distill`) je v Codexe len zručnosť, ktorá ho
  odkáže na postup Claudovho destilátora; samostatný podagent nemá.

Úplný plán spoločnej pamäte (identita projektu naprieč worktrees, spoločné
úložisko, odovzdanie práce) je v
[PLAN-INTEGRACIE-CLAUDE-CODEX.md](PLAN-INTEGRACIE-CLAUDE-CODEX.md). Toto je
jeho prvá praktická časť, nie celý plán.
