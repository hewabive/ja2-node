<!-- Soldiers on the tactical map: animation surfaces, frame selection, palettes, shadows, z, movement, profiles, creation.
2026-10-15. Source: reference/stracciatella/src (snapshot ae6bf01, same as docs 01–05). Read-only research; nothing was
built. Data checks used `pnpm cli inspect` and throw-away scripts over the project's own parsers (outputs not committed). -->

# 06 — Soldiers: sprites, frames, palettes and movement

This is the spec for putting soldiers on the map: which STI a soldier shows, which frame of it, in which colours, at
which pixel and z, and how position and facing advance per animation frame. It builds on `03` (logic/animation
coupling, opcodes, `sAniDelay`), `04` (ticks) and `05` (static render pipeline, shade tables, z, multi-Z strips).

**Notation** (as in `05`):
- Unmarked statements were read in the code and carry `file:line`.
- **(inferred)** marks my derivations.
- **(data)** marks checks against the user's Gold 1.12 data.
- `vanilla:` = `reference/vanilla/ja2/Build/`.

| Basename | Path under `reference/stracciatella/src/` |
|---|---|
| `Animation_Data.cc/.h`, `Animation_Control.cc/.h`, `Animation_Cache.cc/.h`, `Soldier_Ani.cc`, `Soldier_Control.cc/.h`, `Soldier_Create.cc/.h`, `Soldier_Init_List.cc`, `Soldier_Add.cc`, `Soldier_Profile.cc`, `Soldier_Profile_Type.h`, `LoadSaveMercProfile.cc/.h`, `LoadSaveSoldierCreate.cc`, `LoadSaveObjectType.cc`, `Overhead.cc`, `Overhead_Types.h`, `Tactical_Save.cc`, `SkillCheck.cc`, `Inventory_Choosing.cc` | `game/Tactical/` |
| `RenderWorld.cc`, `Isometric_Utils.cc/.h`, `Lighting.cc`, `WorldMan.cc`, `Structure.cc`, `WorldDef.h`, `TileDef.h` | `game/TileEngine/` |
| `Strategic_AI.cc`, `Queen_Command.cc` | `game/Strategic/` |
| `Timer_Control.cc/.h`, `Utilities.cc` | `game/Utils/` |
| `VObject_Blitters.cc`, `HImage.cc`, `Shading.cc`, `Types.h` | `sgp/` |
| `DefaultContentManager.cc`, `mercs/BinaryProfileData.cc`, `mercs/MercProfile.cc` | `externalized/` |

---

## 0. Cheat sheet

```
surface  = DetermineSoldierAnimationSurface(body, state, hand item, life<30, in water, big-guy flags)   §1.2
frame    = (ja2bin value − 1) + framesPerDir(surface) · spriteDir                                       §1.3
spriteDir: 8-dir STI → (dir+1)%8 ; 4-dir → ((dir+1)%8)/2 ; 1-dir → 0                                    §1.3
palette  = STI palette of the soldier's STANDING surface, then ja2pal.dat ranges
           HAIR 245–250, PANTS 205–219, SKIN 235–244, VEST 220–234 (data)                              §3
shade    = pShades[max(nodeShade−2, 4)]  (tile formula of 05 §6.4);  enemies: pGlowShades[glow(+10)]     §3.4
pixel 254 = shadow: dst = ShadeTable[dst] (×0.48), no separate shadow sprite                            §4.1
anchor   = (cx + trunc(2(dX−rcx) − 2(dY−rcy)),  cy + trunc((dX−rcx)+(dY−rcy)) − tileH − 10 − sHeightAdj
           + gsRenderHeight);  frame pixel (0,0) at anchor + (sOffsetX, sOffsetY)                       §4.2
           at a tile centre the anchor is (ox+20, oy+10) of 05 §1.5
z        = 8·wy(sGridNo) + 3, test zbuf < z, no z write; obscured tiles: checkerboard where hidden       §4.3
move     = per frame: d·sin/cos(angle[dir]) in float32; walk 1.6, run 2.6, swat 2.2, crawl 0.8           §5.3
           → 7,6,6,7,… frames per straight tile when walking, 9 per diagonal tile (inferred)
turn     = one octant per animation frame while the state has ANIM_TURNING                               §5.4
prof.dat = 170 × 716-byte records, each decoded with the 46-byte rotation key                            §6
enemy    = body Random(4) (female → male unless elite), skin/hair random, vest/pants by class            §7
```

---

## 1. Animation surfaces

### 1.1 `gAnimSurfaceDatabase`

- **Row layout.** `{Filename, bStructDataType, ubFlags, ubNumDirections, bProfile, usNumFramesPerDir, bUsageCount,
  hVideoObject}` (`Animation_Data.h:516-526`). The table has 396 rows (`Animation_Data.cc:38-464`), indexed by
  `enum AnimationSurfaceTypes` (`Animation_Data.h:75-500`).
  - The `M(name, …)` macro **ignores `name`** (`Animation_Data.cc:36`); only a row's position counts.
  - Two rows carry the wrong label: slot 61 `RGMNPUNCH` is written `RGMPUNCH` (file `k_punch.sti`), and slot 100
    `BGMCROUCHAIM` is written `RGMCROUCHAIM` (file `m_cr_aim.sti`) **(data, parsed)**.
  - `RGMTHROW` points to `s_lob.sti` and `RGMLOB` to `s_throw.sti` (`:78-79`).
- **File path.** `ANIMSDIR "/s_merc/s_r_std.sti"` etc. In our VFS this is `anims/s_merc/s_r_std.sti`.
- **`bStructDataType`.** One of `S_STRUCT, C_STRUCT, P_STRUCT, F_STRUCT, FB_STRUCT, DEFAULT_STRUCT` (indices 0–5) or
  `NO_STRUCT = 120` (`Animation_Data.h:503-513`). It selects the collision structure file (§1.5).
- **`ubFlags`.** Only `ANIM_DATA_FLAG_NOFRAMES` exists (`:19`). The vehicle rotation sheets use it: the frame is the
  direction alone (§1.3).
- **`ubNumDirections`** **(data, parsed)**:

  | Directions | Rows |
  |---|---|
  | 8 | 354 |
  | 1 | 16: helidrop, burn, queen, body explode |
  | 4 | 15: climb roof, fall, fall forward, hop fence, kick door |
  | 32 | 6: vehicle "basic" and tank ready |
  | 2 | 4: vehicle wrecks |
  | 3 | 1: `s_mclimb` |

- **`bProfile`.** 0 for `RGMPRONE`, `BGMPRONE` and `RGFPRONE`; −1 everywhere else. It indexes `ja2prof.dat` hit-location
  profiles (§1.5).
- **`usNumFramesPerDir`** is not in the table (`TO_INIT = 0`, `:21`). `LoadAnimationSurface` sets it from the STI
  auxiliary data of sub-image 0, `AuxObjectData.ubNumberOfFrames`. The app-data size must equal
  `subImageCount × 16` (`:680-687`). If `dirs × framesPerDir ≠ subImageCount` it only logs a warning (`:710-713`).

**(data)** Frames per direction (= `aux.numberOfFrames`). Every listed file has exactly `dirs × fpd` sub-images:

| STI | fpd | STI | fpd | STI | fpd |
|---|---|---|---|---|---|
| `s_r_std`, `s_n_std`, `s_p_brth` | 8 | `s_r_walk`, `s_n_walk`, `s_i_wk_n/r` | 12 | `s_r_run`, `s_n_run` | 12 |
| `s_r_swat`, `s_n_swat` | 22 | `s_r_c`, `s_n_crch` | 15 | `s_r_prn`, `s_n_prne` | 29 |
| `m_breth2`, `m_r_std`, `m_n_std`, `m_p_brth` | 8 | `m_walk2`, `m_r_walk`, `m_n_walk` | 12 | `m_r_run`, `m_r_run2`, `m_n_run` | 12 |
| `m_r_swat` | 22 | `m_r_c` | 15 | `m_c_tran` | 5 |
| `f_breth2`, `n_breth2`, `f_p_brth` | 8 | `f_r_walk`, `f_n_walk`, `f_r_run`, `f_n_run` | 12 | `f_r_swat` / `f_r_c` / `f_r_prn` | 22 / 15 / 29 |
| `s_climb` | 44 (4 dirs) | `s_mclimb` | 60 (3 dirs) | `s_helidrp` | 70 (1 dir) |
| civilians `*_breath`/`*_brth`/`cp_breth` | 8 | civilians `*_walk`, `*_run` | 12 | `m_cower` | 12 |

### 1.2 From (body type, state) to a surface

`DetermineSoldierAnimationSurface` (`Animation_Control.cc:2598-2821`):

