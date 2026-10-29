# 20 — Lighting

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`. Light levels are shades: **lower is
brighter**, 1 (`SHADE_MAX`) is the brightest, 15 (`SHADE_MIN`) the darkest; day is 3 (`NORMAL_LIGHTLEVEL_DAY`), night 12
(`NORMAL_LIGHTLEVEL_NIGHT`, `TileEngine/Environment.h:21-22`). The code is `src/sim/tactical/lighting/`.

**Scope.** Light templates, light sprites and their ray casting, `LightTrueLevel` and its gameplay consumers. How the
renderer shades tiles and soldiers is `05` and `06`.

## 1. What gameplay reads

Every `LEVELNODE` carries `ubNaturalShadeLevel`, `ubSumLights`, `ubFakeShadeLevel`, `ubMaxLights` and `ubShadeLevel`.
The renderer uses `ubShadeLevel` (natural minus the strongest light); gameplay uses only

```
LightTrueLevel(g, level)                                         // TileEngine/Lighting.cc:508
  node = level == 0 ? pLandHead : pRoofHead
  no node → ubAmbientLightLevel (raw)
  else clamp(natural − (sumLights − fakeShade), 1, 15)
```

so the simulation needs, per tile, the summed light of the **head land node** and of the **head roof node**. All land
nodes of a tile receive the same light, so the head stands for them. `ubSumLights` is a `UINT8` that wraps on
addition (`LightAddTileNode`, `:535`) and clamps at 0 on subtraction (`LightSubtractTileNode`, `:554`).
`natural = clamp(ambient, 1, 15)` on every node (`LightSetBaseLevel`, `:1360`).

Fake light (`MERC_LIGHT` sprites → `LIGHT_FAKE`, the merc's own light at night) is added to both `ubSumLights` and
`ubFakeShadeLevel` and cancels out of the true level; ja2-node does not simulate it.

Roof nodes are lit only by sprites with `LIGHT_SPR_ONROOF` (`LIGHT_ROOF_ONLY` in `LightAddTile`, `:586`), and only merc
lights ever get that flag (`Soldier_Control.cc:711`, `Soldier_Tile.cc:638`): map lights drop it on load
(`LoadSaveLightSprite.cc:10`, only PRIME/NIGHT are kept), explosions and flares never set it. In practice
`LightTrueLevel(g, 1)` is the clamped ambient on roof tiles and the raw ambient elsewhere.

## 2. Light templates

A template is a list of nodes (`dx`, `dy`, `light`) and a list of rays: node indices, each ray starting with a
`LIGHT_NEW_RAY` (0x8000) marker and running from the centre outwards.

- **Generation** (`LightCreateOmni`, `:1389` → `LightGenerateElliptical`, `:1272` → `LightCastRay`, `:928` →
  `LightAddNode`, `:866`): rays are Bresenham lines from (0,0) to the points of an ellipse with radii
  `radius × DISTANCE_SCALE` (4) sub-tiles; a ray that goes up is drawn bottom-up and inserted, so every ray ends up
  centre-first. A sub-tile point lands on tile `trunc(x / 4)`; its light is `intensity − trunc(dist / 4 × 0.9)` (0 when
  the decay reaches the intensity) and the **first** point that reaches a tile fixes that tile's light
  (`LightAddTemplateNode`). The double maths is plain IEEE and runs unchanged in JS.
- **Shipped form.** Stracciatella loads templates from `assets/externalized/light-templates.json`
  (`LightLoad`, `:1754`). That file is a conversion of the original `.LHT` files in `Data.slf` (`L-R01.LHT` …
  `L-R08.LHT`, `L-R01I2.LHT`, `TRANSLUC.LHT`): the node lists are byte-identical, the rays have runs of one node
  collapsed, repeated rays dropped, the 0x4000 flag stripped and the **last ray of every file lost**. The original
  files themselves equal `LightCreateOmni` output: `L-R0n.LHT` is `LightCreateOmni(n, n)` and `L-R01I2.LHT` is
  `LightCreateOmni(4, 2)`.
- **ja2-node** (`templates.ts`) generates those nine templates from the source algorithm and applies the same
  normalisation (`asShippedTemplate`), so nothing derived from the data ships in the repository. A data test
  (`templates.test.ts`) checks the result against the user's `.LHT` files.
- **`Light0` … `Light6`** (flares, break lights and merc lights) are not in the Gold files and not reproducible from
  the source. Stracciatella ships them in its `light-templates.json`, which is in the repository with the other
  externalized tables (`data/externalized/`), so the simulation and the renderer use that copy:
  `loadTacticalContent` reads `externalized/light-templates.json` and keeps the templates the generator does not make
  (`shippedLightTemplates`, `TacticalContent.lightTemplates`); `LightSpriteCreate` takes a generated template first,
  then a shipped one. `TRANSLUC.LHT` is in the same file, but only `ApplyTranslucencyToWalls` (rendering) uses it, and
  ja2-node does not (`deviations`, "Wall translucency template").
- Every original map uses only `L-R02` … `L-R08` **(data)**; explosions use `L-R04`, muzzle flashes `L-R03`.

## 3. Light sprites and ray casting

256 sprite slots (`LightSprites`), first free slot wins. Flags: ACTIVE 0x1, ON 0x2, ERASE 0x8 (drawn, must be erased),
ONROOF 0x20, MERC_LIGHT 0x40, PRIMETIME 0x80, NIGHTTIME 0x100.

- `LightSpriteCreate(name)` (`:1824`): free slot, position (161, 161), cached or loaded template, one stored filter per
  ray entry; null when there is no slot or no template.
- `LightSpritePosition(l, x, y)` (`:1901`): nothing if unchanged; erase if ERASE and the old position is on the map
  (`x < 160 && y < 160`, signed); move; draw and set ERASE if ON and on the map. ERASE is **not** cleared by the erase.
- `LightSpritePower(l, on)` (`:1974`) only flips ON; nothing is drawn or erased until the next render or move.
- `LightSpriteDestroy` (`:1863`): erase if ERASE (and on the map), clear ACTIVE.
- `LightSpriteRenderAll` (`:1885`): every tile to sum 0, every sprite loses ERASE, every ACTIVE and ON sprite is drawn
  and gets ERASE.

`LightDraw` (`:1401`) walks the ray list with `src` = centre at each marker. For each node: `dst = centre + (dx, dy)`
(`INT16`); the filter for `src → dst` is computed and stored; `src` resets to the centre; a blocked filter skips to the
next marker, otherwise `src = dst`. Then the node is skipped if the step is diagonal, if `src == dst` and it is not the
centre node (index 1), if the node was already lit from this direction (`1 << dir`, `DIRECTION_IRRELEVANT` = 9) or is
`DRAWN_FULLY`. A `NONWALL` node outside the south-east quadrant becomes `FULLY` without light (unless the filter lights
oriented blocks only). Otherwise, unless the filter lights nothing or the node's light is 0, the tile is lit and the
node gets its direction bit plus: `FULLY` on the axes and in the SE quadrant; nothing more for oriented-only light;
in the SW/NE quadrants `FULLY` when the step goes west or north, else `NONWALL`; in the NW quadrant `NONWALL`. Node flags
live in the template and are cleared at the start of every draw and erase. `LightErase` (`:1612`) repeats the walk
with the **stored** filters and subtracts.

The tile index is `y × 160 + x`: off-map columns wrap into the neighbouring row (the filter uses a `UINT16` tile, the
light an `UINT32` one; both reject everything outside 0…25,599).

**`IlluminationFilter(src, dst)`** (`:297`), in order:

1. `dst` or `src` off the map → blocked, lights nothing.
2. `dst` higher than `src` (`sHeight`) → not blocked, direction IRRELEVANT (so not lit, but the ray goes on); same tile →
   the same.
3. `dir = atan8(src, dst)`; a roof sprite stops here.
4. `cost = gubWorldMovementCosts[dst][dir][0]`, the current movement cost table.
5. `cost == WALL` with a `WALLNWINDOW` on the window tile (`dst` for N/W steps, else `src`) and a struct node there →
   diagonal: blocked, nothing; else open (windows let light through). ja2-node skips the struct-node test: all 1,853
   window structures of the 260 original maps are single-tile and carry their own node.
6. `cost == WALL` → blocked; N/W: lights oriented walls only; other directions: nothing.
7. A door cost goes through `DoorTravelCost(NULL, dst, cost, TRUE, &doorGridNo)` with the **perceived** door state
   (`PathAI.cc:2408`, `GetDoorState` `:2654`): an open-door cost whose door tile is not `src` → blocked, oriented
   blocks only (and nothing for steps other than N/W), lit at the door's base tile; a closed door → the same; otherwise
   the replaced cost continues.
8. `cost == OBSTACLE` → blocked if some structure on `dst` is not PASSABLE, a door, wall stuff or a tree, is not on a
   roof, has a **cached** `ubStructureHeight ≥ 3`, and has at least 8 profile columns that are exactly 3 or 4 boxes high
   (`MIN_BOX_COLUMNS`).
9. `cost == CAVEWALL` → blocked.

Only land lighting matters for gameplay, so ja2-node keeps per filter just the direction and the blocked, nothing and
oriented-only bits; the struct-node lighting (wall orientations, wall decals, cliff hangs, the door base detour) is
render-only.

**The structure height cache.** `StructureHeight()` (`TileEngine/Structure.cc:974`) computes a structure's height once
and caches it in `ubStructureHeight`; the light filter reads the field directly, so an obstacle that nobody has asked
the height of yet does not block light. Callers that fill the cache: sandbag movement costs (`WorldDef.cc:542`), items
put into openable structures (`Handle_Items.cc:1514`), `GetTallestStructureHeight` (FOV, target heights),
`GetBlockingStructureInfo` (explosions, FOV), LOS and bullets near the ends of a shot, jumpable sandbags. At a fresh
sector load only sandbags and containers holding items have it. ja2-node mirrors the cache on `StructureInstance`
(`cachedHeight`, filled by `structureHeight()` at the matching call sites).

## 4. When lights are drawn

- **Map load** (`LoadWorldFromSGPFile`): `LightReset` (`WorldDef.cc:2039`), ambient from the map (underground) or
  `GetTimeOfDayAmbientLightLevel()` (`:2338-2352`), `LoadMapLights` (`:2911`), `LightSetBaseLevel` (`:2361`), and
  `LightSpriteRenderAll` again in `InitLoadedWorld` (`:1658`) after the movement costs are compiled. Map items are loaded
  before the lights, so their height-cache entries count.
- **Light time at load** (`LoadMapLights`, `ExtractLightSprite`): night lights are powered when the hour is ≥ 21 or < 7,
  prime-time lights when it is ≥ 21, unflagged lights always, nothing in caves. This is the only place the clock powers
  lights directly; later the strategic events `TURN_ON/OFF_NIGHT_LIGHTS` (21:00, 07:00) and `TURN_ON/OFF_PRIME_LIGHTS`
  (21:00, 00:00) only flip ON (`Environment.cc:412-463`), and the change shows at the next render.
- **Cave lights.** In caves a map light is switched on and drawn when sight first reaches its tile:
  `RemoveFogFromGridNo` (`TileEngine/Fog_Of_War.cc:10`), called from `RevealRoofsAndItems` (`Tactical/FOV.cc:633`,
  ground level, for a tile in a room or without a roof) and `SetGridNoRevealedFlag` (`TileEngine/Render_Fun.cc:97`),
  powers the first unpowered sprite on that tile and calls `LightDraw`. ja2-node does not port it (§8).
- **Ambient changes**: `EnvironmentController` (`Environment.cc:122`, every game-screen pass) calls `LightSetBaseLevel`
  (`:212`) when `gfDoLighting` is set: `EVENT_CHANGELIGHTVAL` (dawn 06:47–07:03, dusk 20:57–21:13, every 2 minutes),
  temperature events and a loaded clock. `LightSetBaseLevel` resets the natural level and renders everything.
- **Savegame load**: the clock is loaded before the world, so the saved hour powers the map lights; above ground
  `LightSetBaseLevel(GetTimeOfDayAmbientLightLevel())` runs at the end (`SaveLoadGame.cc:1044`).
- **Not on structure changes.** `UpdateLightSpritesOnStructureChange` is declared (`Lighting.h:126`) but never defined
  or called. A door that opens or a wall that a grenade destroys changes nothing until the next render; an erase uses the
  filters stored at draw time.
- **Dynamic sprites** draw and erase with the world as it is at that moment:
  - explosions: `L-R04.LHT` at `(sX / 10, sY / 10)` when the ambient is ≥ 9 (`MIN_AMB_LEVEL_FOR_MERC_LIGHTS`,
    `Explosion_Control.cc:219`); destroyed with the explosion animation (`RemoveExplosionData`, `:247`), before the
    attack-busy release and its sight check;
  - muzzle flashes: opcode 441 (`Soldier_Ani.cc:447`) puts `L-R03.LHT` on the tile in front of a shooter the player can
    see (`bVisible != -1`) when the ambient is ≥ 9; each later frame code counts (`:154`) and the light goes after two
    more frames; a burst that stops (448) and death (`HandleSoldierDeath`) put it out early;
  - light effects (break lights, trip flares): `Light{radius}` (`LightEffects.cc:48`), rebuilt on every decay step;
  - merc lights: fake, see §1.

## 5. Consumers

| Original | Reads | ja2-node |
|---|---|---|
| `DistanceVisible` (`Tactical/OppList.cc:957`) | true level of the target tile, then sun goggles below 3, night/UV goggles, bloodcats, robots and NIGHTOPS above 8 | `perception/sight.ts` `distanceVisible` |
| `RevealRoofsAndItems` (`Tactical/FOV.cc:254`) | true level of the merc's tile | `perception/fov.ts` |
| `DecideHearing` (`OppList.cc:1093`) | ambient | `perception/noise.ts` |
| `CalcInterruptDuelPts` (`Tactical/TeamTurns.cc:1241`) | NIGHTOPS +1 per trait when the soldier's tile is darker than 6 | `perception/duel.ts` |
| `CalcChanceToHitGun` (`Tactical/Weapons.cc:2246`), `CalcThrownChanceToHit` (`:3659`) | sun goggles shorten the range by 10% when the target tile is brighter than day | `combat/chance.ts`, `explosions/throwing.ts` |
| `InLightAtNight` (`TacticalAI/AIUtils.cc:1580`) | above ground, ambient ≥ 5, outside rooms: true level below the ambient | `ai/cover.ts` |
| `FindNearbyDarkerSpot` (`TacticalAI/FindLocations.cc:1351`) | sighting-percent difference > 1, cost × 2 − difference | `ai/cover.ts` |
| `FindBestNearbyCover` (`FindLocations.cc:895-910`) | at night, outdoor cover reduced by the sighting-percent gain (`UINT8`) | `ai/cover.ts` |
| `EstimateThrowDamage` (`TacticalAI/Attacks.cc:1427`) | break light worth `5 × (true level at the opponent − 3)` | `ai/attack-choice.ts` |
| `BuildAIExposedTileMap` (`Tactical/PathAI.cc:134`) | lit tiles in a merc's view | not ported: `avoid_light_tiles_at_night` is off by default |

## 6. ja2-node

- `lighting/templates.ts`: generation, shipped normalisation, name lookup (case-insensitive, cached).
- `lighting/lighting.ts`: `LightingState` on `TacticalState.lighting` (ambient, natural, underground, caves, per-tile land
  and roof sums, 256 sprite slots), `lightTrueLevel`, the sprite API, `lightSetBaseLevel`, `lightSpriteRenderAll`,
  `loadMapLights`/`initLighting` (light time from an hour), the four schedule switches for the strategic clock.
- `lighting/muzzle-flash.ts`: opcode 441, the frame count and the early put-outs.
- Explosions own an `L-R04` sprite (`explosions/explosion.ts`). Light effects (`explosions/light.ts`: `newLightEffect`
  when a break light or flare lands, `decayLightEffects` at the end of a turn) own a `Light{radius}` sprite rebuilt on
  every decay step.
- Sessions: `TacticalSim` initialises lighting from the map (the sandbox is 12:00 with ambient 3 above ground, the map's
  own ambient underground); the sandbox (`src/server/sandbox.ts`) and a campaign sector load
  (`src/sim/campaign/sector-flow.ts`) render again after loading the map items, as `InitLoadedWorld` does. A savegame
  reloads the map lights with the saved hour and renders after the import with `gubEnvLightValue` above ground or the
  map's ambient underground (`src/sim/tactical/save-import.ts`).
- Campaigns dispatch `EVENT_CHANGELIGHTVAL`, the temperature events and the four light events to the loaded sector
  (`campaign-sim.ts`; `changeLightValue` and `timeOfDayAmbientLightLevel` with `HOT_DAY_LIGHTLEVEL` 2,
  `src/sim/strategic/time/environment.ts`).
- The view carries the ambient level and the powered sprites (`lightView`; dynamic ones marked `dynamic`); the browser
  shades the world with these functions (`05`).
- Stub maps carry night lights (`light:` lines in `stubs/maps/*.map.txt`).

## 7. Verification

`tools/oracle` probes `lights [level=0]` (all 25,600 true levels), `light g= viewer=` and, for bare map loads,
`sector … hour=<h>` plus `ambient level=<n>` (`tools/oracle/README.md`).

- The reference saves (`save-probes.ts`): light dumps of both levels with the sprite lists, and `light … viewer=`.
- Every original map with lights (`map-light-probes.ts`, at 22:00, 03:00 and 12:00, ambient 15 after load). The
  harness copies the oracle's structure height cache (`structureHeights` in the `sector` line), because whether map
  items in containers exist is a `PreRandom` roll that the two processes make differently.

Not verified against the oracle: explosion, muzzle-flash and light-effect lights (they exist only while an animation
or effect lasts) and the light-dependent AI decisions; they are covered by unit tests.

## 8. Gaps

- Muzzle flashes do not count as daylight in `DistanceVisible` (`gaps`, "Vision and hearing modifiers").
- An imported save starts from its `gubEnvLightValue` without the hot-desert rule until the next light event; the
  sandbox stays at 12:00, ambient 3 (`deviations`, "Ambient light and light schedule").
- Cave lights are not switched on by sight (§4): they stay off.
- Fake merc lights (§1) are not simulated; they cancel out of the true level. The browser draws them (`05`).
- `BuildAIExposedTileMap` is not ported (§5).
