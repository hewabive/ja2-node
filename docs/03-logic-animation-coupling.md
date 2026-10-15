<!-- How JA2 ties gameplay logic to animations and frame timing. 2026-10-15, Stracciatella ae6bf01.
Paths are relative to reference/stracciatella/src/game/. Conclusions are recorded in 01-architecture.md, §3.3–3.5. -->

# How JA2 ties gameplay to animation and frame timing, and where to put the sim/presentation boundary

I read all of this in the stracciatella source and did not build or run anything. **[V]** means I read it in the code; **[I]** means I'm inferring it. Paths are relative to `reference/stracciatella/src/game/`. `vanilla:` means `reference/vanilla/ja2/Build/`. Vanilla has the same opcode set with the same meanings (`vanilla:Tactical/SoldierAni.c:176–2625`) [V].

## 0. The clock model

- **Main loop.** Each rendered frame runs physics, then the strategic turn, then `UpdateBullets`, `ExecuteOverhead`, the UI, the event queue, and finally rendering (`GameScreen.cc:342–345, 424–427, ~471`) [V].
- **Overhead pass.** `ExecuteOverhead` runs at most once every 5 ms (`Utils/Timer_Control.cc:15`). For each soldier whose `UpdateCounter` has expired after `sAniDelay` ms (`Overhead.cc:669`), it:
  - runs `AdjustToNextAnimationFrame`, which executes every opcode up to the next drawn frame (`:687`);
  - runs the tile-step logic (`:717–1000`), then `MoveMerc` (`:1017/1021`), then `TurnSoldier` (`:1029`);
  - then runs `HandleSoldierAI` (`:1032–1053`) [V].
- **Timers are wall-clock and never catch up.** Counters re-arm from "now" (`Timer_Control.cc:155–181`), so each soldier advances at most one frame per pass. A slow machine slows the game rather than skipping frames. Vanilla's multimedia-timer counters behave the same way (`vanilla:Utils/TimerControl.c:31–57`, `TimerControl.h:95–115`) [V].
- **Frame delay (`sAniDelay`).** It comes from `gAnimControl[].sSpeed`, or for stand/walk/run/etc. from breath, life, agility, terrain, body type and drugs. It is halved in combat and doubled for stealth in realtime (`Soldier_Control.cc:4763–4918`). Unseen soldiers in combat get 0, meaning they advance every pass (`:4928–4936`) [V].
- **Movement per frame.** In world units, where a tile is 10: walk 1.6, run 2.6, swat 2.2, crawl 0.8 (`Animation_Control.cc:351–425`). Walking takes about 7 frames per tile [V].

The upshot: in the original, game time is effectively "animation frames played". Gameplay ordering hangs off frame markers, and the wall clock only sets the pace.

## 1. Animation opcodes (`Tactical/Soldier_Ani.cc:93–2547`)

Values below 399 are frame numbers. 500–599 jump within the script, and 600–699 and 800–999 jump to another animation state (`:1939–1963`). Everything that follows is [V].

**(a) Purely visual or audio**
- 431, 438, 439: white flash / forced shade.
- 432, 479, 489, 490, 750, 751: do nothing.
- 441: muzzle-flash light sprite (the visibility *flag* is separate, see §6).
- 451, 452: z-buffer override. 477: camera locate.
- 702–732, 764, 766, 767, 770, 771, 773–791: sounds. One sound case also consumes RNG: 785 calls `Random(5)`.

**(b) Gameplay-affecting**

