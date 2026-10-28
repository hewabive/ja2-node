<!-- NPCs and dialogue: an implementable spec for M6. 2026-10-16.
Source: reference/stracciatella/src (ae6bf01, the snapshot of docs 01–23) and reference/stracciatella/assets/externalized
(= data/externalized), cross-checked against vanilla (reference/vanilla/ja2/Build) where marked. Read-only research:
nothing was built or run, and no original data file was opened. -->

# 24 — NPCs and dialogue: records, conversations, barks and recruiting

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `X:` is `src/externalized/`, `V:` is vanilla
`Build/`, `J:` is `data/externalized/`. "(inferred)" marks conclusions not traced end to end; everything else was read
in the code. C integer semantics apply (`idiv`, `u8` wraps). `Random` = `main` stream, `PreRandom` = `pre` stream (`01`
§3.6). A *profile* is a `MERCPROFILESTRUCT` (the campaign profile of `docs/22` §0), a *soldier* a `SOLDIERTYPE`. A
*record* is one `NPCQuoteInfo`; a *record array* is the 50 records of one profile. The record *index* (0–49) and the
*quote* (an EDT row) are different numbers. *The panel* is the talk panel (`gfInTalkPanel`), *the queue* the dialogue
queue (`ghDialogueQ`). A *frame* is one pass of the original's main loop; ja2-node maps it to one 5 ms tick (§7.1).
Action ids are `NPCAction` (`Tactical/Interface_Dialogue.h:85-342`), approaches `Approach` (`TacticalAI/NPC.h:13-52`),
facts `Fact` (`Strategic/Facts.h`), quests `Strategic/Quests.h`.

**Companions.** `25-quests-facts-and-npc-actions.md` (in parallel) owns `CheckFact`/`SetFact*`, `StartQuest`/`EndQuest`,
the per-action catalog of `HandleNPCDoAction`, `HandleNPCSystemEvent`, `InitNPCs`, the 04:00 handler, NPC placement and
presence (profile insertion data, traversal, `ChangeNpcToDifferentSector`), schedules, boxing, the hospital and the
EPC/RPC campaign rules beyond recruiting. `26-meanwhiles-and-ending.md` (in parallel) owns the meanwhile scenes (which
swap the Queen's and Elliot's record arrays, §1.4), the Queen, the ending and game over. Earlier docs: `09` §5 (green AI
of named NPCs and the `decideActionNamedNPC` hook), `11` §8.4 (`ProcessImplicationsOfPCAttack`), `12` §6 (give: AP,
opcode 486), `14` §4 (save sections 19, 21, 38, 39), `15` §1.5 (pausing and locks), `16` (NPC of note), `22` (RPC pay,
dismissal), `23` §9 and §13 (the shop that the talk menu opens).

---

## 0. State this spec adds

| State | Original | Notes |
|---|---|---|
| Record arrays | `gpNPCQuoteInfoArray[200]` (`TacticalAI/NPC.cc:104`): null (not loaded) or 50 records | Mutable copies of content. Saved whole, not just the flags (save section 19, §12.3) |
| Backup arrays | `gpBackupNPCQuoteInfoArray[200]` (`:105`) | An RPC's own records while he is recruited (§1.4); save section 39 |
| Civilian hint arrays | `gpCivQuoteInfoArray[20]` (`:106`) | Section 19 after the profiles |
| NPC profile fields | approach values, dates, last quote, default-response flags, `bNPCData`, quote record (§1.2) | Campaign profiles (`src/sim/campaign/profiles.ts`) gain them |
| Soldier fields | `ubQuoteRecord`, `ubQuoteActionID`, `uiTimeSinceLastSpoke`, `bCurrentCivQuote`, `bCurrentCivQuoteDelta` | `quoteActionId` exists on `Soldier`; the rest is new (all in the soldier save record, `savegame-soldier.ts`) |
| Talk session | `gTalkPanel.ubCharNum`, `gfInTalkPanel`, `gpSrcSoldier`, `gpDestSoldier`, `gubSrcSoldierProfile` (`Tactical/Interface_Dialogue.cc:150-157`) | The last three outlive the panel; facts read them (§2.3) |
| Pending conversation | `gfConversationPending` and the pending soldiers, approach, record and object copy (`:167-172`) | §6.3 |
| Trigger in flight | `gubTargetNPC`, `gubTargetRecord`, `gubTargetApproach`, `gfShowDialogueMenu`, `gfWaitingForTriggerTimer`, `guiWaitingForTriggerTime` (`:159-164`) | The 500 ms wait becomes 100 ticks (§5.2) |
| Dialogue queue | `ghDialogueQ`, `gpCurrentTalkingFace`, `gubCurrentTalkingID` (`Tactical/Dialogue_Control.cc:110-113`), `gTacticalStatus.ubLastQuoteSaid/ubLastQuoteProfileNUm` | §7; the speech channel is "busy until tick T" (`01` §3.8) |
| Engaged in conversation | `ENGAGED_IN_CONV` in `gTacticalStatus.uiFlags`, `giNPCReferenceCount` (`Dialogue_Control.cc:115`), the static `giNPCSpecialReferenceCount` (`NPC.cc:1365`), `ubEngagedInConvFromActionMercID` | §5.6, §6.6 |
| Hostile-or-say-quote list | `gShouldBecomeHostileOrSayQuote[]`, `gubNumShouldBecomeHostileOrSayQuote` (`Tactical/OppList.cc:508-523`) | Transient (not in the save, inferred) |
| Say-something-later | `gubNiceNPCProfile`, `gubNastyNPCProfile` (`Interface_Dialogue.cc:156-157`) + `FACT_NEED_TO_SAY_SOMETHING` | Transient (§6.5) |
| NPC request box | `gusDialogueMessageBoxType`, `ubRecordThatTriggeredLiePrompt` (`:166, 4157`) | The `npcRequest` prompt (§6.7) |
| Hospital money | `giHospitalTempBalance`, `giHospitalRefund`, `gbHospitalPriceModifier` (`:174-176`) | Saved in section 24 (`SaveLoadGame.cc:1939-1942`); read by §4.3, owned by `25` |
| Civilian group hostility | `gTacticalStatus.fCivGroupHostile[]` | Shared with `11` §8.4 and `25` |

Saving is refused while a talk session is open, while `ENGAGED_IN_CONV` is set and while an `npcRequest` prompt waits
(inferred: the Dead-Is-Dead autosave guard `SaveLoadScreen.cc:1368-1374` skips these states, and the panel's full-screen
mouse region, `Interface_Dialogue.cc:440`, blocks the other buttons).

---

## 1. NPC data

### 1.1 Who has records

| Kind | Test | Record array used | Text file (§1.5) |
|---|---|---|---|
| NPC | profile type `NPC` (`J:mercs-profile-info.json`, `X:mercs/MercProfile.cc:77-85`) | its own (`npcdata/NNN.npc` or the JSON override) | `npcdata/NNN.edt` |
| RPC, not recruited | type `RPC` | its own | `npcdata/NNN.edt` |
| RPC, recruited | type `RPC` and `PROFILE_MISC_FLAG_RECRUITED` | a private copy of `000.npc`; its own array is parked as the backup (§1.4) | merc file, but the NPC file while he is in the panel |
| EPC | any profile with `PROFILE_MISC_FLAG_EPCACTIVE` (escorted NPCs such as JOHN, MARY, MARIA, JOEY, SKYRIDER) | its own (EPCs are NPC-type profiles) | `npcdata/NNN.edt` |
| Player merc (A.I.M., M.E.R.C., I.M.P.) | `isPlayerMerc()` (`MercProfile.cc:92-95`) | a private copy of `000.npc`, created only if a script triggers him | `mercedt/VVV.edt` |
| ROBOT | profile ROBOT | none (`EnsureQuoteFileLoaded` returns null, `NPC.cc:271`) | — |

`ChangeSoldierTeam` sets `PROFILE_MISC_FLAG_RECRUITED` for **every** profile moved to `OUR_TEAM` and clears it otherwise
(`Tactical/Soldier_Profile.cc:673-679`), EPCs included, so `RPC_RECRUITED(s)` (`Tactical/Soldier_Macros.h:13-17`) is
true for an escorted EPC. The `000.npc` switch tests the profile *type* (`X:DefaultContentManager.cc:1665-1676`,
`NPC.cc:276`), so it applies to RPCs only.

### 1.2 Profile fields for NPCs

Offsets are into the decrypted 716-byte record (`Tactical/LoadSaveMercProfile.cc:36-212`); "prof.ts" says whether
`src/content/formats/prof.ts` reads the field today.

| Field | Off | Type | prof.ts | Use |
|---|---|---|---|---|
| `usApproachFactor[4]` | 396 | u16 ×4 | no | the *merc's* multiplier (%) for approaches 1–4 when he talks (§2.1) |
| `ubApproachVal[4]` | 555 | u8 ×4 | no | the *NPC's* receptiveness per approach 1–4; changed once by the first approach (§2.2) |
| `ubApproachMod[3][4]` | 559 | u8 ×12 | no | row = first approach used (friendly, direct, threaten), column = value scaled; row-major |
| `bApproached` | 651 | i8 | no | first-approach bits `gbFirstApproachFlags` 0x01/0x02/0x04 (0x08 for recruit is never set) (`NPC.cc:111`) |
| `bMercOpinion[75]` | 576 | i8 ×75 | yes | the NPC's opinion of the talking merc; ids ≥ 75 read 0 (deviation "Opinions of high profile ids") |
| `bTown`, `bTownAttachment` | 571, 572 | i8 | yes | town loyalty weight in the desire (§2.1) |
| `ubLastDateSpokenTo` | 667 | u8 | no | `(UINT8)GetWorldDay()` of the last conversation (§3.5); read by Tony, Devin and the NPC-of-note prompt |
| `ubLastQuoteSaid`, `bLastQuoteSaidWasSpecial` | 529, 668 | u8 | no | what "repeat" says: a record index if special, else a quote (§3.2) |
| `bFriendlyOrDirectDefaultResponseUsedRecently`, `bRecruit…`, `bThreaten…` | 672–674 | i8 | no | default answer given once, then "get lost" (§3.3); cleared at 04:00 (`Strategic/Strategic_Event_Handler.cc:699-708`, `25`) |
| `ubQuoteRecord`, `ubQuoteActionID` | 238, 410 | u8 | no | a walk to a record destination interrupted by unloading the sector (§5.3) |
| `bNPCData`, `bNPCData2` | 675, 688 | i8 | no | per-NPC scratch (Madame's counts, Daryl's spouse, …) (`25`) |
| `iBalance` | 676 | i32 | yes | money owed to (−) or by the NPC; payments (§4.2-§4.3) |
| `uiMoney` | 684 | u32 | yes | cash in the profile inventory (§4.4) |
| `inv`, `bInvNumber`, `bInvStatus` | 416, 377, 358 | | yes | the profile ("script") inventory: required-item tests read it, not the soldier (§2.4) |
| `sSalary` | 332 | i16 | yes | RPC daily rate; `NPC_ACTION_RECRUIT` sets 0 (§9.1) |
| `ubMiscFlags`, `ubMiscFlags2`, `ubMiscFlags3` | 233, 231, 689 | u8 | yes (raw) | flags below |
| `sGridNo`, `sSector.z`, `fUseProfileInsertionInfo`, `ubStrategicInsertionCode`, `usStrategicInsertionData` | 408, 669, 406, 522, 670 | | 408/669 by `savegame-profile.ts` | placement (`25`); written by `UnRecruitEPC` (§9.4) |
| `ubRoomRangeStart[2]`, `ubRoomRangeEnd[2]` | 413, 523 | u8 ×2 | no | room facts (`25`) |
| `ubFaceIndex`, eyes, mouth, blink, expression | 108, 262–269, 280, 284 | | no | portraits (UI only): loaded, served by `GET /api/sessions/:id/profiles` since M8 (the face index is the profile id, `LoadMercProfiles`; `04` §6.25) |
| `ubVoiceId` | save v104+ (`docs/14` §4 row 5) | u8 | no | merc text and speech file id (§1.5) |

