# 20 — Lighting

Light in the tactical simulation: light templates, light sprites and their ray casting, the true light level gameplay
reads, and when lights are drawn. Levels are shades, lower is brighter: 1 is the brightest, 15 the darkest, day is 3
and night 12. Siblings: `05` the renderer's shading, which the client computes with these functions; `06` a soldier's
shade; `08` vision, which reads the true level; `13` the AI's use of light; `12` the explosions and flares that own
light sprites; `15` the ambient level by time of day. Each module's `@src` header names the Stracciatella functions it
ports; read those for the template generator, the blocking rules and the ray walk.

The walk is v0.22.1's, which is vanilla's (`TileEngine/Lighting.cc:304-442`, `:570-836`, `:1498-1573`), with
v0.22.1's one difference in its input: an open door's swing tile keeps the door code and lets light through (`01`
§3.10 "Open door's swing tile", #118 row 11).

## 1. The path of a light

Paths are under `src/sim/tactical/` unless they start with `src/`.

```
content load: loadLightTemplates, the user's .LHT files           load-content.ts, src/content/formats/lht.ts
map load: initLighting                                            lighting/lighting.ts, tactical-sim.ts
  loadMapLights: one sprite per map light, powered by the hour
  lightSetBaseLevel(ambient): natural level, every light drawn again
  map items placed → lightSpriteRenderAll                         src/server/sandbox.ts, src/sim/campaign/sector-flow.ts
  sector diff or save changes applied → initLoadedWorld           src/sim/campaign/sector-flow.ts, save-import.ts
a sprite: lightSpriteCreate(template) → power → position          lighting/lighting.ts
  walkLight: the rays from the centre, lightTileBlocked per step, the nodes the step lights
  move or destroy: the same walk over the structures standing now, light subtracted
the clock: dawn and dusk steps, temperature, light switches       src/sim/campaign/campaign-sim.ts
  → setAmbientLight (everything drawn again) or power only        tactical-sim.ts
gameplay: lightTrueLevel(g, level)                                perception/, combat/, explosions/, ai/
```

| Module | Holds |
|---|---|
| `src/content/world/light-templates.ts` | The names the game asks for, `LightCreateOmni` with its backlit rays, the editor's map light rule |
| `lighting/lighting.ts` | `LightingState` (ambient and natural level, land and roof sums and strongest lights per tile, 256 sprite slots), `lightTileBlocked` and `lightTileHasWall`, the ray walk and the nodes a step lights, the sprite API, map lights and their schedule, `lightTrueLevel`, `lightShadeLevel`, the light scaling of vision |
| `lighting/muzzle-flash.ts` | The light of a muzzle flash: opcode 441, its count over the script codes, the put-out |
| `explosions/explosion.ts`, `explosions/light.ts` | The light of an explosion; flares and break lights (`12`) |
| `src/content/formats/lht.ts`, `load-content.ts` | The `.LHT` layout (`TileEngine/Lighting.cc:1773`) and the templates of `TacticalContent.lightTemplates` |
| `stubs/lights.ts` | The stub pack's templates (`32`) |
| `save-import.ts` | Map lights for the saved hour, then the saved ambient level |
| `src/sim/knowledge/tactical.ts` | The agent's projection, lit from the view's `light` (`lightView`) |
| `src/app/world/light-templates.ts` | The client's templates: the same files, read from the VFS listing, the stub pack's where the data has none |
| `src/app/world/world-lighting.ts` | The client's shade field: the same walk (`traceLitTiles`, which reports the kinds of node each step lights) over the map lights the view reports powered (those the hour powers when a view has no `light`), the view's dynamic lights and our mercs' lights, across the map's structures with the view's `tileChanges` applied; the strongest light per tile of each kind of node (ground, struct nodes, objects, mercs, animation tiles, roofs) and a shade from each (`05`); the roof light of each merc's light, which the roof marker adds and erases as its own node's (`src/app/world/roof-marker-shades.ts`) |
| `src/render/world/structure-shades.ts` | Which struct nodes take the struct nodes' light: every one but a cliff hang |

## 2. Design

**Gameplay reads one number per tile and level.** The original lights every level node of a tile and keeps a sum, a
maximum and a fake share per node, but gameplay reads only `LightTrueLevel` (`TileEngine/Lighting.cc:489`): the
natural level minus the non-fake sum of the head land node (the head roof node at the roof level), clamped to 1…15, or
the raw ambient level on a tile without that node. The one exception is the fade of a soldier who drops out of sight,
which starts from the land node's display shade, the natural level minus its strongest light (`06`). ja2-node keeps one
land and one roof sum per tile and the strongest light of each, with the original's rules for adding and erasing
(`lightShadeLevel`); nothing of the walk is stored with a sprite.

**What a step lights.** Each step of a ray asks `lightTileBlocked` whether it may enter its tile: a higher tile blocks,
a tile holding a window never does, otherwise a wall or a perceived closed door on the crossing does
(`TileEngine/Lighting.cc:304-394`). A blocked step still lights the struct nodes of its tile when it crosses a wall or
door, then the rest of its ray is skipped; an open step lights the tile's struct nodes, objects and mercs, and its
ground unless it crossed a wall into a window's tile; in caves every struct node and, on an open step, the ground
(`:570-699`). Every struct node but a cliff hang takes the step's light, whatever its orientation (`LightIlluminateWall`
answers yes, `:1470`), and an animation tile of the struct layer, such as a corpse, takes every step that reaches its
tile, a blocked one too (`:636-639`). A merc node takes 7/10 of a step on a ray that ends south-east of the light
(`LIGHT_BACKLIGHT`, `:666`, set by `LightCastRay`, `:969`). Each template node is lit once per draw, by the first ray
that reaches it (`:1542-1551`). The simulation keeps only the ground and the roof; `traceLitTiles` reports the other
kinds for the client.