| Opcode (line) | What it does |
|---|---|
| **430** (313) | **Fire.** Queues `EV_S_FIREWEAPON`, which is dequeued later in the same frame and calls `FireWeapon()` (`Utils/Event_Pump.cc:238–260`). Every gun, melee and launcher resolution starts here. |
| **448** (638) | **Burst controller.** Stops if `bDoBurst > ShotsPerBurst` or ammo is out; rolls `CheckForGunJam` on the first round; on stop calls `ReduceAttackBusyCount` and returns to aim; turns toward the next spread location. 449 (748) ends the burst. |
| 470 (1048) | `OKFireWeapon` jam check. On a jam: skips frames, refunds the reserved bullets (a stracciatella fix, 1061–1073), calls `FreeUpAttacker`. 473 (1134) is the improper fire end. |
| 458, 459 (842, 835) | Switch the attacking hand (two-pistol fire). |
| **460/461** (849) | **Throw release.** `DeductPoints` (the AP for the throw is paid here), then `CreatePhysicalObject`. |
| 468, 469, 485 (995, 1042, 1335) | End of punch (NPC triggers); martial-arts follow-up (`DoNinjaAttack`); steal via `UseHandToHand`. |
| 492 (1515) | **Dodge.** The target is stopped with `EVENT_StopMerc` (AI target also gets `CancelAIAction`) and plays a dodge animation. |
| 755, 761, 752 (2243, 2309, 2219) | Queen swipe damage; blade damage; decapitate corpse. |
| **433** (342) | `CheckForAndHandleSoldierIncompacitated`: collapse or fall when life drops below OKLIFE. |
| **440** (422) | **Death committed:** `CheckForAndHandleSoldierDeath`, which turns the soldier into a corpse, awards kill/assist, removes him as a target and updates visibility (2855–2996). 465 (925) sets life to 0. |
| **497** (1631) | Death-or-unconscious check. Dead: death animation, or direct death handling with gore off. Alive at a hit-finish: `ReleaseSoldiersAttacker`, which lowers the busy count. |
| 447 (587) | Searches for a free fall direction (`OKFallDirection`), rotating each frame. |
| 721, 722 (2122, 2131) | Fall sounds, **plus** `CheckEquipmentForFragileItemDamage`. |
| 754 (2239) | Fall into pit. |
| 403, 404, 411–413, 443, 445, 453, 455, 463 | `MoveMercFacingDirection`: sub-tile moves that can change `sGridNo`. |
| 406, 409, 410, 454, 456, 462, 466 | `SetSoldierHeight`, which also sets `bLevel` (`Soldier_Control.cc:1866–1879`). |
| **408 / 475** (223 / 1150) | **Roof climb commit:** move to the new tile and level, re-enable global sight, `HandleSight(LOOK, RADIO, INTERRUPT)`. |
| **444** (517) | **Fence-hop commit:** set position, then `SetOffBombsInGridNo`. 450 (755) forecasts the landing tile; 464 (900) ends a cliff climb. |
| 402, 446, 471 | Pause movement for one frame / pause-move flag on / off. These change how long a step takes. |
| **493** (1553) | Pick up item; the AP is paid inside (`Handle_Items.cc:1294`). |
| **494, 495** (1571, 1589) | **Open structure or door.** 495 also computes door noise, calls `MakeNoise`, `InitOpplistForDoorOpening`, `AllTeamsLookForAll(TRUE)` (which can trigger interrupts), and `HandleSystemNewAISituation`. |
| 486, 487, 763 (1345, 1351, 2331) | Give item; drop item; drop at a tile plus `NotifySoldiersToLookforItems`. |
| 481–484, 762, 756, 760, 769 | Cut fence; wheelchair; plant bomb; remote detonate; panic bombs; reload robot; get blood from corpse; refuel vehicle. |
| 442, 772 (480, 2415) | End the non-interruptible flag (`fInNonintAnim` / RT variant). 442 also lowers the busy count for `STEAL_ITEM`. |
| 753, 757 (2224, 2269) | Busy count down / up. |
| 480 (1293) | `ReleaseSoldiersAttacker` and clear `fGettingHit`. |
| **499** (1732) | **End-of-animation dispatcher.** Frees an NPC's pending action (`ActionDone`); handles reaching the desired stance; releases the suppression stance change's busy count; `UnSetUIBusy` when the busy count is 0; `HandleSight` with interrupts after a stance change; continues the path after a door; starts the pending animation; continues a move after a stance change. |
| 434–437, 474, 476, 496, 498, 457, 472 | State transitions: blood jump and return, roll-over get-up, wake up, "go to previous animation", conditional pending animation, stand, return to aim after a hit. |
| 491 (1384) | Random idle animation. It uses `Random()` from the **shared** RNG and changes animation state (see §7). |
| 765, 768, 467, 758, 759 | Blood drops; stand up after first aid if no enemies remain; helidrop path; quest triggers. |

## 2. Movement, step by step

**First step.** Entering a moving animation calls `HandleGotoNewGridNo(initialMove=TRUE)` (`Soldier_Control.cc:1248`) [V].

