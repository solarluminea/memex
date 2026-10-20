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
const TAJOMSTVA = [
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, 'sk-ant'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'github'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'aws'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'slack'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}/g, 'jwt'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'private key'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, 'bearer'],
];
export const redakcia = (t) => TAJOMSTVA.reduce((s, [vzor, meno]) => s.replace(vzor, `[redacted:${meno}]`), t);

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
    if (FAILURE.test(l)) return l.trim().slice(0, 160);
  }
  return null;
}
