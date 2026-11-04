# 06 — Soldiers: animation, sprites and creation

What a soldier on the map is made of: animation states and their scripts, the frame clock, the sheet a state shows for
a body and hand item, the frame and facing, turning and the step of a frame, palettes, shade and glow, merc profiles
and creating soldiers from placements. Siblings: `01` the time model, the action timelines and the gameplay opcodes;
`05` the render passes a soldier's quads join; `07` the walk (`MoveMerc`, the tile step); `10` the APs of turns and
stance changes; `33` hit and death animations; `20` the light a soldier stands in; `17` enemy populations; `21` hiring.
Each module's `@src` header names the Stracciatella functions it ports; read those for the formulas (frame delay,
surface choice, palette rolls, glow tables, stats of a placement).

## 1. The path of an animation

Paths are under `src/` (`sim/tactical/` for bare names).

```
load: ja2bin.dat → logic and presentation timelines   content/formats/ja2bin.ts, content/anim/timelines.ts
  anim-control.json, anim-surfaces.json               content/anim/tables.ts
  animation structure files                           content/anim/structures.ts
creation: placement or profile → Soldier              init-list.ts, creation.ts, creation-basic.ts, profiles.ts
new state: initNewSoldierAnim                         animation.ts
  body substitutions, validity from the surface table anim-substitution.ts, multi-tile.ts,
                                                      content/anim/surface-choice.ts
  person structure for state and facing               person-structure.ts
  frame delay                                         animation.ts computedAnimationDelay
every 5 ms tick: executeOverhead                      overhead.ts
  fade step, then the new-visibility check            fade.ts
  frame due → adjustToNextAnimationFrame              animation.ts; other opcodes through the tactical hooks
  moving state → moveMerc (07); turning state → turnSoldier
view: state, frame slot, state tick, delay, height,   tactical-sim.ts, multi-tile.ts
  sheet (surface), camouflage
client: frame of the view                             app/world/soldier-frames.ts, content/anim/schedule-track.ts
  sheet of the view, palette (standing sheet with     app/world/soldier-assets.ts, content/anim/palette-substitution.ts,
  replacements, a COL file or the sheet's own)        content/anim/soldier-sprite.ts
  shade, glow, fade, multi-tile z strips              app/world/soldier-scene.ts, content/anim/zstrip-frames.ts,
                                                      render/world/glow.ts, soldier-fade.ts, soldier-palettes.ts
  quads in the merc passes                            render/world/dynamic-scene.ts, geometry.ts (05)
```

| Data | Where |
|---|---|
| Scripts per state | The user's `binarydata/ja2bin.dat`; the stub pack builds its own (`stubs/anim-scripts.ts`) |
| Flags, speeds, heights per state; per-body speeds; the random idle animations per body (`gRandomAnimDefs`) | `data/tables/anim-control.json` |
| Sheets, directions, structure types; surfaces per body, state and hand | `data/tables/anim-surfaces.json` |
| Palette replacements | The user's `binarydata/ja2pal.dat` (`content/formats/ja2pal.ts`) |
| Merc profiles | The user's `binarydata/prof.dat` (`content/formats/prof.ts`) with Stracciatella's `mercs-profile-info.json`; the stub pack's `stubs/profiles.json` |
| Stub sheets | `stubs/soldiers.ts`: stand, walk, run, crouch and prone, colours in the `ja2pal` ranges |

## 2. Design

**Animations are data the simulation steps.** One script per state serves every body. At load the scripts split into
a logic timeline the simulation runs and a presentation timeline of sprite frames and sounds (`01`). A soldier keeps
his state, script position, frame slot and next-frame deadline; opcodes that change the game run in `animation.ts` or
through the tactical hooks (combat, doors, roofs, items). Frame counts, speeds and opcode positions come from the
user's data, so the stub pack's shorter scripts give tests timings of their own.

**The simulation picks the sheet; it never loads one.** The surface a state shows depends on the body, the class of
the item in hand, a one-handed gun in the second hand, life below 30, water, the queen's target and the big-guy flags,
not on the state alone. `chooseSurface` decides from the tables: the simulation asks it whether a state is valid for a
body, which structure file gives the soldier's collision shape, and which sheet the view carries (`surface`, worked
out at each view: deviation "Soldier sheet and palette refresh"), so the client never guesses another soldier's water,
second hand or wounds. The original refuses a new state when its sheet
fails to load; deciding from the tables keeps the simulation independent of the files a user has. The client falls
back to a stub sheet of the same kind when a file is missing, and asks `chooseSurface` itself only to preload the
standing, walking and running sheets and for the standing sheet of the palette. The sub-flags are derived, not kept:
`TacticalCreateSoldier` gives every `BIGMALE` the threaten stance, nothing clears it and no game path changes a big
male's body; the second shot flag is the profile's (`prof.dat` sets it on a few big men), copied once and never changed, and it
only swaps one aim sheet for another of the same structure, so only the view's sheet reads it (`shownAnimSurface`).
So neither side keeps the flags and a native save's `uiAnimSubFlags` is not read; the idle animations, the big merc's
crouch transitions and the threaten sheets test the body.

