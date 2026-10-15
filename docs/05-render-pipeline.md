<!-- Static tactical map rendering in JA2 (Stracciatella), written as a spec for the WebGL2 renderer.
2026-10-15. Source: reference/stracciatella/src (same snapshot as docs 01–04). Read-only research, nothing was built or run
except `pnpm cli inspect` on the original data. -->

# 05 — Static tactical map render pipeline

This document says how the original draws the **static** world: land, objects, shadows, structures, roofs, on-roof and
topmost. It leaves out mercs, items, corpses, animated tiles and the editor, except where they affect ordering. The goal
is a WebGL2 renderer whose output matches the original pixel order: one quad per sprite, a GPU depth buffer, and multi-tile
structure images split into 20 px strips.

**Notation.**
- Unmarked statements were read in the code (fact) and carry a `file:line` reference.
- **(inferred)** marks my derivations and assumptions.
- **(data)** marks things I checked in the original Gold 1.12 data with `pnpm cli inspect`.

File paths are relative to `reference/stracciatella/src/`, and only basenames are used below:

| Basename | Path |
|---|---|
| `RenderWorld.cc/.h`, `Isometric_Utils.cc/.h`, `WorldDef.cc/.h`, `WorldMan.cc`, `Lighting.cc/.h`, `Structure.cc`, `Structure_Internals.h`, `TileDef.cc/.h`, `TileDat.cc/.h`, `Tile_Surface.cc`, `Render_Fun.cc`, `Radar_Screen.cc/.h`, `Overhead_Map.cc`, `Environment.cc/.h`, `Tile_Animation.cc`, `Explosion_Control.cc`, `SaveLoadMap.cc`, `Fog_Of_War.cc`, `LoadSaveLightSprite.cc` | `game/TileEngine/` |
| `VObject.cc/.h`, `VObject_Blitters.cc`, `HImage.cc/.h`, `Shading.cc/.h`, `Video.cc` | `sgp/` |
| `Handle_UI.cc`, `Interface.h`, `Interface_Cursors.cc`, `FOV.cc`, `DisplayCover.cc` | `game/Tactical/` |
| `UILayout.cc/.h`, `Init.cc`, `GameSettings.cc` | `game/` |
| `StrategicMap.cc`, `Game_Clock.cc` | `game/Strategic/` |
| `Timer_Control.cc` | `game/Utils/` |
| `DefaultContentManager.cc` | `externalized/` |

---

## 0. Cheat sheet

```
cx, cy   = W/2, (H-120)/2                     tactical map centre (320,180 at 640×480)
rcx, rcy = gsRenderCenterX/Y                  camera, in cell units, always 10k+5
tile (X,Y) blit origin:
  ox = cx + 20(X-Y) - 20 - 2(rcx-rcy)
  oy = cy + 10(X+Y) - 10 - (rcx+rcy) - sHeight [-50 for roof/onroof] + gsRenderHeight
frame pixel (0,0) lands at (ox + sOffsetX, oy + sOffsetY)     40×20 land frame = the tile diamond
sweep order: rows s = X+Y ascending; inside a row X ascending (left to right)
passes: LAND(all) → OBJECTS(all) → SHADOWS(all, day only) → per row {STRUCT, ROOF, ONROOF, TOPMOST}
        → per row {STRUCT, ONROOF} "obscured" (SHOW_THROUGH only) → dynamic layers (DYNAMIC_TILE etc.)
wy = 10(X+Y) + 25 - gsTopY  (= 10(X+Y) - 835 for normal maps)
z: land none | object 1 | shadow max(8(wy-80)+2, 0) | struct 8wy+4 (+80·strip) | roof 8(wy+50)+5
   | onroof 8(wy+50)+6 | topmost 32767.   A larger z is nearer. Z-buffer cleared to 0.
compare: most layers pass if zbuf <= z; multi-Z strips (non-wall) and shadows pass if zbuf < z; all static z layers write z
```

---

## 1. Coordinate systems

### 1.1 Grid

- `WORLD_COLS = WORLD_ROWS = 160`, `WORLD_MAX = 25600`, and `gridno = Y*160 + X` (`WorldDef.h:13-15`;
  `Isometric_Utils.h:46-47`; `ConvertGridNoToXY`, `Isometric_Utils.cc:333-337`).
- X grows to screen lower-right (east), Y grows to screen lower-left (south). `DirIncrementer`: N = −160, E = +1
  (`Isometric_Utils.h:30-40`).
- `FASTMAPROWCOLTOPOS(r,c) = (UINT16)(r*160 + c)` does no bounds check (`Isometric_Utils.h:47`). The renderer only
  rejects results `>= GRIDSIZE` (`RenderWorld.cc:413-415`). An X outside 0..159 on a valid row therefore wraps into the
  neighbouring row, and a negative index wraps to a large `UINT16` and is rejected. See §9.3.

### 1.2 Cell ("world") coordinates

- `CELL_X_SIZE = CELL_Y_SIZE = 10`, so a tile is 10×10 cell units and the world is 1600×1600 (`WorldDef.h:16-19`).
- Tile corner: `(10X, 10Y)` (`ConvertGridNoToCellXY`, `Isometric_Utils.cc:339-346`). Tile centre: `(10X+5, 10Y+5)`
  (`:349-353`).
- World centre `gCenterWorldX/Y = 800` (`RenderWorld.h:88-89`).

### 1.3 Isometric projection

- `FromCellToScreenCoordinates(x, y) = (2(x − y), x + y)`, using `HALF_TILE_WIDTH = 2`, `HALF_TILE_HEIGHT = 1`
  (`Isometric_Utils.cc:111-116`, `WorldDef.h:21-22`). The float variant is identical (`:129-138`).
- `FromScreenToCellCoordinates(sx, sy) = (floor((sx/2 + sy)/2), floor((sy − sx/2)/2))`, computed in float with floor
  (`:118-123`).
- A tile is 40×20 px (`WORLD_TILE_X/Y`, `WorldDef.h:11-12`). One row step (X+1 or Y+1) is 10 px down, and one
  X+1,Y−1 step is 40 px right.

**"Absolute world screen" frame (scroll limits, radar).** Projecting the map diamond gives vertices (0,0), (3200,1600),
(0,3200) and (−3200,1600). `InitRenderParams` (`RenderWorld.cc:2114-2171`) projects the limit points and keeps only the
rectangle inscribed in the diamond:
- **Restriction 0 (normal):** limits are cells (10,800) and (1600,800). That gives `gsLeftX = −1580`, `gsRightX = 1600`,
  `gsTopY = 810 + ROOF_LEVEL_HEIGHT(50) = 860` and `gsBottomY = 2400` (`:2124-2148`; `Interface.h:42`).
- **Restriction 1 (small maps):** `gMapInformation.ubRestrictedScrollID`; limits are cells (480,800) and (1120,800)
  (`:2132-2137`).
- `gsCX = 0` and `gsCY = 1625` are constants (`RenderWorld.h:94-95`).

### 1.4 Camera and viewport

- **Viewport:** `(0,0)–(W, H−120)`. Map centre: `cx = W/2`, `cy = (H−120)/2`. World clip rect = viewport
  (`UILayout.cc:120-128`).
