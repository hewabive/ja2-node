# 22 — Merc contracts and relationships

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `V:` is vanilla `Build/`; JSON files are
`data/externalized/*.json`. "(inferred)" marks conclusions not traced end to end. C integer semantics: `/` truncates toward
zero (`idiv`), unsigned subtraction wraps (`u32`), `INT8`/`UINT8` stores wrap (`i8`/`u8`). `Random` and `Chance` are the
`main` stream, `PreRandom` the `pre` stream (`01` §3.6); `Chance(x)` = `Random(100) < x` and draws even for `x = 0`;
`Random(0)` returns 0 without drawing, `Random(1)` draws. Times are world minutes (`GetWorldTotalMin`) unless marked;
`day`/`hour` are `GetWorldDay()`/`GetWorldHour()` (`15` §1.1). "Team order" = soldier id order over the OUR team,
`FOR_EACH_IN_TEAM`. Quote numbers are the `Tactical/Dialogue_Control.h:11-160` enum values
(`data/tables/merc-quotes.json`). Merc kinds (`ubWhatKindOfMercAmI`): `PLAYER_CHARACTER 0` (I.M.P.), `AIM_MERC 1`, `MERC 2`
(M.E.R.C.), `NPC 3` (recruited RPCs), `EPC 4`, `NPC_UNEXTENDABLE 5`, `VEHICLE 6` (`roster.ts` `MercKind`). Profile *types*
(`AIM`, `MERC`, `IMP`, `RPC`, `NPC`) come from `mercs-profile-info.json` (`MercProfile::isRPC()` etc.,
`externalized/mercs/MercProfile.cc:52-94`) and are not the soldier kind.

**Scope.** What follows the hire: the contract hour and contract times, the daily merc update, renewal and extension,
dismissal and departures with the medical deposit refund, RPC pay, relationships, reputation and the death rate, including
the tests the A.I.M. site calls (§5.4). `21` owns the laptop sites, `HireMerc` with the contract fields it sets at hire and
arrival, the arrival slots and `MercArrivesCallback`, hire costs, the A.I.M. refusal flow, the M.E.R.C. account (accrual,
status, `SettleMercAccounts`), email, history, personnel and life insurance. `23` owns dealers and repairs. `33` owns
the morale event table and `UpdateSoldierMorale`, `33` `StatChange`/`ProcessStatChange`. `15` owns the clock, the
event queue, the order of the 00:00 events and the hourly update. `16` owns squads, groups, `RemoveCharacterFromSquads`,
`RemoveGroup` and `CheckAndHandleUnloadingOfCurrentWorld`. `18` §5 owns assignments (the training opinion bonus reads §5
opinions). `19` owns merc death and capture. `14` owns the savegame container. The agent API (commands, prompts,
events, view) is `29`.

---

## 0. State

**Soldier, OUR team**: `MercRecord.contract` (`MercContract`, `src/sim/campaign/contracts/contract-state.ts`), imported
from the soldier record (`Tactical/LoadSaveSoldierType.cc:382-386, 400-405, 464-476, 526-550`; `savegame-soldier.ts`):

| Field | Original | Notes |
|---|---|---|
| `kind` | `ubWhatKindOfMercAmI` | on `MercRecord` |
| `contractEnd` | `iEndofContractTime` (INT32 minutes) | AIM: departure minute; M.E.R.C.: minute of death (§4.9); others: meaningless |
| `contractStartDay` | `iStartContractTime` | M.E.R.C. only: day hired (display) |
| `totalContractLength` | `iTotalContractLength` (INT32 days) | AIM: days bought so far; RPC: days on the team |
| `typeOfLastContract` | `bTypeOfLastContract` | `CONTRACT_EXTEND_1_DAY 0`, `_1_WEEK 1`, `_2_WEEK 2` (`Strategic/Merc_Contract.h:8-13`) |
| `timeCanSignElsewhere` | `iTimeCanSignElsewhere` | gate for `CheckIfMercGetsAnotherContract` (§2.3) |
| `signedAnotherContract` | `fSignedAnotherContract` | never cleared while on the team |
| `lastContractUpdate` | `uiTimeOfLastContractUpdate` | set **only on arrival** (`21` §2.6) |
| `timeWillArrive` | `uiTimeSoldierWillArrive` | minute of the arrival slot; its hour is the contract hour (§1.2) |
| `renewalQuoteCode` | `ubContractRenewalQuoteCode` | `NOT_USED 0`, `89_USED 1`, `115_USED 2` (`Tactical/Soldier_Control.h:119-121`) |
| `leaveHistoryCode` | `ubLeaveHistoryCode` | history code for the departure (§4.5) |
| `medicalDeposit` | `usMedicalDeposit` | deposit paid at hire (AIM) |
| `contractPriceIncreased` | `fContractPriceHasIncreased` | set by a level-up (§3.7) |
| `lifeInsurance`, `startOfInsuranceContract`, `totalLengthOfInsuranceContract`, `startTimeOfInsuranceContract` | `usLifeInsurance`, `iStartOfInsuranceContract` (day), `iTotalLengthOfInsuranceContract` (days), `uiStartTimeOfInsuranceContract` (minute) | §7 |
| morale | `bMorale`, `bTeamMoraleMod`, `bTacticalMoraleMod`, `bStrategicMoraleMod`, `bDelayedStrategicMoraleMod` | on `Soldier` (`33`) |
| `quoteSaidFlags`, `corpseQuoteTolerance` | `usQuoteSaidFlags` bits `LOW_MORAL 0x10`, `ANNOYING_MERC 0x40`, `LIKESGUN 0x80`, `PERSONALITY 0x4000`, `FOUND_SOMETHING_NICE 0x8000`; `bCorpseQuoteTolerance` | on `MercRecord`; daily resets (§2.1) |

**Campaign profile**: the mutable `gMercProfiles[]` is `ProfileProgress` (`src/sim/tactical/profiles.ts`) in
`StrategicState.profiles`, built from `prof.dat` (or `stubs/profiles.json`) at the new game and imported from save section
5. Relations, opinions and counters are mutable there (slot 2 of `bBuddy`/`bHated` and `bMercOpinion[]` change at run
time, §5.2); the morale fan-out, the training opinion bonus and this doc read the same record. Fields used here (ja2-node
drops the Hungarian prefix: `bMercOpinion` → `opinions`, `bBuddy` → `buddies`, `iBalance` → `balance`; the offsets in the
716-byte record are in `src/content/formats/prof.ts`, computed from the extraction order in
`Tactical/LoadSaveMercProfile.cc:36-208`): `bMercOpinion[75]`, `bBuddy[5]`, `bHated[5]`, `bHatedTime[5]`, `bHatedCount[5]`,
`bLearnToLike`/`Time`/`Count`, `bLearnToHate`/`Time`/`Count`, `ubTimeTillNextHatedComplaint`, `bDeathRate`,
`bReputationTolerance`, `bPersonalityTrait`, `bAttitude`, `bMercStatus`, `uiDayBecomesAvailable`, `usTotalDaysServed`,
`sSalary` (i16), `uiWeeklySalary`, `uiBiWeeklySalary`, `bMedicalDeposit` (flag), `sMedicalDepositAmount`,
`bMainGunAttractiveness`, `bArmourAttractiveness`, `usOptionalGearCost`, `iBalance`, `ubMiscFlags3`,
`ubDaysOfMoraleHangover`, `uiPrecedentQuoteSaid`, `ubSuspiciousDeath`, `iMercMercContractLength`; `uiTotalCostToDate` lives
in `state.finances.profileCostToDate`.

