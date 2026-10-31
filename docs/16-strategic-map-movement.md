# 16 — The strategic map: sectors, groups, travel, encounters and sector transitions

The country map and what moves on it, from a planned route to the loaded sector and back: sector records and flags,
groups and squads, routes and travel time, arrivals and the battle check up to the pre-battle hand-off, entering,
leaving and unloading a tactical sector, what a sector keeps while unloaded, enemies placed from strategic counts,
sector control, airspace and the player's knowledge of enemies. Siblings: `15` clock, compression and the event queue;
`17` the Queen, garrisons, patrols and `PrepareEnemyForSectorBattle`; `18` militia, loyalty, mines and assignments;
`19` the pre-battle interface, retreat and autoresolve; `25` the helicopter; `35` NPC presence on sector entry; `07`
tactical pathing; `14` the savegame reader; `29` route and sector commands, prompts and the strategic view. Each
module's `@src` header names the Stracciatella functions it ports; read those for the formulas and the order of steps.

## 1. Where things live

Paths are under `src/sim/`; `forces/` and `map/` are under `strategic/`.

```
route: plot, confirm                                forces/routes.ts, forces/move-permission.ts, forces/move-box.ts
  merc path → waypoints at the pivots → departure   forces/movement.ts, map/travel.ts, map/pathing.ts
GROUP_ARRIVAL → groupArrivedAtSector                forces/movement.ts
  ├ queued 3–5 minutes while another battle runs
  ├ battle check, simultaneous arrivals, bloodcats  forces/encounters.ts
  │  └ hand-off record encounter.preBattle → PBI    forces/pre-battle.ts, then 19
  └ quiet arrival: control, next leg, NPC-of-note   forces/movement.ts, map/control.ts, forces/npcs-of-note.ts
map, PBI, game start, load → setCurrentWorldSector  campaign/sector-flow.ts (SectorFlow)
  sector diff restored                              campaign/sector-diff.ts
  soldiers placed                                   tactical/init-list.ts, tactical/insertion.ts
exitSector → exit check, exit menu, adjacent jump   campaign/sector-exits.ts
  walk off the edge or to the exit grid, walk in    tactical/sector-exit.ts, tactical/edgepoints.ts
  └ up to 5 minutes: warp and load; else the group travels and the world unloads
```

| Module | Holds |
|---|---|
| `src/content/strategic/` | Sector ids and map file names (`sector-ids.ts`), the map file of a sector (`sector-maps.ts`), the externalized tables (`map-tables.ts`, `policy.ts`, `travel-table.ts`, `strategic-content.ts`) |
| `strategic/map/` | Sector and map-element records, flags and their side effects (`sectors.ts`), new-campaign init (`init.ts`), edge times and ETAs (`travel.ts`), routes (`pathing.ts`), control and airspace (`control.ts`, `sam.ts`), the player's knowledge of enemies (`knowledge.ts`), the native save sections (`save-import.ts`) |
| `strategic/forces/` | Groups and counting helpers (`groups.ts`), squads (`squads.ts`), movement and arrival (`movement.ts`), the NPC-of-note test (`npcs-of-note.ts`), the battle check (`encounters.ts`), the PBI side (`pre-battle.ts`), vehicles and the helicopter, the ports (`ports.ts`, `context.ts`), flow state outside the native save (`flow-state.ts`) |
| `campaign/sector-flow.ts` | `SectorFlow`: loading, entering, placing and unloading the tactical sector, reinforcements into it |
| `campaign/sector-exits.ts`, `tactical/sector-exit.ts` | Leaving a sector: the strategic half (exit check, menu, jump, traversal) and the tactical half (walk-off, walk-in, mirror gridno, the merc wait) |
| `campaign/sector-diff.ts`, `campaign/sector-loot.ts` | What a sector keeps while unloaded; writing into unloaded sectors |
| `tactical/edgepoints.ts`, `tactical/insertion.ts`, `tactical/init-list.ts`, `strategic/ai/defence-placement.ts` | Edgepoints, placing our soldiers, the soldier init list, enemies from strategic counts |

## 2. Design

**Plain state, ports for the rest.** `StrategicState` holds the original's globals as plain data (`map`, `forces`,
`movement`, `encounter`, `sectorDiffs`). Strategic code reaches soldiers, the strategic AI and the loaded world only
through the ports of `StrategicContext` (`forces/ports.ts`), whose defaults answer false or do nothing, so the
strategic layer runs and is tested without a tactical sector. `CampaignSim` layers the real `TacticalWorldPort`:
economy, laptop, helicopter, narrative and the sector flow.

**List order is behaviour.** `forces.groups` keeps the original list order, and every scan over groups depends on it:
releasing simultaneous arrivals, the enemy groups placed into a battle, the battle check's choice of the group that
speaks. A new group takes the lowest free id and goes to the end. Squad group ids therefore depend on how many patrol
groups the AI created first: address squads by index, never by group id.

