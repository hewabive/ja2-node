# 12 — Items, inventory and explosions

Items from their definitions to the world: the item table, the item object, soldier inventories and their commands,
reloading, first aid, world items, what profiles and the equipment generator give soldiers, explosions, smoke, gas and
flares, drugs and alcohol (§5), bombs and mines (§6), tools on tiles and the x-ray detector (§7), auto-bandage's medics
and patients (§8). Siblings: `11` firing (jams, wear, ammo use, the hand item breaking); `33` what a hit
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
| `ai/medical.ts` | Auto-bandage's medics and patients, its full check and the AI's medical decision (§8) |
| `drugs.ts` | Adrenaline and alcohol courses, their effects, the regeneration boosters (§5) |
| `swimming.ts` | Water damage on a medium or deep tile: soaked items, washed-off camouflage, rinsed creature smell (`07` §2) |
| `world-items.ts`, `item-actions.ts`, `give.ts`, `toss.ts`, `item-pointer.ts` | World items: map load, pools, visibility; picking up, dropping (beside the merc too), giving, tossing, passing |
| `bombs/bomb-object.ts`, `bombs/world-bombs.ts`, `bombs/mine-flags.ts`, `bombs/bomb-queue.ts`, `bombs/item-action.ts`, `bombs/mine-detection.ts` | The bomb fields of an object and arming; the world bomb list; the mine flags of the tiles and the blue flags; the bomb queue, its set-off functions and the timers; the action items; the suspicious ground (§6) |
| `booby-traps.ts`, `prompts.ts` | A pickup's booby trap and its disarm box; the tactical prompt and the globals its answers read (§6) |
| `tile-tools.ts`, `xray.ts` | Wire cutters, the jar and the tin can on a tile, the toolkit and the gas can on a vehicle (`25`); the x-ray detector and the radar contacts it gives (§7) |
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
is saved with him and is read from a native save. Every turn start of our whole team tests it against the loaded map at
the merc's gridno (`clearGassedAtTurnStart`), and a merc off the loaded map stands nowhere there: his removal from the
sector, or the load of another, set `NOWHERE` (`removeSoldierFromTacticalSector`, `Strategic/StrategicMap.cc:563`), so
he loses the flag at his next turn start: the native build reads past the end of the world array there, with a sector
loaded or none, and finds no smoke (`tools/oracle/README.md` "Absent mercs"). The per-round gas flags and the
one-hit-per-blast flag live per soldier id in `ExplosivesState` (deviation "Gas and blast hit flags"). Clouds and flares
age by world seconds, which stand still in turn-based combat; the sandbox counts its own (deviation "World clock for
smoke and light"). Sight reads the gas and smoke layer of the tiles (`08`). A soldier of the computer teams puts on a
gas mask he carries when his team is called to an alarm or an ambush, when he hears an alarm (civilians too) and, in
Tixa only, on a `pre` draw of a RED or BLACK decision (`wearGasMaskIfAvailable`, `explosions/smoke.ts`).

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
| A merc of ours off the loaded map has his gassed state tested against the loaded map where he stands, nowhere, so a cloud at the tile he left, or at that tile of a newly loaded map, never keeps him gassed | `turns/whole-team.test.ts` "loses the gassed flag at his next turn start …", `src/sim/campaign/absent-mercs.test.ts` "reads the newly loaded map where he stands …" |
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
into the next bottle (`Tactical/Interface_Items.cc:2693`). A course runs where turn starts run: for our whole team,
mercs off the loaded map included, with the crash's morale, and for the loaded sector's other soldiers, on the tactical
screen and on the compressed map screen, where a turn comes at every poll, so a course lasts fewer world minutes the
slower the compression (`15` §2).

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
stats and the boosters of the day; the absent probes a crash and the regeneration booster of a merc off the loaded
map. Not checked against the native build: Larry's swap (no save has him on the team), the asleep merc's morale and the
campaign's morale refresh, stealth, the moving frame delay, code 491's drunk idle and the drunk fall.

## 6. Bombs and mines

**Where.** `bombs/bomb-object.ts` is the only reader and writer of an object's bomb fields (detonator, bomb item, delay
or frequency, owner, action, panic tolerance) and arms a bomb (`armBomb`); `bombs/world-bombs.ts` keeps the world bomb
list; `bombs/mine-flags.ts` the mine flags of the tiles and the blue flags. `world-items.ts` arms the map's hidden
mines at the load, buries pits and switches and lists the armed items as they enter and leave the pools;
`pathfinding.ts` reads the flags (`07`). `bombs/bomb-queue.ts` is the original's explosion queue with what feeds it: a
step on a tile (`setOffBombsInGridNo`, from `handleAtNewGridNo` and the fence landing, `07`), a frequency
(`setOffBombsByFrequency`, from a pressure switch underfoot and from a switch worked by hand,
`activateSwitchInGridNo`), a panic trigger (`setOffPanicBombs`, from the AI's trigger pull and remote bomb trigger,
`13`), and the timers (`decayBombTimers`, at each real-time turn and at the end of each round,
`10`); `bombs/item-action.ts` runs the action items, the quest ones through `narrative/quest-items.ts` (`25`). The
queue runs in the overhead pass after the tile animations. `bombs/mine-detection.ts` is the suspicious ground: every
soldier checks the tile ahead before a step and the tiles around after an arrival (`movement.ts`, `07`), and what our
merc, the AI or a metal detector do about a mine noticed there. `booby-traps.ts` checks an item's booby trap in the
pickup (`item-actions.ts`), which also asks before working a switch and, on a tile our side knows to hold a mine, to
disarm the bomb under it; `prompts.ts` holds the tactical prompt and the globals the original's boxes read.
`bombs/planting.ts` is `HandleItem`'s remote and bomb branches (`combat/attack.ts`): the walk onto the tile, the plant at
the frame of `PLANT_BOMB` (code 483), the timer or frequency box of a detonator and its answer, and the remote bomb
trigger's frequency box at the frame of `USE_REMOTE` (code 484); the bomb cursor's walk and APs are its
`apsToDropBomb` and `bombTileRefusal`, which the `plantBomb` command, `estimateAttack` and `previewAction` share.

