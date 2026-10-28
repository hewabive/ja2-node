# 35 — NPC actions, presence and schedules

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `V` = vanilla `Build/`. Short file names:
**ID** `Tactical/Interface_Dialogue.cc`, **NPC** `TacticalAI/NPC.cc`, **SEH** `Strategic/Strategic_Event_Handler.cc`, **SM**
`Strategic/StrategicMap.cc`, **OH** `Tactical/Overhead.cc`, **OL** `Tactical/OppList.cc`, **SCH** `Strategic/Scheduling.cc`,
**DA** `TacticalAI/DecideAction.cc`, **HELI** `Strategic/Map_Screen_Helicopter.cc`, **SIL** `Tactical/Soldier_Init_List.cc`,
**SP** `Tactical/Soldier_Profile.cc`, **KEYS** `Tactical/Keys.cc`, **HD** `Tactical/Handle_Doors.cc`, **HU**
`Strategic/Hourly_Update.cc`. JSON files are `data/externalized/*.json`. "(inferred)" = not traced end to end. C integer
semantics (`u8`/`i8` wraps). `Random`/`Chance` = `main` stream, `PreRandom` = `pre` stream (`01` §3.6); `Random(0)`
returns 0 without drawing; `Chance(x)` = `Random(100) < x`. Times are world minutes unless marked. "In n days at m",
"tomorrow at m" = `AddFutureDayStrategicEvent(kind, m, p, n)`, minute `(day + n)·1440 + m`
(`Strategic/Game_Events.cc:164-169`; `m ≥ 1440` spills into later days); "same-day event at m" =
`AddSameDayStrategicEvent(kind, m, p)`, minute `day·1440 + m` (`:159-162`). Profile names (`MIGUEL`, `KINGPIN`, …) are
Stracciatella's internal names, ids from `mercs-profile-info.json` (`MIGUEL 57` … `MANNY 155`, vehicles `PROF_HUMMER 160`,
`PROF_ICECREAM 162`, `PROF_HELICOPTER 163`). Sectors: `C5`; `C5-1` = level 1 below it; comparisons include z (`C5` = z 0)
unless marked. Record numbers index an NPC's quote records (`24`); no record or quote text appears here.

**Scope.** What each NPC action does once dispatched (§1), strategic NPC presence (§2), schedules (§3), civilian groups
and hostility (§4), keys, locks and door actions (§5). Siblings: `25` facts, quests, boxing, EPCs, the robot, Skyrider,
quest-specific campaign rules; `24` profiles, records, dialogue, the **dispatch** of actions (`NPCDoAction` queueing,
`NPCGotoGridNo`, `NPCReachedDestination`, `TriggerNPCRecord`, `HandleNPCTriggerNPC`, record-level
`TELEPORT_NPC`/`REMOVE_NPC`), `RecruitRPC`, the "declare hostility" quote list; `26` meanwhile and endgame actions (§1.10).
Also: `15` event queue and handler order, `16` sector transitions, `07` doors and pathing, `09`/`13` AI (§3.3 fills the
`DecideActionSchedule` hook); `22` delegates Slay, Larry and Iggy here (§2.4), `23` Tony's and Devin's presence (§2.3) and
shop hours (§3.5); `29` the `door` command and the `npcRequest` decision.

---

## 0. State

- Profile fields (`sectorX/Y/Z`, insertion, `quoteRecord`/`quoteActionId`, `npcData`/`npcData2`, `money`, `balance`, the
  misc flags, `life`/stats, `nickname`, `salary`, inventory): `25` §0; what the counters mean per NPC: §2.8.
- Saved: `fCivGroupHostile[20]` in the tactical status (§4.1); `KeyTable[64]` (save section "key table") and the per-sector
  door tables (map temp files, `07`; §5.1); the schedules of the loaded sector (save section "schedules", §3.6).
- Not saved (transient; inferred safe because the talk panel or message box that holds them cannot be saved through):
  `ubRecordThatTriggeredLiePrompt` (`ID:166`), `gusDialogueMessageBoxType` (`ID:4157`), `gubNiceNPCProfile`/
  `gubNastyNPCProfile` (`ID:156-157`), `gfProfiledEnemyAdded` (one elite upgrade per load, §2.6) and
  `guiPabloExtraDaysBribed` (`SEH:30`, never incremented anywhere: dead). ja2-node saves an open request with the campaign
  (deviation "NPC requestors").

---

## 1. The NPC action catalog (`HandleNPCDoAction`, `ID:1571-4063`)

### 1.1 Entry point and conventions

- `HandleNPCDoAction(npc, code, record)` runs one action at once. Records reach it through `24`'s queue (`NPCDoAction`
  posts a dialogue event, `ID:1185-1210`; a negative `sActionData` runs before the record's quotes, a positive one after
  them or on arrival at its destination); code paths call it directly (§1.12). `record` (the causing record) is read by
  Skyrider's, Joey's and John/Mary's un-recruit and by the lie prompt.
- Codes 501–649: turn soldier(npc) toward soldier(code − 500) (desired direction, only if it differs, `ID:1576-1590`);
  500 = `TURN_TO_FACE_NEAREST_MERC` (`ID:2054-2071`); 650 is unhandled.
- `params = getNpcActionParams(code)`: gridnos and amounts from `tactical-npc-action-params.json`; the code's defaults
  (`params->getGridNo(7887)`) equal the JSON (`ID:1592`).
- Notation: "soldier(x)" = the soldier of profile x in the loaded sector (most actions return silently without it); "→ R n" =
  `TriggerNPCRecord(npc, n)` (queued, considered with `TRIGGER_NPC`, `NPC:2107-2124`, `24`); "→ X n" triggers NPC X's
  record n; "menu" = `DeleteTalkingMenu()` (closes the talk panel, `24`).
- Unhandled codes only log (`ID:4057-4059`): 11 `PENALIZE_TOWN_LOYALTY`, 109 `SET_PABLO_BRIBE_DELAY` (never implemented,
  also missing in V), 141 `DARREN_GIVEN_CASH`, 142 `ANGEL_GIVEN_CASH`, 201 `GERARD_GIVEN_CASH`, 203 `JOE_GIVEN_CASH`, 228
  `KINGPIN_GIVEN_MONEY` (the money rules of §1.11 test these codes), 150 `TELEPORT_NPC` (handled by the record dispatch,
  `NPC:1874-1879`, `24`), 204 `TRIGGER_ELLIOT_9_OR_10`. Explicit no-ops: 30, 31, 259, 260, 261, 292 (the strategic AI runs
  them through `ExecuteStrategicAIAction`, `17`), 152, 163, 182.

### 1.2 Generic actions

| Code | Action | Effect | Lines |
|---|---|---|---|
| 1 | `DONT_ACCEPT_ITEM` | nothing (the record code returns the item, `24`) | `ID:1596-1598` |
| 2 | `FACE_CLOSEST_PLAYER` | soldier: `quoteRecord = record`, `quoteActionId = TURNTOWARDSPLAYER`, AI every frame (the named-NPC AI turns and calls `PCsNearNPC` within 8 tiles, `DA:556-583`) | `ID:1676-1691` |
| 3 | `OPEN_CLOSEST_DOOR` | menu; `NPCOpenThing(door)` (§5.6) | `ID:1693-1710` |
| 27 | `OPEN_CLOSEST_CABINET` | menu; `NPCOpenThing(non-door)` | `ID:2959-2974` |
| 40 | `GET_ITEMS_FROM_CLOSEST_CABINET` | cancel AI action, `PENDING_ACTION`, clear non-interruptible animation flags; pick up **all** items at gridno 6968 (ARMAND) or the nearest openable non-door | `ID:2976-3004` |
| 5 | `THREATENINGLY_RAISE_GUN` | first usable gun (not in hand) swapped into the hand and readied toward the facing tile; falls through to 500 | `ID:2034-2052` |
| 500 | `TURN_TO_FACE_NEAREST_MERC` | turn toward `ClosestPC` | `ID:2054-2071` |
| 6 | `LOWER_GUN` | hand item auto-placed in the inventory; the profile inventory slot of that gun moves to the new slot (one gun) | `ID:1712-1755` |
| 7 | `READY_GUN` | ready the hand item toward the facing tile | `ID:1757-1767` |
| 8, 9 | `START/STOP_RUNNING` | `fUIMovementFast` on/off | `ID:1769-1787` |
| 10 | `BOOST_TOWN_LOYALTY` | `25` §2.4 table | `ID:1789-1791` |
| 12 | `STOP_PLAYER_GIVING_FIRST_AID` | `ReceivingSoldierCancelServices` | `ID:1796-1804` |
| 13 | `FACE_NORTH` | desired direction **NORTHWEST** (screen north) | `ID:1806-1815` |
| 14–20 | `FACE_NORTH_EAST` … `FACE_NORTH_WEST` | desired direction `NORTH + (code − 14)` | `ID:1817-1832` |
| 4 | `RECRUIT` | `salary = 0`, then as 23 | `ID:1834-1837` |
| 23 | `RECRUIT_WITH_SALARY` | menu; team full → message; else `RecruitRPC(npc)` (`24`; its quest side effects in `25` §6.15) | `ID:1839-1854` |
| 22 | `BECOME_ENEMY` | civ group → `CivilianGroupMemberChangesSides` (§4.2); a profiled soldier ≥ OKLIFE joins the hostile-quote list (`24`) | `ID:1856-1880` |
| 24 | `CLOSE_DIALOGUE_PANEL` | menu | `ID:1882-1884` |
| 21 | `TRIGGER_FRIEND_WITH_HOSTILE_QUOTE` | menu only (the hostile-friend logic is disabled) | `ID:1886-1890` |
| 25 | `ENTER_COMBAT` | civ group still neutral → changes sides; no group → `MakeCivHostile`; menu; not in combat → `EnterCombatMode(team)` | `ID:2648-2672` |
| 166 | `END_COMBAT` | `ExitCombatMode` | `ID:2726-2728` |
| 167 | `BECOME_FRIENDLY_END_COMBAT` | menu; neutral; recompute opponent counts; no civilian fought → `fEnemyInSector = FALSE`; no enemy → exit combat; cancel AI; Slay in a wheelchair → 42 at once; else stand up | `ID:2730-2761` |
| 26 | `TERRORIST_REVEALS_SELF` | `nickname = name` in the profile and the soldier (deviation "Terrorist names") | `ID:2763-2775` |
| 41 | `INITIATE_SHOPKEEPER_INTERFACE` | unless `HandleShopKeepHasBeenShutDown` (Keith out of business → KEITH 11; Keith's town loyalty low → KEITH 7, `NPC:2640-2664`): menu; open the shop (`23` `openShop`) | `ID:3578-3586` |
| 103–106 | `TRAVERSE_MAP_EAST/SOUTH/WEST/NORTH` | `quoteActionId = TRAVERSE_*`; the NPC walks off that edge and its profile sector moves one step (§2.6) | `ID:1938-1984` |
| 111, 244, 245 | `DRINK_DRINK_DRINK`, `DRINK_WINE`, `DRINK_BOOZE` | `npcData += 1 / 2 / 4` (drunk at ≥ 5, `25` §1.3) | `ID:2221-2223, 3588-3594` |
| 119 | `REPORT_BALANCE` | message with `−balance` | `ID:2173-2175` |
| 197–200 | `MAKE_NPC_FIRST..FOURTH_BARTENDER` | `npcData = 1..4` | `ID:3445-3456` |
| 210 | `CHANGE_MANNY_POSITION` | MANNY: `PERMANENT_INSERTION_CODE`, insertion `GRIDNO` 19904, `useProfileInsertion`; soldier `STATIONARY`; menu | `ID:3729-3743` |
| 248, 255 | `MAKE_BRENDA_STATIONARY`, `MAKE_MIGUEL_STATIONARY` | if the soldier exists: the same with its current gridno | `ID:3745-3771` |
| 240 | `CANCEL_WAYPOINTS` | `orders = ONGUARD` | `ID:3693-3701` |
| 264 | `REMOVE_NPC` | end the AI turn, drop as a target, remove the soldier, profile sector → nowhere, `CheckForEndOfBattle(TRUE)` | `ID:3861-3873` |
| 262 | `REMOVE_MERC_FOR_MARRIAGE` | the soldier moves to the civilian team with no profile and civ group 0; profile sector → nowhere (`25` §6.9) | `ID:3830-3842` |
| 39, 44 | `PLAYER_SAYS_NICE/NASTY_LATER` | `NEED_TO_SAY_SOMETHING`; remember dest's profile (`24`) | `ID:3468-3476` |
| 232 | `INVOKE_CONVERSATION_MODE` | no talk panel → start a conversation with the closest PC, approach `NPC_INITIAL_QUOTE` (`24`) | `ID:3543-3565` |
| 50–54 | `GRANT_EXPERIENCE_1..5` | `25` §2.4 | `ID:3607-3621` |
| 265–291, 294 | `HISTORY_*` | one history entry with that code, data 0, the loaded sector (`GOT_ROCKET_RIFLES`, `DEIDRANNA_DEAD_BODIES`, `BOXING_MATCHES`, `SOMETHING_IN_MINES`, `DEVIN`, `MIKE`, `TONY`, `KROTT`, `KYLE`, `MADLAB`, `GABBY`, `KEITH_OUT_OF_BUSINESS`, `HOWARD_CYANIDE`, `KEITH`, `HOWARD`, `PERKO`, `SAM`, `FRANZ`, `ARNOLD`, `FREDO`, `RICHGUY_BALIME`, `JAKE`, `BUM_KEYCARD`, `WALTER`, `DAVE`, `PABLO`, `KINGPIN_MONEY`, `ASSASSIN`) | `ID:3877-3970` |
| 242, 243 | `SHOW_TIXA`, `SHOW_ORTA` | `SetTownAsFound`; history `DISCOVERED_TIXA/ORTA` | `ID:3006-3013` |

### 1.3 Requestors: actions that ask the player (`ID:2144-2171`, `4163-4505`)

Each closes the talk panel and opens a yes/no box (`StartDialogueMessageBox`) only if `npc` is dest's profile (else an
error log); 221 and 226 skip the check (`ID:2388-2394, 2432-2436`). The answer runs `DialogueMessageBoxCallBack` with
`ubProfile = dest.profile` (226 also reads `src.profile`). ja2-node: an `npcRequest` decision in the campaign's prompt slot
(`PromptKind.NPC_REQUEST`, `state.battle.prompt`), opened inside or outside a talk session, answered with `answer`
(`29` §16, deviation "NPC requestors"); the shown amount is computed when the box opens, as `StartDialogueMessageBox`
formats it.

