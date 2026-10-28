# 08 — Sight and noise

Sight, hearing, light for vision and the player's fog of war, as the original does them and ja2-node implements them
(modules in §6).

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` (Stracciatella `ae6bf01`) unless marked V
(vanilla `reference/vanilla/ja2/Build/`). "(inferred)" marks conclusions not traced end to end; facts about the original
data (JSD flags, map heights) were read with ja2-node's parsers. C integer semantics apply everywhere: `/` truncates
toward zero (`idiv` in `src/core/int.ts`), `%` keeps the dividend's sign, `INT8`/`UINT8` stores wrap. `f32(x)` means
`Math.fround(x)`.
Teams: OUR 0, ENEMY 1, CREATURE 2, MILITIA 3, CIV 4. Directions: N 0 … NW 7, `DirIncrementer` = N −160, NE −159, E +1,
SE +161, S +160, SW +159, W −1, NW −161 (`TileEngine/Isometric_Utils.h:30`).

**Overview.** Sight is event-driven, not polled. A soldier "looks" when something about him changes: he reaches a tile
centre, turns while standing, ends a stance change, a door opens, and so on (§2.8). A look runs `ManLooksForMan` per
opponent pair: a range from `DistanceVisible` (facing, light, level, gear), then a 3D fixed-point ray `LineOfSightTest`
through the JSD profiles of every structure on the way. Results go into per-soldier and per-team opponent lists, set
`bVisible` (what the player may see), and in real time can start combat. Noise is a separate push model: `MakeNoise` →
every listener on other teams computes an effective volume. That needs no ray. A listener who hears a noise turns his
head (an LOS test to the noise tile) and may thereby see its maker. The player's fog of war is a third, cruder system
(`RevealRoofsAndItems`, §5): fixed view paths over movement costs reveal tiles, items and whole rooms (hiding their roofs).

---

## 1. Line of sight (`Tactical/LOS.cc`)

### 1.1 Units

| Quantity | Value | Source |
|---|---|---|
| World X/Y | 10 units per tile (`CELL_X_SIZE`); tile centre = `col*10+5`, `row*10+5` | `TileEngine/Isometric_Utils.cc:349` |
| Height | 256 height units per storey (`HEIGHT_UNITS`, = `WALL_HEIGHT_UNITS`); 64 per cube (`HEIGHT_UNITS_PER_INDEX`), 4 cubes per storey | `LOS.h:45-46,102` |
| Height → distance | `dz / 25` (`HEIGHT_UNITS / CELL_X_SIZE` is integer 25, not 25.6) | `LOS.h:51` |
| Map pixel height → height units | `sHeight*256/50` (integer) | `LOS.cc:182` |
| FIXEDPT | `INT32`, 20 fractional bits (1 = 1048576); `FloatToFixed(f) = (INT32)(f*1048576)`; `FIXEDPT_TO_INT32(q) = q/1048576` (truncating division) | `LOS.h:12-21`, `LOS.cc:184` |
| Ray step | 1 world unit of 3D distance (Z scaled by /25); `iDistance` steps from start to end | `LOS.cc:691-706` |
| LOS cell | `((q>>20 as int) % 10) >> 1` → 0..4 in X and Y; Z cube = `heightUnits/64` | `LOS.h:20-21,50-53` |
| Profile | `shape[x][y]`, bit z = cube z (`AtHeight = {1,2,4,8}`); ja2-node's `jsd.ts` keeps the 25 bytes as `shape[x*5+y]` (C row-major) | `TileEngine/Structure_Internals.h:37-50` |
| Wall / window | wall top 256; windows see-through only between 87 and 220 height units (absolute, ground storey only) | `LOS.h:102-104`, `LOS.cc:52-54` |
| Structure levels | `sCubeOffset` 0 (ground) or 4 (roof storey). Ground structures are tested at cube 0–3 above land, roof-storey ones at cube 4–7 | `Structure_Internals.h:43-46` |

How `sCubeOffset` is set and the per-tile list order: `07` §1.1 and `07` §1.2. Soldiers and corpses add their own
structures; their JSD flags are `0x80000090` (PERSON|TRANSPARENT|MOBILE) and `0x40000180` (CORPSE|GENERIC|TRANSPARENT) in
`Anims.slf`, so **LOS ignores people**. A corpse of ≥10 tiles loses `TRANSPARENT` (`Structure.cc:752-760`). In tileset
0, trees, bushes and weeds are `STRUCTURE_TREE` (0x200); `OLDFENCE` is TRANSPARENT; windows are WALLNWINDOW (0x20000,
plus OPEN 0x2 when open); flat roofs are NORMAL_ROOF.

### 1.2 Eye and target heights (`CalculateSoldierZPos`, `LOS.cc:1301-1486`)

The height class comes from `gAnimControl[usAnimState].ubEndHeight` (STAND 6, CROUCH 3, PRONE 1). Overrides: a crow, or a
soldier standing in deep water, counts as prone; low or medium water counts as crouched.

| Class | `LOS_POS` (eye, and the target for sight) | `HEIGHT` | head / torso / legs targets |
|---|---|---|---|
| Stand | 175 | 191 | 175 / 127 / 47 |
| Crouch | 111 | 130 | 111 / 71 / 31 |
| Prone | 31 | 63 | 31 / 31 / 31 |

The value is then adjusted in this order: kids `z*2/3`; robot, larvae, infant monster and bloodcat `z/3`; tank `z*4/3`
(all float); `+256` if `bLevel > 0`; `+sHeight*256/50` of the soldier's own tile (`LOS.h:73-100`, `LOS.cc:1456-1486`).
ja2-node: combat's `calculateSoldierZPos` (`combat/positions.ts`) has all of it; sight's `soldierEyeZ`
(`perception/los.ts`) uses only the height class of the animation, the level and the land height, so water overrides and
body scaling do not reach sight.

### 1.3 Callers

| Function | Start Z | End Z | Tree reduction (per foliage cell) | Notes |
|---|---|---|---|---|
| `SoldierToSoldierLineOfSightTest` (`:1519`) | viewer `LOS_POS` | target `LOS_POS` | `gubTreeSightReduction[target ubEndHeight]`: prone 8, crouch 7, stand 6; tank target 0 (`:101-110,1625-1632`) | Camouflage (below). Monster viewer: smell, end Z = 175 (+256 on a roof) + land. Bloodcat arena (sector N5) skips army↔creature. Tank blind spot: target ≤ prone within 8 tiles, or ≤ crouch within 4 |
| `SoldierTo3DLocationLineOfSightTest` (`:1661`) | viewer `LOS_POS` | `cube>0`: `((cube + level*4) − 0.5)*64 + land`; else a soldier on that tile → soldier-to-soldier test; else `175 + level*256 + land` | 6 (standing) | Used by hearing (§3.6) |
| `SoldierToLocationLineOfSightTest` (`:1769`) | = `SoldierTo3DLocation(…, level 0, cube 0)` | | | ground level only |
| `LocationToLocationLineOfSightTest` (`:1774`) | a soldier on the start tile → his 3D test; else `175 + level*256 + land` | same | 6 | AI |
| `SoldierToVirtualSoldierLineOfSightTest` (`:1734`), `SoldierToBodyPartLineOfSightTest` (`:1693`) | viewer `LOS_POS` | given stance / body-part position | 6 | AI and aiming |
| `SoldierToLocationWindowTest` (`:1637`) | (87+220)/2 = 153.5 (+256 on a roof) | same | 0, limit 255 tiles, aware | Returns the first window crossed |

**Camouflage** (`:1587-1624`). Only when the target has `bCamo` and the viewer is **not aware** (§2.2):
`eff = bCamo*(100 − 5*bTilesMoved)/100` (a bloodcat uses `100 − 5*bTilesMoved`), clamped ≥ 0. If the target is not
standing and his `bOverTerrainType` is FLAT_GROUND, LOW_GRASS or HIGH_GRASS, then
`limit -= limit*(eff/3)/100` (UINT8). `eff` is also passed on as the camouflage factor for foliage. `bTilesMoved` resets
at each turn start, which in real time means every 5 s (`Tactical/Soldier_Control.cc:4075`). ja2-node passes camouflage
0 and has neither the tank rules nor the N5 arena skip (`deviations` "Vision and hearing modifiers").

### 1.4 `LineOfSightTest` (`LOS.cc:575-1298`)

Returns 0 for "not seen", otherwise a positive cover-adjusted distance. Callers only test for non-zero. There is no
randomness. `ubTreeSightReduction` is UINT8. ja2-node's `lineOfSightTest` (`perception/los.ts`) follows this
pseudocode except the gas block at the end of the outer loop (`deviations` "Vision and hearing modifiers").

```ts
// Helpers. All q* values are INT32 FIXEDPT; use `| 0` / Math.imul where a product may exceed 2^31.
const FIX = 1 << 20, TEN = 10 * FIX, WALL = 256 * FIX, WIN_LO = 87 * FIX, WIN_HI = 220 * FIX;
const toFix = (f: number) => Math.trunc(f * FIX);          // f is already a float32 value; ×2^20 is exact
const fixInt = (q: number) => Math.trunc(q / FIX);
const tileOf = (q: number) => Math.trunc(fixInt(q) / 10);
const cellOf = (q: number) => (fixInt(q) % 10) >> 1;
const cubeOf = (hu: number) => Math.trunc(hu / 64);         // -1..-63 -> 0
const landFix = (g: number) => Math.trunc(sHeight[g] * 256 / 50) * FIX;

