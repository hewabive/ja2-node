<!-- Towns and mercs between battles: an implementable spec for M4. 2026-10-15.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–14) and reference/stracciatella/assets/externalized,
cross-checked against vanilla (reference/vanilla/ja2/Build) where marked. Read-only research: nothing was built or run. -->

# 18 — Towns and mercs between battles: militia, loyalty, mines, SAM sites, assignments

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `V:` is vanilla `Build/`; JSON files are
`assets/externalized/*.json` (copied to `data/externalized/`). "(inferred)" marks conclusions not traced end to end;
everything else was read in the code. C integer semantics apply: `/` truncates toward zero (`idiv`), `%` keeps the sign
of the dividend (`imod`), `UINT8`/`INT8`/`UINT16`/`INT16` stores wrap (`u8`/`i8`/`u16`/`i16`). `Random` = `main` stream,
`PreRandom` = `pre` stream (`01` §3.6); `Chance(x)` is `Random(100) < x` (`sgp/Random.cc:71-74`) and draws even when
`x` is 0 or ≥ 100. Times are game minutes unless marked (`GetWorldTotalMin`). Sector names are `A1..P16`;
`SectorInfo[]` is indexed by the 0–255 "byte" (`(y-1)*16 + (x-1)`), `StrategicMap[]` by the strategic index
(`x + y*18`, `Strategic/Campaign_Types.h:8-11`). "Policy" values are Stracciatella defaults from `game.json`.
Teams: `OUR 0, ENEMY 1, CREATURE 2, MILITIA 3, CIV 4`. Soldier classes: `ADMINISTRATOR 1, ELITE 2, ARMY 3,
GREEN_MILITIA 4, REG_MILITIA 5, ELITE_MILITIA 6, CREATURE 7, MINER 8`. Militia ranks: `GREEN 0, REGULAR 1, ELITE 2`
(`Strategic/Campaign_Types.h` `MilitiaLevel`). `OKLIFE 15`, `CONSCIOUSNESS 10` (`Tactical/Overhead_Types.h:70-71`),
`TRAINING_RATING_CAP 85` (`Tactical/Campaign.h:55`).

**Companions.** `15-strategic-time.md` owns the clock, the event queue, the order of hourly/daily events and new-game
init: this spec describes what the handlers do. `16-strategic-map-movement.md` owns sectors, groups, routes, encounters,
sector control changes (when `SetThisSectorAsPlayerControlled`/`SetThisSectorAsEnemyControlled` are called), sector
persistence and the strategic pathfinder (`FindStratPath`). `17-strategic-ai.md` owns the Queen (garrisons, progress,
`StrategicHandleQueenLosingControlOfSector`, `StrategicHandleMineThatRanOut`). `19-autoresolve-pbi.md` owns PBI and
autoresolve, including militia in autoresolve and `VirtualSoldierDressWound` there. Tactical references: `10` (turns,
`EVENT_BeginMercTurn`, end of battle), `11` §9–§10 (morale, `StatChange`), `12` (items), `14` (savegame sections).

---

## 0. State this spec adds

**Campaign / strategic** (all saved):

| State | Original | Notes |
|---|---|---|
| Town loyalty ×13 | `TOWN_LOYALTY gTownLoyalty[NUM_TOWNS]`: `ubRating` (UINT8 0–100), `sChange` (INT16 hundredths accumulator), `fStarted`, `fLiberatedAlready` (`Strategic/Strategic_Town_Loyalty.h:67-73`) | index 0 unused; save section 26 (13 × 26 bytes, `docs/14` §4) |
| Town sector list | `g_town_sectors` built once by `BuildListOfTownSectors` (`Strategic_Town_Loyalty.cc:673-687`) | derived; **order is column-major** (x outer, y inner) |
| First battle sector | `sWorldSectorLocationOfFirstBattle` (`Strategic_Town_Loyalty.cc:131`) | for M6 dialogue |
| Per surface sector | `SECTORINFO.ubNumberOfCivsAtLevel[3]` (militia per rank), `fMilitiaTrainingPaid`, `ubMilitiaTrainingPercentDone`, `ubMilitiaTrainingHundredths`, `fSurfaceWasEverPlayerControlled`, `uiFacilitiesFlags` (`Strategic/Campaign_Types.h` `SECTORINFO`) | save section 11 |
| SAM condition, air control | `StrategicMapElement.bSAMCondition` (0–100), `.fEnemyAirControlled` | save section 11 |
| Mines ×6 | `MINE_STATUS_TYPE gMineStatus[]` (`Strategic/Strategic_Mines.h:50-70`) | save section 25 (6 × 44) |
| Money | `LaptopSaveInfo.iCurrentBalance` (INT32) + finance ledger | ledger is a file in the original; ours is state |
| Inactivity | `gStrategicStatus.usLastDayOfPlayerActivity`, `ubNumberOfDaysOfInactivity`, `ubNumNewSectorsVisitedToday`, `usEnricoEmailFlags`, `ubHighestProgress` | save section 34 |
| Militia promotion counters | `gbMilitiaPromotions`, `gbGreenToElitePromotions`, `gbGreenToRegPromotions`, `gbRegToElitePromotions` | message only |

**Soldier (OUR team)**: `assignment` (`bAssignment`, §5.1), `trainStat` (`bTrainStat`), `lastAssignmentChangeMin`
(`uiLastAssignmentChangeMin`), `asleep` (`fMercAsleep`), `collapsed` (`fMercCollapsedFlag`), `forcedToStayAwake`,
`complainedThatTired`, `doneAssignmentAndNothingToDo` (`fDoneAssignmentAndNothingToDoFlag`), `fixingRobot`,
`vehicleUnderRepair` (`bVehicleUnderRepairID`, −1), `fractLife` (`sFractLife`, INT16 hundredths of life), `breathMax`
(exists), `bleeding` (exists), stat damage fields (`bAgilityDamage` …, only with `enable_stat_healing`), `groupId`,
`hospitalPriceModifier` (M6), `quoteSaidExtFlags & SOLDIER_QUOTE_SAID_DONE_ASSIGNMENT`. **Militia soldier**:
`militiaKills` (`ubMilitiaKills`, UINT8). **Profile** (imported from `prof.dat`, `Tactical/LoadSaveMercProfile.cc`):
`needForSleep` (`ubNeedForSleep`, :190), `town` (`bTown`, :166), `townAttachment` (`bTownAttachment`, :167),
`mercOpinion[]` (`bMercOpinion`, :170), `salary` (`sSalary`, :110), `miscFlags3` (:193; bit
`PROFILE_MISC_FLAG3_TOWN_DOESNT_CARE_ABOUT_DEATH`). These are missing from `src/content/formats/prof.ts` today.

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

Where militia may exist (`CanSectorContainMilita`, `Assignments.cc:616-621`): a surface sector with a town id, or a SAM
sector (`IsThisSectorASAMSector`). Where they may be trained (`MilitiaTrainingAllowedInSector`, `Town_Militia.cc:900-919`):
surface only; any SAM sector; otherwise `strategic-map-towns.json` `isMilitiaTrainingAllowed` of the town (true for
Drassen, Alma, Grumm, Cambria, Balime, Meduna, Chitzena; false for Omerta, Tixa, San Mona, Estoni, Orta). N4 is both a
Meduna sector and a SAM site: always trainable (SAM rule), but it needs Meduna's loyalty, counts as Meduna for "full" and
overflows into Meduna like any town sector. D2, D15 and I8 are wilderness SAM sites (no loyalty needed, no overflow).

"Our and peaceful" (`SectorOursAndPeaceful`, `Town_Militia.cc:351-376`), used everywhere militia are touched:
1. if the sector is the loaded one and (`fEnemyInSector` or `INCOMBAT`): false;
2. surface and `StrategicMap.fEnemyControlled`: false;
3. `NumHostilesInSector(sector) > 0` (stationary enemies + creatures + non-vehicle enemy groups there,
   `Strategic/Queen_Command.cc:53-83`): false; else true.

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

The loyalty test reads `ubRating` even when `fStarted` is false (rating 0 then) and does not check `gfTownUsesLoyalty`
(all trainable towns use loyalty).

### 1.3 Paying for a session (the prompt flow)

Assigning `TRAIN_TOWN` from the menu (`Assignments.cc:4702-4777`) re-runs the checks with messages, then **first**
changes the assignment (`PreChangeAssignment`, time stamp if new, `ChangeSoldiersAssignment(TRAIN_TOWN)`, movement group),
then:
- if `SectorInfo[sector].fMilitiaTrainingPaid`: `SetAssignmentForList(TRAIN_TOWN)` for the other selected mercs (§5.2);
- else `HandleInterfaceMessageForCostOfTrainingMilitia(s)` (`Town_Militia.cc:422-465`):
  - unpaid sectors = distinct sectors of the selected mercs (plus the assigning one) that pass `CanCharacterTrainMilitia`
    and are not paid (`BuildListOfUnpaidTrainableSectors`, `:788-824`; tactical: only the one merc);
  - cost = 750 × n; balance < cost → "can't afford" box → `MilitiaTrainingRejected`;
  - else a yes/no box. Yes (balance re-checked) → `StartTrainingInAllUnpaidTrainableSectors` (`:842-852`):
    `SetAssignmentForList(TRAIN_TOWN)` then, for each unpaid sector, `PayForTrainingInSector` (`:870-882`):
    `AddTransactionToPlayersBook(TRAIN_TOWN_MILITIA, sectorByte, now, −750)`, `fMilitiaTrainingPaid = TRUE`, clear the
    done flags of trainers there. No → `StopTimeCompression`, `MilitiaTrainingRejected` (`:589-604`): every TRAIN_TOWN
    merc of an unpaid sector in the character list goes to `ResumeOldAssignment` = `AddCharacterToAnySquad`
    (`Map_Screen_Interface.cc:358-371`, `Assignments.cc:7030-7046`), not back to the old assignment.

Payment is per session, not per trainer: a second trainer joining a paid sector pays nothing. Progress and the paid flag
survive if trainers leave mid-session; the next trainer continues for free.

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

Militia part of `HandleTrainingInSector(sector)` (`Assignments.cc:2252-2309`, after stat training of §5.8), only if the
sector is our and peaceful (`:2146-2151`, else no training of any kind this hour) and can contain militia:
1. collect trainers in **team id order**: same sector, `TRAIN_TOWN`, `EnoughTimeOnAssignment` (≥45 min, §5.2),
   not asleep during the past hour (§5.3), `pts > 0`;
