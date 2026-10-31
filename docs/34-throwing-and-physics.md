# 34 — Throwing, launchers and item physics

Grenades, rocks, inventory tosses and launchers (grenade launcher, underslung launcher, mortar) from the order until the
object rests or explodes: the order and its AP cost, the chance to hit and the miss, the launch force, the throw
animation, physics objects, catches, duds and the hand-off to the explosion. Siblings: `11` guns, bullets and melee
(the LAW, the tank cannon and thrown knives fly as bullets there); `33` what a hit does to a soldier; `12` explosions
from `igniteExplosion` on; `13` the AI's choice of throw; `29` the `attack` and `toss` commands, `estimateAttack` and
the events of a throw. Each module's `@src` header names the Stracciatella functions it ports; read those for the
formulas, constants and check order.

Item classes, ranges and the launcher of each round come from `data/externalized/` (`weapons`, `explosives`; `12`).
The throw, lob and launcher scripts come from the user's `ja2bin.dat`, speeds and flags from
`data/tables/anim-control.json`; the stub pack builds its own scripts with the same gameplay opcodes and shorter frames
(`stubs/anim-scripts.ts`).

## 1. The path of a throw

Paths are under `src/sim/tactical/`.

```
order: handleItem — APs checked only                                          combat/attack.ts
  toss cursor (grenades, rocks): busy +1, fireWeapon at once → useThrown:
    chance to hit, PreRandom(100), experience, miss scatter, launch force    explosions/throwing.ts, trajectory.ts
    handleSoldierThrowItem: turn for free, THROW_ITEM or LOB_ITEM
      460/461 release: APs paid, createPhysicalObject                         throwing.ts (throwOpcode)
  trajectory cursor (launchers): beginFireWeapon → fire event, busy +1        combat/attack.ts
    430 → useLauncher: misfire, chance, PreRandom(100), APs, object at once   throwing.ts
every 20 game ms, before bullets: stepThrownObjects                           explosions/physics.ts
  float32 sub-steps, collisions, bounces, windows, soldier hits, catches     physics.ts, catching.ts
  end of life: armed impact → dud or igniteExplosionXY (12); or item to the pool; impact noise; busy −1
```

| Module | Holds |
|---|---|
| `combat/attack.ts` | `HandleItem`'s throw and launcher branch, the fire event, `FireWeapon` (shared with guns, `11`) |
| `combat/ap.ts` | `MinAPsToThrow`, `EnoughAmmo` |
| `explosions/throwing.ts` | `UseThrown`, `UseLauncher`, the thrown chance to hit, the toss range, the misfire, the throw animation and its release |
| `explosions/trajectory.ts` | Launch parameters, the miss scatter, the force and angle searches, the landing check of the AI, the hint and `toss.ts` |
| `explosions/physics.ts`, `explosions/catching.ts` | Physics objects: flight, collisions, end of life, duds and the explosion hand-off; catches |
| `explosions/state.ts`, `explosions/vec3.ts` | The object record, the pending throw parameters, the 20 ms timer; float32 vector arithmetic |
| `toss.ts` | Inventory tosses: no roll, `AP_TOSS_ITEM`, a merc of ours may catch |
| `perception/wiring.ts`, `ai/system-situation.ts` | A throw called off before its release hands the copied object back |

## 2. Design

**Who rolls when.** A throw rolls at the order and pays at the release frame; the roll is spent even if the throw never
leaves the hand. A launcher rolls, pays and launches at its fire frame. The order checks the APs with the soldier's
current stance and last target; the release charges `MinAPsToThrow` again from inside the throw animation, so the
stance term is 0 and the target always counts as new. Turning before a throw is free. Aim adds to a throw's chance and
is never charged: the AI aims its throws, the agent API refuses an aimed one, as the original's toss cursor has no aim.

**The roll scatters the landing tile, physics decides the rest.** A roll up to the chance aims at the target tile; a
higher one moves the aim to a random tile of a square around it that grows with the miss. The flight decides where the
object ends: bounces, walls, roofs and the force cap can move it further.

**Float-exact physics.** Objects fly in float32 like the original's `vector_3`: `Math.fround` after every float
operation (`vec3.ts`), the same sub-step accumulation (eleven sub-steps per tick, because `0.18f` added ten times stays
below `1.8f`), the same restitution and friction. The launch force is searched by flying test objects through the same
integrator until the resting point lands within 1 % of the range, so any rounding difference changes the force, the
number of bounces and the landing tile. The first force estimate and the launch angle's sine are double expressions
rounded to float32; a last-ulp difference from C's `sinf` can rarely move a landing tile (deviation "Physics cadence and
floats").

