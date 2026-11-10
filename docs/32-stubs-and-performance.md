# 32 — Stub pack, performance, launcher and data tables

**Scope.** The stub pack (ja2-node's own content that runs every platform feature and a campaign without the original
data), the benchmarks, their targets and profiling, session host costs, CI, test runs and gates, the launcher page, and
the data tables. Siblings: `27` (saves, options, client settings), `28` (the stub skin, UI performance), `31` (sound,
video, localization), `tools/oracle/README.md` (the native oracle). Paths without a prefix are relative to
`reference/stracciatella/src/game/`.

---

## 1. Stub pack

### 1.1 Scope

Every feature's done criterion is "also runs on stubs, CI only on stubs" (`01` §4.4). The pack lets a campaign be played
from a new game to the Queen's death through MCP and in the browser (sound, music, a splash video, saves, the canvas
screens, English or Russian labels) and gives every platform feature content that exercises it. It is no replica of
every sector or quest: narrative content stays the minimum the tests and the stub campaign need. Items, weapons,
dealers, the army and the strategic tables come from `data/externalized` on every data version and need no stubs. The
stub skin (the canvas screens' art): `28` §9.

### 1.2 Licence and the SFI-SCLA list

The stub content is dedicated to the public domain under CC0 1.0 (`stubs/LICENSE.txt`; `stubs/NOTICE.txt` says what the
dedication covers). Both travel with the pack. Exceptions, listed in the notice:

- the generator code (`stubs/**/*.ts`) stays SFI-SCLA with the rest of the code;
- the Stub Pixel fonts are OFL (§1.6);
- a file that only ties the content to the game, listing its paths, sectors, tile or animation slots, glyph numbers or
  map data from Stracciatella's tables, stays SFI-SCLA and goes on the notice's list of such files (`aliases.json`,
  `binarydata/ja2bin.dat`, the map board coloured by the traversability data, …). `stubs/build.test.ts` checks that
  every listed file exists in the pack.

Everything else must be own work, so that the dedication can cover it.

### 1.3 Content rules

- Nothing is traced, sampled or derived from the original data: sounds are synthesized, text is written fresh, maps are
  drawn in the ASCII format (`01` §4.4); names follow the original paths only so that one content table serves both.
- Stub art draws what the layouts require (rectangles of the declared size, labels in the stub font, simple shapes),
  never the original's look: no frames, textures, icons, ornaments or colour schemes taken from its screens.
- Stub texts stay generic: they do not retell the original's story or use the names of its characters and places; the
  game's identifiers appear only as keys.
- The build is deterministic (same bytes every build); generators take no time or randomness from the system (the sound
  synthesis seeds its own xorshift generator from the file's class name).
- Every new stub family gets a decoder round-trip test in `stubs/build.test.ts`; media budgets live there too.

### 1.4 Build, mounting and aliases

- **Build.** `pnpm stubs` (`stubs/build.ts`) writes the pack to `dist/stubs`. The build goes into a sibling folder that
  is then renamed over the pack (`replaceStubPack`, `stubs/ensure.ts`), so the pack changes in one step, never file by
  file under a running server.
- **Rebuild only on change.** `pnpm dev` and the campaign bot call `ensureStubPack`, which rebuilds only when the inputs
  digest differs from the one recorded in `dist/stubs.inputs`: SHA-256 over the modules `stubs/build.ts` imports, every
  non-test file of `stubs/` and `data/` (the only folders the build reads at run time), `pnpm-lock.yaml` and the Node
  version. A new run-time input of the build must join `STUB_PACK_INPUTS`, or the pack goes stale.
- **Mounting.** `openDataVfs` (`src/node/data-vfs.ts`) mounts the pack (`JA2_STUBS_DIR`, default `dist/stubs`) as the
  lowest layer under the `stubs/` prefix (`01` §4.2). Content loaders probe the original name first and
  `stubs/<name>` second (`readLayered` in `src/content/narrative/npc-records.ts`, `sectorMapPath`): original files
  always win, the pack fills only what the data lacks. `TextService` and `GET /vfs/<path>` fall back to `stubs/<path>`
  only on the stub data version (`31`), so a client asks for `sounds/door open 01.wav` on both data sets. Without
  original data the data version is `stubs` (`31`).
- **Aliases.** `aliases.json` at the pack root (`src/content/vfs/aliases.ts`) lets many original names share one
  generated file: the stub layer lists each alias as a file that reads its target; real files win; an alias to a missing
  file or to another alias fails the mount. Sector kinds, fonts, sounds, speech, faces, item pictures and load screens
  use it.

### 1.5 Contents

| Area | Source | What it covers |
|---|---|---|
| Sector maps | `stubs/maps/*.map.txt`, compiled by `stubs/world.ts` | hand-made A9, A10, A10_b1, D5, L10, N7, P3, P3_b1, P3_m; `village` (the sandbox map, `STUB_SANDBOX_MAP`); `wilderness` for every sector without another map; five kind maps behind the sectors of `stubs/maps/sector-kinds.json` (§1.6) |
| Tileset and structures | `stubs/world.ts`, `stubs/tiles.ts`, `stubs/effects.ts`, `stubs/helicopter.ts`; person, vehicle and corpse structure files from `src/content/anim/` | tileset 0 with the tile types of §1.6; tileset 17 (the airstrip) with the helicopter |
| Soldiers | `stubs/soldiers.ts`, `stubs/anim-scripts.ts` | stand, walk, run, crouch and prone sheets for every animation surface (the vehicles' too); an invented script for every animation state; palettes |
| Characters and text | `stubs/profiles.json` (defaults in `src/content/formats/stub-profiles.ts`), `stubs/npc/`, `stubs/text/`, built by `stubs/npc.ts` and `stubs/text.ts` | the profiles of §1.6, their NPC records and EDTs, merc quotes, the item descriptions the stub campaign and tests use, credits, mails, help and laptop texts |
| Locks | `stubs/locks.json` | |
| Sounds, music, speech, video | `stubs/media.ts` and the generators it calls (§1.7) | |
| Fonts | `stubs/fonts.ts` (§1.6) | |
| UI art | `stubs/ui/` (the stub skin, `28` §9) | labelled screens and buttons, cursors, faces, item pictures, the map board, radar maps, load screens |

### 1.6 Maps, characters, tiles and fonts

**Sector kinds.** `stubs/maps/sector-kinds.json` (built by `stubs/sector-kinds.ts`) gives every sector the strategic
tables name a kind and a map: `town` (towns, the prison with the Alma captives' cells), `mine` (the entrances, a shaft
down, a placement per head miner), `cave` (mine levels, lairs, other basements), `camp` (SAM sites, garrison sectors)
and `airfield` (the airport, Skyrider's alternate maps). The build turns each listed sector into an alias of its kind's
map, so `sectorMapPath` (`src/content/strategic/sector-maps.ts`) finds `stubs/world/maps/d13.dat` without a code change;
original maps still win. `stubs/sector-kinds.test.ts` checks the table against the towns, mines, SAM sites, garrisons,
underground sectors, lairs and Skyrider's placements.

**Placement rules.** The surface kind maps, `wilderness`, L10 and N7 have the four entry points (edgepoints generated at
load) and at least 20 enemy slots, the largest garrison but the Queen's: `AddSoldierInitListEnemyDefenceSoldiers` places
soldiers on the map's enemy placements only, so a group member without a slot would be counted in battle but never
placed, and his group would keep its count after the battle. P3 has 32 elite slots for `QUEEN_DEFENCE`, laid out so a
squad can fight its way to the stairs. The other hand-made maps have fewer (A9 six, for the Omerta garrison). NPC
placements carry a `STAYINSECTOR` schedule: an unscheduled civilian would get the default come-and-go schedule
(`Strategic/Scheduling.cc:917-955`), which spares only animals and vehicles, so the L10 car needs none.

**Same-sector exits.** The stub map format accepts `exit: x y -> here z=<level> at X Y`, written as sector 0,0;
`withSectorExitGrids` (`src/content/strategic/sector-maps.ts`) resolves it to the sector named by the map file, so one
mine map leads down from every mine and one cave ladder up to the surface above. Original maps never hold sector 0,0.

**Characters.** Invented characters on the original profile ids, so the hiring, dealer, head-miner and helicopter code
finds them: twelve A.I.M. mercs (0–11) whose hiring rules (hate, buddy, death rate, reputation, learned opinions) give
each refusal path a case, a M.E.R.C. merc, two R.P.C.s, the vehicles, Skyrider, the five head miners, one dealer per
town and the NPCs of the hand-made maps. Their kits fix two things: the last gun of a kit sets the profile's gun
attractiveness (`Tactical/Soldier_Profile.cc:189-199`), so the stub mercs measure their weapons against the Glock 17
sidearm every kit carries; and that sidearm with two `CLIP9_15` is what the A10 stub NPC's give script and the give and
talk e2e scenarios use. A stub campaign hires from all twelve (`STUB_SQUAD_PROFILES`, `src/server/campaign-factory.ts`),
since `StartSomeMercsOnAssignment` sends some away at a new game. The scripts carry what the stub campaign path needs:
Skyrider's escort to the Drassen helipad (`ASK_ABOUT_ESCORTING_EPC`, then `ESCORT_SKYRIDER` and `UN_RECRUIT_EPC`, after
which the arrival rule sets up the helicopter), a head miner's first line starting his mine (`START_MINE`). Every
profile that speaks has its merc EDT and a speech blip. Skyrider's stub EDT has only his escort lines, so the dialogue
queue says none of his helicopter and monologue lines in a stub campaign: each still holds the map screen's pause for one
pass and runs the special events queued behind it (`24`).

**Meanwhile scenes.** `stubs/npc/records.json` holds the Queen's and her aide's record file of every meanwhile
(`160`–`176`, `180`–`196`; `171` and `191` are the interrogation's), and `stubs/maps/p3_m.map.txt` the hall where the
sixteen palace scenes play, the map P3 loads inside a meanwhile (`mapFileName`, `src/content/strategic/sector-ids.ts`).
Their shape is the original's: the Queen walks to her aide in two stops, speaks and slaps him, and the scene's last
line ends it with `END_MEANWHILE`. The lines are silent (quote numbers past the stub EDT rows, as the stub dealers'),
since rows added to the Queen's and her aide's EDTs would change the text identity of the 0.7.0 stub saves
(`src/server/legacy-save.test.ts`). Four of the original's record selectors appear, in one scene each: the first
battle picks its end by the battle result, the northern town's scene by the town count, the first missile site's by
the site count, the creatures' by `NO_SCI_FI_END_MEANWHILE`; the outskirts scene shoots the aide instead of the slap.
The hall holds the three scene NPCs and every palace scene's camera gridno, plus a civilian of the Queen's group, a
free one and two guards, so that the palace setup and the enemies a meanwhile load leaves out show in a test.
`stubs/npc.test.ts` follows every path through each scene to its end and checks the walks; `stubs/sector-kinds.test.ts`
checks the hall.

**Animation scripts** (`stubs/anim-scripts.ts`) are invented, except that the seven unjam scripts end like the
original's with the non-interruptible release and opcode 476, which returns to the shooting animation the jam
interrupted; otherwise the shot never comes and its busy count stays (`stubs/anim-scripts.test.ts`). The vehicle work
scripts carry the original's codes in its order: `REFUEL_VEHICLE` passes the refuel code 769 before its release,
`GOTO_REPAIRMAN` goes on to `BEING_REPAIRMAN` after its release, and `VEHICLE_DIE` loops. A tank fires its cannon
once in `TANK_SHOOT` and six rounds in `TANK_BURST`, between the attack busy codes, as the original's scripts do.
`HOPFENCE` ends with its release, the end of the hop (code 444) and the end of the animation, in the original's order:
a hop that ends the move changes stance at code 444, which a non-interruptible animation would refuse. `FALL_INTO_PIT`
sinks with code 409 and ends with its release and the fall code 754, which takes the soldier off the map (`12` §6).
`QUEEN_SLAP` and `QUEEN_FRUSTRATED_SLAP` carry the original's slap codes in its order: the aide takes the slap (759)
halfway, and after the release the Queen's next record comes (758); without them a palace scene stops at the slap.

**Vehicles.** The structure files `hmmv` (the Hummer, the Eldorado, the ice cream truck and the jeep) and `tnk_sht`,
`tnk2_rot` (the two tanks) are own shapes (`STUB_VEHICLE_SHAPES`, `src/content/anim/structures.ts`): per facing, the
tiles inside a rectangle turned to it and centred on the base tile, 15 or 17 tiles for the car and 21 or 23 for the
tank, with the original's vehicle flags (`MOBILE | TRANSPARENT | VEHICLE`) and metal armour. The car stands two or
three cubes tall, the tank three and four at its turret, the cube a shot at a tank aims for (`CalculateSoldierZPos`
raises a tank's target by a third), as the original's tank reaches it. A soldier's structure loses
the flags that block moves (`WorldStructures.add`), so the vehicle stops other soldiers as a person does: every tile is
his for `whoIsThere`, which paths around people avoid. The vehicles draw the stub stand sheet: the client picks no frame
by the 32 facings of a vehicle surface. L10 is a garage yard (`stubs/maps/l10.map.txt`) with the car of profile 160,
whose stub sector is L10, at gridno 12083 facing west; a squad that walks in from L9 arrives around the west entry 12074,
nine tiles from the car's base tile. No golden or e2e spec loads L10; the stub campaign bot's march may fight there, so
the map keeps the wilderness's four entries and twenty enemy slots. Tests reach the car with `stubCampaignAtTheHummer`
and put a tank on any loaded map with `addStubTank` (`tests/support/vehicles.ts`, pinned by
`src/sim/campaign/stub-vehicles.test.ts`): no stub map places a tank, since the original's tank sectors are garrisons
and share the camp map. Dave and his sale are not in the pack: a test that boards the car sets `FACT_OK_USE_HUMMER`
itself.

**Tile types.** The stub tileset fills grounds (the water with the 34 sub-indices a pit lays, `12`), a floor, two wall families (each with the end pieces at sub-indices 48
to 55 that a destroyed wall leaves its neighbours, `12`; the frames between are unused), roofs (flat climbable, slanted,
high), barrels, doors, wooden and wire fences, low and high sandbags, a cliff with its lip, debris, the item graphics
(every `tileGraphic` of the item tables), the effect tiles and the roof marker `FIRSTPOINTERS11` (the cursor pointers
before it are empty frames, so the stub pack draws no tile cursor). Stub structures come from `syntheticStructure`
(`src/content/world/synthetic.ts`); its `edge` option fills the cells of the original's wall shapes (left walls the far
`y` row, right walls the far `x` column, read from the tileset 0 wall and door structure files), so the stone walls,
windows and fences block sight and fire along one edge of their tile. `FIRSTWALL` (A9, the village houses, the bench
arena) keeps full tiles, on which the arena's sealed bunker relies. A tile yard east of the village exercises each
family (`src/sim/tactical/stub-tiles.test.ts`); its wire fence, each piece paired with its cut partner, is what `cutFence`
cuts there (`src/sim/tactical/tile-tools.test.ts`). The airfield map uses tileset 17, the airstrip's id, whose only own
types are the helicopter in `FIRSTOSTRUCT`, where the Drassen refuel site looks for its six pieces (`25`), and the
airfield's barrels in `THIRDOSTRUCT`; every other type falls back to tileset 0. The stub town map does not reach the
Estoni landing site, so the helicopter stands only at the stub airport.

**Fonts.** `stubs/fonts.ts` builds two bitmap fonts from a subset of Terminus Font 4.49.1 (SIL OFL 1.1), renamed Stub
Pixel 12 and Stub Pixel 16 Bold because of the licence's Reserved Font Name. The subset (`stubs/font/*.txt`) sits next
to `OFL.txt` and `NOTICE.txt` (source, version, hash, changes) and is regenerated with `tools/stub-font-subset.ts`. The
glyphs use value 1 for the shadow and 2 for the ink, as the original's mono-shadow blitter expects; `aliases.json`
points the 17 font names of `Utils/Font_Control.cc:37-52` at the two fonts, and the stub glyph table
(`translation_tables/translation-table-stub.json`, Stracciatella's shape) adds lowercase Cyrillic and a few punctuation
marks to the English table's glyph numbers.

### 1.7 Sounds, music, speech and video

- **Sounds** (`stubs/audio.ts`): one short WAV per cue class (footsteps by terrain, gun classes with silenced and burst
  variants, reloads, hits, falls, explosions, doors, items, UI clicks), generated from noise and tone envelopes; battle
  voices as one generic set per body class, not per profile; an ambient table for the stub tileset (`stubs/ambient.ts`).
  The original paths (`sounds/…`, `battlesnds/…`) are aliases, so the same cue table resolves on both data sets.
- **Speech** (`stubs/speech.ts`): one IMA ADPCM blip and `.gap` per stub speaker and quote family, behind every quote
  that has stub text, so the speech and lip paths run; blip lengths are unrelated to the text. The merc EDTs give merc
  quotes their text, so `mercQuote` events are emitted and quotes take their text's time (`31`).
- **Music** (`stubs/music.ts`): one short chiptune loop per track of `music.json`, named as there.
- **Video** (`stubs/video.ts`, `stubs/smk-encode.ts`): only `intro/splashscreen.smk` (a title card and a tone).
- **Formats** (`stubs/wav-encode.ts`): 8-bit and 16-bit PCM, mono and stereo, and IMA ADPCM, so every decoder path runs
  on stubs.

### 1.8 The stub campaign bot

`pnpm cli campaign` (`tools/campaign-bot/`; options and the campaign's steps in its usage text) is a scripted player
and an example of an agent against the API. It uses the MCP tools alone over Streamable HTTP with the SDK client
(`mcp-game.ts`) and decides from the observation only, with no clock and no randomness, so a seed plays the same
campaign every time. Without `--server` it builds the stub pack if needed and starts its own stub server
(`stub-server.ts`: `src/server/main.ts` with an empty `JA2_DATA_DIR`, a random token, a temporary save folder). The
battle, retreat, outfitting, healing and prompt policies live in their modules (`battle.ts`, `retreat.ts`, `outfit.ts`,
`heal.ts`, `prompts.ts`, …). A refusal whose text names the next step is answered and the command sent again
(`refusals.ts`): `mapScreen`, `tacticalScreen`, `enterSector` and `openLaptop` wait for an open prompt to be answered
and, with time stopped, `advance {idle}` past queued lines, a meanwhile about to start or a pause lock; a squad too
injured or too tired to travel rests in its sector before it is routed again.

- **Reload checks** (`reload.ts`). *Exact load*: in the first battle that reaches round 2 the bot saves, loads with
  `reseed: false` into a new session, then sends every `observe`, `act` and `advance` to both sessions until the battle
  ends, comparing the views (without `language` and `dataVersion`) and the advance reports (without the save and load
  events and the session's own messages); the summary lists the steps compared and the differences, and the campaign
  plays on in the loaded session. *Player load*: after the Drassen mine it saves, loads with `reseed: true` into a new
  session and plays on there; the reseed takes the server's entropy (`27` §1.5), so a run after it is not reproducible.
- **e2e** (`tests/e2e/campaign.spec.ts`): seed 3 up to the end of the landing battle with the exact load at round 2;
  the battle is won with no merc lost, no difference shows over more than 20 compared steps, and the campaign continues
  in the loaded session.

**Status.** Drassen, the mine, Skyrider, militia and recruiting work on every seed; every exact load matches its
original session over the rest of its battle. The bot does not win yet: squads are lost on the march through patrol
country (F11–L3; the patrols around K7–L10 are twelve and thirteen strong) and at the Meduna outskirts (M3, N3 and O3
hold twenty each, refilled while the squad regroups). These are the original's tables, not stub content. Candidates:
outskirts maps with cover an attacker can use (the stub camp and town maps are open ground around their posts), a
policy that picks cover and attacks at night, a larger team, the helicopter for the march. The endgame steps (P3,
P3_b1, the Queen, the ending) reach the victory with mercs placed in O3, not yet through a full campaign. Repro:
`pnpm cli campaign --seed 2 --no-reload`.

**Open findings** (seen by the bot, not traced against the original, not reproduced on demand):

- In real time a merc whose next tile is taken by a squad mate who stopped on it waits in `HandleNextTileWaiting`
  without end (G11, seed 3).
- After a retreat that leaves unconscious mercs behind in a sector in turn-based combat, the sector stays in combat and
  the map screen refuses `advance` ("combat is in progress") until someone goes back and ends the turn.
- Once, after a player load, `route` answered "the squad cannot move: dead" after a won battle (D13, seed 1), although
  a death removes the merc from his squad (`HandleStrategicDeath`).
- Once, after a player load, an enemy turn against fifteen soldiers (K10, seed 3) did not end within `advance`'s
  200,000-tick budget.

### 1.9 Known limitations

- Stub underground levels connect only to the surface above them, so the levels below a mine's first and the creature
  lairs have no way in: a sci-fi stub campaign whose creatures invade a mine cannot reach their queen (play stub
  campaigns with sci-fi off).
- `FIRSTWALL` structures fill their whole tile, so a merc on such a wall tile cannot see along the room.
- Only the splash video exists; sequences skip the missing names (`31`).
- The stub fonts are not used as a Cyrillic fallback with original data (`31`).

---

## 2. Performance

The simulation layers read no clocks (`01` §3.2), so all timing is taken outside `sim`. Baselines measured on the
original data stay local, since the data may not be committed. Client frame time and UI targets: `28` §11.

### 2.1 The benchmark suite

`pnpm cli bench <scenario|all>` (`tools/bench/`; options in its usage text). Every scenario is a fixed seed plus a
scripted command list, so a rerun does the same work and only machine noise varies. No scenario needs the native oracle.

- **Determinism check.** The runs' work signatures (turns, ticks, shots, hits, deaths; alert states; strategic events;
  autoresolve slices) must be equal, else the line is flagged and the command fails: shared mutable state would make
  the numbers meaningless.
- **Isolation.** Each variant runs in its own child process, because V8's optimization state carries over between
  battles in one process (§2.3); with two or more runs an untimed warm-up comes first. Every line records the load
  average before and after, to spot a busy machine.
- **Instrumentation stays outside `sim`.** Counters come from a wrapper around the `SessionSim`. `--calls` counts calls
  of named simulation functions through V8 precise coverage (`tools/bench/inspector.ts`, one extra run, about 8×
  slower); `tools/bench/stats.test.ts` fails when a counted function is renamed.
- **Seeds** are per scenario, chosen so the stub runs avoid known stalls; `--seed` overrides them all.
- **Stall sweep.** Watchdogs are not ported (deviations "Watchdogs"), so a stall is a bug that fails the run: a line
  whose `outcome` is `stalled …` (`enemy-turn`, `campaign` and auto-bandage in `realtime`) makes the command fail, as a
  sanity bound does. The sweep:
  `bench enemy-turn --runs 1` with seeds 1–8 on both sources and `bench campaign --runs 1` with seeds 1–16 on stubs,
  every run ending without a `stalled` outcome.

| Scenario | What it runs | Primary metric |
|---|---|---|
| `enemy-turn` | turn-based battles through a `Session` with the instant driver's semantics (an advance with a 50,000-tick budget, so a stall is reported instead of spinning); the mercs fire once a turn at the nearest visible enemy. The generated arena with 8, 16 and 32 enemies against six mercs and four civilians (plus six militia with 32); on the original data also A9 with 4, 16 and 32 garrison soldiers and the D13 battle of `SaveGame10` | ms per enemy side turn |
| `realtime` | the patrol arena with 20, 40 and 64 soldiers around six mercs sealed in a bunker, green and yellow; a variant in which combat starts is void. Auto-bandage (`bandage-*`): three of six mercs bleed and carry no kit, the other three carry one, spread over an open arena among 20 and 32 civilians (the civilian team's limit) or at the entry of C13 among its own (8 on the stubs, 27 on the original data); the run starts the mode with the `a` key's commands and times every frame through completion and 1000 frames of the box to the end, and a mode not complete within 20,000 frames is a stall | µs per tick; µs per frame |
| `strategic` | a new campaign with the squad routed so that no sector is loaded, then 7 and 30 world days of compression with one or six mercs; once more with Drassen handed to the player and the Queen woken; and six mercs in Drassen with C13 loaded (`-town`: 15 soldiers on the stubs, 32 on the original data), at 60 and at 5 (`-min5`) world minutes per second. The other variants compress at 60 | ms per world day |
| `autoresolve` | 20 battles a run of 10, 20 and 40 per side | ms per battle |
| `save` | saves and loads of the 64-soldier arena, a landed new campaign and, on the original data, the largest native save of `$JA2_SAVES_DIR` | ms per save; snapshot, encode, parse and restore as series |
| `server` | in process, sessions sharing one slice scheduler: 1, 4 and 16 real-time viewer sessions plus one instant battle per four viewers, driven by WebSocket clients in a worker thread | the longest event-loop stall |
| `campaign` | in a child process: a new campaign with six mercs, the landing and the first sector cleared | total ms, peak RSS |

The arena (`tools/bench/arena.ts`) is own work generated from the seed in the stub map format, round-tripped through
the map writer and served from an in-memory overlay as `stubs/world/maps/bench-<name>.dat`, so the stub pack stays
unchanged.

### 2.2 Targets

Each JSON line carries its target where the scenario defines one; the bench fails only above ten times the target
(`SANITY_FACTOR`) or on a stall (§2.1), so a failing bench means a gross regression or a hang, and the verdict is read
from the numbers. Only runs made back to back on one machine compare: the development VM's throughput varies more than
its load average shows.

| Metric | Target | Status |
|---|---|---|
| Enemy turn, 16 enemies, p95 | ≤ 300 ms | met |
| Enemy turn, 32 enemies plus militia and civilians, p95 | ≤ 1 s | met without margin on the arena: the turn is the cover search's chance-to-get-through traces |
| Real-time tick, 40 soldiers, mean | ≤ 0.25 ms | met with a wide margin |
| Real-time tick, worst single tick | ≤ 50 ms | met; above it a tick shows as a hitch at ×1 |
| Auto-bandage frame, p95 | ≤ 5 ms: 200 frames a second at ×1 | met widely: 0.85–0.91 ms in the arena, where the medics cross the field, and 17–26 µs in C13, on both sources; the busiest 200 frames in a row take 183–192 ms in the arena and 6–9 ms in C13, and a frame of the box after completion 6–8 µs on average. The worst frame is the first, 40–60 ms in the arena (1.3–2.3 ms in C13): every medic decides at once and searches his paths to every patient, a hitch at ×1 as the mode starts (§2.3) |
| Strategic world day, no sector loaded, p95 | ≤ 100 ms | met: 25–45 ms with the map's real-time turn for six mercs, about 10 ms a day more than without it |
| Strategic world day, a town sector loaded, p95 | ≤ 100 ms | met at 60 minutes per second: 65 ms on the stubs and 80 ms on the original data; 415 ms and 750 ms at 5, under the bench's 1 s bound (130 ms, 165 ms, 1.3 s and 1.75 s before the look skip, §2.3; 455 ms, 545 ms, 4.5 s and 5.8 s before the sight memo and the shared soldier shape; 25–30 ms and about 0.18 s before the map ran the real-time turn). Every 20 ms poll runs the turn on the loaded sector, 14,400 polls a world day at 5 minutes per second: what is left is checking the remembered look's tape (a quarter to a third), the turn start of every soldier (a fifth to a quarter) and the campaign's per-step event collection (a tenth to a sixth) |
| Autoresolve battle, 40 per side, p95 | ≤ 10 ms | met |
| Save (snapshot, stringify, gzip) | ≤ 100 ms and ≤ 2 MB gzipped | size met widely; time met except the largest native import (at the target at the median with every sector's temp files, a tenth more than its loaded sector's alone) and a session's first save (§2.7) |
| Load (parse, restore with fresh content) | ≤ 500 ms | met; most of a load is building the content again |
| Stall of other sessions while one runs an instant battle | ≤ 50 ms | met: one 10 ms slice plus the longest single tick (`04` §5.9); in-process saves still stall (§2.7) |
| Campaign (land and clear the first sector), peak RSS | ≤ 512 MB | met |

### 2.3 Profiling and optimization

- Profile with `--profile` (a `.cpuprofile` for Chrome DevTools and the hottest self-time frames) and fix the top
  frames only. Every optimization keeps the outcomes: the same counters in every bench line, byte-identical frames,
  event logs and final snapshots (hash them over a compressed week and two campaign battles on both sources, before and
  after), the oracle compare unchanged. A skip is checked also against itself switched off (`setLookSkipping`, `08` §2)
  over every scenario and a compressed week with a loaded town, its civilians and militia, smoke, items in the open and
  in a hidden room, stream states included.
- Caches are derived data: they live beside the state, are rebuilt on load (`27` §1.9), never enter the snapshot and
  never change an outcome.
- Profiles of the save path misattribute time to whatever runs during a garbage collection; time the phases with
  `performance.now()` before trusting a frame.
- No event jumping (`04` §2, level 1b) unless the real-time target fails after caches: it changes the stepping model.
- A hot function that deoptimizes again and again (`node --trace-deopt`) may hide a porting gap: an unported branch of
  `GunRange` (`Tactical/Weapons.cc:86`) once divided by zero in the range drop, and the Infinity and NaN values made V8
  give up on the bullet code until enemy turns ran three times slower.

**In place** (derived data only):

| Optimization | Where |
|---|---|
| the roster's sorted list, and its soldiers for every turn start, reused until the roster changes | `Roster` (`src/sim/campaign/roster.ts`) |
| enemy counts and the player's knowledge of them for the whole surface map at once, each tested against its per-sector original | `numEnemiesInEverySurfaceSector` (`src/sim/strategic/forces/groups.ts`), `surfaceKnowledgeOfEnemies` (`src/sim/strategic/map/knowledge.ts`) |
| unchanged sector views reused between frames | `src/server/strategic-view.ts` |
| view diff by `sameJson` (equal exactly when the `JSON.stringify` outputs are equal, fuzz-tested) | `src/protocol/same-json.ts` |
| no view built or diffed without a subscriber | the session (`04` §5.9) |
| an occupied cover position traced once for all three stances | `locationChances` (`src/sim/tactical/ai/cover.ts`) |
| collision-free throw forces remembered per item table | `knownForces` (`src/sim/tactical/explosions/trajectory.ts`) |
| a look out of combat skipped while everything it reads stands as after a look that changed nothing: a tape of its inputs, compared value by value, with change counts for the structure lists, movement costs, smoke, light, fog of war, blood and occupancy that every writer bumps | `src/sim/tactical/perception/look-memo.ts`, `allTeamsLookForAll` (`08` §2) |
| the ray of each viewer and target, reused while its inputs stand (tiles, levels, stance heights, bodies, terrain, camouflage, range, awareness, the change counts of the structure lists and the smoke layer); no sight work for an unseen pair beyond the farthest sight of anyone but a creature | `src/sim/tactical/perception/sight-memo.ts`, `manLooksForMan` (`08` §2) |
| soldiers built from three object literals of fewer than 128 properties each: V8 gives each object of a larger literal a hidden class of its own, which made every soldier field read in a loop over soldiers megamorphic | `createSoldier` (`src/sim/tactical/soldier.ts`) |
| the placed soldiers of the merc slots handed out as one read-only list until a slot or a placement changes | `mercs` (`src/sim/tactical/state.ts`) |
| an item's definition looked up once for its weight, and not at all for an empty pocket | `objectWeight` (`src/sim/tactical/inventory.ts`) |
| advances in 10 ms slices, one slice per event-loop turn; optional worker per session | `src/server/slicing.ts`, `src/server/session-host.ts` (`04` §5.9) |
| gzip at `Z_BEST_SPEED`, on the thread pool when asynchronous: the default level gives about 40 % smaller files but takes three times longer | `src/server/save-file.ts` |

**Left**: the map screen's real-time turn on a loaded sector, run at every 20 ms poll while compressing (§2.2): the check
of the remembered look's tape (a few thousand values with C13 loaded on the original data, about 15 µs a poll), the turn
starts of every soldier (the carried weight, the action points, the breath) and the opplist decay. A memo of the walk's
structure reads per tile (blocking, tallest structure, slanted roof), keyed by the lists' change count, ran slower than
the reads, most tiles having no structure; checking the tape in place instead of recording and comparing it, and
leaving out the narrative reads, changed nothing measurable. Candidates: an index of world items by tile (the walk scans
every item at each tile it reveals, when a look runs); soldiers restored from a snapshot, which the codec builds by keyed stores (`#plain`, `src/sim/snapshot/codec.ts`), the
way V8 turns an object of some 260 properties into a dictionary (not measured on a restore); the per-step event collection of `CampaignSim`, a tenth to a sixth at 5 minutes per second. Also left: the cover search's chance-to-get-through traces (within one AI decision under 4 % repeat exactly, so a memo would not pay) and the path
search, which is four fifths of auto-bandage's profile in the arena: each medic's decision searches a walk to every
patient and the cost of the medic a patient already has, and the full check plots one walk every other frame, about
380 searches in a run of 1415 frames. Candidates not yet profiled: sight results per tick between position changes, path costs within one AI decision,
the reachability flood shared by cover and flee searches, allocation in the bullet and LOS loops.

### 2.4 Session hosts

The `SessionHost` interface, the in-process host with time slicing and the worker host: `04` §5.9. The in-process host
(the default) costs no extra memory and no content load per session. The worker host (`JA2_SESSION_HOST=worker`) uses
several cores and removes the stalls slicing cannot (single ticks of up to about 30 ms, saves, opening a session and
loading a save, 0.2–0.5 s of content building), at about 100–140 MB of RSS and a content load per session on the
original data; each worker builds its own content index on its first save. A server runs all its sessions in one host
kind, with no automatic choice: switching when a second session opens would move a running session between threads.

### 2.5 CI

`.github/workflows/ci.yml` runs `pnpm check`; the stub pack, the bench smoke runs and `pnpm build`; `pnpm e2e` in
three shards; and the browser suite only when `tools/gates.ts --plan` selects `e2e:browsers` for the change (or the
base is unknown). A push or pull request that touches only `docs/`, Markdown files or `LICENSE` starts no CI.

- The bench smoke runs every scenario once on stubs plus one `--calls` run and uploads `bench.jsonl`. One run means no
  warm-up and no run-to-run check: CI numbers are cold, a smoke signal only; it fails on errors, a sanity bound or a
  stall.
- Playwright installs its browsers without `--with-deps`: the runner image carries the system libraries, and the apt
  step of `--with-deps` once took more than 10 minutes on a slow mirror.

### 2.6 Test runs and gates

- **One stub pack per unit run.** `tests/support/build-stub-pack.ts` (a vitest `globalSetup`) builds the pack once,
  read-only (a test that writes into it fails at once), and passes the folder in `JA2_TEST_STUB_PACK`, read by
  `sharedStubPackDir()` and `openStubPack()` (`tests/support/stub-pack.ts`). A test that changes a stub file builds its
  own pack. A Playwright `globalSetup` (`tests/e2e/dev-server-stub-pack.ts`) points the e2e helpers that write saves
  before a suite at the pack the dev server built, the one the server under test reads.
- **Mode runs.** Data tests read the folder only through `ORIGINAL_DATA_DIR` (`tests/support/original-data.ts`), reload
  tests the mode only through `tests/support/reload.ts`, so `pnpm test:data` and `pnpm test:reload` run `vitest
  related` on those modules: each runs only the files its mode changes, not the stub suite again. `pnpm imports`
  (`tools/check-imports.ts`) refuses a test-side file that names `JA2_DATA_DIR` or `JA2_RELOAD` outside its module,
  since `vitest related` would then miss it.
- **`pnpm gates`** (`tools/gates.ts`, options in its usage text) runs the gates the changed files can affect, in order
  `check`, `data`, `reload`, `oracle`, `e2e`, `e2e:data`, `e2e:browsers`. `AREAS` maps paths to gates: the simulation
  layers and `data/` reach everything but the browser suite, the client layers skip `reload` and `oracle`, only the
  canvas presentation files reach `e2e:browsers`, docs reach nothing, and a path no area names (or the lockfile) runs
  everything; `--list` shows the plan and the file that selected each gate. CI's `browsers` job uses the same plan.
- **e2e goldens** capture after the page's VFS reads and cursor hints settle: `capture()` (`tests/e2e/ui-capture.ts`)
  takes the frame only when no `/vfs` read is open (`reads.pendingReads`) and no `HintProvider` answered `pending`
  (`hints.pendingReplies`) during the two frames before it, unless a golden holds a read on purpose
  (`'whileReading'`, the loading screen). Otherwise a button enabled by a hint (the map screen's tactical button) is
  drawn hatched until the answer arrives. A message box keeps the screen's draw items once its images have loaded, but
  not past a pending hint, which no later settling changes, so a golden of one lets the event that opens it happen only
  after `waitForSettledFrames` with game time held (`?holdTime=1`, then `advance`; the meanwhile box of
  `story.spec.ts`). `capture()` does not wait for a command the page sent: a golden taken after a click that sends
  one first waits for the widget its reply changes (the laptop's balance, the new-file icon's help once a file is
  read in `laptop-pages.spec.ts`, Bobby Ray's shipping quote in `laptop-sites.spec.ts`). The browser suite compares a
  screenshot only with a frame that did not change while it was taken.
- **Timeouts.** One limit per runner, sized for a loaded machine (a busy hypervisor, parallel agents):
  `tests/support/patience.ts` for vitest, `tests/e2e/env.ts` for Playwright. Tests and helpers set no limits of their
  own, waits included; MCP calls pass the runner's limit (`MCP_CALL_OPTIONS`) instead of the SDK's 60 s. Shorter limits
  remain only on waits that tolerate a miss (`.catch`) and in the stall guard of `waitWhileLoading`. Tests that fail
  without a code change: `test-stability.md`.
- **Tried, not adopted**: vitest `--pool=threads` (no gain); `--no-isolate` (faster, every test passing, but state
  shared between files would make results depend on the order); a test pace (the client clock and the real-time speed
  scaled together would save about 40 s of e2e but test a pace nobody plays at, every timed window eight times shorter).

### 2.7 Known limitations

- The first save of a session on the original data stays above 100 ms at p95: it builds the content index and the text
  identity.
- In process, a save stalls the other sessions for its snapshot and stringify (also the autosave at an accepted
  `endTurn` in combat); the worker host avoids it. A snapshot could be taken in slices only if its sections were
  captured at one instant.
- The `server` scenario has no worker variant: its arenas live in an in-memory VFS overlay a worker cannot open.
- The `campaign` scenario stops after the first sector; the full campaign is `pnpm cli campaign` (§1.8), timed only by
  its summary's seconds.
- Seen while tracing stalls, not changed: `HandleSystemNewAISituation` drops a pending melee animation without its busy
  count when a new situation without a sighting arrives during the stance change before the attack; no source of such a
  situation during an AI's own turn was found, and no run met it.

---

## 3. The launcher

The launcher (`src/app/launcher/`, served at `/` from the repository's root `index.html`) is a DOM page for what the
canvas game at `/play` (`28` §3) does not show: the data source and version, the display language, the running
sessions with links to `/play` and to the developer pages, a new campaign, the save files, the client settings, the
splash and the credits. Its logic is DOM-free in `ui` and shared with the canvas screens (`30`): the campaign form
(`src/ui/client/campaign-form.ts`), the save controller and rows (`src/ui/saves/`), the settings model
(`src/ui/settings.ts`); the launcher keeps only the DOM glue, with `api.ts` for the fetch calls, since `app` may not
import `server`. Debug hook `window.__ja2Launcher`; e2e `tests/e2e/launcher.spec.ts`.

- **New campaign.** The game init screen's choices with `InitGameOptions`'s defaults preselected (`ORIGINAL_OPTIONS`);
  the form always sends all five options, so the API's own default difficulty never applies. Also the Dead is Dead save
  name, the squad (the server's default, 1–6 mercs, or hiring in the laptop) and the developer page to open; `?seed=N`
  passes a seed (tests).
- **Saved games**: `27` §1.11 (the panel), deviations "Save list in the launcher and on the canvas". Download and upload
  of save files and loading into another session stay in the launcher only.
- **Settings**: `27` §2.4. Settings apply at once; the volumes drive the launcher's own audio engine.
- **Splash**: unless `playSplash` is off or the data is neither English nor Chinese (`dataPlaysSplash`,
  `src/app/video/sequences.ts`), the launcher starts behind a "Click to start" button and plays the splash after the
  click, which unlocks the audio context; once per browser tab, not each time a game page links back (deviation
  "Splash start"). The credits play in a DOM scroller (deviation "Credits screen").
- **Labels** (`src/ui/text/labels.ts`, `src/ui/text/string-ids.ts`): every label is either an original string
  `{table, index}` of the string tables or a ja2-node label with an English and a Russian text, loaded from
  `GET /api/strings?lang=`. A ja2-node label falls back to English in the other six languages; a missing original
  string shows its label id. The message box is a `<dialog>` with the original's YES, NO and OK behind the
  `MessageBoxes` interface (`src/ui/message-boxes.ts`).
- **Loads in place.** The session client (`src/app/net/session-client.ts`) drops its queued frames whenever a `welcome`
  arrives, so no frame of a replaced simulation is applied after a load in place.
- **Playback speed.** `/play` plays the frames at the stored playback speed (`front-end.ts` sets it on the session
  client at connect and on every change); above 1× it only shortens a backlog, since playback never passes the
  newest frame. The developer pages keep their own playback buttons.

---

## 4. Data tables and original data

- **`data/externalized/`** holds Stracciatella's JSON tables unchanged; **`data/tables/`** holds tables transcribed
  from Stracciatella's C++ sources by `tools/transcribe/<name>.ts` (`node tools/transcribe/<name>.ts` regenerates one;
  never edit the JSON by hand). Each transcribed table records its source files and the Stracciatella commit in its
  `source` field, and carries the SFI-SCLA licence line. **`data/layouts/`** holds the UI layouts (`28` §8).
- Where a handful of values is all there is, the port keeps constants in a module with the SFI header instead of a
  table (the music modes in `src/protocol/music-modes.ts`, the intro sequences in `src/app/video/sequences.ts`, …).
- **Original data read at run time** (media, EDT files, fonts, the binary tables) is never committed. Tests that need it
  use `describe.skipIf(!ORIGINAL_DATA_DIR)` (`tests/support/original-data.ts`) and assert counts, formats and lengths
  only, so no test carries content derived from it.
- **Native save import**: the format and the import, `14`; the imported game options, `27` §2.2; the music mode,
  `31`.