2. sort descending by points (`qsort`, `:2287`, comparator `:2313-2318`; see §9 on ties);
3. for each in order: `TrainTownInSector(t, sector, pts)` (`:2621-2660`); stop after the one that completes the session
   (no carry-over).

```
TrainTownInSector(t, sector, pts):
  StatChange(t, LDRAMT, 1 + pts/200, FROM_SUCCESS)                   // pre draws (11 §10)
  si.percentDone  += pts/100                                          // UINT8
  si.hundredths   += pts%100
  if si.hundredths >= 100: si.percentDone++; si.hundredths -= 100
  if si.percentDone >= 100:
    si.percentDone = 0; si.hundredths = 0; si.fMilitiaTrainingPaid = false
    TownMilitiaTrainingCompleted(t, sector); return true
  return false
```
Progress accrues whether or not the sector is paid; the command layer is what guarantees payment (§1.3). Training in a
full area still accrues and is wasted at completion (§1.5).

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

**Continue prompt** (`HandleContinueOfTownTraining`, `Town_Militia.cc:735-785`, called at the end of every hourly
`UpdateAssignments`): for each sector in the completed list (one entry per sector, keyed by the first trainer,
`:695-725`), a dialogue event runs `HandleInterfaceMessageForContinuingTrainingMilitia` (`:468-534`):
- loyalty below 20 → message + reject; area full → message + reject; balance < 750 → message + reject;
- else yes/no "continue training in X for $750?". Yes → `PayForTrainingInSector` for the trainer's sector. No → every
  TRAIN_TOWN merc of that sector goes to a squad (`ResetAssignmentOfMercsThatWereTrainingMilitiaInThisSector`,
  `Map_Screen_Interface.cc:374-387`).
Trainers keep `TRAIN_TOWN` while the prompt is open; the original switches to the map screen and the box pauses time.

### 1.6 Ranks and promotions after a battle

Kill points (`ubMilitiaKills`, per militia soldier, tactical): +1 in `HandleNPCTeamMemberDeath` when the killer is
militia (`Tactical/Overhead.cc:2516-2519`), +2 for the killer and +1 for the assister at the death commit
(`Tactical/Soldier_Ani.cc:2929-2960`). A militia kill therefore gives **3** points, an assist 1 (`11` §10).

Promotions are applied when the tactical world is unloaded (`HandleDefiniteUnloadingOfWorld`, both "load new map" and
"trash world", `Strategic/StrategicMap.cc:2902-2953`) through `HandleMilitiaStatusInCurrentMapBeforeLoadingNewMap`
(`Town_Militia.cc:608-620`): if the militia team is no longer friendly → defections (§1.7) and the side is reset;
else, unless the battle is about to be finished in autoresolve (`gfAutomaticallyStartAutoResolve`),
`HandleMilitiaPromotions` (`Tactical/Militia_Control.cc:62-106`):

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
The strategic counts change, not the soldier (he is about to be removed). A later `BuildMilitiaPromotionsString` box
on the map screen reports the counters (`MapScreen.cc:7627-7631`). **Vanilla differs** (V: `TownMilitia.c:258-296`):
no rank fallback, and `Random(100)` is drawn even when the chance is 0; we follow Stracciatella (D1).

### 1.7 Casualties and defections

- A militia soldier dies in tactical (`Overhead.cc:2435-2448`): `StrategicRemoveMilitiaFromSector(worldSector, rank, 1)`
  if his class is a militia class (the remove is a no-op when the count is already 0, `Town_Militia.cc:232-249`), then
  `HandleMurderOfCivilian` (returns at once: the victim is not CIV team, §2.5), then
  `HandleGlobalLoyaltyEvent(NATIVE_KILLED, worldSector)` (−50, §2.3).
- The player attacks friendly militia (`Overhead.cc:5386-5390`): `MilitiaChangesSides` (`:2830-2846`) makes every
  in-sector living militia hostile (`MakeCivHostile`). On unload, `HandleMilitiaDefections(worldSector)`
  (`Town_Militia.cc:289-327`): for rank 0..2, for each militia counted at the start of that rank,
  `Random(100) < 50/75/90` (green/regular/elite) removes one. No promotions that time.
- Militia in autoresolve, militia-only sectors attacked by the Queen, `PlayerSectorDefended` and the post-battle
  bookkeeping there: `19`.

### 1.8 Moving militia: redistribution inside a town

Stracciatella (default) has no mobile militia and no militia reinforcements; militia never leave their town. The map
screen militia panel lets the player move them between sectors **of the same town** (`Strategic/Map_Screen_Interface_Map.cc`):
- pick up one of a rank (`PickUpATownPersonFromSector`, `:2631-2646`): sector in the selected town, our and peaceful,
  count > 0 → count−−, cursor+1; mark the loaded sector changed;
- drop one (`DropAPersonInASector`, `:2649-2667`): same town, our and peaceful, sector total < 20, cursor > 0;
- closing the panel with militia still on the cursor (`HandleShutDownOfMilitiaPanelIfPeopleOnTheCursor`,
  `:3137-3182`): for each town sector in `g_town_sectors` order that is our and peaceful, with `n = 20 − total` free
  slots: round-robin green, regular, elite one at a time until `n` is used up or the cursor is empty;
- **auto** (`HandleEveningOutOfTroopsAmongstSectors`, `:3187-3275`, enabled when some non-enemy-controlled town sector
  has militia, `:3714-3732`): `k = GetTownSectorsUnderControl(town)` (§3.5); sum each rank over the town's sectors in the
  panel's 3×3 box that are not enemy controlled (**including sectors with hostiles**), plus the cursor; every town sector
  (`g_town_sectors` order) not enemy controlled and with no hostiles gets `rank/k`, then one leftover of each rank while
  its total < 20; the cursor is zeroed. Militia counted in a sector with hostiles but not redistributed back, and
  leftovers that hit the 20 cap, are lost (quirk, §9).

### 1.9 Militia in tactical battles

Population when a sector is loaded (`PrepareLoadedSector`, `Strategic/StrategicMap.cc:573-640`): civilians,
`AddSoldierInitListTeamToWorld(MILITIA_TEAM)` (map placements that are militia team, e.g. editor rebels), bloodcats,
creatures, then `PrepareMilitiaForTactical()` (`Tactical/Militia_Control.cc:42-59`): surface only, reads the three counts
of `gWorldSector` and calls `AddSoldierInitListMilitia(greens, regulars, elites)`. Re-entering tactical in the already
loaded sector after strategic changes (`gfStrategicMilitiaChangesMade`: training completion, redistribution) runs
`ResetMilitia` (`Militia_Control.cc:19-27`, from `StrategicMap.cc:465`): trash the militia team, unlink their
placements, prepare again.

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
Militia use the map's **enemy** placements. Soldier creation then follows the M3 path (`creation.ts`) with these militia
specifics (`Tactical/Soldier_Create.cc`):
- `bVisible = 1` at creation (`:201-202`, "we see what militia see");
- palettes GREENVEST / JEANVEST / BLUEVEST with BEIGEPANTS (`:696-710`, already ported);
- experience level 2/4/6 + modifier like admin/army/elite (`:1284-1292`, ported);
- `CalcDifficultyModifier(class)` (`:1035-1105`): easy +20 **only for militia classes**, medium +10, hard +20 for
  everyone; +5 with any progress; −5 with no mine income (`PredictIncomeFromPlayerMines() == 0`, §3.9); +progress/2;
  + location (`GetLocationModifier`, `:2100-2134`: 30×(20 − palace distance)/20, Orta/Tixa as distance 4, Alma as 10);
  clamp 0..100. `DIFF_MODIFIER_DRASSEN_MILITIA` (+10, `:60`) is defined and unused. M4 replaces the sandbox constant 30
  (`deviations.md` "Sandbox population") with this;
- `RandomizeRelativeLevel` (`:1842-1925`): `Random(10) + location/3 − 5`, militia clamped to 1..8 (never bad or great)
  and then +1 in autoresolve (so "great" is possible there); 0 bad, 1–2 poor, 3–6 average, 7–8 good, 9 great;
- nightops for elite/regular militia like elite/army enemies (`:842-870`, two `Chance` draws; listed in
  `deviations.md` "Soldier creation draws");
- equipment by militia class and the militia drop rates 5/3/2 % (`Tactical/Inventory_Choosing.cc`, ported).

After the battle: `CheckForEndOfBattle` sets militia GREEN/STATIONARY and stops bleeding (`10` §8.2); militia alone with
enemies when the player leaves (`HandlePotentialBringUpAutoresolveToFinishBattle`, `StrategicMap.cc:2955-2990`) hand the
fight to autoresolve (`19`); abandoning them costs loyalty (§2.4). The promotions of §1.6 follow on unload.

### 1.10 Other readers of militia counts

