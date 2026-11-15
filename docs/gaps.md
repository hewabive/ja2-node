# Gaps: behaviour not ported yet

Every place where ja2-node does not yet do what JA2 Stracciatella with default settings does (the behaviour reference,
`01` D1), or does only part of it. A row gives the original's behaviour with a `file:line` link, what ja2-node does for
now, and what closing the gap depends on or changes. A closed gap leaves this file; a difference kept on purpose moves
to `deviations.md` with its reason. Other docs cite rows by their *Area* name (`gaps "Area"`); names are unique across
both files. Section 7 lists code that does not follow `CLAUDE.md` yet.

Original links are under `reference/stracciatella/src/game/`, or under `reference/stracciatella/` when they start with
`src/` or `rust/`. ja2-node paths are under the directory their section names, or from the repository root when they
start with `src/`, `data/` or `tools/`.

## 1. Tactical rules and AI

The loaded sector: doors, sight, walking, combat, items, explosions, the AI and NPCs on the map: none known. Paths are
under `src/sim/tactical/`.

## 2. Strategic layer

The map, travel, vehicles, time compression, the economy, sector state and autoresolve. Paths are under `src/sim/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Militia list failure before the payment box | With the leader's sector paid the list is set at once (`Strategic/Assignments.cc:4767-4775`), its boxes opening in list order and a box opened while one is up dropped (`MessageBoxScreen.cc:97`): a merc who cannot train, listed before the first merc set in an unpaid sector, opens `pMapErrorString` 18 and prints line 48 (`Strategic/Assignments.cc:6381-6398`), so the payment or cannot-afford box of that merc is dropped (`:5978-5990`, `Strategic/Town_Militia.cc:422-465`): he trains in his sector unpaid, and `pMilitiaTrainerSoldier` stays set, which keeps `SetSoldierAssignmentTrainTown` from asking again until a payment or continue box is answered (`Strategic/Town_Militia.cc:564`, `:603`). Listed after him, the failing merc only prints line 48 while the payment box waits | `assignTrainers` (`strategic/economy/set-assignment.ts`) asks for the payment of the first merc set in an unpaid sector whatever the order; a failing merc answers `notEligible`, which the map page reports only once the payment is settled (`listAssigned`, `src/ui/screens/map/assignment-menus.ts`): no box and no line while the prompt is open, lines 18 and 48 after a yes (`trainersNotAssigned`), as the original prints them then | A decision first: the original's order needs `assign` to skip the payment prompt behind a failure listed before it, giving a session away unpaid (a quirk to pin), where a deviation keeps the prompt; line 48 while the prompt is open is the page's either way |
| Client screens' world-clock second | The options, save/load and help screens, the door menu, the sector exit dialog, the San Mona screen and a box only a page shows pause the game or are screens of their own (`Options_Screen.cc:169`, `SaveLoadScreen.cc:209`, `HelpScreen.cc:472`, `Tactical/Interface.cc:1273`, `Tactical/Strategic_Exit_GUI.cc:374`, `JAScreens.cc:418`, `MessageBoxScreen.cc:271`), and so does the map screen while a menu, a plotted path or the update box keeps time from compressing (`Strategic/MapScreen.cc:5413-5425`, `Strategic/Map_Screen_Interface_Bottom.cc:732`): `UpdateClock` restarts the world clock's second at every frame they are up (`Strategic/Game_Clock.cc:602-613`), so the part of a second, or of a compressed real second, run before them is lost | A page holds time while it shows one (`Session.holdTime`, `src/server/session.ts`): real-time batches run no ticks and the simulation never hears of the hold, so the second goes on from where it stood once the hold ends. The San Mona screen's jump runs at the action (`sexScene`), which leaves the second as it stood when the brothel's action item starts it outside a conversation's pause (`tactical/narrative/quest-items.ts`) | A decision first: a hold is viewer state the input log does not record (`04` §4.3), so restarting the second needs the hold to reach the simulation as a logged input, as the decisions the simulation stands for restart it (`15` §2); the San Mona screen, which the simulation starts itself, needs only a restart after its step's `updateClock` |

## 3. Campaign, laptop and narrative

NPC records, merc lines, the dialogue queue and quest scripting: none known. Paths are under `src/sim/`.

## 4. Agent API

Commands the API does not have yet, and what its hints do not read: none known. Paths are under `src/sim/`.

## 5. Savegame import

What a native savegame import leaves out: none known. Paths are under `src/`.

## 6. Presentation: screens, graphics, text, sound and video

What the client does not show or play yet, where nothing changes an outcome. Paths are under `src/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Corpse strips | A scroll step draws the strip it uncovers through the static world's clip rectangle narrowed to that strip, corpses with it (`src/sgp/Video.cc:427`, `TileEngine/RenderWorld.cc:3443-3446`), until the whole redraw that ends the scroll (`:2100`): a rotting corpse cut by the strip's left edge starts its strips a sublayer per strip counted as cut away from that edge (`:2865-2908`), not from the view's | Strips are cut by the view's left edge only (`spriteSkip`, `render/world/soldier-strips.ts`), as a whole frame cuts them, the uncovered strip of a partial redraw included | A decision first: the start depends on the strip the last scroll step uncovered, frame history the partial redraws do not keep, as a partial redraw must equal a whole one (`05`); a soldier in z strips, drawn into the strip with the dynamics (`TileEngine/RenderWorld.cc:1731-1743`), takes the same start, and on the dither the strip's top for its parity, so one rule settles both |
| Wreck draw pass | A vehicle's wreck is the one corpse left unpaused (`Tactical/Rotting_Corpses.cc:506-510`): its first animation step makes its node dynamic for good (`TileEngine/Tile_Animation.cc:267-275`, `:445-468`), so from then on the dynamic pass draws it in the structure layer of its row, after the mercs of that row and before those of later rows (`TileEngine/RenderWorld.cc:485-499`, `:1847-1852`), not with the static world before every merc | A wreck goes out with the other corpses in the pass ahead of the dynamic rows (`PAUSED_ANI_KINDS`, `render/world/dynamic-scene.ts`), so a soldier behind it in an earlier row is dithered through it where the original draws the wreck over him | The wreck's place among the animation tiles of its tile's structure layer (`#emitLayer`); its first 150 ms, before the first step, it is still drawn with the static world |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