- **Camera:** `gsRenderCenterX/Y` in cell units, snapped to `v/10*10 + 5`, i.e. always a tile centre
  (`RenderWorld.cc:2178-2179, 2292-2293`). So the view always moves in whole-tile steps.
- **Viewport corners in the absolute frame:** `sScreenCenter = CellToScreen(rc) − (0,10)` (`:2184-2188`);
  `TopLeft = sScreenCenter − (cx,cy)`, `BottomRight = sScreenCenter + (cx,cy)` (`:2194-2198`).
- **Scroll limits:** the view may not show `x < gsLeftX−30`, `x > gsRightX+10`, `y <= gsTopY−50` or
  `y > gsBottomY−20` (`:2201-2204`; paddings in `Interface.h:44-47`). Small maps that fit on screen are centred
  (`:2252-2278`).
- **Stored for the radar:** `gsTopLeftWorldX/Y = TopLeft − (gsLeftX, gsTopY)`, and likewise for BottomRight (`:2295-2299`).

### 1.5 Where a tile sprite goes

`CalcRenderParameters` (`RenderWorld.cc:3436-3516`) picks a start tile and its screen position. `RenderTiles` then steps
+40 px per tile along a row, and +10 px plus an alternating ±20 px per row (`:409, 1513-1530`). Working through that
arithmetic gives **(inferred)**:

```
ox(X,Y) = cx + 20·(X − Y) − 20 − 2·(rcx − rcy)
oy(X,Y) = cy + 10·(X + Y) − 10 − (rcx + rcy)
```

- `(ox, oy)` is the top-left of the 40×20 box around the tile diamond. The north vertex is `(ox+20, oy)`, the centre
  `(ox+20, oy+10)` and the bottom vertex `(ox+20, oy+20)`.
- **Consistency check (inferred).** A merc standing at the tile centre, positioned via `FloatFromCellToScreenCoordinates`
  minus `gsRenderWorldOffsetY = 10` (`:959-972, 203`), lands at `(ox+20, oy+10)`.
- **Exactness (inferred).** Checked by hand for 640×480. `FromScreenToCellCoordinates` floors, so the formula is exact
  only when `cx` is even and `cx/2 + cy` is even. 640×480, 1024×768, 1280×720 and 1920×1080 all qualify. Otherwise the
  whole static layer is shifted by 1–2 px.
- **Frame offset.** Every blitter draws pixel (0,0) of an ETRLE frame at `(sXPos + sOffsetX, sYPos + sOffsetY)`
  (`ETRLEObject`, `HImage.h:52-60`; `ClipInfo`, `VObject_Blitters.cc:2196-2197`; `…Transparent`, `:1961-1962`).
- **(data)** Land frames (`tilesets/0/grass.sti`) are 40×20 with offset (0,0), so a land frame *is* the diamond box.
  Other objects carry negative offsets, e.g. `roofvent.sti` #0 is 61×39 at (−11,−23).
- **Transparency** comes only from ETRLE runs with bit 0x80; every pixel of an opaque run is drawn through the palette
  (`VObject_Blitters.cc:1981-1997`).

### 1.6 Heights

For every non-merc node (`RenderWorld.cc:460-463, 630-637, 1110`):

```
sHeight   = gpWorldLevelData[g].sHeight                  // UINT8 from the map file (WorldDef.cc:2074-2085)
modHeight = max(0, (sHeight/80 − 1)*80)                  // integer division
if TileElem.uiFlags & IGNORE_WORLD_HEIGHT: sYPos -= modHeight
elif !(node.uiFlags & LEVELNODE_IGNOREHEIGHT): sYPos -= sHeight
roof / onroof layers: sYPos -= WALL_HEIGHT (50)           (:851, :863; TileDef.h:33)
sYPos += gsRenderHeight                                   (:1110)
```

- **`gsRenderHeight`** is a global shift of the whole picture. It is the `sHeight` of the map's first defined entry point
  (N, E, S, W order), plus 50 when the interface is on roof level, and 0 in basements and caves
  (`Handle_UI.cc:5166-5212, 1124-1147`).
- **Height never changes z.** `GetMapXYWorldY` uses only X,Y (§3.1).
- **`IGNORE_WORLD_HEIGHT`** is set for the tile range `FIRSTCLIFFHANG1..FIRSTCLIFFSHADOW17` (`TileDat.cc:666-670`).
  `CLIFFHANG_TILE` is additionally set for the `FIRSTCLIFFHANG` type.
- **`gTileTypeLogicalHeight`** (textures 2, water 10, the rest 1; `TileDat.cc:553-564`, `WorldDef.cc:151`) is used only to
  decide *where in the land list* a new land piece is inserted (`TileDef.cc:279-303`, `WorldMan.cc:490-516`). It has no
  effect on screen position.
- **Runtime-only position flags.** `LEVELNODE_USERELPOS`, `USEZ`, `USEABSOLUTEPOS` and `IGNOREHEIGHT`
  (`RenderWorld.cc:647-679`) are used by bullets, physics objects and UI. The map loader never sets them **(inferred:
  the loader only calls the plain `Add*To*` functions, `WorldDef.cc:2121-2296`)**.

---

## 2. Iteration order

### 2.1 Passes of a full static render

`RenderStaticWorld` (`RenderWorld.cc:1754-1786`):

```
CalcRenderParameters(viewport); fill zbuffer with 0 (LAND_Z_LEVEL)              :1757-1760
RenderTiles(NONE, STATIC_LAND)                                                   :1767
RenderTiles(NONE, STATIC_OBJECTS)                                                :1768
if RENDER_FLAG_SHADOWS: RenderTiles(NONE, STATIC_SHADOWS)                        :1770-1773
RenderTiles(NONE, STATIC_STRUCTS, STATIC_ROOF, STATIC_ONROOF, STATIC_TOPMOST)    :1775-1779
RenderTiles(OBSCURED, STATIC_STRUCTS, STATIC_ONROOF)                             :1782
```

- **Shadows only by day.** `RENDER_FLAG_SHADOWS` is set iff the ambient level `< LIGHT_DUSK_CUTOFF (8)`
  (`Lighting.cc:1382-1385`, `Lighting.h:25`). At night the static shadow layer is not drawn at all.
- **Static and dynamic buffers.** The result is copied to the save buffer. Every frame, `RenderDynamicWorld` restores
  dirty rects and draws the dynamic layers on top (`:1819-1865`). See §2.5 for what in the map file is drawn only there.

### 2.2 The row sweep (`RenderTiles::Render`, `RenderWorld.cc:353-1534`)

**Important:** the row loop is the outer loop, and the list of layers passed to the call is the inner loop.

```
anchor = (startX_M, startY_M, startX_S, startY_S); odd = false
do:                                        // one screen row per iteration, +10 px
  for layer in layers_of_this_call:        // :396
    (x_M, y_M, x_S) = anchor; if odd: x_S += 20                        // :404-409
    do:                                    // tiles in the row, +40 px
      g = y_M*160 + x_M; if g < 25600: draw nodes of `layer` at tile g // :413-491
      x_S += 40; x_M++; y_M--                                          // :1513-1515
    while x_S < endXS
  if odd: anchor.y_M++ else anchor.x_M++; odd = !odd; anchor.y_S += 10  // :1519-1529
while anchor.y_S < endYS
```

