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
| `items.json`, `weapons.json`, `magazines.json`, `calibres.json` | #112 (item containers without placeholders) |
| `imp.json`, `mercs-profile-info.json` | #111 (six I.M.P.s, gear conditions, 200 profiles) |
| `light-templates.json` (not in v0.22.1) | #105 (the shipped light templates) |
| `mercs-AIM-listings.json` (not in v0.22.1) | #116 (the A.I.M. order) |
| `strategic-map-towns.json` | #116 (`militiaMapBaseSector`, vanilla's militia map corners) |
| `strings/translation-*.json` | #114 (the options and `STR_LOSES_1_HP`), until its commit |
| `strings/tooltips-eng.json` (not in v0.22.1) | #114 (master's informative tooltips) |