```
state   = SubstituteBodyTypeAnimation(s, state)                 :2414-2490
          (queen/larvae/crow/bloodcat/adult creature/robot remaps; for civ bodies KNEEL_DOWN→START_COWER,
           KNEEL_UP→END_COWER, sleep states→STANDING)
surface = gubAnimSurfaceIndex[body][state]                      :2608
          INVALID_ANIMATION → mark FOUND_INVALID_ANIMATION, return INVALID_ANIMATION_SURFACE (32000)  :2611-2622
if surface == QUEENMONSTERSPIT_SW: pick per direction (gusQueenMonsterSpitAnimPerDir)              :2629-2638
if body > REGFEMALE: return surface          ← civilians, animals, monsters, vehicles stop here     :2642-2645
big guy:  BGMSTANDAIM2→BGMSTANDAIM if SUB_ANIM_BIGGUYSHOOT2                                         :2648-2654
          BGMSTANDING→BGMTHREATENSTAND, BGMWALKING→BGMWALK2, BGMRUNNING→BGMRUN2, BGMRAISE→BGMRAISE2
          if SUB_ANIM_BIGGUYTHREATENSTANCE                                                           :2656-2687
if in water: surface = MidWaterSub[body][state][hand] if valid; hand = 0 for a two-handed gun or
             launcher (not ROCKET_LAUNCHER), else 1                                                  :2693-2721
else (item in HANDPOS):
  not a gun/launcher, or ROCKET_LAUNCHER ("nothing"):
       STANDING → gusNothingBreath[body]; other states → ItemSub[body][state] if valid               :2727-2746
  one-handed gun/launcher ("pistol"): ItemSub[body][state] if valid;                                 :2754-2762
       STANDING with a one-handed gun also in SECONDHANDPOS → *DBLBREATH                              :2764-2775
  two-handed gun/launcher ("rifle"): keep the base surface
  life < 30 (INJURED_CHANGE_THREASHOLD) and state == WALKING:
       adjusted for item → *HURTWALKINGN, else → *HURTWALKINGR                                       :2792-2815
```

- `gubAnimSurfaceIndex`, `gubAnimSurfaceItemSubIndex` and `gubAnimSurfaceMidWaterSubIndex` are filled in code by
  `InitAnimationSurfacesPerBodytype` (`:448-2398`). Unset entries are `INVALID_ANIMATION`.
- **The flag is always on for big males.** Every `BIGMALE` soldier gets `SUB_ANIM_BIGGUYTHREATENSTANCE` at creation
  (`Soldier_Create.cc:287-291`; vanilla does the same, `vanilla:Tactical/SoldierCreate.c:326-327`). So a big male with
  a rifle stands in `m_breth2`, walks in `m_walk2` and runs in `m_r_run`. `m_r_std`, `m_r_walk` and `m_r_run2` are
  effectively unused **(inferred)**. Profile flag `SUB_ANIM_BIGGUYSHOOT2` (0x1) is set on Grizzly and Steroid **(data)**.
- **The surface is not a function of (body, state) alone.** It also depends on the hand item, on life < 30, on water
  and on the sub-flags. The renderer key should be `(surfaceId, frame)`, with `surfaceId` computed by the content
  layer **(inferred)**.
- **Where the sim depends on it.** `IsAnimationValidForBodyType` = "surface != INVALID" gates every new state
  (`Soldier_Control.cc:1124`, `Animation_Control.cc:2408-2411`). The surface's struct type selects the collision shape
  (§1.5). Both must come from the tables, never from file presence (§1.4).

### 1.3 Frame index inside the STI

- **Script values.** `gusAnimInst[320][100]` is `ja2bin.dat` read raw (`Animation_Control.cc:2401-2405`;
  `Animation_Control.h:8-9`). In `AdjustToNextAnimationFrame` a value `< 399` is a **1-based** frame number:
  `ConvertAniCodeToAniFrame(s, value − 1)`, then `usAniCode++`, and the frame is shown (`Soldier_Ani.cc:150-180`).
  Values 501–598 jump to slot `value − 501` (`:1939-1944`). 600–699 switch to state `value − 600`, and 800–999 to
  state `value − 700` (`:1945-1962`). See `03` §1 for the rest.
- **`ConvertAniCodeToAniFrame`** (`Soldier_Control.cc:4155-4212`):

```
d = OneCDirection(bDirection) = (bDirection + 1) % 8                         Isometric_Utils.h:25
switch (ubNumDirections):  1 → d = 0;  4 → d = d / 2;  32 → d = (ubHiResDirection + 4) % 32;
                           2 → d = {0,0,1,1,0,1,1,0}[bDirection];  3 → NW:1, W:0, E:2 (others keep d)
if ubFlags & NOFRAMES: f = 0
usAniFrame = f + usNumFramesPerDir · d;   if ≥ subImageCount → 0 (warning)
```

- **Screen meaning of the sprite direction blocks (inferred from `05` §1.1 geometry):**

  | World dir | N | NE | E | SE | S | SW | W | NW |
  |---|---|---|---|---|---|---|---|---|
  | 8-dir block | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 0 |
  | Screen | up-right | right | down-right | down | down-left | left | up-left | up |
  | 4-dir block | 0 | 1 | 1 | 2 | 2 | 3 | 3 | 0 |

  Blocks run clockwise from "screen up". 4-direction sheets therefore hold N, E, S, W; the climbs and hops that use
  them face cardinal directions.
- **When the frame is recomputed.**
  - When a frame code executes.
  - In `EVENT_InitNewSoldierAnim`, which first sets frame 0 (`:1731`) and then runs `AdjustToNextAnimationFrame`
    once (`:1740`).
  - **A direction change alone does not recompute `usAniFrame`** **(inferred)**: `EVENT_SetSoldierDirection`,
    `:3959-3994`, doesn't call it. The new facing shows on the next frame code, so the renderer should derive the
    frame from `(script frame, current direction)` rather than cache `usAniFrame`. This is a ≤1-frame visual
    deviation that we should accept and document **(inferred)**.

### 1.4 Loading and caching (`usAnimSurface`)

- **What the original does.**
  - `SetSoldierAnimationSurface` → `LoadSoldierAnimationSurface` → `s.AnimCache.cache(surface)` (`:2538-2582`).
  - Each soldier has a 3-slot cache; the least-hit slot is evicted, but never the current surface
    (`Animation_Cache.cc:19-93`, `Animation_Cache.h:6`).
  - Surfaces are global and reference-counted per soldier (`Animation_Data.cc:654-766`).
  - The renderer skips a soldier whose surface isn't loaded (`GetSoldierAnimationSurface`, `:2824-2842`;
    `RenderWorld.cc:941-942`).
- **A load failure changes the simulation.** It returns `INVALID_ANIMATION_SURFACE`, and `EVENT_InitNewSoldierAnim`
  then returns without changing state (`Soldier_Control.cc:1656-1659`). In ja2-node the sim must use only the tables;
  loading STIs is a client concern, with any LRU **(inferred)**.
- **Z-strips.** On first load the surface gets z-strip info if its structure file is multi-tile; prone is
  (`Animation_Data.cc:689-704`; §4.4).

### 1.5 Structure and profile files

- **Collision structure.** It comes from `gAnimStructureDatabase[body][bStructDataType]` (`Animation_Data.cc:491-521`):
  `M_STAND`, `M_CROUCH`, `M_PRONE`, `M_FALL`, `M_FALLBACK`, `M_CROUCH` for the four merc bodies and the four adult
  civilian bodies; `K_STAND`/`K_CROUCH`/`M_PRONE` for kids; and so on. Files are `anims/structdata/*.jsd`.
- **Standing shape for some falls.** `FALLFORWARD_FROMHIT_STAND`, `GENERIC_HIT_STAND`, `FALLFORWARD_FROMHIT_CROUCH`
  and `STANDING_BURST_HIT` use the standing shape (`:631-641`).
- **Per direction.** The structure index is `OneCDirection(bDirection)` (`WorldMan.cc:1076-1079`).
  `SOLDIER_MULTITILE` is set when that structure has more than one tile (`:1089`).
- **(data)** `m_stand.jsd` and `m_crouch.jsd` have 8 one-tile structures. `m_prone.jsd` has 2–3 tiles per direction,
  so **prone and crawling soldiers are `SOLDIER_MULTITILE`**.
- **Prone fix.** Stracciatella makes the non-base prone tiles passable for the four merc bodies (#2116,
  `Animation_Data.cc:555-571`).
- **Turning checks the structure.** `TurnSoldier` only turns if `OKToAddMercToWorld(newDir)` (`Soldier_Control.cc:4457`),
  so prone turns can be blocked by walls. This is sim-relevant.
- **`ja2prof.dat`** (`LoadAnimationProfiles`, `Animation_Data.cc:780-815`):
  - Format: `u8 count`; then per profile and per each of 8 directions: `u8 nTiles`, then `nTiles × {u16 flags, i8 dx,
    i8 dy}`.
  - `HandleAnimationProfile` adds placeholder merc nodes (`LEVELNODE_MERCPLACEHOLDER`) with hit-location flags at
    `sGridNo + dy·160 + dx`, indexed by **`bDirection`, not OneC** (`Soldier_Control.cc:6519-6552`).
  - The renderer skips placeholders (`RenderWorld.cc:935`). Only bullets care (M3+).

### 1.6 Random idle animations (`gRandomAnimDefs`)

- **When.** Opcode 491 sits at the end of the `STANDING` loop. Every `TIME_FOR_RANDOM_ANIM_CHECK` passes it rolls
  `Random(100)` and picks from `gRandomAnimDefs[body]` by hand item (rifle / nothing / irrelevant; one-handed guns
  never), flags (casual: player team only, out of combat; injured; drunk), end height and roll range
  (`Soldier_Ani.cc:1384-1500`; tables `Animation_Control.cc:720-761` etc.).
- **What we do.** Per `04` §3 this is client-only on its own RNG stream. The first sandbox can omit it.

---

## 2. Body types and the basic-state files

### 2.1 `SoldierBodyType` (`Animation_Data.h:31-67`)

