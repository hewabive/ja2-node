# 22 — Merc contracts and relationships

What follows the hire: the contract hour, the daily merc update with its loop over the profiles off the team, the
renewal sequence, extensions, departures with the equipment and the deposit refund, R.P.C. pay, salary growth, buddies
and hated mercs, team morale, the hiring check, reputation and the death rate. Siblings: `21` the laptop, the hire and
the arrival (arrival slots, hire costs, the M.E.R.C. account, life insurance, mail, history, personnel); `15` the clock
and the order of the 00:00 and hourly handlers; `16` squads and groups; `18` assignments; `19` merc death and capture;
`24` recruiting and escorting; `35` Slay's week and the profile insertion data; `33` morale events and stat changes;
`29` the contract commands, prompts and events. Each module's `@src` header names the Stracciatella functions it ports;
read those for the formulas.

## 1. The path of a contract

Paths are under `src/sim/campaign/`.

```
hireContract at the hire, mercArrived at the landing (21)          contracts/hire-contract.ts, contract-times.ts
00:00 DAILY_UPDATE_OF_MERC_SITE, then MERC_DAILY_UPDATE            contracts/merc-account.ts, contracts/daily.ts
  posts the warnings (05:30, 11:30, 17:30) and the renewal slots (07:30, 13:30, 19:30)
  team: captives' contracts frozen, days served, R.P.C. pay,       contracts/rpc-pay.ts
  daily morale, another contract lined up; man-days
  M.E.R.C. mercs of an invalid account quit
  profiles off the team: improvement, deaths elsewhere, away and back
MERC_ABOUT_TO_LEAVE → the warning, the renewal list                contracts/renewal.ts
BEGIN_CONTRACT_RENEWAL_SEQUENCE → ContractFlow.settle → renewalStep → contractRenewal prompt
  extend → mercContractHandling → insuranceExtension prompt       contracts/extension.ts
  dismiss, letGo or a refusal → beginRemoveMercFromContract        contracts/departure.ts
    → pendingEndings → mercDeparture prompt: here | elsewhere | rehire
    → strategicRemoveMerc: profile status, history, refund, removal from the world
hourly (15): updateBuddyAndHatedCounters, hourlyMoraleUpdate       team-morale.ts via battle-flow.ts
level gained → raiseSalaries                                       contracts/salary.ts
death → deathBookkeeping, lifeInsuranceOnDeath, mercMercDied,      merc-fate.ts (19) → contracts/contract-flow.ts
        buddyKilledQuotes
```

| Module | Holds |
|---|---|
| `contracts/contract-state.ts` | `MercContract` (`MercRecord.contract`), `ContractState` (`StrategicState.contracts`: renewal list and sequence, leave list, queued endings) |
| `contracts/contract-times.ts` | Arrival slots, the contract hour and end, the expiry predicates, the contract times the screens show (`src/server/contract-view.ts`) |
| `contracts/daily.ts`, `rpc-pay.ts` | The daily update: team, equipment complaints, another contract, daily morale, the profile loop; R.P.C. pay |
| `contracts/renewal.ts`, `extension.ts`, `salary.ts` | Refusal reasons, willingness, precedent bits, the warning, the sequence steps, the menu's shading; extending; raises per level |
| `contracts/departure.ts`, `merc-account.ts` | Dismissal, the departure options, the equipment here or through the leave list, `strategicRemoveMerc`, the deposit refund; quitting unpaid |
| `contracts/contract-flow.ts`, `context.ts`, `quotes.ts` | `ContractFlow` (events, prompts, commands, level-up and death hooks); `ContractHooks`; quote ids, history codes, special profiles |
| `contracts/save-import.ts` | Save sections 43 (renewal list) and 44 (leave list), the M.E.R.C. account status |
| `relations/` | Buddy and hated slots; the death rate, the reputation and the tolerances; `canMercBeHired`, which the A.I.M. site calls |
| `team-morale.ts`, `morale.ts` | The hourly relationship counters, team morale, the decays; `handleMoraleEvent`, which also moves the reputation (`33`) |

## 2. Design

