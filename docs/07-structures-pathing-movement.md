# 07 — Structures, movement costs, pathfinding and walking

From a map's structure layers to a soldier standing on his final tile: structure instances and their collision rules,
the movement cost table, the path search, the AP and breath of a step and of a path, and the walking protocol in real
time and turn-based mode. Siblings: `05` map layers and the render bounds; `06` animation states, opcodes and speeds;
`08` sight, noise and line of sight over the same structures; `10` turns, AP deduction and interrupts; `12` wrecked
structures; `13` the AI's budgeted searches and multi-tile creatures; `16` edgepoints and leaving the sector; `35` door
actions, locks and keys. Each module's `@src` header names the Stracciatella functions it ports; read those for the
formulas and the order of steps.

## 1. The path of a move

Paths are under `src/content/` (`world/`, `formats/`) and `src/sim/tactical/` (bare names).

```
map load: struct, roof, on-roof layers → structures       world/placement.ts, world/structures.ts, formats/jsd.ts
  terrain per tile, then the whole cost table             world/terrain.ts, world/movement-costs.ts
  door swap, wrecked structure, map change → recompile    world/movement-costs.ts recompileLocalMovementCosts
order → getNewSoldierPath → findBestPath (30 steps)        movement.ts, pathfinding.ts
  first step: initNewSoldierAnim → handleGotoNewGridNo     animation.ts, movement.ts
every 5 ms tick: executeOverhead, soldiers in mercSlots     overhead.ts
  frame → moveMerc (float32) → tile switch at half step   movement.ts setSoldierGridNo
  past the centre: handleAtNewGridNo                      movement.ts, hooks in perception/wiring.ts
    final tile: arriveAtFinalDestination
    route used up: pathExhausted plans again from here
    else handleGotoNewGridNo: fence, door, next tile clear?, reservation, APs paid, next destination
  blocked: delayed waiting, handleNextTileWaiting every 700 ms
```

| Module | Holds |
|---|---|
| `formats/jsd.ts`, `world/tile-database.ts` | Structure files, tile elements, terrain per tile type, the double-door fix of the tile database |
| `world/structures.ts`, `world/placement.ts` | `WorldStructures`: per-tile lists, ids, `okayToAdd` (the collision rules), `find`; placing the map's layers |
| `world/movement-costs.ts`, `world/terrain.ts` | `MovementCosts` (`[gridNo][direction][level]`, `raise` = SET, `force` = FORCE), terrain ids, compile and local recompile; door rules from `data/tables/door-costs.json` |
| `world/render-bounds.ts`, `world/grid.ts` | The visible area of a map's scroll restriction; grid and direction helpers |
| `pathfinding.ts` | `findBestPath` with `PathEnv` and `PathOptions`, destination tests, door resolution |
| `multi-tile.ts`, `person-structure.ts` | Animation structure files, `Soldier.multiTile`, the person structure of a soldier |
| `sweet-spots.ts` | The original's searches for a free tile near a sweet spot: a dummy soldier's reachability flood, then the closest candidate (plain, through people, with a structure fit, excluding the spot) |
| `points.ts`, `plot-path.ts`, `ai/utils.ts` | AP and breath of a step (`actionPointCost`, `terrainBreathPoints`), of a path (`plotPathSteps` = `PlotPath`), the AI's estimates |
| `movement.ts`, `overhead.ts` | The walking protocol: path orders, the tile step, blocking, reservations, waiting, stopping; the per-tick pass |
| `falls.ts`, `forgetful.ts`, `swimming.ts`, `sneak-past.ts` | What a step may bring: marbles and falls, the FORGETFUL stop, water, the sneaking agility gain |
| `teleport.ts` | A teleport with its look and roof reveal; the swap of two soldiers |
| `animation.ts`, `roofs.ts`, `jump-over.ts` | Turning, the fence hop; climbing roofs and jumping over a prone soldier, separate actions |

## 2. Design

**One cost table, compiled in order.** `MovementCosts` is the cost of entering a tile in a direction on a level. A
tile's structures write costs onto neighbours with raise-only or overwrite semantics, so `compileWorldMovementCosts`
runs over all gridnos in ascending order: the fence landing costs and the sandbag hops come out of that order. Local
recompiles (doors, explosions, map changes, the statue) reuse the same function. The oracle's `costs` probe compares the
whole table of A9 byte by byte.

