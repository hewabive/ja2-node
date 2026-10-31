# 13 — Combat AI

The AI above GREEN: the YELLOW, RED and BLACK decisions, their attack, cover, flight and item searches, how combat
actions run and end, and the civilian, militia and creature variants. Siblings: `09` the real-time scheduler, the alert
status and the GREEN decision; `10` team turns, the AI list and interrupts; `11` attacks once `handleItem` starts them;
`07` pathfinding; `08` sight, noise and opplists; `33` hits. Each module's `@src` header names the Stracciatella
functions it ports; read those for the formulas, tables and step order.

## 1. The path of a decision

Paths are under `src/sim/tactical/`.

```
team turn: AI list built                                turns/turns.ts, turns/ai-list.ts
  └ startNPCAI: refreshAI, decideAlertStatus            ai/turn-based.ts, ai/decide.ts
     └ handleSoldierAI on every overhead pass           ai/control.ts
        new situation → cancelAIAction, decideAlertStatus
        action NONE → turnBasedHandleNPCAI: the queued next action, or decideAction
           GREEN → 09; creatures, bloodcats, crows       ai/creature-decide.ts
           YELLOW, RED, BLACK                            ai/combat-decide.ts
              noise, disturbances, friends in trouble    perception/knowledge.ts, ai/utils.ts
              morale, threat, range change desire        ai/morale.ts
              shot, throw, stab, spread burst, stance    ai/attack-choice.ts
              cover, flight, gas, darkness               ai/cover.ts, ai/destinations.ts
              weapons, ammo and items to pick up         ai/item-search.ts
           isActionAffordable → executeAction             ai/turn-based.ts, ai/control.ts
        a move continues along its path; any other action waits for its completion hook
     endAIGuysTurn → next soldier on the list
```

| Module | Holds |
|---|---|
| `ai/actions.ts` | Action ids, the movement range, situations, urgency and movement mode tables, delays |
| `ai/control.ts` | `handleSoldierAI` (both cadences), `executeAction`, `actionDone`, `cancelAIAction`, the completion hooks, `newDest`, the loop detector, the edge escape (`handleAITacticalTraversal`), `createAiControl` wiring the deciders |
| `ai/turn-based.ts` | `isActionAffordable`, `startNPCAI`, `refreshAI`, `manChecksOnFriends`, `turnBasedHandleNPCAI`, `endAIGuysTurn` |
| `ai/combat-decide.ts` | `decideActionYellow`, `decideActionRed` (the seek, watch, help and hide loop, the long-range toss, civilian cowering), `decideActionBlack` (attack choice, attack against cover, stance and burst, the surrender offer) |
| `ai/attack-choice.ts` | `canNPCAttack`, `calcBestShot`, `checkIfTossPossible`/`calcBestThrow`, `calcBestStab`, `calcSpreadBurst`, the AI damage estimates, `shootingStanceChange`, `stanceChange` |
| `ai/morale.ts` | `calcMorale`, `calcManThreatValue`, `rangeChangeDesire`, the personal-or-public knowledge choice |
| `ai/cover.ts` | `findBestNearbyCover`, `findSpotMaxDistFromOpponents`, `findNearestUngassedLand`, `findNearbyDarkerSpot`, `inLightAtNight`, `reachabilityFlood` |
| `ai/utils.ts`, `perception/knowledge.ts` | Closest disturbance, friend in trouble and opponents, path cost estimates with climbing, watched locations, noise heard, what the soldier knows that his team does not |
| `ai/queen-escape.ts`, `ai/decide-boxing.ts`, `ai/decide-named-npc.ts` | The Queen and Joe (`26`), boxers (`25`), named NPCs (`24`) |
| `ai/creature-decide.ts`, `smell.ts`, `multi-tile.ts` | Creature, bloodcat and crow decisions, calls and scent; the smell and blood map; multi-tile structures (`07`) |

## 2. Design

**A decision only when the soldier is idle.** In combat a soldier decides when his action is NONE, one soldier at a
time in AI list order, so the draws of a team turn follow that order. An action is never re-decided: it ends at its
completion hook (path exhausted, the turn or stance animation done, the climb or radio opcode, the attack busy count at
0) or is cancelled by a new situation. A new situation waits while the attack busy count is up, except for a shooter
once no bullet flies and for a tosser once nothing is in the air, whose busy count it clears. An action the soldier
cannot afford is kept and halts him: a GREEN or YELLOW soldier's move resumes next turn, a RED or BLACK soldier rethinks
at his turn start.

**Stracciatella's movement range.** `LAST_MOVEMENT_ACTION` is CHANGE_STANCE (vanilla: MOVE_TO_CLIMB), so a turn or a
stance change also ends through the movement branch: `actionDone`, then `cancelAIAction` on a later pass while the
animation still runs. The soldier re-decides early, may start another turn and pay for it again, and the cancel clears
the cover skip and the bypass to green. ja2-node follows Stracciatella.

**One cover skip for everybody.** `t.turn.skipCoverCheck` is the original's single global: any soldier's turn or stance
change sets it; any `executeAction`, any `cancelAIAction` and a YELLOW turn start clear it.

**Random numbers.** The deciders draw on `pre`. A chance test draws even when the chance is 0 or below, unless an
earlier condition skips it. On `main`: the GoAsFar shuffle, the spread burst's coin, real-time delays and the
new-situation delay. Attack evaluation, cover and damage estimates draw nothing, except the LAW owner's coin in
`checkIfTossPossible` and the `PreRandom(3)` per heard target in `calcBestThrow`. Not drawn: the civilian quote before
an attack (deviation "Cosmetic draws in attacks"), the bloodcat growl ("Cosmetic draws of creatures"), the pathfinder's
skip list ("Pathfinder RNG").