Flags read or written by this spec (`Tactical/Soldier_Profile_Type.h:25-51`): `RECRUITED 0x01`, `FORCENPCQUOTE 0x04` (an
EPC's abandonment line uses the NPC file), `WOUNDEDBYPLAYER 0x08`, `SAID_HOSTILE_QUOTE 0x20`, `EPCACTIVE 0x40`; flags2
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

**Content (once per session, `X:DefaultContentManager.cc:1379-1428`).** Skipped entirely without `binarydata/prof.dat`.
1. `J:script-records-control.json`: for each meanwhile id (0–16) the QUEEN and ELLIOT files (`160–176.npc`,
   `180–196.npc`), kept as a separate table keyed `(meanwhile, profile)`.
2. The "script-controlled PCs" file `000.npc` → the recruited/PC template.
3. `J:script-records-NPCs.json`: complete arrays for ten profiles (MARIA, JOEY, SKYRIDER, MARTHA, JOHN, MARY, HERVE,
   PETER, ALBERTO, CARLO) — Stracciatella's corrected scripts, deserialised by `X:content/NPCQuoteInfo.cc:9-106`.
   Records missing from the JSON are value-initialised zeros; their `ubLastDay` 0 makes them unsayable from day 1
   (§2.3). JSON defaults: `lastDay`, `quoteNum`, `numQuotes`, `triggerRecord` 255, `goToGridno` 65535, quest `NO_QUEST`;
   `requiredGridNo` is stored negated; `actionData.doFirst` negates the code; `turnToFace: NAME` encodes 500 + profile.
4. Every `npcdata/NNN.npc` (numeric prefix < 200, not `000.npc`) fills the profiles the JSON did not; a binary present on
   more than one VFS layer overrides the JSON (`binIsOnModLayer` counts layers and every SLF file is a layer of its own): in
   the user's install the loose `Data/NpcData/097.npc` and `118.npc` sit next to `Npcdata.slf`, so SKYRIDER and JOHN use their
   binary records, not Stracciatella's JSON (ja2-node counts layers the same way, `Vfs.layerCount`). Binary records are 32 bytes each, 50 per file (`NPC.cc:113-159`). The
   meanwhile files 160–196 are thereby also loaded as the scripts of profiles 160–196 (vehicles and unused ids;
   harmless).

**Runtime copies.** `LoadQuoteFile` (`NPC.cc:227-250`) copies the content array; while `AreInMeanwhile()` QUEEN and
ELLIOT get the current meanwhile's variant. `EnsureQuoteFileLoaded(p)` (`:269-315`) is called by every reader and writer
below: ROBOT → none; an RPC that is recruited and has no backup → the current array (possibly null) becomes the backup
and a fresh `000.npc` copy is loaded; an RPC that is not recruited but has a backup → the backup is restored (the
`000.npc` copy is dropped); otherwise load if null. A missing file leaves null and every caller treats it as "no
records". So an array is created lazily at the first read of any kind, and the save's "present" byte means exactly that
(§12.3).

**Resets.** New game: `ReloadAllQuoteFiles` (`Strategic/Game_Init.cc:324`, `NPC.cc:420-435`) drops backups and reloads
every loaded NPC/RPC and civilian array from content: all record state is reset. Loading a save: `ShutdownNPCQuotes`
(`SaveLoadGame.cc:666`), then the arrays from the save (`NPC.cc:2402-2514`), then `RefreshNPCScriptRecord` for saves <
98 (`:2428-2494`: listed records not yet said are replaced by fresh content; `NO_PROFILE` record 5 means every PC's
copy), then once-per-conversation records of NPCs whose profile sector is the loaded sector are reset
(`SaveLoadGame.cc:1174`). Meanwhile start and end call `ReloadQuoteFile` (`Strategic/Meanwhile.cc:287, 523`), which
**discards** that NPC's record state (`NPC.cc:318-323`) — see `26`.

**Civilian hint files.** `LoadCivQuoteFile(i)` (`NPC.cc:370-383`): index 16 → `npcdata/miners.npc`, else
`npcdata/<sector>.npc` for the 17 sectors of `gsCivQuoteSector` (`:57-80`); `FindCivQuoteFileIndex` (`:2706-2716`)
returns 16 underground and the table index on the surface. **Quirk (= V):** table entry 16 is L12, so L12's civilians
use `miners.npc` and never load `L12.npc`; their hint *text* still comes from `L12.edt` (§8.3).

### 1.5 Text and durations

- **Which EDT** (`X:content/Dialogs.cc:7-50`): the alternate file `npcdata/d_NNN.edt` (RPC sector descriptions, §8.6);
  else an NPC/RPC that is not recruited, or is the NPC of the open panel (`ProfileCurrentlyTalkingInDialoguePanel`,
  `Interface_Dialogue.cc:948-953`), or has `FORCENPCQUOTE` → `npcdata/NNN.edt`, where 151–154 (HERVE, PETER, ALBERTO,
  CARLO) share 151's file; everyone else → `mercedt/VVV.edt` by `ubVoiceId`. Decided when the quote **executes** (§7.2),
  not when it is queued.
- **Rows**: 240 UTF-16 code units per quote (`X:DefaultContentManager.cc:90, 394-398`); civilian files 160 per entry
  (`Tactical/Civ_Quotes.cc:36, 144`). Decoding (`X:strings/EncryptedString.cc:6-40`): read the row, force the last unit
  to NUL, stop at the first NUL, subtract 1 from every unit > 33, then the per-language fix-ups (Russian CP1251 shift;
  three English code points). A missing or empty row makes `ExecuteCharacterDialogue` return without talking (§7.2).
- **Duration** without speech (the only one ja2-node uses, `01` §3.8): 60 ms × UTF-32 length of the decoded quote
  (`Tactical/Faces.cc:1229-1234`, `Dialogue_Control.cc:67, 1521-1524`) = **12 ticks per character**, then 300 ms with
  the mouth closed (`SetupFinalTalkingDelay`, `Faces.cc:1304`) = 60 ticks before the face is done. Civilian boxes:
  `FindDelayForString("\"" + text + "\"") + 500` ms (`Civ_Quotes.cc:381`), presentation only.

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

`threat = CalcThreateningEffectiveness(merc)` (`:451-467`): the merc's soldier on our team (0 if none); deadliness of
the hand item if it is a weapon, else 0, and **0 becomes −30**; `(EffectiveLeadership + EffectiveStrength + deadliness)
/ 2` (the comment says thirds; the code halves). The non-threaten branch reads the **profile** leadership, the threaten
branch the **soldier's effective** stats. Towns without loyalty have rating 0 (`:481-482`). Debug builds print the
desire next to the menu entries (`Interface_Dialogue.cc:742-751`), and `informative_tooltips` (default false,
`J:game.json:144`) would show modifiers; ja2-node shows neither (D16).

### 2.2 First approach (`ApproachedForFirstTime`, `NPC.cc:521-536`)

In `NPCConsiderTalking`, for approaches 1–4 the desire is computed **first**; then, for approaches **1–3 only** (strict
`< NUM_REAL_APPROACHES`, `:558`) and only if `bApproached` lacks that approach's bit: set the bit and scale all four
`ubApproachVal[k] = min(255, ubApproachVal[k] * ubApproachMod[a-1][k] / 100)` (u32 math). The first
friendly/direct/threaten click therefore uses the old values and changes every later desire; recruit never triggers it.
**Pablo quirk:** for `APPROACH_SECTOR_NOT_SAFE` Pablo is treated as a threat (`:563-572`), but the bit test is not
negated, so the scaling happens only if he had **already** been threatened.

### 2.3 `NPCConsiderQuote(npc, merc, approach, i, desire, array)` (`NPC.cc:1049-1234`), in this order

1. `SAID` set → no.
2. Quest (`:1084-1112`): 255 passes; `ubQuest % 100 ≥ 30` throws; `> 200` → quest `q − 200` must be DONE; else `> 100` →
   `q − 100` NOT STARTED; else `q` IN PROGRESS. **Quirk:** the strict `>` decodes 100 and 200 (quest 0 not started /
   done) as "quest 100 in progress / not started" and reads `gubQuest[100]` past the 30-byte array. The oracle probe
   `questdecode` shows that the linker puts `gubFact` 512 bytes *before* `gubQuest` and that the byte read is 0 whatever
   fact 70 holds: quest value 100 never passes, 200 always does (verified; ja2-node reads 0 past the array).
3. `usFactMustBeTrue` ≠ 65535 → `CheckFact(f, npc)` must be true; `usFactMustBeFalse` → must be false (`25` owns
   `CheckFact`). Several facts are computed on the spot from the conversation context, which outlives the panel:
   `gpSrcSoldier`/`gpDestSoldier` (talker strong/female, Dynamo, Shank, AIM merc within 10, …) and
   `gubSrcSoldierProfile` (Ira talking, Maddog, `CalcDesireToTalk(dest, src, RECRUIT) ≥ 50`)
   (`Strategic/Quests.cc:287-330, 543, 707, 742, 837, 927-944, 1065`). `FACT_PC_NEAR` (100), the money facts and
   `FACT_ITEM_POOR_CONDITION` are plain stored facts set by §4.2 and §5.1.
4. Approach (`:1142-1169`): checked when the record requires one **or** the approach used is not FRIENDLY, DIRECT or
   TRIGGER_NPC; 29 accepts 1–4, 30 accepts 1, 2, 4, anything else must be equal (§2.5).
5. Days (`:1172-1209`, `day = GetWorldDay()`): `firstDay == 254` with a profile → `day > ubLastDateSpokenTo`, else `day
   ≥ firstDay`; then `day > lastDay && day < 255` fails. A u8 `ubLastDateSpokenTo` wraps after day 255, after which "new
   day" is always true (inferred consequence).
6. Opinion (`:1212-1225`): unless 255 or TRIGGER_NPC, `desire ≥ ubOpinionRequired`.

No draws, no state change (only debug logging).

### 2.4 `NPCConsiderTalking(npc, merc, approach, record, array, &q, &i)` (`NPC.cc:542-646`)

Needs the NPC's soldier (else it returns 0 *before* clearing the result pointers, which `ConverseFull` initialises to a
local record — unreachable, since every caller has the soldier). Desire as §2.1 for approaches 1–4 (Pablo: §2.2); 0 for
all others. Scan range: only `record` for TRIGGER_NPC, else 0–49. For each record: `sRequiredItem > 0` → the item must
be in the NPC's **profile** inventory (`FindObjectInSoldierProfile`, `Tactical/Items.cc:3013-3022`; 1000/1001 never
match, so "wants any item" records are invisible here); `< 0` → the NPC's soldier must stand on that gridNo; then §2.3.
Except for `NPC_INITIATING_CONV` the **first** passing record wins: result = that record, its index and its opinion
requirement. For `NPC_INITIATING_CONV` it looks for the highest `ubOpinionRequired` **> 0**, but with desire 0 only
opinion 0 or 255 passes §2.3 step 6, so only records requiring approach 7 with opinion 255 count; it then returns that
opinion with the **last scanned** record and the record's *quote* number instead of its index (both unused by the only
caller, §5.4).

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
| `SAID` set by actions (`SET_*_RECORD_13_USED`, `MARK_KINGPIN_QUOTE_0_USED`) | `SetQuoteRecordAsUsed` (`:443-448`), `25` |
| `SAID` set on a civilian hint | `ConsiderCivilianQuotes(…, TRUE)` (`:2732-2735`) |
| `SAID` cleared on all `SAY_ONCE_PER_CONVO` records | at `NPC_INITIAL_QUOTE` (`:1408`), when the player closes the panel (Done/Esc, `Interface_Dialogue.cc:993, 1005`), after loading a save (§1.4) — **not** when a script closes it |
| Darren's record 11 un-said at each initial quote while `FACT_281` is false | `:1413-1416` |
| Whole array reset | new game, meanwhile reload (§1.4) |

A record flagged `alreadySaid` in data starts unsayable and only a once-per-conversation reset can revive it.

### 2.7 Other record mutations (all saved with the array)

- `ReplaceLocationInNPCData(old, new)` (`NPC.cc:1237-1264`): every record whose required gridNo or `usGoToGridno` equals
  `old` gets `new`. Called when a record walk ends "close enough" — within `SpacesAway < 4` of the destination, not on a
  schedule (`TacticalAI/AIMain.cc:415-428`), or the path fails within 4 tiles (`:1479-1488`) — so the NPC's script is
  permanently rewritten to the tile he reached.
- `UpdateDarrelScriptToGoTo(s)` (`NPC.cc:2667-2694`): Darrel's record 10 goes to a sweet spot near `s` (radius 5, then
  10) and record 11 requires that tile and triggers `s`'s profile (action `25`).

---

## 3. A conversation step: `ConverseFull(npc, merc, approach, record, object)` (`NPC.cc:1363-1951`)

`Converse(npc, merc, a)` is `ConverseFull(npc, merc, a, 0, null)` (`:1954-1957`). `object` is non-null exactly for
GIVINGITEM.

### 3.1 Prologue (`:1374-1401`)

If the NPC has a soldier: `uiTimeSinceLastSpoke = now` (wall clock, §10.2); if `!CheckFact(FACT_CURRENT_SECTOR_IS_SAFE,
npc)` (enemies in the sector and the NPC heard a shot, or in combat, `Quests.cc:495-497`) and the approach is not
TRIGGER_NPC, GIVEFIRSTAID, DECLARATION_OF_HOSTILITY or ENEMY_NPC_QUOTE and `NPCHasUnusedRecordWithGivenApproach(npc,
SECTOR_NOT_SAFE)` → the approach **becomes** SECTOR_NOT_SAFE (an initial quote then skips §3.2 entirely); clear
`AI_ASLEEP`. No array → return the object to the giver (§4.4) and stop.

### 3.2 Initial quote, who-are-you, repeat (`:1404-1501`)