- **Row = diagonal.** A row is a constant `X+Y`, because the row step adds 1 to X or Y and the tile step keeps X+Y.
  Inside a row, X increases (left to right). The equivalent global order is **sort by `(X+Y, X)` ascending
  (inferred)**.
- **Within one call,** all listed layers of row *s* are drawn before row *s+1*. So pass 4 interleaves per row:
  STRUCT(s), ROOF(s), ONROOF(s), TOPMOST(s), STRUCT(s+1), …
- **Sweep window.** The static render uses the *large* window `LARGER_VIEWPORT_X/YOFFSET_S = 120 / 200` px
  (`:58-61, 1765, 3489-3515`). It covers tile origins from (left−120, top−200) to (right+120, bottom+200). The dynamic
  render uses only 40/40 (`:1825, 3448-3485`). **(inferred)** A sprite whose origin is outside the window is not drawn
  even if part of it would be visible. This only affects sprites taller than ~200 px, or wider than ~120 px beyond the
  edge.

### 2.3 Node order inside one tile's layer

`RenderFX` table (`RenderWorld.cc:300-320`) plus the list traversal at `:431, 1480-1489`:

| Layer | Start pointer | Direction | How the map loader builds the list | Effective draw order |
|---|---|---|---|---|
| LAND | `pLandStart` | **backwards** (`pPrevNode`) up to the head | file order via `AddLandToHead` (`WorldDef.cc:2136`). The saver writes tail→head (`:1466-1471`), so the file is bottom→top | from the *last full tile* in file order, then each later piece; head (top) drawn last |
| OBJECTS | `pObjectHead` | forward | `AddObjectToTail` in file order (`:2161, 2184`); types `>= FIRSTPOINTERS` skipped | file order |
| SHADOWS | `pShadowHead` | forward | buddy shadows, `AddShadowToHead` while structs load, so the last added comes first (`WorldMan.cc:551-555, 955-967`); then file shadows `AddShadowToTail` (`WorldDef.cc:2250`) | buddies in reverse struct order, then file shadows |
| STRUCTS | `pStructHead` | forward | `AddStructToTail` in file order (`:2223`) | file order |
| ROOF | `pRoofHead` | forward | `AddRoofToTail` (`:2272`) | file order |
| ONROOF | `pOnRoofHead` | forward | `AddOnRoofToTail` (`:2294`) | file order |
| TOPMOST | `pTopmostHead` | forward | not in the map file (6 layer counts only, `:2090-2116`). Filled at runtime: wireframes on every load (§5) and the cursor | head→tail |

- **`pLandStart`.**
  - `AddLandToHead` sets `pLandStart = n` whenever the new piece has `ubFullTile` (`WorldMan.cc:287-304`), so it ends up
    at the full tile nearest the head.
  - Land below `pLandStart` (towards the tail) is never drawn.
  - If no piece is full, `pLandStart` stays NULL and nothing is drawn. `AdjustForFullTile` would add a random background
    piece only on later edits (`:349-377`).
  - `ubFullTile` comes from aux data, `gFullBaseTileValues` for base textures, and all floors (`TileDef.cc:91-94`,
    `TileDat.cc:731-740`).
- **Buddy shadows.**
  - Added for every struct whose tile element has `HAS_SHADOW_BUDDY`, unless `GridNoIndoors(g)`
    (`WorldMan.cc:551-555`).
  - `GridNoIndoors` = basement, caves, or a `FIRSTFLOOR..LASTFLOOR` land piece on the tile (`WorldDef.cc:130-137`).
    During loading `gfBasement`/`gfCaves` are still FALSE (`:2033-2034`), so only the floor test counts.
  - The struct↔shadow type pairs are in `g_shadow_buddies` (`TileDat.cc:103-140`). The shadow index is
    `struct_idx − first_struct + first_shadow`.
  - A shadow element **inherits all flags of its struct buddy**, e.g. `DYNAMIC_TILE` or `ANIMATED_TILE`
    (`TileDat.cc:595-600`).
  - Buddy shadows are not saved back to the map (`WorldDef.cc:1516`).
  - Some shadows are removed again at load (§2.7).

### 2.4 Per-node filter in the static pass

All in `RenderWorld.cc`, in order:

1. **Redundant tile.** On LAND and OBJECTS only, the whole tile list is skipped if `MAPELEMENT_REDUNDENT` is set
   (`:448-454`). This is an optimisation: `ExamineZBufferForHiddenTiles` sets the flag when a land-diamond-shaped area at
   the tile is completely covered by z ≥ the tile's struct z (`:3344-3433, 3526-3573`). **(inferred)** Skipping it does
   not change the picture except at odd sprite overhangs. Not needed for v1.
2. **`LEVELNODE_REVEAL`.** Not drawn in static passes; drawn translucent in the dynamic pass (`:466-477`).
3. **`LEVELNODE_REVEALTREES`.** Draw `usIndex + 2` instead of `usIndex` (`:503-505`). See §9.6.
4. **Animated and dynamic.** Skipped in static passes if the tile has `ANIMATED_TILE`, or (`DYNAMIC_TILE` or
   `LEVELNODE_DYNAMIC`) outside the obscured pass (`:535-539`).
5. **SHOW_THROUGH.** For STRUCTS and ONROOF only (`fObscured` column): nodes with `LEVELNODE_SHOW_THROUGH` are drawn
   *only* in the `TILES_OBSCURED` pass, and nodes without it *only* in the normal pass (`:546-567`).
6. **`LEVELNODE_HIDDEN`.** Skipped, unless the tile has `ROOF_TILE` and `gTacticalStatus.uiFlags & SHOW_ALL_ROOFS`
   (roof interface level) (`:1114-1117`).
7. **`LEVELNODE_WIREFRAME`.** Skipped when the wireframe option is off (`:1137-1140`). Default is on
   (`GameSettings.cc:162`).

The shade palette is chosen per node: `hVObject->CurrentShade(node.ubShadeLevel)` (`:641`).

### 2.5 Static map content that is drawn only in the dynamic pass

`RenderDynamicWorld` (`RenderWorld.cc:1819-1865`), in this order:
- (OBSCURED, STATIC_STRUCTS) again;
- per row: DYN_OBJECTS, DYN_SHADOWS, DYN_STRUCT_MERCS, DYN_MERCS, DYN_STRUCTS;
- per row: DYN_ROOF, DYN_HIGHMERCS, DYN_ONROOF;
- per row: DYN_TOPMOST.

There is **no DYNAMIC_LAND** in this list, and no caller passes `fDynamicsToo = TRUE` to `RenderStaticWorldRect`
(`:1548, 1626`). Animated or dynamic land tiles are therefore never drawn.

A node is drawn in a dynamic layer if (`:518-532`):
- it has `LEVELNODE_DYNAMIC` or `LASTDYNAMIC`, or
- its tile has `DYNAMIC_TILE`, or
- its tile has `ANIMATED_TILE`, in which case it is drawn with frame `pusFrames[bCurrentFrame]`. Frames advance every
  200 ms (`:1596-1603`; `Timer_Control.cc:18`).

