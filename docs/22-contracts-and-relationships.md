<!-- Merc contracts and relationships: an implementable spec for M5. 2026-10-16.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–21) and reference/stracciatella/assets/externalized,
cross-checked against vanilla (reference/vanilla/ja2/Build) where marked. Read-only research: nothing was built or run. -->

# 22 — Merc contracts and relationships

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `V:` is vanilla `Build/`; JSON files are
`assets/externalized/*.json` (copied to `data/externalized/`). "(inferred)" marks conclusions not traced end to end;
everything else was read in the code. C integer semantics apply: `/` truncates toward zero (`idiv`), unsigned
subtraction wraps (`u32`), `INT8`/`UINT8` stores wrap (`i8`/`u8`). `Random` and `Chance` are the `main` stream,
`PreRandom` the `pre` stream (`01` §3.6); `Chance(x)` is `Random(100) < x` and draws even for `x = 0`; `Random(0)` returns
0 without drawing, `Random(1)` draws. Times are world minutes (`GetWorldTotalMin`) unless marked; `day`/`hour` are
`GetWorldDay()`/`GetWorldHour()` (`15` §1.1). "Team order" is soldier id order over the OUR team, `FOR_EACH_IN_TEAM`.
Quote numbers are the `Tactical/Dialogue_Control.h:11-160` enum values (§10.1). Merc kinds (`ubWhatKindOfMercAmI`):
`PLAYER_CHARACTER 0` (I.M.P.), `AIM_MERC 1`, `MERC 2` (M.E.R.C.), `NPC 3` (recruited RPCs), `EPC 4`, `NPC_UNEXTENDABLE 5`,
`VEHICLE 6` (`roster.ts` `MercKind`). Profile *types* (`AIM`, `MERC`, `IMP`, `RPC`, `NPC`) come from
`mercs-profile-info.json` (`MercProfile::isRPC()` etc., `externalized/mercs/MercProfile.cc:52-94`) and are not the same thing
as the soldier kind.

**Companions.** `21-laptop-and-hiring.md` owns the A.I.M., M.E.R.C. and I.M.P. sites, `HireMerc`, hire costs, the AIM video
conference and its refusals flow, the M.E.R.C. account page (`SettleMercAccounts`), email, the history and personnel pages and
the arrival callback as a whole; this spec gives the contract fields hiring must set (§1.2) and the relationship and
reputation tests the AIM site calls (§5.4). `23-merchants.md` owns arms dealers and repairs. `11` §9 owns the morale event
table and `UpdateSoldierMorale`; §10 owns `StatChange`/`ProcessStatChange`. `15` owns the clock, the event queue, the order of
the 00:00 events and the hourly update. `16` owns squads, groups, `RemoveCharacterFromSquads`, `RemoveGroup` and
`CheckAndHandleUnloadingOfCurrentWorld`. `18` §5 owns assignments (the training opinion bonus reads §5 opinions). `19` §3.8
owns merc death and capture. `14` owns the savegame container.

---

## 0. State this spec adds

**Soldier, OUR team** (all saved in the soldier record, `Tactical/LoadSaveSoldierType.cc:382-386, 400-405, 464-476,
526-550`; every field is already in `SOLDIER_LAYOUT`, `savegame-soldier.ts`):

| Field | Original | Notes |
|---|---|---|
| `kind` | `ubWhatKindOfMercAmI` | `RosterMerc.kind` exists |
| `contractEnd` | `iEndofContractTime` (INT32 minutes) | AIM: departure minute; M.E.R.C.: minute of death (§4.9); others: meaningless |
| `contractStartDay` | `iStartContractTime` | M.E.R.C. only: day hired (display) |
| `totalContractLength` | `iTotalContractLength` (INT32 days) | AIM: days bought so far; RPC: days on the team |
| `typeOfLastContract` | `bTypeOfLastContract` | `CONTRACT_EXTEND_1_DAY 0`, `_1_WEEK 1`, `_2_WEEK 2` (`Strategic/Merc_Contract.h:8-13`) |
| `timeCanSignElsewhere` | `iTimeCanSignElsewhere` | gate for `CheckIfMercGetsAnotherContract` (§2.3) |
| `signedAnotherContract` | `fSignedAnotherContract` | never cleared while on the team |
| `lastContractUpdate` | `uiTimeOfLastContractUpdate` | set **only on arrival** (§1.2) |
| `timeWillArrive` | `uiTimeSoldierWillArrive` | minute of the arrival slot; its hour is the contract hour (§1.2) |
| `renewalQuoteCode` | `ubContractRenewalQuoteCode` | `NOT_USED 0`, `89_USED 1`, `115_USED 2` (`Tactical/Soldier_Control.h:119-121`) |
| `leaveHistoryCode` | `ubLeaveHistoryCode` | history code for the departure (§4.5) |
| `medicalDeposit` | `usMedicalDeposit` | deposit actually paid at hire (AIM) |
| `contractPriceIncreased` | `fContractPriceHasIncreased` | set by a level-up (§3.7) |
| insurance | `usLifeInsurance`, `iStartOfInsuranceContract` (day), `iTotalLengthOfInsuranceContract` (days), `uiStartTimeOfInsuranceContract` (minute) | §7 |
| morale | `bMorale`, `bTeamMoraleMod`, `bTacticalMoraleMod`, `bStrategicMoraleMod`, `bDelayedStrategicMoraleMod` | exist on `Soldier` (`11` §9) |
| quote flags | `usQuoteSaidFlags` bits `LOW_MORAL 0x10`, `ANNOYING_MERC 0x40`, `LIKESGUN 0x80`, `PERSONALITY 0x4000`, `FOUND_SOMETHING_NICE 0x8000`; `bCorpseQuoteTolerance` | daily resets (§2.1) |

**Campaign profile** (the game's mutable `gMercProfiles[]`, saved in section 5; initial values from `prof.dat`, imported, never
committed). Fields this spec reads or writes, with their offsets in the 716-byte Windows record (computed from the extraction
order in `Tactical/LoadSaveMercProfile.cc:36-208`; the anchors already used by `prof.ts`/`savegame-profile.ts` agree):

| Field | Offset | Field | Offset |
|---|---|---|---|
| `bArmourAttractiveness` i8 (recomputed at load) | 230 | `bMercOpinion[75]` i8 | 576 (exists) |
| `bSexist` u8 | 234 | `bMercStatus` i8 | 652 (exists in `savegame-profile.ts`) |
| `bLearnToHate` i8 | 235 | `bHatedTime[5]` i8 | 653 |
| `bDeathRate` i8 | 239 | `bLearnToLikeTime`, `bLearnToHateTime` i8 | 658, 659 |
| `uiDayBecomesAvailable` u32 | 292 | `bHatedCount[5]` i8 | 660 |
| `usTotalDaysServed` u16 | 322 (exists) | `bLearnToLikeCount`, `bLearnToHateCount` i8 | 665, 666 |
| `sSalary` i16 | 332 (exists) | `iBalance` i32 | 676 |
| `bReputationTolerance` i8 | 338 | `ubMiscFlags3` u8 | 689 (exists) |
| `bBuddy[5]`, `bHated[5]` i8 | 342, 347 (exist) | `ubDaysOfMoraleHangover` u8 | 690 |
| `bMainGunAttractiveness` i8 (recomputed at load) | 404 | `uiPrecedentQuoteSaid` u32 | 692 |
| `uiWeeklySalary`, `uiBiWeeklySalary` u32 | 540, 544 | `ubTimeTillNextHatedComplaint` u8 | 702 |
| `bMedicalDeposit` i8 (flag) | 548 | `ubSuspiciousDeath` u8 | 703 |
| `sMedicalDepositAmount` u16 | 552 | `iMercMercContractLength` i32 | 704 |
| `bLearnToLike` i8 | 554 | `uiTotalCostToDate` u32 | 708 (`state.finances.profileCostToDate`) |
| `usOptionalGearCost` u16 (recomputed at load) | 574 | `bPersonalityTrait`, `bAttitude` | 336, 549 (exist) |

At profile load (`InitProfileFromContent`, `Tactical/Soldier_Profile.cc:188-217`) the attractiveness values and the optional
gear cost are recomputed from the profile inventory (last gun's `ubDeadliness`, last armour's protection, sum of prices) and
**`bHatedCount[0..1] = bHatedTime[0..1]`, `bLearnToHateCount = bLearnToHateTime`, `bLearnToLikeCount = bLearnToLikeTime`**.
`mercs-relations.json` may override opinions and relations (`DefaultContentManager.cc:1285-1290`,
`MercProfile::deserializeStructRelations`); the shipped file is an empty array.

