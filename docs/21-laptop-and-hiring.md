# 21 — The laptop and hiring

The laptop as game rules: A.I.M., M.E.R.C. and its account, I.M.P., Bobby Ray's, email, history, files, finances,
insurance, the florist and the personnel lists; the hire (`HireMerc`), the arrival (`MercArrivesCallback`, the landing
zone) and the laptop's part of a new game. Siblings: `22` what follows the hire (the contract hour, renewal, departures
and the deposit refund, the daily merc update with its unhired-profile loop, `CanMercBeHired`, salary growth); `23` the
dealers' supply model Bobby Ray's shares; `15` the clock, the event queue and `InitNewGame`; `16` squads and
`UpdateMercInSector`; `18` the finance ledger; `19` merc death and capture; `25` facts and quests; `35` the NPC actions
that reach the laptop (Kulba's gift, the terrorist files); `26` the flowers meanwhile; `29` the laptop commands, queries,
view and events; `30` the laptop pages in the client. Each module's `@src` header names the Stracciatella functions it
ports; read those for the formulas.

## 1. The path through the laptop

Paths are under `src/sim/campaign/`.

```
new game                                                  new-game.ts
  resetForNewGame, initNewGameProfiles, initBobbyRay,       laptop/laptop-flow.ts, profiles.ts, laptop/aim.ts,
  the mails, the M.E.R.C. day draw, openForNewGame           laptop/bobby-ray.ts
openLaptop … closeLaptop (the I.M.P. reminder)            laptop/laptop-flow.ts
  readEmail: the I.M.P. and M.E.R.C. bookmarks             laptop/mail.ts
  aimHire → canMercBeHired → hireMercCore → hireContract   laptop/aim.ts, relations/hiring-check.ts, laptop/hire.ts,
                                                           contracts/hire-contract.ts
  visitSite merc (Speck's opening), mercHire, mercPay      laptop/merc-site.ts
  impCreate                                                laptop/imp.ts
  bobbyRayOrder                                            laptop/bobby-ray.ts
  insure, orderFlowers, readFile                           laptop/insurance.ts, florist.ts, records.ts
DELAYED_HIRING_OF_MERC → mercArrives → mercArrived        laptop/laptop-flow.ts, contracts/hire-contract.ts
first compression → teamJackedInAndGearedToGo            hiring.ts (start sector, six-hour warp, ENRICO_CONGRATS)
00:00 DAILY_UPDATE_OF_MERC_SITE → mercSiteDailyUpdate     contracts/merc-account.ts, laptop/merc-site.ts
00:00 HANDLE_INSURED_MERCS; a death → payout events      laptop/insurance.ts
09:00 DAILY_UPDATE_BOBBY_RAY_INVENTORY, then the dealers  laptop/bobby-ray.ts, campaign-sim.ts
BOBBYRAY_PURCHASE → the delivery                          laptop/bobby-ray.ts, sector-loot.ts, sector-diff.ts
```

| Module | Holds |
|---|---|
| `laptop/laptop-state.ts` | `LaptopState` (`StrategicState.laptop`): the original's `LaptopSaveInfo` plus mail, history, files, the landing zone and the new-mail flag |
| `laptop/laptop-flow.ts` | `LaptopFlow`: the laptop flow, its commands and queries, the laptop events, the new-game hooks, the arrival up to the contract fields, the mails of contract events, Enrico's mails, battle history |
| `laptop/context.ts`, `events.ts` | `LaptopContext` (state, content, roster, streams, mail, history and money helpers); the laptop events |
| `laptop/mail.ts`, `records.ts` | Mail and the bookmarks reading sets; history, files, personnel lists, `timeQuestWasStarted` |
| `laptop/hire.ts` | `hireMercCore` (`HireMerc` without the contract fields), the team size, the landing zone and its reroutes |
| `laptop/profile-state.ts`, `profiles.ts` | Hireability, competence and the medical deposit; profiles at a new game with their kit price |
| `laptop/aim.ts` | Contact, the charge, `aimHire`, the message for an away merc; mercs on assignment and the active terrorists at a new game |
| `laptop/merc-site.ts`, `contracts/merc-account.ts` | Listings and unlocks, the outage, Speck's opening, the account and its payment; the account part of the daily site update |
| `laptop/imp.ts`, `imp-report.ts` | Slots, quiz, attitude, skills, attributes, gear, `impCreate`; the results mail text |
| `laptop/bobby-ray.ts` | Stock lists, restock, prices, orders, shipments, Kulba's gift, the delivery |
| `laptop/insurance.ts`, `florist.ts` | Life insurance with payouts and investigations; flower orders |
| `laptop/save-import.ts` | The laptop sections of a native save |
| `contracts/hire-contract.ts`, `contract-times.ts` | Contract fields at hire and arrival, the equipment complaint, the hated-arrives quotes; arrival slots and contract end |
| `hiring.ts` | The first landing; hires for campaigns built without a laptop |
| `finance-summary.ts` | The finance page's yesterday and today figures from the ledger (`finances.ts`, `18`) |
| `src/content/strategic/laptop-content.ts` | `LaptopContent`: the externalized JSON (listings, destinations, `imp.json`, Bobby Ray's stock), `data/tables/laptop.json` (mail offsets, senders, the quiz, named profiles; `tools/transcribe/laptop.ts`), the bouquet prices |
| `src/server/` | `laptop-view.ts`, `mail-text.ts`, `history-labels.ts`, `finance-labels.ts`, `personnel-view.ts`; `campaign-factory.ts` hires a session's squad through the same commands |

The profile fields the laptop changes live in `StrategicState.profiles` (`ProfileProgress`), a merc's contract fields in
`RosterMerc.contract` (`22`).

## 2. Design

**The laptop is a modal flow.** `flow = 'laptop'` stands for the laptop screen: the clock is stopped, the loaded sector
frozen, `advance` and every non-laptop command refused; nothing in the laptop takes game time. Each decision is one
command that carries what the pages collect (the whole Bobby Ray cart, every I.M.P. choice), so pages, confirmation
boxes and drafts stay in the client (deviation "Laptop as commands"). Queries (`aimQuote`, `hireCheck`,
`bobbyRayQuote`, `impPreview`, …) work in any flow and never act. `openLaptop` works only from the strategic flow, stops
compression, and is refused while a battle prompt is open, the pre-battle interface is pending or the renewal sequence
runs: the state-based part of `AllowedToExitFromMapscreenTo`.

**What the original runs on UI timers runs at a command.** Speck's opening and its draws run at a laptop session's first
`visitSite merc`, or at its first M.E.R.C. command without a visit (deviation "Speck's opening"); the florist's
order-number draw runs at `visitSite floristOrderForm` (deviation "Florist order form entry"). A.I.M. annoyance runs on
the wall clock and is not simulated; its statuses and reset event stay for imports (deviation "A.I.M. annoyance").
Cosmetic draws the original takes from the gameplay stream are not drawn (deviation "Cosmetic laptop draws").

**Sites open through mail.** Opening `IMP_EMAIL_INTRO` or `IMP_EMAIL_AGAIN` bookmarks I.M.P., opening `MERC_INTRO` or
`MERC_NEW_SITE_ADDRESS` bookmarks M.E.R.C.; these are the only effects of reading a mail. Until then the site's commands
answer `noBookmark`, and an intro mail deleted unread locks its site for good, as in the original.

**One hire for every site.** A.I.M., M.E.R.C. and I.M.P. go through `hireMercCore` and the contract flow's
`hireContract`, and so do the session factory's squad (as `aimHire` and `impCreate` commands) and the campaigns that
tests build without a laptop (`hiring.ts`). Every hire before the first landing comes in with the first squad's helicopter;
later hires land at the landing zone on the next arrival slot. The zone is rerouted when the enemy holds it and reset to
the start sector when the enemy takes its airspace; the original's message boxes become the events `arrivalRerouted`
and `landingZoneReset`.

**Money.** A.I.M. charges at hire; M.E.R.C. mercs accrue a day's salary every midnight and the player settles the
account on the site, greedily in listing order; an I.M.P. character costs 3000 once and is never paid. Game logic reads
only the balance. The finance page's day figures are computed in the simulation (`finance-summary.ts`), so their quirks
stay out of the client.

**Bobby Ray's is a dealer.** Stock, restock and quality use the dealers' supply model (`economy/merchants/supply.ts`,
`23`), and the 09:00 update runs before the dealers'. A delivery is an event: the items land hidden in the loaded world
or in the sector's diff, the crate closes the same way, and the shipment facts go to the narrative fact store, where
Pablo's quests read them (`25`). The theft counter, a function static in the original, is saved (deviation "Bobby Ray
theft counter").

**Fresh-process values.** Where the original reads what an earlier game of the same process left behind (the M.E.R.C.
listing index, the progress Bobby Ray's first stock reads, the skill an empty I.M.P. list returns), ja2-node uses what a
fresh process has (deviation "I.M.P. empty skill list").

**Text is the server's.** Mail subjects and bodies, the I.M.P. report, history and ledger labels and the personnel blocks
are rendered in `src/server/` from the user's data; the simulation keeps offsets, codes and amounts. Stubs
(`stubs/profiles.json`, `stubs/text/`) stand in for `prof.dat` and the laptop texts in CI.

The laptop's other deviations: "Email order", "Speck payment record", "Bobby Ray's shipment prices", "Soldier creation
draws", "Cosmetic face and frame draws", "Cheats".

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Tests are in `src/sim/campaign/laptop/` unless a path says
otherwise.

| Quirk | Test |
|---|---|
| The first squad lands at 07:00 but shows 07:30, and the contract hour comes from the shown time: a week ends on day 8 at 07:00 | `laptop.test.ts` "charges salary plus kit and the deposit …" |
| A later hire's contract end counts a day for the flight at hire and is recomputed from the arrival day | `laptop.test.ts` "flies a later hire in on the next slot …" |
| The A.I.M. charge is two ledger records, salary with kit and then the deposit; buying the kit zeroes its price for good | `laptop.test.ts` "charges salary plus kit and the deposit …" |
| The kit price is one item price per inventory slot, whatever the count in the slot | `profile-state.test.ts` "adds one price per inventory slot …" |
| `IsMercHireable` accepts the merc who will not take calls; only the contact keeps him out | `profile-state.test.ts` "accepts the available and the slightly annoyed …" |
| The landing zone reroute never picks row P | `rules.test.ts` "never picks row P" |
| The reroute truncates the distance, so a diagonal neighbour scanned first beats a straight one | `rules.test.ts` "truncates the distance …" |
| An I.M.P. character's endless contract (−1 days) leaves his profile status at −1, the status of a merc without text | `laptop.test.ts` "lands the character with the profile status …" |
| The I.M.P. attitude die is rolled even when one attitude leads alone | `rules.test.ts` "rolls the attitude die …" |
| A skill the stats rule out is removed by moving the last skill into its place, which reorders the list before the draws | `rules.test.ts` "drops a skill the stats rule out …" |
| The I.M.P. reminder is posted again on every exit from the laptop until it is sent | `laptop.test.ts` "posts the I.M.P. reminder on every exit …" |
| Re-hiring a M.E.R.C. merc sets his unpaid days to 1: the old debt is forgotten | `laptop.test.ts` "forgets the unpaid days …" |
| The account status changes on `!=`, so a smaller debt moves a suspended account back to a first warning and mails the warning again | `laptop.test.ts` "moves a suspended M.E.R.C. account back …" |
| The new-merc event is posted again every midnight while a listing waits to be revealed | `rules.test.ts` "posts the new-merc event again …" |
| A used item that becomes eligible for the first time stocks the new slot (no used offset), and the used slot stays on order for good | `rules.test.ts` "stocks the new slot when a used item …" |
| Only shipment slot 0 is ever reused | `rules.test.ts` "reuses only the first shipment slot …" |
| An order to a city Bobby Ray cannot deliver to takes the money and ships nothing | `rules.test.ts` "takes the money for an order …" |
| A gun ordered alone arrives empty, every gun of a larger line is recreated loaded | `rules.test.ts` "delivers a gun ordered alone empty …" |
| In an unloaded sector Pablo never steals the first two units of a line | `rules.test.ts` "never lets Pablo steal …" |
| A delivery outside Drassen reads its line count from shipment 0 | `rules.test.ts` "delivers outside Drassen only …" |
| An insurance purchase refused for lack of funds still adds its length | `rules.test.ts` "adds the length of a purchase it refused …" |
| The payout slot of a death found to be fraud is never freed | `rules.test.ts` "keeps the payout slot …" |
| The insurance day counts are unsigned and wrap | `rules.test.ts` "wraps the unsigned day counts …" |
| Flowers are charged without a balance check | `rules.test.ts` "charges a bouquet without looking at the balance" |
| Every mail raises the new-mail flag, pre-read ones too | `src/server/laptop-stub.test.ts` "raises the saved new-mail flag …" |
| The finance page's day arithmetic: yesterday's opening balance from three days back, unsigned day numbers | `src/sim/campaign/finance-summary.test.ts` |

Not pinned yet:
- M.E.R.C. hires keep insertion `NORTH` (`MercFilesHireMerc` leaves it at 0) where A.I.M. and I.M.P. hires use
  `ARRIVING_GAME`.
- The letter goes to soldier 0 of a new game, whoever that is.
- A dead M.E.R.C. merc still on the team counts toward the account's longest debt without accruing; a fired one stops
  counting but stays owed. Larry's profile swap leaves the unpaid days and the cost to date on the other profile.
- A Bobby Ray cart line takes a 201st unit (`MAX_UNITS_PER_LINE`).
- `HireMerc` returning "too many mercs" counts as an I.M.P. success in the original (slot taken, nothing charged);
  `impCreate` checks the team first, so it cannot happen here.
- All six terrorist files arrive, whichever terrorists are active.
- An insurance payout prices the missed days at the merc's current cheapest daily rate; a clean death investigated
  because of the counter gets both the "investigation over" and the payment mail.
- The quirks of the daily profile loop (who goes away, who comes back, unhired deaths) are `22`'s.

## 4. Not checked against the native build

The oracle's laptop and florist probes (`tools/oracle/README.md`, "Laptop") replay the traced draws of full new games,
the arrival table, A.I.M., M.E.R.C. and I.M.P. hires, Bobby Ray's restocks, orders and deliveries, insurance and florist
orders on the user's saves, and diff the laptop, the team's contract fields and the profiles. Inferred from reading the
source:
- That the map screen, and so the laptop, can be reached during a tactical battle.
- That the I.M.P. attribute page reaches exactly the attribute sets `impCreate` accepts.
- What the used restock without the used offset does over a campaign; that I.M.P. characters are never paid; that a
  re-hire forgets a M.E.R.C. merc's debt.
- That an intro mail deleted unread locks its site.
- That moving Speck's opening to a command only changes its order against other laptop commands: with the clock
  stopped no strategic draw can come between.
- That the flowers meanwhile has no implications (`26`).

The content identity hashes text files by presence, so a data folder whose florist gallery text carries other bouquet
prices is not told apart from the one a save was made with.

Not ported: gaps "I.M.P. skill page and saved profiles", "Laptop video faces".
