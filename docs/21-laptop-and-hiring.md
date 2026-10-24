<!-- The laptop as game logic, and hiring: an implementable spec for M5. 2026-10-16.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–20) and reference/stracciatella/assets/externalized,
cross-checked against vanilla (reference/vanilla/ja2/Build) where marked. Read-only research: nothing was built or run. -->

# 21 — The laptop and hiring: A.I.M., M.E.R.C., I.M.P., Bobby Ray's, email, history, finances, insurance

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless they start with `externalized/` (then
`reference/stracciatella/src/externalized/`); `V:` is vanilla `Build/`; JSON files are `assets/externalized/*.json`
(copied to `data/externalized/`). "(inferred)" marks conclusions not traced end to end; everything else was read in the
code. C integer semantics apply: `/` truncates toward zero (`idiv`), `UINT8`/`INT8`/`INT16`/`UINT16` stores wrap (`u8`,
`i8`, `i16`, `u16`). `Random` = `main` stream, `PreRandom` = `pre` stream (`01` §3.6); `Random(0)` returns 0 without
drawing; `Chance(x)` is `Random(100) < x`. Times are game minutes (`GetWorldTotalMin`) unless marked; "Day d hh:mm" is
minute `d·1440 + hh·60 + mm`; `midnight(n)` is `GetMidnightOfFutureDayInMinutes(n) = now + n·1440 − minutesInDay`
(`Strategic/Game_Clock.cc:150-153`). "Policy" values are Stracciatella defaults from `game.json`. Profile ids follow
`mercs-profile-info.json` (types `AIM` 0–39, `MERC` 40–50, `IMP` 51–56, RPC/NPC above); internal names such as `BIFF` or
`NAILS` are the ones the Stracciatella sources use. No profile statistics are quoted: they live in the user's `prof.dat`.

**Companions.** `22-contracts-and-relationships.md` (written in parallel) owns contract renewal and extension, the
07:30/13:30/19:30 renewal sequence, departures and the equipment question, firing, opinions, buddies and hated mercs
during service, quitting and `CheckIfMercGetsAnotherContract`; this spec owns what happens *at hire* and *after
departure on the laptop* (availability, refunds, re-hire). `23-merchants.md` (in parallel) owns arms dealers, repairs and
dealer prices; Bobby Ray's is here. `15-strategic-time.md` owns the clock, the event queue and `InitNewGame`/
`InitStrategicLayer`; `16-strategic-map-movement.md` owns squads, groups, `UpdateMercInSector` and airspace;
`18-militia-loyalty-mines-assignments.md` owns finances' first use (`§3.9`, `src/sim/campaign/finances.ts`), the hourly
update and `MercDailyUpdate`'s M4 part; `19-autoresolve-pbi.md` §3.8 owns merc death and capture; `14-savegames.md` the
save layout. The M5 parts of `MercDailyUpdate` (`docs/15` §3.4) are split: profile availability is §2.2 here, the RPC
salary and MERC departures are §3/`22`.

---

## 0. State this spec adds

**Campaign, laptop** (the original's `LaptopSaveInfo`, `Laptop/LaptopSave.h:84-143`, save section 4; ja2-node already
decodes its layout in `src/content/formats/savegame.ts` `LAPTOP_INFO_LAYOUT`):

| Group | Fields | Owner |
|---|---|---|
| Flow | `gfNewGameLaptop`, ja2-node's `flow = 'laptop'` (§1.3) | §1 |
| Money | `iCurrentBalance` + the finance ledger (exists: `state.finances`) | §6.3 |
| Personnel | `ubDeadCharactersList[256]`, `ubLeftCharactersList[256]`, `ubOtherCharactersList[256]` (INT16, −1 = empty) | §7.4 |
| M.E.R.C. | `gubPlayersMercAccountStatus`, `guiPlayersMercAccountNumber`, `gubLastMercIndex`, `ubLastMercAvailableId`, `uiTotalMoneyPaidToSpeck`, `fMercSiteHasGoneDownYet`, `fFirstVisitSinceServerWentDown` (0/1/2), `fNewMercsAvailableAtMercSite`, `ubPlayerBeenToMercSiteStatus`, `uiSpeckQuoteFlags`, `ubSpeckCanSayPlayersLostQuote`, `fSaidGenericOpeningInMercSite`, `fSpeckSaidFloMarriedCousinQuote`, `fHasAMercDiedAtMercSite` | §3 |
| I.M.P. | `fIMPCompletedFlag`, `fSentImpWarningAlready`, `iVoiceId`, the IMP slot states (save section 5, v104+) | §4 |
| Bobby Ray | `fBobbyRSiteCanBeAccessed`, `ubHaveBeenToBobbyRaysAtLeastOnceWhileUnderConstruction`, `BobbyRayInventory[]`, `BobbyRayUsedInventory[]`, the order/shipment list, `usInventoryListLength[2]` | §5 |
| Insurance | `pLifeInsurancePayouts[]` (`ubNumberLifeInsurancePayoutUsed`) | §7.1 |
| Florist | `uiFlowerOrderNumber` | §7.3 |
| Bookmarks | `iBookMarkList[20]` (−1 terminated): AIM (set on every laptop entry, `Laptop/Laptop.cc:519`), I.M.P. and M.E.R.C. (set by *opening* their mails, §6.1), Bobby Ray, funeral, florist, insurance (set on entering the site); I.M.P. and M.E.R.C. are reachable only through their bookmark, the others also through A.I.M.'s links | §1.4 |
| UI only (not simulated) | `fVisitedBookmarkAlready[]`, `iCurrentHistoryPage`, `iCurrentFinancesPage`, `iCurrentEmailPage`, `sLastHiredMerc` | — |

Plus the email list, the history log and the files list (save sections 8–10; temp files in the original) and the new
strategic event kinds of `docs/15` §2.7 marked M5, which get real handlers.

**Campaign, map**: `mercArriveSector` (`g_merc_arrive_sector`, `Tactical/Merc_Hiring.cc:46`; saved in general info,
`SaveLoadGame.cc:1923-1924`, defaulting to the start sector on load, `:2081`), §2.6.

**Strategic status** (exists in `StrategicState.status`): `badReputation` (`ubBadReputation`), `manDaysPlayed`,
`mercDeaths`, `unhiredMercDeaths`, `insuranceInvestigations`; this spec reads and writes them.

**Profile, campaign-mutable** (the original writes these into `gMercProfiles`, save section 5; ja2-node keeps them in
`StrategicState.profiles`, extending `ProfileProgress`): `mercStatus` (`bMercStatus`, INT8, §2.1), `dayBecomesAvailable`
(`uiDayBecomesAvailable`, a day *countdown*, not a date), `daysOfMoraleHangover` (`ubDaysOfMoraleHangover`), `miscFlags`
(`ubMiscFlags`: `ALREADY_USED_ITEMS 0x80`), `miscFlags3` (`ubMiscFlags3`: `PLAYER_LEFT_MSG_FOR_MERC_AT_AIM 0x01`,
`PLAYER_HAD_CHANCE_TO_HIRE 0x04`, `MERC_MERC_IS_DEAD_AND_QUOTE_SAID 0x20`), `precedentQuoteSaid`, `salary`
(`sSalary` INT16), `weeklySalary`, `biWeeklySalary` (UINT32), `medicalDeposit` (`bMedicalDeposit`, flag from data),
`medicalDepositAmount` (`sMedicalDepositAmount` UINT16, computed, §2.4), `optionalGearCost` (`usOptionalGearCost` UINT16,
computed, zeroed after the kit is bought), `totalCostToDate` (exists as `finances.profileCostToDate`), `totalDaysServed`,
`mercMercContractLength` (`iMercMercContractLength`, §3), `suspiciousDeath` (`ubSuspiciousDeath`, §7.1), `balance`
(`iBalance`, RPC pay, `22`). Read-only from `prof.dat` and still missing in `src/content/formats/prof.ts`: `bDeathRate`,
`bReputationTolerance`, `bHatedTime[2]`, `bLearnToHate*`/`bLearnToLike*`, `bMedicalDeposit`, `sSalary`,
`uiWeeklySalary`, `uiBiWeeklySalary`, `bMercStatus`, `uiDayBecomesAvailable`, `ubMiscFlags`, `ubMiscFlags3`
(offsets: `Tactical/LoadSaveMercProfile.cc:36-212`).

**Soldier (OUR team), hire and contract fields** (all in the soldier record, save section 6; already decoded by
`savegame-soldier.ts`): `kind` (`ubWhatKindOfMercAmI`, exists), `totalContractLength` (`iTotalContractLength`),
`endOfContractTime` (`iEndofContractTime`, minutes), `startContractTime` (`iStartContractTime`, a day, MERC only),
`typeOfLastContract` (`bTypeOfLastContract`), `timeCanSignElsewhere` (`iTimeCanSignElsewhere`), `medicalDeposit`
(`usMedicalDeposit`, what was *paid*), `timeSoldierWillArrive` (`uiTimeSoldierWillArrive`), `useLandingZoneForArrival`
(`fUseLandingZoneForArrival`), `timeOfLastContractUpdate` (`uiTimeOfLastContractUpdate`), `leaveHistoryCode`
(`ubLeaveHistoryCode`), the insurance fields `lifeInsurance` (`usLifeInsurance`), `startOfInsuranceContract`
(`iStartOfInsuranceContract`, a day), `totalLengthOfInsuranceContract`, `startTimeOfInsuranceContract`
(`uiStartTimeOfInsuranceContract`, minutes), and `contractPriceHasIncreased`, `signedAnotherContract` (`22`).

---

## 1. The laptop as a simulation

### 1.1 Time

- Entering the laptop calls `PauseGame()` "because we dont want time to advance in the laptop" (`Laptop/Laptop.cc:461-462`);
  leaving calls `UnPauseGame()` (`:627-628`). Independently, the world clock only runs on `GAME_SCREEN` and `MAP_SCREEN`
  (`docs/15` §1.5), so **nothing in the laptop takes game time**: hiring, ordering, the I.M.P. questionnaire and reading
  mail all happen at one world minute.
- Opening the laptop from the map screen **stops time compression** (`HandleExitsFromMapScreen`,
  `Strategic/Map_Screen_Interface_Bottom.cc:1091-1121`), and leaving it always returns to the map screen
  (`LeaveLapTopScreen`, `Laptop/Laptop.cc:1349`), where compression stays stopped until the player restarts it.
- Wall-clock-only presentation: the website loading delays (`website_loading_time_scale`, `game.json:184-186`), the
  A.I.M. video conference (snow, title bar, talking face), the laptop power-down animation (`Laptop.cc:1368-1433`),
  Speck's video intro and idle chatter. The A.I.M. "impatience" timer is also wall clock but has a logic effect (§2.2,
  deviation).

### 1.2 When the laptop is available

The laptop is reached only from the map screen (the bottom-panel button or `l`, `Strategic/MapScreen.cc:2847`,
`Map_Screen_Interface_Bottom.cc:272, 299`); tactical goes through the map screen first. `AllowedToExitFromMapscreenTo(
MAP_EXIT_TO_LAPTOP)` (`Map_Screen_Interface_Bottom.cc:987-1070`) refuses while: already leaving the map screen; another
exit is pending; the dialogue queue is not empty; a meanwhile is trying to start; the pause state is locked (message
boxes, contract renewal/ending, PBI, simultaneous arrival, conversations, `docs/15` §1.5); an inventory item is held; the
assignment update box, town info or the militia popup is shown; the contract renewal sequence is on; a battle is about to
start (`fDisableDueToBattleRoster`, `fDisableMapInterfaceDueToBattle`, i.e. the PBI is pending or open); the sector
inventory is open. There is no money, combat or "enemies in sector" test: the laptop is usable during a tactical battle
once the player is on the map screen (inferred: the map screen itself is reachable in combat).

At a new game the laptop is the first screen (`InitNewGame` sets the pending screen to `LAPTOP_SCREEN`,
`Strategic/Game_Init.cc:266-267`), and `LeaveLapTopScreen` overrides the `INIT_SCREEN` exit with the map screen (`docs/15`
§4.1).

### 1.3 ja2-node: the laptop is a flow

`StrategicState.flow` gains `'laptop'`. It behaves like the original's laptop screen: the world clock does not run, the
loaded sector is frozen, `advance` is refused with reason `laptop` (the agent must close it).

- `openLaptop` (from `strategic`): refused while a decision prompt is open, during autoresolve, or while the pre-battle
  interface is pending (the state-based conditions of §1.2 that exist in ja2-node; the dialogue queue is the speech
  channel, which in ja2-node never blocks commands). Effect: `stopTimeCompression` (reason `requested`), `flow =
  'laptop'`.
- Every laptop command (§10) requires `flow === 'laptop'`.
- `closeLaptop` runs, in order, `HandleExit` and `LeaveLapTopScreen` (`Laptop.cc:1439-1454, 1345-1366`):
  1. if `gfNewGameLaptop` and `CanCreateAnotherIMPCharacter()` (§4.1) and `!fSentImpWarningAlready`:
     `AddFutureDayStrategicEvent(HAVENT_MADE_IMP_CHARACTER_EMAIL, (8 + Random(4))·60, 0, 1)` (tomorrow 08:00–11:00; one
     `Random(4)` per such exit; the original posts it again on every exit until the flag below clears, and the handler
     ignores duplicates once the mail went out, §6.1);
  2. if `atLeastOneMercHired` and `gfNewGameLaptop`: `gfNewGameLaptop = false` (the original returns once more and
     leaves on the next frame; no state difference);
  3. `newMail = false` (`fNewMailFlag`, cleared in `ExitLaptop`, `Laptop.cc:605-609`);
  4. `flow = 'strategic'`.
- `visitSite {site}` (M8) runs what entering a site's page does in the original (`EnterBobbyR`, `EnterMercs`,
  `EnterFuneral`, `EnterFlorist`, `EnterInsurance`): `bobbyRay` sets its bookmark and, while the site is under
  construction, `ubHaveBeenToBobbyRaysAtLeastOnceWhileUnderConstruction = BEEN_TO_SITE_ONCE` (the gate of the
  `BOBBYR_NOW_OPEN` mail, §5.1); `funeral`, `florist` and `insurance` set their bookmarks; `merc` (refused with `noBookmark`
  without its bookmark and `siteDown` during the outage, when the browser shows the broken link) increments
  `ubPlayerBeenToMercSiteStatus` on every visit and runs Speck's opening (§3.6) the first time in a laptop session. No time
  passes; the page that is shown is client state.
- A new campaign starts with `flow = 'laptop'` after `initNewGame` (§8).

Entry side effects in the original: the A.I.M. bookmark (`Laptop.cc:519`; `openLaptop` sets it too); the rest is UI state:
bookmark visit flags (`Laptop.cc:494-495`), the "just hired" popup
reset (`Laptop/AIMMembers.cc:396-415`, shown by `DisplayPopUpBoxExplainingMercArrivalLocationAndTime`, `:2882-2919`),
music, ambients, the rain sound.

### 1.4 Logic versus presentation, per program and site

| Program / site | Game logic (port) | Presentation only |
|---|---|---|
| Email | receiving mails (callers everywhere, §6.1), opening a mail with a special effect (bookmarks), deleting | layout, pages, new-mail blinking |
| Files | the file list (added by mails and events, §6.4) | the file viewer |
| History | the log (§6.2) | pages |
| Finances | balance and ledger (§6.3) | the daily/total summaries are computed from the ledger |
| Personnel | the departed lists (§7.4) | stats display |
| A.I.M. members | contact, refusals, hiring, leaving a message (§2) | video conference, attitude quotes, sorting (`AIMSort.cc`), facial index, archives, history, policies, links |
| M.E.R.C. | account, hiring, payment, unlocks, outage (§3) | Speck's video and quotes except the few with side effects (§3.6) |
| I.M.P. | questionnaire → profile, payment, hiring (§4) | page sequence, text, portraits as images |
| Bobby Ray's | inventory, restock, orders, shipping, delivery (§5) | page filters, item descriptions |
| Insurance | contracts, premiums, payouts, investigations (§7.1) | info and comments pages |
| Florist | flower orders (cost; effects in §7.3) | gallery, cards |
| Funeral | none (§7.3) | text pages |
| Broken link | the M.E.R.C. outage redirect (§3.1) | the page |

Reachability is state: A.I.M. is bookmarked on every laptop entry and links to Bobby Ray's, the funeral home and the
insurance site (`AIMLinks.cc:39`; the rotating A.I.M. ads also link to the florist, `AIM.cc:765-777`); I.M.P. needs its
bookmark, set by opening `IMP_EMAIL_INTRO` or `IMP_EMAIL_AGAIN`; M.E.R.C. needs its bookmark, set by opening `MERC_INTRO` or
`MERC_NEW_SITE_ADDRESS` (`EMail.cc:1641-1720`). A deleted unread intro mail therefore locks its site (inferred edge case,
kept). ja2-node commands for I.M.P. and M.E.R.C. are refused with `noBookmark` until the bookmark exists.

---

## 2. A.I.M.

### 2.1 Profile status

`bMercStatus` (INT8, `Tactical/Soldier_Profile_Type.h:53-78`) is either a non-negative number or a negative state:

| Value | Name | Meaning, writers |
|---|---|---|
| > 0 | — | on the team: the contract length in days (`HireMerc` `Tactical/Merc_Hiring.cc:115`, `MercArrivesCallback` `:315`) |
| 0 | `MERC_OK` | at home and hireable (if `uiDayBecomesAvailable == 0`) |
| −1 | `MERC_HAS_NO_TEXT_FILE` | `InitProfileFromContent` when the content has no dialogue for the profile (`Soldier_Profile.cc:144`); overwritten to `MERC_OK` for every AIM/MERC profile by `StartSomeMercsOnAssignment` (`:485-513`) |
| −2 | `MERC_ANNOYED_BUT_CAN_STILL_CONTACT` | first hang-up from impatience (`AIMMembers.cc:2226-2227`) |
| −3 | `MERC_ANNOYED_WONT_CONTACT` | second hang-up (`:2228-2229`) |
| −4 | `MERC_HIRED_BUT_NOT_ARRIVED_YET` | hired with a future arrival (`Merc_Hiring.cc:156-161`) |
| −5 | `MERC_IS_DEAD` | killed on the team (`Strategic_Merc_Handler.cc:92`) or on another job (`Campaign.cc:1160`) |
| −6 | `MERC_RETURNING_HOME` | left the team alive (`Merc_Contract.cc:664`) |
| −7 | `MERC_WORKING_ELSEWHERE` | away on another job (`Soldier_Profile.cc:501`, `Strategic_Merc_Handler.cc:358`, `Merc_Contract.cc:470`) |
| −8 | `MERC_FIRED_AS_A_POW` | left the team while a POW (`Merc_Contract.cc:683`); the countdown never resets it (`Strategic_Merc_Handler.cc:315-316`), but once the countdown is 0 the daily away roll of §2.2 can still turn it into `WORKING_ELSEWHERE`, after which it becomes `MERC_OK` (quirk) |

`IsMercHireable(p)` (`Merc_Hiring.cc:351-364`) = `status ≤ 0` and status ∉ {−1, −4, −5, −6, −7, −8} and
`uiDayBecomesAvailable == 0`. So −2 is hireable; −3 passes this test but is refused first by `WillMercAcceptCall` (§2.3)
and by `HireMerc`'s status gate; a returning or away merc is hireable only once the countdown is 0 **and** the status was
reset.

### 2.2 Availability over time

**New game** (`LoadMercProfiles` → `StartSomeMercsOnAssignment`, `Soldier_Profile.cc:485-513`; `docs/15` §4.6 step 2): for
each AIM or MERC profile in content order (`GCM->listMercProfiles()`, id order):
```
if Random(100) < 5·expLevel:  status = WORKING_ELSEWHERE; dayBecomesAvailable = 1 + Random(6 + expLevel/2)
else:                         status = MERC_OK;           dayBecomesAvailable = 0
precedentQuoteSaid = 0; daysOfMoraleHangover = 0
```

**Daily, 00:00 `MERC_DAILY_UPDATE`** (`Strategic_Merc_Handler.cc:286-366`, after the team loop of `docs/15` §3.4 and the
M.E.R.C. departures of §3.5; skipped entirely on Day 1): for every profile 0..199 in id order:
```
if status == IS_DEAD: continue
precedentQuoteSaid = 0
if IsMercOnTeam(id): continue                                  // any OUR soldier with this profile, also in transit/dead-not-removed
if AIM-or-MERC(id) and status != RETURNING_HOME:
  HandleUnhiredMercImprovement(p)                              // below
  if status == WORKING_ELSEWHERE: HandleUnhiredMercDeaths(id)  // below
if dayBecomesAvailable > 0:
  if --dayBecomesAvailable == 0 and status != FIRED_AS_A_POW:
    status = MERC_OK                                           // also from RETURNING_HOME and WORKING_ELSEWHERE
    if miscFlags3 & PLAYER_LEFT_MSG: clear it; AddEmail(AIM_REPLY_BARRY + id·AIM_REPLY_LENGTH_BARRY, AIM_REPLY_LENGTH_BARRY, 6 + id, now)
else if AIM-or-MERC(id):
  if id < 40: chance = 2·expLevel; miscFlags3 |= PLAYER_HAD_CHANCE_TO_HIRE
  else:       chance = 1·expLevel; if day > DAYS_TIL_M_E_R_C_AVAIL (3): miscFlags3 |= PLAYER_HAD_CHANCE_TO_HIRE
  if Random(100) < chance: status = WORKING_ELSEWHERE; dayBecomesAvailable = 1 + Random(6 + expLevel/2)
if daysOfMoraleHangover > 0: daysOfMoraleHangover--
```
Notes: the "go away" roll is made only on days that started with the countdown at 0, so a merc who came back today
cannot leave again before tomorrow; it is rolled for available *and* annoyed (−2/−3) mercs; the AIM/MERC split for the
chance is `id < MAX_NUMBER_MERCS (40)` (`Laptop/AIM.h:6`), not the profile type; the reply mail's sender is `6 + id`.

`HandleUnhiredMercImprovement(p)` (`Tactical/Campaign.cc:1041-1094`):
```
if status == WORKING_ELSEWHERE:
  if Random(100) < 20: return
  for stat in FIRST..LAST_CHANGEABLE_STAT: ProfileStatChange(p, stat, wisdom/10, FROM_SUCCESS)   // PreRandom per chance (11 §10)
else:
  if (INT8)Random(10) < expLevel || (INT8)Random(100) > wisdom: return     // short-circuit: second draw only if first fails
  do stat = FIRST_CHANGEABLE_STAT + Random(n) while stat == EXPERAMT
  ProfileStatChange(p, stat, wisdom/2, FROM_TRAINING)
ProfileUpdateStats(p)                                          // level-ups raise salaries (§2.4)
```
`HandleUnhiredMercDeaths(id)` (`Campaign.cc:1098-1173`): nothing unless `PLAYER_HAD_CHANCE_TO_HIRE`; nothing once
`unhiredMercDeaths ≥ unhired_merc_deaths_<difficulty>` (policy 1/2/3, `game.json:254-256`); `chance = 10 − expLevel`,
+2 for `FORGETFUL`/`NERVOUS`/`PSYCHO`, −1 per `STEALTHY` skill slot; `if (INT16)PreRandom(1000) < chance`: status
`IS_DEAD`, countdown 0, `unhiredMercDeaths++`, and for AIM profiles the mail `MERC_DIED_ON_OTHER_ASSIGNMENT` with the
profile as special data (`AIM_SITE` sender).

**Departure** (`StrategicRemoveMerc`, `Strategic/Merc_Contract.cc:613-708`; the full departure flow is `22`): if the profile
is not dead: `status = RETURNING_HOME`, `dayBecomesAvailable = 1 + Random(2)`; then `HandleSoldierLeavingWithLowMorale`
(`MercThinksHisMoraleIsTooLow` → `daysOfMoraleHangover = 3 + Random(4)`, `:454-462`) and
`HandleSoldierLeavingForAnotherContract` (if `fSignedAnotherContract`: `status = WORKING_ELSEWHERE`,
`dayBecomesAvailable += 1 + Random(6 + expLevel/2)`, `:465-472`); a POW leaving gets `FIRED_AS_A_POW` after that; others
get the medical deposit refund (§2.7).

**Annoyance** (`HandleMercAttitude`, `AIMMembers.cc:2188-2249`): while the video conference waits for the player, the merc
escalates every 3 s (first step) / 10 s of *wall clock* (`GetJA2Clock`); at the hang-up step `0 → −2`, `−2 → −3` and
`EVENT_AIM_RESET_MERC_ANNOYANCE` is posted at `now + 360 + Random(600)`; its handler (`ResetMercAnnoyanceAtPlayer`,
`:2708-2724`, with the Larry profile swap) sets −2/−3 back to 0. ja2-node has no idle wall clock in a command API:
annoyance never happens (deviation, §15); the event and the statuses are still supported for imported saves.

### 2.3 Contacting and refusals

Contact (`WillMercAcceptCall`, `AIMMembers.cc:1754-1766`): status −3 → "unavailable" (lame refusal, hang-up, no state
change); `IsMercHireable` → first contact; otherwise the answering machine. On the answering machine the player may
leave a message (`BtnAnsweringMachineButtonCallback`, `:1578-1605`): `miscFlags3 |= PLAYER_LEFT_MSG_FOR_MERC_AT_AIM`,
which produces the "back from assignment" mail of §2.2. The face overlay (`DisplayMercsFace`, `:955-1015`) tells the
player which case applies: dead; POW (`FIRED_AS_A_POW` or on the team as `ASSIGNMENT_POW`); already hired (on the team);
"on assignment" (any other non-hireable state); nothing.

Asking to hire (`CanMercBeHired`, `AIMMembers.cc:1769-1863`, evaluated when the player presses "hire" in first contact, not
again at payment), in order:
1. `daysOfMoraleHangover > 0` → refuse (`QUOTE_LAME_REFUSAL`) — "buddy or no buddy".
2. `buddy = GetFirstBuddyOnTeam(p)` (`Soldier_Profile.cc:878-889`): the first of `bBuddy[0..2]` (two buddies, then the
   learned-to-like slot) that is on the team (`IsMercOnTeam`, in transit included) and not dead.
3. For `i` in hated slots 0, 1, 2 (`bHated[0..2]`, slot 2 = learned to hate) with `bHated[i] ≥ 0` and that merc on the
   team, arrived and alive (`IsMercOnTeamAndInOmertaAlreadyAndAlive`, `Tactical/Soldier_Add.cc:991-995`):
   - a buddy on the team → accept now (joining-because-of-buddy quote; skips everything below);
   - slot 0/1 with `bHatedTime[i] ≥ 24` → remember a "personality bias" quote and **continue** (tolerated);
   - otherwise refuse (`QUOTE_HATE_MERC_1/2_ON_TEAM`, `QUOTE_LEARNED_TO_HATE_MERC_ON_TEAM`).
4. A buddy on the team → accept (skips 5 and 6).
5. `MercThinksDeathRateTooHigh(p)` (`Strategic/Strategic_Status.cc:141-162`): unless `bDeathRate == 101`,
   `CalcDeathRate() > bDeathRate` → refuse. `CalcDeathRate()` (`:114-126`) = 0 while `manDaysPlayed == 0`, else
   `(UINT8)(UINT32)(mercDeaths · 1.0f · 100 / manDaysPlayed)`, i.e. `u8(idiv(mercDeaths·100, manDaysPlayed))` (the float
   quotient never rounds across an integer for realistic counts; inferred) — **wrapping at 256**.
6. `MercThinksBadReputationTooHigh(p)` (`:165-186`): unless `bReputationTolerance == 101`, `badReputation >
   bReputationTolerance` → refuse.
7. Accept (with the bias quote if one was remembered).

`mercDeaths` counts our dead mercs except EPCs and the robot (`Strategic_Merc_Handler.cc:78-82`); `manDaysPlayed` grows
by one per non-dead, non-transit team member at each `MercDailyUpdate` (`:263-269`); `badReputation` (0 saint … 100) moves
with `ModifyPlayerReputation` (`Strategic_Status.cc:129-138`), driven by morale events (`11` §9).

### 2.4 Prices

Shown on the member page and charged at hire (`DisplayMercChargeAmount`, `AIMMembers.cc:1370-1414`, recomputed only while
the merc is not on the team):
```
amount = {1 day: sSalary, 1 week: uiWeeklySalary, 2 weeks: uiBiWeeklySalary}[contract]
if bMedicalDeposit: amount += sMedicalDepositAmount
if gear:            amount += usOptionalGearCost
```
The video conference opens with **1 week** selected and the kit selected iff `usOptionalGearCost != 0` (`:2379-2381`);
the kit button is disabled when the cost is 0 (`:2456-2459`).

- **Medical deposit** (`CalcMedicalDeposit`, `Soldier_Profile.cc:560-568`, computed once per new game by
  `InitProfileFromContent :146`; the `prof.dat` value is overwritten): `bMedicalDeposit ? (5·competence + 50) / 100 · 100 :
  0` (UINT16). `CalcCompetence(p)` (`:527-557`) uses doubles:
  ```
  stats  = (2·lifeMax + str + agi + dex + (ldr + wis)/2) / 3                      // integer
  skills = (UINT32)(2·mkm³/10000 + 1.5·med³/10000 + mech³/10000 + expl³/10000)   // double, truncated
  aps    = 5 + (10·exp + 3·agi + 2·lifeMax + 2·dex + 20) / 40                    // integer
  n      = (skillTrait != 0) + (skillTrait2 != 0)
  competence = (UINT16)(pow(exp, 0.2) · stats · skills · (aps − 6) · (1 + 0.05·n) / 1000)
  ```
  ja2-node: `x³/10000` terms are exact in doubles; `pow(exp, 0.2)` for `exp` 0..10 becomes an 11-entry table of the
  correctly rounded doubles (`04` §5.6 forbids `Math.pow` in `core`/`sim`); evaluate left to right in doubles exactly as
  written (`0.05` is a double literal; `uiActionPoints − 6` is UINT32 arithmetic), then truncate to UINT16.
- **Kit cost** (`InitProfileFromContent`, `Soldier_Profile.cc:187-206`): after the non-gun-nut gun replacement
  (`:161-185`), `usOptionalGearCost = Σ getPrice()` over the profile's inventory slots (one price per slot, **not**
  multiplied by `bInvNumber`; UINT16 sum). Buying the kit copies the profile items to the soldier and sets `usOptionalGearCost = 0`
  (`Tactical/Soldier_Create.cc:2045-2059`), so a re-hire offers no kit.
- **Salary growth**: every experience level gained raises `sSalary`, `uiWeeklySalary`, `uiBiWeeklySalary` and
  `sMedicalDepositAmount` once (`Campaign.cc:668-741`): for AIM mercs on the team (and `fContractPriceHasIncreased`), MERC
  mercs on the team, and any AIM/MERC merc off the team (unhired improvement); RPCs never. `CalcNewSalary(old, up, max)`
  (`:930-961`): 0 stays 0; `(UINT32)(old · 1.25)` = `idiv(old·5, 4)`; `RoundOffSalary` to a multiple of 5/10/25/50/100/
  500/1000/2000/5000 for ≤250/500/1000/2000/5000/10000/25000/50000/above, rounding half up (`:964-999`); cap `MAX_DAILY_SALARY
  30000` (daily and deposit) or `MAX_LARGE_SALARY 500000`; floor 5. The soldier's paid `usMedicalDeposit` is not raised.

### 2.5 Hiring (`AimMemberHireMerc` + `HireMerc`)

The player picks a contract (1/7/14 days) and the kit, then authorizes (`BtnAuthorizeButtonCallback`, `AIMMembers.cc:1118-
1167`). `AimMemberHireMerc` (`:1170-1255`) and `HireMerc` (`Tactical/Merc_Hiring.cc:62-218`), merged in execution order:

```
if balance < amount: refuse "not enough funds"                      // §2.4 amount; checked before everything else here
HireMerc(h = {profile, sector: mercArriveSector, useLandingZone: true, insertion: ARRIVING_GAME,
              copyItems: gear, arrival: GetMercArrivalTimeOfDay(), kind: AIM, length: 1|7|14}):
  if status ∉ {0, −2, −4}: fail (silently)
  if NumberOfMercsOnPlayerTeam() >= 18: refuse "too many mercs"     // active OUR soldiers except vehicles (Overhead.cc:4805-4813)
  h.sector = mercArriveSector                                        // landing zone
  s = TacticalCreateSoldier({profile, sector, OUR_TEAM, copyItems})  // kit copied (and gear cost zeroed) or empty inventory
  if didGameJustStart: (s.id == 0 → CreateSpecialItem(LETTER), into SMALLPOCK8 if no room); h.insertion = CHOPPER
  p.status = length
  s.insertionCode, s.insertionData = h.insertion, h.data; s.useLandingZone = true
  if s.assignment != IN_TRANSIT: SetTimeOfAssignmentChangeForMerc(s); ChangeSoldiersAssignment(s, IN_TRANSIT)
  s.totalContractLength = length; insurance fields = 0
  s.timeSoldierWillArrive = h.arrival                                // set BEFORE the next line (quirk, §2.6)
  if didGameJustStart: h.arrival = (STARTING_TIME + FIRST_ARRIVAL_DELAY)/60 (Day 1 07:00)
                       s.endOfContract = midnight(length) + hour(timeSoldierWillArrive)·60
  else:                s.endOfContract = midnight(1 + length) + hour(timeSoldierWillArrive)·60
  lastHiredMerc = {profile, h.arrival}                               // popup only
  if h.arrival != 0: AddStrategicEvent(DELAYED_HIRING_OF_MERC, h.arrival, s.id); p.status = HIRED_BUT_NOT_ARRIVED_YET
  s.kind = AIM; s.typeOfLastContract = {1: EXTEND_1_DAY, 7: EXTEND_1_WEEK, 14: EXTEND_2_WEEK}
  s.timeCanSignElsewhere = (length == 14) ? s.endOfContract : now
  s.medicalDeposit = p.sMedicalDepositAmount                          // what was paid; the profile value can grow later
  RemoveNewlyHiredMercFromPersonnelDepartedList(profile)              // §7.4
  atLeastOneMercHired = true
if !gear && profile == NAILS: s.inv[VESTPOS] = LEATHER_JACKET (status 100)   // Strac addition
if gear: p.miscFlags |= ALREADY_USED_ITEMS                            // V sets it before HireMerc, even on failure
AddTransactionToPlayersBook(HIRED_MERC, profile, now, −amount + p.sMedicalDepositAmount)
if p.bMedicalDeposit: AddTransactionToPlayersBook(MEDICAL_DEPOSIT, profile, now, −p.sMedicalDepositAmount)
AddHistoryToPlayersLog(HISTORY_HIRED_MERC_FROM_AIM, profile, now, (−1, −1))
```
- Money leaves the balance **at hire**, in two ledger records (`HIRED_MERC` = salary + kit, which also counts toward
  `uiTotalCostToDate`, `Laptop/Finances.cc:173-182`; `MEDICAL_DEPOSIT`). The `+ sMedicalDepositAmount` in the first record
  is unconditional, but the amount is 0 when `bMedicalDeposit` is 0, so the sum always equals `amount`.
