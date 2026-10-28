# 21 — The laptop and hiring: A.I.M., M.E.R.C., I.M.P., Bobby Ray's, email, history, finances, insurance

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless they start with `externalized/` (then
`reference/stracciatella/src/externalized/`); `V:` is vanilla `Build/`; JSON files are `assets/externalized/*.json`
(copied to `data/externalized/`). "(inferred)" marks conclusions not traced end to end. C integer semantics apply: `/`
truncates toward zero (`idiv`), `UINT8`/`INT8`/`INT16`/`UINT16` stores wrap (`u8`, `i8`, `i16`, `u16`). `Random` = `main`
stream, `PreRandom` = `pre` stream (`01` §3.6); `Random(0)` returns 0 without drawing; `Chance(x)` is `Random(100) < x`.
Times are game minutes (`GetWorldTotalMin`) unless marked; "Day d hh:mm" is minute `d·1440 + hh·60 + mm`; `midnight(n)` is
`GetMidnightOfFutureDayInMinutes(n) = now + n·1440 − minutesInDay` (`Strategic/Game_Clock.cc:150-153`). "Policy" values
are Stracciatella defaults from `game.json`. Profile ids follow `mercs-profile-info.json` (types `AIM` 0–39, `MERC` 40–50,
`IMP` 51–56, RPC/NPC above); internal names such as `BIFF` or `NAILS` are the Stracciatella source names. No profile
statistics are quoted: they live in the user's `prof.dat`.

**Scope.** This doc owns the laptop as game logic (`Laptop/*.cc`: A.I.M., M.E.R.C., I.M.P., Bobby Ray's, email, history,
files, insurance, florist, funeral, the personnel lists), `HireMerc`, `GetMercArrivalTimeOfDay`, `MercArrivesCallback`, the
landing zone, `StartSomeMercsOnAssignment`, the medical deposit refund and the laptop parts of `InitNewGame`. Elsewhere:
`22` contract fields, renewal, departures (`StrategicRemoveMerc`), the daily merc update (`MercDailyUpdate` with the
unhired-profile loop), salary growth, `CanMercBeHired` and the tolerances, RPC pay; `23` arms dealers and the dealer stock
code Bobby Ray's shares; `15` the clock, the event queue, `InitNewGame`/`InitStrategicLayer`; `16` squads, groups,
`UpdateMercInSector`, airspace; `18` §3.9 the finance ledger and the hourly update; `19` §3.7 merc death and
capture; `25` facts, quests, NPC actions (Kulba, Pablo, `DecideActiveTerrorists`); `26` meanwhile scenes; `14` the save
layout; `28` §9 the laptop's pages (client); `04` §6 the agent API (laptop commands, queries, view and events).

---

## 0. State

**`StrategicState.laptop`** (`LaptopState`, `src/sim/campaign/laptop/laptop-state.ts`): the original's `LaptopSaveInfo`
(`Laptop/LaptopSave.h:84-143`, save section 4) plus the mail, history and files temp files and a few general-info fields.

| Group | Original → ja2-node | § |
|---|---|---|
| Flow | `gfNewGameLaptop` → `newGameLaptop`; `fNewMailFlag` (general info) → `newMail`; the laptop screen → `StrategicState.flow = 'laptop'`; `StrategicState.atLeastOneMercHired` | §1 |
| Money | `iCurrentBalance` and the ledger → `StrategicState.finances` | §6.3 |
| Records | `emails` (+ `nextEmailId`), `history`, `files` (save sections 10, 8, 9) | §6 |
| Personnel | `ubDeadCharactersList`, `ubLeftCharactersList`, `ubOtherCharactersList` (256 × INT16, −1 = empty) → `personnel.{dead, left, other}` | §7.4 |
| M.E.R.C. | `merc`: `gubPlayersMercAccountStatus`, `guiPlayersMercAccountNumber`, `gubLastMercIndex`, `ubLastMercAvailableId`, `uiTotalMoneyPaidToSpeck`, `fMercSiteHasGoneDownYet`, `fFirstVisitSinceServerWentDown` (0/1/2), `fNewMercsAvailableAtMercSite`, `ubPlayerBeenToMercSiteStatus`, `uiSpeckQuoteFlags`, `ubSpeckCanSayPlayersLostQuote`, `fSaidGenericOpeningInMercSite`, `fSpeckSaidFloMarriedCousinQuote`, `fHasAMercDiedAtMercSite`; ja2-node adds `mercSiteOpenedThisSession` (§3.6) | §3 |
| I.M.P. | `imp`: `fIMPCompletedFlag`, `fSentImpWarningAlready`, `iVoiceId`, the slot states (save section 5, v104+) as `taken`, the created profiles and their voices | §4 |
| Bobby Ray | `bobbyRay`: `fBobbyRSiteCanBeAccessed`, `ubHaveBeenToBobbyRaysAtLeastOnceWhileUnderConstruction` (`underConstructionVisit`), `BobbyRayInventory[]`/`BobbyRayUsedInventory[]` (`inventory`, `used`), the shipments, `shipmentsSinceNoBribes` | §5 |
| Insurance | `pLifeInsurancePayouts[]`, `ubNumberLifeInsurancePayoutUsed` → `insurance.{payouts, used}` | §7.1 |
| Florist | `uiFlowerOrderNumber` → `floristOrderNumber` | §7.3 |
| Landing zone | `g_merc_arrive_sector` (`Tactical/Merc_Hiring.cc:46`; general info, `SaveLoadGame.cc:1923-1924`, the start sector on load, `:2081`) → `mercArriveSector` | §2.6 |
| Bookmarks | `iBookMarkList[20]` (−1 terminated) → `bookmarks` (`Bookmark`: AIM 0, BOBBYR 1, IMP 2, MERC 3, FUNERAL 4, FLORIST 5, INSURANCE 6); A.I.M. is set on every laptop entry (`Laptop/Laptop.cc:519`) | §1.4 |
| Hire popup | `sLastHiredMerc` → `lastHiredMerc {profile, arrival}` | §2.5 |
| UI only (not simulated) | `fVisitedBookmarkAlready[]`, `iCurrentHistoryPage`, `iCurrentFinancesPage`, `iCurrentEmailPage` | — |

**Strategic status** (`StrategicState.status`, `src/sim/strategic/ai/queen-state.ts`): `badReputation`
(`ubBadReputation`), `manDaysPlayed`, `mercDeaths`, `unhiredMercDeaths`, `insuranceInvestigations`
(`ubInsuranceInvestigationsCnt`), `highestProgress`.

**Profiles, campaign-mutable** (`gMercProfiles`, save section 5 → `StrategicState.profiles`, `ProfileProgress` in
`src/sim/tactical/profiles.ts`; `prof.dat` offsets `Tactical/LoadSaveMercProfile.cc:36-212`, read by
`src/content/formats/prof.ts`): `mercStatus` (`bMercStatus`, INT8, §2.1), `dayBecomesAvailable`
(`uiDayBecomesAvailable`, a day *countdown*, not a date), `daysOfMoraleHangover` (`ubDaysOfMoraleHangover`), `miscFlags`
(`ubMiscFlags`: `ALREADY_USED_ITEMS 0x80`), `miscFlags3` (`ubMiscFlags3`: `PLAYER_LEFT_MSG_FOR_MERC_AT_AIM 0x01`,
`PLAYER_HAD_CHANCE_TO_HIRE 0x04`, `MERC_MERC_IS_DEAD_AND_QUOTE_SAID 0x20`), `precedentQuoteSaid`, `salary` (`sSalary`
INT16), `weeklySalary`, `biWeeklySalary` (UINT32), `medicalDeposit` (`bMedicalDeposit`, flag from data),
`medicalDepositAmount` (`sMedicalDepositAmount` UINT16, computed, §2.4), `optionalGearCost` (`usOptionalGearCost` UINT16,
computed, zeroed once the kit is bought), `totalDaysServed`, `mercMercContractLength` (`iMercMercContractLength`, §3),
`suspiciousDeath` (`ubSuspiciousDeath`, §7.2), `balance` (`iBalance`, RPC pay, `22`); read-only from `prof.dat`:
`bDeathRate`, `bReputationTolerance`, `bHatedTime[2]`, the learn-to-hate/like counters. `uiTotalCostToDate` is
`finances.profileCostToDate`.

**Soldier contract fields**: `RosterMerc.contract` (`MercContract`, `src/sim/campaign/contracts/contract-state.ts`; the
field table is `22` §0). This doc writes the hire and arrival fields (§2.5, §2.6), the paid `medicalDeposit` and the four
insurance fields (§7.1).

---

## 1. The laptop as a simulation

### 1.1 Time

- Entering the laptop calls `PauseGame()` (`Laptop/Laptop.cc:461-462`), leaving `UnPauseGame()` (`:627-628`); the world
  clock only runs on `GAME_SCREEN` and `MAP_SCREEN` anyway (`docs/15` §1.5). **Nothing in the laptop takes game time**:
  hiring, ordering, the I.M.P. questionnaire and reading mail all happen at one world minute.
- Opening the laptop from the map screen **stops time compression** (`HandleExitsFromMapScreen`,
  `Strategic/Map_Screen_Interface_Bottom.cc:1091-1121`); leaving always returns to the map screen (`LeaveLapTopScreen`,
  `Laptop/Laptop.cc:1349`), where compression stays stopped until the player restarts it.
- Wall clock only (presentation): the website loading delays (`website_loading_time_scale`, `game.json:184-186`), the
  A.I.M. video conference, the power-down animation (`Laptop.cc:1368-1433`), Speck's video and idle chatter. The A.I.M.
  impatience timer is wall clock with a logic effect (§2.2).

### 1.2 When the laptop is available

The laptop is reached only from the map screen (the bottom-panel button or `l`, `Strategic/MapScreen.cc:2847`,
`Map_Screen_Interface_Bottom.cc:272, 299`). `AllowedToExitFromMapscreenTo(MAP_EXIT_TO_LAPTOP)`
(`Map_Screen_Interface_Bottom.cc:987-1070`) refuses while: already leaving the map screen; another exit is pending; the
dialogue queue is not empty; a meanwhile is trying to start; the pause state is locked (message boxes, contract
renewal/ending, PBI, simultaneous arrival, conversations, `docs/15` §1.5); an inventory item is held; the assignment update
box, town info or the militia popup is shown; the contract renewal sequence is on; a battle is about to start
(`fDisableDueToBattleRoster`, `fDisableMapInterfaceDueToBattle`: the PBI is pending or open); the sector inventory is
open. There is no money, combat or "enemies in sector" test.

At a new game the laptop is the first screen (`InitNewGame` sets the pending screen to `LAPTOP_SCREEN`,
`Strategic/Game_Init.cc:266-267`), and `LeaveLapTopScreen` overrides the `INIT_SCREEN` exit with the map screen (`docs/15`
§4.1).

### 1.3 The laptop flow in ja2-node

`flow = 'laptop'` behaves like the laptop screen: the clock does not run, the loaded sector is frozen, and `advance` and
every non-laptop command are refused (`laptop: the laptop is open, closeLaptop first`); laptop commands with the laptop
closed answer `laptopClosed`. Queries (`04` §6) work in any flow and never act.

- `openLaptop` (strategic flow only): refused while a battle prompt is open, while the pre-battle interface is pending, or
  during the renewal sequence (the state-based conditions of §1.2 that exist in ja2-node; the speech channel never blocks
  commands). Effect: `stopTimeCompression` (`REQUESTED`), `flow = 'laptop'`, the A.I.M. bookmark,
  `mercSiteOpenedThisSession = false`.