**Design.**
- The bomb fields stay in the union aliases of the object (deviation "Object union"), so map records, native saves,
  sector diffs and snapshots carry them unchanged.
- The world bomb list is the original's slot array: a new bomb takes the first free slot, a removed one leaves its slot
  empty with the item it held. Its order, not the item list's, is the order the original's bomb loops run in.
- The mine flags are per tile, shared by both levels (`TacticalState.mineFlags`): the player flag for our team and the
  militia, the enemy flag for everybody else. They belong to the loaded sector: snapshots keep them, the sector's temp
  state does not. Every load starts from the flags the map file stores with each tile (`mineFlagsOfMap`, the high
  nibble of a tile's layer count byte, `TileEngine/WorldDef.cc:2102`) and marks for the player the tiles where the
  replayed map changes leave a blue flag (`setBlueFlagFlags` at the end of `initLoadedWorld`, a native import
  included); the map's items mark the hidden mines the load arms for the enemy, and every pit added to a pool its
  tile.
- The view's `knownMines` lists the tiles with the player flag, which the original's path cursor reveals anyway; the
  enemy flag, trap levels, timers and owners never reach the view (D16, `29` §7). The knowledge projection rebuilds the
  player flags from it, so a hint paths around a mine as the order does.
- The bomb queue (`TacticalState.explosionQueue`) holds bomb slot indices with their due times on the tactical clock
  (`clockMs`), at most 40, as the original's array: a set-off spaces the explosive bombs it queues
  `1000 + Random(500)` ms apart in slot order and queues action items with no gap and no draw. The count shrinks only
  over entries at its end that went off. While the queue is active sight is off, the AI waits and the player interface
  is locked (`interface-lock.ts`); at its end all teams look and our mercs reveal roofs and items if a blast or a door
  may have changed sight, and the soldier who set it off, unless one of ours, is freed from any pending action.
- A dud that passes its second roll lies as a timed bomb (`34`); leaving the sector deletes every active timed bomb
  with its item before the sector's state is kept, and while one is on the map time compression is refused
  (`activeTimedBomb`).
- The original's yes/no and numbered boxes of `Tactical/Handle_Items.cc` are prompts of the loaded sector
  (`TacticalState.prompt`, decision prompts of `01` §3.8), so the sandbox has them too; the view shows them in
  `prompt` beside the campaign's (`29` §8.1). As `DoMessageBox`, a prompt asked for while one is open is not shown. The
  callbacks read the original's globals (`TacticalState.boobyTrap`: the soldier, item, tile, level and difficulty of the
  last trap, whether it was just found), set by the pickup and read at the answer; a spotted trap's box waits for the
  merc's stop-time quote (`24` §2). A spotted mine sets only the soldier and the tile, so its blue flag goes on the
  level the last booby trap left; its box opens as the quote ends, without the original's locator lock (deviation
  "Mine locator"). The bomb boxes keep their soldier and tile in the prompt itself (`gpTempSoldier`, `gsTempGridno`),
  and their answer reads his hand item as the original's callback does.
- The walk onto a tile to plant is a pending action of its own (`Soldier.pendingDropBomb`, `MERC_DROPBOMB`), with the
  tile in `pendingActionData2` as the original's `sPendingActionData2`, which the plant's frame reads.

Quirks of the original the code keeps, pinned by tests in `src/sim/`:

| Quirk | Test |
|---|---|
| A sector entry forgets every mine flag but the blue flags and the ones the map file stores: enemies walk into the mines they found | `campaign/sector-flow.test.ts` "forgets at a sector entry every mine flag but the blue flags …", `tactical/bombs/mine-flags.test.ts` "takes at the load the mine flags the map stores …" |
| A mine the map stores armed gets its enemy flag from the map's tile flags, not from its record: F9's one map mine is stored armed and its tile flagged, and E13_B1, H8_B1 and H9_B1 store enemy flags on tiles without one | `tactical/world-items.test.ts` "marks no tile for the enemy where the map stored a mine armed already …", `tactical/bombs/map-bombs-original.test.ts` |
| A blue flag blocks its tile for everybody: its structure is a generic one without cells, which the movement costs read as an obstacle | `tactical/bombs/mine-flags.test.ts` "blocks the flagged tile for everybody …" |
| Taking a blue flag off at the roof level clears the mark alone: the flag, always put on the ground, stays and marks the tile again at the next load | `tactical/bombs/mine-flags.test.ts` "takes the flag off the ground, but on the roof level …" |
| A trip klaxon stays armed: every step on it calls the enemies again | `tactical/bombs/bomb-queue.test.ts` "keeps a trip klaxon armed …" |
| A timer set to 0 counts down through 255 turns before it goes off: the delay is a signed byte | `tactical/bombs/bomb-queue.test.ts` "runs a timer of 0 through 255 turns …" |
| Map minefields (pressure action items that blow up) go off for our team alone; enemies and militia set off only explosives that are pressure-triggered themselves, and our team and the militia never a bomb a soldier planted | `tactical/bombs/bomb-queue.test.ts` "lets enemies and militia walk over a map minefield …", "lets our team and the militia walk over a mine a soldier planted …" |
| Explosions during the queue keep sight off until the queue ends: an explosion turns sight back on only with the queue idle | `tactical/bombs/bomb-queue.test.ts` "keeps sight off from one blast to the next …" |
| A bomb taken off the map after it was queued still goes off: an entry keeps its slot, the slot its last item | `tactical/bombs/bomb-queue.test.ts` "still sets off a bomb taken off the map …" |
| The queue's end frees the soldier who set it off from any pending action, a pulled panic trigger too, with no animation test | `tactical/bombs/bomb-queue.test.ts` "frees the soldier who set it off …" |
| A booby trap on a roof explodes at ground level | `tactical/booby-traps.test.ts` "explodes at ground level even when it lies on a roof …" |
| A merc whose pickup set off a trap he missed still says GOTIT; one who spotted it does not | `tactical/booby-traps.test.ts` "goes off as a mini grenade …", "is spotted by a merc …" |
| Only our team minds booby traps: another soldier picks a trapped item up with its trap | `tactical/booby-traps.test.ts` "leaves enemies untouched …" |
| A pickup a trap stopped still costs its APs | `tactical/booby-traps.test.ts` "charges the pickup APs in combat …" |
| The gain for finding a trap comes at the disarm box's answer, a no too, and a known trap asks with none | `tactical/booby-traps.test.ts` "gives the finding gain on a no too …", "asks at once …" |
| Disarming a bomb one of our mercs planted gives no gain and no COOL1 | `tactical/booby-traps.test.ts` "gives no explosives gain and no COOL1 …" |
| A known trap picked up in one go after a switch loses its box: the switch's box is up | `tactical/booby-traps.test.ts` "drops the disarm box of a known trap …" |
| Every step of a bleeding or shocked soldier draws `PreRandom(3)` twice, for the tile ahead and the tiles around, mines or not, unless he carries a metal detector | `tactical/bombs/mine-detection.test.ts` "draws PreRandom(3) at both checks …" |
| A metal detector finds no mine above trap level 10, and an enemy who carries one marks the mines he finds for the player with blue flags and walks on | `tactical/bombs/mine-detection.test.ts` "flags a mine of trap 10 or less with a metal detector …" |
| The blue flag of a spotted mine goes on the level the last booby trap left, and its locator looks there | `tactical/bombs/mine-detection.test.ts` "asks at once in the sandbox; yes puts a blue flag …", "sends the mine locator …" |
| A spotted mine left without its blue flag is known but unmarked: nobody warns of it again, paths do not avoid it and a search there walks onto it | `tactical/bombs/mine-detection.test.ts` "leaves the mine known but unmarked on a no …" |
| A failed disarm of a buried bomb sets off every bomb of its tile, remote ones too, but never a mine one of our mercs planted | `tactical/booby-traps.test.ts` "sets off every bomb of the tile after a failed check …", "sets off nothing when the failed disarm …" |
| Planting crouched or prone costs no AP: only the standing plant's animation charges `AP_DROP_BOMB` | `tactical/bombs/planting.test.ts` "plants at once and for no AP when crouched or prone …" |
| A planting check missed by 20 or less shifts the setting by one: a timer of 1 may come out as 0, a frequency of 4 as 5, which no trigger button reaches | `tactical/bombs/planting.test.ts` "messes up the setting by Random(3) - 1 …" |
| A planting check missed by more than 20 sets the bomb off at the merc's feet, and the bomb stays in his hand | `tactical/bombs/planting.test.ts` "blows up at his feet …" |
| A timed or remote bomb our merc planted is a booby trap of his trap level to our own mercs | `tactical/bombs/planting.test.ts` "leaves a booby trap of his own trap level …" |
| A merc whose attacking hand is still his second hand gets the setting box at once, and the bomb lands on the clicked tile without a walk (the detonator box at the end of `HandleItem`) | `tactical/bombs/planting.test.ts` "asks for the setting at once and puts the bomb on the clicked tile …" |
| The hand item roll comes before the remote's APs: a broken remote bomb trigger costs nothing | `tactical/bombs/planting.test.ts` "refuses a broken trigger before its APs …" |

