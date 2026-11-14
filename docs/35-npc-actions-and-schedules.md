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
attack order → first draw; pickup, explosion → grudge  tactical/narrative/first-draw.ts, minor-offenses.ts
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
| `tactical/narrative/first-draw.ts`, `minor-offenses.ts` | `NPCFirstDraw` before our merc's attack out of combat; `MakeNPCGrumpyForMinorOffense` for a pickup from an owned tile and for our explosion in an owner's rooms |
| `tactical/doors/` | Door table, keys and key ring, lock attempts, traps, the menu and `handleOpenableStruct`, the `door` command and view, door statuses (real, perceived, busy, shown) and the door's tile animation; `src/content/formats/locks.ts` reads the lock table |

## 2. Design

**The catalog works on a port.** `handleNpcDoAction(env, npc, code, record)` runs one action at once and touches the
campaign only through `NpcActionEnv` (events, facts, quests, loyalty, mines, boxing, recruiting, the laptop), so it is
tested with a fake environment; `NpcActionFlow` builds the real one. The money and item rules of giving to an NPC are
`24`'s (`narrative/select.ts`).

**Minor offenses.** The original lets an NPC draw first in the click handler of an attack (`UIHandleMercAttack`), so
the `attack` command checks it after its argument and click checks and before the merc takes his aim, with the soldier
on the target tile whom the player sees as the click's target; an NPC who wins refuses the order with `npcDrewFirst`
(`29` §8.1). The ownership check of a pickup waits one second of game time (deviation "Ownership check timer"). Room
owners are the profiles' room ranges: `prof.dat`'s, or `ownedRooms` in `stubs/profiles.json`, where Lena Castell (the
dealer at Arnie's id) owns A10's room 1.

**Requestors are prompts.** Where the original opens a yes/no box, ja2-node opens an `npcRequest` prompt in the
campaign's prompt slot, inside or outside a talk session, answered with `answer`; the amount shown is computed when it
opens and the open request is saved with the campaign (deviation "NPC requestors"). Requestor quirks: `24`.

**Wall-clock waits become game time.** Carmen's 10 s departure timer counts tactical game time; the fades into and out
of the rebel basement change sector at once; the sex screen's time warp happens at the action (deviations "Carmen's
departure timer", "Rebel basement", "Brothel time warp"). Going down to the hideout still writes A10's trapdoor and the
moved crate into the A10 just left, after the basement has loaded (`campaign/unloaded-map.ts`), and `mapsNeededSoon`
prepares A10 b1 in A10, where no exit grid leads down before the trapdoor opens.

**An NPC between loads is his profile's sector.** Actions, the 04:00 event, hourly handlers, NPC system events and the
sector entry code move profiles, not soldiers; most moves skip an NPC whose sector is loaded, so a visible NPC never
vanishes. A load creates soldiers through the placement filter (profile sector with z, not recruited, alive) and through
profile insertion data; an unload writes a pending walk or traversal back into the profile and the non-player soldiers'
life and stats. An NPC who walks off the map moves his profile one sector that way at once, unless he walks a schedule
(`handleAITacticalTraversal`, `tactical/ai/control.ts`). The 04:00 event also runs during the new-game warp, so its
draws come before the first landing.

**Schedules exist only for the loaded sector.** Every fresh load posts them and replays the past 24 hours at once
(teleporting, never walking), so a civilian ends in the state of his latest entry; on the map screen a schedule event
auto-processes the window since the last event query; in tactical the AI walks the entry. A civilian without a map
schedule gets a default one on the surface (in 07:00–08:00, out 18:00–20:00, two `main` draws) when the map has an
entry point. A civilian who leaves the map goes to the away slots (deviation "Away civilians"); an auto-processed door
change sets only the door status's real state, and the structure follows when a merc sees the door or at the next load
(`PerformActionOnDoorAdjacentToGridNo`, `Strategic/Scheduling.cc:958`).

**Saves keep schedules exactly.** ja2-node's own saves keep every schedule, temporary ones included, and its events, and
do not post again (`SectorFlow.reattachLoadedSector`). A native save import posts again without auto-processing, as the
original's load does (`SectorFlow.adoptLoadedSector`): each schedule gets a second event and the unsaved default
schedules are drawn anew.

**Civilian groups are strategic state.** `StrategicState.civGroups` is shared with the loaded sector as
`TacticalState.civGroups`; a created civilian is neutral unless he is the Warden or his group is hostile. Turning
hostile follows Stracciatella (`MakeCivHostile`, `Tactical/Overhead.cc:2591`): only Conrad and the General change side;
everyone else just stops being neutral and keeps his side, where vanilla also set it.

**Doors.** The `door` command returns the menu as data and offers `lock`, which the original's menu lacks; our merc gets
vanilla's menu before closing an open door (deviations "Door menu", "Closing an open door"). A trap check before a menu
action charges the open-door APs where the original reads past its table (deviation "Trap check cost of menu actions").
An order to open or close a door, container or switch records the structure's ID when it starts
(`TileEngine/Interactive_Tiles.cc:78`), and the opening codes 494 and 495 handle only the structure of that ID on its
tile (`:98`, `doors/door-actions.ts`), a native save's action included (`14`). Arriving, the soldier looks for an
openable on the tile (`Tactical/Overhead.cc:829`; `doors/door-command.ts`): short of the APs of his door handle code
he halts there with the order kept (`:837`, `:863`); with none there he keeps the order and walks on the spot, looking
again at every pass of the tile's middle (`Tactical/Soldier_Control.cc:6268`), until an order, a stop or combat
starting or ending ends it. On our turn the original also keeps the interface locked meanwhile, until its 25 s breaker
(deviations "Turn-based UI lock", "Watchdogs").
`ExamineDoorsOnEnteringSector` never fires in the original (the tactical time stamp is set just before it,
`Strategic/StrategicMap.cc:498,509`), so it is not ported.

**Busy and perceived doors.** A door status (`doors/door-status.ts`) keeps the original's real state (`DOOR_OPEN`),
the perceived and not-set flags, the busy flag and the door the player is shown, which the view sends as `openDoors`.
The structure usually matches the real state, but the original lets the two part: a schedule's change writes only the
status, and a load gives a door the structure of what the player perceives where the map draws its real state
(`InternalUpdateDoorGraphicFromStatus`, `Tactical/Keys.cc:1114`), until a merc's look puts it back. A sector entry
updates the doors twice, after the temp files and at its end (`Strategic/StrategicMap.cc:514`), so only its own steps
see that structure; a native import updates them once, so it stays. Everything that walks, sees or opens reads the
structure, as in the original. `handleDoorChangeFromGridNo` (`doors.ts`) decides as `HandleDoorsOpenClose`
(`Tactical/Handle_Doors.cc:814`) whether a change is shown. A shown change sets the perceived state, raises
`doorChanged` and runs the door's tile animation in the explosions' list (`doors/door-animation.ts`), which holds the
door busy; an unshown one leaves what the player knows until `MercLooksForDoors` (`Tactical/Keys.cc:980`) in a merc's
look. The sector keeps the not-set flag, not the busy one. A status also carries a tin can tied to the door
(`hasTinCan`, `DOOR_HAS_TIN_CAN`, `12` §7), which the sector keeps and which triples the door's opening noise
(`DoorOpeningNoise`, `Tactical/OppList.cc:3358`).

**Randomness.** Gameplay draws keep the original's statement order on `main` and `pre`. Kingpin's men placed around
Hans' door take two `main` draws, x first, where the original's two engine draws have no defined order (deviation
"Kingpin's men placement"); door creaks and curses are not drawn (deviation "Cosmetic draws of doors").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/` unless a path says
otherwise:

| Quirk | Test |
|---|---|
| Darren pays twice the bet out of his stash without checking it; a stash too small wraps as `UINT32` | `narrative/npc-actions/catalog.test.ts` |
| Darren's payout changes hands only at the end of his give animation; until then it lies first among his money, so the money gift of the record his payout triggers (32) gives it again rather than his stash (`Interface_Dialogue.cc:2924-2934`, `TacticalAI/NPC.cc:1809`) | `src/server/give-stub.test.ts` "keeps the payout in his pockets …" |
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
| The death checks of a team change during a hit stay armed once the hit soldier has changed team: every later team change runs them for the old soldier until the next fall from a hit, so a standing recruit turned hostile kneels | `narrative/team-change.test.ts` |
| An electric trap's breath loss is `3 + 1000 × PreRandom(3)`, drawn before the life roll | `doors/doors.test.ts` |
| Escorts may use a crowbar and untrap: the untrap button's disable flag replaces the escort flag | `doors/doors.test.ts` |
| Our merc opens a door that has a lock entry for free; only a door without one costs the opening APs | `doors/doors.test.ts` |
| A bash that misses by 10 to 39 never earns the token strength point: the failed check has just stored the merc's tile | `doors/doors.test.ts` |
| An NPC told to open a door drops it on arrival during his own team's turn in combat: the interface is locked then | `narrative/npc-actions/open-thing.test.ts` |
| A soldier whose door or container was swapped for its partner since his order, opened and closed again by somebody else, plays the opening to no effect: the codes look for the structure his order named | `doors/doors.test.ts` "plays the opening of a door swapped …", `doors/openables.test.ts` "plays the opening of a crate opened and closed again …" |
| A soldier who arrives where the openable of his order is gone walks on the spot with the order kept until an order or a stop; one put back there is another structure, whose opening he plays to no effect | `doors/openables.test.ts` "walks on the spot beside a crate gone …" |
| A merc who gave on the spot keeps `MERC_GIVEITEM` past the hand-over until his next order or the end of a walk he did not order: meanwhile every soldier arriving to open a door drops it and the auto-bandage question waits | `doors/doors.test.ts`, `give.test.ts`, `auto-bandage.test.ts` |
| A soldier still holding the give he made on the spot when a walk he did not order ends begins it again from the old target's tile: the target still there gets the give animation with nothing in it and an NPC giver's done-giving record fires again; with nobody there the record fires, and he walks on the spot to his tile's middle before he stands | `give.test.ts` "begins the give again …", "leaves the walker in his walking animation …" |
| A merc's look updates at most one door, the first whose status was made (the `break` in `MercLooksForDoors`) | `doors/door-status.test.ts` |
| Only a soldier hidden at −1 changes a door unseen: one fading out at −2 still animates it and shows the player the change | `doors/door-status.test.ts` |
| A door that already shows its new state runs its animation backward and is busy one frame, not five | `doors/door-status.test.ts` |
| After a load, a door the player perceives otherwise than it is, where the map draws its real state, has the structure of the perceived state until a merc sees it; a sector entry's second update puts the real one back | `doors/door-status.test.ts`, `src/sim/campaign/sector-flow.test.ts` |
| A schedule's door change on the map screen leaves the structure as it was until a merc sees the door or the next load | `doors/door-status.test.ts` |
| Every NPC placement draws a sector at a new game, also those whose profile does not move | `src/sim/strategic/map/init.test.ts` |
| An enemy's pickup from an owned tile angers the owner too: the ownership check follows every soldier's pickup | `narrative/minor-offenses.test.ts` |
| A second pickup within a second replaces the first one's ownership check, which never runs | `narrative/minor-offenses.test.ts` |
| One explosion angers a room owner once for every tile of his rooms it reaches, each time with his I-hate-you line | `narrative/minor-offenses.test.ts` |

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
- `MercLooksForDoors` tries the tiles around a door with the door tile's sight range, where `AllMercsLookForDoor` takes
  each tile's own (`door-status.ts`).
- A door whose perceived state is not set reads as closed to the player's paths, whatever it shows (`doorState`).

## 4. Not checked against the native build

The oracle compares the action catalog and its requestor answers, the NPC system events, the 04:00 and hourly handlers,
the sector entry and exit code, the profiles present after a sector entry, civilian groups and the hostile-quote list,
the door actions and menu, and schedules through entries, warps, loads and AI decisions (`tools/oracle/README.md`,
"Facts and NPC presence", "NPC actions", "Civilians", "Doors", "Schedules"); the new-game probes of "Laptop" compare
every profile's sector. Inferred from reading the source:
- The walking door and cabinet actions (3, 27, 40): unit tests on the stub village door only.
- An NPC action's give (Fatima's letter to Miguel, action 101; Darren's boxing payout, action 206, with his records 32
  and 33 after it): the give probes cover gives from mercs only; an original-data test plays the rebel basement from
  Carlos 1 (`src/server/rebel-hideout-original.test.ts`), the steps in A9 and A10 before it are untested, and Darren's
  payout runs on a stub stand-in only (`src/server/give-stub.test.ts`).
- The busy door, the perceived door state and the structure a load gives a door perceived otherwise than it is: unit
  tests on the stub village, town and airfield; the oracle's door probes leave the door statuses out, and the native
  saves hold no door perceived otherwise than it is.
- An NPC drawing first, the ownership check of a pickup and the room owners' grudge after our explosions
  (`first-draw.ts`, `minor-offenses.ts`): unit tests on synthetic maps only.
- That the original cannot save while a requestor box or the talk panel is open, so their globals need no save.
- That a walked departure ends in an away slot at the next load, and that the second schedule event after a native load
  is harmless.
- That a dealer's shop hours are known only while his sector is loaded (ja2-node's hook returns `null` otherwise).
- The "robot under construction" graphic: its gridno is never assigned in Stracciatella or vanilla, so its removal is a
  no-op; ja2-node only sets the fact.

Deviations of this domain:
"Terrorist names", "Interface lock per source", "Team change during a hit", "Ownership check timer".