- `closeLaptop` runs `HandleExit` and `LeaveLapTopScreen` (`Laptop.cc:1439-1454, 1345-1366`), in order:
  1. if `gfNewGameLaptop` and `CanCreateAnotherIMPCharacter()` (§4.1) and `!fSentImpWarningAlready`:
     `AddFutureDayStrategicEvent(HAVENT_MADE_IMP_CHARACTER_EMAIL, (8 + Random(4))·60, 0, 1)` (tomorrow 08:00–11:00; one
     `Random(4)` per such exit; posted again on every exit until the flag clears, the handler ignores duplicates once the
     mail went out, §6.1);
  2. if `atLeastOneMercHired` and `gfNewGameLaptop`: `gfNewGameLaptop = false` (the original returns once more and leaves
     on the next frame; no state difference);
  3. `newMail = false` (`fNewMailFlag`, cleared in `ExitLaptop`, `Laptop.cc:605-609`);
  4. `flow = 'strategic'`.
- `visitSite {site}` runs what entering a site's page does (`EnterBobbyR`, `EnterMercs`, `EnterFuneral`, `EnterFlorist`,
  `EnterInsurance`, `EnterFloristOrderForm`): `bobbyRay` sets its bookmark and, while the site is under construction,
  `underConstructionVisit = BEEN_TO_SITE_ONCE` (the gate of the `BOBBYR_NOW_OPEN` mail, §5.1); `funeral`, `florist` and
  `insurance` set their bookmarks; `merc` (refused `noBookmark` without its bookmark and `siteDown` during the outage, when
  the browser shows the broken link) increments `ubPlayerBeenToMercSiteStatus` and runs Speck's opening (§3.6) the first
  time in a laptop session; `floristOrderForm` draws the order-number step (§7.3). No time passes; which page is shown is
  client state.
- A new campaign starts in the flow (§8).

Entry side effects of the original that stay UI state: the bookmark visit flags (`Laptop.cc:494-495`), the "just hired"
popup reset (`Laptop/AIMMembers.cc:396-415`, shown by `DisplayPopUpBoxExplainingMercArrivalLocationAndTime`,
`:2882-2919`), music, ambients, the rain sound.

### 1.4 Logic versus presentation, per program and site

| Program / site | Game logic | Presentation only |
|---|---|---|
| Email | receiving mails (callers everywhere, §6.1), opening a mail with a special effect (bookmarks), deleting | layout, pages, sorting, new-mail blinking |
| Files | the file list (§6.4), the read flag | the file viewer |
| History | the log (§6.2) | pages |
| Finances | balance and ledger (§6.3) | the daily/total summaries, computed from the ledger |
| Personnel | the departed lists (§7.4) | stats display |
| A.I.M. | contact, refusals, hiring, leaving a message (§2) | video conference, attitude quotes, sorting (`AIMSort.cc`), facial index, archives, history, policies, links |
| M.E.R.C. | account, hiring, payment, unlocks, outage (§3) | Speck's video and quotes except the few with side effects (§3.6) |
| I.M.P. | questionnaire → profile, payment, hiring (§4) | page sequence, text, portraits as images |
| Bobby Ray's | inventory, restock, orders, shipping, delivery (§5) | page filters, item descriptions |
| Insurance | contracts, premiums, payouts, investigations (§7.1) | info and comments pages |
| Florist | flower orders (§7.3) | gallery, cards |
| Funeral | none (§7.3) | text pages |
| Broken link | the M.E.R.C. outage (§3.1) | the page |

Reachability is state: A.I.M. is bookmarked on every laptop entry and links to Bobby Ray's, the funeral home and the
insurance site (`AIMLinks.cc:39`; the rotating A.I.M. ads also link to the florist, `AIM.cc:765-777`); I.M.P. needs its
bookmark, set by opening `IMP_EMAIL_INTRO` or `IMP_EMAIL_AGAIN`; M.E.R.C. needs its bookmark, set by opening `MERC_INTRO` or
`MERC_NEW_SITE_ADDRESS` (`EMail.cc:1641-1720`). A deleted unread intro mail therefore locks its site (inferred edge case,
kept). ja2-node refuses I.M.P. and M.E.R.C. commands with `noBookmark` until the bookmark exists.

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
| −8 | `MERC_FIRED_AS_A_POW` | left the team while a POW (`Merc_Contract.cc:683`); the countdown never resets it (`Strategic_Merc_Handler.cc:315-316`), but once the countdown is 0 the daily away roll (§2.2) can still turn it into `WORKING_ELSEWHERE`, after which it becomes `MERC_OK` (quirk) |

`IsMercHireable(p)` (`Merc_Hiring.cc:351-364`) = `status ≤ 0` and status ∉ {−1, −4, −5, −6, −7, −8} and
`uiDayBecomesAvailable == 0`. So −2 is hireable; −3 passes this test but is refused first by `WillMercAcceptCall` (§2.3)
and by `HireMerc`'s status gate; a returning or away merc is hireable only once the countdown is 0 **and** the status was
reset.

### 2.2 Availability over time

**New game** (`LoadMercProfiles` → `StartSomeMercsOnAssignment`, `Soldier_Profile.cc:485-513`; `docs/15` §4.6 step 2), for
each AIM or MERC profile in content order (`GCM->listMercProfiles()`, id order):
```
if Random(100) < 5·expLevel:  status = WORKING_ELSEWHERE; dayBecomesAvailable = 1 + Random(6 + expLevel/2)
else:                         status = MERC_OK;           dayBecomesAvailable = 0
precedentQuoteSaid = 0; daysOfMoraleHangover = 0
```

**Daily, 00:00** (the profile loop of `MercDailyUpdate`, `Strategic_Merc_Handler.cc:286-366`, skipped on Day 1; the loop is
`22` §2.1, the unhired improvement and death rolls `22` §2.5). For availability:
- profiles on the team (`IsMercOnTeam`: any OUR soldier with the profile, in transit or dead and not yet removed included)
  and dead profiles are skipped;
- a running countdown decrements; at 0 the status becomes `MERC_OK` from any status but `FIRED_AS_A_POW` (also from
  `RETURNING_HOME` and `WORKING_ELSEWHERE`), and if `PLAYER_LEFT_MSG_FOR_MERC_AT_AIM` is set it is cleared and
  `AddEmail(AIM_REPLY_BARRY + id·AIM_REPLY_LENGTH_BARRY, AIM_REPLY_LENGTH_BARRY, 6 + id, now)` is sent;
- the "go away" roll (`Random(100) < chance` → `WORKING_ELSEWHERE`, countdown `1 + Random(6 + expLevel/2)`) is made only on
  days that started with the countdown at 0, so a merc who came back today cannot leave before tomorrow; it is rolled for
  available *and* annoyed (−2/−3) mercs; the chance is `2·expLevel` for `id < MAX_NUMBER_MERCS (40)` (`Laptop/AIM.h:6`,
  not the profile type; sets `PLAYER_HAD_CHANCE_TO_HIRE`), else `expLevel` (the flag only after `DAYS_TIL_M_E_R_C_AVAIL`,
  day > 3);
- an unhired death (`(INT16)PreRandom(1000) < chance`, needs `PLAYER_HAD_CHANCE_TO_HIRE`, capped by `unhiredMercDeaths <
  unhired_merc_deaths_<difficulty>`, policy 1/2/3, `game.json:254-256`) sends `MERC_DIED_ON_OTHER_ASSIGNMENT` for AIM
  profiles only (sender `AIM_SITE`, second data = profile).

**Departure** (`StrategicRemoveMerc`, `22` §4.5): a living profile goes `RETURNING_HOME` for `1 + Random(2)` days; morale
too low adds a hangover of `3 + Random(4)` days (`Merc_Contract.cc:454-462`); a merc who signed elsewhere goes
`WORKING_ELSEWHERE` for `+= 1 + Random(6 + expLevel/2)` days (`:465-472`); a POW then gets `FIRED_AS_A_POW`, the others the
medical deposit refund (§2.7).

**Annoyance** (`HandleMercAttitude`, `AIMMembers.cc:2188-2249`): while the video conference waits for the player, the merc
escalates every 3 s (first step) / 10 s of *wall clock* (`GetJA2Clock`); at the hang-up step `0 → −2`, `−2 → −3` and
`EVENT_AIM_RESET_MERC_ANNOYANCE` is posted at `now + 360 + Random(600)`; its handler (`ResetMercAnnoyanceAtPlayer`,
`:2708-2724`, with the Larry profile swap) sets −2/−3 back to 0. ja2-node never escalates (deviation "A.I.M. annoyance");
the statuses and the reset event (with the Larry swap) stay for imported saves.

### 2.3 Contacting and refusals

**Contact** (`WillMercAcceptCall`, `AIMMembers.cc:1754-1766`): status −3 → "unavailable" (lame refusal, hang-up, no state
change); `IsMercHireable` → first contact; otherwise the answering machine, where the player may leave a message
(`BtnAnsweringMachineButtonCallback`, `:1578-1605`): `miscFlags3 |= PLAYER_LEFT_MSG_FOR_MERC_AT_AIM`, which produces the
"back from assignment" mail of §2.2 (ja2-node: `aimLeaveMessage` is refused unless the merc is on the answering machine and
refused again once a message is left). The face overlay (`DisplayMercsFace`, `:955-1015`) shows dead; POW
(`FIRED_AS_A_POW` or on the team as `ASSIGNMENT_POW`); already hired (on the team); "on assignment" (any other
non-hireable state); nothing.

**Asking to hire** (`CanMercBeHired`, `AIMMembers.cc:1769-1863`; the pseudocode with its quote ids is `22` §5.4, the
tolerances `22` §6.3): evaluated when the player presses HIRE in first contact, before the contract page and the funds,
not again at payment. In order: a morale hangover refuses, buddy or no buddy; a hated merc (slots 0, 1 and the learned
slot 2) on the team, arrived and alive (`IsMercOnTeamAndInOmertaAlreadyAndAlive`, `Tactical/Soldier_Add.cc:991-995`)
refuses unless a buddy is on the team (accept at once) or it is slot 0/1 with `bHatedTime[i] ≥ 24` (tolerated, a
"personality bias" quote); a buddy on the team accepts, skipping the rest; then the death rate
(`MercThinksDeathRateTooHigh`, `Strategic/Strategic_Status.cc:141-162`) and the reputation (`MercThinksBadReputationTooHigh`,
`:165-186`), each off at tolerance 101. The buddy is `GetFirstBuddyOnTeam` (`Soldier_Profile.cc:878-889`): the first of
`bBuddy[0..2]` (two buddies, then the learned-to-like slot) on the team (`IsMercOnTeam`, in transit included) and not
dead. `CalcDeathRate()` (`Strategic_Status.cc:114-126`) = `u8(idiv(mercDeaths·100, manDaysPlayed))`, 0 while `manDaysPlayed == 0`,
**wrapping at 256** (computed as `(UINT8)(UINT32)(mercDeaths · 1.0f · 100 / manDaysPlayed)`; the float quotient never
rounds across an integer for realistic counts, inferred). Its inputs and the reputation are `22` §6: `mercDeaths` (our
dead except EPCs and the robot, `Strategic_Merc_Handler.cc:78-82`), `manDaysPlayed` (+1 per living, non-transit team member
per daily update, `:263-269`), `badReputation` (0 saint … 100, `ModifyPlayerReputation`, `Strategic_Status.cc:129-138`).

### 2.4 Prices

Shown on the member page and charged at hire (`DisplayMercChargeAmount`, `AIMMembers.cc:1370-1414`, recomputed only while
the merc is not on the team):
```
amount = {1 day: sSalary, 1 week: uiWeeklySalary, 2 weeks: uiBiWeeklySalary}[contract]
if bMedicalDeposit: amount += sMedicalDepositAmount
if gear:            amount += usOptionalGearCost
```
The video conference opens with **1 week** selected and the kit selected iff `usOptionalGearCost != 0` (`:2379-2381`); the
kit button is disabled when the cost is 0 (`:2456-2459`). ja2-node's defaults are the same (`aimHire` without `gear` takes
the kit iff it has a cost; `gear: true` on a 0-cost kit is refused).

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
  ja2-node (`profile-state.ts`): the `x³/10000` terms are exact in doubles; `pow(exp, 0.2)` for `exp` 0..10 is an 11-entry
  table of the correctly rounded doubles (`04` §5.6 forbids `Math.pow` in `core`/`sim`); the product is evaluated left to
  right in doubles as written (`0.05` is a double literal; `aps − 6` is UINT32 arithmetic), then truncated to UINT16.