| Id | Body | Id | Body | Id | Body | Id | Body |
|---|---|---|---|---|---|---|---|
| 0 | REGMALE | 7 | YAM_MONSTER | 14 | DRESSCIV | 21 | ROBOTNOWEAPON |
| 1 | BIGMALE | 8 | LARVAE_MONSTER | 15 | HATKIDCIV | 22 | HUMVEE |
| 2 | STOCKYMALE | 9 | INFANT_MONSTER | 16 | KIDCIV | 23 | TANK_NW |
| 3 | REGFEMALE | 10 | QUEENMONSTER | 17 | CRIPPLECIV | 24 | TANK_NE |
| 4 | ADULTFEMALEMONSTER | 11 | FATCIV | 18 | COW | 25 | ELDORADO |
| 5 | AM_MONSTER | 12 | MANCIV | 19 | CROW | 26 | ICECREAMTRUCK |
| 6 | YAF_MONSTER | 13 | MINICIV | 20 | BLOODCAT | 27 | JEEP (`TOTALBODYTYPES` = 28) |

- **Body groups.** `IS_MERC_BODY_TYPE` = body ≤ 3. `IS_CIV_BODY_TYPE` = 11..17 (`:26-27`). `BODY_RANDOM = −1`.
- **STOCKYMALE is REGMALE in disguise.**
  - Its surfaces (`s_merc`), item subs, speeds (`Animation_Control.cc:351-425`) and palettes are identical to
    REGMALE's. Only 5 rare state entries are missing (diff of the two blocks, `:470-829` vs `:1194-1447`).
  - Other code treats it differently only in a few places (AP table `Soldier_Control.cc:293`, civ quotes).
  - **(data)** No `prof.dat` profile uses body 2. Histogram: REGMALE 81, BIGMALE 16, REGFEMALE 17, FATCIV 3,
    MANCIV 35, MINICIV 5, DRESSCIV 6, KIDCIV 1, CRIPPLECIV 2, ROBOT 1, HUMVEE/ELDORADO/ICECREAMTRUCK 1 each.

### 2.2 Merc bodies (0–3): surfaces for the first states

Surface id is in brackets. **R** = two-handed gun, **P** = one-handed gun, **N** = nothing, a non-gun or the rocket
launcher. P and N differ only in `STANDING`. Sources: `Animation_Control.cc:470-487, 764-802` (REGMALE),
`:832-848, 999-1000, 1045-1082` (BIGMALE), `:1194-1210, 1410-1447` (STOCKYMALE), `:1553-1569, 1762-1799` (REGFEMALE),
and the selection rules in §1.2.

| State(s) | REGMALE / STOCKYMALE (`s_merc/`) | BIGMALE (`m_merc/`, threaten flag on) | REGFEMALE (`f_merc/`) |
|---|---|---|---|
| STANDING | R `s_r_std` [1] · P `s_p_brth` [73] · N `s_n_std` [20] | R `m_breth2` [152] · P `m_p_brth` [161] · N `m_n_std` [110] | R `f_breth2` [183] · P `f_p_brth` [251] · N `n_breth2` [202] |
| WALKING, WALK_BACKWARDS | R `s_r_walk` [0] · P/N `s_n_walk` [21] | R `m_walk2` [171] · P/N `m_n_walk` [111] | R `f_r_walk` [182] · P/N `f_n_walk` [203] |
| WALKING at life < 30 | R `s_i_wk_r` [69] · P/N `s_i_wk_n` [68] | `m_i_wk_r` / `m_i_wk_n` | `f_i_wk_r` / `f_i_wk_n` |
| RUNNING | R `s_r_run` [4] · P/N `s_n_run` [22] | R `m_r_run` [172] · P/N `m_n_run` [112] | R `f_r_run` [186] · P/N `f_n_run` [204] |
| SWATTING, START_SWAT, END_SWAT, SWAT_BACKWARDS | R `s_r_swat` [3] · P/N `s_n_swat` [23] | R `m_r_swat` [93] · P/N `m_n_swat` [113] | R `f_r_swat` [185] · P/N `f_n_swat` [205] |
| CROUCHING, KNEEL_DOWN, KNEEL_UP | R `s_r_c` [2] · P/N `s_n_crch` [24] | R `m_r_c` [92] · P/N `m_n_crch` [114]; with a rifle KNEEL_DOWN/UP become `BIGMERC_CROUCH_TRANS_INTO/OUTOF` = `m_c_tran` [174] (`Soldier_Control.cc:1127-1142`) | R `f_r_c` [184] · P/N `f_n_crch` [206] |
| PRONE, CRAWLING, PRONE_DOWN, PRONE_UP | R `s_r_prn` [5] · P/N `s_n_prne` [27] | R `m_r_prn` [95] · P/N `m_n_prne` [117] | R `f_r_prn` [187] · P/N `f_n_prne` [209] |
| Turning | no own state: the current state's frames, with the direction stepping (§5.4) | | |

`IsRifle()` decides the big-merc kneel transition; the gun class (two-handed) decides the surface.

### 2.3 Script frame ranges (state-level, shared by all bodies) — **(data)**, `Ja2bin.dat` decoded

| State (id) | Script | gAnimControl speed |
|---|---|---|
| WALKING (0) | f0–f11, loop | 0 → computed |
| WALK_BACKWARDS (230) | f11→f0, loop | 110 |
| STANDING (1) | f0→f7→f0, 491, loop | 0 → computed |
| RUNNING (6) | f0–f11, loop | 0 |
| START_SWAT (15) | f0–f4 → SWATTING; moving 1.3/frame | 40 |
| SWATTING (5) | f4–f15, loop | 0 |
| END_SWAT (16) | f17–f21, 499 | 40 |
| KNEEL_DOWN (2) / KNEEL_UP (4) | f0–f4 / f4–f0, 499 | 90 |
| CROUCHING (3) | f5→f14→f5, loop | 0 |
| PRONE_DOWN (7) / PRONE_UP (9) | f0–f4 / f4–f0, 499 | 100 |
| CRAWLING (8) | f5–f16, loop | 0 |
| PRONE (10) | f20→f24→f20, loop | 0 |
| BIGMERC_CROUCH_TRANS_INTO/OUTOF (239/240) | f0–f4 / f4–f0, 499 | 90 |
| END_HURT_WALKING (277) | f4–f0, 499 | 80 |
| civ START_COWER / COWERING / END_COWER (221–223) | f0–f4, 442 → COWERING / f4→f11→f4, loop / f4–f0, 442, 499 | 80 |

- **Visual codes inside these scripts.** 703/704 footstep sound (`Soldier_Ani.cc:1972-1976`); 713 infant monster step;
  750/751 vehicle bounce (no-op for people, `:2201`); 773–776 stance sounds (`:2421-2452`).
- **What 499 does.** It goes to the stationary state of the end height, or chains the next stance step toward
  `ubDesiredHeight`, or starts the pending animation (`Soldier_Ani.cc:1732-1932`). `SoldierGotoStationaryStance`
  maps stand/crouch/prone → `STANDING`/`CROUCHING`/`PRONE` (`Soldier_Control.cc:3612-3678`).
- **Unused trailing value.** Every 499 is followed by a raw `999`, which is never reached.

### 2.4 Civilians (11–17)

They have only `STANDING`, `WALKING` and `RUNNING`, plus the cower set, hits, deaths and "act". There are no
crouch/swat/prone surfaces (`Animation_Control.cc:2027-2245`), and no hand-item variants (§1.2 returns early).

| Body | STANDING | WALKING | RUNNING | KNEEL_DOWN→START_COWER |
|---|---|---|---|---|
| FATCIV | `civs/ft_brth` | `ft_walk` | `ft_run` | `ft_cower` |
| MANCIV | `m_breath` | `m_walk` | `m_run` | `m_cower` |
| MINICIV | `mi_breath` | `mi_walk` | `mi_run` | `mi_cower` |
| DRESSCIV | `ds_breath` | `ds_walk` | `ds_run` | `ds_cower` |
| HATKIDCIV | `h_breath` | `h_walk` | `h_run` | `h_cower` |
| KIDCIV | `k_breath` | `k_walk` | `k_run` | `k_cower` |
| CRIPPLECIV | `cp_breth` | `cp_walk` | `cp_run` | — (no cower) |

- **(data)** All are 8 directions with 8/12/12 frames per direction. `cp_walk`/`cp_run` contain no shadow pixels.
- Enemies, militia and player mercs only use bodies 0–3. Bodies 11–17 appear for civilians and NPC profiles.

---

## 3. Soldier palettes

### 3.1 Composition (`CreateSoldierPalettes`, `Soldier_Control.cc:4638-4741`)

1. `GetBodyTypePaletteSubstitution(s, body)` (`Animation_Control.cc:2493-2534`):
   - **Bodies 0–3:**
     - while burning or exploding → `""`, meaning "use the current surface's own palette";
     - with `bCamo ≠ 0` → `anims/camo.COL`;
     - otherwise none.
   - **Creatures:** a fixed `.COL` (`fm_brite`, `mn_brite`, `femmon`, `monster`).
   - **Queen, animals, vehicles and the robot:** `""`.
   - **Civilian bodies:** none.
2. **No substitution.** Copy the 256-colour palette of the soldier's **`STANDING` surface**
   (`LoadSoldierAnimationSurface(s, STANDING)`, which is hand-item dependent per §1.2). Then apply `HeadPal`,
   `VestPal`, `PantsPal` and `SkinPal`, in that order (`:4652-4667`).
3. **`.COL` file.** 8-byte header + 768 bytes RGB (`Utilities.cc:19-39`).
4. **`SetPaletteReplacement`** (`:5026-5043`):
   - Look up the ID with an exact, case-sensitive compare (`:5078-5087`). An unknown or empty ID does nothing.
   - Copy `rgb[i − start]` over palette entries `start..end` of the replacement's sub-range.
