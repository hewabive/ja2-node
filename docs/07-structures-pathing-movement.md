# Structures, movement costs, pathfinding and walking

Paths are relative to `reference/stracciatella/src/game/` (Stracciatella `ae6bf01`; "vanilla:" =
`reference/vanilla/ja2/Build/`). "(computed)" marks numbers from scratch scripts over the JA2 Gold data, **(inferred)**
conclusions not traced end to end in the code; everything else was read in the code.

Companion to [`01-architecture.md`](01-architecture.md) §2 (step protocol overview) and
[`01-architecture.md`](01-architecture.md) §1 (AP costs). Scope: structure instances and their collision rules,
the movement cost table, `FindBestPath`, AP/BP of moves, and the walking protocol in real time (RT) and turn-based (TB)
mode. The ja2-node modules are listed in §7.

Grid conventions used throughout: `gridNo = y*160 + x`; NORTH is `y−1` (`DirIncrementer`, `TileEngine/Isometric_Utils.h:30-40`);
directions `N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7` (`Tactical/Overhead_Types.h:215-228`); "odd" direction = diagonal.
`(dx,dy)` offsets: `+1` = east neighbour (`gridNo+1`), `+160` = south neighbour.

---

## 1. Structures in the world

### 1.1 Data model

**DB level** (one per JSD structure number, shared by every instance; `TileEngine/Structure_Internals.h:132-174`):
`DB_STRUCTURE {ubArmour, ubHitPoints, ubDensity, ubNumberOfTiles, fFlags, usStructureNumber, ubWallOrientation,
bDestructionPartner, bPartnerDelta, bZTileOffsetX/Y}` plus `ubNumberOfTiles` × `DB_STRUCTURE_TILE {sPosRelToBase,
bX/bYPosRelToBase, Shape[5][5] (4 height bits per column), fFlags (TILE_ON_ROOF=1, TILE_PASSABLE=2), ubVehicleHitLocation}`.
Loading (`TileEngine/Structure.cc:311-377`, mirrored by `src/content/formats/jsd.ts`):
- `sPosRelToBase = bX + bY*160` (`:350`), then `NormalizeStructureTiles` makes the tile closest to 0 the base (`:273-309`).
- Contiguous wall orientations 3/4 become `ORIENT_OUTSIDE_LEFT/RIGHT`, only when the file has aux data (`:357-371`).
- `ubHitPoints` from the file is **replaced** by `filledCubes*100/255`, stored as **UINT8** (`:351, 374-375`): it wraps
  above 650 filled cubes (`jsd.ts` keeps `& 0xFF`).

**Instance level** (`STRUCTURE`, one per covered tile; `Structure_Internals.h:176-191`), built by `CreateStructureFromDB`
(`Structure.cc:399-442`) and `AddStructureToWorld` (`:675-810`):

| Field | Value |
|---|---|
| `fFlags` | DB flags, then: if `SLIDINGDOOR` and 2 tiles → replace `SLIDINGDOOR` by `GARAGEDOOR`, else clear bit `0x8` (old `STRUCTURE_HIDDEN`) (`:406-417`). `BASE_TILE` if `sPosRelToBase == 0` (`:425-429`). `PASSABLE` if the tile has `TILE_PASSABLE` (`:740`). Soldier nodes: `+PERSON`, `−BLOCKSMOVES` (`:741-746`). Corpse nodes/flag: `+CORPSE`, and `+PASSABLE −BLOCKSMOVES` if < 10 tiles, else `−TRANSPARENT` (`:747-761`). |
| `sGridNo` | `base + sPosRelToBase` (`:724`) |
| `sBaseGridNo` | set for non-base tiles only; the base keeps 0 **(inferred: zero-init; a few callers read it on base tiles, e.g. `Explosion_Control.cc:1571`)** |
| `sCubeOffset` | `(TILE_ON_ROOF ? level+1 : level) * 4`, i.e. 0 = ground, 4 = roof level (`:738-739`; constants `Structure_Internals.h:43-46`) |
| `ubHitPoints` | DB hit points on the base tile only (`:428`) |
| `ubWallOrientation` | DB orientation, except non-base tiles of `WALL` structures get `ORIENT_NONE` (`:430-440`) |
| `usStructureID` | soldier: `ubID`; corpse: `TOTAL_SOLDIERS + id`; otherwise a global counter starting at `INVALID_STRUCTURE_ID+2` (`:764-784`, `:60-62`, `Structure.h:32-33`) |
| `pShape`, `pDBStructureRef` | pointers to the DB tile/structure |

Each map tile keeps a doubly linked structure list; `AddStructureToTile` **appends** (`:661-669`) and sets
`MAPELEMENT_INTERACTIVETILE` for `OPENABLE`. Order therefore equals global add order (§1.2); it matters for
`FindStructure` (first match) and for the `FORCE_SET` costs (§2.4).

Flags that matter here (`Structure_Internals.h:70-126`): `OPEN 0x2, OPENABLE 0x4, GARAGEDOOR 0x8, MOBILE 0x10,
PASSABLE 0x20, GENERIC 0x100, TREE 0x200, FENCE 0x400, WIREFENCE 0x800, SPECIAL 0x2000, VEHICLE 0x8000, WALL 0x10000,
WALLNWINDOW 0x20000, SLIDINGDOOR 0x40000, DOOR 0x80000, CAVEWALL 0x200000, DDOOR_LEFT 0x400000, DDOOR_RIGHT 0x800000,
NORMAL_ROOF 0x1000000, SLANTED_ROOF 0x2000000, CORPSE 0x40000000, PERSON 0x80000000`; combos `ANYDOOR 0x00CC0008,
OBSTACLE 0x00008F00, WALLSTUFF 0x00CF0008, BLOCKSMOVES 0x00208F00, ROOF 0x07000000`. Orientation (`TileDef.h:38-51`):
`INSIDE_LEFT 1, INSIDE_RIGHT 2, OUTSIDE_LEFT 4, OUTSIDE_RIGHT 8, ORIENT_LEFT = 5, ORIENT_RIGHT = 10`.

### 1.2 Where structures come from at map load

`LoadWorldFromSGPFile` adds layers in this order, each over all gridnos ascending (`TileEngine/WorldDef.cc:2121-2296`):
land (head-insert, no structures), objects (no structures), **structs** (`AddStructToTail` → `AddNodeToWorld(level 0)`),
shadows (none), **roofs** (`AddRoofToTail` → level 1), **on-roof** (`AddOnRoofToTail` → level 1)
(`TileEngine/WorldMan.cc:519-533, 579-583, 1166-1184, 1282-1300`).

`AddNodeToWorld` creates the LEVELNODE, and if the tile has a DB structure calls `AddStructureToWorld`; on failure it
**deletes the node and throws `FailedToAddNode`** (`WorldMan.cc:519-533`). Only the struct-layer loop catches it
(`WorldDef.cc:2221-2228`, "defective maps with overlapping objects"), so **a struct whose structure is rejected loses its
graphic too** (no node, no buddy shadow). A failure on the roof/on-roof layers would propagate out of the loader
(**(inferred)**: never happens in shipped data). ja2-node's `placeWorldStructures` (`src/content/world/placement.ts`)
drops rejected struct nodes from the struct layer the renderer draws and throws on a roof/on-roof rejection.

(computed) The static rules of §1.3 over all 261 maps of JA2 Gold: 6 maps (F6 4, G16 30, H15 22, J4 24, K13 1, K5 10)
reject 91 struct nodes, all "obstacle vs obstacle" (mostly overlapping `FIRSTFULLSTRUCT` trees); A9 rejects none.

After the layers: `InitLoadedWorld` → `CompileWorldMovementCosts` (`WorldDef.cc:1644-1668`, again at `:2441` when
edgepoints are generated), and `SetBlueFlagFlags` marks `BLUEFLAG_GRAPHIC` tiles `MAPELEMENT_PLAYER_MINE_PRESENT`
(`:1630-1641`). Soldiers and corpses are added later with their own person/corpse structures.

### 1.3 `AddStructureToWorld` and the collision rules

```
AddStructureToWorld(base, level, dbRef, node):                       // Structure.cc:675-810
  if !OkayToAddStructureToWorld(base, level, dbRef, INVALID_STRUCTURE_ID): return null
  create one STRUCTURE per DB tile (§1.1); assign ID; append each to its tile (height check again, :791-803)
  node.pStructureData = base STRUCTURE

InternalOkayToAddStructureToWorld(base, level, dbRef, exclID, ignorePeople):   // :623-652
  for each DB tile i:
    cube = !(tile.flags & TILE_ON_ROOF) ? level*4 : (level == 0 ? 4 : return FALSE)
    if !OkayToAddStructureToTile(base, cube, dbRef, i, exclID, ignorePeople): return FALSE
  return TRUE
OkayToAddStructureToWorld(...) = Internal...(..., ignorePeople = exclID == IGNORE_PEOPLE_STRUCTURE_ID)   // :655-658
```

`OkayToAddStructureToTile(base, cube, new, i, excl, ignorePeople)` (`:445-620`), `g = base + tile[i].sPosRelToBase`:
1. `g` outside `[0, WORLD_MAX)` → FALSE (`:449`). `height[base] != height[g]` → FALSE (`:451-455`).
2. For each existing structure `e` in `g` **with `e.sCubeOffset == cube`** (others never collide, `:460`):
   1. new `MOBILE` and `e` `PASSABLE` → skip `e` (`:464`).
   2. If new has any `OBSTACLE` bit (`:469-534`): skip `e` if `e.ID == excl` (excl valid) or (`ignorePeople` and `e.ID <
      TOTAL_SOLDIERS`). Then:
      - `e` is `OBSTACLE` and new is not `MOBILE`: FALSE unless `e` is `PASSABLE` and not `MOBILE`.
      - else if new has > 1 tile and `e` is `WALLSTUFF` and not an open door: for `l = 1..3`, `other = NewGridNo(g,
        DirInc(l+2))` if `e.orient & ORIENT_LEFT`, `NewGridNo(g, DirInc(l))` if `& ORIENT_RIGHT`, else `g+SE`;
        if any tile of the new structure lands on `other` → FALSE ("straddles wall").
   3. Else if new has any `WALLSTUFF` bit (`:535-568`): `e` `WALLSTUFF` with **equal** orientation → FALSE; else if `e`
      is not `CORPSE|PERSON`: for `l = 1..3` compute `other` the same way from the **new** orientation; if
      `FindStructureByID(other, e.ID)` exists and is not `WALL` → FALSE. (The inner loop reuses `ubTileIndex`, so the
      check is just repeated; harmless.)
   4. If new is `MOBILE` (`:570-608`): skip `e` if excluded/ignored person (as above); FALSE if `e` `MOBILE`, not
      `PASSABLE` and the new tile is not `TILE_PASSABLE` ("2 people in one tile"); skip `e` if `e` not `MOBILE` but
      `PASSABLE`; FALSE if `e` `OBSTACLE` and the new tile is not `TILE_PASSABLE`.
   5. Both `OPENABLE` → FALSE (`:610-616`).
