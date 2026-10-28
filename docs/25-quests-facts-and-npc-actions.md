# 25 — Quests, facts and NPC actions

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `V:` is vanilla `Build/`. Short file names:
**ID** `Tactical/Interface_Dialogue.cc`, **Q** `Strategic/Quests.cc`, **F** `Strategic/Facts.h`, **NPC** `TacticalAI/NPC.cc`,
**SEH** `Strategic/Strategic_Event_Handler.cc`, **SM** `Strategic/StrategicMap.cc`, **OH** `Tactical/Overhead.cc`, **OL**
`Tactical/OppList.cc`, **SCH** `Strategic/Scheduling.cc`, **DA** `TacticalAI/DecideAction.cc`, **HELI**
`Strategic/Map_Screen_Helicopter.cc`, **SIL** `Tactical/Soldier_Init_List.cc`, **SP** `Tactical/Soldier_Profile.cc`, **BOX**
`Tactical/Boxing.cc`, **KEYS** `Tactical/Keys.cc`, **HD** `Tactical/Handle_Doors.cc`, **HU** `Strategic/Hourly_Update.cc`. JSON
files are `data/externalized/*.json`. "(inferred)" marks conclusions not traced end to end. C integer semantics apply (`idiv`,
`u8`/`i8` wraps). `Random`/`Chance` are the `main` stream, `PreRandom` the `pre` stream (`01` §3.6); `Random(0)` returns 0
without drawing; `Chance(x)` is `Random(100) < x`. Times are world minutes unless marked; "day d hh:mm" is minute
`d·1440 + hh·60 + mm`. `AddFutureDayStrategicEvent(kind, m, p, n)` posts at minute `(day + n)·1440 + m`
(`Strategic/Game_Events.cc:164-169`, so `m ≥ 1440` spills into later days); `AddSameDayStrategicEvent(kind, m, p)` at
`day·1440 + m` (`:159-162`). Profile names (`MIGUEL`, `KINGPIN`, …) are Stracciatella's internal names; their ids come from
`mercs-profile-info.json` (`MIGUEL 57` … `MANNY 155`, vehicles `PROF_HUMMER 160`, `PROF_ICECREAM 162`, `PROF_HELICOPTER 163`).
Sectors are written `C5`; `C5-1` is level 1 below it; sector comparisons include z (`C5` means z 0) unless marked. Record
numbers ("record 13") index an NPC's quote records (`24`); no record or quote text appears here.