**Global** (saved): `strategicStatus.mercDeaths` (u8), `.manDaysPlayed` (u32), `.badReputation` (u8 0–100),
`.insuranceInvestigations`, `.unhiredMercDeaths` (all exist in `state.status`); the renewal list `ContractRenewalList[20]` of
profile ids and its count `ubNumContractRenewals` (save section 43, 81 bytes: 20 × {u8 profile, 3 filler} + u8 count,
`Merc_Contract.cc:40-82`); transient renewal sequence flags `gfContractRenewalSquenceOn`, `ubCurrentContractRenewal`,
`ubCurrentContractRenewalInProgress`, `gfInContractMenuFromRenewSequence` (not saved: a save cannot be made while the
sequence locks the pause, inferred); the 20-slot leave item list and its owners (section 44, `Map_Screen_Interface.cc:4043-4128`);
laptop info: `gubPlayersMercAccountStatus`, the life insurance payout list, the personnel dead/left/other lists
(`Laptop/LaptopSave.h:83-110`, already in `savegame.ts`'s layout).

**What M4 code must change** (findings):
1. `ProfileProgress.buddies`/`.hated` are readonly copies of `prof.dat` and `Roster.opinion()` reads `content.profiles` (static).
   The original's relations are mutable campaign state: slot 2 of `bBuddy`/`bHated` and `bMercOpinion[]` change at run time
   (§5.2). The morale fan-out (`morale.ts` `teammateDied`), the training opinion bonus (`18` §5.8) and §5 must read one mutable
   campaign profile.
2. `MERC_DAILY_UPDATE` has no handler; the `updateBuddyAndHatedCounters` and `hourlyMoraleUpdate` slots of `PeriodicSlots` are
   empty (deviation "Hourly morale"). §2, §5.2 and §5.3 fill them.
3. `morale.ts` changes no reputation (§6.2) and lacks the low-morale quote flag (`11` §9).
4. `hiring.ts` sets no contract field and `mercArrives` does not compute the contract end (§1.2); every hire is `AIM_MERC`.
5. The roster cannot remove a merc. Dead mercs must stay on the roster with `ASSIGNMENT_DEAD` until the player removes them
   (`removeMerc`, §4.1): the daily update still processes them (§2.1).
6. `prof.ts`/`savegame-profile.ts` lack the fields above; the save import maps none of the soldier contract fields and skips
   sections 43 and 44.
7. `strategicHandlePlayerTeamMercDeath` must add the M5 parts (§4.9) and `mercDeaths` must wrap as a `u8`.

---

## 1. Kinds, contract fields and contract times

### 1.1 Who has which contract

| Kind | Contract | Ends by | Pay |
|---|---|---|---|
| A.I.M. | 1, 7 or 14 days, extendable | renewal sequence at the arrival slot (§3) | up front: hire (`21`), extensions (§3.6) |
| M.E.R.C. | open-ended | player dismisses, or quits when the account turns invalid (§4.7) | daily accrual settled on the M.E.R.C. site (`21`) |
| RPC (kind `NPC`) | open-ended | dismissed; quits after 3 unpaid days (§4.8); hated-merc rules (§5.2); Slay leaves after a week (M6) | `sSalary` per day at 00:00 (§4.8) |
| I.M.P. | none | dismissal only | none |
| EPC | none | "unrecruit" from the assignment menu (M6) | none |

`CanExtendContractForSoldier` (`Strategic/MapScreen.cc:6779-6798`) gates the contract button and menu: not a vehicle, not an EPC,
not `IN_TRANSIT`, not `ASSIGNMENT_POW`. Everyone else (I.M.P., M.E.R.C., RPCs, mercs below OKLIFE) gets the menu so that they can
be dismissed; only A.I.M. mercs can extend (§3.4).

### 1.2 Contract fields at hire and arrival

`HireMerc` (`Tactical/Merc_Hiring.cc:62-218`, owned by `21`) sets, in order: `IN_TRANSIT`; `totalContractLength = h.length`
(AIM 1/7/14, M.E.R.C. 1, I.M.P. −1); insurance fields 0; **`timeWillArrive = h.arrivalMinute`** (the caller's
`GetMercArrivalTimeOfDay()`, *before* the game-start override below); then

```
if didGameJustStart: h.arrivalMinute = (STARTING_TIME + FIRST_ARRIVAL_DELAY)/60          // Day 1 07:00
                     contractEnd = MidnightOfFutureDay(len) + ContractHour(s)*60
else:                contractEnd = MidnightOfFutureDay(1 + len) + ContractHour(s)*60      // provisional, "+1 for the flight"
AIM:  typeOfLastContract = 0/1/2 for 1/7/14; timeCanSignElsewhere = now for 1 and 7, = contractEnd for 14;
      medicalDeposit = profile.sMedicalDepositAmount
M.E.R.C.: profile.iMercMercContractLength = 1; contractStartDay = day
```

`MercArrivesCallback` (`:224-348`, at the arrival event) then sets `profile.bMercStatus = u8(totalContractLength)`,
**`lastContractUpdate = now`** and recomputes **`contractEnd = MidnightOfFutureDay(totalContractLength) + ContractHour(s)*60`**
(`:314-321`), and posts an equipment complaint at `540 + Random(660)` today if `SoldierHasWorseEquipmentThanUsedTo` (§2.2) and
the minute is still ahead (`:324-337`). `HandleMercArrivesQuotes` (`:395-422`): every AIM merc on the team whose hated slot 1/2
(not the learned slot) holds the arriving profile says quote 49/50 (`HATED_1/2_ARRIVES`).

```
GetMercArrivalTimeOfDay():                                            // Merc_Hiring.cc:424-459 (21 owns the call)
  h = hour; if h > 13: return midnight(tomorrow) + 7:30
  m = h + 6 (MIN_FLIGHT_PREP_TIME); m <= 7 → today 7:30; m <= 13 → today 13:30; else today 19:30
ContractHour(s) = (timeWillArrive % 1440) / 60                        // GetHourWhenContractDone, Merc_Contract.cc:983-991
MidnightOfFutureDay(d) = now + d*1440 − minutesIntoToday               // Game_Clock.cc:150-153
```

So an A.I.M. contract ends at **07:00, 13:00 or 19:00** (the hour of the arrival slot, `Merc_Hiring.h:14-16`), and the renewal
happens at :30 (§3.3). The opening squad is hired at Day 1 01:00, gets slot 07:30 (hour 7), lands at 07:00 and a 7-day contract
ends at Day 8 07:00. A merc hired on Day 5 at 10:00 flies at 19:30 and a 1-day contract ends at Day 6 19:00. An extension adds
`len × 1440` to `contractEnd` (§3.6), so the hour never changes for the whole employment.

### 1.3 Contract time as the player sees it

All displays clamp an in-transit merc's remaining time to `totalContractLength × 1440` (the provisional end includes the flight
day). Only A.I.M. mercs (and Slay) show a contract time; M.E.R.C. mercs show `unpaid days / days hired`; others N/A.

| Where | Formula | Source |
|---|---|---|
| Team list column | `r = contractEnd − now` (clamped); `r ≥ 3 days` → `r/1440` "d" green; else `(r > 5 ? (r + 59)/60 : 0)` "h" red, flashing white when `r ≤ 240` | `MapScreen.cc:7697-7732`, `:100, :107` |
| Merc info panel | `r ≥ 1440` → `r/1440.0` with one decimal "d / total d"; else hours as above "h / total d"; daily rate: AIM `biweekly/14`, `weekly/7` or `sSalary` by `typeOfLastContract`, others `sSalary`; medical deposit `profile.sMedicalDepositAmount` if > 0 | `MapScreen.cc:834-899` |
| M.E.R.C. merc | `iMercMercContractLength` "d / " `(now/1440 − contractStartDay)` "d" | `MapScreen.cc:866-871` |
| Personnel screen | `r = max(0, contractEnd − now)` (clamped); `days = r/1440`, `hours = r%1440/60`; total days served; total cost; daily rate (as above); medical deposit, or for M.E.R.C. "unpaid" `sSalary × iMercMercContractLength` | `Laptop/Personnel.cc:2285-2381` |

Morale is shown as a bar in tactical and as text on the map (`GetMoraleString`, `Map_Screen_Interface.cc:960-970`): dead → "Bad",
`> 80` Great, `> 65` Good, `> 35` Stable, `> 20` Poor, else Panic. Opinions, relations, tolerances, the death rate and the
reputation are never displayed.

---

## 2. The daily merc update

### 2.1 `MercDailyUpdate` (`Strategic/Strategic_Merc_Handler.cc:135-370`)

Runs on the everyday `MERC_DAILY_UPDATE` event at 00:00, after `DAILY_UPDATE_OF_MERC_SITE` (§4.7) and `HANDLE_INSURED_MERCS`
(§7) and before `SETUP_MINE_INCOME` and the 00:00 hourly update (`15` §3.1).

```
if day == 1: return
if CalcDeathRate() < 5: HandleMoraleEvent(null, LOW_DEATHRATE, nowhere)        // +5 everyone; reputation +5 (§6)
post same-day events (param 0), in this order:
  MERC_ABOUT_TO_LEAVE at 05:30, 11:30, 17:30; BEGIN_CONTRACT_RENEWAL_SEQUENCE at 07:30, 13:30, 19:30
for s in OUR team, team order:
  if s.assignment == POW: s.contractEnd += 1440                                    // contract frozen while captive
  elif s.assignment != IN_TRANSIT:                                                 // includes ASSIGNMENT_DEAD still on the team
    s.quoteSaid &= ~(ANNOYING_MERC | LIKESGUN | FOUND_SOMETHING_NICE)
    s.corpseQuoteTolerance = max(0, s.corpseQuoteTolerance − 1)
    if p.personality in {HEAT_INTOLERANT, CLAUSTROPHOBIC, NONSWIMMER, FEAR_OF_INSECTS}: s.quoteSaid &= ~PERSONALITY
    if SoldierHasWorseEquipmentThanUsedTo(s): post same-day MERC_COMPLAIN_EQUIPMENT at 360 + Random(1080), param profile
    p.totalDaysServed++ (u16); p.miscFlags3 |= PLAYER_HAD_CHANCE_TO_HIRE
    if profile type RPC: s.totalContractLength++; RpcDailyPay(s)                   // §4.8
    DailyMoraleUpdate(s)                                                            // §2.4
    CheckIfMercGetsAnotherContract(s)                                               // §2.3
  if s.assignment not in {DEAD, IN_TRANSIT}: status.manDaysPlayed++                  // POW counts
if mercAccountStatus == INVALID:
  for s in OUR team, team order: skip POW, IN_TRANSIT, kind != MERC, life < CONSCIOUSNESS (10); MercsContractIsFinished(s)  // §4.7
for pid in 0 .. NUM_PROFILES−1 (200 in Strac, 170 in V; the extra slots are empty):
  if p.status == MERC_IS_DEAD: continue
  p.precedentQuoteSaid = 0
  if a soldier with this profile is on the OUR team (any assignment): continue
  if profile type AIM or MERC and p.status != RETURNING_HOME:
    HandleUnhiredMercImprovement(p)                                                 // §2.5
    if p.status == WORKING_ELSEWHERE: HandleUnhiredMercDeaths(pid)
  if p.dayBecomesAvailable > 0:
    if --p.dayBecomesAvailable == 0 && p.status != FIRED_AS_A_POW:
      p.status = MERC_OK; if miscFlags3 & PLAYER_LEFT_MSG_FOR_MERC_AT_AIM: clear it, email "merc is back" (21)
  elif profile type AIM or MERC:
    chance = pid < 40 (MAX_NUMBER_MERCS) ? 2*exp (and set PLAYER_HAD_CHANCE_TO_HIRE)
                                         : exp (set the flag only when day > 3, DAYS_TIL_M_E_R_C_AVAIL)
    if Random(100) < chance: p.status = WORKING_ELSEWHERE; p.dayBecomesAvailable = 1 + Random(6 + exp/2)
  if p.hangover > 0: p.hangover--                                                    // off-team profiles only
HandleSlayDailyEvent()                                                               // M6: Slay leaves when contractEnd/1440 <= day
```

V matches in order and content (V: `StrategicMercHandler.c:160-330`, RPC test by profile range). A dead merc who was not yet
removed still gets days served, an equipment check, `DailyMoraleUpdate` (with its reputation side effects, §6.2) and the
another-contract roll; this is why dead mercs must stay on the roster (§0).

### 2.2 Equipment complaints

