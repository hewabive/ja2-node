# 35 — NPC actions, presence and schedules

What an NPC action does once dispatched, where NPCs are between sector loads, civilian schedules, civilian groups and
their hostility, and keys, locks and door actions. Siblings: `24` the records and the dispatch (`NPCDoAction`, triggers,
scripted walks, the hostile-quote list, recruiting); `25` facts, quests and the quest rules the actions serve (boxing,
the hospital, Kingpin's money, escorts, the robot, Skyrider); `26` the meanwhile and endgame actions; `15` the event
queue and the hourly and daily updates; `16` sector transitions; `07` doors in pathing; `09` the GREEN decision that
calls the schedule hook; `12` explosions; `23` shop hours; `29` the `door` command and the `npcRequest` prompt. Each
module's `@src` header names the Stracciatella functions it ports; read those for the rules and their order. Data:
action gridnos and amounts in `data/externalized/tactical-npc-action-params.json`, NPC start sectors in
`strategic-map-npc-placements.json`, profile ids, action codes, Larry's items and the schedule actions in
`data/tables/narrative.json`; the lock table (`BINARYDATA/Locks.bin`), map schedules and door tables are the user's
data or the stub pack's (`stubs/locks.json`, `schedule` lines in `stubs/maps/*.map.txt`).

## 1. Where things live

Paths are under `src/sim/`.

```
record action, or a direct call (deaths, the POW release, the wheelchair, the sex item, meanwhiles)
  └ handleNpcDoAction: one action at once            tactical/narrative/npc-actions/catalog.ts
     requestor → npcRequest prompt → answer          npc-actions/requestors.ts, campaign/narrative/npc-action-flow.ts
     timer → NPC system event (27)                   strategic/narrative/npc-events.ts
strategic clock: 04:00, hourly, daily                strategic/narrative/early-morning.ts, hourly.ts, larry.ts
sector entry and exit quest code                     campaign/narrative/narrative-flow.ts
sector load: placement filter, profile insertion     tactical/narrative/placement.ts, profile-insertion.ts
  └ postSchedules: replay the past 24 hours          tactical/narrative/schedules.ts
     event 36 in tactical → the AI walks it          tactical/ai/decide-schedule.ts
sector unload: insertion data and stats to profiles  tactical/narrative/profile-insertion.ts
attack, sight, door, wall → group hostility          tactical/narrative/civ-hostility.ts
door command → menu → animation → handleOpenableStruct  tactical/doors/
```

| Module | Holds |
|---|---|
| `tactical/narrative/npc-actions/` | The catalog: `catalog.ts` dispatches to `generic.ts`, `requestors.ts`, `rebels.ts`, `drassen.ts`, `san-mona.ts`, `cambria.ts`, `south.ts`, `others.ts`, `meanwhile.ts`, `open-thing.ts` (actions 3, 27, 40); `env.ts` is the port it runs on; `codes.ts` the action codes |
| `campaign/narrative/npc-action-flow.ts`, `meanwhile-actions.ts` | `NpcActionFlow`: builds the port, holds the open request, runs the fades, Carmen's timer, boxing and meanwhile actions |
| `strategic/narrative/npc-events.ts` | The NPC system events (event 27): a fact id, or `10000 + action` |
| `strategic/narrative/presence.ts` | Profile sectors (`changeNpcToDifferentSector`), profile items and money, terrorists and assassins |
| `strategic/narrative/early-morning.ts`, `hourly.ts`, `larry.ts`, `profiled-enemies.ts` | The 04:00 moves, the quest hours, progress milestones, Slay leaving, Larry's drinking, the Mike and Iggy upgrade |
| `strategic/map/init.ts` `initNpcPlacements`, `campaign/laptop/aim.ts` `decideActiveTerrorists` | Start sectors of the placed NPCs and the terrorists |
| `campaign/narrative/narrative-flow.ts` | `NarrativeFlow`: events 4, 27, 28, 34, 63, 67, the sector entry and exit quest code, the placement narrative |
| `tactical/narrative/placement.ts`, `profile-insertion.ts` | `AddPlacementToWorld`'s profile filter and quest overrides; adding profiles with insertion data; writing it back at unload |
| `tactical/narrative/schedules.ts`, `schedule-state.ts`, `tactical/ai/decide-schedule.ts`, `tactical/away-slots.ts` | Schedule list, posting, auto-processing, shop hours; the AI hook; civilians off the map |
| `campaign/narrative-port.ts` | The tactical `NarrativePort`: event 36, the schedule clock, event 41 |
| `campaign/sector-flow.ts` | Calls the entry and exit quest code, profile insertion and `postSchedules` at loads and unloads |
| `tactical/narrative/civ-hostility.ts`, `team-change.ts`, `wheelchair.ts`; `strategic/narrative/civ-groups.ts` | `MakeCivHostile`, group changes, the attack and door implications, the brothel wall; `ChangeSoldierTeam`; Slay's kick-out; the saved group states |
| `tactical/doors/` | Door table, keys and key ring, lock attempts, traps, the menu and `handleOpenableStruct`, the `door` command and view; `src/content/formats/locks.ts` reads the lock table |

## 2. Design

**The catalog works on a port.** `handleNpcDoAction(env, npc, code, record)` runs one action at once and touches the
campaign only through `NpcActionEnv` (events, facts, quests, loyalty, mines, boxing, recruiting, the laptop), so it is
tested with a fake environment; `NpcActionFlow` builds the real one. The money and item rules of giving to an NPC are
`24`'s (`narrative/select.ts`).

**Requestors are prompts.** Where the original opens a yes/no box, ja2-node opens an `npcRequest` prompt in the
campaign's prompt slot, inside or outside a talk session, answered with `answer`; the amount shown is computed when it
opens and the open request is saved with the campaign (deviation "NPC requestors"). Requestor quirks: `24`.

**Wall-clock waits become game time.** Carmen's 10 s departure timer counts tactical game time; the fades into and out
of the rebel basement change sector at once; the sex screen's time warp happens at the action (deviations "Carmen's
departure timer", "Rebel basement", "Brothel time warp").

**An NPC between loads is his profile's sector.** Actions, the 04:00 event, hourly handlers, NPC system events and the
sector entry code move profiles, not soldiers; most moves skip an NPC whose sector is loaded, so a visible NPC never
vanishes. A load creates soldiers through the placement filter (profile sector with z, not recruited, alive) and through
profile insertion data; an unload writes a pending walk or traversal back into the profile and the non-player soldiers'
life and stats. The 04:00 event also runs during the new-game warp, so its draws come before the first landing.

**Schedules exist only for the loaded sector.** Every fresh load posts them and replays the past 24 hours at once
(teleporting, never walking), so a civilian ends in the state of his latest entry; on the map screen a schedule event
auto-processes the window since the last event query; in tactical the AI walks the entry. A civilian without a map
schedule gets a default one on the surface (in 07:00–08:00, out 18:00–20:00, two `main` draws) when the map has an
entry point. A civilian who leaves the map goes to the away slots (deviation "Away civilians"); auto-processed door
changes swap the structure at once (deviation "Schedule door changes").

**Saves keep schedules exactly.** ja2-node's own saves keep every schedule, temporary ones included, and its events, and
do not post again (`SectorFlow.reattachLoadedSector`). A native save import posts again without auto-processing, as the
original's load does (`SectorFlow.adoptLoadedSector`): each schedule gets a second event and the unsaved default
schedules are drawn anew (gap "Savegame import").

**Civilian groups are strategic state.** `StrategicState.civGroups` is shared with the loaded sector as
`TacticalState.civGroups`; a created civilian is neutral unless he is the Warden or his group is hostile. Turning
hostile follows Stracciatella (`MakeCivHostile`, `Tactical/Overhead.cc:2591`): only Conrad and the General change side;
everyone else just stops being neutral and keeps his side, where vanilla also set it.

**Doors.** The `door` command returns the menu as data and offers `lock`, which the original's menu lacks; our merc gets
vanilla's menu before closing an open door (deviations "Door menu", "Closing an open door"). A trap check before a menu
action charges the open-door APs where the original reads past its table (deviation "Trap check cost of menu actions").
`ExamineDoorsOnEnteringSector` never fires in the original (the tactical time stamp is set just before it,
`Strategic/StrategicMap.cc:498,509`), so it is not ported.

**Randomness.** Gameplay draws keep the original's statement order on `main` and `pre`. Kingpin's men placed around
Hans' door take two `main` draws, x first, where the original's two engine draws have no defined order (deviation
"Kingpin's men placement"); door creaks and curses are not drawn (deviation "Cosmetic draws of doors").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/` unless a path says
otherwise:

| Quirk | Test |
|---|---|
| Darren pays twice the bet out of his stash without checking it; a stash too small wraps as `UINT32` | `narrative/npc-actions/catalog.test.ts` |
| "Put Pacos in the basement" puts him on A10's ground level | `narrative/npc-actions/catalog.test.ts` |
| Carmen leaving for good falls through to leaving for C13 with its own, absent parameters: the timer is always 10 s | `narrative/npc-actions/catalog.test.ts` |
| Madame's wrong-cash line goes on after "no girls"; advertising Cindy also advertises Bambi | `narrative/npc-actions/catalog.test.ts` |
| The Cambria doctor bonus comes 48 to 71 hours later; Brenda's "one minute" of patience is 6 hours; patients must be strictly closer than 9 tiles | `narrative/npc-actions/catalog.test.ts` |
| A Pablo bribe never wears off: action 109 is not implemented, so nothing posts the unbribe event | `narrative/npc-actions/catalog.test.ts` |
| Free treatment tests the several-wounded-mercs fact first, which holds for one merc too, so record 25 never plays | `narrative/npc-actions/requestors.test.ts` |
| The ice-cream truck placement asks whether profile 26, the truck's body type, is on our team | `narrative/placement.test.ts` |
| The AI's "enter sector" step tests the recruited flag where it means `DONT_ADD_TO_SECTOR` | `narrative/schedules.test.ts` |
| The next schedule entry is posted at today's start plus its time, so one past midnight lands in the past and the schedule stops until the next load | `narrative/schedules.test.ts` |
| A civilian leaving the map by schedule stops two tiles past the edge and stays there, in the sector, until the next load | `src/sim/campaign/narrative/schedules-scenario.test.ts` |
| Hostile rebels stay allied with the army: only Conrad and the General change side | `narrative/civ-hostility.test.ts` |
| An electric trap's breath loss is `3 + 1000 × PreRandom(3)`, drawn before the life roll | `doors/doors.test.ts` |
| Escorts may use a crowbar and untrap: the untrap button's disable flag replaces the escort flag | `doors/doors.test.ts` |
| Our merc opens a door that has a lock entry for free; only a door without one costs the opening APs | `doors/doors.test.ts` |
| A bash that misses by 10 to 39 never earns the token strength point: the failed check has just stored the merc's tile | `doors/doors.test.ts` |
| Every NPC placement draws a sector at a new game, also those whose profile does not move | `src/sim/strategic/map/init.test.ts` |

Not pinned yet:
- The D5 and P3 rules of the sector entry compare x and y only, so they run on every level below too
  (`narrative-flow.ts`).
- Kingpin's unprofiled men get no schedule while his group is hostile at any level, where the placement override needs
  exactly "will become hostile" (`schedules.ts`, `placement.ts`).
- The AI's "enter sector" step puts a civilian who never left at gridno 0 (`decideEnterSector`).
- Auto-processing teleports to a cell's corner, not its centre (`setSoldierPositionNoCenter`).
- An AI walk whose path ends short of its absolute destination sets the original's every-frame flag in the status
  flags, where its bit means "attack noticed" (`markAttackNoticedByMisplacedEveryFrameFlag`, `ai/control.ts`).
- A lock's smash difficulty above 127 turns into a bonus: both `INT8` casts wrap (`bashModifier`).
- A threatened Kingpin moves Spike to C5 keeping his old level (`npc-events.ts`).

## 4. Not checked against the native build

The oracle compares the action catalog and its requestor answers, the NPC system events, the 04:00 and hourly handlers,
the sector entry and exit code, the profiles present after a sector entry, civilian groups and the hostile-quote list,
the door actions and menu, and schedules through entries, warps, loads and AI decisions (`tools/oracle/README.md`,
"Facts and NPC presence", "NPC actions", "Civilians", "Doors", "Schedules"); the new-game probes of "Laptop" compare
every profile's sector. Inferred from reading the source:
- The walking door and cabinet actions (3, 27, 40): unit tests on the stub village door only.
- That the original cannot save while a requestor box or the talk panel is open, so their globals need no save.
- That a walked departure ends in an away slot at the next load, and that the second schedule event after a native load
  is harmless.
- That a dealer's shop hours are known only while his sector is loaded (ja2-node's hook returns `null` otherwise).
- The "robot under construction" graphic: its gridno is never assigned in Stracciatella or vanilla, so its removal is a
  no-op; ja2-node only sets the fact.

Not ported: gaps "Doors", "Rebel basement trapdoor", "Building owners", "Implications of an attack", "NPC draws first
and minor offenses", "NPC traversal off the map", "NPC opens a door on arrival", "Team changes". Other deviations of
this domain: "Terrorist names", "NPC gives an item".
