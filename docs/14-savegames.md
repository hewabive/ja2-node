# 14 — Native savegames

Reading the original's savegames (`.sav` of vanilla JA2 Gold 1.12 and of Stracciatella) and continuing one as a
ja2-node campaign. Siblings: `27` ja2-node's own saves and the save list; `15` the clock and the event queue of an
import; `16`–`18`, `21`–`26`, `35` the state each import step fills; `29` `newSession {save}`. The byte layouts are the
`src/content/formats/savegame-*.ts` modules; their `@src` headers name the Stracciatella loaders, and `LoadSavedGame`
(`SaveLoadGame.cc:644`) gives the section order. `pnpm cli inspect save <file.sav>` summarises a file.

## 1. The path of an import

```
newSession {save}, JA2_SAVE: the file from $JA2_SAVES_DIR       src/server/session-factory.ts
  createSaveSession                                             src/server/save-session.ts
    parseSaveGame: header, layout, encryption, every section    content/formats/savegame.ts
    section readers, from the offsets the parser recorded       content/formats/savegame-*.ts
    refuse a meanwhile or endgame save                          sim/campaign/story-import.ts
    the loaded world: loadedWorldSector                         content/formats/savegame.ts
    the screen it resumes on: resumesOnMapScreen                content/formats/savegame.ts
    with one: TacticalSim on the saved map and door table,      sim/tactical/save-import.ts
      importSave, strategic state on the tactical random streams
    without one: strategic state on its own streams,            sim/tactical/save-import.ts
      importCampaignWideState
    then one import per subsystem:
      time, roster, merchants, map, strategic AI, story,        sim/**/save-import.ts, sim/campaign/save-roster.ts
      creatures, economy, contracts, laptop, narrative,
      assignments, NPC records, the loaded sector's links and schedules
```

`savegame.ts` decodes the header (`savegame-header.ts`: both layouts, the encryption set, the record cipher), the
soldier and profile records (`savegame-soldier.ts`, `savegame-profile.ts`), the tactical and strategic sections and the
temp files; the laptop, contract, economy, merchant, NPC and strategic AI readers decode the sections it steps over.

## 2. Design

**Walk every section.** A save has no table of contents and no section tags, and several sections are framed by counts
read earlier (the temp files by the sector flags, the dealers' special items by per-item counts). `parseSaveGame` walks
all of them in `LoadSavedGame`'s order and fails unless it ends exactly at the end of the file, so a misread framing
shows at once; it records each section's offset for the readers. Versions 85–105 are read, in the Windows layout
(vanilla) and in Stracciatella's Linux layout; older ones frame sections differently and are refused.

**Encryption.** Profiles and soldiers are encrypted record by record with a rotation array the header selects
(`CalcJA2EncryptionSet`; the arrays in `data/tables/save-encryption.json`). The German factor of the set belongs to the
game build, not to the file, so the reader tries the plain set first and keeps the one whose first profile checksum
holds (`germanEncryption`). Since 11 ≡ 1 (mod 10), the factor changes the set only when the u32 product wraps, for large
balances.

**Only the loaded sector is rebuilt.** The game writes the loaded sector into its temp files right before saving, so
those files are the sector's live state, and the import applies them. Every other sector's temp files stay raw bytes
(`tempFiles`): those sectors load from their maps.

**A save without a world.** A save made before the first arrival, or after the last merc left the loaded sector,
has no world (`SaveLoadGame.cc:731`, `:748`): the original leaves the world sector invalid and opens the map screen. The
import reads no map and starts as a campaign does after `trashWorld` or before its landing: the strategic flow, no
tactical sim, `worldSector` null. What a loaded world would carry and outlives it goes into the strategic state
(`importCampaignWideState`: the PreRandom ring, profiles, key table, civilian groups, the opplist decay time); the
roster's soldiers are built from their records; the last sector's temp files are left, like every other sector's. An
imported `didGameJustStart` lands the squad at the first compression, as in a new game.

**The saved screen.** A save resumes on the screen it was made on (`SaveLoadScreen.cc:1188`): one made in tactical in
the tactical flow, one made on the map screen, or without a world, on the map screen, entered as `MapScreenHandle`
enters it (a 5–60 minute compression mode stays but stops, any other becomes X0; `createOnMapScreen`,
`sim/campaign/campaign-sim.ts`), its sector, if any, loaded behind it until `tacticalScreen`.

**An import runs the native load's hooks once.** `LoadSavedGame` does more than read: it adds the sector's soldiers
through `UpdateMercsInSector` (in id order, at the centre of the saved tile, without movement reservation or pending
animation), recompiles the movement costs, posts the schedules, powers the map lights for the saved hour, sets the
ambient light and runs `LoadStrategicAI`'s recomputation (deviation "Strategic AI load hooks"). The import does the
same; ja2-node's own loads never do (`27`). The load's fix-ups come along: `SyncLastMercFromSaveGame`, the I.M.P. slot
from `iVoiceId` before version 104, the start sector for an invalid landing zone.

**Process state as in a fresh process.** What the original keeps in unsaved memory, an import sets as a process that
has just started and loaded the file would hold it: the half of the last-known locations the file lacks (§3), the
underground traversal flag, the talk context, the strategic morale decay counter, Pablo's theft counter (deviations
"Underground traversal flag", "Talk context after a load", "Strategic morale decay counter", "Bobby Ray theft
counter"). The clock starts unpaused (deviation "Pause state after an import"); the enemy-sighting pause of an enemy
turn is not restored.

**The save's tables win.** A native save keeps the strategic traversability its campaign started with (vanilla's
differs from the shipped JSON on the I2/I3 border, `tools/oracle/README.md` "Strategic movement"), and Stracciatella does not
reinitialise it on load; neither does the import.

