# 12 — Items, inventory and explosions

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `X:` = `src/externalized/`, `V:` = vanilla
`Build/`, `J:` = `data/externalized/` (verbatim copy of the Stracciatella JSON). "(inferred)" = not traced end to end.
`Random` = the `main` stream, `PreRandom` = the `pre` stream (`01` §3.6). Game options are Stracciatella's defaults:
**reduced gun list** (`fGunNut = FALSE`), sci-fi on (`GameSettings.cc:182-183`), `game.json` as shipped
(`drop_everything: false`, `all_drops_visible: false`, `enemy_weapon_minimal_status: 0`, `extra_attachments: false`).
Item ids are the `ITEMDEFINE` enum (`Tactical/Item_Types.h:221-615`); JSON `internalName`s equal the enum names.

**Scope.** Item content, `OBJECTTYPE`, soldier inventory, reload, item AP costs, first aid, world items, profile and
enemy equipment, drops, explosions, smoke, gas and flares. Elsewhere: gun attacks (`11` §1–§3), melee (`11` §4), hits
and armour against bullets (`33`), throwing (AP cost, range, chance, physics, duds) and launchers (`34` §0);
locks, door traps, action items and switches (`35` §5, `25` §6.5); merchants (`23`); the agent API's inventory commands
(`29` §12); the inventory screens (`30` §2.3–2.4, §4.2).

---

## 1. The item model

### 1.1 Loading (`X:DefaultContentManager.cc:900-980`)

Order (`:907-918`): `ammo-types` → `calibres` → `explosive-calibres` → `smoke-effects` → `explosion-animations` →
`items.json` → `magazines.json` → `weapons.json` → `explosives.json` → `armours.json`, then `loadMaxArmourPerClass`
(`:980`).

- **One container** `m_items` holds all items, keyed by `itemIndex` and `internalName` (both unique,
  `X:containers/Containers.h:129-178`), iterated in **insertion order**; the views `getMagazines()`, `weapons()`,
  `explosives()`, `armours()` filter it in that order (`:921-924`). `DefaultMagazine`, `RandomMagazine`,
  `FindReplacementMagazine`, `FindAmmoToReload` (launchables) and `GetLauncherFromLaunchable` depend on it: keep the
  JSON order.
- Item 0 `NOTHING` (`IC_NONE`) is added first (`:657`). `items.json` entries need index 71..350; `IC_NONE`,
  grenades/bombs and armour there are ignored (`:655-686`). `weapons.json` entries of type `NOWEAPON` are `IC_NONE` and
  dropped (`:531-534`); magazines and calibres named `NOAMMO` are skipped (`:693-700, 718-721`).
- Names and descriptions come from `binarydata/itemdesc.edt` (80+80+240 UTF-16 chars per item, by `itemIndex`) unless
  the JSON gives `name`/`shortName`/`description` (`X:ItemModel.cc:167-193`). That file is original data: only the
  content importer reads it; the stub pack writes its own (`stubs/text.ts`).

### 1.2 Common item fields (`X:ItemModel.h:21-152`, `items.json`)

| Field | Tactical use |
|---|---|
| `usItemClass` | everything: `IC_*` bits (`Item_Types.h:145-177`); `IC_WEAPON` = gun, blade, throwing knife, launcher, tentacles; `IC_EXPLOSV` = grenade, bomb |
| `ubCursor` | `HandleItem` dispatch: `REMOTECURS`, `BOMBCURS`, `TOSSCURS`, `INVALIDCURS` (§5); `ubClassIndex` is unused here (key items use it, §3.5) |
| `ubWeight` | hectograms (×100 g): carried weight (§3.6), throw range (`34` §3) |
| `ubPerPocket` | 0 = big pockets/hands only; stack size in big pockets, halved in small pockets (§3.2); weight multiplier |
| `bReliability` | weapon wear chance `1/(15 + 3·rel)` per shot (`Tactical/Weapons.cc:871-875`); unjam skill modifier ×4 (`:298-299`) |
| `ubCoolness` | enemy gear choice (§8), dealers, Bobby Ray |
| `usPrice`, `bRepairEase` | strategic only |
| `inventoryGraphics`, `tileGraphic` | client only |

Flags (`Item_Types.h:180-211`, JSON `bDamageable` …, `X:ItemModel.cc:321-341`):
`ITEM_DAMAGEABLE` (breaks in hand §5, explosion damage §10.7), `ITEM_REPAIRABLE`, `ITEM_WATER_DAMAGES` (deep water,
`Tactical/Items.cc:3315-3337`), `ITEM_METAL` (metal detector), `ITEM_SINKS` (vanishes when dropped into water,
`Tactical/Handle_Items.cc:1451-1455`), `ITEM_SHOW_STATUS`/`ITEM_HIDDEN_ADDON` (UI), `ITEM_TWO_HANDED` (§3.3),
`ITEM_NOT_BUYABLE`, `ITEM_ATTACHMENT` (auto-attach on hiring, §7), `ITEM_BIGGUNLIST` (reduced-gun replacement),
`ITEM_NOT_EDITOR` (map item skipped at load, §6.2), `ITEM_DEFAULT_UNDROPPABLE` (creature weapons/hides: the object gets
`OBJECT_UNDROPPABLE` at creation, `Tactical/Items.cc:2633-2636`), `ITEM_UNAERODYNAMIC` (toss range 1),
`ITEM_ELECTRONIC`, `ITEM_INSEPARABLE` (attachment cannot be removed, `Tactical/Items.cc:2823-2826`).

`WaterDamage` (`Items.cc:3315-3376`; per tile of medium or deep water, `Soldier_Control.cc:2052-2055`): deep water
only, per `ITEM_WATER_DAMAGES` slot `PreRandom(100) < 10` → `bStatus[0] = max(1, status − 10 + roll)`; camouflage −2
(deep) / −1 unless CAMOUFLAGED; our monster smell −1 on `Random(deep ? 10 : 20) == 0`. Not ported.

### 1.3 Weapons (`X:WeaponModels.cc:153-664`, `weapons.json`, 66 entries)

`internalType` picks the class, cursor and weapon class (`Tactical/Weapons.h:45-56`); the constructors fix the rest
(ja2-node: `WEAPON_KINDS` in `src/content/items/items.ts`):

| `internalType` | Item class | Cursor | `ubWeaponClass` | Notes |
|---|---|---|---|---|
| PISTOL, M_PISTOL | `IC_GUN` | TARGET | HANDGUN | M_PISTOL has burst fields |
| SMG | `IC_GUN` | TARGET | SMG | |
| RIFLE, SN_RIFLE, ASRIFLE | `IC_GUN` | TARGET | RIFLE | |
| SHOTGUN | `IC_GUN` | TARGET | SHOTGUN | FLAMETHROWER is a SHOTGUN with AMMOFLAME |
| LMG | `IC_GUN` | TARGET | MG | |
| BLADE / THROWINGBLADE / PUNCHWEAPON | `IC_BLADE` / `IC_THROWING_KNIFE` / `IC_PUNCH` | KNIFE / TARGET / PUNCH | KNIFE | creature claws and bloodcat attacks are BLADEs |
| LAUNCHER | `IC_LAUNCHER` | TRAJECTORY | RIFLE | `explosiveCalibre` (GLAUNCHER/UNDER_GLAUNCHER → 40MM_GRENADE, MORTAR → MORTAR_SHELL); `ubImpact = 1` |
| LAW | `IC_GUN` | TARGET | RIFLE | `ubMagSize = 1`, no calibre (ROCKET_LAUNCHER) |
| CANNON | `IC_GUN` | TARGET | RIFLE | TANK_CANNON, explosive calibre TANK_SHELL |
| MONSTSPIT | `IC_GUN` | TARGET | MONSTER | `usSmokeEffect` = gas left on a miss |
| PUNCH / THROWN | `IC_PUNCH` / `IC_THROWN` | PUNCH / TOSS | NOGUN | ROCK, ROCK2 are THROWN |

Fields the tactical game reads: `calibre`, `explosiveCalibre`, `ubReadyTime` (AP to raise, `Tactical/Points.cc:1612-1645`),
`ubShotsPer4Turns` (AP per shot, `Points.cc:1006-1049`), `ubShotsPerBurst` (> 0 = burst-capable,
`Tactical/Weapons.cc:3517-3522`), `ubBurstPenalty`, `ubBulletSpeed`, `ubImpact`, `ubDeadliness` (AI and enemy gear),
`ubMagSize`, `usRange` (1/10 tile; barrel extender and silencer modify it, `Weapons.cc:86-103`), `ubAttackVolume`,
`ubHitVolume`, the eight `attachment_*` booleans and `standardReplacement`/`bBigGunList`. `usReloadDelay` is always 200
and unused; `rateOfFire` is Bobby Ray text only. Sounds default to the calibre's.

- `matches(calibre)`: same calibre index. `matches(mag)`: same calibre **and** `capacity == ubMagSize`
  (`X:WeaponModels.cc:666-688`). `EXPLOSIVE_GUN(x)` = ROCKET_LAUNCHER or TANK_CANNON (`Item_Types.h:215`).
- `canBeAttached`: SILENCER, SNIPERSCOPE, LASERSCOPE, BIPOD, DUCKBILL, UNDER_GLAUNCHER, SPRING_AND_BOLT_UPGRADE,
  GUN_BARREL_EXTENDER per flag (`:691-702`).
- Reduced gun list: 18 guns and 6 magazines carry `bBigGunList` + `standardReplacement` (e.g. M1911 → GLOCK_17, MP53 →
  MP5K, AKM → G41, CLIP545_30_AP → CLIP556_30_AP), applied on map load (§6.2), in profiles (§7) and in enemy gear
  (`ReplaceExtendedGuns`, §8).

### 1.4 Calibres, ammo types, magazines (`X:MagazineModel.cc`, `X:CalibreModel.h`, `magazines.json` 45 entries)

- Ammo types (`J:ammo-types.json`, index = `Tactical/Weapons.h:68-83`): 0 REGULAR, 1 HP, 2 AP, 3 SUPER_AP, 4 BUCKSHOT,
  5 FLECHETTE, 6 GRENADE, 7 MONSTER, 8 KNIFE, 9 HE, 10 HEAT, 11 SLEEP_DART, 12 FLAME. Their damage/armour factors are
  hard-coded macros (`Weapons.h:85-105`).
- Calibres: `J:calibres.json` (`index` 1..16, AMMO38 … AMMOFLAME; 0 = NOAMMO), plus `monsterWeapon` and
  `showInHelpText`.
- Magazine = item (`IC_AMMO`) with `calibre`, `capacity`, `ammoType`, `dontUseAsDefaultMagazine` (CLIP12G_7,
  CLIPCAWS_10_SAP). Item ids 71..115; the sizes of one calibre sit at **adjacent ids** (CLIP9_15 = 71, CLIP9_30 = 72),
  which `ReloadGun` relies on (§4.1).
- `DefaultMagazine(gun)`: first magazine in container order with the gun's calibre, `capacity == ubMagSize` and not
  `dontUseAsDefaultMagazine`; throws if none (`Tactical/Items.cc:2437-2460`).
- `FindReplacementMagazine(calibre, size, ammoType)`: exact ammo type, else the first match of calibre and size
  (`:2463-2481`). `FindReplacementMagazineIfNecessary(oldGun, oldAmmo, newGun)` replaces only magazines that fitted the
  old gun (`:2484-2491`).
- `RandomMagazine(gun, pctStandard)`: candidates = magazines that `matches` the gun, in order; one candidate → it;
  else `Random(100) < pct` → index 0, else `1 + Random(n−1)` (`:2494-2542`, main stream).

### 1.5 Armour (`X:ArmourModel.cc`, `armours.json` 38 entries)

- Fields: `armourClass` ∈ HELMET, VEST, LEGGINGS, PLATE, CREATURE (→ `ARMOURCLASS_*` 0..4, `Weapons.h:59-66`),
  `protection`, `explosivesProtection` (defaults to `protection`; only the flak jackets differ: 30/39/48),
  `degradePercentage`, `ignoreForMaxProtection` (the `_Y` items).
- `getMaxArmourPerClass(c)`: max over non-ignored armour of class `c` of `protection`, or `protection + plate` when
  CERAMIC_PLATES can attach (`X:DefaultContentManager.cc:561-597`). Shipped values (inferred from the data): vest
  36 + 15 = 51, helmet 36, leggings 36.