- **NPC_INITIAL_QUOTE**: reset once-per-conversation records; Darren's record 11 (§2.6); queue `NPCDoAction(npc,
  TURN_TO_FACE_NEAREST_MERC, 1)`. If `ubLastDateSpokenTo > 0`: on a later day try SPECIAL_INITIAL_QUOTE (found → return
  the object, `Converse(SPECIAL_INITIAL_QUOTE)`, stop), else quote 1 (`QUOTE_SUBS_INTRO`); on the same day **say
  nothing** and stop (the last-date update below is skipped by the early return, but the date is today anyway). Never
  spoken to: try SPECIAL_INITIAL_QUOTE, then INITIAL_QUOTE (found → recurse with it), else quote 0. A default quote sets
  `ubLastQuoteSaid = q`, `bLastQuoteSaidWasSpecial = FALSE`.
- **NPC_WHOAREYOU**: quote 0, not remembered.
- **REPEAT**: `ubLastQuoteSaid == 255` → quote 0; special → the record's quotes again (no actions); else that quote.

### 3.3 Approaches and default answers (`:1502-1648`)

GIVINGITEM first plays an introduction (`:1505-1538`): spoken to before and on a later day → SPECIAL_INITIAL_QUOTE if
one matches (`Converse` recursion; Darren then refuses the item and stops); never spoken to → INITIAL_QUOTE if one
matches; then `NPCConsiderReceivingItemFromMerc` (§4.2) picks the record. TRIGGER_NPC passes `record`; everything else
scans from 0.

No record: TRIGGER_NPC aborts (nothing said, nothing set). Otherwise the default quote below is queued, remembered as
`ubLastQuoteSaid` (non-special), and:

| Approach | First time | Once the flag is set |
|---|---|---|
| FRIENDLY | quote 2 + `Random(2)`, set the friendly/direct flag | quote 9 (`GETLOST`) |
| DIRECT | quote 5, set the same flag | 9 |
| THREATEN | quote 6, set the threaten flag | 9 |
| RECRUIT | quote 7, set the recruit flag | 9 |
| GIVINGITEM | quote 4 (`GIVEITEM_NO`) | — |
| any other | quote 0 | — |

Quote 9 → profiles 70 (CONRAD) and 120 (GENERAL) queue `NPC_ACTION_BECOME_ENEMY`; the panel closes after the speech
(`NPCClosePanel`). Quote 4 → close after the speech, and JIM, JACK, OLAF, RAY, OLGA, TYRONE (the assassins) cancel their
AI action and join the hostile-or-say-quote list (§3.6).

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
  OKLIFE) soldier once. `CheckHostileOrSayQuoteList` runs every overhead pass (`Tactical/Overhead.cc:494`) but only with
  an empty queue, no panel and no trigger wait. It flags every listed profile `NEEDS_TO_SAY_HOSTILE_QUOTE`, keeps those
  with `NPCHasUnusedHostileRecord(DECLARATION_OF_HOSTILITY)` (a usable record that does not require fact 289,
  `NPC.cc:2317-2334`) and unflags the rest; none → every listed neutral turns hostile (`MakeCivHostile`), a civilian
  group at "will become hostile" becomes hostile, AI unpauses, the list clears, combat starts for `CIV_TEAM` if not
  already in combat; otherwise pause all AI, reveal the speaker to our team if unseen, and `TriggerNPCWithIHateYouQuote`
  on `Random(n)` of them. The list is consumed one speaker at a time across frames.
- **`TriggerNPCWithIHateYouQuote(p)`** (`NPC.cc:2279-2298`): first record passing DECLARATION_OF_HOSTILITY → queued
  trigger with the panel, `SAID_HOSTILE_QUOTE` set. `FACT_NPC_IS_ENEMY` counts the `NEEDS_TO_SAY_HOSTILE_QUOTE` flag
  (`Quests.cc:616-618`), which is how the declaration record sees itself as hostile.
- **Entry points** that feed the list: a neutral civilian-group member who sees us while the group "will become
  hostile", or a non-neutral NPC with an unused declaration record (`NPCHasUnusedRecordWithGivenApproach`, so unlike the
  speaker test it does not skip fact-289 records; `OppList.cc:1536-1563, 1671-1677`); Eldin and the
  museum (`:1578-1595`); `NPC_ACTION_BECOME_ENEMY` (`Interface_Dialogue.cc:1856-1880`: civilian group → side change,
  then the list); the assassins (§3.3, §6.2); civilian-group side changes (`Overhead.cc:2674-2809`); "draws first" when
  we aim at a neutral armed NPC out of combat (`Handle_UI.cc:2126-2136`, `NPCFirstDraw` `TeamTurns.cc:1737-1768`:
  exp-level halves with +1 if the NPC was **threatened**, two `Random` draws); minor offences such as taking an owned
  item (`MakeNPCGrumpyForMinorOffense`, `Handle_Items.cc:3224-3260`: fifteen listed profiles, mostly shopkeepers, get
  `NPC_PISSED_OFF` and an I-hate-you trigger, everyone else the list).
- **Actions** (index only; `25` owns them): `ENTER_COMBAT` 25 (side change or `MakeCivHostile`, close panel, enter
  combat for the NPC's team, `:2648-2672`), `END_COMBAT` 166, `BECOME_FRIENDLY_END_COMBAT` 167 (neutral again, opponent
  counts, `ExitCombatMode` when nobody fought, `:2730-2761`), `TRIGGER_FRIEND_WITH_HOSTILE_QUOTE` 21 (now only closes
  the panel). `TriggerFriendWithHostileQuote` (`NPC.cc:2517-2565`) still has two live callers: `EndAIGuysTurn`
  (`AIMain.cc:530-546`: a non-neutral civilian-group member ending his turn-based turn runs
  `CivilianGroupMembersChangeSidesWithinProximity` and triggers the first profile it returns) and
  `NPC_ACTION_GET_OUT_OF_WHEELCHAIR_AND_BECOME_HOSTILE` (`Interface_Dialogue.cc:3670-3680`). (Corrected 2026-10-16.)
- **`MakeCivHostile`** (`Overhead.cc:2591-2671`) and the civilian-group functions (`:2674-2809`) are shared with
  `ProcessImplicationsOfPCAttack` (`11` §8.4). `CivilianGroupMemberChangesSides` moves group members off our team with
  `ChangeSoldierTeam`, makes in-proximity members hostile, posts `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` (+300
  min) and draws `Random(2)` for a "first profile" that only commented-out code reads — the draws still happen.

---

## 4. Giving items and money

### 4.1 The give action

- **Paths.** Dragging an item onto a soldier who passes `IsValidTalkableNPC(t, give=TRUE, mercs=FALSE, collapsed=TRUE)`
  (with the alternative cursor: any merc instead, `Tactical/Interface_Items.cc:3183-3202`). AP check: `GetAPsToGiveItem`
  = path + `AP_GIVE_ITEM` 1 (`Tactical/Points.cc:1426-1429`, `Points.h:142`); a robot target is reloaded instead
  (`:3214-3299`); else `SoldierGiveItem(merc, target, copy, slot)`, and a profiled target that is neither a player merc
  nor a recruited RPC sets `ENGAGED_IN_CONV` with `ubEngagedInConvFromActionMercID` (`:3310-3314`,
  `Dialogue_Control.cc:1532-1537`) — the game is paused and the UI locked during the walk. The menu's "Give" entry
  (non-dealers) only closes the panel, opens the inventory and makes the NPC wait 10 s (`bNextAction = WAIT`, data
  10000) unless it has a pending action (`Interface_Dialogue.cc:829-850`).
- **`SoldierGiveItem`** (`Tactical/Handle_Items.cc:1056-1094`): an adjacent tile (`FindAdjacentGridEx`) or nothing;
  pending `MERC_GIVEITEM` with the slot, a copy of the object, the target's tile, direction and id; both soldiers
  `SOLDIER_ENGAGEDINACTION`; walk there, or start the give animation.
- **Opcode 486** (`Tactical/Soldier_Ani.cc:1335-1343`) → `SoldierGiveItemFromAnimation`, then, for an NPC-type giver,
  `TriggerNPCWithGivenApproach(giver, DONE_GIVING_ITEM)`.
- **`SoldierGiveItemFromAnimation`** (`Handle_Items.cc:2306-2498`): take the copy; **`DeductPoints(AP_PICKUP_ITEM 3)`**
  (the check was for 1); `VerifyGiveItem` (`:2258-2303`): the soldier now on the target tile must be the target, else
  the object drops VISIBLE at the giver's tile, both are disengaged and `TriggerNPCWithGivenApproach(giver,
  DONE_GIVING_ITEM)` runs for any giver. Then, by target:
  - **dealer** (`IsMercADealer`): undo the engaged flag; an unused BUYSELL record → trigger it (the merc keeps the
    item); else, if `NPCWillingToAcceptItem` is false → the shop opens with the item offered (`23` §9.1); if true → as
    an NPC below;
  - **player merc or recruited RPC**: `AutoPlaceObject`, else drop VISIBLE at the giver's tile; the source slot is
    deleted whole (`DeleteObj`); money to a profile with `iBalance < 0` pays it down to at most 0, with a message;
  - **NPC**: remove the given count from the slot (`RemoveObjs`), then `InitiateConversationFull(target, giver,
    GIVINGITEM, 0, &copy)` (§6.3): a conversation opens around the item.

### 4.2 `NPCConsiderReceivingItemFromMerc(npc, merc, obj, array)` (`NPC.cc:660-941`)

1. `FACT_NPC_IS_ENEMY` for this NPC and not JOE → nothing.
2. Desire = `CalcDesireToTalk(npc, merc, GIVINGITEM)` (approach value 100).
3. Normalise the item: a gun of rifle or MG class (not ROCKET_LAUNCHER) → `ANY_RIFLE`; HEAD_2, 3, 5, 6, 7 → HEAD_2
   (HEAD_4, Slay's, stays); MONEY, SILVER, GOLD → set `FACT_SMALL_AMOUNT_OF_MONEY` (< 1000) or
   `FACT_LARGE_AMOUNT_OF_MONEY` and treat as MONEY (**never reset**: both can end up true); WINE, BEER → ALCOHOL.
4. `FACT_ITEM_POOR_CONDITION` = `status[0] < 50`.
5. Scan 0–49: `sRequiredItem > 0` and equal to the item or 1000; `NPCConsiderQuote(…, GIVINGITEM, …)` — so only records
   that require approach 6 exactly can take items (record approach 0, 29 and 30 do not match 6). The first match
   decides, with these money cases (all for item MONEY):

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
`NPCWillingToAcceptItem` (`NPC.cc:2337-2348`).

### 4.3 `HandleNPCBeingGivenMoneyByPlayer(npc, amount)` (`NPC.cc:945-1046`) → record index

| NPC | Rule |
|---|---|
| STEVE, VINCE | `cost = CalcMedicalCost(npc)` (`25`). `amount + temp + refund ≥ cost` → 26 with `FACT_WOUNDED_MERCS_NEARBY`, 25 with `FACT_ONE_WOUNDED_MERC_NEARBY`, else 0; if `refund > 0`: `refund = max(0U, refund − cost + amount)` evaluated **unsigned**, so the clamp never bites and a negative result survives the assignment back to INT32; `temp = 0`. Short → message "needs $(cost − amount − temp)", record 27, `temp += amount` |
| KINGPIN | `amount < −iBalance` → 9, else 10; `iBalance += amount` |
| WALTER | `iBalance == 0` → 12, else 13; `iBalance += amount` |
| FRANK | Frank's dealer cash `+= amount` (`docs/23` §6); record 0 |
| GERARD / JOE | `iBalance += amount`; ≥ 10000 → 12 / 7, else 11 / 6 |
| others | 0 |

### 4.4 Taking and returning the object

- **Taking** (`ConverseFull` step 4, `NPC.cc:1685-1708`): `PlaceObjectInSoldierProfile(npc, obj)`
  (`Items.cc:2870-2947`). Money when the profile already holds cash → `uiMoney += amount` and the money object is
  rebuilt. Otherwise the first slot from BIGPOCK1POS up to **but excluding** SMALLPOCK8POS that is empty in the profile
  and on the soldier: money → `uiMoney += amount` (the slot stays unmarked); other items → profile `inv/status/number` =
  item, `status[0]`, count; the soldier gets a **fresh** `CreateItem(item, status)` (or `CreateMoney(uiMoney)`):
  attachments, ammo and further stack members are lost (Madlab first drops the attachments VISIBLE at his tile). No free
  slot → the object vanishes (inferred: the result is ignored). Removing it from the giver: `FindExactObj` compares
  pointers (`Items.cc:352-361`) and never matches the copy, so nothing more is removed from our merc; a non-player giver
  loses one item of that kind from its profile.
- **Returning** (`ReturnItemToPlayer`, `NPC.cc:1344-1357`): `AutoPlaceObject` on the giver, else into the item cursor
  (`InternalBeginItemPointer`). Happens when there is no array, the approach was changed (introduction recursion,
  sector-not-safe), no record matched, the record's action is `DONT_ACCEPT_ITEM` 1, or Darren refused after his
  introduction.

### 4.5 The NPC gives an item (`usGiftItem`)

The queued `DialogueEventGiveItem` (`NPC.cc:1317-1341`) runs `HandleNPCItemGiven(npc, &soldier.inv[slot], slot)`
(`Interface_Dialogue.cc:1250-1278`): if the panel's talker cannot receive it —
`SourceSoldierPointerIsValidAndReachableForGive (gpDestSoldier)` (`:1212-1247`: `gpSrcSoldier` active, in sector, ≥
OKLIFE, not collapsed below OKBREATH, within `MaxDistanceVisible()` = 2 × STRAIGHT (`OppList.cc:875-878`) of the NPC, an
adjacent tile exists) — the item is copied into the pool VISIBLE at the NPC's tile (the NPC keeps its own copy,
inferred: nothing deletes it) and `DONE_GIVING_ITEM` is triggered; otherwise the panel closes and `SoldierGiveItem(npc,
talker, obj, slot)` walks the NPC over (§4.1; the merc receives it, then `DONE_GIVING_ITEM`). The NPC's **profile**
inventory keeps the item (only the soldier slot is deleted, `Handle_Items.cc:2449-2452`), so a later required-item test
still sees it (inferred consequence).

### 4.6 Corrections and details from the give slice (2026-10-16, verified in Strac and with the oracle)

- **The object.** A drag picks up one item of a stack (`GetObjFrom(slot, 0)`) or the whole slot with Shift
  (`RemoveObjectFromSlot`); a left click on money picks up the whole pile, the item description's money box splits off an
  amount in steps of 10 (`RemoveMoney`: the pocket shrinks at once, the source slot is `NO_SLOT`). Before the give,
  `HandleItemPointerClick` puts the cursor object back into its slot (`PlaceObject`): one item taken from a stack goes to the
  end of the stack, so the NPC branch's `RemoveObjs(slot, 1)` later removes the *new* first item — the NPC gets the first
  item's status and the merc keeps a copy of it (kept).
- **AP.** The cursor cost is `GetAPsToGiveItem` to the adjacent tile (`FindAdjacentGridEx` without forcing to the person)
  and refuses with "no path" when it is 0; then the walk to the target's own tile plus 1 must be affordable; the give
  animation charges `AP_PICKUP_ITEM` 3.
- **Engaged flags.** `SetEngagedInConvFromPCAction` runs for a profiled target that is neither a player merc nor
  `RPC_RECRUITED` (an escorted EPC counts as recruited), even when `SoldierGiveItem` found no adjacent tile — a soft lock that
  ja2-node avoids by refusing with `noPath`. Both soldiers get `SOLDIER_ENGAGEDINACTION`, which stops `HandleSoldierAI` for
  them; the dealer branches return before clearing it, so a dealer's AI stays stopped after a give (kept).
- **`VerifyGiveItem`.** Another soldier on the target's tile: nothing happens. Nobody there: when the give *begins* the
  temporary object is dropped VISIBLE at the giver's tile while the slot still holds the item (a duplicate, kept), and
  `DONE_GIVING_ITEM` is triggered for the giver; when the *animation* runs the temporary object was already taken, so
  nothing drops (money split off a pocket is then lost).
- **Dealers.** An unused BUYSELL record is triggered and the object is discarded (the merc keeps a slot item; split money is
  lost). Otherwise the shop opens with the object on the offer table and `RemoveObjFrom(slot, count)` removes the object at
  index `count` of the slot (the whole object for a single item, the second item of a stack when one was given).
- **Team members.** `AutoPlaceObject` empties the money object it places (Stracciatella's `FillMoneySlot`), so the debt
  payment that follows adds 0: giving money to a recruited RPC who is owed money only prints "still owed" (Strac; kept).
- **`HandleNPCItemGiven`** uses `gpDestSoldier` for the reach test and as the giver, `FindSoldierByProfileID(npc)` for
  the dropped copy (level 0, z 0).
- **Vince and Steve.** `CheckFact(VINCE_EXPECTING_MONEY)` is evaluated in each condition of the chain (twice before the
  hospital branch), which matters for the order of the computed facts.
- **No free profile slot.** `PlaceObjectInSoldierProfile` returns FALSE and the object is gone (verified).

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

The record is checked again when the trigger is handled (§2.4). In between, state may change: `FACT_PC_NEAR` is already
false by the time a delayed (show) trigger runs, so a record that needs it would abort after its panel opened (inferred:
depends on data). `show` treats quote 0 as dialogue while `RecordHasDialogue` (`:2697-2703`), which decides whether
another NPC's panel closes, treats quote 0 as none.

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
`GameScreen.cc:337`); `EmptyDialogueQueue` cancels it (`Dialogue_Control.cc:215-221`). With an approach other than
TRIGGER_NPC (declarations, DONE_*, BUYSELL) `ConverseFull` scans from record 0, so the record played is the first match
*then*. A conversation the NPC opens with itself as the talker has `gubSrcSoldierProfile` = the NPC.

### 5.3 Scripted movement

- **Start** (`NPCGotoGridNo`, queued, `:1158-1182` → `HandleNPCGotoGridNo`, `:1439-1490`): close the panel; zero the AI
  counter and drop a pending WAIT; a soldier of ours gets `SOLDIER_PCUNDERAICONTROL`; next action WALK to the tile;
  cancel the current action unless it is a pending one; `ubQuoteRecord = r + 1`; `ubQuoteActionID =
  ActionIDForMovementRecord` (`NPC.cc:2568-2582`: actions 103–106 `TRAVERSE_MAP_*` → ids 5–8, else `CHECKFORDEST` 1,
  `TacticalAI/AI.h:95-102`); `sAbsoluteFinalDestination` = the tile; `AI_HANDLE_EVERY_FRAME`.
- **While walking** (`ubQuoteRecord ≠ 0`): no `SetNewSituation` (`AIMain.cc:1989-1996`); a new situation only keeps the
  AI GREEN (`:342-350`); blocked movers swap places (`Tactical/Soldier_Tile.cc:551`); the AI list skips its random
  filter (`TacticalAI/AIList.cc:147`). The "close enough" rule rewrites the records (§2.7).
- **Arrival** (`AIMain.cc:430-445`): at the end of the path with the absolute destination reached, not on a schedule,
  `CHECKFORDEST` → `NPCReachedDestination(s, FALSE)` and wait 500 ms; traversal ids → `HandleAITacticalTraversal`
  (`25`). Also from `Soldier_Tile.cc:578-590` (blocked on the destination) and `Overhead.cc:900-905` (handle next
  frame).
- **`NPCReachedDestination(s, already)`** (`NPC.cc:2009-2074`): `r = ubQuoteRecord − 1` (0 if none); clear
  `ubQuoteRecord`; for our soldier clear `PCUNDERAICONTROL` and do **`fAIFlags &= AI_HANDLE_EVERY_FRAME`** (keeps only
  that flag instead of clearing it, quirk); standing on record r's destination with a positive action → queue it; then
  the first record whose required tile is the NPC's tile and that passes TRIGGER_NPC → `TriggerNPCRecord` (already
  there) or `TriggerNPCRecordImmediately`.
- **Turn towards the player**: `NPC_ACTION_FACE_CLOSEST_PLAYER` 2 sets `ubQuoteRecord = r` (not r + 1),
  `QUOTE_ACTION_ID_TURNTOWARDSPLAYER` and handle-every-frame (`Interface_Dialogue.cc:1676-1691`); `DecideActionNamedNPC`
  then faces the closest PC and calls `PCsNearNPC` once one is within 8 tiles (`DecideAction.cc:563-592`). From record 0
  the test `ubQuoteRecord && …` fails and nothing happens (quirk).
- **Unloading mid-walk** (`Strategic/StrategicMap.cc:3140-3191`, = V `StrategicMap.c:4344`): unless traversing, the
  profile gets insertion at the destination and **`ubQuoteRecord = ubQuoteActionID`** (1, not r + 1). At the next load
  (`Tactical/Soldier_Init_List.cc:1683-1691`) the soldier takes these values and `NPCReachedDestination` runs at once
  with r = 0: record 0's after-move action if he stands on record 0's destination, then the tile scan. Keep it.
  (Placement itself, `SaveNPCInformationToProfileStruct` `Tactical_Save.cc:706-730` and traversal belong to `25`.)

### 5.4 NPC-initiated talk

- **`DecideActionNamedNPC`** (`DecideAction.cc:553-638`), called for profiled civilians in real time after the schedule
  (green `:755-779`, yellow `:1100-1113`; ja2-node's `GreenHooks.decideActionNamedNPC`, `docs/09` §5): the
  TURNTOWARDSPLAYER case above; else `NPCConsiderInitiatingConv` → `AI_ACTION_APPROACH_MERC` to that merc's tile; the
  six assassins: closest PC within 8 → hostile list + WAIT 5000, else go as far as possible towards him. Afterwards a
  civilian who spoke within the last 60 s does nothing (`:771-777`).
- **`NPCConsiderInitiatingConv(npc)`** (`NPC.cc:1960-2006`): over `ActiveMercs()` (the merc slots: every soldier in the
  sector, in slot order) on the FRIENDLY side with `bAssignment` < ON_DUTY — soldiers of other teams keep assignment 0,
  so militia qualify too (corrected 2026-10-16) — currently seen by the NPC: the opinion returned by §2.4 with NPC_INITIATING_CONV (0 skips); highest wins,
  ties go to the closer (`PythSpacesAway`). Nothing starts a conversation when the walk ends (no arrival handler for
  APPROACH_MERC, `AIMain.cc:1403`): approach-7 records only bring the NPC to the merc; the talk needs a tile record, a
  turn-towards trigger or the player (inferred from the code; whether any shipped record uses approach 7 is an oracle
  question, §15).
- **Mike** (`Dialogue_Control.cc:433-453`): with `gfMikeShouldSayHi == TRUE` (set by `25`) and an empty queue, Mike
  starts NPC_INITIAL_QUOTE with the soldier on his closest PC's tile, `SAID_FIRSTSEEN_QUOTE`, flag value 2.
- **First sighting** (`OppList.cc:1536-1690`): besides §3.6, CARMEN seeing SLAY (attitude ATTACKSLAYONLY, record 28),
  ANGEL seeing MARIA after the rescue (12) or after leaving the deed (stop, 20), JOE and ELLIOT on first sight outside
  meanwhiles (4, `SAID_FIRSTSEEN_QUOTE`), assassins switching to SEEKENEMY, IGGY on the enemy team (9, publicly heard),
  Kingpin's goons (`25`).
- **`INVOKE_CONVERSATION_MODE`** 232 (`Interface_Dialogue.cc:3543-3565`): no panel → NPC_INITIAL_QUOTE with the soldier
  on the closest PC's tile.

### 5.5 Where else records are triggered (index; the meaning of each is `25`'s)

| Site | What |
|---|---|
| `Overhead.cc:1655, 1699-1703, 1884, 1901, 1910` | escorted EPCs near their goals (MARY 13, JOHN 13/12, SKYRIDER 15, ANGEL 12, JOEY 10) |
| `Overhead.cc:2232, 2312, 2347, 2374, 4686, 5398, 5412` | deaths and attack implications (CARMEN 29, HANS 10, MANNY 10, MARTHA 17, PACOS 18, SLAY 1, PABLO 3) |
| `Overhead.cc:2397, 2417, 2488`; `StrategicMap.cc:1005`; `Explosion_Control.cc:1871`; `Soldier_Ani.cc:3462` | direct `HandleNPCDoAction` calls |
| `Boxing.cc:106-136` | DARREN 21–24 |
| `End_Game.cc:221`; `Meanwhile.cc:450` | `26` |
| `Soldier_Profile.cc:748` | IRA record 0 after recruiting (§9.1) |
| `Soldier_Ani.cc:1010, 1341, 2280, 3081`; `Interface_Dialogue.cc:3032-3042, 3139, 3175, 4625`; `TileEngine/Interactive_Tiles.cc:137`; `AIMain.cc:672, 676`; `Realtime.cc:50-59` | DONE_PUNCH_x, DONE_GIVING_ITEM, Queen DONE_SLAPPED, DONE_OPEN_STRUCTURE, DONE_GET_ITEM, DONE_TRAVERSAL (flag from `StrategicMap.cc:3161-3164`) |
| `Handle_Items.cc:2299, 2360-2369, 3246` | DONE_GIVING_ITEM, BUYSELL, I-hate-you |
| `Assignments.cc:6898`; `Soldier_Control.cc:6918` | EPC_IN_WRONG_SECTOR, first aid |
| `NPC.cc:2640-2665` (`HandleShopKeepHasBeenShutDown`) | Keith 11 / 7 instead of the shop (`23` §9.1) |
| `HandleNPCSystemEvent` (`Strategic_Event_Handler.cc:549-691`) | strategic events, `25` |

### 5.6 UI codes: scripted sequences (`NPC.cc:1748-1801`)

`TURN_UI_OFF` (ignored in combat): `ENGAGED_IN_CONV`, `giNPCReferenceCount = 1`. `TURN_UI_ON`: unless the special count
is non-zero, clear both. `SPECIAL_TURN_UI_OFF` (not in combat): flag, count 1, special count + 1 (a negative one is
first reset to 0). `SPECIAL_TURN_UI_ON`: special − 1; at 0 clear both; below 0 → 0. `DeleteTalkingMenu` clears
`ENGAGED_IN_CONV` only with `giNPCReferenceCount == 0` (`Interface_Dialogue.cc:566-570`), so a UI-off record keeps the
game paused and the UI locked after its panel closes (`Dialogue_Control.cc:328-336` re-locks every frame) until a UI-on
record runs — typically after a scripted walk and a tile trigger. The special count is a function static
(`NPC.cc:1365`): never saved, so a save/load inside such a sequence restarts it at 0 (inferred). The cheat Alt+6 that
clears the flag is not ported.

---

## 6. The talk interface

### 6.1 Who can be talked to (`IsValidTalkableNPC(t, give, mercs, collapsed)`, `Tactical/Handle_UI.cc:4560-4643`)

The selected merc is not a robot; the target is active, alive, not (collapsed when `collapsed`), not a vehicle, and — if
not on our team — visible (`bVisible ≠ −1`). It qualifies if it is an NPC/RPC profile that is neither recruited nor an
EPC; or an EPC (talk mode or giving); or on our team with `mercs`; or a civilian type (§8.1) when not giving; a robot
never for talking. A qualifying target must not be in a moving animation outside combat.

### 6.2 Starting (`HandleTalkInit`, `Handle_UI.cc:4646-4848`; `PlayerSoldierStartTalking`, `Soldier_Control.cc:8535-8621`)

1. A selected merc and a target valid with `(give F, mercs T, collapsed F)`.
2. Target ≠ merc: `DistanceVisible(merc, IRRELEVANT, IRRELEVANT, tile, level)` and
   `SoldierTo3DLocationLineOfSightTest(merc, tile, level, 3, dist, TRUE)`, else refused with a message.
3. Collapsed target → refused with a message.
4. Our own merc (not an EPC): DIMITRI refuses; others bark (§8.6); no AP.
5. A civilian while a civilian box is up → the click only closes the box.
6. `GetRangeFromGridNoDiff(merc, tile)` (`(INT16)hypot`, `TileEngine/Isometric_Utils.cc:356-368`) > `NPC_TALK_RADIUS` 4:
   `FindAdjacentGridEx` and `UIPlotPath` must succeed ("no path"); a sweet spot within 3 tiles
   (`gfNPCCircularDistLimit`) in the merc's movement mode; `EnoughPoints(AP_TALK 6)` — the walk itself is not budgeted;
   pending `MERC_TALK`; walk. On arrival (`X:Soldier.cc:142-146`) `PlayerSoldierStartTalking(…, validate)`: still valid
   with `(F, mercs F, F)` and within 8 tiles; no new LOS test.
7. Within 4: `EnoughPoints(AP_TALK)`, then `PlayerSoldierStartTalking`.

`PlayerSoldierStartTalking`: `DeductPoints(6, 0)`; both soldiers turn to face each other; the merc stops; then a
civilian type → `StartCivQuote` (§8); an escorted EPC (`MERC_TYPE__EPC`) → InitiateConversation(EPC_WHO_IS_RECRUITED); a
neutral assassin → close panel, cancel his action, hostile list; another neutral → NPC_INITIAL_QUOTE; a non-neutral →
ENEMY_NPC_QUOTE. In turn-based combat this works on our turn like any action (the moving test is skipped in combat).

### 6.3 Opening (`Interface_Dialogue.cc:192-329`)

`InitiateConversationFull`: with an empty queue and nobody talking → open now; otherwise store a pending conversation
(object copied by value), set `ENGAGED_IN_CONV` and the talking-menu UI mode; `HandleDialogue` opens it once the queue
is empty and silent (`Dialogue_Control.cc:275-278`, `HandlePendingInitConv` `:239-248`). Opening: close any open panel;
create the panel (fails without a face file → abort, clearing the flag when pending); set `gpSrcSoldier`,
`gpDestSoldier`, `gubSrcSoldierProfile` (NO_PROFILE without a talker); a talker of ours on our turn → his squad becomes
current and he is selected; `ConverseFull(panel NPC, talker profile, approach, record, object)`; `ENGAGED_IN_CONV` and
the talking UI mode.

### 6.4 The menu (`:139-147, 626-900`)

Six entries — Repeat, Friendly, Direct, Threaten, Buy/Sell (labelled with the dealer type for dealers, "Give"
otherwise), Recruit — plus the name ("who are you?"). Disabled while the face talks or the queue is not empty. A click:
Buy/Sell on a dealer → an unused BUYSELL record is triggered, else the panel closes and the shop opens (no further AP;
`23` §9); "Give" → §4.1; the others → `Converse(npc, talker profile, approach)`. Clicking the face or Backspace skips
the current line (presentation).

### 6.5 Closing

- **Done / Esc** (`HandleTalkingMenuEscape`, `:956-1010`): while talking, Done only stops the line; with an empty queue
  → `DeleteTalkingMenu` and the once-per-conversation reset for the panel NPC.
- **`DeleteTalkingMenu`** (`:512-619`): stop speech, remove the UI, panel closed, the NPC's `SOLDIER_ENGAGEDINACTION`
  cleared, `ENGAGED_IN_CONV` cleared if `giNPCReferenceCount == 0`. Then, if `FACT_NEED_TO_SAY_SOMETHING` and the queue
  is empty and no trigger waits: the nice NPC (preferred) or the nasty one, if his soldier exists → a merc within 10
  tiles with LOS says 58 (`QUOTE_LISTEN_LIKABLE_PERSON`, filtered by gender) or 39 (`QUOTE_ANNOYING_PC`), picked by
  `Random(n)` (`Dialogue_Control.cc:1386-1471`); both profiles and the fact are reset even if no merc qualified, but only
  when the NPC's soldier exists (otherwise nothing changes).
- **Other closers:** queued `NPCClosePanel`, scripted walks, the
  recruit/requestor/close/enter-combat/friendly/shop/lie/marry actions, `ChangeSoldierTeam` (`Soldier_Profile.cc:593`),
  triggers with dialogue (§5.2), our first sighting in a virgin sector (`OppList.cc:2408-2413`), other menus opening
  (`Interface_Control.cc:578-584`), a boxing match (`Boxing.cc:79`), Esc in a meanwhile (`26`). None of these resets
  once-per-conversation records.

### 6.6 While engaged in conversation

- `HandleDialogue` notices the flag: on → `PauseGame` + `LockPauseState(14)`; off → unlock, unpause, end the UI lock
  (not during boxing round ends) and lock again if it is not our turn (`Dialogue_Control.cc:282-326`). World clock and
  real-time turns stop (`15` §1.5); tactical frames continue (animations, ordered movement, bullets, the queue).
- No real-time AI decisions (`Realtime.cc:204`, `AIMain.cc:1158`); neutrals get no new situation (`AIMain.cc:1993`); no
  RPC sector description (`Tactical_Turns.cc:28`); no faint-noise quote (`OppList.cc:4253-4261`); leaving combat skips
  the strategic implications (`Overhead.cc:4095-4099`); in turn-based combat SERGEANT, MIKE and JOE skip their AI while
  a panel is open, a trigger waits or the queue is not empty (`AIMain.cc:279-284`).

### 6.7 NPC request boxes (`StartDialogueMessageBox`, `:4163-4234`; `DialogueMessageBoxCallBack`, `:4237-4504`)

These actions close the panel and open a modal box. The requestor group (`:2147-2171`) refuses (error log, no box)
unless the acting NPC is `gpDestSoldier`; the callback always uses `gpDestSoldier`'s profile.

| Action | Box | Yes | No |
|---|---|---|---|
| 110 `ASK_ABOUT_ESCORTING_EPC` | escort him (JOHN/MARY while the other lives: both) | §9.3 | nothing |
| 120, 212 `ASK_ABOUT_PAYING_RPC(_WITH_DAILY_SALARY)` | hire for `$sSalary` | record 1 | record 0 |
| 181 `REDUCE_CONRAD_SALARY_CONDITIONS` | first sets Conrad's salary to 3300 (`:2144-2146`) | 1 | 2 |
| 135 `DARREN_REQUESTOR` / 207 `FIGHT_AGAIN_REQUESTOR` | fight? | 13 / 30 | 12 / 12 |
| 144 `BUY_LEATHER_KEVLAR_VEST` | jacket price | 27 | 28 |
| 161 `MEDICAL_REQUESTOR` | pay `CalcMedicalCost − refund` ($10 when the refund exceeds it) | 23 (Vince or Steve) | 24 |
| 162 `MEDICAL_REQUESTOR_2` | free care | 26 / 25 by the wounded facts, Vince: `temp = 0`; Steve: **Vince's** balance = 0 | Vince 34, Steve 30 |
| 169 `BUY_VEHICLE_REQUESTOR` | $10000 | GERARD 9 | 8 |
| 183 `KROTT_REQUESTOR` | spare Krott | SERGEANT 7 | 6 |
| 226 `TRIGGER_MARRY_DARYL_PROMPT` | marry? (talker flagged `ASKED_BY_HICKS` either way) | Daryl's `bNPCData` = talker, key 38 into Daryl's inventory, 11 | 12 |
| 221 `PROMPT_PLAYER_TO_LIE` | yes / no / lie; remembers record r | r + 1 | r + 2; lie: the in-sector merc (≥ OKLIFE, ≥ OKBREATH) with the best `EffectiveWisdom + EffectiveLeadership` — the code adds the *candidate's* leadership on both sides, so it ranks by wisdom — `SkillCheck(LIE_TO_QUEEN_CHECK) ≥ 0` → r + 4, else r + 3 (`26`) |

Both medical branches close the panel again after the trigger.

---

## 7. The dialogue queue (`Tactical/Dialogue_Control.cc`)

### 7.1 Structure and cadence

A FIFO of events (`:110`); `DialogueEvent::Add` appends (`:469-480`). `HandleDialogue` (`:266-466`) runs once per frame
at the end of the game screen loop, after `ExecuteOverhead` (`GameScreen.cc:427, 518-521`):
1. a paused queue → return;
2. empty and nobody talking → `HandlePendingInitConv`;
3. `HandleCivQuote` (box timeout, §8.4);
4. `ENGAGED_IN_CONV` transitions and the UI lock (§6.6);
5. a face still talking → return; a face that has finished → its flags: `FACE_PCTRIGGER_NPC` → count − 1 and
   `TriggerNPCRecord`; `FACE_MODAL` → end modal tactical; `FACE_TRIGGER_PREBATTLE_INT` → `InitPreBattleInterface`
   (`19`); clear the current face; undo a map-screen pause;
6. empty → the Mike check (§5.4); return;
7. the head: in auto-bandage mode it is dropped unexecuted; else `Execute()`; `false` → pop, `true` → keep for the next
   frame.

So one event starts per frame, and a quote holds the queue for its duration through the talking face. ja2-node runs
`handleDialogue` once per 5 ms tick after the tactical step; "a face is talking" is `speechBusyUntil > tick`.

### 7.2 Quote events (`CharacterDialogue`, `:612-682`; `ExecuteCharacterDialogue`, `:719-826`)

Execution: `delayed` and not our team's turn → keep; the speaker on our team with a battle sound playing → keep
(ja2-node: never, battle sounds are presentation); on the map screen and not paused → pause + lock 15; a sleeping
speaker is woken and a "back to sleep" event is queued (`:489-514`); `ubLastQuoteSaid/ProfileNUm` recorded; then the
speaker must exist if the quote is from a soldier; a speaker on our team must be ≥ CONSCIOUSNESS, not gassed, not a
robot, ≥ OKLIFE unless the quote is `SERIOUSLY_WOUNDED`, not a POW; asleep with NEED_SLEEP or OUT_OF_BREATH → silently
done; no text (§1.5) → done; else the face talks for the duration and, for our team, the stop-time quotes (booby trap,
suspicious ground) fire.

Before queueing a merc line (`TacticalCharacterDialogue`, `:543-595`; `CanSayQuote`, `:517-531`): profile, life
(CONSCIOUSNESS for SERIOUSLY_WOUNDED, else OKLIFE), not a robot (a robot's line goes to its controller), not gassed, not
a POW, not in a meanwhile, not the exact profile + quote just said, an EPC only with `FORCENPCQUOTE`; the bleeding "me
too" swap.

NPC lines in a conversation go through `TalkingMenuDialogue(q)` (`Interface_Dialogue.cc:937-945`):
`CharacterDialogue(**panel NPC**, q, panel face, NPC_UI, fromSoldier FALSE)`. The speaker is the panel's NPC, not the
record's: in the "other NPC" branch of §5.2 (reachable for a quote-0 record, since quote 0 does not close the other
panel) another NPC's quote numbers are spoken by the panel NPC (quirk, inferred to be rare).

### 7.3 Event kinds

| Event | Queued by | Effect when executed |
|---|---|---|
| quote | `CharacterDialogue`, `TalkingMenuDialogue` | §7.2 |
| close panel | `NPCClosePanel` (`NPC.cc:1311-1314`) | `DeleteTalkingMenu` |
| give item | `TalkingMenuGiveItem` (`:1317-1341`) | §4.5 |
| trigger NPC | `NPCTriggerNPC` (`:2078-2104`) | §5.2 |
| goto | `NPCGotoGridNo` | §5.3 |
| do action | `NPCDoAction` (`Interface_Dialogue.cc:1185-1209`) | `HandleNPCDoAction` (§7.5) |
| PC line then trigger | `TriggerClosestMercWhoCanSeeNPC` | §5.1 |
| sleep | quote of a sleeping merc | `fMercAsleep` restored |
| alternate-file quote | `CharacterDialogueUsingAlternateFile` (`:685-711`) | RPC sector description (§8.6) |
| remove EPC | `InternalUnescortEPC` (`Strategic/Assignments.cc:6851-6868`) | clear `FORCENPCQUOTE`, `UnRecruitEPC` (§9.4) |
| others (owner) | contracts (`Merc_Contract.cc:173, 550`; `22`), stat change text (`Campaign.cc:587`), arrival flag (`Merc_Hiring.cc:300`; `21`), shop (`ShopKeeper_Interface.cc:3099-4109`; `23`), end game (`End_Game.cc:195, 322`; `26`), item locator (`Overhead.cc:6165`), battle sound (`Soldier_Control.cc:6070`), unpause AI (`Merc_Entering.cc:801`) | |

### 7.4 What is presentation and what is state

| Item | Kind |
|---|---|
| text, faces, subtitles, speech files, locator, camera, map-screen messages | presentation (events with text keys, §11.5) |
| speech duration (12 ticks per character, then 60 ticks) | state: it holds the queue and delays everything behind it |
| `ubLastQuoteSaid/ProfileNUm` in `gTacticalStatus` | state (skips immediate repeats) |
| waking a merc to talk and putting him back to sleep | state |
| stop-time quotes | state (stop compression, `15`) |
| facts, quests, `SAID` flags, money handling, the object taken from the merc | state, at selection, before any line is heard |
| actions, gives, walks, triggers, panel closes | state, when the queue reaches them |
| panel open, pending conversation, trigger wait, `ENGAGED_IN_CONV`, reference counts | state |

### 7.5 Dispatch of NPC actions

`HandleNPCDoAction(npc, code, record)` (`Interface_Dialogue.cc:1571-4062`) runs when its queue event executes — after
every event queued before it, including the quotes of the same record unless the action is a face-a-profile one (§3.4
step 1). Direct calls bypass the queue (§5.5). Codes 501–649 face profile `code − 500` if both soldiers exist
(`:1576-1590`); everything else reads `GCM->getNpcActionParams(code)` (gridNos and amounts from
`J:tactical-npc-action-params.json`, `X:DefaultContentManager.cc:241-248, 1248-1252`) and switches; an unknown code only
logs.

**Index of action ids** (`Interface_Dialogue.h:85-342`; the per-action catalog is `25`'s): 1–44 behaviours of the
speaker (1 `DONT_ACCEPT_ITEM`, 2 face closest player, 3 open closest door, 4 `RECRUIT`, 5–9 gun and running, 10–11
loyalty, 12 stop first aid, 13–20 face a direction, 21 `TRIGGER_FRIEND_WITH_HOSTILE_QUOTE`, 22 `BECOME_ENEMY`, 23
`RECRUIT_WITH_SALARY`, 24 `CLOSE_DIALOGUE_PANEL`, 25 `ENTER_COMBAT`, 26–44 story behaviours: terrorist, cabinets, slaps,
punches, Queen triggers, shoot Elliot, say-later 39/44, `INITIATE_SHOPKEEPER_INTERFACE` 41, wheelchair); 50–54 grant
experience; 100–298 story actions (among them 103–106 traverse, 110 escort prompt, 120/212 pay prompt,
135/144/161/162/169/183/207/221/226 requestors, 149 `UN_RECRUIT_EPC`, 150 `TELEPORT_NPC`, 166/167 end combat, 168
`SET_EPC_TO_NPC`, 170 `END_MEANWHILE`, 232 `INVOKE_CONVERSATION_MODE`, 264 `REMOVE_NPC`, 265–291 and 294 history
entries); 500 face the nearest merc; 501–649 face a profile.

Actions this spec defines because they are dialogue mechanics: 1 (§4.4), 4/23 (§9.1), 21/22/25/166/167 (§3.6), 24
(close), 39/44 (§6.5), 41 (`23` §9.1: `HandleShopKeepHasBeenShutDown` first, then close and shop), 110/120/181/212 and
the requestors (§6.7), 149/168 (§9.4), 150 (§3.4), 232 (§5.4), 500+ (§7.5).

---

## 8. Civilian quotes and other barks

### 8.1 Who barks (`GetCivType`, `Tactical/Civ_Quotes.cc:221-281`)

Profiled soldiers never (NA). In F10 a female civilian of group 0 not on our team is `MARRIED_PC`. Enemy-team soldiers
with a merc body are `ENEMY`. Other teams than CIV and MILITIA are NA; then by body: REGMALE, BIGMALE, STOCKYMALE,
REGFEMALE, FATCIV, MANCIV, MINICIV, DRESSCIV, CRIPPLECIV → ADULT; HATKIDCIV, KIDCIV → KID; everything else NA. Talking
to one costs `AP_TALK` and turns both (§6.2) but opens no panel and sets no engaged flag; it calls `StartCivQuote`
(`:692-758`).

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

The sector's hint array (§1.4; none → −1); the first record passing `NPCConsiderQuote(NO_PROFILE, NO_PROFILE,
APPROACH_NONE, i, 0)` — so only records with approach 0 and opinion 0 or 255; facts are checked with profile 200;
`MUST_BE_NEW_DAY` degrades to "day ≥ 254" without a profile. With `set_as_used` the record gets `SAID`; in **both**
calls `ubStartQuest` is started, so a hint's quest starts as soon as any civilian of the sector is asked, even if the
hint is then dropped or the civilian is a kid, and again on every ask while it stays unsaid (`StartQuest` puts a
finished quest back in progress, `Quests.cc:1105-1120`). Hint text: row = the record's quote in `npcdata/<sector>.edt`
(underground: `civ35.edt`), 160 units per row (`:122-147`).

### 8.4 Entry and box (`StartCivQuote`, `:692-758`; `BeginCivQuote`, `:315-385`)

A civilian whose `bCurrentCivQuote` is 99 (he gave a hint last time) resets it to −1 and decides without hints. A line
without text opens no box (`BeginCivQuote` returns after the text lookup), so nothing is shown and a surrender offer
never gets its question; the entry still advances.
Otherwise hints are allowed. For a non-hint type: if `bCurrentCivQuote == −1` → `Random(entries − 2)`, delta 0; entry =
base + delta; after showing, delta alternates 0, 1. The base is kept when the type later changes (inferred: an entry
past a shorter type's rows has no text and shows nothing). A hint stores 99 and the entry. The box replaces any open
one, lasts `FindDelayForString + 500` ms or until clicked after 300 ms (`:181-206, 679-690`), and hint text also goes to
the map-screen log. Save section 38 is 100 bytes, skipped both ways (`:770-779`).

### 8.5 Enemy surrender offer

`DecideActionBlack` (`DecideAction.cc:2641-2654`): an enemy-team soldier, visible, `ENEMY_OFFERED_SURRENDER` not yet
set, life ≥ lifeMax / 2, no militia team active, fewer than 4 PCs in the sector, enemies ≥ 3 × PCs, and HELD_IN_ALMA not
started (or done with INTERROGATION not started) → set the flag, `AI_ACTION_OFFER_SURRENDER`, executed as
`StartCivQuote(soldier)` (`AIMain.cc:1818-1821`) → type 37. When the box closes, a yes/no box: yes → capture sequence
(every in-sector living merc captured and removed, `gfSurrendered`, a 3 s capture timer); either way `ActionDone`
(`Civ_Quotes.cc:150-206`). Capture and the Alma quest are `25`'s. ja2-node today executes the action as a no-op
(`src/sim/tactical/ai/control.ts:408-409`).

### 8.6 Other barks

- **RPC sector descriptions** (`Strategic/StrategicMap.cc:346-422`, `Tactical/Tactical_Turns.cc:20-77`): entering a
  listed sector the first time sets `SF_HAVE_USED_GUIDE_QUOTE` and a countdown `4 + Random(5)` real-time turns
  (implemented with the civilian slice: `src/sim/campaign/narrative/guide-description.ts`); the countdown is checked at
  sector entry and each real-time turn
  (`Tactical_Turns.cc:157`), only on the tactical screen and not while engaged in conversation; SAM sites set it to 1
  and speak at the next check even in combat, other sectors wait out combat and enemies; at 0 a recruited IRA, MIGUEL,
  CARLOS or DIMITRI standing in that sector, picked by `Random(n)`, says the description from his alternate file. No
  other state.
- **Talking to our own merc** (`Handle_UI.cc:4703-4766`): `Random(3)` (non-normal attitude) or `Random(2)`, forced 0 for
  I.M.P. characters → 41 `NEGATIVE_COMPANY`, 45 `PASSING_DISLIKE` (if he has one), 44 `SOCIAL_TRAIT`; IRA always 45.
  Cosmetic.
- **Say-later** lines at panel close (§6.5); the PC line before Miguel's record (§5.1).

---

## 9. Recruiting RPCs and EPCs

### 9.1 RPCs

The scripts drive it: a record (typically requiring RECRUIT and an opinion) whose action is
`ASK_ABOUT_PAYING_RPC(_WITH_DAILY _SALARY)` opens the hire box (§6.7); its answer triggers record 1 or 0, which carry
`RECRUIT_WITH_SALARY` or a refusal (the data's design, inferred). `NPC_ACTION_RECRUIT` 4 sets `sSalary = 0` and falls
into `RECRUIT_WITH_SALARY` 23 (`Interface_Dialogue.cc:1834-1854`): close the panel; `PlayerTeamFull()` (more than
`bLastID − 2` = 17 mercs on our team, `Overhead.cc:4816-4825`) → message only; else `RecruitRPC` and a message.

`RecruitRPC(p)` (`Soldier_Profile.cc:685-768`), in order: the NPC's soldier must exist; `RECRUITED`;
`ChangeSoldierTeam(s, OUR_TEAM)` (§9.2); SLAY: `iEndofContractTime = now + 7 days`, out of the wheelchair; DYNAMO with
FREE_DYNAMO in progress → `EndQuest` in his sector; `HandleTownLoyaltyForNPCRecruitment` (`docs/18`, exists as
`handleTownLoyaltyForNpcRecruitment`); the current squad, else any squad; dead-squad list reset; an empty hand gets the
first weapon from the inventory (a two-handed one first moves the second-hand item away); IRA → `TriggerNPCRecord(IRA,
0)`, which now reads his `000.npc` copy; kind `MERC_TYPE__NPC`; history `HISTORY_RPC_JOINED_TEAM` (23) in his sector;
off the personnel departed list (`21`); the Lua hook `OnRPCRecruited` (not ported). No contract and no payment: the
daily `sSalary` is charged at 00:00 (`22` §4.8). The swap of his records to `000.npc` happens at the next touch (§1.4).

### 9.2 `ChangeSoldierTeam(old, team)` (`Soldier_Profile.cc:591-682`)

Closes the panel; leaves the SM panel if it shows him; removes the old soldier; creates a new one on `team` with
profile, body, sector and direction (vehicles keep their vehicle id) through `TacticalCreateSoldier`, which makes its
creation draws (deviation "Soldier creation draws", `06`); copies life, max life, the ten stats, visibility values,
camouflage (palettes rebuilt), level and height, all 19 inventory slots; our team → visible; attackers retarget;
insertion tile = the old tile; death bookkeeping if this happens during a death; with the world loaded and the old
soldier in the sector, the new one is placed with the old animation and looks (`HandleSight(LOOK | RADIO)`); `RECRUITED`
set for `OUR_TEAM`, cleared otherwise. The new soldier gets an id in the new team's block, so every reference by soldier
id (talk session, prompts) must follow the profile.

### 9.3 EPCs

`ASK_ABOUT_ESCORTING_EPC` 110 → box (§6.7) → yes (`Interface_Dialogue.cc:4246-4288`): close the panel; team full →
message; JOHN while MARY's soldier exists and our team has more than `bLastID − 3` = 16 mercs → message (two places
needed); `RecruitEPC(p)` (`Soldier_Profile.cc:770-813`: soldier must exist; `EPCACTIVE`; clear
`PERMANENT_INSERTION_CODE`; `ChangeSoldierTeam(OUR_TEAM)`; kind `MERC_TYPE__EPC`; current or any squad; dead-squad list;
a robot updates its controller); message with his squad; his squad becomes current; `HandleStuffForNPCEscorted`
(`:1493-1544`): SKYRIDER → `FACT_SKYRIDER_EVER_ESCORTED` and ESCORT_SKYRIDER started if not started; JOHN or MARY → the
other is recruited too and ESCORT_TOURISTS starts. EPCs then: no contract menu (`22` §1.1), the sector-exit rules
(`src/sim/campaign/sector-exits.ts`), lone EPCs die in autoresolve (`19`), silent in tactical unless forced (§7.2),
talked to with EPC_WHO_IS_RECRUITED.

### 9.4 Releasing an EPC

- **By script** — `UN_RECRUIT_EPC` 149 / `SET_EPC_TO_NPC` 168 (`Interface_Dialogue.cc:2586-2623`): ANGEL is redirected
  to MARIA; `UnRecruitEPC`; MARY and JOHN release each other; SKYRIDER from record 15 → `fUseProfileInsertionInfo =
  FALSE` (map placement at the airport); JOEY from record 9 → insertion tile 18326; JOHN/MARY from record 13 → both
  profiles lose their sector (they vanish once the sector unloads).
- **`UnRecruitEPC(p)`** (`Soldier_Profile.cc:816-840`): the soldier must be an EPC; on a squad → dead-squad list; clear
  `EPCACTIVE`; profile sector = his sector; `PERMANENT_INSERTION_CODE`; insertion GRIDNO at his tile; use profile
  insertion; `ChangeSoldierTeam(CIV_TEAM)` (clears `RECRUITED`).
- **By the player** (assignment menu "un-escort", `Strategic/Assignments.cc:6872-6900`): on the map screen
  `InternalUnescortEPC` for him and his JOHN/MARY partner (`:6837-6869`): profile insertion data from the soldier; if a
  record passes EPC_IN_WRONG_SECTOR (`GetInfoForAbandoningEPC`, `NPC.cc:2351-2366`) → `FORCENPCQUOTE`, he says that
  record's quote and its fact is set (nothing else of the record runs; it is not marked said); queue the remove-EPC
  event. In tactical: `TriggerNPCWithGivenApproach(EPC_IN_WRONG_SECTOR)` — the record decides.

### 9.5 RPCs leaving

Dismissal and quitting are `22` §4. Nothing clears `RECRUITED` except `ChangeSoldierTeam` to another team, so a departed
RPC keeps it (inferred): profile insertion skips recruited profiles (`Soldier_Init_List.cc:1659`) and his backup records
are never restored (§1.4) — he does not come back.

### 9.6 Implementation notes (verified with the oracle, 2026-10-16)

- `ChangeSoldierTeam` creates the new soldier through `TacticalCreateSoldier`: for a profiled soldier its draws are the
  female or kid battle sound (`Random(2)`), the standing frame of `CreateSoldierCommon` (`Random(10)`) and, for our team,
  the cosmetic face draws of `InitSoldierFace` (dropped, deviation "Cosmetic face and frame draws"); the pathfinder draws of
  the placement's sweet-spot search are not made (deviation "Pathfinder RNG"). Not copied, so fresh: breath (99), bleeding
  (0), morale, orders, attitude, the key ring, quote record and action. The new soldier is placed at the old tile with the
  old animation and direction only when the old one stood in the loaded sector; otherwise it is created (with its draws)
  and left off the map, where the original keeps it as an inactive-in-sector civilian of the loaded world (inferred
  harmless; ja2-node does not keep it). The id is the first free slot of the new team: for our team every merc of the
  roster counts, wherever he is; for the civilians the soldiers of the loaded sector and the away (off-map) civilians of
  the schedules (`RecruitFlow.reservedSoldierSlot`, a port for the schedules slice).
- `RecruitEPC` of a soldier already on our team (John's partner when both were escorted) rebuilds him like any team change.
- `UnRecruitEPC` writes the soldier's current tile into the profile insertion data, also for an escort outside the loaded
  sector (his last tile there, as in the original, whose `sGridNo` survives leaving the sector).
- The map-screen path of §9.4 queues the abandoning quote and the remove-EPC event; ja2-node runs that queue at once in the
  `unescort` command (the clock does not move on the map screen without compression).
- `HandleStuffForNPCEscorted` also prints `NOW_BING_ESCORTED_STR` for John's or Mary's partner.

---

## 10. Determinism

### 10.1 Draws, in order of appearance

| Where | Draw | Stream |
|---|---|---|
| §3.3 friendly default | `Random(2)`: quote 2 or 3, remembered in `ubLastQuoteSaid` | main (the result is stored, §16 decision 4) |
| §3.6 hostile list | `Random(n)` among speakers with a declaration | main (decides whose record runs) |
| §3.6 civilian-group side change | `Random(2)` per further member with a profile (short-circuit after the first) | main, drawn although unused |
| §3.6 draws first | two `Random` in `NPCFirstDraw` | main (the `attack` command's pre-check) |
| §5.1 closest merc who sees the NPC | `Random(n)` | speaker only → not drawn (precedent: deviation "Cosmetic draws in strategic movement") |
| §6.5 say-later speaker | `Random(n)` | not drawn |
| §6.7 lie | `SkillCheck`: `PreRandom(100)`, then the silent-curse `Random(100)` on failure (`11` §8.5) | pre; curse not drawn (deviation "Cosmetic draws in attacks") |
| §8.2 hint drop | `Random(100) < 25`, only when a hint exists, loyalty is low and he is no miner | main (decides whether the hint is used up) |
| §8.4 civilian entry | `Random(entries − 2)` | cosmetic stream (stored in the soldier, text only) |
| §8.6 own-merc bark, RPC description speaker | `Random(3)`/`Random(2)`, `Random(n)` | not drawn |
| §9.2 team change | `TacticalCreateSoldier` draws | main, in creation order |
| selection, desire, money, triggers, queue | none | |

### 10.2 Wall clock and frames

| Original | ja2-node |
|---|---|
| one queue event per frame | one per 5 ms tick, after the tactical step |
| speech: audio length, or 60 ms per character, then 300 ms with the mouth closed | 12 ticks per character of the decoded quote, then 60 ticks; a voice that ends earlier leaves only the 60 ticks through `skipLine {voiceEnded}` (existing deviation "Speech") |
| a click or Backspace stops the face (`ShutupaYoFace`, `StopAnyCurrentlyTalkingSpeech`), the queue moves on | `skipLine`: the face finishes in the command, the next event runs on the next tick; every viewer gets `lineCut` and ends the line too (`04` §6.37) |
| quote waits while the speaker's battle sound plays | never waits |
| trigger wait 500 ms (`GetJA2Clock`) | 100 ticks of tactical time |
| `uiTimeSinceLastSpoke` + 60 000 ms | tactical game milliseconds (12 000 ticks) |
| AI pause 1500 ms (`Overhead.cc:118, 450-469, 496-503`) | 300 ticks |
| civilian box 300 ms / text delay | presentation; the surrender prompt opens at once |
| frames run while the menu waits for a click | nothing runs while a session is idle (§11.6) |

Ordering: record scans by index; the hostile list in insertion order; mercs in soldier id order (`FOR_EACH_IN_TEAM`,
`ActiveMercs`); the queue FIFO.

---

## 11. Agent API (D15, D16)

A conversation is a **talk session**, a modal flow like the shop (`23` §13): while it is open only talk commands,
queries and `observe` are accepted and nothing advances unless the queue is busy.

### 11.1 Commands

| Command | Semantics |
|---|---|
| `talk {soldier, target}` | `target` = a soldier id, or `{npc: profile id or name}`. Checks, first failure is the reason: tactical flow; no prompt, shop or session open (`sessionOpen`), not in a scripted sequence (`scriptedSequence`); the soldier can act (`canAct`, `10`); `noSuchTarget`; §6.1 (`notTalkable`, `targetHidden`, `targetMoving`, `talkerIsRobot`); `noLineOfSight`; `targetCollapsed`; our own merc → a bark, no AP (`refusesToTalk` for DIMITRI); beyond 4 tiles `noPath`, `notEnoughAP` (6 only) → a walk-up order, the talk starts on arrival (§6.2 step 6; failing → event `talkAborted`); within 4 `notEnoughAP`. Effects: §6.2. Result: a civilian or merc bark (`data.civQuote {soldier, quote, entry, hint, textKey} | null` and the `civQuote` event, or
`data.bark` and `mercQuote`), or the talk reply `{conversation, pending?, scriptedSequence?, shop?, npcRequest?}` at once, `pending: true` while lines are queued (§11.6) |
| `approach {kind}` | `repeat`, `friendly`, `direct`, `threaten`, `recruit`, `whoAreYou`; `buySell` (dealers: BUYSELL record or the shop session) or `give` (others: closes the session, the NPC waits 10 s). Refusals: `noConversation`, `busy`, `notADealer`, `isADealer`. Runs `Converse` and returns the talk reply; the lines follow in the next ticks |
| `give {soldier, target, slot, count?}` or `{soldier, target, money, slot?}` | §4: inside a non-dealer session it closes first (the "Give" entry, `isADealer` otherwise); `slot` hands over the whole pocket or, with `count: 1`, one item of a stack; `money` splits that amount (steps of 10) off a money pocket. Checks: tactical, prompt, shop, scripted sequence, `busy`, `canAct`, `noSuchTarget`, the giver (`giverCannotGive`, `giverBusy`), the object (`needItemOrMoney`, `noSlot`, `emptySlot`, `badCount`, `badMoney`, `notEnoughMoney`), §6.1 with `give` and own mercs allowed (the alternative cursor), `robotReload`, `noPath`, `notEnoughAP` (path + 1). Returns `{walking, to}` or `{giving}` at once; the walk, opcode 486 and §4.1's branches run during `advance`, with an NPC target the conversation it opens (*implemented*, `docs/04` §6.16) |
| `closeTalk {}` | Done or Esc (§6.5) including the once-per-conversation reset; with nothing queued it cuts the NPC's line short (`DeleteTalkingMenu`). `noConversation`, `busy` |
| `skipLine {profile?, tick?, voiceEnded?}` | Cuts the line being said short (Backspace, a click on the face); with `profile` and `tick` only that line; `voiceEnded` leaves its final 300 ms. Event `lineCut`. `data.skipped`. Accepted in every state |
| `unescort {soldier}` | §9.4 by the player: map screen → the abandoning quote and the release at once, `{released: [{profile, quote}], lines}`; tactical → the wrong-sector record, the talk result plus `triggered`. Refusals `noSuchSoldier`, `notAnEpc`, `notInSector`, `notAvailable` and the modal ones (`docs/04` §6.17). *Implemented* |
| `openShop {dealer, soldier}` | from M6 = `talk` + `approach buySell` in one command: the shop at once when the opening says nothing, otherwise the talk reply and the shop opens when the opening lines end, unless the script closed the panel, a prompt opened or a BUYSELL record plays (§16) |
| `answer {prompt, choice}` | `npcRequest`: `yes`/`no` (`lie` too for the lie prompt); `surrender` (`context: 'tactical'`): `accept`/`reject` |

### 11.2 Prompts

- **`conversation`** — the session itself when an NPC opened it (any `InitiateConversation` not caused by
  `talk`/`give`): `advance` stops with reason `decision`; answered by `approach`, `give` or `closeTalk`.
- **`npcRequest {id, request, npc, name, merc?, amount?, pair?, choices}`** — the requests of `25` §13.2 (`escort`, `hire`,
  `boxingBet`, `fightAgain`, `buyVest`, `payDoctor`, `freeTreatment`, `buyVehicle`, `spareKrott`, `marryDaryl`, `lie`),
  shown as `observe.npcRequest` (`docs/04` §6.14). Time stands still until answered. *Implemented with the action catalog
  (2026-10-16).*
- **`surrender {context: 'tactical'}`** — §8.5; the existing autoresolve prompt kind with a context field.

### 11.3 Events

`conversationOpened {npc, profile, talker, initiatedBy: 'player'|'npc'}`, `conversationClosed {npc, by:
'player'|'script'}`, `npcQuote {profile, soldier, quote, record?, textKey, chars}` (`record` when a record said it),
`mercQuote` (exists) for merc lines, `civQuote {soldier, quote, entry, hint, textKey, chars}` (`quote` is the civilian
quote type), `surrenderOffered {soldier, prompt}`, `npcMessage {kind, profile?,
amount?, squad?}` for the screen messages (`balanceOwed`, `needsMoney`, `paidInFull`, `stillOwed`, `recruited`,
`teamFull`, `nowEscorted`, `noLineOfSight`, `targetCollapsed`, `noPath`, `itemPlacedOnGround`, `itemGiven`),
`npcTookItem {npc, profile, from, item, count, status, money?}`, `npcGaveItem {npc, profile, to, item, …, dropped}`, `itemReturned {to, item, …, dropped}`, `itemGiven {soldier, target, item, …, dropped}`, `giveAborted {soldier, target, reason, dropped}` (implemented with the give slice), `npcRecruited
{profile, soldier, kind: 'rpc'|'epc', salary}`, `epcReleased {profile, soldier}` (the new civilian soldier in the loaded
sector, else null), `npcHostile {soldier}`, `scriptedSequence
{active}`, `talkAborted {soldier, reason}`; quests surface only as `historyAdded` (`25`). No events for record choice,
facts, quest states, `SAID` flags, desire or opinions.

### 11.4 Observation (D16)

`observe.conversation` while a session is open: `{npc, profile, name, talker, initiatedBy, menu: ['repeat', 'friendly',
'direct', 'threaten', 'buySell:<dealer type>' | 'give', 'recruit'], lastQuotes: [{quote, textKey, text?}]}`, plus any
open prompt. Outside a session visible soldiers carry `talkable: 'npc' | 'epc' | 'civilian'`, and profiled ones their
profile and name (inferred: the original shows names on hover). Hidden: desire and its inputs, approach values and bits,
opinions, records and their conditions, facts, quest states, the NPC's profile inventory and cash, balances beyond what
a message printed, the last date spoken to, the hostile list.

### 11.5 Text at runtime

- The simulation emits `textKey {file, row, width}` and `chars`; text never enters simulation state, saves, the command
  log or stored event logs.
- A server-side `TextService` (Node layer) resolves keys through the VFS: the user's EDT files under `$JA2_DATA_DIR`
  (decoder `src/content/formats/edt.ts`, §1.5, language by the resource version) or the stub pack's compiled EDTs. View
  frames and MCP responses attach `text` when it resolves; the browser can ask `GET /api/text?file=…&row=…`
  (token-protected like `/vfs`).
- The quote lengths the simulation needs (`chars`, §1.5) come from the content loader as a memoized function over the
  same files: numbers only, computed at runtime, never committed. A missing row has length 0 and is silent.
- Tests never embed original text: unit and scenario tests use stub EDTs; original-data tests assert keys, counts and
  lengths; snapshots drop `text`.

### 11.6 Time

- A talk command runs its step and returns at once (`docs/04` §6.37). The queue runs in the ticks that follow, like the
  original's frames: tactical ticks (speech, one event per tick, walks already ordered) with the world clock paused and
  AI decisions frozen (§6.6). In real time those are the ticks the player watches, so an NPC that acts after its lines
  acts when the player sees them end; an agent runs them with `advance`, which stops with `decision` once the panel
  waits for a choice (or waits for real time when a viewer drives it).
- `skipLine` ends the current line in the simulation: the client sends it when the player cuts a line short and when a
  voiced line's voice ends (`voiceEnded`: the final 300 ms still run); every viewer ends the line on `lineCut`.
  `setSpeech skip` (a session setting for agents) ends every line on the tick after it is said.
- An idle open session stops time: `advance` returns `refused` with `conversationOpen`.
- A scripted sequence (`ENGAGED_IN_CONV` without a panel, a pending conversation, a trigger wait): player commands are
  refused with `scriptedSequence`; `advance` runs ticks until it ends, a panel opens (`conversation` decision) or a
  prompt opens. Saving is refused throughout (§0).

---

## 12. Data tables, original data and stubs

### 12.1 Transcribed (`tools/transcribe/npc-tables.ts` → `data/tables/npc-tables.json`)

| Table | Source |
|---|---|
| `Approach` names and ids | `TacticalAI/NPC.h:13-52` |
| `NPCAction` names and ids | `Tactical/Interface_Dialogue.h:85-342` |
| quote action ids, standard NPC quote ids | `TacticalAI/AI.h:95-102`, `NPC.cc:89-101` |
| civilian quote types and entries per type | `Tactical/Civ_Quotes.h:13-71`, `Civ_Quotes.cc:45-101` |
| civilian hint sectors (with the miners index) | `NPC.cc:46-80` |
| RPC sector descriptions (sector → quote) | `StrategicMap.cc:355-393` |
| profile lists hard-coded in the rules: assassins, the 15 minor-offence profiles, `MakeCivHostile` rebels, CONRAD/GENERAL, guide RPCs | `NPC.cc:1618, 1634-1642`, `Handle_Items.cc:3230-3244`, `Overhead.cc:2600-2617`, `Tactical_Turns.cc:64-67` |

Named constants with `@src` headers: `NPC_TALK_RADIUS` 4, `AP_TALK` 6, `AP_GIVE_ITEM` 1, `AP_PICKUP_ITEM` 3,
`INITIATING_FACTOR` 30, `LARGE_AMOUNT_MONEY` 1000, `TEXT_DELAY_MODIFIER` 60, `DIALOGUESIZE` 240, `CIV_QUOTE_TEXT_SIZE`
160, record count 50, record size 32, the special record values (§1.3), the 500 ms trigger wait, the 60 s idle, the
4-tile close-enough, `PAUSE_ALL_AI_DELAY` 1500, loyalty thresholds 20/80, Darren's 1000/5000, Gerard's and Joe's 10000,
team-full margins 2 and 3, Joey's tile 18326.

**Stracciatella's script overrides.** `J:script-records-NPCs.json` (in ja2-node: `data/tables/npc-script-records.json`, comments stripped) and `J:script-records-control.json` are in the
repository already (copied unchanged). The first carries the original English quote text in its `//` comments. Proposed:
`tools/transcribe/npc-script-overrides.ts` reads both (comments stripped by the existing JSONC reader,
`src/content/strategic/jsonc.ts`) and writes `data/tables/npc-script-overrides.json` with numbers and enum names only;
the commented copy leaves `data/externalized` (open question, §16).

