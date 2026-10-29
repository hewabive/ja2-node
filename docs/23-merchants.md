# 23 — Merchants: arms dealers, repairmen and other shopkeepers

The 19 dealers of the tactical world: their stock and its daily turnover, cash, prices, what each one trades, the shop
visit with its transactions and repairs, and a dead dealer's goods. Siblings: `21` Bobby Ray's, which shares the
supply model; `24` talking to a dealer (the talk menu, Buy/Sell records, a give that opens the shop); `35` where a
dealer stands (Tony's 04:00 absences, Devin's moves, the schedules that give the shop hours); `25` the facts dealers
read and set, and the hospital (`hospital.ts`); `18` the finance ledger; `12` items and world item pools; `14` the
save section; `29` the shop commands, queries, view and events; `30` the shop screen. Dave's gas, Waldo, Darren's
fights, Kingpin and Carmen's bounties are NPC dialogue (`24`, `35`), Skyrider's fares `16`. Each module's `@src`
header names the Stracciatella functions it ports; read those for the formulas.

## 1. The path of the merchants

Paths are under `src/sim/strategic/economy/merchants/` unless they start with `campaign/` (`src/sim/campaign/`).

```
new game: initAllArmsDealers, after the profiles, before Bobby Ray     daily.ts, campaign/new-game.ts
09:00 DAILY_UPDATE_BOBBY_RAY_INVENTORY: Bobby Ray (21), then            campaign/campaign-sim.ts
  dailyUpdateOfArmsDealersInventory: Gabby's elixir, customers,         daily.ts, supply.ts, inventory.ts
  cash and restock, Tony's guarantee and limits, the minimums
FACT_ESTONI_REFUELLING_POSSIBLE set → Jake's gas                        campaign/narrative/narrative-flow.ts
openShop, or Buy/Sell in a conversation (24) → ShopFlow                 campaign/shop-flow.ts
  delay excuse, last visit, boxes, finished repairs delivered           repair.ts, boxes.ts
  quoteTrade | trade → planTrade, executeTrade, deliveries              trade.ts, pricing.ts, repair.ts
  setShopPricing, closeShop
a dealer's death commit (opcode 440, 33) → his goods on the floor       campaign/sector-flow.ts, death.ts
native save section 23 → importMerchants                                src/server/save-session.ts, save-import.ts
```

| Module | Holds |
|---|---|
| `context.ts`, `state.ts` | `MerchantContext` (state, streams, hooks, clock, progress, facts), Manny's bartender test; `MerchantState`: per dealer the status and one header per item |
| `supply.ts` | Item legality, dealer categories and the sort, suitability, buy and sell chances, the per-unit rolls; shared with Bobby Ray |
| `inventory.ts` | Adding and removing units, fresh stock and its condition, a sold object into stock, a box out of stock, stray rounds, the guarantees by item |
| `daily.ts` | The new-game stock and the 09:00 update; which items a dealer trades |
| `pricing.ts` | The value of an item to a dealer, the condition modifier, `calcShopKeeperItemPrice`; pure |
| `repair.ts` | What a repairman takes, cost and time, the queue, shop hours, overnight delays, closed minutes, the delay excuse |
| `boxes.ts`, `view.ts`, `events.ts` | The boxes of a visit, their sort, finished repairs collected; the shop view; the shop events |
| `trade.ts` | Evaluation and one transaction: `planTrade` decides without side effects, `executeTrade` applies |
| `death.ts`, `save-import.ts` | A dead dealer's goods; save section 23 (decoded by `src/content/formats/savegame-merchants.ts`) |
| `campaign/shop-flow.ts` | `ShopFlow`: the session, the opening checks, the commands, the deliveries |
| `src/content/strategic/merchant-content.ts` | `data/externalized/dealers.json` and `dealer-inventory-<profile>.json` as Stracciatella ships them (types, multipliers, cash, flags, list maxima), the weapon sale modifier of `mercs-profile-info.json`, `data/tables/merchant-tables.json` (`tools/transcribe/merchant-tables.ts`: roles, categories, sort order, staples, liquids) |

## 2. Design

**Dealers live in the strategic state.** Stock, cash, orders and repairs are `StrategicState.merchants`, indexed by
dealer id, the index in `dealers.json`; code names dealers by role (`merchant-tables.json` `dealerIds`). Between two
09:00 updates only a shop visit, Jake's gas when Estoni refuelling becomes possible and a dealer's death change them;
whether his sector is loaded never matters. Manny is a dealer only once `FACT_MANNY_IS_BARTENDER` holds.

