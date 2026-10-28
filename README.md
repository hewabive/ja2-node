# ja2-node

A non-commercial reimplementation of Jagged Alliance 2 in TypeScript. The game state lives on a server (Node), the
browser is a client, and agents play through an API. The goal is the original's behaviour (mechanics, formulas, order
of checks), not a line-by-line port of its code; the behaviour reference is JA2 Stracciatella with default settings.

A whole campaign runs on the server, from the laptop and the first landing to the Queen's death and the ending, on the
original data or on the project's own stub pack: tactical real time and turn-based combat, the strategic map with the
Queen's army, towns, mines and militia, the laptop, contracts, merchants, NPCs, quests and meanwhile scenes, with saves,
game options, sound, music, the videos and every UI language of Stracciatella's string tables. People play it in the
browser on a canvas page with the original's screens; agents play it through MCP. Release notes:
[`docs/releases.md`](docs/releases.md).

Documentation is in [`docs/`](docs/); [`docs/01-architecture.md`](docs/01-architecture.md) §10 lists every document
with its scope. Conventions for contributors: [`CLAUDE.md`](CLAUDE.md).

## License and data

- The code is distributed under the **SFI-SCLA** ([`LICENSE`](LICENSE)): non-commercial use only. Files derived from the
  original's logic carry a header with the date of the change.
- **The stub pack's content** (the hand-made maps, texts and profiles in `stubs/` and the pictures, sounds, music and
  video that `pnpm stubs` generates) is dedicated to the public domain under **CC0 1.0**
  ([`stubs/LICENSE.txt`](stubs/LICENSE.txt)). [`stubs/NOTICE.txt`](stubs/NOTICE.txt) lists what it covers: the code that
  builds the pack and the few files that tie it to the game stay under SFI-SCLA, the Stub Pixel fonts under SIL OFL 1.1.
- **The original game data is not here and never will be**, nor anything derived from it. You need your own copy of
  Jagged Alliance 2 (GOG, Steam). Without it the stub pack works: the project's own original assets.
- What may enter the repository and why: [`docs/01-architecture.md`](docs/01-architecture.md) §0.

## Quick start

Requires Node 24 and pnpm 11.

```sh
pnpm install
pnpm stubs                         # build the stub pack into dist/stubs
export JA2_DATA_DIR="/path/to/Jagged Alliance 2 Gold/Data"   # optional
pnpm dev                           # server (7420) + Vite (5173)
```

## How to play

1. Start the server and the client: `pnpm dev` (with `JA2_DATA_DIR` set for the original data, without it on the stub
   pack). For a built client run `pnpm build` once, then `pnpm server`, and open the `login?token=…` link the server
   prints (it sets the token cookie).
2. Open the launcher at http://127.0.0.1:5173/. It shows the data source, the data version and the display language,
   and starts with "Click to start": browsers block sound until the page gets a click or a key, so the splash waits for
   one (once per browser tab; the "play the splash" setting turns it off).
3. **Play** opens the game page `/play`: the original's main menu, game init, options and save/load screens, the
   laptop, the map screen, the tactical screen with its panels, the shop, talk, battle entry and story screens, drawn on
   a canvas at a whole-number UI scale. `/play?session=<id>` joins a running session; `?scale=2` forces a scale and
   `?fixed640=1` keeps a 640×480 frame (both are client settings too).