`SoldierHasWorseEquipmentThanUsedTo(s)` (`:434-488`): over all 19 inventory slots, best gun `ubDeadliness` and best armour
protection (−1 if none); each found value is rescaled `v = v * (50 + morale) / 100` **stored in an INT8** (a 100-deadliness gun
at morale ≥ 78 wraps negative); complain if `gun != −1 && gun < p.mainGunAttractiveness/2` or the same for armour.
`MercComplainAboutEquipment(profile)` (`:491-523`, the event): Larry swaps to his current profile; the soldier must be awake,
`life ≥ OKLIFE`, on a squad, and the test must still hold → quote 43 (`WHINE_EQUIPMENT`). No draws in the handler.

### 2.3 Another contract lined up (`CheckIfMercGetsAnotherContract`, `Merc_Contract.cc:522-541`)

```
if kind != AIM: return
if now <= u32(s.timeCanSignElsewhere) || s.signedAnotherContract: return
d = u32(s.contractEnd − now) / 1440            // unsigned: an overdue contract gives a huge d → no roll
if d >= 3: return                               // V draws Random(100) here too (chance 0); Strac does not
if Chance((3 − d) * s.expLevel): s.signedAnotherContract = true
```

A 2-week hire or extension sets `timeCanSignElsewhere` to the contract end, so the merc cannot sign elsewhere during it.
Once signed, he refuses every renewal (§3.5) and on departure goes `WORKING_ELSEWHERE` for extra days (§4.5).

### 2.4 `DailyMoraleUpdate(s)` (`Tactical/Morale.cc:818-856`)

```
if s.profile == NO_PROFILE: return
if MercThinksDeathRateTooHigh(p): HandleMoraleEvent(s, HIGH_DEATHRATE, s.sector)      // −5 for s only; reputation −5
if MercThinksHisMoraleIsTooLow(s): HandleMoraleEvent(s, POOR_MORALE, s.sector)       // −2 to everyone in the sector; rep −3
elif s.morale >= 75:                HandleMoraleEvent(s, GREAT_MORALE, s.sector)     // +2 to everyone in the sector; rep +3
```

The sector events reach mercs with `!betweenSectors && sector == s.sector` (`Morale.cc:505-516`), so a merc on the road does not
take his own POOR/GREAT event. `s.morale` is the last refreshed value (`RefreshSoldierMorale` skips sleepers; for a dead merc it
is the value at death).

### 2.5 Unhired A.I.M. and M.E.R.C. profiles (`Tactical/Campaign.cc:1041-1173`)

These decide availability on the sites (`21` reads them). `HandleUnhiredMercImprovement(p)`: if `WORKING_ELSEWHERE`:
`Random(100) < 20` → nothing; else for each stat `HEALTH..LEADERSHIP` (11, experience included)
`ProfileStatChange(p, stat, wisdom/10, FROM_SUCCESS)`. Otherwise (at home): `Random(10) < exp`, **short-circuit**, else
`Random(100) > wisdom` → nothing; else `do stat = HEALTH + Random(11) while stat == EXPERIENCE`;
`ProfileStatChange(p, stat, wisdom/2, FROM_TRAINING)`. Then `ProfileUpdateStats(p)` (level-ups raise salaries, §3.7).
`HandleUnhiredMercDeaths(pid)`: only with `PLAYER_HAD_CHANCE_TO_HIRE` and `status.unhiredMercDeaths < game.json
unhired_merc_deaths_{easy,medium,hard}` (1/2/3); chance `10 − exp`, +2 for FORGETFUL/NERVOUS/PSYCHO, −1 per STEALTHY trait;
`PreRandom(1000) < chance` → `MERC_IS_DEAD`, available day 0, counter +1, email if A.I.M.

---

## 3. Expiry warnings and the renewal sequence

### 3.1 The two-hour warning (`FindOutIfAnyMercAboutToLeaveIsGonnaRenew`, `Merc_Contract.cc:863-916`)

On each `MERC_ABOUT_TO_LEAVE` (05:30, 11:30, 17:30):

```
willing = []; quitter = null
for s in OUR team, team order:
  skip life == 0, IN_TRANSIT, POW, kind != AIM; skip !ContractIsGoingToExpireSoon(s)
  s.renewalQuoteCode = NOT_USED
  renewalList[count++] = s.profile                 // never cleared here, no de-duplication (§12)
  if WillMercRenew(s, false): willing.push(s) else quitter = s       // the last unwilling one in team order
  update box: add s
if willing: c = willing[Random(len)]; c says 89 (CONTRACTS_OVER); box reason CONTRACT_EXPIRE_WARNING; show; c.code = 89_USED
elif quitter: quitter says 115 (MERC_LEAVING_ALSUCO_SOON); box; show; quitter.code = 115_USED
```

The update box pauses the game with a lock until dismissed; its buttons are "continue" (restart compression) and "stop"
(`Map_Screen_Interface.cc:3434-3470, 3533-3556`).

```
ContractIsGoingToExpireSoon(s) = contractEnd/1440 <= day && hour >= u32(ContractHour(s) − 2)     // :1015-1035
ContractIsExpiring(s)          = contractEnd/1440 <= day && hour == ContractHour(s)              // :994-1012
```

Both test the **day** of the end, not the minute, and the hour of the arrival slot (`timeWillArrive`), not of `contractEnd`. An
overdue contract (the player never resolved it) satisfies the day test on every later day: the merc is listed again at the next
morning's warning for his slot and asked again at the slot (§12). The unsigned `− 2` makes hours 0 and 1 never "soon"; A.I.M.
contract hours are 7, 13, 19.

### 3.2 `BeginContractRenewalSequence` (`Merc_Contract.cc:88-111`)

On each `BEGIN_CONTRACT_RENEWAL_SEQUENCE` (07:30, 13:30, 19:30): if some list entry is a soldier (`FindSoldierByProfileID`, any
team) with `life != 0`, not `IN_TRANSIT`, not POW and `ContractIsExpiring` → `sequenceOn = true`, `current = 0`,
`inProgress = false`, `PauseGame` + `LockPauseState(CONTRACT_RENEWAL)`, `InterruptTime` (`15` §2.9: the clock stays at 07:30),
enter the map screen. Otherwise nothing happens **and the list is kept** for the next slot. Time compression is refused while the
sequence is on (`MapScreen.cc:6274-6277`).

### 3.3 One merc at a time (`HandleContractRenewalSequence`, `:117-205`, every map screen frame)

```
if !sequenceOn: return
if current == count: count = 0; sequenceOn = false; UnLockPauseState()        // falls through with a stale index (§12)
s = FindSoldierByProfileID(list[current]); if !s: EndCurrent(); return
if inProgress: return                                                          // waiting for the player
if !ContractIsExpiring(s): EndCurrent(); return
inProgress = true
willing = WillMercRenew(s, false)
quote: !willing → 115; willing && code NOT_USED → 89; willing && code 89_USED → 115; willing && 115_USED → none
after the quotes: if willing: CheckIfSalaryIncreasedAndSayQuote(s, false)     // quote 116 once, clears contractPriceIncreased
                  fromSequence = true; open the contract menu for s (§3.4)
EndCurrent(): if sequenceOn: inProgress = false; fromSequence = false; current++
```

The menu opens for unwilling mercs too (V the same, `MercContract.c:242-276`); choosing an extension then plays the refusal
(§3.6). Quotes are only said when `CanSayQuote` holds (`Dialogue_Control.cc:517-531`: profile, `life ≥ OKLIFE`, not the robot,
not gassed, not POW), but the menu opens regardless.

### 3.4 The contract menu (`Strategic/Assignments.cc:4460-4528`, `CreateContractBox` `:5294-5333`, shading `MapScreen.cc:5176-5211`)

Lines (`Map_Screen_Interface.h:122-131`): current funds, blank, **one day** (`$sSalary`), **one week** (`$uiWeeklySalary`),
**two weeks** (`$uiBiWeeklySalary`), **Dismiss**, **Cancel**. Prices are the profile's current salaries.

| Line | Enabled when | Effect |
|---|---|---|
| day / week / two weeks | kind AIM, `life ≥ OKLIFE`, price ≤ balance | `MercContractHandling` (§3.6), menu closes |
| Dismiss | not (`INCOMBAT` and `s.inSector`) and `bleeding ≤ 12` (`MIN_BLEEDING_THRESHOLD`) | from the sequence: at once; otherwise after a yes/no box; `leaveHistoryCode = MERC_FIRED (13)`, `BeginRemoveMercFromContract` (§4.2) |
| Cancel | always | menu closes; **from the sequence** `BeginRemoveMercFromContract` (history stays "contract expired"); otherwise nothing |
| right click | — | closes the menu; in the sequence it stays open-ended until the player reopens the menu from the contract button |

Outside the sequence the player opens the menu from the map screen at any time (never in tactical: `Assert(fInMapMode)`).

### 3.5 Will he renew? (`WillMercRenew`, `Merc_Contract.cc:396-451`; `FindRefusalReason`, `:343-393`)

```
WillMercRenew(s, say):
  if kind != AIM: return false
  if s.signedAnotherContract: if say: quote 83 (WONT_RENEW_CONTRACT_LAME_REFUSAL); return false   // buddies do not help
  reason = FindRefusalReason(s); if reason == NONE: return true
  buddy = GetFirstBuddyOnTeam(p) → slot 0/1/2 gives quote 103/104/105, none → NONE
  if say:
    q = buddy != NONE ? buddyQuote : reason
    bit = (PrecedentIndex(q) − 1) & 31            // index in the 13-entry list below; not found → 0 → bit 31 (§12)
    if p.precedentQuoteSaid has bit: quote 106 (PRECEDENT_TO_REPEATING_ONESELF_RENEW) else set bit
    quote q
  return buddy != NONE

FindRefusalReason(s):                              // order of importance: hated, death rate, morale
  for i in 0, 1: h = p.hated[i]
    if h < 0 || !OnTeamArrivedAlive(h): continue   // IsMercOnTeamAndInOmertaAlreadyAndAlive: OUR, not IN_TRANSIT, life > 0
    if p.hatedCount[i] != 0:                       // tolerance left: only if he is in the same sector (x, y, z)
      o = OUR soldier with profile h; if !o || o.sector != s.sector: continue
    return i == 0 ? 100 : 101                      // HATE_MERC_1/2_ON_TEAM_WONT_RENEW
  h = p.learnToHate
  if h >= 0 && OnTeamArrivedAlive(h):
    if p.learnToHateCount == 0: return 102
    if p.learnToHateCount <= p.learnToHateTime/2 && same sector: return 102
  if MercThinksDeathRateTooHigh(p): return 99      // DEATH_RATE_RENEWAL
  if MercThinksHisMoraleIsTooLow(s): return 95     // REFUSAL_RENEW_DUE_TO_MORALE
  return NONE

GetFirstBuddyOnTeam(p):                            // Soldier_Profile.cc:878-889
  first i in 0..2 with p.buddy[i] >= 0, a soldier of that profile on the OUR team (any assignment, in transit included)
  and that profile not MERC_IS_DEAD
```