### 12.2 Original data at runtime (never committed)

`npcdata/NNN.npc` (all NPC/RPC arrays, `000.npc`, the meanwhile files 160–176 and 180–196, the civilian hint files and
`miners.npc`), `npcdata/NNN.edt`, `npcdata/d_NNN.edt`, `npcdata/civNN.edt`, `npcdata/<sector>.edt`, `mercedt/VVV.edt`,
`binarydata/prof.dat` (the fields of §1.2). New decoders: `src/content/formats/npc.ts` (32-byte records; the Russian
layout by resource version; facts > 368 → 65535) and `src/content/formats/edt.ts`.

### 12.3 Save sections

| Section (`14` §4) | Layout | Import |
|---|---|---|
| 5 profiles | §1.2 offsets; voice ids from v104 | extend `savegame-profile.ts` |
| 6 soldiers | `ubQuoteRecord`, `ubQuoteActionID`, `uiTimeSinceLastSpoke` (wall clock: becomes 0), `bCurrentCivQuote(Delta)`, `bNeutral`, `ubCivilianGroup` | fields exist in `savegame-soldier.ts` |
| 19 NPC quote info | 170 (v < 105) or 200 × (`u8 present`, 50 × 32), then 20 civilian arrays the same (`NPC.cc:2388-2426`) | records state; then `RefreshNPCScriptRecord` rules for v < 98 and the load-time once-per-conversation reset |
| 21 temp NPC quote file | `u32 size` + blob (Strac writes 0) | skip |
| 24 general info | hospital balance, refund, modifier (`SaveLoadGame.cc:2098-2101`) | `25` |
| 38 civilian quotes | 100 bytes | skip |
| 39 backup NPC info | profiles × (`u8 present`, 50 × 32) (`NPC.cc:2498-2514`) | backups |
| tactical status | `ENGAGED_IN_CONV`, `fCivGroupHostile`, `ubEngagedInConvFromActionMercID` | (inferred: native saves cannot be made in a conversation, so the flag is clear) |