- Plates attach only to the 12 flak/kevlar/kevlar2/spectra vests (`X:ArmourModel.cc:9-22, 145-156`).
- Readers: `EffectiveArmour = prot·status/100 + plate·plateStatus/100` (`Tactical/Weapons.cc:106-120`);
  `ArmourPercent = 65·vest/maxVest + 15·helmet/maxHelmet + 25·legs/maxLegs` (`:123-149`, AI and UI);
  `ExplosiveEffectiveArmour` / `ArmourVersusExplosivesPercent` (same with `explosivesProtection`, each term capped at
  65/15/25, `:152-200`, blasts §10.5). `ArmourProtection`/`TotalArmourProtection` against bullets (PreRandom weak-spot
  roll, plates first, armour destroyed below `USABLE`, `:2588-2741`): `33`.

### 1.6 Explosives (`X:ExplosiveModel.cc`, `explosives.json` 30 entries)

Fields and their use: §10.1.

### 1.7 Attachment, merge and face-item tables (`Tactical/Items.cc:53-217`)

Transcribed into `data/tables/item-tables.json` by `tools/transcribe/item-tables.ts`, parsed by `parseItemRules`
(`src/content/items/rules.ts`); item names are `internalName`s, `NOTHING` is item 0:

| Key | Original | Meaning |
|---|---|---|
| `attachmentInfo` | `AttachmentInfo` (`:66-91`) | attachment, host class, skill check (`NO_CHECK`, `ATTACHING_SPECIAL_ITEM_CHECK`, `ATTACHING_DETONATOR_CHECK`, `ATTACHING_REMOTE_DETONATOR_CHECK`, `ATTACHING_SPECIAL_ELECTRONIC_ITEM_CHECK`) and its modifier |
| `attachments` | `g_attachments` (`:93-104`) | non-model attachment → hosts (detonators on TNT, HMX, C1, C4; the parts of the combo merges) |
| `compatibleFaceItems` | `CompatibleFaceItems` (`:106-116`) | the face pairs that may share HEAD1/HEAD2; nothing else pairs |
| `merges` | `Merge` (`:139-198`) | `item1` + `item2` → `result` with `action` ∈ `COMBINE_POINTS`, `TREAT_ARMOUR`, `DESTRUCTION`, `EXPLOSIVE`, `EASY_MERGE`, `ELECTRONIC_MERGE`; same-id ammo merges as `COMBINE_POINTS` in code (`:786-809`) |
| `comboMerges` | `AttachmentComboMerge` (`:211-217`) | base item with both listed attachments (`NOTHING` = none) → `result` |
| `platesCanBeAttached` | `X:ArmourModel.cc:9-22` | the 12 vests that take CERAMIC_PLATES (§1.5) |

- `ValidAttachment(a, item)` = the item model's `canBeAttached` (weapons §1.3, vest plates §1.5) or `g_attachments`
  (`:628-643`). `ValidItemAttachment` adds: a gun with UNDER_GLAUNCHER accepts 40 mm grenades; no duplicate attachment;
  BIPOD and UNDER_GLAUNCHER exclude each other; DETONATOR and REMDETONATOR exclude each other (`:646-722`).
- `ValidLaunchable(l, w)`: `l` is an explosive with an explosive calibre that weapon `w` matches (`:747-763`).
- `ValidAmmoType(gun, ammo)`: gun calibre = magazine calibre, any size (`:725-732`).

---

## 2. `OBJECTTYPE` (`Tactical/Item_Types.h:55-141`)

36 bytes, little-endian; the same layout is embedded in `WORLDITEM` (map items, §6.1), in detailed placements
(`06` §7.1) and in saves (`14`), so one decoder serves all (`decodeObject`, `src/content/formats/object.ts`).

| Off | Field | Notes |
|---|---|---|
| 0 | `usItem` u16 | 0 = empty slot |
| 2 | `ubNumberOfObjects` u8 | 1..8 (`MAX_OBJECTS_PER_SLOT`) |
| 4–15 | union (12 bytes) | see below |
| 16 | `usAttachItem[4]` u16 | packed to the front by `RenumberAttachments` (`Tactical/Items.cc:2766-2807`) |
| 24 | `bAttachStatus[4]` i8 | |
| 28 | `fFlags` i8 | `OBJECT_UNDROPPABLE 0x01`, `AI_UNUSABLE 0x04`, `ARMED_BOMB 0x08`, `KNOWN_TO_BE_TRAPPED 0x10`, `DISABLED_BOMB 0x20`, `ALARM_TRIGGER 0x40`, `NO_OVERWRITE 0x80` |
| 29 | `ubMission` | unused in tactical play (inferred) |
| 30 | `bTrap` i8 | 1..10 detection level of a trap / armed bomb |
| 31 | `ubImprintID` | ROCKET_RIFLE family; `NO_PROFILE` = virgin, `NO_PROFILE+1` = imprinted by a generic soldier |
| 32–33 | `ubWeight`, `fUsed` | stale/unused; weight is computed (§3.6) |

Union views (offsets from the object start): **gun** `bGunStatus` 4, `ubGunAmmoType` 5 (ammo type index),
`ubGunShotsLeft` 6, `usGunAmmoItem` 8 (magazine item id), `bGunAmmoStatus` 10 (> 0 normal, < 0 **jammed**, launcher
round status); **stack** `bStatus[8]` / `ubShotsLeft[8]` at 4..11 (one value per object; for a magazine stack the
rounds in each magazine); **money** `bMoneyStatus` 4, `uiMoneyAmount` u32 8; **bomb** `bBombStatus` 4,
`bDetonatorType` 5 (1 timed, 2 remote, 3 pressure, 4 switch), `usBombItem` 6, `bDelay`/`bFrequency` 8, `ubBombOwner`
9 (soldier id + 2), `bActionValue` 10, `ubTolerance` 11; **key** `bKeyStatus[6]` 4, `ubKeyID` 10; **ownership**
`ubOwnerProfile` 4, `ubOwnerCivGroup` 5. ja2-node keeps separate fields (deviations.md "Object union").

Rules:
- Status is a percentage 1..100; `USABLE = 10` is the floor for use (`Item_Types.h:36`). `bStatus[0]` doubles as
  `bGunStatus`. `DamageObj` clamps at 1 (`Tactical/Items.cc:956-966`).
- **Creation** `CreateItem(item, status)` (`:2592-2637`): clear; guns via `CreateGun` (`:2545-2581`): status, imprint
  `NO_PROFILE`, loaded with a **full `DefaultMagazine`** (monster weapons: `ubMagSize` rounds, ammo type MONSTER;
  ROCKET_LAUNCHER 1 shot, cannon 0), `bGunAmmoStatus = 100`; magazines full (`:2584-2589`); MONEY: amount = status·50;
  everything else `bStatus[0] = status`. A status outside 1..100 becomes 70. `ITEM_DEFAULT_UNDROPPABLE` → flag.
  `CreateItems(item, status, n)` copies `bStatus[0]` into slots 1..n−1 (`:2640-2662`).
- Stack operations `RemoveObjFrom`, `RemoveObjs`, `GetObjFrom`, `StackObjs`, `PlaceObjectAtObjectIndex` shift the
  status array (`:883-1074`). `CleanUpStack` (ctrl-click, free) pools the points of ammo/kits/medkits into fewer
  objects (`:990-1050`): the cursor's points first, then the stack's own; each object's points move down to the lower
  objects, an emptied object drops off the top of the count.
- **Attach** `AttachObject(s, target, att, indexInStack)` (`:1515-1727`): a launchable replaces a launchable of the
  same class (refused for a stack of grenades); other attachments replace the same item or take the first free slot.
  When a soldier attaches, the `AttachmentInfo` skill checks run (`ATTACHING_*` skills of `SkillCheck.cc:191-299`;
  `SkillCheck` draws `PreRandom(100)`, `Tactical/SkillCheck.cc:342`); failure damages both items by the margin.
  UNDER_GLAUNCHER carries its loaded grenade over. Combo merges fire after (mechanical experience). Otherwise try
  **merges**: non-`COMBINE_POINTS` merges cost `AP_MERGE` 8; `COMBINE_POINTS` moves points into
  `bStatus[indexInStack]` up to 100 (magazines: capacity); explosive and electronic merges need a skill check −30
  (explosives experience); default merges average the statuses (not `TREAT_ARMOUR`). Without a soldier (enemy gear,
  §8.5) no check runs.
- `RemoveAttachment` refuses `ITEM_INSEPARABLE`; removing a UNDER_GLAUNCHER takes its grenade along (`:2810-2856`).

---

## 3. Soldier inventory

### 3.1 Slots (`Tactical/Soldier_Control.h:226-249`)

`0 HELMETPOS, 1 VESTPOS, 2 LEGPOS, 3 HEAD1POS, 4 HEAD2POS, 5 HANDPOS, 6 SECONDHANDPOS, 7..10 BIGPOCK1..4POS,
11..18 SMALLPOCK1..8POS`. Profile/placement inventories use the same 19 indices (`InvSlot` in
`src/sim/tactical/inventory.ts`).

### 3.2 What can go where (`CanItemFitInPosition`, `Tactical/Items.cc:1730-1825`; `ItemSlotLimit`, `:273-289`)

- HELMET/VEST/LEG: armour of the matching class only. HEAD1/HEAD2: `IC_FACE` only, and the pair must be
  `CompatibleFaceItem` (checked in `PlaceObject`, `:1897-1915`).
- SECONDHANDPOS: refused while the main hand holds a two-handed item.
- HANDPOS with a two-handed item while both hands are full: the second-hand item first moves to an empty big pocket
  (if its `ubPerPocket == 0`) or any empty pocket (big first); no room → refused.
- Slot limit: slots 0..6 hold 1; big pockets `ubPerPocket`; small pockets `ubPerPocket/2` when > 1 (1 stays 1, 0 stays
  0). A limit of 0 is refused in small pockets only: big pockets and hands take any single object.
- Money: 20 000 per big pocket/hand slot, 10 000 per small pocket (`MoneySlotLimit`, `:292-302`).

### 3.3 Placing (`PlaceObject`, `:1882-2083`) and auto-placing (`InternalAutoPlaceObject`, `:2086-2301`)

`PlaceObject(s, pos, obj)` returns in `obj` whatever must stay in the cursor:
1. Fit check (§3.2). Keys: record `KeyTable` discovery (`:1849-1859`).
2. Empty slot: move `min(count, max(limit, 1))` objects in; a two-handed item landing in HANDPOS swaps the second-hand
   item out into `obj`.
3. Same item (keys: same key id): money tops up; limit ≤ 1 (or 0 in hands/big pockets) swaps a single object, a stack
   is first auto-placed elsewhere (`DropObjIfThereIsRoom`, `:1828-1846`, excludes the slot itself); otherwise stack up
   to the limit.
4. Different item: ammo onto a gun of its calibre, or a launchable onto its launcher, **reloads** (`ReloadGun`, §4);
   a two-handed item into HANDPOS swaps only if SECONDHANDPOS is empty; otherwise swap if the object fits, else
   `DropObjIfThereIsRoom`.
5. Face items re-run sight (`HandleSight`); `EnsureConsistentWeaponMode` drops a burst or launcher mode the new hand
   item cannot fire (`Tactical/Weapons.cc:3747-3765`).

`AutoPlaceObject(s, obj, newItem)`:
1. One-handed `IC_GUN|BLADE|LAUNCHER|BOMB|GRENADE` → empty HANDPOS, else empty SECONDHANDPOS if the main hand is not
   two-handed. Armour → its empty body slot. Face → HEAD1, then HEAD2 if compatible.
2. `ubPerPocket == 0`: first empty slot in HANDPOS..BIGPOCK4POS (SECONDHANDPOS only if HANDPOS is empty).
3. Otherwise: if stackable (`ubPerPocket > 1`, keys, money) top up slots already holding the item (HANDPOS..SMALLPOCK8);
   then empty small pockets; then empty HANDPOS..BIGPOCK4POS. Returns whether everything was placed.

`FindEmptySlotWithin` skips SECONDHANDPOS behind a two-handed main hand (`:467-486`). `SwapHandItems` (`:3286-3312`)
first moves the main-hand item to a pocket if the second hand holds a two-handed item.

ja2-node: each inventory command is one pick-up plus one `PlaceObject`, checked on copies first; what stays in the
cursor goes back at once (deviations.md "Item cursor").

### 3.4 Hands

