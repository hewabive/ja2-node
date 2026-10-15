<!-- Items, inventory and explosions: an implementable spec for M3. 2026-10-15.
Source: reference/stracciatella/src (same snapshot as docs 01–09), cross-checked against vanilla
(reference/vanilla/ja2/Build). Read-only research: nothing was built. Two throw-away scripts decoded Prof.dat and the A9
map items with our own parsers (src/content/formats); their outputs are quoted as (data). -->

# 12 — Items, inventory and explosions

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `X:` is `src/externalized/`, `V:` is vanilla
`Build/`, `J:` is `data/externalized/` (verbatim copy of the Stracciatella JSON). "(inferred)" marks conclusions not
traced end to end; everything else was read in the code. `Random` = our `main` stream, `PreRandom` = our `pre` stream
(`01` §3.6). Game options are Stracciatella's defaults: **reduced gun list** (`fGunNut = FALSE`), sci-fi on
(`GameSettings.cc:182-183`), `game.json` as shipped (`drop_everything: false`, `all_drops_visible: false`,
`enemy_weapon_minimal_status: 0`, `extra_attachments: false`). Item ids are the `ITEMDEFINE` enum
(`Tactical/Item_Types.h:221-615`); JSON `internalName`s equal the enum names.

## 0. Cheat sheet

- One item table indexed by item id (0..350). Behaviour is chosen by the **item class** bitmask (`IC_GUN`, `IC_AMMO`,
  `IC_GRENADE`, …) plus a few hard-coded item ids. Kind-specific data (weapon, magazine, armour, explosive) hangs off
  the item.
- An **`OBJECTTYPE`** is one inventory slot or one world item: 1..8 identical objects with a status each, or one gun with
  its loaded ammo, plus up to 4 attachments (§2).
- A soldier has **19 slots**: helmet, vest, legs, 2 face, 2 hands, 4 big pockets, 8 small pockets (§3).
- **Encumbrance** is a percentage of `EffectiveStrength × 500 g`; above 100 % it scales APs, agility and breath costs,
  sampled at turn start (§3.6).
- **Reload** = 5 AP (10 with a magazine of another size), swaps or tops off; the AI only reloads with same-size
  magazines (§4).
- World items live in per-tile **item pools**; visibility values gate what the player sees and can pick up (§6).
- Enemies get gear from **`GenerateRandomEquipment`**: gun table row by equipment rating, armour/helmet by coolness,
  grenades, kits; most of it is flagged undroppable by rolls (§8). Drops happen at the **end of the death animation** (§9).
- Explosions damage the whole radius at one animation key frame (125–1530 ms after ignition), wreck structures, chain
  into other explosives, and spawn smoke/gas clouds that grow and decay **per turn** (checked every 5 s in real time);
  flares fade over world time; planted bombs and mines go through a timed queue (§10–§12).

**(data) A9 and the sandbox squad.**

| What | Content |
|---|---|
| A9 map items (`MapDef.items`, 4) | CROWBAR 11013 (status 74, always), WIRECUTTERS 11489 (70, `ubNonExistChance` 30), BLOODY_THROWING_KNIFE 13358 (77, 35), CANTEEN 18143 (85, 45, flag `WORLD_ITEM_DONTRENDER`). All ground level, `bVisible = INVISIBLE` (−1), no traps. |
| Barry (0) | STEEL_HELMET 97, FLAK_JACKET 98, SW38 91 (hand), 5× CLIP38_6, TNT, DETONATOR, LOCKSMITHKIT |
| Grizzly (3) | STEEL_HELMET 99, FLAK_JACKET 100, DESERTEAGLE 92, 5× CLIP357_9, COMBAT_KNIFE 98 |
| Vicki (4) | STEEL_HELMET 99, KEVLAR_VEST 100, 2× M1911 → **GLOCK_17** (reduced guns), 6× CLIP45_7 → **CLIP9_15**, TOOLKIT 98, HAND_GRENADE |
| Ivan (7) | STEEL_HELMET 99, KEVLAR_VEST 99, MP53 97 → **MP5K**, 3× CLIP556_30_AP → **CLIP9_30_AP** (§7) |
| Fox (14) | STEEL_HELMET 98, FLAK_JACKET 94, GLOCK_17 99, 2× CLIP9_15, MEDICKIT |
| Gus (16) | KEVLAR_HELMET, KEVLAR_VEST, KEVLAR_LEGGINGS, G41, 4× CLIP556_30_AP, MEDICKIT (all 100) |

Profile slots are 0 helmet, 1 vest, 2 legs, 5 hand, 7.. pockets; `ubInvUndroppable` and `uiMoney` are 0 for all six.

---

## 1. The item model

### 1.1 Loading (`X:DefaultContentManager.cc:900-980`)

Order: `ammo-types` → `calibres` → `explosive-calibres` → `smoke-effects` → `explosion-animations` → `items.json` →
`magazines.json` → `weapons.json` → `explosives.json` → `armours.json` (`:907-918`), then `loadMaxArmourPerClass`
(`:980`).

- All items go into **one container** `m_items` keyed by `itemIndex` and by `internalName` (both unique,
  `X:containers/Containers.h:129-178`). Iteration order is **insertion order**; the views `getMagazines()`,
  `weapons()`, `explosives()`, `armours()` filter `m_items` in that order (`:921-924`). The order matters for
  `DefaultMagazine`, `RandomMagazine`, `FindReplacementMagazine`, `FindAmmoToReload` (launchables) and
  `GetLauncherFromLaunchable` — keep the JSON order.
- Item 0 `NOTHING` (`IC_NONE`) is added first (`:657`). `items.json` entries must have index 71..350; `IC_NONE`,
  grenades/bombs and armour there are ignored (`:655-686`). `weapons.json` entries of type `NOWEAPON` are `IC_NONE` and
  dropped (`:531-534`); magazines and calibres named `NOAMMO` are skipped (`:693-700, 718-721`).
- Names and descriptions come from `binarydata/itemdesc.edt` (80+80+240 UTF-16 chars per item, by `itemIndex`) unless
  the JSON gives `name`/`shortName`/`description` (`X:ItemModel.cc:167-193`). That file is original data: the content
  importer reads it, nothing in the simulation needs it.

### 1.2 Common item fields (`X:ItemModel.h:21-152`, `items.json`)

| Field | Used by the tactical game for |
|---|---|
| `usItemClass` | everything: `IC_*` bits (`Item_Types.h:145-177`); `IC_WEAPON` = gun, blade, throwing knife, launcher, tentacles; `IC_EXPLOSV` = grenade, bomb |
| `ubCursor` | `HandleItem` dispatch: `REMOTECURS`, `BOMBCURS`, `TOSSCURS`, `INVALIDCURS` (§5); `ubClassIndex` is unused |
| `ubWeight` | hectograms (×100 g): carried weight (§3.6), throw range (§10.8) |
| `ubPerPocket` | 0 = big pockets/hands only; stack size in big pockets, halved in small pockets (§3.2); weight multiplier |
| `bReliability` | weapon wear chance `1/(15 + 3·rel)` per shot (`Tactical/Weapons.cc:871-875`); unjam skill modifier ×4 (`:298-299`) |
| `ubCoolness` | enemy gear choice (§8), dealers, Bobby Ray |
| `usPrice`, `bRepairEase` | strategic only |
| flags | see below |
| `inventoryGraphics`, `tileGraphic` | client only |

Flags (`Item_Types.h:180-211`, JSON `bDamageable` …, `X:ItemModel.cc:321-341`):
`ITEM_DAMAGEABLE` (breaks in hand §5, explosion damage §10.7), `ITEM_REPAIRABLE`, `ITEM_WATER_DAMAGES` (deep water,
`Tactical/Items.cc:3315-3337`), `ITEM_METAL` (metal detector), `ITEM_SINKS` (vanishes when dropped into water,
`Tactical/Handle_Items.cc:1451-1455`), `ITEM_SHOW_STATUS`/`ITEM_HIDDEN_ADDON` (UI), `ITEM_TWO_HANDED` (§3.3),
`ITEM_NOT_BUYABLE`, `ITEM_ATTACHMENT` (auto-attach on hiring, §7), `ITEM_BIGGUNLIST` (reduced-gun replacement),
`ITEM_NOT_EDITOR` (map item skipped at load, §6.2), `ITEM_DEFAULT_UNDROPPABLE` (creature weapons/hides: object gets
`OBJECT_UNDROPPABLE` at creation, `Tactical/Items.cc:2633-2636`), `ITEM_UNAERODYNAMIC` (toss range 1),
`ITEM_ELECTRONIC`, `ITEM_INSEPARABLE` (attachment cannot be removed, `Tactical/Items.cc:2823-2826`).