5. **`ja2pal.dat`** (`LoadPaletteData`, `:4966-5023`) is already parsed by `src/content/formats/ja2pal.ts`.
   **(data)** Sub-ranges, with IDs exactly as they appear:

   | Range | Entries | IDs |
   |---|---|---|
   | 0 hair | 245–250 | `BLONDHEAD BROWNHEAD BLACKHEAD WHITEHEAD REDHEAD redbrown dirtblnde` |
   | 1 pants | 205–219 | `GREENPANTS JEANPANTS TANPANTS BLACKPANTS BLUEPANTS BEIGEPANTS` |
   | 2 skin | 235–244 | `PINKSKIN TANSKIN DARKSKIN BLACKSKIN` |
   | 3 vest | 220–234 | `BROWNVEST greyVEST GREENVEST JEANVEST REDVEST BLUEVEST YELLOWVEST WHITEVEST BLACKSHIRT GYELLOWSHIRT PURPLESHIRT` |

- **(data) One palette fits all of a soldier's sheets.**
  - The STI palettes of different sheets differ at entries 0, 45–83 and 254.
  - But the merc and civilian sprites only use entries 1–10 (prone), 173–203, 205–250 and 254. Among the used
    entries, the sheets differ only at 254, the shadow marker, which is never looked up.
  - So the single "STANDING palette" is correct for every sheet a soldier uses.
- **When it is rebuilt.** At creation (`CreateSoldierCommon`, `:618`), on camo change and on hand-item reload, and for
  the burn/explode/vehicle-die states (`:1746-1749`).

### 3.2 Where the four names come from

| Soldier kind | HAIR / SKIN | VEST / PANTS | Source |
|---|---|---|---|
| Profile (merc, NPC, RPC) | profile `HAIR`, `SKIN` | profile `VEST`, `PANTS`; empty → `WHITEVEST` / `BLACKPANTS` (Stracciatella) | `Soldier_Create.cc:490-493`; `Soldier_Profile.cc:158-159` |
| Enemy ADMINISTRATOR | random | `YELLOWVEST` / `GREENPANTS` | `Soldier_Create.cc:681-685` |
| Enemy ELITE | random | `BLACKSHIRT` / `BLACKPANTS` | `:686-690` |
| Enemy ARMY | random | `REDVEST` / `GREENPANTS` | `:691-695` |
| Militia GREEN / REG / ELITE | random | `GREENVEST` / `JEANVEST` / `BLUEVEST`, all with `BEIGEPANTS` | `:696-710` |
| MINER | random | `greyVEST` / `BEIGEPANTS` | `:711-715` |
| Civilian, class NONE, no pants or vest given | random | random scheme, below | `:722-798` |
| Detailed placement with `fVisible` | **re-rolled** (see below) | kept from the placement, unless the class forces them | `:831-837, 907` |

**`GeneratePaletteForSoldier`** (`Soldier_Create.cc:637-799`; vanilla identical, `vanilla:Tactical/SoldierCreate.c:673-703`).
It uses the shared `Random`:
- **Skin.** `Random(4)` → PINK, TAN, DARK or BLACK.
- **Hair** (`ChooseHairColor`, `:544-634`), with roll `r = Random(100)`:
  - **Pink or tan skin:** r < 12 red, < 34 blond, < 60 brown, < 92 black, else white.
  - **Dark skin:** < 35 brown, < 84 black, else white.
  - **Black skin:** < 84 black, else white.
  - **Women and children don't get white hair.** For REGFEMALE, MINICIV, DRESSCIV, HATKIDCIV and KIDCIV it is
    re-rolled: pink/tan → `Random(4) + 1`; dark → `Random(2) + 1`; black → BLACK.
  - **CRIPPLECIV:** an extra `Chance(50)` → WHITE.
  - The hair enum is `WHITE, BLACK, BROWN, BLONDE, RED` (0–4, `:536-541`). BLONDE maps to the ID `BLONDHEAD`.
- **Forced classes** set vest and pants and return.
- **Otherwise**, only if pants or vest is empty:
  - **Civilians, 40% of the time, "cheesy" colours.** 30% `GYELLOWSHIRT` with pants `Random(3)` from
    TAN/BEIGE/GREEN; 70% `JEANPANTS` with vest `Random(7)` from WHITE, BLACKSHIRT, PURPLESHIRT, BLUE, BROWN, JEAN, RED.
  - **Otherwise, "merc" colours, `Random(3)`:**
    - GREENPANTS with a vest from {YELLOW, WHITE, BROWN, GREEN};
    - TANPANTS with a vest from {YELLOW, WHITE, BLACKSHIRT, BLUE, BROWN, GREEN, JEAN, RED};
    - BLUEPANTS with a vest from {YELLOW, WHITE, RED, BLACKSHIRT}.
- **Quirk (fact, both codebases).** Skin and hair are always re-rolled, even for `fVisible` placements whose names were
  just copied.

### 3.3 Shade tables built per soldier (`:4705-4740`)

`NUM_SOLDIER_SHADES = 48` (`Overhead_Types.h:85`):

| Slots | Build | Use |
|---|---|---|
| `pShades[0..15]` | `CreateBiasedShadedPalettes`: add the light colour (usually black), then the `gusShadeLevels` table; slot 0 mono 500 (`Lighting.cc:2007-2038`). Same formula as tiles, `05` §6.4 | normal lit rendering |
| `pShades[20]`, `[21..29]` | plain `×255/256` (`Create16BPPPaletteShaded(pal,255,255,255,FALSE)`, `HImage.cc:96-127`), then `CreateEnemyGlow(gOrangeGlowR[k], gOrangeGlowG[k])` | glowing enemy on a roof |
| `pShades[30]`, `[31..38]`, `[39]` | mono `(100,100,100)`, then `CreateEnemyGreyGlow` with orange values; `[39]` reuses entry 18 | unseen enemy on a roof |
| `pGlowShades[0]`, `[1..9]` | plain `×255/256`, then `CreateEnemyGlow(gRedGlowR[i], 0)` | glowing enemy on the ground |
| `pGlowShades[10]`, `[11..18]`, `[19]` | mono `(100,100,100)`, then grey glow; `[19]` uses `gRedGlowR[18]` = 200, not 225 | unseen enemy on the ground |
| `effect_shade` | mono `(100,100,100)` | other enemies while one is highlighted |

- **Glow ramps.** `gRedGlowR` = `0,25,…,225` twice (`:4499-4523`). `gOrangeGlowR` is the same; `gOrangeGlowG` =
  `0,20,…,180` twice (`:4553-4631`).
- **`CreateEnemyGlow16BPPPalette`** (`:7477-7491`): `r = max(rscale, R)`, `g = max(gscale, G)`, `b = B`. There is no
  scaling.
- **`CreateEnemyGreyGlow16BPPPalette`** (`:7494-7516`):
  `lum = (299R + 587G + 114B)/1000; c = 100·lum/256; r = max(rscale, c), g = max(gscale, c), b = c`.
- All tables go through `Get16BPPColor` (RGB565; `05` §6.4).

### 3.4 Which table a drawn soldier uses (`RenderWorld.cc:944-1039, 1081-1084`)

- **Default.** `shade = max((node.ubShadeLevel & 15) − 2, DEFAULT_SHADE_LEVEL = 4) | (node.ubShadeLevel & 0x30)`
  (`:952-954`; `WorldDef.h:33`).
  - A soldier is never darker than two levels brighter than his tile, nor brighter than normal.
  - New merc nodes start at the ambient level (`WorldMan.cc:29-30`); light sprites add to that.
  - The `0x30` bits never occur in Stracciatella, because the lighting code clamps the level to `0..15`
    (`Lighting.cc:546-549`) **(inferred)**.
- **Fading.** With `fBeginFade`, `shade = ubFadeLevel`.
- **Enemies glow.** This applies to enemies (`!bNeutral && bSide != FRIENDLY`) while it is the player's team's turn
  (`ubCurrentTeam == OUR_TEAM`) or while the soldier is under AI control. In realtime that is always **(inferred)**.
  - **Table.** `table = (bLevel == 0 ? pGlowShades : pShades + 20)[gsGlowFrames[g] + off]`.
  - **Offset.** `off = 10` if `bLastRenderVisibleValue == 0` or the selected merc doesn't currently see him, else 0.
  - **Glow cycle.** `gsGlowFrames` = 20 × `0`, then `2,4,6,8,9,8,6,4,2,0` (`:135-140`). `g` advances every 100 ms
    (`GLOW_ENEMYS`, `Timer_Control.cc:27`, `Timer_Control.h:29`; `RenderWorld.cc:1605-1610`). So there is a 3 s cycle
    with a 1 s red pulse.
  - **Effects.** Enemies ignore scene lighting. When `gsGlowFrames[g] ≥ 7`, or when the enemy is the hovered
    `gSelectedGuy`, `z = TOPMOST` (`:1013-1014, 1031-1035`).
- **Forced shade.** `fForceShade` (opcodes 431/438/439) overrides with `pForcedShade` (`:1081-1084`).
- **Hidden soldiers.** A soldier with `bLastRenderVisibleValue == −1` isn't drawn unless `SHOW_ALL_MERCS` (`:938`).

---

## 4. Shadows, screen position and z

### 4.1 Shadows