3. TRUE.

### 1.4 Roof level

Roof and on-roof tiles are added with `level = 1`, so their structures get `sCubeOffset = 4`. A DB tile flagged
`TILE_ON_ROOF` is rejected at level 1 (`:637-644`); struct-layer structures may have roof parts (`TILE_ON_ROOF` at level
0 → cube 4). Roof-level walkability is purely per tile (§2.4, no walls on the roof). `IsHeigherLevel(g)` =
`FindStructure(g, NORMAL_ROOF)` (`WorldMan.cc:1449-1453`).

### 1.5 Doors

- Closed and open states are **two DB structures**; the partner is `pDBStructureRef + bPartnerDelta` in the same JSD
  (`Structure.cc:883-891`). `SwapStructureForPartner` deletes the instance, re-adds the partner at the same base and level
  (`cube/4`), keeps HP, and for non-doors shifts the LEVELNODE graphic by the delta (doors animate instead)
  (`:875-923`). `HandleDoorChangeFromGridNo` swaps, then `RecompileLocalMovementCosts(gridNo)` and sets `DOOR_BUSY`
  (`Tactical/Handle_Doors.cc:42-67`).
- Door status: `DOOR_STATUS` records exist only after a door changed state (`Tactical/Keys.cc:843-905`), keyed by the
  base gridno, flagging that tile `MAPELEMENT_EXT_DOOR_STATUS_PRESENT`; `DOOR_PERCEIVED_OPEN` is what the player believes.
  On a fresh map load there are none, so pathing reads the structure flags. In ja2-node the perceived state always
  equals the real one (`gaps` "Doors").
- Strac tile-database fix for mis-flagged double doors (`TileEngine/TileDef.cc:122-149`): edits shared DB records
  (orientation, armour, DDOOR left/right); `fixDoubleDoors` in `src/content/world/tile-database.ts`.
- Map door table (`MapDef.doors`: locked, trap, lock id, lock damage, perceived lock and trap): the pathfinder consults it
  for AI keys (§3.4); door actions, locks, keys and traps are `docs/35` §5 (`src/sim/tactical/doors/`). It lives in
  `TacticalWorldData.mapDoors` (entries are replaced, never mutated) and travels with the sector diff (`doorTable`).
- Walking into a closed door calls `InteractWithOpenableStruct` (§4.5); code 495 of the open/close animations computes
  `DoorOpeningNoise`, then `HandleOpenableStruct` swaps the structure, charges the cost and, when the door changed, makes
  the creak noise and lets everyone look (`08` §2.8).

### 1.6 Structure queries used by movement and LOS

| Query | Used by |
|---|---|
| `FindStructure(g, flags)` / `FindNextStructure` (first match in list order; `Structure.cc:938-954`) | doors (`ANYDOOR`), jumpable fence (`OBSTACLE`, `Tactical/Structure_Wrap.cc:52-72`), sandbag neighbours, roofs (`ROOF`/`NORMAL_ROOF`) |
| `FindStructureByID`, `FindBaseStructure` (`:957-971`) | multi-tile delete/swap, wall checks in §1.3 |
| `StructureHeight` (1..4, cached in `ubStructureHeight`; `:974-1021`) | sandbag rule (§2.4), LOS |
| `WhoIsThere2(g, level)`: first `PERSON` structure, skipping `PASSABLE` ones not at the soldier's own gridno; level 0 ⇔ cube 0, level > 0 ⇔ cube > 0 (`WorldMan.cc:1479-1501`) | path people check, `TileIsClear`, `NewOKDestination` |
| `IsDestinationBlocked`: any non-`PASSABLE` `BLOCKSMOVES` structure with `sCubeOffset == level*4` (`Tactical/Overhead.cc:2922-2948`) | `NewOKDestination` (`:2952-3008`) |
| `OkayToAddStructureToWorld` with the soldier's animation JSD | multi-tile soldiers only (prone, vehicles, monsters); turning (`OKToAddMercToWorld`, `WorldMan.cc:1095-1121`) |
| Full list walk with `sCubeOffset` + `pShape` bits; `GetTallestStructureHeight`, `GetBlockingStructureInfo` (`Structure.cc:1023-1057, 1695`) | bullets and LOS (`Tactical/LOS.cc:835-1180, 2487-2760`), FOV |

`NewOKDestination(s, g, people, level)` (`Overhead.cc:2952-3008`): FALSE if `g` is not visible; if `people`:
`p = WhoIsThere2(g, level)` blocks when `p && (p != s || g == s.sGridNo) && (s.bTeam != OUR_TEAM || p.bVisible >= 0 ||
SHOW_ALL_MERCS)` (players are not blocked by unseen soldiers here, unlike the path people check of §3.2); multi-tile
soldiers: TRUE if their animation JSD fits in any of the 8 directions; otherwise `!IsDestinationBlocked(g, level)`.

Soldiers own a person structure built from their animation JSD for the current direction
(`AddMercStructureInfoFromAnimSurface`, `WorldMan.cc:1062-1092`), rebuilt on every direction change
(`EVENT_SetSoldierDirection`, `Tactical/Soldier_Control.cc:3959-3994`). It never contributes movement costs (no
`BLOCKSMOVES`). ja2-node keeps both: the person structure in the tile list (`addMercStructure`,
`src/sim/tactical/person-structure.ts`; multi-tile checks, LOS and FOV list order) and a per-level occupancy map
`TacticalState.occupant` that answers `WhoIsThere2` (`whoIsThere`, `state.ts`).

---

## 2. Movement costs

### 2.1 Table and compile model

`gubWorldMovementCosts[WORLD_MAX][8][2]` (`WorldDef.cc:98`): **cost of entering gridno `g` while moving in direction `d`
on level `l`** (FindBestPath reads `[newLoc][dir][level]`, `Tactical/PathAI.cc:1058`).
- `SET(g,d,l,v)`: `if table < v then table = v` (raise only). `FORCE(g,d,l,v)`: assign (`WorldDef.cc:67-69`).
- `CompileWorldMovementCosts`: zero the whole table, `CompileWorldTerrainIDs`, then `CompileTileMovementCosts(g)` for
  `g = 0..WORLD_MAX−1` **in ascending order** (`:1264-1281`). Tiles set costs on neighbours, so order and SET/FORCE
  semantics are part of the behaviour (see the fence quirk in §2.4).
- Local recompiles (`:1088-1259`): `RecompileLocalMovementCostsFromRadius(c, r)` zeroes `x∈[cx−r, cx+r)`,
  `y∈[cy−r, cy+r)` then compiles `[cx−r−1, cx+r+1)` in row-major order (asymmetric half-open ranges; radius 0 =
  one tile). `RecompileLocalMovementCosts` uses r = 4. Doors call it after a swap.

### 2.2 Cost values (`Tactical/PathAI.h:74-131`)

| Value | Name | Notes |
|---|---|---|
| 0 | NONE | far side of a jumped fence |
| 9 | DIRTROAD = PAVEDROAD | |
| 10 | FLAT = FLATFLOOR | |
| 12 | GRASS = BUMPY | no terrain produces it |
| 16 / 20 | THICK / DEBRIS | no terrain produces them |
| 30 | SHORE = TRAINTRACKS | all water terrains map here |
| 36 / 50 | KNEEDEEP / DEEPWATER | never produced (so `ISWATER`/water-to-water logic is dead) |
| 40 | FENCE | jump |
| 212–222 | door "obstacle if (one/two) door(s) closed" codes | `IS_TRAVELCOST_CLOSED_DOOR` |
| 223–237 | door "obstacle if door open" codes | `IS_TRAVELCOST_OPEN_DOOR` |
| 248 | NOT_STANDING | open (cut) wire fence; pathing uses terrain, AP +2 for walk/run |
| 249 | OFF_MAP (= `TRAVELCOST_BLOCKED`) | everything ≥ 249 is impassable |
| 250 / 251 / 252 / 253 / 254 / 255 | CAVEWALL / HIDDENOBSTACLE (unused in Strac) / DOOR / OBSTACLE / WALL / EXITGRID | |

### 2.3 Terrain

Terrain enum (`TileEngine/TileDef.h:61-75`): `NO_TERRAIN 0, FLAT_GROUND 1, FLAT_FLOOR 2, PAVED_ROAD 3, DIRT_ROAD 4,
LOW_GRASS 5, HIGH_GRASS 6, TRAIN_TRACKS 7, LOW_WATER 8, MED_WATER 9, DEEP_WATER 10`.
`gTileTypeMovementCost = [10, 10, 10, 9, 9, 10, 10, 30, 30, 30, 30]` (`TileDef.cc:27-40`).

Per tile *type*, set by the tileset's `MovementCostFnc` before the tile DB is built (`WorldDef.cc:2600-2604`;
`TileEngine/WorldDat.cc:69-206`), copied into every tile element (`TileDef.cc:85`); all other types are `NO_TERRAIN`:

| Types | One (default) | Two (CAVES_1=1) | Three (17, 19, 33, 37, 38, 45–48) | Four (4, 39) |
|---|---|---|---|---|
| FIRST..FOURTH, SEVENTHTEXTURE | FLAT_GROUND | = | = | = |
| FIFTH, SIXTHTEXTURE | LOW_GRASS | = | = | = |
| REGWATERTEXTURE / DEEPWATERTEXTURE | LOW_WATER / DEEP_WATER | = | = | = |
| FIRSTROAD, ROADPIECES (object layer) | DIRT_ROAD | DIRT_ROAD | **PAVED_ROAD** | DIRT_ROAD |
| FIRST..FOURTHFLOOR | FLAT_FLOOR | **FLAT_GROUND** | FLAT_FLOOR | FLAT_FLOOR except **SECONDFLOOR = FLAT_GROUND** |

(Tileset ids from `TileEngine/World_Tileset_Enums.h`: 17 AIRSTRIP, 19 DEAD_AIRSTRIP, 33 TEMP_14, 37 TEMP_18,
38 TEMP_19, 39 TEMP_20, 45–48 TEMP_26–29, 4 TROPICAL_1; e.g. A9 uses tileset 9 OMERTA_1 → One. ja2-node:
`surfaceTerrainTable`, `src/content/world/terrain.ts`.)

Per tile override (`TileEngine/TileDat.cc:742-749`): tile indices `REGWATERTEXTURE18..50`, `12`, `14`, `16` → FLAT_GROUND
(shore pieces). The source also compares the tile index with the *type* constant `REGWATERTEXTURE` (= 7), so tile
index 7 (`FIRSTTEXTURE8`) is included too (harmless).