Queen defence and attack evaluation (`Strategic/Strategic_AI.cc:214-216, 934-936`: green 1, regular 2, elite 3 points;
`17`); `PlayerSectorDefended` (`Queen_Command.cc:1279-1290`); `CanNearbyMilitiaScoutThisSector`
(`Town_Militia.cc:623-640`: any militia within ±1 sector lets the map show enemy counts; `16`/observation);
`IsAreaFullOfMilitia`; save load fix-ups that clamp totals above 20 (`SaveLoadGame.cc:2286-2330`,
`Strategic_AI.cc:2368-2379`, save import only).

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
hundredths accumulator `sChange` with `GAIN_PTS_PER_LOYALTY_PT = 500` per point (`Strategic_Town_Loyalty.h:9`), so the
"hundredths" in the comments are really 1/500 of a point. Hardcoded tables (`Strategic_Town_Loyalty.cc:96-128`, = V):

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
FACT_REBELS_HATE_PLAYER`: Omerta 0, others sentiment/2; `sChange = 0`; started. `SetTownLoyalty` (`:184-197`) sets rating,
clears `sChange` and marks the town started (only for towns that use loyalty).

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
in D13, Drassen at distance 0: 500 × 175% = 875 → ×150/100 = 1312 → +2 points, remainder 312.

### 2.3 Distance-adjusted global events

```
HandleGlobalLoyaltyEvent(type, sector):                              // :850-923
  town = sector.z == 0 ? townOf(sector) : BLANK
  if town == SAN_MONA: return                                        // events inside San Mona are ignored everywhere
  base = table below; BATTLE_WON and QUEEN_BATTLE_WON first call CheckConditionsForTriggeringCreatureQuest (later)
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
| `QUEEN_BATTLE_WON` | +1000 | `End_Game.cc:270` (M6) |
| `BATTLE_LOST` | −750 | tactical defeat (`Overhead.cc:4474-4475`); autoresolve loss (`Auto_Resolve.cc:1317, 1324`) |
| `ENEMY_KILLED` | +50 | every enemy or creature death in tactical (`Overhead.cc:2467`), autoresolve kills (`Auto_Resolve.cc:314, 1780`) |
| `NATIVE_KILLED` | −50 | militia death in tactical (`Overhead.cc:2447`) and autoresolve (`Auto_Resolve.cc:1745`) |
| `GAIN_TOWN_SECTOR` / `LOSE_TOWN_SECTOR` | +500 / −1000 | §2.6 |
| `LIBERATE_WHOLE_TOWN` | +1000 | §2.7 |
| `ABANDON_MILITIA` | −750 (however many) | `HandleLoyaltyImplicationsOfMercRetreat` when the sector has militia (`:1187-1207`: tactical exit, PBI retreat, autoresolve retreat); `EndTacticalBattleForEnemy` on unload when militia and enemies/creatures are both still standing (`Queen_Command.cc:284-288`) |
| `GAIN_MINE` / `LOSE_MINE` | +1000 / −1500 | §2.6 |
| `GAIN_SAM` / `LOSE_SAM` | +250 / −250 | §2.6 |

The pathfinder honours the SHIFT key ("direct path", `Strategic/Strategic_Pathing.cc:204-208`) even for this hidden
call; we ignore it (§9).

### 2.4 Event catalogue (all loyalty changes)

Amounts are before sentiment scaling; "everywhere" = every started town, no distance.

| Event | Change | Conditions | Milestone |
|---|---|---|---|
| Global events of §2.3 | see table | — | M4 |
| Civilian killed in tactical | §2.5 | | M4 |
| Militia training session | +1000 to the training town | ≥1 militia placed (§1.5) | M4 |
| Local NPC recruited | +25 × `bTownAttachment` to his home town | hired while in his home town (`:596-614`, `Soldier_Profile.cc:712`) | M5/M6 |
| Head miner attacked | −10000 to the mine's town | first attack only; mine shut down permanently (`Strategic_Mines.cc:945-968`) | M4 (tactical hook) |
| Creatures eat civilians | −n × 5000 × 2 (decrement) | strategic creature town attack (`:808-826`) | later (creatures) |
| Inactivity | everywhere −5000 × k | §2.8 | M4 |
| Rebels betrayed | Omerta → 10 (and capped at 10 while rebels hostile); other towns → rating/3 via `SetTownLoyalty` | `REBEL_CIV_GROUP` turns hostile (`Overhead.cc:2759-2765`, `Strategic_Event_Handler.cc:872`) | M6 |
| Quests (`HandleLoyaltyChangeForNPCAction`, `:1081-1126`; `Overhead.cc:2363-2411`; `Interface_Dialogue.cc:2720, 3441`) | Miguel reads letter +5000 Omerta; Doreen spared +10000 / killed +5000 Drassen (−10000 if killed after her change of heart); Martha (Joey alive) +7500, Keith +7500 Cambria; Yanni +10000 Chitzena then +5000 everywhere; Auntie, Matt, Krott +10000 Alma; terrorists +2500 everywhere; monster queen +5000 everywhere; Eldin killed −10000 Balime; Joey killed −5000 or Martha's heart attack −10000 Cambria | | M6 |
| Deidranna killed | every loyalty town → 100 | `MaximizeLoyaltyForDeidrannaKilled` (`:1210-1220`) | M6 |

There is no robbery or building-damage loyalty in Stracciatella (the vanilla stubs are gone; the multipliers at
`:63-68` are unused).

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
In the MILITIA case with rebels hostile and the CREATURE case with a non-monster killer, `fIncrement` keeps its initial
FALSE, so the change is a **decrement** of the unmodified amount (the source comments suggest otherwise; read at
`:358, 537-572`).

### 2.6 Sector control changes

`SetThisSectorAsPlayerControlled(sector, contested)` (`Strategic/Player_Command.cc:57-218`; `16` decides when):
1. no-op in meanwhiles; surface: `NumHostilesInSector > 0` → return (too early);
2. Drassen airport sector opens Bobby Ray (M5);
3. `wasEnemy = fEnemyControlled`; `fEnemyControlled = false`; town sector → `StartTownLoyaltyIfFirstTime`;
4. only if `wasEnemy && contested` (a battle was won, autoresolve or tactical; group arrival in an empty sector passes
   `contested = FALSE`, `Strategic_Movement.cc:1397`):
   - town sector, not (Omerta on day 1), not J9 (Tixa) or K4 (Orta): `MORALE_TOWN_LIBERATED` (+5 everyone),
     `GAIN_TOWN_SECTOR`, `CheckIfEntireTownHasBeenLiberated` (§2.7);
   - mine entrance with ore left (`GetTotalLeftInMine > 0`): `MORALE_MINE_LIBERATED` (+8), `GAIN_MINE`;
   - SAM sector: meanwhile (M6), `MORALE_SAM_SITE_LIBERATED` (+3), `GAIN_SAM`, Skyrider quote (M6), and on the
     first-ever surface control a grace period `UpdateLastDayOfPlayerActivity(day + 1)` (+2 on hard);
   - refuel site → `UpdateRefuelSiteAvailability`; M2–M6/N6 → Meduna outskirts meanwhile (M6);
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

### 2.7 Whole towns

`CheckIfEntireTownHasBeenLiberated(town, sector)` (`Strategic_Town_Loyalty.cc:1033-1062`): if `!fLiberatedAlready` and every town sector is under
control (`GetTownSectorsUnderControl == GetTownSectorSize`, §3.5): if the town allows militia training →
`LIBERATE_WHOLE_TOWN`, history, meanwhile (M6); activity until `day + 2` (+4 on hard); `fLiberatedAlready = true`
(even for Orta/Tixa). Because it runs only on contested captures, a town completed by walking into an empty last sector
never gets the bonus (quirk, §9). `CheckIfEntireTownHasBeenLost` (`:1064-1076`) only posts a meanwhile.
`GetNumberOfWholeTownsUnderControl` (`:758-775`) counts loyalty towns fully held (M5 dialogue, Queen).

### 2.8 Daily drift: none; the inactivity penalty

Stracciatella has no periodic loyalty drift (vanilla's `HandleTownLoyalty` drift and civilian theft were already
commented out, V: `StrategicTownLoyalty.c:380-411`, and the call is gone). The only periodic change is Enrico's
inactivity check, `HandleEnricoEmail` at 07:00 daily (`Strategic/Strategic_Status.cc:246-391`,
`ENRICO_MAIL_TIME`, `StrategicMap.cc:126`):

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
      complaint mails at inactive == t, 2t, 3t (M5)
      DecrementTownLoyaltyEverywhere(5000 × (inactive − t + (mail 2 already sent ? 1 : 0)))
