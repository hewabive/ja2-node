# 33 — Hits and damage

From a bullet, blade, punch, blast or thrown object reaching a soldier to the end of the attack: hit location, armour,
damage, hit and death animations, corpses and the crows they draw, bleeding, the attack busy count, suppression, morale
and experience.
Siblings: `11` guns, bullets and melee up to the impact; `34` throwing and item physics; `12` explosions; `10` turns
and interrupts; `13` the combat AI. Each module's `@src` header names the Stracciatella functions it ports; read those
for the formulas.

## 1. The path of a hit

Paths are under `src/sim/tactical/`.

```
bullet enters the target's tile                       combat/bullets.ts (suppression points first)
  └ bulletHitMerc: hit location, over-penetration     combat/hit.ts
     └ bulletImpact: fluke, armour, criticals          combat/impact.ts, combat/armour.ts
        └ weaponHit → eventSoldierGotHit               combat/hit.ts
           soldierTakeDamage, busy +1, hit animation
           └ hit animation ends → releaseSoldiersAttacker,
             or fall → 497 → death animation → 440    combat/death.ts (opcodes, corpse, getting up)
melee: the hit arrives as a queued game event          combat/melee.ts → game-events.ts → weaponHit
… busy count reaches 0 → end of the attack            combat/barrier.ts
  suppression, our attack's implications (narrative/civ-hostility.ts), noticing the attacker, combat entry,
  kill quotes, stat points, deferred noise, end of battle
```

| Module | Holds |
|---|---|
| `combat/hit.ts` | The hit itself: location, damage, hit animations, falls, collapse, the damage window |
| `combat/impact.ts`, `combat/armour.ts` | Damage from impact: fluke, armour wear, criticals and stat loss, instant kills; a vehicle's armour |
| `vehicle-damage.ts` | A vehicle's share of the damage, its condition, its destruction and wreck explosion |
| `combat/death.ts` | Incapacitation and death opcodes, jars broken in a fall, corpses and dropped items, kill records, getting up, the skull delay |
| `rotting-corpses.ts` | The corpse slots, a corpse's aging when it is added, decapitation and the heads it leaves, the crows feeding on a corpse |
| `crows.ts` | Crows sent to rotting corpses by day, a flock's flight from a noise or an attack, the climb of code 466 |
| `narrative/corpse-comments.ts` | A merc's comment on a rotting corpse his look reaches, and the tolerance it leaves him and his squad |
| `combat/bleeding.ts` | Bleeding at turn start, the next-bleed time, the dying line and the bleeding warning; no bleeding for a patient being bandaged or whom a doctor in his sector can heal (the campaign answers through `NarrativePort.anyDoctorWhoCanHeal`) |
| `combat/barrier.ts` | The attack busy count, suppression, noticing an unseen attacker, the end of an attack |
| `combat/morale.ts` | Tactical morale events; strategic events and the death fan-out are `sim/campaign/morale.ts` |
| `combat/experience.ts`, `combat/skill-check.ts` | Stat change chances and their conversion to points; skill checks |
| `combat/context.ts` | `CombatContext`, the narrow state `bulletImpact`, `hthImpact` and `statChange` need |

Agent API events of a hit (`bulletImpact`, `soldierHit`, `soldierDied`, `vehicleDestroyed`, `attackResolved`): `29`.

## 2. Design

**Damage at impact, death at the end of the death animation.** Life drops when the bullet arrives; corpse, item drops,
kill credit and removal from the map happen at opcode 440, seconds later. Until then the dying soldier keeps his tile
with life 0 and can be hit again. Right after the drop every merc looks for items (`08`), so a merc who sees the drops
halts in combat. The kill's quotes (`tactical/narrative/kill-quotes.ts`: the killer's, a witness's of a headshot, a
buddy's) and the items-seen quote wait for the end of the attack; only then does the victim become the last kill talked
about (deviation "Last kill talked about").