**Options and origin.** `importNativeGameOptions` keeps difficulty, sci-fi, gun nut and save mode and reports a turn
time limit as dropped (deviation "Timed turns"). Native saves come from `$JA2_SAVES_DIR` (default `SavedGames` next to
the data folder) and need the original data; the input log records the file's digest, and a replay refuses a changed
file. A save made in a meanwhile scene or the endgame sequence is refused (`26`), before any map is read.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Paths are under `src/`:

| Quirk | Test |
|---|---|
| The last-known opponent locations are saved with their element count as byte count ("TODO000F", `SaveLoadGame.cc:1661`): only soldiers 0–77 get theirs back, the others keep a fresh process's zeroed memory; the public lists of teams 3–5 and their noise tiles keep the world load's `NOWHERE` | `sim/tactical/save-import.test.ts` |
| A soldier saved mid-step comes back at the centre of his tile | `sim/tactical/save-import.test.ts` |
| Loading drops every soldier's movement reservation and pending animation | `sim/tactical/save-import.test.ts` |
| An item dropped into a sector while it was unloaded looks for a free tile again at every load | `sim/tactical/save-import.test.ts` |
| So does a corpse, which then faces the first direction its structure fits, counting from north | `sim/tactical/save-import.test.ts`, `sim/campaign/sector-diff.test.ts`, `sim/tactical/corpse-placement.test.ts` |
| A corpse with no free tile within five tiles is lost: the wider retry searches around the `NOWHERE` the first search left (`Tactical/Tactical_Save.cc:650-652`) | `sim/tactical/corpse-placement.test.ts` |
| A loaded creature pool is redrawn as human blood: its type lives in the smell byte, which the load sets after the redraw | `sim/tactical/blood-pools.test.ts` |
| `fFirstVisitSinceServerWentDown` is a `BOOLEAN` holding 0, 1 or 2 | `content/formats/savegame-laptop.test.ts` |

Not pinned yet:
- A vanilla save's `uiFlags` holds `LOADING_SAVED_GAME`, set while writing, and two bits Stracciatella no longer defines
  (`TURNBASED`, `TRANSLUCENCY_TYPE`); the import reads only the combat and endgame bits.
- The corpse search fits the gory corpse's structure whatever the blood option (`Tactical/Rotting_Corpses.cc:1070`).

## 4. Verification and what is not checked against the native build

The oracle loads the same files: `tools/oracle/save-probes.ts` writes probes for any saves (soldier dumps, hit chance,
the AI's best shot, sight, paths and lights for every opposed pair), the native build runs them after its `save`
command, and `tools/oracle/compare.ts` rebuilds each from the imported save (`tools/oracle/README.md` "Savegames",
"`save`"); most other comparers start from imported saves too, entering the loaded sector of a save made on the map
screen first (`tools/oracle/tactical-import.ts`). With the original data, the subsystems' `save-import`
tests import every save in `SavedGames`, and `src/server/save-session.test.ts` keeps playing each one, and the first
again with its world flag cleared.

Inferred from reading the source:
- The Linux layout has a synthetic test only, and no real file covers versions 100–105: the six saves the tests and the
  oracle use (`SaveGame01`, `02`, `07`–`10`) are vanilla version 99.
- A save without a world: none of the six is one; the tests clear the world flag, and for the first arrival the start
  flag, of a save made with one.
- The zeroed half of the personal last-known locations: no probe dumps `gsLastKnownOppLoc`, and a load inside a running
  process keeps whatever the previous game left there.
- The dropped reservations and pending animations and the items' new tiles: the soldier dump compares neither.

Not ported: gaps "Savegame import", "Unread savegame sections". Other deviations of the
import: "Map changes of the loaded sector on import", "Ambient sound events", "Blood on the ground", "Difficulty and
progress in tactical", "Corpse structure past its file".
