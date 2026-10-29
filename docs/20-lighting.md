# 20 — Lighting

Light in the tactical simulation: light templates, light sprites and their ray casting, the true light level gameplay
reads, and when lights are drawn. Levels are shades, lower is brighter: 1 is the brightest, 15 the darkest, day is 3
and night 12. Siblings: `05` the renderer's shading, which the client computes with these functions; `06` a soldier's
shade; `08` vision, which reads the true level; `13` the AI's use of light; `12` the explosions and flares that own
light sprites; `15` the ambient level by time of day. Each module's `@src` header names the Stracciatella functions it
ports; read those for the template generator, the illumination filter and the ray walk.

## 1. The path of a light

Paths are under `src/sim/tactical/` unless they start with `src/`.

```
map load: initLighting                                          lighting/lighting.ts, tactical-sim.ts
  loadMapLights: one sprite per map light, powered by the hour
  lightSetBaseLevel(ambient): natural level, every light drawn again
  map items placed → lightSpriteRenderAll                       src/server/sandbox.ts, src/sim/campaign/sector-flow.ts
a sprite: lightSpriteCreate(template) → power → position        lighting/lighting.ts, lighting/templates.ts
  traceLight: the rays from the centre, illuminationFilter per step, light added to the land or roof sum
  move or destroy: the same walk with the filters stored at draw time, light subtracted
the clock: dawn and dusk steps, temperature, light switches     src/sim/campaign/campaign-sim.ts
  → setAmbientLight (everything drawn again) or power only      tactical-sim.ts
gameplay: lightTrueLevel(g, level)                              perception/, combat/, explosions/, ai/
```

| Module | Holds |
|---|---|
| `lighting/templates.ts` | The omni template generator, the conversion to Stracciatella's shipped form, the name lookup |
| `lighting/lighting.ts` | `LightingState` (ambient and natural level, land and roof sums per tile, 256 sprite slots), the filter and the ray walk, the sprite API, map lights and their schedule, `lightTrueLevel`, the light scaling of vision |
| `lighting/muzzle-flash.ts` | The light of a muzzle flash: opcode 441, its frame count, the early put-outs |
| `explosions/explosion.ts`, `explosions/light.ts` | The light of an explosion; flares and break lights (`12`) |
| `src/content/formats/lht.ts`, `load-content.ts` | `.LHT` files and Stracciatella's `light-templates.json` (`TacticalContent.lightTemplates`) |
| `save-import.ts` | Map lights for the saved hour, then the saved ambient level |
| `src/sim/knowledge/tactical.ts` | The agent's projection, lit from the view's `light` (`lightView`) |
| `src/app/world/world-lighting.ts` | The client's shade field: the same ray walk over the map lights, the view's dynamic lights and our mercs' lights (`05`) |

## 2. Design

**Gameplay reads one number per tile and level.** The original lights every level node of a tile and keeps a sum, a
maximum and a fake share per node, but gameplay reads only `LightTrueLevel`: the natural level minus the non-fake sum
of the head land node (the head roof node at the roof level), clamped to 1…15, or the raw ambient level on a tile
without that node. ja2-node keeps one land and one roof sum per tile and, per filter step, only the direction and the
blocked, nothing and oriented-only bits. Lighting structures by orientation, wall decals, cliff hangs and the detour to
an open door's base tile change only the picture (deviation "Light on structures").

**No fake lights.** A merc's own light at night is added to both the sum and the fake share and cancels out of the
true level, so the simulation does not create it; the client draws it. Only merc lights ever light roofs: map lights
lose `LIGHT_SPR_ONROOF` on load, explosions and flares never set it.

**Templates are generated, not shipped.** The map templates (`L-R01` … `L-R08`, `L-R01I2`) are `LightCreateOmni`
output, which Stracciatella ships converted in its `light-templates.json`. ja2-node generates them and applies the same
conversion (`asShippedTemplate`), so nothing derived from the data is in the repository; the generator's double
arithmetic is plain IEEE and runs unchanged. A data test checks the result against the user's `.LHT` files. `Light0` …
`Light6` (flares, break lights, merc lights) cannot be generated and come from Stracciatella's file in
`data/externalized/`. `TRANSLUC.LHT` there drives only wall translucency (deviation "Wall translucency template").

