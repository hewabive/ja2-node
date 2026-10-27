# Time, Acceleration and a Server with an API for Agents

*Draft v0.1, 2026-10-15. Supplements [`01-architecture.md`](01-architecture.md) (decisions D13–D16).
The numbers come from the user's copy of `Ja2bin.dat` (Steam, 1.12, Build 04.12.02) and from
Stracciatella code at `ae6bf01`. Paths of the form `Tactical/…` are relative to
`reference/stracciatella/src/game/`.*

*Since M2 the sections that describe what was built carry "Implemented in", "as built" or a milestone in their title; the
rest is the v0.1 design. As of M7 (2026-10-18): §5.9 describes the session hosts and §6.2 the MCP tools as built, and
§6.6–§6.34 the agent API per milestone; the tool descriptions in `src/server/mcp.ts` are the reference for every
command.*

---

## 0. Questions and short answers

1. **Can logic be decoupled from animation?**
   - From *rendering* and from *real time*: yes, completely.
   - From the *game-time duration* of actions: not without changing the mechanics, but there is no need to.
     A duration is just numbers (frames × frame delay). The simulation **computes** them rather than
     **waiting** for them.
2. **Instant execution and arbitrary acceleration?** Yes.
   - The enemy turn is computed without playback and is expected to take tens of milliseconds of CPU
     time.
   - Playback is separated from computation and runs at any speed, all the way to "straight to the result".
3. **Server-side state and agent actions via an API?** Yes, it is feasible.
   - It fits the architecture already adopted well: a DOM-free, deterministic, command-driven
     core.
   - The cost is a protocol and playback layer plus the discipline of "every player action is a command".

---

## 1. What exactly is coupled: numbers from `Ja2bin.dat`

The reconnaissance script [`tools/spikes/ja2bin-timelines.py`](../tools/spikes/ja2bin-timelines.py)
parses `Ja2bin.dat` together with the `gAnimControl` table from the sources. Its output is derived from
the original's data and is not committed to the repository.

**What the file contains:**
- 308 non-empty scripts out of 311 animation states;
- 144 distinct opcodes, 54 of which affect gameplay (group (b) of report [`03`](03-logic-animation-coupling.md)).

**Examples:**
- `SHOOT_RIFLE_STAND`: 4 frames of 100 ms each. The misfire check (470) and the fire opcode (430) come *before the first
  frame*, i.e. the shot happens the moment the state is entered.
- `STANDING_BURST`: 15 frames of 100 ms each, fire on frames 0, 2, 4, 6, 8, 10, i.e. one bullet every
  200 ms.
- `THROW_ITEM`: the grenade is released (460) on frame 9 of 14.
- `OPEN_DOOR`: the door opens (495) on frame 10.
- `CLIMBUPROOF`: 44 frames of 30 ms each, the climb commit (408) at the very end.

**Duration of typical actions.** A merc with 80 agility, full health and full breath walking on
flat ground. The frame-delay formula is `CalculateSoldierAniSpeed`, `Tactical/Soldier_Control.cc:4763`.

| Action | Game time | 5 ms ticks |
|---|---|---|
| One tile walking, turn-based combat / real time | ≈120 / ≈245 ms | 24 / 49 |
| One tile running | ≈70 / ≈140 ms | 14 / 28 |
| One tile crawling | ≈220 / ≈455 ms | 44 / 91 |
| Aimed shot: from order to bullet, no turning | 750 ms | 150 |
| Snap shot | 350 ms | 70 |
| 6-round burst | 1500 ms | 300 |
| Grenade: from order to release | 720 ms | 144 |
| Open a door | 700 ms | 140 |
| Climb onto a roof (map vision is disabled the whole time) | 1320 ms | 264 |
| Falling forward after a hit, until "death or release" | 2280 ms | 456 |

**Conclusion.** Everything the game "waits for" amounts to hundreds of milliseconds set by tables. This is not
rendering but a *schedule*: "150 ticks after the order, the fire marker". The simulation does not need to
draw anything to honor it.

**The original does this itself.** In turn-based combat, soldiers the player cannot see get a frame
delay of 0 and are animated on every pass of the loop (`Tactical/Soldier_Control.cc:4928–4936`).
In other words, JA2's turn-based logic was designed from the start so that playback speed does not
affect the outcome.

---

## 2. Three levels of decoupling

| Level | How it works | Instant and accelerated | Behavior |
|---|---|---|---|
| 0. Original | Logic runs inside the frame loop, delays are counted by the wall clock | No (except for unseen enemies) | — |
| 1. Timelines as data (D4) | The simulation counts ticks and executes gameplay markers; it contains no rendering | Yes: ticks are run through without playback | Same |
| 1b. Event jumping | Level 1, but the scheduler jumps straight to the next marker, tile or bullet step | Yes, another 10–100 times faster | Same (verified by an equivalence test against level 1) |
| 2. Atomic actions | A command is resolved in full at once, the time inside the action is discarded | Yes | **Changes** |

**What level 2 loses**, and why we do not adopt it:
- a burst at a falling target: later bullets aim at its new final height (`03`, §3);
- in real time, races: who gets there first, who sees whom first, who stepped into the bullet;
- delaying explosion damage until the keyframe, chain explosions with intervals, vision being disabled for
  the duration of an explosion;
- the "door busy" window and vision being disabled for the duration of a roof climb;
- an NPC cancelling a throw before release without being charged AP.

**Decision.** Level 1 gives both instant execution and accuracy, so there is no need to choose between them.
Level 1b is an optimization. We enable it only if profiling shows a need for it. To keep this
option open, every subsystem can name the tick of its next event
(`nextDue`), and the core has no "every tick" work that cannot be expressed this way.

---

## 3. Audit: where the original depends on things the simulation does not have

| Dependency | Where in the code | Our approach |
|---|---|---|
| Animation frames are counted by the wall clock, with no catch-up | `Utils/Timer_Control.cc:155–181` | Ticks. The model is "an ideal machine that never drops frames" |
| Unseen enemies in combat: frame delay 0, speed equals the loop rate | `Tactical/Soldier_Control.cc:4928–4936` | One frame per tick. Affects only the pace of turn-based playback, not the outcome |
| Bullet: one step no more often than every `bulletSpeed/10` ms and no more often than once per loop frame | `TileEngine/LOS.cc:3155–3184` | N tiles per tick, deterministically (deviation) |
| Real-time AI: "how many soldiers can we fit into 10 ms of CPU" | `Tactical/Overhead.cc:1041–1052` | A fixed number of soldiers per pass (deviation) |
| 3 s pause "enemy sighted on their turn" | `Tactical/OppList.cc:2588–2602` | Playback only. The simulation does not wait for it |
| Quote duration: the length of the sound if speech is on; 60 ms per character without speech | `Tactical/Faces.cc:629–636, 1233`; `Tactical/Dialogue_Control.cc:67, 1521` | Always 60 ms per character in the simulation: deterministic and audio-free. On the client the sound plays for as long as it plays (deviation) |
| Logic waits for an empty quote queue: NPC hostility, the AI of Sergeant, Mike and Joe, notifications | `Tactical/OppList.cc:559`; `TacticalAI/AIMain.cc:281`; `Tactical/Overhead.cc:840, 6205` | "Speech channel busy until tick T", where T is computed as in the row above |
| Message boxes and dialogues with choices | UI screens | Decision prompt (D15). Time stands still until an answer arrives |
| Deferred calls at 2, 3 and 10 s; bomb queue `1000 + Random(500)` ms | `Tactical/Overhead.cc:5069–5073, 6210`; `TileEngine/Explosion_Control.cc:2054–2095` | Ticks |
| Watchdog timers at 15 and 25 s (break hangs) | `TacticalAI/AIMain.cc:366–380`; `Tactical/Handle_UI.cc:405–419` | Not ported. A hang is a bug, and the test must fail |
| Idle animations consume the shared RNG and change soldier state | opcode 491 | Client only, the `fx` stream |
| "Render visibility" `bLastRenderVisibleValue` | `Tactical/Overhead.cc:602–634` | Not actually rendering: the field is updated in the logic loop. Ported as a state field |

**In total:**
- logic depends on rendering nowhere (the field with "render" in its name is actually a logic field);
- on the wall clock: a finite list of places, all of which are converted to ticks;
- on sound: only quote duration. We replace it with the formula the original uses
  without speech.

All deviations go into `docs/deviations.md`.

---

## 4. Time control

### 4.1. Three clocks

- **Simulation game time** in ticks is the only thing the outcome depends on.
- **Wall-clock time** exists only in the *driver*: the driver decides when to advance the simulation.
- **Playback time** belongs to the client. It lags behind the simulation or catches up with it at any speed.

### 4.2. `advance` and stop conditions

```ts
type StopCondition = {
  idle?: true;              // turn-based combat: the turn is back with the player and all effects have settled
  events?: SimEventKind[];  // e.g. EnemySighted, SoldierHit, Quote, Arrived
  ticks?: number;           // no longer than N ticks
};                          // a decision prompt always stops

interface StopReport {
  tick: number;
  reason: 'idle' | 'decision' | 'event' | 'ticks';
  events: SimEvent[];
}

sim.advance(until: StopCondition): StopReport;  // internally the same step()
```

As built (M4–M7) a campaign's `advance` also takes world-time targets (`worldTime`, `worldSeconds`, `compressionStopped`,
`mode`, `docs/15` §6), and the report's `reason` is one of `idle`, `event`, `ticks`, `worldTime`, `budget`, `refused`
(with `refusal`), `decision` or `ended`; subscribers of a session loaded in place get `stopped {reason: 'loaded'}`
(§6.22).

### 4.3. Drivers

| Driver | Who advances time | Purpose |
|---|---|---|
| Real time ×k | The server: ticks by the wall clock × k (k = 1, 2, 4, …), auto-pause on decision prompts | A human in the browser |
| Instant | `advance` until `idle` or a decision prompt at full CPU speed, after every accepted command (`{mode: 'instant'}`) | The enemy turn "at once", auto-resolve, tests |
| Manual | Only explicit `advance` calls from the client | An agent via the API, step-by-step debugging |

**Turn-based combat** gives the same outcome under any driver.

**Real time** also gives the same outcome if commands arrive at the same ticks. But an agent
that issues orders while paused is a player with zero reaction time:
- The original can pause tactical play, but it covers the screen with a mask: any click or key
  unpauses, and orders are not accepted while paused (`Strategic/Game_Clock.cc:795–835`,
  `Tactical/Turn_Based_Input.cc:2126`).
- So this is a small advantage for the player, not a rule change.
- And the advantage is short-lived: a spotted hostile enemy immediately switches the game to turn-based
  mode.

### 4.4. Playback at any speed

The simulation writes an event log with tick stamps:
- animation start: state, frame delay, position, direction;
- moving to another tile;
- shot and bullet path, hit;
- explosion, quote, sound.

From this log and the same timelines, the client reconstructs the picture frame for frame:
- **1×**: as in the original;
- **2–16×**: faster (frames are played more often or skipped);
- **"skip"**: events are applied without animation, the result is visible immediately;
- **"unseen instantly, seen at 1×"**: essentially the original's behavior.

While playback catches up with the simulation, input is blocked, just as the original blocks the UI during actions.
Rewind and replay come for free: the log is deterministic.

**Implemented in v0 (M2).** Instead of reconstructing the picture from gameplay events, the session
records *view frames*: every 10 ticks (50 ms) it diffs the player view and keeps only soldiers that
changed (`src/protocol/view.ts` `diffView`/`applyFrame`, `src/server/session.ts`). An instant
`advance` therefore produces a compact frame stream that the browser plays back at any speed. Fine
animation between frames is reconstructed by the client from the same animation scripts. Since 2026-10-26 a soldier
whose silent animation the client can predict from its last sent frame slot and `nextFrameTick` is not resent for the
frame alone, and a capture without changes sends an empty frame while such a prediction is running (`docs/28` §2.3). The richer
event log above stays the target once combat effects (bullets, explosions) appear.

**Implemented in M3.** Under the instant driver the session runs every accepted command (and the switch to the
driver) to `idle` or a decision prompt and streams the frames at once; the tactical page plays them back at 1×, 4×
or 16× (`SessionClient.playFor`) or applies them all with "skip".

The player view lists our soldiers (with AP, life, life max and breath), the militia and only those
others the squad currently sees (`bVisible ≥ 0`, `docs/08` §2.7), plus the gridnos of every open door (the
map holds many doors open, A9 70 of its 73) and,
in turn-based combat, `combat {team, round, interrupt}`, and the items the squad has seen on the ground
(`items [{gridNo, level, item, count, status}]`); frames carry the changed soldiers and, when they change,
the full door list, the item list and the combat block. Simulation events (`arrived`, `stopped` with a
reason such as `outOfAPs`, `noPath`, `doorChanged`, `noiseHeard` with a direction but never a grid,
`enemySighted`, `combatStarted`, `turnStarted`, `interrupt` (only once it is visible), `interruptEnded`,
`combatEnded {reason: lull|won|lost}`, `shotFired {soldier, target?, chance?, hit?, heard?}`, `bulletStopped {reason}`,
`soldierHit {soldier, attacker, gridNo?, location, special, conscious, damage?, breathLoss?, life?, unseen?, heard?}`, `soldierDied {soldier, killer, gridNo?, unseen?, heard?}`,
`gunJammed`, `statChanged`, `attackResolved`, `meleeStrike`, `explosion`, `structureDamaged`, `itemsPickedUp`,
`itemDropped`) are returned by `advance`. In combat `advance … idle` returns
when it is our turn again and none of our soldiers is acting; an interrupt in our favour stops it with
reason `decision` (act with the soldiers that have not moved, then `endTurn`).

**Commands (M3 turn-based core):** `move {soldier, to, mode?: walk|run|swat|crawl}` (without a mode the merc
moves in his stance, a mode is for this move only and he ends it in that mode's stance; in combat refused unless the
first step plus any stance change is affordable), `turn {soldier, direction | toward}`,
`stance {soldier, stance: run|stand|crouch|prone}` (§6.29), `stop {soldier}`,
`endTurn`, `attack {soldier, target, level?, aimTime?: 0..4, bodyPart?: head|torso|legs|random, burst?}`
(`HandleItem` with what is in hand: gun, throwing knife, grenade launcher, thrown grenade or rock, knife or fists; refusals: no APs,
no ammo, broken weapon, out of melee reach, an aimed throw) and `estimateAttack` with the same
fields, a query that changes nothing and answers `data {apCost, actionPoints, chanceToHit, chanceToGetThrough}`.
`pickUp {soldier, gridNo?, zLevel?, items?}` picks up the visible items on the soldier's tile (or on an adjacent
blocked tile; `items` are indices into that tile's list, default all) for `AP_PICKUP_ITEM`; `drop {soldier, slot?, count?, index?}`
drops a slot (default the hand) at the soldier's feet; `climb {soldier}` climbs onto the adjacent roof edge or
down from the roof (`FindHigherLevel`/`FindLowerLevel`).
Orders are accepted only on our turn, when no attack is resolving and no other merc of ours is acting
(`docs/10` §9, `deviations.md` "Turn-based UI lock"); `idle` also waits for bullets, queued game events and any
of our soldiers still playing a one-shot animation (getting up, picking up, climbing).

**Implemented in M7 (S8, sound).** View frames also carry the events drained during an advance (`ViewFrame.events`,
attached to the frame of their tick), so a browser client receives the same event log an agent gets in `advance`
reports. Presentation fields, optional and never part of the state or an outcome: `shotFired {item, silenced, burst,
rounds}` (`rounds`: the burst size on the first bullet of a burst, 0 on the later ones, 1 for a single shot),
`bulletStopped {material, caveWall}` (the hit structure's material), `explosion {animation}` (the animation shown,
the water variant included), `doorChanged {kind: wood|cloth|garage|metal, noisy}` and the new event `reloaded {soldier,
item}`. Soldier entries in the view carry `voice`: the battle-sound voice, the profile's voice id as three digits
(I.M.P. voices included) or the generic `badN`/`kidN` set of soldiers without a profile; with `bodyType` it selects the
`m_`/`f_` fallback. The client derives all sound from these events, the frames and the animation codes it replays
between snapshots (`docs/27` §3.6); agents get the same events and never audio.

**Bullets in flight.** After every tick the session records where each bullet is that the original draws as a
bullet tile (not knives, missiles, flames or spit), but only for our soldiers and the soldiers the squad sees
(`shownToPlayer`, `deviations.md` "Bullets of unseen shooters"), and sends those positions in the next frame
(`ViewFrame.bullets [{tick, x, y, z}]`: world x and y in cell units, `z` the height in pixels as the original's
`sRelativeZ`). A whole flight takes a few ticks and usually falls between two frames, so a frame carries every tick,
not only its own. Like `messages`, the field is never applied to the view and never reaches an agent's view or a save. The
client keeps the positions it has received (`BulletTrack`) and draws those of the tick it shows, rounded down
(`docs/05` §2.6). The simulation's pacing does not change; the hide-bullets option only stops the drawing. A shooter
in the dark whom the squad sees only in his muzzle flash shows once his attack is over: his gunshot is heard only then
(`MakeNoise` holds noises while an attack is busy), so his bullets are not drawn.

