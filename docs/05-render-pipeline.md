# 05 — Tactical world rendering

How the client draws the tactical world: the original's layers, sweep order and z-buffer, shadows, roofs, room reveals
and wireframes, tile shading, the camera, picking and the radar geometry, and ja2-node's WebGL2 renderer with its
partial redraws. Siblings: `06` soldier sprites, palettes, screen position and z; `20` light levels, which the client
computes with the simulation's functions; `28` the player UI layer, the logical framebuffer, canvas scaling and the
frame skip; `30` the tactical screen around the world (panels, radar, cursors and markers); `07` structures and the
render bounds of a map; `12` and `34` the explosions and thrown objects the effects show. Each module's `@src` header
names the Stracciatella functions it ports; read those for the z formulas, the node filters and the strip construction.

## 1. The path of a frame

Paths are under `src/` (`render/world/` for bare names).

```
map load: layers, tile database, structures, surfaces   content/world/, app/world/world-loader.ts renderWorldOf
  land start, shadow lists, render height, no-burn      level-render-data.ts
  atlas and palette rows                                world-sprites.ts, render/array-atlas.ts, render/palette-rows.ts
  StaticScene: instances per segment and row            static-scene.ts
every frame: the view → WorldFrameInput                 app/tactical/world-presenter.ts,
                                                        app/world/tactical-world-view.ts
  lighting → land and roof shade per tile               app/world/world-lighting.ts
  WorldRenderer.render                                  world-renderer.ts
    tile changes, revealed rooms, doors, options        tile-changes.ts, reveal.ts → rebuilt rows
    visible rows from the camera and the row reach      geometry.ts, camera.ts
    DynamicScene.build                                  dynamic-scene.ts, fed by app/world/ (soldiers, effects, bullets)
    PictureMemo: same | shift and rectangles | whole    picture-memo.ts, dirty-rects.ts
    static segments, items, dynamic runs                world-program.ts, world-framebuffer.ts
  present into the UI's logical framebuffer             app/game/game-page.ts (28)
```

| Module | Holds |
|---|---|
| `geometry.ts`, `camera.ts` | Z levels, world y, tile positions, visible rows, picking; the render centre, scroll limits and scrolling |
| `level-render-data.ts` | What the original's loader leaves behind: the land start node, the shadow lists after `OptimizeMapForShadows`, `gsRenderHeight`, the no-burn tiles |
| `static-scene.ts` | The static layers: node filters, segments, z strips, the obscured pass |
| `dynamic-scene.ts` | Dynamic and animated map nodes, soldiers, items, corpses, smoke, effect nodes and UI nodes, every frame |
| `reveal.ts`, `tile-changes.ts` | Room reveals as node flags and wireframes; structure changes and blood pools |
| `world-program.ts`, `instances.ts`, `world-framebuffer.ts` | The shader, the draw states, the instance records, the framebuffers |
| `picture-memo.ts`, `dirty-rects.ts`, `partial-redraw-check.ts` | Partial redraws and their check |
| `glow.ts`, `soldier-fade.ts`, `soldier-palettes.ts`, `picking.ts` | Soldier presentation (`06`) |
| `content/world/zstrip.ts`, `shading.ts`, `render-bounds.ts` | ZStripInfo, the shade palettes, the scroll rectangle and absolute screen frame (shared with the simulation) |
| `app/world/` | Loading, client lighting, the soldier scene, corpses and smoke (`world-effects.ts`), misses, trails and explosions (`effect-animations.ts`), bullets and thrown objects (`bullet-nodes.ts`), the radar geometry (`radar.ts`), display options |
| `app/tactical/overhead-map.ts` | The overhead map, composed once per sector from the small tiles |
| `devtools/map-viewer/` | A developer page that renders any map with picking |

Tile types, full base tiles and shadow buddies: `data/tables/tiles.json`; tile flags: `content/world/tile-database.ts`.

## 2. Design