- Order of refusals for the whole flow: contact (§2.3 `WillMercAcceptCall`), `CanMercBeHired`, funds, status, team size.
  "Already hired" is caught at contact (answering machine).
- `TacticalCreateSoldier` draws for an OUR soldier with a profile are those of `createMercFromProfile` (`06`); ja2-node's
  `createMercFromProfile` always copies the profile inventory today (`hiredMercInventory`) and needs a `copyProfileItems`
  flag.

### 2.6 Arrival time and place

`GetMercArrivalTimeOfDay()` (`Merc_Hiring.cc:424-459`, `MIN_FLIGHT_PREP_TIME 6`, slots `Merc_Hiring.h:14-16`):

| Current hour `h` | Arrival |
|---|---|
| `h > 13` | tomorrow 07:30 |
| `h + 6 ≤ 7` (00:00–01:59) | today 07:30 |
| `h + 6 ≤ 13` (02:00–07:59) | today 13:30 |
| otherwise (08:00–13:59) | today 19:30 |

- **First squad**: hired at Day 1 01:00 → `timeSoldierWillArrive` = Day 1 **07:30** (what the map screen shows,
  `MapScreen.cc:804`, and what fixes the contract-end hour at 07), but the arrival event is at Day 1 **07:00**, reached by
  the six-hour warp of `docs/15` §4.5. Same in V (`V:Tactical/MercHiring.c:171-201`). Keep.
- **Contract end**: hour of `timeSoldierWillArrive` on the day `midnight(n)`; recomputed at arrival from the arrival day
  (`MercArrivesCallback`, `:321`), so a merc hired at 02:00 for 7 days and arriving 13:30 the same day ends at Day+7 13:00,
  30 minutes short of seven full days; the renewal machinery around it is `22`.
- **Landing zone** (`g_merc_arrive_sector`): the start sector after `SetupNewStrategicGame` (`StrategicMap.cc:2265`). The
  player moves the "bullseye" on the map screen (airspace view) only after the first landing (`CanMoveBullseyeAndClickedOnIt`,
  `MapScreen.cc:7521-7540`) to any surface sector whose strategic-move traversability is not `GROUNDBARRIER` and that is
  not enemy air controlled (`:2391-2425`); every in-transit merc with `useLandingZone` follows
  (`UpdateAnyInTransitMercsWithGlobalArrivalSector`, `Merc_Hiring.cc:462-471`). No airport is needed (the airport matters for
  Bobby Ray, §5). When an airspace update makes the landing zone enemy air controlled, it snaps back to the start sector
  with a message box (`HandleAirspaceControlUpdated`, `StrategicMap.cc:2295-2320`, registered on
  `OnAirspaceControlUpdated`).