### 1.3 Weapons (`X:WeaponModels.cc:153-664`, `weapons.json`, 66 entries)

`internalType` picks the class, cursor and weapon class (`Tactical/Weapons.h:45-56`); the constructors fix the rest:

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
`ubShotsPer4Turns` (AP per shot, `Points.cc:1006-1049`), `ubShotsPerBurst` (> 0 means burst-capable,
`Tactical/Weapons.cc:3517-3522`), `ubBurstPenalty`, `ubBulletSpeed`, `ubImpact`, `ubDeadliness` (AI and enemy gear),
`ubMagSize`, `usRange` (units of 1/10 tile; barrel extender and silencer modify it, `Weapons.cc:86-103`),
`ubAttackVolume`, `ubHitVolume`, the eight `attachment_*` booleans and `standardReplacement`/`bBigGunList`.
`usReloadDelay` is always 200 and unused; `rateOfFire` is Bobby Ray text only. Sounds default to the calibre's.

- `matches(calibre)`: same calibre index. `matches(mag)`: same calibre **and** `capacity == ubMagSize`
  (`X:WeaponModels.cc:666-688`). `EXPLOSIVE_GUN(x)` = ROCKET_LAUNCHER or TANK_CANNON (`Item_Types.h:215`).
- `canBeAttached`: SILENCER, SNIPERSCOPE, LASERSCOPE, BIPOD, DUCKBILL, UNDER_GLAUNCHER, SPRING_AND_BOLT_UPGRADE,
  GUN_BARREL_EXTENDER per flag (`:691-702`).
- Reduced gun list: 18 guns and 6 magazines carry `bBigGunList` + `standardReplacement` (e.g. M1911 → GLOCK_17, MP53 →
  MP5K, AKM → G41, CLIP545_30_AP → CLIP556_30_AP). Replaced on map load (§6.2), in profiles (§7) and in enemy gear
  (`ReplaceExtendedGuns`, §8).

### 1.4 Calibres, ammo types, magazines (`X:MagazineModel.cc`, `X:CalibreModel.h`, `magazines.json` 45 entries)

- Ammo types (`ammo-types.json`, = `Tactical/Weapons.h:68-83`): 0 REGULAR, 1 HP, 2 AP, 3 SUPER_AP, 4 BUCKSHOT,
  5 FLECHETTE, 6 GRENADE, 7 MONSTER, 8 KNIFE, 9 HE, 10 HEAT, 11 SLEEP_DART, 12 FLAME. Their damage/armour factors are
  hard-coded macros (`Weapons.h:85-105`).
- Calibres: 1 AMMO38, 2 AMMO9, 3 AMMO45, 4 AMMO357, 5 AMMO12G, 6 AMMOCAWS, 7 AMMO545, 8 AMMO556, 9 AMMO762N,
  10 AMMO762W, 11 AMMO47, 12 AMMO57, 13 AMMOMONST, 14 AMMOROCKET, 15 AMMODART, 16 AMMOFLAME.
- Magazine = item (`IC_AMMO`) with `calibre`, `capacity`, `ammoType`, `dontUseAsDefaultMagazine` (CLIP12G_7,
  CLIPCAWS_10_SAP). Item ids 71..115; sizes of one calibre sit at **adjacent ids** (CLIP9_15 = 71, CLIP9_30 = 72),
  which `ReloadGun` relies on (§4.1).
- `DefaultMagazine(gun)`: first magazine in container order with the gun's calibre and `capacity == ubMagSize` and not
  `dontUseAsDefaultMagazine`; throws if none (`Tactical/Items.cc:2437-2460`).
- `FindReplacementMagazine(calibre, size, ammoType)`: exact ammo type, else the first match of calibre and size
  (`:2463-2481`). `FindReplacementMagazineIfNecessary(oldGun, oldAmmo, newGun)` only replaces magazines that fitted
  the old gun (`:2484-2491`).
- `RandomMagazine(gun, pctStandard)`: candidates = magazines that `matches` the gun, in order; one candidate → it;
  otherwise `Random(100) < pct` → index 0, else `1 + Random(n−1)` (`:2494-2542`, main stream).

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
  65/15/25, `:152-200`, used by blasts §10.4); `ArmourProtection`/`TotalArmourProtection` for bullets (PreRandom
  weak-spot roll, plates first, armour destroyed below `USABLE`, `:2588-2741`) belong to the combat spec.

### 1.6 Explosives (`X:ExplosiveModel.cc`, `explosives.json` 30 entries)

See §10.1 for the fields and their values.

### 1.7 Hard-coded tables (`Tactical/Items.cc:53-217`) — transcribe into `data/tables/`

| Table | Content |
|---|---|
| `AttachmentInfo` (`:66-91`) | attachment → host class and skill check: SPRING_AND_BOLT_UPGRADE and GUN_BARREL_EXTENDER need `ATTACHING_SPECIAL_ITEM_CHECK`, DETONATOR `ATTACHING_DETONATOR_CHECK`, REMDETONATOR the remote check −10, XRAY_BULB/COPPER_WIRE electronic −15/+20; the rest `NO_CHECK` |
| `g_attachments` (`:93-104`) | non-model attachments: (REM)DETONATOR → TNT, HMX, C1, C4; SPRING → ALUMINUM_ROD; QUICK_GLUE, DUCT_TAPE → STEEL_ROD; XRAY_BULB, CHEWING_GUM → FUMBLE_PAK; BATTERIES → XRAY_DEVICE; COPPER_WIRE → LAME_BOY |
| `CompatibleFaceItems` (`:106-116`) | NIGHT/SUN/UV goggles or GASMASK may share the face with EXTENDEDEAR or WALKMAN; nothing else pairs |
| `Merge` (`:139-198`) | kit/drink `COMBINE_POINTS`; COMPOUND18 / JAR_QUEEN_CREATURE_BLOOD `TREAT_ARMOUR` (→ `_18` / `_Y`, or `DESTRUCTION` on the other treatment); RDX+TNT → HMX, RDX+C1 → C4 (`EXPLOSIVE`); STRING+TIN_CAN (`EASY_MERGE`); FLASH_DEVICE+DISPLAY_UNIT → XRAY_DEVICE (`ELECTRONIC_MERGE`). Same-id ammo merges as `COMBINE_POINTS` (`:786-809`) |
| `AttachmentComboMerge` (`:211-217`) | ALUMINUM_ROD+SPRING → SPRING_AND_BOLT_UPGRADE; STEEL_ROD+QUICK_GLUE+DUCT_TAPE → GUN_BARREL_EXTENDER; FUMBLE_PAK+XRAY_BULB+CHEWING_GUM → FLASH_DEVICE; LAME_BOY+COPPER_WIRE → DISPLAY_UNIT |

- `ValidAttachment(a, item)` = the item model's `canBeAttached` (weapons §1.3, vest plates §1.5) or `g_attachments`
  (`:628-643`). `ValidItemAttachment` adds: a gun with UNDER_GLAUNCHER accepts 40 mm grenades; no duplicate attachment;
  BIPOD and UNDER_GLAUNCHER exclude each other; DETONATOR and REMDETONATOR exclude each other (`:646-722`).
- `ValidLaunchable(l, w)`: `l` is an explosive with an explosive calibre that weapon `w` matches (`:747-763`).
- `ValidAmmoType(gun, ammo)`: gun calibre = magazine calibre, any size (`:725-732`).

### 1.8 Proposed content shape

`src/content/items/` grows from `weapons.ts` into one `ItemTable`: `items[id] = { id, name, cls, cursor, weight,
perPocket, coolness, reliability, flags, weapon?, magazine?, armour?, explosive? }`, built from the five JSON files in
the load order above, plus the transcribed tables of §1.7 and the calibre/ammo-type/smoke/explosion-animation lists.
Keep `handClass` as a derived helper. All of it is DOM-free content (`01` layers).

---

## 2. `OBJECTTYPE` (`Tactical/Item_Types.h:55-141`)

36 bytes, little-endian; the same layout is embedded in `WORLDITEM` (map items, §6.1) and in detailed placements
(`06` §7.1), so one decoder serves all three.

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
round status); **stack** `bStatus[8]` / `ubShotsLeft[8]` at 4..11 (one value per object; for a magazine stack it is the
rounds in each magazine); **money** `bMoneyStatus` 4, `uiMoneyAmount` u32 8; **bomb** `bBombStatus` 4,
`bDetonatorType` 5 (1 timed, 2 remote, 3 pressure, 4 switch), `usBombItem` 6, `bDelay`/`bFrequency` 8, `ubBombOwner`
9 (soldier id + 2), `bActionValue` 10, `ubTolerance` 11; **key** `bKeyStatus[6]` 4, `ubKeyID` 10; **ownership**
`ubOwnerProfile` 4, `ubOwnerCivGroup` 5.