The oracle's bomb probes (`tools/oracle/README.md` "Bombs") check the map loads (bomb lists, mine flags, panic
triggers), the set-offs by step, frequency and timer with the queue's times and draws, the action items on doors and
alarms, the suspicious ground with its draws, the metal detector and the AI's branch, paths around flagged tiles, booby
traps and buried disarms with their boxes and gains, planting with the box and its fumbles, the remote bomb trigger and
the x-ray detector; the action item probes of "Give" check the queue with the quest action items. Not checked against
the native build: the planting and remote animations, the step chain of a walk, militia, pits and the stop-time freeze.
With the original data `tactical/bombs/item-actions-original.test.ts` works the museum switch of L12, the Orta basement
cell switch and the brothel's untrap switch, and `tactical/bombs/planting-original.test.ts` the real `PLANT_BOMB` and
`USE_REMOTE` scripts. Not pinned: an entry whose slot a new bomb took after it was queued sets off the new bomb.
From scans of the 261 original maps: no map holds a hidden pressure explosive with a trap level, a pit or a blue flag;
six store mine flags with their tiles, all for the enemy (F9's mine tile, nine tiles of E13_B1 and five of its alternate,
eight of H8_B1, H9_B1 and its alternate);
every loose switch's stored detonator already matches the one the load gives it, a switch over a switch structure and a
pressure plate elsewhere (`tactical/bombs/map-bombs-original.test.ts`); the 14 soldiers placed on roofs all stand on
flat roofs, so the roof type test moves none of them; the pressure-triggered switches and quest action items lie at
trap level 20, beyond any trap detect level and metal detector, as do P3's minefield, while the minefields of I8, N3,
N5, O3 and P3_B1 lie at 3 to 10 and F9's mine at 5, so only those are ever found.

## 7. Tools on tiles and the x-ray detector

**Where.** `tile-tools.ts` is `HandleItem`'s wire cutters, jar and tin can branches (`combat/attack.ts`), each with its
walk beside the tile and AP check, the begin functions the arrival calls, the fence cut at code 481 and the blood at code
760, and its toolkit and gas can branches on a vehicle with the fuel at code 769 (`25`); the commands `cutFence`,
`fillJar`, `attachCan`, `repair` and `refuel` (`tactical-sim.ts`) add the checks of the original's click
(`UIMouseOnValidAttackLocation`), and `previewAction` the cursors' walk, APs and good or bad state
(`src/sim/hints/preview-action.ts`, the client's `src/ui/screens/tactical/input/attack-cursors.ts`). `xray.ts` is the
x-ray detector, reached through the remote branch of `HandleItem` (`bombs/planting.ts`) by `useRemote`, its turn-offs
(`turns/turns.ts`) and the radar contacts of the view.

**Design.**
- The walk up to a tool's tile is a pending action of its own (`Soldier.pendingTileTool`: the tool, the tile and the
  facing of `MERC_CUTFFENCE`, `MERC_TAKEBLOOD`, `MERC_ATTACH_CAN`, `MERC_REPAIR`, `MERC_FUEL_VEHICLE`), and the tile also
  goes to `pendingActionData2`, as `setPendingAction` sets `sPendingActionData2`, where code 769 finds the vehicle; the
  jar keeps the corpse's slot in `pendingActionData4` until its frame, as the original's `uiPendingActionData4`.
- The cut is the fence structure swapped for its partner and recorded as a map change, so the sector keeps it and the
  view shows it as a `swap` in `tileChanges`; the hints do not see it yet (gap "Structure changes in the hints").
- A tin can is the door status's `hasTinCan` (`DOOR_HAS_TIN_CAN`), which the sector's door statuses and a native import
  keep, and which triples the door's opening noise (`perception/noise.ts`). Tying it sets the door status's real and
  perceived state to the structure's, as `ModifyDoorStatus` does.
