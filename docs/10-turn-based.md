# 10 — Turn-based combat

From the first hostile sighting to the end of combat: who starts, team turns, action points, where and when a soldier
may interrupt, the interrupt queue, the AI's turn and leaving combat. Siblings: `07` the AP and breath of a step and the
freeze of a halted walker; `08` sight, noise and opplists; `09` the real-time AI and the alert status; `13` the combat
AI's decisions and how its actions end; `11` and `33` attacks, hits and the attack busy count; `15` world time and the
real-time turn; `17` reinforcements; `19` the strategic end of a battle; `25` boxing; `29` `endTurn`, the interrupt
decision and the turn events. Each module's `@src` header names the Stracciatella functions it ports; read those for
the formulas, constants and step order.

## 1. The path of a battle

Paths are under `src/sim/tactical/`.

```
real time: a look finds a new hostile, the looker is ranked    perception/sight.ts (the best-sighting list)
  or an attack is noticed when the busy count reaches 0        combat/barrier.ts
  or a script turns someone hostile                             narrative/
  └ enterCombatMode: everyone stops and gets his APs           turns/turns.ts
     our team starts: startPlayerTeamTurn
     an AI team starts: endTurn → beginTeamTurn
  or an AI soldier is about to attack: npcDoesAct               ai/control.ts
  └ displayHiddenTurnbased: everyone stops, his team's turn     turns/turns.ts
team turn: beginMercTurn for each member                        turns/turns.ts, points.ts, combat/bleeding.ts
  ours: orders until End Turn                                   tactical-sim.ts
  AI: buildAIListForTeam → startNPCAI                           turns/ai-list.ts, ai/turn-based.ts
      handleSoldierAI on every pass, one soldier at a time      ai/control.ts (13)
      endAIGuysTurn → next on the list → endAITurn → next team
  a tile centre, a stance end, a roof climb, a door: noise, then sight
      duel points → resolveInterruptsVs                         perception/wiring.ts, perception/duel.ts
      the interrupt queue: startInterrupt … endInterrupt        turns/turns.ts
  each attack's end and each death: checkForEndOfBattle         combat/barrier.ts, combat/death.ts
  our turn's start and End Turn: checkForEndOfCombatMode
exitCombatMode → real time; a real-time turn on the next tick
```

| Module | Holds |
|---|---|
| `turns/turns.ts` | Entering and leaving combat, team turns, `beginMercTurn`, the interrupt queue, the end of combat and of the battle, the real-time turn, the enemy-sighting pause |
| `turns/turn-state.ts` | `TurnState`: the original's tactical-status, interrupt and AI-list globals; `intList` is `gOutOfTurnOrder` without its unused slot 0 |
| `turns/ai-list.ts`, `turns/top-message.ts` | The AI list of a team's turn; the top message bar and the AI progress |
| `perception/duel.ts` | Duel points, who may interrupt, the duel, seen opponents, watched locations |
| `perception/sight.ts` | The best-sighting list with its real-time and door resolutions, `handleSight` |
| `perception/noise.ts`, `perception/wiring.ts` | Noise held back while an attack resolves, noise interrupts; the looks at a tile centre, a stance end, a roof climb and a door |
| `points.ts` | APs per turn, `enoughPoints`, `deductPoints`, breath between turns |
| `ai/turn-based.ts`, `ai/control.ts`, `ai/pause.ts` | `startNPCAI`, `turnBasedHandleNPCAI`, `isActionAffordable`, `endAIGuysTurn`; the turn-based gates of `handleSoldierAI`; the AI pause after combat |
| `tactical-sim.ts` | The turn-based checks of our orders, `endTurn`, `isIdle` and the interrupt decision (`29`) |

Native saves restore the turn state and the interrupt queue and drop the enemy-sighting pause (`14`).

## 2. Design

**Who starts.** Out of combat, a look that gives a soldier a new hostile opponent ranks him on the best-sighting list
by his duel points, computed before the sighting is recorded. The list holds three entries, six when all teams look at
once or a door opens. The best's team starts, unless the second and the third are both of another team: then the
second's team starts and the best interrupts it at once. Entering combat stops everyone at his tile centre, cancels the
AI's actions and the player's pending moves, and adds a turn's APs to what everyone has: real time never spends APs, so
everyone starts with a full turn plus the maximum carry-over of 5.

**An AI attack out of combat.** An AI soldier about to shoot, throw or use a knife out of combat starts it himself,
except in a meanwhile: his team's turn begins with him holding it and the computer's turn bar up (deviation "Hidden
attacks start combat"), without a team turn start, the enemy check of `enterCombatMode` or an AI list. The combat entry
cancels his attack too, so he decides again with his new APs; when his turn ends no one else of his team acts, and the
next team follows.

**Team turns.** A round runs our team, the enemy, creatures, militia, civilians, then the end-of-round events (first
aid, smell, smoke and light decay). A team with nobody in the sector is skipped, an AI team with an empty AI list after
its turn start. A turn start decays the team's public opplist and watched locations and runs `beginMercTurn` for each
living member, which turns last turn's unused APs into breath before it adds the new APs (at most 5 carried over, a
debt of up to 100 kept). At our End Turn a merc whose path still has an affordable first step loses his pending move;
one stopped for want of APs keeps it and his freeze into the next turn.

