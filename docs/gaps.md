# Gaps: behaviour not ported yet

Every place where ja2-node does not yet do what JA2 Stracciatella with default settings does (the behaviour reference,
`01` D1), or does only part of it. A row gives the original's behaviour with a `file:line` link, what ja2-node does for
now, and what closing the gap depends on or changes. A closed gap leaves this file; a difference kept on purpose moves
to `deviations.md` with its reason, or to `original-bugs.md` when the original's outcome is a bug. Other docs cite rows
by their *Area* name (`gaps "Area"`); names are unique across the three files. Section 7 lists code that does not follow `CLAUDE.md` yet.

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
| San Mona screen's world-clock second | The San Mona screen the brothel's floor trigger starts outside a conversation is a screen of its own (`JAScreens.cc:418`), so `UpdateClock` restarts the world clock's second at every frame it plays (`Strategic/Game_Clock.cc:602-607`) | The jump runs at the action (`sexScene`), which leaves the second as it stood (`tactical/narrative/quest-items.ts`) | A restart after the step's `updateClock` (`restartClockSecond`, `strategic/time/world-clock.ts`), as for the decisions the simulation stands for (`15` §2) |

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
| Wreck draw pass | A vehicle's wreck is the one corpse left unpaused (`Tactical/Rotting_Corpses.cc:506-510`): its first animation step makes its node dynamic for good (`TileEngine/Tile_Animation.cc:267-275`, `:445-468`), so from then on the dynamic pass draws it in the structure layer of its row, after the mercs of that row and before those of later rows (`TileEngine/RenderWorld.cc:485-499`, `:1847-1852`), not with the static world before every merc | A wreck goes out with the other corpses in the pass ahead of the dynamic rows (`PAUSED_ANI_KINDS`, `render/world/dynamic-scene.ts`), so a soldier behind it in an earlier row is dithered through it where the original draws the wreck over him | The wreck's place among the animation tiles of its tile's structure layer (`#emitLayer`); its first 150 ms, before the first step, it is still drawn with the static world |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
