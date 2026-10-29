# 09 — Green-alert AI in real time

Out of combat: when the AI runs, how a real-time action starts, waits and ends, the alert status, and the GREEN
decision with its patrols, friends and looks. Siblings: `13` the YELLOW, RED and BLACK decisions, actions in combat,
creatures and crows; `10` team turns, the AI list and the AI's turn in combat; `08` the sightings and noises that raise
the alert; `07` paths, walking, doors and blocked tiles; `35` schedules and the away slots; `24` named NPCs; `25`
boxers; `04` the tick model. Each module's `@src` header names the Stracciatella functions it ports; read those for the
chances, delays, ranges and step order.

## 1. The path of a real-time decision

Paths are under `src/sim/tactical/`.

```
overhead pass, every 5 ms                                     overhead.ts, tactical-sim.ts
  beforePass: end of a timed AI pause; an AI tick             ai/pause.ts, ai/control.ts
     when more than 50 ms passed since the last
  each merc slot: the soldier's frame, then aiForSlot         ai/control.ts
     handleSoldierAI: gates, the soldier's own 100 ms timer
        new situation → cancelAIAction, decideAlertStatus     ai/decide.ts, perception/knowledge.ts
        action NONE → rtHandleAI: the queued next action,
           an NPC script's destination, or a decision
           decideAction: GREEN → decideActionGreen            ai/decide.ts
              schedule, named NPC, boxer                      ai/decide-schedule.ts, decide-named-npc.ts,
                                                              decide-boxing.ts
              patrol points, random patrol, a friend          ai/destinations.ts
           YELLOW and above, creatures, crows → 13
           nothing → WAIT; executeAction                      ai/control.ts
        a move under way: path used up → actionDone,
           else on along the path
  afterPass: the away slots, then the game events             game-events.ts
     (the turn a CHANGE_FACING asked for)
```

| Module | Holds |
|---|---|
| `ai/control.ts` | The real-time cadence (`beginAiPass`, `aiForSlot`, `awayAiForPass`), `handleSoldierAI`, `rtHandleAI`, `executeAction`, `actionDone`, `cancelAIAction`, `npcDoesAct`, the completion hooks, `createAiControl` wiring the deciders |
| `ai/decide.ts` | `decideAction`, `decideAlertStatus`, `checkForChangingOrders`, `setNewSituation`, `decideActionGreen`, the real-time delays, `determineMovementMode` |
| `ai/destinations.ts` | Roaming range, random destinations, the friend to visit, `goAsFarAsPossibleTowards`, `legalNPCDestination`, patrol points |
| `ai/actions.ts` | Action ids, the movement range, situations, the cadence constants, the urgency and movement mode tables |
| `ai/pause.ts`, `ai/system-situation.ts` | The AI pause after combat and around quotes; `handleSystemNewAISituation` |

`Soldier.ai` holds the original's AI fields without their type prefixes (`counter` is `AICounter` as an absolute
game-ms deadline); `TacticalState.aiPass` holds the tick time and the cursors. Turns, stance changes, roof climbs and
pending actions end AI actions through the tactical hooks `TacticalSim` installs.

## 2. Design

**The real-time cadence.** An AI tick comes when more than 50 ms passed since the last one, so every 55 ms on 5 ms
passes. A tick visits every AI soldier after the cursor in merc-slot order; the next tick starts over at slot 0. The
original stops a tick after 10 ms of CPU, which no modern machine reaches, so ja2-node has no slice (deviation
"Timing"). A visit acts only when the soldier's own 100 ms timer is due, so an idle soldier is visited every 110 ms. The
AI runs right after the soldier's own frame in the same pass, so its draws follow merc-slot order. The away slots get a
visit when the cursor has passed the last slot (`35`). A soldier flagged `handleEveryFrame` is visited on every pass and
skips the timer: an NPC a script sends somewhere or whose walk ended short of the script's destination, an NPC facing
the player until a PC comes near (`24`, `35`). Leaving combat pauses all AI for 1500 ms (`10`).

**Turn-based runs the same code on another cadence.** In combat there are no ticks and no timers: `handleSoldierAI`
runs for every slot on every pass and only the holder of the AI turn acts (`10`, `13`). `t.inCombat` switches what
differs. Real time never charges APs, so every action is affordable and combat starts with a full turn plus the
carry-over (`10`). It queues a WAIT after most green moves, tries one random destination instead of ten, and only it
runs schedules, the named-NPC decision and the minute of rest after an NPC spoke. A friend seen on alert, under fire or
down raises the soldier's alert only at his turn start in combat (`manChecksOnFriends`, `13`).

**Waiting is an action.** A decision of nothing becomes WAIT with a delay of several seconds, shorter for civilians and
militia when few of them are in the sector (`realtimeDelay`); green moves queue the same wait as the next action, so a
soldier walks, arrives, waits and decides again. Waits are game-ms deadlines (deviation "Frame timers").

**A new situation cuts the wait short.** A sighting, a heard noise, a change of alert status or running low on breath
re-arms the soldier's timer to within a second (`setNewSituation`). That visit cancels the current and the queued
action, so a walker stops at his tile centre, and decides the alert status again. A sighting also halts a walker at
once (`08`); a noise waits for the visit. Otherwise an action is never re-decided: it runs until its completion hook or
the end of its path.