| Code | Request | Shown | Yes | No |
|---|---|---|---|---|
| 110 | `ASK_ABOUT_ESCORTING_EPC` | escort prompt (the John/Mary pair wording if the other is alive) | menu; team full → message; JOHN with Mary present and `NumberOfMercsOnPlayerTeam() > lastId(OUR) − 3` → "team full"; else `RecruitEPC(npc)` (`25` §4.1), message with the squad, make that squad current, `HandleStuffForNPCEscorted` (`25` §4.1) | nothing |
| 120, 212 | `ASK_ABOUT_PAYING_RPC(_WITH_DAILY_SALARY)` | hire prompt with `salary` | → R 1 | → R 0 |
| 181 | `REDUCE_CONRAD_SALARY_CONDITIONS` | first `CONRAD.salary = 3300` (`ID:2144-2146`), then the hire prompt | → R 1 | → R 2 |
| 135 | `DARREN_REQUESTOR` | boxing prompt | → R 13 | → R 12 |
| 207 | `FIGHT_AGAIN_REQUESTOR` | boxing prompt | → R 30 | → R 12 |
| 144 | `BUY_LEATHER_KEVLAR_VEST` | vest prompt with the item's price | → R 27 | → R 28 |
| 161 | `MEDICAL_REQUESTOR` | pay prompt: `c = CalcMedicalCost(npc)` (`25` §6.3); shown `refund > c ? 10 : c − refund` | VINCE/STEVE → R 23 | → R 24; both close the menu |
| 162 | `MEDICAL_REQUESTOR_2` | free treatment prompt | `WOUNDED_MERCS_NEARBY` → R 26, else `ONE_WOUNDED_MERC_NEARBY` → R 25 (unreachable: 75 is checked first); VINCE: `giHospitalTempBalance = 0`; STEVE: **`VINCE.balance = 0`** | VINCE → R 34, STEVE → R 30 |
| 169 | `BUY_VEHICLE_REQUESTOR` | pay prompt "$10000" (fixed text) | → GERARD 9 | → GERARD 8 |
| 183 | `KROTT_REQUESTOR` | spare-Krott prompt | → SERGEANT 7 | → SERGEANT 6 |
| 226 | `TRIGGER_MARRY_DARYL_PROMPT` | marriage prompt; on any answer src's profile gets `ASKED_BY_HICKS` | `DARYL.npcData = src.profile`; a key object (key id 38) is auto-placed into Daryl's soldier; → DARYL 11 | → DARYL 12 |
| 221 | `PROMPT_PLAYER_TO_LIE` | yes / no / lie; remembers `record` (`ID:2388-2394`) | → R record+1 | → R record+2. **Lie**: the liar is the first OUR soldier in sector, ≥ OKLIFE, ≥ OKBREATH, replaced by a later one whenever `wis(s) + ldr(s) > wis(liar) + ldr(s)` (`ldr(s)` on both sides: only wisdom decides); `SkillCheck(liar, LIE_TO_QUEEN_CHECK, 0) ≥ 0` → R record+4, else (or no liar) → R record+3 |

### 1.4 Rebels, the letter and the food route

| Code | Action | Effect | Lines |
|---|---|---|---|
| 100 | `GOTO_HIDEOUT` | add an exit grid at gridno 7887 of A10 (map temp file) to A10-1 gridno 12722; every OUR soldier ≥ OKLIFE in sector on the **current squad**: tactical traversal on, group sector = A10-1, the first six get insertion `GRIDNO` 13362, 13363, 13364, 13365, 13525, 13524; `ChangeNpcToDifferentSector(FATIMA, A10-1)`, same for DIMITRI; fade out → load A10-1; in A10's temp file the crate structure moves from 7887 to 8207 and trapdoor debris is added at 7887; fade in → Carlos present → CARLOS 1 at once (`ID:4510-4549`). ja2-node moves the squad and loads at once, without the A10 changes (deviation "Rebel basement", gap "Rebel basement trapdoor") | `ID:1600-1649` |
| 102 | `LEAVE_HIDEOUT` | menu; ignored while a walk-off is pending; **every** OUR soldier ≥ OKLIFE in sector (not just the squad): group sector = A10, the first eight get insertion gridnos 8047, 8207, 8208, 8048, 7888, 7728, 7727, 7567; fade → load A10; clears `ENGAGED_IN_CONV` | `ID:1892-1936`, `4554-4574` |
| 101 | `FATIMA_GIVE_LETTER` | menu; Fatima's `LETTER` handed to Miguel's soldier (`SoldierGiveItem`; ja2-node hands it over at once, deviation "NPC gives an item") | `ID:1651-1674` |
| 113, 114 | `SEND_PACOS_INTO_HIDING`, `HAVE_PACOS_FOLLOW` | Pacos walks to 16028 / 18193, or to the first `FindAdjacentGridEx` tile if the gridno is not a valid destination (`NPCGotoGridNo`, `24`) | `ID:2074-2118` |
| 293 | `PUT_PACOS_IN_BASEMENT` | `PACOS.sector = A10` (z 0, despite the name) | `ID:3965-3967` |
| 112 | `TRIGGER_END_OF_FOOD_QUEST` | history `TALKED_TO_FATHER_WALKER`; NPC system event tomorrow at the same minute (§1.13) | `ID:2136-2139` |
| 155 | `TRIGGER_FATHER_18_20_OR_15` | !`FACT_132` → R 18; else !`133` → R 20; else !`134` → R 15; else R 26 | `ID:2629-2646` |
| 230 | `SEND_ENRICO_MIGUEL_EMAIL` | event tomorrow at `390 + Random(60)` (§1.13) | `ID:3464-3466` |

### 1.5 Airport, shipments and Pablo (Drassen)

| Code | Action | Effect | Lines |
|---|---|---|---|
| 107 | `REPORT_SHIPMENT_SIZE` | say quote 14 if `MEDIUM_SIZED_SHIPMENT_WAITING`, 15 if `LARGE…`, else 13; then if `PABLOS_BRIBED` and `Random(100) < 75`: quote 16 and, if `Random(100) < 75`, quote 21 (quotes, not records) | `ID:1986-2009` |
| 108 | `RETURN_STOLEN_SHIPMENT_ITEMS` | event tomorrow at `480 + Random(60)` (§1.13); if Pablo is not neutral: menu, neutral, bleeding 0, recompute opponent counts, in combat → `CheckForEndOfCombatMode(FALSE)` | `ID:2011-2032` |
| 115 | `SET_DELAYED_PACKAGE_TIMER` | event in 24 h: set `SHIPMENT_DELAYED_24_HOURS` | `ID:2120-2122` |
| 116 | `SET_RANDOM_PACKAGE_DAMAGE_TIMER` | event in 24 h: `HandlePossiblyDamagedPackage` | `ID:2124-2126` |
| 188 | `ADD_JOHNS_GUN_SHIPMENT` | a free Bobby Ray shipment of 2 `AUTOMAG_III` (100 %) and 2 `CLIP762N_5_AP` (quality 5) to the primary destination, `CalculateOrderDelay(2) + 2` days ahead (`Laptop/BobbyRMailOrder.cc:1612-1666`, `21` §5); menu | `ID:3683-3687` |

Pablo's death posts `SECOND_AIRPORT_ATTENDANT_ARRIVED` tomorrow at `480 + Random(60)` (`OH:2317-2319`); its handler puts SAL in
the delivery sector (`SEH:435-442`).

### 1.6 San Mona: Kingpin, the bar, boxing, the brothel, Angel and Maria, Carmen

