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
- Explosions are queued, damage the whole radius at one animation key frame, wreck structures, chain into other
  explosives, and spawn smoke/gas clouds or flare lights that grow and decay **per turn** (every 5 s in real time)
  (§10, §11).

**(data) A9 and the sandbox squad.**

| What | Content |
|---|---|
| A9 map items (`MapDef.items`, 4) | CROWBAR 11013 (status 74, always), WIRECUTTERS 11489 (70, `ubNonExistChance` 30), BLOODY_THROWING_KNIFE 13358 (77, 35), CANTEEN 18143 (85, 45, flag `WORLD_ITEM_DONTRENDER`). All ground level, `bVisible = INVISIBLE` (−1), no traps. |
| Barry (0) | STEEL_HELMET 97, FLAK_JACKET 98, SW38 91 (hand), 5× CLIP38_6, TNT, DETONATOR, LOCKSMITHKIT |
| Grizzly (3) | STEEL_HELMET 99, FLAK_JACKET 100, DESERTEAGLE 92, 5× CLIP357_9, COMBAT_KNIFE 98 |
| Vicki (4) | STEEL_HELMET 99, KEVLAR_VEST 100, 2× M1911 → **GLOCK_17** (reduced guns), 6× CLIP45_7 → **CLIP9_15**, TOOLKIT 98, HAND_GRENADE |
| Ivan (7) | STEEL_HELMET 99, KEVLAR_VEST 99, MP53 97 → **MP5K**, 3× CLIP556_30_AP (kept, see §7) |
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
| `usItemClass` | everything: `IC_*` bits (`Item_Types.h:145-177`); `IC_WEAPON = GUN|BLADE|THROWING_KNIFE|LAUNCHER|TENTACLES`, `IC_EXPLOSV = GRENADE|BOMB` |
| `ubCursor` | `HandleItem` dispatch: `REMOTECURS`, `BOMBCURS`, `TOSSCURS`, `INVALIDCURS` (§5); `ubClassIndex` is unused |
| `ubWeight` | hectograms (×100 g): carried weight (§3.6), throw range (§10.8) |
| `ubPerPocket` | 0 = big pockets/hands only; stack size in big pockets, halved in small pockets (§3.2); weight multiplier |
| `bReliability` | weapon wear chance `1/(15 + 3·rel)` per shot (`Tactical/Weapons.cc:871-875`); unjam skill modifier ×4 (`:298-299`) |
| `ubCoolness` | enemy gear choice (§8), dealers, Bobby Ray |
| `usPrice`, `bRepairEase` | strategic only |
| flags | see below |
| `inventoryGraphics`, `tileGraphic` | client only |

Flags (`Item_Types.h:180-211`, JSON `bDamageable` …, `X:ItemModel.cc:321-341`):
`ITEM_DAMAGEABLE` (breaks in hand §5, explosion damage §10.5), `ITEM_REPAIRABLE`, `ITEM_WATER_DAMAGES` (deep water,
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
| Reload / unload attachment / attach (item box) | 5 (`AP_RELOAD_GUN`); 10 with a wrong-size magazine | `BP_RELOAD_GUN` 20 is not charged by `ReloadGun` | `Points.cc:1432-1448`; `Interface_Items.cc:1987, 2001, 2585` |
| Pick up item | 3 (`AP_PICKUP_ITEM`) + path cost | – | `Handle_Items.cc:1295-1297`; `Points.cc:1417-1423` |
| Give item (to adjacent soldier) | 1 (`AP_GIVE_ITEM`) + path | – | `Points.cc:1426-1429` |
| Drop item | 0 (animation only) | – | `Handle_Items.cc:970-984` |
| Toss item (non-explosive throw) | 8 (`AP_TOSS_ITEM`), charged at the release frame | – | `Soldier_Ani.cc:857-866` |
| Throw grenade | `MinAPsToThrow` (+ aim): `AP_CHANGE_TARGET` 1 if new target + stance→stand + `(100·2·fullAP / (18·(50+dex/2)/10) + 1)/2`, capped at full APs | `BP_THROW_ITEM` 50 (inferred) | `Points.cc:1692-1742` |
| Fire launcher | `MinAPsToShootOrStab` + aim (combat spec) | | `Points.cc:1081` |
| Plant bomb / mine | 3 (`AP_DROP_BOMB`) + path | | `Points.cc:1745-1755` |
| Use remote / detonator | 2 (`AP_USE_REMOTE`) | 0 | `Handle_Items.cc` `REMOTECURS` branch |
| Merge (not combine) | 8 (`AP_MERGE`) | | `Items.cc:1640-1644` |
| Camouflage kit / elixir | 10 (`AP_CAMOFLAGE`) | | `Items.cc:3380-3424, 3478-3510` |
| Canteen | 5 (`AP_DRINK`), breath gain `2·min(20, points)·(100−breath)` | negative | `Items.cc:3427-3476` |
| First aid start / per HP / stop | 5 / 1 / 3 (+ stance → crouch) | 0 / −25 / 0 | `Points.h`; `Points.cc:1668-1672` |
| Wire cutters / repair / refuel | 10 / 5 / 10 (+ stance → crouch) | | `Points.cc:1662-1690` |
| Attach tin-can trip wire | 5 (`AP_ATTACH_CAN`) | | `Handle_Items.cc` |
| Ready weapon | `ubReadyTime` (dual: 1) | 10/20 (pistol/rifle) | `Points.cc:1612-1645` |

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
  `FindReplacementMagazine(newCalibre, newSize, sameAmmoType)` (`:161-183`). Ivan's CLIP556_30_AP stays: MP53 and MP5K
  differ in calibre, and the 5.56 magazine fitted MP53, so it is replaced by a 9 mm 30-round AP magazine… only if one
  exists: `FindReplacementMagazine(AMMO9, 30, AP)` → CLIP9_30_AP (inferred; check with the importer).
  `usOptionalGearCost` = sum of prices.
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

<!-- PLACEHOLDER-FORKS -->