**Where interrupts happen.** Where a soldier looks with the interrupt flag: at a tile centre after the step is paid;
at the end of a stance change when nothing is pending and no attack resolves; at the end of a roof climb; when a door
opens, where all teams look and the door's best-sighting list decides. And wherever a soldier makes a noise in combat:
a step, a shot, a scream, a smashed door, a thrown object landing; noise made during an attack is heard when it ends.
At a tile centre the movement noise comes first, and the look only if the noise caused no interrupt. A turn never
causes one. The duels are against the soldier who looked or made the noise; civilians never duel.

**Who may interrupt.** A looker who gained a new opponent with this look, or a listener who sees nobody and whom the
noise maker sees; never on his own team's turn except at a door, never while an attack resolves. He needs 4 APs and
those of a first reaction, may not be down, gassed, under fire, neutral, an EPC (the robot may) or our merc on another
assignment, and loses the right for the turn once he let an interrupt pass though he could have attacked
(`passedLastInterrupt`). The assignment is the roster's (`narrative/assignment.ts` over `NarrativePort.assignment`); a
soldier the roster does not hold reads as on squad 1, the original's zeroed `bAssignment`. Against one of ours the mover
must be the selected merc, in ja2-node the merc of the last accepted order; against the AI he must hold the AI turn. A
thrown rock's impact gives every eligible listener an automatic win against the thrower. The duel draws no random
number: more points win, a tie goes to the mover, a watcher the mover does not see wins outright.

**The interrupt queue.** The loser goes in first, then the winners of one look by increasing margin; the last entry
acts, so the biggest margin acts first. All trailing winners of one team act together: ours as a group the player
commands, an AI team in the order of its AI list. A loop (A interrupts B who interrupts A) freezes the entries between;
three teams in the queue cancel all but the first team. When the queue runs out, control goes back to the team of the
soldier interrupted first. He stays frozen where it happened (`noAPToFinishMove`) until ordered again or, for the AI,
until he continues his path, also when a loop or a cancelled queue left nobody to act.

**Hidden AI interrupts.** An AI interrupt shows only when an interrupter acts (`npcDoesAct` → `displayHiddenInterrupt`):
our merc freezes and the top message appears. If nobody acts, nothing shows and our merc walks on, unless a sighting
had stopped him.

**What the attack busy count blocks** (`33`). While it is above 0: interrupts, noise (held in `deferredNoises`), AI new
situations, the end of the battle, the interrupt flag of a stance end's look, and our orders and End Turn. At 0 the end
of the attack runs suppression, the noticed attacker's one-on-one duel, combat entry, the held noises with their
interrupts and `checkForEndOfBattle`.

**The AI's turn.** One soldier at a time holds the AI turn (`aiTurnControl`). In combat `handleSoldierAI` runs for
every merc slot on every 5 ms pass, right after that soldier's frame; there is no AI tick. The holder decides only while
his action is NONE; his turn ends when he decides on nothing, cannot afford his action (which halts him) or is marked
moved, and `endAIGuysTurn` passes to the next on the list. Nothing breaks a hang (deviation "Watchdogs").

**Enemy sighted on their turn.** When our merc reveals an enemy on another team's turn, that enemy's animation and all
AI decisions pause for 3000 ms, and a soldier reaching a tile centre meanwhile halts. ja2-node counts the pause in game
time and is not idle while it lasts, so `advance` runs it out (deviation "Enemy sighted on their turn").

**The end of combat.** `checkForEndOfBattle`, after every death and attack, wins when no capable enemy is left (a
soldier in his death animation still counts) and no reinforcements wait, and loses when all our mercs are down, which
may end in capture (`26`). `checkForEndOfCombatMode`, at the start of our turn and on End Turn, ends combat at once when
none of ours sees anyone and no soldier outside our team who is not neutral is on red alert, else at the start of the
second player turn in a row on which nobody has seen a hostile this turn or last. End Turn checks first; when combat
ends, the turn does not (`data.combatEnded`).

**Leaving combat** releases every frozen soldier, drops pending animations and actions, clears the moved flags and the
interrupt queue, hides enemies none of ours sees, pauses the AI for 1500 ms and forces an opplist decay. Its real-time
turn runs on the next tick (deviation "Real-time turn after combat"). APs, opplists and alert statuses stay, except
those of militia and civilians after a victory.