**The contract hour.** An A.I.M. contract ends at a midnight plus the hour of the merc's arrival slot (07:00, 13:00 or
19:00); extensions add whole days, so the hour never changes. The warning comes at :30 two hours earlier and the
renewal at :30 of that hour; both test the day of the end and the slot's hour. A captive's contract gains a day each
midnight.

**Who has which contract.** Only A.I.M. mercs extend, warn and renew; M.E.R.C. mercs run on the account `21` settles
and quit the midnight it turns invalid, since the site update runs first; R.P.C.s are paid each midnight and quit on
the third unpaid one; I.M.P. characters have no contract. Everyone else gets the contract menu
(`canExtendContractForSoldier`: not a vehicle, an E.P.C., in transit or captive) so that he can be dismissed. Pay, the
profile loop and the unhired-death mail test the profile type of `mercs-profile-info.json`; the menu, renewal and
quitting test the soldier kind (`MercKind`).

**Relationships live on the profile.** Opinions, buddy and hated slots, tolerances and their running counts, the
complaint timer, the hangover and the precedent bits are `ProfileProgress` fields, read alike by renewal, the hiring
check, the hourly counters, team morale and the training bonus. Counts start from the tolerances only at the new-game
profile load, so spent tolerance and learned buddies and enemies last the campaign, across rehires. The counters tick
only between squad members, on both sides; team morale counts every awake teammate in the sector whatever his
assignment; a merc in a moving group sees only his group. No morale event fires when a merc leaves. Opinions of
profile ids ≥ 75 read 0 (deviation "Opinions of high profile ids").