- **There are no separate shadow surfaces for people.** The shadow is drawn inside every frame with palette index
  **254**. The merc blitters replace the destination with `ShadeTable[dst]` for those pixels and use the shade
  palette for all other pixels.
  - Sources: `VObject_Blitters.cc:611-644, 746-845` (line 830); obscured variant `:658-732`.
  - `ShadeTable` = ×`guiShadePercent` = 0.48 (`Shading.cc:20-35`; `05` §4).
- **What it ignores.** The shadow ignores the soldier's lighting, glow and palette.
- **(data)** Index 254 makes up 13–27% of the opaque pixels in merc and civilian sheets, e.g. `s_r_std` 6464/37048.
  Its palette colour varies by file (0,255,0 / 0,186,0 / 0,255,255) and is never used.
- **Crows** have a separate shadow tile (`HandleCrowShadowNewPosition`, `Soldier_Control.cc:1823`). That is out of
  scope.

### 4.2 Screen position (`RenderWorld.cc:958-975, 1110`)

```
dOffX = dXPos − gsRenderCenterX ; dOffY = dYPos − gsRenderCenterY             (float)
sx = cx + (INT16)(2·dOffX − 2·dOffY)        FloatFromCellToScreenCoordinates, Isometric_Utils.cc:129-138
sy = cy + (INT16)(dOffX + dOffY) − sTileHeight
sx −= gsRenderWorldOffsetX (0) ; sy −= gsRenderWorldOffsetY (10)             RenderWorld.cc:202-203
sy −= sHeightAdjustment ; sy += gsRenderHeight
blit frame at (sx + sOffsetX, sy + sOffsetY)                                 (05 §1.5, "Frame offset")
```

- `cx`, `cy` are `g_ui.m_tacticalMapCenterX/Y` (`05` §0). `(INT16)` truncates toward zero, not floor; compute in
  float32 **(inferred)**.
- **`sTileHeight`** is `me.sHeight` of the tile whose merc list holds the node (`:460`), i.e. `sGridNo`.
- **`sHeightAdjustment`** is `(INT16)dHeightAdjustment`. It is 0 on the ground and `SECOND_LEVEL_Z_OFFSET = 58` on a
  roof (`WorldDef.h:99`; `Soldier_Control.cc:1864-1878`; `Soldier_Create.cc:448-451`).
- **(data)** Frame offsets put the feet near the anchor: `s_r_std` frame 0 is 24×48 at (−14,−40), `m_breth2` 27×52 at
  (−15,−44), `f_breth2` 26×46 at (−16,−39), `m_breath` 26×48 at (−17,−42).

### 4.3 Z level (`RenderWorld.cc:1041-1079, 1089-1098`)

`wy = GetMapXYWorldY(X, Y)` of the node's tile (`05` §3.1). The node lives on `sGridNo`, which switches to the next
tile at the half-step (§5.3), so z jumps there.

| Case | sZLevel | Restriction 0 |
|---|---|---|
| normal | `8·wy + 3` (`MERC_Z_LEVEL`) | `80(X+Y) − 6677` |
| `dHeightAdjustment > 0` (roof) | `8·(wy + 50 + 20) + 6` (`ONROOF_Z_LEVEL`) | `80(X+Y) − 6114` |
| `SOLDIER_MULTITILE` | `wy` taken at `(X + bZTileOffsetX, Y + bZTileOffsetY)` of the current structure, then as above | — |
| vehicle | `8·wy + 4` | — |
| `gsForceSoldierZLevel` (glow peak, hovered enemy) | `32767` | — |
| `sZLevelOverride ≠ −1` (opcodes 451/452; reset on every new state, `Soldier_Control.cc:1669`) | override | — |
| tile has `MAPELEMENT_EXT_NOBURN_STRUCT` | `+2`, and the non-obscured blitter | — |

- **Precedence.** Rows are checked top to bottom: vehicle, then forced, then override, then roof (`:1058-1078`).
- **When `NOBURN` is set.** When the struct added to the tail of the tile list is single-tile and is not a wall, or
  when the struct added to the head is single-tile **and** a wall. The two cases disagree; this is `TODO0015`
  (`WorldMan.cc:557-569, 614-626`).

**Blit rules.** Mercs are in the dynamic layers. `RenderFX`: dynamic, no z-write, z-blit, `fMerc`
(`RenderWorld.cc:313-317`). The layer is chosen per row (`05` §2.5; `:895-930`):
- `DYN_MERCS` for `bLevel == 0`, not multi-tile;
- `DYN_HIGHMERCS` for `bLevel > 0`;
- `DYN_STRUCT_MERCS` for multi-tile soldiers (any level), and for `bLevel > 0` non-multi-tile ones. A soldier on a
  roof is therefore drawn twice, in `DYN_STRUCT_MERCS` and in `DYN_HIGHMERCS`, both times with the roof z
  **(inferred)**.

| Blitter | Pixel 254 | Other pixels | z write |
|---|---|---|---|
| `TransShadowZNB` (`NOBURN` tiles) | `zbuf < z` → shade | `zbuf < z` → palette | no |
| `TransShadowZNBObscured` (default) | `zbuf < z` → shade | `zbuf <= z`, **or** `(x+y)` even (checkerboard through walls) | no |

- References: `VObject_Blitters.cc:825-831, 706-719`; `RenderWorld.cc:1388-1406`.
- The checkerboard parity assumes a 4-byte-aligned frame buffer (`05` §3.3) **(inferred)**.

### 4.4 Multi-tile soldiers (prone, crawling, creatures, vehicles)

- **Blitter.** `DYN_STRUCT_MERCS` uses `BltTransZTransShadowInc[Obscure]` with strip index `OneCDirection(dir)` (queen:
  0). It tests `zbuf <= zstrip`, **writes z**, and shades pixel 254 (`RenderWorld.cc:911-928, 1245-1258, 2835-3020`).
- **Strips.** They come from `AddZStripInfoToVObject(vo, structFile, fromAnimation = TRUE, start)`
  (`Structure.cc:1453-1600`; algorithm in `05` §3.4).
  - One `ZStripInfo` per structure (direction), computed from frame `start + k·(subImages/8)`.
  - `start = 5` for `RGMPRONE`, −1 (one direction) for the queen, and 0 otherwise — including `BGMPRONE`, `RGFPRONE`
    and the handgun prone sheets (`Animation_Data.cc:693-703`).
  - It is then applied to every frame of that direction **(inferred quirk)**.
- **(data)** `m_prone.jsd` z-tile offset is (0,1) for structure indices 5–7, i.e. world directions S, SW and W.
- **First sandbox.** Standing and walking don't need any of this. Crawling may first use the plain merc z as a
  documented deviation **(inferred)**.

---

## 5. Movement and timing per frame

### 5.1 `gAnimControl` columns (`Animation_Control.h:79-87`; table `Animation_Control.cc:34-348`)

`{zAnimStr, dMovementChange, uiFlags, sSpeed (ms per frame; 0 = computed), ubHeight, ubEndHeight}`. Heights:
`ANIM_STAND 6`, `ANIM_CROUCH 3`, `ANIM_PRONE 1` (`.h:69-74`). Flags at `.h:35-65`.

| State | Move | Key flags | Speed | H → End |
|---|---|---|---|---|
| WALKING (`:37`) | 1.6 (but see §5.3) | MOVING, TURNING, NORESTART, RAISE_WEAPON, VARIABLE_EFFORT | 0 | 6→6 |
| STANDING (`:38`) | 0 | STATIONARY, TURNING, FASTTURN, NORESTART, BREATH | 0 | 6→6 |
| KNEEL_DOWN / KNEEL_UP (`:39`, `:41`) | 0 | STATIONARY, TURNING, NOMOVE_MARKER, STANCECHANGEANIM | 90 | 6→3 / 3→6 |
| CROUCHING (`:40`) | 0 | STATIONARY, TURNING, FASTTURN, BREATH | 0 | 3→3 |
| SWATTING (`:42`) | 2.2 | MOVING, TURNING, NORESTART | 0 | 3→3 |
| RUNNING (`:43`) | 2.6 | MOVING, TURNING, NORESTART | 0 | 6→6 |
| PRONE_DOWN / PRONE_UP (`:44`, `:46`) | 0 | STATIONARY, STANCECHANGEANIM (no TURNING) | 100 | 3→1 / 1→3 |
| CRAWLING (`:45`) | 0.8 | MOVING, TURNING, NORESTART | 0 | 1→1 |
| PRONE (`:47`) | 0 | STATIONARY, FASTTURN, BREATH (no TURNING) | 0 | 1→1 |
| START_SWAT / END_SWAT (`:52`, `:53`) | 1.3 / 0 | MOVING / STATIONARY, TURNING | 40 | 3→3 |
| SIDE_STEP / WALK_BACKWARDS (`:266`, `:267`) | 0.4 / 1.4 | MOVING | 50 / 110 | 6→6 |
| SWAT_BACKWARDS (`:339`) | 1.4 | MOVING, TURNING | 110 | 3→3 |
| BIGMERC_CROUCH_TRANS_INTO/OUTOF (`:276`, `:277`) | 0 | STATIONARY, TURNING, STANCECHANGEANIM | 90 | 6→3 / 3→6 |

### 5.2 Frame delay (`SetSoldierAniSpeed` → `CalculateSoldierAniSpeed`, `Soldier_Control.cc:4921-4960, 4763-4918`; see also `03` §0)

