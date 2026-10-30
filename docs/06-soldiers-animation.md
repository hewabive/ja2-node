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
  frame due → adjustToNextAnimationFrame              animation.ts; other opcodes through the tactical hooks
  moving state → moveMerc (07); turning state → turnSoldier
view: state, frame slot, state tick, frame delay      tactical-sim.ts
client: frame of the view                             app/world/soldier-frames.ts, content/anim/schedule-track.ts
  sheet, palette from the standing sheet              app/world/soldier-assets.ts, content/anim/soldier-sprite.ts
  shade, glow, fade, multi-tile z strips              app/world/soldier-scene.ts, render/world/glow.ts, soldier-fade.ts,
                                                      soldier-palettes.ts
  quads in the merc passes                            render/world/dynamic-scene.ts, geometry.ts (05)
```

| Data | Where |
|---|---|
| Scripts per state | The user's `binarydata/ja2bin.dat`; the stub pack builds its own (`stubs/anim-scripts.ts`) |
| Flags, speeds, heights per state; per-body speeds | `data/tables/anim-control.json` |
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

**The simulation never loads a sheet.** The surface a state shows depends on the body, the class of the item in hand,
a second pistol, life below 30, water and the big-guy flags, not on the state alone. One function, `chooseSurface`,
answers for both sides: the simulation asks it whether a state is valid for a body and which structure file gives the
soldier's collision shape, the client asks it for the sheet. The original refuses a new state when its sheet fails to
load; deciding from the tables keeps the simulation independent of the files a user has. The client falls back to a
stub sheet of the same kind when a file is missing.

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
replacements serves every sheet he shows: on the Gold data the sheets differ only at entries soldiers never use and at
254, the shadow marker. Shadows are pixels of every frame (index 254); ja2-node draws them as a separate darkening part
of the quad (`05`, deviation "Shadow darkening").

**Enemies glow instead of being lit.** A soldier takes his tile's shade two levels brighter, never brighter than the
default. A hostile soldier takes a glow row during our turn (always in real time) or under AI control, grey while the
selected merc does not see him, and draws topmost at the pulse's peak or under the cursor. Soldiers coming into or
leaving the view fade.

**Creation draws in the original's order.** Body, stats, equipment, night ops, palettes and battle sounds come from
the gameplay stream in the order of `CreateDetailedPlacementGivenBasicPlacementInfo` and `TacticalCreateSoldier`, so a
seeded replay creates the same sector (deviation "Soldier creation draws"); the first standing frame's draw is
cosmetic and not made (deviation "Cosmetic face and frame draws").

**Profiles.** ja2-node decodes `prof.dat` itself; Stracciatella's `mercs-profile-info.json` gives each profile its
internal name and type, the face index is the profile id, and an empty vest or pants become `WHITEVEST` and
`BLACKPANTS` (Stracciatella's rule for the player's own characters). The campaign's changing profile fields live in
`profiles.ts`.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/` and `src/render/world/`:

| Quirk | Test |
|---|---|
| Only our mercs fast-turn; enemies turn at their state's delay | `animation.test.ts` |
| A body's negative frame delay bonus never applies: women and big men walk with a man's delay | `animation.test.ts` |
| Raising a rifle standing takes 70 ms a frame, 150 aimed, whatever the stats, and combat does not halve it | `animation.test.ts` |
| A walking civilian steps at his body's speed, a running one at the running state's 2.6, not his body's 2.3 | `movement.test.ts` |
| A placement that sets its colours keeps only its clothes: skin and hair are rolled again | `creation.test.ts` |
| An army woman becomes a man after her hair was rolled by the women's rules, so he is never white-haired | `creation.test.ts` |
| An unseen enemy at the glow peak takes the step before it, 200 instead of 225 | `glow.test.ts` |

Not pinned yet:
- Every big male stands, walks, runs and raises his gun in the threaten sheets, so `m_r_std`, `m_r_walk`, `m_r_run2`
  and `m_raise` never show (`app/world/soldier-assets.ts` sets the flag from the body).
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

Not ported: gaps "Soldier palettes and surfaces", "Random idle animations", "Unseen soldiers in combat", "Big merc
kneel", "Reverse move animations", "Soldier draw height", "Drugs and alcohol" (adrenaline and drunkenness in the frame
delay), "No-burn tiles". Other deviations of this domain: "Frame timers", "Soldier frame on turning", "Soldier frames
with other scripts", "Creature and bloodcat stub bodies", "Multi-tile turning", "Idle sounds of unseen animals".
