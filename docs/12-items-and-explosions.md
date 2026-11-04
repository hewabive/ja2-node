# 12 — Items, inventory and explosions

Items from their definitions to the world: the item table, the item object, soldier inventories and their commands,
reloading, first aid, world items, what profiles and the equipment generator give soldiers, explosions, smoke, gas and
flares, drugs and alcohol (§5), bombs and mines (§6). Siblings: `11` firing (jams, wear, ammo use, the hand item breaking); `33` what a hit
does to a soldier (armour against bullets, the weapon knocked out of the hand, the drops at death); `34` throwing,
launchers, duds and item physics; `35` and `25` locks, door traps, action items and switches; `23` merchants; `29` the
inventory commands; `30` the inventory screens. Each module's `@src` header names the Stracciatella functions it ports;
read those for the formulas, the check order and the AP costs (`AP` in `tactical/points.ts`).

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
| `item-merge.ts`, `stack-cleanup.ts` | Attaching with the soldier's skill check, merges; pooling the points of a stack, CTRL+click with the item cursor's objects |
| `inventory-panel.ts`, `inventory-commands.ts`, `key-ring-panel.ts`, `item-source.ts`, `item-compatibility.ts`, `item-description.ts` | The inventory commands on the original panel code, keys in and out of the key ring, the pocket or ring position the item cursor's commands take from, slot hatches and compatible outlines, the description box values |
| `combat/reload.ts` | Which ammunition a reload takes, the reload hotkey |
| `head-gear.ts` | The squad's switch between night and sun goggles (CTRL+N) |
| `first-aid.ts` | Bandaging: the start, the service loop, what ends it |
| `drugs.ts` | Adrenaline and alcohol courses, their effects, the regeneration boosters (§5) |
| `world-items.ts`, `item-actions.ts`, `give.ts`, `toss.ts`, `item-pointer.ts` | World items: map load, pools, visibility; picking up, dropping (beside the merc too), giving, tossing, passing |
| `bombs/bomb-object.ts`, `bombs/world-bombs.ts`, `bombs/mine-flags.ts` | The bomb fields of an object and arming; the world bomb list; the mine flags of the tiles and the blue flags (§6) |
| `item-placement.ts`, `corpse-placement.ts`, `item-reachability.ts` | Where a dropped item or a loaded corpse lands; which items the sector inventory can reach |
| `equipment.ts`, `creation.ts` | Enemy and militia equipment, droppability, the reduced gun list on placements |
| `src/sim/campaign/map-inventory.ts`, `sector-loot.ts` | The map screen's sector inventory; items and corpses added to unloaded sectors |
| `explosions/explosion.ts`, `blast-damage.ts`, `structure-damage.ts`, `item-damage.ts` | Ignition, the tile animation, the spread, damage to soldiers, structures and items, chain reactions |
| `explosions/wreckage.ts`, `map-changes.ts` | What a wrecked structure leaves around it, recorded as map changes |
| `explosions/smoke.ts`, `light.ts`, `state.ts` | Gas clouds and gas damage, flares, `ExplosivesState` |

The path of an explosion:

```
igniteExplosion: busy count +1, sight off                           explosions/explosion.ts
  stepExplosions, every tick
    damage key frame → spreadEffect over the radius, or newSmokeEffect    explosion.ts, smoke.ts
      expAffect per tile (one PreRandom(100) for a blast or stun)
        neutral owners of the tile's room take offence (ours only)  narrative/minor-offenses.ts (35)
        structures and their listeners, the wreckage                structure-damage.ts, wreckage.ts
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

**One object without the union.** `ItemObject` keeps the gun, money and key fields apart where `OBJECTTYPE` aliases
them, and reads the bomb fields through those aliases (deviation "Object union", §6); one decoder reads the record of
map items, detailed placements and native saves.

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
not yet seen, visible): sight reveals unseen items, a search on the tile reveals hidden ones. An item put on a generic
structure marks it (`STRUCTURE_HASITEMONTOP`) until the tile's last item leaves: a merc standing on the tile turns to
it to reach the items, a blast that wrecks it puts them on the floor, and the client makes it an interactive tile from
the shown items lying on it (`30`). Other sectors' items, clouds and flares live in the campaign's sector diffs
(`campaign/sector-diff.ts`).

**Explosions run on the tick.** Frame `k` of an explosion shows `k·(delay + 5)` ms after ignition and the damage lands
at the damage key frame (deviation "Explosion timing"). Frame counts come from the graphics through the rule pack's
graphic facts; the stub pack has none and ends every animation one frame after its damage frame, so on stubs a blast in
water, which the original's water animation ends before its damage frame, hurts and gasses like one on land. An
explosion holds the attack busy count from ignition to its last frame and keeps sight off meanwhile; each soldier it
hits adds his own hold (`33`).

**Gas marks the soldier.** The gassed state is the soldier's own flag (`Soldier.gassed`): it leaves the sector with him,
is saved with him and is read from a native save. The per-round gas flags and the one-hit-per-blast flag live per
soldier id in `ExplosivesState` (deviation "Gas and blast hit flags"). Clouds and flares age by world seconds, which stand still
in turn-based combat; the sandbox counts its own (deviation "World clock for smoke and light"). Sight reads the gas and
smoke layer of the tiles (`08`). A soldier of the computer teams puts on a gas mask he carries when his team is called
to an alarm or an ambush, when he hears an alarm (civilians too) and, in Tixa only, on a `pre` draw of a RED or BLACK
decision (`wearGasMaskIfAvailable`, `explosions/smoke.ts`).

**Structures report damage.** Before a structure takes a hit, the O3 statue may take it (`26`); after a damaging hit
the brothel listener runs, then `SectorHooks.structureDamaged` (the SAM sites, `18`), both with the wound before the
structure's armour. A structure is swapped for its damaged graphic or removed.

**Wreckage is map changes.** A wrecked structure leaves debris in the object layer, swaps the fences beside it to their
damaged graphic, takes the decals off its wall, replaces the walls beside it with end pieces, removes what hangs on it
and drains the fountain (`wreckSurroundings`). Every such change is a `MapChange` (`map-changes.ts`): structure records
where the change has a structure, tile records for the structure layer and the object layer (`addObject`) otherwise.
A door's removal names the structure it had, open or closed, and its replay takes any door off the tile, as the
original's removal of a door type does (`TileEngine/SaveLoadMap.cc:156`), so a door blown up open stays gone.
The simulation keeps no tile layers: it reads a tile's structure and object layer as the map's tiles with the records
replayed over them (`structLayerAt`, `objectLayerAt`), which is also what the view's `tileChanges` carry to the client
(`29`). A change the original makes outside `ApplyMapChangesToMapTempFile` (the decals) is `liveOnly`: it stays for
the stay and in ja2-node saves but is left out of the sector diff (`sectorTempFileChanges`), so it is undone at the
next entry as in the original; a native save never holds it (deviation "Wall decals after a load"). The end piece's
insertion before a roof tile of the structure layer (`TileEngine/WorldMan.cc:878`) is not ported: no original map has a
roof tile in its structure layer. The stub walls carry end pieces at sub-indices 48 to 55 (`32`).

**Randomness.** Gameplay draws keep the original order on `main` and `pre` (`01` §3.6), the debris variant's
`Random(3)` per piece of debris included. Explosion sounds and smoke graphics are not drawn (deviation "Cosmetic draws
in explosions").

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
| A destroyed wall's decals come back at the next entry: their removal is never written to the temp file | `explosions/wreckage.test.ts` |
| The end piece beside a destroyed wall replaces a decal on the same side of its wall | `explosions/wreckage.test.ts` |
| A drained fountain loses each of its first three water pieces twice, so a doubled piece goes too | `explosions/wreckage.test.ts` |
| Creature gas has no explosion animation: igniting it would raise the busy count for good (spit lays its gas directly) | `explosions/explosion.test.ts` |
| Once one cloud is due to age in real time, every later cloud ages too, by the same count | `explosions/smoke.test.ts` |
| A tile keeps the first cloud's gas: tear gas over smoke leaves it smoky | `explosions/smoke.test.ts` |
| Plain smoke gasses whoever steps into it without a good mask (aim −50, no interrupts), though it does no damage | `explosions/smoke.test.ts` |
| A mask worn below 70 lets a soldier get gassed, yet any mask clears the state at his next turn start | `explosions/smoke.test.ts` |
| A pile under a soldier or a blocking structure is picked up from a side tile only, though the reach animation turns to any neighbour: a merc on its diagonal walks first | `item-actions.test.ts` |
| A search pays only its walk and its click checks no APs: in combat a merc short of the walk sets off and stops where they run out, and one on the tile searches with none left | `item-actions.test.ts` |
| A search turns up hidden items only on a tile where every item is hidden: one beside a buried item stays hidden, and the merc finds nothing | `item-actions.test.ts` |
| Night goggles already worn in the first head slot move to a free second one when the night gear is asked for: the search for the gear to put on looks at the head slots too | `head-gear.test.ts` |
| A pass to a merc without room for all of it still costs both mercs their 3 AP, and what fits stays with him: the APs go before `AutoPlaceObject` | `item-pointer.test.ts` |
| An item dropped on the second tile of a long table rolls to its base, but the mark stays on the tile it was dropped on: its pickup clears the base tile alone | `world-items.test.ts` "keeps the mark on the tile an item was dropped on …" |

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

## 5. Drugs and alcohol

**Where.** `drugs.ts` holds the drug rules and every read of a soldier's `drugs` record: one course for adrenaline and
one for alcohol, each with the original's five INT8 counters (`Tactical/Soldier_Control.h:740`). `applyDrugs` starts a
course; it is the drug application of `applyItem` (`inventory-panel.ts`), tried after the camouflage kit, the canteen
and the elixir as `SMInvClickCamoCallback` tries them (`Tactical/Interface_Panels.cc:1459`). The course steps at each
turn start of the merc (`handleEndTurnDrugAdjustments`, called where `EVENT_BeginMercTurn` calls it, with the
regeneration booster's healing). The effects call it: the drunk stats, leadership and level (`skills.ts`), the turn APs,
the new APs' maximum and the breath between turns (`points.ts`), both morale refreshes (`combat/morale.ts`,
`src/sim/campaign/morale.ts`), stealth (`perception/noise.ts`), the moving frame delay (`animation.ts`), code 491's
drunk idle (`random-anims.ts`) and the drunk fall on the way (`falls.ts`, `07`). The boosters of the day drop every 6
world hours through the hourly slot (`src/sim/campaign/battle-flow.ts`). The profile keeps the lifetime adrenaline count
(`numTimesDrugUseInLifetime`, `prof.dat` byte 691), which the original writes and never reads. A drug for sober Larry
swaps his profiles first, through the narrative port (`swapLarrysProfiles`, the campaign's `NarrativeFlow`; nothing in
the sandbox).

**Design.** The courses belong to the soldier: they leave the sector with him, are saved with him and come from a
native save, and other modules read them only through `drugs.ts`. Taking one costs no AP and needs none, as in the
original; `count: 'all'` applies the cursor's SHIFT stack, so a booster's status is the stack's last and a beer drinks
into the next bottle (`Tactical/Interface_Items.cc:2693`). A course runs only where turn starts run: in the loaded
sector, not on the map screen and not for mercs elsewhere (gaps "Absent mercs between hourly updates").

**What the player sees.** Our soldiers and strategic mercs carry the derived `drunk` level and `adrenaline` state
(`drugView`); the counters, and so the turns left, stay hidden (D16, `29` §7). From them the client draws the face's
adrenaline icon (an effect, not its crash) and drink icon (any level but sober) after the blinded one, on the panels and
the map screen's faces (`drawFace`, `src/ui/screens/tactical/faces.ts`; `mercSoldier`,
`src/ui/screens/map/merc-soldier.ts`; `Tactical/Faces.cc:837`), and turns the AP number light blue for either, below
dark red and above the sneaking yellow (`apColour`, `src/ui/screens/tactical/soldiers.ts`;
`Tactical/Interface_Panels.cc:1167`). The talk face of Father Walker or Micky shows the same drink icon from their own
drink counter, no course (`drunkTalkFace`, `src/sim/narrative/face-variant.ts`; `Tactical/Faces.cc:944`). The merc says
COOL1 after any applied item but the canteen, which plays its drinking sound by his profile's sex, named on
`itemApplied` (`src/audio/director.ts`; `Tactical/Items.cc:3458`). A drunk soldier who trips says CURSE1 and the log
prints `STR_LATE_37` (`fellDown`, `29` §8.1). The knowledge projection rebuilds an alcohol course with the shown drunk
level (`drugCoursesShowing`) and supplies the adrenaline numbers as zero only while the view shows none
(`knowledge/soldiers.ts`): deviation "Drugs in the projection".

Quirks of the original the code keeps, pinned by tests in `src/sim/tactical/`:

| Quirk | Test |
|---|---|
| The heart attack never comes: the side-effect rate it tests was just set to 0, so nine boosters at once lower no stat (`Tactical/Drugs_And_Alcohol.cc:114`, `:141`) | `drugs.test.ts` "never has the heart attack …" |
| A bottle with less left than its drink points still gives a full drink | `drugs.test.ts` "gives a full drink from a bottle with less left …" |
| One adrenaline dose peaks at 16, not 15: its rate of 4 overshoots the 15 to come; a drink rises 2, 4, 6, 8 | `drugs.test.ts` "peaks one adrenaline dose at 16 …", "raises a drink by 2 a turn …" |
| One dose ends with two crash morale events: the side effect over the dose's, plus one | `drugs.test.ts` "ends one dose with two crash morale events …" |
| Morale follows the effect only while it rises: the peak bonus stays through the wear-off until the crash's events refresh it | `drugs.test.ts` "refreshes morale only while the effect rises …" |
| Right after a drink the merc is hungover until his next turn start (effect 0, side effect 10): the drug icon, the light blue AP number and the every-pass idle check; a fresh adrenaline dose shows as its crash | `drugs.test.ts` "is hungover right after a drink …", "shows a fresh adrenaline dose as the crash …" |
| HUNGOVER (4) counts as at least BORDERLINE (2): a hungover merc checks every pass and plays the drunk idle; a woman has none, so drunk or hungover she draws every pass and never idles | `random-anims.test.ts` "plays the drunk idle for a hungover merc too …", "has no drunk idle for a woman …" |
| Leadership rises a fifth only while he feels good, the level that already cuts his other stats to 75 % | `skills.test.ts` "raises leadership by a fifth only …" |
| The crash and hangover clamps to 10 APs come after the phobia's cut: a claustrophobe's 9 APs become 10 | `points.test.ts` "raises a claustrophobe's 9 APs to 10 …" |
| Stacked adrenaline wraps: the effect, the turn APs and the APs held are INT8 | `drugs.test.ts` "wraps a stacked effect past 127 …", `points.test.ts` "wraps stacked adrenaline …" |
| In real time the crash and the hangover only shrink the breath regained, turn-based they cost breath; a gassed soldier who rested skips the drug term | `points.test.ts` "costs breath for the crash and the hangover only turn-based …", "skips the drug term …" |
| Stacked adrenaline with many unused APs overflows the INT16 breath gain into a cost, which the breath factor overflows back into a gain: the breath fills | `points.test.ts` "fills the breath when stacked adrenaline overflows …" |
| A drunk soldier trips in any move: swatting he falls from his crouch, crawling he collapses where he lies; a blinded drunk runner whose blind roll missed rolls again for the drink | `falls.test.ts` "trips a drunk merc in any stance …", "takes the blind fall first …" |

The oracle's drug probes (`tools/oracle/README.md` "Drugs") check every drug and drink taken, with the booster's
`PreRandom` draw and the lifetime count, and the courses over turn starts in real time and turn-based: the order inside
`EVENT_BeginMercTurn`, the crash's morale with attitudes, the AP clamp chain, the INT8 wraps, the breath, the drunk
stats and the boosters of the day. Not checked against the native build: Larry's swap (no save has him on the team), the
asleep merc's morale and the campaign's morale refresh, stealth, the moving frame delay, code 491's drunk idle and the
drunk fall.

## 6. Bombs and mines

**Where.** `bombs/bomb-object.ts` is the only reader and writer of an object's bomb fields (detonator, bomb item, delay
or frequency, owner, action, panic tolerance) and arms a bomb (`armBomb`); `bombs/world-bombs.ts` keeps the world bomb
list; `bombs/mine-flags.ts` the mine flags of the tiles and the blue flags. `world-items.ts` arms the map's hidden
mines at the load, buries pits and switches and lists the armed items as they enter and leave the pools;
`pathfinding.ts` reads the flags (`07`); `narrative/quest-items.ts` runs the action items the queue can run so far
(`25`).

**Design.**
- The bomb fields stay in the union aliases of the object (deviation "Object union"), so map records, native saves,
  sector diffs and snapshots carry them unchanged.
- The world bomb list is the original's slot array: a new bomb takes the first free slot, a removed one leaves its slot
  empty with the item it held. Its order, not the item list's, is the order the original's bomb loops run in.
- The mine flags are per tile, shared by both levels (`TacticalState.mineFlags`): the player flag for our team and the
  militia, the enemy flag for everybody else. They belong to the loaded sector: snapshots keep them, the sector's temp
  state does not. A load marks for the player the tiles where the replayed map changes leave a blue flag
  (`setBlueFlagFlags` at the end of `initLoadedWorld`, a native import included); the map load marks the hidden mines
  it arms for the enemy, and every pit added to a pool its tile.
- The view's `knownMines` lists the tiles with the player flag, which the original's path cursor reveals anyway; the
  enemy flag, trap levels, timers and owners never reach the view (D16, `29` §7). The knowledge projection rebuilds the
  player flags from it, so a hint paths around a mine as the order does.

Quirks of the original the code keeps, pinned by tests in `src/sim/`:

| Quirk | Test |
|---|---|
| A sector entry forgets every mine flag but the blue flags: enemies walk into their own map mines | `campaign/sector-flow.test.ts` "forgets at a sector entry every mine flag but the blue flags …" |
| A mine the map stores armed gets no enemy flag: only a hidden pressure explosive with a trap level is armed and marked at the load, and the one map mine, F9's, is stored armed | `tactical/world-items.test.ts` "marks no tile for the enemy where the map stored a mine armed already …", `tactical/bombs/map-bombs-original.test.ts` |
| A blue flag blocks its tile for everybody: its structure is a generic one without cells, which the movement costs read as an obstacle | `tactical/bombs/mine-flags.test.ts` "blocks the flagged tile for everybody …" |
| Taking a blue flag off at the roof level clears the mark alone: the flag, always put on the ground, stays and marks the tile again at the next load | `tactical/bombs/mine-flags.test.ts` "takes the flag off the ground, but on the roof level …" |

Not checked against the native build: no oracle probe covers the bomb list, the flags or paths around mines yet. From
scans of the 261 original maps: no map holds a hidden pressure explosive with a trap level, a pit or a blue flag; every
loose switch's stored detonator already matches the one the load gives it, a switch over a switch structure and a
pressure plate elsewhere (`tactical/bombs/map-bombs-original.test.ts`); the 14 soldiers placed on roofs all stand on
flat roofs, so the roof type test moves none of them.

Not ported: gaps "Map items", "Duds and timed bombs", "Unbuilt item actions", "Booby-trapped items", "Auto-bandage",
"Walking side effects" (water damage to items). Other deviations of this domain: "Object union", "Item cursor", "Key
ring cursor", "Attachment AP", "Picking up items", "Structural damage of grenades", "Explosion timing", "Tile-animation
pass", "Water ripple", "Vaporized corpses", "Gas and blast hit flags", "World clock for smoke and light", "Cosmetic
draws in explosions", "Wall decals after a load", "Drugs in the projection".