**The original's model.** The original sweeps screen rows (constant X+Y) top to bottom, X ascending inside a row:
land, objects and shadows in sweeps of their own, then structures, roofs, on-roof and topmost interleaved per row, then
a pass for the shown-through obstacles of revealed rooms; the dynamic layers follow every frame. Every sprite carries a
z of 8 × world y + sublayer, where world y depends on X+Y only and never on height, and each layer's blitter tests
and writes a 16-bit z-buffer its own way (`<`, `<=` or not at all, writing or not). Multi-tile structures carry
ZStripInfo: 20 px strips whose z drops by a row per strip away from the base tile, which is how a soldier stands behind
a wall. ja2-node keeps the z values, the tests and the order.

**One quad per sprite on a depth buffer.** Depth is z / 65535 in a 24-bit buffer cleared to 0, so integer z values stay
distinct and ordered; each blitter's test becomes a depth function and mask (`DrawState`), and GL's primitive order
settles equal z as the sweep does. Strict and non-strict tests cannot share a function, so draw calls split where the
state changes. A multi-Z sprite is one quad per strip. Sprites are pulled by `gl_VertexID` from a float texture with
plain `drawArrays`: no instancing, which SwiftShader (headless CI) pays per instance.

**The static scene is built once, by segment and row, without the camera.** Positions are world pixels; camera, render
height and viewport are uniforms, and a frame draws the instance ranges of its visible rows. Where the original
interleaves structures, roofs, on-roof and topmost per row, ja2-node draws segment by segment: every segment writes
depth and z modulo 8 is the sublayer, so sprites of different segments never tie, except plain structures (`<=`)
against strict strips (`<`), where the plain one wins in either order; ties inside a segment keep the sweep order. A
change rebuilds only the rows it touches (doors, revealed rooms, tile changes); the tree-top, wireframe and roof-level
switches rebuild every row.

**Rows instead of the sweep window.** ja2-node draws every sprite of the visible rows, widened by as far as the map's
static sprites reach beyond their row, where the original skips sprites whose origin lies outside a window around the
viewport (deviation "Sweep window"). The shifted picture of a partial redraw relies on that margin.

**Shading in the shader.** Colour indices sit in one R8 texture array that tiles and soldier sheets share, palettes in
a growing texture with 16 shaded rows per tile surface, built like the original's (quantised through RGB565, expanded
like SDL) and checked against vanilla's `.sha` caches. A 160 × 160 texture holds the land and the roof shade of every
tile, and every node of a tile takes one of them (deviation "Light on structures"); the shades come from the
simulation's lighting run in the browser over the view's lights (`20`). Shadows and translucency blend 24-bit colour
(deviations "Shadow darkening", "Translucency"). Static shadows show only while the ambient is brighter than dusk, as
in the original.

**Partial redraws replace the save buffer and dirty rectangles**, so a still scene costs no GPU work (`28`).
`PictureMemo` compares the frame's global inputs and visible dynamic instances with the last frame's: a changed global
input (a static upload, the shade field, the render height, the roof and shadow switches, the viewport) redraws the
whole frame; otherwise the last picture shifts with the camera and only the uncovered strip and the rectangles of
changed instances are drawn. A shift must be even, because the dither pattern alternates per pixel; a tile-centred
camera always moves by even steps. `?worldCheck=1` draws every partial frame whole as well and compares the pixels.

**Logical pixels.** The world draws into its own framebuffer at the logical size of the tactical viewport, which
grows with the window as in Stracciatella, and is copied at scale 1 into the UI's logical framebuffer; the browser
scales the canvas by the integer UI scale (`28`). Dither parity, picking and the camera work in logical pixels.

**The camera is the original's render centre**, a cell position snapped to tile centres, so the view moves in whole
tiles. The scroll rectangle comes from the map's scroll restriction (`render-bounds.ts`, shared with the simulation
and the radar), and a map smaller than the view is centred. Picking is the exact inverse of the flat projection and
ignores tile heights and the render height, as the original's does: at the roof level the 50 px shift puts every roof
where the flat projection picks its tile.