function lineOfSightTest(startG, startZ /*f32*/, endG, endZ /*f32*/, tileLimit, treeRed, aware, camo, smell, window?) {
  if (tactical.flags & DISALLOW_SIGHT) return 0;                 // :653 (explosions, roof climbing; see doc 01 §3.5)
  const sightLimit = tileLimit * 10; let adj = sightLimit;
  if (sightLimit === 0) return 0;
  if (!aware && !smell) treeRed = u8(Math.trunc(treeRed * 3 * (100 + camo) / 100));   // :663-669
  const sx = (startG % 160) * 10 + 5, sy = idiv(startG, 160) * 10 + 5;  // centres of BOTH tiles (:676-686)
  const ex = (endG % 160) * 10 + 5,   ey = idiv(endG, 160) * 10 + 5;
  const dx = ex - sx, dy = ey - sy, dz = f32(endZ - startZ);
  const dist = f32(Math.sqrt(dx * dx + dy * dy + f32(dz / 25) ** 2));  // see §1.7
  let iDist = Math.trunc(dist);
  if (iDist === 0) return 0;
  if (dist !== iDist) iDist++;
  if (iDist > sightLimit) return 0;
  const horizAngle = Math.atan2(dy, dx);                          // double; only used by resolveHitOnWall
  const qIncX = toFix(f32(dx / iDist)), qIncY = toFix(f32(dy / iDist)), qIncZ = toFix(f32(dz / iDist));

  // Start/end cube levels and "may cross a roof plane". QUIRK: GETWORLDINDEXFROMWORLDCOORDS(X, Y) is called with
  // swapped arguments, so the land height comes from the TRANSPOSED tile (row = col). :733, :769
  let checkRoof = false;
  const gS = Math.trunc(sx / 10) * 160 + Math.trunc(sy / 10), landS = landFix(gS), wallS = WALL + landS;
  const startCubes = cubeOf(fixInt(toFix(startZ) - landS));
  const startCubesAbove = startCubes >= 4 ? startCubes - 4 : startCubes;
  if (toFix(startZ) < wallS ? toFix(endZ) > wallS : toFix(endZ) < wallS) checkRoof = true;
  const gE = Math.trunc(ex / 10) * 160 + Math.trunc(ey / 10), landE = landFix(gE), wallE = WALL + landE;
  const endCubes = cubeOf(fixInt(toFix(endZ) - landE));
  const endCubesAbove = endCubes >= 4 ? endCubes - 4 : endCubes;
  if (toFix(endZ) < wallE ? toFix(startZ) > wallE : toFix(startZ) < wallE) checkRoof = true;

  // First position: one step plus half of the rounding remainder (:811-813).
  let qX = toFix(sx) + qIncX + idiv(toFix(dx) - qIncX * iDist, 2);
  let qY = toFix(sy) + qIncY + idiv(toFix(dy) - qIncY * iDist, 2);
  let qZ = toFix(startZ) + qIncZ + idiv(toFix(dz) - qIncZ * iDist, 2);
  let tX = tileOf(qX), tY = tileOf(qY), cX = cellOf(qX), cY = cellOf(qY), cubes = cubeOf(fixInt(qZ));
  let loop = 1, roof = null, smoke = 0;
  const crossed = (a, b, w) => (a > w && b <= w) || (a < w && b >= w);

  do {                                                            // one tile per outer pass
    const g = tX + tY * 160, land = landFix(g), wall = WALL + land;
    if (checkRoof) {                                              // :833-848; roof stays null when !checkRoof
      roof = findStructure(g, STRUCTURE_ROOF /*0x07000000*/);
      if (roof && crossed(qZ - qIncZ, qZ, wall)) return 0;
    }
    const oldTX = tX, oldTY = tY;
    do {
      const above = fixInt(qZ - land);
      if (above < 0) return 0;                                    // ground (:860)
      if (structures(g).length === 0) {                           // fast-forward to the next tile edge (:876-982)
        const sX = qIncX > 0 ? Math.trunc((TEN - qX % TEN) / qIncX) : qIncX < 0 ? Math.trunc((qX % TEN) / -qIncX) : 1e6;
        const sY = qIncY > 0 ? Math.trunc((TEN - qY % TEN) / qIncY) : qIncY < 0 ? Math.trunc((qY % TEN) / -qIncY) : 1e6;
        const n = Math.min(sX, sY) + 1;
        qX = (qX + Math.imul(qIncX, n)) | 0; qY = (qY + Math.imul(qIncY, n)) | 0; qZ = (qZ + Math.imul(qIncZ, n)) | 0;
        loop += n;
        if (qZ < land && loop < iDist) return 0;                  // `land` of the tile just left (quirk)
        tX = tileOf(qX); tY = tileOf(qY); cubes = cubeOf(fixInt(qZ)); cX = cellOf(qX); cY = cellOf(qY);
      } else {
        let cubeAbove = cubeOf(above);
        if (cubeAbove < 8) {
          const desired = cubeAbove < 4 ? 0 : 4; if (desired === 4) cubeAbove -= 4;
          for (const s of structures(g)) {                        // list order (:1003-1206)
            let opaque = !(s.flags & STRUCTURE_TRANSPARENT);
            if (s.flags & STRUCTURE_ROOF) opaque &&= !roofLipSeeThrough(loop, iDist, startCubes, endCubes, startCubesAbove, endCubesAbove);
            if (!opaque || s.cubeOffset !== desired) continue;
            if (!(s.shape[cX * 5 + cY] & (1 << cubeAbove))) continue;
            if (smell) { /* §1.5, monsters only */ continue; }
            if (s.flags & STRUCTURE_TREE) {                       // foliage: cuts range, never blocks outright
              if (loop > 25) {                                    // CLOSE_TO_FIRER, 2.5 tiles
                adj -= loop > 100 ? Math.trunc(treeRed * loop / 100) : treeRed;
                if (iDist > adj) return 0;
              }
            } else if ((s.flags & STRUCTURE_WALLNWINDOW) && !(s.flags & STRUCTURE_SPECIAL)
                       && qZ >= WIN_LO + land && qZ <= WIN_HI + land) {
              if (window && window.g === NOWHERE) { window.g = g; return loop; }   // window test only
            } else {
              let hit: boolean;
              if (s.flags & STRUCTURE_WALLSTUFF /*0x00CF0008*/) hit = resolveHitOnWall(s, g, cX, cY, horizAngle);
              else if (cubeAbove < 2) {                           // STANDING_CUBES-1: low obstacle near an end
                if (loop <= 25 && cubeAbove <= startCubesAbove) hit = cubeAbove !== structureHeight(s) - 1;
                else if (loop >= iDist - 25 && cubeAbove <= endCubes && aware) hit = cubeAbove !== structureHeight(s) - 1;
                else hit = true;
              } else hit = true;
              if (hit) return 0;
            }
          }
        }
        const oX = cX, oY = cY, oCubes = cubes;                   // step until the LOS cell or cube changes (:1209-1243)
        do {
          qX += qIncX; qY += qIncY;
          const last = qZ; qZ += qIncZ;
          if (roof && crossed(last, qZ, wall)) return 0;
          loop++;
          cX = cellOf(qX); cY = cellOf(qY); cubes = cubeOf(fixInt(qZ));
        } while (cX === oX && cY === oY && cubes === oCubes);    // no iDist check in here (original comment)
        tX = tileOf(qX); tY = tileOf(qY);
      }
    } while (tX === oldTX && tY === oldTY && loop < iDist);

    const lvl = cubeOf(fixInt(qZ)) > 3 ? 1 : 0;                  // gas in the tile just left (:1247-1283)
    const fx = smokeOn(g, lvl);                                   // data/externalized/smoke-effects.json
    if (fx) {
      if (fx.maxVisibility && !smell && ++smoke >= fx.maxVisibility) adj = 0;   // SMOKE: 3 tiles
      if (fx.lostVisibilityPerTile) adj -= fx.lostVisibilityPerTile * 10;       // tear/mustard: −2 tiles each
      if (adj <= 0) return 0;
    }
  } while (loop < iDist);
  return Math.trunc((iDist + (sightLimit - adj)) * 260 / sightLimit);          // 260 = MaxDistanceVisible()*10 (:1297)
}

