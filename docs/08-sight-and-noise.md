# 08 — Sight and noise

From a soldier looking or making a noise to what each soldier, each team and the player know: line of sight, vision
range, the personal and public opplists, radio, noise and hearing, the light vision reads, and the player's revealed
tiles and rooms. Siblings: `07` the structure lists the ray walks; `10` interrupts, the best-sighting list's combat
entry and the end-of-combat sighting rule; `09` the alert status and noise investigation; `13` the combat AI's reading
of what it knows and creature smell; `11` aiming over the same ray; `20` light levels; `33` the attack busy count and
the scream; `29` what agents receive. Each module's `@src` header names the Stracciatella functions it ports; read those
for the formulas, tables and step order.

## 1. The path of a look and of a noise

Paths are under `src/sim/tactical/`.

```
a trigger: a tile centre, a turn while standing, the end of a      perception/wiring.ts (sightHooks), animation.ts
  stance change, a roof climb, a door, an attack's end, smoke      combat/barrier.ts, explosions/, tactical-sim.ts
  or light changing, a sector load
  └ handleSight(LOOK | RADIO | INTERRUPT)                         perception/sight.ts
     the soldier looks at every other team, every other team looks at him
        manLooksForMan: distanceVisible (facing, light, gear, gas) perception/sight.ts, lighting/lighting.ts
           lineOfSightTest over the structure lists               perception/los.ts
        manSeesMan / handleManNoLongerSeen: opplist, visible,      perception/sight.ts, perception/duel.ts
           duel points, NPC rules, the AI's stance                narrative/sight-rules.ts, perception/enemy-stance.ts
     combat: resolveInterruptsVs; real time: the best-sighting list   turns/turns.ts (10)
     radio: public opplist, enemySighted and the halt, revealed tiles  perception/fov.ts
makeNoise (held while an attack resolves)                          perception/noise.ts
  processNoise: per team and listener the effective volume → hearNoise (a look at the noise tile)
  the loudest of our listeners → noiseHeard; squadHears for sounds of unseen soldiers   unseen-sources.ts
a team turn start, every 20 world seconds in real time: known opponents checked, opplists decay   turns/turns.ts
```

| Module | Holds |
|---|---|
| `perception/los.ts` | `lineOfSightTest` with smoke and gas on the ray, the wall-corner rule, the eye height sight uses, the soldier-to-soldier test with camouflage and the tank's blind spot, the soldier-to-location test |
| `perception/sight.ts` | `Perception` (public opplist, public noise, best-sighting list); vision range, looks, opplists, radio, `handleSight`, decay, muzzle flashes |
| `perception/opp.ts` | Opplist values, sight flags, callers, `atan8` |
| `perception/noise.ts` | Movement and door noise, `makeNoise` → `processNoise` → `hearNoise`, `tellPlayerAboutNoise`, `squadHears` |
| `perception/bloodcat-arena.ts` | The N5 rule: the army and the creatures neither see (`soldierToSoldierLos`, `combat/positions.ts`) nor hear each other |
| `perception/duel.ts` | Duel points, interrupt conditions, watched locations (`10`) |
| `perception/knowledge.ts` | The AI's reading of heard noises and known opponents |
| `perception/fov.ts` | `revealRoofsAndItems`, revealed tiles and rooms (`TacticalState.fog`) |
| `perception/wiring.ts`, `perception/enemy-stance.ts` | The look triggers of a step, a turn, a stance, a climb and a door; halting on a sighting; the AI's stance after one |
| `lighting/lighting.ts` | `lightTrueLevel` and the light scaling of vision (`20`) |

Other users of the ray: `combat/positions.ts` (aiming and body parts, `11`), `ai/utils.ts` (location to location, `13`),
`explosions/trajectory.ts` (the window test, `34`).

## 2. Design

**Sight is event-driven.** A soldier looks only when something about him changes; there is no periodic look. Two
soldiers standing still are not tested again until one moves, turns or changes stance, and a change of ambient light
triggers no look. The only timed check re-tests known opponents: at each soldier's turn start in combat and every 20
world seconds in real time.

