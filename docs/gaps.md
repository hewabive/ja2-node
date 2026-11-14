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
| First aid refusal messages | A medkit click on a vehicle or the robot prints `CANNOT_DO_FIRST_AID_STR`, by a medic without medical skill `MSG_MERC_HAS_NO_MEDSKILL` with the medic's name, on a patient hurt but not bleeding `STR_LATE_19` and on one neither bleeding nor below OKLIFE `CANNOT_NO_NEED_FIRST_AID_STR`, as UI feedback with the patient's name, whatever his team (`Tactical/Handle_UI.cc:3534`, `:3540`, `:3546`, `:3552`) | `firstAid` refuses with `mechanical`, `noMedicalSkill`, `notBleeding` and `noNeed` (`sim/tactical/first-aid.ts`), none of them in `REFUSAL_MESSAGES` (`protocol/refusals.ts`), and the client's attack-location check stops only a click on nobody (`ui/screens/tactical/input/tactical-input.ts`): the log shows nothing | Their entries in `REFUSAL_MESSAGES` and the names in `refusalArgs` (`server/message-entries.ts`), the patient's through `soldierArg` once the refusal's data names him |
| Hit stat messages | A critical hit that costs its target wisdom, dexterity, strength or agility prints `STR_LOSES_1_*` or `STR_LOSES_*` with his name and the points while he is visible, and a head hit that costs none, not a pellet's, `STR_HEAD_HIT`, for a soldier of any team (`Tactical/Weapons.cc:2982-3110`) | `sim/tactical/combat/impact.ts` takes the stats and adds the stat damage with no event, so the message list prints none of them (`server/message-entries.ts`) | An event of the loss (soldier, stat, points) and of the head hit, cut to what the squad sees as the other events naming a soldier are (`29` §7), and builders naming him with `soldierArg`; the red stat on our panel is the client's (`uiChangeWisdomTime` and the like) |
| Leg hit fall message | A leg hit that knocks a standing soldier of any team over prints `STR_LATE_20` with his name (`Tactical/Soldier_Control.cc:3185-3196`) | `sim/tactical/combat/hit.ts` collapses him (`fallenOver`) with no event, so the message list prints nothing | An event like `fellDown`, under `shownInSector`, and its builder naming him with `soldierArg` |
| Talk refusal messages | Talk to a talkable soldier the merc cannot see prints `NO_LOS_TO_TALK_TARGET` with both names for a profile and `STR_LATE_45` with the merc's for anyone else, and to an unconscious one `STR_LATE_21` with the target's name, whatever his team, as UI feedback (`Tactical/Handle_UI.cc:4679`, `:4683`, `:4692`) | `talk` emits `npcMessage` of kind `noLineOfSight` or `targetCollapsed` and refuses (`sim/campaign/talk-flow.ts`), but neither kind is in `NPC_MESSAGES` (`server/message-entries.ts`) nor either token in `REFUSAL_MESSAGES` (`protocol/refusals.ts`): the log shows nothing | Builders for the two kinds; the event then names the merc and the target soldier, not only the profile, for `soldierArg` |

## 7. Code conventions

Code that does not follow `CLAUDE.md` yet: none known. A row gives the rule, the code that breaks it and what following
it takes.