**Fixed cadence.** Physics steps every 20 game ms at the start of the 5 ms tick, before bullets, explosions and the
soldier pass, objects in slot order (deviation "Physics cadence and floats"). Flight time is a fixed number of steps for
given launch parameters, in turn-based and real time alike.

**The force search is remembered.** A collision-free test flight draws nothing and reads only the visible area of the
map, so its result is a function of source, target, heights, angle, whether the object is a mortar shell and the
restricted scroll area. `trajectory.ts` keeps it per item table, bounded at 65,536 entries: the searches were most of
the AI's throw planning, and the probe for the force cap is the same for every target of a toss range.

**No fuses.** Hand and launcher grenades go off when the object comes to rest (or dies after 30 collisions or off the
visible map), after bouncing and rolling; a mortar shell goes off at its first counted collision; an armed object in
water goes off when its ripple reaches its key frame, without a dud test. Only an object at rest on the ground plane can
be a dud; the dud is laid down armed, without the original's timer (gap "Duds and timed bombs").

**One barrier.** Every object in flight holds the attack busy count until it dies; an explosion raises its own hold
before the object's is released (`12`), so the attack ends after the blast. Holds the original leaves to its watchdog
are released or refused where they arise: an aborted throw releases its count, and `attack` refuses a launcher without
a round (`noAmmo`), which the original's cursor turns into a reload (deviation "Watchdogs").

**Randomness.** Gameplay draws keep the original order on `main` and `pre` (`01` §3.6), the mortar's smoke-trail delay
included: a cosmetic draw on `pre` in the original, kept there. Battle and impact sounds and the curse after a dud are
not drawn (deviations "Cosmetic draws in attacks", "Cosmetic draws in explosions"); the dud test's unsequenced operands
are drawn left to right (deviation "Dud test operand order").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `explosions/`:

| Quirk | Test |
|---|---|
| A teammate northwest of an empty target is the throw's victim for experience: the neighbour search keeps the last tile it looked at | `throwing.test.ts` |
| A roll equal to the chance lands on the target yet earns a miss's experience (`roll < chance`) | `throwing.test.ts` |
| Aim raises a throw's chance and is never charged | `throwing.test.ts` |
| A sighting that calls a throw off hands back the copy of the whole hand stack, one grenade more than was taken | `throwing.test.ts` |
| A second throw at the same tile pays for a new target: the throw animation forgets the last target before the release charges | `grenade-attack.test.ts` |
| A mortar order makes the next stance change free; fired from a crouch, that is the merc's next stand-up | `grenade-attack.test.ts` |
| An underslung launcher is rated by the rifle's status, not its own | `physics.test.ts` |
| A big wound penalty wraps around as a signed byte, so a dying expert throws better than a wounded one | `physics.test.ts` |
| On a map with a restricted scroll area the probe for the force cap starts off the visible map: every throw falls at the thrower's feet | `physics.test.ts` |
| The AI's landing check passes only where the flight hits a structure or a person: open ground records no end position | `physics.test.ts` |

Not pinned yet:
- A mortar's chance is 0 below 15 tiles, before the 1–99 clamp: any roll but 0 misses.
- Only our team's and visible soldiers' launchers can misfire (`willExplosiveWeaponFail`).
- The collision counters never reset in free flight: slow collisions of separate bounces add up toward the stop after 3,
  identical collision codes toward the one after 30.
- A thrown rock is laid down invisible, on the ground level even when it rests on a roof.
- An object leaving the map is deleted without releasing its busy count; the visible-area check normally comes first.

## 4. Not checked against the native build

No oracle probe covers throws, launchers or physics; the unit tests next to the code check the port as read. Inferred
from reading the source:
- The release charges: the target always new, no stance term, no aim.
- That throws fail on a map with a restricted scroll area (one basement in the shipped data).
- An aborted throw returns the whole copied stack; a hit during the throw animation before the release loses the object.
- Object heights ignore the terrain height of the tile.
- The order of the dud test's two draws.
- In water, the throw's busy count is released before the ripple's explosion.
- Catches, windows broken by a thrown object and objects hitting soldiers are ported as read.
- Caves and basements: throws as from under a roof, and a ceiling one storey up on every tile.

Not ported: gaps "Duds and timed bombs", "Tossing from the item cursor".
Other deviations of this domain: "Physics cadence and floats", "Water ripple", "Dud test operand order", "Cosmetic draws
in attacks", "Cosmetic draws in explosions", "Bullets of unseen shooters", "Watchdogs".