`CompileWorldTerrainIDs` (`WorldDef.cc:321-364`), ascending gridno, **visible tiles only** (§2.5):
`n` = **first** object node; TEMP_19 special case (`ANOTHERDEBRIS4/6/7` → LOW_WATER, `:330-341`); if no object, index
≥ NUMBEROFTILES or its terrain is NO_TERRAIN → `n` = **first** land node (the topmost, land is head-inserted). If
`n`'s tile has > 1 tile locations, write its terrain to every `g + (offX, offY*160)`, else to `g`. Later gridnos
overwrite earlier writes. Result: `gpWorldLevelData[g].ubTerrainID` (there is no `gubWorldTerrainType` in Strac);
ja2-node's `TacticalWorld.terrain` from `compileWorldTerrainIds`.

### 2.4 `CompileTileMovementCosts(g)` (`WorldDef.cc:367-1085`)

```
if g invalid: return
if visible(g):
  for d: if height[g] != height[g+DirInc(d)]: SET(g,d,0,OBSTACLE)            // :385-392
  if exit grid at g: for d: SET(g,d,0,EXITGRID)                               // :395-402
else:
  for d: SET(g,d,0,OFF_MAP); SET(g,d,1,OFF_MAP)
  if no structures: return                                                    // non-visible tiles WITH structures continue
if g has structures:                                                          // includes person structures
  if land: for d: SET(g,d,0, terrainCost(g))
  onRoof = false
  for s in list order:
    if s.cube == 0: groundRules(s)          // below
    elif !(s.flags & (PASSABLE|NORMAL_ROOF|PERSON)): onRoof = true            // :1007-1013
  if roof layer at g: for d: SET(g,d,1, onRoof ? OBSTACLE : FLAT) else: for d: SET(g,d,1,OBSTACLE)
else:
  for d: SET(g,d,0, terrainCost(g)); for d: SET(g,d,1, roof layer ? FLAT : OBSTACLE)
```

`groundRules(s)`, first matching branch:
1. **`PASSABLE`**: only `WIREFENCE+OPEN` (cut fence) does anything: LEFT → `E,W = OBSTACLE`, other six `NOT_STANDING`;
   RIGHT → `N,S = OBSTACLE`, others `NOT_STANDING` (`:442-471`).
2. **`BLOCKSMOVES`** (`:472-577`):
   - `FENCE` and not `SPECIAL` (jumpable): ORIENT_LEFT: here `N,S = FENCE`, other six `OBSTACLE`; leaving tiles:
     `FORCE(g−160, N, 0, NONE)` if currently < 249, `FORCE(g+160, S, 0, NONE)` if < 249, and `SET OBSTACLE` on
     `g−159 NE, g+1 E, g+161 SE, g+159 SW, g−1 W, g−161 NW`. ORIENT_RIGHT: here `E,W = FENCE`; `FORCE NONE` on
     `g+1 E` and `g−1 W` (if < 249), `SET OBSTACLE` on `g−160 N, g−159 NE, g+161 SE, g+160 S, g+159 SW, g−161 NW`.
     No orientation: all 8 `OBSTACLE`.
     **Order quirk:** the neighbour with the higher gridno (`g+160` for LEFT, `g+1` for RIGHT) is compiled *later*
     and its own terrain `SET` raises the forced 0 back to 9/10. So landing **north/west** of a fence costs 0, landing
     **south/east** costs terrain. ja2-node gets this by compiling in ascending order with SET/FORCE semantics.
   - armour `MATERIAL_SANDBAG` (18) and `StructureHeight < 2`: all 8 `OBSTACLE`; then if no `OBSTACLE` structure at
     `g−160` and `g+160`: `FORCE(g, N|S, 0, FENCE)`; if none at `g−1` and `g+1`: `FORCE(g, E|W, 0, FENCE)`. No landing
     `NONE`.
   - `CAVEWALL`: all 8 `CAVEWALL`. Else: all 8 `OBSTACLE`.
3. **`ANYDOOR`** (`:578-969`). Each case writes the door frame cost and the swing area of the open panel. Codes mean
   (`PathAI.cc:2531-2652`): `DOOR_CLOSED_HERE / _N / _W` = blocked iff the door at `g` / `g−160` / `g−1` is closed;
   `DOORS_CLOSED_X_Y` (212–219, Strac double-door diagonals) = blocked iff either of two doors is closed;
   `DOOR_OPEN_HERE / _N / _NE / … / _NW_W` = blocked iff the door at the named offset (`_N_N` = two north, `_W_W` = two
   west, etc.) is open. Every door case is transcribed into `data/tables/door-costs.json`
   (`tools/transcribe/door-costs.ts`, from this `ANYDOOR` block): rules apply in order to a door structure matching
   `kind` (`STANDARD`, `DDOOR_LEFT` `:581-687`, `DDOOR_RIGHT` `:688-792`, `GARAGEDOOR` `:793-849`), `orientation`, `tile`
   (`base` = the frame, `nonBase` = the panel, `any`) and `notSliding`; each `set` entry `[dx, dy, dir, cost]` raises
   `cost[g + dx + 160·dy][dir][0]` with SET semantics. The standard door is identical in vanilla
   (`vanilla:TileEngine/WorldDef.c:913-1057`): the frame puts `DOOR_CLOSED_HERE` and `DOOR_CLOSED_N` (left) or
   `DOOR_CLOSED_W` (right) on the two moves through the door and blocks the other moves across that edge and its
   corners (`WALL` for OUTSIDE_LEFT, otherwise `OBSTACLE`; INSIDE_LEFT keeps `WALL` on its own tile); the panel of a
   non-sliding door (the OUTSIDE non-base tile, the INSIDE tile itself) puts `DOOR_OPEN_*` codes on the swing area.
   Double and garage doors are Strac rewrites of vanilla.
4. **`WALLSTUFF`** (walls and `WALLNWINDOW`; `:970-1005`): ORIENT_LEFT: here `NE,N,NW=WALL`; `(0,+1) SE,S,SW=WALL`;
   corners `(−1,0) NW, (+1,0) NE, (−1,+1) SW, (+1,+1) SE = WALL`, i.e. every move crossing the edge between rows
   `y` and `y+1` at column `x`. ORIENT_RIGHT: here `SW,W,NW=WALL`; `(+1,0) SE,E,NE=WALL`; corners `(+1,−1) NE,
   (0,−1) NW, (+1,+1) SE, (0,+1) SW = WALL` (edge between columns `x` and `x+1`). No orientation (non-base wall
   corner tiles): nothing.

All neighbour writes use raw `g ± k` (no `NewGridNo`); visible tiles never touch the array border (§2.5), and
non-visible tiles with structures may raise costs of visible neighbours. A structure on the array border would make
the original write out of bounds or into the wrapped row (**(inferred)**: no shipped map does this); ja2-node's
`MovementCosts.raise`/`force` drop writes outside `[0, WORLD_MAX)` and keep the row wrap.

### 2.5 Map edges

- `GridNoOnVisibleWorldTile` (`TileEngine/Isometric_Utils.cc:544-557`, constants `RenderWorld.cc:2114-2148`,
  `RenderWorld.h:88-95`) tests the tile's absolute screen position against the render bounds that `InitRenderParams`
  sets from the map's `ubRestrictedScrollID` when the map loads (`Map_Information.cc:98-105`, before the costs are
  compiled). It reduces, for restriction 0, to **`86 ≤ x+y ≤ 235 && |x−y| ≤ 78`** (inferred algebra, verified
  numerically: 11775 visible tiles, `4 ≤ x,y ≤ 156`); for restriction 1 (basements) to
  **`133 ≤ x+y ≤ 187 && −31 ≤ x−y ≤ 30`** (1705 tiles, `51 ≤ x ≤ 108`, `52 ≤ y ≤ 109`).
- Non-visible tiles get `OFF_MAP` on both levels; `FindBestPath` rejects a non-visible origin and never enters an
  `OFF_MAP` tile; its raw `curLoc + DirIncrementer` step can therefore not wrap rows from a reachable tile.
- `HandleNextTile` treats a non-visible next tile as clear (paths out of the map, `Soldier_Tile.cc:280-283`); leaving
  the sector (edgepoints, `GridNoOnEdgeOfMap` `Isometric_Utils.cc:560-576`) is in `16` and `16`.
- The same test, on the loaded map's bounds, gates `CompileWorldTerrainIDs`, `NewOKDestination`, `WhoIsThere2`
  (`WorldMan.cc:1481`), `SetSoldierGridNo` (a soldier set outside is not added to the world, `Soldier_Control.cc:1920`),
  `LegalNPCDestination`'s height check (`TacticalAI/Movement.cc:34`), bullets (`LOS.cc:3514`, `:4205`), the wall damage
  next to a blast (`Explosion_Control.cc:946`, `:954`) and thrown objects (`Physics.cc:378`).
- ja2-node: `gridNoOnVisibleWorldTile(restrictedScrollId, g)` with the render bounds in
  `src/content/world/render-bounds.ts`; the restriction comes from the map info (`restrictedScrollIdOf`;
  `onVisibleWorldTile` in `src/sim/tactical/state.ts`; `PathEnv.restrictedScrollId` for the pathfinder). `isVisibleTile`
  (`src/content/world/grid.ts`) is the closed form of restriction 0, used only where the original has no such test: the
  agent API's gridNo validation and the insertion guard of `addSoldierToSector`. `randomGridNo` keeps the full map
  (`gaps` "Random gridnos in unloaded sectors").

---

## 3. Pathfinding

### 3.1 Entry points and globals

- `FindBestPath(s, dest, level, mode, copy, flags)` (`PathAI.cc:530-1815`). `copy`: `NO_COPYROUTE` → path into
  `guiPathingData[256]`/`giPathDataSize`; `COPYROUTE` → `s.ubPathingData[30]`, `ubPathIndex = 0`, `ubPathDataSize`;
  `COPYREACHABLE(_AND_APS)` → flood fill (`PathAI.h:135-147`). Flags: `PATH_THROUGH_PEOPLE 1`,
  `PATH_IGNORE_PERSON_AT_DEST 2`, `PATH_CLOSE_GOOD_ENOUGH 4` (radius 5).
- Globals: `gubNPCAPBudget` (AP budget mode), `gubNPCDistLimit` + `gfNPCCircularDistLimit` (distance limit),
  `gubGlobalPathFlags` (ORed into flags), `gfPlotPathToExitGrid`, `gfEstimatePath` (multi-tile only),
  `gfPlotDirectPath` (SHIFT, UI only; not in ja2-node). Budget and limit are reset to 0 on most exits and at the end of
  every `ExecuteOverhead` pass (`Overhead.cc:1138-1139`). ja2-node has no globals: `findBestPath(env, s, dest, level,
  options)` takes them per call (`PathOptions`).