**At the centre of the current tile, before committing to the next one** (`HandleGotoNewGridNo`, `Overhead.cc:1247–1630`) [V]:
- Breath check: at 0, collapse (`:1265–1287`).
- Fence (`:1294–1328`) and door (`:1329–1384`) branches. A door starts the open-door animation and the move resumes from 499.
- AP and breath cost for the step (`:1387–1388`), then `HandleNextTile` checks the tile and reserves it in realtime (`:1391`; `Soldier_Tile.cc:272`).
- Mine sense on the next tile (`:1407`).
- Random hazards on the current tile:
  - Gas: 1 in 5 chance per step to stop and take damage (`:1439`).
  - Marbles (`:1481`); blind running and drunk falls (`:1499–1527`); the Forgetful trait (`:1530`).
- **`DeductPoints(AP, BP)` happens here** (`:1566`), so the step is paid for before the soldier leaves.

**Mid-step, at the tile boundary** [V]: `MoveMerc` → `EVENT_SetSoldierPositionXY` → `SetSoldierGridNo` (`Soldier_Control.cc:6219–6328, 1881–2106`). As soon as the computed tile changes, `sGridNo` is forced to the destination (`:1896`). That one call:
- moves the soldier's collision structure and level node (so bullets now hit him on the new tile);
- auto-closes the door behind him (`:1933`);
- drops smell (`:1958`) and handles water: animation swaps and `WaterDamage` (`:2008–2061`);
- sets `SOLDIER_GASSED` (`:2071`);
- awards the sneaking agility gain (`:2099`);
- recomputes animation speed for the new terrain (`:2105`).

**At the centre of the new tile** (`fPastXDest && fPastYDest`, `Overhead.cc:717` → `HandleAtNewGridNo`, `:1709–1960`) [V]:
- Tiles-moved counters, including the realtime breath counter (`:1744–1757`).
- `CheckForBreathCollapse` (`:1776`).
- **Mines:** `SetOffBombsInGridNo` (`:1783`).
- **Noise:** `MakeNoise(MovementNoise)` (`:1800`) → `OurNoise` → `ResolveInterruptsVs(NOISE)` (`OppList.cc:3403–3419`).
- **Sight**, only if no interrupt happened yet: `HandleSight(LOOK, RADIO, INTERRUPT)` (`:1812`) → `ManLooksForOtherTeams`, `OtherTeamsLookForMan`, `ResolveInterruptsVs(SIGHT)` (`OppList.cc:633–700`).
- On an interrupt: `AdjustNoAPToFinishMove(TRUE)` (`:1820`). Moving animations freeze while that flag is set (`:683–687`).
- Mine detection around the soldier (`:1861`), then `HandleSystemNewAISituation` (`:1863`), then quest and NPC arrival triggers.
- Finally either the final-destination handling (`:746–931`) or `ubPathIndex++` followed by `HandleGotoNewGridNo` for the next tile (`:962`).

**What is evaluated below tile granularity**
- The occupancy switch at the boundary (above) [V].
- Turning, one octant per frame. `TurnSoldier` changes direction by one step (`Soldier_Control.cc:4436–4467`) and runs `HandleSight(LOOK, RADIO)` **without** interrupts plus `HandleSystemNewAISituation` on the next frame (`:4229–4240`). The turning AP is paid once, when the desired direction is set (`:3861–3880`) [V].
- Stopping. `EVENT_StopMerc` snaps the soldier to the centre of his current `sGridNo` (`:7395–7397`). Stopping mid-step therefore snaps him back or forward depending on which side of the boundary he was [V].
- Opcode-driven sub-tile moves (fence, roof, prone shuffles) [V].

**AI re-evaluation.** In combat, AI runs for every soldier on every pass. An AI soldier who sights a new enemy is halted by `HaultSoldierFromSighting` (`Soldier_Control.cc:7271`): in realtime by `EVENT_StopMerc`, in combat by setting "no AP to finish move". The same function cancels a pending turn-to-shoot or throw and refunds the busy count. Movement actions complete when the path is exhausted (`TacticalAI/AIMain.cc:410–500`) [V].

## 3. Attacks

