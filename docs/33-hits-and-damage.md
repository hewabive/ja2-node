# 33 — Hits and damage: armour, damage, hit reaction, death, suppression, morale, experience

From a bullet, blade, punch, blast or thrown object reaching a soldier to the end of the attack: hit location, armour
and damage, hit and death animations, corpses, bleeding, the attack busy count, suppression, being shot at, morale,
`StatChange`. Siblings: `11` guns, bullets and melee up to the impact (RNG order of a whole shot: `11` §5); `34`
throwing, launchers and item physics. Elsewhere: `10` turns and interrupts, `12` explosions, `13` the combat AI.

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless marked V (vanilla `Build/`); bare
file names are in `Tactical/`, except `Explosion_Control.cc`, `Physics.cc` (`TileEngine/`), `AIMain.cc`, `AIUtils.cc`
(`TacticalAI/`) and `DefaultContentManager.cc` (`src/externalized/`); `game.json` is Stracciatella's
`assets/externalized/game.json`. "(inferred)" marks conclusions not traced end to end. C integer semantics: `/`
truncates toward zero (`idiv`, `trunc`), `INT8`/`UINT8`/`INT16` stores wrap (`i8`, `u8`, `i16`; `src/core/int.ts`).
`pre(n)` = `PreRandom(n)` (stream `pre`, `t.pre`), `main(n)` = `Random(n)` (stream `main`, `t.rng`), `preChance(p)` =
`pre(100) < p`; `n = 0` draws nothing. Animation frame counts, speeds and opcode positions (§2.5) are from one release
(Steam 1.12 `Ja2bin.dat`, `11` §1.6). Directions N 0 … NW 7; `GetDirectionFromGridNo(g, s)` points from `s` towards
`g` (`Soldier_Control.cc:6334-6349`). 10 world units per tile; 256 height units per storey, 64 per cube (`08` §1.1).
Teams: OUR 0, ENEMY 1, CREATURE 2, MILITIA 3, CIV 4. `OKLIFE 15`, `CONSCIOUSNESS 10`, `OKBREATH 10`, `USABLE 10`
(minimum item status). `AIM_SHOT_RANDOM 0, HEAD 1, TORSO 2, LEGS 3, GLAND 4`.

## 0. Overview

```
bullet enters the target's tile (`11` §3.4)
  └ BulletHitMerc: location, BulletImpact (armour, crits)                       §1
     └ WeaponHit → EVENT_SoldierGotHit: damage NOW, hit animation, busy +1;     §2.1-§2.4
        attacker's own hold released (last bullet)
        └ hit animation → release, or fall → 497 → death animation → 440 corpse  §2.5-§2.10
… busy count reaches 0 → end of attack: suppression, notice the attacker,
  combat entry, stat points, deferred noise, end of battle                      §3.4
```

- **Damage at impact, death at the end of the death animation.** Life drops when the bullet arrives; corpse, item drop,
  kill credit and target removal happen at opcode 440, seconds later (§2.5, §2.10).
- **One barrier.** `ubAttackBusyCount` counts everything still resolving (attacks, bullets, hit animations, objects,
  explosions). While it is above 0, interrupts, noise and AI re-planning wait; reaching 0 runs the end-of-attack
  sequence once, with the soldier whose release emptied it (§3.2, §3.4).

## 1. A bullet reaches a soldier

### 1.1 `BulletHitMerc(b, structure, intended)` (`LOS.cc:1808-2207`), in order

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
  damage = bulletImpact(firer, tgt, loc, impact, hitBy, &special);                           // §1.2
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
    if (impact > 0) { b.impact = i8(impact); stopped = false; }      // b.impactReduction is kept
  }
}
if (stopped) removeBullet(b);                                       // bBulletsLeft--; no FreeUpAttacker (the hit releases it)
else dropBlood(next tile behind the target, unless blocked);        // visual
if (tactical.currentTeam !== OUR && tgt.team === OUR) tactical.someoneHit = true;     // suppresses close-call quotes
weaponHit(tgt, firer.attackingWeapon, damage, breathLoss, hitDir, tgt.x, tgt.y, 20, range, firer, special, loc);   // §1.4
return stopped;
```
A bullet that passes through continues in the same tile without that person in its list; it can hit others there,
the original target included, each once per tile. `BodyImpactReduction[AIM_SHOT_GLAND]` reads past the 4-entry table;
ja2-node uses 0.

### 1.2 `BulletImpact(firer, tgt, loc, impact, hitBy, &special)` (`Weapons.cc:2743-3116`)

```ts
const ammo = throwingKnife(firer.attackingWeapon) ? AMMO_KNIFE : firer.inv[hand].ammoType;
if (TANK(tgt) && ammo !== AMMO_HEAT) return 0;                     // ping
const fluke = pre(51) - 25;                                         // ±25 %
impact = idiv(impact * (100 + fluke + idiv(hitBy, 2)), 100);        // up to +49 % for a perfect shot
if (impact < 1) impact = 1;
if (ammo === HE || ammo === HEAT) { impact = idiv(impact*4, 3); if (TANK(tgt)) impact = idiv(impact, 2); }
let dmg = special === BLINDED_BY_SPIT ? impact : impact - totalArmourProtection(tgt, loc, impact, ammo);   // §1.3
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
`fluke`/`hitBy` apply before armour, HP ×1.7 and the location after it. The head/torso instant-kill draws use
**`main`**, the rest `pre`. The stat loss is permanent (the `*Damage` fields allow healing back).

**`sDamage` window** (a presentation timer with a gameplay effect). `tgt.sDamage` is the floating damage-number
accumulator: `SoldierTakeDamage` adds each life loss (`Soldier_Control.cc:5636`) and restarts the display
(`:5693-5700`); `ExecuteOverhead` steps the display every 250 ms (`DAMAGE_DISPLAY_DELAY`) and zeroes `sDamage` after 8
steps (`Overhead.cc:525-541`). So chest hits landing within ≈2 s of each other add up toward the 85-point "blown away"
kill. The display, and so the reset, only starts for a target in sector with `bVisible != -1`: hits on soldiers the
player cannot see accumulate until a visible hit. ja2-node: a game-ms timer (`damageWindow`, stepped by
`updateDamageDisplay`).

### 1.3 Armour (`Weapons.cc:106-204, 2564-2741`)

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
`ArmourPercent(s)` (UI and AI threat only, `:123-149`; `AIUtils.cc:1875`) and `ArmourVersusExplosivesPercent`
(blasts, `Explosion_Control.cc:729`): formulas in `12` §1.5; the per-class maxima over `armours.json` ignore
`ignoreForMaxProtection` (`DefaultContentManager.cc:562-602`; V hard-codes Spectra 18 items).

### 1.4 `WeaponHit(tgt, weapon, damage, breathLoss, dir, x, y, z, range, attacker, special, loc)` (`Weapons.cc:1502-1539`)

1. `MakeNoise(attacker, tgt.gridNo, tgt.level, hitVolume(weapon), NOISE_BULLET_IMPACT)` (deferred while busy).
2. `EXPLOSIVE_GUN` (LAW, tank cannon): `IgniteExplosionXY(attacker, x, y, 0, grid, C1 or TANK_SHELL, tgt.level)`,
   `FreeUpAttacker`, return (the soldier takes only the blast).
3. `DoSpecialEffectAmmoMiss` (HE/HEAT mini-explosion visual; monster spit with a smoke effect → `NewSmokeEffect`).
4. `tgt.fDoingExternalDeath` → `ReduceAttackBusyCount(tgt.attacker)`; else `EVENT_SoldierGotHit(tgt, weapon, damage,
   breathLoss, dir, range, attacker, special, loc, NOWHERE)` (§2).

Melee hits arrive through the queued `EV_S_WEAPONHIT`, whose handler passes **the target's own `bAimShotLocation`** as
the hit location (`Utils/Event_Pump.cc:262-268`); V passes the event's zeroed `ubLocation` (= RANDOM). `UseBlade` and
`UseHandToHand` already scaled melee damage by the attacker's aim location.

## 2. The target: hit reaction, damage and death

From `EVENT_SoldierGotHit` to the corpse. Callers: `WeaponHit` (bullets §1.4; melee through the 20 ms event,
`11` §4.1), blasts (`Explosion_Control.cc:734`, location `ANIM_CROUCH`, range = blast distance; `12` §10), thrown
objects hitting a soldier (`Physics.cc:1869`, `TOSSED_OBJECT_SPECIAL`, weapon `NOTHING`, `34` §9.3), the LAW
back-blast (`11` §1.9), queen tentacles (`Weapons.cc:3858`) and opcode 761 (a creature eating a corpse). Hit location,
`ubSpecial` and critical stat loss: §1.