- `PlotPath` / `UIPlotPath` / `EstimatePlotPath` / `RecalculatePathCost` (`PathAI.cc:1968-2405`) wrap it for AP
  estimates (§3.6). `EstimatePlotPath` does *not* ignore people for single-tile soldiers despite its comment
  (only `gfEstimatePath` changes, which only multi-tile code reads) (inferred).
- The path search orders by **travel cost** (§2.2), never by AP, so walk/run/swat/crawl yield the same path; the
  movement mode only matters for budget pruning (§3.5), multi-tile JSDs and the AP totals. There is no climbing in the
  search: a different `level` than the soldier's returns 0 (§6).

### 3.2 Algorithm (single-tile soldiers; exact)

Open list: a priority list ordered by `total` ascending, then `leg` ascending, then **newest first** among equal
keys (skip-list insert stops before the first node with `total ≥ new` and `leg ≥ new`, `PathAI.cc:1562-1610`). A heap
keyed `(total, leg, −insertSeq)` pops identically. Stale entries are never removed.

```
H(loc)   = dx<dy ? (5*(dx*14 + dy*10))/14 : (5*(dy*14 + dx*10))/14     // ints; dx,dy = |Δ| to dest (:197-204, :417-422)
LEG(loc) = (|Δx| + |Δy|) & 0xFF                                         // UINT8 (:213, :1539)
DIRS     = [0, 7, 6, 5, 4, 3, 2, 1]                                    // N, then counter-clockwise (:754-756, :1681-1694)
POOL = 1022 nodes, TRAIL_MAX = 16384                                   // (:70-82, :1467-1522)

FindBestPath(s, dest, level, mode, copy, flags, budget, distLimit, circular):
  org = s.sGridNo
  if org ∉ [0,WORLD_MAX) or !visible(org) or s.bLevel != level: return 0              // :590-608 (no budget reset)
  flags |= gubGlobalPathFlags
  forPlayer  = s.bTeam==OUR_TEAM && !autoBandage && !(s.flags & PCUNDERAICONTROL)      // :617
  nonMerc    = !IS_MERC_BODY_TYPE(s)                                                   // non-jumper, non-swimmer
  if nonMerc && Water(dest): return 0
  aroundPeople = !(flags & THROUGH_PEOPLE)
  personAtDest = forPlayer && aroundPeople && !(flags & IGNORE_PERSON_AT_DEST)          // :638
  if dest != NOWHERE:
     if !NewOKDestination(s, dest, personAtDest, level): reset; return 0               // :684-689
     if dest == org: return 0
  if budget: c = MinAPsToStartMovement(s, mode); if c > budget: reset; return 0; budget -= c
  used = {} ; trailCost[org] = 0   // NOTE: org is NOT marked used (:848) -> org can be re-entered later
  trail = [{}]; open.push({loc:org, g:0, total:H(org), leg:LEG(org), trail:0, ap:0})
  do:
    cur = open.popHead()                                   // node goes back to the pool immediately
    curAP = cur.ap
    dirs = DIRS
    if used[cur.loc] && trailCost[cur.loc] < cur.g: dirs = DIRS[1..]   // stale node: `goto NEXTDIR` with ubCnt==0 (:890-891)
    for d in dirs:
      n = cur.loc + DirIncrementer[d]
      if n ∉ [0, GRIDSIZE): continue
      [Strac AI only: enemy at night avoiding lit tiles seen by mercs, :808-815, :987-990; not in ja2-node]
      if copy==COPYREACHABLE && used[n]: continue
      if height[n] != height[cur.loc]: continue
      if distLimit && (circular ? PythSpacesAway : SpacesAway)(org, n) > distLimit: continue
      mine flags: skip ENEMY_MINE for non-friendly; friendly skip PLAYER_MINE unless (OUR_TEAM && n==dest) (:1025-1053)
                  [not in ja2-node: map mines are inert, `gaps` "Map items"]
      c = cost[n][d][level]
      if c == NOT_STANDING: c = terrainCost(n)
      elif c == EXITGRID:   if gfPlotPathToExitGrid: c = terrainCost(n)
      elif c == FENCE && nonMerc: continue
      elif isDoorCode(c): c = resolveDoor(...) or continue          // §3.4
      elif c ∈ {30,36,50} && nonMerc: c = OBSTACLE
      if c >= 249: continue
      if aroundPeople && (n != dest || copyReachable):
         p = WhoIsThere2(n, s.bLevel); if p && p != s: continue       // visibility is NOT checked here
      [multi-tile: OkayToAddStructureToWorld(n, level, animJSD[OneCDirection(d)], ownID) else continue]
      if budget: ap = budgetStep(c, d, mode, ...) (§3.5); if (UINT8)(curAP + ap) > budget: continue
      if closeGoodEnough && PythSpacesAway(n, dest) <= closeLimit: dest = n; closeGoodEnough = false
      if n == dest: c = 0 elif gfPlotDirectPath: c = 10
      if d odd: c = c*14/10                                          // int truncation
      g = cur.g + c
      if !used[n] || g < trailCost[n]:                               // strict: first path found wins ties
         if open.size == POOL: reset; return 0                       // pool exhausted (:1467-1497)
         [original: RandomSkipListLevel() draws Random(4) 1..5 times here, :469-478]
         trail.push({prev: cur.trail, dir: d, grid: n}); if trail.length >= TRAIL_MAX: reset; return 0
         open.insert({loc:n, g, total: g + (copyReachable ? 100 : H(n)), leg: LEG(n), trail: last, ap: curAP+ap})
         trailCost[n] = g; used[n] = true
  while open nonEmpty && open.head.loc != dest
  if open nonEmpty && open.head.loc == dest:
     steps = dirs along trail from head back to index 0, reversed
     COPYROUTE: s.ubPathingData = steps[0..min(30,len)); ubPathIndex = 0; ubPathDataSize = that count; ret = count
     NO_COPYROUTE: guiPathingData = steps[0..min(256,len)); giPathDataSize = ret = count & 0xFF
     reset budget/limit; return ret (gfGeneratingMapEdgepoints: return 1)
  reset; return 0
```

Consequences:
- The goal test is "destination at the head of the open list", and the last step costs 0, so the step into the
  destination ignores its terrain.
- The heuristic underestimates strongly (about 3.6 per straight step vs. a real 9–10), so searches are broad. The pool
  (1022 simultaneous open nodes) and trail (16382 insertions) limits can make long searches **fail**; ja2-node keeps
  both (`POOL_NODES`, `MAX_TRAIL_TREE`). For the reachability floods that the original runs under
  `ReconfigurePathAI(…, ABSMAX_TRAIL_TREE = 65536, …)` (`PathAI.cc:1831, 1878, 1898`), ja2-node passes
  `maxTrailTree: ABSMAX_TRAIL_TREE` (edgepoints, item reachability).
- The unmarked origin can be re-inserted (one more trail entry and pool node each time); stale nodes are re-expanded in
  7 directions. In non-budget mode neither can change the chosen path (inferred: costs are monotone, so a stale
  expansion never finds a strictly cheaper cost), but the origin re-insertions count toward the limits.
- Paths are truncated to 30 steps for `COPYROUTE`; walking re-paths when they run out (§4.6).
- RNG: the original draws from the shared `Random()` per inserted node. Path choice does not depend on it; ja2-node
  draws nothing and uses that heap (`deviations` "Pathfinder RNG").

### 3.3 Continuous-turn / multi-tile search

Only for `SOLDIER_MULTITILE` with an animation JSD (prone humans, as the oracle's prone probe soldiers show; vehicles;
monsters): `fContinuousTurnNeeded` (monster/animal/vehicle) explores clockwise/counter-clockwise from the last step
direction and finally reverse (+50 per backward step) (`PathAI.cc:893-976, 1433-1437`). As ja2-node implements it
(`pathfinding.ts`, `multi-tile.ts`; checked by the creature AI oracle, `13`):
- `SOLDIER_MULTITILE` is the soldier's last added structure having more than one tile (`Soldier.multiTile`); the
  structure file is the one of the movement mode's surface (`DetermineSoldierAnimationSurface` with
  `SubstituteBodyTypeAnimation`), indexed by `OneCDirection(dir)`; no file → no multi-tile checks.
- Continuous turning for monsters, animals and vehicles: the first popped node starts from `bDirection`, later nodes
  from their step direction (the opposite one after a backward step); the loop state (`ubCnt`, start, end, clockwise /
  counter-clockwise / reverse, checked-behind) lives across nodes, so a stale node (`trailCost` lower than its cost)
  continues from the previous node's leftover state, as in the original. Other multi-tile bodies only check the turn
  in place. Every step checks the structure at the new tile; backward steps are flagged and cost +50.
- The exclusion id is the soldier's own structure (`GetStructureID`); `EstimatePlotPath` (`EstimatePathCostToLocation`
  on one level) uses `IGNORE_PEOPLE_STRUCTURE_ID` and skips the multi-tile destination test.
- `NewOKDestination` accepts a multi-tile destination when any of the 8 structures fits (people ignored unless
  `fPeopleToo`; no structure file → refused); `FindAdjacentGridEx`/`FindNextToAdjacentGridEx` test the side tiles with
  `NewOKDestinationAndDirection` (the facing toward the target, no visible-tile test).

### 3.4 Door resolution in the search (`PathAI.cc:1078-1168`, helpers `:2531-2678`)

```
obstIfClosed, dg, dg2 = IsDoorObstacleIfClosed(c, n)          // table :2531-2652
st = GetDoorState(dg, forPlayer)                              // :2654-2678
if dg2 == -1:
   if !(st & ANYDOOR): c = terrainCost(n)                     // destroyed
   else: open = st & OPEN; if st & GARAGEDOOR && d odd && !open: continue
else:
   st2 = GetDoorState(dg2, forPlayer)
   if neither has ANYDOOR: c = terrainCost(n)
   elif !(st & OPEN) || !(st2 & OPEN): continue
   open = true
if isDoorCode(c):
   if open:  c = obstIfClosed ? terrainCost(n) : OBSTACLE
   elif obstIfClosed:
      if forPlayer || monster/animal: c = OBSTACLE             // PLAYERS NEVER PATH THROUGH CLOSED DOORS
      else: door = map door at dg; c = (!door || !door.locked || s.bHasKeys) ? terrainCost(n) : OBSTACLE
            (budget mode: mark goingThroughDoor)
   else: c = terrainCost(n)
GetDoorState(g, perceived): if perceived && DOOR_STATUS_PRESENT at g: status ? DOOR|(PERCEIVED_OPEN?OPEN:0) : "destroyed"
                            else FindStructure(g, ANYDOOR)?.fFlags ?? "destroyed";  "destroyed" = OPEN without door bits
```