To reproduce the full static picture, draw these nodes after the static passes, with the dynamic blitters of §3.3.
Map-relevant `DYNAMIC_TILE` sources (`TileDat.cc:620-729`):
- the second frame of every triple in `FIRSTFULLSTRUCT1..SECONDFULLSTRUCT12` (tree "top" frame, `:655-663`);
- `MOCKFLOOR1`;
- the shadows of those frames (flag inherited).

The other `DYNAMIC_TILE` tiles are UI, bullets, window-shatter and miss animations.

### 2.6 What uses the z-buffer

| Layer | Z test | Z write |
|---|---|---|
| STATIC_LAND | no | no |
| STATIC_OBJECTS, SHADOWS, STRUCTS, ROOF, ONROOF, TOPMOST | yes | yes |
| DYN_OBJECTS, DYN_STRUCTS, DYN_ROOF, DYN_ONROOF, DYN_TOPMOST | yes | no, except multi-Z blits, which always write (§3.3) |
| DYN_SHADOWS | no | no |

Source: the `RenderFX` table (`RenderWorld.cc:300-320`).

The buffer is 16-bit unsigned and cleared to 0 at each full static render (`:1760`). **A larger z means nearer**: a
pixel is drawn when `zbuf < z` or `zbuf <= z`.

### 2.7 Load-time steps that change the static picture

After `LoadWorld`, `InitLoadedWorld` runs (`WorldDef.cc:1644-1668`):

1. `CalculateWorldWireFrameTiles(TRUE)` adds the TOPMOST wireframe tiles (§5).
2. `LightSpriteRenderAll()` sets `ubShadeLevel` on every node (§6).
3. `OptimizeMapForShadows()` deletes **every** shadow node (map and buddy) on each tile that holds a `STRUCTURE_TREE`
   when all five neighbours W, SW, S, SE and E have a structure (`:1599-1627`). `NewGridNo` returns the tile itself at
   the map edge, and that tile counts as "has a structure".
4. `SetInterfaceHeightLevel()` sets `gsRenderHeight` (§1.6).

---

## 3. Z values

### 3.1 Base term

```
GetMapXYWorldY(X, Y) = (10X − 800) + (10Y − 800) + gsCY(1625) − gsTopY          RenderWorld.cc:268-274
                     = 10·(X+Y) − 835           (restriction 0, gsTopY = 860)
                     = 10·(X+Y) − 1305          (restriction 1, gsTopY = 1330)    (inferred from §1.3)
Z_SUBLAYERS = 8; LAND 0, OBJECT 1, SHADOW 2, MERC 3, STRUCT 4, ROOF 5, ONROOF 6   :97-107
TOPMOST_Z_LEVEL = 32767                                                           RenderWorld.h:29
```

The z key is therefore `80·(X+Y) + sublayer + const`. Every tile in one screen row shares the same z for a given
layer.

### 3.2 Per-layer formula (static and dynamic share it; `RenderWorld.cc:710-885`)

`wy = GetMapXYWorldY(X,Y)` of the node's own tile:

| Layer | sZLevel | Restriction 0 (inferred) |
|---|---|---|
| LAND | `0` (not used: no z blit) | — |
| OBJECTS, tile `CLIFFHANG_TILE` | `0` (`:754-757`) | 0 |
| OBJECTS, tile `OBJECTLAYER_USEZHEIGHT` | `8·wy + 0` (`:758-762`) | 80(X+Y) − 6680 |
| OBJECTS, other | `1` (`:763-766`) | 1 |
| SHADOWS | `max(8·(wy − 80) + 2, 0)` (`:772-775`) | max(80(X+Y) − 7318, 0) |
| STRUCTS | `8·wy + 4` (`:781-842`; no special flags in the static map) | 80(X+Y) − 6676 |
| ROOF | `8·(wy + 50) + 5` (`:849-855`) | 80(X+Y) − 6275 |
| ONROOF | `8·(wy + 50) + 6` (`:861-878`) | 80(X+Y) − 6274 |
| TOPMOST | `32767` (`:742-744`) | 32767 |
| *(merc, for reference)* | `8·wy + 3` (`:1077`) | 80(X+Y) − 6677 |

- **`bZTileOffsetX/Y`** from the structure DB (`DB_STRUCTURE`) is used only for vehicle corpses and multi-tile soldiers
  (`:785-794, 1043-1051`), and in the ZStrip setup of `STRUCTURE_MOBILE | STRUCTURE_CORPSE` frames (`Structure.cc:1563-1575`).
  **Static tiles do not use it.**
- **Wrap-around.** `sZLevel` is `INT16` and the blitters take `UINT16`, so a negative z wraps to ~65 000, i.e. "nearest
  of all".
  - **(inferred)** With restriction 0, structures, roofs and USEZHEIGHT objects on rows `X+Y <= 83` get wrapped z. These
    rows sit at the extreme top edge of the scrollable area.
  - Multi-Z strips are computed in `int` and cast to `UINT16` the same way (`:2369, 2482`).
  - Emulate with `z16 = z & 0xFFFF` if exactness at the top border matters.
- **Shadow clamp.** A shadow clamped to 0 never passes the strict `zbuf < z` test, because zbuf is ≥ 0. **(inferred)**
  With restriction 0, shadows on rows `X+Y <= 91` are therefore invisible.
- **Consequences (inferred, from the formulas).**
  - A roof of row *s* hides structs of rows `s+1 .. s+5` and loses to structs of rows `>= s+6` (strips aside).
  - Structs drawn after shadows cover shadow pixels cast from tiles up to 8 rows in front of them. A shadow pixel cast
    from 9+ rows in front makes the struct pixel fail the test, so the darkened ground stays visible.
  - Shadows darken all constant-z objects (z = 1).

### 3.3 Blitter selection and comparison

Selection: `RenderWorld.cc:1242-1477`. "Not_Clipped" uses the `Blt8BPPDataTo16BPPBuffer…` variant, "Partially_Clipped"
uses `Blt…(ClipInfo)`. Both compare the same way.