- **Kit cost** (`InitProfileFromContent`, `Soldier_Profile.cc:187-206`): after the non-gun-nut gun replacement
  (`:161-185`), `usOptionalGearCost = Σ getPrice()` over the profile's inventory slots (one price per slot, **not**
  multiplied by `bInvNumber`; UINT16 sum). Buying the kit copies the profile items to the soldier and sets
  `usOptionalGearCost = 0` (`Tactical/Soldier_Create.cc:2045-2059`), so a re-hire offers no kit.
- **Salary growth** (`CalcNewSalary`, `22` §3.7): every experience level gained raises `sSalary`, `uiWeeklySalary`,
  `uiBiWeeklySalary` and `sMedicalDepositAmount` once, for AIM and MERC profiles on or off the team (unhired improvement
  included), never for RPCs; the soldier's paid `usMedicalDeposit` is not raised.

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
- Refusal order for the whole flow: contact (§2.3 `WillMercAcceptCall`), `CanMercBeHired`, funds, status, team size.
  "Already hired" is caught at contact (answering machine). ja2-node's `aimHire` checks the same order after its argument
  checks (A.I.M. profile, contract length, kit).
- `TacticalCreateSoldier` for an OUR soldier with a profile is `createHiredMerc` (`src/sim/tactical/creation.ts`; draws:
  deviation "Soldier creation draws"); with `copyItems` it copies the profile inventory and `hireMercCore` zeroes
  `optionalGearCost`. The contract fields are set by `contracts/hire-contract.ts` `hireContract` (`22` §1.2).

### 2.6 Arrival time and place

`GetMercArrivalTimeOfDay()` (`Merc_Hiring.cc:424-459`, `MIN_FLIGHT_PREP_TIME 6`, slots `Merc_Hiring.h:14-16`; ja2-node
`contracts/contract-times.ts` `mercArrivalTimeOfDay`):

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
  `MapScreen.cc:7521-7540`), to any surface sector whose strategic-move traversability is not `GROUNDBARRIER` and that is
  not enemy air controlled (`:2391-2425`); every in-transit merc with `useLandingZone` follows
  (`UpdateAnyInTransitMercsWithGlobalArrivalSector`, `Merc_Hiring.cc:462-471`). No airport is needed (the airport matters
  for Bobby Ray, §5). When an airspace update makes the landing zone enemy air controlled, it snaps back to the start sector
  with a message box (`HandleAirspaceControlUpdated`, `StrategicMap.cc:2295-2320`, registered on
  `OnAirspaceControlUpdated`). ja2-node: `setLandingZone` (`hire.ts`), the boxes become the events `arrivalRerouted` and
  `landingZoneReset`.
- **`MercArrivesCallback(s)`** (`Merc_Hiring.cc:224-348`; ja2-node `LaptopFlow.mercArrives` for steps 1–6, then
  `contracts/hire-contract.ts` `mercArrived` for 8–10):
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
  9. if `SoldierHasWorseEquipmentThanUsedTo(s)` (`Strategic_Merc_Handler.cc:434-488`, `22` §2.2): `t = 540 + Random(660)`;
     if `minutesInDay < t`: `AddSameDayStrategicEvent(MERC_COMPLAIN_EQUIPMENT, t, profile)`;
  10. `HandleMercArrivesQuotes` (non-chopper: the hated-merc gripes of AIM teammates, `22` §1.2; the I.M.P. Omerta quote
     is presentation); select the arrival sector if the selected one has nobody (UI).

### 2.7 Medical deposit refund

Only in `StrategicRemoveMerc` (contract end, firing, quitting, or the player removing a dead merc from the team list,
`Strategic/Assignments.cc:4358-4363`), and never for a POW (`Merc_Contract.cc:680-689`). `CalculateMedicalDepositRefund`
(`:711-742`; ja2-node `contracts/departure.ts`), using the soldier's paid `usMedicalDeposit`:

| Condition | Ledger | Amount | Mail (`AIM_SITE`, first data = amount, second = profile) |
|---|---|---|---|
| `!bMedicalDeposit` (profile flag) | — | — | — |
| `life == lifeMax` | `FULL_MEDICAL_REFUND` | deposit | `AIM_MEDICAL_DEPOSIT_REFUND` |
| `0 < life < lifeMax` | `PARTIAL_MEDICAL_REFUND` | `(2·deposit·life/lifeMax + 1)/2` (rounded half up) | `AIM_MEDICAL_DEPOSIT_PARTIAL_REFUND` |
| `life ≤ 0` | none (`NO_MEDICAL_REFUND` is commented out) | 0 | `AIM_MEDICAL_DEPOSIT_NO_REFUND` (first data = the deposit) |

The life is the current life at departure (bleeding and unhealed wounds reduce the refund). A merc who dies keeps his
body on the team list until the player removes it; only then is the "no refund" mail sent. M.E.R.C. mercs never pay a
deposit (§3.3).

---

## 3. M.E.R.C.

### 3.1 The site and the account

