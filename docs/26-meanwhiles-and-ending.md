# 26 — Meanwhile scenes, the Queen and the end of the campaign

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `X:` is `src/externalized/`, `V:` is vanilla
`Build/`, `J:` is `data/externalized/`. "(inferred)" marks conclusions not traced end to end. `R(n)` = `Random(n)` = the
`main` stream (`R(0)` draws nothing), `PR(n)` = `PreRandom(n)` = the `pre` stream (`01` §3.6). Times are world minutes
(`GetWorldTotalMin`) unless marked; the event queue stores seconds (`docs/15` §2). Sectors are written as on the map (P3 =
column 3, row P, `SGPSector(3, 16)`); "P3 b1" is level 1 under P3. Profile ids are the `NPCIDs` of
`Tactical/Soldier_Profile.h:23-179` (QUEEN 75, JOE 79, RAT 81, MIGUEL 57, ROBOT 62, IGGY 68, PACOS 114, SKYRIDER 97,
ELLIOT 135, DEREK 136, OLIVER 137, MADLAB 146, MIKE 149); meanwhile ids are the enum of `Strategic/Meanwhile.h:7-27`
(`Meanwhile` in `src/sim/strategic/ai/constants.ts`). "The scene" is the cutscene the original plays in tactical; "the
box" is its "Meanwhile....." message box.

**Scope.** This doc owns `Strategic/Meanwhile.cc`, `Tactical/End_Game.cc`, the end of the campaign (ending videos,
credits, restart), the 35/50/70 % progress events, the narrative effects of the first battle, the POW story pieces nobody
else owns (§3) and the NPC actions that only meanwhile scenes and the ending use (§1.7, §6.5; `35`'s catalog points
here). Elsewhere: `15` event queue, `InterruptTime`, pause locks, compression and its stop reasons; `16` sector load and
unload, temp files (`SectorDiff`), exit grids, map file names (`_m` for the Meduna meanwhile map), the helicopter; `17`
the Queen's AI, with `17` §9.4 (meanwhile implications on the AI), `17` §9.5 (`ExecuteStrategicAIAction`), `17` §10.11
(capture), `17` §11.3 (progress); `18` town liberation and loss, SAM sites, loyalty and morale; `19` first-battle facts
from autoresolve, autoresolve capture and surrender (`19`), the end of a tactical battle (`19`); `21` the
florist, Enrico's mails, history; `22` POW contract rules, death bookkeeping; `33` death commit, `11` melee; `13` the AI
hooks `HeadForTheStairCase` and `OFFER_SURRENDER`; `14` save sections; `24` NPC records and their selection, approaches,
`TriggerNPCRecord*`, the talk interface, the dialogue queue and the "nobody is talking" test, NPC action dispatch,
civilian quotes; `25` facts, quests and `StartQuest`/`EndQuest`, Skyrider; `35` the NPC action catalog, NPC placement and
`InitNPCs`; `30` §7 the story screens of the client; `29` the agent API (flows, refusals, prompts, events, view
fields).

---

## 0. State

ja2-node fields are on the campaign's `StrategicState` (`src/sim/strategic/state.ts`).

| State | Original | Saved there | ja2-node |
|---|---|---|---|
| flags | `uiMeanWhileFlags` u32, one bit per scene, set at scheduling (`Meanwhile.cc:94-153`) | section 24 (`SaveLoadGame.cc:1937`; u16 before version 71, `:2094-2096`) | `meanwhile.flags` |
| last scheduled id | `ubCurrentMeanWhileId` static u8, the id of the **last scheduled** scene (`:91, 179`) | **no** (static; 0 in a fresh process, not reset by a load: the oracle sees it survive `LoadSavedGame`) | `meanwhile.currentId`; only the camera reads it (§1.6) |
| defs[17] | `gMeanwhileDef[]` = {sector, trigger record, id, npc} per id, written at scheduling (`:79, 182-186`) | section 40, 17 × 8 bytes (`:2130-2160`) | `meanwhile.defs` (`null` = never scheduled) |
| current | `gCurrentMeanwhileDef`, copied at `BeginMeanwhile` (`:78, 209`) | 24 (`:1886`) | `meanwhile.current` |
| trying | `gfMeanwhileTryingToStart` (`:80, 211, 257`) | 24 (`:1888`) | `meanwhile.trying`: the window between the event and the gates (§2.1) |
| in scene | `gfInMeanwhile` (`:81, 304`) | 24 (`:1889`; forced false on load in Dead-is-Dead mode, `:2037-2039`) | `meanwhile.inScene`: the interrogation, and inside a Meduna resolution (§2.1) |
| NPC saves | `gNPCSaveData[10]` {profile, sector, gridNo} static (`:69-88`) | no | `meanwhile.npcSaves` |
| scene log | — | — | `meanwhile.log[]` {seq, id, at, context} (§2.4) |
| first-battle pending | `gfFirstBattleMeanwhileScenePending` (`Strategic_AI.cc:116`) | 35 | `queen.firstBattleMeanwhilePending` |
| first-battle sector | `sWorldSectorLocationOfFirstBattle` i16 (`Strategic_Town_Loyalty.cc:1131-1145`) | 24 (`:1899`) | `economy.firstBattleSector` (strategic index, 0 = none) |
| last battle | `gTacticalStatus.ubLastBattleSector`, `fLastBattleWon` (`Overhead.cc:3898-3899`, `:4511`) | tactical status | `battle.lastBattleSector`, `battle.lastBattleWon`; read by the record selectors (§1.7) |
| Elliot's counter | ELLIOT's `bNPCData` INT8: the slap counter (`Meanwhile.cc:192-195`, `Interface_Dialogue.cc:3114`) | profiles | profile `npcData` |
| scene NPC placement | `fUseProfileInsertionInfo`, `sGridNo` of QUEEN, ELLIOT, JOE, changed by a played scene (§1.8) | profiles | profile `useProfileInsertion`, `gridNo` (`25`) |
| endgame | `IN_DEIDRANNA_ENDGAME` / `IN_ENDGAME_SEQUENCE` bits of `gTacticalStatus.uiFlags` (`Overhead_Types.h:46, 67`); statics `gpKillerSoldier`, `gsGridNo`, `gbLevel` (`End_Game.cc:39-41`) | flags yes, statics no | `ending` (`EndingState`, §7.1) |
| outcome | none: the game restarts after the credits (§6.7) | — | `ending.victory` = {at, day, ending {miguelAlive, skyriderAlive}, mercDeaths} |
| capture | `gStrategicStatus.uiFlags` `STRATEGIC_PLAYER_CAPTURED_FOR_RESCUE` / `_FOR_ESCAPE`, `ubNumCapturedForRescue` | 34 | `status.flags` (`CaptureFlag`), `status.numCapturedForRescue` (`src/sim/campaign/merc-fate.ts`) |
| quests | `gubQuest[]` `HELD_IN_ALMA`, `INTERROGATION`, `FIND_SCIENTIST`, `CREATURES` | yes | `narrative.quests` (`25`) |
| scenes seen | `gGameSettings.uiMeanwhileScenesSeenFlags`, bit `1 << id` (`GameSettings.cc:218-230`) | **settings file, not the save** | client setting `meanwhileScenesSeen` (`src/ui/settings.ts`), not simulation state |
| O3 statue opened | map modification of O3 (struct swap + exit grid, `End_Game.cc:72-116`) | map temp file | O3's `SectorDiff` map changes (`16`) |

---

## 1. Meanwhile scenes in the original

### 1.1 The seventeen scenes

| Id | Name | Posted by | Due | Scene sector | Scene NPCs | Implications (§1.9) |
|---|---|---|---|---|---|---|
| 0 | `END_OF_PLAYERS_FIRST_BATTLE` | `HandleFirstBattleVictory` / `HandleDelayedFirstBattleVictory` (`Meanwhile.cc:746-762`), via §4.2 | now + 5 | P3 | QUEEN, ELLIOT | hard: wake the Queen; a no-op NPC action |
| 1 | `DRASSEN_LIBERATED` | `HandleMeanWhileEventPostingForTownLiberation` (`:651-667`) from `CheckIfEntireTownHasBeenLiberated` (`Strategic_Town_Loyalty.cc:1046`) | now + 5 | P3 | QUEEN, ELLIOT | wake; a no-op NPC action |
| 2–5, 16 | `CAMBRIA_`, `ALMA_`, `GRUMM_`, `CHITZENA_`, `BALIME_LIBERATED` | same | now + 5 | P3 | QUEEN, ELLIOT | wake |
| 6, 7, 8 | `NW_SAM`, `NE_SAM`, `CENTRAL_SAM` (SAM ids 0, 1, 2 = D2, D15, I8; N4 has none, `:677-690`) | `SetThisSectorAsPlayerControlled` (`Player_Command.cc:146-151`) | now + 5 | P3 | QUEEN, ELLIOT | troops to that SAM site |
| 9 | `FLOWERS` | florist order to Meduna (`Laptop/Florist_Order_Form.cc:478-490`), `:693-716` | now + 60·(20 + R(5)) or now + 60·(24 + R(48)) | P3 | QUEEN, ELLIOT | none |
| 10 | `LOST_TOWN` | `HandleMeanWhileEventPostingForTownLoss` (`:670-674`) from `CheckIfEntireTownHasBeenLost` (`Strategic_Town_Loyalty.cc:1073`) | now + 5 | P3 | QUEEN, ELLIOT | none |
| 11 | `INTERROGATION` | `EndCaptureSequence` on the second capture (`Strategic/Queen_Command.cc:1126-1133`) | **absolute minute 10** | **N7** | QUEEN, ELLIOT, JOE | none; the scene itself changes state (§2.3) |
| 12 | `CREATURES` | `HandleCreatureRelease` (`:644-648`) from `InitCreatureQuest` (`Strategic/Creature_Spreading.cc:188-193`) | now + 5 | P3 | QUEEN, ELLIOT | RAT placed in G9 |
| 13 | `KILL_CHOPPER` | `LandHelicopter` (`Strategic/Map_Screen_Helicopter.cc:417-421`), `:726-736` | now + 55 + R(10) | P3 | QUEEN, ELLIOT | none |
| 14 | `AWOL_SCIENTIST` | `HourlyProgressUpdate` at 35 % (`Tactical/Campaign.cc:1302-1305`), `:739-743` | now + 5 | P3 | QUEEN, ELLIOT | quest `FIND_SCIENTIST`; MADLAB and ROBOT placed |
| 15 | `OUTSKIRTS_MEDUNA` | `SetThisSectorAsPlayerControlled` for M2–M6 and N6 (`Player_Command.cc:182-187`), `:719-723` | now + 5 | P3 | QUEEN, ELLIOT, **JOE** | none (the played scene shoots Elliot, §1.8) |

Every posting call passes trigger record 0 and NPC QUEEN (`:647, 666, 673, 689, 715, 722, 735, 742, 749, 761`;
`Queen_Command.cc:1132`). In P3 the scene loads `P3_m.dat` instead of `P3.dat`
(`Strategic/StrategicMap.cc:335-339`, `16`); N7 loads its normal map. The record files are per scene:
`J:script-records-control.json` maps (meanwhile id, QUEEN or ELLIOT) to a record file
(`X:DefaultContentManager.cc:1379-1398`), and while a scene runs QUEEN and ELLIOT read those instead of their own
(`TacticalAI/NPC.cc:229-251`); JOE always uses his own records.