Precedent list (`Dialogue_Control.cc:84-99`), index order: 80, 81, 82, 83, 86, 87, 88, 95, 97, 99, 100, 101, 102. The bits are
cleared for every living profile at each daily update (§2.1). V (`MercContract.c:417-612`) computes the buddy first, over
all five slots (only three are ever filled) with "on team and alive", and reaches the same outcomes and quotes.

### 3.6 Extending (`MercContractHandling`, `Merc_Contract.cc:228-340`)

```
if kind != AIM: return false
(charge, len, hist, fin) = day:      (sSalary,          1, HISTORY_EXTENDED_CONTRACT_1_DAY 10, EXTENDED_CONTRACT_BY_1_DAY 13)
                           week:     (uiWeeklySalary,   7, 11, 14)
                           twoWeeks: (uiBiWeeklySalary, 14, 12, 15)
if balance < charge: return false                                   // silent (the line is shaded anyway)
if !WillMercRenew(s, true):                                         // refusal quotes
  if ContractIsExpiring(s): contract-ending event with the rehire button (§4.3)
  return false
s.totalContractLength += len; s.typeOfLastContract = choice; s.contractEnd += len*1440
if s.lifeInsurance && s.assignment != POW:
  cost = CalculateInsuranceContractCost(len, s.profile)             // §7, with the new end
  quote 90 (ACCEPT_CONTRACT_RENEWAL)
  if cost > balance − charge: box "cannot afford the insurance"; if fromSequence: EndCurrent()
  else: yes/no "extend insurance for len days for $cost?" → yes: PurchaseOrExtendInsuranceForSoldier(s, len);
        either answer: if fromSequence: EndCurrent()
else: quote 90; if fromSequence: EndCurrent()
if choice == twoWeeks: s.timeCanSignElsewhere = s.contractEnd
AddTransactionToPlayersBook(fin, profile, now, −charge)             // adds to uiTotalCostToDate
AddHistoryToPlayersLog(hist, profile, now, s.sector)
return true
```

The insurance box is raised before the contract charge is booked; its answer comes later, so the ledger order is contract
charge, then the insurance transaction. No medical deposit is charged on extension. `lastContractUpdate` is **not** touched.

### 3.7 Salary increases

A level gained by an employed A.I.M. merc sets `contractPriceIncreased`; A.I.M. and M.E.R.C. (and unemployed A.I.M./M.E.R.C.
profiles) multiply `sSalary`, `uiWeeklySalary`, `uiBiWeeklySalary` and `sMedicalDepositAmount` once per level gained
(`Tactical/Campaign.cc:666-737`):

```
CalcNewSalary(old, max):  if old == 0: 0; n = u32(old * 1.25) (= old + old/4 truncated); n = RoundOffSalary(n); min(n, max), at least 5
RoundOffSalary(n): multiple = 5 (≤250), 10 (≤500), 25 (≤1000), 50 (≤2000), 100 (≤5000), 500 (≤10000), 1000 (≤25000),
                   2000 (≤50000), else 5000; if n % multiple: n = (n + multiple/2) / multiple * multiple
max: MAX_DAILY_SALARY 30000 for sSalary and the deposit, MAX_LARGE_SALARY 500000 for the others
```

An employed M.E.R.C. merc's level-up also posts the "went up a level" email event at `now + 60 + Random(60)` (closes the
deviation "Experience level-up side effects"). The soldier's paid `medicalDeposit` does not change. The next renewal shows the
new prices; the merc says quote 116 (`MERC_GONE_UP_IN_PRICE`) once before the menu (§3.3, §4.3).

---

## 4. Leaving the team

### 4.1 Paths

| Cause | Trigger | Quotes | Equipment | History |
|---|---|---|---|---|
| A.I.M. contract ends, player lets him go | Cancel in the sequence (§3.4) | 98/85 if he wanted to renew (§4.2) | prompt (§4.3) | `MERC_CONTRACT_EXPIRED 22` |
| A.I.M. refuses to renew | extension chosen at an expiring contract (§3.6) | refusal (§3.5) | prompt with rehire | 22 |
| Dismissed (any kind with the menu) | Dismiss (§3.4) | A.I.M.: 98/85 if willing; M.E.R.C./RPC: 64 | prompt | `MERC_FIRED 13` |
| M.E.R.C. or RPC quits over a hated merc | hourly counters (§5.2) | 49/50 or 32 | prompt, no rehire | `MERC_QUIT 14` |
| M.E.R.C. unpaid | account invalid at 00:00 (§4.7) | 54 | **none: he keeps everything** | 14 |
| RPC unpaid 3 days | 00:00 (§4.8) | 55 | **none** | 14 |
| Slay | his week ends (M6) | — | none | `SLAY_MYSTERIOUSLY_LEFT 76` |
| Dead or captured merc removed | map screen "remove merc" (`Assignments.cc:4330-4390`) | — | none (dropped earlier) | none for the dead; 22 for a POW |

### 4.2 `BeginRemoveMercFromContract(s)` (`Strategic/Assignments.cc:4397-4431`)

```
if s.life <= 0 || s.assignment == POW: return
kind MERC or NPC: quote 64 (RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO)
kind AIM: if WillMercRenew(s, false): quote u32(now − s.lastContractUpdate) < 2880 ? 98 : 85
contract-ending event with the rehire button (§4.3)
if u32(now − s.lastContractUpdate) < 180:                           // within 3 hours of ARRIVAL
  p.hangover = 3 + Random(4)                                         // the AIM site gives lame refusals meanwhile (21)
  if kind AIM: ModifyPlayerReputation(−3)                            // REPUTATION_EARLY_FIRING
```

### 4.3 The contract-ending prompt (`Merc_Contract.cc:548-587, 750-857`)

The dialogue event (after the quotes): `InterruptTime`, `PauseGame`, `LockPauseState(CONTRACT_ENDING)`; Iggy becomes available to the army if the
player still owes him money (`iBalance < 0`, `:966-980`, M6); an EPC is unescorted instead (M6); otherwise:

```
rehire = requested && !s.signedAnotherContract && kind == AIM
if profile type != RPC:
  elsewhere = B13 not enemy controlled ? B13 (AIRPORT_SECTOR) : start sector (policy, A9)
  if elsewhere == s.sector && s.sector.z == 0: only "here"
  else: "here" (s.sector) | "elsewhere" (B13 or A9) [| rehire]
else: only "here" [| rehire]
answer here:      HandleLeavingOfEquipmentInCurrentSector(s); StrategicRemoveMerc(s)
answer elsewhere: inDrassen = primary shipping destination's sector (B13) not enemy controlled NOW; HandleMercLeavingEquipment(s, inDrassen);
                  StrategicRemoveMerc(s)
answer rehire:    the merc stays; quote 116 if the price rose; the contract menu reopens for him (fromSequence unchanged)
```

### 4.4 Where the equipment goes (`Map_Screen_Interface.cc:973-1212`)

Drop here (the leave list is not used; the profile inventory is **not** cleared):

```
if s.sector == loaded sector:
  g = s.gridNo; if g == NOWHERE: g = RandomGridNo(); t = nearest free item gridno within 5, else 15; if found: g = t
  every inventory slot with objects → AddItemToPool(g, obj, VISIBLE, s.level, REACHABLE)
else:
  g = insertion code GRIDNO && data != NOWHERE ? data : RandomGridNo()
  every slot → AddItemsToUnLoadedSector(s.sector, g, obj, s.level, SWEETSPOT_FROM_GRIDNO | REACHABLE, VISIBLE)
keys of the key ring dropped at g
RandomGridNo(): do x = Random(160); y = Random(160) while not on a visible world tile      // TileEngine/Isometric_Utils.cc:667-677
```

Send elsewhere: the first of 20 slots with an empty list; each inventory slot with objects (slot order) and then the key-ring
keys are appended; the owner profile is recorded per appended item; the **profile inventory is zeroed** (a later rehire with
gear gets nothing, `21`); `MERC_LEAVE_EQUIP_IN_DRASSEN` or `_IN_OMERTA` is posted at `now + 360` with the slot. Six hours later
(`:1044-1096`): message "X left equipment in …"; the items go to the start sector at gridno 4868
(`START_SECTOR_LEAVE_EQUIP_GRIDNO`) or to the primary airport's delivery sector at gridno 10433, into the loaded world
(`VISIBLE`, level 0, `REACHABLE`) or the sector's item list; the slot is freed (its owner id is not reset). A merc with no items
claims no slot, so a second departure can reuse the same slot before the first event fires (§12).

### 4.5 `StrategicRemoveMerc(s)` (`Merc_Contract.cc:613-708`)

```
if fromSequence: EndCurrent()
if s.leaveHistoryCode == 0: s.leaveHistoryCode = MERC_CONTRACT_EXPIRED (22)
personnel lists: life <= 0 → dead; code FIRED or POW → "fired"; else "other"
kind NPC: SetupProfileInsertionDataForSoldier (M6)
if s.assignment >= ON_DUTY && s.groupId: VEHICLE → TakeSoldierOutOfVehicle else RemoveGroup(his own group)   // 16
if p.status != MERC_IS_DEAD:
  p.status = RETURNING_HOME; p.dayBecomesAvailable = 1 + Random(2)
  if MercThinksHisMoraleIsTooLow(s): p.hangover = 3 + Random(4)
  if s.signedAnotherContract: p.status = WORKING_ELSEWHERE; p.dayBecomesAvailable += 1 + Random(6 + s.expLevel/2)
if !(s.statusFlags & DEAD): history(s.leaveHistoryCode, profile, now, s.sector)
if s.assignment == POW: p.status = FIRED_AS_A_POW (never hireable again) else CalculateMedicalDepositRefund(s)   // §4.6
TacticalRemoveSoldier(s)                       // RemoveCharacterFromSquads, team slot, map (Soldier_Create.cc:958-1022)
CheckAndHandleUnloadingOfCurrentWorld()        // 16 §5.10
StopTimeCompression()                          // reason mercLeft
```

No morale event fires for anyone when a merc leaves or is fired; teammates feel it only through the hourly team opinion (§5.3)
and through buddies and hated mercs at later renewals and hires.

### 4.6 Medical deposit refund (`Merc_Contract.cc:711-742`)

Only if the profile's `bMedicalDeposit` flag is set; the amount is the soldier's paid `medicalDeposit`.
`life == lifeMax` → `FULL_MEDICAL_REFUND (19)` +deposit; `life > 0` → `refund = (2*deposit*life/lifeMax + 1)/2`,
`PARTIAL_MEDICAL_REFUND (20)`; dead → no transaction. An A.I.M. email reports each case (`21`).