**The picture is the client's.** Room reveals arrive as the view's `revealedRooms`; the client applies the original's
node flags and recomputes the wireframes of the whole map (`reveal.ts`). Structure changes, blood pools, corpses, smoke,
bullets and effect animations are drawn from the view and its events, and the simulation never waits for them. On the
stub pack an explosion shows only its light: the stubs have no explosion graphics.

**Not drawn**: animated and dynamic land (nor does the original draw it), the cover and line-of-sight tiles (`28`),
and the original's redundant-tile optimisation, which changes nothing visible.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/render/world/` and `src/app/world/`:

| Quirk | Test |
|---|---|
| Land draws from the full piece nearest the head of the list; the pieces below it never show | `static-scene.test.ts` |
| A tile without a full land piece shows no land | `static-scene.test.ts` |
| Near the top edge a negative z wraps to the nearest depth, while shadows there clamp to 0 and never draw | `static-scene.test.ts` |
| Multi-tile walls test their strips with `<=`, other multi-tile structures with `<` | `static-scene.test.ts` |
| A tree hemmed in by structures loses every shadow, the map's included; the map edge counts as a structure | `static-scene.test.ts` |
| The roof level shows the hidden roofs again, but not the hidden A-frame walls | `static-scene.test.ts` |
| On-roof objects stay over a revealed room | `static-scene.test.ts` |
| A wireframe towards a roofed tile not yet revealed always shows; only one towards a revealed tile follows the option | `reveal.test.ts` (original data) |
| Soldiers on roofs are drawn twice, in the struct-merc and the high-merc passes | `dynamic-scene.test.ts` |
| Corpses draw before every merc, at the z of the tile to the north-west | `dynamic-scene.test.ts` |
| A corpse on a roof sorts twice its on-roof offset up | `dynamic-scene.test.ts` |
| An item on a structure sorts at the structure z plus its height in z units, not world units | `dynamic-scene.test.ts` |
| A node at an absolute position (a bullet) is shifted a cell west, which puts it on its tile's box | `dynamic-scene.test.ts` |
| A miss frame lasts until more than its delay has passed | `effect-animations.test.ts` |

Not pinned yet:
- Cliff-hang objects sort at z 0, so they lose to every object pixel drawn before them.
- Buddy shadows go before the map's shadows, in reverse order of their structures, and are added in basements and
  caves outside floors: the loader tests `GridNoIndoors` before it knows the map is underground.
- Hiding the A-frame walls of a revealed tile includes the tiles south and east of it; at the east edge of the map the
  east one is the first tile of the next row.
- An explosion's translucency key frame 0 never applies: it is checked as a frame is entered.

## 4. Not checked against the native build

No oracle renders a frame, so the drawing order is checked against the code only. The e2e goldens
(`tests/e2e/goldens-tactical.spec.ts`) pin ja2-node's own picture on the stub pack, `tests/e2e/world-redraw.spec.ts`
partial redraws against whole ones, and the shade palettes are compared with vanilla's `Data/ShadeTables` (shade 0 may
differ by luminance rounding: vanilla truncates each term). Inferred from reading the source:
- Wrapped z and missing shadows show only with the view scrolled fully up.
- On-roof decorations stay over a revealed room: no code hides them.
- The original's start-tile arithmetic is exact only when the viewport centre's x is even and x/2 + y is even (640 ×
  480, 1024 × 768, 1280 × 720, 1920 × 1080); at other sizes its static layer sits 1–2 px off the soldiers, where
  ja2-node draws the exact projection.
- The sweep visits positions off the map and would draw their row-wrapped tile; they lie beyond the scroll limits.
- The obscured dither assumes a frame buffer aligned to 4 bytes, so its parity follows screen pixels.
- A light change makes the original redraw only the marked areas without clearing its z-buffer; ja2-node always draws
  whole frames.

Not ported: gaps "Overhead map", "Slanted roof ceilings", "No-burn tiles", "Cave lights". Other deviations of this
domain: "Sweep window", "Show-through order", "Translucency", "Shadow darkening", "Light on structures", "Wall
translucency template", "Bullets of unseen shooters", "Soldier frame on turning".
