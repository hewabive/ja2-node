# 33 — Hits and damage

From a bullet, blade, punch, blast or thrown object reaching a soldier to the end of the attack: hit location, armour,
damage, hit and death animations, corpses, bleeding, the attack busy count, suppression, morale and experience.
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
  suppression, noticing the attacker, combat entry, kill quotes, stat points, deferred noise, end of battle
```

| Module | Holds |
|---|---|
| `combat/hit.ts` | The hit itself: location, damage, hit animations, falls, collapse, the damage window |
| `combat/impact.ts`, `combat/armour.ts` | Damage from impact: fluke, armour wear, criticals and stat loss, instant kills |
| `combat/death.ts` | Incapacitation and death opcodes, jars broken in a fall, corpses and dropped items, kill records, getting up, the skull delay |
| `rotting-corpses.ts` | A corpse's aging when it is added, decapitation and the heads it leaves |
| `combat/bleeding.ts` | Bleeding at turn start and the next-bleed time |
| `combat/barrier.ts` | The attack busy count, suppression, noticing an unseen attacker, the end of an attack |
| `combat/morale.ts` | Tactical morale events; strategic events and the death fan-out are `sim/campaign/morale.ts` |
| `combat/experience.ts`, `combat/skill-check.ts` | Stat change chances and their conversion to points; skill checks |
| `combat/context.ts` | `CombatContext`, the narrow state `bulletImpact`, `hthImpact` and `statChange` need |

Agent API events of a hit (`bulletImpact`, `soldierHit`, `soldierDied`, `attackResolved`): `29`.

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

**Randomness.** Gameplay draws keep the original order on `main` and `pre` (`01` §3.6); the order of a whole shot is
`11`. The kill quotes draw on `main` in `HandleKilledQuote`'s order, also when nobody speaks. Curses, laughs (the laugh
or cool after a kill among them), blood-pool graphics and stat-change messages are not drawn (deviation "Cosmetic draws
in attacks").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `combat/`:

| Quirk | Test |
|---|---|
| A burst earns marksmanship on its second round only, a one-round burst never | `burst.test.ts` |
| A stat change rolls `PreRandom` once per chance, even at chance 0 | `experience.test.ts` |
| Bad news hurts one point more on a roof: the original reads the map level where it meant the experience level | `morale.test.ts` |
| A militia kill counts three | `death.test.ts` |
| A soldier knocked out on his own team's turn counts two turns down, also in a pose with no unconscious stop: the original runs its getting-up check twice | `death.test.ts` |
| A crouched fall forward from a hit never breaks jars: its fall sound 721 plays in the second animation, and 722, the code tested for it, is not in its script | `death.test.ts` |
| Hits alone never bring the beating quote: it asks for a life gain of more than 20 since the turn began | `close-call.test.ts` |
| A skill check with no chance at all passes on a roll of 0: the margin is 0, not below it | `skill-check.test.ts` |
| A merc corpse cut more than a day after death rots on the spot and gives a second head: `DecapitateCorpse` copies the corpse before marking its head taken | `src/sim/tactical/rotting-corpses.test.ts` |

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

Not ported: gaps "Implications of an attack", "Morale without drugs", "Corpses", "Unseen soldiers in combat".