### 1.2 `ScheduleMeanwhileEvent(sector, trigger, id, npc, minute)` (`Meanwhile.cc:170-198`)

```
if flags & flag(id): return                       // each scene at most once per campaign
flags |= flag(id)                                 // flag bits: :96-139 (not in id order: INTERROGATION 0x8000, CREATURES 0x800)
lastScheduledId = id
defs[id] = {sector, trigger, id, npc}
if profiles[ELLIOT].npcData != 17: profiles[ELLIOT].npcData++      // "poor Elliot", counted even if the scene is skipped
AddStrategicEvent(EVENT_MEANWHILE, minute, id)    // one-shot, docs/15 §2
```

Elliot's counter only selects his face in scenes (`Tactical/Faces.cc:119-128`: > 3 bruised in four stages up to 15, 17 =
shot; **16 matches no branch and shows the unbruised face**, quirk). 17 is also set by `SHOOT_ELLIOT` (§1.7), and the
increment stops there; with 17 scenes scheduled it can reach 17 by counting alone (inferred: the initial `prof.dat` value
is small).

### 1.3 Triggers in detail

- **First battle** (§4.2): `HandleFirstBattleEndingWhileInTown(sector, fromAutoResolve)` (`:765-796`): returns if the scene
  was already scheduled; sector not in a town (`bNameId == BLANK_SECTOR`) → schedule now and clear the pending flag; in a
  town and (pending or from autoresolve) → schedule, clear; else set pending. `HandleFirstMeanWhileSetUpWithTrashWorld`
  (`:799-809`) schedules a pending one whenever the world is trashed (`TileEngine/WorldDef.cc:2543-2544`): leaving the town
  sector, or any later map load, **including the load of a played meanwhile scene**. Both branches post at now + 5 (the
  "delayed" variant's 60 minutes is commented out, `:755-760`).
- **Towns** (`18`): when a town becomes wholly player-controlled for the first time and militia can be trained there
  (`Strategic_Town_Loyalty.cc:1033-1062`); Omerta, San Mona, Estoni, Orta, Tixa and Meduna have no scene (`:656-664`).
  **Loss**: a militia-trainable town that was liberated before is wholly enemy-controlled again (`:1064-1076`); one
  `LOST_TOWN` scene per campaign.
- **SAM sites**: every contested capture of a SAM sector posts (the "first time" test is commented out,
  `Player_Command.cc:146-151`); the flag makes it once. Called before the SAM morale and loyalty events.
- **Meduna outskirts**: a contested capture of an enemy-controlled M2, M3, M4, M5, M6 or N6 (`Player_Command.cc:182-187`),
  after the refuel-site update.
- **Creatures**: `InitCreatureQuest` posts the scene once (`gfCreatureMeanwhileScenePlayed`) **before** it checks for an
  infestible mine (`Creature_Spreading.cc:182-225`), so the scene (and RAT) happens even when the quest does not start. Its
  callers are `CheckConditionsForTriggeringCreatureQuest` (sci-fi only, `:898-920`) and entering the Tixa cave J9 b2
  **without a sci-fi check** (`StrategicMap.cc:491-497`); the scene's records have a `NO_SCI_FI_END_MEANWHILE` branch for
  that case (§1.7). The creature quest is `17` §12.
- **Flowers** (`21`): only when the delivery sector's town is Meduna; the "next day" box → code 0. The draw happens
  only when the flag is clear (`:697-701`), before the florist's order-number draw.
- **Chopper**: every landing after which the helicopter can fly again (`Map_Screen_Helicopter.cc:398-421`); the draw only
  while the flag is clear.
- **Scientist**: §4.1. **Interrogation**: §3.3.

### 1.4 The event: delays, begin, precedence

`EVENT_MEANWHILE` (`Strategic/Game_Event_Hook.cc:230-236`):

```
if gTacticalStatus.fEnemyInSector:                                            // DelayEventIfBattleInProgress, :45-56
    repost (same frequency, kind, param) at e.stamp + 180 + R(121) seconds; copy e.offset; return
BeginMeanwhile(id); InterruptTime()
```

- The delay is measured from the **event's** stamp, not from now, and repeats with a fresh `R(121)` at every firing while
  the loaded sector holds enemies (also with the map screen open). It never fires in turn-based combat (world time is
  frozen, `01` §3.3). For `INTERROGATION` (stamp 600, far in the past) every repost is still in the past, so it re-fires
  and redraws at each event pass for as long as enemies remain (quirk, inferred from `docs/15` §2.5).
- `InterruptTime` ends the event pass after this event; same-stamp successors run at the next pass (`15` §2.5).
- `BeginMeanwhile` (`:201-221`): Dead-is-Dead autosave, `current = defs[id]`, `trying = true`, `PauseGame()` +
  `LockPauseState(LOCK_PAUSE_MEANWHILE)` (`15` §1.5), clear the NPC save slots. ja2-node takes the Dead-is-Dead save at the
  next input boundary (deviations.md "Dead is Dead save points").
- **Precedence** (`AreInMeanwhile`, `:417-437`): false during a tactical traversal; true while in a scene; otherwise true
  if the event queue's **head** events at exactly the current second include a `MEANWHILE` (the walk stops at the first
  event with another stamp). Readers: group arrivals are delayed by 1 minute instead of 3–5
  (`Strategic/Strategic_Movement.cc:1120-1136`, `16`), and `SetThisSectorAsPlayerControlled` refuses to change control
  (`Player_Command.cc:64-67`). ja2-node: `areInMeanwhile` (`meanwhile.ts`, with `meanwhilePendingThisSecond` for the
  queue test) answers the strategic world port's `inMeanwhile()`.

### 1.5 The box (`CheckForMeanwhileOKStart`, `:237-274`; `BringupMeanwhileBox`, `:227-235`)

Run every frame of the tactical and map screens only (`GameScreen.cc:529`, `Strategic/MapScreen.cc:2009`; the laptop,
shops and options pause the game anyway, `Laptop/Laptop.cc:462`). While `trying`: wait while the pre-battle interface is
open, while the tactical panel is switching (`InterfaceOKForMeanwhilePopup`, `Tactical/Interface_Control.cc:619-622`) and
**until the dialogue queue is empty and nobody talks** (`24`). Then `trying = false` (before the box), remember the
screen, leave tactical if in it, drop the item on the cursor, and show the box: OK only for `INTERROGATION` or a scene
never seen on this installation, OK + Skip otherwise. The world clock is paused throughout; tactical animation keeps
running until the box appears (`GameScreen.cc:420-427` runs the overhead regardless of the game pause; the box then sets
`PauseTime`, `15` §1.5). While `trying`, compression and map-screen exits are refused
(`Strategic/Map_Screen_Interface_Bottom.cc:749-753, 1010-1014`).

`BeginMeanwhileCallBack` (`:396-414`): OK → `ENGAGED_IN_CONV`, NPC reference count 1, `StartMeanwhile`. Skip →
`inScene = false`, `ProcessImplicationsOfMeanwhile()`, unlock and unpause: nothing else happens (§1.10).

### 1.6 Playing a scene

`StartMeanwhile` (`:295-355`): remember the loaded sector (if any) and the selected map sector; `inScene = true`; music;
for every scene except `INTERROGATION` move QUEEN and ELLIOT (and JOE for `OUTSKIRTS_MEDUNA`) to P3, for `INTERROGATION`
QUEEN, ELLIOT and JOE to N7, each through `SetNPCMeanwhile` (`:277-289`): save {profile, sector, gridNo}, `ReloadQuoteFile`
(the records are reread from content; it picks the per-scene files for QUEEN and ELLIOT through `AreInMeanwhile()`, so
`inScene` must already be set, `NPC.cc:318-323`), `ChangeNpcToDifferentSector` (`Tactical/Tactical_Save.cc:733-745`:
sector := scene sector, or none if the profile has left the country; `fUseProfileInsertionInfo = FALSE`). Fade; then
`SetCurrentWorldSector(def.sector)` (the player's world is unloaded through `HandleDefiniteUnloadingOfWorld`, which saves
its temp files and runs the sector-exit quest code, and `TrashWorld`, `16`); camera on
`gusMeanWhileGridNo[lastScheduledId]` (`:47-66`: 12248 for all, 8075 for `INTERROGATION`; indexed by the last *scheduled*
id, not the playing one, quirk); fade in; then (if still in the scene) NPC reference count 1, `SHOW_ALL_MERCS` unless
`INTERROGATION`, `TriggerNPCRecordImmediately(QUEEN, 0)` (`:375-390`).

What the scene load does differently (`AreInMeanwhile` checks): `_m` map for P3; no `SF_ALREADY_VISITED`
(`StrategicMap.cc:860-863`); no temp files loaded or saved, except that `INTERROGATION` loads N7's item temp file and saves
N7 normally (`Tactical/Tactical_Save.cc:278-286, 436-456`); enemies placed only for `INTERROGATION`
(`StrategicMap.cc:632-635`); P3's special civilian rules skipped (`Tactical/Soldier_Init_List.cc:500`). In tactical while
in a scene:

| Rule | Where |
|---|---|
| Every gun and melee attack hits | `Tactical/Weapons.cc:663-667, 1220` |
| Hand-to-hand in `INTERROGATION`: no breath loss, damage halved | `Tactical/Soldier_Control.cc:2745-2749` |
| A soldier flagged `SOLDIER_NPC_SHOOTING` (Elliot) is left at 1 life; no bleeding damage | `Soldier_Control.cc:5504-5516` |
| Nobody gets up | `Soldier_Control.cc:5274-5278` |
| Elliot is added with at least 25 life | `Tactical/Soldier_Add.cc:687-691` |
| Anyone falling below OKLIFE triggers QUEEN with `APPROACH_DONE_SLAPPED` (`CheckForAndHandleSoldierIncompacitated`) | `Tactical/Soldier_Ani.cc:3045, 3075-3083` |
| No combat mode, no hidden turn-based switch | `Tactical/Overhead.cc:5707-5711`, `Tactical/TeamTurns.cc:434-437` |
| Attacks by anyone but QUEEN keep the attacker (no `FreeUpAttacker`) | `Overhead.cc:5581-5588` |
| No merc quotes, first-seen NPC quotes, noise quotes, under-fire quotes | `Tactical/Dialogue_Control.cc:548-551`, `Tactical/OppList.cc:1640, 2286-2289, 4255` |
| No sector control change; no save; no options | `Player_Command.cc:64-67`, `SaveLoadScreen.cc:1374`, `Tactical/Turn_Based_Input.cc:1546` |
| Cosmetic: no death sound, no martial-arts animations, radar blank, no enemy music | `Soldier_Ani.cc:1035, 3094`, `Soldier_Control.cc:6755`, `TileEngine/Radar_Screen.cc:203`, `Overhead.cc:4122` |

