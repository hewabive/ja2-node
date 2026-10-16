<!-- Meanwhile scenes, the Queen's death and the end of the campaign, prisoners, progress triggers: an implementable spec
for M6 "Narrative". 2026-10-16.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–23) and data/externalized (= assets/externalized),
cross-checked against vanilla (reference/vanilla/ja2/Build) where marked. The NPC record files of the meanwhile scenes and
of the ending were inspected locally on the user's original data to confirm which source-defined actions they use;
nothing from them (records, quotes, numbers) is reproduced here. Read-only research: nothing was built or run. -->

# 26 — Meanwhile scenes, the Queen and the end of the campaign

**Conventions.** As in `23`: paths are relative to `reference/stracciatella/src/game/`; `X:` is `src/externalized/`, `V:`
is vanilla `Build/`, `J:` is `data/externalized/`. "(inferred)" marks conclusions not traced end to end; everything else
was read in the code. `R(n)` = `Random(n)` = our `main` stream (`R(0)` draws nothing), `PR(n)` = `PreRandom(n)` = the
`pre` stream (`01` §3.6). Times: world minutes (`GetWorldTotalMin`) unless marked; the event queue stores seconds
(`docs/15` §2). Sectors are written as on the map (P3 = column 3, row P; `SGPSector(3, 16)`); "P3 b1" is level 1 under P3.
Profile ids are the `NPCIDs` constants of `Tactical/Soldier_Profile.h:23-179` (QUEEN 75, JOE 79, RAT 81, MIGUEL 57,
ROBOT 62, IGGY 68, PACOS 114, SKYRIDER 97, ELLIOT 135, DEREK 136, OLIVER 137, MADLAB 146, MIKE 149). Meanwhile ids are the
enum of `Strategic/Meanwhile.h:7-27` (already `Meanwhile` in `src/sim/strategic/ai/constants.ts`). "The scene" means the
cutscene the original plays in tactical; "the box" is its "Meanwhile....." message box.

**Companions (do not duplicate).** `15-strategic-time.md`: event queue, `InterruptTime`, pause locks, compression and its
stop reasons. `16-strategic-map-movement.md`: sector load and unload, temp files (our `SectorDiff`), exit grids, map
file names (`_m` for the Meduna meanwhile map), the helicopter. `17-strategic-ai.md`: the Queen's AI, §9.4 (meanwhile
implications on the AI), §9.5 (`ExecuteStrategicAIAction`), §10.11 (capture summary), §11.3 (progress). `18`: town
liberation and loss, SAM sites, the loyalty and morale tables. `19`: first-battle facts from autoresolve, autoresolve
capture and surrender (§2.13), the end of a tactical battle (§3.2). `21-laptop-and-hiring.md`: the florist (caller of the
FLOWERS scene), Enrico's mails, history. `22-contracts-and-relationships.md`: POW contract rules, death bookkeeping.
`11`: the death commit and melee. `13`: the AI hooks `HeadForTheStairCase` and `OFFER_SURRENDER`. `14`: save sections.
Written in parallel: **`24-npcs-and-dialogue.md`** (NPC records and their selection, approaches, `TriggerNPCRecord*`, the
talk interface, the dialogue queue and the "nobody is talking" test, NPC action dispatch, civilian quotes) and
**`25-quests-facts-and-npc-actions.md`** (facts, quests and `StartQuest`/`EndQuest`, the per-case NPC action catalog,
NPC placement and `InitNPCs`, the Skyrider/helicopter rules). This doc owns `Strategic/Meanwhile.cc`, `Tactical/End_Game.cc`,
the end of the campaign (ending videos, credits, restart), the 35/50/70 % progress events, the narrative effects of the
first battle, the POW story pieces that nobody else owns (§3, overlap with `25` marked there), and the NPC actions that
only meanwhile scenes and the ending use (§1.7, §6.5): `25`'s catalog lists them as owned here.

---

## 0. State this spec adds

| State | Original | Saved there | ja2-node |
|---|---|---|---|
| `meanwhile.flags` | `uiMeanWhileFlags` u32, one bit per scene, set at scheduling (`Meanwhile.cc:94-153`) | yes (section 24, `SaveLoadGame.cc:1937`; u16 before version 71, `:2094-2096`) | exists: `StrategicState.meanwhile.flags` (`src/sim/strategic/ai/queen-state.ts:77-80`) |
| `meanwhile.lastScheduledId` | `ubCurrentMeanWhileId` static u8, the id of the **last scheduled** scene (`:91, 179`) | **no** (static; 0 after a load) | exists as `currentId`; only the camera reads it (§1.6) |
| `meanwhile.defs[17]` | `gMeanwhileDef[]` = {sector, trigger record, id, npc} per id, written at scheduling (`:79, 182-186`) | yes (section 40, 17 × 8 bytes, `:2130-2160`) | add; constant per id in practice (§11.5) |
| `meanwhile.current` | `gCurrentMeanwhileDef`, copied at `BeginMeanwhile` (`:78, 209`) | yes (section 24, `:1886`) | add |
| `meanwhile.trying` | `gfMeanwhileTryingToStart` (`:80, 211, 257`) | yes (24, `:1888`) | add: the window between the event and the gates (§2.1) |
| `meanwhile.inScene` | `gfInMeanwhile` (`:81, 304`) | yes (24, `:1889`; forced false on load in Dead-is-Dead mode, `:2037-2039`) | add: true only during the interrogation flow (§2.3) |
| `meanwhile.npcSaves` | `gNPCSaveData[10]` {profile, sector, gridNo} static (`:69-88`) | no | interrogation flow only |
| `meanwhile.log[]` | — | — | ja2-node only: resolved scenes with their context, for the player view and M7 playback (§2.4) |
| `queen.firstBattleMeanwhilePending` | `gfFirstBattleMeanwhileScenePending` (`Strategic_AI.cc:116`) | yes (35) | exists |
| `firstBattleSector` | `sWorldSectorLocationOfFirstBattle` i16 (`Strategic_Town_Loyalty.cc:1131-1145`) | yes (24, `:1899`) | decoded by `savegame-strategic-ai.ts`; add to state (`25` may own the field; it is read by §1.7) |
| `lastBattleSector`, `lastBattleWon` | `gTacticalStatus.ubLastBattleSector`, `fLastBattleWon` (`Overhead.cc:3898-3899`, `:4511`) | yes (tactical status) | add to the battle state if absent; read by scene record selection (§1.7) |
| ELLIOT `npcData` | `bNPCData` INT8 of his profile: the slap counter (`Meanwhile.cc:192-195`, `Interface_Dialogue.cc:3114`) | yes (profiles) | needs the profile field `npcData` that `24`/`25` add for bartenders and others |
| profile `useProfileInsertionInfo`, `gridNo` of QUEEN, ELLIOT, JOE | profile fields changed by a played scene (§1.8) | yes | placement fields of `25` |
| `endgame` | `IN_DEIDRANNA_ENDGAME` / `IN_ENDGAME_SEQUENCE` bits of `gTacticalStatus.uiFlags` (`Overhead_Types.h:46, 67`); `gpKillerSoldier`, `gsGridNo`, `gbLevel` statics (`End_Game.cc:39-41`) | flags yes, statics no | `EndgameState {phase, killer, gridNo, level, dueTick}` (§7) |
| `outcome` | none: the game restarts after the credits (§6.7) | — | `'playing' \| 'won'`, `wonAt`, `ending {miguelAlive, skyriderAlive}` |
| capture flags, captives index | `gStrategicStatus.uiFlags` `STRATEGIC_PLAYER_CAPTURED_FOR_RESCUE/ESCAPE`, `ubNumCapturedForRescue` | yes (34) | exist (`status.flags`, `numCapturedForRescue`, `merc-fate.ts`) |
| quests `HELD_IN_ALMA`, `INTERROGATION`, `FIND_SCIENTIST`, `CREATURES` | `gubQuest[]` | yes | `25`'s quest table; today `state.battle.quests` holds the first two (`battle-state.ts:72-78`) |
| scenes seen | `gGameSettings.uiMeanwhileScenesSeenFlags`, bit `1 << id` (`GameSettings.cc:218-230`) | **settings file, not the save** | a client setting (M7), not simulation state |
| O3 statue opened | map modification of O3 (struct swap + exit grid, `End_Game.cc:72-116`) | map temp file | `SectorDiff` of O3 (`16` §5.11) |

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
`Queen_Command.cc:1132`). In P3 the scene loads the map `P3_m.dat` instead of `P3.dat` (`Strategic/StrategicMap.cc:335-339`,
`16` §1); N7 loads its normal map. The record files are per scene: `J:script-records-control.json` maps (meanwhile id,
QUEEN or ELLIOT) to a record file (`X:DefaultContentManager.cc:1379-1398`), and while a scene runs QUEEN and ELLIOT read
those instead of their own (`TacticalAI/NPC.cc:229-251`); JOE always uses his own records.

### 1.2 `ScheduleMeanwhileEvent(sector, trigger, id, npc, minute)` (`Meanwhile.cc:170-198`)

```
if flags & flag(id): return                       // each scene at most once per campaign
flags |= flag(id)                                 // flag bits: :96-139 (not in id order: INTERROGATION 0x8000, CREATURES 0x800)
lastScheduledId = id
defs[id] = {sector, trigger, id, npc}
if profiles[ELLIOT].npcData != 17: profiles[ELLIOT].npcData++      // "poor Elliot", counted even if the scene is skipped
AddStrategicEvent(EVENT_MEANWHILE, minute, id)    // one-shot, docs/15 §2
```

Elliot's counter only selects his face in scenes (`Tactical/Faces.cc:119-128`: > 3 bruised in four stages up to 15,
17 = shot; **16 matches no branch and shows the unbruised face**, quirk). 17 is also set by `SHOOT_ELLIOT` (§1.7), and the
increment stops there; with 17 scenes scheduled it can reach 17 by counting alone (inferred from the initial `prof.dat`
value being small; not checked).

### 1.3 Triggers in detail