**One deterministic ray.** `lineOfSightTest` steps a fixed-point 3D ray through the profile cells of every structure on
its tiles, in list order (`07`). People and corpses are transparent; foliage shortens the remaining range instead of
blocking, three times as much for an unaware viewer; walls block except at some corner cells; there is no chance roll
(random cover is for bullets, `11`). Float arithmetic is float32 and the distance is `Math.sqrt`, never `Math.hypot`,
so whether a distance is integral matches the original; the original's `PI` decides the wall corners. While an
explosion or an action item resolves, a roof climb runs or the squad gathers to leave the sector, every test returns 0
(`disallowSight`), so known targets are lost.

**An aware viewer sees all around.** An unaware look counts the angle from the facing the soldier is turning to, with
sub-tile positions. A soldier who saw or heard the opponent in the last three turns, himself or through his team, looks
in a full circle. Radio makes the whole team aware: a teammate who did not know the enemy looks at him at once, in a
full circle.

**Three kinds of knowledge.** The personal opplist (seen now, this turn or up to three turns ago; heard this turn or up
to three turns ago), the team's public opplist filled by radio, and `visible`, what the player may see. Only lookers of
our team and the militia set `visible` to 1; 0 is the limbo of a look pass, and the player view still shows such a
soldier (`04`); −1 is hidden; −2 holds a soldier fading out after the squad lost him, who passes every test of the
original for "not −1" (the damage display, `lifeLost`, `aiTurn`) and stays in the view (`06`). `visible` is simulation
state: an unseen soldier animates at full speed in combat once he has faded out (`10`).

**Hearing has no walls.** The effective volume depends on distance, levels, the boundary between floor and outdoors,
the listener's hearing (experience, night ops, an extended ear worn on the head, ambient light; a tank hears worse and a
walkman deafens) and how many opponents he sees; no ray. A listener turns his head: a full-circle look at the noise
tile, which may reveal the maker. An impact or explosion hides its maker and is only remembered as a noise grid and
volume for the AI (`09`).

**The player hears a direction, never a grid.** The original prints the loudest listener's message and has no marker.
ja2-node emits `noiseHeard` with the listener, a loudness class and an eight-way direction (or above and below); a
marker at the true grid would leak hidden state (`01` D16). `squadHears` gives the same answer for the sounds of
soldiers out of sight (`29`, deviation "Sounds out of sight").

**Noise during an attack waits.** `makeNoise` keeps noises in `deferredNoises` while the attack busy count is above 0
and replays them when it reaches 0 (`33`), so their interrupts come after the attack.

**Light.** Vision reads the true light level of the target's tile; a muzzle flash shows the shooter as in daylight.
Hearing reads the sector's ambient level. The light model is `20`; the sandbox keeps ambient day light (deviation
"Ambient light and light schedule").

**Smoke, gas, camouflage and tanks.** The ray reads the smoke and gas layer of `ExplosivesState` (`12`) tile by tile:
smoke hides what lies behind a few of its tiles, tear and mustard gas cost range like cover, and a viewer standing in
gas without a mask sees only his surroundings. Camouflage fools only an unaware viewer, and less after every tile its
wearer moved since his turn began; tanks see and are seen farther, foliage never hides one, and a tank misses low soldiers close
to its hull. The hint projection fills the layer from the view's `smoke`, so an estimate reads what the server reads.

**The fog of war is a third, cruder system.** Revealed tiles come from fixed view paths over the movement cost table,
not from the ray. One revealed tile of a room reveals the whole room and hides its roof for good; both are saved in the
sector diff (`sim/campaign/sector-diff.ts`). The client derives hidden roofs, show-through and wireframes from the
revealed rooms (`render/world/reveal.ts`). Above ground there is no terrain fog.

**Decay.** A team's turn start decays its public opplist and watched locations, each soldier's his own. In real time
the decay waits for 20 world seconds on the campaign's `RealtimeClock`, shared by every loaded sector; leaving combat
forces up to two decays at once (deviation "Real-time turn after combat").

**Iteration order is state.** Looks walk `mercSlots`, team and radio loops walk soldiers by id. Both decide `visible`
transitions, ties in the best-sighting list and which draws happen. A `handleSight` runs to completion, nested looks
included, before the next event.

