<!-- Attacks and damage in JA2 (Stracciatella): guns, bullets, hit resolution, death, melee, throws and launchers,
suppression, morale and experience from attacks. An implementable spec for M3. 2026-10-15.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–09, 12, 13), cross-checked against vanilla
(reference/vanilla/ja2/Build). Read-only research: nothing was built. Animation scripts were read from a Steam 1.12
Ja2bin.dat with tools/spikes/ja2bin-timelines.py and a throw-away dumper (opcode positions and frame counts are quoted;
the data itself is not committed). Four research passes (guns and bullets; hit and death; throws and launchers;
suppression, morale and experience) were merged and spot-checked against the code. -->

# 11 — Attacks and damage

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless marked V (vanilla `Build/`).
"(inferred)" marks conclusions not traced end to end. C integer semantics apply everywhere: `/` truncates toward zero
(`idiv` in `src/core/int.ts`), `%` keeps the dividend's sign, `INT8`/`UINT8`/`INT16` stores wrap (`i8`, `u8`, `i16`).
`f32(x)` = `Math.fround(x)`; `trunc` = `Math.trunc`. `wsm(x)` = `WEAPON_STATUS_MOD` (§1.1).

**RNG.** `pre(n)` = `PreRandom(n)` (stream `pre`), `main(n)` = `Random(n)` (stream `main`), `preChance(p)` =
`pre(100) < p`, `CoinToss()` draws `main`. `n = 0` returns 0 and **draws nothing** (`sgp/Random.cc:62-83`; our
`Rng.int(0)` matches). The C parameter is `UINT32`, so a negative `INT32` argument wraps: pass `n >>> 0` (our `Rng.int`
throws on negatives). The order of two calls inside one C++ expression is unspecified; where that happens this doc
assumes left to right and says so. Cosmetic draws (sounds, curses, quotes, blood graphics) share `main` in the original;
which of them move to the cosmetic stream is a per-call decision listed in §12.4.

**Directions and units.** N 0 … NW 7; `GetDirectionFromGridNo(g, s)` is the direction **from `s` towards `g`**
(`Soldier_Control.cc:6334-6349`). World units: 10 per tile horizontally; height units: 256 per storey, 64 per cube
(docs/08 §1.1). Teams: OUR 0, ENEMY 1, CREATURE 2, MILITIA 3, CIV 4. `OKLIFE 15`, `CONSCIOUSNESS 10`, `OKBREATH 10`,
`USABLE 10` (minimum item status). `AIM_SHOT_RANDOM 0, HEAD 1, TORSO 2, LEGS 3, GLAND 4`.

## 0. Overview

```
order ─ HandleItem: checks, AP check only, (psycho burst roll)             §1.3
  └ EVENT_FireSoldierWeapon: busy +1, bBulletsLeft, ready (AP) / turn (AP) §1.4
     └ fire state: 757 busy +1, 470 jam check, 430 queue fire event        §1.6, §1.7
        └ UseGun at the fire frame: AP paid, CTH, hit roll, ammo, XP       §1.9, §2
           └ FireBulletGivenTarget: aim or miss angle, first tile now      §3.1-§3.2
              └ MoveBullet, one tile per frame: structures, people,        §3.4-§3.5
                 suppression points                                         §8.1
                 ├ structure stops it → miss animation → FreeUpAttacker    §3.5
                 └ person → BulletHitMerc → BulletImpact (armour, crits)   §4
                    └ EVENT_SoldierGotHit: damage NOW, hit animation       §5.1-§5.4
                       busy +1; attacker's own hold released (last bullet)
                       └ hit animation → release, or fall → 497 → death
                          animation → 440 corpse                           §5.5-§5.10
  … busy count reaches 0 → end of attack: suppression, notice the
    attacker, combat entry, stat points, deferred noise, end of battle     §8.4
```

Invariants the port must keep:
1. **Who rolls when.** Guns, melee and launchers roll at the fire frame (opcode 430), against the world at that
   moment; thrown objects roll at the order (§7.1). APs for guns and melee are paid at the fire frame, for throws at the
   release frame (460/461).
2. **The roll only sets `sHitBy`.** `CTH − roll` > 0 is a straight shot plus a damage bonus; ≤ 0 is an angular miss.
   What the bullet then meets decides the outcome (§3).
3. **Damage at impact, death at the end of the death animation.** Life drops when the bullet arrives; corpse, item
   drop, kill credit and target removal happen at opcode 440, seconds later (§5.5, §5.10).
4. **One barrier.** `ubAttackBusyCount` counts everything still resolving (attacks, bullets, hit animations, objects,
   explosions). While it is above 0 interrupts, noise and AI re-planning wait; reaching 0 runs the end-of-attack
   sequence once, with the soldier whose release emptied it (§8.2, §8.4).
5. **`pre` for outcomes.** Hit rolls, deviation, cover, armour, criticals, stat gains use `pre`; a handful of gameplay
   draws use `main` (instant-kill bonus, head-gear damage, weapon drop, turn-from-hit, fall side, explosive barrels).

---

## 1. Gun attack: from order to the fire frame

### 1.1 Data

| Source | Fields used here |
|---|---|
| `weapons.json` (`WeaponModels.cc:165-600`) | `internalType` → item class and `ubWeaponClass` (PISTOL/M_PISTOL → HANDGUN, SMG → SMG, RIFLE/SN_RIFLE/ASRIFLE/LAW/CANNON/LAUNCHER → RIFLE, SHOTGUN → SHOTGUN, LMG → MG, BLADE/THROWINGBLADE → KNIFE, MONSTSPIT → MONSTER). `LAW` and `CANNON` are `IC_GUN` (impact 80 for LAW, `:1389-1395`); `LAUNCHER` is `IC_LAUNCHER`. `ubImpact`, `usRange` (world units, 10 per tile), `ubShotsPerBurst` (max 6, MINIMI), `ubBurstPenalty`, `ubBulletSpeed` (20–30), `ubReadyTime`, `ubShotsPer4Turns`, `ubMagSize`, `ubAttackVolume`, `ubHitVolume`, `bReliability`, `bTwoHanded` |
| `ammo-types.json` | `AMMO_REGULAR 0, HP 1, AP 2, SUPER_AP 3, BUCKSHOT 4, FLECHETTE 5, GRENADE 6, MONSTER 7, KNIFE 8, HE 9, HEAT 10, SLEEP_DART 11, FLAME 12` (`Weapons.h:66-81`); a gun's current type is `inv[hand].ubGunAmmoType` |
| `armours.json` | `armourClass` (HELMET 0, VEST 1, LEGGINGS 2, PLATE 3, MONST 4), `protection`, `explosivesProtection`, `degradePercentage`, `ignoreForMaxProtection` |
| `game.json` (`DefaultGamePolicy.cc:31-54`) | `chance_to_hit_minimum` 1, `_maximum` 99, `tactical_head_damage_multiplier` 1.5, `tactical_legs_damage_multiplier` 0.5, `aim_bonus_per_std_ap` 10, `aim_bonus_sniperscope` 20, `aim_bonus_laserscope` 20, `range_penalty_silencer` 0, `range_bonus_barrel_extender` 100, `fixed_cost_to_shoot` false, `ai.better_aiming_choice` false, `suppression_fire_modifier` 6, `suppression_fire_reaction_threshold` 130 |
| JSD (`content/formats/jsd.ts`) | per structure `armour` (material index into `gubMaterialArmour`, `TileEngine/Structure.cc:119-149`), `density` (%), flags, shape |

