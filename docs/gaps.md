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
| Corpse strips | A rotting corpse goes through the strip blitter of a soldier on a no-burn tile (`TileEngine/RenderWorld.cc:1119-1127`, `:1256`): it is drawn where it is nearer or ties, its shadow too, writing its z on every pixel drawn, its z stepping a sublayer at a strip edge inside a run of opaque pixels (`:2999-3027`), and cut by the left edge of the static world's clip rectangle it starts its strips a sublayer per strip counted as cut away (`:2865-2908`) | Its strips draw only where it is nearer, the shadow writes no z, and every strip is a row from the last (`#emitAniTile`, `render/world/dynamic-scene.ts`) | `noBurnStripCells` (`render/world/soldier-strips.ts`) once the corpse's sprite carries its pixels; the left-edge start depends on the clip rectangle that drew the corpse last, the whole view or the strip a scroll uncovered, which the partial redraws do not keep |
| Skill-check curse on the map screen | A merc who fails a skill check while the map screen is up, attaching or merging in its inventory (`Tactical/Items.cc:1555`, `:1681`, `:1697`), curses unless the check is silent (`Tactical/SkillCheck.cc:370-381`), on that screen too (`Tactical/Soldier_Control.cc:6101`) | `skillCheckFailed` is dropped by the off-map context (`DISCARDED_EVENTS`, `src/sim/campaign/off-map-combat.ts`) and, with a sector loaded, reaches only the tactical screen's sound director, which the map screen does not run: no curse | The off-map context's events into the campaign's (as for gaps "Stat changes off the loaded map"), the merc's voice in the event, and `MapSound` playing it as it plays `damageFeedback` |
| Stat changes off the loaded map | A merc of ours whose stat changes on an assignment while no sector is loaded (doctoring, repairing, training, militia training: `Strategic/Assignments.cc:1348`, `:1987`, `:2616`, `:2628`) gets the stat message, or on the quarter roll his experience line after it, as on the tactical map, and the map screen's info panel colours the stat (`Tactical/Campaign.cc:583-632`) | The off-map context drops the events (`DISCARDED_EVENTS`, `src/sim/campaign/off-map-combat.ts`): no `statChanged`, so no message and no colour; the experience line and the message it brings through the dialogue queue (`statChangeAnnounced`) come | The off-map context's events into the campaign's, as the loaded sector's are |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