**One barrier.** `turn.attackBusyCount` counts everything still resolving: attacks, bullets in flight, hit animations,
suppression stance changes. Every increment is paid by exactly one decrement; a soldier releases all hits of a sequence
at once (`releaseSoldiersAttacker`). While the count is above 0, interrupts, noise and AI re-planning wait; reaching 0
runs the end of the attack once, for whoever brought it to 0: the shooter, or the suppressor whose stance change ended
last. There is no watchdog: holds the original leaves to its 15 s and 25 s breakers are released where they arise, and
a leak fails the tests (deviations "Watchdogs", "Hit during a non-interruptible animation", "Knock-back and the
sighting pause", "Suppression stance change from the end of the previous one").

**Our dead merc holds the barrier** for a fixed 1920 game ms after 440, where the original waits for the portrait and
skull animation in wall-clock time (deviation "Our merc's death").

**A merc of ours can die off the tactical map.** Bleeding, gas and electricity that bring a soldier not on the loaded
map to life 0, or any soldier while the map screen is up, hand him to the campaign through
`SectorHooks.mercDiedOffTheMap` (`handleTakeDamageDeath`, `Tactical/Soldier_Control.cc:5401`): the strategic bookkeeping
of `campaign/merc-fate.ts` runs at once, with no death animation, corpse or skull, and `mercDied` stands for the death cry
and the two samples the original plays (`29`). On the tactical screen that is all: his gear stays on his record and
nobody comments, since the buddy lines belong to the death on the tactical map (`Tactical/Overhead.cc:2207`, said before
its bookkeeping) and to the map screen (`Strategic/Strategic.cc:36`). The bookkeeping sets `Soldier.dead` beside the
roster's `DEAD` bit, the one `SOLDIER_DEAD` of the original, so the tactical death never runs again for him. A merc of
the loaded sector lying collapsed when he dies on the map screen gets both the death animation and the bookkeeping; the
body, the gear and the compression stop of the map screen are gaps "Death in the map screen".

**The damage window is presentation with a gameplay effect.** A soldier's floating damage number accumulates every life
loss for 8 × 250 ms, and the "blown away" chest kill reads that sum: hits landing within about 2 s add up. The window
only runs for a soldier the player can see, so hits on an unseen soldier keep adding up until a visible one. ja2-node
keeps it in the simulation as a game-ms timer (`damageWindow`, `updateDamageDisplay`).

**Suppression works only in turn-based combat.** Points accrue in real time too, but only the end of an attack in
combat turns them into lost APs, morale and a stance change; the 5 s real-time turn wipes them.

**Hit and death timings are data.** Frame counts, speeds and opcode positions come from the user's `ja2bin.dat` and
`data/tables/anim-control.json`; the stub pack builds its own scripts with the same gameplay opcodes and shorter frames
(`stubs/anim-scripts.ts`), so test timings differ from the original's.

**Stat points land at the end of the attack.** In combat, chances accumulate during the attack and become points only
when the busy count reaches 0. AI morale is recomputed only when the AI decides, so suppression tolerance and the
chance to hit read the value of the soldier's last decision.

**Autoresolve reuses the damage rules** through `CombatContext` instead of a copy (`19`).

**A vehicle is hurt through its record in the vehicle list** (`25`). A soldier of a vehicle body never bleeds, falls or
plays a hit: `soldierTakeDamage` hands his share of the damage to `vehicleTakeDamage`, which finds the vehicle's
soldier again by its id and lowers his life; at 0 the vehicle is destroyed, explodes at his tile and dies at once,
before the attack ends, and its passengers die through `TacticalState.vehicleHooks` (`25`). His armour
is his vehicle type's armour item, whatever he wears. A vehicle soldier without a slot in the list (one an older
snapshot holds, until his sector loads again) takes no damage and has no armour, where the original would read past its
list.

**A corpse keeps the height it is drawn at** above its level (`Corpse.heightAdjustment`, the definition's
`sHeightAdjustment`): set from the soldier's height as he dies or is added to an unloaded sector, kept by the sector
diff and read by the native import, and sent in the corpse view and the vaporize event. The client draws the corpse that
many pixels up at a flat corpse's depth (`05`).

**Corpses keep the original's slots.** `t.corpses` lists the lying corpses in slot order and `t.corpseHoles` the slots
emptied this sector, a corpse too old to lie included, because the crows' pick draws over every slot ever taken
(`rottingCorpseSlots`); a new corpse takes the first empty slot. A sector load starts with none.