**Three sector forms.** Byte ids (sector records, diffs), strategic indices on an 18×18 grid with a border (map
elements, routes, merc paths) and `{x, y, z}` (groups, soldiers); conversions in `sector-ids.ts`. Byte id 255 (P16,
edge of the world) doubles as "no previous sector".

**Paths and waypoints.** The player plans paths of strategic indices, stored on every member and on the vehicle; the
group moves along waypoints rebuilt from the path at its pivots, and each arrival drops the path's head. A route is one
command, not cursor clicks (deviations "Map route plotting", "Move box regrouping").

**Minutes and events.** Strategic times are world minutes and an arrival is a `GROUP_ARRIVAL` event, so groups arriving
in the same second resolve in the queue's order. `GROUP_ABOUT_TO_ARRIVE` is posted and does nothing: the original only
redraws the map and autosaves there, and the event keeps the queue equal to a native save's.

**Prompts are records.** "Coordinate a simultaneous arrival?", the NPC-of-note box and the pre-battle hand-off are
state records (`encounter.simultaneousArrival`, `movement.groupPrompting`, `encounter.preBattle`) answered by
commands; informational boxes before the PBI close at once (deviations "Strategic prompts", "Pre-battle interface").
The hand-off lists the speaker candidates instead of drawing one (deviation "Cosmetic draws in strategic movement").

**One loaded sector, the rest as diffs.** The campaign keeps one `SectorDiff` per sector instead of the temp files
(deviation "Sector temp files"); a null member is a missing file and the `SF_*_TEMP_FILE_EXISTS` flags mirror them. Our
mercs live in the campaign roster across loads and strategic code sees them as `StrategicMerc` through `MercPort`,
which hands a squad join's soldier side (waking him, stamping the assignment change) to the economy; non-player
soldiers are created when a sector loads and dropped when it unloads, as `TrashWorld` does. The loaded
sector's `TacticalSim` shares the campaign's random streams, profiles, key table and clocks, and reports deaths,
map-edge escapes, pending enemies, the end of the merc wait and of the battle back through `TacticalState.sectorHooks`.