- **Online day**: `InitNewGame` draws `d = Random(max − min + 1) + min` (policy `merc_online_min_days 1`, `_max_days 2`,
  `game.json:229-230`); `d == 0` sends `MERC_INTRO` at once, else `DAY3_ADD_EMAIL_FROM_SPECK` (11) at Day 1+d 07:00
  (`Strategic/Game_Init.cc:251-264`), whose handler sends `MERC_INTRO` (`Game_Event_Hook.cc:126-128`). Opening that mail
  sets the M.E.R.C. bookmark (`HandleMailSpecialMessages`, `Laptop/EMail.cc:1688-1691`): the site is reachable only after
  the player *reads* it.
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
  (Speck's next opening sets 2). Until the outage the site's first load is the long one (`LONG_UNIT_TIME`, presentation).

### 3.2 Which mercs are listed

`mercs-MERC-listings.json` in file order, `index` = position (`externalized/DefaultContentManager.cc:1309-1316`), with
`minTotalSpending` and `minDays` per entry (0/0 for the first six; then 5000/8, 10000/15, 15000/20, 20000/25) and the
listing's Speck quotes (`MERC_DEAD`, `CROSS_SELL`, `ADVERTISE`). Listing is a **prefix**: a merc is shown iff `index ≤
gubLastMercIndex` (`Mercs_Files.cc:235, 476`); `IsMercMercAvailable` adds `IsMercHireable` (`Mercs.cc:1291-1311`).

- `CanMercBeAvailableYet(m)` (`Mercs.cc:1596-1617`): `index > gubLastMercIndex && IsMercHireable(profile) &&
  minTotalSpending ≤ uiTotalMoneyPaidToSpeck && minDays ≤ day`.
- `MakeNewMercsAvailable(notify)` (`:1664-1684`): walk the listings; for each eligible one `gubLastMercIndex = index` and
  `ubLastMercAvailableId` = 0/1/2/3 for BUBBA/LARRY_NORMAL/NUMB/COUGAR (`:1620-1629`); an earlier unhireable merc becomes
  listed too (prefix). If anything was revealed and `notify`: mail `NEW_MERCS_AT_MERC`, `fNewMercsAvailableAtMercSite`.
- Initial state: `GameInitMercs` → `MakeNewMercsAvailable(false)` at laptop init (`Laptop.cc:351-387`), giving
  `gubLastMercIndex = 5` with fresh profiles (stale on a restart in one process, inferred; ja2-node sets 5).
- `ScheduleNewMercsToBeAvailable` (`:1579-1593`), every midnight from the daily update regardless of account or mail: if
  any listing is eligible, `MERC_SITE_NEW_MERC_AVAILABLE` (78) at `midnight(1) + 420 + Random(180)`; nothing de-duplicates,
  so a new event (and draw) is posted every midnight while eligibility lasts; the handler re-evaluates
  (`NewMercsAvailableAtMercSiteCallBack`, `:1686-1689`) and later events usually reveal nothing.
- Unlocks therefore depend on **money paid to Speck** and the day, not on hires.
- Larry: the listing resolves to `LARRY_DRUNK` when `FACT_LARRY_CHANGED` (`Mercs.cc:600-608`); the swap
  (`Soldier_Profile.cc:955-978, 1026-1033`, `25`) copies status, inventory and stats but not `iMercMercContractLength` or
  `uiTotalCostToDate` (unpaid days stay on the other profile; same in V). Biff: `uiDayBecomesAvailable = Random(2) + 2` when
  Speck tells of Flo's death or marriage (`Mercs.cc:1554-1557`, §3.6). Flo shows as married after
  `FACT_PC_MARRYING_DARYL_IS_FLO` (the files page's overlay).
- Away and dead M.E.R.C. mercs follow §2.2 (chance `1·expLevel`; the death roll needs `PLAYER_HAD_CHANCE_TO_HIRE`, set
  only after day 3; no mail for M.E.R.C. deaths).

### 3.3 Hiring

Files page "hire" (`Mercs_Files.cc:245-266`) → `MercFilesHireMerc` (`:393-461`) → `HireMerc`:
1. button enabled only if the merc is not dead and the status is `VALID`, `FIRST_WARNING` or `SUSPENDED` (`:202-209`);
2. `SUSPENDED` → back to the home page with Speck's quote 14, no hire;
3. `!IsMercHireable` → (alive) "already hired" quote 71; fail;
4. `HireMerc` status gate {0, −2, −4}; team ≥ 18 → "too many";
5. hire struct: kind `MERC`, `copyItems = true` (always the full kit, free, no `ALREADY_USED_ITEMS`), length 1, landing
   zone, arrival `GetMercArrivalTimeOfDay()`, **insertion left at 0 = `NORTH`** (AIM and I.M.P. use `ARRIVING_GAME`);
6. `HireMerc`'s MERC branch (`Merc_Hiring.cc:191-201`): `p.iMercMercContractLength = 1` (the hire day is owed at once),
   `s.iStartContractTime = day`, history `HISTORY_HIRED_MERC_FROM_MERC`.

No funds check, no transaction, no deposit, no contract or kit choice. Re-hiring overwrites an unpaid
`iMercMercContractLength` with 1 (inferred: firing and re-hiring erases the debt). M.E.R.C. mercs are outside the AIM
renewal machinery (`22`). The arrival is the AIM one (§2.6). After a hire Speck says the cross-sell quotes of the hired
merc's listing for related mercs still available (`ShouldSpeckSayAQuote`), then thank-you quote 69 or 70 by `CoinToss`
on the main stream (deviation "Speck's opening": ja2-node draws it at `mercHire`).

### 3.4 Fees, debt and payment

- Debt per merc = `sSalary · iMercMercContractLength` (`Mercs_Account.cc:246, 428`), with the *current* salary (it rises
  with levels, §2.4); `CalculateHowMuchPlayerOwesSpeck` sums every listing, on the team or not (`:421-432`). The account
  page lists the mercs on the team or still owed money (`DisplayHiredMercs`).
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
  Speck says 45 after a full payment, 46 after a partial one (`MercAuthorizePaymentMessageBoxCallBack`). The ledger's
  second code is the profile of the merc page last viewed (`gubCurMercIndex`, a UI index): ja2-node uses the first paid
  listing's profile (deviation "Speck payment record"). ja2-node's `mercPay` also refuses a payment of nothing.

### 3.5 The daily updates

`DAILY_UPDATE_OF_MERC_SITE` (10, every day 00:00, before `MERC_DAILY_UPDATE`, `docs/15` §3.1) → `DailyUpdateOfMercSite`
(`Mercs.cc:513-588`; ja2-node: the account part in `contracts/merc-account.ts`, the rest in `merc-site.ts`
`mercSiteDailyUpdate`):
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
in transit and with `life ≥ CONSCIOUSNESS` gets `MercsContractIsFinished` (`:375-406`; `22` §4.7: the "not getting paid"
quote, contract end without the equipment question, leave code `HISTORY_MERC_QUIT`). It repeats every midnight while
`INVALID`. Death of a M.E.R.C. merc sets `iEndofContractTime = now` and `ubSpeckCanSayPlayersLostQuote = 1` (`:122-127`);
unpaid days stay owed, nothing is refunded.

Level-ups of hired M.E.R.C. mercs post `MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY` (77) at `now + 60 + Random(60)` with param
`profile − BIFF` (−1 more from `LARRY_DRUNK − BIFF` on), whose mail is `MERC_UP_LEVEL_BIFF + 2·param`
(`Tactical/Campaign.cc:683-706`, `EMail` handler).

### 3.6 Speck's quotes with side effects

`GetSpeckConditionalOpening` (`Mercs.cc:955-1177`) runs when the player enters the home page from outside the site (after
the video intro, a UI timer). Effects that matter: `ubPlayerBeenToMercSiteStatus` increments per entry (0–3,
`:276-288`); `fFirstVisitSinceServerWentDown 1 → 2`; `ubSpeckCanSayPlayersLostQuote → 0` (with ≥ 2 dead M.E.R.C. mercs);
`SENT_EMAIL_ABOUT_LACK_OF_PAYMENT` and `fNewMercsAvailableAtMercSite` cleared; `fHasAMercDiedAtMercSite`; per dead listing
`miscFlags3 |= MERC_MERC_IS_DEAD_AND_QUOTE_SAID`; **Biff goes away for `Random(2) + 2` days** when Speck tells of Flo's death
(Biff alive) or of her marriage (`fSpeckSaidFloMarriedCousinQuote`); the Larry relapse flag in `uiSpeckQuoteFlags`. The
opening also draws `Random(100)`, `Chance(50)`, `Random(4)` for the quote choice (`:1274-1334`).

Quote order (`merc-site.ts` `speckOpening`): the first visit says 0, then the tags below, then 1–8 (each later call of
`GetSpeckConditionalOpening` queues the next intro quote); the second visit 10; later visits one branch (11 nobody hired
and no days served yet; 19 back after the outage; 23 two or more dead; 14 suspended; 15 + 16 owing more than $5,000;
otherwise `Random(100)`: below 40 with new mercs available and more than one M.E.R.C. merc on the team 12, below 80 while
Speck is trying to recruit 13, else 20 and once per game 21) and, after 19, 12, 13 or 20, a tag 41–44 (`Random(4)`) when
`Chance(50)`; then 24 (the unpaid-account mail; not after 14 or 15 + 16), 22 (new mercs), 27 (the first death), per newly
dead listing its `MERC_DEAD` quote from `mercs-MERC-listings.json` (Flo: 32 with Biff alive, else 33), 34 (Flo married,
Biff alive) and 37 (Larry relapsed). Opening an account makes Speck say 9. Idle chatter (`:1388-1551`) is UI only.

ja2-node runs the opening at `visitSite merc` the first time in a laptop session, or at the first M.E.R.C. command of a
session without a visit (which also counts as the visit), so its draws and the Biff side effect happen at a defined command
instead of when the video intro ends (deviation "Speck's opening"; with the clock stopped no strategic draw can interleave,
so only the order relative to other laptop commands can differ, inferred).

---

## 4. I.M.P.

### 4.1 Access and slots

- Activation code (`IMP_HomePage.cc:59-77`, `ProcessPlayerInputActivationString`): an exact match against `imp.json`
  `activation_codes` (`["XEP624", "xep624"]`), checked first, then `CanCreateAnotherIMPCharacter()`. The code is in the
  I.M.P. intro mail sent at new game when another character can be created (`Game_Init.cc:235-238`); the player must know
  it, not read the mail.
- `CanCreateAnotherIMPCharacter()` (`IMP_Compile_Character.cc:95-99`) = a free slot exists and taken < policy
  `imp.max_characters` (1; 0 turns the site off; `game.json:194-226`). Slots (`:53-92`): profiles not declared in the data
  or declared `IMP`, in id order (51–56, 165–169, 170–199 with the shipped data; the undeclared ones are empty structs as
  Stracciatella makes them); a character always takes the first free slot; `MarkIMPCharacterCreated` sets the slot `TAKEN`
  and `fIMPCompletedFlag` (informational in Strac).
- Begin (`IMP_MainPage.cc:447-455`, `BtnIMPMainPageBeginCallback`) refuses with `balance < 3000`, then with
  `NumberOfMercsOnPlayerTeam() ≥ 18`. The progress modes (begin → personality → attributes → portrait → voice → finish,
  `:238-247, 560-611`) are UI sequencing; only the final choices matter.

### 4.2 Choices

- **Name**: full name ≤ 29 characters, nickname ≤ 8; trimmed; empty full name refused; empty nickname = the first word of
  the full name, left 8 (`IMP_Begin_Screen.cc:45, 107-127, 274-299`). **Gender** male/female.
- **Personality quiz** (`IMP_Personality_Quiz.cc`): 16 questions; answers per question Q0 6, Q3 5, Q5 5, Q10 5, Q11 8,
  others 4 (`:248-257`). `CompileQuestionsInStatsAndWhatNot` (`:424-562`) appends, in question order, to three lists (skill,
  attitude, personality; each capped at 20 entries). The effect of every answer is `impQuiz` in `data/tables/laptop.json`
  (per question an array over the answers: `null` = no effect, `{list, value}` with the `SkillTrait`/attitude/personality
  enum value, or `{list: 'skill', male, female}` for Q0 a0 and Q11 a0: `MARTIALARTS` for men, `AMBIDEXT` for women).
  V differs at Q8 a1 (V adds `PESSIMIST`, Strac nothing). `AddAPersonalityToPersonalityList` keeps only `PSYCHO`
  (`IMP_Compile_Character.cc:417-430`): the quiz's `CLAUSTROPHOBIC`, `FORGETFUL`, `NERVOUS` and `HEAT_INTOLERANT` answers
  do nothing. The gender used for Q0/Q11 is the one chosen *before* the quiz; changing gender afterwards does not recompute
  (martial arts become hand-to-hand for women and big bodies at confirm anyway).
- **Personality and attitude** (`CreatePlayersPersonalitySkillsAndAttitude`, on the personality-finish page,
  `IMP_Personality_Finish.cc:306, 334`): personality = `PSYCHO` if the personality list is non-empty, else none
  (`:433-444`). Attitude (`:240-298`): empty list → `ATT_NORMAL` (no draw); else count hits per attitude, `H` = max, `k` =
  number of attitudes with `H` hits, `d = Random(k)` (drawn even for `k == 1`), attitude = the `d`-th such attitude in
  ascending enum order (`NORMAL 0 … COWARD 9`).
- **Direct skill pick** (policy `imp.pick_skills_directly`, default false; `IMP_SkillTraits.cc`): replaces the quiz; up to
  2 of 14 traits (martial arts hidden for women); no personality/attitude; bonus points: none picked +10, one of
  `ELECTRONICS`/`AMBIDEXT`/`CAMOUFLAGED` +5, otherwise 0 (`:554-591`). ja2-node accepts it in `impCreate` (the canvas page
  is a deviation, "I.M.P. skill page and saved profiles").
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
  if result == 0 (failed): return (no charge)                            // −1 "too many" counts as success (below)
MarkIMPCharacterCreated(profile)
if no soldier with that profile: return (no charge)
AddTransactionToPlayersBook(IMP_PROFILE, profile, now, −3000)            // also uiTotalCostToDate += 3000
AddHistoryToPlayersLog(HISTORY_CHARACTER_GENERATED, 0, now, (−1, −1))
if imp.json send_profile_results_email: AddFutureDayStrategicEvent(DAY2_ADD_EMAIL_FROM_IMP, 420, profile, 2)
```
- **Skills** (`HandleMercStatsForChangesInFace`, `IMP_Compile_Character.cc:536-568`; `CreatePlayerSkills`, `:368-414`):
  validate the skill list against the stats (`ValidateSkillsList`, `:337-365`): mechanical 0 removes every `ELECTRONICS`;
  `idiv(idiv(mech·wis, 100)·dex, 100) + 25 (gbSkillTraitBonus[LOCKPICKING]) < 50` removes every `LOCKPICKING`
  (`Soldier_Profile.cc:58-76`); marksmanship 0 removes `AUTO_WEAPS` and `HEAVY_WEAPS`. Removal swaps with the last element
  (`for (i = 0; i != n;) if L[i] == s then L[i] = L[--n] else ++i`, `:321-334`), which reorders the list. Quiz mode
  (`:401-413`): `A = L[Random(n)]`; if `A ∈ {ELECTRONICS, AMBIDEXT}` remove every `A`; `B = n == 0 ? NO_SKILLTRAIT :
  L[Random(n)]` (A == B allowed: expert). With `n == 0` at the first draw, `Random(0)` returns 0 without drawing and `A =
  L[0]`, a stale value (a skill removed by validation, or 0 in a fresh process): ja2-node uses `NO_SKILLTRAIT` (deviation
  "I.M.P. empty skill list"). Direct-pick mode (`:372-399`): traits appended in enum order, validated; one left → `A = B =
  it` (expert) unless it is `ELECTRONICS`/`AMBIDEXT`/`CAMOUFLAGED` (`B = none`); two → `L[0]`, `L[1]`; no draws.
  **Body**: male with a `big_body` portrait and `strength − strengthDelta ≥ 75` → `BIGMALE`, else `REGMALE`; female →
  `REGFEMALE`; `BIGMALE` and female turn `MARTIALARTS` into `HANDTOHAND` in both slots (`:176-186, 544-563`).
- **Starting gear** (`imp.json` `inventory`, `externalized/policy/DefaultIMPPolicy.cc:152-202`, `IMPPolicy.h:54-111`): sets
  in file order; each condition is a `≥` pair (`[STAT, n]`, `[n, STAT]`, `RND100` = **`PreRandom(100)`**, `[SKILL, X]` =
  `HasSkillTrait`), stopping at the first false one; items go to the named slot or the first empty small pocket (if
  `perPocket ≠ 0`), then big pockets 1–4, status 100, count 1 (`IMP_Confirm.cc:229-279`). Shipped: canteen and flak
  jacket; helmet if `wisdom ≥ PreRandom(100)` (V: `<`, an off-by-one in Strac's data); MP5K + 2 magazines at marksmanship ≥
  80, else Beretta 93R + 3; medical kit ≥ 60, first aid kit 30–59; toolkit at mechanical ≥ 50; TNT + detonator at
  explosives ≥ 50; one item per skill (lockpicking kit, brass knuckles, metal detector, break light, throwing knife,
  silencer, combat knife). `HireMerc` then copies the profile items onto the soldier (auto-placement decides the final
  layout, inferred).
- **Contract**: `length = −1`, so `bMercStatus = (UINT8)−1 = −1` (`MERC_HAS_NO_TEXT_FILE`) at hire and again at arrival,
  and `iEndofContractTime = midnight(0) + hour·60` (today): harmless because nothing reads them for `PLAYER_CHARACTER`
  (quirk; the renewal code is AIM-only, `22`). I.M.P. mercs are never paid (no daily cost path; inferred: no branch found).
- **Edge case**: `HireMerc` returning `MERC_HIRE_OVER_20_MERCS_HIRED (−1)` counts as success, so with a full team the slot
  is marked taken, no soldier exists and nothing is charged; reachable only if the team fills between Begin and confirm.
  ja2-node checks the team in the same command, so it is unreachable (a full team is refused `teamFull` before anything
  changes).
- Not saved in the original: the in-progress creation (inferred). ja2-node has no in-progress state (§4.4).

### 4.4 `impCreate`: one command

The draft stays in the client; `impCreate` carries every choice (`code`, `name`, `nickname?`, `gender`, `answers[16]` in
quiz mode or `skills[0..2]` with `imp.pick_skills_directly`, the ten `attributes`, `portrait` and `voice` as indices within
the gender's entries; shape in `04` §6) and performs the confirm in one step (`imp.ts`).

Validation, in order: the I.M.P. bookmark; the code; `CanCreateAnotherIMPCharacter`; balance ≥ 3000; team < 18 (Begin);
the name rules; each answer in range (or the direct skills: distinct, at most 2, no martial arts for women); the
attributes: every value in `[35, 85]`, or 0 for the four skills, and the total cost ≤ pool, where cost = Σ (v − 55) over
values ≥ 35, minus 35 for each skill at 0 (20 points from 55 down to 35, then the 15-point refund); the portrait and voice
index within the gender. The attribute page lets the player reach exactly these sets (increments and decrements are
inverse, the 0 ↔ 35 step is the only non-linear one, refunds are unbounded; inferred).

Execution: compile the quiz → lists; personality and attitude (the attitude draw); write the profile; then §4.3 (skill
draws, the `PreRandom(100)` helmet, the hire). The I.M.P. view gives the page rules (`impCheckCode`, the begin refusal,
the attribute budget and order, the portrait and voice lists, the answer counts) and `impPreview` the three lists for given
answers without draws (`04` §6).

---

## 5. Bobby Ray's

### 5.1 Site access

`fBobbyRSiteCanBeAccessed` (reset at new game, `Laptop.cc:399`) gates the catalogue (`BobbyR.cc:212-223`). It is set in
`SetThisSectorAsPlayerControlled` for a surface sector, after the "no hostiles" check, when the sector is the primary
shipping destination's delivery sector (Drassen airport B13, `Strategic/Player_Command.cc:82-97`), and never cleared.
Visiting while "under construction" sets `ubHaveBeenToBobbyRaysAtLeastOnceWhileUnderConstruction = BEEN_TO_SITE_ONCE`;
when the site opens, that sends `BOBBYR_NOW_OPEN` once (`ALREADY_SENT_EMAIL`). ja2-node emits `bobbyRayOpen` when the flag
first goes up; a `bobbyRayOrder` also counts as a visit.

### 5.2 Inventory

Two lists of `STORE_INVENTORY {usItemIndex u16, ubQtyOnHand u8, ubQtyOnOrder u8, ubItemQuality u8, fPreviouslyEligible}`
(`Laptop/Store_Inventory.h:7-14`; `LaptopSaveInfo.BobbyRayInventory[351]`, `BobbyRayUsedInventory[351]`, terminated by item
65535, lengths in `usInventoryListLength[2]`).

**Building the lists** (`InitBobbyRayInventory`, `BobbyR.cc:422-435`, in `InitNewGame` after `InitAllArmsDealers`,
`docs/15` §4.2 step 3): new list = items whose `bobby-ray-inventory-new.json` max is non-zero, not `ITEM_NOT_BUYABLE`, and
`ItemIsLegal` (no big-gun-list guns/ammo without gun nut; no sci-fi filter) (`:438-469`); used list = the same with the used
JSON plus `CanDealerItemBeSoldUsed` (damageable and a category that allows used sales: handgun, shotgun, SMG, rifle,
armour, face, misc) (`:472-506`). Both are sorted with the dealer comparator (`Tactical/ArmsDealerInvInit.cc:377-499`,
`23` §1.4).

**Transaction chance**: the dealers' supply model (`ArmsDealerInvInit.cc:67-311`, `23` §4: suitability by
`ubHighestProgress` with Bobby Ray's window `[clamp(p/10, 1, 9), clamp(p/10 + 1, 2, 10)]`, the staples, Bobby Ray's
chances LOW 25, MEDIUM 50, HIGH 75, ALWAYS 100 buying / 75 selling, NONE 0 / 100). A used item that cannot be sold used
gets 0. `ItemTransactionOccurs` (`:274-311`) sets the store slot's `fPreviouslyEligible` on a buying roll with chance > 0
and **always** draws `Random(100) < chance`. ja2-node shares the code with the dealers
(`src/sim/strategic/economy/merchants/supply.ts`, tables in `data/tables/merchant-tables.json`).

**Initial stock** (`SetupStoreInventory`, `Laptop/Store_Inventory.cc:15-47`), per slot in sorted order: `bought =
DetermineInitialInvItems(max)` (`ArmsDealerInvInit.cc:314-330`: `max` buying rolls); new: quantity `bought`, quality 100;
used: if `bought > 0`, quantity 1 and quality `20 + Random(60)`. The progress used here is the value before
`InitStrategicStatus` (0 in a fresh process; stale on a restart in the same process, inferred; ja2-node uses 0).

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
  (`MAX_PURCHASE_AMOUNT`); a line takes another unit while it holds `≤ 200` (`BOBBY_RAY_MAX_AMOUNT_OF_ITEMS_TO_PURCHASE`,
  `BobbyRGuns.cc:1171, 1208`), so it can reach 201 (`BobbyRGuns.cc:1136-1263`). New and used are separate lines. ja2-node
  takes the whole cart in one `bobbyRayOrder` (deviation "Laptop as commands"; the canvas keeps the cart as a client draft).
- **Order form**: destination −1 or 0–16 (`shipping-destinations.json`, 17 entries, all listed); speed 0 overnight (1 day),
  1 two business days (2 days; weekends do not exist), 2 standard (3 days) (`CalculateOrderDelay`).
- **Totals** (`BobbyRMailOrder.cc:693-831, 1472-1529`): subtotal = Σ unit cost × count; weight `w = Σ ubWeight × count` (100 g
  units), at least `MIN_SHIPPING_WEIGHT 20`; shipping = `(UINT32)((w / 10.0f) · rate + .5)` =
  `Math.trunc(Math.fround(Math.fround(w / 10) * rate) + 0.5)`, `rate` = the destination's per-kg charge for the speed
  (Strac data: Drassen 200/100/50; V: 500/200/100); no destination → 0 (the form before a city is chosen). Grand total =
  subtotal + shipping.
- **Accept** (`:616-652`): needs a non-empty cart and a destination; `balance < grand` → "can't afford" (the only refusal:
  no weight limit, no destination check); a destination other than the primary, or the primary while its sector is enemy
  held, asks "ship to X?" first.
- **Purchase** (`PurchaseBobbyOrder`, `:1586-1610`): if the destination `canDeliver`, `AddNewBobbyRShipment`; **always**
  `AddTransactionToPlayersBook(BOBBYR_PURCHASE, 0, now, −grand)` (orders to Austin and other non-delivering cities take the
  money and nothing arrives); remove the units from stock (`onHand = max(onHand − count, 0)`, `:1276-1289`); clear the cart.
- **Shipment record** (`NewBobbyRayOrderStruct`, `BobbyRMailOrder.h:27-41`, 104 bytes; `gpNewBobbyrShipments`, save section
  after the laptop block, `SaveLoadGame.cc:478, 988-995`): active, destination, method, 10 lines, line count, weight
  (`max(w, 20)`), order day, shown-on-shipments-page. `AddNewBobbyRShipment` (`:1763-1844`) reuses slot 0 if it is
  inactive, otherwise appends (the reuse loop tests `[0]`, not `[i]`; same in V; the list only grows); days ahead =
  `CalculateOrderDelay(speed)` = 1/2/3, `+ Random(5) + 1` if Sal is dead (`bLife == 0`, `:1550-1580`); then
  `AddFutureDayStrategicEvent(BOBBYRAY_PURCHASE (7), (8 + Random(4))·60, index, days)`: delivery at **08:00, 09:00, 10:00 or
  11:00** of the target day. Draws: `[Random(5)]`, then `Random(4)`. The shipments page prices its rows from the stored
  package weight and the speed (`DisplayShippingCosts`); its line prices are deviation "Bobby Ray's shipment prices".
- John Kulba's gift (NPC action 188, `25`; `:1612-1666`): two Automag III and two magazines, primary destination, 5 days
  (standard 3 + 2, plus the Sal penalty), not on the shipments page.

### 5.5 Delivery (`BobbyRayPurchaseEventCallback`, `Strategic/Strategic_Event_Handler.cc:54-343`)

```
sh = shipments[param]
if sh.active and dest.canDeliver and !dest.isPrimary: DropOffItemsInDestination(sh); return    // below
gridno = dest.gridno (Drassen 10112)
if FACT_NEXT_PACKAGE_CAN_BE_LOST: clear it; if Random(100) < 50: inactive; FACT_LAST_SHIPMENT_CRASHED; return
elif FACT_NEXT_PACKAGE_CAN_BE_DELAYED: FACT_LAST_SHIPMENT_WENT_TO_WRONG_AIRPORT; clear it; gridno = 2 (LOST_SHIPMENT_GRIDNO)
elif town loyalty of the sector < 20 or the sector is enemy held: inactive; FACT_AGENTS_PREVENTED_SHIPMENT; return
units = Σ counts; kulba = any line is AUTOMAG_III
close the crate (loaded map or the unloaded sector's map modifications, :35-48)
theft = FACT_PABLO_WONT_STEAL or policy pablo_wont_steal (game.json:156) → 0
        elif FACT_PABLOS_BRIBED → shipmentsSinceNoBribes /= 2; 0
        else ++shipmentsSinceNoBribes (u8); 12 + Random(4·shipmentsSinceNoBribes)
for each line: one object at the line's quality (guns emptied); for unit j:
  loaded sector:   if !stolePrevious && theft > 0 && Random(100) < theft + count → stolen (vanishes)
  unloaded sector: if j > 1 && !stolePrevious && theft > 0 && Random(100) < theft + j → stolen (put at gridno 1)
  else if gridno == 2: status = max(1, (70 + Random(11))·status/100) on the same object (compounding), added at once
  else counted for delivery
  counted units are added as stacks of perPocket (a gun recreated this way is loaded: quirk)
items: hidden (unloaded: AddItemsToUnLoadedSector; loaded: AddItemToPool)
facts: PABLOS_STOLE_FROM_LATEST_SHIPMENT = any stolen; LARGE_SIZED_OLD_SHIPMENT_WAITING cleared;
       if NEXT_PACKAGE_CAN_BE_DELAYED still set: clear MEDIUM/LARGE/REALLY_NEW
       else n = units − stolen: ≤ 5 none, ≤ 15 MEDIUM, else LARGE; REALLY_NEW; EVENT_SET_BY_NPC_SYSTEM at now + 120
inactive; StopTimeCompression(); mail: Kulba's, or the destination's (Drassen offset 198, 4 lines)
```
Draws: `[Random(100)]` loss, `[Random(4n)]` theft base, per unit `[Random(100)]` theft and `[Random(11)]` damage (short
circuit). `shipmentsSinceNoBribes` is a function static, not saved (ja2-node saves it: deviation "Bobby Ray theft
counter"). Non-primary destinations (Meduna N3, gridno 10959; `:939-1025`): enemy held → inactive silently; else crate and
stacked hidden items, no theft, no facts, no compression stop, no draws, mail offset 220; the loop bound reads shipment
`[0]`'s line count (same in V: lines are lost when shipment 0 has fewer). The Pablo follow-ups (returned goods with two
`Random(10)`, the 24-hour delay, the 70 % damage roll, Sal replacing Pablo) run from NPC actions and events
(`Strategic_Event_Handler.cc:346-474`, `Overhead.cc:2317, 5354-5356`, `Quests.cc:64-71, 498-531`; `25`).

ja2-node: the facts are the narrative fact store (`state.narrative`, `src/sim/strategic/narrative/facts.ts`); delivered
items land hidden in the sector's item state through `sector-loot.ts` `addItemsToUnloadedSector` or the loaded world's
`addItemToPool`; the crate closes through `sector-diff.ts` in an unloaded sector. Events `shipmentDelivered` and
`shipmentLost {reason: crashed | prevented | enemyHeld}`.

---

## 6. Email, history, finances, files

### 6.1 Email

**Record** (`Laptop/EMail.h:136-148`): `usOffset` (u16: the first record in `email.edt`, which is also the mail's *type*),
`usLength` (records), `ubSender` (u8), `iDate` (world minutes), `iFirstData` (i32), `uiSecondData` (u32), `fRead`. The
subject is derived from the text (not state). Senders (`:152-166`): `MAIL_ENRICO 0`, `CHAR_PROFILE_SITE 1`, `GAME_HELP 2`
(unused), `IMP_PROFILE_RESULTS 3`, `SPECK_FROM_MERC 4`, `RIS_EMAIL 5`, `6 + profile` for A.I.M. mercs 0–39 (`BARRY_MAIL 6`
… `MELTDOWN_MAIL 45`), `INSURANCE_COMPANY 46`, `BOBBY_R 47`, `KING_PIN 48`, `JOHN_KULBA 49`, `AIM_SITE 50`. ja2-node gives
each mail an `id` (arrival counter); offsets, lengths and senders come from `data/tables/laptop.json` (`mail`, `senders`).

**List**: arrival order; `AddEmail` (unread, data 0/0), `AddPreReadEmail` (read), `AddEmailWithSpecialData(off, len, sender,
date, first, second)` (`EMail.cc:492-569`). The player may delete any mail (`:1402`); sorting relinks the list in the
original, ja2-node keeps arrival order and the client sorts (deviation "Email order"). Opening a mail
(`DisplayEmailMessage`, `:986-1052`) sets `fRead` and runs `HandleAnySpecialEmailMessageEvents` and
`HandleMailSpecialMessages` (`:1641-1720`) on every display (idempotent): **the only effects of reading** are the I.M.P.
bookmark (`IMP_EMAIL_INTRO`, `IMP_EMAIL_AGAIN`) and the M.E.R.C. bookmark (`MERC_INTRO`, `MERC_NEW_SITE_ADDRESS`).
`$MERCNAME$` is `profile(uiSecondData).zName`, `$AMOUN$` is `iFirstData` as money (`:2439-2470`); the server renders
subjects and bodies, the I.M.P. results mail assembled from `impass.edt` (`src/server/mail-text.ts`,
`laptop/imp-report.ts`; its `Random(32767)` paragraph choice is deviation "Cosmetic laptop draws"). `fNewMailFlag` (general
info) is set by every added mail, pre-read ones included (`EMail.cc:562`), and cleared when the laptop closes (ja2-node
`newMail`); `fUnReadMailFlag` is derived. Save: section 10 (`u32 n`, per mail `u32 subjectSize` (Strac 0) + 44 bytes,
`LoadSaveEMail.cc`).

**Catalogue** ("data" = special data; no mail other than the four above has an effect when read):

| Mail | Sent by (condition) | Data |
|---|---|---|
| `OLD_ENRICO_1/2/3`, `RIS_REPORT` (pre-read) | `InitNewGame` (`Game_Init.cc:230-233`) | — |
| `IMP_EMAIL_INTRO` | `InitNewGame` if `CanCreateAnotherIMPCharacter` (`:235-238`; V always) | — |
| `IMP_EMAIL_AGAIN` | `HAVENT_MADE_IMP_CHARACTER_EMAIL` (74) handler (`Laptop.cc:1456-1464`): if still allowed and not sent, set `fSentImpWarningAlready` | — |
| `IMP_EMAIL_PROFILE_RESULTS` | `DAY2_ADD_EMAIL_FROM_IMP` (19) if `send_profile_results_email` (`Game_Event_Hook.cc:129-136`) | first = profile (V: 0) |
| `ENRICO_CONGRATS` | first landing (`Map_Screen_Interface.cc:3665`) | — |
| `MERC_INTRO`, `MERC_NEW_SITE_ADDRESS` | §3.1 | — |
| `MERC_FIRST_WARNING`, `MERC_WARNING`, `MERC_INVALID` | §3.5 | — |
| `NEW_MERCS_AT_MERC` | §3.2 | — |
| `MERC_UP_LEVEL_*` (10, `MERC_UP_LEVEL_BIFF + 2·k`) | event 77 (§3.5) | — |
| `AIM_REPLY_*` (40, `AIM_REPLY_BARRY + 2·id`) | §2.2 (merc back, message left); sender `6 + id` | — |
| `MERC_DIED_ON_OTHER_ASSIGNMENT` | §2.2 (AIM profiles only) | second = profile |
| `AIM_MEDICAL_DEPOSIT_REFUND`, `_PARTIAL_REFUND`, `_NO_REFUND` | §2.7 | first = amount, second = profile |
| `INSUR_PAYMENT`, `INSUR_SUSPIC`, `INSUR_SUSPIC_2`, `INSUR_INVEST_OVER`, `INSUR_1HOUR_FRAUD` | §7.2 | first = payout, second = profile |
| `BOBBYR_NOW_OPEN` | §5.1 | — |
| `BOBBYR_SHIPMENT_ARRIVED`, `JOHN_KULBA_GIFT`, `BOBBY_R_MEDUNA_SHIPMENT` | §5.5 (offsets also in `shipping-destinations.json`) | — |
| `ENRICO_PROG_20/55/80`, `ENRICO_SETBACK`, `_SETBACK_2`, `ENRICO_CREATURES`, `LACK_PLAYER_PROGRESS_1/2/3` | `HandleEnricoEmail` (`Strategic_Status.cc:246-376`; the decision tree is `economy/inactivity.ts`; lack of progress also writes `HISTORY_ENRICO_COMPLAINED`) | — |
| `ENRICO_MIGUEL` | NPC action → `SET_BY_NPC_SYSTEM` next day `390 + Random(60)` (`Interface_Dialogue.cc:3464-3465`, `25`) | — |
| `KING_PIN_LETTER` | Kingpin money chain (`Strategic_Event_Handler.cc:476-592`, `Random(120)` reposts, `25`) | — |

### 6.2 History

**Record** (`Laptop/History.cc:32-39`): `ubCode`, `ubSecondCode` (usually a profile, a town or a quest), `uiDate` (minutes),
sector `(x, y, z)` or `(−1, −1)`; appended by `AddHistoryToPlayersLog` (`:111-122`); save section 8 (12-byte records; V
writes z = 0 and a colour byte). Codes (`History.h`, 0–77) and their writers: hired from A.I.M. 1 / M.E.R.C. 2 (§2.5,
§3.3); merc killed 3, or 77 when killed by our team (`Strategic_Merc_Handler.cc:66-68`); settled M.E.R.C. account 4;
character generated 6 (§4.3, second code 0); insurance purchased 7, payout 9 (8 unused); contract extended 10–12 (`22`);
fired 13, quit 14, contract expired 22, Slay left 76 (`StrategicRemoveMerc :677`, not for the dead); quest started 15 and
finished 16 (`Quests.cc:1113, 1137`; not for `QUEST_HELD_IN_ALMA`); miner talk and mine events 17, 26–29
(`Strategic_Mines.cc:283-287`, second code = town); liberated town 18; cheat 19; Enrico complained 24; battle results 25,
64–73 (`LogBattleResults`, `PreBattle_Interface.cc:1391-1426`, by encounter code and outcome); RPC joined 23; Walker 20,
married off 21, Tixa/Orta 30/31, rocket rifles 32, Deidranna's dead bodies 33, boxing matches 34, something in the mines
35, NPC info 36–58, boxing results 59–61, found money 62, assassin 63, NPC killed 74, Carmen's head 75 (`25`). Which of
them ja2-node writes: deviation "History writers". The row texts are rendered by the server (`src/server/history-labels.ts`).

**Logic reader**: only `GetTimeQuestWasStarted(quest)` (`History.cc:737-753`: the date of the first `QUEST_STARTED` with
that second code, 0 if none; `records.ts` `timeQuestWasStarted`), used by `FACT_BLOODCAT_QUEST_STARTED_TWO_DAYS_AGO`
(`Quests.cc:876-878`, `25`). Everything else is a record for the player.

### 6.3 Finances

The ledger is `src/sim/campaign/finances.ts` (codes 0–27, the cost-to-date code set, records `{code, secondCode, minute,
amount, balanceAfter}`, `docs/18` §3.9). Codes written by the laptop: `ANONYMOUS_DEPOSIT` (starting cash), `HIRED_MERC`,
`MEDICAL_DEPOSIT`, `BOBBYR_PURCHASE` (second code 0), `PAY_SPECK_FOR_MERC`, `IMP_PROFILE`, `PURCHASED_INSURANCE`,
`EXTENDED_INSURANCE`, `INSURANCE_PAYOUT`, `PURCHASED_FLOWERS` (0), `FULL_MEDICAL_REFUND`, `PARTIAL_MEDICAL_REFUND`; by others:
`EXTENDED_CONTRACT_*` and `PAYMENT_TO_NPC` (`22`), `TRANSFER_FUNDS_TO_MERC`/`MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT`
(inventory money, `12`), `PURCHASED_ITEM_FROM_DEALER` (`23`). Never written: `ACCRUED_INTEREST` (there is no interest),
`TRANSACTION_FEE`, `REDUCED_INSURANCE`, `CANCELLED_INSURANCE`, `NO_MEDICAL_REFUND`, `TRANSFER_FUNDS_FROM_MERC`,
`DEPOSIT_FROM_GOLD_MINE` (all mine income is `DEPOSIT_FROM_SILVER_MINE`, `Strategic_Mines.cc:538`). `uiTotalCostToDate`
also changes outside the ledger: +charge on M.E.R.C. payment (§3.4) and money handed to NPCs (`TacticalAI/NPC.cc:878,
928`, `25`).

Game logic reads only the balance. The "yesterday/today" summaries (`Finances.cc:989-1294`) are display, computed by
`src/sim/campaign/finance-summary.ts` so their quirks stay out of the client: the functions walk the ledger from the newest
record backwards with UINT32 day numbers (day − 1 and day − 2 wrap on days 0 and 1); "yesterday's" opening balance
(`GetPreviousDaysBalance`) subtracts a day and then looks for a record of day − 2, three days back, and is 0 before day 3;
yesterday's closing balance is the balance after the newest record of yesterday, or 0 on a day without records;
yesterday's sums count the first record of the day before yesterday too; today's sums re-arm their flag on every record of
today, so they count every matching record of today and, when today's oldest record does not match, yesterday's newest
record if it matches; the debits are what the balances leave over. `GetProjectedTotalDailyIncome` is
`PredictIncomeFromPlayerMines`. The ledger row labels (`ProcessTransactionString`, `Finances.cc:777-825`) are rendered by
the server in the session's display language (`src/server/finance-labels.ts`): `pTransactionText` verbatim (a silver-mine
deposit shows the gold-mine text), the profile's nickname for the codes that name a merc, the detailed sector label for
militia training.

### 6.4 Files

Records `{ubCode, fRead}`, added idempotently by code (`Files.cc:310-326`); save section 9. `ENRICO_BACKGROUND` (0) at laptop
init (`GameInitFiles`, `:184-192`); the six terrorist files (1–6) when Carmen's NPC action runs (`AddFilesAboutTerrorists`,
`:1009-1015`, all six regardless of which are active; `25`). Showing a file sets `fRead` (`DisplayFormattedText`; ja2-node
`readFile {code}`). No other logic.

---

## 7. Insurance, florist, funeral, personnel

### 7.1 Life insurance

Soldier fields: `usLifeInsurance` (0/1), `iStartOfInsuranceContract` (a day), `iTotalLengthOfInsuranceContract` (days),
`uiStartTimeOfInsuranceContract` (minute). Profile `ubSuspiciousDeath` (`SUSPICIOUS 1`, `VERY_SUSPICIOUS 2`). Strategic
status `insuranceInvestigations` (`ubInsuranceInvestigationsCnt`). Payout queue `pLifeInsurancePayouts[] {fActive,
ubSoldierID, ubMercID, iPayOutPrice}` + `ubNumberLifeInsurancePayoutUsed` (saved after the laptop block if non-zero,
`Laptop.cc:3317-3321, 3410-3418`). All in `Laptop/Insurance_Contract.cc` (ja2-node `insurance.ts`); identical in V. The
contract side (extension prompt, death hooks) is `22` §7.

Helpers (all **UINT32** returns, ported with `u32`):
- `contractDaysLeft(s)` (`GetTimeRemainingOnSoldiersContract`, `:1059-1076`): `d = endOfContract/1440 − 1`, `+1` if
  `endOfContract % 1440`, `− day`; capped at `totalContractLength`; a negative value wraps.
- `insuranceDaysLeft(s)` (`:1043-1056`): 0 if uninsured; `total` if `day < start`; else `total − (day − start)`.
- `insuranceLength(s)` (`CalculateSoldiersInsuranceContractLength`, `:1160-1200`): 0 if the profile is dead; 0 if `c < 2 &&
  !(insured && c ≥ 1)` (`c` = contract days left); `len = c − i` if insured or `didGameJustStart`, else `c − i − 1`; then
  `i + len ≤ c`; `len ≥ 0`; 0 if insured, `start ≥ day` and `len < 2`.
- Insurable (`MercIsInsurable`, `:1007-1027`): AIM mercs only, not POW, and `insuranceLength > 0` or already insured; the
  accept button needs `insuranceLength > 0` (`:1030-1040`). The contract page shows one of two "nobody to insure" texts by
  whether any A.I.M. merc is on the team.

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
There is no reduce, cancel or refund. **Daily** (`HANDLE_INSURED_MERCS` 13, 00:00; `DailyUpdateOfInsuredMercs`,
`:675-698`): an insured soldier with `day ≠ start`, `insuranceDaysLeft == 0` (u32) and a living profile loses all three
fields; no renewal charge.

### 7.2 Death, payout, investigation

At death (`StrategicHandlePlayerTeamMercDeath`, `Strategic_Merc_Handler.cc:94-112`; `19` §3.7 and `22` §4.9 own the rest of
it), if insured and **not on the autoresolve screen**: `now ≥ startTime && now − startTime < 60` → `VERY_SUSPICIOUS`; else
killed by our team or `!fEnemyInSector` → `SUSPICIOUS`; then `AddLifeInsurancePayout` (`:835-912`):
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
  because of the counter gets both mails); `used--`; slot inactive. ja2-node emits `insurancePaid`.