### 4.7 M.E.R.C. accounts (`Laptop/Mercs.cc:513-588`, `Mercs.h:13-31`)

`DailyUpdateOfMercSite` (everyday 00:00, skipped on Day 1), first of the 00:00 events:

```
n = 0
for each M.E.R.C. listing (mercs-MERC-listings.json order; Larry resolves to his drunk profile after a relapse):
  if no soldier of that profile is on the team: continue
  if profile not dead: p.mercMercContractLength++
  n = max(n, p.mercMercContractLength)
n > 12 → INVALID (email once) · n > 9 → SUSPENDED (email, Speck complains) · n > 7 → VALID_FIRST_WARNING (email, Speck complains)
then new M.E.R.C. availability and the one-time site outage (21)
```

The counter is per profile (days since last settled), set to 1 at hire; fired mercs keep their unpaid days frozen and still owed.
`SettleMercAccounts` (`Mercs_Account.cc:260-...`, `21`) pays merc by merc while affordable and resets their counters; a full
payment sets `VALID`. Statuses only escalate in the daily update.

`MercsContractIsFinished(s)` (`Strategic_Merc_Handler.cc:375-419`, for the invalid account in §2.1): enter the map screen;
`InterruptTime`; `PauseGame`; quote 54 (`NOT_GETTING_PAID`); contract ending **without** the equipment prompt (straight to
`StrategicRemoveMerc`, the items leave with him); `leaveHistoryCode = MERC_QUIT`. The account turns invalid when a counter
passes 12 (the 12th midnight after hiring, the 13th after settling) and the mercs leave in the same midnight's
`MercDailyUpdate`.

### 4.8 RPC salary (`Strategic_Merc_Handler.cc:209-257`)

```
owed = p.sSalary + (p.balance < 0 ? −p.balance : 0); if owed == 0: return
if money >= owed: AddTransaction(PAYMENT_TO_NPC 22, profile, now, −owed); if p.balance < 0: p.balance = 0
else:
  message "cannot pay X $salary"
  if p.balance − sSalary <= −3*sSalary: MercsContractIsFinished(s)     // NPC kind: quote 55, no equipment prompt, MERC_QUIT
  else: p.balance −= sSalary; post same-day RPC_WHINE_ABOUT_PAY at 07:30 (param soldier id) → quote 54 if still an NPC kind
```

The third consecutive unpaid midnight makes him quit; a later payment settles the arrears in one transaction.

### 4.9 Death bookkeeping (the M5 parts of `StrategicHandlePlayerTeamMercDeath`, `Strategic_Merc_Handler.cc:52-130`)

In order around what `19` §3.8 already does: history `MERC_KILLED (3)`, or `MERC_KILLED_CHARACTER (77)` when the attacker is
on the OUR team, with the soldier's sector (the world sector if invalid); a screen message off the game screen; deaths +1
(not EPC/robot); dead flags; `p.status = MERC_IS_DEAD`; **life insurance** (§7: suspicious-death rules unless in autoresolve,
then `AddLifeInsurancePayout`); morale fan-out (not EPC/robot); M.E.R.C. kind: `contractEnd = now` and Speck's "lost a merc"
flag; `HandleStrategicDeath`. On the map screen `HandleStrategicDeath` also makes each living teammate (life ≥ OKLIFE) whose
buddy slot 0/1/2 holds the dead profile say 15/16/17 (`Strategic/Strategic.cc:44-63`); tactical deaths do the same for
teammates in the sector (`Tactical/Overhead.cc:2208-2220`).

---

## 5. Relationships

### 5.1 The data

Per profile (§0): `bMercOpinion[0..74]` about the 75 recruitable profiles (`NUM_RECRUITABLE`; A.I.M., M.E.R.C., I.M.P. slots and
RPCs), usually in −25..+25; buddies `bBuddy[0..1]` and hated `bHated[0..1]` from the data, slot 2 of each filled at run time by
learning; `bHatedTime[0..1]` tolerances (hours together), `bLearnToLike`/`bLearnToLikeTime`, `bLearnToHate`/`bLearnToHateTime`;
the running counts and `ubTimeTillNextHatedComplaint`. Constants: `BUDDY_OPINION +25`, `HATED_OPINION −25`,
`TIME_BETWEEN_HATED_COMPLAINTS 24` (`Tactical/Soldier_Profile_Type.h:216-237, 430`). `WhichBuddy`/`WhichHated` return the first
slot 0..2 holding the profile (`Soldier_Profile.cc:843-875`); `BUDDY_MERC`/`HATED_MERC` test slots 0..2.

Everything lives on the profile, so tolerance spent in one contract stays spent after a rehire, and learned buddies or enemies
are permanent for the campaign (counts are only initialised at new-game profile load, §0).

### 5.2 Hourly counters (`UpdateBuddyAndHatedCounters`, `Strategic_Merc_Handler.cc:526-730`)

Step 2 of the hourly update (`15` §3.2), skipped while `didGameJustStart`. **Only squad members count, on both sides.**

```
for s in OUR team, team order, with s.assignment < ON_DUTY:
  p = profile(s); sameGroupOnly = s.groupId && group(s).betweenSectors; updatedComplaintTimer = false
  for o in OUR team, team order, o != s, o.assignment < ON_DUTY:
    if sameGroupOnly: require o.groupId == s.groupId
    else: require o.sector == s.sector (x, y, z) and not (o.groupId && group(o).betweenSectors)
    for slot in HATED1, HATED2, LEARNED_TO_HATE, LEARNED_TO_LIKE:
      HATED1/2, if p.hated[slot] == o.profile:
        if p.hatedCount[slot] > 0:
          p.hatedCount[slot]--
          if count == 0 && s.inSector && enemyInLoadedSector: count = 1                   // never snaps during a battle
          elif count > 0 && (count == time/2 || (count < time/2 && count % 24 == 0)):
            quote 29/30 (HATED_MERC_ONE/TWO), subject o; StopTimeCompression (reason complaint)
          elif count == 0:
            kind MERC or NPC: quote 49/50 (MERC_QUIT_HATED1/2); contract ending, no rehire (§4.3); leaveHistoryCode = MERC_QUIT
            else: quote 29/30; p.complaintTimer = 23
        else:                                                                              // tolerance exhausted
          if !updatedComplaintTimer: p.complaintTimer = p.complaintTimer == 0 ? 23 : p.complaintTimer − 1; updatedComplaintTimer = true
          if p.complaintTimer == 0: quote 29/30
      LEARNED_TO_HATE, if p.learnToHate == o.profile:
        if p.learnToHateCount > 0:
          p.learnToHateCount--
          if count == 0 && s.inSector && enemyInLoadedSector: count = 1
          elif count > 0 && (count == time/2 || (count < time/2 && count % 24 == 0)): quote 31 (LEARNED_TO_HATE_MERC); StopTimeCompression
          elif count == 0:
            p.hated[2] = o.profile; p.opinion[o.profile] = −25
            kind MERC, or NPC and profile in {DEVIN, SLAY, IGGY, CONRAD}: quote 32 (MERC_QUIT_LEARN_TO_HATE); contract ending, no rehire; MERC_QUIT
            elif kind NPC: quote 31
          if count < time/2: p.opinion[o.profile] += idiv(−25 − p.opinion[o.profile], count + 1)      // i8 store
        else: same complaint timer as above, quote 31
      LEARNED_TO_LIKE, if p.learnToLikeCount > 0 && p.learnToLike == o.profile:
        p.learnToLikeCount--
        if count == 0: p.buddy[2] = o.profile; p.opinion[o.profile] = +25
        elif count < time/2: p.opinion[o.profile] += idiv(25 − p.opinion[o.profile], count + 1)
```

The complaint timer is shared by all hated slots and all teammates of `s` within the hour (one decrement per hour), but each
matching pair checks it, so two exhausted enemies give two quotes in the same hour. A.I.M. mercs never quit mid-contract: they
complain every 24 hours and refuse to renew (§3.5). Examples: tolerance 48 h on the same squad → complaints after 24 h
(count 24) and at count 0 after 48 h (a M.E.R.C. merc quits then); learning to like over 30 h from opinion 0 adds 1 per hour
at counts 14..10 and 2 per hour at counts 9..1 (reaching 23) and sets +25 at count 0.

### 5.3 Team morale (`HourlyMoraleUpdate`, `Tactical/Morale.cc:664-815`)

Step 3 of the hourly update. Unlike §5.2, **every awake teammate in the same sector counts**, whatever his assignment.

```
for s in OUR team, team order: skip NO_PROFILE, asleep, IN_TRANSIT, DEAD, POW
  sameGroupOnly = s.groupId && group(s).betweenSectors
  foundHated = false; sum = 0; n = 0; lead = EffectiveLeadership(s)
  for o in OUR team, team order: skip o == s, NO_PROFILE, asleep, IN_TRANSIT, DEAD, POW
    same group / same sector and o not between sectors, as in §5.2
    op = p.opinion[o.profile]
    if op == −25:
      slot = WhichHated(s.profile, o.profile)
      if slot == LEARNED_TO_HATE: foundHated = true; break
      if slot is HATED1/2 && p.hatedCount[slot] <= p.hatedTime[slot]: foundHated = true; break    // always true (§12)
      (slot not found: −25 is mixed in unscaled)
    sum += op; n++; lead = max(lead, EffectiveLeadership(o))
  team = foundHated ? −25 : n > 0 ? i8(sum/n) + (lead − 50)/10 : 0
  team = clamp(team, −25, +25)
  d = team − s.teamMoraleMod; s.teamMoraleMod += d > 0 ? 1 + d/10 : d < 0 ? −1 + d/10 : 0; clamp ±50
  if s.delayedStrategicMoraleMod: s.strategicMoraleMod = clamp(+ delayed, ±50); delayed = 0
  RefreshSoldierMorale(s)
if ++counter == 3: counter = 0; DecayStrategicMoraleModifiers()     // Morale.cc:220-241; counter not saved (deviation in 18)
```

A merc alone drifts toward 0; with a team the average opinion plus the best effective leadership around (his own included)
pulls his team modifier by about a tenth of the gap per hour. A hated merc only forces −25 if the opinion value is exactly −25
(the opinion table and the hated slots are separate data). V scales the hated opinion by spent tolerance and forces −25 only
from half tolerance on (V: `Morale.c:713-734`); Strac's `<= hated_time` makes the scaling dead code. D1: port Strac (§12).

### 5.4 Hiring refusals (`CanMercBeHired`, `Laptop/AIMMembers.cc:1769-1863`; called by the AIM site, `21`)