**Endings are queued, decisions are prompts.** The original's dialogue events and message boxes become queued endings
(`pendingEndings`) and battle-flow prompts (`contractRenewal`, `mercDeparture`, `insuranceExtension`).
`ContractFlow.settle` runs the endings, then the renewal sequence, whenever no prompt is open outside autoresolve, where
the original's dialogue queue would run them after the quotes. The sequence advances synchronously after each answer,
opens the menu for unwilling mercs too and skips a listed merc who can no longer leave (deviations "Contract renewal
sequence", "Contract prompts", "Renewal of a merc who cannot leave", "Renewal list").

**Quotes are events.** Contract, relationship and morale lines are `mercQuote` events outside the dialogue queue, with
the merc they are about as `subject`; they need a profile, `OKLIFE`, no robot and no captivity (the gas test is gaps
"Dialogue queue conditions"). Boxes, mails and records: deviation "Contract presentation".

**Hooks.** `ContractHooks` (no-op defaults for sandbox sessions) connect the laptop (`LaptopFlow.contractHooks`:
insurance, the M.E.R.C. site, Larry's relapse, Speck's lost-merc flag, history, mail, personnel) and the narrative
(Slay's day; `mercLeavingTeam`, Iggy's move to the army, which only the contract-ending event runs). An insured merc's
extension offers the policy for the added days, priced with the new end, after the contract charge is booked.

**Saves and data.** The sequence flags are not in the native save, so an import starts without a sequence; the
strategic morale decay counter is saved (deviation "Strategic morale decay counter"). Quote ids, the precedent list,
special profiles and history codes are `data/tables/merc-quotes.json` and `merc-contracts.json`; `quotes.test.ts`
checks `quotes.ts` against them. `stubs/profiles.json` carries the relationship cases the tests use.

**Randomness.** Draws keep the original order on `main` and `pre`. Departure and renewal draws happen at the player's
answer, so the `main` stream follows the order of answers, which the command log keeps.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Tests are in `src/sim/campaign/contracts/` unless a path says
otherwise.

| Quirk | Test |
|---|---|
| The contract hour comes from the arrival slot, not from the end | `contract-times.test.ts` "takes the contract hour from the arrival slot …" |
| The expiry tests compare the end day: an unresolved contract is due again at its slot every later day | `contract-times.test.ts` "expires only during the contract hour …" |
| The warning subtracts two hours unsigned, so contract hours 0 and 1 are never "soon" | `contract-times.test.ts` "never warns for contract hours 0 and 1 …" |
| The last contract update is the arrival: early firing and the 48-hour quote ignore extensions | `contracts.test.ts` "books the extension, keeps the arrival …", "penalizes a dismissal …" |
| Precedent quote n sits on bit n − 1; the first entry and unlisted quotes, the buddy lines among them, share bit 31 | `quotes.test.ts` "puts precedent quote n on bit n - 1 …" |
| A spent hated tolerance refuses renewal wherever the hated merc is | `contracts.test.ts` "refuses over a hated merc whose tolerance is spent …" |
| A buddy on the team, even in transit, overrides every renewal refusal but a contract signed elsewhere; at hire every refusal but the hangover | `contracts.test.ts` "renews for a buddy …", `relations/relations.test.ts` "lets a buddy outweigh …" |
| Another contract is rolled only in the last three days; an overdue contract's unsigned day count never rolls | `contracts.test.ts` "rolls for another contract …" |
| The morale-scaled gun rating wraps as a signed byte: a top gun at high morale draws a complaint | `contracts.test.ts` "wraps the morale-scaled gun rating …" |
| A dead merc still on the team serves days, an R.P.C. is still paid and his low morale still costs reputation | `contracts.test.ts` "keeps a dead merc on the team …" |
| A merc killed on another job takes the same night's new-job roll and can come back alive | `contracts.test.ts` "lets a merc killed on another job …" |
| An R.P.C. is paid nothing unless the balance covers his arrears too; he quits with quote 55 (`AIM_SEEN_MIKE`), whines with 54 | `contracts.test.ts` "pays an R.P.C. nothing unless …" |
| Iggy never reaches the army when he quits unpaid: only the contract-ending event moves him | `contracts.test.ts` "keeps Iggy from the army …" |
| An empty-handed departure claims no leave slot, yet its delivery carries the gear of the next merc in that slot | `contracts.test.ts` "lets an empty-handed departure’s delivery …" |
| A hated teammate with his tolerance untouched already forces the hated team opinion; the scaling by spent tolerance is dead code | `team-morale.test.ts` "drops the whole opinion to hated …" |
| The reputation moves once per morale event, however many mercs it reaches | `relations/relations.test.ts` "changes once per event …" |
| The death rate wraps as an unsigned byte, and so does the death count | `relations/reputation.test.ts` "truncates deaths …", `contracts.test.ts` "logs the death …" |

Not pinned yet:
- An unresolved contract is listed again at the day's later warnings and on later days: the renewal list repeats him
  until a sequence completes.
- Two exhausted hated teammates both complain in the hour the shared complaint timer reaches 0.
- Leaving the gear here keeps the profile's kit, sending it to the airport zeroes it; a keys-only departure leaves the
  slot's previous owner on the delivery message.
- A captive removed from the team goes on the "fired" personnel list with the history "contract expired".
- A non-A.I.M. merc dismissed within three hours of arrival gets the hangover without the reputation loss.
- The profile loop counts an A.I.M. profile as offered to the player from his first away roll, a M.E.R.C. profile from
  day 4, which makes them eligible to die elsewhere.

## 4. Not checked against the native build

The oracle's contract probes (`tools/oracle/README.md`, "Contracts") run the daily update, the hourly counters with team
morale, the warning, the sequence step by step, extensions, dismissals, departures, the leave list, the M.E.R.C. site
update, level-ups and salary rounding on the user's saves, replay the traced draws and diff the contract fields, the
expiry and refusal predicates, the first buddy, the tolerance checks and the profiles. Inferred from reading the source:
- What the original does with a listed merc who died or was captured after the warning, and that the stale-index pass
  after the last list entry reaches nobody (deviations "Renewal of a merc who cannot leave", "Renewal list").
- That no native save holds a running sequence (its pause lock blocks saving).
- That a moving merc's sector is the one he left (`16`) for the equipment drop and the same-sector tests.
- That the death rate's float quotient never rounds across an integer for realistic counts.

Not ported: gaps "Relationship quotes", "Random gridnos in unloaded sectors", "Dialogue queue conditions"; refusing to
attack a buddy is deviation "Attack refusals".
