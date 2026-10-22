/**
 * Čo majú prevodníky prepisov spoločné — Claude Code aj Codex.
 *
 * Presunuté z `archive.mjs`, keď pribudol druhý hostiteľ. Redakcia tajomstiev a
 * riadok zlyhania musia platiť rovnako pre oboch: archív Codexu ide do toho
 * istého gitu a pravidlo, ktoré by sa skopírovalo, sa raz rozíde.
 */

/*
  Tajomstvá sa do archívu nezapisujú.

  README hovorí „archív commitni" — je to pamäť projektu. Zároveň doň ide text
  používateľa a príkazy shellu do dvesto znakov, takže kľúč vložený do
  rozhovoru alebo `export TOKEN=…` by sa dostal do gitu a tam už zostáva.
  Archív je jediná kópia, takže sa neredigujú riadky spätne; redakcia platí na
  to, čo sa práve zapisuje.

  Vzory sú úzke a kotvené na známe tvary. Široký vzor na „niečo dlhé a
  náhodné" by zožral hashe commitov a base64 v bežnom rozhovore, čiže presne
  ten druh tichej straty, ktorý tento projekt inde zamieta. Toto nie je záruka,
  že tajomstvo neprejde — je to poistka na formáty, ktoré sa dajú rozpoznať.

  ⚠️ Pri strate stavu sa prepis spred značiek `memex:` porovnáva s tým, čo
  prevodník vyrobí teraz. Ťah, ktorý bol zapísaný neredigovaný, sa tým prestane
  zhodovať a pripíše sa druhýkrát. Týka sa to len archívov spred 0.20.0 —
  novšie ťahy majú značku a obsah sa im neporovnáva.
*/
/*
  Začiatok tajomstva: nie písmeno ani číslica pred ním — alebo doslovné `\n`.

  `\b` tu nestačilo. Výstup nástroja býva JSON s escapovanými koncami riadkov,
  takže pred kľúčom stojí doslovné `\n` a medzi `n` a `g` z `ghp_` žiadna
  hranica slova nie je. Kľúč na začiatku riadku v takom texte prešiel celý.
*/
const Z = String.raw`(?<=^|[^A-Za-z0-9_]|\\[nrt])`;
const v = (telo, prepinace = 'g') => new RegExp(Z + telo, prepinace);