```
if p.hangover > 0: quote 82 (LAME_REFUSAL); refuse                    // buddy or not
buddy = GetFirstBuddyOnTeam(p); joinQuote = NONE
for i in 0..2: h = p.hated[i]; skip h < 0 or !OnTeamArrivedAlive(h)
  if buddy found: quote 92/93/94 (JOINING_CAUSE_BUDDY_1/2/LEARNED); accept
  i == 0/1 && p.hatedTime[i] >= 24: joinQuote = 113/114 (PERSONALITY_BIAS_WITH_MERC_1/2); continue      // grumbles, joins
  refuse with quote 86/87 (i = 0/1) or 88 (learned)
if buddy found: accept
if MercThinksDeathRateTooHigh(p): quote 81; refuse
if MercThinksBadReputationTooHigh(p): quote 80; refuse
if joinQuote != NONE: say it
accept
```

M.E.R.C. hiring checks no relationship, death rate or reputation (`Laptop/Mercs_Files.cc`). RPC recruiting mixes the NPC's
opinion of the speaking merc into the approach (`TacticalAI/NPC.cc:479`, M6).

### 5.5 Other effects of relationships

| Effect | Rule | Source | Milestone |
|---|---|---|---|
| Renewal | §3.5 | | M5 |
| Death of a teammate | hated → +5 only; else −5 tactical if in sector, −5 strategic, buddy (slots 0..2) −15 | `11` §9, `Morale.cc:529-563` | M3 (fix to mutable slots, M5) |
| Buddy killed quotes | 15/16/17 | §4.9 | M5 |
| Training | instructor opinion bonus | `18` §5.8 | M4 (read mutable opinions) |
| Attacking a buddy | an order from the UI to attack a merc in one's buddy slots is refused (quote 36) | `Tactical/Handle_Items.cc:243-250` | deviation "Attack refusals" (not ported) |
| Cosmetic quotes | buddy did well 51/52/53 (`Tactical/SkillCheck.cc:385-420`, `Soldier_Ani.cc:2603-2681`); annoying teammate 39 when opinion < −2 (`Dialogue_Control.cc:785-800`); negative company 41/45 (`Handle_UI.cc:4710-4765`) | | client events |

### 5.6 Personality, attitude and leadership

| Trait | Mechanical effect | Where |
|---|---|---|
| Leadership (effective) | best in the group shifts team opinion by `(lead − 50)/10` | §5.3 |
| Attitude OPTIMIST / AGGRESSIVE | +1 on positive morale events; OPTIMIST also +1 on negative | `11` §9 |
| Attitude PESSIMIST / COWARD | −1 / −2 on negative events (PESSIMIST also −1 on positive); AGGRESSIVE doubles and COWARD skips the ran-away penalty | `11` §9 |
| Attitude FRIENDLY, LONER, ARROGANT, BIG_SHOT, ASSHOLE | none (quotes, I.M.P. email) | `Soldier_Profile_Type.h:177-190` |
| Personality NERVOUS, CLAUSTROPHOBIC | quarter-hour morale events | `18` §5.12, `11` §9 |
| Personality FORGETFUL, NERVOUS, PSYCHO / skill STEALTHY | unhired death chance +2 / −1 | §2.5 |
| `bSexist` | morale when a merc marries (M6) | `Morale.cc:565-602` |
| `bReputationTolerance` | hiring (reputation) and the morale tolerance | §6.3 |
| `bDeathRate` | hiring, renewal, daily morale | §6.3 |

---

## 6. Reputation and death rate

### 6.1 Death rate (`Strategic/Strategic_Status.cc:112-126`)

`CalcDeathRate() = manDaysPlayed > 0 ? u8(u32(f32(mercDeaths) * 1.0f * 100 / manDaysPlayed)) : 0`, i.e.
`u8(trunc(deaths*100/manDays))`: the `u8` wraps above 255 (3 deaths in one man-day give 44). Deaths: +1 per OUR death except EPCs
and the robot (§4.9). Man-days: +1 per daily update per team member not dead and not in transit (§2.1). The first daily update
(Day 2) always sees 0 man-days and grants the low-death-rate bonus.

### 6.2 Reputation (`ModifyPlayerReputation`, `:129-138`; amounts `Strategic_Status.h:18-32`)