| Case | Blitter | Pass condition | Writes z | Colour |
|---|---|---|---|---|
| STATIC_LAND | `…Transparent` / `BltTransparent` | always | — | `pal[shade][idx]` |
| STATIC_OBJECTS, ROOF, ONROOF, TOPMOST; STRUCTS without `MULTI_Z_TILE` | `…TransZ` / `BltTransZ` | `zbuf <= z` (`VObject_Blitters.cc:502, 1546`) | yes | `pal` |
| STATIC_SHADOWS | `…ShadowZ` / `BltShadowZ` | `zbuf < z` (`:1178, 1272`) | yes | `dst = ShadeTable[dst]` (§4) |
| STATIC_STRUCTS, `MULTI_Z_TILE`, not `WALL_TILE` | `BltTransZInc` | per strip, `zbuf < zstrip` (`RenderWorld.cc:2529`) | yes | `pal` |
| STATIC_STRUCTS, `MULTI_Z_TILE` and `WALL_TILE` | `BltTransZIncSameZBurnsThrough` | `zbuf <= zstrip` (`:2564`) | yes | `pal` |
| OBSCURED pass, non-multi-Z (SHOW_THROUGH structs and onroof) | `…TransZPixelateObscured` | if `zbuf < z`: draw and write; else draw only where `(x&1)==(y&1)`, no z write. Screen coords; this assumes a 4-byte-aligned frame buffer (inferred) (`VObject_Blitters.cc:430-436, 3109-3114`) | partly | `pal` |
| OBSCURED pass, multi-Z | `BltTransZIncObscure` | `zbuf < zstrip` **or** `(x&1)==(y&1)`; writes z in both cases (`RenderWorld.cc:2600-2604`) | yes | `pal` |
| Dynamic layers (DYNAMIC_TILE, animated): OBJECTS, STRUCTS, ROOF, ONROOF, TOPMOST | `…TransZNB` / `BltTransZNB` | `zbuf <= z` (`VObject_Blitters.cc:1653`) | no | `pal` |
| Dynamic STRUCTS with `MULTI_Z_TILE` | `BltTransZInc` | `zbuf < zstrip` | **yes** | `pal` |
| DYN_SHADOWS | `…Shadow` / `BltShadow` | always (no z) (`:1935, 2169`) | no | `ShadeTable` |
| `LEVELNODE_REVEAL` nodes (dynamic) | `…TransZNBTranslucent` | `zbuf <= z` (`:106, 182`) | no | 50 % blend (§4) |

- **Roof shadows.** The roof layer would use the shadow blitter for `ROOFSHADOW_TILE` (`RenderWorld.cc:733-736`), but no
  code ever sets that flag, so the case can be ignored.
- **Multi-Z only in the structure layer.** `fMultiZBlitter` is set only in the STRUCTURES case (`:726`). A multi-tile
  image in another layer gets one z.
- **Missing strip info.** A `MULTI_Z_TILE` frame without `ZStripInfo` is not drawn at all; only a warning is logged
  (`:2356-2367`).

### 3.4 ZStripInfo

**Struct** (`VObject.h:13-19`): `pbZChange[16]`, `bInitialZChange`, `ubFirstZStripWidth`, `ubNumberOfZChanges`.

**When it exists** (`Structure.cc:1453-1692`, called from `LoadTileSurface` when a `.jsd` sits next to the `.sti`,
`Tile_Surface.cc:32-47`):
- The `.jsd` must contain at least one structure with a tile at `sPosRelToBase != 0` (`:1459-1477`).
- A frame gets info only if its DB structure has `ubNumberOfTiles > 1`, and it is not a door unless it is a garage door
  (`:1545-1548`).
- `TileDef.cc:72-74` then flags exactly those tile elements `MULTI_Z_TILE`.
- The image is drawn once, from the levelnode on the structure's base tile. The other tiles have only STRUCTURE records
  (`WorldMan.cc:519-533`).
- **(inferred, from the strip construction)** The base tile is the front, bottom-most tile of the footprint.

**Construction for static tiles** (no MOBILE/CORPSE adjustment). Coordinates are frame-local; the base tile's bottom
vertex is at frame x = `20 − sOffsetX`:

```
if sOffsetX <= 0:
    right = width + sOffsetX − 20
    if right >= 0: left = −sOffsetX + 20                       // straddles the bottom vertex
    else:          left = width − (right % 20); right = 0      // all on the left side
elif sOffsetX < 20:
    left = 20 − sOffsetX; right = width − left
    if right <= 0: right = 0; left = 20
else: left = 0; right = width
nInc = left > 0 ? left/20 : 0
nStable = right > 0 ? 1 : 0;  nDec = right > 20 ? right/20 : 0
if left > 0:  first = left % 20; if first == 0: first = 20; nInc--
else:         first = sOffsetX > 40 ? 20 − (sOffsetX−40) % 20 : 40 − sOffsetX
              if first == 0: first = 20; nDec--
pbZChange = [+1]*nInc ++ [0]*nStable ++ [−1]*nDec ++ zeros (to 16)
bInitialZChange = nInc > 0 ? −nInc : (nStable > 0 ? 0 : −nDec)
```

Source lines: `Structure.cc:1579-1687`.
- All divisions are C integer divisions. `%` takes the sign of the dividend, so in the "all on the left side" case
  `right % 20` is ≤ 0 and `left` ends up ≥ `width`.

**Application** (`MultiZBlitter`, `RenderWorld.cc:2340-2503`; `Z_STRIP_DELTA_Y = 8·10 = 80`, `HALF_TILE = 20`,
`:2332-2333`). Without clipping, a column at frame-local x gets:

```
z(strip 0)   = base + 80·bInitialZChange              for x in [0, first)
z(strip k+1) = z(strip k) + 80·pbZChange[k]           for x in [first + 20k, first + 20(k+1))
```

Here `base` is the layer z of §3.2, i.e. `8·wy + 4` for structs. Rows do not change z.

**Worked example (inferred).** `sOffsetX = −60`, `width = 140`:
- the bottom vertex is at x = 80;
- `left = 80` gives nInc 4, then first = 20 and nInc 3;
- `right = 60` gives nStable 1 and nDec 3; init = −3.
- Strips: [0,20) base−240, [20,40) −160, [40,60) −80, [60,80) base, [80,100) base, [100,120) −80, [120,140) −160.

In words: the 40 px above the base tile carry the base z, and z drops by 80 (one row) per 20 px further out.

**For the WebGL renderer.** Precompute per frame a list `(x0, x1, dz)` and emit one quad per strip, with depth
`base + dz`. These are exactly the "20 px strips". Only the first strip has a different width.

### 3.5 Mapping to a GPU depth buffer (inferred)

- **Depth values.** Use `DEPTH_COMPONENT32F` (or 24-bit), clear to 0, and set depth = `z16 / 65536`. Integer z values
  stay distinct and keep their order.
  - `zbuf <= z` → `gl.depthFunc(GEQUAL)`.
  - `zbuf < z` → `GREATER`.
  - LAND: depth test and depth write off.
  - Dynamic NB layers: depth mask off.
- **Draw order.** GL guarantees primitive order for depth and blending. Submitting quads in exactly the order of §2
  therefore reproduces the result, including ties between equal z values. Ties are common: every tile in a row has the
  same z.
- **No single-func encoding.** Strict and non-strict tests cannot be folded into one depth func while still writing the
  same z (I checked: impossible with one comparison and written = tested value). Split draw calls whenever the compare
  func changes. In pass 4 that happens only around multi-Z non-wall structs and between layers. Cache the static result
  in a texture while the camera is still.
- **Shadows.** Depth `GREATER` with write enabled; blend `dst × 0.48` (e.g. `blendFunc(ZERO, SRC_COLOR)` with the shader
  outputting 0.48 for every opaque texel). Because of the strict test, overlapping shadows *of the same row* darken once,
  while shadows of different rows darken again (0.48²).
- **Obscured blitter.** Draw twice per sprite:
  1. depth `GREATER` with write;
  2. depth `ALWAYS`, `discard` where `(gl_FragCoord.x + gl_FragCoord.y)` is odd, writing z only for the multi-Z variant.

  Here x,y are original-screen pixel coordinates (top-left origin).

---

## 4. Shadows and translucency