Rules:
- Status is a percentage 1..100; `USABLE = 10` is the floor for use (`Item_Types.h:36`). `bStatus[0]` doubles as
  `bGunStatus`. `DamageObj` clamps at 1 (`Tactical/Items.cc:956-966`).
- **Creation** `CreateItem(item, status)` (`:2592-2637`): clear; guns via `CreateGun` (`:2545-2581`): status, imprint
  `NO_PROFILE`, loaded with a **full `DefaultMagazine`** (monster weapons: `ubMagSize` rounds, ammo type MONSTER;
  ROCKET_LAUNCHER 1 shot, cannon 0), `bGunAmmoStatus = 100`; magazines full (`:2584-2589`); MONEY: amount = status·50;
  everything else `bStatus[0] = status`. A status outside 1..100 is replaced by 70. `ITEM_DEFAULT_UNDROPPABLE` → flag.
  `CreateItems(item, status, n)` copies `bStatus[0]` into slots 1..n−1 (`:2640-2662`).
- Stack operations: `RemoveObjFrom`, `RemoveObjs`, `GetObjFrom`, `StackObjs`, `PlaceObjectAtObjectIndex` shift the
  status array (`:883-1074`). `CleanUpStack` (ctrl-click) pools points of ammo/kits/medkits into fewer objects
  (`:990-1050`).
- **Attach** `AttachObject(s, target, att, indexInStack)` (`:1515-1727`): launchables replace a launchable of the same
  class (refused for a stack of grenades); other attachments replace the same item or take the first free slot. If a
  soldier does it, `AttachmentInfo` skill checks run (`SkillCheck` draws `PreRandom(100)`, `Tactical/SkillCheck.cc:342`);
  failure damages both items by the margin. UNDER_GLAUNCHER carries its loaded grenade over. Combo merges fire after.
  Otherwise try **merges**: non-`COMBINE_POINTS` merges cost `AP_MERGE` 8; `COMBINE_POINTS` moves points into
  `bStatus[indexInStack]` up to 100 (magazines: capacity); explosive and electronic merges need a skill check −30;
  default merges average the statuses (not for `TREAT_ARMOUR`).
- `RemoveAttachment` refuses `ITEM_INSEPARABLE`; removing a UNDER_GLAUNCHER takes its grenade along (`:2810-2856`).

---

## 3. Soldier inventory

### 3.1 Slots (`Tactical/Soldier_Control.h:226-249`)

`0 HELMETPOS, 1 VESTPOS, 2 LEGPOS, 3 HEAD1POS, 4 HEAD2POS, 5 HANDPOS, 6 SECONDHANDPOS, 7..10 BIGPOCK1..4POS,
11..18 SMALLPOCK1..8POS`. Profile/placement inventories use the same 19 indices.

### 3.2 What can go where (`CanItemFitInPosition`, `Tactical/Items.cc:1730-1825`; `ItemSlotLimit`, `:273-289`)

- HELMET/VEST/LEG: armour of the matching class only. HEAD1/HEAD2: `IC_FACE` only, and the pair must be
  `CompatibleFaceItem` (checked in `PlaceObject`, `:1897-1915`).
- SECONDHANDPOS: refused while the main hand holds a two-handed item.
- HANDPOS with a two-handed item while both hands are full: the second-hand item is first moved to an empty big pocket
  (if its `ubPerPocket == 0`) or any empty pocket (big first); no room → refused.
- Slot limit: slots 0..6 hold 1; big pockets hold `ubPerPocket`; small pockets `ubPerPocket/2` when > 1 (so 1 stays 1,
  0 stays 0). A limit of 0 is refused in small pockets only — big pockets and hands take any single object.
- Money: 20 000 per big pocket/hand slot, 10 000 per small pocket (`MoneySlotLimit`, `:292-302`).

### 3.3 Placing (`PlaceObject`, `:1882-2083`) and auto-placing (`InternalAutoPlaceObject`, `:2086-2301`)

`PlaceObject(s, pos, obj)` returns whatever must stay in the cursor in `obj`:
1. Fit check (above). Keys: record `KeyTable` discovery (`:1849-1859`).
2. Empty slot: move `min(count, max(limit, 1))` objects in; if a two-handed item landed in HANDPOS, the second-hand item
   is swapped out into `obj`.
3. Same item (keys: same key id): money tops up; limit ≤ 1 (or 0 in hands/big pockets) swaps a single object, a stack
   is first auto-placed elsewhere (`DropObjIfThereIsRoom`, `:1828-1846`, excludes the slot itself); otherwise stack up
   to the limit.
4. Different item: ammo onto a gun of its calibre, or a launchable onto its launcher, **reloads** (`ReloadGun`, §4);
   a two-handed item into HANDPOS swaps only if SECONDHANDPOS is empty; otherwise swap if the object fits, else
   `DropObjIfThereIsRoom`.
5. Face items re-run sight (`HandleSight`); `EnsureConsistentWeaponMode` (`Tactical/Weapons.cc:3747-3765`).

`AutoPlaceObject(s, obj, newItem)`:
1. One-handed `IC_GUN|BLADE|LAUNCHER|BOMB|GRENADE` → empty HANDPOS, else empty SECONDHANDPOS if the main hand is not
   two-handed. Armour → its empty body slot. Face → HEAD1 then HEAD2 if compatible.
2. `ubPerPocket == 0`: first empty slot in HANDPOS..BIGPOCK4POS (SECONDHANDPOS only if HANDPOS is empty).
3. Otherwise: if stackable (`ubPerPocket > 1`, keys, money) top up slots already holding the item (HANDPOS..SMALLPOCK8);
   then empty small pockets; then empty HANDPOS..BIGPOCK4POS. Returns whether everything was placed.

`FindEmptySlotWithin` skips SECONDHANDPOS behind a two-handed main hand (`:467-486`). `SwapHandItems` (`:3286-3312`)
moves the main-hand item to a pocket first if the second hand holds a two-handed item.

**Moving items inside one soldier's inventory is free** in combat; handing an item to another merc through the panel
needs 3 AP and charges 2 AP to each conscious party (`Tactical/Interface_Panels.cc:1673-1712, 1549-1561`); tossing to a
merc in range charges 3 + 3 (`Tactical/Interface_Items.cc:3404-3420`).

### 3.4 Hands

- HANDPOS is the active weapon. Dual pistols: `IsValidSecondHandShot` = both hands `IC_GUN`, second one-handed,
  `bGunStatus ≥ USABLE`, shots left, not bursting (`Tactical/Soldier_Control.cc:8624-8633`); readying both costs
  `AP_READY_DUAL` 1.
- Weapon modes `WM_NORMAL → WM_BURST → WM_ATTACHED` (UGL with a grenade attached) (`Weapons.cc:3770-3811`).
- AI: `RearrangePocket` is a **free swap** (`TacticalAI/AIUtils.cc:2013-2017`); `CanNPCAttack` swaps the first usable
  weapon into HANDPOS and a second one-handed gun into SECONDHANDPOS (`TacticalAI/Attacks.cc:1573-1592`);
  `FindAIUsableObjClass` skips `OBJECT_AI_UNUSABLE`, status < USABLE and, for `IC_GUN`, EXPLOSIVE_GUNs
  (`Tactical/Items.cc:420-444`). `WearGasMaskIfAvailable` swaps a gas mask to the face (`AIUtils.cc:1566-1577`).

### 3.5 Keys

PCs collect keys on a key ring (`pKeyRing`, `KEY_ON_RING {ubKeyID, ubNumber}`), managed by the UI
(`Tactical/Items.cc:2324-2391`); key objects store `ubKeyID`. Enemies "with keys" and profiled NPCs hold key items in
pockets (`Tactical/Soldier_Create.cc:1993-2013`). Doors are `07`'s business.

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
odd strengths; follow Stracciatella.

Effects (all integer):
- `s.sWeightCarriedAtTurnStart = percent` at `EVENT_BeginMercTurn` (`Tactical/Soldier_Control.cc:4061`), before
  `CalcNewActionPoints` (`:4073`). It starts at 0 (inferred: `InitSoldierStruct` zeroes the struct).
- **APs**: if > 100, `ap = ap·100/percent` after the wound and breath reductions, before the 10..max clamp
  (`Soldier_Control.cc:352-355`).
- **Agility**: `EffectiveAgility = drunkAgility·100/percent` if > 100 (`SkillCheck.cc:35-40`) — feeds APs, interrupts,
  CTH, everything.
- **Breath**: `BreathPointAdjustmentForCarriedWeight` = 100 up to 100 %; `100 + 3·(p−100)` up to 150; `+ (p−150)` up to
  200; `+ (p−200)` above (`Tactical/Points.cc:117-151`; the comments say 1 %/2 %/3 %, the code says 3/4/5). Terrain
  breath cost ×adj/100 (`:195`); unused-AP breath recovery ×100/adj (`:674, 746`).
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