At profile load (`InitProfileFromContent`, `Tactical/Soldier_Profile.cc:188-217`; `initProfileFromContent` in
`src/sim/campaign/profiles.ts`) the attractiveness values and the optional gear cost are recomputed from the profile
inventory (last gun's `ubDeadliness`, last armour's protection, sum of prices) and
**`bHatedCount[0..1] = bHatedTime[0..1]`, `bLearnToHateCount = bLearnToHateTime`, `bLearnToLikeCount = bLearnToLikeTime`**.
`mercs-relations.json` may override opinions and relations (`DefaultContentManager.cc:1285-1290`,
`MercProfile::deserializeStructRelations`); the shipped file is an empty array.

**Global** (saved): `strategicStatus.mercDeaths` (u8), `.manDaysPlayed` (u32), `.badReputation` (u8 0–100),
`.insuranceInvestigations`, `.unhiredMercDeaths` (`state.status`); the renewal list `ContractRenewalList[20]` of profile
ids and its count `ubNumContractRenewals` (save section 43, 81 bytes: 20 × {u8 profile, 3 filler} + u8 count,
`Merc_Contract.cc:40-82`); the sequence flags `gfContractRenewalSquenceOn`, `ubCurrentContractRenewal`,
`ubCurrentContractRenewalInProgress`, `gfInContractMenuFromRenewSequence` (not in the native save); the 20-slot leave item
list and its owners (section 44, `Map_Screen_Interface.cc:4043-4128`); laptop info: `gubPlayersMercAccountStatus`, the life
insurance payout list, the personnel dead/left/other lists (`Laptop/LaptopSave.h:83-110`). ja2-node: the renewal list and
flags, the leave list and the queued endings are `StrategicState.contracts` (`ContractState`: `renewal`, `leaveList`,
`pendingEndings`); the laptop info is `state.laptop`.

Dead mercs stay on the roster with `ASSIGNMENT_DEAD` until the player removes them (`removeMerc`, §4.1); the daily update
still processes them (§2.1).

---

## 1. Kinds, contract hour and contract times

### 1.1 Who has which contract

| Kind | Contract | Ends by | Pay |
|---|---|---|---|
| A.I.M. | 1, 7 or 14 days, extendable | renewal sequence at the arrival slot (§3) | up front: hire (`21` §2.5), extensions (§3.6) |
| M.E.R.C. | open-ended | player dismisses, or quits when the account turns invalid (§4.7) | daily accrual settled on the M.E.R.C. site (`21` §3.4) |
| RPC (kind `NPC`) | open-ended | dismissed; quits after 3 unpaid days (§4.8); hated-merc rules (§5.2); Slay leaves after a week (`35` §2.4) | `sSalary` per day at 00:00 (§4.8) |
| I.M.P. | none | dismissal only | none |
| EPC | none | unescorted (`24`) | none |

`CanExtendContractForSoldier` (`Strategic/MapScreen.cc:6779-6798`) gates the contract button and menu: not a vehicle, not
an EPC, not `IN_TRANSIT`, not `ASSIGNMENT_POW`. Everyone else (I.M.P., M.E.R.C., RPCs, mercs below OKLIFE) gets the menu
so that they can be dismissed; only A.I.M. mercs can extend (§3.4).

### 1.2 The contract hour

The contract fields set at hire and at arrival (`HireMerc`, `MercArrivesCallback`), the arrival slots
(`GetMercArrivalTimeOfDay`) and worked examples are `21` §2.5–§2.6. The contract end is a midnight plus the contract hour:
```
ContractHour(s) = (timeWillArrive % 1440) / 60                        // GetHourWhenContractDone, Merc_Contract.cc:983-991
```
An A.I.M. contract therefore ends at **07:00, 13:00 or 19:00** (the hour of the arrival slot, `Merc_Hiring.h:14-16`), and
the renewal happens at :30 (§3.3). An extension adds `len × 1440` to `contractEnd` (§3.6), so the hour never changes for
the whole employment.

### 1.3 Contract time as the player sees it

All displays clamp an in-transit merc's remaining time to `totalContractLength × 1440` (the provisional end includes the
flight day). Only A.I.M. mercs (and Slay) show a contract time; M.E.R.C. mercs show `unpaid days / days hired`; others
N/A.

| Where | Formula | Source |
|---|---|---|
| Team list column | `r = contractEnd − now` (clamped); `r ≥ 3 days` → `r/1440` "d" green; else `(r > 5 ? (r + 59)/60 : 0)` "h" red, flashing white when `r ≤ 240` | `MapScreen.cc:7697-7732`, `:100, :107` |
| Merc info panel | `r ≥ 1440` → `r/1440.0` with one decimal "d / total d"; else hours as above "h / total d"; daily rate: AIM `biweekly/14`, `weekly/7` or `sSalary` by `typeOfLastContract`, others `sSalary`; medical deposit `profile.sMedicalDepositAmount` if > 0 | `MapScreen.cc:834-899` |
| M.E.R.C. merc | `iMercMercContractLength` "d / " `(now/1440 − contractStartDay)` "d" | `MapScreen.cc:866-871` |
| Personnel screen | `r = max(0, contractEnd − now)` (clamped); `days = r/1440`, `hours = r%1440/60`; total days served; total cost; daily rate (as above); medical deposit, or for M.E.R.C. "unpaid" `sSalary × iMercMercContractLength` | `Laptop/Personnel.cc:2285-2381` |

Morale shows as a bar in tactical and as text on the map (`GetMoraleString`, `Map_Screen_Interface.cc:960-970`): dead →
"Bad", `> 80` Great, `> 65` Good, `> 35` Stable, `> 20` Poor, else Panic. Opinions, relations, tolerances, the death rate
and the reputation are never displayed. The formulas are `contract-times.ts` (`remainingContractMinutes`,
`teamListContract`, `personnelTimeLeft`).

---

## 2. The daily merc update

### 2.1 `MercDailyUpdate` (`Strategic/Strategic_Merc_Handler.cc:135-370`)