ja2-node: the predicates `inMeanwhile`, `inInterrogation`, `meanwhileKeepsAttacker`, `slapCheckWhenIncapacitated` and
`keepElliotAliveInMeanwhile` (`src/sim/tactical/narrative/meanwhile-rules.ts`) are read by attack, melee, hit, barrier,
death, get-up and insertion code; noise, sight and dialogue quotes test `t.narrative.inMeanwhile()`.

### 1.7 What scene records can do

The scene is the record machinery of `24` running on these NPC actions (`Tactical/Interface_Dialogue.cc`):

| Action | Line | Effect |
|---|---|---|
| `SLAP`, `FRUSTRATED_SLAP` | 3015, 3181 | QUEEN (or the NPC) plays a slap animation; cosmetic |
| `TRIGGER_QUEEN_BY_CITIES_CONTROLLED` | 3201-3224 | QUEEN record by `GetNumberOfWholeTownsUnderControlButExcludeCity(OMERTA)` (0–1, 2, 3, 4, 5, more) |
| `TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED` | 3233-3248 | QUEEN record by SAM sites under player control (0–1, 2, 3; 4 nothing) |
| `TRIGGER_ELLIOT_BY_BATTLE_RESULT` | 3250-3259 | ELLIOT record by `fLastBattleWon` |
| `TRIGGER_ELLIOT_BY_SAM_DISABLED` | 3261-3270 | by a functional SAM in `ubLastBattleSector` |
| `ELLIOT_` / `QUEEN_DECIDE_WHICH_QUOTE_FOR_PLAYER_ATTACK` | 3412-3435 | record by `DidFirstBattleTakePlaceInThisTown(DRASSEN / CAMBRIA)` |
| `SEND_TROOPS_TO_SAM` | 3963-3964 | **no-op** here (the troops come from §1.9) |
| `SEND_SOLDIERS_TO_DRASSEN`, `…_BATTLE_LOCATION`, `…_TO_OMERTA`, `ADD_MORE_ELITES`, `GIVE_KNOWLEDGE_OF_ALL_MERCS` | 3226-3231 | no-op (`17` §9.5) |
| `SHOOT_ELLIOT` | 3082-3117 | the NPC gets a Desert Eagle in hand (scene soldier only) and fires at Elliot's head; **`ELLIOT.npcData = 17`** |
| `PUNCH_PC_SLOT_0/1/2` | 3030-3079 | the NPC knife-moves to the captive on `gsInterrogationGridNo[n]` (`Queen_Command.cc:50`: 7756–7758) and punches, then `APPROACH_DONE_PUNCH_n`; nobody there → the approach at once |
| `PUNCH_FIRST_LIVING_PC` | 3124-3179 | the same on the first occupied slot whose soldier lives (ELLIOT: conscious only), approach `DONE_PUNCH_1` |
| `PROMPT_PLAYER_TO_LIE` | 2388-2394, 4200-4201, 4341-4376 | yes/no/lie box (§2.3) |
| `REMOVE_JOE_QUEEN` | 2396-2405 | QUEEN and JOE leave the tactical sector |
| `END_MEANWHILE` | 2777-2782 | `EndMeanwhile()` |
| `REMOVE_ELLIOT_END_MEANWHILE` | 2407-2417 | Elliot leaves, then `EndMeanwhile()` |
| `NO_SCI_FI_END_MEANWHILE` | 2419-2429 | not sci-fi: `EndMeanwhile()`; sci-fi: QUEEN record 8 |
| `GRANT_EXPERIENCE_1..5` | 3607-3621 | `AwardExperienceBonusToActiveSquad` 25/50/100/200/400 (`Campaign.cc:1327-1364`) |

The shipped record files (checked on the original data, nothing reproduced): across the 34 per-scene files no record
has a quest condition, starts or ends a quest or gives an item, and only the `INTERROGATION` files test or set facts
(unnamed ids). The Meduna scenes use only slaps, dialogue-panel closing, the five record selectors above,
`SEND_TROOPS_TO_SAM`, `SHOOT_ELLIOT` (in `OUTSKIRTS_MEDUNA`, unconditionally reached) and the three endings.
`INTERROGATION` adds lie prompts, the unreachable-army no-ops, `PUNCH_FIRST_LIVING_PC`, `GRANT_EXPERIENCE_4`,
`REMOVE_JOE_QUEEN`, `REMOVE_ELLIOT_END_MEANWHILE` and facings; JOE's own records contribute `PUNCH_PC_SLOT_0..2`,
`TRIGGER_JOE_32_OR_33` and `REMOVE_NPC` with unnamed facts. So a Meduna scene's only lasting effects are its profile side
effects (§1.8) and Elliot's 17.

ja2-node: `campaignMeanwhileActions` (`src/sim/campaign/narrative/meanwhile-actions.ts`) runs the slaps (the
`QUEEN_SLAP` / `QUEEN_FRUSTRATED_SLAP` animations), the punches (`AiAction.KNIFE_MOVE` with the approach stored in
`npcPunch`), `SHOOT_ELLIOT` (`DESERTEAGLE` at status 100 in hand, `AimShot.HEAD`, `npcShooting` on both, `FIRE_GUN`),
`END_MEANWHILE`, `ENDGAME_STATE_1/2` and the record selectors; the lie prompt is in
`src/sim/tactical/narrative/npc-actions/requestors.ts` (§2.3).

### 1.8 Ending a scene

`EndMeanwhile` (`:531-566`): empty the dialogue queue; `ProcessImplicationsOfMeanwhile()` (§1.9; also for
`INTERROGATION`, which has no case); mark the scene seen (settings); `inScene = false`; NPC reference count 0; clear
`ENGAGED_IN_CONV`; unlock and unpause; locator off. Then:

- **Not `INTERROGATION`**: clear `SHOW_ALL_MERCS`; fade; `DoneFadeOutMeanwhileOnceDone` (`:572-615`): if a world was loaded,
  `SetCurrentWorldSector(old)` (the player's sector is **reloaded from its temp files**, with every side effect of a sector
  entry, `16`) and `ExamineCurrentSquadLights`, else `TrashWorld` and no world; restore the selected map sector;
  `RestoreNPCMeanwhile` (`:509-525`: sector := saved, **`gridNo := (INT8)saved gridNo`** (vanilla too,
  `V:Strategic/Meanwhile.c:696, 736`), `ReloadQuoteFile` again); back to the map screen if the box was opened there, else
  the team panel.
- **`INTERROGATION`**: enemy-present music and `RestoreNPCMeanwhile`; **no reload**: the player stays in N7 tactical with
  the captives ("we leave this sector open for our POWs to escape", `:560`).
- **ESC** during any scene but `INTERROGATION` calls `EndMeanwhile` at once (`Turn_Based_Input.cc:2185-2192`).

