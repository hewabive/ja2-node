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
| Animation sounds out of sight | Some animation codes play their sample whether or not the player sees the soldier: the throw of a throwing knife as it leaves the hand, three frames before the shot (code 709, `Tactical/Soldier_Ani.cc:2016`), a hit soldier's fall to his knees, to the ground and heavy fall (702, 721, 722: `:1969`, `:2124`, `:2133`), and a dying creature's cry, dissolve and fall (781, 782, 784: `:2485`, `:2490`, `:2495`), each at the soldier's tile | The client plays animation codes for the soldiers in the view only (`audio/director.ts`), and no event tells them of a soldier out of sight, so none of them sounds for one; the knife thrower's `shotFired` plays nothing (`gunshotCue`, `content/audio/cues.ts`) | An event per code for a soldier out of sight, placed by `heard` (`29` §7); none of these samples makes a noise in the original, so how loud the squad hears them needs a rule, as the loudest scream is the rule for a cry |
| No-burn and clipped strips | A soldier in z strips on a no-burn tile is drawn where he is nearer or ties, his shadow too, writing his z on every pixel drawn, and inside a run of opaque pixels his z steps a sublayer at a strip edge, not a row (`TileEngine/RenderWorld.cc:2999-3027`); clipped at the left edge of the view, both strip blitters of soldiers start a sublayer per skipped strip (`:2684`, `:2898`), and clipped at the top the dithered one keeps the parity of the sprite's first row (`:2629`) | On a no-burn tile the strips draw only where he is nearer and the shadow writes no z; every strip is a row from the last and the dither follows the screen pixels, however the sprite is clipped (`render/world/dynamic-scene.ts`) | The no-burn test and writes need only draw states; the sublayer step needs the strips split per row by the sprite's runs, the top parity a dither flag per instance in the shader |
| Talk refusal messages | Talk to a talkable soldier the merc cannot see prints `NO_LOS_TO_TALK_TARGET` with both names for a profile and `STR_LATE_45` with the merc's for anyone else, and to an unconscious one `STR_LATE_21` with the target's name, whatever his team, as UI feedback (`Tactical/Handle_UI.cc:4679`, `:4683`, `:4692`) | `talk` emits `npcMessage` of kind `noLineOfSight` or `targetCollapsed` and refuses (`sim/campaign/talk-flow.ts`), but neither kind is in `NPC_MESSAGES` (`server/message-entries.ts`) nor either token in `REFUSAL_MESSAGES` (`protocol/refusals.ts`): the log shows nothing | Builders for the two kinds; the event then names the merc and the target soldier, not only the profile, for `soldierArg` |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