| Code | Action | Effect | Lines |
|---|---|---|---|
| 137 | `MARK_KINGPIN_QUOTE_0_USED` | `KINGPIN.lastDateSpokenTo = day` | `ID:2255-2258` |
| 229 | `KINGPIN_TRIGGER_25_OR_14` | `KINGPIN_INTRODUCED_SELF` → R 25, else R 14 | `ID:3567-3576` |
| 208 | `TRIGGER_SPIKE_OR_DARREN` | Kingpin in rooms 1–3 (the club) → DARREN 31, else SPIKE 11 | `ID:2942-2957` |
| 249 | `TRIGGER_DARREN_OR_KINGPIN_IMPRESSED` | `BoxerAvailable()` → DARREN 25; falls through to 250 | `ID:3773-3779` |
| 250 | `TRIGGER_KINGPIN_IMPRESSED` | last match won by the player && no boxer available → KINGPIN 15 | `ID:3780-3785` |
| 138 | `START_BOXING_MATCH` | if `CheckOnBoxers()`: menu, bell, clear every `SOLDIER_BOXER`, state `BOXING_WAITING_FOR_PLAYER` (`25` §3) | `ID:2240-2248` |
| 205 | `HANDLE_END_OF_FIGHT` | `ExitBoxing()`; menu | `ID:2885-2900` |
| 206 | `DARREN_PAYS_PLAYER` | closest PC; Darren needs a money slot and an empty slot: `2 × balance` money is created in the empty slot and subtracted from the stash (no check that it suffices); the new pile goes to the PC (slots swapped first if the stash comes earlier) | `ID:2902-2940` |
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
| 122 | `SEX` | `SetPendingNewScreen(SEX_SCREEN)`; the screen's end warps game time by `5 + Random(20)` minutes without event processing (`JAScreens.cc:478-483`); ja2-node warps at the action (deviation "Brothel time warp"); the other effects come from the sex action item (`25` §6.5), which also warps | `ID:2184-2190` |
| 143 | `TRIGGER_ANGEL_17_OR_18` | `ANGEL_SOLD_VEST` → R 18, else R 17 | `ID:2470-2479` |
| 146, 148 | `TRIGGER_ANGEL_16_OR_19`, `…_21_OR_22` | a PC in Angel's room → R 16 / R 22, else R 19 / R 21 | `ID:2481-2501` |
| 246 | `TRIGGER_ANGEL_22_OR_24` | `ANGEL_LEFT_DEED` → R 22, else R 24 | `ID:3596-3605` |
| 145 | `TRIGGER_MARIA` | escape not noticed → MARIA 8; else PC in Maria's room → 9, else 10 | `ID:2503-2519` |
| 147 | `ANGEL_LEAVES_DEED` | Angel's `DEED` to the pool at 12541 (invisible, level 0), out of soldier and profile; menu; queue 149 (un-recruit, retargeted to Maria) and 52 (experience 3); → ANGEL 24 | `ID:2521-2539` |
| 123 | `KYLE_GETS_MONEY` | a $10000 money item, invisible, at 14952 on Kyle's level; Kyle cancels his action, `PENDING_ACTION`, `quoteRecord = 123`, picks it up; when the pickup ends → KYLE 11 (`TacticalAI/AIMain.cc:664-668`) | `ID:2192-2219` |
| 136 | `ADD_JOEY_TO_WORLD` | `JOEY.sector = D4-1`; event in 3 days at the same minute (§1.13) | `ID:2250-2253` |
| 154 | `DECIDE_ACTIVE_TERRORISTS` | add the terrorist files to the laptop (`Laptop/Files.cc:1009-1015`, `21` §6.4); `CARMEN.npcData2 = 0` | `ID:2674-2680` |
| 156 | `CHECK_LAST_TERRORIST_HEAD` | `CARMEN.npcData −= 1` (terrorists left), `npcData2 += 1` (heads held); loaded sector C13 → CARMEN 20, else 21; history `GAVE_CARMEN_HEAD` | `ID:2682-2699` |
| 158 | `CARMEN_LEAVES_FOR_GOOD` | `LEFT_COUNTRY`; falls through to 157 | `ID:2701-2703` |
| 157 | `CARMEN_LEAVES_FOR_C13` | `DONT_ADD_TO_SECTOR`; a 10 000 ms timer (the `amount` param of the running code; 158 falls through with its own, absent, parameters, so always 10 000 ms) → `CarmenLeavesSectorCallback`: loaded C13 → CARMEN 34, G9 → 35, C5 → 36 (`ID:4685-4702`); ja2-node counts tactical game time (deviation "Carmen's departure timer") | `ID:2704-2712` |
| 159 | `CARMEN_LEAVES_ON_NEXT_SECTOR_LOAD` | if `CARMEN.npcData == 0`: `ALL_TERRORISTS_KILLED`, +5 loyalty everywhere; always `CARMEN.money = 0` | `ID:2714-2724` |

### 1.7 Cambria: the hospital, Joey and Martha; the mines