Runs on the everyday `MERC_DAILY_UPDATE` event at 00:00, after `DAILY_UPDATE_OF_MERC_SITE` (`21` §3.5) and
`HANDLE_INSURED_MERCS` (`21` §7.1) and before `SETUP_MINE_INCOME` and the 00:00 hourly update (`15` §3.1).

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
      p.status = MERC_OK; if miscFlags3 & PLAYER_LEFT_MSG_FOR_MERC_AT_AIM: clear it, email "merc is back" (`21` §2.2)
  elif profile type AIM or MERC:
    chance = pid < 40 (MAX_NUMBER_MERCS) ? 2*exp (and set PLAYER_HAD_CHANCE_TO_HIRE)
                                         : exp (set the flag only when day > 3, DAYS_TIL_M_E_R_C_AVAIL)
    if Random(100) < chance: p.status = WORKING_ELSEWHERE; p.dayBecomesAvailable = 1 + Random(6 + exp/2)
  if p.hangover > 0: p.hangover--                                                    // off-team profiles only
HandleSlayDailyEvent()                                                               // Slay leaves when contractEnd/1440 <= day (`35` §2.4)
```

V matches in order and content (V: `StrategicMercHandler.c:160-330`, RPC test by profile range). A dead merc not yet
removed still gets days served, an equipment check, `DailyMoraleUpdate` (with its reputation side effects, §6.2) and the
another-contract roll.

### 2.2 Equipment complaints

`SoldierHasWorseEquipmentThanUsedTo(s)` (`:434-488`): over all 19 inventory slots, best gun `ubDeadliness` and best armour
protection (−1 if none); each found value is rescaled `v = v * (50 + morale) / 100` **stored in an INT8** (a 100-deadliness
gun at morale ≥ 78 wraps negative); complain if `gun != −1 && gun < p.mainGunAttractiveness/2` or the same for armour.
`MercComplainAboutEquipment(profile)` (`:491-523`, the event): Larry swaps to his current profile; the soldier must be
awake, `life ≥ OKLIFE`, on a squad, and the test must still hold → quote 43 (`WHINE_EQUIPMENT`). No draws in the handler.

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

The sector events reach mercs with `!betweenSectors && sector == s.sector` (`Morale.cc:505-516`), so a merc on the road
does not take his own POOR/GREAT event. `s.morale` is the last refreshed value (`RefreshSoldierMorale` skips sleepers; for a
dead merc it is the value at death).

### 2.5 Unhired A.I.M. and M.E.R.C. profiles (`Tactical/Campaign.cc:1041-1173`)

Called from the profile loop of §2.1; they decide availability on the sites (`21` §2.2):
- `HandleUnhiredMercImprovement`: stat gains while working elsewhere or at home, then `ProfileUpdateStats`, whose level-ups
  raise salaries (§3.7); draws §8.1.
- `HandleUnhiredMercDeaths`: `(INT16)PreRandom(1000) < chance`, chance `10 − exp` with the personality and stealth terms
  (§5.6); needs `PLAYER_HAD_CHANCE_TO_HIRE`; capped by `unhiredMercDeaths < unhired_merc_deaths_<difficulty>` (policy 1/2/3,
  `game.json:254-256`). An AIM profile's death sends `MERC_DIED_ON_OTHER_ASSIGNMENT` (`21` §2.2).

ja2-node: `handleUnhiredMercImprovement`, `handleUnhiredMercDeaths` (`contracts/daily.ts`).

---

## 3. Expiry warnings and the renewal sequence

### 3.1 The two-hour warning (`FindOutIfAnyMercAboutToLeaveIsGonnaRenew`, `Merc_Contract.cc:863-916`)

On each `MERC_ABOUT_TO_LEAVE` (05:30, 11:30, 17:30):

```
willing = []; quitter = null
for s in OUR team, team order:
  skip life == 0, IN_TRANSIT, POW, kind != AIM; skip !ContractIsGoingToExpireSoon(s)
  s.renewalQuoteCode = NOT_USED
  renewalList[count++] = s.profile                 // never cleared here, no de-duplication (§10)
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

Both test the **day** of the end, not the minute, and the hour of the arrival slot (`timeWillArrive`), not of
`contractEnd`. An overdue contract (never resolved) passes the day test on every later day: the merc is listed again at the
next morning's warning for his slot and asked again at the slot. The unsigned `− 2` makes hours 0 and 1 never "soon";
A.I.M. contract hours are 7, 13, 19.

### 3.2 `BeginContractRenewalSequence` (`Merc_Contract.cc:88-111`)

On each `BEGIN_CONTRACT_RENEWAL_SEQUENCE` (07:30, 13:30, 19:30): if some list entry is a soldier (`FindSoldierByProfileID`,
any team) with `life != 0`, not `IN_TRANSIT`, not POW and `ContractIsExpiring` → `sequenceOn = true`, `current = 0`,
`inProgress = false`, `PauseGame` + `LockPauseState(CONTRACT_RENEWAL)`, `InterruptTime` (`15` §2.9: the clock stays at
07:30), enter the map screen. Otherwise nothing happens **and the list is kept** for the next slot. Time compression is
refused while the sequence is on (`MapScreen.cc:6274-6277`).

### 3.3 One merc at a time (`HandleContractRenewalSequence`, `:117-205`, every map screen frame)

```
if !sequenceOn: return
if current == count: count = 0; sequenceOn = false; UnLockPauseState()        // falls through with a stale index (§10)
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
(§3.6). Quotes need `CanSayQuote` (`Dialogue_Control.cc:517-531`: profile, `life ≥ OKLIFE`, not the robot, not gassed, not
POW); the menu opens regardless. ja2-node advances the sequence synchronously after each answer
(`ContractFlow.renewalStep`) instead of per frame behind the dialogue queue (deviation "Contract renewal sequence"); a
listed merc who has died or been captured since the warning is skipped when let go (deviation "Renewal of a merc who
cannot leave").

### 3.4 The contract menu (`Strategic/Assignments.cc:4460-4528`, `CreateContractBox` `:5294-5333`, shading `MapScreen.cc:5176-5211`)

Lines (`Map_Screen_Interface.h:122-131`): current funds, blank, **one day** (`$sSalary`), **one week**
(`$uiWeeklySalary`), **two weeks** (`$uiBiWeeklySalary`), **Dismiss**, **Cancel**. Prices are the profile's current
salaries.

| Line | Enabled when | Effect |
|---|---|---|
| day / week / two weeks | kind AIM, `life ≥ OKLIFE`, price ≤ balance | `MercContractHandling` (§3.6), menu closes |
| Dismiss | not (`INCOMBAT` and `s.inSector`) and `bleeding ≤ 12` (`MIN_BLEEDING_THRESHOLD`) | from the sequence: at once; otherwise after a yes/no box; `leaveHistoryCode = MERC_FIRED (13)`, `BeginRemoveMercFromContract` (§4.2) |
| Cancel | always | menu closes; **from the sequence** `BeginRemoveMercFromContract` (history stays "contract expired"); otherwise nothing |
| right click | — | closes the menu; in the sequence it stays open-ended until the player reopens the menu from the contract button |

Outside the sequence the player opens the menu from the map screen at any time (never in tactical: `Assert(fInMapMode)`).
ja2-node: `contractOptions` (`renewal.ts`) computes the shading with the reasons `notAimMerc`, `tooBadlyHurt`,
`notEnoughMoney`, `inCombat`, `bleeding`; the menu is the `contractRenewal` prompt (deviation "Contract prompts"), which
has no right click.

### 3.5 Will he renew? (`WillMercRenew`, `Merc_Contract.cc:396-451`; `FindRefusalReason`, `:343-393`)

```
WillMercRenew(s, say):
  if kind != AIM: return false
  if s.signedAnotherContract: if say: quote 83 (WONT_RENEW_CONTRACT_LAME_REFUSAL); return false   // buddies do not help
  reason = FindRefusalReason(s); if reason == NONE: return true
  buddy = GetFirstBuddyOnTeam(p) → slot 0/1/2 gives quote 103/104/105, none → NONE
  if say:
    q = buddy != NONE ? buddyQuote : reason
    bit = (index(q) − 1) & 31                     // 0-based index in the 13-entry list below; not found → 0 → bit 31
    if p.precedentQuoteSaid has bit: quote 106 (PRECEDENT_TO_REPEATING_ONESELF_RENEW) else set bit
    quote q
  return buddy != NONE

