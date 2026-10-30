# 12 — Items, inventory and explosions

Items from their definitions to the world: the item table, the item object, soldier inventories and their commands,
reloading, first aid, world items, what profiles and the equipment generator give soldiers, explosions, smoke, gas and
flares. Siblings: `11` firing (jams, wear, ammo use, the hand item breaking); `33` what a hit does to a soldier
(armour against bullets, the weapon knocked out of the hand, the drops at death); `34` throwing, launchers, duds and
item physics; `35` and `25` locks, door traps, action items and switches; `23` merchants; `29` the inventory commands;
`30` the inventory screens. Each module's `@src` header names the Stracciatella functions it ports; read those for the
formulas, the check order and the AP costs (`AP` in `tactical/points.ts`).

Item content is Stracciatella's JSON, copied unchanged into `data/externalized/` (`items`, `weapons`, `magazines`,
`armours`, `explosives`, `calibres`, `ammo-types`, `army-gun-choice-normal`/`-extended`, `explosion-animations`,
`smoke-effects`); the attachment, merge, combo-merge and face-item tables of `Items.cc` are in
`data/tables/item-tables.json` (`tools/transcribe/item-tables.ts`). Item names and descriptions come from the user's
`itemdesc.edt` through the content importer; the stub pack writes its own (`stubs/text.ts`).

## 1. Where things live

Paths are under `src/sim/tactical/` unless stated.

| Module | Holds |
|---|---|
| `src/content/items/items.ts`, `rules.ts`, `slot-limit.ts` | `ItemTable` in container order, the kind records (weapon, magazine, armour, explosive), attachment and merge rules, slot limits |
| `src/content/items/explosions.ts` | Explosion animations with their frame counts, smoke effect types |
| `src/content/formats/object.ts`, `src/sim/items/object.ts` | The 36-byte `OBJECTTYPE` record; `ItemObject` without a soldier: creation, stacks, magazines, attachments, unloading |
| `inventory.ts`, `soldier-inventory.ts`, `hand-item.ts` | Slots, placing and auto-placing, reloading, carried weight, the items of hired mercs and NPC profiles; what a hand change does |
| `item-merge.ts`, `stack-cleanup.ts` | Attaching with the soldier's skill check, merges; pooling the points of a stack |
| `inventory-panel.ts`, `inventory-commands.ts`, `item-compatibility.ts`, `item-description.ts` | The inventory commands on the original panel code, slot hatches, the description box values |
| `combat/reload.ts` | Which ammunition a reload takes, the reload hotkey |
| `first-aid.ts` | Bandaging: the start, the service loop, what ends it |
| `world-items.ts`, `item-actions.ts`, `give.ts`, `toss.ts` | World items: map load, pools, visibility; picking up, dropping, giving, tossing |
| `item-placement.ts`, `corpse-placement.ts`, `item-reachability.ts` | Where a dropped item or a loaded corpse lands; which items the sector inventory can reach |
| `equipment.ts`, `creation.ts` | Enemy and militia equipment, droppability, the reduced gun list on placements |
| `src/sim/campaign/map-inventory.ts`, `sector-loot.ts` | The map screen's sector inventory; items and corpses added to unloaded sectors |
| `explosions/explosion.ts`, `blast-damage.ts`, `structure-damage.ts`, `item-damage.ts` | Ignition, the tile animation, the spread, damage to soldiers, structures and items, chain reactions |
| `explosions/smoke.ts`, `light.ts`, `state.ts` | Gas clouds and gas damage, flares, `ExplosivesState` |

The path of an explosion:

```
igniteExplosion: busy count +1, sight off                           explosions/explosion.ts
  stepExplosions, every tick
    damage key frame → spreadEffect over the radius, or newSmokeEffect    explosion.ts, smoke.ts
      expAffect per tile (one PreRandom(100) for a blast or stun)
        structures and their listeners                              structure-damage.ts
        items on the ground, chain reactions → igniteExplosion      item-damage.ts
        damageSoldierFromBlast → eventSoldierGotHit                 blast-damage.ts, combat/hit.ts (33)
        dishOutGasDamage                                            smoke.ts
    last frame → busy count −1, sight back
each round, and every real-time turn: decaySmokeEffects, decayLightEffects    turns/turns.ts
```