- HANDPOS is the active weapon. Dual pistols: `IsValidSecondHandShot` = both hands `IC_GUN`, second one-handed,
  `bGunStatus ≥ USABLE`, shots left, not bursting (`Tactical/Soldier_Control.cc:8624-8633`); readying both costs
  `AP_READY_DUAL` 1.
- Weapon modes `WM_NORMAL → WM_BURST → WM_ATTACHED` (UGL with a grenade attached) (`Weapons.cc:3770-3811`).
- `HandleTacticalEffectsOfEquipmentChange` (`Interface_Panels.cc`) after each pick-up and placement: the launcher-mode
  check and, for hand slots, `ReLoadSoldierAnimationDueToHandItemChange` (burst off for guns without burst, out of the
  aim, first aid ends, `LOWER_RIFLE`/`RAISE_RIFLE` when standing). NPC action 6 (`LOWER_GUN`) calls it too.
- AI: `RearrangePocket` is a **free swap** (`TacticalAI/AIUtils.cc:2013-2017`); `CanNPCAttack` swaps the first usable
  weapon into HANDPOS and a second one-handed gun into SECONDHANDPOS (`TacticalAI/Attacks.cc:1573-1592`);
  `FindAIUsableObjClass` skips `OBJECT_AI_UNUSABLE`, status < USABLE and, for `IC_GUN`, EXPLOSIVE_GUNs
  (`Tactical/Items.cc:420-444`). `WearGasMaskIfAvailable` swaps a gas mask to the face (`AIUtils.cc:1566-1577`); not
  ported (gaps.md "Ambush").

### 3.5 Keys

PCs keep keys on a UI-managed key ring (`pKeyRing`, `KEY_ON_RING {ubKeyID, ubNumber}`, `Tactical/Items.cc:2324-2391`);
key objects store `ubKeyID` (§2). Enemies "with keys" and profiled NPCs hold key items in pockets
(`Tactical/Soldier_Create.cc:1993-2013`). ja2-node (`src/sim/tactical/doors/keys.ts`, `key-ring.ts`):
`ItemObject.keyId`; `Soldier.keyRing` (our team only, `NUM_KEYS` 64 slots, imported from native saves); `KeyTable`
(where and when each key was first placed into a PC's inventory, `collectKey` from `PlaceObject`); key items found
through `classIndex == LockTable[keyId].usKeyItem` (`createKeyObject`); the key ring drops with the corpse and with
left equipment (`dropKeysInKeyRing`). Locks, door actions and traps: `35` §5 (`src/sim/tactical/doors/`).

### 3.6 Weight and encumbrance (`Tactical/Items.cc:819-867`)

```
weight(o)  = 100·item.ubWeight grams
             + if item.ubPerPocket ≤ 1: 100·weight of each attachment, + magazine weight if gun and ubGunShotsLeft > 0
carried(s) = Σ over 19 slots weight(o) × (ubPerPocket > 1 ? ubNumberOfObjects : 1)
str        = EffectiveStrength(s) = max(2, str/2 + (str/2)·effectiveLife/lifeMax)          (SkillCheck.cc:14-25)
             effectiveLife = life + (lifeMax − life − bleeding)/2                         (Soldier_Control.h:821)
str'       = str > 80 ? str + (str − 80) : str
percent    = (100·carried) / (str'·500)                                                   (UINT32 integer division)
```

Vanilla stores `ubWeight` per object and computes `10·Σ / (str'/2)` (`V:Tactical/Items.c:1836-1860`), which differs for
odd strengths; ja2-node follows Stracciatella (`carriedWeightPercent`, `inventory.ts`).

Effects (all integer):
- `s.sWeightCarriedAtTurnStart = percent` at `EVENT_BeginMercTurn` (`Tactical/Soldier_Control.cc:4061`), before
  `CalcNewActionPoints` (`:4073`); 0 initially (inferred: `InitSoldierStruct` zeroes the struct).
- **APs**: if > 100, `ap = ap·100/percent` after the wound and breath reductions, before the 10..max clamp
  (`Soldier_Control.cc:352-355`).
- **Agility**: `EffectiveAgility = drunkAgility·100/percent` if > 100 (`SkillCheck.cc:35-40`); feeds APs, interrupts,
  CTH, everything.
- **Breath**: `BreathPointAdjustmentForCarriedWeight` = 100 up to 100 %; `100 + 3·(p−100)` up to 150; `+ (p−150)` up to
  200; `+ (p−200)` above (`Tactical/Points.cc:117-151`; the comments say 1 %/2 %/3 %, the code 3/4/5). Terrain breath
  cost ×adj/100 (`:195`); unused-AP breath recovery ×100/adj (`:674, 746`). Unlike APs and agility, breath uses the
  current weight, not the turn-start value (`breathAdjustmentForCarriedWeight`, `points.ts`).
- Strategic travel speed and assignments also read it (`Strategic/Strategic_Movement.cc:1018`, `Assignments.cc:2088`).

---

## 4. Reload and ammunition

### 4.1 `ReloadGun(s, gun, ammo)` (`Tactical/Items.cc:1082-1312`)

```
if gun == ROCKET_LAUNCHER: fail
aps = INCOMBAT ? GetAPsToReloadGunWithAmmo(gun, ammo) : 0       // 5, or 10 if ammo.capacity != gun.ubMagSize; launchers 5
if INCOMBAT and not EnoughPoints(aps): fail
if launcher or TANK_CANNON: AttachObject(s, gun, ammo) or fail             // grenade/shell becomes an attachment
else:
  empty = shotsLeft == 0; stack = ammo.count > 1
  sameType = gun.ubGunAmmoType == mag.ammoType; sameSize = mag.capacity == gun.ubMagSize
  type = empty ? PLACE
       : sameSize ? (sameType ? (INCOMBAT ? SWAP : TOPOFF) : (stack ? AUTOPLACE_OLD : SWAP))
       : (sameType ? TOPOFF : AUTOPLACE_OLD)
  newAmmoItem = sameSize ? ammo.usItem : capacity > magSize ? ammo.usItem − 1 : ammo.usItem + 1   // adjacent-id quirk
  moved = TOPOFF ? min(ammo.ubShotsLeft[0], magSize − shotsLeft)
        : sameSize ? ammo.ubShotsLeft[0] : min(ammo.ubShotsLeft[0], magSize)
  PLACE:         gun ← (moved, mag.ammoType, newAmmoItem)
  SWAP:          gun ← new; old magazine (shotsLeft rounds) goes to the end of the ammo stack, or replaces the cursor
                 object; in combat without aps + AP_PICKUP_ITEM left it is auto-placed or dropped VISIBLE at the feet
  AUTOPLACE_OLD: old magazine auto-placed (fail if no room), then gun ← new
  TOPOFF:        shotsLeft += moved
  unless (SWAP and not stack): ammo.ubShotsLeft[0] −= moved; if 0 remove one object
DeductPoints(aps); if bGunAmmoStatus ≥ 0: bGunAmmoStatus = 100     // reloading never unjams
```

Real-time reloads are free and top off instead of swapping; a partially used magazine of a different size is consumed
into the gun, which records the neighbouring magazine id. `EmptyWeaponMagazine` (UI unload) turns the loaded rounds
back into a magazine object and keeps `usGunAmmoItem` (`:1315-1345`).

### 4.2 Which magazine is used

- `FindAmmoToReload(s, slot, exclude)` (`:1365-1415`): gun → the slot holding the **same magazine item** as last loaded
  (any slot 0..18), else same calibre and size from HANDPOS on (`FindAmmo`, `:1348-1362`), else same calibre any size.
  Launcher → for each launchable explosive in container order with its calibre, the first slot holding it.
- `AutoReload` (`:1418-1463`, the reload hotkey) reloads HANDPOS, then SECONDHANDPOS if
  `IsValidSecondHandShotForReloadingPurposes` and the APs suffice. `GetAPsToAutoReload` mirrors it for the cursor
  (`Points.cc:1451-1516`).
- **AI**: `CanNPCAttack` → `OKToAttack` → on `NOSHOOT_NOAMMO`, `TryToReload` = `FindAmmo(calibre, ubMagSize)` and
  `ReloadGun` (`TacticalAI/Attacks.cc:1544-1551, 1569-1573`): same size only, APs charged in combat.
- Firing: `EnoughAmmo` (`Points.cc:1322-1350`; launchers need an attached grenade/bomb; `WM_ATTACHED` always true);
  `DeductAmmo` decrements `ubGunShotsLeft` or removes the launcher's attached round (`:1353-1405`). Jams (PCs only,
  PreRandom, `bGunAmmoStatus` negated) and wear (`!PreRandom(15 + 3·reliability)` → status −1, `Weapons.cc:871-875`):
  `11` §1.7 (`Weapons.cc:245-321`).
- A fired ROCKET_LAUNCHER becomes DISCARDED_LAW with the same status (`Weapons.cc:791, 828`).

---

## 5. Item use AP costs (`Tactical/Points.h`)

| Action | AP | Breath | Source |
|---|---|---|---|
| Reload (cursor, hotkey, magazine dropped on the gun) | 5 (`AP_RELOAD_GUN`); 10 with a wrong-size magazine; free in real time | – | `Points.cc:1432-1448`; `Items.cc` `ReloadGun` |
| Attach in the item box | 5 must be left (merges: §2); closing the box in combat charges 5 (`AP_RELOAD_GUN`) once to the cursor's merc, or the box owner, when the attachments (item and status) changed; ja2-node charges 5 per accepted `attach` that changes them (deviations.md "Attachment AP") | – | `Interface_Items.cc:1987`, `:1816-1822`, `:2530-2588` |
| Remove an attachment in the item box | 8 (`AP_RELOAD_GUN + AP_PICKUP_ITEM`) must be left; the closing charge above; ja2-node charges 5 per accepted `detach` | – | `Interface_Items.cc:2001` |
| Unload the magazine (item box ammo button) | 0 | – | `Interface_Items.cc` `ItemDescAmmoCallback` |
| Move inside one inventory | 0 | – | `Interface_Panels.cc` `SMInvClickCallbackPrimary` |
| Hand to another merc through the panel | 3 each must be left, 2 each spent (conscious mercs only); passing to a merc in range from the cursor: 3 + 3 | – | `Interface_Panels.cc:1549-1561, 1673-1712`; `Interface_Items.cc:3404-3420` |
| Pick up item | 3 (`AP_PICKUP_ITEM`) + path cost | – | `Handle_Items.cc:1295-1297`; `Points.cc:1417-1423` |
| Give item (to adjacent soldier) | 1 (`AP_GIVE_ITEM`) + path | – | `Points.cc:1426-1429` |
| Drop item from the cursor on the own tile | 3 (`AP_PICKUP_ITEM`), unless the pickup was free | – | `Interface_Items.cc` `HandleItemPointerClick`; `Handle_Items.cc:970-984` |
| Toss item (non-explosive throw) | 8 (`AP_TOSS_ITEM`), at the release frame | – | `Soldier_Ani.cc:857-866` |
| Throw grenade | `MinAPsToThrow` (`34` §2) | – | `Points.cc:1692-1742` |
| Fire launcher | `MinAPsToShootOrStab` + aim (`34` §8) | | `Points.cc:1081` |
| Plant bomb / mine | 3 (`AP_DROP_BOMB`) + path | | `Points.cc:1745-1755` |
| Use remote / detonator | 2 (`AP_USE_REMOTE`) | 0 | `Handle_Items.cc:737-755` |
| Merge (not combine) | 8 (`AP_MERGE`) | | `Items.cc:1635-1639` |
| Camouflage kit / elixir | 10 (`AP_CAMOFLAGE`) | | `Items.cc:3380-3424, 3478-3510` |
| Canteen | 5 (`AP_DRINK`), breath gain `2·min(20, points)·(100−breath)` | negative | `Items.cc:3427-3476` |
| First aid start / per HP / stop | 5 / 1 / 3 (+ stance → crouch) | 0 / −25 / 0 | `Points.h`; `Points.cc:1668-1672` |
| Wire cutters / repair / refuel | 10 / 5 / 10 (+ stance → crouch) | | `Points.cc:1662-1690` |
| Attach tin-can trip wire | 5 (`AP_ATTACH_CAN`) | | `Handle_Items.cc:700-734` |
| Ready weapon | `ubReadyTime` (dual: 1) | – | `Points.cc:1612-1645` |