// Roof lip (:1010-1044): roof structures act transparent near the person on the roof.
function roofLipSeeThrough(loop, iDist, startCubes, endCubes, startCubesAbove, endCubesAbove) {
  if (!(loop < 20 || iDist - loop < 20)) return false;
  if (loop <= 11 || iDist - loop <= 11)
    return startCubes < endCubes ? iDist >= (3 - endCubesAbove) * 10 : iDist >= (3 - startCubesAbove) * 10;
  return iDist >= 120;
}
```

What the rules mean in play:
- **Foliage** reduces the remaining range. Each LOS cell (2×2 units × 64 height units) of a tree or bush crossed beyond
  2.5 tiles costs `treeRed` tenths of a tile: 6/7/8 against a standing/crouched/prone target. Beyond 10 tiles the cost is
  scaled by `loop/100`. An unaware viewer pays ×3, and camouflage multiplies that by up to ×2. The ray fails once the
  remaining range is shorter than the full distance. `ubTreeSpotsHit` is debug-only. **There is no chance roll in sight**:
  random cover only exists for bullets (`CalcChanceToGetThrough`).
- **Low obstacles** (cube 0–1, not walls) near either end are transparent at their top cube only. At the far end this
  needs an aware viewer. Example: a crouched target (eye cube 1) right behind a 2-cube crate is visible to an aware
  viewer but hidden from an unaware one. A crouched viewer can always see over a 2-cube crate next to him.
- **Walls, doors and window frames** block, except at the corner cells (`ResolveHitOnWall`, §1.6).
- **Roof plane.** When start and end lie on opposite sides of the 256 plane, any step that crosses the plane inside a tile
  carrying a roof structure stops the ray. Roof structures themselves are transparent near the roof edge (roof lip).
- **Ground**: Z below land stops the ray.
- **Smoke**: the 3rd smoke tile crossed zeroes the range. Tear and mustard gas each take 2 tiles off.

### 1.5 Smell (monster viewers only)

Smell ignores foliage and open windows, and each other obstacle takes 80 units off the range (fails if `loop > 100` or
`iDist > adj`). Walls still go through `ResolveHitOnWall` (`LOS.cc:1052-1101`). Range: `DistanceSmellable`
(`OppList.cc:847`). ja2-node: the `smell` option of `lineOfSightTest`, `distanceSmellable` in `perception/sight.ts`
(creature smell, `13` §12).

### 1.6 `ResolveHitOnWall` (`LOS.cc:232-425`)

The ray may pass through some corner cells of wall profiles. `loc` is the cell pair (x,y) ∈ {(0,4), (3,4), (4,0), (4,3),
(4,4)}; for any other cell return `true` (blocked). Let `a = −horizAngle`, with **`PI = 3.1415926`** exactly
(`src/sgp/Types.h:54`; this matters for axis-aligned rays, see §1.7).
`NS = (a<0 && a>−PI/2) || (a>PI/2 && a<PI)`, `EW = (a>0 && a<PI/2) || (a<−PI/2 && a>−PI)`.
`TL = orient & 0x05` (ORIENT_LEFT), `TR = orient & 0x0A`. `wL(g)`/`wR(g)` = a wall, window or closed door of left/right
orientation at g. `oL(g)`/`oR(g)` = an open door of that orientation whose door is on that edge (`Tactical/Structure_Wrap.cc:168-235`;
in `oL`/`oR` the scan stops at the first door that is not open).
```
if NS:
  if loc∈{43,44}: if TR && !wR(g+S) && !wL(g) && !oR(g+S) → pass
  elif loc==04:   if TL && !wL(g+W) && !wR(g+SW) && !oL(g+W) → pass
  if loc∈{44,34}: if TL && !wL(g+E) && !wR(g) && !oL(g+E) → pass
  elif loc==40:   if DOOR && OPEN && orient&ORIENT_OUTSIDE(0x0C) → pass
                  elif TR && !wL(g+NE) && !wR(g+N) && !oL(g+NE) → pass
if EW:
  if loc==44:     if orient==NONE → pass
  elif loc==40:   if TR && !wR(g+N) && !wL(g+N) → pass
  elif loc==04:   if DOOR && OPEN && orient&ORIENT_INSIDE(0x03) → pass
                  if TL && !wL(g+W) && !wR(g+W) → pass
  if (loc==34 && TL) || (loc==43 && TR) || loc==44:
                  if !wL(g+E) && !wR(g+S) && !oL(g+E) && !oR(g+S) → pass
otherwise blocked
```
Neighbour gridnos are not bounds-checked in C; ja2-node treats a gridno outside the map as "no wall" (inferred harmless).

### 1.7 Numeric exactness

- All `FLOAT` arithmetic is float32: apply `f32` after every `+ − × /`. For these operations, computing in double and then
  rounding to float32 gives exactly the float32 result. Heights are integers for adults, so they are exact; kids'
  `×2/3` needs the `f32` steps.
- `Distance3D` is `std::hypot(float,float,float)` in Strac (`LOS.cc:210`) but `(float)sqrt((double)(x²+y²+z²))` in V. The
  only bit that matters is whether `dist` is an integer (`iDist++`). Use `f32(Math.sqrt(sum))`, which is deterministic in
  every JS engine; do not use `Math.hypot`. An emulation of libstdc++'s float `__hypot3` for every horizontal Pythagorean
  offset up to 39 tiles gave one non-exact result, (70,240) → 249.99998, but that still produces the same `iDist` (250).
  MSVC's power-of-two-scaled hypot is exact. So the formula matches all known builds (inferred for builds not checked).
  ja2-node computes it this way.
- `atan2` is only compared against 0 and ±PI/2, ±PI with `PI = 3.1415926`. Exact axis rays give exactly ±π/2, 0 or π in
  both glibc and V8. Because `PI/2` is slightly *smaller* than π/2, a ray going due south (dy>0, dx=0) counts as `EW`, a
  ray going due north counts as `NS`, and rays due east or west count as neither (always blocked at corner cells). Keep
  the literal.
- FIXEDPT positions stay below 1605·2²⁰ ≈ 1.7e9 < 2³¹. `qInc*iDist ≈ delta·2²⁰` also fits. The only overflow is
  `qIncZ*1000001` when dx = dy = 0 (same tile, different level) on a tile without structures. That cannot happen in
  practice, because a soldier on level 1 stands on a roof structure; ja2-node emulates it with `Math.imul` anyway.
- 27 of 261 original maps have non-zero `sHeight` (for example A6–A8, D13, E5; A9 is flat). On those the transposed-tile
  quirk changes results; ja2-node implements it literally.

### 1.8 Quirks to keep

| Quirk | Where |
|---|---|
| Start/end land height read from the transposed tile | `LOS.cc:733,769` (= V `LOS.c:720,751`) |
| The fast-forward ground check uses the land height of the tile just left | `LOS.cc:963` |
| The window band is absolute (87–220), so upper-storey windows are never see-through | `LOS.cc:1132` |
| Low-obstacle exemption at the far end needs `bAware` and compares with `iEndCubesZ` (not the above-level value) | `LOS.cc:1171` |
| Strac reads smoke at the ray's level (cube > 3 → roof); V checked level 0 only, with hard-coded smoke and gas | `LOS.cc:1249`, V `LOS.c:1151` |

---

## 2. Vision range and the sighting state machine (`Tactical/OppList.cc`)

### 2.1 `DistanceVisible(viewer, facingDir, subjectDir, gridNo, level)` (`:881-1032`), in tiles

```
subject = WhoIsThere2(gridNo, level)          // soldier whose PERSON structure is on that tile and level (WorldMan.cc:1479)
flash   = subject && subject.fMuzzleFlash
if viewer is MONSTER: return subject ? DistanceSmellable(subject) : 0
if viewer.bBlindedCounter > 0: return 0
if facingDir == IRRELEVANT && tank: facingDir = bDesiredDirection; subjectDir = dir(viewer → gridNo)
if !tank && (facingDir == IRRELEVANT || viewer is ROBOT || flash): d = 26
elif viewer.sGridNo == gridNo: d = 26
else:
  d = LOOK[facingDir][subjectDir]                       // :143-154: STRAIGHT 13, ANGLE 11, SIDE 7, SBEHIND 0, BEHIND 0
  if d == 11 && (viewer.team == OUR || viewer.bAlertStatus >= RED): d = 13
  d *= 2
  if viewer.usAnimState == RUNNING && LOOK[..] != 13: d = d*8/10
if viewer.bLevel != level: d += 2
L = LightTrueLevel(gridNo, level)                       // light at the TARGET tile (§4)
if flash: L = min(L, 3)
d = d * LIGHT_PCT[L] / 100                              // :164-183 (rain ×70/100 is dead code: weather never starts)
if L < 3:   if wearing SUNGOGGLES: d += 1; if L < 2: d += 1
elif L > 8: if NV/UV goggles || bloodcat || robot:
              if NV goggles || robot: d += (L > 12) ? (L < 15 ? 1 : 0) : 2
              elif sector z == 0: d += 4                // UV goggles (and bloodcats) above ground
            d += count of NIGHTOPS traits
if tank viewer with d > 0, or tank subject: d = max(d + 5, 26)
if smoke with maxVisibilityWhenAffected on (viewer.sGridNo, LEVEL OF THE SUBJECT)      // quirk: subject's level
   && (no gas mask || fx.ignoresGasMask): d = min(2, d)