Notes: real-time reloads are free and top off instead of swapping; a partially used magazine of a different size is
consumed into the gun but the gun records the neighbouring magazine id. `EmptyWeaponMagazine` (UI unload) turns the
loaded rounds back into a magazine object and keeps `usGunAmmoItem` (`:1315-1345`).

### 4.2 Which magazine is used

- `FindAmmoToReload(s, slot, exclude)` (`:1365-1415`): gun → the slot holding the **same magazine item** as last loaded
  (any slot 0..18), else same calibre and size from HANDPOS on (`FindAmmo`, `:1348-1362`), else same calibre any size.
  Launcher → for each launchable explosive in container order with its calibre, the first slot holding it.
- `AutoReload` (`:1418-1463`, the reload hotkey) reloads HANDPOS; then SECONDHANDPOS if
  `IsValidSecondHandShotForReloadingPurposes` and the APs suffice. `GetAPsToAutoReload` mirrors it for the cursor
  (`Points.cc:1451-1516`).
- **AI**: `CanNPCAttack` → `OKToAttack` → on `NOSHOOT_NOAMMO`, `TryToReload` = `FindAmmo(calibre, ubMagSize)` and
  `ReloadGun` (`TacticalAI/Attacks.cc:1544-1551, 1569-1573`): same size only, APs charged in combat.
- Firing: `EnoughAmmo` (`Points.cc:1322-1350`; launchers need an attached grenade/bomb; `WM_ATTACHED` always true);
  `DeductAmmo` decrements `ubGunShotsLeft` or removes the launcher's attached round (`:1353-1405`). Jams (PCs only,
  PreRandom, `bGunAmmoStatus` negated) and wear (`!PreRandom(15 + 3·reliability)` → status −1, `Weapons.cc:871-875`)
  belong to the combat spec (`Weapons.cc:245-321`).
- A fired ROCKET_LAUNCHER becomes DISCARDED_LAW with the same status (`Weapons.cc:791, 828`).

---

## 5. Item use AP costs (`Tactical/Points.h`)

| Action | AP | Breath | Source |
|---|---|---|---|
| Reload / unload attachment / attach (item box) | 5 (`AP_RELOAD_GUN`); 10 with a wrong-size magazine | – | `Points.cc:1432-1448`; `Interface_Items.cc:1987, 2001, 2585` |
| Pick up item | 3 (`AP_PICKUP_ITEM`) + path cost | – | `Handle_Items.cc:1295-1297`; `Points.cc:1417-1423` |
| Give item (to adjacent soldier) | 1 (`AP_GIVE_ITEM`) + path | – | `Points.cc:1426-1429` |
| Drop item | 0 (animation only) | – | `Handle_Items.cc:970-984` |
| Toss item (non-explosive throw) | 8 (`AP_TOSS_ITEM`), charged at the release frame | – | `Soldier_Ani.cc:857-866` |
| Throw grenade | `MinAPsToThrow` (+ aim): `AP_CHANGE_TARGET` 1 if new target + stance→stand + `(100·2·fullAP / (18·(50+dex/2)/10) + 1)/2`, capped at full APs | – | `Points.cc:1692-1742` |
| Fire launcher | `MinAPsToShootOrStab` + aim (combat spec) | | `Points.cc:1081` |
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
actions comes only from the per-animation breath rates (`GetBreathPerAP`, `Points.cc:764-840`).

**Hand item breakage** (`HandItemWorks`, `Tactical/Handle_Items.cc:2639-2696`), run by every `HandleItem` call before
anything else: for an `ITEM_DAMAGEABLE` hand item that is not a pressure explosive, medkit or gas can — status <
`USABLE` → fails; else `Random(80) + 20 ≥ status + 50` → **breaks**, status = `1 + Random(9)` (main stream; only
items below 50 % can break). A working main-hand gun also checks a loaded second-hand gun.

---

## 6. World items

### 6.1 Records (`Tactical/World_Items.h:10-35`)

`WORLDITEM` (52 bytes, raw in map files): `fExists` 0, `sGridNo` i16 2, `ubLevel` 4, `o` OBJECTTYPE 8..43, `usFlags`
u16 44 (`DONTRENDER 0x01`, `FIND_SWEETSPOT_FROM_GRIDNO 0x02`, `ARMED_BOMB 0x40`, `SCIFI_ONLY 0x80`, `REALISTIC_ONLY
0x100`, `REACHABLE 0x200`, `GRIDNO_NOT_SET_USE_ENTRY_POINT 0x400`), `bRenderZHeightAboveLevel` i8 46, `bVisible` i8 47,
`ubNonExistChance` 48. `src/content/formats/map.ts` already exposes these plus `raw`; decode `o` with the §2 table.

`gWorldItems` is a vector of slots reused first-free (`World_Items.cc:122-134`); `gWorldBombs` indexes armed bombs.
Per tile and level an **item pool** is a linked list in insertion order (`Handle_Items.cc:1427-1629`).

Visibility (`Handle_Items.h:28-37`): `HIDDEN_ITEM −4` (needs a search on the tile), `BURIED −3` (armed bombs, pits),
`HIDDEN_IN_OBJECT −2` (closed openable), `INVISIBLE −1` (not yet seen), `VISIBLE 1`.

### 6.2 Loading map items (`LoadWorldItemsFromMap`, `World_Items.cc:215-350`)

For each record in file order (skipped entirely when the sector was visited before — saved items come from the save):
1. OWNERSHIP items get `ubNonExistChance = 0`.
2. **`PreRandom(100) < ubNonExistChance` → skip.** The draw happens for **every** record, chance 0 included (`:244`).
3. Skip `REALISTIC_ONLY` items (sci-fi on); apply `tactical-map-item-replacements.json` (empty); skip `ITEM_NOT_EDITOR`.
4. Reduced guns: big-list gun → replacement, `shots = newMag·shots/oldMag`, at least 1 if it had any; big-list magazine
   → replacement, each status scaled `·newCap/oldCap` (`:272-303`).
5. Pits: disarmed and BURIED. Pressure-triggered explosive with `bVisible == HIDDEN_ITEM` and `bTrap > 0`: armed
   (`BOMB_PRESSURE`), `ARMED_BOMB` flag, `MAPELEMENT_ENEMY_MINE_PRESENT` on the tile. Armed bombs are BURIED.
6. `AddItemToPool(grid, o, bVisible, level, flags, zHeight)`; then terrorist/queen ownership clean-ups (`:353-430`).

### 6.3 `AddItemToPool` (`Handle_Items.cc:1427-1629`)

- `NOWHERE` → map centre (logged). **Water + `ITEM_SINKS` → item destroyed** (returns −1).
- Level 1 without a flat roof above → level 0.
- `zHeight == −1` means "force on ground". A blocking structure on the tile at that level (not person/corpse; OWNERSHIP
  and ACTION_ITEM ignore structures): the item moves to the structure's base tile; an **openable** sets
  `DONTRENDER`, `HIDDEN_IN_OBJECT` while closed, z = structure height; a `STRUCTURE_GENERIC` puts the item on top at its
  densest level and sets `STRUCTURE_HASITEMONTOP`.
- SWITCH items become BURIED pressure/switch triggers; pits mark `MAPELEMENT_ENEMY_MINE_PRESENT`.
- Appends to the pool, sets `MAPELEMENT_ITEMPOOL_PRESENT`.

### 6.4 Seeing and finding items

- A player soldier's sight sweep reveals every non-OWNERSHIP, non-ACTION_ITEM item with `bVisible ≥ INVISIBLE` on each
  tile it sees: `SetItemsVisibilityOn(tile, level, INVISIBLE, …)` (`Tactical/FOV.cc:539-548`;
  `Handle_Items.cc:1792-1827`). In combat a newly seen item halts the mover (`HaultSoldierFromSighting`, `FOV.cc:557-560`).
  Hidden/buried items are not revealed by sight.
- Opening an openable reveals its items (`TileEngine/Interactive_Tiles.cc:164`); closing hides them again (`:181`).
- Picking up on a tile with only `HIDDEN_ITEM`s, or after any pickup, `LookForHiddenItems` makes them visible
  (+5 wisdom) (`Handle_Items.cc:1675-1691, 1272-1281, 1356-1362`).
- Display and player pickup need `VISIBLE` and the right z level (`ItemPoolOKForDisplay`/`ItemPoolOKForPickup`,
  `:1961-2009`); enemies pick up regardless of visibility.

### 6.5 Picking up (`Handle_Items.cc:1104-1371`; `Soldier_Control.cc:8131-8237`)