- **First battle** (§4.2): `HandleFirstBattleEndingWhileInTown(sector, fromAutoResolve)` (`:765-796`): returns if the
  scene was already scheduled; sector not in a town (`bNameId == BLANK_SECTOR`) → schedule now and clear the pending flag;
  in a town and (pending or from autoresolve) → schedule, clear; else set pending. `HandleFirstMeanWhileSetUpWithTrashWorld`
  (`:799-809`) schedules a pending one whenever the world is trashed (`TileEngine/WorldDef.cc:2543-2544`): leaving the town
  sector, or any later map load, **including the load of a played meanwhile scene**. Both branches post at now + 5 (the
  "delayed" variant's 60 minutes is commented out, `:755-760`). Exists: `meanwhile.ts:123-140`, wired from
  `battle-flow.ts:539` and `sector-flow.ts:1017`.
- **Towns** (`18` §2.7): when a town becomes wholly player-controlled for the first time and militia can be trained there
  (`Strategic_Town_Loyalty.cc:1033-1062`); Omerta, San Mona, Estoni, Orta, Tixa and Meduna have no scene (`:656-664`).
  **Loss**: a militia-trainable town that was liberated before is wholly enemy-controlled again (`:1064-1076`); one
  `LOST_TOWN` scene per campaign.
- **SAM sites**: every contested capture of a SAM sector posts (the "first time" test is commented out, `Player_Command.cc:146-151`);
  the flag makes it once. Called before the SAM morale and loyalty events.
- **Meduna outskirts**: a contested capture of an enemy-controlled M2, M3, M4, M5, M6 or N6 (`Player_Command.cc:182-187`),
  after the refuel-site update. **Not wired in ja2-node**: `isMedunaOutskirts`/`handleOutskirtsOfMedunaMeanwhileScene`
  exist (`meanwhile.ts:108-117`) but `liberate` in `src/sim/strategic/map/control.ts:108-118` never calls them (§4.3).
- **Creatures**: `InitCreatureQuest` posts the scene once (`gfCreatureMeanwhileScenePlayed`) **before** it checks for an
  infestible mine (`Creature_Spreading.cc:182-225`), so the scene (and RAT) happens even when the quest does not start. Its
  callers are `CheckConditionsForTriggeringCreatureQuest` (sci-fi only, `:898-920`) and entering the Tixa cave J9 b2
  **without a sci-fi check** (`StrategicMap.cc:491-497`); the scene's records have a `NO_SCI_FI_END_MEANWHILE` branch for
  that case (§1.7). Owned by `17` §12/§20; scheduling exists (`creature-flow.ts:64-66`).
- **Flowers** (`21` §7.3): only when the delivery sector's town is Meduna; the "next day" box → code 0. The draw happens only
  when the flag is clear (`:697-701`), before the florist's order-number draw.
- **Chopper**: every landing after which the helicopter can fly again (`Map_Screen_Helicopter.cc:398-421`); the draw only
  while the flag is clear. The helicopter belongs to `25` (Skyrider) and `16` §3.16; they must call the posting function.
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
- `InterruptTime` ends the event pass after this event; same-stamp successors run at the next pass (`15` §2.5). Exists:
  `handleMeanwhileEvent` (`meanwhile.ts:66-80`).
- `BeginMeanwhile` (`:201-221`): Dead-is-Dead autosave (non-default option, not ported), `current = defs[id]`,
  `trying = true`, `PauseGame()` + `LockPauseState(LOCK_PAUSE_MEANWHILE)` (`15` §1.5), clear the NPC save slots.
- **Precedence** (`AreInMeanwhile`, `:417-437`): false during a tactical traversal; true while in a scene; otherwise true
  if the event queue's **head** events at exactly the current second include a `MEANWHILE` (the walk stops at the first
  event with another stamp). Readers: group arrivals are delayed by 1 minute instead of 3–5 (`Strategic/Strategic_Movement.cc:1120-1136`,
  `16` §3.9), and `SetThisSectorAsPlayerControlled` refuses to change control (`Player_Command.cc:64-67`). The campaign's
  world port answers `inMeanwhile()` with `meanwhilePendingThisSecond` (`meanwhile.ts`); scenes are skipped, so the
  in-scene case never holds.

### 1.5 The box (`CheckForMeanwhileOKStart`, `:237-274`; `BringupMeanwhileBox`, `:227-235`)

Run every frame of the tactical and map screens only (`GameScreen.cc:529`, `Strategic/MapScreen.cc:2009`; the laptop,
shops and options pause the game anyway, `Laptop/Laptop.cc:462`). While `trying`: wait while the pre-battle interface is
open, while the tactical panel is switching (`InterfaceOKForMeanwhilePopup`, `Tactical/Interface_Control.cc:619-622`) and
**until the dialogue queue is empty and nobody talks** (`24`). Then `trying = false`, remember the screen, leave tactical
if in it, drop the item on the cursor, and show the box: OK only for `INTERROGATION` or a scene never seen on this
installation, OK + Skip otherwise. The world clock is paused throughout; tactical animation keeps running until the box
appears (`GameScreen.cc:420-427` runs the overhead regardless of the game pause; the box then sets `PauseTime`, `15` §1.5).
While `trying`, compression and map-screen exits are refused (`Strategic/Map_Screen_Interface_Bottom.cc:749-753, 1010-1014`).

`BeginMeanwhileCallBack` (`:396-414`): OK → `ENGAGED_IN_CONV`, NPC reference count 1, `StartMeanwhile`. Skip →
`inScene = false`, `ProcessImplicationsOfMeanwhile()`, unlock and unpause: nothing else happens (§1.10).

### 1.6 Playing a scene

`StartMeanwhile` (`:295-355`): remember the loaded sector (if any) and the selected map sector; `inScene = true`; music;
for every scene except `INTERROGATION` move QUEEN and ELLIOT (and JOE for `OUTSKIRTS_MEDUNA`) to P3, for `INTERROGATION`
QUEEN, ELLIOT and JOE to N7, each through `SetNPCMeanwhile` (`:277-289`): save {profile, sector, gridNo}, `ReloadQuoteFile`
(the records are reread from content: per-scene files for QUEEN and ELLIOT, `NPC.cc:318-323`), `ChangeNpcToDifferentSector`
(`Tactical/Tactical_Save.cc:733-745`: sector := scene sector, or none if the profile has left the country;
`fUseProfileInsertionInfo = FALSE`). Fade; then `SetCurrentWorldSector(def.sector)` (the player's world is unloaded through
`HandleDefiniteUnloadingOfWorld`, which saves its temp files and runs the sector-exit quest code, and `TrashWorld`,
`16` §5.10); camera on `gusMeanWhileGridNo[lastScheduledId]` (`:47-66`: 12248 for all, 8075 for `INTERROGATION`; indexed by
the last *scheduled* id, not the playing one, quirk); fade in; then (if still in the scene) NPC reference count 1,
`SHOW_ALL_MERCS` unless `INTERROGATION`, `TriggerNPCRecordImmediately(QUEEN, 0)` (`:375-390`).

What the scene load does differently (`AreInMeanwhile` checks): `_m` map for P3; no `SF_ALREADY_VISITED`
(`StrategicMap.cc:860-863`); no temp files loaded or saved, except that `INTERROGATION` loads N7's item temp file and saves
N7 normally (`Tactical/Tactical_Save.cc:278-286, 436-456`); enemies placed only for `INTERROGATION` (`StrategicMap.cc:632-635`);
P3's special civilian rules skipped (`Tactical/Soldier_Init_List.cc:500`). In tactical while in a scene:

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

**Checked locally on the user's data** (no content reproduced): across the 34 per-scene record files, no record has a
quest condition, starts or ends a quest or gives an item, and only the `INTERROGATION` files test or set facts (unnamed
ids). The Meduna scenes use only slaps, dialogue-panel closing, the five record selectors above, `SEND_TROOPS_TO_SAM`,
`SHOOT_ELLIOT` (in `OUTSKIRTS_MEDUNA`, unconditionally reached) and the three endings. `INTERROGATION` adds lie prompts,
the unreachable-army no-ops, `PUNCH_FIRST_LIVING_PC`, `GRANT_EXPERIENCE_4`, `REMOVE_JOE_QUEEN`, `REMOVE_ELLIOT_END_MEANWHILE`
and facings; JOE's own records contribute `PUNCH_PC_SLOT_0..2`, `TRIGGER_JOE_32_OR_33` and `REMOVE_NPC` with unnamed facts.
So a Meduna scene's only lasting effects are its profile side effects (§1.8) and Elliot's 17.

### 1.8 Ending a scene

`EndMeanwhile` (`:531-566`): empty the dialogue queue; `ProcessImplicationsOfMeanwhile()` (§1.9); mark the scene seen
(settings); `inScene = false`; NPC reference count 0; clear `ENGAGED_IN_CONV`; unlock and unpause; locator off. Then:

- **Not `INTERROGATION`**: clear `SHOW_ALL_MERCS`; fade; `DoneFadeOutMeanwhileOnceDone` (`:572-615`): if a world was loaded,
  `SetCurrentWorldSector(old)` (the player's sector is **reloaded from its temp files**, with every side effect of a sector
  entry, `16` §5.3) and `ExamineCurrentSquadLights`, else `TrashWorld` and no world; restore the selected map sector;
  `RestoreNPCMeanwhile` (`:509-525`: sector := saved, **`gridNo := (INT8)saved gridNo`** (vanilla too,
  `V:Strategic/Meanwhile.c:696, 736`), `ReloadQuoteFile` again); back to the map screen if the box was opened there, else
  the team panel.
- **`INTERROGATION`**: enemy-present music and `RestoreNPCMeanwhile`; **no reload**: the player stays in N7 tactical with
  the captives ("we leave this sector open for our POWs to escape", `:560`).
- **ESC** during any scene but `INTERROGATION` calls `EndMeanwhile` at once (`Turn_Based_Input.cc:2185-2192`).