```
`LIGHT_PCT[0..15] = 80,86,93,100,94,88,82,76,70,64,58,51,43,30,17,9` (index 3 = day, 12 = night). The LOOK table is
symmetric by octant difference: 0 → STRAIGHT, ±1 → ANGLE, ±2 → SIDE, ±3 → SBEHIND, 4 → BEHIND. "Wearing" means
`inv[HEAD1POS]` or `inv[HEAD2POS]` holds the item (`Soldier_Control.h:1068`). `MaxDistanceVisible() = 26` (`:875`).
Without gear a known target (or straight ahead) is seen at 26 tiles by day (L3), 18 at dawn (L8), 11 at night (L12);
peripheral (side) 14 / 9 / 6.

**Vanilla differs** (V `OppList.c:923`): the light scaling was applied only when a soldier stood on the target tile, and
not at all for a muzzle-flashing target at night. Strac always applies it and treats a flash as daylight.

ja2-node: `distanceVisible` (`perception/sight.ts`, light table in `adjustMaxSightRangeForEnvEffects`,
`lighting/lighting.ts`). Not ported: the tank lines, the robot's 360° view (`SOLDIER_ROBOT` only gets the night bonus)
and the smoke cap (`deviations` "Vision and hearing modifiers").

### 2.2 `ManLooksForMan(me, opp, caller)` (`:1335-1505`)

```
reject (return false): me == opp; me not valid (IsSoldierValidForSightings :621 — active, in sector, gridNo set,
  not dead, life > 0, not in the helicopter) or life < OKLIFE(15) or fMercAsleep; opp not valid; same team;
  me is a larva; me is a vehicle on OUR team
pers = me.bOppList[opp]; publ = gbPublicOpplist[me.team][opp]
aware = pers != 0 || publ != 0                       // seen or HEARD in the last 3 turns, personally or by the team
d = aware ? DistanceVisible(me, IRRELEVANT, 0, opp.sGridNo, opp.bLevel)          // 360° view
          : DistanceVisible(me, me.bDesiredDirection, atan8(me.sX, me.sY, opp.sX, opp.sY), opp.sGridNo, opp.bLevel)
if PythSpacesAway(me, opp) <= d && SoldierToSoldierLineOfSightTest(me, opp, u8(d), aware): ManSeesMan(me, opp, caller); ok = true
if !ok && me.bOppList[opp] == SEEN_CURRENTLY: HandleManNoLongerSeen(me, opp)
```
- `PythSpacesAway` = `trunc(hypot(Δrow, Δcol))` on tiles (`TileEngine/Isometric_Utils.cc:408`); ja2-node truncates
  `Math.sqrt` (`grid.ts`).
- `atan8` uses the **sub-tile world positions** `sX, sY` (`Tactical/Soldier_Control.cc:6354`): `x = x2−x1`,
  `y = −(y2−y1)`, `θ = atan2(y, x)` (+2π if negative), `idx = trunc((8θ+π)/(2π)) % 8` into {E, NE, N, NW, W, SW, S, SE}.
  `(0,0)` → E. Walkers mid-step therefore count from their truncated float position (ja2-node: `Math.trunc(s.x)`).
- An unaware look uses `bDesiredDirection`, not the current facing: during a turn, the view already points at the goal.

### 2.3 `ManSeesMan` and `HandleManNoLongerSeen` (`:1515-1929`, `:1266-1329`)

```
ManSeesMan(s, opp, caller):
  guards (as above); old = s.bOppList[opp]; newOpp = false
  if old != SEEN_CURRENTLY:
    [NPC/quest hooks on first sight, :1537-1736: civ groups that will turn hostile, Carmen, Eldin, Jim…, Angel, Joe,
     Iggy, Kingpin goons, Hicks at night, Mike/Joey quotes; a bloodcat becomes hostile and roars (Random(2))]
    if hostile(s, opp):          // !CONSIDERED_NEUTRAL both ways (Soldier_Control.h:273) && bSide differs
      AddOneOpponent(s)          // bOppCnt++; on the first: alert < RED → CheckForChangingOrders; alert = BLACK;
                                 // OUR team: bConsNumTurnsNotSeen = 0 (:2017-2052)
      if old != SEEN_THIS_TURN: newOpp = true; s.bNewOppCnt++; IncrementWatchedLoc(s, opp pos)
      else SetWatchedLocAsUsed(...)
      if old != SEEN_THIS_TURN || gsLastKnownOppLoc[s][opp] != opp.sGridNo: SetNewSituation(s)
      elif s.bAction ∈ {RANDOM_PATROL, SEEK_OPPONENT, SEEK_FRIEND, POINT_PATROL, LEAVE_WATER_GAS, SEEK_NOISE}: SetNewSituation(s)
  UpdatePersonal(s, opp, SEEN_CURRENTLY, opp.sGridNo, opp.bLevel)
  if caller ∈ {MANLOOKSFOROTHERTEAMS, OTHERTEAMSLOOKFORMAN, CALLER_UNKNOWN(hearing)} && bestSize != 0 && !boxing && newOpp:
    if INCOMBAT: (door case) StandardInterruptConditionsMet → ReevaluateBestSightingPosition(s, CalcInterruptDuelPts)
    elif s.team != OUR || opp.bLife >= OKLIFE: ReevaluateBestSightingPosition(s, CalcInterruptDuelPts(s, opp, TRUE))
  gbSeenOpponents[s][opp] = (it == 0) ? -1 : 1
  if s.team ∈ {OUR, MILITIA} && opp.bVisible <= 0:
    locate = opp.bVisible == -1; opp.bVisible = 1   (cancels a fade; if locate: SetSoldierAniSpeed(opp), camera SlideTo
                                                    when in combat or in a virgin sector — presentation)
  elif s.team != OUR: ReevaluateEnemyStance(s)       // AI switches to a threatening stance

HandleManNoLongerSeen(me, opp):
  if hostile(me, opp): RemoveOneOpponent(me)         // bOppCnt-- (min 0); at 0, alert = RED (:2055)
  me.bOppList[opp] = SEEN_THIS_TURN                  // the last known location is kept
  [Kingpin brothel guard hook]
  if gbPublicOpplist[me.team][opp] == SEEN_CURRENTLY && TeamNoLongerSeesMan(me.team, opp, exclude=me):
    public = SEEN_THIS_TURN
    if me.team ∈ {OUR, MILITIA} && opp.team ∉ {OUR, MILITIA}: opp.bVisible = 0
  if gbSeenOpponents[me][opp] == -1: = 1
```
`TeamNoLongerSeesMan` (`:806`) returns false if any valid teammate (life ≥ OKLIFE, not excluded) has `SEEN_CURRENTLY`. On
the first iteration OUR and MILITIA also check each other when the other team is active.

### 2.4 `HandleSight(s, flags)` and the look drivers (`:633-768`)

```
if !valid(s) return
gubSightFlags = flags
if bestSize != 6: bestSize = INCOMBAT ? 0 : 3; clear gBestToMakeSighting[]
clear gfWatchedLocHasBeenIncremented[s]
tmp = s.bNewSituation; s.bNewSituation = false
if flags & LOOK:
  if s.bLife >= OKLIFE: ManLooksForOtherTeams(s)     // s looks at every valid soldier on other teams (:1228)
  OtherTeamsLookForMan(s)                            // every valid soldier on other teams looks at s (:1946)
if INCOMBAT && flags & INTERRUPT: ResolveInterruptsVs(s, SIGHTINTERRUPT)          // interrupts: doc 10
if bestSize == 3: HandleBestSightingPositionInRealtime()                        // may EnterCombatMode (§2.9)
if s.bNewSituation && !(s is PC): HaultSoldierFromSighting(s, TRUE)
s.bNewSituation = max(s.bNewSituation, tmp)
if flags & RADIO:
  if s is PC: RadioSightings(s, ALL, s.team); RadioSightings(s, ALL, MILITIA); if s.team == OUR: RevealRoofsAndItems(s, TRUE)
  elif difficulty >= MEDIUM && s.team == ENEMY && Team[ENEMY].bAwareOfOpposition && class != ADMINISTRATOR:
       RadioSightings(s, ALL, ENEMY)
  s.bNewOppCnt = 0
  if s.team != OUR: OurTeamRadiosRandomlyAbout(s)    // our mercs, in Random() order, radio about s (:772)
  for them in active mercs: skip invalid, life < OKLIFE, or same team as s
     if them is PC: (other human teams only: none in single player)
     elif difficulty >= MEDIUM && them.team == ENEMY && aware && not admin: RadioSightings(them, ALL, ENEMY)
     them.bNewOppCnt = 0