The item `BP_*` constants (`BP_RELOAD_GUN`, `BP_THROW_ITEM`, `BP_READY_*`, `Points.h`) are never used; breath for these
actions comes only from the per-animation breath rates (`GetBreathPerAP`, `Points.cc:764-840`). ja2-node: `applyItem`
refuses drugs and alcohol (gaps.md "Drugs and alcohol"); planting, wire cutters, repair, refuel, jars and tin cans
have no command (gaps.md "Unbuilt item actions").

**Hand item breakage** (`HandItemWorks`, `Tactical/Handle_Items.cc:2639-2696`), first step of every `HandleItem` call:
for an `ITEM_DAMAGEABLE` hand item that is not a pressure explosive, medkit or gas can: status < `USABLE` → fails; else
`Random(80) + 20 ≥ status + 50` → **breaks**, status = `1 + Random(9)` (main stream; only items below 50 % can break).
A working main-hand gun also checks a loaded second-hand gun (`handItemWorks`, `src/sim/tactical/combat/attack.ts`).

### 5.1 First aid (`Handle_Items.cc` `HandleItem` medkit branch; `Soldier_Control.cc`; `Overhead.cc`)

`EVENT_SoldierBeginFirstAid` (refusals: `PCDoesFirstAidOnNPC`, creatures, hostile soldiers) → `START_AID` →
`GIVING_AID` loop → `END_AID` (code 768; stands up when no enemy is left); `SoldierGotoStationaryStance` returns a medic
to `GIVING_AID`. `SoldierDressWound` heals with `RT_FIRST_AID_GAIN_MODIFIER` from `HandlePlayerServices` in
`EndTurnEvents` and `HandleTacticalEndTurn`. `InternalReceivingSoldierCancelServices` /
`InternalGivingSoldierCancelServices` end it at movement start, stop, stance change, climbs, blasts, collapse,
incapacitation, death, teleport, suppression and hand item changes; `BeginSoldierGetup` waits for the bandage. Being
bandaged costs `AIM_PENALTY_GETTINGAID` 20 in gun, thrown and close-combat chances (`11` §2, `34` §4, `11` §4.2); the
interrupt duel takes 2 from both partners (`10` §1.3). ja2-node: `first-aid.ts`, soldier fields `servicePartner`,
`serviceCount`, `pendingAid` (imported from native saves); the stub `START_AID` script jumps to the `GIVING_AID` loop
like the original's. Auto-bandage is not ported (gaps.md "Auto-bandage").

---

## 6. World items

### 6.1 Records (`Tactical/World_Items.h:10-35`)

`WORLDITEM` (52 bytes, raw in map files and save temp files): `fExists` 0, `sGridNo` i16 2, `ubLevel` 4, `o`
OBJECTTYPE 8..43, `usFlags` u16 44 (`DONTRENDER 0x01`, `FIND_SWEETSPOT_FROM_GRIDNO 0x02`, `ARMED_BOMB 0x40`,
`SCIFI_ONLY 0x80`, `REALISTIC_ONLY 0x100`, `REACHABLE 0x200`, `GRIDNO_NOT_SET_USE_ENTRY_POINT 0x400`),
`bRenderZHeightAboveLevel` i8 46, `bVisible` i8 47, `ubNonExistChance` 48. `src/content/formats/map.ts` exposes these
plus `raw`; `o` decodes with §2.

`gWorldItems` is a vector of slots reused first-free (`World_Items.cc:122-134`); `gWorldBombs` indexes armed bombs.
Per tile and level an **item pool** is a linked list in insertion order (`Handle_Items.cc:1427-1629`). ja2-node keeps
one list `TacticalState.worldItems` (`WorldItem {gridNo, level, object, flags, zHeight, visible}`,
`src/sim/tactical/world-items.ts`); a tile's pool is its entries in list order (`itemsAt`).

Visibility (`Handle_Items.h:28-37`): `HIDDEN_ITEM −4` (needs a search on the tile), `BURIED −3` (armed bombs, pits),
`HIDDEN_IN_OBJECT −2` (closed openable), `INVISIBLE −1` (not yet seen), `VISIBLE 1`.

### 6.2 Loading map items (`LoadWorldItemsFromMap`, `World_Items.cc:215-350`)

Skipped entirely for a sector visited before (its items come from the save). For each record in file order:
1. OWNERSHIP items get `ubNonExistChance = 0`.
2. **`PreRandom(100) < ubNonExistChance` → skip.** Drawn for **every** record, chance 0 included (`:244`).
3. Skip `REALISTIC_ONLY` items (sci-fi on); apply `tactical-map-item-replacements.json` (empty); skip `ITEM_NOT_EDITOR`.
4. Reduced guns: big-list gun → replacement, `shots = newMag·shots/oldMag`, at least 1 if it had any; big-list magazine
   → replacement, each status scaled `·newCap/oldCap` (`:272-303`).
5. Pits: disarmed and BURIED. Pressure-triggered explosive with `bVisible == HIDDEN_ITEM` and `bTrap > 0`: armed
   (`BOMB_PRESSURE`), `ARMED_BOMB` flag, `MAPELEMENT_ENEMY_MINE_PRESENT` on the tile. Armed bombs are BURIED.
6. `AddItemToPool(grid, o, bVisible, level, flags, zHeight)`; then terrorist/queen ownership clean-ups (`:353-430`).

ja2-node (`loadWorldItemsFromMap`) keeps the draw and the filters; which armed items act: §12 (gaps.md "Map
items").

### 6.3 `AddItemToPool` (`Handle_Items.cc:1427-1629`)

- `NOWHERE` → map centre (logged). **Water + `ITEM_SINKS` → item destroyed** (returns −1).
- Level 1 without a flat roof above → level 0 (ja2-node: any roof-layer tile counts as a flat roof).
- `zHeight == −1` = "force on ground". A blocking structure on the tile at that level (not person/corpse; OWNERSHIP
  and ACTION_ITEM ignore structures) moves the item to the structure's base tile; an **openable** sets `DONTRENDER`,
  `HIDDEN_IN_OBJECT` while closed, z = structure height; a `STRUCTURE_GENERIC` puts the item on top at its densest
  level and sets `STRUCTURE_HASITEMONTOP` (ja2-node: no structure flag).
- SWITCH items become BURIED pressure/switch triggers; pits mark `MAPELEMENT_ENEMY_MINE_PRESENT`.
- Appends to the pool, sets `MAPELEMENT_ITEMPOOL_PRESENT`.

### 6.4 Seeing and finding items

- A player soldier's sight sweep reveals every non-OWNERSHIP, non-ACTION_ITEM item with `bVisible ≥ INVISIBLE` on each
  tile it sees: `SetItemsVisibilityOn(tile, level, INVISIBLE, …)` (`Tactical/FOV.cc:539-548`;
  `Handle_Items.cc:1792-1827`). In combat a newly seen item halts the mover (`HaultSoldierFromSighting`, `FOV.cc:557-560`).
  Sight never reveals hidden/buried items.
- Opening an openable reveals its items (`TileEngine/Interactive_Tiles.cc:164`); closing hides them again (`:181`).
- Picking up on a tile with only `HIDDEN_ITEM`s, or after any pickup, `LookForHiddenItems` makes them visible
  (+5 wisdom) (`Handle_Items.cc:1675-1691, 1272-1281, 1356-1362`).
- Display and player pickup need `VISIBLE` and the right z level (`ItemPoolOKForDisplay`/`ItemPoolOKForPickup`,
  `:1961-2009`); enemies pick up regardless of visibility.

### 6.5 Picking up (`Handle_Items.cc:1104-1371`; `Soldier_Control.cc:8131-8237`)

1. `SoldierPickupItem`: target tile = `AdjustGridNoForItemPlacement` (blocked or occupied tile → adjacent tile,
   `:2501-2527`); pending action `MERC_PICKUPITEM`; walk there if needed.
2. `PickPickupAnimation`: other tile → `ADJACENT_GET_ITEM`; same tile standing → `PICKUP_ITEM` (raised openables use
   `ADJACENT_GET_ITEM` facing the structure); crouched, prone or in water → immediate, no animation.
3. Animation code **493** (`Soldier_Ani.cc:1554-1563`) → `HandleSoldierPickupItem`: no pool → "nothing"; enemies take
   the given item directly; a player tile with `MAPELEMENT_PLAYER_MINE_PRESENT` asks to disarm; several visible items
   open the pickup menu (UI).
4. `SoldierGetItemFromWorld` (`:1174-1305`): per item `ContinuePastBoobyTrap` (trap check, `:2735-2811`), SWITCH asks
   to activate, else `RemoveItemFromPool` + `AutoPlaceObject`; an item that does not fit goes to the cursor (players)
   and the pickup is then free (`gfDontChargeAPsToPickup`). Charges `AP_PICKUP_ITEM` once.

ja2-node (`src/sim/tactical/item-actions.ts`): the command names the entries instead of the menu; an item that does not
fit stays on the ground (deviations.md "Picking up items").

### 6.6 Dropping, giving, tossing

- Drop: object copied to `pTempObject`; standing → `DROP_ITEM` animation, code **487** adds it `VISIBLE` at the
  soldier's tile (`zHeight −1`); crouched/prone → immediate (`Handle_Items.cc:970-984, 1097-1101`;
  `Soldier_Control.cc:8240-8256`).
- Give: walk adjacent, `MERC_GIVEITEM`, code **486** transfers (`Handle_Items.cc:1056-1094, 2306`; ja2-node `give.ts`).
- Toss (non-explosive): `THROW_ITEM`/`LOB_ITEM` animation, physics object, `AP_TOSS_ITEM` at code 460/461
  (`Handle_Items.cc:988-1053`; `34` §0; ja2-node `toss.ts`, catching in `explosions/catching.ts`; gaps.md
  "Tossing from the item cursor").
- AI item search (`SearchForItems`, `TacticalAI/FindLocations.cc:1489-1676`; ja2-node `ai/item-search.ts`): range from
  difficulty and attitude, capped at wisdom/10, halved in real time, then halved; scores better weapons/armour/ammo
  over all items in reach, discounted by `3/(3 + distance)`; may drop or destroy the hand item first.

### 6.7 Sector inventory on the map screen

The loaded sector's world items, or another visited sector's diff items (`src/sim/campaign/map-inventory.ts`). The
reachable flag comes from `HandleAllReachAbleItemsInTheSector` (`Tactical_Save.cc`), also run when a sector is saved,
so items left in a visited sector are takeable on the map screen and stealable by `RemoveRandomItemsInSector` (`18`).

---

## 7. What the profile inventory gives mercs

- Profile arrays (`Prof.dat`, record offsets): `bInvStatus[19]` 358, `bInvNumber[19]` 377, `ubInvUndroppable` 412,
  `inv[19]` u16 416, `uiMoney` u32 684 (`Tactical/LoadSaveMercProfile.cc:126-191`). JSON may override `inventory` and
  `money` (`X:mercs/MercProfile.cc:324-347`); the shipped `mercs-profile-info.json` only has a commented-out example.
- `InitProfileFromContent` (`Tactical/Soldier_Profile.cc:126-218`), reduced guns: every big-list gun becomes its
  `standardReplacement`, and every magazine that fitted the old gun (calibre **and** size) becomes
  `FindReplacementMagazine(newCalibre, newSize, sameAmmoType)` (`:161-183`). Examples (inferred from code + JSON):
  M1911/CLIP45_7 → GLOCK_17/CLIP9_15; MP53 (5.56, 30) → MP5K (9 mm, 30) and CLIP556_30_AP → CLIP9_30_AP. Then
  `bMainGunAttractiveness`, `bArmourAttractiveness` and `usOptionalGearCost` (sum of prices). ja2-node:
  `reducedGunListInventory` (`inventory.ts`).
- `CopyProfileItems` (`Tactical/Soldier_Create.cc:1981-2060`):
  - **Player team** (hiring with "buy equipment" from AIM, always for MERC/IMP, `Laptop/AIMMembers.cc:1194`,
    `Mercs_Files.cc:428`, `IMP_Confirm.cc:142`): clear the inventory, then for each profile slot in order
    `CreateItems(item, status, count)`, `TryToAttach` (an `ITEM_ATTACHMENT` item goes onto the first valid host,
    `:1963-1978`) or `AutoPlaceObject`. The profile slot indices are **not** kept. Without the option the merc arrives
    empty. ja2-node: `hiredMercInventory`.
  - **Other teams** (profiled NPCs, Mike/Iggy as enemies): slot-for-slot copy; keys only for Brewster 19, Skipper 11,
    Doreen 32; ROCKET_RIFLE/AUTO_ROCKET_RIFLE imprinted; `ubInvUndroppable & gubItemDroppableFlag[slot]`
    (`0x01,0x02,0x04,0,0,0x08,0,0x10,0x20,0x40,0x80,0…`, `:75-96`) → `OBJECT_UNDROPPABLE`; money split over empty
    pockets by `MoneySlotLimit`. ja2-node: `npcProfileInventory` (`DROPPABLE_FLAG`).

