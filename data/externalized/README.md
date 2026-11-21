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

These files are still master `ae6bf01`'s, because ja2-node follows master there until the issue reverts it:

| File | Issue |
|---|---|
| `light-templates.json` (not in v0.22.1) | #105 (the shipped light templates) |
| `strings/tooltips-eng.json` (not in v0.22.1) | #114 (master's informative tooltips) |

v0.22.1 has no `mercs-AIM-listings.json`: its A.I.M. order is `AimMercArray[i] = i`, which `../tables/laptop.json`
transcribes (`aimOrder`). Its `strategic-map-towns.json` has no militia map corners, and v0.22.1 takes each town's
smallest sector, which puts Balime's grid a row too low; vanilla's corners are in `../tables/militia-maps.json`
(original-bugs "Militia map corners").

`armours.json` is v0.22.1's, but the loader reads the Kevlar vest with Compound 18 at vanilla's wear of 15, not its
25 (original-bugs "Compound 18 Kevlar vest wear", `src/content/items/items.ts`).

Master's `STR_LOSES_1_HP` line, which ja2-node keeps (deviation "Max life lost while dying", #114), is not in v0.22.1's
translations: `../strings/kept-master-lines.json` holds it in every language.