**The client lights each node by what reaches it.** The client keeps the strongest light of each kind of node per tile
and gives each node the shade of its kind: the ground, the struct nodes (walls, doors, decals and items alike), the
objects, the mercs (a soldier on the ground takes theirs, one on a roof the roof's), the corpses and the roofs. Every
node is drawn afresh from the lights standing now, without the history of when each was drawn (deviation "Light on
structures").

**No fake lights.** A merc's own light at night is added to both the sum and the fake share and cancels out of the
true level, so the simulation does not create it; the client draws it. The display shade it would brighten reaches
gameplay only through the soldier fade (deviation "Soldier fade without merc lights"). Only merc lights ever light
roofs: map lights lose `LIGHT_SPR_ONROOF` on load, explosions and flares never set it.

**Templates are the user's files.** v0.22.1 loads a template by the name a map light or the code asks for, case aside,
from the game data (`TileEngine/Lighting.cc:1773-1806`): the map lights' `L-R01.LHT` … `L-R08.LHT` and `L-R01I2.LHT`,
and `Light0` … `Light6` without an extension, which the flares, break lights (`TileEngine/LightEffects.cc:51`) and merc
lights (`Tactical/Soldier_Control.cc:701-703`) ask for. Every ray of the file counts, the repeats of a tile and the
`LIGHT_BACKLIGHT` bits included. ja2-node reads those names when the content loads (`loadLightTemplates`), the
original's first and the stub pack's second; a name the data lacks gives no sprite, as in v0.22.1. The files are
`LightCreateOmni` output, and the generator reproduces each of them; the stub pack writes its own with it (`32`).
`TRANSLUC.LHT` would drive only wall translucency, which has no effect in Stracciatella: `CalcTranslucentWalls` is
commented out (`Tactical/Overhead.cc:2105`).

**Lights change only when drawn.** A sprite adds its light when placed and subtracts it when moved or destroyed, both
walks over the structures standing at that moment; `lightSetBaseLevel` and `lightSpriteRenderAll` draw every powered
sprite again. Switching power shows at the next render, and a door that opens or a wall a grenade destroys changes no
light until then (`UpdateLightSpritesOnStructureChange` is declared but never defined). A sector entry and a native
load draw them once the sector's map changes, doors and revealed tiles are back (`initLoadedWorld`,
`Tactical/Tactical_Save.cc:507`), so a door left open or a wall destroyed shows in the light at the next entry; a
meanwhile scene returns before that render and keeps the lights its map load drew (`Tactical/Tactical_Save.cc:454`).
The client keeps the rule for structures: a change in the view's `tileChanges` redraws nothing; the map lights pass
where a destroyed structure stood once the hour, the ambient level, the open doors or the powered map lights make it
draw them again, our mercs' and the dynamic lights once one of them moves. A snapshot older than version 107 holds sums
an earlier walk drew: its migration drops them and the restore draws every powered light again.

**The clock powers map lights once.** At a map load the hour decides which scheduled lights are on: night lights from
21:00 to 7:00, prime-time lights from 21:00 to midnight, none in caves. Afterwards only the strategic light events
and, in caves, sight switch them, and the dawn and dusk steps and the temperature events change the ambient level. A
savegame loads its clock before the world, so the saved hour powers the map lights. The sandbox stays at 12:00
(deviation "Ambient light and light schedule").

**Sight lights the caves.** A cave map's lights load switched off (`TileEngine/LoadSaveLightSprite.cc:40`). Revealing
a cave tile switches on the first unlit light sprite standing on it and draws it at once (`switchOnCaveLightAt`,
`TileEngine/Fog_Of_War.cc:10`): the fog of war's look (`perception/fov.ts`, `Tactical/FOV.cc:697`, `08`), the reveal
of a room, and the load of a sector's revealed tiles (`TileEngine/Render_Fun.cc:97`), at a re-entry
(`restoreRevealed`, `src/sim/campaign/sector-diff.ts`) and in a native import (`save-import.ts`). The original keeps
no power state in a save or temp file: the revealed tiles switch the lights on again at every load, one per tile
(`TileEngine/SaveLoadMap.cc:467`). ja2-node's own saves keep the sprites as they are. The light counts for every later
look and shot; within the look that switched it on only the range, taken at the start, could read light. The client
lights the powered map lights the view reports, so a cave light shows as soon as the simulation switches it on.

**Underground, the time of day comes through a port.** A cave or basement keeps the ambient level its map sets, so
`lighting.ambient` says nothing about the hour there; the AI's night check reads the world's level through
`TacticalState.timeOfDayLight`, which the sector flow installs over the campaign environment (`timeOfDayAmbientLevel`).
The sandbox has no world light and never counts as night underground.

**What the player sees makes light.** A muzzle flash lights the tile in front of the shooter only when the player can
see him, and flashes and explosions make light only at an ambient level of 9 or darker. That light counts for every
soldier's vision.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `lighting/` unless the row names another file:

| Quirk | Test |
|---|---|
| A window passes light only on a step into its own tile; a step out of it across its wall is blocked, so a lamp inside lights no tile outside a south or east window (D13's church) | `lighting.test.ts`, `src/app/world/world-lighting.test.ts` |
| A step across a wall into a window's tile lights its struct nodes, objects and mercs but not its ground | `lighting.test.ts`, `src/app/world/world-lighting.test.ts` |
| A template node is lit once, by the first ray that reaches it, even a blocked ray that lit only its walls | `lighting.test.ts` |
| A step onto a higher tile ends its ray and lights nothing there, unless it crossed a wall | `lighting.test.ts` |
| The erase walks the structures standing now, so a wall that appears after the draw leaves the light that passed it on the tiles behind until the next render | `lighting.test.ts` |
| A burst's muzzle flash goes out within the animation step that draws each round's first frame: the count runs over every script code, so no round is lit when its shot is fired | `effects.test.ts` |
| A wall that appears changes no light until the next render | `lighting.test.ts` |
| Switching scheduled lights shows only at the next render | `lighting.test.ts` |
| Sight switches on one unlit light of a cave tile per reveal and draws it at once, without marking it for erase | `lighting.test.ts` |
| At the roof level map lights never count, and a tile without a roof returns the raw ambient level, unclamped | `lighting.test.ts` |
| A light going out cuts a tile's strongest light to the light left, even when no light left is that strong, until the next render | `lighting.test.ts` |
| A muzzle flash lights the tile in front of the shooter, only when the player sees him | `effects.test.ts` |
| A cave map older than minor version 25 is lit at 13, not at the level it stores (`UpdateOldVersionMap`, `Tactical/Map_Information.cc:195`); of the shipped maps only P1_B2, which the campaign never loads | `src/content/world/map-version.test.ts`, `src/sim/tactical/map-version-original.test.ts` |

Not pinned yet:
- A tile's light sum is a byte that wraps on addition but stops at 0 on subtraction.
- Moving a switched-off light erases it once more each time: the erase does not clear `LIGHT_SPR_ERASE`. ja2-node
  never moves a placed sprite.
- A map light flagged both prime-time and night keeps only the prime-time schedule.
- Light passes doors as the player perceives them, not as they are (`perceivedDoorTravelCost`; the perceived state: `35`).
- A muzzle flash that opcode 441 replaces before it went out is never destroyed and stays lit
  (`Tactical/Soldier_Ani.cc:456`); the original's scripts run at least three codes between two flashes, so no shot
  reaches it.

## 4. Not checked against the native build

The oracle's `lights` probe dumps the true level of every tile with the light sprites, and `light` adds
`DistanceVisible` for a viewer (`tools/oracle/README.md`). The recordings from v0.22.1 run them on the reference saves,
both levels, and on four sector entries after a native load; all match. The sweep over every original map with lights
at 22:00, 03:00 and 12:00 ("Lights") is recorded only from master, not from v0.22.1. Inferred from reading the source:
- Explosion, muzzle-flash and flare lights last only while an animation or effect does, and no probe catches them;
  unit tests cover them. The AI's light-dependent decisions are not probed either.
- No probe drives sight in a cave, so the cave lights it switches on are pinned only by unit tests and a data test on
  D13's creature lair (`perception/fog-original.test.ts`).
- The window rule skips the original's test for a struct node on the window tile: all 1,853 window structures of the
  260 original maps are single-tile and carry their own node. For the same reason a step across a wall into a window's
  tile always finds a struct node there, which is what keeps its ground dark.
- No probe reads a node other than the head land and roof nodes, so the client's struct, object and merc shades rest on
  reading the source and the unit tests.

Deviations of this domain: "Light on structures", "Ambient light and light schedule", "Doors and light in the
projection", "World clock for smoke and light", "Soldier fade without merc lights", "Merc light in a vehicle".