## 2. Design

**Content order is behaviour.** All items sit in one container in JSON order, and several rules take the first match:
the default magazine, a random magazine, a launcher's round, the ammunition a reload finds. Keep the JSON order. A
reload with a magazine of another size records the neighbouring item id as the gun's magazine, which holds because the
shipped JSON keeps each calibre's sizes side by side (`reloadGun`).

**Default options.** Stracciatella's defaults: the reduced gun list (big-list guns and their magazines are replaced when
a map loads, in profiles and in enemy equipment), sci-fi items on, `game.json` as shipped (not every drop, drops not all
visible, no weapon status floor, no extra attachments).

**One object without the union.** `ItemObject` keeps the gun, money, bomb and key fields apart where `OBJECTTYPE`
aliases them (deviation "Object union"); one decoder reads the record of map items, detailed placements and native
saves.

**Commands instead of the cursor.** Each inventory command is one pick-up and one placement on the original panel code,
tried on copies first, so a refused one changes nothing; what the original leaves in the cursor goes back at once
(deviation "Item cursor"). A pickup names its items instead of the menu, and an item that does not fit stays on the
ground (deviation "Picking up items"). An attachment change is charged per command (deviation "Attachment AP").

**The equipment generator replays the original.** `generateRandomEquipment` keeps every draw of `Inventory_Choosing.cc`
on `main` in order, chances whose result is thrown away and `Random(1)` included. The first enemy generated in
tactical with a gun type drops it; the set of types already dropped belongs to the strategic status
(`sharedWeaponsDropped`) and is marked when the soldier is generated, not when he dies. The difficulty modifier comes
from the sector load (deviation "Difficulty and progress in tactical").

**World items are one list.** `TacticalState.worldItems` holds every item of the loaded sector; a tile's pool is its
entries in list order (`itemsAt`). Visibility keeps the original's values (hidden, buried, inside a closed container,
not yet seen, visible): sight reveals unseen items, a search on the tile reveals hidden ones. Other sectors' items,
clouds and flares live in the campaign's sector diffs (`campaign/sector-diff.ts`).

**Explosions run on the tick.** Frame `k` of an explosion shows `k·(delay + 5)` ms after ignition and the damage lands
at the damage key frame (deviation "Explosion timing"). Frame counts come from the graphics through the rule pack's
graphic facts; the stub pack has none and ends every animation one frame after its damage frame, so on stubs a blast in
water, which the original's water animation ends before its damage frame, hurts and gasses like one on land. An
explosion holds the attack busy count from ignition to its last frame and keeps sight off meanwhile; each soldier it
hits adds his own hold (`33`).

**Gas is state beside the soldier.** The gassed state, the per-round gas flags and the one-hit-per-blast flag live per
soldier id in `ExplosivesState` (deviation "Gassed soldiers"). Clouds and flares age by world seconds, which stand still
in turn-based combat; the sandbox counts its own (deviation "World clock for smoke and light").

**Structures report damage.** Before a structure takes a hit, the O3 statue may take it (`26`); after a damaging hit
the brothel listener runs, then `SectorHooks.structureDamaged` (the SAM sites, `18`), both with the wound before the
structure's armour. A structure is swapped for its damaged graphic or removed; debris, decals and wall end pieces are
not simulated (gap "Wrecked structures").