newSectorsToday = min(newSectorsToday, 4) / 3
```
So a day with a progress or setback mail does not count as inactive, and a day with a creature or progress mail also
keeps the full new-sector count. Activity (`UpdateLastDayOfPlayerActivity(day)`
resets the counter when `day > lastActiveDay`, `:221-228`): damaging an enemy in an enemy-controlled or non-town sector,
any creature (`Soldier_Control.cc:5442-5459`); the 4th new sector visited in a day (`Tactical_Save.cc:795-800`);
whole-town liberation (+2/+4 days) and first SAM capture (+1/+2).

### 2.9 Effects of loyalty

| Effect | Rule | Source | Milestone |
|---|---|---|---|
| Militia training | rating ≥ 20 to start and to continue | §1.2, §1.5 | M4 |
| Mine income | player workforce = rating × controlled/size; Queen workforce = (100 − rating) × uncontrolled/size | §3.5 | M4 |
| Head miner "disloyal" dialogue | rating < 50 | `Strategic_Mines.cc:848-863` | M6 |
| Omerta cap | 10 while rebels hostile | §2.2 | M6 |
| Bobby Ray delivery | shipment lost if the destination town's rating < 20 or the airport is enemy controlled | `Strategic_Event_Handler.cc:89-95` | M5 |
| NPC willingness to talk (recruiting) | `iTownVal = rating × townAttachment / 100` mixed with opinion and approach | `TacticalAI/NPC.cc:470-505` | M6 |
| Facts `LOYALTY_LOW` < 30, `OKAY` 30..49, `HIGH` ≥ 80 (started loyalty towns only) | | `Strategic/Quests.cc:785-830`, `Quests.h:211-213` | M6 |
| Civilian quotes | `Tactical/Civ_Quotes.cc:563-569` | cosmetic |

No effect on prices, sector income other than mines, or enemy behaviour.

### 2.10 RNG in loyalty code

`Random(100)` false accusal in `HandleMurderOfCivilian` (only for non-player killers); `Random(100)` per item in
`RemoveRandomItemsInSector`. Everything else is deterministic (the LOS tests and `FindStratPath` draw nothing).

---

## 3. Mines

### 3.1 Data

`strategic-mines.json` (order = mine id, saves depend on it): San Mona D4 gold, abandoned (`minimumMineProduction` 0);
Drassen D13 silver 1000 (`delayDepletion`); Alma I14 silver 1500 (`headMinerAssigned`, `noDepletion`); Cambria H8 silver
1500; Chitzena B2 silver 500; Grumm H3 gold 2000. Each lists its underground sectors (used for monsters). Head miners
(`Strategic_Mines.cc:50-58`): FRED, MATT, OSWALD, CALVIN, CARL with quote numbers (running out, creatures, creatures
gone, creatures again). Constants (`:28-37`): `REMOVAL_RATE_INCREMENT 250`, `LOW_MINE_LOYALTY_THRESHOLD 50`, 4 periods per
day at 09:00, 12:00, 15:00, 18:00, warning at 2.5 days of supply.

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
other non-abandoned mine without an assigned miner gets one of profiles {106, 156, 157, 158} by
`do Random(4) while used` until 4 have been placed; `FACT_MINERS_PLACED`. The head miner's `bTown` links him to the mine
(`GetHeadMinersMineIndex`, `Strategic_Mines.cc:798-814`).

**Production for the player requires `fSpokeToHeadMiner`**, set by `PlayerSpokeToHeadMiner` from the NPC action
`NPC_ACTION_START_MINE` (`Tactical/Interface_Dialogue.cc:2788-2800`, also restarts a shut-down mine);
`NPC_ACTION_STOP_MINE` shuts it down; `NPC_ACTION_RESET_MINE_CAPTURED` clears `fQueenRetookProducingMine`. Dialogue is
M6, so M4 needs a stand-in (§6, §9).

### 3.4 The income event

`EVENT_SETUP_MINE_INCOME` runs every day at 00:00 (`StrategicMap.cc:2251`) and `PostEventsForMineProduction`
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
The rate is recomputed after every extraction below the warning point (≈ 10 % of the remaining ore per period at full
workforce), so a depleting mine dwindles over several days and the Queen's extraction can run it dry while she holds it.
Example: Drassen with 4 bumps (rate 1800), loyalty 60, all 3 sectors held: 1800 × 60/100 = 1080 per period, $4320 a day.

### 3.6 Ownership change effects

Capturing a mine entrance with ore left: morale +8 for everyone, `GAIN_MINE` (+1000 base). Losing it: `QueenHasRegainedMineSector`
(sets `fQueenRetookProducingMine` if it ever produced for the player; head miner dialogue in M6), morale −8, `LOSE_MINE`
(−1500). Control of the town's other sectors only changes the workforce share. The town's loyalty is not touched by the
mine changing hands beyond these global events.

### 3.7 Monsters and shutdowns (hooks for M4)

`HourlyMinesUpdate` (`:162-234`), hourly from `HandleHourlyUpdate` and 15 s after any creature death underground
(`EVENT_CHECK_IF_MINE_CLEARED`, `Queen_Command.cc:887`, `Game_Event_Hook.cc:287-290`): for each non-empty mine, if
`MineClearOfMonsters` (`Creature_Spreading.cc:676-`: no creatures in its sectors; once invaded, not until the creature
queen is dead) and shut down but not permanently → quote if player-controlled, `RestartMineProduction`; else if infested
and producing → first time: `fPrevInvadedByMonsters`, start `QUEST_CREATURES`; quote if player-controlled;
`ShutOffMineProduction`. Creatures exist only with the sci-fi option; M4 returns "clear" until creatures land.
`PlayerAttackedHeadMiner` (`:945-968`, from `Overhead.cc:5499-5502`): first time → shut down, permanent, −10000 loyalty.
`AreThereMinersInsideThisMine` (`:1000-1018`) decides whether civilians are placed in underground mine levels.

### 3.8 Prediction, UI values, progress, difficulty

- `PredictDailyIncomeFromAMine(i)` (`Strategic_Mines.cc:543-556`) = `PlayerControlsMine ? min(4 × rate(i, workforcePlayer), supply) : 0`;
  `PredictIncomeFromPlayerMines` sums it. This is the map screen's projected income
  (`GetProjectedTotalDailyIncome`, `Laptop/Finances.cc:224-242`) and feeds `CalcDifficultyModifier` (−5 when 0, §1.9).
- `GetMaxDailyRemovalFromMine` (`:263-273`) = `shutDown ? 0 : min(4 × maxRemovalRate, supply)`.
- `CalcMaxPlayerIncomeFromMines` (`:574-582`) = Σ 4 × `maxRemovalRate` over all mines — after a mine empties its rate
  is 0, so the denominator of the income share of `CurrentPlayerProgressPercentage` shrinks (`Tactical/Campaign.cc:1189-`,
  weights from `game.json` `progress`, 50 % income; `17`).
- Mine info box (`Map_Screen_Interface_TownMine_Info.cc:236-310`): status (abandoned / shut down / running out /
  producing), predicted daily income, max daily removal, production % (predicted × 100 / max), town control %, loyalty
  (if started), type. Remaining ore is debug-only.

### 3.9 Money (what M4 needs from Finances)

- Balance `LaptopSaveInfo.iCurrentBalance` (INT32), new-game value `game.json` `starting_cash_{easy,medium,hard}`
  (45000/35000/30000; `15` does init).
- `AddTransactionToPlayersBook(code, secondCode, minute, amount)` (`Laptop/Finances.cc:159-214`): balance += amount;
  append `{code, secondCode, minute, amount, balanceAfter}`; for `HIRED_MERC`, `IMP_PROFILE`, `PAYMENT_TO_NPC`,
  `EXTENDED_CONTRACT_*` also `profile[secondCode].uiTotalCostToDate += −amount`. It never refuses: callers check the
  balance (militia: `balance >= cost`). Codes (`Laptop/Finances.h:15-45`) used in M4: `DEPOSIT_FROM_SILVER_MINE`,
  `TRAIN_TOWN_MILITIA`, `PAYMENT_TO_NPC` (daily RPC salary, §5.13), `TRANSFER_FUNDS_TO_MERC` (Larry, M6).
- Skyrider's per-sector bill (§4.4) is accumulated and paid through the same function (`16`).

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
`UpdateSAMDoneRepair`, `SAM_Sites.cc:37-67`). The player cannot repair SAM sites (removed in V, `Assignments.c:449`).

### 4.3 `UpdateAirspaceControl` (`SAM_Sites.cc:69-96`)

For every map sector 1..16 × 1..16: `fEnemyAirControlled = (controlling SAM s ≥ 0) && StrategicMap[sam s].fEnemyControlled
&& condition ≥ 80`. Called on every control change (both directions, §2.6), on SAM damage and repair, and at init. It
raises `OnAirspaceControlUpdated`, whose handler moves the merc arrival sector back to the start sector if the chosen
one became enemy air (`StrategicMap.cc:2296-2310`, M5 arrival).

### 4.4 Consumers (summary; helicopter movement is `16`)

| Consumer | Rule | Source |
|---|---|---|
| Skyrider path cost | strategic A* for the helicopter group costs 100 per safe sector, 1000 per enemy-air sector (not time) | `Strategic_Pathing.cc:318-328`, `Map_Screen_Helicopter.h:12-13` |
| Skyrider bill | +$100 safe / +$1000 unsafe per sector flown (not when returning to base or cancelled before leaving) | `Map_Screen_Helicopter.cc:247-257` |
| SAM shot | on entering an enemy-air sector whose SAM works: `PreRandom(100) < min(condition, 33)` → hit; 1st minor damage, 2nd forced return to base, 3rd destroyed | `Map_Screen_Helicopter.cc:1046-1130` |
| Refuel sites | unavailable if the site sector is enemy controlled or enemy air (Estoni also needs a fact) | `:615-640` |
| Unsafe-sector counts for the route UI | `GetNumSafeSectorsInPath`/`GetNumUnSafeSectorsInPath` | `:1236-1350` |
| Militia | any SAM sector may train militia (wilderness SAMs need no loyalty; N4 needs Meduna's), cap 20 there | §1 |
| Loyalty/morale | capture/loss events (§2.6) | |

M4 needs the data, `bSAMCondition`, `UpdateAirspaceControl` and `fEnemyAirControlled` in the player view; the shot and
the bill belong to the helicopter work in `16`.

---

## 5. Assignments

### 5.1 Kinds and conditions

`Assignments` (`Strategic/Assignments.h:28-65`): `SQUAD_1..SQUAD_20` (0–19), `ON_DUTY` 20 (the boundary, never assigned
itself), `DOCTOR`, `PATIENT`, `VEHICLE`, `IN_TRANSIT` (hired, not arrived), `REPAIR`, `TRAIN_SELF`, `TRAIN_TOWN`,
`TRAIN_TEAMMATE`, `TRAIN_BY_OTHER`, `ASSIGNMENT_DEAD`, `ASSIGNMENT_UNCONCIOUS` (unused), `ASSIGNMENT_POW`,
`ASSIGNMENT_HOSPITAL`, `ASSIGNMENT_EMPTY`. "On a squad" means `assignment < ON_DUTY`; everything from `DOCTOR` up except
`VEHICLE` is a non-combat assignment. Trainable stats (`:70-82`): STRENGTH, DEXTERITY, AGILITY, HEALTH, MARKSMANSHIP,
MEDICAL, MECHANICAL, LEADERSHIP, EXPLOSIVE (not wisdom).

`AreAssignmentConditionsMet(s, allowed)` (`Assignments.cc:356-369`): each condition holds unless its flag is passed:

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

and always: not `IN_TRANSIT`, not POW.

| Kind | Eligibility | Source |
|---|---|---|
| Doctor | medical > 0, conditions (underground allowed), a `MEDICKIT` in HANDPOS..SMALLPOCK8 (first aid kits do not count) | `:372-398`; `Tactical/Items.cc:3280-3283` |
| Patient | life > 0, (life < max or stats damaged with `enable_stat_healing`), conditions allowing unconscious, EPC, underground | `:594-613` |
| Hospital | as patient; Cambria F8 (`HOSPITAL_SECTOR_*`), paid via Vince (M6) | `:5948-5956` |
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
   hospital refunds the unused payment (M6); `lastAssignmentChangeMin = now`; request a nothing-to-do re-evaluation;
4. kind specifics: doctor/repair swap the kit into HANDPOS (`MakeSureMedKitIsInHand`/`MakeSureToolKitIsInHand`,
   `:3472-3530`: first kit from SECONDHANDPOS on is swapped with the hand; if SECONDHANDPOS is empty and the swapped-out
   object is not, it goes to SECONDHANDPOS); training sets `trainStat`; hospital stops bleeding; repair sets
   `fixingRobot`/`vehicleUnderRepair`; militia may open the payment prompt (§1.3);
5. `ChangeSoldiersAssignment` (`:297-331`): set it; non-REPAIR clears the repair target; DEAD sets life 0;
   DOCTOR/PATIENT/HOSPITAL post `EVENT_BANDAGE_BLEEDING_MERCS` at now + 1 (§5.6);
6. `AssignMercToAMovementGroup` (`:6366-6377`): a non-squad, non-vehicle, non-transit merc without a group gets a new
   player group in his sector (`16`).

Joining a squad (`AddCharacterToSquad`, `Tactical/Squads.cc:180-200`) wakes a sleeping merc and stamps the time when the
assignment changes. `EnoughTimeOnAssignment(s)` = `now − lastAssignmentChangeMin ≥ 45` (`:1213-1216`): nothing pays out
in the first 45 minutes, and a merc in that window counts as taking it easy (§5.4).

### 5.3 The hourly order

`HandleHourlyUpdate` (`Strategic/Hourly_Update.cc:35-73`, on `EVENT_HOURLY_UPDATE`; skipped before the first arrival,
`DidGameJustStart`; order owned by `15`): `UpdateAssignments`, `UpdateBuddyAndHatedCounters`, `HourlyMoraleUpdate`,
`HourlyCamouflageUpdate`, `HourlyMinesUpdate`, `HourlyProgressUpdate`, `HourlyQuestUpdate` (facts by hour, M6),
`HourlyLarryUpdate` (M6), `HourlyCheckIfSlayAloneSoHeCanLeave` (M6), `PayOffSkyriderDebtIfAny`, every 6th hour
`UpdateRegenCounters`. `HandleQuarterHourUpdate` (`:85-92`) runs `DecayTacticalMoraleModifiers` every 15 minutes
(`11` §9 says hourly; it is quarter-hourly).

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
Vanilla has no step 2 and reads the live `fMercAsleep` in step 8 (V: `Assignments.c:1661-1734, 1989`); because step 7
wakes and beds mercs first, vanilla credits the hour to whoever is awake *after* step 7. Stracciatella credits whoever
was asleep *before* it (D1: follow Strac).

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
the loaded sector play SLEEPING/GOTO_SLEEP, waking ones WKAEUP_FROM_SLEEP (presentation).

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
is always ×1. So for ja2-node: **compressed ⇔ time is running on the strategic map** (flow strategic, not in tactical),
independent of the driver (§9). Example: 60 % health → 60 hundredths/h asleep, 15 on assignment, 5 on a squad in tactical.

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

**Bandaging on assignment** (`BandageBleedingDyingPatientsBeingTreated`, `:6461-6528`, the minute event from §5.2):
for each OUR merc bleeding or below OKLIFE on PATIENT/DOCTOR/HOSPITAL: hospital → bleeding 0, life at least OKLIFE, free;
else the first doctor who could ever heal him (`AnyDoctorWhoCanHealThisPatient`, id order) uses his first IC_MEDKIT item
(first aid kit or medical kit, `FindObjClass`): `VirtualSoldierDressWound(d, p, kit, total, total)` with 12 APs
(`RT_FIRST_AID_GAIN_MODIFIER`, `Strategic/Auto_Resolve.cc:910-1056`; formula in `19`), `UseKitPoints(kit, cost)`. Then
all pending copies of the event are deleted and one is re-posted for now + 1 if anyone still bleeds or is dying.
`VirtualSoldierDressWound` checks `inv[0]` (HELMETPOS) for MEDICKIT instead of HANDPOS, so the +50 % never applies
(quirk; tactical `SoldierDressWound` uses HANDPOS, `Soldier_Control.cc:7040`). Its `StatChange` calls draw `pre`.

**Hospital** (M6, Vince): `HealHospitalPatient` 5 points per hour (2 per life point below OKLIFE), done at full life
(`:1634-1714`).

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
items. `IsItemRepairable` = status < 100 and `ITEM_REPAIRABLE` (`:2027-2030`).

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
   `StatChange(s, statAmt, pts, FROM_TRAINING)` if pts > 0 (`11` §10: chance 0 at ≥ 85, wisdom applies to physical
   stats when training);
3. militia (§1.4). Instructors themselves gain nothing.

`ValidTrainingPartnerInSameSectorOnAssignmentFound(target, wanted, stat)` (`:6783-6834`): another OUR merc on the wanted
assignment, same sector, same stat, alive, and the instructor/student pairing gives > 0 bonus points. Example: Wis 80
training a 60 stat alone: 80 × 25 / 1000 = 2 chances per hour.

### 5.9 Training militia

See §1.2–§1.5. On the assignment side: one of the three per-sector handlers of step 8, after stat training; trainers who
are asleep during the past hour or within their first 45 minutes contribute nothing; a trainer whose
`CanCharacterTrainMilitia` fails (area full, loyalty dropped) is "nothing to do" but keeps training.

### 5.10 Nothing to do, done, aborted

`ReEvaluateEveryonesNothingToDo()` (`:6532-6603`): DOCTOR: can't doctor or nobody ever healable; PATIENT: can't be a
patient or no doctor can ever heal him; HOSPITAL: can't be a patient; REPAIR: can't repair or finished; TRAIN_TOWN:
`!CanCharacterTrainMilitia`; TRAIN_SELF: can't train the stat; TRAIN_TEAMMATE/BY_OTHER: can't, or no valid partner;
squads and vehicles: never. Changing to "has something" clears the done-quote flag. It runs at the end of
`UpdateAssignments` and, when requested by `SetTimeOfAssignmentChangeForMerc` and others, on the next map screen frame
(`MapScreen.cc:6575-6577`; tactical defers it to the map screen). The flag feeds §5.4 (rest) and §5.8 (students).

`AssignmentDone(s, sayQuote, meToo)` (`:2747-2819`): animation reset in the loaded sector; hospital clears the final
destination; TRAIN_TOWN with `!meToo` → quote + "completed" list (§1.5); the first time (done-quote flag) DOCTOR, REPAIR,
PATIENT, HOSPITAL say "assignment complete" and the merc joins the "assignments finished" box. The merc keeps his
assignment. `AssignmentAborted` (`:2736-2744`): message + stop compression.

### 5.11 Interaction with travel and the clock

- A merc on a non-squad, non-vehicle assignment has his own player group and cannot be given a route (`ME_BUSY`,
  `Map_Screen_Interface.cc:3818-3820`): the player puts him back on a squad first. Mercs between sectors cannot take any
  non-squad assignment (no kind allows `AC_MOVING`; only sleeping does); doctors cannot treat moving patients.
- Fatigue applies while travelling (on foot, with encumbrance; vehicle passengers rest unless driving). On arrival in a
  sector that is not the destination, `AnyMercInGroupCantContinueMoving` (`Assignments.cc:6318-6343`, from
  `Strategic_Movement.cc:3477`) stops the whole group if anyone is too tired (`PlayerSoldierTooTiredToTravel`, `:6346-6363`:
  awake with breathMax < 30, or asleep and not awakenable; vehicle passengers only if they must drive): those mercs are
  put to sleep and collapse, the route is cleared, compression stops. Plotting a route is refused for a merc already too
  tired (`ME_CUSTOM`, `Map_Screen_Interface.cc:3825-3829`).
- A battle wakes everyone involved (`WakeUpAllMercsInSectorUnderAttack`, `PreBattle_Interface.cc:1284-1296`, forced); PBI
  "retreat/fight" put non-squad mercs onto squads (`19`).
- All of it runs on game minutes: `EnoughTimeOnAssignment`, the hourly event and the bandage minute event (`15`). In
  turn-based combat the world clock is frozen (`10` §8.4), so no assignment progress happens.

### 5.12 Merc-side periodic updates needed for M4

| Update | When | What | Source |
|---|---|---|---|
| Bleeding, breath regeneration, shock decay | every real-time tactical turn for **all** OUR mercs, wherever they are (blood drops only in sector) | `EVENT_BeginMercTurn` (`10` §2.4); the turn cadence on the strategic map follows time compression and the wall clock (`Strategic_Turns.cc:30-88`); `15` fixes it in game time | `Tactical/Tactical_Turns.cc:80-139`, `Soldier_Control.cc:4000-4030` |
| Natural healing | hourly | §5.5 | |
| Rest/fatigue/sleep | hourly | §5.4 | |
| Tactical morale decay | every 15 min | `DecayTacticalMoraleModifiers` (`11` §9; nervous/claustrophobic cases) | `Morale.cc:138-217` |
| Team morale, delayed strategic morale | hourly | `HourlyMoraleUpdate`: average opinion of awake teammates in the same sector or moving group (a hated one present → −25, the minimum), + (best leadership − 50)/10, clamped to −25..+25; the team modifier moves 1 + diff/10 toward it; every 3rd call decays the strategic modifier (function-static counter, not saved) | `Morale.cc:664-815` |
| Buddy/hated counters | hourly | counters, complaints, quitting (MERC/NPC mercs leave) | `Strategic_Merc_Handler.cc:526-730` |
| Camouflage | hourly | −2 % (not CAMOUFLAGED trait); monster smell −1 | `:733-759` |
| Daily merc update | 00:00 (not day 1) | low death rate morale +5 everyone; per merc: daily quote flags, equipment complaint event at 06:00–23:59 (`360 + Random(1080)`), `usTotalDaysServed++`, RPC salary (`PAYMENT_TO_NPC`; 3 unpaid days → quits), `DailyMoraleUpdate` (high death rate, poor/great morale events), contract offer check; unhired AIM/MERC mercs (`Random`) | `Strategic_Merc_Handler.cc:135-370`, `Morale.cc:818-856` |
| Merc death bookkeeping | on death | history, death count, `SOLDIER_DEAD`, breath 0, profile dead, insurance (M5), teammate morale | `:52-130` |

### 5.13 Contracts and payments (summary, M5)

AIM contracts expire at a day boundary slot (07:30/13:30/19:30, `Merc_Hiring.h:14`): `MercDailyUpdate` posts
`EVENT_MERC_ABOUT_TO_LEAVE` two hours before each slot and `EVENT_BEGIN_CONTRACT_RENEWAL_SEQUENCE` at each slot
(`Strategic_Merc_Handler.cc:151-159`); renewal, refusals and departures are `Strategic/Merc_Contract.cc` (M5). M.E.R.C.
mercs are billed daily (Speck) and quit when the account is invalid (`:274-284`). RPCs cost `sSalary` per day,
deducted at 00:00 if affordable (`:209-257`). M4 keeps mercs indefinitely (no contract clock) unless `15` decides
otherwise; the daily RPC salary is cheap to include.

### 5.14 Facilities

`SECTORINFO.uiFacilitiesFlags` (hospital, industry, prison, military, airport, gun range) are display flags only
(`Player_Command.cc:33-53`); the gun range bonus is hardcoded to H13 (§5.8). No facility assignments exist in
Stracciatella (a 1.13 feature).

### 5.15 RNG in the hourly update

In order: step 8 sectors column-major, per sector doctors → repairmen → training, mercs in id order:
- doctor: `StatChange` MEDICAL (used/100 chances), DEX (used/200), WIS (used/200): one `pre` draw per chance, plus
  `main` `Random(100) < 25` per stat point gained (`11` §10);
- repair: unjam MECH 5 + DEX 5 per gun (`pre`), then MECH and DEX used/2 each (`pre`), then `main` `Random(100)` toolkit
  wear;
- training: students' `StatChange` chances (`pre`), trainers of militia LDR `1 + pts/200` (`pre`);
- bandage minute event: `VirtualSoldierDressWound` MEDICAL actual/2, DEX actual/4 (`pre`).
Rest, fatigue, sleep, natural healing, hospital, militia completion: none. Other hourly handlers: `HourlyLarryUpdate`
`Random(n)`, Slay `Chance(15)` (M6).

---

## 6. Agent API (D15, D16)

**Commands** (strategic, accepted while time is stopped or running; refused in turn-based combat):

| Command | Semantics | Notes |
|---|---|---|
| `assign {soldiers[], to}` with `to` = `{kind:'squad', squad?}` · `{kind:'doctor'}` · `{kind:'patient'}` · `{kind:'repair', target?: 'items' \| 'robot' \| {vehicle}}` · `{kind:'trainSelf' \| 'trainTeammate' \| 'trainByOther', stat}` · `{kind:'trainMilitia'}` · `{kind:'vehicle', vehicle}` · `{kind:'hospital'}` (M6) | `SetAssignmentForList` per soldier, in the given order, each checked independently; result per soldier `ok` or a reason (`notConscious`, `enemiesHere`, `moving`, `underground`, `inTransit`, `pow`, `epc`, `mechanical`, `noMedkit`, `noToolkit`, `nothingToRepair`, `statAtCap`, `statTooLowToTeach`, `noMilitiaHere`, `loyaltyTooLow`, `militiaFull`, `tooManyTrainers`, `squadFull`, `squadElsewhere`, `squadMoving`) | the original shows one failure box for the batch |
| `sleep {soldiers[]}` / `wake {soldiers[]}` | `SetMercAsleep` / `SetMercAwake` with their checks; reasons `notTired`, `sectorNotCleared`, `walking`, `driving`, `collapsed` | waking a tired merc sets `forcedToStayAwake` |
| `moveMilitia {from, to, rank, count}` | repeated pick-up/drop of §1.8 (same town, both our and peaceful, target total < 20) | atomic: all or nothing; built in M8 (U8, `04` §6.28) with the refusals of `HandleMilitiaRedistributionClick` |
| `distributeMilitia {town}` | the AUTO button | built in M8 (U8): the box sum over the militia map with the quirk of §1.8 |
| `startMine {mine}` | **temporary** stand-in for `NPC_ACTION_START_MINE` until M6 dialogue: requires an OUR merc in the entrance sector and the head miner alive; sets `fSpokeToHeadMiner`, restarts a non-permanent shutdown | deviation (§9) |

**Decision prompts** (time stops until answered):
- `militiaPayment {sectors[], cost, balance}` → `yes`/`no` (§1.3); an unaffordable cost is not a prompt but an
  informational result, and the trainers are reset.
- `militiaContinue {sector, cost}` → `yes`/`no` (§1.5); loyalty/full/money failures are informational.
- Informational boxes (assignments finished, mercs fell asleep/woke, militia promotions, head miner quotes, "running
  out") are auto-closed by default policy but reported as events.

**Events** (returned by `advance`; those the original pairs with `StopTimeCompression` or a box are default stop
conditions on the strategic map): `assignmentDone {soldier}`, `assignmentAborted {soldier, reason}`,
`fellAsleep {soldier, collapsed}`, `wokeUp`, `tooTiredToTravel {group, soldiers}`, `itemRepaired {repairer, owner, item}`,
`gunUnjammed`, `statChanged` (exists), `militiaTrained {sector, created, promoted}`, `militiaPromoted {green→reg, …}`,
`militiaDefected`, `loyaltyChanged {town, rating}` (only towns the player sees), `mineIncome {amount}`,
`mineRunningOut {mine}` (head miner quote), `mineEmpty`, `mineShutDown`/`mineReopened`, `airspaceChanged`,
`moneyChanged {code, amount, balance}`.

**Observation** (`PlayerView`, only what the original's screens show):
- per merc: assignment (+ stat, repair target, vehicle), asleep, collapsed, life/lifeMax, bleeding, breath/breathMax,
  sector and moving flag, `idle` (= nothing-to-do flag), `onAssignmentSince` (or "effective from" = change + 45 min),
  kit points (med/tool), and the face-panel numbers (`Tactical/Faces.cc:840-905`): doctor
  `(healing pts + 5)/10` of `(max + 5)/10`, patient life/max, self/student/instructor training points, militia trainer
  `(pts + 5)/10`, repair points (vehicle: rounded down to a multiple of 10);
- per town: name, sectors, control % (`GetTownSectorsUnderControl × 100 / size`), loyalty **only if started and the town
  uses loyalty**, militia per rank in player-controlled sectors (and, for scouting, `CanNearbyMilitiaScoutThisSector`),
  training % and paid flag per sector, whether militia can be trained (allowed, loyalty ≥ 20, not full, trainers < 2);
- per mine: status, predicted daily income, max daily removal, production %, type (never the remaining ore or which
  mine will deplete);
- SAM sites: owner, functional (condition ≥ 80) as far as the map shows it, enemy-air sectors;
- money: balance, projected daily income (`PredictIncomeFromPlayerMines`), recent ledger entries.

**Queries**: `assignmentPreview {soldier, to}` → eligibility + the points the merc would produce (the same functions,
no side effects; the kit-to-hand swap is simulated, not applied); `militiaTrainingCost {soldiers[]}` → unpaid sectors
and total.

---

## 7. Data tables and stubs

**Use directly** (already in `data/externalized/`): `strategic-mines.json`, `strategic-map-towns.json`,
`strategic-map-sam-sites.json`, `strategic-map-sam-sites-air-control.json`, `game.json` (`enable_stat_healing`, starting
cash, `squad_size`, progress weights), `items.json` (`bRepairEase`, repairable/electronic flags, MEDICKIT/TOOLKIT ids),
`mercs-profile-info.json` (merc type: AIM/MERC/RPC/NPC for the RPC training bonus and salaries).

**Transcribe** with `tools/transcribe/*.ts` from the C sources (SFI-SCLA allows it; regenerate, never edit):

| Table | Source | Generator |
|---|---|---|
| `town-loyalty.json`: rebel sentiment ×13, uses-loyalty ×13, civilian murder cost by body (8), global event amounts (13, enum order) | `Strategic/Strategic_Town_Loyalty.cc:79-128, 870-915`, `Strategic_Town_Loyalty.h:48-64` | `tools/transcribe/town-loyalty.ts` |
| `head-miners.json`: profile ids and quote numbers (5), random miner profiles {106,156,157,158} | `Strategic/Strategic_Mines.cc:50-58`, `StrategicMap.cc:671` | `tools/transcribe/head-miners.ts` |
| `morale-events.json` (if `11` has not done it): type and delta per event | `Tactical/Morale.cc:27-64` | `tools/transcribe/morale-events.ts` |
| `repair-passes.json`: slot lists of the three passes | `Strategic/Assignments.cc:125-130` | could stay a named constant |

Scalar constants (militia caps and costs, loyalty bonuses/penalties `Strategic_Town_Loyalty.h:14-46`, mine period times,
sleep thresholds, divisors of §5) are named constants in the ported modules with `@src` headers, not tables.

**Imported from the user's data, never committed**: profile fields `needForSleep`, `town`, `townAttachment`,
`mercOpinion[]`, `salary`, `miscFlags3` (extend `src/content/formats/prof.ts`, offsets from `LoadSaveMercProfile.cc`).

**Stub implications**: stub profiles need these fields (authored values); stub items need a medical kit and a toolkit
(the externalized item table already provides them); the stub strategic map (`16`) needs at least one trainable town
with two sectors, one mine with a head miner profile stand-in and one SAM to exercise §1–§4; stub sector maps need
enemy-team placements of all three classes so militia can be placed (§1.9). Loyalty, mines and assignments themselves
use no original data.

---

## 8. Minimal M4 implementation (towns and assignments)

**Modules** (`sim/strategic/economy/` unless noted, all with the SFI-SCLA header):
1. `towns.ts`: town list and column-major `townSectors`, `townOf`, `townSize`, `sectorsUnderControl`, `ourAndPeaceful`.
2. `loyalty.ts`: state, `start`, `set`, `increment`/`decrement`/`update`, `globalEvent` with the distance function (uses
   `16`'s `findStratPath` with a throw-away foot group), `murderOfCivilian` (LOS from `perception`), `inactivity`
   (`HandleEnricoEmail` decision tree minus the mails), sector-control effects as a function called by `16`.
3. `militia.ts`: counts, add/promote/remove, eligibility, payment flow (prompt), `trainTownInSector`,
   `trainingCompleted`, continue prompt, promotions on unload, defections, redistribution commands.
4. `mines.ts`: init (with draws), head miner placement on first entry, `setupIncome`/`income` handlers, workforce,
   extraction, prediction, ownership effects, monster hook (always clear), `startMine` stand-in.
5. `sam.ts` (`sim/strategic/map/`): condition, damage listener on structure damage, `updateAirspace`.
6. `sim/campaign/finances.ts`: balance, ledger, `addTransaction`.
7. `assignments.ts`: kinds, conditions, set/change, the hourly `updateAssignments` in the order of §5.3, and its parts
   `rest.ts` (sleep, fatigue, natural healing), `doctor.ts` (+ bandage minute event, hospital as a stub returning),
   `repair.ts`, `training.ts`; `nothingToDo.ts`.
8. `sim/tactical` hooks: militia placement (`AddSoldierInitListMilitia`, after `16`/`17` port `SortSoldierInitList`),
   `CalcDifficultyModifier` from strategic state, militia death → strategic remove + loyalty, `militiaKills` on the
   soldier (only the save reader has it today: +1 in `HandleNPCTeamMemberDeath`, +2/+1 at the death commit),
   enemy death → `ENEMY_KILLED`, battle won/lost events, attack on militia → side change, head miner attack, SAM gridno
   damage, `fIntendedTarget` (exists).
9. `protocol`/`server`: commands, prompts, events and view of §6.

**Order of work**: (a) towns, finances, loyalty accumulator and global events (pure, testable alone); (b) SAM/airspace;
(c) mines (init, income, depletion) on top of the clock and event queue of `15`; (d) assignments: conditions and
setting, rest/fatigue/sleep, natural healing, doctor, repair, stat training, nothing-to-do; (e) militia training and
completion; (f) militia in tactical and promotions on unload; (g) murder and theft; (h) API and view; (i) save import of
sections 11, 25, 26, 34 (`14`) and oracle probes.

**Tests** (unit unless noted):
- loyalty: increment/decrement scaling per sentiment, 10000 chunking, remainder sign, cap at 100 and Omerta 10, floor 0,
  `start` with and without Miguel's fact; distance table (0..3..13 sectors, underground doubling, −100 floor, zero
  effect skipped, San Mona ignored); murder: body table, accidental halving, blame table with a fixed roll, team cases
  including the MILITIA/CREATURE fall-through, the 100/175 factor;
- control changes: contested vs uncontested capture, Omerta day 1, J9/K4 exclusions, liberation once, theft chance
  capped at 90;
- inactivity: tolerance per difficulty and progress, the branch order (mail days do not count), penalty with and without
  mail 2;
- mines: init with a scripted RNG (retry loops, bump sizes, depleted mine supply and warning point), workforce shares,
  4 events per day at the right minutes, extraction to empty, running-out rate formula against hand-computed
  `fround` values, Queen extraction only after first production, prediction and max daily removal;
- SAM: air-control table semantics (0 = none), condition threshold 80, damage floor;
- militia: eligibility chain, unpaid-sector cost, training points with TEACHING/RPC/fatigue, percent/hundredths carry,
  completion fill → neighbours (column-major) → promote here → promote neighbours → waste, loyalty only if ≥1 placed;
  promotion with kill points 2/3/5/7 and the rank fallback; defection counts; redistribution pick/drop/auto (including
  the lost-militia case);
- assignments: condition flags per kind; 45-minute rule; need for sleep (health shifts, trait reductions, UINT8 wrap);
  rest/fatigue amounts incl. encumbrance and the < 50 multiplier; the ≥ 95 oscillation; auto-sleep, collapse and wake;
  natural healing divisors incl. the compression rule; doctor points, even split + worst-first leftovers, double cost
  below OKLIFE and the odd point, kit consumption from the last object, used-hundredths refund; repair points and kit
  factor, cost adjustment incl. electronics, own-items slot order, others by experience level and pass, unjam cost,
  the free fix of tiny damage; training points (self/instructor/opinion/gun range), best instructor, partner validation;
  `StatChange` chance counts per hour (draws stubbed);
- scenario (headless): a stub town with two trainers paid and trained to completion over game hours with the instant
  driver; identical results under the manual driver.

**Oracle probes** (extend `tools/oracle/src/Oracle.cc`; outputs stay outside the repo):
- `strategic`: dump town loyalty (13 × rating, change, started, liberated), militia counts and training fields of all
  town and SAM sectors, mine status (6 × all fields), SAM conditions and `fEnemyAirControlled`, balance, world minutes,
  inactivity fields;
- `mercs detail=strategic`: per OUR merc assignment, train stat, asleep, collapsed, forced awake, breath/breathMax, life,
  `sFractLife`, `uiLastAssignmentChangeMin`, nothing-to-do flag, plus the pure estimates
  `CalculateHealingPointsForDoctor`, `CalculateRepairPointsForRepairman`, `GetSoldierTrainingPts`,
  `GetSoldierStudentPts`, `GetTownTrainPtsForCharacter`, `GetBonusTrainingPtsDueToInstructor(s, NULL)` (all with
  `fMakeSureKitIsInHand = FALSE`);
- `assign who= kind= stat=`: `ChangeSoldiersAssignment` + `SetTimeOfAssignmentChangeForMerc` bypassing the UI;
- `warp seconds=N`: `WarpGameTime(N, WARPTIME_PROCESS_EVENTS_NORMALLY)` (`Game_Clock.cc:160-167`), then `strategic` and
  `mercs` again; compare only RNG-free outputs (life and fractions, breathMax, sleep flags, training percent, mine
  income and ore, balance, loyalty after deterministic events); stat gains need the planned `TRACE_RULE` of
  `StatChange` (stat, chances, cause) to compare chance counts instead of outcomes;
- `loyalty event=… sector=…`: `HandleGlobalLoyaltyEvent` then the loyalty dump (exercises `FindStratPath` distances).
The six saves are in B13, C13 and D13: Drassen sectors, the D13 mine and the D15 SAM nearby, early in a campaign — a good
base for Drassen loyalty, mine income (whether Fred was spoken to is in the mine status) and fatigue/sleep of the squad.
Headless message boxes and dialogue events raised by these handlers are a risk for the probe harness (inferred).

---

## 9. Quirks to keep, deviations to log, verified vs inferred

**Quirks to keep** (all read in Strac; V where marked):
- `g_town_sectors` is column-major; it drives militia overflow and redistribution order.
- Training progress accrues regardless of the paid flag; payment survives trainers leaving; no carry-over past 100 %;
  the completing trainer stops the others that hour (they get no LDR chance).
- A session creates up to 10 greens or promotes greens, never elites; loyalty bonus only if ≥1 militia placed.
- Militia kills give 3 points, assists 1; promotions only at sector unload, not after autoresolve hand-off; rank fallback
  to higher ranks; double promotion green → elite possible.
- Militia placement: no attitude roll and no detail drop in the class-matched basic pass.
- Redistribution AUTO counts militia in hostile-occupied sectors but never gives them back; leftovers over 20 are lost.
- Loyalty: remainder keeps its sign; reaching the cap exactly zeroes the remainder; increments/decrements of unstarted
  towns are dropped; `SetTownLoyalty` starts towns (rebels betrayed starts unvisited towns at 0).
- Distance 0 for both "same sector" and "no path".
- Uncontested captures give no sector, liberation, mine or SAM loyalty and never complete a town's liberation.
- `HandleMurderOfCivilian` falls through to a full decrement for rebel-hostile militia and non-monster creature killers;
  militia deaths never count as murder.
- Theft happens on every enemy takeover call, also for reinforcements.
- Inactivity is not counted on days with a progress or setback mail; creature/progress mail days skip the new-sector
  counter reset.
- Mines: Queen extraction only after the mine produced for the player; the running-out rate uses float math; the max
  income denominator shrinks when a mine empties.
- Assignments: doctors are patients too; the odd point below OKLIFE is wasted; kits are consumed from the last object;
  tiny damage (cost rounds to 0) is fixed for free even with 0 points left; unjamming runs for every pass;
  `CanCharacterRepairAnotherSoldiersStuff` tests the repairer for mechanical/EPC; `VirtualSoldierDressWound` reads
  HELMETPOS for the medical kit bonus; rested squad mercs oscillate around 95 breathMax; dying awake mercs are fatigued.
- Strac changes vs V, kept per D1: sleep status recorded before the hourly rest step; partnerless students do not train;
  `CalcSoldierNeedForSleep` health term fixed (V: integer bug); militia promotion without draws below the thresholds.

**Deviations to log in `docs/deviations.md`**:
- *Time compression for healing*: `IsTimeBeingCompressed` replaced by "time runs on the strategic map" (same outcome as
  the original's screens; drivers do not matter).
- *Nothing-to-do re-evaluation*: done right after the command that requests it, instead of on the next map screen frame
  (in tactical the original waits until the map screen).
- *Loyalty distance*: the SHIFT key "direct path" of `FindStratPath` is ignored.
- *qsort ties* for militia trainers: stable sort, id order on equal points (glibc `qsort` is a merge sort for these
  sizes, so likely identical; inferred).
- *Head miner*: `startMine` command until NPC dialogue (M6); without it no mine produces.
- *Strategic-map tactical turns*: bleeding/breath for absent mercs on a fixed game-time cadence (`15` decides; the
  original's cadence depends on the wall clock and frame rate at high compression).
- *Morale counter*: `HourlyMoraleUpdate`'s 3-hour strategic decay counter is function-static and not saved in the
  original; ours is saved state (a save/load can shift the decay hour in the original).
- Temporary, until later milestones: hospital, quests and NPC loyalty actions, contracts, Larry/Slay, Bobby Ray.
  Creatures in mines and eaten civilians are wired in campaigns (`docs/17` §20).

**Verified** by reading Strac (V cross-checks where marked): every function quoted with a line range — militia
eligibility, payment, points, completion, promotions, defections, redistribution, tactical placement; loyalty
accumulator, global events and distances, murder, control changes, theft, liberation, inactivity, effects; mine init,
schedule, workforce, extraction, depletion, prediction; SAM condition and air control; assignment kinds, conditions,
setting, the hourly order, rest/fatigue/sleep, natural healing, doctoring, bandaging, repair, training, nothing-to-do;
the periodic merc updates. **Inferred**: the `fIncrement` fall-through being intended behaviour to keep (it is what the
code does); glibc `qsort` order for equal trainer points; `FindStratPath` distances never exceeding 30 on the real map;
that no town is unreachable for a foot group (else distance 0 gives +75 %); the headless probe harness tolerating the
dialogue and message box calls of these handlers; that walking mercs' `sSector` is the departure sector for
`fSectorsWithSoldiers` (from `16`'s group model).

---

## 10. Implemented (2026-10-16): §8 order of work (a)–(e) and the save import of (i)

**Content.** `src/content/strategic/economy-content.ts` (`loadEconomyContent(read, towns)`): `strategic-mines.json`, starting
cash and `enable_stat_healing` from `game.json`, merc types from `mercs-profile-info.json`, and two transcribed tables:
`data/tables/town-loyalty.json` (`tools/transcribe/town-loyalty.ts`: sentiment, uses-loyalty, civilian murder costs, the 13
global events, the named bonuses and penalties) and `data/tables/head-miners.json` (`tools/transcribe/head-miners.ts`).
`prof.ts` now also reads `needForSleep`, `town`, `townAttachment` and `mercOpinion[]`.

**State.** `StrategicState.economy` (`towns[13]`, `mines[]`, promotion counters, `strategicMilitiaChangesMade`, the
completed-training list of the running hourly update, pending `prompts`) and `StrategicState.finances`
(`src/sim/campaign/finances.ts`: balance, ledger, profile cost totals, `addTransaction`). Enrico flags and highest progress
live in the Queen's `state.status`, the activity counters in `map.activity`. The per-merc assignment fields are soldier
fields reached through the crew port.

**Ports** (`economy/ports.ts`). `CrewPort extends MercPort` with `CrewMember extends StrategicMerc` (life, fractions,
breath, sleep and assignment flags, natural and effective stats, stat damage, soldier and profile traits, need for sleep,
`inv: ItemObject[]`), plus `statChange(id, StatKind, chances, cause)`, `healStat`, `opinion`, `dressWound` (autoresolve's
`VirtualSoldierDressWound`), helicopter/driving queries and `takeOutOfVehicle`. `all()` is the active OUR team in id order
(vehicles and the robot included). `EconomyHooks` (morale events, theft, monsters, Queen mine-ran-out, rebels hostile,
meanwhiles, head miner placement and liveness, facts, vehicle repair, creature quest trigger), `EconomyDecisions`
(militia payment and continue: `yes`/`no`/`defer`) and `PeriodicSlots` (the M5/M6 parts of the hourly and quarter-hour
updates). `createEconomyContext(strategicCtx, setup)` returns an `EconomyContext` that is also a `StrategicContext` (its
`mercs` is the crew port); `economyWorldPort(base, () => ctx)` wraps a `TacticalWorldPort` so the map layer's
`startTownLoyalty`, `sectorLiberated` and `sectorTakenByEnemy` reach the economy.

| Module (`src/sim/strategic/economy/`) | Public API |
|---|---|
| `towns.ts` | `buildTownSectors` (column-major), `townOf`, `townSize`, `sectorsUnderControl`, `isTownUnderCompleteControl`, `numberOfWholeTownsUnderControl`, `sectorOursAndPeaceful` |
| `loyalty.ts` | `initTownLoyalty`, `startTownLoyaltyIfFirstTime`, `setTownLoyalty`, `increment/decrementTownLoyalty(+Everywhere)`, `handleGlobalLoyaltyEvent`, `affectAllTownsLoyaltyByDistanceFrom`, `shortestTownDistances`, `checkIfEntireTownHasBeenLiberated/Lost`, `onSectorLiberated`, `onSectorTakenByEnemy`, `theftChance`, `reduceLoyaltyForRebelsBetrayed`, `handleTownLoyaltyForNpcRecruitment`, `maximizeLoyaltyForDeidrannaKilled` |
| `inactivity.ts` | `handleEnricoEmail` (`ENRICO_MAIL`, decision tree without mails), `lackOfProgressTolerance` |
| `mine-status.ts`, `mines.ts` | `initializeMines` (draws), `postEventsForMineProduction`, `handleIncomeFromMines`, `mineAMine`, `workforceForPlayer/Enemy`, `runningOutRemovalRate`, `predictDailyIncomeFromAMine`, `predictIncomeFromPlayerMines`, `calcMaxPlayerIncomeFromMines`, `maxDailyRemovalFromMine`, `hourlyMinesUpdate`, `placeHeadMinersOnSectorEntry`, `startMineStandIn`, `playerAttackedHeadMiner`, `queenHasRegainedMineSector`, `playerControlsMine` |
| `militia-rules.ts`, `militia.ts` | eligibility predicates, `isAreaFullOfMilitia`, `canNearbyMilitiaScoutThisSector`; `trainTownInSector`, `townMilitiaTrainingCompleted`, `startMilitiaPaymentFlow`/`answerMilitiaPayment`, continue prompt/`answerMilitiaContinue`, `handleMilitiaPromotions`, `handleMilitiaDefections`, `handleMilitiaStatusBeforeLoadingNewMap`, add/promote/remove |
| `conditions.ts`, `repair-rules.ts`, `points.ts` | `areAssignmentConditionsMet` and every `CanCharacter…` check; the pure estimates `calculateHealingPointsForDoctor`, `calculateRepairPointsForRepairman`, `getSoldierTrainingPts`, `getSoldierStudentPts`, `getBonusTrainingPtsDueToInstructor`, `getTownTrainPtsForCharacter` |
| `rest.ts`, `doctor.ts`, `repair.ts`, `training.ts` | sleep need, rest/fatigue/sleep/wake, natural healing, `anyMercInGroupCantContinueMoving`; doctoring, hospital, `bandageBleedingDyingPatientsBeingTreated`; repair; stat and militia training |
| `assignment-done.ts`, `set-assignment.ts` | `changeSoldiersAssignment`, `assignmentDone`, `reEvaluateEveryonesNothingToDo`; `assignSoldiers(ctx, ids, target)` (§6 `assign`), `sleepSoldier`, `wakeSoldier`, `applySquadAssignment` (soldier side of `AddCharacterToSquad`, for the crew port's `changeAssignment`) |
| `update.ts` | `updateAssignments` (§5.3 order), `handleHourlyUpdate`, `handleQuarterHourUpdate`, `registerEconomyEvents` (`HOURLY_UPDATE`, `QUARTER_HOUR_UPDATE`, `SETUP_MINE_INCOME`, `HANDLE_MINE_INCOME`, `CHECK_IF_MINE_CLEARED`, `BANDAGE_BLEEDING_MERCS`, `ENRICO_MAIL`) |
| `init.ts`, `save-import.ts` | `initEconomyStrategicLayer` (InitTownLoyalty + InitializeMines), `addStartingCash`; `importEconomy`, `applySavedAssignment` |
| `src/sim/strategic/map/sam.ts` | `doesSamExistHere`, `damageSamIfFound`, `repairSamSite`, `samSiteWorks` (air control itself is `map/control.ts`) |

`CampaignSim` takes `hooks.economy = {economy, items, crew, hooks?, decisions?, slots?}` next to `hooks.strategic`,
exposes `campaign.economy` and registers the handlers above. **New game**: the time layer's init must call
`initEconomyStrategicLayer` at its place in `InitStrategicLayer` (after `InitVehicles`, before `InitNPCs`), `addStartingCash`
in `InitNewGame`, and post the standing `SETUP_MINE_INCOME`/`ENRICO_MAIL` everyday and `HOURLY_UPDATE`/`QUARTER_HOUR_UPDATE`
periodic events (`15` §4.3). **Queen**: `predictIncomeFromPlayerMines`, `calcMaxPlayerIncomeFromMines`, `sectorsUnderControl`,
`numberOfWholeTownsUnderControl`, `militiaTrainingAllowedInSector`, militia counts; she plugs `hourlyProgressUpdate` into the
slots and `queenMineRanOut` into the hooks. **PBI/autoresolve and tactical**: `handleGlobalLoyaltyEvent` (battle won/lost,
kills, abandoned militia), `strategicRemoveMilitiaFromSector`, `handleMilitiaStatusBeforeLoadingNewMap` on unload,
`anyMercInGroupCantContinueMoving` on arrival, `damageSamIfFound` on structure damage, `playerAttackedHeadMiner`.

**Save import** (`src/content/formats/savegame-economy.ts`): `readSavedEconomy(bytes, save.sections)` decodes sections 25
(mines), 26 (town loyalty) and the finances temp file, `importEconomy(state, saved, laptop.currentBalance)` loads them;
`readSoldierAssignments(bytes, save, table)` decodes the assignment fields of every soldier record for the roster
(`applySavedAssignment`). Section 11's militia and training fields were already imported by `importStrategicMap`; section 34
(Enrico flags, highest progress, activity counters) is decoded and imported by the Queen's `savegame-strategic-ai.ts` and
`ai/save-import.ts`, which the economy reads from `state.status` and `map.activity`. A data test imports all six user saves.

**Verified against the oracle** (`tools/oracle/probes/economy.txt`, `README.md` "Economy"): `strategic` (towns, the 39 town
and SAM sectors, six mines with predictions, air control, money, inactivity), `mercs detail=strategic` (assignment fields
and every pure estimate for the nine trainable stats), nine distance-adjusted `loyalty` events, and three `warp`s through
the hourly updates (squads resting and fatiguing for two and three hours; two militia trainers and a self-trainer for eight
hours, ending at 99.58 %) — 54 comparisons, all matching. Unit tests cover the §8 list except murder, theft per item,
redistribution and militia placement; a headless scenario trains a paid Drassen sector to completion with two trainers on
the strategic clock, with identical results when the same span is warped.

**Not yet:** (f) militia placement in tactical and the tactical hooks (kill points, deaths), (g) civilian murder and the
per-item theft, (h) the protocol commands, prompts and view (the functions exist), redistribution (§1.8), hospital
assignment and payment, the vanilla-vs-Strac stat-change trace for oracle comparisons of stat gains, and the roster-backed
crew port in `createSaveSession`.

## 11. Implemented (2026-10-16): the morale rows of §5.12

`src/sim/campaign/team-morale.ts`: `hourlyMoraleUpdate` (team opinion of the awake teammates in the same sector, or the
same group while moving, with the hated slots scaled by their remaining tolerance; best effective leadership; the
delayed strategic modifier applied; the strategic decay every third call), `decayTacticalMoraleModifiers` (the size
dependent step toward 0, claustrophobes underground, nervous mercs far from every friend — `DistanceToClosestFriend` —
or alone in their squad) and `updateBuddyAndHatedCounters` (hated time and counts, complaints with
`StopTimeCompression`, learning to hate and to like, quitting). `BattleFlow` runs them with the roster and the profile
progress (`hourlyMoraleUpdate`, `updateBuddyAndHatedCounters`, `decayTacticalMoraleModifiers`); `CampaignSim` puts them
into the hourly and quarter-hour slots of the economy in the original order (`UpdateBuddyAndHatedCounters` before
`HourlyMoraleUpdate`). The decay counter is `state.teamMorale.strategicDecayCounter` (saved, §9). `prof.ts` reads the
relation fields (sexist, learn to hate/like with times and counts, hated times and counts, the next complaint, death rate)
and native saves import every profile, so imported campaigns keep their counters.

Events: the hated-merc and learned-to-hate complaints are `mercQuote` events with the hated merc as `subject`; a merc who
quits says his quote and leaves through the `mercDeparture` prompt (`docs/22` §4.3, §9). Drugs are not modelled, so
`RefreshSoldierMorale` has no drug term; `DailyMoraleUpdate` runs in the daily merc update (`docs/22` §2.4).

Oracle (`tools/oracle/probes/morale.txt`, patch 0006, README "Morale"): 43 probes on three saves match.