| Code | Action | Effect | Lines |
|---|---|---|---|
| 118 | `CHOOSE_DOCTOR` | Steve and Vince count if in sector, civilian team, neutral, ≥ OKLIFE; both → the one standing at 10343 wins; still both → `Random(2) ≠ 0` drops Steve, else Vince; Steve left → R 12, else R 13 (of `npc`) | `ID:3478-3541` |
| 160 | `TRIGGER_VINCE_BY_LOYALTY` | VINCE owed money → R 21; else !`VINCE_EXPLAINED_HAS_TO_CHARGE` → R 15; else loyalty low → modifier `NORMAL`, R 16; okay → `BREAK`, R 17; else `r = PreRandom(100)`; Vince: (modifier `RANDOM_FREEBIE` or `FREEBIE`, or !`FREEBIE_DECISION_MADE` and `r < 20`) → set decision made; high loyalty && `24_HOURS_SINCE_DOCTOR_TALKED_TO` → `FREEBIE`, R 19, else `RANDOM_FREEBIE`, R 20; otherwise `COST`, R 18. Steve: `WILLIS_GIVES_DISCOUNT` → `COST`, R 21; heard about Joey → `FREEBIE`, R 20; high && 24 h && (`FREEBIE` or (!decision and `r < 20`)) → `FREEBIE`, R 19; else `COST`, R 18 | `ID:3272-3356` |
| 237 | `DOCTOR_ESCORT_PATIENTS` | every OUR soldier in sector with `0 < life < lifeMax`, not yet in hospital, **strictly** closer than 9 to the doctor: `SetSoldierAssignmentHospital`, → (patient's profile) 2, `hospitalPriceModifier = global`, absolute destination cleared; then `FREEBIE_DECISION_MADE` false, global modifier `NORMAL` | `ID:3361-3389` |
| 164 | `START_DOCTORING` | `VINCE_EXPECTING_MONEY` false; stolen supplies → R 28, else R 35 | `ID:3391-3407` |
| 165 | `VINCE_UNRECRUITABLE` | `VINCE_RECRUITABLE` false | `ID:3409-3411` |
| 139 | `ENABLE_CAMBRIA_DOCTOR_BONUS` | event at `(day + 1)·1440 + minute + (24 + Random(24))·60`, i.e. 48–71 h later (enum comment: obsolete) | `ID:2128-2134` |
| 257, 258 | `24_HOURS_SINCE_JOEY_RESCUED`, `…_DOCTORS_TALKED_TO` | event in 24 h setting fact 305 / 306 | `ID:3822-3828` |
| 140 | `MARTHA_DIES` | menu; `EVENT_SoldierGotHit(Martha, 1, 100 damage, 10 breath, her direction, range 320, torso)` (the damage path draws, `33` §2) | `ID:2225-2234` |
| 172 | `START_MINE` | `PlayerSpokeToHeadMiner(npc)`; shut-down mine → `RestartMineProduction` (`18`) | `ID:2788-2800` |
| 173 | `STOP_MINE` | running → `ShutOffMineProduction` | `ID:2802-2811` |
| 174 | `RESET_MINE_CAPTURED` | `ResetQueenRetookMine(npc)` (`mines.ts`) | `ID:2813-2815` |
| 175–179 | `SET_OSWALD/CALVIN/CARL/FRED/MATT_RECORD_13_USED` | `SetQuoteRecordAsUsed(npc, 13)` (`24`) | `ID:2817-2823` |

### 1.8 Alma, Tixa and the south

| Code | Action | Effect | Lines |
|---|---|---|---|
| 180 | `TRIGGER_MATT` | `DYNAMO_IN_J9` → MATT 15; else Dynamo alive → MATT 16 | `ID:2825-2834` |
| 184 | `KROTT_ALIVE_LOYALTY_BOOST` | Krott (SERGEANT) not dead → Alma +20 | `ID:3437-3443` |
| 190 | `TRIGGER_KROTT_11_OR_12` | `KROTT_GOT_ANSWER_NO` → SERGEANT 11, else 12 | `ID:3718-3727` |
| 171 | `START_BLOODCAT_QUEST` | `StartQuest(13)` | `ID:2784-2786` |
| 298 | `TRIGGER_BREWSTER_BY_WARDEN_PROXIMITY` | Warden's corpse within 10 of Brewster → BREWSTER 16, else 17 | `ID:4009-4025` |
| 263 | `TRIGGER_JOE_32_OR_33` | loaded z > 0 → JOE 32, else 33 | `ID:3851-3859` |

### 1.9 Madlab and the robot, vehicles, Chitzena, Balime and the rest

| Code | Action | Effect | Lines |
|---|---|---|---|
| 191 | `MADLAB_GIVEN_GUN` | `MADLAB_EXPECTING_FIREARM` false; still expecting a camera → R 14, else R 18 | `ID:2836-2846` |
| 192 | `MADLAB_GIVEN_CAMERA` | `…EXPECTING_VIDEO_CAMERA` false; still expecting a firearm → R 17, else R 18 | `ID:2848-2858` |
| 193 | `MADLAB_ATTACHES_GOOD_CAMERA` | `MADLAB_HAS_GOOD_CAMERA` false; Madlab's first gun auto-placed into the robot's soldier; `RecruitEPC(ROBOT)` (`25` §4.3) | `ID:2860-2879` |
| 194 | `READY_ROBOT` | event tomorrow 07:00 (§1.13) | `ID:2881-2883` |
| 296, 297 | `TRIGGER_MADLAB_31/32` | team full → menu and message; else MADLAB 31 / 32 | `ID:3987-4007` |
| 211 | `TIMER_FOR_VEHICLE` | event in 24 h: `OK_USE_HUMMER` | `ID:3844-3846` |
| 202 | `FILL_UP_CAR` | the hummer on our team (or the ice-cream truck if no hummer, or if the hummer is full and the truck is ours): fuel `sBreathRed = 10000`, `bBreath = 100` (enum comment: obsolete) | `ID:4027-4051` |
| 256 | `MAKE_ESTONI_A_FUEL_SITE` | `SetFactTrue(ESTONI_REFUELLING_POSSIBLE)` (Jake's gas, `25` §1.1); `UpdateRefuelSiteAvailability()` (`25` §5.1) | `ID:3816-3820` |
| 185 | `TRIGGER_YANNI` | `CHALICE_STOLEN` → YANNI 8, else 7 | `ID:3622-3630` |
| 195, 196 | `WALTER_GIVEN_MONEY(_INITIALLY)` | `WALTER.balance ≥ 20000` (`amount` param) → WALTER 16; else 14 (initially) / 15 | `ID:1556-1569, 4053-4055` |
| 234 | `START_TIMER_ON_KEITH_GOING_OUT_OF_BUSINESS` | `KEITH_GOING_OUT_OF_BUSINESS` event at `now + 6·1440` (§2.7) | `ID:3192-3195` |
| 235 | `KEITH_GOING_BACK_IN_BUSINESS` | `KEITH_OUT_OF_BUSINESS` false | `ID:3197-3199` |
| 213 | `TRIGGER_MICKY_BY_SCI_FI` | sci-fi → MICKY 7, else 8 | `ID:3708-3716` |
| 236 | `MAKE_RAT_DISAPPEAR` | `RAT.npcData = 1` (Rat leaves at the next 04:00) | `ID:3703-3706` |
| 251 | `ADD_RAT` | `RAT.sector = G9` (called by the creatures meanwhile, `26`) | `ID:3787-3790` |
| 295 | `TRIGGER_HANS_BY_ROOM` | src exists: src in room 49 → HANS 18, else HANS 14 | `ID:3971-3985` |
| 42 | `GET_OUT_OF_WHEELCHAIR` | soldier with body `CRIPPLECIV`: menu, animation `CRIPPLE_KICKOUT` (its end makes him `REGMALE`; Slay hostile then raises his gun, `Tactical/Soldier_Ani.cc:3445-3467`; deviation "Wheelchair kick-out") | `ID:3660-3669` |
| 43 | `GET_OUT_OF_WHEELCHAIR_AND_BECOME_HOSTILE` | as 42, then always `TriggerFriendWithHostileQuote(npc)` (`NPC:2517-2565`: one `Random(n)` among the profiled teammates who see an enemy, else action 25) | `ID:3671-3681` |
| 227 | `HAVE_MARRIED_NPC_LEAVE_TEAM` | `25` §6.9 | `ID:2438-2468` |
| 149, 168 | `UN_RECRUIT_EPC`, `SET_EPC_TO_NPC` | `25` §4.1 | `ID:2586-2623` |
| 117 | `FREE_KIDS` | event tomorrow 07:00: `KIDS_ARE_FREE` (§1.13) | `ID:2625-2627` |
| 121 | `DELAYED_MAKE_BRENDA_LEAVE` | menu; same-day event at `minute + 360` (6 h; the comment says a minute): `BRENDA_PATIENCE_TIMER_EXPIRED` | `ID:2177-2182` |
| 186, 187 | `TRIGGER_MARY_OR_JOHN_RECORD_9/10` | Mary's soldier ≥ OKLIFE → MARY 9 / 10, else JOHN 9 / 10 | `ID:3632-3658` |
| 110 … | requestors | §1.3 | |

### 1.10 Meanwhile and endgame actions (`26`)

Listed for completeness; `26` specifies them: 170 `END_MEANWHILE`, 222 `REMOVE_JOE_QUEEN`, 223 `REMOVE_ELLIOT_END_MEANWHILE`,
224 `NO_SCI_FI_END_MEANWHILE` (no sci-fi → end, else → QUEEN 8), 29 `TRIGGER_QUEEN_BY_CITIES_CONTROLLED` (towns excluding Omerta
0/1 → 11, 2 → 7, 3 → 8, 4 → 9, 5 → 10, more → 11), 32 `TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED` (0/1 → 7, 2 → 8, 3 → 9), 215
`TRIGGER_ELLIOT_BY_BATTLE_RESULT`, 216 `TRIGGER_ELLIOT_BY_SAM_DISABLED`, 238 `ELLIOT_DECIDE_WHICH_QUOTE_FOR_PLAYER_ATTACK`, 239
`QUEEN_DECIDE_…`, 28 `SLAP`, 36 `FRUSTRATED_SLAP`, 33–35 `PUNCH_PC_SLOT_0..2` (targets at the interrogation gridnos 7756,
7757, 7758, `Strategic/Queen_Command.cc:50`), 37 `PUNCH_FIRST_LIVING_PC`, 38 `SHOOT_ELLIOT` (creates a Desert Eagle in the
shooter's hand, `ELLIOT.npcData = 17`), 221 the lie prompt (§1.3), 253/254 `ENDGAME_STATE_1/2`, 231 `END_DEMO`. Lines
`ID:2396-2431, 3015-3190, 3201-3270, 3412-3435, 3458-3462, 3792-3814`.

### 1.11 Item and money acceptance with quest effects (`NPC:660-1047`)

`24` runs `NPCConsiderReceivingItemFromMerc`: an enemy NPC except Joe takes nothing; rifles and MGs count as `ANY_RIFLE`;
heads `HEAD_2/3/5/6/7` as `HEAD_2` (`HEAD_4`, Slay's, is not a terrorist head); `MONEY`/`SILVER`/`GOLD` as `MONEY`, setting
`SMALL/LARGE_AMOUNT_OF_MONEY` by `uiMoneyAmount < LARGE_AMOUNT_MONEY`; wine and beer as `ALCOHOL`; `ITEM_POOR_CONDITION` =
status < 50. Per-NPC rules for the first record that wants the item and passes (`NPC:736-938`):

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

ja2-node: `src/sim/narrative/select.ts`, run from the `give` flow, with `CalcMedicalCost` from the hospital code
(`medicalCostAt`, with the per-patient price modifiers), Frank's cash, the cost to date of a paid debt
(`finances.profileCostToDate`) and the `balanceOwed`/`needsMoney` messages. The Vince/Steve chain evaluates
`CheckFact(VINCE_EXPECTING_MONEY)` in each condition, as the original does.

### 1.12 Actions run outside dialogue

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

### 1.13 NPC system events (`EVENT_SET_BY_NPC_SYSTEM`, `SEH:549-691`)

The event parameter is a fact id (< 10000) or `10000 + action` (`NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS`,
`Strategic/Game_Event_Hook.h:74`).

| Param | Posted by | Handler |
|---|---|---|
| 41 `PABLOS_BRIBED` | `SetPabloToUnbribed` with extra days (never) | `SetPabloToUnbribed`: extra days > 0 → repost; else fact 41 false (`SEH:445-457`); no poster exists, so a bribe never wears off (kept) |
| 34 `REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING` | Bobby Ray (`21`) | fact 34 false; `LARGE_SIZED_SHIPMENT_WAITING` → `LARGE_SIZED_OLD_SHIPMENT_WAITING` true |
| 56, 305, 306 | actions 115, 257, 258 | set the fact |
| 103 `KINGPIN_KNOWS_MONEY_GONE` | `25` §6.4 | !103 → `CheckForKingpinsMoneyMissing(FALSE)`; else Kingpin alive: quest 4 not started → email `KING_PIN_LETTER`, `StartQuest(4, D5)`, repost in 2 days at `Random(120)`; quest in progress → `KINGPIN_CAN_SEND_ASSASSINS`, `SPIKE.sector.{x,y} = C5` (z unchanged), `civGroupHostile[KINGPIN] = WILL_BECOME_HOSTILE` |
| 10108 | action 108 | `HandleDelayedItemsArrival` (`25` §6.2) |
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

## 2. Strategic NPC presence

### 2.1 The location model

An NPC exists only as its profile's `sector` (with z) until a sector loads; the placement and profile rules of §2.6 then
create a soldier. Moves write the profile (`ChangeNpcToDifferentSector(p, s)`, `Tactical/Tactical_Save.cc:733-744`:
`LEFT_COUNTRY` overrides the target with nowhere; `useProfileInsertion = FALSE`). Flags: `DONT_ADD_TO_SECTOR` (Carmen while
away; schedules skip his entry, §3.3), `LEFT_COUNTRY`, `PERMANENT_INSERTION_CODE` (fixed profile insertion data: Manny,
Brenda, Miguel, un-recruited EPCs; no schedules are posted for them, §3.2), `useProfileInsertion` + `insertionCode/Data`
(add at a gridno instead of the map placement). Most moves refuse while the NPC's sector is loaded (the 04:00 rules), so a
visible NPC never vanishes.

### 2.2 New game (`InitNewGame`/`InitStrategicLayer`, `15` §4.2–§4.6)

1. `LoadMercProfiles` → `DecideActiveTerrorists` (`SP:246-301`): chance 70/50/30 by difficulty; extra terrorists = 2 + one
   per `Chance(chance)` of two; repeat sweeps over `g_terrorist_infos` (`SP:87-95`: DRUGGIST (preplaced, no sectors), SLAY,
   ANNIE, CHRIS, TIFFANY, T_REX, five candidate sectors each) until enough are placed; per candidate with `sector.x == 0`
   (DRUGGIST is skipped because `prof.dat` places him): `Random(100) ≥ 40` → skip; else `Random(5)` repeated until the sector
   is not used by a terrorist placed in this call; `sector =` it. Then `CARMEN.npcData = gubNumTerrorists = 1 + extra`.
2. `InitAllArmsDealers`, Bobby Ray (`21`, `23`).
3. `InitStrategicLayer`: `SetupNewStrategicGame`; **`InitQuestEngine`** (`25` §2.3: the first history entries, quest 0);
   campaign, squads, vehicles, loyalty, mines (`18`); **`InitNPCs`** (`Strategic/Game_Init.cc:73-116`): the placements of
   `strategic-map-npc-placements.json` in **profile-id order** (`std::map`, `externalized/ContentManager.h:194`): DEVIN 61,
   HAMOUS 63, CARMEN 78, BOB 84 (sci-fi only), MICKY 96, SKYRIDER 97, GABBY 104 (sci-fi only), MADLAB 146. Each (sci-fi-only
   ones skipped without sci-fi) draws `Random(#sectors)` (`externalized/strategic/NpcPlacementModel.cc:32-40`; BOB's single
   sector still draws `Random(1)`), sets `SF_USE_ALTERNATE_MAP` on the pick if `useAlternateMap` (SKYRIDER, MADLAB, GABBY)
   and moves the profile there if `placedAtStart` (SKYRIDER, MICKY, BOB, GABBY). DEVIN, HAMOUS and CARMEN draw for nothing;
   MADLAB only gets his alternate map (his profile moves in the AWOL meanwhile, `26`). Then `gfPlayerTeamSawJoey = FALSE`;
   Tixa J9-1 alternate map without sci-fi; hospital globals 0; `DEVIN.npcData = 3` (he moves at the first 04:00 he is
   eligible). **`InitializeHelicopter`** (`HELI:137-176`) resets every helicopter global (`25` §5.1).

### 2.3 The 04:00 event (`HandleEarlyMorningEvents`, `SEH:693-865`)

In this order (draws in brackets; "not loaded" = the NPC's profile sector is not the loaded sector):

1. Every NPC/RPC profile: clear the three "default response used recently" flags (`24`) and `BANDAGED_TODAY`.
2. `FATHER.npcData = Random(4)` [`Random(4)`].
3. [`Random(2)`] non-zero and neither C13 nor D13 loaded: Father's sector toggles between C13 and D13 (x forced to 13).
4. Tony, if `lastDateSpokenTo > 0` and C5 is not loaded: [`Random(4)`] non-zero → `TONY_NOT_AVAILABLE` false, sector C5;
   zero → true, sector nowhere.
5. Devin, if never spoken to: `npcData += 1`; above 3 and not loaded → `sector = pick` [`Random(5)` over G9, D13, C5, H2,
   C6; the same sector may come again].
6. Hamous, if `life > 0`, neither Hamous nor the ice-cream truck on our team, and not loaded: [`Random(5)` over G6, F12, D7,
   D3, D9] → Hamous **and** `PROF_ICECREAM` to that sector.
7. Rat: `npcData ≠ 0` → sector nowhere.
8. `money(VINCE) = money(STEVE) = money(JENNY) = 0` (`SetMoneyInSoldierProfile`); `VINCE_EXPECTING_MONEY` false;
   `DARREN.balance = 0`, `money(DARREN) = 15000`.
9. Carmen: `DONT_ADD_TO_SECTOR` set → clear it, sector C13; if heads held (`npcData2 > 0`): `money = (money < 10000 ? 0 :
   money) + 10000 × npcData2`, `npcData2 = 0`, every `HEAD_1..HEAD_7` removed from his profile inventory. Otherwise, if not
   loaded: [`Random(3)` over C5, C13, G9] → sector; `money < 5000` → 5000.
10. [`PreRandom(3)`] `== 0` → `DAVE_HAS_GAS` true, else false.
11. The hospital sector F8 loaded → `CheckForMissingHospitalSupplies` (`25` §6.3).

The event runs during the new-game warp (`15` §4.5), so its draws precede the first landing.

### 2.4 Hourly and daily NPC handlers

Hourly, in `HandleHourlyUpdate` order (`15` §3.2; all return while `didGameJustStart`):

- **`HourlyProgressUpdate`** (`Tactical/Campaign.cc:1289-1325`): the first time the highest progress crosses 35 % →
  `HandleScientistAWOLMeanwhileScene` (`26`); 50 % → `facts[275] = 1` (Mike); 70 % → `IGGY.sector = C5` (policy
  `progress.event_*_min`).
- **`HourlyQuestUpdate`** (`HU:95-152`), by world hour: 4 → `BROTHEL_OPEN` false; 20 → true; 15 → `CLUB_OPEN` true,
  `PAST_CLUB_CLOSING_AND_PLAYER_WARNED` false, `gfBoxerFought[0..2] = FALSE`, then boxers resting → stop resting and
  `gubBoxersRests += 1`, else `gubBoxingMatchesWon / 3 > gubBoxersRests` → start resting; 2 → `CLUB_OPEN` false; 9 →
  `MUSEUM_OPEN` true; 18 → false.
- **`HourlyLarryUpdate`** (`HU:154-305`): Larry (`LARRY_NORMAL 46` or `LARRY_DRUNK 47`) on our team, on a squad, not
  between sectors, and not (in the loaded sector while enemies are there or the player is in tactical). Temptation t = that
  of the first carried item of `LarryItems` (`HU:157-167`: `ADRENALINE_BOOSTER` 5/100 points, `ALCOHOL` 4/25, `MEDICKIT`
  4/10, `WINE` 3/50, `REGEN_BOOSTER` 3/100, `BEER` 2/100); below 4, if the balance covers an `ALCOHOL` and his sector is a
  bar (D13, C13, C5, D5, C6, H2): t = 4, "bar". A bar purchase: ledger `TRANSFER_FUNDS_TO_MERC −price`, a 100 % `ALCOHOL`
  into the first empty slot from the hand to the eighth small pocket, which becomes the item used (no free slot: he still
  pays).
  - Sober: `npcData(46) += Random(t)`; ≥ 8 (`LARRY_FALLS_OFF_WAGON`) → bar purchase (if "bar"), `SwapLarrysProfiles`
    (`SP:941-1037`, `LARRY_CHANGED`), `UseKitPoints(item, points)`.
  - Drunk with temptation: `npcData(46) = min(max(npcData, 8) + Random(t), 24)`; bar purchase (if "bar"); use the item.
  - Drunk without temptation: `npcData −= Random(2)`; ≤ 0 → swap back.
- **`HourlyCheckIfSlayAloneSoHeCanLeave`** (`HU:308-328`): Slay on our team, not between sectors, alive, the only OUR merc
  in his sector → [`Chance(15)`] → leave history `SLAY_MYSTERIOUSLY_LEFT`, contract ending without the equipment question
  (`22`).
- **`PayOffSkyriderDebtIfAny`** (`HELI:1387-1415`): owed = `−balance(SKYRIDER)`; owed > 0 and money > 0 → pay
  `min(owed, balance)` (ledger `PAYMENT_TO_NPC`; all the money when it does not cover the debt), message; still owed →
  message and his "owed money" quote.

Daily: **`HandleSlayDailyEvent`** (`SM:2870-2893`) at the end of `MercDailyUpdate` (`22`): Slay on our team, alive, not
`IN_TRANSIT`/POW, `contractEnd / 1440 ≤ day` → leaves as above (he joins with a 7-day contract, `SP:700-706`).

### 2.5 Sector entry and exit

**Entry** (`EnterSector`, `SM:827-905`, before the new map loads): `SetupProfileInsertionDataForCivilians` for the
civilians still in the old world (§2.6); then, unless loading a save, **`HandleQuestCodeOnSectorEntry(new)`**
(`SM:669-799`):

1. `ALL_TERRORISTS_KILLED` → `EndQuest(2, Carmen's sector)`, Carmen's sector → nowhere (every entry, repeatedly).
2. Head miners on the first surface entry of a mine sector (`placeHeadMinersOnSectorEntry`, `18`).
3. !`ROBOT_RECRUITED_AND_MOVED` and the robot on our team → remove the "robot under construction" graphic at `gsRobotGridNo`
   from Madlab's sector temp file (the variable is never assigned in Strac or V: gridno 0, a no-op) and set the fact.
4. Any OUR soldier (anywhere) carrying `CHALICE` → `CHALICE_STOLEN`.
5. Quest 4 in progress, `KINGPIN_CAN_SEND_ASSASSINS`, the new sector belongs to a town, and [`Random(10 + militia in the
   sector)`] `< 3` → `DecideOnAssassin` (`25` §6.4).
6. D5 → `gBoxer[0..2] = none` (`25` §3.2).
7. P3 → Elliot's profile life = max unless he is dead.
8. `ResetOncePerConvoRecordsForAllNPCsInLoadedSector` (`24`; the world is still the old one).

Steps 6 and 7 compare `sNewSector.AsByte()`, so they also run for any level below D5 and P3.

**Exit** (`HandleDefiniteUnloadingOfWorld`, `SM:2902-2953`, when loading a new map and when trashing the world; ja2-node
`SectorFlow.handleDefiniteUnloadingOfWorld`) runs **`HandleQuestCodeOnSectorExit(old)`** (`SM:802-825`) before the temp
files are saved: D5-1 → `CheckForKingpinsMoneyMissing(TRUE)` (`25` §6.4); H13 and `CONRAD_SHOULD_GO` → Conrad's sector
nowhere; F8 → `CheckForMissingHospitalSupplies`; always `MUSEUM_ALARM_WENT_OFF` false. Loading a new map then writes every
non-player soldier's life and stats back into its profile (`UpdateSoldierPointerDataIntoProfile`, `SP:916-940`); trashing
calls `SetupProfileInsertionDataForCivilians` instead.

### 2.6 Putting NPCs into a loaded sector, and taking them out

`PrepareLoadedSector` (`SM:573-660`): civilians (unless an empty mine), militia, bloodcats, creatures, militia prep, virgin
flag, **`AddProfilesNotUsingProfileInsertionData`**, enemies, **`AddProfilesUsingProfileInsertionData`**, **`PostSchedules`**
(§3.2).

`AddPlacementToWorld(node)` (`SIL:412-568`), for a detailed placement with a profile, refuses (returns false, no soldier)
unless the profile's sector equals the loaded sector **including z**, it is neither `RECRUITED` nor `EPCACTIVE`, `life ≠ 0`
and `!useProfileInsertion`. Then the quest overrides (civilian team only):

| Where | Rule | Lines |
|---|---|---|
| ice-cream truck placement | only when "the truck is on our team", tested as `FindSoldierByProfileIDOnPlayerTeam(ICECREAMTRUCK)` — a **body-type value (26, `Animation_Data.h`) used as a profile id**: the A.I.M. merc with id 26; then the placement is skipped (returns true) unless Hamous is in this sector and not recruited | `:436-446` |
| C5, Kingpin group, (`civGroupHostile[KINGPIN] == WILL_BECOME_HOSTILE` or quest 4 in progress with `KINGPIN_CAN_SEND_ASSASSINS`) | unprofiled: gridno = `13531 + u(−7, 7) + u(−7, 7)·160` (two `std::uniform_int_distribution` draws on the shared engine; ja2-node draws them on `main`, x first, deviation "Kingpin's men placement"), orders by [`PreRandom(3)`] `ONGUARD/CLOSEPATROL/ONCALL`; BILLY: `u(−29, 29)` twice, `SEEKENEMY`; MADAME: skipped | `:458-496` |
| P3, not in a meanwhile | Queen dead → Queen's civ group skipped; alive → `gfUseAlternateQueenPosition` puts the Queen at 11448 and every civilian **not** in the Queen's group is skipped (`26`) | `:497-516` |
| J9 (Tixa) liberated | unprofiled civilians other than kids skipped | `:518-529` |
| C13 with `KIDS_ARE_FREE` | kid bodies skipped | `:530-538` |
| enemy elites | `OkayToUpgradeEliteToSpecialProfiledEnemy`: one per load, not for encounter or invasion codes, not on a roof: `facts[275] == 1` → becomes MIKE, set 2; else `facts[283] == 1` → IGGY, set 2 (`Tactical/Soldier_Create.cc:2068-2083`) | `:540-549` |

`AddProfilesNotUsingProfileInsertionData` (`SIL:1714-1730`): every civilian node without a soldier, with a detailed profiled
placement whose profile has `!useProfileInsertion` and `life ≠ 0` → `AddPlacementToWorld` again (catches nodes skipped by
the first pass after a full team).

`AddProfilesUsingProfileInsertionData` (`SIL:1647-1712`): for every NPC/RPC/vehicle profile in content order whose sector is
the loaded one (with z), not recruited or EPC, alive and with `useProfileInsertion`: reuse its soldier or create a civilian
soldier of that profile; set its insertion code/data from the profile and `UpdateMercInSector`; if `quoteRecord ≠ 0`, copy
record and action id and, for `CHECKFORDEST`, call `NPCReachedDestination(…, FALSE)` (`24`); link the soldier to its
init-list node and to that node's schedule.

**Taking NPCs out** (`SetupProfileInsertionDataForSoldier`, `SM:3137-3203`, for every civilian in the old world before a new
sector loads or the world is trashed, for an escort the player releases (`24` §9.4) and for a departing RPC
(`StrategicRemoveMerc`, `22` §4.5); `PERMANENT_INSERTION_CODE` → skip):
- in the sector with a pending record and action: traversal codes → profile one sector on
  (`HandleNPCChangesForTacticalTraversal`, `NPC:2585-2604`; not for scheduled civilians), `useProfileInsertion = FALSE`,
  `HANDLE_DONE_TRAVERSAL` if he has a done-traversal record; other codes → insertion `GRIDNO` at his final destination
  (gridno if there, else the absolute or plain final destination), `useProfile` true, `quoteActionId = action`,
  **`quoteRecord = action`** (the action id overwrites the record: kept);
- in the sector, no pending action → `useProfileInsertion = FALSE`;
- not in the sector → the strategic code with data 0, `useProfileInsertion = TRUE`.

On save (`SaveNPCInformationToProfileStruct`, `Tactical/Tactical_Save.cc:704-728`) every profiled civilian copies
record/action and, unless `DONT_ADD_TO_SECTOR` or permanent, its current gridno as insertion data (ja2-node's own saves keep
the soldiers; only native import uses this).

An NPC walking off the map with a traversal action (`HandleAITacticalTraversal`, `TacticalAI/AIMain.cc:2013-2040`) runs
`HandleNPCChangesForTacticalTraversal` (profile one sector on), marks a done-traversal record and leaves: a scheduled
civilian into an away slot (he may come back, §3.4), anyone else removed. A schedule move reaches it only when the off-edge
extension stops at the world's bounds (§3.3). ja2-node's `handleAITacticalTraversal` (`src/sim/tactical/ai/control.ts`)
does the away slot or removal but not the profile move or the done-traversal flag (limitation, §9).

### 2.7 Other strategic events (`15` §2.7)

| Id | Event | Handler |
|---|---|---|
| 4 | `CHECKFORQUESTS` | `25` §2.3 |
| 27 | `SET_BY_NPC_SYSTEM` | §1.13 |
| 28 | `SECOND_AIRPORT_ATTENDANT_ARRIVED` | `SAL.sector` = the primary delivery sector (`SEH:435-442`) |
| 29, 30 | `HELICOPTER_HOVER_TOO_LONG`, `…_WAY_TOO_LONG` | `25` §5.4 |
| 34 | `DAILY_EARLY_MORNING_EVENTS` | §2.3 |
| 36 | `PROCESS_TACTICAL_SCHEDULE` | §3.3 |
| 41 | `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` | rebels still neutral → `ReduceLoyaltyForRebelsBetrayed`; group → `WILL_BECOME_HOSTILE` (`SEH:867-876`) |
| 63 | `KEITH_GOING_OUT_OF_BUSINESS` | hillbillies alive → `KEITH_OUT_OF_BUSINESS` (`Strategic/Game_Event_Hook.cc:276-283`) |
| 67 | `REMOVE_ASSASSIN` | the assassin's sector → nowhere, profile life = max (`SEH:878-882`) |

### 2.8 Per-NPC counters

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

## 3. Schedules (`SCH`, `Scheduling.h`)

### 3.1 Data

A map stores up to 255 schedules (36 bytes each: 4 skipped, `usTime[4]` (minutes of day, `0xFFFF` = unused), `usData1[4]`,
`usData2[4]`, `ubAction[4]`, id and soldier (overwritten), `usFlags`; `SCH:362-397`; read by `src/content/formats/map.ts`).
Loading assigns ids 1..n in file order; a detailed placement's `ubScheduleID` links it and the created soldier copies it
(`Tactical/Soldier_Create.cc:496, 827`). Removing a soldier deletes its schedule and pending event (`:980`); trashing the
world deletes all schedules and every `PROCESS_TACTICAL_SCHEDULE` event (`TileEngine/WorldDef.cc:2541`, `SCH:84-100`):
schedules exist only for the loaded sector. After n map schedules the counter `gubScheduleID` is n + 1, so the first
default schedule gets id n + 2 (no schedule section: counter 0, first default 1); after a save load, the number of saved
schedules + 1. Some original maps have a placement whose schedule id has no schedule (no schedule, and no default one
either) or two placements naming one schedule (both soldiers point at it; the last poster owns it).

| Action | Data | Meaning |
|---|---|---|
| 1 `LOCKDOOR`, 2 `UNLOCKDOOR`, 3 `OPENDOOR`, 4 `CLOSEDOOR` | data1 = a door at or next to it; data2 = where to go afterwards (a map-edge gridno makes him leave the map) | §3.3 |
| 5 `GRIDNO` | data1 | walk there, patrol from there |
| 6 `LEAVESECTOR` | — | walk to the nearest edge point and leave (away slot; walked in tactical, he gets stuck past the edge, §3.3) |
| 7 `ENTERSECTOR` | data1 | come back from the away slot and walk to data1 |
| 8 `STAYINSECTOR` | — | no runtime handler: its only effect is that the civilian gets no default schedule (`09` §5) |
| 9 `SLEEP` | data1 = bed | walk there and sleep (`AI_ASLEEP`) |
| 10 `WAKE` | — | walk back to the initial gridno |

Flags at run time: `ACTIVE1..4` (`0x10 << i`, the entry being executed), `TEMPORARY 0x100` (default schedules, never
saved); the variance and sleep-conversion flags are editor-only.

### 3.2 Posting (`PostSchedules`, `SCH:916-950`; `PostSchedule`, `:688-800`; `PostDefaultSchedule`, `:868-912`)

`PostSchedules` runs at the end of every fresh sector load (§2.6) and after loading a save (`SaveLoadGame.cc:1038`).
Default schedules need at least one of the map's four entry points (`sNorthGridNo` …). For every init-list node in list
order whose soldier is a civilian: a placement schedule id → `PostSchedule`; else, if defaults are possible and the body is
not `COW`, `BLOODCAT`, `HUMVEE`, `ELDORADO`, `ICECREAMTRUCK` or `JEEP` → `PostDefaultSchedule` (profiled NPCs included: maps
give them `STAYINSECTOR` schedules to keep them home).

`PostDefaultSchedule` (not underground): a new `TEMPORARY` schedule at the head of the list (next id): entry 0 `ENTERSECTOR`
at `420 + Random(61)` to the initial gridno, entry 1 `LEAVESECTOR` at `1080 + Random(121)` (07:00–08:00 in, 18:00–20:00
out, two `main` draws per civilian), then `PostSchedule`.

`PostSchedule(s)`:
1. Kingpin-group civilians without a profile in C5 get no schedule while the group's hostility is non-zero (any level,
   where the placement override of §2.6 needs exactly `WILL_BECOME_HOSTILE`) or quest 4 runs with
   `KINGPIN_CAN_SEND_ASSASSINS` (`SCH:697-701`); no schedule or `PERMANENT_INSERTION_CODE` → return.
2. For every `SLEEP` entry up to the first one without a time: `SecureSleepSpot` (every later civilian, in id order,
   active, in the sector and scheduled, whose first sleep spot equals this one gets the nearest other tile with room for a
   standing soldier from `FindGridNoFromSweetSpotExcludingSweetSpot(…, 3)`, `:1137-1165`); if its time is unset: time =
   `1260 + Random(180)` (21:00–23:59); unless an entry other than sleep starts before noon, add a `WAKE` 8 h later in the
   first empty entry and swap it into the sleep entry's slot (so the wake-up comes first).
3. `pSchedule.soldier = s`; auto-process the past 24 hours: start = `(now − 1439) mod 1440`, end = `now mod 1440`
   (`PrepareScheduleForAutoProcessing`, §3.4).

### 3.3 Processing in tactical

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
`InteractWithOpenableStruct` (`TacticalAI/AIMain.cc:1406-1434, 1746-1777`). Away soldiers (off the map) are visited by the
AI only when `AI_CHECK_SCHEDULE` is set and not in combat (`OH:1057-1069`). ja2-node's away civilians leave the world and
keep only their gridno (deviation "Away civilians").

**Past-dated midnight wrap** (kept, oracle-checked through the event list): `PostNextSchedule` adds the next entry's time to
the start of **today** (`GetWorldDayInMinutes() + usTime`), so an entry past midnight (a default civilian who left at 19:00,
next entry 07:30) lands in the past. The event fires at the next clock step without moving the clock (past events never
do, `Game_Events.cc:73-79`), finds no entry for the current minute and an empty auto-processing window (the last event
query is the current minute) and posts nothing: the schedule stops until the sector or a save is loaded again (one put to
bed in tactical at 22:00 sleeps past his 06:00 wake-up).

**A walked departure never finishes** (kept, both V and Strac): the path end's "close enough" rule (fewer than 4 tiles from
the absolute destination counts as arrived) applies only off schedule (`!ACTING_ON_SCHEDULE`, `AIMain.cc:416`), and the
off-edge extension ends two tiles past the edge tile, so neither `HandleAITacticalTraversal` nor step 2 runs. `RTHandleAI`
re-issues `SCHEDULE_MOVE` to the absolute destination (`Realtime.cc:189-199`), the path from a non-visible tile fails
(`PathAI.cc:598-603`), and the mover waits `REALTIME_AI_DELAY` (one `Random(1000)`) and retries for as long as the sector
stays loaded: invisible, in the sector (`bInSector`, merc slots, counted in `bMenInSector`), not in an away slot, schedule
still active, no next event, new situations ignored while traversing off map. The next load replays the day and puts him
into an away slot (§3.4, inferred). The same holds for a door entry whose data2 is an edge gridno. The away slot of
`HandleAITacticalTraversal` is reached only when the extension stops at the world's bounds (`OutOfBounds`). The unmatched
branch sets `AI_HANDLE_EVERY_FRAME` in `uiStatusFlags` (`:448`), where the bit is `SOLDIER_ATTACK_NOTICED` (kept).

### 3.4 Auto-processing (`PrepareScheduleForAutoProcessing`, `SCH:802-863`; `AutoProcessSchedule`, `:571-686`)

Skipped while loading a save (`:575-582`). With start > end (the 24-hour window always is, unless now is 23:59): apply
every used entry with time ≥ start, then every entry ≤ end, posting the first later entry as the next event; otherwise
apply the entries in [start, end] and post the first later one; nothing posted → post entry 0 tomorrow (if it has a time).
Applying an entry clears `AI_ASLEEP` and teleports the soldier (`EVENT_SetSoldierPositionNoCenter`: to the cell's corner,
not its centre, after `BumpAnyExistingMerc` moves an occupant, away civilians parked on the tile included, to the nearest
reachable spot within 5 where a standing soldier fits, closest to his old tile, `:532-565`):

| Action | Applied as |
|---|---|
| door actions | the door at/next to data1: lock (+ close), unlock, open, close (`ModifyDoorStatus`, `:953-984`); then teleport to data2; an edge gridno → he goes off map (`sOffWorldGridNo = data2`, away slot, `bInSector = FALSE`), else patrol point data2 |
| gridno | teleport to data1, patrol point |
| enter sector | not for a profile with `DONT_ADD_TO_SECTOR` (here tested correctly in flags 2); teleport to data1, back from the away slot, in sector, patrol point |
| wake | teleport to the initial gridno |
| sleep | `AI_ASLEEP`, teleport to data1 |
| leave sector | teleport to the nearest edge point (or stay), `sOffWorldGridNo` = it, away slot, out of sector |

The AI's "enter sector" places the civilian at the cell centre of `sOffWorldGridNo`, which is 0 for a civilian who never
left (kept). `ModifyDoorStatus` (`Tactical/Keys.cc:843-905`) writes only the door status flags; the structure follows at
the next `UpdateDoorGraphicsFromStatus`, run by `SetCurrentWorldSector` right after `EnterSector` (so a load replays doors
in full) and by a save load. Auto-processing on the map screen of a loaded sector thus leaves the structure until the next
load; ja2-node swaps it at once (deviation "Schedule door changes"). `FindNearestEdgePoint`
(`TacticalAI/FindLocations.cc:1771-1797`) tries the four primary edgepoint lists ordered by the tile's screen distance to
each edge (west, east, north, south on ties) and takes the nearest point of the first non-empty list.

Resulting behaviour by mode:
- **Sector not loaded**: nothing happens (no schedule exists). The next load's `PostSchedules` replays the whole past day
  instantly, so each civilian ends in the state of his latest entry (asleep in bed at night, absent after a `LEAVESECTOR`,
  doors locked at night).
- **Compressed time on the map screen**: the events fire with the clock at their stamp (`15` §2.8) and auto-process the
  window since the last event query: the same end state, teleported, never walked.
- **Tactical real time and turn-based combat**: the AI walks (combat suppresses the green decisions, `13`); a walked
  departure stays past the map edge until the next load (§3.3).

### 3.5 Shop hours (`ExtractScheduleDoorLockAndUnlockInfo`, `SCH:1022-1061`)

A dealer opens at his schedule's `UNLOCKDOOR` time and closes at its `LOCKDOOR` time; both must exist (else "no hours":
the original treats it as an error for scheduled people). This feeds `MerchantHooks.shopHours` (`23` §10.4) while the
dealer's soldier is in the loaded sector (inferred: the repair delay reads the soldier's schedule, so hours are known only
while his sector is loaded); ja2-node's `CampaignSim` hook returns `null` otherwise.

### 3.6 Saves

A save stores the non-temporary schedules (max 32, with ids and soldier links, `SCH:452-484`) and the pending events;
loading restores them, then runs `PostSchedules` again without auto-processing (`SaveLoadGame.cc:948-949, 1038`): every
scheduled civilian gets a **second** pending event for its next entry, and civilians whose default schedule was not saved
draw a new one (`Random(61)`, `Random(121)`). Both are kept for native-save import (the second event re-arms the same
entry, inferred harmless); saves written after several loads carry two to four events per schedule, and the saved events
of the dropped default schedules then point at the redrawn ones with the same ids (oracle-checked). Off-map civilians
(`SOLDIER_OFF_MAP`) return to the away slots. ja2-node's own saves restore schedules (temporary ones included) and events
exactly and do not re-post (`SectorFlow.reattachLoadedSector`); native import re-posts as the original
(`SectorFlow.adoptLoadedSector`, gap "Savegame import").

---

## 4. Civilian groups and hostility

Quests hang on the civilian groups (rebels, Kingpin's men, the hicks, the doctors, the Queen's people). `24` owns the
"declare hostility" quote list that turns a flagged civilian hostile after his quote (`AddToShouldBecomeHostileOrSayQuoteList`,
`OL:508-610`).

### 4.1 State

`civGroupHostile[20]` (`fCivGroupHostile`, tactical status, saved; groups `Tactical/Overhead_Types.h:269-290`: `REBEL 1`,
`KINGPIN 2`, `SANMONA_ARMS 3`, `ANGELS 4`, `BEGGARS 5`, `TOURISTS 6`, `ALMA_MILITARY 7`, `DOCTORS 8`, `COUPLE1 9`, `HICKS 10`,
`WARDEN 11`, `JUNKYARD 12`, `FACTORY_KIDS 13`, `QUEENS 14`) with `NEUTRAL 0`, `WILL_EVENTUALLY_BECOME_HOSTILE 1`,
`WILL_BECOME_HOSTILE 2`, `HOSTILE 3` (`:293-296`). A created civilian is neutral unless it is the Warden or its group is
`HOSTILE` (`Tactical/Soldier_Create.cc:221-226`). The AI's civilian tests (`AIList.cc:143`, `DecideAction.cc:1466`) read it.
ja2-node: `StrategicState.civGroups`, shared with the loaded sector as `TacticalState.civGroups`; group ids are
`CivilianGroup` in `src/sim/tactical/soldier.ts`.

### 4.2 Transitions

| Trigger | Effect | Lines |
|---|---|---|
| `CivilianGroupMemberChangesSides(attacked)` (attack, actions 22 and 25, a hick cow attacked) | group members on our team (recruited rebels) go back to the civilian team (first profile picked with `Random(2)` per later candidate); then `CivilianGroupMembersChangeSidesWithinProximity`: every neutral, living, non-cow member that sees the attacker or stands within sight range of the attacked or the attacker → `MakeCivHostile`, the hostile-quote list if it has opponents (a `Random(2)` per later profiled candidate); if the group was `NEUTRAL`: rebels → `ReduceLoyaltyForRebelsBetrayed`; event `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` at now + 300; group = 1 | `OH:2672-2772` |
| that event | rebels still neutral → loyalty hit (never, they are 1 by then); group = 2 | `SEH:867-876` |
| a neutral member sees an OUR merc while the group is ≥ 2 | hostile-quote list | `OL:1549-1556, 1673-1677` |
| the hostile-quote list resolves | every listed neutral → `MakeCivHostile`; a listed member's group at 2 → 3; combat for the civilian team | `OL:566-592` |
| `CivilianGroupChangesSides(group)` (a group's building blown up) | group = 3; every neutral living non-cow member → `MakeCivHostile` (+ quote list); in ja2-node nothing calls it (gap "Building owners") | `OH:2774-2800` |
| Kingpin alarm (action item) | Kingpin group = 3, members seeing an OUR merc hostile, combat | `TileEngine/Explosion_Control.cc:1788-1816` |
| Kingpin's threat (§1.13) | Kingpin group = 2 | `SEH:601` |

`MakeCivHostile(s)` (`OH:2586-2670`): cows never. New side: IRA, DIMITRI, MIGUEL, CARLOS, MADLAB, DYNAMO, SHANK and the
rebel group → `HOSTILE` (against player and army); MARIA and ANGEL while the Maria quest is in progress or done → `HOSTILE`;
anyone else → `ENEMY` (with the army). Not neutral and already on that side → return. Only CONRAD and GENERAL take the new
side (and move to the enemy team); everyone else just stops being neutral and keeps his side (Stracciatella; vanilla
`Overhead.c:3075-3077` also set `bSide`). So rebels stay allied with the army and `MilitiaChangesSides` leaves friendly
militia friendly (they are not neutral, so nothing changes); oracle-confirmed, kept. Kingpin group: Maria quest in
progress, not boxing, Maria in sector → `MARIA_ESCAPE_NOTICED`. BILLY → `FARPATROL`. Neutral → non-neutral, opponent
counts; in combat → added to the battle. Team changes follow the original (gap "Team changes" for the one unhandled
case).

### 4.3 `ProcessImplicationsOfPCAttack` (`OH:5342-5470`), the quest parts

In order: wake a sleeping target; Pablo attacked after the missing items were found → `PABLO_PUNISHED_BY_PLAYER`; boxing
rules (`25` §3.3); friendly militia attacked → `MilitiaChangesSides`; else a neutral civilian Slay ≥ OKLIFE while
!`FACT_155` → SLAY record 1; else a neutral civilian without group and not a vehicle: a cow in F10 → `HickCowAttacked` (the
first neutral hick that sees the attacker changes sides, `OH:2812-2827`); Pablo ≥ OKLIFE, punished, !`FACT_38` → PABLO
record 3; else the hostile-quote list and, unless the profile has `TOWN_DOESNT_CARE_ABOUT_DEATH`, militia change sides;
else: Carmen attacked by anyone but Slay → `AGGRESSIVE`; a group member on our team or neutral →
`CivilianGroupMemberChangesSides` (+ quote if profiled, ≥ OKLIFE and visible); a non-neutral group member that is not a
boxer → proximity rule; our own merc out of combat → no combat. ja2-node runs all of these but the head-miner rule and our
mercs' firing back (gap "Implications of an attack").

### 4.4 Owned items and nuisance

Picking up an item from a pool holding an `OWNERSHIP` marker angers the owner profile, or every member of the owning group
(hicks excepted after the marriage), who can see the thief (`MakeNPCGrumpyForMinorOffense`,
`Tactical/Handle_Items.cc:3224-3305`): the dealers and a few others listed there get `NPC_PISSED_OFF` and an "I hate you"
trigger, the rest go on the hostile-quote list; all turn to face the thief. The hospital supplies (`25` §6.3) are such
pools. Not ported: in ja2-node an owned item angers nobody (limitation, §9).

---

## 5. Keys, locks and door actions

### 5.1 Data

- **Lock table** `LockTable[64]` from `BINARYDATA/Locks.bin` (original data, read at run time, `KEYS:97-117`; ja2-node
  `src/content/formats/locks.ts`, the stub pack compiles `stubs/locks.json`): per lock the key item, type (`REGULAR 1`,
  `PADLOCK 2`, `CARD 3`, `ELECTRONIC 4`, `SPECIAL 5`), pick difficulty, smash difficulty (`OPENING_NOT_POSSIBLE = 254` for
  either), `LOCK_UNOPENABLE = 255` as a lock id (`Keys.h:12-50`).
- **Doors** (`DOOR`, `Keys.h:62-80`): `fLocked`, `ubTrapLevel` 0–10, `ubTrapID` (`EXPLOSION 1`, `ELECTRIC 2`, `SIREN 3`,
  `SILENT_ALARM 4`, `BROTHEL_SIREN 5`, `SUPER_ELECTRIC 6`), `ubLockID`, `bPerceivedLocked` (`UNKNOWN 0`, `LOCKED 1`,
  `UNLOCKED 2`, `BROKEN 3`), `bPerceivedTrapped` (`UNKNOWN 0`, `PROVED_TRAPPED 1`, `PERCEIVED_UNTRAPPED 2`,
  `PROVED_UNTRAPPED 3`), `bLockDamage`. Perceived values are reset on map load (`KEYS:686-707`). Trap flags
  (`DoorTrapTable`, `KEYS:73-82`): explosion stops the action; electric and super electric stop and recur; sirens recur; the
  silent alarm recurs silently. Door tables persist per sector in the temp files (`d_`, `16` §5.11). Shooting a lock damages
  it (`LOS.cc:2292-2324`).
- **Keys**: key items (class `IC_KEY`) carry `ubKeyID` = the lock id they open; the soldier's key ring holds up to 64
  `{key id, count}`; `KeyTable[64]` remembers where and when each key was found (`usSectorFound`, `usDateFound`, saved).
  `SoldierHasKey(s, id)` = ring or inventory, `ANYKEY 252` matches any (`KEYS:120-152`). Dropping a merc's gear, and his
  corpse, drops his key ring (`DropKeysInKeyRing`, `KEYS:1266-1300`).

### 5.2 Opening a closed door (`InteractWithOpenableStruct`, `HD:196-262`)

A door with `DOOR_BUSY` stops the merc (ja2-node has no busy window, gap "Doors"). An open door just closes (ja2-node
first gives our mercs vanilla's closing menu, deviation "Closing an open door"). A closed door in the door table and
**locked** opens the door menu for our mercs (`HD:233-251`) after `DoTrapCheckOnStartingMenu` (`HD:175-194`: a locked,
trapped door with an unknown trap is noticed when `CalcTrapDetectLevel(s, FALSE) ≥ trapLevel` → quote, perceived trapped,
no menu). Unlocked or lockless doors open directly; non-player soldiers always open.

The menu (`Tactical/Interface.cc:1386-1435`): open (normal cost by approach direction, `doorAPs`), use keys (needs any key;
not for EPCs), crowbar (a usable `CROWBAR`), lock pick (a `LOCKSMITHKIT`; not EPCs), explode (a `SHAPED_CHARGE`; not EPCs),
examine (not EPCs; also disabled once proved trapped or proved untrapped), force (not EPCs), untrap (disabled once proved
untrapped), cancel; facing diagonally disables every option except open/cancel, and lacking AP disables an option. The untrap
button's `disable = PROVED_UNTRAPPED` *replaces* the EPC flag, so escorts may untrap (`Interface.cc:1365`); the crowbar has
no EPC check; there is no lock button, so `HANDLE_DOOR_LOCK` is unreachable in the original (ja2-node's `door` command
returns the menu as data and offers `lock`, deviation "Door menu"). Choosing pays nothing yet; the animation (`OPEN_DOOR`,
`KICK_DOOR`, `PICK_LOCK`, `HD:142-173`) reaches `HandleOpenableStruct`, which charges at the end (`DeductPoints`,
`HD:806-810`).

### 5.3 `HandleOpenableStruct` for our mercs (`HD:309-812`)

Unless examining, untrapping or unlocking: a locked, trapped door → AP/BP of opening; `HasDoorTrapGoneOff`
(`CalcTrapDetectLevel(s, FALSE) < trapLevel`, `KEYS:496-513`) → `HandleDoorTrap`, stop if the trap stops actions, one-shot
traps removed, perceived values updated; else (noticed): unknown trap → message, quote, stop this time; known trap → fires
anyway (same rules). That check charges `doorAPs[ubDoorHandleCode]`; for menu actions the code (4–11) reads past the
four-entry table (undefined; ja2-node charges `AP_OPEN_DOOR`, deviation "Trap check cost of menu actions"). Opening a door
with a door-table entry costs nothing unless the trap check ran: `sAPCost` is set only for doors without an entry. Then by
action:

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
kept); super electric → `20 + PreRandom(20)`, `6 + PreRandom(6)·1000`. The breath argument is evaluated first (GCC, right
to left): `PreRandom(3)` before `PreRandom(10)`; oracle-confirmed. `UpdateDoorPerceivedValue` (`KEYS:772-804`) copies the
real lock state and sets the trap knowledge (untrap and examine prove, others prove unless the trap is none or silent).

**Quest effects of messing with doors** (`ProcessImplicationsOfPCMessingWithDoor`, `HD:265-307`, after force, crowbar,
explode and lock pick): in the brothel rooms 91–119 of C5, or in D5 at 11010, 11177, 11176, any Kingpin goon ≥ OKLIFE who
sees the merc turns hostile and starts combat; in Tixa (J9) the Warden within 5 and below red alert goes red and re-plans.

### 5.4 AI and NPC doors

The AI passes locked doors only with `bHasKeys`; schedules lock and unlock by setting `fLocked` directly (§3.3);
`NPCOpenThing` (§5.6) unlocks what it opens; Madame's actions unlock the girls' doors (§1.6).

### 5.5 Doors on entering a sector

`ExamineDoorsOnEnteringSector` (`KEYS:1242-1264`, after `EnterSector` unless loading a save, `SM:505-510`): outside Omerta,
if ≥ 30 minutes passed since the player was last in tactical and any non-player soldier is in the sector, every open door
status is closed (`HandleDoorChangeFromGridNo(…, TRUE)`, no animation). It never fires: `SetCurrentWorldSector` sets
`uiTimeSinceLastInTactical` to now just before the call (`SM:499` before `:509`), so ja2-node does not run it.
`MercLooksForDoors`/`AllMercsLookForDoor` (`KEYS:934-1006`) update the perceived open state within sight (the
perceived/real split is missing, gap "Doors").

### 5.6 `NPCOpenThing` (`ID:4576-4662`)

Door: `FindClosestDoor`; otherwise gridno 6968 for ARMAND, else `FindNearestOpenableNonDoor`; none → false. Already open →
the NPC's `APPROACH_DONE_OPEN_STRUCTURE` record (`24`). Else: unlock its door entry; adjacent tile (`FindAdjacentGridEx`,
none → false); start the interaction there or walk there; `PENDING_ACTION`.

`FindClosestDoor` searches 5 tiles around the NPC and keeps the nearest door closer than 10 (`PythSpacesAway`);
`FindNearestOpenableNonDoor` searches 7 tiles by `CardinalSpacesAway`. The adjacent tile uses the `fDoor` variant of
`FindAdjacentGridEx` (ja2-node `findAdjacentGridExForDoor`: raw movement costs, the door's orientation drops sides, a
switch is reached through its wall, standing on the door tile faces south or east). A walking NPC carries the interaction
as a pending `openStruct` door action that `InteractWithOpenableStruct` runs on arrival, without the original's "dialogue
queue empty" check (gap "NPC opens a door on arrival"). Action 40 picks up with `ITEM_IGNORE_Z_LEVEL` (every item on
the tile, whatever its height).

