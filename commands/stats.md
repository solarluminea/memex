---
description: What navigation actually costs — steps and tokens per edit, measured
---

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/stats.mjs` and read the numbers back in
your own words. Do not paste the table.

What the rows mean:

- **steps before 1st edit** — lookups and reads between "asked" and "changed
  something". This is the navigation cost. If a map or an index helps, this is
  where it shows.
- **lookups / reads per edit** — divided by edits, not by sessions, because a
  session can be ten minutes or a whole day.
- **fresh input tokens per edit** — what is actually paid at full price.
  Cached input costs a fraction, so it is reported separately.

Two rules when talking about this:

1. **Never call a change a saving.** These are counts. A drop between the halves
   can mean easier tasks just as easily as better navigation, and the tool
   deliberately does not guess which.
2. **A trend over a handful of sessions is not a trend.** Say how many sessions
   each half holds; with fewer than about ten on each side, report the numbers
   and say plainly that it is too early.

If the user asks whether some change helped, the honest answer needs the halves
to straddle it and enough real work on both sides.