gubSightFlags |= INTERRUPT
```
- `ManLooksForOtherTeams`: after each pair, outside combat, `if opp.bVisible == 0 → −1`, so a soldier who walks out of
  view disappears at once.
- `OtherTeamsLookForMan(opp)`: first, `if opp ∉ {OUR, MILITIA} && 0 ≤ opp.bVisible < 2 && opp.bLife: opp.bVisible = 0`.
  Then lookers are all valid soldiers with life ≥ OKLIFE on other teams, except larvae. Finally, if `opp.team != OUR`,
  `DecideTrueVisibility` (0 → −1). In combat it also sets `bInterruptDuelPts`.
- `AllTeamsLookForAll(allowInterrupts)` (`:1164`): `bestSize = 6`, everyone with life ≥ OKLIFE does `HandleSight(LOOK)`,
  every OUR-team soldier does `HandleSight(RADIO)`, then outside combat `HandleBestSightingPositionInRealtime` and the size
  is reset to 3 (or 0 if combat started).
- Iteration order: `FOR_EACH_MERC` walks `MercSlots` in the order soldiers were added to the sector (`Overhead.cc:242`).
  `FOR_EACH_IN_TEAM` and `RadioSightings` walk by soldier ID. Both orders decide `bVisible` transitions,
  `last_merc_to_radio`, ties in the best-sighting list, and `Random()` consumption; ja2-node keeps them (`mercs(t)` walks
  `TacticalState.mercSlots`, team and radio loops walk `t.soldiers` by id).

### 2.5 Personal and public knowledge, radio

`bOppList[156]` per soldier; `gbPublicOpplist[6][156]`; `gsLastKnownOppLoc`/`gbLastKnownOppLevel` per pair and per team;
`gbSeenOpponents` (−1 = first sight, used by interrupts).
Values: `SEEN_CURRENTLY 1`, `SEEN_THIS_TURN 2`, `SEEN_LAST_TURN 3`, `SEEN_2_TURNS_AGO 4`, `SEEN_3_TURNS_AGO 5`,
`HEARD_THIS_TURN −1` … `HEARD_3_TURNS_AGO −4`, `NOT_HEARD_OR_SEEN 0` (`Overhead_Types.h:194-206`).

`UpdatePersonal/UpdatePublic(…, new, grid, level)` (`:2159`, `:2110`): the value is replaced only if
`gubKnowledgeValue[old+4][new+4] > 0` or `new == 0`. The last-known grid and level are **always** overwritten
(ja2-node keeps the grid only, `Soldier.lastKnownOpp` and `Perception.publicLastKnown`; `deviations` "AI throw targets").
`gubKnowledgeValue` (`:105-126`, rows = old −4..5, columns = new −4..5):
```
-4: 0 1 2 3 0 5 4 3 2 1     -3: 0 0 1 2 0 4 3 2 1 0     -2: 0 0 0 1 0 3 2 1 0 0     -1: 0 0 0 0 0 2 1 0 0 0
 0: 0 1 2 3 0 5 4 3 2 1      1: 0 0 0 0 0 0 0 0 0 0      2: 0 0 0 0 0 1 0 0 0 0      3: 0 0 0 1 0 2 1 0 0 0
 4: 0 0 1 2 0 3 2 1 0 0      5: 0 1 2 3 0 4 3 2 1 0
```
In `UpdatePublic`, if the team goes from 0 to known, every valid teammate with life ≥ OKLIFE, not gassed and with personal
value 0 immediately does `ManLooksForMan(…, UPDATEPUBLIC)` and then `bNewOppCnt = 0`. Because that teammate is now
*aware*, he looks in a full circle. **Radio therefore gives the whole squad 360° sight of that enemy.**

`RadioSightings(s, about|ALL, toTeam)` (`:2467-2685`): for each valid opponent (a PC on the same side is skipped), skip if
the personal value is 0, or if personal knowledge is no better than public (`!K[publ][pers] && publ != pers`). Otherwise:
- an OUR-team radioer who sees a hostile, non-neutral opponent with life ≥ OKLIFE counts an "unknown" enemy (public was 0;
  +10 experience if not seen back) or a "revealed" one (public not 1 or 2). This drives `OurTeamSeesSomeone` and the
  enemy-sighting pause on the enemy's turn;
- radioing to MILITIA instead triggers `HandleInitialRedAlert(MILITIA)` if they are not yet aware;
- then `UpdatePublic(toTeam, opp, pers, lastKnown[s][opp])`.

Finally the team's public noise is replaced if `s.ubNoiseVolume > gubPublicNoiseVolume[team]`. For an OUR-team radioer
with new or revealed enemies, `OurTeamSeesSomeone` runs (§2.9).

### 2.6 Decay

- `DecayOppListValue` (`:209`): values ≥ 2 go up by 1 and values ≤ −1 go down by 1; past 5 or −4 the value becomes 0
  (forgotten). `SEEN_CURRENTLY` never decays here.
- **Real time:** `HandleTacticalEndTurn` runs every 5000 ms of game clock (strictly greater; ×time compression;
  `Strategic/Strategic_Turns.cc:64-82`). It calls `NonCombatDecayPublicOpplist(worldSeconds)`, which acts only if
  ≥ `TIME_BETWEEN_RT_OPPLIST_DECAYS` = 20 world seconds have passed since the last decay (`OppList.cc:4535`,
  `OppList.h:23`). In practice that is every 4th real-time turn (inferred; real-time turns fall every 5020 ms, `15`
  §1.7). The decay runs, for **all** mercs, `VerifyAndDecayOpplist` (`:4265`), then `DecayPublicOpplist` for each active
  team (`:4471`). ja2-node (`handleTacticalEndTurn`, `turns/turns.ts`) measures the 20 s on the tactical clock
  (`OPPLIST_DECAY_MS`), not in world seconds.
  - `VerifyAndDecayOpplist`: life < OKLIFE wipes the list. A pending `bNewOppCnt` is radioed (PCs). For each known
    opponent: `ManLooksForMan(VERIFYANDDECAYOPPLIST)` (360°, aware), then `DecayOppListValue`. A target lost here goes
    1 → 2 → 3 in one call.
  - `DecayPublicOpplist`: public noise volume halves (×7/10 in combat; the grid is forgotten at 0); public values decay
    (forgotten → `UpdatePublic(…, 0, NOWHERE)`); `last_merc_to_radio` is cleared if nothing is publicly known; watched
    locations decay.
- On leaving combat the decay timer is set to "now − 20" and a decay runs immediately (`Overhead.cc:4103`).
- Every real-time turn, `EVENT_BeginMercTurn` (`Soldier_Control.cc:3998-4152`) also: `ubNoiseVolume−−` (forget the noise
  grid at 0), `bBlindedCounter−−` (at 0 `HandleSight(LOOK)`), `ubTurnsUntilCanSayHeardNoise−−`, `bTilesMoved = 0`,
  `ubMovementNoiseHeard = 0`. Order inside `HandleTacticalEndTurn`: opplist decay first, then the per-merc turn starts
  (`Tactical/Tactical_Turns.cc:80-160`).

### 2.7 What the player may see: `bVisible`

Values: `1` visible, `0` "limbo" during a look pass, `−1` invisible, `−2` fading out (set by the renderer pass,
`Overhead.cc:602-634`). OUR and MILITIA are created visible; others start at −1 (`Soldier_Create.cc:192,202,916`). Only
lookers on OUR or MILITIA set `bVisible = 1`: **the player sees what his mercs and the militia see.** The renderer skips a
soldier whose `bLastRenderVisibleValue == −1` (`TileEngine/RenderWorld.cc:938`); a `0` soldier is drawn with a "ghost" shade
(`:989`). In real time a `0` is normally turned into −1 within the same pass (`:1251-1256`, `DecideTrueVisibility`).
The exception is a loss found by `VerifyAndDecayOpplist` (§2.6), which no `DecideTrueVisibility` follows, so the `0`
lasts until the next look involving that soldier. `BetweenTurnsVisibilityAdjustments` (`:2265`; turn end, combat exit,
deaths) forces −1 when no OUR-team member sees the soldier. Animation speed reads visibility (unseen soldiers animate
with delay 0 in combat, `Soldier_Control.cc:4930`), so `bVisible` is simulation state. ja2-node: `Soldier.visible` takes
1, 0 and −1 only (no fade state; the unseen speed-up applies at once: `deviations` "Unseen soldiers in combat");
`betweenTurnsVisibilityAdjustments` is in `turns/turns.ts`.

### 2.8 When sight runs (real time)

| Trigger | Call | Source |
|---|---|---|
| Arrival at a tile centre: `MovementNoise` → `MakeNoise`, then sight if no interrupt happened | `HandleSight(LOOK\|RADIO\|INTERRUPT)` | `Overhead.cc:1795-1812` |
| Turning one octant while the animation is stationary: flag `SOLDIER_LOOK_NEXT_TURNSOLDIER`, sight on the next `TurnSoldier` call, then `HandleSystemNewAISituation`. Turns while walking are covered by the next tile arrival | `HandleSight(LOOK\|RADIO)` | `Soldier_Control.cc:4229-4240,4466-4470` |
| End of a stance-change animation (opcode 499) | `LOOK\|RADIO\|INTERRUPT` (no INTERRUPT while busy or pending) | `Soldier_Ani.cc:1811-1821` |
| Roof climb up/down commit (opcodes 408/475) | `LOOK\|RADIO\|INTERRUPT` | `Soldier_Ani.cc:273,1177` |
| Door or other interactive object opened (opcode 495): `DoorOpeningNoise`, `InitOpplistForDoorOpening`, `MakeNoise(CREAKING)`, then | `AllTeamsLookForAll(TRUE)` | `Soldier_Ani.cc:1603-1616` |
| Sector entered / loaded | `AllTeamsLookForAll(TRUE)` | `Strategic/StrategicMap.cc:466,665` |
| Soldier created; collapse; death-anim pending; face item changed; blindness ends | `HandleSight(LOOK)` | `Soldier_Control.cc:559,7970,4057`; `Soldier_Ani.cc:3359`; `Items.cc:2078` |
| Teleport, vehicle exit, NPC added | `LOOK\|RADIO` | `Soldier_Tile.cc:636`; `Vehicles.cc:577`; `Soldier_Profile.cc:670` |
| End of an attack with `CHECK_SIGHT_AT_END_OF_ATTACK`; smoke and light changes | `AllTeamsLookForAll(FALSE/TRUE)` | `Overhead.cc:5748-5760`; `TileEngine/SmokeEffects.cc:396`; `TileEngine/LightEffects.cc:93,143` |
| Every ~20 s: re-check of *known* opponents only | `VerifyAndDecayOpplist` | §2.6 |

There is no periodic look. Two stationary soldiers facing each other are not re-tested until one of them moves, turns or
changes stance (or the 20 s verification, which covers known opponents only). Changes in ambient light do **not** trigger
a look (`TileEngine/Environment.cc:218` is commented out). ja2-node wires the arrival, turn, stance-change and door
triggers in `perception/wiring.ts` (`sightHooks`).

### 2.9 What a new sighting triggers in real time

1. `ManSeesMan` (hostile pair): the looker's `bOppCnt++`; AI alert → BLACK plus `SetNewSituation`. An AI looker is
   stopped by `HaultSoldierFromSighting` (outside combat: `EVENT_StopMerc`; it also cancels a pending throw or knife
   attack, `Soldier_Control.cc:7271`).
2. Best-sighting list (size 3, ordered by `CalcInterruptDuelPts`, `TeamTurns.cc:1139`; `NO_INTERRUPT` for neutrals) →
   `HandleBestSightingPositionInRealtime` (`OppList.cc:372`): if only one entry, or entries 0 and 1 (or 0 and 2) are on
   the same team, or there is no 3rd entry, then `EnterCombatMode(best[0].team)`; otherwise the 2nd-best team starts and
   best[0] gets an interrupt. `EnterCombatMode` (`Overhead.cc:3984`) does nothing without a capable enemy in the sector
   and stops everyone (doc `09` §1). **This happens before the radio step**, so the merc's sighting quote follows combat
   entry. ja2-node: the `enterCombatMode` perception hook calls `enterCombatMode` (`turns/turns.ts`, `10`).
3. Radio: `OurTeamSeesSomeone` (`:2408`). In a virgin sector: close any talk menu, play the seen quote, halt the merc,
   clear `fVirginSector`. Otherwise an OUR merc curses (only re-revealed enemies) or says the seen quote, and is halted
   (`EVENT_StopMerc`). While it is the enemy's turn, that enemy gets a 3 s animation pause (doc `10` §5). Music switches to
   battle in combat.
4. First sightings may fire NPC/quest hooks (§2.3) and `AddToShouldBecomeHostileOrSayQuoteList`.

---

## 3. Noise and hearing

### 3.1 Sources (`MakeNoise` callers)

| Noise | Volume | Kind | Source |
|---|---|---|---|
| Footstep (every soldier, every tile centre) | `MovementNoise` (§3.2); 0 → no call | MOVEMENT | `Overhead.cc:1797-1800` |
| Door or interactive object opened or closed | 2 (6 if a tin can is on the door), or 0 if a `MovementNoise` roll comes out silent | CREAKING | `OppList.cc:3348`, `Soldier_Ani.cc:1603` |
| Gunfire | weapon attack volume; silencer: `1 + (100−status%)/(100/(vol−1))` | GUNFIRE | `Weapons.cc:851-861` |
| Bullet impact / window | weapon `ubHitVolume`; window crack 4 / smash 8 | BULLET_IMPACT (source hidden) | `Weapons.cc:1619,1884-1887` |
| Rock / grenade landing | `9 + PreRandom(9)` | ROCK/GRENADE_IMPACT (hidden) | `TileEngine/Physics.cc:423-427` |
| Explosion; silent alarm | explosive `noise`; alarm 30 | EXPLOSION / SILENT_ALARM | `TileEngine/Explosion_Control.cc:1471,1902` |
| Scream on a hit; door smash; crowbar | `CalcScreamVolume`; 6; 4 | SCREAM / DOOR_SMASHING | `Soldier_Control.cc:2835`; `Keys.cc:225,306` |

### 3.2 `MovementNoise` (`OppList.cc:3230-3346`)

```
if team == ENEMY: return 9 − PreRandom(2)                  // army is always loud: 8 or 9 (one PreRandom per step)
st = 20 + 4*EffectiveExpLevel + EffectiveDexterity*4/10     // SkillCheck.cc:67,112
st += bloodcat ? 50 : 25*count(STEALTHY)
el = effectiveLife = bLife + (bLifeMax − bLife − bBleeding)/2; if el < 50: st −= st*(50−el)/100
if bBreath < 50: st −= st*(50−bBreath)/100
st −= DeepWater ? 20 : Water ? 10 : 0;   st −= 3*bDrugEffect[ADRENALINE];   st = max(st, 0)
if !bStealthMode:
  max = u8(9 − st/16); if Water: max++
  CRAWLING: max = max<=2 ? 0 : max−2;  SWATTING: max = max<=1 ? 0 : max−1;  RUNNING: max += 3
  vol = max < 2 ? max : 1 + PreRandom(max)