---

## 6. Determinism

Draws are stated where they happen, in statement order: new game §2.2; 04:00 §2.3 (bracketed); hourly §2.4; sector entry
§2.5 (after the head miners' draws; `DecideOnAssassin`: `25` §6.4); placement §2.6 (before the soldier's own creation
draws); schedules §3.2 and, after a native load, §3.6; the actions of §1 (107, 108, 118, 125, 126, 139, 140 (the hit's
draws, `33` §2), 160, 230, 43, the lie of 221 (`SkillCheck`, `33` §5)); civilian groups §4.2; NPC system events §1.13;
Pablo's death §1.5; doors §5.3. The Kingpin goon gridno adds two engine draws whose evaluation order C++ leaves
unspecified (§2.6, deviation "Kingpin's men placement"); every other path draws in statement order.

Door draws beyond §5.3 (main and pre): `CalcTrapDetectLevel` draws `PreRandom(level / 3 + 2)` when examining and
`PreRandom(3)` when bleeding > 20 or shocked; code 495 draws `DoorOpeningNoise` before `HandleOpenableStruct`; sirens and
silent alarms draw `Random(1000)` per alerted soldier in real time (`SetNewSituation`); a `SkillCheck`'s gains draw in
`StatChange`; the crowbar's status loss is `PreRandom(bStress / 20)`. Door creaks and the silent skill-check curse are
cosmetic like the wrong-key curse (not drawn in ja2-node: deviation "Cosmetic draws of doors").

