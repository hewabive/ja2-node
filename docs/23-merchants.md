# 23 — Merchants: arms dealers, repairmen and other shopkeepers

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `X:` is `src/externalized/`, `V:` is vanilla
`Build/`, `J:` is `data/externalized/` (byte-identical to Stracciatella's `assets/externalized` for every dealer file).
"(inferred)" marks conclusions not traced end to end. C integer semantics apply (`idiv`, `u8`, `u32` wraps, `docs/18`
conventions). **`FLOAT` is IEEE single precision** and Stracciatella builds use SSE (no extended precision): every `float`
operation below is one `Math.fround` of the exact double result (all operands here are small integers or floats, so double
rounding is innocuous); `(UINT32)x` truncates toward zero. `Random` = `main` stream, `PreRandom` = `pre` stream (`01` §3.6);
`Chance(x)` = `Random(100) < x`, `PreChance(x)` = `PreRandom(100) < x`; both draw even when `x` is 0 or ≥ 100. Item ids
are the `ITEMDEFINE` names of `J:items.json` & co. **Dealer id** = index in `J:dealers.json` (= `ArmsDealerID`,
`Tactical/Arms_Dealer.h:32-66`); **profile id** = `J:mercs-profile-info.json`. **Content order** = the item container's
insertion order (`NOTHING`, `items.json`, `magazines.json`, `weapons.json`, `explosives.json`, `armours.json`;
`X:DefaultContentManager.cc:900-930`, `X:containers/Containers.h:96-140`), `ItemTable.ordered` in
`src/content/items/items.ts`; every daily and init loop below iterates items in content order (V iterates by index,
`V:Tactical/ArmsDealerInit.c:182`; ja2-node follows Strac per D1). Times are world minutes (`GetWorldTotalMin`), days are
`GetWorldDay()`. "SKI" = the shopkeeper interface screen. "POA" = the player's offer area, "DOA" = the dealer's offer area.

**Scope.** `12` owns `OBJECTTYPE`, `CreateItem(s)`, `AutoPlaceObject`, world item pools and `ItemSlotLimit`. `15` owns the
event queue, the 09:00 `DAILY_UPDATE_BOBBY_RAY_INVENTORY` event and the new-game order (`15` §4.2 step 3). `16` owns NPC
placement in loaded sectors (`profileHere`) and sector diffs (items dropped by a dead dealer). `18` owns finances
(`addTransaction`) and the mercs' own repair assignment (`18` §5.7; unrelated to repairmen here). `14` §4 row 23 is the save
section. `21` owns Bobby Ray's online shop, which reuses the supply functions of §4. `22` owns contracts. `11` owns the death
commit (opcode 440) that calls the dead-dealer hook (§10.7). `24` owns talking (the talk menu, BUYSELL records, giving items),
`25` the facts, the 04:00 event and schedules. The shop screen is `28` §5.9; the shop commands, queries, events and view are
`04` §6.

---

## 0. State

Saved in section 23 (`docs/14` §4; layout §14.2), except the shop session.

| State | Original | Notes |
|---|---|---|
| Dealer status ×19 | `ARMS_DEALER_STATUS gArmsDealerStatus[19]` (`Tactical/Arms_Dealer_Init.h:155-167`): `uiArmsDealersCash` u32, `ubSpecificDealerFlags` u8, `fOutOfBusiness`, `fRepairDelayBeenUsed`, `fUnusedKnowsPlayer` (unused), `uiTimePlayerLastInSKI` u32 minutes | 20 bytes each |
| Inventory header ×19×351 | `DEALER_ITEM_HEADER gArmsDealersInventory[19][MAXITEMS]` (`:203-218`): `ubTotalItems`, `ubPerfectItems`, `ubStrayAmmo` (all u8), `SpecialItem[]`, `uiOrderArrivalTime` (a **day**), `ubQtyOnOrder` u8, `fPreviouslyEligible` | a dense array per dealer indexed by item id (entries may be empty); logic never iterates it, it iterates content order |
| Special item | `DEALER_SPECIAL_ITEM` (`:186-200`): `Info` (`SPECIAL_ITEM_INFO`, `:170-183`: `usAttachment[4]`, `bItemCondition` i8, `ubImprintID`, `bAttachmentStatus[4]`), `uiRepairDoneTime` u32 min, `fActive`, `ubOwnerProfileId` | one object per element; **inactive elements are kept** (element indices are identities, §2.1) |
| Shop session | the SKI globals (`gbSelectedArmsDealerID`, `gpSMCurrentMerc`, offer areas) | `state.shop.session` (§14.4); saving is refused while a shop is open (the SKI has no save, inferred from its disabled options button, `Tactical/Interface_Panels.cc:3615-3620`) |

Content: the 19 dealers and their inventory lists (`J:dealers.json`, `J:dealer-inventory-*.json`), the profile field
`weaponSaleModifier` (`J:mercs-profile-info.json`, default 100, `X:mercs/MercProfileInfo.cc:26`; only FLO has 110), and the
transcribed merchant tables (§14.1). Campaign option `gunNut` (default false) is read by item legality (§4.1).

---

## 1. Dealers

### 1.1 The list (`J:dealers.json`, = V `ArmsDealerInfo[]`, `V:Tactical/ArmsDealerInit.c:40-90`)

`dealers.json` gives per dealer the profile, the type (§1.2), `buyingPrice`/`sellingPrice` (multipliers on the item value,
§7.4), `repairSpeed` (minutes per dollar of repair cost) and `repairCost` (multiplier, §10.2) for repairmen, `initialCash`
(§6) and the flags (§1.2). The roles (`ArmsDealerID` enum) are `data/tables/merchant-tables.json` `dealerIds`. Behaviour
hard-coded per dealer:

| Id | Role (profile) | Type | Hard-coded behaviour |
|---|---|---|---|
| 0 | TONY (91) | BUYS_SELLS | coolness window +1 (§4.1); reorder 2–3 days; daily big-gun/handgun/ammo limits (§5.4); JKF pay ½ for anything on his list (§7.1) |
| 1 | FRANZ (124) | BUYS_SELLS | price class EXPENSIVE; keeps one VIDEO_CAMERA until the player buys one |
| 2 | KEITH (147) | BUYS_SELLS | price class CHEAP; no guns/launchers bought before `FACT_HILLBILLIES_KILLED` |
| 3 | JAKE (113) | BUYS_SELLS | price class JUNK; never refuses for cash; GAS_CAN after `FACT_ESTONI_REFUELLING_POSSIBLE` |
| 4 | GABBY (104) | BUYS_SELLS | converts creature blood into elixir daily; customers take at most 3 elixirs per day |
| 5 | DEVIN (61) | SELLS_ONLY | coolness window at least [3, 4]; reorder 2–3 days |
| 6 | HOWARD (125) | SELLS_ONLY | any transaction sets `FACT_222` |
| 7 | SAM (126) | SELLS_ONLY | keeps ≥ 1 JAR |
| 8 | FRANK (92) | SELLS_ONLY | a gift ≥ $10 sets `FACT_FRANK_HAS_BEEN_BRIBED` |
| 9–12 | HERVE, PETER, ALBERTO, CARLO (151–154) | SELLS_ONLY | bar brothers |
| 13 | MICKY (96) | BUYS_ONLY | every list entry is 0; "drunk pays 1.4" is dead code (§7.4); bought items vanish |
| 14 | ARNIE (128) | REPAIRS | special opening quote while nothing is ready (§10.6) |
| 15 | FREDO (130) | REPAIRS | electronics only; resets imprints; rocket rifle quote flag |
| 16 | PERKO (74) | REPAIRS | |
| 17 | DRUGGIST (112, "Elgin") | SELLS_ONLY | |
| 18 | MANNY (155) | SELLS_ONLY | a dealer only once `FACT_MANNY_IS_BARTENDER` |

"JKF" below = the three price-class dealers Jake, Keith and Franz. Multipliers are `FLOAT` (`X:DealerModel.h:27-36`):
1.1 → 1.10000002384, 0.8 → 0.80000001192, 1.4 → 1.39999997616, 0.6 → 0.60000002384, 0.4 → 0.40000000596,
0.1 → 0.10000000149; 0.75, 1.25, 1.0, 1.5 are exact.

Loading (`X:DefaultContentManager.cc:1011-1029`, `X:DealerModel.cc:110-182`): dealers in file order, id = index; the
inventory file name is `dealer-inventory-<profile internalName lower-case>.json` (`:68-72`); validation requires at least
19 dealers and repair cost/speed for repairmen (the BUYS_SELLS branch tests BUYS_ONLY twice and never runs, `:166-180`).
Inventory files are JSON objects `{ "ITEM_NAME": n }` with comments (`X:DealerInventory.cc:225-246`); key order is
irrelevant (a `std::map`).

### 1.2 Types and flags (`Tactical/Arms_Dealer.h:5-29`)

| Type | Sells to player | Buys from player | Inventory |
|---|---|---|---|
| `BUYS_SELLS` 0 | items on his list with max > 0 (+ whatever he holds) | list items (any amount, 0 included); with `BUYS_EVERYTHING` anything his value function prices > 0 | stocked |
| `SELLS_ONLY` 1 | idem | nothing (only money is accepted) | stocked |
| `BUYS_ONLY` 2 | nothing | list items; they **vanish** after the sale (`ShopKeeper_Interface.cc:3478-3484`) | none |
| `REPAIRS` 3 | nothing | nothing; repairs `ITEM_REPAIRABLE` items (§10.1) | items in repair only |

| Flag | Read by |
|---|---|
| `ONLY_USED_ITEMS`, `SOME_USED_ITEMS` | condition of fresh stock (§3.2) |
| `GIVES_CHANGE` | change after a transaction (§9.4); dealers without it keep any overpayment |
| `ACCEPTS_GIFTS` | money-only offers are kept (§9.4 gift path) |
| `HAS_NO_INVENTORY` | skip initial stock, customers and restock (cash still resets) |
| `DELAYS_REPAIR` | the repair-delay excuse (§10.5) |
| `REPAIRS_ELECTRONICS` | repairs only electronics, resets imprints, rocket rifle quote |
| `SELLS_ALCOHOL` | daily alcohol minimum (§5.4) |
| `SELLS_FUEL` | daily GAS_CAN minimum once Estoni refuelling is possible (§5.4) |
| `BUYS_EVERYTHING` | purchase test by value instead of list (§8) |

`IsMercADealer(profile)` (`Arms_Dealer_Init.cc:856-871`): false for MANNY unless `FACT_MANNY_IS_BARTENDER`, else any
dealer's profile. `GetArmsDealerIDFromMercID` (`:874-884`) has no Manny exception (matters for his death, §10.7).

### 1.3 Inventory lists (`X:DealerInventory.h:193-219`, `Arms_Dealer_Init.cc:2180-2191`)

`maxAmount(dealer, item)` = the list value, 0 when absent (`ArmsDealerInvInit.cc:61-64`).
`DoesItemAppearInDealerInventoryList(d, item, fromPlayer)` = listed `&& (max > 0 || fromPlayer)`: an entry with 0 means
"buys but never stocks" (Tony's ROCKET_RIFLE, AUTO_ROCKET_RIFLE, AUTOMAG_III; all of Micky's; Gabby's creature parts and
blood). Repairmen have empty lists.

### 1.4 Item categories

`GetArmsDealerItemTypeFromItemNumber(item)` (`Arms_Dealer_Init.cc:729-852`); the category bits and masks
(`Arms_Dealer_Init.h:85-133`) are `merchant-tables.json` `categories`, the per-class item exceptions (`:776-829`)
`categoryExceptions` (item name → category; every other item of that class takes the class default). Rules: `IC_GUN` by
weapon class (HANDGUN, SMG, RIFLE, MG, SHOTGUN, KNIFE; MONSTER 0), rocket rifles ROCKET_RIFLE instead of RIFLE; `IC_PUNCH`
(except NOTHING), `IC_BLADE`, `IC_THROWING_KNIFE` → BLADE; `IC_LAUNCHER` → LAUNCHER; `IC_ARMOUR`, `IC_MEDKIT`, `IC_KIT`,
`IC_AMMO`, `IC_GRENADE`, `IC_BOMB`, `IC_EXPLOSV` → their own bit; `IC_MISC` → its exception (ALCOHOL, ELECTRONICS, HARDWARE =
`0x400000|KIT`, MEDICAL = `0x800000|MEDKIT`, ATTACHMENTS, DETONATORS) else MISC; `IC_FACE` → ELECTRONICS for EXTENDEDEAR,
NIGHTGOGGLES, ROBOT_REMOTE_CONTROL, else FACE; `IC_THROWN`, `IC_KEY`, `IC_TENTACLES`, `IC_MONEY` → 0. `BIG_GUNS` =
SMG|RIFLE|MG|SHOTGUN. Only Tony's daily limits use these masks.

Sort categories `DealerItemSortInfo` (`ArmsDealerInvInit.cc:33-58`) are `merchant-tables.json` `sortCategories` in order
(index = category; item class, weapon class, "sold used"): 0 handgun, 1 shotgun, 2 SMG, 3 rifle, 4 MG, 5 launcher, 6 ammo,
7 grenade, 8 bomb, 9 blade, 10 throwing knife, 11 punch, 12 armour, 13 face, 14 medkit, 15 kit, 16 misc, 17 thrown, 18 key,
19 money; sold used: the four gun classes but MG, armour, face, misc. `CanDealerItemBeSoldUsed(item)` = `ITEM_DAMAGEABLE &&
sortInfo[category].allowUsed` (`:503-510`; only Bobby Ray reads it).

`CompareItemsForSorting(i1, i2, q1, q2)` (`:415-472`): lower category first; both ammo → higher calibre index first, then
larger capacity first; otherwise higher coolness first; then higher price; then lower item id; then higher quality.

### 1.5 Item properties used

`usPrice`, `ubCoolness`, `bRepairEase`, flags `DAMAGEABLE`, `REPAIRABLE`, `ELECTRONIC`, `NOT_BUYABLE`, `BIGGUNLIST`,
`INSEPARABLE` (attachments), magazine `capacity` and `calibre` index, weapon class. Hard-coded lists: liquids, always sold
full (`Arms_Dealer_Init.cc:1132-1148`, `merchant-tables.json` `liquids`; WINE is not one); rocket rifles ROCKET_RIFLE,
AUTO_ROCKET_RIFLE (`:2343-2353`); staples (§4.1). Notable data: GAS_CAN coolness 0, JAR_CREATURE_BLOOD and MONEY not
buyable, ROCKET_RIFLE coolness 0 + not buyable + electronic, VIDEO_CAMERA damageable + repairable + electronic (coolness 6).

---

## 2. Inventory model

### 2.1 Perfect and special items

Per (dealer, item): `perfect` identical items at condition 100 (a counter) plus `special` elements, one object each.
`IsItemInfoSpecial(info)` (`Arms_Dealer_Init.cc:2149-2177`): `condition != 100` (used, or negative = in repair) **or**
`imprint != NO_PROFILE` **or** any attachment. `total = perfect + active specials`, all u8.

- `SetSpecialItemInfoToDefaults` (`:2086-2100`): condition 100, imprint `NO_PROFILE` (200), no attachments.
- `SetSpecialItemInfoFromObject(o)` (`:2103-2146`): ammo → condition 100 (its status is the round count), else
  `bStatus[0]`; imprint only for guns (others `NO_PROFILE`); the four attachment slots with their statuses. Jams, flags,
  trap and ammo fields are not part of the identity.
- **Add** `AddItemToArmsDealerInventory(d, item, info, n)` (`:1414-1485`): `n = min(n, 255 − total)` (the excess vanishes);
  perfect → `perfect += n; total += n`; special → for each unit: the first inactive element, else grow the array by
  `max(3, n)` and use the first new element (`:1443-1476`); `gubLastSpecialItemAddedAtElement` = that element.
- **Remove** `RemoveItemFromArmsDealerInventory(d, item, info, n)` (`:1507-1559`): perfect → counters; special → the first
  `n` active elements whose info is **byte-equal** to `info` (`memcmp`, i.e. field equality incl. the zeroed padding;
  `sameItemInfo` in `state.ts`). `RemoveSpecialItemFromArmsDealerInventoryAtElement` (`:1629-1640`) clears the element
  (inactive) and `total--`.
- `RemoveRandomItemFromArmsDealerInventory(d, item, n)` (`:1562-1626`): per unit `k = Random(total)`; `k < perfect` →
  one perfect, else the `(k − perfect)`-th active element in element order.
- `FreeSpecialItemArray` (`:1055-1064`): drop all elements, `total = perfect` (dealer death only).

### 2.2 Objects in and out

`AddObjectToArmsDealerInventory(d, o)` (`:1270-1356`), used when the player sells: guns → the gun with its info (jam
forgotten) + loaded bullets through `AddAmmoToArmsDealerInventory` (if `usGunAmmoItem` is `IC_AMMO` and shots > 0) or the
launchable payload as an item with `|bGunAmmoStatus|` (default info otherwise); ammo → each magazine's rounds through
`AddAmmo…`; anything else → each object of the stack separately with its status (imprint/attachments of the stack's info);
then every **detachable** attachment (not `ITEM_INSEPARABLE`) as its own item (default info, its status). The main
item's info is taken from the whole object first, so it keeps **every** attachment, the detachable ones included: a gun
sold with a scope stocks the gun with the scope plus a separate scope (duplication; confirmed by the `dealersell` probe).
Only `IC_GUN` splits its loaded bullets or payload; a launcher (`IC_LAUNCHER`) takes the "anything else" branch. The
source object is cleared.

`AddAmmoToArmsDealerInventory(d, mag, shots)` (`:1359-1406`): `shots ≥ capacity` → `shots / capacity` perfect magazines,
`shots %= capacity`; the rest goes to `ubStrayAmmo`; when strays reach the capacity they become perfect magazines
(`stray / capacity`), `stray %= capacity`. Strays are never shown or sold.

`MakeObjectOutOfDealerItems(item, info, &o, n)` (`:1745-1784`): `CreateItems(item, |condition|, n)` (`docs/12` §2), then
imprint, attachments with statuses; guns get `ubGunShotsLeft = 0` (dealers sell guns **empty**; `usGunAmmoItem` stays the
default magazine from `CreateGun`, jam cleared).

### 2.3 Boxes: what the player sees

`DealerItemIsSafeToStack(item)` = not `IC_GUN` (`:2315-2332`). `CountDistinctItemsInArmsDealersInventory` (`:1154-1190`):
per item with stock, perfect > 0 → 1 box if stackable else `perfect` boxes; + 1 box per active special (repairs included).

`DetermineArmsDealersSellingInventory` (`ShopKeeper_Interface.cc:2179-2283`), items by **index** 1..350: the perfect box
(stackable: one box holding all, `ubNumberOfObjects` may exceed 8 — an "overloaded" object, `:2326-2356`; guns: one box
each), then each active special in element order (repairmen: §10.6 first), owner shown only for repairmen. Then `qsort`:
merchants by `CompareItemsForSorting(item, item, bStatus[0], bStatus[0])`, repairmen by ascending `uiRepairDoneTime`
(`:2156-2172`). Ties keep insertion order (glibc `qsort` is a merge sort here, inferred; ja2-node's sort is stable). The SKI
shows 15 boxes per page (UI only).

**Box key** (ja2-node, `boxes.ts`): `{item, element}` with `element = −1` for perfect boxes (`sSpecialItemElement`,
`ShopKeeper_Interface.h:45-46`). Element indices never move while an item exists and no restock runs inside an open shop,
so keys are stable for a whole shop session.

---

## 3. New game

### 3.1 `InitAllArmsDealers()` (`Arms_Dealer_Init.cc:51-70`), from `InitNewGame` after `LoadMercProfiles` (`Strategic/Game_Init.cc:208-212`)

```
clear all status and headers
for d in dealers (id order):                                          // InitializeOneArmsDealer :76-113
  cash[d] = initialCash
  if HAS_NO_INVENTORY: continue
  for item in content order:
    if CanDealerTransactItem(d, item, FALSE):                         // §8: listed with max > 0 (repairmen excluded above)
      n = DetermineInitialInvItems(d, item, max(d, item), FALSE)       // §4.2: one Random(100) per unit, marks eligible
      if n > 0: ArmsDealerGetsFreshStock(d, item, n)                   // §3.2
AdjustCertainDealersInventory()                                       // §5.4
```

`HighestPlayerProgressPercentage()` (`Tactical/Campaign.cc:1278-1284`) is read for Tony/Devin before `InitNewCampaign`
resets `gStrategicStatus` (`Strategic/Campaign_Init.cc:120`): a fresh process reads 0; a second new game in the same
process reads the previous campaign's highest progress (`ReStartingGame` does not reset it, `Game_Init.cc:291-354`;
inferred). ja2-node always uses 0 (deviation "Dealer initialisation progress").

### 3.2 Fresh stock and its condition

```
ArmsDealerGetsFreshStock(d, item, n):                                  // :1070-1105
  for k in 0..n−1: c = DetermineDealerItemCondition(d, item)
    c == 100 ? perfectCount++ : Add(d, item, {condition: c}, 1)       // used units first, element by element
  if perfectCount: Add(d, item, default info, perfectCount)
DetermineDealerItemCondition(d, item):                                 // :1111-1129
  if DAMAGEABLE && !liquid && (ONLY_USED || (SOME_USED && Random(100) < 50)): return 20 + Random(60)   // 20..79
  return 100
```
No draw for non-damageable items, liquids, or dealers with neither flag. ONLY_USED draws one `Random(60)`, SOME_USED
one `Random(100)` and maybe one `Random(60)`.

---

## 4. The supply model (shared with Bobby Ray, `docs/21`)

### 4.1 Suitability (`GetCurrentSuitabilityForItem`, `ArmsDealerInvInit.cc:67-187`)

```
if !ItemIsLegal(item): NONE        // Items.cc:221-240: with gunNut off, guns and magazines with bBigGunList are illegal
if NOT_BUYABLE: NONE
if coolness == 0: NONE
if item in STAPLES: ALWAYS         // :98-128, merchant-tables.json staples (standard magazines, kits, CANTEEN, CROWBAR, jars)
if dealer ∉ {BOBBYR, TONY, DEVIN}: HIGH
P = highestProgress; lo = P/10; hi = P/10 + 1
TONY: lo++, hi++;  DEVIN: if lo < 3: lo = 3, hi = 4
lo = clamp(lo, 1, 9); hi = clamp(hi, 2, 10)
c > hi → NONE;  lo ≤ c ≤ hi → HIGH;  c + 2 ≥ lo → MEDIUM;  else LOW
```
Windows: P 0 → Bobby Ray/Tony [1, 2], Devin [3, 4]; P 35 → BR [3, 4], Tony [4, 5], Devin [3, 4]; P 70 → BR [7, 8],
Tony [8, 9], Devin [7, 8]. JAR_CREATURE_BLOOD is a staple but NOT_BUYABLE → NONE (the NOT_BUYABLE test comes first).

### 4.2 Chances and rolls

`ChanceOfItemTransaction(d, item, dealerSelling, used)` (`:190-271`):

| Suitability | Dealer buying (stock in) | Dealer selling (customers) |
|---|---|---|
| NONE | 0 | 100 |
| LOW | 15 (BR 25) | 15 (BR 25) |
| MEDIUM | 30 (BR 50) | 30 (BR 50) |
| HIGH | 50 (BR 75) | 50 (BR 75) |
| ALWAYS | 100 | 75 |

Then, only when `0 < chance < 100`: selling → `chance += 5 × coolness; chance /= 2` (u8); used → `chance /= 2`. A used
item that `!CanDealerItemBeSoldUsed` returns 0 for buying (Bobby Ray only). So a HIGH item sells per unit per day with
27 % at coolness 1 and 50 % at coolness 10 (used: 13 %, 25 %); staples (ALWAYS, coolness 1–2) 40/42 %; NONE 100 % (used too:
no halving at 100).

```
ItemTransactionOccurs(d, item, dealerSelling, used):                   // :274-311
  ch = ChanceOfItemTransaction(...)
  if !dealerSelling && ch > 0: header.fPreviouslyEligible = TRUE     // (BR: its store slot)
  return Random(100) < ch                                             // always one draw
DetermineInitialInvItems(d, item, n, used) = Σ_{n units} ItemTransactionOccurs(d, item, BUYING, used)   // :314-330
HowManyItemsAreSold(d, item, n, used)    = Σ_{n units} ItemTransactionOccurs(d, item, SELLING, used)   // :333-349
HowManyItemsToReorder(want, have):                                     // :353-373
  r = want − have; switch Random(3): 0 → r += r/2; 1 → r −= r/2; 2 → r
```

---

## 5. Daily update

`EVENT_DAILY_UPDATE_BOBBY_RAY_INVENTORY`, every day at 09:00 (`BOBBYRAY_UPDATE_TIME`, `Strategic/StrategicMap.cc:123,
2243`), runs `DailyUpdateOfBobbyRaysNewInventory`, `…UsedInventory` (`docs/21`), then
`DailyUpdateOfArmsDealersInventory` (`Strategic/Game_Event_Hook.cc:112-116`). The latter (`Arms_Dealer_Init.cc:239-252`):

### 5.1 `ConvertCreatureBloodToElixir` (`:418-439`)

Gabby, without an out-of-business check: `n = total[JAR_CREATURE_BLOOD]`; remove `n` **perfect** jars; add `n` fresh
JAR_ELIXIR (a liquid: condition 100, no draws). A blood jar sold to him below 100 % would be a special element and the
perfect removal would underflow `perfect` (only an `Assert` guards it); jars are created full (inferred), so ja2-node ports
the perfect case as is.

### 5.2 `SimulateArmsDealerCustomer` (`:256-317`)

```
for d in dealers: skip out of business, HAS_NO_INVENTORY
  for item in content order with total > 0:
    n = HowManyItemsAreSold(d, item, item == JAR_ELIXIR ? min(3, perfect) : perfect, FALSE)
    remove n perfect
    for e in elements (index order): if active: if HowManyItemsAreSold(d, item, 1, TRUE) > 0: remove element e
```
Suitability ignores the dealer's list: items the player sold that are off-list leave at the rates of §4.2 (HIGH for all
dealers but Tony/Devin); NONE items (coolness 0, not buyable, reduced-gun-list) all go the next morning — e.g. Jake's
gas, Tony's rocket rifles bought from the player.

### 5.3 `DailyCheckOnItemQuantities` (`:320-415`)

```
for d in dealers: skip out of business
  cash[d] = initialCash                                               // every dealer, repairmen included
  if HAS_NO_INVENTORY: continue
  for item in content order: if CanDealerTransactItem(d, item, FALSE):  // listed with max > 0
    h = header(d, item); max = maxAmount(d, item)
    if h.qtyOnOrder == 0:
      if h.total <= max/2:                                            // u8 / 2, compared as u32
        wasEligible = h.fPreviouslyEligible
        if ItemTransactionOccurs(d, item, BUYING, FALSE):              // Random(100); sets the flag if chance > 0
          n = HowManyItemsToReorder(max, h.total)                      // Random(3)
          if !wasEligible: ArmsDealerGetsFreshStock(d, item, n)        // first eligible day: instant
          else:
            days = (d ∈ {TONY, DEVIN}) ? 2 + Random(2) : 1 + Random(2)
            h.qtyOnOrder = n; h.uiOrderArrivalTime = GetWorldDay() + days
    else if h.uiOrderArrivalTime >= GetWorldDay():                    // sic: ">=" (= V, V:ArmsDealerInit.c:448)
      ArmsDealerGetsFreshStock(d, item, h.qtyOnOrder); h.qtyOnOrder = 0; h.uiOrderArrivalTime = 0
```
Because of the `>=`, every order arrives at the **next** daily update whatever its 1–3 days; the `Random(2)` only
costs a draw. Stock at or below half the list maximum is refilled by `max − total`, plus or minus half of that. Items
whose suitability is NONE are never reordered.

### 5.4 `AdjustCertainDealersInventory` (`:448-489`), also at the end of the new-game init

1. Tony: `GuaranteeAtLeastOneItemOfType(TONY, BIG_GUNS)`; `LimitArmsDealersInventory(TONY, BIG_GUNS, 2)`,
   `(TONY, HANDGUN, 3)`, `(TONY, AMMO, 8)`.
2. Every `SELLS_ALCOHOL` dealer (id order): `GuaranteeAtLeastXItemsOfIndex(d, BEER|WINE|ALCOHOL, max(d, x)/3)` in that
   order (`:2335-2340`).
3. `GuaranteeAtLeastXItemsOfIndex(SAM, JAR, 1)`.
4. If `FACT_ESTONI_REFUELLING_POSSIBLE`: every `SELLS_FUEL` dealer `Guarantee…(d, GAS_CAN, 4 + Random(3))` — the draw
   happens even when he has enough. Setting that fact also does it once (`Strategic/Quests.cc:43-52`;
   `estoniRefuellingBecamePossible`, called from `narrative-flow.ts`).
5. Franz: unless `ubSpecificDealerFlags & FRANZ_HAS_SOLD_VIDEO_CAMERA` (0x01), `Guarantee…(FRANZ, VIDEO_CAMERA, 1)`.
6. `OnDealerInventoryUpdated()` (Lua observable; no-op without mods; not ported).

```
GuaranteeAtLeastXItemsOfIndex(d, item, n):                             // :704-726
  if out of business || total >= n: return
  ArmsDealerGetsFreshStock(d, item, n − total)                         // no list check (Jake's gas is off-list)

GuaranteeAtLeastOneItemOfType(d, mask):                                // :630-701
  if out of business: return
  for item in content order with category & mask:
    if total > 0: return                                               // already has one
    if max(d, item) > 0 && (ch = ChanceOfItemTransaction(d, item, BUYING, FALSE)) > 0: candidates += (item, ch)
  if none: return
  r = Random(Σch)
  for (item, ch) in candidates: if r <= ch: FreshStock(d, item, 1); return  else r −= ch   // "<=": first gets ch+1 values, last ch−1

LimitArmsDealersInventory(d, mask, limit):                             // :496-627
  if out of business: return
  for item in content order with total > 0 and category & mask:
    cand += (item, mask == AMMO ? 1 : total); T += that
  if #cand > limit:                                                    // counts distinct item TYPES, not units
    toRemove = #cand − limit
    do: r = Random(T)                                                  // T is never reduced
        for i in 0..#cand−1: if r <= n[i]:
              AMMO ? remove ALL perfect of cand[i] : RemoveRandomItem(d, cand[i], 1)   // one unit, any condition
              cand[i] = cand[last]; #cand−−; toRemove−−; break
            else r −= n[i]
    while toRemove > 0                                                 // a draw beyond the remaining sum removes nothing: draw again
```
Effects: Tony holds at most 2 big-gun **types** after the step only if each chosen type had one unit; a type with 2 units
loses one unit and still counts as stocked. Ammo types beyond 8 are dropped wholesale.

### 5.5 When items appear and disappear (summary)

Appear: new-game stock; 09:00 restock (instant on first eligibility, else the next morning); the guarantees of §5.4;
items sold by the player; elixir from blood. Disappear: 09:00 customers (before the restock); Tony's limits (after it);
purchases; the dealer's death (§10.7). Nothing happens between 09:00 events; the dealer's state does not depend on
whether his sector is loaded.

---

## 6. Dealer cash

- Set to `initialCash` at the new game and every 09:00 (§5.3, before restock; not for dead dealers).
- Increases: money items the player hands over (any transaction, including gifts to `ACCEPTS_GIFTS` dealers), the part
  of a price paid from the player's balance (`ShopKeeper_Interface.cc:3364-3368`), money given to Frank outside the SKI
  (`TacticalAI/NPC.cc:1013-1016`, `25` §3.11).
- Decreases: change handed to the player (`GivePlayerSomeChange`, `:5903-5927`). Jake: if his cash is below the change it
  is first raised to exactly the change (he never refuses, "quote 27 was never recorded", `:3311-3319, 5916-5921`).
- Limits buying: a `BUYS_ONLY`/`BUYS_SELLS` dealer refuses a transaction when `change > cash` **before** the offered money
  is added (`:3304-3321`, §9.4); e.g. $5000 cash for a $100 item at Keith (cash 1500) is refused.
- Never shown to the player (no SKI display; only the refusal quote reveals it). On death his cash drops as a MONEY item.

---

## 7. Prices

### 7.1 `CalcValueOfItemToDealer(d, item, dealerSelling)` (`Arms_Dealer_Init.cc:2194-2312`), u16

```
base = usPrice; if base == 0: return 0
switch d: JAKE → class JUNK; KEITH → CHEAP; FRANZ → EXPENSIVE
  default: return listed(d, item, fromPlayer = TRUE) ? base : 0        // any list entry, 0 included
// JKF only:
if item != JAR && (listed(MICKY, item, TRUE) || listed(GABBY, item, TRUE)): return 0   // creature parts, elixir, blood, …
if d == KEITH && class(item) ∈ {IC_GUN, IC_LAUNCHER} && !FACT_HILLBILLIES_KILLED: return 0   // NPC.cc:2607-2637
itemClass = base < 100 ? JUNK : base < 1000 ? CHEAP : EXPENSIVE
if !dealerSelling && |dealerClass − itemClass| == 2: return 0         // Jake ignores ≥ $1000, Franz ignores < $100
v = base
if dealerClass != itemClass && item != GAS_CAN: v /= 3
if listed(TONY, item, TRUE): v /= 2                                    // Tony's speciality, also his 0-entries
return max(v, 1)
```
The same value is used when JKF **sell**: items the player sold them come back at ⅓ / ½ of the base price.

### 7.2 `ItemConditionModifier(item, status)` (`ShopKeeper_Interface.cc:2603-2636`), float

Ammo: `status / capacity` (status = rounds; capacity 0 → 1). Otherwise `|status|` (jammed payload), then
`REPAIRABLE` → `0.5f + status/200.0f`, else `status/100.0f`. Values: 20 → 0.60000002, 30 → 0.64999998, 50 → 0.75,
79 → 0.89499998, 99 → 0.99500000.

### 7.3 `CalcShopKeeperItemPrice(dealerSelling, unitOnly, item, mod, o)` (`:2451-2600`), u32

```
term(it, st) = (UINT32)( fround( fround(CalcValueOfItemToDealer(d, it, dealerSelling) * ItemConditionModifier(it, st)) * mod ) )
unit = 0
if IC_GUN:
  unit += term(item, bGunStatus)
  if usGunAmmoItem != NONE: unit += IC_AMMO(ammo) ? term(ammo, ubGunShotsLeft) : term(ammo, bGunAmmoStatus)
  notCounted = count − 1
else:                                                                  // ammo and everything else
  if count <= 8: toCount = count, notCounted = 0 else: toCount = 1, notCounted = count − 1   // overloaded dealer boxes
  for k < toCount: unit += term(item, bStatus[k]); if unitOnly: break
for each attachment: unit += term(att, attStatus)
if class ∈ {IC_GUN, IC_BLADE, IC_THROWING_KNIFE, IC_LAUNCHER, IC_AMMO}:
  m = weaponSaleModifier(profile of the pricing merc)                  // §9.2; 100 for everyone but FLO (110)
  disc = (int)unit * (m − 100) / 100                                   // C int division
  unit = dealerSelling ? max(1, unit − disc) : unit + disc
OnItemPriced(...)                                                      // Lua hook, no-op
if dealerSelling && unit == 0: unit = 1                               // buying may return 0 = "worthless"
return unitOnly ? unit : unit + notCounted × unit
```
`mod` = `sellingPrice` when the dealer sells, `buyingPrice` when he buys (§7.4). With ≤ 8 objects the modifier applies to
the **sum**, with more to the unit (Flo buying Tony's CLIP9_15 at $18: 3 for $49, 9 for 9 × $17 = $153). Guns from
dealers carry 0 rounds, so their loaded magazine adds nothing.

V (`V:Tactical/ShopKeeperInterface.c:2895-2911`): only FLO, only guns and ammo, a fixed 10 %, no `max(1, …)`. ja2-node
follows Strac (D1).

### 7.4 Which multiplier, and bargaining

- Dealer selling: `sellingPrice`. Dealer buying: `buyingPrice` (`EvaluateInvSlot`, `:6190-6246`). Micky: `sellingPrice`
  (1.4) "when drunk" — but the drunk test looks for Micky on the **player** team (`FindSoldierByProfileIDOnPlayerTeam`,
  `:6200`; V the same with `GetSoldierIDFromMercID`, `V:Tactical/SoldierAdd.c:1478-1495`), so it never applies: Micky
  always pays 1.0 (dead code, kept).
- Repairmen use §10.2, not this function.
- No other bargaining exists: no leadership, wisdom, loyalty or reputation term in the SKI. The only per-merc factor is
  `weaponSaleModifier` (the talk menu tooltip shows it as "weapon sales ±n %", `X:content/NewStrings.cc:786-788`).
  Town loyalty matters only through facts (Keith's shop closing, `FACT_LOYALTY_LOW`, `25`).

Worked examples (float exact): Tony sells a perfect GLOCK_17 ($350): `350 × 1 × 1.25 = 437.5 → 437`. Tony buys a 50 %
GLOCK_17 loaded with a full CLIP9_15 ($15): `350 × 0.75 × 0.75 = 196.875 → 196` + `15 × 1 × 0.75 = 11.25 → 11` = 207.
Keith buys an 80 % FLAK_JACKET ($300, his class, not on Tony's list): `300 × 0.9 × 0.75 = 202.5 → 202`. Jake sells a
GAS_CAN ($250, off-list, class CHEAP but exempt from ⅓): `250 × 1.10000002 = 275.0000059 → fround 275 → 275`.

---

## 8. What can be traded with whom

`CanDealerTransactItem(d, item, fromPlayer)` (`Arms_Dealer_Init.cc:955-1000`):
- `SELLS_ONLY` and `fromPlayer` → false; `BUYS_ONLY` and `!fromPlayer` → false;
- `BUYS_SELLS` with `BUYS_EVERYTHING` and `fromPlayer` → `CalcValueOfItemToDealer(d, item, FALSE) > 0`;
- `REPAIRS` → `CanDealerRepairItem` (§10.1);
- otherwise `listed(d, item, fromPlayer)`.

In the SKI an offered object is **rejected** when its main item is not money and `!CanDealerTransactItem(d, item, TRUE)`
(`WillShopKeeperRejectObjectsFromPlayer`, `ShopKeeper_Interface.cc:4905-4925`); otherwise `EvaluateInvSlot` prices it
(`:6190-6246`): price 0 → **worthless** (no value flag), else valued; non-ammo below status 30
(`REALLY_BADLY_DAMAGED_THRESHOLD`, `:219`) only changes the quote. Rejected and worthless objects are crossed out and
come back to the player. Only the main item decides: ammo and attachments the dealer does not value add $0 but are still
taken with the gun (§2.2). Money (`IC_MONEY`: MONEY, MONEY_FOR_PLAYERS_ACCOUNT, SILVER, GOLD) is always accepted at its
`uiMoneyAmount`. ja2-node refuses the whole trade instead of crossing items out (deviation "Unsellable shop items").

---

## 9. A trade in the original (the SKI)

### 9.1 Entering

Ways in: the talk menu's 5th entry (labelled with the dealer type, `Tactical/Interface_Dialogue.cc:738-741`) when the
NPC has no unused `APPROACH_BUYSELL` record (else that record plays, `24`) (`:800-830`); the NPC script action
`NPC_ACTION_INITIATE_SHOPKEEPER_INTERFACE` after `HandleShopKeepHasBeenShutDown` (Keith out of business or low loyalty
plays a record instead, `TacticalAI/NPC.cc:2640-2665`, `25` §3.2 action 41) (`Interface_Dialogue.cc:3578-3585`); giving an
item to a dealer who would not accept it as a quest item opens the SKI with that item already offered
(`Tactical/Handle_Items.cc:2347-2390`, `24`). Starting to talk costs `AP_TALK` 6 (`Tactical/Soldier_Control.cc:8564-8567`);
the talk preconditions are `24` (`Tactical/Handle_UI.cc:4560-4840`: talkable NPC, visible, not moving outside combat, LOS,
walk-up beyond 4 tiles).

`ShopKeeperScreenHandle` **pauses the game** for the whole visit (`ShopKeeper_Interface.cc:423, 492`).
`CanMercInteractWithSelectedShopkeeper(s)` (`:5716-5760`): the dealer's soldier exists in the sector with life ≥ OKLIFE;
`s` active, in sector, on the current squad, life ≥ OKLIFE, not mechanical, has LOS to the dealer's tile
(`SoldierTo3DLocationLineOfSightTest(s, g, level, 3, DistanceVisible(s, IRRELEVANT, IRRELEVANT, g, level), TRUE)`) and
`GetRangeFromGridNoDiff ≤ NPC_TALK_RADIUS` 4 (`TacticalAI/NPC.h:10`). Every merc whose items are used must pass it.

Entry (`EnterShopKeeperInterface`, `:541-736`): (1) repairmen: `HandlePossibleRepairDelays` (§10.5, uses the old
`uiTimePlayerLastInSKI`); (2) `InitializeShopKeeper(TRUE)` (`:1784-1858`): `uiTimePlayerLastInSKI = now`, build the boxes
(§2.3) — finished repairs go to the POA (§10.6); (3) the given item, if any, is offered (`:676-713`).

### 9.2 Areas, limits and the pricing merc

DOA and POA have 12 slots each (`:129-133`); one slot = one object (a box selection, a stack, a gun with attachments).
Clicking a dealer box puts one unit (all with SHIFT) into **one** DOA slot; more clicks raise that slot's count
(`:1304-1379, 2716-2754`). Offered merc items stay in the merc's pocket, hatched, until the transaction
(`IfMercOwnedCopyItemToMercInv`, `:5578-5596`). Money can be split off a pocket (`RemoveMoney`,
`Tactical/Interface_Items.cc:4954-5000`).

The **pricing merc** is the SM-panel merc `gpSMCurrentMerc`: set to the selected merc on entry, changeable with the
panel's previous/next buttons to any active, alive merc of the current squad (`Interface_Panels.cc:2167-2210`) — even one
out of range (his items are then disabled, `:359-369`, but prices still use his modifier). Player items are re-priced
every frame with the current pricing merc (`ShopKeeper_Interface.cc:2947-2962`; deviation "Pricing merc").

### 9.3 Evaluation

Non-repairmen: the whole object is offered (`OfferObjectToDealer`, `:5199-5221`) and evaluated (§8). Repairmen: §10.1.

### 9.4 `PerformTransaction(fromBalance)` (`:3163-3381`)

```
value = Σ POA objects with the value flag (money at its amount)         // CalculateTotalPlayersValue :3073-3096
cost  = Σ DOA: repairmen CalculateObjectItemRepairCost, else CalcShopKeeperItemPrice(SELLING, FALSE, …, sellingPrice)
cash  = Σ money in POA
if leave requested: return
if POA holds only money && DOA empty:                                   // the gift path
  quote 10; if ACCEPTS_GIFTS: move the money to the dealer's cash; DealerGetsBribed (FRANK, ≥ $10 → FACT_FRANK_HAS_BEEN_BRIBED, :5930-5957)
  (otherwise the money stays and goes back on leaving)
else:
  if !repairman:
    room = 12 − #(POA objects without value); if room > 0: room−−       // one slot reserved for change
    if #DOA > room: message "no room"; return
  if cost > value + fromBalance:
    if cost > value + fromBalance + balance: box "short by cost − (balance + value)"; return
    yes/no box "deduct cost − value from your account?"; yes → PerformTransaction(cost − value) then
      AddTransactionToPlayersBook(PURCHASED_ITEM_FROM_DEALER, dealer profile, now, −(cost − value)); no → nothing
    return
  if repairman:
    if fromBalance + cash < cost: return
    move POA money to the dealer's cash
    if GIVES_CHANGE: change = fromBalance + cash − cost; change > 0 → GivePlayerSomeChange(change)
    queue every DOA item for repair in slot order (§10.3)
  else:
    change = value − cost                                               // INT32; fromBalance is NOT included
    if type ∈ {BUYS_ONLY, BUYS_SELLS} && change > cash[d] && d != JAKE: quote 27; return
    move valued POA objects to the dealer: money → cash; items → AddObjectToArmsDealerInventory (not for BUYS_ONLY)
    move DOA objects to the POA (purchased; first free slots, DOA slot order); remove them from his inventory
      (RemoveItemFromArmsDealerInventory with the box object's info and count); Franz + VIDEO_CAMERA → flag 0x01
    if GIVES_CHANGE && change > 0: GivePlayerSomeChange(change)          // a new MONEY object in the next free POA slot
    if d == HOWARD: SetFactTrue(FACT_222)
  cash[d] += fromBalance
  InitializeShopKeeper(FALSE)                                           // last SKI time = now, boxes rebuilt
```
Non-repair dealers without `GIVES_CHANGE` (bars, Frank, Elgin, Manny) keep any overpayment. The transaction itself is
atomic: every check precedes every move, and the balance path re-runs the same checks with the deduction included (they
cannot fail between the box and the answer, inferred: the box is modal). Failure cases: leaving requested, no room,
cannot afford (message), deduction declined, repairman short of money (silent), dealer cannot afford (quote 27); none of
them changes state. ja2-node: `planTrade` computes the whole transaction without side effects and `executeTrade` applies it
(`trade.ts`); the deduction box is pre-answered (deviation "Shop deduction prompt"), a refused gift moves nothing
(deviation "Refused gift").

### 9.5 Leaving (`ExitSKIRequested`, `:5762-5819`; `DealWithItemsStillOnTheTable`, `:5834-5884`)

The first Done with player items still on the table only reminds (quote 26); the next leaves. Every POA object (and, at a
repairman, every DOA object) without a pocket copy goes to its owner if he still works for the player and passes §9.1,
else to the pricing merc (if he passes it), else is dropped **VISIBLE** at the pricing merc's (or selected merc's) tile
and level in stacks of ≤ 8 (`:5887-5900, 5553-5575`). Placement: money first tops up the first MONEY pocket below its
limit (20000 big / 10000 small, `Tactical/Items.cc:292-302`), the rest `AutoPlaceObject` in chunks of ≤ 8 with the new-item
flag for purchased and repaired items (`:5518-5548, 5673-5713`). ja2-node applies these rules at once after each trade and
to finished repairs when the shop opens (deviation "Shop as commands").

### 9.6 Money

Cash objects in the POA pay first; the balance only covers the shortfall, and only after the yes/no box (ledger code
`PURCHASED_ITEM_FROM_DEALER` 26, second code = dealer profile). Change is a MONEY object. Moving money between the account
and a merc is a general SM-panel feature, not part of trading: withdraw → `TRANSFER_FUNDS_TO_MERC` (`Interface_Items.cc:
4977-4984`), deposit → `MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT` (`Interface_Panels.cc:3646-3715`); ja2-node:
`src/sim/campaign/money-flow.ts` (`04` §6).

---

## 10. Repairs

### 10.1 What a repairman takes (`CanDealerRepairItem`, `Arms_Dealer_Init.cc:1003-1036`; `ShopKeeper_Interface.cc:4624-4754, 5199-5513`)

Repairable = `ITEM_REPAIRABLE` and (`REPAIRS_ELECTRONICS` ? electronic : not electronic): Fredo fixes only electronics,
Arnie and Perko everything else. An offered object is split (`SplitComplexObjectIntoSubObjects`, `:5315-5450`): one object
→ itself, guns stripped of loaded bullets/payload (except ROCKET_LAUNCHER) which become separate objects (bullets: a
magazine of `ubGunShotsLeft` rounds; payload: `|bGunAmmoStatus|`); attachments stay on (they are repaired with it);
stacks → one object per member. Each part is evaluated in turn: rejected (wrong kind) stays in the POA; repairable and
`bStatus[0] < 100`, or any rocket rifle (imprint reset), moves to the DOA; undamaged stays. The **limit**:
`#DOA + objects being added + #items in repair > 4` refuses the part (quote 27 once) (`:4656-4672`; "in repair" counts
every element with negative condition, finished but uncollected ones included, `Arms_Dealer_Init.cc:1217-1264`). Room
(`:5228-5271`): parts are counted as repairable when `bStatus[0] != 100` and he can repair them (a 100 % rocket rifle
counts as non-repairable here but still moves to the DOA); `canTake = u8(4 − #inRepair − #DOA)` (wraps when already
over 4); `doa = min(repairable, canTake)`; `poa = nonRepairable + (repairable − doa) + (doa > 0 ? 1 : 0)`; the whole
object is refused when `poa + #POA > 12`.

### 10.2 Cost and time (per object: main item + every attachment with status < 100 that he can repair)

```
CalculateSimpleItemRepairCost(d, item, cond):                          // Arms_Dealer_Init.cc:2037-2082
  full = (UINT32) fround(usPrice * repairCost)
  adj = 100 − 10 × repairEase; if adj < 10: adj = 10                    // INT16
  cost = (UINT32) fround(full * fround((adj × (100 − cond)) / 10000.0f))
  if rocket rifle: cost += 100                                          // even at 100 %
  return max(cost, 10)                                                  // MIN_REPAIR_COST
CalculateSimpleItemRepairTime(d, item, cond):                          // :1979-2010
  t = (UINT32) fround(CalculateSimpleItemRepairCost(...) * repairSpeed)
  if ELECTRONIC && d != FREDO: t *= 2                                   // dead: only Fredo repairs electronics
  return max(t, 15)                                                     // MIN_REPAIR_TIME_IN_MINUTES
```
Examples, GLOCK_17 ($350, ease 2 → adj 80) at 50 %: Perko $56 / 56 min; Arnie $112 / 15 min; Fredo would be $84 / 50 min.
A 100 % ROCKET_RIFLE at Fredo: $0 + 100 = $100, 60 min.

### 10.3 The queue (`GiveItemToArmsDealerforRepair`, `:1848-1881`)

Items enter in DOA slot order; each: `start = WhenWillRepairmanBeAllDoneRepairing(d)` (`:1884-1922`: max(now, latest
`uiRepairDoneTime` of his items in repair)), `fix = CalculateSpecialItemRepairTime`, `done = start + fix +
CalculateOvernightRepairDelay(d, start, fix)`; stored as a special element with **negated** condition, the done time and
the owner profile. The jam is forgotten; the gun keeps its imprint.

```
CalculateOvernightRepairDelay(d, start, fix):                           // :2376-2415
  t = start % 1440
  if !GetArmsDealerShopHours(d, &open, &close): return 0                // dealer soldier absent or no lock/unlock schedule
  days = 0
  while t + fix > close:
    if t < close: fix −= close − t
    t = open; days++
  return days × (1440 − (close − open))
```
`GetArmsDealerShopHours` (`:2356-2372`) takes the `SCHEDULE_ACTION_UNLOCKDOOR`/`LOCKDOOR` times of the dealer's map
schedule (`Strategic/Scheduling.cc:1036-1076`). ja2-node: the `shopHours` merchant hook, which `campaign-sim.ts` answers from
the loaded tactical sector's schedules (`extractScheduleDoorLockAndUnlockInfo`, `25` §5.5) for the dealer's soldier there,
else `null`. A job started after closing pays a full night although part of it has passed; a job started at night before
opening may finish at night; with no hours there is no delay.

### 10.4 Minutes closed between two times (`CalculateMinutesClosedBetween`, `:2418-2492`)

```
closedPerNight = 1440 − (close − open); dd = end/1440 − start/1440
m = dd >= 2 ? (dd − 1) × closedPerNight : 0
s = start % 1440; e = end % 1440; if e == 0: e = 1440
if s == e: if dd == 0: return 0 else: m += closedPerNight               // no return: continues below
if s < e: m += (s < open ? min(open, e) − s : 0) + (e > close ? e − max(close, s) : 0)
else: m += closed(s, 1440) + closed(0, e)                                // recursive, same dealer
```
With `s == e` on different days the code adds a night and then falls into the wrap branch, which adds another full
day's closed time (a double count, kept). With `s < e` and `dd ≥ 2` it counts `dd − 1` nights although the span
crosses `dd` closings (10:00 on day 0 to 11:00 on day 2 is one night, 720 minutes with 08:00–20:00 hours; kept).

### 10.5 The delay excuse (`HandlePossibleRepairDelays`, `ShopKeeper_Interface.cc:5964-5996`), on entering the SKI

```
if !DELAYS_REPAIR || fRepairDelayBeenUsed: return
if now − uiTimePlayerLastInSKI < 180: return                           // first visit ever: last time 0 → passes
h = max over his items in repair with done ≤ now of (now − done − CalculateMinutesClosedBetween(done, now)) / 60
if none is done || h >= 6: return                                       // REPAIR_DELAY_IN_HOURS
if !PreChance(50): return                                              // pre stream
delay = (6 + Random(6)) × 60                                           // main stream
for every item in repair (index, element order): done += CalculateOvernightRepairDelay(d, done, delay) + delay
opening quote 29 ("sorry, delayed"); fRepairDelayBeenUsed = TRUE         // once per repairman per game
```

### 10.6 Collecting (`RepairIsDone`, `:2362-2432`), while building the boxes on entry

For each element in repair with `done ≤ now` (index, element order): rebuild the object (`MakeObjectOutOfDealerItems`:
original condition, gun empty and unjammed), set the main item and every attachment he can repair to 100 (other
attachments keep their status), reset the imprint if the dealer `REPAIRS_ELECTRONICS` (any item), put it in the first free
POA slot with the owner; no room → it stays as "repaired, not collected". Collected elements leave his inventory. The ETA
shown on unfinished boxes is `done` rounded up to 15 minutes, with the day when not today (`:6290-6333`); the help text of
a DOA item shows its bare repair time rounded up to 15 minutes, hours from 105 minutes on (`:6254-6287`).
`FACT_NOTHING_REPAIRED_YET` and Arnie's opening quote 33 test "has items in repair, none done" (`Arms_Dealer_Init.cc:
904-949`, `Strategic/Quests.cc:880-882`). Quote 33 never plays: `HandleShopKeeperDialog` assigns it and then the `else` of
the repair-delay test overwrites it with quote 11 (`ShopKeeper_Interface.cc:3948-3965`); ja2-node opens with 29 after a
delay excuse and 11 otherwise.

### 10.7 Dead dealers (`AddDeadArmsDealerItemsToWorld`, `Arms_Dealer_Init.cc:1644-1742`)

Called for every non-player soldier at the death commit (`Tactical/Overhead.cc:2521-2522` in `HandleNPCTeamMemberDeath`,
from `Soldier_Ani.cc:2926`; ja2-node: `sector-flow.ts`): if the profile is a dealer's (Manny too), `fOutOfBusiness = TRUE`
forever; every item in content order is dropped **INVISIBLE** at his `sInitialGridNo`, level 0 (`AddItemToPool`): perfect
ones in stacks of `max(1, ItemSlotLimit(item, BIGPOCK1POS))`, then each special (items in repair come back **unrepaired**),
arrays freed; his cash as one MONEY object; cash 0. A dead dealer is skipped by customers, restock and guarantees.

---

## 11. Availability

| Condition | Where |
|---|---|
| Dealer soldier present: profile sector = loaded sector, not hired, not dead, map placement with his profile | `profileHere` (`sector-flow.ts`; `25` §4.6) |
| Not out of business | §10.7 |
| Manny is a dealer only with `FACT_MANNY_IS_BARTENDER` | §1.2 |
| Unused `APPROACH_BUYSELL` NPC record plays first; Keith's shutdown records | §9.1 (`24`, `25` §3.2) |
| Tony available 3 days in 4 once spoken to: at 04:00, if C5 is not loaded, `Random(4)` ≠ 0 → C5, else `FACT_TONY_NOT_AVAILABLE` and no sector | `Strategic/Strategic_Event_Handler.cc:733-747`; `25` §4.3 (`early-morning.ts`) |
| Devin moves daily while never spoken to (counter starts at 3, `Game_Init.cc:115`) to a random sector of his placement list | `:752-766`, `J:strategic-map-npc-placements.json`; `25` §4.3 |
| Micky (and Gabby, sci-fi) placed at a random listed sector at game start | `InitNPCs`, `Game_Init.cc:73-116` (`docs/15` §4.3 step 7; `src/sim/strategic/map/init.ts`) |
| Repairmen's shop hours | map schedules (§10.3) |

---

## 12. Other paid services

Bartenders are ordinary `SELLS_ONLY` dealers (§1.1); drinking is item use (`docs/12`). The hospital (Vince, Steve Willis:
`CalcPatientMedicalCost`, `CalcMedicalCost`, `Interface_Dialogue.cc:4065-4152`) is `25` §11.3; Dave's gas, Waldo, Darren's
fights, Kingpin and Carmen's bounties are NPC dialogue (`25`); Skyrider's fares are `docs/16`; Bobby Ray is `docs/21`.

---

## 13. Determinism

| Where | Draws (in order) | Stream |
|---|---|---|
| New game §3 | per dealer, per transactable item in content order: one `Random(100)` per list unit; per stocked unit of a damageable non-liquid item: SOME_USED `Random(100)` (+ `Random(60)` if < 50), ONLY_USED `Random(60)`; then §5.4 | main |
| 09:00 §5 | customers: per dealer, per item with stock, one `Random(100)` per perfect unit (elixir ≤ 3), then per active special; restock: per dealer, per eligible item at ≤ half: `Random(100)`, on success `Random(3)`, then `Random(2)` (order) or the condition draws (instant); arrivals: condition draws; §5.4: Tony `Random(Σch)` (+ conditions), each limit pass `Random(T)` per attempt + `Random(total)` per removed unit, Jake `Random(3)` if the fact holds, Franz camera conditions | main |
| Entering the shop §10.5 | `PreRandom(100)` only when every other condition holds, then `Random(6)` on success | pre, main |
| Fact `ESTONI_REFUELLING_POSSIBLE` set | `Random(3)` + fresh stock (no condition draws: liquid) | main |
| Trading, pricing, repairs | none | — |

Not drawn (cosmetic in the original, consuming the shared generator on wall-clock time; deviation "Cosmetic shopkeeper
draws"): the idle quote timer `Random(delay)` and `Chance(35/33/50)` (`ShopKeeper_Interface.cc:4015-4057`), `Random(100)`
**every frame** in `HandleCheckIfEnoughOnTheTable` (`:5025`), the normal-evaluation quote `Chance(100/60/25/10/0)` by
milliseconds since the last one (`:4802-4819`). Floats: §7, §10.2 (`Math.fround` per operation). Ordering: content order for
daily/init loops, index order for the box list and repair scans; stable sorts. The merchants' new-game draws come after the
terrorists and mercs-on-assignment draws and before Bobby Ray (`docs/15` §4.6 step 3).

---

## 14. Implementation in ja2-node

### 14.1 Content and data

`src/content/strategic/merchant-content.ts` (`parseMerchantContent`) loads, used directly: `J:dealers.json` (§1.1), the 19
`J:dealer-inventory-*.json` (Arnie, Fredo, Perko empty; `dealerInventoryPath`), `mercs-profile-info.json` (dealer profile ids
and names, `weaponSaleModifier`, default 100); the item table supplies price, coolness, repair ease, flags and the
magazines' calibre index and capacity (the sort); `J:strategic-map-npc-placements.json` (Devin, Micky, Gabby sectors) comes
with the strategic map content.

Transcribed: `data/tables/merchant-tables.json` (`tools/transcribe/merchant-tables.ts`; regenerate, never edit):
`dealerIds` (the `ArmsDealerID` roles, `BOBBYR = −1`, `Tactical/Arms_Dealer.h:32-66`), `categories` (bits and masks,
`Arms_Dealer_Init.h:85-133`), `categoryExceptions` (`Arms_Dealer_Init.cc:776-829`), `sortCategories`
(`ArmsDealerInvInit.cc:33-58`), `staples` (`:98-128`), `liquids` (`Arms_Dealer_Init.cc:1132-1148`). The other numbers
(suitability chances, coolness windows, price class bounds 100/1000, Tony's limits 2/3/8, reorder days, alcohol ⅓, gas
4 + `Random(3)`, repair minimums 15 min and $10, rocket rifle surcharge 100, 12 offer slots, repair limit 4, the 6-hour delay
and 180-minute gap, damage threshold 30, `AP_TALK` 6, `NPC_TALK_RADIUS` 4, Franz's and Fredo's 0x01 flags, ledger code 26)
are named constants. The SKI layout, pages, hatching, description box, subtitles and quote timing are client UI (`28` §5.9).

Original data (imported through the profile, map and `.npc` importers, never committed): dealer sectors and soldier stats
(`prof.dat`), dealer placements and schedules (maps), BUYSELL records and Keith's shutdown records (`.npc`).

### 14.2 State and save import

`StrategicState.merchants` (`MerchantState`, `merchants/state.ts`): per dealer `status` (cash, flags, out of business, delay
used, `lastSkiMinute`) and 351 `headers` (`total`, `perfect`, `strayAmmo`, `specials` with inactive elements kept,
`orderArrivalDay`, `qtyOnOrder`, `previouslyEligible`). `createMerchantContext` sizes it to the dealer count;
`initAllArmsDealers` fills it at the new game (`new-game.ts`).

Save section 23 (`SaveLoadGame.cc:433, 834-835`; `Arms_Dealer_Init.cc:139-231`), decoded by
`src/content/formats/savegame-merchants.ts` (`readSavedMerchants`) and applied by `importMerchants`
(`merchants/save-import.ts`, called from `src/server/save-session.ts`): 19 × 20-byte status (`cash` u32 @0, `flags` u8 @4,
`outOfBusiness` @5, `repairDelayUsed` @6, unused @7, `lastSki` u32 @8, 8 padding); 19 × 351 headers of 16 bytes (`total` @0,
`perfect` @1, `stray` @2, `numSpecial` @3 = **allocated** elements, 4 skipped, `orderDay` u32 @8, `qtyOnOrder` @12,
`prevEligible` @13, 2 skipped); then per dealer, per item 1..350 with `numSpecial > 0`, that many 28-byte elements
(`usAttachment[4]` u16 @0, `condition` i8 @8, `imprint` @9, `attachStatus[4]` @10, 2 padding, `repairDone` u32 @16, `active`
@20, `owner` @21, 6 padding). Saves before version 54/55 lack Elgin/Manny (re-initialised on load); all supported versions
(85–105, `docs/14` §1) have 19. ja2-node does not write native saves.

### 14.3 Modules

Under `src/sim/strategic/economy/merchants/`, with the SFI-SCLA header:

| Module | Responsibility |
|---|---|
| `context.ts` | `MerchantContext` (content, items, state, `main`/`pre` roll sources, hooks, world clock and progress, narrative facts), `isMercADealer`, the hooks `buySellRecordPending`, `shopClosedByScript`, `shopHours` (defaults false, false, `null`) |
| `state.ts` | dealer status, headers, special elements, item info identity (§2.1) |
| `inventory.ts` | add/remove, random removal, fresh stock and condition, objects in and out, strays, guarantees by item (§2, §3.2) |
| `supply.ts` | legality, categories, sorting, suitability, chances, rolls (§1.4, §4); shared with Bobby Ray |
| `daily.ts` | `initAllArmsDealers`, `dailyUpdateOfArmsDealersInventory` and its steps, guarantees and limits (§3, §5) |
| `pricing.ts` | `calcValueOfItemToDealer`, `itemConditionModifier`, `calcShopKeeperItemPrice` (§7), pure |
| `repair.ts` | repairability, cost, time, queue, overnight delay, closed minutes, delay excuse (§10.1–§10.5) |
| `boxes.ts` | `determineArmsDealersSellingInventory`: boxes, sort, repair collection (§2.3, §10.6) |
| `trade.ts` | evaluation, `planTrade` (the checks of §9.4 without side effects) and `executeTrade` |
| `view.ts` | the shop view: unit prices, repair ETAs, type labels |
| `death.ts` | `addDeadArmsDealerItemsToWorld` (§10.7) |
| `save-import.ts` | `importMerchants` (§14.2) |

Wiring (`src/sim/campaign/campaign-sim.ts`): the merchant context exists when the campaign has merchant content; the 09:00
`DAILY_UPDATE_BOBBY_RAY_INVENTORY` handler runs the laptop's Bobby Ray update, then `dailyUpdateOfArmsDealersInventory`;
`shopHours` reads the loaded sector's schedules (§10.3); `buySellRecordPending` and `shopClosedByScript` come from the talk
and NPC-action flows (`24`, `25`).

### 14.4 The shop session

`src/sim/campaign/shop-flow.ts` (`ShopFlow`, session in `state.shop.session`: dealer, dealer soldier, selected merc,
pricing merc, current boxes, collected repairs) is the SKI as a modal campaign state: game time does not pass, saving is
refused (`shopOpen`, `27`), and only shop commands, queries and `observe` are accepted. Opening runs the dealer and merc
checks of §9.1 (`CanMercInteractWithSelectedShopkeeper`), `AP_TALK` and facing, the repair delay (§10.5), the last-visit
time and the collection of finished repairs, delivered at once with the §9.5 rules. A trade is one atomic `PerformTransaction`
(`planTrade`/`executeTrade`) whose purchases, change and split-off repair parts are delivered at once with the Done rules;
the offer areas are not state (deviations "Shop as commands", "Talking to dealers", "Giving to a dealer"). The commands,
queries, events and view are `04` §6; the screen is `28` §5.9.

### 14.5 Stubs and verification

Stubs: `stubs/profiles.json` (`27` §6) has invented profiles at most dealer profile ids (Tony, Franz, Keith, Jake, Howard,
Sam, two bar brothers, Arnie, Fredo) with sectors in the stub map; `J:dealers.json` and the inventories apply unchanged.

Oracle: the probes `dealers`, `dealerinit`, `dealerdaily`, `progress`, `fact`, `dealerprice`, `dealersell`, `shophours`,
`dealerrepair`, `skiptime`, `dealergive` and `ski` (`tools/oracle/README.md` "Merchants", `merchant-compare.ts`) replay the
native draws through ja2-node and compare stock, prices, repairs and shop entry field by field.

---

## 15. Quirks, limitations and open questions

**Quirks kept** (Strac; = V unless marked):
- Orders arrive at the next daily update (`>=`), the reorder-day draw is wasted.
- Tony's limits count item types, remove one unit of a chosen type, weight with `<=`, and redraw when the stale total
  misses; the big-gun guarantee weights with `<=` too.
- Customers ignore the dealer's list; NONE items (coolness 0, not buyable, reduced gun list) all leave each morning —
  Jake's gas is sold out daily and re-guaranteed to 4–6; rocket rifles sold to Tony are gone the next day.
- Selling chances use `(chance + 5 × coolness) / 2`, halved again for specials; only between 0 and 100.
- Dealer cash resets daily, ignores offered money in the "can afford" test; Jake never refuses and is topped up; dealers
  without GIVES_CHANGE keep overpayment; money-only offers are gifts.
- Micky's drunk price is unreachable; Micky's purchases vanish.
- The weapon sale modifier applies to the sum for ≤ 8 objects and to the unit above; Strac extends it to blades,
  throwing knives and launchers and floors at $1 (V: Flo only, guns and ammo).
- The pricing merc is the SM-panel merc, possibly out of reach.
- JKF value the items they sell with the same class/Tony rules; the main item alone decides acceptance; unvalued ammo
  and attachments are taken anyway; detachable attachments are split off on sale; guns are sold empty and unjammed.
- Repairs: the electronics ×2 is dead; jobs may end at night; a start after closing pays a full night; the limit counts
  uncollected finished items; finished items are only collected by visiting; Fredo resets any imprint; a 100 % rocket
  rifle costs $100; the delay excuse happens once per repairman, needs a 3-hour gap since the last visit (the first visit
  always passes), `PreChance(50)`; `CalculateMinutesClosedBetween` double-counts and under-counts nights (§10.4).
- Dead dealers drop everything INVISIBLE at their initial tile on level 0, items in repair unrepaired, plus their cash;
  Manny's death counts even before he is a bartender.
- 255 units per item type; the excess vanishes. Elixir customers see at most 3 jars a day.

**Inferred, still unverified**:
- The exact cycling set of the pricing merc (`FindNextActiveAndAliveMerc`, not read).
- That the repairmen's maps carry lock/unlock schedule entries (without them there is no overnight delay).
- Trading in turn-based combat being allowed (talking is, `Handle_UI.cc:4630-4636`).