- The cursors' walk and the order's walk come from different searches, as in the original: `DrawUIMovementPath` looks
  for the tile beside with the door rules of `FindAdjacentGridEx`, `HandleItem` (but for the can) without them.
- The x-ray marks are `Soldier.xrayedBy` (the original's `SOLDIER_MISC_XRAYED` with `xrayed_by`) and the start
  `Soldier.xrayActivatedTime`, both on the world clock's seconds. The view's `radarContacts` lists the marked soldiers
  the squad does not see with the colour the radar gives each, and nothing else about them (D16, `29` §7).
- The jar's code 760, the cut's code 481 and the gas can's code 769 are simulation opcodes; 760 and 769 sit in the sound
  range of the scripts, so they join the opcodes the logic timeline keeps there (`src/content/anim/timelines.ts`).

Quirks of the original the code keeps, pinned by tests in `src/sim/tactical/`:

| Quirk | Test |
|---|---|
| A stack of empty jars becomes one jar of blood: the whole jar slot is swapped for one full jar | `tile-tools.test.ts` "costs nothing but the crouch from beside the corpse, and turns a stack of two empty jars into one jar of blood" |
| The jar asks in combat for the walk twice plus `AP_TAKE_BLOOD`, and nothing beside the corpse, yet charges only the walk and the crouch | `tile-tools.test.ts` "asks for the walk twice plus AP_TAKE_BLOOD before a walk, yet charges only the walk and the crouch" |
| The tin can asks for `AP_ATTACH_CAN` and never charges it | `tile-tools.test.ts` "walks beside the door, records the can in its door status as seen …" |
| A merc who already stands where he would tie the can ties nothing: `HandleItem` sends him down the jar's path, which says NOTHING | `tile-tools.test.ts` "ties nothing when he already stands where he would tie it" |
| The x-ray detector takes its 2 AP without batteries too | `xray.test.ts` "uses up batteries at 0 or below and then does nothing, though the APs still go" |

The oracle's bomb probes (`tools/oracle/README.md` "Bombs") check the x-ray detector's batteries and targets. Not
checked against the native build: the wire cutters, the jar and the tin can. With the original data
`tile-tools-original.test.ts` cuts B13's wire fence and fills a jar through the real `CUTTING_FENCE` and
`TAKE_BLOOD_FROM_CORPSE` scripts. Not ported: a corpse that vanishes during the jar's animation (an explosion) gives
human blood here, where the original reads the type its freed slot still holds.

## 8. Auto-bandage

**Where.** `ai/medical.ts` is `Medical.cc`: who counts as a medic and who as a patient, `canAutoBandage` with its full
check of one patient per call, the AI's patient search (`findBestPatient`) and its medical decision
(`decideAutoBandage`). `auto-bandage.ts` is `Auto_Bandage.cc`: the command's checks and question, the start, the frame
and the end, and the question a won battle leaves pending. `numEnemyInSector` (`turns/turns.ts`) is the sector check
that opens the mode. `TacticalSim` routes the commands, the answer and the ticks, `CampaignSim` the campaign's frame and
orders in the mode, and the sector flow's hooks pause and warp the world clock. The view, the box and the key are gaps
"Auto-bandage".

**Lifecycle.**
- `autoBandage` is the `a` key: the original's OK boxes become refusals in its order (`sectorNotCleared`,
  `nobodyToBandage`, `noMedKit`, `cannotAutoBandage`), after the interface lock (`uiLocked`) and an open prompt; otherwise
  it opens the `beginAutoBandage` prompt. `no` changes nothing; `yes` starts the mode.