1. `SoldierPickupItem`: target tile = `AdjustGridNoForItemPlacement` (blocked or occupied tile → adjacent tile,
   `:2501-2527`); set pending action `MERC_PICKUPITEM`; walk there if needed.
2. `PickPickupAnimation`: other tile → `ADJACENT_GET_ITEM`; same tile standing → `PICKUP_ITEM` (raised openables use
   `ADJACENT_GET_ITEM` facing the structure); crouched, prone or in water → immediate, no animation.
3. Animation code **493** (`Soldier_Ani.cc:1554-1563`) → `HandleSoldierPickupItem`: no pool → "nothing";
   enemies take the given item directly; a player tile with `MAPELEMENT_PLAYER_MINE_PRESENT` asks to disarm; several
   visible items open the pickup menu (UI).
4. `SoldierGetItemFromWorld` (`:1174-1305`): per item `ContinuePastBoobyTrap` (trap check, `:2735-2811`), SWITCH asks
   to activate, else `RemoveItemFromPool` + `AutoPlaceObject`; an item that does not fit goes to the cursor (players)
   and the pickup is then free (`gfDontChargeAPsToPickup`). Charges `AP_PICKUP_ITEM` once.

### 6.6 Dropping, giving, tossing

- Drop: object copied to `pTempObject`; standing → `DROP_ITEM` animation, code **487** adds it `VISIBLE` at the
  soldier's tile (`zHeight −1`); crouched/prone → immediate (`Handle_Items.cc:970-984, 1097-1101`;
  `Soldier_Control.cc:8240-8256`).
- Give: walk adjacent, `MERC_GIVEITEM`, code **486** transfers (`Handle_Items.cc:1056-1094, 2306`).
- Toss (non-explosive): `THROW_ITEM`/`LOB_ITEM` animation, physics object, `AP_TOSS_ITEM` at code 460/461
  (`Handle_Items.cc:988-1053`).
- AI item search (`SearchForItems`, `TacticalAI/FindLocations.cc:1489-1676`): range from difficulty and attitude, capped
  at wisdom/10, halved in real time, then halved; scores better weapons/armour/ammo over all items in reach,
  discounted by `3/(3 + distance)`; may drop or destroy the hand item first.

---

## 7. What the profile inventory gives mercs

- Profile arrays (`Prof.dat`, record offsets): `bInvStatus[19]` 358, `bInvNumber[19]` 377, `ubInvUndroppable` 412,
  `inv[19]` u16 416, `uiMoney` u32 684 (`Tactical/LoadSaveMercProfile.cc:126-191`). JSON may override `inventory` and
  `money` (`X:mercs/MercProfile.cc:324-347`); the shipped `mercs-profile-info.json` only has a commented-out example.
- `InitProfileFromContent` (`Tactical/Soldier_Profile.cc:126-218`), reduced guns: every big-list gun is replaced by its
  `standardReplacement`, and every magazine that fitted the old gun (calibre **and** size) by
  `FindReplacementMagazine(newCalibre, newSize, sameAmmoType)` (`:161-183`). Examples (inferred from code + data): Vicki's
  M1911/CLIP45_7 become GLOCK_17/CLIP9_15; Ivan's MP53 (5.56, 30) becomes MP5K (9 mm, 30) and his CLIP556_30_AP becomes
  CLIP9_30_AP. Then `bMainGunAttractiveness`, `bArmourAttractiveness` and `usOptionalGearCost` (sum of prices).
- `CopyProfileItems` (`Tactical/Soldier_Create.cc:1981-2060`):
  - **Player team** (hiring with "buy equipment" from AIM, always for MERC/IMP, `Laptop/AIMMembers.cc:1194`,
    `Mercs_Files.cc:428`, `IMP_Confirm.cc:142`): clear the inventory, then for each profile slot in order
    `CreateItems(item, status, count)`, `TryToAttach` (an `ITEM_ATTACHMENT` item goes onto the first valid host,
    `:1963-1978`) or `AutoPlaceObject`. The profile slot indices are **not** kept. Without the option the merc arrives
    empty.
  - **Other teams** (profiled NPCs, Mike/Iggy as enemies): slot-for-slot copy; keys only for Brewster 19, Skipper 11,
    Doreen 32; ROCKET_RIFLE/AUTO_ROCKET_RIFLE imprinted; `ubInvUndroppable & gubItemDroppableFlag[slot]`
    (`0x01,0x02,0x04,0,0,0x08,0,0x10,0x20,0x40,0x80,0…`, `:75-96`) → `OBJECT_UNDROPPABLE`; money split over empty
    pockets by `MoneySlotLimit`.

---

## 8. Enemy and militia equipment (`Tactical/Inventory_Choosing.cc`)

All draws are **`Random`** (main stream), none PreRandom. `Chance(n)` = `Random(100) < n` and always draws;
`Random(0)` returns 0 without drawing; `Random(1)` draws (`sgp/Random.cc:62-74`; libstdc++ consumes the engine for a
one-value range, inferred). Keep both rules: single-entry gun levels and single matches call `Random(1)`.

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
  (`:841-872`). Full creation order for the RNG: body → level → stats → **equipment** → nightops → palettes (`06` §7.2)
  → battle sound → female→male → camo (inferred from these call sites).
- Strategic garrisons (not map placements) first randomise the equipment level (`RandomizeRelativeLevel`,
  `Soldier_Create.cc:1842-1918`). `ResetMortarsOnTeamCount()` runs at the start of
  `AddSoldierInitListEnemyDefenceSoldiers` (`Soldier_Init_List.cc:629`); at most 1 mortar per team (`:32`).

### 8.2 Equipment rating (`Inventory_Choosing.cc:159`; `Soldier_Create.cc:1035-1111, 2100-2134`)

```
diff = CalcDifficultyModifier(class), no RNG, clamp 0..100:
         {easy: militia ? 20 : 0, medium: 10, hard: 20}
       + (progress > 0 ? 5 : 0) + (PredictIncomeFromPlayerMines() == 0 ? −5 : 0) + progress·50/100
       + (20 − min(round(hypot(x − 3, y − 16)), 20))·30/20            // Tixa, Orta use distance 4, Alma 10
mod  = bRelativeEquipmentLevel (0..4) + diff/10 − 5
r    = clamp(base + mod, 1, 11);  base 1 admin / green militia, 3 army / regular militia, 5 elite / elite militia
```

A9 at a new game: distance 16 → location 6 → diff easy 1, medium **11**, hard 21. **(data)** The six priority ARMY
placements have equipment level 3 (19417) and 0 (the other five), so on medium r = 2 and 1.

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
seen on A9's static slots). A NO_OVERWRITE item switches the matching generator off: a gun other than the LAW negates
`weaponClass` (pre-selected gun, §8.5; two locked guns flip it back — quirk), the LAW clears the LAW flag, ammo sets
clips 0, a knife sets knife 0, a launcher clears GL and mortar, armour zeroes its class, grenades zero count and class,
kits/misc/bombs zero their class. Militia lose `bomb` after its `Chance(25)` was drawn (`:490-493`).

Then, in order (`:497-506`): weapon → grenades → armour → special weapons → face gear → kits → misc → bombs →
location-specific → droppability.

### 8.4 Gun tables (`J:army-gun-choice-{normal,extended}.json`; loader `X:DefaultContentManager.cc:791-807`)

`SelectStandardArmyGun(level)` = `list[Random(list.size())]` from the **normal** table (extended only with
`fGunNut`) (`Inventory_Choosing.cc:1925-1948`). Level = weapon class − 1.

| Level | Normal | Extended |
|---|---|---|
| 0 | SW38, DESERTEAGLE | SW38, BARRACUDA, DESERTEAGLE, GLOCK_17, M1911 |
| 1 | GLOCK_17, BERETTA_93R | GLOCK_18, BERETTA_93R, BERETTA_92F, M870 |
| 2 | M870, MP5K | TYPE85, THOMPSON, MP53, MP5K, SPAS15 |
| 3 | MINI14 | MINI14, SKS |
| 4 | MAC10, COMMANDO | MAC10, AKSU74, COMMANDO |
| 5 | G41 | AKM, G3A3, G41, AK74 |
| 6 | M24 | DRAGUNOV, M24 |
| 7 | M14, C7 | FAMAS, M14, AUG, C7 |
| 8 | FNFAL | FNFAL |
| 9 | MINIMI | MINIMI, RPK74, HK21E |
| 10 | ROCKET_RIFLE, MINIMI | ROCKET_RIFLE ×2, RPK74, HK21E |