---

## 8. Enemy and militia equipment (`Tactical/Inventory_Choosing.cc`)

All draws are **`Random`** (main stream), none PreRandom. `Chance(n)` = `Random(100) < n` and always draws;
`Random(0)` returns 0 without drawing; `Random(1)` draws (`sgp/Random.cc:62-74`; libstdc++ consumes the engine for a
one-value range, inferred). Keep both rules: single-entry gun levels and single matches call `Random(1)`.
ja2-node: `src/sim/tactical/equipment.ts` (`generateRandomEquipment`, `replaceExtendedGuns`, `equipTank`), called from
`creation.ts`.

### 8.1 Where it runs

- **Basic placement**: `CreateDetailedPlacementGivenBasicPlacementInfo` rolls body, level and the 12 stat pairs, then
  calls `GenerateRandomEquipment(pp, class, bRelativeEquipmentLevel)` unless the placement is detailed or the class is
  NONE/CREATURE/MINER (`Tactical/Soldier_Create.cc:1386-1392`).
- **Static detailed placement without profile** (`:1463-1543`): basic generation (no equipment), stat overrides, copy
  **only** slots flagged `OBJECT_NO_OVERWRITE`, `ReplaceExtendedGuns` (reduced guns, `Inventory_Choosing.cc:1855-1922`),
  then `GenerateRandomEquipment` with the basic placement's equipment level (`:1525-1542`). The weapon status floor
  (§8.5) then uses the overridden marksmanship.
- Profiled soldiers use the profile (§7). Civilians and miners get nothing except NO_OVERWRITE items; kids return early;
  tanks get `EquipTank` (`Inventory_Choosing.cc:138-150, 1951-1979`). The `SOLDIER_CLASS_NONE` branch is dead (inferred).
- Afterwards in `TacticalCreateSoldier`: face items in big pockets move to HEAD1/HEAD2 (non-player,
  `Soldier_Create.cc:293-317`); an enemy with a CAMOUFLAGEKIT draws `Random(5) < SoldierDifficultyLevel` → camo 100
  (`:319-327`); ARMY/ELITE and their militia always draw `Chance(nightops)` in `TacticalCopySoldierFromCreateStruct`
  (`:841-872`). Creation order for the RNG: body → level → stats → **equipment** → nightops → palettes (`06` §7.2)
  → battle sound → female→male → camo (inferred from these call sites).
- Strategic garrisons (not map placements) first randomise the equipment level (`RandomizeRelativeLevel`,
  `Soldier_Create.cc:1842-1918`). `ResetMortarsOnTeamCount()` runs at the start of
  `AddSoldierInitListEnemyDefenceSoldiers` (`Soldier_Init_List.cc:629`); at most 1 mortar per team (`:32`).

### 8.2 Equipment rating (`Inventory_Choosing.cc:159`; `Soldier_Create.cc:1035-1111, 2100-2134`)

```
diff = CalcDifficultyModifier(class)        // 17 §11: no RNG, 0..100; A9 at a new game: easy 1, medium 11, hard 21
mod  = bRelativeEquipmentLevel (0..4) + diff/10 − 5
r    = clamp(base + mod, 1, 11);  base 1 admin / green militia, 3 army / regular militia, 5 elite / elite militia
```

ja2-node computes `diff` once per sector load (deviations.md "Difficulty and progress in tactical"; the sandbox uses the
medium value 11, "Sandbox population").

### 8.3 Budget per class (`:170-420`), in draw order

```
admin / green militia:  knife = Random(2) ? r : 0;  clips = 1 + Random(2)
                        if r ≥ 4: clips++, kit = misc = r;  if r ≥ 5: grenades = 1, grenadeClass = r
                        if 1 < r < 11: Random(5): 0 → weapon+1 vest−1, 1 → weapon−1 vest+1
                        weapon = vest = helmet = r (before the tweak); no leggings
army / regular militia: weapon = vest = helmet = grenadeClass = r
                        if r ≥ 6 and Random(100) < 33: attachment, attachClass = r
                        clips = 2 + Random(2)
                        if r ≥ 5: grenades = Random(2), kit = misc = r;  if r ≥ 6: grenades++
                        if r ≥ 7: grenades++, leggings = r, Chance(25) → bomb = r
                        knife = Random(2) ? r : 0
                        if 1 < r < 11: Random(7): 3 W+1 V−1 | 4 W−1 V+1 | 5 V+1 H−1 | 6 V−1 H+1
                        if r ≥ 7 and Random(100) < 20: Random(underground && !autoresolve ? 6 : 7):
                            0–2 exp ≥ 3 → grenade launcher, grenades = 3 + Random(3)
                            3–5 exp ≥ 4 → LAW
                            6   exp ≥ 5, no mortar yet → mortar, grenades = 2 + Random(3), grenadeClass = 100
elite / elite militia:  weapon = helmet = vest = leggings = attach = grenade = kit = misc = r
                        Chance(25) → bomb = r;  clips = 3 + Random(2);  grenades = 1 + Random(3)
                        if r ≥ 7 and Random(100) < 75: attachment
                        knife = Random(2) ? r : 0
                        if 1 < r < 11: Random(11): 4 W+1 V−1 | 5 W−1 V−1 | 6 V+1 H−1 | 7 grenades+2
                                                   | 8 H+1 | 9 V+1 | 10 W+1
                        if r ≥ 8 and Random(100) < 33: Random(6|7): 0–2 GL, grenades = 4 + Random(4)
                                                       | 3–5 LAW | 6 mortar (if none), grenades = 3 + Random(5), class 100
```

**Slot pass** (`:423-486`): every slot without NO_OVERWRITE becomes empty with `fFlags = OBJECT_UNDROPPABLE` (the 0x01
seen on static placement slots). A NO_OVERWRITE item switches the matching generator off: a gun other than the LAW
negates `weaponClass` (pre-selected gun, §8.5; two locked guns flip it back, quirk), the LAW clears the LAW flag, ammo
sets clips 0, a knife sets knife 0, a launcher clears GL and mortar, armour zeroes its class, grenades zero count and
class, kits/misc/bombs zero their class. Militia lose `bomb` after its `Chance(25)` was drawn (`:490-493`).

Then, in order (`:497-506`): weapon → grenades → armour → special weapons → face gear → kits → misc → bombs →
location-specific → droppability.

### 8.4 Gun tables (`J:army-gun-choice-{normal,extended}.json`; loader `X:DefaultContentManager.cc:791-807`)

`SelectStandardArmyGun(level)` = `list[Random(list.size())]` from the **normal** table (extended only with `fGunNut`)
(`Inventory_Choosing.cc:1925-1948`). Level = weapon class − 1; each file holds 11 levels (0..10) of gun
`internalName`s (a repeated name weighs double); ja2-node: `ItemTable.gunChoice`. The extended table also defines the
gun **types** of the first-drop rule (§8.7). `army-compositions.json` only sizes garrisons (`06` §7.2), no equipment.

### 8.5 Choosers (all iterate items in container order = ascending item id)

- **Weapon** (`:517-687`):
  - Pre-selected gun (class < 0, clips > 0): spare clips `RandomMagazine(gun, 100 − 9·|class|)`, ROCKET_RIFLE imprint
    `NO_PROFILE+1`, `CreateItems(mag, 100, clips)` undroppable, placed; no status roll, no attachment.
  - Else (class ≥ 1, capped at 11): `gun = SelectStandardArmyGun(class − 1)`; spare clips
    `RandomMagazine(gun, defaultMag is AP/SAP ? 80 : 100 − 9·class)`.
  - Attachment (flag set): `IC_MISC` items with `coolness == attachClass` and `ValidAttachment`, descending the class
    until one matches, `Random(n)`; reachable: DUCKBILL 2, BIPOD 4, SILENCER 5, SNIPERSCOPE 6, LASERSCOPE 8 (the gun's
    `attachment_*` flags gate them).
  - HANDPOS not locked: status `60 + Random(16) + progress/4` (admin, army, green/regular militia) or
    `85 + Random(6) + progress/10` (elites), min 100, then `max(marksmanship, status)` and
    `max(status, enemy_weapon_minimal_status)`; `CreateItem(gun, status)` undroppable (loaded with a full
    **`DefaultMagazine`**; the spares may differ: M870 holds buckshot, spares default to slugs); attach with a null
    soldier (no skill check). Then the clip stack.
- **Grenades** (`:690-946`): points = count·class; class 100 → `MORTAR_SHELL × n` at `80 + Random(21)`. Otherwise
  `base = min(45 + 5·class, 90)`, `var = 101 − base`, and while points > 0 (three independent ifs per pass):
  ```
  if points ≥ 20: Random(2) && !GL ? mustard −10 : regular −9
  if points ≥ 10: Random(7): 0 mustard −10 (GL: regular −9) | 1 regular −9 | 2 mini −7 (GL: tear −6)
                             | 3 tear −6 | 4 stun −5 | 5 smoke −4 | 6 flare −3 (GL: nothing)
  if 1 ≤ points < 10: Random(10): 0–2 smoke −4 | 3–4 tear −6 | 5–6 flare −3 (GL: nothing) | 7–8 stun −5 | 9 mini −7 (GL: nothing)
  ```
  Created in the order smoke, tear, stun, regular, mini, mustard, flare, each `CreateItems(type, base + Random(var),
  count)` undroppable; with a GL the `GL_*` variants.
- **Armour** (`:949-1109`): helmet, vest, leggings; items of that class with **exact** `coolness == class`, descending
  until a match, `Random(n)`, status `70 + Random(31)` (the `Random(31)` is skipped for a locked slot). Vests skip
  TSHIRT, LEATHER_JACKET, TSHIRT_DEIDRANNA. Reachable: helmet 2 STEEL, 4 KEVLAR, 7 SPECTRA; vest 2 FLAK, 4 KEVLAR,
  6 KEVLAR2, 8 SPECTRA; leggings 5 KEVLAR, 8 SPECTRA. KEVLAR/SPECTRA vests: `Random(100) < 15·(vestClass − coolness)` →
  CERAMIC_PLATES `70 + Random(31)` attached.
- **Special weapons** (`:1112-1188`): knife (blade/throwing knife, exact class with descent: 2 COMBAT_KNIFE, 3
  THROWING_KNIFE/MACHETE), `70 + Random(31)`; GLAUNCHER, ROCKET_LAUNCHER, MORTAR at `50 + Random(51)`.
- **Face gear** (`:1191-1268`): elites `Chance(75)` GASMASK else EXTENDEDEAR (HEAD1), `Chance(75)` NIGHTGOGGLES else
  UVGOGGLES (HEAD2); army `Chance(diff/2)` → `Chance(50)` GASMASK/NIGHTGOGGLES, `Chance(diff/3)` → EXTENDEDEAR; each
  `70 + Random(31)`; admins nothing. Skipped in Tixa while enemy-held, or when a face item already sits in BIGPOCK1..3.
- **Kits** (`:1271-1330`), rolled for every armed soldier: `Chance(50)` FIRSTAIDKIT, else `Chance(25)` MEDICKIT, else
  `Random(n)` over `IC_KIT` with `0 < coolness ≤ kitClass` except TOOLKIT; `80 + Random(21)`.
- **Misc** (`:1333-1392`): weighted list (CANTEEN ×4, ALCOHOL ×2, ADRENALINE ×2, REGEN_BOOSTER if sci-fi, BRASS_KNUCKLES,
  CHEWING_GUM, CIGARS, GOLDWATCH) filtered by `0 < coolness ≤ class`, `Random(n)`, `80 + Random(21)`.
- **Bombs** (`:1395-1429`): `IC_BOMB` with `0 < coolness ≤ class`, `Random(n)`, `80 + Random(21)`.
- **Location** (`:1432-1443`): Tixa while enemy-held → GASMASK `95 + Random(6)`, **droppable**.

