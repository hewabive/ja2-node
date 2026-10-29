# 32 — Stub pack, performance, launcher and data tables

**Scope.** The stub pack (generated content that runs every platform feature and a campaign without original data),
oracle-free benchmarks and their targets, session hosts, CI and test gates, the launcher page, and the data tables and
original files the platform reads. Siblings: `27` (saves, options), `31` (sound, video, localization).

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…` and
`src/externalized/…` to `reference/stracciatella/`. ja2-node paths start with `src/`, `data/`, `stubs/`, `tools/`,
`tests/` or `.github/`. "(inferred)" marks conclusions not traced end to end.

---

## 1. Stub pack

### 1.1 Scope

Every feature's done criterion is "also runs on stubs, CI only on stubs" (`01` §4.4). The pack lets a campaign be played
from a new game towards the Queen's death through MCP and in the browser (sound, music, a splash video, saves, the
canvas screens, English or Russian UI labels) and gives every platform feature content that exercises it. It is no
replica of every sector or quest: narrative content stays the minimum the tests and the stub campaign path need
(`01` §8, "logic stubs are game design"). Items, weapons, dealers, the army and the strategic tables come from
`data/externalized` for every data version and need no stubs. The stub skin (UI art of the canvas screens): `28` §4.

### 1.2 Licence and the SFI-SCLA list

The stub content is dedicated to the public domain under CC0 1.0 (`stubs/LICENSE.txt`, copied into the pack with
`stubs/NOTICE.txt`, which lists what the dedication covers). Exceptions:

- the generator code (`stubs/**/*.ts`) stays SFI-SCLA with the rest of the code;
- the Stub Pixel fonts are OFL (§1.6.5);
- a file that only ties the content to the game, listing its paths, sectors, tile or animation slots, glyph numbers or
  map data from Stracciatella's tables, stays SFI-SCLA and goes on the notice's list. The list today:
  `stubs/maps/sector-kinds.json`, `aliases.json`, `binarydata/ja2bin.dat`, `world/binarydata/ja2set.dat`,
  `translation_tables/translation-table-stub.json`, `interface/b_map.pcx` (the map board coloured by the traversability
  data); `stubs/build.test.ts` checks that every listed file exists.

Everything else must be own work, so that the dedication can cover it.

### 1.3 Content rules

- Nothing is traced, sampled or derived from the original data: sounds are synthesized, text is written fresh, maps are
  drawn in the ASCII format (`01` §4.4); names follow the original paths only so that one content table serves both.
- Stub art draws what the layouts require (rectangles of the declared size, labels in the stub font, simple shapes),
  never the original's look: no frames, textures, icons, ornaments or colour schemes taken from its screens.
- Stub texts stay generic: they do not retell the original's story or use the names of its characters and places; the
  game's identifiers appear only as keys.
- The build is deterministic (same bytes every build); generators take no time or randomness from the system.
- Every new stub family gets a decoder round-trip test in `stubs/build.test.ts`.

### 1.4 Build, mounting and aliases

- **Build.** `pnpm stubs` (`stubs/build.ts`, `buildStubs`) writes the pack to `dist/stubs` (about 1,200 files, 17 MB,
  about 1.5 s on the development VM) with `README.txt`, `LICENSE.txt` and `NOTICE.txt`. The build goes into a sibling
  folder that is then renamed over the pack (`replaceStubPack`, `stubs/ensure.ts`), so the pack changes in one step, not
  file by file. Budgets in `stubs/build.test.ts`: media folders (`synth`, `music`, `mercedt`, `intro`, `fonts`,
  `cursors`, `interface`, `laptop`, `loadscreens`) below 7 MiB, the splash below 64 KiB.
- **Rebuild only on change.** `pnpm dev` and the campaign bot call `ensureStubPack`, which rebuilds only when the
  inputs digest differs from the one recorded in `dist/stubs.inputs`: SHA-256 over the modules `stubs/build.ts`
  imports (relative imports, matched like `tools/check-imports.ts` does), every non-test file of `stubs/` and `data/`
  (the only folders the build reads at run time), `pnpm-lock.yaml` and the Node version. The check takes about 0.1 s.
  `pnpm stubs` always rebuilds and records the digest too.
- **Data version** without original data: `stubs` (`31`), i.e. English text and EDT mode, the stub glyph table.
- **Mounting.** `openDataVfs` (`src/node/data-vfs.ts`) mounts the pack (`JA2_STUBS_DIR`, default `dist/stubs`) as the
  stubs layer under the `stubs/` prefix, after the repository's `data/` and the original data (`DirLayer`,
  `src/node/dir-layer.ts`). Content loaders probe the original name first and `stubs/<name>` second (`readLayered` in
  `src/content/narrative/npc-records.ts`, `sectorMapPath`): original files always win, the pack fills only what the data
  lacks. `TextService` and `GET /vfs/<path>` fall back to `stubs/<path>` only on the stub data version (`29` §25), so
  a client asks for `sounds/door open 01.wav` or `speech/000_108.wav` on both data sets.
- **Aliases.** `aliases.json` at the pack root (`src/content/vfs/aliases.ts`, format `ja2-node vfs aliases v1`) lets
  many original names share one generated file: the stub layer lists each alias as a file that reads its target; real
  files win; an alias to a missing file or to another alias fails the mount. Used by sector kinds (§1.6.1), fonts
  (§1.6.5), sounds, speech, faces, item pictures and load screens.

### 1.5 Contents

| Area | Stub pack | Original (for scale) |
|---|---|---|
| Sector maps | 14: hand-made A9, A10, A10_b1, D5, N7, P3, P3_b1; `village` (the stub sandbox map, `STUB_SANDBOX_MAP`); `wilderness`, loaded by every sector without another map; five kind maps behind the sector aliases of `stubs/maps/sector-kinds.json` (§1.6.1) | 256 surface sectors, 36 underground levels, alternate maps |
| Tileset | tileset 0 with 29 of 151 tile types (§1.6.4) | every tileset of `ja2set.dat`, all types |
| Soldiers | 5 sheets (stand, walk, run, crouch, prone) × 8 directions for all 396 surfaces (`stubs/soldiers.ts`); an invented script for each of the 311 animation states (`stubs/anim-scripts.ts`); palettes | 396 surfaces per body |
| Structures | wall, barrel, door, stone wall and window, wooden and wire fence, sandbags, three roofs, cliff; 15 person and 83 corpse structure files | 1,442 JSD |
| Profiles | 44: A.I.M. 0–11, M.E.R.C. 42, R.P.C. 59 and 65, 25 NPCs, vehicles 160–163 (§1.6.3) | 159 slots: 40, 11, 18, 85, 4 |
| NPC scripts | 21 NPCs plus `000.npc` and two meanwhile sets; 23 NPC and 6 civilian EDTs | about 103 scripts, civilian and sector quote files, `miners.npc`, `d_NNN.edt` |
| Merc text | `mercedt/NNN.edt` for A.I.M. 0–11, M.E.R.C. 42, R.P.C. 59 and 65: 117 invented quotes each | 1 EDT per merc |
| Other text | `binarydata/itemdesc.edt` (the 31 items the stub campaign and tests use), `credits.edt` (the credit control codes, `31`), `email.edt` (the new-game mails, the I.M.P. and M.E.R.C. intros), the help and laptop EDTs of the stub skin (`28` §4) | `binarydata/*.edt` |
| Locks | 2 (`stubs/locks.json`) | `locks.bin` |
| Sounds | 90 synthesized cue classes (`synth/sfx`) behind every sound path of the tables; 42 battle voices for three body classes (`synth/battle`) behind the generic voice paths (`m_`, `f_`, `bad0-2`, `bad7-8`, `kid0-1`); `ambient/0.bad` for the stub tileset (§1.7) | 370 + 1,581 WAV, `ambient/*.bad` |
| Music | one chiptune loop (about 4 s) per track of `music.json` (`stubs/music.ts`): 14 files named as there | 14 tracks, up to two minutes |
| Speech | one IMA ADPCM blip and `.gap` per stub speaker and quote family (`synth/speech`, `stubs/speech.ts`), behind every merc and NPC quote that has stub text, so the speech and lip paths run; blip lengths are unrelated to the text | 8,568 WAV, 8,353 `.gap` |
| Video | `intro/splashscreen.smk` (a title card and a tone, 2 s; `stubs/video.ts`, `stubs/smk-encode.ts`, `31`); the other ten names are missing | 11 Smacker files, 70 MB |
| Fonts | two STI fonts (Stub Pixel 12 and 16 Bold) behind the 17 font names, the stub glyph table (§1.6.5) | `fonts.slf`, the glyph tables |
| UI art | the stub skin (`stubs/ui/`, `28` §4): labelled screens and buttons, cursors, faces, item pictures, the map board, radar maps, load screens | the other SLFs |

### 1.6 Maps, characters, tiles and fonts

#### 1.6.1 Sector kinds and kind maps

`stubs/maps/sector-kinds.json` (built by `stubs/sector-kinds.ts`) gives every sector the strategic tables name a kind
and a map. Kind maps (`stubs/maps/{town,mine,cave,camp,airfield}.map.txt`) are sealed rooms of stone walls with
windows, closed doors and flat climbable roofs:

| Map | Sectors | Layout |
|---|---|---|
| `town` | 22 town sectors; prison (I13, J9) | a shop with a placement for each of the nine stub dealers (only the one whose profile lives in the loaded sector appears), two houses, a jail whose three locked cells hold the Alma captive gridnos 9208, 9688 and 9215 (`merc-fate.ts`); the garrison at four posts of five |
| `mine` | mine entrances B2, D4, D13, H3, H8, I14 | the head miner's office with a placement per head miner, a shaft house whose exit grid leads down, a settling pond, a cliff ridge |
| `cave` | 17 mine levels, 13 lair levels, 4 other basements (Tixa's dungeon, Orta's cellar, the statue tunnel) | tunnels in cliff rock with 12 creature slots, a creature-queen slot (body 10), four miners, a ladder up |
| `camp` | 4 SAM sites, 22 garrison sectors (the roads to Meduna, the roadblocks) | barracks, a store and a launcher inside low and high sandbags; garrison at four posts of five |
| `airfield` | airport B13; Skyrider's four alternate maps `B15_a`, `C16_a`, `D12_a`, `E14_a` | a hangar, a shed, a wooden fence and a helipad around Skyrider's arrival gridno 8842, his placement 4 tiles from it |
| hand-made `p3` | palace P3 | the `QUEEN_DEFENCE` slots below |

The other hand-made maps and `wilderness`: §1.5. The build checks the table (sector names, no sector twice, every map
compiled, no kind over a hand-made map) and turns each listed sector into an alias of its kind's map, so `sectorMapPath`
(`src/content/strategic/sector-maps.ts`) finds `stubs/world/maps/d13.dat` without a code change; original maps still
win. `stubs/sector-kinds.test.ts` checks the table against `strategic-map-towns.json`, `strategic-mines.json`, the SAM
sites, the garrison groups, the underground sectors, the creature lairs and Skyrider's placements.

Every surface map has the four entry points (generated edgepoints, `edgepoints.ts`) and at least 20 enemy slots, the
largest garrison of the compositions, because `AddSoldierInitListEnemyDefenceSoldiers` places soldiers on the map's
enemy placements only: a group member without a slot would be counted in battle but never placed, and his group would
keep its count after the battle. P3 has 32 elite slots for `QUEEN_DEFENCE` (a west wing over the stairs with the six
priority elites, the optional elites in a keep far to the south-east, Derek and Oliver in the gatehouse, so a squad can
fight its way to the stairs), N7 20 for `LEVEL1_DEFENCE`. NPC placements carry a `STAYINSECTOR` schedule (an
unscheduled civilian would get the default come-and-go schedule, `Strategic/Scheduling.cc:917-955`).

#### 1.6.2 Same-sector exits

The stub map format accepts `exit: x y -> here z=<level> at X Y`, written as sector 0,0; `withSectorExitGrids`
(`src/content/strategic/sector-maps.ts`, called by `loadTacticalWorldInputs` in `src/content/world/tactical-world.ts`)
resolves it to the sector named by the map file, so one mine map leads down from every mine and one cave ladder up to
the surface above. Original maps never hold sector 0,0 and are unaffected.

#### 1.6.3 Profiles, scripts and text

- **Profiles** (`stubs/profiles.json`, 44; defaults in `src/content/formats/stub-profiles.ts`): invented characters on
  the original profile ids, so the hiring, dealer, head-miner and helicopter code finds them.
  - Twelve A.I.M. mercs (0–11) with their own hiring rules: Lasko hates Vant (refuses once Vant has arrived, joins with
    the buddy quote when her buddy Hollis is on the team); Puig refuses after any merc death (`deathRate` 0), Marlow at
    any bad reputation (`reputationTolerance` 0); Voss and Arden are buddies, Voss learns to hate Kestrel, Arden learns
    to like Moraga.
  - The vehicles 160–163, Skyrider (97), the head miners Fred, Matt (in I14, town 3), Oswald, Calvin and Carl (106, 148,
    156, 157, 158) and one dealer per town (Keith 147 in C13, Franz 124 in C5, Jake 113 in H13, Howard 125 in G9, Sam
    126 in G2, Fredo 130 in L12, Herve 151 in A2, Peter 152 in I6, Carlo 154 in N5).
- **Kits** (each profile's `inventory`): role kits of riflemen (MINI14, G41 or M14 with three AP magazines, two of them
  with grenades), medics (MP5K and a medical kit) and an SMG gunner; a Kevlar vest or flak jacket and a steel helmet; a
  first-aid kit; a Glock 17 sidearm with two CLIP9_15, which the A10 stub NPC's give script and the give and talk e2e
  scenarios use. The last gun of a kit sets the profile's gun attractiveness (`Tactical/Soldier_Profile.cc:189-199`), so
  the stub mercs measure their weapons against a Glock.
- **Default squad**: a stub campaign hires from all twelve (`STUB_SQUAD_PROFILES`, `src/server/campaign-factory.ts`),
  since `StartSomeMercsOnAssignment` sends some away at a new game.
- **Scripts and text** (`stubs/npc/records.json`, `stubs/npc/text.json`, `stubs/text/*.json`, built by `stubs/npc.ts`
  and `stubs/text.ts`): Skyrider asks to be escorted (`ASK_ABOUT_ESCORTING_EPC`); his record 15 at the Drassen helipad
  ends `ESCORT_SKYRIDER` and releases him (`UN_RECRUIT_EPC`), after which the arrival rule sets up the helicopter. A
  head miner's first line starts his mine (`START_MINE`); his EDT holds the strategic quote numbers of
  `head-miners.json`. The dealers greet and chat. Every profile that speaks has its merc EDT
  (`stubs/text/merc-quotes.json`) and a speech blip.
- **Animation scripts** (`stubs/anim-scripts.ts`): invented, except that the seven unjam scripts end like the
  original's with the non-interruptible release and opcode 476, which returns to the shooting animation the jam
  interrupted (otherwise the shot never comes and its busy count stays; `stubs/anim-scripts.test.ts`).

#### 1.6.4 Tile types

The stub tileset (`stubs/world.ts`, `stubs/tiles.ts`, `stubs/effects.ts`) fills 29 tile types:

- grounds `FIRSTTEXTURE`, `SECONDTEXTURE`, `THIRDTEXTURE`, `REGWATERTEXTURE`; `FIRSTFLOOR`; `FIRSTWALL`, `FIRSTROOF`,
  `FIRSTOSTRUCT` (barrel), `FIRSTDOOR`;
- `SECONDWALL` (stone wall, armour 11, windows that shatter to an open partner), `FENCESTRUCT` (a wooden fence that can
  be hopped, a see-through wire fence with a cut partner), `SECONDOSTRUCT` (low sandbags that can be hopped, high ones
  that cannot), `SECONDROOF` (`NORMAL_ROOF`, climbable), `FIRSTSLANTROOF`, `FIRSTHIGHROOF`, `FIRSTCLIFF` with its lip
  `FIRSTCLIFFHANG`, `DEBRISROCKS`;
- the item graphics `GUNS`, `P1ITEMS`, `P2ITEMS`, `P3ITEMS` with every `tileGraphic` of the item tables
  (`STUB_ITEM_TILE_COUNTS`);
- the effects `BULLETTILE`, `FIRSTMISS`, `SECONDMISS`, `THIRDMISS`, `HUMANBLOOD`, `CREATUREBLOOD`, `WINDOWSHATTER`.

Stub structures come from `syntheticStructure` (`src/content/world/synthetic.ts`). Its `edge` option fills the cells
of the original's wall shapes (left walls the far `y` row, right walls the far `x` column, read from the tileset 0 wall
and door structure files), so the stone walls, windows and both fences block sight and fire along one edge of their
tile. `FIRSTWALL` (A9, the village houses, the bench arena) keeps full 5×5 tiles, on which the arena's sealed bunker
relies. A tile yard east of the village exercises each family (`src/sim/tactical/stub-tiles.test.ts`: fence and
sandbag hops, sandbag cover, sight and fire through a window and a shot that shatters it, sight along a wall from its
tiles, a roof climb, the cliff, debris, an item tile).

#### 1.6.5 Fonts

`stubs/fonts.ts` builds two bitmap fonts from a subset of Terminus Font 4.49.1 (SIL OFL 1.1, © 2020 Dimitar Toshkov
Zhekov), renamed Stub Pixel 12 and Stub Pixel 16 Bold because of the licence's Reserved Font Name. The subset (222
characters, `stubs/font/stub-pixel-12.txt`, `stub-pixel-16b.txt`) sits next to `OFL.txt` and `NOTICE.txt` (source URL,
version, hash, changes) and is regenerated with `tools/stub-font-subset.ts`. The build writes `fonts/stub-pixel-12.sti`
and `fonts/stub-pixel-16b.sti` (8-bit indexed, ETRLE, 230 glyphs each, value 1 shadow and 2 ink as the original's
mono-shadow blitter expects), points the 17 font names of `Utils/Font_Control.cc:37-52` at them through `aliases.json`,
and writes `translation_tables/translation-table-stub.json` in Stracciatella's shape: the English table's glyph numbers
plus lowercase Cyrillic, Ь and `` ` ~ « » – — … № `` (parsed by `src/content/text/glyph-table.ts`). The licence and
notice travel with the pack.

### 1.7 Sounds, music, speech and video

Music, speech and video generators: §1.5.

- **Sounds** (`stubs/audio.ts`): one short WAV per cue class (footsteps by terrain class, gun classes with their
  silenced and burst variants, reload, punch and knife, hits, falls, explosions, doors open, close and locked, item
  pick-up and drop, UI clicks, the laptop beep), generated from noise and tone envelopes; battle sounds as one generic
  set per body class, not per profile; an ambient table for the stub tileset (`stubs/ambient.ts`). The original paths
  (`sounds/…`, `battlesnds/…`) are aliases, so the same cue table resolves on both data sets.
- **Text** (`stubs/text.ts`, files in §1.5): the merc EDTs give merc quotes text on stubs, so `mercQuote` events are
  emitted and quotes take their text's time (`31`).
- **Formats** (`stubs/wav-encode.ts`): PCM 8-bit 11.025 kHz mono (most effects, bursts, music), PCM 16-bit 22.05 kHz
  mono (single shots) and stereo (the big explosion), IMA ADPCM 11.025 kHz mono with 256-byte blocks (battle voices,
  speech), so every decoder path runs on stubs. Synthesis (`stubs/synth.ts`) uses its own xorshift generator seeded from
  the file's class name.

### 1.8 The stub campaign bot

`pnpm cli campaign [--seed N] [--server URL --token T | --port N] [--verbose] [--trace] [--stop-after STEP]
[--no-reload]` (`tools/campaign-bot/`): a scripted player and an example of an agent against the API. It uses the MCP
tools alone (`newSession`, `status`, `observe`, `act`, `advance`, `save`, `load`; `deleteSave` to clean up) over
Streamable HTTP with the SDK client (`mcp-game.ts`) and decides from the observation only, with no clock and no
randomness, so a seed plays the same campaign every time, in process and through MCP. Without `--server` it builds the
stub pack, starts its own stub server (`stub-server.ts`: `src/server/main.ts` with an empty `JA2_DATA_DIR`, `--port` or
a free port, a random token, a temporary save folder) and stops it at the end. Output: one JSON line (seed; outcome
`won`, `lost`, `stuck` or `stopped`; the step and reason; days, battles, battles won, rounds, mercs lost, enemies
killed, reloads, seconds); exit code 0 for a won campaign. Default seed 1.

- **Steps** (`campaign.ts`): hire six A.I.M. mercs through the laptop (`aimQuote`, then `aimHire` with the kit; a
  preference list, two medics, never Lasko with Vant) → land in A9, win the landing battle → outfit from Omerta's stash
  → liberate the Drassen airport, town, mine and SAM site (B13, C13, D13, D15) → talk Fred into starting the mine →
  order medical supplies from Bobby Ray's (what is in stock) → buy armour and first-aid kits at Keith's → rest and heal
  → find Skyrider at his farm, take him along (a guard joins the escort's squad) and walk him to the helipad until the
  helicopter is set up → train militia in C13 → collect the delivery → recruit from A.I.M. and M.E.R.C. (Speck's mail,
  the account, the bills paid) for up to six days, twelve hours at a time, up to twelve mercs → march F11, J11, L8, L3
  with an outfit and a rest at each stop → attack M3, N3 and O3 (falling back to the previous sector after two
  casualties, up to six attacks each) → storm P3 to the stairs (`palace.ts`) → go down to P3_b1 → kill the Queen →
  advance through the ending until `observe.ended`.
- **Battle policy** (`battle.ts`, `retreat.ts`, `first-aid.ts`, `gear.ts`). In turns every merc readies his hand
  (reload, or the best gun he has ammunition for), scores each hostile in sight with `estimateAttack` (chance to hit ×
  chance to get through, aim clicks from the spare APs, a bonus for a target already hit: focus fire) and fires above a
  threshold; otherwise he bandages himself when bleeding, holds (back within six tiles of the squad's centre, prone) or,
  after rounds without our shots, pushes in swat mode toward the nearest known enemy or the objective; `endTurn` after
  the passes. In real time the medics stop the bleeding, tired mercs catch their breath, then the squad seeks the last
  seen enemy, the objective, a heard noise or sweep points; a sector that still counts enemies nobody finds is waited
  on, then reported as `stuck`. A won battle bandages every wounded merc. A retreat leaves by the edge the squad came in
  (`exitSector` per merc), or runs back to the start tiles when half the squad is down and outnumbered, or after the
  casualty limit of an assault. A merc who keeps waiting for a blocked tile is stopped after 4,000 ticks.
- **Outfitting and healing** (`outfit.ts`, `heal.ts`), through `inventory` and `moveItem` on the map screen: the best
  gun with four fitting magazines, the best vest, helmet and leggings, medical kits for the medics, a first-aid kit for
  everyone; a merc with a medical kit doctors, the hurt are patients, the others sleep, in three-hour slices until
  healed and rested, then everyone back on a squad.
- **Prompts** (`prompts.ts`): pre-battle → enter the sector (autoresolve only when entering is not allowed, retreat
  last); a surrender offer → rejected; contract renewals for a week and militia payments while affordable; escort
  requests accepted; simultaneous arrivals coordinated. A battle left in combat with only unconscious mercs is ended by
  switching to tactical and ending turns; a squad refused for a dead member gets `removeMerc` (`travel.ts`).
- **Reload checks** (`reload.ts`). *Exact load*: in the first battle that reaches round 2 the bot saves
  (`campaign-bot-battle`), loads with `reseed: false` into a new session, then sends every `observe`, `act` and
  `advance` to both sessions until the battle ends, comparing the views (without `language` and `dataVersion`) and the
  advance reports (without the `gameSaved`/`gameLoaded` events and the session's own messages); the summary lists the
  steps compared and the differences; the campaign plays on in the loaded session. *Player load*: after the Drassen mine
  it saves (`campaign-bot-player`), loads with `reseed: true` into a new session and plays on there; the reseed takes
  the server's entropy (`27` §1.5), so a run after it is not reproducible.
- **e2e** (`tests/e2e/campaign.spec.ts`): the bot against the e2e stub server, seed 3, up to the end of the
  landing battle with the exact load at round 2. Expected: the battle won with no merc lost, no difference in the
  mirrored session over more than 20 compared steps, the campaign continuing in the loaded session, A9 player
  controlled with no enemies.

**Status.** Drassen, the mine, Skyrider, militia and recruiting work on every seed; every exact load matched its
original session over the rest of its battle. The bot does not win yet. Squads are lost (a) on the march F11–L3 through
patrol country (groups of five to eighteen; the patrols around K7–L10 are twelve and thirteen strong in the strategic
tables), at a cost of two to ten mercs, and (b) at the Meduna outskirts: M3 holds twenty (`LEVEL1_DEFENCE`, a fifth
elites), N3 and O3 twenty each with 55 % elites (`MEDUNA_DEFENCE`), refilled while the squad regroups, P3 22 elites on
easy. With fresh mercs placed next to the sector (AK-74, four magazines, Kevlar vest and helmet, the same bot) M3 fell
to seven or eight mercs in 4 runs of 4, N3 to seven in 1 of 4. The garrisons and patrols are the original's tables, not
stub content. Candidates: outskirts maps with cover an attacker can use (the stub camp and town maps are open ground
around their posts), a policy that picks cover and attacks at night, a larger team, Skyrider's helicopter for the
march. The endgame steps (storm P3, down to P3_b1, kill the Queen, the ending) reached the victory with mercs placed in
O3, but not through a full campaign. Repro: `pnpm cli campaign --seed 2 --no-reload`.

**Open findings** (seen by the bot, not traced against the original):

- In real time a merc whose next tile is taken by a squad mate who stopped on it waits in `HandleNextTileWaiting`
  without end (G11, seed 3); not reproduced on demand.
- After a retreat that leaves unconscious mercs behind in a sector in turn-based combat, the sector stays in combat and
  the map screen refuses `advance` ("combat is in progress") until someone goes back and ends the turn.
- Once, after a player load, `route` answered "the squad cannot move: dead" after a won battle (D13, seed 1), although
  a death removes the merc from his squad (`HandleStrategicDeath`); not reproduced.
- Once, after a player load, an enemy turn against fifteen soldiers (K10, seed 3) did not end within `advance`'s
  200,000-tick budget; not reproduced.

### 1.9 Known limitations

- Stub underground levels connect only to the surface above them, so the levels below a mine's first and the creature
  lairs have no way in: a sci-fi stub campaign whose creatures invade a mine cannot reach their queen (play stub
  campaigns with sci-fi off).
- Wire cutting is not ported; the cut fence pieces exist in the tileset.
- `FIRSTWALL` structures fill their whole tile (§1.6.4), so a merc on such a wall tile cannot see along the room.
- Only the splash video exists; sequences skip the missing names (`31`).
- The stub fonts are not used as a Cyrillic fallback with original data (`31`).

---

## 2. Performance

The simulation layers read no clocks (`01` §3.2), so all timing is taken outside `sim`. Baselines measured on the
original data stay local, since the data may not be committed. Client frame time and UI targets: `28` §6.

### 2.1 The benchmark suite

`pnpm cli bench <scenario|all> [--data DIR] [--seed N] [--runs N] [--variant NAME] [--profile] [--calls] [--out FILE]
[--save-baseline]` (`tools/bench/`). Every scenario is a fixed seed plus a scripted command list, so a rerun does the
same work and only machine noise varies. No scenario needs the native oracle.

- **Output**: one JSON line per variant on stdout, a summary on stderr. Fields: `scenario`, `variant`, `source`
  (`stubs` or `original`), `seed`, `runs`, `warmup`, `load` (1-minute load average before and after, to spot a busy
  machine), the primary metric (`metric`, `unit`, `n`, `mean`, `p50`, `p95`, `p99`, `max`), `target` with its sanity
  bound, `series` (secondary metrics as distributions), `counters` (from the event stream and the state), `calls` and
  `callsPerSample` (with `--calls`), `info` (battle outcome, early stops), `deterministic`.
- **Determinism check**: the runs' work signatures (turns, ticks, shots, hits, deaths; alert states; strategic events;
  autoresolve slices) must be equal, else the line is flagged and the command fails: shared mutable state would make
  the numbers meaningless (the check once found every stub merc sharing one `stats` object).
- **Runs**: `--runs N` (default 3) repeats each variant from a fresh setup; with two or more, an untimed warm-up run
  comes first. Each variant runs in its own child process (the parent collects the lines), so variants cannot influence
  each other: V8's optimization state carries over between battles in one process (§2.3).
- **Profiling**: `--profile` runs the variant once more under the V8 sampling profiler, writes
  `.cache/bench/<scenario>-<variant>-<source>.cpuprofile` (Chrome DevTools) and prints the hottest self-time frames.
  `--calls` takes exact call counts of named simulation functions (AI decisions, path searches, LOS tests, sight checks,
  chance-to-get-through traces, cover searches) from V8 precise coverage (`node:inspector`, `tools/bench/inspector.ts`)
  in one extra instrumented run, about 8× slower; a unit test fails when a counted function is renamed. Counters come
  from a wrapper around the `SessionSim`, so `src/sim` carries no instrumentation.
- **Seeds and data**: default seed 2 for `enemy-turn` and `server`, 7 for `campaign`, 1 for the rest (chosen so the
  stub runs avoid known stalls); `--seed` overrides them all. `--data` defaults to `$JA2_DATA_DIR`; `--data ''` forces
  stubs.
- **Baselines**: `--save-baseline` writes `.cache/bench/baseline.json` (merged per scenario, variant and source); later
  runs print the change per metric (p50, p95, max, mean, call counts).

| Scenario | What it does | Measures |
|---|---|---|
| `enemy-turn` | turn-based battle through a `Session` with the instant driver's semantics (dispatch, then advance to idle with a 50,000-tick budget, so a stall is reported instead of spinning); the mercs go prone, each fires once a turn at the nearest visible enemy, then `endTurn`; interrupts are ended at once; until one side is gone, combat ends or 60 rounds. Variants `arena-e8`, `arena-e16`, `arena-e32`: the generated arena with 8, 16 and 32 enemies (a quarter elites) against six mercs and four civilians, plus six regular militia with 32. Original data only: A9 with 4, 16 and 32 garrison soldiers (the sandbox squad walks from the north entry towards the nearest enemy until combat starts); the D13 airport from `SaveGame10` (3 mercs, 5 soldiers, 17 civilians: the largest battle among the six native saves of `14` §10) | ms per enemy side turn (every AI team, from `endTurn` to our next turn), ticks per turn; counters: turns, rounds, shots, hits, deaths, interrupts, view build ms; calls per turn |
| `realtime` | the patrol arena with 20, 40 and 64 soldiers (half enemies on patrol orders, half wandering civilians), six mercs sealed in a bunker so nobody sees them; green, and yellow (the enemy team's public noise at the far side with `setNewSituation`, as `CallAvailableTeamEnemiesToAmbush` does); manual driver, 10 × 1,000 ticks through a `Session` | µs per tick (mean, p99, max), ticks per CPU second, alert states at the end, combats started (0, or the variant is void) |
| `strategic` | a new campaign with one A.I.M. merc on a 14-day contract (renewed for two weeks when due), the start sector's garrison emptied before landing, the squad routed to B9 so no sector is loaded, then 7 and 30 world days of `MIN60` compression through a `Session`, prompts answered (pre-battle: retreat, else autoresolve); once more with the Queen's attacks: Drassen (B13–D13) emptied and handed to the player (`setThisSectorAsPlayerControlled(…, contested)`), then `wakeUpQueen` (Omerta alone draws no attack in 30 days); `7d-mercs6` with six mercs | ms per world day; counters: days, `dayStarted`, compression stops, pre-battle, autoresolve, battle results, player-controlled sectors, frame views built and their ms per day; calls: strategic events, group arrivals, Queen evaluations, autoresolve battles |
| `autoresolve` | 20 battles a run of 10, 20 and 40 per side (`side-10`, `side-20`, `side-40`): half mercs (profiles on original data, stub mercs on stubs, at most 20), the rest regular militia, against enemies from `tacticalCreateEnemySoldierForAutoresolve` (a quarter elites, capped at `MAX_AR_ENEMIES` 32) | ms per battle, slices per battle; calls: cell turns, attacks |
| `save` | five saves and loads a run of: the patrol arena with 64 soldiers (`arena-64`), a new campaign with the squad landed (`campaign-landed`) and, with original data, the largest native save of `$JA2_SAVES_DIR` (default: `SavedGames` beside the data folder) imported (`native-import`); each settled for 400 ticks. A save is `SaveService.saveFileOf` (snapshot, header, content identity) plus `encodeSaveFile` (stringify and gzip); a load is `inflateSave`, `parseSaveText` and `restoreSession` with fresh content | ms per save (primary); series `snapshotMs`, `encodeMs`, `parseMs`, `restoreMs`, `loadMs`; counters raw and gzipped KiB |
| `server` | in process: a `node:http` server with the WebSocket endpoint on ports 7510–7512, the sessions in `InProcessHost`s sharing one slice scheduler; 1, 4 and 16 viewer sessions (the 20-soldier patrol arena, realtime driver ×1) plus one instant battle session (16-enemy arena, `endTurn` until combat ends) per four viewers, driven by WebSocket clients in a worker thread for 4 s | event-loop delay max (the longest stall; `monitorEventLoopDelay` p50 and p99 in counters, whose p99 hides a stall since a stall is one sample), frame diff ms and view build ms per frame, bytes per second (all, viewers), instant turn round trips |
| `campaign` | `land-and-clear`, in a child process: a new campaign with six mercs, the landing, then the first sector cleared (approach the nearest enemy until combat, prone, three aimed shots per merc a turn, again after a lull) | total ms (landing and clearing), peak RSS |

The stub arena (`tools/bench/arena.ts`) is original work generated from the seed in the stub map format: 64 × 56 tiles
on the stub tileset, barrels and wall segments as cover. The battle layout puts a quarter of the enemies 8–13 tiles in
front of the mercs so that combat starts at once; the patrol layout keeps a sealed, roofed bunker in a corner. The
arena is round-tripped through `parseStubMapSource`, `stubMapToMapDef` and `writeMap` and served from an in-memory
overlay as `stubs/world/maps/bench-<name>.dat`, so the stub pack is unchanged.

### 2.2 Targets and measurements

Machine: AMD EPYC 9354 KVM guest, 8 vCPUs with one thread per core, 15 GiB, Node 24.22.0; `bench … --runs 3`. The
guest's throughput varies by more than the load average shows (the same native import measured 400 ms and 102 ms at
the median on one day), so only runs made back to back compare. Original data first, stubs in brackets. Each JSON line
carries its target; the bench fails only above ten times the target (`SANITY_FACTOR`).

| Metric | Target | Measured | Verdict |
|---|---|---|---|
| Enemy turn, 16 enemies, p95 | ≤ 300 ms | A9 258 ms; arena 274 ms (187 ms) | met |
| Enemy turn, 32 enemies plus militia and civilians, p95 | ≤ 1 s | arena with six militia and four civilians 1.00 s (0.69 s); A9 with 32 0.68 s | met, without margin on the arena: the turn is the cover search's chance-to-get-through traces |
| Real-time tick, 40 soldiers, mean | ≤ 0.25 ms | 20 µs green and yellow (19–44 µs); 64 soldiers 35–69 µs | met with a 5× margin |
| Real-time tick, worst single tick | ≤ 50 ms | 5–13 ms (4–27 ms) | met; above 50 ms a tick would show as a hitch at ×1 |
| Strategic world day, no sector loaded, p95 | ≤ 100 ms | with a viewer: one merc 41–51 ms (44–60 ms), six mercs 48 ms (60 ms); without a viewer (no frames built): 22 ms (24 ms) and 27 ms (21 ms) | met |
| Autoresolve battle, 40 per side, p95 | ≤ 10 ms | 3.3 ms (2.8 ms) | met |
| Save (snapshot, stringify, gzip) | ≤ 100 ms and ≤ 2 MB gzipped | p50 / p95: the largest native import 102 / 186 ms, 4.2 MiB raw, 222 KiB gzipped; a landed new campaign 69 / 148 ms, 3.5 MiB, 184 KiB; the 64-soldier arena 39 / 52 ms (stubs: landed campaign 38 / 60 ms, 2.4 MiB, 64 KiB; arena 35 / 41 ms, 2.0 MiB, 77 KiB) | size met with a wide margin; time met on stubs, for the arena and at the median of a landed campaign, at the target at the median of the largest import; the p95 is the first save of a session, which builds the content index and the text identity (about 150 ms on the original data) |
| Load (parse and restore with fresh content) | ≤ 500 ms | p50 / p95: the import 184 / 243 ms, a landed campaign 160 / 233 ms, the arena 104 / 150 ms (92–106 / 116–128 ms) | met; most of a load is building the content again |
| Event-loop stall for other sessions while one runs an instant battle (max delay) | ≤ 50 ms | in process, p50 / max of three runs: one battle 28 / 36 ms with one viewer, 30 / 36 ms with four (22 / 28 and 19 / 27 ms); four battles with sixteen viewers 35 / 42 ms (23 / 23 ms); worker host: another agent's `observe` at most 13 ms during a battle | met: the stall is one 10 ms slice plus the longest single tick (`04` §5.9); in-process saves still stall (§2.7) |
| Campaign (land and clear the first sector), peak RSS | ≤ 512 MB | 319 MB (286 MB) | met |

Further measurements (original data unless stated):

- *Enemy turn*: a 16-enemy arena turn takes 4,227 ticks at the median (21 s of game time) and per turn 46 AI decisions,
  115 path searches, 1,275 LOS tests, 2,045 sight checks, 14.8 cover searches over 1,168 tiles and 17,531
  chance-to-get-through traces. Top frames of the 32-enemy profile: the cover search's traces (47 %, with
  `calcChanceToGetThrough` itself at 28 % self time) and the path search (14 %).
- *Real-time tick*: the median tick costs 1–3.5 µs; the cost sits in single ticks where one AI decision runs several
  path searches (`expand`, `findBestPath`, `remaining` together about 50 % with 64 soldiers on stubs,
  `lineOfSightTest` 11 %).
- *Strategic day*: 1,230 strategic events, 250 group arrivals and 2.3 Queen evaluations a day.
- *Autoresolve*: about 30 one-second slices per battle.
- *Server*: a frame diff costs 0.02–0.04 ms at p95, building the view 0.05–0.07 ms; a real-time viewer of the
  20-soldier patrol receives 13–20 KB/s at ×1, an instant battle sends 0.34–0.65 MB/s in bursts; the instant turn's
  round trip is 93 ms at the median with one battle and 377 ms with four (stubs 36 and 199 ms), since battles take
  turns slice by slice.
- *Memory*: RSS with the default sandbox session 242 MB in process, 338 MB with a worker; with three sessions (two
  sandboxes and the D13 import) 588 MB and 1,010 MB.
- *Stall sweep*: `bench enemy-turn --runs 1` with seeds 1–8, every variant on both sources, and `bench campaign --runs
  1` with seeds 1–16 on stubs end without a `stalled` outcome (watchdogs are not ported, deviations "Watchdogs", so a
  stall is a bug that fails the run). Seen while tracing the stalls and not changed: `HandleSystemNewAISituation` drops
  a pending melee animation without its busy count when a new situation arrives without a sighting during the stance
  change before the attack; no source of such a situation during an AI's own turn was found, and no run met it.

### 2.3 Profiling and optimization

**Rules.**

- Profile with `--profile` and fix the top frames only. Every optimization keeps the outcomes: the same counters in
  every bench line, byte-identical frames and event logs (hashed over a compressed week and two campaign battles on
  both sources), the oracle compare unchanged (`pnpm check` plus the local oracle compare).
- Caches are derived data: they live beside the state, are rebuilt on load (`27` §1.9), never enter the snapshot and
  never change an outcome.
- Profiles of the save path misattribute time to whatever runs during a garbage collection; time the phases with
  `performance.now()` before trusting a frame.
- No event jumping (`04` §2 level 1b) unless the real-time target fails after caches: it changes the stepping model.
- A hot function that deoptimizes again and again (`node --trace-deopt`) may hide a porting gap. `gunRange` once
  returned 0 for everything but guns, where `GunRange` (`Tactical/Weapons.cc:86`) returns `CELL_X_SIZE` for
  non-weapons and the weapon range for every `IC_WEAPON` class. A trace from a soldier holding a knife, a grenade or
  nothing, or of a thrown knife or rocket, divided by zero in the range drop (`Tactical/LOS.cc:2844`); its vertical
  increment became −Infinity, and the Infinity and NaN values made V8 deoptimize `fireBullet`, `fireBulletGivenTarget`
  and `calcChanceToGetThrough` until it gave up on them: after a few battles in one process enemy turns ran three times
  slower. Normalising −0 and keeping the fixed-point fields small integers did not help; porting `GunRange` did. About
  25 ordinary feedback deopts of the bullet code per process remain.

**In place** (derived data only; p50 on the original data, before → after):

| Optimization | Where | Effect |
|---|---|---|
| the roster's sorted list reused until the roster changes | `Roster` (`src/sim/campaign/roster.ts`) | with the next three: a world day of compression 79 → 37 ms |
| enemy counts and the player's knowledge of them for the whole surface map at once, each tested against its per-sector original | `numEnemiesInEverySurfaceSector` (`src/sim/strategic/forces/groups.ts`), `surfaceKnowledgeOfEnemies` (`src/sim/strategic/map/knowledge.ts`) | |
| unchanged sector views reused between frames | `src/server/strategic-view.ts` | |
| view diff by `sameJson` (equal exactly when the `JSON.stringify` outputs are equal, fuzz-tested) instead of stringifying both sides | `src/protocol/same-json.ts` | |
| no view built or diffed without a subscriber | the session (`04` §5.9) | a world day 33 → 15 ms |
| an occupied cover position traced once for all three stances | the AI's cover search | traces per 16-enemy turn 24,948 → 17,531; with the next: a 16-enemy arena turn 197 → 131 ms (p95 393 → 274 ms) |
| collision-free throw force searches remembered per item table | the AI's throw planning | 23 % → 6 % of the profile |
| advances in 10 ms slices, one slice per event-loop turn; optional worker per session | `src/server/slicing.ts`, `src/server/session-host.ts` (`04` §5.9) | the stall during an instant battle 214 → 28 ms |
| gzip at `Z_BEST_SPEED`, on the thread pool when asynchronous | `src/server/save-file.ts` | the default level gives 138 KiB instead of 222 KiB for the largest import but takes three times longer |

**Left**: the cover search's chance-to-get-through traces (within one AI decision under 4 % repeat exactly, so a memo
would not pay) and the path search. Candidates not yet profiled (inferred): sight results per tick between position
changes (a visibility cache, `01` §8), path costs within one AI decision, the reachability flood shared by cover and
flee searches, allocation in the bullet and LOS loops.

### 2.4 Session hosts

The `SessionHost` interface, the in-process host with time slicing and the worker host: `04` §5.9.

- **In process** (the default): no extra memory, no content load per session.
- **Worker** (`JA2_SESSION_HOST=worker`): uses several cores and removes the stalls slicing cannot (single ticks of up
  to about 30 ms, saves, opening a session and loading a save, 0.2–0.5 s of content building), at about 100–140 MB of
  RSS and a content load per session on the original data; each worker builds its own content index on its first save.

A server runs all its sessions in one host kind (no `auto`): switching when a second session opens would move a running
session between threads. Measured with two MCP agents on the original data (one imports `SaveGame10` and sends
`endTurn` then `advance idle` twelve times, the other alternates `observe` and a one-tile `move` on a sandbox): in
process the second agent's calls took 15 ms at the median, at most 44 ms (`observe`) and 77 ms (`move`), the battle's
`endTurn` autosave being the longest stall; with workers 2.5 / 4.9 / 12.7 ms (`observe`, p50 / p95 / max) and at most
18 ms (`move`). Both runs played the same battle tick for tick.

### 2.5 CI

CI (`.github/workflows/ci.yml`) runs four jobs side by side:

- `check`: `pnpm check`.
- `build`: the stub pack, the bench smoke runs and `pnpm build`. Every bench scenario runs on stubs once (`pnpm cli
  bench all --runs 1 --data '' --out bench.jsonl`, about 40 s on the development VM), plus one `--calls` run
  (`autoresolve --variant side-10`) for the instrumented path. It fails only on errors or a sanity bound ten times
  above the target (CI machines vary) and uploads `bench.jsonl` as the `bench` artifact. One run means no warm-up and
  no run-to-run check: CI numbers are cold, only a smoke signal.
- `e2e`: `pnpm e2e --shard=N/3` in three jobs (the dev server builds the stub pack). Chromium installs without
  `--with-deps`: the runner image carries Chrome's system libraries, and the apt step of `--with-deps` took more than
  10 minutes on a slow mirror.
- `browsers`: `pnpm e2e:browsers` under `xvfb-run` (Chromium and Firefox, also without `--with-deps`, 20 minutes at
  most), only when `node tools/gates.ts --since <the previous push or the pull request base> --plan` selects
  `e2e:browsers`, or when the base is unknown (a new branch, a manual run).

A push or pull request that touches only `docs/`, Markdown files or `LICENSE` starts no CI.

### 2.6 Test runs and gates

- **One stub pack per unit run.** `tests/support/build-stub-pack.ts` (a vitest `globalSetup`) builds the pack once,
  read-only (files 0444, folders 0555, so a test that writes into it fails at once), and passes the folder in
  `JA2_TEST_STUB_PACK`, read by `sharedStubPackDir()` and `openStubPack()` (`tests/support/stub-pack.ts`).
  `openStubPack()` builds a private pack only when no global setup set the variable; a test that changes a stub file
  (`rule-pack.test.ts`) builds its own. A Playwright `globalSetup` (`tests/e2e/dev-server-stub-pack.ts`) points the e2e
  helpers that write saves in `beforeAll`, through the same variable, at the pack the dev server built (`dist/stubs`,
  the one the server under test reads; Playwright starts the web server before the global setup). Building the pack per
  test file used to take half the unit suite's time.
- **Mode runs.** Data tests read the folder only through `ORIGINAL_DATA_DIR` (`tests/support/original-data.ts`), reload
  tests the mode only through `tests/support/reload.ts`, so `pnpm test:data` is `vitest related
  tests/support/original-data.ts` and `pnpm test:reload` is `JA2_RELOAD=1 vitest related tests/support/reload.ts`: each
  runs only the files its mode changes, not the stub suite again. `pnpm imports` (`tools/check-imports.ts`) refuses a
  test-side file that names `JA2_DATA_DIR` or `JA2_RELOAD` outside its module, since `vitest related` would then miss it.
- **`pnpm gates`** (`tools/gates.ts`, `[gate …] [--all] [--since REV] [--list | --plan] [--keep-going]`) takes the files
  changed since the merge base with the upstream branch (plus the working tree and untracked files) and runs the gates
  their area can affect, in order `check`, `data`, `reload`, `oracle`, `e2e`, `e2e:data`, `e2e:browsers`:

  | Area | Gates |
  |---|---|
  | `src/core`, `content`, `sim`, `node`, `server`, `data/` | all but `e2e:browsers` |
  | `src/protocol`, `stubs/` | all but `oracle` and `e2e:browsers` |
  | `src/ui`, `render`, `audio`, `app` | `check`, `data`, `e2e`, `e2e:data` |
  | the canvas presentation (`game-page.ts`, `dom-input.ts`, `main.ts`, `index.html`, `style.css` of `src/app/game/`, `logical-framebuffer.ts`, `src/ui/resolution.ts`, `vite.config.ts`, `tools/dev.ts`) | adds `e2e:browsers` |
  | `src/devtools/`, `tools/campaign-bot/`, the root `index.html` | `check`, `e2e` |
  | `tests/support/` | `check`, `data`, `reload`, `e2e` |
  | a unit test file | `check`, `data`, `reload` |
  | an e2e spec | `check` and its own suite; a shared helper of `tests/e2e` the suites that import it (the browser suite only `env.ts`) |
  | `tools/oracle/` | `check`, `oracle` |
  | other `tools/`, `package.json`, the Biome and TypeScript configs | `check` |
  | `docs/`, Markdown, `LICENSE`, `.github/` | nothing |
  | the lockfile, or a path no area names | everything |

  `check` and `reload` run without `JA2_DATA_DIR`; `data`, `oracle` and `e2e:data` are skipped without it (the oracle
  also needs the probes in `JA2_ORACLE_DIR`, default `~/ja2-oracle`); `e2e:browsers` needs `DISPLAY` or `xvfb-run`.
  Each gate writes `.cache/gates/<gate>.log`. CI's `browsers` job uses the same table (§2.5).
- **e2e.** Goldens capture after the page's VFS reads and cursor hints settle: the UI hook's `reads.pendingReads`
  counts the `/vfs` reads in flight (`HttpVfsLayer`, `src/app/assets/http-vfs-layer.ts`) and `hints.pendingReplies`
  (also on `map.hints`) every `pending` reply of a `HintProvider`; `capture()` (`tests/e2e/ui-capture.ts`) takes the
  frame only when no read is open and no hint answered `pending` during the two frames before it, trying up to 40
  times (`'afterReads'`), unless a golden holds a read on purpose (`'whileReading'`, the loading screen). A button
  enabled by a hint (the map screen's tactical button, `canEnterSector`) is otherwise drawn hatched until the answer
  arrives. The browser suite compares a screenshot only with a frame that did not change while it was taken. Much of
  the suite's wall time is the game in real time (the story test at speed 1, the talk panel at the original pace) and
  the browser (the Chrome GPU process under SwiftShader takes about half of the CPU).
- **Timeouts.** One limit per runner, sized for a loaded machine (a busy hypervisor, parallel agents): vitest 10
  minutes per test and hook (`tests/support/patience.ts`); Playwright 15 minutes per test (30 for the browser and
  original-data suites), 2 minutes per `expect` and 5 minutes for the dev server to start (`tests/e2e/env.ts`). Tests and
  helpers set no limits of their own, waits included; MCP calls pass the runner's limit (`MCP_CALL_OPTIONS`, and
  `McpGame.connect`'s request timeout in e2e) instead of the SDK's 60 s. Shorter limits remain only on waits that
  tolerate a miss (`.catch`) and in the stall guard of `waitWhileLoading` (5 minutes without a finished request or a
  progress change).
- **Tried, not adopted**: vitest `--pool=threads` (no gain); `--no-isolate` (faster, every test passing, but state
  shared between files would make results depend on the order); a test pace (the client clock and the real-time speed
  scaled together would save about 40 s of e2e but test a pace nobody plays at, every timed window eight times shorter).

### 2.7 Known limitations

- Client frame rate at 1920×1080 on the original data: `28` §6.
- The first save of a session on the original data stays above 100 ms at p95 (the content index and the text identity).
- In process, a save stalls the other sessions for its snapshot and stringify (about 40–70 ms each on the largest
  native import; also the autosave at an accepted `endTurn` in combat); the worker host avoids it. A snapshot could be
  taken in slices only if its sections were captured at one instant.
- The `server` scenario has no worker variant: its arenas live in an in-memory VFS overlay a worker cannot open.
- The `campaign` scenario stops after the first sector; the full campaign is `pnpm cli campaign` (§1.8), timed only by
  its summary's seconds.

---

## 3. The launcher

The launcher (`src/app/launcher/`, served at `/` from the repository's root `index.html`) is a DOM page for what the
canvas game at `/play` (`28` §2.2) does not show: the data source, the display language, the running sessions, native
imports, save download and upload, settings export, the developer pages. Its logic is DOM-free and shared with the
canvas screens (`30` §1); the launcher keeps the DOM glue (`main.ts`, `campaign-panel.ts`, `save-panel.ts`,
`settings-panel.ts`, `message-box.ts`, `labels.ts` with `fetchLabels`, `settings-file.ts`, and `api.ts` for the fetch
calls, since `app` may not import `server`). Debug hook `window.__ja2Launcher`; e2e `tests/e2e/launcher.spec.ts`.

- **Header**: the data source (original data with the SLF count, or the stub pack), the data version, the display
  language (the server default or one of the eight) and a Play link to `/play`.
- **New campaign** (`campaignRequest`, `src/ui/client/campaign-form.ts`): the game init screen's choices with
  `InitGameOptions`'s defaults preselected (`ORIGINAL_OPTIONS`: easy, sci-fi, reduced guns, save anywhere, blood on);
  the form always sends all five options, so the API's default difficulty 2 never applies. Also: the Dead is Dead save
  name (checked against the server's name rule and the reserved names); the squad (the server's default, 1–6 mercs, or
  hiring in the laptop, `hire: []`) and whether it flies in at once; the developer page to open (strategic, or tactical
  when the squad lands). The session gets the client's display language; `?seed=N` passes a seed (tests). After
  `POST /api/sessions` the beginning sequence plays unless `playIntro` is off.
- **Saved games** (`save-panel.ts` over `SaveController`, `src/ui/saves/save-controller.ts`, and
  `src/ui/saves/save-rows.ts`, shared with the canvas save/load screen): the server's list (newest first), each row with
  `DisplaySaveGameEntry`'s fields: `pMessageStrings[MSG_DAY] N, hh:mm`; the location (the sector code; N/A before
  `STARTING_TIME` and `STR_LATE_14` after it when there is no sector; deviation "Save list in the launcher and on the
  canvas"); `n` with `MercAccountText[MERC_ACCOUNT_MERC]` or `pMessageStrings[MSG_MERCS]`; the balance as
  `InternalSPrintMoney` prints it (`$-1,234` for debts); the description; the Dead is Dead mark
  (`gs_dead_is_dead_mode_tab_name[1]`) by the initial save mode. Native saves carry a mark of their own. The tooltip
  lists the difficulty with `SLG_DIFF`, the save mode, the guns, the style, blood and gore and the data version.
  - *Load* asks once, as `SaveLoadSelectedSave` does: the warnings predictable from the header and `/api/health`
    (`engineDiffers` with `SLG_GAME_VERSION_DIF`, `dataVersionDiffers` and `stubPackDiffers` with ja2-node lines) go into
    one box between `SLG_SAVED_GAME_ISSUE` and `SLG_SAVED_GAME_CONTINUE_ANYWAYS`. The load goes into a new session or in
    place into a running one, and the warnings the server returns (the text identity) are shown with the result; a
    native save imports with `newSession {save}`.
  - *Save* as new (`{description}`, at most 46 characters) or over the selected save (`SLG_CONFIRM_SAVE`; `QuickSave` is
    written as `quick`; autosaves and native saves cannot be overwritten), for the session chosen in the panel (preset
    by `?session=` when a game page links back); *Delete* (`SLG_CONFIRM_DELETE`); *Download* (`GET
    /api/saves/:name/file`) and *Upload* (`PUT`, the name taken from the file, made valid and unique, never a reserved
    one). Refusals appear in the status line: `ironMan` with `zNewTacticalMessages[TCTL_MSG__IRON_MAN_CANT_SAVE_NOW]`,
    the others with `SLG_SAVE_GAME_ERROR`, the code and the server's reason.
- **Settings** (`settings-panel.ts`; the model `src/ui/settings.ts`, stored by `src/app/settings.ts` under
  `ja2-node:settings`): the five volumes, mute, speech, subtitles (unchecking the last one shows
  `OPT_NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON` and keeps it on), key-advance speech, mute confirmations, the
  sleep/wake notification, the splash and intro switches, playback speed, the display language, and export and import
  as a JSON file `{format: 'ja2-node-settings', settings}` (`settings-file.ts`; normalized on import, so an older or
  edited file cannot store invalid values). Settings apply at once; the volumes drive the launcher's audio engine.
- **Splash**: unless `playSplash` is off, the launcher starts behind a "Click to start" button and plays the splash
  after the click, which unlocks the audio context; once per browser tab (`sessionStorage`), not each time a game page
  links back (deviation "Splash start"). The video and credits panel plays the splash, the beginning and the credits
  (the DOM scroller, deviation "Credits screen").
- **Sessions and pages**: each running session with links to `/play` and to its strategic and tactical developer pages;
  links to every developer page.
- **Labels** (`src/ui/text/labels.ts`, `src/ui/text/string-ids.ts`): every label is either an original string
  `{table, index}` of the string tables (`zSaveLoadText`, `gzGIOScreenText`, `zOptionsText`, `zOptionsToggleText`,
  `pMessageStrings`, `gpStrategicString`, `pUpdateMercStrings`, …; indices from `Utils/Text.h`, `GameSettings.h` and
  `Strategic/Map_Screen_Interface.h`) or a ja2-node label with an English and a Russian text. The launcher loads
  `GET /api/strings?lang=` for the chosen language; a ja2-node label falls back to English in the other six languages,
  a missing original string shows its label id. The message box is a `<dialog>` with the original's YES, NO and OK of
  `pMessageStrings` behind the `MessageBoxes` interface (`src/ui/message-boxes.ts`).
- **In the developer pages**: `src/app/net/save-controls.ts` binds Alt+S (`save {name: 'quick'}`) and Alt+L (`load
  QuickSave`) by `KeyboardEvent.code`, so any keyboard layout works, adds quick save, quick load and a link back to the
  save list, and shows the outcome: `pMessageStrings[MSG_SAVESUCCESS]`, `SLG_LOAD_GAME_OK`, `SLG_LOAD_GAME_ERROR` with
  the reason, the Iron Man text, or a ja2-node line when there is no quick save (the original then does nothing). The
  session client (`src/app/net/session-client.ts`) drops its queued frames whenever a `welcome` arrives, so no frame of
  a replaced simulation is applied after a load in place. Sleep/wake notification (`src/app/sleep-wake.ts`,
  `src/app/net/sleep-wake-stop.ts`): with the setting on, a frame carrying `fellAsleep` (not a collapse) or `wokeUp` of
  a merc off a squad or vehicle (the cases `HandleRestFatigueAndSleepStatus` opens the update box for) switches the
  real-time driver to manual; the strategic page's advance adds the two events to its stop condition and restarts
  quietly when the stop was a case without a box; the message is `pUpdateMercStrings` with the merc names. Debug hooks
  `window.__ja2SaveKeys`, `window.__ja2SleepWake`.
- **Known limitation**: the playback speed setting is stored, but no page reads it (the developer pages keep their own
  playback buttons).

---

## 4. Data tables and original data

### 4.1 Externalized files used directly

From `data/externalized/` (Stracciatella's tables, in the repository): `music.json` (modes → tracks, `31`);
`strings/translation-*.json` and the per-language files, eight languages plus `rusgold` (`31`);
`translation_tables/*.json` (the glyph tables `eng`, `fr`, `rus`, `rus-gold`, `chs`); `calibres.json` and
`weapons.json` (gun sound paths); `explosion-animations.json` (explosion sounds); `vehicles.json` (vehicle sounds);
`game.json`, `imp.json`, `strategic-ai-policy.json` (logic content under the save's content identity, `27` §2.3).

### 4.2 Transcribed tables and constants

Generated by `tools/transcribe/*.ts` into `data/tables/`:

| Table | From | Content |
|---|---|---|
| `sound-effects.json` (`sound-effects.ts`) | `Utils/Sound_Control.h:28-352`, `Utils/Sound_Control.cc:17-328` (`szSoundEffects`, `szAmbientEffects`), `Directories.h`, the literal sound paths in `src/game/**/*.cc` | 291 sound ids in `SoundID` order (id, name, VFS path or `null` where the original has none), 14 ambient sounds, the pan (0 left to 127 right) and volume (0–127) constants, `SOUND_FAR_VOLUME_MOD` 25, and the 25 sound files the code names literally (such as `sounds/weapons/bursttype1.wav` and `laptop/static*.wav`) with the files naming them |
| `battle-sounds.json` (`sound-effects.ts`) | `Tactical/Soldier_Control.h:178-198`, `Tactical/Soldier_Control.cc:97`, `:138-157`, `:5868` | the 17 kinds in `BattleSound` order with their file part, `randomVariants` (the kind and the next n−1 kinds are drawn from), `badGuy` (playable without a profile), `dontAllowTwoInRow`, `stopDialogue` (0 never, 1 cuts speech, 2 skipped while talking); the repeat filter `MIN_SUBSEQUENT_SNDS_DELAY` 2,000 ms; the low-morale threshold 35 |
| `edt-layouts.json`, `l10n.json`, `mlg.json` | `31` | |
| `ui-constants/Button_Sound_Control.json` (`ui-constants.ts`) | `src/sgp/Button_Sound_Control.cc:11-50` | click schemes per screen (`30` §8) |

`src/content/audio/sound-table.ts` loads the two sound tables and lists the generic voice sets (`m`, `f` as profile
fallbacks; `bad0-2` male, `bad7-8` female, `kid0-1` without a profile; from `Tactical/Soldier_Control.cc` and
`Tactical/Soldier_Create.cc`), the voice paths, and the sound paths of `weapons.json`, `calibres.json`,
`explosion-animations.json` and `vehicles.json`, with `%d` bursts expanded to the largest burst (6).

Constants instead of tables where a handful of values is all there is, in modules with the SFI header: the music modes
and the victory and defeat end rules (`src/protocol/music-modes.ts`, from `src/externalized/content/ContentMusic.h:3-17`,
`Utils/Music_Control.cc:182-319`), the intro sequences (`src/app/video/sequences.ts`, from `Intro.cc:34-78`,
`:252-329`), fade steps, the 2 s battle-sound filter, the 46-character save description, the 16-voice cap, the ambient
time windows.

### 4.3 Original data read at runtime, never committed

Sounds, battle sounds, speech and `.gap` files, music, ambient `.bad` tables and sounds (`Ambient.slf`), laptop sounds,
the Smacker videos (in the Steam package's `Intro-old.slf`), `credits.edt` and the other EDT files, fonts. Tests that
need them use `describe.skipIf(!ORIGINAL_DATA_DIR)` (`tests/support/original-data.ts`) and assert counts, formats and
lengths only. Checked on the user's data: every WAV of `sounds.slf` (370 PCM), `battlesnds.slf` (67 PCM, 1,514 IMA
ADPCM) and `music.slf` (14) decodes, a sample of the speech decodes and all 8,353 `.gap` files hold whole pairs
(`src/content/formats/wav-original.test.ts`); every video decodes with its audio; all 248 rows of the English credits
parse; every fixed EDT file holds whole records.

The WAV reader (`src/content/formats/wav.ts`) takes RIFF/WAVE PCM 8/16-bit mono and stereo and IMA ADPCM (0x11) with
any block align, the frame count from `fact` or the data size; unknown chunks are skipped, junk after `data` is ignored,
an oversized `data` is clamped; other tags and depths fail with a clear error. `.gap` files are pairs
(`src/content/formats/gap.ts`, `Tactical/Gap.cc` `PollAudioGap`).

### 4.4 Native save import

The format and the import: `14`. The platform adds:

- the game options through `importNativeGameOptions` (`src/sim/options.ts`: difficulty, sci-fi, guns and save mode
  kept, `turnTimeLimit` dropped and listed in the report's `droppedOptions`);
- the music mode byte (`SaveLoadGame.cc:1827`) as the session's starting music (`musicModeOfNativeByte`,
  `src/protocol/music-modes.ts`); `useCreatureMusic` (decoded in `src/content/formats/savegame.ts`);
- the NPC records in the server's data version's layout (`readSavedNpcRecords`, `src/content/formats/savegame-npc.ts`).

The German encryption is taken from the save's own flag (`germanEncryption`, `14` §3). The import does not check that
the save was made with the server's data version. Native saves appear in `listSaves` (`27` §1.6).
