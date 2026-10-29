# 25 — Quests, facts and campaign rules

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`. Short file names: **ID**
`Tactical/Interface_Dialogue.cc`, **Q** `Strategic/Quests.cc`, **NPC** `TacticalAI/NPC.cc`, **SEH**
`Strategic/Strategic_Event_Handler.cc`, **SM** `Strategic/StrategicMap.cc`, **OH** `Tactical/Overhead.cc`, **OL**
`Tactical/OppList.cc`, **DA** `TacticalAI/DecideAction.cc`, **HELI** `Strategic/Map_Screen_Helicopter.cc`, **SIL**
`Tactical/Soldier_Init_List.cc`, **SP** `Tactical/Soldier_Profile.cc`, **BOX** `Tactical/Boxing.cc`, **HU**
`Strategic/Hourly_Update.cc`. JSON files are `data/externalized/*.json`. "(inferred)" marks conclusions not traced end to
end. C integer semantics apply (`idiv`, `u8`/`i8` wraps). `Random`/`Chance` are the `main` stream, `PreRandom` the `pre`
stream (`01` §3.6); `Random(0)` returns 0 without drawing; `Chance(x)` is `Random(100) < x`. Times are world minutes unless
marked; "day d hh:mm" is minute `d·1440 + hh·60 + mm`. `AddFutureDayStrategicEvent(kind, m, p, n)` posts at minute
`(day + n)·1440 + m` (`Strategic/Game_Events.cc:164-169`, so `m ≥ 1440` spills into later days);
`AddSameDayStrategicEvent(kind, m, p)` at `day·1440 + m` (`:159-162`). Profile names (`MIGUEL`, `KINGPIN`, …) are
Stracciatella's internal names; their ids come from `mercs-profile-info.json` (`MIGUEL 57` … `MANNY 155`, vehicles
`PROF_HUMMER 160`, `PROF_ICECREAM 162`, `PROF_HELICOPTER 163`). Sectors are written `C5`; `C5-1` is level 1 below it;
sector comparisons include z (`C5` means z 0) unless marked. Record numbers ("record 13") index an NPC's quote records
(`24`); no record or quote text appears here.

**Scope.** Facts, quests and their rewards, boxing, EPCs and the robot, Skyrider and the helicopter, and the
quest-specific campaign rules. `35` holds what each NPC action does once dispatched, strategic NPC presence, schedules,
civilian groups, keys, locks and door actions (`35` §1–4, `35` §5). `24` owns NPC records and their selection, the talk
interface, the dialogue queue, the dispatch of NPC actions, recruiting (`RecruitRPC`, `RecruitEPC`, releases) and the
"declare hostility" list; `26` meanwhiles, the Queen, Elliot and Joe, the endgame and game over; `21` the laptop (Bobby
Ray's delivery, the Pablo theft rules); `22` contracts (Slay's, Iggy's and EPC departures: §4, §6; Larry: `35` §2.4); `23`
merchants (dealer facts here; Tony's and Devin's presence and shop hours: `35` §2.3, `35` §3.5); `15` the event queue and
handler order; `16` squads, groups, travel, sector transitions; `17` the Queen (`ExecuteStrategicAIAction`); `18` loyalty,
mines, assignments, the hospital assignment; `19` battles, capture, first-battle bookkeeping; `09`/`13` the AI; `07` doors
and pathing; `11` attacks; `33` `StatChange`; `12` items. Agent API (`unescort`, `heliRoute`/`heliCancel`,
`boardVehicle`/`leaveVehicle`, the narrative events and view fields): `29`.

---

## 0. State

**Facts and quests** (save section "quests", `Q:1209-1226`; ja2-node `StrategicState.narrative`, §9.1):

| Field | Original | Notes |
|---|---|---|
| `facts: Uint8Array(500)` | `gubFact[NUM_FACTS]` (`Quests.h:14`, `Q:39`) | a byte per fact id 0..499; values 0/1, and 2 for the two "available to army" facts (§1.1). Computed facts write their result back (§1.3) |
| `quests: Uint8Array(30)` | `gubQuest[MAX_QUESTS]` (`Quests.h:12`) | `NOT_STARTED 0`, `IN_PROGRESS 1`, `DONE 2` (`Quests.h:8-10`) |

**NPC fields of the campaign profile** (save section 5, `Tactical/LoadSaveMercProfile.cc`; the mutable `gMercProfiles[]`;
ja2-node `ProfileProgress`, `src/sim/tactical/profiles.ts`; the record and approach fields are `24`'s, the fields only the
NPC actions, presence and schedules use are in `35`):

| Field | Original | Used by |
|---|---|---|
| `sectorX/Y/Z` | `sSector` (x, y u16 and z i8, `Tactical/LoadSaveMercProfile.cc:83-84, 181`; `bSectorZ` is unused) | presence (`35` §2), facts, escorts, Skyrider; x = y = 0 is nowhere |
| `town`, `townAttachment` | `bTown`, `bTownAttachment` | loyalty facts (§1.3), head miners (`18`) |
| `npcData`, `npcData2` | `bNPCData`, `bNPCData2` (INT8) | per-NPC counters (`35` §2.8) |
| `miscFlags`, `miscFlags2`, `miscFlags3` | `ubMiscFlags` (`RECRUITED 0x01`, `WOUNDEDBYPLAYER 0x08`, `SAID_HOSTILE_QUOTE 0x20`, `EPCACTIVE 0x40`), `ubMiscFlags2` (`DONT_ADD_TO_SECTOR 0x01`, `LEFT_COUNTRY 0x02`, `BANDAGED_TODAY 0x04`, `SAID_FIRSTSEEN_QUOTE 0x08`, `NEEDS_TO_SAY_HOSTILE_QUOTE 0x10`, `MARRIED_TO_HICKS 0x20`, `ASKED_BY_HICKS 0x40`), `ubMiscFlags3` (`PERMANENT_INSERTION_CODE 0x02`, `HANDLE_DONE_TRAVERSAL 0x08`, `NPC_PISSED_OFF 0x10`, `TOWN_DOESNT_CARE_ABOUT_DEATH 0x40`, `GOODGUY 0x80`) | `Tactical/Soldier_Profile_Type.h:25-51`; ja2-node `ProfileMiscFlag`, `ProfileMiscFlag2`, `ProfileMiscFlag3` (`src/sim/campaign/profiles.ts`) |
| `money` | `uiMoney` | NPC cash (Carmen, Darren, Vince, …) |
| `balance` | `iBalance` | owed money, bets, bribes (`35` §1.11), Skyrider's debt (§5.6) |
| `useProfileInsertion`, `insertionCode`, `insertionData` | `fUseProfileInsertionInfo`, `ubStrategicInsertionCode`, `usStrategicInsertionData` | `35` §2.6; escort release (§4.1) |
| `quoteRecord`, `quoteActionId` | `ubQuoteRecord`, `ubQuoteActionID` | pending NPC movement across sector loads (`35` §2.6) |
| `life`, `stats` | `bLife`, `bLifeMax`, … | written back from NPC soldiers when a sector is left (`35` §2.6) |
| `nickname` | `zNickname` | terrorist reveal (`35` §1.6) |
| `lastDateSpokenTo` | `ubLastDateSpokenTo` | shared with `24`; Tony, Devin, Kingpin (`35` §2.3, §1.6) |
| `salary` | `sSalary` | `RECRUIT` zeroes it, Conrad's reduction (`35` §1.3) |
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
  presentation-only highlight flags.

---

## 1. Facts

### 1.1 The store

- `SetFactTrue(f)` (`Q:42-55`): if `f == ESTONI_REFUELLING_POSSIBLE (277)` and the fact was false, first
  `GuaranteeAtLeastXItemsOfIndex(ARMS_DEALER_JAKE, GAS_CAN, 4 + Random(3))` (one `Random(3)` plus the dealer's stock draws,
  `23` §5.4); then `facts[f] = 1`. `SetFactFalse(f)` (`:58-61`): `facts[f] = 0`. Other callers: NPC records (`24`: a
  record's `usSetFactTrue`, `NPC:1734-1737`) and an abandoned EPC's record (`Strategic/Assignments.cc:6848`).
- `CheckFact(f, profile)` (`Q:484-1097`): for the ~120 computed ids of §1.3, recomputes the value, **stores it** in
  `facts[f]` and returns it; any other id returns the stored byte (callers testing truth take any non-zero value, but
  `MIKE/IGGY_AVAILABLE_TO_ARMY` are compared with `== 1`, `Tactical/Soldier_Create.cc:2072-2081`).
- Direct reads bypass `CheckFact`: `gubFact[FACT_QUEEN_DEAD]` (`SIL:503`, `Strategic/Strategic_AI.cc:2336`),
  `gubFact[FACT_PLAYER_KNOWS_ABOUT_BLOODCAT_LAIR]` (`Strategic/Strategic_Movement.cc:3345`), `gubFact[FACT_PC_MARRYING_DARYL_IS_FLO]`
  (`Laptop/Mercs.cc:1155`, `Laptop/Mercs_Files.cc:290`), `gubFact[FACT_TOP/BOTTOM_LEVEL_CLEARED]` (`Q:889`), the two army facts.
  Because computed facts write back, a direct read sees the value of the last `CheckFact` (kept: saves carry those bytes).
- Direct writes: `gubFact[MIKE_AVAILABLE_TO_ARMY] = 2`, `gubFact[IGGY_AVAILABLE_TO_ARMY] = 2` (used once,
  `Tactical/Soldier_Create.cc:2074, 2080`), `gubFact[IGGY_AVAILABLE_TO_ARMY] = TRUE` (`Strategic/Merc_Contract.cc:976`).
- `InitQuestEngine` (`Q:1157-1178`) zeroes both arrays (§2.3).

ja2-node (`src/sim/strategic/narrative/facts.ts`, `check-fact.ts`): `fact(n, id)` tests the raw byte, `factValue(n, id)`
returns it, `setFactTrue(n, id, hooks)` runs the Estoni intercept through `hooks.estoniRefuellingPossible`, `setFactFalse(n,
id)`; `checkFact(ctx, id, profile)` evaluates §1.3 (`isComputedFact(id)` names the computed ids) over a `FactContext` of
ports (soldiers of the loaded sector, towns, mines, boxing, repairs, dialogue, items, the talk context). Native import fills
the store from the decoded save arrays (`importNarrative`).

### 1.2 Stored facts and who writes them

"Records" = set by NPC quote records (`24`; the record data decides when). Facts written only by records (or never) and
read only by records (265/266 also by fact 264), so not in the table: `MIGUEL_FOUND 12`, `LETTER_DELIVERED 13`,
`FOOD_ROUTE_EXISTS 14`, the city liberation facts 0–11 (no code reference at all), `CARMEN_EXPLAINED_DEAL 102`,
`PLAYER_REPAID_KINGPIN 104`, `PLAYER_WANTS_TO_BUY_LEATHER_VEST 118`, `ANGEL_SOLD_VEST 115`, `KINGPIN_INTRODUCED_SELF 255`,
`KROTT_GOT_ANSWER_NO 195`, `VINCE_EXPLAINED_HAS_TO_CHARGE 148`, `SKYRIDER_HINT_GIVEN 358`, `FACT_84`, `FACT_132`–`134`,
`FACT_281` (Darren's rules explained, read by `NPC:1413`, `24`), `TOP_LEVEL_CLEARED 265`, `BOTTOM_LEVEL_CLEARED 266`,
`WILLIS_GIVES_DISCOUNT 272`.

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
| 250–252 | `MUSEUM_OPEN`, `BROTHEL_OPEN`, `CLUB_OPEN` | hourly (`HU:95-152`, `35` §2.4) | museum sight rule (`OL:1584`), records |
| 258 | `PC_MARRYING_DARYL_IS_FLO` | T `ID:2458-2461` | M.E.R.C. site (`21`) |
| 267 | `NEED_TO_SAY_SOMETHING` | T `ID:3468-3476` | records, merc dialogue (`24`) |
| 268 | `ATTACHED_ITEM_BEFORE` | T on the first attachment (`Tactical/Interface_Items.cc:1842`) | help text (UI) |
| 269 | `SKYRIDER_EVER_ESCORTED` | T when Skyrider becomes an EPC (`ID:1502`) | records |
| 271 | `WILLIS_HEARD_ABOUT_JOEY_RESCUE` | T `SEH:618` | `ID:3333` |
| 273 | `HILLBILLIES_KILLED` | T when a tactical victory in F10 leaves no living hick (`NPC:2607-2637`) | Keith's prices (`23`), Keith's business (`Strategic/Game_Event_Hook.cc:278`), Queen sector rules (`17`) |
| 274 | `KEITH_OUT_OF_BUSINESS` | T by the event (`Strategic/Game_Event_Hook.cc:276-283`); F `ID:3197-3199`, `NPC:2631-2634` | `HandleShopKeepHasBeenShutDown` (`NPC:2640-2664`) |
| 275, 283 | `MIKE/IGGY_AVAILABLE_TO_ARMY` | 275 = 1 at the 50 % progress mark (`Tactical/Campaign.cc:1308-1311`); 283 = 1 when Iggy leaves through the contract-ending event still owed money (`Strategic/Merc_Contract.cc:966-980`, `22` §4.3); either = 2 once used (`Tactical/Soldier_Create.cc:2068-2083`) | elite upgrade, `Strategic/Queen_Command.cc:558` |
| 276 | `KINGPIN_CAN_SEND_ASSASSINS` | T `SEH:598` | placement overrides (`SIL:463-467`), schedules (`Strategic/Scheduling.cc:697`), assassins (`SM:766`) |
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
| 210 | `ANOTHER_FIGHT_POSSIBLE` | `AnotherFightPossible()` (§3.4) | `:763-765` |
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
| 368 | `PLAYER_KILLED_BOXERS` | !`BoxerExists()` (no soldier at any boxer gridno, §3.4) | `:1081-1083` |

The commented-out case for 43 (`:620-624`) never runs. `FACT_LOYALTY_HIGH` indexes the town by `p.town` again (`:824`), same
value. All rules read the loaded sector only; outside tactical (no loaded world) the soldier-based facts are false.

### 1.4 The talk context

`src`, `dest` and `srcProfile` are set when a conversation starts (`ID:286-297`) and **never cleared** (`ID:153-155`):
records triggered later by proximity, timers or deaths see the last conversation's soldiers. Facts 51, 82, 83, 87, 164,
171, 178, 280, 284, 292, 341, 362 read them, and so do the requestor answers (`35` §1.3). ja2-node keeps them in
`StrategicState.talk.soldiers = {src, dest, srcProfile}` (soldier ids; `srcProfile` starts at 0 like the original's
zero-initialised global), written by `24` when a conversation starts and resolved per call by `NarrativeFlow.talkContext()`;
an id that no longer resolves reads as null. Saved with ja2-node's sessions, empty after a native import (deviations "Talk
context in saves", "Talk context after a load"). Dialogue code calls `NarrativeFlow.checkFact(id, npc)`; tactical rules call
`TacticalState.narrative.fact(id, profile)`, which is `CheckFact`.

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

The history entry carries the quest id in its data field and the sector (`−1/−1` prints "n/a", `21` §6.2). Quests
themselves give no experience, money, loyalty or progress; rewards come from the actions that end them (§2.4).

### 2.3 `InitQuestEngine` and `CheckForQuests`

- `InitQuestEngine` (`Q:1157-1178`), step 2 of `InitStrategicLayer` (`15` §4.3): zero both arrays; `CheckForQuests(1)`;
  `gubCambriaMedicalObjects = sciFi ? 21 : 18`; `gubBoxingMatchesWon = gubBoxersRests = 0`; `gfBoxersResting = FALSE`.
- `CheckForQuests(day)` (`Q:1182-1206`), also the daily 08:00 event `CHECKFORQUESTS` (`15` §2.7): the Lua `OnCheckQuests`
  observer may claim it (no listener ships); if quest 0 is not started: `AddHistory(HISTORY_ACCEPTED_ASSIGNMENT_FROM_ENRICO, 0,
  now, −1/−1)`, then `StartQuest(0, −1/−1)`. At game init `now` is minute 1500 (day 1 01:00), so these two history entries
  open the log; the daily event never does anything afterwards.

### 2.4 Rewards: experience, loyalty, progress, history

- **Experience** (`NPC_ACTION_GRANT_EXPERIENCE_1..5`, `ID:3607-3621`) → `AwardExperienceBonusToActiveSquad(type)`
  (`Tactical/Campaign.cc:1327-1362`): 25, 50, 100, 200, 400 points to every OUR soldier with `bInSector`, on the **current
  squad** (`IsMercOnCurrentSquad`; ja2-node `state.forces.currentSquad`), `life ≥ CONSCIOUSNESS (10)`, not a vehicle or
  robot: `StatChange(EXPERAMT, points, FROM_SUCCESS)` (`33`, draws). Code callers: Kingpin's death while his money quest
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

  Quest loyalty effects run in code: Krott alive (Alma +20, `ID:3437-3443`), terrorists dealt with (+5 everywhere,
  `ID:2718-2720`), the creature queen (+10 everywhere, `OH:2485`), Eldin killed (Balime −20, `OH:2361-2364`), Joey killed
  (Cambria −10, or −20 for Martha's heart attack, `OH:2366-2382`), Doreen killed (Drassen −20 if she had relented, then +10,
  `OH:2403-2418`), rebels betrayed (`ReduceLoyaltyForRebelsBetrayed`, `loyalty.ts`, `35` §4.2).
  `NPC_ACTION_PENALIZE_TOWN_LOYALTY` (11) is commented out (`ID:1793-1794`): a no-op.
- **Progress** (`CurrentPlayerProgressPercentage`, `Tactical/Campaign.cc:1189-1276`) counts income, kills and control only;
  quests do not enter it. The progress milestones go the other way (`35` §2.4).
- **History**: quest start/finish (§2.2), the `NPC_ACTION_HISTORY_*` actions (`35` §1.2) and the entries listed per action.

### 2.5 The quest log in the player view

The original has no quest screen; the player sees quests only as history lines (§2.2). The player view therefore derives
`quests` from the history log, never from `narrative.quests`: one entry per quest with a `QUEST_STARTED` or
`QUEST_FINISHED` line, with its internal name and the start and finish minutes and sectors (`src/server/quest-view.ts`,
`strategic.quests`, `29` §24). A quest started or ended without history (Alma's skip, a silent restart) stays invisible,
as in the original.

---

## 3. Boxing (`BOX`, `Boxing.h`)

### 3.1 Data

Ring in D5 (`BOXING_SECTOR` 5/4/0), room 29, surrounding room 3, boxer start gridnos 11393, 11233, 11073 (`gsBoxerGridNo`),
AI start 11235, ring centre 11237 (`DA:47`). State `bBoxingState`: `NOT_BOXING 0`, `BOXING_WAITING_FOR_PLAYER 1`,
`PRE_BOXING 2`, `BOXING 3`, `DISQUALIFIED 4`, `WON_ROUND 5`, `LOST_ROUND 6` (`Tactical/Overhead_Types.h:300-309`). Saved
globals: §0. `SOLDIER_BOXER` is a soldier status flag. ja2-node keeps the saved globals, the state and the boxer ids in one
record shared by the strategic narrative and the loaded sector (`StrategicState.narrative.boxing` = `TacticalState.boxing`,
with `state`, `boxers` and the unsaved `uiLocked`); native saves import `bBoxingState`, `gBoxer` and `SOLDIER_BOXER`.

### 3.2 A match

1. Entering D5 clears `gBoxer` (`SM:782-787`); `CheckOnBoxers` (`BOX:252-268`) fills empty slots with the weaponless
   soldiers on the boxer gridnos (re-picked only while slot 0 is empty).
2. Darren's records (bets, `35` §1.11; the `DARREN_REQUESTOR`/`FIGHT_AGAIN_REQUESTOR` prompts) lead to `START_BOXING_MATCH`
   (138): a boxer exists → state 1 (`SetBoxingState`: leaving 0 pauses the game, returning to 0 unpauses, `BOX:398-424`).
3. Every step of a soldier in states 1–3 runs `BoxingMovementCheck` (`OH:736-742, 974-980`, `Tactical/Soldier_Ani.cc:526-529`,
   `BOX:381-396`; it runs twice per tile, after `HandleAtNewGridNo` and after `HandleGotoNewGridNo`, harmless). A soldier in
   the ring → count the people in it (`BOX:166-249`, merc-slot order):
   - ≥ 2 player soldiers → `BoxingPlayerDisqualified` on the first of them without the boxer flag (stopped, state 4,
     Darren record 21); if the state was ≤ 2 it then drops to 0;
   - state 1, exactly one person (ours) → state 2 and `PickABoxer` (`BOX:273-305`): the first slot not yet fought, active, in
     sector, ≥ OKLIFE gets `SOLDIER_BOXER`, turns non-neutral, AI reset, marked fought; strength, dexterity, agility and life
     max `+ 5 × gubBoxersRests`, capped at 100; the third boxer gets martial arts if `REGMALE`; already-fought boxers lose the
     flag;
   - state 2, two people, one ours → both get `SOLDIER_BOXER`, state 3, last-won false,
     `EnterCombatMode(team of pInRing[Random(2)])`.

   A boxer stepping out of the ring in state 3 → disqualified, history `DISQUALIFIED_BOXING`, loses the flag.
4. While boxing:
   - `PRE_BOXING`/`BOXING`: action points (`CalcActionPoints` last step, `Tactical/Soldier_Control.cc:411-415`) and the
     carried maximum (`:422-429`) halved.
   - Any boxing state: no interrupts (`Tactical/TeamTurns.cc:954-958`); no sighting enters the best-sighting list
     (`OL:1844-1848`), so a hostile boxer never starts combat by being seen.
   - `CheckForEndOfCombatMode` and `CheckForEndOfBattle` never end combat in state 3 (`OH:4247-4251, 4395-4400`); a battle won
     in another boxing state skips the incapacitated-enemy kill, the militia and civilian reset, the sector control and the
     battle bookkeeping (`OH:4509-4694`); `BeginTeamTurn` stops after the team's `EVENT_BeginMercTurn` when a knock-out there
     decided the round (states 4–6, `Tactical/TeamTurns.cc:333-337`).
   - Non-boxers do nothing in states 2, 3, 5 and 6 (`TacticalAI/AIMain.cc:186-195`), are not in the AI lists
     (`TacticalAI/AIList.cc:119`) and are no threat (`TacticalAI/AIUtils.cc:1842-1846`); `DecideAlertStatus` skips its
     new-situation and changing-orders handling in any boxing state (`DA:3821`); a hostile boxer ending his turn does not turn
     his civilian group (`TacticalAI/AIMain.cc:538-543`); in green, everybody else within 26 tiles of the ring centre only
     turns to face it in any boxing state (`DA:709-722`).
   - The AI boxer walks into the ring in `PRE_BOXING` (`DA:518-550`, `FindClosestBoxingRingSpot`,
     `TacticalAI/FindLocations.cc:1885-1931`), then punches (`DA:2538-2556, 2666-2670`, closing in with `CLOSEPATROL` orders
     for one decision, `DA:3381-3392`). `ReevaluateEnemyStance` at the end of `ManSeesMan` and in `NoticeUnseenAttacker`
     turns an idle enemy to a newly seen merc for one turn AP each time in combat: an AI boxer whose turn starts next to
     three mercs loses 3 AP this way.
   - A PC under AI control is handled by the AI while he carries a quote record or the boxer flag
     (`TacticalAI/AIMain.cc:103-114`) and takes an AI slot (`OH:404-406`).
5. The end: a boxer collapsed for more than one turn (`Tactical/Soldier_Control.cc:5322-5331`) or reduced to life 0
   (`OH:5642-5649`) → `EndBoxingMatch(loser)` (`BOX:89-101`): ours → state 6; else state 5, last-won true,
   `gubBoxingMatchesWon += 1`; → DARREN 22. His records run `HANDLE_END_OF_FIGHT` → `ExitBoxing` (`BOX:35-84`): AI boxers in
   the ring neutral again, our boxers under AI control; each is calmed, `bUnderFire = 0`, and a boxer below OKLIFE or
   OKBREATH gets `max(2·OKLIFE, life)`, breath back and stands up; `DeleteTalkingMenu`; all AI turns end;
   `CheckForEndOfCombatMode(FALSE)` and, when that ended combat, the UI lock until our boxer is out (the original never lifts
   it when our boxer died in the ring; ja2-node lifts it once no living boxer is left, deviation "Boxing UI lock"). The green
   AI walks boxers back to their start gridno or out of the ring (`DA:657-706`; our boxer never to the left of the ring).
   Our boxer out → `TriggerEndOfBoxingRecord` (`BOX:119-147`): UI unlocked, history `WON/LOST/DISQUALIFIED_BOXING` with his
   profile, DARREN 23 or 24, state 0; an AI boxer out of the ring with nobody left in it while disqualified calls it
   without a soldier. On returning to 0 with all three boxers unfought, slot 0 is marked fought (so another fight can be
   offered). Going to the map screen in any boxing state asks to abandon the fight (yes → state 0,
   `Tactical/Interface_Panels.cc:3748-3768`; deviation "Abandoning a fight").
6. Daily (15:00, `35` §2.4) the fought flags reset and the boxers rest after every third win.

### 3.3 Cheating (`OH:5359-5382`)

In state 3, an attacker that is not a boxer, or uses an item other than `NOTHING` or `BRASS_KNUCKLES`: a blade or
punch-class item against a boxer → `BoxingPlayerDisqualified(BAD_ATTACK)` (state 4, Darren record 21); anything else →
state 0 ("open war"), and an attacked civilian boxer is made neutral so the group rules apply. **Brass knuckles used by a
boxer are allowed** (the comment says they disqualify; the condition excludes them: kept).

### 3.4 Facts and records

`ANOTHER_FIGHT_POSSIBLE` (`AnotherFightPossible`, `BOX:325-347`: neither all three nor none of the boxers available, and an
OUR merc in sector with `life > OKLIFE + 5`, not collapsed), `PLAYER_FOUGHT_THREE_TIMES_TODAY` (no boxer available),
`PLAYER_KILLED_BOXERS` (`BoxerExists`: nobody on the three gridnos), `NO_CLUB_FIGHTING_ALLOWED`, `CLUB_OPEN`, Kingpin
"impressed" (250). An arriving enemy group never starts a battle in D5 while boxing (`Strategic/Strategic_Movement.cc:1113-1124`).
`BoxerAvailable` (fact 231) runs `CheckOnBoxers` and may fill `gBoxer` from whatever stands on the three gridnos of the loaded
map; the ids stay valid across sector loads until D5 is entered again (stale ids from another sector still count as boxers).
A Kingpin civilian hurt while the Maria quest is in progress and Maria is in sector sets `MARIA_ESCAPE_NOTICED`, but not while
boxing (`Tactical/Soldier_Control.cc:5462-5470`); `MakeCivHostile`'s Maria rule has the same gate (`OH:2646-2655`).

---

## 4. EPCs and the robot

### 4.1 Recruiting and releasing

Becoming an escort (action 110, `RecruitEPC` `SP:770-813`, `HandleStuffForNPCEscorted`) is `24` §9.3; releasing one
(actions 149/168, `UnRecruitEPC` `SP:816-841`, the player's un-escort) is `24` §9.4; the team change is `24` §9.6. Campaign
additions:
- John and Mary need two free slots (`ID:4255-4265`); `HandleStuffForNPCEscorted` (`ID:1493-1545`) does nothing for MARIA
  and JOEY.
- The player's un-escort comes from the assignment menu's "remove escort" (`Strategic/Assignments.cc:4974-4977`) and from the
  contract ending of an EPC (`Strategic/Merc_Contract.cc:572-575`, unreachable: escorts have no contract), both through
  `UnEscortEPC` (`Strategic/Assignments.cc:6872-6898`; `InternalUnescortEPC` `:6837-6870`). ja2-node: the `unescort`
  command (deviation "Releasing an escort").

### 4.2 Campaign rules for escorts

| Rule | Lines |
|---|---|
| strategic move refused for an EPC whose squad (or vehicle) has no non-EPC (`move-permission.ts` `EPC_ALONE`) | `Strategic/Map_Screen_Interface.cc:3838-3849` |
| strategic move refused for Maria while in C5 | `:3851-3866` |
| tactical exit: lone EPC / abandoning EPCs (`exitSector`) | `16` |
| EPCs cannot use keys, lock picks, charges, examine or force (door menu, `35` §5.2) | `Tactical/Interface.cc:1397-1426` |
| an EPC cannot control the robot | `Tactical/Soldier_Control.cc:8662-8663` |
| a captured EPC dies instead (`19`) | `Strategic/Queen_Command.cc:1185-1191` |
| EPC deaths do not count for the death rate (`22`) | `Strategic/Strategic_Merc_Handler.cc:78-82` |
| arrival triggers: Skyrider at the chopper, John and Mary at the airport, Maria at the leather shop, Joey near Martha (§5.2; §6.5; §6.10; §6.14) | `OH:1867-1927` |

### 4.3 The robot

Quest flow (records of MADLAB, `24`; actions `35` §1.9): the AWOL scientist meanwhile (35 % progress) starts quest 11 and
puts MADLAB and ROBOT into Madlab's alternate-map sector (`26`); he asks for a firearm and a video camera (facts 197, 198);
`MADLAB_GIVEN_GUN`/`…_CAMERA` (191, 192); `READY_ROBOT` (194) → tomorrow 07:00 `ROBOT_READY` (or, after a first destroyed
robot, `ROBOT_READY_SECOND_TIME` with the robot's profile restored) and `ROBOT.sector = MADLAB.sector`;
`MADLAB_ATTACHES_GOOD_CAMERA` (193) → the robot gets Madlab's first gun and becomes an EPC. Its death sets 203, then 206
(`OH:2236-2247, 2320-2330`). `ROBOT_RECRUITED_AND_MOVED` at the next sector entry (`35` §2.5).

The robot joins through `RecruitEPC`, so it is an escort (`MERC_TYPE__EPC`) and every `AM_AN_EPC` rule applies to it except
where `AM_A_ROBOT` is tested first (the strategic move: `ME_ROBOT_ALONE` replaces the escort check); the tactical exit check
counts an uncontrolled robot as an escort.

Control (`Tactical/Soldier_Control.cc:8648-8758`): `ControllingRobot(s)` = s active, not an EPC, ≥ OKLIFE, on our team, on a
squad or in a vehicle, wearing `ROBOT_REMOTE_CONTROL` as head gear, the robot on our team in the same sector, both in the
sector or both between sectors in the same squad or vehicle. The robot's `remoteHolder` is updated on recruit, when someone
puts the remote on (`Tactical/Items.cc:2072`: `PlaceObject` updates it whenever a remote control is placed into any slot of
one of our soldiers; it only takes when he then wears it in a head slot), and around autoresolve and the PBI; it is saved
and re-checked by `CanRobotBeControlled`. Without a controller the robot cannot be ordered (`OH:3799-3806`,
`Tactical/Handle_UI.cc:1647, 4247`), is skipped as "next merc" (`Tactical/Handle_UI.cc:1640-1652`), may not move
strategically alone (`Strategic/Map_Screen_Interface.cc:3830-3836`, `ME_ROBOT_ALONE`) or traverse a map edge (`SM:2083-2090`).
Its interrupt points are the controller's experience − 2, and the controller loses 2 (`Tactical/TeamTurns.cc:1150-1170`).
Repair of the robot is an assignment (`18`).

---

## 5. Skyrider and the helicopter (`HELI`)

### 5.1 State

The helicopter globals of §0 (ja2-node `HelicopterState`, `StrategicState.forces.helicopter`; the vehicle is in the vehicle
list). `InitializeHelicopter` (`HELI:137-176`) resets them at a new game (vehicle id −1, not set up, not airborne, not
returning, not hovering, cost 0, not destroyed, talk state 0, hits 0). Refuel sites (`HELI:80-84`): Drassen airport B13,
gridno 9001, structures from `FIRSTOSTRUCT1`; Estoni I6, gridno 13067, from `FOURTHOSTRUCT1`. `fRefuelingSiteAvailable[i]` =
the site sector is neither enemy controlled nor in enemy airspace, and for Estoni `ESTONI_REFUELLING_POSSIBLE`
(`UpdateRefuelSiteAvailability`, `:614-640`; called at set-up, by action 256, on every sector control change and airspace
update, `Strategic/Player_Command.cc:180, 287`, `SM:2326`; after loading through `LoadStrategicAI`'s `UpdateAirspaceControl`,
`Strategic/Strategic_AI.cc:2463`; the explicit call at `SaveLoadGame.cc:1156` only runs for saves of version ≤ 89).
`gubPlayerProgressSkyriderLastCommentedOn` is saved as a `BOOLEAN` byte but keeps its full value.

### 5.2 Getting the helicopter

`InitNPCs` puts Skyrider in B15, E14, D12 or C16 (alternate map, `35` §2.2). Records make him an EPC (`24` §9.3, quest 17).
The escorted Skyrider stepping closer than 11 tiles to gridno 8842 in B13 (`OH:1871-1887`) stops, sets
`SKYRIDER_CLOSE_TO_CHOPPER`, triggers SKYRIDER 15 (which un-recruits him, `24` §9.4) and runs
`SetUpHelicopterForPlayer(B13)` (`HELI:647-657`): once, add the `HELICOPTER` vehicle in B13 (`AddVehicleToList`), give it a
movement group, update the refuel sites. While the helicopter stands at a refuel site in the loaded sector, the map shows it
(six structure pieces, mercs within 5 tiles bumped, `HELI:1146-1189`) and Skyrider's profile is put in that sector
(`HandleHelicopterOnGround`, `HELI:972-1022`, called on every sector load, `SM:463, 501, 520, 872`); otherwise the pieces
are removed and Skyrider's profile sector is cleared (his soldier removed unless on our team). Before set-up the helicopter
"is" at Drassen (`HELI:1024-1040`). ja2-node does not place the pieces (gaps "Helicopter on the map", "Profile sectors
of Skyrider and the helicopter").

### 5.3 Flying

- `CanHelicopterFly` (`HELI:345-363`) = vehicle exists, pilot available (`IsHelicopterPilotAvailable`, `:365-396`: Skyrider
  not owed money and Drassen loyalty not low per §1.3's Skyrider rule), not returning to base, and `CanHelicopterTakeOff`
  (airborne, or its sector not enemy controlled, `:1127-1144`). Mercs may board only while it can fly (`OKUseVehicle`,
  `Tactical/Vehicles.cc:858-861`).
- Plotting (map screen, `Strategic/MapScreen.cc:7250-7290`): refused with the reason quote (owed money, returning, grounded,
  disloyal, `:7293-7325`); empty while mercs stand in its sector → a one-time hint box (`gfSkyriderEmptyHelpGiven`), no
  plot; else his greeting quote and `SKYRIDER_USED_IN_MAPSCREEN`. Confirming (`:7339-7391`): destination without known
  enemies → progress at least 25 points above the last comment → "going well" quote, at least 10 below → "going badly" (both
  store the progress), else the confirmation; known enemies → the warning quote. The route is the group's path (`16`: 100
  per sector left in friendly airspace, 1000 in enemy airspace); confirming takes off (`TakeOffHelicopter`, `HELI:447-455`;
  `Strategic/MapScreen.cc:5514`) even with an empty route (a click on the helicopter's own sector makes it airborne in
  place). Rerouting in flight cancels first, which turns it back and, when no time has passed, lands it in the sector it
  left (`HandleHeliEnteringSector` with never-left: no SAM fire and no bill, but hovering, the arrival quote, payment and
  landing as usual). The agent's `heliRoute` replaces plotting and confirming (deviation "Helicopter interface").
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
  4. end of the path: start hovering (§5.4); no enemies or returning → if passengers or not returning: arrival quote, stop
     compression; then pay (§5.6); enemies and not returning → abort quote, stop compression; a refuel site is the nearest
     available one and this sector → land.
- Passengers leave by joining a squad in the sector while it hovers or stands (`RemoveSoldierFromHelicopter`, `HELI:178-197`,
  `Tactical/Squads.cc:150-165`; not while flying or returning, although the squad menu's `PreChangeAssignment` takes a
  passenger out anyway, deviation "Leaving the helicopter in flight"). The first passenger to start a new squad makes that
  squad "arrive" from the helicopter's previous sector (`PlaceGroupInSector`), which sets its insertion code; a passenger
  dropped outside the loaded sector gets `INSERTION_CODE_GRIDNO` 10125 at the airport and `INSERTION_CODE_CENTER` elsewhere
  (`SetSoldierExitHelicopterInsertionData`). A battle in a sector where the helicopter stands empties it into a foot group
  (`Strategic/PreBattle_Interface.cc:1213-1221`).

### 5.4 Hovering

`StartHoverTime` (`HELI:458-469`): hovering, start minute, event `HELICOPTER_HOVER_TOO_LONG` at now + 10. Its handler
(`:471-490`): still hovering → event `…_WAY_TOO_LONG` at start + 20, quote, stop compression; else reset the start. The second
handler (`:492-508`): reset; still hovering → quote; if the sector holds no enemies, everyone out into a foot group
(`MoveAllInHelicopterToFootMovementGroup`, `:659-697`: one new squad; the first passenger's insertion code copied to the
rest); then return to base.

### 5.5 Returning, landing, refuelling

`MakeHeliReturnToBase` (`HELI:1417-1442`): at an available refuel site → land; else path to the nearest refuel site
(`FindClosestRefuelSite`: shortest `FindStratPath`, available ones first, any as a last resort with a "no safe landing zone"
message, `:298-338`), returning, not hovering; stop compression. `LandHelicopter` (`:399-422`): grounded, not hovering, not
returning, map pieces added; if it cannot fly again (enemies, debt, disloyalty) → everyone out; else the KILL_CHOPPER meanwhile
is scheduled once (`HandleKillChopperMeanwhileScene`, `26`). The helicopter has no fuel model.

### 5.6 Paying Skyrider

`PaySkyriderBill` (`HELI:1344-1385`) at the end of a flight with a cost: enough money → ledger `PAYMENT_TO_NPC −cost`; else pay
what is there (if any) and `SKYRIDER.balance = money − cost` (or `−cost`), owed quote, everyone out, return to base; cost = 0.
The debt grounds him (§5.3) until paid: hourly (`35` §2.4) or by giving him money (`35` §1.11).

### 5.7 Destruction

`SkyriderDestroyed` (`HELI:340-362`): delete the group's arrival event, kill everyone aboard (`KillAllInVehicle`: 100 points
of bleeding damage each, stopping at the first passenger already at life 0; the dead go through the strategic death),
Skyrider's profile life 0, destroyed, his balance and the cost 0, the vehicle removed, id −1. The original runs it from the
crash sound's end callback; ja2-node runs it at once (deviation "Helicopter destruction").

### 5.8 Monologues (`CheckAndHandleSkyriderMonologues`, `HELI:862-903`)

Run whenever the map panel redraws and the pilot is available (`Strategic/MapScreen.cc:4976-4982`); at most one per 1440
minutes since the last:
- talk state 0 → the Drassen SAM monologue (reveals SAM site 2 through its special event; adds the "SAM taken" line if SAM
  2's sector is ours and he has flown, which sets `gfSkyriderSaidCongratsOnTakingSAM`), state 1;
- state 1 → the Cambria hospital monologue if F8 is enemy held; state 2 either way;
- state 2 → once the SAM congratulation was said: the other SAM sites (reveals SAMs 1, 3, 4), state 3;
- state 3 → once Estoni refuelling is available: the Estoni monologue, state 4.

The congratulation is also said when the player liberates a SAM site after the first monologue
(`Strategic/Player_Command.cc:153-161`). The SAM reveals are game state (map knowledge), the highlights presentation.
ja2-node checks the monologues once per strategic step while the flow is `strategic` (deviation "Skyrider monologues";
inferred equivalent to "per redraw").

---

## 6. Quest-specific campaign rules

### 6.1 Sight rules (`ManSeesMan` on a new sighting of an OUR merc, `OL:1530-1770`)

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
| a Kingpin goon losing sight of a merc in the guard room | runs to 13250 (not ported, §10) | `OL:1282-1294` |

The six assassins (JIM, JACK, OLAF, RAY, OLGA, TYRONE) also attack as soon as a PC comes within 8 tiles while they are
neutral (`OH:1934-1955`; the named-NPC AI approaches the closest PC, `DA:607-632`). ja2-node runs the civilian and Iggy rows
from `manSeesMan` before the bloodcat rule.

### 6.2 The airport, Pablo and lost goods (Drassen)

Opening the delivery crate with Pablo's theft undiscovered → the "stuff missing" quote from a nearby merc
(`SayQuoteFromNearbyMercInSector` with a wisdom roll per candidate, `Random(100) > wisdom` excludes him, then `Random(n)`,
`Tactical/Dialogue_Control.cc:1386-1422`) and `PLAYER_FOUND_ITEMS_MISSING`. Attacking Pablo then punishes him (`35` §4.3);
his records return the goods (action 108). `HandleDelayedItemsArrival` (`SEH:346-432`) for the stolen goods (Pablo dead →
nothing): `PABLO_RETURNED_GOODS`, not punished; two random items, each `Random(10)`: 0 → `GASMASK` at `20 + Random(10)` %,
1–2 → `DESERTEAGLE` 40+, 3–5 → `STUN_GRENADE` 70+, 6–9 → two `SW38` 90+, added invisible at the delivery gridno (loaded
sector: pool; else the unloaded sector's items); then the items stored at gridno 1 (`PABLOS_STOLEN_DEST_GRIDNO`) move to the
delivery gridno. For a damaged package the pool at gridno 2 (`LOST_SHIPMENT_GRIDNO`) moves when the sector is loaded, but in
an unloaded sector only items at gridno **1** are moved (`SEH:420-430`): the damaged goods then stay at gridno 2 (kept).

### 6.3 The hospital (Cambria F8)

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
  count back at `gubCambriaMedicalObjects` (18, or 21 with sci-fi) → both stolen facts false; else below that → stolen; at
  most a fifth left → stolen again. In the original, picking the supplies up angers the doctors (`35` §4.4).

### 6.4 Kingpin: his money, his hitmen, his men

- **Money** (`CheckForKingpinsMoneyMissing(first)`, `SEH:476-546`), first called when the player leaves D5-1: total = all
  `MONEY` world items **of the loaded world**. First call: will-learn already set → return; total < 30000 → history
  `FOUND_MONEY`, `KINGPIN_WILL_LEARN_OF_MONEY_GONE`. Kingpin dead → return. Total < 30000: first call → event tomorrow at
  `Random(120)` (fact 103), `KINGPIN.balance = −(30000 − total)`, every money item of the world deleted (the rest of his cash
  vanishes as the player leaves); later call (from that event) → `KINGPIN_KNOWS_MONEY_GONE`, event in 2 days at
  `Random(120)`. The later call also counts the **currently loaded** world's money (kept: with 30000 or more lying in
  whatever sector is loaded, he never finds out; with no sector loaded the total is 0). Then `35` §1.13: the letter and
  quest 4, and two days later the threat (assassins allowed, Spike to C5, Kingpin group 2).
- **Hitmen**: at a town sector entry (`35` §2.5) → `DecideOnAssassin` (`SP:385-412`): candidates from `g_assassin_info`
  (`SP:106-114`: JIM, JACK, OLAF, RAY, OLGA, TYRONE with five towns each) alive, not placed, whose towns include this town;
  `Random(n)` picks one, his sector = the entered sector, `REMOVE_ASSASSIN` at now + `60·(3 + Random(3))`. Each assassin death
  makes the rest tougher (`MakeRemainingAssassinsTougher`, `SP:414-482`: `difficulty = 60/6 · killed`, ×1.3 medium, ×1.6 hard;
  < 14 nothing, < 28 a mini grenade, < 42 hand grenade replacing it, < 56 mustard replacing it, < 70 a LAW replacing it, else
  an extra hand grenade; added to every living assassin's profile). History `ASSASSIN` comes from a record.
- **His men**: the C5 placement override (`35` §2.6), no schedules (`35` §3.2), the brothel door rules (`35` §5.3), the alarm
  (`35` §4.2), the guard-room sight rules (§6.1), Maria (§6.5). Kingpin's death: `KINGPIN_DEAD`, quest 4 ends with
  experience, `ExecuteStrategicAIAction(KINGPIN_DEAD)` (`17`).
- **Boxing and bets**: §3; `35` §1.11.

### 6.5 San Mona: the brothel, Maria, Angel and Kyle

- Madame's money rules (`35` §1.11) count girls paid for in `npcData`; actions 124–134, 217–220 run her lines; actions
  129–132 unlock the girls' doors. The entry/exit tracking (`ACTION_ITEM_ENTER/EXIT_BROTHEL`) is commented out in Gold
  (`TileEngine/Explosion_Control.cc:1693-1786`): no code sets facts 88, 95, 237.
- **The sex action item** (`TileEngine/Explosion_Control.cc:1818-1890`), out of combat, an OUR merc stepping from another room
  onto the item tile, a "miniskirt" civilian (`HookerInRoom`) in that room: stop; for item tiles 13414, 11174, 12290 the door
  13413 / 11173 / 12290 is closed by a door-closer action, action 122 (presentation), the merc teleported to the nearest free
  spot within 2 of 13413 / 11173 / 12291 and stood up, morale event `MORALE_SEX`, `FatigueCharacter` four times. On a room
  tile the code does not list, the item only stops the merc.
- **Action items in ja2-node.** Our soldiers stepping on a tile set off its armed pressure action items and pressure
  switches (`SetOffBombsInGridNo` from `HandleAtNewGridNo`, skipped while mercs walk off the map; enemies and items placed
  by the player are ignored); a switch sets off the remote action items on its frequency (`SetOffBombsByFrequency`). The
  queue runs at the start of the next overhead pass with sight disallowed and keeps the AI and `isIdle` busy; at its end
  sight comes back, a non-player trigger is freed, and a changed door makes all teams look and our mercs reveal roofs.
  Performed: `ACTION_ITEM_CLOSE_DOOR` (the room item's door and any map's door closers), `KINGPIN_ALARM`, `SEX` and
  `MUSEUM_ALARM`; the other action items, and switches operated by hand (`ActivateSwitchInGridNo`, with it
  `ACTION_ITEM_TOGGLE_PRESSURE_ITEMS`), stay inert (gap "Map items"). The museum alarm calls Eldin while sight is
  disallowed, so his line-of-sight test fails and he always runs to the spot (the "I hate you" branch is dead from the
  alarm); the alarm's "zap" clears the disabled flag, so it can ring again.
- **Maria**: quest 6 by records; escort (§4); a Kingpin goon seeing her or a Kingpin civilian turning hostile or being hurt
  while she is in sector → `MARIA_ESCAPE_NOTICED` (§1.2); she cannot leave C5 strategically (§4.2); in the leather shop (room
  2 of C6) with Angel there → ANGEL 12 (`OH:1891-1900`, and by sight §6.1); ending quest 6 zeroes Madame's counters.
- **Angel**: the vest requestor (144) and his money rule; the deed (147) dropped at 12541 for Kyle; Kyle's $10000 pickup
  (123) and record 11.

### 6.6 Terrorists, Carmen and Slay

- Placement (`35` §2.2), files (154), heads: a head item comes from decapitating a corpse with a knife
  (`Tactical/Rotting_Corpses.cc:1183-1229`): CHRIS → `HEAD_2`, T_REX `HEAD_3`, SLAY `HEAD_4`, DRUGGIST `HEAD_5`, ANNIE `HEAD_6`,
  TIFFANY `HEAD_7`, anyone else `HEAD_1`. ja2-node has no decapitation (gap "Corpses").
- Carmen counts terrorists left and heads held (156), leaves (157/158 with a 10 000 ms timer), returns at 04:00 to C13 paying
  $10000 per head (`35` §2.3), and ends the quest when none are left (159 → `35` §2.5). Carmen roams C5/C13/G9 daily.
- Every terrorist death makes the rest tougher (`MakeRemainingTerroristsTougher`, `SP:303-383`: remaining = living placed
  terrorists, Slay excluded while on our team; `difficulty = 60/total · killed`, ×1.3/×1.6; same item ladder as the
  assassins, added to their profiles); Elgin's death → MANNY 10 if Manny is in sector and conscious (`OH:2341-2350`).
- Slay: attacked while neutral → record 1 unless `FACT_155`; seen by Carmen → Carmen hunts him; his death while Carmen hunts
  → CARMEN 29 (`OH:2225-2235`); recruited (`RecruitRPC`, `24`) → a 7-day contract and his wheelchair kicked out
  (`SP:700-706`); leaves when alone (`Chance(15)` hourly) or when his week ends (`35` §2.4).

### 6.7 Chitzena's chalice and Balime's museum

`MUSEUM_OPEN` 09:00–18:00 (`35` §2.4); Eldin's sight rule (§6.1); the museum alarm item → klaxon and `CallEldinTo(gridno)`
(`TacticalAI/Knowledge.cc:86-123`: Eldin, in sector, ≥ OKLIFE, green or with a fading noise: sees the spot → "I hate you"
trigger, new situation; else a loud noise there, red alert, walk to it unless already doing so with the alarm known;
`MUSEUM_ALARM_WENT_OFF`); leaving the sector clears the alarm fact; a merc in L12 rooms 22–41 cannot leave strategically while
Eldin lives and anyone of ours carries the chalice (`ME_MUSEUM`, `Strategic/Map_Screen_Interface.cc:3805-3817`; not in
ja2-node, gap "Strategic move refusals"); any sector entry with the chalice in a merc's inventory sets `CHALICE_STOLEN`
(`35` §2.5); Yanni's records (185) and loyalty (§2.4); killing Eldin costs Balime loyalty.

### 6.8 Tixa, Alma and the army's profiled soldiers

- Tixa (J9): liberated → only kids remain among unprofiled civilians; the Warden is never neutral; messing with a door near
  the Warden alerts her (`35` §5.3); `DYNAMO_IN_J9` and Matt's records; Dynamo freed by recruiting or killed (quest 18).
- Alma prison: capture (`19`); POW release on entering the prison sector ends quest 8 with experience 3 (`SM:1001-1006`);
  Krott's requestor and loyalty boost.
- Mike and Iggy: 50 % progress makes Mike available; Iggy appears in C5 at 70 % and becomes available to the army when he
  leaves our team unpaid (`22`); the first eligible elite placement becomes the profiled soldier (`35` §2.6; also in
  `TacticalCreateEnemySoldier` and the autoresolve creation); their deaths reduce the garrison (`queen-command.ts`).

### 6.9 The hicks and Daryl's marriage (F10)

Night hostility (§6.1), the cow rule (`35` §4.3), owned items (`35` §4.4), victory in F10 with no living hick →
`HILLBILLIES_KILLED` and Keith back in business (`NPC:2607-2637`, called on a tactical victory, `OH:4682`). The marriage
prompt (226, `35` §1.3) and `HAVE_MARRIED_NPC_LEAVE_TEAM` (227, `ID:2438-2468`): the merc is `DARYL.npcData`'s profile
(soldier must exist, and dest): `MARRIED_TO_HICKS`, history `MERC_MARRIED_OFF`, FLO → `PC_MARRYING_DARYL_IS_FLO`, morale
`MORALE_MERC_MARRIED`, `UpdateDarrelScriptToGoTo` (`NPC:2667-2695`: a free gridno near the merc excluding his tile, radius 5
then 10, written into DARREL's record 10 destination and record 11's required gridno and trigger NPC — a record-data
mutation, `24`), → DARREL 10, the merc moves to the personnel "other" list (`21`). Action 262 (from records) then turns the
merc into a profileless civilian. `HICKS_MARRIED_PLAYER_MERC` comes from records and calms the hicks.

### 6.10 Joey and Martha (Cambria)

Action 136 puts Joey in D4-1 and, 3 days later at the same minute, moves him to C5 unless he is dead, escorted or no longer in
D4-1 (while his soldier is in the loaded sector the move is retried every 60 minutes). Escorted into G8 (Cambria) and near
Martha (`JOEY_NEAR_MARTHA`) → he stops, → JOEY 10 (`OH:1903-1912`); his un-recruit from record 9 places him in room gridno
18326 (he has no placement in Cambria). Joey killed: Martha closer than 10 tiles or with line of sight → MARTHA 17 and
Cambria −20, else −10 (`OH:2366-2382`). The Willis discount follows by events (139, 271, 272).

### 6.11 Doreen and the children (Drassen)

Records free the kids (117 → tomorrow 07:00 `KIDS_ARE_FREE`; the kids' bodies are then skipped in C13, `35` §2.6) and boost
loyalty (10). Killing Doreen: loyalty (§2.4), `DOREEN_HAD_CHANGE_OF_HEART`, quest 20 ends, and if the kids are not free yet,
action 117 runs at once (`OH:2403-2418`).

### 6.12 Profile-specific death effects

`HandleNPCTeamMemberDeath` (`OH:2262-2445`): every profiled death marks the profile dead with life 0 and adds history
`MERC_KILLED_CHARACTER` (killer on our team) or `NPC_KILLED` (not for vehicles or tanks); a visible profiled civilian prints a
message. Civilian-team cases: BRENDA (`OH:2305-2316`, fact, HANS 10 if Hans is within 12 and neutral), PABLO (second
attendant), ROBOT, the terrorists, the assassins, ELDIN, JOEY, DYNAMO, KINGPIN, DOREEN (all above), QUEEN
(`BeginHandleDeidrannaDeath`, `26`); then `HandleMurderOfCivilian` for every civilian but crows and cows (`18`, `OH:2427-2433`).
Our-team deaths (`OH:2221-2250`): SLAY (Carmen), ROBOT (facts 203/206, 202 false). ja2-node runs these before the experience
awards (and for our team when the skull is released): the history line through the narrative port's `addHistory` right
after the profile is marked dead, the civilian cases (`src/sim/tactical/narrative/death-rules.ts`), then
`HandleMurderOfCivilian` through the sector hook `murderOfCivilian` (`src/sim/campaign/civilian-murder.ts`, `18` §2.5);
the death message is the server's `soldierDied` line (`src/server/message-entries.ts`).

### 6.13 Vehicles

The hummer: Dave (GERARD) sells it (requestor 169, his money rule with $10000, records, 211 → `OK_USE_HUMMER` in 24 h),
`DAVE_HAS_GAS` daily, `FILL_UP_CAR` (202). The ice-cream truck moves with Hamous daily (`35` §2.3), `OK_USE_ICECREAM` from
records, the placement quirk (`35` §2.6). Boarding is gated by `OKUseVehicle` (`Tactical/Vehicles.cc:847-866`); ja2-node
boards only vehicles already on our team (gap "Ground vehicles").

### 6.14 John and Mary (the tourists)

Escorted together (`24` §9.3, quest 19). In B13 (the Drassen airport) each step of an escorted John or Mary, or of any OUR
merc while quest 19 runs (`OH:1867-1927`), checks the arrival: Mary only if John is dead (`OH:1631-1657`): within 40 of
gridno 8228 and no closest PC farther than 8 (no PC at all passes) → `MARY_OR_JOHN_ARRIVED`, she stops, → MARY 13; John
(`OH:1660-1697`): within 40 of 8228, the same PC test and, if Mary is alive, her soldier within 8 of him → the fact, both
stop, → JOHN 13 with Mary present, else JOHN 12. Their record 13 un-recruits them with both profiles leaving the map
(`24` §9.4). John's gift shipment (188) arrives through Bobby Ray's delivery with Kulba's email (`21`).

### 6.15 Smaller rules

`RecruitRPC`'s quest parts (`24` runs it, `SP:685-768`): Slay's week and wheelchair (§6.6), the end of quest 18 for Dynamo
(§6.8), IRA's record 0 (queued, `SP:746-750`), history `RPC_JOINED_TEAM`. Father Walker's daily move and drunkenness
(`35` §2.3); Rat leaves after 236 at 04:00; Devin, Micky, Bob, Gabby, Tony, Carmen, Hamous placement (`35` §2.2–2.3);
Larry's relapses (`35` §2.4); Conrad leaves H13 on exit with his fact; Elliot healed on entering P3 (`35` §2.5); Manny's
bartender position (210); Brenda stationary (248) and patient timer (121); bloodcats: quest 13, fact 168 (two days), 259
(I16 cleared), the lair fact from records; `REBELS_HATE_PLAYER` and `MIGUEL_READ_LETTER` feed the town loyalty start (`18`).

---

## 7. Determinism

### 7.1 Draws, in order

| Where | Draws | Stream |
|---|---|---|
| `SetFactTrue(ESTONI_REFUELLING_POSSIBLE)` the first time | `Random(3)` and the dealer stock draws (`23`) | main |
| Sector entry (`35` §2.5; §6.4) | head miners, then assassin `Random(10 + militia)` (if eligible) and `DecideOnAssassin` `Random(n)`, `Random(3)` | main |
| NPC system events (`35` §1.13; §6.2; §6.4) | Kingpin `Random(120)`; Pablo's goods 2 × (`Random(10)`, `Random(10)`); damaged package `Random(100)`; Pablo's death `Random(60)` | main |
| Boxing (§3.2) | `Random(2)` for the first team | main |
| Helicopter (§5.3) | per sector entered: SAM `PreRandom(100)` (if covered and working), notice `PreRandom(100)` (if enemies are unknown), quote `Random(2)` (cosmetic stream in ja2-node, deviation "Cosmetic draws of the helicopter") | pre, fx |
| "Stuff missing" quote (§6.2) | `Random(100)` per candidate, `Random(n)` | main |

Every path draws in statement order (the exception, the Kingpin goon gridno, is `35` §2.6).

### 7.2 Wall-clock dependencies and their replacements

| Original | ja2-node |
|---|---|
| Carmen's departure waits a 10 000 ms customizable timer (`ID:2708-2709`) | 10 000 ms of tactical game time (deviation "Carmen's departure timer") |
| The helicopter is destroyed when the crash sound ends (`HELI:1101-1112`) | at once (deviation "Helicopter destruction") |
| `HandleNPCTriggerNPC` waits 500 ms for the radio locator (`ID:1419-1437`) | `24` |
| Skyrider's monologues run on map panel redraws (`HELI:862-903`) | once per strategic step while the flow is `strategic` (deviation "Skyrider monologues") |
| The sex screen's time warp at its end (`JAScreens.cc:478-483`) | at the action (deviation "Brothel time warp") |
| Boxing bell, klaxons, crash and lock sounds, map highlights | presentation events only |

---

## 8. Data tables and stubs

### 8.1 Externalized data (`data/externalized/`)

`strategic-fact-params.json` (Hans 13523, Spike 9817), `mercs-profile-info.json` (names ↔ ids, types),
`shipping-destinations.json` (delivery sector and gridno), `game.json` (`progress.event_*_min`, `pablo_wont_steal`),
`strategic-mines.json` (head miners), `strategic-map-sam-sites*.json` (SAM sectors, air control), `script-records-NPCs.json`
(the externalized records, `24`).

### 8.2 Transcribed tables

`data/tables/narrative.json` (`tools/transcribe/narrative.ts`; regenerate, never edit) holds the fact ids and names
(`Strategic/Facts.h:5-337`, including the unnamed `FACT_38` … `FACT_281`; the `FACT_` prefix is dropped unless the rest is a
number), the quest ids and names (`Strategic/Quests.h:43-74`), the NPC profile ids (`Tactical/Soldier_Profile.h`), the NPC
action codes and names (`Tactical/Interface_Dialogue.h:85-342`), Larry's items and bars (`HU:154-167, 210-217`) and the
schedule actions and flags (`Scheduling.h:10-41`). The code constants are checked against it (`fact-ids.ts`, `npc-ids.ts`,
`npc-actions/codes.ts`, `larry.ts`, `schedule-state.ts`). The history codes come from `data/tables/merc-contracts.json`
(`22`). Everything else is a named constant with an `@src` header in its module: assassin towns (`presence.ts`,
`SP:106-114`), refuel sites (`helicopter-state.ts`, `HELI:80-84`), boxer gridnos and ring rooms (`boxing-state.ts`,
`Boxing.h:6-14`), quest gridnos and rooms (the action and rule modules), experience amounts, hospital prices, distances and
money thresholds.

### 8.3 Original data (read at run time, never committed)

NPC quote records (`24`); map files (placements, action items); `prof.dat` (initial profile sectors, towns, inventories,
`npcData`); native saves: the quests section, the profiles' NPC fields (section 5), the general-info fields of §0.

### 8.4 Stubs

The stub pack (`32` §1.5) carries invented narrative content: NPC profiles and records (`stubs/profiles.json`,
`stubs/npc/records.json`); a stub club D5 (`stubs/maps/d5.map.txt`: a hall in room 3 with the ring in room 29 at the
original's tiles, three unarmed boxers on the boxer gridnos via a `body=<n>` soldier flag) with a club owner at profile 87
whose records run 135, 138 and 205. The helicopter and the robot are tested on synthetic states.

---

## 9. Implementation in ja2-node

### 9.1 Modules

All files carry the SFI-SCLA header. `sim` modules are deterministic and read the content through ports.

| Module | Responsibility |
|---|---|
| `src/sim/strategic/narrative/facts.ts` | `NarrativeState` (`StrategicState.narrative`): facts, quests, the boxing record, the hospital account, `cambriaMedicalObjects`, Joey/Mike globals, `profiledEnemyAdded`, the guide-description countdown; `setFactTrue`/`setFactFalse`, quest status, `importNarrative` |
| `fact-ids.ts`, `npc-ids.ts`, `history-codes.ts` | ids, checked against `data/tables/narrative.json` and `merc-contracts.json` |
| `check-fact.ts`, `economy-facts.ts` | `CheckFact` (§1.3) over `FactContext` ports; the strategic inputs (loyalty, towns, mines, bloodcats, enemies) |
| `quests.ts`, `rewards.ts` | §2.2–§2.4: start/end with history, `InitQuestEngine`, `CheckForQuests`; experience and NPC loyalty rewards |
| `npc-events.ts`, `kingpin.ts`, `hospital.ts` | `35` §1.13 handlers (event 27); §6.2 goods; §6.4 money; §6.3 prices, refund and supplies |
| `presence.ts`, `profiled-enemies.ts`, `save-import.ts` | `ChangeNpcToDifferentSector`, profile items, toughening, assassins (`35` §2.1; §6.4; §6.6); the Mike/Iggy upgrade (`35` §2.6; §6.8); native import of the narrative globals |
| `src/sim/tactical/narrative/` `sight-rules.ts`, `assassin-approach.ts`, `death-rules.ts`, `escort-arrival.ts`, `team-change.ts` | §6.1, the 8-tile assassin rule, §6.12, the arrivals of §4.2, `ChangeSoldierTeam` |
| `boxing.ts`, `boxing-state.ts`, `boxing-events.ts`; `src/sim/tactical/ai/decide-boxing.ts` | §3; the boxing hooks sit in the overhead, animation, points, turns, death, barrier, hit, sight and AI modules |
| `quest-items.ts`, `wheelchair.ts`, `robot.ts`, `port.ts` | §6.5 action items; the kick-out (animation code 482); the robot's tactical rules; `NarrativePort` (`TacticalState.narrative`, deviation "Narrative port") |
| `src/sim/strategic/forces/helicopter-state.ts`, `helicopter.ts`, `vehicles.ts`, `helicopter-events.ts`; `src/sim/strategic/economy/vehicle-assignment.ts` | §5; boarding, `CanCharacterVehicle`, `OKUseVehicle`, `SoldierMustDriveVehicle` |
| `src/server/quest-view.ts` | §2.5 |

### 9.2 Wiring

- `src/sim/campaign/narrative/narrative-flow.ts` (`NarrativeFlow`): the campaign's facts and quests, `checkFact` with the
  talk context, events 4, 27, 28, 34, 63, 67, sector entry and exit quest code (`35` §2.5), death hooks (Dynamo, Kingpin,
  Doreen), the placement narrative; `NarrativeSlots` connect it to the dialogue code (desire to talk, once-per-convo reset,
  records with an approach, `NPCReachedDestination`, NPC actions), the Kingpin money and hospital supply checks and the D5
  boxer reset.
- `npc-action-flow.ts` (`NpcActionFlow`): the campaign side of the catalog (requests in the prompt slot, fades, Carmen's
  timer, boxing, meanwhile actions through `meanwhile-actions.ts`); `recruit-flow.ts` (`RecruitFlow`): `RecruitRPC`,
  `RecruitEPC`, `UnRecruitEPC`, `HandleStuffForNPCEscorted`, the marriage's team change; `quest-world.ts`, `fact-world.ts`:
  the world inputs of facts, the delivery sector and the medical cost.
- `src/sim/campaign/narrative-port.ts`: the tactical `NarrativePort` in campaigns, event 36 and the strategic clock behind
  `TacticalState.scheduleClock`, event 41; `helicopter-flow.ts` (`HelicopterFlow`): events 29/30, the hourly debt payment, the
  monologue check per strategic step, the KILL_CHOPPER meanwhile, deaths aboard, the helicopter commands;
  `robot-control.ts`: `ControllingRobot` and the remote holder.
- `24` provides: the talk context (§1.4); record conditions calling `checkFact` and the quest-status encoding; record effects
  calling `setFactTrue`, `startQuest`/`endQuest` with the loaded sector; `TriggerNPCRecord`/`TriggerNPCWithGivenApproach`,
  `PCsNearNPC` (with `PC_NEAR`), `PCDoesFirstAidOnNPC` (with `BANDAGED_TODAY`), the hostile-quote list,
  `SetQuoteRecordAsUsed`, `RecruitRPC`, `GetInfoForAbandoningEPC`, the record mutation of `UpdateDarrelScriptToGoTo`,
  `ResetOncePerConvoRecordsForAllNPCsInLoadedSector`, the named-NPC AI's conversation part (`DA:556-603`) and the record
  save sections.
- Outside a campaign (sandbox, unit tests) the tactical narrative port is off: every fact false, quests not started, no
  records (deviation "Narrative port").

### 9.3 Verification

The oracle (`tools/oracle/README.md`, sections "Facts and NPC presence", "Boxing", "Helicopter", "Recruiting") runs the
original's functions on native saves and new games and compares them with ja2-node, draws replayed on both streams: probe
scripts `facts.txt`, `boxing.txt`, `heli.txt`, `recruit.txt`. A stub scenario plays the narrative end to end
(`campaign/narrative/narrative-scenario.test.ts`); with `JA2_DATA_DIR`, `quest-items-original.test.ts` checks the quest action
items of the original maps and `strategic/narrative/save-import.test.ts` imports the native saves' facts, quests and profiles.

---

## 10. Kept quirks, limitations and open questions

**Kept quirks of the original** (each described where it applies): computed facts write back and direct readers see the last
evaluation; the talk context is never cleared (§1.3, §1.4); silent quest restarts and ends, Alma's history-less quest 8 (§2.2,
§2.1); `PABLO_BRIBED` inverts `PABLOS_BRIBED`, Slay's `HEAD_4` accepted by the head check (§1.3);
`LARGE/SMALL_AMOUNT_OF_MONEY` never cleared, `PACOS_KILLED` set by wounding (§1.2); brass knuckles legal in the ring (§3.3);
Kingpin's later money check on the loaded world (§6.4); damaged goods left at gridno 2 in an unloaded Drassen (§6.2);
strict vs inclusive 9 tiles, double-counted supply markers (§6.3); unsigned hospital refunds (`35` §1.11); the hourly
Skyrider payment taking all the money (`35` §2.4).

**Limitations in ja2-node** (not yet ported; each has an entry in `gaps.md`): decapitation ("Corpses"); the museum and
fuel move refusals ("Strategic move refusals"); other action items and hand-operated switches ("Map items"); civilian
ground vehicles ("Ground vehicles"); the helicopter map pieces ("Helicopter on the map"); the guard-room run
(`OL:1282-1294`, §6.1, "Guard room run").

**Inferred, not verified**: checking Skyrider's monologues per strategic step matches redraw timing (§5.8).
