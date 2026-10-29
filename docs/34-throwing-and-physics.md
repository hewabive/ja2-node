# 34 — Throwing, launchers and item physics

Grenades, rocks, inventory tosses and launchers (GL, under-barrel GL, mortar) from the order until the object rests or
explodes: AP cost, range, chance to hit, miss deviation, launch parameters, the throw animation, physics objects, duds,
fuses, busy count and RNG order. Siblings: `11` guns, bullets and melee; `33` hits and damage; explosions from
`IgniteExplosion` on are `12`.

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless marked V (vanilla `Build/`); a bare
`:N` is in the file the enclosing heading or list item names. "(inferred)" marks conclusions not traced end to end. C
integer semantics: `/` truncates toward zero (`idiv`, `src/core/int.ts`), `INT8`/`UINT8` stores wrap (`i8`, `u8`).
`f32(x)` = `Math.fround(x)`; `trunc` = `Math.trunc`. `pre(n)` = `PreRandom(n)` (stream `pre`), `main(n)` = `Random(n)`;
`n = 0` draws nothing. World units: 10 per tile horizontally; height units: 256 per storey, 64 per cube (`08` §1.1).
Directions N 0 … NW 7. `USABLE 10` (minimum item status). Animation frame counts, speeds and opcode positions (§7) were
read from one release (Steam 1.12 `Ja2bin.dat`; speeds from `gAnimControl`).

## 0. Overview: which items take which path

Grenades and rocks are physics objects rolled at the order (§1); launchers roll at the fire frame (opcode 430) and
launch a physics object (§8); the LAW and the tank cannon are explosive bullets (`11` §1.9, `11` §3). Throws pay their
APs at the release frame 460/461, launchers at the fire frame. Every object in flight holds the attack busy count until
it dies (§11).

| Item class (weapons.json `internalType` / explosives.json `itemClass`) | Examples | Resolver | Projectile |
|---|---|---|---|
| `IC_GRENADE` with `TOSSCURS` | HAND/MINI/STUN/TEARGAS/MUSTARD/SMOKE_GRENADE, BREAK_LIGHT, CREATURE_COCKTAIL | `FireWeapon` default → `UseThrown` (`Tactical/Weapons.cc:409-412`) | physics object |
| `IC_THROWN` (`THROWN` → `NoWeapon(IC_THROWN, TOSSCURS)`, `externalized/WeaponModels.cc:174`) | ROCK, ROCK2 | `UseThrown` | physics object |
| `IC_LAUNCHER` (`LAUNCHER`, `WeaponModels.cc:1347`, `TRAJECTORYCURS`) | GLAUNCHER (range 500), UNDER_GLAUNCHER (450, attachment, `WM_ATTACHED`), MORTAR (550) | `UseLauncher` (`Weapons.cc:1336`) | physics object (the attached launchable: GL_*_GRENADE, MORTAR_SHELL) |
| `IC_GUN`, `NOT_GUN` (`LAW`, `CANNON`, `WeaponModels.cc:1389,1432`) | ROCKET_LAUNCHER (single-use LAW), TANK_CANNON | `UseGun` | **bullet** with `BULLET_FLAG_MISSILE` / `_TANK_CANNON` (`LOS.cc:3262-3269`); explodes C1 / TANK_SHELL on stop or hit (`Weapons.cc:1511-1519, 1622-1646`) |
| `IC_THROWING_KNIFE` | THROWING_KNIFE | `UseGun` | bullet with `BULLET_FLAG_KNIFE` (`11` §1.9, `11` §3); only its CTH is `CalcThrownChanceToHit` (`Weapons.cc:654-657`) |
| any item tossed from the inventory cursor | medkit, ammo, unarmed grenade | `Interface_Items.cc:3505-3553` (`12`; ja2-node `toss.ts`, gaps "Tossing from the item cursor") | physics object, `NO_THROW_ACTION` or `THROW_TARGET_MERC_CATCH`, no CTH, `bMissBy = 0` |

`EXPLOSIVE_GUN(x)` = ROCKET_LAUNCHER or TANK_CANNON (`Item_Types.h:215`). Vanilla data has no RPG; ROCKET_RIFLE and
AUTO_ROCKET_RIFLE are ordinary guns with `BULLET_FLAG_SMALL_MISSILE` (`11` §3.1).