- **Shadow blit.** Every opaque pixel of a shadow sprite replaces the destination with `ShadeTable[dst]`. The sprite's own
  palette and the node's shade level are ignored (`VObject_Blitters.cc:1178-1182`).
- **`ShadeTable`** is built once at init (`Init.cc:68` → `Shading.cc:20-35`) with `guiShadePercent = 0.48f`
  (`Shading.h:6`; only the editor changes it). Per 8-bit channel `c` (stepping by 4):
  `ShadeTable[565(c)] = 565((UINT8)(c·0.48))`.
  - In RGB565 terms: R5 → `trunc((8·R5+4)·0.48) >> 3`; G6 → `trunc(4·G6·0.48) >> 2`; B5 like R5. **(inferred)** The
    last write per 5-bit index wins, i.e. the `8k+4` input.
  - The header comment says "25 % darker"; the actual factor is 0.48.
- **Overhead map.** It draws shadows always, with the non-z shadow blitter (`Overhead_Map.cc:581-593`).
- **Translucency** (`LEVELNODE_REVEAL`, dynamic pass only). The result is `((pal >> 1) & mask) + ((dst >> 1) & mask)`,
  where `mask = 0x7BEF` for RGB565 (each channel's top bit cleared): a 50 % average (`VObject_Blitters.cc:184-186`;
  `Video.cc:576`).
  - The static map never sets REVEAL. It comes from cover display, `ANITILE_ALWAYS_TRANSLUCENT` and similar
    (`DisplayCover.cc:343`, `Tile_Animation.cc:123`).
  - `LightHideWall` only *clears* it (`Lighting.cc:1556, 1565`).
- **Show-through dither.** `LEVELNODE_SHOW_THROUGH` triggers the checkerboard "show-through" of the obscured pass
  (§3.3). It is set on revealed-room obstacles (§5) and on items.

---

## 5. Roofs and hiding

- **At load,** `gubWorldRoomHidden[*] = TRUE` (`WorldDef.cc:2321`) and no node is HIDDEN, so **all roofs are drawn**.
  `gubWorldRoomInfo[25600]` (room id per tile, 0 = `NO_ROOM`) is read from the map (`WorldDef.cc:2307`).
- **Revealing a room.** A merc sees into the room (`FOV.cc:646`) or it is blown open (`Explosion_Control.cc:1897`).
  `RemoveRoomRoof(room)` then calls `SetGridNoRevealedFlag(g)` for every tile of that room (`Render_Fun.cc:176-225`):
  - Sets HIDDEN on roof-layer nodes of types `FIRSTROOF..FOURTHROOF` on g (`:76`).
  - If g is in a room, sets HIDDEN on roof-layer nodes with `AFRAME_TILE` on g, g+160 and g+1 (`:79-93`;
    `SetStructAframeFlags` scans the **roof** layer, `WorldMan.cc:1539-1552`). AFRAME tiles are wall pieces
    `FIRSTWALL..FOURTHWALL47`, sub-indices `WALL_AFRAME_START..END` (`TileDat.cc:678-685`).
  - Sets `MAPELEMENT_REVEALED` (`:96`).
  - For each STRUCTURE on g that is an on-ground obstacle (`STRUCTURE_OBSTACLE` = generic, tree, fence or vehicle;
    not person or corpse), or a slanted roof: puts `LEVELNODE_SHOW_THROUGH` on its base levelnode. Slanted roofs also
    get HIDDEN (`:101-125`; flags in `Structure_Internals.h:121`).
  - Sets `gubWorldRoomHidden[room] = FALSE` (`:127`).
- **Re-applying on visits.** Revealed tiles are persisted in the sector temp file and re-applied with
  `SetGridNoRevealedFlag` on later visits (`SaveLoadMap.cc:488`).
- **On-roof layer.** No code path hides ONROOF nodes on reveal **(fact by absence; inferred: on-roof objects stay
  visible over a revealed room — verify in game)**.
- **Roof interface level.** `gsRenderHeight += 50` and `SHOW_ALL_ROOFS`, so HIDDEN `ROOF_TILE` nodes are drawn again
  while HIDDEN AFRAME walls are not (`Handle_UI.cc:1134-1145`, `RenderWorld.cc:1114-1117`). `ROOF_TILE` covers types
  `FIRSTROOF..SECONDSLANTROOF`, `FIRSTHIGHROOF` and `SECONDHIGHROOF` (`TileDat.cc:751-756`).
- **Wireframes are part of the static picture.** `InitLoadedWorld` calls `CalculateWorldWireFrameTiles(TRUE)` on every
  map load (`WorldDef.cc:1644-1658`). Room reveals and explosions recompute them locally (`Render_Fun.cc:224`,
  `Explosion_Control.cc:1435`).
  - **Placement** (`WorldDef.cc:2669-2825`). Only tiles that are not under an unrevealed roof get any. For each such
    tile, every door, window or wall structure gets a `WIREFRAMES*` tile appended to that tile's **TOPMOST** list
    (`AddWireFrame`, `:2611-2620`) when the neighbour across the wall is roofed: the S neighbour for `ORIENT_LEFT`, the E
    neighbour otherwise. Doors and windows additionally require that neighbour to be unrevealed. Corner pieces are
    added as well.
  - **Rendering.** WIREFRAMES is the last tile type, outside the `DYNAMIC_TILE` UI range (`TileDat.h:3118`,
    `TileDat.cc:688-691`). It is therefore drawn in static pass 4 with TOPMOST z 32767, on top of everything.
  - **Option flag.** `LEVELNODE_WIREFRAME` is set only when the neighbour is already revealed, and only flagged nodes
    obey the wireframe option (default on). With default options every wireframe tile is drawn.
  - **(data)** `tilesets/0/wirefram.sti` holds 13 thin white wall and door outlines, e.g. #9 is 20×55 at (17,−35).
  - **(inferred)** At load this outlines the walls between outdoor tiles and roofed buildings. Verify visually before
    deciding whether v1 needs it.

**v1 rule:** draw every roof and on-roof node, plus wireframes if verified. Once room revealing exists: for each revealed room, skip
`FIRSTROOF..FOURTHROOF` roof nodes, AFRAME roof nodes (on the tile and its S and E neighbours) and slanted-roof structs
on its tiles, and move obstacles there to the obscured pass.

---

## 6. Lighting of static tiles

### 6.1 `ubShadeLevel`

A shade index into 16 palettes, 1 = lightest, 15 = darkest; `SHADE_MAX = 1`, `SHADE_MIN = 15` (`Lighting.h:41-42`).

- **Ambient.** `LightSetBaseLevel(a)` sets `natural = shade = clamp(a, 1, 15)` on every node of LAND, OBJECT, STRUCT,
  MERC, ROOF, ONROOF and TOPMOST. The **shadow layer is not touched**, which is irrelevant since shadows ignore the
  palette (`Lighting.cc:1360-1386, 808-832`).
- **Light sprites.** `LightSpriteRenderAll()` resets every node to its natural level and redraws every active, powered
  light sprite (`:1885-1898`).
- **Light per node.** `ubMaxLights = max(ubMaxLights, add)` and `shade = clamp(natural − ubMaxLights, 1, 15)`. It is the
  strongest light that counts, not the sum (`:535-550`).