**Structures in list order.** Each tile keeps its structures in the order they were added; `find` returns the first
match, and line of sight walks the same lists (`08`). A structure's cube offset puts it on the ground or on the roof.
A struct-layer node whose structure is rejected (overlapping obstacles in a few maps) loses its graphic as well, as in
the original loader; a rejection on a roof layer throws. Soldiers own a person structure built from their animation's
structure file for the current facing (multi-tile checks, sight); `TacticalState.occupant` answers who stands where,
and `whoIsThere` (`src/sim/tactical/state.ts`) also finds a soldier on every other tile of his body that is not
passable, as `WhoIsThere2` does (`TileEngine/WorldMan.cc:1479-1501`): paths, destinations and the next-tile test keep
off a fallen soldier's legs, where a soldier could not turn (`movement.test.ts`, "a tile under the body of another
soldier"). Person structures never add movement costs.

**The visible area.** `gridNoOnVisibleWorldTile` tests the render bounds of the map's scroll restriction, so basements
have a smaller area. It gates the cost table (outside is off-map on both levels), terrain ids, destinations, who stands
where, placing a soldier, bullets and thrown objects. `isVisibleTile` is the closed form of the surface area, used only
where the original has no test: agent API gridno validation and the insertion guard.

**The path search.** It orders by travel cost, never by AP, so walking, running and crawling find the same path; the
mode matters for an AI budget, multi-tile structures and the AP total. Globals of the original are per-call options. A
heap pops in the original's skip-list order without its draws (deviation "Pathfinder RNG"). The pool of 1022 open nodes
and the trail limit are kept, so long searches fail where the original's do; reachability floods pass the larger limit
the original configures for them. Paths hold 30 steps, and a long walk plans again every 30 tiles. A step onto a tile
its side knows to hold a mine is skipped: the friendly side keeps off the player's mine flag, which our team may end its
path on, the others off the enemy's (`12` §6). Players path with the perceived door state and never through a closed
door; others go through a closed door that is unlocked, has no record in the map's door table or opens with their keys.
A door changed out of the squad's sight keeps its perceived state until a merc sees it, and after a load the structure
others path through may follow that state until then (`35`). The oracle's `path` probe compares length, directions and
the `PlotPath` AP cost for A9 and the save fighters.

**Paying at the centre.** A step's APs and breath are paid at the tile centre before leaving it; real time charges no
APs and 1.25 × breath. An interrupt, a sighting on the enemy's turn or a lack of APs freezes a moving animation with
`noAPToFinishMove` until the next order or turn (`10`). Tile reservations exist only in real time.

**The tick loop is the walk.** One pass over `mercSlots` per 5 ms tick; slot order decides real-time races for tiles.
The slots list the soldiers in the order they entered the sector, and the pass walks them by index, reading their number
at every step: a soldier who leaves during the pass skips the one after him, one who enters is handled at once (`01`
§3.10). Positions are float32 as in the original (`MOVE_SIN_COS` holds glibc's values for the original's `PI`), and the
occupied tile switches when the position crosses into the next tile, so a diagonal step never occupies a side tile.
There is no snap to the centre: arrival logic runs on the frame after the position passes the tile centre, and the next
step starts from the overshot position.

**No turn before a step.** The facing turns one octant per frame while the soldier already moves; turning APs are never
charged while walking. Sight at each arrival uses the facing of that moment.

**The arrival on a tile.** `handleAtNewGridNo` (`movement.ts`, `Tactical/Overhead.cc:1709`) keeps the original's early
returns before noise and sight: while any squad walks off the map or to an exit grid, every soldier's arrival stops there,
the enemies' too, so walkers make no noise and nobody looks; a soldier at 0 breath is marked to collapse and walks on
until his animation lets him; a mine or pressure item under him goes into the bomb queue, and if it is an explosive he
stops (`12` §6). The landing behind a jumped fence sets off the mines of its tile as well (code 444). Every soldier
checks the tile ahead for a mine before each step, and the tiles around after the arrival's sight; one who notices a
mine stops (`bombs/mine-detection.ts`, `12` §6).