**Entering and leaving are commands.** Map screen and tactical are views, not simulation steps (deviation "Map and
tactical screens"); the only gate to entering a sector is `SectorFlow.enterSectorRefusal`. There is no placement GUI:
entering from the PBI uses the automatic start (deviation "Tactical placement"). `exitSector` evaluates the exit check
and the exit menu's rules and refuses a choice the menu would not offer (deviation "Exit dialog"); the client's exit
hint runs the same check over the player's knowledge (`src/sim/hints/exit-sector.ts`, D16). The merc wait counts 2500
game ms (deviation "Waiting for mercs to exit"). The lair's "Travel to surface?" question is `exitSector` with `warp`,
offered through the view because which lair was destroyed is hidden state (`surfaceWarp`,
`strategic/creatures/creatures.ts`).

**Edgepoints are generated where the map has none.** Original maps load their saved edgepoints; stub maps carry none,
so they always run the generator, which is ported literally and matched against the oracle.

**Knowledge without side effects for the view.** `whatPlayerKnowsAboutEnemiesInSector` clears the Skyrider flag of a
sector he no longer flies over, as the original does while drawing the map. Gameplay callers use it; the player view
uses `surfaceKnowledgeOfEnemies` and `peekPlayerKnowledgeOfEnemies` (`map/knowledge.ts`), which answer the same
without the write.

**Runs on stubs.** The externalized tables ship unchanged in `data/externalized`, and the tables that exist only in
C are transcribed to `data/tables/strategic-travel.json` and `sector-facilities.json`, so the whole strategic layer
runs in CI. `sectorMapPath` takes the original map, else the stub pack's map of the sector, hand-made or a kind map
(`stubs/maps/sector-kinds.json`), else `wilderness.dat` (`32`). The stub map keys of this domain are `entry`, `exit`,
`scroll` and `optional` on `soldier:` lines (`src/content/formats/stub-map.ts`).

**Randomness.** Gameplay draws keep the original order on `main` and `pre` (`01` §3.6), including draws whose result
ja2-node does not use: the creature tense-quote delay and the crow count at every sector load. Speaker picks are not
drawn, and the bloodcat lair corpses face a draw of the `movement` cosmetic stream (deviation "Cosmetic draws in
strategic movement").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests:

| Quirk | Test |
|---|---|
| A group that left a sector still counts there for the enemy count, and the garrison count ignores z: an underground arrival sees the surface garrison | `strategic/forces/groups.test.ts` |
| An enemy group's size is troops + elites; admins never count | `strategic/forces/groups.test.ts` |
| A cancelled move returns in the time already travelled; a 90° replan while moving is a reversal | `strategic/forces/movement.test.ts` |
| A new waypoint resets every member's insertion code to 0 (north), forgetting the edge-index entry of a tactical traversal | `strategic/forces/movement.test.ts` |
| Travel asks for a strength gain even when the leg earns zero points; health needs at least one | `strategic/forces/movement.test.ts` |
| Every arrival that does not end quietly (a battle, a prompt, no battle check) takes a battle off the Queen's alert, so each group pulled into a battle counts too | `strategic/forces/movement.test.ts` |
| The ETA ignores the current waypoint index, and an impossible edge adds −1 minute | `strategic/map/travel.test.ts` |
| Shift's direct route flattens every edge to 60 minutes, the helicopter's airspace costs included | `strategic/map/pathing.test.ts` |
| A bloodcat first visit that fails its roll stays undecided and rolls again next time; a sector with no cats left still rolls `PreChance(95)` | `strategic/forces/encounters.test.ts` |
| The enemy takes a sector while our mercs are still in it, so the later call, once they left, never counts the loss | `strategic/map/control.test.ts` |
| The underground traversal flag is never lowered: after the first underground edge, every tactical traversal arrives after 1 minute while the clock still warps 5 | `campaign/sector-flow.test.ts` |
| The defence placement's first pass looks at every other node (Stracciatella); the init-list sort reverses each class | `strategic/ai/queen-command.test.ts` |
| One NPC in a wilderness sector who was ever spoken to, recruited or escorted silences the NPC-of-note box for every unmet NPC there | `strategic/forces/npcs-of-note.test.ts` |
| A bloodcat lair's corpses carry profile 0 from their zeroed definition, and in the first two days of a campaign their unsigned time of death wraps, still two days back for the rot | `campaign/sector-loot.test.ts` |
| An arriving creature faces the first direction its body fits on the tile it found (north on open ground), whatever its insertion direction, a forced one too: the facing a creature attack sets per edge is never used | `tactical/insertion.test.ts` |

Not pinned yet:
- The exit check of a merc away from the edge applies the underground rule from the second level only (`z > 1`): on a
  first basement level such a merc makes every edge impossible (`exitTraverseTime`).
- Only leaving a hostile sector through an exit grid, before combat started there, flags the group for the 90% ambush
  (`handlePotentialMoraleHitForSkimmingSectors`).
- `AllMercsWalkedToExitGrid` passes the target sector to the retreat loyalty check, after the group already stands
  there.
- A vehicle's riders always take the travel insertion code; walkers keep an edge-index code.
- Soldiers other than creatures face the map centre on entry: the insertion direction set on arrival is ignored, only a
  forced one (100 and up) counts (`addSoldierToSector`).
- A preserved enemy file is checked against the stationary counts only, so any underground file mismatches; each saved
  soldier starts on his current tile or his placement's by `PreRandom(2)`; restored civilians prune the init list by
  the last record's team.
- `NotifyPlayerOfInvasionByEnemyForces` opens the PBI only for town and SAM sectors; elsewhere a message and nothing
  follows (believed unreachable: militia only live there).
- `ExamineDoorsOnEnteringSector` never closes a door: `SetCurrentWorldSector` sets the stamp it compares just before
  the call (`StrategicMap.cc:499,509`); not ported (`35`).
- Adding a merc to a squad drops the squad group's waypoints (`SetGroupSectorValue`), harmless as a moving squad refuses
  new members.

## 4. Not checked against the native build

The oracle matches the travel table, routes including tactical traversals, the groups, squads and sector records of
native saves, edgepoints, exit thresholds, walking off and in, the mirror gridno, `OKForSectorExit`, the init list and
the defence placement (`tools/oracle/README.md`, "Strategic movement" and "Sector transitions"). Inferred from reading
the source:
- Mobile enemies that reached a sector after the player left appear twice when its preserved enemy file is restored:
  the file is accepted only against the stationary counts, the load adds the mobile strength, and
  `PrepareEnemyForSectorBattle` adds the same groups again. Check: save beside an enemy sector, let a patrol enter it,
  re-enter, count the enemy team.
- What the stuck underground flag does to the event order depends on what else is queued in those minutes.
- `CalculateTravelTimeOfGroup` starting at waypoint 0 is harmless for one-way player groups.
- The helicopter arrival clamp never bites: only a delay longer than its 10-minute edge could, and a queued battle
  waits 3–5 minutes (deviation "Helicopter arrival clamp").
- Whether any original map lacks saved edgepoints, so that the generator runs on original data.
- Not probed: strategic advance with replayed draws (enemy sleep, queued battles and reversals in one run), and player
  ETAs with encumbrance unless every member is in the loaded sector.

Not ported: gaps "Strategic move refusals", "Vehicles as characters", "Ground vehicles",
"Helicopter on the map", "Creature quest scripting", "Corpses", "Savegame import". Other
deviations of this domain: "Underground traversal flag", "Insertion data in the loaded sector", "Strategic hints and
enemy counts", "Sandbox population", "Difficulty and progress in tactical", "Map changes of the loaded sector on
import", "Strategic AI PD placement pass", "Cosmetic draws of the helicopter".