`army-compositions.json` only sizes garrisons (`06` §7.2); it has no equipment.

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
    **`DefaultMagazine`** — the spares may differ: M870 holds buckshot, spares default to slugs); attach with a null
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
  count)` undroppable; with a GL the `GL_*` variants are used.
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
   `Strategic/Strategic_Status.cc:26-27, 457-472`, saved). `InitArmyGunTypes` pre-marks level 0 (SW38, BARRACUDA,
   DESERTEAGLE, GLOCK_17, M1911) at campaign start. Marking happens at **generation**, not death.
2. Rates: militia ammo 5, grenade 3, other 2; everyone else 50 / 25 / 15 (`:23-30`).
3. **Eight draws, always, in order**: ammo `< A`, weapon `< O`, armour `< O`, knife `< O`, grenade `< G`, kit `< O`,
   face `< O/3`, misc `< O`.
4. Apply: ammo → all ammo slots; weapon → `MakeOneItemOfClassDroppable(IC_LAUNCHER|IC_GUN)`; armour → one armour; knife →
   the first blade/throwing knife (no draw); grenade, kit|medkit, face, misc → one each. `MakeOneItemOfClassDroppable`
   counts matches `n`, then walks them drawing `Random(n−−)` until a 0 (the last candidate draws `Random(1)`)
   (`:1489-1521`).

**(inferred) A9, medium, r = 1 trooper**: SW38 or DESERTEAGLE, status `60 + Random(16)` floored at marksmanship, 2–3
regular clips (91 %), no armour, knife or grenades, FAK 50 % / medikit 12.5 %, rarely a gas mask or night goggles; gun
type already marked, so the gun drops only through the 15 % roll. The r = 2 trooper can get FLAK_JACKET, STEEL_HELMET,
COMBAT_KNIFE and GLOCK_17/BERETTA_93R (or M870/MP5K or a level-0 pistol via the `Random(7)` tweak).

Creatures (`AssignCreatureInventory`, `:1758-1853`) get claws/spit/hides (default-undroppable) and part drops (BIGPOCK1..3)
by `Random(100) <` 30/15/5 (adult/young/infant; bloodcat 30). Profiled enemies (Mike, Iggy) carry their profile items.

---

## 9. Dropping items

### 9.1 On death (`Tactical/Rotting_Corpses.cc:609-758`)

Frame code **440** of the death animation → `CheckForAndHandleSoldierDeath` → `HandleSoldierDeath` →
`TurnSoldierIntoCorpse` (`Tactical/Soldier_Ani.cc:1678-1681, 2855-2986`; `03` §6 "dying").

```
vis = (team == OUR_TEAM || profile == QUEEN) ? VISIBLE : INVISIBLE
queen: 6/5/4 (easy/medium/hard) jars of queen blood two rows south; robot: nothing
else for slot 0..18 with an item:
   if (!(fFlags & UNDROPPABLE) || team == OUR_TEAM || drop_everything) && !(item.flags & ITEM_DEFAULT_UNDROPPABLE):
      if team != OUR_TEAM && item is IC_AMMO: count = 1 + Random(count)            // ReduceAmmoDroppedByNonPlayerSoldiers, :1273-1281
      AddItemToPool(grid, obj, all_drops_visible ? VISIBLE : vis, level, 0, zHeight −1)   // attachments and loaded ammo travel along
   DropKeysInKeyRing(s, grid, level, vis, …)                // Keys.cc:1266-1297; no-op for non-player soldiers (no key ring)
AllSoldiersLookforItems()                                     // RevealRoofsAndItems for every merc: seen drops become VISIBLE
non-player: TacticalRemoveSoldier; corpse added
```

### 9.2 Weapon knocked out of the hand (`SoldierTakeDamage`, `Tactical/Soldier_Control.cc:5715-5756`)

Not for blood loss or robots:
`chance = max(0, 2·max(lifeLoss, breathLoss/100) (+20 vs a bloodcat attacker) − EffectiveStrength) − (hand undroppable ?
30 : 0)`; **`Random(100) < (UINT16)chance` is always drawn**; a droppable hand item is added to the pool (VISIBLE for
our team, else INVISIBLE, zHeight −1) and deleted. A negative chance wraps to a huge value, but the undroppable check then
blocks the drop.

---

## 10. Explosions (`TileEngine/Explosion_Control.cc`)

### 10.1 Data

Stracciatella replaces vanilla's `EXPLOSIVETYPE.ubType` (NORMAL, STUN, TEARGAS, MUSTGAS, FLARE, NOISE, SMOKE,
CREATUREGAS; `V:Tactical/Weapons.h:112-119`) by optional effect blocks (`X:ExplosiveModel.h:9-34`,
`X:ExplosiveModel.cc:136-226`): `blastEffect {damage, radius, structuralDamageDivisor}`, `stunEffect {breathDamage,
radius}`, `smokeEffect {type, initialRadius, maxRadius, duration}`, `lightEffect {radius, duration}`, plus `noise`,
`volatility`, `isPressureTriggered`, `calibre` (launchable rounds) and `animation`. There is no fire, burnable gas or
flashbang.

**`structuralDamageDivisor` is never read**: the parser asks for `"structuralDamageDisivor"` (`X:ExplosiveModel.cc:189`),
the JSON says `"structuralDamageDivisor": 3` (STUN, MINI, HAND, GL_HE, GL_STUN grenades, CREATURE_COCKTAIL), so the
divisor is 0 and grenades do **full** structural damage. Vanilla divides grenade structure damage by 3
(`V:TileEngine/ExplosionControl.c:1374`). Decision in §14.

| Item | Blast dmg/r | Stun bd/r | Smoke type init/max/dur | Light r/dur | Noise | Vol | Animation |
|---|---|---|---|---|---|---|---|
| 131 STUN_GRENADE | 1/4 | 70/4 | | | 0 | 0 | STUN_BLAST |
| 132 TEARGAS_GRENADE | | | TEARGAS 1/4/5 | | 0 | 0 | TARGAS_EXP |
| 133 MUSTARD_GRENADE | | | MUSTARDGAS 1/4/5 | | 0 | 0 | MUSTARD_EXP |
| 134 MINI_GRENADE | 15/3 | 7/3 | | | 15 | 1 | BLAST_1 |
| 135 HAND_GRENADE | 25/4 | 10/4 | | | 25 | 1 | BLAST_1 |
| 136 RDX | 40/5 | 12/5 | | | 20 | 10 | BLAST_2 |
| 137 TNT | 50/5 | 15/5 | | | 50 | 2 | BLAST_2 |
| 138 HMX | 60/6 | 15/6 | | | 60 | 2 | BLAST_2 |
| 139 C1 | 55/6 | 15/6 | | | 55 | 0 | BLAST_2 |
| 140 MORTAR_SHELL | 50/6 | 22/6 | | | 50 | 2 | BLAST_2 |
| 141 MINE (pressure) | 30/2 | 30/2 | | | 30 | 2 | BLAST_1 |
| 142 C4 | 65/7 | 30/7 | | | 65 | 0 | BLAST_1 |
| 143 TRIP_FLARE (pressure) | | | | 6/6 | 0 | 0 | BLAST_1 |
| 144 TRIP_KLAXON (pressure) | | | | | 50 | 0 | BLAST_1 |
| 145 SHAPED_CHARGE | 20/1 | 0/1 | | | 20 | 0 | BLAST_1 |
| 146 BREAK_LIGHT | | | | 6/6 | 0 | 0 | BLAST_1 |
| 147 GL_HE_GRENADE | 25/4 | 5/4 | | | 25 | 1 | BLAST_1 |
| 148 GL_TEARGAS_GRENADE | | | TEARGAS 1/3/5 | | 0 | 0 | TARGAS_EXP |
| 149 GL_STUN_GRENADE | 1/4 | 50/4 | | | 0 | 0 | STUN_BLAST |
| 150 GL_SMOKE_GRENADE | | | SMOKE 1/3/5 | | 0 | 0 | SMOKE_EXP |
| 151 SMOKE_GRENADE | | | SMOKE 1/4/5 | | 0 | 0 | SMOKE_EXP |
| 152 TANK_SHELL | 60/6 | 20/6 | | | 60 | 2 | BLAST_2 |
| 153 STRUCTURE_IGNITE | 100/0 | | | | 0 | 0 | BLAST_1 |
| 155 STRUCTURE_EXPLOSION | 50/5 | 10/5 | | | 50 | 2 | BLAST_2 |
| 156 GREAT_BIG_EXPLOSION | 50/5 | 10/5 | | | 50 | 2 | BLAST_3 |
| 157 BIG_TEAR_GAS | | | TEARGAS 1/4/5 | | 0 | 0 | TARGAS_EXP |
| 158/159/160 creature gases | | | CREATUREGAS 1/1/3, 3/3/3, 0/0/2 | | 0 | 0 | none |

`getSafetyMargin` = max(blast r, stun r, smoke maxRadius, light r/2) (AI, `X:ExplosiveModel.cc:277-292`). Creature gases
have no animation; `InternalIgniteExplosion` rejects them after raising the busy count (quirk), and creature code spawns
them with `NewSmokeEffect` directly (inferred).

**Explosion animations** (`J:explosion-animations.json`; frame counts are **(data)** from the STI aux data, which is what
`Tile_Cache.cc:149-150` uses):

| Id | Name | STI | Frames | Delay ms | Damage frame | Damage at | Ends at |
|---|---|---|---|---|---|---|---|
| 1 | BLAST_1 | zgrav_d | 21 | 80 | 3 | 255 ms | 1785 ms |
| 2 | BLAST_2 | zgrav_c | 33 | 80 | 5 | 425 | 2805 |
| 3 | BLAST_3 | zgrav_b | 33 | 80 | 5 | 425 | 2805 |
| 4 | STUN_BLAST | shckwave | 19 | 20 | 5 | 125 | 475 |
| 5 | WATER_BLAST | wat_exp | 13 | (original's) | 18 | **never** | 13·(delay+5) |
| 6/7/8 | TARGAS/SMOKE/MUSTARD_EXP | tear_exp/tear_exp/must_exp | 20 | 80 | 18 | 1530 | 1700 |

Times assume our 5 ms ticks and the strict `>` test below: frame `k` at `k·(delay + 5)` ms (inferred). An explosion
centred on a water tile switches to WATER_BLAST but keeps the original delay; its 13 frames never reach key frame 18, so
**it deals no damage and spawns no gas** (data + code, vanilla identical).

**Smoke effect types** (`J:smoke-effects.json`, ids by position: SMOKE 1, TEARGAS 2, MUSTARDGAS 3, CREATUREGAS 4,
`X:DefaultContentManager.cc:604-615`):

| Type | damage | breathDamage | lostVisibilityPerTile | maxVisibility | maxVisibilityWhenAffected | ignoresGasMask | affectsRobot | affectsMonsters |
|---|---|---|---|---|---|---|---|---|
| SMOKE | 0 | 0 | 0 | 3 | 0 | no | no | yes |
| TEARGAS | 0 | 20 | 2 | 0 | 2 | no | no | yes |
| MUSTARDGAS | 15 | 40 | 2 | 0 | 2 | no | no | yes |
| CREATUREGAS | 5 | 0 | 0 | 0 | 0 | yes | yes | no |

Tile flags `ubExtFlags[level]`: SMOKE 0x01, TEARGAS 0x02, MUSTARD 0x04, CREATUREGAS 0x80; lookup priority SMOKE > TEAR >
MUSTARD > CREATURE (`TileEngine/WorldDef.h:86-101`; `SmokeEffects.cc:78-100`).

### 10.2 Ignition and timing (`:91-254`; `TileEngine/Tile_Animation.cc:220-372`)

```
InternalIgniteExplosion(owner, x, y, z, grid, item, locate, level):
  if queue empty: flags |= DISALLOW_SIGHT | CHECK_SIGHT_AT_END_OF_ATTACK         // every LOS test fails (03 §6)
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
explosives) create their own anitiles immediately and damage after their own key frame.

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
if sub == BLOOD: drop blood (corpse rot)
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