- **Which layers a light affects** (`:586-692`):
  - Normal lights: STRUCT nodes (with orientation filters for walls and doors; never `FIRSTCLIFFHANG`), LAND, OBJECT and
    MERC.
  - `LIGHT_SPR_ONROOF` lights: ROOF and ONROOF only.
- **New nodes** start at the current ambient (`WorldMan.cc:26-36`).

### 6.2 Ambient level

- **Above ground:** `GetTimeOfDayAmbientLightLevel()` (`WorldDef.cc:2344-2347`).
  - Normal value: `gubEnvLightValue`. Hot sectors at hot hours: 2 (`Environment.cc:110, 369-379`).
  - Day 3, night 12 (`Environment.h:21-22`).
  - Dawn ramps from 11 down to 3 in steps of 2 minutes from 06:47; dusk ramps from 4 up to 12 from 20:57
    (`Environment.cc:26-29, 245-248, 273-276`).
- **Underground maps** (`MAP_AMBIENTLIGHTLEVEL_SAVED`) store `gfBasement`, `gfCaves` and the level in the map
  (`WorldDef.cc:2334-2339`). The editor and map utility use 4.
- **Shadows** are drawn only while the ambient is < 8 (§2.1).

### 6.3 Map light sprites (v1 can skip)

- **Map file data** (`LoadMapLights`, `WorldDef.cc:2911-2946`; `LoadSaveLightSprite.cc:10-58`):
  - light colours (`LColors[0]` is used);
  - per light: tile X/Y, flags and a template name.
- **Templates** (`LTO1..8.LHT` etc.) come from `assets/externalized/light-templates.json`. Each holds ray lists of
  `(dX, dY, flags, ubLight)` nodes; omni templates decay 0.9 per tile (`Lighting.cc:866-886`, `Lighting.h:24-26`).
- **Drawing.** `LightDraw` walks the rays and stops a ray at blocking walls, doors and big obstacles. That logic is
  Stracciatella's `IlluminationFilter` (`Lighting.cc:297-462, 1401-1519`).
- **Power.** Lights flagged `LIGHT_NIGHTTIME` or `LIGHT_PRIMETIME` are powered only 21:00–07:00 or 21:00–24:00
  (`Environment.h:8-11`, `WorldDef.cc:2927-2939`). In caves all lights start off and switch on when seen
  (`Fog_Of_War.cc`).

### 6.4 Palettes (tile surfaces)

- **When built.** `LightSetColor(&LColors[0])` (or black by default, `Lighting.cc:196-200`) → `BuildTileShadeTables()` →
  `CreateTilePaletteTables(vo)` for each newly loaded tile surface (`Lighting.cc:1781-1806`; `WorldDef.cc:262-281`;
  `Lighting.cc:2051-2061`).
- **How built:**

```
LightPal[i] = min(Pal[i] + lightColour, 255)            per channel   (AddSaturatePalette, Lighting.cc:2007-2018)
shade 0   : lum = (299r + 587g + 114b) / 1000;  c = min(500·lum / 256, 255)  for r,g,b   (mono, :2024)
shade s≥1 : c.r = min(S[s].r · r / 256, 255) etc. (integer division)                      (:2025-2029)
16-bit    : RGB565 = (r>>3)<<11 | (g>>2)<<5 | (b>>3); if result==0 && r+g+b != 0 → 0x0001
            (Create16BPPPaletteShaded / Get16BPPColor, HImage.cc:96-153; RGB565 surfaces, Video.cc:126-181)
```

`S[s]` is `gusShadeLevels` (JA2 Gold values, `Lighting.cc:154-172`):

| s | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R | 500 mono | 450 | 350 | 300 | 255 | 231 | 209 | 187 | 165 | 143 | 121 | 99 | 77 | 36 | 18 | 48 |
| G | 500 mono | 450 | 350 | 300 | 255 | 199 | 185 | 171 | 157 | 143 | 121 | 99 | 77 | 36 | 18 | 222 |
| B | 500 mono | 450 | 350 | 300 | 255 | 199 | 185 | 171 | 157 | 143 | 129 | 115 | 101 | 244 | 224 | 48 |

- **Normal = 4**, i.e. ×255/256, so 255 → 254. Levels 13–15 are tinted special tables. **(inferred)** Normal lighting
  never reaches them, because ambient tops out at 12; strong darkening is not in the map data.
- **Light colour.** Almost every map uses black, i.e. no tint (vanilla saved the cache only for black,
  `vanilla:TileEngine/Lighting.c:3168`).
- **Palette texture recipe (inferred).** Build a 256 × 16 texture per tile surface, index × shade → RGB, using the
  formula above. Quantise through 565, then expand back to 8 bits for exact colours.
- **`.sha` files.** Stracciatella never reads `Data/ShadeTables/*.sha`. Vanilla used them as a cache
  (`vanilla:TileEngine/ShadeTableUtil.c:111-148`): per tile-surface file, 16 × 256 × UINT16 in the format recorded in
  `RGBDist.dat`.
  - **(data)** 306 files of 8192 bytes; `RGBDist.dat` = masks F800/07E0/001F, i.e. RGB565.
  - They make a ready test oracle for shades 1–15. Shade 0 may differ by luminance rounding: vanilla truncates each
    term.

---

## 7. Screen → grid picking

`UpdateCurrentCursorTarget` → `GetMouseXY` → `GetMouseWorldCoords` (`Handle_UI.cc:612-622`;
`Isometric_Utils.cc:141-207`):

```
require mouse inside the viewport region
offX = mouseX − cx;  offY = mouseY − cy + 10
cellX = floor((offX/2 + offY)/2);  cellY = floor((offY − offX/2)/2)     // float math
wx = rcx + cellX;  wy = rcy + cellY
if wx∉[0,1600) or wy∉[0,1600): NOWHERE
gridno = (wy/10)*160 + wx/10                                           // MAPROWCOLTOPOS
```

- **(inferred)** This is the exact inverse of §1.5: the north vertex `(ox+20, oy)` maps to cell `(10X, 10Y)`, so the
  diamond of tile (X,Y) picks (X,Y).
- **Height is ignored.** Neither `sHeight` nor `gsRenderHeight` enters the formula. Picking is correct for tiles at the
  base height. On roof level the +50 render shift makes the roof diamond of a tile appear exactly where the formula picks
  it.
- **The original tile cursor** is a `FIRSTPOINTERS*` tile added at the tail of the TOPMOST list of the picked gridno,
  with shade 4 (`Interface_Cursors.cc:244-264`).
  - That range is `DYNAMIC_TILE | OBJECTLAYER_USEZHEIGHT` (`TileDat.cc:688-691`), so it is drawn in the dynamic topmost
    pass with z 32767.
  - It is raised by the tile's `sHeight` like any node, so on raised tiles it shows above the mouse point
    **(inferred)**.
- **Visible-tile test** (also used by the radar): `GridNoOnVisibleWorldTile` (`Isometric_Utils.cc:544-557`).

---

## 8. Radar map