- **Fixed speed.** If `sSpeed ≠ 0` it is used as is.
- **Breathing states.** `STANDING`, `PRONE` and `CROUCHING`: `delay = 2·bBreath + (100 − bLife)`, minimum 40.
- **Moving states:**
  ```
  terrain + (50 − life/2) + min(50 − breath/2, 30) + (50 − EffectiveAgility/4) + additional
  ```
  - `terrain`: 5 on flat ground, floor or road; low grass 10; high grass 15; tracks/low water 20; mid water 25;
    deep water 30. A non-moving computed state uses 40.
  - `additional`: the body's `gub*Speeds[body].sSpeed`, clamped to ≥ 0. For walking: REGMALE −5→0, BIGMALE 0,
    REGFEMALE 0, FATCIV 40, MANCIV 10. Running: BIGMALE 5. Swat/crawl: BIGMALE 20 (`Animation_Control.cc:351-425`).
  - Then ÷2 on adrenaline, ÷2 in combat, ×2 in realtime stealth.
  - `EffectiveAgility` = drunk-adjusted agility × 100 / `sWeightCarriedAtTurnStart` when that is > 100
    (`SkillCheck.cc:35-40`).
- **Unseen soldiers.** In combat, unseen soldiers get delay 0 (`:4928-4936`).
- **When it is recomputed.** On each new state; on each tile change, for terrain (`03` §2); and by fast turns (§5.4).
- **Example.** Agility 80, life 100, breath 100, realtime: walk = 5 + 0 + 0 + 30 = 35 ms/frame; stand = 200 ms/frame.

### 5.3 Position update per animation frame

**Order inside one soldier pass** (`Overhead.cc:669-1030`, after the `UpdateCounter` expires):
1. `AdjustToNextAnimationFrame` runs the opcodes up to one frame code (`:687`).
2. **Moving or special-move state, not paused** (`:710-982`):
   - If `fPastXDest && fPastYDest`: clear both and run the at-centre logic (`HandleAtNewGridNo`, `03` §2).
   - Then, if `sGridNo == sFinalDestination`:
     - snap to `(sDestXPos, sDestYPos)`;
     - start the pending animation, or `SoldierGotoStationaryStance` (`:745-907`).
   - Otherwise `ubPathIndex++` and `HandleGotoNewGridNo` → `EVENT_InternalSetSoldierDestination(pathDir)`
     (`:909-971`; `:1612`).
3. If not `fPausedMove`, `MoveMerc(dMovementChange, gdRadiansForAngle[bMovementDirection], TRUE)` (`:990-1023`).
   - **`WALKING` uses `gubAnimWalkSpeeds[body].dMovementChange`**: 1.6 for bodies 0–3, 1.3 for adult civilians,
     1.6 for kids, 0.9 for cows.
   - Every other state, running included, uses `gAnimControl[state].dMovementChange`. So civilians also run at 2.6.
4. If the state has `ANIM_TURNING`: `TurnSoldier` (`:1027-1030`).

**`EVENT_InternalSetSoldierDestination`** (`Soldier_Control.cc:3724-3761`):
- `sDestination = sGridNo + DirIncrementer[dir]`, with `DirIncrementer` = N −160, NE −159, E +1, SE +161, S +160,
  SW +159, W −1, NW −161 (`Isometric_Utils.h:30-40`).
- `sDestXPos/YPos` = that tile's centre `(10X + 5, 10Y + 5)` (`Isometric_Utils.cc:349-353`).
- `bMovementDirection = dir`.
- The desired direction becomes `dir` (or the opposite when reversing), so facing turns while moving.

**`MoveMerc`** (`Soldier_Control.cc:6219-6331`; all positions `FLOAT`):

```
angle[dir] = (float){PI, 3PI/4, PI/2, PI/4, 0, −PI/4, −PI/2, −3PI/4}, PI = 3.1415926   Overhead.cc:1000-1011; Types.h:54
dx = (float)(d · sin(angle)) ; x' = x + dx         (double math, rounded to float)
X stop: NE/E/SE x' ≥ sDestXPos; NW/W/SW x' ≤ sDestXPos; N/S always  → fPastXDest = TRUE (sticky)
        and if sGridNo == sFinalDestination: x' = sDestXPos
dy = (float)(d · cos(angle)) ; Y stop: N/NE/NW y' ≤ dest; S/SW/SE y' ≥ dest; E/W always   (same snap)
EVENT_SetSoldierPositionXY(x', y')  → sGridNo = (INT16)(y'/10)·160 + (INT16)(x'/10)      Isometric_Utils.h:48
```

- **No snap between tiles.** The overshoot carries over to the next tile (the snaps at `Overhead.cc:724-725` are
  commented out). Only the final tile clamps.
- **Half-step occupancy.** `SetSoldierGridNo`: while moving, a new computed tile is forced to `sDestination`
  (`Soldier_Control.cc:1881-1900`). This is the half-step occupancy switch of `03` §2; it also moves the merc node, and
  therefore z.
- **(inferred, float32 simulation of the code above)** Frames per tile with the overshoot carried, starting from a
  centre:

  | Mode | Straight | Diagonal |
  |---|---|---|
  | walk 1.6 | 7,6,6,7,6,6,6,7 (51/8) | 9,9,9,9,9,9,8,9 |
  | run 2.6 | 4,4,4,4,4,4,3,4 | 6,5,6,5,… |
  | swat 2.2 | 5,5,4,5,4,5,4,5 | 7,6,7,6,… |
  | crawl 0.8 | 13,13,12,13,… | 18,18,18,17,… |
  | civ walk 1.3 | 8,8,8,7,… | 11 |

  For exact replication use `Math.fround` on every stored value and on `d` and `angle`, with `Math.sin`/`Math.cos`
  in double.
- **Stopping.** `EVENT_StopMerc` snaps to the centre of `sGridNo`, clears the path and goes stationary
  (`Soldier_Control.cc:7379-7421`).

**How a move starts** (`EVENT_InternalGetNewSoldierPath`, `:3406-3587`; `EVENT_InitNewSoldierAnim`, `:882-1760`):
1. Find the path; set `sFinalDestination`; clear `fPast*`.
2. If aiming, end the aim first (pending animation).
3. `EVENT_InitNewSoldierAnim(moveState)`:
   - **Wrong height:** if the move's `ubHeight` ≠ the current end height, the move becomes pending and
     `ChangeSoldierStance` runs first. In realtime, a moving stand↔crouch skips this (`:930-976`).
   - **Swat:** `SWATTING` is replaced by `START_SWAT` unless the current state is already `START_SWAT`. Going from
     `SWATTING` to `CROUCHING` → `END_SWAT` (`:1086-1096`).
   - **Injured:** `WALKING` → `STANDING` at life < 30 → `END_HURT_WALKING` (`:1098-1105`).
   - **Water:** running in low or mid water becomes walking (`:1188-1197`).
   - **First step:** entering a moving state from a non-moving one calls `HandleGotoNewGridNo(initialMove = TRUE)`,
     which sets the first destination (`:1224-1291`).
   - **Setup:** set the surface and state; `usAniCode = start`; frame 0; `SetSoldierAniSpeed`; reset the counter;
     first `AdjustToNextAnimationFrame` (`:1656-1740`).
4. `ANIM_NORESTART` states ignore a re-request of the same state unless forced (`:918-925`).

**How a move ends.** On arrival at the final tile, `SoldierGotoStationaryStance` → `STANDING`, `CROUCHING` or `PRONE`
by end height (`Overhead.cc:872-891`).

### 5.4 Turning (`TurnSoldier`, `Soldier_Control.cc:4215-4480`)

- **Increment.** Setting the desired direction computes `bTurningIncrement = QuickestDirection(cur, desired)`:
  ±1, with a 180° turn always +1 (clockwise) (`:3936`; `Isometric_Utils.cc:514-519`, `.h:96`).
- **Per frame.** On every animation frame of an `ANIM_TURNING` state with `bDirection ≠ bDesiredDirection`:
  `dir = (dir + inc) mod 8`, if `OKToAddMercToWorld(dir)` (`:4438-4474`).
  - It plays a footstep, except in water or on roads (`:4476-4479`).
  - Stationary states look on the next turn frame: `SOLDIER_LOOK_NEXT_TURNSOLDIER` → `HandleSight` (`:4229-4241`;
    `03` §2).
- **Fast turn.** `AdjustForFastTurnAnimation` sets `sAniDelay = 30` ms (`FAST_TURN_ANIM_SPEED`) while turning in an
  `ANIM_FASTTURN` state, for `OUR_TEAM` only (`:6379-6396`; `Animation_Control.h:30`). Enemies turn at their state's
  delay, e.g. ~200 ms per octant when standing **(inferred)**.
- **PRONE has no `ANIM_TURNING`.** A prone turn goes through crouch: `fTurningFromPronePosition`, `ChangeSoldierStance`
  (`:3896-3911, 4337-4355`).
- **Initial facing.** It is set directly with `EVENT_SetSoldierDirection` + `EVENT_SetSoldierDesiredDirection` when a
  soldier is added (`Soldier_Add.cc:884-897`).

---

## 6. Merc profiles

### 6.1 `prof.dat` (`BinaryData/Prof.dat`)

- **Layout.** 170 (`NUM_VANILLA_PROFILES`) records of `MERC_PROFILE_SIZE = 716` bytes (`Soldier_Profile_Type.h:10`;
  `LoadSaveMercProfile.h:6`; `BinaryProfileData.cc:31-47`). **(data)** File size 121 720 = 170 × 716. The checksum
  field is 0 in all records and isn't checked.