- The start runs the real-time turn left over from combat first (the original ran it at the combat's exit, deviation
  "Real-time turn after combat"), raises the flag, builds the two lists, calls the sector hook `autoBandageStarted`
  (the campaign's `PauseGame`), clears every merc's kit pocket and medic through `ourWholeTeam`, and sets every speed
  (`autoBandageStarted` event).
- One tick is one frame (below). Completion only marks the record (`autoBandageComplete` event) and makes the sim idle;
  the mode runs on, AI, services and draws included, until `endAutoBandage`, which asks for the end. The end comes at the
  end of the next frame, as the button's `fEndAutoBandage` does.
- The end stands our whole team up, swaps the hands back, ends their actions, gives the warp to the sector hook
  `autoBandageEnded` (the campaign's `UnPauseGame` and `WarpGameTime`) and the failure to the `autoBandageEnded` event
  (the original's `pDoctorWarningString[1]` box), and sets every speed back.
- While the mode runs every order is refused as `autoBandaging` but `endAutoBandage` and `setOption`; `actRefusal` refuses
  the campaign's orders the same way, and `CampaignSim` refuses every other campaign command but `skipLine` and the
  queries.
- A won battle sets the question pending in both arms of `checkForEndOfBattle` (`shouldBeginAutoBandage`): out of combat,
  outside the Deidranna endgame (the sector hook `inDeidrannaEndgame`) and with a medic for a patient. The normal pass
  runs `handleAutoBandagePending` right after the real-time turn, as `MainGameScreenHandle` runs it after
  `HandleStrategicTurn`. It waits while the dialogue is busy, a merc of ours has a pending action or the interface is
  locked, then clears the flag and checks everything again: a refusal becomes the `autoBandageRefused` event (the
  original's OK box), otherwise the same prompt opens, and the rest of the pass runs. While the question is due the sim is
  not idle. Leaving tactical (the map screen, a contract's switch to it), opening a shop and a meanwhile's start drop it
  (deviation "Pending auto-bandage and client screens"); a sector change does not. A soldier arriving to open a door
  drops the action while the question is pending, as in the mode (`doors/door-command.ts`). A native import takes
  `fAutoBandagePending`.

**The frame** (`autoBandageFrame`) is `HandleAutoBandage`: the real-time turn (`HandleStrategicTurn`, which the paused
game stops: `turns.ts` counts the mode as a pause, so the sandbox has none either), the services of our team, the 5 s
count, the overhead pass with `autoBandageOverheadHooks`, then the end if asked. `MainGameScreenHandle` returns before
the rest of its frame (`GameScreen.cc:283-288`), so those hooks are the normal pass's without what lies outside
`ExecuteOverhead`:

| Normal pass | In the mode | Original |
|---|---|---|
| `handlePickedOwnershipCheck` | Left out | `CheckCustomizableTimer`, `GameScreen.cc:340` |
| `stepThrownObjects` | Left out | `SimulateWorld`, `GameScreen.cc:343` |
| `updateBullets` | Left out | `UpdateBullets`, `GameScreen.cc:424` |
| `stepExplosions`, `updateMissAnimations` | Kept | `UpdateAniTiles`, `Overhead.cc:487` |
| `handleExplosionQueue`, `handleCreatureTenseQuote`, `checkHostileOrSayQuoteList`, `endTimedAiPause` | Kept | `Overhead.cc:490-500` |
| `updateSkullReleases` | Kept | `HandlePanelFaceAnimations`, in the slot loop |
| `handleRealtimeTurns` | First in the frame | `Auto_Bandage.cc:225` |
| `handleEnemySightingPause` | Left out | `GameScreen.cc:311-327` |
| `beginAiPass`, the slots' AI, `awayAiForPass` | Kept, then the completion check | `Overhead.cc:503-1077` |
| `dequeueAllGameEvents`, `checkMercsWaiting` | Kept | `Auto_Bandage.cc:238`, `Overhead.cc:1080` |

**In a campaign** the step of the mode is the tactical frame, the sector flow's after-step (the end of a wait for mercs)
and `updateClock`, which the pause stops. It leaves out what `MainGameScreenHandle` runs after its early return: the
interface lock's pause (`HandleTacticalUI`; `syncInterfaceLockPause` returns at once in the mode, so a lock that begins
and ends inside it cannot lift the mode's pause), the environment controller, the NPC trigger timer, the dialogue step
with the shop it may open, and the timers of `CheckCustomizableTimer` and `CheckForMeanwhileOKStart` (Carmen, the
endgame, the meanwhile start). So the dialogue queue stands for the whole mode and the lines queued meanwhile play after
it; `isIdle` reads only the mode's completion, not the frozen talk. The start's hook pauses the world clock; the end's
hook unpauses it and warps it by the count with `Warp.NO_PROCESSING` (`campaign/sector-flow.ts`, `15`).

**What the flag changes.**
- The AI (`ai/control.ts`): `handleSoldierAI` lets our mercs through, and their real-time decision is
  `decideAutoBandage` (`rtPlayerDecideAction`); a NONE becomes the soldier's 10–11 s wait, as for anyone. `aiForSlot`
  visits every slot at every pass, each soldier still on his own 100 ms timer, and the cursor moves on after each.
- `GIVE_AID` runs `HandleItem` with the kit in hand on the ground level, as `AIMain.cc:1732` does; `handleItem`'s medkit
  branch is `beginFirstAid` (`handleMedKit`, `first-aid.ts`), which walks him up or starts the dressing. A refusal
  cancels the action. `GET_CLOSER` and `MOVE_TO_CLIMB` walk through `executeMovement`, whose `newDest` takes the gait
  from the movement table at the medic's alert status, so the RUNNING of the decision does not stick.
- The services (`first-aid.ts`): a service that ends clears the patient's medic and ends the medic's action instead of
  `END_AID`; a medic out of bandages does not curse (`outOfBandages` carries CURSE1 only outside the mode).
- Animation (`animation.ts`): every soldier in the sector animates at the loop rate but a monster getting up
  (`setSoldierAniSpeed`); `resetAllMercSpeeds` applies it to everyone at once.
- A roof climb's commit frees our merc like the AI (`roofs.ts`); a merc of ours who opens a door on his way walks on
  after it (`movement.ts`); a dead patient's medic is cancelled (`updateSkullReleases`, `combat/death.ts`); looking
  reveals no items and sees no corpses (`OUR_MERCS_AUTO_MOVE`, `perception/fov.ts`); nobody bleeds at the turn start
  (`beginMercTurn`, `turns/turns.ts`).
- Already following the flag before: no new situation for anybody (`09`), AI paths and our mercs' paths through people,
  the forced swap at the third wait (`07`), the interface level after a climb, the bleeding warning, the door on arrival
  and the dialogue drop.

**Design.**
- The mode flag is `pathEnv.autoBandage` (`fAutoBandageMode`, with `OUR_MERCS_AUTO_MOVE`, which rises and falls with
  it), read by the path search and the other systems the mode changes; `setAutoBandageMode` (`state.ts`) is its only
  writer. The rest of the mode is `TacticalState.autoBandage`: the pending flag, completion, the failure flag, the
  seconds to warp, the end request, the full check's pointer (`soldier_for_full_check`) and the panel lists.
- All but the pending flag are file or function statics in the original, which outlive the mode, a sector load and a
  save load (`Tactical/Auto_Bandage.cc:47-63`, `TacticalAI/Medical.cc:97`). The campaign keeps one record in its sector
  flow and hands it to every loaded sector, as it does the real-time clock, so the pointer crosses a sector load; the
  record is saved (deviation "Auto-bandage statics").
- A patient's medic (`Soldier.autoBandagingMedic`) and the pocket a medic's kit came from (`Soldier.slotItemTakenFrom`)
  are soldier fields, an id and a slot like `servicePartner`.
- The patient search raises `PathEnv.globalFlags` (`gubGlobalPathFlags`) for its whole loop, so every path it plots goes
  through people: the walk-up searches of `findAdjacentGridEx`, the run costs and the climb estimates. The flag never
  outlives the call and is not saved.

Quirks of the original the code keeps, pinned by tests in `src/sim/tactical/ai/medical.test.ts` or the file named (under
`src/sim/tactical/`):

| Quirk | Test |
|---|---|
| A tie in priority and path goes to the later patient in team order; priority (3 below OKLIFE, 2 below twice OKLIFE, else 1) beats any path | "gives a tie in priority and path to the later patient …", "takes the cheaper path at equal priority …" |
| A reachable patient on the medic's level beats any patient behind a climb, whatever the priorities | "prefers any reachable patient on his level …" |
| A medic takes over another's patient only when strictly closer, and cancels the other's action; a medic who finds no tile beside the patient loses him to anyone, as `FindAdjacentGridEx` returns only a tile it can path to | "lets a medic take over …", "leaves the patient to his medic …", "takes the patient from a medic who finds no tile …" |
| A bleeding medic dresses himself first and keeps his gait; a medic who goes to a patient is set RUNNING | "dresses a bleeding medic first …", "runs to his patient …" |
| A merc aboard a vehicle counts as neither medic nor patient, yet the search keeps him as a candidate: no tile beside the vehicle is free, so he is dropped silently, and a medic on a roof climbs down for him | "keeps a merc aboard a vehicle as a candidate …" |
| The full check visits one patient per call, the first call only arming it; a failure keeps the pointer on the patient, so the next mode fails at its first call | "checks one patient per call …", "fails on a patient no medic can reach …" |
| `FindAutobandageClimbPoint` reads the climb spots at swapped levels, the ground-side spot on the roof and the roof-side spot on the ground floor (`TacticalAI/Medical.cc:43-46` against `TileEngine/Buildings.cc:264-265`), and passes a roof patient on any such spot, reachable or not; a medic on a roof passes every ground patient | "reads the climb spots at swapped levels …", "passes a roof patient on any climb spot …", "passes a patient who is a medic himself …" |
| `NumEnemyInSector` counts unconscious and unseen hostiles | `turns/end-of-battle.test.ts` "counts every living, non-neutral, non-friendly soldier …" |
| A medic done with a patient stays in `GIVING_AID` until his next action changes the animation | `auto-bandage-ai.test.ts` "keeps a medic done with a patient in GIVING_AID …" |
| `bSlotItemTakenFrom` is overwritten by every swap: a first kit used up with a patient's last dressing is not replaced, the second kit swapped in later records its own pocket, so the end leaves the hand empty, the second kit back in its pocket and the gun in the first kit's | `auto-bandage-ai.test.ts` "swaps a second kit in after the first ran out …" |
| The medic's gait comes from the movement table: at GREEN he walks, at RED he runs, and his first decision raises him to RED once his team knows of opposition | `auto-bandage-ai.test.ts` "walks at GREEN …", "runs at RED", "raises a medic at GREEN to RED …" |
| Every soldier of every team animates one frame per pass and has his AI visited at every pass, each on his own 100 ms timer; a turning merc of ours keeps the fast-turn delay | `auto-bandage-ai.test.ts` "handles the AI of every soldier …", "animates every soldier of every team …" |
| A merc of ours with nothing to do draws `REALTIME_AI_DELAY`'s `Random(1000)` on the main stream at each decision, and the wait leaves his action in progress | `auto-bandage-ai.test.ts` "makes a merc of ours with nothing to do wait …" |
| A patient's death cancels his medic only while a merc of ours stands conscious in the sector, the medic himself included | `auto-bandage-ai.test.ts` "cancels a dead patient's medic only while …" |
| Our mercs reveal no items and see no corpses as they look | `auto-bandage-ai.test.ts` "reveals no items to our mercs looking around …" |
| Nobody bleeds at the turn start | `combat/bleeding.test.ts` "bleeds nobody at the turn start while auto-bandage runs …" |
| A merc of ours swapped at his third wait stands with no final destination | `movement.test.ts` (`07`) |
| The command's refusals come in `BeginAutoBandage`'s order, and its kit check counts any merc of ours with a kit, a dying one or one with no medical skill | `auto-bandage.test.ts` "refuses in the original’s order …" |
| The lists are in team order, a bleeding medic on both; when either is empty both are | `auto-bandage.test.ts` "lists the medics and the patients …", "empties both lists …" |
| The start clears the failure, and the kit pocket and medic of every merc of ours wherever he is, but not the full check's pointer | `auto-bandage.test.ts` "clears the failure and every merc’s kit pocket …" |
| The world clock jumps 5 s for every frame, the frame of the end included, up to 125 s however long the mode ran | `auto-bandage.test.ts` "counts 5 s a frame up to 125 …", "warps 5 s for every frame of an early end …" |
| The services run at every frame: a patient is dressed once a frame instead of once a real-time turn | `auto-bandage.test.ts` "dresses the patient at every frame of the aid" |
| Running out of kits completes the mode silently, the patient still bleeding; only a failed full check reports at the end | `auto-bandage.test.ts` "completes silently when the kits run out …", "completes with the failure …" |
| Completion only marks the mode: it runs on, its AI deciding and drawing, until the end | `auto-bandage.test.ts` "completes once everybody is bandaged …", "runs on after completion …" |
| No real-time turn runs in the mode, so the first one after it comes at once | `auto-bandage.test.ts` "stops the real-time turn while the mode runs …" |
| The end comes at the end of the frame after the request, which runs in full | `auto-bandage.test.ts` "ends at the end of the next frame …" |
| The end stands up every merc of ours, off the map too, where he stays mid-transition, and stops a walking medic on his tile; it cancels no service, so a medic stood up mid-dressing keeps his patient | `auto-bandage.test.ts` "stands up every merc of ours …", "stops a medic walking …"; `campaign/auto-bandage-flow.test.ts` "stands up a merc of ours in another sector …" |
| A won battle sets the question in both arms, fought or not; it waits for the dialogue (the victory line), a pending action of ours and the locked interface, then checks everything again, so a sector that changed meanwhile gives the refusal and drops the question | `auto-bandage.test.ts` "is set pending by a won battle in both arms …", "waits for the dialogue …", "checks everything again …"; `campaign/auto-bandage-flow.test.ts` "waits for the victory line …" |
| A battle won on the map with blood off leaves the question for the way back to tactical; with blood on the death waits for its animation and sets nothing on the map | `campaign/auto-bandage-flow.test.ts` "with blood off …", "sets nothing with blood on …" |
| The dialogue queue stands for the whole mode: a line queued in it plays after the end | `campaign/auto-bandage-flow.test.ts` "keeps the dialogue standing …" |
| The world clock stands for the mode and jumps by its count at the end; the events inside the jump wait for the next advance | `campaign/auto-bandage-flow.test.ts` "pauses the world clock and jumps it at the end …" |

The oracle's auto-bandage probes (`tools/oracle/README.md` "Auto-bandage") record these decisions and the frames of a
whole mode in the native build; no comparer reads them yet, so the frame loop is checked only by these tests.

Not ported: gaps "Map items" (the pits), "Auto-bandage". Other
deviations of this domain: "Object union", "Item cursor", "Key ring cursor", "Attachment AP", "Picking up items",
"Structural damage of grenades", "Explosion timing", "Tile-animation pass", "Water ripple", "Vaporized corpses", "Gas
and blast hit flags", "World clock for smoke and light", "Cosmetic draws in explosions", "Wall decals after a load",
"Drugs in the projection", "Mine locator", "Blue flag without a bomb", "Auto-bandage statics", "AI first aid without a
path", "Door on the way in auto-bandage", "Pending auto-bandage and client screens".