`WEAPON_STATUS_MOD(x) = x >= 85 ? 100 : idiv(x*100, 85)` (`Weapons.cc:74`). `GunRange(o) = usRange +
100*WSM(extender)/100 − silencer penalty(0)` for every `IC_WEAPON` class, `CELL_X_SIZE` (10) for anything else
(`:86-103`; a range of 0 would divide by zero in the bullet's range drop). Item slots: `HANDPOS`, `SECONDHANDPOS`, `HELMETPOS`,
`VESTPOS`, `LEGPOS`, `HEAD1POS`, `HEAD2POS`. `bGunStatus` is `bStatus[0]` of the gun; `bGunAmmoStatus` < 0 means jammed.

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
(`Utils/Event_Pump.cc:238-260`). Events with a delay (melee `EV_S_WEAPONHIT`, 20 ms) move to a secondary queue and fire
when `now − stamp > delay` (strict, `:100-122`). **Port this as a per-tick event queue drained after the soldier pass**,
not as direct calls from the opcode handler: it decides whether a soldier later in the same pass sees the pre-shot
world.

### 1.3 The order: `HandleItem` for `IC_GUN` / `IC_THROWING_KNIFE`

In order (`Handle_Items.cc`):
1. Realtime: `ubAttackBusyCount = 0` (`:214-219`). `tgt = WhoIsThere2(grid, level)`; `tgt.bBeingAttackedCount = 0`
   (`:221`).
2. Fail if `bLife < OKLIFE` (unconscious) or the hand item is broken (`:224-225`). Player refusals (good guys, buddies,
   rebels; `:230-266`) and rocket-rifle imprint (`:269-313`) — UI-level, port later.
3. Not a throwing knife: `EnoughAmmo(HANDPOS)` else `NOAMMO` and `fDoSpread = FALSE` (`:315-324`;
   `Points.cc:1322-1350`).
4. `targetGrid = tgt ? tgt.sGridNo : grid`. Player in combat: the "bad chance to get through" quote may cancel
   (`:329-337`, UI).
5. `apCost = CalcTotalAPsToAttack(s, targetGrid, addTurning=TRUE, bAimTime)`. `GetAPChargeForShootOrStabWRTGunRaises`
   decides whether turning and raising are charged; standing+raising sets `fDontChargeTurningAPs`, otherwise turning
   sets `fDontChargeReadyAPs` (`:343-358`). `EnoughPoints(apCost)` else `NOAPS` (`:361`). **Nothing is deducted here.**
6. Psycho (profile trait PSYCHO), not bursting, burst-capable gun: if `EnoughPoints(CalcTotalAPsToAttack(burst=TRUE, aim
   0))` **and `main(3 + bAimTime) == 0`** → switch to burst (`bDoBurst = 1`, `WM_BURST`) (`:364-385`).
7. UI: `bTargetLevel = interface level` (AI sets it itself) (`:390-394`).
8. Gun: `SendBeginFireWeaponEvent(s, fDoSpread && spread[0] ? spread[0] : targetGrid)`; throwing knife:
   `EVENT_SoldierBeginKnifeThrowAttack` (busy +1, `bBulletsLeft = 1`, `THROW_KNIFE`, `Soldier_Control.cc:6838-6860`)
   (`:396-419`).

The AI path is `ExecuteAction(AI_ACTION_FIRE_GUN)` → optional civ quote **`main(50) == 0`** for a visible, non-militia,
profile-less merc body → `HandleItem(s, usActionData, bTargetLevel, hand item, fromUI=FALSE)`
(`TacticalAI/AIMain.cc:1587-1619`). `DecideActionRed/Black` sets `bAimShotLocation = AIM_SHOT_RANDOM` before choosing
(`DecideAction.cc:2784`). The player sets it from the cursor: head/torso/legs on a non-prone merc, otherwise RANDOM
(`UI_Cursors.cc:487-573`); agents pass it explicitly.

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

When the soldier faces the desired direction and is in a FIREREADY state (`TurnSoldier`, `:4245-4277`): enter
`SelectFireAnimation(endHeight)`; if he was turning from prone, he goes back down first (pending fire animation).

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
`calcActionPoints(s)` is the full per-turn AP pool (already ported for M2). Aiming: `bAimTime` 0..4 extra APs
(`AP_MAX_AIM_ATTACK 4`, `Points.h:79-80`), each +10 CTH if the target is visible and not bursting; bursts and attached
launchers ignore it. At the fire frame `UseGun` recomputes `CalcTotalAPsToAttack(addTurning=FALSE)` — the soldier is now
in an `ANIM_FIRE` state, so no raise cost — and deducts it: that is target change + base + aim/burst
(`Weapons.cc:591-623`). Bursts pay only on round 1; dual pistols pay only for the main hand.

### 1.6 Firing animations (scripts from `Ja2bin.dat`, read with `tools/spikes/ja2bin-timelines.py`)

Fire states use a fixed `sSpeed` (100 ms per frame for rifle shots and bursts, 150 for dual, 110 for LAW and mortar), so
combat halving does not apply; `READY_RIFLE_STAND` has speed 0 (stat-computed, `Soldier_Control.cc:4763-4918`). In
combat soldiers not visible to the player get delay 0 (every pass, `:4928-4936`). Opcode layout (frames shown as `[n]`):

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
Rounds beyond `ubShotsPerBurst` (or beyond the magazine) stop at the next 448, so a 3-round burst plays 3 rounds and
returns to aim. `bDoBurst` is 1-based and is incremented after each round in `UseGun`.

### 1.7 Jam, unjam, explosive failure, wear

`CheckForGunJam` (`Weapons.cc:245-321`), only `SOLDIER_PC`, only `IC_GUN` that is not `EXPLOSIVE_GUN` (LAW, tank
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
So guns above status 80 never jam (both draws still happen); a jam costs one round. `SkillCheck(UNJAM)`
(`SkillCheck.cc:146-421`): skill = `30 + idiv(effMech, 2)`, minus `idiv(idiv(skill·fatigue%, 100), 2)`, plus the
modifier and `GetMoraleModifier`, clamped 0..99; roll **`pre(100)`**; on failure **`main(100) < 40`** is drawn (the
unjam check is silent, the draw still happens).

`OKFireWeapon` (`:324-340`): second-hand shot without ammo → FAILED for the player team; else `CheckForGunJam`. Opcode
470 on JAMMED: `usAniCode += 4` and the loop's own `++` skip the next 4 entries (441, 430 and two frames, so no shot),
`bBulletsLeft -= (buckshot ? 9 : 1)`, dry-fire sound, `FreeUpAttacker`. The script then reaches 753 and 473, which
lowers the gun because it is now jammed. UNJAMMED plays `*_SHOOT_UNJAM` (`HandleUnjamAnimation`, `:3264-3294`) and
resumes.

`WillExplosiveWeaponFail(s, o)` (`:3870-3886`), LAW in `UseGun` and launchers in `UseLauncher`, only for the player team
or a visible shooter: `i8(pre(40) + pre(40)) > status && pre(2) == 1` → it explodes in the shooter's tile
(`IgniteExplosion(C1)`) and the busy count is reduced once more.

Wear (end of `UseGun`, `:869-875`): `if (!pre(15 + 3*reliability) && status > 1) status--`. Gunpowder smell:
`if (bMonsterSmell > 0 && main(2) == 0) bMonsterSmell--`.

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
let cth = throwingKnife ? calcThrownChanceToHit(s, grid, aim, aimLoc)   // §7.4
                        : calcChanceToHitGun(s, grid, aim, aimLoc, modify = true);   // §2; barrel extender main() draws
if (inMeanwhile) cth = 100;
const roll = pre(100);                                                // THE hit roll
const hit = roll <= cth;                                              // so 99 never misses, 1 hits 2 % of the time
if (!throwingKnife) {
  deductAmmo(s, hand);                                                // ubGunShotsLeft-- (tanks keep MG ammo)
  if (ourTeam && s.target && (!s.doBurst || s.doBurst === 2 /* burst: round 2 only, §10 */) && inCombat
      && bodyPartCTGT(s, s.target, aimLoc) > 0) {
    let xp = 0;
    if (hit) { xp += idiv(u8(100 - cth), 25); if (aim && !s.doBurst) xp += min(aim, xp); xp += 3; }
    xp += 3;
    if (dual) xp = idiv(xp*2, 3);
    xp = modifyExpGainByTarget(xp, s.target);                         // cow/crow /2, vehicle/tank 0
    statChange(s, MARKAMT, xp, hit ? SUCCESS : FAILURE);              // pre() draws inside, §10
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
if (!pre(15 + 3*reliability) && status > 1) status--;
if (s.monsterSmell > 0 && main(2) === 0) s.monsterSmell--;
```
`sHitBy = cth − roll` is the only output of the roll: > 0 traces straight at the aim point and is a damage bonus
(`sHitBy/2` %), ≤ 0 deflects the bullet by an angle proportional to the miss (§3.2). A "hit" can still be stopped by
cover and a "miss" can still strike the target or a bystander. Burst rounds after the first are rolled the same way at
their own 430 with the burst penalty.

---

## 2. `CalcChanceToHitGun` (`Weapons.cc:1979-2548`)

`AICalcChanceToHitGun` calls it with the shooter temporarily `STANDING` and `fModify = FALSE` (`:2551-2562`); the AI
uses it only for planning. `range` is `trunc(hypot(Δcol, Δrow)·10)` (`GetRangeInCellCoordsFromGridNoDiff`,
`TileEngine/Isometric_Utils.cc:372-383`). `wsm` = `WEAPON_STATUS_MOD`. All variables are INT32 unless noted.

```ts
function calcChanceToHitGun(s, g, aim, aimPos, modify): number {
  if (s.marksmanship === 0) return MIN;                                 // 1
  const gun = s.inv[s.attackingHand], item = s.attackingWeapon;
  const cond = wsm(gun.gunStatus);
  let mrk = item === ROCKET_LAUNCHER
    ? idiv(effDex(s) + effMrk(s) + effWis(s) + 10*effExp(s), 4) + HEAVY_WEAPS_BONUS*traitCount(s, HEAVY_WEAPS)
    : effMrk(s);                                                        // robot: max(own, controller's effMrk)
  mrk += moraleModifier(s);                                             // §9
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
(`TacticalAI/AIMain.cc:53-61`, `AIUtils.cc:2068-2120`); for guns only the negative part applies (`min(0, …)`), for melee
the full value does (§6.2). `effectiveLife()` is `Soldier_Control.h:821`; `EffectiveStrength/Agility/ExpLevel/…` are
`SkillCheck.cc:14-118` (drunkenness, carried weight for agility, life for strength).

**Vanilla differences** (V `Weapons.c:2280-2800`): the injury term used `lifeMax − life + bandaged/2` (bandaging made it
worse; Strac uses `effectiveLife`); the barrel extender wore on every CTH evaluation (including UI and AI previews) with
`Random`; sun goggles always helped; the sniper scope also helped bursts. Strac and V share the Queen-only dodge.

## 3. Bullets (`Tactical/LOS.cc:2216-4241`, `Tactical/Bullets.cc`)

Units and fixed point are the LOS ones (docs/08 §1.1): 10 world units per tile, 256 height units per storey, 64 per
cube, `FIXEDPT` with 20 fractional bits, LOS cell = `(unit % 10) >> 1`. The bullet code reuses the LOS stepping, but its
ray uses the **2D** distance and keeps going after the target tile until something stops it or it leaves the world.

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
horizontal 0, ±0.008, ±0.016, ±0.024, ±0.032; flamethrower ±0.12 / ±0.08. `b.horizAngle` is the unadjusted
`ddHorizAngle` of that bullet before its own miss deviation (`:3362`), i.e. `h0` for bullet 1 even when it missed
(quirk: corner tests use the intended direction).

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
advances `ubTilesPerUpdate` tiles. With the frame rate far below 300 Hz this is one tile per frame (≈16 ms at 60 fps),
so bullet flight time and burst overlap depend on the frame rate (`03` §3). **Simulation:** advance every live real
bullet by one tile per 5 ms tick at the start of the tick (after physics, before soldiers); the first tile happens
inside `FireWeapon`. Knives: one tile per 30 ms (6 ticks). Log this with the existing timing deviation.

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
        if (isMercBody(p) && (p.side !== b.firer.side || b.loop > 30)) addSuppression(b, p);       // §8.1
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
`addSuppression(b, p)` is the suppression-point award of §8.1 (buckshot `main(2)`, stance `pre(4)` rolls). The person
loop and the neighbour loop can both count the same soldier.

`stepThroughTile` (`:3841-4203`), the inner loop until the tile changes:
- **Ground:** `fixInt(b.z − land) < 0` → `StopBullet`, `StructureHit(NONE, 0, stopped)`.
- **Empty tile** (`local` empty and no roof): fast-forward to the next tile edge exactly as LOS does (docs/08 §1.4);
  if that would go below the ground, advance `min(steps, |(z − land)/incZ|)` and stop on the ground. Missile/flame/spit
  trails every 10/5/5 steps (`AddMissileTrail`, `Bullets.cc:296-353`) are drawn for show: none for tank shells, nor for
  small missiles, flames and spit before step 5, and the fast-forward's `fGoingOver` stays set for the rest of the
  `MoveBullet` call once a trail falls in a stretch, so every later stretch of that call leaves one too. Each trail's
  frame delay is `100 + Random(100)` (100 for flames), a cosmetic draw the simulation leaves to the browser
  (`deviations.md` "Cosmetic draws in attacks"); it emits `missileTrail` (`04` §4.4).
- **Otherwise**, at each LOS cell / cube: cube ≥ 8 skips tests; cube 4–7 tests roof-level (`sCubeOffset` 4) structures
  with `cube − 4`. For each `local` structure of that level whose shape has the bit:
  - **person** → `BulletHitMerc(b, s, intended)` (§4.1). Stopped → return. Passed through → remove it from `local`.
  - **window** (`WALLNWINDOW` with `winLo ≤ z ≤ winHi`) and `ResolveHitOnWall` says hit: a knife runs
    `HandleBulletStructureInteraction` and on ≤ 0 drops a (bloody) throwing knife on the near side and stops
    (`StructureHit(id, 1, true)`); a bullet breaks the window (`WindowHit`: swap to the cracked, then shattered partner
    structure; noise `WINDOW_CRACK/SMASH_VOLUME`) and **continues**; the window leaves `local`.
  - **anything else**, if `loop > 25 || ALWAYS_CONSIDER_HIT || intended`: walls (`WALLSTUFF`) pass at corners per
    `ResolveHitOnWall`; else `HandleBulletStructureInteraction` (§3.5). If it hit: a corpse (not for missiles, flame,
    spit) → `RemoveBullet`, `CorpseHit`, `FreeUpAttacker`, return; remaining impact ≤ 0 → `StopBullet`,
    `StructureHit(id, 1, true)`, return; else the first time this structure is hit in this tile → `StructureHit(id, 1,
    false)` (sound, noise, damage) and mark it.
  - Step one unit at a time until the LOS cell or cube changes. With a roof structure on the tile, crossing the wall
    plane stops the bullet (`StructureHit(NONE)`).

### 3.5 Structures in the way

`ChanceOfBulletHittingStructure(loop, distToTarget, hitBy)` (`:2216-2245`): beyond 25 tiles 90; else
`pen = max(0, idiv(loop, 5) − (distToTarget − loop))` (being close to the cover you shoot past makes it likelier);
misses add 20 % to the distance (`loop += idiv(loop, 5)`); result `table[idiv(loop + pen, 10)]` or 90 beyond index 25.
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
`MATERIAL_ARMOUR` (`Structure.cc:119-149`): timber 25, plywood 20, live wood 30, light vegetation 3, upholstery 10,
porcelain 47, cactus/hay 10, stone 55, concrete 63, reinforced 70, rock 85, rubber 9, sand 40, cloth 1, sandbag 40,
light metal 37, thick metal 57, heavy metal 85, indestructible 127.

`StructureHit(b, id, impact, stopped)` (`Weapons.cc:1565-1821`): if stopped and the firer has an `opponent`, that
opponent gets the dodge agility gain (§10); for wall-oriented structures the noise/explosion tile is moved to the
shooter's side; unless the same structure was hit last, `MakeNoise(firer, tile, level, hitVolume, NOISE_BULLET_IMPACT)`;
LAW → remove, `FreeUpAttacker`, `IgniteExplosion(C1)`; tank cannon → `TANK_SHELL`; a real structure →
`DamageStructure(GUNFIRE)`: indestructible materials ignore it, an `EXPLOSIVE` structure explodes on **`main(2)`**,
otherwise no hit points are lost (`TileEngine/Structure.cc:1150-1212`). Guns: player-team single shots curse on
`main(40) == 0`. A stopped bullet then plays a miss animation (`FIRSTMISS1`, 80 ms/frame; water adds a ripple) with
`ANITILE_RELEASE_ATTACKER_WHEN_DONE`, and **`RemoveBullet` + `FreeUpAttacker` happen when that animation ends**
(`TileEngine/Tile_Animation.cc:238-246`). `FIRSTMISS1` has 5 frames (`TileEngine/TileDat.cc:567-576, 620-623`); the tile
steps when more than 80 ms have passed since the last step (strict, `Tile_Animation.cc:140, 267-282`) and the fifth step
deletes it, so the release comes 5 × 85 ms = 425 ms after the stop on 5 ms ticks. HE/HEAT ammo plays a mini-explosion
and frees at once; hitting the same structure twice frees at once. Knives that hit the ground become a `THROWING_KNIFE`
item.

`ShotMiss(b)` (bullet left the world, `Weapons.cc:3170-3212`): dodge agility gain to `opponent`, curse `main(40)`,
sound, `FreeUpAttacker`. `RemoveBullet` decrements `firer.bBulletsLeft` for real bullets (`Bullets.cc:130-170`);
`FreeUpAttacker` only lowers the busy count once `bBulletsLeft` is 0 and the firer holds a gun
(`Overhead.cc:5529-5537`), so the attack's own busy +1 is released by the **last** bullet of the attack, whatever ended
it.

### 3.6 Chance to get through (`CalcChanceToGetThrough`, `:2432-2882`)

A fake bullet (`FireBulletGivenTarget(fake=TRUE)`, `sHitBy` 0, buckshot only lowers the impact) walks the same path
without any RNG. It returns 0 on ground, roof crossing, leaving the map or when the accumulated reduction reaches the
impact; otherwise `100·(impact − reduction)/impact`. Per tile it lists walls/fences (fences weighted by the
structure-hit chance like above, else 100), the roof, persons other than firer/target that are visible (100 if standing
and beyond 30/15 units, else 3), corpses, and other obstacles beyond 25 units weighted by
`ChanceOfBulletHittingStructure(loop, limit, 0)` (100 in the target tile). Each cell hit counts; at the end of the tile
`reduction += min(CTGTInteraction(s) · timesHit, impact) · weight / 100`, where `CTGTInteraction = idiv(MATERIAL_ARMOUR
· density, 100)` scaled by range and ammo like §3.5 (HEAT not included in the AP case, `:2414-2427`), and the full
impact for knives/missiles. Reaching the target person returns at once. Beyond `2·range` the ray drops like a real
bullet. Callers: `SoldierToSoldierBodyPartChanceToGetThrough` (target body-part Z), `SoldierToSoldierChanceToGetThrough`
(`TARGET_POS`), `SoldierToLocationChanceToGetThrough`, and the `AI*` variants that fake a standing shooter
(`:2888-3042`). Non-gun items are measured as a `GLOCK_17` (`:3421-3443`).

## 4. A bullet reaches a soldier

### 4.1 `BulletHitMerc(b, structure, intended)` (`LOS.cc:1808-2207`), in order

```ts
const firer = b.firer, tgt = soldierOf(structure);                  // person structure IDs are soldier IDs
let ammo;
if (b.flags & KNIFE) { put BLOODY_THROWING_KNIFE (status = b.itemStatus) into a free pocket BIGPOCK1..SMALLPOCK8, else onto tgt's tile; ammo = AMMO_KNIFE; }
else ammo = firer.inv[firer.attackingHand].ammoType;
let loc = RANDOM, special = NO_SPECIAL, headSlot = NO_SLOT;
if (vehicle(tgt) || tgt.body in {COW, CROW, BLOODCAT}) loc = TORSO;
else {
  if (creatureOrBloodcat(tgt)) {
    loc = TORSO;
    if (ADULTFEMALEMONSTER <= tgt.body <= YAM_MONSTER && dirTo(firer.gridNo, tgt.gridNo) ∈ {tgt.dir, tgt.dir±1} && pre(100) < 1) loc = GLAND;
  }
  if (loc === RANDOM) {
    if (tgt.overTerrain === DEEP_WATER) loc = HEAD;
    else {
      let z = fixToFloat(b.z) - landHU(b.gridNo); if (z > 256) z -= 256;           // bullet height above the target's floor
      switch (endHeight(tgt.state)) {                                                // current END height (falls keep it)
        case STAND:  loc = z > 159 ? HEAD : z < 95 ? LEGS : TORSO; break;
        case CROUCH: loc = z > 95  ? HEAD : z < 47 ? LEGS : TORSO; break;
        case PRONE:  loc = TORSO;
      }
    }
  }
  if (ammo === AMMO_MONSTER && loc === HEAD && !(tgt.flags & MONSTER)) {              // spit in the face
    const a = dirTo(firer.gridNo, tgt.gridNo);
    if (opposite(a) !== tgt.dir && a !== ccw(tgt.dir) && a !== cw(tgt.dir)) {}       // facing away
    else if (head1 ∈ {NIGHTGOGGLES, SUNGOGGLES, GASMASK} && i8(pre(100)) < head1.status) headSlot = HEAD1POS;
    else if (head2 ∈ {…} && i8(pre(100)) < head2.status) headSlot = HEAD2POS;
    else special = BLINDED_BY_SPIT;
  }
}
const range = rangeInUnits(firer.gridNo, tgt.gridNo);
let impact, damage, hitBy;
if (godMode && !(firer.flags & PC)) impact = damage = 0;
else {
  hitBy = intended ? (firer.opp[tgt] === SEEN_CURRENTLY ? b.hitBy : idiv(b.hitBy, 2)) : 0;   // no aim bonus on bystanders
  impact = max(0, b.impact - b.impactReduction);                                             // range loss is disabled (:1796-1805)
  damage = bulletImpact(firer, tgt, loc, impact, hitBy, &special);                           // §4.2
  if (intended) { if (firer.team === OUR && firer.target?.life > 0) shotsHit++; tgt.intendedTarget = true;
                  if ((b.flags & BUCKSHOT) && tgt === firer.target) tgt.pelletsHitBy++; }
  else tgt.intendedTarget = false;
}
if (ammo === AMMO_MONSTER) { if (headSlot) { head.status -= i8(idiv(impact, 2) + main(idiv(impact, 2))); delete if ≤ 0; } }
else if (loc === HEAD) { const sl = HEAD1POS + main(2); if (inv[sl]) { inv[sl].status -= i8(main(idiv(impact, 2))); if (< 0) = 1; } }
if (tgt.team === OUR) timesWounded++;
if (firer.team === OUR && !firer.target && tgt.neutral)
  if (tgt.civGroup ∈ {KINGPIN, HICKS} || main(100) < 60) firer.target = tgt;                // a stray hit makes him the target
if (firer.doBurst && special === NO_SPECIAL) special = BURST;
const breathLoss = i16(idiv(impact * 50 /*BP_GET_WOUNDED*/ * (tgt.breathMax*100 - tgt.breathRed), 10000));   // from pre-armour impact
const hitDir = dirFromGrid(firer.gridNo, tgt);
let stopped = true;
if (!vehicle(tgt) && ammo ∈ {REGULAR, AP, SUPER_AP} && !explosiveGun(firer.attackingWeapon)) {   // over-penetration
  if (damage < impact) impact = damage;
  if (pre(100) < u8(max(0, impact - 20))) {
    impact -= calcBodyImpactReduction(ammo, loc);                    // [0,15,30,23][loc], AP ×3/4, SAP ×1/2 (HP ×3/2 unreachable)
    impact -= totalArmourProtection(tgt, loc, impact, ammo);         // the back of the armour: more pre() draws and wear
    if (impact > 0) { b.impact = i8(impact); stopped = false; }      // note: b.impactReduction is kept
  }
}
if (stopped) removeBullet(b);                                       // bBulletsLeft--; no FreeUpAttacker (the hit releases it)
else dropBlood(next tile behind the target, unless blocked);        // visual
if (tactical.currentTeam !== OUR && tgt.team === OUR) tactical.someoneHit = true;     // suppresses close-call quotes
weaponHit(tgt, firer.attackingWeapon, damage, breathLoss, hitDir, tgt.x, tgt.y, 20, range, firer, special, loc);   // §4.4
return stopped;
```
A bullet that passes through continues in the same tile with the person removed from its list; it can hit others,
including the original target only once per tile.

### 4.2 `BulletImpact(firer, tgt, loc, impact, hitBy, &special)` (`Weapons.cc:2743-3116`)

```ts
const ammo = throwingKnife(firer.attackingWeapon) ? AMMO_KNIFE : firer.inv[hand].ammoType;
if (TANK(tgt) && ammo !== AMMO_HEAT) return 0;                     // ping
const fluke = pre(51) - 25;                                         // ±25 %
impact = idiv(impact * (100 + fluke + idiv(hitBy, 2)), 100);        // up to +49 % for a perfect shot
if (impact < 1) impact = 1;
if (ammo === HE || ammo === HEAT) { impact = idiv(impact*4, 3); if (TANK(tgt)) impact = idiv(impact, 2); }
let dmg = special === BLINDED_BY_SPIT ? impact : impact - totalArmourProtection(tgt, loc, impact, ammo);   // §4.3
if (ammo === HP || ammo === SLEEP_DART) dmg = max(dmg, 0);
else { dmg = max(dmg, idiv(impact + 5, 10));                        // ~10 % always gets through
       if (ammo === BUCKSHOT && tgt.pelletsHitBy > 0) dmg += idiv(tgt.pelletsHitBy - 1, 2); }
let crit = 0;
if (dmg > 0 && !TANK(tgt)) {
  if (ammo === SLEEP_DART && hitBy > 20) { special = SLEEP_DART; return dmg; }
  if (ammo === HP) dmg = idiv(dmg*17, 10);                          // after armour: HP only helps if it got through
  [dmg, crit] = adjustImpactByHitLocation(dmg, loc);                // head: floor(1.5·d) both; legs: crit = floor(0.5·d), dmg = floor(0.5·crit)
  const close = pythSpacesAway(firer.gridNo, tgt.gridNo) <= 7;      // MAX_DISTANCE_FOR_MESSY_DEATH
  switch (loc) {
    case HEAD: if (close) {
      if (crit > 55 && crit < tgt.life) { dmg = crit = tgt.life + main(10); }               // MIN_DAMAGE_FOR_INSTANT_KILL
      if (crit >= tgt.life) { if (crit > 45) special = HEAD_EXPLODE;
                              else if (crit > 22 && pre(22) < crit - 22) special = HEAD_EXPLODE; } } break;
    case LEGS:
      if (isMercBody(tgt) && endHeight(tgt.state) === STAND && !inWater(tgt)) {
        if (crit > 20) special = LEG_FALLDOWN;
        else if (crit > 10 && pre(10) < crit - 10) special = LEG_FALLDOWN; } break;          // any range
    case TORSO: if (close) {
      if (dmg > 55 && dmg < tgt.life) dmg = crit = tgt.life + main(10);
      else if (dmg + tgt.sDamage > 30 + 55) dmg = crit = tgt.life + main(10);                // recent damage counts (below)
      if (dmg > 30 && dmg >= tgt.life) special = CHEST_EXPLODE; } break;
  }
}
if (robot(tgt)) crit = 0;
if (!autoResolve) {
  if (ammo === AMMO_KNIFE && firer.opp[tgt] === SEEN_CURRENTLY && tgt.opp[firer] === NOT_HEARD_OR_SEEN
      && !creatureOrBloodcat(tgt) && (loc === HEAD || loc === TORSO)
      && pre(100) < u32(hitBy + 10*traitCount(firer, THROWING))) dmg = crit = tgt.life + main(10);   // silent knife kill
  if (crit > 0 && crit < tgt.life) {
    if (pre(idiv(crit, 2) + 5*firer.aimTime) + 1 > 30) {           // CRITICAL_HIT_THRESHOLD; pre(0) draws nothing
      let loss = i8(pre(idiv(crit, 2)) + 1);
      HEAD: stat = WIS; TORSO: stat = preChance(50) && !(tgt.flags & MONSTER) ? DEX : STR; LEGS: stat = AGI;
      if (loss >= tgt[stat]) loss = tgt[stat] - 1;
      if (loss > 0) { tgt[stat] -= loss; tgt[stat + 'Damage'] += loss; profile[stat] = tgt[stat]; profile[stat + 'Delta'] -= loss; message; }
    }
  }
}
return dmg;
```
`MIN_DAMAGE_FOR_INSTANT_KILL 55`, `_HEAD_EXPLOSION 45`, `_BLOWN_AWAY 30`, `_AUTO_FALL_OVER 20` (`Weapons.h:17-30`).
`tgt.sDamage` is the **floating damage-number accumulator**: `SoldierTakeDamage` adds each life loss
(`Soldier_Control.cc:5636`) and restarts the display (`:5693-5700`); `ExecuteOverhead` steps the display every 250 ms
(`DAMAGE_DISPLAY_DELAY`) and zeroes `sDamage` after 8 steps (`Overhead.cc:525-541`). So chest hits landing within ≈2 s
of each other add up toward the 85-point "blown away" kill. The display, and so the reset, only starts for a target in
sector with `bVisible != -1`; hits on soldiers the player cannot see accumulate until a visible hit. Keep it as a
game-ms timer (8 × 250 ms). The head/torso "instant kill" draws use **`main`**, the rest `pre`. The stat loss is
permanent (the `*Damage` fields allow healing back, see §5.11). `fluke`/`hitBy` are applied before armour, HP ×1.7 and
location after armour.

### 4.3 Armour (`Weapons.cc:106-204, 2564-2741`)

```ts
totalArmourProtection(tgt, loc, impact, ammo) {
  if (vehicle(tgt)) { let st = 100; return armourProtection(tgt, vehicleArmour(tgt), &st, impact, ammo); }
  if (loc === GLAND) return 0;
  const slot = loc === HEAD ? HELMETPOS : loc === LEGS ? LEGPOS : VESTPOS;
  const a = tgt.inv[slot]; if (!a.item) return 0;
  let total = 0;
  if (slot === VESTPOS && plates(a) !== -1) {                        // ceramic plates first
    total += armourProtection(tgt, a.attach[p], &a.attachStatus[p], impact, ammo);
    if (a.attachStatus[p] < 10) remove plates (message);
  }
  if (impact > total) {
    total += armourProtection(tgt, a.item, &a.status, impact, ammo);
    if (a.status < 10) deleteObj(a);                                 // armour below USABLE is destroyed
  }
  return total;
}
armourProtection(tgt, item, &status, impact, ammo) {
  let prot = protection(item);
  if (!robot(tgt)) { const fail = pre(100) + 1 - status; if (fail > 0) { prot -= fail; if (prot < 0) return 0; } }   // weak spots
  prot = ammo === HP ? idiv(prot*3, 2) : ammo === AP || ammo === HEAT ? idiv(prot*3, 4) : ammo === SUPER_AP ? idiv(prot, 2) : prot;
  const applied = prot > impact ? impact : protection(item);         // wear uses the raw value
  if ((ammo === KNIFE || ammo === SLEEP_DART) && class(item) ∈ {VEST, LEGGINGS}) prot = 0;   // kevlar does not stop blades
  else if (ammo === MONSTER) { status -= i8(idiv(3*applied*degrade(item), 100)); prot = idiv(prot, 2); }
  if (!robot(tgt)) status -= i8(idiv(applied*degrade(item), 100));
  return prot;
}
```
One `pre(100)` per armour piece consulted (plates, then the vest only if the plates did not absorb the whole impact).
`ArmourPercent(s)` (UI and AI threat only, `:123-149`; `AIUtils.cc:1875`): `65·eff(vest)/maxVest +
15·eff(helmet)/maxHelmet + 25·eff(legs)/maxLegs` with `eff = protection·status/100 (+ plates)`, `max*` = the best
protection (with plates) per class over `armours.json`, ignoring `ignoreForMaxProtection`
(`DefaultContentManager.cc:562-602`; V hard-codes Spectra 18 items). `ArmourVersusExplosivesPercent` is the same with
explosive protection and each term capped at 65/15/25; blasts use it (`Explosion_Control.cc:729`).

### 4.4 `WeaponHit(tgt, weapon, damage, breathLoss, dir, x, y, z, range, attacker, special, loc)` (`Weapons.cc:1502-1539`)

1. `MakeNoise(attacker, tgt.gridNo, tgt.level, hitVolume(weapon), NOISE_BULLET_IMPACT)` (deferred while busy).
2. `EXPLOSIVE_GUN` (LAW, tank cannon): `IgniteExplosionXY(attacker, x, y, 0, grid, C1 or TANK_SHELL, tgt.level)`,
   `FreeUpAttacker`, return (the soldier takes only the blast).
3. `DoSpecialEffectAmmoMiss` (HE/HEAT mini-explosion visual; monster spit with a smoke effect → `NewSmokeEffect`).
4. `tgt.fDoingExternalDeath` → `ReduceAttackBusyCount(tgt.attacker)`; else `EVENT_SoldierGotHit(tgt, weapon, damage,
   breathLoss, dir, range, attacker, special, loc, NOWHERE)` (§5).

Melee hits arrive through the queued `EV_S_WEAPONHIT`, whose handler passes **the target's own `bAimShotLocation`** as
the hit location (`Utils/Event_Pump.cc:262-268`); V passes the event's zeroed `ubLocation` (= RANDOM). Melee damage was
already scaled by the attacker's aim location in `UseBlade`/`UseHandToHand`.

## 5. The target: hit reaction, damage and death

Scope: from `EVENT_SoldierGotHit` to the corpse. Callers: `WeaponHit` (bullets §4.4; melee through the 20 ms event,
§6.1), blasts (`Explosion_Control.cc:734`, location `ANIM_CROUCH`, range = blast distance; `12` §10), thrown objects
hitting a soldier (`Physics.cc:1869`, `TOSSED_OBJECT_SPECIAL`, weapon `NOTHING`, §7.9.3), the LAW back-blast (§1.9),
queen tentacles (`Weapons.cc:3858`) and opcode 761 (a creature eating a corpse). Hit location, `BulletImpact`, armour,
the `ubSpecial` decision and critical stat loss are in §4.

### 5.1 `EVENT_SoldierGotHit` (`Soldier_Control.cc:2628-3030`)

```ts
function eventSoldierGotHit(t, weapon, dmg: i16, breath: i16, dir, range, att, special, loc, locGrid) {
  if (t.state in [SHOOT_ROCKET, SHOOT_MORTAR, THROW_ITEM, LOB_ITEM]) reduceAttackBusyCount(t, false); // his own attack dies
  if (att) att.bLastAttackHit = true;
  t.attacker = att;
  if (!vehicle(t)) { t.bBeingAttackedCount++; busy++; }          // the hit animation holds the barrier
  t.ubHitLocation = loc;
  if (dmg > 25) {                                                   // raw sDamage, before punch conversion
    if (att?.team === OUR) morale(att, DID_LOTS_OF_DAMAGE);
    if (t.team === OUR) morale(t, TOOK_LOTS_OF_DAMAGE);
  }
  // reason and breath (:2694-2770)
  if (special === TOSSED_OBJECT) reason = OBJECT;
  else if (isTentacles(weapon)) reason = TENTACLES;
  else if (class(weapon) & (IC_GUN | IC_THROWING_KNIFE)) {
    if (special === SLEEP_DART) {
      t.bSleepDrugCounter = 10;
      if (pre.int(100) < sleepDartSuccumbChance(t)) breath = t.bBreathMax * 100;
    } else if (special === BLINDED_BY_SPIT) {
      if (t.bBlindedCounter === 0) { quote; decayIndividualOpplist(t); }
      t.bBlindedCounter += trunc(dmg / 8) + 1;
    }
    breath += 200 /*BP_GET_HIT*/; reason = GUNFIRE;
  } else if (isBlade(weapon)) { breath = 200; reason = BLADE; }
  else if (isPunch(weapon) || weapon === NOTHING) {
    breath = dmg * 100; dmg = trunc(dmg / 4 /*PUNCH_REAL_DAMAGE_PORTION*/);
    if (meanwhile INTERROGATION) { breath = 0; dmg = trunc(dmg / 2); }
    reason = HANDTOHAND;
  } else if (isExplosive(weapon)) reason = weapon === STRUCTURE_EXPLOSION ? STRUCTURE_EXPLOSION : EXPLOSION;
  // release the attack's own busy hold, using the ACTUAL target (:2774-2797)
  if (reason !== TENTACLES && reason !== OBJECT)
    t = (isGun(weapon) ? freeUpAttackerGivenTarget(t) : reduceAttackBusyGivenTarget(t)) ?? t;
  if (vehicle(t)) { soldierTakeDamage(t, dmg, breath, reason, att); return; }
  const combined = soldierTakeDamage(t, dmg, breath, reason, att);
  if (t.team === OUR && t.bAssignment >= ON_DUTY && t.bAssignment !== POW) { wake; addCharacterToAnySquad(t); }
  const vol = min(max(combined, 1), 10 - effectiveExpLevel(t));     // CalcScreamVolume :3034, UINT8
  if (t.state !== JFK_HITDEATH_STOP) makeNoise(t, t.grid, t.level, vol, NOISE_SCREAM);   // literally !HITSTOP || state != JFK_HITDEATH_STOP
  // impact sound (cosmetic Random(3)); if t.bLife >= 10 (CONSCIOUSNESS): crow explode sound, or hit grunt unless already in a hit
  ...animation selection (§5.4)
}
```

- `freeUpAttackerGivenTarget(t)` = `InternalReduceAttackBusyCount(t.attacker, calledByAttacker=TRUE, t)`: returns
  without decrementing while the attacker holds a gun and `bBulletsLeft > 0` (`Overhead.cc:5528-5537`). Since the
  hit animation's `+1` was added first, the count **cannot reach 0 here**; the zero-barrier work (suppression,
  combat entry, end of battle, `03` §4) always runs later, when the hit animation releases.
- `sleepDartSuccumbChance` (`:5235`): `effStr > 90 ? 110-s : > 80 ? 120-s : > 70 ? 130-s : 140-s`, plus
  `10 - bSleepDrugCounter` (0 on the hit itself).
- V: same, except Strac also treats weapon `NOTHING` as a punch.

### 5.2 `SoldierTakeDamage(t, life: i16, breath: i16, reason, attacker)` (`Soldier_Control.cc:5432-5861`)

```ts
t.ubLastDamageReason = reason;
// activity tracking: enemy hurt in enemy-held/wilderness sector or any creature → UpdateLastDayOfPlayerActivity;
// Kingpin civ during Maria rescue → FACT_MARIA_ESCAPE_NOTICED
const oldLife = t.bLife;
if (vehicle(t)) {                                    // tanks: no change; other vehicles: gunfire /3, explosion >50 → ×2
  vehicleTakeDamage(...); handleTakeDamageDeath(t, oldLife, reason); return 0;
}
if (t.flags & NPC_SHOOTING) { life = t.bLife - 1; clear flag; }      // meanwhile Elliot
if (reason === BLOODLOSS && inMeanwhile) return 0;
const bandage = i8(t.bLifeMax - t.bLife - t.bBleeding);
if (creatureOrBloodcat(t)) {                          // :5525-5585
  let f = bloodcat ? 2 : larva/infant ? 1 : YAF/YAM ? 4 : adult F/M ? 6
        : queen ? (attacker ? 4 + trunc(PythSpacesAway(attacker, t) / 2) : 8) : 0;
  if (reason === EXPLOSION) f = trunc(f / 4);
  if (f > 1) life = trunc((life + trunc(f / 2)) / f); else if (reason === EXPLOSION) life = trunc(life * 2 / 3);
  f = queen ? min(f, 8) * 2 : trunc(f / 2);
  if (f > 1) breath = trunc((breath + trunc(f / 2)) / f);
}
t.bLife = life > t.bLife ? 0 : i8(t.bLife - life);
if (t.bSide !== FRIENDLY && !t.bNeutral && t.ubProfile === NO_PROFILE && t.bLife > 0 && t.bLife < 14 /*OKLIFE-1*/) {
  if (reason === BLOODLOSS) { if (main.int(2) === 0 || team(t).bMenInSector === 1) t.bLife = 0; }
  else if (t.bLife < 12 /*OKLIFE-3*/) t.bLife = 0;   // unprofiled hostiles: 12-13 left = dying, ≤11 = dead
}
t.sDamage += life;                                     // see §5.11 "sDamage window"
if (t.bLife < 0) t.bLife = 0;
if (reason === EXPLOSION || reason === STRUCTURE_EXPLOSION) checkEquipmentForDamage(t, life);   // pre per item
if (reason !== GAS && !robot(t)) {
  if (reason === HANDTOHAND) { if (life > 0) t.bBleeding += 1; }
  else t.bBleeding = i8(t.bLifeMax - (t.bLife + bandage));          // = old bleeding + life actually lost
}
if (!robot(t)) deductPoints(t, trunc(life / 4) /*AP_GET_WOUNDED_DIVISOR*/, breath);   // §5.3
const combined = u8(trunc(u8(life) / 10) + trunc(breath / 2000));  // the (UINT8) cast binds to `life` only
if (!robot(t)) t.bShock = i8(t.bShock + combined);
t.dNextBleed = 1 + effectiveLife(t) / (10 + t.bTilesMoved);        // float; V integer-divides
if (t.bInSector && t.bVisible !== -1 && oldLife !== 0 && life !== 0 && life < 1000) startDamageDisplay(t);  // resets bDisplayDamageCount
if (reason !== BLOODLOSS && !robot(t)) {               // weapon drop :5716-5755
  let drop = max(0, 2 * max(life, trunc(breath / 100)) + (t.attacker?.body === BLOODCAT ? 20 : 0) - effectiveStrength(t));
  if (hand.flags & UNDROPPABLE) drop -= 30;
  if (main.int(100) < u16(drop) && hand.item && !(hand.flags & UNDROPPABLE)) addItemToPool(t.grid, hand, ourTeam ? VISIBLE : INVISIBLE), deleteObj(hand);
}
const blood = min(trunc(life / 10), 7); if (blood && !vehicleOrRobot && t.bInSector) dropBlood(t, blood);  // main, §5.11
if (t.bInSector) checkForBreathCollapse(t);            // sets bBreathCollapsed when bBreath == 0 (§5.7.4)
if (attacker?.team === OUR && t.team !== OUR && reason === EXPLOSION) statChange(attacker, EXPLODEAMT, 10 * combined, SUCCESS);
if (isOnOurTeam(t)) {
  statChange(t, EXPERAMT, 5 * combined, FAILURE);      // no-op if t.bLife < 10 (Campaign.cc:69)
  if (!pummelQuoteSaid && attacker && attacker !== t && ++t.bNumHitsThisTurn >= 3 && t.bLife - t.bOldLife > 20)
    if (main.int(100) < 40 * (t.bNumHitsThisTurn - 2)) quote;   // sign bug (= V): life only drops, so never true, never drawn
}
if (attacker?.team === OUR && t.ubProfile is NPC/RPC) set WOUNDEDBYPLAYER (Pacos → FACT_PACOS_KILLED);
handleTakeDamageDeath(t, oldLife, reason);             // only BLOODLOSS / ELECTRICITY / GAS do anything (§5.8.3)
if (t.bLife < 10) shutUpFace(t);
if (t.bLife < 15) decayIndividualOpplist(t);           // stops seeing
return combined;
```

`statChange` draws `pre` immediately, one `PreRandom(100)` per chance (`Campaign.cc:261, 336`; §10). Field types:
`bLife`, `bLifeMax`, `bBleeding`, `bShock`, `bActionPoints`, `bBreath` are INT8; `sBreathRed` INT16 (0..10000);
`sDamage` INT16. V: same formulas (V passes extra unused args).

### 5.3 `DeductPoints(t, ap, bp)` as used by hits and falls (`Points.cc:488-582`)

```ts
if (!(flags & INCOMBAT)) ap = 0;                       // real time: breath only
let newAP = t.bActionPoints - ap;
if (newAP < 0 && t.bActionPoints > 0) newAP = 0;       // Strac: debt only carries if already in debt
t.bActionPoints = i8(max(newAP, -100 /*MAX_AP_DEBT*/));
if (robot) bp = 0;
if (bp) {
  bp = adjustBreathPts(t, bp);                         // cost * factor / 100, factor = 100 + (100 - bBreath)
                                                       //   + trunc(100*(bLifeMax - effLife)/bLifeMax) - (Str>80 ? trunc((Str-80)/2) : 0),
                                                       //   ×5 for a NONSWIMMER treading deep water
  t.sBreathRed = clamp(t.sBreathRed + bp, 0, 10000);
  let nb = i8(u8(trunc(t.bBreathMax - t.sBreathRed / 100)));   // float; negative wraps back (inferred x86)
  if (nb > 100) nb = 100;
  if (nb < 0) { t.bActionPoints = max(0, t.bActionPoints + trunc(nb / 5)); nb = 0; }
  t.bBreath = min(nb, t.bBreathMax);
}
```

V floors AP at 0 unconditionally. In turn-based play the wound AP loss only bites into the target's leftover points:
at his team's turn start `CalcNewActionPoints` caps carried points at 5 (`MAX_AP_CARRIED`) and adds the new pool
(`Soldier_Control.cc:420-447`). `effectiveLife = bLife + trunc((bLifeMax - bLife - bBleeding) / 2)` (`.h:821`).

### 5.4 Hit animation choice (end of `EVENT_SoldierGotHit`, `:2862-3030`)

Evaluated in this order, first match wins:

| # | Condition | Animation |
|---|---|---|
| 1 | Current state has `ANIM_HITSTOP` (lying in a STOP pose) | twitch, §5.8; return |
| 2 | Current state `ANIM_FIREREADY` | set `fGoBackToAimAfterHit` (continue) |
| 3 | `SOLDIER_COWERING` | merc body or `bLife == 0` → `GENERIC_HIT_STAND`, else `CIV_COWER_HIT` |
| 4 | Body COW / BLOODCAT / adult monsters / LARVAE / QUEEN / CRIPPLECIV / ROBOTNOWEAPON / INFANT / CROW | `COW_HIT`, `BLOODCAT_HIT`, `ADULTMONSTER_HIT`, `LARVAE_HIT`, `QUEEN_HIT`, `CRIPPLE_HIT`, `ROBOTNW_HIT`, `INFANT_HIT`, `CROW_DIE` |
| 5 | Civilian bodies (MANCIV, MINICIV, DRESSCIV, HATKIDCIV, KIDCIV) | if `bLife == 0` and not DEAD: `main.int(2) !== 0` → `CIV_DIE2`; else `GENERIC_HIT_STAND` |
| 6 | Over LOW_WATER / DEEP_WATER | `WATER_HIT` / `DEEP_WATER_HIT` |
| 7 | Weapon class gun or throwing knife | `SoldierGotHitGunFire` |
| 8 | Blade | `SoldierGotHitBlade` (generic by stance) |
| 9 | Explosive or tentacles | `SoldierGotHitExplosion` |
| 10 | Punch or NOTHING (also thrown objects) | `SoldierGotHitPunch` (generic by stance) |

Cases 7–10 are separate `if`s, not `else if` (an item matching two classes would get two calls; inferred never happens).

**`SoldierGotHitGunFire`** (`:3125-3238`). Only for non-monsters whose `ubEndHeight == STAND`:
- `HEAD_EXPLODE` with gore on and `SpacesAway(t, att) <= 7` (Chebyshev; `BulletImpact` used Pythagorean ≤ 7): if
  `OKFallDirection(t, g1 = t+dir(t.bDirection), JFK_HITDEATH)` and `OKFallDirection(t, g1+dir(t.bDirection),
  current state)` → head hit.
- `CHEST_EXPLODE`, gore on, `SpacesAway <= 7`, and the target **faces the shooter** (`t.bDirection == bDirection`):
  two tiles behind (`opp = Opposite(bDirection)`) checked with `FLYBACK_HIT`, then current state → blown away.
- `LEG_FALLDOWN` (not distance-limited): `IsValidStance(PRONE)`, standing, not in water → fallen over, plus a screen
  message.
Then: `SOLDIER_DEAD` → `ReleaseSoldiersAttacker`, return. Fallen over → `SoldierCollapse` (§5.6). Blown away and merc
body (`<= REGFEMALE`) → `ChangeToFlybackAnimation(bDirection)`. Head hit and merc or kid body → `JFK_HITDEATH`.
Otherwise **`DoGenericHit`**: stand → `BURST_SPECIAL` and merc body: snap `bDirection`/desired to `bDirection`
(face the shooter) and `STANDING_BURST_HIT`; else two-handed weapon in hand → `RIFLE_STAND_HIT`, else
`GENERIC_HIT_STAND`; crouch → `GENERIC_HIT_CROUCH`; prone → `GENERIC_HIT_PRONE`.

**`SoldierGotHitExplosion`** (`:3241-3336`): return if DEAD; cancel services; Strac fix: if the current state is
`ANIM_HITSTART` and not prone, clear the pending animation and both non-interrupt flags so the blast can knock him
down (a grenade that hit him on the way down had started a non-interruptible hit). Gore on, blast radius ≥ 3,
`bLife == 0`, not prone: range 2–4 → `CHARIOTS_OF_FIRE`, range ≤ 1 → `BODYEXPLODING`. Non-merc body →
`DoGenericHit(special 0)`. Stand/crouch: face the blast; if `OKFallDirection(tile behind, Opposite(dir),
FLYBACK_HIT)` → `ChangeToFallbackAnimation(dir)`, else stand → `BeginTyingToFall` + `FALLFORWARD_FROMHIT_STAND`,
crouch → `SoldierCollapse`. Prone → `SoldierCollapse`.

**Entering a hit/die state** (`EVENT_InitNewSoldierAnim`, `:870-1766`):
- `fInNonintAnim` set → the request is **silently dropped** (`:897-901`). Damage, busy `+1` and
  `bBeingAttackedCount+1` already happened; they are all released together later (§5.9).
- `ANIM_NONINTERRUPT` states set `fInNonintAnim` (`:1350`); it is cleared by opcode 442.
- AP/BP on entry: `FALLBACK_HIT_STAND`, `FALLFORWARD_FROMHIT_STAND` → `DeductPoints(4, 250)`;
  `FALLFORWARD_FROMHIT_CROUCH` → `(2, 125)` (`:1557-1566`).
- The listed hit/die states set `fGettingHit = TRUE` (`:1597-1642`).
- `CHARIOTS_OF_FIRE`/`BODYEXPLODING` start at script index `main.int(10)` (`:1727`).
- Fixed-speed states are **not** halved in combat (only the stats-driven path is, `:4900-4905`); a soldier the player
  cannot see in combat gets delay 0 (`:4928-4936`).
- The first `AdjustToNextAnimationFrame` runs inside this call, so opcodes before the first frame fire **at impact**.
- Ends with `CheckForFreeupFromHit` (§5.9).

### 5.5 Hit animation timelines (frames × `gAnimControl` speed)

Frame counts and opcode positions come from `Ja2bin.dat` via `tools/spikes/ja2bin-timelines.py` (do not commit the
data; regenerate). "after Fk" = executes `(k+1) × speed` ms after entry. Sounds and flashes omitted.

| State | ms/frame | Frames | Gameplay markers |
|---|---|---|---|
| `GENERIC_HIT_STAND` | 130 | 3 | 478 at entry; 442, **433** after F0 (130); 472, 499 after F2 (390) |
| `RIFLE_STAND_HIT` | 150 | 5 | 478 at entry; 442, 433 after F1 (300); 472, 499 after F4 (750) |
| `STANDING_BURST_HIT` | 80 | 3 | 433 after F1 (160); 472, 499 after F2 (240). Not non-interruptible: each round restarts it |
| `GENERIC_HIT_CROUCH` | 80 | 5 | 433 after F2 (240); 499 at 400 |
| `GENERIC_HIT_PRONE` | 80 | 6 | 433 after F2 (240); 499 at 480 |
| `FALLFORWARD_FROMHIT_STAND` | 120 | 19 | **447** after F3 (480); 721 (fragile items, 20) after F14; **497** at 2280 |
| `FALLFORWARD_FROMHIT_CROUCH` → `ENDFALLFORWARD_FROMHIT_CROUCH` | 120 | 6 + 9 | 447 at 480; goto at 720; 497 at 1800 |
| `FALLBACK_HIT_STAND` | 130 | 9 | moves 1 tile (1.6 units/frame); 497 at 1170 |
| `PRONE_LAY_FROMHIT` | 160 | 7 | 497 at 1120 |
| `FLYBACK_HIT` (+ `FLYBACK_HIT_BLOOD_STAND`) | 80 | 1 + 7 + 6 | 442 after F0; 434 jumps to the blood script, 436 returns after its F6; frames F1–F7 of `FLYBACK_HIT` are never shown; three 402 move pauses; 497 at 1120; moves 2 tiles |
| `JFK_HITDEATH` | 160 | 27 | **440** at 4320 (head explosion goes straight to the corpse) |
| `GENERIC_HIT_DEATH`, `FALLBACK_HIT_DEATH`, `PRONE_HIT_DEATH`, `FLYBACK_HIT_DEATH` | 120 | 6 | 440 at 720 |
| `CHARIOTS_OF_FIRE` / `BODYEXPLODING` | 150 / 200 | 43 / 27 | start at index `Random(10)`; then 465 (life 0), 440 |
| `CIV_DIE2` | 80 | 22 | 440 at 1760 |
| `WATER_DIE` / `DEEP_WATER_DIE` | 160 / 210 | 20 / 10 | 465, 440 at the end |
| `*_DEATHTWITCHNB` | 100 | 3–4 | 497 at the end |
| `*_DEATHTWITCHB`, `FALLBACK_DEATHTWICH` | 100 | 2–4 | 496 (back to the previous state) |
| `*_STOP` poses | 70–650 | 1–8 | loop forever |

A `GOTO` after a final 440/497 is unreachable (both return). Flags that drive release logic: `ANIM_HITSTART`
(GENERIC/RIFLE/BURST/CROUCH/PRONE hits, FLYBACK, JFK, CIV_COWER_HIT, water/creature hits), `ANIM_HITFINISH`
(falls, FLYBACK, JFK, CIV_DIE2, water/creature dying), `ANIM_HITSTOP` (STOP poses), `ANIM_HITWHENDOWN` (twitches).

Example timelines from impact (standing, gore on, no rotation in 447):
- **Survives (life ≥ 15):** 390 ms in `GENERIC_HIT_STAND`, then back to aim or stationary; the attacker is released
  on that transition.
- **Killed, falls forward:** 130 ms → 433 → fall (AP 4, BP 250) → +2280 → 497 → `GENERIC_HIT_DEATH` → +720 → 440:
  corpse at ≈ 3130 ms. Falls back: 130 + 1170 + 720 ≈ 2020 ms. Gore off: 497 commits death at once (≈ 2410 ms).
- **Unconscious (1..14):** 130 + 2280 → 497 releases the attacker and settles in `STAND_FALLFORWARD_STOP`.
Until 440 the dying soldier keeps his tile, structure and `bLife == 0`, and can be hit again.

### 5.6 Turning from the hit, back to aim, falling, knockback

**478 "decide to turn from hit"** (`Soldier_Ani.cc:1202-1272`), merc bodies with `bLife >= 15`, `bBreath > 0`,
`bLevel == 0`; stores the old direction in `uiPendingActionData1`:
- not a head hit: `r = main.int(100)`; `< 30` → `OneC`, `30..59` → `OneCC`, else unchanged; applied **instantly**
  (`EVENT_SetSoldierDirection`).
- head hit: `main.int(100) < 50` → `SOLDIER_TURNINGFROMHIT`, then `main.int(50) < 25` → desired = 3 octants clockwise,
  else 3 counter-clockwise (turned one octant per frame by `TurnSoldier`). When the desired direction is reached:
  `fGettingHit == 1` → desired = old direction, `fGettingHit = 2`; on reaching it again → clear the flag,
  `ReleaseSoldiersAttacker`, `fGettingHit = FALSE` (`Soldier_Control.cc:4357-4389`). (Turning into a roof fall just
  clears the flag.)
479 is a no-op (body commented out).

**472 "back to aim"** (`:1098-1130`): if `fGoBackToAimAfterHit` (cleared here) and `bLife >= 15` →
`InternalSoldierReadyWeapon(t, t.bDirection, FALSE)`, which charges the ready APs again unless
`fDontChargeReadyAPs` is set (inferred from `:1412-1423`). Otherwise fall through to 499 (stationary stance).

**`BeginTyingToFall`** (`:8905`): `bStartFallDir = bDirection`, `fTryingToFall = TRUE`,
`fFallClockwise = main.int(50) < 25`.

**447 "try to fall"** (`Soldier_Ani.cc:587-634`), while `fTryingToFall`: if
`OKFallDirection(t, t+dir(t.bDirection), level, t.bDirection, FALLFORWARD_HITDEATH_STOP)` → stop trying (fall
forward). Else rotate one octant (cw/ccw per the flag), redisplay the previous frame, and if back at `bStartFallDir`
give up (fall anyway); otherwise **return without advancing**, so 447 re-runs next frame: one octant per frame
(120 ms) until a free tile is found, at most 7 extra frames.

**`OKFallDirection(t, g, level, dir, state)`** (`:3295-3342`): false if
`gubWorldMovementCosts[g][dir][level] > TRAVELCOST_SHORE`, if `g` is water, if `!NewOKDestination(t, g, people=TRUE,
level)`, or if the prone structure of `state`'s surface cannot be added at `g − dir` using
`pDBStructureRef[OneCDirection(dir)]` ("the structure goes in the tile before" quirk).

**Fall back on incapacitation** (433, §5.7.1): tests `OKFallDirection(t, t.sGridNo, dirToAttacker,
FALLBACK_HIT_STAND)` then the tile one step away from the attacker, same direction.

**`ChangeToFlybackAnimation(dir)`** (`:8415`): destination two tiles towards `Opposite(dir)`; path = two steps of
`Opposite(t.bDirection)` (equal, because flyback requires facing the shooter); `FLYBACK_HIT`.
**`ChangeToFallbackAnimation(dir)`** (`:8439`): one tile, one step of `Opposite(t.bDirection)`;
`FALLBACK_HIT_STAND`. Both `removePendingAction` first.
Special-move states move `dMovementChange = 1.6` world units per frame along the path; the occupancy switch happens at
the tile boundary as in walking, but `HandleAtNewGridNo` (mines, movement noise, sight, `03` §2) runs **only on the
final tile** (`Overhead.cc:729-733`). Arriving with `bLife >= 15` and no pending action calls
`SoldierGotoStationaryStance`, which the non-interrupt flag swallows for `FALLBACK_HIT_STAND` (inferred).

**`SoldierCollapse`** (`:7945-8053`): monsters get 5000 breath back and return. Else `bCollapsed = TRUE`, cancel
services, `HandleSight(LOOK)`, clear a pending give; by end height: stand → deep/low water `DEEP_WATER_DIE` /
`WATER_DIE`, else `BeginTyingToFall` + `FALLFORWARD_FROMHIT_STAND`; crouch → `BeginTyingToFall` then
`FALLFORWARD_FROMHIT_CROUCH` (mercs) or `FALLFORWARD_FROMHIT_STAND` (others); prone → map an in-progress fall to its
STOP pose, else `PRONE_LAY_FROMHIT`. Enemy: re-pick the panic-trigger "chosen one"; AI soldier in combat →
`EndAIGuysTurn`.

**Roof edge** (`CheckSoldierHitRoof`, `:6118-6199`, called from 433): `bLife < 15`, a lower level adjacent and
standing → fall off (pending `FALLFORWARD_ROOF` or `FALLOFF` after turning) and `SoldierTakeDamage(100, 5000,
FALLROOF)`, i.e. certain death.

### 5.7 Incapacitation and death opcodes

**5.7.1 433 `CheckForAndHandleSoldierIncompacitated`** (`Soldier_Ani.cc:3045-3184`), returns if `bLife >= 15`:
1. Cancel services. Monsters, CRIPPLECIV, ROBOTNOWEAPON, QUEEN, tanks → `bLife = 0` (no unconscious state).
2. Meanwhile with the Queen present → trigger `APPROACH_DONE_SLAPPED`.
3. `CheckSoldierHitRoof` → return if falling off.
4. `bLife == 0` → death cry (`fDeadSoundPlayed`).
5. In `GENERIC_HIT_STAND`, `STANDING_BURST_HIT`, `RIFLE_STAND_HIT`, `CIV_COWER_HIT` (the last is a Strac fix; V
   omits it): `if (main.int(100) > 40 && mercBody && !terrorist)` (draw first): with an attacker, test direction =
   towards the attacker (forced); two `OKFallDirection` checks (§5.6); OK → face it if forced and
   `ChangeToFallbackAnimation(t.bDirection)`, return. Otherwise `BeginTyingToFall` (`main.int(50)`) and
   `FALLFORWARD_FROMHIT_STAND`.
6. Else by state: `GENERIC_HIT_CROUCH` → `FALLFORWARD_FROMHIT_CROUCH` then `BeginTyingToFall` (state first, draw
   second); `GENERIC_HIT_PRONE` → `PRONE_LAY_FROMHIT`; creature/cow/bloodcat/water hits → their DYING/DIE state.

**5.7.2 497 "death or release"** (`:1631-1716`):
- `bLife == 0`: death cry unless already played or `JFK_HITDEATH`. Gore on → the death state for the current fall
  (`FLYBACK_HIT → FLYBACK_HIT_DEATH`; `GENERIC_HIT_DEATHTWITCHNB`, `FALLFORWARD_FROMHIT_STAND`,
  `ENDFALLFORWARD_FROMHIT_CROUCH → GENERIC_HIT_DEATH`; `FALLBACK_HIT_DEATHTWITCHNB`, `FALLBACK_HIT_STAND →
  FALLBACK_HIT_DEATH`; `PRONE_HIT_DEATHTWITCHNB`, `PRONE_LAY_FROMHIT → PRONE_HIT_DEATH`; roof falls → `FALLOFF_*DEATH`;
  creature/robot/cripple dying → their `_STOP`). Gore off → `CheckForAndHandleSoldierDeath` at once.
- Alive: if the state has `ANIM_HITFINISH` → `ReleaseSoldiersAttacker` (may change teams and deactivate the soldier;
  return if so), `fGettingHit = FALSE`. Then `HandleCheckForDeathCommonCode` (`:3345-3437`): pending animation →
  play it; else `bCollapsed = TRUE`, `HandleSight(LOOK)`, on his own team's turn `BeginSoldierGetup`; map to the STOP
  pose (`FLYBACK_HIT → FLYBACKHIT_STOP`, falls forward → `STAND_FALLFORWARD_STOP`, falls back →
  `FALLBACKHIT_STOP`, prone → `PRONE_LAYFROMHIT_STOP`, roof → `FALLOFF_STOP` / `FALLOFF_FORWARD_STOP`). The block is
  **duplicated** (= V): on his own turn `BeginSoldierGetup` can run twice, so `bTurnsCollapsed` and
  `bSleepDrugCounter` move by 2.

**5.7.3 440 "set buddy as dead"** (`:422-445`): stop the burn sound for CHARIOTS/BODYEXPLODING;
`CheckForAndHandleSoldierDeath` (`:3013`): `HandleSoldierDeath` (§5.10); only if **no corpse** was made, switch to the
matching `*_HITDEATH_STOP` / `*_DIE_STOP` pose. Returns FALSE when a corpse was made (the soldier no longer animates).
**465** sets `bLife = 0`.

**5.7.4 Breath collapse.** `CheckForBreathCollapse` (`Soldier_Control.cc:7565`) only sets `bBreathCollapsed` when
`bBreath == 0` (not for vehicles, animals, monsters, or the already collapsed). The next `AdjustToNextAnimationFrame`
outside a non-interruptible state calls `SoldierCollapse`, unless the current state is HITSTOP/HITFINISH, `bLife == 0`
or a roof fall, which cancel it (`Soldier_Ani.cc:114-145`).

### 5.8 Hit while down, and deaths not from hits

**5.8.1 Twitch table** (`EVENT_SoldierGotHit`, `:2862-2885`), when lying in a STOP pose:
`FLYBACKHIT_STOP → FALLBACK_DEATHTWICH`, `STAND_FALLFORWARD_STOP → GENERIC_HIT_DEATHTWITCHNB`,
`JFK_HITDEATH_STOP → JFK_HITDEATH_TWITCHB`, `FALLBACKHIT_STOP → FALLBACK_HIT_DEATHTWITCHNB`,
`PRONE_LAYFROMHIT_STOP → PRONE_HIT_DEATHTWITCHNB`, `PRONE_HITDEATH_STOP → PRONE_HIT_DEATHTWITCHB`,
`FALLFORWARD_HITDEATH_STOP → GENERIC_HIT_DEATHTWITCHB`, `FALLBACK_HITDEATH_STOP → FALLBACK_HIT_DEATHTWITCHB`,
`FALLOFF_DEATH_STOP → FALLOFF_TWITCHB`, `FALLOFF_STOP → FALLOFF_TWITCHNB`, `FALLOFF_FORWARD_DEATH_STOP →
FALLOFF_FORWARD_TWITCHB`, `FALLOFF_FORWARD_STOP → FALLOFF_FORWARD_TWITCHNB`; any other HITSTOP state: no animation.
**NB** (unconscious) twitches end in 497, so a killing hit on a downed soldier plays the death state and reaches 440.
**B** twitches (dead poses) end in 496 (back to the pose).

**5.8.2** Leaving a twitch (`ANIM_HITWHENDOWN`) releases the attacker when the soldier is DEAD or still alive
(`CheckForFreeupFromHit`, `Soldier_Control.cc:842-856`); if `bLife == 0` the killer is reset to `previous_attacker`.
`FALLBACK_DEATHTWICH` has no HITWHENDOWN flag and ends in 496, so a hit on someone in `FLYBACKHIT_STOP` would never be
released (inferred unreachable: flyback needs a lethal chest hit).

**5.8.3 Collapsing from bleeding/gas/electricity** — `HandleTakeDamageDeath` (`:5358-5426`): in sector, a death cry
for non-bloodloss deaths, electricity below OKLIFE clears `fInNonintAnim`; `0 < bLife < 15` and not collapsed →
`SoldierCollapse`; `bLife == 0` → `fDoingExternalDeath = TRUE`; then `CheckForAndHandleSoldierDyingNotFromHit`
(`Soldier_Ani.cc:3186-3240`): death cry, `bBeingAttackedCount++` (no busy `+1`), gore on → death state from the
current pose (fall/STOP/creature map), else (and for unmapped poses) `CheckForAndHandleSoldierDeath` directly. Out of
sector or in map screen, our dead merc → `StrategicHandlePlayerTeamMercDeath`. Electricity with `bLife >= 15` →
`ReleaseSoldiersAttacker`.

### 5.9 Busy-count accounting for the target

- `+1` per hit on a non-vehicle (`EVENT_SoldierGotHit`), counted in `bBeingAttackedCount`.
- **`ReleaseSoldiersAttacker(t)`** (`Soldier_Control.cc:6439-6476`): if `previous_attacker != attacker` →
  `next_to_previous_attacker = previous_attacker`; `previous_attacker = attacker`; `n = bBeingAttackedCount`,
  zero it, then `n × ReduceAttackBusyCount(t.attacker, FALSE)`; `attacker = NULL` unless dead or the Queen. One
  release frees every hit that landed during the sequence, including hits whose animation was swallowed.
- Release points:
  - **`CheckForFreeupFromHit`** on any state change: old state `ANIM_HITSTART`, new state not `HITFINISH` /
    `IGNOREHITFINISH`, states differ, not turning from a hit (`:813-840`). This is the normal survivor path (hit
    animation → 472/499 → stand or aim). Also a `main.int(10) === 0` curse for our conscious soldiers.
  - 480 (no current script uses it on a hit path), 497 with HITFINISH (unconscious), the end of turning from a hit,
    leaving a twitch.
  - Death: `HandleSoldierDeath` for non-player soldiers (unless `fDoingExternalDeath`); for **our** mercs only in
    `HandlePlayerTeamMemberDeathAfterSkullAnimation`, after the portrait close + skull UI animation (12 frames ×
    160 ms wall clock, `Interface_Panels.cc:2936-3025`) or `FinishAnySkullPanelAnimations` on leaving the screen.
    Until then the barrier stays up.
  - `SoldierGotHitGunFire` on an already DEAD soldier releases at once.
- `ReduceAttackBusyCount(attacker, FALSE)` never checks `bBulletsLeft`; reaching 0 runs the zero-barrier work
  (`03` §4) including `HandleSuppressionFire`, `ProcessImplicationsOfPCAttack`, `NoticeUnseenAttacker`, the
  killed-enemy quote, `CheckForEndOfBattle` (`Overhead.cc:5510-5787`).
- A shooter who is hit mid-burst (burst states are interruptible) keeps `bBulletsLeft` for the rounds never fired;
  nothing resets it (inferred: the attack's busy hold then leaks until the 25 s watchdog; mostly a real-time case).

### 5.10 `HandleSoldierDeath` → corpse (`Soldier_Ani.cc:2855-2997`)

Runs at 440 (or 497 with gore off) if `bLife == 0` and not yet DEAD:
1. Cancel services; destroy muzzle-flash and personal light sprites; `fGettingHit = FALSE`.
2. **Our team:** dirty the panel, `fUIdeadMerc = TRUE` (starts the skull UI), `SOLDIER_DEAD` unless
   `gfKillingGuysForLosingBattle`.
   **Others:**
   a. attacker on our team and busy > 0 → remember for the "killed enemy" quote at busy 0; else if the victim is
      visible → `main.int(3) === 0` and attacker not a creature → attacker laughs (draw happens whenever visible).
   b. **`HandleNPCTeamMemberDeath`** (`Overhead.cc:2273-2522`): `SOLDIER_DEAD`; `VerifyPublicOpplistDueToDeath`;
      profiled → `MERC_IS_DEAD`, history; civilians: quest/fact hooks per profile (Brenda, Pablo → event in
      `480 + Random(60)` min, terrorists, assassins, Eldin, Joey/Martha, Dynamo, Kingpin, Doreen, Queen) and
      `HandleMurderOfCivilian` (not crows/cows); militia: `StrategicRemoveMilitiaFromSector`, murder check,
      `GLOBAL_LOYALTY_NATIVE_KILLED`; enemies/creatures: queen-monster death, `ubArmyGuysKilled++` +
      `TrackEnemiesKilled`, our killer → `MORALE_KILLED_ENEMY`, `GLOBAL_LOYALTY_ENEMY_KILLED`,
      `CheckForAlertWhenEnemyDies`, reset the chosen one, Deidranna/queen morale and loyalty. Unless crow, cow or
      final damage from bleeding: our killer `StatChange(EXPERAMT, 10 × victim.bExpLevel)`, our assister `5 ×`.
      Militia killer `ubMilitiaKills++`. Dealer inventory to the ground, `ProcessQueenCmdImplicationsOfDeath`,
      `CheckForEndOfBattle` (no-op while busy > 0).
   c. Our killer `usKills++`, `usPlayerKills++`; militia killer `ubMilitiaKills += 2` (so a militia kill counts 3;
      = V). Assister = `previous_attacker`, or `next_to_previous_attacker` if that equals the killer; ours →
      `usAssists++`, militia `+1`.
3. **`TurnSoldierIntoCorpse`** (`Rotting_Corpses.cc:609-760`): corpse type from `gubAnimSurfaceCorpseID[body][state]`
   (so the final death state picks the corpse sprite); items: robot none, queen monster drops 6 − (difficulty − 1)
   jars two rows south, else every inventory slot not `UNDROPPABLE` (always for our team or with policy
   `drop_everything`) and not `ITEM_DEFAULT_UNDROPPABLE`; non-player ammo stacks become `1 + main.int(count)` clips
   (slot order); visibility: ours/Queen visible, others hidden unless `all_dropped_visible`; keys; then
   `AllSoldiersLookforItems`; non-player → `TacticalRemoveSoldier`, ours → `RemoveSoldierFromGridNo`; add the corpse.
4. `RemoveManAsTarget` (public and personal opplists cleared, `OppList.cc:2075`), `BetweenTurnsVisibilityAdjustments`.
5. Non-player and not external death → `ReleaseSoldiersAttacker`.

Our merc after the skull UI: `ReleaseSoldiersAttacker` (unless external death), then `HandlePlayerTeamMemberDeath`
(`Overhead.cc:2183-2271`): opplist verify, buddy quotes, Slay/robot facts, `StrategicHandlePlayerTeamMercDeath`
(insurance, history, morale), `CheckForEndOfBattle`, reselect.

### 5.11 Bleeding, bandages, shock, getting up, stat loss

- **Bleeding.** `bBleeding` = unbandaged lost life; bandaged life = `bLifeMax − bLife − bBleeding`. A gun, blade or
  blast hit adds exactly the life lost; hand-to-hand adds 1; gas adds none. Every damage call restarts
  `dNextBleed = 1 + effectiveLife / (10 + bTilesMoved)` (float; V `(bLife + bandaged/2) / (10 + tiles)` in integers).
- **`CheckBleeding`** at each `EVENT_BeginMercTurn` (team turn start; every 5 s for everyone in real time,
  `Tactical_Turns.cc:105-150`), only if `bLife != 0` and (`bBleeding > 12` or `bLife < 15`) and nobody is treating
  him: blood amount `trunc((bBleeding − 12)/10)` capped 7 if he didn't move; `dNextBleed -= 1` (combat) or `0.5`
  (real time); at ≤ 0: bandaged and `bLife >= 15` → `bBleeding++` (bleeds through, no damage); else if dying
  (`bLife < 15`): first conscious time the dying quote; if `bLifeMax >= 15` → **permanent** `bLifeMax--`,
  `bBleeding--` (profile mirrored) — then in both non-bandaged cases `SoldierTakeDamage(1, 100, BLOODLOSS)`;
  starting-to-bleed quote; recompute `dNextBleed` (`Soldier_Control.cc:7804-7924`).
- **Shock.** `bShock += combined` per hit; halved at each `EVENT_BeginMercTurn` (`:4031`), zeroed for our team at
  battle start (`Overhead.cc:5984`). Effects: −5 CTH per point (gun, melee attacker/defender, throw:
  `AIM_PENALTY_PER_SHOCK`, `Weapons.cc:2195, 3301, 3367, 3648`), −1 interrupt duel point per point
  (`TeamTurns.cc:1196`), AI and skill-check conditions.
- **Getting up** (`BeginSoldierGetup`, `:5266-5343`, at turn start and from 497): if collapsed and `bLife >= 15`,
  `bBreath >= 10`, no sleep drug → merc: from forward/prone poses `ChangeSoldierStance(CROUCH)`, from back/flyback
  poses `ROLLOVER` (437 then reverses direction and gets up); others `END_COWER`. Else `bTurnsCollapsed++` (boxing
  KO logic). Not collapsed but drugged → `pre.int(100) < succumbChance` → full breath loss and collapse.
  `bSleepDrugCounter--` at the end.
- **Stat loss** from criticals is decided and applied inside `BulletImpact` (§4.2); nothing further happens in the hit
  path. `bLifeMax` only drops through dying bleeds (above).
- **`sDamage` window**: a presentation timer with a gameplay effect, see §4.2.
- **Blood** (`TileEngine/Smell.cc:339-470`): a new pool draws `main.int(3)` for its decay time; drawing it (visible,
  gore on) draws `main.int(4)`. Gameplay-relevant only through creature smell.
- **Fragile items** on falls: 721 in `FALLFORWARD_FROMHIT_STAND` → `CheckEquipmentForFragileItemDamage(20)` (jars;
  `pre` per item). The 722 branch for `FALLFORWARD_FROMHIT_CROUCH` is dead (that script has no 722).

### 5.12 Turn-based vs real time

| Effect | Turn-based (`INCOMBAT`) | Real time |
|---|---|---|
| AP loss `life/4`, falls 4 (crouch 2) | applied (floor/debt rules §5.3) | none; breath only |
| Shock halving, bleeding tick, getting up | at the soldier's team turn start | every 5 s `HandleTacticalEndTurn` for all; bleed tick 0.5 |
| Animation speed | fixed-speed hit/death states unchanged; unseen soldiers delay 0 | table speed |
| Busy barrier | blocks interrupts, defers noise and AI | still counted (muzzle flash cleared at 0) |
| Locate camera on our hit merc | yes | no |

### 5.13 RNG calls in order (one bullet, after `BulletImpact`)

1. `main` head item slot `Random(2)`, then `Random(impact/2)` if occupied (head hits); spit goggles `Random(impact/2)`.
2. `main` `Random(100)` touchy neutral (our firer, no target, neutral not Kingpin/hicks).
3. `pre` pass-through `PreRandom(100)`, then armour rolls inside `TotalArmourProtection` if it succeeds.
4. `main` blood pool `Random(3)` / graphic `Random(4)` (pass-through spray).
5. `EVENT_SoldierGotHit`: `pre` sleep-dart succumb → `SoldierTakeDamage`: `pre` equipment (blasts), `main`
   bloodloss `Random(2)` (unprofiled hostiles), **`main` weapon drop `Random(100)`** (every non-bleed hit on a
   non-robot), `main` blood, `pre` `StatChange` loops (explosives for the attacker, experience for our target).
6. cosmetic impact/grunt sounds; `main` `Random(2)` civilian `CIV_DIE2`.
7. Entering the hit state: `main` `Random(10)` start (burning/exploding), `Random(50)` fall side (leg fall-down via
   `SoldierCollapse`, blast fall forward), **478: `Random(100)` [+ `Random(50)`]**.
8. Later frames: **433: `Random(100)` [+ `Random(50)`]**; `Random(10)` curse on release; 447 none;
   `HandleSoldierDeath`: `Random(3)` laugh, `pre` kill/assist `StatChange`, `Random(60)` (Pablo), ammo
   `1 + Random(n)` per ammo slot; getting up: `pre` sleep-drug roll at turn start.

## 6. Melee: knife, punch, steal

### 6.1 Flow

1. **Order** (`Handle_Items.cc:435-497` punch, `:792-842` blade). Find an adjacent tile: for punches first a neighbour
   from which the target is directly reachable, else `FindAdjacentGridEx`; blades use `FindAdjacentGridEx` (bloodcats
   and distant creatures: `FindNextToAdjacentGridEx`). Not adjacent → set a pending action
   (`MERC_PUNCH`/`MERC_KNIFEATTACK`) and walk there first; the attack begins on arrival. **No AP check here**; UI and AI
   check affordability (`CalcTotalAPsToAttack`, §1.5, which includes the walk). Queen tentacles (`IC_TENTACLES`) pay at
   order time and play `QUEEN_SWIPE` (`:844-853`; damage at opcode 755 → `DishoutQueenSwipeDamage`,
   `Weapons.cc:3815-3867`).
2. **Begin** — `EVENT_SoldierBeginBladeAttack` (`Soldier_Control.cc:6574-6716`) / `EVENT_SoldierBeginPunchAttack`
   (`:6720-6836`): busy +1; snap direction (no turning steps; the turn still charges `AP_LOOK_*` through `EVENT_SetSoldierDesiredDirection`). Blade animation: target standing or
   crouched and unaware of the attacker (`opp == NOT_HEARD_OR_SEEN`, other team) → `STAB`; aware → **`CoinToss()`
   (main)** `STAB`/`SLICE`, and the target is stopped (`EVENT_StopMerc`, AI `CancelAIAction`) and turned toward the
   attacker; target prone → crouch first and `CROUCH_STAB`; empty tile → `DECAPITATE` on a valid corpse else
   `CROUCH_STAB`. Monsters/bloodcats have their own states. Punch: martial artists (not with a crowbar) →
   `NINJA_GOTOBREATH` then `DoNinjaAttack`; else target standing or crouched → `PUNCH` (crowbar: `CROWBAR_ATTACK`), and
   if the target is **unaware** he is stopped and turned (the opposite of the blade rule; quirk, keep); target prone →
   `PUNCH_LOW` after crouching (civilian bodies just `PUNCH`). Both set `sTargetGridNo`, `bTargetLevel = bLevel`,
   `target`; punch also sets `sLastTarget`.
3. **Animation** (`Ja2bin.dat`): `STAB`/`SLICE` 70 ms: `757 [0-6] 727 492 [7-8] 430 [9-14] 442 → KNIFE_GOTOBREATH`
   (`[0-3] 442 753 → KNIFE_BREATH`); `CROUCH_STAB` `757 … 492 … 430 … 753 442 499`; `PUNCH` 70 ms `757 [0-5] 727 492
   [6-8] 430 [9-15] 753 442 468`; `PUNCH_LOW` has no dodge; `NINJA_PUNCH`/`_LOWKICK`/`_SPINKICK` 50–70 ms with 492 a few
   frames before 430 (spin kick: 430 on frame 34, no dodge); `CROWBAR_ATTACK` 430 on frame 9. **492**
   (`Soldier_Ani.cc:1515-1551`): the soldier on `sTargetGridNo`, if a merc body that sees the attacker (or is a
   team-mate) and is standing, is stopped (AI action cancelled), turned and put into `DODGE_ONE` (purely visual; the
   outcome is not decided yet). **430** → `FireWeapon` → `UseBlade` / `UseHandToHand`. **468** end of punch (NPC
   approach triggers, back to the breath/standing state).
4. **Resolution at 430** (below). A hit is delivered by `AddGameEvent(EV_S_WEAPONHIT, 20 ms)`: `WeaponHit` →
   `EVENT_SoldierGotHit` runs **> 20 ms later** (first 5 ms tick with `now − stamp > 20`, i.e. 25 ms). A miss calls
   `FreeUpAttacker` at once.

### 6.2 `CalcChanceHTH(att, def, aim, mode)` (`Weapons.cc:3215-3487`)

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

### 6.3 `UseBlade` (`Weapons.cc:896-1035`)

```ts
deductPoints(s, calcTotalAPsToAttack(s, grid, false, s.aimTime), 0);   // APs paid at the strike frame
const t = whoIsThere(grid, s.targetLevel);                          // whoever is on the tile NOW
if (!t) { freeUpAttacker(s); goto smell; }
s.flags |= ATTACK_NOTICED; t.intendedTarget = true; s.opponent = t;
const surprise = t.opp[s] === NOT_HEARD_OR_SEEN || t.life < OKLIFE || t.collapsed;
const cth = surprise ? 100 : calcChanceToStab(s, t, s.aimTime);
const roll = pre(100);
if (roll <= cth) {
  let imp = hthImpact(s, t, cth - roll, blade = true);              // §6.5
  imp = idiv(imp * wsm(blade.status), 100);
  imp = adjustImpactByHitLocation(imp, s.aimShotLocation).dmg;      // head ×1.5, legs ×¼
  if (surprise) imp = idiv(imp*3, 2);
  imp = max(imp, 1);
  if (blade.status > 10) { const adj = idiv(blade.status, 10); const maxDrop = adj > 2 ? clamp(idiv(imp, 20), 2, adj) : 2;
                           blade.status -= i8(main(maxDrop)); }      // dulling
  addGameEvent(WEAPONHIT{ target: t, weapon, damage: i16(imp), breathLoss: 0, dir: dirFromGrid(s.gridNo, t),
                          x: t.x, y: t.y, z: 20, range: 1, attacker: s, special: NO_SPECIAL }, 20);
} else { agilityForEnemyMissingPlayer(s, t, 10); freeUpAttacker(s); }
if (ourTeam(s) && s.target) statChange(s, DEXTAMT, modifyExpGainByTarget(knifeXp(cth, hit), s.target), hit ? SUCCESS : FAILURE);   // §10
smell: if (s.monsterSmell > 0 && main(5) === 0) s.monsterSmell--;
```

### 6.4 `UseHandToHand(s, grid, steal)` (`Weapons.cc:1041-1265`)

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
4`, `Soldier_Control.cc:2744`; §5).

### 6.5 `HTHImpact(att, tgt, hitBy, blade)` (`Weapons.cc:3119-3167`)

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

RNG per melee strike, in order. Blade: `CoinToss` (aware target, at begin) → `pre(100)` hit roll → hit: `pre(51)` fluke,
`main(maxDrop)` dulling / miss: agility `StatChange` (player defender) → DEX `StatChange` (player attacker) → `main(5)`
smell. Punch: `pre(100)` → [spin kick `pre(cth)`] → STR+DEX `StatChange` (player attacker) or agility `StatChange`
(player defender, miss) → hit: `pre(51)` fluke → `main(5)`. Steal: `pre(100)` → [STR `StatChange`] → [partial success
`pre(100)` drop place] → `main(5)`. Then, 20 ms later, `EVENT_SoldierGotHit` (§5).

Quirk: `EVENT_SoldierBeginPunchAttack` raises the busy count and returns if nobody is on the target tile, and
`UseHandToHand` with an empty tile frees nothing (`Soldier_Control.cc:6731-6739`, `Weapons.cc:1058-1258`), so a punch at
a soldier who stepped away leaks one busy count until the 25 s UI watchdog (inferred). ja2-node has no watchdog: release
the attacker there and log it as a deviation.

## 7. Throwing and launchers

Grenades and rocks are physics objects rolled at the order; launchers (GL, under-barrel GL, mortar) roll at the fire
frame and launch a physics object; the LAW and the tank cannon are explosive bullets (§1.9, §3). Explosions themselves
are specified in `12` §10; this section ends at `IgniteExplosion`.

### 7.0 Which items take which path

| Item class (weapons.json `internalType` / explosives.json `itemClass`) | Examples | Resolver | Projectile |
|---|---|---|---|
| `IC_GRENADE` with `TOSSCURS` | HAND/MINI/STUN/TEARGAS/MUSTARD/SMOKE_GRENADE, BREAK_LIGHT, CREATURE_COCKTAIL | `FireWeapon` default → `UseThrown` (`Tactical/Weapons.cc:409-412`) | physics object |
| `IC_THROWN` (`THROWN` → `NoWeapon(IC_THROWN, TOSSCURS)`, `externalized/WeaponModels.cc:174`) | ROCK, ROCK2 | `UseThrown` | physics object |
| `IC_LAUNCHER` (`LAUNCHER`, `WeaponModels.cc:1347`, `TRAJECTORYCURS`) | GLAUNCHER (range 500), UNDER_GLAUNCHER (450, attachment, `WM_ATTACHED`), MORTAR (550) | `UseLauncher` (`Weapons.cc:1336`) | physics object (the attached launchable: GL_*_GRENADE, MORTAR_SHELL) |
| `IC_GUN`, `NOT_GUN` (`LAW`, `CANNON`, `WeaponModels.cc:1389,1432`) | ROCKET_LAUNCHER (single-use LAW), TANK_CANNON | `UseGun` | **bullet** with `BULLET_FLAG_MISSILE` / `_TANK_CANNON` (`LOS.cc:3262-3269`); explodes C1 / TANK_SHELL on stop or hit (`Weapons.cc:1511-1519, 1622-1646`) |
| `IC_THROWING_KNIFE` | THROWING_KNIFE | `UseGun` | bullet with `BULLET_FLAG_KNIFE` (§1.9, §3); only its CTH is `CalcThrownChanceToHit` (`Weapons.cc:654-657`) |
| any item tossed from the inventory cursor | medkit, ammo, unarmed grenade | `Interface_Items.cc:3505-3553` | physics object, `NO_THROW_ACTION` or `THROW_TARGET_MERC_CATCH`, no CTH, `bMissBy = 0` |

`EXPLOSIVE_GUN(x)` = ROCKET_LAUNCHER or TANK_CANNON (`Item_Types.h:215`). There is no RPG in vanilla data; ROCKET_RIFLE
and AUTO_ROCKET_RIFLE are ordinary guns with `BULLET_FLAG_SMALL_MISSILE` (§3.1).

### 7.1 Grenade/rock throw: order flow

1. **`HandleItem`** (`Tactical/Handle_Items.cc:188`). Sets `usAttackingWeapon`, `bTargetLevel`; in real time
   `ubAttackBusyCount = 0` (`:218`). Branch `IC_GRENADE | IC_LAUNCHER | IC_THROWN` (`:856`):
   - `sAPCost = MinAPsToAttack(s, target, TRUE)` → `MinAPsToThrow` (`Points.cc:964-989`); `EnoughPoints` or
     `ITEM_HANDLE_NOAPS` (`:893`). **Nothing is deducted here.**
   - `ubAttackingHand = HANDPOS`. For `TOSSCURS` items (`:900-912`): `sTargetGridNo = target`,
     `target = WhoIsThere2(target, level)`, **`ubAttackBusyCount++`**, `fDontChargeTurningAPs = TRUE`, then
     **`FireWeapon(s, target)` immediately** (command time). `SetUIBusy`.
2. **`FireWeapon`** (`Weapons.cc:349`): target == own tile → `FreeUpAttacker`, fail. `opponent = NULL`. Class default →
   `UseThrown`.
3. **`UseThrown`** (`Weapons.cc:1268-1333`), all at command time:
   1. `chance = CalcThrownChanceToHit(s, target, bAimTime, AIM_SHOT_TORSO)` (§7.4).
   2. `roll = PreRandom(100)` [`pre`].
   3. Experience (only `bTeam == OUR_TEAM` and `INCOMBAT`): find a victim on `sTargetGridNo/bTargetLevel` that is not on
      the thrower's team, else the first of the 8 neighbours (`NUM_WORLD_DIRECTIONS` order 0..7) holding a non-teammate.
      Quirk (V and Strac): if no neighbour qualifies, the loop variable keeps the occupant of direction 7, so a teammate
      (or anyone) standing there still counts as a victim. If found: `StatChange(STRAMT, 5, SUCCESS)`; then `roll <
      chance` ? `DEX 5 SUCCESS, MARK 5 SUCCESS` : `DEX 2 FAILURE, MARK 2 FAILURE`. Each `StatChange` draws `pre`
      `PreRandom(100)` once per chance (`Campaign.cc:261`; may stop early on `FROM_FAILURE`, `:216-221`; none for
      non-profile/NO_EVOLUTION).
   4. `CalculateLaunchItemParamsForThrow(s, target, bTargetLevel, bTargetLevel*256, &inv[HANDPOS],
      i8(roll − chance), THROW_ARM_ITEM, null)` (§7.5, §7.6). Stores a copy of the hand object in `pTempObject` and the
      launch vector in `pThrowParams`.
   5. `HandleSoldierThrowItem(s, sTargetGridNo)` (§7.7) — sets `target = NULL`.
   6. `RemoveObjs(&inv[HANDPOS], 1)`. **Dev:** Strac refills an emptied hand from another slot holding the same item
      (`:1322-1332`); V does not.
4. Turning (free), then the throw animation; at the release frame (460/461) APs are paid and the object is created
   (§7.7). Flight and landing in §7.9; explosion hand-off in §7.9.6.

**Hit semantics.** `bMissBy = i8(roll − chance)`; `bMissBy ≤ 0` is an exact throw, so the effective accuracy is
`(chance+1)%`, like guns. The experience branch uses `roll < chance` (strict): a roll equal to the chance lands on
target but grants failure XP (quirk, keep).

### 7.2 AP cost (`MinAPsToThrow`, `Points.cc:1692-1742`)

```ts
function minAPsToThrow(s, grid: GridNo): number {        // add_turning_cost is ignored (V comments it out too)
  let ap = AP_MIN_AIM_ATTACK;                              // 0
  if (grid !== NOWHERE) { const t = findSoldier(grid, FIND_SOLDIER_GRIDNO); if (t) grid = t.sGridNo; }
  if (grid !== s.sLastTarget) ap += AP_CHANGE_TARGET;      // 1
  ap += getAPsToChangeStance(s, ANIM_STAND);               // from gAnimControl[usAnimState].ubEndHeight: crouch 2, prone 4
  const fullAP = calcActionPoints(s);
  const top = 2 * fullAP;
  const bottom = idiv(TOSSES_PER_10TURNS * (50 + idiv(s.bDexterity, 2)), 10);   // 18; RAW bDexterity, not effective
  ap += idiv(idiv(100 * top, bottom) + 1, 2);
  return clamp(ap, 1, fullAP);                             // min(ap, fullAP), then max(ap, 1)
}
```

When it is evaluated matters:
- **Command time** (`HandleItem:893`, UI cursor `UI_Cursors.cc:812-814`): the merc is still in his own stance, so the
  stand-up cost and `AP_CHANGE_TARGET` count toward `EnoughPoints`.
- **Release frame** (`Soldier_Ani.cc:860`): `DeductPoints(MinAPsToThrow(s, sTargetGridNo))`. The merc is now in
  `THROW_ITEM`/`LOB_ITEM` (`ubEndHeight = STAND`), so the stance term is **0**, and entering that animation reset
  `sLastTarget = NOWHERE` (`Soldier_Control.cc:1360-1370`: neither state is `ANIM_FIREREADY`), so `AP_CHANGE_TARGET`
  is **always** charged (inferred from the two reads). Net cost paid = `1 + aim formula`, capped.
- Non-armed tosses (`ubActionCode != THROW_ARM_ITEM`) pay `AP_TOSS_ITEM = 8` at release (`Soldier_Ani.cc:865`,
  `Points.h:50`).
- Aim time is never charged for throws (only `MinAPsToThrow` is deducted) but still adds `+10·bAimTime` CTH. The
  player's toss cursor has no aim refinement, so `bAimTime = bShownAimTime/2` is normally 0 (`Handle_UI.cc:2140`,
  `UI_Cursors.cc:1003-1027`, inferred). The AI sets `bAimTime = ubMaxPossibleAimTime` (≤ `AP_MAX_AIM_ATTACK` 4) for
  throws (`TacticalAI/Attacks.cc:831, 888`; `DecideAction.cc:3176`) and so gets up to +40 CTH for free (inferred).
- Turning before a throw is free (`fDontChargeTurningAPs`, `Handle_Items.cc:909`).

### 7.3 `CalcMaxTossRange(s, item, fArmed)` in tiles (`Weapons.cc:3525-3581`)

```ts
function calcMaxTossRange(s, item, armed): number {
  if (item === ROCKET_LAUNCHER || item === TANK_CANNON) return idiv(weapon(item).usRange, 10);
  const launcher = getLauncherFromLaunchable(item);       // first weapon whose calibre matches the explosive calibre
  if (armed && launcher !== NOTHING) item = launcher;     // 40mm → GLAUNCHER (never UNDER_GLAUNCHER), shell → MORTAR
  let r: number;
  if (itemClass(item) === IC_LAUNCHER && armed) r = idiv(weapon(item).usRange, 10);   // GL 50, UGL 45, MORTAR 55
  else {
    if (flags(item) & ITEM_UNAERODYNAMIC) r = 1;
    else if (itemClass(item) === IC_GRENADE)
      r = 2 + idiv(idiv(effectiveStrength(s) * 2 + 100, 3), Math.min(3 + idiv(weight(item), 3), 4));
    else r = 2 + idiv(effectiveStrength(s), 5 + weight(item));          // rocks, knives, tossed items
    r -= idiv(r * (100 - s.bBreath), 200);                                // lose up to half for breath
    r = idiv(r * (100 + 12 * numSkillTraits(s, THROWING)), 100);          // gbSkillTraitBonus[THROWING] = 12
  }
  return Math.max(r, 1);
}
```

`getLauncherFromLaunchable` (`Items.cc:766`) iterates `GCM->weapons()` in item order, so GL grenades map to GLAUNCHER
(VanillaWeapons unit test). Weight is `ubWeight` (tenths of kg). V applies the trait multiplier only when
`HAS_SKILL_TRAIT` (same result).

### 7.4 `CalcThrownChanceToHit(s, grid, aimTime, aimPos)` (`Weapons.cc:3585-3735`)

Used for grenades, rocks, launchers (GL, UGL, mortar) and throwing knives; `aimPos` is unused.

```ts
function calcThrownChanceToHit(s, grid, aimTime): number {
  const hand = s.bWeaponMode === WM_ATTACHED ? UNDER_GLAUNCHER : s.inv[HANDPOS].usItem;
  const mechanical = itemClass(hand) === IC_LAUNCHER || s.bWeaponMode === WM_ATTACHED;
  let c: number;
  if (!mechanical) c = idiv(effDex(s) + effMrk(s), 2) + 12 * numSkillTraits(s, THROWING);
  else c = idiv(effDex(s) + effMrk(s) + effWis(s) + 10 * effExpLevel(s), 4) + 15 * numSkillTraits(s, HEAVY_WEAPS);
  c += getMoraleModifier(s);                                  // Morale.cc:70 (shared with gun CTH)
  c -= getSkillCheckPenaltyForFatigue(s, c);                  // SkillCheck.cc:140 (shared)
  if (grid === s.sLastTarget) c += AIM_BONUS_SAME_TARGET;     // 10
  if (aimTime) c += 10 * aimTime;                             // policy aim_bonus_per_std_ap = 10
  if (s.uiStatusFlags & SOLDIER_GASSED) c -= 50;
  if (s.ubServiceCount > 0) c -= 20;                          // being bandaged
  if (s.bShock) c -= 5 * s.bShock;
  let range = getRangeInCellCoordsFromGridNoDiff(s.sGridNo, grid);   // trunc(hypot(dCol, dRow) * 10), world units
  if (wearsHeadGear(s, SUNGOGGLES) && lightTrueLevel(grid, s.bTargetLevel) < NORMAL_LIGHTLEVEL_DAY)
    range -= idiv(range, 10);
  if (hand === MORTAR && range < MIN_MORTAR_RANGE /*150*/) return 0;  // BEFORE the clamp: 0, not 1
  const maxR = calcMaxTossRange(s, hand, true) * 10;
  c += idiv(50 * 2 * (idiv(maxR, 2) - range), maxR);          // +50 at 0, 0 at half range, −50 at max
  if (range > maxR) c = idiv(c, 2);
  if (c > 0 && s.bLife < s.bLifeMax) {
    let pen = i8(idiv(2 * c * (s.bLifeMax - effectiveLife(s)), 3 * s.bLifeMax));  // INT8 bPenalty
    if (itemClass(hand) === IC_LAUNCHER) pen = idiv(pen, 2);
    c -= idiv(pen * (100 - 10 * (effExpLevel(s) - 1)), 100);
  }
  if (c > 0 && s.bBreath < 100) {
    let pen = i8(idiv(c * (100 - s.bBreath), 200));
    if (itemClass(hand) === IC_LAUNCHER) pen = idiv(pen, 2);
    c -= idiv(pen * (100 - (effDex(s) - 10)), 100);
  }
  if (c > 0 && itemClass(hand) === IC_LAUNCHER)
    c = idiv(c * weaponStatusMod(s.inv[HANDPOS].bStatus[0]), 100);   // ≥85 → 100, else x*100/85
  return clamp(c, 1, 99);                                     // policy chance_to_hit_minimum/maximum
}
const effectiveLife = (s) => s.bLife + idiv(s.bLifeMax - s.bLife - s.bBleeding, 2);   // Soldier_Control.h:821, INT8
```

Notes:
- `bPenalty` is `INT8`; with very high chances (~200+, e.g. trait + aim + short range) and heavy wounds it can wrap
  negative and *raise* the chance. Keep `i8`.
- With a UGL, the status used for the final multiplier is the **rifle's** `bStatus[0]` (`inv[HANDPOS]`), not the
  attachment's (quirk).
- **Dev vs V** (`V Tactical/Weapons.c:3761-3900`): mechanical base uses `bExpLevel` (raw, not ×10) in V; injury term
  is `lifeMax − life + bandaged/2` in V (bandaging *hurts*) vs `lifeMax − effectiveLife` in Strac; sun goggles always
  give the −10% range in V, only in light brighter than normal day in Strac.

### 7.5 Miss deviation (`CalculateLaunchItemParamsForThrow`, `TileEngine/Physics.cc:1717-1835`)

```ts
function launchParamsForThrow(s, grid, level, endZ, item, missBy /*INT8*/, action, catchTarget) {
  s.target = whoIsThere2(grid, level);                     // intended tile, before deviation
  const armed = action === THROW_ARM_ITEM;
  if (missBy < 0) missBy = 0;
  if (missBy > 0) {
    missBy = clamp(missBy, 1, 30);
    let maxRadius = 5;
    const pyth = pythSpacesAway(grid, s.sGridNo);          // trunc(hypot) tiles
    if (pyth < 5 / 1.5) maxRadius = idiv(pyth, 2);         // pyth ≤ 3 → 0 or 1
    let maxMiss = Math.trunc(maxRadius * f32(missBy / 30)); // INT8 of float
    if (maxMiss > 4) maxMiss = 4;
    let minMiss = Math.max(maxMiss - 1, 2);
    if (maxMiss < minMiss) maxMiss = minMiss;
    grid = randomGridFromRadius(grid, minMiss, maxMiss);
  }
  const { force, degrees } = launchItemBasicParams(s, item, grid, level, endZ, armed);   // §7.6
  // vector: from thrower's tile centre toward the (deviated) tile centre
  const dir = normalize2(centreX(grid) - centreX(s.sGridNo), centreY(grid) - centreY(s.sGridNo));
  const v = { x: dir.x * force, y: dir.y * force, z: f32(Math.sin(degrees)) * force };   // NOT a unit vector
  s.pTempObject = copy(item);                              // whole OBJECTTYPE incl. ubNumberOfObjects
  s.pThrowParams = { x: centreX(s.sGridNo), y: centreY(s.sGridNo),
    z: armed && launcherOf(item) === MORTAR ? s.bLevel * 256 + MORTAR_HEIGHT_UNITS /*50*/ : s.bLevel * 256 + 191,
    force: v, lifeSpan: -1, action, target: catchTarget };
}

function randomGridFromRadius(sweet, minR, maxR): GridNo {   // Physics.cc:2169-2218
  if (maxR === 0 || minR === 0) return sweet;
  for (let cnt = 0;;) {
    let x = preRandom(maxR), y = preRandom(maxR);           // [pre] ×2
    if ((x < minR || y < minR) && maxR !== minR) continue;  // re-roll both; not counted
    if (preRandom(2) === 0) x = -x;                         // [pre]
    if (preRandom(2) === 0) y = -y;                         // [pre]
    const leftmost = Math.trunc((sweet + 160 * y) / 160) * 160;
    const g = sweet + 160 * y + x;
    if (g === sweet) continue;                              // not counted
    if (++cnt > 50) return NOWHERE;
    if (g >= 0 && g < WORLD_MAX && g >= leftmost && g < leftmost + 160) return g;
  }
}
```

Resulting landing offsets (target tile ± (dx, dy) in tiles) — note the "radius" is a square, and the min-radius
rule forces exact diagonals:

| `missBy` (after clamp) | `maxMiss`→(min,max) | Offsets |
|---|---|---|
| 1–17, or any when `pyth ≤ 3` | (2,2) | dx, dy ∈ {−1,0,1}, not (0,0) |
| 18–23 | (2,3) | dx, dy ∈ {±2} (diagonal corners only) |
| 24–30 | (3,4) | dx, dy ∈ {±3} |

(With `maxR == minR` any `x,y < maxR` passes; with `maxR = minR+1` both must equal `minR`.) V (`Physics.c:2256`) is the
same loop written as `do … while(!fFound)`; `NOWHERE` after 50 counted tries is unhandled downstream (map edge only).

The tile the object actually lands on is decided by physics (§7.9), not by this tile: bounces, walls and the
max-force cap can move it.

### 7.6 Launch angle and force (`CalculateLaunchItemBasicParams`, `Physics.cc:1489-1610`)

```ts
function launchItemBasicParams(s, item, grid, level, endZ, armed) {
  let deg = f32(Math.PI / 4);                               // OUTDOORS_START_ANGLE
  let startZ = s.bLevel * 256 + 191;                        // GET_SOLDIER_THROW_HEIGHT (STANDING_HEIGHT 191.0f → INT16)
  const L = getLauncherFromLaunchable(item.usItem);
  let mortar = false, gl = false, minRange = 0, indoors = false;
  if (armed && (L === MORTAR || item.usItem === MORTAR)) { startZ = s.bLevel * 256 + 50; mortar = true; minRange = 150; }
  if (armed && [GLAUNCHER, UNDER_GLAUNCHER].includes(L || item.usItem)) {
    deg = level === 1 ? f32(Math.PI / 6) : f32(Math.PI / 8); gl = true; minRange = 150;
  }
  if (gfCaves || gfBasement) { deg = f32(Math.PI / 30); indoors = true; }
  if (isRoofPresentAtGridno(s.sGridNo) && s.bLevel === 0) { deg = f32(Math.PI / 30); indoors = true; }
  if (isRoofPresentAtGridno(grid) && level === 0) { deg = f32(Math.PI / 30); indoors = true; }
  const window = level === 0 ? soldierToLocationWindowTest(s, grid) : NOWHERE;   // 08 §1.3
  let force = findBestForce(s.sGridNo, grid, startZ, endZ, deg, item);
  let maxF = calculateForceFromRange(calcMaxTossRange(s, item.usItem, armed), f32(Math.PI / 4));  // always 45°
  if (indoors) maxF *= 2;
  if (force > maxF) force = maxF;
  if (mortar || gl) force = Math.max(force, calculateForceFromRange(idiv(minRange, 10), f32(Math.PI / 4)));
  if (window !== NOWHERE) deg = findBestAngle(s.sGridNo, window, s.bLevel * 256 + 191, 150, force, item);
  return { force, degrees: deg };
}

function calculateForceFromRange(tiles, deg) {             // Physics.cc:1680: fake HAND_GRENADE, status 100,
  return findBestForce(4408, 4408 + tiles * 160, 191, 0, deg, handGrenade);   // from tile 4408 straight "south"
}

function findBestForce(src, dst, startZ, endZ, deg, item) { // Physics.cc:1229-1296, float32 except the estimate
  const range = f32(getRangeInCellCoordsFromGridNoDiff(dst, src));
  let F = f32(12 * Math.sqrt((24.5 * range) / f32(Math.sin(f32(2 * deg)))));   // double expression, cast to float
  for (let checks = 1;; checks++) {
    const r = trajectoryRange(endZ, item, startPos(src, startZ), dirTo(src, dst, deg).mul(F));  // test object
    const diff = f32(r - range);
    if (Math.abs(f32(diff / range)) < 0.01) break;
    if (checks > 8) break;                                   // MAX_INTEGRATIONS: at most 9 simulations
    F = f32(F - f32(f32(F * f32(diff / range)) / 2));
  }
  return F;
}
```

- `findBestAngle` (`:1313-1408`) starts at π/8, tolerance 5%, ≤9 checks, `deg -= deg·(diff/range)/2`; if
  `|deg| ≥ π/2` or `≤ 0.005` it returns 0.
- `trajectoryRange` = `CalculateObjectTrajectory` (`:1410-1449`): a `TEST_OBJECT_NO_COLLISIONS` object with
  `TestZTarget = endZ` simulated to death with the real integrator (§7.9.2). It ignores structures. While descending
  below `TestZTarget`: target 256 → treated as a roof hit; target > 32 (the window case, 150) → freeze the measured
  point and continue to the ground; otherwise ground. The measured point keeps following the object through bounces
  and rolling until it rests, so the force search aims the **resting** point at the target tile. Returns
  `hypotf(dx, dy)` of that point from the start.
- Consequences: a GL or mortar cannot shoot shorter than the min force (15 tiles at 45°; at the GL's π/8 that is
  roughly 10–11 tiles on flat ground, inferred). Throws beyond `CalcMaxTossRange` are capped by `maxF` and fall short.
  Indoors (any roof over thrower or ground-level target, caves, basements) the arc is flat (π/30) and `maxF` doubles.
- **Dev vs V:** V uses start Z `level*256` (without +50) for the mortar force search but +50 for the actual launch
  (`V Physics.c:1577, 1906`); Strac uses +50 in both. V `UseLauncher` passes `endZ = 0` instead of
  `bTargetLevel*256` (`V Weapons.c:1746`).

`CalculateLaunchItemChanceToGetThrough` (`:1613-1678`, UI cursor and AI `CalcBestThrow`) runs the same params
through a `TEST_OBJECT_NOTWALLROOF_COLLISIONS` object (structure collisions on, first 3 tiles ignored as in §7.9.3);
returns false if it collided with a wall/window/structure, ended on another level, or (AI) ended off the target tile.
No RNG. Same tile as the thrower → false (Strac guard against an endless loop).

### 7.7 Throw animation and release

`HandleSoldierThrowItem` (`Handle_Items.cc:988-1050`): `target = NULL`; then by `gAnimControl[usAnimState].ubHeight`:
- **Stand**: same tile → `PickDropItemAnimation`. Else `SoldierGotoStationaryStance`, set desired direction,
  `fTurningUntilDone`, pending animation `LOB_ITEM` if `GetRangeFromGridNoDiff < MIN_LOB_RANGE (6)` else
  `THROW_ITEM` (`:76, 1017`). The pending animation starts when the turn completes (`Soldier_Control.cc:4288-4298`).
- **Crouch/prone**: same tile → drop the item at the feet. Else `EVENT_SetSoldierDesiredDirectionForward` and
  `ChangeSoldierState(THROW_ITEM)` directly (no kneel-up animation, so no separate stance AP; the merc pops into the
  standing throw, inferred).

| State | Frames × ms (`gAnimControl` speed) | Gameplay markers | Ends |
|---|---|---|---|
| `THROW_ITEM` | 14 × 80 | f9 **460 release**, f14 442 | → `STANDING` |
| `LOB_ITEM` | 14 × 80 | f7 **461 release**, f14 442 | → `STANDING` |
| `THROW_KNIFE` | 15 × 50 | f0 757 busy+, f9 430 fire, f15 753 busy−, 442, 499 | |
| `SHOOT_ROCKET` (LAW) | 20 × 110 | f0 757, f12 470 + 430, f20 753, 499 | |
| `SHOOT_MORTAR` (crouched) | 71 × 110 | f0 757, f37 470 + 430, f71 753, 499 | |
| `CATCH_STANDING` / `_CROUCHED` | 5 / 4 × 80, loop | – | until `END_CATCH` / `END_CROUCH_CATCH` (5 / 4 × 80, 499) |

`THROW_ITEM`/`LOB_ITEM` are `ANIM_NONINTERRUPT`. Order to release without turning: 9 × 80 = 720 ms (`04` §1).

**Opcode 460/461** (`Soldier_Ani.cc:849-883`), only if `pTempObject && pThrowParams`:
1. `THROW_ARM_ITEM` → `DeductPoints(MinAPsToThrow(s, sTargetGridNo))`; else `DeductPoints(AP_TOSS_ITEM)`.
2. `CreatePhysicalObject(pTempObject, params…, owner = s, action, target)` (§7.9.1).
3. Free `pTempObject` and `pThrowParams`.

**Aborts before release** (no AP spent, roll already consumed):
- An AI soldier who sights an enemy while `pTempObject` is set: `HaultSoldierFromSighting(…, TRUE)`
  (`Soldier_Control.cc:7271-7306`, callers `OppList.cc:695, 2418, 2438`) or `HandleSystemNewAISituation` for a
  soldier under AI control with `IS_NEW_SITUATION` (`:8774-8813`): `AutoPlaceObject(pTempObject)`, clear it, cancel
  the pending animation, `ReduceAttackBusyCount`. `pThrowParams` is left allocated (harmless). **Quirk:**
  `pTempObject` is a copy of the whole hand stack taken *before* `RemoveObjs(…, 1)`, so returning it can duplicate
  stacked grenades (inferred; kept: `haltFromSighting` returns the copy as the original does). ja2-node ports the
  halt (`perception/wiring.ts`); `HandleSystemNewAISituation` is still the no-op `newAiSituation` hook (`27` §14).
- Hit while in `THROW_ITEM`/`LOB_ITEM`/`SHOOT_ROCKET`/`SHOOT_MORTAR`: `EVENT_SoldierGotHit` calls
  `ReduceAttackBusyCount` (`Soldier_Control.cc:2636-2645`). If the hit animation replaces the throw before 460, the
  object in `pTempObject` is never launched and is lost at the next `SetTempObject` (inferred).

### 7.8 Launchers

**GL / UGL / mortar order flow.**
1. `HandleItem` launcher branch (`Handle_Items.cc:856-921`): `sAPCost = MinAPsToAttack(…, TRUE)` (gun formula,
   `MinAPsToShootOrStab`; for `WM_ATTACHED` the item is `UNDER_GLAUNCHER`, `Points.cc:966-972`). Mortar: needs
   `OKFallDirection` on the tile in front, else `ITEM_HANDLE_NOROOM`; sets `fDontChargeAPsForStanceChange`. GL:
   `GetAPChargeForShootOrStabWRTGunRaises` decides `fDontChargeTurningAPs` (standing) or `fDontChargeReadyAPs`.
   `EnoughPoints`; cursor is `TRAJECTORYCURS` → `SendBeginFireWeaponEvent`. The UI passes `UNDER_GLAUNCHER` as the
   hand item in `WM_ATTACHED` (`Handle_UI.cc:2223`), so `usAttackingWeapon = UNDER_GLAUNCHER`.
2. `EVENT_FireSoldierWeapon` (`Soldier_Control.cc:2111-2214`): `ubAttackBusyCount++`, `target = WhoIsThere2`.
   `bBulletsLeft` is set only if the *hand* item is a gun (LAW: 1; rifle with UGL: 1, ×8 if buckshot is loaded,
   unused). `isLauncher() || ROCKET_LAUNCHER` → **fire right away**: direction snapped
   (`EVENT_SetSoldierDirection`), `SelectFireAnimation` → `SHOOT_ROCKET` (LAW), `SHOOT_MORTAR`, else the normal
   stance fire animation (GL). A UGL goes through the rifle's ready/turn path (`fTurningToShoot`).
3. **470** `OKFireWeapon` → `CheckForGunJam`: only `IC_GUN && !EXPLOSIVE_GUN`, so launchers and LAWs never jam
   (`Weapons.cc:244-249`).
4. **430** → `FireWeapon` → `UseLauncher` (`Weapons.cc:1336-1433`), at the fire frame:
   1. `EnoughAmmo(s, TRUE, ubAttackingHand)` else return (no busy decrement, inferred leak).
   2. First attachment of the hand object that `isExplosive()` → `Launchable` (with its status). None → return.
   3. Remove it: `usAttackingWeapon == hand item` → `DeductAmmo(HANDPOS)` (removes the first `IC_GRENADE`, else
      `IC_BOMB` attachment, `Points.cc:1385-1398`); else (UGL) `RemoveAttachment(that slot)`.
   4. `WillExplosiveWeaponFail(s, inv[HANDPOS])` (`:3870-3886`): only if `bTeam == OUR_TEAM || bVisible == 1`:
      `i8(pre(40) + pre(40)) > bStatus[0]` → `pre(2) == 1` → fail. On fail: `IgniteExplosion(s, 0, s.sGridNo,
      Launchable.usItem, s.bLevel)`, `ReduceAttackBusyCount`, return (**no AP deducted**, round lost).
   5. Sound (no `MakeNoise` for the launch itself).
   6. `chance = CalcThrownChanceToHit(s, target, bAimTime, TORSO)` (mechanical branch); `roll = pre(100)`.
   7. AP: `IC_LAUNCHER` → `MinAPsToAttack(s, target, TRUE)` (else `MinAPsToThrow`, unreachable in practice);
      `DeductPoints`. Aim is not charged.
   8. `CalculateLaunchItemParamsForThrow(s, sTargetGridNo, bTargetLevel, bTargetLevel*256, &Launchable,
      i8(roll − chance), THROW_ARM_ITEM, null)` (§7.5/§7.6) and **`CreatePhysicalObject` immediately**; free temp
      object and params. `s.target` = occupant of the intended tile.
   9. No experience is granted for launcher shots.
   10. Mortar CTH is 0 under 15 tiles (§7.4): any roll ≥ 1 misses by `roll`; roll 0 is an exact hit.
5. The end of the 430 frame's busy accounting: GL busy +1 (fire event) is released when the physics object dies.
   `SHOOT_MORTAR`/`SHOOT_ROCKET` also carry their own 757/753 pair.

**LAW (ROCKET_LAUNCHER) and tank cannon** go through `UseGun` and the bullet code; only their specifics here:
- CTH: `CalcChanceToHitGun` with the base marksmanship replaced by the mechanical formula
  `idiv(effDex + effMrk + effWis + 10·effExp, 4) + 15·HEAVY_WEAPS traits` (`Weapons.cc:2003-2009`); all other gun
  modifiers apply (§2). Tank range penalties `:2391-2414, 2485-2488`.
- In `UseGun` (`:787-801`), after the marksmanship XP and before `FireBulletGivenTarget`: `WillExplosiveWeaponFail`
  (same draws as above). On fail: the hand becomes `DISCARDED_LAW`, `IgniteExplosion(C1)` on the shooter's tile,
  `ReduceAttackBusyCount` — **and the rocket is still fired** (no return; quirk).
- After firing (`:826-842`): hand → `DISCARDED_LAW`; back-blast: a non-prone soldier on the tile directly behind
  (`OppositeDirection(bDirection)`) gets `ubAttackBusyCount++` and `EVENT_SoldierGotHit(MINI_GRENADE, damage 10,
  breath 200, dir = shooter's direction, range 0, special 0, ANIM_CROUCH)`.
- The missile stops at the first structure or person: `IgniteExplosion(C1)` at the adjusted tile
  (`:1622-1636`) or `IgniteExplosionXY(C1 / TANK_SHELL)` at the hit point on a soldier (`WeaponHit`, `:1511-1519`),
  each with `FreeUpAttacker`. A missile leaving the map just disappears (`ShotMiss`, `:3170`). Missile velocity drop
  after `2·iRange` applies as for bullets (`LOS.cc:4217-4222`).

### 7.9 Physics (`TileEngine/Physics.cc`)

#### 7.9.1 Object state and creation (`:185-222`)

`REAL_OBJECT` (`Physics.h:28-82`, 50 slots, `vector_3` of float32). `CreatePhysicalObject(obj, lifeLength, x, y, z,
Fx, Fy, Fz, owner, action, target)`:

```ts
o.position = { x, y, z };                                   // world units x/y (10 per tile), height units z (256/storey)
o.initialForce = { x: f32(f32(Fx / 256) * 10), y: f32(f32(Fy / 256) * 10), z: Fz };   // SCALE_VERT_VAL_TO_HORZ
o.initialForce = o.initialForce.mul(f32(1.5 / 1.8));        // 0.8333333
o.velocity = 0; o.alive = true; o.visible = true; o.dropItem = true; o.firstTimeMoved = true;
o.lastDamaged = NOBODY; o.gridNo = gridOf(o.position);      // trunc(y)/10 row, trunc(x)/10 col, NOWHERE if outside
```

Z is measured from 0 regardless of the tile's terrain height (`sHeight` is only added when drawing, `:1210-1218`;
inferred from `CheckForCollision` using raw Z).

#### 7.9.2 Tick and integration

- `SimulateWorld` (`:238-256`) runs once per main-loop frame, before bullets and `ExecuteOverhead`
  (`GameScreen.cc:343`), gated by the 20 ms `PHYSICSUPDATE` timer (`Utils/Timer_Control.cc:24`). All allocated
  objects in slot order.
- `SimulateObject` (`:286-336`):

```ts
const DT = f32(1.8), SUB = f32(DT / 10);                    // 0.18f
function simulateObject(o) {
  if (!physicsUpdateLife(o, DT)) return;                     // §7.9.5; may delete the object
  if (!o.alive) return;
  o.force = o.initialForce; o.force.z = f32(o.force.z - 24.5);   // gravity
  o.initialForce = 0;                                        // the launch force acts during the first tick only
  if (o.applyFriction) { o.force = o.force.add(o.velocity.mul(-o.appliedMu)); o.applyFriction = false; }
  for (let t = 0; t < DT; t = f32(t + SUB)) {                // float32 accumulation → 11 sub-steps, not 10
    o.oldPosition = o.position; o.oldVelocity = o.velocity;
    o.position = o.position.add(o.velocity.mul(SUB));        // explicit Euler: position uses the old velocity
    if (o.testPositionNotSet) o.testTargetPosition = o.position;
    o.velocity = o.velocity.add(o.force.mul(f32(SUB / 60)));
    // mortar whistle sound at apex (cosmetic)
    const r = handleCollisions(o);                           // §7.9.3
    if (r === END) return;                                   // >30 consecutive collisions
    if (r.code !== COLLISION_NONE) break;                    // rest of the tick is skipped
  }
  physicsMoveObject(o);                                      // §7.9.4
}
```

The sub-step count (11) follows from `0.18f·10 < 1.8f` in float32 (checked with `Math.fround`); the force search uses
the same integrator, so it must match. Life span `dLifeSpan += 1.8` per tick; `dLifeLength = −1` (no limit) for all
throws and launches.

#### 7.9.3 Collisions (`:636-1062`, `CheckForCollision :2221-2504`, `PhysicsHandleCollisions :521-610`)

`CheckForCollision(x, y, z, dx, dy, dz)` at the tile `(trunc(x/10), trunc(y/10))` (out of map → none):
1. `trunc(z) < 0` → `WATER` if the terrain is water, else `GROUND`.
2. No structures on the tile: `z < 0` → ground/water; caves/basement: crossing 256 downward → `ROOF`, upward →
   `INTERIOR_ROOF`.
3. Structures: cube = `trunc(z)/64`; `≥ 8` → none. `< 4` → ground-level structures (`sCubeOffset 0`), else roof-level
   (cube −4). If the tile has a roof (or caves/basement), crossing 256 returns `ROOF`/`INTERIOR_ROOF` first. Then each
   structure of that level in list order whose shape has the LOS cell `(trunc(x)%10>>1, trunc(y)%10>>1)` at that
   cube (soldiers' PERSON structures included, transparency ignored):
   - `WALLNWINDOW` and `87 ≤ z ≤ 220` → `WINDOW_*` (by orientation and sign of dx/dy).
   - `WALLSTUFF` → `WALL_*`, normal `(∓1, 0, 0)` for `ORIENT_RIGHT` walls else `(0, ∓1, 0)`, sign from **dx** in both
     cases (quirk).
   - Else, unless `TREE` or `CORPSE`: the cube above empty (or, at cube 3 on the ground level, any roof-level
     structure without cube 0 at that cell; at roof level cube 3 always) → `ROOF` for roof structures, else
     `STRUCTURE_Z` (landing on top).
   - Else, unless `ubArmour == MATERIAL_LIGHT_VEGETATION` or `CORPSE` → `STRUCTURE` (side hit). Light vegetation and
     corpses never stop objects.

Filters for real objects (`:776-799`): any code other than water, ground, none, roof, interior roof and the 4 walls is
ignored while `fFirstTimeMoved` or `sFirstGridNo == sGridNo`; `STRUCTURE`, `STRUCTURE_Z` (and `MERC`, never returned)
are ignored while `uiNumTilesMoved < 4`. So objects pass through people and furniture for the first 3 tiles; walls,
roofs and ground always count.

Response per code (`:804-1046`); elasticity `e` gives a restitution of `e − 1` along the normal:

| Code | Normal | `e` | Friction next tick (`AppliedMu`) | Extra |
|---|---|---|---|---|
| `WINDOW_*` | – | – | – | non-test: `WindowHit(grid, id, FALSE, TRUE)` breaks it; returns "no collision" (flies on) |
| any, `MORTAR_SHELL` | – | – | – | `OBJECT_DETONATE_ON_IMPACT`: `alive = false` at the first counted collision |
| `GROUND` | (0,0,−1) | 1.3 | 0.34·1.8 | first hit sound; `fHaveHitGround` |
| `WATER` | – | no bounce | 1.54·1.8 | `alive = false`, `fInWater`, hidden; ripple tile animation (50 ms/frame) with keyframe 11 → `IgniteExplosionXY(owner, x, y, 0, grid, item, 0)` for `THROW_ARM_ITEM` objects (`Tile_Animation.cc:301-305`) |
| `ROOF`, `INTERIOR_ROOF` | (0,0,−1) | 1.4 | 0.54·1.8 | |
| `STRUCTURE_Z` | (0,0,−1) | 1.2 | 0.54·1.8 | `CheckForCatcher`, then `CheckForObjectHittingMerc` |
| `WALL_*` | axis normal | 1.1 | – | |
| `STRUCTURE` | −(horizontal unit of the step) | 1.1 | – | `CheckForCatcher`, then `CheckForObjectHittingMerc` |

`PhysicsHandleCollisions` on a collision: if this step moved `|dx| ≤ 0.5 && |dy| ≤ 0.5`,
`sConsecutiveZeroVelocityCollisions++`. If that counter `> 3`: `vx = vy = 0`; for `STRUCTURE_Z`, `ROOF` or `GROUND`
also `vz = 0` and `alive = false` (**at rest**); the code becomes `NONE` (the sub-step loop continues). Otherwise:
position = old position, then `velocity += n · (−e · dot(oldVelocity, n))`. Then `z < 0 → z = 0`. More than 30
consecutive identical collision codes → `alive = false`, end the tick. The counters are only reset by a counted
collision without a bounce (water), never by free flight (quirk). The `OldPosition` x/y swap at `:561-562` is a dead
write.

**Soldier hit** (`CheckForObjectHittingMerc`, `:1858-1872`): structure id `< MAX_NUM_SOLDIERS` (148) and not the
last soldier damaged by this object → `EVENT_SoldierGotHit(s, NOTHING, 1, 0, s.bDirection, 0, owner,
FIRE_WEAPON_TOSSED_OBJECT_SPECIAL, 0, NOWHERE)` → `TAKE_DAMAGE_OBJECT` (no attacker release,
`Soldier_Control.cc:2687-2689, 2772`). Once per soldier per object.

**Catching** (only `THROW_TARGET_MERC_CATCH`, inventory tosses to a merc): in `PhysicsMoveObject` when the object
enters a new tile within `PythSpacesAway < 4` of the target, he starts `CATCH_STANDING`/`CATCH_CROUCHED` once; at
`≤ 1` tile, once: `chance = u8(50 + idiv(effDex, 2))`, fail if `pre(100) > chance` (`:1927-1946`). On collision
with the target's structure, a good catch `AutoPlaceObject`s the item (`fDropItem = false`), plays `END_CATCH`, and
the object dies.

#### 7.9.4 `PhysicsMoveObject` (`:1076-1224`)

New grid from position; first call records `sFirstGridNo`. `NOWHERE` → delete **without** busy-count release
(inferred leak; normally the visible-tile check below fires first). On a tile change: catch check (§7.9.3);
`MORTAR_SHELL` armed and `uiNumTilesMoved > 2` → smoke-trail tile animation with `sDelay = 100 + pre(100)`
(**cosmetic draw on `pre`**, `:1117`, while the object is visible); `uiNumTilesMoved++`.

#### 7.9.5 End of life (`PhysicsUpdateLife`, `:361-470`), run at the start of the next tick

`alive = false` if the life length is exceeded or `!GridNoOnVisibleWorldTile(sGridNo)`. Then, for non-test objects, in
this order:
1. Stop the sound.
2. `THROW_ARM_ITEM && !fInWater` → `HandleArmedObjectImpact` (§7.9.6). Else, unless (in water and the item sinks):
   if `fDropItem` and not armed → `AddItemToPool(grid, obj, VISIBLE, level = lastCollision == ROOF ? 1 : 0)`.
3. Noise: ROCK/ROCK2 → `MakeNoise(owner, grid, level 0, 9 + pre(9), NOISE_ROCK_IMPACT)`; grenades →
   `… NOISE_GRENADE_IMPACT` (volume 9–17; level is always 0; deferred while busy, `08` §3.3).
4. Impact sound if the last collision was ground/roof.
5. **`ReduceAttackBusyCount(owner, FALSE)`**.
6. End a running catch animation.
7. Delete the object.

#### 7.9.6 `HandleArmedObjectImpact` (`:2004-2117`): duds, re-arming, explosion hand-off

```ts
const sZ = Math.trunc(Math.trunc(o.position.z) * 50 / 256);       // CONVERT_HEIGHTUNITS_TO_PIXELS
obj.ubNumberOfObjects = 1;
const dudCheck = isGrenade(obj) || obj.usItem === MORTAR_SHELL;
if (isThrown(obj)) addItemToPool(grid, obj, INVISIBLE, 0);       // rocks: dropped invisibly at level 0
let impact = true;
if (dudCheck) {
  impact = sZ !== 0 || o.inWater ||
    (obj.bStatus[0] >= USABLE /*10*/ && pre(100) < obj.bStatus[0] + pre(50));   // short-circuit: no draws if airborne
  if (!impact) {
    let trapped = 0;
    if (obj.bStatus[0] >= USABLE && pre(100) < obj.bStatus[0] + pre(50)) trapped = pre(4) + 2;
    if (trapped) { flags |= WORLD_ITEM_ARMED_BOMB; obj.bDetonatorType = BOMB_TIMED; obj.bDelay = 1 + pre(2); }
    addItemToPool(grid, obj, INVISIBLE, lastCollision === ROOF ? 1 : 0, flags);
    notifySoldiersToLookforItems();
    if (o.owner) doMercBattleSound(o.owner, CURSE1);              // cosmetic, uses main Random
  }
}
if (explosive && impact) {
  if (light) { if (objectLevel(z) > 0) { if (!blast && !stun && !smoke) addItemToPool(grid, obj, VISIBLE, 1); }
               else newLightEffect(grid, light.radius, light.duration); }
  if (isGrenade && (blast || stun || smoke)) igniteExplosionXY(owner, x, y, sZ, grid, obj.usItem, objectLevel(z));
  if (obj.usItem === MORTAR_SHELL) igniteExplosionXY(owner, x, y, sZ, grid, MORTAR_SHELL, objectLevel(z));
}
const objectLevel = (z) => Math.trunc((z + 10) / 256);            // GET_OBJECT_LEVEL, float division
```

- An object resting anywhere above the ground plane (roof, table, `sZ ≠ 0`) or in water always goes off.
- The two `PreRandom` calls inside `pre(100) < status + pre(50)` are **unsequenced in C++**; assume left to right
  (`pre(100)` first; Clang order, inferred).
- Dud chance on the ground: `P(pre(100) ≥ status + pre(50))`; a dud re-arms as a timed bomb with the same test again
  (`trapped` is then always ≥ 2), `bDelay` 1–2.
- `IgniteExplosion*` raises the busy count before step 5 releases the throw's count (`Explosion_Control.cc:113`);
  explosion damage is `12` §10.

### 7.10 Fuses and timing

- There are no time fuses on thrown or launched grenades. Hand and GL grenades (and rocks) **detonate when the
  object comes to rest** (or dies at 30 collisions / leaves the visible map), after bouncing and rolling. Mortar
  shells detonate at the **first counted collision**. GL grenades bounce like hand grenades (only `MORTAR_SHELL` is
  `OBJECT_DETONATE_ON_IMPACT`, `:65`).
- In water, armed objects explode 11 ripple frames × 50 ms = 550 ms (tile-animation clock) after splashdown, with no
  dud check. The throw's busy count is released one tick after the splash, before that explosion (inferred). The
  keyframe reads the freed `REAL_OBJECT` slot (`pNode->v.object`), which a new object could reuse (inferred).
- Dud → timed bomb: `bDelay` decremented by `DecayBombTimers` (`Explosion_Control.cc:2054-2095`) in `EndTurnEvents`
  (`TeamTurns.cc:288`, once per round, inferred) and on every 5 s real-time turn (`Tactical_Turns.cc:92`); at 0 it
  joins the bomb queue (`03` §6).
- Flight time is a fixed number of 20 ms physics ticks for given launch parameters; turn-based and real time use the
  same integrator. The turn waits on the busy count until the object dies.

### 7.11 Busy-count accounting

| Event | +/− | Source |
|---|---|---|
| Toss command (`TOSSCURS`) | +1 | `Handle_Items.cc:906` |
| Launcher/LAW fire event | +1 | `Soldier_Control.cc:2125` |
| `SHOOT_ROCKET` / `SHOOT_MORTAR` f0 / end | +1 / −1 | opcodes 757 / 753 |
| Knife throw begin; `THROW_KNIFE` f0 / f15 | +1; +1 / −1 | `Soldier_Control.cc:6845`; 757 / 753 |
| Physics object dies | −1 | `Physics.cc:436` |
| Launcher misfire (`WillExplosiveWeaponFail`) | +1 explosion, −1 | `Weapons.cc:1383-1394` |
| Abort before release; hit during throw/launch animation | −1 | §7.7 |
| LAW back-blast victim hit | +1 (+ hit animation) | `Weapons.cc:842` |

### 7.12 RNG calls in order

**Grenade/rock throw (player, combat):**
1. `pre(100)` hit roll (command time).
2. `StatChange` draws (STR 5, then DEX and MARK 5/5 or 2/2), `pre(100)` per chance, only for our team with a victim.
3. If `missBy > 0`: `RandomGridFromRadius` loop: `pre(max)`, `pre(max)` [reject → repeat], `pre(2)`, `pre(2)`
   [same tile → repeat].
4. Force/angle search: none.
5. Flight: catching `pre(100)` (catch tosses only); soldier hit → `EVENT_SoldierGotHit` (§5.13 draws);
   mortar smoke trail `pre(100)` per new tile after the 2nd.
6. Landing: dud test `pre(100)`, `pre(50)` (only on the ground plane, out of water, status ≥ 10); if a dud: again
   `pre(100)`, `pre(50)`, then `pre(4)`, `pre(2)` if re-armed.
7. Noise volume `pre(9)` (grenades and rocks).
8. Explosion (`12` §10).

**Launcher:** `WillExplosiveWeaponFail` (`pre(40)`, `pre(40)`, maybe `pre(2)`; only for our team or visible
shooters) → `pre(100)` hit roll → `RandomGridFromRadius` → flight/landing as above.

**LAW:** gun order (`CalcChanceToHitGun`, `pre(100)`, marksmanship `StatChange`), then `WillExplosiveWeaponFail`,
then `FireBulletGivenTarget` deviation, then wear `pre(15 + 3·reliability)` (`Weapons.cc:870-875`), then
`Random(2)` smell decay if `bMonsterSmell > 0` (§1.9).

Cosmetic `main` draws in this area (battle sounds, `Random(40)` curse on gun misses) belong to the cosmetic stream
per `deviations.md`.

### 7.13 Determinism and exactness

- **Exact (must match):** `CalcThrownChanceToHit`, `CalcMaxTossRange`, `MinAPsToThrow` and its evaluation points, the
  hit roll, the miss-radius table and every `pre` draw above in order (including the mortar smoke-trail draw), the
  dud logic, the busy-count bookkeeping.
- **Physics:** deterministic per 20 ms tick; the original is frame-rate dependent only through the wall-clock gate
  (one tick per frame at most) and therefore in real time through *where soldiers are* when the object passes. Port
  the integrator in float32 (`Math.fround` after every float operation, 11 sub-steps). Residual risk: the initial
  force estimate uses double `sqrt`/`sin` and `sinf`/`sqrtf` may differ from V8's `Math.sin` in the last ulp, which
  can rarely change a landing tile. `docs/02` §(c) accepts approximate grenade spread; log any divergence.
- Recommendation: one physics tick per 4 simulation ticks of 5 ms (20 ms), objects in slot order, after the soldier
  frame updates of the same game ms if we keep `03` §7's ordering (inferred: in the original physics runs first in
  the frame).

### 7.14 Vanilla differences found (summary)

| Topic | V | Strac |
|---|---|---|
| Mechanical CTH base | `… + bExpLevel` | `… + 10·EffectiveExpLevel` |
| Thrown CTH injury term | bandaged HP make it worse | `effectiveLife()` (bandaged HP count half) |
| Sun goggles in thrown CTH | always −10% range | only where light is brighter than normal day |
| Launcher end Z | 0 | `bTargetLevel · 256` |
| Mortar force-search start Z | `level·256` | `level·256 + 50` |
| Hand refill after a throw | no | next identical item moves to the hand |

## 8. The attack barrier, suppression and the end of an attack

### 8.1 Suppression points: accrual while a bullet flies (`LOS.cc` `MoveBullet`)

Fields (`Soldier_Control.h`): `ubSuppressionPoints` UINT8, `ubAPsLostToSuppression` UINT8, `fCloseCall` INT8,
`suppressor` (V: `ubSuppressorID`), `bUnderFire` INT8. All but `bUnderFire` are cleared in `EVENT_BeginMercTurn`
(`Soldier_Control.cc:4139-4143`, together with the BEING_PUMMELED and CLOSE_CALL quote flags and `bNumHitsThisTurn`).

Accrual runs once per tile the bullet enters, while the list of possible hits is built (`LOS.cc:3507-3834`), so it
happens **before** any collision in that tile is resolved. A soldier who is then hit keeps his point
(`--ubSuppressionPoints` is commented out, `LOS.cc:1862`). Units: `iLoop` is in world units (10 per tile).

```ts
// per tile entered (LOS.cc:3529-3540): which storey the bullet is on
const cubesAbove = cubeOf(fixInt(qCurrZ - landFix(g)));            // CONVERT_HEIGHTUNITS_TO_INDEX
const desiredLevel = cubesAbove < 4 ? 0 : 1;                        // STRUCTURE_ON_GROUND_MAX = 4

// (a) each STRUCTURE_PERSON in the tile's structure list, in list order, tgt !== firer (LOS.cc:3651-3727)
//     [candidate test for hitting tgt happens first, see §3.4; it may draw pre PreRandom(100)]
if (tgt.bTeam === OUR_TEAM && firer.bTeam !== OUR_TEAM && desiredLevel === tgt.bLevel) tgt.fCloseCall = true;
if (isMercBody(tgt) /* ubBodyType <= REGFEMALE */ && (tgt.bSide !== firer.bSide || bullet.iLoop > 30 /* MIN_DIST_FOR_HIT_FRIENDS */))
  awardPoint(tgt);

// (b) then, if gpWorldLevelData[g].ubAdjacentSoldierCnt > 0 and cubesAbove < 8 (STRUCTURE_ON_ROOF_MAX) (LOS.cc:3766-3834)
for (let dir = 0; dir < 8; dir++) {
  const adj = g + DirIncrementer[dir];
  if (gubWorldMovementCosts[adj][dir][desiredLevel] >= TRAVELCOST_BLOCKED) continue;
  const t = WhoIsThere2(adj, desiredLevel);
  if (t && isMercBody(t) && firer.bSide !== t.bSide) awardPoint(t);   // enemies only; no close-call here
}

function awardPoint(t) {
  if ((bullet.usFlags & BULLET_FLAG_BUCKSHOT) && main.Random(2) === 0) return;  // Random only drawn for buckshot
  switch (gAnimControl[t.usAnimState].ubEndHeight) {
    case ANIM_PRONE:  if (pre.PreRandom(4) === 0) return;   // fall through
    case ANIM_CROUCH: if (pre.PreRandom(4) === 0) return;   // fall through
    default: t.ubSuppressionPoints++; t.suppressor = firer; // UINT8, wraps at 256 (never reached in practice)
  }
}
```

- `ubAdjacentSoldierCnt` counts soldiers standing in the 8 neighbours of a tile (maintained in `SetSoldierGridNo`,
  `Soldier_Control.cc:1952-1956`, and on removal `:1779-1786`, `:629-638`). It ignores level; the real filter is
  `WhoIsThere2(adj, desiredLevel)`.
- **One bullet can award several points.** An enemy beside the path collects one point per path tile adjacent to him
  (up to 3); an enemy on the path collects one in his own tile plus one for each neighbouring path tile.
- (a) applies to friends beyond 3 tiles of the shooter and to the intended target; (b) never applies to friends.
- Stance odds per award: standing 100%, crouched 75%, prone 56.25% (buckshot halves each).
- V is identical (`V Tactical/LOS.c:3445-3562`).

### 8.2 When suppression is resolved: the attack busy count

`gTacticalStatus.ubAttackBusyCount` (UINT8) is a global "attack in progress" counter. Every increment must be paid by
exactly one decrement; the end-of-attack sequence (§8.4) runs when it reaches 0.

Decrement entry points (`Overhead.cc:5788-5822`):

| Function | Calls | Bullet guard |
|---|---|---|
| `FreeUpAttacker(att)` | `Internal…(att, TRUE, att.target)` | yes |
| `ReduceAttackBusyCount(att, fByAttacker)` | `Internal…(att, fByAttacker, att.target)` | if `fByAttacker` |
| `FreeUpAttackerGivenTarget(tgt)` | `Internal…(tgt.attacker, TRUE, tgt)` | yes |
| `ReduceAttackBusyGivenTarget(tgt)` | `Internal…(tgt.attacker, FALSE, tgt)` | no |

Bullet guard (`:5529-5537`): if called by the attacker, `att.inv[HANDPOS]` (not `ubAttackingHand`) is a gun and
`att.bBulletsLeft > 0`, return without decrementing. Below zero the decrement is skipped (`:5543-5555`).

Counting for the common attacks (increments ↑, decrements ↓). Every attack animation in `Ja2bin.dat` carries opcode 757
(busy ↑) on frame 0 and 753 (busy ↓) on its last frame, or in its follow-up state (STAB/SLICE → KNIFE_GOTOBREATH)
(read with `tools/spikes/ja2bin-timelines.py`).

- **Gun, single or burst.** `EVENT_FireSoldierWeapon` ↑ and sets `bBulletsLeft` = 1, 2 (two pistols) or
  `min(ShotsPerBurst, ubGunShotsLeft)`, ×`NUM_BUCKSHOT_PELLETS` for buckshot (`Soldier_Control.cc:2125, 2139-2158`).
  The fire animation's 757 ↑. Each real bullet's end calls `RemoveBullet` (`bBulletsLeft--`, `Bullets.cc:128-139`):
  - miss or stopped by a structure: then `FreeUpAttacker`, a no-op until the last bullet (`Weapons.cc:3211`,
    `StructureHit` paths);
  - stopped in a soldier: `RemoveBullet` runs first, then `WeaponHit` → `EVENT_SoldierGotHit` (`LOS.cc:2157-2202`);
  - passes through a soldier: no `RemoveBullet` yet, so the guard holds until it ends elsewhere.

  The animation's 753 ↓ (or the 448 burst stop, which calls `ReduceAttackBusyCount(att, FALSE)` and changes to the aim
  state, skipping 753; `Soldier_Ani.cc:693-708`). A jam at 470 refunds this shot's bullets and calls `FreeUpAttacker`
  (`:1056-1079`); a jam on the first burst round sets `bBulletsLeft = 0` and calls `FreeUpAttacker` (`:659-681`).
- **Each soldier hit** (`EVENT_SoldierGotHit`, `Soldier_Control.cc:2633-2664, 2771-2791`):
  1. if the target is himself mid SHOOT_ROCKET/SHOOT_MORTAR/THROW_ITEM/LOB_ITEM: `ReduceAttackBusyCount(target, FALSE)`;
  2. `bBeingAttackedCount++` and, if not a vehicle, busy ↑ (the hit animation);
  3. after `SoldierTakeDamage`, unless the reason is TENTACLES or OBJECT: gun → `FreeUpAttackerGivenTarget`
     (guarded), anything else → `ReduceAttackBusyGivenTarget` (always ↓).
- **Hit animation end** → `ReleaseSoldiersAttacker` (`Soldier_Control.cc:6439-6480`):
  ```ts
  if (s.previous_attacker !== s.attacker) s.next_to_previous_attacker = s.previous_attacker;
  s.previous_attacker = s.attacker;
  const n = s.bBeingAttackedCount; s.bBeingAttackedCount = 0;    // zeroed first: suppression may raise it again
  for (let i = 0; i < n; i++) ReduceAttackBusyCount(s.attacker, false);
  if (s.bLife !== 0 && s.ubBodyType !== QUEENMONSTER) s.attacker = null;   // kept on the dead for kill credit
  ```
  Callers: opcodes 480 and 497 (`Soldier_Ani.cc:1299, 1699`), the death paths (`:2977, 3006`), leaving a HITSTART
  animation for one that is not HITFINISH (`Soldier_Control.cc:832`), the end of a hit-while-down animation (`:854`),
  a hit on an already dead soldier (`:3207`), the end of a turn-from-hit (`:4384`), and electricity damage (`:5423`).
- **Melee.** `EVENT_SoldierBeginBladeAttack` / `BeginPunchAttack` ↑ (`Soldier_Control.cc:6583, 6735`), animation
  757/753. A miss calls `FreeUpAttacker` (not a gun, so always ↓). A hit is paid by `ReduceAttackBusyGivenTarget` in
  `EVENT_SoldierGotHit`.
- **Suppression stance change** ↑ (§8.3); its end (opcode 499, `fChangingStanceDueToSuppression`) →
  `ReduceAttackBusyCount(s.suppressor, FALSE)` (`Soldier_Ani.cc:1794-1799`).

Since several soldiers decrement, the `pSoldier` handed to §8.4 is whoever brought the count to 0: the shooter (753,
last bullet, his targets' `ReleaseSoldiersAttacker`) or the suppressor (stance change). §8.4 then uses
`pTarget = pSoldier.target`.

### 8.3 `HandleSuppressionFire(targetedMerc, causedAttacker)` (`Overhead.cc:5167-5341`)

Only called from §8.4, and only when `INCOMBAT` (V: `TURNBASED && INCOMBAT`, which is the same because V keeps
`TURNBASED` permanently set, `V Overhead.c:546`). **In real time suppression has no effect**: points accrue and are
wiped every 5 s by `EVENT_BeginMercTurn` from `HandleTacticalEndTurn` (`Tactical_Turns.cc:130, 151`). No RNG.

```ts
function calcSuppressionTolerance(s): number {            // Overhead.cc:5103-5161, INT8
  let tol = s.bExpLevel * 2;
  if (s.uiStatusFlags & SOLDIER_PC) tol += trunc((s.bMorale - 50) / 10);      // C division toward zero, ±5
  else tol += (s.bAIMorale - MORALE_NORMAL /*2*/) * 2;                          // ±4
  if (s.ubProfile !== NO_PROFILE) tol += { ATT_AGGRESSIVE: 2, ATT_COWARD: -2 }[profile.bAttitude] ?? 0;
  else tol += { BRAVESOLO: 2, BRAVEAID: 2, AGGRESSIVE: 1, DEFENSIVE: -1 }[s.bAttitude] ?? 0;
  return Math.max(0, tol);
}

const MOD = gamepolicy.suppression_fire_modifier;          // 6 (game.json:274)
const THRESH = gamepolicy.suppression_fire_reaction_threshold;   // 130 (game.json:279)
for (const s of MercSlots) {                               // slot order, every team, including the shooter
  if (!isMercBody(s) || s.bLife < OKLIFE /*15*/ || s.ubSuppressionPoints === 0) continue;
  const tol = calcSuppressionTolerance(s);
  let lost = u8(trunc(trunc(s.ubSuppressionPoints * MOD / (tol + 6)) * 2 + 1) / 2); // the "rounding" is a no-op
  if (lost > 8) lost = 8;                                  // MAX_APS_SUPPRESSED
  const total = lost;
  if (s.ubAPsLostToSuppression >= lost) continue;          // already paid this turn
  for (let i = 0; i < trunc(total / 2) - trunc(s.ubAPsLostToSuppression / 2); i++)
    HandleMoraleEvent(s, MORALE_SUPPRESSED, s.sSector);    // -1 tactical each, at most 4 per turn
  lost -= s.ubAPsLostToSuppression;
  let stance = 0;
  if (s.ubSuppressionPoints >= trunc(THRESH / (6 + tol))) {            // tol 0: 21 pts, 4: 13, 10: 8
    const end = gAnimControl[s.usAnimState].ubEndHeight;
    if (end === ANIM_CROUCH) {
      if (total >= AP_PRONE /*2*/ && IsValidStance(s, ANIM_PRONE) && farFromKnownOpponent(s)) stance = ANIM_PRONE;
    } else if (end === ANIM_STAND && s.bOverTerrainType !== LOW_WATER && s.bOverTerrainType !== DEEP_WATER) {
      if (total >= AP_CROUCH + AP_PRONE /*4*/ && IsValidStance(s, ANIM_PRONE)) {
        if (farFromKnownOpponent(s)) stance = ANIM_CROUCH;                 // "can only crouch for now"
        else if (IsValidStance(s, ANIM_CROUCH)) stance = ANIM_CROUCH;
      } else if (total >= AP_CROUCH && IsValidStance(s, ANIM_CROUCH)) stance = ANIM_CROUCH;
    }
  }
  s.bActionPoints -= lost;                                 // INT8, no clamp here
  s.ubAPsLostToSuppression = total;
  if ((s.uiStatusFlags & SOLDIER_PC) && s.ubSuppressionPoints > 8 && s === targetedMerc && !(s.usQuoteSaidFlags & BEING_PUMMELED)) {
    s.usQuoteSaidFlags |= BEING_PUMMELED; say(s, QUOTE_UNDER_HEAVY_FIRE);  // V skips profile 53
  }
  if (stance) {
    if (INCOMBAT) { ubAttackBusyCount++; s.suppressor = causedAttacker; }
    s.fChangingStanceDueToSuppression = true; s.fDontChargeAPsForStanceChange = true;   // stance change is free
    if (!(s.uiStatusFlags & SOLDIER_PC)) { CancelAIAction(s); s.bAction = AI_ACTION_CHANGE_STANCE; s.usActionData = stance; s.bActionInProgress = true; }
    InternalGivingSoldierCancelServices(s, false);         // Strac only: stop first aid
    s.usPendingAnimation = NO_PENDING_ANIMATION; s.fInNonintAnim = false; s.fRTInNonintAnim = false;
    ChangeSoldierStance(s, stance);
  }
}
// farFromKnownOpponent: ClosestKnownOpponent(s) === NOWHERE || SpacesAway(s.sGridNo, oppLoc) > 8
```

- Net effect: a standing soldier only drops to a crouch; a crouched one goes prone. A second attack in the same turn can
  take him one step further, because `total` (not the increment) is tested.
- Re-entry: the stance change raises the busy count, so §8.4 returns early (`:5574-5578`). When the last stance change
  ends (499), §8.4 runs again with `pSoldier = suppressor`. `HandleSuppressionFire` is then a no-op, because
  `ubAPsLostToSuppression` already equals `total`, and the rest of §8.4 runs **once**.
- **V diff** (`V Overhead.c:5811-5976`): in the crouch→prone branch V refunds `AP_PRONE − lost` APs, or subtracts
  AP_PRONE from `lost`, even though the stance change is free. Strac removed that refund. V also has no
  `InternalGivingSoldierCancelServices`, and V's busy increment is gated on `TURNBASED && INCOMBAT`.

### 8.4 End of attack: `InternalReduceAttackBusyCount` (`Overhead.cc:5510-5787`)

In order:
1. `pSoldier == NULL` → `pTarget = NULL` (`:5517-5527`).
2. Bullet guard (`:5529-5537`), then decrement with a floor at 0 (`:5543-5555`). If the count is still > 0, return
   (`:5560`).
3. If `INCOMBAT`: `HandleSuppressionFire(pSoldier?.target, pSoldier)`. If the count went back up, return (`:5565-5578`).
4. In a Meanwhile scene, unless the attacker is QUEEN, return (`:5585`).
5. `pTarget.bNumPelletsHitBy = 0` (`:5593`).
6. If `pSoldier` (`:5597-5715`):
   1. `ubAttackingHand = HANDPOS`.
   2. If `pTarget` and `SOLDIER_ATTACK_NOTICED`. That flag is set by `UseBlade`/`UseHandToHand` when someone stands on
      the target tile (`Weapons.cc:916, 1062`), and for guns once a bullet with a non-null `firer.target` comes within
      3 tiles (Pythagorean) of the target tile (`LOS.cc:4229-4235`). Then:
      - PC attacker, target not a crow: `fEnterCombat = ProcessImplicationsOfPCAttack(att, tgt, REASON_NORMAL_ATTACK)`;
      - crow target: crows that currently see the attacker fly away, and `fEnterCombat = false`;
      - boxing with target life ≤ 0: `EndBoxingMatch`;
      - unless both are on OUR_TEAM: if the target does not see the attacker (`bOppList != SEEN_CURRENTLY`), call
        `NoticeUnseenAttacker(att, tgt, 0)`; **then** set `tgt.bUnderFire = 2` (`:5652-5661`).

      With no target, `fEnterCombat = false`. `fEnterCombat` starts FALSE (`:5515`), so only noticed PC attacks enter
      combat here.
   3. `fSayAmmoQuotePending` → QUOTE_OUT_OF_AMMO (`:5682-5686`).
   4. PC → `UnSetUIBusy`; NPC → `FreeUpNPCFromAttacking` = `ActionDone` (`TacticalAI/AIMain.cc:685-688`).
   5. `fEnterCombat && !INCOMBAT && !meanwhile` → `EnterCombatMode(att.bTeam)` (`:5703-5712`).
   6. Clear `SOLDIER_ATTACK_NOTICED`.
7. `fKilledEnemyOnAttack` → `HandleKilledQuote` (`:5716-5723`).
8. `HandleAnyStatChangesAfterAttack` → `ProcessUpdateStats` for every OUR_TEAM merc (`:5726`, `Campaign.cc:917-924`).
   See §10.
9. `fItemsSeenOnAttack` and it is our turn → item-locator quote (`:5729-5746`).
10. `CHECK_SIGHT_AT_END_OF_ATTACK`, set by explosions (`Explosion_Control.cc:109`) → `AllTeamsLookForAll(FALSE)` and
    `RevealRoofsAndItems` for our team, then clear the flag (`:5748-5761`).
11. `DequeueAllDemandGameEvents()`: deferred noise and its interrupts (`:5763`).
12. `CheckForEndOfBattle(FALSE)` (`:5765`).
13. Not `INCOMBAT` → `EndMuzzleFlash(att)` (`:5768-5771`).
14. `bWeaponMode == WM_ATTACHED` → `WM_NORMAL` (`:5773-5777`).
15. `att.sLastTarget = att.sTargetGridNo` (`:5781-5784`).

V is identical apart from IDs instead of pointers, and the item quote is `QUOTE_SPOTTED_SOMETHING_ONE + Random(2)`
(`V Overhead.c:6130-6340`).

**`ProcessImplicationsOfPCAttack(att, tgt, reason)`** (`Overhead.cc:5344-5505`; returns `fEnterCombat`, default TRUE):
wake an `AI_ASLEEP` target; boxing rules (knife or knuckles disqualify; otherwise the boxer turns neutral); then the
first matching case: friendly militia → `MilitiaChangesSides`; neutral Slay → NPC record; a neutral civilian without a
civ group → hostile-or-quote list plus `MilitiaChangesSides` (Hicks' cow and Pablo have their own records); a recruited
or neutral civ-group member → `CivilianGroupMemberChangesSides`, other groups → `…ChangeSidesWithinProximity`; one of
our own mercs attacked out of combat readies his weapon for free and fires back through `HandleItem` (burst if he can),
with `fEnterCombat = false`; Carmen and the head miner have their own hooks. Explosions call it per victim with
`REASON_EXPLOSION` (`Explosion_Control.cc:740, 852`).

### 8.5 Being shot at: `NoticeUnseenAttacker`, interrupts, `bUnderFire`, close calls

**`NoticeUnseenAttacker(att, def)`** (`OppList.cc:4608-4752`). Returns at once unless `INCOMBAT`. Then, in order:
1. Dart gun: `SkillCheck(def, NOTICE_DART_CHECK, 0) < 0` → return. The skill is `EffectiveWisdom/10 + EffectiveExpLevel`
   minus fatigue, plus the morale modifier, clamped 0–99. RNG: `pre.PreRandom(100)`; on failure also `main.Random(100)`
   (a silent curse test) (`SkillCheck.cc:273-276, 305-372`).
2. Larvae, or a vehicle on our team → return.
3. Within `MaxDistanceVisible`: the defender's `DistanceVisible`, ignoring the muzzle flash unless he faces within ±1
   octant, then `SoldierToSoldierLineOfSightTest(def, att, limit, aware=TRUE)`.
4. If he sees the attacker: `ManSeesMan`. On our team: `StatChange(EXPERAMT, 5)` and `RadioSightings`. Otherwise:
   `ReevaluateEnemyStance`.
   If he doesn't: `SetNewSituation`; alert < RED → RED + `CheckForChangingOrders`;
   `UpdatePersonal(HEARD_THIS_TURN, att.sGridNo)`; a PC also updates the public opplist.
5. Interrupt: if `StandardInterruptConditionsMet(def, att, oldOpp)`, a one-man interrupt duel
   (`CalcInterruptDuelPts` both ways, `InterruptDuel`, `AddToIntList`). No RNG.

`bUnderFire` is set *after* this call (§8.4 step 6.2), so the duel sees the previous value.

**`bUnderFire`.** Set to 2 in §8.4. Decremented in the soldier's own `EVENT_BeginMercTurn` (`Soldier_Control.cc:4004`),
or every 5 s in real time. Uses:
- Interrupts: `StandardInterruptConditionsMet` returns FALSE while `bUnderFire != 0` (`TeamTurns.cc:999`;
  `interrupt_after_being_under_fire` = false, `game.json:80`, is the V behaviour). An enemy shot at during our turn
  therefore cannot interrupt for the rest of our turn and all of our next one.
- AI morale: +1 category when 0 (`TacticalAI/AIUtils.cc:1804`); many `DecideAction` branches (rest, run away, "do
  nothing", face the noise, YELLOW → RED), cover roaming, radio, grenade tosses and creatures read it (`13` §3–§6).

**Close calls.** `fCloseCall` (§8.1) feeds `SayCloseCallQuotes` (`TeamTurns.cc:490-507`). For each OUR_TEAM merc that is
controllable, has `fCloseCall`, `bNumHitsThisTurn == 0` and hasn't said the quote this turn: `main.Random(3) == 0` →
QUOTE_CLOSE_CALL. The function then clears `fCloseCall` for all of them.

It is called from `EndAIGuysTurn`, only if no OUR_TEAM merc was hit during the AI's turn (`AIMain.cc:529-535`;
`fSomeoneHit` is set in `LOS.cc:2196-2200`), and when the player's interrupt starts (`TeamTurns.cc:615`). The per-burst
close-call code in `FreeUpNPCFromAttacking` is commented out (`AIMain.cc:689-740`).

**Being pummelled** (`Soldier_Control.cc:5815-5837`). OUR_TEAM victim hit by someone else: `bNumHitsThisTurn++`. With
≥3 hits and `bLife − bOldLife > 20`, `main.Random(100) < 40·(hits−2)` → QUOTE_TAKEN_A_BREATING. The life test looks
inverted, so in practice the roll is never drawn (inferred).

## 9. Morale

Table `gbMoraleEvent` (`Morale.cc:27-64`): (type, change). The attack-related entries:

| Event | Type | Δ | Trigger | Who |
|---|---|---|---|---|
| KILLED_ENEMY | tactical | +4 | killer on OUR_TEAM; victim neither CIV nor MILITIA (`Overhead.cc:2461-2465`) | killer |
| SUPPRESSED | tactical | −1 | per 2 APs lost to suppression, ≤4/turn (`Overhead.cc:5213-5219`) | suppressed soldier |
| DID_LOTS_OF_DAMAGE | tactical | +2 | `sDamage > 25` in `EVENT_SoldierGotHit`, attacker OUR_TEAM. Tested before the punch damage division and **without an enemy check** (`Soldier_Control.cc:2671-2678`) | attacker |
| TOOK_LOTS_OF_DAMAGE | tactical | −3 | same test, victim OUR_TEAM (`:2679-2683`) | victim |
| KILLED_CIVILIAN | strategic | −5 | `HandleMurderOfCivilian`: killer OUR_TEAM, CIV_TEAM victim, not a crow, not KINGPIN/ALMA_MILITARY/HICKS/WARDEN group, not a TOWN_DOESNT_CARE NPC (`Strategic_Town_Loyalty.cc:350-402`) | whole team |
| TEAMMATE_DIED | strategic | −5 | `StrategicHandlePlayerTeamMercDeath`, not for EPCs or the robot (`Strategic_Merc_Handler.cc:115-120`) | fan-out below |
| SQUADMATE_DIED | tactical | −5 | part of the TEAMMATE_DIED fan-out, same sector | each merc |
| BUDDY_DIED | strategic | −15 | fan-out: the dead merc is in this merc's buddy list | each merc |
| HATED_DIED | strategic | +5 | fan-out: replaces all of the above | each merc |
| MONSTER_QUEEN_KILLED / DEIDRANNA_KILLED | strategic | +15 / +25 | `Overhead.cc:2477-2486` | whole team |

TEAMMATE_DIED fan-out (`Morale.cc:529-562`), for each OUR_TEAM merc with a profile: if he hated the dead merc,
HATED_DIED only. Otherwise SQUADMATE_DIED if in the same sector, then TEAMMATE_DIED, then BUDDY_DIED if a buddy.

Battle won/lost events come from `CheckForEndOfBattle` (`Overhead.cc:4474, 4595`) and are out of scope here.

```ts
function updateSoldierMorale(s, type, mod) {               // Morale.cc:268-385
  if (!s.bActive || s.bLife < CONSCIOUSNESS /*10*/ || IsMechanical(s) || AM_AN_EPC(s)) return;  // V: vehicle||robot
  if ([ASSIGNMENT_DEAD, ASSIGNMENT_POW, IN_TRANSIT].includes(s.bAssignment) || s.ubProfile === NO_PROFILE) return;
  const att = profile(s).bAttitude;
  if (mod > 0) mod += (att === ATT_OPTIMIST || att === ATT_AGGRESSIVE) ? 1 : att === ATT_PESSIMIST ? -1 : 0;
  else {
    mod += att === ATT_OPTIMIST ? 1 : att === ATT_PESSIMIST ? -1 : att === ATT_COWARD ? -2 : 0;
    if (s.bLevel === 1) mod--; else if (s.bLevel > 5) mod++;   // QUIRK (V too): bLevel is the roof level, not bExpLevel
    if (mod > 0) mod = 0;
  }
  if (type === TACTICAL) s.bTacticalMoraleMod = clamp(s.bTacticalMoraleMod + mod, -50, 50);
  else if (gTacticalStatus.fEnemyInSector && !s.bInSector) s.bDelayedStrategicMoraleMod = clamp(… + mod, -50, 50);
  else s.bStrategicMoraleMod = clamp(s.bStrategicMoraleMod + mod, -50, 50);
  refreshSoldierMorale(s);                                 // skipped while asleep
  // quote: bMorale < 35 → QUOTE_STARTING_TO_WHINE once (one speaker per HandleMoraleEvent); flag reset at bMorale > 65
}
function refreshSoldierMorale(s) {                         // Morale.cc:244-265
  if (s.fMercAsleep) return;
  const m = 50 + s.bTeamMoraleMod + s.bTacticalMoraleMod + s.bStrategicMoraleMod + trunc(progressPct() / 5)
          + trunc(s.bDrugEffect[ADRENALINE] * 150 / 100) + trunc(s.bDrugEffect[ALCOHOL] * 160 / 100);
  s.bMorale = clamp(m, 0, 100);                            // INT8
}
```

- Only profiled soldiers have morale. Enemies and unprofiled NPCs pass through `updateSoldierMorale` unchanged. Only
  `SOLDIER_PC` reads `bMorale`; everyone else uses `bAIMorale`.
- Decay: tactical modifier every quarter hour (`HandleQuarterHourUpdate`, `Hourly_Update.cc:85-92` → `Morale.cc:138-217`): positive `max(0, m − (8 − m/10))`,
  negative `min(0, m + (6 + m/10))`. Claustrophobic underground and Nervous alone keep re-applying their events instead.
  Strategic modifier every 3 hours (`Morale.cc:810-813`).

**Morale → chance to hit** (`GetMoraleModifier`, `Morale.cc:70-102`):

```ts
function moraleModifier(s): number {
  if (s.uiStatusFlags & SOLDIER_PC)
    return s.bMorale > 50 ? trunc((s.bMorale - 45) / 10) : trunc((s.bMorale - 50) * 2 / 5);  // +5 … −20, C truncation
  return { [MORALE_HOPELESS]: -15, [MORALE_WORRIED]: -7, [MORALE_CONFIDENT]: 2, [MORALE_FEARLESS]: 5 }[s.bAIMorale] ?? 0;
}
```

It is added to marksmanship in `CalcChanceToHitGun` (`Weapons.cc:2027`), to both the attacker's and the defender's
rating in `CalcChanceHTH` (`:3274, 3353`), to `CalcThrownChanceToHit` (`:3618`) and to every `SkillCheck`
(`SkillCheck.cc:329`).

**AI morale** (`bAIMorale`, `CalcMorale`, `TacticalAI/AIUtils.cc:1606-1825`; `13` §4.1) is recomputed only inside
`DecideAction`, so suppression tolerance (§8.3) and the CTH modifier read the value from the soldier's last decision.
No RNG.

## 10. Experience and stat gains from attacks

**Mechanics.** `StatChange(s, stat, n, cause)` (`Campaign.cc:48-75`):
- ignores soldiers not on our team, without a profile, vehicles, robots, POWs and life < CONSCIOUSNESS;
- runs `ProcessStatChange` then `ProcessUpdateStats`.

```ts
function processStatChange(p, stat, n, cause) {           // Campaign.cc:102-371
  if (p.bEvolution === NO_EVOLUTION || n === 0) return;     // (DEVOLVE + TRAINING also returns)
  const spp = subpointsPerPoint(stat, p.bExpLevel);         // attribs 50, skills 25, EXPERAMT 350·bExpLevel (:1002-1036)
  const sppLvl = subpointsPerPoint(EXPERAMT, p.bExpLevel);
  const rating = current(p, stat); if (rating <= 0) return; // a 0 skill never improves
  const wis = wisdomAffects(stat, cause);                   // false for HEALTH/AGIL/DEXT/STR unless FROM_TRAINING
  for (let i = 0; i < n; i++) {                             // NORMAL_EVOLUTION branch; DEVOLVE mirrors it (:300-357)
    if (cause === FROM_FAILURE && gain(p, stat) + 1 >= spp) break;   // failures never complete a point
    let chance = stat !== EXPERAMT ? 100 - (rating + trunc(gain / spp))
                                   : 100 - 10 * (rating + trunc(gain / spp));        // UINT16
    if (cause === FROM_TRAINING && stat !== EXPERAMT && rating + trunc(gain / spp) >= 85) chance = 0;
    if (chance > 0 && wis) chance += trunc(chance * (p.bWisdom + trunc(p.sWisdomGain / 50) - 50) / 100);
    if (chance > 99) chance = 99;
    if (pre.PreRandom(100) < chance) {                      // ONE pre draw per chance, even when chance is 0
      gain(p, stat)++;
      if (stat !== EXPERAMT && cause !== FROM_TRAINING && p.bExpLevel + trunc(p.sExpLevelGain / sppLvl) < 10
          && (cause !== FROM_FAILURE || p.sExpLevelGain + 1 < sppLvl)) p.sExpLevelGain++;   // 1:1 toward level
    }
  }
  if (cause !== FROM_TRAINING) { p.usStatChangeChances[stat] += n; p.usStatChangeSuccesses[stat] += |Δ|; }
}
```

`ProcessUpdateStats` (`:747-913`) converts accumulated subpoints into points through `ChangeStat` (`:378-745`).
- It is **deferred while `ubAttackBusyCount > 0`, the merc is in sector and `INCOMBAT`** (`:761-766`), so in combat
  points land at §8.4 step 8. It also skips mercs below OKLIFE.
- Per changed stat, `ChangeStat` draws `main.Random(100) < 25` to choose between the quote and a plain message. The draw
  is skipped for HEALTH, and for EXPERAMT, which always gets the quote (`:583`). Level-ups also change salary
  (`02` §4).

**Call sites in the attack path** (`gain` = number of chances):

| Site | Recipient | Stat, chances, cause | Conditions |
|---|---|---|---|
| `UseGun` `Weapons.cc:691-728` | shooter | MARK, `3 + (hit ? 3 + d + (aim && !burst ? min(bAimTime, d) : 0) : 0)` with `d = trunc((100 − cth) / 25)`; ×2/3 for a valid second-hand shot; then `ModifyExpGainByTarget`. Cause SUCCESS if `roll ≤ cth`, else FAILURE | `IsOnOurTeam`, `target != NULL`, `!bDoBurst \|\| bDoBurst == 2`, `INCOMBAT`, `SoldierToSoldierBodyPartChanceToGetThrough > 0` (no RNG). **Quirk (V too):** `bDoBurst` is 1 on the first burst round (incremented at the end of `UseGun`, `:866`), so a burst is credited on its **second** round, with that round's roll; a 1-round burst gets nothing |
| throwing knife, inside `UseGun` `:752-784` | thrower | MARK and DEXT, each `gain/2`, with `gain = 10 + (hit ? 10 + d10 + (aim ? 2·min(bAimTime, d10) : 0) : 0)` and `d10 = trunc((100 − cth) / 10)` | `IsOnOurTeam`, `target != NULL` (no INCOMBAT gate) |
| `UseBlade` `:996-1022` | attacker | DEXT, same formula as the throwing knife (`d10` from the stab chance; a surprise attack has chance 100, so `d10 = 0`) | `IsOnOurTeam`, `target != NULL` |
| `UseHandToHand` `:1197-1213` | attacker | STR and DEXT, hit 8 / miss 4, then `ModifyExpGainByTarget` | attacker OUR_TEAM, target not OUR_TEAM |
| steal `:1112-1118, 1171-1176` | thief | STR 8 SUCCESS / STR 4 FAILURE (if chance > 0) | thief OUR_TEAM, target not OUR_TEAM, not mechanical or tank |
| `UseThrown` `:1278-1311` | thrower | STR 5 SUCCESS; then `roll < cth` (strict) → DEXT 5 + MARK 5 SUCCESS, else DEXT 2 + MARK 2 FAILURE | OUR_TEAM, `INCOMBAT`, and an other-team soldier on the target tile, or else the first one found on the 8 neighbours in direction order |
| `UseLauncher` | – | none | |
| `AgilityForEnemyMissingPlayer` `:885-893` | target | AGIL, 10 for a knife miss (`:992`), 8 for an HTH miss when the attacker is not "player vs non-player" (`:1217`), 5 per bullet that misses: `StructureHit` with `fStopped` (`:1584`) and `ShotMiss` (`:3175`) | target OUR_TEAM, attacker on another team, target life ≥ OKLIFE. Gun recipient = `att.opponent`, the soldier on the target tile at `GetTargetWorldPositions` time (`:428`). Every missing round of a burst counts. A bullet that passed through someone and then stopped in a wall also counts (inferred) |
| `SoldierTakeDamage` `Soldier_Control.cc:5796-5813` | attacker | EXPLODE `10·combinedLoss` SUCCESS | reason TAKE_DAMAGE_EXPLOSION, attacker OUR_TEAM, victim not OUR_TEAM. The gun MARK equivalent is commented out |
| same, `:5815-5818` | victim | EXPER `5·combinedLoss` FAILURE | victim on our team, any damage reason |
| `HandleNPCTeamMemberDeath` `Overhead.cc:2493-2514` | killer / assister | EXPER `10·victim.bExpLevel` / `5·victim.bExpLevel` SUCCESS | victim not a crow or cow, `ubLastDamageReason != BLOODLOSS`; recipient OUR_TEAM (an assister must also be active). Assister = `previous_attacker`, or `next_to_previous_attacker` if that equals the killer. Non-player victims only |
| `NoticeUnseenAttacker` `OppList.cc:4679` | victim | EXPER 5 | sees a previously unseen attacker, OUR_TEAM, `INCOMBAT` |
| `CheckForGunJam` `Weapons.cc:296-306` | shooter | MECH 5 + DEXT 5 | successful unjam |
| `StructureHit` lock `LOS.cc:2316-2320` | shooter | MARK 10 | the bullet destroyed a door lock |

`combinedLoss = trunc(u8(sLifeDeduct) / 10) + trunc(sBreathLoss / 2000)` (UINT8, `Soldier_Control.cc:5680`).
`ModifyExpGainByTarget` (`Weapons.cc:525-537`): cow or crow /2; mechanical or tank 0.

**Records.**
- `usShotsFired++` per real bullet, so per pellet (`LOS.cc:3168-3176`). `usShotsHit++` per `BulletHitMerc`
  (`:2025-2029`). Both only for OUR_TEAM firers whose `target` is alive.
- `usTimesWounded++` per bullet hit on OUR_TEAM (`:2089-2092`).
- At death commit (`Soldier_Ani.cc:2926-2960`): `usKills++` and `gStrategicStatus.usPlayerKills++` for an OUR_TEAM
  killer; `usAssists++` for an OUR_TEAM assister who is not the killer.
- Militia: `ubMilitiaKills` +1 in `HandleNPCTeamMemberDeath` (`Overhead.cc:2516-2519`), then +2 for the kill and +1 for
  an assist. A militia kill therefore totals +3 (quirk).
- `usBattlesFought++` at battle end (`Overhead.cc:4560`).

### 10.1 RNG calls in §8–§10, in order

1. Bullet tile, per person structure in list order (interleaved with the structure-hit `pre` rolls):
   - [`pre` PreRandom(100) accidental-hit test, only for a visible standing non-target within range];
   - [`main` Random(2) if buckshot];
   - [`pre` PreRandom(4) ×0–2 by stance].

   Then per adjacent direction 0–7: [`main` Random(2) if buckshot], [`pre` PreRandom(4) ×0–2].
2. `UseGun` order: `pre` hit roll → `DeductAmmo` → **MARK `StatChange`: one `pre` draw per chance** → (rocket
   launcher fail check) → `FireBulletGivenTarget` deviation draws. The experience draws therefore sit between the hit
   roll and the bullet's rolls for player shooters in combat. `UseBlade`, `UseHandToHand` and `UseThrown` likewise draw
   their `StatChange` rolls right after their own hit roll.
3. Agility dodge `StatChange` draws happen inside `StructureHit` and `ShotMiss`, at the bullet's end.
4. §8.4: `HandleSuppressionFire` draws nothing. `NoticeUnseenAttacker` for a dart draws `pre` (+ `main` on failure).
   `HandleAnyStatChangesAfterAttack` → `ChangeStat` draws `main` Random(100) per changed stat. Quotes and battle sounds
   (`HandleKilledQuote`, `DoMercBattleSound`) may draw `main` (not traced).
5. Turn end: `SayCloseCallQuotes` draws `main` Random(3) per eligible merc.

### 10.2 Port notes for §8–§10

- Replace the global busy count with the resolution barrier (`03` §7), but keep its **trigger identity**: §8.4 runs
  with the soldier whose release emptied the barrier, and suppression runs before everything else and can re-arm the
  barrier.
- Suppression is turn-based only. Real time still accrues points, `fCloseCall` and `bUnderFire`.
- Keep the deferral of stat-point application during attacks (it moves the `main` quote draw), and the "1 pre draw per
  chance" loop even when the chance is 0.

---

## 11. RNG order, end to end: one aimed shot that kills

A player merc in combat (a profile, so the jam test and `StatChange` draw) fires one aimed round at a visible enemy on
the ground; the bullet crosses one tile with a bush and a crouched bystander, hits the torso, the enemy falls forward
and dies. Brackets mark conditional draws. Section numbers give the conditions.

| When | Draws, in order |
|---|---|
| order (`HandleItem`) | [PSYCHO, burst-capable, not bursting: `main(3 + aim)`] (§1.3). AI shooters: [`main(50)` civ quote] |
| fire state entered (`SelectFireAnimation`, standing single shot) | [`pre(100)` body part if `AIM_SHOT_RANDOM` and a soldier on the tile] (§1.8) |
| opcode 470 | `CheckForGunJam`: `pre(100)`, `pre(100)`; jammed gun: `SkillCheck` `pre(100)` [+ `main(100)`] (§1.7) |
| opcode 430 → `UseGun` | [`pre(100)` body part if still random]; [barrel extender `main(2)`, `main(35)`, `main(35)`]; **`pre(100)` hit roll**; MARK `StatChange`: one `pre(100)` per chance (§10); [LAW `pre(40)`, `pre(40)`, [`pre(2)`]]; `FireBulletGivenTarget`: [miss: `pre(50)`, `pre(2)`, `pre(100)`] (§3.2); first `MoveBullet` (below); wear `pre(15 + 3·reliability)`; [`main(2)` monster smell] |
| each tile entered | structures in list order: fences/obstacles [`pre(100)` vs `ChanceOfBulletHittingStructure`]; persons [`pre(100) < 3` accidental test, short-circuited]; suppression award per person and then per neighbour [buckshot `main(2)`] [`pre(4)` ×0–2 by stance] (§3.4, §8.1) |
| inside the tile | per structure hit: [lock `pre(2)`, `pre(dmg)`]; density `pre(100)`; [explosive structure `main(2)`]; [stopped: curse `main(40)` (player, single shot)] (§3.5) |
| `BulletHitMerc` | [adult monster gland `pre(100)`]; [spit: goggles `pre(100)` ×≤2]; `BulletImpact`: `pre(51)` fluke, armour `pre(100)` per piece (plates, vest), [`main(10)` instant kill], [head `pre(22)` / legs `pre(10)`], [knife stealth `pre(100)` + `main(10)`], [critical `pre(crit/2 + 5·aim)`, `pre(crit/2)`, torso `preChance(50)`] (§4.2); [head: `main(2)`, `main(impact/2)`]; [touchy neutral `main(100)`]; [pass-through `pre(100)` + armour `pre(100)` per piece] (§4.1) |
| `EVENT_SoldierGotHit` | [sleep dart `pre(100)`]; `SoldierTakeDamage`: [blast equipment `pre`], [unprofiled bleed `main(2)`], **`main(100)` weapon drop**, [blood `main`], [EXPER `StatChange` `pre`×n for our victim] (§5.2); hit state entry: **opcode 478 `main(100)` [+ `main(50)`]** (§5.6) |
| hit animation frames | **433 `main(100)` [+ `main(50)` fall side]**; release curse [`main(10)`]; 447 none (§5.7) |
| opcode 440 (`HandleSoldierDeath`) | [visible victim: `main(3)` laugh]; kill/assist EXPER `StatChange` `pre`×n; corpse: ammo `1 + main(n)` per non-player ammo stack (§5.10) |
| barrier reaches 0 | `HandleAnyStatChangesAfterAttack`: `main(100)` per changed stat; [dart: `NoticeUnseenAttacker` `pre(100)` [+ `main(100)`]] (§8.4, §10) |
| turn end | `SayCloseCallQuotes`: `main(3)` per eligible merc (§8.5) |

Bursts repeat the 430 row per round (jam only on round 1, XP only on round 2). A miss that stops in a wall adds the
agility `StatChange` of the shooter's `opponent` inside `StructureHit`; a miss that leaves the map adds it inside
`ShotMiss`. Melee: §6.5. Throws and launchers: §7.12. Suppression resolution draws nothing (§8.3).

---

## 12. Minimal M3 implementation (attacks and damage)

M3 already has the item model (`content/items/items.ts`, `sim/items/object.ts`, `sim/tactical/inventory.ts`; `12`
§1–§3), the LOS ray (`perception/los.ts`), sight and noise, the animation interpreter and the AP pool. The combat AI
(`13`) and explosions (`12` §10) are separate specs that call into this one.

### 12.1 First: single shots with pistols and rifles, damage, death

Everything here consumes RNG on every shot, so it has to be exact from the first commit.

1. **Data.** Weapon fields from `weapons.json` (§1.1; LAW impact 80 is hard-coded); ammo types; `armours.json` plus the
   max-protection-per-class table (§4.3); `MATERIAL_ARMOUR` (`data/tables/` via a transcription tool); JSD `armour`
   and `density`; the policy values (§1.1).
2. **Soldier fields.** `aimTime`, `aimShotLocation`, `doBurst`, `bulletsLeft`, `attackingHand`, `attackingWeapon`,
   `target`, `opponent`, `targetGrid/Level/CubeLevel`, `lastTarget`, `turningToShoot`, `dontChargeReadyAPs`,
   `dontChargeTurningAPs`, `dontUnsetLastTargetFromTurn`, `muzzleFlash`; target side: `attacker`, `previousAttacker`,
   `nextToPreviousAttacker`, `beingAttackedCount`, `hitLocation`, `gettingHit`, `goBackToAimAfterHit`, `sDamage` and
   its display counter, `shock`, `bleeding`, `nextBleed`, `breathRed`, `collapsed`, `tryingToFall`, `startFallDir`,
   `fallClockwise`, `numPelletsHitBy`, `intendedTarget`, `suppressionPoints`, `suppressor`, `closeCall`, `underFire`,
   `apsLostToSuppression`, the `*Damage` stat fields, flags (`ATTACK_NOTICED`, `DEAD`, `GASSED`, `PC`).
3. **Pure functions with golden tests:** effective stats (`SkillCheck.cc:14-118`), `moraleModifier`, fatigue penalty,
   `CalcChanceToHitGun` (§2; attachments may be absent but the no-attachment path must be exact), the AP functions
   (§1.5), `BulletImpact`, armour, `AdjustImpactByHitLocation`, `CalcBodyImpactReduction`,
   `ChanceOfBulletHittingStructure`, `StructureResistanceIncreasedByRange`.
4. **Attack flow.** `HandleItem` gun path (refusals and imprint can wait; the psycho roll cannot), a per-tick event
   queue drained after the soldier pass (`EV_S_BEGINFIREWEAPON`, `EV_S_FIREWEAPON`, delayed `EV_S_WEAPONHIT`),
   `EVENT_FireSoldierWeapon`, ready/turn AP rules, `SelectFireAnimation`, opcodes 757, 753, 470, 441 (no-op), 430, 473,
   477 (no-op), 772, `CheckForGunJam` with unjam, `UseGun`, `GetTargetWorldPositions`, wear, gunfire noise and the
   muzzle-flash flag for sight.
5. **Bullets.** `FireBulletGivenTarget`, `CalculateFiringIncrements`, `MoveBullet` one tile per 5 ms tick (knives one
   per 30 ms), structures, persons (intended and accidental), suppression **accrual** (it draws `pre`), close calls,
   windows, corpses, roof and ground stops, map exit, the drop beyond 2× range, `HandleBulletStructureInteraction`,
   `StructureHit` (noise, `DamageStructure` gunfire branch, release 425 ms later when the miss animation ends, §3.5),
   `ShotMiss`, `RemoveBullet`/`FreeUpAttacker`, and the fake-bullet CTGT for the AI.
6. **Impact and target.** `BulletHitMerc`, `WeaponHit`, `EVENT_SoldierGotHit` (gun branch), `SoldierTakeDamage`,
   `DeductPoints`, the gun hit-animation choice, opcodes 478, 472, 433, 447 + `OKFallDirection`, `FALLBACK_HIT_STAND`
   and `FLYBACK_HIT` special moves, 497, 440, 465, the twitch table, `CheckForFreeupFromHit`,
   `ReleaseSoldiersAttacker`, `HandleSoldierDeath` with `HandleNPCTeamMemberDeath` bookkeeping (kill credit, team
   counts, morale event, opplist cleanup; quest hooks can wait), `TurnSoldierIntoCorpse` (corpse structure for LOS and
   bullets; item drop as soon as world items exist, `12` §9), bleeding at turn start, getting up.
7. **Barrier.** The busy counter with its exact guard rules (§8.2) and the end-of-attack steps that matter without
   NPC scripts: suppression (§8.3, turn-based only), `NoticeUnseenAttacker` and `bUnderFire`, combat entry from a
   noticed attack, `sLastTarget`, stat-point application, deferred noise, `CheckForEndOfBattle`.
8. **Experience.** `StatChange` with its per-chance `pre` loop for every call site in §10, even if level-ups and their
   salary effects come later: the draws shift every later `pre` roll.
9. **Agent API.** `attack({ soldier, grid, level, aimTime: 0..4, bodyPart: head|torso|legs|random })` returning the
   `ITEM_HANDLE_*` result; `chanceToHit` and `chanceToGetThrough` queries (the `fModify = FALSE` and fake-bullet
   paths, no RNG); events `shotFired`, `bulletStopped`, `soldierHit {gridNo, location, special, conscious, damage?}`, `soldierDied`,
   `attackResolved` (barrier at 0).
10. **Tests.** CTH and damage golden tables computed by hand from §2/§4; RNG-count tests per scenario (how many `pre`
    and `main` draws a shot consumes); bullet paths on stub worlds (wall, window, bush density, intended tile,
    bystander); tick counts for the hit and death timelines (§5.5); save/load in the middle of a bullet flight.

### 12.2 Next: bursts, melee, throws

- Bursts (448/449, burst AP and penalty, `STANDING_BURST_HIT`, XP on round 2), buckshot pellets and spread table,
  dual pistols (458/459, `SHOOT_DUAL_*`), AI spread bursts (`sSpreadLocations`).
- Melee (§6): punch and knife, 492 dodge, the 20 ms hit event, punch damage as breath, knife dulling, the blade/punch
  animation rules; then martial arts (`NINJA_*`, spin kick) and stealing.
- Throwing knives (bullet path with `CalcThrownChanceToHit`, knife items placed on the target or the ground).
- Grenades and rocks (§7.1–§7.7, §7.9–§7.11) with the explosion hand-off to `12` §10; launchers GL/UGL/mortar (§7.8).
- Morale events and `GetMoraleModifier` for profiled mercs (§9), close-call and heavy-fire quotes.

### 12.3 Can wait

Attachments (sniper scope, laser scope, bipod, barrel extender, silencer, duckbill, spring-and-bolt, under-barrel GL);
LAW and tank cannon; monster spit, sleep darts, HE/HEAT rounds; creatures, robots, vehicles, the Queen; boxing,
Meanwhile scenes and NPC quest hooks on death; the cosmetic layer (blood pools, muzzle light, damage numbers on screen,
battle sounds); fragile-item damage on falls; weapon drop **effects** (the `main(100)` draw itself is in 12.1).

### 12.4 Deviations to log in `docs/deviations.md`

| Area | Original | ja2-node |
|---|---|---|
| Bullet flight | `MoveBullet` gated by a 2–3 ms wall clock and called once per frame: about one tile per frame, so flight time and burst overlap depend on the frame rate | One tile per 5 ms tick, first tile inside `FireWeapon`; knives every 30 ms |
| Event timing | Fire and hit events run in the frame's event pump; delayed events fire when `now − stamp > delay` | Same order, drained after each tick's soldier pass; a 20 ms delay fires on the first tick after 20 ms (25 ms) |
| Our merc's death | The barrier is released after the portrait/skull UI animation (12 × 160 ms wall clock) | A fixed 1920 game-ms delay after opcode 440 |
| Watchdog-dependent leaks | A punch at an empty tile and a shooter hit mid-burst leave the busy count up until the 25 s UI watchdog (inferred) | Release the hold immediately (zero `bBulletsLeft` when a fire animation is interrupted) |
| Aborted throw | An AI throw aborted before release returns the whole copied stack (inferred duplication) | Decide: keep (oracle-checked) or return one item |
| Gland pass-through | `BodyImpactReduction[AIM_SHOT_GLAND]` reads past a 4-entry table | Use 0 |
| Unsequenced draws | `pre(100) < status + pre(50)` (grenade duds) has no defined order | Left to right |
| Cosmetic RNG | Sound picks, curses (`main(10)`, `main(40)`), laugh `main(3)`, blood `main(3)/main(4)`, stat messages `main(100) < 25`, silent skill-check curse `main(100) < 40`, civ quote `main(50)` share `main` | Move to the cosmetic stream; keep on `main`: 433, 478, fall side, weapon drop, instant-kill bonus, head-gear damage, touchy neutral, explosive structures, barrel extender, monster smell, psycho burst, `CoinToss` for stab/slice, `CIV_DIE2`, corpse ammo |
| Physics floats | `sinf`/`sqrtf` and float32 integration | `Math.fround` everywhere; last-ulp differences in the force estimate may rarely move a landing tile |

Keep without a deviation entry (they are exact under game-ms timers): the `sDamage` window (8 × 250 ms after the last
visible hit), the miss-animation release delay, burst cadence (2 frames × 100 ms).

---

## 13. Open questions and inferred points

**Guns and bullets (§1–§4).**
- The 425 ms miss-animation hold (§3.5): `UpdateAniTiles` runs inside `ExecuteOverhead` (`Overhead.cc:487`), i.e. on
  the 5 ms pass, so it is exact on our ticks; in the original a slow frame rate stretches it.
- The XP condition `!bDoBurst || bDoBurst == 2` grants burst XP on round 2 (comment in the source says round 1).
- `GetTargetWorldPositions` in `SelectFireAnimation` makes the body-part roll at fire-state entry for standing single
  shots and inside `UseGun` otherwise; the draw count is the same, the position in the stream differs.
- `CalcChanceToHitGun` bonus at 4–5 tiles for a prone shooter aiming at a standing target's legs/torso (formula turns
  positive) is kept as written.
- `sDamage` accumulates indefinitely on targets the player cannot see (the display, and therefore the reset, only
  starts for `bVisible != -1`).

**Hit and death (§5).** From the hit pass: the skull-UI delay and the `sDamage` timer are presentation timers with
gameplay effects; `FALLBACK_DEATHTWICH` never releasing and the hit-during-own-burst leak are static traces; the
`(UINT8)` conversion of a negative float breath in `DeductPoints` assumes x86 truncate-then-wrap; the return-to-aim AP
recharge after a hit is inferred from `fDontChargeReadyAPs`; special-move overshoot past the final tile was not traced;
vehicles, boxing, Meanwhile/Elliot and Queen branches are listed, not detailed.

**Throws and launchers (§7).** Whether `AP_CHANGE_TARGET` is always charged and the stance term always 0 at the release
frame; the stack duplication on aborted throws and the lost grenade on a hit during the throw animation; the C++
evaluation order of the dud test; how often `EndTurnEvents` decays bomb timers; the effective GL minimum range
(≈10–11 tiles flat, derived); landing Z vs terrain height on elevated maps; the water-explosion keyframe reading a freed
object slot; the neighbour order of the XP victim search.

**Barrier, suppression, morale, experience (§8–§10).** Whether `EnterCombatMode` resets the attack's own suppression
points; how a negative `bActionPoints` left by suppression is treated at the next turn start; the dodge gain for a
bullet that passed through someone and then stopped in a wall; which RNG `HandleKilledQuote` and the item-locator
quote consume; the pummel-quote condition `bLife − bOldLife > 20` (sign error carried over from V, kept).

**Animation data.** Opcode positions were read from one release (Steam 1.12 `Ja2bin.dat`); other releases may differ.
Read them from the user's file at load time, never from tables in the repository.

**Verified by reading code** (line numbers from grep): every formula, constant and call order quoted in §1–§10;
the `Ja2bin.dat` scripts for the fire, burst, hit, death, melee and throw states; the 11 physics sub-steps
(`Math.fround` check); the vanilla differences marked V.