### 10.5 Damage to soldiers (`DamageSoldierFromBlast`, `:708-744`)

```
skip if inactive, dead, or SOLDIER_MISC_HURT_BY_EXPLOSION set (one hit per spread; multi-tile prone soldiers)
ubAttackBusyCount++
wound' = max(0, wound − min(wound, 35)·ArmourVersusExplosivesPercent(s)/100)          // §1.5
EVENT_SoldierGotHit(s, item, wound', breath, dirFromBomb, dist, owner, 0, hitLocation = ANIM_CROUCH (3 = legs, quirk), bomb)
set the hurt flag; OUR_TEAM owner vs others → ProcessImplicationsOfPCAttack(REASON_EXPLOSION)
```

`EVENT_SoldierGotHit` / `SoldierTakeDamage` with an explosion reason (`Tactical/Soldier_Control.cc:2628-2804,
3241-3330, 5432-5810`): creatures take a quarter, vehicles double above 50; `CheckEquipmentForDamage(s, lifeLoss)`
damages carried items and may chain-explode them (§10.7); AP loss `lifeLoss/4`, shock, bleeding; animation: with the
blood option, radius ≥ 3, killed and not prone → `CHARIOTS_OF_FIRE` (dist 2–4) or `BODYEXPLODING` (≤ 1); standing or
crouched victims face the bomb and are thrown back if `OKFallDirection` allows, else fall forward; prone ones collapse.
These hit animations belong to the combat spec.

### 10.6 Structures (`:257-705`; `TileEngine/Structure.cc:119-149, 1150-1215`)

`ExplosiveDamageGridNo(grid, dmg, dist, …, onlyWalls)` walks the tile's structures:
- An explosive base structure (barrel) gets HP 0. Only `sCubeOffset == 0` structures are damaged, and nothing on level 1
  (roof explosions never hurt structures).
- Per structure `ExplosiveDamageStructureAtGridNo`: corpses with the blood option, wound > 10, dist ≤ 1 are vaporised;
  persons skipped; `DamageStructure(s, dmg, EXPLOSION)`: indestructible metal/stone immune; `armour =
  materialArmour/3` (explosion) or `/2`; `dmg < armour` → nothing; else HP −= dmg − armour, destroyed at ≤ 0.
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

- **Thrown grenades and mortar shells** (`TileEngine/Physics.cc:2004-2118`, `HandleArmedObjectImpact`): object count 1;
  for grenades and MORTAR_SHELL the dud test is skipped if the object stopped off the floor (`sZ ≠ 0`) or in water,
  else it explodes iff `status ≥ USABLE && PreRandom(100) < status + PreRandom(50)` (operand evaluation order is
  unspecified in C++; pick left-to-right and log it). A dud repeats the same test; success → `bDelay = 1 + PreRandom(2)`,
  timed, `WORLD_ITEM_ARMED_BOMB` (after `PreRandom(4)`); the dud lands INVISIBLE (level 1 after a roof bounce).
  Non-duds: light effect (BREAK_LIGHT on the ground; on a roof it becomes a visible item), then
  `IgniteExplosionXY(owner, x, y, sZ, grid, item, level)` for grenades with blast/stun/smoke and for mortar shells.
  Re-armed duds have `usBombItem` aliasing `bStatus[2..3]` (= 0), so the queue just removes them (inferred).
  Armed objects that land in water ignite from a ripple anitile (delay 50, key frame 11) and then do nothing (water
  blast, §10.1).
- **Throw range** (`Tactical/Weapons.cc:3524-3577`): launcher `usRange/10`; unaerodynamic 1; grenade
  `2 + ((2·str + 100)/3) / min(3 + weight/3, 4)`; other `2 + str/(5 + weight)`; then `−range·(100 − breath)/200`,
  throwing trait bonus, ≥ 1. Thrown CTH and the physics/scatter (`RandomGridFromRadius` with PreRandom) belong to the
  throwing spec (`Weapons.cc:3580-3700`; `Physics.cc:1739-1786, 2172-2210`).
- **Launchers** (`Weapons.cc:1336-1433`): for OUR_TEAM or visible shooters `WillExplosiveWeaponFail`:
  `(INT8)(PreRandom(40) + PreRandom(40)) > status` and `PreRandom(2) == 1` → the round explodes at the shooter
  (`:3870-3886`); then CTH roll and a physics object like a throw. LAW: the same failure test → DISCARDED_LAW + C1 at
  the shooter; a hit ignites C1 (`:787-801, 1511-1519, 1622-1636`). Tank cannon → TANK_SHELL.
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

### 10.10 RNG per event (order)

| Event | Draws |
|---|---|
| Ignition | `Random(#sounds)` (cosmetic) |
| Each blast/stun tile | `PreRandom(100)` → structure debris `Random(3)` (cosmetic) → each ground item: `PreRandom(max)` [jar `PreRandom(d)`, ammo `PreRandom(100)`, explosive `PreRandom(100)`] → soldier (`SoldierTakeDamage`: carried items as above, weapon-drop `Random(100)`) → debris below `Random(b)`, `Random(w)` |
| Each gas tile with a soldier | `PreRandom(dmg)` if dmg > 0, `PreRandom(bd/2)` if > 0, mask wear `Random(4)`/`Random(2)` |
| New smoke tile | `Random(5)`, `Random(300)` (cosmetic) |
| Stepping onto smoke | `PreRandom(5)` |
| Grenade landing | `PreRandom(100)`, `PreRandom(50)` [dud: again, then `PreRandom(4)`, `PreRandom(2)`] |
| Launcher fire | `PreRandom(40)`, `PreRandom(40)` [`PreRandom(2)`] |
| Bomb queue | `Random(500)` per queued bomb |

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
(which stops during turn-based combat, `Strategic/Game_Clock.cc:616-617`).

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
time the cloud ages about every third 5-s turn (the strict `> 10` s), while REDO gasses its occupants on every turn
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
  −50, no interrupts, no AP→breath regain, FOV range 1 (`Tactical/FOV.cc:246`).