## 1. Grenade/rock throw: order flow

1. **`HandleItem`** (`Tactical/Handle_Items.cc:188`): sets `usAttackingWeapon`, `bTargetLevel`; in real time
   `ubAttackBusyCount = 0` (`:218`). Branch `IC_GRENADE | IC_LAUNCHER | IC_THROWN` (`:856`):
   - `sAPCost = MinAPsToAttack(s, target, TRUE)` → `MinAPsToThrow` (`Points.cc:964-989`); `EnoughPoints` or
     `ITEM_HANDLE_NOAPS` (`:893`). **Nothing is deducted here.**
   - `ubAttackingHand = HANDPOS`. `TOSSCURS` items (`:900-912`): `sTargetGridNo = target`,
     `target = WhoIsThere2(target, level)`, **`ubAttackBusyCount++`**, `fDontChargeTurningAPs = TRUE`, then
     **`FireWeapon(s, target)` at once** (command time); `SetUIBusy`.
2. **`FireWeapon`** (`Weapons.cc:349`): target == own tile → `FreeUpAttacker`, fail. `opponent = NULL`; class default →
   `UseThrown`.
3. **`UseThrown`** (`Weapons.cc:1268-1333`), all at command time:
   1. `chance = CalcThrownChanceToHit(s, target, bAimTime, AIM_SHOT_TORSO)` (§4).
   2. `roll = pre(100)`.
   3. Experience (only `bTeam == OUR_TEAM` and `INCOMBAT`): the victim is a non-teammate on
      `sTargetGridNo/bTargetLevel`, else the first of the 8 neighbours (`NUM_WORLD_DIRECTIONS` order 0..7) holding a
      non-teammate. Quirk (V and Strac): if no neighbour qualifies, the loop variable keeps the occupant of direction 7,
      so a teammate (or anyone) standing there still counts. Victim found: `StatChange(STRAMT, 5, SUCCESS)`; then
      `roll < chance` ? `DEX 5 SUCCESS, MARK 5 SUCCESS` : `DEX 2 FAILURE, MARK 2 FAILURE`. Each `StatChange` draws
      `pre(100)` once per chance (`Campaign.cc:261`; may stop early on `FROM_FAILURE`, `:216-221`; none for
      non-profile/NO_EVOLUTION).
   4. `CalculateLaunchItemParamsForThrow(s, target, bTargetLevel, bTargetLevel*256, &inv[HANDPOS],
      i8(roll − chance), THROW_ARM_ITEM, null)` (§5, §6): a copy of the hand object goes to `pTempObject`, the launch
      vector to `pThrowParams`.
   5. `HandleSoldierThrowItem(s, sTargetGridNo)` (§7); sets `target = NULL`.
   6. `RemoveObjs(&inv[HANDPOS], 1)`. Strac refills an emptied hand from another slot holding the same item
      (`:1322-1332`); V does not.
4. Turning (free), then the throw animation; the release frame (460/461) pays the APs and creates the object (§7).
   Flight and landing §9; explosion hand-off §9.6.

**Hit semantics.** `bMissBy = i8(roll − chance)`; `bMissBy ≤ 0` is an exact throw, so the effective accuracy is
`(chance+1)%`, as for guns. The experience branch uses `roll < chance` (strict): a roll equal to the chance lands on
target but grants failure XP (quirk, keep).

## 2. AP cost (`MinAPsToThrow`, `Points.cc:1692-1742`)

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

Evaluation points:
- **Command time** (`HandleItem:893`, UI cursor `UI_Cursors.cc:812-814`): the merc is still in his own stance, so the
  stand-up cost and `AP_CHANGE_TARGET` count toward `EnoughPoints`.
- **Release frame** (`Soldier_Ani.cc:860`): `DeductPoints(MinAPsToThrow(s, sTargetGridNo))`. The merc is now in
  `THROW_ITEM`/`LOB_ITEM` (`ubEndHeight = STAND`), so the stance term is **0**; entering that animation reset
  `sLastTarget = NOWHERE` (`Soldier_Control.cc:1360-1370`: neither state is `ANIM_FIREREADY`), so `AP_CHANGE_TARGET`
  is **always** charged (inferred from the two reads). Paid = `1 + aim formula`, capped.