FindRefusalReason(s):                              // order of importance: hated, death rate, morale
  for i in 0, 1: h = p.hated[i]
    if h < 0 || !OnTeamArrivedAlive(h): continue   // IsMercOnTeamAndInOmertaAlreadyAndAlive (Tactical/Soldier_Add.cc:991-995): OUR, not IN_TRANSIT, life > 0
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
  first i in 0..2 (two buddies, then the learned-to-like slot) with p.buddy[i] >= 0, a soldier of that profile on the
  OUR team (any assignment, in transit included) and that profile not MERC_IS_DEAD
```

Precedent list (`Dialogue_Control.cc:84-99`, `data/tables/merc-contracts.json` `precedentQuotes`), index order: 80, 81, 82,
83, 86, 87, 88, 95, 97, 99, 100, 101, 102. The first entry and every unlisted quote (the buddy quotes 103–105 among them)
share bit 31 (C++ leaves `1 << −1` undefined; deviation "Precedent quote bit"). The bits are cleared for every living
profile at each daily update (§2.1). V (`MercContract.c:417-612`) computes the buddy first, over all five slots (only three
are ever filled) with "on team and alive", and reaches the same outcomes and quotes.

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

The insurance box is raised before the contract charge is booked and answered later, so the ledger order is contract
charge, then the insurance transaction. No medical deposit on extension; `lastContractUpdate` is **not** touched. The
insurance box is the `insuranceExtension` prompt; the unaffordable box is an event.

### 3.7 Salary increases

A level gained by an employed A.I.M. merc sets `contractPriceIncreased`; A.I.M. and M.E.R.C. (and unemployed
A.I.M./M.E.R.C. profiles) multiply `sSalary`, `uiWeeklySalary`, `uiBiWeeklySalary` and `sMedicalDepositAmount` once per
level gained (`Tactical/Campaign.cc:666-737`); employed RPCs and I.M.P.s keep their salary:

```
CalcNewSalary(old, max):  if old == 0: 0; n = u32(old * 1.25) (= old + old/4 truncated); n = RoundOffSalary(n); min(n, max), at least 5
RoundOffSalary(n): multiple = 5 (≤250), 10 (≤500), 25 (≤1000), 50 (≤2000), 100 (≤5000), 500 (≤10000), 1000 (≤25000),
                   2000 (≤50000), else 5000; if n % multiple: n = (n + multiple/2) / multiple * multiple
max: MAX_DAILY_SALARY 30000 for sSalary and the deposit, MAX_LARGE_SALARY 500000 for the others
```

An employed M.E.R.C. merc's level-up also posts the "went up a level" email event at `now + 60 + Random(60)` (`21` §3.5).
The soldier's paid `medicalDeposit` does not change. The next renewal shows the new prices; the merc says quote 116
(`MERC_GONE_UP_IN_PRICE`) once before the menu (§3.3, §4.3).

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
| Slay | his week ends (`35` §2.4) | — | none | `SLAY_MYSTERIOUSLY_LEFT 76` |
| Dead or captured merc removed | map screen "remove merc" (`Assignments.cc:4330-4390`) | — | none (dropped earlier) | none for the dead; 22 for a POW |

### 4.2 `BeginRemoveMercFromContract(s)` (`Strategic/Assignments.cc:4397-4431`)

```
if s.life <= 0 || s.assignment == POW: return
kind MERC or NPC: quote 64 (RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO)
kind AIM: if WillMercRenew(s, false): quote u32(now − s.lastContractUpdate) < 2880 ? 98 : 85
contract-ending event with the rehire button (§4.3)
if u32(now − s.lastContractUpdate) < 180:                           // within 3 hours of ARRIVAL
  p.hangover = 3 + Random(4)                                         // the A.I.M. site's lame refusal meanwhile (§5.4)
  if kind AIM: ModifyPlayerReputation(−3)                            // REPUTATION_EARLY_FIRING
```

### 4.3 The contract-ending prompt (`Merc_Contract.cc:548-587, 750-857`)

The dialogue event (after the quotes): `InterruptTime`, `PauseGame`, `LockPauseState(CONTRACT_ENDING)`; Iggy becomes
available to the army if the player still owes him money (`iBalance < 0`, `:966-980`); an EPC is unescorted instead;
otherwise:

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

The box is the `mercDeparture` prompt (`departureOptions`, `departure.ts`). The Iggy rule is the `mercLeavingTeam`
contract hook, which the campaign wires to `NarrativeFlow.mercLeavingTeam` (`handleUniqueEventWhenPlayerLeavesTeam`,
`strategic/narrative/profiled-enemies.ts`; the fact turns the next enemy elite into Iggy, `35` §2.6). It runs only in
this event, after the pause and before the prompt: an RPC who quits unpaid (§4.7) skips it, so Iggy reaches the army
only when he is dismissed or quits over a hated merc while still owed money.

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

Send elsewhere: the first of 20 slots with an empty list; each inventory slot with objects (slot order), then the key-ring
keys, are appended with the owner profile per item; the **profile inventory is zeroed** (a later rehire with gear gets
nothing, `21` §2.4); `MERC_LEAVE_EQUIP_IN_DRASSEN` or `_IN_OMERTA` is posted at `now + 360` with the slot. Six hours later
(`:1044-1096`): message "X left equipment in …"; the items go to the start sector at gridno 4868
(`START_SECTOR_LEAVE_EQUIP_GRIDNO`) or to the primary airport's delivery sector at gridno 10433, into the loaded world
(`VISIBLE`, level 0, `REACHABLE`) or the sector's item list; the slot is freed (its owner id is not reset). A merc with no
items claims no slot, so a second departure can reuse the same slot before the first event fires.

### 4.5 `StrategicRemoveMerc(s)` (`Merc_Contract.cc:613-708`)

```
if fromSequence: EndCurrent()
if s.leaveHistoryCode == 0: s.leaveHistoryCode = MERC_CONTRACT_EXPIRED (22)
personnel lists: life <= 0 → dead; code FIRED or POW → "fired"; else "other"
kind NPC: SetupProfileInsertionDataForSoldier
if s.assignment >= ON_DUTY && s.groupId: VEHICLE → TakeSoldierOutOfVehicle else RemoveGroup(his own group)   // 16
if p.status != MERC_IS_DEAD:
  p.status = RETURNING_HOME; p.dayBecomesAvailable = 1 + Random(2)
  if MercThinksHisMoraleIsTooLow(s): p.hangover = 3 + Random(4)                       // :454-462, 1–2 of those days spent returning
  if s.signedAnotherContract: p.status = WORKING_ELSEWHERE; p.dayBecomesAvailable += 1 + Random(6 + s.expLevel/2)   // :465-472