Vanilla differs: it forbids **every** diagonal step onto a door-coded cost (`vanilla:Tactical/PathAI.c:1017-1021`);
Strac only forbids diagonals through a closed garage door or a closed member of a double-door pair. Follow Strac.

### 3.5 AP budget mode (AI; `PathAI.cc:1222-1398`)

`ap` from `c` (after door/exit/not-standing conversion, before the destination zeroing): `0→0, 9|10→3, 12→4, 16→5,
20→6, 30→7, 36→9, 50→8, 40→6`, anything else skips the direction. Diagonal `ap*14/10`. Mode (water codes force
WALKING): RUNNING/ADULTMONSTER_WALKING `ap*10/18`; WALKING/ROBOT_WALK `ap−1`; SWATTING `+0`; CRAWLING `+1`. Fence:
+2 for run/walk/swat, crawl skips. Door: `+doorAPs[forPlayer ? s.ubDoorHandleCode : HANDLE_DOOR_OPEN]` (3/4/5,
`Points.h:102-107`). All in **UINT8**: walking onto a cost-0 tile gives `ap = 255`, so `curAP + 255` wraps to
`curAP − 1` (or prunes at curAP 0). `goingThroughDoor` persists across directions if a later check skips the step
(quirk). The start cost `MinAPsToStartMovement` is subtracted from the budget up front. ja2-node keeps the AI cost
window `gubAIPathCosts` in a fresh array per search (`deviations` "AI path-cost cache").

### 3.6 AP and BP of a path

Constants (`Tactical/Points.h`, `Overhead_Types.h:78-84`): `AP_MOVEMENT_FLAT 3, GRASS 4, BUSH 5, RUBBLE 6, SHORE 7,
LAKE 9, OCEAN 8`, `AP_JUMPFENCE 6`, `AP_CROUCH 2`, `AP_PRONE 2`, `AP_START_RUN_COST 1`, `AP_STEALTH_MODIFIER 2`,
`AP_REVERSE_MODIFIER 1`, `AP_CLIMBROOF 10`, `AP_CLIMBOFFROOF 6`; `RUNDIVISOR 1.8, WALKCOST −1, SWATCOST 0,
CRAWLCOST +1`; `MAX_PATH_LIST_SIZE 30`.

```
TerrainActionPoints(s, g, d, level):                               // Points.cc:34-114
  ap = (s.bStealthMode ? 2 : 0) + (s.bReverse || gUIUseReverse ? 1 : 0)
  sw = cost[g][d][level]
  if sw == NOT_STANDING: sw = terrainCost(g)
  elif isDoorCode(sw): sw = InternalDoorTravelCost(s, g, sw, s.bTeam==OUR_TEAM, returnDoorCost=false)
  if sw >= 249 && sw != DOOR(252): return 100
  9|10: +3; 12: +4; 16: +5; 20: +6; 30: +7; 36: +9; 50: +8; 252: +3; 40: return 6; 0: return 0; other: +0
  if d odd: ap = ap*14/10
ActionPointCost(s, g, d, anim):                                    // :244-328, the cost actually deducted
  tile = TerrainActionPoints(s, g, d, s.bLevel); sw = cost[g][d][s.bLevel]
  if sw == FENCE: return tile
  if Water(g): anim = WALKING
  pts = tile<=0 ? 0 : RUNNING|ADULTMONSTER_WALKING|BLOODCAT_RUN: (int)(tile/1.8)
                     | walk class (WALKING, SIDE_STEP, WALK_BACKWARDS, ROBOT_WALK, …): tile−1
                     | swat class (SWATTING, START_SWAT, SWAT_BACKWARDS, CROW_WALK): tile
                     | CRAWLING: tile+1 | other: 1
  if sw == NOT_STANDING && anim ∈ {RUNNING, WALKING, LARVAE_WALK, SIDE_STEP, WALK_BACKWARDS}: pts += 2
PtsToMoveDirection(s, d) = ActionPointCost(s, NewGridNo(s.sGridNo, d), d, Water ? WALKING : s.usUIMovementMode)
                         + (mode==RUNNING && anim!=RUNNING && cost!=FENCE ? 1 : 0)            // :1244-1270
MinAPsToStartMovement(s, mode): stance change to the mode's height (walk/run from crouch 2, from prone 4; swat from
  stand 2 / prone 2; crawl from stand 4 / crouch 2) + (mode==RUNNING && anim!=RUNNING ? 1 : 0)   // :1273-1319
MinPtsToMove(s) = min over 8 neighbours of ActionPointCost(s, nb, d, usUIMovementMode)          // :1217-1241
```

`InternalDoorTravelCost` (`PathAI.cc:2408-2523`) mirrors §3.4 but returns `TRAVELCOST_DOOR` (252) instead of
"obstacle" for a closed obstacle-if-closed door (players, monsters, or always when `returnDoorCost`), `OBSTACLE` for
monsters/animals, and the **raw door code** when the door is destroyed (→ `TerrainActionPoints` charges only the
stealth/reverse part; quirk).

`PlotPath(s, dest, NO_COPYROUTE, plot, mode, budget)` (`:1968-2347`), the AP number shown by the UI and used by AI:
```
pts = 0
if FindBestPath(s, dest, s.bLevel, mode, copy, 0):            // (RecalculatePathCost skips this and reuses the global path)
  pts += MinAPsToStartMovement(s, mode)
  if cost[first][path[0]][lvl]==FENCE && mode==RUNNING && s.usAnimState!=RUNNING: pts -= 1
  ignoreNext = false; g = s.sGridNo
  for i, d in guiPathingData[0..n):
    g = NewGridNo(g, d); sw = cost[g][d][lvl]; tile = TerrainActionPoints(s, g, d, lvl); m = Water(g) ? WALKING : mode
    if ignoreNext: ignoreNext = false
    elif sw == FENCE: pts += tile; ignoreNext = true
                      if m ∈ {RUN,WALK} && i+2 < n: pts += 2 + (m==RUN ? 1 : 0); if m == SWAT: pts += 2
    elif tile > 0: extra = (sw==NOT_STANDING && m ∈ {RUN,WALK}) ? 2 : 0
                   RUN: (int)(tile/1.8)+extra | WALK: tile−1+extra | SWAT: tile | CRAWL: tile+1 | other: tile
return pts
```
(`PlotPath` always reads `guiPathingData`, so a `COPYROUTE` call would cost a stale path; no caller does that.
ja2-node's `recalculatePathCost` (`ai/utils.ts`) re-costs the soldier's stored path, `deviations` "Recalculated path
cost".)

Breath per step (`TerrainBreathPoints`, `Points.cc:154-241`): from `cost[g][d][0]` (**always level 0**, even on
roofs): `9|10→5, 12→10, 16→20, 20→35, 30→50, 36→75, 50→100`, door codes `→5`, else 0; `× carried-weight %`
(`:117-151`); water forces walking; × run 3 / walk 1 / swat 2 / crawl 4; RT `× 1.25` (int). `DeductPoints`
(`:488-582`) zeroes the AP part outside combat and scales BP by `AdjustBreathPts` (`:585-635`); see `10` §3.

---

## 4. The walking protocol

### 4.1 Issuing a move

Player click (`Tactical/Handle_UI.cc:1700-1782`): RT sets `usUIMovementMode = GetMoveStateBasedOnStance` (stand →
WALKING or RUNNING if `fUIMovementFast`, crouch → SWATTING, prone → CRAWLING; `Soldier_Control.cc:2410-2426`), then
`EVENT_InternalGetNewSoldierPath(s, dest, usUIMovementMode, fromUI=1, force=s.fNoAPToFinishMove)`. TB only accepts a
move if the first step is affordable: `PtsToMoveDirection(path[0]) + GetAPsToChangeStance` (`:2478-2500`). Group moves
set `gfGetNewPathThroughPeople`.

`EVENT_InternalGetNewSoldierPath(s, dest, anim, fromUI, force)` (`Soldier_Control.cc:3406-3587`):
```
fromUI==3 → (OUR_TEAM ? 1 : 0); EPC cowering → uncower, anim = WALKING
s.bGoodContPath = false
flags = 0; if s.fDelayedMovement: flags = (ubDelayedMovementFlags & THROUGH_PEOPLE) ? THROUGH_PEOPLE : IGNORE_PERSON_AT_DEST; s.fDelayedMovement = false
if gfGetNewPathThroughPeople: flags = THROUGH_PEOPLE
if (!INCOMBAT && anim(s) is MOVING && fromUI==1) || fromUI==2:        // re-path while walking (RT) / path exhausted
   if s.bCollapsed: return false
   save = s.sGridNo; s.sGridNo = s.sDestination                      // plan from the tile being entered
   if !FindBestPath(s, dest, lvl, s.usUIMovementMode, NO_COPYROUTE, flags): s.sGridNo = save; return false
   n = FindBestPath(…, COPYROUTE, flags); s.sGridNo = save; s.sFinalDestination = dest
   if n == 0: return false
   shift: ubPathingData[1..29] = old[0..28] (entry [0] stays = new step 0, a dummy for the step in progress);
          if ubPathDataSize < 30: ubPathDataSize++      (ubPathIndex is 0)
   newAnim = s.bOverTerrainType==DEEP_WATER ? DEEP_WATER_SWIM : s.usUIMovementMode
   if newAnim != s.usAnimState: s.usDontUpdateNewGridNoOnMoveAnimChange = TRUE; EVENT_InitNewSoldierAnim(newAnim)
   return true
if !s.bPathStored and !FindBestPath(s, dest, lvl, anim, COPYROUTE, flags): return false
s.sFinalDestination = dest; s.fPastXDest = s.fPastYDest = 0
endAim = PickSoldierReadyAnimation(s, TRUE)
if endAim valid && endHeight(s.usAnimState)==STAND: EVENT_InitNewSoldierAnim(endAim); s.usPendingAnimation = anim
else: EVENT_InitNewSoldierAnim(s, anim, 0, force)
return true
```

### 4.2 `EVENT_InitNewSoldierAnim` for moving animations (`Soldier_Control.cc:882-1766`)

In order: reject if `fInNonintAnim` (RT: `fRTInNonintAnim`) (`:899-916`); `fTryingToRestart` if same state with
`ANIM_NORESTART` and not forced (`:918-925`); **stance mismatch** (`:930-977`): RT stand↔crouch while already moving
just sets `ubDesiredHeight` and switches directly; RT crouch→prone sets turning-until-done pending; otherwise
`usPendingAnimation = new` and `ChangeSoldierStance(height(new))` (the 499 dispatcher later starts the pending move);
rifle raise/lower inserts (`:1026-1072`); `SWATTING` from anything but `START_SWAT` becomes `START_SWAT` (moves 1.3/frame,
5 frames, then `SWATTING`) (`:1086-1090`); reverse → `SIDE_STEP`/`WALK_BACKWARDS`/`SWAT_BACKWARDS` (`:1145-1168`);
LOW/MED water: `RUNNING → WALKING` (`:1188-1197`); clear `SOLDIER_PAUSEANIMOVE` and `AdjustNoAPToFinishMove(FALSE)`
(`:1200-1203`).
**First step**: if new is `ANIM_MOVING` and (old is not moving or `force`), and not `usDontUpdateNewGridNoOnMoveAnimChange`,
and new != `SWATTING`: `HandleGotoNewGridNo(s, initial=TRUE, newState)`; if it returns FALSE (blocked, collapse) or
keep=false (no APs) → **return without changing the animation** (`:1224-1291`). Then: `WALKING/SWATTING/CRAWLING` clear
pending anim/count; `RUNNING`: `DeductPoints(AP_START_RUN_COST)` if the previous state was not `RUNNING`
(`:1426-1457`); `HOPFENCE`: `DeductPoints(6, 200)` (`:1551-1554`). Finally set the state, `sAniDelay`
(`SetSoldierAniSpeed`, `:4921-4960`; formula in `01` §3.3, `:4763-4918`), reset the frame timer and execute the first frame
(`:1733-1740`).

### 4.3 Per-frame loop (`ExecuteOverhead`, `Tactical/Overhead.cc:477-1140`)

Every 5 ms pass, soldiers in `MercSlots` order (`:518`); this order decides RT races for reservations.
```
if s.sAniDelay != 10000 && frameTimerDone(s):
  if (!(anim & (MOVING|SPECIALMOVE)) || !s.fNoAPToFinishMove) && !s.fPauseAllAnimation:    // NoAP freezes moving anims
    if !AdjustToNextAnimationFrame(s): continue                                         // runs opcodes, 01 §3.4
    if !(anim & SPECIALMOVE): HandleNextTileWaiting(s)                                   // §4.5
    if anim & (MOVING|SPECIALMOVE) && !(s.flags & PAUSEANIMOVE):
      keep = true; s.fPausedMove = false          // => opcode 402 never pauses movement (cleared after the frame ran; same in vanilla)
      if s.fPastXDest && s.fPastYDest:            // passed the centre during an earlier frame
        s.fPastXDest = s.fPastYDest = false
        HandleBloodForNewGridNo(s)
        if !(anim & SPECIALMOVE) || s.sGridNo == s.sFinalDestination: HandleAtNewGridNo(s, &keep)      // §4.7
        if s.sFinalDestination == s.sGridNo: finalDestination(s); keep = false                        // §4.6
        elif !s.fNoAPToFinishMove:
          s.ubPathIndex = min(s.ubPathIndex + 1, s.ubPathDataSize)
          if s.ubPathIndex == s.ubPathDataSize: pathExhausted(s) (may `continue`)                     // §4.6
          elif !(anim & SPECIALMOVE): if !HandleGotoNewGridNo(s, &keep, FALSE, s.usAnimState): continue
          else: EVENT_InternalSetSoldierDestination(s, path[idx], FALSE, anim)
      if s.flags & PAUSEANIMOVE: keep = false     // opcodes 446/471
      if !s.fPausedMove && keep: MoveMerc(s, speed(s), s.bMovementDirection)                             // §4.4
    if anim & TURNING: TurnSoldier(s)                                                                   // §4.8
AI (TB: every soldier every pass; RT: round robin, 09 §1)
```
`speed(s)`: `WALKING` uses `gubAnimWalkSpeeds[body].dMovementChange` (1.6 for mercs), all other states
`gAnimControl[state].dMovementChange` (RUN 2.6, SWAT 2.2, START_SWAT 1.3, CRAWL 0.8; `Animation_Control.cc:37-52,
351-425`). WALKING/RUNNING/SWATTING/CRAWLING scripts are 12-frame loops without pause opcodes (computed from
`Ja2bin.dat`, cf. `04` §1).

Note the one-frame lag: the centre is crossed during frame N's `MoveMerc`; arrival logic runs at frame N+1, before
that frame's `MoveMerc` heads for the next tile from the overshot position (the snap-to-centre lines are commented out,
`:724-725`). ja2-node's `overhead.ts` runs this loop once per 5 ms tick; `HandleBloodForNewGridNo` (the blood trail of a
bleeding mover) is not ported.

