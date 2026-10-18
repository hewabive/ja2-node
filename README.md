# ja2-node

A non-commercial reimplementation of Jagged Alliance 2 in TypeScript. The game state lives on a
server (Node), the browser is a client, and agents play through an API. The goal is the
original's behaviour (mechanics, formulas, order of checks), not a line-by-line port of its code.

**Status:** milestone M2 "Soldier and time": a tactical sandbox (Omerta on the original data, a stub
village otherwise) where mercs walk, run and hop fences along the original's paths, the garrison and the
civilians behave as in green alert, everyone sees and hears everyone, and the first hostile sighting stops
the sector at the combat boundary. An agent can play it through MCP. Turn-based combat comes next (M3).

Documents in [`docs/`](docs/): scope and license (`00`), architecture (`01`), mechanics catalog
(`02`), how logic is tied to animation (`03`), time, server and agent API (`04`), the original's
static render pipeline (`05`), soldiers and animation (`06`), structures, pathing and walking (`07`),
sight and noise (`08`), green-alert AI (`09`) and the deviation log.

## License and data

- The code is distributed under the **SFI-SCLA** ([`LICENSE`](LICENSE)): non-commercial use only.
  Files ported from the original's logic carry a header with the date of the change.
- **The original game data is not here and never will be.** You need your own copy of Jagged
  Alliance 2 (GOG, Steam). Without it the stub pack works: the project's own original assets.

## Quick start

Requires Node 24 and pnpm 11.

```sh
pnpm install
pnpm stubs                         # build the stub pack into dist/stubs
export JA2_DATA_DIR="/path/to/Jagged Alliance 2 Gold/Data"   # optional
pnpm dev                           # server (7420) + Vite (5173)
```

Open http://127.0.0.1:5173/ → "Strategic map", "Tactical sandbox", "Asset browser" or "Map viewer". The strategic
map starts a new campaign (the squad lands in A9 at 07:00 on day 1, or "hire in laptop" keeps it in the laptop), plots
routes, runs the world clock, extends or ends contracts, releases escorts, answers battle and contract prompts, shows the
quest log, flies
Skyrider's helicopter once it is available and opens the laptop (mail, A.I.M., M.E.R.C., I.M.P., Bobby Ray, insurance,
records); its "tactical view" link opens the loaded sector of that
campaign, where "trade" opens the shop of the nearest visible merchant and "talk" starts a conversation with the nearest
visible named NPC (its lines, the approaches: friendly, direct, threaten, recruit, buy/sell…, the NPC's yes/no questions
and giving items from the talker's inventory; an unnamed civilian answers with a quote; stub dealers and the stub NPCs
stand in A10, east of A9); prompts such as the enemy's surrender offer are answered on the page. In the
sandbox click a merc to select it, click a tile to walk there, right-click to run, ctrl+click a door to walk there and
open it (a locked door shows its menu: keys, lock picking, forcing, examining, untrapping…); the time buttons switch
between paused, real time and instant (every order runs to the end on the server, the page plays it back at the
chosen playback speed or skips it). Without `JA2_DATA_DIR` only the stubs (`stubs/…`, including the stub
village map) are visible.