**Rotting corpses draw crows by day above ground,** at a real-time turn and when a sector's corpses load from its diff
(`16`): before the sector's soldiers, with the previous sector's crow count. The crow count and its stop flag are
campaign-wide like the original's `gTacticalStatus`: `SectorFlowState.crows`, shared with the loaded sector as the
real-time clock is, drawn at every sector entry. A crow is a civilian soldier created as `AddCrowToCorpse` creates it,
with its draws; noises and attacks reach `crows.ts` through tactical hooks. A flying crow climbs at code 466 and leaves
the map at 100; the client draws its shadow on the ground (`fly_shdw.sti`, a stub graphic in the stub pack) from the
crow's tiles in the view (`src/app/world/crow-shadows.ts`, deviation "Crow shadows out of sight"). The stub pack's crow
scripts carry codes 466, 785 and 786 (`stubs/anim-scripts.ts`); with no crow art the stub pack draws a crow with the
stub soldier sheets. The pecking sound's draw is the browser's (deviation "Cosmetic draws of creatures") and the crows
come whatever the camera shows (deviation "Crows on screen"). A crow keeps the slot and tile of its corpse in
`pendingActionData1` and `pendingActionData2`, as the original does, and the corpse counts the crows feeding on it
(`servicingCrows`) until each leaves the map or dies. A native import sends crows once more after the helicopter is
placed, as loading the corpses file does (`adoptLoadedSector`, `src/sim/campaign/sector-flow.ts`; a ja2-node load does
not, deviation "Crows on load").

**A rotting corpse turns a merc's stomach.** Every look that reveals items (`08`) shows a merc the corpses on its
tiles; at a rotting one he says quote 33 when his `corpseQuoteTolerance` is 0, or 1 while crows feed on it, which
resets it and may harden the squad. The tolerance is the merc record's (`NarrativePort.corpseQuoteRecord`); the daily
update lowers it (`src/sim/campaign/contracts/daily.ts`). The comment puts the multi-purpose locator on the tile and
level of the look (`corpseLocated`; `src/ui/screens/tactical/item-locators.ts`).