- Deaths during autoresolve never set a suspicion (keep).

### 7.3 Florist and funeral

- **Funeral** (`Funeral.cc`): text; sets its bookmark. No logic.
- **Florist** (`Florist_Order_Form.cc`): price = bouquet price + the destination's `flowersNextDayDeliveryCost` or
  `flowersWhenItGetsThereCost` (`shipping-destinations.json`) + extras {crushed 10, black roses 20, wilted 10, fruit cake
  10} (`:191, 611-655`). The bouquet price (10 bouquets) is the price column of the localized gallery text
  `binarydata/flowerdesc.edt`, read with `sscanf("%hu")` (`:641-642`); ja2-node reads it at content load
  (`LaptopContent.bouquetPrices`; 0 when the text is absent). Send (`BtnFlowerOrderSendButtonCallback`, `:472-498`): ledger
  `PURCHASED_FLOWERS −price` with **no balance check** (inferred: none found); if the destination's delivery sector is in
  Meduna: `HandleFlowersMeanwhileScene(nextDay ? 0 : 1)` (`Strategic/Meanwhile.cc:693-716`, `26`): once per game
  (meanwhile flag), the FLOWERS meanwhile at `now + 60·(20 + Random(5))` or `now + 60·(24 + Random(48))`. The order number
  (`uiFlowerOrderNumber`, display only) grows by `1 + Random(5)` on entering the order form (`EnterFloristOrderForm`,
  `:300`) and by `1 + Random(2)` after the charge and the meanwhile on sending, both on the main stream; ja2-node draws the
  first at `visitSite {site: floristOrderForm}` and the second at the end of `orderFlowers`, which answers the number
  before that step (deviation "Florist order form entry": an agent may skip the entry draw). No NPC, loyalty or opinion
  effect.