### 8.6 Placement into the create struct (`PlaceObjectInSoldierCreateStruct`, `:1446-1486`)

`ubPerPocket == 0` → one object into the first empty, unlocked BIGPOCK1..4; else `min(perPocket, count)` objects into the
first empty SMALLPOCK1..8, then BIGPOCK1..4. No stacking onto existing slots; a failed placement is lost. So 30-round
clip and GL grenade stacks cap at 4, mortar shells at 2.

### 8.7 Droppability (`RandomlyChooseWhichItemsAreDroppable`, `:1489-1755`)

Everything starts undroppable. Then:
1. **First drop of each gun type** (enemy classes, not autoresolve, no RNG): each weapon slot whose item is not yet in
   `alreadyDroppedWeapons` becomes droppable and its extended-table level is marked (`:51-88`;
   `Strategic/Strategic_Status.cc:26-27, 457-472`, saved). `InitArmyGunTypes` pre-marks level 0 of the extended table at
   campaign start. Marking happens at **generation**, not death. ja2-node: `EquipmentState.weaponsAlreadyDropped`,
   shared with the strategic status (`sharedWeaponsDropped`) at sector load and in autoresolve.
2. Rates: militia ammo 5, grenade 3, other 2; everyone else 50 / 25 / 15 (`:23-30`).
3. **Eight draws, always, in order**: ammo `< A`, weapon `< O`, armour `< O`, knife `< O`, grenade `< G`, kit `< O`,
   face `< O/3`, misc `< O`.
4. Apply: ammo → all ammo slots; weapon → `MakeOneItemOfClassDroppable(IC_LAUNCHER|IC_GUN)`; armour → one armour; knife →
   the first blade/throwing knife (no draw); grenade, kit|medkit, face, misc → one each. `MakeOneItemOfClassDroppable`
   counts the matches `n`, then walks them drawing `Random(n−−)` until a 0 (the last candidate draws `Random(1)`)
   (`:1489-1521`).

Creatures (`AssignCreatureInventory`, `:1758-1853`; ja2-node `creation.ts`) get claws/spit/hides (default-undroppable)
and part drops (BIGPOCK1..3) by `Random(100) <` 30/15/5 (adult/young/infant; bloodcat 30). Profiled enemies (Mike, Iggy)
carry their profile items.

---

## 9. Dropping items

### 9.1 On death (`Tactical/Rotting_Corpses.cc:609-758`)

Frame code **440** of the death animation → `CheckForAndHandleSoldierDeath` → `HandleSoldierDeath` →
`TurnSoldierIntoCorpse` (`Tactical/Soldier_Ani.cc:1678-1681, 2855-2986`; `01` §3.5 "dying").

```
vis = (team == OUR_TEAM || profile == QUEEN) ? VISIBLE : INVISIBLE
queen monster corpse: 6/5/4 (easy/medium/hard) JAR_QUEEN_CREATURE_BLOOD two rows south; robot: nothing
else for slot 0..18 with an item:
   if (!(fFlags & UNDROPPABLE) || team == OUR_TEAM || drop_everything) && !(item.flags & ITEM_DEFAULT_UNDROPPABLE):
      if team != OUR_TEAM && item is IC_AMMO: count = 1 + Random(count)            // ReduceAmmoDroppedByNonPlayerSoldiers, :1273-1281
      AddItemToPool(grid, obj, all_drops_visible ? VISIBLE : vis, level, 0, zHeight −1)   // attachments and loaded ammo travel along
   DropKeysInKeyRing(s, grid, level, vis, …)                // Keys.cc:1266-1297; no-op for non-player soldiers (no key ring)
AllSoldiersLookforItems()                                     // RevealRoofsAndItems for every merc: seen drops become VISIBLE
non-player: TacticalRemoveSoldier; corpse added
```

ja2-node (`turnSoldierIntoCorpse`, `src/sim/tactical/combat/death.ts`) drops VISIBLE only for our team: Deidranna's
items fall INVISIBLE and the creature queen leaves no jars.

### 9.2 Weapon knocked out of the hand (`SoldierTakeDamage`, `Tactical/Soldier_Control.cc:5715-5756`)

`33`: every hit except blood loss (not robots) draws `Random(100) < (UINT16)chance`; a droppable hand item falls
VISIBLE for our team, else INVISIBLE (zHeight −1). A negative chance (undroppable item, −30) wraps to a huge value, but
the undroppable check then blocks the drop.

---

## 10. Explosions (`TileEngine/Explosion_Control.cc`)

### 10.1 Data

Stracciatella replaces vanilla's `EXPLOSIVETYPE.ubType` (NORMAL, STUN, TEARGAS, MUSTGAS, FLARE, NOISE, SMOKE,
CREATUREGAS; `V:Tactical/Weapons.h:112-119`) by optional effect blocks (`X:ExplosiveModel.h:9-34`,
`X:ExplosiveModel.cc:136-226`). There is no fire, burnable gas or flashbang.

**`J:explosives.json`** (items 131–160; ja2-node `ExplosiveDef`): `blastEffect {damage, radius,
structuralDamageDivisor}`, `stunEffect {breathDamage, radius}`, `smokeEffect {type, initialRadius, maxRadius,
duration}` (`type` names a smoke effect), `lightEffect {radius, duration}`, `noise` (§10.3), `volatility` (§10.7),
`isPressureTriggered` (MINE, TRIP_FLARE, TRIP_KLAXON), `calibre` (launchable rounds: 40MM_GRENADE, MORTAR_SHELL,
TANK_SHELL) and `animation`. TRIP_FLARE and BREAK_LIGHT only light, TRIP_KLAXON only makes noise; STRUCTURE_IGNITE
(153) has blast 100 with radius 0 (`Reduce` returns the full damage, §10.4). The creature gases (158–160) have no
animation: `InternalIgniteExplosion` rejects them after raising the busy count (quirk); creature code spawns them with
`NewSmokeEffect` directly (inferred).