/*
  Zoznam rozšírený v 0.27.0 o formáty, ktoré sa na tomto stroji naozaj
  vyskytujú: archivuje sa aj Codex, a s ním kľúče OpenAI. Na projekte, kde
  memex beží, zablokovala commit kontrola tajomstiev práve kvôli kľúču OpenAI
  v súboroch relácií — vtedy mimo archívu, ale tou istou cestou by prešiel aj
  doň. Vzor `sk-ant` musí ísť pred všeobecným `sk-`.
*/
const TAJOMSTVA = [
  [v(String.raw`sk-ant-[A-Za-z0-9_-]{20,}`), 'sk-ant'],
  [v(String.raw`sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}`), 'openai'],
  [v(String.raw`sk-[A-Za-z0-9]{32,}`), 'openai'],
  [v(String.raw`gh[pousr]_[A-Za-z0-9]{20,}`), 'github'],
  [v(String.raw`github_pat_[A-Za-z0-9_]{20,}`), 'github'],
  [v(String.raw`(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`), 'aws'],
  [v(String.raw`AIza[0-9A-Za-z_-]{35}`), 'google'],
  [v(String.raw`(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}`), 'stripe'],
  [v(String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`), 'slack'],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, 'slack webhook'],
  [v(String.raw`eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}`), 'jwt'],
  // Telo kľúča má stovky znakov; 37 znakov medzi BEGIN a END je zástupný text z návodu.
  [/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]{64,}?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g, 'private key'],
  [v(String.raw`[Bb]earer\s+[A-Za-z0-9._~+/=-]{20,}`), 'bearer'],
  // Heslo v adrese: `postgres://meno:heslo@server`. Meno zostáva, heslo nie.
  [/(?<=[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}(?=@)/gi, 'password'],
];
/*
  `NIECO_TOKEN=hodnota` — premenná, ktorej meno hovorí, že je tajná.

  Komentár vyššie odjakživa uvádzal `export TOKEN=…` ako dôvod redakcie, a
  pravidlo naň neexistovalo. Meno zostáva, aby bolo vidieť, čo sa nastavovalo;
  hodnota od ôsmich znakov, aby `TOKEN_LIMIT=500` zostalo čitateľné.

  Hodnota je znak kľúča — písmená, číslice, `_-+/=.` — a má aspoň jednu
  číslicu alebo dvadsať znakov. Prvá verzia brala čokoľvek bez medzery a nad
  skutočným archívom zachytila 17 hodnôt, z ktorých ani jedna nebola kľúč:
  `ONLYOFFICE_JWT_SECRET=…s…` (výpustka z výpisu), regulárny výraz,
  slovenské slovo. Náhodný kľúč číslicu skoro vždy má.
*/
const PREMENNA = /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)((?=[A-Za-z0-9_+/=.-]*\d)[A-Za-z0-9_+/=.-]{8,}|[A-Za-z0-9_+/=.-]{20,})\3(?![^\s"'])/g;

export const redakcia = (t) => TAJOMSTVA
  .reduce((s, [vzor, meno]) => s.replace(vzor, `[redacted:${meno}]`), String(t))
  .replace(PREMENNA, (_, meno, rovna, uvodzovka) => `${meno}${rovna}${uvodzovka}[redacted:env]${uvodzovka}`);

/*
  Prvý identifikátor zo vstupu volania — `[Tool: Agent subagent_type=…]`.

  Bol v `archive.mjs` aj v `codex.mjs`, dvakrát rovnako a dvakrát bez
  redakcie: `{token: "ghp_…"}` sa archivovalo ako `[Tool: prihlas token=ghp_…]`.
  Hodnota bez medzier do šesťdesiatich znakov je presne tvar kľúča.
*/
export function prvyArgument(i) {
  for (const [k, v] of Object.entries(i ?? {})) {
    if (typeof v === 'number' || typeof v === 'boolean') return ` ${k}=${v}`;
    if (typeof v === 'string' && v.length <= 60 && v.length > 0 && !/\s/.test(v)) return redakcia(` ${k}=${v}`);
  }
  return '';
}

/*
  The one line of a tool result worth keeping.

  Dropping tool results is what makes this archive 3.6 MB instead of 467 MB, and
  a truncation experiment (first 500 characters of everything) grew it fourfold
  while adding no searchable sentence. That measurement is what this rule is
  carved out of, and the carve-out is narrow on purpose: **one line**, and only
  when it names a failure.

  Measured on three real transcripts: 32 such lines, 8.3 kB, which is 0.047 % of
  the archive. The reason to keep them is that a compiler error or a failing
  assertion is the one kind of tool output somebody searches for later — "we've
  seen this before" is worth a tenth of a percent.

  The pattern is deliberately anchored to line starts and known formats. An
  unanchored /error/ matches every JSON payload with an `error` field, which is
  how the first version filled up with API responses that failed at nothing.
*/
export const FAILURE = /^\s*(Error:|Uncaught |[\w./\\-]+\(\d+,\d+\): error TS\d+|error TS\d+|FAIL |AssertionError|Traceback \(most recent)/;

export function failureLine(result) {
  const text = typeof result === 'string' ? result : '';
  if (!text) return null;
  for (const l of text.split('\n')) {
    // Redakcia pred orezaním: `curl -H "Authorization: Bearer …"` v chybe
    // príkazu sa do archívu zapisovalo celé, hoci ten istý kľúč v príkaze nie.
    if (FAILURE.test(l)) return redakcia(l.trim()).slice(0, 160);
  }
  return null;
}