`badReputation = clamp(badReputation − change, 0, 100)` (0 saint, 100 worst). Called from the end of `HandleMoraleEvent`
(`Morale.cc:611-660`), **once per call** whatever the number of mercs affected (even if nobody's morale changed), and from §4.2:

| Event | Change |
|---|---|
| `LOW_DEATHRATE` / `HIGH_DEATHRATE` | +5 / −5 |
| `GREAT_MORALE` / `POOR_MORALE` | +3 / −3 |
| `BATTLE_WON` (not `HEARD_BATTLE_WON`) | +2 |
| `RAN_AWAY`, `HEARD_BATTLE_LOST` | −2 |
| `TOWN_LIBERATED` / `TOWN_LOST` | +5 / −5 |
| `TEAMMATE_DIED` | `−2 × dead merc's expLevel` |
| `MERC_CAPTURED` | `−1 × expLevel` |
| `KILLED_CIVILIAN` | −5 |
| `MONSTER_QUEEN_KILLED` / `DEIDRANNA_KILLED` | +15 / +25 |
| A.I.M. merc fired within 3 h of arrival | −3 |

Daily, every team member (dead ones included) can move the reputation by ±3 or −5 through §2.4.

### 6.3 Tolerances

```
MercThinksDeathRateTooHigh(p)     = p.bDeathRate != 101 && CalcDeathRate() > p.bDeathRate
MercThinksBadReputationTooHigh(p) = p.bReputationTolerance != 101 && badReputation > p.bReputationTolerance
MercThinksHisMoraleIsTooLow(s)    = p.bReputationTolerance != 101 && s.morale < (100 − p.bReputationTolerance)/2
```

Readers: death rate → hiring (§5.4), renewal (§3.5), daily morale (§2.4), insurance (§7); reputation → hiring only; morale
tolerance → renewal, daily morale, the departure hangover (§4.5).

---

## 7. Life insurance (contract coupling)

The insurance site's purchase screen is laptop UI (`21`); the rules that touch contracts:

```
CalculateInsuranceContractCost(len, pid):                          // Laptop/Insurance_Contract.cc:709-775
  s = OUR soldier of pid; rem = TimeRemainingOnContract(s)
  if rem < 2 && !(s.lifeInsurance && rem >= 1): return 0; if POW: return 0
  skill = (mark + med + mech + expl + lead)/5 (profile, INT16)
  risk  = f32 product of Ratio(skill, 42) · Ratio(p.life, 85) · Ratio(p.expLevel, 3) · Ratio(100 − CalcDeathRate(), 90)
  risk  = clamp(risk, 0.1f, 10.0f)
  daily = u32(fround(fround(fround(sSalary*5) * risk) / 100) + 0.5)    // the + 0.5 is a double add; return daily * len
Ratio(v, norm) = v > 0 ? clamp(fround(norm / v), 0.1f, 10.0f) : 10.0f   // every float step rounded with Math.fround
TimeRemainingOnContract(s) = min(contractEnd/1440 − 1 + (contractEnd % 1440 ? 1 : 0) − day, totalContractLength)   // :1059-1077
TimeRemainingOnInsurance(s) = !insured ? 0 : day < start ? totalLen : totalLen − (day − start)                    // :1043-1057
```

`PurchaseOrExtendInsuranceForSoldier(s, len)` (`:1082-1148`): new policy: start day = tomorrow (today for a merc still in
transit, except at the game start), `uiStartTime = now`, `PURCHASED_INSURANCE (8)` if affordable (else a box, nothing bought); extension:
start day recomputed, `EXTENDED_INSURANCE (10)`; then `totalLen += len` clamped so the policy never outlasts the contract.
`DailyUpdateOfInsuredMercs` (00:00, `:675-700`): an insured, living merc whose remaining policy ≤ 0 (and not started today) loses
the policy. On death (§4.9): `ubSuspiciousDeath = 2` if killed within 60 minutes of buying, else `1` if the killer is on the OUR
team or no enemy is in the loaded sector (not in autoresolve); `AddLifeInsurancePayout` (`:835-912`): cost per day = cheapest of
`sSalary`, `weekly/7`, `biweekly/14`; days = `totalLen − (day + 1 − start)`; event at tomorrow 16:00: suspicious or ≥ 2
investigations → `INSURANCE_INVESTIGATION_STARTED` (lasts 1 day if very suspicious, else `2 + investigations + Random(3)` days,
then pays unless very suspicious), else `PAY_LIFE_INSURANCE_FOR_DEAD_MERC` (`INSURANCE_PAYOUT (12)`, history, email).

---

## 8. Determinism

### 8.1 RNG draws, in order

| Where | Draw | Stream |
|---|---|---|
| Daily update, per team member in team order | `Random(1080)` if he complains about equipment; `Chance((3 − d)·exp)` for another contract (A.I.M., gated, `d < 3`) | main |
| Daily update, per profile 0..199 | improvement: `Random(100)` (working) or `Random(10)` then, only if not below, `Random(100)`; `Random(11)` until not experience; the `ProcessStatChange` draws (`pre` per chance, `main` on gains, `11` §10); then `PreRandom(1000)` death roll if working elsewhere and eligible; then `Random(100)` and possibly `Random(6 + exp/2)` for a new job | main/pre |
| Arrival (`21`) | `Random(660)` equipment complaint | main |
| Two-hour warning | `Random(n)` over the willing mercs, if any | main |
| Dismissal within 3 h of arrival | `Random(4)` hangover | main |
| Leaving, equipment here | `RandomGridNo` pairs `Random(160)` (loaded sector without a gridno; unloaded sector without a GRIDNO insertion) | main |
| `StrategicRemoveMerc` | `Random(2)`; `Random(4)` if morale too low; `Random(6 + exp/2)` if signed elsewhere | main |
| M.E.R.C. level-up | `Random(60)` email delay | main |
| Insurance investigation | `Random(3)` (not very suspicious) | main |
| Hourly counters, team morale, renewal decisions, pay, refunds | none | — |

The contract-ending and renewal draws happen at the moment of the player's answer, so the `main` stream depends on the order of
answers; prompts are part of the command log (`04` §5.5).

### 8.2 Wall-clock dependencies and their replacements

| Original | ja2-node |
|---|---|
| Quotes play through the dialogue queue (audio length or 60 ms/char); the contract menu, the departure box and the update box wait for them; `CharacterDialogueEvent::MayExecute` waits for a battle sound | Prompts open at once; quotes are events with the 60 ms/char duration for presentation (D15, `01` §3.8) |
| `HandleContractRenewalSequence` advances once per map screen frame | Advanced synchronously after each answer |
| Update box beep, contract time flashing (`fFlashContractFlag`) | Client presentation |
| Random shared with cosmetic draws | Existing deviation "Random numbers" |

---

## 9. Agent API (D15, D16)

**Commands** (strategic flow; refused in tactical, where the original has no contract menu, with reason `mapScreenOnly`):

| Command | Original | Checks and result |
|---|---|---|
| `extendContract {soldier, length: 'day' \| 'week' \| 'twoWeeks'}` | contract menu line (§3.4) → `MercContractHandling` | `notAimMerc`, `cannotExtend` (§1.1), `tooBadlyHurt` (life < OKLIFE), `notEnoughMoney`; a refusal is `ok: true` with `{extended: false, reason}` (the merc said it); an open renewal prompt must be answered instead (`promptOpen`) |
| `dismiss {soldier}` | Dismiss + confirmation | `cannotExtend`, `inCombat` (in combat and in the loaded sector), `bleeding` (> 12); then the `mercDeparture` prompt |
| `removeMerc {soldier}` | "remove merc" box for the dead and POWs | only dead or POW; `StrategicRemoveMerc` directly |

**Decision prompts** (time stops; battle-flow prompts answered with `answer {prompt, choice}`, no `defer`; the open one is
`observe.contractPrompt` with the merc's `name`, the departure sectors as strings and the renewal `balance`):
- `contractRenewal {soldier, fromSequence, balance, options: [{choice: 'day'|'week'|'twoWeeks', cost, enabled, reason?},
  {choice: 'dismiss', enabled, reason?}, {choice: 'letGo'}]}` — the menu of §3.4, opened by the sequence (§3.3) or by `rehire`.
  `letGo` is Cancel. Options for willing and unwilling mercs look the same; the quotes already said tell the player which.
- `mercDeparture {soldier, sector, choices: ['here'] | ['here', 'elsewhere'] (+ 'rehire'), elsewhereSector}` (§4.3).
- `insuranceExtension {soldier, days, cost}` → `yes`/`no` (§3.6); the unaffordable case is an event.

**Events**: `mercQuote {soldier, quote, subject?}` for every quote of this spec (`quote` is the enum name in camelCase, e.g.
`contractsOver`, `mercLeavingAlsucoSoon`, `hateMerc1OnTeamWontRenew`, `renewingCauseBuddy1OnTeam`, `precedentToRepeatingOneselfRenew`,
`deathRateRenewal`, `refusalRenewDueToMorale`, `acceptContractRenewal`, `mercGoneUpInPrice`, `hatedMercOne`,
`learnedToHateMerc`, `mercQuitHated1`, `notGettingPaid`, `whineEquipment`, `startingToWhine`; `subject` is the profile the line
names: the slot's buddy or hated merc, inferred to match the recordings); `contractsExpiringSoon {soldiers}` (the update box,
default stop condition, `continue`/`stop` per client policy as for the assignments box, `18` §6); `contractExtended {soldier,
days, cost, endsAt}`; `contractRefused {soldier, reason: 'signedElsewhere'|'hatedMerc'|'learnedToHate'|'deathRate'|'morale'}`
(what the spoken quote says); `insuranceUnaffordable {soldier, cost}`; `mercLeft {soldier, profile, cause, history,
equipment: 'here'|'elsewhere'|'carried'|'none', refund?}`; `equipmentDelivered {sector, owner}`; `rpcUnpaid {soldier, amount}`;
`mercAccountStatus {status}` (with the email, `21`); `historyAdded {code, profile, sector}` and `mailDue {mail, profile?,
amount?}` until `21` stores them; `reputation` and `deathRate` are **not** events. As implemented, `mercQuote` also carries
`profile` and the quote number `id`, `mercLeft` the personnel list (`personnel: 'dead'|'fired'|'other'`) and
`equipmentDelivered` the item count (`items`).

**Observation** (`PlayerView`; only what §1.3 shows): per merc `kind`; `contract` = A.I.M./Slay `{totalDays, remaining: {days,
hours}, endsAt: {day, hour}, lastContract, dailyRate, renewalCosts: {day, week, twoWeeks}, medicalDeposit, insured,
insuranceDays}`, M.E.R.C. `{unpaidDays, daysHired, owed}`, RPC `{dailyRate}`, others `null`; `morale` (0–100, the tactical bar)
and `moraleText`; personnel figures `daysServed`, `totalCost` (the laptop's Personnel page reads its own blocks since M8:
`observe.laptop.personnel.current` and `.departed`, with the record counters including `battlesFought`, `04` §6.33). Per
campaign: M.E.R.C. account status (as the site shows it),
pending equipment deliveries are not shown (only the later message). Never: opinions, buddy/hated slots, tolerances and
counters, learn-to progress, the precedent bits, `signedAnotherContract`, the renewal list, reputation, death rate.

**Queries**: `contractOptions {soldier}` → the `contractRenewal` options without opening the sequence (same shading, no
willingness).

---

## 10. Data tables and stubs

### 10.1 Sources

**Use directly** (`data/externalized/`): `mercs-profile-info.json` (profile types: RPC salary, A.I.M./M.E.R.C. tests),
`mercs-relations.json` (apply as Strac does, §0), `mercs-MERC-listings.json` (listing order for §4.7, `21`),
`shipping-destinations.json` (primary airport delivery sector for §4.4), `game.json` (`unhired_merc_deaths_*`, start sector),
`items.json`/`weapons.json`/`armours.json` (deadliness, protection, prices for §2.2), strings (contract menu, morale texts,
messages; UI only).

**Transcribe** (`tools/transcribe/*.ts`, regenerate, never edit):

| Table | Source | Notes |
|---|---|---|
| `merc-quotes.json`: the 117 quote ids with names and the aliases (`MERC_QUIT_HATED1 = HATED_1_ARRIVES`, …) | `Tactical/Dialogue_Control.h:11-160` | `sequentialEnum` needs alias and hex (`QUOTE_NONE = 0xFFFF`) support; M6 dialogue reuses it |
| `merc-contracts.json`: precedent quote list (13), the special NPC profile ids (DEVIN, SLAY, IGGY, CONRAD, LARRY_NORMAL, LARRY_DRUNK, BIFF) from `NPCIDs`, history codes used here | `Dialogue_Control.cc:84-99`, `Soldier_Profile.h`, `Laptop/History.h` | history codes may move to a `21` table |

Scalars (arrival slots, warning offset, 3 unpaid days, M.E.R.C. thresholds 7/9/12, reputation amounts, `TIME_BETWEEN_HATED_
COMPLAINTS`, ±25, salary multiples and caps, insurance constants, leave gridnos 4868/10433, 20 leave slots, 6 h delay) are named
constants with `@src` headers.

**Imported from the user's data, never committed**: the profile fields of §0 (`prof.ts` for the new game, `savegame-profile.ts`
for saves), the soldier contract fields (`readSoldierContracts` next to `readSoldierAssignments`), sections 43 and 44, the
laptop info fields (account status, payouts, personnel lists).

### 10.2 Stubs

A hand-authored stub profile table in the stub pack (same `MercProfile` model, D8; invented names and numbers, nothing copied
from `prof.dat`), at profile ids whose `mercs-profile-info.json` type fits (e.g. four A.I.M. ids, one M.E.R.C. id, one RPC id,
avoiding the special NPC ids): salaries in the three tiers with weekly < 7 × daily, one deposit, tolerances including a 101 and a
low death-rate tolerance, an A.I.M. pair where one hates the other (tolerance 6 h), a buddy pair, a learn-to-like and a
learn-to-hate target with short times, opinions including an exact −25, a gun attractiveness for the equipment test. Stub mercs
(`src/server/stub-mercs.ts`) must then carry these profile ids: relationship code requires a profile on every OUR soldier, as in
the original.

---

## 11. Minimal M5 implementation

### 11.1 Modules (all with the SFI-SCLA header)

1. `content`: `prof.ts` and `savegame-profile.ts` fields (§0); `readSoldierContracts`; sections 43/44 decoders; the two tables.
2. `sim/campaign/profiles.ts`: the mutable campaign profile (status, availability, salaries, deposit, tolerances, relations with
   slot 2, counts, timer, opinions, hangover, precedent bits, balance, M.E.R.C. days, cost, days served, misc flags 3, suspicious
   death); `ProfileProgress` points into it; `Roster.opinion` reads it.
3. `sim/campaign/relations/`: `relations.ts` (`whichBuddy`, `whichHated`, `getFirstBuddyOnTeam`, team membership predicates),
   `reputation.ts` (`calcDeathRate`, `modifyPlayerReputation`, the three tolerances), `counters.ts` (§5.2), `team-morale.ts`
   (§5.3 and strategic decay), `hiring-check.ts` (§5.4 for `21`).
4. `sim/campaign/contracts/`: `contract-times.ts` (§1.2–§1.3 and the two expiry predicates), `daily.ts` (§2), `renewal.ts`
   (§3.1–§3.5, prompts), `extension.ts` (§3.6), `salary.ts` (§3.7), `departure.ts` (§4.2–§4.6, leave list, delivery events),
   `merc-account.ts` (§4.7), `rpc-pay.ts` (§4.8), `insurance.ts` (§7, if `21` does not own it).
5. `morale.ts`: reputation after each event, the low-morale quote flag, mutable relations in the fan-out.
6. `merc-fate.ts`: §4.9; `Roster.remove`; hiring/arrival contract fields (with `21`).
7. Event handlers: `MERC_DAILY_UPDATE`, `MERC_ABOUT_TO_LEAVE`, `BEGIN_CONTRACT_RENEWAL_SEQUENCE`, `RPC_WHINE_ABOUT_PAY`,
   `MERC_COMPLAIN_EQUIPMENT`, `MERC_LEAVE_EQUIP_IN_DRASSEN/OMERTA`, `DAILY_UPDATE_OF_MERC_SITE` (shared with `21`),
   `HANDLE_INSURED_MERCS`, `PAY_LIFE_INSURANCE_FOR_DEAD_MERC`, `INSURANCE_INVESTIGATION_STARTED/OVER`; the two hourly slots.
8. `protocol`/`server`: §9.

### 11.2 Order of work

(a) profile fields, mutable campaign profiles, save import of profiles and soldier contract fields; (b) relation predicates,
death rate and reputation, `morale.ts` changes; (c) hourly counters and team morale (closes the M4 gap); (d) contract fields at
hire and arrival with `21`, contract view; (e) the daily update; (f) warnings, renewal sequence and prompts; (g) extension,
salary increases, insurance coupling; (h) departures, equipment, `StrategicRemoveMerc`, `removeMerc`; (i) M.E.R.C. account and
RPC pay; (j) stubs and the scenario; (k) sections 43/44 and oracle probes.

### 11.3 Tests

Unit (scripted RNG where draws occur):
- contract times: end at hire (start and later) and at arrival for each slot; `GetMercArrivalTimeOfDay` at hours 0, 1, 7, 8,
  13, 14, 23; display formulas incl. the in-transit clamp and the `+59` rounding; `ContractIsExpiring`/`GoingToExpireSoon` for
  on-time, overdue and the unsigned hour 0/1 case;
- `CheckIfMercGetsAnotherContract`: gate times, `d` 0..3 and overdue, chance values, no draw at `d ≥ 3`;
- `WillMercRenew`/`FindRefusalReason`: each reason alone and in combination, sector rules for tolerance > 0 and learn-to-hate
  at half time, buddy override incl. an in-transit buddy and a dead one, signed elsewhere beats buddy, precedent bits incl. the
  bit-31 case and the daily reset;
- renewal: warning list building (willing/quitter choice with the `Random(n)` value, quote codes), list kept when no sequence
  starts, sequence order, quotes per code, menu shading (money, OKLIFE, bleeding, combat), extension ledger/history, 2-week
  `timeCanSignElsewhere`, insurance branch;
- departures: early-firing window (179/180 minutes after arrival), quotes 98/85 boundary 2880, prompt choices per kind and
  sector, drop-here gridno rules, leave list and 6 h delivery, `StrategicRemoveMerc` status/availability/hangover/another
  contract with draws, POW, medical refund rounding (e.g. deposit 2500, life 37/80 → 1156);
- M.E.R.C. thresholds 7/9/12 and same-midnight quitting with carried items; RPC 3rd unpaid day, arrears payment;
- salary: `CalcNewSalary` on boundary values (250, 251, 1999, 25000, 29000 → cap);
- relations: hated count path with complaints at `time/2` and multiples of 24, battle reset to 1, M.E.R.C. quit at 0, A.I.M.
  daily complaint timer (shared, two quotes), learn-to-hate snap and opinion drift values, learn-to-like drift and snap, only
  squad members, moving groups;
- team morale: averages, leadership, alone, the exact −25 rule and the Strac quirk, step `1 + d/10`, delayed merge, decay
  every third call;
- death rate wrap and the first-day bonus; reputation per event, once per call, clamps; daily morale fan-out excluding a merc
  on the road;
- insurance cost with `Math.fround` against hand-computed values; payout days.

Scenario (stubs, headless, instant and manual drivers identical): three A.I.M. stub mercs with 1-day contracts and a stub
M.E.R.C. merc; on Day 2 05:30 the warning event, at 07:30 three prompts: extend one (ledger, end time), let one go (equipment to
the airport, delivered at 13:30), one refuses because of the hated merc in the sector; the unpaid M.E.R.C. merc quits on the
12th midnight after hiring with his gear; relationship counters make the stub M.E.R.C. hater quit after 6 h together.

Original data (`describe.skipIf(!process.env.JA2_DATA_DIR)`): all 170 profiles parse with the new fields (A.I.M. salaries
positive, weekly ≤ 7 × daily, counts equal times after init); the six saves import contract fields, profiles, sections 43/44
without error and with plausible ends (contract hour 7/13/19 for every A.I.M. merc).

### 11.4 Oracle probes (`tools/oracle`)

New branches in `src/Oracle.cc` and a `patches/0006-contracts-oracle.patch` with wrappers and accessors for the static
functions and globals; outputs stay outside the repo.

| Command | Does | Output |
|---|---|---|
| `contracts` | per OUR soldier: kind, assignment, life, morale and the four modifiers, every §0 contract and insurance field, `GetHourWhenContractDone`, `ContractIsExpiring`, `ContractIsGoingToExpireSoon`, `FindRefusalReason` (wrappers), `WillMercRenew(s, FALSE)`, `GetFirstBuddyOnTeam`, the three tolerances, `SoldierHasWorseEquipmentThanUsedTo`, `CanExtendContractForSoldier`; globals: renewal list and count (accessor), sequence flags, `CalcDeathRate`, deaths, man-days, reputation, M.E.R.C. account status, balance, leave slots (owner, item count) | `{"probe":"contracts","mercs":[{"id":0,"profile":…,"kind":1,"end":…,"hour":7,"expiring":false,"soon":false,"refusal":65535,"willRenew":true,"buddy":-1,…}],"renewal":{"list":[…],"count":0,"on":false},"deathRate":0,"reputation":…}` |
| `profiles team=1` / `who=a,b` | the §0 profile fields, opinions about every current team member | one object per profile |
| `dailyupdate` | `draws on`, `MercDailyUpdate()`, `draws dump`, then `contracts` + `profiles team=1` | the draw log and both dumps |
| `relationshours count=N` | `N` × (`UpdateBuddyAndHatedCounters(); HourlyMoraleUpdate();`), then `profiles` + `contracts` | no draws; the static decay counter counts calls since process start |
| `warpto hour=H minute=M` | `WarpGameTime` to the next occurrence | then `contracts` |
| `removemerc who= history=` | set `ubLeaveHistoryCode`, `StrategicRemoveMerc` with draws traced | profile status, availability, hangover, ledger tail, personnel lists |

Script `probes/contracts.txt`: for SaveGame01, 02, 09 and 10 (07/08 are in turn-based combat): `save`, `contracts`,
`profiles team=1`, `dailyupdate`, `relationshours count=24`, `warpto hour=5 minute=30`, `contracts` (renewal list, quote codes),
`warpto hour=7 minute=30`, `contracts` (sequence flags). `contracts-compare.ts` imports each save into ja2-node, runs the same
functions and compares field by field; RNG-dependent results are replayed from the draw log as for autoresolve. Risks: the
dialogue queue, message boxes and `ReBuildCharactersList` called headless by these handlers (inferred harmless: queued, never
pumped); `InterruptTime` from the renewal event may end a warp early (stop the warp at 07:29 and call
`BeginContractRenewalSequence()` directly if so).

---

## 12. Quirks to keep, deviations to log, verified vs inferred, open questions

**Quirks to keep** (Strac; V where marked):
- Contract hour = arrival slot hour (7/13/19); renewal at :30, warning at :30 two hours earlier; extensions keep the hour.
- Expiry tests use the end day and the slot hour: an unresolved contract is asked again at the same slot every following day;
  POW days add a free day to the contract each midnight.
- The renewal list is cleared only when a sequence completes; entries pile up across slots and may repeat.
- The sequence shows the menu to unwilling mercs; extensions then play the refusal and the departure prompt with a rehire
  button, which loops back to the menu.
- Buddies (slots 0..2, on the team even in transit, not dead) override every refusal except "signed elsewhere"; the precedent
  bit is `index − 1` with the first list entry and unknown quotes on bit 31.
- `lastContractUpdate` is the arrival time: early firing (< 3 h) and the 48-hour quote are measured from arrival, not from the
  last extension.
- Mercs below OKLIFE cannot be extended and say nothing, but can always be let go; Dismiss is refused while bleeding > 12 or in
  combat in the sector.
- M.E.R.C. and RPC mercs who quit over money take their equipment; the drop-here path keeps the profile inventory, the
  airport path zeroes it; an empty-handed departure claims no leave slot.
- Dead mercs stay on the team until removed and keep feeding the daily update (days served, morale events, reputation,
  contract roll).
- `SoldierHasWorseEquipmentThanUsedTo` wraps in INT8 (top guns at high morale complain); the complaint window is 06:00–23:59.
- Relationship counters tick only between squad members; team morale counts every awake teammate; counters and learned
  relations persist across rehires; snapping is postponed in a loaded sector with enemies.
- Strac `HourlyMoraleUpdate`: a slot-1/2 hated merc whose opinion is exactly −25 always forces −25 (V scales until half
  tolerance); kept per D1.
- Death rate wraps as a `u8`; Day 2 always gives the low-death-rate bonus; reputation changes once per morale event call.
- POOR/GREAT morale skip the subject when he is between sectors.
- `CheckIfMercGetsAnotherContract` draws only for fewer than 3 days left (V draws always).
- `DAILY_UPDATE_OF_MERC_SITE` runs before `MERC_DAILY_UPDATE`, so an account that turns invalid empties the same midnight.

**Deviations to log in `docs/deviations.md`**:
- *Contract renewal sequence*: prompts open at once and advance after each answer instead of per map screen frame behind the
  dialogue queue; the flow switches to `strategic` as the original enters the map screen; other contract commands are refused
  while a renewal prompt is open (the original lets the player open another merc's menu, which advances the sequence); the
  right-click close is not modelled (the prompt must be answered or deferred).
- *Renewal list*: capped at 20 entries (the original writes past the array); the stale-index pass after the last entry
  (`Merc_Contract.cc:122-131`) is not emulated (it can only re-open a merc who is expiring and not in the list, inferred
  unreachable).
- *Precedent bit*: the undefined `1 << −1` is defined as bit 31 (x86 behaviour).
- *Contract presentation*: quotes, update boxes, emails, history and screen messages are events and ledgers; no animation,
  sound or wake/sleep dialogue toggles.
- Narrowing of "Merc death and capture stand-ins", "Experience level-up side effects" and "Hourly morale" once §4.9, §3.7 and §5.3
  land.

**Verified** by reading Strac (V cross-checks where marked): every function quoted with a line range — hiring/arrival contract
fields, arrival slots, expiry predicates, the daily update (V), warnings, renewal sequence (V), contract menu and shading,
`WillMercRenew`/`FindRefusalReason` (V), extension, salary increases, `BeginRemoveMercFromContract`, the departure prompt,
equipment placement and the leave list, `StrategicRemoveMerc`, medical refund, M.E.R.C. account thresholds and quitting, RPC
pay, death bookkeeping, hourly counters (V), team morale (V differs), hiring refusals, reputation, death rate, tolerances,
insurance cost/purchase/payout; profile offsets were computed from the extraction order and agree with every offset `prof.ts`
and `savegame-profile.ts` already use.

**Inferred**: that the recorded relationship lines name the slot's merc (for `subject`); that no save can be written while the
sequence holds the pause lock (so the transient flags need not be saved); that the stale-index pass is unreachable; that
headless oracle calls survive the dialogue and message box code; that moving mercs' `sector` is the
departure sector (`16`'s model) for the equipment drop and the sector tests.

**Decisions** (the former open questions):
1. Life insurance belongs to `21`; the contract side calls hooks with no-op defaults (`ContractHooks`, deviation "Contract
   coupling to the laptop").
2. Strac's `HourlyMoraleUpdate` hated rule is kept (D1).
3. `endsAt` is exposed at hour precision, as on the personnel screen.
4. History and email stores come with `21`; this spec emits `historyAdded` and `mailDue` events.