else:
  r = PreRandom(100); if r >= st: r = PreRandom(100)        // v1.13 second chance
  if r < st: vol = 0
  else: vol = 1 + (r − st + 1)/16; CRAWLING: vol = vol<=2 ? 0 : vol−2; SWATTING: vol −= 1; RUNNING: vol += 3
```
Example: Exp 3, Dex 70 → st 60 → walking volume 1..6, running 1..9. V had a UINT8 wraparound and an unreachable water
branch (doc 02). `PreRandom` is drawn **before** that step's sight check. ja2-node: `movementNoise`
(`perception/noise.ts`) on the `pre` stream, without the adrenaline term (drugs are not ported).

### 3.3 `MakeNoise` → `OurNoise` → `ProcessNoise` (`:3380`, `:3403`, `:3428-3770`)

`MakeNoise` queues the noise as a demand event while `ubAttackBusyCount > 0` (released at the attack barrier, doc `10` §5).
`OurNoise` = `ProcessNoise`, then (in combat, maker known, not a door-delay) `ResolveInterruptsVs(NOISE)`.
```
ProcessNoise(maker, grid, level, base, kind):
  if base == 0: return
  if maker && kind != EXPLOSION && (maker inactive/not in sector/dead || (maker.bLife == 0 && kind != SCREAM)): return
  srcTerrain = ubTerrainID[grid]
  source = kind ∈ {ROCK_IMPACT (also sets gWhoThrewRock), BULLET_IMPACT, GRENADE_IMPACT, EXPLOSION} ? null : maker
  for team in 0..5, active only:
    if maker && (team == maker.team || (Team[team].bHuman && public[team][maker] == SEEN_CURRENTLY)): continue
    tell = fEnemyInSector && (!INCOMBAT || ubCurrentTeam != OUR)
    if kind ∈ {GUNFIRE, BULLET_IMPACT, ROCK_IMPACT, GRENADE_IMPACT, SILENT_ALARM}: tell = false
    if kind == EXPLOSION && TeamMemberNear(team, grid, 13): tell = false
    if maker && (public[team][maker] ∈ {SEEN_CURRENTLY, SEEN_THIS_TURN, HEARD_THIS_TURN} || maker.bLife == 0): tell = false
    heard = seen = false; loudest = 0; by = null
    for L in team (by ID): skip invalid, life < OKLIFE, larva, OUR vehicle, OUR POW
      if maker: skip if L sees maker (L.bOppList[maker] == 1) unless (L.bNeutral && kind == GUNFIRE)
                skip militia on our side hearing OUR; WARDEN/GENERAL/SERGEANT/CONRAD hearing ENEMY;
                OUR hearing friendly militia; army↔creatures in N5
      else: skip friendly militia
      if L.team == CIV && kind ∈ {GUNFIRE, EXPLOSION}: L.ubMiscSoldierFlags |= HEARD_GUNSHOT
      eff = CalcEffVolume(L, grid, level, kind, base, L.bOverTerrainType, srcTerrain)
      if eff > 0:
        HearNoise(L, source, grid, level, eff, kind, &seen); heard = true
        dir = GetDirectionToGridNoFromGridNo(L.sGridNo, grid)   // 8-way direction from the listener to the noise
        if kind != MOVEMENT || team != OUR || L.bInterruptDuelPts != NO_INTERRUPT || !(L.ubMovementNoiseHeard & 1<<dir):
          if eff > loudest: loudest = eff; by = L; loudestDir = dir
    if heard && team == OUR && tell && by:
      TellPlayerAboutNoise(by, maker, grid, level, loudest, kind, loudestDir)
      if kind == MOVEMENT: by.ubMovementNoiseHeard |= 1 << dir   // QUIRK: `dir` of the LAST listener, not loudestDir (:3730)
    if source && Team[team].bHuman:
      if seen: OurTeamRadiosRandomlyAbout(source)
      elif heard: UpdatePublic(team, source, HEARD_THIS_TURN, grid, level)
  gWhoThrewRock = null