4. **New campaign** in the launcher: the game init screen's options with the original's defaults preselected (easy,
   sci-fi, reduced guns, save anywhere, blood on), the Dead is Dead save name, the default squad (optionally of a chosen
   size) or hiring in the laptop. The beginning intro plays (Escape ends it, Space or a click skips a video; the "play
   the intro" setting turns it off).
5. **Saved games**: ja2-node saves and the native savegames of the game's `SavedGames` folder, newest first, with the
   original's row fields (day and time, sector, mercs, balance, description, a mark for Dead is Dead) and the options in
   the tooltip. Load into a new session or a running one, import a native save, save the chosen session as a new save
   or over the selected one, delete, download a `.j2s` file and upload one.
6. **Settings**: volumes, mute, speech and subtitles, mute confirmations, the sleep/wake notification, playback speed,
   the splash and intro switches, the display language, and export or import of the settings as a file. They live in
   the browser and never reach the game.
7. In the game pages Alt+S quick saves and Alt+L quick loads.

## Developer pages, agents and the API

**Developer pages**, linked from the launcher: the tactical sandbox (click a merc to select it, click a tile to walk,
right-click to run, ctrl+click a door to open it or get its menu; paused, real-time and instant time buttons; trading
and talking with the nearest merchant or NPC), the strategic map (a new campaign, routes, the clock, contracts, battle
and contract prompts, the quest log, the helicopter, the laptop), the asset browser, the map viewer, video and credits,
the widget gallery and the laptop on a new campaign. Stub dealers and NPCs stand in A10, east of A9.

**Agents** connect to `http://127.0.0.1:7420/mcp` with `Authorization: Bearer <.ja2/token>` and use nine tools:
`status`, `observe`, `act`, `advance`, `newSession`, `save`, `load`, `listSaves` and `deleteSave`. For example
`act {"type":"move","soldier":0,"to":12880,"mode":"run"}` orders a move, and `advance {"idle":true}` (or
`{"ticks":n}`, 5 ms per tick) runs time until the orders are done or a decision is due. A hostile sighting starts
turn-based combat: actions then cost AP, `attack` fires at a gridNo, `endTurn` hands the turn over. `newSession`
starts the sandbox, `{"save":"SaveGame07"}` the tactical situation of a native savegame (needs `JA2_DATA_DIR`), or
`{"campaign":{"options":{"difficulty":2}}}` a new campaign; queries (`estimateAttack`, `inventory`, `quoteTrade`, …)
and prompt answers (`answer`) are `act` commands too. Every command with its fields and refusals is in the tool
descriptions of [`src/server/mcp.ts`](src/server/mcp.ts) and in [`docs/04-time-and-server.md`](docs/04-time-and-server.md)
§6.

Sessions share the server process and take turns in 10 ms slices, so one agent's long enemy turn does not hold up the
others; `JA2_SESSION_HOST=worker` runs every session in its own worker thread instead (more memory and a content load
per session, but several cores). `save`, `load` and the launcher write and read `.ja2/saves/<name>.j2s`; the server
autosaves into `Auto01`/`Auto02` when a turn ends in combat; a player load reseeds the main random stream as the
original does in effect (`"reseed":false` loads exactly). Each save carries the session's input log, and
`pnpm cli replay <name>` re-runs it and checks that it reproduces the save byte for byte.

Text follows the data: the server detects the data version (English or a localized release) and decodes the dialogue,
item and laptop text accordingly. UI labels come from Stracciatella's string tables in a display language of their own
(`JA2_LANG`, `newSession {"language":"rus"}` per session, `GET /api/strings?lang=rus`). Without the original data the
stub pack stands in for it: synthesized sounds, music and speech blips, invented mercs and text under the original file
names, a stub map for every sector by kind, and two bitmap fonts subset from Terminus Font.

The server listens on `127.0.0.1` only and requires the token from `.ja2/token`, which it creates itself. The Vite proxy
adds the token, so it never appears in page code.

## Commands and environment

| Command | What it does |
|---|---|
| `pnpm dev` | Server and Vite together; rebuilds the stub pack first |
| `pnpm server` / `pnpm web` | Separately |
| `pnpm build` | Client build into `dist/client`, served by `pnpm server` |
| `pnpm stubs` | Stub pack into `dist/stubs` |
| `pnpm check` | Biome (any warning fails), types (`tsc -b`), layer boundaries, unit tests |
| `pnpm gates` | The test gates the changed files can affect (`--list` shows the plan, `--all` runs every one) |
| `pnpm test:data` / `pnpm test:reload` | The unit tests that need the original data (`JA2_DATA_DIR`) / that reload every test campaign at every input |
| `pnpm e2e` | Playwright on the stubs (own ports 7431/5183, `JA2_E2E_PORT`/`JA2_E2E_WEB_PORT` move them) |
| `pnpm e2e:data` / `pnpm e2e:browsers` | Playwright on the original data / pixel-exact in Chromium and Firefox |
| `pnpm cli inspect vfs` / `ls <prefix>` | VFS layers and per-file-type statistics / file list |
| `pnpm cli inspect sti <path> --png <dir>` | Describe an STI, dump frames to PNG |
| `pnpm cli inspect map <path>` / `tilesets` | Describe a map, list tilesets |
| `pnpm cli inspect slf <file>` / `cat <path> --out <file>` | Archive directory, file extraction |
| `pnpm cli inspect save <file.sav>` | Summarise a native savegame: sector, time, soldiers, items, PreRandom |
| `pnpm cli inspect verify` | Decode every STI, PCX, TGA, JSD and map and report errors |
| `pnpm cli bench <scenario\|all>` | Benchmarks (enemy turn, real time, strategic, autoresolve, server, campaign, save): one JSON line per variant, `--profile`, `--calls` |
| `pnpm cli replay <name>` | Re-run the input log of a ja2-node save from its origin and compare the result with the save |
| `pnpm cli campaign --seed N` | Play a stub campaign through MCP alone with an exact and a player reload on the way; one JSON summary line (outcome, days, battles, mercs lost) |

| Variable | Meaning |
|---|---|
| `JA2_DATA_DIR` | The original data: the `Data` folder or the game root |
| `JA2_SAVES_DIR` | The native savegames (default: `SavedGames` next to the `Data` folder) |
| `JA2_SAVE_DIR` | The ja2-node saves (default `.ja2/saves`) |
| `JA2_HOST`, `JA2_PORT`, `JA2_WEB_PORT` | Server address (`127.0.0.1:7420`), Vite port (5173) |
| `JA2_LANG`, `JA2_DATA_VERSION` | Default display language (`eng`, `rus`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`; default: the data's); data version override (`russianGold` and the other version names; Russian Gold must be named) |
| `JA2_SESSION_HOST` | `inprocess` (default) or `worker` |
| `JA2_MAX_SESSIONS` | Session cap (default 16; the e2e server uses 64) |
| `JA2_SAVE`, `JA2_CAMPAIGN`, `JA2_SEED` | The default session: a native save (`JA2_SAVE=SaveGame07`), a new campaign of difficulty N (`JA2_CAMPAIGN=2`), its seed (default 1); otherwise the sandbox |
| `JA2_CACHE_DIR` | The rule pack and hash cache (default `.ja2/cache`) |
| `JA2_TOKEN` | Use this token instead of `.ja2/token` |

## Layout

| Path | What |
|---|---|
| `src/core`, `src/content`, `src/sim`, `src/protocol`, `src/ui` | Shared layers without DOM or Node: RNG and integer semantics; data model, VFS and decoders; the deterministic simulation; the client–server protocol; the player UI |
| `src/node`, `src/server` | Node: VFS over the disk; HTTP, WebSocket, MCP, sessions, saves, the rule pack |
| `src/render`, `src/audio`, `src/app`, `src/devtools` | Browser: WebGL2, Web Audio, the game page and the launcher, the developer pages |
| `data/` | JSON shipped with the engine: Stracciatella's externalized tables, tables transcribed from the source, UI layouts |
| `stubs/` | The stub pack's sources and generator |
| `tools/` | CLI, dev runner, gates, import checker, transcribers, benchmarks, campaign bot, native oracle |
| `tests/` | Playwright suites and test support |

The layers, their dependency rules and how they are enforced: [`docs/01-architecture.md`](docs/01-architecture.md) §2.