Net profile effects of a played scene on QUEEN, ELLIOT (and JOE where moved): `useProfileInsertionInfo` cleared,
`gridNo` truncated to INT8, record states reset by the two reloads; the sector is unchanged. The scene soldiers (the gun
given by `SHOOT_ELLIOT`, Elliot's wounds) are not written back: the scene map saves no temp file and no NPC data
(`Tactical_Save.cc:278-286`, inferred for the NPC data).

**Screens and compression.** A scene started from the map screen leaves it for tactical (`EnterSector` sets the pending
screen, `StrategicMap.cc:591-597`), which sets compression to X1 (`MapScreen.cc:3236-3246`); coming back, X1 is not a
map mode, so the mode becomes X0 (`MapScreen.cc:1420-1430`): **after a played scene on the map, time compression is
stopped and the remembered mode is lost** (verified by reading these three call sites). A skipped scene only unpauses.

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
implications run while the scene map is loaded; nothing in them reads the loaded world (inferred). ja2-node implements
the first three rows (`processImplicationsOfMeanwhile`, `meanwhile.ts:52-64`); `CREATURES` and `AWOL_SCIENTIST` are missing.

### 1.10 Played versus skipped

| Effect | Played (OK) | Skipped (Skip) | ESC in the scene |
|---|---|---|---|
| Flag, def, Elliot's counter | at scheduling, both | same | same |
| Implications (§1.9) | yes | yes | yes |
| Scene marked seen (settings) | yes | no | yes |
| Profile side effects on QUEEN/ELLIOT/JOE (§1.8) | yes | no | yes |
| `ELLIOT.npcData = 17` in `OUTSKIRTS_MEDUNA` | yes | no | if reached before ESC |
| Player's world unloaded and reloaded (temp files, sector-exit and entry quest code (`25`), first-battle trash hook, `InitializeTacticalStatusAtBattleStart`, militia reset, the entry draws of `16` §5.3) | yes | no | yes |
| Map screen: compression stopped, mode X0 | yes | no (compression resumes) | yes |

### 1.11 Interplay summary

- **Compression**: the event interrupts the pass; the pause lock blocks compression until the box is answered; a played
  scene from the map stops compression (§1.8). **Combat**: delayed by 3–5 minutes per firing while the loaded sector has
  enemies. **PBI**: the box waits for it; a meanwhile due this second delays arrivals by a minute, so it never opens a PBI
  at the same second. **Laptop**: paused, no events; the florist's scene fires a day or more later. **Map screen**: exits
  refused while `trying`. **Tactical traversal**: precedence off. **Saving**: refused in a scene; map-screen save refused
  while `trying`. **Dead is Dead**: autosave at begin (not ported). **A scene while the player is in P3 itself** reuses the
  loaded P3 world instead of `P3_m` (`SetCurrentWorldSector` returns early for the same sector, `StrategicMap.cc:433-466`;
  irrelevant to ja2-node).

---

## 2. ja2-node: meanwhile scenes without cutscenes

### 2.1 Decision: resolve with "played" semantics when the gates pass

No scene is played by the simulation. A Meduna scene resolves atomically with the state effects of a **played** scene
(§1.10 first column, minus the reload of the player's sector), because the first viewing cannot be skipped in the original
and the seen flags are an installation setting, not campaign state. The original's window between the event and the box
is kept as the `trying` state, so the same things wait:

```
onMeanwhileEvent(e):                                        // EVENT_MEANWHILE (exists: handleMeanwhileEvent)
  if world.enemyInSector(): repost at e.stamp + 180 + R(121), offset copied; return
  current = defs[e.param]; trying = true; pauseGame(); lockPause(MEANWHILE); interruptTime()

every tick while trying (tactical ticks keep running, the world clock is paused):
  if a pre-battle prompt is open or the speech channel / dialogue queue is busy (24): wait
  trying = false
  if current.id == INTERROGATION: startInterrogation(); return                       // §2.3
  resolveMeduna(current.id)

resolveMeduna(id):
  if flow == strategic: stopTimeCompression(reason: meanwhile); setCompressionLevel(X0)     // §1.8
  handleFirstMeanwhileSetUpWithTrashWorld()                                                // the scene load trashes the world
  npcs = [QUEEN, ELLIOT] + (id == OUTSKIRTS_MEDUNA ? [JOE] : [])
  for p in npcs: save {sector, gridNo}; changeNpcToDifferentSector(p, P3); records.reload(p)   // 24
  context = sceneContext(id)                                                               // §2.4, before any effect
  if id == OUTSKIRTS_MEDUNA: profiles[ELLIOT].npcData = 17                                 // SHOOT_ELLIOT
  dialogue.empty(); processImplicationsOfMeanwhile(id)                                     // §1.9, complete
  for p in npcs: sector = saved.sector; gridNo = i8(saved.gridNo); records.reload(p)        // RestoreNPCMeanwhile
  current = none; unlockPause(); unPauseGame()
  log.push({seq, id, at: worldSeconds, context}); emit meanwhile {seq, scene, sector: P3, at}
```

`handleFirstMeanwhileSetUpWithTrashWorld` runs unconditionally: the played path trashes a world when it loads `P3_m`
even if none was loaded. The player's loaded sector stays loaded and untouched (deviation "Meanwhile without sector
reload", §13). Rejected alternative: "skipped" semantics (no profile effects, Elliot never shot, compression continues);
it is what M4 shipped and stays the fallback until `24`'s record reload exists.

### 2.2 Not a decision prompt

The box offers no choice that changes campaign state once the reload is gone (§1.10), so a Meduna scene is **not** a
decision prompt and does not wait for the client (D15: informational). It surfaces as the `meanwhile` event and in the
view (§9). On the map the compression stop (`compressionStopped {reason: 'meanwhile'}`) already ends a default strategic
`advance` (`15` §6), mirroring the original's interruption; in tactical real time the event is reported and can be
watched with `until.events: ['meanwhile']`. Only `INTERROGATION` contains real decisions (§2.3).

### 2.3 `INTERROGATION`: a scripted tactical scene (flow `meanwhile`)

The interrogation changes captives' life and experience, sets facts and offers lie prompts, and it ends with the player
in N7. It is simulated, on top of `24`'s record engine and `11`'s melee:

1. `startInterrogation`: as `resolveMeduna` up to the NPC moves, with N7 and JOE included, except that compression ends
   at X1 (the player ends up in tactical and never returns to the map screen, §1.8); `inScene = true`; flow `meanwhile`;
   save slots for QUEEN, ELLIOT, JOE (`gNPCSaveData`).
2. Load N7 through the sector flow (`16` §5) with the meanwhile rules of §1.6: the current sector is unloaded and its
   diff saved; N7's normal map; its item diff loaded (the captives' dropped gear, hidden at 12089); enemies placed
   (`PrepareEnemyForSectorBattle`); `SF_ALREADY_VISITED` not set; the captives placed on 7756–7758 and, being POWs in a
   sector other than I13, put on one new squad and made non-neutral (§3.4); QUEEN, ELLIOT, JOE placed by profile.
3. `ENGAGED_IN_CONV`, NPC reference count 1, `TriggerNPCRecordImmediately(QUEEN, 0)` with QUEEN and ELLIOT on their
   `INTERROGATION` record sets (`J:script-records-control.json`, id 11).
4. The scene runs on tactical ticks with the world clock paused and the §1.6 tactical rules on (always hit, halved
   punches without breath loss, no bleeding, no getting up, no combat mode, no quotes, unconscious → QUEEN
   `DONE_SLAPPED`). Player commands are refused (`inMeanwhile`) except `answer`.
5. `PROMPT_PLAYER_TO_LIE` raises a decision prompt `lieToQueen` with choices `yes`, `no`, `lie`
   (`Interface_Dialogue.cc:4341-4376`): yes → QUEEN record `r + 1`, no → `r + 2` (`r` = the record that raised the prompt);
   lie → the liar is the in-sector merc with life ≥ OKLIFE and breath ≥ OKBREATH maximising
   `EffWis(s) + EffLead(s) > EffWis(liar) + EffLead(s)` — **the candidate's leadership on both sides**, so wisdom decides
   (quirk, keep) — and `SkillCheck(liar, LIE_TO_QUEEN_CHECK, 0) ≥ 0` → `r + 4`, else (or no liar) `r + 3`. The check
   (`Tactical/SkillCheck.cc:146-385`): skill `50·(EffWis + EffLead) / (QUEEN.wisdom + QUEEN.leadership)` (`:277-280`),
   minus the fatigue penalty, plus the morale modifier, clamped 0..99, success iff `PR(100) ≤ chance`; a failure also draws
   `R(100) < 40` for a curse that this reason keeps silent. `skillCheck` exists (`src/sim/tactical/combat/skill-check.ts`).
6. The scene ends with `REMOVE_ELLIOT_END_MEANWHILE` → `EndMeanwhile` (INTERROGATION branch): empty queue, no
   implications, `inScene = false`, unlock, `RestoreNPCMeanwhile`; flow back to `tactical` **in N7** with the captives;
   the previous world is not restored. Event `meanwhileEnded`.

Until `24` lands, step 3–5 can be stubbed by an interim resolution (captives stay in N7, no punches or prompts), logged
as a temporary deviation (open question 5).

### 2.4 The scene log and how a browser shows a scene later (M7)

Each resolved scene appends `{seq, id, at, context}` to `meanwhile.log`, where `context` freezes what the scene's record
selectors would read at play time (§1.7): whole towns under control excluding Omerta, SAM sites controlled,
`lastBattleWon`, a functional SAM in the last battle sector, the first battle's town (Drassen, Cambria, other), sci-fi,
Elliot's `npcData` before and after. These are all player-known. The browser receives `meanwhile {seq, scene}`; in M7 it
asks the server for `scene {seq}`, and the server builds the scene in a **disposable sandbox**: a fresh tactical session
on `P3_m.dat` (stub: a stub scene map) with QUEEN, ELLIOT (and JOE), the scene's record sets, the frozen context and an
`fx`-seeded stream, runs `24`'s dialogue engine with the §1.7 actions in presentation mode until an `END_MEANWHILE`
variant, and returns the event log for playback (D14: animation starts, quotes, faces with Elliot's variant). The campaign
state is never touched, so playback, skipping or not watching are all equivalent. A cheaper M7 alternative is a card with
the scene's lines in order; both read the same log. The interrogation needs no sandbox: it is in the normal event stream.

### 2.5 What changes in existing code

- `src/sim/strategic/ai/meanwhile.ts`: `scheduleMeanwhileEvent` gains the def and Elliot's counter (through a profile
  port); add `handleFlowersMeanwhileScene(code)`, `handleKillChopperMeanwhileScene()`,
  `handleScientistAWOLMeanwhileScene()`, `scheduleInterrogation()` (absolute minute 10); complete
  `processImplicationsOfMeanwhile` (the Drassen and first-battle no-ops are nothing to port; `CREATURES`, `AWOL_SCIENTIST`
  through `25`'s ports); `handleMeanwhileEvent` enters `trying` instead of resolving at once.
- `src/sim/strategic/ai/constants.ts`: `ELLIOT_MAX_SLAPS` (17) gets its user.
- `src/sim/strategic/map/control.ts`: `liberate` calls the outskirts hook (§4.3).
- `src/sim/campaign/meanwhile-flow.ts` (new): the gates, `resolveMeduna`, the interrogation flow, events, log.
- `src/sim/campaign/merc-fate.ts`: `endCaptureSequence` starts the quests through `25` and schedules `INTERROGATION`.

---

## 3. Prisoners: capture, Alma, the interrogation and escape

### 3.1 Ownership and what exists

Capture mechanics are specified in `17` §10.11 and `19` §2.13/§3.8 and implemented (`src/sim/campaign/merc-fate.ts`:
`beginCaptureSequence`, `endCaptureSequence`, `enemyCapturesPlayerSoldier`; `battle-flow.ts:895-920` for the tactical
loss). **Overlap with `25`**: the quests `HELD_IN_ALMA` and `INTERROGATION` are quests, so their state, `StartQuest`/
`EndQuest` and history belong to `25`; this section specifies only *when* the narrative path calls them and what else
happens. If `25` also describes these call sites, the two must agree; `25` should reference this section rather than
restate it.

### 3.2 Capture entry points

| Path | Where | Captured |
|---|---|---|
| Tactical loss with 2–3 incapacitated real mercs, an active enemy team, and Alma not started or (Alma done and interrogation not started) | `Overhead.cc:5010-5072` (`19` §3.2) | each in-sector merc with life ≠ 0 |
| Tactical surrender: an enemy offers (`DecideAction.cc:2641-2654`, `13` §6.1) through a civilian quote (`24`) and the player accepts the yes/no box | `Tactical/Civ_Quotes.cc:150-178, 196-205` | every in-sector merc with life ≠ 0 |
| Autoresolve surrender or capture (from day 4; refused once the rescue flag is set, so normally only the first capture) | `Auto_Resolve.cc:3359-3433` (`19` §2.13) | the involved cells |

Each path runs `BeginCaptureSquence`, `EnemyCapturesPlayerSoldier` per merc, then `EndCaptureSequence`. The tactical
surrender then shows the "you surrendered" box after 3 s (`gfSurrendered`, `Overhead.cc:6011-6024`), the loss the
"captured" box; both lead to `CheckAndHandleUnloadingOfCurrentWorld`. `EnemyCapturesPlayerSoldier` returns early after
four captives (`ubNumCapturedForRescue > 3`), so a surrender of five or more removes the others from the tactical
sector without capturing them (inferred from `Civ_Quotes.cc:158-165`); the fourth captive indexes past the three-entry
grid arrays (undefined behaviour; `merc-fate.ts` falls back to the first grid and item grid 0, a deviation to log).

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
liberated the first capture is already the interrogation). `merc-fate.ts` sets the quest states directly and never
schedules the scene: replace with `25`'s quest calls and `scheduleInterrogation()`. `INTERROGATION` is **never ended**
anywhere (grep), so after it no further capture can happen (the capture tests require it not started) (quirk, keep).

### 3.4 Captives on a sector load (`StrategicMap.cc:975-1006`, in `UpdateMercsInSector`)

For each POW of the loaded sector (not when loading a save): in **I13** show the "POW mercs are here" box (once per POW:
the squad variable is never set there, inferred) and leave them POWs; anywhere else (N7) put the first on a new squad,
make him non-neutral and add the others to that squad. Then, if `HELD_IN_ALMA` is in progress, `EndQuest(HELD_IN_ALMA)`
and `GRANT_EXPERIENCE_3` (+100 experience to the conscious in-sector members of the current squad, i.e. the rescuers;
the POWs are on no squad). In I13 the POWs (neutral, in locked cells, `Queen_Command.cc:1228-1241`) are freed by
`DoPOWPathChecks` (`Overhead.cc:6027-6048`), called after a door opens (`Tactical/Handle_Doors.cc:889`) and after an
explosion (`TileEngine/Explosion_Control.cc:1444`): a POW with a path to 10492, 10482 or 9381 becomes non-neutral, joins
any squad and cheers. ja2-node has none of this: add it to the sector flow's merc update and to the door and explosion
hooks.

### 3.5 N7 after the interrogation

The interrogation (§2.3) leaves the captives in N7 tactical on their own squad with N7's garrison present: the escape is
an ordinary battle or a walk off the map. Their gear lies hidden at 12089 in the same sector. Strategic status of POWs
while held (contracts frozen, no morale decay, no healing assignments, excluded from compression's usable mercs) is
`22` §2.1, `18` §5, `15` §1.6.

---

## 4. Progress and first-battle triggers

### 4.1 `HourlyProgressUpdate` events (`Tactical/Campaign.cc:1289-1325`)

When the current progress (`17` §11.3) exceeds the highest so far, in this order, each on the first crossing
(`current ≥ t && highest < t`, policy `J:game.json` `progress.event_*_min`): **35** → `HandleScientistAWOLMeanwhileScene`
(§1.1, scene 14); **50** → `SetFactTrue(FACT_MIKE_AVAILABLE_TO_ARMY)` (consumed by soldier creation, `Tactical/Soldier_Create.cc:2068-2085` sets the fact to 2 when it turns one elite into MIKE, `17` §10.4, `25`);
**70** → `profiles[IGGY].sector = C5`. Then `highest = current`. One jump can fire all three. ja2-node computes the
milestones (`hourlyProgressUpdate`, `src/sim/strategic/ai/difficulty.ts:154-163`) but `economy-link.ts:40` discards them:
the campaign must apply them (§12).

### 4.2 The first battle

`FACT_FIRST_BATTLE_BEING_FOUGHT` is set when a merc first sees an army soldier (`OppList.cc:1792-1797`) or the PBI opens for
a non-bloodcat encounter (`PreBattle_Interface.cc:187-192`), while `FACT_FIRST_BATTLE_FOUGHT` is false (ja2-node:
`battle.firstBattle`, `pre-battle.ts:227`). At the end:

| End | Facts | Then |
|---|---|---|
| Tactical win (`Overhead.cc:4683-4694`) | FOUGHT, WON, not BEING_FOUGHT; `SetTheFirstBattleSector` (first write only, `Strategic_Town_Loyalty.cc:1131-1137`) | `TriggerNPCRecord(PACOS, 18)` (`24`), then `HandleFirstBattleEndingWhileInTown(world, FALSE)` |
| Tactical loss (`:4481-4488`) | FOUGHT, not BEING_FOUGHT; sector | `HandleFirstBattleEndingWhileInTown(world, FALSE)` |
| Autoresolve (`Auto_Resolve.cc:1278-1288`), any end, when FOUGHT is false | FOUGHT, WON on victory; sector | `HandleFirstBattleEndingWhileInTown(sector, TRUE)` |

The classic case: the landing fight in Omerta is a town battle in tactical, so the scene waits until the squad first
loads another sector (§1.3). `DidFirstBattleTakePlaceInThisTown` (`:1141-1145`) feeds the scene's record selectors.
ja2-node has the facts and the meanwhile calls (`battle-flow.ts:539, 572, 940-947`); missing: the PACOS record trigger.

### 4.3 Liberation, loss, SAM and outskirts: call order

In `SetThisSectorAsPlayerControlled` (`Player_Command.cc:57-218`, `18` §2.6) for an enemy-controlled sector taken in a
contested fight: town morale and loyalty, then the whole-town check (town scene); mine; SAM (SAM scene first, then
morale, loyalty, Skyrider's line, grace days); refuel site; **outskirts scene**; then `StrategicHandleQueenLosingControlOfSector`.
Same-second scenes keep this order in the queue (`lastScheduledId` ends as the last one). Wire
`handleOutskirtsOfMedunaMeanwhileScene` at the end of `liberate` (`control.ts:108-118`) through the AI port, only when
`isMedunaOutskirts(s)`.

### 4.4 Progress-related narrative owned elsewhere

Enrico's progress and setback mails and "lack of progress" (`HandleEnricoEmail`, `Strategic/Strategic_Status.cc:246-376`;
`21` §6, `18` §2.8); the computed facts `FACT_PLAYER_DOING_POORLY/WELL/VERY_WELL` (< 20, > 50, > 80 %, `Strategic/Quests.cc:861-871`;
`25`); Skyrider's progress comments on helicopter routes (`MapScreen.cc:7341-7380`, `gubPlayerProgressSkyriderLastCommentedOn`;
`25`); merc morale `progress/5` (`Morale.cc:255`, `22`); dealer coolness (`23`); the creature quest triggers (`17` §12).

---

## 5. Meduna: the palace, the Queen's escape, the statue

### 5.1 Palace placement (overlap with `25`, which owns placement)

In P3 outside meanwhiles (`Tactical/Soldier_Init_List.cc:500-519`): with `FACT_QUEEN_DEAD` the Queen's civilian group
(`QUEENS_CIV_GROUP`) is not placed; otherwise the Queen stands at 11448 when `gfUseAlternateQueenPosition`, and civilians
of other groups are not placed (the townsfolk appear only after her death). `gfUseAlternateQueenPosition` is set when the
player takes P3 b1 (`Player_Command.cc:196-200`; ja2-node `queenBasementTaken`). `FACT_QUEEN_DEAD` is computed from the
Queen's profile status (`Quests.cc:713-715`), not stored.

### 5.2 The escape to the basement (body of `13`'s hook)

QUEEN (and JOE while they see no enemy) in P3, able to move, without the alternate position (`DecideAction.cc:1502-1514,
2522-2535`) call `HeadForTheStairCase` (`TacticalAI/PanicButtons.cc:476-502`): if P3 b1 was ever loaded and holds fewer
than 5 enemies → nothing; within 2 tiles of 12067 → `AI_ACTION_TRAVERSE_DOWN`; else walk to 12067 if a path exists.
`TRAVERSE_DOWN` (`TacticalAI/AIMain.cc:1803-1816`): end the AI turn (turn-based), profile `sectorZ++` and
`useProfileInsertionInfo = false`, remove the soldier, `CheckForEndOfBattle(TRUE)`. She is then placed in P3 b1 when the
player enters it. Entering through the basement first (the statue route, §5.3) keeps her upstairs at 11448.

### 5.3 The O3 statue (`End_Game.cc:37-128`)

The palace basement is reachable through a statue in O3. `ChangeO3SectorStatue(fromExplosion)` writes a map
modification: remove the statue struct at 13830 (`EIGHTOSTRUCT` 5), add the damaged (7, explosion) or opened (8) one,
add an exit grid at 13669 to O3 b1 gridno 13037 and reveal 13669, recompute movement costs around 13830. Triggers: using
a `REMOTETRIGGER` in O3 room 4 (`Tactical/Handle_Items.cc:2541-2552`, otherwise a curse), or an explosion's structure
damage at distance ≤ 1 from 13829, 13830, 13669 or 13670 while O3 is loaded and the exit grid does not exist yet
(`HandleStatueDamaged`, listener on `BeforeStructureDamaged`, `Overhead.cc:317`, `Explosion_Control.cc:341-348`): the
statue then takes no damage. Who hands out the remote is `25`'s business.

### 5.4 The Queen's story reactions beyond `17`

Only two beyond `17` §9: her death puts the AI to sleep (`QUEEN_DEAD`, `17` §9.5) **but every wake trigger still works**,
so a scene scheduled after her death (only possible while the ending waits for the creature queen, §6.6) still wakes the
AI through its implications (quirk; the original would also try to play the scene with a dead Queen, which only ESC
ends, inferred). And `GLOBAL_LOYALTY_QUEEN_BATTLE_WON` runs `CheckConditionsForTriggeringCreatureQuest` (`Strategic_Town_Loyalty.cc:876-879`,
`18` §2.4), so a sci-fi game holding three infestible mines starts the creature quest at the moment she dies.

---

## 6. The Queen's death and the end of the campaign (original)

### 6.1 Trigger

At the death commit (`11` §5.10) `HandleNPCTeamMemberDeath` (`Tactical/Overhead.cc:2273-2529`) marks the profile dead
(`bMercStatus = MERC_IS_DEAD`, life 0, history, `:2282-2293`), and in the civilian-team branch, after the per-profile
switch, calls `BeginHandleDeidrannaDeath(killer, gridNo, level)` for profile QUEEN (`:2423-2426`); `killer` is the
soldier's `attacker` and may be null. For a creature with body `QUEENMONSTER` killed by someone (killer not null) it calls
`BeginHandleQueenBitchDeath` at the top of the enemy/creature branch (`:2450-2454`). ja2-node's equivalent is
`handleNPCTeamMemberDeath` (`src/sim/tactical/combat/death.ts:225-250`), whose narrative exit is `t.sectorHooks.soldierDied`.

### 6.2 Two seconds (`BeginHandleDeidrannaDeath`, `End_Game.cc:139-154`)

Remember killer, gridno and level; `ENGAGED_IN_CONV` (the conversation UI lock, `24`), NPC reference count 1,
`IN_DEIDRANNA_ENDGAME` (camera on 4561 when the tactical screen is entered, `GameScreen.cc:186-189`; no auto-bandage,
`Tactical/Auto_Bandage.cc:192-196`); a 2-second wall-clock timer calls `HandleDeidrannaDeath`. Tactical play goes on
meanwhile (AI turns are not stopped by the lock, inferred).

### 6.3 `HandleDeidrannaDeath` (`:160-209`)

Victory music; the killer says `QUOTE_KILLING_DEIDRANNA`; every other OUR merc that is controllable, not gassed, not an EPC,
marked in `QuoteExp_WitnessDeidrannaDeath[profile]` (`Tactical/QArray.cc:334`, 73 entries) and has line of sight to the
death tile (`DistanceVisible` + `SoldierTo3DLocationLineOfSightTest(…, 3, …)`) says it too, all through the dialogue
queue; `SetFactTrue(FACT_QUEEN_DEAD)` (a computed fact: it re-reads the profile status, `Quests.cc:713-715`);
`ExecuteStrategicAIAction(QUEEN_DEAD)` (AI asleep, `17` §9.5); a dialogue-queue event that, after the quotes, fades the
screen out into `DoneFadeOutKilledQueen`.

### 6.4 `DoneFadeOutKilledQueen` (`:225-302`)

```
upstairs = P3, level 0
for s in OUR team: if life >= OKLIFE and in sector and s.assignment == CurrentSquad():
    tacticalTraversal = true; SetGroupSectorValue(upstairs, s's group)           // the whole group moves
    s.sector = upstairs; insertion GRIDNO 5687, facing 100 + NORTHWEST
for e in ENEMY team, not neutral, not friendly: ProcessQueenCmdImplicationsOfDeath(e)   // strategically dead (17 §10.7)
ExitCombatMode(); fLastBattleWon = true; fEnemyInSector = false
HandleMoraleEvent(none, MORALE_QUEEN_BATTLE_WON, upstairs)        // strategic +8 (Morale.cc:63)
HandleGlobalLoyaltyEvent(GLOBAL_LOYALTY_QUEEN_BATTLE_WON, upstairs)  // +1000, creature-quest check first (18 §2.4)
SetThisSectorAsPlayerControlled(world sector, TRUE)               // basement: only the alternate-queen flag (5.1)
world.z = 1                                                        // forces the reload below
P3 surface counts (admins, troops, elites and the in-battle ones) = 0     // groups in P3 are left alone
profiles[ELLIOT].sector.x = 1                                      // "get rid of Elliot in P3"
ChangeNpcToDifferentSector(DEREK, upstairs); ChangeNpcToDifferentSector(OLIVER, upstairs)
SetCurrentWorldSector(upstairs)                                    // 16 §5: unload, load P3 with the current squad at 5687
tacticalTraversal = false; fade in → DoneFadeInKilledQueen
```

Quirks: only the current squad's conscious in-sector mercs get the insertion grid, but `SetGroupSectorValue` moves their
whole groups. The forced `z = 1` makes the unload save the current world's state under **P3 b1**: when the Queen dies in
the basement (the normal case) that is correct; when she dies upstairs (the statue route, §5.2) the surface's items,
corpses and doors are written over the basement's temp data and the surface is reloaded from its own older temp data
(inferred from `SetCurrentWorldSector`, `StrategicMap.cc:433-457`, and `Tactical_Save.cc:278-319`).

### 6.5 Derek, Oliver and the two endgame states

`DoneFadeInKilledQueen` (`:212-222`): if DEREK has a soldier in the loaded sector, `TriggerNPCRecordImmediately(DEREK, 6)`;
**otherwise nothing**, leaving `ENGAGED_IN_CONV` and `IN_DEIDRANNA_ENDGAME` set: the UI stays locked (softlock, inferred).
DEREK's record 6 requires `FACT_QUEEN_DEAD` and starts a chain through OLIVER's records (data, checked locally) that ends in:

- `NPC_ACTION_ENDGAME_STATE_1` (`Interface_Dialogue.cc:3792-3807`): if `gubQuest[15]` (`QUEST_CREATURES`, hard-coded index)
  is in progress → `TriggerNPCRecordImmediately(DEREK, 8)` and `EndQueenDeathEndgame()` (unlock, clear
  `IN_DEIDRANNA_ENDGAME`, `:340-348`): **the game continues** until the creature queen dies (§6.6); else
  `DeleteTalkingMenu` and `EndQueenDeathEndgameBeginEndCimenatic()` (§6.7).
- `NPC_ACTION_ENDGAME_STATE_2` (`:3809-3814`): `DeleteTalkingMenu`, `EndQueenDeathEndgame()`; the end of DEREK's record-8
  chain.

`QUEST_CREATURES` starts only when a mine is first invaded (`Strategic/Strategic_Mines.cc:217-222`) and ends when the
creature queen dies (`Queen_Command.cc:888-897`), so an active creature lair that has not yet invaded a mine does not
delay the ending.

### 6.6 The creature queen (`BeginHandleQueenBitchDeath`, `:378-413`; `HandleQueenBitchDeath`, `:416-458`)

Lock the UI as in §6.2 (without `IN_DEIDRANNA_ENDGAME`); a 3-second timer; immediately every living creature-team soldier
takes a 10 000-damage hit (`EVENT_SoldierGotHit`, attack-busy count raised per creature, `11`). After 3 s: victory music;
the killer and line-of-sight witnesses marked in `QuoteExp_WitnessQueenBugDeath` (`QArray.cc:419`) say
`QUOTE_KILLING_QUEEN`; then `FACT_QUEEN_DEAD` → `EndQueenDeathEndgameBeginEndCimenatic()`, else just unlock. A creature
queen dying **without a killer** skips all of this: with Deidranna already dead the end cinematic can then never start
(quirk, inferred).

### 6.7 The end cinematic, credits, restart: what counts as winning

`EndQueenDeathEndgameBeginEndCimenatic` (`:308-337`): `IN_ENDGAME_SEQUENCE`; **every** OUR merc with life ≥ OKLIFE that is
not an EPC says `QUOTE_END_GAME_COMMENT` (no in-sector test); a dialogue-queue event after them calls
`EndQueenDeathEndgame()` and fades out to `DoneFadeOutEndCinematic` (`:351-366`): clear the flag, leave tactical for the
intro screen in `INTRO_ENDING` mode. The ending videos (`Intro.cc:283-306`): the throne speech with or without MIGUEL (his
profile dead or not), the helicopter fly-by, then with or without SKYRIDER (same test). Leaving the intro
(`PrepareToExitIntroScreen`, `:223-248`) calls `ReStartingGame()` (`Strategic/Game_Init.cc:291-330+`: world, soldiers,
laptop, profiles, quote files, dealers reset) and goes to the credits, which return to the main menu (`Credits.cc:169-185`).

So **the campaign is won when `EndQueenDeathEndgameBeginEndCimenatic` runs**: Deidranna (profile QUEEN) is dead and either
`QUEST_CREATURES` was not in progress at `ENDGAME_STATE_1`, or the creature queen was killed afterwards by someone. Nothing
of the campaign survives the victory except the player's saves; there is no post-victory play.

### 6.8 There is no game over

No losing screen or rule exists (searched: the only exits are the victory path above, the player's quit
`EndGameMessageBoxCallBack`, `GameLoop.cc:314-327`, and the demo-only `NPC_ACTION_END_DEMO`, `Interface_Dialogue.cc:3458-3462`).
When every merc is dead or captured, battles end through the lost-battle path (`19` §3.2) and the world unloads; on the
map, time compression is refused with "no usable mercs" (`MapScreen.cc:6259-6268`, `AllowedToTimeCompress`, `15` §1.6,
where mercs in transit count as usable), so the clock only moves again after a new hire. A player without money and
mercs is stuck but never told the game is over.

---

## 7. ja2-node: the endgame flow

### 7.1 Flows

`endgame` (the Deidranna sequence up to Derek's records) and `ended` (terminal). The creature-queen sequence of §6.6 runs
inside `tactical` with the conversation lock, like any `24` conversation, and switches to `endgame` only for the end
cinematic.

### 7.2 Steps

```
queenKilled (sectorHooks.soldierDied, profile QUEEN):                              // §6.1
  endgame = {phase: 'timer', killer, gridNo, level, dueTick: now + 400}            // 2 s = 400 ticks
  flow = endgame; conversation lock on; emit queenKilled {sector, gridNo, level, killer}
phase timer, at dueTick:                                                           // §6.3
  queue the killer's and witnesses' QUOTE_KILLING_DEIDRANNA (24's dialogue queue, 60 ms per character)
  facts.queenDead recomputed; executeStrategicAIAction(QUEEN_DEAD); phase = 'quotes'
phase quotes, when the queue's sentinel event runs:
  doneFadeOutKilledQueen()                                                         // §6.4, atomic; fades take 0 ticks
  phase = 'derek'; if DEREK has a soldier in P3: triggerNPCRecordImmediately(DEREK, 6) else endgameState1()   // deviation
ENDGAME_STATE_1 (24 action dispatch → here):
  if quest CREATURES in progress: triggerNPCRecordImmediately(DEREK, 8); endQueenDeathEndgame()
       → flow tactical, lock off, emit endgameDeferred {reason: 'creatures'}
  else beginEndCinematic()
ENDGAME_STATE_2: endQueenDeathEndgame() → flow tactical
creatureQueenKilled (killer present): kill the creature team (10 000 hits); dueTick = now + 600 (3 s); then quotes;
  facts.queenDead ? beginEndCinematic() : lock off
beginEndCinematic():
  phase = 'endComments'; queue QUOTE_END_GAME_COMMENT for every OUR merc ≥ OKLIFE, not EPC
  at the sentinel: outcome = won; wonAt = worldSeconds; ending = {miguelAlive, skyriderAlive}
  flow = ended; emit campaignWon {...}
```

Timers become ticks (`01` §3.3): 2 s → 400, 3 s → 600; ticks also run in turn-based combat, so the sequence proceeds
whoever's turn it is, as the original's wall-clock timer does. Fades, the intro videos and the credits are presentation
(M7); `ReStartingGame` is not reproduced: the session simply ends (§9.5).

### 7.3 Softlocks and quirks in ja2-node

| Case | Original | ja2-node (proposed) |
|---|---|---|
| DEREK absent after the reload | UI locked forever | run `ENDGAME_STATE_1` directly (deviation "Endgame without Derek"; open question 2) |
| Creature queen dies without a killer while Deidranna is dead | never won | keep (quirk) unless decided otherwise (open question 2) |
| Deidranna dies on the surface | surface state saved as P3 b1 | keep: save the diff under P3 b1, reload P3 from its own diff (open question 2) |
| Meanwhile scenes after her death | scene with a dead Queen, ESC ends it; AI woken | implications run (AI woken), no scene (§5.4) |

---

## 8. Interfaces with `24`, `25` and the others

**Needed from `24` (NPCs and dialogue):** `triggerNPCRecord`, `triggerNPCRecordImmediately`, `triggerNPCWithGivenApproach`
(approaches `TRIGGER_NPC`, `DONE_SLAPPED`, `DONE_PUNCH_0..2`); per-scene record sets keyed by (meanwhile id, profile)
from `J:script-records-control.json`, active while `meanwhile.inScene` (or the M7 sandbox) for QUEEN and ELLIOT only;
`reloadQuoteFile(profile)` (record states reset); the dialogue queue with sentinel events (`DialogueEvent::Add`), "queue
empty and nobody talking", `emptyDialogueQueue`, `deleteTalkingMenu`; the conversation lock (`ENGAGED_IN_CONV`, NPC
reference count); the dialogue message box prompt used by `PROMPT_PLAYER_TO_LIE` (`StartDialogueMessageBox`, the YES/NO/LIE
flags) so that §2.3 plugs its outcome rule into it; the NPC action dispatch, into which this doc registers the actions of
§1.7 and `ENDGAME_STATE_1/2`; the civilian quote that carries the enemy's surrender offer (§3.2); `npcData` on profiles.

**Needed from `25` (quests, facts, actions, placement):** `startQuest`/`endQuest`/internal variants with history for
`HELD_IN_ALMA`, `INTERROGATION`, `FIND_SCIENTIST`, `CREATURES`; facts `QUEEN_DEAD` (computed), `MIKE_AVAILABLE_TO_ARMY`,
`FIRST_BATTLE_*`, the unnamed interrogation facts; profile placement fields (`sector`, `gridNo`,
`useProfileInsertionInfo`, `LEFT_COUNTRY`) and `changeNpcToDifferentSector`; `InitNPCs` choosing MADLAB's alternate-map
sector; the P3 placement rules (§5.1); the helicopter landing that calls §1.3's chopper hook; who gives the remote
trigger (§5.3); `GRANT_EXPERIENCE_*`, `REMOVE_NPC`, `TRIGGER_JOE_32_OR_33`, facings (generic actions in `25`'s catalog).
**`25`'s catalog marks as owned here:** `SLAP`, `FRUSTRATED_SLAP`, `PUNCH_PC_SLOT_0/1/2`, `PUNCH_FIRST_LIVING_PC`,
`SHOOT_ELLIOT`, `TRIGGER_QUEEN_BY_CITIES_CONTROLLED`, `TRIGGER_QUEEN_BY_SAM_SITES_CONTROLLED`,
`TRIGGER_ELLIOT_BY_BATTLE_RESULT`, `TRIGGER_ELLIOT_BY_SAM_DISABLED`, `ELLIOT_/QUEEN_DECIDE_WHICH_QUOTE_FOR_PLAYER_ATTACK`,
`PROMPT_PLAYER_TO_LIE`, `REMOVE_JOE_QUEEN`, `END_MEANWHILE`, `REMOVE_ELLIOT_END_MEANWHILE`, `NO_SCI_FI_END_MEANWHILE`,
`ADD_RAT`, `ENDGAME_STATE_1`, `ENDGAME_STATE_2`, and the no-ops `SEND_TROOPS_TO_SAM`, `SEND_SOLDIERS_TO_*`,
`ADD_MORE_ELITES`, `GIVE_KNOWLEDGE_OF_ALL_MERCS`.

**Provided to others:** the posting functions (`16`/`25` helicopter → chopper; `21` florist → flowers; `17` creatures →
creature release, exists; `18` towns and SAMs, exist; `19`/`11` first battle, exist); `inMeanwhile()` and
`meanwhileId()` for the tactical rules of §1.6 (`10`, `11`, `13`, `24`); the Queen death hook (`11`); the O3 statue hook on
explosions and item use (`12`); POW handling on sector load (`16`) and after doors and explosions (`12`).

---

## 9. Agent API (D15, D16)

### 9.1 Commands and refusals

No new player commands: scenes and the ending are not player actions. Refusals by flow (the original locks the UI the
same way):

| Flow | Accepted | Refusal for the rest |
|---|---|---|
| `meanwhile` (interrogation) | `answer` for the open prompt, `observe`, `query` | `inMeanwhile` |
| `endgame` | `observe`, `query` | `endgameInProgress` |
| `ended` | `observe`, `status`, `newSession` | `campaignOver` |

`save` is refused in `meanwhile` and `endgame` (as `SaveLoadScreen.cc:1374` and the conversation lock); in `ended` see open
question 3. Dev-only commands on the dev server (not MCP): `debugMeanwhile {id}` (schedule now), `debugEndgame {phase}`.

### 9.2 Prompts

One new kind, during the interrogation only: `lieToQueen {id, choices: ['yes', 'no', 'lie']}`, answered with
`act {"type":"answer","choice":"lie"}`; if `24` defines a generic dialogue-box prompt for `StartDialogueMessageBox`, this is
its variant with action `PROMPT_PLAYER_TO_LIE`. The skill check behind `lie` is not shown (the original shows none).

### 9.3 Events

| Event | When | Payload (player-visible only) |
|---|---|---|
| `meanwhile` | a Meduna scene resolves | `{seq, scene, sector: 'P3', at}`; `scene` = camelCase name (`endOfPlayersFirstBattle` … `balimeLiberated`) |
| `meanwhileStarted`, `meanwhileEnded` | the interrogation begins and ends | `{seq, scene: 'interrogation'}` |
| `compressionStopped` | a scene resolved on the map | `{reason: 'meanwhile'}` (new reason, `15` §6) |
| `powsFound` | captives seen in I13 on a sector load | `{sector: 'I13', soldiers}` |
| `powFreed` | a POW path check frees a merc | `{soldier, sector}` |
| `queenKilled` | Deidranna's death commit | `{sector, gridNo, level, killer: soldier \| null}` |
| `squadMovedUpstairs` | §6.4 | `{soldiers, sector: 'P3'}` |
| `endgameDeferred` | `ENDGAME_STATE_1` with the creature quest on | `{reason: 'creatures'}` (Derek's lines say as much) |
| `creatureQueenKilled` | §6.6 | `{killer}` |
| `campaignWon` | §7.2 | `{day, worldTime, difficulty, sciFi, ending: {miguelAlive, skyriderAlive}, mercDeaths}` |
| `statueOpened` | §5.3 | `{sector: 'O3', destroyed: boolean}` |

Quotes and record dialogue reuse `24`'s events (`mercQuote`, `npcQuote`). Hidden (D16): scheduled scenes, their due
times and delays, Elliot's counter, the pending first-battle scene, the AI effects of implications, the endgame phases'
internals, whether the creature quest is running (except through `endgameDeferred`).

### 9.4 Observation and status

`status` gains `campaign: 'playing' | 'endgame' | 'won'` and the flows `meanwhile`, `endgame`, `ended`; with no usable merc
it carries `noUsableMercs: true` (the compression refusal already says it). `observe` gains `meanwhile` during the
interrogation (`{seq, scene}`; the prompt in `observe.prompt`), `narrative.meanwhiles` (the scenes seen so far:
`[{seq, scene, at}]`), and in `ended` an `ended` block (`{outcome: 'victory', at, day, ending, mercDeaths}`) beside the last
view of the world.

### 9.5 `advance`

- A scene due while `advance` runs is handled in the same call: `trying` waits for the gates (§2.1) in ticks, then
  resolves; on the map its compression stop ends a default `advance` with reason `event` (`compressionStopped`).
- In the interrogation `advance` runs the scene's ticks and stops with `decision` at `lieToQueen`, with `event` at
  `meanwhileEnded` (then normal tactical rules apply in N7).
- In `endgame` any `advance` runs the sequence (timers, quote durations, the reload) and stops with the new reason
  **`ended`** at `campaignWon`, or with `event` at `endgameDeferred`.
- In `ended` `advance` returns at once with reason `ended` and no ticks; the agent starts a new game with `newSession`.

### 9.6 MCP descriptions

`observe`, `act` and `advance` descriptions list the new prompt, the flows, the stop reason `ended` and the refusals;
`newSession` says that a won campaign is over.

---

## 10. Determinism

### 10.1 Draws, in order

| Where | Draws | Stream |
|---|---|---|
| Florist order to Meduna, `FLOWERS` flag clear (§1.3) | `R(5)` (next day) or `R(48)`, before the florist's own order-number draw (not drawn in ja2-node, `21` §7.3) | main |
| Helicopter landing able to fly, `KILL_CHOPPER` flag clear | `R(10)` | main |
| `EVENT_MEANWHILE` with enemies in the loaded sector | `R(121)` per repost (repeats for the past-stamped interrogation) | main |
| Scheduling, implications, progress events, first battle | none (the SAM squad's moves draw as `17` §9.5; `WakeUpQueen`'s fortification draws as `17` §9.2) | — |
| `GRANT_EXPERIENCE_3` on the Alma rescue, `GRANT_EXPERIENCE_4` in the interrogation | `StatChange(EXPERAMT, 100 \| 200)` per receiving merc in team order: one `PR(100)` per point (`Tactical/Campaign.cc:208-262`) | pre |
| Capture | captive life `R(21)` (exists) | main |
| Interrogation: sector load | `16` §5.3 entry draws, placements (`16`, `17` §10), enemy creation | main |
| Interrogation: punches | the melee pipeline of `11` (the hit roll is still drawn although the scene forces the hit; damage) | pre / main per `11` |
| Interrogation: `lie` | `PR(100)` in `SkillCheck`; on failure `R(100)` | pre, main |
| Endgame: creature check in the loyalty event | `InitCreatureQuest` draws when it starts (`17` §12) | main |
| Endgame: reload of P3 | `16` §5.3 entry draws, placements | main |
| Creature queen death | one 10 000-damage hit per creature through `11` | per `11` |
| M7 scene playback | `fx` only, in a sandbox | fx |

Meduna scenes resolved by ja2-node make **no** draws of their own; the played path's two sector loads (scene map and
reload) are not made (deviation "Meanwhile without sector reload").

### 10.2 Wall clock and races replaced

The 2 s and 3 s endgame timers become 400 and 600 ticks; fades take no ticks; the box's wait for "nobody talking" is the
speech channel and dialogue queue of `24` (60 ms per character); the original's race between the capture box (a 3 s
wall-clock timer) and the interrogation box is defined as: the lost battle completes and unloads first
(`lostBattleUnloadAtMs`, `battle-flow.ts`), then the interrogation's gates pass.

### 10.3 Ordering

Same-second scenes resolve in queue order (§4.3); `lastScheduledId` follows scheduling, not resolution. The scene
NPC side effects and the implications of §2.1 run in that order; witnesses and end comments in team order (`OUR` ids).

---

## 11. Data tables, original data, save import, stubs

### 11.1 Use directly (`data/externalized/`)

`script-records-control.json` (per-scene record files for QUEEN and ELLIOT, `fileNameForScriptControlledPCs`),
`strategic-map-npc-placements.json` (MADLAB's four sectors, `useAlternateMap`), `strategic-map-sam-sites.json` (SAM order
D2, D15, I8, N4), `strategic-map-towns.json` (town ids for the liberation scenes), `shipping-destinations.json` (the florist's
Meduna test, `21`), `game.json` `progress.event_madlab_min/mike_min/iggy_min` (already in `ArmyContent.progress`).

### 11.2 Transcribe (`tools/transcribe/narrative-scenes.ts` → `data/tables/narrative-scenes.json`, with `c-source.ts`)

| Table | Source | Readers |
|---|---|---|
| Meanwhile scenes: id, internal name, flag bit, scene sector (P3 or N7), scene NPCs, camera gridno, skippable | `Strategic/Meanwhile.h:7-27`; `Meanwhile.cc:47-66` (`gusMeanWhileGridNo`), `:96-139` (flags), `:314-346` (NPCs), `:231` (skippable), the posting sites for the sector | sim (flags, NPCs, sector), client (camera, skip button) |
| Witness tables `QuoteExp_WitnessDeidrannaDeath[73]`, `QuoteExp_WitnessQueenBugDeath[73]` | `Tactical/QArray.cc:334-500` | sim (which quotes enter the dialogue queue and so the endgame's timing) |

`MEANWHILE_FLAGS` in `src/sim/strategic/ai/constants.ts` is then read from the table.

### 11.3 Named constants (SFI header, `@src` the file)

Delays 5 min, flowers `20 + R(5)` h / `24 + R(48)` h, chopper `55 + R(10)` min, interrogation minute 10, battle delay
`180 + R(121)` s, `ELLIOT_MAX_SLAPS` 17, `MAX_MEANWHILE_PROFILES` 10, Meduna HQ P3 and N7, the outskirts M2–M6 and N6
(exist); endgame: upstairs P3 level 0, insertion gridno 5687 facing `100 + NORTHWEST`, camera 4561 (client), DEREK
records 6 and 8, the hard-coded quest index 15, Elliot's `x = 1`, timers 2 s / 3 s; palace: staircase 12067 and its
2-tile radius, the 5-enemy basement threshold, alternate queen gridno 11448; statue: gridnos 13829, 13830, 13669, 13670,
`EIGHTOSTRUCT` sub-indices 5/7/8, exit grid 13669 → O3 b1 13037, room 4; POWs: I13, the path targets 10492, 10482,
9381, the interrogation grids 7756–7758 and item grid 12089, Alma grids (exist in `merc-fate.ts`); `LIE_TO_QUEEN_CHECK`
factor 50; progress thresholds come from `game.json`.

### 11.4 Original data, read at runtime, never committed

NPC records of QUEEN, JOE, ELLIOT, DEREK, OLIVER and the per-scene files listed in the control JSON (the interrogation's
set is needed by the simulation, the Meduna sets only by M7 playback); quotes (`.edt`) for playback; maps P3, P3 b1,
`P3_m` (M7), N7, O3, O3 b1, I13; the ending videos (`Intro.cc:63-77` names) and the credits text (M7).

### 11.5 Native save import (`14` §10)

Section 24: `gCurrentMeanwhileDef`, `gfMeanwhileTryingToStart`, `gfInMeanwhile`, `uiMeanWhileFlags` (decoded),
`sWorldSectorLocationOfFirstBattle` (decoded), `gfCreatureMeanwhileScenePlayed` (decoded). Section 40: the 17 defs (all
constant per id in practice; reconstruct from the table when absent, as `SaveLoadGame.cc:941` does for old versions).
Profiles: ELLIOT's `bNPCData`, the scene NPCs' `fUseProfileInsertionInfo` and `sGridNo`. The event queue's `MEANWHILE`
events come with `15`'s queue import. A save with `trying` set resolves that scene at the first tick; one with
`gfInMeanwhile` or the endgame flags set is refused (neither can be saved in the original, inferred).
`ubCurrentMeanWhileId` is not in the save (0 after loading).

### 11.6 Stubs (CI)

Authored for ja2-node, nothing copied from the original records or maps; names invented, gridnos from the source code:

1. **Profiles** in `stubs/profiles.json` at the fixed ids QUEEN 75, JOE 79, ELLIOT 135, DEREK 136, OLIVER 137 (NPCs with
   sectors P3 or P3 b1 as needed), MADLAB 146, ROBOT 62, RAT 81, IGGY 68 (placement targets), MIGUEL 57, SKYRIDER 97
   (status only, for `ending`).
2. **Records** in `24`'s canonical format, keyed like the control JSON: DEREK record 6 (fact `QUEEN_DEAD`) leading to an
   OLIVER record with `ENDGAME_STATE_1`; DEREK record 8 (quest `CREATURES` in progress) leading to `ENDGAME_STATE_2`; the
   interrogation set (QUEEN and ELLIOT for meanwhile 11, plus JOE): record 0, one `PUNCH_PC_SLOT_0`, one
   `PROMPT_PLAYER_TO_LIE` at some record `r` with outcomes at `r + 1 … r + 4`, `PUNCH_FIRST_LIVING_PC`,
   `GRANT_EXPERIENCE_4`, `REMOVE_JOE_QUEEN`, `REMOVE_ELLIOT_END_MEANWHILE`; one Meduna set (e.g. meanwhile 1) for the M7
   sandbox test.
3. **Maps** (stub format, origin chosen so the source gridnos fall inside; `gridNo = y·160 + x`): `p3.map.txt` (origin
   66 34, 29 × 45: the Queen's placement with her profile and civilian group, two elites, an exit grid on 12067 to P3 b1,
   walkable 11448 and 5687, DEREK and OLIVER placements); `p3_b1.map.txt` (a QUEEN placement, a few elites, stairs up);
   `n7.map.txt` (cells on 7756–7758, the item grid 12089, a guard); `i13.map.txt` (cells with doors on 9208, 9688, 9215,
   corridor and exits reaching 10492, 10482, 9381); `o3.map.txt` (the statue struct on 13829/13830/13669/13670 in room 4)
   and `o3_b1.map.txt` (arrival 13037). The stub map format needs profile and civilian-group placements (`24`/`25` add
   them, `23` §15.5 asked for the same).
4. **Scenario fixtures** shrink P3's garrison through test helpers on the state after init (no content override).

---

## 12. Minimal M6 implementation

### 12.1 Modules (SFI headers)

| Module | Content |
|---|---|
| `src/content/narrative/scenes.ts` | loader for `narrative-scenes.json` (§11.2) |
| `src/sim/strategic/ai/meanwhile.ts` (extend) | scheduling for every trigger with defs and Elliot's counter (§1.2–1.3), `trying` entry with the battle delay (§1.4), complete implications (§1.9) |
| `src/sim/campaign/meanwhile-flow.ts` | `MeanwhileFlow`: gates, `resolveMeduna` with played semantics, compression stop, scene NPC side effects, `meanwhile.log` and context, the interrogation flow (§2.3), events |
| `src/sim/tactical/meanwhile-rules.ts` | `inMeanwhile`/`meanwhileId` on `TacticalState` and the §1.6 rules as predicates used by combat (always hit, interrogation punches, Elliot, bleeding, getting up), turns (no combat entry, no hidden turn-based), dialogue (quotes off), death (unconscious → QUEEN `DONE_SLAPPED`) |
| `src/sim/campaign/pow.ts` | `EndCaptureSequence` quest calls and the interrogation schedule; captives on sector load (§3.4); `doPowPathChecks` from the door and explosion hooks; the tactical surrender acceptance (§3.2) |
| `src/sim/campaign/progress-events.ts` | the 35/50/70 milestones (§4.1); the PACOS record on the first tactical win (§4.2) |
| `src/sim/campaign/endgame-flow.ts` | `EndgameFlow`: §7 (death hooks from `sectorHooks.soldierDied`, timers, quotes, `doneFadeOutKilledQueen` through the sector flow with the P3 b1 diff key, Derek, `ENDGAME_STATE_1/2`, the creature queen, victory) |
| `src/sim/tactical/statue.ts` | §5.3: the explosion pre-damage hook and the remote-trigger use, written into O3's diff |
| `src/sim/strategic/map/control.ts` | the outskirts call in `liberate` (§4.3) |
| `protocol`, `server`, MCP | §9: flows, `lieToQueen`, events, stop reason `ended`, `ended` view, refusals |
| `src/content/formats/savegame-*.ts` | §11.5 fields |
| M7: `src/server/scene-player.ts` | the playback sandbox of §2.4 |

### 12.2 Order of work

(a) Without `24`: scheduling for every trigger, defs, Elliot's counter (profile `npcData`), the complete implications
(through `25`'s quest and placement ports, stubbed with defaults until they land), the outskirts wiring, the progress
milestones, the interrogation schedule; tests. (b) `MeanwhileFlow` with `trying`, the gates (PBI only, until `24` gives
the speech channel), `resolveMeduna` (profile side effects need `24`'s `reloadQuoteFile`; until then only the profile
fields), compression stop, log, events, API. (c) `EndgameFlow` up to `campaignWon` with a direct `ENDGAME_STATE_1`
fallback until `24`'s records run; the `ended` flow and stop reason. (d) POW pieces (§3.3–3.4) and the surrender prompt.
(e) With `24`: Derek's records, the interrogation flow, the §1.6 rules, quotes in the endgame timing. (f) The statue.
(g) Native import fields. (h) Stubs and the scenarios. (i) Oracle probes. (j) M7 sandbox playback.

### 12.3 Tests

- **Unit (scripted RNG)**: flags once per id with the non-monotonic bits; defs written; `lastScheduledId`; Elliot's counter
  increments at scheduling and stops at 17, 16 → plain face mapping (presentation helper); delays per trigger (5, flowers
  both codes with their draws and no draw when flagged, chopper with its draw, interrogation absolute 600 s → fires first
  at the next pass); battle delay from the event's stamp with the offset copied, repeated reposts and draws for the
  interrogation while enemies remain; same-second precedence (arrival + 60 s, control refused, off during traversal);
  first battle: town/tactical pending → trash hook, non-town, autoresolve, lost first battle, scene already scheduled;
  implications per id (hard-only wake, town wakes, SAM squad sector per SAM id, RAT to G9, AWOL quest + MADLAB/ROBOT to the
  alternate-map sector or (0, 0, 0)); played semantics (profile `useProfileInsertionInfo` false, `gridNo` INT8 truncation
  e.g. 12248 → −40, records reloaded, LEFT_COUNTRY profile keeps its saved sector, Elliot 17 only for `OUTSKIRTS_MEDUNA`),
  map-screen compression stop with mode X0, tactical unchanged; gates (PBI open, speech busy); progress 35/50/70 single and
  triple crossing, policy values; capture: Alma path, Alma empty → straight to interrogation, interrogation scheduled once,
  third capture impossible; POWs on load (I13 box per POW, N7 squad, quest end + 100 XP to the current squad), path checks
  after a door and an explosion; lie outcome mapping `r + 1 … r + 4`, the liar choice with the leadership quirk, the check
  formula and its two draws; endgame: timers in ticks, witnesses by table and line of sight, fact, AI asleep, squad move with
  whole groups, enemies strategically dead, P3 counts zero, morale +8 and loyalty +1000 with the creature check, control,
  Elliot `x = 1`, DEREK/OLIVER moved, the P3 b1 diff key when she dies upstairs, `ENDGAME_STATE_1` both branches,
  `ENDGAME_STATE_2`, creature queen with and without killer, victory record (`ending` flags from MIGUEL and SKYRIDER);
  statue by remote in room 4 and outside it, by explosion at distance 0, 1 and 2, idempotent once the exit grid exists.
- **Scenarios (stubs, headless, identical event logs under the instant and manual drivers)**: (1) town liberation → the
  scene on the next advance, Queen awake, compression stopped; (2) the stub palace: the Queen flees to P3 b1, the squad
  follows and kills her → `squadMovedUpstairs`, Derek's records, `campaignWon`, then `advance` → `ended` and `act` →
  `campaignOver`; (3) the same with `QUEST_CREATURES` in progress → `endgameDeferred`, a stub creature queen killed →
  `campaignWon`; (4) capture twice: Alma cells, rescue by opening a door; the second capture → interrogation with a `lie`
  answer → tactical in N7 with the captives on a squad; (5) the statue route: remote in O3, O3 b1, P3 b1 taken → the Queen at
  11448 does not flee.
- **Original data** (`describe.skipIf(!process.env.JA2_DATA_DIR)`): the control JSON resolves all 34 record files; the
  interrogation record set loads; the six native saves import the §11.5 fields (flags, first-battle sector, Elliot's
  counter) and none is in a scene or the endgame.

### 12.4 Oracle probes (patch `0010-narrative-oracle.patch` + `Oracle.cc` commands; outputs stay outside the repo)

The patch exposes the statics (`ubCurrentMeanWhileId`, `GetMeanWhileFlag`, `ProcessImplicationsOfMeanwhile`,
`BeginMeanwhileCallBack`, `SetNPCMeanwhile`/`RestoreNPCMeanwhile`, the lie branch of `DialogueMessageBoxCallBack`, the
`ENDGAME_STATE_1` branch test) and an override of `CurrentPlayerProgressPercentage`.

| Command | Does | Output |
|---|---|---|
| `meanwhiles` | dump | flags, defs, current def, trying, in scene, last scheduled id, Elliot's `bNPCData`, the `MEANWHILE` events (stamp, param), first-battle pending and sector, QUEEN/ELLIOT/JOE sector, gridno, insertion flag |
| `meanwhilepost kind=town\|townloss\|sam\|outskirts\|creature\|flowers\|chopper\|awol\|firstbattle param=<n>` | calls the posting function, draws traced | trace + `meanwhiles` |
| `firstbattle sector=<A1..P16> autoresolve=0\|1` / `trashworld` | `HandleFirstBattleEndingWhileInTown` / `HandleFirstMeanWhileSetUpWithTrashWorld` | `meanwhiles` |
| `meanwhilerun enemy=0\|1` | sets `fEnemyInSector`, warps to the head `MEANWHILE` event without processing others, runs it through `ExecuteStrategicEvent`; if begun, answers Skip | trace, `meanwhiles`, `sai`, RAT/MADLAB/ROBOT sectors, quests |
| `meanwhileplayed id=<n>` | `SetNPCMeanwhile` for the scene NPCs then `RestoreNPCMeanwhile` (no map load) | the three profiles before and after |
| `hourlyprogress current=<n>` | override + `HourlyProgressUpdate` | highest, `FACT_MIKE_AVAILABLE_TO_ARMY`, IGGY's sector, `meanwhiles` |
| `capture who=<ids> mode=loss\|surrender` | `BeginCaptureSquence`, `EnemyCapturesPlayerSoldier` per merc, `EndCaptureSequence` on a save, draws traced | quests, capture flags, captives (sector, grid, life, breath, assignment, neutral, squad), `meanwhiles` |
| `liecheck` | the callback's liar choice and `SkillCheck(LIE_TO_QUEEN_CHECK)` | liar, skill, chance, rolls, result |
| `queendead` | `ExecuteStrategicAIAction(QUEEN_DEAD)` | `sai` |
| `endgamestate quest15=0\|1\|2` | the `ENDGAME_STATE_1` branch test | branch |
| `samesecond` | posts a `MEANWHILE` at the next enemy group's arrival second, then `saiarrive count=1` | the group's new arrival time (+60 s) |
| `statue mode=remote\|explosion dist=<n>` | bare `sector O3` load, then `ChangeO3SectorStatue` or `HandleStatueDamaged` | exit grid at 13669, struct at 13830, skip flag |

`narrative-compare.ts` replays the traces through ja2-node with an asserting roll source and compares the dumps field by
field. Played scenes, the interrogation in tactical and the endgame sequence need the rendering loop and are not probed;
they are checked against a native playthrough only if the user records saves before and after them.

---

## 13. Quirks to keep, deviations to log, verified vs inferred, open questions

**Quirks to keep** (Strac = vanilla unless marked):
- Each scene once per campaign; flag bits not in id order; scenes counted for Elliot when scheduled, skipped or not; his
  counter stops at 17; 16 shows the unbruised face; the interrogation counts too.
- The camera uses the last *scheduled* scene's gridno; `ubCurrentMeanWhileId` is not saved.
- The interrogation is due at absolute minute 10 and, while enemies are loaded, re-fires and redraws `R(121)` every pass;
  the battle delay counts from the event's stamp.
- Same-second precedence: arrivals delayed one minute, sector control refused, both off during a tactical traversal.
- SAM scenes posted on every contested capture (flag-limited), none for N4; `LOST_TOWN` once, only for militia towns
  liberated before; town scenes only for the six towns.
- `CREATURES` scheduled before the infestible-mine test and from the Tixa cave without sci-fi; RAT placed regardless.
- `AWOL_SCIENTIST` places MADLAB and ROBOT at (0, 0, 0) when no alternate map was chosen.
- Played scenes clear the scene NPCs' profile insertion flag, truncate their profile gridno to INT8 and reset their record
  states; `OUTSKIRTS_MEDUNA` shoots Elliot (17); a played scene on the map stops compression and resets the mode to X0.
- First battle: a won or lost tactical town battle waits for the next world trash (any map load); autoresolve and
  non-town battles post at once; only the tactical win triggers PACOS.
- Alma liberated → the first capture goes straight to the interrogation; `INTERROGATION` never ends, so there is no third
  capture; the Alma box once per POW; the rescue experience goes to the current squad.
- The liar is chosen by wisdom (the candidate's leadership on both sides); the lie check is against the Queen's profile
  wisdom + leadership; the silent failure still draws `R(100)`.
- Scenes after Deidranna's death still wake the AI; her death can start the creature quest through the loyalty event.
- Endgame: only the current squad's conscious mercs get the insertion grid but whole groups move; the forced `z = 1` saves
  a surface death's state under P3 b1; P3's counts zeroed, its groups kept; Elliot moved to column 1; end comments from
  every conscious non-EPC merc wherever he is; the creature queen ends the game only when killed by someone.
- No game over; no play after victory.

**Deviations to log in `docs/deviations.md`**:
- *Meanwhile scenes* (replaces the existing row): no cutscene; Meduna scenes resolve when the gates pass with the state
  effects of a played scene (implications, profile side effects, Elliot shot, compression stop), never the skipped
  variant; the scene-seen flags are a client setting.
- *Meanwhile without sector reload*: the player's sector is not unloaded and reloaded around a Meduna scene: no temp-file
  round trip, no sector-exit/entry quest code, no `InitializeTacticalStatusAtBattleStart`, no militia reset, no entry draws,
  no NPC-to-profile save; the first-battle trash hook is called explicitly.
- *Interrogation interim* (temporary, until `24`): captives held in N7 without the scripted scene.
- *Endgame timing*: timers in ticks, fades instant, videos and credits presentation; the session ends instead of
  `ReStartingGame`.
- *Endgame without Derek* (if open question 2 is decided so): `ENDGAME_STATE_1` runs when DEREK is absent.
- *Captives beyond the third*: the out-of-bounds grid read of the fourth captive is defined (first grid, item grid 0) —
  already the behaviour of `merc-fate.ts`.
- *Wall-clock races*: capture box before the interrogation (§10.2).
- *Dead is Dead*: the autosave at `BeginMeanwhile` is not ported (the option is not ported).
- Narrow "Merc death and capture stand-ins", "Creature quest scripting" and "Placement overrides" when §3, §1.9 and §5.1
  land.

**Verified** by reading Strac (V where marked): all of `Meanwhile.cc`/`.h` (scheduling, flags, Elliot's counter, begin,
box rules, start, NPC moves and restore with the INT8 cast (V too), end, implications, every posting function, first-battle
logic), the event hook and its delay, `AreInMeanwhile` and its readers, the tactical meanwhile rules listed in §1.6, the
per-scene record sets (`NPC.cc`, `DefaultContentManager.cc`, the control JSON), the meanwhile and endgame NPC actions,
the lie prompt and check, all of `End_Game.cc`, the Queen and creature-queen death hooks, `FACT_QUEEN_DEAD`, the ending
videos, restart and credits, the absence of a game over, the compression consequences of a played scene on the map, the
capture sequence and its quests, the POW handling on load and the path checks, the progress events, the first-battle
facts, the palace placement, the Queen's escape, the statue. **Checked on the user's data** (not reproduced): which
actions, facts and quest fields the 34 per-scene record files and the JOE, DEREK and OLIVER records use (§1.7, §6.5).
**Inferred**: that implications and scene loads read nothing of the player's world; that scene soldiers write nothing
back to profiles; that tactical AI keeps running under the conversation lock; the softlock when DEREK is absent; the
surface-death temp-file overwrite; the never-won case of a killer-less creature queen; the Alma box per POW; that a
surrender of five or more leaves the extra mercs uncaptured; Elliot's starting counter being small; that native saves
never carry a running scene or endgame.

**Decisions** (2026-10-16, replacing the open questions):
1. Meduna scenes resolve with played semantics (§2.1).
2. When DEREK is absent, fall back to `ENDGAME_STATE_1` at once (deviation). The killer-less creature queen counts as
   killed by the player, so the ending stays reachable (deviation). Keep the P3 b1 temp overwrite on a surface death (D1).
3. After victory the session is read-only: commands answer `campaignOver`, `observe` keeps working, and `save` stays
   allowed as an archive of the finished campaign.
4. No derived "stalled" signal: only `noUsableMercs`.
5. No interim interrogation: the second capture's path waits for the dialogue of `24`, which is implemented first.
6. Tactical `advance` does not stop on `meanwhile` by default; the map stops through compression.
7. `StrategicState.meanwhile` and the capture quests move into `25`'s narrative state when `25` is implemented.
8. M7 starts with a text card per scene; sandbox playback is optional later.
