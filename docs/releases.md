# Releases

## 0.7.0 — platform release (M7), 2026-10-18

The first release of ja2-node as a platform: the whole Jagged Alliance 2 campaign runs on a Node server, from the
laptop and the first landing to the Queen's death and the ending, with the original's rules (JA2 Stracciatella with
default settings as the reference). It can be saved, loaded and replayed, it plays with sound, music and the videos,
and its UI labels come in every language of Stracciatella's string tables. Agents play it through MCP; people start
and load games in a DOM launcher and play through the developer pages. The canvas player UI with the original's
screens is the next milestone (M8, release 0.8.0). What each milestone built is in `deviations.md`, M7's spec
is `27-platform.md`.

### What a player can do (browser)

- **Launcher** at the server's root: a new campaign with the game init screen's options (difficulty, sci-fi, gun nut,
  save mode, blood and gore), the default squad or hiring in the laptop; the save list with the original's row fields,
  load, save, delete, download and upload, and the native savegames of the game's `SavedGames` folder to continue;
  settings (volumes, speech, subtitles, the sleep/wake notification, the splash and intro switches, the display
  language) with export and import. The splash, the beginning intro, the ending videos and the credits play from the
  original data (a stub splash without it).
- **Strategic page**: the map with control, known enemies, militia and squads, routes, time compression, assignments,
  contracts, battle prompts and autoresolve, the laptop (mail, A.I.M., M.E.R.C., I.M.P., Bobby Ray's, insurance,
  florist, records), the quest and meanwhile logs, Skyrider's helicopter.
- **Tactical page**: the loaded sector in real time and turn-based combat, orders, doors and their menu, shops,
  conversations with NPCs (approaches, questions, giving items), prompts such as the enemy's surrender offer, sound and
  music, playback at 1×, 4×, 16× or skipped; Alt+S and Alt+L quick save and load.

These are developer pages: text panels and the rendered map, not the original's screens.

### What an agent can do (MCP)

- Nine tools: `status`, `observe`, `act`, `advance`, `newSession`, `save`, `load`, `listSaves`, `deleteSave`
  (`04-time-and-server.md` §6; the tool descriptions list every command with its refusals).
- Every player action is a command and every modal moment a decision prompt: tactical orders, attacks with
  `estimateAttack`, the inventory, reloading and first aid, doors, conversations, giving, recruiting and escorts, the
  strategic map, assignments, militia, contracts, shops, the laptop, the helicopter, prompt answers.
- `observe` returns the player's view only (no hidden state); `advance` runs time to idle, an event, a tick count or a
  world time and stops at every decision.
- Own sessions per agent (sandbox, new campaign, native savegame or a ja2-node save), saves that follow the campaign's
  save mode, player loads that reseed like the original or exact loads for reproducible experiments, an input log per
  save that `pnpm cli replay` re-runs to the same bytes.
- Sessions share the server in 10 ms slices, so one agent's long enemy turn does not hold up another; with
  `JA2_SESSION_HOST=worker` each session runs on its own thread.
- An example agent: `pnpm cli campaign` plays a stub campaign through the MCP tools alone (hiring, the landing,
  Drassen, the mine, the helicopter, militia, recruiting, the march on Meduna), checks an exact load in a battle against
  the original session and prints a one-line summary.

### How to run

Requires Node 24 and pnpm 11.

```sh
pnpm install
pnpm stubs                                                   # build the stub pack (pnpm dev rebuilds it too)
export JA2_DATA_DIR="/path/to/Jagged Alliance 2 Gold/Data"   # optional: your own copy of the game
pnpm dev                                                     # server on 7420, Vite on 5173
```

Open http://127.0.0.1:5173/ (the launcher). For a built client: `pnpm build`, then `pnpm server` and the
`login?token=…` link it prints. Without `JA2_DATA_DIR` everything runs on the stub pack: the project's own maps,
profiles, scripts, sounds, music, text, fonts and a splash video, under the original file names. The original data is
never part of the repository.

Connect an agent (Claude Code shown; any MCP client over streamable HTTP works):

```sh
claude mcp add --transport http ja2-node http://127.0.0.1:7420/mcp --header "Authorization: Bearer $(cat .ja2/token)"
```

| Variable | Effect |
|---|---|
| `JA2_DATA_DIR` | the original `Data` folder (or the game root); unset: stubs only |
| `JA2_SAVES_DIR` | the native `SavedGames` folder (default: next to `Data`) |
| `JA2_SAVE_DIR` | ja2-node saves (default `.ja2/saves/`) |
| `JA2_DATA_VERSION` | the data version when detection cannot tell (`russianGold` must be named) |
| `JA2_LANG` | the default display language (`eng`, `rus`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`) |
| `JA2_SESSION_HOST` | `inprocess` (default) or `worker` |
| `JA2_HOST`, `JA2_PORT` | the server address (default `127.0.0.1:7420`) |
| `JA2_SAVE`, `JA2_CAMPAIGN`, `JA2_SEED` | open the default session from a native save, as a new campaign of that difficulty, or with a seed |
| `JA2_TOKEN` | the access token instead of `.ja2/token` |

`pnpm check` runs Biome, the type check, the layer check and 1,682 unit and scenario tests (on stubs; 48 more need
the original data); `pnpm e2e` runs 16 Playwright specs on stubs; `pnpm cli bench` measures enemy turns, real time,
strategic days, autoresolve, saves, the server and a campaign.

### Known limitations

- No canvas player UI yet: a human plays through the developer pages (M8).
- Every deliberate difference from the original is in `deviations.md`; the entries tagged **Later** are gaps still to
  close (among them drugs and alcohol, timed bombs, catching thrown items, martial arts and stealing, panic AI and a
  few AI specials, camouflage and smoke in sight, corpses rotting in the loaded sector, auto-bandage, walking up for a
  melee attack from the API, the civilian hummer and ice-cream truck, vehicle repair and fuel, the import of other
  sectors' temp files from native saves), the ones tagged **M8** wait for the player UI.
- The stub campaign is a minimal world: generic maps by sector kind and only the scripts the tests and the stub
  campaign path need; the creature lairs have no way in on stubs, so play stub campaigns with sci-fi off. The scripted
  campaign bot (`pnpm cli campaign`) gets through Drassen and the recruiting but has not won a stub campaign yet: the
  march and the Meduna outskirts beat it (`27-platform.md` §6.7, finding 31).
- Sound: no lip sync, no button clicks and a few cues listed under "Sound coverage"; the playback speed, display
  toggles and key-advance speech settings are stored for M8.
- Performance: the first save of a session on the original data takes about 150–190 ms (it builds the content index), an
  in-process save briefly stalls other sessions (the worker host avoids it), the client frame rate is not measured.
- The open findings and decisions of M7 are in `27-platform.md` §6.7, the full "Left out of M7" list in
  `deviations.md`.

### Next: M8, the player UI (0.8.0)

The D10 canvas widget set with layouts as data and bitmap fonts from the data or the stub font (Cyrillic through the
data version's glyph table); the original screens in this order: main menu, options and save/load (on the launcher's
logic), the tactical HUD with its panels and inventory, the map screen, the pre-battle interface and autoresolve, talk,
shop and message boxes, the laptop sites; the original hotkeys, meanwhile scene playback, the enemy glow, lip sync and
button sounds, the stub art those screens need (faces, item graphics, interface panels), and the 60 FPS target at
1920×1080. Result: a human plays the whole campaign in the browser without the developer pages.