if !(s.statusFlags & DEAD): history(s.leaveHistoryCode, profile, now, s.sector)
if s.assignment == POW: p.status = FIRED_AS_A_POW (never hireable again) else CalculateMedicalDepositRefund(s)   // :680-689, §4.6
TacticalRemoveSoldier(s)                       // RemoveCharacterFromSquads, team slot, map (Soldier_Create.cc:958-1022)
CheckAndHandleUnloadingOfCurrentWorld()        // 16
StopTimeCompression()                          // reason mercLeft
```

The profile insertion data of a departing kind-`NPC` merc (`35` §2.6) is written before he leaves his group, on every
path into `StrategicRemoveMerc` (also the removal of a dead or captured RPC, which the original does not exclude). He is
in the sector (`bInSector`) when the world is loaded and he holds a merc slot there or rides a vehicle in it
(`offGridInSector`); a dead merc keeps his slot as the original keeps `bInSector`. Otherwise the profile takes his
strategic insertion code (`insertionCode`) with data 0. ja2-node: `ContractFlow.setupProfileInsertionData`, through
`NarrativeFlow.setupProfileInsertionDataForMerc` (shared with the escort release, `24`).

What the countdowns mean for the sites: `21` §2.1–§2.2. `CheckAndHandleUnloadingOfCurrentWorld` is `16`. No morale
event fires for anyone when a merc leaves or is fired; teammates feel it only through the hourly team opinion (§5.3) and
through buddies and hated mercs at later renewals and hires.

### 4.6 Medical deposit refund (`CalculateMedicalDepositRefund`, `Merc_Contract.cc:711-742`)

Only from `StrategicRemoveMerc` (contract end, dismissal, quitting, or the player removing a dead merc from the team list,
`Strategic/Assignments.cc:4358-4363`), never for a POW (`Merc_Contract.cc:680-689`). Nothing without the profile's
`bMedicalDeposit` flag; otherwise from the soldier's paid `medicalDeposit` (`usMedicalDeposit`) and the life at departure
(bleeding and unhealed wounds reduce the refund):

| Condition | Ledger | Amount | Mail (`AIM_SITE`, first data = amount, second = profile) |
|---|---|---|---|
| `life == lifeMax` | `FULL_MEDICAL_REFUND (19)` | deposit | `AIM_MEDICAL_DEPOSIT_REFUND` |
| `0 < life < lifeMax` | `PARTIAL_MEDICAL_REFUND (20)` | `(2·deposit·life/lifeMax + 1)/2` (rounded half up) | `AIM_MEDICAL_DEPOSIT_PARTIAL_REFUND` |
| `life ≤ 0` | none (`NO_MEDICAL_REFUND` is commented out) | 0 | `AIM_MEDICAL_DEPOSIT_NO_REFUND` (first data = the deposit) |

A dead merc's body stays on the team list until the player removes it; only then is the "no refund" mail sent. M.E.R.C.
mercs never pay a deposit (`21` §3.3). ja2-node: `contracts/departure.ts`.

### 4.7 Quitting unpaid (`MercsContractIsFinished`)

The M.E.R.C. account (`Laptop/Mercs.cc:513-588`, `Mercs.h:13-31`: daily accrual, warning, suspension, invalid status,
payment) is `21` §3.4–§3.5.

`MercsContractIsFinished(s)` (`Strategic_Merc_Handler.cc:375-419`, for the invalid account in §2.1 and the unpaid RPC in
§4.8): enter the map screen; `InterruptTime`; `PauseGame`; quote 54 (`NOT_GETTING_PAID`, M.E.R.C. with an invalid account)
or 55 (kind `NPC`); contract ending **without** the equipment prompt (straight to `StrategicRemoveMerc`, the items leave
with him); `leaveHistoryCode = MERC_QUIT`. M.E.R.C. mercs leave the midnight the account turns invalid (§10).

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

### 4.9 Death bookkeeping (the contract parts of `StrategicHandlePlayerTeamMercDeath`, `Strategic_Merc_Handler.cc:52-130`)

In order around what `19` does: history `MERC_KILLED (3)`, or `MERC_KILLED_CHARACTER (77)` when the attacker is on
the OUR team, with the soldier's sector (the world sector if invalid); a screen message off the game screen; deaths +1 (not
EPC/robot); dead flags; `p.status = MERC_IS_DEAD`; **life insurance** (suspicion and `AddLifeInsurancePayout`, `21` §7.2;
never suspicious in autoresolve); morale fan-out (not EPC/robot); M.E.R.C. kind: `contractEnd = now` and Speck's "lost a
merc" flag; `HandleStrategicDeath`. On the map screen `HandleStrategicDeath` also makes each living teammate (life ≥
OKLIFE) whose buddy slot 0/1/2 holds the dead profile say 15/16/17 (`Strategic/Strategic.cc:44-63`); tactical deaths do the
same for teammates in the sector (`Tactical/Overhead.cc:2208-2220`). ja2-node: `merc-fate.ts` calls
`ContractFlow.deathBookkeeping`, `lifeInsuranceOnDeath`, `mercMercDied` and `buddyKilledQuotes` in that order.

---

## 5. Relationships

### 5.1 The data

Per profile (§0): `bMercOpinion[0..74]` about the 75 recruitable profiles (`NUM_RECRUITABLE`; A.I.M., M.E.R.C., I.M.P.
slots and RPCs), usually in −25..+25; buddies `bBuddy[0..1]` and hated `bHated[0..1]` from the data, slot 2 of each filled
at run time by learning; `bHatedTime[0..1]` tolerances (hours together), `bLearnToLike`/`bLearnToLikeTime`,
`bLearnToHate`/`bLearnToHateTime`; the running counts and `ubTimeTillNextHatedComplaint`. Constants: `BUDDY_OPINION +25`,
`HATED_OPINION −25`, `TIME_BETWEEN_HATED_COMPLAINTS 24` (`Tactical/Soldier_Profile_Type.h:216-237, 430`).
`WhichBuddy`/`WhichHated` return the first slot 0..2 holding the profile (`Soldier_Profile.cc:843-875`);
`BUDDY_MERC`/`HATED_MERC` test slots 0..2. Opinions of profile ids ≥ 75 read 0 (deviation "Opinions of high profile ids").

Everything lives on the profile, so tolerance spent in one contract stays spent after a rehire, and learned buddies or
enemies are permanent for the campaign (counts are only initialised at new-game profile load, §0).

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

The complaint timer is shared by all hated slots and all teammates of `s` within the hour (one decrement per hour), but
each matching pair checks it, so two exhausted enemies give two quotes in the same hour. A.I.M. mercs never quit
mid-contract: they complain every 24 hours and refuse to renew (§3.5). Examples: tolerance 48 h on the same squad →
complaints after 24 h (count 24) and at count 0 after 48 h (a M.E.R.C. merc quits then); learning to like over 30 h from
opinion 0 adds 1 per hour at counts 14..10 and 2 per hour at counts 9..1 (reaching 23) and sets +25 at count 0.

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
      if slot is HATED1/2 && p.hatedCount[slot] <= p.hatedTime[slot]: foundHated = true; break    // always true (§10)
      (slot not found: −25 is mixed in unscaled)
    sum += op; n++; lead = max(lead, EffectiveLeadership(o))
  team = foundHated ? −25 : n > 0 ? i8(sum/n) + (lead − 50)/10 : 0
  team = clamp(team, −25, +25)
  d = team − s.teamMoraleMod; s.teamMoraleMod += d > 0 ? 1 + d/10 : d < 0 ? −1 + d/10 : 0; clamp ±50
  if s.delayedStrategicMoraleMod: s.strategicMoraleMod = clamp(+ delayed, ±50); delayed = 0
  RefreshSoldierMorale(s)
if ++counter == 3: counter = 0; DecayStrategicMoraleModifiers()     // Morale.cc:220-241
```