### 7.4 Personnel

Display plus three departed lists (`ubDeadCharactersList`, `ubLeftCharactersList` (fired or POW),
`ubOtherCharactersList`, 256 × INT16 each): `StrategicRemoveMerc` adds the profile (`Merc_Contract.cc:628-640`; marriage,
`Interface_Dialogue.cc:2466`); `RemoveNewlyHiredMercFromPersonnelDepartedList` clears the first match on re-hire
(`Personnel.cc:1960-1990`, leaves holes). Nothing else reads them. Money transfers to and from mercs are inventory
actions, not laptop ones.

The page shows the profile counters; `battlesFought` (`usBattlesFought`) grows for every merc of an autoresolve battle when
it closes (dead, captured or not) and for every merc in the sector when a tactical battle with enemies, creatures or
civilians in it is won (not a boxing match). The server builds the page's blocks (`src/server/personnel-view.ts`, `04`
§6).

---

## 8. A new game from the start

### 8.1 The original sequence

1. **`InitNewGame`** (`Game_Init.cc:200-277`, `docs/15` §4.2), laptop parts in order: `LoadMercProfiles` (per profile
   `InitProfileFromContent`: status from the text check, medical deposit, gun replacement without gun nut, kit cost; then
   `DecideActiveTerrorists` (draws, `25`) and `StartSomeMercsOnAssignment` (§2.2, draws)); `InitAllArmsDealers` (`23`,
   draws); `InitBobbyRayInventory` (§5.2, draws); `InitLaptopAndLaptopScreens` (finances and history cleared,
   `fIMPCompletedFlag`, `fBobbyRSiteCanBeAccessed` false); `InitStrategicLayer`; `SetLaptopNewGameFlag`; the four pre-read
   mails and the I.M.P. intro; starting cash (45000/35000/30000); the M.E.R.C. online day draw; pending screen `LAPTOP`.
   The laptop-wide init (`LaptopScreenInit`: zeroed `LaptopSaveInfo`, `gubLastMercIndex = 5`, the `ENRICO_BACKGROUND` file,
   empty bookmarks) runs at program start or in `ReStartingGame` (`Game_Init.cc:291-354`).