**Randomness.** `pre`: each footstep (one draw for the army, zero to two for others, also for a door's noise), the
experience chances of spotting an enemy who has not seen the merc (`33`), thrown objects landing (`34`). `main`: the
order of `ourTeamRadiosRandomlyAbout`, the bloodcat roar, the hostile-quote speaker. The sighting quotes and the
room-roof item quote are not drawn (gaps "Sighting quotes", "Sight and hearing details").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/perception/`:

| Quirk | Test |
|---|---|
| The land height at the ends of a ray comes from the tile with column and row swapped (27 original maps have land heights) | `perception.test.ts` |
| A footstep is marked as reported on the loudest listener under the bearing of the last listener | `hearing.test.ts` |
| An opponent lost at the check of known opponents counts as seen last turn at once, and the player keeps seeing him until the next look | `public-opplist.test.ts` |
| A team forgets its last radio caller one decay after its last opponent | `public-opplist.test.ts` |
| Watched locations decay for every id of the team's range, present or not | `public-opplist.test.ts` |
| A soldier created in the loaded sector, or leaving it, wipes where his team last placed everyone there, levels kept: reinforcements forget what the radio told the army | `public-opplist.test.ts` |
| A viewer reads the gas of his own tile on the level he looks at, not the one he stands on | `sight-modifiers.test.ts` |
| Anyone sees a tank behind his back, while a tank sees nobody behind its own | `sight-modifiers.test.ts` |
| A ray picks the smoke layer by its height counted from the map's zero, not from the land, so over high ground it reads the roof's smoke | `sight-modifiers.test.ts` |
| Smoke never stops a creature's smell, yet tear and mustard gas shorten it | `sight-modifiers.test.ts` |
| Any camouflage on a bloodcat counts as full camouflage | `sight-modifiers.test.ts` |

Not pinned yet:
- Fast-forwarding over a tile without structures tests the ground against the land height of the tile it left.
- Windows are see-through only in a band of heights above the land, so a window above the ground storey never is.
- Passing over the top of a low obstacle near the target compares the ray's cube with the target's cube counted from
  the ground, not from his level; on a roof that lets an aware viewer see a prone target behind one.
- With the original's `PI`, a ray due south takes the east-west branch of the wall-corner rule, due north the
  north-south one, and due east or west is always blocked at a corner cell.
- For the fog of war the last structure at the level decides whether a tile stops the view, while a tree or fence
  anywhere on it reduces the range.
- At a door, `HearNoise` tests the interrupt kind `SIGHTINTERRUPT` against the sight flags, which reads the look flag;
  it has no effect outside boxing.

## 4. Not checked against the native build

The oracle's `los` probe compares `LineOfSightTest` and `SoldierToSoldierLineOfSightTest` on A9 (sight limits, stance
pairs, buildings, a fence, roof to ground and back, trees against each target stance) and for every opposed pair of the
six saves; `light` compares the full-circle `DistanceVisible`; the soldier dumps compare `visible` and the opplist; the
`civ` probes trace the first-sight quotes of Mike and Joey (`tools/oracle/README.md`). A9 is flat; of the probed
sectors only D13 has land heights. Noise, hearing, radio, the decay, the fog of war, smoke and gas in sight and tanks
are not probed. Inferred from reading the source:
- Whether a ray's length is integral: libstdc++'s float `hypot` agrees with `f32(Math.sqrt)` for every horizontal
  offset up to 39 tiles that was checked, and MSVC's is exact; other builds are assumed to agree.
- A neighbour outside the map has no wall in the wall-corner rule; the original reads past its array.
- Structure list order matters only for the fog of war and the window test. A bush tile with a soldier in it does not
  stop the view: the original reads the person structure appended last, ja2-node the occupancy map.
- The order of `mercSlots` after soldiers leave and re-enter the sector (ja2-node reuses the first free slot).
- Hiring a merc while a sector is loaded wipes our team's public last-known locations there (`TacticalCreateSoldier`
  runs at the hire); ja2-node creates hired mercs outside the tactical layer and skips it. Only the AI reads these
  locations, and it never decides for our team.

Not ported: gaps "Sight and hearing details", "Sighting quotes", "Cave lights", "Guard room run", "Doors". Other
deviations of this domain: "Enemy sighted on their turn", "Real-time turn after combat", "Ambient light and light
schedule", "Sounds out of sight", "Bullets of unseen shooters".