**Scope.** `24` owns NPC profile and record data, record selection (`NPCConsiderQuote`, approaches, opinion, the
quest-status encoding of records), the talk interface, the dialogue queue and the **dispatch** of NPC actions (`NPCDoAction`
queueing, `NPCGotoGridNo`, `NPCReachedDestination`, `TriggerNPCRecord`, `HandleNPCTriggerNPC`, record-level
`TELEPORT_NPC`/`REMOVE_NPC`), civilian quotes, recruiting through dialogue (`RecruitRPC`) and the "declare hostility" quote
list. This doc owns what each action **does** once dispatched, the facts and quests that records read and write, strategic
NPC presence, schedules, civilian groups, boxing, keys and locks, EPCs, the robot, the helicopter and the quest-specific
campaign rules. `26` owns meanwhile scenes, the Queen, Elliot and Joe, the endgame and game over (their actions are only
listed in §3.10). `21` owns the laptop (email, history, files, Bobby Ray's delivery and the Pablo theft rules), `22`
contracts (it delegates Slay, Larry, Iggy and EPC departures here), `23` merchants (it delegates the dealer facts, Tony's
and Devin's presence and shop hours here). `15` owns the event queue and the order of hourly/daily handlers, `16` squads,
groups, travel and sector transitions, `17` the Queen (`ExecuteStrategicAIAction`), `18` loyalty, mines, assignments and
the hospital assignment, `19` battles, capture and the first-battle bookkeeping, `09`/`13` the AI (this doc fills the
`DecideActionSchedule` hook), `07` doors and pathing, `11` attacks and `StatChange`, `12` items. The agent API of these
systems (the `door`, `unescort`, `heliRoute`/`heliCancel`, `boardVehicle`/`leaveVehicle` commands, the `npcRequest`
decision, the narrative events and view fields) is in `04` §6.

---

## 0. State

**Facts and quests** (save section "quests", `Q:1209-1226`; ja2-node `StrategicState.narrative`, §14.1):

| Field | Original | Notes |
|---|---|---|
| `facts: Uint8Array(500)` | `gubFact[NUM_FACTS]` (`Quests.h:14`, `Q:39`) | a byte per fact id 0..499; values 0/1, and 2 for the two "available to army" facts (§1.1). Computed facts write their result back (§1.3) |
| `quests: Uint8Array(30)` | `gubQuest[MAX_QUESTS]` (`Quests.h:12`) | `NOT_STARTED 0`, `IN_PROGRESS 1`, `DONE 2` (`Quests.h:8-10`) |

**NPC fields of the campaign profile** (save section 5, `Tactical/LoadSaveMercProfile.cc`; the mutable `gMercProfiles[]`;
ja2-node `ProfileProgress`, `src/sim/tactical/profiles.ts`; `24` uses the record and approach fields):

| Field | Original | Used by |
|---|---|---|
| `sectorX/Y/Z` | `sSector` (x, y u16 and z i8, `Tactical/LoadSaveMercProfile.cc:83-84, 181`; `bSectorZ` is unused) | presence (§4); x = y = 0 is nowhere |
| `town`, `townAttachment` | `bTown`, `bTownAttachment` | loyalty facts (§1.3), head miners (`18`) |
| `npcData`, `npcData2` | `bNPCData`, `bNPCData2` (INT8) | per-NPC counters (table in §4.8) |
| `miscFlags`, `miscFlags2`, `miscFlags3` | `ubMiscFlags` (`RECRUITED 0x01`, `WOUNDEDBYPLAYER 0x08`, `SAID_HOSTILE_QUOTE 0x20`, `EPCACTIVE 0x40`), `ubMiscFlags2` (`DONT_ADD_TO_SECTOR 0x01`, `LEFT_COUNTRY 0x02`, `BANDAGED_TODAY 0x04`, `SAID_FIRSTSEEN_QUOTE 0x08`, `NEEDS_TO_SAY_HOSTILE_QUOTE 0x10`, `MARRIED_TO_HICKS 0x20`, `ASKED_BY_HICKS 0x40`), `ubMiscFlags3` (`PERMANENT_INSERTION_CODE 0x02`, `HANDLE_DONE_TRAVERSAL 0x08`, `NPC_PISSED_OFF 0x10`, `TOWN_DOESNT_CARE_ABOUT_DEATH 0x40`, `GOODGUY 0x80`) | `Tactical/Soldier_Profile_Type.h:25-51`; ja2-node `ProfileMiscFlag`, `ProfileMiscFlag2`, `ProfileMiscFlag3` (`src/sim/campaign/profiles.ts`) |
| `money` | `uiMoney` | NPC cash (Carmen, Darren, Vince, …) |
| `balance` | `iBalance` | owed money, bets, bribes (§3.11) |
| `useProfileInsertion`, `insertionCode`, `insertionData` | `fUseProfileInsertionInfo`, `ubStrategicInsertionCode`, `usStrategicInsertionData` | §4.6 |
| `quoteRecord`, `quoteActionId` | `ubQuoteRecord`, `ubQuoteActionID` | pending NPC movement across sector loads (§4.6) |
| `life`, `stats` | `bLife`, `bLifeMax`, … | written back from NPC soldiers when a sector is left (§4.6) |
| `nickname` | `zNickname` | terrorist reveal (§3.6) |
| `lastDateSpokenTo` | `ubLastDateSpokenTo` | shared with `24`; Tony, Devin, Kingpin (§4.3, §3.6) |
| `salary` | `sSalary` | `RECRUIT` zeroes it, Conrad's reduction (§3.3) |
| `inventory` | `inv[]`, `bInvStatus[]`, `bInvNumber[]` | gifts, heads, deed, money |

**Saved globals** (general info, `SaveLoadGame.cc:1895-1946`, and the tactical status):
- hospital: `gbHospitalPriceModifier` (i8), `giHospitalTempBalance`, `giHospitalRefund` (i32), `gubCambriaMedicalObjects` (u8);
- boxing: `gubBoxingMatchesWon`, `gubBoxersRests`, `gfBoxersResting`, `gfLastBoxingMatchWonByPlayer`, `gfBoxerFought[3]`,
  `gBoxer[3]` (soldier ids), `gsBoxerGridNo[3]` (constants, saved), and `bBoxingState` in the tactical status;
- quest misc: `gubNumTerrorists`, `gfPlayerTeamSawJoey`, `gfMikeShouldSayHi`, `sWorldSectorLocationOfFirstBattle` (`19`);
- helicopter: `iHelicopterVehicleId`, `fSkyRiderSetUp`, `fHelicopterIsAirBorne`, `fHeliReturnStraightToBase`,
  `fHoveringHelicopter`, `uiStartHoverTime`, `iTotalAccumulatedCostByPlayer`, `fHelicopterDestroyed`,
  `guiHelicopterSkyriderTalkState`, `guiTimeOfLastSkyriderMonologue`, `gfSkyriderEmptyHelpGiven`, `gubHelicopterHitsTaken`,
  `gfSkyriderSaidCongratsOnTakingSAM`, `gubPlayerProgressSkyriderLastCommentedOn`, `fRefuelingSiteAvailable[2]`, and the
  presentation-only highlight flags;
- civilian groups: `fCivGroupHostile[20]` in the tactical status (§6.1);
- the key table `KeyTable[64]` (section "key table") and per-sector door tables (map temp files, `07`);
- the schedules of the loaded sector (section "schedules", §5.6).

**Not saved** (transient; inferred safe because the talk panel or message box that holds them cannot be saved through):
`ubRecordThatTriggeredLiePrompt` (`ID:166`), `gusDialogueMessageBoxType` (`ID:4157`), `gubNiceNPCProfile`/`gubNastyNPCProfile`
(`ID:156-157`), `gfProfiledEnemyAdded` (one elite upgrade per load, §4.6) and `guiPabloExtraDaysBribed` (`SEH:30`, never
incremented anywhere: dead). ja2-node saves an open request with the campaign (deviation "NPC requestors").

---

## 1. Facts

### 1.1 The store

- `SetFactTrue(f)` (`Q:42-55`): if `f == ESTONI_REFUELLING_POSSIBLE (277)` and the fact was false, first
  `GuaranteeAtLeastXItemsOfIndex(ARMS_DEALER_JAKE, GAS_CAN, 4 + Random(3))` (one `Random(3)` plus the dealer's stock draws,
  `23` §5.4); then `facts[f] = 1`. `SetFactFalse(f)` (`:58-61`): `facts[f] = 0`. Both are also called by NPC records (`24`: a
  record's `usSetFactTrue`, `NPC:1734-1737`) and by an abandoned EPC's record (`Strategic/Assignments.cc:6848`).
- `CheckFact(f, profile)` (`Q:484-1097`): for the ~120 computed ids of §1.3 it recomputes the value, **stores it** in
  `facts[f]` and returns it; for every other id it returns the stored byte (any non-zero value is true for callers that test
  truth, but `MIKE/IGGY_AVAILABLE_TO_ARMY` are compared with `== 1`, `Tactical/Soldier_Create.cc:2072-2081`).
- Direct reads of the array bypass `CheckFact`: `gubFact[FACT_QUEEN_DEAD]` (`SIL:503`, `Strategic/Strategic_AI.cc:2336`),
  `gubFact[FACT_PLAYER_KNOWS_ABOUT_BLOODCAT_LAIR]` (`Strategic/Strategic_Movement.cc:3345`), `gubFact[FACT_PC_MARRYING_DARYL_IS_FLO]`
  (`Laptop/Mercs.cc:1155`, `Laptop/Mercs_Files.cc:290`), `gubFact[FACT_TOP/BOTTOM_LEVEL_CLEARED]` (`Q:889`), the two army facts.
  Because computed facts write back, a direct read sees the value of the last `CheckFact` (kept: saves carry those bytes).
- Direct writes: `gubFact[MIKE_AVAILABLE_TO_ARMY] = 2`, `gubFact[IGGY_AVAILABLE_TO_ARMY] = 2` (used once,
  `Tactical/Soldier_Create.cc:2074, 2080`), `gubFact[IGGY_AVAILABLE_TO_ARMY] = TRUE` (`Strategic/Merc_Contract.cc:976`).
- `InitQuestEngine` (`Q:1157-1178`) zeroes both arrays (§2.3).

ja2-node (`src/sim/strategic/narrative/facts.ts`, `check-fact.ts`): `fact(n, id)` tests the raw byte, `factValue(n, id)`
returns it, `setFactTrue(n, id, hooks)` runs the Estoni intercept through `hooks.estoniRefuellingPossible`, `setFactFalse(n,
id)`, and `checkFact(ctx, id, profile)` evaluates §1.3 (`isComputedFact(id)` names the computed ids) over a `FactContext` of
ports (soldiers of the loaded sector, towns, mines, boxing, repairs, dialogue, items, the talk context). Native import fills
the store from the decoded save arrays (`importNarrative`).

### 1.2 Stored facts and who writes them

"Records" = set by NPC quote records (`24`; the record data decides when). Facts not listed are only written by records (or
never) and only read by records (265/266 also by fact 264): `MIGUEL_FOUND 12`, `LETTER_DELIVERED 13`, `FOOD_ROUTE_EXISTS 14`,
the city liberation facts 0–11 (no code reference at all), `CARMEN_EXPLAINED_DEAL 102`, `PLAYER_REPAID_KINGPIN 104`,
`PLAYER_WANTS_TO_BUY_LEATHER_VEST 118`, `ANGEL_SOLD_VEST 115`, `KINGPIN_INTRODUCED_SELF 255`, `KROTT_GOT_ANSWER_NO 195`,
`VINCE_EXPLAINED_HAS_TO_CHARGE 148`, `SKYRIDER_HINT_GIVEN 358`, `FACT_84`, `FACT_132`–`134`, `FACT_281` (Darren's rules
explained, read by `NPC:1413`, `24`), `TOP_LEVEL_CLEARED 265`, `BOTTOM_LEVEL_CLEARED 266`, `WILLIS_GIVES_DISCOUNT 272`.

| Id | Fact | Written by code | Read by code |
|---|---|---|---|
| 23 | `MIGUEL_READ_LETTER` | records | town loyalty start (`Strategic/Strategic_Town_Loyalty.cc:160`, `loyalty.ts`) |
| 29 | `PACOS_KILLED` | T when the player **wounds** Pacos (`Tactical/Soldier_Control.cc:5844-5848`) | records |
| 34, 35, 53–62, 125 | Bobby Ray shipment facts | `BobbyRayPurchaseEventCallback` (`SEH:70-319`, `21` §5.5); `REALLY_NEW…`/`LARGE_SIZED_OLD…` also by the NPC system event (`SEH:560-568`) | records (Pablo), `21` |
| 36 | `PLAYER_FOUND_ITEMS_MISSING` | T when a merc says the "stuff missing" quote opening the airport crate (`Tactical/Dialogue_Control.cc:1416-1420`, trigger `TileEngine/Interactive_Tiles.cc:121-131`) | Pablo rules (`OH:5354`), crate trigger |
| 37 | `PABLO_PUNISHED_BY_PLAYER` | T when the player attacks Pablo after 36 (`OH:5354-5357`); F when the goods return (`SEH:364`) | `CheckFact(32/33)` (`Q:500`), `OH:5410` |
| 38 | `FACT_38` | records | Pablo: attack triggers record 3 only while false (`OH:5410`) |
| 39 | `PABLO_RETURNED_GOODS` | T `SEH:363` | `Q:501` |
| 41 | `PABLOS_BRIBED` | records; F `SEH:455` (`SetPabloToUnbribed`) | theft rules (`SEH:133`, `21`), `ID:2001`, `PABLO_BRIBED 365` |
| 43 | `SKYRIDER_CLOSE_TO_CHOPPER` | T when escorted Skyrider reaches the chopper (`OH:1880-1886`) | save patch only (`Strategic/Strategic_AI.cc:2358`) |
| 45 | `SKYRIDER_USED_IN_MAPSCREEN` | T on the first helicopter plot (`Strategic/MapScreen.cc:7278`) | Skyrider SAM monologue (`HELI:699`) |
| 52 | `FOOD_QUEST_OVER` | T `SEH:624` | records |
| 63 | `DOREEN_HAD_CHANGE_OF_HEART` | records; T when Doreen dies (`OH:2413`) | Doreen death (`OH:2405`), civ quotes (`Tactical/Civ_Quotes.cc:487`, `24`) |
| 79 | `BRENDA_DEAD` | T when Brenda dies (`OH:2306`) **and** computed (§1.3) | records |
| 86 | `TONY_NOT_AVAILABLE` | 04:00 (`SEH:739, 745`) | records, `23` |
| 88, 95, 237 | brothel tracking facts | only in commented-out code (`TileEngine/Explosion_Control.cc:1696-1767`) | records (dead in Gold) |
| 89–92 | `CARLA/CINDY/BAMBI_AVAILABLE`, `NO_GIRLS_AVAILABLE` | `NPC_ACTION_SET_GIRLS_AVAILABLE` (`ID:2541-2576`) | Madame's actions and money rules |
| 93 | `PLAYER_WAITED_FOR_GIRL` | records; F `ID:2582-2584` | records |
| 99 | `DARREN_EXPECTING_MONEY` | records; F on an accepted bet (`NPC:755`) | records |
| 100 | `PC_NEAR` | T then F around the proximity record search (`NPC:2156, 2179`) | records |
| 103 | `KINGPIN_KNOWS_MONEY_GONE` | T `SEH:540` | `SEH:578` |
| 105 | `FRANK_HAS_BEEN_BRIBED` | T by a gift ≥ $10 (`Tactical/ShopKeeper_Interface.cc:5930-5957`, `23`); F `ID:3689-3691` | records |
| 107 | `PAST_CLUB_CLOSING_AND_PLAYER_WARNED` | records; F at 15:00 (`HU:115`) | records |
| 119 | `MARIA_ESCAPE_NOTICED` | T: a Kingpin goon sees Maria (`OL:1688-1690`), a Kingpin civ turns hostile or is hurt while the Maria quest runs and Maria is in the sector (`OH:2645-2655`, `Tactical/Soldier_Control.cc:5462-5469`) | `ID:2504` |
| 120 | `ANGEL_LEFT_DEED` | records | sight rule (`OL:1625`), `ID:3597` |
| 124 | `PABLO_WONT_STEAL` | records | theft (`SEH:129`, `21`) |
| 127, 128 | `LARGE/SMALL_AMOUNT_OF_MONEY` | T when money is offered (`NPC:696-702`), **never cleared** | records |
| 149 | `VINCE_EXPECTING_MONEY` | records; F `ID:3394`, 04:00 (`SEH:798`) | money rules (`NPC:877-905`) |
| 150, 151 | `PLAYER_STOLE_MEDICAL_SUPPLIES(_AGAIN)` | `CheckForMissingHospitalSupplies` (`SEH:909-933`) | `ID:3397`, records |
| 152 | `VINCE_RECRUITABLE` | records; F `ID:3409-3411` | records |
| 155 | `FACT_155` | records | Slay attacked: record 1 only while false (`OH:5392-5399`) |
| 156 | `ALL_TERRORISTS_KILLED` | T `ID:2716-2720` | quest end at sector entry (`SM:674`) |
| 184 | `CHALICE_STOLEN` | T at any sector entry while a merc carries the chalice (`SM:755-763`) | `ID:3623` |
| 192 | `MARY_OR_JOHN_ARRIVED` | T `OH:1653, 1691` | records |
| 194 | `MINERS_PLACED` | T `SM:738` (`mines.ts`) | `SM:687`, `Strategic/Strategic_Mines.cc:758` |
| 197, 198, 204 | `MADLAB_EXPECTING_FIREARM/VIDEO_CAMERA`, `MADLAB_HAS_GOOD_CAMERA` | records; F `ID:2837, 2849, 2861` | `ID:2838, 2850` |
| 199 | `ITEM_POOR_CONDITION` | T/F on every item offer (`NPC:715-722`) | records |
| 202, 205 | `ROBOT_READY`, `ROBOT_READY_SECOND_TIME` | T `SEH:641, 649`; 202 F when the hired robot dies (`OH:2241`) | records |
| 203, 206 | `FIRST/SECOND_ROBOT_DESTROYED` | robot death on our team (`OH:2236-2247`) or as a civilian (`OH:2320-2330`) | `SEH:638`, `OH:2238, 2322` |
| 220 | `MANNY_IS_BARTENDER` | records | dealer availability (`Tactical/Arms_Dealer_Init.cc:859`, `23`) |
| 222 | `FACT_222` | T on any Howard transaction (`Tactical/ShopKeeper_Interface.cc:3360`, `23`) | records |
| 224 | `OK_USE_HUMMER` | T `SEH:680` | `OKUseVehicle` (`Tactical/Vehicles.cc:847-852`), `VEHICLE_PRESENT 227` |
| 226 | `DAVE_HAS_GAS` | 04:00 `PreRandom(3) == 0` (`SEH:850-857`) | records |
| 228, 253, 254 | `FIRST_BATTLE_WON/FOUGHT/BEING_FOUGHT` | `19` (`OH:4481-4491, 4683-4692`, `Strategic/Auto_Resolve.cc:1278-1285`, `Strategic/PreBattle_Interface.cc:189-191`, `OL:1792-1797`) | `19`, Queen (`17`) |
| 229 | `ROBOT_RECRUITED_AND_MOVED` | T `SM:751` | `SM:743` |
| 249 | `HICKS_MARRIED_PLAYER_MERC` | records | hicks sight rule (`OL:1707-1708`), ownership (`Tactical/Handle_Items.cc:3290`) |
| 250–252 | `MUSEUM_OPEN`, `BROTHEL_OPEN`, `CLUB_OPEN` | hourly (`HU:95-152`, §4.4) | museum sight rule (`OL:1584`), records |
| 258 | `PC_MARRYING_DARYL_IS_FLO` | T `ID:2458-2461` | M.E.R.C. site (`21`) |
| 267 | `NEED_TO_SAY_SOMETHING` | T `ID:3468-3476` | records, merc dialogue (`24`) |
| 268 | `ATTACHED_ITEM_BEFORE` | T on the first attachment (`Tactical/Interface_Items.cc:1842`) | help text (UI) |
| 269 | `SKYRIDER_EVER_ESCORTED` | T when Skyrider becomes an EPC (`ID:1502`) | records |
| 271 | `WILLIS_HEARD_ABOUT_JOEY_RESCUE` | T `SEH:618` | `ID:3333` |
| 273 | `HILLBILLIES_KILLED` | T when a tactical victory in F10 leaves no living hick (`NPC:2607-2637`) | Keith's prices (`23`), Keith's business (`Strategic/Game_Event_Hook.cc:278`), Queen sector rules (`17`) |
| 274 | `KEITH_OUT_OF_BUSINESS` | T by the event (`Strategic/Game_Event_Hook.cc:276-283`); F `ID:3197-3199`, `NPC:2631-2634` | `HandleShopKeepHasBeenShutDown` (`NPC:2640-2664`) |
| 275, 283 | `MIKE/IGGY_AVAILABLE_TO_ARMY` | 275 = 1 at the 50 % progress mark (`Tactical/Campaign.cc:1308-1311`); 283 = 1 when Iggy leaves the team unpaid (`Strategic/Merc_Contract.cc:966-980`); either = 2 once used (`Tactical/Soldier_Create.cc:2068-2083`) | elite upgrade, `Strategic/Queen_Command.cc:558` |
| 276 | `KINGPIN_CAN_SEND_ASSASSINS` | T `SEH:598` | placement overrides (`SIL:463-467`), schedules (`SCH:697`), assassins (`SM:766`) |
| 277 | `ESTONI_REFUELLING_POSSIBLE` | records; T `ID:3816-3820` (with the Jake intercept) | Jake's stock (`23`), refuel sites (`HELI:628`) |
| 278 | `MUSEUM_ALARM_WENT_OFF` | T by Eldin's sight rule (`OL:1591`) or the alarm (`TacticalAI/Knowledge.cc:119`); F on every sector exit (`SM:824`) | `OL:1586`, `TacticalAI/Knowledge.cc:108` |
| 282 | `ANGEL_MENTIONED_DEED` | records | `OL:1626` |
| 245 | `FACT_245` | sticky computed (§1.3) | records |
| 307 | `OK_USE_ICECREAM` | records | `OKUseVehicle` (`Tactical/Vehicles.cc:853-856`) |
| 308 | `KINGPIN_DEAD` | T `OH:2399` | `SEH:506, 583`, Queen (`17`) |
| 318 | `KIDS_ARE_FREE` | T `SEH:684` | placement override (`SIL:536`), `OH:2415` |
| 334 | `LARRY_CHANGED` | T/F at every Larry swap (`SP:1026-1033`) | laptop (`21`), equipment complaint (`22`) |
| 335 | `PLAYER_KNOWS_ABOUT_BLOODCAT_LAIR` | records | lair encounter code (`16`) |
| 336 | `HOSPITAL_FREEBIE_DECISION_MADE` | T `ID:3305`; F `ID:3384` | `ID:3301, 3343` |
| 350 | `KINGPIN_WILL_LEARN_OF_MONEY_GONE` | T `SEH:502` | `SEH:491` |
| 360 | `BRENDA_PATIENCE_TIMER_EXPIRED` | T `SEH:630` | records |
| 367 | `CONRAD_SHOULD_GO` | records | Conrad removal on sector exit (`SM:811-815`) |
| 56, 305, 306 | `SHIPMENT_DELAYED_24_HOURS`, `24_HOURS_SINCE_JOEY_RESCUED`, `24_HOURS_SINCE_DOCTOR_TALKED_TO` | T by NPC-system events posted by actions 115, 257, 258 (`SEH:570-574`); 56 F `SEH:473` | records, `ID:3302, 3341` |

### 1.3 Computed facts (`CheckFact`, `Q:484-1097`)

`p` = the profile argument (the record's NPC, `24`; `0` for many code callers). `soldier(x)` = `FindSoldierByProfileID(x)` (any
team, the loaded sector only); "dead(x)" = `bMercStatus == MERC_IS_DEAD`. Distances are `PythSpacesAway`. The talk context is
`src` = `gpSrcSoldier`, `dest` = `gpDestSoldier`, `srcProfile` = `gubSrcSoldierProfile` (§1.4).

| Id | Fact | Rule | Line |
|---|---|---|---|
| 15 | `DIMITRI_DEAD` | dead(DIMITRI) | `Q:492-494` |
| 25 | `REBELS_HATE_PLAYER` | `civGroupHostile[REBEL] == HOSTILE (3)` | `:678-680` |
| 31 | `CURRENT_SECTOR_IS_SAFE` | `!((enemyInSector && p heard a gunshot) \|\| INCOMBAT)` (`SOLDIER_MISC_HEARD_GUNSHOT`, `:462-470`) | `:495-497` |
| 32, 33 | `BOBBYRAY_SHIPMENT_IN_TRANSIT`, `NEW_…_WAITING` (both written) | if 37 && !39 && Pablo alive: both F; else if the primary delivery sector is loaded and its delivery gridno holds an invisible item pool (`:64-71`): 32 F, 33 T; else if any order in transit (`21`): 32 = !`PACKAGE_DAMAGED`, 33 F; else both F | `:498-532` |
| 46 | `NPC_OWED_MONEY` | `p < NUM_PROFILES && balance(p) < 0` | `:585-587` |
| 47, 48 | `NPC_WOUNDED(_BY_PLAYER)` | soldier(p) with `life < lifeMax`; 48 also `WOUNDEDBYPLAYER` | `:74-84, 533-538` |
| 50 | `IRA_NOT_PRESENT` | !(soldier(p) and soldier(IRA) both exist within 10 of each other) | `:118-127, 539-541` |
| 51 | `IRA_TALKING` | `srcProfile == IRA` | `:542-544` |
| 65 | `IRA_UNHIRED_AND_ALIVE` | !dead(IRA) && Ira in A10-1 (on the team: soldier sector; else profile sector) && !`RECRUITED` | `:545-555` |
| 68 | `NPC_BLEEDING` | soldier(p) with `life > 0 && bleeding > 0` | `:556-558` |
| 70 | `NPC_BLEEDING_BUT_OKAY` | 68 && `life > lifeMax/2 && life > 30` | `:559-568` |
| 71, 72, 73 | `PLAYER_HAS_HEAD_AND_CARMEN_IN_SAN_MONA/CAMBRIA/DRASSEN` | Carmen in C5 / G9 / C13 (z 0) && a living OUR merc carries an item in `HEAD_2..HEAD_7` (Slay's `HEAD_4` included) | `:376-386, 570-583` |
| 74, 236 | `FATHER_DRUNK`, `MICKY_DRUNK` | `npcData ≥ 5` | `:589-595` |
| 235 | `FATHER_DRUNK_AND_SCIFI_OPTION_ON` | 74 && sci-fi | `:872-874` |
| 75, 76, 77 | `WOUNDED_MERCS_NEARBY`, `ONE_…`, `MULTIPLE_…` | count of OUR mercs with `0 < life < lifeMax`, not `ASSIGNMENT_HOSPITAL`, within 9 of soldier(p): > 0, == 1, > 1 | `:187-204, 628-636` |
| 78 | `BRENDA_IN_STORE_AND_ALIVE` | !dead(BRENDA) && Brenda in room 47 && within 12 of soldier(p) | `:597-612` |
| 79 | `BRENDA_DEAD` | dead(BRENDA) | `:613-615` |
| 81 | `NPC_IS_ENEMY` | `p < NUM_PROFILES` && (soldier(p) not friendly/neutral, or friendly/neutral in a civ group whose hostility ≥ `WILL_BECOME_HOSTILE (2)`, or `NEEDS_TO_SAY_HOSTILE_QUOTE`) | `:161-184, 616-619` |
| 82, 83 | `PC_STRONG_AND_LESS_THAN_3_MALES_PRESENT`, `…_3_PLUS…` | talker (src if OUR, else dest if OUR) strength ≥ 84 && living (≥ OKLIFE) male OUR profiled mercs within 8 of soldier(p): < 3 / ≥ 3 | `:287-298, 335-353, 652-657` |
| 85 | `HANS_AT_SPOT` | Hans at gridno 13523 (`strategic-fact-params.json`) | `:637-639` |
| 87 | `FEMALE_SPEAKING_TO_NPC` | talker (src if OUR and profiled, else dest) is female | `:301-312, 658-660` |
| 96, 97 | `MULTIPLE_MERCS_CLOSE`, `SOME_MERCS_CLOSE` | OUR mercs ≥ OKLIFE strictly closer than 3 to soldier(p): > 1 / > 0 | `:207-223, 640-645` |
| 101, 109 | `CARMEN_IN_C5`, `JOEY_IN_C5` | NPC sector == C5 (soldier sector if on our team) | `:389-406, 661-668` |
| 108 | `NPC_ESCORTED` | !dead(p) && p on our team as `EPC` | `:226-239, 646-648` |
| 110 | `JOEY_NEAR_MARTHA` | Joey within 5 of Martha && one currently sees the other (opplist, different teams only) | `:670-671` |
| 111, 340 | `JOEY_DEAD`, `JOEY_ALIVE` | dead / !dead(JOEY) | `:672-674, 1030-1032` |
| 112 | `MERC_NEAR_NPC` | OUR mercs ≥ OKLIFE closer than 5 to soldier(p) > 0 | `:675-677` |
| 113 | `SPIKE_AT_DOOR` | Spike at 9817 (fact params) | `:625-627` |
| 117 | `MARIA_ESCORTED_AT_LEATHER_SHOP` | 108 for Maria && Maria in room 2 | `:649-651` |
| 122 | `NPC_BANDAGED_TODAY` | `p < NUM_PROFILES && BANDAGED_TODAY` | `:983-985` |
| 135, 136, 137 | `LOYALTY_OKAY/LOW/HIGH` | town = `p.town` (blank for `p ≥ NUM_PROFILES`); if the town uses loyalty and is started: OKAY = rating in [30, 50), LOW = < 30 (for SKYRIDER: false while the talk state is 0 or the last monologue is under 24 h old), HIGH = ≥ 80; else false | `:787-830` |
| 138, 233, 234 | `PLAYER_DOING_POORLY/WELL/VERY_WELL` | current progress < 20 / > 50 / > 80 | `:860-870` |
| 140, 141, 142 | `CURRENT_SECTOR_G9/C5/C13` | loaded sector == that sector at z 0 | `:681-692` |
| 143 | `CARMEN_HAS_TEN_THOUSAND` | `money(CARMEN) ≥ 10000` | `:693-695` |
| 144 | `SLAY_HIRED_AND_WORKED_FOR_48_HOURS` | Slay `RECRUITED` && `totalDaysServed > 1` | `:699-701` |
| 146 | `SLAY_IN_SECTOR` | profile sector of Slay == loaded sector (with z) | `:696-698` |
| 157 | `ELGIN_ALIVE` | !dead(DRUGGIST) | `:832-834` |
| 164 | `SHANK_IN_SQUAD_BUT_NOT_SPEAKING` | Shank on our team && `RECRUITED` && src is not Shank | `:703-708` |
| 167 | `SHANK_NOT_IN_SECTOR` | no soldier(SHANK) | `:710-712` |
| 168 | `BLOODCAT_QUEST_STARTED_TWO_DAYS_AGO` | quest 13 started && `now − GetTimeQuestWasStarted(13) > 2880` (history lookup, `21` §6.2) | `:876-878` |
| 170 | `QUEEN_DEAD` | dead(QUEEN) | `:713-715` |
| 171 | `SPEAKER_AIM_OR_AIM_NEARBY` | dest exists && an OUR A.I.M. merc ≥ OKLIFE within 10 of dest | `:409-421, 836-838` |
| 172–177 | `MINE_EMPTY`, `MINE_RUNNING_OUT`, `MINE_PRODUCING_BUT_LOYALTY_LOW`, `CREATURES_IN_MINE`, `PLAYER_LOST_MINE`, `MINE_AT_FULL_PRODUCTION` | the head miner p's mine: `IsHisMineEmpty`, `…RunningOut`, `HasHisMineBeenProducingForPlayerForSomeTime && IsHisMineDisloyal`, `…Infested`, `…LostAndRegained`, `…AtMaxProduction` (`18`; `mines.ts`, `mine-status.ts`) | `:716-733` |
| 178 | `DYNAMO_SPEAKING_OR_NEARBY` | src exists && (src is Dynamo, or Dynamo within 10 of src's profile soldier and seen by it) | `:741-743` |
| 186–193 | `JOHN_AND_MARY_EPCS`, `MARY_ALIVE`, `MARY_BLEEDING`, `JOHN_ALIVE`, `JOHN_BLEEDING`, `MARY_DEAD` | 108 for both; !dead; 68 rule | `:744-761` |
| 208 | `DYNAMO_IN_J9` | Dynamo's sector J9 (z 0) && `NumEnemiesInAnySector(J9) > 0` | `:734-737` |
| 209 | `DYNAMO_ALIVE` | !dead(DYNAMO) | `:738-740` |
| 210 | `ANOTHER_FIGHT_POSSIBLE` | `AnotherFightPossible()` (§7.4) | `:763-765` |
| 211 | `RECEIVING_INCOME_FROM_DCAC` | predicted daily income > 0 from the Drassen, Alma, Cambria **and** Chitzena mines | `:767-773` |
| 212 | `PLAYER_BEEN_TO_K4` | `SF_ALREADY_VISITED` of K4-1 | `:775-777` |
| 214 | `WARDEN_DEAD` | dead(WARDEN) | `:779-781` |
| 216–219 | `FIRST/SECOND/THIRD/FOURTH_BARTENDER` | `p < NUM_PROFILES` && (`npcData(p) == k` or (`npcData(p) == 0` and `CountBartenders() == k − 1`)); `CountBartenders` counts HERVE..CARLO (151–154) with `npcData ≠ 0` | `:435-448, 892-906` |
| 221 | `NOTHING_REPAIRED_YET` | `RepairmanIsFixingItemsButNoneAreDoneYet(p)` (`23` §10.6) | `:880-882` |
| 227 | `VEHICLE_PRESENT` | `OK_USE_HUMMER` && (the hummer or the ice-cream truck on our team) | `:1072-1079` |
| 230 | `NO_CLUB_FIGHTING_ALLOWED` | Kingpin money quest in progress \|\| boxers resting | `:922-924` |
| 231 | `PLAYER_FOUGHT_THREE_TIMES_TODAY` | !`BoxerAvailable()` | `:856-858` |
| 239 | `PLAYER_PAID_FOR_TWO_IN_BROTHEL` | `npcData(MADAME) > 1` | `:783-785` |
| 242, 243, 244 | `PLAYER_OWNS_2/3/4_TOWNS_INCLUDING_OMERTA` | whole towns under control == 3 / == 5 / ≥ 6, each && Omerta fully ours | `:844-854` |
| 248 | `MALE_SPEAKING_FEMALE_PRESENT` | !87 && a living OUR female profiled merc within 10 of soldier(p) | `:356-373, 840-842` |
| 256 | `KINGPIN_NOT_IN_OFFICE` | !(loaded sector is D5 at z 0 && Kingpin in rooms 30–39) | `:912-916` |
| 257 | `DONT_OWE_KINGPIN_MONEY` | quest 4 not in progress | `:918-920` |
| 259 | `I16_BLOODCATS_KILLED` | `sectorInfo(I16).bloodCats == 0` | `:979-981` |
| 261 | `NPC_COWERING` | soldier(p) has `SOLDIER_COWERING` | `:424-432, 884-886` |
| 264 | `TOP_AND_BOTTOM_LEVELS_CLEARED` | stored 265 && stored 266 | `:888-890` |
| 270 | `NPC_NOT_UNDER_FIRE` | !(soldier(p) `bUnderFire ≠ 0`) | `:908-910` |
| 280 | `MADDOG_IS_SPEAKER` | `srcProfile == MADDOG` | `:926-928` |
| 284 | `PC_HAS_CONRADS_RECRUIT_OPINION` | dest && `CalcDesireToTalk(dest.profile, srcProfile, APPROACH_RECRUIT) ≥ 50` (`24`) | `:930-932` |
| 245 | `FACT_245` (Dimitri recruitable) | stored value \|\| Miguel on our team (sticky) | `:1085-1086` |
| 289 | `NPC_HOSTILE_OR_PISSED_OFF` | 81's enemy test (without the hostile-quote flag) \|\| `NPC_PISSED_OFF` | `:934-936` |
| 291 | `TONY_IN_BUILDING` | Tony in C5 && in room 50 | `:938-941` |
| 292 | `SHANK_SPEAKING` | src is Shank | `:943-945` |
| 294–303 | `DOREEN/WALDO/PERKO/TONY/VINCE/JENNY/ARNOLD_ALIVE` | !dead | `:951-977` |
| 304 | `ROCKET_RIFLE_EXISTS` | `ItemTypeExistsAtLocation(10472, ROCKET_RIFLE, level 0)` in the loaded world | `:947-949` |
| 319 | `PLAYER_IN_SAME_ROOM` | an OUR merc in sector stands in soldier(p)'s room | `:264-284, 987-989` |
| 232, 324–332 | `PLAYER_SPOKE_TO_<mine>_MINER`, `PLAYER_IN_CONTROLLED_<mine>_MINE` | `SpokenToHeadMiner(mine)`; the loaded sector belongs to that mine and is not enemy controlled (Drassen, Cambria, Chitzena, Alma, Grumm) | `:991-1020` |
| 337 | `ENOUGH_LOYALTY_TO_TRAIN_MILITIA` | the loaded sector's town (by `AsByte()`, so z is ignored) uses loyalty, started, rating ≥ `MIN_RATING_TO_TRAIN_TOWN` | `:473-481, 1022-1024` |
| 338 | `WALKER_AT_BAR` | Father's profile sector x/y is C13 (z not tested) | `:1026-1028` |
| 341 | `UNPROPOSITIONED_FEMALE_SPEAKING_TO_NPC` | as 87, and the talker's profile lacks `ASKED_BY_HICKS` (src is chosen first even if it fails the flag test) | `:315-332, 1034-1036` |
| 342 | `84_AND_85_TRUE` | stored `FACT_84` && 85 | `:1038-1040` |
| 354–357 | `SKYRIDER_IN_B15/C16/E14/D12` | Skyrider's sector (soldier sector if on our team) | `:1042-1058` |
| 359 | `KINGPIN_IS_ENEMY` | `civGroupHostile[KINGPIN] ≥ WILL_BECOME_HOSTILE` | `:1060-1062` |
| 362 | `DYNAMO_NOT_SPEAKER` | !(src is Dynamo) | `:1064-1066` |
| 365 | `PABLO_BRIBED` | !`CheckFact(PABLOS_BRIBED 41)` (the name is inverted) | `:1068-1070` |
| 368 | `PLAYER_KILLED_BOXERS` | !`BoxerExists()` (no soldier at any boxer gridno, §7.4) | `:1081-1083` |

The commented-out case for 43 (`:620-624`) never runs. `FACT_LOYALTY_HIGH` indexes the town by `p.town` again (`:824`), same
value. All rules read the loaded sector only; outside tactical (no loaded world) the soldier-based facts are false.

### 1.4 The talk context

`src`, `dest` and `srcProfile` are set when a conversation starts (`ID:286-297`) and are **never cleared** (`ID:153-155`):
records triggered later by proximity, timers or deaths see the last conversation's soldiers. The facts that read them are 51,
82, 83, 87, 164, 171, 178, 280, 284, 292, 341, 362; the requestor answers (§3.3) read `dest` and `src` too. ja2-node keeps the
same persistence in `StrategicState.talk.soldiers = {src, dest, srcProfile}` (soldier ids; `srcProfile` starts at 0 as the
original's zero-initialised global), written by `24` when a conversation starts and resolved per call by
`NarrativeFlow.talkContext()`; an id that no longer resolves reads as null. It is saved with ja2-node's sessions and starts
empty after a native import (deviations "Talk context in saves", "Talk context after a load"). Dialogue code calls
`NarrativeFlow.checkFact(id, npc)`; tactical rules call `TacticalState.narrative.fact(id, profile)`, which is `CheckFact`.

---

## 2. Quests

### 2.1 The list (`Quests.h:43-74`)

Ids 23–24 and 26–29 are unused; `NO_QUEST = 255`. "Records" = a record's `ubStartQuest`/`ubEndQuest` (`NPC:1739-1745`, `24`) or
a civilian quote's start quest (`NPC:2738-2740`); the sector passed is the loaded sector (`gWorldSector`).

| Id | Quest | Started by | Ended by |
|---|---|---|---|
| 0 | `DELIVER_LETTER` | `CheckForQuests` (day 1 08:00 event and `InitQuestEngine`, §2.3) | records (Miguel) |
| 1 | `FOOD_ROUTE` | records | NPC system event of action 112 if Father Walker is alive, sector A10 (`SEH:620-626`) |
| 2 | `KILL_TERRORISTS` | records | sector entry once `ALL_TERRORISTS_KILLED` (`SM:674-680`), at Carmen's sector, then Carmen leaves the map |
| 3 | `KINGPIN_IDOL` | records | records |
| 4 | `KINGPIN_MONEY` | NPC system event `FACT_KINGPIN_KNOWS_MONEY_GONE`, sector D5 (`SEH:586-592`) | records; Kingpin's death (`OH:2392-2401`, plus experience 3) |
| 5 | `RUNAWAY_JOEY` | records | records |
| 6 | `RESCUE_MARIA` | records | records; ending it also zeroes `npcData`/`npcData2` of MADAME (`Q:1145-1151`) |
| 7 | `CHITZENA_IDOL` | records | records |
| 8 | `HELD_IN_ALMA` | capture (`Strategic/Queen_Command.cc:1118-1123`, `19`); started and ended **without history** when Alma (I13) holds no enemies (`:1209-1215`) | POW release when the player enters the prison sector (`SM:1001-1006`, plus experience 3) |
| 9 | `INTERROGATION` | second capture (`Strategic/Queen_Command.cc:1126-1133`, schedules the interrogation meanwhile, `26`) | records (`26`) |
| 10 | `ARMY_FARM` | records | records |
| 11 | `FIND_SCIENTIST` | the AWOL scientist meanwhile, sector −1/−1 (`Strategic/Meanwhile.cc:471`, `26`) | records |
| 12 | `DELIVER_VIDEO_CAMERA` | records | records |
| 13 | `BLOODCATS` | `NPC_ACTION_START_BLOODCAT_QUEST` (`ID:2784-2786`), records | records |
| 14 | `FIND_HERMIT` | records | records |
| 15 | `CREATURES` | first creature attack on a producing mine, at the mine entrance (`Strategic/Strategic_Mines.cc:217-222`) | the creature queen's death (`Strategic/Queen_Command.cc:889-896`) |
| 16 | `CHOPPER_PILOT` | records | records |
| 17 | `ESCORT_SKYRIDER` | Skyrider becomes an EPC and the quest is not started (`ID:1499-1506`) | records |
| 18 | `FREE_DYNAMO` | records | Dynamo recruited while it runs (`SP:707-710`); Dynamo's death while it runs (`OH:2384-2390`) |
| 19 | `ESCORT_TOURISTS` | John or Mary becomes an EPC and the quest is not started (`ID:1508-1544`) | records |
| 20 | `FREE_CHILDREN` | records | Doreen's death (`OH:2414`, unconditional `EndQuest`) |
| 21 | `LEATHER_SHOP_DREAM` | records | records |
| 22 | `FREE_SHANK` | records | records |
| 25 | `KILL_DEIDRANNA` | records | records (`26`) |

### 2.2 `StartQuest`, `EndQuest` and their internals (`Q:1099-1154`)

```
InternalStartQuest(q, sector, history):          // StartQuest = history TRUE
  if quests[q] == NOT_STARTED: quests[q] = IN_PROGRESS; if history: AddHistory(HISTORY_QUEST_STARTED, q, now, sector)
  else quests[q] = IN_PROGRESS                    // restarts a DONE quest silently (kept)
InternalEndQuest(q, sector, history):            // EndQuest = history TRUE
  if quests[q] == IN_PROGRESS: quests[q] = DONE; if history: AddHistory(HISTORY_QUEST_FINISHED, q, now, sector)
  else quests[q] = DONE                           // ends a never-started quest silently
  if q == RESCUE_MARIA: MADAME.npcData = 0; MADAME.npcData2 = 0
  OnQuestEnded(q, sector.x, sector.y, history)    // Lua observer: no listeners in the shipped scripts
```

The history entry carries the quest id in its data field and the sector (`−1/−1` prints "n/a", `21` §6.2). Quests give
nothing by themselves: no experience, money, loyalty or progress. Rewards come from the actions that end them (§2.4).

### 2.3 `InitQuestEngine` and `CheckForQuests`

- `InitQuestEngine` (`Q:1157-1178`), step 2 of `InitStrategicLayer` (`15` §4.3): zero both arrays; `CheckForQuests(1)`;
  `gubCambriaMedicalObjects = sciFi ? 21 : 18`; `gubBoxingMatchesWon = gubBoxersRests = 0`; `gfBoxersResting = FALSE`.
- `CheckForQuests(day)` (`Q:1182-1206`), also the everyday 08:00 event `CHECKFORQUESTS` (`15` §2.7): the Lua `OnCheckQuests`
  observer may claim it (no listener ships); if quest 0 is not started: `AddHistory(HISTORY_ACCEPTED_ASSIGNMENT_FROM_ENRICO, 0,
  now, −1/−1)` then `StartQuest(0, −1/−1)`. At game init `now` is minute 1500 (day 1 01:00), so the two history entries are the
  first of the log; the daily event never does anything afterwards.

### 2.4 Rewards: experience, loyalty, progress, history

- **Experience** (`NPC_ACTION_GRANT_EXPERIENCE_1..5`, `ID:3607-3621`) → `AwardExperienceBonusToActiveSquad(type)`
  (`Tactical/Campaign.cc:1327-1362`): 25, 50, 100, 200, 400 points; every OUR soldier with `bInSector`, on the **current
  squad** (`IsMercOnCurrentSquad`; ja2-node `state.forces.currentSquad`), `life ≥ CONSCIOUSNESS (10)` and not a vehicle or
  robot gets `StatChange(EXPERAMT, points, FROM_SUCCESS)` (`11` §10, draws). Code callers: Kingpin's death while his money quest
  runs (3, `OH:2394-2397`), the creature queen's death (5, `OH:2482-2488`), the Alma release (3, `SM:1005`), Angel's deed (3,
  queued, `ID:2536`).
- **Loyalty** (`NPC_ACTION_BOOST_TOWN_LOYALTY`, `ID:1789-1791`) → `HandleLoyaltyChangeForNPCAction(npc)`
  (`Strategic/Strategic_Town_Loyalty.cc:1081-1126`), amounts × `GAIN_PTS_PER_LOYALTY_PT (500)` (`Strategic_Town_Loyalty.h:9-46`):

| NPC | Effect |
|---|---|
| MIGUEL | Omerta +10 |
| DOREEN | Drassen +20 (`CHILDREN_FREED_DOREEN_SPARED`) |
| MARTHA | Cambria +15 if Joey is alive |
| KEITH | Cambria +15 |
| YANNI | Chitzena +20, then +10 everywhere (Chitzena counted twice) |
| AUNTIE | Alma +20 |
| MATT | Alma +20 |
| other | nothing |

  Other quest loyalty effects run in code: Krott alive (Alma +20, `ID:3437-3443`), terrorists dealt with (+5 everywhere,
  `ID:2718-2720`), the creature queen (+10 everywhere, `OH:2485`), Eldin killed (Balime −20, `OH:2361-2364`), Joey killed
  (Cambria −10, or −20 for Martha's heart attack, `OH:2366-2382`), Doreen killed (Drassen −20 if she had relented, then +10,
  `OH:2403-2418`), rebels betrayed (`ReduceLoyaltyForRebelsBetrayed`, `loyalty.ts`, §6.2).
  `NPC_ACTION_PENALIZE_TOWN_LOYALTY` (11) is commented out (`ID:1793-1794`): a no-op.
- **Progress** (`CurrentPlayerProgressPercentage`, `Tactical/Campaign.cc:1189-1276`) counts income, kills and control only;
  quests do not enter it. The progress milestones go the other way (§4.4).
- **History**: quest start/finish (§2.2), the `NPC_ACTION_HISTORY_*` actions (§3.2) and the entries listed per action.

### 2.5 The quest log in the player view

The original has no quest screen: the player sees quests only as history lines (§2.2). The player view therefore derives
`quests` from the history log, never from `narrative.quests`: one entry per quest that has a `QUEST_STARTED` or
`QUEST_FINISHED` line, with the quest's internal name, the start and finish minutes and sectors (`src/server/quest-view.ts`,
`strategic.quests`, `04` §6.24). A quest started or ended without history (Alma's skip, a silent restart) is invisible,
exactly as in the original.

---
## 3. The NPC action catalog (`HandleNPCDoAction`, `ID:1571-4063`)

### 3.1 Entry point and conventions

- `HandleNPCDoAction(npc, code, record)` runs one action now. Records reach it through `24`'s queue (`NPCDoAction` posts a
  dialogue event, `ID:1185-1210`; a record's negative `sActionData` runs before its quotes, a positive one after them or on
  arrival at the record's destination); code paths call it directly (§3.12). `record` is the record that caused it (used by
  Skyrider's, Joey's and John/Mary's un-recruit and by the lie prompt).
- Codes 501–649 turn soldier(npc) toward soldier(code − 500) (desired direction only if it differs, `ID:1576-1590`); code
  500 is `TURN_TO_FACE_NEAREST_MERC` (`ID:2054-2071`); 650 is not handled.
- `params = getNpcActionParams(code)` supplies the gridnos and amounts of `tactical-npc-action-params.json`; the defaults in
  the code (`params->getGridNo(7887)`) equal the JSON values (`ID:1592`).
- "soldier(x)" is the soldier of profile x in the loaded sector; most actions return silently without it. "→ R n" means
  `TriggerNPCRecord(npc, n)` (queued, considered with `TRIGGER_NPC`, `NPC:2107-2124`, `24`); "→ X n" triggers NPC X's record
  n. "menu" = `DeleteTalkingMenu()` (closes the talk panel, `24`).
- Unhandled codes only log (`ID:4057-4059`): 11 `PENALIZE_TOWN_LOYALTY`, 109 `SET_PABLO_BRIBE_DELAY` (never implemented, also
  missing in V), 141 `DARREN_GIVEN_CASH`, 142 `ANGEL_GIVEN_CASH`, 201 `GERARD_GIVEN_CASH`, 203 `JOE_GIVEN_CASH`, 228
  `KINGPIN_GIVEN_MONEY` (the money rules of §3.11 test these codes), 150 `TELEPORT_NPC` (handled by the record dispatch,
  `NPC:1874-1879`, `24`), 204 `TRIGGER_ELLIOT_9_OR_10`. Explicit no-ops: 30, 31, 259, 260, 261, 292 (the strategic AI runs
  them through `ExecuteStrategicAIAction`, `17`), 152, 163, 182.

### 3.2 Generic actions

| Code | Action | Effect | Lines |
|---|---|---|---|
| 1 | `DONT_ACCEPT_ITEM` | nothing (the item is returned by the record code, `24`) | `ID:1596-1598` |
| 2 | `FACE_CLOSEST_PLAYER` | soldier: `quoteRecord = record`, `quoteActionId = TURNTOWARDSPLAYER`, AI every frame (the named-NPC AI turns and calls `PCsNearNPC` within 8 tiles, `DA:556-583`) | `ID:1676-1691` |
| 3 | `OPEN_CLOSEST_DOOR` | menu; `NPCOpenThing(door)` (§8.6) | `ID:1693-1710` |
| 27 | `OPEN_CLOSEST_CABINET` | menu; `NPCOpenThing(non-door)` | `ID:2959-2974` |
| 40 | `GET_ITEMS_FROM_CLOSEST_CABINET` | cancel AI action, `PENDING_ACTION`, clear non-interruptible animation flags; pick up **all** items at gridno 6968 (ARMAND) or the nearest openable non-door | `ID:2976-3004` |
| 5 | `THREATENINGLY_RAISE_GUN` | first usable gun (not in hand) swapped into the hand and readied toward the facing tile; falls through to 500 | `ID:2034-2052` |
| 500 | `TURN_TO_FACE_NEAREST_MERC` | turn toward `ClosestPC` | `ID:2054-2071` |
| 6 | `LOWER_GUN` | hand item auto-placed in the inventory; the profile inventory slot of that gun moves to the new slot (one gun) | `ID:1712-1755` |
| 7 | `READY_GUN` | ready the hand item toward the facing tile | `ID:1757-1767` |
| 8, 9 | `START/STOP_RUNNING` | `fUIMovementFast` on/off | `ID:1769-1787` |
| 10 | `BOOST_TOWN_LOYALTY` | §2.4 table | `ID:1789-1791` |
| 12 | `STOP_PLAYER_GIVING_FIRST_AID` | `ReceivingSoldierCancelServices` | `ID:1796-1804` |
| 13 | `FACE_NORTH` | desired direction **NORTHWEST** (screen north) | `ID:1806-1815` |
| 14–20 | `FACE_NORTH_EAST` … `FACE_NORTH_WEST` | desired direction `NORTH + (code − 14)` | `ID:1817-1832` |
| 4 | `RECRUIT` | `salary = 0`, then as 23 | `ID:1834-1837` |
| 23 | `RECRUIT_WITH_SALARY` | menu; team full → message; else `RecruitRPC(npc)` (`24`; its quest side effects in §11.15) | `ID:1839-1854` |
| 22 | `BECOME_ENEMY` | civ group → `CivilianGroupMemberChangesSides` (§6.2); a profiled soldier ≥ OKLIFE joins the hostile-quote list (`24`) | `ID:1856-1880` |
| 24 | `CLOSE_DIALOGUE_PANEL` | menu | `ID:1882-1884` |
| 21 | `TRIGGER_FRIEND_WITH_HOSTILE_QUOTE` | menu only (the hostile-friend logic is disabled) | `ID:1886-1890` |
| 25 | `ENTER_COMBAT` | civ group still neutral → changes sides; no group → `MakeCivHostile`; menu; not in combat → `EnterCombatMode(team)` | `ID:2648-2672` |
| 166 | `END_COMBAT` | `ExitCombatMode` | `ID:2726-2728` |
| 167 | `BECOME_FRIENDLY_END_COMBAT` | menu; neutral; recompute opponent counts; no civilian fought → `fEnemyInSector = FALSE`; no enemy → exit combat; cancel AI; Slay in a wheelchair → 42 at once; else stand up | `ID:2730-2761` |
| 26 | `TERRORIST_REVEALS_SELF` | `nickname = name` in the profile and the soldier (deviation "Terrorist names") | `ID:2763-2775` |
| 41 | `INITIATE_SHOPKEEPER_INTERFACE` | unless `HandleShopKeepHasBeenShutDown` (Keith out of business → KEITH 11; Keith's town loyalty low → KEITH 7, `NPC:2640-2664`): menu; open the shop (`23` `openShop`) | `ID:3578-3586` |
| 103–106 | `TRAVERSE_MAP_EAST/SOUTH/WEST/NORTH` | `quoteActionId = TRAVERSE_*`; the NPC walks off that edge and its profile sector moves one step (§4.6) | `ID:1938-1984` |
| 111, 244, 245 | `DRINK_DRINK_DRINK`, `DRINK_WINE`, `DRINK_BOOZE` | `npcData += 1 / 2 / 4` (drunk at ≥ 5, §1.3) | `ID:2221-2223, 3588-3594` |
| 119 | `REPORT_BALANCE` | message with `−balance` | `ID:2173-2175` |
| 197–200 | `MAKE_NPC_FIRST..FOURTH_BARTENDER` | `npcData = 1..4` | `ID:3445-3456` |
| 210 | `CHANGE_MANNY_POSITION` | MANNY: `PERMANENT_INSERTION_CODE`, insertion `GRIDNO` 19904, `useProfileInsertion`; soldier `STATIONARY`; menu | `ID:3729-3743` |
| 248, 255 | `MAKE_BRENDA_STATIONARY`, `MAKE_MIGUEL_STATIONARY` | if the soldier exists: the same with its current gridno | `ID:3745-3771` |
| 240 | `CANCEL_WAYPOINTS` | `orders = ONGUARD` | `ID:3693-3701` |
| 264 | `REMOVE_NPC` | end the AI turn, drop as a target, remove the soldier, profile sector → nowhere, `CheckForEndOfBattle(TRUE)` | `ID:3861-3873` |
| 262 | `REMOVE_MERC_FOR_MARRIAGE` | the soldier changes to the civilian team with no profile and civ group 0; the profile sector → nowhere (§11.9) | `ID:3830-3842` |
| 39, 44 | `PLAYER_SAYS_NICE/NASTY_LATER` | `NEED_TO_SAY_SOMETHING`; remember dest's profile (`24`) | `ID:3468-3476` |
| 232 | `INVOKE_CONVERSATION_MODE` | if no talk panel: start a conversation with the closest PC, approach `NPC_INITIAL_QUOTE` (`24`) | `ID:3543-3565` |
| 50–54 | `GRANT_EXPERIENCE_1..5` | §2.4 | `ID:3607-3621` |
| 265–291, 294 | `HISTORY_*` | one history entry with that code, data 0, the loaded sector (`GOT_ROCKET_RIFLES`, `DEIDRANNA_DEAD_BODIES`, `BOXING_MATCHES`, `SOMETHING_IN_MINES`, `DEVIN`, `MIKE`, `TONY`, `KROTT`, `KYLE`, `MADLAB`, `GABBY`, `KEITH_OUT_OF_BUSINESS`, `HOWARD_CYANIDE`, `KEITH`, `HOWARD`, `PERKO`, `SAM`, `FRANZ`, `ARNOLD`, `FREDO`, `RICHGUY_BALIME`, `JAKE`, `BUM_KEYCARD`, `WALTER`, `DAVE`, `PABLO`, `KINGPIN_MONEY`, `ASSASSIN`) | `ID:3877-3970` |
| 242, 243 | `SHOW_TIXA`, `SHOW_ORTA` | `SetTownAsFound`; history `DISCOVERED_TIXA/ORTA` | `ID:3006-3013` |

### 3.3 Requestors: actions that ask the player (`ID:2144-2171`, `4163-4505`)

These actions close the talk panel and open a yes/no box (`StartDialogueMessageBox`); the box only opens if `npc` is dest's
profile (else an error log), except for 221 and 226, which open it without that check (`ID:2388-2394, 2432-2436`). The
answer runs `DialogueMessageBoxCallBack` with `ubProfile = dest.profile` (226 also reads `src.profile`). In ja2-node each
box is an `npcRequest` decision in the campaign's prompt slot (`PromptKind.NPC_REQUEST`, `state.battle.prompt`), opened
inside or outside a talk session and answered with `answer` (`04` §6.16, deviation "NPC requestors"); the shown amount is
computed when the box opens, as `StartDialogueMessageBox` formats it.

| Code | Request | Shown | Yes | No |
|---|---|---|---|---|
| 110 | `ASK_ABOUT_ESCORTING_EPC` | escort prompt (the John/Mary pair wording if the other is alive) | menu; team full → message; JOHN with Mary present and `NumberOfMercsOnPlayerTeam() > lastId(OUR) − 3` → "team full"; else `RecruitEPC(npc)` (§9.1), message with the squad, make that squad current, `HandleStuffForNPCEscorted` (§9.1) | nothing |
| 120, 212 | `ASK_ABOUT_PAYING_RPC(_WITH_DAILY_SALARY)` | hire prompt with `salary` | → R 1 | → R 0 |
| 181 | `REDUCE_CONRAD_SALARY_CONDITIONS` | first `CONRAD.salary = 3300` (`ID:2144-2146`), then the hire prompt | → R 1 | → R 2 |
| 135 | `DARREN_REQUESTOR` | boxing prompt | → R 13 | → R 12 |
| 207 | `FIGHT_AGAIN_REQUESTOR` | boxing prompt | → R 30 | → R 12 |
| 144 | `BUY_LEATHER_KEVLAR_VEST` | vest prompt with the item's price | → R 27 | → R 28 |
| 161 | `MEDICAL_REQUESTOR` | pay prompt: `c = CalcMedicalCost(npc)` (§11.3); shown `refund > c ? 10 : c − refund` | VINCE/STEVE → R 23 | → R 24; both close the menu |
| 162 | `MEDICAL_REQUESTOR_2` | free treatment prompt | `WOUNDED_MERCS_NEARBY` → R 26, else `ONE_WOUNDED_MERC_NEARBY` → R 25 (unreachable: 75 is checked first); VINCE: `giHospitalTempBalance = 0`; STEVE: **`VINCE.balance = 0`** | VINCE → R 34, STEVE → R 30 |
| 169 | `BUY_VEHICLE_REQUESTOR` | pay prompt "$10000" (fixed text) | → GERARD 9 | → GERARD 8 |
| 183 | `KROTT_REQUESTOR` | spare-Krott prompt | → SERGEANT 7 | → SERGEANT 6 |
| 226 | `TRIGGER_MARRY_DARYL_PROMPT` | marriage prompt; on any answer src's profile gets `ASKED_BY_HICKS` | `DARYL.npcData = src.profile`; a key object (key id 38) is auto-placed into Daryl's soldier; → DARYL 11 | → DARYL 12 |
| 221 | `PROMPT_PLAYER_TO_LIE` | yes / no / lie; remembers `record` (`ID:2388-2394`) | → R record+1 | → R record+2. **Lie**: the liar is the first OUR soldier in sector, ≥ OKLIFE, ≥ OKBREATH, replaced by a later one whenever `wis(s) + ldr(s) > wis(liar) + ldr(s)` (`ldr(s)` on both sides: only wisdom decides); `SkillCheck(liar, LIE_TO_QUEEN_CHECK, 0) ≥ 0` → R record+4, else (or no liar) → R record+3 |

### 3.4 Rebels, the letter and the food route

| Code | Action | Effect | Lines |
|---|---|---|---|
| 100 | `GOTO_HIDEOUT` | add an exit grid at gridno 7887 of A10 (map temp file) leading to A10-1 gridno 12722; every OUR soldier ≥ OKLIFE in sector on the **current squad**: tactical traversal on, his group's sector = A10-1, the first six get insertion `GRIDNO` 13362, 13363, 13364, 13365, 13525, 13524; `ChangeNpcToDifferentSector(FATIMA, A10-1)`, same for DIMITRI; fade out → load A10-1, in A10's temp file remove the crate structure at 7887, add it at 8207, add the trapdoor debris at 7887; fade in → if Carlos is present, → CARLOS 1 immediately (`ID:4510-4549`). ja2-node moves the squad and loads at once and does not apply the A10 changes (deviation "Rebel basement") | `ID:1600-1649` |
| 102 | `LEAVE_HIDEOUT` | menu; ignored while a walk-off is pending; **every** OUR soldier ≥ OKLIFE in sector (not just the squad): group sector = A10, the first eight get insertion gridnos 8047, 8207, 8208, 8048, 7888, 7728, 7727, 7567; fade → load A10; clears `ENGAGED_IN_CONV` | `ID:1892-1936`, `4554-4574` |
| 101 | `FATIMA_GIVE_LETTER` | menu; Fatima's `LETTER` handed to Miguel's soldier (`SoldierGiveItem`; ja2-node hands it over at once, deviation "NPC gives an item") | `ID:1651-1674` |
| 113, 114 | `SEND_PACOS_INTO_HIDING`, `HAVE_PACOS_FOLLOW` | Pacos walks to 16028 / 18193, or to the first `FindAdjacentGridEx` tile if the gridno is not a valid destination (`NPCGotoGridNo`, `24`) | `ID:2074-2118` |
| 293 | `PUT_PACOS_IN_BASEMENT` | `PACOS.sector = A10` (z 0, despite the name) | `ID:3965-3967` |
| 112 | `TRIGGER_END_OF_FOOD_QUEST` | history `TALKED_TO_FATHER_WALKER`; NPC system event tomorrow at the same minute (§3.13) | `ID:2136-2139` |
| 155 | `TRIGGER_FATHER_18_20_OR_15` | !`FACT_132` → R 18; else !`133` → R 20; else !`134` → R 15; else R 26 | `ID:2629-2646` |
| 230 | `SEND_ENRICO_MIGUEL_EMAIL` | event tomorrow at `390 + Random(60)` (§3.13) | `ID:3464-3466` |

### 3.5 Airport, shipments and Pablo (Drassen)

| Code | Action | Effect | Lines |
|---|---|---|---|
| 107 | `REPORT_SHIPMENT_SIZE` | say quote 14 if `MEDIUM_SIZED_SHIPMENT_WAITING`, 15 if `LARGE…`, else 13; then if `PABLOS_BRIBED` and `Random(100) < 75`: quote 16 and, if `Random(100) < 75`, quote 21 (quotes, not records) | `ID:1986-2009` |
| 108 | `RETURN_STOLEN_SHIPMENT_ITEMS` | event tomorrow at `480 + Random(60)` (§3.13); if Pablo is not neutral: menu, neutral, bleeding 0, recompute opponent counts, in combat → `CheckForEndOfCombatMode(FALSE)` | `ID:2011-2032` |
| 115 | `SET_DELAYED_PACKAGE_TIMER` | event in 24 h: set `SHIPMENT_DELAYED_24_HOURS` | `ID:2120-2122` |
| 116 | `SET_RANDOM_PACKAGE_DAMAGE_TIMER` | event in 24 h: `HandlePossiblyDamagedPackage` | `ID:2124-2126` |
| 188 | `ADD_JOHNS_GUN_SHIPMENT` | a free Bobby Ray shipment of 2 `AUTOMAG_III` (100 %) and 2 `CLIP762N_5_AP` (quality 5) to the primary destination, `CalculateOrderDelay(2) + 2` days ahead (`Laptop/BobbyRMailOrder.cc:1612-1666`, `21` §5); menu | `ID:3683-3687` |

Pablo's death posts `SECOND_AIRPORT_ATTENDANT_ARRIVED` tomorrow at `480 + Random(60)` (`OH:2317-2319`); its handler puts SAL in
the delivery sector (`SEH:435-442`).

### 3.6 San Mona: Kingpin, the bar, boxing, the brothel, Angel and Maria, Carmen

| Code | Action | Effect | Lines |
|---|---|---|---|
| 137 | `MARK_KINGPIN_QUOTE_0_USED` | `KINGPIN.lastDateSpokenTo = day` | `ID:2255-2258` |
| 229 | `KINGPIN_TRIGGER_25_OR_14` | `KINGPIN_INTRODUCED_SELF` → R 25, else R 14 | `ID:3567-3576` |
| 208 | `TRIGGER_SPIKE_OR_DARREN` | Kingpin in rooms 1–3 (the club) → DARREN 31, else SPIKE 11 | `ID:2942-2957` |
| 249 | `TRIGGER_DARREN_OR_KINGPIN_IMPRESSED` | `BoxerAvailable()` → DARREN 25; falls through to 250 | `ID:3773-3779` |
| 250 | `TRIGGER_KINGPIN_IMPRESSED` | last match won by the player && no boxer available → KINGPIN 15 | `ID:3780-3785` |
| 138 | `START_BOXING_MATCH` | if `CheckOnBoxers()`: menu, bell, clear every `SOLDIER_BOXER`, state `BOXING_WAITING_FOR_PLAYER` (§7) | `ID:2240-2248` |
| 205 | `HANDLE_END_OF_FIGHT` | `ExitBoxing()`; menu | `ID:2885-2900` |
| 206 | `DARREN_PAYS_PLAYER` | closest PC; Darren needs a money slot and an empty slot: create `2 × balance` money in the empty slot, subtract it from the stash (no check that the stash suffices), hand the new pile to the PC (swapping slots first if the stash comes earlier) | `ID:2902-2940` |
| 247 | `SET_FACT_105_FALSE` | `FRANK_HAS_BEEN_BRIBED` false | `ID:3689-3691` |
| 128 | `TRIGGER_LAYLA_13_14_OR_15` | Carla available → MADAME 13; else Cindy → 14; else Bambi → 15 | `ID:2260-2273` |
| 125 | `SET_GIRLS_AVAILABLE` | `NO_GIRLS_AVAILABLE` T; `Random(3) ≠ 0` → Carla T (and no-girls F) else F; `Random(2) ≠ 0` → Cindy; `Random(2) ≠ 0` → Bambi | `ID:2541-2576` |
| 126 | `SET_DELAY_TILL_GIRLS_AVAILABLE` | same-day event at `minute + 1 + Random(2)` → action 125 for MADAME | `ID:2578-2580` |
| 127 | `SET_WAITED_FOR_GIRL_FALSE` | fact 93 false | `ID:2582-2584` |
| 129–132 | `OPEN_CARLAS/CINDYS/BAMBIS/MARIAS_DOOR` | **unlock** (not open) the door at 12290 / 13413 / 11173 / 10852 | `ID:2276-2323` |
| 133 | `POSSIBLY_ADVERTISE_CINDY` | Cindy available → MADAME 14; then (fall-through) as 134 | `ID:2325-2330` |
| 134 | `POSSIBLY_ADVERTISE_BAMBI` | Bambi available → MADAME 15 | `ID:2331-2336` |
| 124 | `LAYLA_GIVEN_WRONG_AMOUNT_OF_CASH` | no girls → MADAME 27 and **continue**; else Carla → 28 and stop; then 217 | `ID:2338-2351` |
| 217–220 | `LAYLAS_NEXT_LINE_AFTER_CARLA/CINDY/BAMBI/MARIA` | chain: Cindy → 29 stop; Bambi → 30 stop; Maria quest in progress → 31 stop; `MULTIPLE_MERCS_CLOSE` (of Madame) → 32 | `ID:2352-2386` |
| 122 | `SEX` | `SetPendingNewScreen(SEX_SCREEN)`; the screen warps game time by `5 + Random(20)` minutes without event processing when it ends (`JAScreens.cc:478-483`); ja2-node runs the warp at the action (deviation "Brothel time warp"); the other gameplay effects come from the sex action item (§11.5), which also warps | `ID:2184-2190` |
| 143 | `TRIGGER_ANGEL_17_OR_18` | `ANGEL_SOLD_VEST` → R 18, else R 17 | `ID:2470-2479` |
| 146, 148 | `TRIGGER_ANGEL_16_OR_19`, `…_21_OR_22` | a PC in Angel's room → R 16 / R 22, else R 19 / R 21 | `ID:2481-2501` |
| 246 | `TRIGGER_ANGEL_22_OR_24` | `ANGEL_LEFT_DEED` → R 22, else R 24 | `ID:3596-3605` |
| 145 | `TRIGGER_MARIA` | escape not noticed → MARIA 8; else PC in Maria's room → 9, else 10 | `ID:2503-2519` |
| 147 | `ANGEL_LEAVES_DEED` | Angel's `DEED` to the pool at 12541 (invisible, level 0), removed from soldier and profile; menu; queue 149 (un-recruit, retargeted to Maria) and 52 (experience 3); → ANGEL 24 | `ID:2521-2539` |
| 123 | `KYLE_GETS_MONEY` | a $10000 money item, invisible, at 14952 on Kyle's level; Kyle cancels his action, `PENDING_ACTION`, `quoteRecord = 123`, picks it up; when the pickup ends → KYLE 11 (`TacticalAI/AIMain.cc:664-668`) | `ID:2192-2219` |
| 136 | `ADD_JOEY_TO_WORLD` | `JOEY.sector = D4-1`; event in 3 days at the same minute (§3.13) | `ID:2250-2253` |
| 154 | `DECIDE_ACTIVE_TERRORISTS` | add the terrorist files to the laptop (`Laptop/Files.cc:1009-1015`, `21` §6.4); `CARMEN.npcData2 = 0` | `ID:2674-2680` |
| 156 | `CHECK_LAST_TERRORIST_HEAD` | `CARMEN.npcData −= 1` (terrorists left), `npcData2 += 1` (heads held); loaded sector C13 → CARMEN 20, else 21; history `GAVE_CARMEN_HEAD` | `ID:2682-2699` |
| 158 | `CARMEN_LEAVES_FOR_GOOD` | `LEFT_COUNTRY`; falls through to 157 | `ID:2701-2703` |
| 157 | `CARMEN_LEAVES_FOR_C13` | `DONT_ADD_TO_SECTOR`; a 10 000 ms timer (`amount` param of the code that runs: 158 falls through with its own, absent, parameters, so it always waits 10 000 ms) → `CarmenLeavesSectorCallback`: loaded C13 → CARMEN 34, G9 → 35, C5 → 36 (`ID:4685-4702`); ja2-node counts the 10 000 ms on tactical game time (deviation "Carmen's departure timer") | `ID:2704-2712` |
| 159 | `CARMEN_LEAVES_ON_NEXT_SECTOR_LOAD` | if `CARMEN.npcData == 0`: `ALL_TERRORISTS_KILLED`, +5 loyalty everywhere; always `CARMEN.money = 0` | `ID:2714-2724` |

### 3.7 Cambria: the hospital, Joey and Martha; the mines

| Code | Action | Effect | Lines |
|---|---|---|---|
| 118 | `CHOOSE_DOCTOR` | Steve and Vince count if in sector, civilian team, neutral, ≥ OKLIFE; both → the one standing at 10343 wins; still both → `Random(2) ≠ 0` drops Steve, else Vince; Steve left → R 12, else R 13 (of `npc`) | `ID:3478-3541` |
| 160 | `TRIGGER_VINCE_BY_LOYALTY` | VINCE owed money → R 21; else !`VINCE_EXPLAINED_HAS_TO_CHARGE` → R 15; else loyalty low → modifier `NORMAL`, R 16; okay → `BREAK`, R 17; else `r = PreRandom(100)`; Vince: (modifier `RANDOM_FREEBIE` or `FREEBIE`, or !`FREEBIE_DECISION_MADE` and `r < 20`) → set decision made; high loyalty && `24_HOURS_SINCE_DOCTOR_TALKED_TO` → `FREEBIE`, R 19, else `RANDOM_FREEBIE`, R 20; otherwise `COST`, R 18. Steve: `WILLIS_GIVES_DISCOUNT` → `COST`, R 21; heard about Joey → `FREEBIE`, R 20; high && 24 h && (`FREEBIE` or (!decision and `r < 20`)) → `FREEBIE`, R 19; else `COST`, R 18 | `ID:3272-3356` |
| 237 | `DOCTOR_ESCORT_PATIENTS` | every OUR soldier in sector with `0 < life < lifeMax`, not already in hospital, **strictly** closer than 9 to the doctor: `SetSoldierAssignmentHospital`, → (patient's profile) 2, `hospitalPriceModifier = global`, absolute destination cleared; then `FREEBIE_DECISION_MADE` false, global modifier `NORMAL` | `ID:3361-3389` |
| 164 | `START_DOCTORING` | `VINCE_EXPECTING_MONEY` false; stolen supplies → R 28, else R 35 | `ID:3391-3407` |
| 165 | `VINCE_UNRECRUITABLE` | `VINCE_RECRUITABLE` false | `ID:3409-3411` |
| 139 | `ENABLE_CAMBRIA_DOCTOR_BONUS` | event at `(day + 1)·1440 + minute + (24 + Random(24))·60`, i.e. 48–71 h later (enum comment: obsolete) | `ID:2128-2134` |
| 257, 258 | `24_HOURS_SINCE_JOEY_RESCUED`, `…_DOCTORS_TALKED_TO` | event in 24 h setting fact 305 / 306 | `ID:3822-3828` |
| 140 | `MARTHA_DIES` | menu; `EVENT_SoldierGotHit(Martha, 1, 100 damage, 10 breath, her direction, range 320, torso)` (the damage path draws, `11`) | `ID:2225-2234` |
| 172 | `START_MINE` | `PlayerSpokeToHeadMiner(npc)`; shut-down mine → `RestartMineProduction` (`18`) | `ID:2788-2800` |
| 173 | `STOP_MINE` | running → `ShutOffMineProduction` | `ID:2802-2811` |
| 174 | `RESET_MINE_CAPTURED` | `ResetQueenRetookMine(npc)` (`mines.ts`) | `ID:2813-2815` |
| 175–179 | `SET_OSWALD/CALVIN/CARL/FRED/MATT_RECORD_13_USED` | `SetQuoteRecordAsUsed(npc, 13)` (`24`) | `ID:2817-2823` |

### 3.8 Alma, Tixa and the south

| Code | Action | Effect | Lines |
|---|---|---|---|
| 180 | `TRIGGER_MATT` | `DYNAMO_IN_J9` → MATT 15; else Dynamo alive → MATT 16 | `ID:2825-2834` |
| 184 | `KROTT_ALIVE_LOYALTY_BOOST` | Krott (SERGEANT) not dead → Alma +20 | `ID:3437-3443` |
| 190 | `TRIGGER_KROTT_11_OR_12` | `KROTT_GOT_ANSWER_NO` → SERGEANT 11, else 12 | `ID:3718-3727` |
| 171 | `START_BLOODCAT_QUEST` | `StartQuest(13)` | `ID:2784-2786` |
| 298 | `TRIGGER_BREWSTER_BY_WARDEN_PROXIMITY` | Warden's corpse within 10 of Brewster → BREWSTER 16, else 17 | `ID:4009-4025` |
| 263 | `TRIGGER_JOE_32_OR_33` | loaded z > 0 → JOE 32, else 33 | `ID:3851-3859` |

### 3.9 Madlab and the robot, vehicles, Chitzena, Balime and the rest

| Code | Action | Effect | Lines |
|---|---|---|---|
| 191 | `MADLAB_GIVEN_GUN` | `MADLAB_EXPECTING_FIREARM` false; still expecting a camera → R 14, else R 18 | `ID:2836-2846` |
| 192 | `MADLAB_GIVEN_CAMERA` | `…EXPECTING_VIDEO_CAMERA` false; still expecting a firearm → R 17, else R 18 | `ID:2848-2858` |
| 193 | `MADLAB_ATTACHES_GOOD_CAMERA` | `MADLAB_HAS_GOOD_CAMERA` false; Madlab's first gun auto-placed into the robot's soldier; `RecruitEPC(ROBOT)` (§9.4) | `ID:2860-2879` |
| 194 | `READY_ROBOT` | event tomorrow 07:00 (§3.13) | `ID:2881-2883` |
| 296, 297 | `TRIGGER_MADLAB_31/32` | team full → menu and message; else MADLAB 31 / 32 | `ID:3987-4007` |
| 211 | `TIMER_FOR_VEHICLE` | event in 24 h: `OK_USE_HUMMER` | `ID:3844-3846` |
| 202 | `FILL_UP_CAR` | the hummer on our team (or the ice-cream truck if no hummer, or if the hummer is full and the truck is ours): fuel `sBreathRed = 10000`, `bBreath = 100` (enum comment: obsolete) | `ID:4027-4051` |
| 256 | `MAKE_ESTONI_A_FUEL_SITE` | `SetFactTrue(ESTONI_REFUELLING_POSSIBLE)` (Jake's gas, §1.1); `UpdateRefuelSiteAvailability()` (§10.1) | `ID:3816-3820` |
| 185 | `TRIGGER_YANNI` | `CHALICE_STOLEN` → YANNI 8, else 7 | `ID:3622-3630` |
| 195, 196 | `WALTER_GIVEN_MONEY(_INITIALLY)` | `WALTER.balance ≥ 20000` (`amount` param) → WALTER 16; else 14 (initially) / 15 | `ID:1556-1569, 4053-4055` |
| 234 | `START_TIMER_ON_KEITH_GOING_OUT_OF_BUSINESS` | `KEITH_GOING_OUT_OF_BUSINESS` event at `now + 6·1440` (§4.7) | `ID:3192-3195` |
| 235 | `KEITH_GOING_BACK_IN_BUSINESS` | `KEITH_OUT_OF_BUSINESS` false | `ID:3197-3199` |
| 213 | `TRIGGER_MICKY_BY_SCI_FI` | sci-fi → MICKY 7, else 8 | `ID:3708-3716` |
| 236 | `MAKE_RAT_DISAPPEAR` | `RAT.npcData = 1` (Rat leaves at the next 04:00) | `ID:3703-3706` |
| 251 | `ADD_RAT` | `RAT.sector = G9` (called by the creatures meanwhile, `26`) | `ID:3787-3790` |
| 295 | `TRIGGER_HANS_BY_ROOM` | src exists: src in room 49 → HANS 18, else HANS 14 | `ID:3971-3985` |
| 42 | `GET_OUT_OF_WHEELCHAIR` | soldier with body `CRIPPLECIV`: menu, animation `CRIPPLE_KICKOUT` (its end makes him `REGMALE`; Slay hostile then raises his gun, `Tactical/Soldier_Ani.cc:3445-3467`; deviation "Wheelchair kick-out") | `ID:3660-3669` |
| 43 | `GET_OUT_OF_WHEELCHAIR_AND_BECOME_HOSTILE` | as 42, then always `TriggerFriendWithHostileQuote(npc)` (`NPC:2517-2565`: one `Random(n)` among the profiled teammates who see an enemy, else action 25) | `ID:3671-3681` |
| 227 | `HAVE_MARRIED_NPC_LEAVE_TEAM` | §11.9 | `ID:2438-2468` |
| 149, 168 | `UN_RECRUIT_EPC`, `SET_EPC_TO_NPC` | §9.2 | `ID:2586-2623` |
| 117 | `FREE_KIDS` | event tomorrow 07:00: `KIDS_ARE_FREE` (§3.13) | `ID:2625-2627` |
| 121 | `DELAYED_MAKE_BRENDA_LEAVE` | menu; same-day event at `minute + 360` (6 h, the comment says a minute): `BRENDA_PATIENCE_TIMER_EXPIRED` | `ID:2177-2182` |
| 186, 187 | `TRIGGER_MARY_OR_JOHN_RECORD_9/10` | Mary's soldier ≥ OKLIFE → MARY 9 / 10, else JOHN 9 / 10 | `ID:3632-3658` |
| 110 … | requestors | §3.3 | |

### 3.10 Meanwhile and endgame actions (`26`)

Listed for completeness; `26` specifies them: 170 `END_MEANWHILE`, 222 `REMOVE_JOE_QUEEN`, 223 `REMOVE_ELLIOT_END_MEANWHILE`,
224 `NO_SCI_FI_END_MEANWHILE` (no sci-fi → end, else → QUEEN 8), 29 `TRIGGER_QUEEN_BY_CITIES_CONTROLLED` (towns excluding Omerta
0/1 → 11, 2 → 7, 3 → 8, 4 → 9, 5 → 10, more → 11), 32 `TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED` (0/1 → 7, 2 → 8, 3 → 9), 215
`TRIGGER_ELLIOT_BY_BATTLE_RESULT`, 216 `TRIGGER_ELLIOT_BY_SAM_DISABLED`, 238 `ELLIOT_DECIDE_WHICH_QUOTE_FOR_PLAYER_ATTACK`, 239
`QUEEN_DECIDE_…`, 28 `SLAP`, 36 `FRUSTRATED_SLAP`, 33–35 `PUNCH_PC_SLOT_0..2` (targets at the interrogation gridnos 7756,
7757, 7758, `Strategic/Queen_Command.cc:50`), 37 `PUNCH_FIRST_LIVING_PC`, 38 `SHOOT_ELLIOT` (creates a Desert Eagle in the
shooter's hand, `ELLIOT.npcData = 17`), 221 the lie prompt (§3.3), 253/254 `ENDGAME_STATE_1/2`, 231 `END_DEMO`. Lines
`ID:2396-2431, 3015-3190, 3201-3270, 3412-3435, 3458-3462, 3792-3814`.

### 3.11 Item and money acceptance with quest effects (`NPC:660-1047`)

`24` runs `NPCConsiderReceivingItemFromMerc` (an enemy NPC except Joe takes nothing; rifles and MGs count as `ANY_RIFLE`,
heads `HEAD_2/3/5/6/7` as `HEAD_2` — `HEAD_4`, Slay's, is not a terrorist head; `MONEY`/`SILVER`/`GOLD` as `MONEY` and set
`SMALL/LARGE_AMOUNT_OF_MONEY` by `uiMoneyAmount < LARGE_AMOUNT_MONEY`; wine and beer as `ALCOHOL`; `ITEM_POOR_CONDITION` =
status < 50). For the first record that wants the item and passes, these per-NPC rules apply (`NPC:736-938`):

| NPC | Rule |
|---|---|
| DARREN (record action 141) | money < 1000 → record 15; > 5000 → 16; else `balance = amount`, `DARREN_EXPECTING_MONEY` false, record 17 unless already said, else record 18 if Kingpin stands in his house (D5 rooms 30–39, `Quests.h:209`), else 31 |
| ANGEL (record action 142) | money below / above the price of `LEATHER_JACKET_W_KEVLAR` → 8 / 9; equal → 10 |
| MADAME (money) | a female giver → 5; 100/200 with Carla available: `npcData += amount/100`, → MADAME 16; 500/1000 Cindy (/500), → 17; 300/600 Bambi (/300), → 18; 400/800 while the Maria quest runs (/400), → 19; any other amount (or girl not available) → 25 (that record returns the money, per the code comment) |
| JOE, GERARD | money and a record whose action is `JOE_GIVEN_CASH` / `GERARD_GIVEN_CASH`: `balance += amount`, then ≥ 10000 → 7 / 12, else 6 / 11; money with another record: that record as is |
| VINCE, STEVE | !`VINCE_EXPECTING_MONEY`, `balance < 0` and not refusing: pay off the debt (`balance += amount`, cost to date += amount, clamp at 0, message); !expecting and not refusing: plain accept with record 8 / 7 (the record-number output stays 0, `NPC:893-902`); expecting: `c = CalcMedicalCost`; `amount + tempBalance + refund ≥ c` → 26 if `WOUNDED_MERCS_NEARBY` else 25 if one (else record 0), and if `refund > 0`: `refund = refund − c + amount` (the `max(0U, …)` is unsigned: no clamp), `tempBalance = 0`; else message with `c − amount − tempBalance`, → 27, `tempBalance += amount` |
| WALTER | `balance == 0` → 12 else 13; `balance += amount` |
| FRANK | money goes to the dealer's cash (`23`), record 0 |
| KINGPIN | while quest 4 is in progress: `amount < −balance` → 9 else 10; `balance += amount`; otherwise the record as is |
| SKYRIDER and any RPC | `balance < 0` and not refusing: pay off the debt as for Vince (cost to date, clamp, message) |

ja2-node runs these rules in `src/sim/narrative/select.ts` from the `give` flow, with `CalcMedicalCost` from the hospital
code (`medicalCostAt`, with the per-patient price modifiers), Frank's cash, the cost to date of a paid debt
(`finances.profileCostToDate`) and the `balanceOwed`/`needsMoney` messages. The Vince/Steve chain evaluates
`CheckFact(VINCE_EXPECTING_MONEY)` in each condition, as the original does.

### 3.12 Actions run outside dialogue

| Caller | Action | Lines |
|---|---|---|
| Kingpin dies while quest 4 runs | 52 (experience 3), immediate | `OH:2397` |
| Doreen dies before the kids are free | 117 for DOREEN, immediate | `OH:2415-2418` |
| Creature queen dies | 54 (experience 5) | `OH:2488` |
| POW release in the Alma prison | 52 | `SM:1005` |
| NPC system event of 126 | 125 for MADAME | `SEH:632-634` |
| Slay's wheelchair kick-out ends while Slay is hostile | 5 | `Tactical/Soldier_Ani.cc:3460-3463` |
| Slay becomes friendly in his wheelchair | 42 | `ID:2752-2755` |
| Sex action item | 122 | `TileEngine/Explosion_Control.cc:1871` |
| Meanwhiles | 31, 30, 251 for QUEEN | `Strategic/Meanwhile.cc:450-466` (`26`) |
| Records with `QUOTE_GETLOST` for profiles 70 (CONRAD) and 120 (GENERAL) | 22, queued | `NPC:1617-1622` (`24`) |
| Angel's deed | 149, 52, queued | `ID:2535-2536` |

### 3.13 NPC system events (`EVENT_SET_BY_NPC_SYSTEM`, `SEH:549-691`)

The event parameter is a fact id (< 10000) or `10000 + action` (`NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS`,
`Strategic/Game_Event_Hook.h:74`).

| Param | Posted by | Handler |
|---|---|---|
| 41 `PABLOS_BRIBED` | `SetPabloToUnbribed` with extra days (never) | `SetPabloToUnbribed`: extra days > 0 → repost; else fact 41 false (`SEH:445-457`) — no poster exists, so a bribe never wears off (kept) |
| 34 `REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING` | Bobby Ray (`21`) | fact 34 false; `LARGE_SIZED_SHIPMENT_WAITING` → `LARGE_SIZED_OLD_SHIPMENT_WAITING` true |
| 56, 305, 306 | actions 115, 257, 258 | set the fact |
| 103 `KINGPIN_KNOWS_MONEY_GONE` | §11.4 | !103 → `CheckForKingpinsMoneyMissing(FALSE)`; else Kingpin alive: quest 4 not started → email `KING_PIN_LETTER`, `StartQuest(4, D5)`, repost in 2 days at `Random(120)`; quest in progress → `KINGPIN_CAN_SEND_ASSASSINS`, `SPIKE.sector.{x,y} = C5` (z unchanged), `civGroupHostile[KINGPIN] = WILL_BECOME_HOSTILE` |
| 10108 | action 108 | `HandleDelayedItemsArrival` (§11.2) |
| 10116 | action 116 | `HandlePossiblyDamagedPackage`: `Random(100) < 70` → `PACKAGE_DAMAGED` and move the lost pool; else `PACKAGE_LOST_PERMANENTLY`; always `SHIPMENT_DELAYED_24_HOURS` false (`SEH:460-473`) |
| 10139 | action 139 | `WILLIS_HEARD_ABOUT_JOEY_RESCUE` |
| 10112 | action 112 | Father alive → `EndQuest(1, A10)`, `FOOD_QUEST_OVER` |
| 10121 | action 121 | `BRENDA_PATIENCE_TIMER_EXPIRED` |
| 10126 | action 126 | action 125 for MADAME |
| 10194 | action 194 | first robot destroyed → `ROBOT_READY_SECOND_TIME`, robot profile life = max, status `MERC_OK`; else `ROBOT_READY`; `ROBOT.sector = MADLAB.sector` |
| 10136 | action 136 | Joey alive, not escorted, still in D4-1: his soldier exists (sector loaded) → repost in 60 min; else `JOEY.sector = C5` |
| 10230 | action 230 | email `ENRICO_MIGUEL` (`21`) |
| 10211 | action 211 | `OK_USE_HUMMER` |
| 10117 | action 117 | `KIDS_ARE_FREE` |

---
## 4. Strategic NPC presence

### 4.1 The location model

An NPC exists in the world only as its profile's `sector` (with z) until a sector loads; then the placement and profile
rules of §4.6 create a soldier. Rules that move an NPC write the profile (`ChangeNpcToDifferentSector(p, s)`,
`Tactical/Tactical_Save.cc:733-744`: `LEFT_COUNTRY` overrides the target with nowhere; `useProfileInsertion = FALSE`). Flags:
`DONT_ADD_TO_SECTOR` (Carmen while away; schedules skip his entry, §5.3), `LEFT_COUNTRY`, `PERMANENT_INSERTION_CODE` (the
profile's insertion data is fixed: Manny, Brenda, Miguel, un-recruited EPCs; schedules are not posted for them, §5.2),
`useProfileInsertion` + `insertionCode/Data` (add at a gridno instead of the map placement). Most moves refuse to happen while
the NPC's sector is loaded (the 04:00 rules) so a visible NPC never vanishes.

### 4.2 New game (`InitNewGame`/`InitStrategicLayer`, `15` §4.2–§4.6)

1. `LoadMercProfiles` → `DecideActiveTerrorists` (`SP:246-301`): chance 70/50/30 by difficulty; extra terrorists = 2 + one
   per `Chance(chance)` of two; repeat sweeps over `g_terrorist_infos` (`SP:87-95`: DRUGGIST (preplaced, no sectors), SLAY,
   ANNIE, CHRIS, TIFFANY, T_REX, five candidate sectors each) until enough are placed; per candidate with `sector.x == 0`
   (DRUGGIST is skipped because `prof.dat` places him): `Random(100) ≥ 40` → skip; else `Random(5)` repeated until the sector
   is not used by a terrorist placed in this call; `sector =` it. Then `CARMEN.npcData = gubNumTerrorists = 1 + extra`.
2. `InitAllArmsDealers`, Bobby Ray (`21`, `23`).
3. `InitStrategicLayer`: `SetupNewStrategicGame`; **`InitQuestEngine`** (§2.3: the first history entries, quest 0); campaign,
   squads, vehicles, loyalty, mines (`18`); **`InitNPCs`** (`Strategic/Game_Init.cc:73-116`): for the placements of
   `strategic-map-npc-placements.json` in **profile-id order** (`std::map`, `externalized/ContentManager.h:194`): DEVIN 61,
   HAMOUS 63, CARMEN 78, BOB 84 (sci-fi only), MICKY 96, SKYRIDER 97, GABBY 104 (sci-fi only), MADLAB 146; skipping sci-fi-only
   ones without sci-fi, each draws `Random(#sectors)` (`externalized/strategic/NpcPlacementModel.cc:32-40`; BOB's single sector
   still draws `Random(1)`), sets `SF_USE_ALTERNATE_MAP` on the pick if `useAlternateMap` (SKYRIDER, MADLAB, GABBY) and moves
   the profile there if `placedAtStart` (SKYRIDER, MICKY, BOB, GABBY; DEVIN, HAMOUS and CARMEN draw for nothing; MADLAB only
   gets his alternate map, his profile moves in the AWOL meanwhile, `26`); then `gfPlayerTeamSawJoey = FALSE`; Tixa J9-1
   alternate map without sci-fi; hospital globals 0; `DEVIN.npcData = 3` (he moves at the first 04:00 he is eligible).
   **`InitializeHelicopter`** (`HELI:137-176`): every helicopter global reset (§10.1).

### 4.3 The 04:00 event (`HandleEarlyMorningEvents`, `SEH:693-865`)

In this order (draws in brackets; "not loaded" = the NPC's profile sector is not the loaded sector):

1. Every NPC/RPC profile: clear the three "default response used recently" flags (`24`) and `BANDAGED_TODAY`.
2. `FATHER.npcData = Random(4)` [`Random(4)`].
3. [`Random(2)`] non-zero and neither C13 nor D13 loaded: Father's sector toggles between C13 and D13 (x forced to 13).
4. Tony, if `lastDateSpokenTo > 0` and C5 is not loaded: [`Random(4)`] non-zero → `TONY_NOT_AVAILABLE` false, sector C5; zero
   → true, sector nowhere.
5. Devin, if never spoken to: `npcData += 1`; above 3 and not loaded → `sector = pick` [`Random(5)` over G9, D13, C5, H2, C6;
   the same sector may come again].
6. Hamous, if `life > 0`, neither Hamous nor the ice-cream truck on our team, and not loaded: [`Random(5)` over G6, F12, D7,
   D3, D9] → Hamous **and** `PROF_ICECREAM` to that sector.
7. Rat: `npcData ≠ 0` → sector nowhere.
8. `money(VINCE) = money(STEVE) = money(JENNY) = 0` (`SetMoneyInSoldierProfile`); `VINCE_EXPECTING_MONEY` false;
   `DARREN.balance = 0`, `money(DARREN) = 15000`.
9. Carmen: `DONT_ADD_TO_SECTOR` set → clear it, sector C13; if heads held (`npcData2 > 0`): `money = (money < 10000 ? 0 :
   money) + 10000 × npcData2`, `npcData2 = 0`, every `HEAD_1..HEAD_7` removed from his profile inventory. Otherwise, if not
   loaded: [`Random(3)` over C5, C13, G9] → sector; `money < 5000` → 5000.
10. [`PreRandom(3)`] `== 0` → `DAVE_HAS_GAS` true, else false.
11. The hospital sector F8 loaded → `CheckForMissingHospitalSupplies` (§11.3).

The event runs during the new-game warp (`15` §4.5), so its draws precede the first landing.

### 4.4 Hourly and daily NPC handlers

Hourly, in `HandleHourlyUpdate` order (`15` §3.2; all return while `didGameJustStart`):

- **`HourlyProgressUpdate`** (`Tactical/Campaign.cc:1289-1325`): the first time the highest progress crosses 35 % →
  `HandleScientistAWOLMeanwhileScene` (`26`); 50 % → `facts[275] = 1` (Mike); 70 % → `IGGY.sector = C5` (policy
  `progress.event_*_min`).
- **`HourlyQuestUpdate`** (`HU:95-152`), by world hour: 4 → `BROTHEL_OPEN` false; 20 → true; 15 → `CLUB_OPEN` true,
  `PAST_CLUB_CLOSING_AND_PLAYER_WARNED` false, `gfBoxerFought[0..2] = FALSE`, then boxers resting → stop resting and
  `gubBoxersRests += 1`, else `gubBoxingMatchesWon / 3 > gubBoxersRests` → start resting; 2 → `CLUB_OPEN` false; 9 →
  `MUSEUM_OPEN` true; 18 → false.
- **`HourlyLarryUpdate`** (`HU:154-305`): Larry (`LARRY_NORMAL 46` or `LARRY_DRUNK 47`) on our team, on a squad, not between
  sectors, and not (in the loaded sector while enemies are there or the player is in tactical); temptation = that of the
  first item of `LarryItems` (`HU:157-167`: `ADRENALINE_BOOSTER` 5/100 points, `ALCOHOL` 4/25, `MEDICKIT` 4/10, `WINE` 3/50,
  `REGEN_BOOSTER` 3/100, `BEER` 2/100) he carries; if below 4, the balance covers an `ALCOHOL` and his sector is a bar (D13,
  C13, C5, D5, C6, H2): temptation 4, "bar". Sober Larry: `npcData(46) += Random(t)`; ≥ 8 (`LARRY_FALLS_OFF_WAGON`) → (bar:
  ledger `TRANSFER_FUNDS_TO_MERC −price`, a 100 % `ALCOHOL` into the first empty slot from the hand to the eighth small
  pocket, which becomes the item used; with no free slot he still pays) `SwapLarrysProfiles` (`SP:941-1037`, `LARRY_CHANGED`)
  and `UseKitPoints(item, points)`. Drunk Larry with temptation: `npcData(46) = min(max(npcData, 8) + Random(t), 24)`; bar
  purchase as above; use the item. Drunk without temptation: `npcData −= Random(2)`; ≤ 0 → swap back.
- **`HourlyCheckIfSlayAloneSoHeCanLeave`** (`HU:308-328`): Slay on our team, not between sectors, alive, the only OUR merc in
  his sector → [`Chance(15)`] → leave history `SLAY_MYSTERIOUSLY_LEFT`, contract ending without the equipment question (`22`).
- **`PayOffSkyriderDebtIfAny`** (`HELI:1387-1415`): owed = `−balance(SKYRIDER)`; owed > 0 and money > 0 → pay `min(owed,
  balance)` (ledger `PAYMENT_TO_NPC`), message; still owed → message and his "owed money" quote. When the money does not
  cover the debt it takes all of it.

Daily: **`HandleSlayDailyEvent`** (`SM:2870-2893`) at the end of `MercDailyUpdate` (`22`): Slay on our team, alive, not
`IN_TRANSIT`/POW, `contractEnd / 1440 ≤ day` → leaves as above (he joins with a 7-day contract, `SP:700-706`).

### 4.5 Sector entry and exit

**Entry** (`EnterSector`, `SM:827-905`, before the new map loads): `SetupProfileInsertionDataForCivilians` for the
civilians still in the old world (§4.6); then, unless loading a save, **`HandleQuestCodeOnSectorEntry(new)`**
(`SM:669-799`):

1. `ALL_TERRORISTS_KILLED` → `EndQuest(2, Carmen's sector)`, Carmen's sector → nowhere (every entry, repeatedly).
2. Head miners on the first surface entry of a mine sector (`placeHeadMinersOnSectorEntry`, `18`).
3. !`ROBOT_RECRUITED_AND_MOVED` and the robot on our team → remove the "robot under construction" graphic at `gsRobotGridNo`
   from Madlab's sector temp file (the variable is never assigned in Strac or V: gridno 0, a no-op) and set the fact.
4. Any OUR soldier (anywhere) carrying `CHALICE` → `CHALICE_STOLEN`.
5. Quest 4 in progress, `KINGPIN_CAN_SEND_ASSASSINS`, the new sector belongs to a town, and [`Random(10 + militia in the
   sector)`] `< 3` → `DecideOnAssassin` (§11.4).
6. D5 → `gBoxer[0..2] = none` (§7.2).
7. P3 → Elliot's profile life = max unless he is dead.
8. `ResetOncePerConvoRecordsForAllNPCsInLoadedSector` (`24`; the world is still the old one).

Steps 6 and 7 compare `sNewSector.AsByte()`, so they also run for any level below D5 and P3.

**Exit** (`HandleDefiniteUnloadingOfWorld`, `SM:2902-2953`, both when loading a new map and when trashing the world;
ja2-node `SectorFlow.handleDefiniteUnloadingOfWorld`) runs **`HandleQuestCodeOnSectorExit(old)`** (`SM:802-825`) before the
temp files are saved: D5-1 → `CheckForKingpinsMoneyMissing(TRUE)` (§11.4); H13 and `CONRAD_SHOULD_GO` → Conrad's sector
nowhere; F8 → `CheckForMissingHospitalSupplies`; always `MUSEUM_ALARM_WENT_OFF` false. Loading a new map then writes every
non-player soldier's life and stats back into its profile (`UpdateSoldierPointerDataIntoProfile`, `SP:916-940`); trashing
calls `SetupProfileInsertionDataForCivilians` instead.

### 4.6 Putting NPCs into a loaded sector, and taking them out

`PrepareLoadedSector` (`SM:573-660`): civilians (unless an empty mine), militia, bloodcats, creatures, militia prep, virgin
flag, **`AddProfilesNotUsingProfileInsertionData`**, enemies, **`AddProfilesUsingProfileInsertionData`**, **`PostSchedules`**
(§5.2).

`AddPlacementToWorld(node)` (`SIL:412-568`), for a detailed placement with a profile, refuses (returns false, no soldier)
unless the profile's sector equals the loaded sector **including z**, it is neither `RECRUITED` nor `EPCACTIVE`, `life ≠ 0` and
`!useProfileInsertion`. Then the quest overrides (civilian team only):

| Where | Rule | Lines |
|---|---|---|
| ice-cream truck placement | only when "the truck is on our team", tested as `FindSoldierByProfileIDOnPlayerTeam(ICECREAMTRUCK)` — a **body-type value (26, `Animation_Data.h`) used as a profile id**: the A.I.M. merc with id 26; then the placement is skipped (returns true) unless Hamous is in this sector and not recruited | `:436-446` |
| C5, Kingpin group, (`civGroupHostile[KINGPIN] == WILL_BECOME_HOSTILE` or quest 4 in progress with `KINGPIN_CAN_SEND_ASSASSINS`) | unprofiled: gridno = `13531 + u(−7, 7) + u(−7, 7)·160` (two `std::uniform_int_distribution` draws on the shared engine; ja2-node draws them on `main`, x first, deviation "Kingpin's men placement"), orders by [`PreRandom(3)`] `ONGUARD/CLOSEPATROL/ONCALL`; BILLY: `u(−29, 29)` twice, `SEEKENEMY`; MADAME: skipped | `:458-496` |
| P3, not in a meanwhile | Queen dead → Queen's civ group skipped; alive → `gfUseAlternateQueenPosition` puts the Queen at 11448 and every civilian **not** in the Queen's group is skipped (`26`) | `:497-516` |
| J9 (Tixa) liberated | unprofiled civilians other than kids skipped | `:518-529` |
| C13 with `KIDS_ARE_FREE` | kid bodies skipped | `:530-538` |
| enemy elites | `OkayToUpgradeEliteToSpecialProfiledEnemy`: one per load, not for encounter or invasion codes, not on a roof: `facts[275] == 1` → becomes MIKE, set 2; else `facts[283] == 1` → IGGY, set 2 (`Tactical/Soldier_Create.cc:2068-2083`) | `:540-549` |

`AddProfilesNotUsingProfileInsertionData` (`SIL:1714-1730`): every civilian node without a soldier, with a detailed profiled
placement whose profile has `!useProfileInsertion` and `life ≠ 0` → `AddPlacementToWorld` again (catches nodes the first pass
skipped after a full team).

`AddProfilesUsingProfileInsertionData` (`SIL:1647-1712`): for every NPC/RPC/vehicle profile in content order whose sector is
the loaded one (with z), not recruited or EPC, alive and with `useProfileInsertion`: reuse its soldier or create a civilian
soldier of that profile; set its insertion code/data from the profile and `UpdateMercInSector`; if `quoteRecord ≠ 0`, copy
record and action id and, for `CHECKFORDEST`, call `NPCReachedDestination(…, FALSE)` (`24`); link the soldier to its
init-list node and to that node's schedule.

**Taking NPCs out** (`SetupProfileInsertionDataForSoldier`, `SM:3137-3203`, for every civilian in the old world before a new
sector loads or the world is trashed): skip `PERMANENT_INSERTION_CODE`; a soldier in the sector with a pending record and
action: traversal codes → move the profile one sector (`HandleNPCChangesForTacticalTraversal`, `NPC:2585-2604`; not for
scheduled civilians), `useProfileInsertion = FALSE`, `HANDLE_DONE_TRAVERSAL` if he has a done-traversal record; other codes →
insertion `GRIDNO` at his final destination (gridno if there, else the absolute or plain final destination), `useProfile`
true, `quoteActionId = action`, **`quoteRecord = action`** (the record is overwritten by the action id: kept); no pending
action → `useProfileInsertion = FALSE`. A soldier not in the sector keeps the strategic code with data 0 and
`useProfileInsertion = TRUE`. On save (`SaveNPCInformationToProfileStruct`, `Tactical/Tactical_Save.cc:704-728`) every
profiled civilian copies record/action and, unless `DONT_ADD_TO_SECTOR` or permanent, its current gridno as insertion data
(ja2-node's own saves keep the soldiers; only native import uses this).

An NPC that walks off the map with a traversal action (`HandleAITacticalTraversal`, `TacticalAI/AIMain.cc:2013-2040`) runs
`HandleNPCChangesForTacticalTraversal` (profile one sector on), marks a done-traversal record, and leaves: into an away slot
if it is a scheduled civilian (it may come back, §5.4), else removed. A schedule move reaches it only when the off-edge
extension stops at the world's bounds (§5.3). ja2-node's `handleAITacticalTraversal` (`src/sim/tactical/ai/control.ts`)
does the away slot or removal but not the profile move or the done-traversal flag (limitation, §15).

### 4.7 Other strategic events (`15` §2.7)

| Id | Event | Handler |
|---|---|---|
| 4 | `CHECKFORQUESTS` | §2.3 |
| 27 | `SET_BY_NPC_SYSTEM` | §3.13 |
| 28 | `SECOND_AIRPORT_ATTENDANT_ARRIVED` | `SAL.sector` = the primary delivery sector (`SEH:435-442`) |
| 29, 30 | `HELICOPTER_HOVER_TOO_LONG`, `…_WAY_TOO_LONG` | §10.4 |
| 34 | `DAILY_EARLY_MORNING_EVENTS` | §4.3 |
| 36 | `PROCESS_TACTICAL_SCHEDULE` | §5.3 |
| 41 | `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` | rebels still neutral → `ReduceLoyaltyForRebelsBetrayed`; group → `WILL_BECOME_HOSTILE` (`SEH:867-876`) |
| 63 | `KEITH_GOING_OUT_OF_BUSINESS` | hillbillies alive → `KEITH_OUT_OF_BUSINESS` (`Strategic/Game_Event_Hook.cc:276-283`) |
| 67 | `REMOVE_ASSASSIN` | the assassin's sector → nowhere, profile life = max (`SEH:878-882`) |

### 4.8 Per-NPC counters

| NPC | `npcData` / `npcData2` / `balance` / `money` |
|---|---|
| FATHER, MICKY | drunkenness (≥ 5 drunk; Father reset to `Random(4)` at 04:00) |
| LARRY_NORMAL | Larry's drunkenness for both profiles (0–24) |
| CARMEN | terrorists left / heads held / — / reward cash |
| DEVIN | days until he moves |
| RAT | leave flag |
| MADAME | girls paid for / brothel entries (dead code) — both zeroed when the Maria quest ends |
| DARYL | the profile of the merc who agreed to marry |
| ELLIOT | portrait index (`26`) |
| HERVE, PETER, ALBERTO, CARLO | bartender order 1–4 |
| DARREN | bet (`balance`), cash 15000 daily |
| KINGPIN, WALTER, GERARD, JOE | money owed or paid (`balance`) |
| VINCE, STEVE | debts (`balance`), cash emptied daily (with JENNY) |
| SKYRIDER, RPCs | money owed to them (`balance < 0`) |

---

## 5. Schedules (`SCH`, `Scheduling.h`)

### 5.1 Data

A map stores up to 255 schedules (36 bytes each: 4 skipped, `usTime[4]` (minutes of day, `0xFFFF` = unused), `usData1[4]`,
`usData2[4]`, `ubAction[4]`, id and soldier (overwritten), `usFlags`; `SCH:362-397`; read by `src/content/formats/map.ts`).
Loading assigns ids 1..n in file order; a detailed placement's `ubScheduleID` links it, and the created soldier copies it
(`Tactical/Soldier_Create.cc:496, 827`). Removing a soldier deletes its schedule and its pending event (`:980`); trashing the
world deletes all schedules and every `PROCESS_TACTICAL_SCHEDULE` event (`TileEngine/WorldDef.cc:2541`, `SCH:84-100`).
Schedules therefore exist only for the loaded sector. After loading n map schedules the counter `gubScheduleID` stands at
n + 1, so the first default schedule gets id n + 2 (a map without a schedule section starts at 0, its first default gets 1);
after a save it is the number of saved schedules + 1. A few original maps carry placements whose schedule id has no schedule
(that civilian gets no schedule and no default one either) or two placements naming one schedule (both soldiers point at it,
the last poster owns it).

| Action | Data | Meaning |
|---|---|---|
| 1 `LOCKDOOR`, 2 `UNLOCKDOOR`, 3 `OPENDOOR`, 4 `CLOSEDOOR` | data1 = a door at or next to it; data2 = where to go afterwards (a map-edge gridno makes him leave the map) | §5.3 |
| 5 `GRIDNO` | data1 | walk there, patrol from there |
| 6 `LEAVESECTOR` | — | walk to the nearest edge point and leave (away slot; walked in tactical, he gets stuck past the edge, §5.3) |
| 7 `ENTERSECTOR` | data1 | come back from the away slot and walk to data1 |
| 8 `STAYINSECTOR` | — | no runtime handler: its only effect is that the civilian gets no default schedule (`09` §5) |
| 9 `SLEEP` | data1 = bed | walk there and sleep (`AI_ASLEEP`) |
| 10 `WAKE` | — | walk back to the initial gridno |

Flags at run time: `ACTIVE1..4` (`0x10 << i`, the entry being executed), `TEMPORARY 0x100` (default schedules, never saved);
the variance and sleep-conversion flags are editor-only.

### 5.2 Posting (`PostSchedules`, `SCH:916-950`; `PostSchedule`, `:688-800`; `PostDefaultSchedule`, `:868-912`)

`PostSchedules` runs at the end of every fresh sector load (§4.6) and after loading a save (`SaveLoadGame.cc:1038`). Default
schedules are possible only if the map has at least one of the four entry points (`sNorthGridNo` …). For every init-list
node in list order whose soldier is a civilian: a placement schedule id → `PostSchedule`; else, if defaults are possible and
the body is not `COW`, `BLOODCAT`, `HUMVEE`, `ELDORADO`, `ICECREAMTRUCK` or `JEEP` → `PostDefaultSchedule` (profiled NPCs
included: maps give them `STAYINSECTOR` schedules to keep them home).

`PostDefaultSchedule` (not underground): a new `TEMPORARY` schedule at the head of the list (next id): entry 0 `ENTERSECTOR`
at `420 + Random(61)` to the initial gridno, entry 1 `LEAVESECTOR` at `1080 + Random(121)` (07:00–08:00 in, 18:00–20:00 out,
two `main` draws per civilian), then `PostSchedule`.

`PostSchedule(s)`:
1. Kingpin-group civilians without a profile in C5 get no schedule while the group's hostility is non-zero (any level, where
   the placement override of §4.6 needs exactly `WILL_BECOME_HOSTILE`) or quest 4 runs with `KINGPIN_CAN_SEND_ASSASSINS`
   (`SCH:697-701`); no schedule or `PERMANENT_INSERTION_CODE` → return.
2. For every `SLEEP` entry up to the first one without a time: `SecureSleepSpot` (every later civilian, in id order, active, in
   the sector and scheduled, whose first sleep spot equals this one gets the nearest other tile with room for a standing
   soldier from `FindGridNoFromSweetSpotExcludingSweetSpot(…, 3)`, `:1137-1165`); if its time is unset: time =
   `1260 + Random(180)` (21:00–23:59); unless an entry other than sleep starts before noon, add a `WAKE` 8 h later in the first
   empty entry and swap it into the sleep entry's slot (so the wake-up comes first).
3. `pSchedule.soldier = s`; auto-process the past 24 hours: start = `(now − 1439) mod 1440`, end = `now mod 1440`
   (`PrepareScheduleForAutoProcessing`, §5.4).

### 5.3 Processing in tactical

The event `PROCESS_TACTICAL_SCHEDULE(id)` (`ProcessTacticalSchedule`, `SCH:164-240`): unknown id or no soldier → log;
soldier below OKLIFE → nothing. On the map screen (ja2-node: `flow !== 'tactical'`) → auto-process from the last event
query minute (`guiTimeOfLastEventQuery / 60 mod 1440`, the start of the current clock advance; ja2-node
`lastEventQuerySeconds` in `world-clock.ts`) to now. In tactical: the entry whose time equals the current minute of day
becomes active (`ACTIVE` bit), `AI_CHECK_SCHEDULE` is set and `bAIScheduleProgress = 0`; no matching entry (a warp) →
auto-process.

`DecideActionSchedule` (`DA:58-516`, the hook of `09` §2.3; reached from the green decision for civilians in real time):

| Action | Steps (`bAIScheduleProgress`) |
|---|---|
| lock door | 0: walk to data1 (`SCHEDULE_MOVE`, absolute destination); 1: the door at or next to data1 (none or `DOOR_BUSY` → wait); no structure → skip; open → `AI_LOCK_DOOR_INCLUDES_CLOSE`; closed and unlocked → **lock it now** (`fLocked = TRUE`) and return `LOCK_DOOR`; already locked or no lock entry → skip; 2: at data2 or off the map → done (patrol point = here); else walk to data2 (an edge gridno sets the traversal action id) |
| unlock / open / close | as lock: unlock sets `fLocked = FALSE` immediately if closed and locked; open and close skip a door already in that state; returns `UNLOCK_DOOR` or `OPEN_OR_CLOSE_DOOR` |
| gridno | at data1 → done; else walk |
| leave sector | 0: walk to the nearest edge point (none → done); 1: walk onto the map edge, traversal action id (the absolute destination is the edge tile; `ExecuteAction` stores `sOffWorldGridNo` and extends the path two tiles past it, `AdjustSoldierPathToGoOffEdge`); 2: done (not reached when walking, see below) |
| enter sector | profile flagged — tested in **`ubMiscFlags`** with the `DONT_ADD_TO_SECTOR` value `0x01`, i.e. `RECRUITED` (bug, kept) → done; 0: place at `sOffWorldGridNo`, back into the merc slots, walk to data1; 1: arrived → done |
| wake | walk to the initial gridno; done there |
| sleep | walk to data1; there → `AI_ASLEEP`, done |

Every decision first clears `AI_ASLEEP`. "Done" (`DoneScheduleAction`, `DA:50-56`) clears `AI_CHECK_SCHEDULE`, resets the
progress and posts the next entry (`PostNextSchedule`, `SCH:986-1020`: the nearest future time, wrapping through midnight,
skipping the current minute). The AI executes `SCHEDULE_MOVE` like `WALK` and the door actions through
`InteractWithOpenableStruct` (`TacticalAI/AIMain.cc:1406-1434, 1746-1777`). Away soldiers (off the map) are visited by the AI
only when `AI_CHECK_SCHEDULE` is set and not in combat (`OH:1057-1069`). ja2-node's away civilians leave the world and keep
only their gridno (deviation "Away civilians").

`PostNextSchedule` adds the next entry's time to the start of **today** (`GetWorldDayInMinutes() + usTime`), so when the next
entry wraps through midnight (a default civilian who left at 19:00, next entry 07:30) the event lies in the past. It fires at
the next clock step without moving the clock (past events never do, `Game_Events.cc:73-79`), finds no entry for the current
minute and an empty auto-processing window (the last event query is the current minute) and posts nothing: that civilian's
schedule stops until the sector is loaded again or a save is loaded (one put to bed in tactical at 22:00 sleeps past his
06:00 wake-up; kept, oracle-checked through the event list).

A walked departure never finishes (kept, both V and Strac): the path end applies its "close enough" rule (fewer than 4 tiles
from the absolute destination counts as arrived) only off schedule (`!ACTING_ON_SCHEDULE`, `AIMain.cc:416`), and the off-edge
extension ends two tiles past the edge tile, so neither `HandleAITacticalTraversal` nor the decision of step 2 runs.
`RTHandleAI` re-issues `SCHEDULE_MOVE` to the absolute destination (`Realtime.cc:189-199`), the path from a non-visible tile
fails (`PathAI.cc:598-603`), the mover waits `REALTIME_AI_DELAY` (one `Random(1000)`) and tries again, for as long as the
sector stays loaded: invisible, in the sector (`bInSector`, merc slots, counted in `bMenInSector`), not in an away slot,
schedule still active, no next event, new situations ignored while traversing off map. The next load replays the day and
puts him into an away slot (§5.4, inferred). The same holds for a door entry whose data2 is an edge gridno. The away slot of
`HandleAITacticalTraversal` is reached only when the extension stops at the world's bounds (`OutOfBounds`). The unmatched
branch sets `AI_HANDLE_EVERY_FRAME` in `uiStatusFlags` (`:448`), where the bit is `SOLDIER_ATTACK_NOTICED` (kept).

### 5.4 Auto-processing (`PrepareScheduleForAutoProcessing`, `SCH:802-863`; `AutoProcessSchedule`, `:571-686`)

Skipped entirely while loading a save (`:575-582`). With start > end (the 24-hour window always is, unless now is 23:59):
apply every used entry with time ≥ start, then every entry ≤ end, posting the first later entry as the next event; otherwise
apply the entries in [start, end] and post the first later one; if nothing was posted, post entry 0 tomorrow (if it has a
time). Applying an entry teleports the soldier (`EVENT_SetSoldierPositionNoCenter`: to the cell's corner, not its centre,
after `BumpAnyExistingMerc` moves an occupant, away civilians parked on the tile included, to the nearest reachable spot
within 5 where a standing soldier fits, closest to his old tile, `:532-565`) and clears `AI_ASLEEP`:

| Action | Applied as |
|---|---|
| door actions | the door at/next to data1: lock (+ close), unlock, open, close (`ModifyDoorStatus`, `:953-984`); then teleport to data2; an edge gridno → he goes off map (`sOffWorldGridNo = data2`, away slot, `bInSector = FALSE`), else patrol point data2 |
| gridno | teleport to data1, patrol point |
| enter sector | not for a profile with `DONT_ADD_TO_SECTOR` (here tested correctly in flags 2); teleport to data1, back from the away slot, in sector, patrol point |
| wake | teleport to the initial gridno |
| sleep | `AI_ASLEEP`, teleport to data1 |
| leave sector | teleport to the nearest edge point (or stay), `sOffWorldGridNo` = it, away slot, out of sector |

The AI's "enter sector" places the civilian at the cell's centre of `sOffWorldGridNo`, which is 0 for a civilian who never
left (kept). `ModifyDoorStatus` (`Tactical/Keys.cc:843-905`) only writes the door status flags; the door structure follows at
the next `UpdateDoorGraphicsFromStatus`, which `SetCurrentWorldSector` runs right after `EnterSector` (so a load replays doors
in full) and a save load runs. Auto-processing on the map screen of a loaded sector therefore leaves the structure until the
next load; ja2-node swaps it at once (deviation "Schedule door changes"). `FindNearestEdgePoint`
(`TacticalAI/FindLocations.cc:1771-1797`) tries the four primary edgepoint lists ordered by the screen distance of the tile to
each edge (west, east, north, south on ties) and takes the nearest point of the first non-empty list.

**When the sector is not loaded nothing happens**: no schedule exists. On the next load `PostSchedules` replays the whole
past day instantly, so each civilian ends in the state of his latest entry (asleep in bed at night, absent after a
`LEAVESECTOR`, doors locked at night). **With compressed time** on the map screen the events fire with the clock at their
stamp (`15` §2.8) and auto-process the window since the last event query: the same end state, teleported, never walked. In
tactical real time and turn-based combat the AI walks (combat suppresses the green decisions, `13`); a walked departure stays
past the map edge until the next load (§5.3).

### 5.5 Shop hours (`ExtractScheduleDoorLockAndUnlockInfo`, `SCH:1022-1061`)

A dealer's opening time is the time of his schedule's `UNLOCKDOOR` entry and the closing time that of the `LOCKDOOR` entry;
both must exist (else "no hours": the original treats it as an error for scheduled people). This feeds `MerchantHooks.shopHours`
(`23` §10.4) when the dealer's soldier is in the loaded sector (inferred: the repair delay reads the soldier's schedule, so
hours are known only while his sector is loaded); ja2-node's `CampaignSim` hook returns `null` otherwise.

### 5.6 Saves

A save stores the non-temporary schedules (max 32, with ids and soldier links, `SCH:452-484`) and the pending events; loading
restores them and then runs `PostSchedules` again with auto-processing disabled (`SaveLoadGame.cc:948-949, 1038`): every
scheduled civilian gets a **second** pending event for its next entry, and civilians whose default schedule was not saved
draw a new default schedule (`Random(61)`, `Random(121)`). Both are kept for native-save import (the second event re-arms
the same entry, inferred harmless); saves written after several loads carry two to four events per schedule, and the saved
events of the dropped default schedules then point at the redrawn ones with the same ids (oracle-checked). Off-map
civilians (`SOLDIER_OFF_MAP`) return to the away slots. ja2-node's own saves restore schedules, temporary ones and events
exactly and do not re-post (`SectorFlow.reattachLoadedSector`); native import re-posts as the original
(`SectorFlow.adoptLoadedSector`, deviation "Savegame import").

---

## 6. Civilian groups and hostility

Quests hang on the civilian groups (rebels, Kingpin's men, the hicks, the doctors, the Queen's people). This doc owns the
group state and the quest rules; `24` owns the "declare hostility" quote list that turns a flagged civilian hostile after
his quote (`AddToShouldBecomeHostileOrSayQuoteList`, `OL:508-610`).

### 6.1 State

`civGroupHostile[20]` (`fCivGroupHostile`, tactical status, saved; groups `Tactical/Overhead_Types.h:269-290`: `REBEL 1`,
`KINGPIN 2`, `SANMONA_ARMS 3`, `ANGELS 4`, `BEGGARS 5`, `TOURISTS 6`, `ALMA_MILITARY 7`, `DOCTORS 8`, `COUPLE1 9`, `HICKS 10`,
`WARDEN 11`, `JUNKYARD 12`, `FACTORY_KIDS 13`, `QUEENS 14`) with `NEUTRAL 0`, `WILL_EVENTUALLY_BECOME_HOSTILE 1`,
`WILL_BECOME_HOSTILE 2`, `HOSTILE 3` (`:293-296`). A created civilian is neutral unless it is the Warden or its group is
`HOSTILE` (`Tactical/Soldier_Create.cc:221-226`). The AI's civilian tests (`AIList.cc:143`, `DecideAction.cc:1466`) read it.
ja2-node keeps it in `StrategicState.civGroups`, shared with the loaded sector as `TacticalState.civGroups`; civilian group
ids are `CivilianGroup` in `src/sim/tactical/soldier.ts`.

### 6.2 Transitions

| Trigger | Effect | Lines |
|---|---|---|
| `CivilianGroupMemberChangesSides(attacked)` (attack, actions 22 and 25, a hick cow attacked) | group members on our team (recruited rebels) go back to the civilian team (first profile picked with `Random(2)` per later candidate); then `CivilianGroupMembersChangeSidesWithinProximity`: every neutral, living, non-cow member that sees the attacker or stands within sight range of the attacked or the attacker → `MakeCivHostile`, the hostile-quote list if it has opponents (a `Random(2)` per later profiled candidate); if the group was `NEUTRAL`: rebels → `ReduceLoyaltyForRebelsBetrayed`; event `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` at now + 300; group = 1 | `OH:2672-2772` |
| that event | rebels still neutral → loyalty hit (never, they are 1 by then); group = 2 | `SEH:867-876` |
| a neutral member sees an OUR merc while the group is ≥ 2 | hostile-quote list | `OL:1549-1556, 1673-1677` |
| the hostile-quote list resolves | every listed neutral → `MakeCivHostile`; a listed member's group at 2 → 3; combat for the civilian team | `OL:566-592` |
| `CivilianGroupChangesSides(group)` (a group's building blown up) | group = 3; every neutral living non-cow member → `MakeCivHostile` (+ quote list); in ja2-node nothing calls it (deviation "Building owners") | `OH:2774-2800` |
| Kingpin alarm (action item) | Kingpin group = 3, members seeing an OUR merc hostile, combat | `TileEngine/Explosion_Control.cc:1788-1816` |
| Kingpin's threat (§3.13) | Kingpin group = 2 | `SEH:601` |

`MakeCivHostile(s)` (`OH:2586-2670`): cows never. New side: IRA, DIMITRI, MIGUEL, CARLOS, MADLAB, DYNAMO, SHANK and the rebel
group → `HOSTILE` (against player and army); MARIA and ANGEL while the Maria quest is in progress or done → `HOSTILE`; anyone
else → `ENEMY` (with the army). Not neutral and already on that side → return. CONRAD and GENERAL get the new side and change
to the enemy team. Stracciatella assigns the new side only to Conrad and the General; everyone else just stops being neutral
and keeps his side (vanilla `Overhead.c:3075-3077` also set `bSide`). So rebels stay allied with the army and
`MilitiaChangesSides` leaves friendly militia friendly (they are not neutral, so nothing changes); oracle-confirmed, kept.
Kingpin group: Maria quest in progress, not boxing, Maria in sector → `MARIA_ESCAPE_NOTICED`. BILLY → `FARPATROL`. Neutral →
non-neutral, opponent counts; in combat → added to the battle. The team changes follow the original (deviation "Team
changes" for the one unhandled case).

### 6.3 `ProcessImplicationsOfPCAttack` (`OH:5342-5470`), the quest parts

In order: wake a sleeping target; Pablo attacked after the missing items were found → `PABLO_PUNISHED_BY_PLAYER`; boxing
rules (§7.3); friendly militia attacked → `MilitiaChangesSides`; else a neutral civilian Slay ≥ OKLIFE while !`FACT_155` →
SLAY record 1; else a neutral civilian without group and not a vehicle: a cow in F10 → `HickCowAttacked` (the first neutral
hick that sees the attacker changes sides, `OH:2812-2827`); Pablo ≥ OKLIFE, punished, !`FACT_38` → PABLO record 3; else the
hostile-quote list and, unless the profile has `TOWN_DOESNT_CARE_ABOUT_DEATH`, militia change sides; else: Carmen attacked by
anyone but Slay → `AGGRESSIVE`; a group member on our team or neutral → `CivilianGroupMemberChangesSides` (+ quote if
profiled, ≥ OKLIFE and visible); a non-neutral group member that is not a boxer → proximity rule; our own merc out of combat →
no combat. ja2-node runs all of these but the head-miner rule and our mercs' firing back (deviation "Implications of an
attack").

### 6.4 Owned items and nuisance

Picking up an item from a pool that holds an `OWNERSHIP` marker angers the owner profile, or every member of the owning group
(hicks excepted after the marriage), who can see the thief: `MakeNPCGrumpyForMinorOffense` (`Tactical/Handle_Items.cc:3224-3305`):
the dealers and a few others listed there get `NPC_PISSED_OFF` and an "I hate you" trigger, the rest go on the hostile-quote
list, and they turn to face the thief. The hospital supplies (§11.3) are such pools. Not ported: picking up an owned item
angers nobody in ja2-node (limitation, §15).

---
## 7. Boxing (`BOX`, `Boxing.h`)

### 7.1 Data

Ring in D5 (`BOXING_SECTOR` 5/4/0), room 29, surrounding room 3, boxer start gridnos 11393, 11233, 11073 (`gsBoxerGridNo`),
AI start 11235, ring centre 11237 (`DA:47`). State `bBoxingState`: `NOT_BOXING 0`, `BOXING_WAITING_FOR_PLAYER 1`,
`PRE_BOXING 2`, `BOXING 3`, `DISQUALIFIED 4`, `WON_ROUND 5`, `LOST_ROUND 6` (`Tactical/Overhead_Types.h:300-309`). Saved:
`gBoxer[3]` (soldier ids), `gfBoxerFought[3]`, `gfLastBoxingMatchWonByPlayer`, `gubBoxingMatchesWon`, `gubBoxersRests`,
`gfBoxersResting`. `SOLDIER_BOXER` is a soldier status flag. ja2-node keeps the saved globals, the state and the boxer ids in
one record shared by the strategic narrative and the loaded sector (`StrategicState.narrative.boxing` =
`TacticalState.boxing`, with `state`, `boxers` and the unsaved `uiLocked`); native saves import `bBoxingState`, `gBoxer` and
`SOLDIER_BOXER`.

### 7.2 A match

1. Entering D5 clears `gBoxer` (`SM:782-787`). `CheckOnBoxers` (`BOX:252-268`) fills empty slots with the soldiers standing on
   the boxer gridnos that carry no weapon (re-picked only while slot 0 is empty).
2. Darren's records (bets, §3.11; the `DARREN_REQUESTOR`/`FIGHT_AGAIN_REQUESTOR` prompts) lead to `START_BOXING_MATCH` (138):
   if a boxer exists → state 1 (`SetBoxingState`: leaving 0 pauses the game, returning to 0 unpauses, `BOX:398-424`).
3. Every step of a soldier in states 1–3 runs `BoxingMovementCheck` (`OH:736-742, 974-980`, `Tactical/Soldier_Ani.cc:526-529`,
   `BOX:381-396`; the check runs twice per tile, after `HandleAtNewGridNo` and again after `HandleGotoNewGridNo`, which is
   harmless): a soldier in the ring → count people (`BOX:166-249`, in merc-slot order): two or more player soldiers in the ring
   → `BoxingPlayerDisqualified` on the first of them without the boxer flag (stopped, state 4, Darren record 21), and when the
   state was ≤ 2 the state then drops to 0; state 1 with exactly one person (ours) → state 2 and `PickABoxer` (`BOX:273-305`:
   the first slot not yet fought, active, in sector, ≥ OKLIFE: `SOLDIER_BOXER`, non-neutral, AI reset, fought; stats
   strength/dexterity/agility/life max `+ 5 × gubBoxersRests` capped at 100; the third boxer gets martial arts if `REGMALE`;
   already-fought boxers lose the flag); state 2 with two people of which one is ours → both get `SOLDIER_BOXER`, state 3,
   last-won false, `EnterCombatMode(team of pInRing[Random(2)])`. A boxer stepping out of the ring during state 3 →
   disqualified, history `DISQUALIFIED_BOXING`, loses the flag.
4. During `PRE_BOXING`/`BOXING` action points are halved (`CalcActionPoints` last step, `Tactical/Soldier_Control.cc:411-415`)
   and the carried maximum is halved (`:422-429`); no interrupts while any boxing state is set (`Tactical/TeamTurns.cc:954-958`)
   and no sighting enters the best-sighting list (`OL:1844-1848`), so a hostile boxer never starts combat by being seen;
   `CheckForEndOfCombatMode` and `CheckForEndOfBattle` never end combat in state 3 (`OH:4247-4251, 4395-4400`); a battle won in
   another boxing state skips the incapacitated-enemy kill, the militia and civilian reset, the sector control and the battle
   bookkeeping (`OH:4509-4694`); `BeginTeamTurn` stops after the team's `EVENT_BeginMercTurn` when a knock-out there decided
   the round (states 4–6, `Tactical/TeamTurns.cc:333-337`). Non-boxers do nothing in states 2, 3, 5 and 6
   (`TacticalAI/AIMain.cc:186-195`), are not in the AI lists (`TacticalAI/AIList.cc:119`) and are no threat
   (`TacticalAI/AIUtils.cc:1842-1846`); `DecideAlertStatus` skips its new-situation and changing-orders handling while any
   boxing state is set (`DA:3821`); a hostile boxer ending his turn does not turn his civilian group
   (`TacticalAI/AIMain.cc:538-543`); in green, everybody else within 26 tiles of the ring centre only turns to face it while a
   boxing state is set (`DA:709-722`). The AI boxer walks into the ring in `PRE_BOXING` (`DA:518-550`,
   `FindClosestBoxingRingSpot`, `TacticalAI/FindLocations.cc:1885-1931`), then punches (`DA:2538-2556, 2666-2670`, closing in
   with `CLOSEPATROL` orders for one decision, `DA:3381-3392`). `ReevaluateEnemyStance` at the end of `ManSeesMan` and in
   `NoticeUnseenAttacker` turns an idle enemy to a newly seen merc for one turn AP each time in combat, which is what costs an
   AI boxer 3 AP when his turn starts next to three mercs. A PC under AI control is handled by the AI while he carries a quote
   record or the boxer flag (`TacticalAI/AIMain.cc:103-114`) and takes an AI slot (`OH:404-406`).
5. The end: a boxer collapsed for more than one turn (`Tactical/Soldier_Control.cc:5322-5331`) or reduced to life 0
   (`OH:5642-5649`) → `EndBoxingMatch(loser)` (`BOX:89-101`): ours → state 6; else state 5, last-won true,
   `gubBoxingMatchesWon += 1`; → DARREN 22 (his records run `HANDLE_END_OF_FIGHT` → `ExitBoxing`, `BOX:35-84`: AI boxers in
   the ring neutral again, our boxers under AI control; each is calmed, `bUnderFire = 0`, and a boxer below OKLIFE or OKBREATH
   is raised to `max(2·OKLIFE, life)` and given breath back, then stands up; `DeleteTalkingMenu`; end all AI turns;
   `CheckForEndOfCombatMode(FALSE)` and, when it ended combat, the UI lock until our boxer is out; the original never lifts it
   when our boxer died in the ring, ja2-node lifts it once no living boxer is left, deviation "Boxing UI lock"). The green AI
   walks boxers back to their start gridno or out of the ring (`DA:657-706`; our boxer never to the left of the ring); when our
   boxer is out: `TriggerEndOfBoxingRecord` (`BOX:119-147`): UI unlocked, history `WON/LOST/DISQUALIFIED_BOXING` with his
   profile, DARREN 23 or 24, state 0; an AI boxer out of the ring with nobody left in it while disqualified calls it without a
   soldier. On returning to 0 with all three boxers unfought, slot 0 is marked fought (so another fight can be offered).
   Going to the map screen while a boxing state is set asks to abandon the fight (yes → state 0,
   `Tactical/Interface_Panels.cc:3748-3768`; deviation "Abandoning a fight").
6. Daily (15:00, §4.4) the fought flags reset and the boxers rest after every third win.

### 7.3 Cheating (`OH:5359-5382`)

In state 3, an attacker that is not a boxer, or uses an item other than `NOTHING` or `BRASS_KNUCKLES`: a blade or
punch-class item against a boxer → `BoxingPlayerDisqualified(BAD_ATTACK)` (state 4, Darren record 21); anything else →
state 0 ("open war"), and an attacked civilian boxer is made neutral so the group rules apply. **Brass knuckles used by a
boxer are allowed** (the comment says they disqualify; the condition excludes them: kept).

### 7.4 Facts and records

`ANOTHER_FIGHT_POSSIBLE` (`AnotherFightPossible`, `BOX:325-347`: neither all three nor none of the boxers available, and an
OUR merc in sector with `life > OKLIFE + 5`, not collapsed), `PLAYER_FOUGHT_THREE_TIMES_TODAY` (no boxer available),
`PLAYER_KILLED_BOXERS` (`BoxerExists`: nobody on the three gridnos), `NO_CLUB_FIGHTING_ALLOWED`, `CLUB_OPEN`, Kingpin
"impressed" (250). An arriving enemy group never starts a battle in D5 while boxing (`Strategic/Strategic_Movement.cc:1113-1124`).
`BoxerAvailable` (fact 231) runs `CheckOnBoxers` and may fill `gBoxer` from whatever stands on the three gridnos of the loaded
map; the ids stay valid across sector loads until D5 is entered again (stale ids from another sector still count as boxers).
A Kingpin civilian hurt while the Maria quest is in progress and Maria is in sector sets `MARIA_ESCAPE_NOTICED`, but not while
boxing (`Tactical/Soldier_Control.cc:5462-5470`), and `MakeCivHostile`'s Maria rule has the same gate (`OH:2646-2655`).

---

## 8. Keys, locks and door actions

### 8.1 Data

- **Lock table** `LockTable[64]` from `BINARYDATA/Locks.bin` (original data, read at run time, `KEYS:97-117`; ja2-node
  `src/content/formats/locks.ts`, the stub pack compiles `stubs/locks.json`): per lock the key item, type (`REGULAR 1`,
  `PADLOCK 2`, `CARD 3`, `ELECTRONIC 4`, `SPECIAL 5`), pick difficulty, smash difficulty (`OPENING_NOT_POSSIBLE = 254` for
  either), `LOCK_UNOPENABLE = 255` as a lock id (`Keys.h:12-50`).
- **Doors** (`DOOR`, `Keys.h:62-80`): `fLocked`, `ubTrapLevel` 0–10, `ubTrapID` (`EXPLOSION 1`, `ELECTRIC 2`, `SIREN 3`,
  `SILENT_ALARM 4`, `BROTHEL_SIREN 5`, `SUPER_ELECTRIC 6`), `ubLockID`, `bPerceivedLocked` (`UNKNOWN 0`, `LOCKED 1`,
  `UNLOCKED 2`, `BROKEN 3`), `bPerceivedTrapped` (`UNKNOWN 0`, `PROVED_TRAPPED 1`, `PERCEIVED_UNTRAPPED 2`, `PROVED_UNTRAPPED 3`),
  `bLockDamage`. Perceived values are reset on map load (`KEYS:686-707`). Trap flags (`DoorTrapTable`, `KEYS:73-82`):
  explosion stops the action; electric and super electric stop and recur; sirens recur; the silent alarm recurs silently. Door
  tables persist per sector in the temp files (`d_`, `16` §5.11). Shooting a lock damages it (`LOS.cc:2292-2324`).
- **Keys**: key items (class `IC_KEY`) carry `ubKeyID` = the lock id they open; the soldier's key ring holds up to 64
  `{key id, count}`; `KeyTable[64]` remembers where and when each key was found (`usSectorFound`, `usDateFound`, saved).
  `SoldierHasKey(s, id)` = ring or inventory, `ANYKEY 252` matches any (`KEYS:120-152`). Dropping a merc's gear, and his corpse,
  drops his key ring (`DropKeysInKeyRing`, `KEYS:1266-1300`).

### 8.2 Opening a closed door (`InteractWithOpenableStruct`, `HD:196-262`)

A door with `DOOR_BUSY` stops the merc (ja2-node has no busy window, deviation "Doors"). An open door just closes (ja2-node
first gives our mercs vanilla's closing menu, deviation "Closing an open door"). A closed door that is in the door table and
**locked** opens the door menu for our mercs (`HD:233-251`), after `DoTrapCheckOnStartingMenu` (`HD:175-194`: a locked,
trapped door whose trap is unknown is noticed when `CalcTrapDetectLevel(s, FALSE) ≥ trapLevel` → quote, perceived trapped, no
menu). Unlocked or lockless doors open directly. Non-player soldiers always open.

The menu (`Tactical/Interface.cc:1386-1435`): open (normal cost by approach direction, `doorAPs`), use keys (needs any key; not
for EPCs), crowbar (a usable `CROWBAR`), lock pick (a `LOCKSMITHKIT`; not EPCs), explode (a `SHAPED_CHARGE`; not EPCs), examine
(not EPCs; also disabled once proved trapped or proved untrapped), force (not EPCs), untrap (disabled once proved
untrapped), cancel; every option except open/cancel is disabled when facing diagonally, and any option without enough AP is
disabled. The untrap button's `disable = PROVED_UNTRAPPED` *replaces* the EPC flag, so escorts may untrap
(`Interface.cc:1365`); the crowbar has no EPC check; there is no lock button, so `HANDLE_DOOR_LOCK` is unreachable in the
original (ja2-node's `door` command returns the menu as data and offers `lock`, deviation "Door menu"). Choosing pays nothing
yet; the animation (`OPEN_DOOR`, `KICK_DOOR`, `PICK_LOCK`, `HD:142-173`) reaches `HandleOpenableStruct`, which charges at the
end (`DeductPoints`, `HD:806-810`).

### 8.3 `HandleOpenableStruct` for our mercs (`HD:309-812`)

Unless examining, untrapping or unlocking: a locked, trapped door → AP/BP of opening; if `HasDoorTrapGoneOff`
(`CalcTrapDetectLevel(s, FALSE) < trapLevel`, `KEYS:496-513`) → `HandleDoorTrap`, stop if the trap stops actions, one-shot
traps are removed, perceived values updated; else (noticed): unknown trap → message, quote, stop this time; known trap → it
fires anyway (same rules). The AP of that check is `doorAPs[ubDoorHandleCode]`, and for menu actions the code (4–11) reads
past the four-entry table (undefined; ja2-node charges `AP_OPEN_DOOR`, deviation "Trap check cost of menu actions"). Opening
a door that has a door-table entry costs nothing unless that trap check ran: `sAPCost` is set only for doors without an
entry. Then by action:

| Action | AP / BP | Rule |
|---|---|---|
| open | `doorAPs[code]` / `BP_OPEN_DOOR` | no lock entry → opens; locked → "locked" (battle sound or message for EPCs); unlocked → opens; perceived updated |
| force (kick) | `AP_BOOT_DOOR`, `BP_BOOT_DOOR` | no entry → opens; `AttemptToSmashDoor` (`KEYS:300-372`): noise `SMASHING_DOOR_VOLUME`; unlocked → success (entry removed); `LOCK_UNOPENABLE` → fail; smash difficulty 254 → fail (−100 check); else `SkillCheck(SMASH_DOOR_CHECK, (INT8)−(INT8)(smash − lockDamage))` (both casts wrap: a difficulty above 127 turns into a bonus): > 0 → strength +20, entry removed (never lockable again), opens; in (−10, 0] → strength +5, `lockDamage += 10 + result` (INT8, wraps); in (−40, −10] and not from the same tile as last time → strength +1 (**unreachable**: every failed `SkillCheck` sets `sSkillCheckGridNo` to the current tile) |
| crowbar | `AP_USE_CROWBAR`, `BP_USE_CROWBAR` | as force with `OPEN_WITH_CROWBAR`, `CROWBAR_DOOR_VOLUME`, plus the crowbar loses `PreRandom(min(effective strength, smash + 30) / 20)` status first (`KEYS:213-298`) |
| explode | `AP_EXPLODE_DOOR`, `BP_EXPLODE_DOOR` | needs a shaped charge; `SkillCheck(PLANTING_BOMB_CHECK, 0) ≥ −20` → the charge is used, the lock takes `2 × SHAPED_CHARGE blast damage` (`damageLock`: capped at 127, destroyed when above the smash difficulty → entry removed, opens); else the charge is used and explodes on the merc (`IgniteExplosionXY` at his x/y, z = the land height of his tile, level 0; `KEYS:593-683`) |
| lock pick | `AP_PICKLOCK`, `BP_PICKLOCK` | `AttemptToPickLock` (`KEYS:374-433`): unopenable → fail; card/electronic → `ELECTRONIC_LOCKPICKING_CHECK` else `LOCKPICKING_CHECK`; difficulty 254 → fail; `SkillCheck(−pick)` > 0 → mechanical `+pick/5`, dexterity `+pick/10`, unlocked, opens (with the Strac policy `diagonally_interactable_doors`, off by default, it stays closed while capable enemies are in sector); failures give nothing |
| examine | `AP_EXAMINE_DOOR`, `BP_EXAMINE_DOOR` | `ExamineDoorForTraps` (`KEYS:463-494`): no trap → perceived untrapped; trap known → found; `CalcTrapDetectLevel(s, TRUE) ≥ level` → proved trapped (quote, message), else perceived untrapped |
| unlock (keys) | `AP_UNLOCK_DOOR`, `BP_UNLOCK_DOOR` | no entry → just opens the animation; `AttemptToUnlockDoor`: has the key of `lockId` → unlocked, opens (policy as above); else "wrong key", a cosmetic `Random(2)` curse |
| untrap | `AP_UNTRAP_DOOR`, `BP_UNTRAP_DOOR` | trap present: `SkillCheck(EXPLOSION ? DISARM_TRAP_CHECK : DISARM_ELECTRONIC_TRAP_CHECK, −7·level)` > 0 → trap removed; else it fires (one-shot removed); no trap → message |
| lock | `AP_LOCK_DOOR`, `BP_LOCK_DOOR` | has the key → locked; else "not the proper key" |

`HandleDoorTrap` (`KEYS:527-591`): explosion → a hand-grenade explosion at the merc (`IgniteExplosion(NULL, 25, gridno,
HAND_GRENADE)`); siren → klaxon, then as silent alarm: `CallAvailableEnemiesTo(door)`; brothel siren → klaxon,
`CallAvailableKingpinMenTo(door)`, `MADAME.npcData = 0`; electric → the merc attacks himself: `SoldierTakeDamage(10 +
PreRandom(10), breath 3 + PreRandom(3)·1000, ELECTRICITY)` (the breath term is `3 + 1000·PreRandom(3)`, a precedence slip:
kept); super electric → `20 + PreRandom(20)`, `6 + PreRandom(6)·1000`. The breath argument is evaluated first (GCC, right to
left): `PreRandom(3)` before `PreRandom(10)`; oracle-confirmed. `UpdateDoorPerceivedValue` (`KEYS:772-804`) copies the real
lock state and sets the trap knowledge (untrap and examine prove, others prove unless the trap is none or silent).

**Quest effects of messing with doors** (`ProcessImplicationsOfPCMessingWithDoor`, `HD:265-307`, after force, crowbar,
explode and lock pick): in the brothel rooms 91–119 of C5, or in D5 at 11010, 11177, 11176, any Kingpin goon ≥ OKLIFE who sees
the merc turns hostile and starts combat; in Tixa (J9) the Warden within 5 and below red alert goes red and re-plans.

### 8.4 AI and NPC doors

The AI passes locked doors only with `bHasKeys`; schedules lock and unlock by setting `fLocked` directly (§5.3);
`NPCOpenThing` (§8.6) unlocks what it opens; Madame's actions unlock the girls' doors (§3.6).

### 8.5 Doors on entering a sector

`ExamineDoorsOnEnteringSector` (`KEYS:1242-1264`, after `EnterSector` unless loading a save, `SM:505-510`): outside Omerta,
if at least 30 minutes passed since the player was last in tactical and any non-player soldier is in the sector, every open
door status is closed (`HandleDoorChangeFromGridNo(…, TRUE)`, no animation). It never fires: `SetCurrentWorldSector`
sets `uiTimeSinceLastInTactical` to now just before the call (`SM:499` before `:509`), so ja2-node does not run it. `MercLooksForDoors`/`AllMercsLookForDoor` (`KEYS:934-1006`) update the perceived open state within sight (the
perceived/real split is deviation "Doors").

### 8.6 `NPCOpenThing` (`ID:4576-4662`)

Door: `FindClosestDoor`; otherwise gridno 6968 for ARMAND, else `FindNearestOpenableNonDoor`; none → false. Already open →
the NPC's `APPROACH_DONE_OPEN_STRUCTURE` record (`24`). Else: unlock its door entry; adjacent tile (`FindAdjacentGridEx`, none →
false); start the interaction there or walk there; `PENDING_ACTION`.

`FindClosestDoor` searches 5 tiles around the NPC and keeps the nearest door closer than 10 (`PythSpacesAway`);
`FindNearestOpenableNonDoor` searches 7 tiles by `CardinalSpacesAway`. The adjacent tile uses the `fDoor` variant of
`FindAdjacentGridEx` (ja2-node `findAdjacentGridExForDoor`: raw movement costs, the door's orientation drops sides, a switch
is reached through its wall, and standing on the door tile faces south or east). A walking NPC carries the interaction as a
pending `openStruct` door action that `InteractWithOpenableStruct` runs on arrival; the original's "dialogue queue empty"
check there is not modelled (deviation "NPC opens a door on arrival"). Action 40 picks up with `ITEM_IGNORE_Z_LEVEL` (every
item on the tile, whatever its height).

---

## 9. EPCs and the robot

### 9.1 Becoming an escort

Records lead to the escort requestor (110, §3.3). `RecruitEPC(p)` (`SP:770-813`): `EPCACTIVE`, clear
`PERMANENT_INSERTION_CODE`, the soldier changes to our team with kind `EPC`, joins the current squad (else any squad), dead-squad
list reset; the robot updates its controller. John and Mary need two free slots (`ID:4255-4265`).

`HandleStuffForNPCEscorted` (`ID:1493-1545`): SKYRIDER → `SKYRIDER_EVER_ESCORTED`, quest 17 if not started; JOHN →
`RecruitEPC(MARY)` and quest 19; MARY → `RecruitEPC(JOHN)` and quest 19 (MARIA, JOEY: nothing). The team change is `24` §9.6.

### 9.2 Ending an escort

- Action 149/168 (`ID:2586-2623`): ANGEL is retargeted to MARIA; `UnRecruitEPC(p)` (`SP:816-841`: only an EPC; clear
  `EPCACTIVE`; profile sector = soldier sector; `PERMANENT_INSERTION_CODE`, insertion `GRIDNO` at his gridno,
  `useProfileInsertion`; back to the civilian team); MARY ↔ JOHN un-recruit the partner; SKYRIDER from record 15 (next to the
  chopper) → `useProfileInsertion = FALSE` (he reappears at his map placement in the airport); JOEY from record 9 (next to
  Martha) → insertion data 18326 (a room in Cambria, he has no placement there); JOHN or MARY from record 13 (the airport) →
  both profiles' sectors → nowhere (they vanish when the sector unloads).
- The assignment menu's "remove escort" (`Strategic/Assignments.cc:4974-4977`) and the contract ending of an EPC
  (`Strategic/Merc_Contract.cc:572-575`, unreachable: escorts have no contract) call `UnEscortEPC` (`:6872-6898`): on the map
  screen → `InternalUnescortEPC` for him and his John/Mary partner (`:6837-6870`: `SetupProfileInsertionDataForSoldier`; the
  first record with approach `EPC_IN_WRONG_SECTOR` gives a quote (forced) and its fact (`NPC:2351-2366`, `24`); then, queued,
  `UnRecruitEPC`); in tactical → only that approach is triggered (the record decides). ja2-node's `unescort` command
  (deviation "Releasing an escort").

### 9.3 Campaign rules for escorts

| Rule | Lines |
|---|---|
| strategic move refused for an EPC whose squad (or vehicle) has no non-EPC (`move-permission.ts` `EPC_ALONE`) | `Strategic/Map_Screen_Interface.cc:3838-3849` |
| strategic move refused for Maria while in C5 | `:3851-3866` |
| tactical exit: lone EPC / abandoning EPCs (`exitSector`) | `16` |
| EPCs cannot use keys, lock picks, charges, examine or force (door menu, §8.2) | `Tactical/Interface.cc:1397-1426` |
| an EPC cannot control the robot | `Tactical/Soldier_Control.cc:8662-8663` |
| a captured EPC dies instead (`19`) | `Strategic/Queen_Command.cc:1185-1191` |
| EPC deaths do not count for the death rate (`22`) | `Strategic/Strategic_Merc_Handler.cc:78-82` |
| arrival triggers: Skyrider at the chopper, John and Mary at the airport, Maria at the leather shop, Joey near Martha (§10.2, §11.5, §11.10, §11.14) | `OH:1867-1927` |

### 9.4 The robot

Quest flow (records of MADLAB, `24`; actions §3.9): the AWOL scientist meanwhile (35 % progress) starts quest 11 and puts
MADLAB and ROBOT into Madlab's alternate-map sector (`26`); he asks for a firearm and a video camera (facts 197, 198);
`MADLAB_GIVEN_GUN`/`…_CAMERA` (191, 192); `READY_ROBOT` (194) → tomorrow 07:00 `ROBOT_READY` (or, after a first destroyed
robot, `ROBOT_READY_SECOND_TIME` with the robot's profile restored) and `ROBOT.sector = MADLAB.sector`;
`MADLAB_ATTACHES_GOOD_CAMERA` (193) → the robot gets Madlab's first gun and becomes an EPC. Its death sets 203, then 206
(`OH:2236-2247, 2320-2330`). `ROBOT_RECRUITED_AND_MOVED` at the next sector entry (§4.5).

The robot joins through `RecruitEPC`, so it is an escort (`MERC_TYPE__EPC`) and every `AM_AN_EPC` rule applies to it except
where `AM_A_ROBOT` is tested first (the strategic move: `ME_ROBOT_ALONE` replaces the escort check); an uncontrolled robot is
counted as an escort by the tactical exit check.

Control (`Tactical/Soldier_Control.cc:8648-8758`): `ControllingRobot(s)` = s active, not an EPC, ≥ OKLIFE, on our team, on a
squad or in a vehicle, wearing `ROBOT_REMOTE_CONTROL` as head gear, the robot on our team in the same sector, both in the
sector or both between sectors in the same squad or vehicle. The robot's `remoteHolder` is updated on recruit, when someone
puts the remote on (`Tactical/Items.cc:2072`: `PlaceObject` updates it whenever a remote control is placed into any slot of
one of our soldiers; the update only takes when he then wears it in a head slot), and around autoresolve and the PBI; it is
saved and re-checked by `CanRobotBeControlled`. Without a controller the robot cannot be ordered (`OH:3799-3806`,
`Tactical/Handle_UI.cc:1647, 4247`), is skipped as "next merc" (`Tactical/Handle_UI.cc:1640-1652`), may not move
strategically alone (`Strategic/Map_Screen_Interface.cc:3830-3836`, `ME_ROBOT_ALONE`) or traverse a map edge (`SM:2083-2090`).
Its interrupt points are the controller's experience − 2, and the controller loses 2 (`Tactical/TeamTurns.cc:1150-1170`).
Repair of the robot is an assignment (`18`).

---

## 10. Skyrider and the helicopter (`HELI`)

### 10.1 State

The general-info fields of §0 (ja2-node `HelicopterState`, `StrategicState.forces.helicopter`; the vehicle is in the vehicle
list). `InitializeHelicopter` (`HELI:137-176`) resets them at a new game (vehicle id −1, not set up, not airborne, not
returning, not hovering, cost 0, not destroyed, talk state 0, hits 0). Refuel sites (`HELI:80-84`): Drassen airport B13,
gridno 9001, structures from `FIRSTOSTRUCT1`; Estoni I6, gridno 13067, from `FOURTHOSTRUCT1`. `fRefuelingSiteAvailable[i]` =
the site sector is neither enemy controlled nor in enemy airspace, and for Estoni `ESTONI_REFUELLING_POSSIBLE`
(`UpdateRefuelSiteAvailability`, `:614-640`; called at set-up, by action 256, on every sector control change and airspace
update, `Strategic/Player_Command.cc:180, 287`, `SM:2326`; after loading through `LoadStrategicAI`'s `UpdateAirspaceControl`,
`Strategic/Strategic_AI.cc:2463`; the explicit call at `SaveLoadGame.cc:1156` only runs for saves of version ≤ 89).
`gubPlayerProgressSkyriderLastCommentedOn` is saved as a `BOOLEAN` byte but keeps its full value.

### 10.2 Getting the helicopter

`InitNPCs` puts Skyrider in B15, E14, D12 or C16 (alternate map, §4.2). Records make him an EPC (§9.1, quest 17). When the
escorted Skyrider steps within 11 tiles (strictly) of gridno 8842 in B13 (`OH:1871-1887`): he stops,
`SKYRIDER_CLOSE_TO_CHOPPER`, → SKYRIDER 15 (which un-recruits him, §9.2), and `SetUpHelicopterForPlayer(B13)`
(`HELI:647-657`): once, add the `HELICOPTER` vehicle in B13 (`AddVehicleToList`), give it a movement group, update the refuel
sites. While the helicopter stands at a refuel site in the loaded sector, the map shows it (six structure pieces, mercs within
5 tiles bumped, `HELI:1146-1189`) and Skyrider's profile is put in that sector (`HandleHelicopterOnGround`, `HELI:972-1022`,
called on every sector load, `SM:463, 501, 520, 872`); otherwise the pieces are removed and Skyrider's profile sector is cleared
(his soldier removed unless on our team). Before he is set up the helicopter "is" at Drassen (`HELI:1024-1040`). ja2-node
does not place the pieces (deviations "Helicopter on the map", "Profile sectors of Skyrider and the helicopter").

### 10.3 Flying

- `CanHelicopterFly` (`HELI:345-363`) = vehicle exists, pilot available (`IsHelicopterPilotAvailable`, `:365-396`: Skyrider is
  not owed money and Drassen loyalty is not low per §1.3's Skyrider rule), not returning to base, and `CanHelicopterTakeOff`
  (airborne, or its sector is not enemy controlled, `:1127-1144`). Mercs may board only while it can fly (`OKUseVehicle`,
  `Tactical/Vehicles.cc:858-861`).
- Plotting (map screen, `Strategic/MapScreen.cc:7250-7290`): refused with the reason quote (owed money, returning, grounded,
  disloyal, `:7293-7325`); an empty helicopter while mercs stand in its sector gives a one-time hint box
  (`gfSkyriderEmptyHelpGiven`) and no plot; else his greeting quote and `SKYRIDER_USED_IN_MAPSCREEN`. Confirming
  (`:7339-7391`): destination without known enemies → progress at least 25 points above the last comment → "going well"
  quote, at least 10 below → "going badly" (both store the progress), else the confirmation; known enemies → the warning
  quote. The route is the group's path (`16`: 100 per sector left in friendly airspace, 1000 in enemy airspace); confirming
  takes off (`TakeOffHelicopter`, `HELI:447-455`; `Strategic/MapScreen.cc:5514`) even when the route is empty (a click on the
  helicopter's own sector makes it airborne in place). Rerouting a flying helicopter cancels first, which turns it back and,
  when no time has passed, lands it in the sector it left (`HandleHeliEnteringSector` with never-left: no SAM fire and no
  bill, but hovering, the arrival quote, payment and landing as usual). The agent's `heliRoute` replaces plotting and
  confirming (deviation "Helicopter interface").
- Each sector entered (`HandleHeliEnteringSector`, `HELI:199-295`, from the group arrival,
  `Strategic/Strategic_Movement.cc:1305`):
  1. unless the flight never left: SAM attack (`:1048-1124`): the sector is in enemy airspace and covered by a SAM whose
     condition ≥ 80 (`MIN_CONDITION_FOR_SAM_SITE_TO_WORK`) → chance `min(condition, 33)`; `PreRandom(100) < chance` → hits + 1,
     stop compression; first hit → quote; second → quote and return to base; third → quote, the arrival event deleted,
     `SkyriderDestroyed` (after the crash sound in the original) and stop;
  2. enemies there, not never-left, the player knows nothing about the sector, and the helicopter can fly →
     `PreRandom(100) < 60 + n` → if not at the end of the path: stop compression, one of two quotes (`Random(2)`, cosmetic,
     `16` §8); flag `SF_SKYRIDER_NOTICED_ENEMIES_HERE` (enemies shown while he stays, `knowledge.ts`);
  3. not returning and not never-left: cost += 100 (friendly airspace) or 1000 (enemy airspace)
     (`Map_Screen_Helicopter.h:12-13`);
  4. end of the path: start hovering (§10.4); no enemies or returning → if passengers or not returning: arrival quote, stop
     compression; then pay (§10.6); enemies and not returning → abort quote, stop compression; a refuel site is the nearest
     available one and this sector → land.
- Passengers leave by joining a squad in the sector while it hovers or stands (`RemoveSoldierFromHelicopter`, `HELI:178-197`,
  `Tactical/Squads.cc:150-165`; not while flying or returning, although the squad menu's `PreChangeAssignment` takes a
  passenger out anyway, deviation "Leaving the helicopter in flight"). The first passenger to start a new squad makes that
  squad "arrive" from the helicopter's previous sector (`PlaceGroupInSector`), which sets its insertion code; a passenger
  dropped outside the loaded sector gets `INSERTION_CODE_GRIDNO` 10125 at the airport and `INSERTION_CODE_CENTER` elsewhere
  (`SetSoldierExitHelicopterInsertionData`). A battle in a sector where the helicopter stands empties it into a foot group
  (`Strategic/PreBattle_Interface.cc:1213-1221`).

### 10.4 Hovering

`StartHoverTime` (`HELI:458-469`): hovering, start minute, event `HELICOPTER_HOVER_TOO_LONG` at now + 10. Its handler
(`:471-490`): still hovering → event `…_WAY_TOO_LONG` at start + 20, quote, stop compression; else reset the start. The second
handler (`:492-508`): reset; still hovering → quote, the sector holds no enemies → everyone out into a foot group
(`MoveAllInHelicopterToFootMovementGroup`, `:659-697`: one new squad; the first passenger's insertion code copied to the rest),
then return to base.

### 10.5 Returning, landing, refuelling

`MakeHeliReturnToBase` (`HELI:1417-1442`): at an available refuel site → land; else path to the nearest refuel site
(`FindClosestRefuelSite`: shortest `FindStratPath`, available ones first, any as a last resort with a "no safe landing zone"
message, `:298-338`), returning, not hovering; stop compression. `LandHelicopter` (`:399-422`): grounded, not hovering, not
returning, map pieces added; if it cannot fly again (enemies, debt, disloyalty) → everyone out; else the KILL_CHOPPER meanwhile
is scheduled once (`HandleKillChopperMeanwhileScene`, `26`). There is no fuel model for the helicopter.

### 10.6 Paying Skyrider

`PaySkyriderBill` (`HELI:1344-1385`) at the end of a flight with a cost: enough money → ledger `PAYMENT_TO_NPC −cost`; else pay
what is there (if any) and `SKYRIDER.balance = money − cost` (or `−cost`), owed quote, everyone out, return to base; cost = 0.
The debt grounds him (§10.3) until paid: hourly (§4.4) or by giving him money (§3.11).

### 10.7 Destruction

`SkyriderDestroyed` (`HELI:340-362`): delete the group's arrival event, kill everyone aboard (`KillAllInVehicle`: 100 points
of bleeding damage each, stopping at the first passenger already at life 0; the dead go through the strategic death),
Skyrider's profile life 0, destroyed, his balance and the cost 0, the vehicle removed, id −1. The original runs it from the
crash sound's end callback; ja2-node runs it at once (deviation "Helicopter destruction").

### 10.8 Monologues (`CheckAndHandleSkyriderMonologues`, `HELI:862-903`)

Run whenever the map panel redraws and the pilot is available (`Strategic/MapScreen.cc:4976-4982`); at most one per 1440
minutes since the last: talk state 0 → the Drassen SAM monologue (reveals SAM site 2 through its special event; adds the "SAM
taken" line if SAM 2's sector is ours and he has flown, which sets `gfSkyriderSaidCongratsOnTakingSAM`), state 1; state 1 →
the Cambria hospital monologue if F8 is enemy held, state 2 either way; state 2 → once the SAM congratulation was said: the
other SAM sites (reveals SAMs 1, 3, 4), state 3; state 3 → once Estoni refuelling is available: the Estoni monologue, state 4.
The congratulation is also said when the player liberates a SAM site after the first monologue
(`Strategic/Player_Command.cc:153-161`). The SAM reveals are game state (map knowledge); the highlights are presentation.
ja2-node checks the monologues once per strategic step while the flow is `strategic` (deviation "Skyrider monologues";
inferred equivalent to "per redraw").

---
## 11. Quest-specific campaign rules

### 11.1 Sight rules (`ManSeesMan` on a new sighting of an OUR merc, `OL:1530-1770`)

| Seer | Rule | Lines |
|---|---|---|
| profiled civilian, neutral, group hostility ≥ 2 | hostile-quote list | `OL:1549-1556` |
| profiled civilian with an unused `DECLARATION_OF_HOSTILITY` record | hostile-quote list (`24`) | `:1558-1563` |
| otherwise CARMEN (neutral) seeing Slay | attitude `ATTACKSLAYONLY`, → CARMEN 28 | `:1569-1576` |
| ELDIN (neutral) | the merc behind the ropes (rooms 22–41) while the museum is closed, or the alarm went off, or rooms 39–40, or the merc carries the chalice → `MUSEUM_ALARM_WENT_OFF`, hostile-quote list | `:1578-1595` |
| the six assassins | orders `SEEKENEMY`; if they saw nobody before: cancel the action, new situation | `:1597-1614` |
| ANGEL | seeing Maria escorted into the leather shop → ANGEL 12; else (deed left, not yet mentioned) → stop, ANGEL 20 | `:1616-1633` |
| JOE, ELLIOT | first sighting outside meanwhiles → record 4 (`SAID_FIRSTSEEN_QUOTE`) | `:1635-1647` |
| IGGY on the enemy team | first sighting → IGGY 9, flag, our team "heard" him | `:1655-1667` |
| unprofiled civilian, group hostility ≥ 2, neutral | hostile-quote list | `:1671-1677` |
| Kingpin goon | seeing Maria → hostile, combat, `MARIA_ESCAPE_NOTICED`; a merc in the brothel guard room (110) → hostile, combat | `:1678-1705` |
| hick, no marriage | before 06:05 or after 22:00 (minute of day < 365 or > 1320) → hostile, combat, the "get off our farm" civilian quote | `:1707-1729` |
| our A.I.M. merc seeing MIKE | quote once, `gfMikeShouldSayHi` | `:1733-1741` |
| our merc seeing JOEY | quote once per game (`gfPlayerTeamSawJoey`) | `:1743-1749` |
| a Kingpin goon losing sight of a merc in the guard room | runs to 13250 (not ported, §15) | `OL:1282-1294` |

The six assassins (JIM, JACK, OLAF, RAY, OLGA, TYRONE) also attack as soon as a PC comes within 8 tiles while they are
neutral (`OH:1934-1955`; the named-NPC AI approaches the closest PC, `DA:607-632`). ja2-node runs the civilian and Iggy rows
from `manSeesMan` before the bloodcat rule.

### 11.2 The airport, Pablo and lost goods (Drassen)

Opening the delivery crate with Pablo's theft undiscovered → the "stuff missing" quote from a nearby merc
(`SayQuoteFromNearbyMercInSector` with a wisdom roll per candidate, `Random(100) > wisdom` excludes him, then `Random(n)`,
`Tactical/Dialogue_Control.cc:1386-1422`) and `PLAYER_FOUND_ITEMS_MISSING`. Attacking Pablo then punishes him (§6.3); his
records return the goods (action 108). `HandleDelayedItemsArrival` (`SEH:346-432`): for the stolen goods (Pablo dead →
nothing): `PABLO_RETURNED_GOODS`, not punished; two random items, each `Random(10)`: 0 → `GASMASK` at `20 + Random(10)` %, 1–2
→ `DESERTEAGLE` 40+, 3–5 → `STUN_GRENADE` 70+, 6–9 → two `SW38` 90+, added invisible at the delivery gridno (loaded sector:
pool; else the unloaded sector's items); then the items stored at gridno 1 (`PABLOS_STOLEN_DEST_GRIDNO`) move to the delivery
gridno. For a damaged package the pool at gridno 2 (`LOST_SHIPMENT_GRIDNO`) moves when the sector is loaded, but in an unloaded
sector only items at gridno **1** are moved (`SEH:420-430`): the damaged goods then stay at gridno 2 (kept).

### 11.3 The hospital (Cambria F8)

- Prices (`ID:4065-4155`): `CalcPatientMedicalCost(s)`: free modifiers → 0; else `10·(lifeMax − life)` + `25·(OKLIFE − life)`
  below OKLIFE + `2·bleeding`; the patient's modifier `BREAK` → ×85/100, `COST` → ×70/100, `UNSET` → the global modifier
  decides the same way. `CalcMedicalCost(doctor)`: sum over OUR soldiers in sector, `0 < life < lifeMax`, not in hospital,
  within 9 (inclusive; the escort uses strictly < 9) of the doctor; round **up** to $10; at least $10.
- Leaving the hospital assignment refunds: `giHospitalRefund += CalcPatientMedicalCost(s)`, the patient's modifier reset
  (`Strategic/Assignments.cc:6299-6307`). ja2-node keeps the per-merc modifier on `RosterMerc.hospitalPriceModifier`
  (imported from native saves) and applies the refund in `setTimeOfAssignmentChange`.
- Supplies: `CheckForMissingHospitalSupplies` (`SEH:884-936`, F8 loaded at 04:00 or on leaving F8): for every `OWNERSHIP`
  world item of the doctors' group, count the items with status > 60 of kind first aid kit, medical kit, regeneration or
  adrenaline booster in the pool on its tile (level 0; two markers on one tile count it twice, kept); stolen-again and the
  count back at `gubCambriaMedicalObjects` (18, or 21 with sci-fi) → both stolen facts false; else below that → stolen; at most
  a fifth left → stolen again. Picking the supplies up angers the doctors in the original (§6.4).

### 11.4 Kingpin: his money, his hitmen, his men

- **Money** (`CheckForKingpinsMoneyMissing(first)`, `SEH:476-546`), first called when the player leaves D5-1: total = all
  `MONEY` world items **of the loaded world**. First call: will-learn already set → return; total < 30000 → history
  `FOUND_MONEY`, `KINGPIN_WILL_LEARN_OF_MONEY_GONE`. Kingpin dead → return. Total < 30000: first call → event tomorrow at
  `Random(120)` (fact 103), `KINGPIN.balance = −(30000 − total)`, every money item of the world deleted (the rest of his cash
  vanishes as the player leaves); later call (from that event) → `KINGPIN_KNOWS_MONEY_GONE`, event in 2 days at
  `Random(120)`. The later call also counts the **currently loaded** world's money (kept: with 30000 or more lying in
  whatever sector is loaded, he never finds out; with no sector loaded the total is 0). Then §3.13: the letter and quest 4,
  and two days later the threat (assassins allowed, Spike to C5, Kingpin group 2).
- **Hitmen**: at a town sector entry (§4.5) → `DecideOnAssassin` (`SP:385-412`): candidates from `g_assassin_info`
  (`SP:106-114`: JIM, JACK, OLAF, RAY, OLGA, TYRONE with five towns each) alive, not placed, whose towns include this town;
  `Random(n)` picks one, his sector = the entered sector, `REMOVE_ASSASSIN` at now + `60·(3 + Random(3))`. Each assassin death
  makes the rest tougher (`MakeRemainingAssassinsTougher`, `SP:414-482`: `difficulty = 60/6 · killed`, ×1.3 medium, ×1.6 hard;
  < 14 nothing, < 28 a mini grenade, < 42 hand grenade replacing it, < 56 mustard replacing it, < 70 a LAW replacing it, else
  an extra hand grenade; added to every living assassin's profile). History `ASSASSIN` comes from a record.
- **His men**: the C5 placement override (§4.6), no schedules (§5.2), the brothel door rules (§8.3), the alarm (§6.2), the
  guard-room sight rules (§11.1), Maria (§11.5). Kingpin's death: `KINGPIN_DEAD`, quest 4 ends with experience,
  `ExecuteStrategicAIAction(KINGPIN_DEAD)` (`17`).
- **Boxing and bets**: §7, §3.11.

### 11.5 San Mona: the brothel, Maria, Angel and Kyle

- Madame's money rules (§3.11) count girls paid for in `npcData`; actions 124–134, 217–220 run her lines; the girls' doors are
  unlocked by actions 129–132. The entry/exit tracking (`ACTION_ITEM_ENTER/EXIT_BROTHEL`) is commented out in Gold
  (`TileEngine/Explosion_Control.cc:1693-1786`): facts 88, 95, 237 are never set by code.
- **The sex action item** (`TileEngine/Explosion_Control.cc:1818-1890`), out of combat, an OUR merc stepping from another room
  onto the item tile, a "miniskirt" civilian (`HookerInRoom`) in that room: stop; for item tiles 13414, 11174, 12290 the door
  13413 / 11173 / 12290 is closed by a door-closer action, action 122 (presentation), the merc teleported to the nearest free
  spot within 2 of 13413 / 11173 / 12291 and stood up, morale event `MORALE_SEX`, `FatigueCharacter` four times. On a room
  tile the code does not list, the item only stops the merc.
- **Action items in ja2-node.** Our soldiers stepping on a tile set off armed pressure action items and pressure switches
  there (`SetOffBombsInGridNo` from `HandleAtNewGridNo`, skipped while mercs walk off the map; enemies and items placed by the
  player are ignored); a switch sets off the remote action items on its frequency (`SetOffBombsByFrequency`). The queue runs
  at the start of the next overhead pass with sight disallowed and keeps the AI and `isIdle` busy; at its end sight comes
  back, a non-player trigger is freed, and a changed door makes all teams look and our mercs reveal roofs. Performed:
  `ACTION_ITEM_CLOSE_DOOR` (the room item's door and any map's door closers), `KINGPIN_ALARM`, `SEX` and `MUSEUM_ALARM`; the
  other action items, and switches operated by hand (`ActivateSwitchInGridNo`, with it
  `ACTION_ITEM_TOGGLE_PRESSURE_ITEMS`), stay inert (deviation "Map items"). The museum alarm calls Eldin while sight is
  disallowed, so his line-of-sight test fails and he always runs to the spot (the "I hate you" branch is dead from the alarm);
  the alarm's "zap" clears the disabled flag, so it can ring again.
- **Maria**: quest 6 by records; escort (§9); a Kingpin goon seeing her or a Kingpin civilian turning hostile or being hurt
  while she is in sector → `MARIA_ESCAPE_NOTICED` (§1.2); she cannot leave C5 strategically (§9.3); in the leather shop (room 2
  of C6) with Angel there → ANGEL 12 (`OH:1891-1900`, and by sight §11.1); ending quest 6 zeroes Madame's counters.
- **Angel**: the vest requestor (144) and his money rule; the deed (147) dropped at 12541 for Kyle; Kyle's $10000 pickup
  (123) and record 11.

### 11.6 Terrorists, Carmen and Slay

- Placement (§4.2), files (154), heads: a head item comes from decapitating a corpse with a knife
  (`Tactical/Rotting_Corpses.cc:1183-1229`): CHRIS → `HEAD_2`, T_REX `HEAD_3`, SLAY `HEAD_4`, DRUGGIST `HEAD_5`, ANNIE `HEAD_6`,
  TIFFANY `HEAD_7`, anyone else `HEAD_1`. ja2-node has no decapitation (deviation "Corpses").
- Carmen counts terrorists left and heads held (156), leaves (157/158 with a 10 000 ms timer), returns at 04:00 to C13 paying
  $10000 per head (§4.3), and ends the quest when none are left (159 → §4.5). Carmen roams C5/C13/G9 daily.
- Every terrorist death makes the rest tougher (`MakeRemainingTerroristsTougher`, `SP:303-383`: remaining = living placed
  terrorists, Slay excluded while on our team; `difficulty = 60/total · killed`, ×1.3/×1.6; same item ladder as the
  assassins, added to their profiles); Elgin's death → MANNY 10 if Manny is in sector and conscious (`OH:2341-2350`).
- Slay: attacked while neutral → record 1 unless `FACT_155`; seen by Carmen → Carmen hunts him; his death while Carmen hunts
  → CARMEN 29 (`OH:2225-2235`); recruited (`RecruitRPC`, `24`) → a 7-day contract and his wheelchair kicked out
  (`SP:700-706`); leaves when alone (`Chance(15)` hourly) or when his week ends (§4.4).

### 11.7 Chitzena's chalice and Balime's museum

`MUSEUM_OPEN` 09:00–18:00 (§4.4); Eldin's sight rule (§11.1); the museum alarm item → klaxon and `CallEldinTo(gridno)`
(`TacticalAI/Knowledge.cc:86-123`: Eldin, in sector, ≥ OKLIFE, green or with a fading noise: sees the spot → "I hate you"
trigger, new situation; else a loud noise there, red alert, walk to it unless already doing so with the alarm known;
`MUSEUM_ALARM_WENT_OFF`); leaving the sector clears the alarm fact; a merc in L12 rooms 22–41 cannot leave strategically while
Eldin lives and anyone of ours carries the chalice (`ME_MUSEUM`, `Strategic/Map_Screen_Interface.cc:3805-3817`; not in
ja2-node, deviation "Strategic move refusals"); any sector entry with the chalice in a merc's inventory sets `CHALICE_STOLEN`
(§4.5); Yanni's records (185) and loyalty (§2.4); killing Eldin costs Balime loyalty.

### 11.8 Tixa, Alma and the army's profiled soldiers

- Tixa (J9): liberated → only kids remain among unprofiled civilians; the Warden is never neutral; messing with a door near
  the Warden alerts her (§8.3); `DYNAMO_IN_J9` and Matt's records; Dynamo freed by recruiting or killed (quest 18).
- Alma prison: capture (`19`); POW release on entering the prison sector ends quest 8 with experience 3 (`SM:1001-1006`);
  Krott's requestor and loyalty boost.
- Mike and Iggy: 50 % progress makes Mike available; Iggy appears in C5 at 70 % and becomes available to the army when he
  leaves our team unpaid (`22`); the first eligible elite placement becomes the profiled soldier (§4.6; also in
  `TacticalCreateEnemySoldier` and the autoresolve creation); their deaths reduce the garrison (`queen-command.ts`).

### 11.9 The hicks and Daryl's marriage (F10)

Night hostility (§11.1), the cow rule (§6.3), owned items (§6.4), victory in F10 with no living hick → `HILLBILLIES_KILLED` and
Keith back in business (`NPC:2607-2637`, called on a tactical victory, `OH:4682`). The marriage prompt (226, §3.3) and
`HAVE_MARRIED_NPC_LEAVE_TEAM` (227, `ID:2438-2468`): the merc is `DARYL.npcData`'s profile (soldier must exist, and dest):
`MARRIED_TO_HICKS`, history `MERC_MARRIED_OFF`, FLO → `PC_MARRYING_DARYL_IS_FLO`, morale `MORALE_MERC_MARRIED`,
`UpdateDarrelScriptToGoTo` (`NPC:2667-2695`: a free gridno near the merc excluding his tile, radius 5 then 10, written into
DARREL's record 10 destination and record 11's required gridno and trigger NPC — a record-data mutation, `24`), → DARREL 10,
the merc moves to the personnel "other" list (`21`). Action 262 (from records) then turns the merc into a profileless
civilian. `HICKS_MARRIED_PLAYER_MERC` comes from records and calms the hicks.

### 11.10 Joey and Martha (Cambria)

Action 136 puts Joey in D4-1 and, 3 days later at the same minute, moves him to C5 unless he is dead, escorted or no longer in
D4-1 (while his soldier is in the loaded sector the move is retried every 60 minutes). Escorted into G8 (Cambria) and near
Martha (`JOEY_NEAR_MARTHA`) → he stops, → JOEY 10 (`OH:1903-1912`); his un-recruit from record 9 places him in room gridno
18326. Joey killed: Martha closer than 10 tiles or with line of sight → MARTHA 17 and Cambria −20, else −10
(`OH:2366-2382`). The Willis discount follows by events (139, 271, 272).

### 11.11 Doreen and the children (Drassen)

Records free the kids (117 → tomorrow 07:00 `KIDS_ARE_FREE`; the kids' bodies are then skipped in C13, §4.6) and boost
loyalty (10). Killing Doreen: loyalty (§2.4), `DOREEN_HAD_CHANGE_OF_HEART`, quest 20 ends, and if the kids are not free yet,
action 117 runs at once (`OH:2403-2418`).

### 11.12 Profile-specific death effects

`HandleNPCTeamMemberDeath` (`OH:2262-2445`): every profiled death marks the profile dead with life 0 and adds history
`MERC_KILLED_CHARACTER` (killer on our team) or `NPC_KILLED` (not for vehicles or tanks); a visible profiled civilian prints a
message. Civilian-team cases: BRENDA (`OH:2305-2316`, fact, HANS 10 if Hans is within 12 and neutral), PABLO (second
attendant), ROBOT, the terrorists, the assassins, ELDIN, JOEY, DYNAMO, KINGPIN, DOREEN (all above), QUEEN
(`BeginHandleDeidrannaDeath`, `26`); then `HandleMurderOfCivilian` for every civilian but crows and cows (`18`, `OH:2427-2433`).
Our-team deaths (`OH:2221-2250`): SLAY (Carmen), ROBOT (facts 203/206, 202 false). ja2-node runs these before the experience
awards (and for our team when the skull is released); not ported: the NPC death history lines, the death message and
`HandleMurderOfCivilian` (§15).

### 11.13 Vehicles

The hummer: Dave (GERARD) sells it (requestor 169, his money rule with $10000, records, 211 → `OK_USE_HUMMER` in 24 h),
`DAVE_HAS_GAS` daily, `FILL_UP_CAR` (202). The ice-cream truck moves with Hamous daily (§4.3), `OK_USE_ICECREAM` from records,
the placement quirk (§4.6). Boarding is gated by `OKUseVehicle` (`Tactical/Vehicles.cc:847-866`); ja2-node boards only
vehicles already on our team (deviation "Ground vehicles").

### 11.14 John and Mary (the tourists)

Escorted together (§9.1, quest 19). In B13 (the Drassen airport), each step of an escorted John or Mary, or of any OUR merc
while quest 19 runs (`OH:1867-1927`), checks the arrival: Mary only if John is dead (`OH:1631-1657`): within 40 of gridno 8228
and no closest PC farther than 8 (no PC at all passes) → `MARY_OR_JOHN_ARRIVED`, she stops, → MARY 13; John
(`OH:1660-1697`): within 40 of 8228, the same PC test and, if Mary is alive, her soldier within 8 of him → the fact, both
stop, → JOHN 13 with Mary present, else JOHN 12. Their record 13 un-recruits them with both profiles leaving the map (§9.2).
John's gift shipment (188) arrives through Bobby Ray's delivery with Kulba's email (`21`).

### 11.15 Smaller rules

`RecruitRPC`'s quest parts (`24` runs it, `SP:685-768`): Slay's week and wheelchair (§11.6), the end of quest 18 for Dynamo
(§11.8), IRA's record 0 (queued, `SP:746-750`), history `RPC_JOINED_TEAM`. Father Walker's daily move and drunkenness (§4.3);
Rat leaves after 236 at 04:00; Devin, Micky, Bob, Gabby, Tony, Carmen, Hamous placement (§4.2–§4.3); Larry's relapses
(§4.4); Conrad leaves H13 on exit with his fact; Elliot healed on entering P3 (§4.5); Manny's bartender position (210);
Brenda stationary (248) and patient timer (121); bloodcats: quest 13, fact 168 (two days), 259 (I16 cleared), the lair fact
from records; `REBELS_HATE_PLAYER` and `MIGUEL_READ_LETTER` feed the town loyalty start (`18`).

---

## 12. Determinism

### 12.1 Draws, in order

| Where | Draws | Stream |
|---|---|---|
| New game: terrorists (§4.2) | 2 × `Chance(70\|50\|30)`; sweeps: `Random(100)` per unplaced candidate, `Random(5)` until unused | main |
| New game: `InitNPCs` (§4.2) | one `Random(#sectors)` per eligible placement in profile-id order (6 or 8 draws) | main |
| `SetFactTrue(ESTONI_REFUELLING_POSSIBLE)` the first time | `Random(3)` and the dealer stock draws (`23`) | main |
| 04:00 (§4.3) | `Random(4)`, `Random(2)`, Tony `Random(4)` (if eligible), Devin `Random(5)` (if eligible), Hamous `Random(5)` (if eligible), Carmen `Random(3)` (if eligible), `PreRandom(3)` | main, pre |
| Hourly (§4.4) | Larry `Random(temptation)` or `Random(2)`; Slay `Chance(15)` | main |
| Sector entry (§4.5) | head miners, then assassin `Random(10 + militia)` (if eligible) and `DecideOnAssassin` `Random(n)`, `Random(3)` | main |
| Placement (§4.6) | Kingpin goons: two range draws and `PreRandom(3)` per unprofiled goon, two for Billy, before the soldier's own creation draws | main, pre |
| Schedules (§5.2) | default schedule `Random(61)`, `Random(121)` per civilian in init-list order; sleep time `Random(180)` the first time a sleep entry without time is posted; again for the unsaved default schedules after a native load (oracle-checked) | main |
| Actions (§3) | 107: `Random(100)` and maybe a second; 108: `Random(60)`; 125: `Random(3)`, `Random(2)`, `Random(2)`; 126: `Random(2)`; 139: `Random(24)`; 160: `PreRandom(100)` on the last branch only; 118: `Random(2)` only with both doctors; 230: `Random(60)`; 140: the hit's draws (`11`); 43: `Random(n)` in `TriggerFriendWithHostileQuote`; 221 lie: `SkillCheck` (`11` §10) | main, pre |
| Civilian groups (§6.2) | `Random(2)` per later profiled candidate in the side-change loops | main |
| NPC system events (§3.13, §11.2, §11.4) | Kingpin `Random(120)`; Pablo's goods 2 × (`Random(10)`, `Random(10)`); damaged package `Random(100)`; Pablo's death `Random(60)` | main |
| Boxing (§7.2) | `Random(2)` for the first team | main |
| Doors (§8.3) | the `SkillCheck` draws (and the `StatChange` draws of the gains); crowbar `PreRandom(bStress / 20)`; electric traps `PreRandom(3)` then `PreRandom(10)` (`6` then `20` for super); `CalcTrapDetectLevel` `PreRandom(level / 3 + 2)` when examining and `PreRandom(3)` when bleeding > 20 or shocked; code 495 draws `DoorOpeningNoise` before `HandleOpenableStruct`; sirens and silent alarms `Random(1000)` per alerted soldier in real time (`SetNewSituation`); a failed unlock's curse `Random(2)`, door creaks and the silent skill-check curse (cosmetic, not drawn in ja2-node: deviation "Cosmetic draws of doors") | main, pre, fx |
| Helicopter (§10.3) | per sector entered: SAM `PreRandom(100)` (if covered and working), notice `PreRandom(100)` (if enemies are unknown), quote `Random(2)` (cosmetic stream in ja2-node, deviation "Cosmetic draws of the helicopter") | pre, fx |
| "Stuff missing" quote (§11.2) | `Random(100)` per candidate, `Random(n)` | main |

The Kingpin goon gridno adds two engine draws whose evaluation order C++ leaves unspecified (§4.6, deviation "Kingpin's men
placement"). Every other path draws in statement order.

### 12.2 Wall-clock dependencies and their replacements

| Original | ja2-node |
|---|---|
| Carmen's departure waits a 10 000 ms customizable timer (`ID:2708-2709`) | 10 000 ms of tactical game time (deviation "Carmen's departure timer") |
| The helicopter is destroyed when the crash sound ends (`HELI:1101-1112`) | at once (deviation "Helicopter destruction") |
| `HandleNPCTriggerNPC` waits 500 ms for the radio locator (`ID:1419-1437`) | `24` |
| Fades into and out of the rebel basement run the sector change in their callbacks (`ID:4510-4574`) | the sector change runs at once (deviation "Rebel basement") |
| Skyrider's monologues run on map panel redraws (`HELI:862-903`) | once per strategic step while the flow is `strategic` (deviation "Skyrider monologues") |
| The sex screen's time warp at its end (`JAScreens.cc:478-483`) | at the action (deviation "Brothel time warp") |
| Boxing bell, klaxons, crash and lock sounds, map highlights | presentation events only |

---

## 13. Data tables and stubs

### 13.1 Externalized data (`data/externalized/`)

`tactical-npc-action-params.json` (action gridnos and amounts, §3.1), `strategic-fact-params.json` (Hans 13523, Spike 9817),
`strategic-map-npc-placements.json` (§4.2; read by `src/content/strategic/npc-placements.ts`), `mercs-profile-info.json`
(names ↔ ids, types), `shipping-destinations.json` (delivery sector and gridno), `game.json` (`progress.event_*_min`,
`diagonally_interactable_doors`, `pablo_wont_steal`), `strategic-mines.json` (head miners), `strategic-map-sam-sites*.json`
(SAM sectors, air control), `items.json` (prices of `LEATHER_JACKET_W_KEVLAR` and `ALCOHOL`, key items),
`script-records-NPCs.json` (the externalized records, `24`).

### 13.2 Transcribed tables

`data/tables/narrative.json` (`tools/transcribe/narrative.ts`; regenerate, never edit) holds the fact ids and names
(`Strategic/Facts.h:5-337`, including the unnamed `FACT_38` … `FACT_281`; the `FACT_` prefix is dropped unless the rest is a
number), the quest ids and names (`Strategic/Quests.h:43-74`), the NPC profile ids (`Tactical/Soldier_Profile.h`), the NPC
action codes and names (`Tactical/Interface_Dialogue.h:85-342`), Larry's items and bars (`HU:154-167, 210-217`) and the
schedule actions and flags (`Scheduling.h:10-41`). The code constants are checked against it (`fact-ids.ts`, `npc-ids.ts`,
`npc-actions/codes.ts`, `larry.ts`, `schedule-state.ts`). The terrorist candidates come from `data/tables/laptop.json` (`21`);
the history codes from `data/tables/merc-contracts.json` (`22`). Everything else is a named constant with an `@src` header in
its module: assassin towns (`presence.ts`, `SP:106-114`), refuel sites (`helicopter-state.ts`, `HELI:80-84`), boxer gridnos
and ring rooms (`boxing-state.ts`, `Boxing.h:6-14`), civilian groups and hostility levels (`tactical/narrative/constants.ts`,
`soldier.ts`), lock types, door traps and perceived values (`locks.ts`, `door-table.ts`, `Keys.h:12-125`), quest gridnos and
rooms (the action and rule modules), experience amounts, hospital prices, distances and money thresholds.

### 13.3 Original data (read at run time, never committed)

NPC quote records (`24`); `BINARYDATA/Locks.bin` (§8.1); map files (schedules, door tables, placements with schedule ids and
civilian groups, action items); `prof.dat` (initial profile sectors, towns, inventories, `npcData`); native saves: the quests
section, the profiles' NPC fields (section 5), the key table, the schedules section, the general-info fields of §0, the
civilian group states (tactical status).

### 13.4 Stubs

The stub pack (`27` §6.4) carries invented narrative content: NPC profiles and records (`stubs/profiles.json`,
`stubs/npc/records.json`); in the stub A10 a villager with a two-entry schedule (`09:00 GRIDNO`, `22:00 SLEEP`), a civilian on
the default schedule, and profiled stub NPCs with `STAYINSECTOR` schedules, written with `schedule '<symbol>': [HH:MM]
<ACTION> [<x> <y>] [-> <x> <y>]; …` lines (up to four entries, times optional) and a `schedule=<symbol>` soldier flag (a
detailed placement with the schedule id, profile 200 for an unprofiled civilian); a stub club D5 (`stubs/maps/d5.map.txt`: a
hall in room 3 with the ring in room 29 at the original's tiles, three unarmed boxers on the boxer gridnos via a `body=<n>`
soldier flag) with a club owner at profile 87 whose records run 135, 138 and 205; a locked, electrically trapped door with
lock 1 in the stub village (`stubs/locks.json`). The helicopter and the robot are tested on synthetic states.

---

## 14. Implementation in ja2-node

### 14.1 Modules

All files carry the SFI-SCLA header. `sim` modules are deterministic and read the content through ports.

| Module | Responsibility |
|---|---|
| `src/sim/strategic/narrative/facts.ts` | `NarrativeState` (`StrategicState.narrative`): facts, quests, the boxing record, the hospital account, `cambriaMedicalObjects`, Joey/Mike globals, `profiledEnemyAdded`, the guide-description countdown; `setFactTrue`/`setFactFalse`, quest status, `importNarrative` |
| `fact-ids.ts`, `npc-ids.ts`, `history-codes.ts` | ids, checked against `data/tables/narrative.json` and `merc-contracts.json` |
| `check-fact.ts`, `economy-facts.ts` | `CheckFact` (§1.3) over `FactContext` ports; the strategic inputs (loyalty, towns, mines, bloodcats, enemies) |
| `quests.ts`, `rewards.ts` | §2.2–§2.4: start/end with history, `InitQuestEngine`, `CheckForQuests`; experience and NPC loyalty rewards |
| `npc-events.ts`, `kingpin.ts`, `hospital.ts` | §3.13 handlers (event 27), §11.2 goods, §11.4 money; §11.3 prices, refund and supplies |
| `presence.ts`, `early-morning.ts`, `hourly.ts`, `larry.ts`, `profiled-enemies.ts` | `ChangeNpcToDifferentSector`, profile items, toughening, assassins (§4.1, §11.4, §11.6); §4.3; §4.4 (quest hours, progress milestones, Slay); Larry; the Mike/Iggy upgrade (§4.6) |
| `civ-groups.ts`, `save-import.ts` | `StrategicState.civGroups` and event 41; native import of the narrative globals |
| `src/sim/campaign/laptop/aim.ts` `decideActiveTerrorists`; `src/sim/strategic/map/init.ts` `initNpcPlacements` | §4.2 |
| `src/sim/tactical/narrative/npc-actions/` | the catalog: `catalog.ts` dispatches in the original's order to `generic.ts` (§3.2), `requestors.ts` (§3.3), `rebels.ts` (§3.4), `drassen.ts` (§3.5), `san-mona.ts` (§3.6), `cambria.ts` (§3.7), `south.ts` (§3.8), `others.ts` (§3.9), `meanwhile.ts` (§3.10), `open-thing.ts` (§8.6, actions 3, 27, 40) over `NpcActionEnv` (`env.ts`); codes in `codes.ts`; parameters from `StrategicContent.npcActionParams` |
| `placement.ts`, `profile-insertion.ts` | §4.6: the `AddPlacementToWorld` filter and overrides, `AddProfiles…`, `SetupProfileInsertionData…`, `UpdateSoldierPointerDataIntoProfile` |
| `schedules.ts`, `schedule-state.ts` | §5 (list, posting, auto-processing, shop hours); `src/sim/tactical/ai/decide-schedule.ts` the AI hook; `src/sim/tactical/away-slots.ts` |
| `civ-hostility.ts`, `sight-rules.ts`, `assassin-approach.ts`, `death-rules.ts`, `escort-arrival.ts`, `team-change.ts` | §6.2–§6.3 and the door implications, §11.1, the 8-tile assassin rule, §11.12, the arrivals of §9.3, `ChangeSoldierTeam` |
| `boxing.ts`, `boxing-state.ts`, `boxing-events.ts`; `src/sim/tactical/ai/decide-boxing.ts` | §7; the boxing hooks sit in the overhead, animation, points, turns, death, barrier, hit, sight and AI modules |
| `quest-items.ts`, `wheelchair.ts`, `robot.ts`, `port.ts` | §11.5 action items; the kick-out (animation code 482); the robot's tactical rules; `NarrativePort` (`TacticalState.narrative`, deviation "Narrative port") |
| `src/sim/tactical/doors/` | §8: `door-table.ts`, `keys.ts`, `key-ring.ts`, `lock-attempts.ts`, `door-traps.ts`, `door-actions.ts`, `door-approach.ts`, `door-command.ts`, `door-view.ts`, `openables.ts`; lock table reader `src/content/formats/locks.ts` |
| `src/sim/strategic/forces/helicopter-state.ts`, `helicopter.ts`, `vehicles.ts`, `helicopter-events.ts`; `src/sim/strategic/economy/vehicle-assignment.ts` | §10; boarding, `CanCharacterVehicle`, `OKUseVehicle`, `SoldierMustDriveVehicle` |
| `src/sim/narrative/select.ts` | §3.11 money and item rules (the dialogue side is `24`) |
| `src/server/quest-view.ts` | §2.5 |

### 14.2 Wiring

- `src/sim/campaign/narrative/narrative-flow.ts` (`NarrativeFlow`): the campaign's facts and quests, `checkFact` with the
  talk context, events 4, 27, 28, 34, 63, 67, sector entry and exit quest code (§4.5), death hooks (Dynamo, Kingpin, Doreen),
  the placement narrative; `NarrativeSlots` connect it to the dialogue code (desire to talk, once-per-convo reset, records
  with an approach, `NPCReachedDestination`, NPC actions), the Kingpin money and hospital supply checks and the D5 boxer reset.
- `npc-action-flow.ts` (`NpcActionFlow`): the campaign side of the catalog (requests in the prompt slot, fades, Carmen's
  timer, boxing, meanwhile actions through `meanwhile-actions.ts`); `recruit-flow.ts` (`RecruitFlow`): `RecruitRPC`,
  `RecruitEPC`, `UnRecruitEPC`, `HandleStuffForNPCEscorted`, the marriage's team change; `quest-world.ts`, `fact-world.ts`:
  the world inputs of facts, the delivery sector and the medical cost.
- `src/sim/campaign/narrative-port.ts`: the tactical `NarrativePort` in campaigns, event 36 and the strategic clock behind
  `TacticalState.scheduleClock`, event 41; `helicopter-flow.ts` (`HelicopterFlow`): events 29/30, the hourly debt payment, the
  monologue check per strategic step, the KILL_CHOPPER meanwhile, deaths aboard, the helicopter commands;
  `robot-control.ts`: `ControllingRobot` and the remote holder.
- `SectorFlow` (`src/sim/campaign/sector-flow.ts`): `SetupProfileInsertionDataForCivilians`, the entry quest code, the
  `PrepareLoadedSector` additions and `PostSchedules` on a fresh load (§4.6), the exit quest code and the profile write-back on
  unload, `PostSchedules` without auto-processing after a native import; `CampaignSim` supplies shop hours (§5.5).
- `24` provides: the talk context (§1.4); record conditions calling `checkFact` and the quest-status encoding; record effects
  calling `setFactTrue`, `startQuest`/`endQuest` with the loaded sector; the dispatch that calls `handleNpcDoAction(env, npc,
  code, record)` at the original's points; `TriggerNPCRecord`/`TriggerNPCWithGivenApproach`, `PCsNearNPC` (with `PC_NEAR`),
  `PCDoesFirstAidOnNPC` (with `BANDAGED_TODAY`), the hostile-quote list, `TriggerFriendWithHostileQuote`,
  `SetQuoteRecordAsUsed`, `RecruitRPC`, the item-acceptance loop that calls §3.11, `GetInfoForAbandoningEPC`, the record
  mutation of `UpdateDarrelScriptToGoTo`, `ResetOncePerConvoRecordsForAllNPCsInLoadedSector`, the named-NPC AI's conversation
  part (`DA:556-603`) and the record save sections.
- Outside a campaign (sandbox, unit tests) the tactical narrative port is off: every fact false, quests not started, no
  records (deviation "Narrative port").

### 14.3 Verification

The oracle (`tools/oracle/README.md`, sections "Facts and NPC presence", "NPC actions", "Give", "Civilians", "Doors",
"Schedules", "Boxing", "Helicopter", "Recruiting") runs the original's functions on native saves and new games and compares
them with ja2-node, draws replayed on both streams: probe scripts `facts.txt`, `actions.txt`, `give.txt`, `civ.txt`,
`doors.txt`, `schedules.txt`, `boxing.txt`, `heli.txt`, `recruit.txt`; `laptop.txt`'s new-game probes also compare every
profile's sector (`InitNPCs`, terrorists). The walking door and cabinet actions (3, 27, 40) are covered only by unit tests on
the stub village door. Stub scenarios play the narrative and schedules end to end (`campaign/narrative/narrative-scenario.test.ts`,
`schedules-scenario.test.ts`); with `JA2_DATA_DIR`, `schedule-maps.test.ts` loads every original map's schedules,
`quest-items-original.test.ts` checks the quest action items of the original maps, and `strategic/narrative/save-import.test.ts`
imports the native saves' facts, quests and profiles.

---

## 15. Kept quirks, limitations and open questions

**Kept quirks of the original** (each described where it applies): computed facts write back and direct readers see the last
evaluation; the talk context is never cleared (§1.3, §1.4); silent quest restarts and ends, Alma's history-less quest 8 (§2.2,
§2.1); `PABLO_BRIBED` inverts `PABLOS_BRIBED`, action 109 is unimplemented and a bribe never wears off (§1.3, §3.13);
`LARGE/SMALL_AMOUNT_OF_MONEY` never cleared, `PACOS_KILLED` set by wounding (§1.2); `FACE_NORTH` faces north-west, 133 can
trigger records 14 and 15, 124 continues after record 27, the unreachable "one wounded" branch of 162, Willis zeroing Vince's
balance, the wisdom-only liar choice (§3.2, §3.3, §3.6); `ENABLE_CAMBRIA_DOCTOR_BONUS` 48–71 h, `DELAYED_MAKE_BRENDA_LEAVE`
6 h (§3.7, §3.9); the ice-cream truck's body-type profile id, the overwritten quote record (§4.6); the schedule "enter sector"
flags-byte bug, the past-dated midnight wrap, the stuck walked departure, the corner teleport (§5.3, §5.4); a second schedule
event and redrawn default schedules after a native load (§5.6); `gsRobotGridNo` never set (§4.5); Kingpin's later money check
on the loaded world (§11.4); damaged goods left at gridno 2 in an unloaded Drassen (§11.2); unsigned hospital refunds, strict
vs inclusive 9 tiles, double-counted supply markers (§3.11, §11.3); Slay's `HEAD_4` accepted by the head check (§1.3);
brass knuckles legal in the ring (§7.3); the electric trap's breath `3 + 1000·PreRandom(3)` (§8.3); `InitNPCs` drawing for
every placement (§4.2); the hourly Skyrider payment taking all the money (§4.4).

**Limitations in ja2-node** (not yet ported; most have a deviation entry): door busy window
(deviation "Doors"); the A10 map changes of the basement trip ("Rebel basement"); decapitation
("Corpses"); the museum and fuel move refusals ("Strategic move refusals"); other action items and hand-operated switches
("Map items"); `CivilianGroupChangesSides` callers ("Building owners"); the head-miner attack rule and firing back out of
combat ("Implications of an attack"); civilian ground vehicles ("Ground vehicles"); the helicopter map pieces ("Helicopter on
the map"). Also: `MakeNPCGrumpyForMinorOffense` (§6.4, "NPC draws first and minor offenses"); the guard-room run (`OL:1282-1294`,
§11.1, "Guard room run"); the profile move and done-traversal flag of `HandleAITacticalTraversal` (§4.6, "NPC traversal
off the map"); the NPC death history lines and death message ("History writers") and `HandleMurderOfCivilian` (§11.12,
"Civilian murder").

**Inferred, not verified**: the transient requestor and talk globals cannot be saved in the original (no save while a box or
panel is open, §0); the second schedule event after a native load is harmless (§5.6); shop hours are known only while the
dealer's sector is loaded (§5.5); checking Skyrider's monologues per strategic step matches redraw timing (§10.8); a walked
departure ends in an away slot at the next load (§5.3).