### 4.4 `MoveMerc`, position and the occupancy switch

```
MoveMerc(s, speed, dir):                                         // Soldier_Control.cc:6219-6331, angles Overhead.cc:1000-1012
  x = f32(s.dXPos + f32(speed * SIN[dir]))
  if dir∈{NE,E,SE} ? x >= s.sDestXPos : dir∈{NW,W,SW} ? x <= s.sDestXPos : true:
     s.fPastXDest = true; if s.sGridNo == s.sFinalDestination: x = s.sDestXPos
  y = f32(s.dYPos + f32(speed * COS[dir]))
  if dir∈{N,NE,NW} ? y <= s.sDestYPos : dir∈{S,SW,SE} ? y >= s.sDestYPos : true:
     s.fPastYDest = true; if s.sGridNo == s.sFinalDestination: y = s.sDestYPos
  EVENT_SetSoldierPositionXY(s, x, y, SSP_NO_DEST|SSP_NO_FINAL_DEST)
EVENT_SetSoldierPositionXY: g = trunc(f32(y/10))*160 + trunc(f32(x/10)); s.dXPos=x; s.dYPos=y; s.sX/sY = trunc; SetSoldierGridNo(s, g)
```
`SIN/COS` are the double results of `sin/cos((double)(float)angle)` with `PI = 3.1415926` (`sgp/Types.h:54`) and
angles `[PI, 3PI/4, PI/2, PI/4, 0, −PI/4, −PI/2, −3PI/4]` for `N..NW`, so N is not exactly `(0, −1)` (sin
`1.5099579909783707e-07`). ja2-node hard-codes the glibc values as `MOVE_SIN_COS` (`src/sim/tactical/constants.ts`),
indexed by direction as `[sin, cos]`; SW/W/NW are SE/E/NE with sin negated.

All position math is **float32** (`Math.fround` after every multiply-to-float and add); NE and SE x-steps differ in
the last bits. Example (computed): walking east from x=505 the tile counts per tile are 7, 6, 6, **7**, 6 frames
(the fourth would be 6 in exact arithmetic: 535.39966+9.6 < 545).

`SetSoldierGridNo(s, g)` (`:1881-2106`): return if `g == s.sGridNo` (with a level node); while in a moving
animation any different `g` is **forced to `s.sDestination`** (so diagonal moves never occupy the side tile, and the
switch happens the first frame the position leaves the old tile). Then, in order: remove from old tile (person
structure, adjacency counts, roof marker, `UnMarkMovementReserved`), `sGridNo = g`; return if not visible; auto-close
door (`bEndDoorOpenCode == 2`); insertion code; `UnMarkMovementReserved`; adjacency counts; `DropSmell`; fence z
override; add merc level node + person structure (`AddMercToHead`), light; `bOverTerrainType = terrain(g)`; water
transitions (`usUIMovementMode = WALKING` in water, deep-water swim animations, `WaterDamage` in MED/DEEP); gas flag;
sneaking agility gain; `SetSoldierAniSpeed` (new terrain speed takes effect immediately). ja2-node's
`setSoldierGridNo` (`movement.ts`) keeps the simulation steps in this order (occupancy, person structure, reservation,
auto-close door, `dropSmell`, terrain, walking in water, animation speed; the gas flag through the `enteredGridNo`
hook); deep-water swim animations, `WaterDamage` and the sneaking agility gain are not ported.

### 4.5 Next tile: blocking, reservation, waiting

`HandleGotoNewGridNo(s, initial, anim)` (`Overhead.cc:1247-1629`), called at the tile centre before leaving:
```
keep = true
if s.bBreath < OKBREATH && (s.bBreath == 0 || s.bCollapsed): s.bBreathCollapsed = true; s.bEndDoorOpenCode = 0; return false
d = path[idx]; next = NewGridNo(s.sGridNo, d); c = cost[next][d][s.bLevel]
if c == FENCE: (§6) return false
if InternalDoorTravelCost(s, next, c, s.bTeam==OUR_TEAM, returnDoorCost=TRUE) == DOOR:
   door at (d∈{N,W} ? next : d∈{S,E} ? s.sGridNo : halt); open it (StartInteractiveObject + InteractWithOpenableStruct);
   AI: bEndDoorOpenCode = 1 (resume after OPEN_DOOR, Soldier_Ani.cc:1837-1863); keep = false; return false
ap = ActionPointCost(s, next, d, anim); bp = TerrainBreathPoints(s, next, d, anim)
if !HandleNextTile(s, d, next, s.sFinalDestination): s.bEndDoorOpenCode = 0; return false
CheckIfNearbyGroundSeemsWrong(s, next, FALSE, &keep)                       // mine sense hook
if s.fNoAPToFinishMove && !initial: keep = false
elif idx == size && size == 0: keep = false
elif EnoughPoints(s, ap, 0):                                               // RT: always true unless collapsed
   if idx > 0 && smoke on current tile && PreRandom(5)==0 && gas hurts: EVENT_StopMerc; gas damage; stop
   else marbles on FLAT_FLOOR/PAVED_ROAD (level 0): collapse, return false
        elif blinded && RUNNING && Random(5)==0 && OKFallDirection: collapse, return false
        elif drunk && Random(5)==0 && OKFallDirection: collapse, return false
        elif OUR_TEAM FORGETFUL: counter++; if idx > 2 && Random(100)==0 && counter > 200: stop (forgets path)
   if not stopped:
        if !(anim == CRAWLING && s.fTurningFromPronePosition > 1): DeductPoints(s, ap, bp)     // paid before leaving
        EVENT_InternalSetSoldierDestination(s, d, initial, anim)          // sDestination, sDestX/YPos (centre), bMovementDirection, desired dir
        AdjustNoAPToFinishMove(s, FALSE)
else: HaltGuyFromNewGridNoBecauseOfNoAPs(s); s.bEndDoorOpenCode = 0; keep = false
return true
```
(RNG note: `Random(100)` is drawn every step past index 2 for FORGETFUL mercs; the others only when their
preconditions hold, left to right.) ja2-node's `handleGotoNewGridNo` (`movement.ts`) ports the breath, fence, door,
`HandleNextTile`, AP and gas steps (gas through the `runningIntoGas` hook, `checkForRunningIntoGas` in
`explosions/smoke.ts`, with its `PreRandom(5)`); the mine sense, marbles, blind and drunk falls and the FORGETFUL counter
are not ported, so their draws do not happen.