**Randomness.** Gameplay draws keep the original order on `main` and `pre` (`01` §3.6); the order of a whole shot is
`11`. The kill quotes draw on `main` in `HandleKilledQuote`'s order, also when nobody speaks. Curses, laughs (the laugh
or cool after a kill among them), blood-pool graphics and stat-change messages are not drawn (deviation "Cosmetic draws
in attacks").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `combat/` unless a path is given:

| Quirk | Test |
|---|---|
| A burst earns marksmanship on its second round only, a one-round burst never | `burst.test.ts` |
| A stat change rolls `PreRandom` once per chance, even at chance 0 | `experience.test.ts` |
| Bad news hurts one point more on a roof: the original reads the map level where it meant the experience level | `morale.test.ts` |
| A militia kill counts three | `death.test.ts` |
| A soldier knocked out on his own team's turn counts two turns down, also in a pose with no unconscious stop: the original runs its getting-up check twice | `death.test.ts` |
| A crouched fall forward from a hit never breaks jars: its fall sound 721 plays in the second animation, and 722, the code tested for it, is not in its script | `death.test.ts` |
| Hits alone never bring the beating quote: it asks for a life gain of more than 20 since the turn began | `close-call.test.ts` |
| Two of our mercs who shoot each other out of combat trade shots until one falls: every end of attack makes its target, if conscious and holding a gun, fire back at the attacker's tile | `src/sim/tactical/narrative/civ-hostility.test.ts` |
| A skill check with no chance at all passes on a roll of 0: the margin is 0, not below it | `skill-check.test.ts` |
| A merc corpse cut more than a day after death rots on the spot and gives a second head: `DecapitateCorpse` copies the corpse before marking its head taken | `src/sim/tactical/rotting-corpses.test.ts` |
| The crows' corpse pick draws over every slot taken this sector, so it may land on an emptied slot or one a corpse too old to lie took | `src/sim/tactical/crows.test.ts`, `src/sim/tactical/rotting-corpses.test.ts` |
| `HandleTacticalEndTurn` sends crows whenever the world clock moved since its last call: its unsigned stamp only holds it while the stamp is up to 1200 s ahead | `src/sim/tactical/crows.test.ts` |
| Every crow that hears a noise sends the flock up again: the paths start with the next game events, so each crow's flight is drawn once per listening crow | `src/sim/tactical/crows.test.ts` |
| A crow off the ground stands on the roof level, roof or not: `SetSoldierHeight` sets the level by the height | `src/sim/tactical/crows.test.ts` |
| Code 466 compares the truncated height with the target and steps the fractional one | `src/sim/tactical/crows.test.ts` |
| A flying crow's shadow appears only once he reaches the next tile after taking off or coming into sight: the flight state is switched on before it is set, and the shadow's visibility is the one before the change | `src/app/world/crow-shadows.test.ts` |
| A corpse is saved with the crows feeding on it when the squad leaves, before the unload removes them, so on return it counts crows that are gone and the mercs comment on it sooner | `src/sim/campaign/sector-flow.test.ts` |
| A merc on a roof comments on a corpse on the ground below the tile he looks at: `GetCorpseAtGridNo` ignores the level | `src/sim/tactical/narrative/corpse-comments.test.ts` |
| A corpse on a roof keeps the soldier's height above the storey: one the map placed there (58) lies 8 px above the roof, one who climbed up (50) on it | `death.test.ts` |
| A vehicle other than a tank takes a third of gunfire and twice an explosion over 50, but a structure explosion whole; fists, gas, blades, falls and bleeding do nothing to any vehicle | `src/sim/tactical/vehicle-damage.test.ts` "takes a third of gunfire …", "takes nothing from fists …" |
| A destroyed vehicle sets off a `GREAT_BIG_EXPLOSION` at its own tile credited to its attacker, then dies and kills its passengers in seat order, stopping at the first one already dead | `src/sim/tactical/vehicle-damage.test.ts` "blows up at its own tile …", `src/sim/campaign/vehicle-destruction.test.ts` |
| A tank's death marks its `NPC164` profile dead, though it writes no history entry | `src/sim/tactical/vehicle-damage.test.ts` "marks a tank's NPC164 profile dead …" |
| A vehicle's armour is its type's armour item at status 100 wherever it is hit, the vest, helmet and leggings a tank wears ignored: it draws its `PreRandom(100)` every time, can never fail and never wears | `src/sim/tactical/vehicle-damage.test.ts` "protects a vehicle with its type's armour …" |
| A corpse added to an unloaded sector takes no level from its definition: it lies on the ground at the soldier's whole height, 58 px up for one who stood on a roof, while his items stay on the roof level | `src/sim/campaign/sector-loot.test.ts` |
| A merc of ours who bleeds to death outside the loaded sector while the tactical screen is up leaves no body and no gear, and nobody comments | `src/sim/campaign/death-off-the-map.test.ts` "leaves no body and no gear …" |
| An insured merc dying off the tactical map with no enemy in the loaded sector is a suspicious death: the test reads the loaded sector, not his (`Strategic/Strategic_Merc_Handler.cc:103`) | `src/sim/campaign/death-off-the-map.test.ts` "an insured merc dying off the map …" |

Not pinned yet:
- A melee hit lands on the target's own aim location, not the attacker's (`game-events.ts`).
- "Did lots of damage" morale is tested on the raw damage, before a punch turns it into breath loss, and for any
  victim, friends included.
- A soldier hit by a bullet keeps the suppression point the same bullet gave him a moment earlier.
- `underFire` is set after `noticeUnseenAttacker`, so the interrupt duel of that notice sees the previous value.

## 4. Not checked against the native build

Inferred from reading the source:
- A hit on a soldier lying in `FLYBACKHIT_STOP` never releases the attacker; believed unreachable.
- A shooter hit mid-burst keeps `bulletsLeft`, so his attack's hold leaks; ja2-node does not special-case it.
- A negative float breath converted to `UINT8` assumes x86 truncate-then-wrap; ja2-node does the same.
- The ready APs are charged again on returning to aim after a hit; a special move may overshoot its final tile.
- Whether the turn start `EnterCombatMode` runs clears the suppression points of the attack that began combat.
- The agility gain for a bullet that passed through someone and then stopped in a wall.
- The quotes of a kill: their hold until the end of the attack, the draws of `HandleKilledQuote` and the items-seen
  quote's `Random(2)` when the dialogue queue runs it.
- Vehicle, boxing, Meanwhile and queen branches are ported as read, without probes.
- A merc of the loaded sector lying collapsed who bleeds to death while the map screen is up starts his death animation
  and gets the strategic bookkeeping at once; a standing one dies at once in tactical terms and gets it at the skull.

Not ported: gaps "Unseen soldiers in combat".
