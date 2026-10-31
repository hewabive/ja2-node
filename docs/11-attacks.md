# 11 — Attacks: guns, bullets and melee

Gun and melee attacks from the order until the bullet, knife or blow reaches a soldier: the order and its checks, AP
costs, fire animations, jams, the chance to hit, the bullet's flight through structures, the chance to get through, and
melee. Siblings: `33` what the impact does (hit location, armour, damage, death, the attack busy count, suppression,
experience); `34` throws, launchers and item physics (the LAW, the tank cannon and thrown knives fly as bullets here);
`12` explosions; `08` line of sight and noise; `10` turns and interrupts; `13` the combat AI that orders attacks; `29`
the `attack` order, `estimateAttack` and the attack events. Each module's `@src` header names the Stracciatella
functions it ports; read those for the formulas, constants and check order.

Weapons, ammunition and armours come from `data/externalized/` (`12`); a structure's armour and density from its JSD and
`data/tables/material-armour.json`. Fire, burst, punch and stab scripts come from the user's `ja2bin.dat`
(`content/anim/timelines.ts`), speeds and flags from `data/tables/anim-control.json`; the stub pack builds its own
scripts with the same gameplay opcodes and shorter frames (`stubs/anim-scripts.ts`).

## 1. The path of an attack

Paths are under `src/sim/tactical/`.

```
order: handleItem — checks, APs checked only, the psycho's burst roll         combat/attack.ts, combat/ap.ts
  gun: beginFireWeapon event → eventFireSoldierWeapon: busy +1, bulletsLeft   game-events.ts, combat/attack.ts
       ready (APs on entering it) or turn (APs when the direction is set)     animation.ts
    fire state: 757 busy +1, 470 jam check, 430 queues fireWeapon             attack.ts (attackOpcode)
      after the soldier pass: fireWeapon → useGun: APs paid, chance to hit,
      PreRandom(100), ammo, marksmanship, fireBulletGivenTarget, noise, wear  attack.ts, combat/chance.ts
        first tile at once, then one tile per tick: structures, people,
        suppression points                                                    combat/bullets.ts
          stopped by a structure or the ground → release 425 ms later
          person → bulletHitMerc                                              combat/hit.ts (33)
    burst: 448 before each round (jam check on round 1), 449 at the end
  melee: handlePunchAttack / handleBladeAttack → begin event, busy +1         combat/melee.ts, melee-reach.ts
    492 dodge (visual only), 430 → useBlade / useHandToHand: APs, chance, roll
      hit → weaponHit game event 20 ms later → eventSoldierGotHit             game-events.ts, combat/hit.ts (33)
… busy count reaches 0 → end of the attack                                    combat/barrier.ts (33)
```

| Module | Holds |
|---|---|
| `combat/attack.ts` | `HandleItem` and its gun, knife-throw, throw and launcher branches; the hand item breaking; ready and fire animations; jams and unjamming; the fire opcodes; `FireWeapon`, `UseGun`, the body-part roll |
| `combat/ap.ts` | Attack AP costs, the walk to a melee target and its cache, `EnoughAmmo` |
| `combat/chance.ts` | `CalcChanceToHitGun` and its AI variant, `GunRange`, the barrel extender, `SoldierDifficultyLevel` |
| `combat/positions.ts` | Soldier and target heights, body-part line of sight over `perception/los.ts` (`08`) |
| `combat/bullets.ts` | Bullets: firing, the miss deviation, flight, structures, windows, locks, misses, missile trails; the chance to get through |
| `combat/steal.ts` | The steal order, `MercStealFromMerc`, the steal branch of `UseHandToHand` |
| `combat/melee.ts`, `combat/melee-reach.ts` | Melee orders and begin events, the martial arts strikes (`DoNinjaAttack`), a knife at a corpse (`DECAPITATE`), `CalcChanceHTH`, `UseBlade`, `UseHandToHand`, `HTHImpact`, the queen's swipe; the adjacent-tile searches |
| `combat/spread-burst.ts`, `combat/skill-check.ts` | Spread-burst locations; `SkillCheck` (unjamming) |
| `game-events.ts` | The event pump: fire, direction and the delayed melee hit |
| `explosions/throwing.ts` | `UseThrown`, `UseLauncher`, the thrown chance to hit, `WillExplosiveWeaponFail` (`34`) |
| `src/sim/hints/estimate-attack.ts` | The attack hint: AP cost, chance to hit and chance to get through on the player's view |

