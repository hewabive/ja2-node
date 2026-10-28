# 24 — NPCs and dialogue: records, conversations, barks and recruiting

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `X:` is `src/externalized/`, `V:` is vanilla
`Build/`, `J:` is `data/externalized/` (Stracciatella's `assets/externalized`). Bare file names are in `Tactical/`
except: `NPC.cc/.h`, `AI.h`, `AIMain`, `AIList`, `DecideAction`, `Realtime` (`TacticalAI/`); `Quests.cc/.h`, `Facts.h`,
`StrategicMap`, `Assignments`, `Meanwhile`, `Game_Init`, `Strategic_Event_Handler`, `Merc_Contract` (`Strategic/`);
`Isometric_Utils`, `Interactive_Tiles`, `Explosion_Control` (`TileEngine/`); `GameScreen`, `SaveLoadGame`,
`SaveLoadScreen` (root). "(inferred)" marks conclusions not traced end to end. C integer semantics apply (`idiv`, `u8`
wraps). `Random` = `main` stream, `PreRandom` = `pre` stream (`01` §3.6). A *profile* is a `MERCPROFILESTRUCT` (the
campaign profile of `22` §0), a *soldier* a `SOLDIERTYPE`. A *record* is one `NPCQuoteInfo`; a *record array* is the 50
records of one profile. The record *index* (0–49) and the *quote* (an EDT row) are different numbers. *The panel* is the
talk panel (`gfInTalkPanel`), *the queue* the dialogue queue (`ghDialogueQ`). A *frame* is one pass of the original's
main loop; ja2-node maps it to one 5 ms tick (§7.1). Action ids are `NPCAction` (`Interface_Dialogue.h:85-342`),
approaches `Approach` (`NPC.h:13-52`), facts `Fact` (`Facts.h`), quests `Quests.h`.

**Companions.** Owned elsewhere: `CheckFact`/`SetFact*` (`25` §1), `StartQuest`/`EndQuest` (`25` §2), what each action
of `HandleNPCDoAction` does and `HandleNPCSystemEvent` (`35` §1), `InitNPCs`, the 04:00 handler and NPC placement and
presence (profile insertion data, traversal, `ChangeNpcToDifferentSector`; `35` §2), schedules (`35` §3), civilian
groups (`35` §4), boxing (`25` §3), the escort campaign rules and the robot (`25` §4) and the hospital (`25` §6.3).
`26` owns the meanwhile scenes (which swap the Queen's and Elliot's record arrays, §1.4), the Queen, the ending and game
over. Also: `09` §5 (green AI of named NPCs, the `decideActionNamedNPC` hook), `33` §3.4
(`ProcessImplicationsOfPCAttack`), `12` §6 (give: AP, opcode 486), `14` §4 (save sections 19, 21, 38, 39), `15` §1.5
(pausing and locks), `16` (NPC of note), `22` (RPC pay, dismissal), `23` §9, `29` §23 (the shop the talk menu opens),
`30` §2.8 (talk panel, speech and civilian boxes on screen). The agent API of conversations (commands, prompts, events,
view fields) is `29`.

---

## 0. State

| State | Original | ja2-node |
|---|---|---|
| Record arrays | `gpNPCQuoteInfoArray[200]` (`NPC.cc:104`): null (not loaded) or 50 records | `npcRecords.arrays` (`NpcRecordState`): mutable copies of content, saved whole, not only the flags (save section 19, §11.3) |
| Backup arrays | `gpBackupNPCQuoteInfoArray[200]` (`:105`) | `npcRecords.backups`: a recruited RPC's own records (§1.4); section 39 |
| Civilian hint arrays | `gpCivQuoteInfoArray[20]` (`:106`) | `npcRecords.civilian`; section 19 after the profiles |
| NPC profile fields | approach values, dates, last quote, default-response flags, `bNPCData`, quote record (§1.2) | `ProfileProgress` (`NpcProfileFields`, `src/sim/tactical/profiles.ts`) |
| Soldier fields | `ubQuoteRecord`, `ubQuoteActionID`, `uiTimeSinceLastSpoke`, `bCurrentCivQuote`, `bCurrentCivQuoteDelta` | `Soldier.quoteRecord`, `quoteActionId`, `timeSinceLastSpoke`, `currentCivQuote`, `currentCivQuoteDelta` (imported by `savegame-soldier.ts`) |
| Talk session | `gTalkPanel.ubCharNum`, `gfInTalkPanel`, `gpSrcSoldier`, `gpDestSoldier`, `gubSrcSoldierProfile` (`Interface_Dialogue.cc:150-157`) | `TalkState.charNum`, `inPanel`; `talk.soldiers {src, dest, srcProfile}`: the last three outlive the panel, facts read them (§2.3), ja2-node saves them (deviation "Talk context in saves") |
| Pending conversation | `gfConversationPending` + the pending soldiers, approach, record and object copy (`:167-172`) | `TalkState.pending` (§6.3) |
| Trigger in flight | `gubTargetNPC`, `gubTargetRecord`, `gubTargetApproach`, `gfShowDialogueMenu`, `gfWaitingForTriggerTimer`, `guiWaitingForTriggerTime` (`:159-164`) | `TalkState.trigger`, `waitingForTrigger`, `triggerWaitStart` (500 ms of the tactical clock, §5.2) |
| Dialogue queue | `ghDialogueQ`, `gpCurrentTalkingFace`, `gubCurrentTalkingID` (`Dialogue_Control.cc:110-113`), `gTacticalStatus.ubLastQuoteSaid/ubLastQuoteProfileNUm` | `TalkState.queue`, `face {speaker, saidAt, busyUntil, pcTrigger}`, `lastQuoteSaid`, `lastQuoteProfile` (§7) |
| Engaged in conversation | `ENGAGED_IN_CONV` in `gTacticalStatus.uiFlags`, `giNPCReferenceCount` (`Dialogue_Control.cc:115`), the static `giNPCSpecialReferenceCount` (`NPC.cc:1365`), `ubEngagedInConvFromActionMercID` | `TacticalState.engagedInConv`, `engagedInConvFromActionMerc`; `TalkState.referenceCount`, `specialReferenceCount` (§5.6, §6.6) |
| Hostile-or-say-quote list | `gShouldBecomeHostileOrSayQuote[]`, `gubNumShouldBecomeHostileOrSayQuote` (`OppList.cc:508-523`) | transient (not saved, inferred) |
| Say-something-later | `gubNiceNPCProfile`, `gubNastyNPCProfile` (`Interface_Dialogue.cc:156-157`) + `FACT_NEED_TO_SAY_SOMETHING` | `TalkState.niceNpc`, `nastyNpc` (§6.5) |
| NPC request box | `gusDialogueMessageBoxType`, `ubRecordThatTriggeredLiePrompt` (`:166, 4157`) | the `npcRequest` prompt (§6.7) |
| Hospital money | `giHospitalTempBalance`, `giHospitalRefund`, `gbHospitalPriceModifier` (`:174-176`) | saved in section 24 (`SaveLoadGame.cc:1939-1942`); read by §4.3, owned by `25` §6.3 |
| Civilian group hostility | `gTacticalStatus.fCivGroupHostile[]` | shared with `33` §3.4 and `35` §4 |

The original cannot save while a talk session is open, `ENGAGED_IN_CONV` is set or an `npcRequest` prompt waits
(inferred: the Dead-Is-Dead autosave guard `SaveLoadScreen.cc:1368-1374` skips these states, and the panel's full-screen
mouse region, `Interface_Dialogue.cc:440`, blocks the other buttons). ja2-node refuses `save` while a session is open, a
scripted sequence runs or the queue is busy (`29`).

---

## 1. NPC data

### 1.1 Who has records

| Kind | Test | Record array used | Text file (§1.5) |
|---|---|---|---|
| NPC | profile type `NPC` (`J:mercs-profile-info.json`, `X:mercs/MercProfile.cc:77-85`) | its own (`npcdata/NNN.npc` or the JSON override) | `npcdata/NNN.edt` |
| RPC, not recruited | type `RPC` | its own | `npcdata/NNN.edt` |
| RPC, recruited | type `RPC` and `PROFILE_MISC_FLAG_RECRUITED` | a private copy of `000.npc`; its own array is parked as the backup (§1.4) | merc file, but the NPC file while he is in the panel |
| EPC | any profile with `PROFILE_MISC_FLAG_EPCACTIVE` (escorted NPCs such as JOHN, MARY, MARIA, JOEY, SKYRIDER) | its own (EPCs are NPC-type profiles) | `npcdata/NNN.edt` |
| Player merc (A.I.M., M.E.R.C., I.M.P.) | `isPlayerMerc()` (`X:mercs/MercProfile.cc:92-95`) | a private copy of `000.npc`, created only if a script triggers him | `mercedt/VVV.edt` |
| ROBOT | profile ROBOT | none (`EnsureQuoteFileLoaded` returns null, `NPC.cc:271`) | — |

`ChangeSoldierTeam` sets `PROFILE_MISC_FLAG_RECRUITED` for **every** profile moved to `OUR_TEAM` and clears it otherwise
(`Soldier_Profile.cc:673-679`), EPCs included, so `RPC_RECRUITED(s)` (`Soldier_Macros.h:13-17`) is true for an escorted
EPC. The `000.npc` switch tests the profile *type* (`X:DefaultContentManager.cc:1665-1676`, `NPC.cc:276`): RPCs only.

### 1.2 Profile fields for NPCs

Offsets into the decrypted 716-byte record (`LoadSaveMercProfile.cc:36-212`). `src/content/formats/prof.ts` reads all of
them (`MercProfile`); the mutable ones live in `ProfileProgress`.

| Field | Off | Type | Use |
|---|---|---|---|
| `usApproachFactor[4]` | 396 | u16 ×4 | the *merc's* multiplier (%) for approaches 1–4 when he talks (§2.1) |
| `ubApproachVal[4]` | 555 | u8 ×4 | the *NPC's* receptiveness per approach 1–4; changed once by the first approach (§2.2) |
| `ubApproachMod[3][4]` | 559 | u8 ×12 | row = first approach used (friendly, direct, threaten), column = value scaled; row-major |
| `bApproached` | 651 | i8 | first-approach bits `gbFirstApproachFlags` 0x01/0x02/0x04; 0x08 (recruit) is never set (`NPC.cc:111`) |
| `bMercOpinion[75]` | 576 | i8 ×75 | the NPC's opinion of the talking merc; ids ≥ 75 read 0 (deviation "Opinions of high profile ids") |
| `bTown`, `bTownAttachment` | 571, 572 | i8 | town loyalty weight in the desire (§2.1) |
| `ubLastDateSpokenTo` | 667 | u8 | `(UINT8)GetWorldDay()` of the last conversation (§3.5); read by Tony, Devin and the NPC-of-note prompt |
| `ubLastQuoteSaid`, `bLastQuoteSaidWasSpecial` | 529, 668 | u8 | what "repeat" says: a record index if special, else a quote (§3.2) |
| `bFriendlyOrDirectDefaultResponseUsedRecently`, `bRecruit…`, `bThreaten…` | 672–674 | i8 | default answer given once, then "get lost" (§3.3); cleared at 04:00 (`Strategic_Event_Handler.cc:699-708`, `35` §2.3) |
| `ubQuoteRecord`, `ubQuoteActionID` | 238, 410 | u8 | a walk to a record destination interrupted by unloading the sector (§5.3) |
| `bNPCData`, `bNPCData2` | 675, 688 | i8 | per-NPC scratch (Madame's counts, Daryl's spouse, …; `35` §2.8) |
| `iBalance` | 676 | i32 | money owed to (−) or by the NPC; payments (§4.2–§4.3) |
| `uiMoney` | 684 | u32 | cash in the profile inventory (§4.4) |
| `inv`, `bInvNumber`, `bInvStatus` | 416, 377, 358 | | the profile ("script") inventory: required-item tests read it, not the soldier (§2.4) |
| `sSalary` | 332 | i16 | RPC daily rate; `NPC_ACTION_RECRUIT` sets 0 (§9.1) |
| `ubMiscFlags`, `ubMiscFlags2`, `ubMiscFlags3` | 233, 231, 689 | u8 | flags below |
| `sGridNo`, `sSector.z`, `fUseProfileInsertionInfo`, `ubStrategicInsertionCode`, `usStrategicInsertionData` | 408, 669, 406, 522, 670 | | placement (`35` §2.6); written by `UnRecruitEPC` (§9.4) |
| `ubRoomRangeStart[2]`, `ubRoomRangeEnd[2]` | 413, 523 | u8 ×2 | room facts (`25` §1.3) |
| `ubFaceIndex`, eyes, mouth, blink, expression | 108, 262–269, 280, 284 | | portraits (UI only), served by `GET /api/sessions/:id/profiles` (the face index is the profile id, `LoadMercProfiles`; `29` §7) |
| `ubVoiceId` | save v104+ (`14` §4 row 5) | u8 | merc text and speech file id (§1.5) |

Flags read or written here (`Soldier_Profile_Type.h:25-51`): `RECRUITED 0x01`, `FORCENPCQUOTE 0x04` (an EPC's
abandonment line uses the NPC file), `WOUNDEDBYPLAYER 0x08`, `SAID_HOSTILE_QUOTE 0x20`, `EPCACTIVE 0x40`; flags2
`BANDAGED_TODAY 0x04`, `SAID_FIRSTSEEN_QUOTE 0x08`, `NEEDS_TO_SAY_HOSTILE_QUOTE 0x10`, `ASKED_BY_HICKS 0x40`; flags3
`PERMANENT_INSERTION_CODE 0x02`, `HANDLE_DONE_TRAVERSAL 0x08`, `NPC_PISSED_OFF 0x10`.

### 1.3 The record (`X:content/NPCQuoteInfo.h:8-66`)

| Field | `.npc` bytes | Meaning | Special values |
|---|---|---|---|
| `fFlags` | u16 @0 | `SAID 0x1`, `ERASE_ONCE_SAID 0x2`, `SAY_ONCE_PER_CONVO 0x4` | |
| `sRequiredItem` / `sRequiredGridno` | i16 @2 (a union) | > 0: an item the NPC must hold in its profile inventory to say it (§2.4), or the item it wants (§4.2); < 0: −gridNo where the NPC must stand | 0 none; 1000 `ACCEPT_ANY_ITEM`, 1001 `ANY_RIFLE` (giving only) |
| `usFactMustBeTrue`, `usFactMustBeFalse` | u16 @4, @6 | facts tested with `CheckFact(f, npc)` | `FACT_NONE` 65535; the loader maps any value > 368 (`FACT_PLAYER_KILLED_BOXERS`) to 65535 (`NPC.cc:133-135`) |
| `ubQuest` | u8 @8 | quest state required | q = in progress, 100 + q not started, 200 + q done; 255 `NO_QUEST` |
| `ubFirstDay`, `ubLastDay` | u8 @9, @10 | day window | 254 `MUST_BE_NEW_DAY`; last day 255 = none |
| `ubApproachRequired` | u8 @11 | approach that may produce it (§2.5) | 0, 29 `ONE_OF_FOUR_STANDARD`, 30 `FRIENDLY_DIRECT_OR_RECRUIT` |
| `ubOpinionRequired` | u8 @12 | minimum talk desire | 255 `IRRELEVANT` |
| `ubQuoteNum`, `ubNumQuotes` | u8 @13, @14 | first EDT row and count of consecutive rows | 255 `NO_QUOTE`: silent record |
| `ubStartQuest`, `ubEndQuest` | u8 @15, @16 | quests started/ended when it is chosen | 255 |
| `ubTriggerNPC`, `ubTriggerNPCRec` | u8 @17, @18 | record to trigger afterwards | 0 = closest merc who sees the NPC says merc quote `ubTriggerNPCRec`; 1 = self; 255 none |
| — | @19 | padding | |
| `usSetFactTrue` | u16 @20 | fact set when chosen | 65535 |
| `usGiftItem` | u16 @22 | item the NPC hands to the merc | 0 none; 65000/65001 `TURN_UI_OFF/ON`, 65002/65003 `SPECIAL_TURN_UI_OFF/ON` |
| `usGoToGridno` | u16 @24 | where the NPC walks afterwards | 65535 `NO_MOVE` |
| `sActionData` | i16 @26 | `NPCAction` to run; negative = early (§3.4) | 0 none; 501–649 = face profile (code − 500) |
| — | @28 (4 bytes) | unused | Russian build: a u32 `ubIdentifier` precedes the fields instead (`NPC.cc:122-155`) |

### 1.4 Files and loading

**Content** (once per session, `X:DefaultContentManager.cc:1379-1428`; skipped entirely without `binarydata/prof.dat`):
1. `J:script-records-control.json`: per meanwhile id (0–16) the QUEEN and ELLIOT files (`160–176.npc`, `180–196.npc`),
   kept as a separate table keyed `(meanwhile, profile)`.
2. The "script-controlled PCs" file `000.npc` → the recruited/PC template.
3. Stracciatella's `script-records-NPCs.json` (its corrected scripts, `X:content/NPCQuoteInfo.cc:9-106`): complete
   arrays for ten profiles (MARIA, JOEY, SKYRIDER, MARTHA, JOHN, MARY, HERVE, PETER, ALBERTO, CARLO). ja2-node ships
   them as `data/tables/npc-script-records.json` (`tools/transcribe/npc-script-records.ts`) without the `//` comments,
   which quote dialogue. Records missing from the JSON are zeros, so `ubLastDay` 0 makes them unsayable from day 1
   (§2.3). JSON defaults: `lastDay`, `quoteNum`, `numQuotes`, `triggerRecord` 255, `goToGridno` 65535, quest `NO_QUEST`;
   `requiredGridNo` is stored negated; `actionData.doFirst` negates the code; `turnToFace: NAME` encodes 500 + profile.
4. Every `npcdata/NNN.npc` (numeric prefix < 200, not `000.npc`; 32-byte records, 50 per file, `NPC.cc:113-159`) fills
   the profiles the JSON did not. A binary on more than one VFS layer overrides the JSON (`binIsOnModLayer`; every SLF
   file is a layer; ja2-node: `Vfs.layerCount`): in the user's install the loose `Data/NpcData/097.npc` and `118.npc`
   sit next to `Npcdata.slf`, so SKYRIDER and JOHN use their binary records. The meanwhile files 160–196 also load as
   the scripts of profiles 160–196 (vehicles and unused ids; harmless).

**Runtime copies.** `LoadQuoteFile` (`NPC.cc:227-250`) copies the content array (while `AreInMeanwhile()`, QUEEN and
ELLIOT get the current meanwhile's variant). Every reader and writer below calls `EnsureQuoteFileLoaded(p)`
(`:269-315`): ROBOT → none; recruited RPC without a backup → the current array (possibly null) becomes the backup, a
fresh `000.npc` copy is loaded; unrecruited RPC with a backup → the backup is restored, the copy dropped; otherwise load
if null. A missing file leaves null = "no records". So arrays are created lazily at the first read of any kind, which is
what the save's "present" byte means (§11.3).

**Resets.** New game: `ReloadAllQuoteFiles` (`Game_Init.cc:324`, `NPC.cc:420-435`) drops backups and reloads every
loaded NPC/RPC and civilian array from content. Loading a save: `ShutdownNPCQuotes` (`SaveLoadGame.cc:666`), the arrays
from the save (`NPC.cc:2402-2514`), `RefreshNPCScriptRecord` for saves < 98 (`:2428-2494`: listed records not yet said
are replaced by fresh content; `NO_PROFILE` record 5 means every PC's copy), then the once-per-conversation records of
NPCs whose profile sector is the loaded sector are reset (`SaveLoadGame.cc:1174`). Meanwhile start and end call
`ReloadQuoteFile` (`Meanwhile.cc:287, 523`), which **discards** that NPC's record state (`NPC.cc:318-323`; `26`).

**Civilian hint files.** `LoadCivQuoteFile(i)` (`NPC.cc:370-383`): index 16 → `npcdata/miners.npc`, else
`npcdata/<sector>.npc` for the 17 sectors of `gsCivQuoteSector` (`:57-80`); `FindCivQuoteFileIndex` (`:2706-2716`)
returns 16 underground and the table index on the surface. **Quirk (= V):** table entry 16 is L12, so L12's civilians
use `miners.npc` and never load `L12.npc`; their hint *text* still comes from `L12.edt` (§8.3).

### 1.5 Text and durations

- **Which EDT** (`X:content/Dialogs.cc:7-50`), decided when the quote **executes** (§7.2), not when queued: the
  alternate file `npcdata/d_NNN.edt` (RPC sector descriptions, §8.6); else `npcdata/NNN.edt` (151–154, HERVE, PETER,
  ALBERTO, CARLO, share 151's file) for an NPC/RPC that is not recruited, is the NPC of the open panel
  (`ProfileCurrentlyTalkingInDialoguePanel`, `Interface_Dialogue.cc:948-953`) or has `FORCENPCQUOTE`; else
  `mercedt/VVV.edt` by `ubVoiceId`. Speech samples follow the same choice (`npc_speech/NNN_QQQ.wav`,
  `npc_speech/d_NNN_QQQ.wav`, `speech/VVV_QQQ.wav`; in the Russian data `r_` before the voice id for a recruited RPC;
  `GetDialogueVoiceFilename` in `X:content/Dialogs.cc`).
- **Rows**: 240 UTF-16 code units per quote (`X:DefaultContentManager.cc:90, 394-398`); civilian files 160 per entry
  (`Civ_Quotes.cc:36, 144`). Decoding (`X:strings/EncryptedString.cc:6-40`): read the row, force the last unit to NUL,
  stop at the first NUL, subtract 1 from every unit > 33, then the per-language fix-ups (Russian CP1251 shift; three
  English code points). A missing or empty row makes `ExecuteCharacterDialogue` return without talking (§7.2).
- **Duration.** Speech on: the sample's length; off: 60 ms × UTF-32 length of the decoded quote (`Faces.cc:1229-1234`,
  `Dialogue_Control.cc:67, 1521-1524`) = **12 ticks per character**; then 300 ms with the mouth closed
  (`SetupFinalTalkingDelay`, `Faces.cc:1304`) = 60 ticks before the face is done. ja2-node holds the queue for the
  longer of the two (§7.6). Civilian boxes: `FindDelayForString("\"" + text + "\"") + 500` ms (`Civ_Quotes.cc:381`),
  presentation only.

---

## 2. Record selection

### 2.1 `CalcDesireToTalk(npc, merc, approach)` (`NPC.cc:470-518`), INT32 throughout

```
personal = 50 + npc.bMercOpinion[merc]
town     = gTownLoyalty[npc.bTown].ubRating * npc.bTownAttachment / 100
approachVal =
  100                                                      if approach ∈ {NPC_INITIATING_CONV, APPROACH_GIVINGITEM}
  npc.ubApproachVal[a-1] * (threat * merc.usApproachFactor[a-1] / 100) / 50     if THREATEN
  npc.ubApproachVal[a-1] * (merc.bLeadership * merc.usApproachFactor[a-1] / 100) / 50   otherwise
if npc.bTownAttachment < 100: personal = personal * (200 − attachment) / 100
w = (personal/2 + town/2) * approachVal / 100
if approach == NPC_INITIATING_CONV: w −= 30                 // INITIATING_FACTOR; unreachable, see §2.4
return u8(max(w, 0))                                        // (UINT8): values above 255 wrap
```

`threat = CalcThreateningEffectiveness(merc)` (`:451-467`): 0 without the merc's soldier on our team; else
`(EffectiveLeadership + EffectiveStrength + deadliness) / 2` (the comment says thirds), deadliness = the hand item's if
a weapon, else 0, and **0 becomes −30**. The non-threaten branch reads the **profile** leadership, the threaten branch
the **soldier's effective** stats. Towns without loyalty have rating 0 (`:481-482`). Debug builds print the desire next
to the menu entries (`Interface_Dialogue.cc:742-751`), and `informative_tooltips` (default false, `J:game.json:144`)
would show modifiers; ja2-node shows neither (deviation "Lines and debug text in the talk panel").

### 2.2 First approach (`ApproachedForFirstTime`, `NPC.cc:521-536`)

In `NPCConsiderTalking` the desire (approaches 1–4) is computed **first**; then, for approaches **1–3 only** (strict
`< NUM_REAL_APPROACHES`, `:558`) whose bit `bApproached` lacks: set it and scale all four
`ubApproachVal[k] = min(255, ubApproachVal[k] * ubApproachMod[a-1][k] / 100)` (u32). The first friendly/direct/threaten
click thus uses the old values and changes every later desire; recruit never scales. **Pablo quirk:** for
`APPROACH_SECTOR_NOT_SAFE` Pablo is treated as threatened (`:563-572`), but the bit test is not negated, so the scaling
happens only if he had **already** been threatened.

### 2.3 `NPCConsiderQuote(npc, merc, approach, i, desire, array)` (`NPC.cc:1049-1234`), in this order

1. `SAID` set → no.
2. Quest (`:1084-1112`): 255 passes; `ubQuest % 100 ≥ 30` throws; `> 200` → quest `q − 200` must be DONE; else `> 100` →
   `q − 100` NOT STARTED; else `q` IN PROGRESS. **Quirk:** the strict `>` decodes 100 and 200 (quest 0 not started /
   done) as "quest 100 in progress / not started" and reads `gubQuest[100]` past the 30-byte array. In the oracle build
   (probe `questdecode`) `gubFact` lies 512 bytes *before* `gubQuest` and the byte read is 0 whatever fact 70 holds:
   quest value 100 never passes, 200 always does. ja2-node reads 0 past the array (`OVERRUN_QUEST_VALUE`; deviation
   "Quest 100 and 200 in records").
3. `usFactMustBeTrue` ≠ 65535 → `CheckFact(f, npc)` must be true; `usFactMustBeFalse` → false (`25` §1.3). Several facts
   are computed from the conversation context, which outlives the panel: `gpSrcSoldier`/`gpDestSoldier` (talker
   strong/female, Dynamo, Shank, AIM merc within 10, …) and `gubSrcSoldierProfile` (Ira talking, Maddog,
   `CalcDesireToTalk(dest, src, RECRUIT) ≥ 50`) (`Quests.cc:287-330, 543, 707, 742, 837, 927-944, 1065`). `FACT_PC_NEAR`
   (100), the money facts and `FACT_ITEM_POOR_CONDITION` are plain stored facts set by §4.2 and §5.1.
4. Approach (`:1142-1169`): checked when the record requires one **or** the approach used is not FRIENDLY, DIRECT or
   TRIGGER_NPC; 29 accepts 1–4, 30 accepts 1, 2, 4, anything else must be equal (§2.5).
5. Days (`:1172-1209`, `day = GetWorldDay()`): `firstDay == 254` with a profile → `day > ubLastDateSpokenTo`, else
   `day ≥ firstDay`; then `day > lastDay && day < 255` fails. The u8 `ubLastDateSpokenTo` wraps after day 255, after
   which "new day" is always true (inferred consequence).
6. Opinion (`:1212-1225`): unless 255 or TRIGGER_NPC, `desire ≥ ubOpinionRequired`.

No draws, no state change (only debug logging).

### 2.4 `NPCConsiderTalking(npc, merc, approach, record, array, &q, &i)` (`NPC.cc:542-646`)

Needs the NPC's soldier (else returns 0 *before* clearing the result pointers, which `ConverseFull` pre-sets to a local
record; unreachable: every caller has the soldier). Desire: §2.1 for approaches 1–4 (Pablo: §2.2), else 0. Scans only
`record` for TRIGGER_NPC, else 0–49. Per record: `sRequiredItem > 0` → the item must be in the NPC's **profile**
inventory (`FindObjectInSoldierProfile`, `Items.cc:3013-3022`; 1000/1001 never match, so "wants any item" records are
invisible here); `< 0` → the NPC's soldier must stand on that gridNo; then §2.3. Except for `NPC_INITIATING_CONV` the
**first** passing record wins: result = that record, its index and its opinion requirement. For `NPC_INITIATING_CONV` it
looks for the highest `ubOpinionRequired` **> 0**, but with desire 0 only opinion 0 or 255 passes §2.3 step 6: only
records requiring approach 7 with opinion 255 count. It returns that opinion with the **last scanned** record and its
*quote* number instead of its index (both unused by the only caller, §5.4).

### 2.5 Approaches

| Id | Approach | Entered by | Records consulted | If none |
|---|---|---|---|---|
| 1–4 | FRIENDLY, DIRECT, THREATEN, RECRUIT | menu (§6.4) | first match; record approach 0 matches 1, 2 and 10 | default quote (§3.3) |
| 5 | REPEAT | menu | none | last quote(s) |
| 6 | GIVINGITEM | give (§4) | `NPCConsiderReceivingItemFromMerc` | quote 4, close panel |
| 7 | NPC_INITIATING_CONV | AI (§5.4) | highest opinion | — |
| 8 | NPC_INITIAL_QUOTE | start of a talk (§3.2) | 12 then 17 | quote 0 or 1 |
| 9 | NPC_WHOAREYOU | name click | none | quote 0 |
| 10 | TRIGGER_NPC | triggers (§5.1) | the one record; opinion ignored | abort silently |
| 11 | GIVEFIRSTAID | first aid on an NPC | `PCDoesFirstAidOnNPC` (`NPC.cc:2182-2212`) | — |
| 12, 17 | SPECIAL_INITIAL_QUOTE, INITIAL_QUOTE | via 8 and 6 | first match | quote 0 |
| 13 | ENEMY_NPC_QUOTE | talk to a non-neutral NPC | first match | quote 0 |
| 14 | DECLARATION_OF_HOSTILITY | §3.6 | first match | quote 0 |
| 15 | EPC_IN_WRONG_SECTOR | un-escort (§9.4) | `GetInfoForAbandoningEPC` | — |
| 16 | EPC_WHO_IS_RECRUITED | talk to an escorted EPC | first match | quote 0 |
| 18 | CLOSING_SHOP | **nothing** (no caller in Strac or V) | — | dead records |
| 19 | SECTOR_NOT_SAFE | override (§3.1) | first match | quote 0 |
| 20–27 | DONE_SLAPPED, DONE_PUNCH_0–2, DONE_OPEN_STRUCTURE, DONE_GET_ITEM, DONE_GIVING_ITEM, DONE_TRAVERSAL | completion of an NPC action (§5.5) | first match | nothing |
| 28 | BUYSELL | menu or give to a dealer | first match | shop (`23` §9.1) |
| 29, 30 | ONE_OF_FOUR_STANDARD, FRIENDLY_DIRECT_OR_RECRUIT | record requirement only | | |

### 2.6 "Records used" bookkeeping

| Change | Where |
|---|---|
| `SAID` set on the chosen record if it has `ERASE_ONCE_SAID` or `SAY_ONCE_PER_CONVO` | `ConverseFull` (`NPC.cc:1677-1680`) |
| `SAID` set by actions (`SET_*_RECORD_13_USED`, `MARK_KINGPIN_QUOTE_0_USED`) | `SetQuoteRecordAsUsed` (`:443-448`), `35` §1 |
| `SAID` set on a civilian hint | `ConsiderCivilianQuotes(…, TRUE)` (`:2732-2735`) |
| `SAID` cleared on all `SAY_ONCE_PER_CONVO` records | at `NPC_INITIAL_QUOTE` (`:1408`), when the player closes the panel (Done/Esc, `Interface_Dialogue.cc:993, 1005`), after loading a save (§1.4); **not** when a script closes it |
| Darren's record 11 un-said at each initial quote while `FACT_281` is false | `:1413-1416` |
| Whole array reset | new game, meanwhile reload (§1.4) |

A record flagged `alreadySaid` in data starts unsayable; only a once-per-conversation reset can revive it.

### 2.7 Other record mutations (all saved with the array)

- `ReplaceLocationInNPCData(old, new)` (`NPC.cc:1237-1264`): every record whose required gridNo or `usGoToGridno` equals
  `old` gets `new`. Called when a record walk ends "close enough" (`SpacesAway < 4` from the destination, not on a
  schedule, `AIMain.cc:415-428`; or the path fails within 4 tiles, `:1479-1488`): the script is permanently rewritten to
  the tile reached.
- `UpdateDarrelScriptToGoTo(s)` (`NPC.cc:2667-2694`): Darrel's record 10 goes to a sweet spot near `s` (radius 5, then
  10); record 11 requires that tile and triggers `s`'s profile (`25` §6.9).

---

## 3. A conversation step: `ConverseFull(npc, merc, approach, record, object)` (`NPC.cc:1363-1951`)

`Converse(npc, merc, a)` = `ConverseFull(npc, merc, a, 0, null)` (`:1954-1957`); `object` is non-null exactly for
GIVINGITEM.

### 3.1 Prologue (`:1374-1401`)

With the NPC's soldier: `uiTimeSinceLastSpoke = now` (wall clock, §10.2); `!CheckFact(FACT_CURRENT_SECTOR_IS_SAFE, npc)`
(enemies in the sector and the NPC heard a shot, or in combat, `Quests.cc:495-497`), an approach other than TRIGGER_NPC,
GIVEFIRSTAID, DECLARATION_OF_HOSTILITY, ENEMY_NPC_QUOTE and `NPCHasUnusedRecordWithGivenApproach(npc, SECTOR_NOT_SAFE)`
→ the approach **becomes** SECTOR_NOT_SAFE (an initial quote then skips §3.2); clear `AI_ASLEEP`. No array → return the
object to the giver (§4.4), stop.

### 3.2 Initial quote, who-are-you, repeat (`:1404-1501`)

- **NPC_INITIAL_QUOTE**: reset once-per-conversation records; Darren's record 11 (§2.6); queue
  `NPCDoAction(npc, TURN_TO_FACE_NEAREST_MERC, 1)`. If `ubLastDateSpokenTo > 0`: on a later day try
  SPECIAL_INITIAL_QUOTE (found → return the object, `Converse(SPECIAL_INITIAL_QUOTE)`, stop), else quote 1
  (`QUOTE_SUBS_INTRO`); same day → **say nothing** and stop (skipping the last-date update, which would write today
  anyway). Never spoken to: try SPECIAL_INITIAL_QUOTE, then INITIAL_QUOTE (found → recurse with it), else quote 0. A
  default quote sets `ubLastQuoteSaid = q`, `bLastQuoteSaidWasSpecial = FALSE`.
- **NPC_WHOAREYOU**: quote 0, not remembered.
- **REPEAT**: `ubLastQuoteSaid == 255` → quote 0; special → the record's quotes again (no actions); else that quote.

### 3.3 Approaches and default answers (`:1502-1648`)

GIVINGITEM first plays an introduction (`:1505-1538`): spoken to before, on a later day → SPECIAL_INITIAL_QUOTE if one
matches (`Converse` recursion; Darren then refuses the item and stops); never spoken to → INITIAL_QUOTE if one matches;
then §4.2 picks the record. TRIGGER_NPC passes `record`; everything else scans from 0.

No record: TRIGGER_NPC aborts (nothing said or set); otherwise the default quote below is queued and remembered as
`ubLastQuoteSaid` (non-special):

| Approach | First time | Once the flag is set |
|---|---|---|
| FRIENDLY | quote 2 + `Random(2)`, set the friendly/direct flag | quote 9 (`GETLOST`) |
| DIRECT | quote 5, set the same flag | 9 |
| THREATEN | quote 6, set the threaten flag | 9 |
| RECRUIT | quote 7, set the recruit flag | 9 |
| GIVINGITEM | quote 4 (`GIVEITEM_NO`) | — |
| any other | quote 0 | — |

Quote 9 → profiles 70 (CONRAD) and 120 (GENERAL) queue `NPC_ACTION_BECOME_ENEMY`; the panel closes after the speech
(`NPCClosePanel`). Quote 4 → close after the speech; JIM, JACK, OLAF, RAY, OLGA, TYRONE (the assassins) cancel their AI
action and join the hostile-or-say-quote list (§3.6).

### 3.4 Applying the chosen record (`:1649-1923`), in this order

| Step | What | When it takes effect |
|---|---|---|
| 1 | `sActionData ≤ −500` (face a profile): zero the AI counter, drop a pending WAIT, queue the action | queued **before** the quotes |
| 2 | `ubQuoteNum ≠ 255`: queue quotes `ubQuoteNum … +ubNumQuotes−1`; `ubLastQuoteSaid = index`, special | queued |
| 3 | `SAID` if erase-once or once-per-conversation | immediate |
| 4 | GIVINGITEM and action ≠ `DONT_ACCEPT_ITEM` (1): the NPC takes the object (§4.4) | immediate |
| 5 | `usSetFactTrue`, then `EndQuest`, then `StartQuest` (both with `gWorldSector`) | **immediate, before any quote is heard** |
| 6 | `usGiftItem ≥ 65000`: UI codes (§5.6); else ≠ 0: the NPC soldier must hold it (else `logic_error`) → queue the give (§4.5) | immediate / queued |
| 7 | `−500 < sActionData < 0`: zero the counter, queue the action; else `usGoToGridno == 65535 && sActionData > 0`: same, positive | queued after the quotes |
| 8 | `usGoToGridno ≠ 65535`: Kyle gets keys; already there → `ubQuoteRecord = i+1`, `NPCReachedDestination(npc, TRUE)`; else stop cowering, `ubQuoteRecord = i+1`, then `TELEPORT_NPC` (150) → bump, teleport, `NPCReachedDestination(FALSE)`; else (issue #750: `REMOVE_NPC` clears the profile sector first) queue `NPCGotoGridNo` (§5.3) | immediate / queued |
| 9 | Triggers (`ubTriggerNPC`): 0 → `TriggerClosestMercWhoCanSeeNPC` (§5.1); 1 → `TriggerNPCRecord(npc, rec)`; else `TriggerNPCRecord(other, rec)` | the check is immediate, the trigger queued |

A positive action together with a destination runs on arrival (§5.3), not here.

### 3.5 Epilogue (`:1926-1950`)

`ubLastDateSpokenTo = u8(day)` for FRIENDLY, DIRECT, THREATEN, RECRUIT, NPC_INITIATING_CONV, NPC_INITIAL_QUOTE,
SPECIAL_INITIAL_QUOTE, DECLARATION_OF_HOSTILITY, INITIAL_QUOTE and GIVINGITEM (not for TRIGGER_NPC, ENEMY_NPC_QUOTE,
SECTOR_NOT_SAFE, EPC approaches or REPEAT). Then the object goes back to the giver unless the approach was GIVINGITEM
and a record accepted it (§4.4).

### 3.6 Hostility through dialogue

- **The hostile-or-say-quote list** (`OppList.cc:508-613`). `AddToShouldBecomeHostileOrSayQuoteList(s)` adds a living (≥
  OKLIFE) soldier once. `CheckHostileOrSayQuoteList` runs every overhead pass (`Overhead.cc:494`) with an empty queue,
  no panel and no trigger wait: flag every listed profile `NEEDS_TO_SAY_HOSTILE_QUOTE`; keep those with
  `NPCHasUnusedHostileRecord(DECLARATION_OF_HOSTILITY)` (a usable record not requiring fact 289, `NPC.cc:2317-2334`),
  unflag the rest. None kept → every listed neutral → `MakeCivHostile`, a civilian group at "will become hostile" →
  hostile, AI unpaused, list cleared, combat for `CIV_TEAM` unless in combat. Else pause all AI, reveal the speaker to
  our team if unseen, `TriggerNPCWithIHateYouQuote` (§5.1) on `Random(n)` of them: one speaker at a time across frames.
  `FACT_NPC_IS_ENEMY` counts the `NEEDS_TO_SAY_HOSTILE_QUOTE` flag (`Quests.cc:616-618`), so the declaration record sees
  its NPC as hostile. ja2-node: `checkHostileOrSayQuoteList` in the tactical step
  (`src/sim/tactical/narrative/civ-hostility.ts`).
- **Entry points** feeding the list: a neutral civilian-group member who sees us while the group "will become hostile",
  or a non-neutral NPC with an unused declaration record (`NPCHasUnusedRecordWithGivenApproach`, which unlike the
  speaker test does not skip fact-289 records; `OppList.cc:1536-1563, 1671-1677`); Eldin and the museum (`:1578-1595`);
  `NPC_ACTION_BECOME_ENEMY` (`Interface_Dialogue.cc:1856-1880`: civilian group → side change, then the list); the
  assassins (§3.3, §6.2); civilian-group side changes (`Overhead.cc:2674-2809`); not ported (§12.5): "draws first" when
  we aim at a neutral armed NPC out of combat (`Handle_UI.cc:2126-2136`, `NPCFirstDraw` `TeamTurns.cc:1737-1768`:
  exp-level halves with +1 if the NPC was **threatened**, two `Random` draws) and minor offences such as taking an owned
  item (`MakeNPCGrumpyForMinorOffense`, `Handle_Items.cc:3224-3260`, `35` §4.4: fifteen listed profiles, mostly
  shopkeepers, get `NPC_PISSED_OFF` and an I-hate-you trigger, everyone else the list).
- **Actions** (index only; `35` §1.2): `ENTER_COMBAT` 25 (side change or `MakeCivHostile`, close panel, enter combat for
  the NPC's team, `Interface_Dialogue.cc:2648-2672`), `END_COMBAT` 166, `BECOME_FRIENDLY_END_COMBAT` 167 (neutral again,
  opponent counts, `ExitCombatMode` when nobody fought, `:2730-2761`), `TRIGGER_FRIEND_WITH_HOSTILE_QUOTE` 21 (now only
  closes the panel). `TriggerFriendWithHostileQuote` (`NPC.cc:2517-2565`) keeps two live callers: `EndAIGuysTurn`
  (`AIMain.cc:530-546`: a non-neutral civilian-group member ending his turn-based turn runs
  `CivilianGroupMembersChangeSidesWithinProximity` and triggers the first profile it returns) and
  `NPC_ACTION_GET_OUT_OF_WHEELCHAIR_AND_BECOME_HOSTILE` (`Interface_Dialogue.cc:3670-3680`).
- **`MakeCivHostile`** (`Overhead.cc:2591-2671`) and the civilian-group functions (`:2674-2809`) are shared with
  `ProcessImplicationsOfPCAttack` (`33` §3.4) and owned by `35` §4. `CivilianGroupMemberChangesSides` moves group
  members off our team with `ChangeSoldierTeam`, makes in-proximity members hostile, posts
  `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` (+300 min) and draws `Random(2)` for a "first profile" that only
  commented-out code reads; the draws still happen.

---

## 4. Giving items and money

### 4.1 The give action

- **Paths.** Drag an item onto a soldier passing `IsValidTalkableNPC(t, give=TRUE, mercs=FALSE, collapsed=TRUE)`
  (alternative cursor: any merc, `Interface_Items.cc:3183-3202`). AP check: `GetAPsToGiveItem` = path + `AP_GIVE_ITEM` 1
  (`Points.cc:1426-1429`, `Points.h:142`); a robot target is reloaded instead (`Interface_Items.cc:3214-3299`); else
  `SoldierGiveItem(merc, target, copy, slot)`, and a profiled target that is neither a player merc nor a recruited RPC
  sets `ENGAGED_IN_CONV` with `ubEngagedInConvFromActionMercID` (`:3310-3314`, `Dialogue_Control.cc:1532-1537`): game
  paused, UI locked during the walk. The menu's "Give" (non-dealers) only closes the panel, opens the inventory and
  makes the NPC wait 10 s (`bNextAction = WAIT`, data 10000) unless it has a pending action
  (`Interface_Dialogue.cc:829-850`).
- **`SoldierGiveItem`** (`Handle_Items.cc:1056-1094`): an adjacent tile (`FindAdjacentGridEx`) or nothing; pending
  `MERC_GIVEITEM` (slot, object copy, target's tile, direction and id); both soldiers `SOLDIER_ENGAGEDINACTION`; walk
  there or start the give animation.
- **Opcode 486** (`Soldier_Ani.cc:1335-1343`) → `SoldierGiveItemFromAnimation`, then, for an NPC-type giver,
  `TriggerNPCWithGivenApproach(giver, DONE_GIVING_ITEM)`.
- **`SoldierGiveItemFromAnimation`** (`Handle_Items.cc:2306-2498`): take the copy; **`DeductPoints(AP_PICKUP_ITEM 3)`**
  (the check was for 1); `VerifyGiveItem` (`:2258-2303`): the soldier now on the target tile must be the target, else
  the object drops VISIBLE at the giver's tile, both are disengaged and
  `TriggerNPCWithGivenApproach(giver, DONE_GIVING_ITEM)` runs for any giver. Then, by target:
  - **dealer** (`IsMercADealer`): undo the engaged flag; an unused BUYSELL record → trigger it (the merc keeps the
    item); else `NPCWillingToAcceptItem` false → the shop opens with the item offered (`23` §9.1), true → as an NPC
    below;
  - **player merc or recruited RPC**: `AutoPlaceObject`, else drop VISIBLE at the giver's tile; the source slot is
    deleted whole (`DeleteObj`); money to a profile with `iBalance < 0` pays it down to at most 0 (message);
  - **NPC**: remove the given count from the slot (`RemoveObjs`), then
    `InitiateConversationFull(target, giver, GIVINGITEM, 0, &copy)` (§6.3): a conversation opens around the item.

### 4.2 `NPCConsiderReceivingItemFromMerc(npc, merc, obj, array)` (`NPC.cc:660-941`)

1. `FACT_NPC_IS_ENEMY` for this NPC and not JOE → nothing.
2. Desire = `CalcDesireToTalk(npc, merc, GIVINGITEM)` (approach value 100).
3. Normalise the item: a gun of rifle or MG class (not ROCKET_LAUNCHER) → `ANY_RIFLE`; HEAD_2, 3, 5, 6, 7 → HEAD_2
   (HEAD_4, Slay's, stays); MONEY, SILVER, GOLD → set `FACT_SMALL_AMOUNT_OF_MONEY` (< 1000) or
   `FACT_LARGE_AMOUNT_OF_MONEY` and treat as MONEY (**never reset**: both can end up true); WINE, BEER → ALCOHOL.
4. `FACT_ITEM_POOR_CONDITION` = `status[0] < 50`.
5. Scan 0–49: `sRequiredItem > 0` and equal to the item or 1000; `NPCConsiderQuote(…, GIVINGITEM, …)`, so only records
   requiring approach 6 exactly can take items (record approach 0, 29 and 30 do not match 6). The first match decides,
   with these money cases (all for item MONEY):

| NPC | Condition | Result |
|---|---|---|
| DARREN | record action `DARREN_GIVEN_CASH` 141 | < 1000 → record 15; > 5000 → 16; else `iBalance = amount`, `FACT_DARREN_EXPECTING_MONEY` false, record 17 if unsaid, else 18 if Kingpin's soldier is in his house (rooms 30–39 of D5, `Quests.h:209`), else 31 |
| ANGEL | action `ANGEL_GIVEN_CASH` 142 | below / above / equal to the LEATHER_JACKET_W_KEVLAR price → 8 / 9 / 10 |
| MADAME | any | female talker → 5; 100/200 with `FACT_CARLA_AVAILABLE`, 500/1000 Cindy, 300/600 Bambi, 400/800 with RESCUE_MARIA in progress: `bNPCData += amount / unit`, `TriggerNPCRecord(MADAME, 16/17/18/19)`, then the scanned record; anything else → 25 |
| JOE, GERARD | action ≠ `JOE_GIVEN_CASH` 203 / `GERARD_GIVEN_CASH` 201 | the scanned record; otherwise as WALTER |
| STEVE, VINCE | `!FACT_VINCE_EXPECTING_MONEY` and `iBalance < 0` and action ≠ 1 | pay the debt (`iBalance += amount`, `uiTotalCostToDate += amount`, at most 0, message); the scanned record |
| | else `!EXPECTING` and action ≠ 1 | record 8 (Vince) / 7 (Steve), but the returned **index stays 0** (only the pointer is set), so `ubLastQuoteSaid`, action and goto use index 0 |
| | else | §4.3 |
| WALTER, FRANK (and JOE, GERARD) | any | §4.3 |
| KINGPIN | QUEST_KINGPIN_MONEY in progress | §4.3 |
| others | SKYRIDER or an RPC, `iBalance < 0`, action ≠ 1 | pay the debt as above; the scanned record |

Every side effect above (facts, balances, Madame's triggers) happens while *choosing*, also in the dealer's dry run
`NPCWillingToAcceptItem` (`NPC.cc:2337-2348`). `CheckFact(VINCE_EXPECTING_MONEY)` is evaluated in each condition of the
Vince/Steve chain (twice before the hospital branch), which matters for the order of the computed facts.

### 4.3 `HandleNPCBeingGivenMoneyByPlayer(npc, amount)` (`NPC.cc:945-1046`) → record index

| NPC | Rule |
|---|---|
| STEVE, VINCE | `cost = CalcMedicalCost(npc)` (`25` §6.3). `amount + temp + refund ≥ cost` → 26 with `FACT_WOUNDED_MERCS_NEARBY`, 25 with `FACT_ONE_WOUNDED_MERC_NEARBY`, else 0; if `refund > 0`: `refund = max(0U, refund − cost + amount)` evaluated **unsigned**, so the clamp never bites and a negative result survives the assignment back to INT32; `temp = 0`. Short → message "needs $(cost − amount − temp)", record 27, `temp += amount` |
| KINGPIN | `amount < −iBalance` → 9, else 10; `iBalance += amount` |
| WALTER | `iBalance == 0` → 12, else 13; `iBalance += amount` |
| FRANK | Frank's dealer cash `+= amount` (`23` §6); record 0 |
| GERARD / JOE | `iBalance += amount`; ≥ 10000 → 12 / 7, else 11 / 6 |
| others | 0 |

### 4.4 Taking and returning the object

- **Taking** (`ConverseFull` step 4, `NPC.cc:1685-1708`): `PlaceObjectInSoldierProfile(npc, obj)`
  (`Items.cc:2870-2947`). Money with cash already in the profile → `uiMoney += amount`, money object rebuilt. Else the
  first slot from BIGPOCK1POS up to **but excluding** SMALLPOCK8POS empty in the profile and on the soldier: money →
  `uiMoney += amount` (slot stays unmarked); other items → profile `inv/status/number` = item, `status[0]`, count, and
  the soldier gets a **fresh** `CreateItem(item, status)` (or `CreateMoney(uiMoney)`): attachments, ammo and further
  stack members are lost (Madlab first drops the attachments VISIBLE at his tile). No free slot → returns FALSE, the
  object is gone. Removal from the giver: `FindExactObj` compares pointers (`Items.cc:352-361`) and never matches the
  copy, so our merc loses nothing more; a non-player giver loses one item of that kind from its profile.
- **Returning** (`ReturnItemToPlayer`, `NPC.cc:1344-1357`): `AutoPlaceObject` on the giver, else into the item cursor
  (`InternalBeginItemPointer`). When: no array, the approach changed (introduction recursion, sector-not-safe), no
  record matched, the record's action is `DONT_ACCEPT_ITEM` 1, or Darren refused after his introduction. ja2-node drops
  an item that does not fit VISIBLE at the giver's tile (deviation "Returned items").

### 4.5 The NPC gives an item (`usGiftItem`)

The queued `DialogueEventGiveItem` (`NPC.cc:1317-1341`) runs `HandleNPCItemGiven(npc, &soldier.inv[slot], slot)`
(`Interface_Dialogue.cc:1250-1278`), with `gpDestSoldier` for the reach test and as the giver and
`FindSoldierByProfileID(npc)` for a dropped copy. If the panel's talker cannot receive it
(`SourceSoldierPointerIsValidAndReachableForGive (gpDestSoldier)`, `:1212-1247`: `gpSrcSoldier` active, in sector, ≥
OKLIFE, not collapsed below OKBREATH, within `MaxDistanceVisible()` = 2 × STRAIGHT (`OppList.cc:875-878`) of the NPC, an
adjacent tile exists), the item is copied into the pool VISIBLE at the NPC's tile (level 0, z 0; the NPC keeps its own
copy, inferred: nothing deletes it) and `DONE_GIVING_ITEM` is triggered; else the panel closes and
`SoldierGiveItem(npc, talker, obj, slot)` walks the NPC over (§4.1; the merc receives it, then `DONE_GIVING_ITEM`). The
NPC's **profile** inventory keeps the item (only the soldier slot is deleted, `Handle_Items.cc:2449-2452`), so a later
required-item test still sees it (inferred consequence). Items that NPC *actions* hand over (Fatima's letter, Darren's
winnings) belong to `35` §1 (deviation "NPC gives an item").

### 4.6 Give details

- **The object.** A drag picks up one item of a stack (`GetObjFrom(slot, 0)`), with Shift the whole slot
  (`RemoveObjectFromSlot`); a left click on money takes the whole pile; the item description's money box splits off
  steps of 10 (`RemoveMoney`: the pocket shrinks at once, source slot `NO_SLOT`). Before the give,
  `HandleItemPointerClick` puts the cursor object back into its slot (`PlaceObject`): one item from a stack goes to the
  end, so the NPC branch's `RemoveObjs(slot, 1)` removes the *new* first item; the NPC gets the first item's status and
  the merc keeps a copy of it (kept).
- **AP.** The cursor cost is `GetAPsToGiveItem` to the adjacent tile (`FindAdjacentGridEx` without forcing to the
  person), refused with "no path" when it is 0; then the walk to the target's own tile plus 1 must be affordable; the
  animation charges 3 (§4.1).
- **Engaged flags.** `SetEngagedInConvFromPCAction` (§4.1; an escorted EPC counts as `RPC_RECRUITED`) runs even when
  `SoldierGiveItem` found no adjacent tile: a soft lock, which ja2-node avoids by refusing with `noPath`. Both soldiers'
  `SOLDIER_ENGAGEDINACTION` stops `HandleSoldierAI` for them; the dealer branches return before clearing it, so a
  dealer's AI stays stopped after a give (kept).
- **`VerifyGiveItem`.** Another soldier on the target's tile: nothing happens. Nobody there: at the give's *start* the
  temporary object drops VISIBLE at the giver's tile while the slot still holds the item (a duplicate, kept) and
  `DONE_GIVING_ITEM` is triggered for the giver; at the *animation* the temporary object was already taken, so nothing
  drops (money split off a pocket is lost).
- **Dealers.** An unused BUYSELL record is triggered and the object is discarded (the merc keeps a slot item; split
  money is lost). Otherwise the shop opens with the object on the offer table and `RemoveObjFrom(slot, count)` removes
  the object at index `count` of the slot (the whole object for a single item, the second item of a stack when one was
  given); ja2-node keeps the object in the merc's pockets (deviation "Giving to a dealer").
- **Team members.** `AutoPlaceObject` empties the money object it places (Stracciatella's `FillMoneySlot`), so the debt
  payment that follows adds 0: giving money to a recruited RPC who is owed money only prints "still owed" (Strac; kept).

---

## 5. Triggers, scripted movement and NPC-initiated talk

### 5.1 Trigger functions (`NPC.cc`)

| Function | Check (now) | Then |
|---|---|---|
| `TriggerNPCRecord(p, r)` (`:2107-2124`) | `NPCConsiderQuote(p, merc 0, TRIGGER_NPC, r, 0)` | queue `DialogueEventTriggerNPC(p, r, TRIGGER_NPC, show = quote ≠ 255)` (`:2078-2104`) |
| `TriggerNPCRecordImmediately(p, r)` (`:2127-2144`) | same | `HandleNPCTriggerNPC` now |
| `TriggerNPCWithGivenApproach(p, a)` (`:2369-2385`) | first record passing approach `a` | queue the trigger with approach `a` |
| `TriggerNPCWithIHateYouQuote(p)` (`:2279-2298`) | first record passing DECLARATION_OF_HOSTILITY | queue with the panel; `SAID_HOSTILE_QUOTE` |
| `TriggerClosestMercWhoCanSeeNPC(p, rec)` (`:2215-2277`) | our controllable mercs that currently see the NPC (none → nothing); one by `Random(n)` | queue `NPCClosePanel`; trigger value 64 (`QUOTE_RESPONSE_TO_MIGUEL_SLASH_QUOTE_MERC_OR_RPC_LETGO`): that merc says 64 with `FACE_PCTRIGGER_NPC`, `giNPCReferenceCount++`, and after the line Miguel's record 6 is triggered (`Dialogue_Control.cc:396-404`); otherwise `TacticalCharacterDialogue(merc, rec)` |
| `PCsNearNPC(p)` (`:2147-2180`) | `FACT_PC_NEAR` true; soldier `ubQuoteRecord = 0`; first record requiring the NPC's tile and passing TRIGGER_NPC | trigger it immediately; `FACT_PC_NEAR` false again |
| `PCDoesFirstAidOnNPC(p)` (`:2182-2212`) | `BANDAGED_TODAY`; `ubQuoteRecord = 0`; first record requiring GIVEFIRSTAID that passes TRIGGER_NPC | immediately; returns "first aid refused" (`Soldier_Control.cc:6918`) |
| `NPCHasUnusedRecordWithGivenApproach` (`:2301-2314`) | any record passing | boolean, no effect |

The record is checked again when the trigger is handled (§2.4); in between, `FACT_PC_NEAR` is already false again, so a
delayed (show) record that needs it would abort after its panel opened (inferred: depends on data). `show` treats quote
0 as dialogue, while `RecordHasDialogue` (`:2697-2703`), which decides whether another NPC's panel closes, treats quote
0 as none.

### 5.2 `HandleNPCTriggerNPC` and `HandleNPCTrigger` (`Interface_Dialogue.cc:1284-1416`)

```
HandleNPCTriggerNPC(p, r, show, a):
  no soldier → return
  remember p, r, a, show
  soldier on our team → alert GREEN, clear ENGAGEDINACTION
  panel open with this NPC and show → HandleNPCTrigger(); return
  show → wait 500 ms (UI locked; radio locator; camera on the NPC if visible) then HandleNPCTrigger()
  else  → HandleNPCTrigger()
  RecordHasDialogue(p, r) → DeleteTalkingMenu()                  // at once, before the wait ends

HandleNPCTrigger():
  panel open:
    this NPC:  show → ConverseFull(p, NO_PROFILE, a, r)
               else, gpSrcSoldier set → InitiateConversationFull(dest, src, a, r)      // re-creates the panel
    other NPC: ConverseFull(p, NO_PROFILE, a, r)       // queues p's quotes through the *open* panel (§7.2)
  no panel:
    show → talker = gpSrcSoldier if it passes §4.5's test against p, else the soldier on ClosestPC's tile,
           else p itself → InitiateConversationFull(p, talker, a, r)
    else → ConverseFull(p, NO_PROFILE, a, r)
```

The wait polls `GetJA2Clock` every game-screen frame (`HandleWaitTimerForNPCTrigger`, `:1419-1436`,
`GameScreen.cc:337`); `EmptyDialogueQueue` cancels it (`Dialogue_Control.cc:215-221`). ja2-node measures it on the
tactical clock (`TRIGGER_WAIT_MS`, `handleWaitTimerForNpcTrigger` before each tactical step; fires once more than 500 ms
have passed; deviation "Dialogue queue cadence"). With an approach other than TRIGGER_NPC (declarations, DONE_*,
BUYSELL) `ConverseFull` scans from record 0, so the record played is the first match *then*. A conversation the NPC
opens with itself as the talker has `gubSrcSoldierProfile` = the NPC.

### 5.3 Scripted movement

- **Start** (`NPCGotoGridNo`, queued, `:1158-1182` → `HandleNPCGotoGridNo`, `:1439-1490`): close the panel; zero the AI
  counter and drop a pending WAIT; a soldier of ours gets `SOLDIER_PCUNDERAICONTROL`; next action WALK to the tile;
  cancel the current action unless it is a pending one; `ubQuoteRecord = r + 1`;
  `ubQuoteActionID = ActionIDForMovementRecord` (`NPC.cc:2568-2582`: actions 103–106 `TRAVERSE_MAP_*` → ids 5–8, else
  `CHECKFORDEST` 1, `AI.h:95-102`); `sAbsoluteFinalDestination` = the tile; `AI_HANDLE_EVERY_FRAME`.
- **While walking** (`ubQuoteRecord ≠ 0`): no `SetNewSituation` (`AIMain.cc:1989-1996`); a new situation only keeps the
  AI GREEN (`:342-350`); blocked movers swap places (`Soldier_Tile.cc:551`); the AI list skips its random filter
  (`AIList.cc:147`); "close enough" rewrites the records (§2.7).
- **Arrival** (`AIMain.cc:430-445`): at the end of the path with the absolute destination reached, not on a schedule,
  `CHECKFORDEST` → `NPCReachedDestination(s, FALSE)` and wait 500 ms; traversal ids → `HandleAITacticalTraversal`
  (`35` §2.6). Also from `Soldier_Tile.cc:578-590` (blocked on the destination) and `Overhead.cc:900-905` (handle next
  frame).
- **`NPCReachedDestination(s, already)`** (`NPC.cc:2009-2074`): `r = ubQuoteRecord − 1` (0 if none); clear
  `ubQuoteRecord`; our soldier: clear `PCUNDERAICONTROL`, **`fAIFlags &= AI_HANDLE_EVERY_FRAME`** (keeps only that flag
  instead of clearing it, quirk); on record r's destination with a positive action → queue it; then the first record
  requiring the NPC's tile that passes TRIGGER_NPC → `TriggerNPCRecord` (already there) or
  `TriggerNPCRecordImmediately`.
- **Turn towards the player**: `NPC_ACTION_FACE_CLOSEST_PLAYER` 2 sets `ubQuoteRecord = r` (not r + 1),
  `QUOTE_ACTION_ID_TURNTOWARDSPLAYER` and handle-every-frame (`Interface_Dialogue.cc:1676-1691`); `DecideActionNamedNPC`
  then faces the closest PC and calls `PCsNearNPC` once one is within 8 tiles (`DecideAction.cc:563-592`). From record 0
  the test `ubQuoteRecord && …` fails and nothing happens (quirk).
- **Unloading mid-walk** (`StrategicMap.cc:3140-3191`, = V `StrategicMap.c:4344`): unless traversing, the profile gets
  insertion at the destination and **`ubQuoteRecord = ubQuoteActionID`** (1, not r + 1). At the next load
  (`Soldier_Init_List.cc:1683-1691`) the soldier takes these values and `NPCReachedDestination` runs at once with r = 0:
  record 0's after-move action if he stands on its destination, then the tile scan. Kept. Placement
  (`SaveNPCInformationToProfileStruct`, `Tactical_Save.cc:706-730`) and traversal: `35` §2.6.

### 5.4 NPC-initiated talk

- **`DecideActionNamedNPC`** (`DecideAction.cc:553-638`), called for profiled civilians in real time after the schedule
  (green `:755-779`, yellow `:1100-1113`; ja2-node `GreenHooks.decideActionNamedNPC`, `09` §5, in
  `src/sim/tactical/ai/decide-named-npc.ts`): the TURNTOWARDSPLAYER case above; else `NPCConsiderInitiatingConv` →
  `AI_ACTION_APPROACH_MERC` to that merc's tile; the six assassins: closest PC within 8 → hostile list + WAIT 5000, else
  as far as possible towards him. Afterwards a civilian who spoke within the last 60 s does nothing (`:771-777`). A
  civilian for the decide functions: no civilian group, neutral, or a civilian body (FATCIV–CRIPPLECIV); only
  `DecideActionRed` also requires a neutral group member's group to be neutral
  (`DecideAction.cc:650, 1086, 1466, 2474`).
- **`NPCConsiderInitiatingConv(npc)`** (`NPC.cc:1960-2006`): over `ActiveMercs()` (the merc slots: every soldier in the
  sector, in slot order) on the FRIENDLY side with `bAssignment` < ON_DUTY (soldiers of other teams keep assignment 0,
  so militia qualify too), currently seen by the NPC: the opinion returned by §2.4 with NPC_INITIATING_CONV (0 skips);
  highest wins, ties go to the closer (`PythSpacesAway`). Nothing starts a talk when the walk ends (no arrival handler
  for APPROACH_MERC, `AIMain.cc:1403`): approach-7 records only bring the NPC to the merc; the talk needs a tile record,
  a turn-towards trigger or the player (inferred; whether any shipped record uses approach 7 is unverified).
- **Mike** (`Dialogue_Control.cc:433-453`): with `gfMikeShouldSayHi == TRUE` (set by `25` §6.1) and an empty queue,
  Mike starts NPC_INITIAL_QUOTE with the soldier on his closest PC's tile, `SAID_FIRSTSEEN_QUOTE`, flag value 2.
- **First sighting** (`OppList.cc:1536-1690`): besides §3.6, CARMEN seeing SLAY (attitude ATTACKSLAYONLY, record 28),
  ANGEL seeing MARIA after the rescue (12) or after leaving the deed (stop, 20), JOE and ELLIOT on first sight outside
  meanwhiles (4, `SAID_FIRSTSEEN_QUOTE`), assassins switching to SEEKENEMY, IGGY on the enemy team (9, publicly heard),
  Kingpin's goons (`25` §6.1). ja2-node: `src/sim/tactical/narrative/sight-rules.ts`.
- **`INVOKE_CONVERSATION_MODE`** 232 (`Interface_Dialogue.cc:3543-3565`): no panel → NPC_INITIAL_QUOTE with the soldier
  on the closest PC's tile.

### 5.5 Where else records are triggered (index; meanings in `35` §1, `25` §6)

| Site | What |
|---|---|
| `Overhead.cc:1655, 1699-1703, 1884, 1901, 1910` | escorted EPCs near their goals (MARY 13, JOHN 13/12, SKYRIDER 15, ANGEL 12, JOEY 10) |
| `Overhead.cc:2232, 2312, 2347, 2374, 4686, 5398, 5412` | deaths and attack implications (CARMEN 29, HANS 10, MANNY 10, MARTHA 17, PACOS 18, SLAY 1, PABLO 3) |
| `Overhead.cc:2397, 2417, 2488`; `StrategicMap.cc:1005`; `Explosion_Control.cc:1871`; `Soldier_Ani.cc:3462` | direct `HandleNPCDoAction` calls |
| `Boxing.cc:106-136` | DARREN 21–24 |
| `End_Game.cc:221`; `Meanwhile.cc:450` | `26` |
| `Soldier_Profile.cc:748` | IRA record 0 after recruiting (§9.1) |
| `Soldier_Ani.cc:1010, 1341, 2280, 3081`; `Interface_Dialogue.cc:3032-3042, 3139, 3175, 4625`; `Interactive_Tiles.cc:137`; `AIMain.cc:672, 676`; `Realtime.cc:50-59` | DONE_PUNCH_x, DONE_GIVING_ITEM, Queen DONE_SLAPPED, DONE_OPEN_STRUCTURE, DONE_GET_ITEM, DONE_TRAVERSAL (flag from `StrategicMap.cc:3161-3164`) |
| `Handle_Items.cc:2299, 2360-2369, 3246` | DONE_GIVING_ITEM, BUYSELL, I-hate-you |
| `Assignments.cc:6898`; `Soldier_Control.cc:6918` | EPC_IN_WRONG_SECTOR, first aid |
| `NPC.cc:2640-2665` (`HandleShopKeepHasBeenShutDown`) | Keith 11 / 7 instead of the shop (`23` §9.1) |
| `HandleNPCSystemEvent` (`Strategic_Event_Handler.cc:549-691`) | strategic events, `35` §1.13 |

### 5.6 UI codes: scripted sequences (`NPC.cc:1748-1801`)

`TURN_UI_OFF` (ignored in combat): `ENGAGED_IN_CONV`, `giNPCReferenceCount = 1`. `TURN_UI_ON`: unless the special count
is non-zero, clear both. `SPECIAL_TURN_UI_OFF` (not in combat): flag, count 1, special count + 1 (a negative one is
first reset to 0). `SPECIAL_TURN_UI_ON`: special − 1; at 0 clear both; below 0 → 0. `DeleteTalkingMenu` clears
`ENGAGED_IN_CONV` only with `giNPCReferenceCount == 0` (`Interface_Dialogue.cc:566-570`), so a UI-off record keeps the
game paused and the UI locked after its panel closes (`Dialogue_Control.cc:328-336` re-locks every frame) until a UI-on
record runs, typically after a scripted walk and a tile trigger. The special count is a function static (`NPC.cc:1365`),
never saved: a save/load inside such a sequence restarts it at 0 (inferred). Not ported: the Alt+6 cheat that clears the
flag.

---

## 6. The talk interface

On-screen presentation (panel layout, labels, subtitles, speech, civilian boxes) is `30` §2.8.

### 6.1 Who can be talked to (`IsValidTalkableNPC(t, give, mercs, collapsed)`, `Handle_UI.cc:4560-4643`)

The selected merc is not a robot; the target is active, alive, not collapsed if `collapsed`, not a vehicle and, if not
on our team, visible (`bVisible ≠ −1`). It qualifies as an NPC/RPC profile that is neither recruited nor an EPC; an EPC
(talk mode or giving); on our team with `mercs`; or a civilian type (§8.1) when not giving; a robot never for talking. A
qualifying target must not be in a moving animation outside combat. ja2-node: `talkableRefusal` and `talkableKind`
(`src/sim/narrative/talkable.ts`).

### 6.2 Starting (`HandleTalkInit`, `Handle_UI.cc:4646-4848`; `PlayerSoldierStartTalking`, `Soldier_Control.cc:8535-8621`)

1. A selected merc and a target valid with `(give F, mercs T, collapsed F)`.
2. Target ≠ merc: `DistanceVisible(merc, IRRELEVANT, IRRELEVANT, tile, level)` and
   `SoldierTo3DLocationLineOfSightTest(merc, tile, level, 3, dist, TRUE)`, else refused with a message.
3. Collapsed target → refused with a message.
4. Our own merc (not an EPC): DIMITRI refuses; others bark (§8.6); no AP.
5. A civilian while a civilian box is up → the click only closes the box.
6. `GetRangeFromGridNoDiff(merc, tile)` (`(INT16)hypot`, `Isometric_Utils.cc:356-368`) > `NPC_TALK_RADIUS` 4:
   `FindAdjacentGridEx` and `UIPlotPath` must succeed ("no path"); a sweet spot within 3 tiles
   (`gfNPCCircularDistLimit`) in the merc's movement mode; `EnoughPoints(AP_TALK 6)` (the walk itself is not budgeted);
   pending `MERC_TALK`; walk. On arrival (`X:Soldier.cc:142-146`) `PlayerSoldierStartTalking(…, validate)`: still valid
   with `(F, mercs F, F)` and within 8 tiles; no new LOS test.
7. Within 4: `EnoughPoints(AP_TALK)`, then `PlayerSoldierStartTalking`.

`PlayerSoldierStartTalking`: `DeductPoints(6, 0)`; both turn to face each other; the merc stops; then a civilian type →
`StartCivQuote` (§8); an escorted EPC (`MERC_TYPE__EPC`) → InitiateConversation(EPC_WHO_IS_RECRUITED); a neutral
assassin → close panel, cancel his action, hostile list; another neutral → NPC_INITIAL_QUOTE; a non-neutral →
ENEMY_NPC_QUOTE. In turn-based combat it works on our turn like any action (no moving test in combat). ja2-node: range
and walk-up in `src/sim/tactical/narrative/talk-reach.ts`, the arrival in `talk-arrival.ts`.

### 6.3 Opening (`Interface_Dialogue.cc:192-329`)

`InitiateConversationFull`: empty queue and nobody talking → open now; else store a pending conversation (object copied
by value), set `ENGAGED_IN_CONV` and the talking-menu UI mode; `HandleDialogue` opens it once the queue is empty and
silent (`Dialogue_Control.cc:275-278`, `HandlePendingInitConv` `:239-248`). Opening: close any open panel; create the
panel (no face file → abort, clearing the flag when pending); set `gpSrcSoldier`, `gpDestSoldier`,
`gubSrcSoldierProfile` (NO_PROFILE without a talker); a talker of ours on our turn → his squad becomes current and he is
selected; `ConverseFull(panel NPC, talker profile, approach, record, object)`; `ENGAGED_IN_CONV` and the talking UI
mode.

### 6.4 The menu (`:139-147, 626-900`)

Six entries (Repeat, Friendly, Direct, Threaten, Buy/Sell or Give, Recruit) plus the name ("who are you?"); disabled
while the face talks or the queue is not empty. A click: Buy/Sell on a dealer → an unused BUYSELL record is triggered,
else the panel closes and the shop opens (no further AP; `23` §9); "Give" → §4.1; the others →
`Converse(npc, talker profile, approach)`. Clicking the face or Backspace cuts the current line short (ja2-node: the
`skipLine` input, §7.6).

### 6.5 Closing

- **Done / Esc** (`HandleTalkingMenuEscape`, `:956-1010`): while talking, Done only stops the line; with an empty queue
  → `DeleteTalkingMenu` and the once-per-conversation reset for the panel NPC.
- **`DeleteTalkingMenu`** (`:512-619`): stop speech, remove the UI, close the panel, clear the NPC's
  `SOLDIER_ENGAGEDINACTION`, clear `ENGAGED_IN_CONV` if `giNPCReferenceCount == 0`. Then, with
  `FACT_NEED_TO_SAY_SOMETHING`, an empty queue and no trigger wait: for the nice NPC (preferred) or the nasty one, if
  his soldier exists, a merc within 10 tiles with LOS, picked by `Random(n)`, says 58 (`QUOTE_LISTEN_LIKABLE_PERSON`,
  filtered by gender) or 39 (`QUOTE_ANNOYING_PC`) (`Dialogue_Control.cc:1386-1471`); both profiles and the fact are
  reset even if no merc qualified, but only when the NPC's soldier exists. ja2-node resets them but queues no merc line
  (gap "Say-later merc lines").
- **Other closers** (none resets once-per-conversation records): queued `NPCClosePanel`, scripted walks, the
  recruit/requestor/close/enter-combat/friendly/shop/lie/marry actions, `ChangeSoldierTeam` (`Soldier_Profile.cc:593`),
  triggers with dialogue (§5.2), our first sighting in a virgin sector (`OppList.cc:2408-2413`), other menus opening
  (`Interface_Control.cc:578-584`), a boxing match (`Boxing.cc:79`), Esc in a meanwhile (`26`).

### 6.6 While engaged in conversation

- `HandleDialogue` notices the flag: on → `PauseGame` + `LockPauseState(14)`; off → unlock, unpause, end the UI lock
  (not during boxing round ends) and lock again if it is not our turn (`Dialogue_Control.cc:282-326`). World clock and
  real-time turns stop (`15` §1.5); tactical frames continue (animations, ordered movement, bullets, the queue).
- No real-time AI decisions (`Realtime.cc:204`, `AIMain.cc:1158`); neutrals get no new situation (`AIMain.cc:1993`); no
  RPC sector description (`Tactical_Turns.cc:28`); no faint-noise quote (`OppList.cc:4253-4261`); leaving combat skips
  the strategic implications (`Overhead.cc:4095-4099`); in turn-based combat SERGEANT, MIKE and JOE skip their AI while
  a panel is open, a trigger waits or the queue is not empty (`AIMain.cc:279-284`).

### 6.7 NPC request boxes (`StartDialogueMessageBox`, `:4163-4234`; `DialogueMessageBoxCallBack`, `:4237-4504`)

The requestor actions close the panel and open a modal box; each answer triggers a record (the hire box: yes → record 1,
no → record 0). The group 110, 120, 135, 144, 161, 162, 169, 181, 183, 207, 212 (`:2143-2171`) refuses with an error
log, opening nothing, unless the acting NPC is `gpDestSoldier`'s profile; 221 (lie) and 226 (marry Daryl) open without
that check. The callback always uses `gpDestSoldier`'s profile. The boxes, their answers and the lie ranking are
`35` §1.3. ja2-node opens an `npcRequest` prompt instead (deviation "NPC requestors";
`src/sim/tactical/narrative/npc-actions/requestors.ts`).

---

## 7. The dialogue queue (`Dialogue_Control.cc`)

### 7.1 Structure and cadence

A FIFO of events (`:110`); `DialogueEvent::Add` appends (`:469-480`). `HandleDialogue` (`:266-466`) runs once per frame
at the end of the game screen loop, after `ExecuteOverhead` (`GameScreen.cc:427, 518-521`):
1. a paused queue → return;
2. empty and nobody talking → `HandlePendingInitConv`;
3. `HandleCivQuote` (box timeout, §8.4);
4. `ENGAGED_IN_CONV` transitions and the UI lock (§6.6);
5. a face still talking → return; a face that has finished → its flags: `FACE_PCTRIGGER_NPC` → count − 1 and
   `TriggerNPCRecord`; `FACE_MODAL` → end modal tactical; `FACE_TRIGGER_PREBATTLE_INT` → `InitPreBattleInterface`
   (`19`); clear the current face and `ubLastQuoteProfileNUm` (`:423`); undo a map-screen pause;
6. empty → the Mike check (§5.4); return;
7. the head: in auto-bandage mode it is dropped unexecuted; else `Execute()`; `false` → pop, `true` → keep for the next
   frame.

One event starts per frame; a quote holds the queue for its duration through the talking face.

**ja2-node** (`handleDialogue`, `src/sim/narrative/dialogue-queue.ts`) runs steps 2, 4 (`pauseForConversation`:
`pauseGame` + `lockPauseState(14)` and back), 5 (only `FACE_PCTRIGGER_NPC`), 6 and 7 once per 5 ms tick: after the
tactical step (`TalkFlow.afterTacticalStep`), and on the map screen after each strategic tick and each dispatched
command (`afterStrategicStep`). The trigger wait (§5.2) is checked before the tactical step. "A face is talking" =
`tick < face.busyUntil` (§7.6). No paused queue, civilian box (presentation, §8.4) or map-screen pause; events are never
dropped during auto-bandage.

### 7.2 Quote events (`CharacterDialogue`, `:612-682`; `ExecuteCharacterDialogue`, `:719-826`)

Execution: `delayed` and not our team's turn → keep; the speaker on our team with a battle sound playing → keep; on the
map screen and not paused → pause + lock 15; a sleeping speaker is woken and a "back to sleep" event is queued
(`:489-514`); `ubLastQuoteSaid/ProfileNUm` recorded; then the speaker must exist if the quote is from a soldier; a
speaker on our team must be ≥ CONSCIOUSNESS, not gassed, not a robot, ≥ OKLIFE unless the quote is `SERIOUSLY_WOUNDED`,
not a POW; asleep with NEED_SLEEP or OUT_OF_BREATH → silently done; no text (§1.5) → done; else the face talks for the
duration and, for our team, the stop-time quotes (booby trap, suspicious ground) fire.

Before queueing a merc line (`TacticalCharacterDialogue`, `:543-595`; `CanSayQuote`, `:517-531`): profile, life
(CONSCIOUSNESS for SERIOUSLY_WOUNDED, else OKLIFE), not a robot (a robot's line goes to its controller), not gassed, not
a POW, not in a meanwhile, not the exact profile + quote just said, an EPC only with `FORCENPCQUOTE`; the bleeding "me
too" swap.

NPC lines in a conversation go through `TalkingMenuDialogue(q)` (`Interface_Dialogue.cc:937-945`):
`CharacterDialogue(**panel NPC**, q, panel face, NPC_UI, fromSoldier FALSE)`. The speaker is the panel's NPC, not the
record's: in the "other NPC" branch of §5.2 (reachable for a quote-0 record, since quote 0 does not close the other
panel) another NPC's quote numbers are spoken by the panel NPC (quirk, inferred to be rare).

**ja2-node** (`executeCharacterDialogue`, `canSayQuote`, `tacticalCharacterDialogue`) models the delayed-quote wait, the
recorded last quote, the speaker test (our team in the sector or off it, life 10 / `OKLIFE` / quote 10, not a robot),
the meanwhile, repeat and EPC tests and the silent missing row; not the battle-sound wait (deviation "Speech"), the
map-screen pause, waking and the back-to-sleep event, gas, POW, sleep, the robot's controller, the bleeding swap or the
stop-time quotes. Each said line emits `npcQuote` (`npcUi`) or `mercQuote` with its `textKey`, `chars` and the record
and is appended to `TalkState.lines` (the conversation's `lastQuotes`). Merc lines of the tactical narrative port
(`TacticalPort.sayQuote`: close calls, beatings, sightings) go through the queue; contract and morale lines are plain
`mercQuote` events outside it (§12.6).

### 7.3 Event kinds

| Event (ja2-node `DialogueEvent.kind`) | Queued by | Effect when executed |
|---|---|---|
| quote (`quote`) | `CharacterDialogue`, `TalkingMenuDialogue` | §7.2 |
| close panel (`closePanel`) | `NPCClosePanel` (`NPC.cc:1311-1314`) | `DeleteTalkingMenu` |
| give item (`giveItem`) | `TalkingMenuGiveItem` (`:1317-1341`) | §4.5 |
| trigger NPC (`triggerNpc`) | `NPCTriggerNPC` (`:2078-2104`) | §5.2 |
| goto (`goto`) | `NPCGotoGridNo` | §5.3 |
| do action (`doAction`) | `NPCDoAction` (`Interface_Dialogue.cc:1185-1209`) | `HandleNPCDoAction` (§7.5) |
| PC line then trigger (`pcTriggerNpc`) | `TriggerClosestMercWhoCanSeeNPC` | §5.1 |
| sleep (not modelled) | quote of a sleeping merc | `fMercAsleep` restored |
| alternate-file quote (`quote` with `alternate`) | `CharacterDialogueUsingAlternateFile` (`:685-711`) | RPC sector description (§8.6) |
| remove EPC (`removeEpc`) | `InternalUnescortEPC` (`Assignments.cc:6851-6868`) | clear `FORCENPCQUOTE`, `UnRecruitEPC` (§9.4) |
| end game (`callback`) | `End_Game.cc:195, 322` (`26`) | the named step of the ending |
| others (owner) | contracts (`Merc_Contract.cc:173, 550`; `22`), stat change text (`Campaign.cc:587`), arrival flag (`Merc_Hiring.cc:300`; `21`), shop (`ShopKeeper_Interface.cc:3099-4109`; `23`), item locator (`Overhead.cc:6165`), battle sound (`Soldier_Control.cc:6070`), unpause AI (`Merc_Entering.cc:801`) | outside the queue in ja2-node |

### 7.4 What is presentation and what is state

| Item | Kind |
|---|---|
| text, faces, subtitles, speech files, locator, camera, map-screen messages | presentation (events with text keys, §12.4) |
| line duration (the longer of the voice and the text, then 60 ticks, §7.6) | state: it holds the queue and delays everything behind it |
| `ubLastQuoteSaid/ProfileNUm` in `gTacticalStatus` | state (skips immediate repeats) |
| waking a merc to talk and putting him back to sleep | state |
| stop-time quotes | state (stop compression, `15`) |
| facts, quests, `SAID` flags, money handling, the object taken from the merc | state, at selection, before any line is heard |
| actions, gives, walks, triggers, panel closes | state, when the queue reaches them |
| panel open, pending conversation, trigger wait, `ENGAGED_IN_CONV`, reference counts | state |

### 7.5 Dispatch of NPC actions

`HandleNPCDoAction(npc, code, record)` (`Interface_Dialogue.cc:1571-4062`) runs when its queue event executes: after
every event queued before it, including the quotes of the same record unless the action faces a profile (§3.4 step 1).
Direct calls bypass the queue (§5.5). Codes 501–649 face profile `code − 500` if both soldiers exist (`:1576-1590`);
everything else reads `GCM->getNpcActionParams(code)` (gridNos and amounts from `J:tactical-npc-action-params.json`,
`X:DefaultContentManager.cc:241-248, 1248-1252`; ja2-node `src/content/strategic/npc-action-params.ts`) and switches; an
unknown code only logs.

Ids and names: `Interface_Dialogue.h:85-342` (ja2-node: `data/tables/narrative.json` `npcActions`, checked against
`src/sim/tactical/narrative/npc-actions/codes.ts`); the per-action catalog is `35` §1. Ranges: 1–44 behaviours of the
speaker, 50–54 experience, 100–298 story actions, 500 face the nearest merc, 501–649 face a profile.

Actions defined here because they are dialogue mechanics: 1 (§4.4), 4/23 (§9.1), 21/22/25/166/167 (§3.6), 24 (close),
39/44 (§6.5), 41 (`23` §9.1: `HandleShopKeepHasBeenShutDown` first, then close and shop), 110/120/181/212 and the
requestors (§6.7), 149/168 (§9.4), 150 (§3.4), 232 (§5.4), 500+ (above).

### 7.6 Conversations in game time

The original stops the world clock during a conversation (§6.6) but keeps the tactical frame running, so the queue says
the next line when the face stops talking: at the end of its voice (speech on) or text (speech off), or at once on a
click on the face (after 500 ms) or Backspace (`StopAnyCurrentlyTalkingSpeech` → `InternalShutupaYoFace`). ja2-node
keeps these rules, with lines taking ticks like any other time:

- **Commands return at once.** `talk`, `approach`, `answer` on an NPC request, `unescort` in tactical, `give` and
  `openShop` run their step; the queue runs in the following ticks (tactical, clock paused by lock 14, AI decisions
  frozen): the real-time driver's while a player watches, `advance` for an agent. An NPC who walks off after his last
  line starts when that line ends on screen.
- **Line length.** `executeCharacterDialogue` sets `face.busyUntil = tick + max(voicedLineTicks(ms), lineTicks(chars))`
  with `lineTicks(chars) = 12 × chars + 1 + 60` (+1 because the original tests `elapsed > duration`) and
  `voicedLineTicks(ms) = ceil(ms / 5) + 60`; a line without a known voice uses `lineTicks` alone. Voice lengths come
  from the rule pack's `@rules/speech/lengths.json` (`SpeechLengths`, `src/content/audio/speech-lengths.ts`, read from
  the WAV headers when the pack is built; the sample path by `speechPathForLine`, §1.5) and stay out of the pack's hash,
  so saves and logs keep matching. Speech is a viewer's option and one simulation serves every viewer, so the queue
  waits for the longer presentation (deviation "Speech").
- **Cutting a line**: the `skipLine` input (logged and replayed). Plain = the click or Backspace: `shutUpTalkingFace`
  sets `busyUntil = tick` and runs `faceFinished` in the command (a PC-trigger face fires its record there); the next
  event executes on the next tick. `talkEnded` = a viewer finished saying the line (voice or text): `finishTalkingFace`
  sets `busyUntil = tick + 60`, keeping the final 300 ms. With `profile` and `tick` (the quote's `saidAt`) only that
  line is cut. Every cut emits `lineCut {profile, saidAt, tail}` so every viewer ends the line. `closeTalk` cuts the
  panel NPC's line before `HandleTalkingMenuEscape`, as Done/Esc does.
- **`speech: skip`** (a session setting for agents): every line ends on the tick after it is said (`busyUntil = tick`;
  the quote event carries `skipped: true`).
- **Idle session.** A panel whose queue is idle (`dialogueIdle`: no face, empty queue, no trigger wait, no pending
  conversation; outside a meanwhile scene) stops the campaign: `CampaignSim.step` runs no tick while
  `TalkFlow.hasPendingDecision()` (also while an `npcRequest` waits). The original keeps running tactical frames while
  the menu waits (deviation "Talk session time").
- **Scripted sequence.** `ENGAGED_IN_CONV` without a panel, a pending conversation or a trigger wait
  (`TalkFlow.scriptedSequence()`, event `scriptedSequence {active}`): ticks run, player commands are refused (`29`).
- **Map screen.** `unescort` on the map screen runs the queue to the end inside the command (each face cut, then the
  next event), since the clock does not move there without compression.

---

## 8. Civilian quotes and other barks

### 8.1 Who barks (`GetCivType`, `Civ_Quotes.cc:221-281`)

Profiled soldiers: NA. In F10 a female civilian of group 0 not on our team: `MARRIED_PC` (3). Enemy team with a merc
body: `ENEMY` (4). Teams other than CIV and MILITIA: NA; then by body: REGMALE, BIGMALE, STOCKYMALE, REGFEMALE, FATCIV,
MANCIV, MINICIV, DRESSCIV, CRIPPLECIV → ADULT; HATKIDCIV, KIDCIV → KID; else NA. Talking to one costs `AP_TALK` and
turns both (§6.2) but opens no panel and sets no engaged flag: `StartCivQuote` (§8.4).

### 8.2 Which quote (`DetermineCivQuoteEntry`, `:388-676`), first match

1. ENEMY: action TOSS_PROJECTILE, FIRE_GUN or KNIFE_MOVE → 28 `ENEMY_THREAT`; OFFER_SURRENDER → 37; life < 30 → 26
   `HURT`; elite → 29; else 27 `ADMIN`.
2. MARRIED_PC → 32.
3. HICKS group → 16 if neutral, else 17; KINGPIN group → 18 / 19.
4. Cowering, or any CIV-team civilian during combat → 30 adult / 31 otherwise.
5. FACTORY_KIDS group → 34 if `FACT_DOREEN_HAD_CHANGE_OF_HEART` or not `FACT_DOREEN_ALIVE`, else 33.
6. BEGGARS group → 25 for an adult in San Mona (surface), else 0 / 1.
7. REBEL group → 20 / 21.
8. MILITIA team → 22, 23, 24 by class (other classes fall through).
9. Meduna with `FACT_QUEEN_DEAD` → 39.
10. Surface town using loyalty: rating < 20 → low; ≥ 80 → high.
11. Hint = `ConsiderCivilianQuotes(sector, FALSE)` if hints are allowed (§8.4), else none.
12. Miner class with no hint → 36 if the player controls this sector's mine, else 35.
13. A hint, low loyalty and not a miner → `Random(100) < 25` drops the hint.
14. A hint and an adult → type 99 (hint) with the hint's quote as entry, and `ConsiderCivilianQuotes(sector, TRUE)`
    marks it.
15. Low → 6 / 7; high → 8 / 9; else 10 / 11 (adult / kid).

Types 2–5, 12–15 and 38 (bug attacks, liberation, town retaken, hicks at night) are never chosen. Entries per type
(`gubNumEntries`, `:45-101`): 15, except 20–21 → 5, 32 → 2, 35–36 → 10, 37 → 5, 38 → 3, 39 → 10, 40–49 → 3.

### 8.3 Hints (`ConsiderCivilianQuotes`, `NPC.cc:2719-2746`)

The sector's hint array (§1.4; none → −1); the first record passing
`NPCConsiderQuote(NO_PROFILE, NO_PROFILE, APPROACH_NONE, i, 0)`: only approach 0 and opinion 0 or 255; facts checked
with profile 200; `MUST_BE_NEW_DAY` degrades to "day ≥ 254" without a profile. With `set_as_used` the record gets
`SAID`; **both** calls start `ubStartQuest`, so a hint's quest starts as soon as any civilian of the sector is asked,
even if the hint is then dropped or the civilian is a kid, and again on every ask while it stays unsaid (`StartQuest`
puts a finished quest back in progress, `Quests.cc:1105-1120`). Hint text: row = the record's quote in
`npcdata/<sector>.edt` (underground: `civ35.edt`), 160 units per row (`Civ_Quotes.cc:122-147`).

### 8.4 Entry and box (`StartCivQuote`, `:692-758`; `BeginCivQuote`, `:315-385`)

A civilian whose `bCurrentCivQuote` is 99 (he gave a hint last time) resets it to −1 and decides without hints;
otherwise hints are allowed. For a non-hint type: `bCurrentCivQuote == −1` → `Random(entries − 2)`, delta 0; entry =
base + delta; after showing, delta alternates 0, 1. The base is kept when the type later changes (inferred: an entry
past a shorter type's rows has no text and shows nothing). A hint stores 99 and the entry. A line without text opens no
box (`BeginCivQuote` returns after the text lookup): nothing is shown and a surrender offer never gets its question; the
entry still advances. The box (duration §1.5) replaces any open one and closes early on a click after 300 ms
(`:181-206, 679-690`); hint text also goes to the map-screen log. Save section 38 is 100 bytes, skipped both ways
(`:770-779`). ja2-node emits a `civQuote` event instead of a box (deviation "Civilian quote boxes").

### 8.5 Enemy surrender offer

`DecideActionBlack` (`DecideAction.cc:2641-2654`): an enemy-team soldier, visible, `ENEMY_OFFERED_SURRENDER` not yet
set, life ≥ lifeMax / 2, no militia team active, fewer than 4 PCs in the sector, enemies ≥ 3 × PCs, and HELD_IN_ALMA not
started (or done with INTERROGATION not started) → set the flag, `AI_ACTION_OFFER_SURRENDER`, executed as
`StartCivQuote(soldier)` (`AIMain.cc:1818-1821`) → type 37. When the box closes, a yes/no box: yes → capture sequence
(every in-sector living merc captured and removed, `gfSurrendered`, a 3 s capture timer); either way `ActionDone`
(`Civ_Quotes.cc:150-206`). Capture and the Alma quest: `25` §6.8. ja2-node: `OFFER_SURRENDER` calls
`TacticalPort.offerSurrender` (`StartCivQuote`, then the `surrender` prompt with `context: 'tactical'` at once); without
a line the action just ends (deviations "Civilian quote boxes", "Surrender in tactical combat").

### 8.6 Other barks

- **RPC sector descriptions** (`StrategicMap.cc:346-422`, `Tactical_Turns.cc:20-77`): entering a listed sector the first
  time sets `SF_HAVE_USED_GUIDE_QUOTE` and a countdown of `4 + Random(5)` real-time turns, checked at sector entry and
  each real-time turn (`Tactical_Turns.cc:157`), only on the tactical screen and not while engaged in conversation; SAM
  sites set it to 1 and speak at the next check even in combat, other sectors wait out combat and enemies; at 0 a
  recruited IRA, MIGUEL, CARLOS or DIMITRI in that sector, picked by `Random(n)`, says the description from his
  alternate file. No other state. ja2-node: `src/sim/campaign/narrative/guide-description.ts`, the countdown in
  `NarrativeState.guide`.
- **Talking to our own merc** (`Handle_UI.cc:4703-4766`): `Random(3)` (non-normal attitude) or `Random(2)`, forced 0 for
  I.M.P. characters → 41 `NEGATIVE_COMPANY`, 45 `PASSING_DISLIKE` (if he has one), 44 `SOCIAL_TRAIT`; IRA always
  45. Cosmetic.
- **Say-later** lines at panel close (§6.5); the PC line before Miguel's record (§5.1).

---

## 9. Recruiting RPCs and EPCs

### 9.1 RPCs

Script-driven: a record (typically requiring RECRUIT and an opinion) with action
`ASK_ABOUT_PAYING_RPC(_WITH_DAILY _SALARY)` opens the hire box (§6.7); the answer triggers record 1 or 0, carrying
`RECRUIT_WITH_SALARY` or a refusal (the data's design, inferred). `NPC_ACTION_RECRUIT` 4 sets `sSalary = 0` and falls
into `RECRUIT_WITH_SALARY` 23 (`Interface_Dialogue.cc:1834-1854`): close the panel; `PlayerTeamFull()` (more than
`bLastID − 2` = 17 mercs on our team, `Overhead.cc:4816-4825`) → message only; else `RecruitRPC` and a message.

`RecruitRPC(p)` (`Soldier_Profile.cc:685-768`), in order: the NPC's soldier must exist; `RECRUITED`;
`ChangeSoldierTeam(s, OUR_TEAM)` (§9.2); SLAY: `iEndofContractTime = now + 7 days`, out of the wheelchair; DYNAMO with
FREE_DYNAMO in progress → `EndQuest` in his sector; `HandleTownLoyaltyForNPCRecruitment` (`18`;
`handleTownLoyaltyForNpcRecruitment`); the current squad, else any squad; dead-squad list reset; an empty hand gets the
first weapon from the inventory (a two-handed one first moves the second-hand item away); IRA →
`TriggerNPCRecord(IRA, 0)`, which now reads his `000.npc` copy; kind `MERC_TYPE__NPC`; history `HISTORY_RPC_JOINED_TEAM`
(23) in his sector; off the personnel departed list (`21`); the Lua hook `OnRPCRecruited` (not ported). No contract and
no payment: the daily `sSalary` is charged at 00:00 (`22` §4.8). His records switch to `000.npc` at the next touch
(§1.4).

### 9.2 `ChangeSoldierTeam(old, team)` (`Soldier_Profile.cc:591-682`)

Closes the panel; leaves the SM panel if it shows him; removes the old soldier; creates a new one on `team` with
profile, body, sector and direction (vehicles keep their vehicle id) through `TacticalCreateSoldier`, with its creation
draws (deviation "Soldier creation draws", `06`); copies life, max life, the ten stats, visibility values, camouflage
(palettes rebuilt), level and height, all 19 inventory slots; our team → visible; attackers retarget; insertion tile =
the old tile; death bookkeeping if this happens during a death; with the world loaded and the old soldier in the sector,
the new one is placed with the old animation and looks (`HandleSight(LOOK | RADIO)`); `RECRUITED` set for `OUR_TEAM`,
cleared otherwise. The new soldier's id is in the new team's block, so every reference by soldier id (talk session,
prompts) must follow the profile.

### 9.3 EPCs

`ASK_ABOUT_ESCORTING_EPC` 110 → box (§6.7) → yes (`Interface_Dialogue.cc:4246-4288`): close the panel; team full →
message; JOHN while MARY's soldier exists and our team has more than `bLastID − 3` = 16 mercs → message (two places
needed); `RecruitEPC(p)` (`Soldier_Profile.cc:770-813`: soldier must exist; `EPCACTIVE`; clear
`PERMANENT_INSERTION_CODE`; `ChangeSoldierTeam(OUR_TEAM)`; kind `MERC_TYPE__EPC`; current or any squad; dead-squad list;
a robot updates its controller); message with his squad; his squad becomes current; `HandleStuffForNPCEscorted`
(`Interface_Dialogue.cc:1493-1544`): SKYRIDER → `FACT_SKYRIDER_EVER_ESCORTED` and ESCORT_SKYRIDER started if not
started; JOHN or MARY → the other is recruited too and ESCORT_TOURISTS starts (`NOW_BING_ESCORTED_STR` is printed for
the partner). `RecruitEPC` of a soldier already on our team (John's partner when both were escorted) rebuilds him like
any team change. Escorted EPCs: no contract menu (`22` §1.1), the sector-exit rules
(`src/sim/campaign/sector-exits.ts`), lone EPCs die in autoresolve (`19`), silent in tactical unless forced (§7.2),
talked to with EPC_WHO_IS_RECRUITED; other campaign rules: `25` §4.2.

### 9.4 Releasing an EPC

- **By script**: `UN_RECRUIT_EPC` 149 / `SET_EPC_TO_NPC` 168 (`Interface_Dialogue.cc:2586-2623`): ANGEL is redirected to
  MARIA; `UnRecruitEPC`; MARY and JOHN release each other; SKYRIDER from record 15 → `fUseProfileInsertionInfo = FALSE`
  (map placement at the airport); JOEY from record 9 → insertion tile 18326; JOHN/MARY from record 13 → both profiles
  lose their sector (they vanish once the sector unloads).
- **`UnRecruitEPC(p)`** (`Soldier_Profile.cc:816-840`): the soldier must be an EPC; on a squad → dead-squad list; clear
  `EPCACTIVE`; profile sector = his sector; `PERMANENT_INSERTION_CODE`; insertion GRIDNO at his tile; use profile
  insertion; `ChangeSoldierTeam(CIV_TEAM)` (clears `RECRUITED`). The tile is the soldier's current one, also for an
  escort outside the loaded sector (his last tile there: `sGridNo` survives leaving the sector).
- **By the player** (assignment menu "un-escort", `Assignments.cc:6872-6900`): on the map screen `InternalUnescortEPC`
  for him and his JOHN/MARY partner (`:6837-6869`): profile insertion data from the soldier; if a record passes
  EPC_IN_WRONG_SECTOR (`GetInfoForAbandoningEPC`, `NPC.cc:2351-2366`) → `FORCENPCQUOTE`, he says that record's quote,
  its fact is set (nothing else of the record runs; not marked said); queue the remove-EPC event. In tactical:
  `TriggerNPCWithGivenApproach(EPC_IN_WRONG_SECTOR)`; the record decides. ja2-node runs the map-screen queue to the end
  inside the `unescort` command (§7.6).

### 9.5 RPCs leaving

Dismissal and quitting: `22` §4; `StrategicRemoveMerc` writes his profile insertion data first (`35` §2.6, `22` §4.5).
Only `ChangeSoldierTeam` to another team clears `RECRUITED`, so a departed RPC keeps it (inferred): profile insertion
skips recruited profiles (`Soldier_Init_List.cc:1659`) and his backup records are never restored (§1.4); he does not
come back.

### 9.6 Team changes in ja2-node

- `changeSoldierTeam` (`src/sim/tactical/narrative/team-change.ts`) creates the new soldier through the tactical
  creation code: for a profiled soldier the female or kid battle sound `Random(2)` is drawn, but not the standing frame
  of `CreateSoldierCommon` (`Random(10)`), the face draws of `InitSoldierFace` for our team (deviation "Cosmetic face
  and frame draws") or the pathfinder draws of the placement's sweet-spot search (deviation "Pathfinder RNG"). Not
  copied, so fresh: breath (99), bleeding (0), morale, orders, attitude, the key ring, quote record and action.
- The new soldier takes the old tile, animation and direction only when the old one stood in the loaded sector;
  otherwise it is created (with its draws) and left off the map, where the original keeps it as an inactive-in-sector
  civilian of the loaded world (inferred harmless; ja2-node does not keep it).
- The id is the new team's first free slot: for our team every roster merc counts, wherever he is; for civilians the
  soldiers of the loaded sector. The schedules' away (off-map) civilians would count too through
  `RecruitFlow.reservedSoldierSlot`, which nothing sets (§12.5).

---

## 10. Determinism

### 10.1 Draws, in order of appearance

| Where | Draw | Stream |
|---|---|---|
| §3.3 friendly default | `Random(2)`: quote 2 or 3, remembered in `ubLastQuoteSaid` | main (the result is stored, §12.6) |
| §3.6 hostile list | `Random(n)` among speakers with a declaration | main (decides whose record runs) |
| §3.6 civilian-group side change | `Random(2)` per further member with a profile (short-circuit after the first) | main, drawn although unused |
| §3.6 draws first | two `Random` in `NPCFirstDraw` | not ported (§12.5) |
| §5.1 closest merc who sees the NPC | `Random(n)` | cosmetic stream (`TalkState.fx`; deviation "Cosmetic draws in dialogue") |
| §6.5 say-later speaker | `Random(n)` | not drawn (no line is said) |
| §6.7 lie | `SkillCheck`: `PreRandom(100)`, then the silent-curse `Random(100)` on failure (`33` §3.5) | pre; curse not drawn (deviation "Cosmetic draws in attacks") |
| §8.2 hint drop | `Random(100) < 25`, only when a hint exists, loyalty is low and he is no miner | main (decides whether the hint is used up) |
| §8.4 civilian entry | `Random(entries − 2)` | cosmetic stream (stored in the soldier, text only) |
| §8.6 RPC description countdown | `4 + Random(5)` | main |
| §8.6 own-merc bark, RPC description speaker | `Random(3)`/`Random(2)`, `Random(n)` | cosmetic stream |
| §9.2 team change | creation draws | main, in creation order (§9.6) |
| selection, desire, money, triggers, queue | none | |

### 10.2 Wall clock and frames

| Original | ja2-node |
|---|---|
| one queue event per frame | one per 5 ms tick, after the tactical step (§7.1; deviation "Dialogue queue cadence") |
| a line lasts its sample (speech on) or 60 ms per character, then 300 ms with the mouth closed | the longer of the voice length and 12 ticks per character + 1, then 60 ticks (§7.6; deviation "Speech") |
| a click or Backspace stops the face (`ShutupaYoFace`, `StopAnyCurrentlyTalkingSpeech`), the queue moves on | `skipLine` (§7.6) |
| a quote waits while the speaker's battle sound plays | never waits |
| trigger wait 500 ms (`GetJA2Clock`) | 500 ms of the tactical clock (100 ticks) |
| `uiTimeSinceLastSpoke` + 60 000 ms | tactical clock milliseconds (`NAMED_NPC_IDLE_AFTER_TALK_MS`, 12 000 ticks) |
| AI pause 1500 ms (`Overhead.cc:118, 450-469, 496-503`) | `PAUSE_ALL_AI_DELAY_MS` on the tactical clock (300 ticks) |
| civilian box 300 ms / text delay | presentation; the surrender prompt opens at once |
| frames run while the menu waits for a click | nothing runs while a session is idle (§7.6) |

Ordering: record scans by index; the hostile list in insertion order; mercs in soldier id order (`FOR_EACH_IN_TEAM`,
`ActiveMercs`); the queue FIFO.

---

## 11. Data tables, original data and stubs

### 11.1 Constants and script overrides

No transcribed table: ids and constants are named constants with `@src` headers, mainly in
`src/content/narrative/npc-constants.ts` (approaches, quests, standard quotes, quote action ids, the dialogue's action
codes, `NPC_TALK_RADIUS` 4, `INITIATING_FACTOR` 30, `LARGE_AMOUNT_MONEY` 1000, the civilian hint sectors with
`MINERS_CIV_QUOTE_INDEX` 16, the shared EDT 151–154, civilian quote types and entries),
`src/sim/narrative/narrative-ids.ts` (facts, profiles and profile flags the dialogue names),
`src/content/formats/npc.ts` and `edt.ts` (record and row layouts) and `src/sim/tactical/narrative/constants.ts`
(assassins, terrorists, rebel sympathizers); timing constants in `dialogue-queue.ts`, `converse.ts` and
`src/sim/tactical/ai/pause.ts`, other rule constants in the module that applies them.

**Stracciatella's script overrides**: `data/tables/npc-script-records.json` (§1.4);
`data/externalized/script-records-control.json` is copied unchanged.

### 11.2 Original data at runtime (never committed)

`npcdata/NNN.npc` (all NPC/RPC arrays, `000.npc`, the meanwhile files 160–176 and 180–196, the civilian hint files and
`miners.npc`), `npcdata/NNN.edt`, `npcdata/d_NNN.edt`, `npcdata/civNN.edt`, `npcdata/<sector>.edt`, `mercedt/VVV.edt`,
`binarydata/prof.dat` (the fields of §1.2), the speech samples under `npc_speech/` and `speech/` (their lengths only,
§7.6). Decoders: `src/content/formats/npc.ts` (32-byte records; the Russian layout by resource version; facts > 368 →
65535) and `src/content/formats/edt.ts`.

### 11.3 Save sections

| Section (`14` §4) | Layout | Import |
|---|---|---|
| 5 profiles | §1.2 offsets; voice ids from v104 | `savegame-profile.ts` |
| 6 soldiers | `ubQuoteRecord`, `ubQuoteActionID`, `uiTimeSinceLastSpoke` (wall clock: becomes 0), `bCurrentCivQuote(Delta)`, `bNeutral`, `ubCivilianGroup` | `savegame-soldier.ts` |
| 19 NPC quote info | 170 (v < 105) or 200 × (`u8 present`, 50 × 32), then 20 civilian arrays the same (`NPC.cc:2388-2426`) | `savegame-npc.ts`, `importNpcRecords` (`src/sim/narrative/save-import.ts`): records state, then the `RefreshNPCScriptRecord` rules for v < 98 and the load-time once-per-conversation reset |
| 21 temp NPC quote file | `u32 size` + blob (Strac writes 0) | skipped |
| 24 general info | hospital balance, refund, modifier (`SaveLoadGame.cc:2098-2101`) | `25` §6.3 |
| 38 civilian quotes | 100 bytes | skipped |
| 39 backup NPC info | profiles × (`u8 present`, 50 × 32) (`NPC.cc:2498-2514`) | backups |
| tactical status | `ENGAGED_IN_CONV`, `fCivGroupHostile`, `ubEngagedInConvFromActionMercID` | (inferred: native saves cannot be made in a conversation, so the flag is clear) |

### 11.4 Stubs (CI)

- **Records and lines**: `stubs/npc/records.json` (invented records in the field names of Stracciatella's script JSON:
  `scripts` per profile, `recruited` = `000.npc`, `meanwhiles`; required items by name, resolved through the item table)
  and `stubs/npc/text.json` (`files` per EDT, `civilianFiles` with 160-unit rows), compiled by `pnpm stubs`
  (`stubs/npc.ts`) into real `npcdata/*.npc` and ROT-1 `.edt` files read by the same loaders as the original.
- **Profiles**: a stub NPC must be NPC-type in `J:mercs-profile-info.json` and **not** one of the ten override profiles
  (the `data/` layer sits above the stubs, so those would get Stracciatella's records). In A10
  (`stubs/maps/a10.map.txt`): profile 94 (DAMON's slot: NPC type, no override, no code rules), the invented "Teodor
  Vasko", with an initial and a special initial quote (gated by fact 132), an opinion-gated once-per-conversation
  friendly record, a direct record that sets fact 132 and starts quest 14, a quest-gated record that triggers a
  `TURN_UI_OFF` walk ending on a tile record with `TURN_UI_ON` that ends quest 14, a threaten record that closes the
  panel, and GIVINGITEM records that take a 9 mm magazine and money and refuse a pistol (`DONT_ACCEPT_ITEM`); the R.P.C.
  65 and the escort 123. The stub `000.npc` holds one silent TRIGGER_NPC record 0, so the `TriggerNPCRecord(IRA, 0)` of
  `RecruitRPC` says nothing for the stub profile 59 (IRA's slot). The other scripted stub profiles and the meanwhile
  files `171.npc`/`191.npc` serve `25` §8.4 and `26`. The stub animation scripts carry `GIVE_ITEM` with code 486.

---

## 12. Implementation in ja2-node

### 12.1 Content (`src/content/`)

- `formats/npc.ts` (records, both layouts, the fact clamp), `formats/edt.ts` (§1.5 decoding, `utf32Length`; both also
  write for the stub build), `formats/prof.ts` (§1.2), `formats/savegame-npc.ts` (sections 19 and 39).
- `narrative/npc-records.ts`: `loadNpcRecordContent` in the §1.4 order (layers: `LayerCount`), the civilian files and
  the meanwhile table; `readLayered` falls back to the stub pack's `stubs/` copy.
- `narrative/dialogue-text.ts`: `TextKey {file, row, width}`, the file choice of §1.5 and §8.3, `DialogueTexts` (the
  decoded lengths, memoized; a missing row has length 0).
- `narrative/speech-path.ts`, `audio/speech.ts`, `audio/speech-lengths.ts`: sample paths and voice lengths (§7.6).
- `src/server/narrative-content.ts` assembles a session's narrative setup (records, texts, voice lengths).

### 12.2 State

All campaign state (`StrategicState`, `src/sim/strategic/state.ts`), saved with the campaign, filled from a native save
by the import (§11.3): `npcRecords` (`NpcRecordState`), `talk` (`TalkFlowState`, `src/sim/campaign/flow-state.ts`:
`dialogue` = the `TalkState` of §0 with the spoken `lines` and the cosmetic stream `fx`, `soldiers` = the talk context,
`scripted`, `civQuote`, `shopAfterOpening`), `profiles` (`ProfileProgress`), `narrative` (`NarrativeState`: facts,
quests, the hospital, `guide`, `mikeShouldSayHi`) and `civGroups`; in tactical `TacticalState.engagedInConv`,
`engagedInConvFromActionMerc`, `turn.pauseAllAi` and the soldier fields of §0.

### 12.3 Modules

`src/sim/narrative/` holds the dialogue mechanics over the `NarrativeHost` port (`host.ts`: facts, quests, actions,
give, receive, merc lines, civilian context, tactical state, tick, day, `random`):

| Module | Responsibility |
|---|---|
| `records.ts` | §1.4 runtime copies (`ensureQuoteFileLoaded` with the RPC swap), resets, §2.6–§2.7 mutations, `recordHasDialogue`, `actionIdForMovementRecord` |
| `select.ts` | §2 and §4.2–§4.3 as functions over `SelectEnv`/`ReceiveEnv` (facts through `checkFact` of `25` §1.3 with the conversation context) |
| `converse.ts` | §3, §5.1–§5.4, §5.6, §6.3–§6.5, the trigger wait, `stepDialogue`, the face cuts of §7.6 |
| `dialogue-queue.ts` | §7: events, `handleDialogue`, `executeCharacterDialogue`, the text file choice, line lengths |
| `give.ts` | §4.4–§4.5 and the dealer branch |
| `civ-quotes.ts`, `talkable.ts` | §8.1–§8.4, §6.1 |
| `nearby-quotes.ts`, `face-variant.ts` | `SayQuoteFromNearbyMercInSector` with the Drassen shipment line; Elliot's face by `bNPCData` |
| `save-import.ts` | §11.3 |
| `talk-state.ts`, `events.ts`, `narrative-ids.ts` | state, events, ids |

Elsewhere:
- `src/sim/campaign/talk-flow.ts` (`TalkFlow`, the talk session): builds the host (facts through `NarrativeFlow`, quests
  with their history lines, the hospital balance); runs the conversation commands (`29`), the tick hooks
  (`beforeTacticalStep`, `afterTacticalStep`, `afterStrategicStep`) and the view; serves the tactical port's narrative
  calls (surrender, `PCsNearNPC`, `PCDoesFirstAidOnNPC`, `NPCConsiderInitiatingConv`, `sayQuote`).
- Give: `src/sim/campaign/give-flow.ts` (the object taken from the merc, §4.6) and `src/sim/tactical/give.ts` (§4.1:
  `SoldierGiveItem`, the pending give, `VerifyGiveItem`, `SoldierGiveItemFromAnimation`, `Soldier.engagedInAction`, the
  engaged flag of a PC action; code 486 in `item-actions.ts`).
- Recruiting: `src/sim/campaign/narrative/recruit-flow.ts` (`RecruitFlow`: §9.1, §9.3, §9.4,
  `HandleStuffForNPCEscorted`, Darrel's script, `InternalUnescortEPC`, civilian-group side changes through
  `NarrativePort.changeSoldierTeam`), `src/sim/tactical/narrative/team-change.ts` (§9.2), `escort-arrival.ts` (the
  escorts of §5.5), `src/sim/campaign/robot-control.ts` and `src/sim/tactical/narrative/robot.ts` (the robot's
  controller).
- Actions and requests: `src/sim/campaign/narrative/npc-action-flow.ts`, `src/sim/tactical/narrative/npc-actions/`
  (`35` §1).
- Tactical hooks through `TacticalState.narrative` (`src/sim/tactical/narrative/port.ts`): `civ-hostility.ts` (§3.6),
  `sight-rules.ts` (§5.4), `talk-reach.ts`, `talk-arrival.ts` (§6.2), `assassin-approach.ts`, `closest-pc.ts`; the AI
  arrival, close-enough and `quoteRecord` guards in `src/sim/tactical/ai/control.ts` and `decide.ts`;
  `ai/decide-named-npc.ts` (§5.4, green and yellow), `ai/decide.ts` (the 60 s idle), `ai/pause.ts` (`gfPauseAllAI`:
  temporary and manual pauses, the 1500 ms end, the pause of `CheckHostileOrSayQuoteList` and of
  `ProcessImplicationsOfPCAttack`).
- `src/sim/campaign/narrative/guide-description.ts` (§8.6).

### 12.4 Text keys

The simulation carries `TextKey {file, row, width}` and `chars`, never text: none enters state, saves, the input log or
event logs. The lengths come from `DialogueTexts` at runtime and are never committed. The server's `TextService`
(`src/server/text-service.ts`) resolves keys through the VFS (the user's EDT files under `$JA2_DATA_DIR`, language by
the resource version, or the stub pack's) for `observe`, results and events, and `GET /api/text?file=…&row=…` serves a
row (`29`; deviation "Dialogue text").

### 12.5 Limitations

- Not ported: "draws first" (`NPCFirstDraw`), `MakeNPCGrumpyForMinorOffense` (§3.6), the say-later merc line (§6.5), the
  Lua `OnRPCRecruited` hook, the Alt+6 cheat, the debug desire and informative tooltips.
- The queue's unmodelled steps and speaker tests: §7.1–§7.2.
- `RecruitFlow.reservedSoldierSlot` is never set, so the away civilians of the schedules do not reserve their ids in a
  team change (§9.6).

### 12.6 Design decisions

1. Stracciatella's corrected scripts ship without their comments, which quote the dialogue (§1.4); profiles without an
   override use the user's `.npc` files; the stub pack has authored records.
2. The campaign freezes while the talk menu waits for the player, like the shop, so an agent decides at leisure; the
   lines between take ticks as in the original (deviation "Talk session time").
3. Line lengths follow the session's data (text length and voice length), as in the original; the voice lengths ride in
   the rule pack outside its hash so saves and logs keep matching across installs.
4. Draws whose result is stored (the friendly default kept in the profile, the hint drop) use the main stream in the
   original order; presentation-only choices (the civilian entry, speaker picks, the own-merc bark) use the talk
   session's cosmetic stream (deviation "Cosmetic draws in dialogue").
5. `openShop` stays a one-command shortcut for talk + buy/sell; `approach buySell` works inside a session too (deviation
   "Talking to dealers").
6. The quest 100/200 decode follows the oracle (§2.3).
7. Merc lines that interleave with NPC events go through the queue (the tactical port's `sayQuote`); contract, morale
   and other strategic merc lines stay plain `mercQuote` events.
8. With original data, `observe` and MCP responses include the resolved text by default (agents need it to follow
   quests); without it they carry text keys only.

### 12.7 Verification

Oracle patches `0013-talk-oracle.patch`, `0017-give-oracle.patch`, `0018-recruit-oracle.patch` and
`0020-civ-oracle.patch` with the probes `talk.txt`, `give.txt`, `recruit.txt`, `civ.txt` and the comparers
`talk-compare.ts`, `give-compare.ts`, `recruit-compare.ts`, `civ-compare.ts` (`tools/oracle/README.md` "Talk", "Give",
"Recruiting", "Civilians"). Server tests drive the stub NPCs through the API (`src/server/talk-stub.test.ts`,
`give-stub.test.ts`, `recruit-stub.test.ts`, `civ-stub.test.ts`); `narrative-original.test.ts` and
`recruit-original.test.ts` run on the original data.

---

## 13. Quirks kept and open questions

**Quirks kept** (Strac; = V unless marked), each described where it applies:
- desire and approach: §2.1 (halved threat, −30 unarmed, `u8` wrap), §2.2 (scaling after the first desire, recruit never
  scales, Pablo's inverted test), §2.5 (record approach 0 answers 1, 2, 10 only; items need 6; hints 0; CLOSING_SHOP
  dead), §2.3 (quest 100/200, the last date wrapping after day 255), §2.4 and §5.4 (approach-7 opinion-255 records only
  walk the NPC up);
- selection side effects: §3.4 (facts, quests, money and the item before any line; `EndQuest` before `StartQuest`),
  §4.2–§4.3 (money facts never reset, Vince's and Steve's index 0, the unsigned refund), §4.4 (the last small pocket,
  the fresh object, the lost item, the profile inventory out of sync with the soldier);
- bookkeeping: §2.6 and §3.2 (plain records repeat forever, once-per-conversation resets only at an initial quote, a
  player close and a load, a same-day talk opens silently);
- movement: §2.7 and §5.3 (close enough rewrites the script, the unload stores the action id as the record,
  `fAIFlags &= AI_HANDLE_EVERY_FRAME`, `FACE_CLOSEST_PLAYER` inert from record 0);
- §5.1 and §7.2 (quote 0 in `show` vs `RecordHasDialogue`, the panel NPC speaking another NPC's quotes); §6.7 and
  `35` §1.3 (requestors tied to `gpDestSoldier`, the lie ranked by wisdom, Steve's care zeroing Vince's balance);
- the give: §4.1 and §4.6 (check 1 AP, charge 3; the whole slot to a merc; the stack order; no debt payment on a team
  member (Strac); the duplicate when the target is gone; dealers left engaged in action; split money lost on BUYSELL);
- civilians: §1.4 (L12 uses `miners.npc`), §8.2–§8.4 (quests started on every ask, never-chosen types, the entry base
  surviving a type change);
- §1.1 and §9.5 (`RECRUITED` for EPCs and departed RPCs), §3.6 (unused `Random(2)` of side changes), §3.4 (issue #750,
  Strac only); the museum and Kingpin alarms are `25` §6.5.

**Unverified** (inferred from the code, not measured):
- What the shipped `.npc` data uses: approach-7 records, quest values 100/200, `FACT_PC_NEAR` records with lines, PC
  scripts in `000.npc`.
- The saving guards during conversations (§0); `giNPCSpecialReferenceCount` after a load (§5.6).
- The gift's copy staying with the NPC (§4.5); the stale civilian entry after a type change (§8.4).
- That departed RPCs never return (§9.5); that the hostile list and the say-later state are transient (§0).