**One supply model with Bobby Ray.** Suitability by coolness and progress, the chances and the rolls are `supply.ts`,
called with `BOBBY_RAY` by the laptop (`21`). A dealer stocks what his list allows (an entry of 0 means he buys the
item but never stocks it), restocks at half his maximum, and loses stock to simulated customers each morning; the
customers ignore his list.

**An item type is a counter plus special elements.** Units at 100 % with no imprint or attachment are a count;
anything else (used, in repair, imprinted, with attachments) is one element each. Elements are never compacted: an
inactive one is reused, so an element index names one object as long as it exists, and a box key `{item, element}`
(−1 for the perfect units) stays valid for a whole visit, since nothing restocks inside a shop. A repair is an element
with negated condition, its done time and its owner.

**Loops follow Stracciatella's order.** New-game and daily loops go through the items in content order
(`ItemTable.ordered`: items, magazines, weapons, explosives, armours, as Stracciatella's item container); the boxes and
the repair scans go by item index. Vanilla iterates by index everywhere; ja2-node follows Stracciatella (D1), and the
draws depend on it.

**Single precision.** The multipliers of `dealers.json` are `FLOAT`s: price and repair arithmetic rounds each
operation with `Math.fround`, as Stracciatella's SSE build does, then truncates (`pricing.test.ts`, `repair.test.ts`).

**The shop is a modal campaign state; a transaction is one command.** `ShopFlow` keeps the session in
`state.shop.session`; while it is open the clock stands, saving is refused and other commands are refused. The
original's two offer areas are not state: `trade` carries what to buy, sell, pay and repair, `planTrade` runs every
check of `PerformTransaction` without side effects, so a refused trade changes nothing, and `executeTrade` applies it.
Purchases, change and the parts a repairman splits off are delivered at once by the original's leaving rules, finished
repairs when the shop opens (deviations "Shop as commands", "Shop deduction prompt", "Unsellable shop items", "Refused
gift"). `openShop` is the talk and Buy/Sell in one command (deviation "Talking to dealers"); a give the dealer does not
take opens the shop (deviation "Giving to a dealer").

**The pricing merc.** Prices use one merc's weapon sale modifier, the original's single-merc-panel merc: the one who
opened the shop, then any regular merc of his squad the panel buttons reach (no E.P.C., no robot), even one out of
reach. Only Flo's differs from 100 (deviation "Pricing merc").

**Hooks.** `MerchantHooks` reach what lives elsewhere: `buySellRecordPending` and `shopClosedByScript` from the talk
and NPC-action flows (`24`, `35`), and `shopHours`, which `campaign-sim.ts` answers from the loaded sector's schedules
(`35`). The defaults (false, false, null) let a sandbox session trade without NPC records; without shop hours a
repair has no overnight delay.

**Cash is bookkeeping.** A dealer's cash resets to his initial cash at each 09:00 and is never shown; it only limits
what he buys (`dealerCannotAfford`). Money taken from the balance is booked as `PURCHASED_ITEM_FROM_DEALER` with the
dealer's profile; moving money between the account and a merc is `campaign/money-flow.ts` (`29`).

**Saves.** Section 23 of a native save is imported (`14`); ja2-node writes only its own saves and refuses to save
while a shop is open.

**Randomness.** The new-game stock, the 09:00 update and the Estoni gas draw on `main`; the delay excuse draws its
chance on `pre`, then its length on `main`. Pricing, trading and repairs draw nothing. The original's idle and
evaluation quote draws run on wall-clock time and are not drawn (deviation "Cosmetic shopkeeper draws"); Tony's and
Devin's coolness windows at a new game read progress 0 (deviation "Dealer initialisation progress").

**Stubs.** The stub pack has invented profiles at most dealer ids (`stubs/profiles.json`); those at Tony's and
Arnie's ids stand in A10 (`tests/support/stub-shops.ts`).

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Tests are in `src/sim/strategic/economy/merchants/` unless a
path says otherwise.

| Quirk | Test |
|---|---|
| An order arrives at the next 09:00 whatever its 1–3 days: the arrival test is `>=`, the day draw is wasted | `daily.test.ts` "restocks at half the maximum: instantly when first eligible, otherwise on the next update …" |
| Customers buy every unit of suitability none (coolness 0, not buyable, illegal, above Tony's or Devin's window) each morning, off the dealer's list too: Jake's gas, Tony's rocket rifles | `daily.test.ts` "sells every unit nobody should stock each morning …" |
| Tony's limits count item types, take one unit of a chosen type and redraw past a stale total; his big-gun guarantee gives the first candidate one extra value | `daily.test.ts` "limits item types …", "guarantees Tony a big gun …" |
| Jake's gas guarantee draws its count even when he has enough | `daily.test.ts` "guarantees Jake’s gas with a draw …" |
| A roll draws even at chance 0 or 100; selling chances add 5 per coolness point and halve, a used item's halve again, only strictly between 0 and 100 | `supply.test.ts` "draws even at chances 0 and 100 …", "halves selling chances …" |
| Creature blood is a staple, but the not-buyable test comes first | `supply.test.ts` "puts the not-buyable and coolness-0 tests before the staples" |
| A gun sold with a detachable scope is stocked with the scope and the scope again | `inventory.test.ts` "splits a sold gun into the gun, its bullets and every detachable attachment" |
| A dealer takes a sold gun's bullets he values at nothing: the gun alone decides | `trade.test.ts` "takes the bullets of a sold gun …" |
| Jake, Keith and Franz value what they sell as what they buy: a third out of their price class, half for Tony's goods | `pricing.test.ts` "values items by the price class rules of Jake, Keith and Franz" |
| The weapon sale modifier applies to the sum up to 8 objects and to the unit above; Stracciatella extends it to blades and launchers | `pricing.test.ts` "applies the weapon sale modifier …" |
| Micky pays his buying price: the drunk price looks for Micky on the player's team | `trade.test.ts` "pays Micky’s buying price …" |
| The can-afford test ignores the money offered; Jake never refuses and is topped up | `trade.test.ts` "refuses when the dealer cannot pay the difference …" |
| Dealers without change keep an overpayment; money alone is a gift | `trade.test.ts` "keeps overpayment …", "keeps money given to gift-taking dealers …" |
| The repair limit of four counts finished repairs not yet collected | `trade.test.ts` "counts uncollected repairs against the limit of four …" |
| A job started after closing pays a full night; one started before opening may end at night | `repair.test.ts` "delays a job that does not fit into the shop day" |
| Closed minutes count a same-time span's night twice and a two-day span one night short | `repair.test.ts` "counts closed minutes …" |
| A 100 % rocket rifle costs $100 to repair (the imprint reset) | `repair.test.ts` "reproduces the cost and time examples" |
| Arnie's "not repaired yet" quote 33 never plays: the original overwrites it | `src/sim/campaign/shop-scenario.test.ts` "greets with the usual quote at Arnie …" |
| Manny's death closes his shop and drops his stock even before he tends the bar | `death.test.ts` "include Manny before he tends the bar …" |
| An item type holds at most 255 units; the excess vanishes | `inventory.test.ts` "caps a type at 255 units …" |

Not pinned yet:
- A merc out of reach can be the pricing merc; his modifier still prices the trade.
- A 100 % rocket rifle counts as not needing repair when the repairman's room is checked, yet goes to him.
- Jake, Keith and Franz halve anything on Tony's list, his buy-only zero entries too.
- A dead dealer's goods appear hidden at his initial tile on level 0, items in repair unrepaired (`sector-flow.ts`).
- Electronic items take twice as long to repair except at Fredo, the only repairman who takes them.

## 4. Not checked against the native build

The oracle's merchant probes (`tools/oracle/README.md`, "Merchants") replay the native draws of the new-game stock, the
daily update, the Estoni gas and a shop entry with its delay excuse, and compare stock, cash, orders, special elements
and boxes field by field; prices, sales into stock, repair costs, times, overnight delays and queues compare directly,
and so does every save's dealer section. Transactions, the repairman's split and limit, the deliveries, the opening
checks and quotes and a dealer's death have no probe. Inferred from reading the source:
- That the repairmen's maps carry the lock and unlock schedule entries the shop hours come from.
- That blood reaches Gabby only at 100 %: a damaged jar would underflow his perfect count at the daily conversion.
- That the deduction box cannot fail between question and answer (it is modal), so one atomic trade is the same.
- That trading is allowed in turn-based combat, as talking is.

Not ported: gaps "Shop screen details".