## 2. Design

**Who rolls when.** Guns and melee roll at the fire frame: opcode 430 only queues `fireWeapon`, which runs after every
soldier's pass of that tick, against the world as it is then (deviation "Game events"); throws roll at the order
(`34`). The order checks the APs and pays nothing; the attack pays at the fire frame (a burst on its first round, two
pistols on the main hand only), the raise when the ready animation starts and the turn when the direction is set.

**The roll sets `hitBy`, not a hit.** `chance − roll` above 0 traces the bullet straight at the aim point and adds
damage; 0 or less deflects it by an angle that grows with the miss. What the bullet meets decides: cover stops a hit, a
miss still strikes the target or a bystander in its way. Each round of a burst rolls at its own 430 and aims at the
target's height at that moment.

**A random aim location is rolled once.** With `AimShot.RANDOM` whichever of `selectFireAnimation` (a standing single
shot) and `useGun` comes first rolls the body part, and the attack keeps it. The chance to hit is computed after the
roll, so a roll on the head takes the head penalty the estimate did not show.

**Fixed tick, the original's frame order.** Each 5 ms tick runs physics (every 20 ms), bullets, explosions, the
miss-animation releases and the real-time turn, then the soldier pass with the animation opcodes, then the event pump
(`overheadHooks` in `tactical-sim.ts`). Bullets move one tile per tick, the first inside `fireWeapon`, thrown knives
every 30 ms (deviation "Bullet flight"). Timers run on game ms: a stopped bullet releases its attacker 425 ms later
(five steps of more than 80 ms on 5 ms ticks; deviation "Miss animation in water"), a melee hit lands on the first tick
more than 20 ms after it was queued, 25 ms.

**The bullet is the line of sight, continued.** It keeps the original's float32 deltas, double angles and 20-bit fixed
point and steps through the LOS cells of `08`, but on the 2D distance and past the target until something stops it or
it leaves the visible map (`onVisibleWorldTile`; in a basement, its visible area). Its last bullet releases the
attack's hold, whatever ended it.

**The chance to get through is a fake bullet.** The same flight without draws, weighting what could stop it; the hint,
the AI and the marksmanship gain use it. The hint and the AI call `calcChanceToHitGun` with `modify = false`, so only a
real shot wears a barrel extender, the one draw of the chance to hit.

**Default options.** Stracciatella's `game.json` defaults are compiled in: chance to hit 1–99, head ×1.5, legs ×0.5,
the aim and scope bonuses, `better_aiming_choice` off, no fixed shot cost; bullets are not hidden, so they step one tile
per update.

**Melee.** The strike frame hits whoever stands on the tile then; the hit follows as a game event. A soldier out of
reach walks up first (`walkUpForMelee`, `combat/melee.ts`), the AI's and ours alike; the agent's `attack` takes the
click's checks before it (`combat/melee-order.ts`). A punch at a tile its target has left releases the hold at once,
where the original leaks it until its 25 s watchdog (deviation "Melee hold leaks"); a prone attacker who turns is not
laid down mid-attack (deviation "Melee from a prone turn").

**Refusals.** `HandleItem`'s player refusals are not ported (deviation "Attack refusals"). The rocket rifle's imprint
is (`rocketRifleImprintAccepts`, `combat/attack.ts`): our merc's first pull of a virgin rifle only takes his
fingerprints, and the agent's `attack` answers it as the `gunImprinted` refusal, someone else's rifle as
`wrongFingerprint`.