**Time.** World time stops in combat, so the real-time turn and the assignments wait (`15`); tactical ticks go on. An
enemy none of ours sees animates at full speed, but only from the first speed change after the pass that ends his
fade-out (`06`): while he fades and walks on to the next tile his turn takes his own frame delays (deviation "Soldier
fade without merc lights").

**No modal turn UI.** The original hands control to the player and waits for End Turn. ja2-node turns those points into
`advance` stops and the interrupt decision; End Turn also closes an interrupt in our favour (`29`; deviations
"Turn-based UI lock", "Interrupt prompt", "Continue a move").

**Randomness.** Duels and the interrupt queue draw nothing. The AI list draws its skips of neutral civilians on `pre` in
`mercSlots` order; the close-call quote draws `Random(3)` per eligible merc on `main` at every AI soldier's turn end and
at our interrupt; the quotes at the end of a lull or a won battle pick their speaker with `Random(n)` on `main`
(`narrative/battle-quotes.ts`, the bloodcat battle sound excepted: deviation "Battle sound after bloodcats"); a turn
start's bleeding and getting up draw as in `33`; the AI's decisions as in `13`.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/`:

| Quirk | Test |
|---|---|
| The second sighter's team starts combat when the third sighter is on his team, and the best interrupts him; with only two sighters the best's team starts | `turns/turns.test.ts` |
| Combat starts with a full turn plus the maximum carry-over, because real time never spends APs | `turns/turns.test.ts` |
| End Turn judges a stopped merc's move by the first step of his path, not by the step he is on | `turns/turns.test.ts` |
| Three teams in the interrupt queue cancel every interrupt, and the mover stops anyway | `turns/turns.test.ts` |
| A tie in the interrupt duel goes to the mover | `turns/turns.test.ts` |
| The point for an opponent seen before needs a second sighting: the first records −1, the test asks for `TRUE` | `turns/turns.test.ts` |
| Our merc on another assignment gets −10 duel points instead of his own, and the point for an opponent seen before still adds to them | `turns/turns.test.ts` |
| An AI interrupt nobody uses stays hidden, and our merc walks on to his destination | `turns/turns.test.ts` |
| An AI attack out of combat is cancelled by the combat it starts and decided again; the rest of the attacker's team sits that turn out | `ai/combat-ai.test.ts` |
| A soldier in his death animation (life 0) counts as a capable enemy, an unconscious one does not | `turns/end-of-battle.test.ts` |
| A real-time turn comes every 5020 ms: the 5 s test runs on the 20 ms strategic counter | `turns/realtime-turns.test.ts` |
| Any tile moved in a real-time turn zeroes the whole breath gain, not part of it | `points.test.ts` |
| Breath falling below zero wipes an AP debt | `points.test.ts` |
| Combat started after our first sighting in the sector, which ends the virgin sector, leaves the enemy presence unset: `SetEnemyPresence` asks for a virgin sector | `narrative/sighting-quotes.test.ts` |

Not pinned yet:
- A duel won by 127 points or more never interrupts: the margin is a `UINT8` and only margins below `NO_INTERRUPT` are
  queued (`resolveInterruptsVs`). Among equal margins the later team and soldier act first.
- AI interrupters act in AI-list order, not in queue order: `startInterrupt` rebuilds the team's AI list.
- When an interrupt ends, every AI soldier with a new situation is unmarked as moved and acts again, whatever his team.
- `endInterrupt` restores `moved` from `movedPriorToInterrupt` also when no interrupt started (a cancelled queue), so
  it reads what an earlier interrupt saved.
- A scream on another AI team's turn queues that team's soldier who holds the AI turn as the loser, not the screamer.
- An AI soldier who cannot afford an action that is not a move is frozen as if out of APs.
- The swat and crawl bonuses to duel points ask whether the opponent has seen the soldier; the running penalty and the
  seen-before bonus ask whether the soldier has seen the opponent.

## 4. Not checked against the native build

No probe compares duel points, the interrupt queue, team turns or the end of combat; the oracle's soldier dump compares
the APs of a new turn (`apPerTurn`) and the tactical status after a save load (`tools/oracle/README.md`). Inferred from
reading the source:
- Everyone entering combat with a full turn plus 5 carried APs.
- A duel margin of 127 or more needs more shock than hits normally leave; ja2-node keeps the rule.
- `CalcInterruptDuelPts` stores every step in an `INT8`; ja2-node wraps only the result, which differs only below −128.
- That the order lock of deviation "Turn-based UI lock" admits the same orders as `SetUIBusy`.
- Boxing, vehicle and robot branches are ported as read, without probes.

Not ported: gaps "Action points and phobias", "Turn-based hooks", "Drugs and alcohol", "AI decision details" (the
pre-combat grid, the AI list's civilian skip), "Sleeping mercs in combat". Other deviations of this
domain: "Watchdogs", "Enemy sighted on their turn", "Real-time turn after combat", "Turn-based UI lock", "Interrupt
prompt", "Continue a move", "Frame timers", "Soldier fade without merc lights", "Hidden attacks start combat",
"Interface lock on arrival".