**Bombs and mines are scenery.** Map mines load armed and buried but never go off; there is no planting, disarming,
timer, remote detonator or explosive bomb queue, and picking an item up sets off no booby trap (gaps "Map items", "Duds
and timed bombs", "Unbuilt item actions", "Booby-trapped items"). The bomb queue runs only its action-item branch
(`25`); `useRemote` only opens the O3 statue.

**Randomness.** Gameplay draws keep the original order on `main` and `pre` (`01` §3.6). Explosion sounds, debris
variants and smoke graphics are not drawn (deviation "Cosmetic draws in explosions").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/tactical/`:

| Quirk | Test |
|---|---|
| Every map item rolls `PreRandom(100)` against its chance not to exist, even at chance 0 | `world-items.test.ts` |
| Two locked guns on a placement turn the weapon class positive again: the generator picks a gun of its own, and its spare clips come along | `equipment.test.ts` |
| A locked item ends the search for one of its class to make droppable: a locked helmet keeps the generated vest undroppable | `equipment.test.ts` |
| Grenades hit structures with their full blast: the parser asks for `structuralDamageDisivor`, so the divisor 3 in their data is never read | `explosions/explosion.test.ts` |
| A damage key frame ends the tile-animation pass, so of two explosions going off together the one ignited first hurts a tick later | `explosions/explosion.test.ts` |
| A blast's side branches run to the full blast range, even where a low structure shortened their ray | `explosions/explosion.test.ts` |
| Creature gas has no explosion animation: igniting it would raise the busy count for good (spit lays its gas directly) | `explosions/explosion.test.ts` |
| Once one cloud is due to age in real time, every later cloud ages too, by the same count | `explosions/smoke.test.ts` |
| A tile keeps the first cloud's gas: tear gas over smoke leaves it smoky | `explosions/smoke.test.ts` |
| Plain smoke gasses whoever steps into it without a good mask (aim −50, no interrupts), though it does no damage | `explosions/smoke.test.ts` |
| A mask worn below 70 lets a soldier get gassed, yet any mask clears the state at his next turn start | `explosions/smoke.test.ts` |
| A pile under a soldier or a blocking structure is picked up from a side tile only, though the reach animation turns to any neighbour: a merc on its diagonal walks first | `item-actions.test.ts` |

Not pinned yet:
- A blast in water switches to the water animation, which ends before its damage frame in the original data: it hurts
  nobody and leaves no gas. Only the frame counts are tested, with the original data
  (`src/content/items/explosions.test.ts`).
- A blocked side-branch step is retried from the same tile with a longer count instead of ending the branch
  (`spreadBranch`).
- A ray tests the height of the last structure it looked at, possibly a neighbour's (`getRayStopInfo`).
- A blast hits a soldier with `ANIM_CROUCH` as the hit location, which reads as the legs: never a head hit.
- A mask worn below 70 reduces an enemy's breath loss but never his wound; only our mercs' wounds are reduced.
- A militia soldier rolls the 25 % chance for a bomb and then never gets one.
- An M870 is generated loaded with buckshot (its default magazine) while its spare clips favour slugs.
- The equipment generator neither stacks nor reports a failed placement: what does not fit in a free pocket is lost.

## 4. Not checked against the native build

The oracle's `attach` probe checks the attachment AP, the `soldier` dumps carry inventories, and the autoresolve setup
compares every created militia and enemy soldier's inventory with status and ammo, so the equipment generator is
replayed natively (`tools/oracle/README.md`). Explosions, smoke and flares have no probe. Inferred from reading the
source:
- The explosion timing on a 5 ms poll with the original's strict test, and the sight check after the last explosion.
- The spread, the ray stops at walls, windows and doors, structure and item damage, chain reactions, gas damage.
- That `Random(1)` consumes a number in the original build (libstdc++ draws for a one-value range).
- That in real time a cloud ages about every third real-time turn while its occupants are gassed every turn, and that a
  flare never fades during turn-based combat.

Not ported: gaps "Map items", "Duds and timed bombs", "Unbuilt item actions", "Booby-trapped items", "Wrecked
structures", "Building owners", "Drugs and alcohol", "Auto-bandage", "Ambush" (gas masks), "Vision and hearing
modifiers" (smoke and gas in sight), "Walking side effects" (water damage to items), "Tossing from the item cursor",
"Inventory panel clicks". Other deviations of this domain: "Object union", "Item cursor", "Attachment AP", "Picking up
items", "Structural damage of grenades", "Explosion timing", "Tile-animation pass", "Water ripple", "Vaporized corpses",
"Gassed soldiers", "World clock for smoke and light", "Cosmetic draws in explosions".