Wall-clock dependencies: Carmen's 10 000 ms customizable timer (`ID:2708-2709`) → 10 000 ms of tactical game time
(deviation "Carmen's departure timer"); the fades into and out of the rebel basement run the sector change in their
callbacks (`ID:4510-4574`) → at once (deviation "Rebel basement"); the sex screen's time warp at its end
(`JAScreens.cc:478-483`) → at the action (deviation "Brothel time warp"); klaxons and lock sounds are presentation events
only.

---

## 7. Data and stubs

- **Externalized** (`data/externalized/`): `tactical-npc-action-params.json` (action gridnos and amounts, §1.1),
  `strategic-map-npc-placements.json` (§2.2; read by `src/content/strategic/npc-placements.ts`), `mercs-profile-info.json`
  (names ↔ ids, types), `shipping-destinations.json` (delivery sector and gridno: Sal, §2.7), `game.json`
  (`progress.event_*_min` §2.4, `diagonally_interactable_doors` §5.3), `strategic-mines.json` (head miners, §2.5),
  `items.json` (prices of `LEATHER_JACKET_W_KEVLAR` and `ALCOHOL`, key items).
- **Transcribed**: `data/tables/narrative.json` (`tools/transcribe/narrative.ts`; regenerate, never edit) holds the NPC
  profile ids (`Tactical/Soldier_Profile.h`), the NPC action codes and names (`Tactical/Interface_Dialogue.h:85-342`),
  Larry's items and bars (`HU:154-167, 210-217`) and the schedule actions and flags (`Scheduling.h:10-41`); `npc-ids.ts`,
  `npc-actions/codes.ts`, `larry.ts` and `schedule-state.ts` are checked against it. The terrorist candidates come from
  `data/tables/laptop.json` (`21`), the history codes from `data/tables/merc-contracts.json` (`22`). Everything else is a
  named constant with an `@src` header in its module: civilian groups and hostility levels
  (`src/sim/tactical/narrative/constants.ts`, `soldier.ts`), lock types, door traps and perceived values (`locks.ts`,
  `door-table.ts`, `Keys.h:12-125`), quest gridnos and rooms (the action modules), distances and money thresholds.