### 2.1 `EVENT_SoldierGotHit` (`Soldier_Control.cc:2628-3030`)

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
      if (pre(100) < sleepDartSuccumbChance(t)) breath = t.bBreathMax * 100;
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
  ...animation selection (§2.4)
}
```

- `freeUpAttackerGivenTarget(t)` = `InternalReduceAttackBusyCount(t.attacker, calledByAttacker=TRUE, t)`: returns
  without decrementing while the attacker holds a gun and `bBulletsLeft > 0` (`Overhead.cc:5528-5537`). The hit
  animation's `+1` came first, so the count **cannot reach 0 here**; the zero-barrier work (suppression, combat entry,
  end of battle, `10` §5) always runs later, when the hit animation releases.
- `sleepDartSuccumbChance` (`:5235`): `effStr > 90 ? 110-s : > 80 ? 120-s : > 70 ? 130-s : 140-s`, plus
  `10 - bSleepDrugCounter` (0 on the hit itself).
- V: same, except Strac also treats weapon `NOTHING` as a punch.

### 2.2 `SoldierTakeDamage(t, life: i16, breath: i16, reason, attacker)` (`Soldier_Control.cc:5432-5861`)

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
  if (reason === BLOODLOSS) { if (main(2) === 0 || team(t).bMenInSector === 1) t.bLife = 0; }
  else if (t.bLife < 12 /*OKLIFE-3*/) t.bLife = 0;   // unprofiled hostiles: 12-13 left = dying, ≤11 = dead
}
t.sDamage += life;                                     // sDamage window, §1.2
if (t.bLife < 0) t.bLife = 0;
if (reason === EXPLOSION || reason === STRUCTURE_EXPLOSION) checkEquipmentForDamage(t, life);   // pre per item
if (reason !== GAS && !robot(t)) {
  if (reason === HANDTOHAND) { if (life > 0) t.bBleeding += 1; }
  else t.bBleeding = i8(t.bLifeMax - (t.bLife + bandage));          // = old bleeding + life actually lost
}
if (!robot(t)) deductPoints(t, trunc(life / 4) /*AP_GET_WOUNDED_DIVISOR*/, breath);   // §2.3
const combined = u8(trunc(u8(life) / 10) + trunc(breath / 2000));  // the (UINT8) cast binds to `life` only
if (!robot(t)) t.bShock = i8(t.bShock + combined);
t.dNextBleed = 1 + effectiveLife(t) / (10 + t.bTilesMoved);        // float; V integer-divides
if (t.bInSector && t.bVisible !== -1 && oldLife !== 0 && life !== 0 && life < 1000) startDamageDisplay(t);  // resets bDisplayDamageCount
if (reason !== BLOODLOSS && !robot(t)) {               // weapon drop :5716-5755
  let drop = max(0, 2 * max(life, trunc(breath / 100)) + (t.attacker?.body === BLOODCAT ? 20 : 0) - effectiveStrength(t));
  if (hand.flags & UNDROPPABLE) drop -= 30;
  if (main(100) < u16(drop) && hand.item && !(hand.flags & UNDROPPABLE)) addItemToPool(t.grid, hand, ourTeam ? VISIBLE : INVISIBLE), deleteObj(hand);
}
const blood = min(trunc(life / 10), 7); if (blood && !vehicleOrRobot && t.bInSector) dropBlood(t, blood);  // main, §2.11
if (t.bInSector) checkForBreathCollapse(t);            // sets bBreathCollapsed when bBreath == 0 (§2.7.4)
if (attacker?.team === OUR && t.team !== OUR && reason === EXPLOSION) statChange(attacker, EXPLODEAMT, 10 * combined, SUCCESS);
if (isOnOurTeam(t)) {
  statChange(t, EXPERAMT, 5 * combined, FAILURE);      // no-op if t.bLife < 10 (Campaign.cc:69)
  if (!pummelQuoteSaid && attacker && attacker !== t && ++t.bNumHitsThisTurn >= 3 && t.bLife - t.bOldLife > 20)
    if (main(100) < 40 * (t.bNumHitsThisTurn - 2)) quote;   // sign bug (= V): life only drops, so never true, never drawn
}
if (attacker?.team === OUR && t.ubProfile is NPC/RPC) set WOUNDEDBYPLAYER (Pacos → FACT_PACOS_KILLED);
handleTakeDamageDeath(t, oldLife, reason);             // only BLOODLOSS / ELECTRICITY / GAS do anything (§2.8.3)
if (t.bLife < 10) shutUpFace(t);
if (t.bLife < 15) decayIndividualOpplist(t);           // stops seeing
return combined;
```

`statChange` draws its `pre(100)` per chance at once (`Campaign.cc:261, 336`; §5). Field types: `bLife`, `bLifeMax`,
`bBleeding`, `bShock`, `bActionPoints`, `bBreath` INT8; `sBreathRed` INT16 (0..10000); `sDamage` INT16. V: same
formulas (V passes extra unused args).

### 2.3 `DeductPoints(t, ap, bp)` as used by hits and falls (`Points.cc:488-582`)

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
at his team's turn start `CalcNewActionPoints` caps carried points at 5 (`MAX_AP_CARRIED`, from above only, so a debt
carries) and adds the new pool (`Soldier_Control.cc:420-447`).
`effectiveLife = bLife + trunc((bLifeMax - bLife - bBleeding) / 2)` (`Soldier_Control.h:821`).

### 2.4 Hit animation choice (end of `EVENT_SoldierGotHit`, `:2862-3030`)

First match wins:

| # | Condition | Animation |
|---|---|---|
| 1 | Current state has `ANIM_HITSTOP` (lying in a STOP pose) | twitch, §2.8; return |
| 2 | Current state `ANIM_FIREREADY` | set `fGoBackToAimAfterHit` (continue) |
| 3 | `SOLDIER_COWERING` | merc body or `bLife == 0` → `GENERIC_HIT_STAND`, else `CIV_COWER_HIT` |
| 4 | Body COW / BLOODCAT / adult monsters / LARVAE / QUEEN / CRIPPLECIV / ROBOTNOWEAPON / INFANT / CROW | `COW_HIT`, `BLOODCAT_HIT`, `ADULTMONSTER_HIT`, `LARVAE_HIT`, `QUEEN_HIT`, `CRIPPLE_HIT`, `ROBOTNW_HIT`, `INFANT_HIT`, `CROW_DIE` |
| 5 | Civilian bodies (MANCIV, MINICIV, DRESSCIV, HATKIDCIV, KIDCIV) | if `bLife == 0` and not DEAD: `main(2) !== 0` → `CIV_DIE2`; else `GENERIC_HIT_STAND` |
| 6 | Over LOW_WATER / DEEP_WATER | `WATER_HIT` / `DEEP_WATER_HIT` |
| 7 | Weapon class gun or throwing knife | `SoldierGotHitGunFire` |
| 8 | Blade | `SoldierGotHitBlade` (generic by stance) |
| 9 | Explosive or tentacles | `SoldierGotHitExplosion` |
| 10 | Punch or NOTHING (also thrown objects) | `SoldierGotHitPunch` (generic by stance) |

Cases 7–10 are separate `if`s, not `else if` (an item matching two classes would get two calls; inferred never happens).

**`SoldierGotHitGunFire`** (`:3125-3238`). Only for non-monsters whose `ubEndHeight == STAND`:
- `HEAD_EXPLODE`, gore on, `SpacesAway(t, att) <= 7` (Chebyshev; `BulletImpact` used Pythagorean ≤ 7): if
  `OKFallDirection(t, g1 = t+dir(t.bDirection), JFK_HITDEATH)` and `OKFallDirection(t, g1+dir(t.bDirection),
  current state)` → head hit.
- `CHEST_EXPLODE`, gore on, `SpacesAway <= 7`, and the target **faces the shooter** (`t.bDirection == bDirection`):
  two tiles behind (`opp = Opposite(bDirection)`) checked with `FLYBACK_HIT`, then current state → blown away.
- `LEG_FALLDOWN` (not distance-limited): `IsValidStance(PRONE)`, standing, not in water → fallen over, plus a screen
  message.

Then: `SOLDIER_DEAD` → `ReleaseSoldiersAttacker`, return. Fallen over → `SoldierCollapse` (§2.6). Blown away and merc
body (`<= REGFEMALE`) → `ChangeToFlybackAnimation(bDirection)`. Head hit and merc or kid body → `JFK_HITDEATH`.
Otherwise **`DoGenericHit`**: stand → `BURST_SPECIAL` and merc body: snap `bDirection`/desired to `bDirection` (face
the shooter) and `STANDING_BURST_HIT`; else two-handed weapon in hand → `RIFLE_STAND_HIT`, else `GENERIC_HIT_STAND`;
crouch → `GENERIC_HIT_CROUCH`; prone → `GENERIC_HIT_PRONE`.