- Standing in tear/mustard without a mask (or in a mask-ignoring gas) caps sight at 2 tiles (`Tactical/OppList.cc:1019-1028`).
- LOS through smoke (`Tactical/LOS.cc:1247-1283`): SMOKE blocks after 3 tiles; tear/mustard cost 2 tiles of range per
  tile; creature gas does not block. These are the "smoke" modifiers `08` deferred.

### 11.5 Light (flares) (`TileEngine/LightEffects.cc`)

25 slots. `NewLightEffect(grid, radius, duration)`: age 0, light sprite `"Light{radius}"` (`J:light-templates.json`
Light0..Light6), **`AllTeamsLookForAll(FALSE)` at once**. `DecayLightEffects` (same callers as smoke): only when
`now − lastUpdate > 350` world seconds, `n = Δ/350` steps: `age++`; `age ≥ duration` → delete; odd age → radius−−;
radius 0 → delete; else rebuild; then sight. A flare (6/6) lasts six steps ≈ 35 min of real time and **never decays
during turn-based combat** (stopped clock, inferred). Sources: BREAK_LIGHT thrown to the ground, TRIP_FLARE from the bomb
queue. The light itself is `05`'s lighting model.

---

## 12. Mines and booby traps (brief)

- **Arming** (`ArmBomb`, `Tactical/Items.cc:2672-2763`): ACTION_ITEM → remote (pits: pressure); DETONATOR → timed
  (`bDelay = setting`, +1 in real time); REMDETONATOR → remote frequency; pressure-triggered explosive (MINE,
  TRIP_FLARE, TRIP_KLAXON) → pressure; SWITCH → pressure or switch; sets `OBJECT_ARMED_BOMB`, `usBombItem = usItem`.
- **Player planting** (`Handle_Items.cc:939-962, 2590-2632`): pressure mine → `bTrap = min(10, expl/20 + exp/3)`,
  `ubBombOwner = id + 2`, BURIED, `MAPELEMENT_PLAYER_MINE_PRESENT`; detonator bombs need
  `PLANTING_(REMOTE_)BOMB_CHECK`: failure ≥ −20 → timer `+Random(3) − 1` (min 1), worse → immediate blast.
- **Map mines**: §6.2 step 5.
- **Stepping on a mine**: `SetOffBombsInGridNo` at tile arrival after the breath-collapse check, before noise
  (`Overhead.cc:1782-1788`; `03` §7); pressure bombs only; non-player soldiers only react to pressure explosives,
  players and militia ignore player-owned bombs; queues them and stops the walker (`Explosion_Control.cc:2165-2235`).
- **Timed bombs**: `DecayBombTimers` once per round / 5-s turn, `--bDelay == 0` → queue (`:2054-2094`). Remote and panic
  triggers: `SetOffBombsByFrequency` (`:2097-2162`; AI panic frequencies 125–127).
- **Booby traps on pickup**: `ContinuePastBoobyTrap` → `DISARM_TRAP_CHECK`; failure sets the bombs off or the MINI_GRENADE
  trap (`Handle_Items.cc:2735-2930`); detection `NearbyGroundSeemsWrong` (`:3051`, `02` §5). Door traps are `07`'s.

---

## 13. Minimal M3 implementation (items and explosions)

**First** (attacks need it):
1. Content: one `ItemTable` from `items/weapons/magazines/armours/explosives.json` + calibres, ammo types, explosion
   animations, smoke effects, light templates, army gun tables (JSON, read as is); transcribe the §1.7 tables,
   `gubItemDroppableFlag` and the AP constants into `data/tables/` with `tools/transcribe`. Tests: load order, `DefaultMagazine`,
   `RandomMagazine` candidate order, `maxArmourPerClass` (51/36/36).
2. `ObjectType` record (§2) with a 36-byte codec shared by map items, placements and saves; `CreateItem/CreateItems/
   CreateGun`, stack helpers, `DamageObj`.
3. Soldier inventory: 19 slots, `CanItemFitInPosition`, `PlaceObject`, `AutoPlaceObject`, `SwapHandItems`, two-handed
   rule, `Weight`/`CalculateCarriedWeight` and its three effects (APs, agility, breath) at turn start.
4. Mercs: `InitProfileFromContent` big-gun replacement + `CopyProfileItems` (player path = auto-place). The sandbox squad
   then fights with SW38, DESERTEAGLE, GLOCK_17, MP5K, G41 and real magazines.
5. Reload: `ReloadGun` (combat path), `FindAmmoToReload`, `AutoReload`, the AI's `TryToReload`, `EnoughAmmo`/`DeductAmmo`,
   `bGunAmmoStatus` (jams), `HandItemWorks`. Armour readers of §1.5 for the combat spec.
6. Enemies: `CalcDifficultyModifier` (real formula; retire the fixed 30), `GenerateRandomEquipment` for ARMY/ADMIN/ELITE
   with the exact draw order (§8.3–8.7), `PlaceObjectInSoldierCreateStruct`, NO_OVERWRITE merge for static placements,
   droppability rolls and `alreadyDroppedWeapons`.
7. Death drops (§9.1) and weapon knock-out (§9.2); world items: `AddItemToPool` (ground level, water sinking, structures as
   far as `07` provides), visibility values, reveal by sight (`SetItemsVisibilityOn` from the FOV sweep), pickup/drop with
   their animation codes 493/487 and AP; map items (§6.2, one `PreRandom(100)` per record).

**Next** (grenades, explosions, smoke):
8. Grenade throw: `MinAPsToThrow`, `CalcMaxTossRange`, dud test, `IgniteExplosion`; launchers (GLAUNCHER, UNDER_GLAUNCHER
   in `WM_ATTACHED`, LAW, mortar) with `WillExplosiveWeaponFail`.
9. Explosion slots with key-frame timing (§10.2) and the busy/`DISALLOW_SIGHT` barrier (`03` §7), `SpreadEffect`,
   `GetRayStopInfo`, `ExpAffect`, `DamageSoldierFromBlast` + `ArmourVersusExplosivesPercent`, noise.
10. Structures: `DamageStructure` with material armour, destruction partners, walls, multi-tile RDX chains, movement-cost
    recompile (`07`); explosive barrels.
11. Item damage and chain reactions (ground and carried).
12. Smoke clouds and `DecaySmokeEffects` per round / 5-s turn, `DishOutGasDamage`, gas masks, the gassed state, smoke in
    LOS and sight caps (`08`); flares (`NewLightEffect`, decay) once lighting is simulated.

**Can wait**: merges, combo merges, kit points, camouflage/canteen/elixir use, keys and key rings, money, attachments
UI (silencer/scope effects belong to combat), mines, booby traps, timed/remote bombs and the bomb queue, panic triggers,
action items, creatures' inventory and gases, tanks, dealers, militia equipment ratings, item search by the AI, water
damage, reduced/extended gun switch (stay on reduced), ownership items.

---

## 14. Deviations to log (`docs/deviations.md`)

| Area | Original | Proposal |
|---|---|---|
| Structural damage of grenades | Stracciatella reads `structuralDamageDisivor` (typo), so the JSON divisor 3 is ignored and grenades wreck structures at full damage; vanilla divides by 3 | Decide: follow the data (/3, vanilla) and log it, or keep Stracciatella's full damage |
| Cosmetic draws | Explosion sound, debris variant (`Random(3)`), smoke animation frame/delay, battle sounds share the main stream | Cosmetic stream (already covered by the RNG entry; list these call sites) |
| Explosion timing | Wall-clock anitile frames, no catch-up | Game-ms frames at `k·(delay + 5)`; frame counts from the STI aux data |
| Anitile pass | The damage key frame `return`s, so later anitiles skip one pass | Keep (5 ms) or drop and log |
| Re-armed duds | Timed but `usBombItem` is 0, so the queue deletes them (inferred) | Keep and log; verify with the tracing oracle |
| Dud test operand order | `PreRandom(100) < status + PreRandom(50)` has unspecified evaluation order | Fixed left-to-right |
| Sandbox equipment | `GenerateRandomEquipment` with the real `CalcDifficultyModifier` (A9 medium: 11) | Today: no equipment, modifier 30 (existing "Sandbox population" entry); drop those parts once §8 is ported |
| Inventory UI paths | Item cursor, item description box, merge prompts, transfer by tossing | Agent API commands (`moveItem`, `reload`, `attach`, `pickUp`, `drop`, `give`) with the same AP rules |