- Non-armed tosses (`ubActionCode != THROW_ARM_ITEM`) pay `AP_TOSS_ITEM = 8` at release (`Soldier_Ani.cc:865`,
  `Points.h:50`).
- Aim time is never charged for throws but still adds `+10·bAimTime` CTH. The player's toss cursor has no aim
  refinement, so `bAimTime = bShownAimTime/2` is normally 0 (`Handle_UI.cc:2140`, `UI_Cursors.cc:1003-1027`,
  inferred). The AI sets `bAimTime = ubMaxPossibleAimTime` (≤ `AP_MAX_AIM_ATTACK` 4) for throws
  (`TacticalAI/Attacks.cc:831, 888`; `DecideAction.cc:3176`) and so gets up to +40 CTH for free (inferred).
- Turning before a throw is free (`fDontChargeTurningAPs`, `Handle_Items.cc:909`).

## 3. `CalcMaxTossRange(s, item, fArmed)` in tiles (`Weapons.cc:3525-3581`)

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

## 4. `CalcThrownChanceToHit(s, grid, aimTime, aimPos)` (`Weapons.cc:3585-3735`)

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

- `bPenalty` is `INT8`; with very high chances (~200+, e.g. trait + aim + short range) and heavy wounds it can wrap
  negative and *raise* the chance. Keep `i8`.
- With a UGL the final multiplier uses the **rifle's** `bStatus[0]` (`inv[HANDPOS]`), not the attachment's (quirk).
- V differences: §14.

