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
| Tactical placement | "Go to sector" from the persistent PBI of our group, out of an ambush or a creature or bloodcat attack, opens the placement GUI as the map loads (`Strategic/PreBattle_Interface.cc:1007-1013`, `Strategic/StrategicMap.cc:892-896`): every merc of the sector waits on his side of the overhead map, none placed under the default Clear (`TileEngine/Tactical_Placement_GUI.cc:72`, `:572-590`), until the player puts each on an edge point of his side or Spread or Group does, and Done prepares the loaded sector (`:491-540`) | The same condition passes `autoPlacement`, which puts each merc on a random edge point of his side, Spread's choice, and the battle starts at once (`campaign/battle-flow.ts`, `#chooseRandomEdgepoints` in `campaign/sector-flow.ts`); it does not turn the edge-index insertion codes into sides (`TileEngine/Tactical_Placement_GUI.cc:167-175`) or check for the dead, captured and in-transit mercs the GUI leaves out (`:150-175`), and the saved default button is parsed but unused | A placement decision prompt that holds the load before `prepareLoadedSector`, the flag kept for the next load when the sector is loaded already (`Strategic/StrategicMap.cc:438-466`); commands to put a merc on an edge point and for Spread, Group, Clear and Done; the prompt in the view with each side's edge points; the client's panel over the overhead map (`29`, `30`) |

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
| Dithered strip pixels | A soldier drawn in z strips writes his z on the dithered pixels too, and dithers his shadow pixels with his body (`TileEngine/RenderWorld.cc:2785-2792`) | The dithered pass writes no depth, and only the nearer pass draws the shadow (`render/world/dynamic-scene.ts`) | A depth-writing dithered state for the strip parts; what it changes shows only where later draws of the same frame meet those pixels |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