### 12.4 Stubs (CI)

- **Records**: authored `stubs/npc/records.json` (field names of §1.3) compiled by `pnpm stubs` into real
  `npcdata/NNN.npc`, `000.npc` and one civilian hint file; authored lines `stubs/npc/text.json` compiled into ROT-1
  `.edt` files. The same loaders run on stubs and on the original (as the stub maps do).
- **Profiles**: one NPC whose id is NPC-type in `J:mercs-profile-info.json` and **not** one of the ten override profiles
  (the `data/` layer sits above the stubs, so those would pick up Stracciatella's records); the existing stub RPC at 59
  (IRA's slot: `RecruitRPC` triggers `000.npc` record 0, so the stub `000.npc` makes it a silent record); one EPC
  candidate (NPC-type, not JOHN or MARY); the dealer stubs of `23` §15.5 for `buySell`; profile-less civilians in the
  stub village.
- **Records to author**: special initial and initial quotes; defaults and "get lost"; an opinion-gated recruit record →
  pay prompt → records 0/1 with `RECRUIT_WITH_SALARY`; escort prompt and an EPC_WHO_IS_RECRUITED record with
  `UN_RECRUIT_EPC`; GIVINGITEM records for an item, for money (RPC debt) and `DONT_ACCEPT_ITEM`; a walk with a
  tile-triggered follow-up wrapped in `TURN_UI_OFF`/`ON`; a once-per-conversation record; a SECTOR_NOT_SAFE record; a
  declaration with `BECOME_ENEMY`; a gift; a civilian hint with a quest start. Conditions use plain stored facts and
  quest ids agreed with `25`'s stub plan.
- *Implemented (2026-10-16):* profile 94 (DAMON's slot: NPC type, no override, no code rules) is the invented "Teodor Vasko"
  in A10 (`stubs/maps/a10.map.txt`) with eight records in `stubs/npc/records.json` (an initial quote, a special initial
  quote gated by fact 132, an opinion-gated friendly record said once per conversation, a direct record that sets fact 132
  and starts quest 14, a quest-gated friendly record that triggers record 5, record 5 with `TURN_UI_OFF` and a walk, the tile
  record with `TURN_UI_ON` that ends quest 14, a threaten record that closes the panel) and 20 invented lines in
  `stubs/npc/text.json`; `000.npc` holds one silent trigger record. Recruiting, escorting and civilian hint records
  come with their slices. *Give slice:* records 8–10 take a 9 mm magazine and money and refuse the pistol
  (`DONT_ACCEPT_ITEM`), with three more invented lines; other items get the default line 4 (`stubs/npc/records.json` names
  required items, which the stub build resolves through the item table); the stub animation scripts gain `GIVE_ITEM` with
  code 486.

---

## 13. Minimal M6 implementation (this part)

### 13.0 What exists today

`src/sim/campaign/shop-flow.ts` (`openShop` as a stand-in for talk + buy/sell, hooks `buySellRecordPending` and
`shopClosedByScript`), `startMineStandIn` for the head miner (`18`), the guide-description flag and draw (`16`), opcode
486 named in `src/sim/tactical/item-actions.ts` without a give, `Soldier.quoteActionId` and `handleAITacticalTraversal`
(`src/sim/tactical/ai/control.ts`), `GreenHooks.decideActionNamedNPC` returning NONE (`ai/decide.ts`), `OFFER_SURRENDER`
as a no-op, `MercKind.NPC`/`EPC` and the EPC exit rules in the roster, `handleTownLoyaltyForNpcRecruitment`, RPC daily
pay (`contracts/rpc-pay.ts`), and the soldier save fields of §12.3. Nothing of records, the queue or conversations
exists.

*Implemented (first docs/24 slice, 2026-10-16, steps (a)–(e), (j), (k)):* `src/content/formats/npc.ts`, `edt.ts`,
`savegame-npc.ts`, the §1.2 profile fields in `prof.ts`/`stub-profiles.ts` (and through them `savegame-profile.ts` and the
campaign profiles), `src/content/narrative/` (content assembly, text and lengths), `src/sim/narrative/` (records, selection,
queue, `converseFull`, triggers, scripted movement glue, UI codes, the hostile-list hooks, save import),
`src/sim/campaign/talk-flow.ts` (the session, wired into `CampaignSim`, `ShopFlow` and the narrative port), the AI arrival,
close-enough and freeze hooks, `/api/text`, the stub NPC 94 in A10 and the oracle patch `0013-talk-oracle.patch`. Give (f),
recruiting and EPCs (g), civilian quotes and surrender (h), hostility and sight hooks and the named-NPC AI (i), the request
boxes and the NPC action catalog are later slices; they plug into the ports of `src/sim/narrative/host.ts`.

*Implemented (give slice, 2026-10-16, step (f)):* `src/sim/tactical/give.ts` (§4.1: `SoldierGiveItem`, the pending give and
its arrival, `VerifyGiveItem`, `SoldierGiveItemFromAnimation` with the dealer, team-member and NPC branches, code 486 in
`item-actions.ts`, the collapse case, `SOLDIER_ENGAGEDINACTION` as `Soldier.engagedInAction` stopping the AI, the engaged-in-
conversation flag of a PC action), `src/sim/narrative/give.ts` (§4.4–§4.5: `PlaceObjectInSoldierProfile` with Madlab's
attachments, `RemoveObjectFromSoldierProfile`, `SetMoneyInSoldierProfile`, `ReturnItemToPlayer`, `HandleNPCItemGiven`, the
dealer branch and the GIVINGITEM conversation), the real `GivePort` and `ReceivePort` (CalcMedicalCost of the action
catalog's hospital code, Frank's cash) in `talk-flow.ts`, the `give` command (`src/sim/campaign/give-flow.ts`,
`docs/04` §6.16), records 13–15 of the stub NPC, and the oracle patch `0017-give-oracle.patch` with the probes `receive`,
`give`, `npcgive` and `actionitem` (`tools/oracle/probes/give.txt`, `give-compare.ts`). Details and corrections in §4.6.

*Implemented (recruiting slice, 2026-10-16, step (g) with §9):* `src/sim/tactical/narrative/team-change.ts`
(`ChangeSoldierTeam`), `src/sim/campaign/narrative/recruit-flow.ts` (`RecruitRPC`, `RecruitEPC`, `UnRecruitEPC`,
`HandleStuffForNPCEscorted`, the marriage's team change, Darrel's script, the departed list, `InternalUnescortEPC` and the
side changes of civilian groups through `NarrativePort.changeSoldierTeam`), the `removeEpc` queue event, the `unescort`
command in `talk-flow.ts`, the robot's controller (`src/sim/campaign/robot-control.ts`, `src/sim/tactical/narrative/robot.ts`)
and the escort arrivals of John, Mary, Maria and Joey (`escort-arrival.ts`). Stubs: the R.P.C. 65 and the escort 123 in A10.
Oracle: `patches/0018-recruit-oracle.patch`, `probes/recruit.txt`, `recruit-compare.ts` (README "Recruiting").

*Implemented (civilian quotes, surrender, hostility and named-NPC slice, 2026-10-16, steps (h) and (i)):*
`src/sim/narrative/civ-quotes.ts` (§8.2-§8.4: `DetermineCivQuoteEntry`, `StartCivQuote`, `BeginCivQuote` with the text keys
of `GetCivQuoteText`, `ConsiderCivilianQuotes`; the soldier fields `bCurrentCivQuote(Delta)` and their import), `talk` to
civilians and enemies (§6.2, `docs/04` §6.19), the hicks' night line, the surrender offer (§8.5: the condition in
`DecideActionBlack`, `ENEMY_OFFERED_SURRENDER` with its import, `OFFER_SURRENDER` through the narrative port, the
`surrender` prompt with `context: 'tactical'` and the capture in `BattleFlow`), `src/sim/tactical/ai/decide-named-npc.ts`
(`DecideActionNamedNPC` and `ClosestPC`, wired into green and yellow with the 60 s pause after `ConverseFull`), the fixed
candidate set of `NPCConsiderInitiatingConv`, `gfPauseAllAI` (`src/sim/tactical/ai/pause.ts`: temporary and manual pauses,
the 1500 ms end, the pause and reveal of `CheckHostileOrSayQuoteList`, the temporary pause of
`ProcessImplicationsOfPCAttack`), `EndAIGuysTurn`'s proximity rule with `TriggerFriendWithHostileQuote`, the first-sighting
hooks (the declaration test, Joe, Elliot and Iggy with `SAID_FIRSTSEEN_QUOTE`, our mercs seeing Mike and Joey, Mike's
greeting with the tri-state `gfMikeShouldSayHi`), `PCsNearNPC` and `PCDoesFirstAidOnNPC` on the narrative port (no
first-aid action calls the latter yet) and the RPC sector descriptions of §8.6 (countdown in `NarrativeState.guide`, the
alternate-file quote). Stub pack: invented civilian lines (`civilianFiles` in `stubs/npc/text.json`, 160-unit rows).
Oracle: `patches/0020-civ-oracle.patch`, `probes/civ.txt`, `civ-compare.ts`. Corrections found on the way: green, yellow
and black AI treat every neutral civilian as a civilian (only red adds the group test, `DecideAction.cc:650, 1086,
1466, 2474`); a hostile NPC seeing us is listed by `NPCHasUnusedRecordWithGivenApproach`; the civilian type numbers are
MARRIED_PC 3, ENEMY 4. Not done: the say-later merc line of §6.5 (cosmetic, deviation "Say-later merc lines").

### 13.1 Modules (SFI-SCLA headers)

1. `src/content/formats/npc.ts`, `edt.ts`; `prof.ts` and `stub-profiles.ts` gain the §1.2 fields.
2. `src/content/narrative/npc-records.ts`: content assembly in the §1.4 order, the meanwhile table, `000.npc`, civilian
   files, the override table, `quoteChars`.
3. `src/sim/narrative/records.ts`: arrays, backups, civilian arrays; `ensureLoaded` with the RPC swap, resets,
   mutations.
4. `src/sim/narrative/select.ts`: §2 and §4.2-§4.3 as pure functions over a context (facts through `25`'s
   `checkFact(fact, npc, ctx)`, where `ctx` carries the conversation soldiers).
5. `src/sim/narrative/dialogue-queue.ts`: the queue, the speech channel, `handleDialogue(tick)`, event kinds (§7).
6. `src/sim/narrative/converse.ts`: §3, the triggers (§5.1-§5.2), movement glue (§5.3), UI codes (§5.6), the hostile
   list (§3.6); `civ-quotes.ts` (§8); `recruit.ts` (§9); `give.ts` (§4, with opcode 486 in
   `src/sim/tactical/item-actions.ts`); `requests.ts` (§6.7).
7. `src/sim/campaign/talk-flow.ts`: the session as in `shop-flow.ts` (commands, refusals, prompts, view, events), wired
   into `CampaignSim` dispatch and `advance` (`conversationOpen`, `scriptedSequence`, pause lock 14) and into `ShopFlow`
   for `buySell`.
8. Tactical hooks: `decideActionNamedNPC` (green and yellow); `OFFER_SURRENDER`; arrival → `npcReachedDestination`; the
   close-enough rewrite; `quoteRecord` guards in `SetNewSituation`, new situations and blocked movers; a perception hook
   for first sightings (§3.6, §5.4); `gfPauseAllAI`; `CheckHostileOrSayQuoteList` in the overhead pass; draws-first
   before `attack`.
9. `src/content/formats/savegame-npc.ts` and the import (§12.3).
10. Protocol, server, MCP: commands, prompts, `observe.conversation`, `TextService`, `/api/text`.

### 13.2 Order of work

(a) formats and content; (b) records and selection with unit tests on hand-built records; (c) queue and speech channel;
(d) `converseFull`, triggers, movement, UI codes; (e) the talk session and the shop link; (f) give; (g) recruiting and
EPCs; (h) civilian quotes and surrender; (i) hostility, sight hooks, named-NPC AI; (j) save import and oracle probes;
(k) stubs, the scenario and an MCP e2e test. `25`'s `checkFact`/quests are needed from (b); stand-in: a fact table with
stored facts only.
*Since the merge with `25` (2026-10-16) the talk session reads facts through `NarrativeFlow.checkFact`, starts and ends
quests with their history lines, uses `NarrativeFlow.talk` as the talk context and `narrative.hospital` for the hospital
balance.*

---

## 14. Tests

**Unit.**
- Formats: `.npc` round trip, the fact clamp, the Russian layout; JSON override defaults (missing records dead by
  `lastDay` 0); EDT decoding (ROT-1 above 33, forced NUL, first NUL, row width); `quoteChars`.
- Desire: truncation, attachment boost, threat without a weapon (−30) and the halving, `u8` wrap, NO_PROFILE merc; first
  approach scaling after the desire, recruit excluded, Pablo's inverted test.
- `npcConsiderQuote`: each step in order; quest encodings including 100/200; `MUST_BE_NEW_DAY`; `lastDay` with day ≥
  255; opinion 255; TRIGGER ignoring opinion; approach matrix 0/29/30; giving needs 6; hints need 0.
- `npcConsiderTalking`: profile-inventory items, 1000/1001 invisible, required tile, first match, NPC_INITIATING_CONV.
- Receiving: normalisation, money facts that stay set, poor condition, every money case of §4.2 and §4.3 with boundaries
  (Darren 999/1000/5000/5001, Gerard/Joe 9999/10000, the Vince/Steve index-0 quirk, the unsigned refund).
- `converseFull`: immediate versus queued effects in §3.4's order; end before start quest; defaults and their flags; get
  lost for 70/120; assassins on a refused give; last date by approach; every item-return case; sector-not-safe skipping
  the initial quote; same-day silence.
- Bookkeeping: once-per-conversation resets (initial quote, Done/Esc, load; not script closes), Darren's record 11, the
  RPC backup swap and restore, lazy creation and the save's present flags; close-enough and Darrel rewrites.
- Queue: one event per tick, keep/retry, 12 ticks per character and the final 60, delayed quotes, auto-bandage drop, the PC-trigger face
  flag, pending conversations.
- Triggers: §5.2's dispatch table, the quote-0 inconsistency, the 100-tick wait, the talker choice; movement ids,
  arrival, the unload/reload record-0 quirk, the `fAIFlags` quirk; UI codes and reference counts.
- Hostile list: selection and draws, the all-hostile fallback, `NEEDS_TO_SAY_HOSTILE_QUOTE` in `FACT_NPC_IS_ENEMY`.
- Civilians: §8.2's matrix, L12 using the miners file, the dry-run quest start, the hint-drop draw only with a hint,
  entry cycling, hint then normal line, surrender conditions.
- Give: check 1 / charge 3, `VerifyGiveItem` failure, dealer branches, whole-slot deletion for mercs, the profile slot
  rules (last small pocket skipped, fresh object), Madlab's attachments.
- Recruiting: team-full thresholds 17 and 16, every `RecruitRPC` step, `ChangeSoldierTeam` copies and flags, the
  JOHN/MARY pair, `HandleStuffForNPCEscorted`, `UnRecruitEPC`, un-escort on the map and in tactical; each request box's
  records; the lie ranking.

**Scenario (stubs).** Talk to the stub NPC (initial quote, approaches, defaults, get lost); recruit the stub RPC through
the pay prompt; escort and release the stub EPC; give an accepted item, a refused one and money against a debt; a
scripted walk with UI off/on and a tile trigger; civilian barks with a hint; a declaration starting combat. The same
command log under the instant and manual drivers yields identical event logs; saving inside a session is refused;
records persist through save and load.

**Original data** (`describe.skipIf(!process.env.JA2_DATA_DIR)`): every `.npc` file loads (NPCs, meanwhiles, civilians,
`000.npc`); every record quote row exists in its EDT (counts only); sections 19 and 39 of the six saves import with
invariants (backups only for recruited RPCs; present arrays for NPCs the save has met).

**e2e.** An MCP agent talks, recruits and gives through the API on stubs.

---

## 15. Oracle probes

Patch `0013-talk-oracle.patch` (implemented: `npcrecords`, `npcprofile`, `desire`, `consider`, `talk` without draining,
`questdecode`; the comparer is `tools/oracle/talk-compare.ts`, the probes `probes/talk.txt`). Patch `0017-give-oracle.patch` (implemented with
the give slice: `receive`, `give`, `npcgive`, `actionitem`; comparer `tools/oracle/give-compare.ts`, probes `probes/give.txt`, README
"Give"). Patch `0020-civ-oracle.patch` (implemented with the civilian slice: `civset`, `civquote`, `namednpc`,
`initiating`, `pcsnear`, `firstaid`, `friendhostile`, `hostilecheck`, `surrender`, `surrenderanswer`; comparer
`tools/oracle/civ-compare.ts`, probes `probes/civ.txt`, README "Civilians"). The full plan was: a headless panel (sets `gTalkPanel.ubCharNum`, `gfInTalkPanel`, the conversation
soldiers without faces or UI; `DeleteTalkingMenu` clears state only); a queue stepper that executes events one by one
and logs each (`quote` finished at once, `action {npc, code, record}`, `goto`, `trigger`, `give`, `closePanel`);
`DoMessageBox` from `StartDialogueMessageBox` and the surrender box intercepted (logged, answered by a probe command);
wrappers for the static helpers (`NPCConsiderTalking`, `NPCConsiderQuote`, `CalcThreateningEffectiveness`,
`NPCConsiderReceivingItemFromMerc`, `HandleNPCBeingGivenMoneyByPlayer`, `DetermineCivQuoteEntry`,
`ConsiderCivilianQuotes`).

| Command | Does | Output |
|---|---|---|
| `npcrecords profile=<id>\|all` | dump | present/backup flags and all 50 records as numbers |
| `npcprofile profile=<id>` | dump | §1.2 fields |
| `desire npc= merc= approach=` | `CalcDesireToTalk` | desire, threat, inputs |
| `consider npc= merc= approach= record=` | `NPCConsiderTalking` | index, opinion, approach bits and values after |
| `talk npc= merc= approach=initial\|friendly\|direct\|threaten\|recruit\|repeat\|whoareyou [record=] [item=<name>:<status>:<count>\|money=<n>]` | headless open + `ConverseFull` + drain, draws traced | queue log, records, profile fields, facts and quests touched, soldiers moved |
| `trigger npc= record= [immediate=1]`, `approachtrigger npc= approach=` | + drain | as `talk` |
| `reached npc= [already=1]`, `pcsnear npc=` | + drain | as `talk` |
| `npcanswer value=yes\|no\|lie` | answers the intercepted box + drain | as `talk` |
| `civquote who=<soldier>` | `StartCivQuote` headless, draws traced | type, entry, hint, records, soldier quote fields |
| `hostilelist add=<id>,…`, `hostilecheck` | the list and `CheckHostileOrSayQuoteList`, draws | speaker, records, sides |
| `recruit npc=`, `escort npc=`, `unescort npc= map=0\|1` | team changes | soldier, profile, squads, history |
| `initiating npc=` | `NPCConsiderInitiatingConv` | tile or NOWHERE |
| `npcscan` | over every content array | per-approach counts, approach-7 records with opinion 255, quest 100/200 uses, CLOSING_SHOP uses (numbers only) |

Plus the existing `save`, `fact`, `setprofile`, `addsoldier`, `draws`, `seed`. `npc-compare.ts` imports the save, runs
the same commands through ja2-node with a roll source that asserts each traced range, and compares dumps field by field
and the queue log in order. `probes/npc.txt`: on the six saves, for NPCs present in their loaded sectors (or added with
`addsoldier profile=`): the desire matrix, initial quotes on the same and the next day, defaults twice, items and money
to the NPCs with money cases that are present, tile triggers, twenty civilians at three loyalty levels, the hostile
list, recruiting and escorting where a candidate stands. Outputs stay outside the repository.

---

## 16. Quirks to keep, deviations to log, verified vs inferred, open questions

**Quirks to keep** (Strac; = V unless marked):
- The first approach scales the values after its own desire; recruit never scales; Pablo's not-safe threat test is
  inverted.
- The threat halves (not thirds), an unarmed threat is −30, the desire wraps as `u8`.
- Record approach 0 answers friendly, direct and triggers only; items need approach 6 exactly; hints approach 0;
  CLOSING_SHOP records are dead.
- Required items are looked up in the profile inventory; gifts and taken items keep it out of sync with the soldier.
- Facts, quests, money handling and taking the item happen at selection, before any line; `EndQuest` precedes
  `StartQuest`.
- The money facts are never reset; Vince's and Steve's direct records run as index 0; the hospital refund's clamp never
  works.
- `PlaceObjectInSoldierProfile` never uses the last small pocket, gives the NPC a fresh object and loses the item
  without a free slot.
- Plain records (neither erase-once nor once-per-conversation) repeat forever; once-per-conversation records reset only
  at an initial quote, a player close and a load; a same-day talk opens silently; the last date wraps after day 255.
- Quest values 100 and 200 decode wrongly (pending §16 decision on the out-of-bounds read).
- NPC_INITIATING_CONV only finds approach-7 opinion-255 records and only walks the NPC up.
- L12's civilians use `miners.npc`; civilian hints start their quest on every ask while unsaid; types 2–5, 12–15, 38 are
  never chosen; the stored entry base survives a type change.
- Unloading a sector mid-walk stores the action id as the record (record 0 on reload); `NPCReachedDestination` keeps
  only `AI_HANDLE_EVERY_FRAME` for our soldiers; "close enough" rewrites the script.
- `show` and `RecordHasDialogue` disagree on quote 0; in that case the open panel's NPC speaks the other NPC's quote
  numbers.
- `FACE_CLOSEST_PLAYER` stores the record index without the + 1, so it is inert from record 0.
- The lie candidate is ranked by wisdom; Steve's free care zeroes Vince's balance; requestors only work for
  `gpDestSoldier`.
- Giving checks 1 AP and charges 3; giving to a merc deletes the whole source slot; one item given from a stack is put back
  at the end first, so the NPC branch removes another item than the one given; money placed on a team member pays no debt
  (Strac); a give that begins with the target gone drops a copy; a dealer branch leaves both soldiers engaged in action and
  removes the object at index `count` from the slot; split money is lost on a BUYSELL record (§4.6).
- The museum alarm calls Eldin while the action item queue disallows sight, so he never "sees" the spot and always runs to
  it; the Kingpin alarm can ring again (its "zap" clears the disabled flag instead of setting it) (`25` §11.5).
- `RECRUITED` is set for EPCs and kept by departed RPCs.
- Civilian-group side changes draw `Random(2)` for an unused value.
- Issue #750: `REMOVE_NPC` with a destination clears the profile sector first (Strac only).

**Deviations to log in `docs/deviations.md`**:
- *Talk session time*: nothing runs while the menu waits for the player; the original keeps running tactical frames.
- *Dialogue queue cadence*: one event per 5 ms tick; speech is always 12 ticks per character from the decoded text and
  the final 60; no
  waits for battle sounds (extends the "Speech" row).
- *Wall-clock timers*: the 500 ms trigger wait, the 60 s idle, the 1500 ms AI pause in ticks; the civilian box is
  presentation and the surrender prompt opens at once.
- *Cosmetic draws in dialogue*: the friendly default and the civilian entry on the cosmetic stream; speaker picks
  (closest merc, say-later, own-merc bark, RPC description speaker) not drawn.
- *Returned items*: an item that does not fit is dropped VISIBLE at the giver's tile (original: the item cursor).
- *Civilian boxes are not modal*: a second talk to a civilian barks again instead of only closing the box.
- *No skipping of lines*; *no debug desire or informative tooltips*; *requests as `npcRequest` prompts*; *`openShop` =
  talk + buySell*; *text served by the server, keys in the simulation*; *the Alt+6 cheat and the Lua `OnRPCRecruited`
  hook not ported*.
- Update existing rows: "Talking to dealers" (conversations now exist), "Head miner stand-in" (replaced by the record),
  "Guide descriptions" (countdown and quote now exist), "Implications of an attack" (the NPC parts with `25`).

**Verified** by reading Strac (V where marked): the record layout and loaders (binary, JSON, control file, lazy copies,
the RPC swap, resets, save sections), `CalcDesireToTalk`, the first-approach scaling, `NPCConsiderQuote`/`Talking`/
`ReceivingItemFromMerc`, the money handlers, `ConverseFull` in full, the trigger functions and their dispatch, scripted
movement and arrival, the unload quirk (also V), `NPCConsiderInitiatingConv` and `DecideActionNamedNPC`, the talk panel
lifecycle and its closers, the queue and quote events, text file selection and decoding, the request boxes and outcomes,
civilian quotes (also the L12 collision in V), surrender, the RPC description countdown, `RecruitRPC`/`RecruitEPC`/
`UnRecruitEPC`/`ChangeSoldierTeam`, un-escorting, the give action, the hostile list and its feeders. **Inferred**: what
the shipped `.npc` data actually uses (approach 7, quest 100/200, `FACT_PC_NEAR` records with lines, PC scripts), the
saving guards, the gift duplicate staying with the NPC, the vanished item without a free slot,
`giNPCSpecialReferenceCount` after a load, the stale civilian entry, that departed RPCs never return, that the hostile
list and say-later state are transient, and that names show on hover.

**Decisions** (2026-10-16, replacing the open questions):
1. Stracciatella's records are kept without their comments: `data/tables/npc-script-records.json`, generated by
   `tools/transcribe/npc-script-records.ts`; the copy in `data/externalized` is gone (its comments quoted dialogue).
   Profiles without an override use the user's `.npc` files; the stub pack has authored records.
2. The world freezes while the talk menu waits for the player (deviation, like the shop).
3. Speech durations follow the text length of the session's data (faithful); a replay log records the text source.
4. Draws whose result is stored (the friendly default saved in the profile) use the main stream in the original order;
   presentation-only choices (the civilian line) use a separate cosmetic stream (deviation).
5. `openShop` stays as a one-command shortcut for talk + buy/sell; `approach buySell` works inside a talk session too.
6. The quest 100/200 decode follows the oracle: both values read `gubQuest[100]`, which lies outside `gubFact` (that array
   starts 512 bytes before `gubQuest`) and reads 0, so 100 never passes and 200 always passes. (Corrected 2026-10-16: the
   earlier `gubFact[70]`/`[170]` guess was refuted by the probe, and both values index 100, not 170.)
7. Only merc quotes that interleave with NPC events go through the dialogue queue in M6; the others stay plain events.
8. With original data, `observe` and MCP responses include the resolved text by default (agents need it to follow
   quests); without it they carry text keys only.
9. `25` owns `MakeCivHostile` and civilian group side changes; this spec calls it from the dialogue paths.

**For `25` and `26`** (seen while reading): `25` must specify `CheckFact` with its conversation-context facts and the
stored ones this spec sets (`FACT_PC_NEAR`, money facts, poor condition, `NEED_TO_SAY_SOMETHING`), `StartQuest`
restarting finished quests, every action's semantics including the requestors' follow-up records,
`HandleNPCSystemEvent`, placement with the quote-record restore at load and the traversal quirk,
`HandleNPCChangesForTacticalTraversal`/DONE_TRAVERSAL, schedules (they gate the record walks via `ACTING_ON_SCHEDULE`),
boxing, the hospital (`CalcMedicalCost`, choose doctor), Kingpin, Madame, `ProcessImplicationsOfPCAttack`'s NPC cases,
`HandleVictoryInNPCSector`, `HandleShopKeepHasBeenShutDown`, assassins, ownership offences, the 04:00 reset of the
default-response flags, the capture sequence after a surrender and the Alma quest. `26` must specify the meanwhile
record reload (state discarded for QUEEN and ELLIOT, `Meanwhile.cc:287, 523`), the `(INT8)` truncation of the restored
grid number (`Meanwhile.cc:520`), quotes silenced in meanwhiles (`Dialogue_Control.cc:548-551`), Esc ending a meanwhile,
the lie prompt's context, `END_MEANWHILE` actions, and the end-game queue events (`End_Game.cc:146-454`).