2. **The laptop at Day 1 01:00**, clock paused: four read mails and the unread I.M.P. intro, A.I.M. bookmarked. Every hire
   (A.I.M., or I.M.P. after opening its mail) arrives Day 1 07:00 (shown 07:30) and the letter goes to soldier 0 whoever it
   is; insurance needs ≥ 2 contract days (start day tomorrow); a Bobby Ray's visit (under construction) arms the "now
   open" mail. M.E.R.C. is not online yet with default policy (`d ≥ 1`).
3. **Leaving** (§1.3): the map screen at Day 1 01:00, compression X0. Without a hire compression is refused
   (`atLeastOneMercHired`); the landing zone cannot be moved; the laptop can be re-opened (every hire before the landing
   still arrives at 07:00).
4. **The first compression** → `HandleTimeCompressWithTeamJackedInAndGearedToGo` → start sector load, six-hour warp,
   arrivals at 07:00 (`MercArrivesCallback` × n in hire order), `ENRICO_CONGRATS`, tactical with the helicopter run
   (`docs/15` §4.5).

### 8.2 In ja2-node

`initNewGame` (`src/sim/campaign/new-game.ts`) follows that order: `LaptopFlow.resetForNewGame` (the `LaptopScreenInit`
part: fresh `LaptopState`, `MakeNewMercsAvailable(false)`, the `ENRICO_BACKGROUND` file, `atLeastOneMercHired = false`);
`loadMercProfiles` (`src/sim/campaign/profiles.ts` `initProfileFromContent`); `initNewGameProfiles` (undeclared profiles
reset to empty structs, `decideActiveTerrorists`, `startSomeMercsOnAssignment`); `initAllArmsDealers`; `initBobbyRay`;
`initLaptopScreens`; `setupNewStrategicGame`, the quest engine and `initStrategicLayerMap` (with `InitNPCs`' placement draws
and alternate maps, so the M.E.R.C. day draw is in the original's place); the clock at X0; the new-game mails; the starting
cash; the M.E.R.C. day draw and event; `didGameJustStart = true`; `openForNewGame` (`flow = 'laptop'`, the A.I.M. bookmark).
The first landing is `hiring.ts` `teamJackedInAndGearedToGo` (start sector load, the six-hour warp, `ENRICO_CONGRATS`).

The session factory (`src/server/campaign-factory.ts`, `04` §6) hires through the same commands: `campaign.hire [{profile,
contract? (default 7), gear?}]` as `aimHire` commands (a refusal fails session creation), `campaign.imp` as `readEmail` of
the I.M.P. intro plus `impCreate`, then `closeLaptop` and, unless `land: false`, the first compression; without `hire` it
hires from `DEFAULT_AIM_SQUAD` (`[0, 3, 4, 7, 14, 16]`; on stubs A.I.M. stubs 0–11) whatever the starting cash and the
refusals allow, up to `campaign.mercs` (default 6, on stubs 4); `hire: []` without `imp` leaves the session in the laptop
for the agent or the UI. Every
new-game draw shifts all later draws: new-game tests pin values with a scripted RNG (`docs/15` §4.6).

---

## 9. Determinism

### 9.1 Draws

| Site | Stream | Draws (in order) |
|---|---|---|
| New game: `StartSomeMercsOnAssignment` | main | per AIM/MERC profile in id order `Random(100)`, `[Random(6 + exp/2)]` |
| New game: Bobby Ray stock | main | per new slot `max × Random(100)`; per used slot `max × Random(100)`, `[Random(60)]` |
| New game: M.E.R.C. day | main | `Random(max − min + 1)` |
| `closeLaptop` | main | `[Random(4)]` I.M.P. reminder |
| `aimHire`, `mercHire`, `impCreate` | main (+pre) | soldier creation (`06`); I.M.P.: `Random(k)` attitude, `Random(n)` ×1–2 skills, `PreRandom(100)` helmet; `mercHire`: `CoinToss` thank-you quote |
| Arrival (`MercArrivesCallback`) | main | `[Random(660)]` equipment complaint |
| `MERC_DAILY_UPDATE` profile loop | main + pre | per profile in id order: improvement (`Random(100)` or `Random(10)`,`[Random(100)]`, `Random(n)`…, `PreRandom` per stat chance), `[PreRandom(1000)]` death, `[Random(100)]`, `[Random(6 + exp/2)]` (`22` §8.1) |
| Departure (`StrategicRemoveMerc`) | main | `Random(2)`, `[Random(4)]` hangover, `[Random(6 + exp/2)]` |
| `DAILY_UPDATE_OF_MERC_SITE` | main | `[Random(180)]`, `[Random(100)]` |
| M.E.R.C. account, opening | main | `Random(99999)`; opening `Random(100)`, `Chance(50)`, `Random(4)`, `Random(2)` (Biff) |
| Level-up of a hired M.E.R.C. merc | main | `Random(60)` |
| Bobby Ray daily (09:00) | main | new: sells `Random(100)` per unit, reorders `Random(100)`, `[Random(3)]`, `[Random(720)]`; used: sells, reorders `Random(100)`, `[Random(720)]`; then dealers (`23`); restock event `[Random(60)]` |
| Bobby Ray order | main | `[Random(5)]` (Sal dead), `Random(4)` |
| Bobby Ray delivery | main | `[Random(100)]` loss, `[Random(4n)]`, per unit `[Random(100)]`, `[Random(11)]` |
| Insurance | main | `[Random(3)]` investigation length |
| Florist | main | order form entry `Random(5)`; send: Meduna meanwhile `[Random(5)]` or `[Random(48)]`, then `Random(2)` |

### 9.2 Wall clock and UI-driven draws, and their replacements

| Original | ja2-node |
|---|---|
| A.I.M. impatience: `GetJA2Clock` escalation, annoyance statuses, `Random(600)` reset event | not simulated; statuses and the event kept for imports (deviation "A.I.M. annoyance") |
| Speck's opening on a UI timer after the video; `CoinToss` after a hire | `visitSite merc` or the first M.E.R.C. command of a laptop session; the toss at `mercHire` (§3.6, deviation "Speck's opening") |
| `HandleIMPCharProfileResultsMessage` `Random(32767)` on every display (`EMail.cc:1896`); the A.I.M. conference distortion `Random(200)` (`AIMMembers.cc:1973`) | not drawn on the main stream (deviation "Cosmetic laptop draws") |
| HD light flicker `Random(2)` per 50 ms of page loading (`Laptop.cc:2404`), ad rotation, page load waits, blinking | client only |
| Bobby Ray "ship to X?" box, cart kept across pages | the command carries the order; no prompt |
| Arrival rerouted / landing zone reset message boxes | events (`arrivalRerouted`, `landingZoneReset`), no prompt |
| `ubShipmentsSinceNoBribes` function static (not saved) | saved state (deviation "Bobby Ray theft counter"; the original keeps it across loads and new games of one process) |

---

## 10. Data and stubs

**Used directly** (`data/externalized/`): `mercs-profile-info.json` (types), `mercs-MERC-listings.json` (order, unlock
thresholds, Speck quote ids), `mercs-AIM-listings.json` (display order), `imp.json`, `game.json` (`imp.*`, `merc_online_*`,
`starting_cash_*`, `unhired_merc_deaths_*`, `pablo_wont_steal`, `campaign.start_sector`), `bobby-ray-inventory-new.json`/
`-used.json`, `shipping-destinations.json` (rates, flower costs, delivery flags, sectors, gridnos, mail offsets),
`items.json`/`weapons.json`/`magazines.json`/`armours.json` (price, weight, coolness, per pocket, flags, standard
replacements). Loaded by `src/content/strategic/laptop-content.ts` (`LaptopContent`).

**Transcribed** (regenerate, never edit): `data/tables/laptop.json` by `tools/transcribe/laptop.ts`: `mail` (every
`email.edt` record define of `Laptop/EMail.h:15-166`, offsets and lengths by name), `senders`, `impQuiz`
(`IMP_Personality_Quiz.cc:424-562`, §4.2), `profiles` (the profile ids the laptop code names: `NAILS`, `BIFF`, `FLO`,
`BUBBA`, the two Larrys, `NUMB`, `COUGAR`, `SAL`, `CARMEN`, …) and `terrorists` (`g_terrorist_infos`, `25`). The dealer sort
and staple tables are `data/tables/merchant-tables.json` (`23`). Enums (merc and account status, insertion codes,
contract types, history codes in `records.ts` `History`) and the scalar constants of §2–§7 are named constants in the
modules.

**From the user's data, never committed**: the `prof.dat` fields of §0; the bouquet prices (`binarydata/flowerdesc.edt`);
mail, file and bio texts (rendered by the server from the VFS).

**Stubs** (CI has no `prof.dat`): `stubs/profiles.json` (invented, read by `src/content/formats/stub-profiles.ts` when
`prof.dat` is absent): A.I.M. profiles 0–11 with salaries, deposit flags, inventories and tolerances (profile 0 has
`bDeathRate 101`, hated pairs among them), M.E.R.C. profile 42 and NPC stand-ins; invented laptop texts (`stubs/text/`:
`email.json`, `imptext.json`, `aimbios.json`, `mercbios.json`, `laptop-pages.json` with bouquet descriptions and prices).
Bobby Ray, the I.M.P. gear and the letter use the externalized item tables. Delivery needs no map when the airport sector is
not loaded (`sector-loot.ts`).

---

## 11. Implementation in ja2-node

### 11.1 State and content

`StrategicState.laptop` (§0) is plain data in the strategic state, saved with it and imported from native saves
(`src/content/formats/savegame-laptop.ts` reads section 4 with the Bobby Ray lists and insurance payouts, the shipments
section, the history, files and email sections, the I.M.P. slot states and voices, the landing zone; `laptop/save-import.ts`
`importLaptop` applies them with the general info's `fNewMailFlag`, the facts and the quests). Profile state is
`StrategicState.profiles` (`ProfileProgress`), contract state `RosterMerc.contract`. `LaptopContent` (§10) is read-only.

### 11.2 Modules (`src/sim/campaign/laptop/` unless noted)

| Module | Responsibility |
|---|---|
| `laptop-state.ts` | `LaptopState`, bookmarks, account and visit constants |
| `laptop-flow.ts` | `LaptopFlow` (implements `LaptopContext`): the flow (§1.3), the command and query dispatch, the laptop event handlers, the new-game hooks (§8.2), `mercArrives` (§2.6 steps 1–6), the mails and personnel entries of contract events, Enrico's mails, `logBattleResults` |
| `context.ts`, `events.ts` | `LaptopContext` (state, content, roster, `main`/`pre` streams, clock, mail/history/money helpers); the laptop event types |
| `mail.ts`, `records.ts` | mail specs, add/read/delete and the reading bookmarks; history, files, personnel lists, `timeQuestWasStarted` |
| `profile-state.ts` | `calcCompetence`, `calcMedicalDeposit`, `isMercHireable`, `isMercDead` |
| `hire.ts` | `hireMercCore` (= `HireMerc` without the contract fields), `numberOfMercsOnPlayerTeam`, the landing zone, `checkForValidArrivalSector`, `handleAirspaceControlUpdated` |
| `aim.ts` | contact, face state, charge, `aimHire`, `aimHireCheck`, leave message, `startSomeMercsOnAssignment`, `decideActiveTerrorists` |
| `merc-site.ts` | listings, unlocks, the site's daily part, outage, Speck's opening and quotes, account, `mercHire`, `payMercAccounts` |
| `imp.ts`, `imp-report.ts` | slots, code check, quiz, attitude, skills, attributes, gear, `impCreate`; the I.M.P. results mail text |
| `bobby-ray.ts` | lists, stock, restock, prices, quotes, orders, shipments, Kulba's gift, delivery |
| `insurance.ts`, `florist.ts` | §7.1–§7.2; §7.3 |
| `save-import.ts` | native save import |
| `src/sim/campaign/contracts/` | `hire-contract.ts` (contract fields at hire and arrival, the complaint draw, hated arrival quotes), `contract-times.ts` (`mercArrivalTimeOfDay`, contract end), `departure.ts` (the refund), `merc-account.ts` (the account part of the daily site update), `daily.ts` (the profile loop), `salary.ts` (`22`) |
| `src/sim/campaign/relations/hiring-check.ts` | `canMercBeHired` (`22` §5.4) |
| `src/sim/campaign/` | `profiles.ts` (`initProfileFromContent`, `loadMercProfiles`), `new-game.ts`, `hiring.ts` (`teamJackedInAndGearedToGo`; `hireMerc`/`mercArrives` hire without a laptop for tests and campaigns built without one), `finances.ts`, `finance-summary.ts` |
| `src/server/` | `laptop-view.ts` (the laptop view), `mail-text.ts`, `history-labels.ts`, `finance-labels.ts`, `personnel-view.ts`, `campaign-factory.ts` (`04` §6) |

### 11.3 Wiring

`CampaignSim` owns one `LaptopFlow` and passes it every command after the story refusals and the talk and shop flows,
before the battle flow (laptop commands, queries, `openLaptop`, `setLandingZone`, and the laptop refusal of everything else
while open). `LaptopFlow.register` handles the event kinds
`DAY3_ADD_EMAIL_FROM_SPECK`, `DAY2_ADD_EMAIL_FROM_IMP`, `HAVENT_MADE_IMP_CHARACTER_EMAIL`, `AIM_RESET_MERC_ANNOYANCE`,
`BOBBYRAY_PURCHASE`, `UPDATE_BOBBY_RAY_INVENTORY`, `MERC_SITE_BACK_ONLINE`, `MERC_SITE_NEW_MERC_AVAILABLE`,
`HANDLE_INSURED_MERCS`, `PAY_LIFE_INSURANCE_FOR_DEAD_MERC`, `INSURANCE_INVESTIGATION_STARTED`/`_OVER`,
`DELAYED_HIRING_OF_MERC` and `ENRICO_MAIL`; `CampaignSim` registers `DAILY_UPDATE_BOBBY_RAY_INVENTORY` itself, running
Bobby Ray's update (`bobbyRayDaily`) before the dealers'. The contract flow calls it through `ContractHooks` (insurance cost, purchase and payout, the site's daily part,
Larry's relapse, Speck's lost-merc flag, history, mails and personnel lists); the strategic layer through
`surfaceSectorTaken` (§5.1) and `airspaceControlUpdated` (§2.6); NPC actions through `addJohnsGunShipment` and
`terroristFiles`; the florist through `scheduleFlowersMeanwhile`.

### 11.4 Verification

Unit tests next to the modules (`laptop.test.ts`, `rules.test.ts`, `profile-state.test.ts`, `imp-report.test.ts`,
`save-import.test.ts`) and server tests on stubs and original data (`src/server/laptop-*.test.ts`). The oracle's laptop and
florist probes (`tools/oracle/probes/laptop.txt`, `florist.txt`, `laptop-compare.ts`; `tools/oracle/README.md` "Laptop")
replay the traced draws of full new games, the arrival table, A.I.M., M.E.R.C. and I.M.P. hires, Bobby Ray's restocks,
orders and deliveries, insurance and florist orders on the user's saves, and diff the laptop, the team's contract fields
and the profiles.

---

## 12. Quirks to keep, deviations, unverified

**Quirks to keep** (Strac behaviour, each described in its section):
- Hiring and arrival (§2.5–§2.6): displayed arrival 07:30 vs real 07:00 for the first squad, contract hour from the
  displayed time, contract end recomputed at arrival; row P never chosen by `CheckForValidArrivalSector`, truncated
  `hypot`; M.E.R.C. insertion `NORTH`; the Nails jacket (not V); kit cost per slot, zeroed for good once bought.
- Money (§2.5, §2.7): `HIRED_MERC` = salary + kit, `MEDICAL_DEPOSIT` separate; refund from the paid deposit, half up; the
  dead get a mail with the deposit as amount and no money.
- Status (§2.1–§2.3): `CalcDeathRate` wraps at 256; buddies override death rate and reputation; hated time ≥ 24
  tolerated; `MERC_HAS_NO_TEXT_FILE` overwritten at new game; I.M.P. characters carry −1; the away roll by `id < 40`,
  open to `FIRED_AS_A_POW`; the countdown's end resets any non-POW status.
- M.E.R.C. (§3): the new-merc event reposted every midnight; `!=` tests move suspended back to warning; re-hiring erases
  unpaid days; a dead merc's unpaid days stay owed.
- I.M.P. (§4): helmet `wisdom ≥ PreRandom(100)` (V `<`); `Random(k)` for a single winning attitude; swap-removal before the
  skill draws; the too-many-mercs return counts as success.
- Bobby Ray (§5): Strac's JSON rates (V: Drassen 500/200/100, Hong Kong standard 30 instead of 300) and used caps (22 items
  copy the new amount; V 1) kept per D1; a cart line can reach 201; the slot-0 reuse, the Meduna loop bound, the used
  restock without +1000, reloaded guns in recreated stacks, money taken for non-delivering destinations, deliveries on the
  hour.
- Insurance and florist (§7): the length added although the purchase was refused; no balance check on extensions or
  flowers; autoresolve deaths never suspicious; a fraud slot never freed.

**Deviations** (full entries in `deviations.md`): "A.I.M. annoyance", "Speck's opening", "Cosmetic laptop draws",
"Cosmetic face and frame draws", "Soldier creation draws", "Email order", "I.M.P. empty skill list", "I.M.P. skill page and
saved profiles", "Laptop as commands", "Speck payment record", "Bobby Ray theft counter", "Bobby Ray's shipment prices",
"Florist order form entry", "History writers". The canvas pages' own differences are listed there too (`28` §9).

**Limitations**: the content identity hashes text files by presence, so a data folder whose florist gallery text carries
other bouquet prices is not told apart from the one a save was made with.

**Unverified** (inferred, still matters):
- that the map screen, and so the laptop, is reachable during a tactical battle in the original;
- the stale values of a restart in one process (M.E.R.C. index, Bobby Ray progress, I.M.P. `L[0]`), which ja2-node replaces
  with fresh-process values;
- that `CalcDeathRate`'s float never rounds across an integer;
- that the I.M.P. attribute page reaches exactly the sets `impCreate` accepts;
- the used-restock bug's effect (§5.2); that I.M.P. mercs are never paid; that re-hiring a M.E.R.C. merc erases his debt;
- that the FLOWERS meanwhile has no implications (`26`).