**Falls.** From the second step of a move, after the gas check, a soldier on a floor or road tile of the ground level
that holds marbles (any of the pool's items, hidden ones too) slips: the marbles are gone, he collapses and loses some
APs (`Tactical/Overhead.cc:1477`). Otherwise a blinded runner and then a soldier who is DRUNK (`12` §5) may trip over
(`tripsAndFalls`, `falls.ts`; `:1499`): he collapses where he stands, loses some APs and the move ends there. The player
hears the curse through `slippedOnMarbles` and `fellDown`, only for our soldiers and those the squad sees (deviation
"Falls out of sight"); the marbles' line is for our mercs alone. With no fall, our FORGETFUL merc counts the step, and
from the third step of a move, once he has walked more than 200 tiles since he last forgot, may stop with his
personality line and some APs lost (`forgetful.ts`, `:1526`).

**Water and the rest of a new tile.** `setSoldierGridNo` (`movement.ts`, `Tactical/Soldier_Control.cc:2005`) updates
the terrain and then, in the original's order, the water (`swimming.ts`: the forced walk, going under and coming up, the
damage of `Tactical/Items.cc:3315`), the gas flag, the sneaking agility gain (`sneak-past.ts`) and the animation speed,
which a merc waiting on a squad mate's tile borrows from him until he stops on his final tile (`setDelayedTileWaiting`).
The original's `fPrevInWater` always equals the water test of the terrain left, so no flag is kept. A move started in
deep water swims, a stop there treads, and a non-swimmer treading or swimming spends breath five times as fast
(`deductPoints`, `points.ts`). A soldier bleeding past 12 drops blood at the middle of each tile
(`handleBloodForNewGridNo`, `combat/bleeding.ts`).

**A soldier in a vehicle.** A merc seated in a ground vehicle (`Soldier.vehicleSeat`, `25`) has no tile of his own:
`setSoldierGridNo` keeps his gridno, gas and sneaking, skips the occupant, the structure, the reservation, the smell and
the water (`Tactical/Soldier_Control.cc:1911`), and never takes the short cut of a soldier already on the tile. Every
position the vehicle is given is given to its passengers too (`Tactical/Vehicles.cc:802`), with no step of their own.

**Randomness.** The path search draws nothing. Walking draws what the ported steps draw: the gas check's
`PreRandom(5)`, the slip's and the falls' `Random(AP)`, the falls' `Random(5)` rolls with the fall itself, the
forgetful merc's `Random(100)` and `Random(AP)`, the trail's `Random(7)` with its drop's `Random(3)`, the water damage's
`PreRandom(100)` per item and `Random(10)` or `Random(20)` for the smell, the sneaking gain's `PreRandom(100)` per
chance, the trap detect level's `PreRandom(3)` of a bleeding or shocked soldier at both mine checks of a step, and the
sight of a soldier a swap moves. The marbles draw nothing before a slip, so the falls keep their draws except on a tile
with marbles.