`HandleNextTile(s, d, g, final)` (`Soldier_Tile.cc:272-373`): non-visible `g` or `CROW_FLY` → TRUE.
`b = TileIsClear(s, d, g, lvl)`; if blocked: (a) `g == final && ubWaitActionToDo == 0 && (OUR_TEAM ||
sAbsoluteFinalDestination == NOWHERE)` → `SetFinalTile` (`sFinalDestination = sGridNo`, `EVENT_StopMerc`) → FALSE;
(b) STATIONARY → `EVENT_StopMerc` keeping `sFinalDestination`, `SetDelayedTileWaiting(s, g, 1)` → FALSE; (c) TEMP →
same with value 100 → FALSE. If clear: **RT only** `MarkMovementReserved(s, g)` (flag `MAPELEMENT_MOVEMENT_RESERVED`,
`ubReservedSoldierID = s.ubID`, releases the previous reservation; `:75-90`); if `Water(g)`: crouched/prone →
`fContinueMoveAfterStanceChange = TRUE; ChangeSoldierStance(STAND)`; `RUNNING → WALKING`. Return TRUE. (ja2-node:
only `RUNNING → WALKING`; the stand-up in water is not ported.)

`TileIsClear(s, d, g, lvl)` (`:115-268`):
```
p = WhoIsThere2(g, lvl)
if p && p != s:
   if s.bTeam != OUR_TEAM:
      s.fBlockedByAnotherMerc = true; s.bBlockedByAnotherMercDirection = d
      if p.sFinalDestination == p.sGridNo: return STATIONARY
      if p.fBlockedByAnotherMerc && p.bBlockedByAnotherMercDirection == Opposite(d):
         make p temporarily stationary; if PlotPath(s, s.sFinalDestination, NO_COPYROUTE, …): repath s (EVENT_GetNewSoldierPath),
            restore p, return TileIsClear(s, guiPathingData[0], next tile)
         elif single-tile: swap positions (SwapMercPositions :644-668), both repath
      return TEMP
   else:  // player soldiers
      if p.fDelayedMovement >= 105: s.fDelayedMovement = 150; return STATIONARY
      return p.sGridNo == p.sFinalDestination ? STATIONARY : TEMP
if g reserved by another soldier: return TEMP                 // reservations exist only in RT
if !NewOKDestination(s, g, FALSE, s.bLevel) && cost[g][d][s.bLevel] != FENCE: s.fBlockedByAnotherMerc = false; return STATIONARY
s.fBlockedByAnotherMerc = false; return CLEAR
```

Reservations are released in `SetSoldierGridNo` on entering the tile, on removal from the grid, in `EVENT_StopMerc`
and when halting for APs (`UnMarkMovementReserved`, `:93-112`; kept during `HOPFENCE` until the position reaches it).

`HandleNextTileWaiting(s)` (`:376-625`), every animation frame while `fDelayedMovement`, gated by a **700 ms** timer
(`NEXT_TILE_CHECK_DELAY`, `:25`; game ms in ja2-node, `Soldier.nextTileCheckAt`):
```
b = TileIsClear(s, dirTo(cause), cause, lvl)
if s.fDelayedMovement >= 100 && b == TEMP: if ++s.fDelayedMovement > 120: SetFinalTile(given up, "no path" msg); s.fDelayedMovement = 0
                                           return
if b != TEMP:
   if s.fDelayedMovement >= 100 && != 150: s.fDelayedMovement = 1
   target = sAbsoluteFinalDestination==sFinalDestination ? it : NewOKDestination(final, people) ? final
          : nearest sweet spot (radius 6 then 16; through people unless value 150)
   if FindBestPath(s, target, lvl, mode, NO_COPYROUTE, THROUGH_PEOPLE):
      nb = TileIsClear(first step); if STATIONARY: FindBestPath(… IGNORE_PERSON_AT_DEST); nb = TileIsClear(first step); clear THROUGH_PEOPLE flag
      else if s.fDelayedMovement < 150: set DELAYED_MOVEMENT_FLAG_PATH_THROUGH_PEOPLE
      if nb == CLEAR: s.bPathStored = false; EVENT_GetNewSoldierPath(s, target, mode); return
s.fDelayedMovement++ (the "cap at 99" line is a no-op); value 3: AI/autobandage forced swap; > 20 (≠150) or > 170
and within 5 tiles of the final destination (player): SetFinalTile
```
`SetDelayedTileWaiting` also makes a player follower borrow the blocker's speed stats (`fUseMoverrideMoveSpeed`,
`:27-58`); ja2-node's `setDelayedTileWaiting` sets only the value, cause and timer.

### 4.6 Final destination, path exhaustion, stopping

`finalDestination(s)` (`Overhead.cc:745-908`): `ubPathIndex = ubPathDataSize = 0`, `bReverse = false`;
`EVENT_SetSoldierPositionXY(s, sDestXPos, sDestYPos, SSP_NONE)` (exact centre; also resets `sDestination` and
`sFinalDestination` to the tile); start `usPendingAnimation` (+ pending direction) if any; `ubWaitActionToDo`
handling; pending actions (open door/struct with `doorAPs` check, `handlePendingAction`); otherwise (alive)
`UnSetUIBusy` + `SoldierGotoStationaryStance` (STANDING/CROUCHING/PRONE by end height, `END_HURT_WALKING` when
injured, `Soldier_Control.cc:3612-3679, 1098-1105`).

`pathExhausted(s)` (`:919-955`, reached when the 30-step cap cut the path or an RT re-path left it short):
`bPathStored = false`; AI with `sAbsoluteFinalDestination` → handled by AI next frame; else: if
`FindBestPath(final, THROUGH_PEOPLE, NO_COPYROUTE)` succeeds, `SetDelayedTileWaiting(s, firstStepTile, 1)` (this only
selects the flags of the next call); then `EVENT_InternalGetNewSoldierPath(s, final, usUIMovementMode, fromUI=2)`
(§4.1 branch: plans from `sDestination == sGridNo`, inserts the dummy step); on failure `SoldierGotoStationaryStance`
and `continue`. On success the frame still runs `MoveMerc` with the **old** direction, the next frame runs
`HandleAtNewGridNo` again on the same tile (noise/sight twice), then steps to `ubPathingData[1]`.
So long moves are re-planned from the current tile every 30 steps.

`EVENT_StopMerc(s)` (`Soldier_Control.cc:7372-7421`): unless waiting, clear the pending animation, direction and action
(`Soldier::removePendingAnimation`); `bEndDoorOpenCode = 0`;
`fTurningFromPronePosition = 0`; `ubPathIndex = ubPathDataSize = 0`; `fDelayedMovement = 0`; `bReverse = 0`;
`EVENT_SetSoldierPosition(s, s.sGridNo, SSP_NONE)` (snap to the centre of the tile currently occupied, which may be the
tile ahead after the half-step switch; also `sDestination = sFinalDestination = sGridNo`);
`sDestX/YPos = (int)dX/dYPos`; set direction; moving anim → `SoldierGotoStationaryStance`; cancel turn-to-shoot; clear
speed override at destination; `UnSetUIBusy`; `UnMarkMovementReserved`. `StopSoldier` additionally sets
`sFinalDestination = sGridNo` (`:3596-3610`).

`AdjustNoAPToFinishMove(s, set)` (`:193-217`) just sets `fNoAPToFinishMove` (reason reset on clear). It is set by
`HaltMoveForSoldierOutOfPoints` (`TacticalAI/Movement.cc:616-633`, via `HaltGuyFromNewGridNoBecauseOfNoAPs`,
`Overhead.cc:1143-1160`: also clears pending animation and reservation, message, `UnSetUIBusy`), by an interrupt or
"enemy sighted on their turn" in `HandleAtNewGridNo`. While set, a moving animation is frozen in place (no frames, no
turning). It is cleared by any new animation (`:1203`), `HandleGotoNewGridNo` success, `TurnSoldier`, a new path, end of
the player's turn when the next step is affordable (`TeamTurns.cc:210-223`), and leaving combat (`Overhead.cc:4055-4072`).
Continuing a halted move: `ContinueMercMovement` / `CheckForMercContMove` (`Soldier_Control.cc:7519-7562`,
`Points.cc:1588-1609`).

### 4.7 `HandleAtNewGridNo` (`Overhead.cc:1709-1962`), exact order

1. Fade bookkeeping; TB camera follow.
2. `bTilesMoved++` (+1 more if RUNNING); RT: `ubTilesMovedPerRTBreathUpdate++`, remember the anim.
3. Return early while the squad walks off screen / to an exit grid.
4. `CheckForBreathCollapse` → return (keep moving).
5. `SetOffBombsInGridNo` → stop, return.
6. `fInterruptOccurred = false`; `MakeNoise(MovementNoise)` if volume > 0 (stealth footstep sound).
7. If no interrupt yet: `HandleSight(LOOK|RADIO|INTERRUPT)`.
8. If an interrupt occurred: `AdjustNoAPToFinishMove(TRUE)`, keep = false, clear pending anim/direction, drop the
   pending action if at the final tile, reset the flag, release the "enemy sighting" pause. Else if
   `fNoAPToFinishMove` or `idx == size == 0` → keep = false; else if `fEnemySightingOnTheirTurn` → halt (NoAP).
9. `CheckIfNearbyGroundSeemsWrong(s, sGridNo, TRUE)` (mine sense around).
10. `HandleSystemNewAISituation`.
11. Quest/NPC arrival triggers (EPCs, John/Mary, Maria, Joey; hostile hicks).

ja2-node's `handleAtNewGridNo` (`movement.ts`) does 2 and 8, steps 5–7 in the `atNewGridNo` hook of
`perception/wiring.ts` (pressure action items of our soldiers, `setOffActionItemsInGridNo`; the footstep noise plus a
`stealthyFootstep` event for a sneaking merc; `HandleSight`), 10 through `newAiSituation`, and of 11 the escort
arrivals and the assassin's approach. Step 1 is presentation; bombs and mines are inert (`gaps` "Map items").
Not ported here: the early return of 3 (a squad walking off the map still makes noise and looks), the breath collapse
check of 4 and the mine sense of 9.

### 4.8 Turning while moving

There is **no turn-before-move** for standing movers: `EVENT_InternalSetSoldierDestination` sets `bDesiredDirection`
(the opposite when reversing) and the soldier translates immediately while `TurnSoldier` (`Soldier_Control.cc:4215-4496`)
rotates `bDirection` by `bTurningIncrement` one octant per animation frame (after `MoveMerc`).
`bTurningIncrement = QuickestDirection(cur, desired)` (`Isometric_Utils.cc:514-519`): `+1` if `desired > cur` and
`desired−cur ≤ 4`, or `cur > desired` and `cur−desired ≥ 4`; else `−1` (opposite always turns clockwise). Each step:
`OKToAddMercToWorld(newDir)`, then `EVENT_SetSoldierDirection` (rebuilds the person structure); sight on turning is only
handled for stationary animations. Turning APs (`AP_LOOK_*`, `Soldier_Control.cc:3859-3881`) are only charged for
`ANIM_BREATH|OK_CHARGE_AP_FOR_TURN|FIREREADY` states and not on the initial move, i.e. **never while walking**. The facing
matters for gameplay because `HandleSight` at each arrival uses it. Prone movers turn by `PRONE_UP` → turn →
`CRAWLING` (`:4484-4489`, `:3885-3911`, `:1205-1218`).