- **Obfuscation.** `JA2EncryptedFileRead` is applied per record (`Tactical_Save.cc:984-1000`;
  `vanilla:Tactical/TacticalSave.c:2429-2449`), with the key index and previous byte reset for each record:

  ```
  key = [132,235,125,99,15,220,140,89,205,132,254,144,217,78,156,58,215,76,163,187,55,49,65,48,156,140,201,
         68,184,13,45,69,102,185,122,225,23,250,160,220,114,240,64,175,47,233]   // "057" in the C source is octal = 47
  for i in 0..715: plain[i] = (enc[i] − enc[i−1] − key[i % 46]) & 255,  with enc[−1] = 0
  ```

  **(data)** Decoding with 47 yields correct names and stats.
- **Strings.**
  - The name and nickname are UTF-16LE in non-Russian versions (`isCorrectlyEncoded`,
    `LoadSaveMercProfile.cc:40-47`).
  - The palette IDs are 30-byte NUL-padded ASCII (`PaletteRepID_LENGTH`, `Overhead_Types.h:316`).

**Field table** (`ExtractMercProfile`, `LoadSaveMercProfile.cc:36-212`; offsets computed from it and verified on data).
Fields M2 needs are in bold.

| Off | Type | Field | Off | Type | Field |
|---|---|---|---|---|---|
| **0** | u16[30] | **zName** | 332 | i16 | sSalary |
| **60** | u16[10] | **zNickname** | **334** | i8 | **bLife** |
| 80 | — | skip 28 | **335** | i8 | **bDexterity** |
| 108 | u8 | ubFaceIndex (overwritten, below) | 336 | i8 | bPersonalityTrait |
| **109** | char[30] | **PANTS** | **337** | i8 | **bSkillTrait** (NIGHTOPS etc.) |
| **139** | char[30] | **VEST** | 338 | i8 | bReputationTolerance |
| **169** | char[30] | **SKIN** | 339 | i8 | bExplosive |
| **199** | char[30] | **HAIR** | **340** | i8 | **bSkillTrait2** |
| **229** | i8 | **bSex** | 341 | i8 | bLeadership |
| 230–235 | i8/u8 | armour attr., MiscFlags2, evolution, MiscFlags, sexist, learnToHate | 342 / 347 | i8[5] | bBuddy / bHated |
| 238 / 239 | u8 / i8 | ubQuoteRecord / bDeathRate | **352** | i8 | **bExpLevel** |
| 242–259 | i16 ×9 | stat gains | **353** | i8 | **bMarksmanship** |
| **260** | u8 | **ubBodyType** | **355** | i8 | **bWisdom** |
| 261 | i8 | bMedical | 358 / 377 | u8[19] | bInvStatus / bInvNumber |
| 262–269 | u16 ×4 | eyes X/Y, mouth X/Y | 396 | u16[4] | usApproachFactor |
| 280 / 284 | u32 | blink / expression frequency | **405** | i8 | **bAgility** |
| **288 / 290** | u16 | **sSector.x / .y** | 406 / 408 | u8 / i16 | fUseProfileInsertionInfo / sGridNo (both reset to 0) |
| 292 | u32 | uiDayBecomesAvailable | 411 | i8 | bMechanical |
| **296** | i8 | **bStrength** | 412 / 413 | u8 / u8[2] | ubInvUndroppable / ubRoomRangeStart |
| **297** | i8 | **bLifeMax** | **416** | u16[19] | **inv** (slot 5 = HANDPOS → surface choice) |
| 298–308 | i8 ×11 | stat deltas | 474 / 498 | u16[12] | stat change chances / successes |
| 310–326 | u16/i16 | kills … strength gain | 523 | u8[2] | ubRoomRangeEnd |
| **328** | u32 | **uiBodyTypeSubFlags** (0x1 BIGGUYSHOOT2, 0x2 THREATEN; `Overhead_Types.h:210-211`) | 529–538 | i8 | quote / race / nationality / … / racist |
| 540–574 | | salaries, deposit, attitude, approaches, town | 576 | i8[75] | bMercOpinion |
| 651–675 | | approached, merc status, hate/like timers, last quote, **669 sSector.z**, insertion data, NPC data | **682** | u8 | **ubCivilianGroup** |
| 676 | i32 | iBalance | 683 / 684 | u8 / u32 | ubNeedForSleep / uiMoney |
| 688–695 | | NPCData2, MiscFlags3, hangover, drug use, precedent quote | 696 | u32 | checksum |
| 700–715 | | pre-combat grid, complaint timer, suspicious death, MERC contract, total cost, skip 4 | | | |

**(data) Samples** (HAIR/SKIN/VEST/PANTS, body, hand item):

| Profile | Nickname | Palette | Body | Hand |
|---|---|---|---|---|
| 0 | Barry | BLACKHEAD/PINKSKIN/BLUEVEST/TANPANTS | 0 | SW38, pistol |
| 3 | Grizzly | BROWNHEAD/TANSKIN/REDVEST/BEIGEPANTS | 1, sub 1 | Desert Eagle |
| 4 | Vicki | BLACKHEAD/BLACKSKIN/PURPLESHIRT/BLACKPANTS | 3 | M1911 |
| 7 | Ivan | — | 0 | MP53, two-handed |
| 14 | Fox | — | 3 | Glock 17 |
| 16 | Gus | — | 1 | G41, two-handed |
| 143 | Ray | `dirtblnde` hair | 1 | — |

### 6.2 What Stracciatella does on top (`Soldier_Profile.cc:126-238`; `DefaultContentManager.cc:1258-1298`; `MercProfile.cc:147-374`)

- **`mercs-profile-info.json`** gives each profile an `internalName` and `type` (AIM/MERC/IMP/RPC/NPC/NOT_USED).
  - Optional fields override `prof.dat`: `fullName`, `nickname`, `sex`, `bodyType`, `bodyTypeSubstitution`, `face`,
    `skinColor`, `hairColor`, `vestColor`, `pantsColor`, `stats{health, agility, …}`, traits, `sector`, `inventory`,
    `contract` and others.
  - The shipped file uses almost none of them; only a commented example for profile 0.
  - **(data)** It lists 159 profiles; 51–56 (IMP slots) and 165–169 are absent. **An absent profile gets an empty
    struct and its binary record is discarded** (`DefaultContentManager.cc:1291-1297`).
- **`deserializeStruct` builds a new struct.** Fields it doesn't copy start zeroed (`MercProfile.cc:149`).
- **`InitProfileFromContent`** then:
  - sets `bMercStatus` by whether the dialogue file exists;
  - sets **`ubFaceIndex = profile id`** (`Soldier_Profile.cc:150`; vanilla also, `vanilla:Tactical/SoldierProfile.c:177`);
  - fills an empty VEST with `WHITEVEST` and empty PANTS with `BLACKPANTS` (`:158-159`);
  - replaces extended-list guns if not gun-nut;
  - computes attractiveness and the optional gear cost;
  - resets `fUseProfileInsertionInfo` and `sGridNo` (`:209-210`).
- **Copied into the soldier** (`TacticalCopySoldierFromProfile`, `Soldier_Create.cc:485-532`): the four palettes;
  `name = zNickname`; life, lifeMax, agility, leadership, dexterity, strength, wisdom, exp, marksmanship, medical,
  mechanical, explosive; `uiAnimSubFlags`; `ubBodyType`; `ubCivilianGroup`; both skill traits. The CAMOUFLAGED trait
  sets `bCamo = 100`. Items come later, in `CopyProfileItems` (`:206`).

---

## 7. Soldier creation

### 7.1 Placement records

- **`BASIC_SOLDIERCREATE_STRUCT`** (already parsed in `src/content/formats/map.ts`; `Soldier_Create.h:22-40`): start
  grid, team, relative attribute/equipment level, direction, orders, attitude, `bBodyType` (−1 = random), patrol grid,
  roof flag, `ubSoldierClass`, civ group, priority existence, has keys.
- **Static detailed placement**, 1040 bytes (Windows format), in `detailedRaw` (`LoadSaveSoldierCreate.cc:41-104`):

| Off | Field | Off | Field |
|---|---|---|---|
| 0 | fStatic | 716 / 746 / 776 / 806 | HeadPal / PantsPal / VestPal / SkinPal (char[30]) |
| 1 | ubProfile (200 = NO_PROFILE) | 866 | sPatrolGrid i16[10] |
| 6 / 8 | sSector x / y (i16) | 886 / 887 | bPatrolCnt / **fVisible** |
| 10 | bDirection | 888 | name, UTF-16 ×10 |
| 12 | sInsertionGridNo i16 | 908 / 909 / 910 | ubSoldierClass / fOnRoof / sSector.z |
| 14 / 15 / 16 / 17 | bTeam / bBodyType / bAttitude / bOrders | 917 / 919 | ubCivilianGroup / ubScheduleID |
| 18–31 | lifeMax, life, agility, dex, exp, marks, med, mech, expl, lead, str, wis, morale, AImorale (−1 = generate) | 920–922 | fUseGivenVehicle / vehicle id / fHasKeys |
| 32 | Inv: 19 × OBJECTTYPE (36 bytes: `usItem` +0, `fFlags` +28, 0x80 = `OBJECT_NO_OVERWRITE`) | | |

### 7.2 From a placement to a soldier

