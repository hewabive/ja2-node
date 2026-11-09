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
      importSave, strategic state on the tactical random streams;
      every saved soldier created and his animation restarted;
      the bullets, thrown objects, bomb queue and explosions    sim/tactical/native-in-flight.ts
      in flight; the cursor item put back
    without one: strategic state on its own streams,            sim/tactical/save-import.ts
      importCampaignWideState
    then one import per subsystem:
      time, roster, merchants, map, strategic AI, story,        sim/**/save-import.ts, sim/campaign/save-roster.ts
      creatures, economy, contracts, laptop, narrative,
      assignments, NPC records
    the other sectors' temp files into their sector diffs      sim/campaign/save-sectors.ts
    the loaded sector: links, helicopter, map changes,          sim/campaign/sector-flow.ts adoptLoadedSector
      door states, smoke and lights, schedules
    the loaded sector's map modifications flag                  sim/strategic/map/save-import.ts
```

`savegame.ts` decodes the header (`savegame-header.ts`: both layouts, the encryption set, the record cipher), the
soldier and profile records (`savegame-soldier.ts`, `savegame-profile.ts`), the tactical and strategic sections, what is
in flight and the item cursor (`savegame-effects.ts`) and the temp files; the laptop, contract, economy, merchant, NPC
and strategic AI readers decode the sections it steps over. Only the map messages are read past (§2).

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

**Every sector's temp files come along.** The game writes the loaded sector into its temp files right before saving,
so those files are the sector's live state, and the import applies them in the order of
`LoadCurrentSectorsInformationFromTempItemsFile` (`Tactical/Tactical_Save.cc:432`), its records as the original reads
them (`src/sim/tactical/native-temp-files.ts`): the ones the stay changes again become ja2-node map changes, so the
next exit keeps them, and the ones the native load writes back decide whether the sector keeps its map modifications
flag (`SaveLoadMap.cc:236`). The load keeps every other sector's files for that sector's next entry
(`Tactical/Tactical_Save.cc:164`), and the import turns them into its sector diff (`src/sim/campaign/save-sectors.ts`):
items, corpses, the door table, door status, preserved enemies and civilians (each record in the layout its checksum
holds in, `Tactical/LoadSaveSoldierCreate.cc:126`), smoke and lights become ja2-node's records at once; the map changes
and revealed tiles stay the save's records (`SectorDiff.savedMapModifications`, `savedRevealed`), since damage, window
and revealed records need the map. The sector's first entry replays those through the loaded sector's appliers, in
the entry's order and before the diff's own changes, and decides the flag as a load does; the next exit writes
ja2-node's form. A change made in the sector before that entry comes after the save's records, as it would in the
file: a structure added or removed there joins the diff's own changes, and Bobby Ray closing a crate edits the
openable record in place (`SaveLoadMap.cc:744`).

**A save without a world.** A save made before the first arrival, or after the last merc left the loaded sector,
has no world (`SaveLoadGame.cc:731`, `:748`): the original leaves the world sector invalid and opens the map screen. The
import reads no map and starts as a campaign does after `trashWorld` or before its landing: the strategic flow, no
tactical sim, `worldSector` null. What a loaded world would carry and outlives it goes into the strategic state
(`importCampaignWideState`: the PreRandom ring, profiles, key table, civilian groups, the opplist decay time); the
roster's soldiers are built from their records; the temp files of every sector, the last one's included, go into the
sector diffs. An imported `didGameJustStart` lands the squad at the first compression, as in a new game.

**The saved screen.** A save resumes on the screen it was made on (`SaveLoadScreen.cc:1188`): one made in tactical in
the tactical flow, one made on the map screen, or without a world, on the map screen, entered as `MapScreenHandle`
enters it (a 5–60 minute compression mode stays but stops, any other becomes X0; `createOnMapScreen`,
`sim/campaign/campaign-sim.ts`), its sector, if any, loaded behind it until `tacticalScreen`.

**Every saved animation starts again.** `LoadSoldierStructure` creates every saved soldier, of every team and wherever
he is, in id order, and each creation starts his saved animation again at its saved code (`SaveLoadGame.cc:1396`,
`Tactical/Soldier_Create.cc:459`, `Tactical/Soldier_Control.cc:615`), before the temp files load and before anybody
enters the map. The import does the same in `importSave` (`restartSavedSoldiers`, `src/sim/tactical/save-import.ts`):
it creates every soldier of the save, puts those of the loaded sector at their saved tiles without standing them on the
map, links them, and restarts each through `restartAnimationOnLoad` (`src/sim/tactical/animation.ts`) after the
tactical status, as `LoadTacticalStatusFromSavedGame` comes first. `TacticalState.loadingSave` stands for
`LOADING_SAVED_GAME` from the restart to the last soldier placed: every animation started meanwhile, the ones a restart
starts included, takes `EVENT_InitNewSoldierAnim`'s loading branch, which skips every check of a new animation
(`Tactical/Soldier_Control.cc:897`), and a soldier placed meanwhile is not stepped on to his destination (`:1891`). The
restart runs the script with its opcodes, and its draws are the main stream's, as all of `Random` is (deviation "Player
loads"); the saved pending animation is held through it and dropped after, as entering the sector does
(`Tactical/Soldier_Add.cc:871`); the roster takes the restarted soldiers of the mercs on no map. A saved pending action
has no typed record of ja2-node's to go into, so it stays as its code, count and a give's target
(`Soldier.savedPendingAction`): the restart counts it, placing the soldier on the map drops it, and one the load leaves
off the map (seated in a vehicle or the helicopter, in another sector) keeps it until he enters a map or stops, holding
the auto-bandage question back meanwhile and, for a give, every door or container opened on arrival (gap "Pending
actions on import" for the rest). A save with no world
only stands a climber up (deviation "Animations on load without a world"). The restart runs before the campaign hooks
the sector, so an opcode that reports to the campaign does not reach it (gap "Animations on load").

**An import runs the native load's hooks once.** `LoadSavedGame` does more than read: it adds the sector's soldiers
through `UpdateMercsInSector` (in id order, at the centre of the saved tile, without movement reservation or pending
animation) after it has stood a landed helicopter on the map and applied the loaded sector's map changes, revealed
tiles (which switch on the cave lights there, `20`), door states and smoke and light effects, so the helicopter's bump
moves nobody and the smoke gasses nobody, while a soldier entering a smoke tile without a mask is gassed (deviation
"Helicopter on load"; `loadSavedSectorChanges` lifts the imported soldiers off the map meanwhile), recompiles the
movement costs, sends crows to a rotting corpse by day as loading the corpses file does (deviation "Crows on load"),
posts the schedules, powers the map lights for the saved hour, sets the ambient light, runs `LoadStrategicAI`'s
recomputation (deviation "Strategic AI load hooks") and zeroes the busy count, in combat and out of it
(`SaveLoadGame.cc:1100`, `:1179`); resumed in tactical, it selects the selected merc again, forced, and enters the
tactical screen (deviation "Selection on load"). The import does the same; ja2-node's own loads never do (`27`). The
load's fix-ups come along: `SyncLastMercFromSaveGame`, the I.M.P. slot from `iVoiceId` before version 104, the start
sector for an invalid landing zone.

**Everything in flight comes back.** The bullets and the thrown objects come back after the soldiers, who fire, own
and catch them, in the first slots in their saved order, each soldier by his saved id (`loadBulletTable`,
`loadPhysicsTable`, `src/sim/tactical/native-in-flight.ts`; `Tactical/Bullets.cc:390`, `TileEngine/Physics.cc:2150`). A
bullet's last update is 0, so it moves on at the first tick (`Tactical/Bullets.cc:405`), and a thrown knife takes its
status from what its thrower holds then (`HandleBulletSpecialFlags`, `:102`); its tiles per update stay as saved
(deviation "Hide bullets"). A bullet's miss animation is a tile animation, which no save keeps: a bullet saved stopped
stays in its slot until the sector is left, which the AI's wait for the bullets sees, as in the original, and the
server's idle test passes over (`bulletsResolving`, `src/sim/tactical/combat/bullets.ts`). An object comes back with no
level node (`TileEngine/LoadSaveRealObject.cc:40`), which its next move takes for an object not drawn yet
(`TileEngine/Physics.cc:1097`): every use of the node checks it, so nothing breaks, and the object gets one again at
its next tile; its float fields are read as the float32 they are. Neither holds the busy count, which the load zeroes,
so their end releases nothing that was held. The bomb queue comes back with its entries, its active flag, which the
general info keeps (`SaveLoadGame.cc:2092`), and the sight bits of the tactical status; an entry names a world bomb by
its slot, and the load lists the bombs again from the item file (`loadExplosionTable`,
`src/sim/tactical/save-import.ts`). Each explosion in flight is generated again at its saved frame
(`TileEngine/Explosion_Control.cc:2319`, `:159`), after the soldiers, who own them, and at the world load's light
level, which decides whether it gets its light; it adds nothing to the busy count. The queue's interface lock is not
saved (deviation "Interface lock after a load").

**The cursor item and the map messages.** A save keeps the item cursor with its holder and source slot, and the load
hands it back (`Tactical/Interface_Items.cc:5119`); ja2-node keeps no cursor on the server, so the import puts the
item back as `CancelItemPointer` would (`:5086`, deviation "Item cursor on the canvas"). The 256 lines of the message
list are finished text in the saving build's language, so an import starts with an empty list (`Utils/Message.cc:545`,
deviation "Map messages of a native save").

**Vehicle ids.** A soldier's `bVehicleID` is the vehicle he is and `iVehicleId` the one he rides. The import keeps them
apart: every vehicle soldier, on any team, gets his `bVehicleID` (`Soldier.vehicleId`, -1 for anyone else, whose byte
the original leaves at 0), the roster record keeps `iVehicleId`, and a vehicle merc's `RosterMerc.vehicleId` reads his
soldier's (`sim/campaign/roster.ts`). Each vehicle is linked to the first active soldier who is it, whatever his team,
as `FindSoldierType` scans (`sim/strategic/map/save-import.ts`), and the list is refilled in place, as the tactical sim
shares it (`25`). The fuel patch of saves up to version 73 (`SaveLoadGame.cc:981`) never applies: those are refused. The
seat (`SOLDIER_DRIVER`, `SOLDIER_PASSENGER`) moves onto the soldier (`Soldier.vehicleSeat`); the drivers and passengers
of a ground vehicle in the loaded sector come into it at their saved tile, which is the vehicle's, with no occupant or
structure, and a helicopter's take their merc slots with no tile (`25`). A save made in mid-drop holds the mercs still
in the helicopter with the chopper insertion code and no tile: the import seats them in the drop, as the load's
`UpdateMercsInSector` does, and lands them as the Esc skip does (deviation "Helicopter drop in a native save"). A merc
in transit whose arrival sector is the loaded one gets no merc slot, as `UpdateMercInSector` returns for him
(`Strategic/StrategicMap.cc:1023`).

**Process state as in a fresh process.** What the original keeps in unsaved memory, an import sets as a process that has
just started and loaded the file would hold it: the half of the last-known locations the file lacks (§3), the
underground traversal flag, the current squad (the first, before the load's selections), the talk context, the strategic
morale decay counter, Pablo's theft counter, the team change flag of a hit, the visible area and the rooms of the map
loaded last, the bomb queue's setter and its sight check (deviations "Underground traversal flag", "Selection on load",
"Talk context after a load", "Strategic morale decay counter", "Bobby Ray theft counter", "Team change during a hit",
"Visible area of the map loaded last", "Rooms of the map loaded last"; `gPersonToSetOffExplosions`,
`gfExplosionQueueMayHaveChangedSight`, `TileEngine/Explosion_Control.cc:68`). The clock starts unpaused (deviation
"Pause state after an import"); the enemy-sighting pause of an enemy turn is not restored.

**The save's tables win.** A native save keeps the strategic traversability its campaign started with (vanilla's differs
from the shipped JSON on the I2/I3 border, `tools/oracle/README.md` "Strategic movement"), and Stracciatella does not
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
| The load starts every saved animation again at its saved code and runs the script on to the next frame: a breathing soldier saved before his idle check counts it and may roll an idle animation, one readying his rifle in combat pays for it again, and an animation the restart starts skips every check of a new one (`Tactical/Soldier_Control.cc:615`, `:897`, `Tactical/Soldier_Ani.cc:1384`) | `sim/tactical/save-import.test.ts` "runs the script on from the saved code …", "counts the idle check …", "charges a soldier saved readying his rifle …", "holds the saved pending animation …"; `server/save-session.test.ts` "restarts the animations of …" |
| Loading drops every soldier's movement reservation and pending animation | `sim/tactical/save-import.test.ts` |
| Placing a loaded giver drops his pending give but frees nobody: he and his target stay engaged in action, the target out of the AI (`Tactical/Soldier_Add.cc:871`, `TacticalAI/AIMain.cc:91`) | `sim/tactical/save-import.test.ts` "keeps the giver and the target of a give saved under way engaged …" |
| The restart frees the target of a saved give it drops only if the load made that target before the giver: a later one is made from his own save, engaged again (`Tactical/Soldier_Control.cc:1672-1681`, `SaveLoadGame.cc:1404`) | `sim/tactical/save-import.test.ts` "lets the restart drop it from a soldier saved in a moving animation …" |
| An item dropped into a sector while it was unloaded looks for a free tile again at every load | `sim/tactical/save-import.test.ts` |
| So does a corpse, which then faces the first direction its structure fits, counting from north | `sim/tactical/save-import.test.ts`, `sim/campaign/sector-diff.test.ts`, `sim/tactical/corpse-placement.test.ts` |
| A corpse with no free tile within five tiles is lost: the wider retry searches around the `NOWHERE` the first search left (`Tactical/Tactical_Save.cc:650-652`) | `sim/tactical/corpse-placement.test.ts` |
| A load stands a landed helicopter before the saved soldiers enter the map, so its bump moves nobody, and before the saved map changes, so a piece destroyed before the save stays off the map | `sim/campaign/sector-flow.test.ts` "bumps nobody when a native import …", "keeps a helicopter piece destroyed before the save …" |
| A loaded creature pool is redrawn as human blood: its type lives in the smell byte, which the load sets after the redraw | `sim/tactical/blood-pools.test.ts` |
| `fFirstVisitSinceServerWentDown` is a `BOOLEAN` holding 0, 1 or 2 | `content/formats/savegame-laptop.test.ts` |
| No game logic sets an object's `ubMission`, and no item or placement of the original maps has one: only a saved object can carry it, which rides with the object and makes the map screen's trash can ask its second question (`Strategic/MapScreen.cc:5856`) | `sim/tactical/save-import.test.ts` "keeps the ubMission of a saved object …", `ui/screens/map/map-inventory.test.ts` "asks the second trash question …" |
| A temp file is read by its count, the bytes past it unread: B11's item file in `SaveGame07`, `09` and `10` counts no record ahead of a live slot (`Tactical/Tactical_Save.cc:217`) | `content/formats/savegame.test.ts` "reads only the counted item records …", "reads nothing from B11's item file in SaveGame07 …", `sim/campaign/save-sectors.test.ts` "enters B11 of SaveGame09 with no item …" |
| A damage record lands on the first structure of its tile with the saved type bit, wall orientation and level class, which can be a piece of another structure listed first: the next save rescans base tiles only and loses the damage (`Structure.cc:1853`, `SaveLoadMap.cc:344`) | `sim/tactical/native-temp-files.test.ts` "lets a damage record land on the piece of another structure …" |
| The load spreads the saved smoke before the soldiers enter the map: a soldier saved ungassed on a smoke tile enters gassed, and nobody takes gas damage (`SaveLoadGame.cc:1016`, `:1036`; `Soldier_Control.cc:2066`) | `sim/tactical/save-import.test.ts` "restores the clouds in their slots …" |
| A queued bomb is named by its world bomb slot, and the load lists the bombs again in item order without gaps: an entry can set off another bomb than the one it was queued for (`TileEngine/Explosion_Control.cc:1955`, `Tactical/Tactical_Save.cc:571`) | `sim/tactical/save-import.test.ts` "sets off the bomb the rebuilt list holds at a saved index …" |
| A queue saved running runs on at once, but ends at its last bomb without waiting for the blasts in flight: who set it off is not saved (`TileEngine/Explosion_Control.cc:2017`) | `sim/tactical/save-import.test.ts` "runs a queue saved running …" |
| The load zeroes the busy count, explosions in flight or not (`SaveLoadGame.cc:1100`, `:1179`) | `sim/tactical/save-import.test.ts` "zeroes the saved busy count …" |
| A loaded thrown knife takes its status from what its thrower holds at the load, not its own: `HandleBulletSpecialFlags` reads the hand again (`Tactical/Bullets.cc:102`) | `sim/tactical/save-import.test.ts` "gives a loaded thrown knife the status of what its thrower holds now …" |
| A bullet saved stopped stays in its slot for good: the miss animation that would end it is not saved (`Tactical/Bullets.cc:405`) | `sim/tactical/save-import.test.ts` "keeps a bullet saved stopped in its slot for good …" |
| A loaded object has no level node, so its first move looks at the catch again on the tile it was saved on, measured from there, where a drawn object waits for its next tile (`TileEngine/LoadSaveRealObject.cc:40`, `TileEngine/Physics.cc:1097`) | `sim/tactical/save-import.test.ts` "looks at the catch again on the tile an object was saved on …" |
| The civilians' preserved file ends on a sector id that its load reads and never checks, while the enemies' is checked (`Tactical/Enemy_Soldier_Save.cc:255`, `:424`) | `content/formats/savegame-preserved-soldiers.test.ts` "checks the sector id after the records of an enemy file only …" |

Not pinned yet:
- A vanilla save's `uiFlags` holds `LOADING_SAVED_GAME`, set while writing, and two bits Stracciatella no longer defines
  (`TURNBASED`, `TRANSLUCENCY_TYPE`); the import reads only the combat, endgame and sight bits.
- The corpse search fits the gory corpse's structure whatever the blood option (`Tactical/Rotting_Corpses.cc:1070`).

## 4. Verification and what is not checked against the native build

The oracle loads the same files: `tools/oracle/save-probes.ts` writes probes for any saves (soldier dumps, hit chance,
the AI's best shot, sight, paths and lights for every opposed pair), the native build runs them after its `save`
command, and `tools/oracle/compare.ts` rebuilds each from the imported save (`tools/oracle/README.md` "Savegames",
"`save`"), the load's traced draws fed to the restart and each soldier's animation code and frame compared, as the
auto-bandage and helicopter drop comparers compare the codes and frame delays their loads leave ("Auto-bandage",
"Helicopter drop" there); most other comparers start from imported saves too, entering the loaded sector of a save made
on the map screen first (`tools/oracle/tactical-import.ts`). The loaded sector's temp files are probed on saves the
native build writes itself, a tear gas cloud and a hit window; the other sectors' at their first entries after
`SaveGame09` and in the records of every sector of `SaveGame03` (`tools/oracle/README.md` "Savegame temp files"); the
bomb queue and the explosions in flight on saves it writes too, a queue whose slot names another bomb after the load and
explosions in real time and in combat ("Savegame bombs and explosions" there); a bullet saved in flight, flown on frame
by frame after the load into its target, the hit's draws and the target's life and breath in the native frame ("Savegame
bullets and thrown objects" there). With the original data, the subsystems' `save-import` tests import every save in
`SavedGames`, and `src/server/save-session.test.ts` keeps playing each one: a save with a world in tactical, one without
on the map screen while its travelling squad reaches the next sector; the first save with a world is also played again
with its world flag cleared.

Inferred from reading the source:
- The Linux layout has a synthetic test only, and no real file covers versions 100–105: the saves the tests use
  (`SaveGame01`–`03`, `07`–`10`) are vanilla version 99; so has a preserved soldier in the Linux layout. No save
  holds a preserved enemy record, a smoke or light file of a sector not loaded, or a damage or window record there.
- A save made before the first arrival: `SaveGame03` has no world because its squad is between sectors; for the first
  arrival the tests set the start flag, and clear the world flag, of a save made with one.
- The zeroed half of the personal last-known locations: no probe dumps `gsLastKnownOppLoc`, and a load inside a running
  process keeps whatever the previous game left there.
- The dropped reservations, pending animations and pending actions, the engagement a give keeps and the items' new
  tiles: the soldier dump compares none of them, and no shipped save holds a pending action or an engaged soldier.
- The restart's opcodes past the idle check: every soldier of the shipped saves stands, walks, crouches, aims or cowers,
  so the native restarts reach no opcode but code 491; the others are pinned by unit tests
  (`src/sim/tactical/save-import.test.ts`).
- Damage records and light effects of the loaded sector: no probe command makes them (a structure's damage needs an
  explosion's tile animation frames, which no probe runs; nothing lights a flare), so only unit tests pin them
  (`src/sim/tactical/native-temp-files.test.ts`, `src/sim/tactical/save-import.test.ts`). The window probe sees the
  record written back, through the sector flag, not the swap itself: no probe dumps a tile's structures. The smoke
  probe's cloud has no owner (`absmoke`), so the owner by id is pinned by a unit test only.
- An explosion's saved frame and its light: the oracle runs no tile animation, so its saves hold frame 0 and the probe
  prints no light; unit tests pin both (`src/sim/tactical/save-import.test.ts`). No probe follows a loaded explosion to
  its end.
- A thrown object after the load: the oracle writes a save with a grenade in flight, which the import reads, but no
  probe command runs `SimulateWorld` or prints the physics table, so its flight, its missing level node and its end are
  pinned by unit tests only (`src/sim/tactical/save-import.test.ts`). So are a thrown knife's status from the hand, a
  bullet saved stopped and the cursor item: no probe makes them.

Not ported: gaps "Animations on load", "Pending actions on import".
Other deviations of the import: "Ambient sound events", "Blood on the ground",
"Difficulty and progress in tactical", "Corpse structure past its file", "Preserved soldier checksums".
