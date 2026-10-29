# 11 — Attacks: guns, bullets and melee

Gun and melee attacks from the order until the bullet or blow lands: the order, AP costs, fire animations, jams, the
chance to hit, bullets and structures, melee, and the RNG order of one whole shot. What a hit does (armour, damage, hit
reaction, death), the attack barrier, suppression, morale and experience: `33`; throwing, launchers, item physics and
fuses: `34`.

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless marked V (vanilla `Build/`).
"(inferred)" marks conclusions not traced end to end. C integer semantics apply everywhere: `/` truncates toward zero
(`idiv` in `src/core/int.ts`), `%` keeps the dividend's sign, `INT8`/`UINT8`/`INT16` stores wrap (`i8`, `u8`, `i16`).
`f32(x)` = `Math.fround(x)`; `trunc` = `Math.trunc`; `wsm(x)` = `WEAPON_STATUS_MOD` (§1.1). Animation frame counts,
speeds and opcode positions (§1.6, §4.1) were read from one release (Steam 1.12 `Ja2bin.dat`, with
`tools/spikes/ja2bin-timelines.py`; speeds from `gAnimControl`); other releases may differ, and ja2-node reads the
scripts from the user's data at load time (§6.1).

**RNG.** `pre(n)` = `PreRandom(n)` (stream `pre`, ja2-node `t.pre`), `main(n)` = `Random(n)` (stream `main`,
ja2-node `t.rng`), `preChance(p)` = `pre(100) < p`; `CoinToss()` draws `main`. `n = 0` returns 0 and **draws nothing**
(`sgp/Random.cc:62-83`; ja2-node's `Rng.int(0)` matches). The C parameter is `UINT32`, so a negative `INT32` argument
wraps: pass `n >>> 0` (`Rng.int` throws on negatives). The order of two calls inside one C++ expression is unspecified;
where that happens this doc assumes left to right and says so. Cosmetic draws (sounds, curses, quotes, blood graphics)
share `main` in the original; ja2-node does not make them (§6.3).

**Directions and units.** N 0 … NW 7; `GetDirectionFromGridNo(g, s)` is the direction **from `s` towards `g`**
(`Soldier_Control.cc:6334-6349`). World units: 10 per tile horizontally; height units: 256 per storey, 64 per cube
(`08` §1.1). Teams: OUR 0, ENEMY 1, CREATURE 2, MILITIA 3, CIV 4. `OKLIFE 15`, `CONSCIOUSNESS 10`, `OKBREATH 10`,
`USABLE 10` (minimum item status). `AIM_SHOT_RANDOM 0, HEAD 1, TORSO 2, LEGS 3, GLAND 4`.

**Sources.** `Tactical/Weapons.cc`, the bullet half of `Tactical/LOS.cc`, `Tactical/Bullets.cc`, the attack parts of
`Tactical/Handle_Items.cc`, `Soldier_Control.cc` and `Soldier_Ani.cc`. Elsewhere: `08` LOS, sight and noise; `10` turns
and interrupts; `12` items, inventory and explosions (from `IgniteExplosion` on, `12` §10); `13` the combat AI; `29`
the agent API (the `attack` command, `estimateAttack`, the attack events).

## 0. Overview

```
order ─ HandleItem: checks, AP check only, (psycho burst roll)             §1.3
  └ EVENT_FireSoldierWeapon: busy +1, bBulletsLeft, ready (AP) / turn (AP) §1.4
     └ fire state: 757 busy +1, 470 jam check, 430 queue fire event        §1.6, §1.7
        └ UseGun at the fire frame: AP paid, CTH, hit roll, ammo, XP       §1.9, §2
           └ FireBulletGivenTarget: aim or miss angle, first tile now      §3.1, §3.2
              └ MoveBullet, one tile per frame: structures, people,        §3.4, §3.5
                 suppression points                                         33 §3.1
                 ├ structure stops it → miss animation → FreeUpAttacker    §3.5
                 └ person → BulletHitMerc → BulletImpact (armour, crits)   33 §1
                    └ EVENT_SoldierGotHit: damage NOW, hit animation       33 §2.1
                       busy +1; attacker's own hold released (last bullet)
                       └ hit animation → release, or fall → 497 → death
                          animation → 440 corpse                           33 §2.5
  … busy count reaches 0 → end of attack: suppression, notice the
    attacker, combat entry, stat points, deferred noise, end of battle     33 §3.4
melee: order → begin event (busy +1) → 430 UseBlade / UseHandToHand        §4
       → hit 20 ms later → EVENT_SoldierGotHit                             33 §2.1
throw: rolled at the order → physics object → IgniteExplosion             34 §0
```

Invariants:
1. **Who rolls when.** Guns, melee and launchers roll at the fire frame (opcode 430), against the world at that
   moment; thrown objects roll at the order (`34` §1). Guns and melee pay APs at the fire frame, throws at the
   release frame (460/461).
2. **The roll only sets `sHitBy`.** `CTH − roll` > 0 is a straight shot plus a damage bonus; ≤ 0 is an angular miss.
   What the bullet then meets decides the outcome: cover can stop a "hit", a "miss" can still strike the target or a
   bystander (§3).
3. **Damage at impact, death at the end of the death animation.** Life drops when the bullet arrives; corpse, item
   drop, kill credit and target removal happen at opcode 440, seconds later (`33`).
4. **One barrier.** `ubAttackBusyCount` counts everything still resolving (attacks, bullets, hit animations, objects,
   explosions). While it is above 0, interrupts, noise and AI re-planning wait; reaching 0 runs the end-of-attack
   sequence once, with the soldier whose release emptied it (`33`).
5. **`pre` for outcomes.** Hit rolls, deviation, cover, armour, criticals and stat gains use `pre`; a few gameplay
   draws use `main` (instant-kill bonus, head-gear damage, weapon drop, turn-from-hit, fall side, explosive barrels).

---

## 1. Gun attack: from order to the fire frame

### 1.1 Data

| Source | Fields used here |
|---|---|
| `weapons.json` (`WeaponModels.cc:165-600`) | `internalType` → item class and `ubWeaponClass` (PISTOL/M_PISTOL → HANDGUN, SMG → SMG, RIFLE/SN_RIFLE/ASRIFLE/LAW/CANNON/LAUNCHER → RIFLE, SHOTGUN → SHOTGUN, LMG → MG, BLADE/THROWINGBLADE → KNIFE, MONSTSPIT → MONSTER). `LAW` and `CANNON` are `IC_GUN` (impact 80 for LAW, `:1389-1395`); `LAUNCHER` is `IC_LAUNCHER`. `ubImpact`, `usRange` (world units, 10 per tile), `ubShotsPerBurst` (max 6, MINIMI), `ubBurstPenalty`, `ubBulletSpeed` (20–30), `ubReadyTime`, `ubShotsPer4Turns`, `ubMagSize`, `ubAttackVolume`, `ubHitVolume`, `bReliability`, `bTwoHanded` |
| `ammo-types.json` | `AMMO_REGULAR 0, HP 1, AP 2, SUPER_AP 3, BUCKSHOT 4, FLECHETTE 5, GRENADE 6, MONSTER 7, KNIFE 8, HE 9, HEAT 10, SLEEP_DART 11, FLAME 12` (`Weapons.h:66-81`); a gun's current type is `inv[hand].ubGunAmmoType` |
| `armours.json` | `armourClass` (HELMET 0, VEST 1, LEGGINGS 2, PLATE 3, MONST 4), `protection`, `explosivesProtection`, `degradePercentage`, `ignoreForMaxProtection` |
| `game.json` (`DefaultGamePolicy.cc:31-54`; ja2-node compiles in these defaults) | `chance_to_hit_minimum` 1, `_maximum` 99, `tactical_head_damage_multiplier` 1.5, `tactical_legs_damage_multiplier` 0.5, `aim_bonus_per_std_ap` 10, `aim_bonus_sniperscope` 20, `aim_bonus_laserscope` 20, `range_penalty_silencer` 0, `range_bonus_barrel_extender` 100, `fixed_cost_to_shoot` false, `ai.better_aiming_choice` false, `suppression_fire_modifier` 6, `suppression_fire_reaction_threshold` 130 |
| JSD (`content/formats/jsd.ts`) | per structure `armour` (material index into `gubMaterialArmour`, `TileEngine/Structure.cc:119-149`), `density` (%), flags, shape |

`WEAPON_STATUS_MOD(x) = x >= 85 ? 100 : idiv(x*100, 85)` (`Weapons.cc:74`). `GunRange(o) = usRange +
100*WSM(extender)/100 − silencer penalty(0)` for every `IC_WEAPON` class, `CELL_X_SIZE` (10) for anything else
(`:86-103`; a range of 0 would divide by zero in the bullet's range drop). Item slots: `HANDPOS`, `SECONDHANDPOS`,
`HELMETPOS`, `VESTPOS`, `LEGPOS`, `HEAD1POS`, `HEAD2POS`. `bGunStatus` is `bStatus[0]` of the gun; `bGunAmmoStatus` < 0
means jammed.

### 1.2 Timeline at a glance (single aimed shot, standing, gun lowered, target in front)

| Step | Where | What changes |
|---|---|---|
| order | `HandleItem` (`Handle_Items.cc:200-432`) | checks, AP *check* (nothing paid), optional psycho burst roll, `SendBeginFireWeaponEvent` |
| same frame, event pump | `EVENT_FireSoldierWeapon` (`Soldier_Control.cc:2112-2221`) | busy +1, `target`, `bBulletsLeft`, enter `READY_RIFLE_STAND` (ready APs paid on entry, `:1407-1424`), desired direction set (turn APs paid now, `:3859-3883`), `fTurningToShoot` |
| ready anim ends | script `READY_RIFLE_STAND` → `AIM_RIFLE_STAND` (`ANIM_FIREREADY`) | |
| facing reached | `TurnSoldier` (`:4245-4277`) | `SelectFireAnimation` → `SHOOT_RIFLE_STAND` |
| fire state entered | opcodes `757 470 441 430` before frame 0 | busy +1, jam check, muzzle light, fire event queued |
| same frame, event pump | `FireWeapon` → `UseGun` (`Weapons.cc:349, 574-882`) | **APs paid**, CTH, **hit roll**, ammo, XP, `FireBulletGivenTarget` → first `MoveBullet` immediately, gunfire noise (deferred), wear |
| following frames | `UpdateBullets` each frame (`GameScreen.cc:424`) | bullet steps, hits, structure hits, release |
| script end | `753 772 473` → `AIM_RIFLE_STAND` | busy −1 |

Main loop order per frame: `SimulateWorld` (physics) → `UpdateBullets` → `ExecuteOverhead` (soldier animation passes) →
… → `DequeAllGameEvents` (`GameScreen.cc:343, 424, 427, 456`). Opcode 430 only *queues* `EV_S_FIREWEAPON`
(`Soldier_Ani.cc:313-323`); it runs after every soldier's pass of that frame, in queue order
(`Utils/Event_Pump.cc:238-260`), so a soldier later in the same pass still sees the pre-shot world. Delayed events
(melee `EV_S_WEAPONHIT`, 20 ms) wait in a secondary queue and fire when `now − stamp > delay` (strict, `:100-122`).
ja2-node drains the queue after each tick's soldier pass (§6.2).

### 1.3 The order: `HandleItem` for `IC_GUN` / `IC_THROWING_KNIFE`

In order (`Handle_Items.cc`):
1. Realtime: `ubAttackBusyCount = 0` (`:214-219`). `tgt = WhoIsThere2(grid, level)`; `tgt.bBeingAttackedCount = 0`
   (`:221`).
2. Fail if `bLife < OKLIFE` (unconscious) or `HandItemWorks(HANDPOS)` fails (`:224-225`, `:2639-2694`): an
   `ITEM_DAMAGEABLE` item (not a pressure-triggered mine, a medkit or the gas can) below status 10 does not work; at
   ≥ 10 it **breaks when `main(80) + 20 >= status + 50`** (status becomes `1 + main(9)`); a working main-hand gun with a
   second gun of status ≥ 10 and shots left repeats the test for that gun. Player refusals (good guys, buddies, rebels;
   `:230-266`) and the rocket-rifle imprint (`:269-313`) are not ported (deviations "Attack refusals").
3. Not a throwing knife: `EnoughAmmo(HANDPOS)` else `NOAMMO` and `fDoSpread = FALSE` (`:315-324`;
   `Points.cc:1322-1350`).
4. `targetGrid = tgt ? tgt.sGridNo : grid`. Player in combat: the "bad chance to get through" quote may cancel
   (`:329-337`, UI).
5. `apCost = CalcTotalAPsToAttack(s, targetGrid, addTurning=TRUE, bAimTime)`. `GetAPChargeForShootOrStabWRTGunRaises`
   decides whether turning and raising are charged: standing+raising sets `fDontChargeTurningAPs`, otherwise turning
   sets `fDontChargeReadyAPs` (`:343-358`). `EnoughPoints(apCost)` else `NOAPS` (`:361`). **Nothing is deducted here.**
6. Psycho (profile trait PSYCHO), not bursting, burst-capable gun: if `EnoughPoints(CalcTotalAPsToAttack(burst=TRUE, aim
   0))` **and `main(3 + bAimTime) == 0`** → switch to burst (`bDoBurst = 1`, `WM_BURST`) (`:364-385`).
7. UI: `bTargetLevel = interface level` (the AI sets it itself) (`:390-394`).
8. Gun: `SendBeginFireWeaponEvent(s, fDoSpread && spread[0] ? spread[0] : targetGrid)`; throwing knife:
   `EVENT_SoldierBeginKnifeThrowAttack` (busy +1, `bBulletsLeft = 1`, `THROW_KNIFE`, `Soldier_Control.cc:6838-6860`)
   (`:396-419`).

AI path: `ExecuteAction(AI_ACTION_FIRE_GUN)` → optional civ quote **`main(50) == 0`** for a visible, non-militia,
profile-less merc body (not drawn by ja2-node, §6.3) →
`HandleItem(s, usActionData, bTargetLevel, hand item, fromUI=FALSE)` (`TacticalAI/AIMain.cc:1587-1619`).
`DecideActionRed/Black` sets `bAimShotLocation = AIM_SHOT_RANDOM` before choosing (`DecideAction.cc:2784`). The player sets it from the cursor: head/torso/legs on a non-prone merc,
otherwise RANDOM (`UI_Cursors.cc:487-573`); agents pass it explicitly.

### 1.4 `EVENT_FireSoldierWeapon` (`Soldier_Control.cc:2112-2221`)

```ts
if (s.gridNo === target) return;
tactical.attackBusyCount++;                                   // :2125
s.targetGrid = target; s.target = whoIsThere(target, s.targetLevel);
if (isGun(s.inv[HAND])) {
  s.bulletsLeft = s.doBurst ? min(shotsPerBurst(s.inv[hand]), s.inv[hand].shotsLeft)
                : isValidSecondHandShot(s) ? 2 : 1;
  if (s.inv[hand].ammoType === AMMO_BUCKSHOT) s.bulletsLeft *= 9;     // NUM_BUCKSHOT_PELLETS
}
soldierReadyWeapon(s, target, false);   // PickSoldierReadyAnimation: READY_* unless already FIREREADY/FIRE; sets desired dir
if (monster) { setDirection(desired); initAnim(SelectFireAnimation(endHeight)); }
else if (isLauncher(hand) || hand === ROCKET_LAUNCHER) {      // "fire right away", no turning steps
  s.dontUnsetLastTargetFromTurn = true; s.turningFromProne = false; setDirection(desired);
  initAnim(SelectFireAnimation(endHeight));
} else s.turningToShoot = true;
```
`IsValidSecondHandShot`: second hand holds a one-handed gun with status ≥ 10 and shots left, first hand holds a gun, not
bursting (`:8624-8633`). Ready APs: entering `READY_RIFLE_*`/`READY_DUAL_*` deducts `GetAPsToReadyWeapon`
(`ubReadyTime`; 1 for dual; `Points.cc:1612-1645`) unless `fDontChargeReadyAPs` (then cleared)
(`Soldier_Control.cc:1407-1424`). Turning: `EVENT_InternalSetSoldierDesiredDirection` deducts `AP_LOOK_STANDING 1 /
CROUCHED 2 / PRONE 2` once, if the state has `ANIM_BREATH|ANIM_OK_CHARGE_AP_FOR_TURN|ANIM_FIREREADY` and
`!fDontChargeTurningAPs` (cleared after) (`:3859-3883`). `sLastTarget` (the +10 CTH and the 1-AP target-change discount)
is reset to NOWHERE by any direction change unless `fDontUnsetLastTargetFromTurn` (`:3973-3976`) and by entering a
non-FIREREADY state from a non-FIREREADY state other than `READY_RIFLE_*`/`ROBOT_SHOOT` (`:1360-1371`); it is set to
`sTargetGrid` when the attack busy count reaches 0 (`Overhead.cc:5783`).

Facing the desired direction in a FIREREADY state (`TurnSoldier`, `:4245-4277`) → `SelectFireAnimation(endHeight)`; a
soldier turning from prone goes back down first (pending fire animation).

`SelectFireAnimation` (`:2224-2405`): monster spit states; `ROBOT_(BURST_)SHOOT`; `SHOOT_ROCKET` (LAW); `SHOOT_MORTAR`;
`TANK_SHOOT`/`TANK_BURST`. Standing: dual → `SHOOT_DUAL_STAND`; else **calls `GetTargetWorldPositions`** (which may roll
the random body part now, §1.8) and uses the low variant when `PythSpacesAway ≤ 2 && targetZ ≤ 100` and not in water:
burst → `FIRE_BURST_LOW_STAND` / `STANDING_BURST`, single → `FIRE_LOW_STAND` / `SHOOT_RIFLE_STAND`. Prone: burst →
`PRONE_BURST`, dual → `SHOOT_DUAL_PRONE`, else `SHOOT_RIFLE_PRONE`. Crouched: dual → `SHOOT_DUAL_CROUCH`, burst →
`CROUCHED_BURST`, else `SHOOT_RIFLE_CROUCH`.

### 1.5 AP costs (`Tactical/Points.cc:843-1180`)

```ts
calcTotalAPsToAttack(s, g, addTurning, aim) =            // :866
  gun|launcher|tentacles|throwing knife: minAPsToAttack(s, g, addTurning)
                                         + (s.doBurst ? calcAPsToBurst(calcActionPoints(s), hand) : s.weaponMode === ATTACHED ? 0 : aim)
  grenade|bomb: 5
  none|punch|blade: walkCost (path to an adjacent tile, cached in sWalkToAttack*, reset on every tile change) + minAPsToAttack + aim
minAPsToShootOrStab(s, g, addTurning, afterMoving) {     // :1081
  let ap = 0;                                             // AP_MIN_AIM_ATTACK
  let turn = addTurning && dirTo(g) !== s.direction, raise = !throwingKnife && (afterMoving || !(flags(state) & (FIREREADY|FIRE)));
  if (throwingKnife || item === ROCKET_LAUNCHER) ap += apsToChangeStance(s, STAND);
  if (height(state) === STAND) { if (raise) turn = false; } else { if (turn) raise = false; }
  if (robot) raise = false;
  if (turn) ap += throwingKnife ? 1 : apsToLook(s);       // 1 / 2 / 2+2+2 (prone: up, turn, down)
  if (raise) ap += apsToReadyWeapon(s);
  if (g !== s.lastTarget && item !== ROCKET_LAUNCHER) ap += 1;   // AP_CHANGE_TARGET
  ap += baseAPsToShootOrStab(calcActionPoints(s), aimSkill, weapon);   // max of both guns for dual
  return clamp(ap, 1, max(fullAPs, 1));
}
aimSkill = gun|launcher ? effMarksmanship : idiv(effDex + effAgi, 2);
baseAPsToShootOrStab(aps, skill, o) {                     // :1006, fixed_cost_to_shoot = false
  const top = 2*aps;
  let bottom = idiv((50 + idiv(skill, 2)) * shotsPer4Turns(o), 4);
  if (springAndBolt) bottom = idiv(bottom * (100 + idiv(status, 5)), 100);
  return idiv(idiv(100*top, bottom) + 1, 2);             // rounds half up
}
calcAPsToBurst(aps, o) = o.item === G11 ? 1
  : max(3, idiv(5*aps + 24, 25)) [* 100 / (100 + idiv(springStatus, 5)) with spring-and-bolt]   // :843
```
`calcActionPoints(s)` is the full per-turn AP pool. Aiming: `bAimTime` 0..4 extra APs (`AP_MAX_AIM_ATTACK 4`,
`Points.h:79-80`), each +10 CTH if the target is visible and not bursting; bursts and attached launchers ignore it. At
the fire frame `UseGun` recomputes `CalcTotalAPsToAttack(addTurning=FALSE)` and deducts it; the soldier is now in an
`ANIM_FIRE` state, so there is no raise cost: target change + base + aim/burst (`Weapons.cc:591-623`). Bursts pay only
on round 1; dual pistols pay only for the main hand.

### 1.6 Firing animations (`Ja2bin.dat` scripts)

Fire states use a fixed `sSpeed` (100 ms per frame for rifle shots and bursts, 150 for dual, 110 for LAW and mortar), so
combat halving does not apply; `READY_RIFLE_STAND` has speed 0 (stat-computed, `Soldier_Control.cc:4763-4918`). In
combat, soldiers not visible to the player get delay 0 (every pass, `:4928-4936`; ja2-node applies it at once, without
the fade, gaps "Unseen soldiers in combat"). Opcode layout (frames as `[n]`):

| State | Script (gameplay opcodes) |
|---|---|
| `SHOOT_RIFLE_STAND` / `_CROUCH` / `_PRONE` | `757 470 441 430 [0] …` then `753 772 473` → `AIM_RIFLE_*`: the shot is resolved on entering the state |
| `FIRE_LOW_STAND` | `757 [0-3] 470 441 430 [4] … [11] 753 473` |
| `STANDING_BURST`, `CROUCHED_BURST`, `PRONE_BURST` | `757` then 6× `441 448 430 [2 frames]`, tail frames, `449 753 473`: one round every 2 frames = **200 ms** |
| `FIRE_BURST_LOW_STAND` | 4 frames, then 6× `441 448 430 [2]` … `449 753 473` |
| `SHOOT_DUAL_STAND` / `_CROUCH` / `_PRONE` (150 ms) | `757 459 470 441 430 [0-3] 458 470 441 430 [4-7] 753 473`: main hand, then second hand 4 frames later |
| `SHOOT_ROCKET` (LAW), `SHOOT_MORTAR` | `757 [0-11] 470 430 …753 499` (mortar: 37 frames before `470 430`) |
| `THROW_KNIFE` (50 ms) | `757 [0-8] 430 [9-14] 753 442 499` |

Opcode semantics (`Soldier_Ani.cc`): **757** busy +1 (`:2269`); **753** `ReduceAttackBusyCount(s, FALSE)` (`:2224`);
**470** `OKFireWeapon` (`:1048-1092`); **441** muzzle-flash light sprite only (`:447`); **430** queue `EV_S_FIREWEAPON`
with `sTargetGridNo/bTargetLevel/bTargetCubeLevel` (`:313`); **448** burst controller (`:638-738`); **449** `fDoSpread =
FALSE, bDoBurst = 1` (`:740`); **473** `CheckForImproperFireGunEnd`: if the main gun is jammed or empty and the second
hand is not a gun, `InternalSoldierReadyWeapon(fEndReady)` → `END_RIFLE_*` (`:1134, 3239-3260`); **459/458** select
first/second hand (`usAttackingWeapon`) (`:835-846`); **477** camera; **772** clears the realtime non-interrupt flag.

**448** (each round of a burst, before its 430):
```ts
let stop = s.doBurst > shotsPerBurst(attackingWeapon);
if (!enoughAmmo(s, hand)) stop = true;
else if (s.doBurst === 1) {                         // jam check only for round 1
  const r = checkForGunJam(s);
  if (r === JAMMED) { stop = true; s.bulletsLeft = 0; freeUpAttacker(s); }
  else if (r === UNJAMMED && handleUnjamAnimation(s)) return;
}
if (stop) { s.doSpread = 0; s.doBurst = 1; reduceAttackBusyCount(s, false);   // balances 757; 753 is never reached
            if (checkForImproperFireGunEnd(s)) return; changeState(AIM_RIFLE_<endHeight> | STANDING for robots); return; }
if (s.doSpread && s.spread[s.doSpread - 1]) { setDirection(dirTo(spread[doSpread-1])); setDesiredDirection(direction); }
```
Rounds beyond `ubShotsPerBurst` (or beyond the magazine) stop at the next 448: a 3-round burst plays 3 rounds and
returns to aim. `bDoBurst` is 1-based; `UseGun` increments it after each round.

### 1.7 Jam, unjam, explosive failure, wear

`CheckForGunJam` (`Weapons.cc:245-321`), only `SOLDIER_PC`, only an `IC_GUN` that is not `EXPLOSIVE_GUN` (LAW, tank
cannon):
```ts
if (o.ammoStatus > 0) {
  let chance = 80 - o.gunStatus;
  chance -= s.doBurst > 1 ? pre(80) : pre(100);   // the pre(80) branch is unreachable: 448 only checks round 1
  if (pre(100) < chance) { o.ammoStatus = -o.ammoStatus; deductAmmo(s, hand); quote(JAMMED); return JAMMED; }
} else if (o.ammoStatus < 0) {
  if (skillCheck(s, UNJAM_GUN_CHECK, 4 * reliability(o)) > 0) {
    o.ammoStatus = -o.ammoStatus; statChange(MECHANAMT, 5, SUCCESS); statChange(DEXTAMT, 5, SUCCESS); return UNJAMMED;
  }
  return JAMMED;
}
return FIREABLE;
```
Guns above status 80 never jam (both draws still happen); a jam costs one round. `SkillCheck(UNJAM)`
(`SkillCheck.cc:146-421`): skill = `30 + idiv(effMech, 2)`, minus `idiv(idiv(skill·fatigue%, 100), 2)`, plus the
modifier and `GetMoraleModifier`, clamped 0..99; roll **`pre(100)`**; on failure **`main(100) < 40`** is drawn (the
unjam check is silent, but the draw happens; ja2-node does not make it, §6.3).

`OKFireWeapon` (`:324-340`): second-hand shot without ammo → FAILED for the player team; else `CheckForGunJam`. Opcode
470 on JAMMED: `usAniCode += 4` and the loop's own `++` skip the next 4 entries (441, 430 and two frames: no shot),
`bBulletsLeft -= (buckshot ? 9 : 1)`, dry-fire sound, `FreeUpAttacker`. The script then reaches 753 and 473, which
lowers the now jammed gun. UNJAMMED plays `*_SHOOT_UNJAM` (`HandleUnjamAnimation`, `:3264-3294`) and resumes.

`WillExplosiveWeaponFail(s, o)` (`:3870-3886`), LAW in `UseGun` and launchers in `UseLauncher`, only for the player team
or a visible shooter: `i8(pre(40) + pre(40)) > status && pre(2) == 1` → it explodes in the shooter's tile
(`IgniteExplosion(C1)`) and the busy count is reduced once more.

Wear and the gunpowder smell (`bMonsterSmell`) are the last two lines of `UseGun` (§1.9, `:869-875`).

### 1.8 `FireWeapon` and `GetTargetWorldPositions`

`FireWeapon(s, grid)` (`:349-416`): same tile as the shooter → `FreeUpAttacker`, FAILED. `opponent = null`. Dispatch by
item class: gun/throwing knife → spread bookkeeping (`fDoSpread` cleared if not bursting or > 6; when set, use
`sSpreadLocations[fDoSpread−1]` if non-zero, then `fDoSpread++`) → `UseGun`; blade → `UseBlade`; none/punch →
`UseHandToHand(steal=FALSE)`; launcher → `UseLauncher`; anything else → `UseThrown`.

`GetTargetWorldPositions(s, grid)` (`:419-522`):
```ts
const t = whoIsThere(grid, s.targetLevel);
if (t) {
  s.opponent = t; x = centerX(t.gridNo); y = centerY(t.gridNo);       // tile centre, col*10+5
  const asked = s.aimShotLocation;
  if (asked === AIM_SHOT_RANDOM) {
    const r = pre(100);
    s.aimShotLocation = r < 15 ? LEGS : r > 94 ? HEAD : TORSO;         // 15 / 80 / 5 %
    if (s.aimShotLocation !== HEAD) {
      const ctgt = bodyPartCTGT(s, t, s.aimShotLocation);              // §3.6, no RNG
      if (ctgt < 25 && bodyPartCTGT(s, t, HEAD) > 2*ctgt) s.aimShotLocation = HEAD;
    }
  }
  // ai.better_aiming_choice (default false) replaces the choice by CTH×CTGT thresholds (:465-489)
  z = calculateSoldierZPos(t, HEAD|TORSO|LEGS_TARGET_POS by aimShotLocation, else TARGET_POS);   // docs/08 §1.2
} else {
  x, y = tile centre; z = targetZFromStructureHeight(grid, s.targetLevel, s.targetCubeLevel);   // LOS.cc:1488-1517
}
```
`aimShotLocation` stays resolved afterwards, so a burst or a later call never rolls again; whichever of
`SelectFireAnimation` (standing, single hand) or `UseGun` calls it first makes the one `pre(100)` draw. A random roll
that lands on HEAD gets the head CTH penalty, because CTH is computed after this call.

Target Z for an empty tile (`GetTargetZPosFromStructureHeight`): with a cube level `((cube + 4·level) − 0.5)·64`; else
`h` = the tallest structure (cubes) on that tile and level, `h > 1 → h − 1`, and `(h + 4·level − 0.5)·64` if `h > 0`,
else `4·level·64 + 1`; plus the land height `sHeight·256/50`.

### 1.9 `UseGun` (`Weapons.cc:574-882`), in order

```ts
const ap = calcTotalAPsToAttack(s, grid, false, s.aimTime);
if (s.doBurst) { if (s.doBurst === 1) deductPoints(s, ap, 0); }       // burst sound too
else if (!isValidSecondHandShot(s) || s.attackingHand === HANDPOS) deductPoints(s, ap, 0);   // dual: main hand pays
getTargetWorldPositions(s, grid);                                     // pre(100) if still RANDOM (§1.8)
let cth = throwingKnife ? calcThrownChanceToHit(s, grid, aim, aimLoc)   // 34 §4
                        : calcChanceToHitGun(s, grid, aim, aimLoc, modify = true);   // §2; barrel extender main() draws
if (inMeanwhile) cth = 100;
const roll = pre(100);                                                // THE hit roll
const hit = roll <= cth;                                              // so 99 never misses, 1 hits 2 % of the time
if (!throwingKnife) {
  deductAmmo(s, hand);                                                // ubGunShotsLeft-- (tanks keep MG ammo)
  if (ourTeam && s.target && (!s.doBurst || s.doBurst === 2 /* burst: round 2 only, 33 §5 */) && inCombat
      && bodyPartCTGT(s, s.target, aimLoc) > 0) {
    let xp = 0;
    if (hit) { xp += idiv(u8(100 - cth), 25); if (aim && !s.doBurst) xp += min(aim, xp); xp += 3; }
    xp += 3;
    if (dual) xp = idiv(xp*2, 3);
    xp = modifyExpGainByTarget(xp, s.target);                         // cow/crow /2, vehicle/tank 0
    statChange(s, MARKAMT, xp, hit ? SUCCESS : FAILURE);              // pre() draws inside, 33 §5
  }
  s.muzzleFlash = !creature && ammo !== SLEEP_DART; buckshot = ammo === BUCKSHOT;
} else { muzzleFlash = false; /* knife XP: (100-cth)/10, 2·min(aim,xp), +10 hit, +10, split MARK/DEX (:757-784) */ }
if (item === ROCKET_LAUNCHER && willExplosiveWeaponFail(s, hand)) { discardLAW; ignite(C1 at shooter); reduceAttackBusyCount(s); }
fireBulletGivenTarget(s, x, y, z, s.attackingWeapon, i16(cth - roll), buckshot, fake = false);   // §3
let volume = attackVolume(weapon);
if (throwingKnife) { removeOne(HANDPOS); refill hand from a (bloody) throwing knife elsewhere; }
else if (item === ROCKET_LAUNCHER) {
  hand = DISCARDED_LAW;
  const back = newGridNo(s.gridNo, opposite(s.direction)), b = whoIsThere(back, s.level);
  if (b && height(b.state) !== PRONE) { attackBusyCount++; soldierGotHit(b, MINI_GRENADE, 10, 200, s.direction, 0, s, 0, CROUCH, back); }
} else if (silencer) volume = 1 + idiv(100 - wsm(silencerStatus), idiv(100, volume - 1));
makeNoise(s, s.gridNo, s.level, volume, NOISE_GUNFIRE);              // deferred while busy > 0 (docs/08 §3.3)
if (s.doBurst) s.doBurst++;
if (!pre(15 + 3*reliability) && status > 1) status--;                // wear
if (s.monsterSmell > 0 && main(2) === 0) s.monsterSmell--;           // gunpowder smell
```
`sHitBy = cth − roll` (§0, invariant 2): > 0 traces straight at the aim point and adds `sHitBy/2` % damage; ≤ 0
deflects the bullet by an angle proportional to the miss (§3.2). Burst rounds after the first roll the same way at
their own 430, with the burst penalty.

---

## 2. `CalcChanceToHitGun` (`Weapons.cc:1979-2548`)

`AICalcChanceToHitGun` calls it with the shooter temporarily `STANDING` and `fModify = FALSE` (`:2551-2562`), for
planning only. `range` = `trunc(hypot(Δcol, Δrow)·10)` (`GetRangeInCellCoordsFromGridNoDiff`,
`TileEngine/Isometric_Utils.cc:372-383`). All variables are INT32 unless noted.

```ts
function calcChanceToHitGun(s, g, aim, aimPos, modify): number {
  if (s.marksmanship === 0) return MIN;                                 // 1
  const gun = s.inv[s.attackingHand], item = s.attackingWeapon;
  const cond = wsm(gun.gunStatus);
  let mrk = item === ROCKET_LAUNCHER
    ? idiv(effDex(s) + effMrk(s) + effWis(s) + 10*effExp(s), 4) + HEAVY_WEAPS_BONUS*traitCount(s, HEAVY_WEAPS)
    : effMrk(s);                                                        // robot: max(own, controller's effMrk)
  mrk += moraleModifier(s);                                             // 33 §4
  mrk -= idiv(idiv(mrk * fatiguePercent(s), 100), 2);                   // SkillCheck.cc:118-144 (bBreathMax bands)
  let c = cond >= mrk ? mrk : idiv(mrk + cond, 2);
  if (g === s.lastTarget) c += 10;                                      // AIM_BONUS_SAME_TARGET
  if (profileTrait(s) === PSYCHO) c += 15;
  const range = rangeInUnits(s.gridNo, g);
  const eh = endHeight(s.state);
  if (eh === CROUCH) c += min(idiv(range, 10), 10);
  else if (eh === PRONE && range > 50) {                                // MIN_PRONE_RANGE
    let b = min(idiv(range, 10), 20);
    if (bipod) b += idiv(idiv(b * wsm(bipodStatus), 100), 2);
    c += b;
  }
  if (isWeapon(item) && !twoHanded(item)) {
    if (weaponClass(item) === SMG) c -= 5;
    if (!hasTrait(s, AMBIDEXT) && isValidSecondHandShot(s)) c -= 20;
  }
  if (s.doBurst) {
    let p = burstPenalty(item) * (s.doBurst - 1);
    const k = traitCount(s, AUTO_WEAPS); if (k) p = idiv(p, 2*k);
    c -= p;
  }
  const distVis = distanceVisible(s, IRRELEVANT, IRRELEVANT, g, 0);     // docs/08 §2.1, level 0 always
  let sight = -1;
  const t0 = whoIsThere(g, s.targetLevel);
  if (t0 && (s.opp[t0] === SEEN_CURRENTLY || publicOpp(s.team, t0) === SEEN_CURRENTLY))
    sight = soldierToBodyPartLOS(s, g, s.targetLevel, s.aimShotLocation, 52, aware = true);   // LOS.cc:1693
  if (sight === -1) sight = soldierTo3DLocationLOS(s, g, s.targetLevel, s.targetCubeLevel, 52, true);
  sight *= 2;                       // LOS returned (dist + foliage loss)·260/520; ×2 ≈ world units incl. foliage
  if (sight > distVis*10) sight += sight - distVis*10;                  // beyond vision counts double
  if (sight > 0 && aim && !s.doBurst) c += 10*aim;                      // aim_bonus_per_std_ap
  if (!(s.flags & SOLDIER_PC)) c += difficulty === EASY ? -5 : min(0, gbDiff[TO_HIT][soldierDifficultyLevel(s)]);
  if (s.flags & SOLDIER_GASSED) c -= 50;
  if (s.serviceCount > 0) c -= 20;                                      // being bandaged
  if (s.shock) c -= 5 * s.shock;
  let maxRange = 10;
  if (itemClass(item) === IC_GUN) {
    if (barrelExtender && modify) {                                     // Strac: only on real shots
      ext.status -= main(2);
      if (ext.status - main(35) - main(35) < 10) { dropExtenderToGround(); c -= 30; }
    }
    maxRange = gunRange(gun);
  }
  if (sight > 0) {
    if (wearing(SUNGOGGLES) && lightTrueLevel(g, s.targetLevel) < NORMAL_LIGHTLEVEL_DAY) sight -= idiv(range, 10);
    if (sniperScope && range > 60 && aim > 0 && !s.doBurst) {
      let sb = idiv(20*aim*(range - 60), 100);
      sb = idiv(sb * wsm(scopeStatus), 100);
      sight = max(sight - sb, 1);
    }
    if (laserScope || item === ROCKET_RIFLE || item === AUTO_ROCKET_RIFLE) {
      const ls = wsm(rocketRifle ? gun.gunStatus : laserStatus);
      c += ls > 50 ? idiv(20*(ls - 50), 50) : idiv(-20*(50 - ls), 50);
    }
  }
  if (aimPos === HEAD) c -= idiv(3*sight, 10); else if (aimPos === LEGS) c -= idiv(sight, 10);
  const rp = idiv((maxRange - 3*range) * 10, 170); if (rp < 0) c += rp;   // -40 at 2x range for a 13-tile pistol
  if (TANK(s) && idiv(range, 10) < 26) c -= 2*(26 - idiv(range, 10));
  if (sight === 0) c -= 80;                                             // firing blind
  else c += idiv(3*(90 - sight), 10);                                   // +3 per tile under 9 tiles, −3 per tile over
  if (s.level === 0) { if (s.targetLevel > 0) c -= 25; }
  else { if (s.targetLevel === 0) c += 15; c += ONROOF_BONUS*traitCount(s, ONROOF); }
  const t = whoIsThere(g, s.targetLevel);
  if (t) {
    switch (height(t.state)) {                                          // ubHeight (current), not ubEndHeight
      case CROUCH:
        if (TANK(s) && range < 120) c -= 13*idiv(120 - range, 10);
        else if (range > 76) c -= 20;                                   // 16 + 10*(20/3)
        else if (range > 16) c -= 3*idiv(range - 16, 10);
        break;
      case PRONE:
        if (TANK(s) && range < 120) c -= 25*idiv(120 - range, 10);
        else if (range > 16) c -= min(3*idiv(range - 16, 10), 40);
        break;
      case STAND:
        if (range <= 50 && eh === PRONE) {
          const a = aimPos === RANDOM || aimPos === GLAND ? TORSO : aimPos;   // HEAD 1, TORSO 2, LEGS 3
          c -= (5 - a - idiv(range, 10)) * 10;                          // can turn into a bonus at 4–5 tiles (quirk, keep)
        }
    }
    c -= min(idiv(t.tilesMoved*3, 2), 30);
    if (t.opp[s] === SEEN_CURRENTLY && !TANK(t) && s.bodyType === QUEENMONSTER) {   // "!(body != QUEEN)": dodge only vs the Queen (V bug, kept)
      let p = idiv(effAgi(t), 5) + 2*effExp(t);
      if (height(t.state) === CROUCH) p = idiv(p*2, 3); else if (height(t.state) === PRONE) p = idiv(p, 3);
      const b = idiv(effDex(s), 5) + 2*effExp(s);                        // halving branch is dead for the Queen
      if (p > b) c -= p - b;
    }
  } else if (TANK(s) && range < 120) c -= 25*idiv(120 - range, 10);
  if (c > 0 && s.life < s.lifeMax) {
    const p = idiv(c*2*(s.lifeMax - effectiveLife(s)), 3*s.lifeMax);   // effectiveLife = life + (max−life−bleeding)/2
    c -= idiv(p * (100 - 10*(effExp(s) - 1)), 100);
  }
  if (c > 0 && s.breath < 100) {
    const p = idiv(c*(100 - s.breath), 200);
    c -= idiv(p * (100 - (effDex(s) - 10)), 100);
  }
  if (range > maxRange) c = idiv(c, 2);
  if (sight > distVis*10) c = idiv(c, 2);
  return c < MIN ? (TANK(s) ? 0 : MIN) : min(c, MAX);                   // 1..99
}
```

Constants: `Weapons.h:103-129` (same-target 10, crouch ≤10, prone ≤20, firing down 15, SMG −5, dual −20, gassed −50,
getting aid −20, shock −5/pt, psycho 15, target crouched −20, prone −40, blind −80, firing up −25), `POINT_BLANK_RANGE
16`, `MIN_PRONE_RANGE 50`, `MIN_SCOPE_RANGE 60`, `NORMAL_RANGE 90`, `MIN_TANK_RANGE 120`, `MaxDistanceVisible() = 26`
(`OppList.cc:875`). `gbDiff[DIFF_ENEMY_TO_HIT_MOD] = {−10, −5, 0, 5, 10}` by `SoldierDifficultyLevel` 0..4
(`TacticalAI/AIMain.cc:53-61`, `AIUtils.cc:2068-2120`); guns apply only the negative part (`min(0, …)`), melee the full
value (§4.2). ja2-node computes the `CalcDifficultyModifier` behind `SoldierDifficultyLevel` at sector load (deviations
"Difficulty and progress in tactical"). `effectiveLife()` is `Soldier_Control.h:821`; `EffectiveStrength/Agility/ExpLevel/…`
are `SkillCheck.cc:14-118` (drunkenness, carried weight for agility, life for strength).

**Vanilla differences** (V `Weapons.c:2280-2800`): the injury term used `lifeMax − life + bandaged/2` (bandaging made it
worse; Strac uses `effectiveLife`); the barrel extender wore on every CTH evaluation (including UI and AI previews) with
`Random`; sun goggles always helped; the sniper scope also helped bursts. Strac and V share the Queen-only dodge.

## 3. Bullets (`Tactical/LOS.cc:2216-4241`, `Tactical/Bullets.cc`)

Units and fixed point are the LOS ones (`08` §1.1): `FIXEDPT` with 20 fractional bits, LOS cell = `(unit % 10) >> 1`.
The bullet reuses the LOS stepping, but its ray uses the **2D** distance and keeps going past the target tile until
something stops it or it leaves the world.

### 3.1 `FireBulletGivenTarget(firer, endX, endY, endZ, item, sHitBy, buckshot, fake)` (`:3196-3418`)

```ts
const startZ = calculateSoldierZPos(firer, FIRING_POS);          // 175/111/31 + body scaling + 256·level + land (docs/08 §1.2)
const sx = centerX(firer.gridNo), sy = centerY(firer.gridNo);     // f32 tile centre
const dx = f32(endX - sx), dy = f32(endY - sy), dz = f32(endZ - startZ);
let d2 = f32(hypot(dx, dy)), dist = trunc(d2);
if (d2 !== dist) { dist += 1; d2 = dist; }
const h0 = Math.atan2(dy, dx), v0 = Math.atan2(dz, f32(d2 * 2.56));   // double
let flags = 0, spreadIdx = 0, shots = 1, impact = weapon.impact;
flags |= monsterCalibre ? CREATURE_SPIT : throwingKnife ? KNIFE (| BLOODY) : item === ROCKET_LAUNCHER ? MISSILE
       : item === TANK_CANNON ? TANK_CANNON : item === ROCKET_RIFLE || item === AUTO_ROCKET_RIFLE ? SMALL_MISSILE
       : item === FLAMETHROWER ? (spreadIdx = 2, FLAME) : 0;
if (buckshot) {
  if (!fake) { shots = 9; if (sHitBy > 0) sHitBy = idiv(sHitBy, 2); if (duckbill) spreadIdx = 1;
               if (firer.target) firer.target.pelletsHitBy = 0; flags |= BUCKSHOT; }
  impact = idiv(impact, 4);
}
for (let k = 0; k < shots; k++) {
  const b = createBullet(firer, fake, flags);                     // 50 slots; failure aborts silently
  b.hitBy = sHitBy;
  const wallZ = 256 + 2 /*ROOF_HIT_ADJUSTMENT*/ + land(firer.gridNo);
  b.checkForRoof = startZ < wallZ ? endZ > startZ : endZ < startZ;   // V: only when the ray crosses 256
  if (k === 0) {
    if (sHitBy > 0) { b.incX = toFix(f32(dx / dist)); b.incY = toFix(f32(dy / dist)); b.incZ = toFix(f32(dz / dist)); adjH = h0; adjV = v0; }
    else [adjH, adjV] = calculateFiringIncrements(h0, v0, d2, b);   // §3.2, the miss deviation
  } else {                                                          // pellets 2..9: fixed spread around pellet 1
    b.hitBy = 0; calculateFiringIncrements(adjH + SPREAD[spreadIdx][k][0], adjV + SPREAD[spreadIdx][k][1], d2, b); b.hitBy = sHitBy;
  }
  b.horizAngle = k === 0 ? h0 : adjH + SPREAD[spreadIdx][k][0];     // pre-deviation angle (used by ResolveHitOnWall)
  b.aimed = k === 0 && firer.doBurst < 2;                           // burst rounds 2+ and pellets 2+ are "unaimed"
  if (b.flags & KNIFE) b.itemStatus = firer.inv[hand].status;
  b.x = toFix(sx) + b.incX; b.y = toFix(sy) + b.incY; b.z = toFix(startZ) + b.incZ;
  if (b.hitBy > 0) { b.x += idiv(toFix(dx) - b.incX*dist, 2); b.y += …; b.z += …; }   // centre the rounding remainder
  b.impact = impact; b.range = gunRange(firer.inv[hand]);
  b.targetGrid = idiv(trunc(endX), 10) + idiv(trunc(endY), 10) * 160;
  b.startCubesAbove = cubeOf(trunc(startZ) - landHU(firer.gridNo)); b.endCubesAbove = cubeOf(trunc(endZ) - landHU(b.targetGrid));
  b.distanceLimit = dist;
  if (fake) { const ctgt = fireBullet(b, true); removeBullet(b); return ctgt; }
  fireBullet(b, false);
}
```
`SPREAD` is `ddShotgunSpread[3][9][2]` (`:57-99`, radians): normal ±0.012 cross and ±0.008 diagonals; duckbill
horizontal 0, ±0.008, ±0.016, ±0.024, ±0.032; flamethrower ±0.12 / ±0.08. `b.horizAngle` is the bullet's unadjusted
`ddHorizAngle` before its own miss deviation (`:3362`): `h0` for bullet 1 even when it missed (quirk: corner tests use
the intended direction).

`FireBullet(b, fake)` (`:3136-3193`): set tile/cell/cube indices, `iLoop = 1`, `iImpactReduction = 0`, `sGridNo`. Fake →
`target = firer.CTGTTarget`, return `CalcChanceToGetThrough(b)`. Real → `target = firer.target`; `ubTilesPerUpdate =
hideBullets ? 4 : 1` (Strac option; V always 1); profile-holding player shooter with a living target → `usShotsFired++`;
`usClockTicksPerUpdate = throwingKnife ? 30 : bulletSpeed/10` ms; knife animation tile; **first `MoveBullet`
immediately**.

### 3.2 Miss deviation: `CalculateFiringIncrements(h, v, d2, b)` (`:3045-3133`)

```ts
const missedBy = -b.hitBy;
if (missedBy > 0) {
  const vertPct = pre(50);                                          // share of the miss that goes vertical, 0..49
  const av = Math.abs(v), D225 = 6.283*22.5/360, D45 = 6.283*45/360;
  const above = av < D225 ? 60 + trunc(20*av/D225) : av < D45 ? 80 - trunc(30*(av - D225)/D225) : 50;
  const MAX = 6.283*15/360, MIN = 6.283*22/360;                     // RADIANS_IN_CIRCLE is 6.283, not 2π
  const lim = min((d2/10)/200, MAX/2);
  const maxMiss = MAX - lim;
  const minMiss = min(MIN / (d2/10), maxMiss);                      // ≈22°/tiles: misses rarely clip the target
  const amount = (maxMiss - minMiss) * missedBy / 100 + minMiss;
  h += (pre(2) ? +1 : -1) * amount * (100 - vertPct) / 100;
  v += (pre(100) < above ? +1 : -1) * amount * vertPct / 100;
}
b.incX = toFix(f32(Math.cos(h))); b.incY = toFix(f32(Math.sin(h)));
b.incZ = toFix(f32(Math.sin(v) / Math.sin(3.1415926/2 - v) * 2.56));
return [h, v];
```
RNG per missed bullet: `pre(50)`, `pre(2)`, `pre(100)`. `sHitBy == 0` (roll equal to CTH: a hit) takes this path with no
draws and no deviation, i.e. angle-based increments. Misses step one world unit horizontally per step.

### 3.3 Time: when bullets move

`UpdateBullets` runs once per main-loop frame before `ExecuteOverhead` (`Bullets.cc:187-260`). `MoveBullet` returns
early unless `now − uiLastUpdate ≥ usClockTicksPerUpdate` (2–3 ms for guns, 30 for knives; `LOS.cc:3496-3504`), then
advances `ubTilesPerUpdate` tiles. At frame rates far below 300 Hz that is one tile per frame (≈16 ms at 60 fps), so
bullet flight time and burst overlap depend on the frame rate. ja2-node moves every live bullet one tile per 5 ms tick
at the start of the tick (after physics, before the soldier pass); the first tile moves inside `FireWeapon`; knives
move every 30 ms (6 ticks) (deviations "Bullet flight").

### 3.4 `MoveBullet(b)` per tile (`:3446-4241`)

```ts
do {                                                                // one tile per pass, ubTilesPerUpdate passes
  const g = b.tileX + b.tileY*160;
  if (!onVisibleWorldTile(g) || (b.cubesZ > 4*elev && fixInt(b.incZ) > 0)) { removeBullet(b); shotMiss(b); return; }
                                                                    // elev = 2, or 4 when the firer's tile has a height (Strac)
  const land = toFixInt(landHU(g)), wall = WALL + land, winLo = 87*FIX + land, winHi = 220*FIX + land;
  const cubeAbove = cubeOf(fixInt(b.z - land)), level = cubeAbove < 4 ? 0 : 1;
  let pHit = chanceOfBulletHittingStructure(b.loop, b.distanceLimit, b.hitBy);   // §3.5
  const intended = g === b.targetGrid; if (intended) pHit = 100;
  const local = []; let roof = null;
  for (const s of structures(g)) {                                  // insertion order; RNG draws in this order
    if (s.flags & ALWAYS_CONSIDER_HIT) {                            // WALLSTUFF | CAVEWALL | FENCE
      if (s.flags & ANYFENCE) {
        if (s.density < 100) { if (pre(100) < pHit) local.push(s); }
        else if (b.loop <= 25 && cubeAbove <= b.startCubesAbove && b.endCubesAbove >= cubeAbove && cubeAbove === height(s) - 1) { if (pre(100) < pHit) local.push(s); }
        else if (b.distanceLimit - b.loop <= 25 && cubeAbove <= b.endCubesAbove && cubeAbove === height(s) - 1) { if (pre(100) < pHit) local.push(s); }
        else local.push(s);
      } else local.push(s);
    } else if (s.flags & ROOF) {
      if (b.checkForRoof) { roof = s; if (crossed(b.z - b.incZ, b.z, wall)) { stopBullet(b); structureHit(b, NONE, 0, true); return; } }
    } else if (s.flags & PERSON) {
      const p = soldierOf(s);
      if (p !== b.firer) {
        if (intended) local.push(s);
        else if (b.firer.flags & MONSTER) { if (!(p.flags & MONSTER)) local.push(s); }
        else if (p.visible === 1 && endHeight(p.state) === STAND
                 && ((b.aimed && b.loop > 30) || (!b.aimed && b.loop > 15) || pre(100) < 3)) local.push(s);   // short-circuit
        if (p.team === OUR && b.firer.team !== OUR && level === p.level) p.closeCall = true;
        if (isMercBody(p) && (p.side !== b.firer.side || b.loop > 30)) addSuppression(b, p);       // 33 §3.1
      }
    } else if (s.flags & CORPSE) {
      if ((intended || s.tiles >= 10) && !findStructure(g, PERSON)) local.push(s);
    } else if (b.loop > 25 || intended) {                           // ordinary obstacles past CLOSE_TO_FIRER (2.5 tiles)
      if (pre(100) < pHit) local.push(s);
    }
  }
  if (adjacentSoldierCount(g) > 0 && cubeAbove < 8)                 // whizz-by on the 8 neighbours
    for (dir of 0..7) { const a = g + DIR_INC[dir];
      if (moveCost(a, dir, level) < BLOCKED) { const p = whoIsThere(a, level);
        if (p && isMercBody(p) && p.side !== b.firer.side) addSuppression(b, p); } }
  stepThroughTile(b, local, roof, intended);                        // below; may stop the bullet
  if (stopped) return;
  if (!onVisibleWorldTile(newTile) || (b.cubesZ > 4*elev && fixInt(b.incZ) > 0)) { removeBullet(b); shotMiss(b); return; }
  b.gridNo = newTile; tiles++;
  if (b.loop > 2*b.range) b.incZ -= idiv(100*FIX, 2*b.range);      // drop beyond twice the gun range
  else if ((b.flags & FLAME) && b.loop > b.range) b.incZ -= idiv(100*FIX, 2*b.range);
  if (b.firer.target && !(b.firer.flags & ATTACK_NOTICED) && pythSpacesAway(b.gridNo, b.targetGrid) <= 3) b.firer.flags |= ATTACK_NOTICED;
} while (tiles < b.tilesPerUpdate);
```
`addSuppression(b, p)` is the suppression-point award of `33` (buckshot `main(2)`, stance `pre(4)` rolls). The
person loop and the neighbour loop can both count the same soldier.

`stepThroughTile` (`:3841-4203`), the inner loop until the tile changes:
- **Ground:** `fixInt(b.z − land) < 0` → `StopBullet`, `StructureHit(NONE, 0, stopped)`.
- **Empty tile** (`local` empty, no roof): fast-forward to the next tile edge as LOS does (`08` §1.4); if that would
  go below the ground, advance `min(steps, |(z − land)/incZ|)` and stop on the ground. Missile/flame/spit trails every
  10/5/5 steps (`AddMissileTrail`, `Bullets.cc:296-353`) are for show: none for tank shells, nor for small missiles,
  flames and spit before step 5; once a trail falls in a stretch, the fast-forward's `fGoingOver` stays set for the
  rest of the `MoveBullet` call, so every later stretch of that call leaves one too. Each trail's frame delay is
  `100 + Random(100)` (100 for flames), a cosmetic draw the simulation leaves to the browser (`deviations.md` "Cosmetic
  draws in attacks"); it emits `missileTrail` (`29` §9).
- **Otherwise**, at each LOS cell / cube: cube ≥ 8 skips tests; cube 4–7 tests roof-level (`sCubeOffset` 4) structures
  with `cube − 4`. For each `local` structure of that level whose shape has the bit:
  - **person** → `BulletHitMerc(b, s, intended)` (`33`). Stopped → return; passed through → removed from `local`.
  - **window** (`WALLNWINDOW` with `winLo ≤ z ≤ winHi`) and `ResolveHitOnWall` says hit: a knife runs
    `HandleBulletStructureInteraction` and on ≤ 0 drops a (bloody) throwing knife on the near side and stops
    (`StructureHit(id, 1, true)`); a bullet breaks the window (`WindowHit`: swap to the cracked, then shattered partner
    structure; noise `WINDOW_CRACK/SMASH_VOLUME`) and **continues**; the window leaves `local`.
  - **anything else**, if `loop > 25 || ALWAYS_CONSIDER_HIT || intended`: walls (`WALLSTUFF`) pass at corners per
    `ResolveHitOnWall`; else `HandleBulletStructureInteraction` (§3.5). On a hit: a corpse (not for missiles, flame,
    spit) → `RemoveBullet`, `CorpseHit`, `FreeUpAttacker`, return; remaining impact ≤ 0 → `StopBullet`,
    `StructureHit(id, 1, true)`, return; else the first hit of this structure in this tile → `StructureHit(id, 1,
    false)` (sound, noise, damage) and mark it.
  - Step one unit at a time until the LOS cell or cube changes. With a roof structure on the tile, crossing the wall
    plane stops the bullet (`StructureHit(NONE)`).

### 3.5 Structures in the way

`ChanceOfBulletHittingStructure(loop, distToTarget, hitBy)` (`:2216-2245`): beyond 25 tiles 90; else
`pen = max(0, idiv(loop, 5) − (distToTarget − loop))` (cover close to the target is likelier to be hit); misses add
20 % to the distance (`loop += idiv(loop, 5)`); result `table[idiv(loop + pen, 10)]`, or 90 beyond index 25.
`table = [0,0,0,2,4,7,10,14,18,23,28,34,40,47,54,60,66,71,74,76,78,80,82,84,86,88]` (`:116-144`). The intended tile is
always 100. A structure that fails the per-tile roll is invisible to that bullet for the whole tile.

`HandleBulletStructureInteraction(b, s)` (`:2263-2376`), returns the remaining impact:
```ts
if (b.flags & (KNIFE | MISSILE | TANK_CANNON | FLAME)) return hit(0);
if ((b.flags & SMALL_MISSILE) && ammo === AMMO_HE) return hit(0);
if ((s.flags & (DOOR | OPENABLE)) && pythSpacesAway(b.targetGrid, s.gridNo) <= 2) {        // shooting a lock
  const door = doorAt(b.gridNo);
  if (door && lock.pickDifficulty < 50 && lock.smashDifficulty < 70 && pre(2) === 0) {
    let dmg = i16(b.impact - b.impactReduction); dmg += pre(dmg);                          // negative dmg: UINT32 wrap
    if (door.damageLock(dmg)) statChange(firer, MARKAMT, 10, SUCCESS);
  }
}
if (pre(100) < s.density) {
  let red = MATERIAL_ARMOUR[s.armour];
  red = idiv(red * (100 + idiv(25 * (b.loop - b.range), b.range)), 100);   // StructureResistanceIncreasedByRange; <range lowers it
  red = ammo === HP ? red*2 : ammo === AP || ammo === HEAT ? idiv(red*3, 4) : ammo === SUPER_AP ? idiv(red, 2) : red;
  b.impactReduction += red;
  if (s.armour === MATERIAL_LIGHT_VEGETATION) return pass(1);            // grass never stops a bullet
  return hit(b.impact - b.impactReduction);
}
return pass(1);
```
`MATERIAL_ARMOUR` (`Structure.cc:119-149`; `data/tables/material-armour.json`, indexed by the JSD `armour`): timber 25,
plywood 20, live wood 30, light vegetation 3, upholstery 10, porcelain 47, cactus/hay 10, stone 55, concrete 63,
reinforced 70, rock 85, rubber 9, sand 40, cloth 1, sandbag 40, light metal 37, thick metal 57, heavy metal 85,
indestructible 127.

`StructureHit(b, id, impact, stopped)` (`Weapons.cc:1565-1821`): if stopped and the firer has an `opponent`, that
opponent gets the dodge agility gain (`33`); for wall-oriented structures the noise/explosion tile moves to the
shooter's side; unless the same structure was hit last,
`MakeNoise(firer, tile, level, hitVolume, NOISE_BULLET_IMPACT)`; LAW → remove, `FreeUpAttacker`, `IgniteExplosion(C1)`; tank cannon → `TANK_SHELL`; a real
structure → `DamageStructure(GUNFIRE)`: indestructible materials ignore it, an `EXPLOSIVE` structure explodes on
**`main(2)`**, otherwise no hit points are lost (`TileEngine/Structure.cc:1150-1212`). Guns: player-team single shots
curse on `main(40) == 0` (cosmetic, §6.3). A stopped bullet then plays a miss animation (`FIRSTMISS1`, 80 ms/frame;
water adds a ripple) with `ANITILE_RELEASE_ATTACKER_WHEN_DONE`; **`RemoveBullet` + `FreeUpAttacker` happen when that
animation ends** (`TileEngine/Tile_Animation.cc:238-246`). `FIRSTMISS1` has 5 frames
(`TileEngine/TileDat.cc:567-576, 620-623`); the tile steps when more than 80 ms have passed since the last step
(strict, `Tile_Animation.cc:140, 267-282`) and the fifth step deletes it, so on 5 ms ticks the release comes 5 × 85 ms
= 425 ms after the stop (ja2-node uses 425 ms everywhere, also for a splash in water, deviations "Miss animation in
water"). HE/HEAT ammo plays a mini-explosion and frees at once; hitting the same structure twice frees at once. Knives
that hit the ground become a `THROWING_KNIFE` item.

`onVisibleWorldTile` is `GridNoOnVisibleWorldTile` on the loaded map's render bounds (`07` §2.5): in a basement a
missed bullet leaves the world at the edge of the basement's visible area. `ShotMiss(b)` (bullet left the world,
`Weapons.cc:3170-3212`): dodge agility gain to `opponent`, curse `main(40)`
(cosmetic), sound, `FreeUpAttacker`. `RemoveBullet` decrements `firer.bBulletsLeft` for real bullets
(`Bullets.cc:130-170`); `FreeUpAttacker` lowers the busy count only once `bBulletsLeft` is 0 and the firer holds a gun
(`Overhead.cc:5529-5537`), so the attack's own busy +1 is released by the **last** bullet of the attack, whatever ended
it.

### 3.6 Chance to get through (`CalcChanceToGetThrough`, `:2432-2882`)

A fake bullet (`FireBulletGivenTarget(fake=TRUE)`, `sHitBy` 0, buckshot only lowers the impact) walks the same path
without RNG. It returns 0 on ground, roof crossing, leaving the map, or when the accumulated reduction reaches the
impact; otherwise `100·(impact − reduction)/impact`. Per tile it lists walls/fences (fences weighted by the
structure-hit chance as in §3.4, else 100), the roof, visible persons other than firer/target (100 if standing and
beyond 30/15 units, else 3), corpses, and other obstacles beyond 25 units weighted by
`ChanceOfBulletHittingStructure(loop, limit, 0)` (100 in the target tile). Each cell hit counts; at the end of the tile
`reduction += min(CTGTInteraction(s) · timesHit, impact) · weight / 100`, where `CTGTInteraction = idiv(MATERIAL_ARMOUR
· density, 100)` scaled by range and ammo as in §3.5 (HEAT not included in the AP case, `:2414-2427`), and the full
impact for knives/missiles. Reaching the target person returns at once. Beyond `2·range` the ray drops like a real
bullet. Callers: `SoldierToSoldierBodyPartChanceToGetThrough` (target body-part Z), `SoldierToSoldierChanceToGetThrough`
(`TARGET_POS`), `SoldierToLocationChanceToGetThrough`, and the `AI*` variants that fake a standing shooter
(`:2888-3042`). Non-gun items are measured as a `GLOCK_17` (`:3421-3443`).

## 4. Melee: knife, punch, steal

### 4.1 Flow

1. **Order** (`Handle_Items.cc:435-497` punch, `:792-842` blade). Adjacent tile: punches first try a neighbour from
   which the target is directly reachable, else `FindAdjacentGridEx`; blades use `FindAdjacentGridEx` (bloodcats and
   distant creatures: `FindNextToAdjacentGridEx`). Not adjacent → pending action (`MERC_PUNCH`/`MERC_KNIFEATTACK`),
   walk there first, attack on arrival (in ja2-node the AI does; the agent `attack` order refuses a target that needs
   a walk, gaps "Melee without walking"). **No AP check here**; UI and AI check affordability
   (`CalcTotalAPsToAttack`, §1.5, which includes the walk). Queen tentacles (`IC_TENTACLES`) pay at order time and play
   `QUEEN_SWIPE` (`:844-853`; damage at opcode 755 → `DishoutQueenSwipeDamage`, `Weapons.cc:3815-3867`).
2. **Begin**: `EVENT_SoldierBeginBladeAttack` (`Soldier_Control.cc:6574-6716`) / `EVENT_SoldierBeginPunchAttack`
   (`:6720-6836`): busy +1; snap direction (no turning steps; the turn still charges `AP_LOOK_*` through
   `EVENT_SetSoldierDesiredDirection`).
   - Blade: target standing or crouched and unaware of the attacker (`opp == NOT_HEARD_OR_SEEN`, other team) → `STAB`;
     aware → **`CoinToss()` (main)** `STAB`/`SLICE`, and the target is stopped (`EVENT_StopMerc`, AI
     `CancelAIAction`) and turned toward the attacker; target prone → crouch first, `CROUCH_STAB`; empty tile →
     `DECAPITATE` on a valid corpse, else `CROUCH_STAB`. Monsters/bloodcats have their own states.
   - Punch: martial artists (not with a crowbar) → `NINJA_GOTOBREATH`, then `DoNinjaAttack`; else target standing or
     crouched → `PUNCH` (crowbar: `CROWBAR_ATTACK`), and an **unaware** target is stopped and turned (the opposite of
     the blade rule; quirk, keep); target prone → `PUNCH_LOW` after crouching (civilian bodies just `PUNCH`).
   - Both set `sTargetGridNo`, `bTargetLevel = bLevel`, `target`; punch also sets `sLastTarget`.
   - ja2-node has no `DECAPITATE` (an empty tile gets `STAB`/`CROUCH_STAB`), no `NINJA_*` states (martial artists punch
     with `PUNCH`/`PUNCH_LOW` and keep their trait bonuses) and no stealing (gaps "Melee specials"); a prone
     attacker who turns is not laid down again mid-attack (deviations "Melee from a prone turn").
3. **Animation** (`Ja2bin.dat`): `STAB`/`SLICE` 70 ms: `757 [0-6] 727 492 [7-8] 430 [9-14] 442 → KNIFE_GOTOBREATH`
   (`[0-3] 442 753 → KNIFE_BREATH`); `CROUCH_STAB` `757 … 492 … 430 … 753 442 499`; `PUNCH` 70 ms `757 [0-5] 727 492
   [6-8] 430 [9-15] 753 442 468`; `PUNCH_LOW` has no dodge; `NINJA_PUNCH`/`_LOWKICK`/`_SPINKICK` 50–70 ms with 492 a few
   frames before 430 (spin kick: 430 on frame 34, no dodge); `CROWBAR_ATTACK` 430 on frame 9. **492**
   (`Soldier_Ani.cc:1515-1551`): the soldier on `sTargetGridNo`, if a merc body that sees the attacker (or is a
   team-mate) and is standing, is stopped (AI action cancelled), turned and put into `DODGE_ONE` (purely visual; the
   outcome is not decided yet). **430** → `FireWeapon` → `UseBlade` / `UseHandToHand`. **468** end of punch (NPC
   approach triggers, back to the breath/standing state).
4. **Resolution at 430** (§4.3, §4.4). A hit is delivered by `AddGameEvent(EV_S_WEAPONHIT, 20 ms)`: `WeaponHit` →
   `EVENT_SoldierGotHit` runs **> 20 ms later** (first 5 ms tick with `now − stamp > 20`, i.e. 25 ms). A miss calls
   `FreeUpAttacker` at once.

### 4.2 `CalcChanceHTH(att, def, aim, mode)` (`Weapons.cc:3215-3487`)

```ts
if (weapon !== QUEEN_TENTACLES && (def.life < OKLIFE || def.breath < OKBREATH)) return 100;
if (mode === STAB ? weaponClass(weapon) !== KNIFE : !(itemClass(weapon) & (IC_NONE | IC_PUNCH))) return 0;   // safety
let a = mode === STEAL ? effDex(att) + effAgi(att) + 3*att.strength + 10*effExp(att)
                       : 3*effDex(att) + effAgi(att) + att.strength + 10*effExp(att);
a = idiv(a, 6);
if (psycho(att)) a += 15;
a += moraleModifier(att);
a -= idiv(idiv(a * fatiguePercent(att), 100), 2);
if (aim) a += idiv(10*aim, 2);                                      // half the gun aim bonus
if (!(att.flags & PC)) a += gbDiff[TO_HIT][soldierDifficultyLevel(att)];   // full value: can be +5/+10 (guns use min(0, …))
if (att.flags & GASSED) a -= 50; if (att.serviceCount > 0) a -= 20; if (att.shock) a -= 5*att.shock;
if (a > 0 && att.life < att.lifeMax) a -= idiv(2*a*(att.lifeMax - effectiveLife(att)), 3*att.lifeMax);
if (a > 0 && att.breath < 100) a -= idiv(a*(100 - att.breath), 200);
if (att.profile !== NO_PROFILE) a += mode === STAB ? KNIFING_BONUS*traits(att, KNIFING)
                                                  : MARTIAL_BONUS*traits(att, MARTIALARTS) + HTH_BONUS*traits(att, HANDTOHAND);
a = max(a, 1);
let d = mode === STEAL ? effAgi(def) + effDex(def) + 3*def.strength + 10*effExp(def)
                       : 3*effAgi(def) + effDex(def) + def.strength + 10*effExp(def);
d = idiv(d, 6);
d += moraleModifier(def);
d -= idiv(idiv(d * fatiguePercent(def), 100), 2);
if (def.flags & GASSED) d -= 50; if (def.serviceCount > 0) d -= 20; if (def.shock) d -= 5*def.shock;
if (d > 0 && def.life < def.lifeMax) d -= idiv(2*d*(def.lifeMax - effectiveLife(def)), 3*def.lifeMax);
if (d > 0 && def.breath < 100) d -= idiv(d*(100 - def.breath), 200);
if (weapon === QUEEN_TENTACLES && def.body ∈ {LARVAE, INFANT}) d += 10000;
if (endHeight(def.state) < STAND) d += weapon === QUEEN_TENTACLES ? (endHeight === PRONE ? 1000 : 40) : (endHeight === PRONE ? -40 : -20);
if (def.profile !== NO_PROFILE) {                                   // parry/dodge traits
  if (mode === STAB) d += handIsBlade(def) ? KNIFING*k + idiv(MARTIAL*m, 3) : idiv(KNIFING*k, 3) + idiv(MARTIAL*m, 2);
  else d += handIsBlade(def) && mode !== STEAL ? idiv(KNIFING*k, 2) : MARTIAL*m + HTH*h;
}
d = max(d, 1);
let c = mode === STEAL ? idiv(50*a, d) : 67 + idiv(a - d, 3) - (att.aimShotLocation === HEAD ? 20 : 0);
return clamp(c, MIN, MAX);                                          // 1..99
```
`gbSkillTraitBonus` values come from `Soldier_Profile` data (not re-derived here). `BAD_DODGE_POSITION_PENALTY 20`.
`CalcChanceToStab/Punch/Steal` are the three modes (`:3489-3503`).

### 4.3 `UseBlade` (`Weapons.cc:896-1035`)

```ts
deductPoints(s, calcTotalAPsToAttack(s, grid, false, s.aimTime), 0);   // APs paid at the strike frame
const t = whoIsThere(grid, s.targetLevel);                          // whoever is on the tile NOW
if (!t) { freeUpAttacker(s); goto smell; }
s.flags |= ATTACK_NOTICED; t.intendedTarget = true; s.opponent = t;
const surprise = t.opp[s] === NOT_HEARD_OR_SEEN || t.life < OKLIFE || t.collapsed;
const cth = surprise ? 100 : calcChanceToStab(s, t, s.aimTime);
const roll = pre(100);
if (roll <= cth) {
  let imp = hthImpact(s, t, cth - roll, blade = true);              // §4.5
  imp = idiv(imp * wsm(blade.status), 100);
  imp = adjustImpactByHitLocation(imp, s.aimShotLocation).dmg;      // head ×1.5, legs ×¼
  if (surprise) imp = idiv(imp*3, 2);
  imp = max(imp, 1);
  if (blade.status > 10) { const adj = idiv(blade.status, 10); const maxDrop = adj > 2 ? clamp(idiv(imp, 20), 2, adj) : 2;
                           blade.status -= i8(main(maxDrop)); }      // dulling
  addGameEvent(WEAPONHIT{ target: t, weapon, damage: i16(imp), breathLoss: 0, dir: dirFromGrid(s.gridNo, t),
                          x: t.x, y: t.y, z: 20, range: 1, attacker: s, special: NO_SPECIAL }, 20);
} else { agilityForEnemyMissingPlayer(s, t, 10); freeUpAttacker(s); }
if (ourTeam(s) && s.target) statChange(s, DEXTAMT, modifyExpGainByTarget(knifeXp(cth, hit), s.target), hit ? SUCCESS : FAILURE);   // 33 §5
smell: if (s.monsterSmell > 0 && main(5) === 0) s.monsterSmell--;
```

### 4.4 `UseHandToHand(s, grid, steal)` (`Weapons.cc:1041-1265`)

```ts
if (!steal) deductPoints(s, calcTotalAPsToAttack(s, grid, false, s.aimTime), 0);   // steal paid elsewhere
const t = whoIsThere(grid, s.targetLevel); if (!t) goto smell;      // NB: no FreeUpAttacker on an empty tile (inferred: the 753 balances only 757)
s.flags |= ATTACK_NOTICED; t.intendedTarget = true; s.opponent = t;
let cth;
if (steal) cth = robot|tank|creature(t) ? 0 : t.opp[s] === NOT_HEARD_OR_SEEN ? calcChanceToSteal(s, t, aim) + 20
               : t.life < OKLIFE || t.collapsed ? 100 : calcChanceToSteal(s, t, aim);
else cth = t.opp[s] === NOT_HEARD_OR_SEEN || t.life < OKLIFE || t.collapsed ? 100 : calcChanceToPunch(s, t, aim);
let roll = pre(100);
if (steal) {
  if (t.inv[HAND]) {
    if (roll <= cth) { XP STR 8; if (roll <= idiv(cth*2, 3)) take item (or drop on own tile if no room);
                       else { curse; pre(100) < cth ? drop on attacker's tile : drop on target's tile; } }
    else { message; curse; if (cth > 0) XP STR 4 FAILURE; }
  }
  freeUpAttacker(s);
} else {
  if (s.state === NINJA_SPINKICK) roll = pre(cth);                  // a second draw: the spin kick always hits
  if (s.team === OUR && t.team !== OUR) { xp = roll <= cth ? 8 : 4; xp = modifyExpGainByTarget(xp, t);
                                          statChange(STRAMT, xp); statChange(DEXTAMT, xp); }
  else if (roll > cth) agilityForEnemyMissingPlayer(s, t, 8);
  if (roll <= cth || inMeanwhile) {
    let imp = hthImpact(s, t, cth - roll, blade = false);
    imp = adjustImpactByHitLocation(imp, s.aimShotLocation).dmg;    // Strac only (V: none); scales breath and life alike
    imp = max(imp, 1);
    addGameEvent(WEAPONHIT{ …, damage: i16(imp), breathLoss: 0, range: 1, special: NO_SPECIAL }, 20);
  } else freeUpAttacker(s);
}
smell: if (s.monsterSmell > 0 && main(5) === 0) s.monsterSmell--;
```
For punches `EVENT_SoldierGotHit` turns the damage into breath loss with ¼ as real damage (`PUNCH_REAL_DAMAGE_PORTION
4`, `Soldier_Control.cc:2744`, `33`).

### 4.5 `HTHImpact(att, tgt, hitBy, blade)` (`Weapons.cc:3119-3167`)

```ts
let imp = idiv(effExp(att), 2);
const str = effStrength(att);                                       // half strength + half scaled by effective life
if (blade) { imp += idiv(str, 20) + weaponImpact(att.attackingWeapon); if (robot(tgt)) imp = idiv(imp, 4); }
else {
  imp += idiv(str, 5);
  if (att.attackingWeapon && !hasTrait(att, MARTIALARTS)) { imp += weaponImpact(weapon); if (robot(tgt)) imp = idiv(imp, 2); }  // knuckles 12, crowbar 25
  else { imp += 5; if (robot(tgt)) imp = 0; }
}
const fluke = pre(51) - 25;
imp = idiv(imp * (100 + fluke + idiv(hitBy, 2)), 100);
if (!blade) {
  if (hasTrait(att, MARTIALARTS)) { imp = idiv(imp * (100 + MARTIAL_BONUS*traits(att, MARTIALARTS)), 100); if (att.state === NINJA_SPINKICK) imp *= 2; }
  imp = idiv(imp * (100 + 3*HTH_BONUS*traits(att, HANDTOHAND)), 100);
}
return imp;
```

RNG per melee strike, in order:
- Blade: `CoinToss` (aware target, at begin) → `pre(100)` hit roll → hit: `pre(51)` fluke, `main(maxDrop)` dulling /
  miss: agility `StatChange` (player defender) → DEX `StatChange` (player attacker) → `main(5)` smell.
- Punch: `pre(100)` → [spin kick `pre(cth)`] → STR+DEX `StatChange` (player attacker) or agility `StatChange` (player
  defender, miss) → hit: `pre(51)` fluke → `main(5)`.
- Steal: `pre(100)` → [STR `StatChange`] → [partial success `pre(100)` drop place] → `main(5)`.
- Then, 20 ms later, `EVENT_SoldierGotHit` (`33`).

Quirk: `EVENT_SoldierBeginPunchAttack` raises the busy count and returns if nobody is on the target tile, and
`UseHandToHand` with an empty tile frees nothing (`Soldier_Control.cc:6731-6739`, `Weapons.cc:1058-1258`), so a punch at
a soldier who stepped away leaks one busy count until the 25 s UI watchdog (inferred). ja2-node releases the hold at
once (deviations "Melee hold leaks").

## 5. RNG order, end to end: one aimed shot that kills

A player merc in combat (a profile, so the jam test and `StatChange` draw) fires one aimed round at a visible enemy on
the ground; the bullet crosses one tile with a bush and a crouched bystander, hits the torso, the enemy falls forward
and dies. Brackets mark conditional draws, (c) the cosmetic draws ja2-node does not make (§6.3). The cited sections
give the conditions.

| When | Draws, in order |
|---|---|
| order (`HandleItem`) | AI shooters: [`main(50)` civ quote (c)]; `HandItemWorks`: `main(80)` [+ `main(9)` on breaking] per damageable item tested (the main gun, then a second gun); [PSYCHO, burst-capable, not bursting: `main(3 + aim)`] (§1.3) |
| fire state entered (`SelectFireAnimation`, standing single shot) | [`pre(100)` body part if `AIM_SHOT_RANDOM` and a soldier on the tile] (§1.8) |
| opcode 470 | `CheckForGunJam`: `pre(100)`, `pre(100)`; jammed gun: `SkillCheck` `pre(100)` [+ `main(100)` (c)] (§1.7) |
| opcode 430 → `UseGun` | [`pre(100)` body part if still random]; [barrel extender `main(2)`, `main(35)`, `main(35)`]; **`pre(100)` hit roll**; MARK `StatChange`: one `pre(100)` per chance (`33`); [LAW `pre(40)`, `pre(40)`, [`pre(2)`]]; `FireBulletGivenTarget`: [miss: `pre(50)`, `pre(2)`, `pre(100)`] (§3.2); first `MoveBullet` (below); wear `pre(15 + 3·reliability)`; [`main(2)` monster smell] |
| each tile entered | structures in list order: fences/obstacles [`pre(100)` vs `ChanceOfBulletHittingStructure`]; persons [`pre(100) < 3` accidental test, short-circuited]; suppression award per person and then per neighbour in direction order 0–7 [buckshot `main(2)`] [`pre(4)` ×0–2 by stance] (§3.4, `33`) |
| inside the tile | per structure hit: [lock `pre(2)`, `pre(dmg)`]; density `pre(100)`; [explosive structure `main(2)`]; [stopped: curse `main(40)` (c) (player, single shot)]; [stopped, or left the map in `ShotMiss`: agility `StatChange` `pre`×n for the shooter's `opponent`] (§3.5, `33`) |
| `BulletHitMerc` | [adult monster gland `pre(100)`]; [spit: goggles `pre(100)` ×≤2]; `BulletImpact`: `pre(51)` fluke, armour `pre(100)` per piece (plates, vest), [`main(10)` instant kill], [head `pre(22)` / legs `pre(10)`], [knife stealth `pre(100)` + `main(10)`], [critical `pre(crit/2 + 5·aim)`, `pre(crit/2)`, torso `preChance(50)`] (`33`); [spit in the face: goggles `main(impact/2)`; head: slot `main(2)`, then `main(impact/2)` if it holds an item]; [touchy neutral `main(100)`]; [pass-through `pre(100)` + armour `pre(100)` per piece; blood behind the target: decay `main(3)`, graphic `main(4)` (c)] (`33`) |
| `EVENT_SoldierGotHit` | [sleep dart `pre(100)`]; `SoldierTakeDamage`: [blast equipment `pre` per item], [unprofiled bleed `main(2)`], **`main(100)` weapon drop** (every non-bleed hit on a non-robot), [blood: decay `main(3)`, graphic `main(4)` (c)], [EXPLODE `StatChange` `pre`×n for our attacker of a blast], [EXPER `StatChange` `pre`×n for our victim] (`33`); cosmetic impact and grunt sounds; animation choice: [civilian `CIV_DIE2` `main(2)`]; entering the hit state: [`main(10)` start index of `CHARIOTS_OF_FIRE`/`BODYEXPLODING`], [`main(50)` fall side of a leg fall-down through `SoldierCollapse` or a blast fall forward], **opcode 478 `main(100)` [+ `main(50)`]** (`33`) |
| hit animation frames | **433 `main(100)` [+ `main(50)` fall side]**; release curse [`main(10)` (c)]; 447 none (`33`) |
| opcode 440 (`HandleSoldierDeath`) | [visible victim: `main(3)` laugh (c)]; kill/assist EXPER `StatChange` `pre`×n; [Pablo: `Random(60)` for his event]; corpse: ammo `1 + main(n)` per non-player ammo stack, in slot order (`33`) |
| barrier reaches 0 | `HandleSuppressionFire` none; [dart: `NoticeUnseenAttacker` `pre(100)` [+ `main(100)` (c)]]; `HandleAnyStatChangesAfterAttack`: `main(100) < 25` message per changed stat (c); quotes (`HandleKilledQuote`, battle sounds) may draw `main` (not traced) (`33`) |
| team turn start | [getting up: sleep-drug `pre(100)`] (`33`) |
| turn end | `SayCloseCallQuotes`: `main(3)` per eligible merc (`33`) |

Bursts repeat the 430 row per round (jam only on round 1, XP only on round 2). `UseBlade`, `UseHandToHand` and
`UseThrown` likewise draw their `StatChange` rolls right after their own hit roll. Melee: §4.5. Throws and launchers:
`34` §12.

---

## 6. Implementation in ja2-node

### 6.1 State and modules

Paths are under `src/sim/tactical/`. The soldier (`soldier.ts`) keeps the original's attack and hit fields under their
names without the type prefix (`bBulletsLeft` → `bulletsLeft`). `TacticalState` (`state.ts`) holds the attack busy
count `turn.attackBusyCount` (`turns/turn-state.ts`), the live `bullets`, the pending miss releases `missAnimations`
and the queued `gameEvents`.

Content: weapons, ammo types, armours and explosives from `data/externalized/*.json` through `content/items/items.ts`
(`12` §1); structure armour and density from the JSD (`content/formats/jsd.ts`) and `data/tables/material-armour.json`;
animation scripts from the user's `binarydata/ja2bin.dat` (`content/formats/ja2bin.ts`, `content/anim/timelines.ts`),
speeds and flags from `data/tables/anim-control.json`. The stub pack builds its own scripts with the same gameplay
opcodes and shorter frame counts (`stubs/anim-scripts.ts`, `32` §1.6).

| Module | Implements |
|---|---|
| `combat/attack.ts` | `HandleItem` with its gun, throw and launcher branches, `HandItemWorks`, ready and turn rules, `SelectFireAnimation`, `EVENT_FireSoldierWeapon`, `CheckForGunJam`, `GetTargetWorldPositions`, `FireWeapon`, `UseGun`, the fire opcodes 430, 441, 448, 449, 458, 459, 470, 473, 476, 477, 753, 757 (§1) |
| `combat/ap.ts` | attack AP costs, `MinAPsToThrow`, `EnoughAmmo` (§1.5, `34` §2) |
| `combat/chance.ts` | `CalcChanceToHitGun`, `AICalcChanceToHitGun`, `GunRange`, `SoldierDifficultyLevel` (§2) |
| `combat/positions.ts` | soldier and target Z, body-part LOS over `perception/los.ts` (§1.8, `08`) |
| `combat/bullets.ts` | `FireBulletGivenTarget`, `MoveBullet`, structure hits, `ShotMiss`, the miss-animation release, the chance to get through (§3) |
| `combat/impact.ts`, `combat/armour.ts` | `BulletImpact`, `AdjustImpactByHitLocation`; armour, body impact reduction, `ArmourPercent` (`33`) |
| `combat/melee.ts`, `combat/melee-reach.ts` | melee orders and begin events, `CalcChanceHTH`, `UseBlade`, `UseHandToHand`, `HTHImpact`, opcodes 468, 492, 755, 761; the adjacent-tile searches (§4) |
| `combat/barrier.ts` | the busy-count entry points, `HandleSuppressionFire`, `NoticeUnseenAttacker`, the end of an attack (`33`) |
| `combat/experience.ts`, `combat/skill-check.ts` | `StatChange`, `ProcessUpdateStats`, `ModifyExpGainByTarget`, `AgilityForEnemyMissingPlayer`; `SkillCheck` (§1.7, `33`) |
| `combat/spread-burst.ts` | the AI's spread-burst locations (`sSpreadLocations`) |
| `combat/context.ts` | `CombatContext`, the narrow state `bulletImpact`, `hthImpact` and `statChange` need, so autoresolve reuses them (`AUTORESOLVE_IMPACT`, `19`) |
| `skills.ts`, `points.ts` | effective stats, `moraleModifier`, fatigue penalties; `DeductPoints`, `CalcNewActionPoints` |
| `game-events.ts` | the event pump: `beginFireWeapon`, `fireWeapon`, `desiredDirection` and the delayed `weaponHit` (§1.2, §4.1) |
| `explosions/throwing.ts` | `UseThrown`, `UseLauncher`, `CalcThrownChanceToHit`, `CalcMaxTossRange`, `WillExplosiveWeaponFail`, the release opcodes 460/461 (§1.7, `34` §1–4, §7, §8) |

The modules of hits, damage, death, bleeding and morale are listed in `33`; those of throw trajectories, physics,
catches and tosses in `34`.

The agent API (the `attack` order, `estimateAttack`, the events `shotFired`, `bulletStopped`, `bulletImpact`,
`soldierHit`, `soldierDied`, `attackResolved` and others) is `29`; the attack hint (`sim/hints/estimate-attack.ts`)
calls `calcChanceToHitGun` with `fModify = FALSE` on the player's view (`28` §2.4).

### 6.2 Tick order and timers

Each 5 ms tick (`tactical-sim.ts`, `overheadHooks`) runs, before the soldier pass: physics (`stepThrownObjects`, every
20 ms), bullets (`updateBullets`), explosions (`stepExplosions`, `12` §10), action items and AI pauses, miss-animation
releases (`updateMissAnimations`), skull releases (`updateSkullReleases`), the real-time turn (`handleRealtimeTurns`);
then the soldier pass (`overhead.ts`: animation opcodes, `updateDamageDisplay`); then `dequeueAllGameEvents`. This is
the original frame order (`GameScreen.cc:343, 424, 427, 456`) on a fixed tick (deviations "Game events").

Every timer runs on game ms: bullets one tile per tick, knives every 30 ms (§3.3); the miss-animation release 425 ms
(§3.5); the delayed melee hit on the first tick more than 20 ms later, i.e. at 25 ms (§4.1); the damage window
8 × 250 ms (`33`); our dead merc's release 1920 ms after 440 (`33`); physics every 20 ms (`34` §9.2).
There are no watchdogs: holds the original leaves to its 15 s or 25 s breaker are released where they arise
(deviations "Watchdogs", "Melee hold leaks", "Hit during a non-interruptible animation", "Knock-back and the sighting
pause", "Melee from a prone turn", "Suppression stance change from the end of the previous one").

### 6.3 Randomness

Gameplay draws keep the original order on both streams (`src/core/rng.ts`, `01` §3.6). Not drawn (deviations
"Cosmetic draws in attacks"): the curses `main(10)` on the release from a hit and `main(40)` on a stopped or missed
single shot, the laugh `main(3)`, the blood-pool graphic `main(4)`, the stat-change message `main(100) < 25`, the
silent skill-check curse `main(100) < 40`, the missile-trail frame delay `main(100)`, battle and impact sounds; also
the AI's civ quote `main(50)` before `HandleItem` (§1.3). Kept on `main`: `HandItemWorks`, the psycho burst, the barrel
extender, monster smell, `CoinToss` for stab or slice, blade dulling, the instant-kill bonus, head-gear damage, the
touchy neutral, explosive structures, the weapon drop, the blood decay `main(3)`, `CIV_DIE2`, the burning and exploding
start frame, the fall side, opcodes 433 and 478, corpse ammo, the close-call quote. The mortar smoke-trail delay is a
cosmetic draw on `pre` in the original and stays there (`34` §9.4). Unsequenced pairs (the dud test) are drawn left
to right (deviations "Dud test operand order").

### 6.4 Not ported

- `HandleItem` refusals and the rocket-rifle imprint check (deviations "Attack refusals").
- Martial-arts `NINJA_*` states, decapitation and stealing (gaps "Melee specials"); agent melee orders need the
  attacker adjacent (gaps "Melee without walking").
- The fade before the delay 0 of unseen soldiers (gaps "Unseen soldiers in combat").

### 6.5 Verification

The oracle probes `cth` (chance to hit, AP cost and chance to get through per aim level), `bestshot`, `stab`,
`beststab` and `pcattack` compare ja2-node with the native build, also over the user's saves (`save-probes.ts`;
`tools/oracle/README.md`). Unit tests next to the code (`combat/*.test.ts`, `explosions/*.test.ts`) check bullets,
impact, hit and death animations, physics and the barrier against this doc, `33` and `34`; the stub campaign bot
(`tools/campaign-bot`) exercises them and found two of the hold leaks of §6.2.

## 7. Open points

- Vehicles, boxing, Meanwhile (Elliot) and Queen branches are listed, not specified in detail.