The counter is function-static in the original; ja2-node keeps it in `state.teamMorale.strategicDecayCounter` (deviation
"Strategic morale decay counter"). A merc alone drifts toward 0; with a team the average opinion plus the best effective
leadership around (his own included) pulls his team modifier by about a tenth of the gap per hour. A hated merc forces −25
only if the opinion value is exactly −25 (the opinion table and the hated slots are separate data). V scales the hated
opinion by spent tolerance and forces −25 only from half tolerance on (V: `Morale.c:713-734`); Strac's `<= hated_time`
makes the scaling dead code. ja2-node ports Strac (D1).

### 5.4 Hiring refusals (`CanMercBeHired`, `Laptop/AIMMembers.cc:1769-1863`)

The A.I.M. site calls it when the player presses HIRE in first contact (`21` §2.3):

```
if p.hangover > 0: quote 82 (LAME_REFUSAL); refuse                    // buddy or not
buddy = GetFirstBuddyOnTeam(p); joinQuote = NONE                      // §3.5
for i in 0..2: h = p.hated[i]; skip h < 0 or !OnTeamArrivedAlive(h)  // slots 0, 1 and the learned slot 2; §3.5
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
opinion of the speaking merc into the approach (`TacticalAI/NPC.cc:479`, `24`). ja2-node: `canMercBeHired`
(`relations/hiring-check.ts`) returns the quote and a refusal `hangover`, `hatesTeammate`, `deathRate` or `reputation`.

### 5.5 Other effects of relationships

| Effect | Rule | Source |
|---|---|---|
| Renewal | §3.5 | |
| Death of a teammate | hated → +5 only; else −5 tactical if in sector, −5 strategic, buddy (slots 0..2) −15 | `33`, `Morale.cc:529-563` |
| Buddy killed quotes | 15/16/17 | §4.9 |
| Training | instructor opinion bonus | `18` §5.8 |
| Attacking a buddy | an order from the UI to attack a merc in one's buddy slots is refused (quote 36) | `Tactical/Handle_Items.cc:243-250`; not ported (deviation "Attack refusals") |
| Cosmetic quotes | buddy did well 51/52/53 (`Tactical/SkillCheck.cc:385-420`, `Soldier_Ani.cc:2603-2681`); annoying teammate 39 when opinion < −2 (`Dialogue_Control.cc:785-800`); negative company 41/45 (`Handle_UI.cc:4710-4765`, the own-merc bark of `24`) | presentation; 39 and 51–53 are not emitted |

### 5.6 Personality, attitude and leadership

| Trait | Mechanical effect | Where |
|---|---|---|
| Leadership (effective) | best in the group shifts team opinion by `(lead − 50)/10` | §5.3 |
| Attitude OPTIMIST / AGGRESSIVE | +1 on positive morale events; OPTIMIST also +1 on negative | `33` |
| Attitude PESSIMIST / COWARD | −1 / −2 on negative events (PESSIMIST also −1 on positive); AGGRESSIVE doubles and COWARD skips the ran-away penalty | `33` |
| Attitude FRIENDLY, LONER, ARROGANT, BIG_SHOT, ASSHOLE | none (quotes, I.M.P. email) | `Soldier_Profile_Type.h:177-190` |
| Personality NERVOUS, CLAUSTROPHOBIC | quarter-hour morale events | `18` §5.12, `33` |
| Personality FORGETFUL, NERVOUS, PSYCHO / skill STEALTHY | unhired death chance +2 / −1 | §2.5 |
| `bSexist` | morale when a merc marries | `Morale.cc:565-602`, `25` §6.9 |
| `bReputationTolerance` | hiring (reputation) and the morale tolerance | §6.3 |
| `bDeathRate` | hiring, renewal, daily morale | §6.3 |

---

## 6. Reputation and death rate

### 6.1 Death rate (`Strategic/Strategic_Status.cc:112-126`)

`CalcDeathRate()` (`:114-126`) `= manDaysPlayed > 0 ? u8(u32(f32(mercDeaths) * 1.0f * 100 / manDaysPlayed)) : 0`, i.e.
`u8(trunc(deaths*100/manDays))`: the `u8` wraps above 255 (3 deaths in one man-day give 44); the float quotient never
rounds across an integer for realistic counts (inferred). Deaths: +1 per OUR death except EPCs and the robot
(`Strategic_Merc_Handler.cc:78-82`, §4.9). Man-days: +1 per daily update per team member not dead and not in transit
(`:263-269`, §2.1). The first daily update (Day 2) always sees 0 man-days and grants the low-death-rate bonus. ja2-node
rounds each float step with `Math.fround` (`calcDeathRate`, `relations/reputation.ts`).

### 6.2 Reputation (`ModifyPlayerReputation`, `:129-138`; amounts `Strategic_Status.h:18-32`)

`badReputation = clamp(badReputation − change, 0, 100)` (0 saint, 100 worst). Called from the end of `HandleMoraleEvent`
(`Morale.cc:611-660`), **once per call** whatever the number of mercs affected (even if nobody's morale changed), and from
§4.2:

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
MercThinksDeathRateTooHigh(p)     = p.bDeathRate != 101 && CalcDeathRate() > p.bDeathRate                   // Strategic_Status.cc:141-162
MercThinksBadReputationTooHigh(p) = p.bReputationTolerance != 101 && badReputation > p.bReputationTolerance // :165-186
MercThinksHisMoraleIsTooLow(s)    = p.bReputationTolerance != 101 && s.morale < (100 − p.bReputationTolerance)/2
```