```
ja2-node: `makeNoise` defers to `TurnState.deferredNoises` while `attackBusyCount > 0` (`dequeueDeferredNoises`);
`processNoise` derives `fEnemyInSector` from the placed soldiers and lacks the POW, Warden/General/Sergeant/Conrad and N5
arena listener skips.

### 3.4 `CalcEffVolume` and `DecideHearing` (`:3773-3892`, `:1093-1150`)

```
if wearing WALKMAN: 0;   if INCOMBAT && ubCurrentTeam == L.team: 0
eff = base + DecideHearing(L) − L.bOppCnt − (PythSpacesAway(L, grid) − 1)
if L.usAnimState == RUNNING: eff −= 5            // sleeping −5 is #if 0 in Strac (V had it)
eff += level > L.bLevel ? 5 : level < L.bLevel ? −5 : 0
if eff > 0 && exactly one of (L.bOverTerrainType, srcTerrain) is FLAT_FLOOR: eff −= 5   // inside/outside muffling
return max(eff, 0)

DecideHearing: tank −5; monster −10; else h = (bExpLevel > 3) + count(NIGHTOPS)
  + (EXTENDEDEAR in HEAD1/HEAD2 ? status/20 + 1 : 0)
  + ambient 8–9: +1, 10: +2, 11–15: +3 + count(NIGHTOPS)      // ubAmbientLightLevel, not the tile's light
