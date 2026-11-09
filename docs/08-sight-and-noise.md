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
     radio: public opplist, enemySighted, the sighting quote and the halt,  perception/wiring.ts
       revealed tiles                                              narrative/sighting-quotes.ts, perception/fov.ts
makeNoise (held while an attack resolves)                          perception/noise.ts
  processNoise: per team and listener the effective volume → hearNoise (a look at the noise tile)
  the loudest of our listeners → noiseHeard; squadHears for sounds of unseen soldiers   unseen-sources.ts
a team turn start, every 20 world seconds in real time: known opponents checked, opplists decay   turns/turns.ts
```

| Module | Holds |
|---|---|
| `perception/los.ts` | `lineOfSightTest` with smoke and gas on the ray, the wall-corner rule, the eye and body heights by stance, body and water (`soldierZPos`, also for aiming), the soldier-to-soldier test with camouflage and the tank's blind spot |
| `perception/sight.ts` | `Perception` (public opplist, public noise, best-sighting list); vision range, looks, opplists, radio, `handleSight`, decay, muzzle flashes |
| `perception/opp.ts` | Opplist values, sight flags, callers, `atan8` |
| `perception/noise.ts` | Movement and door noise, `makeNoise` → `processNoise` → `hearNoise`, `tellPlayerAboutNoise`, `squadHears` |
| `perception/bloodcat-arena.ts` | The N5 rule: the army and the creatures neither see (`soldierToSoldierLos`, `combat/positions.ts`) nor hear each other |
| `perception/duel.ts` | Duel points, interrupt conditions, watched locations (`10`) |
| `perception/knowledge.ts` | The AI's reading of heard noises and known opponents |
| `perception/fov.ts` | `revealRoofsAndItems`, `allSoldiersLookForItems`, revealed tiles and rooms (`TacticalState.fog`) |
| `perception/look-memo.ts`, `change-counts.ts` | The look skipped while its inputs stand, and the change counts of the world layers it reads (§2) |
| `perception/slant-roofs.ts` | The ceilings of slanted roofs: which roofs a look or a load examines, and the tiles that show a ceiling (`fog.slantRoofCeilings`) |
| `perception/item-locator.ts` | What a look that shows new items does: the halt in combat, the item locator lock, the items-seen quote with the tile it slides to and its hold until the end of an attack (`turn.lockItemLocators`, `turn.itemsSeenOnAttack`, `turn.itemsSeenOnAttackGridNo`) |
| `perception/wiring.ts`, `perception/enemy-stance.ts` | The look triggers of a step, a turn, a stance, a climb and a door; what our sighting does (the quote or battle sound, the halt, the end of the virgin sector); the AI's stance after one, and at each new animation of an enemy who sees us (`animation.ts`, `06` §3) |
| `narrative/sighting-quotes.ts` | The sighting quotes: in trouble, creatures, bloodcats, the first enemy of the sector, the battle-sound roll |
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
explosion or the bomb queue runs, a roof climb runs or the squad gathers to leave the sector, every test returns 0
(`disallowSight`), so known targets are lost; an explosion the queue sets off leaves sight off until the queue ends, when
all teams look at once (`12` §6).

**A look remembers its ray.** `manLooksForMan` keeps the last ray of each viewer and target
(`perception/sight-memo.ts`, `TacticalState.sightMemo`: transient like `pathEnv`, never saved) and reuses it while
every input stands: both soldiers' tile, level, stance height, body and terrain, the target's camouflage and tiles moved,
the range, awareness, `disallowSight`, the structure lists and the smoke layer. `WorldStructures.add` and `remove` count
every change of the lists (`version`), `setSmokeFlagsAt` (`explosions/smoke.ts`) every change of a smoke tile; a
structure or smoke tile written another way would serve a stale ray. Before that, a pair farther apart than anyone but a
creature can see (`FARTHEST_NON_MONSTER_SIGHT`, a bound of `distanceVisible`) is not seen without any work unless the
viewer sees the target now. Both serve the map screen's real-time turn, which makes all teams look at each 20 ms poll
(`15`, `32` §2.2); pinned by `sight-memo.test.ts` and `sight-modifiers.test.ts` "never reaches past
FARTHEST_NON_MONSTER_SIGHT …".

**A look that would change nothing is skipped.** Out of combat `allTeamsLookForAll` records what it reads on a tape
before and after it runs (`perception/look-memo.ts`, `TacticalState.lookMemo`, transient, empty after a restore). A look
that left the tape as it was, drew from neither stream and pushed no event or game event is remembered (with streams
other than the game's own, as tests and oracle replays swap in, none is), and the next call whose tape equals it again
is skipped: the same inputs take the same path and write the values already there. Every draw a look can make lies on a
branch that also changes the tape or pushes an event, so the stream check only backs the proof up. The tape
holds what the path reads and writes, read from `sight.ts` (the look, `distanceVisible`, the ray memo's inputs,
`manSeesMan`'s seen-again branch, the radio, the best sighting) and `fov.ts` (the walk with `mercLooksForDoors`, the
corpse comment, item visibility, blood graphics, slanted roofs), compared value by value where cheap: every soldier with
the fields those read, each soldier's opinion of each other (with the last known tile and the seen mark where it is not
0), the public opinions, noise and awareness, the watched-location increments, the sighting scratch of `perception` and
`turn`, combat, difficulty, blood and gore, the sector, the door statuses, the world items, the corpses and, in caves,
the light sprites. The world's large layers count their changes instead, and every writer counts: the structure lists
(`WorldStructures.add`, `remove`), the movement costs (`MovementCosts.raise`, `force`, `clearTile`, `replaceWith`, its
only writers), and `TacticalState.changes` (transient): `smoke` by `setSmokeFlagsAt`, the only writer of the smoke
layer; `light` by `traceLight` (every draw and erase) and `resetTileLights` (every render and map load, which
`lightSetBaseLevel`, `initLighting` and the save import run after writing the ambient level or the cave flags); `fog` by
`setRevealedFlags`, `setRoomRevealed`, `restoreFogOfWar`, `markRevealedAtLoad`, `examineSlantRoofsOverRevealedTiles` and
`setCeiling`, every write of the revealed tiles, the room roofs, the tiles a load revealed and the slanted roof ceilings; `blood` by `setBloodReevaluation`, every write
of the blood to redraw; `occupancy` by `placeOccupant`, `removeOccupant` and `clearOccupants`. A writer of these that
does not count, or a read the tape misses, would let a skipped look miss a change. The last merc to radio, which a look
writes and never reads and the opplist decay clears, is set again from the remembered look's radio callers. Two paths
read more than the tape holds and are never remembered: an enemy readying his weapon at a sighting
(`reevaluateEnemyStance`) and the first creature line of a merc without a profile, which leaves no flag. The walk's
markers are scratch outside the snapshot (`TacticalState.viewMarkers`), as in the original: no walk reads what an
earlier one left there. `setLookSkipping(false)` runs every look, for differential checks. Pinned by
`look-memo.test.ts` (each input and each counting writer) and `../campaign/map-screen-looks.test.ts` (skip on and off
alike, a compressed day with a loaded town included).

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
tile, which may reveal the maker; a tank looks only the way it is turning and never at a noise it would have to turn
to, and a crow sends its whole flock flying instead (`33`). An impact or explosion hides its maker and is only remembered as a noise grid and
volume for the AI (`09`). Some never listen: our mercs held prisoner (`heldPrisoner`, the roster's assignment through
`NarrativePort.assignment`), militia on our side to us or to a noise nobody made, we to them, and the Warden, the
General, the Sergeant and Conrad to the army.

**The player hears a direction, never a grid.** The original prints the loudest listener's message and has no marker.
ja2-node emits `noiseHeard` with the listener, a loudness class and an eight-way direction (or above and below); a
marker at the true grid would leak hidden state (`01` D16). `squadHears` gives the same answer for the sounds of
soldiers out of sight (`29`, deviation "Sounds out of sight").

**Noise during an attack waits.** `makeNoise` keeps noises in `deferredNoises` while the attack busy count is above 0
and replays them when it reaches 0 (`33`), so their interrupts come after the attack.

**Light.** Vision reads the true light level of the target's tile; a muzzle flash shows the shooter as in daylight.
Hearing reads the sector's ambient level. The light model is `20`; the sandbox keeps ambient day light (deviation
"Ambient light and light schedule").

**Bodies, water, smoke, gas, camouflage and tanks.** Eyes sit lower in water and on kids and small bodies, higher
on a tank, for the viewer and the target alike; the robot sees all around. The ray reads the smoke and gas layer of
`ExplosivesState` (`12`) tile by tile: smoke hides what lies behind a few of its tiles, tear and mustard gas cost range
like cover, and a viewer standing in gas without a mask sees only his surroundings. Camouflage fools only an unaware
viewer, and less after every tile its wearer moved since his turn began; tanks see and are seen farther, foliage never
hides one, and a tank misses low soldiers close to its hull. The hint projection fills the layer from the view's
`smoke`, so an estimate reads what the server reads.

**The fog of war is a third, cruder system.** Revealed tiles come from fixed view paths over the movement cost table,
not from the ray. One revealed tile of a room reveals the whole room and hides its roof for good, shows the items lying
in it with a "spotted something" quote, and in the boxing sector takes the ring along with the room around it; both are
saved in the sector diff (`sim/campaign/sector-diff.ts`). Vehicles and blinded mercs reveal nothing. Underground, in a
basement or a cave by the map's flags, a tile under a flat roof is revealed only inside a room, though the look still
shows its items; in a cave every tile revealed, by a look, a room or a load of the revealed tiles, switches on its map
light (`20`). A sector entry with saved revealed tiles and a native import reveal every one as a room reveal does, outside
rooms too, and the fog keeps those tiles for the picture (`fog.revealedAtLoad`; a ja2-node load keeps them, deviation
"Revealed tiles on load"). The client derives hidden roofs and show-through from the revealed rooms and those tiles, and
the wire frames also from every tile revealed so far, which the view carries as `revealedTiles` (`render/world/reveal.ts`,
`05`). Above ground there is no terrain fog.

**Slanted roofs keep a ceiling.** A revealed room, and a load that reveals a tile of it, take off every slanted roof
with a tile there; the tiles of such a
roof that sight has not revealed show its flat ceiling instead (the original's `SLANTROOFCEILING1` at the head of their
roof layer). The ceilings are fog of war state (`fog.slantRoofCeilings`), not derived from the revealed tiles: the
original puts them on and takes them off only when a look or a load examines a roof, and a look examines the first
slanted roof on each tile it sees and on the base tile of each roof a revealed room takes off. A load clears them and
examines the roofs over every revealed tile. The view sends them as `slantRoofCeilings` (`29`).

**Items are found by the same view paths.** A radio look shows a merc the items on them with their locator; new items
there halt him in combat, and his look takes the item locator lock and queues one items-seen quote, which a locked
lock in combat silences and an attack in progress holds until it ends on our turn. The drop at a death makes every merc
look so at once. Other new items (a dropped item, a knife laid by a throw, a dud) only set every soldier's
`lookForItems`; he then looks at his next animation frame (`overhead.ts`) without locators: the items show, but he
does not halt and queues no items-seen quote. Every such look also shows him the rotting corpses on the tiles where it
reveals items, which he may comment on (`33`). The locators are the client's (`ui/screens/tactical/item-locators.ts`):
each `itemsRevealed` starts one, held while the view's `itemLocatorsLocked` stands, and the quote keeps the first tile
of its look to slide the view to as it starts (`itemsLocated`; an escort slides at once). The lock reaches the client as
view state, not as events, because a look out of combat drops and takes it again within one pass (`29` §7).

**The camera at a sighting.** An opponent turning visible to our team or the militia slides the view to him in combat
and before the sector's first sighting; a later sighting by our merc on the enemy's turn locates him and slides to the
enemy that paused the enemy's turn (`soldierLocated` with `slide`, `perception/sight.ts`, `perception/wiring.ts`).

**Decay.** A team's turn start decays its public opplist and watched locations, each soldier's his own. In real time
the decay waits for 20 world seconds on the campaign's `RealtimeClock`, shared by every loaded sector; leaving combat
forces up to two decays at once (deviation "Real-time turn after combat").

**Iteration order is state.** Looks walk `mercSlots`, in the order the soldiers entered the sector (`07`), team and
radio loops walk soldiers by id. Both decide `visible` transitions, ties in the best-sighting list and which draws
happen. A `handleSight` runs to completion, nested looks included, before the next event.

**Randomness.** `pre`: each footstep (one draw for the army, zero to two for others, also for a door's noise), the
experience chances of spotting an enemy who has not seen the merc (`33`), thrown objects landing (`34`). `main`: the
order of `ourTeamRadiosRandomlyAbout`, the bloodcat roar, the hostile-quote speaker, which of the two room-roof item
quotes, which of the two items-seen quotes (drawn when the dialogue queue runs it), and at a sighting of a soldier
once the sector's first sighting is over the `Random(100)` that picks the ENEMY battle sound over the line, only with
English or Chinese data (`content.sightingBattleSound`, from the data version: `31`).

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
| A muzzle flash shows a shooter as in daylight to anyone but a tank, which keeps looking only the way it is turning, also where a look ignores the facing | `sight-modifiers.test.ts` |
| In combat a locked item locator keeps every merc who sees new items quiet; only a look out of combat, the items-seen quote itself or the creature queen's death unlocks it | `item-locator.test.ts` |
| A look out of combat that shows items on two tiles or more leaves the item locators unlocked, so they flash before the items-seen quote; one tile leaves them locked until it starts | `item-locator.test.ts` "leaves the locators unlocked after a look out of combat …" |
| Only a look forgets which creature the team saw last: a radio outside a look (a noise, an unseen attacker) that reveals a soldier brings the creature line | `../narrative/sighting-quotes.test.ts` |
| A merc counts himself among the allies who see half the enemies, so the in-trouble line needs four opponents in his sight when he stands alone | `../narrative/sighting-quotes.test.ts` |
| A look examines only the first slanted roof on a tile, so a hidden roof whose base lies under another gets its ceiling only once a tile of its own is seen | `slant-roofs.test.ts` |
| Sight takes no roof off a tile outside any room, but the load of the sector's revealed tiles takes off the roofs and slanted roofs of every one of them, so the picture of a sector entered again differs from the one its stay left | `slant-roofs.test.ts` "takes off a slanted roof over a tile a load revealed outside any room …", `src/render/world/reveal.test.ts` "take the roof off a revealed tile outside any room …" |
| The mercs aboard a vehicle of ours look, hear and radio from its tile, while the vehicle never looks and notices no unseen attacker, though enemies see it | `../vehicle-presence.test.ts` "lets the mercs aboard look …", "lets the vehicle notice no unseen attacker …" |

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
- Hiring a merc while a sector is loaded wipes our team's public last-known locations there (`TacticalCreateSoldier`
  runs at the hire); ja2-node creates hired mercs outside the tactical layer and skips it. Only the AI reads these
  locations, and it never decides for our team.
- A merc aboard a ground vehicle is a valid sighting at the vehicle's tile (`IsSoldierValidForSightings`,
  `Tactical/OppList.cc:621`), and nothing in the line of sight treats the vehicle's own structure apart: he looks out
  from its tile and an enemy who sees that tile sees him (`../vehicle-presence.test.ts` "lets enemies see the mercs
  aboard …"). The helicopter's passengers never count; boarding keeps their opplists, which age with every decay and
  never see again (`25`).

Deviations of this domain: "Enemy sighted on their turn", "Real-time turn after combat", "Ambient light and light
schedule", "Sounds out of sight", "Bullets of unseen shooters".