**Gun, single shot** [V]:
1. `HandleItem` checks (does not deduct) APs and sends `SendBeginFireWeaponEvent` (`Handle_Items.cc:339–406`).
2. `EVENT_FireSoldierWeapon` raises the busy count, sets `target = WhoIsThere2(tile)`, sets `bBulletsLeft`, then readies the weapon or turns (`Soldier_Control.cc:2112–2214`). Ready APs are paid on entering `READY_*` (`:1407–1424`); turn APs as in §2.
3. When the turn finishes, the fire animation starts (`:4245–4275`). Opcode 470 checks for a jam, then 430 fires.
4. `UseGun` (`Weapons.cc:574–882`):
   - **APs are deducted at the fire frame** (`:591–623`; `CalcTotalAPsToAttack` is evaluated then).
   - `GetTargetWorldPositions` uses the target's tile **at that moment** and his `ubEndHeight` (`:419–523`; `LOS.cc:1301`).
   - Chance to hit depends on the shooter's current shock, stance and burst index (`Weapons.cc:1979+`).
   - **`PreRandom(100)` is rolled at the fire frame** (`:670`), then ammo is spent and the shot is fired with `FireBulletGivenTarget(sHitBy = chance − roll)` (`:804`). Gunfire noise follows (`:861`); it is deferred while the busy count is above 0 (`OppList.cc:3380–3397`).

The roll does not decide hit or miss. It produces `sHitBy`: a positive value means a straight trace at the target point, a negative one means an angular deviation (`LOS.cc:3045–3133, 3196–3418`).