- **Original data** (read at run time, never committed): `BINARYDATA/Locks.bin` (§5.1); map files (schedules, door tables,
  placements with schedule ids and civilian groups); `prof.dat` (initial profile sectors, inventories, `npcData`); native
  saves: the profiles' NPC fields (section 5), the key table, the schedules section, the civilian group states (tactical
  status).
- **Stubs** (`32` §1.5): in the stub A10 a villager with a two-entry schedule (`09:00 GRIDNO`, `22:00 SLEEP`), a civilian
  on the default schedule, and profiled stub NPCs with `STAYINSECTOR` schedules, written with `schedule '<symbol>': [HH:MM]
  <ACTION> [<x> <y>] [-> <x> <y>]; …` lines (up to four entries, times optional) and a `schedule=<symbol>` soldier flag (a
  detailed placement with the schedule id, profile 200 for an unprofiled civilian); a locked, electrically trapped door
  with lock 1 in the stub village (`stubs/locks.json`). NPC profiles and records: `stubs/profiles.json`,
  `stubs/npc/records.json` (`24`).

---

## 8. Implementation in ja2-node

All files carry the SFI-SCLA header; `sim` modules are deterministic and read the content through ports.

| Module | Responsibility |
|---|---|
| `src/sim/tactical/narrative/npc-actions/` | the catalog: `catalog.ts` dispatches in the original's order to `generic.ts` (§1.2), `requestors.ts` (§1.3), `rebels.ts` (§1.4), `drassen.ts` (§1.5), `san-mona.ts` (§1.6), `cambria.ts` (§1.7), `south.ts` (§1.8), `others.ts` (§1.9), `meanwhile.ts` (§1.10), `open-thing.ts` (§5.6, actions 3, 27, 40) over `NpcActionEnv` (`env.ts`); codes in `codes.ts`; parameters from `StrategicContent.npcActionParams` |
| `src/sim/narrative/select.ts` | §1.11 money and item rules (the dialogue side is `24`) |
| `src/sim/strategic/narrative/`: `npc-events.ts` | §1.13 handlers (event 27) |
| `presence.ts`, `early-morning.ts`, `hourly.ts`, `larry.ts`, `profiled-enemies.ts` | `ChangeNpcToDifferentSector` (§2.1) and profile items; §2.3; §2.4 (quest hours, progress milestones, Slay); Larry; the Mike/Iggy upgrade (§2.6) |
| `civ-groups.ts` | `StrategicState.civGroups` and event 41 |
| `src/sim/campaign/laptop/aim.ts` `decideActiveTerrorists`; `src/sim/strategic/map/init.ts` `initNpcPlacements` | §2.2 |
| `src/sim/tactical/narrative/`: `placement.ts`, `profile-insertion.ts` | §2.6: the `AddPlacementToWorld` filter and overrides, `AddProfiles…`, `SetupProfileInsertionData…`, `UpdateSoldierPointerDataIntoProfile` |
| `schedules.ts`, `schedule-state.ts` | §3 (list, posting, auto-processing, shop hours); `src/sim/tactical/ai/decide-schedule.ts` the AI hook; `src/sim/tactical/away-slots.ts` |
| `civ-hostility.ts`, `team-change.ts`, `wheelchair.ts` | §4.2–§4.3 and the door implications (§5.3); `ChangeSoldierTeam`; the kick-out (animation code 482) |
| `src/sim/tactical/doors/` | §5: `door-table.ts`, `keys.ts`, `key-ring.ts`, `lock-attempts.ts`, `door-traps.ts`, `door-actions.ts`, `door-approach.ts`, `door-command.ts`, `door-view.ts`, `openables.ts`; lock table reader `src/content/formats/locks.ts` |