**The frame clock is game time.** A frame lasts `aniDelay` game ms, checked every 5 ms tick (`01`, deviation "Frame
timers"). States with speed 0 compute it from breath, life, agility, terrain and the body, halved in combat and doubled
for stealth in real time; in the states marked for fast turns our mercs turn at 30 ms an octant.

**The client shows the frame the server reached.** The view carries the state, the frame slot, the tick the state
began and the frame delay. A client whose scripts hash like the server's predicts the slot between views exactly;
one with other scripts walks its own and warps time between the state start and the fire markers (deviation "Soldier
frames with other scripts"). The sheet frame comes from the script frame and the current facing at draw time, so a new
facing shows at once (deviation "Soldier frame on turning").

**Turning and stepping belong to the state.** A state with the turning flag turns one octant per frame while it plays,
if the soldier's structure fits the new facing; prone has no turning flag, so a prone turn goes through a crouch.
`WALKING` steps the body's walking speed per frame; every other state steps its own, whatever the body's table says.

**One palette per soldier.** The palette of the soldier's standing sheet with the hair, skin, vest and pants
replacements serves every sheet he shows: on the Gold data a body's sheets differ only at entries soldiers never use
and at 254, the shadow marker, so the client takes the dry standing sheet for the hand the view names. A painted merc
wears `camo.col` instead (the view's `camouflaged`, shown for every soldier in sight), the adult creatures their colour
files; animals, vehicles, the robot and the queen wear their standing sheet's own palette, and a burning or exploding
merc and a dying vehicle the palette of the sheet of that state, which differs from the standing one in most entries
(`bodyTypePaletteSubstitution`, shared with corpses). Without a colour file, as in the stub pack, the sheet's own
palette stands in, the original's fallback. Shadows are pixels of every frame (index 254); ja2-node draws
them as a separate darkening part of the quad (`05`, deviation "Shadow darkening").

**Z strips come from one frame per structure.** A multi-tile soldier is drawn in strips whose depth follows the
structure of his facing (the queen's only one). As in `LoadAnimationSurface`, each structure of the surface's own
structure file takes its strips from one frame of the sheet, picked by the surface's start frame and the step the sheet
gives each structure (`content/anim/zstrip-frames.ts`); the vehicles' 32 facings feed eight structures.

**The draw height is simulation state.** `heightAdjustment` is the original's float height above the tile: a
placement on a roof, the climb frames and a crow's flight set it (`insertion.ts`, `roofs.ts`, `crows.ts`), and
`setSoldierHeight` sets the level from it. The view carries it while it is not zero. The client draws the soldier its
truncated value above his tile and sorts him at the roof z while it is above zero; the level alone picks the render
pass (`render/world/dynamic-scene.ts`; the overhead map in `ui/screens/tactical/overhead-map.ts`).

**Enemies glow instead of being lit.** A soldier takes his tile's shade two levels brighter, never brighter than the
default. A hostile soldier takes a glow row during our turn (always in real time) or under AI control, grey while the
selected merc does not see him, and draws topmost at the pulse's peak or under the cursor. The soldier under AI control
comes from the combat view's `aiTurn` (`TacticalSim.combatView`), so the attacker of a hidden turn and an AI
interrupter glow too; it stays empty while an AI interrupt is hidden.

**The fade is simulation state.** A soldier who drops out of sight is held at `visible` −2 while his shade steps every
60 ms from his tile's shade to 12 (`fade.ts`, run in the overhead pass before the frame timer); the end of a fade, out
or in, sets his frame delay again, and in combat delay 0 waits for the pass after a fade-out (`10`). The view keeps a
fading soldier, marked `fadingOut`, where he really is; the client darkens him from its own light field and fades
newcomers in from 12 (deviation "Soldier fade without merc lights").

**Creation draws in the original's order.** Body, stats, equipment, night ops, palettes and battle sounds come from
the gameplay stream in the order of `CreateDetailedPlacementGivenBasicPlacementInfo` and `TacticalCreateSoldier`, so a
seeded replay creates the same sector (deviation "Soldier creation draws"); the first standing frame's draw is
cosmetic and not made (deviation "Cosmetic face and frame draws").

**Idle animations break the breathing loop.** The standing and the crow eating scripts end each pass with code 491
(`random-anims.ts`): every third pass, or every pass below 30 life, a soldier with OKLIFE out of water draws
`Random(100)` on `main` and may switch to an idle animation of his body, a casual one only for our mercs out of combat;
an animal's idle sound only holds the script for a frame, the sound itself is the client's (deviation "Idle sounds of
unseen animals"). The stub pack's `STANDING` and `CROW_EAT` carry 491 where the original's do, so stub tests draw it
too; nobody is drunk until "Drugs and alcohol" is ported, so the drunk idle never plays.

**Profiles.** ja2-node decodes `prof.dat` itself; Stracciatella's `mercs-profile-info.json` gives each profile its
internal name and type, the face index is the profile id, and an empty vest or pants become `WHITEVEST` and
`BLACKPANTS` (Stracciatella's rule for the player's own characters). The campaign's changing profile fields live in
`profiles.ts`.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/` and `src/render/world/`:

| Quirk | Test |
|---|---|
| Only our mercs fast-turn; enemies turn at their state's delay | `animation.test.ts` |
| A soldier the map puts on a roof stands 58 px up, 8 more than one who climbed there | `insertion.test.ts`, `creation.test.ts` |
| Climbing down drops a soldier to 5 px and below his tile before he lands; a big man climbing up stays under one pixel for his first steps, sorted at the roof z while drawn on his tile | `roofs.test.ts`, `src/render/world/dynamic-scene.test.ts` |
| A body's negative frame delay bonus never applies: women and big men walk with a man's delay | `animation.test.ts` |
| Raising a rifle standing takes 70 ms a frame, 150 aimed, whatever the stats, and combat does not halve it | `animation.test.ts` |
| In combat an unseen creature rising to call keeps its state's delay; every other unseen soldier runs at the loop rate | `animation.test.ts` |
| An unseen soldier keeps his frame delay through his fade-out and the pass that ends it; only the next speed change runs him at the loop rate | `fade.test.ts` |
| A walking soldier's fade-out ends when he reaches the next tile, without setting his speed: he walks on at his delay to the tile after | `fade.test.ts` |
| A walking civilian steps at his body's speed, a running one at the running state's 2.6, not his body's 2.3 | `movement.test.ts` |
| Any stance change of a civilian body but the cripple's only sets or clears the cower state (`ChangeSoldierStance`, `Tactical/Soldier_Control.cc:3701`): told to lie down he cowers and ends crouched, and a crouched civilian whose cower flag is off ignores a stand | `stance.test.ts` |
| A placement that sets its colours keeps only its clothes: skin and hair are rolled again | `creation.test.ts` |
| An army woman becomes a man after her hair was rolled by the women's rules, so he is never white-haired | `creation.test.ts` |
| An unseen enemy at the glow peak takes the step before it, 200 instead of 225 | `glow.test.ts` |
| A one-handed gun in hand ends the idle check after its draw, injured or not: "Don't EVER do a trivial anim" | `random-anims.test.ts` |
| An animal's idle sound holds its loop at code 491 for a frame, so the next pass counts it again | `random-anims.test.ts` |
| Every big male idles with the second big merc animations: `TacticalCreateSoldier` gives each the threaten stance flag | `random-anims.test.ts` |
| A reverse swat starts in a plain `START_SWAT`; only the `SWATTING` it chains to turns into `SWAT_BACKWARDS` | `player-orders.test.ts` |
| A reverse move of a body without the backward states pays the first step and leaves him standing: the new state's surface fails after the step was taken | `player-orders.test.ts` |
| Every big male stands, walks, runs and raises his gun in the threaten sheets, so `m_r_std`, `m_r_walk`, `m_r_run2` and `m_raise` never show | `src/content/anim/surface-choice.test.ts`, `hud-view.test.ts` |
| In water neither the hand item nor wounds choose the sheet: a state without a water sheet, like walking backwards, shows the rifle sheet even with empty hands | `src/content/anim/surface-choice.test.ts` |
| The queen picks her spit sheet by the direction from two tiles east of her to the target, and has five sheets for eight directions | `hud-view.test.ts`, `src/content/anim/surface-choice.test.ts` |
| Only the regular male's prone sheet takes its z strips from frame 5; the big man's and the woman's take frame 0 | `src/content/anim/zstrip-frames.test.ts` |

Not pinned yet:
- `STOCKYMALE` has the regular male's sheets, speeds and palettes; `RGMTHROW` plays `s_lob.sti` and `RGMLOB`
  `s_throw.sti` (`data/tables/anim-surfaces.json`).
- A half turn always goes clockwise (`quickestTurnIncrement`).

## 4. Not checked against the native build

No probe covers animation timing: frame delays, fast turns, turning and the step of a frame are checked against the
source, and frames per tile against a float32 simulation of `MoveMerc` (`07`). Inferred from reading the source:
- A soldier's shade never carries the `0x30` bits: the lighting clamps levels to 0–15, so ja2-node drops them.
- `ja2prof.dat` is not loaded: its placeholders only tell the original's aim cursor the body part under it on a
  soldier in a prone sheet who is not lying yet (the cursor skips lying soldiers), and a facing change removes them.
- ja2-node keeps the `prof.dat` records of the profiles `mercs-profile-info.json` leaves out (the I.M.P. slots 51–56,
  165–169), which Stracciatella replaces by empty ones; no path is known to read them before I.M.P. creation
  overwrites a slot.
- The screen position truncates float32 offsets toward zero, as the original's `(INT16)` casts.

Not ported: gaps "Drugs and alcohol" (adrenaline and drunkenness in the frame delay, the drunk
idle). Other deviations of this domain: "Frame timers", "Soldier frame on turning", "Soldier frames
with other scripts", "Creature and bloodcat stub bodies", "Multi-tile turning", "Idle sounds of unseen animals",
"Cosmetic draws of creatures", "Soldier fade without merc lights", "Failed animation surface", "Soldier sheet and
palette refresh".
