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

The map, travel, vehicles, time compression, the economy, sector state and autoresolve: none known. Paths are under
`src/sim/`.

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
| Wreck draw pass | From `AddRottingCorpse` (the vehicle's destruction, a sector entry, a load) to its first animation step, the first overhead pass more than 150 ms on, a wreck's node is not `LEVELNODE_DYNAMIC` yet, as no paused corpse's ever is, so the static world draws it before every merc (`Tactical/Rotting_Corpses.cc:467-469`, `TileEngine/Tile_Animation.cc:121`, `:267-275`, `TileEngine/RenderWorld.cc:487-499`) | A wreck is drawn in the structure layer of its row from the first frame that shows it (`PAUSED_ANI_KINDS`, `render/world/dynamic-scene.ts`) | The view does not say when a corpse was added: the client would need the time it first showed one (frame history) or a stamp in `CorpseView` (a view change). From the step on, the original's saved background also keeps the copy the static world drew until the next whole redraw (`TileEngine/RenderWorld.cc:1612-1633`), frame history that whole frames do not keep (deviation "Scroll frames") |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
