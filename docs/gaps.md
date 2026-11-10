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

The loaded sector: doors, sight, walking, combat, items, explosions, the AI and NPCs on the map. Paths are under
`src/sim/tactical/`.

| Area | Original | ja2-node | Notes |
|---|---|---|---|
| Exit grids in unrevealed rooms | The exit grid cursor shows only over a tile outside rooms or revealed (`Tactical/Handle_UI.cc:838-839`); over an exit grid in a room no merc has seen into the tile keeps the move cursor and a click there is a move, so no merc can take it yet | The client's exit grid cursor and `exitSector {exitGrid}` take any exit grid (`src/ui/screens/tactical/input/tactical-input.ts`, `src/sim/campaign/sector-exits.ts`); the `sectorExits` query already hides such grids (`src/sim/hints/shown-map.ts`) | The check before the client's exit grid cursor and in `exitSector`'s exit grid case; the stub A10's stairs in its room show it (`src/server/sector-exits-stub.test.ts`) |

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

What the client does not show or play yet, where nothing changes an outcome: none known. Paths are under `src/`.

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