**`structuralDamageDivisor` is never read**: the parser asks for `"structuralDamageDisivor"` (`X:ExplosiveModel.cc:189`),
the JSON says `"structuralDamageDivisor": 3` (STUN, MINI, HAND, GL_HE, GL_STUN grenades, CREATURE_COCKTAIL), so the
divisor is 0 and grenades do **full** structural damage. Vanilla divides grenade structure damage by 3
(`V:TileEngine/ExplosionControl.c:1374`). ja2-node parses the value and does not use it (deviations.md "Structural
damage of grenades").

`getSafetyMargin` = max(blast r, stun r, smoke maxRadius, light r/2) (AI, `X:ExplosiveModel.cc:277-292`).

**`J:explosion-animations.json`**: `id` 1..8 (BLAST_1, BLAST_2, BLAST_3, STUN_BLAST, WATER_BLAST, TARGAS_EXP,
SMOKE_EXP, MUSTARD_EXP), `blastSpeed` = frame delay in ms, `damageKeyframe`, `transparentKeyframe` (cosmetic),
`graphics` (STI), `sounds`, `waterAnimation`. The frame count is not in the JSON: `Tile_Cache.cc:149-150` takes it from
the STI aux data, as ja2-node does (`FrameCountOf` in `src/content/items/explosions.ts`, graphic facts in the rule pack,
`04` §5.10), with `damageKeyframe + 1` when the graphic is missing (stub pack).

Frame `k` is reached at `k·(delay + 5)` ms (5 ms ticks and the strict `>` test of §10.2; deviations.md "Explosion
timing"), so damage lands 125 ms (STUN_BLAST: frame 5, 20 ms) to 1530 ms (the gas animations: frame 18, 80 ms) after
ignition; BLAST_1 at 255 ms, BLAST_2/3 at 425 ms. An explosion centred on a water tile switches to WATER_BLAST but keeps
the original delay; its 13 frames never reach key frame 18, so **it deals no damage and spawns no gas** (data + code,
vanilla identical).

**`J:smoke-effects.json`**: ids by position (SMOKE 1, TEARGAS 2, MUSTARDGAS 3, CREATUREGAS 4,
`X:DefaultContentManager.cc:604-615`; `SmokeEffectId`). `damage` and `breathDamage` feed `DishOutGasDamage` (§11.3);
`lostVisibilityPerTile`, `maxVisibility` and `maxVisibilityWhenAffected` the sight rules of §11.4; `ignoresGasMask`
(default false), `affectsRobot` (default false; dead code, §11.3) and `affectsMonsters` (default true); the graphics are
client-only. As shipped SMOKE does no damage, and only CREATUREGAS ignores masks, affects robots and spares monsters.

Tile flags `ubExtFlags[level]`: SMOKE 0x01, TEARGAS 0x02, MUSTARD 0x04, CREATUREGAS 0x80; lookup priority SMOKE > TEAR >
MUSTARD > CREATURE (`TileEngine/WorldDef.h:86-101`; `SmokeEffects.cc:78-100`).

### 10.2 Ignition and timing (`:91-254`; `TileEngine/Tile_Animation.cc:220-372`)

```
InternalIgniteExplosion(owner, x, y, z, grid, item, locate, level):
  if queue empty: flags |= DISALLOW_SIGHT | CHECK_SIGHT_AT_END_OF_ATTACK         // every LOS test fails (01 §3.5)
  ubAttackBusyCount++
  slot = first free of 100 (none, or no animation: return with the busy count raised — leak)
  anitile: delay = animation.blastSpeed, frame 0; on water switch to the water animation
  keyFrame1 = transparentKeyframe (cosmetic); keyFrame2 = damageKeyframe
  light sprite L-R04 while ambient level ≥ 9 (dark); sound = sounds[Random(n)]    // cosmetic, main stream
IgniteExplosion(owner, z, grid, item, level) = the above at the tile centre
UpdateAniTiles (first thing in each overhead pass, Overhead.cc:481-490):
  for each anitile: if now − last > delay: last = now; frame++
     frame == damageKeyframe: smoke → NewSmokeEffect(grid, item, level, owner)  (§11)
                              blast or stun → SpreadEffect(grid, max(blast.r, stun.r), item, owner, FALSE, level, NULL)
                              return                     // the rest of the anitile list waits for the next pass (quirk)
     past the last frame: free the slot; if the bomb queue is idle clear DISALLOW_SIGHT; ReduceAttackBusyCount(owner); return
```

When the busy count reaches 0, `CHECK_SIGHT_AT_END_OF_ATTACK` runs `AllTeamsLookForAll` and our team's
`RevealRoofsAndItems` (`Tactical/Overhead.cc:5748-5761`). Secondary explosions (chain reactions, structures, carried
explosives) create their own anitiles immediately and damage after their own key frame. ja2-node (`stepExplosions`)
keeps the early `return` within the explosion and water-ripple list (deviations.md "Tile-animation pass").

### 10.3 `SpreadEffect(grid, radius, item, owner, sub, level, smoke)` (`:1275-1473`)

```
isSmoke = item has a smokeEffect && smoke != NULL
R = 2·radius
ExpAffect(grid, dist 0)
for dir in N, NE, E, SE, S, SW, W, NW:
  spot = grid; range = R; cnt = odd(dir) ? 3 : 2
  while cnt ≤ range:
    next = step(spot, dir); if next == spot (map edge): break
    keep = GetRayStopInfo(next, dir, level, isSmoke, cnt, &range)
    if !keep: break
    spot = next; ExpAffect(spot, dist = cnt/2)
    bRange = (UINT8)(R − cnt); bdir = (dir + 1) % 8; bspot = spot; bcnt = odd(bdir) ? 3 : 2     // from R, not range
    while bcnt ≤ bRange:
      bnext = step(bspot, bdir)
      if bnext != bspot and GetRayStopInfo(bnext, bdir, level, isSmoke, bcnt, &bRange): ExpAffect(bnext, (cnt + bcnt)/2); bspot = bnext
      bcnt += odd(bdir) ? 3 : 2               // a blocked branch step is retried from the same tile, never breaks (quirk)
    cnt += odd(dir) ? 3 : 2
if structures changed: wireframes, RecompileLocalMovementCostsInAreaWithFlags, RecompileLocalMovementCostsFromRadius(grid, 2) (07)
if changed or isSmoke, and bombs are queued: gfExplosionQueueMayHaveChangedSight
if anyone was hit: clear SOLDIER_MISC_HURT_BY_EXPLOSION on all mercs
MakeNoise(NULL, grid, level, explosive.noise, NOISE_EXPLOSION)      // every spread, gas re-spreads included (08)
```

Distances: straight rays 1, 2, 3, …; diagonals 1, 3, 4, 6, …; branch tiles `(cnt + bcnt)/2`. Each octant is covered once.

`GetRayStopInfo(spot, dir, level, isSmoke, cnt, &range)` (`:1047-1272`):
- Obstacle = movement cost `TRAVELCOST_WALL`, or a door whose `DoorTravelCost ≥ TRAVELCOST_BLOCKED`, or a cave wall.
  `GetBlockingStructureInfo(spot, dir, …)` with structure density ≤ 15 clears the obstacle and disables range
  reduction.
- Obstacle + smoke: an open window at the spot, or an open window / density ≤ 15 at the W or N neighbour, lets it
  through.
- Obstacle + blast: a closed window at the spot breaks (`WindowHit(spot, id, dir ∈ {S, SE, SW}, TRUE)`); W and N
  neighbours with density ≤ 15 let it through, windows there break; breaking a window does not let the blast pass.
- Something blocking but no obstacle: height > 4 stops (vanilla `== 4`); else, if reducing, `range −= 2` (blast) or
  `2/1/0` for heights 3/2/other (smoke); keep going iff `cnt ≤ range`. The height is whatever the **last**
  `GetBlockingStructureInfo` call returned, possibly a neighbour's (quirk).
- Nothing blocking: keep going unless obstacle.
- Level 1: stop on tiles without a `STRUCTURE_ROOF` (Stracciatella only).

### 10.4 `ExpAffect(bomb, grid, dist, item, owner, sub, &hit, level, smoke)` (`:888-1044`)

```
blast, stun = smoke ? none : explosive's;  gas = explosive.smokeEffect
if blast or stun: roll = PreRandom(100)                     // vanilla also drew it for gas tiles
HandleBuldingDestruction(grid, owner)                       // OUR_TEAM owner angers neutral owners of the building
if blast:
  wound = Reduce(dmg + dmg·roll/100, blast.r, dist)
  if wound > 0:
    if dist ≤ max(1, dmg/30): ExplosiveDamageGridNo(grid, wound, …) and, walls only, its N and W neighbours (§10.6)
                              // wound / structuralDamageDivisor if the divisor were read (§10.1)
    if dmg > 10 && 2·dist ≤ blast.r: for each pool item in order: DamageItemOnGround(o, wound·2) → remove if destroyed (§10.7)
if stun: breath = Reduce(bd·100 + (bd/2)·100·roll/100, stun.r, dist)
if gas: sub == ERASE → remove tile smoke; sub != REDO && smoke → AddSmokeEffectToTile (§11.1)
if sub == BLOOD: InternalDropBlood(grid, 0, HUMAN, 2·dist > 7 ? 0 : 7 − 2·dist, visible)   // a vaporized corpse
if sub ∉ {ERASE, BLOOD}:
  if wound || breath:
    t = WhoIsThere2(grid, level) → DamageSoldierFromBlast(t, wound, breath, dist)
    level 1 and someone below and wound/2 > 20: b = breath/2 − 20 > 0 ? Random(breath/2 − 20) : 1
                                                DamageSoldierFromBlast(below, Random(wound/2 − 20), b)     // debris
  if gas: t = WhoIsThere2 (nobody → return without setting hit); DishOutGasDamage(t, type, sub, owner)  (§11.3)
  hit = TRUE
Reduce(d, r, dist) = r == 0 ? d : dist < r ? d − d·dist/r : (d/r)/2          (integer, ≥ 0, :865-885)
```

Example, HAND_GRENADE (25/4, roll 50): wound 37 at the centre, 28/19/10 at 1/2/3 tiles, 4 at 4 tiles.
`HandleBuldingDestruction` has no effect in ja2-node (gaps.md "Building owners").

### 10.5 Damage to soldiers (`DamageSoldierFromBlast`, `:708-744`)

```
skip if inactive, dead, or SOLDIER_MISC_HURT_BY_EXPLOSION set (one hit per spread; multi-tile prone soldiers)
ubAttackBusyCount++
wound' = max(0, wound − min(wound, 35)·ArmourVersusExplosivesPercent(s)/100)          // §1.5
EVENT_SoldierGotHit(s, item, wound', breath, dirFromBomb, dist, owner, 0, hitLocation = ANIM_CROUCH (3 = legs, quirk), bomb)
set the hurt flag; OUR_TEAM owner vs others → ProcessImplicationsOfPCAttack(REASON_EXPLOSION)
```

`EVENT_SoldierGotHit` / `SoldierTakeDamage` with an explosion reason (`33`; the `CHARIOTS_OF_FIRE`,
`BODYEXPLODING` and fall-back animations `33`): creatures take a quarter, vehicles double above 50;
`CheckEquipmentForDamage(s, lifeLoss)` damages carried items and may chain-explode them (§10.7).

### 10.6 Structures (`:257-705`; `TileEngine/Structure.cc:119-149, 1150-1215`)

`ExplosiveDamageGridNo(grid, dmg, dist, …, onlyWalls)` walks the tile's structures:
- An explosive base structure (barrel) gets HP 0. Only `sCubeOffset == 0` structures are damaged, and nothing on level 1
  (roof explosions never hurt structures).
- Per structure `ExplosiveDamageStructureAtGridNo`: corpses with the blood option, wound > 10, dist ≤ 1 are vaporised
  (`VaporizeCorpse`, `Tactical/Rotting_Corpses.cc:1000-1052`): a vehicle's corpse stays; otherwise the corpse and its
  structure go and, on the ground, `SpreadEffect(base, 2, NOTHING, NULL, BLOOD_SPREAD_EFFECT)` sprays blood 7, 5 and 3
  (`Random(3)` decay draws for new pools) along the rays of a radius-2 spread; `BODY_EXPLODE_1` plays. The original
  does all but the sound only while the corpse's base tile is on screen; ja2-node always does it (deviations.md
  "Vaporized corpses"). Corpses reached by wound ≤ 10 or from farther, or with blood and gore off, are not damaged;
  persons skipped; `DamageStructure(s, dmg, EXPLOSION)`: indestructible metal/stone immune; `armour =
  materialArmour/3` (explosion) or `/2`; `dmg < armour` → nothing; else HP −= dmg − armour, destroyed at ≤ 0.
- **Listeners** (`Explosion_Control.cc:341-373`): first `BeforeStructureDamaged` may take the hit (the O3 statue, `26`
  §5.3). Right after `DamageStructure` reports damage or destruction, `OnStructureDamaged(loaded sector, hit tile,
  structure, wound as UINT8, destroyed)` calls its listeners in key order: `default:brothel` (a destroyed wall beside a
  brothel room turns Kingpin's men hostile, `35` §4.2), then `default:sam` (a hit on a SAM tile wears the SAM down,
  `18`). `destroyed` is the raw result, before a negative destruction partner turns it into a swap; the wound is
  the one before the structure's armour. ja2-node: `structureDamaged` in `src/sim/tactical/explosions/structure-damage.ts`
  calls the brothel listener and then `SectorHooks.structureDamaged`, which the sector flow implements.
- **Destruction partner** `bDestructionPartner`: negative partner → swap to the damaged graphic `−partner` instead of
  removing (also when destroyed); positive partner on destruction → debris objects (`FIRSTEXPLDEBRIS + p` or
  `SECONDEXPLDEBRIS + p − 40` **+ Random(3)**, cosmetic) on the tiles and, for walls, the S/E neighbour; walls replace
  their neighbours' end pieces, drop wall-hung items and decals and recompile wall movement costs; fences check their
  partners; crates/lockers spill all unburied items; `HASITEMONTOP` items fall; **an explosive structure ignites
  `STRUCTURE_EXPLOSION`** at its base.
- **Multi-tile structures**: if the structure is multi-tile, not walls-only, and `dist ≤ 1`, every 8-neighbour of each of
  its tiles holding another `STRUCTURE_MULTI` with the same SPECIAL flag is damaged recursively **and gets a real RDX
  explosion** (`InternalIgniteExplosion(RDX)`); `dist > 1` returns.
- Gunfire on an explosive structure: `Random(2)` → `STRUCTURE_IGNITE` (`Structure.cc:1176-1185`).

ja2-node changes structures only: no debris, decals, end pieces or fence partners (gaps.md "Wrecked
structures").

### 10.7 Items in the blast and chain reactions (`Tactical/Items.cc:3044-3277`)

```
CheckItemForDamage(item, max): armour max −= max·protection/100; metal max /= 2; bloodcat pelt ×2
                               return max > 0 ? min(PreRandom(max), 100) : 0
DamageItem(o, dmg, onGround): for each object (damageable or ammo, status > 0):
   d = CheckItemForDamage; jar: PreRandom(d) > 5 → smashed; ammo: PreRandom(100) < d → status 1; else status −= d (≥ 1)
   explosive: CheckForChainReaction → TRUE: stop (it blew up)
   stacked object at status 1 → removed;  attachments: status −= CheckItemForDamage (≥ 1)
CheckForChainReaction: c = volatility; if c > 0: onGround: c = 50 + (c − 1)·10
                       c = c·(100 + ((100 − status) + d)/2)/100; PreRandom(100) < c → boom
   on the ground → IgniteExplosion(owner, 0, grid, item, level); item removed
   carried (CheckEquipmentForDamage, explosion damage, not tanks) → IgniteExplosion(attacker or s, 0, s.grid, item, level); DeleteObj
DamageItemOnGround → removed if it blew up or is a single object below USABLE
```

### 10.8 What sets explosions off

- **Thrown grenades and mortar shells**: `HandleArmedObjectImpact` (`34` §9.6: dud test, re-arming, light effect,
  `IgniteExplosionXY`; deviations.md "Dud test operand order"; gaps.md "Duds and timed bombs"). Armed objects landing in
  water ignite from a ripple anitile (delay 50, key frame 11, `34` §10) as a water blast, which does nothing (§10.1).
- **Launchers** (`WillExplosiveWeaponFail`, the LAW's C1, the tank cannon's TANK_SHELL): `34` §8.
- Others: exploding door trap → HAND_GRENADE (`Tactical/Keys.cc:540`); shaped charge on a lock (`:664`); vehicle death →
  GREAT_BIG_EXPLOSION (`Tactical/Vehicles.cc:672`); booby-trapped item → MINI_GRENADE (`Handle_Items.cc:2723-2729`);
  botched bomb planting (§12); bomb queue (§10.9).

### 10.9 Bomb queue (`:61-69, 1925-2051`)

40 entries `{worldBombIndex, timestamp}`. `AddBombToQueue` locks the UI and sets `DISALLOW_SIGHT` when the queue starts.
Enqueuers (`DecayBombTimers`, `SetOffBombsByFrequency`, `SetOffBombsInGridNo`) give the first bomb `now` and add
**`1000 + Random(500)` ms** after each non-action-item bomb (the draw also happens after the last one).
`HandleExplosionQueue` (every overhead pass, after the anitiles) handles due entries: ACTION_ITEM (not BLOW_UP) →
`PerformItemAction`; else `usBombItem` not an explosive → item removed; no blast/stun/smoke: noise → klaxon +
`CallAvailableEnemiesTo` (item **not** removed, quirk), light → `NewLightEffect` + removed; otherwise remove the item,
clear the mine flags, `owner = ubBombOwner > 1 ? soldier(ubBombOwner − 2) : NULL`,
`IgniteExplosion(owner, 0, grid, usBombItem, level)`. When the queue empties (and the busy count is 0): clear
`DISALLOW_SIGHT`, re-run sight if it may have changed, unlock the UI.

ja2-node ports only the action-item branch (`handleActionItemQueue`, `25` §6.5); see §12.

### 10.10 RNG per event (order)

| Event | Draws |
|---|---|
| Ignition | `Random(#sounds)` (cosmetic) |
| Each blast/stun tile | `PreRandom(100)` → structure debris `Random(3)` (cosmetic) → each ground item: `PreRandom(max)` [jar `PreRandom(d)`, ammo `PreRandom(100)`, explosive `PreRandom(100)`] → soldier (`SoldierTakeDamage`: carried items as above, weapon-drop `Random(100)`) → debris below `Random(b)`, `Random(w)` |
| Each gas tile with a soldier | `PreRandom(dmg)` if dmg > 0, `PreRandom(bd/2)` if > 0, mask wear `Random(4)`/`Random(2)` |
| New smoke tile | `Random(5)`, `Random(300)` (cosmetic) |
| Stepping onto smoke | `PreRandom(5)` |
| Grenade landing, launcher fire | `34` §12 |
| Bomb queue | `Random(500)` per queued bomb |

ja2-node draws none of the cosmetic picks (deviations.md "Cosmetic draws in explosions").

---

## 11. Smoke, gas and light

### 11.1 Clouds (`TileEngine/SmokeEffects.cc:144-241`)

25 cloud slots. `NewSmokeEffect(grid, item, level, owner)`: `lastUpdate = world seconds`, indoors if the tile terrain is
`FLAT_FLOOR` (**duration + 3**), radius = `initialRadius`, age 0, roof flag for level 1, then
`SpreadEffect(grid, radius, item, owner, FALSE, level, cloud)`. `AddSmokeEffectToTile`: when `duration − age < 2` the old
tile is replaced by the dissipating graphic; a tile that already has **any** smoke flag keeps it (first cloud wins);
animation start frame `Random(5)`, delay `300 + Random(300)` (cosmetic, default option on); set the type flag.

### 11.2 Spread and decay per turn and in real time (`DecaySmokeEffects`, `:277-397`)

Called once per turn-based round in `EndTurnEvents` before our team starts (`Tactical/TeamTurns.cc:280-307`), and in
real time from `HandleTacticalEndTurn` every 5 s (`Strategic/Strategic_Turns.cc:64-84`), with the world-seconds clock
(which stops during turn-based combat, `Strategic/Game_Clock.cc:616-617`). ja2-node campaigns use the world clock; the
sandbox counts `explosives.worldMs` (deviations.md "World clock for smoke and light").

```
clear fHitByGasFlags on all mercs
pass 1, per cloud:
  in combat: update = TRUE (n = 1); real time: if now − lastUpdate > 10 s: update = TRUE, n = (now − lastUpdate)/10
  // update and n are function-scope and never reset: once one cloud updates, every later cloud does too (quirk, vanilla too)
  if update: lastUpdate = now; repeat n: age++
               age == 1 → mark
               age ≤ duration → mark, radius++ if < maxRadius
               else → SpreadEffect(ERASE) with the current radius, free the slot, stop
  else: SpreadEffect(REDO)                          // damage only, no new tiles
pass 2: marked clouds → SpreadEffect(sub = TRUE): add tiles for the new radius, gas everyone not hit this round; unmark
AllTeamsLookForAll(TRUE)
```

Tear/mustard grenade outdoors (1/4/5): radius 1 (age 0–1), 2, 3, 4, 4; erased at age 6; indoors erased at age 9. In real
time the cloud ages about every third 5-s turn (the strict `> 10` s), while REDO gasses its occupants every turn
(inferred).

### 11.3 Gas damage (`DishOutGasDamage`, `Explosion_Control.cc:747-856`)

```
wound  = dmg + PreRandom(dmg);  breath = 100·(bd + PreRandom(bd/2))       // drawn first, even for invalid targets
return if inactive, dead, robot (affectsRobot is dead code), no damage, monster vs !affectsMonsters,
          or (sub && already hit by this type this round)
mask = GASMASK in HEAD1 else HEAD2 with status ≥ 10, unless ignoresGasMask:
  status < 70: breath = breath·(100 − st)/100; breath > 500 → SOLDIER_GASSED
               PCs only: wound > 1 → st −= Random(4), wound = wound·(100 − st)/100; wound == 1 → st −= Random(2)
  status ≥ 70: breath = 0; wound 1 → st −= Random(2); wound > 1 → st −= Random(4); wound = 0
if wound || breath: set HIT_BY_{CREATURE,TEAR,MUSTARD}GAS; SoldierTakeDamage(wound, breath, TAKE_DAMAGE_GAS);
                    battle sound if conscious; PC-attack implications
```

Tear gas: breath 2000–2900, no wound; mustard: wound 15–29, breath 4000–5900; creature gas: wound 5–9 through masks.

### 11.4 Entering gas, the gassed state, sight

- Each tile step (`pathIndex > 0`): if the tile has any smoke flag **and `PreRandom(5) == 0`** and no mask with status ≥ 70
  (or the gas ignores masks) and the gas damages and has not hit him this round → `EVENT_StopMerc` + `DishOutGasDamage`
  (`Tactical/Overhead.cc:1433-1472`, before the mine check at `:1782`).
- `SetSoldierGridNo` onto **any** smoke tile without a mask ≥ 70 sets `SOLDIER_GASSED` (`Soldier_Control.cc:2066-2072`);
  `EVENT_BeginMercTurn` clears it with a mask or off smoke (`:4044-4053`). Gassed: CTH −50 (`AIM_PENALTY_GASSED`), melee
  −50, no interrupts, no AP→breath regain, FOV range 1 (`Tactical/FOV.cc:246`). ja2-node keeps these flags per soldier id
  in `explosives` (deviations.md "Gassed soldiers").
- Sight (`08` §1.4, §2.1): standing in tear/mustard without a mask (or in a mask-ignoring gas) caps sight at 2 tiles
  (`Tactical/OppList.cc:1019-1028`); LOS through smoke (`Tactical/LOS.cc:1247-1283`): SMOKE blocks after 3 tiles,
  tear/mustard cost 2 tiles of range per tile, creature gas does not block. ja2-node models neither the sight cap nor
  the smoke LOS terms (gaps.md "Vision and hearing modifiers").

### 11.5 Light (flares) (`TileEngine/LightEffects.cc`)

25 slots. `NewLightEffect(grid, radius, duration)`: age 0, light sprite `"Light{radius}"` (`J:light-templates.json`
Light0..Light6), **`AllTeamsLookForAll(FALSE)` at once**. `DecayLightEffects` (same callers as smoke): only when
`now − lastUpdate > 350` world seconds, `n = Δ/350` steps: `age++`; `age ≥ duration` → delete; odd age → radius−−;
radius 0 → delete; else rebuild; then sight. A flare (6/6) lasts six steps ≈ 35 min of real time and **never decays
during turn-based combat** (stopped clock, inferred). Sources: BREAK_LIGHT thrown to the ground, TRIP_FLARE from the bomb
queue. The light itself is the lighting model of `20`.

---

## 12. Mines and booby traps

The original's rules; ja2-node does not simulate them. Map mines load armed (BURIED, armed-bomb flag, §6.2) but never go
off; there is no planting or disarming command, no timed or remote bomb, no `DecayBombTimers` and no explosive bomb
queue entry, no booby trap on pickup (gaps.md "Map items", "Duds and timed bombs", "Unbuilt item actions",
"Turn-based hooks"). The pressure action items and switches that `25` §6.5 needs do work, and `useRemote` only opens
the O3 statue (`src/sim/tactical/narrative/statue.ts`).

- **Arming** (`ArmBomb`, `Tactical/Items.cc:2672-2763`): ACTION_ITEM → remote (pits: pressure); DETONATOR → timed
  (`bDelay = setting`, +1 in real time); REMDETONATOR → remote frequency; pressure-triggered explosive (MINE,
  TRIP_FLARE, TRIP_KLAXON) → pressure; SWITCH → pressure or switch; sets `OBJECT_ARMED_BOMB`, `usBombItem = usItem`.
- **Player planting** (`Handle_Items.cc:939-962, 2590-2632`): pressure mine → `bTrap = min(10, expl/20 + exp/3)`,
  `ubBombOwner = id + 2`, BURIED, `MAPELEMENT_PLAYER_MINE_PRESENT`; detonator bombs need
  `PLANTING_(REMOTE_)BOMB_CHECK`: failure ≥ −20 → timer `+Random(3) − 1` (min 1), worse → immediate blast.
- **Map mines**: §6.2 step 5.
- **Stepping on a mine**: `SetOffBombsInGridNo` at tile arrival after the breath-collapse check, before noise
  (`Overhead.cc:1782-1788`; `01` §3.5); pressure bombs only; non-player soldiers only react to pressure explosives,
  players and militia ignore player-owned bombs; queues them and stops the walker (`Explosion_Control.cc:2165-2235`).
- **Timed bombs**: `DecayBombTimers` once per round / 5-s turn, `--bDelay == 0` → queue (`:2054-2094`). Remote and panic
  triggers: `SetOffBombsByFrequency` (`:2097-2162`; AI panic frequencies 125–127).
- **Booby traps on pickup**: `ContinuePastBoobyTrap` → `DISARM_TRAP_CHECK`; failure sets the bombs off or the MINI_GRENADE
  trap (`Handle_Items.cc:2735-2930`); detection `NearbyGroundSeemsWrong` (`:3051`; called per step, `07` §4.5, §4.7).
  Door traps: `35` §5.

---

## 13. Implementation in ja2-node

### 13.1 Content

- `src/content/items/items.ts`: `loadItemTable` / `parseItemTable` read `ITEM_TABLE_PATHS` (the five item files,
  `calibres.json`, `ammo-types.json`, `tables/item-tables.json`, both gun choice files) into `ItemTable {byIndex,
  byName, ordered, magazines, rules, gunChoice, helpTextCalibres}`. `ordered` is the container order of §1.1; a duplicate
  index is an error. `ItemDef` carries the common fields of §1.2 plus `weapon`, `magazine`, `armour`, `explosive` kind
  records; `handClass` (`nothing`, `pistol`, `rifle`) is derived for the animations.
- `rules.ts` (§1.7), `slot-limit.ts`, `explosions.ts` (`loadExplosionContent`: animations with frame counts, smoke
  effect types). `src/content/formats/object.ts` decodes the 36-byte record; `objectFromRecord` / `objectToRecord`
  (`src/sim/items/object.ts`) convert it. AP constants and `gubItemDroppableFlag` are named constants in the modules.
  The stub pack uses the same JSON with its own item texts (`stubs/text.ts`) and profile inventories
  (`stubs/profiles.json`).

### 13.2 State

`ItemObject` (`src/sim/items/object.ts`: `item`, `count`, `status[]`, the gun fields, `money`, `attachments[4]`, `flags`,
`trap`, `imprintId`, `keyId`); per soldier `inv` (19), `keyRing`, `weightCarriedAtTurnStart`, `camo` and the first-aid
fields; `TacticalState.worldItems` (§6.1), `keyTable`, `equipment` (`EquipmentState`, §8.7) and `explosives`
(`ExplosivesState`, `explosions/state.ts`: physics objects, anitiles, 25 smoke clouds, 25 light effects, smoke tile
flags per level, throw parameters, the per-soldier gas and blast flags, the sandbox's `worldMs`). Other sectors' items,
smoke clouds and light effects live in the campaign's sector diffs (`src/sim/campaign/sector-diff.ts`); saves `27` §1,
native import `14`.

### 13.3 Modules (`src/sim/tactical/` unless stated)

| Module | Contents |
|---|---|
| `src/sim/items/object.ts` | §2 without a soldier: creation, stacks, `damageObject`, magazines, attach/detach, `emptyWeaponMagazine` |
| `inventory.ts`, `soldier-inventory.ts`, `hand-item.ts`, `stack-cleanup.ts`, `item-merge.ts` | §3, §4.1, §7; `AttachObject` with a soldier and the merges (§2) |
| `combat/reload.ts` | §4.2 |
| `inventory-panel.ts`, `inventory-commands.ts`, `item-compatibility.ts`, `item-description.ts` | the cursor commands (§3.3, §5), slot hints, description box values |
| `first-aid.ts` | §5.1 |
| `world-items.ts`, `item-actions.ts`, `give.ts`, `toss.ts`, `item-placement.ts`, `item-reachability.ts`; `src/sim/campaign/map-inventory.ts`, `sector-loot.ts` | §6 |
| `equipment.ts`, `creation.ts`; `combat/death.ts` | §8; §9.1 |
| `explosions/explosion.ts`, `blast-damage.ts`, `structure-damage.ts`, `item-damage.ts`, `smoke.ts`, `light.ts` | §10, §11 (decay called from `turns/turns.ts`) |
| `explosions/throwing.ts`, `trajectory.ts`, `physics.ts`, `catching.ts` | throwing and launchers (`34` §0) |

### 13.4 Verification

Unit tests next to the modules. Oracle (`tools/oracle/README.md`): the `attach` probe ("Attachment AP"), inventories
in the `soldier` dumps, and the autoresolve setup level, which compares every created militia and enemy soldier's
inventory with status and ammo and so replays `GenerateRandomEquipment` ("Autoresolve"). Explosions, smoke and flares
have no probe.