### 4.9 Stance changes en route

RT, moving (`Handle_UI.cc:2859-2888`): `usUIMovementMode = GetMoveStateBasedOnStance(newStance)`;
`usDontUpdateNewGridNoOnMoveAnimChange = 1` (or `LOCKED` + `bPathStored = false` when going to crawl from non-prone);
`ChangeSoldierState(newMode)`; the stand↔crouch case swaps animation without a stance animation (§4.2). TB: only while
stationary; `ChangeSoldierStance` and `sFinalDestination = sGridNo` (`:2843-2857`). Stance animations charge
`KNEEL_UP/DOWN: AP_CROUCH, BP_CROUCH`; `PRONE_UP/DOWN: AP_PRONE` only when at the final tile or `ubPathIndex == 0`
(`Soldier_Control.cc:1467-1492`).

### 4.10 RT vs TB

| Aspect | RT | TB |
|---|---|---|
| AP | never deducted or checked (`Points.cc:462-465, 495-498`) | per step at the centre; first step must be affordable |
| BP | `× 1.25` | plain |
| Frame delay | full; `× 2` in stealth | `/ 2`; unseen soldiers 0 (ja2-node: without the fade, `gaps` "Unseen soldiers in combat") |
| Tile reservation | yes (`HandleNextTile`) | no |
| New order while walking | re-plan from `sDestination` with dummy step (§4.1) | UI blocks until stationary/halted |
| Halt reasons | blocked tile, mines, gas, sighting → `EVENT_StopMerc` (AI) | plus out of APs and interrupts → `fNoAPToFinishMove` freeze |
| Stance change while moving | animation swap | not possible |

---

## 5. Soldier position representation

| Field (`Soldier_Control.h:355-774`) | Meaning |
|---|---|
| `dXPos, dYPos` (float32) | world units, 10 per tile; centre = `x*10+5` (`ConvertGridNoToCenterCellXY`, `Isometric_Utils.cc:349-353`); `sX, sY` = truncations |
| `sGridNo`, `sOldGridNo` | occupied tile (person structure, level node); switches at the half step (§4.4) |
| `sDestination`, `sDestXPos, sDestYPos` | tile being entered and its centre (`EVENT_InternalSetSoldierDestination`, `Soldier_Control.cc:3724-3761`) |
| `sFinalDestination` | goal of the current order; reset to `sGridNo` by stops; `sAbsoluteFinalDestination` for scripted AI |
| `bDirection`, `bDesiredDirection`, `bTurningIncrement` | facing, target facing, ±1; `ubHiResDirection` (32) for vehicles |
| `bMovementDirection` | direction of the step in progress (drives `MoveMerc`) |
| `ubPathingData[30]`, `ubPathDataSize`, `ubPathIndex` | step directions; current step = `ubPathingData[ubPathIndex]`, advanced on arrival (Strac uses `ub…`, not `us…`) |
| `fPastXDest, fPastYDest` | centre-passed flags per axis (N/S set X at once, E/W set Y at once) |
| `bLevel` | 0 ground, 1 roof |
| `usUIMovementMode`, `usAnimState`, `usPendingAnimation` | chosen mode, current state, queued state |
| `fNoAPToFinishMove`, `fDelayedMovement`, `sDelayedMovementCauseGridNo`, `sReservedMovementGridNo`, `fBlockedByAnotherMerc`, `bBlockedByAnotherMercDirection`, `bReverse`, `bPathStored`, `bOverTerrainType`, `fPrevInWater` | §4 |

ja2-node's `Soldier` (`src/sim/tactical/soldier.ts`) uses the names without type prefix (`x`/`y` = `dXPos`/`dYPos`,
`destX`, `pastX`, `path`, `pathIndex`, `delayedMovement`, `reservedGridNo`, …); reservations live in
`TacticalState.reserved`.

Helpers (`TileEngine/Isometric_Utils.{h,cc}`): `OppositeDirection = (d+4)%8`, `OneCDirection = (d+1)%8`,
`OneCCDirection = (d+7)%8`, `TwoCDirection = (d+2)%8`; `DirectionInc(d)` (d > 7 → 1, `:307-315`);
`NewGridNo(g, inc)` returns `g` when `OutOfBounds` (row wrap at columns 0/159, `< 0`, past the last row;
`:262-304`; note the fast path tests `g > 160`, not `>=`); `PythSpacesAway = (int)hypot(Δrow, Δcol)`,
`SpacesAway = max`, `CardinalSpacesAway = sum` (`:408-436`); `GETWORLDINDEXFROMWORLDCOORDS(y, x)` (`.h:48`).
There is no `FindDirection`; the direction between tiles is `GetDirectionToGridNoFromGridNo(dest, src)` =
`atan8(src→dest)` (`Soldier_Control.cc:6334-6376`): `θ = atan2(−Δy, Δx)` mapped to `[0, 2π)` (`M_PI`, not the
`PI` literal), `idx = (int)((8θ+π)/(2π)) % 8` into `[E, NE, N, NW, W, SW, S, SE]`; `Δ = 0` → EAST. Integer deltas never
fall on a sector boundary (tan 22.5° is irrational), so `Math.atan2` is safe **(inferred)**. ja2-node: grid helpers in
`src/content/world/grid.ts`, direction helpers in `src/sim/tactical/directions.ts` (`QuickestDirection` =
`quickestTurnIncrement`), `directionToward` in `movement.ts`, `atan8` in `perception/opp.ts`.

---

## 6. Fences and roofs (movement-level only)

- **Fence hop**: path contains `A → F → B` with `cost[F][d] == FENCE`. At A's centre `HandleGotoNewGridNo` checks
  `EnoughPoints(6 AP, 200 BP)`, `HandleNextTile(B)`, then `ubPathIndex++`, `SoldierGotoStationaryStance`,
  `BeginSoldierClimbFence` (picks the fence direction with fewest turns via `FindFenceJumpDirection`, not the path
  direction; `Soldier_Control.cc:5220-5232`, `Isometric_Utils.cc:613-664`), `fContinueMoveAfterStanceChange = 2`
  (`Overhead.cc:1290-1329`). After turning, `HOPFENCE` starts (stand height required, so a crouched mover first plays
  `KNEEL_UP`, `AP_CROUCH`); 6 AP / 200 BP charged at its start; 18 frames × 50 ms; opcode 444 moves to the forecast
  tile B, turns the facing by +2, sets off mines (`Soldier_Ani.cc:517-559`); 499 then does `ubPathIndex++` and restarts
  `usUIMovementMode` (`:1876-1907`). The landing step's cost is never charged. HOPFENCE ends crouched, so walking on
  costs `KNEEL_UP` (that is the `+AP_CROUCH` in `PlotPath`). Non-merc bodies never path over fences.
- **Roofs**: `FindBestPath` never changes level. Level-1 costs are FLAT/OBSTACLE per tile (§2.4). Climbing is a separate
  action: `FindHigherLevel` (ground, no roof overhead, cardinal neighbour with `NORMAL_ROOF` and free at level 1, fewest
  turns; `Isometric_Utils.cc:446-479`) → `CLIMBUPROOF`, 10 AP + stance to stand, 500 BP, 44 × 30 ms, commit at 408;
  `FindLowerLevel` → `CLIMBDOWNROOF`, 6 AP + stance to crouch, 250 BP (`Points.cc:1648-1660`,
  `Soldier_Control.cc:1574-1588, 5188-5202, 6202-6216`). Global sight is disabled during both (`01` §3.5).
- ja2-node: fence hop in `animation.ts` (`beginSoldierClimbFence`, `findFenceJumpDirection`), roof climbing in
  `roofs.ts`; jumping over a prone soldier (`jump-over.ts`) and window climbing (`player-orders.ts`) are separate actions.

---

## 7. Implementation in ja2-node

**Content** (`src/content/`; `loadTacticalWorld` / `buildTacticalWorld` in `world/tactical-world.ts` build it per
sector): `formats/jsd.ts` (§1.1); `world/tile-database.ts` (tile elements, terrain per tile type, shore override,
`fixDoubleDoors`); `world/structures.ts` (`WorldStructures`: per-tile lists in add order, IDs from
`INVALID_STRUCTURE_ID + 2`, `okayToAdd` = §1.3, `add`, `remove`, `find`, `findBase`); `world/placement.ts` (§1.2);
`world/movement-costs.ts` (`MovementCosts`, a `Uint8Array` indexed `[g][dir][level]` with `raise` = SET and
`force` = FORCE; the compile functions of §2; door rules from `data/tables/door-costs.json`).

**State**: `TacticalState.world` (`costs`, `structures`, `terrain`, `level`, `mapDoors`), `occupant` (`WhoIsThere2`),
`reserved` (RT reservations), `mercSlots` (pass order) and the movement fields of `Soldier` (§5). Door swaps
(`doors.ts`, `doors/`, `35`), explosions and map changes recompile costs locally.

**Simulation** (`src/sim/tactical/`):

| Module | Responsibility |
|---|---|
| `pathfinding.ts` | `findBestPath` (§3.2–§3.5, including `COPYREACHABLE(_AND_APS)` with the AI cost window `AI_PATHCOST_RADIUS` 9), `newOKDestination(AndDirection)`, `isDestinationBlocked`; `PathEnv` bundles the world, `whoIsThere` and door statuses |
| `multi-tile.ts`, `person-structure.ts` | Animation structure files, `Soldier.multiTile`, person structures, `okToAddMercToWorld` (§1.6, §3.3) |
| `points.ts`, `plot-path.ts` | The AP/BP functions of §3.6 (`doorTravelCost` = `InternalDoorTravelCost`); `plotPathSteps` = `PlotPath`; the AI's `EstimatePlotPath` is `estimatePlotPathCost` (`ai/utils.ts`) |
| `movement.ts` | The walking protocol of §4.1–§4.7 |
| `overhead.ts` | `executeOverhead`: one soldier pass per 5 ms tick in `mercSlots` order (§4.3) |
| `animation.ts`, `movement-mode.ts` | `initNewSoldierAnim`, `turnSoldier`, frame timers, the fence hop; mode by stance |

Verification: the oracle probes `costs` (the whole table, byte by byte), `path` (length, directions, `PlotPath` AP
cost) and the creature AI probes (multi-tile, continuous turn) match the native build (`tools/oracle/README.md`). Gaps
are marked "not in ja2-node" / "not ported" where the rule is described (§1.5, §3.2, §4.3, §4.4, §4.5, §4.7).