Readers: death rate → hiring (§5.4), renewal (§3.5), daily morale (§2.4), insurance (§7); reputation → hiring only; morale
tolerance → renewal, daily morale, the departure hangover (§4.5).

---

## 7. Life insurance (contract coupling)

`21` §7.1–§7.2 own life insurance (premium `CalculateInsuranceContractCost`, `Laptop/Insurance_Contract.cc:709-775`, with
`Math.fround` per float step; purchase and extension `PurchaseOrExtendInsuranceForSoldier`, `:1082-1148`; the 00:00
`DailyUpdateOfInsuredMercs`, `:675-700`; payout and investigations, `:835-912`). The contract side touches it in three
places: an extension of an insured merc offers to extend the policy by the extension's length, priced with the new contract
end, after quote 90 (§3.6); the premium reads the death rate (§6.1); a death sets the suspicion and queues the payout
(§4.9). The policy never outlasts the contract (`TimeRemainingOnContract`, `:1059-1077`).

---

## 8. Determinism

### 8.1 RNG draws, in order

| Where | Draw | Stream |
|---|---|---|
| Daily update, per team member in team order | `Random(1080)` if he complains about equipment; `Chance((3 − d)·exp)` for another contract (A.I.M., gated, `d < 3`) | main |
| Daily update, per profile 0..199 | improvement: `Random(100)` (working) or `Random(10)` then, only if not below, `Random(100)`; `Random(11)` until not experience; the `ProcessStatChange` draws (`pre` per chance, `main` on gains, `33`); then `PreRandom(1000)` death roll if working elsewhere and eligible; then `Random(100)` and possibly `Random(6 + exp/2)` for a new job | main/pre |
| Two-hour warning | `Random(n)` over the willing mercs, if any | main |
| Dismissal within 3 h of arrival | `Random(4)` hangover | main |
| Leaving, equipment here | `RandomGridNo` pairs `Random(160)` (loaded sector without a gridno; unloaded sector without a GRIDNO insertion) | main |
| `StrategicRemoveMerc` | `Random(2)`; `Random(4)` if morale too low; `Random(6 + exp/2)` if signed elsewhere | main |
| M.E.R.C. level-up | `Random(60)` email delay | main |
| Insurance investigation | `Random(3)` (not very suspicious, `21` §7.2) | main |
| Hourly counters, team morale, renewal decisions, pay, refunds | none | — |

The arrival's equipment-complaint draw is `21` §9.1. The contract-ending and renewal draws happen at the player's answer, so
the `main` stream depends on the order of answers; prompts are part of the command log (`04` §5.5).

### 8.2 Wall-clock dependencies

The original plays quotes through the dialogue queue (audio length or 60 ms/char), and the contract menu, the departure box
and the update box wait for them (`CharacterDialogueEvent::MayExecute` also waits for a battle sound);
`HandleContractRenewalSequence` advances once per map screen frame; the update box beep and the contract-time flashing
(`fFlashContractFlag`) are UI. ja2-node opens the prompts at once and advances synchronously after each answer; quotes are
`mercQuote` events (deviations "Contract renewal sequence", "Contract presentation", "Speech"; `Random` shared with
cosmetic draws: "Random numbers").

---

## 9. Implementation in ja2-node

### 9.1 State and content

`MercRecord.contract` per merc, `StrategicState.contracts` (`ContractState`), `StrategicState.profiles`
(`ProfileProgress`), `state.status`, `state.teamMorale`, `state.laptop.merc.accountStatus` (§0). New-game profiles come
from `loadMercProfiles` (`src/sim/campaign/profiles.ts`; `mercKindForProfileType` maps the profile type to the soldier
kind, every other type hires as `AIM_MERC`). Native saves: `importContracts` (`contracts/save-import.ts`) reads sections 43
and 44 and the M.E.R.C. account status through `src/content/formats/savegame-contracts.ts`; the soldier contract fields
come with the soldier record and the profile fields with section 5 (`savegame-profile.ts`).

### 9.2 Modules

All under `src/sim/campaign/` with the SFI-SCLA header.

| Module | Responsibility |
|---|---|
| `contracts/contract-state.ts` | `MercContract`, `ContractState`, the constants of §0 |
| `contracts/contract-times.ts` | arrival slots, `hourWhenContractDone`, contract end at hire and arrival (`21` §2.5–§2.6), the two expiry predicates, the displays of §1.3 |
| `contracts/hire-contract.ts` | `hireContract`, `mercArrived`, the hated-arrives quotes (`21` §2.5–§2.6) |
| `contracts/daily.ts` | `mercDailyUpdate` (§2), equipment complaints, another contract, daily morale, unhired profiles |
| `contracts/renewal.ts` | warnings, `findRefusalReason`, `mercRenewalWillingness`/`willMercRenew`, precedent bits, sequence steps, `contractOptions` (§3.1–§3.5) |
| `contracts/extension.ts` | `mercContractHandling` (§3.6) |
| `contracts/salary.ts` | `calcNewSalary`, `roundOffSalary`, `raiseSalaries` (§3.7) |
| `contracts/departure.ts` | `beginRemoveMercFromContract`, `departureOptions`, equipment here/elsewhere, leave list and delivery, `strategicRemoveMerc`, medical refund (§4.2–§4.6) |
| `contracts/merc-account.ts` | the account part of `dailyUpdateOfMercSite` (`21` §3.5), `mercsContractIsFinished` (§4.7) |
| `contracts/rpc-pay.ts` | `rpcDailyPay`, `rpcWhineAboutNoPay` (§4.8) |
| `contracts/quotes.ts` | the contract quote ids, `precedentBitMask`, history codes, special profile ids |
| `contracts/contract-flow.ts` | `ContractFlow`: the `ContractContext`, event handlers, prompts and answers, commands, level-up and death hooks |
| `relations/relations.ts` | `whichBuddy`, `whichHated`, `getFirstBuddyOnTeam`, team membership predicates |
| `relations/reputation.ts` | `calcDeathRate`, `modifyPlayerReputation`, the three tolerances (§6) |
| `relations/hiring-check.ts` | `canMercBeHired` (§5.4, called by the A.I.M. site) |
| `team-morale.ts` | `updateBuddyAndHatedCounters` (§5.2), `hourlyMoraleUpdate` and the decays (§5.3) |
| `morale.ts` | `handleMoraleEvent` (reputation once per call), the low-morale quote flag |
| `merc-fate.ts` | death and capture (`19`), calling the §4.9 hooks |

### 9.3 Wiring