```
There are no walls in hearing: only distance, levels and the floor/non-floor terrain test. There is no randomness. Range in
tiles ≈ `base + hearing − oppCnt`: an army footstep (8–9) is heard about 8–9 tiles away in daylight (inferred example).
ja2-node has no walkman, extended ear, NIGHTOPS or tank term (`deviations` "Vision and hearing modifiers").

### 3.5 `HearNoise(L, source, grid, level, vol, kind, &seen)` (`:3895-4222`)

```
crow: CrowsFlyAway; return
turn head (no actual turn): d = DistanceVisible(L, IRRELEVANT, IRRELEVANT, grid, level)
  (a gunfire maker's muzzle flash is ignored unless L already faces the noise within ±1 octant)
srcSeen = PythSpacesAway(L, grid) <= d && !(hadToTurn && tank) && SoldierTo3DLocationLineOfSightTest(L, grid, level, 0, u8(d), TRUE)
  hadToTurn = L.bDirection != atan8(L.sX, L.sY, CenterX(grid), CenterY(grid))
if source:
  old = L.bOppList[source]
  if srcSeen: ManSeesMan(L, source, CALLER_UNKNOWN); AI: bNewOppCnt = 0; seen = true
              neutral L and (GUNFIRE|BULLET_IMPACT) with vol >= 3: alert < RED → RED
  else: SetNewSituation(L); (GUNFIRE|BULLET_IMPACT) && vol >= 3 → RED
        UpdatePersonal(L, source, HEARD_THIS_TURN, grid, level)
        if vol >= L.ubNoiseVolume: L.sNoiseGridno = grid; L.bNoiseLevel = level; L.ubNoiseVolume = min(vol, 12); SetNewSituation(L)
  if L asleep (AI_ASLEEP) and kind ∈ {BULLET_IMPACT, GUNFIRE, EXPLOSION, SCREAM, WINDOW_SMASHING, DOOR_SMASHING}: wake up
  if hostile(L, source): door delay → best-sighting entry with +vol/2 points; combat → interrupt points;
                         real time and srcSeen → HandleBestSightingPositionInRealtime()
else (source hidden):
  AI listener: (EXPLOSION|SILENT_ALARM) with vol >= 3 → RED (alarm: put on gas mask)
  if !srcSeen || (ROCK_IMPACT && hadToTurn) || SILENT_ALARM: remember the noise as above (>= current volume, cap 12)
  else: SetNewSituation; alert < RED → RED            // e.g. watched the grenade land
  in combat: a rock gives every eligible listener AUTOMATIC_INTERRUPT
```
The AI reacts through `sNoiseGridno/ubNoiseVolume` and HEARD opplist entries. `DecideAlertStatus`
(`TacticalAI/DecideAction.cc:3721`) moves GREEN → YELLOW when `MostImportantNoiseHeard` finds an uninvestigated noise,
and YELLOW → GREEN when there is none and no action is in progress. RED never drops; `bOppCnt > 0` → BLACK.
ja2-node's `hearNoise` omits the crows, the tank's turn rule and the alarm's gas mask; the AI side reads
`perception/knowledge.ts` (`mostImportantNoiseHeard`).

### 3.6 What the player is told: `TellPlayerAboutNoise` (`:4225-4262`)

The original has **no on-map noise marker**. The loudest OUR listener gets a yellow screen message
`pNewNoiseStr[kind]` built from his name, `pNoiseVolStr[idx]` and a direction. `idx` is 0 for eff 1–3 ("faint"), 1 for
4–7, 2 for 8–11 and 3 for 12+. The direction is `pDirectionStr[dir]` (8-way, from the listener) when the noise is on the
listener's level or is an explosion, scream, rock or grenade; otherwise "from above" or "from below". A faint noise also
triggers `QUOTE_HEARD_SOMETHING` if not in a meanwhile or a conversation and `ubTurnsUntilCanSayHeardNoise == 0`, after
which the countdown is set to 5 turns (2 in combat). The player never learns the grid. The public `HEARD_THIS_TURN` entry
is not rendered (no renderer reads it).

ja2-node's `tellPlayerAboutNoise` emits `noiseHeard {listener, kind, volumeClass 0–3, direction: 0–7 | 'above' |
'below'}` and says the quote; the grid is never sent, since a marker at the true grid would leak hidden state (D16).
`squadHears` computes the same hearing (loudest listener, direction, loudness class) for the sounds of sources out of
sight (`unseen-sources.ts`, `04` §6.9), whether or not the noise is told.

---

## 4. Light for vision

- `LightTrueLevel(grid, level)` (`TileEngine/Lighting.cc:508`): node = land head (level 0) or roof head (level 1); no node →
  `ubAmbientLightLevel`. Otherwise `clamp(ubNaturalShadeLevel − (ubSumLights − ubFakeShadeLevel), 1, 15)`. Merc lights
  are FAKE (`MERC_LIGHT → LIGHT_FAKE`, `Lighting.cc:1419`) and so are ignored. Map light sprites, flares and light effects
  count.
- Natural shade = `clamp(ambient, 1, 15)` on every node (`LightSetBaseLevel`, `Lighting.cc:1360`). Map light sprites,
  explosion and muzzle-flash lights are simulated with the original ray casting; the model, its triggers and the oracle
  check are in `docs/20-lighting.md`.
- Ambient above ground (`TileEngine/Environment.cc:369`, `:229-279`): `gubEnvLightValue` steps every 2 minutes: 11 → 3
  from 06:47 to 07:03, and 4 → 12 from 20:57 to 21:13. Day is 3, night 12; hot desert sectors at midday use 2. Underground
  levels store their own ambient in the map (`TileEngine/WorldDef.cc:2334`). ja2-node keeps it in
  `TacticalState.lighting.ambient` (the sandbox stays at ambient 3, `deviations` "Ambient light and light schedule").
- Light matters for sight at three points: the target tile's light (§2.1); `DecideHearing` (ambient); the FOV item range
  (§5). Interrupts, sun goggles in the hit chance and the AI read it too (`docs/20` §5). ja2-node: `lightTrueLevel` and
  `adjustMaxSightRangeForEnvEffects` in `src/sim/tactical/lighting/lighting.ts`.

---

## 5. Player fog of war: revealed tiles, rooms and roofs (`Tactical/FOV.cc:189-691`)

Above ground there is no terrain fog: land and structures are always drawn. The player-side state is:
`MAPELEMENT_REVEALED` / `MAPELEMENT_REVEALED_ROOF` per tile, `gubWorldRoomHidden[room]` (all TRUE at load,
`TileEngine/WorldDef.cc:2321`), `LEVELNODE_HIDDEN` on roof nodes, and per-item `bVisible`. In caves, fog is removed per
revealed tile.

`RevealRoofsAndItems(merc, showLocators)` runs for OUR-team mercs from `HandleSight(…RADIO)` (every tile step, stationary
turn and stance change), at sector placement (`Soldier_Add.cc:904`), on teleport, on `SOLDIER_LOOKFOR_ITEMS`
(`Overhead.cc:674`), and after attacks and explosions. It skips enemies, vehicles, mercs who are not placed, who have
life < OKLIFE, or who are blinded.
```
MercLooksForDoors(merc)                                   // perceived door states (Keys.cc)
range = gassed ? 1 : (AdjustMaxSightRangeForEnvEffects(LightTrueLevel(merc tile), 13) + 13) / 2   // day 13, night 9
Dir[0..4] = BuildSightDir(bDirection) = {DLEFT, DRIGHT, UP(=facing), LEFT, RIGHT}; NOVIEW = stay
table = bDirection odd ? ViewPath2 : ViewPath            // 17 paths × 13 steps, FOV.cc:56-97 (`VIEW_PATH(_2)`, fov.ts)
for each path p:
  marker = merc.sGridNo; revealItems = true; flags reset
  for k in 0 until range:
    step = table[p][k]; marker = NewGridNo(marker, Inc[step])     // off-map → stay
    if step == NOVIEW && k != 0: break
    cost = gubWorldMovementCosts[marker][Dir[step]][level]        // PathAI movement-cost table
    door cost → DoorTravelCost(perceived); a transparent door → FLAT
    if cost >= TRAVELCOST_BLOCKED(249):
      WALL/DOOR/EXITGRID → obstacle, stop items; else tallest ground structure ≥ 3 cubes → obstacle; > 0 → items stop after this tile
      diagonal step → obstacle, no items
    if first visit of marker in this call (gubGridNoMarkers):
      if passed through a door and k > 5: break
      blocking = GetBlockingStructureInfo(marker, Dir[step], Dir[next] or 30, level, …, wallsBlock=FALSE)   // Structure.cc:1695
      window beside the merc (k <= 1) along N/S (left windows) or E/W (right windows) → may look through next tile
      if items allowed: reveal corpses and items (SetItemsVisibilityOn → VISIBLE; locator, quote; halts in combat)
      if blocking == FULL_BLOCKING || (obstacle && !throughWindow): break
      level 0: REVEALED (underground: only in a room or without a roof); if the tile's room is hidden → RemoveRoomRoof(room)
      level 1: REVEALED_ROOF
      if blocking ∉ {NOTHING, window/door kinds}: break    // the ray stops AFTER revealing the first tile with any structure
    elif obstacle: break
ExamineSlantRoofFOVSlots()
```
- `GetBlockingStructureInfo` scans the tile's structures at the merc's level. Walls are ignored, because movement costs
  handle them. A window returns a window kind and a door returns FULL (closed) or a door kind, both immediately. Otherwise
  the result depends on the **last** level-matching structure: a person or corpse → NOTHING; a tree or fence seen
  earlier → REDUCE_RANGE; else NEXT_TILE. Soldiers' structures are appended after the map's, so a bush tile with a
  soldier standing in it does not stop the ray (inferred consequence of list order). ja2-node's `blockingStructureInfo`
  returns NOTHING whenever the occupancy map has a soldier on the tile, whatever the list order.
- `RemoveRoomRoof(room)` (`TileEngine/Render_Fun.cc:176`) loops over the whole map. For every tile of that room it calls
  `SetGridNoRevealedFlag`: roof nodes FIRSTROOF..FOURTHROOF get `LEVELNODE_HIDDEN`, the room's A-frames are hidden,
  obstacle structures get `SHOW_THROUGH`, the tile gets `REVEALED`, and `gubWorldRoomHidden[room] = FALSE`. It also
  reveals items (first find: `QUOTE_SPOTTED_SOMETHING_ONE + Random(2)`) and recalculates wireframes. **The whole roof of
  a room disappears as soon as one tile of it is revealed**, and it stays hidden: the revealed flags are saved with the
  sector (`TileEngine/SaveLoadMap.cc:335,487`). The renderer skips hidden roof nodes unless `SHOW_ALL_ROOFS` is set
  (`RenderWorld.cc:1114`).
- Rooms come from the map's room array (`MapDef.rooms`, `Level.rooms`); room 0 = `NO_ROOM`.

ja2-node (`perception/fov.ts`, state `TacticalState.fog`: `revealed` with `GROUND`/`ROOF` bits, `roomHidden`, the
first-visit markers): `revealRoofsAndItems` follows the pseudocode; `removeRoomRoof` marks the room's tiles revealed,
clears `roomHidden` and emits `roomRevealed`; the client derives hidden roofs, A-frames, show-through and wireframes from
the revealed rooms (`src/render/world/reveal.ts`). Both arrays are saved in the sector diff (`sim/campaign/sector-diff.ts`).
Not ported: `MercLooksForDoors` (perceived doors equal real ones, `deviations` "Doors"), `ExamineSlantRoofFOVSlots`, the
item reveal and quote of `RemoveRoomRoof` (so no `Random(2)`), and the vehicle and blindness skips.

---

## 6. Implementation in ja2-node

### 6.1 State

- Structures: `TacticalState.world.structures` (`WorldStructures`, `07` §7), per-tile lists in insertion order with
  shape, flags, `cubeOffset`, wall orientation and cached height; soldiers and corpses append their own (transparent)
  structures. Land heights `world.level.heights`, terrain `world.terrain`, rooms `world.level.rooms`.
- `TacticalState.perception` (`Perception`, `perception/sight.ts`): `publicOpp[team][id]`, `publicLastKnown`, the
  public noise per team, `lastMercToRadio`, `awareOfOpposition`, the best-sighting list (`bestSize`, `best`) and
  `disallowSight` (`DISALLOW_SIGHT`).
- `TacticalState.turn` (`turns/turn-state.ts`): `seenOpponents` (`gbSeenOpponents`), watched locations, `sightFlags`,
  `deferredNoises`, `enemySightingOnTheirTurn`, `delayResolvingBestSightingDueToDoor`, `interruptProvoker`.
- `TacticalState.fog` (§5), `TacticalState.lighting` (§4).
- `Soldier`: `oppList`, `lastKnownOpp`, `visible`, `newOppCnt`, `interruptDuelPts`, `movementNoiseHeard`,
  `turnsUntilCanSayHeardNoise`, `blindedCounter`, `muzzleFlash`, `tilesMoved`, `stealthMode`, and in `ai`: `oppCount`,
  `alertStatus`, `newSituation`, `noiseGridNo`, `noiseVolume`, `noiseLevel`.

### 6.2 Modules (`src/sim/tactical/perception/`)

| Module | Responsibility |
|---|---|
| `los.ts` | `lineOfSightTest`, `resolveHitOnWall`, `soldierEyeZ`, `soldierToSoldierLineOfSight`, `soldierToLocationLineOfSight` (§1) |
| `sight.ts` | `distanceVisible`, `manLooksForMan`, `manSeesMan`, `handleManNoLongerSeen`, `updatePersonal/Public`, `radioSightings`, `ourTeamRadiosRandomlyAbout`, `handleSight`, `allTeamsLookForAll`, the best-sighting list, decay, muzzle flashes (§2) |
| `opp.ts` | Opplist values, sight flags, callers, `atan8` |
| `duel.ts` | `calcInterruptDuelPts`, `standardInterruptConditionsMet`, watched locations (`10`) |
| `enemy-stance.ts` | `ReevaluateEnemyStance` after an enemy's sighting |
| `noise.ts` | `movementNoise`, `doorOpeningNoise`, `makeNoise`, `processNoise`, `calcEffVolume`, `decideHearing`, `hearNoise`, `tellPlayerAboutNoise`, `squadHears` (§3) |
| `knowledge.ts` | The AI's reading of heard noises and known opponents (`MostImportantNoiseHeard`, `ClosestKnownOpponent`, …) |
| `fov.ts` | `revealRoofsAndItems`, `blockingStructureInfo`, `removeRoomRoof` (§5) |
| `wiring.ts` | `sightHooks` and `perceptionHooks`: the triggers of §2.8, halting on a sighting (`haltFromSighting`), `OurTeamSeesSomeone`, combat entry |

NPC and quest reactions to a first sighting go through `narrative/sight-rules.ts` (`newSightingRules`). What the player
and an agent see of all this (soldiers by `visible`, our team's sightings, `noiseHeard`) is the player view of `04`.

### 6.3 Verification

The oracle probes `los` (`LineOfSightTest` and `SoldierToSoldierLineOfSightTest`), `light` (distance visible) and the
`soldier` dumps (visibility, opplist) match the native build (`tools/oracle/README.md`); the sighting quotes of Mike and
Joey are traced by patch 0022.

### 6.4 Determinism

- `PreRandom` draws: per tile step `MovementNoise` (army 1; mercs 0–2), door noise (through `MovementNoise`), rock and
  grenade impacts. Main `Random`: the `OurTeamRadiosRandomlyAbout` order (once per merc per radio), the bloodcat roar,
  the hostile-quote speaker choice; the original's room-roof item quote (`Random(2)`) is not drawn in ja2-node (§5).
- Iteration orders as in §2.4. One `handleSight` runs to completion (including nested `UpdatePublic` looks) before the
  next simulation event.
- `DISALLOW_SIGHT` windows (explosions, roof climbs) make every LOS test return 0, so known targets are lost during them
  (doc `01` §3.5).

---

## 7. Inferred, not verified

- Structure-list order matters only for FOV; LOS results are order-independent apart from the window test.
- The `hypot` agreement of §1.7 on builds not checked.
- The exact `MercSlots` order after soldiers leave and re-enter the sector (ja2-node reuses the first free slot).