**Population**:
- Civilians and militia: `AddSoldierInitListTeamToWorld(team)` (`Soldier_Init_List.cc:571-613`).
- Enemies: `AddSoldierInitListEnemyDefenceSoldiers(admins, troops, elites)`. The counts come from the strategic
  `SECTORINFO` (`Queen_Command.cc:477`).
  - Enemy placements are picked by class.
  - Order: priority + detailed, then priority, then detailed, then basic. Each slot is taken if
    `slots ≤ remaining || Random(slots) < remaining` (`Soldier_Init_List.cc:616-1025`).
- **(inferred) A9 at game start.** The garrison composition `OMERTA_WELCOME_WAGON` has `startPopulation` 3,
  troops 100% (`army-compositions.json`; `army-garrison-groups.json:37`).
  - The start population is varied by ±25% and clamped to `[min_enemy_group_size, 32]` (`Strategic_AI.cc:409-462`).
  - The minimum is 3/4/6 for easy/medium/hard (`strategic-ai-policy.json:27-29`).
  - Result: 3, 4 or 6 ARMY troops.

**`AddPlacementToWorld`** (`:412-568`):
- **Detailed placement:** `CreateDetailedPlacementGivenStaticDetailedPlacementAndBasicPlacementInfo`
  (`Soldier_Create.cc:1463-1543`).
  - With a profile: copy team, direction, grid, orders etc. and stop there.
  - Otherwise: run the basic generation, then overwrite the stats that are ≠ −1, the palettes if `fVisible`, and the
    items flagged `NO_OVERWRITE`.
- **Basic placement:** `CreateDetailedPlacementGivenBasicPlacementInfo` (`:1122-1393`):
  - **Body type:** `bBodyType < 0` → `Random(4)`:
    - OUR/ENEMY/MILITIA team → REG, BIG, STOCKY or FEMALE.
    - Miner → `Random(3)` of REG, BIG or MANCIV.
    - Other civilian → `Random(100)`: <8 FAT, <38 MAN, <57 MINI, <76 DRESS, <88 HATKID, else KID (`:1145-1213`).
  - **Exp level** from class (admin 2, army 4, elite 6, militia 2/4/6) + difficulty modifier
    `(diff/20) − 2` + relative level (`:1243-1343`).
  - **Stats:** `49 + 4·statsLevel + Random(9) + Random(8)` each, in a fixed order (`:1349-1365`).
  - **Equipment:** `GenerateRandomEquipment` for admin, army, elite and militia (`:1386-1392`).
- **`TacticalCreateSoldier`** (`:128-456`):
  1. Take a free id in the team's range; `InitSoldierStruct`: `usAnimState = STANDING`, breath 99/100 (`:913-955`).
  2. Copy from the profile or from the create struct (§3.2 palettes).
  3. Flags, side, direction, insertion grid.
  4. Civilian stat tweaks by body (`:229-259`).
  5. `ubBattleSoundID = Random(3)`.
  6. **ENEMY_TEAM, no profile, REGFEMALE, not elite → `REGMALE + Random(3)`** (`:278-285`). Hair was already rolled
     with the female rules.
  7. BIGMALE → threaten flag (`:287-291`).
  8. Face items moved; enemy camo roll if it carries a camo kit (`:319-327`).
  9. `CreateSoldierCommon`: anim cache; `EVENT_InitNewSoldierAnim(STANDING, usAniCode = Random(10))` (desync between
     soldiers); `CreateSoldierPalettes` (`Soldier_Control.cc:550-619`).
  10. `fOnRoof` → `SetSoldierHeight(58)` (`:448-451`).
- **`AddSoldierToSectorNoCalculateDirection`** (`Soldier_Add.cc:683-930`):
  - `FindGridNoFromSweetSpot(insertionGrid, 7)` for non-creatures;
  - then `EVENT_SetSoldierPosition` (tile centre), direction and desired direction;
  - player mercs also get `EVENT_StopMerc`.
- **RNG.** All of this uses the shared `Random`. Body, stats and palette rolls interleave, so a seeded replay must keep
  this exact order (`03` §7, `01` §3.6) **(inferred)**.
- **Hand item → surfaces.** Army weapon class = `BAD_ARMY_EQUIPMENT_RATING + modifier`. Class 1–2 picks from the first
  rows of `army-gun-choice-*.json`: SW38/Desert Eagle, Glock/Beretta 93R, … (`Inventory_Choosing.cc:216-230, 560-575`).
  So early troops often hold pistols and use the P surfaces **(inferred)**.

**(data) A9 placements** (`maps/a9.dat`, 36 placements):

| Kind | Count | Details |
|---|---|---|
| CIV, detailed with profiles | 4 | Ray (143, BIGMALE, `dirtblnde`/PINK/grey/BLACK), Olga (144, REGFEMALE), Fatima (101, DRESSCIV), Pacos (114, KIDCIV) |
| ENEMY ARMY (class 3), body −1, priority + detailed | 6 | grids 19417, 21358, 18188, 19255, 11704, 13901. Static stats life 40–55, agility 35–55, exp 1; `fVisible = 0`; inventory slots all empty with flag 0x01 (no `NO_OVERWRITE`), so equipment is generated |
| ENEMY ARMY, basic | 26 | — |

These six priority placements are filled first, so the A9 enemies stand on some of them **(inferred)**.

---

## 8. Minimum for the first sandbox (6 mercs + A9 enemies, standing and walking)

**Content (importer, client-side assets):**
1. `prof.dat` decoder (§6.1): nickname, body, sub-flags, four palette IDs, life, lifeMax, agility, dexterity,
   strength, wisdom, exp, marksmanship, skill traits, `inv[HANDPOS]`.
   Suggested squad: Barry 0, Grizzly 3, Vicki 4, Ivan 7, Fox 14, Gus 16. That gives REG/BIG/FEMALE with rifles and
   pistols **(data)**.
2. A transcription of `gAnimSurfaceDatabase` (all 396 rows; position = id) and of the
   `gubAnimSurfaceIndex`/`ItemSubIndex` entries for bodies 0–3 and 11–17. At least: STANDING, WALKING, RUNNING,
   SWATTING (+START/END_SWAT), CROUCHING, KNEEL_DOWN/UP, PRONE (+DOWN/UP), CRAWLING, END_HURT_WALKING, BIGMERC trans.
   Plus `gusNothingBreath` and the hurt-walk subs.
3. `gAnimControl` rows for those states (§5.1) and the speed tables (`Animation_Control.cc:351-425`).
4. TypeScript port of the `ja2bin.dat` reader (from `tools/spikes/ja2bin-timelines.py`): raw `[320][100]` u16, with
   frame/jump/goto decoding.
5. Item facts: is it a gun or launcher, is it two-handed (`weapons.json` `bTwoHanded`). Rocket launcher counts as
   "nothing".

**Simulation (deterministic, 5 ms ticks):**
6. A soldier record with:
   - `body, subFlags, team, side, life, breath, agility, handClass`;
   - `state, aniCode, delay, accumulator, direction, desiredDirection, turnIncrement`;
   - `x, y` (float32), `gridNo, destination, destX/destY, finalDestination, movementDirection, pastX/pastY`;
   - `path[], pathIndex, level, heightAdjustment`.
7. Frame stepping: frame codes, 501+ jumps, 600/800/900 gotos, 499 (stationary and stance chaining), 498. Visual codes
   go to the event log only; 491 is client-only.
8. Move loop in the exact order of §5.3: frame, then centre check, then `MoveMerc` (float32), then `TurnSoldier`. Also
   the delay formula of §5.2. Straight-line or simple paths are enough at first.
9. Creation:
   - Mercs from profiles placed at chosen grids.
   - Enemies from the A9 priority ARMY placements: body `Random(4)` with the female→male rule; stats; palettes per
     §3.2.
   - Hand item: a fixed pistol, or port `GenerateRandomEquipment` later.

**Rendering (WebGL2):**
10. Per soldier, a 256-entry palette: STANDING-surface STI palette + 4 `ja2pal` ranges. Quantise via RGB565, as in
    `05` §6.4. Shade 4 (`×255/256`) for daylight; `pGlowShades[0]` and the 3 s red pulse for enemies are optional.
11. Frame = script frame + framesPerDir × OneC block (§1.3), sprite anchor per §4.2.
12. Merc pass after the static passes, per row in `DYN_MERCS`: z = `8·wy + 3` at `gridNo`, test `zbuf < z`, no z write.
    Obscured checkerboard where `zbuf > z`. Index 254 → destination × 0.48.
13. **Deferred:** structure collision for mercs; anim profiles; multi-Z prone strips; lighting on soldiers; camo;
    water sub-surfaces; random idles; vehicles and creatures.

---

## 9. Quirks to keep (or to list in `deviations.md`)

- Big males always use the "threaten" sheets (§1.2). STOCKYMALE looks exactly like REGMALE (§2.1).
- Skin and hair are re-rolled even for `fVisible` detailed placements (§3.2). An army REGFEMALE becomes male after her
  hair was rolled with the female rules (§7.2).
- Enemies ignore scene lighting and pop to TOPMOST z at the glow peak (§3.4). The peak grey glow uses 200, not 225
  (§3.3).
- Movement is float32 with overshoot carried and `PI = 3.1415926` (§5.3). Walking uses the per-body table, while
  running ignores `gubAnimRunSpeeds[].dMovementChange` (§5.3).
- Turning while walking happens at one octant per walk frame (§5.4). Only the player's soldiers fast-turn.
- A direction change doesn't refresh `usAniFrame` until the next frame code (§1.3).
- Prone z-strips are computed from frame 5 for REGMALE but from frame 0 for big males and women (§4.4).
- The initial standing frame is `Random(10)` from the shared RNG (§7.2).