**Impact animations.** Where the original starts a cosmetic animation tile, the simulation emits an event with
presentation fields: `bulletImpact {soldier, gridNo, x, y, z, effect}` wherever `StructureHit` plays a miss (`dust`,
`splash` in low or deep water, `miniboom` for a stopping HE or HEAT round, which also frees the shooter at once) and
where `WeaponHit` plays the HE miniboom on a soldier, and `windowShattered {gridNo, tile}` (the `WINDOWSHATTER` tile the
glass falls from) when a bullet, a blast or a thrown object shatters a window, and `missileTrail {gridNo, x, y, z,
trail: smoke|small|spit, delay}` wherever `MoveBullet` leaves a trail behind a rocket, a rocket-rifle round, a flame or
creature spit (`AddMissileTrail`; the browser picks the `Random(100)` part of the frame delay itself, flames carry
their fixed 100 ms) and behind a mortar shell (with its `PreRandom` delay), `waterRipple {gridNo, x, y, z}` where a thrown object falls into water, and on
`explosion` the presentation fields `x, y, z` (where the blast is drawn) and `delay` (the animation's blast speed). Agents
get them like any event.

Because a tactical event's `tick` is the tactical simulation's and a campaign's view ticks run on, the session also copies these
events into the frame of the tick it stepped them in (`ViewFrame.effects`, stamped with the session tick). The client
plays each one from that tick on its own clock of view ticks (`EffectAnimations`), and while bullets fly or effects
started in the last two seconds, the session sends a frame every 10 ticks even when nothing else changed, so the
client's time keeps running until they end.

**Thrown knives.** A knife in flight is in `ViewFrame.bullets` too, with `knife {anchor, direction, since}`: the tile the
original hangs its `knifing.sti` animation tile and shadow on (the thrower's), the direction block of the sprite and the
session tick the knife was first seen at, from which the client takes the frame (the fourth of the block first, then
one more every 100 ms). The session's simulation adapter keeps that tick per bullet object; nothing is stored in the
state. A thrown object in flight (a grenade, a rock, anything thrown or launched except an armed mortar shell, which
only leaves its trail) is there with `item` (its internal name), at its position and height above the zero plane; the
same visibility rule applies to its thrower.

**Sounds of the shooting.** The sounds come from the same events where the original plays them: a gun's miss sound
from `bulletImpact` (`MISS_G2` at height 0, else one of `MISS_1..8`; the HE miniboom plays `SMALL_EXPLODE_1`), the
material a bullet strikes from `structureStruck {soldier, gridNo, material, caveWall?}` (`DamageStructure`, also for
bullets that pass through), a bullet leaving the map from `bulletStopped {reason: offMap, explosiveAmmo?}`, the glass
from `windowShattered`, a merc cursing a miss (`Random(40) == 0` for our single shots that hit a structure, and for our
shots that leave the map; the browser draws it on `bulletImpact` and the off-map `bulletStopped`), creature spit gas from `creatureGas {gridNo}`, a thrown
object landing from `thrownImpact {gridNo}` (the first time it hits the ground or a roof, and where it comes to rest on
either) and the mortar whistle from `mortarWhistle {sounding}` (on at the top of an armed shell's arc, off when it
ends). A knife thrown at a structure keeps its knife miss sound on `bulletStopped`.

**Soldier sounds.** Footsteps, stance sounds and battle sounds follow the soldier view: a merc in stealth mode
(`stealth`) plays no footstep or stance sound (`PlaySoldierFootstepSound`), except the stealthy footstep the simulation
reports as `stealthyFootstep {soldier}` on each new tile where our merc in stealth mode makes movement noise
(`HandleAtNewGridNo`, `PlayStealthySoldierFootstepSound`); a `muted` merc plays no battle sound at all; the low-morale
confirmations use the view's `morale`. A creature's call reports its kind as `creatureCall {soldier, call:
onePrey|multiplePrey|attacked|crippled}` (`CreatureCall`, the AI's `usActionData`), and the browser cries it at code 717
of the call animation (`ACR_SMELL_PREY`, `ACR_SMELL_THREAT`, `ACR_CRIPPLED`; the queen's `LQ_SMELLS_THREAT`,
`LQ_ENRAGED_ATTACK`, `LQ_CRIPPLED`). The idle sounds of cows and crows (`RANDOM_ANIM_SOUND`) need no event: the browser
runs code 491 for each pass of a loop that holds it (counted from the frame delay on the view clock, as a predictable
loop sends no frames), every third pass rolls `Random(100)` on the browser's generator against the body's entries, and
an injured (health `critical` or worse), wet or not standing animal stays silent. A struck vehicle (`soldierHit` on a
vehicle body: all its damage but gas comes through `EVENT_SoldierGotHit`) rings its metal (`VehicleTakeDamage`,
`S_METAL_IMPACT3`) and plays no bullet impact and no battle sound of its own; boarding a ground vehicle on the map
screen (`vehicleBoarded`) plays its enter sound, the helicopter none.

**Sounds out of sight.** A sound whose source the squad does not see reaches the player as the squad hears it, never as
a tile (`08` §3.6): the event carries `heard {by, direction, volumeClass}` (the merc of ours who hears it loudest by
`CalcEffVolume`, the side it comes from as `TellPlayerAboutNoise` names it, `pDirectionStr` or above or below, and the
loudness class of `pNoiseVolStr`) instead of the source's grid, and the browser plays it from that merc's tile, 4, 10,
18 or 30 tiles off in that direction for very loud, loud, definite and faint (`heardSoundTile`), so volume and pan fall
off as the original's do. A sound nobody of ours hears (our mercs are deaf on our own turn, as `CalcEffVolume` makes
them) plays in the middle at the off-screen volume (`max(25, v - 25)`). A source the squad sees, or one whose tile the
player already sees (the victim of our soldier's bullet, whose track ends there), plays at its tile. This covers the
shot of an unseen shooter (`shotFired` drops `target`, `chance` and `hit` and carries `heard` from the gunfire noise),
the impact and cries of an unseen victim (`soldierHit` and `soldierDied` carry `unseen {voice, bodyType}` and `gridNo`
only when the attacker is seen or ours, else `heard` from the scream; `life`, `damage` and `breathLoss` only come for
soldiers the squad sees, `conscious` tells whether he still cries out) and the call of an unseen creature
(`creatureCall` with `unseen {bodyType}` and `heard`; the browser roars and cries it on the frames of `MONSTER_UP` or
`QUEEN_CALL`). A death cry and a creature's call make no noise in the original; they are heard as loud as the crier's
loudest scream (`CalcScreamVolume`'s cap of 10 − experience level). The sounds of an unseen soldier's animations stay
silent, as `PlaySoldierJA2Sample` skips soldiers out of sight.

### 4.5. CPU cost

**Estimate for a turn of 15 enemies.** Each moves ~6 tiles (≈0.7 s), shoots (0.35–1.15 s),
and the target reacts (0.4–2.3 s). That adds up to 30–60 s of game time, i.e. 6–12 thousand ticks.

**A tick without decisions** is a pass over 30–60 soldiers incrementing accumulators: microseconds.

**AI decisions** are the expensive part: pathfinding on a 160×160 grid and LOS. But the original computed them in
real time on a Pentium 200.

**Expected:** tens, at worst hundreds of milliseconds per enemy turn without playback. If that is not enough: event
jumping (1b) and a worker.

**Measured (M3, 2026-10-15)**: A9 battles on the original data, one core of an AMD EPYC 9354 VM, the instant driver
(`advance … idle` after `endTurn`), wall time of the whole enemy side including the civilians:

| Garrison | Enemy turn | Ticks (game time) |
|---|---|---|
| 4 soldiers + 2 civilians | 1–90 ms, most under 50 ms | 40–1,000 (0.2–5 s) |
| 16 soldiers + 2 civilians | 2–370 ms, typically 100–250 ms while all are alive | 100–4,900 (0.5–25 s) |

AI decisions (cover search, paths, sight) dominate; ticks without decisions are almost free. No event jumping or
worker is needed for now.

**Measured again (M7 S4, 2026-10-18)** with `pnpm cli bench enemy-turn` on the original A9, the D13 save and a
generated arena with 8–32 enemies, and with the `server` scenario: an instant enemy turn blocks the event loop for its
whole duration (0.3 s for one battle, 1.2 s with four in one process), so the worker host of `27` §7.5 is needed once
instant battles share a server with other sessions; numbers in `27` §7.1 and §7.3.

**Since M7 S12** the in-process host runs advances in 10 ms slices, one per event-loop turn across sessions, and
`JA2_SESSION_HOST=worker` puts each session on its own thread (§5.9): the longest event-loop stall while one session
runs an instant battle drops to 28–30 ms at the median (36 ms at most), 35–42 ms with four battles and sixteen viewers,
and a 16-enemy turn costs 131 ms at the median and 274 ms at the 95th percentile on the original arena (`27` §7.3).

---

## 5. The server as the source of truth

```
             ┌───────────────────── Node: ja2-server ──────────────────────┐
 browser ◄──►│ WebSocket    ┌──────────────── session ───────────────┐     │
 (client)    │              │ Sim (core) · time driver               │     │
 agent   ◄──►│ MCP          │ command log · saves                    │     │
 (Claude)    │              │ player-view projection                 │     │
 scripts ◄──►│ HTTP JSON    └────────────────────────────────────────┘     │
             │ /vfs: media from JA2_DATA_DIR or from the stub pack         │
             └─────────────────────────────────────────────────────────────┘
```

### 5.1. Session

- Consists of a `GameState`, a driver, subscribers and a command log.
- Logic content is loaded once and shared by all sessions, read-only. As built (M7, §5.9) this holds for the default
  in-process host; the worker host loads the content once per session in its worker.
- As built in M8 (U0b, §5.10) every session loads its logic content from the server's rule pack, never from the raw
  data, and reads no graphic.

### 5.2. Protocol

There is one protocol for all clients. It lives in `src/protocol` and depends on neither the DOM nor Node.

```ts
type ClientMsg =
  | { t: 'cmd'; id: number; cmd: Command }                  // game action
  | { t: 'answer'; id: number; prompt: PromptId; choice: string }
  | { t: 'advance'; id: number; until: StopCondition }
  | { t: 'drive'; mode: 'realtime'; speed: number }
  | { t: 'drive'; mode: 'instant' }
  | { t: 'drive'; mode: 'manual' }
  | { t: 'query'; id: number; q: Query };                   // hit chance, path, AP, LOS

type ServerMsg =
  | { t: 'snapshot'; tick: number; view: PlayerView }       // on connect and after stops
  | { t: 'events'; events: VisibleEvent[] }                 // stream with tick stamps
  | { t: 'result'; id: number; ok: boolean; reason?: string; data?: unknown }  // data: quotes, shop, contract terms
  | { t: 'prompt'; prompt: Prompt }
  | { t: 'stopped'; report: StopReport };
```

As built (`src/protocol/messages.ts`, M2–M8): the client sends `hello {session?}`, `cmd {id, cmd}` (prompt answers are
commands of type `answer`), `advance {id, until}`, `drive {id, driver}` (a real-time driver may carry `pauseOn`, §6.25),
`save` and `load` (§6.22), `closeSession {id}` (§6.25) and `query {id, q}` (§6.26); the server answers
with `welcome {session, view, driver, messages, engine: {version, commit}, rules: {pack, scripts}}` (also after a load in place;
`engine` and `rules` since M8, §5.10, `messages` since U3a, §6.25), `frames` (view diffs every 10 ticks with the events
and message entries of their tick, §4.4), `result {id, ok, reason?, data?}`, `answer {id, ok, tick, reason?, data?}` (§6.26),
`stopped {id, report}` and `error`. Queries change nothing (`estimateAttack`, the cursor hints, `quoteTrade`,
`inventory`, …); since M8 they are answered outside the input queue and the input log, also when they arrive as
commands (§6.26).

The WebSocket endpoint negotiates `permessage-deflate` with the context kept between messages (messages from 128 bytes
on). A frame resends every field of a changed soldier, so an idle A9 sandbox in real time streams about 25 frames a second
for the breathing animation alone: 40 KB/s uncompressed, about 1 KB/s compressed (measured 2026-10-25).

### 5.3. Player-view projection (D16)

- `view(side)` is a single function for both the browser and agents.
- The projection includes visible enemies, heard noises (as direction and loudness), and known
  doors and items.
- Unseen enemies appear neither in the snapshot nor in the event stream.
- An "omniscient" mode exists for debugging only.

### 5.4. Queries

- The same rule functions as the simulation uses, but on top of the projection, so that hidden information
  does not leak.
- For the cursor in the browser this is ~1 ms over localhost. If needed, they can run directly in
  the client.
- As built (M8, U3b, §6.26): the player-knowledge projection (`src/sim/knowledge/`) and the hint functions
  (`src/sim/hints/`) run on the server for agents and on the client for the cursor, over the same view.

### 5.5. Saves and the log

- Stored as files on the server (`$JA2_SAVE_DIR`, default `.ja2/saves/`), named, never addressed by path (§6.22).
- Every session keeps an input log (commands, answers, advances, real-time batches as tick counts, map preparation,
  reseeds, loads) from its origin; a save carries it as `<name>.log.jsonl.gz`, and `pnpm cli replay <name>` re-runs it
  and compares the result with the save byte for byte. This serves bug reports, regression tests and analyzing an
  agent's play.

### 5.6. Determinism and multiple sessions

New rules apply to the core.
- **Forbidden:** `Math.random`, `Date`, timers, and also `Math.sin`, `cos`, `atan2`, `exp`,
  `pow`. The results of the latter may differ between engine versions, so we write the functions we need ourselves
  in `core/math`, using tables or polynomials.
- **No global mutable module state:** several sessions may live in one
  process.
- Enforced by a linter and by the test "two sessions in one process with the same seed produce the same
  log".
- As built, `tools/check-imports.ts` bans `Math.random`, `Date`, `performance.now` and timers in `core`, `content` and
  `sim`; the trigonometric functions were not replaced: the movement, sight and throw code calls `Math.sin`,
  `Math.cos` and `Math.atan2` and rounds to float32 where the original uses float math (deviations "Physics cadence and
  floats"), which V8 computes with its own fdlibm-derived code on every platform.

### 5.7. Embedded mode

- The core depends on neither the DOM nor Node, and the protocol is just messages. So the same session can
  be brought up in a Web Worker right in the browser, for example for a static demo on stubs.
- This is not a priority, but it comes almost for free as long as the layer boundaries are respected.

### 5.8. Security

- By default the server listens only on `127.0.0.1`. Access is by token.
- The API accepts only game commands, never file paths from the client.
- As built: `JA2_HOST` and `JA2_PORT` (default `127.0.0.1:7420`) set the address; `/api`, `/vfs` and `/mcp` take the token
  of `.ja2/token` as `Authorization: Bearer`, the HttpOnly cookie set by `/login?token=…` or a `token` query; a Host
  check guards against DNS rebinding; saves are addressed by name only (§6.22).

### 5.9. Heavy sessions (as built in M7, S12b)

The server surfaces (MCP tools, the WebSocket endpoint, the HTTP routes) never touch a `Session` directly: they call a
`SessionHost` (`src/server/session-host.ts`), an asynchronous interface with `dispatch`, `prepareAndDispatch`,
`advance`, `setDriver`, `subscribe`, `save`, `saveSnapshot`, `load`, `describe`, `observe`, `report` (what a new session
reports once: the load outcome, the native import report), `snapshot` (the session snapshot text a save would hold),
`inputLog` and `close`. `JA2_SESSION_HOST` picks one of two implementations for every session of the server:

- **`inprocess`** (default): `InProcessHost` keeps the session in the server's thread.
  - *One queue per session.* Every input (commands, answers, advances, driver changes, saves, loads, the snapshot, the
    input log, close) runs in arrival order, one at a time, even when calls arrive while an advance is running; so the
    input log's order is the execution order. Reads (`describe`, `observe`, `report`) and `subscribe` answer at once,
    between ticks: during a long advance they show the state reached so far. A WebSocket connection sends its replies
    in the order of its requests.
  - *Time slicing.* An advance, including the one the instant driver runs after an accepted command or a driver
    change, runs in slices of `SLICE_BUDGET_MS` (10 ms) of wall-clock time and then yields to the event loop. The
    simulation's `advance` is a resumable `AdvanceRun` whose `resume(pause)` checks the pause predicate only between
    ticks, after at least one step, and after the stop checks; resuming goes straight to the next step. The session's
    inputs are generators that yield at those pauses: the synchronous `Session.dispatch` / `advance` / `setDriver`
    (replay, bench, tests) drive them without pausing, the host's sliced variants pause. Slicing decides where the
    server pauses, never what a tick does: ticks, events, frames, reports and snapshots are those of an unsliced run
    (tested frame for frame with a slice after every step). One `SliceScheduler` per server grants at most one slice
    per event-loop turn: an advance claims a turn before its first slice and waits for one when another session has
    already run a slice in that turn or is waiting; a taken turn closes at the next check phase and the next waiting
    session is granted one turn later. So four battles in one process never run slices back to back, and commands that
    need no advance run at once. The frames collected so far go out at every pause, so viewers watch a long enemy turn
    as it happens. While a sliced input is paused, the real-time driver skips its batch (its timer catches up
    afterwards, as it does after any stall).
  - *What still blocks.* A single tick cannot be split: the longest AI decision of a tick (up to about 30 ms warm, 65
    ms in a cold process) is the floor of the stall. A save's snapshot and its stringify are synchronous (each about
    40–70 ms on the largest native import, also for the autosave when `endTurn` is accepted in combat); the gzip runs
    on the thread pool. Opening a session and loading a save build the content (0.2–0.5 s).
- **`worker`**: `WorkerHost` runs each session in its own `worker_threads` worker and forwards the same calls and the
  subscription messages (structured clone). The worker opens its own data VFS from the same directories and its own
  save environment with the server's engine identity and save directory (`openSessionEnvironment`), builds the session
  and writes its save files itself (atomic renames, so two workers never leave a torn file), so no simulation object
  crosses the thread boundary; inside, the session runs in an `InProcessHost`, so the ordering and reads are the same.
  Load problems keep their kind across the boundary (`SaveLoadError`). The trade-off: every worker loads the content
  again (its own data VFS and content, about 100–140 MB more RSS per session on the original data) and builds its own
  content index on its first save, but battles, saves and loads of different sessions run on different cores and the
  server thread only relays messages. The Auto01/Auto02 alternation is kept per worker (each continues from the older
  file). A host whose worker died answers every call with that error; `GET /api/sessions` lists it with the error.

The same contract test (`src/server/session-host-contract.test.ts`) drives a scripted stub battle with a save, an
autosave and a load, calls made without waiting, and Dead is Dead through both hosts and expects the same results,
frames, snapshots, input logs and save files.

The session also skips the frame views nobody receives: with no subscriber it still follows the music mode from the
events at every frame point, but builds and diffs no view; the first subscriber's welcome becomes the base of the next
diff.

### 5.10. The rule pack and the assets (as built in M8, U0b and U0c)

The game data splits into the **rule pack** (everything the simulation reads) and media (`28` §1.3, §2.5, §17.4).

- **The rule pack** (`src/content/rules/pack.ts`, `src/server/rule-pack.ts`). At start the server builds the pack from
  its VFS (original data or stubs) and caches it in `.ja2/cache/rules-<all-layers hash>/` (`JA2_CACHE_DIR` moves the
  cache; `rules-index.json` finds it by a key over every VFS file's path, size, layer count and stamp, so a change of
  the data rebuilds it). It holds the rule files (project tables, `ja2bin.dat`, `ja2set.dat`, `prof.dat`, `locks.bin`, maps,
  structure files, NPC records, text files, the stub profiles) and the **graphic facts** (`@rules/graphics/<path>.json`:
  the frame geometry and app data of the tileset surfaces and the explosion animations), and refuses every other path.
  Sessions read their content through it, so the simulation never reads an STI file. Its hash (inputs by content hash,
  text files by presence) is the logic hash of the content identity and covers only the **game data**: the entries whose
  winning VFS layer is the data folder or an SLF archive on the original data, the stub pack on the stubs (U0c). The
  project tables (`ja2-node-data`) and, on the original data, the stub pack stay in the pack but not in the hash: they
  ship with the engine, whose version and commit the save header and `welcome` carry. Every entry records its layer;
  the all-layers hash (U0b's identity over every entry) names the cache directory. Its scripts' hash is the content hash
  of the animation scripts. The animation scripts are split at load into a logic timeline the simulation steps and a
  presentation timeline the views take the sprite frame from.
- **`welcome`** carries `engine: {version, commit}` and `rules: {pack, scripts}`; a client compares them with its own
  code and data (`src/app/rules/client-rules.ts`). `/api/health` names the pack too.
- **`GET /api/assets/manifest`** → `{format: 'ja2-node-assets', version: 2, source, stubText, layers, files}`: `layers`
  names the VFS layers in priority order, `files` holds `[path, size, hash, layer]` per VFS file (`[path, size, hash,
  layer, layers]` when the path is in several layers), `layer` = the index of the winning layer in `layers` (so a client
  applies the same identity scope), `hash` = the first 16 hex digits of the file's SHA-256; gzipped when the client
  accepts it, revalidated by ETag. Hashes are computed on demand and kept in `.ja2/cache/vfs-hashes.json` by file stamp (SLF archive path, size and mtime plus entry offset and length; loose
  files by path, size and mtime), so a restart reads no file again.
- **`GET /vfs/@<hash>/<path>`** answers with `cache-control: private, max-age=31536000, immutable` when `<hash>` is the
  file's current content hash, 404 when it is not (the client fetches the manifest again), 400 for a malformed hash;
  ranges work as on `/vfs/<path>`. Plain **`/vfs/<path>`** stays for tools and agents: `cache-control: private,
  no-cache` with the content hash as a strong ETag (before M8 the ETag changed at every server start). Both take the
  token like every `/vfs` route. A whole-file read from a client that accepts gzip gets the file gzipped when it is at
  least 1 KB, not in an already compressed format (ogg, mp3, smk, bik, png, jpg, gz, zip) and at least 10% smaller
  compressed, under the ETag `"<hash>-gzip"` (`Vary: Accept-Encoding`); ranges stay uncompressed. The compressed files
  are kept in memory by content hash, 64 MB least recently used (`src/server/vfs-gzip.ts`). The files of the A9 tactical
  screen shrink from 10.9 MB to 4.2 MB (2026-10-25).
- **The built client** (`dist/client`, `pnpm build`), when present, is served gzipped: the hashed files under `/assets/`
  with `cache-control: private, max-age=31536000, immutable`, the pages with `private, no-cache`. Over a remote link the
  built client is the cheaper way to play: the Vite dev server sends some 700 modules and revalidates each on every
  opening (16 MB the first time), the built client 28 files (1.3 MB, then nothing).

---

## 6. Agent API

§6.1–§6.5 are the v0.1 design with as-built notes; §6.6–§6.34 add the API milestone by milestone as it was built (there
is no §6.15). The MCP tool descriptions in `src/server/mcp.ts` list every command with its fields and refusals and are
the reference when this text and the code differ.

### 6.1. Transport

- **An LLM agent** connects via MCP (Model Context Protocol). Claude Code connects to the
  local server with the `claude mcp add` command.
- **Scripts and bots** get the same set via HTTP JSON and a TS client. For them it is also the route
  to mass headless runs.
- **As built:** MCP over streamable HTTP at `http://127.0.0.1:7420/mcp` (`JA2_PORT` moves it) with `Authorization:
  Bearer <.ja2/token>` (§5.8); the browser pages use the WebSocket protocol of §5.2; HTTP routes cover sessions
  (`POST`/`GET /api/sessions`), saves (§6.22) and text (§6.21). There is no stdio transport and no TS client package;
  the e2e tests and `tools/bench` drive the HTTP and WebSocket endpoints directly.

### 6.2. Tools

There are few of them, and they are coarse-grained. As built (M7) the MCP server has nine tools; every tool but
`newSession`, `listSaves` and `deleteSave` takes `session` (default: the session `sandbox`, which `JA2_SAVE` or
`JA2_CAMPAIGN` open as a native save or a new campaign instead), so agents and tests do not share one battle.

| Tool | What it does |
|---|---|
| `status` | Tick, map, driver, display language and data version, soldier count, whether the simulation is idle, the game options, `saveMode` and `canSave`; in a campaign also the clock, the flow (`strategic`, `tactical`, `autoresolve`, `laptop`, `meanwhile`, `endgame`, `ended`), the sector, the campaign state and `noUsableMercs` |
| `observe` | The player view (D16) as JSON: own soldiers (tile, level, direction, animation, AP, life, breath, inventory, keys), the others the squad sees, open doors and the doors with a known lock or trap, items seen on the ground, the combat block; in a campaign the clock, the strategic view, the open prompt and the modal views (autoresolve, shop, laptop, conversation, NPC request, boxing, meanwhile, ended); UI labels in the session's language beside the machine tokens (§6.21). Noises arrive as `noiseHeard` events, never as positions |
| `act` | One command `{"type": …}`: tactical orders (`move`, `turn`, `stance`, `stop`, `attack`, `pickUp`, `drop`, `climb`, `door`, `endTurn`, `useRemote`), inventory and first aid (§6.24), strategic commands (`route`, `assign`, `exitSector`, `mapScreen`, `compressTime`, …), contracts, shops, the laptop, conversations, `give`, `unescort`, the helicopter and vehicles, `setOption`, and `answer` for every decision prompt; queries are commands that change nothing (`estimateAttack`, `contractOptions`, `quoteTrade`, `inventory`, `aimQuote`, `bobbyRayQuote`, `insuranceQuote`, `impPreview`, `arrivalTime`). The answer is `{ok, reason?, data?}`. Under the default manual driver time moves only in `advance` (under the instant driver, which a browser page may set, every accepted command runs to idle) |
| `advance` | Runs time: tactical until idle, a listed event or a tick count; on the strategic map to a world time (`worldTime`, `worldSeconds`, `compressionStopped`, `mode`); a decision prompt always stops it. The report carries the reason, the world time and the events |
| `newSession` | Starts another session and returns its id: the sandbox (optional seed), with `campaign {options?, profiles?, hire?, mercs?, imp?, land?, deadIsDeadName?}` a new campaign (§6.6, options §6.23), with `save` a native savegame from the game's `SavedGames` folder (`docs/14` §10), or with `load` (and `reseed`) a ja2-node save (§6.22); `language` sets the session's display language (§6.21) |
| `save`, `load`, `listSaves`, `deleteSave` | Saves on the server (§6.22) |

The v0.1 design above listed `query` (hit chance, path, LOS) and `answer` as tools of their own, an ASCII map fragment
in `observe` and events since the previous call; as built queries and answers are `act` commands, `observe` returns the
JSON view, and events come with `advance` reports.

### 6.3. Example turn

Abbreviated, from the v0.1 design: the as-built calls take JSON commands (`act {"command": {"type": "attack",
"soldier": 3, "target": 12880, "aimTime": 4}}`, `estimateAttack` for the chance) and `observe` has no ASCII map
(§6.2).

```
→ act {soldier:"Ivan", action:"move", to:[52,61], stance:"crouch"}
← moved 3 tiles; interrupted at [51,60]: enemy #12 fired 1 shot, missed.
  Your turn continues. Ivan AP 9/21. New: enemy #12 at [47,58], prone, behind sandbags.
→ query {kind:"cth", shooter:"Ivan", target:12, aim:[2,4]}
← aim 2: 41% (6 AP); aim 4: 58% (8 AP)
→ act {soldier:"Ivan", action:"shoot", target:12, aim:4}
← hit torso, 18 dmg; enemy #12 falls. Ivan AP 1/21.
```

An `observe` fragment:

```
Omerta A9 · turn 3 · ours · 07:42
      4444445555555
      4567890123456
  56  ,,,,..#####..
  57  ,,,,..#...#..       ,  tall grass         #  wall       D  door
  58  ,,,e=.#...D..       =  sandbags           e  visible enemy #12
  59  ,,,,=.#...#..       I  Ivan [51,60]       F  Fox [50,61]
  60  ,,,,...I.###.
  61  ,,,,..F......
```

### 6.4. Fairness and hints

- **Fairness.** The agent sees exactly what the player's screen would show.
- **Agent hints** ("cover from enemy #12: yes or no", "tiles with cover within a radius
  of 5") are derived only from what is visible. They can be turned off. As built the hints are the query kinds of §6.26
  (the cursor hints over the player-knowledge projection and the server-only quotes).

### 6.5. What the agent handles well and poorly

- **Well:** turn-based combat, strategy, management. `query` spares it from doing the math in its head.
- **Worse:** spatial reasoning over ASCII: cover, elevation, roofs. So the observation
  has to be designed carefully and tested on real games.
- **Real time:** only through the manual driver.
- **A long campaign** means thousands of actions. Observations have to be compact: deltas, not
  full snapshots.

---

### 6.6. Campaign sessions (M4)

`src/server/campaign-factory.ts` `createCampaignSession(read, exists, seed, request)` builds a `CampaignSim` with the
strategic map, the Queen, towns and the sector flow, runs `initNewGame` (which leaves the game in the laptop), hires the
squad through the laptop (§6.9), closes it and, unless `land: false`, dispatches the first `compressTime` so the helicopter
drop loads the start sector at 07:00 on day 1 (`docs/15` §4.5). `hire: [{profile, contract?, gear?}]` names the A.I.M.
hires (a refusal fails the request), `mercs` sets the size of the default squad (original data: profiles 0, 3, 4, 7, 14,
16, default six; stubs: the twelve stub A.I.M. profiles 0–11 since M7 S13, default four; hired in order while available
and affordable), `imp`
runs an `impCreate`, and `hire: []` without `imp` returns the session in the open laptop. `options` are the game options of §6.23
(`difficulty` 1–3, default 2; `campaign.difficulty` stays an alias). Maps are loaded by
`WorldCache` before each command (`Session.prepareAndDispatch`).

Sessions are created through MCP `newSession`, `POST /api/sessions` (same JSON body: `{seed?, save?, load?, reseed?,
campaign?, language?}`;
`GET /api/sessions` lists them with `describeSession`), or for the default session with `JA2_CAMPAIGN=<difficulty>`.
Both paths share `src/server/session-registry.ts` (at most 16 sessions).

View frames also carry `mapPath` (a sector was loaded or unloaded), `clock` and `strategic` whenever they change, so
the browser follows the campaign without polling. The strategic page (`src/devtools/strategic/`) lists the sessions,
starts a campaign, shows the 16×16 map (control, known enemies, militia, squads, planned routes), the mercs and their
groups, and sends `route` (once per squad), `enterSector`, `mapScreen`/`tacticalScreen`, `compressTime {mode: 2|3|4}`,
`stopTime` and a strategic `advance` (to the next stop; during autoresolve to its end). A battle panel shows the open prompt
(`preBattle`, `autoresolveDone`, …) with its choices and the autoresolve cells; the frame stream (and with it an
autoresolve battle) plays back at the original's Play (1×) and Fast (4×) speeds or at once (Finish). The tactical page takes `?session=` and
reloads the world when the loaded sector changes.

The campaign runs in flows: `tactical` (the loaded sector steps in real time or turns), `strategic` (the map screen: the
world clock runs, compressed on request, the loaded sector, if any, is frozen) and `autoresolve` (`docs/19` §5.2).
`mapScreen` and `tacticalScreen` switch between the first two like the original's screen toggle. `enterSector` on the sector that is already loaded (and the pre-battle `enterSector` answer for it) switches back to the tactical flow at normal speed, like the map screen's button for the current sector. A strategic `advance`
(`worldTime`, `worldSeconds`, `compressionStopped`, `mode`; `docs/15` §6) is refused in tactical unless it has a time
target, and compression is refused while the loaded sector holds enemies (`AllowedToTimeCompress`). `route` checks
`CanEntireMovementGroupMercIsInMove` first, so the squad cannot leave the start sector before it is cleared (legs,
the shortest route, appending, `shortenRoute`, `routeGroup` and the militia commands: §6.30).
Compression is also refused while a group sits in a creature-infested mine or bloodcats attack. Campaign events beyond the
battle ones (`docs/19` §5.3): `civiliansEaten {sector, count}`; `preBattle` may carry `encounter: 'creatureAttack'` with
`autoStart: true`. Complaints about hated teammates are `mercQuote` events and a merc who quits leaves through the
`mercDeparture` prompt (§6.8).

Militia training asks before it charges: `assign {to: {kind: 'trainMilitia'}}` returns `militia: 'pending'` and opens a
`militiaPayment` prompt (`{trainer, sectors, cost, balance, choices: [yes, no]}`), and a finished training session asks
`militiaContinue` (`{trainer, sector, cost, balance}`), both answered with `answer {choice: yes|no}` (`data.outcome`:
`paid`, `continued`, `declined` or `cannotAfford`); they stop compression and count as decisions like the battle prompts.
The economy's own events reach the reports as well: `assignmentDone`, `assignmentAborted`, `fellAsleep`, `wokeUp`,
`tiredComplaint`, `itemRepaired`, `gunUnjammed`, `militiaTrained`, `militiaPromoted`, `militiaDefected`,
`militiaTrainingRejected`, `militiaPrompt`, `loyaltyChanged`, `mineIncome`, `mineRunningOut`, `mineEmpty`, `mineShutDown`,
`mineReopened`, `headMinerQuote` and `moneyChanged`.

### 6.7. Merchants (M5)

A shop is a modal session like a prompt (`docs/23` §13): `openShop {dealer, soldier}` (the original's talk-and-trade,
with its distance, sight and AP checks) opens it, `quoteTrade` prices an exchange without doing it, `trade` performs one
exchange (buy, sell, cash, repair, `useBalance`) and `closeShop` ends it. While a shop is open every other command is
refused, `advance` returns `refused` with `refusal: 'shopOpen: …'` and the clock does not move. `observe.shop` (and the
`shop` field of view frames) shows the kind, the pricing merc, the balance and the boxes with unit prices; the dealer's
cash is never shown. Merchant NPCs in sight carry `merchant: buySell|buy|sell|repair`. Events: `shopOpened`,
`shopkeeperQuote`, `itemsBought`, `itemsSold`, `giftGiven`, `repairQueued`, `repairDelayed`, `repairCollected`,
`itemsDropped`, `moneyChanged`, `shopClosed`. Since M8 (U7) `setShopPricing` changes the pricing merc, `quoteTrade`
returns the quote ids and the planned player offer area, and the shop view lists the collected repairs (§6.28).

### 6.8. Contracts (M5)

`extendContract`, `dismiss` and `removeMerc` work on the map screen only (`mapScreenOnly` elsewhere); `contractOptions`
returns the renewal menu without opening it (`docs/22` §9). The renewal sequence, departures and insurance offers are
decision prompts in `observe.contractPrompt` (`contractRenewal`, `mercDeparture`, `insuranceExtension`), answered with
`answer`; `advance` stops on them with `decision`. Strategic mercs show `kind`, `contract` (A.I.M. days left, end time,
renewal costs; M.E.R.C. debt; R.P.C. rate), `morale` and `moraleText`, `daysServed`, `totalCost`; the strategic view shows
the M.E.R.C. account status. Opinions, tolerances, reputation and the death rate stay hidden.

### 6.9. Laptop and hiring (M5)

The laptop is a modal flow (`docs/21` §1.3, §10): a new game starts in it (day 1, 01:00) and `openLaptop` opens it from
the map screen (refused elsewhere and while a prompt, a pending battle or the renewal sequence is open). While it is open
the clock stands still, every non-laptop command is refused with `laptop: the laptop is open, closeLaptop first` and
`advance` returns `refused` with that refusal; laptop commands sent while it is closed answer `laptopClosed`. Commands:
`closeLaptop`, `readEmail`/`deleteEmail {id}` (reading the I.M.P. intro bookmarks I.M.P., Speck's intro M.E.R.C.),
`aimHire {profile, contract: 1|7|14, gear?}`, `aimLeaveMessage {profile}`, `mercOpenAccount`, `mercHire {profile}`,
`mercPay`, `impCreate {code, name, nickname?, gender, answers[16], attributes, portrait, voice}`, `bobbyRayOrder {lines:
[{item, used?, quantity}], destination, speed: 0|1|2}` (0 overnight express, 1 two business days, 2 standard service,
`CalculateOrderDelay`), `insure {soldier}`, `orderFlowers {bouquet, destination, nextDay,
extras}`; on the map screen `setLandingZone {sector}`. Queries that never act and work in any flow: `aimQuote`,
`bobbyRayQuote`, `insuranceQuote`, `impPreview`, `arrivalTime`. Hires answer with the soldier id, the charge and the
arrival (`{minute, shownMinute, sector}`); the hired merc is `IN_TRANSIT` until the 07:30, 13:30 or 19:30 flight lands him
in the landing zone (after the first landing the arrival event stops compression and drops him into a loaded start
sector by helicopter). `observe.laptop` (and the `laptop` field of view frames) is present only while the laptop is open:
balance, bookmarks, mails, history, finance records, files, personnel lists, A.I.M. mercs (stats, salaries, medical
deposit, kit, face state), the M.E.R.C. site (once bookmarked), I.M.P., Bobby Ray's stock, shipments and destinations,
insurance offers, mercs in transit and the landing zone; the strategic view always carries `landingZone` and
`unreadMail`, and in-transit strategic mercs their `arrival`. Events: `laptopOpened`, `laptopClosed`, `mercHired`,
`mercArrived`, `arrivalRerouted`, `landingZoneReset`, `emailReceived`, `historyAdded`, `moneyChanged`, `bobbyRayOpen`,
`shipmentDelivered`, `shipmentLost`, `insurancePaid`, `mercAccountStatus`. Native saves import the laptop sections.

**For the canvas pages (M8, U10).** `visitSite {site: bobbyRay|merc|funeral|florist|insurance}` runs what entering the
site's page does in the original (Bobby Ray's under-construction visit that gates its "now open" mail, the funeral, florist
and insurance bookmarks, the M.E.R.C. visit counter and Speck's opening once per laptop session) and answers `{site,
bookmarks, speck?}` with the opening's ordered Speck quote ids (refusals `badSite`, `noBookmark`, `siteDown`); without
visits the first M.E.R.C. command of a session still runs the opening. Two more queries: `hireCheck {profile}` (the
conference's HIRE check before any money: `{profile, contact, accepted, refusal?, quote: {id, name} | null, hated?}`) and
`emailText {id}` (`{id, subject, paragraphs}` with the substitutions done and the I.M.P. report assembled on the server,
Ian codes kept; `noSuchMail`, `noText`); the WebSocket query channel will carry them without logging them. `aimHire`
answers its acceptance and its check refusals with `quote {id, name}`. The laptop view adds `newMail` (the saved
`fNewMailFlag`: set by every mail, cleared by `closeLaptop`, also in the strategic view), mail `offset`, `length` and the
rendered `subject`, finance rows' `text` (labels in the session's display language: the session factory loads the UI
strings of the session's language for its sim), `financeSummary` (`docs/21` §6.3), and per A.I.M. merc `contact`
(`firstContact|answeringMachine|unavailable`) and `messageLeft`, with `aim[]` in the order of `mercs-AIM-listings.json`.
Snapshot version 5 adds `newMail` (older snapshots load with it down).

### 6.10. Doors (M6)

`door {soldier, gridNo, action}` with `action` one of `open`, `close`, `openManually` (§6.29), `closeManually`, `unlock`, `lock`,
`pickLock`, `force`, `crowbar`, `explode`, `untrap`, `examine` (`docs/25` §8, §13.1). The soldier walks next to the door (`FindAdjacentGridExAdvanced`) like
`pickUp` and then interacts; `data` is `{walking: true, to}` while he walks, `{started: <action>}` when he is already there,
or, for `open` on a locked door, `{opened: false, locked: true, options}`: the door menu as data, after the start-of-menu
trap check (`{trapNoticed: true}` when the merc spots the trap instead). Each option is `{action, ap, enabled, reason?}`.
`close` by one of our mercs answers `{closed: false, options}` and the `doorMenu` event with `closing: true`: vanilla's
closing menu, where only `closeManually` is enabled (the other options carry `reason: 'doorOpen'`); `closeManually` closes
the door without asking (`docs/deviations.md`, "Closing an open door"). Other soldiers close at once.
Refusals (`data.refusal`): `noDoor`, `alreadyOpen`, `alreadyClosed`, `doorOpen`, `notLocked` (menu actions need a closed
locked door), `noLock`, `alreadyLocked`, `noKey`, `noCrowbar`, `noLockpickKit`, `noShapedCharge`, `escortCannot`,
`alreadyKnown`, `notEnoughAp`, `noPath`. Events: `doorMenu {soldier, gridNo, options, closing?}`, `doorResult {soldier, gridNo,
action, result, trap?}` (`opened`, `closed`, `locked`, `failed`, `noLock`, `lockDamaged`, `chargeExploded`, `trapFound`,
`noTrapFound`, `untrapped`, `trapSprung`, `notTrapped`, `wrongKey`, `trapStopped`, `trapNoticed`, `notEnoughAp`),
`doorTrap {soldier, gridNo, trap}` (never for the silent alarm), `lockDestroyed {soldier, gridNo}` and `doorChanged`.
Crates, lockers, cabinets and switches (an openable structure without a door) take `open` and `close` too: the soldier
walks next to them (`FindAdjacentGridEx` with its door rule, `FindAdjacentGridExAdvanced` for a switch) and opens or
closes them as `HandleStructChangeFromGridNo` does: the contents shown (or hidden again when closed, a switch fires the
action items of its frequency), the Drassen shipment check (a merc nearby may notice Pablo's theft,
`QUOTE_STUFF_MISSING_DRASSEN`) and `contentsExclaimed {soldier, sound: NOTHING|HUMM|COOL1}` for the opener's battle
sound, which the browser plays 500 ms later; other actions refuse with `noDoor`. The view's `openContainers` lists the
base tiles of the open containers and switches (`openDoors` keeps the doors), and a sector remembers which ones were
open when it is left (`SaveBloodSmellAndRevealedStatesFromMapToTempFile`). The browser plays the open and close sounds
from the changes of `openContainers` (the structure's armour on its own map picks the locker, wooden box or default
sound, `GetStructureOpenSound`), except the close of a Bobby Ray crate in the frame of its `shipmentDelivered`, which
`CloseCrate` makes silently.
`observe.doors` lists the doors whose lock or trap the player knows (`locked`: `unknown|locked|unlocked|broken`, `trap`:
`unknown|none|noneFound|<trap>`); our soldiers carry `keys` (key ring: key id, count, the key item as `item` and `index` (`LockTable[keyID].usKeyItem`, `getKeyItemForKeyId`), sector and day found) and key items
show `keyId`. Lock tables, trap levels and lock damage stay hidden.

### 6.11. Quests and NPC presence (M6)

Facts and quests are hidden state (`docs/25` §13.4): the player sees quests only as history lines. The strategic view
(`observe.strategic` and the `strategic` field of view frames) carries `quests`: one entry per quest that has a
"quest started" or "quest finished" history line, `{id, quest, started, finished}` with the quest's internal name
(`DELIVER_LETTER`, `KILL_TERRORISTS`, ...) and each step as `{minute, sector}` (`sector` is null for "n/a"); a quest
started or ended without history (Alma's skip, a silent restart) does not appear. Events: `questStarted` and
`questFinished` `{quest, id, sector}`, emitted together with the `historyAdded` line. A new game starts with the
accepted assignment and `DELIVER_LETTER` in the history (day 1, 01:00). Profile NPCs exist only as their campaign
profile's sector until a sector loads; their whereabouts, `npcData`, balances and the 04:00 moves are never shown
(`npcMoved` is not an event). Native saves import the facts, quests and the narrative globals of the general info.
Civilians follow their map schedules (`docs/25` §5): a loaded sector replays the last 24 hours when it loads and
whenever time passes on the map screen (civilians are moved, put to bed or sent off the map at once), and in tactical
real time they walk to their spots, open, close, lock and unlock doors and leave or re-enter the map (one who walks off
stays, invisible, two tiles past the edge until the sector loads again: a kept quirk). Schedules add no command, event or
view field: a civilian off the map is absent from the soldiers of the view like one who left, a sleeping one is visible
as usual, and opened or closed doors arrive as `doorChanged`. Shop hours of a repairman come from the lock and unlock
times of his schedule while his sector is loaded.

### 6.12. Conversations (M6)

A conversation with a named NPC is a modal **talk session** (`docs/24` §11, `src/sim/campaign/talk-flow.ts`), built on the
NPC record arrays (`state.npcRecords`, imported from native saves) and the dialogue queue (`src/sim/narrative/`). Commands
(refusals in `data.refusal`, the reason reads `<code>: <text>`):

- `talk {soldier, target}`: `target` is a soldier id or `{npc: <profile id or internal name>}`. Refused with `notInTactical`,
  `promptOpen`, `shopOpen`, `sessionOpen`, `scriptedSequence`, `canAct` (the tactical refusal text), `noSuchTarget`,
  `notTalkable`, `targetHidden`, `targetMoving`, `talkerIsRobot`, `noLineOfSight`, `targetCollapsed`, `refusesToTalk`
  (Dimitri), `noPath`, `notEnoughAP` (6 AP). An unnamed civilian or an enemy soldier answers with a civilian quote
  (§6.19). Talking to an own merc barks
  (`data.bark`, a `mercQuote` event, no AP). Beyond 4 tiles the soldier walks up (`data {walking: true, to}`) and the talk
  starts on arrival during `advance`; a target that became invalid gives `talkAborted`. Otherwise the opening runs at once.
- `approach {kind}`: `repeat`, `friendly`, `direct`, `threaten`, `recruit`, `whoAreYou`, `buySell` (dealers: an unused
  BUYSELL record, else the panel closes and the shop opens) or `give` (others: the panel closes, the NPC waits 10 s).
  Refusals `noConversation`, `busy`, `unknownApproach`, `notADealer`, `isADealer`.
- `closeTalk {}`: Done, with the once-per-conversation reset. Refusal `noConversation`, `busy`.
- `openShop {dealer, soldier}` (campaigns with narrative): the shop's checks, then `talk` + `approach buySell`; when the
  opening leaves no idle session or a BUYSELL record plays, the talk result is returned instead of the shop.

`talk` and `approach` run their step and then the dialogue queue until it is empty, nobody talks and no trigger waits
(tactical ticks with the world clock paused by the `ENGAGED_IN_CONV` lock and AI decisions frozen). Their `data` is
`{conversation, lines, scriptedSequence?, shop?}`: `lines` are the quotes said during the command (`{profile, quote,
record?, textKey, text?}`). While a session is open and idle every other command is refused with `conversationOpen`,
`advance` returns `refused` with that refusal, and the campaign reports a pending decision (an `advance` that runs into a
conversation opened by an NPC stops with `decision`). A **scripted sequence** (`ENGAGED_IN_CONV` without a panel, a
pending conversation, the 500 ms trigger wait) refuses player commands with `scriptedSequence`; `advance` runs it until it
ends or a panel opens.

`observe.conversation` (and the `conversation` field of view frames) is `{npc, profile, name, talker, initiatedBy:
player|npc, menu, lastQuotes}` with `menu` = `repeat, friendly, direct, threaten, buySell:<dealer kind>|give, recruit,
whoAreYou`; `observe.scriptedSequence` is true during a sequence. Soldiers in sight carry `talkable: npc|epc|civilian`
and, when profiled, `profile`. Events: `conversationOpened {npc, profile, talker, initiatedBy}`, `conversationClosed {npc,
profile, by: player|script}`, `npcQuote {profile, soldier, quote, record?, textKey, chars}`, `mercQuote` (with `textKey`
and `chars` for lines from the queue), `npcMessage {kind, profile?, amount?}`, `scriptedSequence {active}`,
`talkAborted {soldier, reason}`. Facts, quests, records, desire and opinions stay hidden.

The simulation only carries text keys `{file, row, width}` and lengths (12 ticks of speech per character). The session
resolves keys to `text` in `observe`, command results and events from the EDT files of the VFS (original data, or the
stub pack's invented lines); `GET /api/text?file=npcdata/NNN.edt&row=R` (token-protected) serves a single row (§6.21).
Since M7 `save` is refused with `conversation` while a session is open, a scripted sequence runs or the dialogue
queue is busy (§6.22).

### 6.13. Helicopter and vehicles (M6)

Skyrider's helicopter exists once the escorted Skyrider reaches his chopper in B13 (`docs/25` §10.2) or a native save already
owns it. Strategic commands (map screen only, `mapScreenOnly` elsewhere): `heliRoute {to}` plots and confirms a new route
(the original's plot-and-click on the last sector, replacing any route like `route`) and takes off; `data` is `{path,
etaMinutes}`. `heliCancel` cancels the route (a flying helicopter turns back). `route`/`cancelRoute` for a merc aboard the
helicopter do the same after the squad's move check. Refusals (`data.refusal`): `noHelicopter`, `skyriderOwed`,
`returningToBase`, `grounded` (on the ground in an enemy-held sector), `skyriderUnwilling` (Drassen disloyal), `noRoute`, and
`emptyHelicopterHint` the first time the helicopter would leave empty while mercs stand in its sector (the original's one-time
message box; the next request goes through). `boardVehicle {soldier, vehicle: <id> | 'helicopter'}` seats a merc
(`notAccessible`: another sector, moving or destroyed; `alreadyAboard`; `vehicleFull`; the helicopter's flight refusals;
`notAllowed` for a hummer or ice-cream truck the quests have not released; `vehicleNotOurs`; the assignment conditions
`combat`, `unconscious`, `moving`, `underground`, `inTransit`, `prisoner`, `helicopterInHostileSector`, `impassableSector`).
`leaveVehicle {soldier, squad?}` puts a passenger on a squad (default the first empty one) in the vehicle's sector
(`notInVehicle`, `helicopterInFlight`, `returningToBase`, `squadFull`, `squadElsewhere`, `squadMoving`, `squadHasVehicle`,
`notEligible`); `assignSquad` and `assign` to a squad refuse a helicopter passenger in flight the same way.

Events: `helicopterSetUp {sector}`, `skyriderQuote {quote}` (Skyrider's quote numbers, presentation only), `heliTakeOff
{sector}`, `heliArrived {sector, hostile}`, `heliHovering {sector, stage: started|long|tooLong}` (`long` after 10 minutes,
`tooLong` after 20: passengers are dropped in a safe sector and the helicopter returns), `heliReturning {to, safe}`, `heliLanded
{sector}`, `heliHit {sector, hits}` (SAM fire), `heliDestroyed {sector, killed}`, `heliPaid {amount, balance}`, `heliOwed
{amount}`, `heliEmptyHint {sector}`, `enemiesSpottedFromAir {sector}`, `samSitesRevealed {sites}`, `skyriderMonologue {topic:
drassenSam|cambriaHospital|otherSams|estoniRefuel}`, `passengersDropped {sector, soldiers, squad}`, `vehicleBoarded {soldier,
vehicle}`, `vehicleLeft {soldier, vehicle}`. Hits, arrivals, hovering warnings, the return and debts stop time compression,
so a strategic `advance` reports them with `compressionStopped`.

The strategic view carries `vehicles` (id, kind, sector, betweenSectors, passengers, seats, path) and, once the helicopter is
set up, `helicopter {vehicle, sector, next, airborne, hovering, returning, passengers, seats, canFly, reason?, owed, hits,
path, etaMinutes, safeSectors, unsafeSectors, routeCost, refuelSites: [{sector, available}]}` (`{destroyed: true}` after it
was shot down); mercs in a vehicle carry `vehicle`. Skyrider's balance is shown only as the debt (`owed`), as the original's
messages show it; his talk state and the accumulated bill stay hidden.

### 6.14. NPC actions and requests (M6)

The NPC records of a conversation run the action catalog of `docs/25` §3 (`src/sim/tactical/narrative/npc-actions/`): facts,
quests, history lines, strategic events (the NPC system events of event 27), profile moves, record triggers, items, money,
combat changes and the hospital. Actions have no command of their own; their effects show in the usual places (the
conversation's lines, `questStarted`/`historyAdded`, mails, the shop, soldiers in sight). A requestor action (`docs/25`
§3.3) closes the panel and opens an **NPC request**, a decision like the battle prompts:

- `observe.npcRequest` (and the `npcRequest` field of view frames) is `{id, kind: 'npcRequest', request, npc, name, merc?,
  amount?, pair?, choices}` with `request` one of `escort` (`pair: true` for John and Mary together), `hire` (`amount` = the
  salary, after Conrad's reduction), `boxingBet`, `fightAgain`, `buyVest` (`amount` = the jacket's price), `payDoctor`
  (`amount` = the shown cost: the doctor's price for the wounded within 9 tiles less the refund, $10 when the refund is
  larger), `freeTreatment`, `buyVehicle` (`amount` 10000), `spareKrott`, `marryDaryl` (`merc` = the asking merc's profile)
  and `lie`; `choices` are `yes`, `no` and, for `lie`, `lie`.
- The `talk`/`approach`/`answer` result that opened it carries the same view in `data.npcRequest`.
- `answer {prompt?, choice}` answers it; `prompt` (the id) is optional, a wrong id or choice is refused. The answer runs the
  original's callback (records triggered, Daryl's key, the hospital balance, the liar's skill check), then the dialogue queue
  as `talk` does: `data` is `{conversation, lines, scriptedSequence?, shop?, npcRequest?}` (a trigger that opens a new panel
  shows its lines in `conversation.lastQuotes`).
- While a request is open the world clock and the tactical ticks stand still, `advance` stops with `decision`, the campaign
  reports a pending decision and every other command is refused (`answer the npcRequest prompt first`, or `promptOpen` for
  `talk`). The request is part of the campaign state.
- Events: `npcRequest {id, request, npc, amount?, pair?, merc?, choices}` when it opens; `npcMessage` kinds `teamFull`,
  `recruited`, `nowEscorted` (`amount` = the squad number), `balanceOwed` (action 119, `amount` = the debt), `itemPlacedOnGround`,
  `vehicleRefuelled`; `npcGaveItem {npc, to, item}`; `terroristRevealed {npc}`, `townDiscovered {town}`, `sexScene {npc}`,
  `boxingBell` (presentation).

The hospital (Cambria) charges through `payDoctor`, escorts patients onto the hospital assignment (action 237, strictly within
9 tiles) and refunds the unused payment when a patient leaves it; Kingpin learns of his missing money when the squad leaves
D5-1 with less than $30000 there (his letter and quest 4 follow two and four days later). Facts, the hospital modifier and
refund, Kingpin's balance and the NPC system events stay hidden.

### 6.16. Giving items and money (M6)

`give {soldier, target, slot, count?}` or `{soldier, target, money, slot?}` (campaign, tactical; `docs/24` §4,
`src/sim/campaign/give-flow.ts`, `talk-flow.ts`) is the original's drag of an item onto a soldier. `target` is a soldier id
or `{npc: <profile id or name>}`. `slot` (0–18 or `hand`) hands over the whole pocket, or one item of a stack with `count: 1`
(any other count is refused); a money pocket given by `slot` goes whole. `money` splits that amount off the soldier's money
pocket (`slot` picks the pocket, default the first that holds enough), in the money box's steps of 10. Inside a
conversation with a non-dealer the command is the menu's "Give": the panel closes (once-per-conversation records reset, the
NPC waits 10 s) and the give follows; with a dealer it is refused (`isADealer`). Refusals (`data.refusal`): `notInTactical`,
`promptOpen`, `shopOpen`, `scriptedSequence`, `busy`, `canAct` (the tactical refusal text), `noSuchTarget` (also the giver
himself), `giverCannotGive` (an escort, below OKLIFE, in deep water), `giverBusy` (an item, door or give animation, or a
give already under way), `needItemOrMoney`, `noSlot`, `emptySlot`, `badCount`, `badMoney`, `notEnoughMoney`, the talk
checks with giving allowed (`notTalkable`, `targetHidden`, `targetMoving`, `targetCollapsed`, `talkerIsRobot`; own mercs and
escorts may be given to), `robotReload` (reloading the robot is not ported), `noPath`, `notEnoughAP` (the walk plus 1; the
hand-over charges 3).

The soldier walks next to the target and plays the give animation. To an NPC the game is paused and locked meanwhile, so the
command runs to the end: the item is taken off the pocket, the NPC's conversation (`GIVINGITEM`: an introduction on a first
meeting or a new day, then the record that wants the item) opens and drains, and `data` is `{outcome, conversation, lines,
scriptedSequence?, shop?}` with `outcome` `taken` (the NPC keeps it in its profile inventory), `returned` (refused: back in
the pockets, or on the floor when they are full), `kept` (a dealer's BUYSELL record plays instead; the merc keeps it), `shop`
(the dealer does not want it as a gift: the shop opens, the item stays in the pockets), `pending` (the queue was busy; the
conversation opens during `advance`) or `aborted` (the target left its tile). To a squad mate or recruited RPC the command
returns `{walking: true, to}` or `{giving: true}` at once and the hand-over happens during `advance` (the whole source pocket
is emptied even when one item was given, as in the original). Events: `itemGiven {soldier, target, item, count, status,
money?, dropped}`, `npcTookItem {npc, profile, from, item, count, status, money?}`, `itemReturned {to, item, …, dropped}`,
`npcGaveItem {npc, profile, to, item, …, dropped}` (an NPC's gift, dropped at its feet when the talker is out of reach),
`giveAborted {soldier, target, reason, dropped}`, `npcMessage` (`itemPlacedOnGround`, `paidInFull`, `stillOwed`,
`balanceOwed`, `needsMoney`), and the conversation events of §6.12. The quest action items of `docs/25` §11.5 add
`sexScene {soldier}` and `alarm {gridNo, kind: kingpin|museum}`.

### 6.17. Recruiting, escorts and the robot (M6)

Recruiting has no command of its own: it happens in a conversation (§6.12). `approach recruit` runs the NPC's records; a
record with the pay requestor opens `npcRequest {request: 'hire', amount}` (the daily salary) and `answer yes` triggers the
record that recruits (`RECRUIT` or `RECRUIT_WITH_SALARY`, `docs/24` §9.1); an escort record opens `npcRequest {request:
'escort', pair?}`. The NPC's civilian soldier is replaced by a new soldier on our team (`ChangeSoldierTeam`: a new soldier id
in our block, life, stats, camouflage, level and inventory copied, breath and bleeding fresh) standing on the same tile, who
joins the current squad (else any squad). An R.P.C. (`kind: 'rpc'`) takes the first weapon of his inventory into an empty
hand and is paid his salary at 00:00 (§6.8); an escort (`kind: 'epc'`, John and Mary always together) follows the escort
rules: no contract, `loneEPC`/`abandonEPC` at map edges, `escortAlone` for strategic moves, `escortCannot` at doors.

- `unescort {soldier}`: the assignment menu's "remove escort". On the map screen the escort (and John's or Mary's partner)
  says the line of his first record for being left (`EPC_IN_WRONG_SECTOR`), its fact is set and he becomes a civilian again
  at once where he stands (the original plays the line first; the map screen's clock does not move): `data {released:
  [{profile, quote}], lines}` (`quote` is null without such a record). In the loaded sector only that record is triggered
  and decides (it may release him, or only answer): `data` is the talk result (§6.12) plus `triggered`. Refusals
  (`data.refusal`): `conversationOpen`, `scriptedSequence`, `promptOpen`, `shopOpen`, `laptopOpen`, `noSuchSoldier`,
  `notAnEpc`, `notInSector` (tactical: the escort stands outside the loaded sector; release him on the map screen) and
  `notAvailable` (autoresolve). A released escort keeps his place: his profile uses insertion data at the tile he left.
- The robot is recruited as an escort (Madlab's action) and takes orders only while a conscious non-escort on its squad (or in
  its vehicle) in the same sector wears the robot remote control in a head slot: the remote holder is fixed when the robot
  joins, whenever a merc of ours receives a remote control (picked up, bought), when a pre-battle decision opens and after
  autoresolve. Without a controller every order is
  refused with the `canAct` text "the robot has no controller…", `route` with `robotAlone` and `exitSector` with
  `uncontrolledRobot`; its interrupt points are the controller's level − 2 and the controller loses 2 while he steers.
- `route` also refuses `cannotLeaveSector` for Maria in C5.
- A civilian group turning hostile sends its recruited members back to the civilian team (they leave the roster without
  events); Conrad and the General turning hostile join the enemy team.

Views: strategic mercs carry `kind` (`aim`, `merc`, `imp`, `rpc`, `epc`, …) and own tactical soldiers `kind: 'rpc' | 'epc'`
for recruited NPCs; the robot carries `controlled` in both. Talking to an escort runs his `EPC_WHO_IS_RECRUITED` records.
Events: `npcRecruited {profile, soldier, kind: 'rpc' | 'epc', salary}` (the new soldier id; `salary` 0 for escorts),
`epcReleased {profile, soldier}` (`soldier` is the new civilian's id when he stands in the loaded sector, else null),
`npcMessage` kinds `recruited`, `nowEscorted` (`amount` = squad number, also for the partner) and `teamFull`, and the
history line `RPC_JOINED_TEAM` (`historyAdded`). Opinions, profile flags, the remote holder id and the records stay hidden.

### 6.18. Meanwhile scenes, prisoners and the end of the campaign (M6)

Meanwhile scenes are not player actions and have no command or prompt of their own (`docs/26` §2,
`src/sim/campaign/meanwhile-flow.ts`). The sixteen Meduna scenes resolve with the original's "played" semantics as soon as
the gates pass (no battle decision open, the dialogue queue empty, nobody talking): the NPC moves and restores, Elliot's
counter, the implications on the Queen's AI. On the map the world clock stops (`compressionStopped {reason: 'meanwhile'}`,
which ends a default strategic `advance`); while a scene waits for its gates, compression is refused (`a meanwhile scene is
about to start`). Each resolved scene adds `meanwhile {seq, scene, sector: 'P3', at}` (`scene` is the camelCase name:
`endOfPlayersFirstBattle`, `drassenLiberated`, `cambriaLiberated`, `almaLiberated`, `grummLiberated`, `chitzenaLiberated`,
`nwSam`, `neSam`, `centralSam`, `flowers`, `lostTown`, `creatures`, `killChopper`, `awolScientist`, `outskirtsMeduna`,
`balimeLiberated`; `at` = world seconds) and an entry `{seq, scene, at}` to `observe.strategic.meanwhiles`. Scheduled scenes,
their delays, Elliot's counter and the AI effects stay hidden.

The interrogation (squad captured when quest `HELD_IN_ALMA` is already done, `docs/26` §2.3) is a scripted tactical scene:
the clock stops, N7 loads, the flow becomes `meanwhile` and `observe.meanwhile` is `{seq, scene: 'interrogation'}` (frames
carry `meanwhile` when it changes) until the scene ends. The Queen's records play in the conversation view of §6.12; her
lie question is the `npcRequest` prompt of §6.14 with `request: 'lie'` (choices `yes`, `no`, `lie`; the skill check stays
hidden), answered with `answer`. Every other command is refused with `inMeanwhile` (`data.refusal`); `observe`, queries and
`answer` work. `advance` runs the scene's ticks and stops with `decision` at the prompt and always with `event` at
`meanwhileEnded`; events `meanwhileStarted {seq, scene}` and `meanwhileEnded {seq, scene}` frame it. Afterwards the captives
are in N7 under normal tactical rules.

Prisoners: when I13 loads with captured mercs held there, they stay prisoners (neutral, assignment POW) and
`powsFound {sector, soldiers}` lists them; captives placed anywhere else (N7 after the interrogation) rejoin the team on one
new squad. A door opened or an explosion in I13 frees every prisoner that then has a path out of the cells: `powFreed
{soldier, sector}` each, back on a squad.

`useRemote {soldier}` (campaign or tactical) presses the remote trigger in the soldier's hand: 2 AP, 2 more when standing
(the original's animation). In the statue room of O3 it opens the statue (`statueOpened {sector: 'O3', destroyed: false}`,
an exit grid down to O3 b1); an explosion next to the statue opens it too (`destroyed: true`). Refusals: `no such soldier of
yours`, the `canAct` text, `the soldier holds no remote trigger`, `not enough APs: 2 needed`. `data` is `{result:
'statueOpened' | 'nothing'}` and the event `remoteUsed {soldier, result}`.

The end of the campaign (`docs/26` §7, `src/sim/campaign/endgame-flow.ts`): Deidranna's death emits `queenKilled {sector,
gridNo, level, killer}` and starts the flow `endgame` (`status.campaign` and `observe.strategic.campaign` = `endgame`). Every
command except `observe`, queries and `answer` is refused with `endgameInProgress`; `advance` plays the sequence in ticks
(the killer's and a witness's lines, the squad carried up to P3 with `squadMovedUpstairs {soldiers, sector: 'P3'}`, Derek's
and Oliver's records as `npcQuote`/conversation events). With the creature quest still open Derek says so,
`endgameDeferred {reason: 'creatures'}` stops the `advance` and the campaign goes back to `playing`; killing the creature
queen later emits `creatureQueenKilled {killer}` and resumes the ending. The ending emits the mercs' last lines and
`campaignWon {day, worldTime, difficulty, sciFi, ending: {miguelAlive, skyriderAlive}, mercDeaths}`; `advance` stops with
the new reason **`ended`**. From then on the flow is `ended`, `campaign` is `won`, `observe.ended` is `{outcome: 'victory',
at, day, ending, mercDeaths}` beside the last view, every command is refused with `campaignOver`, `advance` returns `ended`
at once without ticks and the session idles; a new game needs `newSession`. There is no game over: with no usable merc left
the campaign goes on, compression is refused (`no usable mercs are left on the team`) and `status`/`observe.strategic` carry
`noUsableMercs: true`.

Native saves taken during a played scene or during the endgame sequence are refused on import; the scene state of other
saves (definitions, the scene about to start, the first battle, the last battle) is imported.

### 6.19. Civilian quotes, the enemy surrender offer and NPCs on their own (M6)

`talk {soldier, target}` to an unnamed civilian, a militiaman or a visible enemy soldier with a merc body (`talkable:
civilian` in the view) runs the same checks, walk-up and 6 AP as a conversation (§6.12) but opens no panel: the target
barks a civilian quote (`docs/24` §8, `src/sim/narrative/civ-quotes.ts`). `data` is `{civQuote: {soldier, quote, entry,
hint, textKey, text?} | null}` when the target stood within 4 tiles (`null` when the line has no text and nothing is
shown); after a walk-up the bark arrives during `advance` as an event. `quote` is the civilian quote type (enemy, militia,
group, cowering, loyalty and all-purpose lines; `99` is a hint, whose text comes from the sector's file and which may
start a quest), `entry` the row. A civilian alternates between two lines and never gives two hints in a row; a second
`talk` barks again (the original's box is presentation, there is nothing to close). Event: `civQuote {soldier, quote,
entry, hint, textKey, chars}` (with `text` in the session's reports). The hicks' night warning in F10 is the same event.

**The enemy surrender offer** (`docs/24` §8.5). In battle an enemy soldier the squad sees, with at least half his life,
may offer surrender once per sector visit when there are fewer than four mercs, no militia and at least three enemies
per merc, and the Alma capture quests allow it. He barks the surrender line (`civQuote` with `quote` 37) and a
**surrender prompt** opens at once: `observe.prompt` (and view frames) carry `{id, kind: 'surrender', context: 'tactical',
soldier, choices: ['accept', 'reject']}` (the autoresolve battle's surrender offer now carries `context: 'autoresolve'`). Time
stands still until `answer {prompt?, choice: 'accept'|'reject'}`: `accept` captures every living merc in the sector
(`mercCaptured` events, the Alma or interrogation quest starts) and the battle is lost (`battleResult` defeat, the sector
unloads ten seconds later); `reject` lets the enemy go on. `data` is `{surrendered}`. Event when the offer opens:
`surrenderOffered {soldier, prompt}`. Without a campaign (sandbox sessions) the offer is declined at once.

**NPCs on their own.** Named civilians decide in real time before their routine (`docs/24` §5.4): after a record told
them to face the player they turn towards the closest merc and run their tile records once one comes within 8 tiles; an
NPC with something to say walks up to that merc (a conversation still needs a tile record or the player's `talk`); the
six assassins close in and turn hostile within 8 tiles. An NPC who just spoke does nothing for a minute of game time.
First sightings run the original's rules (a declaration of hostility, Joe and Elliot, Iggy, our mercs seeing Mike and
Joey with their merc lines, Mike greeting the squad once). While a hostile NPC delivers his declaration all AI is paused
and the speaker is revealed to the squad; when the hostile-quote list resolves, the listed civilians turn hostile, AI
resumes and combat starts. A recruited guide (Ira, Miguel, Carlos, Dimitri) standing in a described town or SAM sector
describes it once, 4–8 real-time turns after the first visit (`mercQuote` from his second dialogue file). None of this
has a command; the effects show as the events of §6.12 and this section.

### 6.20. Boxing (M6)

Boxing in the San Mona club (D5, `docs/25` §7) has no command of its own; it is played with the commands above.

- **The bet.** Talking to the club owner runs his records: a bet or a second fight is offered as `npcRequest`
  (`boxingBet`, `fightAgain`), money is handed over with `give` (§6.16) when a record asks for it, and the record that starts
  the match rings the bell (`boxingBell`). The match only starts when an unarmed boxer stands on one of the club's three
  boxer tiles.
- **`observe.boxing`** (and the `boxing` field of view frames) is null outside a match and otherwise `{state, boxers,
  uiLocked}`: `state` one of `waitingForPlayer`, `preBoxing`, `boxing`, `disqualified`, `wonRound`, `lostRound`; `boxers` the
  ids of the soldiers in sight that carry the boxer flag (ours included); `uiLocked` true while the boxers walk out.
- **The fight.** One merc of ours walks into the ring (room 29): `preBoxing`, a club boxer is picked and walks in, then
  `boxing` and turn-based combat (`combatStarted`, the first team drawn from the two boxers). While a match is set up or
  fought every soldier gets half his action points and carries at most 2 into the next turn, nobody interrupts, a boxer seen
  by the squad does not start combat on his own, and the other civilians stand and watch. Punch with `attack` on an adjacent
  boxer with empty hands (brass knuckles are allowed too); walk next to him with `move` first (the AI boxer closes in by one
  tile per decision). A second merc of ours entering the ring, a boxer leaving it, or a knife or brass knuckles used by
  anyone who is not a boxer disqualify the player (`disqualified`); a gun, or any attack by someone else, calls the match off
  (state back to null). A boxer who stays down for more than one turn, or dies, loses the round (`wonRound` / `lostRound`).
- **The end.** The owner closes the fight: combat ends (`combatEnded` with reason `boxing`), the club boxer turns neutral and
  our boxer walks out of the ring under AI control. Meanwhile every command but `estimateAttack` and `answer` is refused with
  `boxingUiLock` and the session is not idle, so `advance {idle}` runs the walk. When our boxer is out, the history gains
  `WON_BOXING`, `LOST_BOXING` or `DISQUALIFIED_BOXING` (`historyAdded`) and the owner says his result line (a conversation to
  close with `closeTalk`). If our boxer died in the ring, the lock ends once the club boxer is out; the round stays decided
  (no history line, no result line) until `mapScreen` with `abandonFight` or the next bet.
- `mapScreen` is refused with `boxingInProgress` while a boxing state is set; `{"type": "mapScreen", "abandonFight": true}`
  abandons the fight and opens the map. An enemy group reaching D5 during a match arrives 3–5 minutes later.
- **Events:** `boxingBell`; `boxingState {state, previous}` on every change; `boxerPicked {soldier, slot}`; `boxingRoundOver
  {loser, result: won|lost}`; `boxerDisqualified {soldier, reason: outOfRing|nonBoxerInRing|badAttack}`; `boxingEnded {soldier,
  result: won|lost|disqualified|null}`. The boxer tiles, the fought flags, the rests, the stat bonus of rested boxers and the
  facts stay hidden.

### 6.21. Text and languages (M7)

Two independent settings decide text (`docs/27` §5.2). The **data version** belongs to the content: detected once at
server start like Stracciatella's guesser (language folders inside the SLFs; English otherwise), overridden with
`JA2_DATA_VERSION=english|russian|russianGold|german|dutch|french|italian|polish|simplifiedChinese` (Russian Gold must be
named), `stubs` without original data. It selects the EDT decoding, the NPC record layout of the Buka release and the
prof.dat name fix, and reaches the simulation only through decoded quote lengths and record layouts. The **display
language** (`eng`, `rus`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`) only picks the UI string tables: Stracciatella's
`translation-<suffix>.json` and per-language files, `rus` reading `translation-rusgold.json` and the `-rus` files as
Stracciatella does for both Russian versions. The server default is `JA2_LANG`, else the data version's language (stubs:
`eng`); each session has its own. EDT text (dialogue, item names, mails) always comes in the data version's language.

- **`GET /api/health`** adds `dataVersion` and `language` (the server default) and, with saves, `engine {version,
  commit}`, so a client can predict `engineDiffers` before a load (the launcher's warning box, `docs/27` §8.4).
- **`GET /api/strings?lang=`** (token, `ETag`, `cache-control: private, max-age=3600`; `lang` defaults to the server's):
  `{language, files, tables, keys}`; `tables` holds the 217 `L10n` keys (arrays checked against the sizes of
  `Localization.h`, `data/tables/l10n.json`) and the per-language files under their Stracciatella names (`new-strings`,
  `strategic-map-land-types`, `strategic-map-town-names`, `strategic-map-town-name-locatives`, `ammo-calibre`,
  `ammo-calibre-bobbyray`, `shipping-destinations`); `keys` maps machine tokens to `{table, index}` (below).
- **`GET /api/text`**: `?file=<edt>&row=R[&column=C]` for every EDT file the game reads, with its record layout from
  `data/tables/edt-layouts.json` (no `width` parameter): `{file, row, layout, columns, column, width, text}`; 400 for a
  file without a layout, 404 for a missing file or row. Stub files (`stubs/…`) are read only when the data version is
  `stubs`. `?table=<L10n key or file>&index=I&lang=` and `?key=<token>&lang=` resolve UI strings: `{key?, table, index,
  language, text}`; `lang` applies only to these.
- **`GET /vfs/<path>`** falls back to `stubs/<path>` when the data version is `stubs`, so stub sounds, music, speech
  blips and text answer under the original path names (many names share one synthesized file through the stub layer's
  alias manifest, `docs/27` §6.5); `x-vfs-layer` says `stubs`. With the original data there is no fallback.
- **Text keys** (`src/server/text-keys.ts`): `morale.<great|good|stable|poor|panic|bad>` → `pMoralStrings`,
  `condition.<excellent…dead>` → `pConditionStrings`, `talkMenu.<repeat|friendly|direct|threaten|give|recruit>` →
  `zTalkMenuStrings`, `shopKind.<buySell|buy|sell|repair>` → `zDealerStrings`, `moveRefusal.<token>` → `pMapErrorString`
  (the entries with a string of their own), `assignment.<n>` → `pAssignmentStrings`.
- **Sessions**: `newSession {language}` (MCP and `POST /api/sessions`) sets the session's display language; `status`,
  `GET /api/sessions` and `observe` show `language` and `dataVersion`. MCP observations stay English-keyed JSON with the
  machine tokens; `observe` adds labels in the session's language beside them: `moraleLabel` and `assignmentLabel` on
  strategic mercs, `menuLabels` on the conversation (null where the original has no string), `kindLabel` on the shop.
  Changing the language never touches the simulation, its saves or its logs.

### 6.22. Saves (M7)

ja2-node's own save files (`docs/27` §1.3–§1.7): one `<name>.j2s` per save in `$JA2_SAVE_DIR` (default `.ja2/saves/`
in the repository, gitignored), a gzip of one JSON document `{format: 'ja2-node-save', version, header, session, sim,
presentation}` (version 2 since M8; a version 1 file also carries `contentFiles`, kept as `legacyContent` by the
migration) written as two gzip members, so the save list reads the header from the first few hundred bytes. Clients pass names, never paths: `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; `QuickSave`, `Auto01`, `Auto02` and
`Error` are reserved. Native `.sav` files stay in `$JA2_SAVES_DIR` (`docs/14` §10) and are listed read only.

- **MCP.** `save {session?, name?, description?}`: without `name` a new save `<UTC time>-<slug of the description>`
  (Stracciatella's naming), `name: 'quick'` writes `QuickSave`, any other name writes or overwrites that save;
  `description` is cut to 46 characters. Returns `{ok, name, kind: player|quick|auto|deadIsDead, header}` or `{ok:
  false, refused, reason}`. `load {name, session?, reseed?}` loads into `session` in place or, without it, into a new
  session; `newSession {load, reseed?}` is the same. `listSaves {}` returns ja2-node saves (`native: false`, the header)
  and native saves (`native: true`, the native header: description, day, hour, minute, sector, mercs, balance,
  options), newest first, with `compatible` and `problems` (`versionTooNew`, `contentMismatch`, `needsOriginalData`); a
  ja2-node save also carries `warnings` predicted from its header (`stubPackDiffers`).
  `deleteSave {name}` deletes a ja2-node save and its log.
- **HTTP.** `GET /api/saves`; `POST /api/sessions/:id/save` (`{name?, description?}`; 409 for a refusal, 400 for a bad
  name); `POST /api/sessions/:id/load` (`{name, reseed?}`); `POST /api/sessions {load, reseed?}`; `DELETE
  /api/saves/:name` (404 when absent); `GET /api/saves/:name/file` (`application/gzip`); `PUT /api/saves/:name/file`
  (the body is the file, at most 32 MiB: 413 above; parsed, version and content checked before it is written);
  developer only, `POST /api/sessions/:id/snapshot` (`{name?, description?}`) writes a save ignoring the save rules.
  Load refusals map to 404 (`notFound`), 409 (`contentMismatch`, `versionTooNew`, `noMigration`) and 400 (`invalidName`,
  `notASave`, `corrupt`).
- **WebSocket.** `{t: 'save', id, name?, description?}` and `{t: 'load', id, name, reseed?}` answer with `result` (`data`
  is the outcome, `reason` the refusal code). A load in place sends every subscriber of the session a fresh `welcome`;
  when the real-time driver was running it stops (the driver becomes `manual`) and the subscribers first receive
  `stopped {report: {reason: 'loaded'}}`. A client drops the frames it still has queued when the new `welcome`
  arrives (they belong to the replaced simulation).
- **Events.** `gameSaved {name, kind}` after a player or quick save and `gameLoaded {name, seed}` after a load arrive with
  the next `advance` report of that session; autosaves and Dead is Dead saves send none, as in the original.
- **Save modes.** A campaign option chosen at the new game: `newSession {campaign: {options: {saveMode: 'anywhere' |
  'ironMan' | 'deadIsDead'}, deadIsDeadName?}}` (default `anywhere`, `campaign.saveMode` stays an alias; the Dead is Dead
  file defaults to `DeadIsDead`); a native import
  takes the mode of its header, and a Dead is Dead import saves under the native file's name. `status`, `GET
  /api/sessions` and `observe` show `saveMode`, `canSave` and, when a rule applies, `saveRefusal`. Refusals of `save`:
  `conversation` (a conversation is open, a scripted sequence runs or the dialogue queue is busy), `meanwhileStarting`
  (a meanwhile scene starts or plays), `promptOpen` (a battle, contract, militia or NPC prompt, or an autoresolve battle),
  `shopOpen`, `ironMan` (Iron Man: in turn-based combat or while the loaded sector holds enemies) and `deadIsDead` (an
  explicit save in Dead is Dead; `save {name: 'quick'}` writes the Dead is Dead file there, or answers
  `actionInProgress` outside our turn or while something still acts), plus `invalidName`, `reservedName` and
  `notSaveable`. A won campaign can be saved; loading is never restricted.
- **Autosave.** When `endTurn` is accepted in turn-based combat and combat goes on, the state from just before the
  command goes to `Auto01` or `Auto02` (the older or missing one), if the mode allows a save (never in Iron Man, the
  original's `UIHandleEndTurn`). In Dead is Dead the game writes its one file, after two backups
  (`Backup/<name>.j2s.1`, `.2`), at the start of our turn, at `endTurn`, when a meanwhile starts, when a group is about
  to arrive, before another save is loaded into the session and when the server stops; it is written only on our turn
  with no conversation, meanwhile, prompt, shop or action in progress, at the end of the input that saw the save point
  (later, once these hold).
- **Load modes.** By default a load is a player load: the saved state is restored exactly, then the main random stream
  is reseeded from a server seed (`crypto.randomInt`), returned as `seed` and logged as `reseed {seed}`; the `PreRandom`
  ring repeats its saved values until they are used up, as after a native reload. `reseed: false` is an exact load:
  the game continues bit for bit like the saved one (reproducible experiments, bug reports). A load checks the logic
  content before anything is built: another content source (stubs against original data) refuses it
  (`contentMismatch`); other game data (§5.10: the pack's identity, or the all-layers hash a save of U0b carries; a
  0.7.0 save is checked by its own hash over the files it lists, read from the raw data, with the files of the
  repository layers taken as they were saved, `docs/27` §1.7) refuses it on the original data (`contentMismatch`, also
  shown by `listSaves` for version 2 saves) and loads with the warning `stubPackDiffers` on the stubs, whose pack the
  repository generates; another data version or other quote lengths load with the warning `dataVersionDiffers`,
  another engine version or commit with `engineDiffers`. The result carries `warnings`.
- **Input log and replay.** Every save whose session has a known origin (a new sandbox or campaign with its seed and
  request, a native import with the file's digest, or the save it was loaded from) gets `<name>.log.jsonl.gz`: one
  JSON line for the origin, then `{seq, tick, kind, payload}` per input (`cmd`, `answer`, `advance`, `drive`, `reseed`,
  `load`, `prepare`). `pnpm cli replay <name>` rebuilds the origin, re-runs the log with the manual driver and compares
  the snapshot with the save. When a command or a step throws, the server writes the whole log as
  `Error.log.jsonl.gz` instead of an error save.

### 6.23. Game options and music (M7)

**Game options** (`docs/27` §2.2, §2.4) are session state, shared by the strategic and the tactical layer, saved and
shown: `{difficulty: 1 | 2 | 3, sciFi, gunNut, saveMode: 'anywhere' | 'ironMan' | 'deadIsDead', bloodAndGore}`.

- **New campaign.** `newSession {campaign: {options: {...}}}` (MCP and `POST /api/sessions`): missing fields take the
  original's defaults (sci-fi on, reduced guns, save anywhere, blood on) except `difficulty`, whose default here is 2
  (the original's is easy). `campaign.difficulty` and `campaign.saveMode` remain accepted as aliases; one that
  contradicts `options` is refused. The sandbox uses the defaults.
- **Shown** in `status`, `observe` and `GET /api/sessions` as `options`, in every save header (`listSaves`), and for
  native saves in the same shape (`droppedOptions: ['turnTimeLimit']` when the original's timed turns were on: they are
  not ported). A native import's `newSession` answer carries the import report as `import` (with `droppedOptions`).
- **`setOption {bloodAndGore: true | false}`** (an `act` command, logged and replayed like any other): the only option
  that may change during a game, as on the original's options screen; accepted in any flow, refused with `promptOpen`
  while a battle, contract, militia or NPC prompt is open and with `badOption` for any other field; it applies from the
  next tick and reports `optionChanged {bloodAndGore}`. Off: no messy deaths from close head and chest shots, no exploding
  bodies, the clean corpse graphics.
- **Client settings** (volumes, speech, subtitles, key-advance speech, the sleep/wake notification, display toggles,
  playback speed, language, meanwhile scenes seen, help, cover and LOS sizes) are per browser
  (`src/app/settings.ts`) and never reach the simulation; an agent that wants the original's sleep/wake stop passes
  `fellAsleep` and `wokeUp` in `advance {until: {events}}`, as the browser pages do for the sleep/wake setting.
  The launcher at `/` (`docs/27` §8.4) offers them with the new campaign form and the save list over the same API.

**Music** (`docs/27` §3.3, §3.7) is presentation the server computes, so every client hears the same mode: the
session keeps the original's music mode (`none`, `mainMenu`, `laptop`, `tacticalNothing`, `tacticalEnemyPresent`,
`tacticalBattle`, `tacticalVictory`, `tacticalDefeat`) from the simulation's events and the creature flag, sends
`music {mode, creature}` in the WebSocket `welcome` and in frames when it changes (`fastFade: true` after a sector entry
or exit), and keeps it in saves (`presentation.music`); a native import starts at the saved mode. The browser chooses
the tracks (`music.json`), fades and loops. MCP `observe` carries no music.

### 6.24. Inventory, reloading and first aid (M7)

D15: everything a player does with the inventory panel, the item description box, the reload cursor and the medkit
cursor is a command. The rules follow the original UI code paths (`docs/12` §3–§5); the API only replaces the item
cursor: a command picks an item up, puts it down and, when something is left in the cursor (a swap), returns it at
once the way the original's cancel does (`CancelItemPointer`: back into the slot it came from, else a free pocket, else
the soldier's feet; on the map screen, where the cursor cannot be cancelled, the sector inventory instead of the feet;
deviation "Item cursor"). Slots are `0`–`18` or the names `helmet`, `vest`, `legs`, `head1`, `head2`, `hand`,
`secondHand`, `bigPocket1`–`4`, `smallPocket1`–`8`; `count` is `1` (one object, `index` picks it from the stack: the
stack popup) or `"all"` (the shift-click, the default of `moveItem` and `drop`). Refusals carry `data.refusal`.

| Command | Original | Rules, costs and refusals |
|---|---|---|
| `moveItem {soldier, from, to, toSoldier?, count?, index?, merge?}` | `SMInvClickCallbackPrimary`, `UIHandleItemPlacement`, `PlaceObject` | Free inside one inventory (also in combat). To another merc of ours (`CheckForDisabledForGiveItem`): he must be in sight within 3 tiles (2 when he is unconscious; for a merc below OK life, any merc of ours within 2 tiles who sees him enables it); both conscious mercs need 3 AP and pay 2 each in combat; a swapped-out item then stays with the receiving merc (the cancel puts it into his slot with the source slot's number, a free pocket or his feet). Onto a hand or armour slot whose item the moved item attaches to: `useAttach`; onto one it merges with (`ValidMerge`): `mergePrompt`, then `merge: true` runs `AttachObject` (no transfer AP, `AP_MERGE` for real merges) and `merge: false` swaps. `to: "ground"` is `drop`. Nails keeps his jacket (`nailsVest`). Other refusals: `badSlot`, `badCount`, `badIndex`, `emptySlot`, `sameSlot`, `noSuchTarget`, `noInventory` (escorts, vehicles), `tooFar`, `noLineOfSight`, `notEnoughAP`, `doesNotFit` (`CanItemFitInPosition`, face items that clash, a two-handed item into a full pair of hands). Ammunition dropped on a gun reloads it (`ReloadGun`, 5/10 AP in combat). Event `itemMoved`; a hand change plays `LOWER_RIFLE`/`RAISE_RIFLE` and resets burst mode (`ReLoadSoldierAnimationDueToHandItemChange`), a face item re-runs sight (`PlaceObject`) |
| `drop {soldier, slot?, count?, index?}` | `HandleItemPointerClick` on the soldier's tile, `SoldierDropItem` | 3 AP (`AP_PICKUP_ITEM`), the `DROP_ITEM` animation when standing; event `itemDropped` |
| `toss {soldier, slot?, count?, index?, gridNo, level?}` | `HandleItemPointerClick`'s toss: the object leaves the slot and flies with `THROW_ITEM` or `LOB_ITEM` (`CalculateLaunchItemParamsForThrow` without a miss); a merc of ours on the tile beyond passing range turns to the thrower and tries to catch it (`PreRandom(100)` against 50 + dexterity / 2 within one tile, `AutoPlaceObject`, else he is struck for one point and it falls); escorts, the unconscious and swimmers cannot toss | `AP_TOSS_ITEM` (8) at the release, no turning cost; refusals `tooClose` (drop instead), `passInstead` (`give` instead), `targetMoving`, `badThrow` (`CalculateLaunchItemChanceToGetThrough` fails), `cannotToss`, `notEnoughAP`; events `catchEnded {soldier}` (`CATCH_OBJECT`) and `itemCaught {soldier, item}` (`MSG_MERC_CAUGHT_ITEM`) |
| `attach {soldier, item, to, toSoldier?, index?, count?, permanent?}` | `ItemDescAttachmentsCallbackPrimary`, `DoAttachment`, `AttachObject` | The item description box of the item in `to` (also another merc's in passing range, without transfer AP): needs `AP_RELOAD_GUN` (5) left in combat and, when the host's attachments (item or status) change, spends `AP_RELOAD_GUN` from the attaching merc (the original's charge when the description box closes, made per command: deviation "Attachment AP"); merges other than kit or ammo points cost `AP_MERGE` (8). The `ATTACHING_*` skill checks (`AttachmentInfo`; merges −30) draw `PreRandom` and damage both items on failure; combo merges (`SPRING_AND_BOLT_UPGRADE`, …) grant mechanical experience; `index` is the stack object that kit points pour into. Inseparable attachments ask first (`permanentAttachment`, repeat with `permanent: true`); `cannotAttach`. `data.result`: `attached`, `merged`, `destroyed` (a bad compound merge), `failedCheck`; event `itemAttached` |
| `detach {soldier, slot, attachment, to?}` | `ItemDescAttachmentsCallbackPrimary`, `RemoveAttachment` | Needs 8 AP left in combat (`AP_RELOAD_GUN + AP_PICKUP_ITEM`) and spends `AP_RELOAD_GUN` (deviation "Attachment AP"); `inseparable`, `noAttachment`; into `to` or a free pocket (`noRoom`, `doesNotFit`); an under-barrel launcher takes its grenade along; event `itemDetached` |
| `unload {soldier, slot?, to?}` | `ItemDescAmmoCallback`, `EmptyWeaponMagazine` | Free; the magazine keeps the rounds, the gun remembers the magazine type; `notAGun`, `gunEmpty`, `noRoom`; event `gunUnloaded` |
| `reload {soldier, slot?, ammo?}` | `HandleUIReloading`, `AutoReload`, `GetAPsToAutoReload`; a magazine dropped on the gun: `PlaceObject` → `ReloadGun` | One magazine from `ammo` onto the gun (default the hand): `AP_RELOAD_GUN` 5, 10 with a magazine of another size, launchers 5; real-time reloads are free and top off. Without `ammo` the hand is the reload cursor (`FindAmmoToReload`; the cost of both pistols when the second can be afforded), another slot takes the best match. `notAGun`, `wrongAmmo` (calibre), `noAmmo`, `notEnoughAP`, `cannotReload` (the rocket launcher, no room for the old magazine); event `reloaded` |
| `swapHands {soldier}` | `TMClickFirstHandInvCallbackSecondary`, `SwapHandItems` | Free; a two-handed item in the second hand pushes the main hand item into a pocket first (`noRoom`); the robot cannot (`robot`) |
| `applyItem {soldier, slot, target?}` | `SMInvClickCamoCallback`, `ApplyCamo`, `ApplyCanteen`, `ApplyElixir` | On the soldier or a merc in passing range, paid by the target: canteen `AP_DRINK` 5 and breath `2 × min(20, points) × (100 − breath)` (allowed when collapsed from breath alone), camouflage kit `AP_CAMOFLAGE` 10 (one kit point per two camouflage points), elixir 10; `notEnoughAP`, `cannotApply` (full camouflage, empty kit), `unconsciousTarget`; drugs and alcohol `notPorted`; tactical only. Event `itemApplied` |
| `bandage {soldier, target?}` | `HandleItem` (medkit branch), `EVENT_SoldierBeginFirstAid`, `SoldierDressWound`, `HandlePlayerServices` | The medkit cursor: a first aid kit or medical kit in the hand (`noKit`), the cursor checks (`mechanical`, `noMedicalSkill`, `notBleeding`: first aid only stops bleeding, `noNeed`), then `FindAdjacentGridEx` (`cannotGetThere`) and `GetAPsToBeginFirstAid` plus the path (`notEnoughAP`); walks up (`MERC_GIVEAID`, `data.walking`) or starts (`data.started`). `START_AID` costs `AP_START_FIRST_AID` 5 after the crouch (2 more from standing). The medic then dresses the wound (`SoldierDressWound`) at the end of every round in combat with the APs he has left, and on every 5 s real-time turn with `RT_FIRST_AID_GAIN_MODIFIER` 12 APs: life below OK life first at 2 points each, then bleeding; a medical kit gives half again for half the points; kit points are taken from the last object; an empty kit is replaced by another first aid kit, then a medical kit. A move, stance change, climb, blast, collapse, incapacitation, death or hand item change of the medic, and a move of the patient, end the service (`END_AID`, then standing up when no enemy is left). Being bandaged costs 20 to hit and in close combat, the medic loses 2 interrupt points. NPCs may refuse (`PCDoesFirstAidOnNPC`, creatures, hostile soldiers): event `firstAidRefused`. Events `firstAidStarted`, `bandaged {life, bleeding}`, `firstAidDone`, `firstAidEnded`, `outOfBandages`. NPC action 12 ends a service to the NPC |

Throwing needs no command of its own: move the grenade into the hand (`moveItem {to: "hand"}`), check it with
`estimateAttack` (`apCost`, `chanceToHit`, `landsAt`, `maxRange`) and throw it with `attack` at the tile.

**Map screen.** In the campaign's strategic flow `moveItem`, `attach`, `detach`, `unload`, `reload` and `swapHands`
take no APs (`MAPInvClickCallbackPrimary`) and work for every merc whose inventory is accessible
(`MapCharacterHasAccessibleInventory`: not in transit, captured, an escort, a vehicle, the robot or below OK life;
`inaccessible`). Items pass between mercs in the same sector only (on the road: the same squad or vehicle) and never while
the loaded sector holds enemies (`MapscreenCanPassItemToChar`: `otherSector`, `hostileSector`); a swapped-out item goes
back to where the moved one came from. A hand or armour item the moved item attaches to or merges with opens the
description box (`useAttach`). The sector inventory: `moveItem {from: "ground", item: <stash index>, to, sector?}` and
`moveItem {from, to: "ground", stashIndex?, sector?}` for a merc standing in that sector and not on the road
(`notInSector`), not during a battle there (`CanPlayerUseSectorInventory`: `battleInSector`); only reachable items can be
taken (`unreachable`); a stash slot takes up to `ubPerPocket` objects and swaps different items
(`PlaceObjectInInventoryStash`); a new item lies on the merc's tile, flagged reachable. `inventory {sector?, z?,
soldier?}` is a query (accepted in every flow): `{sector, z, usable, refusal?, stash: [{index, item, count, status,
money?, ammo?, attachments?, jammed?, imprint?, reachable, gridNo, level}], mercs: [{id, name, accessible, betweenSectors,
inventory}]}` (`ammo`, `attachments`, `jammed` and `imprint` as in an inventory slot: the pool draws them). The stash lists the
items seen on the ground of the sector (`IsMapScreenWorldItemVisibleInMapInventory`: visible, not trapped, no switches or
action items): the loaded sector's items or the sector's saved items, which hold what was left there, dropped on a
retreat or delivered by Bobby Ray once a merc has seen it. Leaving a sector and the query on the loaded sector recompute
the reachable flag (`HandleAllReachAbleItemsInTheSector`). `applyItem` and `bandage` are refused on the map screen
(`tacticalOnly`); the trash can is `discardItem` (§6.30).

**Turn-based lock of queued orders** (`docs/27` §14 finding 20). A gun attack starts with a queued `beginFireWeapon`
game event; the original UI locks after the click (`SetUIBusy`), so every order and `endTurn` are refused while a game
event is queued (`the last order has not started yet: advance first`).

### 6.25. The HUD view, events and protocol (M8, U3a)

What the original's tactical panels, top bar, message list and speech surfaces read, added to the view and the event
log without revealing more than those screens show (D16, `28` §12). The full field list is in the MCP `observe`
description; this section names the rules.

**Own soldiers** (`src/sim/tactical/soldier-view.ts`): `profile` always (when the soldier has one), `bleeding`,
`breathMax`, `morale`, `stats {agility, dexterity, strength, leadership, wisdom, level, marksmanship, explosives,
mechanical, medical}` (the SM panel values), `armour` (`ArmourPercent`), `weight` (`CalculateCarriedWeight`), `camo`,
`stealth`, `weaponMode` (`single`, `burst`, `launcher`), `muted` (the flag U6's `mute` will set), `sees` (the ids of the
enemies in the view this merc sees now), `canAct` (the face hatch rule: our turn and not moved during an interrupt; a
hidden enemy interrupt keeps it true), `continueTo` (the End key's target: `sContPathLocation` with `bGoodContPath`,
else the final destination of a halted move), `noApToFinishMove` (`fNoAPToFinishMove`: the merc stopped mid-move for
want of action points and stays in his moving animation, which the cursor counts as standing still), `firstAid`
(`medic`, `patient` or null) and `blinded`; in a campaign
`asleep`, `squad` (null outside a squad) and `vehicle {id, driver}` from the roster, in the sandbox squad 0. Inventory
objects add `jammed` and `imprint` (the profile a rocket rifle answers to, 201 for an unknown owner, `GetObjectImprint`).
**Other soldiers in sight** carry `hostile` (`!bNeutral && bSide != FRIENDLY`, the glow test) and `healthIndex` (the
index of `zHealthStr`, `GetSoldierHealthString`; −1 once `bLife` is 0, while the death animation plays until
`soldierDied`, which the radar greys, the health word names dying and the enemy cycling skips), never life. **Ground items** add `money` and `attachments`.

**The muzzle flash.** Every soldier entry carries `muzzleFlash: true` from his shot (`UseGun` sets `fMuzzleFlash`) until
the flash goes out (`EndMuzzleFlash`: the end of his attack in real time, his next A.I. decision, his team's A.I. list,
the end of our merc's attack on our turn, the end of combat), absent otherwise: whoever looks at him sees him as far as
in daylight (`DistanceVisible`), and the chance to hit him reads that, so the hints need it.

**The animation schedule.** Every soldier entry carries `frameSlot` (the timeline slot of the frame it shows, `28`
§2.3), `stateTick` (the tick its animation state started) and `frameDelay` (`sAniDelay` in ms); `frame` (the sprite
frame) stays for the devtools pages and the sound director (U4b's renderer follows the schedule, §6.27).

**The combat block** adds `uiLocked` (orders are refused: not our turn, an attack resolving, a queued order or an own
merc acting), `topMessage {kind, team, bloodcats}` and `ai {current, total}`. The turn state keeps the top message the
original creates (`AddTopMessage` at the start of our turn, an interrupt in our favour and its end, the enemy team's
turn, a displayed hidden interrupt: `computerInterrupt` or `militiaInterrupt`) and the progress bar
(`InitEnemyUIBar` when an AI list is built, `UpdateEnemyUIBar` when an AI soldier starts outside an interrupt); `ai` is
shown while a computer message is up. A hidden enemy interrupt shows our turn in `team` and `topMessage`, and orders
during it are refused with `uiLocked` rather than `notYourTurn` (rule finding 7). Snapshot version 4 adds these fields
(older snapshots get the stateTick of the save and a derived top message).

**Events.** `lifeLost {soldier, amount}` from every life deduction of a visible soldier (`SoldierTakeDamage`: hits,
bleeding, gas, falls); `aiTurn {soldier}` when the original locates the acting AI soldier (visible, alive, outside an
interrupt, not green friendly militia); `enemyTurnProgress {done, total}` at every `UpdateEnemyUIBar`; `itemsRevealed
{gridNo, level}` where the original sets an item locator (`SetItemsVisibilityOn` with locators); `enemySighted` carries
`enemies` (the ids that became known); `interrupt` carries `selected`; `groupArrived {group, sector, final, who}` for
every player group arrival (`who`: `{kind: merc, soldier}`, `{kind: squad, squad}` or `{kind: vehicle, vehicleType}`, the
`MSG_ARRIVE` subject); `invasion {sector, kind: sam|town|other}` (`NotifyPlayerOfInvasionByEnemyForces`);
`sectorControlChanged` carries `kind` (`sam`, `mine`, `town`: the notice of `NotifyPlayerWhenEnemyTakesControlOfImportantSector`)
and `dailyIncome` (the projected income after a producing mine is lost); `sectorLoaded` carries `loadScreen {id, path}`
(`GetLoadScreenID`, drawn at every sector entry outside a save load and the PBI transition, with `Random(2)` on the
gameplay stream for town sectors without a mapped picture, rule finding 2); `mercQuote`, `headMinerQuote` and
`skyriderQuote` carry `textKey` and `chars`, merc quotes also the speaker's `sector`. Conversation lines carry `chars`,
the conversation `faceVariant` (Elliot's beaten big faces).

**Message entries** (`src/server/message-entries.ts`, `src/protocol/message-log.ts`). A presentation module outside
`sim` turns events into the entries of the original's message list (`Utils/Message.cc`): `{tick, kind, colour, table,
index, args}` with `kind` `interface` (yellow, `INTERFACE_COLOR`), `dialog` (white; `textKey` and `speaker` instead of a
table: `Nick: "line"`, civilian hints without a speaker), `uiFeedback` or `skullFeedback` (their own colour, never kept);
`args` are `{text}`, `{number}`, `{money}`, `{string: {table, index}}` or `{item, name: short|long}`, consumed by the
format's placeholders in order with extra args appended; an entry without a table joins its args with spaces (the stat
gain line). Covered sites: noises, deaths of visible named civilians (our dead on the skull feedback), enemy in sector,
interrupts, stat gains, reloads, first aid done, out of bandages, refused aid, out of APs, the lock and trap lines,
recruits, escorts, balances, items placed on the ground, arrivals, history updates, unpaid R.P.C.s, Skyrider's bill,
repairs, unjammed guns, aborted assignments, group arrivals, invasions of open sectors, game saved, and dialogue lines.
Refused commands add an entry only where the original prints the refusal in the log (`notEnoughAP`, `noPath`,
`mercUnavailable`, `uncontrolledRobot`, `outOfBreath`, `noBurst`, `noRoomToFire`). The session keeps the last 256
entries (`MESSAGE_LOG_SIZE`) in its presentation block: they are saved with the game (`presentation.messages`), arrive in
the WebSocket `welcome` (`messages`, the whole ring) and in frames (`ViewFrame.messages`, the new ones), and every
`advance` report carries `messages` (the entries since the last report). The simulation never reads them.

**Refusal tokens.** `move`, `turn`, `stance`, `attack`, `climb`, `pickUp`, `drop`, `useRemote`, `route`, `assignSquad`,
`sleep`, `wake`, `compressTime` and `enterSector` answer refusals with `data.refusal` (the tokens are listed in the MCP
`act` description); `assign` keeps its per-soldier results and names the first failure in `reason`. The text keys
`refusal.<token>` (`GET /api/strings`, `/api/text?key=`) map each token to the original's message where it has one
(`TacticalStr`, `pMapErrorString`, `zMarksMapScreenText`, `Message`, `pMessageStrings`, `gzLateLocalizedString`);
`REFUSAL_MESSAGES` (`src/server/text-keys.ts`) also says whether the original logs it or shows a box.

**Protocol.**

- `drive {driver: {mode: 'realtime', speed, pauseOn?: EventType[]}}`: the real-time driver stops on the tick of the
  first listed event, becomes `manual` and sends `stopped {id: 0, report}` with reason `event`; the input log records the
  batch as `advance {until: {ticks, events}}`, so a replay stops at the same tick.
- The real-time driver pauses on a decision (an interrupt in our favour with nobody acting, a prompt, an open
  conversation or shop) without leaving real time: its batches run no ticks, log nothing and drop the elapsed time while
  the decision is pending, and time runs on by itself once it is resolved (an order during the interrupt, an answer, the
  conversation or shop closed). It used to become `manual` without telling the viewers, so the game page froze after
  its first order in an interrupt.
- `closeSession` (WebSocket `{t: 'closeSession', id}`) and `DELETE /api/sessions/:id`: run the Dead is Dead save point
  "when the session is closed" (`docs/27` §1.6) and release the session; the default session is refused
  (`defaultSession`, 409), an unknown one is 404.
- `POST /api/sessions` and `newSession` take `campaign.deadIsDeadDescription`: the server derives the save name
  (`<UTC time>-<slug>`, like player saves) and keeps the description in the Dead is Dead save's header; it cannot be
  combined with `deadIsDeadName`.
- `GET /api/sessions/:id/profiles` → `{profiles: [{id, name, nickname, faceIndex, eyes, mouth, blinkFrequency,
  expressionFrequency, smallFace, aimBio, mercBio}]}`, revalidated by ETag: the face index is the profile id
  (`LoadMercProfiles`; Herve, Peter, Alberto and Carlo share Herve's portrait), an I.M.P. character gets its portrait's
  face with zero eye and mouth offsets (`SelectMercFace`), `smallFace` comes from `mercs-rpc-small-faces.json`, the bio
  rows from the A.I.M. and M.E.R.C. listings (rows of `aimbios.edt` and `mercbios.edt`). On stubs the faces come from
  `stubs/profiles.json` (an optional `face {index, eyes, mouth, blinkFrequency, expressionFrequency}`, the index defaults
  to the id); a stub sandbox has no profiles.
- `GET /api/items?lang=` → `{language, dataVersion, items: [{index, name, shortName, longName, description,
  bobbyRayName, bobbyRayDescription, class, classIndex, inventoryGraphics {small, big}, tileGraphic, weight, perPocket,
  price, coolness, reliability, repairEase, flags, weapon, magazine, armour, explosive}]}` (ETag, an hour's cache): names
  and descriptions from `itemdesc.edt` of the data version, Bobby Ray's texts from `braydesc.edt` for weapons, armour
  and explosives (magazines: the short name; other items: the name), calibre names from `ammo-calibre` and
  `ammo-calibre-bobbyray` in the display language with `showInHelpText` (from `calibres.json`: whether the hand slots'
  help text names the calibre, `GetHelpTextForItem`). `ItemDef` parses `inventoryGraphics` and `tileGraphic` with the
  defaults of `ItemModel` (`interface/mdguns.sti` 0, `bigitems/gun00.sti` 0, `GUNS` 1).

### 6.26. Queries, cursor hints and the player-knowledge projection (M8, U3b)

Cursor feedback (the path and its AP cost under the pointer, the chance to hit, valid drop targets, ETAs while
plotting, which menu lines are enabled) needs answers several times a second. The original computes them in the UI
with the rules' own functions; ja2-node does the same, in the browser and on the server, with the simulation's own
functions over the **player-knowledge projection** (`28` §2.4).

**The projection** (`src/sim/knowledge/`). `knowledgeWorld(view, rules, {strict?})` builds from a player view and the
rule content the minimal world the hint functions read: for tactical hints a `TacticalState` over a fresh copy of the
sector's world (`TacticalProjection`, cached per map and synced per view), with the doors set to the view's `openDoors` and the containers to its `openContainers`
and their perceived lock and trap from `doors`, the ground items of `items`, the light of `light` (the base level and the
powered light sprites, drawn by the simulation's lighting over the projected doors), the player's soldiers in full
(the view's own fields, the inventory rebuilt as objects, and the own soldiers' `hint` inputs: skill traits,
personality, shock, last target, tiles moved, carried weight at the turn start, collapsed, gassed, under AI control)
and only the soldiers the player sees, with only their visible fields (position, stance, body, the hand item class and
the health category as appearance stand-ins for the person structure). Unseen soldiers do not exist in it, so they
block no path, absorb no bullet in a chance to get through and are no target. For strategic hints a minimal strategic
state built from the strategic view and the static strategic content (`strategic.ts`). In **strict mode** (tests) every
field the view does not supply throws `UnsuppliedFieldError` when a hint reads it, so a hint that reads hidden state
fails at once; every such read was decided: supplied from the view (own soldiers), given a documented neutral value
(other soldiers' tiles moved, awareness and collapse; `deviations.md` §6), or the answer part dropped (the melee chance
to hit). `knowledgeViewOf(sim)` gives the same view from a `TacticalSim` for simulation tests.

**The hint kinds** (`src/sim/hints/`, dispatched by `answerHint`; each answer is `{ok, reason?, data}` with
`data.refusal` on a refusal, like a command):

| Kind | Request | Answer (`data`) |
|---|---|---|
| `previewMove` | `{soldier, to, mode?, reverse?, level?}` | `{destination: ok \| blocked \| heightDiffers \| robotUncontrolled, apCost, firstStepCost, affordable, steps: [{gridNo, enterDir, leaveDir, band}], refusal?}`: `UIPlotPath`/`PlotPath` (start cost, the run start cost, the fence rule), the footstep colour bands (crawl, swat, walk, run, none; real time: none), the first step plus the stance change (`SelectedMercCanAffordMove`), `UIOKMoveDestination` and the land height check; `level` is the interface level (another level plots nothing); `refusal` names a view-level lock (`uiLocked`, `mercUnavailable`, `cannotAct`) |
| `estimateAttack` | `{soldier, target, level?, aimTime?, bodyPart?, burst?, weaponMode?, mode?}` | `{cursor, weaponMode, apCost, apCostByAim[0..4], actionPoints, chanceToHit, chanceToGetThrough, inRange, ammo {empty, canReload, reloadAp}, inReach?, pathClear?, landsAt?, landsOnLevel?, maxRange?}`: `GetActionModeCursor`, the reload cursors, `InRange`, the toss and trajectory branch with the launchable attachment and the attached grenade launcher (`CalculateLaunchItemChanceToGetThrough` with the landing level). Without `burst` or `weaponMode` the soldier's mode as `EnsureConsistentWeaponMode` would leave it (a burst mode kept after the gun left the hand estimates the fists); `mode` is the movement mode of a melee walk-up (`usUIMovementMode`); a melee cursor over a tile with nobody at the attacker's level answers `inReach: false` with no costs instead of a refusal, as the cursor only needs the grey fist or knife. Every other hand item answers its `GetActionModeCursor` kind instead of `noWeapon`: `aid`, `remote` (`apCost` = `AP_USE_REMOTE`), `bomb`, `wirecutter`, `repair`, `refuel`, `jar`, `tincan`, `invalid`, or `other` for the cursors `GetProperItemCursor` has no branch for, with no strike numbers |
| `previewAction` | `{soldier, gridNo, level?, kind, target?, mode?}`, kinds `door`, `pickUp`, `talk`, `give`, `jump`, `swap`, `look`, `aid` (`steal`, `cutFence`, `repair`, `refuel`, `jar`, `can`, `bomb`, `enterVehicle` answer `notSupported`) | `{kind, ok, refusal?, apCost, affordable, actionGridNo, steps, direction?, open?, menu?, inRange?, lineOfSight?}`: one branch of `DrawUIMovementPath` each (the adjacent tile, the walk-up footsteps, the action's AP: `doorAPs`, `AP_PICKUP_ITEM`, `AP_TALK`, `GetAPsToGiveItem`, `GetAPsToJumpOver`, `AP_EXCHANGE_PLACES`, `GetAPsToLook`, `GetAPsToBeginFirstAid`), the door menu for a door the player believes locked, `IsValidJumpLocation`, `ValidQuickExchangePosition` |
| `placements` | `{soldier, slot, count?, index?, mapScreen?}` | `{cursor {item, count}, slots: [{slot, invalid, hatched, attach, merge, highlight, fits}], secondHandBlocked, applyOnMerc, compatibleMercs}`: `ReevaluateItemHatches` (`CanItemFitInPosition`, `ValidAttachment`, `ValidMerge`), `InternalHandleCompatibleAmmoUI` (two-way attachments and launchables, the calibre) and a dry-run placement |
| `itemInfo` | `{soldier, slot, index?, metric?}` or `{item, metric?}` | `{item, kind, count, weight, status?, amount?, money?, weapon?, title?, ammo?, pros?, cons?}`: the description box's numbers (`Weight()` per object in kg or lb, `GunRange`/10, impact, `BaseAPsToShootOrStab(20, 80)`, the burst AP, the white highlights), the gun title and the pros and cons as `Message` indices |
| `exitSector` with `dryRun: true` | the `exitSector` fields | `{minutes, who, load, target, level}` or the refusal the command would give: `OKForSectorExit` and the exit menu rules, shared with the command (`sector-exits.ts` runs on a narrow `ExitWorld`) |
| `exitSectorOptions` | `{soldier}` | the exit dialog's result (0, 1, 2) and choices (single or squad, load, their enabled states) and `enemyInSector` (for the dialog's `SingleMoveAction`): `InternalInitSectorExitMenu` |
| `canEnterSector` | `{sector}` | `{allowed, reason?}`: an open strategic prompt, a battle in another loaded sector, `CanGoToTacticalInSector`, a map for the sector |
| `assignmentOptions` | `{soldier}` | `{box: assignment \| epc \| removeMerc, lines, squads, vehicles, repair, training, attributes {self, teammate, byOther}}`, each line `{line, enabled, shade: none \| gray \| yellow, reason?, target?}`: `HandleShadingOfLinesForAssignmentMenus` and the `CanCharacter*` checks |
| `previewRoute` | `{soldier, to, via?, shortest?}` | `{path, temp, edgeMinutes, etaMinutes}`: `BuildAStrategicPath` from the end of the merc's path (`shortest` = Shift, every edge 60 minutes), `FindTravelTimeBetweenWaypoints`, and the ETA as the map screen shows it while plotting: `GetGroundTravelTimeOfSoldier` sums `GetPathTravelTimeDuringPlotting` over the temporary and the merc's path, so while the group is between sectors the remaining leg counts twice and the temporary path's first edge is dropped (`MapScreen.cc:939-1045`, `:7142-7153`; kept, D1) |
| `previewHeliRoute` | `{to, via?}` | `{path, temp, distance, safe, unsafe, cost, etaMinutes, passengers, refusal?}`: `DistanceOfIntendedHelicopterPath` (9999 when it cannot fly), the safe and unsafe counts with the original's first-node rules, safe × 100 + unsafe × 1000, the ETA with the same double count (`Map_Screen_Interface_Map.cc:2169-2226`) |

**Server-only queries.** Answers that depend on state the player does not see or that price a decision stay on the
server: `aimQuote`, `bobbyRayQuote`, `insuranceQuote`, `impPreview`, `arrivalTime`, `quoteTrade`, `contractOptions` and
`inventory` (other sectors' stashes included), plus `hireCheck` and `impCheckCode`, which the simulation does not answer
yet (`unknownCommand`, U10/U11). The query service passes them to the simulation's own command handlers without
logging them; the purity test (`src/server/query-purity.test.ts`) runs every one of them and compares the session
snapshot byte for byte (it found the stash read of another sector creating an empty sector diff, fixed).

**The query channel.** WebSocket `{t: 'query', id, q}` → `{t: 'answer', id, ok, tick, reason?, data?}`. `SessionHost`
gains `query(q)`: the in-process host answers it like `observe`, between ticks, outside the session's input queue
(during a sliced advance it runs between slices), never appends it to the input log, captures no frame and runs no
advance under the instant driver; the worker host forwards it as a host call. The WebSocket server sends the answer as
soon as it is ready, outside the ordered reply chain of commands. `isQueryCommand` (every hint kind, `exitSector` with
`dryRun: true`, and the server-only kinds) also routes a query that arrives as a command (MCP `act`, WebSocket `cmd`)
to the same path, so agents keep queries as `act` commands and get the projection's answer; replaying an old input log
that holds a query still dispatches it to the simulation (`estimateAttack` is gone from `TacticalSim` and is refused
there). The answer's `tick` names the view it was computed on (§6.35): with viewers, the view they hold. `Session.queries` is a `QueryService`
(`src/server/query.ts`, attached by the session factory) that keeps a fresh copy of the loaded map's world inputs for
the projection (two maps) and the knowledge rules per content; the server builds the projection per query.

**Fairness.** The server answers every hint over the projection of the same view it sends the player (D16): unseen
soldiers do not exist (`src/server/hints-fairness.test.ts`, `hints-actions-stub.test.ts`: an unseen enemy on the target
tile and the path changes no answer), the strategic hints read only the enemy counts the view shows, and the melee chance
to hit, which needs the defender's hidden ratings, is `null`. Where the original UI itself read hidden state the
projection does not; the command then refuses on the full state with the original's message (`deviations.md` §6).

**The client** (`src/app/hints/`). `ClientKnowledge.open(source, welcome identity)` loads the rule content with U0b's
`loadClientRules` and the same loaders (`loadTacticalContent`, `loadStrategicRules`, the world loader on demand per
map), and is usable when the engine identity Vite injects (`__JA2_ENGINE__`, from `engineIdentity()`) and the rule
pack and scripts hashes equal `welcome`'s. `HintProvider` (implementing `GameClient` of `src/ui/game-client.ts`:
`hint(request)` every frame, `hintNow`, `query`) computes hints on the latest received view (not the playback view)
once the request has rested 80 ms (`PATHFIND_REST_MS`, per hint kind), caches them per view, builds the projection once
per view, and falls back to the query channel when the knowledge is unusable or the map is not loaded yet. In **shadow
mode** (`?shadowHints=1` on the devtools tactical page, on in e2e) it sends every local hint to the server as well and
counts compared, stale (the view held when the reply arrives cannot be answered locally; before 2026-10-26: another tick) and differing answers; `window.__ja2Ui.hints` exposes the statistics, including
the latency of hints and of projection builds.

### 6.27. The world view (M8, U4b)

What the original draws in the loaded sector besides the soldiers and the items (`28` §12.1 G8), from
`src/sim/tactical/world-view.ts`. Every field is in the tactical view whenever a sector is loaded and is re-sent whole
when it changes.

- `corpses [{gridNo, level, type, direction, bodyType, palettes?, camo?}]`: every rotting corpse of the sector (the
  original draws all of them, `bVisible` is always 1); `type` is the corpse type of `tables/corpses.json` (the rotting
  stage is `ROTTING_STAGE2`, decided when the sector loads), `palettes` the soldier's `[hair, skin, vest, pants]`
  palette names and `camo` the camouflage flag (`ROTTING_CORPSE_USE_CAMO_PALETTE`). Corpse records now keep the
  palettes and the flag (deaths, unloaded-sector deaths, native save import); older records have none and are drawn
  with the graphic's own palette.
- `smoke [{gridNo, level, effect, dissipating?}]`: every tile with a smoke effect, `effect` the name of
  `smoke-effects.json`; `dissipating` marks a tile whose graphic was added while its cloud had fewer than two turns
  left (`AddSmokeEffectToTile`), kept as bit 0x40 of the smoke tile flags.
- `light {ambient, sprites [{x, y, template}]}`: the ambient light level (`ubAmbientLightLevel`) and the light sprites
  that are not map lights: explosions (`L-R04.LHT`) and muzzle flashes (`L-R03.LHT`); light effects would add
  `Light{radius}`, which the simulation cannot create (deviation "Light effects").
- `tileChanges [{kind: remove|add, gridNo, level, tile}]`: the structure graphics changed since the map was loaded, in
  order, from the map changes the sector diff keeps (a structure record turned into the tile index whose structure it
  is): wrecked and damaged structures, the O3 statue and window hits. A bullet's window hit is now recorded like an
  explosion's (`AddWindowHitToMapTempFile`), so a broken window stays broken when the sector loads again.
- Ground items add `height` (`bRenderZHeightAboveLevel`, when lying on a structure) and `notRendered`
  (`WORLD_ITEM_DONTRENDER`, items inside an open container).
- `blood [{gridNo, strength, creature?}]`: the blood pools on the ground as the squad last saw them (2026-10-27).
  `UpdateBloodGraphics` keeps one pool graphic per tile in the object layer and replaces it only when the tile's blood
  was changed (`MAPELEMENT_REEVALUATEBLOOD`: a drop, a decay step, a corpse wiping it) and then either dropped by a
  visible soldier or seen by a merc of ours (`RevealRoofsAndItems` on every tile it reveals); the simulation keeps
  those two per-tile states (`reevaluateBlood`, `shownPools` of the smell map). `strength` is the floor strength 1–7
  (the graphic is one of four sizes, `3 − strength/2`), `creature` the creature blood type, and `strength: 0` a tile
  whose pool the squad saw go, where the browser takes away the blood object the map itself placed. Roofs show none
  (the original draws no roof blood, and a roof merc's look clears the tile's flag without redrawing the ground).
  Nothing shows with blood and gore off. The browser puts the pool graphic at the head of the tile's objects and picks
  one of the four variants from the tile and the strength (deviation "Cosmetic draws in attacks").
- `light` is the one light block of §6.26: every active light sprite with `dynamic: true` on the muzzle flashes,
  explosions and flares; the renderer draws the map's own lights from the map and adds only the dynamic ones, the hints
  read them all.

### 6.28. Talk, shop and money (M8, U7)

What the canvas talk panel, the speech surfaces, the shop screen and the single merc panel's money region read and
send (`28` §5.8, §5.9, §12.1 G14, G15, §12.4; `23` §13). Nothing here changes a rule of the original; the shop and money
commands are the original's UI actions made atomic.

**Quote text (G14).** Every quote event carries the line's `textKey {file, row, width}` and `chars` (UTF-32 characters,
which time the line: 60 ms each on the client, 12 ticks in the simulation), and the session adds `text`: `npcQuote`,
`mercQuote` (barks from the dialogue queue, the own-merc bark of `talk` on a squad mate, contract quotes; merc quotes
also name the speaker's `sector` for the comm popup), `civQuote`, `skyriderQuote` (with `profile`), `headMinerQuote`
and, new, `shopkeeperQuote` (the dealer's lines from his NPC file, `npcdata/NNN.edt` as `CharacterDialogue` reads them
for `DIALOGUE_SHOPKEEPER_UI`). Conversation lines (`data.lines`, `conversation.lastQuotes`) carry `chars`; the
conversation carries `faceVariant` (Elliot's beaten big faces, `b135a`–`e`).

**Events after a command.** The events a command emits (the lines `talk`, `approach`, `give` and `trade` run through the
dialogue queue, a shop's quotes, the money events) reach the WebSocket frame captured right after the command instead
of waiting for the next step of the simulation, which never comes while a conversation or a shop holds the clock;
the next `advance` report still lists them (`Session` holds them for it), so agents see them as before.

**Frames while a command runs ticks (2026-10-27).** The conversation commands run tactical ticks before they return
(`24` §11.6): `talk`, `approach`, `answer` on an NPC request, `unescort` in tactical and `openShop` drain the dialogue
queue, and `give` to an NPC walks, hands over and drains the conversation it opens; two lines take about 1200 ticks.
Those ticks went through `CampaignSim.step` without the session's recording stepper, so a viewer got a single frame
at the end of the command and the page played about 6 s of game time with nothing shown before the talk panel
opened, then the lines. Now `SessionSim.dispatch(cmd, steps)` takes a step observer: `CampaignSim.dispatch` keeps it
for the duration of the command and `stepWithinCommand` (the drains of `TalkFlow`) calls it after every tick, and the
session's observer holds the tick's events and captures a frame every `FRAME_TICKS`, as the recording stepper of an
advance does. The command's frames go out together before its result, the client plays them at its playback speed,
so the panel opens with the first line, each line reaches the speech presenter at the tick the simulation says it and
a walk to the NPC stays animated. Nothing the simulation does changes: without viewers nothing is captured, the input
log and replays dispatch without an observer, the result and the events of the next report are the same. A drain of
two lines costs about 80 ms with a viewer (115 captures in A10 on stubs) instead of 5 ms. `session.test.ts` checks the
seam with a fake simulation, `talk-stub.test.ts` the frames of an `approach` (one every 10 ticks, each line in the
frame of its tick) and `give-stub.test.ts` the walk of a `give`.

**Shop screen fields (G15).**

- `quoteTrade` adds `quotes` (the shopkeeper quote ids the trade would emit, in order: the evaluation quotes 4, 16–20,
  27, 31 and the transaction quotes 10, 22, 23; the client plays the evaluation quotes when an item is offered, as
  `EvaluateItemAddedToPlayersOfferArea` does, and leaves the transaction quotes to the `trade` events) and `poa`, the
  12 slots of the player's offer area as `PerformTransaction` would see them: `null` or `{kind: money|sold|part, item,
  count, status, money?, owner, source?: {soldier, slot, index?}, value}`, the `part` entries being what a repairman
  leaves on the table after `SplitComplexObjectIntoSubObjects` (the bullets of a gun, damaged parts he cannot or will
  not take).
- `ShopBoxView.ammo {item, shots}` on gun boxes: dealer guns are sold empty but keep their magazine type
  (`MakeObjectOutOfDealerItems`), which the description box shows.
- `ShopView.repaired [{item, status, owner, soldier}]`: the repairs collected on this visit (`RepairIsDone`), which the
  original shows in the player's offer area as "REPAIRED"; ja2-node has already delivered them to `soldier` (the
  owner, else the pricing merc; `null`: dropped at the feet), so the list is presentation for the whole shop session.
- `setShopPricing {soldier}`: the single merc panel's previous and next buttons and SPACE inside the shop change
  `gpSMCurrentMerc`, whose weapon sale modifier prices every box and offered item; the command changes the pricing merc
  without a trade (any living merc of the current squad, as `trade {soldier}`), `data.shop` is the new view. Refusals
  `shopNotOpen`, `noSuchPricingMerc`. Only shop commands are accepted while a shop is open, so the money commands below
  are refused there (deviation "Shop as commands").

**Money** (`SMInvMoneyButtonCallback`, `RemoveMoney`, `ConfirmationToDepositMoneyToPlayersAccount`). The original moves
money through the item cursor; the commands do the click and the drop at once.

| Command | Original | Rules |
|---|---|---|
| `withdrawCash {soldier, amount}` | the money region with an empty cursor opens the money box over the balance; Done puts the money into the cursor and books `TRANSFER_FUNDS_TO_MERC` | campaign, tactical; `amount` a positive whole number ≤ the balance and ≤ `MAX_MONEY_PER_SLOT` (20000, the box's limit for withdrawals); the money tops up the first money pocket below its limit, the rest is auto-placed (`SKITryToAddInvToMercsInventory`), nothing changes when it does not fit (`noRoom`). Events `moneyChanged`, `cashWithdrawn {soldier, amount}`; `data {amount, balance}` |
| `depositCash {soldier, slot, amount?}` | the money region with money in the cursor asks, Yes books `MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT` | campaign, tactical; the pocket's money or `amount` of it; events `moneyChanged`, `cashDeposited {soldier, amount}` |
| `splitMoney {soldier, slot, amount, to, toSoldier?}` | the money box on a money pocket ($1000, $100, $10, Done) puts the split into the cursor; the drop places it | tactical (also the sandbox); `amount` ≤ the pocket (the whole amount moves the pocket) into an empty pocket or a money pocket with room (`fillMoneySlot`), of the merc or of a merc in passing range with `moveItem`'s rules and AP (2 each in combat); event `moneySplit {soldier, slot, to, toSoldier?, amount}` |

Refusals in `data.refusal` (reason `<token>: text`): `notInTactical`, `noSuchSoldier`, `noInventory` (escorts and
non-merc bodies have no single merc panel), `badSlot`, `emptySlot`, `notMoney`, `badAmount`, `notEnoughMoney`,
`noRoom`, `sameSlot`, `doesNotFit`, the transfer refusals of `moveItem` and the tactical turn refusals (`notYourTurn`,
`uiLocked`, …). Giving money to another soldier stays `give {money}` (§6.16), money offered to a dealer `trade {cash}`.

### 6.29. Orders of the player interface (M8, U6)

The tactical orders the original's buttons, keys and cursors give besides `move`, `attack`, `door` and the inventory
(`28` §12.4), from `src/sim/tactical/player-orders.ts`, `combat/spread-burst.ts` and `stack-cleanup.ts`. Each is refused
like every tactical order while our side cannot act (`noSuchSoldier`, `cannotAct`, `notYourTurn`, `uiLocked`,
`attackResolving`, `orderQueued`, `mercUnavailable`, `mercActing`).

| Command | What it does | Refusals |
|---|---|---|
| `stealth {soldiers, on?, squad?}` | stealth mode for each listed merc (`bStealthMode`: one more AP per tile, quieter steps and noise); without `on` each one toggles (the SM button and `z`), with `on` all are set (ALT+Z computes it like the original: on unless one of the squad already sneaks); the robot is skipped. Events `stealthChanged {soldier, on}` or, with `squad`, one `squadStealthChanged {soldiers, on}`, logged with the original's lines | `badSoldiers`, `badValue` |
| `mute {soldier, on?}` | `SOLDIER_MUTE`: the merc's battle sounds stay silent (a presentation flag the server keeps so speech and sound agree, `muted` in the view); event `muteChanged`, logged | `noSuchSoldier` |
| `weaponMode {soldier, mode?}` | `ChangeWeaponMode`: single → burst (burst-capable gun) → launcher (a loaded under-barrel grenade launcher) → single; `mode` sets one directly. `attack` without `burst` fires in the merc's mode (`EnsureConsistentWeaponMode` first); `burst: true\|false` still sets it. In launcher mode `attack` fires the attached launcher (`HandleItem` with `UNDER_GLAUNCHER`, the trajectory branch) | `noBurst` (the original's "not burst capable" line), `noLauncher`, `badMode`, `firing` |
| `attack {…, spread: [gridNo…]}` | a spread burst: up to 50 distinct tiles in drag order (`AccumulateBurstLocation`), the shots of the burst spread over them with `PickBurstLocations`' float step; burst mode only. A refused attack clears the spread | `badSpread`, `noBurst` |
| `stance {soldier, stance}` | `UIHandleSoldierStanceChange` and the `r` key. The view's own soldiers carry `stance` (run, stand, crouch, prone): the height of the animation joined with the run, so a `move` without a mode runs, walks, swats or crawls (deviation "Stance"). `run` makes a standing merc run for no APs and keeps `continueTo` (`usUIMovementMode = RUNNING`, `fUIMovementFast`); a crouched or prone merc stands up first and runs once the stance change ends, since the end of every stance change of our mercs sets the mode by the new stance and keeps a run while he stands (`Soldier_Ani.cc` code 499). `stand`, `crouch` and `prone` set the mode by the stance and clear the run flag; in combat they pay the stance change and clear `continueTo` also when the merc already has that stance (0 APs: `s` ends a halted run); in real time a moving merc changes his gait on the way (`ChangeSoldierState` to the stance's movement). In real time `run` holds for the next move only, as `fUIMovementFast` does | `badStance`, `cannotRun` (robot, vehicle, in water), `notEnoughAP` |
| `move {…, reverse: true}` | `bReverse`: walks backwards facing the way he faced, `AP_REVERSE_MODIFIER` per tile (also counted by the first-step check) | as `move` |
| `moveGroup {soldiers, to, mode?, reverse?}` | real time only (combat clears the multi-selection, `EnterCombatMode`): every listed merc gets a path with `PATH_THROUGH_PEOPLE`; `mode` `stance` (default: walk, swat or crawl by stance), `fast` (standing mercs run: the selected merc's double click) or `run` (everyone runs: the all-move's right double click); an uncontrolled robot is skipped; `data {moved, noPath}`, `noPathForMerc {soldier, to}` logs the original's line | `realTimeOnly`, `badDestination`, `badMode`, `badSoldiers` |
| `swapPlaces {soldier, with, cursor?}` | the `x` key: both conscious, the other reachable within one tile (`CanSoldierReachGridNoInGivenTileLimit`), not hostile, `CanExchangePlaces` (APs of both, not moving, valid stances, friendly or a willing neutral); `SwapMercPositions` (both re-inserted at their old tiles when a tile is not free), `AP_EXCHANGE_PLACES` from both. `cursor: true` is the exchange cursor's free swap (`ValidQuickExchangePosition`: an adjacent neutral or friendly militiaman in sight with a one-step path). Event `placesSwapped` | `noSuchTarget`, `notAdjacent`, `hostileTarget`, `invalidExchange`, `cannotExchange` |
| `jump {soldier, to}` | `UIHandleJumpOver`: over a prone soldier on the side tile between (`IsValidJumpLocation`), after turning; `JUMP_OVER_BLOCKING_PERSON` charges `AP_JUMP_OVER` and walks the two tiles (its path is now set when the animation starts, as `EVENT_InitNewSoldierAnim` does); needs `GetAPsToJumpOver` | `invalidJump`, `notEnoughAP`, `mustStopFirst` |
| `jump {soldier}` | the climb button's fence jump (`FindFenceJumpDirection`, `BeginSoldierClimbFence`, `HOPFENCE`); needs `GetAPsToJumpFence` | `noFence`, `notEnoughAP` |
| `climbWindow {soldier}` | Stracciatella's SHIFT+J (`HandleTBClimbWindow`): through the open window the merc faces (`IsFacingClimableWindow`), `AP_JUMPFENCE`/`BP_JUMPFENCE`, then `TeleportSoldier` to the next tile (no animation in Stracciatella either) | `noWindow`, `notEnoughAP` |
| `combineStack {soldier, slot, from?, index?}` | CTRL+click (`CleanUpStack`): ammo, kits and medkits only; the points of the `from` stack (or its object at `index`), when it holds the same item, are poured into the slot's lower objects, then the slot's own upper objects into its lower ones; emptied objects leave the stack; free; `data.combined` false for other items | `badSlot`, `emptySlot`, `sameSlot`, `badIndex` |
| `door {…, action: 'openManually'}` | the door menu's open button: `InteractWithClosedDoor(HANDLE_DOOR_OPEN)` on a locked door after the start-of-menu trap check; the merc finds it locked (no AP, as the original) unless a trap goes off. The door menu (`options`, `previewAction` and the `doorMenu` event) lists it first | as the menu actions |
| `door {…, action: 'closeManually'}` | the closing menu's close button (vanilla `BtnDoorMenuCallback` with `fClosingDoor`): the close door animation at once, no trap check; refused with `alreadyClosed` on a closed door | `alreadyClosed`, `notEnoughAp`, `noPath` |
| `leaveVehicle {soldier, squad?}` | accepted in the tactical flow as on the map screen (§6.13); the team panel's second hand slot of a passenger sends it | §6.13 |

Every refusal the original reports with `MSG_UI_FEEDBACK` (`notEnoughAP`, `noPath`, `mercUnavailable`, `noBurst`,
`noRoomToFire`, …) now enters the message log as a `uiFeedback` entry (colour `FONT_MCOLOR_LTYELLOW`), so the client opens
the feedback box as the original does (§6.25).

### 6.30. The map screen (M8, U8)

What the original's map screen prints and does that the view and the commands lacked (`28` §7, §12.1 G9–G13). The
values come from the simulation's own functions; nothing is shown that the original screen does not show (D16).

**Clock** (`src/server/map-screen-view.ts`): `mode` (`giTimeCompressMode`: 0 stopped, 1 normal, 2/3/4 = 5/30/60 minutes
per second), `paused` (`gfGamePaused`, the automatic pause included), `playerPaused`, `pauseLocked`, `canCompress` and
`compressRefusal`: `AllowedToTimeCompress` on the simulation's state as the map screen asks it, with the token
`TellPlayerWhyHeCantCompressTime` picks (`noMercsHired`, `meanwhileStarting`, `noUsableMercs`, `inCombat`,
`enemiesPresent`, `creatureMine`, `bloodcatAmbush`, `contractRenewal`, `pauseLocked`). The client's own reasons (an open
menu, plotting, a held item, the sector inventory) stay in the client.

**Mercs**: `idle` (`fDoneAssignmentAndNothingToDoFlag`), `trainStat` while training, `repairVehicle` or `repairRobot`
while repairing (items otherwise), `canChangeSleep` (`CanChangeSleepStatusForSoldier`), `salary` (`DrawCharacterInfo`'s
daily cost: by `bTypeOfLastContract` for A.I.M. mercs, `sSalary` otherwise), `bleeding`, `collapsed`, `armour`
(`ArmourPercent`) and `camo` (the merc inventory panel). A.I.M. contracts add `minutesLeft` (the departure column's
minutes: to `iEndofContractTime`, capped at the contract length in transit) and `endMinutes` (`iEndofContractTime`,
the contract sort key); M.E.R.C. contracts `contractLength` (`iMercMercContractLength`; `daysHired` is the world day
minus the start day). Vehicles are not characters in
ja2-node (no vehicle soldier), so their condition and fuel are not shown; a vehicle moves through a passenger's
`route`.

**Sectors and the economy**: sectors add `items` (`uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer`, now kept for
underground sectors too), `militiaTraining` (`ubMilitiaTrainingPercentDone`, where the town box prints it),
`enemiesKnown` (the player knows what is there: the town box's "0" against "Unknown") and `facilities` (the facility
flags of town sectors, which change when Tixa's prison or the gun range is found); `playerControlled` is shown for
town sectors and found SAM sectors as the town box does (`AddCommonInfoToBox`), and those sectors are listed.
`townControl [{town, control}]` (`GetTownSectorsUnderControl × 100 / GetTownSectorSize`), `mines [{mine, sector, town,
status, ore, playerControls, predictedDailyIncome, maxDailyRemoval, maxPeriodicRemoval}]` (status in the town box's
order: abandoned, shut down, running out, producing), `projectedDailyIncome` (`GetProjectedTotalDailyIncome`),
`secretsFound` (the sectors of found secrets, `IsSecretFoundAt`) and `underground [{sector, items}]` (visited levels
below ground). Groups and vehicles add `traverseMinutes`; the helicopter adds `progress`, the float ratio
`DisplayPositionOfHelicopter` places its icon by (0 when it is not moving).

**Commands** (refusals with tokens; `refusal.<token>` names the original's message where the original shows one):

| Command | Original | Rules |
|---|---|---|
| `route {soldier, to, via?, shortest?, extend?}` | `PlotPathForCharacter` per leg, `RebuildWayPointsForGroupPath` | Each leg from the last sector of the path so far; `shortest` is the Shift mode of `FindStratPath`; `extend` appends to the current path like the map screen's plotting, otherwise the path is replaced (cancel, then plot). `badSector` for a leg the cursor cannot plot to, `noRoute` for an unreachable one. `data.path` is now a list of sector names. `previewRoute` takes the same `extend` (the map screen always plots with it) |
| `shortenRoute {soldier, at}` | `ClearPathAfterThisSectorForCharacter` | Keeps the path to the last time it passes `at` and rebuilds the waypoints; `at` the merc's sector cancels it; `noRoute` when the path does not get shorter; `data.edit` `shortened` or `cleared` |
| `routeGroup {soldiers, squads?, vehicles?, to, via?, shortest?}` | the move box: `SetUpMovingListsForSector`, `HandleMoveoutOfSectorMovementTroops`, `HandleSettingTheSelectedListOfMercs`, `CopyPathToAllSelectedCharacters` | The listed mercs of one sector move; `squads` and `vehicles` are the box's unit lines (default: units whose movable members are all listed). Mercs parting from their unit join a squad of the sector doing the same (`FindSquadThatSoldierCanJoin`) or a new one, a failed join toggles the merc as the original does. The first moving merc plots, the mercs who cannot travel with him are left out (`DeselectSelectedListMercsWhoCantMoveWithThisGuy`), the others get his path. The regrouping happens on this command (the original regroups when Done is pressed). Refusals `badSoldiers`, `notInOneSector`, `notInMoveList`, `nothingSelected`, `reassignOnTheMove` (a merc on the road would change his unit: `pMapErrorString[41]`) and the movement refusals |
| `heliPlot` | `RequestGiveSkyriderNewDestination` | The click on the helicopter that starts plotting: Skyrider says hi and `FACT_SKYRIDER_USED_IN_MAPSCREEN` is set, or the refusal says why he cannot fly (`ExplainWhySkyriderCantFly`); `emptyHelicopterHint` (`pSkyriderText[2]`) once while the helicopter is empty and mercs stand in its sector (`gfSkyriderEmptyHelpGiven`, saved) |
| `heliRoute {to, via?, extend?, plotted?}`, `shortenHeliRoute {at}` | `PlotPathForHelicopter`, `ClearPathAfterThisSectorForHelicopter` | As `route` and `shortenRoute` for the helicopter; without `plotted` it asks Skyrider first like `heliPlot`, with `plotted` (the map screen after `heliPlot`) it only checks that he can fly; `previewHeliRoute` takes `extend`; `shortenRoute` for a merc aboard shortens the helicopter's path |
| `moveMilitia {from, to, rank, count}` | `PickUpATownPersonFromSector`, `DropAPersonInASector`, `HandleMilitiaRedistributionClick` | One town (found, training allowed, no fight in its militia map: `militiaInCombat`), both sectors ours and free of hostiles, at most 20 per sector, all or nothing; a change in the loaded sector re-places its militia on the next tactical entry (`gfStrategicMilitiaChangesMade`). Refusals `notATown`, `samSite`, `noMilitiaAllowed`, `militiaInCombat`, `otherTown`, `sectorNotPeaceful`, `notEnoughMilitia`, `sectorFull`, `badRank`, `badCount` |
| `distributeMilitia {town}` | `HandleEveningOutOfTroopsAmongstSectors`, `CanMilitiaAutoDistribute` | Each rank summed over the town's sectors in the militia map that are not enemy controlled (with hostiles included), divided by the sectors under control and dealt to the town's sectors without hostiles, leftovers one per rank up to 20; militia counted in a sector with hostiles are lost (quirk kept, `18` §1.8). Refusals `badTown`, `notATown`, `noMilitiaAllowed`, `militiaInCombat`, `noMilitia` |
| `discardItem {soldier, slot, count?, index?}` | `TrashCanBtnCallback` | The map screen's trash can for an accessible inventory (the map-screen `moveItem` refusals, `nailsVest`); event `itemDiscarded {soldier, item, count}`; `mapScreenOnly` elsewhere. The mission-item warning (`ubMission`) has no counterpart: the simulation keeps no such flag |

The move box asks the hint `moveBoxOptions {sector}` (surface sectors only): `{soldiers: [{soldier, listed, refusal?}]}`
for every living merc of the sector outside transit and captivity, `listed` for the mercs the box lists
(`SetUpMovingListsForSector`) and `refusal` from `CanCharacterMoveInStrategic`, so the client also knows why a squad
mate the box does not list keeps the squad from moving. It previews the group's route with `previewRoute {…, alone:
true}`, which checks only the first mover instead of his whole group (the server regroups before it plots).

`groupArrived` (§6.25) is emitted for every player group, vehicles and the helicopter included. The refusal table
moved to `src/protocol/refusals.ts`, so the client prints the original strings without the server.

### 6.31. Battle entry (M8, U9)

What the pre-battle interface and the autoresolve screen print and do that the prompts, the view and the events lacked
(`28` §8.1, §8.2, §12.1 G16; `19` §5). Nothing is shown that the original panels do not show (D16).

**`showBattle {}`**: the non-persistent pre-battle interface ("BATTLE IN PROGRESS"), opened where the original calls
`InitPreBattleInterface(0, false)`: a click on the battle sector while the battle locator is on, or an attempt to
compress time during a tactical battle (`INCOMBAT` or `fEnemyInSector`). Accepted on the map screen (flow `strategic`)
with a loaded sector when the locator is on or a battle runs there; `calculateNonPersistentPbiInfo` then
`initPreBattleInterface(…, false)` (the wake-up and the other side effects of the original) and a `preBattle` prompt
with `persistent: false` and the options of `19` §1.4 plus `close` (`data.prompt` names it). Refusals `noBattle`
(nothing to summarise, or another flow) and `onlyHostileCivilians` (`OnlyHostileCivsInSector` during a battle:
`gzLateLocalizedString[STR_LATE_27]` with `data.sector`), and the open-prompt refusal. Answers: `close` (Esc: the prompt
goes and `gpBattleGroup` is cleared, `HandleKeyESC`), `enterSector` (back into the loaded sector, `GoToSectorCallback`
without the placement), `autoresolve` (`EnterAutoResolveMode`; the explicit codes that forbid it are refused). The
agent command `autoresolveBattle` (§5.1 of `19`) stays.

**The `preBattle` prompt** (both kinds) now comes from `src/sim/campaign/pre-battle-panel.ts`, shared with the
automatic start below: `involvedGroups` (more than one group among the involved mercs selects the plural retreat
help), and per uninvolved merc `betweenSectors` (the location in parentheses), `departure` (minutes to the contract
end for A.I.M. mercs and Slay, capped at the contract length in transit; `null` prints "N/A") and `destination` by
`GetMapscreenMercDestinationString`: the arrival sector in transit, the last sector of the merc's path whenever there
is one, else the group's next sector between sectors. The strategic view adds `battleLocator` (the sector of the red
locator, `gfBlitBattleSectorLocator` and `gubPBSector`), present only while it is on.

**Automatic starts** open no prompt (`19` §5.1); their `preBattle {autoStart: true}` event now carries `panel {sector,
enemies, militia, involved, uninvolved, involvedGroups}`, computed before the battle starts, so the client can show
the panel with Autoresolve pressed as `ActivateAutomaticAutoResolveStart` does.

**Autoresolve view and events**: `observe.autoresolve` adds `encounter` (the code at entry: the screen's header);
merc cells add `profile` (the face); militia and enemy cells add `female` (the female generic faces of
`CreateAutoResolveInterface` and `MakeEnemyTroops`). `arAttack` adds `weapon` (the item that fired a shot) and
`reloaded` (the shot followed an `AutoReload`: the lock'n'load sound); `arHit` adds `melee` (a hand-to-hand hit, whose
death plays no splat or death cry); `arDied` adds `splat` (a bullet took the target below -60 life, not a creature: the
client picks `BODY_SPLAT_1` or `HEADSPLAT_1`). The `autoresolveDone` prompt adds `bandageRefusal` (`nobodyWounded`,
`noDoctor`, `noKit` or `null`: `DetermineBandageButtonState`'s order and fast help); `answer bandage` returns
`data.bandaged` `complete` or `incomplete` (the `STR_LATE_13` or `STR_LATE_10` box) and is refused with
`data.refusal` when nobody can bandage. None of these fields draws a number.

**Playback.** The client paces the battle with the driver: Play is `realtime` at the time modifier of big battles
(`ubTimeModifierPercentage`, 1 slice per second up to 12 soldiers a side), Fast `realtime` at speed 4, Finish one
`advance {idle}` to the end or the next prompt, Pause `manual`; it spreads the events of each 1000 ms slice over the
slice's real time. Retreat orders still apply between slices (`19` §2.11).

### 6.32. Laptop II (M8, U11)

What Bobby Ray's, M.E.R.C. and I.M.P. pages print and decide that the laptop view and commands lacked (`28` §9.5–§9.7,
gaps X6, X11, X12 and X15 of §9.9). Each field is something the original page shows or checks (D16); `21` §10 lists them
with the commands.

**M.E.R.C.** (`src/sim/campaign/laptop/merc-site.ts`). Speck's lines come in the replies as quote ids, in the order the
original queues them for the video window: `mercOpenAccount` answers `{accountNumber, quotes: [9]}`
(`BtnOpenAccountBoxButtonCallback`); `mercHire` adds `quotes`, the cross-sell quotes of the hired merc's listing for
related mercs still available (`MercFilesHireMerc` through `ShouldSpeckSayAQuote`'s cross-sell list) followed by quote 69
or 70, picked with `CoinToss` on the main stream at the hire (the toss was not drawn before; deviation "Speck's
opening"); the refusal `accountSuspended` carries `data.quotes: [14]` and `unavailable` for a living merc `[71]`;
`mercPay` answers `{paid, full, quotes}` with 45 for a full and 46 for a partial payment
(`MercAuthorizePaymentMessageBoxCallBack`). The view adds per listed merc `advertiseQuote` (the listing's ADVERTISE
quote, what Speck says to advertise the merc) and `married` (Flo after `FACT_PC_MARRYING_DARYL_IS_FLO`, the files page's
overlay), the account page's rows `account [{profile, name, days, rate, charge, dead}]` (`DisplayHiredMercs`: the mercs
on the team or still owed money) and `slowLoad` (the long first load while the site has not yet gone down,
`DisplayLoadPending`).

**I.M.P.** (`src/sim/campaign/laptop/imp.ts`). The draft of a character stays in the client until `impCreate`; the
server gives the rules the pages check. The query `impCheckCode {code}` answers `{result: ok | badCode | noSlot}` as the
home page's `ProcessPlayerInputActivationString` decides (the code first, then `CanCreateAnotherIMPCharacter`). The view
adds `canCreate`, `beginRefusal` (`funds` before `teamFull`, the order of `BtnIMPMainPageBeginCallback`), `attributes
{start, min, max, bonus, zeroBonus, order, zeroable}` (the attribute page's budget from the game policy, the value order of
`RenderAttributeBoxes` and the four skills that may drop to zero), `portraits` and `voices` (the faces and profiles of each
gender, in the order the portrait and voice pages step through them) and `quizAnswers` (the answer count of each question,
which also places the question texts in `imptext.edt`).

**Bobby Ray's** (`src/sim/campaign/laptop/bobby-ray.ts`). `bobbyRayQuote` is the order form's quote: `destination` may be
left out (or -1), shipping is then 0 as on the form before a city is chosen, and the answer adds `unitPrice` per line,
`affordable` and `confirmDestination` (the yes/no question the accept button of `BobbyRMailOrder.cc` asks for every
city but the primary airport, and for that airport while the enemy holds its sector); `bobbyRayOrder` without a destination is refused with `noDestination`. Stock rows add
`slot` and `catalogue` (`guns`, `ammo`, `armour`, `misc`, `used`: the catalogue page that lists the item). Shipments list
every order with `displayed` (the shipments page's rows), `units`, `weight`, `subtotal`, `shipping` (from the stored package
weight and the speed, `DisplayShippingCosts`), `total` and lines with `quality` and `unitPrice`; a shipment not displayed
carries no lines.

**Items.** `CatalogueWeapon.rateOfFire` (the catalogue's ROF column) joins the static item catalogue (X15).

### 6.33. Laptop III (M8, U12)

What Personnel, History, Files, the insurance contract page and the florist need from the server (`28` §9.3, §9.8,
§9.9 X7, X9, X10, X13, X14; `21` §6.2, §6.4, §7). As everywhere in the laptop view, nothing is shown that the original
page does not show (D16).

**History rows** (`src/server/history-labels.ts`): every row adds `text` (`ProcessHistoryTransactionString` in the
session's display language: `pHistoryStrings` with the town's locative name, the profile's full name or nickname by code;
the quest rows are rows 2q and 2q + 1 of `binarydata/quests.edt`, preloaded with the narrative texts; codes without text,
and a merc killed without a profile, give an empty string), `location` (`pHistoryLocations` for a row without a sector,
otherwise the detailed `GetSectorIDString`) and `questInProgress` (a quest-start row whose quest is in progress; the page
paints it, and the cheat row, red). The detailed sector label (`src/server/sector-id-label.ts`) is now the original's
in full: the mine's town and "Mine", secrets and SAM sites, the special facilities, the town, the creature lair
underground and the traversability's land type, nothing for an unvisited underground sector; the finance rows' militia
label (§6.9) uses it too.

**Files**: `readFile {code}` sets the saved read flag of a file of the files program (`DisplayFormattedText` sets `fRead`
whenever a file is shown) and answers `{code}`; refusal `noSuchFile`. Reading has no other effect.

**Personnel** (`src/server/personnel-view.ts`): `personnel` keeps the three departed lists and adds `current`, one block
per team member without vehicles in team order, dead ones included (`CFOR_EACH_PERSONNEL`): `soldier`, `profile`, `name`
and `fullName`, `alive`, `robot`, `assignment`, `town` (the town of the merc's sector, 0 while a prisoner or in transit),
`life`, `lifeMax`, the profile's `stats` and `gains` (the deltas the page prints), `teamStats` (the soldier's eleven values
in the order of the team statistics: `Attribute(…, true)`), `record {kills, assists, shotsFired, shotsHit, battlesFought,
timesWounded}`, `skills`, `money` (the money items carried), `inventory [{item, count, status, shots}]` (the slots in
order, `shots` the rounds of a magazine stack) and `employment` (`aim` for A.I.M. mercs and Slay: `minutesLeft` capped at
the contract length in transit, `totalDays`; `merc`: `unpaid`; `other`; all with `daysServed`, `totalCost`, the
`dailyCost` by the last contract and, but for `merc`, `medicalDeposit`), and `departed` in the page's order (dead, fired,
the other list) with the state (`dead`, `fired`, `married` to Hicks, `contractExpired` for an A.I.M. merc, `quit`), the
names, the profile's life, stats and team row and the record. Profiles now count `battlesFought` (`usBattlesFought`):
every merc of an autoresolve battle when it closes, dead, captured or not, and every merc in the sector when a tactical
battle with enemies, creatures or civilians in it is won (not in a boxing match); native saves import the counter and
snapshot version 6 adds it with 0 to older snapshots. Snapshot version 7 adds `turnsUntilCanSayHeardNoise` (`ubTurnsUntilCanSayHeardNoise`, the pause before a merc says
again that he heard something) with 0 to older snapshots. Snapshot version 8 adds `pummeledQuoteSaid` and `closeCallQuoteSaid`
(`SOLDIER_QUOTE_SAID_BEING_PUMMELED`, `SOLDIER_QUOTE_SAID_EXT_CLOSE_CALL`: the heavy-fire or beating quote and the close
call quote said this turn) with false to older snapshots. Snapshot version 9 puts out every `muzzleFlash` of older
snapshots: they never ended a flash in turn-based combat, and the flag now counts in `DistanceVisible`. Snapshot version 10
adds the blood graphics of the smell map: no pool shown yet and every tile with blood waiting to be seen.

**Insurance cards**: the offers add `nickname`, `dead` (`IsMercDead`) and `contractLength` (`iTotalContractLength`); the
view adds `aimMercsOnTeam` (which of the two "nobody to insure" texts the contract page shows). The card's face is the
profile's small portrait from the profile endpoint (§6.25).

**Florist**: the bouquet price is the price column of `binarydata/flowerdesc.edt` read with `sscanf("%hu")` at content
load (`LaptopContent.bouquetPrices`, `florist.bouquetPrices` in the view) and `orderFlowers` now charges it with the extras
and the delivery cost (no balance check, as the original). `visitSite {site: floristOrderForm}` is entering the order form:
it adds `Random(5) + 1` to the saved order number (`uiFlowerOrderNumber`) on the main stream and answers `{site, bookmarks,
orderNumber}`; `orderFlowers` answers `{price, orderNumber}` and then adds `1 + Random(2)`, after the charge and the Meduna
meanwhile, as `BtnFlowerOrderSendButtonCallback` does. The view shows `florist.orderNumber`. An agent that orders without
entering the form skips the first draw, which a player cannot do. The content identity hashes text files by their
presence, so a data folder whose gallery text carries other prices is not told apart from the one a save was made with.

| Command | Original | Rules |
|---|---|---|
| `readFile {code}` | `DisplayFormattedText` | Marks the file read; `noSuchFile` |
| `visitSite {site: floristOrderForm}` | `EnterFloristOrderForm` | One main-stream draw; `data.orderNumber` |
| `orderFlowers {bouquet, destination, nextDay, extras}` | `DisplayFlowerDynamicItems`, `BtnFlowerOrderSendButtonCallback` | The bouquet price joins the charge; one main-stream draw after it; `data {price, orderNumber}` |

### 6.34. Story and help (M8, U13)

What the game page's meanwhile box, ending and help screens needed from the server (`28` §4.7, §10); the story itself
is `26` §2 and §7 and unchanged.

**The campaign identity.** The original keeps the help screens' seen mask in the savegame
(`SaveLoadGame.cc:1916`); the game page keeps it in the browser per campaign, so a session names its campaign. The
welcome carries `campaign` for a campaign session: a random identity made when the campaign is created
(`newSession {campaign}`, `POST /api/sessions {campaign}`), `import:<16 hex digits of the file's digest>` for a native
import, none for a sandbox. The session writes it into the save's `presentation.campaign` and a load restores it, in a
new session or in place (the fresh `welcome` then names the loaded campaign); a save written before U13 gets
`save:<16 hex digits of the save's digest>`, so every later save of that line keeps it. It is presentation: the
snapshot, the input log, the replay and the logic hash do not see it (`src/server/campaign-id.ts`).

**The strategic view** says `gameJustStarted: true` while `fDidGameJustStart` is set (from the new campaign to the
first arrival of a hired merc), which picks the map screen's "not in Arulco yet" help (`HelpScreenDetermineWhichMapScreenHelpToShow`).

**Music of the interrogation.** `StartMeanwhile` sets the menu music before the scene's sector loads and the load's
sector entry rule follows (`StrategicMap.cc` `SetCurrentWorldSector`); the session now applies both at
`meanwhileStarted` (`TACTICAL_NOTHING` in N7, whatever the order the step's events come in), and `meanwhileEnded` of the
interrogation still sets `TACTICAL_ENEMYPRESENT` (`EndMeanwhile`).

No command, prompt or refusal changes: the meanwhile box and the ending are presentation of the existing events
(`meanwhile`, `meanwhileStarted`, `squadMovedUpstairs`, `campaignWon`), and the help screens read the view.

### 6.35. Stub art and e2e (M8, U14)

What the e2e suite of `28` §15 needed from the server and the game page; no rule and no command changed.

**The answer's tick.** A session sends a frame only when the player's view changed, so after an advance that ends on
frameless steps (an idle stop, a turn-based round waiting for input, a manual driver) the client's latest view keeps
the tick of the last frame while the simulation's tick has moved on. The shadow mode (§6.26) counted every comparison
made then as stale, so in combat and on a held map screen almost nothing was compared. `Session.query` now answers with
the tick of the view its viewers hold (the last frame sent, or the welcome) whenever the current view equals the last
view it captured for them (`diffPlayerView` finds nothing), and with the current tick otherwise: the answer is computed
on the current view either way, and equal views give equal answers. Without viewers, or after a change not yet captured
into a frame, nothing changes. `session.test.ts` covers the three cases.

**Answers over the view the viewers hold (2026-10-26).** A tick does not name a view: while time stands (a pre-battle
prompt, a conversation, a decision) commands change the view without a step, so several frames can share a tick, and
an answer tagged with that tick could describe another of them (the shadow mode reported `decisionPending` against a
prompt the client had not yet received). The session now keeps `sentView`, the welcome with every published frame
applied (`applyViewFrame`, the client's own function), and while it has viewers it answers every query over that view
rather than the simulation's current one; the welcome of a later viewer is `sentView` too. Frames and answers reach a
client over one ordered socket, and the client applies a frame to its latest view on receipt, so when an answer arrives
the client holds exactly the view it was computed on. The shadow mode therefore compares a reply with the local answer
on the latest view at the moment the reply arrives (recomputed when the view changed since it asked), and a server
answer used while the local knowledge is not ready is cached under that view. An answer can thus be at most one capture
(50 ms) behind the simulation; queries without viewers (MCP-only sessions) keep the current view. The answer's `tick` is
the held view's, for information. `session.test.ts` checks that an answer equals the view rebuilt from the messages
before it, also after a change not yet framed and for two commands at one tick, and that a later viewer is welcomed with
the same view.

**Test switches of the game page** (URL parameters, like `pinClock`): `holdTime=1` keeps the map screen from starting
game time by itself (`SessionMapClient` never drives; explicit `advance` still works), so a map golden does not depend on
how long the page took to open. The `__ja2Ui` hook gains `frameStats` (`count`, `p50`, `p95`, `max` of the page's own
JavaScript time per frame, `resetFrameStats()`), `lagTicks` (the latest received tick minus the shown tick) with
`skipPlayback()` (show the latest view at once), and `lastCommand`/`lastResult` (the type of the session's last command and
its `{ok, reason, refusal}`).

## 7. Cost and limitations

- **Amount of work.**
  - Added: the protocol, the session server, the visibility projection, a log player in the client and
    an MCP adapter. By a rough estimate this is +10–15% on top of tactics and strategy.
  - In return we get for free: headless tests through the same API, automated playtesting by an agent,
    replays and debugging.
- **Discipline.**
  - In the original, a lot of logic lives right in the screens: hiring on the laptop, trading, drag-and-drop
    inventory, map assignments, dialogues. All of it has to be lifted into commands and decision
    prompts.
  - The work is the same as before, but now there is no "cutting corners" at the boundary.
- **Real time over the network.** On localhost the input latency is ~50–100 ms (the playback buffer), which is
  unnoticeable for JA2. Playing from a remote server is possible, but it is not a goal.
- **License.**
  - A server for yourself, on your own machine or at home: allowed.
  - A public server with the original data is distribution of commercial assets: not allowed.
  - A public server on stubs: allowed non-commercially, with the SFI-SCLA text.
- **Non-goals:**
  - real-time control by an LLM agent without pausing;
  - bit-exact replay compatibility with the native game.

---

## 8. What changes in the architecture and milestones

The changes have been made in `01-architecture.md` v0.2.
- **Decisions:**
  - D13: the server as the source of truth;
  - D14: time is controlled externally (`advance`, drivers), playback is separated from the simulation;
  - D15: all player actions are commands, modal moments are decision prompts;
  - D16: the player-view projection.
- **Layers:** added `protocol`, `server`, `agent`. The client (`app`, `ui`, `render`, `audio`)
  no longer runs the simulation; it plays back the log.
- **Data:** the server reads the original from `JA2_DATA_DIR`, and the browser gets media via `/vfs`.
  Import into OPFS remains only for embedded mode.
- **Milestones:**
  - in M0 the server with `/vfs` replaces the Vite plugin;
  - M2 brings protocol v0, agent API v0 (MCP: `status`, `observe`, `act move`,
    `advance`) and a browser viewer;
  - M3 brings instant mode, accelerated playback and the agent's battle for Omerta.