**`SoldierGotHitExplosion`** (`:3241-3336`): return if DEAD; cancel services; Strac fix: if the current state is
`ANIM_HITSTART` and not prone, clear the pending animation and both non-interrupt flags so the blast can knock him
down (a grenade that hit him on the way down had started a non-interruptible hit). Gore on, blast radius ≥ 3,
`bLife == 0`, not prone: range 2–4 → `CHARIOTS_OF_FIRE`, range ≤ 1 → `BODYEXPLODING`. Non-merc body →
`DoGenericHit(special 0)`. Stand/crouch: face the blast; if `OKFallDirection(tile behind, Opposite(dir),
FLYBACK_HIT)` → `ChangeToFallbackAnimation(dir)`, else stand → `BeginTyingToFall` + `FALLFORWARD_FROMHIT_STAND`,
crouch → `SoldierCollapse`. Prone → `SoldierCollapse`.

**Entering a hit/die state** (`EVENT_InitNewSoldierAnim`, `:870-1766`):
- `fInNonintAnim` set → the request is **silently dropped** (`:897-901`). Damage, busy `+1` and
  `bBeingAttackedCount+1` already happened; they are released together later (§2.9), or never if nothing ends the
  non-interruptible state (ja2-node releases that hit's count at once, deviations "Hit during a non-interruptible
  animation").
- `ANIM_NONINTERRUPT` states set `fInNonintAnim` (`:1350`); opcode 442 clears it.
- AP/BP on entry: `FALLBACK_HIT_STAND`, `FALLFORWARD_FROMHIT_STAND` → `DeductPoints(4, 250)`;
  `FALLFORWARD_FROMHIT_CROUCH` → `(2, 125)` (`:1557-1566`).
- The listed hit/die states set `fGettingHit = TRUE` (`:1597-1642`).
- `CHARIOTS_OF_FIRE`/`BODYEXPLODING` start at script index `main(10)` (`:1727`).
- Fixed-speed states are **not** halved in combat (only the stats-driven path is, `:4900-4905`); a soldier the player
  cannot see in combat gets delay 0 (`:4928-4936`).
- The first `AdjustToNextAnimationFrame` runs inside this call, so opcodes before the first frame fire **at impact**.
- Ends with `CheckForFreeupFromHit` (§2.9).

### 2.5 Hit animation timelines (frames × `gAnimControl` speed)

Frame data as in `11` §1.6. "after Fk" = executes `(k+1) × speed` ms after entry. Sounds and flashes omitted.

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
(GENERIC/RIFLE/BURST/CROUCH/PRONE hits, FLYBACK, JFK, CIV_COWER_HIT, water/creature hits), `ANIM_HITFINISH` (falls,
FLYBACK, JFK, CIV_DIE2, water/creature dying), `ANIM_HITSTOP` (STOP poses), `ANIM_HITWHENDOWN` (twitches).

Timelines from impact (standing, gore on, no rotation in 447):
- **Survives (life ≥ 15):** 390 ms in `GENERIC_HIT_STAND`, then back to aim or stationary; the attacker is released
  on that transition.
- **Killed, falls forward:** 130 ms → 433 → fall (AP 4, BP 250) → +2280 → 497 → `GENERIC_HIT_DEATH` → +720 → 440:
  corpse at ≈ 3130 ms. Falls back: 130 + 1170 + 720 ≈ 2020 ms. Gore off: 497 commits death at once (≈ 2410 ms).
- **Unconscious (1..14):** 130 + 2280 → 497 releases the attacker and settles in `STAND_FALLFORWARD_STOP`.

Until 440 the dying soldier keeps his tile, structure and `bLife == 0`, and can be hit again.

### 2.6 Turning from the hit, back to aim, falling, knockback

**478 "decide to turn from hit"** (`Soldier_Ani.cc:1202-1272`), merc bodies with `bLife >= 15`, `bBreath > 0`,
`bLevel == 0`; stores the old direction in `uiPendingActionData1`:
- not a head hit: `r = main(100)`; `< 30` → `OneC`, `30..59` → `OneCC`, else unchanged; applied **instantly**
  (`EVENT_SetSoldierDirection`).
- head hit: `main(100) < 50` → `SOLDIER_TURNINGFROMHIT`, then `main(50) < 25` → desired = 3 octants clockwise, else 3
  counter-clockwise (one octant per frame, `TurnSoldier`). On reaching the desired direction: `fGettingHit == 1` →
  desired = old direction, `fGettingHit = 2`; on reaching it again → clear the flag, `ReleaseSoldiersAttacker`,
  `fGettingHit = FALSE` (`Soldier_Control.cc:4357-4389`). (Turning into a roof fall just clears the flag.)

479 is a no-op (body commented out).

**472 "back to aim"** (`Soldier_Ani.cc:1098-1130`): if `fGoBackToAimAfterHit` (cleared here) and `bLife >= 15` →
`InternalSoldierReadyWeapon(t, t.bDirection, FALSE)`, which charges the ready APs again unless `fDontChargeReadyAPs`
is set (inferred from `Soldier_Control.cc:1412-1423`). Otherwise fall through to 499 (stationary stance).

**`BeginTyingToFall`** (`Soldier_Control.cc:8905`): `bStartFallDir = bDirection`, `fTryingToFall = TRUE`,
`fFallClockwise = main(50) < 25`.

**447 "try to fall"** (`Soldier_Ani.cc:587-634`), while `fTryingToFall`: if
`OKFallDirection(t, t+dir(t.bDirection), level, t.bDirection, FALLFORWARD_HITDEATH_STOP)` → stop trying (fall
forward). Else rotate one octant (cw/ccw per the flag), redisplay the previous frame, and if back at `bStartFallDir`
give up (fall anyway); otherwise **return without advancing**, so 447 re-runs next frame: one octant per frame
(120 ms) until a free tile is found, at most 7 extra frames.

**`OKFallDirection(t, g, level, dir, state)`** (`Soldier_Ani.cc:3295-3342`): false if
`gubWorldMovementCosts[g][dir][level] > TRAVELCOST_SHORE`, if `g` is water, if `!NewOKDestination(t, g, people=TRUE,
level)`, or if the prone structure of `state`'s surface cannot be added at `g − dir` using
`pDBStructureRef[OneCDirection(dir)]` ("the structure goes in the tile before" quirk).

**Fall back on incapacitation** (433, §2.7.1): tests `OKFallDirection(t, t.sGridNo, dirToAttacker,
FALLBACK_HIT_STAND)`, then the tile one step away from the attacker, same direction.

**`ChangeToFlybackAnimation(dir)`** (`Soldier_Control.cc:8415`): destination two tiles towards `Opposite(dir)`;
path = two steps of `Opposite(t.bDirection)` (equal, because flyback requires facing the shooter); `FLYBACK_HIT`.
**`ChangeToFallbackAnimation(dir)`** (`:8439`): one tile, one step of `Opposite(t.bDirection)`; `FALLBACK_HIT_STAND`.
Both `removePendingAction` first. Special-move states move `dMovementChange = 1.6` world units per frame along the
path; the occupancy switch happens at the tile boundary as in walking, but `HandleAtNewGridNo` (mines, movement noise,
sight, `07` §4) runs **only on the final tile** (`Overhead.cc:729-733`). Arriving with `bLife >= 15` and no pending
action calls `SoldierGotoStationaryStance`, which the non-interrupt flag swallows for `FALLBACK_HIT_STAND` (inferred).
In ja2-node the sighting pause does not freeze a soldier in a special move (deviations "Knock-back and the sighting
pause").

**`SoldierCollapse`** (`Soldier_Control.cc:7945-8053`): monsters get 5000 breath back and return. Else
`bCollapsed = TRUE`, cancel services, `HandleSight(LOOK)`, clear a pending give; by end height: stand → deep/low water
`DEEP_WATER_DIE` / `WATER_DIE`, else `BeginTyingToFall` + `FALLFORWARD_FROMHIT_STAND`; crouch → `BeginTyingToFall`,
then `FALLFORWARD_FROMHIT_CROUCH` (mercs) or `FALLFORWARD_FROMHIT_STAND` (others); prone → map an in-progress fall to
its STOP pose, else `PRONE_LAY_FROMHIT`. Enemy: re-pick the panic-trigger "chosen one"; AI soldier in combat →
`EndAIGuysTurn`.

**Roof edge** (`CheckSoldierHitRoof`, `:6118-6199`, called from 433): `bLife < 15`, a lower level adjacent and
standing → fall off (pending `FALLFORWARD_ROOF` or `FALLOFF` after turning) and `SoldierTakeDamage(100, 5000,
FALLROOF)`, i.e. certain death.

### 2.7 Incapacitation and death opcodes

**2.7.1 433 `CheckForAndHandleSoldierIncompacitated`** (`Soldier_Ani.cc:3045-3184`), returns if `bLife >= 15`:
1. Cancel services. Monsters, CRIPPLECIV, ROBOTNOWEAPON, QUEEN, tanks → `bLife = 0` (no unconscious state).
2. Meanwhile with the Queen present → trigger `APPROACH_DONE_SLAPPED`.
3. `CheckSoldierHitRoof` → return if falling off.
4. `bLife == 0` → death cry (`fDeadSoundPlayed`).
5. In `GENERIC_HIT_STAND`, `STANDING_BURST_HIT`, `RIFLE_STAND_HIT`, `CIV_COWER_HIT` (the last is a Strac fix; V omits
   it): `if (main(100) > 40 && mercBody && !terrorist)` (draw first): with an attacker, test direction = towards the
   attacker (forced); two `OKFallDirection` checks (§2.6); OK → face it if forced and
   `ChangeToFallbackAnimation(t.bDirection)`, return. Otherwise `BeginTyingToFall` (`main(50)`) and
   `FALLFORWARD_FROMHIT_STAND`.
6. Else by state: `GENERIC_HIT_CROUCH` → `FALLFORWARD_FROMHIT_CROUCH` then `BeginTyingToFall` (state first, draw
   second); `GENERIC_HIT_PRONE` → `PRONE_LAY_FROMHIT`; creature/cow/bloodcat/water hits → their DYING/DIE state.

**2.7.2 497 "death or release"** (`:1631-1716`):
- `bLife == 0`: death cry unless already played or `JFK_HITDEATH`. Gore on → the death state for the current fall
  (`FLYBACK_HIT → FLYBACK_HIT_DEATH`; `GENERIC_HIT_DEATHTWITCHNB`, `FALLFORWARD_FROMHIT_STAND`,
  `ENDFALLFORWARD_FROMHIT_CROUCH → GENERIC_HIT_DEATH`; `FALLBACK_HIT_DEATHTWITCHNB`, `FALLBACK_HIT_STAND →
  FALLBACK_HIT_DEATH`; `PRONE_HIT_DEATHTWITCHNB`, `PRONE_LAY_FROMHIT → PRONE_HIT_DEATH`; roof falls → `FALLOFF_*DEATH`;
  creature/robot/cripple dying → their `_STOP`). Gore off → `CheckForAndHandleSoldierDeath` at once.
- Alive: if the state has `ANIM_HITFINISH` → `ReleaseSoldiersAttacker` (may change teams and deactivate the soldier;
  return if so), `fGettingHit = FALSE`. Then `HandleCheckForDeathCommonCode` (`:3345-3437`): pending animation → play
  it; else `bCollapsed = TRUE`, `HandleSight(LOOK)`, on his own team's turn `BeginSoldierGetup`; map to the STOP pose
  (`FLYBACK_HIT → FLYBACKHIT_STOP`, falls forward → `STAND_FALLFORWARD_STOP`, falls back → `FALLBACKHIT_STOP`, prone →
  `PRONE_LAYFROMHIT_STOP`, roof → `FALLOFF_STOP` / `FALLOFF_FORWARD_STOP`). The block is **duplicated** (= V): on his
  own turn `BeginSoldierGetup` can run twice, so `bTurnsCollapsed` and `bSleepDrugCounter` move by 2.

**2.7.3 440 "set buddy as dead"** (`:422-445`): stop the burn sound for CHARIOTS/BODYEXPLODING;
`CheckForAndHandleSoldierDeath` (`:3013`): `HandleSoldierDeath` (§2.10); only if **no corpse** was made, switch to the
matching `*_HITDEATH_STOP` / `*_DIE_STOP` pose. Returns FALSE when a corpse was made (the soldier no longer animates).
**465** sets `bLife = 0`.

**2.7.4 Breath collapse.** `CheckForBreathCollapse` (`Soldier_Control.cc:7565`) only sets `bBreathCollapsed` when
`bBreath == 0` (not for vehicles, animals, monsters, or the already collapsed). The next `AdjustToNextAnimationFrame`
outside a non-interruptible state calls `SoldierCollapse`, unless the current state is HITSTOP/HITFINISH, `bLife == 0`
or a roof fall, which cancel it (`Soldier_Ani.cc:114-145`).

### 2.8 Hit while down, and deaths not from hits

**2.8.1 Twitch table** (`EVENT_SoldierGotHit`, `:2862-2885`), when lying in a STOP pose:
`FLYBACKHIT_STOP → FALLBACK_DEATHTWICH`, `STAND_FALLFORWARD_STOP → GENERIC_HIT_DEATHTWITCHNB`,
`JFK_HITDEATH_STOP → JFK_HITDEATH_TWITCHB`, `FALLBACKHIT_STOP → FALLBACK_HIT_DEATHTWITCHNB`,
`PRONE_LAYFROMHIT_STOP → PRONE_HIT_DEATHTWITCHNB`, `PRONE_HITDEATH_STOP → PRONE_HIT_DEATHTWITCHB`,
`FALLFORWARD_HITDEATH_STOP → GENERIC_HIT_DEATHTWITCHB`, `FALLBACK_HITDEATH_STOP → FALLBACK_HIT_DEATHTWITCHB`,
`FALLOFF_DEATH_STOP → FALLOFF_TWITCHB`, `FALLOFF_STOP → FALLOFF_TWITCHNB`, `FALLOFF_FORWARD_DEATH_STOP →
FALLOFF_FORWARD_TWITCHB`, `FALLOFF_FORWARD_STOP → FALLOFF_FORWARD_TWITCHNB`; any other HITSTOP state: no animation.
**NB** (unconscious) twitches end in 497, so a killing hit on a downed soldier plays the death state and reaches 440.
**B** twitches (dead poses) end in 496 (back to the pose).

**2.8.2** Leaving a twitch (`ANIM_HITWHENDOWN`) releases the attacker when the soldier is DEAD or still alive
(`CheckForFreeupFromHit`, `Soldier_Control.cc:842-856`); if `bLife == 0` the killer is reset to `previous_attacker`.
`FALLBACK_DEATHTWICH` has no HITWHENDOWN flag and ends in 496, so a hit on someone in `FLYBACKHIT_STOP` would never be
released (inferred unreachable: flyback needs a lethal chest hit).

**2.8.3 Collapsing from bleeding/gas/electricity**: `HandleTakeDamageDeath` (`:5358-5426`): in sector, a death cry for
non-bloodloss deaths; electricity below OKLIFE clears `fInNonintAnim`; `0 < bLife < 15` and not collapsed →
`SoldierCollapse`; `bLife == 0` → `fDoingExternalDeath = TRUE`, then `CheckForAndHandleSoldierDyingNotFromHit`
(`Soldier_Ani.cc:3186-3240`): death cry, `bBeingAttackedCount++` (no busy `+1`), gore on → death state from the
current pose (fall/STOP/creature map), else (and for unmapped poses) `CheckForAndHandleSoldierDeath` directly. Out of
sector or in map screen, our dead merc → `StrategicHandlePlayerTeamMercDeath`. Electricity with `bLife >= 15` →
`ReleaseSoldiersAttacker`.

### 2.9 Busy-count accounting for the target

- `+1` per hit on a non-vehicle (`EVENT_SoldierGotHit`), counted in `bBeingAttackedCount`.
- **`ReleaseSoldiersAttacker(t)`** (§3.2) pays all `bBeingAttackedCount` decrements at once: one release frees every
  hit that landed during the sequence, including hits whose animation was swallowed.
- Release points (the callers of `ReleaseSoldiersAttacker`):
  - **`CheckForFreeupFromHit`** on any state change: old state `ANIM_HITSTART`, new state not `HITFINISH` /
    `IGNOREHITFINISH`, states differ, not turning from a hit (`Soldier_Control.cc:813-840`, call `:832`). The normal
    survivor path (hit animation → 472/499 → stand or aim). Also a `main(10) === 0` curse for our conscious soldiers
    (cosmetic).
  - Opcode 480 (no current script uses it on a hit path) and 497 with HITFINISH (unconscious)
    (`Soldier_Ani.cc:1299, 1699`); the end of turning from a hit (`Soldier_Control.cc:4384`); leaving a twitch
    (`:854`); electricity damage (`:5423`, §2.8.3).
  - Death (`Soldier_Ani.cc:2977, 3006`): `HandleSoldierDeath` for non-player soldiers (unless
    `fDoingExternalDeath`); for **our** mercs only in `HandlePlayerTeamMemberDeathAfterSkullAnimation`, after the
    portrait close + skull UI animation (12 frames × 160 ms wall clock, `Interface_Panels.cc:2936-3025`) or
    `FinishAnySkullPanelAnimations` on leaving the screen. Until then the barrier stays up (ja2-node: 1920 game ms
    after 440, deviations "Our merc's death").
  - `SoldierGotHitGunFire` on an already DEAD soldier releases at once (`Soldier_Control.cc:3207`).
- `ReduceAttackBusyCount(attacker, FALSE)` never checks `bBulletsLeft`; reaching 0 runs the end of the attack (§3.4,
  `Overhead.cc:5510-5787`; `10` §5): suppression, `ProcessImplicationsOfPCAttack`, `NoticeUnseenAttacker`, the
  killed-enemy quote, `CheckForEndOfBattle`.
- A shooter hit mid-burst (burst states are interruptible) keeps `bBulletsLeft` for the rounds never fired; nothing
  resets it (inferred: the attack's busy hold then leaks until the 25 s watchdog; mostly a real-time case, where the
  next order zeroes the count, `11` §1.3). ja2-node does not special-case it.

### 2.10 `HandleSoldierDeath` → corpse (`Soldier_Ani.cc:2855-2997`)

Runs at 440 (or 497 with gore off) if `bLife == 0` and not yet DEAD:
1. Cancel services; destroy muzzle-flash and personal light sprites; `fGettingHit = FALSE`.
2. **Our team:** dirty the panel, `fUIdeadMerc = TRUE` (starts the skull UI), `SOLDIER_DEAD` unless
   `gfKillingGuysForLosingBattle`.
   **Others:**
   a. attacker on our team and busy > 0 → remember for the "killed enemy" quote at busy 0; else if the victim is
      visible → `main(3) === 0` and attacker not a creature → attacker laughs (drawn whenever visible; cosmetic).
   b. **`HandleNPCTeamMemberDeath`** (`Overhead.cc:2273-2522`): `SOLDIER_DEAD`; `VerifyPublicOpplistDueToDeath`;
      profiled → `MERC_IS_DEAD`, history; civilians: quest/fact hooks per profile (Brenda, Pablo → event in
      `480 + Random(60)` min, terrorists, assassins, Eldin, Joey/Martha, Dynamo, Kingpin, Doreen, Queen) and
      `HandleMurderOfCivilian` (not crows/cows); militia: `StrategicRemoveMilitiaFromSector`, murder check,
      `GLOBAL_LOYALTY_NATIVE_KILLED`; enemies/creatures: queen-monster death, `ubArmyGuysKilled++` +
      `TrackEnemiesKilled`, our killer → `MORALE_KILLED_ENEMY`, `GLOBAL_LOYALTY_ENEMY_KILLED`,
      `CheckForAlertWhenEnemyDies`, reset the chosen one, Deidranna/queen morale and loyalty; kill and assist
      `StatChange(EXPERAMT)` (§5); militia killer `ubMilitiaKills++`. Dealer inventory to the ground,
      `ProcessQueenCmdImplicationsOfDeath`, `CheckForEndOfBattle` (no-op while busy > 0).
   c. Kill and assist records: `usKills`, `usPlayerKills`, `usAssists`, `ubMilitiaKills` (§5 "Records").
3. **`TurnSoldierIntoCorpse`** (`Rotting_Corpses.cc:609-760`): corpse type from `gubAnimSurfaceCorpseID[body][state]`
   (so the final death state picks the corpse sprite); items: robot none, queen monster drops 6 − (difficulty − 1)
   jars two rows south, else every inventory slot not `UNDROPPABLE` (always for our team or with policy
   `drop_everything`) and not `ITEM_DEFAULT_UNDROPPABLE`; non-player ammo stacks become `1 + main(count)` clips (slot
   order); visibility: ours/Queen visible, others hidden unless `all_dropped_visible`; keys; then
   `AllSoldiersLookforItems`; non-player → `TacticalRemoveSoldier`, ours → `RemoveSoldierFromGridNo`; add the corpse
   (item drops in detail: `12` §9.1; ja2-node: no rotting, crows or decapitation, gaps "Corpses").
4. `RemoveManAsTarget` (public and personal opplists cleared, `OppList.cc:2075`), `BetweenTurnsVisibilityAdjustments`.
5. Non-player and not external death → `ReleaseSoldiersAttacker`.

Our merc after the skull UI: `ReleaseSoldiersAttacker` (unless external death), then `HandlePlayerTeamMemberDeath`
(`Overhead.cc:2183-2271`): opplist verify, buddy quotes, Slay/robot facts, `StrategicHandlePlayerTeamMercDeath`
(insurance, history, morale), `CheckForEndOfBattle`, reselect.

### 2.11 Bleeding, bandages, shock, getting up, stat loss

- **Bleeding.** `bBleeding` = unbandaged lost life; bandaged life = `bLifeMax − bLife − bBleeding`. A gun, blade or
  blast hit adds exactly the life lost; hand-to-hand adds 1; gas none. Every damage call restarts `dNextBleed` (§2.2;
  V `(bLife + bandaged/2) / (10 + tiles)` in integers).
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
- **Getting up** (`BeginSoldierGetup`, `Soldier_Control.cc:5266-5343`, at turn start and from 497): if collapsed and
  `bLife >= 15`, `bBreath >= 10`, no sleep drug → merc: from forward/prone poses `ChangeSoldierStance(CROUCH)`, from
  back/flyback poses `ROLLOVER` (437 then reverses direction and gets up); others `END_COWER`. Else
  `bTurnsCollapsed++` (boxing KO logic). Not collapsed but drugged → `pre(100) < succumbChance` → full breath loss and
  collapse. `bSleepDrugCounter--` at the end.
- **Stat loss** from criticals is decided and applied inside `BulletImpact` (§1.2); nothing further happens in the hit
  path. `bLifeMax` only drops through dying bleeds (above).
- **Blood** (`TileEngine/Smell.cc:339-470`): a new pool draws `main(3)` for its decay time; drawing it (visible, gore
  on) draws `main(4)` (the browser picks the graphic, deviation "Cosmetic draws in attacks"). Blood falls from wounds
  and bleeding (`DropBlood`, drawn at once while the soldier is visible), on the tile behind a man a bullet passes
  through (`BulletHitMerc`: on the ground unless the move into it is blocked; on a roof only where a roof is, else on
  the ground) and on the tile of a man flying back and the tile behind him (opcode 765 of `FLYBACK_HIT_BLOOD_STAND`);
  these two always drop a full pool (7) and draw it at once. A corpse a blast blows apart sprays 7, 5 and 3 around its
  tile (`12` §10.6). A new corpse wipes the blood under every tile of its structure (`AddRottingCorpse`).
  Gameplay-relevant only through creature smell and the decay draws; the pools the player sees are `29` §7.
- **Fragile items** on falls: 721 in `FALLFORWARD_FROMHIT_STAND` → `CheckEquipmentForFragileItemDamage(20)` (jars;
  `pre` per item). The 722 branch for `FALLFORWARD_FROMHIT_CROUCH` is dead (that script has no 722). Not ported (§6.3):
  ja2-node treats 721 as a sound cue only, so these `pre` draws are missing.

### 2.12 Turn-based vs real time

| Effect | Turn-based (`INCOMBAT`) | Real time |
|---|---|---|
| AP loss `life/4`, falls 4 (crouch 2) | applied (floor/debt rules §2.3) | none; breath only |
| Shock halving, bleeding tick, getting up | at the soldier's team turn start | every 5 s `HandleTacticalEndTurn` for all; bleed tick 0.5 |
| Animation speed | fixed-speed hit/death states unchanged; unseen soldiers delay 0 | table speed |
| Busy barrier | blocks interrupts, defers noise and AI | still counted (muzzle flash cleared at 0) |
| Locate camera on our hit merc | yes | no |

## 3. The attack barrier, suppression and the end of an attack

### 3.1 Suppression points: accrual while a bullet flies (`LOS.cc` `MoveBullet`)

Fields (`Soldier_Control.h`): `ubSuppressionPoints` UINT8, `ubAPsLostToSuppression` UINT8, `fCloseCall` INT8,
`suppressor` (V: `ubSuppressorID`), `bUnderFire` INT8. All but `bUnderFire` are cleared in `EVENT_BeginMercTurn`
(`Soldier_Control.cc:4139-4143`, together with the BEING_PUMMELED and CLOSE_CALL quote flags and `bNumHitsThisTurn`).

Accrual runs once per tile the bullet enters, while the list of possible hits is built (`LOS.cc:3507-3834`), so
**before** any collision in that tile is resolved. A soldier who is then hit keeps his point (`--ubSuppressionPoints`
is commented out, `LOS.cc:1862`). `iLoop` is in world units.

```ts
// per tile entered (LOS.cc:3529-3540): which storey the bullet is on
const cubesAbove = cubeOf(fixInt(qCurrZ - landFix(g)));            // CONVERT_HEIGHTUNITS_TO_INDEX
const desiredLevel = cubesAbove < 4 ? 0 : 1;                        // STRUCTURE_ON_GROUND_MAX = 4

// (a) each STRUCTURE_PERSON in the tile's structure list, in list order, tgt !== firer (LOS.cc:3651-3727)
//     [the candidate test for hitting tgt comes first, `11` §3.4; it may draw pre(100)]
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
  if ((bullet.usFlags & BULLET_FLAG_BUCKSHOT) && main(2) === 0) return;  // drawn only for buckshot
  switch (gAnimControl[t.usAnimState].ubEndHeight) {
    case ANIM_PRONE:  if (pre(4) === 0) return;   // fall through
    case ANIM_CROUCH: if (pre(4) === 0) return;   // fall through
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

### 3.2 When suppression is resolved: the attack busy count

`gTacticalStatus.ubAttackBusyCount` (UINT8) is the global "attack in progress" counter. Every increment must be paid by
exactly one decrement; the end-of-attack sequence (§3.4) runs when it reaches 0.

Decrement entry points (`Overhead.cc:5788-5822`):

| Function | Calls | Bullet guard |
|---|---|---|
| `FreeUpAttacker(att)` | `Internal…(att, TRUE, att.target)` | yes |
| `ReduceAttackBusyCount(att, fByAttacker)` | `Internal…(att, fByAttacker, att.target)` | if `fByAttacker` |
| `FreeUpAttackerGivenTarget(tgt)` | `Internal…(tgt.attacker, TRUE, tgt)` | yes |
| `ReduceAttackBusyGivenTarget(tgt)` | `Internal…(tgt.attacker, FALSE, tgt)` | no |

Bullet guard (`:5529-5537`): if called by the attacker, `att.inv[HANDPOS]` (not `ubAttackingHand`) is a gun and
`att.bBulletsLeft > 0`, return without decrementing. Below zero the decrement is skipped (`:5543-5555`).

Counting for the common attacks (↑ increment, ↓ decrement). Every attack animation in `Ja2bin.dat` carries opcode 757
(busy ↑) on frame 0 and 753 (busy ↓) on its last frame or in its follow-up state (STAB/SLICE → KNIFE_GOTOBREATH)
(read with `tools/spikes/ja2bin-timelines.py`).

- **Gun, single or burst.** `EVENT_FireSoldierWeapon` ↑ and sets `bBulletsLeft` = 1, 2 (two pistols) or
  `min(ShotsPerBurst, ubGunShotsLeft)`, ×`NUM_BUCKSHOT_PELLETS` for buckshot (`Soldier_Control.cc:2125, 2139-2158`).
  The fire animation's 757 ↑. Each real bullet's end calls `RemoveBullet` (`bBulletsLeft--`, `Bullets.cc:128-139`):
  - miss or stopped by a structure: then `FreeUpAttacker`, a no-op until the last bullet (`Weapons.cc:3211`,
    `StructureHit` paths);
  - stopped in a soldier: `RemoveBullet` first, then `WeaponHit` → `EVENT_SoldierGotHit` (`LOS.cc:2157-2202`);
  - passes through a soldier: no `RemoveBullet` yet, so the guard holds until it ends elsewhere.

  The animation's 753 ↓ (or the 448 burst stop, which calls `ReduceAttackBusyCount(att, FALSE)` and changes to the aim
  state, skipping 753; `Soldier_Ani.cc:693-708`). A jam at 470 refunds this shot's bullets and calls `FreeUpAttacker`
  (`:1056-1079`); a jam on the first burst round sets `bBulletsLeft = 0` and calls `FreeUpAttacker` (`:659-681`).
- **Each soldier hit** (`EVENT_SoldierGotHit`, `Soldier_Control.cc:2633-2664, 2771-2791`; §2.1): (1) a target
  himself mid SHOOT_ROCKET/SHOOT_MORTAR/THROW_ITEM/LOB_ITEM: `ReduceAttackBusyCount(target, FALSE)`; (2) not a
  vehicle: `bBeingAttackedCount++`, busy ↑ (the hit animation); (3) after `SoldierTakeDamage`, unless the reason is
  TENTACLES or OBJECT: gun → `FreeUpAttackerGivenTarget` (guarded), anything else → `ReduceAttackBusyGivenTarget`
  (always ↓).
- **Hit animation end** → `ReleaseSoldiersAttacker` (`Soldier_Control.cc:6439-6480`):
  ```ts
  if (s.previous_attacker !== s.attacker) s.next_to_previous_attacker = s.previous_attacker;
  s.previous_attacker = s.attacker;
  const n = s.bBeingAttackedCount; s.bBeingAttackedCount = 0;    // zeroed first: suppression may raise it again
  for (let i = 0; i < n; i++) ReduceAttackBusyCount(s.attacker, false);
  if (s.bLife !== 0 && s.ubBodyType !== QUEENMONSTER) s.attacker = null;   // kept on the dead for kill credit
  ```
  Callers: the release points of §2.9.
- **Melee.** `EVENT_SoldierBeginBladeAttack` / `BeginPunchAttack` ↑ (`Soldier_Control.cc:6583, 6735`), animation
  757/753. A miss calls `FreeUpAttacker` (not a gun, so always ↓). A hit is paid by `ReduceAttackBusyGivenTarget` in
  `EVENT_SoldierGotHit`.
- **Suppression stance change** ↑ (§3.3); its end (opcode 499, `fChangingStanceDueToSuppression`) →
  `ReduceAttackBusyCount(s.suppressor, FALSE)` (`Soldier_Ani.cc:1794-1799`).

Since several soldiers decrement, the `pSoldier` handed to §3.4 is whoever brought the count to 0: the shooter (753,
last bullet, his targets' `ReleaseSoldiersAttacker`) or the suppressor (stance change). §3.4 then uses
`pTarget = pSoldier.target`.

### 3.3 `HandleSuppressionFire(targetedMerc, causedAttacker)` (`Overhead.cc:5167-5341`)

Only called from §3.4, and only when `INCOMBAT` (V: `TURNBASED && INCOMBAT`, the same because V keeps `TURNBASED`
permanently set, `V Overhead.c:546`). **In real time suppression has no effect**: points accrue and are wiped every
5 s by `EVENT_BeginMercTurn` from `HandleTacticalEndTurn` (`Tactical_Turns.cc:130, 151`). No RNG.

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

- Net effect: a standing soldier only drops to a crouch; a crouched one goes prone. A second attack in the same turn
  can take him one step further, because `total` (not the increment) is tested.
- Re-entry: the stance change raises the busy count, so §3.4 returns early (`:5574-5578`). When the last stance change
  ends (499), §3.4 runs again with `pSoldier = suppressor`. `HandleSuppressionFire` is then a no-op, because
  `ubAPsLostToSuppression` already equals `total`, and the rest of §3.4 runs **once**. If that call starts another
  stance change of the same soldier (crouch, then prone), ja2-node returns from the end of the finished animation
  instead of falling through to `SoldierGotoStationaryStance` (deviations "Suppression stance change from the end of
  the previous one").
- `bActionPoints` may go negative here; the debt carries into the next turn (§2.3).
- **V diff** (`V Overhead.c:5811-5976`): in the crouch→prone branch V refunds `AP_PRONE − lost` APs, or subtracts
  AP_PRONE from `lost`, even though the stance change is free; Strac removed that refund. V also has no
  `InternalGivingSoldierCancelServices`, and gates its busy increment on `TURNBASED && INCOMBAT`.

### 3.4 End of attack: `InternalReduceAttackBusyCount` (`Overhead.cc:5510-5787`)

In order:
1. `pSoldier == NULL` → `pTarget = NULL` (`:5517-5527`).
2. Bullet guard (`:5529-5537`), then decrement with a floor at 0 (`:5543-5555`). Count still > 0 → return (`:5560`).
3. If `INCOMBAT`: `HandleSuppressionFire(pSoldier?.target, pSoldier)`. If the count went back up, return
   (`:5565-5578`).
4. In a Meanwhile scene, unless the attacker is QUEEN, return (`:5585`).
5. `pTarget.bNumPelletsHitBy = 0` (`:5593`).
6. If `pSoldier` (`:5597-5715`):
   1. `ubAttackingHand = HANDPOS`.
   2. If `pTarget` and `SOLDIER_ATTACK_NOTICED`. `UseBlade`/`UseHandToHand` set that flag when someone stands on the
      target tile (`Weapons.cc:916, 1062`); guns set it once a bullet with a non-null `firer.target` comes within
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
8. `HandleAnyStatChangesAfterAttack` → `ProcessUpdateStats` for every OUR_TEAM merc (`:5726`, `Campaign.cc:917-924`;
   §5).
9. `fItemsSeenOnAttack` and it is our turn → item-locator quote (`:5729-5746`).
10. `CHECK_SIGHT_AT_END_OF_ATTACK`, set by explosions (`Explosion_Control.cc:109`) → `AllTeamsLookForAll(FALSE)` and
    `RevealRoofsAndItems` for our team, then clear the flag (`:5748-5761`).
11. `DequeueAllDemandGameEvents()`: deferred noise and its interrupts (`:5763`).
12. `CheckForEndOfBattle(FALSE)` (`:5765`).
13. Not `INCOMBAT` → `EndMuzzleFlash(att)` (`:5768-5771`).
14. `bWeaponMode == WM_ATTACHED` → `WM_NORMAL` (`:5773-5777`).
15. `att.sLastTarget = att.sTargetGridNo` (`:5781-5784`).

V is identical apart from IDs instead of pointers; its item quote is `QUOTE_SPOTTED_SOMETHING_ONE + Random(2)`
(`V Overhead.c:6130-6340`).

**`ProcessImplicationsOfPCAttack(att, tgt, reason)`** (`Overhead.cc:5344-5505`; returns `fEnterCombat`, default TRUE):
wake an `AI_ASLEEP` target; boxing rules (knife or knuckles disqualify; otherwise the boxer turns neutral); then the
first matching case: friendly militia → `MilitiaChangesSides`; neutral Slay → NPC record; a neutral civilian without a
civ group → hostile-or-quote list plus `MilitiaChangesSides` (Hicks' cow and Pablo have their own records); a recruited
or neutral civ-group member → `CivilianGroupMemberChangesSides`, other groups → `…ChangeSidesWithinProximity`; one of
our own mercs attacked out of combat readies his weapon for free and fires back through `HandleItem` (burst if he can),
with `fEnterCombat = false`; Carmen and the head miner have their own hooks. Explosions call it per victim with
`REASON_EXPLOSION` (`Explosion_Control.cc:740, 852`). ja2-node ports neither the fire-back nor the head-miner rule
(gaps "Implications of an attack").

### 3.5 Being shot at: `NoticeUnseenAttacker`, interrupts, `bUnderFire`, close calls

**`NoticeUnseenAttacker(att, def)`** (`OppList.cc:4608-4752`). Returns at once unless `INCOMBAT`. Then, in order:
1. Dart gun: `SkillCheck(def, NOTICE_DART_CHECK, 0) < 0` → return. The skill is
   `EffectiveWisdom/10 + EffectiveExpLevel` minus fatigue, plus the morale modifier, clamped 0–99. RNG: `pre(100)`; on
   failure also `main(100)` (a silent curse test, cosmetic) (`SkillCheck.cc:273-276, 305-372`).
2. Larvae, or a vehicle on our team → return.
3. Within `MaxDistanceVisible`: the defender's `DistanceVisible`, ignoring the muzzle flash unless he faces within ±1
   octant, then `SoldierToSoldierLineOfSightTest(def, att, limit, aware=TRUE)`.
4. If he sees the attacker: `ManSeesMan`; on our team `StatChange(EXPERAMT, 5)` and `RadioSightings`, otherwise
   `ReevaluateEnemyStance`. If he doesn't: `SetNewSituation`; alert < RED → RED + `CheckForChangingOrders`;
   `UpdatePersonal(HEARD_THIS_TURN, att.sGridNo)`; a PC also updates the public opplist.
5. Interrupt: if `StandardInterruptConditionsMet(def, att, oldOpp)`, a one-man interrupt duel
   (`CalcInterruptDuelPts` both ways, `InterruptDuel`, `AddToIntList`). No RNG.

`bUnderFire` is set *after* this call (§3.4 step 6.2), so the duel sees the previous value.

**`bUnderFire`.** Set to 2 in §3.4. Decremented in the soldier's own `EVENT_BeginMercTurn` (`Soldier_Control.cc:4004`),
or every 5 s in real time. Uses:
- Interrupts: `StandardInterruptConditionsMet` returns FALSE while `bUnderFire != 0` (`TeamTurns.cc:999`;
  `interrupt_after_being_under_fire` = false, `game.json:80`, is the V behaviour). An enemy shot at during our turn
  therefore cannot interrupt for the rest of our turn and all of our next one.
- AI morale: +1 category when 0 (`TacticalAI/AIUtils.cc:1804`); many `DecideAction` branches (rest, run away, "do
  nothing", face the noise, YELLOW → RED), cover roaming, radio, grenade tosses and creatures read it (`13` §3–§6).

**Close calls.** `fCloseCall` (§3.1) feeds `SayCloseCallQuotes` (`TeamTurns.cc:490-507`): for each OUR_TEAM merc that
is controllable, has `fCloseCall`, `bNumHitsThisTurn == 0` and hasn't said the quote this turn, `main(3) == 0` →
QUOTE_CLOSE_CALL; then `fCloseCall` is cleared for all of them. Called from `EndAIGuysTurn` only if no OUR_TEAM merc
was hit during the AI's turn (`AIMain.cc:529-535`; `fSomeoneHit` is set in `LOS.cc:2196-2200`), and when the
player's interrupt starts (`TeamTurns.cc:615`). The per-burst close-call code in `FreeUpNPCFromAttacking` is commented
out (`AIMain.cc:689-740`).

**Being pummelled** (`Soldier_Control.cc:5815-5837`): the `bNumHitsThisTurn` test at the end of §2.2 (OUR_TEAM victim
hit by someone else) → QUOTE_TAKEN_A_BREATING. The life test looks inverted, so in practice the roll is never drawn
(inferred).

## 4. Morale

Attack-related entries of `gbMoraleEvent` (`Morale.cc:27-64`):

| Event | Type | Δ | Trigger | Who |
|---|---|---|---|---|
| KILLED_ENEMY | tactical | +4 | killer on OUR_TEAM; victim neither CIV nor MILITIA (`Overhead.cc:2461-2465`) | killer |
| SUPPRESSED | tactical | −1 | per 2 APs lost to suppression, ≤4/turn (`Overhead.cc:5213-5219`) | suppressed soldier |
| DID_LOTS_OF_DAMAGE | tactical | +2 | `sDamage > 25` in `EVENT_SoldierGotHit`, attacker OUR_TEAM. Tested before the punch damage division and **without an enemy check** (`Soldier_Control.cc:2671-2678`) | attacker |
| TOOK_LOTS_OF_DAMAGE | tactical | −3 | same test, victim OUR_TEAM (`:2679-2683`) | victim |
| KILLED_CIVILIAN | strategic | −5 | `HandleMurderOfCivilian`: killer OUR_TEAM, CIV_TEAM victim, not a crow, not KINGPIN/ALMA_MILITARY/HICKS/WARDEN group, not a TOWN_DOESNT_CARE NPC (`Strategic/Strategic_Town_Loyalty.cc:350-402`) | whole team |
| TEAMMATE_DIED | strategic | −5 | `StrategicHandlePlayerTeamMercDeath`, not for EPCs or the robot (`Strategic/Strategic_Merc_Handler.cc:115-120`) | fan-out below |
| SQUADMATE_DIED | tactical | −5 | part of the TEAMMATE_DIED fan-out, same sector | each merc |
| BUDDY_DIED | strategic | −15 | fan-out: the dead merc is in this merc's buddy list | each merc |
| HATED_DIED | strategic | +5 | fan-out: replaces all of the above | each merc |
| MONSTER_QUEEN_KILLED / DEIDRANNA_KILLED | strategic | +15 / +25 | `Overhead.cc:2477-2486` | whole team |

TEAMMATE_DIED fan-out (`Morale.cc:529-562`), for each OUR_TEAM merc with a profile: if he hated the dead merc,
HATED_DIED only; otherwise SQUADMATE_DIED if in the same sector, then TEAMMATE_DIED, then BUDDY_DIED if a buddy.
Battle won/lost events come from `CheckForEndOfBattle` (`Overhead.cc:4474, 4595`; out of scope here).

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

- Only profiled soldiers have morale: enemies and unprofiled NPCs pass through `updateSoldierMorale` unchanged. Only
  `SOLDIER_PC` reads `bMorale`; everyone else uses `bAIMorale`.
- ja2-node takes `progressPct()` from the value computed at sector load (deviations "Difficulty and progress in
  tactical") and has no drug terms (gaps "Morale without drugs").
- Decay: tactical modifier every quarter hour (`HandleQuarterHourUpdate`, `Strategic/Hourly_Update.cc:85-92` →
  `Morale.cc:138-217`): positive `max(0, m − (8 − m/10))`, negative `min(0, m + (6 + m/10))`. Claustrophobic
  underground and Nervous alone keep re-applying their events instead. Strategic modifier every 3 hours
  (`Morale.cc:810-813`).

**Morale → chance to hit** (`GetMoraleModifier`, `Morale.cc:70-102`):

```ts
function moraleModifier(s): number {
  if (s.uiStatusFlags & SOLDIER_PC)
    return s.bMorale > 50 ? trunc((s.bMorale - 45) / 10) : trunc((s.bMorale - 50) * 2 / 5);  // +5 … −20, C truncation
  return { [MORALE_HOPELESS]: -15, [MORALE_WORRIED]: -7, [MORALE_CONFIDENT]: 2, [MORALE_FEARLESS]: 5 }[s.bAIMorale] ?? 0;
}
```

Added to marksmanship in `CalcChanceToHitGun` (`Weapons.cc:2027`), to both the attacker's and the defender's rating in
`CalcChanceHTH` (`:3274, 3353`), to `CalcThrownChanceToHit` (`:3618`) and to every `SkillCheck` (`SkillCheck.cc:329`).

**AI morale** (`bAIMorale`, `CalcMorale`, `TacticalAI/AIUtils.cc:1606-1825`; `13` §4.1) is recomputed only inside
`DecideAction`, so suppression tolerance (§3.3) and the CTH modifier read the value from the soldier's last decision.
No RNG.

## 5. Experience and stat gains from attacks

`StatChange(s, stat, n, cause)` (`Campaign.cc:48-75`) ignores soldiers not on our team, without a profile, vehicles,
robots, POWs and life < CONSCIOUSNESS; then runs `ProcessStatChange` and `ProcessUpdateStats`.

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
    if (pre(100) < chance) {                                // ONE pre draw per chance, even when chance is 0
      gain(p, stat)++;
      if (stat !== EXPERAMT && cause !== FROM_TRAINING && p.bExpLevel + trunc(p.sExpLevelGain / sppLvl) < 10
          && (cause !== FROM_FAILURE || p.sExpLevelGain + 1 < sppLvl)) p.sExpLevelGain++;   // 1:1 toward level
    }
  }
  if (cause !== FROM_TRAINING) { p.usStatChangeChances[stat] += n; p.usStatChangeSuccesses[stat] += |Δ|; }
}
```

`ProcessUpdateStats` (`:747-913`) converts accumulated subpoints into points through `ChangeStat` (`:378-745`).
- **Deferred while `ubAttackBusyCount > 0`, the merc is in sector and `INCOMBAT`** (`:761-766`), so in combat points
  land at §3.4 step 8. Skips mercs below OKLIFE.
- Per changed stat, `ChangeStat` draws `main(100) < 25` to choose between the quote and a plain message; skipped for
  HEALTH, and for EXPERAMT, which always gets the quote (`:583`); ja2-node never draws it (§6.2). Level-ups also change
  salary (`22` §3.7).

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
  an assist. A militia kill therefore totals +3 (quirk, = V).
- `usBattlesFought++` at battle end (`Overhead.cc:4560`).

## 6. Implementation in ja2-node

### 6.1 State and modules

Paths are under `src/sim/tactical/`. The soldier (`soldier.ts`) keeps the original's hit, suppression and morale
fields under their names without the type prefix (`ubSuppressionPoints` → `suppressionPoints`, `fCloseCall` →
`closeCall`); `sDamage` is `damageWindow`, `bUnderFire` is `ai.underFire`. `TacticalState` (`state.ts`) holds the attack
busy count `turn.attackBusyCount` (`turns/turn-state.ts`), the queued `gameEvents` (the delayed melee `weaponHit`) and
our dead mercs waiting for the skull delay, `pendingSkullReleases`. Armours come from `data/externalized/*.json`
through `content/items/items.ts` (`12` §1); hit and death scripts from the user's `binarydata/ja2bin.dat`
(`content/formats/ja2bin.ts`, `content/anim/timelines.ts`) with speeds and flags from `data/tables/anim-control.json`;
the stub pack builds its own scripts with the same gameplay opcodes and shorter frame counts (`stubs/anim-scripts.ts`,
`32` §1). The suppression values of `game.json` (§3.3) are compiled-in constants (`combat/barrier.ts`).

| Module | Implements |
|---|---|
| `combat/hit.ts` | `BulletHitMerc`, `WeaponHit`, `EVENT_SoldierGotHit`, the hit animation choice, falls and `SoldierCollapse`, `SoldierTakeDamage`, `ReleaseSoldiersAttacker`, `CheckForFreeupFromHit`, the damage window (§1.1, §1.4, §2.1–§2.6) |
| `combat/impact.ts`, `combat/armour.ts` | `BulletImpact`, `AdjustImpactByHitLocation`; armour, body impact reduction, `ArmourPercent` (§1.2, §1.3) |
| `combat/death.ts` | opcodes 433, 437, 440, 447, 465, 472, 478, 480, 496, 497, 765; `HandleSoldierDeath`, corpses, `BeginSoldierGetup`, the skull delay (§2.6–§2.11) |
| `combat/bleeding.ts` | `CheckBleeding`, the next-bleed time (§2.11) |
| `combat/barrier.ts` | the busy-count entry points, `HandleSuppressionFire`, `NoticeUnseenAttacker`, the end of an attack (§3.2–§3.5) |
| `combat/experience.ts`, `combat/skill-check.ts` | `StatChange`, `ProcessUpdateStats`, `ModifyExpGainByTarget`, `AgilityForEnemyMissingPlayer`; `SkillCheck` (§5) |
| `combat/morale.ts` | the tactical morale events of soldiers and `RefreshSoldierMorale` (§4); the strategic events, the `TEAMMATE_DIED` fan-out and the decay are `sim/campaign/morale.ts` |
| `combat/context.ts` | `CombatContext`, the narrow state `bulletImpact`, `hthImpact` and `statChange` need, so autoresolve reuses them (`AUTORESOLVE_IMPACT`, `19`) |
| `skills.ts`, `points.ts` | effective stats, `moraleModifier`, fatigue penalties; `DeductPoints`, `CalcNewActionPoints` |

The agent API events of a hit (`bulletImpact`, `soldierHit`, `soldierDied`, `attackResolved`) are `29`.

### 6.2 Timers and randomness

Each tick runs the skull releases (`updateSkullReleases`) before the soldier pass and `updateDamageDisplay` inside it
(`overhead.ts`); the whole tick order is `11` §6.2. Timers run on game ms: the damage window 8 × 250 ms (§1.2); our
dead merc's release 1920 ms after 440 (§2.9). There are no watchdogs: holds the original leaves to its 15 s or 25 s
breaker are released where they arise (deviations "Watchdogs", "Hit during a non-interruptible animation",
"Knock-back and the sighting pause", "Suppression stance change from the end of the previous one").

Gameplay draws keep the original order on `main` (`t.rng`) and `pre` (`t.pre`), `src/core/rng.ts`, `01` §3.6; the
order of a whole shot that kills is `11` §5. Outcomes (fluke, armour, criticals, sleep darts, suppression stance odds,
stat gains) draw `pre`. Kept on `main`: the instant-kill bonus, head-gear damage, the touchy neutral, the weapon drop,
the blood decay `main(3)`, `CIV_DIE2`, the burning and exploding start frame, the fall side, opcodes 433 and 478,
corpse ammo, the close-call quote. Not drawn (deviations "Cosmetic draws in attacks"): the curse `main(10)` on the
release from a hit, the laugh `main(3)`, the blood-pool graphic `main(4)`, the stat-change message `main(100) < 25`,
the silent skill-check curse `main(100) < 40`, impact sounds and grunts.

### 6.3 Not ported

- Fragile-item damage on falls: opcode 721, `CheckEquipmentForFragileItemDamage(20)` and its `pre` draws (§2.11).
- Our mercs firing back when attacked out of combat; the head-miner rule (gaps "Implications of an attack",
  §3.4).
- Drug terms in morale (gaps "Morale without drugs"); corpse rotting, crows and corpse warnings (gaps
  "Corpses"); the fade before the delay 0 of unseen soldiers (gaps "Unseen soldiers in combat", §2.4).

### 6.4 Verification

Impact, armour, hit and death animations, bleeding and the barrier are checked against this spec by the unit tests
next to the code (`combat/*.test.ts`) and exercised by the stub campaign bot (`tools/campaign-bot`), which found the
hold leaks "Hit during a non-interruptible animation" and "Suppression stance change from the end of the previous one".

## 7. Open points

Inferred from reading the source, not checked against the native build:
- §2.8.2: `FALLBACK_DEATHTWICH` (a hit in `FLYBACKHIT_STOP`) never releases the attacker; believed unreachable.
- §2.9: a shooter hit mid-burst keeps `bBulletsLeft`, so the attack's hold leaks; ja2-node does not special-case it.
- §2.3: the `(UINT8)` conversion of a negative float breath assumes x86 truncate-then-wrap (ja2-node does the same).
- §2.6: the ready APs charged again on returning to aim after a hit; special-move overshoot past the final tile.
- §3.3: whether the turn start that `EnterCombatMode` runs clears the suppression points of the attack that began it.
- §5: the agility gain for a bullet that passed through someone and then stopped in a wall.
- §3.4: which draws `HandleKilledQuote` and the item-locator quote make.
- Vehicles, boxing, Meanwhile (Elliot) and Queen branches are listed, not specified in detail.
