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
| Tactical box's world-clock second | A box opened on the tactical screen pauses the game (`MessageBoxScreen.cc:271`), so that frame's `UpdateClock` restarts the world clock's second (`Strategic/Game_Clock.cc:609-613`), and the box screen restarts it at every frame it stays up (`:602-607`): the part of a world second run before the box is lost, up to 999 ms of play per box at X1 | A tactical prompt, and a campaign box opened in a tactical step, leave the second running: `updateClock` counts the step the box opens in, and the steps after the answer go on from it (`campaign/campaign-sim.ts`) | Restarting the second in the step a box opens in, as `updateClock` does under a pause (`strategic/time/world-clock.ts`); every world second after the box then comes as late as in the original |

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
| Corpse strips | A rotting corpse goes through the strip blitter of a soldier on a no-burn tile (`TileEngine/RenderWorld.cc:1119-1127`, `:1256`): it is drawn where it is nearer or ties, its shadow too, writing its z on every pixel drawn, its z stepping a sublayer at a strip edge inside a run of opaque pixels (`:2999-3027`), and cut by the left edge of the static world's clip rectangle it starts its strips a sublayer per strip counted as cut away (`:2865-2908`) | Its strips draw only where it is nearer, the shadow writes no z, and every strip is a row from the last (`#emitAniTile`, `render/world/dynamic-scene.ts`) | `noBurnStripCells` (`render/world/soldier-strips.ts`) once the corpse's sprite carries its pixels; the left-edge start depends on the clip rectangle that drew the corpse last, the whole view or the strip a scroll uncovered, which the partial redraws do not keep |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