**How actions end.** A move ends at the first visit after its path is used up. Stracciatella's movement range takes in
CHANGE_FACING and CHANGE_STANCE (`13`), so a turn ends at the next visit too, and the WAIT queued behind it starts one
visit later, where `npcDoesAct` makes the current facing the desired one: a green look-around usually turns one octant,
sometimes none. `LAST_MOVEMENT_ACTION` is the one switch to the vanilla behaviour, where the turn completes.

**The alert status.** `decideAlertStatus` runs before every real-time decision and after every new situation. Opponents
in sight mean BLACK; a team aware of opposition or fire on the soldier means RED, except for civilians; a noise the
soldier still considers (`mostImportantNoiseHeard`) means YELLOW. BLACK falls to RED when the last opponent is out of
sight, RED never falls back, YELLOW returns to GREEN when the noise is forgotten and no action runs. The soldier's own
noise memory is not filtered by hostility: a civilian who hears an unseen soldier walk goes YELLOW, and so does a
soldier who hears a civilian, without the player being involved. Seek-enemy troops roam the whole map, so in towns this
can happen often. A YELLOW soldier often falls back on the GREEN decision with higher chances (`bypassToGreen`, `13`).

**The GREEN decision.** In real time a civilian first follows his schedule (`35`); a named NPC then walks up to a merc
he wants to talk to, faces the player a record told him to face, or stalks a merc as an assassin
(`decideActionNamedNPC`, `24`), and does nothing for a minute after he spoke; neutral civilians then do nothing four
times out of five. Orders give a roaming range around the soldier's first tile (the next patrol point for point
patrols, his current tile for seek-enemy troops); the chances to patrol, visit a friend or look around come from orders,
attitude, injury and breath. STATIONARY orders give range 0 in GREEN, so such a soldier stays on his tile and only
turns. A tank does nothing. Green soldiers always walk,
except children, who sometimes skip, and a merc under AI control whom the player switched to running. Any path search
in the patrol branch, even a fruitless one, skips the visit to a friend: the original's limit on pathing per decision.

**Destinations.** Every AI destination passes `legalNPCDestination`, which refuses the gassed tiles the pathfinder
accepts. A random destination keeps a civilian or a named NPC with orders up to CLOSEPATROL inside his room;
outdoor tiles always pass. `goAsFarAsPossibleTowards` cuts the stored path at the roaming range and at the first illegal
step, so a green leg is at most one stored path long. A move whose path cannot start blacklists its target until the
next move that starts.

**Randomness.** The chance rolls, the random patrol point, the friend picked and the look directions draw on `pre`, and
so does a destination anywhere on the map; the offsets of a destination within range, the side of the friend to stand
on, the GoAsFar fallback shuffle (deviation "GoAsFar fallback"), the delays, the new-situation delay and the children's
skipping draw on `main` (`01` §3.6). A chance roll draws even when the chance
is 0 or below, unless an earlier branch skipped it. `handleSoldierAI` itself draws nothing; footsteps are `08`.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/ai/`:

| Quirk | Test |
|---|---|
| The first AI tick starts at slot 1, so slot 0 is first visited at 110 ms | `ai.test.ts` |
| A random green turn is cut short: Stracciatella's movement range ends it and the queued wait stops it | `ai.test.ts` |
| An enemy queues no wait after visiting a friend; civilians and militia do | `ai.test.ts` |
| Any path search of the patrol branch, even one it could not use, skips the friend's roll | `ai.test.ts` |
| The spot next to a friend is never north of him and north-east comes up twice as often: the direction is shifted by one | `ai.test.ts` |
| A neutral civilian counts enemy soldiers as friends, but not the other way round: the civilians' side is the enemy's | `ai.test.ts` |

Not pinned yet:
- Point patrol orders set the patrol chance to 0 and the friend's chance to −10 outright, so a YELLOW soldier's bonus
  is lost.
- The look-around accepts a dominant direction of 8.
- `goAsFarAsPossibleTowards` keeps a path one step longer than the part it allows; the soldier stops at
  `finalDestination` anyway.
- Stracciatella limits `goAsFarAsPossibleTowards` to the room only for NPCs with a script destination, vanilla only for
  the others; ordinary wandering is limited by the random destination's room test alone.
- An NPC short of his script destination gets `attackNoticed`: the original sets its every-frame flag in the wrong
  field (`markAttackNoticedByMisplacedEveryFrameFlag`).
- The YELLOW-to-GREEN test reads `actionInProgress`, which a WAIT leaves set until the next decision.
- The personal noise memory is not filtered by hostility (Design).

## 4. Not checked against the native build

No probe compares the real-time cadence or a human soldier's GREEN decision; the probes cover named NPCs, schedules,
boxers and the creature AI from GREEN up (`tools/oracle/README.md`). Inferred from reading the source:
- The 55 ms tick and every AI slot per tick assume ideal 5 ms passes and a fast CPU.
- Green turns and stance changes ending early in practice (`13`).
- `handleSystemNewAISituation` doing nothing in real time, where the current team stays ours.
- `InternalIsValidStance` holding for every standing single-tile soldier in the look-around.
- The GoAsFar fallback and its shuffle never running for a random destination, which is legal already.

Not ported: gaps "AI decision details", "Auto-bandage", "NPC traversal off the map", "Hidden attacks start combat",
"Combat AI specials". Kept differences: deviations "Timing", "Frame timers", "Game events", "GoAsFar fallback", "Away
civilians".
