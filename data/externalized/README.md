# data/externalized

JSON data copied unchanged from JA2 Stracciatella `assets/externalized/` at the release `v0.22.1` (commit `11e9430`,
<https://github.com/ja2-stracciatella/ja2-stracciatella>): item, weapon, army, strategic, dealer and NPC script tables
plus the `strings/` and `translation_tables/` directories. Stracciatella extracted these tables from the Jagged
Alliance 2 source code; they are covered by the SFI-SCLA (see `../../LICENSE`). Do not edit by hand; re-copy from the
reference release instead.

`resource_packs/` holds Stracciatella's file lists of known releases for its data version guess: file names, sizes and
MD5 hashes, no game content. The server reads them at start (`src/server/data-version.ts`); they are no rule tables.

Exception: `script-records-NPCs.json` is not copied, because its comments quote dialogue from the game data; its
records without the comments are in `../tables/npc-script-records.json` (`tools/transcribe/npc-script-records.ts`).

`strings/tooltips-eng.json` is master `ae6bf01`'s, as v0.22.1 has none: it holds master's informative tooltips, which
#114 keeps as a client text behind the `informative_tooltips` key, off as shipped (deviation "Game policy keys").

v0.22.1 has no `light-templates.json` either: it reads the user's `.LHT` files (`20`).

v0.22.1 has no `mercs-AIM-listings.json`: its A.I.M. order is `AimMercArray[i] = i`, which `../tables/laptop.json`
transcribes (`aimOrder`). Its `strategic-map-towns.json` has no militia map corners, and v0.22.1 takes each town's
smallest sector, which puts Balime's grid a row too low; vanilla's corners are in `../tables/militia-maps.json`
(original-bugs "Militia map corners").

`armours.json` is v0.22.1's, but the loader reads the Kevlar vest with Compound 18 at vanilla's wear of 15, not its
25 (original-bugs "Compound 18 Kevlar vest wear", `src/content/items/items.ts`).

Master's `STR_LOSES_1_HP` line, which ja2-node keeps (deviation "Max life lost while dying", #114), is not in v0.22.1's
translations: `../strings/kept-master-lines.json` holds it in every language.