**Bullet travel** [V]:
- `FireBullet` makes the first `MoveBullet` call immediately (`LOS.cc:3188`). After that, `UpdateBullets` runs once per main-loop frame (`Bullets.cc:187`).
- Each `MoveBullet` call is gated by wall-clock time of at least `bulletSpeed/10` ms (2–3 ms with the data's speeds of 20–30) and advances 1 tile, or 4 when bullets are hidden. The 4-tile mode is stracciatella-only; vanilla always used 1 (`LOS.cc:3155–3184, 3496–3503, 4236`; `vanilla:LOS.c:2961–2978`).
- **On every tile entered, the list of possible hits is rebuilt from what is there now** (`LOS.cc:3550–3760`):
  - Persons on the intended tile are always candidates.
  - Other persons only if visible, standing and beyond `MIN_DIST_FOR_HIT_FRIENDS`, or with a small random chance; monsters' shots hit any non-monster.
  - Suppression points and the "close call" flag accrue as the bullet passes (`:3693–3725`).
  - Collision is tested against the person's **current stance shape**, which comes from the animation surface type (S/C/P), not the exact frame. Falling-from-hit animations deliberately keep the standing shape (`Animation_Data.cc:612–645`).
- The hit location comes from the bullet's height compared with the target's current `ubEndHeight` (`LOS.cc:1900–1950`). Then `BulletImpact` (with a random fluke), `WeaponHit`, and `EVENT_SoldierGotHit`.
- **Damage is applied immediately at impact** (`Soldier_Control.cc:2804`). The hit animation raises the busy count (`:2663`).

**What can change between fire and impact**
- **Turn-based:** only things that are already animating. In a burst, earlier rounds start the target's hit or fall animation, which changes his `ubEndHeight` and therefore the aim height and hit location of later rounds (but not his collision shape); flyback moves him back up to 2 tiles (`Soldier_Control.cc:8417–8458`). Bystanders don't move [V/I].
- **Realtime:** anyone can step into the line and be hit. The target can leave his tile; the trace still goes to the old point [V].
- **Frame-rate effect [I]:** burst cadence is frames × ms, while bullet speed is about one tile per loop. Whether round 1 has landed (and the target begun to fall) before round 2 fires therefore depends on FPS.

**Burst.** Every round gets its own chance to hit and roll at its own 430 frame (`UseGun`), and APs are paid only on the first round (`:597–606`). The burst penalty scales with `bDoBurst − 1`. Bullet completions decrement `bBulletsLeft` (`Bullets.cc:138`); `FreeUpAttacker` does nothing until it reaches 0 (`Overhead.cc:5529–5537`) [V].

**Melee (blade or punch)** [V]: `EVENT_SoldierBeginBladeAttack` raises the busy count and snaps facing with no turn steps (`Soldier_Control.cc:6574`). 492 makes the target dodge, then 430 calls `UseBlade` or `UseHandToHand`. Each of them, at the strike frame:
- deducts APs (`Weapons.cc:909`);
- looks for **whoever is on the target tile at that moment** (`:912`);
- treats a target who hasn't noticed the attacker as a surprise: 100% chance to hit, ×1.5 damage;
- rolls (`:935`) and sends `EV_S_WEAPONHIT` with a **20 ms wall-clock delay** (`:987`; secondary queue at `Event_Pump.cc:116`).

**Thrown grenades and rocks** [V]:
- `HandleItem` raises the busy count and calls **`FireWeapon` at command time** (`Handle_Items.cc:899–911`). So `UseThrown` **rolls at command time**. A miss becomes a random tile within a radius, and the force and angle are fixed then (`Weapons.cc:1275, 1315`; `TileEngine/Physics.cc:1717–1837`). The throw animation starts and the item leaves the hand (`:1318`).
- APs are paid and the object launched only at 460/461.
- Physics uses a **fixed time step per 20 ms tick** (`Physics.cc:238–330`), so trajectories are deterministic in tick count. It collides with soldiers, dealing 1 damage and bouncing (`:1858`), handles catching (`:1878–1946`), rolls for duds **at impact** (`:2040`), and lowers the busy count when the object dies (`:435`).
- If an NPC sights something before the release frame, the throw is aborted and the item returned (`Soldier_Control.cc:7280–7306, 8803–8813`).

**Launchers.** Fire with no turning (`:2195`). At the 430 frame `UseLauncher` rolls, pays APs and checks for failure, then creates the physics object immediately (`Weapons.cc:1336–1433`) [V].

## 4. Busy and wait mechanics, and the AI turn

**`ubAttackBusyCount` goes up for** [V]: starting an attack (`Soldier_Control.cc:2125`); a toss (`Handle_Items.cc:906`); a blade or punch attack (6583, 6735); each hit animation (2663); each explosion (`Explosion_Control.cc:113`); each blast hit (726); opcode 757; a suppression stance change (`Overhead.cc:5274`).

**It goes down for:** missed or finished bullets; `ReleaseSoldiersAttacker` (480, 497, death); 448 and 753; the physics object ending; the explosion animation ending (`TileEngine/Tile_Animation.cc:234`).

**What happens when it reaches 0** (`Overhead.cc:5510–5787`) [V]:
- Suppression is applied: APs lost, morale, possibly a stance change (`:5167–5340`).
- Attack consequences: noticing an unseen attacker, entering combat, NPC hostility.
- `FreeUpNPCFromAttacking`, which calls `ActionDone`.
- `CHECK_SIGHT_AT_END_OF_ATTACK`, then the deferred noises are dequeued (`DequeueAllDemandGameEvents`), which is where their interrupts are resolved.
- `CheckForEndOfBattle`.

**While it is above 0:**
- interrupts are impossible (`TeamTurns.cc:928`);
- noise is deferred;
- AI new situations are not processed (`AIMain.cc:288–357`).

**Other gates** [V]:
- `fInNonintAnim` rejects *any* new animation (`Soldier_Control.cc:899–916`). Stracciatella had to patch hits being swallowed by this (`:3254–3262`).
- AI is also blocked by `SOLDIER_ENGAGEDINACTION`, the explosion queue, and "enemy sighted on their turn" (`AIMain.cc:91–99`). The last one is a **3000 ms wall-clock pause** of that enemy's animation (`OppList.cc:2588–2602`, `GameScreen.cc:312–325`).
- `ENGAGED_IN_CONV` stops AI decisions (`AIMain.cc:1150`).
- Watchdogs: a 15 s AI deadlock breaker (`AIMain.cc:366–380, 577`) and a 25 s UI busy breaker that zeroes the busy count (`Handle_UI.cc:405–419`).

**AI turn** [V]: `BeginTeamTurn` runs each soldier's `EVENT_BeginMercTurn`, builds the AI list and calls `StartNPCAI` (`TeamTurns.cc:298–370`). Then, on every overhead pass, `HandleSoldierAI` → `TurnBasedHandleNPCAI` (`AIMain.cc:965–1222`):
- If an action is in progress, wait.
- Otherwise choose one (next action, or `DecideAction`), check `IsActionAffordable`, and call `ExecuteAction`.
- `ActionDone` is triggered by animation or physics completion: path end, busy count reaching 0, opcode 499, end of turning or stance change, roof commit.
- No action means `EndAIGuysTurn`, which moves to the next AI soldier and eventually `EndAITurn` (`:522–575`).

**Interrupts** [V]: `ResolveInterruptsVs` (`TeamTurns.cc:1525–1690`) checks each opponent:
- `bInterruptDuelPts` comes from experience, shock, distance, light, running/swatting/crawling state and watched spots. There is no RNG (`:1139–1320`).
- An automatic win if the interrupter sees the mover and the mover doesn't see him.
- Winners are queued from smallest margin to largest, and `StartInterrupt` takes the **last-queued** soldier, so the biggest margin acts first (`:57–60, 513`).

## 5. Realtime

**Every 5 ms pass** [V]:
- All soldiers animate at their own `sAniDelay`.
- AI: one AI soldier is picked every 50 ms (`RT_DELAY_BETWEEN_AI_HANDLING`, `Overhead.cc:109, 502–513`). More are handled in the same pass **while less than 10 ms of wall clock has elapsed** (`RT_AI_TIMESLICE`, `:110, 1041–1052`), which makes it CPU-speed dependent.
- Each soldier is also limited by `AI_DELAY = 100 ms` (`AIMain.cc:40, 159–165`). Waits are 10–11 s (`AIInternals.h:59`).

**Action points and breath** [V]: action points don't exist in realtime; only breath is spent (`Tactical/Points.cc:462–465, 497–500`). So action rate equals animation duration, and walking speed (from stats, terrain, breath, life and stealth) decides races.

**Realtime "turn"** [V]: every **5000 ms of wall clock** (×compression), `HandleStrategicTurn` calls `HandleTacticalEndTurn` (`Strategic/Strategic_Turns.cc:30–84`; `Tactical/RT_Time_Defines.h:14`; `Tactical/Tactical_Turns.cc:80–160`). That runs bleeding, breath regen (reduced by tiles moved, `Points.cc:660–722`), first aid, bomb timers, smoke and light decay (smoke uses world seconds / 10) and opplist decay.

**Entering combat** [V]: `HandleSight` in realtime fills the best-sighting array. `HandleBestSightingPositionInRealtime` then calls `EnterCombatMode(team)`, possibly giving the best-placed soldier an interrupt (`OppList.cc:372–430`). An attack that was noticed when the busy count reaches 0 also enters combat (`Overhead.cc:5700–5712`), as do doors, explosions and quest scripts. `CommonEnterCombatModeCode` stops **everyone** (snapping each to a tile centre), cancels AI actions and recomputes APs (`:3890–3982`). Leaving combat pauses AI for 1500 ms (`:4085`).

**Other wall-clock dependencies** [V]: capture/death callbacks of 3 s and 10 s (`Overhead.cc:5069–5073`), the bomb queue (§6), and stracciatella's duration multiplier.

## 6. Other time-coupled gameplay

- **Explosions** [V]:
  - Ignition raises the busy count and sets **global `DISALLOW_SIGHT`**, which makes every LOS test return 0 (`Explosion_Control.cc:104–113`; `LOS.cc:653`).
  - **Damage is applied at an animation keyframe** (`Explosion_Control.cc:205–209`; `Tile_Animation.cc:320–349`): `getDamageKeyframe` 3–18 frames × `blastSpeed` 20–80 ms. The whole radius is applied at once (`SpreadEffect`).
  - The animation's end lowers the busy count and re-enables sight (`Tile_Animation.cc:219–235`).
  - Chain reactions ignite new explosions, each with its own keyframe delay (`Items.cc:3211, 3264`; `Explosion_Control.cc:587, 688`).
  - Queued bombs are spaced **1000 + Random(500) ms** apart (`:61, 2054–2095`), and that random draw comes from the shared RNG.
- **Smoke and gas** spread and decay once per turn, or once per 5 s tick in realtime (`TileEngine/SmokeEffects.cc:277–360`). Damage happens on entering a tile and at turn start [V].
- **Fire**: there is no fire spread. Flamethrower shots are bullets and the burning death is an animation [V].
- **Doors**: the structure swaps immediately at opcode 494/495 (`Handle_Doors.cc:42–67`). **`DOOR_BUSY` stays set until the door's tile animation ends** (`Tile_Animation.cc:200`), and it blocks interaction (`Handle_Doors.cc:206`) and AI door decisions (`TacticalAI/DecideAction.cc:138, 254`) [V].
- **Roof climb**: APs are paid on entering the state, and **global sight is disabled until frame 408/475** (`Soldier_Control.cc:1574–1588`). In realtime the whole map is blind for the duration [V].
- **Dying**: life drops at impact, but corpse, item drop, kill credit and visibility only change at the end of the death animation (440). Until then the soldier occupies his tile and can take "hit while down" animations (`Soldier_Control.cc:2869–2895`) [V].
- **Muzzle flash**: `fMuzzleFlash` is a visibility boost (`OppList.cc:888`). It is cleared when AI handles the shooter, at team change, or in realtime when the busy count reaches 0 [V].
- **Breath, bleeding, shock halving, drugs** happen at each team's turn start (`Soldier_Control.cc:4000–4075`), or every 5 s in realtime [V].
- **Morale** is event-driven, plus suppression at the end of an attack [V]. I didn't check strategic morale decay.

## 7. Recommendations

**Boundary.** The simulation should own a per-animation-state *action timeline* compiled offline from `ja2bin.dat` plus `gAnimControl`:
- frame count;
- the opcode markers that change gameplay (the list in §1b) at their frame indices;
- jumps and transitions;
- the `sAniDelay` formula.

The renderer gets the same timeline plus frame numbers and sounds. Nothing in the simulation should read sprites or frame indices directly.

**Time unit.** Use one integer game-millisecond clock with a fixed 5 ms step (matching `TOVERHEAD`). In turn-based play it runs as fast as the presentation likes (the original already uses delay 0 for unseen soldiers). Each soldier advances one frame when its accumulator passes `sAniDelay`. Replace the wall-clock systems with tick-based ones, keeping their values:
- bullets: ms per tile, chosen deterministically;
- physics: a fixed 20 ms tick;
- AI cadence: 100 ms per soldier, 50 ms round-robin, and a fixed number of soldiers per pass instead of the 10 ms CPU slice;
- the 5000 ms realtime turn;
- explosion keyframes, `DOOR_BUSY`, the bomb queue and the 20 ms melee hit delay.

Model the "no catch-up" behaviour as idealised, with no dropped frames.

**Discrete steps the simulation must keep, in original order**
1. **Tile steps:** pay AP/BP at the centre; switch occupancy at the half-step; run arrival checks at the next centre in this order: breath collapse → mines → noise and noise interrupt → sight and sight interrupt → mine sense → AI new situation.
2. **Turn octants** with a sight check per step and turning AP paid up front. A new sighting cancels an AI turn-to-shoot or throw.
3. **Attack phases:** ready/turn → fire markers (per-round roll at each marker) → bullet trace stepped per tile against *current* occupancy and stance → impact (damage now) → hit reaction (knockback, falling) → release.
4. **A resolution barrier** replacing the global busy count: no interrupts, deferred noise and deferred AI re-planning until every pending effect (bullets, objects, explosions, hit reactions) has settled. Then suppression, combat entry and end-of-battle run in that order.
5. **Death in two stages:** "life 0" at impact, "corpse" at the end of the death timeline.

**Purely presentational:** sprite frames, sounds (except 721/722, which damage fragile items), light sprites, z-overrides, camera, fades, damage text, the 3 s sighting pause, and idle animations (491). Give idle animations their own RNG and make sure they can't delay sim actions. **Split the RNG streams:** the original's `Random` and `PreRandom` share one engine (`sgp/Random.cc:7–90`), and presentation code consumes it.

**Trickiest cases to replicate deliberately**
- **Interrupts mid-move** only ever happen at tile centres, after that step was paid for. The mover freezes and resumes later (no-AP-to-finish-move flag plus AI "continue path").
- **Realtime half-step occupancy** decides who a stray bullet or grenade hits, and when gassing and water damage happen. Stops snap to tile centres.
- **Throw roll at command time vs gun roll at fire frame.** NPC throws can be aborted before release with no AP spent.
- **Bursts against reacting targets:** later rounds aim at the target's new end stance while hitting against his standing shape. Pick one deterministic cadence (one bullet tile per N ms, shot interval = frames × delay) and document that it fixes the original's frame-rate dependence.
- **Explosion damage delay** and global sight blackout; chain reactions at keyframe intervals; randomised spacing in the bomb queue.
- **Door busy window** and **roof-climb blackout** must be timed simulation state, not animation side effects.
- **Realtime races:** the movement speed formula, AI cadence, and the realtime → turn-based handoff via best sighting plus an optional interrupt.

**Not covered:** I didn't parse `ja2bin.dat` to get each opcode's frame position per state, and I only skimmed `ExecuteAction` and `CheckForAndHandleSoldierIncompacitated` internals. A small extractor script for `ja2bin.dat` is the natural next step, since it also produces the timeline data the simulation needs.

<!-- 2026-10-15: the extractor spike exists: tools/spikes/ja2bin-timelines.py; numbers from a real Ja2bin.dat (Steam 1.12) are in 04-time-and-server.md §1. -->