**Swaps.** The head-on swap of two blocked AI soldiers, the forced swap of a soldier's third wait and the player's
exchange of places all go through `swapMercPositions` (`teleport.ts`): both destinations are tested, and the soldier
swapped first looks and reveals roofs as a teleport does.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/content/` and `src/sim/tactical/`:

| Quirk | Test |
|---|---|
| Landing north or west of a fence is free, south or east costs terrain: the later tile's own terrain raises the forced 0 | `world/movement-costs.test.ts` |
| A local recompile clears one column and row less on the east and south than it recompiles, so costs of a removed structure stay there | `world/movement-costs.test.ts` |
| A structure file keeps only the low byte of its hit points (more than 650 filled cubes wrap) | `formats/jsd.test.ts` |
| The search ends when the destination heads the open list and the last step costs 0, so a dearer path can win | `pathfinding.test.ts` |
| The player's path goes around soldiers he cannot see, while his destination test ignores them | `pathfinding.test.ts` |
| An AI budget gives a walker one AP back on the free landing tile behind a fence (`0 + WALKCOST` wraps in `UINT8`) | `pathfinding.test.ts` |
| A roof step's breath comes from the ground costs under the roof | `points.test.ts` |
| A mover arrives twice at the tile where his 30-step route runs out: noise and sight run twice | `movement.test.ts` |
| Two soldiers swapped head-on both stop: the new positions reset their final destinations before they re-path | `movement.test.ts` |
| The soldier swapped second neither looks nor reveals roofs: his teleport fails the destination test on the tile he was just put on | `movement.test.ts` |
| A merc swapped at his third wait in auto-bandage stands with no final destination: the swap resets the tile his route search heads for, and the path order takes the absolute destination, `NOWHERE` | `movement.test.ts` |
| A waiting soldier with no route around his blocker tests the first step of the route through him again (the search leaves `guiPathingData` as it was) | `movement.test.ts` |
| A multi-tile soldier blocked head-on leaves the other blocked, with his final destination on his own tile | `movement.test.ts` |
| A sweet spot search floods as a merc-bodied dummy whoever searches, so a crow's spot may lie in water | `sweet-spots.test.ts` |
| The tiles moved since a turn began count in a signed byte: the 128th wraps the count to −128, which camouflage, bleeding and the moving-target penalty read | `movement.test.ts` |
| A creature that cannot turn pays the step where it starts backwards twice, the second time with the reverse surcharge: the forced backward walk takes the step again | `movement.test.ts` |
| A creature that cannot turn at the first step of a move goes backwards in the walk it set out in: the move's own state overwrites the backward walk | `movement.test.ts` |
| A creature that can turn again clears its reverse but walks on, facing its path, in the backward walk | `movement.test.ts` |
| A soldier who leaves the sector during a pass makes the one after him miss that pass: the merc slots close up under the pass's index | `merc-slots.test.ts` |
| A soldier moved one tile at a time never trips: the falls skip the first step of a move | `falls.test.ts` "rolls for neither fall on the first step …" |
| A fall is rolled before its room is tested, on the tile the soldier faces, not the next of his path: where the path turns, a soldier on the faced tile keeps him up after the roll | `falls.test.ts` "tests for room to fall after the roll …" |
| Hidden marbles trip a walker as well: the slip searches the whole pool | `falls.test.ts` "slips on hidden marbles too …" |
| A forgetful merc moved one tile at a time never forgets: the count skips the first step of every move | `forgetful.test.ts` "counts the steps of a move from the second …" |
| The forget die is rolled on every step from the third, before the count is tested, so it draws while the merc cannot forget | `forgetful.test.ts` "rolls Random(100) on every step from the third …" |
| A merc who waited on a squad mate keeps the mate's speed after he arrives, so he breathes at the mate's pace until a stop on his final tile clears it | `movement.test.ts` "keeps the mate's speed once he arrives …" |
| A soldier who goes under mid-step takes that step again from the tile he entered (his swim starts as a new move), so on a diagonal he swims a tile off his path and plans again; coming up does the same | `swimming.test.ts` "takes the step he went under on again …" |
| Our merc may end a path on a tile marked for the player as holding a mine, though no path of his passes one; a militia soldier may not even end there | `pathfinding.test.ts` "keeps our merc off a tile with the player mine flag …", "keeps the rest of the friendly side off the tile …" |
| The dummy soldier of a reachability flood is on the friendly side whatever its team, so the floods for sweet spots, edgepoints and items keep off the player's marked mines, never the enemy's | `pathfinding.test.ts` "floods a dummy soldier around the player mine flag …" |
| A passenger has no tile to stay on, so `setSoldierGridNo` never short-cuts for him: each placement of his vehicle, on its own tile too, tests his gas again; he leaves no smell and counts no step | `vehicle-passengers.test.ts` "tests his tile's gas again …", "leaves no smell …", "takes no step …" |

Not pinned yet:
- The origin is never marked visited, and a stale open-list node is expanded again in seven directions; both count
  against the pool and trail limits.
- A door step marked during an AI budget search stays marked when a later check skips the step, and the next direction
  pays the door.
- A door-coded step whose door is gone costs only the stealth and reverse APs: `InternalDoorTravelCost` returns the code
  unchanged and `TerrainActionPoints` has no case for it.
- The AI's `EstimatePlotPath` ignores people only for multi-tile bodies, despite its comment.
- Opcode 402 never pauses a move: `pausedMove` is cleared before the frame's step is taken.
- A swap tests both destinations on the ground level, also for soldiers on a roof (`Tactical/Soldier_Tile.cc:655`).

## 4. Not checked against the native build

The oracle covers the cost table, paths and their AP cost, multi-tile creature paths (`13`), edgepoints and walking off
the map (`16`). The walking protocol itself (frames per tile, reservations, waiting, swaps, re-planning, the falls, the
marbles, the forgetful stop, swimming and the follower's speed) is not probed.
Inferred from reading the source:
- No shipped map has a structure on the array border, where the original's neighbour writes would wrap or overflow;
  `MovementCosts` drops writes outside the map and keeps the row wrap.
- The roof and on-roof layers never reject a structure in shipped data.
- `Math.atan2` gives the original's direction between tiles: integer deltas never fall on a sector boundary.
- A stale node's re-expansion never finds a cheaper cost outside an AI budget.

Not ported: gaps "Doors", "Unseen soldiers in combat".
Other deviations of this domain: "Recalculated path cost", "AI path-cost cache", "Multi-tile turning", "Creature and
bloodcat stub bodies", "Frame timers", "Continue a move", "Insertion data in the loaded sector".