- **`MercArrivesCallback(s)`** (`Merc_Hiring.cc:224-348`; ja2-node's `mercArrives` does steps 3, 4 and 6 only):
  1. if `!didGameJustStart` and the landing zone is the start sector and the loaded sector is not the start sector:
     `EliminateAllEnemies(start sector)` (`19` §2.19) — the start sector is "always safe";
  2. `CheckForValidArrivalSector()` (`:487-553`): if the landing zone is enemy controlled, scan `dy = −4..4` (outer), `dx =
     −4..4` (inner) over strategic indices `idx = zone + 18·dy + dx` with `1 ≤ idx < 289` and on the same row; candidates
     not enemy controlled and not enemy air controlled; distance `(INT16)hypot(dx, dy)` (truncated); keep the first
     strictly smaller distance; if found, move the zone by `(dx, dy)`, update in-transit mercs and show the "arrival
     rerouted" box. The `< 289` bound excludes row P (`y = 16` gives `idx ≥ 289`) (quirk);
  3. `StopTimeCompression()`;
  4. `AddCharacterToAnySquad(s)`;
  5. `if useLandingZone: s.sector = mercArriveSector`;
  6. if the sector is loaded: a non-chopper arrival into the loaded *start* sector becomes a helicopter run
     (`gfTacticalDoHeliRun`, insertion `CHOPPER`, and the map screen requests tactical); then `UpdateMercInSector`
     (`docs/16` §5.6: `ARRIVING_GAME` walks in from the north, or from gridno 4379 in the start sector); else insertion
     `NORTH`;
  7. non-chopper arrivals: "has arrived" message and arrival quote (presentation);
  8. `p.status = s.totalContractLength`; `s.timeOfLastContractUpdate = now`; `s.endOfContract = midnight(length) +
     hour(timeSoldierWillArrive)·60`;
  9. if `SoldierHasWorseEquipmentThanUsedTo(s)` (`Strategic_Merc_Handler.cc:434-488`: best gun deadliness / armour
     protection scaled by `(50 + morale)/100` below half of the profile's attractiveness): `t = 540 + Random(660)`; if
     `minutesInDay < t`: `AddSameDayStrategicEvent(MERC_COMPLAIN_EQUIPMENT, t, profile)` (a quote, M6 dialogue);
  10. `HandleMercArrivesQuotes` (I.M.P. Omerta quote, hated-merc gripes: presentation; `22` owns hated counters);
     select the arrival sector if the selected one has nobody.

### 2.7 Medical deposit refund

Only in `StrategicRemoveMerc` (contract end, firing, quitting, or the player removing a dead merc from the team list,
`Strategic/Assignments.cc:4358-4363`), and never for a POW (`Merc_Contract.cc:680-689`). `CalculateMedicalDepositRefund`
(`:711-742`), using the soldier's paid `usMedicalDeposit`:

| Condition | Ledger | Amount | Mail (`AIM_SITE`, special data = amount, profile) |
|---|---|---|---|
| `!bMedicalDeposit` (profile flag) | — | — | — |
| `life == lifeMax` | `FULL_MEDICAL_REFUND` | deposit | `AIM_MEDICAL_DEPOSIT_REFUND` |
| `0 < life < lifeMax` | `PARTIAL_MEDICAL_REFUND` | `(2·deposit·life/lifeMax + 1)/2` (rounded half up) | `AIM_MEDICAL_DEPOSIT_PARTIAL_REFUND` |
| `life ≤ 0` | none (`NO_MEDICAL_REFUND` is commented out) | 0 | `AIM_MEDICAL_DEPOSIT_NO_REFUND` (special data = the deposit) |

The life used is the current life at departure (bleeding and unhealed wounds reduce the refund). A merc who dies keeps his
dead body on the team list until the player removes it; only then is the "no refund" mail sent. M.E.R.C. mercs never
pay a deposit (§3.3).

### 2.8 What ja2-node's `hireMerc` does not do yet

`src/sim/campaign/hiring.ts` `hireMerc` (used by `createCampaignSession`) creates the soldier, sets `IN_TRANSIT`, the letter
and the chopper insertion, and posts the first-arrival event. Missing, by §2.3–§2.6:
- **money**: no amount, no funds check, no `HIRED_MERC`/`MEDICAL_DEPOSIT` records, no `uiTotalCostToDate`;
- **contact and refusals**: status, hangover, hated/buddy, death rate, reputation;
- the **team size** test counts roster entries (vehicles included); the original counts non-vehicles, limit 18;
- **kit choice**: inventory is always copied; no `usOptionalGearCost` zeroing, no `ALREADY_USED_ITEMS`, no Nails jacket;
- **profile status** (`HIRED_BUT_NOT_ARRIVED_YET`, then the contract length), `dayBecomesAvailable` untouched;
- **contract fields**: length, type, end time, `timeCanSignElsewhere`, paid deposit, insurance reset, `timeSoldierWillArrive`,
  `useLandingZone`; the `ARRIVING_GAME` insertion for later hires (it uses `NORTH`);
- **arrival time** for later hires (`GetMercArrivalTimeOfDay`): it posts no event unless the game just started, so a merc hired
  after the landing never arrives;
- the **landing zone** (`mercArriveSector`) and `CheckForValidArrivalSector`, the start-sector clean-up, the
  arrival-time contract recomputation, the equipment complaint draw;
- **history** and the **personnel** departed lists;
- M.E.R.C. and I.M.P. hire paths (§3.3, §4.3).

---

## 3. M.E.R.C.

### 3.1 The site and the account

- **Online day**: `InitNewGame` draws `d = Random(max − min + 1) + min` (policy `merc_online_min_days 1`, `_max_days 2`,
  `game.json:229-230`); `d == 0` sends `MERC_INTRO` at once, else `DAY3_ADD_EMAIL_FROM_SPECK` (11) at Day 1+d 07:00
  (`Strategic/Game_Init.cc:251-264`; already in `src/sim/campaign/new-game.ts`), whose handler sends `MERC_INTRO`
  (`Game_Event_Hook.cc:126-128`). Opening that mail sets the M.E.R.C. bookmark (`HandleMailSpecialMessages`,
  `Laptop/EMail.cc:1688-1691`): the site is reachable only after the player *reads* it.
- **Account status** `gubPlayersMercAccountStatus` (`Laptop/Mercs.h:24-31`): `NO_ACCOUNT 0`, `SUSPENDED 1`, `INVALID 2`,
  `VALID_FIRST_WARNING 3`, `VALID 4`; starts at 0 (`Mercs.cc:218`). Opening an account (`Mercs_No_Account.cc:99-114`):
  `VALID`, `guiPlayersMercAccountNumber = Random(99999)` (one `main` draw, display only). Without an account the files
  (hire) page is disabled (`Mercs.cc:256-259`).
- **Outage** (once per game; checked at the end of the daily update, §3.5): `ShouldTheMercSiteServerGoDown`
  (`Mercs.cc:1485-1504`) = `!fMercSiteHasGoneDownYet && ubLastMercAvailableId ≥ 1 (Larry revealed) && status == VALID &&
  Random(100) < day·2 + 10` (the draw only when the three conditions hold). Then `fMercSiteHasGoneDownYet = true` and
  `MERC_SITE_BACK_ONLINE` (64) at `midnight(1) + 18·60` (`:574-587`). While down (`fMercSiteHasGoneDownYet &&
  !fFirstVisitSinceServerWentDown`, i.e. until that event fires, `Laptop/Laptop.cc:1784-1797`), the bookmark shows the
  broken-link page: no hiring, no payments, fees keep accruing. `GetMercSiteBackOnline` (`Mercs.cc:1507-1514`): mail
  `MERC_NEW_SITE_ADDRESS` (opening it re-sets the bookmark, `EMail.cc:1705-1708`), `fFirstVisitSinceServerWentDown = 1`
  (Speck's next opening sets 2).

### 3.2 Which mercs are listed

`mercs-MERC-listings.json` in file order, `index` = position (`externalized/DefaultContentManager.cc:1309-1316`), with
`minTotalSpending` and `minDays` per entry (0/0 for the first six; then 5000/8, 10000/15, 15000/20, 20000/25). Listing is a
**prefix**: a merc is shown iff `index ≤ gubLastMercIndex` (`Mercs_Files.cc:235, 476`); `IsMercMercAvailable` adds
`IsMercHireable` (`Mercs.cc:1291-1311`).

- `CanMercBeAvailableYet(m)` (`Mercs.cc:1596-1617`): `index > gubLastMercIndex && IsMercHireable(profile) &&
  minTotalSpending ≤ uiTotalMoneyPaidToSpeck && minDays ≤ day`.
- `MakeNewMercsAvailable(notify)` (`:1664-1684`): walk the listings; for each eligible one `gubLastMercIndex = index` and
  `ubLastMercAvailableId` = 0/1/2/3 for BUBBA/LARRY_NORMAL/NUMB/COUGAR (`:1620-1629`); an earlier unhireable merc becomes
  listed too (prefix). If anything was revealed and `notify`: mail `NEW_MERCS_AT_MERC`, `fNewMercsAvailableAtMercSite`.
- Initial state: `GameInitMercs` → `MakeNewMercsAvailable(false)` at laptop init (`Laptop.cc:351-387`), giving
  `gubLastMercIndex = 5` with fresh profiles (inferred for restarts in one process: stale; ja2-node sets 5).
- `ScheduleNewMercsToBeAvailable` (`:1579-1593`), every midnight from the daily update regardless of account or mail: if
  any listing is eligible, `MERC_SITE_NEW_MERC_AVAILABLE` (78) at `midnight(1) + 420 + Random(180)`; nothing de-duplicates,
  so a new event (and draw) is posted every midnight while eligibility lasts; the handler re-evaluates
  (`NewMercsAvailableAtMercSiteCallBack`, `:1686-1689`) and later events usually reveal nothing.
- Unlocks therefore depend on **money paid to Speck** and the day, not on hires.
- Larry: the listing resolves to `LARRY_DRUNK` when `FACT_LARRY_CHANGED` (`Mercs.cc:600-608`); the swap
  (`Soldier_Profile.cc:955-978, 1026-1033`, M6) copies status, inventory and stats but not `iMercMercContractLength` or
  `uiTotalCostToDate` (unpaid days stay on the other profile; same in V). Biff: `uiDayBecomesAvailable = Random(2) + 2` when
  Speck tells of Flo's death or marriage (`Mercs.cc:1554-1557`, §3.6).
- Away and dead M.E.R.C. mercs follow §2.2 (chance `1·expLevel`; the death roll needs `PLAYER_HAD_CHANCE_TO_HIRE`, set
  only after day 3; no mail for M.E.R.C. deaths).

### 3.3 Hiring

Files page "hire" (`Mercs_Files.cc:245-266`) → `MercFilesHireMerc` (`:393-461`) → `HireMerc`:
1. button enabled only if the merc is not dead and the status is `VALID`, `FIRST_WARNING` or `SUSPENDED` (`:202-209`);
2. `SUSPENDED` → back to the home page with a Speck quote, no hire;
3. `!IsMercHireable` → (alive) "already hired" quote; fail;
4. `HireMerc` status gate {0, −2, −4}; team ≥ 18 → "too many";
5. hire struct: kind `MERC`, `copyItems = true` (always the full kit, free, no `ALREADY_USED_ITEMS`), length 1, landing
   zone, arrival `GetMercArrivalTimeOfDay()`, **insertion left at 0 = `NORTH`** (AIM and I.M.P. use `ARRIVING_GAME`);
6. `HireMerc`'s MERC branch (`Merc_Hiring.cc:191-201`): `p.iMercMercContractLength = 1` (the hire day is owed at once),
   `s.iStartContractTime = day`, history `HISTORY_HIRED_MERC_FROM_MERC`.

No funds check, no transaction, no deposit, no contract or kit choice. Re-hiring overwrites an unpaid
`iMercMercContractLength` with 1 (inferred: firing and re-hiring erases the debt). M.E.R.C. mercs are outside the AIM
renewal machinery (`22`). The arrival is the AIM one (§2.6).

### 3.4 Fees, debt and payment

- Debt per merc = `sSalary · iMercMercContractLength` (`Mercs_Account.cc:246, 428`), with the *current* salary (it rises
  with levels, §2.4); `CalculateHowMuchPlayerOwesSpeck` sums every listing, on the team or not (`:421-432`).
- `SettleMercAccounts` (`Mercs_Account.cc:260-326`), greedy in listing order, balance not decremented until the end:
  ```
  paid = 0
  for m in listings (resolved profile p):
    if IsMercOnTeam(p) || p.mercMercContractLength != 0:
      c = p.salary · p.mercMercContractLength
      if balance ≥ paid + c: p.mercMercContractLength = 0; paid += c; p.totalCostToDate += c
  if paid == 0: "not enough funds"; return
  AddTransactionToPlayersBook(PAY_SPECK_FOR_MERC, profileOf(listing gubCurMercIndex), now, −paid)
  AddHistoryToPlayersLog(HISTORY_SETTLED_ACCOUNTS_AT_MERC, same profile, now, (−1, −1))
  uiTotalMoneyPaidToSpeck += paid
  if paid == total owed (giMercTotalContractCharge): status = VALID (also from INVALID); clear SENT_EMAIL_ABOUT_LACK_OF_PAYMENT
  ```
  The ledger's second code is the profile of the merc page last viewed (`gubCurMercIndex`), a UI index: ja2-node uses the
  first paid listing's profile (deviation, cosmetic).

### 3.5 The daily updates

`DAILY_UPDATE_OF_MERC_SITE` (10, every day 00:00, before `MERC_DAILY_UPDATE`, `docs/15` §3.1) → `DailyUpdateOfMercSite`
(`Mercs.cc:513-588`):
```
if day == 1: return
n = 0
for m in listings (profile p): if !IsMercOnTeam(p): continue
  if !dead(p): p.mercMercContractLength += 1
  n = max(n, p.mercMercContractLength)
if n > 12:     if status != INVALID:       status = INVALID;       mail MERC_INVALID
elif n > 9:    if status != SUSPENDED:     status = SUSPENDED;     mail MERC_WARNING;       flags |= SENT_EMAIL_ABOUT_LACK_OF_PAYMENT
elif n > 7:    if status != FIRST_WARNING: status = FIRST_WARNING; mail MERC_FIRST_WARNING; flags |= SENT_EMAIL…
ScheduleNewMercsToBeAvailable()          // Random(180) iff something is eligible (§3.2)
if ShouldTheMercSiteServerGoDown(): …    // Random(100) iff its preconditions hold (§3.1)
```
Thresholds `Mercs.h:13-15`. Counted from the hire day (length 1), the warning comes after 7 midnights, suspension after 9,
invalid after 12. Because the tests are `!=`, a smaller `n` (a merc fired or paid) moves `SUSPENDED` back to
`FIRST_WARNING` and resends that mail; `n ≤ 7` leaves the status alone. Fired mercs stop counting toward `n` but stay owed.
A merc in transit, a POW or a dead body still on the team counts (dead ones do not accrue).

`MERC_DAILY_UPDATE` then (`Strategic_Merc_Handler.cc:274-284`): if the status is `INVALID`, every MERC soldier not POW, not
in transit and with `life ≥ CONSCIOUSNESS` gets `MercsContractIsFinished` (`:375-406`: interrupt and pause, the
"not getting paid" quote, contract end without the equipment question, leave code `HISTORY_MERC_QUIT`; departure itself
is `22`). It repeats every midnight while `INVALID`. Death of a M.E.R.C. merc sets `iEndofContractTime = now` and
`ubSpeckCanSayPlayersLostQuote = 1` (`:122-127`); unpaid days stay owed, nothing is refunded.

Level-ups of hired M.E.R.C. mercs post `MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY` (77) at `now + 60 + Random(60)` with param
`profile − BIFF` (−1 more from `LARRY_DRUNK − BIFF` on), whose mail is `MERC_UP_LEVEL_BIFF + 2·param`
(`Tactical/Campaign.cc:683-706`, `EMail` handler; the existing deviation row "Experience level-up side effects" is
removed by this).

### 3.6 Speck's quotes with side effects

`GetSpeckConditionalOpening` (`Mercs.cc:955-1177`) runs when the player enters the home page from outside the site (after
the video intro, a UI timer). Effects that matter: `ubPlayerBeenToMercSiteStatus` increments per entry (0–3,
`:276-288`); `fFirstVisitSinceServerWentDown 1 → 2`; `ubSpeckCanSayPlayersLostQuote → 0` (with ≥ 2 dead M.E.R.C. mercs);
`SENT_EMAIL_ABOUT_LACK_OF_PAYMENT` and `fNewMercsAvailableAtMercSite` cleared; `fHasAMercDiedAtMercSite`; per dead listing
`miscFlags3 |= MERC_MERC_IS_DEAD_AND_QUOTE_SAID`; **Biff goes away for `Random(2) + 2` days** when Speck tells of Flo's death
(Biff alive) or of her marriage (`fSpeckSaidFloMarriedCousinQuote`); the Larry relapse flag in `uiSpeckQuoteFlags`. The
opening also draws `Random(100)`, `Chance(50)`, `Random(4)` for the quote choice and `CoinToss` after a hire
(`:1274-1334`). ja2-node runs this opening at `visitSite merc` the first time in a laptop session, or at the first M.E.R.C.
command of a session without a visit (§10), so its draws and the Biff side effect happen at a defined command instead of
when the video intro ends (deviation; with the clock stopped in the laptop no strategic draw can interleave, so only the
order relative to other laptop commands can differ, inferred). `visitSite` returns the quote ids the opening queues, in the
queue's order: the first visit says 0, then the tags below, then 1–8 (each later call of `GetSpeckConditionalOpening`
queues the next intro quote); the second visit 10; later visits one branch (11 nobody hired yet; 19 back after the outage;
23 two or more dead; 14 suspended; 15 + 16 owing more than $5,000; 12, 13 or 20 + 21 once by `Random(100)`) and, after
19, 12, 13 or 20, a tag 41–44 when `Chance(50)`; then 24 (the unpaid-account mail), 22 (new mercs), 27 (the first death),
per newly dead listing its `MERC_DEAD` quote from `mercs-MERC-listings.json` (Flo: 32 with Biff alive, else 33), 34 (Flo
married) and 37 (Larry relapsed). Idle chatter (`:1388-1551`) is UI only.

---

## 4. I.M.P.

### 4.1 Access and slots

- Activation code (`IMP_HomePage.cc:59-77`): an exact match against `imp.json` `activation_codes` (`["XEP624",
  "xep624"]`, 6 characters) and `CanCreateAnotherIMPCharacter()`. The code itself is in the I.M.P. intro mail sent at new
  game when another character can be created (`Game_Init.cc:235-238`); the player must know it, not read the mail.
- `CanCreateAnotherIMPCharacter()` (`IMP_Compile_Character.cc:95-99`) = a free slot exists and taken < policy
  `imp.max_characters` (1; 0 turns the site off; `game.json:194-226`). Slots (`:53-92`): profiles not declared in the data
  or declared `IMP`, in id order (51–56, 165–169, 170–199 with the shipped data); a character always takes the first free
  slot; `MarkIMPCharacterCreated` sets the slot `TAKEN` and `fIMPCompletedFlag` (informational in Strac).
- Begin (`IMP_MainPage.cc:447-455`) refuses with `balance < 3000` or `NumberOfMercsOnPlayerTeam() ≥ 18`. Progress modes
  (begin → personality → attributes → portrait → voice → finish, `:238-247, 560-611`) are UI sequencing; only the final
  choices matter.

### 4.2 Choices

- **Name**: full name ≤ 29 characters, nickname ≤ 8; trimmed; empty full name refused; empty nickname = the first word of
  the full name, left 8 (`IMP_Begin_Screen.cc:45, 107-127, 274-299`). **Gender** male/female.
- **Personality quiz** (`IMP_Personality_Quiz.cc`): 16 questions; answers per question Q0 6, Q3 5, Q5 5, Q10 5, Q11 8,
  others 4 (`:248-257`). `CompileQuestionsInStatsAndWhatNot` (`:424-562`) appends, in question order, to three lists (S
  skill, A attitude, P personality; each capped at 20 entries):

| Q | a0 | a1 | a2 | a3 | a4 | a5 | a6 | a7 |
|---|---|---|---|---|---|---|---|---|
| 0 | S male ? MARTIALARTS : AMBIDEXT | A LONER | S HANDTOHAND | S LOCKPICKING | S THROWING | A OPTIMIST | | |
| 1 | S TEACHING | S STEALTHY | P PSYCHO | A FRIENDLY | | | | |
| 2 | S LOCKPICKING | A ARROGANT | S STEALTHY | A NORMAL | | | | |
| 3 | S AUTO_WEAPS | A FRIENDLY | A NORMAL | A ASSHOLE | A LONER | | | |
| 4 | A COWARD | — | A AGGRESSIVE | — | | | | |
| 5 | A COWARD | S NIGHTOPS | P CLAUSTROPHOBIC\* | — | — | | | |
| 6 | S ELECTRONICS | S KNIFING | S NIGHTOPS | — | | | | |
| 7 | S AMBIDEXT | — | A OPTIMIST | P PSYCHO | | | | |
| 8 | P FORGETFUL\* | — (V: A PESSIMIST) | A PESSIMIST | P NERVOUS\* | | | | |
| 9 | — | A PESSIMIST | A ASSHOLE | P NERVOUS\* | | | | |
| 10 | — | S TEACHING | A AGGRESSIVE | A NORMAL | — | | | |
| 11 | S male ? MARTIALARTS : AMBIDEXT | S KNIFING | — | S AUTO_WEAPS | S HANDTOHAND | S ELECTRONICS | — | — |
| 12 | P FORGETFUL\* | A NORMAL | A NORMAL | P HEAT_INTOLERANT\* | | | | |
| 13 | P CLAUSTROPHOBIC\* | A NORMAL | P HEAT_INTOLERANT\* | — | | | | |
| 14 | S THROWING | S AMBIDEXT | A ARROGANT | — | | | | |
| 15 | — | — | — | — | | | | |

  \* `AddAPersonalityToPersonalityList` keeps only `PSYCHO` (`IMP_Compile_Character.cc:417-430`). The gender used for Q0/Q11
  is the one chosen *before* the quiz; changing gender afterwards does not recompute (martial arts become hand-to-hand for
  women and big bodies at confirm anyway).
- **Personality and attitude** (`CreatePlayersPersonalitySkillsAndAttitude`, on the personality-finish page,
  `IMP_Personality_Finish.cc:306, 334`): personality = `PSYCHO` if the personality list is non-empty, else none
  (`:433-444`). Attitude (`:240-298`): empty list → `ATT_NORMAL` (no draw); else count hits per attitude, `H` = max, `k` =
  number of attitudes with `H` hits, `d = Random(k)` (drawn even for `k == 1`), attitude = the `d`-th such attitude in
  ascending enum order (`NORMAL 0 … COWARD 9`).
- **Direct skill pick** (policy `imp.pick_skills_directly`, default false; `IMP_SkillTraits.cc`): replaces the quiz; up to
  2 of 14 traits (martial arts hidden for women); no personality/attitude; bonus points: none picked +10, one of
  `ELECTRONICS`/`AMBIDEXT`/`CAMOUFLAGED` +5, otherwise 0 (`:554-591`).
- **Attributes** (`IMP_Attribute_Selection.cc`): all ten start at 55 (health, agility, dexterity, strength, wisdom,
  leadership, marksmanship, medical, mechanical, explosives); pool = `imp.bonus_attribute_points` 40 (+ the direct-pick
  bonus) (`SetAttributes`, `:729-748`). +1 costs 1 point below `max_attribute_points` 85; a value at 0 needs 15 points and
  becomes `min_attribute_points` 35; −1 refunds 1 above min 35; only the four skills (marksmanship, medical, mechanical,
  explosives) may drop from 35 to 0, refunding `zero_attribute_points_bonus` 15 (`:310-385`). Unspent points are lost.
- **Portrait** (one of the gender's 8 in `imp.json` `portraits`) and **voice** (one of the gender's 3 in `voices`).

### 4.3 Compile and confirm

At "done" (`CreateACharacterFromPlayerEnteredStats`, `IMP_Compile_Character.cc:200-238`) the slot's profile gets name,
nickname, sex, `ubVoiceId = voices[i].profile`, life = lifeMax = health, the nine other stats, personality, attitude,
`bExpLevel = imp.json starting_level` (1), `bMercStatus = MERC_OK`, face/hair/skin from the portrait (`:504-531`); the
slot starts from an empty default profile (`docs/06` §6.2) with white vest and black pants (`Soldier_Profile.cc:158-159`);
no salary, no deposit, no misc flags.

Confirm "yes" (`IMP_Confirm.cc:157-217`):
```
if !CanCreateAnotherIMPCharacter(): return
if balance < 3000 (COST_OF_PROFILE, CharProfile.h:72): return            // silent
profile = first free slot
AddCharacterToPlayersTeam():                                             // :118-155
  HandleMercStatsForChangesInFace()                                      // skills and body, below
  GiveItemsToPC(profile)                                                 // imp.json inventory, below
  SetProfileFaceData(portrait face, eyes, mouth)
  HireMerc({profile, kind: PLAYER_CHARACTER, landing zone, copyItems: true, length: −1,
            insertion: ARRIVING_GAME, arrival: GetMercArrivalTimeOfDay()})
  if result == 0 (failed): return (no charge)                            // −1 "too many" counts as success (bug, below)
MarkIMPCharacterCreated(profile)
if no soldier with that profile: return (no charge)
AddTransactionToPlayersBook(IMP_PROFILE, profile, now, −3000)            // also uiTotalCostToDate += 3000
AddHistoryToPlayersLog(HISTORY_CHARACTER_GENERATED, 0, now, (−1, −1))
if imp.json send_profile_results_email: AddFutureDayStrategicEvent(DAY2_ADD_EMAIL_FROM_IMP, 420, profile, 2)
```
- **Skills** (`HandleMercStatsForChangesInFace`, `IMP_Compile_Character.cc:536-568`; `CreatePlayerSkills`, `:368-414`):
  validate the skill list against the stats (`ValidateSkillsList`, `:337-365`):
  mechanical 0 removes every `ELECTRONICS`; `idiv(idiv(mech·wis, 100)·dex, 100) + 25 (gbSkillTraitBonus[LOCKPICKING]) < 50`
  removes every `LOCKPICKING` (`Soldier_Profile.cc:58-76`); marksmanship 0 removes `AUTO_WEAPS` and `HEAVY_WEAPS`. Removal
  swaps with the last element (`for (i = 0; i != n;) if L[i] == s then L[i] = L[--n] else ++i`, `:321-334`), which reorders
  the list. Quiz mode (`:401-413`): `A = L[Random(n)]`; if `A ∈ {ELECTRONICS, AMBIDEXT}` remove every `A`; `B = n == 0 ?
  NO_SKILLTRAIT : L[Random(n)]` (A == B allowed: expert). With `n == 0` at the first draw, `Random(0)` returns 0 without
  drawing and `A = L[0]`, a stale value (a skill removed by validation, or 0 in a fresh process): ja2-node uses
  `NO_SKILLTRAIT` (deviation). Direct-pick mode (`:372-399`): traits appended in enum order, validated; one left → `A = B
  = it` (expert) unless it is `ELECTRONICS`/`AMBIDEXT`/`CAMOUFLAGED` (`B = none`); two → `L[0]`, `L[1]`; no draws.
  **Body**: male with a `big_body` portrait and `strength − strengthDelta ≥ 75` → `BIGMALE`, else `REGMALE`; female →
  `REGFEMALE`; `BIGMALE` and female turn `MARTIALARTS` into `HANDTOHAND` in both slots (`:176-186, 544-563`).
- **Starting gear** (`imp.json` `inventory`, `externalized/policy/DefaultIMPPolicy.cc:152-202`, `IMPPolicy.h:54-111`): sets in
  file order; each condition is a `≥` pair (`[STAT, n]`, `[n, STAT]`, `RND100` = **`PreRandom(100)`**, `[SKILL, X]` =
  `HasSkillTrait`), stopping at the first false one; items go to the named slot or the first empty small pocket (if
  `perPocket ≠ 0`), then big pockets 1–4, status 100, count 1 (`IMP_Confirm.cc:229-279`). Shipped: canteen and flak jacket;
  helmet if `wisdom ≥ PreRandom(100)` (V: `<`, an off-by-one in Strac's data); MP5K + 2 magazines at marksmanship ≥ 80,
  else Beretta 93R + 3; medical kit ≥ 60, first aid kit 30–59; toolkit at mechanical ≥ 50; TNT + detonator at explosives ≥
  50; one item per skill (lockpicking kit, brass knuckles, metal detector, break light, throwing knife, silencer, combat
  knife). `HireMerc` then copies the profile items onto the soldier (auto-placement decides the final layout, inferred).
- **Contract**: `length = −1`, so `bMercStatus = (UINT8)−1 = −1` (`MERC_HAS_NO_TEXT_FILE`) at hire and again at arrival, and
  `iEndofContractTime = midnight(0) + hour·60` (today): harmless because nothing reads them for `PLAYER_CHARACTER` (quirk;
  `22` confirms the renewal code is AIM-only). I.M.P. mercs are never paid (no daily cost path; inferred: no branch found).
- **Edge case** (keep): `HireMerc` returning `MERC_HIRE_OVER_20_MERCS_HIRED (−1)` counts as success, so with a full team the
  slot is marked taken, no soldier exists and nothing is charged (unreachable through Begin's team check unless the team
  fills between Begin and confirm; in ja2-node one command does both, so it is unreachable).
- Not saved in the original: the in-progress creation (inferred). ja2-node has no in-progress state at all (§4.4).

### 4.4 ja2-node: one deterministic command

`impCreate` (laptop flow) carries every choice, validated in the original's order, and performs the confirm in one step:
```
impCreate {
  code: string,                                   // must match imp.json activation_codes
  name: string, nickname?: string, gender: 'male' | 'female',
  answers?: number[16],                           // quiz mode: answer index per question (range per §4.2)
  skills?: SkillTrait[0..2],                      // only with imp.pick_skills_directly
  attributes: {health, agility, dexterity, strength, wisdom, leadership, marksmanship, medical, mechanical, explosives},
  portrait: number, voice: number                 // indices within the gender's entries
}
```
Validation: code and `CanCreateAnotherIMPCharacter`; balance ≥ 3000 and team < 18 (Begin); name rules; each answer in
range; attributes: every value in `[35, 85]`, or 0 for the four skills, and the total cost ≤ pool, where cost = Σ (v − 55)
over values ≥ 35, minus 35 for each skill at 0 (20 points from 55 down to 35, then the 15-point refund); the attribute page
lets the player reach exactly these sets (increments and decrements are inverse, the 0 ↔ 35 step is the only non-linear
one, and refunds are unbounded, inferred); portrait/voice index within the gender.
Execution: `compileQuiz(answers, gender)` → lists; `personalityAndAttitude` (attitude draw); write the profile; confirm as in
§4.3 (skill draws, `PreRandom(100)` helmet, hire). Result: the profile id, skills, personality, attitude, arrival.
A query `impPreview` returns the skill, personality and attitude lists (not the draws) for given answers.

---

## 5. Bobby Ray's

### 5.1 Site access

`LaptopSaveInfo.fBobbyRSiteCanBeAccessed` (reset at new game, `Laptop.cc:399`) gates the catalogue (`BobbyR.cc:212-223`). It
is set in `SetThisSectorAsPlayerControlled` for a surface sector, after the "no hostiles" check, when the sector is the
primary shipping destination's delivery sector (Drassen airport B13, `Strategic/Player_Command.cc:82-97`) and never cleared.
Visiting while "under construction" sets `ubHaveBeenToBobbyRaysAtLeastOnceWhileUnderConstruction = BEEN_TO_SITE_ONCE`; when
the site opens, that sends `BOBBYR_NOW_OPEN` once (`ALREADY_SENT_EMAIL`).

### 5.2 Inventory

Two lists of `STORE_INVENTORY {usItemIndex u16, ubQtyOnHand u8, ubQtyOnOrder u8, ubItemQuality u8, fPreviouslyEligible}`
(`Laptop/Store_Inventory.h:7-14`; `LaptopSaveInfo.BobbyRayInventory[351]`, `BobbyRayUsedInventory[351]`, terminated by item
65535, lengths in `usInventoryListLength[2]`).

**Building the lists** (`InitBobbyRayInventory`, `BobbyR.cc:422-435`, in `InitNewGame` after `InitAllArmsDealers`,
`docs/15` §4.2 step 3): new list = items whose `bobby-ray-inventory-new.json` max is non-zero, not `ITEM_NOT_BUYABLE`, and
`ItemIsLegal` (no big-gun-list guns/ammo without gun nut; no sci-fi filter) (`:438-469`); used list = the same with the used
JSON plus `CanDealerItemBeSoldUsed` (damageable and a category that allows used sales) (`:472-506`). Both sorted with the
dealer comparator (`Tactical/ArmsDealerInvInit.cc:377-499`, a total order): category (`DealerItemSortInfo`, `:33-58`:
handgun, shotgun, SMG, rifle, MG, launcher, ammo, grenade, bomb, blade, throwing knife, punch, armour, face, medkit, kit,
misc, thrown, key, money); ammo by calibre descending then magazine size descending; others by coolness descending; then
price descending; item index ascending; quality descending. Used sales are allowed for handgun, shotgun, SMG, rifle,
armour, face, misc.

**Transaction chance** (shared with dealers, `docs/23`; `ArmsDealerInvInit.cc:67-311`): suitability from
`GetCurrentSuitabilityForItem`: NONE if illegal, not buyable or coolness 0; ALWAYS for the staples (`:98-128`: common
magazines, first aid kit, medical kit, toolkit, locksmith kit, canteen, crowbar, jars); otherwise with `p =
ubHighestProgress`, `min = clamp(p/10, 1, 9)`, `max = clamp(p/10 + 1, 2, 10)`: coolness > max NONE, in `[min, max]` HIGH,
`coolness + 2 ≥ min` MEDIUM, else LOW. Bobby Ray's chance: NONE 0 (buy) / 100 (sell), LOW 25, MEDIUM 50, HIGH 75, ALWAYS
100 (buy) / 75 (sell) (dealers: 15/30/50); used item the dealer cannot sell used → 0; if `0 < chance < 100`: selling
`chance = (chance + 5·coolness)/2`; used `chance /= 2`. `ItemTransactionOccurs` (`:274-311`) sets
`fPreviouslyEligible` on a buying roll with chance > 0 and **always** draws `Random(100) < chance`.

**Initial stock** (`SetupStoreInventory`, `Laptop/Store_Inventory.cc:15-47`), per slot in sorted order: `bought =
DetermineInitialInvItems(max)` (`ArmsDealerInvInit.cc:314-330`: `max` buying rolls); new: quantity `bought`, quality 100;
used: if `bought > 0`, quantity 1 and quality `20 + Random(60)`. The progress used here is the value before
`InitStrategicStatus` (0 in a fresh process; inferred stale on a restart in the same process; ja2-node uses 0).

**Daily restock** (`DAILY_UPDATE_BOBBY_RAY_INVENTORY` 8, 09:00; handler order new, used, then dealers, `Game_Event_Hook.cc:112-
116`):
- New (`BobbyR.cc:514-562`): customers: for each slot with stock, one selling roll per unit, remove the sold ones
  (`:721-736`); reorder: for each slot with JSON max ≠ 0, nothing on order and `onHand ≤ max/2`: remember `prev =
  fPreviouslyEligible`; one buying roll; on success `n = max − onHand`, `Random(3)`: 0 → `n += n/2`, 1 → `n −= n/2`, 2 →
  unchanged (`HowManyItemsToReorder`, `ArmsDealerInvInit.cc:353-373`); if `n > 0`: `onOrder = n`, then `!prev` →
  `AddFreshBobbyRayInventory(item)` at once (newly eligible item: instant), else `UPDATE_BOBBY_RAY_INVENTORY` (9) at `now +
  1440 + Random(720)` (`:616-660`).
- Used (`:565-612`): customers likewise; for each slot with nothing on order and stock 0: one buying roll; success orders 1
  (no `Random(3)`); `prev` → event with param `item + 1000`; `!prev` → `AddFreshBobbyRayInventory(item)` **without** the
  +1000 (`:602`, same in V): it adds the *new* slot's on-order count to new stock, and the used slot keeps 1 on order
  forever (never restocks again) (quirk, inferred effect).
- `AddFreshBobbyRayInventory(param)` (`:663-700`): `param ≥ 1000` → used, `param −= 1000`, quality `20 + Random(60)` (drawn
  before the slot lookup); else new, quality 100; `onHand += onOrder`, quality set, `onOrder = 0`.
- Used stock is therefore always 0 or 1 unit, with one quality per slot.

### 5.3 Prices

`CalcBobbyRayCost` (`Laptop/BobbyRGuns.cc:1311-1321`): new = item `usPrice`; used = `(UINT16)(price · (0.5 + 0.5·q/100) + 0.5)`
in doubles with the slot's quality (`Math.trunc(price * (0.5 + 0.5 * q / 100) + 0.5)` reproduces it). No policy factor.

### 5.4 Ordering

- **Cart** (`BobbyRayPurchases[10]`, not saved, cleared on laptop entry, `BobbyRMailOrder.cc:1677`): lines `{item, count,
  quality (100 or the used slot's), slot index, used}`; adding a unit needs `onHand ≥ count + 1`; at most 10 lines
  (`MAX_PURCHASE_AMOUNT`), a line ≤ 200 (`BobbyRGuns.cc:1136-1263`). New and used are separate lines.
- **Order form**: destination −1 or 0–16 (`shipping-destinations.json`, 17 entries, all listed); speed 0 overnight (1 day),
  1 two business days (2 days; weekends do not exist), 2 standard (3 days).
- **Totals** (`BobbyRMailOrder.cc:693-831, 1472-1529`): subtotal = Σ unit cost × count; weight `w = Σ ubWeight × count` (100 g
  units), at least `MIN_SHIPPING_WEIGHT 20`; shipping = `(UINT32)((w / 10.0f) · rate + .5)` =
  `Math.trunc(Math.fround(Math.fround(w / 10) * rate) + 0.5)`, `rate` = the destination's per-kg charge for the speed
  (Strac data: Drassen 200/100/50; V: 500/200/100); no destination → 0. Grand total = subtotal + shipping.
- **Accept** (`:616-652`): needs a non-empty cart and a destination; `balance < grand` → "can't afford" (the only refusal:
  no weight limit, no destination check); a destination other than the primary, or the primary while its sector is enemy
  held, asks "ship to X?" first.
- **Purchase** (`PurchaseBobbyOrder`, `:1586-1610`): if the destination `canDeliver`, `AddNewBobbyRShipment`; **always**
  `AddTransactionToPlayersBook(BOBBYR_PURCHASE, 0, now, −grand)` (orders to Austin and other non-delivering cities take the
  money and nothing arrives); remove the units from stock (`onHand = max(onHand − count, 0)`, `:1276-1289`); clear the cart.
- **Shipment record** (`NewBobbyRayOrderStruct`, `BobbyRMailOrder.h:27-41`, 104 bytes; `gpNewBobbyrShipments`, save section
  after the laptop block, `SaveLoadGame.cc:478, 988-995`): active, destination, method, 10 lines, line count, weight
  (`max(w, 20)`), order day, shown-on-shipments-page. `AddNewBobbyRShipment` (`:1763-1844`) reuses slot 0 if it is inactive,
  otherwise appends (the reuse loop tests `[0]`, not `[i]`; same in V; the list only grows); days ahead =
  `CalculateOrderDelay(speed)` = 1/2/3, `+ Random(5) + 1` if Sal is dead (`bLife == 0`, `:1550-1580`); then
  `AddFutureDayStrategicEvent(BOBBYRAY_PURCHASE (7), (8 + Random(4))·60, index, days)`: delivery at **08:00, 09:00, 10:00 or
  11:00** of the target day. Draws: `[Random(5)]`, then `Random(4)`.
- John Kulba's gift (NPC action 188, M6, `:1612-1666`): two Automag III and two magazines, primary destination, 5 days (+ Sal
  penalty), not on the shipments page.

### 5.5 Delivery (`BobbyRayPurchaseEventCallback`, `Strategic/Strategic_Event_Handler.cc:54-343`)

```
sh = shipments[param]
if sh.active and dest.canDeliver and !dest.isPrimary: DropOffItemsInDestination(sh); return    // §below
gridno = dest.gridno (Drassen 10112)
if FACT_NEXT_PACKAGE_CAN_BE_LOST: clear it; if Random(100) < 50: inactive; FACT_LAST_SHIPMENT_CRASHED; return
elif FACT_NEXT_PACKAGE_CAN_BE_DELAYED: FACT_LAST_SHIPMENT_WENT_TO_WRONG_AIRPORT; clear it; gridno = 2 (LOST_SHIPMENT_GRIDNO)
elif town loyalty of the sector < 20 or the sector is enemy held: inactive; FACT_AGENTS_PREVENTED_SHIPMENT; return
units = Σ counts; kulba = any line is AUTOMAG_III
close the crate (loaded map or the unloaded sector's map modifications, :35-48)
theft = FACT_PABLO_WONT_STEAL or policy pablo_wont_steal (game.json:156) → 0
        elif FACT_PABLOS_BRIBED → shipmentsSinceNoBribes /= 2; 0
        else ++shipmentsSinceNoBribes; 12 + Random(4·shipmentsSinceNoBribes)
for each line: object at the line's quality (guns emptied); for unit j:
  loaded sector:   if !stolePrevious && theft > 0 && Random(100) < theft + count → stolen (vanishes)
  unloaded sector: if j > 1 && same && Random(100) < theft + j → stolen (put at gridno 1)
  else at gridno 2: status = max(1, (70 + Random(11))·status/100) (compounding), added at once, hidden
  remaining units added as stacks of perPocket (a gun recreated this way is loaded: quirk)
items: hidden (unloaded: AddItemsToUnLoadedSector; loaded: AddItemToPool)
facts: PABLOS_STOLE_FROM_LATEST_SHIPMENT = any stolen; LARGE_SIZED_OLD_SHIPMENT_WAITING cleared;
       if NEXT_PACKAGE_CAN_BE_DELAYED still set: clear MEDIUM/LARGE/REALLY_NEW
       else n = units − stolen: ≤ 5 none, ≤ 15 MEDIUM, else LARGE; REALLY_NEW; EVENT_SET_BY_NPC_SYSTEM at now + 120
inactive; StopTimeCompression(); mail: Kulba's, or the destination's (Drassen offset 198, 4 lines)
```
Draws: `[Random(100)]` loss, `[Random(4n)]` theft base, per unit `[Random(100)]` theft and `[Random(11)]` damage (short
circuit). `shipmentsSinceNoBribes` is a function static, not saved (ja2-node saves it: deviation, inferred harmless).
Non-primary destinations (Meduna N3, gridno 10959; `:939-1025`): enemy held → inactive silently; else crate and stacked
hidden items, no theft, no facts, no compression stop, no draws, mail offset 220; the loop bound reads shipment `[0]`'s
line count (same in V: lines are lost when shipment 0 has fewer). The Pablo follow-ups (returned goods with two `Random(10)`,
the 24-hour delay, the 70 % damage roll, Sal replacing Pablo) run from NPC actions and events (`Strategic_Event_Handler.cc:
346-474`, `Overhead.cc:2317, 5354-5356`, `Quests.cc:64-71, 498-531`) and are M6.

ja2-node: until M6 dialogue, the facts are plain fact flags (`state.battle.quests` / a facts table); Pablo theft runs as
above whenever its facts say so. Delivered items land in the sector's item state through `sector-loot.ts`
(`addItemsToUnloadedSector`) or the loaded world's pool, hidden.

---

## 6. Email, history, finances, files

### 6.1 Email

**Record** (`Laptop/EMail.h:136-148`): `usOffset` (u16: the first record in `email.edt`, which is also the mail's *type*),
`usLength` (records), `ubSender` (u8), `iDate` (world minutes), `iFirstData` (i32), `uiSecondData` (u32), `fRead`. The
subject is derived from the text (not state). Senders (`:152-166`): `MAIL_ENRICO 0`, `CHAR_PROFILE_SITE 1`, `GAME_HELP 2`
(unused), `IMP_PROFILE_RESULTS 3`, `SPECK_FROM_MERC 4`, `RIS_EMAIL 5`, `6 + profile` for A.I.M. mercs 0–39 (`BARRY_MAIL 6`
… `MELTDOWN_MAIL 45`), `INSURANCE_COMPANY 46`, `BOBBY_R 47`, `KING_PIN 48`, `JOHN_KULBA 49`, `AIM_SITE 50`.

**List**: arrival order; `AddEmail` (unread, data 0/0), `AddPreReadEmail` (read), `AddEmailWithSpecialData(off, len, sender,
date, first, second)` (`EMail.cc:492-569`). The player may delete any mail (`:1402`); UI sorting relinks the list
(presentation; ja2-node keeps arrival order and sorts in the view). Opening a mail (`DisplayEmailMessage`, `:986-1052`) sets
`fRead` and runs `HandleAnySpecialEmailMessageEvents` and `HandleMailSpecialMessages` (`:1641-1720`) on every display
(idempotent): **the only effects of reading** are the I.M.P. bookmark (`IMP_EMAIL_INTRO`, `IMP_EMAIL_AGAIN`) and the
M.E.R.C. bookmark (`MERC_INTRO`, `MERC_NEW_SITE_ADDRESS`). `$MERCNAME$` is `profile(uiSecondData).zName`, `$AMOUN$` is
`iFirstData` as money (`:2439-2470`). `fNewMailFlag` (general info) is set by every added mail, pre-read ones included
(`EMail.cc:562`), and cleared when the laptop closes; ja2-node keeps it as the saved `newMail` (M8: it raises the laptop's
new-mail box and the map screen's blinking icon); `fUnReadMailFlag` is derived (`unreadMail`). Save: section 10 (`u32 n`,
per mail `u32 subjectSize` (Strac 0) + 44 bytes, `LoadSaveEMail.cc`), currently skipped by ja2-node's reader.

**Catalogue** (offset (length) from `EMail.h`; "data" = special data; no mail other than the four above has an effect
when read):

| Mail | Offset | Sent by (condition) | Data | MS |
|---|---|---|---|---|
| `OLD_ENRICO_1/2/3`, `RIS_REPORT` (pre-read) | 138, 141, 146, 144 | `InitNewGame` (`Game_Init.cc:230-233`) | — | M5 |
| `IMP_EMAIL_INTRO` | 0 (10) | `InitNewGame` if `CanCreateAnotherIMPCharacter` (`:235-238`; V always) | — | M5 |
| `IMP_EMAIL_AGAIN` | 13 (6) | `HAVENT_MADE_IMP_CHARACTER_EMAIL` (74) handler (`Laptop.cc:1456-1464`): if still allowed and not sent, set `fSentImpWarningAlready` | — | M5 |
| `IMP_EMAIL_PROFILE_RESULTS` | 29 (1) | `DAY2_ADD_EMAIL_FROM_IMP` (19) if `send_profile_results_email` (`Game_Event_Hook.cc:129-136`) | first = profile (V: 0) | M5 |
| `ENRICO_CONGRATS` | 10 (3) | first landing (`Map_Screen_Interface.cc:3665`) | — | M5 |
| `MERC_INTRO`, `MERC_NEW_SITE_ADDRESS` | 19 (5), 24 (2) | §3.1 | — | M5 |
| `MERC_FIRST_WARNING`, `MERC_WARNING`, `MERC_INVALID` | 36, 30, 32 | §3.5 | — | M5 |
| `NEW_MERCS_AT_MERC` | 34 | §3.2 | — | M5 |
| `MERC_UP_LEVEL_*` (10) | 38 + 2·k | event 77 (§3.5) | — | M5 |
| `AIM_REPLY_*` (40) | 58 + 2·id | §2.2 (merc back, message left); sender `6 + id` | — | M5 |
| `MERC_DIED_ON_OTHER_ASSIGNMENT` | 206 (5) | §2.2 (AIM profiles only) | second = profile | M5 |
| `AIM_MEDICAL_DEPOSIT_REFUND`, `_PARTIAL_REFUND`, `_NO_REFUND` | 26, 214, 217 | §2.7 | first = amount, second = profile | M5 |
| `INSUR_PAYMENT`, `INSUR_SUSPIC`, `INSUR_SUSPIC_2`, `INSUR_INVEST_OVER`, `INSUR_1HOUR_FRAUD` | 170, 173, 179, 176, 211 | §7.1 | first = payout, second = profile | M5 |
| `BOBBYR_NOW_OPEN` | 182 | §5.1 | — | M5 |
| `BOBBYR_SHIPMENT_ARRIVED`, `JOHN_KULBA_GIFT`, `BOBBY_R_MEDUNA_SHIPMENT` | 198 (4), 202 (4), 220 (4) | §5.5 (offsets also in `shipping-destinations.json`) | — | M5 |
| `ENRICO_PROG_20/55/80`, `ENRICO_SETBACK`, `_SETBACK_2`, `ENRICO_CREATURES`, `LACK_PLAYER_PROGRESS_1/2/3` | 152, 155, 158, 161, 164, 167, 189, 192, 195 | `HandleEnricoEmail` (`Strategic_Status.cc:246-376`; decision tree already in `economy/inactivity.ts`, which must now send them; lack of progress also writes `HISTORY_ENRICO_COMPLAINED`) | — | M5 |
| `ENRICO_MIGUEL` | 149 | NPC action → `SET_BY_NPC_SYSTEM` next day `390 + Random(60)` (`Interface_Dialogue.cc:3464-3465`) | — | M6 |
| `KING_PIN_LETTER` | 185 (4) | Kingpin money chain (`Strategic_Event_Handler.cc:476-592`, `Random(120)` reposts) | — | M6 |

### 6.2 History

**Record** (`Laptop/History.cc:32-39`): `ubCode`, `ubSecondCode` (usually a profile, a town or a quest), `uiDate` (minutes),
sector `(x, y, z)` or `(−1, −1)`; appended by `AddHistoryToPlayersLog` (`:111-122`); save section 8 (12-byte records; V
writes z = 0 and a colour byte). Codes (`History.h`, 0–77) and their writers: hired from A.I.M. 1 / M.E.R.C. 2 (§2.5,
§3.3); merc killed 3, or 77 when killed by our team (`Strategic_Merc_Handler.cc:66-68`); settled M.E.R.C. account 4;
character generated 6 (§4.3, second code 0); insurance purchased 7, payout 9 (8 unused); contract extended 10–12 (`22`);
fired 13, quit 14, contract expired 22, Slay left 76 (`StrategicRemoveMerc :677`, not for the dead); quest started 15 and
finished 16 (`Quests.cc:1113, 1137`; not for `QUEST_HELD_IN_ALMA`); miner talk and mine events 17, 26–29 (`Strategic_Mines.cc:
283-287`, second code = town; ja2-node's mines must start writing them); liberated town 18; cheat 19; Enrico complained 24;
battle results 25, 64–73 (`LogBattleResults`, `PreBattle_Interface.cc:1391-1426`; the PBI/autoresolve aftermath of `19`
must write them); RPC joined 23; Walker 20, married off 21, Tixa/Orta 30/31, rocket rifles 32, Deidranna's dead bodies 33,
boxing matches 34, something in the mines 35, NPC info 36–58, boxing results 59–61, found money 62, assassin 63, NPC killed
74, Carmen's head 75 (M6). (Numbers checked against `History.h`.)

**Logic reader**: only `GetTimeQuestWasStarted(quest)` (`History.cc:737-753`: the date of the first `QUEST_STARTED` with that
second code, 0 if none), used by `FACT_BLOODCAT_QUEST_STARTED_TWO_DAYS_AGO` (`Quests.cc:876-878`, M6). Everything else is a
record for the player.

### 6.3 Finances

Already implemented (`src/sim/campaign/finances.ts`: codes 0–27, the cost-to-date code set, records `{code, secondCode,
minute, amount, balanceAfter}`, `docs/18` §3.9). Codes written by M5 code: `ANONYMOUS_DEPOSIT` (starting cash), `HIRED_MERC`,
`MEDICAL_DEPOSIT`, `BOBBYR_PURCHASE` (second code 0), `PAY_SPECK_FOR_MERC`, `IMP_PROFILE`, `PURCHASED_INSURANCE`,
`EXTENDED_INSURANCE`, `INSURANCE_PAYOUT`, `PURCHASED_FLOWERS` (0), `FULL_MEDICAL_REFUND`, `PARTIAL_MEDICAL_REFUND`,
`EXTENDED_CONTRACT_*` and `PAYMENT_TO_NPC` (`22`), `TRANSFER_FUNDS_TO_MERC`/`MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT`
(inventory money, `12`/M5 UI), `PURCHASED_ITEM_FROM_DEALER` (`23`). Never written: `ACCRUED_INTEREST` (there is no interest),
`TRANSACTION_FEE`, `REDUCED_INSURANCE`, `CANCELLED_INSURANCE`, `NO_MEDICAL_REFUND`, `TRANSFER_FUNDS_FROM_MERC`,
`DEPOSIT_FROM_GOLD_MINE` (all mine income is `DEPOSIT_FROM_SILVER_MINE`, `Strategic_Mines.cc:538`). `uiTotalCostToDate` also
changes outside the ledger: +charge on M.E.R.C. payment (§3.4) and money handed to NPCs (`TacticalAI/NPC.cc:878, 928`, M6).
Game logic reads only the balance; the "yesterday/today" summaries (`Finances.cc:989-1294`) are display, and the server
computes them (`financeSummary`, M8) so their quirks stay out of the client: the functions walk the ledger from the newest
record backwards with UINT32 day numbers (day − 1 and day − 2 wrap on days 0 and 1); "yesterday's" opening balance
(`GetPreviousDaysBalance`) subtracts a day and then looks for a record of day − 2, three days back, and is 0 before day 3;
yesterday's closing balance is the balance after the newest record of yesterday, or 0 on a day without records; yesterday's
sums count the first record of the day before yesterday too; today's sums re-arm their flag on every record of today, so
they count every matching record of today and, when today's oldest record does not match, yesterday's newest record if it
matches; the debits are what the balances leave over. `GetProjectedTotalDailyIncome` is `PredictIncomeFromPlayerMines`.
The ledger row labels (`ProcessTransactionString`, `Finances.cc:777-825`) are rendered by the server in the session's
display language: `pTransactionText` verbatim (a silver-mine deposit shows the gold-mine text), with the profile's nickname
for the codes that name a merc, and with the sector label for militia training (the sector and its town, or the mine's
town and the word "Mine"; the land types of other sectors are not rendered yet).

### 6.4 Files

Records `{ubCode, fRead}`, added idempotently by code (`Files.cc:310-326`); save section 9. `ENRICO_BACKGROUND` (0) at laptop
init (`GameInitFiles`, `:184-192`); the six terrorist files when Carmen's NPC action runs (`AddFilesAboutTerrorists`,
`:1009-1015`, all six regardless of which are active; M6). No logic. Showing a file sets `fRead` (`DisplayFormattedText`): `readFile {code}` (M8, U12).

---

## 7. Insurance, florist, funeral, personnel

### 7.1 Life insurance

Soldier fields: `usLifeInsurance` (0/1), `iStartOfInsuranceContract` (a day), `iTotalLengthOfInsuranceContract` (days),
`uiStartTimeOfInsuranceContract` (minute). Profile `ubSuspiciousDeath` (`SUSPICIOUS 1`, `VERY_SUSPICIOUS 2`). Strategic status
`insuranceInvestigations` (`ubInsuranceInvestigationsCnt`). Payout queue `pLifeInsurancePayouts[] {fActive, ubSoldierID,
ubMercID, iPayOutPrice}` + `ubNumberLifeInsurancePayoutUsed` (saved after the laptop block if non-zero, `Laptop.cc:3317-3321,
3410-3418`). All in `Laptop/Insurance_Contract.cc`; identical in V.

Helpers (all **UINT32** returns, port with `u32`):
- `contractDaysLeft(s)` (`GetTimeRemainingOnSoldiersContract`, `:1059-1076`): `d = endOfContract/1440 − 1`, `+1` if
  `endOfContract % 1440`, `− day`; capped at `totalContractLength`; a negative value wraps.
- `insuranceDaysLeft(s)` (`:1043-1056`): 0 if uninsured; `total` if `day < start`; else `total − (day − start)`.
- `insuranceLength(s)` (`CalculateSoldiersInsuranceContractLength`, `:1160-1200`): 0 if the profile is dead; 0 if `c < 2 &&
  !(insured && c ≥ 1)` (`c` = contract days left); `len = c − i` if insured or `didGameJustStart`, else `c − i − 1`; then
  `i + len ≤ c`; `len ≥ 0`; 0 if insured, `start ≥ day` and `len < 2`.
- Insurable (`MercIsInsurable`, `:1007-1027`): AIM mercs only, not POW, and `insuranceLength > 0` or already insured; the
  accept button needs `insuranceLength > 0` (`:1030-1040`).

**Premium** (`CalculateInsuranceContractCost(len, profile)`, `:709-775`): 0 under the same `c` test or for a POW;
```
skill = (mkm + med + mech + expl + ldr) / 5                              // profile stats, integer
ratio(v, n) = v > 0 ? clamp(float(n)/v, 0.1f, 10.0f) : 10.0f              // DiffFromNormRatio, :778-804
risk = clamp(ratio(skill, 42) · ratio(p.bLife, 85) · ratio(expLevel, 3) · ratio((INT16)(100 − CalcDeathRate()), 90), 0.1f, 10.0f)
daily = (UINT32)(sSalary · 5 · risk / 100 + 0.5)                          // float multiply/divide, then a double + 0.5
total = daily · len
```
ja2-node: `Math.fround` after each float operation (`ratio`, each product, `·risk`, `/100`), then `+ 0.5` in double and
truncate. No age, claims or other factor.

**Buy or extend** (`PurchaseOrExtendInsuranceForSoldier(s, len)`, `:1082-1148`; the site passes `insuranceLength(s)`, the
contract extension path of `22` passes the contract length):
```
if !insured: s.start = startDay(s); s.startTime = now           // startDay: today if IN_TRANSIT && !didGameJustStart, else tomorrow
cost = premium(len)
if insured: s.start = startDay(s); ledger EXTENDED_INSURANCE −cost           // no balance check
else if balance < cost: "not enough funds" box                               // nothing bought…
else: ledger PURCHASED_INSURANCE −cost; history PURCHASED_INSURANCE; insured = 1
s.totalLength += len                                                          // …but the length is added anyway (quirk)
if insuranceDaysLeft > contractDaysLeft: s.totalLength −= the difference
```
There is no reduce, cancel or refund. **Daily** (`HANDLE_INSURED_MERCS` 13, 00:00; `DailyUpdateOfInsuredMercs`, `:675-698`):
an insured soldier with `day ≠ start`, `insuranceDaysLeft == 0` (u32) and a living profile loses all three fields; no
renewal charge.

### 7.2 Death, payout, investigation

At death (`StrategicHandlePlayerTeamMercDeath`, `Strategic_Merc_Handler.cc:94-112`; `19` §3.8 owns the rest of it), if insured
and **not on the autoresolve screen**: `now ≥ startTime && now − startTime < 60` → `VERY_SUSPICIOUS`; else killed by our
team or `!fEnemyInSector` → `SUSPICIOUS`; then `AddLifeInsurancePayout` (`:835-912`):
```
slot = first inactive among [0, used) (grow the array if needed)
costPerDay = min(sSalary, uiWeeklySalary/7, uiBiWeeklySalary/14)             // current profile salaries
days = (UINT32)(s.totalLength − (day + 1 − s.start)); payout = days · costPerDay
at midnight(1) + 16·60: suspicious || investigations ≥ 2 ? INSURANCE_INVESTIGATION_STARTED (59) : PAY_LIFE_INSURANCE_FOR_DEAD_MERC (14), param slot
used++
```
- `StartInsuranceInvestigation` (`:915-948`): mail `INSUR_SUSPIC` (first) or `INSUR_SUSPIC_2`; length 1 day if very
  suspicious, else `2 + investigations + Random(3)`; `INSURANCE_INVESTIGATION_OVER` (60) at `midnight(len) + 16·60`;
  `investigations++`.
- `EndInsuranceInvestigation` (`:951-967`): very suspicious → mail `INSUR_1HOUR_FRAUD`, no payout, the slot is never freed;
  else mail `INSUR_INVEST_OVER` and pay at once.
- Pay (`:970-997`): clear `usLifeInsurance` if the dead soldier is still on the team; ledger `INSURANCE_PAYOUT +payout`;
  history `INSURANCE_CLAIM_PAYOUT`; mail `INSUR_PAYMENT` only if `ubSuspiciousDeath == 0` (a clean death investigated
  because of the counter gets both mails); `used--`; slot inactive.
- Deaths during autoresolve never set a suspicion (keep).

### 7.3 Florist and funeral

- **Funeral** (`Funeral.cc`): text; sets its bookmark. No logic.
- **Florist** (`Florist_Order_Form.cc`): price = bouquet price (parsed from the localized gallery text, i.e. original data;
  `:641-642`) + the destination's `flowersNextDayDeliveryCost` or `flowersWhenItGetsThereCost` (`shipping-destinations.json`)
  + extras {crushed 10, black roses 20, wilted 10, fruit cake 10} (`:191, 611-655`). Send (`:472-498`): ledger
  `PURCHASED_FLOWERS −price` with **no balance check** (inferred: none found); if the destination's delivery sector is in
  Meduna: `HandleFlowersMeanwhileScene(nextDay ? 0 : 1)` (`Strategic/Meanwhile.cc:693-716`): once per game (meanwhile flag),
  the FLOWERS meanwhile at `now + 60·(20 + Random(5))` or `now + 60·(24 + Random(48))` — a cutscene with no implications
  (inferred; meanwhiles are M6). `uiFlowerOrderNumber += 1 + Random(5)` on entering the form (`:300`) and `+= 1 + Random(2)`
  on sending, both on the main stream: a displayed order number only. ja2-node (M8, U12; `04` §6.33) reads the bouquet
  prices from the gallery text at content load and charges them, draws the first step on `visitSite {site:
  floristOrderForm}` and the second at the end of `orderFlowers`. No NPC, loyalty or opinion effect.

### 7.4 Personnel

Display plus three departed lists (`ubDeadCharactersList`, `ubLeftCharactersList` (fired or POW), `ubOtherCharactersList`,
256 × INT16 each): `StrategicRemoveMerc` adds the profile (`Merc_Contract.cc:628-640`; marriage, `Interface_Dialogue.cc:2466`);
`RemoveNewlyHiredMercFromPersonnelDepartedList` clears the first match on re-hire (`Personnel.cc:1960-1990`, leaves holes).
Nothing else reads them. Money transfers to and from mercs are inventory actions, not laptop ones.

---

## 8. A new game from the start

### 8.1 The original sequence

1. **`InitNewGame`** (`Game_Init.cc:200-277`, `docs/15` §4.2), M5 parts in order: `LoadMercProfiles` (per profile
   `InitProfileFromContent`: status from the text check, medical deposit, gun replacement without gun nut, kit cost; then
   `DecideActiveTerrorists` (draws, M6 placement) and `StartSomeMercsOnAssignment` (§2.2, draws)); `InitAllArmsDealers`
   (`23`, draws); `InitBobbyRayInventory` (§5.2, draws); `InitLaptopAndLaptopScreens` (finances and history cleared,
   `fIMPCompletedFlag`, `fBobbyRSiteCanBeAccessed` false); `InitStrategicLayer`; `SetLaptopNewGameFlag`; the four pre-read
   mails and the I.M.P. intro; starting cash (45000/35000/30000); the M.E.R.C. online day draw; pending screen `LAPTOP`. The
   laptop-wide init (`LaptopScreenInit`: zeroed `LaptopSaveInfo`, `gubLastMercIndex = 5`, the `ENRICO_BACKGROUND` file,
   empty bookmarks) runs at program start or in `ReStartingGame` (`Game_Init.cc:291-354`).
2. **The laptop at Day 1 01:00**, clock paused. The mailbox holds four read mails and the unread I.M.P. intro; A.I.M. is
   bookmarked. The player can: read mail (opening the I.M.P. intro unlocks I.M.P.); hire A.I.M. mercs (money at once;
   arrival Day 1 07:00, shown 07:30); leave messages for away mercs; create an I.M.P. character ($3000; arrival 07:00, the
   letter goes to soldier 0 whoever it is); insure A.I.M. mercs with ≥ 2 days left (start day tomorrow); order flowers;
   visit Bobby Ray's (under construction; the visit arms the "now open" mail); read files, history, finances, personnel.
   M.E.R.C. is not online yet with default policy (`d ≥ 1`). Nothing passes time.
3. **Leaving** (§1.3): the I.M.P. reminder event (if no character yet), the new-game flag clears if someone was hired; the
   map screen at Day 1 01:00, compression X0. Without a hire compression is refused (`atLeastOneMercHired`); the landing zone
   cannot be moved; the laptop can be re-opened (every hire before the landing still arrives at 07:00).
4. **The first compression** → `HandleTimeCompressWithTeamJackedInAndGearedToGo` → start sector load, six-hour warp, arrivals
   at 07:00 (`MercArrivesCallback` × n in hire order), `ENRICO_CONGRATS`, tactical with the helicopter run (`docs/15` §4.5).

### 8.2 ja2-node today and the M5 changes

| Step | Today (`src/sim/campaign/new-game.ts`, `hiring.ts`, `src/server/campaign-factory.ts`) | M5 |
|---|---|---|
| Profile init | profiles come from content, campaign state lazily via `profileProgress` | campaign profile state created at new game (§0) with `InitProfileFromContent` values; `DecideActiveTerrorists` draws (placement stays M6) and `StartSomeMercsOnAssignment` **before** the strategic layer (`docs/15` §4.6 steps 1–2) |
| Dealers, Bobby Ray | absent | `initAllArmsDealers` (`23`) then `initBobbyRayInventory`, before `initStrategicLayerMap` (§4.6 step 3) |
| Laptop init | absent | `LaptopState` (§0): bookmarks [AIM], `gubLastMercIndex = 5`, `ENRICO_BACKGROUND` file, new-game flag, the five mails stamped 1500 |
| Starting cash, M.E.R.C. day | `addStartingCash`, the draw and event | unchanged (after the mails, as in the original) |
| Flow | `strategic` | `laptop` (§1.3) |
| Hiring | `hireMerc(campaign, roster, recruit, content)`: free, any profile, stub soldiers allowed | `aimHire` / `mercHire` / `impCreate` commands on one `hireMercCore` (§2.5); stub soldiers without a profile only in the sandbox |
| `createCampaignSession` | hires `profiles` (default `[0, 3, 4, 7, 14, 16]`) or `mercs` stub soldiers, then `compressTime` | `campaign: {difficulty?, hire?: [{profile, contract?: 1\|7\|14 (default 7), gear?: boolean (default: kit if it has a cost)}], imp?: <impCreate>, land?}`: runs `initNewGame`, then each hire as an `aimHire` command (a refusal, e.g. lack of money, fails session creation with the reason), `impCreate`, `closeLaptop`, and the landing; without `hire` the session stays in the laptop for the agent or UI |
| First landing | `teamJackedInAndGearedToGo` | unchanged, plus the arrival steps of §2.6 and `ENRICO_CONGRATS` |

The default squad must be affordable: with original data six A.I.M. mercs on 1-week contracts with kits can exceed the
medium starting cash; the factory's default becomes a list that is checked against the money (open question §16). The
first-hire draws (`createMercFromProfile`) and every new init draw shift all later draws: new-game tests must pin values
with a scripted RNG (`docs/15` §4.6).

---

## 9. Determinism

### 9.1 Draws

| Site | Stream | Draws (in order) |
|---|---|---|
| New game: `StartSomeMercsOnAssignment` | main | per AIM/MERC profile in id order `Random(100)`, `[Random(6 + exp/2)]` |
| New game: Bobby Ray stock | main | per new slot `max × Random(100)`; per used slot `max × Random(100)`, `[Random(60)]` |
| New game: M.E.R.C. day | main | `Random(max − min + 1)` (exists) |
| `closeLaptop` | main | `[Random(4)]` I.M.P. reminder |
| `aimHire`, `mercHire`, `impCreate` | main (+pre) | soldier creation (`06`); I.M.P.: `Random(k)` attitude, `Random(n)` ×1–2 skills, `PreRandom(100)` helmet |
| Arrival (`MercArrivesCallback`) | main | `[Random(660)]` equipment complaint |
| `MERC_DAILY_UPDATE` profile loop | main + pre | per profile in id order: improvement (`Random(100)` or `Random(10)`,`[Random(100)]`, `Random(n)`…, `PreRandom` per stat chance), `[PreRandom(1000)]` death, `[Random(100)]`, `[Random(6 + exp/2)]` |
| Departure (`StrategicRemoveMerc`) | main | `Random(2)`, `[Random(4)]` hangover, `[Random(6 + exp/2)]` |
| `DAILY_UPDATE_OF_MERC_SITE` | main | `[Random(180)]`, `[Random(100)]` |
| M.E.R.C. account, opening | main | `Random(99999)`; opening `Random(100)`, `Chance(50)`, `Random(4)`, `Random(2)` (Biff), `CoinToss` after a hire |
| Level-up of a hired M.E.R.C. merc | main | `Random(60)` |
| Bobby Ray daily (09:00) | main | new: sells `Random(100)` per unit, reorders `Random(100)`, `[Random(3)]`, `[Random(720)]`; used: sells, reorders `Random(100)`, `[Random(720)]`; then dealers (`23`); restock event `[Random(60)]` |
| Bobby Ray order | main | `[Random(5)]` (Sal dead), `Random(4)` |
| Bobby Ray delivery | main | `[Random(100)]` loss, `[Random(4n)]`, per unit `[Random(100)]`, `[Random(11)]` |
| Insurance | main | `[Random(3)]` investigation length |
| Florist to Meduna | main | `Random(5)` or `Random(48)` |

### 9.2 Wall clock and UI-driven draws, and their replacements

| Original | ja2-node |
|---|---|
| A.I.M. impatience: `GetJA2Clock` escalation, annoyance statuses, `Random(600)` reset event | not simulated; statuses and the event kept for imports (deviation) |
| Speck's opening on a UI timer after the video | runs at the first M.E.R.C. command of a laptop session (§3.6, deviation) |
| `HandleIMPCharProfileResultsMessage` `Random(32767)` on every display (`EMail.cc:1896`) | not drawn; the client picks the paragraph (deviation, cosmetic) |
| Florist order number `Random(5)`, `Random(2)` | not drawn (cosmetic) |
| HD light flicker `Random(2)` per 50 ms of page loading (`Laptop.cc:2404`), ad rotation, page load waits, blinking | client only |
| Bobby Ray "ship to X?" box, cart kept across pages | the command carries the order; no prompt |
| Arrival rerouted / landing zone reset message boxes | events (`arrivalRerouted`, `landingZoneReset`), no prompt |
| `ubShipmentsSinceNoBribes` function static (not saved) | saved state (deviation; the original keeps it across loads and new games of one process, seen in the oracle) |

---

## 10. Agent API (D15, D16)

**Commands.** Map screen (`strategic` flow): `openLaptop`; `setLandingZone {sector}` (§2.6 rules; refused before the first
landing, underground, `GROUNDBARRIER`, enemy airspace). Laptop flow only (each answers `ok` or a reason; no prompts):

| Command | Semantics | Refusal reasons |
|---|---|---|
| `closeLaptop` | §1.3 | — |
| `visitSite {site: bobbyRay\|merc\|funeral\|florist\|insurance\|floristOrderForm}` (M8) | §1.3; data `{site, bookmarks, speck?, orderNumber?}` (`speck`: the opening's quote ids, §3.6; `floristOrderForm` draws the order number step of §7.3, U12) | `badSite`, `noBookmark`, `siteDown` |
| `readEmail {id}` / `deleteEmail {id}` | §6.1 (bookmarks on reading) | `noSuchMail` |
| `aimHire {profile, contract: 1\|7\|14, gear?: boolean}` | contact + `CanMercBeHired` + §2.5; result: charge breakdown, soldier id, arrival `{minute, shownMinute, sector}`, the acceptance quote `{id, name}` or null | `notAimMerc`, `badContract`, `noKit` (gear on a 0-cost kit), `unavailable` (annoyed), `away` (answering machine: dead/hired/away/returning/POW), `hangover`, `hatesTeammate {hated}`, `deathRate`, `reputation` (the four with `quote {id, name}`), `funds {charge}`, `teamFull`, `cannotHire` |
| `aimLeaveMessage {profile}` | answering machine: `PLAYER_LEFT_MSG` | `notAway`, `alreadyLeft` |
| `mercOpenAccount` | §3.1; data: the account number | `siteDown`, `noBookmark`, `hasAccount` |
| `mercHire {profile}` | §3.3 | `noAccount`, `accountSuspended`, `accountInvalid`, `notListed`, `unavailable`, `teamFull`, `cannotHire`, `siteDown`, `noBookmark` |
| `mercPay` | §3.4; data `{paid, full}` | `nothingOwed`, `funds`, `siteDown`, `noBookmark` |
| `impCreate {code, name, nickname?, gender, answers[16] or skills[], attributes{health, agility, dexterity, strength, wisdom, leadership, marksmanship, medical, mechanical, explosives}, portrait, voice}` | §4.4; data: soldier, profile, skills, personality, attitude, arrival | `noBookmark`, `badCode`, `noSlot`, `funds`, `teamFull`, `badName`, `badAnswers`, `badSkills`, `badAttributes`, `badPortrait`, `badVoice`, `cannotHire` |
| `bobbyRayOrder {lines: [{item, used?, quantity}], destination, speed: 0\|1\|2}` | cart rules + §5.4 (atomic; the order is also a visit of the site); data: the quote and the shipment index | `siteClosed`, `noLines`, `tooManyLines`, `notInStock`, `noDestination`, `badSpeed`, `funds` |
| `insure {soldier}` | §7.1 with `insuranceLength`; data `{length, cost, insuredDays}` | `notInsurable`, `funds` |
| `orderFlowers {bouquet: 0–9, destination, nextDay, extras: crushed\|blackRoses\|wilted\|fruitCake}` | §7.3; data `{price, orderNumber}` (M8, U12) | `noSuchBouquet`, `noDestination`, `badExtra` |
| `readFile {code}` (M8, U12) | §6.4 | `noSuchFile` |

`openLaptop` is refused with `laptopOpen`, `mapScreenOnly`, `promptOpen`, `battlePending` or `renewalSequence`;
`setLandingZone` with `mapScreenOnly`, `badSector`, `beforeFirstLanding`, `groundBarrier` or `enemyAirspace`. While the
laptop is open every other command answers `laptop: the laptop is open, closeLaptop first` (also `advance`'s refusal);
laptop commands sent while it is closed answer `laptopClosed`.

**Events** (in `advance` reports): `laptopOpened`, `laptopClosed`, `mercHired {site, profile, soldier, arrivalMinute,
sector}`, `mercArrived {soldier, profile, sector}` (stops compression), `arrivalRerouted {from, to}`, `landingZoneReset
{from, to}`, `emailReceived {id, mail, sender}`, `historyAdded {code, profile, sector}`, `moneyChanged {code, amount,
balance}`, `mercAccountStatus {status}`, `bobbyRayOpen`, `shipmentDelivered {shipment, sector, items, stolen}` (stops
compression), `shipmentLost {shipment, reason: crashed|prevented|enemyHeld}`, `insurancePaid {profile, amount}`;
departures are `22`'s. Silent profile changes (a merc back home, away, dead
on another job without a mail, the M.E.R.C. outage) raise no event: they are visible in the view when the player looks,
which costs no time.

**Observation** (`PlayerView.laptop`, only what the screens show): balance; `newMail`; mails (id, type, offset, length,
the rendered subject, sender, date, read, data); history and finance records (finance rows with their rendered `text`) and
`financeSummary` (§6.3); files; bookmarks; personnel lists; A.I.M. (per profile 0–39 in the order of
`mercs-AIM-listings.json`: nickname, the AIM page stats, salaries for 1/7/14 days, medical deposit when required, kit items
and cost unless already bought, face state `available | hired | dead | pow | onAssignment`, `contact` (the conference mode
`firstContact | answeringMachine | unavailable`, `WillMercAcceptCall`) and `messageLeft`); M.E.R.C. (online, account status and number, listed mercs with stats,
daily fee and state, debt per merc and total); I.M.P. (reachable, characters left, cost); Bobby Ray (open, new and used
stock with price, quantity, used quality; shipments with destination, speed and order day as on the shipments page);
insurance (per insurable merc: contract days left, insured days left, offered length and premium; M8 adds the nickname,
the dead flag and the contract length, and `aimMercsOnTeam`); in-transit mercs with `timeSoldierWillArrive` and the
landing zone. M8 (U12, `04` §6.33) adds the history rows' rendered `text`, `location` and `questInProgress`, the
personnel blocks (`personnel.current` and `personnel.departed`) and `florist {orderNumber, bouquetPrices}`. **Hidden**: `dayBecomesAvailable`, hangover days, tolerances (`bDeathRate`,
`bReputationTolerance`), hated/buddy lists and hated times, the current death rate and reputation, unhired deaths and
improvements before they show, the restock state (`onOrder`, `fPreviouslyEligible`, pending restock events), theft counters
and Pablo facts, investigation outcomes, the outage roll, every queued event.

**Queries**: `aimQuote {profile, contract, gear}` (amount breakdown, affordability); `hireCheck {profile}` (M8: the
check the conference makes at HIRE, before the contract page and the funds: `{profile, contact, accepted, refusal?, quote:
{id, name} | null, hated?}`, `refusal` `unavailable` or `away` from the contact mode, else `CanMercBeHired`'s; quote ids
from `Dialogue_Control.h`: 82, 86/87/88, 81, 80, on acceptance 92/93/94 or 113/114); `emailText {id}` (M8: `{id, subject,
paragraphs}`: the subject and the body records of `email.edt` with `$MERCNAME$`/`$AMOUN$` filled in where the original
fills them, the I.M.P. report assembled from `impass.edt` for the mail's profile, Ian codes kept; refusals `noSuchMail`,
`noText`); `bobbyRayQuote {lines, destination, speed}` (subtotal, weight, shipping, total); `insuranceQuote {soldier}`;
`impPreview {answers, gender}` (skill/attitude/personality lists, no draws); `arrivalTime` (`GetMercArrivalTimeOfDay` for
now).

---

## 11. Data tables and stubs

**Use directly** (`data/externalized/`): `mercs-profile-info.json` (types), `mercs-MERC-listings.json` (order, unlock
thresholds, Speck quote ids), `mercs-AIM-listings.json` (display order; bios are original text), `imp.json`, `game.json`
(`imp.*`, `merc_online_*`, `starting_cash_*`, `unhired_merc_deaths_*`, `pablo_wont_steal`, `campaign.start_sector`),
`bobby-ray-inventory-new.json`/`-used.json`, `shipping-destinations.json` (rates, flower costs, delivery flags, sectors,
gridnos, mail offsets), `items.json`/`weapons.json`/`magazines.json`/`armours.json` (price, weight, coolness, per pocket,
flags, standard replacements).

**Transcribe** (`tools/transcribe/*.ts` → `data/tables/`, regenerate, never edit):

| Table | Source | Generator |
|---|---|---|
| `laptop-mail.json`: mail offsets and lengths (enum arithmetic), sender ids | `Laptop/EMail.h:15-166` | `laptop-mail.ts` (`c-source.ts` `sequentialEnum` + defines) |
| `history-codes.json` | `Laptop/History.h` | `history-codes.ts` |
| `imp-quiz.json`: answers per question, the 16 × 8 effect table, the skill-page map | `IMP_Personality_Quiz.cc:248-257, 424-562`, `IMP_SkillTraits.cc:48-63` | `imp-quiz.ts` |
| `dealer-items.json`: `DealerItemSortInfo` categories with used-sale flags, the ALWAYS staples (shared with `23`) | `Tactical/ArmsDealerInvInit.cc:33-58, 98-128` | `dealer-items.ts` |
| Merc status, account status, insertion codes, contract types | headers quoted in §2–§3 | named constants with `@src`, not tables |

Scalar constants stay named constants under the SFI-SCLA header: arrival slots and `MIN_FLIGHT_PREP_TIME`, team limit 18,
`MAX_NUMBER_MERCS 40`, `DAYS_TIL_M_E_R_C_AVAIL 3`, the 7/9/12 thresholds, `COST_OF_PROFILE 3000`, the attribute start 55, the
75 big-body strength, salary rounding steps and caps, insurance bases and limits, Bobby Ray chances, delays, weights and
limits, theft and damage numbers, gridnos 1/2, the flower extras.

**Imported from the user's data, never committed**: the `prof.dat` fields of §0; the bouquet prices (florist gallery text,
read at content load since M8);
mail, file and bio texts (presentation; the client reads them from the VFS).

**Stubs** (CI has no `prof.dat`): the stub pack gains an authored profile table in the canonical model (invented names and
values): ≥ 4 A.I.M. profiles at ids 0–3 (salaries, deposit flags, inventories, tolerances, one buddy and one hated pair, one
with `bDeathRate 101`), 2 M.E.R.C. profiles at 40–41, empty I.M.P. slots, and the NPC profile `SAL`/`PABLO` stand-ins only
if their facts are exercised; authored bouquet prices (an invented `flowerdesc.edt` since M8); no texts. `loadTacticalContent` uses it when `prof.dat` is absent,
so `aimHire` runs on stubs. Bobby Ray, I.M.P. gear and the letter use the externalized item tables (available on stubs).
Delivery needs no map when the airport sector is not loaded (`sector-loot.ts`).

---

## 12. Minimal M5 implementation (laptop and hiring)

**Modules** (`src/sim/campaign/laptop/` unless noted, DOM- and Node-free, SFI-SCLA header):
1. `src/content/formats/prof.ts`: the missing fields (§0); `src/content/campaign/laptop-content.ts`: the JSON and tables of
   §11.
2. `profile-state.ts`: campaign profile state (extends `ProfileProgress`), `initProfileFromContent` (deposit with the
   `pow(·, 0.2)` table, kit cost), `isMercHireable`, `calcNewSalary`.
3. `laptop-state.ts`: `LaptopState` (§0) in `StrategicState.laptop`; `mail.ts`, `history.ts`, `files.ts`, `personnel.ts`.
4. `hire.ts`: `hireMercCore` (= `HireMerc`), `getMercArrivalTimeOfDay`, the landing zone, `checkForValidArrivalSector`,
   `mercArrivesCallback` (replaces `hiring.ts` `hireMerc`/`mercArrives`; `teamJackedInAndGearedToGo` stays),
   `calculateMedicalDepositRefund` (called by `22`'s `strategicRemoveMerc`).
5. `aim.ts`: contact, `canMercBeHired`, prices, `aimHire`, leave message, `startSomeMercsOnAssignment`, the profile loop of
   `MercDailyUpdate` with `handleUnhiredMercImprovement`/`Deaths` (`ProfileStatChange` from `11` §10).
6. `merc-site.ts`; `imp.ts`; `bobby-ray.ts` (inventory with the shared dealer chance code of `23`, orders, delivery,
   restock events); `insurance.ts`; `florist.ts`.
7. `flow.ts` + `commands.ts`: `openLaptop`/`closeLaptop`, the laptop flow in `CampaignSim` (clock frozen, `advance` refused),
   the command table of §10; `registerLaptopEvents` for kinds 6, 7, 8, 9, 10, 11, 12, 13, 14, 19, 20, 59, 60, 64, 74, 77, 78.
8. `src/server/laptop-view.ts` + `protocol` + MCP schema: the view and queries; `campaign-factory.ts` through the laptop.
9. `src/content/formats/savegame-laptop.ts` + `save-import.ts`: section 4 (laptop info, Bobby Ray inventories, insurance
   payouts), the shipments section, sections 7–10 (finances exist; history, files, email), the profile and soldier fields.

**Status (2026-10-16)**: (a)–(l) are implemented. Module names differ slightly from the list above: the content is
`src/content/strategic/laptop-content.ts` with the transcribed `data/tables/laptop.json` (`tools/transcribe/laptop.ts`:
mail offsets and lengths, senders, the quiz, named profiles, terrorists); history, files and personnel live in
`records.ts`, mail in `mail.ts`, the flow and command table in `laptop-flow.ts`; the profile loop of `MercDailyUpdate`,
the medical refund and level-ups were already `22`'s. The facts are the full 500-entry narrative store
(`src/sim/campaign/narrative/facts.ts`, with 30 quest states), imported from saves. The new game also ports `InitNPCs`
(the placement draws and alternate maps), so the M.E.R.C. day draw is in the original's place; undeclared profiles
(51–56, 165–169) are empty structs as Stracciatella makes them. The oracle (§14) matches three new games, the arrival
table and the save probes.

**Order of work**: (a) profile fields and content; (b) laptop state, mail, history, files, flow and `openLaptop`/
`closeLaptop`; (c) `hireMercCore`, A.I.M. pricing, refusals and `aimHire`, arrival, landing zone, medical refund hook;
`createCampaignSession` via the laptop (stubs: the authored profiles); (d) new-game profile init draws and the daily
availability loop; (e) M.E.R.C.; (f) I.M.P.; (g) Bobby Ray (after `23`'s dealer init, to keep the new-game draw order);
(h) insurance; (i) florist, personnel, the Enrico mails and the history writers in mines/battles; (j) view, queries,
MCP; (k) save import; (l) oracle probes (§14).

---

## 13. Tests

Unit (scripted RNG where draws occur):
- `getMercArrivalTimeOfDay` for every hour 0–23; first-squad arrival 07:00 with `timeSoldierWillArrive` 07:30 and contract
  end at 07:00 of Day 1+n; later hires: event stamps, `endOfContract` at hire and its recomputation at arrival.
- Prices: contract amount per length with/without deposit and kit; `calcMedicalDeposit` on authored profiles (hand-computed
  doubles, including `exp` 1 and 10 for the fifth-root table); kit cost per slot (not count); `calcNewSalary` across every
  rounding band, the caps and the floor.
- `aimHire`: the refusal order of §2.5 (hangover beats buddy; tolerated hated time ≥ 24; buddy skips death rate and
  reputation; death rate wrapping at 256; reputation threshold; funds before team size); ledger records and balance;
  `ALREADY_USED_ITEMS`, kit cost zeroed, the Nails jacket, the letter for soldier 0 at game start; `HIRED_BUT_NOT_ARRIVED_YET`.
- Landing zone: legality rules, `checkForValidArrivalSector` scan order and the row-P exclusion, airspace reset,
  start-sector enemy elimination.
- Medical refund: full, partial rounding (`(2·d·l/L + 1)/2`), dead, POW, no deposit.
- Daily profile loop: countdown and reset (also from `RETURNING_HOME`), the reply mail, the away roll only on days that
  started available, the AIM/MERC chance split by id, improvement short-circuit draw counts, unhired deaths with the cap
  and `PLAYER_HAD_CHANCE_TO_HIRE`.
- M.E.R.C.: unlock prefix and the per-midnight event repost; the 7/9/12 thresholds with the `!=` regressions; greedy
  payment and its status effect; departures when invalid; outage preconditions.
- I.M.P.: quiz compile table, attitude tie draw, validation with swap-removal order, both skill modes, body type, attribute
  cost validation, gear rules with a scripted `PreRandom`, ledger, the results-mail event.
- Bobby Ray: list building and sort order, initial stock, suitability windows, reorder with the `Random(3)` cases and the
  immediate restock for newly eligible items, the used restock bug, used price rounding, shipping float math, delivery hour,
  loss/delay/prevented paths, theft per unit (loaded vs unloaded), damage compounding, the size facts.
- Insurance: length and premium (float steps) for hand-computed cases, the "length added although refused" quirk, daily
  expiry, payout amount, investigation paths and mails.
- Laptop flow: `advance` refused; `openLaptop` stops compression; the I.M.P. reminder on each exit until a hire.

Scenario (stubs, headless): new campaign in the laptop → `aimHire` ×2 (one refused for funds after a large hire) →
`closeLaptop` → land at 07:00 → `advance` 6 days → a M.E.R.C. hire after Speck's mail is read → `advance` past 12 days unpaid
→ the merc leaves → `mercPay`; identical event logs under the instant and manual drivers and for two sessions with one seed.

Original data (`describe.skipIf(!process.env.JA2_DATA_DIR)`): `prof.dat` fields parse for all 170 profiles; computed
medical deposits and kit costs equal the oracle's (§14); the six user saves import the laptop sections (balance equals
`iCurrentBalance`, Bobby Ray stock counts, M.E.R.C. account fields, mail count, contract fields of every hired merc).

---

## 14. Oracle probes

**As built** (`tools/oracle/patches/0010-laptop-oracle.patch`, `probes/laptop.txt`, `laptop-compare.ts`): `newgamefull
{difficulty, gunnut, scifi}` (after `seed`: `resetMercProfileStructs`, mails and laptop reset, the traced `InitNewGame`; the
laptop, all 200 profiles and the terrorists), `arrival`, `laptop {range|who}`, `setbalance {amount}`, `setfact {id, value}`,
`aimhire {profile, contract, gear}` (the headless `CanMercBeHired` quote and `AimMemberHireMerc`), `mercaccount`, `merchire
{profile}`, `mercpay {index}`, `bobbyrestock`, `bobbyfresh {param}`, `bobbyorder {lines=item:count[:used],…, dest, speed}`,
`bobbydeliver {index}` (facts and the items at the delivery gridnos), `insure {who, buy}`, `insuranceday`, `payout {who,
suspicious}`, `insurancestep {slot, step=start|end|pay}`, `impcreate {gender, answers, attrs, portrait, voice, name, nick}`.
Every probe dumps the laptop, the team's contract fields and inventories and the selected profiles; the comparer replays
the traced draws (dropping the cosmetic face and first-frame draws) and diffs all of it. The plan as first written:

New commands in `tools/oracle/src/Oracle.cc` (outputs derive from original data: keep them in `~/ja2-oracle`), a
`laptop-compare.ts` beside `economy-compare.ts`, and a patch `0006-laptop-oracle.patch` exposing the static helpers
(`CalcCompetence`, `CalcMedicalDeposit`, `CanMercBeHired` without its face calls as `OracleAimHireDecision(profile)` →
quote id, `GetMercArrivalTimeOfDay`, `CalculateSoldiersInsuranceContractLength`, `CalculateInsuranceContractCost`,
`CalcBobbyRayCost`, `CalcCostFromWeightOfPackage`, `CompileQuestionsInStatsAndWhatNot`, the attitude and skill routines):

| Probe | Does | Compared with |
|---|---|---|
| `profiles` | per profile 0–199: status, countdown, hangover, salaries, deposit flag and amount, `CalcCompetence`, kit cost, misc flags, cost to date, M.E.R.C. days, tolerances | ja2-node profile init on the same data |
| `laptop` | `LaptopSaveInfo` (all logic fields), mails, history, finance ledger, files, bookmarks, Bobby Ray lists, shipments, insurance payouts | save import |
| `newgame full=1 difficulty= gunnut=` | `InitNewGame` minus the screen switch, draws traced (`draws on`) | `initNewGame` replayed with the traced draws (profile statuses, Bobby Ray stock, then the existing strategic dump) |
| `aimhire profile= length= gear=` | decision quote, amount, `HireMerc`, transactions, history, soldier contract fields, the queued event | `aimHire` on the imported save |
| `merchire profile=`, `mercpay`, `mercdaily` | the M.E.R.C. paths and `DailyUpdateOfMercSite` with draws traced | same commands |
| `mercdaily`/`warp` across 00:00 | `MercDailyUpdate` profile loop with draws traced, profile dump after | the loop with scripted draws |
| `arrival` | `GetMercArrivalTimeOfDay` at each hour (sets the clock) | table test |
| `bobbyray restock` / `bobbyorder lines= dest= speed=` | daily update with draws; totals, shipment, event; then `warp` to the delivery and the sector items | `bobby-ray.ts` with replayed draws |
| `insure who=` / `kill who= enemy=0\|1` | length, premium, purchase; death → payout slot, events | `insurance.ts` |
| `imp gender= answers= attrs= portrait= voice=` | the compile and confirm with draws traced, profile and soldier dump | `impCreate` with replayed draws |

The six saves (B13, C13, D13, early Drassen: the airport is ours, Bobby Ray is open, A.I.M. contracts are running) cover
import, `aimhire` and `bobbyorder` without a new game. A full `newgame` needs `InitNewGame` to run headless (it touches
laptop init and mails, inferred safe).

---

## 15. Quirks to keep, deviations to log, verified vs inferred

**Quirks to keep** (Strac behaviour; V where marked):
- The first squad's displayed arrival is 07:30, the real one 07:00; the contract-end hour comes from the displayed time.
- The contract end is recomputed at arrival from the arrival day (a same-day 13:30 arrival ends at 13:00).
- `CheckForValidArrivalSector` never chooses row P (`< 289`), and the distance is a truncated `hypot`.
- M.E.R.C. hires use insertion `NORTH`, A.I.M. and I.M.P. `ARRIVING_GAME`.
- `HIRED_MERC` records salary + kit, `MEDICAL_DEPOSIT` the deposit; the deposit is refunded from the *paid* amount, the
  partial refund rounds half up, the dead get a mail with the deposit as amount and no money.
- `CalcDeathRate` wraps at 256; buddies override death rate and reputation; a hated merc with hated time ≥ 24 is tolerated.
- `MERC_HAS_NO_TEXT_FILE` is overwritten for every AIM/MERC profile at new game; I.M.P. characters carry status −1 on the team.
- The away roll uses `id < 40` for the AIM chance and ignores `FIRED_AS_A_POW` (such a merc can come back through it); the
  countdown's end sets `MERC_OK` from any non-POW status.
- Kit cost ignores stack counts; buying the kit zeroes it for good.
- Strac's Nails leather jacket on no-kit hires (not in V).
- M.E.R.C.: the new-merc event is reposted every midnight while eligible; the `!=` status tests can move suspended back to
  warning; re-hiring erases unpaid days; a dead merc's unpaid days stay owed.
- I.M.P.: the helmet test is `wisdom ≥ PreRandom(100)` (Strac data); `Random(k)` is drawn for a single winning attitude;
  swap-removal reorders the skill list before the draws; the too-many-mercs return counts as success.
- Bobby Ray: Strac's JSON rates (Drassen 200/100/50; V 500/200/100; Hong Kong standard 300, V 30) and used caps (22 items
  copy the new amount; V 1) are kept per D1; the slot-0 reuse bug, the Meduna loop bound, the used restock without the
  +1000 offset, reloaded guns in recreated stacks, money taken for non-delivering destinations, deliveries on the hour.
- Insurance: the length is added even when the purchase was refused; extensions have no balance check; autoresolve deaths
  are never suspicious; a fraud slot is never freed.

**Deviations to log in `docs/deviations.md`** (logged in M5, with "Cosmetic face and frame draws", "Florist prices" and
the amended contract, death, economy and dealer rows; the `docs/15` §2.7 fix is still open):
- *A.I.M. annoyance*: the wall-clock impatience and its statuses are not simulated (kept for imports).
- *Speck's opening*: run at the first M.E.R.C. command of a laptop session instead of after a UI timer.
- *Cosmetic laptop draws*: I.M.P. results mail paragraph `Random(32767)`, florist order number, page-load flicker: not drawn.
- *I.M.P. empty skill list*: `NO_SKILLTRAIT` instead of the stale `L[0]` of `Random(0)`.
- *Laptop as commands*: no cart, no confirmation boxes, one `impCreate` instead of the page sequence; the laptop is a flow.
- *Speck payment second code*: the first paid listing's profile instead of the last viewed page's.
- *Bobby Ray theft counter*: saved instead of a function static.
- Remove the row "Experience level-up side effects" once §3.5 lands; amend "Merc death and capture stand-ins" (insurance,
  M.E.R.C.) and "Strategic economy stand-ins" (Bobby Ray, contracts and RPC salary) as their parts land.
- Fix `docs/15` §2.7: Bobby Ray deliveries are at 08:00–11:00 on the hour.

**Verified** by reading Strac (V where marked): `HireMerc`, `MercArrivesCallback`, `GetMercArrivalTimeOfDay`,
`CheckForValidArrivalSector`, the landing-zone rules, `AimMemberHireMerc`, `DisplayMercChargeAmount`, `WillMercAcceptCall`,
`CanMercBeHired`, `HandleMercAttitude`, `ResetMercAnnoyanceAtPlayer`, `CalcDeathRate`, the tolerance checks,
`InitProfileFromContent`, `CalcCompetence`, `CalcMedicalDeposit`, `StartSomeMercsOnAssignment`, `MercDailyUpdate`'s profile
loop, `HandleUnhiredMercImprovement`/`Deaths`, `CalcNewSalary`/`RoundOffSalary`, `StrategicRemoveMerc`,
`CalculateMedicalDepositRefund`, the laptop enter/exit/HandleExit and `AllowedToExitFromMapscreenTo`, `InitNewGame`,
`DailyUpdateOfMercSite`, `ScheduleNewMercsToBeAvailable`, `CanMercBeAvailableYet`, `MercFilesHireMerc`,
`SettleMercAccounts`, the I.M.P. confirm, Bobby Ray's order delay, event, prices and shipping cost, the insurance premium,
purchase, length, daily update, payout and investigation, the florist send. Through the parallel source reads behind this
spec (traced, re-checked only where quoted): the I.M.P. quiz table, attitude, skill and gear rules; Bobby Ray's list
building, chances, restock and delivery; the mail catalogue and history writers.

**Inferred**: that the map screen (and thus the laptop) is reachable in a tactical battle; the "stale value" cases of a
restart in one process (M.E.R.C. index, Bobby Ray progress, I.M.P. `L[0]`); that `CalcDeathRate`'s float never rounds across an
integer; that the attribute page reaches exactly the sets accepted by §4.4; the used-restock bug's effect; that I.M.P. mercs
are never paid; that the florist has no balance check; that the FLOWERS meanwhile has no implications; that
`InitNewGame` runs headless in the oracle.

---

## 16. Open questions

Decided for M5 (2026-10-16): 1 — the default squad is what the starting cash pays for, hired through the real A.I.M. path;
2 — Speck's opening runs at the first M.E.R.C. command of a laptop session; 3 — the annoyance is dropped; 4 — Strac's JSON
is kept; 5 — the full 500-fact store now (`state.narrative`); 6 — prices that are only original text are omitted; 7 — the
history writers in mines, towns and battles come with M5.

1. **Default campaign squad.** With original data the current default (six A.I.M. profiles) may not be affordable on 1-week
   contracts with kits; pick a cheaper default, shorter contracts, or require `hire` explicitly.
2. **Speck's opening timing**: is "first M.E.R.C. command per laptop session" acceptable, or should `mercVisit` be an
   explicit command (the agent decides when the draws happen)?
3. **A.I.M. annoyance**: drop it entirely (current proposal), or model it as an explicit `aimHangUp` count?
4. **Bobby Ray JSON vs vanilla**: keep Strac's shipping rates and used caps (D1) or treat them as data errors (deviation)?
5. **Fact flags before M6**: Bobby Ray's Pablo and Kulba facts, Sal's death and the flowers meanwhile need a facts table;
   whether `16`/`19`'s `state.battle.quests` grows into the M6 facts store now or a laptop-local stand-in is used.
6. **Florist prices** come from original text: import them into content (`laptop-content.ts`) or keep the florist UI-only
   until M7 strings?
7. **History writers outside the laptop** (mines, battles, quests, Enrico): add them in M5 with the log, or when each
   owner is touched?
