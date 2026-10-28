# 18 — Towns and mercs between battles: militia, loyalty, mines, SAM sites, assignments

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` (snapshot `ae6bf01`); `V:` is vanilla
`Build/`; JSON files are `assets/externalized/*.json` (copied to `data/externalized/`); `game.json` values are
Stracciatella defaults. C integer semantics: `/` truncates toward zero (`idiv`), `%` keeps the dividend's sign (`imod`),
`UINT8`/`INT8`/`UINT16`/`INT16` stores wrap (`u8`/`i8`/`u16`/`i16`). `Random` = `main` stream, `PreRandom` = `pre`
stream (`01` §3.6); `Chance(x)` is `Random(100) < x` (`sgp/Random.cc:71-74`) and draws even when `x` is 0 or ≥ 100.
Times are game minutes unless marked (`GetWorldTotalMin`). Sectors are `A1..P16`; `SectorInfo[]` is indexed by the
0–255 "byte" (`(y-1)*16 + (x-1)`), `StrategicMap[]` by the strategic index (`x + y*18`, `Strategic/Campaign_Types.h:8-11`).
Teams: `OUR 0, ENEMY 1, CREATURE 2, MILITIA 3, CIV 4`.
Soldier classes: `ADMINISTRATOR 1, ELITE 2, ARMY 3, GREEN_MILITIA 4, REG_MILITIA 5, ELITE_MILITIA 6, CREATURE 7, MINER 8`.
Militia ranks: `GREEN 0, REGULAR 1, ELITE 2` (`Strategic/Campaign_Types.h` `MilitiaLevel`). `OKLIFE 15`, `CONSCIOUSNESS 10`
(`Tactical/Overhead_Types.h:70-71`), `TRAINING_RATING_CAP 85` (`Tactical/Campaign.h:55`). ja2-node modules are under
`src/sim/strategic/economy/` unless a path says otherwise.

**Scope.** Militia (`Strategic/Town_Militia.cc`, `Tactical/Militia_Control.cc`, the militia panel), town loyalty
(`Strategic/Strategic_Town_Loyalty.cc` and the loyalty, morale, mine and theft effects of sector control changes), mines
(`Strategic/Strategic_Mines.cc`), SAM condition and air control (`Strategic/SAM_Sites.cc`), the finance ledger
(`AddTransactionToPlayersBook`) and assignments with the hourly `UpdateAssignments` (`Strategic/Assignments.cc`).
Elsewhere: `15` the clock, the event queue, the order of the hourly/daily handlers, new-game init; `16` sectors, groups,
routes, encounters, when `SetThisSectorAsPlayerControlled`/`SetThisSectorAsEnemyControlled` are called, sector
persistence, `FindStratPath`; `17` the Queen (garrisons, progress, `CalcDifficultyModifier`,
`StrategicHandleQueenLosingControlOfSector`, `StrategicHandleMineThatRanOut`); `19` PBI and autoresolve (militia there,
`VirtualSoldierDressWound`); `22` contracts, `MercDailyUpdate`, team morale, the buddy/hated counters; NPC actions for
the head miners (`35` §1.7) and the hospital (`25` §6.3); `10` turns and the end of battle; `33` §4–5 morale and
`StatChange`; `12` items; `14` savegame sections; `29` the agent API (assignment, sleep and militia commands, the
militia prompts, economy events, the view).

---

## 0. State this spec adds

Campaign state, all saved; ja2-node fields are under `StrategicState`.

| State | Original | ja2-node; save |
|---|---|---|
| Town loyalty ×13 | `TOWN_LOYALTY gTownLoyalty[NUM_TOWNS]`: `ubRating` (UINT8 0–100), `sChange` (INT16 hundredths accumulator), `fStarted`, `fLiberatedAlready` (`Strategic/Strategic_Town_Loyalty.h:67-73`) | `economy.towns` (`rating`, `change`, `started`, `liberatedAlready`), index 0 unused; section 26 (13 × 26 bytes, `docs/14` §4) |
| Town sector list | `g_town_sectors` built once by `BuildListOfTownSectors` (`Strategic_Town_Loyalty.cc:673-687`) | derived (`buildTownSectors`); **order is column-major** (x outer, y inner) |
| First battle sector | `sWorldSectorLocationOfFirstBattle` (`Strategic_Town_Loyalty.cc:131`) | `economy.firstBattleSector` (dialogue) |
| Per surface sector | `SECTORINFO.ubNumberOfCivsAtLevel[3]` (militia per rank), `fMilitiaTrainingPaid`, `ubMilitiaTrainingPercentDone`, `ubMilitiaTrainingHundredths`, `fSurfaceWasEverPlayerControlled`, `uiFacilitiesFlags` (`Strategic/Campaign_Types.h` `SECTORINFO`) | `map.sectors[]`: `militia[3]`, `militiaTrainingPaid`, `militiaTrainingPercentDone`, `militiaTrainingHundredths`, `surfaceWasEverPlayerControlled`, `facilities`; section 11 |
| SAM condition, air control | `StrategicMapElement.bSAMCondition` (0–100), `.fEnemyAirControlled` | `map.elements[]` `samCondition`, `enemyAirControlled`; section 11 |
| Mines ×6 | `MINE_STATUS_TYPE gMineStatus[]` (`Strategic/Strategic_Mines.h:50-70`) | `economy.mines` (`MineStatus`); section 25 (6 × 44) |
| Money | `LaptopSaveInfo.iCurrentBalance` (INT32) + the `finances.dat` ledger file | `finances` (balance, ledger, profile cost totals); the save's laptop info and finances file |
| Inactivity | `gStrategicStatus.usLastDayOfPlayerActivity`, `ubNumberOfDaysOfInactivity`, `ubNumNewSectorsVisitedToday`, `usEnricoEmailFlags`, `ubHighestProgress` | `map.activity` (the first three), `status.enricoEmailFlags`, `status.highestProgress`; section 34 |
| Militia promotion counters | `gbMilitiaPromotions`, `gbGreenToElitePromotions`, `gbGreenToRegPromotions`, `gbRegToElitePromotions` | `economy.militiaPromotions`; message only |

ja2-node also keeps `economy.strategicMilitiaChangesMade` (`gfStrategicMilitiaChangesMade`),
`economy.militiaTrainingCompletedBy` (the completed-training list of the running hourly update) and `economy.prompts`
(deferred militia prompts, §1.3).

**Soldier (OUR team)**: `assignment` (`bAssignment`, §5.1), `trainStat` (`bTrainStat`), `lastAssignmentChangeMin`
(`uiLastAssignmentChangeMin`), `asleep` (`fMercAsleep`), `collapsed` (`fMercCollapsedFlag`), `forcedToStayAwake`,
`complainedThatTired`, `nothingToDo` (`fDoneAssignmentAndNothingToDoFlag`), `fixingRobot`, `vehicleUnderRepair`
(`bVehicleUnderRepairID`, −1), `fractLife` (`sFractLife`, INT16 hundredths of life), `breathMax`, `bleeding`, stat damage
fields (`bAgilityDamage` …, only with `enable_stat_healing`), `groupId`, `hospitalPriceModifier`, `doneQuoteSaid`
(`SOLDIER_QUOTE_SAID_DONE_ASSIGNMENT`); ja2-node `CrewMember` fields (`ports.ts`) backed by the roster record
(`src/sim/campaign/roster.ts`). **Militia soldier**: `militiaKills` (`ubMilitiaKills`, UINT8). **Profile** (`prof.dat`,
`Tactical/LoadSaveMercProfile.cc`; read by `src/content/formats/prof.ts`): `needForSleep` (`ubNeedForSleep`, :190), `town`
(`bTown`, :166), `townAttachment` (`bTownAttachment`, :167), `mercOpinion[]` (`bMercOpinion`, :170), `salary` (`sSalary`,
:110), `miscFlags3` (:193; bit `PROFILE_MISC_FLAG3_TOWN_DOESNT_CARE_ABOUT_DEATH`).

---

## 1. Militia

### 1.1 Constants and caps

| Constant | Value | Source |
|---|---|---|
| `MAX_ALLOWABLE_MILITIA_PER_SECTOR` | 20 (all ranks) | `Strategic/Town_Militia.h:13` |
| `MILITIA_TRAINING_SQUAD_SIZE` | 10 per completed session ("was 6"; = V) | `:16` |
| `MILITIA_TRAINING_COST` | $750 per sector per session | `:19` |
| `MIN_RATING_TO_TRAIN_TOWN` | 20 loyalty | `:22` |
| `MAX_MILITIA_TRAINERS_PER_SECTOR` | 2 | `Strategic/Assignments.cc:219` |
| `TOWN_TRAINING_RATE` | 4 | `:217` |
| `TEACH_BONUS_TO_TRAIN`, `RPC_BONUS_TO_TRAIN` | 30, 10 (percent) | `:222-224` |

Militia may exist (`CanSectorContainMilita`, `Assignments.cc:616-621`) in a surface sector with a town id or in a SAM
sector (`IsThisSectorASAMSector`). Training is allowed (`MilitiaTrainingAllowedInSector`, `Town_Militia.cc:900-919`) on
the surface only: in any SAM sector, otherwise per the town's `strategic-map-towns.json` `isMilitiaTrainingAllowed` (true
for Drassen, Alma, Grumm, Cambria, Balime, Meduna, Chitzena; false for Omerta, Tixa, San Mona, Estoni, Orta). N4 is both
a Meduna sector and a SAM site: always trainable (SAM rule), but it needs Meduna's loyalty, counts as Meduna for "full"
and overflows into Meduna like any town sector. D2, D15, I8 are wilderness SAM sites (no loyalty needed, no overflow).

"Our and peaceful" (`SectorOursAndPeaceful`, `Town_Militia.cc:351-376`), used wherever militia are touched:
1. the loaded sector and (`fEnemyInSector` or `INCOMBAT`) → false;
2. surface and `StrategicMap.fEnemyControlled` → false;
3. `NumHostilesInSector(sector) > 0` (stationary enemies + creatures + non-vehicle enemy groups there,
   `Strategic/Queen_Command.cc:53-83`) → false; else true.

"Area full" (`IsAreaFullOfMilitia`, `Town_Militia.cc:643-674`): underground → true. Town: over all town sectors that are
our and peaceful, `count += regulars + elites`, `max += 20`; SAM (non-town): same for that one sector; then
`count >= max` (greens don't count: they can still be promoted; no eligible sector gives 0 ≥ 0 → full).

### 1.2 Who can train militia

```
BasicCanCharacterTrainMilitia(s) =                                   // Assignments.cc:625-634
  s.leadership > 0 && CanSectorContainMilita(s.sector) && NumEnemiesInAnySector(s.sector) == 0
  && AreAssignmentConditionsMet(s, AC_NONE)                           // §5.1: conscious, surface, not moving, …
CanCharacterTrainMilitia(s) =                                        // :640-648
  Basic… && MilitiaTrainingAllowedInSector(s.sector)
  && DoesSectorMercIsInHaveSufficientLoyaltyToTrainMilitia(s)        // :651-666: z==0; town: rating >= 20; else SAM sector
  && !IsAreaFullOfMilitia(s.sector)
  && CountMilitiaTrainersInSoldiersSector(s) < 2                      // :670-684: other OUR mercs, life >= OKLIFE, TRAIN_TOWN, same sector
```

The loyalty test reads `ubRating` even when `fStarted` is false (rating 0 then) and ignores `gfTownUsesLoyalty` (all
trainable towns use loyalty).

### 1.3 Paying for a session (the prompt flow)

Assigning `TRAIN_TOWN` from the menu (`Assignments.cc:4702-4777`) re-runs the checks with messages, **first** changes
the assignment (`PreChangeAssignment`, time stamp if new, `ChangeSoldiersAssignment(TRAIN_TOWN)`, movement group), then:
- `SectorInfo[sector].fMilitiaTrainingPaid` → `SetAssignmentForList(TRAIN_TOWN)` for the other selected mercs (§5.2);
- else `HandleInterfaceMessageForCostOfTrainingMilitia(s)` (`Town_Militia.cc:422-465`):
  - unpaid sectors = distinct sectors of the selected mercs (plus the assigning one) that pass `CanCharacterTrainMilitia`
    and are not paid (`BuildListOfUnpaidTrainableSectors`, `:788-824`; tactical: only the one merc);
  - cost = 750 × n; balance < cost → "can't afford" box → `MilitiaTrainingRejected`;
  - else a yes/no box. Yes (balance re-checked) → `StartTrainingInAllUnpaidTrainableSectors` (`:842-852`):
    `SetAssignmentForList(TRAIN_TOWN)`, then per unpaid sector `PayForTrainingInSector` (`:870-882`):
    `AddTransactionToPlayersBook(TRAIN_TOWN_MILITIA, sectorByte, now, −750)`, `fMilitiaTrainingPaid = TRUE`, clear the
    done flags of trainers there. No → `StopTimeCompression`, `MilitiaTrainingRejected` (`:589-604`): every TRAIN_TOWN
    merc of an unpaid sector in the character list goes to `ResumeOldAssignment` = `AddCharacterToAnySquad`
    (`Map_Screen_Interface.cc:358-371`, `Assignments.cc:7030-7046`), not back to the old assignment.

Payment is per session, not per trainer: a trainer joining a paid sector pays nothing; progress and the paid flag
survive trainers leaving mid-session.

ja2-node (`militia.ts` `startMilitiaPaymentFlow`/`answerMilitiaPayment`): the yes/no box is the decision prompt
`militiaPayment` (`EconomyDecisions` answers `yes`/`no`/`defer`; a deferred prompt waits in `economy.prompts` with
compression stopped, `deviations.md` "Militia payment and continue prompts"); "can't afford", "no" and the
continue-prompt refusals of §1.5 are the `militiaTrainingRejected` event (`declined`, `cannotAfford`, `loyaltyTooLow`,
`militiaFull`).

### 1.4 Training points and session progress

```
GetTownTrainPtsForCharacter(t):                                      // Assignments.cc:2663-2711 (hundredths of % per hour)
  max  = (t.wisdom + t.leadership + 10*t.expLevel) * 4                // natural stats, for display
  pts  = u16((EffectiveWisdom(t) + EffectiveLeadership(t) + 10*EffectiveExpLevel(t)) * 4)
  bonus = 30 per TEACHING in profile bSkillTrait / bSkillTrait2, +10 if the profile is NPC or RPC
  pts += bonus*pts/100;  max += bonus*max/100
  ReducePointsForFatigue(t, &pts)                                    // pts -= pts*GetPenaltyForFatigue/100 (SkillCheck.cc:134-137)
  return i16(pts)
```
The town-loyalty factor is commented out (`:2701-2708`). Example: Wis 80, Ldr 70, level 4, rested: 760/h → a session
(10000) takes 14 hours alone, 7 with two equal trainers; TEACHING makes it 988/h.

The militia part of `HandleTrainingInSector(sector)` (`Assignments.cc:2252-2309`, after the stat training of §5.8) runs
only if the sector is our and peaceful (`:2146-2151`; else no training of any kind this hour) and can contain militia:
1. collect trainers in **team id order**: same sector, `TRAIN_TOWN`, `EnoughTimeOnAssignment` (≥45 min, §5.2),
   not asleep during the past hour (§5.3), `pts > 0`;
2. sort descending by points (`qsort`, `:2287`, comparator `:2313-2318`; ja2-node sorts stably, so ties keep id order,
   `deviations.md` "Militia trainer ties");
3. for each in order: `TrainTownInSector(t, sector, pts)` (`:2621-2660`); stop after the one that completes the session
   (no carry-over; the rest get no LDR chance).

```
TrainTownInSector(t, sector, pts):
  StatChange(t, LDRAMT, 1 + pts/200, FROM_SUCCESS)                   // pre draws (33 §5)
  si.percentDone  += pts/100                                          // UINT8
  si.hundredths   += pts%100
  if si.hundredths >= 100: si.percentDone++; si.hundredths -= 100
  if si.percentDone >= 100:
    si.percentDone = 0; si.hundredths = 0; si.fMilitiaTrainingPaid = false
    TownMilitiaTrainingCompleted(t, sector); return true
  return false
```
Progress accrues whether or not the sector is paid; the command layer guarantees payment (§1.3). Training in a full area
still accrues and is wasted at completion (§1.5).

### 1.5 Session completion

```
TownMilitiaTrainingCompleted(trainer, sector):                       // Town_Militia.cc:61-189
  town = StrategicMap[sector].bNameId                                // BLANK for wilderness SAM sites
  gfStrategicMilitiaChangesMade = true                                // the loaded sector re-creates militia (§1.9)
  trained = 0
  while trained < 10:
    if CountAllMilitiaInSector(sector) < 20: greens[sector]++
    else:
      found = false
      if town != BLANK:
        for n in g_town_sectors (from the start, every iteration), n.town == town, n != sector, SectorOursAndPeaceful(n):
          if CountAll(n) < 20: greens[n]++; found = true; break
      if !found:
        if greens[sector] > 0: greens[sector]--; regulars[sector]++
        else:
          if town != BLANK: same scan; first n with greens[n] > 0: promote one there; found = true
          if !found: break                                          // everything regular/elite: rest is wasted
    trained++
  if trained > 0 && town != BLANK: IncrementTownLoyalty(town, 2*500)  // §2.2; scaled by sentiment
  AssignmentDone(trainer, sayQuote=true, meToo=false)                 // quote + adds the sector to the "completed" list
  for every OUR merc on TRAIN_TOWN in trainer.sector: AssignmentDone(merc, false, false)
```
`g_town_sectors` is column-major, so overflow fills e.g. Cambria in the order F8, G8, H8, F9, G9 and Drassen B13, C13,
D13. A session never creates elites. The loyalty bonus is lost only if the very first militia could not be placed.

**Continue prompt** (`HandleContinueOfTownTraining`, `Town_Militia.cc:735-785`, at the end of every hourly
`UpdateAssignments`): for each sector in the completed list (one entry per sector, keyed by the first trainer,
`:695-725`), a dialogue event runs `HandleInterfaceMessageForContinuingTrainingMilitia` (`:468-534`):
- loyalty below 20, area full, or balance < 750 → message + reject;
- else yes/no "continue training in X for $750?". Yes → `PayForTrainingInSector` for the trainer's sector. No → every
  TRAIN_TOWN merc of that sector goes to a squad (`ResetAssignmentOfMercsThatWereTrainingMilitiaInThisSector`,
  `Map_Screen_Interface.cc:374-387`).

Trainers keep `TRAIN_TOWN` while the prompt is open; the original switches to the map screen and the box pauses time.
ja2-node: the `militiaContinue` prompt (§1.3).

### 1.6 Ranks and promotions after a battle

Kill points (`ubMilitiaKills`, per militia soldier, tactical): +1 in `HandleNPCTeamMemberDeath` when the killer is
militia (`Tactical/Overhead.cc:2516-2519`), +2 for the killer and +1 for the assister at the death commit
(`Tactical/Soldier_Ani.cc:2929-2960`): a militia kill gives **3** points, an assist 1 (`33` §5; ja2-node
`src/sim/tactical/combat/death.ts`).

Promotions apply when the tactical world is unloaded (`HandleDefiniteUnloadingOfWorld`, both "load new map" and "trash
world", `Strategic/StrategicMap.cc:2902-2953`) through `HandleMilitiaStatusInCurrentMapBeforeLoadingNewMap`
(`Town_Militia.cc:608-620`): militia team no longer friendly → defections (§1.7) and the side is reset; else, unless the
battle is about to be finished in autoresolve (`gfAutomaticallyStartAutoResolve`), `HandleMilitiaPromotions`
(`Tactical/Militia_Control.cc:62-106`):

```
reset the four counters
for s in MILITIA team by id: if !s.inSector || s.life <= 0 || s.militiaKills == 0: continue
  rank = SoldierClassToMilitiaRank(s.class); if none: continue        // map-placed "rebel" militia have other classes
  n = CheckOneMilitiaForPromotion(worldSector, &rank, s.militiaKills)
  if n != 0:
    if rank == ELITE: continue                                        // dead: an elite start never promotes
    promotions++; n == 2 ? greenToElite++ : rank == GREEN ? greenToReg++ : regToElite++
    s.militiaKills = 0

CheckOneMilitiaForPromotion(sector, &rank, kp):                       // Town_Militia.cc:253-285
  while count[rank] == 0: if rank == ELITE: return 0; rank++          // the soldier's own rank may be gone: try higher
  n = 0
  switch rank:
    GREEN:   if kp < 2: break; if !Chance(25*kp): break; promote GREEN→REG; n++; kp -= 2;  // falls through
    REGULAR: if kp < 5: break; if !Chance(10*kp): break; promote REG→ELITE; n++
  return n
```
The strategic counts change, not the soldier (he is about to be removed). A later `BuildMilitiaPromotionsString` box on
the map screen reports the counters (`MapScreen.cc:7627-7631`; ja2-node event `militiaPromoted`). **Vanilla differs**
(V: `TownMilitia.c:258-296`): no rank fallback, and `Random(100)` is drawn even when the chance is 0; ja2-node follows
Stracciatella (D1). Autoresolve calls the same `checkOneMilitiaForPromotion` (`19`).

### 1.7 Casualties and defections

- A militia soldier dies in tactical (`Overhead.cc:2435-2448`): `StrategicRemoveMilitiaFromSector(worldSector, rank, 1)`
  if his class is a militia class (no-op when the count is already 0, `Town_Militia.cc:232-249`), then
  `HandleMurderOfCivilian` (returns at once: the victim is not CIV team, §2.5), then
  `HandleGlobalLoyaltyEvent(NATIVE_KILLED, worldSector)` (−50, §2.3).
- The player attacks friendly militia (`Overhead.cc:5386-5390`): `MilitiaChangesSides` (`:2830-2846`) makes every
  in-sector living militia hostile (`MakeCivHostile`; ja2-node `src/sim/tactical/narrative/civ-hostility.ts`). On unload,
  `HandleMilitiaDefections(worldSector)` (`Town_Militia.cc:289-327`): for rank 0..2, for each militia counted at the start
  of that rank, `Random(100) < 50/75/90` (green/regular/elite) removes one. No promotions that time.
- Militia in autoresolve, militia-only sectors attacked by the Queen, `PlayerSectorDefended` and the post-battle
  bookkeeping there: `19`.

### 1.8 Moving militia: redistribution inside a town

Stracciatella (default) has no mobile militia and no militia reinforcements; militia never leave their town. The map
screen militia panel moves them between sectors **of the same town** (`Strategic/Map_Screen_Interface_Map.cc`):
- pick up one of a rank (`PickUpATownPersonFromSector`, `:2631-2646`): sector in the selected town, our and peaceful,
  count > 0 → count−−, cursor+1; mark the loaded sector changed;
- drop one (`DropAPersonInASector`, `:2649-2667`): same town, our and peaceful, sector total < 20, cursor > 0;
- closing the panel with militia on the cursor (`HandleShutDownOfMilitiaPanelIfPeopleOnTheCursor`, `:3137-3182`): for
  each town sector in `g_town_sectors` order that is our and peaceful, with `n = 20 − total` free slots: round-robin
  green, regular, elite one at a time until `n` is used up or the cursor is empty;
- **auto** (`HandleEveningOutOfTroopsAmongstSectors`, `:3187-3275`, enabled when some non-enemy-controlled town sector
  has militia, `:3714-3732`): `k = GetTownSectorsUnderControl(town)` (§3.5); sum each rank over the town's sectors in the
  panel's 3×3 box that are not enemy controlled (**including sectors with hostiles**), plus the cursor; every town sector
  (`g_town_sectors` order) not enemy controlled and with no hostiles gets `rank/k`, then one leftover of each rank while
  its total < 20; the cursor is zeroed. Militia counted in a sector with hostiles but not redistributed back, and
  leftovers that hit the 20 cap, are lost (quirk, §7).

ja2-node (`militia-moves.ts`, strategic map only) has no server-side cursor. `moveMilitia(from, to, rank, count)` is
atomic (same town, both sectors ours and peaceful, enough militia of the rank, target total + count ≤ 20) after the panel
refusals of `HandleMilitiaRedistributionClick` (`militiaPanelRefusal`: underground, not a known town, a SAM site, a town
without militia, the town fighting in the loaded sector); `distributeMilitia(town)` is the AUTO button with its quirk,
summed over the town's 3×3 box (`militiaMapBaseSector`). The client keeps pick-ups, drops and the cursor and turns them
into moves (`deviations.md` "Militia redistribution").

### 1.9 Militia in tactical battles

Population when a sector is loaded (`PrepareLoadedSector`, `Strategic/StrategicMap.cc:573-640`): civilians,
`AddSoldierInitListTeamToWorld(MILITIA_TEAM)` (map placements that are militia team, e.g. editor rebels), bloodcats,
creatures, then `PrepareMilitiaForTactical()` (`Tactical/Militia_Control.cc:42-59`): surface only, reads the three counts
of `gWorldSector` and calls `AddSoldierInitListMilitia(greens, regulars, elites)`. Re-entering tactical in the already
loaded sector after strategic changes (`gfStrategicMilitiaChangesMade`: training completion, redistribution) runs
`ResetMilitia` (`Militia_Control.cc:19-27`, from `StrategicMap.cc:465`): trash the militia team, unlink their
placements, prepare again. ja2-node: `src/sim/campaign/sector-flow.ts` `prepareMilitiaForTactical`/`resetMilitia`,
`src/sim/tactical/init-list.ts` `addSoldierInitListMilitia`.

```
AddSoldierInitListMilitia(g, r, e):                                  // Tactical/Soldier_Init_List.cc:1028-1260
  max = g + r + e
  SortSoldierInitList()                                               // :250-330, shared with enemy population (16/17)
  // 1. priority placements (head of the sorted list while fPriorityExistance and max > 0)
  for node while node.priority && max:
    if node.team in {ENEMY, MILITIA}:
      class ELITE & e>0 → ELITE_MILITIA, e--; ARMY & r>0 → REG_MILITIA, r--; ADMINISTRATOR & g>0 → GREEN_MILITIA, g--; else skip
      team = MILITIA; orders = STATIONARY; attitude = Random(6)
      if detailed: drop it; RandomizeRelativeLevel(attr); RandomizeRelativeLevel(equip)
      AddPlacementToWorld(node) ? max-- : return
  if max == 0: return
  // 2. basic placements: count free ENEMY/MILITIA nodes per class (ELITE, ADMINISTRATOR, ARMY) from the mark on
  for cls in ADMINISTRATOR(green), ELITE(elite), ARMY(regular):        // enum order 1, 2, 3
    for node from mark while !node.soldier && max && total[cls] && slots[cls]:
      if node.team in {ENEMY, MILITIA} && node.class == cls:
        if slots <= total || Random(slots) < total:                   // no draw when slots <= total
          team = MILITIA; orders = STATIONARY; class = the militia class     // NO attitude roll, NO detail drop here
          AddPlacementToWorld(node) ? (total--, max--) : return
        slots--
  if max == 0: return
  // 3. leftovers: any free ENEMY/MILITIA node (priority included), ignoring classes
  free = count of free ENEMY/MILITIA nodes
  for node in list while free && max:
    if free node of ENEMY/MILITIA:
      if free <= max || Random(free) < max:
        x = Random(max); x < e → ELITE_MILITIA (e--) ; x < e+r → REG (r--) ; x < e+r+g → GREEN (g--)
        team = MILITIA; orders = STATIONARY; attitude = Random(6); detailed → drop + 2× RandomizeRelativeLevel
        AddPlacementToWorld(node) ? max-- : return
      free--
```
Militia use the map's **enemy** placements. Militia specifics of soldier creation (`Tactical/Soldier_Create.cc`;
ja2-node `src/sim/tactical/creation.ts`):
- `bVisible = 1` at creation (`:201-202`, "we see what militia see");
- palettes GREENVEST / JEANVEST / BLUEVEST with BEIGEPANTS (`:696-710`);
- experience level 2/4/6 + modifier like admin/army/elite (`:1284-1292`);
- `CalcDifficultyModifier(class)` (`:1035-1105`, `17` §11.1–§11.2): the easy-difficulty +20 applies **only to militia
  classes**; −5 with no mine income (`PredictIncomeFromPlayerMines() == 0`, §3.8). `DIFF_MODIFIER_DRASSEN_MILITIA` (+10,
  `:60`) is defined and unused. Campaigns compute it at sector load (`deviations.md` "Difficulty and progress in
  tactical"); the sandbox uses a fixed modifier ("Sandbox population");
- `RandomizeRelativeLevel` (`:1842-1925`): `Random(10) + location/3 − 5`, militia clamped to 1..8 (never bad or great),
  then +1 in autoresolve (so "great" is possible there); 0 bad, 1–2 poor, 3–6 average, 7–8 good, 9 great;
- nightops for elite/regular militia like elite/army enemies (`:842-870`, two `Chance` draws; `deviations.md` "Soldier
  creation draws");
- equipment by militia class and the militia drop rates 5/3/2 % (`Tactical/Inventory_Choosing.cc`).

After the battle: `CheckForEndOfBattle` sets militia GREEN/STATIONARY and stops bleeding (`10` §8.2); militia left alone
with enemies when the player leaves (`HandlePotentialBringUpAutoresolveToFinishBattle`, `StrategicMap.cc:2955-2990`) hand
the fight to autoresolve (`19`); abandoning them costs loyalty (§2.4). The promotions of §1.6 follow on unload.

### 1.10 Other readers of militia counts

Queen defence and attack evaluation (`Strategic/Strategic_AI.cc:214-216, 934-936`: green 1, regular 2, elite 3 points;
`17`); `PlayerSectorDefended` (`Queen_Command.cc:1279-1290`); `CanNearbyMilitiaScoutThisSector`
(`Town_Militia.cc:623-640`: any militia within ±1 sector lets the map show enemy counts; `16`); `IsAreaFullOfMilitia`;
save-load fix-ups that clamp totals above 20 (`SaveLoadGame.cc:2286-2330`, `Strategic_AI.cc:2368-2379`; save import only).

### 1.11 RNG in militia code

| Where | Draw | Stream |
|---|---|---|
| Promotion (§1.6) | `Chance(25·kp)`, then `Chance(10·kp′)` only after a green promotion with kp′ ≥ 5 or for regulars | main |
| Defection (§1.7) | `Random(100)` per militia, ranks green→elite | main |
| Placement (§1.9) | `Random(6)` attitude; `Random(slots)`; `Random(free)`, `Random(max)`; `Random(10)` ×2 per dropped detailed placement; then the creation draws of each soldier (body, stats, equipment, nightops) inside `AddPlacementToWorld`, interleaved in list order | main |

Training, completion, redistribution: no RNG (the trainer's `StatChange` draws `pre`).

---

## 2. Town loyalty

### 2.1 Ranges, towns and starting values

`ubRating` is 0..100 (`MAX_LOYALTY_VALUE`, `Strategic/Strategic_Town_Loyalty.cc:38`); every change goes through the
accumulator `sChange` with `GAIN_PTS_PER_LOYALTY_PT = 500` per point (`Strategic_Town_Loyalty.h:9`), so the "hundredths"
of the source comments are 1/500 of a point. Hardcoded tables (`Strategic_Town_Loyalty.cc:96-128`, = V; transcribed to
`data/tables/town-loyalty.json`, §6.1):

| Town (id) | Rebel sentiment | Uses loyalty |
|---|---|---|
| Omerta 1 | 90 | yes |
| Drassen 2 | 30 | yes |
| Alma 3 | 12 | yes |
| Grumm 4 | 15 | yes |
| Tixa 5 | 20 | no |
| Cambria 6 | 15 | yes |
| San Mona 7 | 20 | no |
| Estoni 8 | 20 | no |
| Orta 9 | 20 | no |
| Balime 10 | 12 | yes |
| Meduna 11 | 10 | yes |
| Chitzena 12 | 35 | yes |

`InitTownLoyalty` (`:134-146`) zeroes everything. A town starts tracking only through
`StartTownLoyaltyIfFirstTime(town)` (`:149-180`), called whenever a sector of it becomes player controlled
(`Player_Command.cc:111`): if `!fStarted && usesLoyalty`: rating = sentiment; if `!FACT_MIGUEL_READ_LETTER ||
FACT_REBELS_HATE_PLAYER`: Omerta 0, others sentiment/2; `sChange = 0`; started. `SetTownLoyalty` (`:184-197`) sets the
rating, clears `sChange` and marks the town started (only towns that use loyalty).

### 2.2 The accumulator

```
IncrementTownLoyalty(town, x):                                       // :204-237, x UINT32 > 0
  if !started: return
  x = x * (5*sentiment) / 100                                         // UINT32
  while x: k = min(x, 10000); sChange += k; UpdateTownLoyaltyRating(town); x -= k
DecrementTownLoyalty(town, x):                                       // :241-273, x is POSITIVE
  if !started: return
  x = x * 100 / (5*sentiment)
  while x: k = min(x, 10000); sChange -= k; Update…; x -= k
UpdateTownLoyaltyRating(town):                                       // :277-345
  d = sChange / 500                                                   // truncation toward zero
  if d > 0:
    max = (town == OMERTA && civGroupHostile[REBEL] != NEUTRAL) ? 10 : 100
    if rating + d >= max: rating = max; sChange = 0 else: rating += d; sChange %= 500
  elif d < 0:
    if rating + d < 0: rating = 0; sChange = 0 else: rating += d; sChange %= 500   // remainder keeps its sign
```
Sentiment 20 is neutral (×1); Omerta gains ×4.5 and loses ×0.22; Meduna gains ×0.5 and loses ×2. Example: battle won
in D13, Drassen at distance 0: 500 × 175% = 875 → ×150/100 = 1312 → +2 points, remainder 312. ja2-node reports a
changed rating as the `loyaltyChanged` event.

### 2.3 Distance-adjusted global events

```
HandleGlobalLoyaltyEvent(type, sector):                              // :850-923
  town = sector.z == 0 ? townOf(sector) : BLANK
  if town == SAN_MONA: return                                        // events inside San Mona are ignored everywhere
  base = table below; BATTLE_WON and QUEEN_BATTLE_WON first call CheckConditionsForTriggeringCreatureQuest
  AffectAllTownsLoyaltyByDistanceFrom(base, sector)

AffectAllTownsLoyaltyByDistanceFrom(change, sector):                 // :926-1028
  dist[t] = 999999
  g = CreateNewPlayerGroupDepartingFromSector(sector)                 // temporary empty foot group (16)
  for ts in g_town_sectors: if dist[ts.town] > 0:
    d = FindStratPath(sector, ts.sector, g, false)                    // sectors on the quickest path; 0 if same sector OR no path; ≤ 30
    dist[ts.town] = min(dist[ts.town], d)
  RemoveGroup(g)
  for t in 1..12: if !started[t]: continue
    if sector.z != 0: dist[t] *= 2
    pct = dist < 3 ? 25*(3 − dist) : dist > 3 ? max(−100, −10*(dist − 3)) : 0
    adj = change * (100 + pct) / 100
    adj > 0 ? IncrementTownLoyalty(t, adj) : adj < 0 ? DecrementTownLoyalty(t, −adj) : skip
```

| Event | Base | Raised by |
|---|---|---|
| `BATTLE_WON` | +500 | tactical victory when anyone was fought (`Overhead.cc:4595-4596`); autoresolve win (`Auto_Resolve.cc:319, 1294`) |
| `QUEEN_BATTLE_WON` | +1000 | `End_Game.cc:270` |
| `BATTLE_LOST` | −750 | tactical defeat (`Overhead.cc:4474-4475`); autoresolve loss (`Auto_Resolve.cc:1317, 1324`) |
| `ENEMY_KILLED` | +50 | every enemy or creature death in tactical (`Overhead.cc:2467`), autoresolve kills (`Auto_Resolve.cc:314, 1780`) |
| `NATIVE_KILLED` | −50 | militia death in tactical (`Overhead.cc:2447`) and autoresolve (`Auto_Resolve.cc:1745`) |
| `GAIN_TOWN_SECTOR` / `LOSE_TOWN_SECTOR` | +500 / −1000 | §2.6 |
| `LIBERATE_WHOLE_TOWN` | +1000 | §2.7 |
| `ABANDON_MILITIA` | −750 (however many) | `HandleLoyaltyImplicationsOfMercRetreat` when the sector has militia (`:1187-1207`: tactical exit, PBI retreat, autoresolve retreat); `EndTacticalBattleForEnemy` on unload when militia and enemies/creatures are both still standing (`Queen_Command.cc:284-288`) |
| `GAIN_MINE` / `LOSE_MINE` | +1000 / −1500 | §2.6 |
| `GAIN_SAM` / `LOSE_SAM` | +250 / −250 | §2.6 |

The pathfinder honours the SHIFT key ("direct path", `Strategic/Strategic_Pathing.cc:204-208`) even for this hidden
call; ja2-node never holds it (`deviations.md` "Loyalty distance path"). ja2-node: `shortestTownDistances` with a
throw-away foot group and `16`'s `findStratPath`.

### 2.4 Event catalogue (all loyalty changes)

Amounts are before sentiment scaling; "everywhere" = every started town, no distance.

| Event | Change | Conditions |
|---|---|---|
| Global events of §2.3 | see table | — |
| Civilian killed in tactical | §2.5 | |
| Militia training session | +1000 to the training town | ≥1 militia placed (§1.5) |
| Local NPC recruited | +25 × `bTownAttachment` to his home town | hired while in his home town (`:596-614`, `Soldier_Profile.cc:712`) |
| Head miner attacked | −10000 to the mine's town | first attack only; mine shut down permanently (`Strategic_Mines.cc:945-968`) |
| Creatures eat civilians | −n × 5000 × 2 (decrement) | strategic creature town attack (`:808-826`) |
| Inactivity | everywhere −5000 × k | §2.8 |
| Rebels betrayed | Omerta → 10 (and capped at 10 while rebels hostile); other towns → rating/3 via `SetTownLoyalty` | `REBEL_CIV_GROUP` turns hostile (`Overhead.cc:2759-2765`, `Strategic_Event_Handler.cc:872`) |
| Quests | `25` §2.4 (amounts per NPC and per death) | `HandleLoyaltyChangeForNPCAction` (`:1081-1126`); `Overhead.cc:2363-2411`; `Interface_Dialogue.cc:2720, 3441` |
| Deidranna killed | every loyalty town → 100 | `MaximizeLoyaltyForDeidrannaKilled` (`:1210-1220`) |

Stracciatella has no robbery or building-damage loyalty (the vanilla stubs are gone; the multipliers at `:63-68` are
unused). ja2-node wires every row (quest rows through the NPC actions) except civilian murder (§2.5) and the head-miner
attack (`playerAttackedHeadMiner` exists, nothing calls it; `deviations.md` "Implications of an attack").

### 2.5 Civilian murder

```
HandleMurderOfCivilian(v):                                           // :351-591
  k = v.attacker; if !k: return
  if v.team != CIV || v.body == CROW: return                          // militia never pass this
  if v.profile && profile.miscFlags3 & TOWN_DOESNT_CARE_ABOUT_DEATH: return
  if v.civGroup in {KINGPIN, ALMA_MILITARY, HICKS, WARDEN}: return
  team = k.team
  if team == OUR: HandleMoraleEvent(k, MORALE_KILLED_CIVILIAN)        // −5 strategic, whole team
  town = townOf(v.sector); if town == BLANK || !usesLoyalty[town]: return
  x = FATCIV..COW ? [2500, 3500, 4000, 5000, 10000, 10000, 10000, 500][body − FATCIV] : 5000   // fat, man, mini, dress, hatkid, kid, cripple, cow
  if !v.fIntendedTarget: x = x*50/100
  seen = 0; for c in CIV team (all active, id order), c != v:
    if SoldierToSoldierLineOfSightTest(c, k, STRAIGHT_RANGE, true): seen |= 1
    if SoldierToSoldierLineOfSightTest(c, v, STRAIGHT_RANGE, true): seen |= 2
  if team != OUR:
    blame = [100 − rating, 10, 50, 0][seen]
    if Random(100) < blame: team = OUR; x = x*50/100                  // falsely accused
  OUR: decrement · ENEMY: enemy-controlled sector → increment, else x = x*25/100, decrement
  MILITIA: if !FACT_REBELS_HATE_PLAYER: x = x*70/100, decrement      // else nothing is set: decrement by the full x
  CREATURE: only if killer body is an adult monster..queen: x *= 2; enemy sector → increment, else decrement
            (any other creature killer: nothing is set: decrement by the full x)
  (another team with no case: assert and return)
  if decrement: x = −x
  x = x*100/175                                                       // compensates the distance-0 +75 %
  AffectAllTownsLoyaltyByDistanceFrom(x, v.sector)
```
The two "nothing is set" cases decrement because `fIncrement` keeps its initial FALSE (`:358`), although the source
comments suggest otherwise (`:537-572`).

**Not ported**: ja2-node has no `HandleMurderOfCivilian` (the civilian death rules in
`src/sim/tactical/narrative/death-rules.ts` cover only named profiles), so killing a civilian changes neither loyalty nor
morale. The body cost table is transcribed (`town-loyalty.json` `civilianMurderCost`) and unused.

### 2.6 Sector control changes

`SetThisSectorAsPlayerControlled(sector, contested)` (`Strategic/Player_Command.cc:57-218`; `16` decides when):
1. no-op in meanwhiles; surface: `NumHostilesInSector > 0` → return (too early);
2. Drassen airport sector opens Bobby Ray (`21`);
3. `wasEnemy = fEnemyControlled`; `fEnemyControlled = false`; town sector → `StartTownLoyaltyIfFirstTime`;
4. only if `wasEnemy && contested` (a battle was won, autoresolve or tactical; group arrival in an empty sector passes
   `contested = FALSE`, `Strategic_Movement.cc:1397`):
   - town sector, not (Omerta on day 1), not J9 (Tixa) or K4 (Orta): `MORALE_TOWN_LIBERATED` (+5 everyone),
     `GAIN_TOWN_SECTOR`, `CheckIfEntireTownHasBeenLiberated` (§2.7);
   - mine entrance with ore left (`GetTotalLeftInMine > 0`): `MORALE_MINE_LIBERATED` (+8), `GAIN_MINE`;
   - SAM sector: meanwhile (`26`), `MORALE_SAM_SITE_LIBERATED` (+3), `GAIN_SAM`, Skyrider quote, and on the
     first-ever surface control a grace period `UpdateLastDayOfPlayerActivity(day + 1)` (+2 on hard);
   - refuel site → `UpdateRefuelSiteAvailability`; M2–M6/N6 → Meduna outskirts meanwhile (`26`);
5. if `contested` (surface, even when the sector was already ours): `StrategicHandleQueenLosingControlOfSector` (`17`,
   `:190-193`);
6. `fSurfaceWasEverPlayerControlled = true`; `UpdateAirspaceControl()` (§4) for every change.

`SetThisSectorAsEnemyControlled(sector)` (`:222-324`): skipped while `gfAutomaticallyStartAutoResolve`; surface:
`wasPlayer = !fEnemyControlled`; set enemy controlled; if `wasPlayer`: our mercs still there → return (too early);
town (not J9/K4): `MORALE_TOWN_LOST` (−5), `LOSE_TOWN_SECTOR`, `CheckIfEntireTownHasBeenLost`; mine with ore:
`QueenHasRegainedMineSector`, `MORALE_MINE_LOST` (−8), `LOSE_MINE`; SAM: `MORALE_SAM_SITE_LOST` (−3), `LOSE_SAM`;
refuel; message. Then, **outside** the `wasPlayer` branch (also for enemy reinforcements), theft if the sector was ever
visited: `RemoveRandomItemsInSector(sector, min(90, 5 × NumEnemiesInAnySector))` (`Strategic_Town_Loyalty.cc:616-670`):
for each existing, visible (and, for an unloaded sector, reachable) item of the sector's item list in list order,
`Random(100) < chance` removes it. Air control is updated.

ja2-node: `src/sim/strategic/map/control.ts` makes the control decisions (including Omerta day 1, J9/K4 and the SAM
grace period) and calls the world port's `startTownLoyalty`, `sectorLiberated` and `sectorTakenByEnemy`, which
`economyWorldPort` routes to `loyalty.ts` `startTownLoyaltyIfFirstTime`, `onSectorLiberated` and `onSectorTakenByEnemy`;
theft is `src/sim/campaign/sector-loot.ts` `removeRandomItemsInSector` (loaded sector: every visible world item; else the
sector's stored items that exist, are visible and reachable).

### 2.7 Whole towns

`CheckIfEntireTownHasBeenLiberated(town, sector)` (`Strategic_Town_Loyalty.cc:1033-1062`): if `!fLiberatedAlready` and
every town sector is under control (`GetTownSectorsUnderControl == GetTownSectorSize`, §3.5): if the town allows militia
training → `LIBERATE_WHOLE_TOWN`, history, meanwhile (`26`); activity until `day + 2` (+4 on hard); `fLiberatedAlready =
true` (even for Orta/Tixa). It runs only on contested captures, so a town completed by walking into an empty last sector
never gets the bonus (quirk, §7). `CheckIfEntireTownHasBeenLost` (`:1064-1076`) only posts a meanwhile.
`GetNumberOfWholeTownsUnderControl` (`:758-775`) counts loyalty towns fully held (dialogue, Queen).

### 2.8 Daily drift: none; the inactivity penalty

Stracciatella has no periodic loyalty drift (vanilla's `HandleTownLoyalty` drift and civilian theft were already
commented out, V: `StrategicTownLoyalty.c:380-411`, and the call is gone). The only periodic change is Enrico's
inactivity check, `HandleEnricoEmail` at 07:00 daily (`Strategic/Strategic_Status.cc:246-391`, `ENRICO_MAIL_TIME`,
`StrategicMap.cc:126`):

```
tolerance = hard ? 7 − 2 + highest/42 : 6 − difficulty + highest/42        // :231-243; EASY 1, MEDIUM 2, HARD 3 → 5/4/5 days (+0..2)
first matching branch only:
  creatures attacked a mine and no mail yet → mail; return              // returns skip the reset at the end
  current ≥ 20 / 55 / 80 % progress and no such mail yet → mail; return
  major setback (highest − current ≥ 15, or ≥ 5 after a recovered setback) → mail
  else first minor setback (≥ 5) → mail
  else back at highest after a minor setback → flag
  else if day > lastActiveDay:
    inactive++
    if inactive >= tolerance:
      complaint mail: inactive == t → first unsent of 1, 2, 3; == 2t → first unsent of 2, 3; == 3t → 3
      DecrementTownLoyaltyEverywhere(5000 × (inactive − t + (mail 2 sent, today's included ? 1 : 0)))
newSectorsToday = min(newSectorsToday, 4) / 3
```
A day with a progress or setback mail therefore does not count as inactive, and a day with a creature or progress mail
also keeps the full new-sector count. Activity (`UpdateLastDayOfPlayerActivity(day)` resets the counter when
`day > lastActiveDay`, `:221-228`): damage to an enemy in a sector that is enemy controlled or not `TOWN` traversability,
damage to any creature (`Soldier_Control.cc:5442-5459`); the 4th new sector visited in a day (`Tactical_Save.cc:795-800`);
whole-town liberation (+2/+4 days); first SAM capture (+1/+2).

ja2-node: `inactivity.ts` `handleEnricoEmail` returns the mail kind and the penalty; the laptop flow
(`src/sim/campaign/laptop/laptop-flow.ts`) owns the `ENRICO_MAIL` event, sends the mail and writes the complaint history.
**Not ported**: the damage rule of `Soldier_Control.cc:5442-5459`, so fighting without capturing a sector or visiting a
4th new one in a day does not count as activity.

### 2.9 Effects of loyalty

| Effect | Rule | Source |
|---|---|---|
| Militia training | rating ≥ 20 to start and to continue | §1.2, §1.5 |
| Mine income | player workforce = rating × controlled/size; Queen workforce = (100 − rating) × uncontrolled/size | §3.5 |
| Head miner "disloyal" dialogue | rating < 50 | `Strategic_Mines.cc:848-863` |
| Omerta cap | 10 while rebels hostile | §2.2 |
| Bobby Ray delivery | shipment lost if the destination town's rating < 20 or the airport is enemy controlled | `Strategic_Event_Handler.cc:89-95` |
| NPC willingness to talk (recruiting) | `iTownVal = rating × townAttachment / 100` mixed with opinion and approach | `TacticalAI/NPC.cc:470-505` |
| Facts `LOYALTY_LOW` < 30, `OKAY` 30..49, `HIGH` ≥ 80 (started loyalty towns only) | | `Strategic/Quests.cc:785-830`, `Quests.h:211-213` |
| Civilian quotes | cosmetic | `Tactical/Civ_Quotes.cc:563-569` |

No effect on prices, on sector income other than mines, or on enemy behaviour.

### 2.10 RNG in loyalty code

`Random(100)` false accusal in `HandleMurderOfCivilian` (non-player killers only; not ported, §2.5); `Random(100)` per
item in `RemoveRandomItemsInSector`. Everything else is deterministic (the LOS tests and `FindStratPath` draw nothing).

---

## 3. Mines

### 3.1 Data

`strategic-mines.json` (order = mine id, saves depend on it): San Mona D4 gold, abandoned (`minimumMineProduction` 0);
Drassen D13 silver 1000 (`delayDepletion`); Alma I14 silver 1500 (`headMinerAssigned`, `noDepletion`); Cambria H8 silver
1500; Chitzena B2 silver 500; Grumm H3 gold 2000. Each lists its underground sectors (used for monsters). Head miners
(`Strategic_Mines.cc:50-58`, `data/tables/head-miners.json`): FRED, MATT, OSWALD, CALVIN, CARL with quote numbers
(running out, creatures, creatures gone, creatures again). Constants (`:28-37`): `REMOVAL_RATE_INCREMENT 250`,
`LOW_MINE_LOYALTY_THRESHOLD 50`, 4 periods per day at 09:00, 12:00, 15:00, 18:00, warning at 2.5 days of supply.

### 3.2 New game: `InitializeMines` (`Strategic_Mines.cc:61-159`, called from `InitStrategicLayer`, `Game_Init.cc:155`)

```
for each mine i: rate[i] = minimumMineProduction; empty[i] = rate == 0      // other fields zero
n = hard ? 20 : 25
while n--: do i = Random(numMines) while empty[i]; rate[i] += minimumMineProduction[i] / 5
do d = Random(numMines) while empty[d] || noDepletion[d]                   // the one mine that will run out
for each mine:
  i == d: days = delayDepletion ? 20 : 10; supply = days*4*rate; runOutPoint = u32(2.5*4*rate)
  else if !empty: supply = 999999999; runOutPoint = 0
  else: supply = 0; runOutPoint = 0
```
Both loops retry, so the number of `Random(6)` draws varies (San Mona, index 0, is always rejected). Total expected
production is fixed per difficulty; which mine grows and which one depletes is random.

### 3.3 Head miners and "spoke to the head miner"

On the first surface entry into any non-abandoned mine sector (`HandleQuestCodeOnSectorEntry`, `StrategicMap.cc:668-741`):
unless the mine has `headMinerAssigned` (Alma/Matt), FRED is placed there with `bTown` = that mine's town; then each
other non-abandoned mine without an assigned miner gets one of profiles {106, 156, 157, 158} by `do Random(4) while used`
until 4 have been placed; `FACT_MINERS_PLACED`. The head miner's `bTown` links him to the mine (`GetHeadMinersMineIndex`,
`Strategic_Mines.cc:798-814`). ja2-node: `mines.ts` `placeHeadMinersOnSectorEntry`, called by the narrative flow on
sector entry.

**Production for the player requires `fSpokeToHeadMiner`**, set by `PlayerSpokeToHeadMiner` from the NPC action
`NPC_ACTION_START_MINE` (`Tactical/Interface_Dialogue.cc:2788-2800`, also restarts a shut-down mine);
`NPC_ACTION_STOP_MINE` shuts it down; `NPC_ACTION_RESET_MINE_CAPTURED` clears `fQueenRetookProducingMine`. ja2-node runs
them as NPC actions (`src/sim/tactical/narrative/npc-actions/cambria.ts`, `35` §1.7).

### 3.4 The income event

`EVENT_SETUP_MINE_INCOME` runs every day at 00:00 (`StrategicMap.cc:2251`); `PostEventsForMineProduction`
(`Strategic_Mines.cc:516-524`) posts four one-shot `EVENT_HANDLE_MINE_INCOME` events at today + 540, 720, 900, 1080
minutes. Each runs `HandleIncomeFromMines` (`:527-540`; dispatch `Game_Event_Hook.cc:170-176`):

```
income = Σ over mines in id order of MineAMine(i)
if income != 0: AddTransactionToPlayersBook(DEPOSIT_FROM_SILVER_MINE, 0, now, income)   // one entry, gold included
```

### 3.5 Workforce, extraction, depletion

```
GetTownSectorsUnderControl(town) = #town sectors not enemy controlled AND NumEnemiesInSector == 0   // StrategicMap.cc:290-301
workforcePlayer(i) = shutDown || !spoke ? 0 : rating[town] * underControl / size            // Strategic_Mines.cc:360-398
workforceEnemy(i)  = shutDown ? 0 : (100 − rating[town]) * (size − underControl) / size     // :402-433
rate(i, w)         = maxRemovalRate[i] * w / 100                                             // :437-457
PlayerControlsMine(i) = !StrategicMap[entrance].fEnemyControlled && spoke                    // :610-618

MineAMine(i):                                                         // Strategic_Mines.cc:462-513
  if empty || shutDown: return 0
  if PlayerControlsMine(i):
    got = ExtractOreFromMine(i, rate(i, workforcePlayer))
    if got > 0 && !producedForPlayer: producedForPlayer = true; timeProductionStarted = now
    return got
  if producedForPlayer: ExtractOreFromMine(i, rate(i, workforceEnemy))   // the Queen depletes, earns nothing
  return 0

ExtractOreFromMine(i, amount):                                        // Strategic_Mines.cc:291-356
  if shutDown || amount == 0: return 0
  if amount >= supply:
    got = supply; supply = 0; maxRemovalRate = 0; empty = true; runningOut = false
    StrategicHandleMineThatRanOut(entrance) (17); history MINE_RAN_OUT
  else:
    got = amount; supply −= amount
    if supply < runOutPoint:
      runningOut = true
      maxRemovalRate = u32(f32(f32(f32(supply) / 10) / 250) + 0.9999) * 250   // FLOAT, then double add
      if PlayerControlsMine(i) && !warned: head miner quote (stops compression); warned = true; history
  return got
```
Below the warning point the rate is recomputed after every extraction (≈ 10 % of the remaining ore per period at full
workforce), so a depleting mine dwindles over several days and the Queen's extraction can run it dry while she holds it.
Example: Drassen with 4 bumps (rate 1800), loyalty 60, all 3 sectors held: 1800 × 60/100 = 1080 per period, $4320 a day.
ja2-node's `runningOutRemovalRate` reproduces the float steps with `Math.fround`.

### 3.6 Ownership change effects

Capture and loss run the mine branches of §2.6 (morale ±8, `GAIN_MINE` +1000 / `LOSE_MINE` −1500 base). On loss,
`QueenHasRegainedMineSector` sets `fQueenRetookProducingMine` if the mine ever produced for the player (head miner
dialogue, `25` §1.3). Control of the town's other sectors only changes the workforce share (§3.5); the mine changing
hands touches the town's loyalty only through these global events.

### 3.7 Monsters and shutdowns

`HourlyMinesUpdate` (`:162-234`), hourly from `HandleHourlyUpdate` and 15 s after any creature death underground
(`EVENT_CHECK_IF_MINE_CLEARED`, `Queen_Command.cc:887`, `Game_Event_Hook.cc:287-290`): for each non-empty mine, if
`MineClearOfMonsters` (`Creature_Spreading.cc:676-`: no creatures in its sectors; once invaded, not until the creature
queen is dead) and shut down but not permanently → quote if player-controlled, `RestartMineProduction`; else if infested
and producing → first time: `fPrevInvadedByMonsters`, start `QUEST_CREATURES`; quote if player-controlled;
`ShutOffMineProduction`. Creatures exist only with the sci-fi option; in ja2-node `hooks.mineClearOfMonsters` comes from
`src/sim/campaign/creature-flow.ts` (`17` §12). `PlayerAttackedHeadMiner` (`:945-968`, from `Overhead.cc:5499-5502`):
first time → shut down, permanent, −10000 loyalty (not called in ja2-node, §2.4). `AreThereMinersInsideThisMine`
(`:1000-1018`) decides whether civilians are placed in underground mine levels.

### 3.8 Prediction, UI values, progress, difficulty

- `PredictDailyIncomeFromAMine(i)` (`Strategic_Mines.cc:543-556`) = `PlayerControlsMine ? min(4 × rate(i, workforcePlayer), supply) : 0`;
  `PredictIncomeFromPlayerMines` sums it: the map screen's projected income (`GetProjectedTotalDailyIncome`,
  `Laptop/Finances.cc:224-242`) and the input of `CalcDifficultyModifier` (−5 when 0, §1.9).
- `GetMaxDailyRemovalFromMine` (`:263-273`) = `shutDown ? 0 : min(4 × maxRemovalRate, supply)`.
- `CalcMaxPlayerIncomeFromMines` (`:574-582`) = Σ 4 × `maxRemovalRate` over all mines. An emptied mine's rate is 0, so
  the denominator of the income share of `CurrentPlayerProgressPercentage` shrinks (`Tactical/Campaign.cc:1189-`, weights
  from `game.json` `progress`, 50 % income; `17`).
- Mine info box (`Map_Screen_Interface_TownMine_Info.cc:236-310`): status (abandoned / shut down / running out /
  producing), predicted daily income, max daily removal, production % (predicted × 100 / max), town control %, loyalty
  (if started), type. Remaining ore is debug-only.

### 3.9 Money and the ledger

- Balance `LaptopSaveInfo.iCurrentBalance` (INT32), new-game value `game.json` `starting_cash_{easy,medium,hard}`
  (45000/35000/30000; `15` does init).
- `AddTransactionToPlayersBook(code, secondCode, minute, amount)` (`Laptop/Finances.cc:159-214`): balance += amount;
  append `{code, secondCode, minute, amount, balanceAfter}`; for `HIRED_MERC`, `IMP_PROFILE`, `PAYMENT_TO_NPC`,
  `EXTENDED_CONTRACT_*` also `profile[secondCode].uiTotalCostToDate += −amount`. It never refuses: callers check the
  balance (militia: `balance >= cost`). Codes (`Laptop/Finances.h:15-45`) used here: `DEPOSIT_FROM_SILVER_MINE`,
  `TRAIN_TOWN_MILITIA`, `PAYMENT_TO_NPC` (daily RPC salary, `22`), `TRANSFER_FUNDS_TO_MERC` (Larry, `35` §2.4).
- Skyrider's per-sector bill (§4.4) is accumulated and paid through the same function (`16`).

ja2-node: `src/sim/campaign/finances.ts` (`FinanceCode`, `addTransaction`, `currentBalance`) on `StrategicState.finances`
(`deviations.md` "Finance ledger"); `finance-summary.ts` derives the laptop's daily figures from the ledger; every
transaction is a `moneyChanged` event.

### 3.10 RNG in mine code

`Random(numMines)` loops in `InitializeMines`; `Random(4)` loop in head miner placement. Production: none.

---

## 4. SAM sites and air control

### 4.1 Data

`strategic-map-sam-sites.json`: D2, D15, I8, N4 in that order (ids 0–3), each with the two adjacent gridnos of the
control computer; the graphic orientation is derived from the gridno difference (`SamSiteModel.cc:12-17`).
`strategic-map-sam-sites-air-control.json`: a 16×16 table, value = SAM id + 1 or **0 = covered by no SAM**
(`SamSiteAirControlModel.h:14-22`; the JSON header comment saying "any SAM site" is wrong). A9, A10 are 0.
`MIN_CONDITION_FOR_SAM_SITE_TO_WORK 80` (`SAM_Sites.h:188`).

### 4.2 Condition and damage

`InitializeSAMSites` (`SAM_Sites.cc:25-35`): condition 100 for all four, then `UpdateAirspaceControl`. Structure damage
to one of the two gridnos in that sector (`OnStructureDamaged` listener, `:154-179`, raised by explosion damage, `12`):
`condition = max(0, condition − damage)`, `UpdateAirspaceControl`. Only the Queen repairs: an arriving reinforcement group
that refills a SAM garrison sets condition 100 and swaps the graphic back (`Strategic_AI.cc:1011-1013`,
`UpdateSAMDoneRepair`, `SAM_Sites.cc:37-67`; ja2-node `src/sim/strategic/ai/orders.ts`). The player cannot repair SAM
sites (removed in V, `Assignments.c:449`).

**Not ported**: the structure-damage listener. `src/sim/strategic/map/sam.ts` `damageSamIfFound` exists but nothing calls
it, so explosions never lower a SAM's condition.

### 4.3 `UpdateAirspaceControl` (`SAM_Sites.cc:69-96`)

For every map sector 1..16 × 1..16: `fEnemyAirControlled = (controlling SAM s ≥ 0) && StrategicMap[sam s].fEnemyControlled
&& condition ≥ 80`. Called on every control change (both directions, §2.6), on SAM damage and repair, and at init. It
raises `OnAirspaceControlUpdated`, whose handler moves the merc arrival sector back to the start sector if the chosen
one became enemy air (`StrategicMap.cc:2296-2310`, `21`). ja2-node: `src/sim/strategic/map/control.ts`
`updateAirspaceControl`, `initializeSamSites`.

### 4.4 Consumers (summary; helicopter movement is `16`)

| Consumer | Rule | Source |
|---|---|---|
| Skyrider path cost | strategic A* for the helicopter group costs 100 per safe sector, 1000 per enemy-air sector (not time) | `Strategic_Pathing.cc:318-328`, `Map_Screen_Helicopter.h:12-13` |
| Skyrider bill | +$100 safe / +$1000 unsafe per sector flown (not when returning to base or cancelled before leaving) | `Map_Screen_Helicopter.cc:247-257` |
| SAM shot | on entering an enemy-air sector whose SAM works: `PreRandom(100) < min(condition, 33)` → hit; 1st minor damage, 2nd forced return to base, 3rd destroyed | `Map_Screen_Helicopter.cc:1046-1130` |
| Refuel sites | unavailable if the site sector is enemy controlled or enemy air (Estoni also needs a fact) | `:615-640` |
| Unsafe-sector counts for the route UI | `GetNumSafeSectorsInPath`/`GetNumUnSafeSectorsInPath` | `:1236-1350` |
| Militia | any SAM sector may hold and train militia | §1.1 |
| Loyalty/morale | capture/loss events (§2.6) | |

---

## 5. Assignments

### 5.1 Kinds and conditions

`Assignments` (`Strategic/Assignments.h:28-65`): `SQUAD_1..SQUAD_20` (0–19), `ON_DUTY` 20 (the boundary, never assigned
itself), `DOCTOR`, `PATIENT`, `VEHICLE`, `IN_TRANSIT` (hired, not arrived), `REPAIR`, `TRAIN_SELF`, `TRAIN_TOWN`,
`TRAIN_TEAMMATE`, `TRAIN_BY_OTHER`, `ASSIGNMENT_DEAD`, `ASSIGNMENT_UNCONCIOUS` (unused), `ASSIGNMENT_POW`,
`ASSIGNMENT_HOSPITAL`, `ASSIGNMENT_EMPTY`. "On a squad" = `assignment < ON_DUTY`; everything from `DOCTOR` up except
`VEHICLE` is a non-combat assignment. Trainable stats (`:70-82`): STRENGTH, DEXTERITY, AGILITY, HEALTH, MARKSMANSHIP,
MEDICAL, MECHANICAL, LEADERSHIP, EXPLOSIVE (not wisdom).

`AreAssignmentConditionsMet(s, allowed)` (`Assignments.cc:356-369`): each condition holds unless its flag is passed;
always: not `IN_TRANSIT`, not POW.

| Flag | Condition when not allowed |
|---|---|
| `AC_IMPASSABLE` | the sector is passable (`SectorIsPassable`) |
| `AC_UNCONSCIOUS` | life ≥ OKLIFE |
| `AC_COMBAT` | not (in the loaded sector and `fEnemyInSector`) |
| `AC_EPC` | not an EPC |
| `AC_IN_HELI_IN_HOSTILE_SECTOR` | not in the helicopter over a sector with enemies |
| `AC_MECHANICAL` | not a vehicle or robot |
| `AC_MOVING` | not between sectors |
| `AC_UNDERGROUND` | surface |

| Kind | Eligibility | Source |
|---|---|---|
| Doctor | medical > 0, conditions (underground allowed), a `MEDICKIT` in HANDPOS..SMALLPOCK8 (first aid kits do not count) | `:372-398`; `Tactical/Items.cc:3280-3283` |
| Patient | life > 0, (life < max or stats damaged with `enable_stat_healing`), conditions allowing unconscious, EPC, underground | `:594-613` |
| Hospital | as patient; Cambria F8 (`HOSPITAL_SECTOR_*`), paid via Vince (`25` §6.3) | `:5948-5956` |
| Repair | mechanical > 0, conditions (underground allowed), a `TOOLKIT`, and something to repair: own/others' items (jammed or damaged repairable), the robot, or an accessible damaged vehicle (never the helicopter) | `:406-592` |
| Train self / by other | conditions `AC_NONE`, stat ≠ 0 and < 85 | `:710-721` |
| Train teammate | conditions `AC_NONE`, stat ≥ 25 (`MIN_RATING_TO_TEACH`) | same |
| Train militia | §1.2 | |
| Vehicle | map screen only, an accessible vehicle in the sector, not in a battle in the loaded sector, conditions allowing EPC and mechanical | `:867-877` |
| Squad | life ≥ OKLIFE, not in transit/POW, squad in the same sector, squad not moving, no vehicle in it, fewer than `squad_size` (6) members | `:894-935` |
| On duty (squad menu) | conditions allowing combat, EPC, mechanical, underground | `:725-729` |

The "train teammate"/"train by other" submenus also require another merc in the sector (`:741-770`), but no partner has
to exist when assigning (the mercs just flash).

### 5.2 Setting an assignment

`SetSoldierAssignment*` (`:5948-6038`) and `SetAssignmentForList` (`:6606-6780`, the map screen multi-select):
1. re-check eligibility (silent failure; the list version reports one failure box);
2. `PreChangeAssignment` (`:3376-3380`): leave the vehicle; `RemoveCharacterFromSquads`;
3. if the assignment (or the repair target) differs: `SetTimeOfAssignmentChangeForMerc` (`:6299-6315`): leaving the
   hospital refunds the unused payment (`25` §6.3); `lastAssignmentChangeMin = now`; request a nothing-to-do
   re-evaluation;
4. kind specifics: doctor/repair swap the kit into HANDPOS (`MakeSureMedKitIsInHand`/`MakeSureToolKitIsInHand`,
   `:3472-3530`: the first kit from SECONDHANDPOS on is swapped with the hand; if SECONDHANDPOS is empty and the
   swapped-out object is not, it goes to SECONDHANDPOS); training sets `trainStat`; hospital stops bleeding; repair sets
   `fixingRobot`/`vehicleUnderRepair`; militia may open the payment prompt (§1.3);
5. `ChangeSoldiersAssignment` (`:297-331`): set it; non-REPAIR clears the repair target; DEAD sets life 0;
   DOCTOR/PATIENT/HOSPITAL post `EVENT_BANDAGE_BLEEDING_MERCS` at now + 1 (§5.6);
6. `AssignMercToAMovementGroup` (`:6366-6377`): a non-squad, non-vehicle, non-transit merc without a group gets a new
   player group in his sector (`16`).

Joining a squad (`AddCharacterToSquad`, `Tactical/Squads.cc:180-200`) wakes a sleeping merc and stamps the time when the
assignment changes. `EnoughTimeOnAssignment(s)` = `now − lastAssignmentChangeMin ≥ 45` (`:1213-1216`): nothing pays out
in the first 45 minutes, and a merc in that window counts as taking it easy (§5.4). ja2-node: `set-assignment.ts`
`assignSoldiers(ctx, ids, target)` runs this per soldier in the given order, each checked independently (`29`).

### 5.3 The hourly order

`HandleHourlyUpdate` (`Strategic/Hourly_Update.cc:35-73`; order and owners in `15` §3.2) starts with `UpdateAssignments`;
`HandleQuarterHourUpdate` (`:85-92`) runs `DecayTacticalMoraleModifiers` every 15 minutes.

```
UpdateAssignments():                                                 // Assignments.cc:954-1029
  1. fSectorsWithSoldiers = sectors (with z) of all OUR mercs (moving mercs count in their sSector)
  2. RecordSleepStatusForPastHour()       // Strac: who was asleep during the hour now being paid out (:276-294)
  3. HandleNaturalHealing()               // §5.5, every OUR non-mechanical merc, id order
  4. CheckForAndHandleHospitalPatients()  // §5.6, only if someone is in F8
  5. ReportTrainersTraineesWithoutPartners()   // TRAIN_TEAMMATE without a valid student, then TRAIN_BY_OTHER without a valid
                                               // teacher (§5.8): AssignmentDone(s, true, true) (:6192-6215)
  6. ClearSectorListForCompletedTrainingOfMilitia()
  7. HandleRestFatigueAndSleepStatus()    // §5.4
  8. for x in 0..17, for y in 0..17, for z in 0..3 (x outer!): if a merc is there:
       HandleDoctorsInSector · HandleRepairmenInSector · HandleTrainingInSector
  9. UpdatePatientsWhoAreDoneHealing()    // PATIENT with full life (and no healable stats): AssignmentDone(true, true)
 10. show the "assignment done" box if queued
 11. HandleContinueOfTownTraining()       // §1.5 prompts
 12. ReEvaluateEveryonesNothingToDo()     // §5.10
```
Vanilla has no step 2 and reads the live `fMercAsleep` in step 8 (V: `Assignments.c:1661-1734, 1989`), so it credits the
hour by the sleep state *after* step 7 has woken and bedded mercs; Stracciatella uses the state *before* it (D1: follow
Strac). ja2-node: `update.ts` `updateAssignments`; the box of step 10 is the client's (`deviations.md` "Update box
timing").

### 5.4 Rest, fatigue and sleep

Thresholds on `breathMax` (`Assignments.h:16-21`): absolute minimum 10 (collapse), 30 must stop moving, 50 pretty tired,
60 cancel collapse, 75 cancel "tired" complaint, 95 fully rested.

```
CalcSoldierNeedForSleep(s):                                          // Assignments.cc:6927-6945
  n = profile.needForSleep (UINT8) + (4 >> (4*life/lifeMax))          // +4 below 1/4 life, +2 below 1/2, +1 below 3/4
  n −= #NIGHTOPS traits; n −= #MARTIALARTS traits                     // UINT8: a wrap below 0 gives ≥ 250 → 12
  return clamp(n, 4, 12)
RestCharacter(s):                                                     // :2037-2070
  g = 50 / need; if breathMax < 50: g = g*3/2
  breathMax = clamp(breathMax + g, 10, 100); breath = breathMax; if breathMax >= 75: complainedThatTired = false
FatigueCharacter(s):                                                  // :2073-2117
  if mechanical || in transit || POW: return
  loss = max(2, 50 / (24 − need))                                     // INT8
  if betweenSectors && assignment != VEHICLE && (w = CalculateCarriedWeight(s)) > 100: loss = min(loss*w/100, 127)
  if breathMax < 50: loss = loss*3/2
  breathMax = clamp(breathMax − loss, 10, 100); breath = min(breath, breathMax)
CharacterIsTakingItEasy(s):                                           // :6903-6924
  asleep → true; !CanCharacterSleep(s) → false
  on a squad or in a vehicle (and able to sleep) → true
  PATIENT or HOSPITAL → true; nothing-to-do flag → true; !EnoughTimeOnAssignment → true; else false
CanCharacterSleep(s):                                                 // :774-835
  conditions allowing impassable, combat, EPC, heli-hostile, moving, underground (so life < OKLIFE → cannot)
  between sectors: on foot → no; in a vehicle and must drive (SoldierMustDriveVehicle) → no
  in a sector, not aboard the airborne helicopter: loaded sector in combat/with enemies → no; surface with enemies → no
  breathMax >= 95 → no ("not tired")
```
`HandleRestFatigueAndSleepStatus()` (`:5677-5806`), all OUR mercs except mechanical, POW, in transit, in id order:
1. taking it easy → `RestCharacter`, else `FatigueCharacter`;
2. if awake: breathMax ≤ 10 → (if not between sectors) `SetMercAsleep` (needs `CanCharacterSleep`); on success squad or
   vehicle mercs say "need sleep" (then "me too") and everyone collapses (`collapsed = true`); else breathMax < 50 and
   not `forcedToStayAwake`: non-squad, non-vehicle mercs fall asleep on their own (notification box); squad/vehicle mercs
   complain once (`complainedThatTired`);
3. second pass: breathMax ≥ 60 clears `collapsed`; asleep and breathMax ≥ 95 → `SetMercAwake` (refused while collapsed,
   `CanCharacterBeAwakened`, `:838-863`, which also sets `collapsed` when breathMax ≤ 10); non-squad mercs get a
   "returning to assignment" notification.

Consequences: a rested merc (≥ 95) on a squad cannot sleep, so he is fatigued that hour and oscillates around 95; a dying
awake merc is fatigued; walking mercs are fatigued (heavier loads faster). Waking by the player sets
`forcedToStayAwake` when breathMax < 50 (`PutMercInAwakeState`, `:6260-6289`), which stops auto-sleep. Sleeping mercs in
the loaded sector play SLEEPING/GOTO_SLEEP, waking ones WKAEUP_FROM_SLEEP (presentation; ja2-node emits `fellAsleep`,
`wokeUp`, `tiredComplaint` instead, `deviations.md` "Assignment presentation").

### 5.5 Natural healing

```
HandleHealingByNaturalCauses(s):                                      // Assignments.cc:2842-2914
  if life == 0 || life == lifeMax || bleeding != 0: return
  div = POW ? 12 : (asleep || PATIENT || HOSPITAL) ? 1 : squad ? (IsTimeBeingCompressed && !groupMoving ? 1 : 12) : 4
  fractLife += (life*100/lifeMax) / div                               // hundredths of a life point
  life += fractLife/100; fractLife %= 100; if life >= lifeMax: life = lifeMax; fractLife = 0   // :2917-2932
```
`IsTimeBeingCompressed()` (`Game_Clock.cc:324-330`) is true only at map-screen compression ≥ 5 minutes per second and
unpaused; the map screen cannot run at ×1 (`SetGameTimeCompressionLevel` turns X1 into X0 there, `:393-427`) and tactical
is always ×1. ja2-node therefore uses `flow === 'strategic'` (`rest.ts` `timeIsCompressedForHealing`, `deviations.md`
"Time compression for healing"). Example: 60 % health → 60 hundredths/h asleep, 15 on assignment, 5 on a squad in
tactical.

### 5.6 Doctoring, bandaging, hospital

```
CalculateHealingPointsForDoctor(d, &max, kitInHand):                 // Assignments.cc:1074-1109 (hundredths per hour)
  if kitInHand && !MakeSureMedKitIsInHand(d): return 0
  pts = u16(EffMed(d) * ((EffDex(d) + EffWis(d)) / 2) * (100 + 5*EffExpLevel(d)) / 2400)
  max = medical*((dex + wis)/2)*(100 + 5*expLevel)/2400               // natural, for display
  ReducePointsForFatigue(d, &pts)
  pts = min(pts, u16(100 * TotalMedicalKitPoints(d)))                  // Σ status of every MEDICKIT object in HAND..SMALLPOCK8
```
Example: Med 80, Dex 80, Wis 70, level 4 → 80 × 75 × 120 / 2400 = 300, i.e. 3 life points per hour.

`CanSoldierBeHealedByDoctor(p, d, thisHour, skipKit, skipSkill)` (`:1397-1408`): p is PATIENT **or DOCTOR** (doctors heal
each other and themselves), alive, hurt (or stats healable), thisHour → enough time on assignment, same sector, not
between sectors, `d.medical ≥ (p.life < OKLIFE ? 20 + 4 × (OKLIFE − p.life) : 1)` (`:1381-1393`), d has a MEDICKIT.

`HandleDoctorsInSector(sector)` (`:1223-1240`): for each OUR merc in the sector on DOCTOR, not asleep in the past hour:
swap the kit into the hand; `CanCharacterDoctor`; enough time; `HealCharacters(d)` (`:1264-1377`):

```
n = #patients healable this hour
if n > 0:
  avail = CalculateHealingPointsForDoctor(d, &max, true); left = avail; even = left / n
  for p in OUR team by id, healable: left −= HealPatient(p, d, even)
  while left > 0: worst = healable patient with the lowest life (first in id order on ties); none → stop
                  before = left; left −= HealPatient(worst, d, left); if left == before: left = 0
  used = avail − left
  StatChange(d, MEDICALAMT, used/100); StatChange(d, DEXTAMT, used/200); StatChange(d, WISDOMAMT, used/200)  // FROM_SUCCESS, pre
if nobody is EVER healable by d: kit missing → abort "no med kits"; skill missing → abort "insufficient skill"; else AssignmentDone(d, true, true)

HealPatient(p, d, h):                                                 // :1426-1628, returns hundredths used
  p.fractLife += h; used = h; pts = p.fractLife/100; p.fractLife %= 100
  if pts == 0: return used
  if p.life < OKLIFE:                                                 // 2 points per life point
    want = min(2*(OKLIFE − p.life), pts)                               // INT8
    for kit in d's MEDICKITs from HANDPOS to SMALLPOCK8:
      u = UseKitPoints(kit, want, d); want −= u; pts −= u; p.life += u/2      // an odd point is consumed without effect
      if want <= 0 || p.life >= OKLIFE: break
  if p.life < p.lifeMax:                                              // 1 point per life point
    want = min(lifeMax − life, pts)
    for kit …: u = UseKitPoints(kit, want, d); want −= u; pts −= u; p.life += u; stop when done or full
  stat healing (only with enable_stat_healing, default false): highest damaged stat, 3 points per stat point
  if p fully healed: used −= 100*pts + p.fractLife; p.fractLife = 0
  return used
```
`UseKitPoints(o, n, s)` (`Tactical/Items.cc:2407-2435`): from the **last** object of the stack backwards, `n < status`
→ status −= n, return n; else consume the object entirely (n −= status); an emptied slot is deleted; returns what was
used. Kit points are the objects' status (`TotalPoints`, `:2394-2404`): a full medical kit heals 100 life points.
ja2-node: `kits.ts` (kit points, kit to hand), `doctor.ts`; aborts are `assignmentAborted` events.

**Bandaging on assignment** (`BandageBleedingDyingPatientsBeingTreated`, `:6461-6528`, the minute event of §5.2): for
each OUR merc bleeding or below OKLIFE on PATIENT/DOCTOR/HOSPITAL: hospital → bleeding 0, life at least OKLIFE, free;
else the first doctor who could ever heal him (`AnyDoctorWhoCanHealThisPatient`, id order) uses his first IC_MEDKIT item
(first aid kit or medical kit, `FindObjClass`): `VirtualSoldierDressWound(d, p, kit, total, total)` with 12 APs
(`RT_FIRST_AID_GAIN_MODIFIER`, `Strategic/Auto_Resolve.cc:910-1056`; formula in `19`), `UseKitPoints(kit, cost)`. Then
all pending copies of the event are deleted and one is re-posted for now + 1 if anyone still bleeds or is dying.
`VirtualSoldierDressWound` checks `inv[0]` (HELMETPOS) for MEDICKIT instead of HANDPOS, so the +50 % never applies
(quirk; tactical `SoldierDressWound` uses HANDPOS, `Soldier_Control.cc:7040`). Its `StatChange` calls draw `pre`.
ja2-node reaches it through the crew port's `dressWound` (autoresolve's port of the function).

**Hospital** (paid through Vince, `25` §6.3): `HealHospitalPatient` 5 points per hour (2 per life point below OKLIFE),
done at full life (`:1634-1714`).

### 5.7 Repair

```
CalculateRepairPointsForRepairman(r, &max, kitInHand):               // Assignments.cc:1116-1171 (points per hour, UINT8)
  if kitInHand: MakeSureToolKitIsInHand(r)
  if r.inv[HANDPOS] != TOOLKIT: max = 0; return 0
  pts = u16(EffMech*EffDex*(100 + 5*EffExpLevel) / (2500*24))
  max = mechanical*dex*(100 + 5*expLevel) / 60000
  ReducePointsForFatigue(r, &pts)
  kit = Σ status of all TOOLKITs in HAND..SMALLPOCK8: < 25 → 50 %, < 50 → 75 %, else 100 %
  return u8(pts*kit/100)
```
Example: Mech 80, Dex 80, level 4 → 12 points per hour.

`HandleRepairmenInSector` (`:1721-1738`): REPAIR mercs in the sector, not asleep in the past hour, toolkit to hand,
`CanCharacterRepair`, enough time → `HandleRepairBySoldier(s)` (`:1893-2023`):

```
init = CalculateRepairPointsForRepairman(s, &max, true); if init == 0: AssignmentDone(s, true, true); return
left = init
vehicle target: if repairable: left −= RepairVehicle(v, left)        // Vehicles.cc:692-717: life += left/10, used = Δlife*10
robot target: if repairable: left /= 2; init /= 2; no ELECTRONICS → /2 again; left −= RepairRobot(left)  // 1 point = 1 life
items:
  own = UnjamGunsOnSoldier(s, s, &left)                               // :7136-7181: HAND..SMALLPOCK8 guns with negative
                                                                      // ammo status: 2 points each, flip the sign,
                                                                      // MECH 5 + DEX 5 StatChange; stop when < 2 left
  for slot in SECONDHANDPOS..SMALLPOCK8, then HELMETPOS..HEAD2POS (HANDPOS holds the kit):
    if RepairObject(s, s, slot, &left): own = true; if left == 0: break   // break leaves only the current range
  if own && nothing of his own is left: message, stop compression
  RepairItemsOnOthers(s, &left)
used = init − left
if used > 0: StatChange(MECHANAMT, used/2); StatChange(DEXTAMT, used/2); if Random(100) < used*5: UseKitPoints(HANDPOS kit, 1)
if HasCharacterFinishedRepairing(s): AssignmentDone(s, true, true)
elif used == 0: abort "no toolkit" if he has none, else "insufficient skill"

RepairObject(r, owner, o, &left): each object of the stack, then each attachment: DoRepair (repairable and status < 100)
DoActualRepair(r, item, &status, &left):                              // :1782-1835
  adj = max(10, 100 − 10*repairEase); electronic item and no ELECTRONICS trait → adj *= 2
  dmg = (100 − status) * adj / 100
  if left >= dmg: status = 100; left −= dmg
  else: fix = left*100/adj; if fix > 0: status = min(100, status + fix); left = 0

RepairItemsOnOthers(r, &left):                                        // :7049-7133
  for pass in HANDS_AND_ARMOR (HAND, SECONDHAND, VEST, HELMET, LEG), HEADGEAR (HEAD1, HEAD2), POCKETS (big 1-4, small 1-8):
    for o in OUR team by id, eligible (CanCharacterRepairAnotherSoldiersStuff): UnjamGunsOnSoldier(o, r, &left)
    while left > 0:
      pick the eligible teammate with the highest bExpLevel (strict >, first in id order on ties) having a repairable item in this pass
      none → break; repair his items of this pass slot by slot (first repairable slot each time) until none or left == 0
    if something was repaired this pass and r has nothing left up to this pass: message, stop compression
```
`CanCharacterRepairAnotherSoldiersStuff(r, o)` (`:6963-6993`): o ≠ r, alive, same sector, not moving, not in
transit/POW/dead, and r (sic) not mechanical and not an EPC. Every gun is unjammed (in every pass, repeatedly) before
items. `IsItemRepairable` = status < 100 and `ITEM_REPAIRABLE` (`:2027-2030`). ja2-node: `repair.ts`, `repair-rules.ts`
(the passes are `REPAIR_PASS_SLOTS`); events `itemRepaired`, `gunUnjammed`. Vehicle repair is a hook that repairs nothing
until vehicles have a condition (`deviations.md` "Strategic economy stand-ins").

### 5.8 Training stats

```
GetSoldierTrainingPts(s, stat, gunRange, &max):                      // Assignments.cc:2471-2507 (StatChange chances per hour)
  v = natural stat value (HEALTH = lifeMax); if v == 0 || v >= 85: return 0
  max = max(s.wisdom*(85 − v)/1000, 1); pts = u16(max(EffWis(s)*(85 − v)/1000, 1))
  if stat == MARKSMANSHIP && gunRange (H13, Alma): pts += 25*pts/100
  ReducePointsForFatigue(s, &pts)
GetBonusTrainingPtsDueToInstructor(t, student|null, stat, gunRange, &max):   // :2321-2468
  effT = effective stat of t (HEALTH: lifeMax), natT = natural
  student null: wis = natWis = 100, sv = 0, opinion = 0
  else: wis = EffWis(st), natWis = st.wisdom, sv = natural stat of st; sv == 0 || sv >= 85 → 0
        opinion = i8(profile[st].opinion[t] + profile[t].opinion[st] / 2)
  if sv >= effT: return 0
  pts = u16((effT − sv) * (wis + (EffWis(t) + EffLdr(t)) / 2) / 3000)
  max = (natT − sv) * (natWis + (t.wisdom + t.leadership)/2) / 3000
  if max == 0 && effT > sv + 10: pts = max = 1
  bonus = 30 per TEACHING trait of t's profile
  max += (bonus + opinion)*max/100
  if MARKSMANSHIP && gunRange: bonus += 25
  pts += (bonus + opinion)*pts/100; ReducePointsForFatigue(t, &pts)
```
`HandleTrainingInSector(sector)` (`:2126-2310`), surface, our and peaceful (else nothing this hour):
1. for each trainable stat, the best instructor: TRAIN_TEAMMATE on that stat, enough time, not asleep in the past hour,
   highest `GetBonusTrainingPtsDueToInstructor(t, null, …)` (strict >, first in id order on ties);
2. for each OUR merc in the sector on TRAIN_SELF or TRAIN_BY_OTHER (id order), with enough time, not asleep in the past
   hour **and not flagged nothing-to-do** (Strac, `:2208-2213`; V trains a partnerless student at his own rate,
   V: `Assignments.c:3117`): `pts = GetSoldierTrainingPts`; TRAIN_BY_OTHER with an instructor for his stat adds
   `GetBonusTrainingPtsDueToInstructor(instructor, student, …)`; `TrainSoldierWithPts` (`:2591-2617`):
   `StatChange(s, statAmt, pts, FROM_TRAINING)` if pts > 0 (`33` §5: chance 0 at ≥ 85, wisdom applies to physical
   stats when training);
3. militia (§1.4). Instructors themselves gain nothing.

`ValidTrainingPartnerInSameSectorOnAssignmentFound(target, wanted, stat)` (`:6783-6834`): another OUR merc on the wanted
assignment, same sector, same stat, alive, and the instructor/student pairing gives > 0 bonus points. Example: Wis 80
training a 60 stat alone: 80 × 25 / 1000 = 2 chances per hour.

### 5.9 Training militia

§1.2–§1.5; the militia handler is the last training step of §5.8, inside step 8 of §5.3. A trainer whose
`CanCharacterTrainMilitia` fails (area full, loyalty dropped) is flagged nothing-to-do (§5.10) but keeps training.

### 5.10 Nothing to do, done, aborted

`ReEvaluateEveryonesNothingToDo()` (`:6532-6603`): DOCTOR: can't doctor or nobody ever healable; PATIENT: can't be a
patient or no doctor can ever heal him; HOSPITAL: can't be a patient; REPAIR: can't repair or finished; TRAIN_TOWN:
`!CanCharacterTrainMilitia`; TRAIN_SELF: can't train the stat; TRAIN_TEAMMATE/BY_OTHER: can't, or no valid partner;
squads and vehicles: never. Changing to "has something" clears the done-quote flag. It runs at the end of
`UpdateAssignments` and, when requested by `SetTimeOfAssignmentChangeForMerc` and others, on the next map screen frame
(`MapScreen.cc:6575-6577`; tactical defers it to the map screen). ja2-node re-evaluates right after the command
(`deviations.md` "Nothing-to-do re-evaluation"). The flag feeds §5.4 (rest) and §5.8 (students).

`AssignmentDone(s, sayQuote, meToo)` (`:2747-2819`): animation reset in the loaded sector; hospital clears the final
destination; TRAIN_TOWN with `!meToo` → quote + "completed" list (§1.5); the first time (done-quote flag) DOCTOR, REPAIR,
PATIENT, HOSPITAL say "assignment complete" and the merc joins the "assignments finished" box. The merc keeps his
assignment. `AssignmentAborted` (`:2736-2744`): message + stop compression.

### 5.11 Interaction with travel and the clock

- A merc on a non-squad, non-vehicle assignment has his own player group and cannot be given a route until he is back
  on a squad (`ME_BUSY`, `Map_Screen_Interface.cc:3818-3820`). Mercs between sectors cannot take any non-squad
  assignment (no kind allows `AC_MOVING`; only sleeping does); doctors cannot treat moving patients.
- Fatigue applies while travelling (on foot, with encumbrance; vehicle passengers rest unless driving). On arrival in a
  sector that is not the destination, `AnyMercInGroupCantContinueMoving` (`Assignments.cc:6318-6343`, from
  `Strategic_Movement.cc:3477`) stops the whole group if anyone is too tired (`PlayerSoldierTooTiredToTravel`, `:6346-6363`:
  awake with breathMax < 30, or asleep and not awakenable; vehicle passengers only if they must drive): those mercs are
  put to sleep and collapse, the route is cleared, compression stops. Plotting a route is refused for a merc already too
  tired (`ME_CUSTOM`, `Map_Screen_Interface.cc:3825-3829`). ja2-node: `src/sim/strategic/forces/movement.ts` through the
  merc port's `tooTiredToTravel`/`collapseFromFatigue`.
- A battle wakes everyone involved (`WakeUpAllMercsInSectorUnderAttack`, `PreBattle_Interface.cc:1284-1296`, forced); PBI
  "retreat/fight" put non-squad mercs onto squads (`19`).
- Everything runs on game minutes: `EnoughTimeOnAssignment`, the hourly event and the bandage minute event (`15`). In
  turn-based combat the world clock is frozen (`10` §8.4), so assignments make no progress.

### 5.12 Merc-side periodic updates

| Update | When | What | Source |
|---|---|---|---|
| Bleeding, breath regeneration, shock decay | every real-time tactical turn for **all** OUR mercs, wherever they are (blood drops only in sector) | `EVENT_BeginMercTurn` (`10` §2.4); on the strategic map the turn cadence follows time compression (`15` §1.7) | `Tactical/Tactical_Turns.cc:80-139`, `Soldier_Control.cc:4000-4030` |
| Natural healing | hourly | §5.5 | |
| Rest/fatigue/sleep | hourly | §5.4 | |
| Tactical morale decay | every 15 min | `DecayTacticalMoraleModifiers` (`33` §4; nervous/claustrophobic cases) | `Morale.cc:138-217` |
| Buddy/hated counters, team morale | hourly, in that order | `UpdateBuddyAndHatedCounters`, `HourlyMoraleUpdate` (`22` §5.2–§5.3); every 3rd call decays the strategic modifier (function-static counter, not saved) | `Strategic_Merc_Handler.cc:526-730`, `Morale.cc:664-815` |
| Camouflage | hourly | −2 % (not CAMOUFLAGED trait); monster smell −1 | `Strategic_Merc_Handler.cc:733-759` |
| Daily merc update | 00:00 (not day 1) | `MercDailyUpdate` (`22` §2.1): low death rate morale, quote flags, equipment complaint, days served, RPC salary (`PAYMENT_TO_NPC`), `DailyMoraleUpdate`, contract offers, unhired mercs | `Strategic_Merc_Handler.cc:135-370`, `Morale.cc:818-856` |
| Merc death bookkeeping | on death | history, death count, `SOLDIER_DEAD`, breath 0, profile dead, insurance, teammate morale (`19` §3.7) | `:52-130` |

ja2-node: `src/sim/campaign/team-morale.ts` (`hourlyMoraleUpdate`, `updateBuddyAndHatedCounters`,
`decayTacticalMoraleModifiers`), run with the roster from `BattleFlow`; the decay counter is saved
(`state.teamMorale.strategicDecayCounter`, `deviations.md` "Strategic morale decay counter"). **Not ported**: the hourly
camouflage update (applied camouflage never wears off) and `UpdateRegenCounters` (drugs are not modelled).

### 5.13 Contracts and payments

AIM contract expiry slots (07:30/13:30/19:30, `Merc_Hiring.h:14`), renewal, M.E.R.C. daily billing and the RPC daily
salary (deducted at 00:00 if affordable, `Strategic_Merc_Handler.cc:209-257`) are `22`.

### 5.14 Facilities

`SECTORINFO.uiFacilitiesFlags` (hospital, industry, prison, military, airport, gun range) are display flags only
(`Player_Command.cc:33-53`; the flags known at a new campaign come from `InitKnowFacilitiesFlags`,
`data/tables/sector-facilities.json`); the gun range bonus is hardcoded to H13 (§5.8). Stracciatella has no facility
assignments (a 1.13 feature).

### 5.15 RNG in the hourly update

In order: step 8 sectors column-major, per sector doctors → repairmen → training, mercs in id order:
- doctor: `StatChange` MEDICAL (used/100 chances), DEX (used/200), WIS (used/200): one `pre` draw per chance, plus
  `main` `Random(100) < 25` per stat point gained (`33` §5);
- repair: unjam MECH 5 + DEX 5 per gun (`pre`), then MECH and DEX used/2 each (`pre`), then `main` `Random(100)` toolkit
  wear;
- training: students' `StatChange` chances (`pre`), trainers of militia LDR `1 + pts/200` (`pre`);
- bandage minute event: `VirtualSoldierDressWound` MEDICAL actual/2, DEX actual/4 (`pre`).

Rest, fatigue, sleep, natural healing, hospital, militia completion: none. Other hourly handlers: `HourlyLarryUpdate`
`Random(n)`, Slay `Chance(15)` (`35` §2.4).

---

## 6. Implementation in ja2-node

### 6.1 Content

`src/content/strategic/economy-content.ts` `loadEconomyContent(read, towns)` (`ECONOMY_CONTENT_PATHS`):
- `data/externalized/strategic-mines.json` (mine definitions, order = mine id), `game.json` (starting cash,
  `enable_stat_healing`), `mercs-profile-info.json` (merc type AIM/MERC/IMP/RPC/NPC: the RPC/NPC training bonus);
- `data/tables/town-loyalty.json` (`tools/transcribe/town-loyalty.ts`, from `Strategic/Strategic_Town_Loyalty.cc:79-128,
  870-915` and `Strategic_Town_Loyalty.h:14-64`): `gainPointsPerLoyaltyPoint`, `rebelSentiment[13]` and `usesLoyalty[13]`
  by town id (index 0 unused), `civilianMurderCost[8]` by body FATCIV..COW in gain points, `globalEvents[13]`
  (`{name, amount}` in `GlobalLoyaltyEventTypes` order), `amounts` (the named `BONUS_*`/`PENALTY_*` constants);
- `data/tables/head-miners.json` (`tools/transcribe/head-miners.ts`, from `Strategic/Strategic_Mines.cc:50-58` and
  `StrategicMap.cc:671`): `headMiners` in `MINER_*` order with `profile` and one strategic quote number per `quoteKinds`
  entry (RUNNING_OUT, CREATURES_ATTACK, CREATURES_GONE, CREATURES_AGAIN; −1 = none), `randomMinerProfiles`.

Also read: the towns, SAM and air-control tables through the strategic map content (`16`), `items.json` (`bRepairEase`,
repairable and electronic flags, MEDICKIT/TOOLKIT). Scalar constants (militia caps and costs, mine periods, sleep
thresholds, §5 divisors) are named constants in `constants.ts` and the modules. The profile fields of §0 come from the
user's `prof.dat` or the stub profiles (`stubs/profiles.json`, defaults in `src/content/formats/stub-profiles.ts`);
nothing else here needs original data.

### 6.2 Modules

| Module (`src/sim/strategic/economy/`) | Responsibility |
|---|---|
| `state.ts`, `constants.ts`, `events.ts` | `EconomyState` (§0); enums and constants of the original; `EconomyEvent` (the events of `29`) |
| `ports.ts`, `context.ts` | `CrewPort`/`CrewMember` (the active OUR team in id order, vehicles and the robot included; `statChange`, `healStat`, `opinion`, `dressWound`), `EconomyHooks` (morale events, theft, monsters, Queen mine-ran-out, rebels hostile, meanwhiles, head miners, vehicle repair, history), `EconomyDecisions` (militia prompts), `PeriodicSlots` (the other hourly and quarter-hour handlers); `createEconomyContext` (an `EconomyContext` is also a `StrategicContext` whose `mercs` is the crew port), `economyWorldPort` |
| `towns.ts` | `buildTownSectors` (column-major), `townOf`, `townSize`, `sectorsUnderControl`, `isTownUnderCompleteControl`, `numberOfWholeTownsUnderControl`, `sectorOursAndPeaceful` |
| `loyalty.ts`, `inactivity.ts` | §2: accumulator, global events and distances, whole towns, control-change effects, theft chance, quest and recruit changes; `handleEnricoEmail`, `lackOfProgressTolerance` |
| `mine-status.ts`, `mines.ts` | §3: init (draws), income events, workforce, extraction, prediction, `hourlyMinesUpdate`, head miners and their quotes |
| `militia-rules.ts`, `militia.ts`, `militia-moves.ts` | §1: eligibility, `isAreaFullOfMilitia`, `canNearbyMilitiaScoutThisSector`; training completion, payment and continue prompts, promotions, defections, unload handling, add/promote/remove; redistribution |
| `conditions.ts`, `repair-rules.ts`, `points.ts`, `kits.ts`, `vehicle-assignment.ts` | §5.1 conditions and every `CanCharacter…` check; the pure estimates (`calculateHealingPointsForDoctor`, `calculateRepairPointsForRepairman`, `getSoldierTrainingPts`, `getSoldierStudentPts`, `getBonusTrainingPtsDueToInstructor`, `getTownTrainPtsForCharacter`); kit points; the vehicle assignment |
| `rest.ts`, `doctor.ts`, `repair.ts`, `training.ts` | §5.4–§5.8 |
| `assignment-done.ts`, `set-assignment.ts` | `changeSoldiersAssignment`, `assignmentDone`, `assignmentAborted`, `reEvaluateEveryonesNothingToDo`; `assignSoldiers`, `sleepSoldier`, `wakeSoldier`, `applySquadAssignment`, `answerPendingMilitiaPrompt` |
| `update.ts` | `updateAssignments`, `handleHourlyUpdate`, `handleQuarterHourUpdate`, `registerEconomyEvents` (`HOURLY_UPDATE`, `QUARTER_HOUR_UPDATE`, `SETUP_MINE_INCOME`, `HANDLE_MINE_INCOME`, `CHECK_IF_MINE_CLEARED`, `BANDAGE_BLEEDING_MERCS`, `ENRICO_MAIL`) |
| `init.ts`, `save-import.ts`, `sector-loss.ts` | `initEconomyStrategicLayer` (`InitTownLoyalty` + `InitializeMines`), `addStartingCash`; `importEconomy`, `applySavedAssignment`; `importantSectorLoss` (kind and lost daily income of a lost-sector notice) |

Elsewhere: `src/sim/strategic/map/control.ts` (control changes, `updateAirspaceControl`, `initializeSamSites`) and
`map/sam.ts`; `src/sim/campaign/finances.ts`, `finance-summary.ts`; `src/sim/campaign/team-morale.ts`;
`src/sim/campaign/sector-flow.ts` (militia population and reset, militia and enemy deaths, promotions and defections on
unload, retreat loyalty), `battle-flow.ts` (battle won/lost, theft via `sector-loot.ts`); `src/sim/tactical/init-list.ts`,
`tactical/combat/death.ts`, `tactical/narrative/civ-hostility.ts`; `src/sim/campaign/commands.ts` (the `assign`, `sleep`,
`wake`, `moveMilitia` and `distributeMilitia` commands, `29`).

### 6.3 Wiring

- `CampaignSim` (`src/sim/campaign/campaign-sim.ts`) takes `hooks.economy` (`EconomySetup`: economy content, items, crew,
  optional hooks, decisions and slots), exposes `campaign.economy`, wraps the world port with `economyWorldPort` and
  registers the economy events. `handleHourlyUpdate` calls the `PeriodicSlots` in the original order (`15` §3.2); the
  campaign fills them with team morale, the Queen's `hourlyProgressUpdate`, the narrative's quest, Larry and Slay
  handlers, Skyrider's debt and the quarter-hour morale decay; `hourlyCamouflageUpdate` and `updateRegenCounters` stay
  empty. The laptop flow re-registers `ENRICO_MAIL` (§2.8).
- New game (`src/sim/campaign/new-game.ts`): the standing daily `SETUP_MINE_INCOME` (00:00) and `ENRICO_MAIL` (07:00) and
  the periodic `HOURLY_UPDATE`/`QUARTER_HOUR_UPDATE` events; `initEconomyStrategicLayer` inside
  `initStrategicLayerMap` after `initVehicles`, before the NPC placements (`15` §4.3); `addStartingCash`.
- The Queen reads `predictIncomeFromPlayerMines`, `calcMaxPlayerIncomeFromMines`, `sectorsUnderControl`,
  `numberOfWholeTownsUnderControl`, `militiaTrainingAllowedInSector` and the militia counts, and plugs
  `queenMineRanOut` into the hooks (`src/sim/strategic/ai/economy-link.ts`).

### 6.4 Save import

`src/content/formats/savegame-economy.ts`: `readSavedEconomy(bytes, sections)` decodes sections 25 (mines), 26 (town
loyalty) and the finances temp file; `importEconomy(state, saved, balance)` loads them; `readSoldierAssignments` decodes
the assignment fields of every soldier record for `applySavedAssignment` (`src/server/save-session.ts`). Section 11's
militia and training fields come with `importStrategicMap`; section 34 (Enrico flags, highest progress, activity
counters) with the Queen's `savegame-strategic-ai.ts` and `ai/save-import.ts`. Native profiles import the relation
fields, so imported campaigns keep their buddy/hated counters.

### 6.5 Verification

Oracle probes `tools/oracle/probes/economy.txt` (`strategic`, `mercs detail=strategic`, `loyalty`, `assign`, `warp` on the
six saves in B13/C13/D13; `tools/oracle/README.md` "Economy") and `probes/morale.txt` ("Morale"). After a `warp` the
stat-derived estimates are not compared (stat gains draw `pre`), and a warp that completes a militia session diverges by
a few hundredths because the trainers' leadership rises in the oracle. `economy/scenario.test.ts` trains a paid Drassen
sector to completion with two trainers on the strategic clock and checks that warping the same span gives the same
result.

---

## 7. Quirks to keep

All read in Stracciatella; V where marked.

- `g_town_sectors` is column-major: militia overflow and redistribution order (§1.5, §1.8).
- Training: progress accrues regardless of the paid flag; payment survives trainers leaving; no carry-over past 100 %;
  the completing trainer stops the others that hour (§1.3, §1.4).
- A session creates up to 10 greens or promotes greens, never elites; loyalty bonus only if ≥1 militia placed (§1.5).
- Militia kills give 3 points, assists 1; promotions only at sector unload, not after autoresolve hand-off; rank
  fallback to higher ranks; double promotion green → elite possible (§1.6).
- Militia placement: no attitude roll and no detail drop in the class-matched basic pass (§1.9).
- Redistribution AUTO counts militia in hostile-occupied sectors but never gives them back; leftovers over 20 are lost
  (§1.8).
- Loyalty: the remainder keeps its sign; reaching the cap exactly zeroes the remainder; increments/decrements of
  unstarted towns are dropped; `SetTownLoyalty` starts towns (rebels betrayed starts unvisited towns at 0) (§2.1–§2.2,
  §2.4).
- Distance 0 for both "same sector" and "no path" (§2.3).
- Uncontested captures give no sector, liberation, mine or SAM loyalty and never complete a town's liberation (§2.6,
  §2.7).
- `HandleMurderOfCivilian` falls through to a full decrement for rebel-hostile militia and non-monster creature killers;
  militia deaths never count as murder (§2.5).
- Theft happens on every enemy takeover call, also for reinforcements (§2.6).
- Inactivity is not counted on days with a progress or setback mail; creature/progress mail days skip the new-sector
  counter reset (§2.8).
- Mines: Queen extraction only after the mine produced for the player; the running-out rate uses float math; the max
  income denominator shrinks when a mine empties (§3.5, §3.8).
- Assignments: doctors are patients too; the odd point below OKLIFE is wasted; kits are consumed from the last object;
  tiny damage (cost rounds to 0) is fixed for free even with 0 points left; unjamming runs for every pass;
  `CanCharacterRepairAnotherSoldiersStuff` tests the repairer for mechanical/EPC; `VirtualSoldierDressWound` reads
  HELMETPOS for the medical kit bonus; rested squad mercs oscillate around 95 breathMax; dying awake mercs are fatigued
  (§5.4, §5.6, §5.7).
- Strac changes vs V, kept per D1: sleep status recorded before the hourly rest step; partnerless students do not train;
  `CalcSoldierNeedForSleep` health term fixed (V: integer bug); militia promotion without draws below the thresholds
  (§1.6, §5.3, §5.4, §5.8).

Deviations (full entries in `deviations.md`): "Time compression for healing", "Nothing-to-do re-evaluation", "Loyalty
distance path", "Militia trainer ties", "Militia payment and continue prompts", "Militia redistribution", "Strategic morale
decay counter", "Finance ledger", "Assignment presentation", "Update box timing", "Strategic economy stand-ins",
"Implications of an attack" (head miner).

## 8. Limitations and unverified

**Not ported**: civilian murder (§2.5); the activity rule for damaging enemies (§2.8); SAM damage by explosions (§4.2);
the head-miner attack (§2.4); the hourly camouflage update and regen counters (§5.12); vehicle repair (§5.7).

**Inferred, not traced end to end**:
- that `FindStratPath` distances never exceed 30 on the real map, and that no town is unreachable for a foot group (an
  unreachable town gets distance 0, i.e. +75 %);
- that the `fIncrement` fall-through of §2.5 is the behaviour to keep (it is what the code does);
- glibc `qsort` keeping id order for equal trainer points (ja2-node sorts stably);
- that a walking merc's `sSector` is the departure sector for `fSectorsWithSoldiers` (`16`'s group model).