**Randomness.** Gameplay draws keep the original order on `main` and `pre` (`01` §3.6): each call is made where the
original makes it, so call order is draw order, and a draw whose result is thrown away is still made. Curses, laughs,
the civilian quote, stat-change messages and missile-trail delays are not drawn (deviation "Cosmetic draws in
attacks"); unsequenced pairs are drawn left to right (deviation "Dud test operand order"). What is checked natively:
§4.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `combat/`:

| Quirk | Test |
|---|---|
| A target dodges only the creature queen's shots: the original tests `!(body != QUEENMONSTER)` | `combat.test.ts` |
| An enemy's gun takes only the penalties of the difficulty table (`min(0, mod)`); his blade or fists take its bonuses too | `combat.test.ts`, `melee.test.ts` |
| The jam check rolls `PreRandom(100)` twice even for a gun above 80 %, which can never jam | `combat.test.ts` |
| A bullet strikes a bystander in its path only if the player sees him (`bVisible`), whoever fires | `combat.test.ts` |
| A barrel extender falls off only when its status less two `Random(35)` lands in 0–9: the original subtracts unsigned, so a larger roll wraps and it holds | `combat.test.ts` |
| A punch turns a target who did not see it coming toward the attacker; a blade turns one who did | `melee.test.ts` |
| A martial arts strike turns an unaware target without stopping him or cancelling his AI action, where a plain punch does both | `melee.test.ts` |
| Cutting off a head costs only the kneel: `DECAPITATE` has no fire code, and a blade pays its APs only when it strikes (`UseBlade`) | `melee.test.ts` |
| A creature, the robot or a tank, which the steal chance of 0 should protect, is robbed on a roll of 0: the roll only has to reach the chance | `steal.test.ts` |
| A steal ends the attack twice, at codes 442 and 753 of `STEAL_ITEM`, so the end-of-attack checks run twice | `steal.test.ts` |
| A thrown knife that strikes a wall is lost: only one that falls to the ground stays on the map | `knife-throw.test.ts` |
| A thrown knife stopped by a window, or dropped by a target with full pockets, lies on a raised table or shelf of its tile; one that falls to the ground lies under it. The window's roof branch (`Tactical/LOS.cc:4060`) never runs: the window test admits only heights in the ground cubes | `knife-throw.test.ts` |
| A diagonal knife target is priced without the step to the side tile the stab needs: the AP cost finds the target on all eight neighbours, `HandleItem`'s blade path on the four sides only | `melee.test.ts` |
| The adjacent-tile search never answers the soldier's own tile when a switch is on it (`Tactical/Overhead.cc:3293`), with or without its door handling: a merc bandaging himself on a switch tile first walks to a tile beside it | `src/sim/tactical/first-aid.test.ts` |

Not pinned yet:
- A prone shooter's close-range penalty against a standing target turns into a bonus at four and five tiles
  (`proneShooterCloseShotPenalty`).
- A thrown knife that falls to the ground becomes a clean one; one stopped by a window keeps its blood; one that strikes
  a corpse is lost.
- The wear roll of a thrown knife lands on the knife drawn into the hand after it.
- A LAW that fails explodes at the shooter and still launches its rocket (`useGun`).
- A missed first bullet keeps its intended angle for the wall-corner test (`horizAngle`).
- A lock shot with no impact left turns the damage into a huge `PreRandom` range (`shootLock`).
- The chance to get through counts HEAT as plain ammunition, where the bullet treats it as armour-piercing.
- A structure resists less below the gun's range as well as more beyond it: the original commented out the range test.
- The burst's `PreRandom(80)` jam roll for later rounds is dead code: opcode 448 checks round 1 only.
- A steal ends the attack with the thief's previous target: `MercStealFromMerc` sets no target, so the target of his last
  attack is the one who notices him and may turn hostile.

## 4. Not checked against the native build

The oracle's `cth` probe compares the chance to hit, the AP cost and the chance to get through for every aim level
and every armed soldier of a save, `bestshot` the AI's best shot, `los` the line of sight, and `stab`/`beststab` the
chance to stab and `HTHImpact` with its fluke draw replayed strictly (`tools/oracle/README.md`). `cth` and `bestshot`
draw nothing. Inferred from reading the source:
- The draws of a whole shot in order, from the order to the end of the attack: the hand item breaking, the jam check,
  the body-part roll, the barrel extender, the hit roll, the marksmanship gain, the miss deviation, each tile's
  structure, accidental-hit and suppression rolls, then the impact (`33`); likewise a punch or a stab.
- The bullet's flight: structure hit chances, materials, windows and wall corners, lock shots, the ground and roof
  stops, the drop beyond twice the range, missile trails.
- The fire timeline and its opcodes, jams and unjamming, two pistols, the 425 ms miss release and the 25 ms melee delay.
- The chance to punch, the martial arts strikes, blade dulling, surprise attacks, the queen's swipe; the barrel extender and
  the robot's aim.
- Vehicles, tanks, boxing, the Meanwhile punch and the creatures' attacks are ported as read, without probes.

Other deviations of this domain: "Game events", "Bullet flight", "Level bullet into rising ground", "Miss animation in
water", "Melee hold leaks", "Melee from a prone turn", "Attack refusals", "Cosmetic draws in attacks", "Dud test operand
order", "Watchdogs", "Difficulty and progress in tactical".