**Lights change only when drawn.** A sprite adds its light when placed and subtracts it when moved or destroyed;
`lightSetBaseLevel` and `lightSpriteRenderAll` draw every powered sprite again. Switching power shows at the next
render, and a door that opens or a wall a grenade destroys changes no light until then
(`UpdateLightSpritesOnStructureChange` is declared but never defined).

**The clock powers map lights once.** At a map load the hour decides which scheduled lights are on: night lights from
21:00 to 7:00, prime-time lights from 21:00 to midnight, none in caves. Afterwards only the strategic light events
switch them, and the dawn and dusk steps and the temperature events change the ambient level. A savegame loads its
clock before the world, so the saved hour powers the map lights. The sandbox stays at 12:00 (deviation "Ambient light
and light schedule").

**Obstacles block light through the structure height cache.** A tall obstacle stops a ray only if its height is
cached, and the original fills the cache lazily (sandbag movement costs, items put into containers, sight, bullets,
explosions, target heights); at a fresh load only sandbags and containers holding items have it. ja2-node mirrors the
cache (`StructureInstance.cachedHeight`, filled by `structureHeight()` at the same call sites) and draws the lights
again after the map items are placed, as `InitLoadedWorld` does.

**What the player sees makes light.** A muzzle flash lights the tile in front of the shooter only when the player can
see him, and flashes and explosions make light only at an ambient level of 9 or darker. That light counts for every
soldier's vision.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `lighting/`:

| Quirk | Test |
|---|---|
| The shipped templates lost the last ray of every `.LHT` file; the generated ones drop it too | `templates.test.ts` |
| A tall obstacle stops light only once something has asked its height | `lighting.test.ts` |
| A light past the east edge of the map lights the first tiles of the next row | `lighting.test.ts` |
| A tile higher than the step before it stays dark, but the ray goes on and lights the ground beyond | `lighting.test.ts` |
| A wall that appears changes no light until the next render, and the erase still removes the light that passed it | `lighting.test.ts` |
| Switching scheduled lights shows only at the next render | `lighting.test.ts` |
| At the roof level map lights never count, and a tile without a roof returns the raw ambient level, unclamped | `lighting.test.ts` |
| A muzzle flash lights the tile in front of the shooter, only when the player sees him | `effects.test.ts` |

Not pinned yet:
- A tile's light sum is a byte that wraps on addition but stops at 0 on subtraction.
- Moving a switched-off light erases it once more each time: the erase does not clear `LIGHT_SPR_ERASE`. ja2-node
  never moves a placed sprite.
- A map light flagged both prime-time and night keeps only the prime-time schedule.
- Light passes doors as the player perceives them, not as they are; ja2-node keeps the two equal (gaps "Doors").

## 4. Not checked against the native build

The oracle's `lights` probe dumps the true level of every tile with the light sprites, and `light` adds
`DistanceVisible` for a viewer (`tools/oracle/README.md`). They run on the reference saves, both levels, and on every
original map with lights at 22:00, 03:00 and 12:00 ("Lights"). That harness copies the oracle's structure height cache,
because whether container items exist is a `PreRandom` roll the two processes make differently. Inferred from reading
the source:
- Explosion, muzzle-flash and flare lights last only while an animation or effect does, and no probe catches them;
  unit tests cover them. The AI's light-dependent decisions are not probed either.
- The window rule skips the original's test for a struct node on the window tile: all 1,853 window structures of the
  260 original maps are single-tile and carry their own node.

Not ported: gaps "Cave lights", "Exposed tiles and mines in the pathfinder" (behind `avoid_light_tiles_at_night`, off
in Stracciatella's default policy), "AI flares underground", "Savegame import" (light effect records). Other deviations
of this domain: "Light on structures", "Ambient light and light schedule", "Wall translucency template", "Doors and
light in the projection", "World clock for smoke and light".