`ContractFlow.register` handles `MERC_DAILY_UPDATE`, `MERC_ABOUT_TO_LEAVE`, `BEGIN_CONTRACT_RENEWAL_SEQUENCE`,
`RPC_WHINE_ABOUT_PAY`, `MERC_COMPLAIN_EQUIPMENT`, `MERC_LEAVE_EQUIP_IN_DRASSEN/OMERTA` and `DAILY_UPDATE_OF_MERC_SITE`; the
hourly slots `updateBuddyAndHatedCounters` and `hourlyMoraleUpdate` run in the hourly update (`15` §3.2) through
`battle-flow.ts`. Endings are queued in `contracts.pendingEndings` (`departure`, `withoutEquipment`, `enterMapScreen`);
`ContractFlow.settle` runs them, then the renewal sequence, while no prompt is open and the flow is not autoresolve, as the
original's dialogue events run after the quotes. The prompts `contractRenewal`, `mercDeparture` and `insuranceExtension`
are battle-flow prompts (`battle.prompt`). `ContractHooks` (`contracts/context.ts`, no-op defaults for sandbox sessions)
connect the laptop (`laptop-flow.ts` `contractHooks()`: insurance cost, purchase and payout, the M.E.R.C. site update,
Larry's relapse, Speck's lost-merc flag, history, mails and personnel lists) and the narrative (`slayDailyEvent`,
`mercLeavingTeam`). Level-ups reach `ContractFlow` through `ExperienceHooks.levelGained`.

### 9.4 Data tables and stubs

Used directly (`data/externalized/`): `mercs-profile-info.json` (profile types: RPC salary, A.I.M./M.E.R.C. tests),
`mercs-relations.json` (§0), `mercs-MERC-listings.json` (listing order, `21` §3.2), `shipping-destinations.json` (primary
airport delivery sector, §4.4), `game.json` (`unhired_merc_deaths_*`, start sector), `items.json`/`weapons.json`/
`armours.json` (deadliness, protection, prices for §2.2), strings (UI only).

Transcribed (regenerate with `tools/transcribe/*.ts`, never edit): `data/tables/merc-quotes.json` (`merc-quotes.ts`: every
quote id with its enum name and the camelCase event key; aliases such as `MERC_QUIT_HATED1 = HATED_1_ARRIVES` name the
first entry with the number; `QUOTE_NONE = 0xFFFF`) and `data/tables/merc-contracts.json` (`merc-contracts.ts`:
`precedentQuotes` in bit order, `specialProfiles` BIFF, LARRY_NORMAL, LARRY_DRUNK, DEVIN, SLAY, IGGY, CONRAD from
`NPCIDs`, `historyCodes` by name). `quotes.ts` restates the ids it uses and is checked against both tables. Scalars
(arrival slots, warning offset, 3 unpaid days, M.E.R.C. thresholds 7/9/12, reputation amounts,
`TIME_BETWEEN_HATED_COMPLAINTS`, ±25, salary multiples and caps, leave gridnos 4868/10433, 20 leave slots, 6 h delay) are
named constants.

Stubs: `stubs/profiles.json` (`32` §1) carries invented A.I.M., M.E.R.C. and RPC profiles with the relationship cases (a
hated pair with a 6-hour tolerance, buddy pairs, learn-to-like and learn-to-hate targets with short times, an exact −25
opinion, `101` tolerances, a low death-rate tolerance, weekly < 7 × daily salaries, medical deposits).

### 9.5 Verification

The oracle probes `contracts`, `profiles`, `dailyupdate`, `relationshours`, `aboutleave`, `beginrenewal`, `renewalstep`,
`extend`, `beginremove`, `removemerc`, `leaveequip`, `equipleft`, `mercsite`, `levelup`, `salary` and the state setters
(`tools/oracle/README.md` "Contracts", `contract-compare.ts`) compare the contract state and the draws field by field on
the original's saves.

---

## 10. Quirks, limitations and open questions

**Quirks kept** (Strac; V where marked):
- Contract hour = arrival slot hour (7/13/19); renewal at :30, warning at :30 two hours earlier; extensions keep the hour.
- Expiry tests use the end day and the slot hour: an unresolved contract is asked again at the same slot every following
  day; POW days add a free day to the contract each midnight.
- The renewal list is cleared only when a sequence completes; entries pile up across slots and may repeat (capped at 20 and
  the stale-index pass after the last entry, `Merc_Contract.cc:122-131`, is not emulated: deviation "Renewal list").
- The sequence shows the menu to unwilling mercs; extensions then play the refusal and the departure prompt with a rehire
  button, which loops back to the menu.
- Buddies (slots 0..2, on the team even in transit, not dead) override every refusal except "signed elsewhere" (at hire:
  the hated merc, the death rate and the reputation); slot-0/1 hated time ≥ 24 is tolerated at hire; the precedent bit is
  `index − 1` with the first list entry and unknown quotes on bit 31.
- `lastContractUpdate` is the arrival time: early firing (< 3 h) and the 48-hour quote are measured from arrival, not from
  the last extension.
- Mercs below OKLIFE cannot be extended and say nothing, but can always be let go; Dismiss is refused while bleeding > 12
  or in combat in the sector.
- M.E.R.C. and RPC mercs who quit over money take their equipment; the drop-here path keeps the profile inventory, the
  airport path zeroes it; an empty-handed departure claims no leave slot.
- Iggy quitting unpaid skips the contract-ending event and so never becomes available to the army; dismissed while owed
  money, he does (§4.3).
- The medical refund comes from the paid deposit, rounded half up; the dead get a mail with the deposit as amount and no
  money.
- Dead mercs stay on the team until removed and keep feeding the daily update (days served, morale events, reputation,
  contract roll).
- `SoldierHasWorseEquipmentThanUsedTo` wraps in INT8 (top guns at high morale complain); the complaint window is
  06:00–23:59.
- Relationship counters tick only between squad members; team morale counts every awake teammate; counters and learned
  relations persist across rehires; snapping is postponed in a loaded sector with enemies.
- Strac `HourlyMoraleUpdate`: a slot-1/2 hated merc whose opinion is exactly −25 always forces −25 (V scales until half
  tolerance).
- Death rate wraps as a `u8`; Day 2 always gives the low-death-rate bonus; reputation changes once per morale event call.
- POOR/GREAT morale skip the subject when he is between sectors.
- `CheckIfMercGetsAnotherContract` draws only for fewer than 3 days left (V draws always).
- `DAILY_UPDATE_OF_MERC_SITE` runs before `MERC_DAILY_UPDATE`, so an account that turns invalid empties the same midnight.

**Inferred, still unverified**:
- The recorded relationship lines name the slot's merc (the `subject` of `mercQuote`).
- No native save holds an active renewal sequence (the pause lock blocks saving), so the transient flags are not imported.
- A moving merc's `sector` is the departure sector (`16`'s model) for the equipment drop and the sector tests.
- `CalcDeathRate`'s float quotient never rounds across an integer (§6.1).
