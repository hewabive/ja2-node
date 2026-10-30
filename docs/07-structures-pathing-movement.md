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
structure file for the current facing (multi-tile checks, sight); `TacticalState.occupant` answers who stands where.
Person structures never add movement costs.

**The visible area.** `gridNoOnVisibleWorldTile` tests the render bounds of the map's scroll restriction, so basements
have a smaller area. It gates the cost table (outside is off-map on both levels), terrain ids, destinations, who stands
where, placing a soldier, bullets and thrown objects. `isVisibleTile` is the closed form of the surface area, used only
where the original has no test: agent API gridno validation and the insertion guard.

**The path search.** It orders by travel cost, never by AP, so walking, running and crawling find the same path; the
mode matters for an AI budget, multi-tile structures and the AP total. Globals of the original are per-call options. A
heap pops in the original's skip-list order without its draws (deviation "Pathfinder RNG"). The pool of 1022 open nodes
and the trail limit are kept, so long searches fail where the original's do; reachability floods pass the larger limit
the original configures for them. Paths hold 30 steps, and a long walk plans again every 30 tiles. Players path with the
perceived door state and never through a closed door; others go through a closed door that is unlocked, has no record
in the map's door table or opens with their keys (perceived state = real state, gaps "Doors"). The oracle's `path`
probe compares length, directions and the `PlotPath` AP cost for A9 and the save fighters.

**Paying at the centre.** A step's APs and breath are paid at the tile centre before leaving it; real time charges no
APs and 1.25 × breath. An interrupt, a sighting on the enemy's turn or a lack of APs freezes a moving animation with
`noAPToFinishMove` until the next order or turn (`10`). Tile reservations exist only in real time.

**The tick loop is the walk.** One pass over `mercSlots` per 5 ms tick; slot order decides real-time races for tiles.
Positions are float32 as in the original (`MOVE_SIN_COS` holds glibc's values for the original's `PI`), and the
occupied tile switches when the position crosses into the next tile, so a diagonal step never occupies a side tile.
There is no snap to the centre: arrival logic runs on the frame after the position passes the tile centre, and the
next step starts from the overshot position.

**No turn before a step.** The facing turns one octant per frame while the soldier already moves; turning APs are never
charged while walking. Sight at each arrival uses the facing of that moment.

**Randomness.** The path search draws nothing. Walking draws only what the ported steps draw (the gas check's
`PreRandom(5)`); the marbles, blind and drunk falls and the forgetful counter are not ported, so their draws do not
happen (gaps "Walking side effects").

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
| A multi-tile soldier blocked head-on leaves the other blocked, with his final destination on his own tile | `movement.test.ts` |
| A sweet spot search floods as a merc-bodied dummy whoever searches, so a crow's spot may lie in water | `sweet-spots.test.ts` |
| The tiles moved since a turn began count in a signed byte: the 128th wraps the count to −128, which camouflage, bleeding and the moving-target penalty read | `movement.test.ts` |

Not pinned yet:
- The origin is never marked visited, and a stale open-list node is expanded again in seven directions; both count
  against the pool and trail limits.
- A door step marked during an AI budget search stays marked when a later check skips the step, and the next direction
  pays the door.
- A door-coded step whose door is gone costs only the stealth and reverse APs: `InternalDoorTravelCost` returns the code
  unchanged and `TerrainActionPoints` has no case for it.
- The AI's `EstimatePlotPath` ignores people only for multi-tile bodies, despite its comment.
- Opcode 402 never pauses a move: `pausedMove` is cleared before the frame's step is taken.

## 4. Not checked against the native build

The oracle covers the cost table, paths and their AP cost, multi-tile creature paths (`13`), edgepoints and walking off
the map (`16`). The walking protocol itself (frames per tile, reservations, waiting, swaps, re-planning) is not probed.
Inferred from reading the source:
- No shipped map has a structure on the array border, where the original's neighbour writes would wrap or overflow;
  `MovementCosts` drops writes outside the map and keeps the row wrap.
- The roof and on-roof layers never reject a structure in shipped data.
- `Math.atan2` gives the original's direction between tiles: integer deltas never fall on a sector boundary.
- A stale node's re-expansion never finds a cheaper cost outside an AI budget.

Not ported: gaps "Walking side effects", "Walking protocol details", "Mines in the pathfinder", "Doors", "Unseen
soldiers in combat", "Map items". Other deviations of this domain: "Recalculated path cost", "AI path-cost cache",
"Multi-tile turning", "Creature and bloodcat stub bodies", "Frame timers", "Continue a move", "Insertion data in the
loaded sector".