## 5. Miss deviation (`CalculateLaunchItemParamsForThrow`, `TileEngine/Physics.cc:1717-1835`)

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
  const { force, degrees } = launchItemBasicParams(s, item, grid, level, endZ, armed);   // §6
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
    let x = preRandom(maxR), y = preRandom(maxR);
    if ((x < minR || y < minR) && maxR !== minR) continue;  // re-roll both; not counted
    if (preRandom(2) === 0) x = -x;
    if (preRandom(2) === 0) y = -y;
    const leftmost = Math.trunc((sweet + 160 * y) / 160) * 160;
    const g = sweet + 160 * y + x;
    if (g === sweet) continue;                              // not counted
    if (++cnt > 50) return NOWHERE;
    if (g >= 0 && g < WORLD_MAX && g >= leftmost && g < leftmost + 160) return g;
  }
}
```

Landing offsets (target tile ± (dx, dy) in tiles); the "radius" is a square, and the min-radius rule forces exact
diagonals:

| `missBy` (after clamp) | `maxMiss`→(min,max) | Offsets |
|---|---|---|
| 1–17, or any when `pyth ≤ 3` | (2,2) | dx, dy ∈ {−1,0,1}, not (0,0) |
| 18–23 | (2,3) | dx, dy ∈ {±2} (diagonal corners only) |
| 24–30 | (3,4) | dx, dy ∈ {±3} |

With `maxR == minR` any `x,y < maxR` passes; with `maxR = minR+1` both must equal `minR`. V (`Physics.c:2256`) is the
same loop as `do … while(!fFound)`; `NOWHERE` after 50 counted tries is unhandled downstream (map edge only).

Physics (§9) decides the actual landing tile: bounces, walls and the max-force cap can move it.

## 6. Launch angle and force (`CalculateLaunchItemBasicParams`, `Physics.cc:1489-1610`)

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

- `findBestAngle` (`:1313-1408`) starts at π/8, tolerance 5%, ≤9 checks, `deg -= deg·(diff/range)/2`; returns 0 if
  `|deg| ≥ π/2` or `≤ 0.005`.
- `trajectoryRange` = `CalculateObjectTrajectory` (`:1410-1449`): a `TEST_OBJECT_NO_COLLISIONS` object with
  `TestZTarget = endZ`, simulated to death with the real integrator (§9.2); it ignores structures. While descending
  below `TestZTarget`: target 256 → treated as a roof hit; target > 32 (the window case, 150) → freeze the measured
  point and continue to the ground; otherwise ground. The measured point follows the object through bounces and
  rolling until it rests, so the force search aims the **resting** point at the target tile. Returns `hypotf(dx, dy)`
  of that point from the start.
- Consequences: a GL or mortar cannot shoot shorter than the min force (15 tiles at 45°; at the GL's π/8 roughly
  10–11 tiles on flat ground, inferred). Throws beyond `CalcMaxTossRange` are capped by `maxF` and fall short. Indoors
  (any roof over the thrower or a ground-level target, caves, basements) the arc is flat (π/30) and `maxF` doubles.
- V differences: §14. ja2-node does not model the cave and basement arc (`gfCaves || gfBasement`; gaps
  "Underground throws").

`CalculateLaunchItemChanceToGetThrough` (`:1613-1678`; UI cursor and AI `CalcBestThrow`) runs the same params through
a `TEST_OBJECT_NOTWALLROOF_COLLISIONS` object (structure collisions on, first 3 tiles ignored as in §9.3); false if it
collided with a wall/window/structure, ended on another level, or (AI) ended off the target tile. No RNG. Same tile as
the thrower → false (Strac guard against an endless loop).

## 7. Throw animation and release

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
2. `CreatePhysicalObject(pTempObject, params…, owner = s, action, target)` (§9.1).
3. Free `pTempObject` and `pThrowParams`.

**Aborts before release** (no AP spent, roll already consumed):
- An AI soldier who sights an enemy while `pTempObject` is set: `HaultSoldierFromSighting(…, TRUE)`
  (`Soldier_Control.cc:7271-7306`, callers `OppList.cc:695, 2418, 2438`), or `HandleSystemNewAISituation` for a
  soldier under AI control with `IS_NEW_SITUATION` (`:8774-8813`): `AutoPlaceObject(pTempObject)`, clear it, cancel
  the pending animation, `ReduceAttackBusyCount`. `pThrowParams` stays allocated (harmless). **Quirk:** `pTempObject`
  is a copy of the whole hand stack taken *before* `RemoveObjs(…, 1)`, so returning it can duplicate stacked grenades
  (inferred; ja2-node keeps it, §15).
- Hit while in `THROW_ITEM`/`LOB_ITEM`/`SHOOT_ROCKET`/`SHOOT_MORTAR`: `EVENT_SoldierGotHit` calls
  `ReduceAttackBusyCount` (`Soldier_Control.cc:2636-2645`). If the hit animation replaces the throw before 460, the
  object in `pTempObject` is never launched and is lost at the next `SetTempObject` (inferred).

## 8. Launchers

**GL / UGL / mortar order flow.**
1. `HandleItem` launcher branch (`Handle_Items.cc:856-921`): `sAPCost = MinAPsToAttack(…, TRUE)` (gun formula,
   `MinAPsToShootOrStab`; for `WM_ATTACHED` the item is `UNDER_GLAUNCHER`, `Points.cc:966-972`). Mortar: needs
   `OKFallDirection` on the tile in front, else `ITEM_HANDLE_NOROOM`; sets `fDontChargeAPsForStanceChange`. GL:
   `GetAPChargeForShootOrStabWRTGunRaises` decides `fDontChargeTurningAPs` (standing) or `fDontChargeReadyAPs`.
   `EnoughPoints`; cursor `TRAJECTORYCURS` → `SendBeginFireWeaponEvent`. The UI passes `UNDER_GLAUNCHER` as the hand
   item in `WM_ATTACHED` (`Handle_UI.cc:2223`), so `usAttackingWeapon = UNDER_GLAUNCHER`.
2. `EVENT_FireSoldierWeapon` (`Soldier_Control.cc:2111-2214`): `ubAttackBusyCount++`, `target = WhoIsThere2`.
   `bBulletsLeft` is set only if the *hand* item is a gun (LAW: 1; rifle with UGL: 1, ×8 if buckshot is loaded,
   unused). `isLauncher() || ROCKET_LAUNCHER` → **fire at once**: direction snapped (`EVENT_SetSoldierDirection`),
   `SelectFireAnimation` → `SHOOT_ROCKET` (LAW), `SHOOT_MORTAR`, else the stance's normal fire animation (GL). A UGL
   goes through the rifle's ready/turn path (`fTurningToShoot`).
3. **470** `OKFireWeapon` → `CheckForGunJam`: only `IC_GUN && !EXPLOSIVE_GUN`, so launchers and LAWs never jam
   (`Weapons.cc:244-249`).
4. **430** → `FireWeapon` → `UseLauncher` (`Weapons.cc:1336-1433`), at the fire frame:
   1. `EnoughAmmo(s, TRUE, ubAttackingHand)` else return (no busy decrement, inferred leak).
   2. First attachment of the hand object that `isExplosive()` → `Launchable` (with its status). None → return.
   3. Remove it: `usAttackingWeapon == hand item` → `DeductAmmo(HANDPOS)` (removes the first `IC_GRENADE`, else
      `IC_BOMB` attachment, `Points.cc:1385-1398`); else (UGL) `RemoveAttachment(that slot)`.
   4. `WillExplosiveWeaponFail(s, inv[HANDPOS])` (`:3870-3886`), only if `bTeam == OUR_TEAM || bVisible == 1`:
      `i8(pre(40) + pre(40)) > bStatus[0]` → `pre(2) == 1` → fail. On fail: `IgniteExplosion(s, 0, s.sGridNo,
      Launchable.usItem, s.bLevel)`, `ReduceAttackBusyCount`, return (**no AP deducted**, round lost).
   5. Sound (no `MakeNoise` for the launch itself).
   6. `chance = CalcThrownChanceToHit(s, target, bAimTime, TORSO)` (mechanical branch); `roll = pre(100)`.
   7. AP: `IC_LAUNCHER` → `MinAPsToAttack(s, target, TRUE)` (else `MinAPsToThrow`, unreachable in practice);
      `DeductPoints`. Aim is not charged.
   8. `CalculateLaunchItemParamsForThrow(s, sTargetGridNo, bTargetLevel, bTargetLevel*256, &Launchable,
      i8(roll − chance), THROW_ARM_ITEM, null)` (§5, §6) and **`CreatePhysicalObject` at once**; free temp object and
      params. `s.target` = occupant of the intended tile.
   9. No experience for launcher shots.
   10. Mortar CTH is 0 under 15 tiles (§4): any roll ≥ 1 misses by `roll`; roll 0 is an exact hit.
5. Busy accounting: the GL's +1 from the fire event is released when the physics object dies; `SHOOT_MORTAR` and
   `SHOOT_ROCKET` also carry their own 757/753 pair.

**LAW (ROCKET_LAUNCHER) and tank cannon** go through `UseGun` and the bullet code (`11` §1.9, `11` §3); their specifics:
- CTH: `CalcChanceToHitGun` with the base marksmanship replaced by the mechanical formula
  `idiv(effDex + effMrk + effWis + 10·effExp, 4) + 15·HEAVY_WEAPS traits` (`Weapons.cc:2003-2009`); all other gun
  modifiers apply (`11` §2). Tank range penalties `:2391-2414, 2485-2488`.
- In `UseGun` (`:787-801`), after the marksmanship XP and before `FireBulletGivenTarget`: `WillExplosiveWeaponFail`
  (same draws as above). On fail: the hand becomes `DISCARDED_LAW`, `IgniteExplosion(C1)` on the shooter's tile,
  `ReduceAttackBusyCount`, **and the rocket is still fired** (no return; quirk).
- After firing (`:826-842`): hand → `DISCARDED_LAW`; back-blast: a non-prone soldier on the tile directly behind
  (`OppositeDirection(bDirection)`) gets `ubAttackBusyCount++` and `EVENT_SoldierGotHit(MINI_GRENADE, damage 10,
  breath 200, dir = shooter's direction, range 0, special 0, ANIM_CROUCH)`.
- The missile stops at the first structure or person: `IgniteExplosion(C1)` at the adjusted tile (`:1622-1636`) or
  `IgniteExplosionXY(C1 / TANK_SHELL)` at the hit point on a soldier (`WeaponHit`, `:1511-1519`), each with
  `FreeUpAttacker`. A missile leaving the map disappears (`ShotMiss`, `:3170`). The velocity drop after `2·iRange`
  applies as for bullets (`LOS.cc:4217-4222`).

## 9. Physics (`TileEngine/Physics.cc`)

### 9.1 Object state and creation (`:185-222`)

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

### 9.2 Tick and integration

- `SimulateWorld` (`:238-256`) runs once per main-loop frame, before bullets and `ExecuteOverhead`
  (`GameScreen.cc:343`), gated by the 20 ms `PHYSICSUPDATE` timer (`Utils/Timer_Control.cc:24`); all allocated objects
  in slot order.
- `SimulateObject` (`:286-336`):

```ts
const DT = f32(1.8), SUB = f32(DT / 10);                    // 0.18f
function simulateObject(o) {
  if (!physicsUpdateLife(o, DT)) return;                     // §9.5; may delete the object
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
    const r = handleCollisions(o);                           // §9.3
    if (r === END) return;                                   // >30 consecutive collisions
    if (r.code !== COLLISION_NONE) break;                    // rest of the tick is skipped
  }
  physicsMoveObject(o);                                      // §9.4
}
```

The 11 sub-steps follow from `0.18f·10 < 1.8f` in float32 (checked with `Math.fround`); the force search uses the same
integrator, so it must match. Life span `dLifeSpan += 1.8` per tick; `dLifeLength = −1` (no limit) for all throws and
launches.

### 9.3 Collisions (`:636-1062`, `CheckForCollision :2221-2504`, `PhysicsHandleCollisions :521-610`)

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
consecutive identical collision codes → `alive = false`, end the tick. Only a counted collision without a bounce
(water) resets the counters, never free flight (quirk). The `OldPosition` x/y swap at `:561-562` is a dead write.

**Soldier hit** (`CheckForObjectHittingMerc`, `:1858-1872`): structure id `< MAX_NUM_SOLDIERS` (148) and not the last
soldier damaged by this object → `EVENT_SoldierGotHit(s, NOTHING, 1, 0, s.bDirection, 0, owner,
FIRE_WEAPON_TOSSED_OBJECT_SPECIAL, 0, NOWHERE)` → `TAKE_DAMAGE_OBJECT` (no attacker release,
`Soldier_Control.cc:2687-2689, 2772`). Once per soldier per object.

**Catching** (only `THROW_TARGET_MERC_CATCH`, inventory tosses to a merc): in `PhysicsMoveObject`, when the object
enters a new tile within `PythSpacesAway < 4` of the target, he starts `CATCH_STANDING`/`CATCH_CROUCHED` once; at
`≤ 1` tile, once: `chance = u8(50 + idiv(effDex, 2))`, fail if `pre(100) > chance` (`:1927-1946`). On collision with
the target's structure, a good catch `AutoPlaceObject`s the item (`fDropItem = false`), plays `END_CATCH`, and the
object dies.

### 9.4 `PhysicsMoveObject` (`:1076-1224`)

New grid from position; the first call records `sFirstGridNo`. `NOWHERE` → delete **without** busy-count release
(inferred leak; normally the visible-tile check of §9.5 fires first). On a tile change: catch check (§9.3);
`MORTAR_SHELL` armed and `uiNumTilesMoved > 2` → smoke-trail tile animation with `sDelay = 100 + pre(100)`
(**cosmetic draw on `pre`**, `:1117`, while the object is visible); `uiNumTilesMoved++`.

### 9.5 End of life (`PhysicsUpdateLife`, `:361-470`), run at the start of the next tick

`alive = false` if the life length is exceeded or `!GridNoOnVisibleWorldTile(sGridNo)`. Then, for non-test objects, in
order:
1. Stop the sound.
2. `THROW_ARM_ITEM && !fInWater` → `HandleArmedObjectImpact` (§9.6). Else, unless (in water and the item sinks):
   if `fDropItem` and not armed → `AddItemToPool(grid, obj, VISIBLE, level = lastCollision == ROOF ? 1 : 0)`.
3. Noise: ROCK/ROCK2 → `MakeNoise(owner, grid, level 0, 9 + pre(9), NOISE_ROCK_IMPACT)`; grenades →
   `… NOISE_GRENADE_IMPACT` (volume 9–17; level always 0; deferred while busy, `08` §3.3).
4. Impact sound if the last collision was ground/roof.
5. **`ReduceAttackBusyCount(owner, FALSE)`**.
6. End a running catch animation.
7. Delete the object.

### 9.6 `HandleArmedObjectImpact` (`:2004-2117`): duds, re-arming, explosion hand-off

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
- `IgniteExplosion*` raises the busy count (`Explosion_Control.cc:113`) before step 5 of §9.5 releases the throw's
  count; explosion effects and damage: `12`, flares `12`.

## 10. Fuses and timing

- Thrown and launched grenades have no time fuse. Hand and GL grenades (and rocks) **detonate when the object comes to
  rest** (or dies at 30 collisions or off the visible map), after bouncing and rolling. Mortar shells detonate at
  the **first counted collision**. GL grenades bounce like hand grenades (only `MORTAR_SHELL` is
  `OBJECT_DETONATE_ON_IMPACT`, `:65`).
- In water, armed objects explode 11 ripple frames × 50 ms = 550 ms (tile-animation clock) after splashdown, with no
  dud check. The throw's busy count is released one tick after the splash, before that explosion (inferred). The
  keyframe reads the freed `REAL_OBJECT` slot (`pNode->v.object`), which a new object could reuse (inferred); ja2-node
  keeps the ripple's own owner and item (deviations "Water ripple").
- Dud → timed bomb: `bDelay` decremented by `DecayBombTimers` (`Explosion_Control.cc:2054-2095`) in `EndTurnEvents`
  (`TeamTurns.cc:288`, once per round, inferred) and on every 5 s real-time turn (`Tactical_Turns.cc:92`); at 0 it
  joins the bomb queue (`12`). ja2-node lays the dud down invisible and armed after the same draws, with no timer
  (gaps "Duds and timed bombs").
- Flight time is a fixed number of 20 ms physics ticks for given launch parameters; turn-based and real time use the
  same integrator. The turn waits on the busy count until the object dies.

## 11. Busy-count accounting

| Event | +/− | Source |
|---|---|---|
| Toss command (`TOSSCURS`) | +1 | `Handle_Items.cc:906` |
| Launcher/LAW fire event | +1 | `Soldier_Control.cc:2125` |
| `SHOOT_ROCKET` / `SHOOT_MORTAR` f0 / end | +1 / −1 | opcodes 757 / 753 |
| Knife throw begin; `THROW_KNIFE` f0 / f15 | +1; +1 / −1 | `Soldier_Control.cc:6845`; 757 / 753 |
| Physics object dies | −1 | `Physics.cc:436` |
| Launcher misfire (`WillExplosiveWeaponFail`) | +1 explosion, −1 | `Weapons.cc:1383-1394` |
| Abort before release; hit during throw/launch animation | −1 | §7 |
| LAW back-blast victim hit | +1 (+ hit animation) | `Weapons.cc:842` |

## 12. RNG calls in order

**Grenade/rock throw (player, combat):**
1. `pre(100)` hit roll (command time).
2. `StatChange` draws (STR 5, then DEX and MARK 5/5 or 2/2), `pre(100)` per chance, only for our team with a victim.
3. If `missBy > 0`: `RandomGridFromRadius` loop: `pre(max)`, `pre(max)` [reject → repeat], `pre(2)`, `pre(2)`
   [same tile → repeat].
4. Force/angle search: none.
5. Flight: catching `pre(100)` (catch tosses only); soldier hit → `EVENT_SoldierGotHit` (draws as in `11` §5);
   mortar smoke trail `pre(100)` per new tile after the 2nd.
6. Landing: dud test `pre(100)`, `pre(50)` (only on the ground plane, out of water, status ≥ 10); if a dud: again
   `pre(100)`, `pre(50)`, then `pre(4)`, `pre(2)` if re-armed.
7. Noise volume `pre(9)` (grenades and rocks).
8. Explosion (`12`).

**Launcher:** `WillExplosiveWeaponFail` (`pre(40)`, `pre(40)`, maybe `pre(2)`; only for our team or visible
shooters) → `pre(100)` hit roll → `RandomGridFromRadius` → flight/landing as above.

**LAW:** gun order (`CalcChanceToHitGun`, `pre(100)`, marksmanship `StatChange`), then `WillExplosiveWeaponFail`, then
`FireBulletGivenTarget` deviation, then wear `pre(15 + 3·reliability)` (`Weapons.cc:870-875`), then `Random(2)` smell
decay if `bMonsterSmell > 0` (`11` §1.9).

Cosmetic `main` draws here are not drawn by ja2-node (§15).

## 13. Determinism and exactness

- Exact in integers and draws: `CalcThrownChanceToHit`, `CalcMaxTossRange`, `MinAPsToThrow` and its evaluation points,
  the hit roll, the miss radius and every `pre` draw above in order (including the mortar smoke-trail draw), the dud
  logic, the busy-count bookkeeping.
- Physics is deterministic per 20 ms tick; the original depends on the frame rate only through the wall-clock gate (at
  most one tick per frame), so in real time only through where soldiers are when the object passes. ja2-node runs it
  every 20 game ms at the start of the 5 ms tick, before bullets and the soldier pass (`stepThrownObjects`), objects in
  slot order, in float32 (`Math.fround` after every float operation, 11 sub-steps). The initial force estimate uses
  double `sqrt`/`sin`; `sinf`/`sqrtf` may differ in the last ulp and can rarely change a landing tile (deviations
  "Physics cadence and floats"; `01` §3.2).

## 14. Vanilla differences found (summary)

| Topic | V | Strac |
|---|---|---|
| Mechanical CTH base | `… + bExpLevel` | `… + 10·EffectiveExpLevel` |
| Thrown CTH injury term | bandaged HP make it worse | `effectiveLife()` (bandaged HP count half) |
| Sun goggles in thrown CTH | always −10% range | only where light is brighter than normal day |
| Launcher end Z | 0 | `bTargetLevel · 256` |
| Mortar force-search start Z | `level·256` | `level·256 + 50` |
| Hand refill after a throw | no | next identical item moves to the hand |

Sources: thrown CTH `V Tactical/Weapons.c:3761-3900`; launcher end Z `V Weapons.c:1746`; mortar start Z
`V Physics.c:1577, 1906` (V adds the +50 only for the actual launch).

## 15. Implementation in ja2-node

Paths are under `src/sim/tactical/`.

| Module | Implements |
|---|---|
| `combat/attack.ts` | `HandleItem`'s throw and launcher branches, `EVENT_FireSoldierWeapon`, `FireWeapon` (shared with guns, `11` §6.1) |
| `combat/ap.ts` | `MinAPsToThrow` (§2) |
| `explosions/throwing.ts` | `UseThrown`, `UseLauncher`, `CalcThrownChanceToHit`, `CalcMaxTossRange`, `WillExplosiveWeaponFail`, `HandleSoldierThrowItem`, the release opcodes 460/461 (§1–§4, §7, §8) |
| `explosions/trajectory.ts` | `CalculateLaunchItemParamsForThrow`, `RandomGridFromRadius`, the force and angle search, `CalculateLaunchItemChanceToGetThrough` (§5, §6); the last also serves `toss.ts`, the AI's `ai/attack-choice.ts` and the attack hint `src/sim/hints/estimate-attack.ts` |
| `explosions/physics.ts`, `explosions/catching.ts` | physics objects (`stepThrownObjects`), collisions, end of life, `HandleArmedObjectImpact`; catches (§9) |
| `toss.ts` | inventory tosses (§0) |
| `perception/wiring.ts`, `ai/system-situation.ts` | aborted throws (§7): `haltFromSighting` and `handleSystemNewAISituation` both return the copied stack through `returnThrownObject` |

State: the physics objects, the throw parameters and the 20 ms physics timer are in `TacticalState.explosives`
(`explosions/state.ts`: `objects`, `throwParams`, `nextPhysicsMs`); `pTempObject` is the soldier's `tempObject`. Tick
placement and float handling: §13.

Randomness: gameplay draws keep the original order on `pre` (`t.pre`) and `main` (`t.rng`). The mortar smoke-trail delay
is a cosmetic draw on `pre` in the original and stays there (§9.4); the unsequenced dud operands are drawn left to right
(deviations "Dud test operand order"). Not drawn (deviations "Cosmetic draws in attacks", "Cosmetic draws in
explosions"): battle and impact sounds, the curse after a dud, the `Random(40)` curse on gun misses, the missile-trail
frame delay `main(100)`.

Not ported: timed re-armed duds (§10; gaps "Duds and timed bombs"); the cave and basement throw arc (§6;
gaps "Underground throws").

Verification: no oracle probe covers throws or physics; the unit tests next to the code (`explosions/throwing.test.ts`,
`physics.test.ts`, `grenade-attack.test.ts`) check them against this spec.

## 16. Open points

Inferred from reading the source, not checked against the native build:
- §2: at the release frame `AP_CHANGE_TARGET` is always charged and the stance term is 0.
- §6: the GL minimum range on flat ground (≈ 10–11 tiles, derived).
- §7: an aborted throw returns the whole copied stack; a hit during the throw animation loses the grenade.
- §9.1: object Z ignores the terrain height.