- **File:** `radarmaps/<map name>.sti`, where the map name is `GetMapFileName(sector)` with the extension replaced. For
  example `A9.dat` → `radarmaps/a9.sti`, basement `A10_b1.sti`, alternate `_a`, Meduna meanwhile `_m`
  (`Radar_Screen.cc:80-97`; `DefaultContentManager.cc:87, 272-277`; `StrategicMap.cc:314-343, 867-869`).
  - **(data)** One frame, 88×44, offset (0,0), which equals `RADAR_WINDOW_WIDTH/HEIGHT` (`Radar_Screen.h:12-13`).
- **Position:** `RADAR_WINDOW_X` = team panel x + slot widths + 45; `RADAR_WINDOW_TM_Y = H − 107` (`UILayout.cc:52-53`).
- **Shading:** shade 0 = palette ×255/256; at night (before 07:00 or from 21:00, surface only) shade 1 = ×100/256
  (`Radar_Screen.cc:91-93, 205-215`; `Game_Clock.cc:898-901`).
- **Scale:** `gdScaleX = 88 / (gsRightX − gsLeftX)`, `gdScaleY = 44 / (gsBottomY − gsTopY)`
  (`RenderWorld.cc:2157-2158`). That is 88/3180 and 44/1540 for restriction 0. **(inferred)** The image spans the
  scrollable rectangle of §1.3.
- **Viewport rectangle:** a green (0,255,0) outline (`RectangleDraw`; `Radar_Screen.cc:235-240`):

```
x1 = RX + max(0, round((gsTopLeftWorldX + 30)·sx))
y1 = RY + max(0, round((gsTopLeftWorldY + 50)·sy))
x2 = RX + min(round((gsBottomRightWorldX + 20)·sx − 1), 87)
y2 = RY + min(round((gsBottomRightWorldY + 70)·sy − 1), 43)
```

- **Soldier dots:** 2×2, at `floor(GetAbsoluteScreenXYFromMapPos(g) · scale)` (`Radar_Screen.cc:257-279`;
  `Isometric_Utils.cc:209-233`). That function's y equals `wy` of §3.1, about 45 px lower than the tile's north vertex in
  the `gsTopLeftWorldY` frame **(inferred; the radar is approximate)**.
- **Click to centre:** `(rel − 44, rel − 22) / scale` is rounded to whole steps of 40 / 40 px, converted to cells and
  passed to `SetRenderCenter(800 + …)` (`Radar_Screen.cc:311-348`).

---

## 9. Other things a reimplementation must know

1. **Pixel format.** All original output is RGB565 (`Video.cc:129-181`). Palettes, shadow halving and translucency are
   all defined on 565 values. Expect ±1 LSB differences unless you emulate them.
2. **No frame clear.** The static render does not clear the frame buffer; the scroll limits keep the view on the map.
   Clear to black. In the editor, out-of-world tiles are painted black (`RenderWorld.cc:1494-1509`).
3. **Off-map positions.** The sweep visits positions with X or Y outside 0..159. If `r*160 + c < 25600`, the wrong tile
   (row-wrapped) is drawn there (`Isometric_Utils.h:47`). **(inferred)** Such positions lie in the diamond's corners,
   beyond the scroll limits, so in practice: skip out-of-range X/Y.
4. **Restricted maps.** `ubRestrictedScrollID = 1` changes the scroll rectangle, `gsTopY` (hence the z constant and its
   clamps) and the radar scale. The overhead map additionally paints black borders (`Overhead_Map.cc:704-725`).
5. **Layers absent from the map file.** MERC and TOPMOST are never in the file. Object types `>= FIRSTPOINTERS` are
   skipped on load (`WorldDef.cc:2159, 2182`). Roof nodes `SLANTROOFCEILING1` are not saved (`:1428`).
6. **Trees.** `FIRSTFULLSTRUCT1..SECONDFULLSTRUCT12` come in triples (`TileDat.cc:655-663`):
   - frame 0 = `FULL3D_TILE` (whole tree);
   - frame 1 = `DYNAMIC_TILE` (dynamic pass only);
   - frame 2 = plain.

   With the "tree tops" option off, every FULL3D node in the struct layer is drawn as `usIndex + 2`
   (`LEVELNODE_REVEALTREES`, `WorldMan.cc:1608-1641, 1670-1685`; `RenderWorld.cc:503-505`). The option defaults to on
   (`GameSettings.cc:161`).
7. **`OBJECTLAYER_USEZHEIGHT`** (object layer z = `8·wy`) applies to:
   - debris files `bones, bones2, grass2, grass3, l_weed3, litter, miniweed, sblast, sweeds, twigs, wing`, when loaded
     into `DEBRISWOOD`, `DEBRISWEEDS`, `DEBRIS2MISC` or `ANOTHERDEBRIS` (`Tile_Surface.cc:92-120`, `TileDat.cc:649-652`);
   - UI elements, blood, item graphics, and `FIRSTEXPLDEBRIS..SECONDEXPLDEBRIS` (`TileDat.cc:688-718`).

   All other objects use the constant z = 1, i.e. plain painter's order among themselves, under everything with z.
8. **`CLIFFHANG_TILE`** objects use z 0: they lose to every earlier z = 1 object pixel (`zbuf <= 0`). They also ignore
   world height via `IGNORE_WORLD_HEIGHT`.
9. **`WALL_TILE`** covers `FIRSTWALL1..FOURTHWALL65` (`TileDat.cc:672-675`). It matters only together with
   `MULTI_Z_TILE` (the `<=` strip blitter).
10. **`UNDERFLOW_FILLER`** database entries, where a type has fewer frames than `gNumTilesPerType`, draw frame 0 of the
    surface (`TileDef.cc:153-164`).
11. **Tile database layout.** Tile index = `gTileTypeStartIndex[type] + subIndex − 1`, and type order follows
    `TileTypeDefines` (`TileDef.cc:240-245`, `TileDat.h:2923-…`). Surfaces come from `tilesets/<id>/<file>.sti`, falling
    back to the default tileset (0, or JA25's) when a tileset leaves a type empty (`WorldDef.cc:193-234`).
12. **Overhead map** (`Overhead_Map.cc:471-734`):
    - uses 1/5-scale tiles from `tilesets/<id>/t/*.sti` (8×4 land, **(data)**) with the same shade tables;
    - steps 8 px per tile and 2 px per row; heights are divided by 5;
    - is pure painter's order with no z: land; then per row objects, shadows, structs; then non-hidden roofs.
13. **Frame-to-frame state.** Static rendering is a pure function of the map, the node flags, the camera,
    `gsRenderHeight`, shade levels and the shadow flag. Light changes trigger a partial "marked" re-render that does
    *not* clear the z-buffer (`RenderWorld.cc:1789-1816`). Treat the full render as canonical.

---

## 10. Open points to verify against the running game

- That on-roof decorations stay visible after a room's roof is removed (§5).
- What the load-time wireframe outlines look like over unrevealed buildings (§5).
- Wrapped z and missing shadows at the top border of the scroll area (§3.2). These are visible only when scrolled fully
  up.
- Any sprites taller than the 200 px sweep margin near the bottom edge (§2.2).
- A pixel diff of a palette built per §6.4 against the vanilla `.sha` files, for one tileset.