Wiring:
- `src/sim/campaign/narrative/narrative-flow.ts` (`NarrativeFlow`): events 27, 28, 34, 63, 67, the sector entry and exit
  quest code (§2.5), the placement narrative; its `NarrativeSlots` connect the dialogue code (NPC actions,
  `NPCReachedDestination`, the once-per-convo reset).
- `npc-action-flow.ts` (`NpcActionFlow`): the campaign side of the catalog (requests in the prompt slot, fades, Carmen's
  timer, boxing, meanwhile actions through `meanwhile-actions.ts`).
- `src/sim/campaign/narrative-port.ts`: the tactical `NarrativePort` in campaigns, event 36 and the strategic clock behind
  `TacticalState.scheduleClock`, event 41.
- `SectorFlow` (`src/sim/campaign/sector-flow.ts`): `SetupProfileInsertionDataForCivilians`, the entry quest code, the
  `PrepareLoadedSector` additions and `PostSchedules` on a fresh load (§2.6), the exit quest code and the profile write-back
  on unload, `PostSchedules` without auto-processing after a native import; `CampaignSim` supplies shop hours (§3.5).
- `24` provides the dispatch that calls `handleNpcDoAction(env, npc, code, record)` at the original's points,
  `TriggerNPCRecord`, the hostile-quote list, `TriggerFriendWithHostileQuote`, `SetQuoteRecordAsUsed`, `RecruitRPC` and the
  item-acceptance loop that calls §1.11.

Verification: the oracle (`tools/oracle/README.md`, sections "Facts and NPC presence", "NPC actions", "Give", "Civilians",
"Doors", "Schedules") runs the original's functions on native saves and new games and compares them with ja2-node, draws
replayed on both streams: probe scripts `facts.txt`, `actions.txt`, `give.txt`, `civ.txt`, `doors.txt`, `schedules.txt`;
`laptop.txt`'s new-game probes also compare every profile's sector (`InitNPCs`, terrorists). The walking door and cabinet
actions (3, 27, 40) are covered only by unit tests on the stub village door. Stub scenarios play the narrative and
schedules end to end (`campaign/narrative/narrative-scenario.test.ts`, `schedules-scenario.test.ts`); with `JA2_DATA_DIR`,
`schedule-maps.test.ts` loads every original map's schedules.

---

## 9. Kept quirks, limitations and open questions

**Kept quirks** (described where they apply): action 109 is unimplemented and a Pablo bribe never wears off (§1.1, §1.13);
`FACE_NORTH` faces north-west, the wisdom-only liar choice, the unreachable "one wounded" branch of 162, Willis zeroing
Vince's balance, 133 can trigger records 14 and 15, 124 continues after record 27 (§1.2, §1.3, §1.6);
`ENABLE_CAMBRIA_DOCTOR_BONUS` 48–71 h, strictly closer than 9 tiles for `DOCTOR_ESCORT_PATIENTS`, `DELAYED_MAKE_BRENDA_LEAVE`
6 h (§1.7, §1.9); unsigned hospital refunds (§1.11); `InitNPCs` drawing for every placement (§2.2); the hourly Skyrider
payment taking all the money (§2.4); `gsRobotGridNo` never set (§2.5); the ice-cream truck's body-type profile id, the
overwritten quote record (§2.6); the schedule "enter sector" flags-byte bug, the past-dated midnight wrap, the stuck walked
departure, the `AI_HANDLE_EVERY_FRAME` bit set in `uiStatusFlags`, the corner teleport, the centre placement at
`sOffWorldGridNo` 0 (§3.3, §3.4); a second schedule event and redrawn default schedules after a native load (§3.6);
`MakeCivHostile` keeping the side (§4.2); the electric trap's breath `3 + 1000·PreRandom(3)` (§5.3).

**Limitations in ja2-node** (not yet ported; `gaps.md` names in quotes): the door busy window ("Doors"); the A10 map
changes of the basement trip ("Rebel basement trapdoor"); `CivilianGroupChangesSides` callers ("Building owners"); the
head-miner attack rule and firing back out of combat ("Implications of an attack"); `MakeNPCGrumpyForMinorOffense`
(§4.4, "NPC draws first and minor offenses"); the profile move and done-traversal flag of `HandleAITacticalTraversal`
(§2.6, "NPC traversal off the map").

**Inferred, not verified**: the transient requestor and talk globals cannot be saved in the original (no save while a box or
panel is open, §0); a walked departure ends in an away slot at the next load (§3.3); shop hours are known only while the
dealer's sector is loaded (§3.5); the second schedule event after a native load is harmless (§3.6).