**Search limits are arguments.** The original's `gubNPCAPBudget`, `gubNPCDistLimit` and `gubAIPathCosts` globals are
arguments and a fresh result of `reachabilityFlood`, so nothing leaks between searches (deviation "AI path-cost cache").

**Evaluating changes the soldier, as in the original.** `canNPCAttack` reloads, paying APs in combat, and draws a
pocketed weapon during the BLACK decision. `calcBestShot` and `calcBestStab` set `attackingWeapon`; `calcBestThrow`
reads it for a LAW without setting it. `findSpotMaxDistFromOpponents` gives an enemy who flees to the map edge the
edge-escape quote action: his move is extended off the map and he leaves the sector.

**Knowledge of opponents.** Each helper takes the opponent's personal or public last known grid and level, whichever
is fresher (`freshestLastKnown`, `perception/knowledge.ts`); a throw at an opponent no longer in sight aims at his
personal ones. Only a soldier seen right now is taken where he stands.

**Settings fixed at their default.** Stracciatella's AI policies (avoid lit tiles at night, stay on the rooftop, go
prone more often, the better aiming choice, the corpse warning) run off and are not configurable. The difficulty
comes from `t.campaign.difficultyModifier`, computed at sector load (deviation "Difficulty and progress in tactical").

**The rest of tactical through hooks.** Attacks go through `turnHooks.aiAttack` (`handleItem`, `combat/attack.ts`),
pickups and drops through `turnHooks.aiPickup` and `aiDropHandItem`, the surrender offer through
`t.narrative.offerSurrender` (`24`), an edge escape through `sectorHooks.soldierLeftMap` (`17`).

**Creatures** decide in `ai/creature-decide.ts`; monsters have their own alert status (bloodcats use the human one) and
see by smell. With Stracciatella's data the queen's tentacles are a blade, so she only spits and calls; the tentacle
attack is ported and unreachable.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `ai/`:

| Quirk | Test |
|---|---|
| A chance test rolls `PreRandom` even at chance 0: the radio roll of an `ATTACKSLAYONLY` soldier | `combat-decide.test.ts` |
| AI morale starts at HOPELESS, so a YELLOW soldier who never weighed it runs to a noise | `combat-decide.test.ts` |
| Nobody calls for spotters and BLACK weighs the spotter radio from the start: the caller starts at soldier 0, never NOBODY | `combat-decide.test.ts` |
| An on-guard soldier who spots an enemy goes on far patrol at once: his orders are raised twice | `ai.test.ts` |
| An unseen sleeper (`visible` −1) wakes up in turn-based combat | `ai.test.ts` |
| A public noise the soldier stands near and sees moves two tiles west instead of fading | `utils.test.ts` |
| The threat value of our merc on another assignment leaves out his armour, marksmanship and gun, however armed he stands in the sector | `cover.test.ts` |
| A target of equal value replaces the one already chosen | `attack-choice.test.ts` |
| A creature's blade it cannot afford stays in its hand | `creature-ai.test.ts` |
| Scent tracking tests the stale action data, not the trail tile | `creature-ai.test.ts` |

Not pinned yet:
- A prone soldier needs 6 APs to afford a turn that costs 2; a stance change is affordable at 2 APs whatever the stance.
- A stance change before a shot that leaves no APs to aim sets the aim to the stance cost; only the burst choice reads it.
- The RED look-around measures the sight range to the closest opponent at ground level.
- The cover search takes a tenth per adjacent teammate off the current tile without the sign test it applies to the
  candidate tiles.
- The side-step search of `calcBestCTGT` tries north-east twice and never north.
- A move that runs out of APs is cancelled and still takes its next step when the soldier can pay for that step.
- `shootingStanceChange` aims at the target level and cube of the soldier's previous attack.
- BLACK's crouch step checks the crouch cost also when the result is prone.
- `calcBestThrow` counts the thrower among the friends kept out of the blast and keeps the first of equal tiles.
- A creature advancing to firing range keeps the APs of an attack with its hand item, the claws for males.

## 4. Not checked against the native build

Inferred from reading the source; no probe compares the human YELLOW, RED and BLACK decisions (the probes cover
`CalcBestShot`, the surrender offer and named NPCs, boxing, and the creature AI, `tools/oracle/README.md`):
- The turn and stance changes ending early and the APs a repeated turn drains.
- The BLACK loop of a civilian whose `CanNPCAttack` fails other than for want of a weapon (deviation "Armed civilian
  without ammo").
- A cowering civilian in combat standing up to run at each turn start and cowering again after it.
- A tired GREEN or YELLOW soldier deciding again on every pass.
- The edge-escape quote action surviving a cancelled flight, so a later move leaves the map.
- The AI path costs excluding the cost of starting to move.
- `SoldierToLocationChanceToGetThrough` drawing no random number, which keeps cover and stance searches draw-free.
- That nothing ever sets the spotters' caller to NOBODY.

Not ported: gaps "Combat AI specials", "AI decision details", "AI flares underground". Kept
differences: deviations "Armed civilian without ammo", "AI climb that cannot start", "Watchdogs", "Recalculated path
cost", "GoAsFar fallback", "Creature and bloodcat stub bodies", "Multi-tile turning", "Blood and smell decay period".