Agents connect to `http://127.0.0.1:7420/mcp` with `Authorization: Bearer <.ja2/token>` and use the
tools `status`, `observe`, `act` (`{"type":"move","soldier":0,"to":12880,"mode":"run"}`, `turn`,
`stance`, `stop`, `attack`, `estimateAttack`, `endTurn`) and `advance` (`{"idle":true}` or `{"ticks":n}`,
5 ms per tick). A hostile sighting starts turn-based combat: every action then costs AP, `attack` fires the
gun in hand at a gridNo (`aimTime` 0–4, `bodyPart`), and `endTurn` hands the turn to the enemy.
`newSession` starts a separate game: the sandbox, or with `{"save":"SaveGame07"}` the tactical situation of a
native savegame from the game's `SavedGames` folder (needs `JA2_DATA_DIR`; `JA2_SAVES_DIR` overrides the folder).
`{"campaign":{"options":{"difficulty":2}}}` starts a new campaign with its game options (`difficulty`, `sciFi`, `gunNut`,
`saveMode`, `bloodAndGore`; shown by `status`, and `setOption {"bloodAndGore":false}` changes the last one; strategic commands `route`, `cancelRoute`, `assignSquad`,
`assign`, `sleep`, `wake`, `enterSector`, `exitSector`, `mapScreen`, `tacticalScreen`, `compressTime`, `stopTime`, and
contracts `extendContract`, `contractOptions`, `dismiss`, `removeMerc`, merchants `openShop`, `quoteTrade`, `trade`,
`closeShop`, and `answer` for the pre-battle, autoresolve and contract prompts; `observe` then includes the clock, the
strategic view with contracts and morale, the open prompt, the autoresolve battle and the open shop; `advance` takes `worldTime`, `worldSeconds`, `compressionStopped` and `mode` on the map). `JA2_SAVE=SaveGame07 pnpm dev` opens the default session from that save, `JA2_CAMPAIGN=2 pnpm dev`
a new campaign. The squad is hired through the laptop (`"hire":[]` keeps the new campaign in it); `openLaptop` opens it
on the map screen for `aimHire`, `mercHire`, `impCreate`, `bobbyRayOrder`, `insure`, mail and the other laptop commands.
Sessions share the server process and take turns in 10 ms slices, so one agent's long enemy turn does not hold up the
others; `JA2_SESSION_HOST=worker` runs every session in its own worker thread instead (more memory and a content load
per session, but several cores and no stall from another session's saves; `docs/04` §5.9).

Saving and loading: the tools `save` (`{"session":"…","description":"before the bridge"}`, `{"name":"quick"}` for the
quick save), `load` (`{"name":"QuickSave"}` into a new session, or with `"session"` in place; it reseeds the main random
stream as the original does in effect, `"reseed":false` loads exactly), `listSaves` (ja2-node saves and the native
savegames, newest first) and `deleteSave` write and read `.ja2/saves/<name>.j2s` (`JA2_SAVE_DIR` moves the folder;
clients only ever pass names). The server autosaves into `Auto01`/`Auto02` when a turn ends in combat; campaigns take
`"options":{"saveMode":"ironMan"}` or `"deadIsDead"`. Each save carries the session's input log, and `pnpm cli replay <name>`
re-runs it and checks that it reproduces the save byte for byte (`docs/04` §6.22).

Text follows the data: the server detects the data version (English, or the language folders of a localized release;
`JA2_DATA_VERSION=russianGold` and the other version names override it, and Russian Gold must be named) and decodes the
dialogue, item and laptop text accordingly. UI labels come from Stracciatella's string tables in a display language of
their own: `JA2_LANG=rus` (or `eng`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`; default: the data's language) for the server,
`newSession {"language":"rus"}` per session, `GET /api/strings?lang=rus` for the tables.

The tactical and strategic pages play sound and the original's music mode, which the server derives from the game and
sends to every client (`docs/04` §6.23). Without the original data the stub pack stands in for it, including synthesized sounds, music and speech blips and
invented merc, item, credit and mail text under the original file names (`GET /vfs/sounds/door open 01.wav` works on
both; `docs/27` §6.5). Every sector loads a stub map by kind (`stubs/maps/sector-kinds.json`: towns with a dealer and a
jail, mine entrances with their head miner and a shaft, caves below, army camps at the SAM sites and garrisons, the
Drassen airfield where Skyrider's helicopter is set up), twelve invented A.I.M. mercs, Skyrider, the head miners and a
dealer per town stand in for the original characters, and two bitmap fonts subset from Terminus Font (SIL OFL 1.1,
`stubs/font/NOTICE.txt`) cover Latin and Cyrillic (`docs/27` §6.6). The video page (`/src/devtools/video/`) plays the intro and ending videos of the original data
(or the stub splash) and the credits (`docs/27` §4.5).

The server listens on `127.0.0.1` only and requires the token from `.ja2/token`, which it creates
itself. The Vite proxy adds the token, so it never appears in page code.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Server and Vite together; rebuilds the stub pack first |
| `pnpm server` / `pnpm web` | Separately |
| `pnpm check` | Biome, types (`tsc -b`), layer boundaries, unit tests |
| `pnpm e2e` | Playwright on the stubs (own ports 7431/5183) |
| `pnpm build` | Client build into `dist/client` |
| `pnpm stubs` | Stub pack |
| `pnpm cli inspect vfs` | VFS layers and per-file-type statistics |
| `pnpm cli inspect ls <prefix>` | File list |
| `pnpm cli inspect sti <path> --png <dir>` | Describe an STI, dump frames to PNG |
| `pnpm cli inspect verify` | Decode every STI, PCX, TGA, JSD and map and report errors |
| `pnpm cli inspect map <path>` / `tilesets` | Describe a map, list tilesets |
| `pnpm cli inspect slf <file>` / `cat <path> --out <file>` | Archive directory, file extraction |
| `pnpm cli inspect save <file.sav>` | Summarise a native savegame: sector, time, combat state, soldiers |
| `pnpm cli bench <scenario\|all>` | Benchmarks (enemy turn, real time, strategic, autoresolve, server, campaign, save): one JSON line per variant, `--profile`, `--calls`; see `docs/27` §7 |
| `pnpm cli replay <name>` | Re-run the input log of a ja2-node save from its origin and compare the result with the save |

The original-data test runs only when `JA2_DATA_DIR` is set.

## Layout

Layers (details in `docs/01-architecture.md`, §2):

| Layer | Runs in | Depends on |
|---|---|---|
| `src/core`: RNG, C integer semantics | everywhere, no DOM or Node | — |
| `src/content`: VFS, formats (SLF, STI, PNG), picture model | everywhere, no DOM or Node | core |
| `src/node`: VFS over the disk, token | Node | core, content |
| `src/sim`: deterministic tactical simulation (soldiers, pathing, AI, sight) | everywhere, no DOM or Node | core, content |
| `src/protocol`: view frames and messages | everywhere | core, content, sim |
| `src/server`: HTTP, WebSocket sessions, MCP, the sandbox | Node | core, content, sim, protocol, node |
| `src/render`: WebGL2 R8UI atlases, palette texture, sprites | browser | core, content |
| `src/devtools`: asset browser, map viewer, tactical page | browser | core, content, protocol, render |
| `stubs/`: stub pack generator | Node | core, content, node |
| `tools/`: CLI, dev runner, import checker | Node | everything except browser code |

Boundaries are enforced three ways:
- project references in `tsconfig`;
- `lib` and `types` settings: no DOM and no `@types/node` in shared layers;
- `tools/check-imports.ts`: allowed layers and packages per layer, plus a ban on
  nondeterminism (`Math.random`, `Date`, timers) in `core`, `content` and `sim`.

Node runs TypeScript without a build step (type stripping), so the code uses no `enum` or
`namespace`, and relative imports carry the `.ts` extension.