Net profile effects of a played scene on QUEEN, ELLIOT (and JOE where moved): `useProfileInsertionInfo` cleared, `gridNo`
truncated to INT8, record states reset by the two reloads; the sector is unchanged. The scene soldiers (the gun given by
`SHOOT_ELLIOT`, Elliot's wounds) are not written back: the scene map saves no temp file and no NPC data
(`Tactical_Save.cc:278-286`, inferred for the NPC data).

**Screens and compression.** A scene started from the map screen leaves it for tactical (`EnterSector` sets the pending
screen, `StrategicMap.cc:591-597`), which sets compression to X1 (`MapScreen.cc:3236-3246`); coming back, X1 is not a map
mode, so the mode becomes X0 (`MapScreen.cc:1420-1430`): **after a played scene on the map, time compression is stopped
and the remembered mode is lost**. A skipped scene only unpauses.

### 1.9 `ProcessImplicationsOfMeanwhile` (`:440-506`), at the end of a played scene or on Skip

| Scene | Effect |
|---|---|
| `END_OF_PLAYERS_FIRST_BATTLE` | hard difficulty: `ExecuteStrategicAIAction(WAKE_QUEEN)`; then `HandleNPCDoAction(QUEEN, SEND_SOLDIERS_TO_BATTLE_LOCATION)`, a no-op (`17` §9.4–9.5) |
| `CAMBRIA_`, `ALMA_`, `GRUMM_`, `CHITZENA_`, `BALIME_LIBERATED` | `WAKE_QUEEN` |
| `DRASSEN_LIBERATED` | `WAKE_QUEEN`, then the no-op `SEND_SOLDIERS_TO_DRASSEN` |
| `NW_SAM`, `NE_SAM`, `CENTRAL_SAM` | `ExecuteStrategicAIAction(NPC_ACTION_SEND_TROOPS_TO_SAM, SAM 0/1/2 sector)` (`17` §9.5: elite squad `3 + d + highestProgress/15`) |
| `CREATURES` | `HandleNPCDoAction(QUEEN, NPC_ACTION_ADD_RAT)`: `profiles[RAT].sector = G9` (`Interface_Dialogue.cc:3787-3790`) |
| `AWOL_SCIENTIST` | `StartQuest(QUEST_FIND_SCIENTIST, (−1, −1))` (`25`); find the MADLAB placement sector flagged `SF_USE_ALTERNATE_MAP` by `InitNPCs` (`J:strategic-map-npc-placements.json`: H7, H16, I11, E4); none → an error log and sector (0, 0, 0); `profiles[MADLAB].sector = profiles[ROBOT].sector = it` |
| `FLOWERS`, `LOST_TOWN`, `INTERROGATION`, `KILL_CHOPPER`, `OUTSKIRTS_MEDUNA` | nothing |

`ExecuteStrategicAIAction(WAKE_QUEEN)` runs `WakeUpQueen` (mass fortification on the first wake, `17` §9.1–9.2). The
implications run while the scene map is loaded; nothing in them reads the loaded world (inferred). ja2-node:
`processImplicationsOfMeanwhile` (`src/sim/strategic/ai/meanwhile.ts`) has every row; the no-op NPC actions are not called.

### 1.10 Played versus skipped

| Effect | Played (OK) | Skipped (Skip) | ESC in the scene |
|---|---|---|---|
| Flag, def, Elliot's counter | at scheduling, both | same | same |
| Implications (§1.9) | yes | yes | yes |
| Scene marked seen (settings) | yes | no | yes |
| Profile side effects on QUEEN/ELLIOT/JOE (§1.8) | yes | no | yes |
| `ELLIOT.npcData = 17` in `OUTSKIRTS_MEDUNA` | yes | no | if reached before ESC |
| Player's world unloaded and reloaded (temp files, sector-exit and entry quest code (`35`), first-battle trash hook, `InitializeTacticalStatusAtBattleStart`, militia reset, the entry draws of `16`) | yes | no | yes |
| Map screen: compression stopped, mode X0 | yes | no (compression resumes) | yes |

### 1.11 Interplay summary

- **Compression**: the event interrupts the pass; the pause lock blocks compression until the box is answered; a played
  scene from the map stops compression (§1.8). **Combat**: delayed by 3–5 minutes per firing while the loaded sector has
  enemies. **PBI**: the box waits for it; a meanwhile due this second delays arrivals by a minute, so it never opens a PBI
  at the same second. **Laptop**: paused, no events; the florist's scene fires a day or more later. **Map screen**: exits
  refused while `trying`. **Tactical traversal**: precedence off. **Saving**: refused in a scene; map-screen save refused
  while `trying`. **Dead is Dead**: autosave at begin. **A scene while the player is in P3 itself** reuses the loaded P3
  world instead of `P3_m` (`SetCurrentWorldSector` returns early for the same sector, `StrategicMap.cc:433-466`; irrelevant
  to ja2-node).

---

## 2. ja2-node: meanwhile scenes without cutscenes

### 2.1 Played semantics when the gates pass

No Meduna scene is played. It resolves atomically with the state effects of a **played** scene (§1.10 first column, minus
the reload of the player's sector), because the first viewing cannot be skipped in the original and the seen flags are an
installation setting, not campaign state (deviations.md "Meanwhile scenes"). The skipped variant (no profile effects,
Elliot never shot, compression continues) is rejected. The original's window between the event and the box is kept as
`trying`, so the same things wait. `MeanwhileFlow` (`src/sim/campaign/meanwhile-flow.ts`):

```
handleMeanwhileEvent(e):                                    // EVENT_MEANWHILE, src/sim/strategic/ai/meanwhile.ts
  if world.enemyInSector(): repost at e.stamp + 180 + R(121), offset copied; return
  current = defs[e.param]; trying = true; pauseGame(); lockPause(6 = MEANWHILE); npcSaves = []; interruptTime()

afterStep(), every campaign tick while trying and the flow is tactical or strategic:
  if a battle decision is open or the dialogue queue is busy / somebody talks (24): wait
  trying = false
  if current.id == INTERROGATION: startInterrogation(); return                         // §2.3
  resolveMeduna(current.id)

resolveMeduna(id):
  if flow == strategic: stopTimeCompression(MEANWHILE); setCompressionLevel(X0)        // §1.8
  handleFirstMeanwhileSetUpWithTrashWorld()                                           // the scene load trashes the world
  inScene = true                                                                      // ReloadQuoteFile picks the scene records
  for p in [QUEEN, ELLIOT] + (id == OUTSKIRTS_MEDUNA ? [JOE] : []):
      npcSaves.push({p, sector, gridNo}); reloadQuoteFile(p); changeNpcToDifferentSector(p, P3)
  elliotBefore = ELLIOT.npcData
  if id == OUTSKIRTS_MEDUNA: ELLIOT.npcData = 17                                      // SHOOT_ELLIOT
  context = sceneContext(elliotBefore, ELLIOT.npcData)                                // §2.4
  emptyDialogueQueue(); processImplicationsOfMeanwhile(id)                            // §1.9
  inScene = false; unLockPauseState(); unPauseGame()
  for s in npcSaves: sector = s.sector; gridNo = i8(s.gridNo); reloadQuoteFile(s.p)   // RestoreNPCMeanwhile: normal records
  log.push({seq, id, at: worldSeconds, context}); emit meanwhile {seq, scene, sector: 'P3', at}
```

`handleFirstMeanwhileSetUpWithTrashWorld` runs unconditionally: the played path trashes a world when it loads `P3_m` even
if none was loaded. The player's loaded sector stays loaded and untouched (deviations.md "Meanwhile without sector
reload").

### 2.2 Not a decision prompt

The box offers no choice that changes campaign state once the reload is gone (§1.10), so a Meduna scene is **not** a
decision prompt and does not wait for the client (D15: informational). It surfaces as the `meanwhile` event and the scene
log (`29`). On the map the compression stop (`compressionStopped {reason: 'meanwhile'}`) ends a default strategic
`advance` (`04` §4.2), mirroring the original's interruption; a tactical `advance` does not stop on `meanwhile` by default.
While `trying` is set, the campaign is not idle, compression is refused (`compressionRefusal`) and saves are refused
(`meanwhileStarting`, `src/server/save-rules.ts`). Only `INTERROGATION` contains real decisions (§2.3).

### 2.3 `INTERROGATION`: a scripted tactical scene

The interrogation changes captives' life and experience, sets facts and offers lie prompts, and it ends with the player
in N7. It is simulated on `24`'s record engine and `11`'s melee:

1. `startInterrogation`: on the map compression stops (the mode is not reset: the player ends in tactical and never
   returns to the map screen, §1.8); `handleFirstMeanwhileSetUpWithTrashWorld` when no tactical world is loaded (else
   the unload in step 2 runs it); `inScene = true`; QUEEN, ELLIOT and JOE saved and moved to N7 as in `resolveMeduna`;
   event `meanwhileStarted`.
2. N7 loads through the sector flow (`16`, `setCurrentWorldSector`) with the meanwhile rules of §1.6: the current
   sector is unloaded and its diff saved; N7's normal map with only its item diff (the captives' dropped gear, hidden at
   12089); enemies placed (`PrepareEnemyForSectorBattle`); `SF_ALREADY_VISITED` not set; the captives placed on
   7756–7758 and, being POWs in a sector other than I13, put on one new squad and made non-neutral (§3.4); QUEEN, ELLIOT,
   JOE placed by profile. If N7 cannot load or no talk host exists, `endMeanwhile` runs at once.
3. `ENGAGED_IN_CONV`, NPC reference count 1, `TriggerNPCRecordImmediately(current.npc = QUEEN, current.trigger = 0)` with
   QUEEN and ELLIOT on their `INTERROGATION` record sets (`J:script-records-control.json`, id 11).
4. The scene runs on tactical ticks with the world clock paused and the §1.6 rules on (always hit, halved punches without
   breath loss, no bleeding, no getting up, no combat mode, no quotes, unconscious → QUEEN `DONE_SLAPPED`). The Queen's
   talk panel stays open, and the freeze that an idle conversation puts on tactical ticks (`24`) does not apply while
   `inScene`, as the original's scene keeps animating. Player commands other than queries, `answer` and `skipLine` are
   refused (`inMeanwhile`, `src/sim/campaign/story-refusals.ts`); ESC does not end it (§1.8).
5. `PROMPT_PLAYER_TO_LIE` closes the talk panel (`DeleteTalkingMenu`) and opens the `npcRequest` prompt with
   `request: 'lie'`, choices `yes`, `no`, `lie` (`Interface_Dialogue.cc:4341-4376`): yes → QUEEN record `r + 1`, no →
   `r + 2` (`r` = the record that raised the prompt; record numbers wrap at 8 bits); lie → the liar is the placed merc
   with life ≥ OKLIFE and breath ≥ OKBREATH maximising `EffWis(s) + EffLead(s) > EffWis(liar) + EffLead(s)` — **the
   candidate's leadership on both sides**, so wisdom decides (quirk, keep; `chooseLiar`) — and
   `SkillCheck(liar, LIE_TO_QUEEN_CHECK, 0) ≥ 0` → `r + 4`, else (or no liar) `r + 3`. The check
   (`Tactical/SkillCheck.cc:146-385`): skill `50·(EffWis + EffLead) / (QUEEN.wisdom + QUEEN.leadership)` (`:277-280`), minus
   the fatigue penalty, plus the morale modifier, clamped 0..99, success iff `PR(100) ≤ chance`; a failure also draws
   `R(100) < 40` for a curse that this reason keeps silent (`skillCheck`, `src/sim/tactical/combat/skill-check.ts`,
   reason `LIE_TO_QUEEN` 12). The check is not shown (the original shows none).
6. `REMOVE_ELLIOT_END_MEANWHILE` → `endMeanwhile` (INTERROGATION branch): empty queue, implications (none),
   `inScene = false`, conversation unlocked, unlock and unpause, `RestoreNPCMeanwhile`; the log gets the entry (context
   `null`) and `meanwhileEnded` is emitted; play continues in tactical **in N7** with the captives; the previous world is
   not restored.

### 2.4 The scene log

Each resolved scene appends `{seq, id, at, context}` to `meanwhile.log` (the view lists it as
`observe.strategic.meanwhiles`, `29`). `context` (`MeanwhileContext`, `queen-state.ts`) freezes what the scene's record
selectors would read at play time (§1.7): `wholeTownsExceptOmerta`, `samSitesControlled`, `lastBattleWon`,
`functionalSamInLastBattleSector`, `firstBattleTown` (`drassen`, `cambria`, `other`), `sciFi`, `elliotBefore`,
`elliotAfter`; all player-known. It was meant for a server-side playback of the scene (a disposable tactical session on
`P3_m` running the scene's records from the frozen context on the `fx` stream, never touching the campaign); that sandbox
is not built, so the client shows only the box and nothing is marked seen (`30` §7, gaps.md "Meanwhile scene
playback").

---

## 3. Prisoners: capture, Alma, the interrogation and escape

### 3.1 Ownership

Capture mechanics are `17` §10.11 and `19` and `19` (`src/sim/campaign/merc-fate.ts`: `beginCaptureSequence`,
`endCaptureSequence`, `enemyCapturesPlayerSoldier`; `battle-flow.ts` for the tactical loss). The quests `HELD_IN_ALMA` and
`INTERROGATION` (state, `StartQuest`/`EndQuest`, history) are `25`'s; this section gives *when* the narrative path calls
them and what else happens.

### 3.2 Capture entry points

| Path | Where | Captured |
|---|---|---|
| Tactical loss with 2–3 incapacitated real mercs, an active enemy team, and Alma not started or (Alma done and interrogation not started) | `Overhead.cc:5010-5072` (`19`) | each in-sector merc with life ≠ 0 |
| Tactical surrender: an enemy offers (`DecideAction.cc:2641-2654`, `13`) through a civilian quote (`24`) and the player accepts the yes/no box | `Tactical/Civ_Quotes.cc:150-178, 196-205` | every in-sector merc with life ≠ 0 |
| Autoresolve surrender or capture (from day 4; refused once the rescue flag is set, so normally only the first capture) | `Auto_Resolve.cc:3359-3433` (`19`) | the involved cells |

Each path runs `BeginCaptureSquence`, `EnemyCapturesPlayerSoldier` per merc, then `EndCaptureSequence`. The tactical
surrender then shows the "you surrendered" box after 3 s (`gfSurrendered`, `Overhead.cc:6011-6024`), the loss the
"captured" box; both lead to `CheckAndHandleUnloadingOfCurrentWorld` (ja2-node: deviations.md "Surrender in tactical
combat"). `EnemyCapturesPlayerSoldier` returns early once `ubNumCapturedForRescue > 3`, so a surrender of five or more
removes the others from the tactical sector without capturing them (inferred from `Civ_Quotes.cc:158-165`); the fourth
captive (index 3) indexes past the three-entry grid arrays (undefined behaviour; `merc-fate.ts` falls back to the first
grid and item grid 0).

### 3.3 `EndCaptureSequence` (`Queen_Command.cc:1110-1143`)

```
if !(RESCUE and ESCAPE flags both set):
  if quest HELD_IN_ALMA not started: flags |= RESCUE; StartQuest(HELD_IN_ALMA, world sector)          // history (25)
  elif HELD_IN_ALMA done and INTERROGATION not started:
      StartQuest(INTERROGATION, world sector); flags |= ESCAPE
      ScheduleMeanwhileEvent(N7, 0, INTERROGATION, QUEEN, 10)       // minute 10 of day 0: due at the next event pass
  else: flags |= RESCUE | ESCAPE
```

The first capture goes to Alma unless Alma I13 holds no enemies when the first captive is processed: then
`EnemyCapturesPlayerSoldier` starts and ends `HELD_IN_ALMA` silently (`InternalStartQuest`/`InternalEndQuest` without
history, `:1208-1215`), the captives go to N7, and `EndCaptureSequence` starts the interrogation at once (quirk: with Alma
liberated the first capture is already the interrogation). `INTERROGATION` is **never ended** anywhere, so after it no
further capture can happen (the capture tests require it not started) (quirk, keep). ja2-node: `endCaptureSequence`
calls `startQuest` and the `interrogationMeanwhile` hook, which `battle-flow.ts` binds to `scheduleInterrogation`
(`meanwhile.ts`).

### 3.4 Captives on a sector load (`StrategicMap.cc:975-1006`, in `UpdateMercsInSector`)

For each POW of the loaded sector (not when loading a save): in **I13** show the "POW mercs are here" box (once per POW:
the squad variable is never set there, inferred) and leave them POWs; anywhere else (N7) put the first on a new squad,
make him non-neutral and add the others to that squad. Then, if `HELD_IN_ALMA` is in progress, `EndQuest(HELD_IN_ALMA)`
and `GRANT_EXPERIENCE_3` (+100 experience to the conscious in-sector members of the current squad, i.e. the rescuers; the
POWs are on no squad). In I13 the POWs (neutral, in locked cells, `Queen_Command.cc:1228-1241`) are freed by
`DoPOWPathChecks` (`Overhead.cc:6027-6048`), called after a door opens (`Tactical/Handle_Doors.cc:889`) and after an
explosion (`TileEngine/Explosion_Control.cc:1444`): a POW with a path to 10492, 10482 or 9381 becomes non-neutral, joins
any squad and cheers.

ja2-node: `PowFlow` (`src/sim/campaign/pow.ts`): the sector flow calls `beginSectorLoad`, `powPlaced(m)` per placed POW
(squad, neutrality, the quest end and `ExperienceBonus.AVERAGE`) and `endSectorLoad`, which emits one `powsFound` with the
I13 prisoners; `checkPowPathsInAlmaPrison` (`src/sim/tactical/narrative/pow-rules.ts`) runs `doPowPathChecks` after a door
opens and after an explosion in I13 (`findBestPath` with `THROUGH_PEOPLE`), emitting `powFreed` per freed merc.

### 3.5 N7 after the interrogation

The interrogation (§2.3) leaves the captives in N7 tactical on their own squad with N7's garrison present: the escape is
an ordinary battle or a walk off the map. Their gear lies hidden at 12089 in the same sector. Strategic status of POWs
while held (contracts frozen, no morale decay, no healing assignments, excluded from compression's usable mercs) is
`22` §2.1, `18`, `15` §1.6.

---

## 4. Progress and first-battle triggers

### 4.1 `HourlyProgressUpdate` events (`Tactical/Campaign.cc:1289-1325`)

When the current progress (`17` §11.3) exceeds the highest so far, in this order, each on the first crossing
(`current ≥ t && highest < t`, policy `J:game.json` `progress.event_*_min`): **35** → `HandleScientistAWOLMeanwhileScene`
(§1.1, scene 14); **50** → `SetFactTrue(FACT_MIKE_AVAILABLE_TO_ARMY)` (consumed by soldier creation:
`Tactical/Soldier_Create.cc:2068-2085` sets the fact to 2 when it turns one elite into MIKE, `17` §10.4, `25`); **70** →
`profiles[IGGY].sector = C5`. Then `highest = current`. One jump can fire all three. ja2-node: `hourlyProgressUpdate`
(`src/sim/strategic/ai/difficulty.ts`) returns the milestones, `applyProgressMilestones`
(`src/sim/strategic/narrative/hourly.ts`) applies them from the narrative flow's hourly slot.

### 4.2 The first battle

`FACT_FIRST_BATTLE_BEING_FOUGHT` is set when a merc first sees an army soldier (`OppList.cc:1792-1797`) or the PBI opens
for a non-bloodcat encounter (`PreBattle_Interface.cc:187-192`), while `FACT_FIRST_BATTLE_FOUGHT` is false. At the end:

| End | Facts | Then |
|---|---|---|
| Tactical win (`Overhead.cc:4683-4694`) | FOUGHT, WON, not BEING_FOUGHT; `SetTheFirstBattleSector` (first write only, `Strategic_Town_Loyalty.cc:1131-1137`) | `TriggerNPCRecord(PACOS, 18)` (`24`), then `HandleFirstBattleEndingWhileInTown(world, FALSE)` |
| Tactical loss (`:4481-4488`) | FOUGHT, not BEING_FOUGHT; sector | `HandleFirstBattleEndingWhileInTown(world, FALSE)` |
| Autoresolve (`Auto_Resolve.cc:1278-1288`), any end, when FOUGHT is false | FOUGHT, WON on victory; sector | `HandleFirstBattleEndingWhileInTown(sector, TRUE)` |

The classic case: the landing fight in Omerta is a town battle in tactical, so the scene waits until the squad first
loads another sector (§1.3). `DidFirstBattleTakePlaceInThisTown` (`:1141-1145`) feeds the scene's record selectors.
ja2-node: `battle-flow.ts` (`#tacticalVictory`, `#tacticalDefeat`, the autoresolve end → `#firstBattleEnded`); the trash
hook runs from the sector flow's world unload.

### 4.3 Liberation, loss, SAM and outskirts: call order

In `SetThisSectorAsPlayerControlled` (`Player_Command.cc:57-218`, `18`) for an enemy-controlled sector taken in a
contested fight: town morale and loyalty, then the whole-town check (town scene); mine; SAM (SAM scene first, then
morale, loyalty, Skyrider's line, grace days); refuel site; **outskirts scene**; then
`StrategicHandleQueenLosingControlOfSector`. Same-second scenes keep this order in the queue (`lastScheduledId` ends as the
last one). ja2-node: `liberate` (`src/sim/strategic/map/control.ts`) calls `ai.medunaOutskirtsTaken` last, after the
`sectorLiberated` hooks; `setThisSectorAsPlayerControlled` then calls `queenLostControlOfSector`.

### 4.4 Progress-related narrative owned elsewhere

Enrico's progress and setback mails and "lack of progress" (`HandleEnricoEmail`, `Strategic/Strategic_Status.cc:246-376`;
`21`, `18`); the computed facts `FACT_PLAYER_DOING_POORLY/WELL/VERY_WELL` (< 20, > 50, > 80 %,
`Strategic/Quests.cc:861-871`; `25`); Skyrider's progress comments on helicopter routes (`MapScreen.cc:7341-7380`,
`gubPlayerProgressSkyriderLastCommentedOn`; `25`); merc morale `progress/5` (`Morale.cc:255`, `22`); dealer coolness (`23`);
the creature quest triggers (`17` §12).

---

## 5. Meduna: the palace, the Queen's escape, the statue

### 5.1 Palace placement (`35` owns placement)

In P3 outside meanwhiles (`Tactical/Soldier_Init_List.cc:500-519`): with `FACT_QUEEN_DEAD` the Queen's civilian group
(`QUEENS_CIV_GROUP`) is not placed; otherwise the Queen stands at 11448 when `gfUseAlternateQueenPosition`, and civilians
of other groups are not placed (the townsfolk appear only after her death). `gfUseAlternateQueenPosition` is set when the
player takes P3 b1 (`Player_Command.cc:196-200`; ja2-node `queenBasementTaken`). `FACT_QUEEN_DEAD` is computed from the
Queen's profile status (`Quests.cc:713-715`), not stored.

### 5.2 The escape to the basement (body of `13`'s hook)

QUEEN (and JOE while they see no enemy) in P3, able to move, without the alternate position (`DecideAction.cc:1502-1514,
2522-2535`) call `HeadForTheStairCase` (`TacticalAI/PanicButtons.cc:476-502`): if P3 b1 was ever loaded and holds fewer than
5 enemies → nothing; fewer than 2 tiles (`PythSpacesAway`) from 12067 → `AI_ACTION_TRAVERSE_DOWN`; else walk to 12067 if a
path exists. `TRAVERSE_DOWN` (`TacticalAI/AIMain.cc:1803-1816`): end the AI turn (turn-based), profile `sectorZ++` and
`useProfileInsertionInfo = false`, remove the soldier, `CheckForEndOfBattle(TRUE)`. She is then placed in P3 b1 when the
player enters it. Entering through the basement first (the statue route, §5.3) keeps her upstairs at 11448. ja2-node:
`queenEscape`, `headForTheStairCase`, `traverseDown` (`src/sim/tactical/ai/queen-escape.ts`), called from the red and
black decisions (`combat-decide.ts`).

### 5.3 The O3 statue (`End_Game.cc:37-128`)

The palace basement is reachable through a statue in O3. `ChangeO3SectorStatue(fromExplosion)` writes a map modification:
remove the statue struct at 13830 (`EIGHTOSTRUCT` 5), add the damaged (7, explosion) or opened (8) one, add an exit grid
at 13669 to O3 b1 gridno 13037 and reveal 13669, recompute movement costs around 13830. Triggers: using a `REMOTETRIGGER`
in O3 room 4 (`Tactical/Handle_Items.cc:2541-2552`, otherwise a curse), or an explosion's structure damage at distance ≤ 1
from 13829, 13830, 13669 or 13670 while O3 is loaded and the exit grid does not exist yet (`HandleStatueDamaged`, listener
on `BeforeStructureDamaged`, `Overhead.cc:317`, `Explosion_Control.cc:341-348`): the statue then takes no damage. Who hands
out the remote is `35`'s business.

ja2-node: `src/sim/tactical/narrative/statue.ts` (`changeO3SectorStatue` with a recompile radius of 5, recording the
structure swap and the exit grid in the map changes; `statueTakesExplosion` from the structure-damage code;
`useStatueRemote` from the `useRemote` command, 2 AP and 2 more when standing, `29`), event `statueOpened {sector,
destroyed}`.

### 5.4 The Queen's story reactions beyond `17`

Two beyond `17` §9: her death puts the AI to sleep (`QUEEN_DEAD`, `17` §9.5) **but every wake trigger still works**, so a
scene scheduled after her death (only possible while the ending waits for the creature queen, §6.6) still wakes the AI
through its implications (quirk; the original would also try to play the scene with a dead Queen, which only ESC ends,
inferred; ja2-node runs the implications without a scene). And `GLOBAL_LOYALTY_QUEEN_BATTLE_WON` runs
`CheckConditionsForTriggeringCreatureQuest` (`Strategic_Town_Loyalty.cc:876-879`, `18`), so a sci-fi game holding
three infestible mines starts the creature quest at the moment she dies.

---

## 6. The Queen's death and the end of the campaign (original)

### 6.1 Trigger

At the death commit (`33`) `HandleNPCTeamMemberDeath` (`Tactical/Overhead.cc:2273-2529`) marks the profile dead
(`bMercStatus = MERC_IS_DEAD`, life 0, history, `:2282-2293`), and in the civilian-team branch, after the per-profile
switch, calls `BeginHandleDeidrannaDeath(killer, gridNo, level)` for profile QUEEN (`:2423-2426`); `killer` is the
soldier's `attacker` and may be null. For a creature with body `QUEENMONSTER` killed by someone (killer not null) it calls
`BeginHandleQueenBitchDeath` at the top of the enemy/creature branch (`:2450-2454`). ja2-node: `civilianDeathRules`
(`src/sim/tactical/narrative/death-rules.ts`) calls `t.narrative.deidrannaDied`; `handleNPCTeamMemberDeath`
(`src/sim/tactical/combat/death.ts`) calls `t.narrative.creatureQueenDied` for `QUEENMONSTER` with or without a killer
(§7.3).

### 6.2 Two seconds (`BeginHandleDeidrannaDeath`, `End_Game.cc:139-154`)

Remember killer, gridno and level; `ENGAGED_IN_CONV` (the conversation UI lock, `24`), NPC reference count 1,
`IN_DEIDRANNA_ENDGAME` (camera on 4561 when the tactical screen is entered, `GameScreen.cc:186-189`; no auto-bandage,
`Tactical/Auto_Bandage.cc:192-196`); a 2-second wall-clock timer calls `HandleDeidrannaDeath`. Tactical play goes on
meanwhile (AI turns are not stopped by the lock, inferred).

### 6.3 `HandleDeidrannaDeath` (`:160-209`)

Victory music; the killer says `QUOTE_KILLING_DEIDRANNA`; every other OUR merc that is controllable, not gassed, not an
EPC, marked in `QuoteExp_WitnessDeidrannaDeath[profile]` (`Tactical/QArray.cc:334`, 73 entries: profiles beyond them are
never witnesses, only the killer speaks) and has line of sight to the death tile (`DistanceVisible` +
`SoldierTo3DLocationLineOfSightTest(…, 3, …)`) says it too, all through the dialogue queue; `SetFactTrue(FACT_QUEEN_DEAD)`
(a computed fact: it re-reads the profile status, `Quests.cc:713-715`); `ExecuteStrategicAIAction(QUEEN_DEAD)` (AI asleep,
`17` §9.5); a dialogue-queue event that, after the quotes, fades the screen out into `DoneFadeOutKilledQueen`.

### 6.4 `DoneFadeOutKilledQueen` (`:225-302`)

```
upstairs = P3, level 0
for s in OUR team: if life >= OKLIFE and in sector and s.assignment == CurrentSquad():
    tacticalTraversal = true; SetGroupSectorValue(upstairs, s's group)           // the whole group moves
    s.sector = upstairs; insertion GRIDNO 5687, facing 100 + NORTHWEST
for e in ENEMY team, not neutral, not friendly: ProcessQueenCmdImplicationsOfDeath(e)   // strategically dead (docs/17 §10.7)
ExitCombatMode(); fLastBattleWon = true; fEnemyInSector = false
HandleMoraleEvent(none, MORALE_QUEEN_BATTLE_WON, upstairs)        // strategic +8 (Morale.cc:63)
HandleGlobalLoyaltyEvent(GLOBAL_LOYALTY_QUEEN_BATTLE_WON, upstairs)  // +1000, creature-quest check first (docs/18 §2.4)
SetThisSectorAsPlayerControlled(world sector, TRUE)               // basement: only the alternate-queen flag (§5.1)
world.z = 1                                                        // forces the reload below
P3 surface counts (admins, troops, elites and the in-battle ones) = 0     // groups in P3 are left alone
profiles[ELLIOT].sector.x = 1                                      // "get rid of Elliot in P3"
ChangeNpcToDifferentSector(DEREK, upstairs); ChangeNpcToDifferentSector(OLIVER, upstairs)
SetCurrentWorldSector(upstairs)                                    // docs/16 §5: unload, load P3 with the current squad at 5687
tacticalTraversal = false; fade in → DoneFadeInKilledQueen
```

Quirks: only the current squad's conscious in-sector mercs get the insertion grid, but `SetGroupSectorValue` moves their
whole groups. The forced `z = 1` makes the unload save the current world's state under **P3 b1**: when the Queen dies in
the basement (the normal case) that is correct; when she dies upstairs (the statue route, §5.2) the surface's items,
corpses and doors are written over the basement's temp data and the surface is reloaded from its own older temp data
(inferred from `SetCurrentWorldSector`, `StrategicMap.cc:433-457`, and `Tactical_Save.cc:278-319`). ja2-node keeps it
(D1).

### 6.5 Derek, Oliver and the two endgame states

`DoneFadeInKilledQueen` (`:212-222`): if DEREK has a soldier in the loaded sector, `TriggerNPCRecordImmediately(DEREK, 6)`;
**otherwise nothing**, leaving `ENGAGED_IN_CONV` and `IN_DEIDRANNA_ENDGAME` set: the UI stays locked (softlock, inferred).
DEREK's record 6 requires `FACT_QUEEN_DEAD` and starts a chain through OLIVER's records (data, checked on the original
data) that ends in:

- `NPC_ACTION_ENDGAME_STATE_1` (`Interface_Dialogue.cc:3792-3807`): if `gubQuest[15]` (`QUEST_CREATURES`, hard-coded
  index) is in progress → `TriggerNPCRecordImmediately(DEREK, 8)` and `EndQueenDeathEndgame()` (unlock, clear
  `IN_DEIDRANNA_ENDGAME`, `:340-348`): **the game continues** until the creature queen dies (§6.6); else
  `DeleteTalkingMenu` and `EndQueenDeathEndgameBeginEndCimenatic()` (§6.7).
- `NPC_ACTION_ENDGAME_STATE_2` (`:3809-3814`): `DeleteTalkingMenu`, `EndQueenDeathEndgame()`; the end of DEREK's record-8
  chain.

`QUEST_CREATURES` starts only when a mine is first invaded (`Strategic/Strategic_Mines.cc:217-222`) and ends when the
creature queen dies (`Queen_Command.cc:888-897`), so an active creature lair that has not yet invaded a mine does not
delay the ending.

### 6.6 The creature queen (`BeginHandleQueenBitchDeath`, `:378-413`; `HandleQueenBitchDeath`, `:416-458`)

Lock the UI as in §6.2 (without `IN_DEIDRANNA_ENDGAME`); a 3-second timer; immediately every living creature-team soldier
takes a 10 000-damage hit (`EVENT_SoldierGotHit`, attack-busy count raised per creature, `33`). After 3 s: victory music;
the killer and line-of-sight witnesses marked in `QuoteExp_WitnessQueenBugDeath` (`QArray.cc:419`) say
`QUOTE_KILLING_QUEEN`; then `FACT_QUEEN_DEAD` → `EndQueenDeathEndgameBeginEndCimenatic()`, else just unlock. A creature
queen dying **without a killer** skips all of this: with Deidranna already dead the end cinematic can then never start
(inferred; ja2-node deviates, §7.3).

### 6.7 The end cinematic, credits, restart: what counts as winning

`EndQueenDeathEndgameBeginEndCimenatic` (`:308-337`): `IN_ENDGAME_SEQUENCE`; **every** OUR merc with life ≥ OKLIFE that is
not an EPC says `QUOTE_END_GAME_COMMENT` (no in-sector test); a dialogue-queue event after them calls
`EndQueenDeathEndgame()` and fades out to `DoneFadeOutEndCinematic` (`:351-366`): clear the flag, leave tactical for the
intro screen in `INTRO_ENDING` mode. The ending videos (`Intro.cc:283-306`): the throne speech with or without MIGUEL (his
profile dead or not), the helicopter fly-by, then with or without SKYRIDER (same test). Leaving the intro
(`PrepareToExitIntroScreen`, `:223-248`) calls `ReStartingGame()` (`Strategic/Game_Init.cc:291-330+`: world, soldiers,
laptop, profiles, quote files, dealers reset) and goes to the credits, which return to the main menu
(`Credits.cc:169-185`).

So **the campaign is won when `EndQueenDeathEndgameBeginEndCimenatic` runs**: Deidranna (profile QUEEN) is dead and either
`QUEST_CREATURES` was not in progress at `ENDGAME_STATE_1`, or the creature queen was killed afterwards by someone.
Nothing of the campaign survives the victory except the player's saves; there is no post-victory play.

### 6.8 There is no game over

No losing screen or rule exists (the only exits are the victory path above, the player's quit
`EndGameMessageBoxCallBack`, `GameLoop.cc:314-327`, and the demo-only `NPC_ACTION_END_DEMO`,
`Interface_Dialogue.cc:3458-3462`). When every merc is dead or captured, battles end through the lost-battle path
(`19`) and the world unloads; on the map, time compression is refused with "no usable mercs" (`MapScreen.cc:6259-6268`,
`AllowedToTimeCompress`, `15` §1.6, where mercs in transit count as usable), so the clock only moves again after a new
hire. A player without money and mercs is stuck but never told the game is over. ja2-node does the same:
`compressionRefusal` answers `noUsableMercs` ("no usable mercs are left on the team",
`src/sim/campaign/compression-refusals.ts`), and the strategic view carries `noUsableMercs: true`; there is no derived
"stalled" signal.

---

## 7. ja2-node: the endgame

### 7.1 State and reported flow

`EndgameFlow` (`src/sim/campaign/endgame-flow.ts`) drives `StrategicState.ending` (`EndingState`,
`src/sim/campaign/ending-state.ts`): `phase` (`none`, `deidrannaTimer`, `deidrannaQuotes`, `derek`, `creatureTimer`,
`endComments`, `ended`), `killer` (soldier id or null), `gridNo`, `level`, `dueTick`, `inDeidrannaEndgame`,
`inEndgameSequence`, `victory`. The campaign's own flow stays `tactical`; the reported flow is derived (`storyFlow`,
`src/sim/campaign/story-refusals.ts`): `ended` once `victory` is set, `endgame` while `inDeidrannaEndgame` or
`inEndgameSequence`, `meanwhile` while `meanwhile.inScene`. `campaignStatus` gives `playing | endgame | won`. Refusals:
`endgameInProgress` for every command but queries, `answer` and `skipLine`; `campaignOver` for everything once ended (the
campaign's `step()` then does nothing and `advance` stops with `ended`, `29`). The creature-queen sequence of §6.6 runs
under the conversation lock without the `endgame` flow until the end cinematic.

### 7.2 Steps

```
deidrannaDied(killer, gridNo, level):                                      // §6.1–6.2
  ending.{killer, gridNo, level} = …; conversation lock (engaged, reference count 1); inDeidrannaEndgame = true
  phase = deidrannaTimer; dueTick = tick + 400                                // 2 s
  emit queenKilled {sector, gridNo, level, killer}
afterStep, tick ≥ dueTick:                                                 // §6.3
  clear the creature music; killer and witnesses: QUOTE_KILLING_DEIDRANNA (37) through 24's dialogue queue
  setFactTrue(QUEEN_DEAD); executeStrategicAIAction(QUEEN_DEAD); phase = deidrannaQuotes
  queue the dialogue callback 'endgame:deidrannaQuotesDone'
callback: doneFadeOutKilledQueen()                                         // §6.4, atomic; fades take 0 ticks
  … setCurrentWorldSector(P3); clear the creature music; traversal reset; emit squadMovedUpstairs {soldiers, sector: 'P3'}
  phase = derek; DEREK has a soldier → triggerNPCRecordImmediately(DEREK, 6) else endgameState(1)   // deviation
endgameState(1):                                                           // ENDGAME_STATE_1, from the action dispatch
  quests[15] in progress → triggerNPCRecordImmediately(DEREK, 8); unlock; inDeidrannaEndgame = false; phase = none;
                           emit endgameDeferred {reason: 'creatures'}
  else deleteTalkingMenu; beginEndCinematic()
endgameState(2): deleteTalkingMenu; unlock; inDeidrannaEndgame = false; phase = none
creatureQueenDied(killer?, gridNo, level):                                 // §6.6, killer may be null (deviation)
  ending.{killer, gridNo, level} = …; lock; phase = creatureTimer; dueTick = tick + 600; emit creatureQueenKilled {killer}
  every living CREATURE soldier: attackBusyCount++; eventSoldierGotHit(10 000 damage, range 320)
  at dueTick: clear the creature music; QUOTE_KILLING_QUEEN (38) by killer and witnesses
              QUEEN_DEAD ? beginEndCinematic() : unlock, phase = none
beginEndCinematic():
  inEndgameSequence = true; phase = endComments
  QUOTE_END_GAME_COMMENT (69) for every roster merc with life ≥ OKLIFE, not EPC; queue 'endgame:endCommentsDone'
callback: unlock; both endgame flags false; phase = ended
  victory = {at: world seconds, day, ending: {miguelAlive, skyriderAlive}, mercDeaths}   // alive = profile not dead
  emit campaignWon {day, worldTime, difficulty, sciFi, ending, mercDeaths}
```

Witnesses: life ≥ OKLIFE, placed, on a squad (assignment < `ON_DUTY` 20), not gassed, not an EPC, in the table's set
(`narrative-scenes.json`, §10.2) and `soldierTo3DLocationLos` with `distanceVisible` to the death tile at cube level 3.
Timers become ticks (`01` §3.3): 2 s → 400, 3 s → 600; ticks also run in turn-based combat, so the sequence proceeds
whoever's turn it is, as the original's wall-clock timer does (deviations.md "Endgame timing", which also states who
says the end comments). Fades, the ending videos and the credits are presentation (`30` §7; `endingPlan`,
`src/app/video/sequences.ts`); `ReStartingGame` is not reproduced: the session ends.

### 7.3 Softlocks and quirks

| Case | Original | ja2-node |
|---|---|---|
| DEREK absent after the reload | UI locked forever | `ENDGAME_STATE_1` runs at once (deviations.md "Endgame without Derek") |
| Creature queen dies without a killer while Deidranna is dead | never won | counted as killed by the player (deviations.md "Killer-less creature queen"): the ending stays reachable |
| Deidranna dies on the surface | surface state saved as P3 b1 | kept: the forced `z = 1` (D1) |
| Meanwhile scenes after her death | scene with a dead Queen, ESC ends it; AI woken | implications run (AI woken), no scene (§5.4) |

---

## 8. Interfaces with `24`, `25`, `35` and the others

**From `24`:** record triggers (`triggerNpcRecord`, `triggerNpcRecordImmediately`, `triggerNpcWithGivenApproach` with
`TRIGGER_NPC`, `DONE_SLAPPED`, `DONE_PUNCH_0..2`); the per-scene record sets keyed by (meanwhile id, profile) from
`J:script-records-control.json` (`npc-records.ts` `meanwhiles`), active while `inScene` for QUEEN and ELLIOT only;
`reloadQuoteFile`; the dialogue queue with callback events, `dialogueQueueIsEmptyAndNobodyIsTalking`,
`emptyDialogueQueue`, `deleteTalkingMenu`; the conversation lock; the `npcRequest` prompt; the NPC action dispatch; the
civilian quote carrying the surrender offer (§3.2); profile `npcData`. **From `25` and `35`:** quests (`HELD_IN_ALMA`,
`INTERROGATION`, `FIND_SCIENTIST`, `CREATURES`) with history, facts (`QUEEN_DEAD` computed, `MIKE_AVAILABLE_TO_ARMY`,
`FIRST_BATTLE_*`, the unnamed interrogation facts), profile placement and `changeNpcToDifferentSector`, MADLAB's
alternate-map sector from `InitNPCs`, the P3 placement rules (§5.1), the remote trigger's owner (§5.3), the generic
actions `GRANT_EXPERIENCE_*`, `REMOVE_NPC`, `TRIGGER_JOE_32_OR_33`, facings.

**NPC actions owned here (`35`'s catalog points here):** `SLAP`, `FRUSTRATED_SLAP`, `PUNCH_PC_SLOT_0/1/2`,
`PUNCH_FIRST_LIVING_PC`, `SHOOT_ELLIOT`, `TRIGGER_QUEEN_BY_CITIES_CONTROLLED`, `TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED`,
`TRIGGER_ELLIOT_BY_BATTLE_RESULT`, `TRIGGER_ELLIOT_BY_SAM_DISABLED`, `ELLIOT_/QUEEN_DECIDE_WHICH_QUOTE_FOR_PLAYER_ATTACK`,
`PROMPT_PLAYER_TO_LIE`, `REMOVE_JOE_QUEEN`, `END_MEANWHILE`, `REMOVE_ELLIOT_END_MEANWHILE`, `NO_SCI_FI_END_MEANWHILE`,
`ADD_RAT`, `ENDGAME_STATE_1`, `ENDGAME_STATE_2`, and the no-ops `SEND_TROOPS_TO_SAM`, `SEND_SOLDIERS_TO_*`,
`ADD_MORE_ELITES`, `GIVE_KNOWLEDGE_OF_ALL_MERCS`.

**To others:** the posting functions of §1.1 (callers in §11.3); `inMeanwhile()`/`meanwhileId()` for the tactical rules of
§1.6 (`10`, `11`, `13`, `24`); the two queens' death hooks (`33`); the statue hooks on explosions and remote use (`12`); POW
handling on sector load (`16`) and after doors and explosions (`12`).

---

## 9. Determinism

### 9.1 Draws, in order

| Where | Draws | Stream |
|---|---|---|
| Florist order to Meduna, `FLOWERS` flag clear (§1.3) | `R(5)` (next day) or `R(48)`, before the florist's own order-number draw (`21`) | main |
| Helicopter landing able to fly, `KILL_CHOPPER` flag clear | `R(10)` | main |
| `EVENT_MEANWHILE` with enemies in the loaded sector | `R(121)` per repost (repeats for the past-stamped interrogation) | main |
| Scheduling, implications, progress events, first battle | none (the SAM squad's moves draw as `17` §9.5; `WakeUpQueen`'s fortification draws as `17` §9.2) | — |
| `GRANT_EXPERIENCE_3` on the Alma rescue, `GRANT_EXPERIENCE_4` in the interrogation | `StatChange(EXPERAMT, 100 \| 200)` per receiving merc in team order: one `PR(100)` per point (`Tactical/Campaign.cc:208-262`) | pre |
| Capture | captive life `R(21)` | main |
| Interrogation: sector load | `16` entry draws, placements (`16`, `17` §10), enemy creation | main |
| Interrogation: punches | the melee pipeline of `11` (the hit roll is still drawn although the scene forces the hit; damage) | pre / main per `11` |
| Interrogation: `lie` | `PR(100)` in `SkillCheck`; on failure `R(100)` | pre, main |
| Endgame: creature check in the loyalty event | `InitCreatureQuest` draws when it starts (`17` §12) | main |
| Endgame: reload of P3 | `16` entry draws, placements | main |
| Creature queen death | one 10 000-damage hit per creature through `33` | per `33` |

Meduna scenes resolved by ja2-node make **no** draws of their own; the played path's two sector loads (scene map and
reload) are not made (deviations.md "Meanwhile without sector reload").

### 9.2 Wall clock and races replaced

The 2 s and 3 s endgame timers become 400 and 600 ticks; fades take no ticks; the box's wait for "nobody talking" is the
speech channel and dialogue queue of `24`; the original's race between the capture box (a 3 s wall-clock timer) and the
interrogation box is defined as: the lost battle completes and unloads first (`lostBattleUnloadAtMs`, `battle-flow.ts`),
then the interrogation's gates pass (deviations.md "Meanwhile wall-clock races").

### 9.3 Ordering

Same-second scenes resolve in queue order (§4.3); `lastScheduledId` follows scheduling, not resolution. The scene NPC side
effects and the implications run in the order of §2.1; witnesses and end comments in team order (`OUR` ids).

---

## 10. Data, original data, save import, stubs

### 10.1 Used directly (`data/externalized/`)

`script-records-control.json` (per-scene record files for QUEEN and ELLIOT, `fileNameForScriptControlledPCs`),
`strategic-map-npc-placements.json` (MADLAB's four sectors, `useAlternateMap`), `strategic-map-sam-sites.json` (SAM order
D2, D15, I8, N4), `strategic-map-towns.json` (town ids for the liberation scenes), `shipping-destinations.json` (the
florist's Meduna test, `21`), `game.json` `progress.event_madlab_min/mike_min/iggy_min` (`ArmyContent.progress`).

### 10.2 Transcribed table (`tools/transcribe/narrative-scenes.ts` → `data/tables/narrative-scenes.json`)

`scenes` in id order: `name`, `flag` (bit of `uiMeanWhileFlags`), `sector` (P3 or N7), `npcs` (profile names moved
there), `cameraGridNo` (`gusMeanWhileGridNo`), `skippable` (the box offers Skip once seen); `witnesses.deidranna` and
`witnesses.queenBug`: the profile ids whose `QArray.cc` entry is 1. Sources: `Strategic/Meanwhile.h:7-27`,
`Meanwhile.cc:47-66, 96-139, 231, 314-346`, `Queen_Command.cc` `EndCaptureSequence`, `Tactical/QArray.cc:334-500`. Loaded
by `loadNarrativeScenes` (`src/content/narrative/scenes.ts`); the simulation reads only the witness sets (the endgame's
quote timing). The flag bits are `MEANWHILE_FLAGS` and the delays `MEANWHILE_*` in `src/sim/strategic/ai/constants.ts`;
the scene NPCs and sectors are constants of `meanwhile-flow.ts` and `meanwhile.ts`.

### 10.3 Named constants

Delays 5 min, flowers `20 + R(5)` h / `24 + R(48)` h, chopper `55 + R(10)` min, interrogation minute 10, battle delay
`180 + R(121)` s, `ELLIOT_MAX_SLAPS` 17, `MAX_MEANWHILE_PROFILES` 10, `LOCK_PAUSE_MEANWHILE` 6, Meduna HQ P3 and N7, the
outskirts M2–M6 and N6, RAT's G9, IGGY's C5; endgame: upstairs P3 level 0, insertion gridno 5687 facing
`100 + NORTHWEST`, camera 4561 (client), DEREK records 6 and 8, the hard-coded quest index 15, Elliot's `x = 1`, quotes 37
/ 38 / 69, timers 2 s / 3 s; palace: staircase 12067 and its 2-tile radius, the 5-enemy basement threshold, alternate
queen gridno 11448; statue: gridnos 13829, 13830, 13669, 13670, `EIGHTOSTRUCT` sub-indices 5/7/8, exit grid 13669 → O3 b1
13037, room 4; POWs: I13, the path targets 10492, 10482, 9381, the interrogation grids 7756–7758 and item grid 12089, the
Alma grids (`merc-fate.ts`); `LIE_TO_QUEEN_CHECK` factor 50; progress thresholds come from `game.json`.

### 10.4 Original data, read at runtime, never committed

NPC records of QUEEN, JOE, ELLIOT, DEREK, OLIVER and the per-scene files listed in the control JSON (the simulation needs
the interrogation's set; the Meduna sets would only serve scene playback); maps P3, P3 b1, N7, O3, O3 b1, I13; the ending
videos (`Intro.cc:63-77` names) and the credits text (client).

### 10.5 Native save import (`14` §10)

`createSaveSession` (`src/server/save-session.ts`) builds a `SavedStory` from section 24 (`gCurrentMeanwhileDef`,
`gfMeanwhileTryingToStart`, `gfInMeanwhile`), section 40 (the 17 defs), the first-battle sector (`readStrategicAiSections`)
and the tactical status (`ubLastBattleSector`, `fLastBattleWon`, `uiFlags`). `storyImportRefusal`
(`src/sim/campaign/story-import.ts`) refuses a save made in a scene (`gfInMeanwhile`) or in the endgame
(`IN_ENDGAME_SEQUENCE` 0x8, `IN_DEIDRANNA_ENDGAME` 0x80000000); neither can be saved in the original (inferred).
`importStory` restores the defs (constant per id in practice; an all-zero def counts as never scheduled), `current`,
`trying` (re-pausing and locking the clock, so the scene resolves when its gates pass), the first and the last battle.
`uiMeanWhileFlags` and `gfCreatureMeanwhileScenePlayed` come through `readStrategicAiSections` (`17`); the event queue's
`MEANWHILE` events with `15`'s queue import. `ubCurrentMeanWhileId` is not in the save (0 after loading).

### 10.6 Stubs (CI)

Authored for ja2-node; names invented, gridnos from the source code: QUEEN 75, JOE 79, ELLIOT 135, DEREK 136, OLIVER 137
(sector P3) and SKYRIDER 97 in `stubs/profiles.json`; in `stubs/npc/records.json` DEREK record 6 (fact `QUEEN_DEAD`) →
OLIVER record 2 with `ENDGAME_STATE_1`, DEREK record 8 (quest `CREATURES` in progress) with `ENDGAME_STATE_2`, and under
`meanwhiles` an interrogation set for QUEEN and ELLIOT (meanwhile 11: a lie prompt, punches, `DONE_PUNCH_1` and
`DONE_SLAPPED` records); stub maps `n7.map.txt`, `p3.map.txt` (the scene NPCs, DEREK and OLIVER, an exit grid down) and
`p3_b1.map.txt` in `stubs/maps/`. No stub maps for I13, O3 or O3 b1.

---

## 11. Implementation in ja2-node

### 11.1 State

§0 lists the fields. `MeanwhileState`, `MeanwhileDefinition`, `MeanwhileContext`, `MeanwhileLogEntry`,
`MeanwhileNpcSave` live in `src/sim/strategic/ai/queen-state.ts` (`NUM_MEANWHILES` 17); `EndingState` in
`src/sim/campaign/ending-state.ts`; POW load bookkeeping (`powSquad`, `powsSeen`) in the sector-flow state
(`src/sim/campaign/flow-state.ts`). All plain data, saved with the campaign.

### 11.2 Modules

| Module | Contents |
|---|---|
| `src/sim/strategic/ai/meanwhile.ts` | `scheduleMeanwhileEvent` (§1.2) and the original's posting functions in camelCase (§1.1, §1.3; plus `scheduleInterrogation`, `isMedunaOutskirts`), `handleMeanwhileEvent`, `beginMeanwhile`, `areInMeanwhile` (§1.4), `processImplicationsOfMeanwhile` (§1.9), `meanwhileSceneName` (camelCase scene names) |
| `src/sim/campaign/meanwhile-flow.ts` | `MeanwhileFlow`: gates, `resolveMeduna`, the interrogation start and `endMeanwhile`, NPC save and restore, the record selectors' queries, the log and its events (§2) |
| `src/sim/campaign/narrative/meanwhile-actions.ts` | the scene and endgame NPC actions (§1.7) |
| `src/sim/tactical/narrative/npc-actions/requestors.ts` | the lie prompt and `chooseLiar` (§2.3) |
| `src/sim/tactical/narrative/meanwhile-rules.ts` | the tactical scene predicates (§1.6) |
| `src/sim/campaign/endgame-flow.ts`, `ending-state.ts` | `EndgameFlow` (§7), `EndingState`, `campaignStatus` |
| `src/sim/campaign/pow.ts`, `src/sim/tactical/narrative/pow-rules.ts` | `PowFlow` (§3.4), the I13 path-check hook |
| `src/sim/campaign/merc-fate.ts` | capture sequence (§3.3; `17`, `19`) |
| `src/sim/tactical/narrative/statue.ts` | the O3 statue (§5.3) |
| `src/sim/tactical/ai/queen-escape.ts` | the escape to the basement (§5.2) |
| `src/sim/strategic/narrative/hourly.ts` | `applyProgressMilestones` (§4.1) |
| `src/sim/campaign/story-refusals.ts`, `story-import.ts`, `narrative/story-events.ts` | refusals and the reported flow (§7.1), native import (§10.5), the story event types |
| `src/content/narrative/scenes.ts` | `narrative-scenes.json` loader (§10.2) |

### 11.3 Wiring

`CampaignSim` (`src/sim/campaign/campaign-sim.ts`) owns `meanwhile`, `endgame` and `pows`, runs
`meanwhile.afterStep()` and `endgame.afterStep()` after every tick, answers the strategic world port's `inMeanwhile()`
with `areInMeanwhile`, does not step once ended and is not idle while the endgame is active or a scene is trying or
running. The strategic AI registers the `MEANWHILE` event handler (`17`). Callers of the posting functions: towns and
SAMs through `queenEconomyHooks` (`ai/economy-link.ts`, `18`); outskirts through `StrategicAiPort.medunaOutskirtsTaken`
from `liberate`; flowers from the florist (`laptop/florist.ts` → `scheduleFlowersMeanwhile`); the chopper from
`helicopter-flow.ts`; creatures from `creature-flow.ts`; the scientist from the hourly milestones; the first battle from
`battle-flow.ts`; the trash hook from `sector-flow.ts`; the interrogation from `endCaptureSequence`. The tactical narrative
port (`src/sim/campaign/narrative-port.ts`) routes `deidrannaDied`, `creatureQueenDied` and `powPathChecks`. The maps a
story step may load are prepared before each command (`mapsNeededSoon`, `sector-flow.ts`, read by
`src/server/campaign-session.ts`): N7 while the interrogation may come (scheduled and not played, or quest `INTERROGATION`
not started during a battle), P3 and P3 b1 while the squad is in P3, O3 b1 while it is in O3.

### 11.4 Verification

Oracle: `tools/oracle/probes/meanwhile.txt` with patch `0019-meanwhile-oracle.patch` and
`tools/oracle/meanwhile-compare.ts` (scheduling and posting with their draws, the first battle and the trash hook, the
event with and without enemies, the played NPC moves, the hourly milestones, captures, `QUEEN_DEAD`, the statue); the lie
check through the actions probes (`npcbox … code=221 answer=lie`); details in `tools/oracle/README.md` ("Meanwhile"). The
played scenes in tactical, the interrogation sequence, the same-second precedence and the endgame sequence are not
probed; unit tests and stub scenarios cover them.

---

## 12. Quirks to keep

Original behaviour (vanilla too unless marked), each stated in its section:
- Each scene once per campaign; flag bits not in id order; scenes counted for Elliot when scheduled, skipped or not; his
  counter stops at 17; 16 shows the unbruised face; the interrogation counts too (§1.2).
- The camera uses the last *scheduled* scene's gridno; `ubCurrentMeanWhileId` is not saved (§1.6, §0).
- The interrogation is due at absolute minute 10 and, while enemies are loaded, re-fires and redraws `R(121)` every pass;
  the battle delay counts from the event's stamp (§1.4).
- Same-second precedence: arrivals delayed one minute, sector control refused, both off during a tactical traversal
  (§1.4).
- SAM scenes posted on every contested capture (flag-limited), none for N4; `LOST_TOWN` once, only for militia towns
  liberated before; town scenes only for the six towns (§1.3).
- `CREATURES` scheduled before the infestible-mine test and from the Tixa cave without sci-fi; RAT placed regardless.
- `AWOL_SCIENTIST` places MADLAB and ROBOT at (0, 0, 0) when no alternate map was chosen (§1.9).
- Played scenes clear the scene NPCs' profile insertion flag, truncate their profile gridno to INT8 and reset their record
  states; `OUTSKIRTS_MEDUNA` shoots Elliot (17); a played scene on the map stops compression and resets the mode to X0.
- First battle: a won or lost tactical town battle waits for the next world trash (any map load); autoresolve and non-town
  battles post at once; only the tactical win triggers PACOS (§4.2).
- Alma liberated → the first capture goes straight to the interrogation; `INTERROGATION` never ends, so there is no third
  capture; the Alma box once per POW; the rescue experience goes to the current squad (§3).
- The liar is chosen by wisdom (the candidate's leadership on both sides); the lie check is against the Queen's profile
  wisdom + leadership; the silent failure still draws `R(100)` (§2.3).
- Scenes after Deidranna's death still wake the AI; her death can start the creature quest through the loyalty event
  (§5.4).
- Endgame: only the current squad's conscious mercs get the insertion grid but whole groups move; the forced `z = 1` saves
  a surface death's state under P3 b1; P3's counts zeroed, its groups kept; Elliot moved to column 1 (§6.4).
- No game over; no play after victory (§6.7–6.8).

---

## 13. Unverified

- Implications and scene loads read nothing of the player's world; scene soldiers write nothing back to profiles (§1.8,
  §1.9): the basis of "Meanwhile without sector reload".
- Tactical AI keeps running under the conversation lock during the 2 s and 3 s timers (§6.2).
- The softlock when DEREK is absent; the surface-death temp-file overwrite; the never-won killer-less creature queen
  (§6.4–6.6).
- The Alma box once per POW; a surrender of five or more leaving the extra mercs uncaptured (§3.2, §3.4).
- Native saves never carry a running scene or endgame (§10.5).
