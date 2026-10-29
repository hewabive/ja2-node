# 29 — Agent API

*The agent API by topic: transport, tools, commands, refusals, decisions, view fields, events, queries. It is the
browser's session API (D13–D16) exposed over MCP. Time model and `advance`: `04` §4; server, sessions, protocol,
player-view projection, saves and rule pack: `04` §5. The MCP tool descriptions in `src/server/mcp.ts` (`act`,
`observe`, `advance`, `newSession`, the save tools) list every command, view field, event and refusal with its fields;
this doc gives the rules behind them and names each topic's domain spec. Where the two differ, the code wins.*

## 1. Transport

- **LLM agents**: MCP over streamable HTTP at `http://127.0.0.1:7420/mcp` (`JA2_PORT` moves it) with
  `Authorization: Bearer <.ja2/token>` (`04` §5.8); Claude Code adds it with `claude mcp add`. Each request builds a
  fresh MCP server over the shared sessions (`handleMcpRequest`), JSON responses. No stdio transport.
- **The browser**: the WebSocket protocol of `04` §5.2.
- **Scripts and bots**: the same HTTP routes and the WebSocket directly; no TS client package. Users: the e2e tests,
  `tools/bench`, `pnpm cli campaign` (`tools/campaign-bot/`: a whole stub campaign through the MCP API alone, new game
  to the Queen's death, with an exact and a reseeded reload on the way).

| HTTP route | Purpose |
|---|---|
| `GET /api/health` | name, data (original, SLF count, stubs), `dataVersion`, default `language`, `engine`, `rules`, file count |
| `GET`, `POST /api/sessions`; `DELETE /api/sessions/:id` | list (`describeSession`), create (the `newSession` body), close (§6) |
| `GET /api/sessions/:id/profiles` | profile presentation (§29) |
| `/api/saves…`, `/api/sessions/:id/{save,load,snapshot}` | saves (§26) |
| `GET /api/strings`, `GET /api/text` | UI strings and EDT rows (§25) |
| `GET /api/items` | the item catalogue (§29) |
| `GET /api/assets/manifest`, `GET /api/vfs`, `GET /vfs/…` | assets (`04` §5.10) |
| `GET /login?token=` | sets the token cookie, redirects to the launcher |

## 2. Tools

Few and coarse. Every tool but `newSession`, `listSaves` and `deleteSave` takes `session` (default `sandbox`), so
agents and tests do not share one battle.

| Tool | What it does |
|---|---|
| `status` | Tick, map, driver, `language`, `dataVersion`, soldier count, idle, game `options`, `saveMode`, `canSave`; in a campaign also clock, flow, sector, `campaign` (`playing`, `endgame`, `won`), `noUsableMercs` |
| `observe` | The player view (§7) as JSON, UI labels in the session's language beside the machine tokens (§25), plus `status` |
| `act` | One command `{command: {type, …}}` → `{ok, reason?, data?}`; queries are `act` commands too (§28). Under the manual driver time moves only in `advance` |
| `advance` | Runs time to a stop condition (`04` §4.2) → `{tick, reason, worldTime?, refusal?, events, messages}`; while a viewer runs the session in real time it waits instead of stepping (§6) |
| `newSession` | Starts a session, returns its id (§6): the sandbox, a new campaign, a native savegame import or a ja2-node save |
| `save`, `load`, `listSaves`, `deleteSave` | Saves on the server (§26) |

Events come only with `advance` reports (those since the previous report), never with `observe`; `observe` returns no
ASCII map.

## 3. Example turn

Abbreviated (values illustrative):

```
→ act {"command": {"type": "estimateAttack", "soldier": 3, "target": 12880, "aimTime": 4}}
← {"ok": true, "data": {"cursor": "target", "apCost": 8, "apCostByAim": [4, 5, 6, 7, 8], "chanceToHit": 58,
   "chanceToGetThrough": 91, "inRange": true, "ammo": {"empty": false, …}}, "tick": 4210}
→ act {"command": {"type": "attack", "soldier": 3, "target": 12880, "aimTime": 4}}
← {"ok": true}
→ advance {"idle": true}
← {"tick": 4402, "reason": "idle", "events": [
   {"type": "shotFired", "soldier": 3, "target": 41, "chance": 58, "hit": true, …},
   {"type": "soldierHit", "soldier": 41, "attacker": 3, "location": "torso", "damage": 18, …}], "messages": […]}
```

## 4. Fairness, strengths and limits

- **Fairness.** The agent sees what the player's screen would show (D16, `04` §5.3). Hints (§28) read only the view;
  an answer that needs hidden state is dropped (the melee chance to hit is `null`) or left to the command, which refuses
  on the full state with the original's message.
- **Good at** turn-based combat, strategy and management; queries spare the agent the arithmetic. **Worse at** spatial
  reasoning over JSON (cover, elevation, roofs).
- **Real time** only through the manual driver or by waiting on a viewer's real time (§6); real-time control by an LLM
  agent without pausing is a non-goal.
- **A long campaign** is thousands of actions: prefer the events of `advance` reports over repeated `observe`.
- **Not built as commands** (shown disabled by the client; each keeps its entry in `gaps.md` or `deviations.md`):
  stealing, operating and using items on things, planting bombs, wire cutters, gas cans, jars and tin cans
  (`previewAction` answers `notSupported`), walk-up melee (gap "Melee without walking"), auto-bandage, key-ring editing,
  the placement GUI, drugs and alcohol (`notPorted`), reloading the robot (`robotReload`). Vehicles' condition and fuel
  are not in the view.

## 5. Commands, refusals and decisions

**Conventions.** `gridNo = y × 160 + x`; direction 0 = north (up-right on screen), clockwise; sectors are strings such
as `A9` (`A9-1` below ground in labels); soldiers are ids, NPCs a profile id or internal name (`{npc: …}`); inventory
slots are `0`–`18` or `helmet`, `vest`, `legs`, `head1`, `head2`, `hand`, `secondHand`, `bigPocket1`–`4`,
`smallPocket1`–`8`. Every command is logged and replayed; queries are not (§28).

**Refusals.** `{ok: false, reason, data: {refusal: <token>}}`: `reason` is readable text (often `<token>: <text>`),
`data.refusal` a machine token (per command in the MCP `act` description; `assign` returns per-soldier results and
names the first failure in `reason`). The text keys `refusal.<token>` (`/api/strings`, `/api/text?key=`) give the
original's message where it has one (`TacticalStr`, `pMapErrorString`, `zMarksMapScreenText`, `Message`,
`pMessageStrings`, `gzLateLocalizedString`); `REFUSAL_MESSAGES` (`src/server/text-keys.ts`) also says whether the
original logs it or shows a box. The table lives in `src/protocol/refusals.ts`, so the client prints the original
strings without the server. Refusals finer than the original's menus fold into its tokens (`noMedKit`, `noToolKit`,
`noMilitiaAllowed` into `notEligible`/`noMilitiaHere`).

**Decisions** (`hasPendingDecision`; `advance` stops with `decision`, the real-time driver holds): an interrupt in our
favour with nobody acting (act with the soldiers that may act, then `endTurn`); an open prompt; an NPC request; a
conversation waiting for a choice. Prompts are answered with `answer {prompt?, choice}` (id optional; a wrong id or
choice is refused):

| Prompt (`observe.…`) | Opened by | Choices |
|---|---|---|
| `preBattle` (`prompt`) | an encounter, `showBattle` (§20) | `autoresolve`, `enterSector`, `retreat`, `close` (non-persistent only) |
| `surrender` (`prompt`, `context: autoresolve \| tactical`) | the enemy's offer (§16, §20) | `accept`, `reject` |
| `autoresolveDone` (`prompt`) | the end of an autoresolve battle | `bandage`, `done` |
| `simultaneousArrival` (`prompt`) | groups arriving together (`16`) | `coordinate`, `separately` |
| `npcOfNote` (`prompt`) | a group meeting an NPC of note | `continue`, `stop` |
| `militiaPayment`, `militiaContinue` (`prompt`) | militia training (§19) | `yes`, `no` |
| `contractRenewal`, `mercDeparture`, `insuranceExtension` (`contractPrompt`) | contracts (§22) | `day`, `week`, `twoWeeks`, `dismiss`, `letGo`; `here`, `elsewhere`, `rehire`; `yes`, `no` |
| `npcRequest` (`npcRequest`) | an NPC's requestor action (§16) | `yes`, `no` (`lie` for `request: lie`) |

A prompt stops compression and counts as a decision; while it is open the clock stands still and every other command
is refused (`promptOpen`, or `answer the npcRequest prompt first`). The original's informational boxes (assignment
done, fell asleep, militia promoted, the boxes before a pre-battle panel) are events, not prompts.

**Modal flows.**

| State | Accepted besides queries and `observe` | Refusal for the rest | `advance` |
|---|---|---|---|
| shop open (§23) | `quoteTrade`, `trade`, `setShopPricing`, `closeShop` | `shopOpen` | `refused` (`shopOpen: …`) |
| laptop open (§21) | laptop commands | `laptop: the laptop is open, closeLaptop first` | `refused` with that text |
| conversation waiting for a choice (§13) | `approach`, `give`, `closeTalk`, `skipLine` | `conversationOpen` | `refused` (`conversationOpen`) |
| scripted sequence | `skipLine` | `scriptedSequence` | runs it until it ends or a panel opens |
| meanwhile: the interrogation (§24) | `answer` | `inMeanwhile` | runs; stops at its prompt and at `meanwhileEnded` |
| endgame (§24) | `answer` | `endgameInProgress` | plays the sequence, `ended` at `campaignWon` |
| ended | `status`, `newSession` | `campaignOver` | `ended` at once, no ticks |
| boxing UI lock (§16) | `estimateAttack`, `answer`, `skipLine` | `boxingUiLock` | runs the walk out of the ring |

`skipLine` is accepted in every state; `setOption` is refused only while a prompt is open (§27).

## 6. Sessions, campaigns and time

**Creating.** `newSession` and `POST /api/sessions` take one body `{seed?, language?, save?, load?, reseed?, speech?,
campaign?}` (`NEW_SESSION_SHAPE`, `src/server/session-registry.ts`):

- none of `save`, `load`, `campaign`: the sandbox (the A9 map and squad, independent state);
- `save`: imports a native savegame of the `SavedGames` folder (`14` §10; refused for saves taken during a meanwhile
  scene or the endgame sequence); `load`: a ja2-node save (§26); `language`: the display language (§25); `speech`: the
  speech mode (§27);
- `campaign {options?, hire?, mercs?, imp?, land?, deadIsDeadName?, deadIsDeadDescription?}`: `createCampaignSession`
  (`src/server/campaign-factory.ts`) builds the `CampaignSim` (strategic map, Queen, towns, sector flow), runs
  `initNewGame` (which leaves the game in the laptop on day 1, 01:00), hires the squad through the laptop with real
  prices, deposits and refusals, closes it and, unless `land: false`, dispatches the first `compressTime` so the
  helicopter drop loads the start sector at 07:00 on day 1 (`15`). `hire: [{profile, contract?, gear?}]` names the
  A.I.M. hires (a refusal fails the request); `mercs` sizes the default squad (original data: profiles 0, 3, 4, 7, 14,
  16, default six; stubs: the twelve stub A.I.M. profiles 0–11, default four; hired in order while available and
  affordable); `imp` runs an `impCreate`; `hire: []` without `imp` returns the session in the open laptop; `options`:
  the game options (§27); `deadIsDeadDescription` (exclusive with `deadIsDeadName`) lets the server derive the Dead is
  Dead save name (`<UTC time>-<slug>`). A campaign session has a campaign identity (§24).

**Closing.** WebSocket `closeSession` and `DELETE /api/sessions/:id` run the Dead is Dead save point "when the session
is closed" (`27` §1.6) and release the session; the default session is refused (`defaultSession`, 409), an unknown one
is 404. WebSocket `leave` detaches the connection and closes the session the same way only when no other WebSocket
watches it (`data.closed` says which; the player's Main Menu in the options sends it). Every viewer of a closing
session gets `closed {session, reason}` (`04` §5.2); MCP calls on a closed session fail with `no session <id>`.

**Flows** (`status.flow`): `tactical` (the loaded sector steps in real time or turns), `strategic` (the map screen: the
world clock runs, compressed on request; a loaded sector is frozen), `autoresolve` (§20), `laptop`, `meanwhile`,
`endgame`, `ended`. `mapScreen` and `tacticalScreen` switch between the first two like the original's screen toggle
(`mapScreen {abandonFight: true}` during boxing, §16); `enterSector` on the loaded sector (and the pre-battle
`enterSector` answer for it) returns to tactical at normal speed.

**Time on the map.** `compressTime {mode: 2|3|4}` (5, 30 or 60 world minutes per real second; time moves only while the
session advances) and `stopTime`; the player's pause is not a command: the manual driver is the pause. `compressTime`
refuses with the tokens `TellPlayerWhyHeCantCompressTime` picks: `mapScreenOnly`, `badMode`, `noMercsHired`,
`meanwhileStarting`, `noUsableMercs`, `inCombat`, `enemiesPresent` (`AllowedToTimeCompress`), `creatureMine`,
`bloodcatAmbush`, `contractRenewal`, `pauseLocked`. A strategic `advance` (`04` §4.2) starts compression itself.

**Agents beside a viewer.** While a viewer runs the session in real time (the browser's default), MCP `advance` runs no
ticks (`SessionHost.advance(until, budget, {waitInRealtime: true})`): `Session.waitInRealtime` watches the real-time
batches with the same stop conditions (`AdvanceRun.observe`) and answers when one holds; after 30 s at most
(`REALTIME_WAIT_MS`) with reason `timeout` (call again); `refused` when real time stops or for time compression (the
viewer compresses on the map screen). The wait is outside the host's input queue: the player's commands go through
meanwhile and nothing enters the input log. The browser's own `advance` requests (a compression to a world time,
autoresolve slices) still run ticks. The devtools strategic page (`src/devtools/strategic/`) drives a campaign over the
same API.

## 7. The player view

`observe` returns the `PlayerView` of `04` §5.3 (`src/protocol/view.ts`); view frames carry the same blocks when they
change, so the browser follows the campaign without polling. Every field is in the MCP `observe` description; the
rules:

- **Tactical blocks**: `soldiers`; `openDoors` (gridNos of open doors); `openContainers` (base tiles of open crates,
  lockers and switches); `doors` (doors whose lock or trap the player knows, §11); `revealedRooms`; `items` (items the
  squad has seen on the ground, with `money`, `attachments`, `height` when lying on a structure, `notRendered` inside an
  open container); `combat` (turn-based only); the world (below).
- **Own soldiers** (`src/sim/tactical/soldier-view.ts`): position, animation, AP, life, breath, inventory (per object
  status, ammo, attachments, money, `jammed`, `imprint`: the profile a rocket rifle answers to, 201 for an unknown
  owner, `GetObjectImprint`), the key ring, and what the original's panels read: `bleeding` (bandaged part =
  `lifeMax − life − bleeding`), the SM panel's `stats`, `armour` (`ArmourPercent`), `weight`
  (`CalculateCarriedWeight`), `camo`, `stealth`, `weaponMode`, `muted`, `stance` (how a move without a mode goes, §10),
  `sees` (ids this merc sees now), `opponents` (`bOppCnt`, the face's enemy count), `canAct` (the face hatch rule: our
  turn and not moved during an interrupt; a hidden enemy interrupt keeps it true), `continueTo` (the End key's target:
  `sContPathLocation` with `bGoodContPath`, else the final destination of a halted move), `noApToFinishMove`
  (`fNoAPToFinishMove`: stopped mid-move for want of AP, still in the moving animation, which the cursor counts as
  standing), `firstAid`, `blinded`, `hint` (the inputs hints read, §28), `voice` (the battle-sound voice: the profile's
  voice id as three digits, I.M.P. voices included, or `badN`/`kidN` without a profile; with `bodyType` it picks the
  `m_`/`f_` fallback); in a campaign `asleep`, `squad`, `vehicle {id, driver}`, `kind: rpc|epc` for recruited NPCs,
  the robot's `controlled`.
- **Other soldiers in sight**: only their visible fields, `hostile` (`!bNeutral && bSide != FRIENDLY`, the glow test)
  and `healthIndex` (index of `zHealthStr`, `GetSoldierHealthString`; −1 once `bLife` is 0, while the death animation
  plays until `soldierDied`), never life; `talkable: npc|epc|civilian`, `profile` when profiled, `merchant`.
- **Every soldier**: the animation schedule (`frameSlot`, the timeline slot of the shown frame; `stateTick`, set where
  `EVENT_InitNewSoldierAnim` changes the state; `frameDelay`, `sAniDelay` in ms; `nextFrameTick`), `frame` (for the
  devtools and the sound director) and `muzzleFlash: true` from his shot (`UseGun` sets `fMuzzleFlash`) until the flash
  goes out (`EndMuzzleFlash`: the end of his attack in real time, his next AI decision, his team's AI list, the end of
  our merc's attack on our turn, the end of combat); meanwhile anyone sees him as far as in daylight
  (`DistanceVisible`), and the chance to hit reads that.
- **Combat block**: `team`, `round`, `interrupt`, `uiLocked` (orders are refused now), `topMessage {kind, team,
  bloodcats}`, `ai {current, total}`. The turn state (`src/sim/tactical/turns/top-message.ts`) keeps the top message
  the original creates (`AddTopMessage` at the start of our turn, an interrupt in our favour and its end, the enemy
  turn, a displayed hidden interrupt: `computerInterrupt` or `militiaInterrupt`) and the progress bar (`InitEnemyUIBar`
  when an AI list is built, `UpdateEnemyUIBar` when an AI soldier starts outside an interrupt); `ai` shows while a
  computer message is up. During a hidden enemy interrupt `team` and `topMessage` show our turn, as in the original,
  and orders are refused with `uiLocked`.
- **Campaign blocks** (`clock`, `strategic`, `prompt`, `contractPrompt`, `autoresolve`, `shop`, `laptop`,
  `conversation`, `npcRequest`, `scriptedSequence`, `boxing`, `meanwhile`, `ended`): present only while the original
  shows them; see the topic sections.
- **Labels.** MCP observations stay English-keyed JSON with machine tokens; `observe` adds labels in the session's
  language beside them (`moraleLabel`, `assignmentLabel`, `menuLabels`, null where the original has no string,
  `kindLabel`; `labelledView`, `src/server/text-keys.ts`).

**The world** (`src/sim/tactical/world-view.ts`), sent whole on every change:

- `corpses [{gridNo, level, type, direction, bodyType, palettes?, camo?}]`: every rotting corpse (the original draws
  all; `bVisible` is always 1); `type` from `tables/corpses.json` (stage `ROTTING_STAGE2` decided when the sector
  loads), `palettes` the soldier's `[hair, skin, vest, pants]`, `camo` = `ROTTING_CORPSE_USE_CAMO_PALETTE`; older
  records without palettes use the graphic's own palette.
- `smoke [{gridNo, level, effect, dissipating?}]`: `effect` from `smoke-effects.json`; `dissipating` marks a tile whose
  graphic was added while its cloud had fewer than two turns left (`AddSmokeEffectToTile`, bit 0x40 of the tile flags).
- `light {ambient, sprites [{x, y, template, dynamic?}]}`: `ubAmbientLightLevel` and every active light sprite,
  `dynamic: true` on muzzle flashes (`L-R03.LHT`), explosions (`L-R04.LHT`) and flares; the renderer adds only the
  dynamic ones to the map's own lights, the hints read all.
- `tileChanges [{kind: remove|add, gridNo, level, tile}]`: structure graphics changed since the map loaded, in order,
  from the sector diff's map changes (wrecked structures, the O3 statue, window hits; a bullet's window hit is recorded
  like an explosion's, `AddWindowHitToMapTempFile`, so it stays broken on the next load).
- `blood [{gridNo, strength, creature?}]`: the pools as the squad last saw them (deviation "Blood on the ground").
  `UpdateBloodGraphics` replaces a tile's pool only when its blood changed (`MAPELEMENT_REEVALUATEBLOOD`: a drop, a
  decay step, a corpse wiping it) and was then dropped by a visible soldier or seen by a merc of ours
  (`RevealRoofsAndItems`); the smell map keeps those two states (`reevaluateBlood`, `shownPools`). `strength` 1–7 picks
  one of four sizes (`3 − strength/2`); none on roofs, none with blood and gore off. None of the 261 original maps
  places blood objects of its own. The browser picks one of four variants from the tile and strength (deviation
  "Cosmetic draws in attacks").

## 8. Events and the message log

Events (`src/sim/events.ts` and the domain event files it imports) come with `advance` reports; a browser gets the same
in `ViewFrame.events`. Events a command emits (a talk's lines, a shop's quotes, money events) reach the frame captured
right after the command; the `Session` holds them for the next report.

**Tactical** (`advance {events}` may watch any): `arrived`, `stopped {reason: outOfAPs|closedDoor}`, `noPath`,
`doorChanged`, `noiseHeard` (a direction, never a grid), `enemySighted {enemies}` (the ids that became known),
`combatStarted`, `turnStarted`, `interrupt {selected}` (only once visible), `interruptEnded`, `combatEnded {reason:
lull|won|lost|boxing, fought?, monsterKill?}`, `shotFired`, `bulletStopped`, `soldierHit`, `soldierDied`, `gunJammed`,
`statChanged`, `attackResolved`, `meleeStrike`, `explosion`, `structureDamaged`, `itemsPickedUp`, `itemDropped`,
`roomRevealed`; `lifeLost {soldier, amount}` (every life deduction of a visible soldier in `SoldierTakeDamage`: hits,
bleeding, gas, falls), `aiTurn {soldier}` (where the original locates the acting AI soldier: visible, alive, outside an
interrupt, not green friendly militia), `enemyTurnProgress {done, total}` (every `UpdateEnemyUIBar`), `itemsRevealed
{gridNo, level}` (an item locator, `SetItemsVisibilityOn`).

**Campaign** (besides the topic sections): `groupArrived {group, sector, final, who}` for every player group, vehicles
and the helicopter included (`who` the `MSG_ARRIVE` subject: a merc, a squad or a vehicle type); `invasion {sector,
kind: sam|town|other}` (`NotifyPlayerOfInvasionByEnemyForces`); `sectorControlChanged {sector, controller, kind?,
dailyIncome?}` (`kind` `sam|mine|town` for the notice of `NotifyPlayerWhenEnemyTakesControlOfImportantSector`,
`dailyIncome` the income left after a producing mine is lost; not emitted for an uncontested takeover, gap "Lost
sector notices without a battle"); `sectorLoaded {sector, loadScreen?, hostiles?, enemyPresence?, firstArrival?}`
(`GetLoadScreenID` at every sector entry outside a save load and the pre-battle transition, drawing `Random(2)` on the
gameplay stream for town sectors without a mapped picture), `sectorUnloaded`, `mercsLeftSector {sector, to,
mapScreen?}`, `enemyPresence`, `creatureAttack`, `civiliansEaten {sector, count}`. The music facts among them feed the
music mode (§27).

**Message entries** (`src/server/message-entries.ts`, `src/protocol/message-log.ts`): a presentation module outside
`sim` turns events into entries of the original's message list (`Utils/Message.cc`): `{tick, kind, colour, table,
index, args}`; `kind` `interface` (yellow, `INTERFACE_COLOR`), `dialog` (white; `textKey` and `speaker` instead of a
table: `Nick: "line"`), `uiFeedback` (`FONT_MCOLOR_LTYELLOW`; the client opens the feedback box) or `skullFeedback`
(never kept); `args` are `{text}`, `{number}`, `{money}`, `{string: {table, index}}` or `{item, name: short|long}`,
consumed by the format's placeholders in order, extras appended; without a table the args are joined by spaces. The
sites cover the original's `ScreenMsg` calls that have an event (noises, deaths, interrupts, stat gains, reloads, first
aid, locks and traps, recruits, balances, arrivals, history, repairs, assignments, invasions, game saved, dialogue
lines) and the refusals the original prints (`notEnoughAP`, `noPath`, `mercUnavailable`, `uncontrolledRobot`,
`outOfBreath`, `noBurst`, `noRoomToFire`). The session keeps the last 256 entries (`MESSAGE_LOG_SIZE`) in its
presentation block: saved (`presentation.messages`), sent whole in `welcome`, new ones in frames and in every `advance`
report (`messages`). The simulation never reads them; the ring holds entries, not wrapped lines.

## 9. Presentation events: shots, effects and sounds

Optional fields and events that never enter the state or an outcome. The client derives all sound and cosmetic
animation from them, the frames and the animation codes it replays (`31`); agents get the same events, never
audio.

- **Shots and explosions:** `shotFired {item, silenced, burst, rounds}` (`rounds`: the burst size on its first bullet,
  0 on later ones, 1 for a single shot), `bulletStopped {material, caveWall, explosiveAmmo?}`, `explosion {animation,
  x, y, z, delay}` (the animation shown, water variant included; where it is drawn; the blast speed), `doorChanged
  {kind: wood|cloth|garage|metal, noisy}`, `reloaded {soldier, item}`.
- **Bullets in flight.** After every tick the session records each bullet the original draws as a bullet tile (not
  missiles, flames or spit), only for our soldiers and those the squad sees (`shownToPlayer`, deviation "Bullets of
  unseen shooters"), and sends them in the next frame as `ViewFrame.bullets [{tick, x, y, z}]` (cell units, `z` the
  original's `sRelativeZ`); a flight usually falls between two frames, so a frame carries every tick. A thrown knife
  adds `knife {anchor, direction, since}` (the thrower's tile where the original hangs `knifing.sti`, the sprite's
  direction block, the session tick it was first seen, kept by the adapter outside the state; the client shows the
  block's fourth frame first, then one more every 100 ms); another thrown or launched object adds `item` (an armed
  mortar shell only leaves its trail). Never applied to the view or saved. A shooter seen only in his muzzle flash
  shows once his attack is over (`MakeNoise` holds noises while an attack is busy), so his bullets are not drawn.
- **Impact animations** where the original starts a cosmetic animation tile: `bulletImpact {soldier, gridNo, x, y, z,
  effect}` (`StructureHit`'s miss: `dust`, `splash` in water, `miniboom` for a stopping HE or HEAT round, which also
  frees the shooter at once; `WeaponHit`'s HE miniboom on a soldier), `windowShattered {gridNo, tile}`
  (`WINDOWSHATTER`), `missileTrail {gridNo, x, y, z, trail: smoke|small|spit, delay}` (`AddMissileTrail`: the browser
  draws the `Random(100)` part of the delay, flames have a fixed 100 ms, a mortar shell its `PreRandom` delay),
  `waterRipple`, `corpseVaporized` (`VaporizeCorpse`: `gen_blow.sti` every 80 ms and `BODY_EXPLODE_1` on the corpse's
  base tile). The session copies these into `ViewFrame.effects` stamped with the session tick (a tactical event's
  `tick` is the tactical simulation's); the client plays them on its clock of view ticks.
- **Sounds of shooting.** A gun's miss from `bulletImpact` (`MISS_G2` at height 0, else one of `MISS_1..8`; the
  miniboom `SMALL_EXPLODE_1`); the struck material from `structureStruck {soldier, gridNo, material, caveWall?}`
  (`DamageStructure`, also for bullets that pass through); a bullet leaving the map from `bulletStopped {reason:
  offMap}`; glass from `windowShattered`; a merc cursing a miss (`Random(40) == 0` on the browser's generator, for our
  single shots that hit a structure and our shots that leave the map); `creatureGas {gridNo}`; `thrownImpact {gridNo}`
  (the first ground or roof contact and the rest position); `mortarWhistle {sounding}` (on at the top of an armed
  shell's arc, off at its end).
- **Soldier sounds.** A merc in `stealth` plays no footstep or stance sound (`PlaySoldierFootstepSound`) except
  `stealthyFootstep {soldier}` on each new tile where he makes movement noise (`PlayStealthySoldierFootstepSound`); a
  `muted` merc plays no battle sound; low-morale confirmations read `morale`. `creatureCall {soldier, call:
  onePrey|multiplePrey|attacked|crippled}` (`CreatureCall`, cried at code 717: `ACR_SMELL_PREY`, `ACR_SMELL_THREAT`,
  `ACR_CRIPPLED`, the queen's `LQ_*`). Cow and crow idle sounds (`RANDOM_ANIM_SOUND`) need no event: the browser runs
  code 491 per pass of the loop (counted from the frame delay, as a predictable loop sends no frames), every third pass
  rolls `Random(100)` on its own generator; an injured (`critical` or worse), wet or not standing animal stays silent.
  A struck vehicle (`soldierHit` on a vehicle body) rings `S_METAL_IMPACT3` (`VehicleTakeDamage`) instead of an impact
  or battle sound; boarding a ground vehicle on the map screen (`vehicleBoarded`) plays its enter sound.
- **Sounds out of sight** (`08`). A source the squad does not see carries `heard {by, direction, volumeClass}`
  instead of its grid: the merc of ours who hears it loudest by `CalcEffVolume`, the side as `TellPlayerAboutNoise`
  names it (`pDirectionStr`, or above or below), the class of `pNoiseVolStr`; the browser plays it from that merc's
  tile, 4, 10, 18 or 30 tiles off for very loud, loud, definite and faint (`heardSoundTile`). A sound nobody of ours
  hears (our mercs are deaf on our own turn, as `CalcEffVolume` makes them) plays in the middle at `max(25, v − 25)`.
  A seen source, or a tile the player already sees (the victim of our bullet), plays at its tile. Hence:
  - `shotFired` of an unseen shooter drops `target`, `chance` and `hit` and carries `heard`;
  - `soldierHit` and `soldierDied` of an unseen victim carry `unseen {voice, bodyType}`, `gridNo` only when the
    attacker is seen or ours, else `heard` from the scream (`life`, `damage`, `breathLoss` only for seen soldiers;
    `conscious` says whether he still cries out);
  - `creatureCall` of an unseen creature carries `unseen {bodyType}` and `heard` (roared on the frames of `MONSTER_UP`
    or `QUEEN_CALL`).

  A death cry and a creature's call make no noise in the original; they are heard as loud as the crier's loudest
  scream (`CalcScreamVolume`'s cap of 10 − experience level). An unseen soldier's animation sounds stay silent
  (`PlaySoldierJA2Sample` skips soldiers out of sight).

## 10. Tactical orders

Rules: `10` (turns, interrupts), `11` (attacks), `07` (movement). Orders of the sandbox and of a campaign's tactical
flow.

| Command | Rules |
|---|---|
| `move {soldier, to, mode?, reverse?}` | Without `mode` the merc moves in his `stance` (run runs, stand walks, crouch swats, prone crawls); `walk\|run\|swat\|crawl` holds for this move only and he ends in that mode's stance. In combat refused unless the first step plus any stance change is affordable (`SelectedMercCanAffordMove`). `reverse` walks backwards (`bReverse`, `AP_REVERSE_MODIFIER` per tile). A new `move` re-plans a halted one for any merc (deviation "Continue a move") |
| `turn {soldier, direction \| toward}` | `MakeSoldierTurn`: `EnoughPoints(GetAPsToLook)`; a merc without AP first goes stationary |
| `stance {soldier, stance: run\|stand\|crouch\|prone}` | `UIHandleSoldierStanceChange` and `r` (deviation "Stance"). `run` makes a standing merc run for no AP and keeps `continueTo` (`usUIMovementMode = RUNNING`, `fUIMovementFast`); crouched or prone he stands first and runs once the change ends (`Soldier_Ani.cc` code 499 sets the mode by the new stance and keeps a run while standing); in real time `run` holds for the next move only. `stand`, `crouch`, `prone` set the mode by the stance and clear the run; in combat they pay the change and clear `continueTo` also in the current stance (0 AP: `s` ends a halted run); a merc moving in real time changes gait on the way |
| `stop {soldier}`, `endTurn` | `endTurn` only on our turn (`UIHandleEndTurn` → `EndTurn`); it also closes an interrupt in our favour (`EndInterrupt(FALSE)`). It first runs `CheckForEndOfCombatMode(FALSE)`: when that ends combat (nobody of ours sees an enemy and no hostile is alerted, or the battle is over) the turn does not pass, the answer carries `data {combatEnded: true}` and the report a `combatEnded` event (`10`) |
| `attack {soldier, target, level?, aimTime?: 0..4, bodyPart?, burst?, spread?}` | `HandleItem` with the hand item: gun, attached or held grenade launcher, throwing knife, thrown grenade or rock, knife or fists (no walk-up, gap "Melee without walking"; no UI-level target checks, deviation "Attack refusals"). Without `burst` it fires in the merc's `weaponMode` (`EnsureConsistentWeaponMode` first). `spread`: up to 50 distinct tiles in drag order (`AccumulateBurstLocation`), the burst spread with `PickBurstLocations`' float step; burst mode only; a refused attack clears it. A launcher without a round refuses with `noAmmo` (the original shows the reload cursor instead of firing) |
| `pickUp {soldier, gridNo?, zLevel?, items?}` | The visible items on the soldier's tile or an adjacent blocked tile; `items` index that tile's list (default all), instead of the pickup menu (deviation "Picking up items"); `AP_PICKUP_ITEM` |
| `climb {soldier}` | Onto the adjacent roof edge or down (`FindHigherLevel`/`FindLowerLevel`) |
| `weaponMode {soldier, mode?}` | `ChangeWeaponMode`: single → burst (burst-capable gun) → launcher (a loaded under-barrel launcher) → single; `mode` sets one; in launcher mode `attack` fires the attached launcher (`UNDER_GLAUNCHER`) |
| `stealth {soldiers, on?, squad?}` | `bStealthMode`; without `on` each toggles (SM button, `z`), with `on` all are set (Alt+Z: on unless one of the squad already sneaks); the robot is skipped; `stealthChanged` or `squadStealthChanged` |
| `mute {soldier, on?}` | `SOLDIER_MUTE`, a presentation flag the server keeps so speech and sound agree; `muteChanged` |
| `moveGroup {soldiers, to, mode?: stance\|fast\|run, reverse?}` | Real time only (`EnterCombatMode` clears the multi-selection): paths with `PATH_THROUGH_PEOPLE`; `fast` lets standing mercs run (a double click), `run` runs everyone (the all-move's right double click); an uncontrolled robot is skipped; `data {moved, noPath}`, `noPathForMerc` logs the original's line |
| `swapPlaces {soldier, with, cursor?}` | `x`: the other conscious, reachable within one tile (`CanSoldierReachGridNoInGivenTileLimit`), not hostile, `CanExchangePlaces`; `SwapMercPositions` (both re-inserted at their old tiles when a tile is not free), `AP_EXCHANGE_PLACES` from both. `cursor: true` is the exchange cursor's free swap (`ValidQuickExchangePosition`); `placesSwapped` |
| `jump {soldier, to}` / `jump {soldier}` | Over a prone soldier on the side tile between (`UIHandleJumpOver`, `IsValidJumpLocation`, `JUMP_OVER_BLOCKING_PERSON`, `AP_JUMP_OVER`; its path is set when the animation starts, as `EVENT_InitNewSoldierAnim` does) / the climb button's fence jump (`FindFenceJumpDirection`, `BeginSoldierClimbFence`, `GetAPsToJumpFence`) |
| `climbWindow {soldier}` | Stracciatella's Shift+J (`HandleTBClimbWindow`): through the open window the merc faces, `AP_JUMPFENCE`/`BP_JUMPFENCE`, then `TeleportSoldier` (no animation in Stracciatella either) |
| `drop`, `toss`, `door`, `useRemote`, `talk`, `give`, `leaveVehicle` | §11–§18; `estimateAttack` is a query (§28) |

**Turn-based play** (`10`, `10`; deviations "Turn-based UI lock", "Interrupt prompt"). Orders are accepted only on
our turn, with no attack resolving, no order queued as a game event and no other merc of ours acting. A gun attack
starts with a queued `beginFireWeapon` game event and the original UI locks after the click (`SetUIBusy`), so every
order and `endTurn` are refused while one is queued (`orderQueued`: advance first). `advance {idle}` returns when it is
our turn again and nobody of ours is acting, and also waits for bullets, queued game events and our soldiers' one-shot
animations (getting up, picking up, climbing). An interrupt in our favour stops `advance` with `decision`: only the
mercs that have not moved may act (`OK_INTERRUPT_MERC`); `endTurn` gives the turn back. An AI interrupt shows nothing
until `DisplayHiddenInterrupt`, then an `interrupt` event; a fully hidden one leaves no trace. The selected merc
(`turn.selected`, set by each accepted order, initially by `EnterCombatMode`) matters for
`StandardInterruptConditionsMet`, `EndInterrupt` and `CheckForMercContMove`.

## 11. Doors, containers and remote triggers

Rules: `35` (doors, locks, traps; deviation "Door menu"). `door {soldier, gridNo, action}`, `action` one of
`open`, `close`, `openManually`, `closeManually`, `unlock`, `lock`, `pickLock`, `force`, `crowbar`, `explode`,
`untrap`, `examine` (`src/sim/tactical/doors/door-command.ts`):

- The soldier walks next to the door (`FindAdjacentGridExAdvanced`), then interacts: `data {walking: true, to}` or
  `{started: <action>}`.
- `open` on a locked door answers `{opened: false, locked: true, options}`: the door menu as data, after the
  start-of-menu trap check (`{trapNoticed: true}` when the merc spots the trap instead); each option is `{action, ap,
  enabled, reason?}`. `openManually` is the menu's open button (`InteractWithClosedDoor(HANDLE_DOOR_OPEN)`): the merc
  finds the door locked (no AP) unless a trap goes off; the menu lists it first.
- `close` by our merc answers `{closed: false, options}` and `doorMenu {closing: true}`: vanilla's closing menu
  (`BtnDoorMenuCallback` with `fClosingDoor`), where only `closeManually` is enabled; `closeManually` closes at once
  without a trap check (deviation "Closing an open door"). Other soldiers close at once.
- The menu actions need a closed locked door; `lock` a closed unlocked door with a lock.
- Events: `doorMenu {soldier, gridNo, options, closing?}`, `doorResult {soldier, gridNo, action, result, trap?}`
  (`opened`, `closed`, `locked`, `failed`, `noLock`, `lockDamaged`, `chargeExploded`, `trapFound`, `noTrapFound`,
  `untrapped`, `trapSprung`, `notTrapped`, `wrongKey`, `trapStopped`, `trapNoticed`, `notEnoughAp`), `doorTrap
  {soldier, gridNo, trap}` (never for the silent alarm), `lockDestroyed {soldier, gridNo}`, `doorChanged`.
- View: `doors` lists the doors whose lock or trap the player knows (`locked: unknown|locked|unlocked|broken`, `trap:
  unknown|none|noneFound|<trap>`); own soldiers carry `keys` (key id, count, the key item as `item` and `index`,
  `LockTable[keyID].usKeyItem`, sector and day found); key items show `keyId`. Lock tables, trap levels and lock damage
  stay hidden.

**Containers and switches** (openable structures without a door) take `open` and `close`: the soldier walks next to
them (`FindAdjacentGridEx` with its door rule, `FindAdjacentGridExAdvanced` for a switch) and acts as
`HandleStructChangeFromGridNo` does: contents shown or hidden again, a switch fires the action items of its frequency,
the Drassen shipment check (`QUOTE_STUFF_MISSING_DRASSEN`) and `contentsExclaimed {soldier, sound: NOTHING|HUMM|COOL1}`
for the opener's battle sound, played 500 ms later; other actions refuse with `noDoor`. `openContainers` lists them; a
sector remembers which were open when it is left (`SaveBloodSmellAndRevealedStatesFromMapToTempFile`). The browser
plays the open and close sounds from the changes of `openContainers` (`GetStructureOpenSound`), except the silent close
of a Bobby Ray crate in the frame of its `shipmentDelivered` (`CloseCrate`).

**`useRemote {soldier}`** presses the remote trigger in hand: 2 AP, 2 more when standing. In O3's statue room it opens
the statue (`statueOpened {sector: 'O3', destroyed: false}` and an exit grid down to O3 b1, `26`); an explosion
next to the statue opens it too (`destroyed: true`). `data {result: statueOpened|nothing}`, `remoteUsed {soldier,
result}`.

## 12. Inventory, items, money and first aid

D15: everything the inventory panel, the item description box, the reload and medkit cursors and the money box do is a
command, on the original UI code paths (rules and costs: `12`, `12`, `12`, `12`). The API replaces only
the item cursor: a command picks an item up, puts it down and returns what is left in the cursor (a swap) the way the
original's cancel does (`CancelItemPointer`: the slot it came from, else a free pocket, else the feet; on the map
screen the sector inventory; deviation "Item cursor"). A placement runs on copies first, so a refused move changes
nothing. `count` is `1` (one object, `index` picks it: the stack popup) or `"all"` (shift-click, the default of
`moveItem` and `drop`).

| Command | Original | Exposure (costs in combat, notable refusals, events) |
|---|---|---|
| `moveItem {soldier, from, to, toSoldier?, count?, index?, merge?}` | `SMInvClickCallbackPrimary`, `UIHandleItemPlacement`, `PlaceObject` | Free inside one inventory. To another merc (`CheckForDisabledForGiveItem`): in sight within 3 tiles (2 when unconscious; for a merc below OK life any merc of ours within 2 tiles who sees him, deviation "Panel range for a dying merc"), both conscious mercs need 3 AP and pay 2; a swapped-out item stays with the receiver. Onto an item it attaches to: `useAttach`; onto one it merges with (`ValidMerge`): `mergePrompt`, then `merge: true` runs `AttachObject`, `merge: false` swaps. `to: "ground"` is `drop`. Ammo dropped on a gun reloads it (`ReloadGun`). A hand change plays `LOWER_RIFLE`/`RAISE_RIFLE` and resets burst mode, a face item re-runs sight. `noInventory` (escorts, vehicles), `nailsVest`; `itemMoved` |
| `drop {soldier, slot?, count?, index?}` | `SoldierDropItem` | Default the hand; `AP_PICKUP_ITEM`, `DROP_ITEM` when standing; `itemDropped` |
| `toss {soldier, slot?, count?, index?, gridNo, level?}` | `HandleItemPointerClick`'s toss | `THROW_ITEM`/`LOB_ITEM` (`CalculateLaunchItemParamsForThrow` without a miss), `AP_TOSS_ITEM` at the release; a merc of ours on the tile beyond passing range tries to catch it (`PreRandom(100)` against 50 + dexterity / 2 within one tile, `AutoPlaceObject`, else he is struck for one point and it falls). `tooClose` (drop instead), `passInstead` (`give` instead), `badThrow`, `cannotToss` (escorts, the unconscious, swimmers); `catchEnded`, `itemCaught` |
| `attach {soldier, item, to, toSoldier?, index?, count?, permanent?}` | `ItemDescAttachmentsCallbackPrimary`, `DoAttachment`, `AttachObject` | The description box of the item in `to` (also another merc's in passing range): needs `AP_RELOAD_GUN` left and spends it when the attachments change (deviation "Attachment AP"), `AP_MERGE` for merges other than kit or ammo points; the `ATTACHING_*` skill checks draw `PreRandom`; `index` is the stack object kit points pour into. `permanentAttachment` (repeat with `permanent: true`); `data.result` `attached`, `merged`, `destroyed`, `failedCheck`; `itemAttached` |
| `detach {soldier, slot, attachment, to?}` | `RemoveAttachment` | Needs `AP_RELOAD_GUN + AP_PICKUP_ITEM` left, spends `AP_RELOAD_GUN`; an under-barrel launcher takes its grenade along; `itemDetached` |
| `unload {soldier, slot?, to?}` | `EmptyWeaponMagazine` | Free; `gunUnloaded` |
| `reload {soldier, slot?, ammo?}` | `HandleUIReloading`, `AutoReload`, `ReloadGun` | Default the hand; without `ammo` the hand is the reload cursor (`FindAmmoToReload`, both pistols when affordable), another slot takes the best match; 5 AP, 10 for a magazine of another size, free in real time; `reloaded` |
| `swapHands {soldier}` | `SwapHandItems` | Free; not the robot; `handsSwapped` |
| `applyItem {soldier, slot, target?}` | `ApplyCamo`, `ApplyCanteen`, `ApplyElixir` | Canteen, camouflage kit, elixir on the soldier or a merc in passing range, paid by the target; drugs and alcohol `notPorted`; `itemApplied` |
| `bandage {soldier, target?}` | `HandleItem` (medkit), `EVENT_SoldierBeginFirstAid`, `SoldierDressWound`, `HandlePlayerServices` | A kit in the hand; walks up (`data.walking`) or starts (`data.started`); the medic dresses the wound each round and each 5 s real-time turn until a move, stance change or hand change of either ends it; `firstAidStarted`, `bandaged {life, bleeding}`, `firstAidDone`, `firstAidEnded`, `outOfBandages`, `firstAidRefused` (`PCDoesFirstAidOnNPC`). Auto-bandage is not ported |
| `combineStack {soldier, slot, from?, index?}` | Ctrl+click, `CleanUpStack` | Ammo, kits, medkits: the `from` stack's points (same item) pour into the slot's lower objects, then its own upper ones; free; `data.combined` false for other items |

Throwing a grenade needs no command: `moveItem` it to the hand, check with `estimateAttack`, `attack` the tile.

**Map screen** (strategic flow): `moveItem`, `attach`, `detach`, `unload`, `reload` and `swapHands` take no AP
(`MAPInvClickCallbackPrimary`) for every merc with an accessible inventory (`MapCharacterHasAccessibleInventory`: not
in transit, captured, an escort, a vehicle, the robot or below OK life; `inaccessible`); items pass between mercs of
one sector only (on the road: one squad or vehicle) and never while the loaded sector holds enemies
(`MapscreenCanPassItemToChar`: `otherSector`, `hostileSector`).

- **Sector inventory**: `moveItem {from: "ground", item: <stash index>, to, sector?}` and `moveItem {from, to:
  "ground", stashIndex?, sector?}` for a merc standing in that sector, not on the road (`notInSector`), not during a
  battle there (`CanPlayerUseSectorInventory`: `battleInSector`); only reachable items can be taken (`unreachable`); a
  stash slot takes up to `ubPerPocket` objects and swaps different items (`PlaceObjectInInventoryStash`).
- `discardItem {soldier, slot, count?, index?}` is the trash can (`TrashCanBtnCallback`, `itemDiscarded`; the
  mission-item warning has no counterpart).
- The query `inventory {sector?, z?, soldier?}` (§28) lists the stash (`IsMapScreenWorldItemVisibleInMapInventory`:
  visible, not trapped, no switches or action items; the loaded sector's items or the sector's saved items, with what
  was dropped on a retreat or delivered once a merc has seen it) and the mercs' inventories; leaving a sector and the
  query on the loaded sector recompute the reachable flag (`HandleAllReachAbleItemsInTheSector`).
- `applyItem` and `bandage` are `tacticalOnly`.

**Money.** The original moves money through the item cursor; the commands do the click and the drop at once:

| Command | Original | Rules |
|---|---|---|
| `withdrawCash {soldier, amount}` | the money region with an empty cursor; Done books `TRANSFER_FUNDS_TO_MERC` | Campaign, tactical; `amount` ≤ the balance and ≤ `MAX_MONEY_PER_SLOT` (20000); tops up the first money pocket below its limit, the rest auto-placed (`SKITryToAddInvToMercsInventory`), nothing changes when it does not fit; `cashWithdrawn`, `moneyChanged`; `data {amount, balance}` |
| `depositCash {soldier, slot, amount?}` | money in the cursor over the region; Yes books `MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT` | Campaign, tactical; `cashDeposited`, `moneyChanged` |
| `splitMoney {soldier, slot, amount, to, toSoldier?}` | the money box ($1000, $100, $10, Done), then the drop | Tactical (also the sandbox); into an empty pocket or a money pocket with room, of the merc or of one in passing range with `moveItem`'s rules and AP; `moneySplit` |

Escorts and non-merc bodies have no single merc panel (`noInventory`); the money commands are refused while a shop is
open (deviation "Shop as commands"). Money to another soldier is `give {money}` (§15), to a dealer `trade {cash}`
(§23).

## 13. Conversations

Rules: `24` (talk sessions, records, approaches). A conversation with a named NPC is a modal **talk session**
(`src/sim/campaign/talk-flow.ts`) over the NPC records (`state.npcRecords`, imported from native saves) and the
dialogue queue (`src/sim/narrative/`); deviations "Talk session time", "Conversation prompt".

- `talk {soldier, target}` (`target` a soldier id or `{npc}`): the original's checks in its order (`refusesToTalk` is
  Dimitri). Beyond 4 tiles the soldier walks up (`data {walking: true, to}`) and the talk starts on arrival during
  `advance` (a target that became invalid: `talkAborted`); otherwise the opening starts at once; 6 AP (`AP_TALK`). An
  own merc answers with a bark (`data.bark`, a `mercQuote`, no AP); an unnamed civilian, militiaman or enemy with a
  merc body with a civilian quote (§16).
- `approach {kind}`: `repeat`, `friendly`, `direct`, `threaten`, `recruit`, `whoAreYou`, `buySell` (dealers: an unused
  BUYSELL record, else the panel closes and the shop opens) or `give` (others: the panel closes, the NPC waits 10 s).
- `closeTalk {}`: Done or Esc with the once-per-conversation reset; with nothing queued it closes even while the NPC
  speaks and cuts his line (`HandleTalkingMenuEscape`, `DeleteTalkingMenu`); `busy` while lines are queued, a trigger
  waits or a conversation is pending.
- `skipLine {profile?, tick?, talkEnded?}`: §14.
- `openShop {dealer, soldier}` in campaigns with NPC records: the shop's checks (§23), then `talk` + `approach buySell`;
  `data` is the shop when it opens at once, else the talk reply, and the shop opens in the tick the opening lines end
  (`state.talk.shopAfterOpening`) unless the opening closed the panel or a BUYSELL record plays (deviation "Talking to
  dealers").

`talk`, `approach` and `answer` on an NPC request return at once with the talk reply `{conversation, pending?,
scriptedSequence?, shop?, npcRequest?}` (`pending: true` while lines are queued); the lines follow in game time (§14)
as `npcQuote` and `mercQuote` events, collected in `conversation.lastQuotes`. An open, idle session is modal (§5); one
an NPC opened (any `InitiateConversation` not caused by `talk` or `give`) is a decision (`initiatedBy: npc`). A
**scripted sequence** (`ENGAGED_IN_CONV` without a panel, a pending conversation, the 500 ms trigger wait) refuses
player commands with `scriptedSequence`; `advance` runs it until it ends or a panel or prompt opens. `save` is refused
with `conversation` throughout.

View: `conversation {npc, profile, name, talker, initiatedBy, menu, lastQuotes, busy, faceVariant}`, `menu` being
`repeat, friendly, direct, threaten, buySell:<dealer kind>|give, recruit, whoAreYou`, `busy` the simulation's queue
(`!dialogueIdle`), `faceVariant` Elliot's beaten big faces (`b135a`–`e`); `scriptedSequence`. Events:
`conversationOpened`, `conversationClosed {…, by: player|script}`, `npcQuote {profile, soldier, quote, record?,
textKey, chars}`, `mercQuote`, `npcMessage`, `scriptedSequence {active}`, `talkAborted`, `lineCut`. Hidden: facts,
quest states, records and their conditions, desire, approach values, opinions, the NPC's inventory and cash, balances
beyond what a message printed.

**Quote text.** The simulation carries only `textKey {file, row, width}` and `chars` (UTF-32 characters), never text:
not in state, saves, the input log or stored events. The session resolves keys to `text` in `observe`, command results
and events (§25). Quote events with keys: `npcQuote`, `mercQuote` (barks, the own-merc bark, contract quotes; merc
quotes also carry the speaker's `sector` for the comm popup), `civQuote`, `skyriderQuote` (with `profile`),
`headMinerQuote` and `shopkeeperQuote` (the dealer's lines from `npcdata/NNN.edt`, as `CharacterDialogue` reads them
for `DIALOGUE_SHOPKEEPER_UI`).

## 14. Conversations in game time

As in the original (`HandleDialogue`: `PauseGame` and `LockPauseState(LOCK_PAUSE_ENGAGED_IN_CONV)` while
`ENGAGED_IN_CONV` is set; `24`), a conversation stops the world clock and AI decisions while the tactical frame
goes on: ordered walks, animations and the dialogue queue, which says the next line when the face stops talking (end
of voice or text) or at once on a click or Backspace. The lines take ticks like any other time (`24`).

- **Commands return at once.** `talk`, `approach`, `answer` on an NPC request, `unescort` in tactical, `give` and
  `openShop` do their step and return; the following ticks say the lines (tactical ticks, world clock paused, AI
  frozen): the real-time driver's while a player watches, so an NPC that walks off after its last line (Fatima with
  Enrico's letter) starts when the player sees the line end; `advance` for an agent, which stops with `decision` once
  the panel waits for a choice.
- **A line lasts the longer of its voice and its text, then 300 ms.** The original times a line by its sample with
  speech on and 60 ms per character without (`SetFaceTalking`, `HandleTalkingAutoFace`), then keeps the mouth closed
  300 ms (`SetupFinalTalkingDelay`). Speech is a viewer option and one simulation serves every viewer, so a line holds
  the queue for the longer of the two (`voicedLineTicks`, `lineTicks`: 12 ticks per character) plus 60 ticks; voice
  lengths come from the rule pack (`04` §5.10; `SpeechLengths`, `speechPathForLine` with the Russian `r_` of a
  recruited R.P.C.). In the original data 71% of the NPC samples and 65% of the merc samples outlast 60 ms per
  character (by 0.8 s and 0.5 s at the median): the text length alone would leave a listening player behind.
- **The viewer that finished moves the line on.** The client sends `skipLine {profile, tick, talkEnded: true}` when it
  finished saying a line (its voice, or its text with speech off or a sample that cannot play): only the final 300 ms
  remain (`finishTalking`). A cut by the player (a click after 500 ms, Backspace, Esc with nothing queued) sends
  `skipLine {profile, tick}` and the face stops at once (`InternalShutupaYoFace`). With `profile` and `tick` (of the
  quote event) only that line is cut, so a late skip does not cut the next one (`data.skipped` false). `skipLine` is
  logged like any command; with several viewers the first to finish moves the line on.
- **Every viewer follows the cut**: `lineCut {profile, saidAt, tail}` reaches every client (`tail`: a voice that ended
  elsewhere, which only closes the mouth of a line timed by its text), so one viewer's click, an agent's `skipLine` and
  `closeTalk` cut the line on every screen. The menu greys out by the simulation's queue (`conversation.busy`), as
  `RenderTalkingMenu` shades it while the face talks or the queue is not empty. When the latest view no longer holds an
  NPC request, another viewer or an agent answered it and the box closes.
- **Agents playing alone**: `speech: 'skip'` (§27) ends every line on the tick after it is said.

## 15. Giving, recruiting, escorts and the robot

Rules: `24` (giving), `24` (recruiting, escorts), `25` (escorts, the robot).
`src/sim/campaign/give-flow.ts`, `talk-flow.ts`, `robot-control.ts`.

**`give {soldier, target, slot, count?}` or `{soldier, target, money, slot?}`** (campaign, tactical) is the drag of an
item onto a soldier: `slot` hands over the whole pocket, or one item of a stack with `count: 1` (other counts refused);
`money` splits that amount off a money pocket (default the first holding enough) in the money box's steps of 10.

- Inside a conversation with a non-dealer it is the menu's Give (the panel closes, the NPC waits 10 s); refused with
  a dealer (`isADealer`).
- Returns `{walking: true, to}` or `{giving: true}`; the walk and the give animation run during `advance` (the walk
  plus 1 AP to start, 3 to hand over).
- To an NPC the game is paused and locked meanwhile (a scripted sequence) and the NPC's `GIVINGITEM` conversation
  decides: he keeps it (`npcTookItem`), refuses it (`itemReturned`, dropped VISIBLE at the giver's tile when the
  pockets are full, deviation "Returned items"), plays a dealer's BUYSELL record or opens the shop (deviation "Giving to
  a dealer"); `giveAborted` when the target left its tile.
- To a squad mate or a recruited R.P.C. the whole source pocket is emptied even when one item was given, as in the
  original.
- Notable refusals: `giverCannotGive` (an escort, below OKLIFE, deep water), `giverBusy` (deviation "Give command"),
  `robotReload` (reloading the robot is not ported).
- Events: `itemGiven {soldier, target, item, count, status, money?, dropped}`, `npcTookItem`, `itemReturned`,
  `npcGaveItem {npc, profile, to, item, …, dropped}`, `giveAborted {soldier, target, reason, dropped}`, `npcMessage`
  (`itemPlacedOnGround`, `paidInFull`, `stillOwed`, `balanceOwed`, `needsMoney`); quest action items add `sexScene
  {soldier}` and `alarm {gridNo, kind: kingpin|museum}`.

**Recruiting** has no command: `approach recruit` runs the NPC's records; the pay requestor opens `npcRequest {request:
hire, amount}` (the daily salary, after Conrad's reduction) and an escort record `npcRequest {request: escort, pair?}`;
`answer yes` triggers the recruiting record. The NPC's civilian soldier is replaced by a new soldier id on our team
(`ChangeSoldierTeam`) on the same tile, joining the current squad (else any): an R.P.C. (`kind: rpc`, paid at 00:00,
§22) or an escort (`kind: epc`, John and Mary together; no contract; `loneEPC`/`abandonEPC` at map edges,
`escortAlone` for strategic moves, `escortCannot` at doors). Events: `npcRecruited {profile, soldier, kind, salary}`
(`salary` 0 for escorts), `npcMessage` kinds `recruited`, `nowEscorted` (`amount` the squad number), `teamFull`, the
history line `RPC_JOINED_TEAM`.

**`unescort {soldier}`** (the assignment menu's "remove escort", deviation "Releasing an escort"): on the map screen the
escort (and John's or Mary's partner) says his first `EPC_IN_WRONG_SECTOR` line and becomes a civilian at once where he
stands, `data {released: [{profile, quote}], lines}`; in the loaded sector only that record is triggered and decides,
`data` the talk reply plus `triggered`; `notInSector` asks to release him from the map screen. Event `epcReleased
{profile, soldier}` (the new civilian's id in the loaded sector, else null).

**The robot** takes orders only while a conscious non-escort of its squad (or vehicle) in its sector wears the robot
remote control in a head slot; without one every order is refused with `uncontrolledRobot`, `route` with `robotAlone`.
`route` also refuses `cannotLeaveSector` (Maria in C5). Hidden: opinions, profile flags, the remote holder, the
records.

## 16. NPC actions and requests, civilians, surrender and boxing

**NPC actions** (`35`, `src/sim/tactical/narrative/npc-actions/`) have no command; their effects show where they
always do (lines, `questStarted`, `historyAdded`, mails, the shop, soldiers in sight). A requestor action (`35`)
closes the panel and opens an **NPC request** (deviation "NPC requestors"): `npcRequest {id, kind: npcRequest, request,
npc, name, merc?, amount?, pair?, choices}`, also in the reply that opened it, `request` one of `escort` (`pair` for
John and Mary), `hire` (`amount` the salary), `boxingBet`, `fightAgain`, `buyVest` (`amount` the price), `payDoctor`
(`amount` the shown cost), `freeTreatment`, `buyVehicle` (`amount` 10000), `spareKrott`, `marryDaryl` (`merc` the
asking merc's profile), `lie`. The answer runs the original's callback, then the queue as `talk` does: `data
{conversation, lines, scriptedSequence?, shop?, npcRequest?}`. The request is campaign state; the clock and ticks stand
still while it is open (§5). Events: `npcRequest`; `npcMessage` kinds `teamFull`, `recruited`, `nowEscorted`,
`balanceOwed` (action 119), `itemPlacedOnGround`, `vehicleRefuelled`; `npcGaveItem`; `terroristRevealed {npc}`,
`townDiscovered {town}`, `sexScene {npc}`, `boxingBell`. Hidden: facts, the hospital modifier and refund, Kingpin's
balance, the NPC system events.

**Civilian quotes** (`24`, `src/sim/narrative/civ-quotes.ts`). `talk` to an unnamed civilian, a militiaman or a
visible enemy with a merc body (`talkable: civilian`) runs the conversation's checks, walk-up and AP but opens no
panel: `data.civQuote {soldier, quote, entry, hint, textKey, text?} | null` within 4 tiles (null when the line has no
text), after a walk-up a `civQuote {soldier, quote, entry, hint, textKey, chars}` event; `quote` is the civilian quote
type (`99` a hint, which may start a quest), `entry` the row; a second `talk` barks again (deviation "Civilian quote
boxes").

**The enemy surrender offer** (`24`): the enemy barks quote 37 and a `surrender` prompt opens (`context:
tactical`, `soldier`; `surrenderOffered {soldier, prompt}`); `accept` captures every living merc in the sector
(`mercCaptured`) and loses the battle (`battleResult` defeat; deviation "Surrender in tactical combat"), `data
{surrendered}`. Sandbox sessions decline it at once.

**NPCs on their own** (`24`: approaching NPCs, assassins, first sightings, hostile declarations, guides describing
sectors) and **schedules** (`35`) have no command, prompt or view field: their lines arrive as the events of §13, a
civilian off the map is missing from `soldiers`, door use arrives as `doorChanged`. Profile NPCs' whereabouts,
`npcData`, balances and the 04:00 moves are never shown (`npcMoved` is not an event).

**Boxing** (`25`, the San Mona club) is played with `talk`, `answer` (`boxingBet`, `fightAgain`), `give`, `move`
into the ring and `attack` with empty hands or brass knuckles. While our boxer walks out after the round every command
but `estimateAttack`, `answer` and `skipLine` is refused with `boxingUiLock` and the session is not idle, so `advance
{idle}` runs the walk (deviation "Boxing UI lock"); `mapScreen` is refused with `boxingInProgress` while a boxing state
is set unless it carries `abandonFight: true` (deviation "Abandoning a fight"). View: `boxing {state:
waitingForPlayer|preBoxing|boxing|disqualified|wonRound|lostRound, boxers, uiLocked}` or null (`boxers`: the soldiers
in sight with the boxer flag). Events: `boxingBell`, `boxingState {state, previous}`, `boxerPicked {soldier, slot}`,
`boxingRoundOver {loser, result}`, `boxerDisqualified {soldier, reason: outOfRing|nonBoxerInRing|badAttack}`,
`boxingEnded {soldier, result: won|lost|disqualified|null}`, `combatEnded {reason: boxing}`, the history lines
`WON_BOXING`, `LOST_BOXING`, `DISQUALIFIED_BOXING`. Hidden: the boxer tiles, fought flags, rests, bonuses, facts.

## 17. Strategic map, travel and squads

Rules: `16` (map, movement, sector entry and exit), `17` (the Queen), `15` (time). Commands of the strategic flow
unless noted.

| Command | Original | Rules |
|---|---|---|
| `route {soldier, to, via?, shortest?, extend?}` | `PlotPathForCharacter` per leg, copied to the squad or vehicle, `RebuildWayPointsForGroupPath` | `CanEntireMovementGroupMercIsInMove` first (so the squad cannot leave the start sector before it is cleared); each leg from the last sector of the path so far; `shortest` is the Shift mode of `FindStratPath` (every edge 60 minutes); `extend` appends like the map screen's plotting, otherwise the path is replaced (cancel, then plot); `data {path, etaMinutes}` (sector names); `badSector` for a leg the cursor cannot plot to, `cannotLeaveSector` for Maria in C5 |
| `cancelRoute {soldier}` | `CancelPathForCharacter` | Reverses a moving group (`16`) |
| `shortenRoute {soldier, at}` | `ClearPathAfterThisSectorForCharacter` | Keeps the path to the last time it passes `at`; `at` the merc's sector cancels it; `noRoute` when nothing shortens; `data.edit` `shortened` or `cleared` |
| `routeGroup {soldiers, squads?, vehicles?, to, via?, shortest?}` | the move box: `SetUpMovingListsForSector`, `HandleMoveoutOfSectorMovementTroops`, `CopyPathToAllSelectedCharacters` | The listed mercs of one sector move; `squads` and `vehicles` are the box's unit lines (default: units whose movable members are all listed). Mercs parting from their unit join a squad of the sector doing the same (`FindSquadThatSoldierCanJoin`) or a new one (a failed join toggles the merc as the original does), on this command rather than at Done; the first mover plots, those who cannot travel with him are left out (`DeselectSelectedListMercsWhoCantMoveWithThisGuy`); `data {groups, regrouped}`; `reassignOnTheMove` (`pMapErrorString[41]`) |
| `assignSquad {soldier, squad: 0..19 \| 'new' \| 'any'}` | `AddCharacterToSquad`, `…UniqueSquad`, `…AnySquad` | |
| `enterSector {sector}` (any flow) | `AllowedToExitFromMapscreenTo(TACTICAL)`, `SetCurrentWorldSector` | Loads a sector where mercs stand, automatic placement (deviation "Tactical placement"); refused while a decision is pending or a battle runs elsewhere |
| `exitSector {soldier, direction? \| exitGrid?, who: squad\|merc, load?}` (tactical) | `OKForSectorExit`, the exit menu table, `JumpIntoAdjacentSector` | `soldier` plays the selected merc; `load` defaults to the menu default; `tooFar`, `invalidTraversal`, `loneEPC`, `abandonEPC`, `squadNotAllowed`, `mercNotAllowed`, `loadDisabled`, `uncontrolledRobot` (deviation "Exit dialog"); `dryRun: true` makes it a query (§28) |

No "exit tactical" command: the strategic view is always observable; a sector is left by `exitSector` or by routing
everyone away. The strategic prompts `simultaneousArrival` and `npcOfNote` are in §5; the original's informational
boxes before a pre-battle panel are events (deviation "Strategic prompts"). Events: `groupArrived`, `sectorLoaded`,
`sectorUnloaded`, `mercsLeftSector`, `sectorControlChanged`, `invasion` (§8), `compressionStopped`.

**`clock` and `strategic` views** (`src/server/strategic-view.ts`, `map-screen-view.ts`; nothing the original map screen
does not show):

- **Clock**: adds `mode` (`giTimeCompressMode`: 0 stopped, 1 normal, 2/3/4 = 5/30/60 minutes per second), `paused`
  (`gfGamePaused`, the automatic pause included), `playerPaused`, `pauseLocked`, `canCompress` and `compressRefusal`
  (`AllowedToTimeCompress` as the map screen asks it, the token `TellPlayerWhyHeCantCompressTime` picks); the client's
  own reasons (an open menu, plotting, a held item) stay in the client.
- **Sectors**: `enemies` by the player's knowledge (`WhatPlayerKnowsAboutEnemiesInSector`,
  `Strategic/Map_Screen_Interface_Map.cc:3511-3562`; the rule is `16`): a count, presence only, or nothing;
  nothing underground and nothing while the game has just started. `enemiesKnown` gives the town box's "0" against
  "Unknown"; `playerControlled` shows for town and found SAM sectors (`AddCommonInfoToBox`); `items` is
  `uiNumberOfWorldItemsInTempFileThatCanBeSeenByPlayer` (also underground), `militiaTraining`
  `ubMilitiaTrainingPercentDone`, `facilities` the town sectors' flags (they change when Tixa's prison or the gun range
  is found).
- **Economy and places**: `balance`, `townControl` (`GetTownSectorsUnderControl × 100 / GetTownSectorSize`), `towns`,
  `mines` (§19), `projectedDailyIncome` (`GetProjectedTotalDailyIncome`), `secretsFound` (`IsSecretFoundAt`),
  `underground` (visited levels below ground), `enemyAirspace`.
- **Mercs**: what the map screen's list and info panel print: `idle` (`fDoneAssignmentAndNothingToDoFlag`),
  `trainStat`, `repairVehicle`/`repairRobot`, `canChangeSleep` (`CanChangeSleepStatusForSoldier`), `salary`
  (`DrawCharacterInfo`'s daily cost: by `bTypeOfLastContract` for A.I.M. mercs, `sSalary` otherwise), contract fields
  (§22), `arrival` in transit.
- **Groups**: ours only (`etaMinutes` from `CalculateTravelTimeOfGroup`, `nextArrivalMinutes`, `traverseMinutes` for
  the current leg); enemy groups appear only through `enemies`.
- **Flags**: `gameJustStarted` (`fDidGameJustStart`, from the new campaign to the first arrival of a hired merc; it
  picks the map screen's "not in Arulco yet" help), `battleLocator` (§20), `landingZone`, `unreadMail`, `newMail`,
  `quests`, `meanwhiles`.

The Queen's state is never shown: no garrisons, compositions, class split, group routes, intentions, pool, awake flag,
alertness or event queue (her evaluations, enemy arrivals, creature attacks, NPC timers, scheduled meanwhiles). Seen
enemy soldiers in tactical may show their class (the uniform colours make it visible). The player learns of her
decisions only where the original tells him: invasion and encounter prompts, "enemy took control of …", meanwhile
scenes and Skyrider's sightings.

## 18. Vehicles and the helicopter

Rules: `25` (Skyrider, billing, SAM hits, hovering), `16` (vehicle movement). The helicopter exists once the
escorted Skyrider reaches his chopper in B13 or a native save owns it (`src/sim/campaign/helicopter-flow.ts`; deviation
"Helicopter interface"). Map screen only (`mapScreenOnly` elsewhere):

- `heliPlot`: the click on the helicopter before plotting (`RequestGiveSkyriderNewDestination`): Skyrider says hi and
  `FACT_SKYRIDER_USED_IN_MAPSCREEN` is set, or the refusal says why he cannot fly (`ExplainWhySkyriderCantFly`);
  `emptyHelicopterHint` (`pSkyriderText[2]`) once while the helicopter is empty and mercs stand in its sector
  (`gfSkyriderEmptyHelpGiven`, saved; asking again flies it).
- `heliRoute {to, via?, extend?, plotted?}` (`PlotPathForHelicopter`) plots, confirms and takes off, `data {path,
  etaMinutes}`; without `plotted` it asks Skyrider first like `heliPlot`. `shortenHeliRoute {at}`
  (`ClearPathAfterThisSectorForHelicopter`), `heliCancel` (a flying helicopter turns back). `route`, `cancelRoute` and
  `shortenRoute` for a merc aboard act on the helicopter after the squad's move check. `grounded`: on the ground in an
  enemy-held sector; `skyriderUnwilling`: a disloyal Drassen.
- `boardVehicle {soldier, vehicle: <id> | 'helicopter'}` (`PutSoldierInVehicle`, `CanCharacterVehicle`; `data.seat`):
  the vehicle must stand in the merc's sector; `notAllowed` for a hummer or ice-cream truck the quests have not
  released, plus the flight refusals and the assignment conditions.
- `leaveVehicle {soldier, squad?}` (also tactical) puts a passenger on a squad (default the first empty one) in the
  vehicle's sector; it, `assignSquad` and `assign` to a squad are refused while the helicopter flies or returns
  (deviation "Leaving the helicopter in flight").

Events: `helicopterSetUp`, `skyriderQuote {quote}`, `heliTakeOff`, `heliArrived {sector, hostile}`, `heliHovering
{sector, stage: started|long|tooLong}`, `heliReturning {to, safe}`, `heliLanded`, `heliHit {sector, hits}`,
`heliDestroyed {sector, killed}`, `heliPaid {amount, balance}`, `heliOwed {amount}`, `heliEmptyHint`,
`enemiesSpottedFromAir`, `samSitesRevealed {sites}`, `skyriderMonologue {topic:
drassenSam|cambriaHospital|otherSams|estoniRefuel}`, `passengersDropped {sector, soldiers, squad}`, `vehicleBoarded`,
`vehicleLeft`; hits, arrivals, hovering warnings, the return and debts stop compression. View: `vehicles` (position,
passengers, seats, path, `usable`; the server does not fill the typed `life`, `lifeMax`, `fuel`) and, once set up,
`helicopter {…, canFly, reason?, owed, hits, path, etaMinutes, safeSectors, unsafeSectors, routeCost, refuelSites,
progress}` (`progress` the float ratio `DisplayPositionOfHelicopter` places the icon by; `{destroyed: true}` after it
was shot down); mercs aboard carry `vehicle`. Skyrider's balance shows only as the debt; his talk state and accumulated
bill stay hidden.

## 19. Towns, militia, mines and assignments

Rules: `18`. Strategic commands, refused in turn-based combat:

- `assign {soldiers, to}`, `to.kind` one of `squad`, `doctor`, `patient`, `repair` (items, the robot or a vehicle),
  `trainSelf`, `trainTeammate`, `trainByOther` (with `stat`), `trainMilitia`: `SetAssignmentForList` per soldier in the
  given order, each checked on its own; `data` the per-soldier results, `reason` the first failure (the original shows
  one failure box for the batch).
- `sleep {soldier}`, `wake {soldier}` (`SetMercAsleep`, `SetMercAwake` with their checks); waking a tired merc forces
  him to stay awake.
- **Militia training asks before it charges**: `assign trainMilitia` returns `militia: 'pending'` and opens
  `militiaPayment {trainer, sectors, cost, balance}`; a finished session asks `militiaContinue {trainer, sector, cost,
  balance}`; `answer yes|no` gives `data.outcome` `paid`, `continued`, `declined` or `cannotAfford` (an unaffordable
  cost resets the trainers; deviation "Militia payment and continue prompts").
- `moveMilitia {from, to, rank: green|regular|elite, count}` (`PickUpATownPersonFromSector`, `DropAPersonInASector`,
  `HandleMilitiaRedistributionClick`): one town, both sectors ours and free of hostiles, at most 20 per sector, all or
  nothing; a change in the loaded sector re-places its militia on the next tactical entry
  (`gfStrategicMilitiaChangesMade`).
- `distributeMilitia {town}`: the AUTO button (`HandleEveningOutOfTroopsAmongstSectors`, `CanMilitiaAutoDistribute`),
  which, as in the original, deals out the militia of a sector with hostiles while they also stay there (`18`).

Events (those the original pairs with `StopTimeCompression` or a box stop a strategic `advance`): `assignmentDone
{soldier, sayQuote}`, `assignmentAborted {soldier, reason: noMedkits|insufficientDoctorSkill|noToolkits|
insufficientRepairSkill}`, `fellAsleep`, `wokeUp`, `tiredComplaint`, `itemRepaired`, `gunUnjammed`, `statChanged`,
`militiaTrained {sector, trained}`, `militiaPromoted`, `militiaDefected {sector, removed}`, `militiaTrainingRejected
{soldiers, reason}`, `militiaPrompt`, `loyaltyChanged` (only towns the player sees), `mineIncome`, `mineRunningOut`,
`mineEmpty`, `mineShutDown`, `mineReopened`, `headMinerQuote`, `moneyChanged {code, amount, balance}`,
`civiliansEaten`. Compression is also refused while a group sits in a creature-infested mine or bloodcats attack. The
sleep/wake notification is a client setting: an agent that wants the original's stop passes `fellAsleep` and `wokeUp`
in `advance {until: {events}}`.

View: mercs' assignment, `trainStat`, repair target, `idle`, `canChangeSleep` (§17); `towns [{town, loyalty}]`
(loyalty only once started and where the town uses it); sectors' militia and `militiaTraining`; `mines [{mine, sector,
town, status, ore, playerControls, predictedDailyIncome, maxDailyRemoval, maxPeriodicRemoval}]` (status in the town
box's order: abandoned, shut down, running out, producing; never the remaining ore or which mine will deplete);
`projectedDailyIncome`. The hint `assignmentOptions` (§28) shades the assignment menu.

## 20. Battles: pre-battle, autoresolve and retreat

Rules: `19`. Nothing is shown that the original panels do not show (D16).

**The `preBattle` prompt** (`src/sim/campaign/pre-battle-panel.ts`; deviation "Pre-battle interface"): `{id, kind,
sector, persistent, encounter, enemies: number | 'unknown', militia, involved, uninvolved, options [{choice, enabled,
reason?}], involvedGroups}`; involved mercs carry the assignment number, the non-persistent prompt's `encounter` is the
explicit code, `enemies` follows `19`. Time stays frozen until `answer`: `autoresolve`, `enterSector` (the sector
loads with automatic placement), `retreat`, `close` (non-persistent only). `involvedGroups` > 1 selects the plural
retreat help; per uninvolved merc `betweenSectors`, `departure` (minutes to the contract end for A.I.M. mercs and Slay,
capped at the contract length in transit; null prints "N/A") and `destination` (`GetMapscreenMercDestinationString`:
the arrival sector in transit, the last sector of the path whenever there is one, else the group's next sector).
Saving is refused while it is open (`promptOpen`), as the original disables the options button.

- **Automatic starts** (`19`) open no prompt: `preBattle {autoStart: true, panel {sector, enemies, militia,
  involved, uninvolved, involvedGroups}}` (computed before the battle starts, for the panel shown with Autoresolve
  pressed, `ActivateAutomaticAutoResolveStart`) and autoresolve begins at once.
- **`showBattle {}`** opens the non-persistent panel (deviation "Non-persistent pre-battle interface") where the
  original calls `InitPreBattleInterface(0, false)`: a click on the battle sector while the locator is on, or a
  compression attempt during a tactical battle. Accepted on the map screen with a loaded sector when the locator is on
  or a battle runs there; it runs `initPreBattleInterface(…, false)` with the original's side effects (the wake-up).
  Refusals `noBattle`, `onlyHostileCivilians` (`OnlyHostileCivsInSector`, `STR_LATE_27`, `data.sector`), `promptOpen`.
  `close` is Esc (`gpBattleGroup` cleared), `enterSector` returns to the loaded sector without placement, `autoresolve`
  is `EnterAutoResolveMode` (refused under the explicit codes that forbid it). The strategic view's `battleLocator` (the
  red locator, `gfBlitBattleSectorLocator`, `gubPBSector`) is present only while it is on.
- **`autoresolveBattle {}`** autoresolves a tactical battle in progress, when the explicit code allows it.

**Autoresolve as a flow** (deviation "Autoresolve session"): world time is frozen; `advance` runs slices of 1000 battle
ms = 200 ticks: `{idle}` to the end or a prompt, `{ticks: n}` `floor(n/200)` slices (so a real-time driver paces it),
`{events}` stops after the slice in which one happened. Under the instant driver `answer autoresolve` runs to the first
stop at once. `autoresolveRetreat {soldier}` (one merc; not the robot or a retreating cell) and `autoresolveRetreat {}`
(all) apply before the next slice while the battle is in progress and no surrender is pending. Prompts: `surrender
{context: autoresolve}`; `autoresolveDone {status, canBandage, choices, bandageRefusal}` (`nobodyWounded`, `noDoctor`,
`noKit` or null, in `DetermineBandageButtonState`'s order): `bandage` answers `data.bandaged` `complete` or
`incomplete` (the `STR_LATE_13` or `STR_LATE_10` box) and re-opens the prompt, `done` returns to the strategic flow.

`observe.autoresolve` shows the screen: per cell side, kind (merc name and `profile`, militia rank, enemy class,
creature type), state, mercs' bars, militia's and enemies' health category (`bHealthStrRanges`, `19`), `female` (the
generic faces), counts alive, battle time, status, `encounter`; never ratings, timers, pending bullets, exact enemy life
or the capture roll. Events: `arStarted {sector, mercs, militia, enemies}`; per slice, with `battleMs`, `arAttack
{attacker, target, kind: shot|spit|claw|knife|punch, weapon?, reloaded?}` (`reloaded`: the shot followed an
`AutoReload`), `arHit {target, damage?, life?, health?, melee?}` (mercs: damage and life; others: the health category),
`arMiss`, `arFell`, `arDied {cell, killer, splat?}` (`splat`: a bullet took a non-creature below −60), `arRetreated`,
`arSound`, `arSurrenderOffered`, `arBattleOver {status}`; after `done` `arSummary {sector, status, battleSeconds,
worldSecondsWarped, mercs {died, captured, wounded}, militia {died, promoted}, enemiesKilled, sectorControl,
itemsDropped}`. The cosmetic fields draw nothing. Around every battle: `preBattle {sector, encounter, persistent,
autoStart, prompt, panel?}`, `retreated {sector, groups, via: preBattle|autoresolve}`, `battleResult {sector, result:
victory|defeat, via: tactical|autoresolve}`, `sectorControlChanged`, `mercCaptured`. The game page paces a battle with
the driver (Play: real time at `ubTimeModifierPercentage`; Fast: speed 4; Finish: one `advance {idle}`; Pause: manual).

## 21. Laptop and hiring

Rules: `21`. The laptop is a modal flow (deviation "Laptop as commands"): a new game starts in it (day 1,
01:00); `openLaptop` opens it from the map screen (`laptopOpen`, `mapScreenOnly`, `promptOpen`, `battlePending`,
`renewalSequence`); while it is open the clock stands still (§5); laptop commands while closed answer `laptopClosed`.
`setLandingZone {sector}` works on the map screen after the first landing (`badSector`, `beforeFirstLanding`,
`groundBarrier`, `enemyAirspace`). Commands (`src/sim/campaign/laptop/`):

| Command | Data | Refusals |
|---|---|---|
| `closeLaptop` | clears `newMail` | |
| `visitSite {site: bobbyRay\|merc\|funeral\|florist\|insurance\|floristOrderForm}` | what entering the page does: Bobby Ray's under-construction visit (gates its "now open" mail), the funeral, florist and insurance bookmarks, the M.E.R.C. visit counter and Speck's opening once per laptop session (`{site, bookmarks, speck?}`, the ordered quote ids; without visits the first M.E.R.C. command of a session runs it); `floristOrderForm` adds `Random(5) + 1` to the saved order number on the main stream (`EnterFloristOrderForm`, `orderNumber`) | `badSite`, `noBookmark`, `siteDown` |
| `readEmail {id}`, `deleteEmail {id}` | reading the I.M.P. intro bookmarks I.M.P., Speck's intro M.E.R.C. | `noSuchMail` |
| `aimHire {profile, contract: 1\|7\|14, gear?}` | charge, soldier id, `arrival {minute, shownMinute, sector}`, `quote {id, name}` or null | `notAimMerc`, `badContract`, `noKit`, `unavailable`, `away`, `hangover`, `hatesTeammate {hated}`, `deathRate`, `reputation` (these with `quote`), `funds {charge}`, `teamFull`, `cannotHire` |
| `aimLeaveMessage {profile}` | the answering machine's `PLAYER_LEFT_MSG` | `notAway`, `alreadyLeft` |
| `mercOpenAccount` | `{accountNumber, quotes: [9]}` | `siteDown`, `noBookmark`, `hasAccount` |
| `mercHire {profile}` | adds `quotes`: the cross-sell quotes of the merc's listing for related mercs still available (`ShouldSpeckSayAQuote`), then 69 or 70 by a main-stream `CoinToss` (deviation "Speck's opening") | `noAccount`, `accountSuspended` (`quotes: [14]`), `accountInvalid`, `notListed`, `unavailable` (a living merc: `[71]`), `teamFull`, `cannotHire`, `siteDown`, `noBookmark` |
| `mercPay` | `{paid, full, quotes}`: 45 full, 46 partial | `nothingOwed`, `funds`, `siteDown`, `noBookmark` |
| `impCreate {code, name, nickname?, gender, answers[16], attributes, portrait, voice}` | soldier, profile, skills, personality, attitude, arrival | `noBookmark`, `badCode`, `noSlot`, `funds`, `teamFull`, `badName`, `badAnswers`, `badSkills`, `badAttributes`, `badPortrait`, `badVoice`, `cannotHire` |
| `bobbyRayOrder {lines: [{item, used?, quantity}], destination, speed: 0\|1\|2}` | atomic, also a visit; the quote and the shipment index. Speed 0 overnight express, 1 two business days, 2 standard service (`CalculateOrderDelay`, `src/protocol/bobby-ray.ts`) | `siteClosed`, `noLines`, `tooManyLines`, `notInStock`, `noDestination`, `badSpeed`, `funds` (with the quote) |
| `insure {soldier}` | `{length, cost, insuredDays}` | `notInsurable`, `funds` (with `{cost, length}`) |
| `orderFlowers {bouquet: 0–9, destination, nextDay, extras}` | charges the bouquet price (`flowerdesc.edt`'s price column, `sscanf("%hu")`) with extras and delivery, no balance check; `{price, orderNumber}`, then `1 + Random(2)` more after the charge and the Meduna meanwhile; ordering without entering the form skips the first draw (deviation "Florist order form entry") | `noSuchBouquet`, `noDestination`, `badExtra` |
| `readFile {code}` | sets the saved read flag (`DisplayFormattedText`), nothing else | `noSuchFile` |

Queries (§28):

- `aimQuote {profile, contract, gear}` (`contract` defaults to 7).
- `hireCheck {profile}`: the conference's HIRE check before any money: `{profile, contact, accepted, refusal?, quote:
  {id, name} | null, hated?}`; `refusal` `unavailable` or `away` from the contact mode, else `CanMercBeHired`'s; quote
  ids of `Dialogue_Control.h`: 82, 86/87/88, 81, 80, on acceptance 92/93/94 or 113/114.
- `impCheckCode {code}` → `{result: ok | badCode | noSlot}`: the code first, then `CanCreateAnotherIMPCharacter`.
- `bobbyRayQuote {lines, destination?, speed}`: the order form: shipping 0 without a destination or with −1,
  `affordable`, `confirmDestination` (the accept button's question for every city but the primary airport, and for that
  airport while the enemy holds it).
- `insuranceQuote {soldier}`; `impPreview {answers, gender}` (no draws); `arrivalTime` (`GetMercArrivalTimeOfDay`).
- `emailText {id}`, answered by the server's campaign adapter (`src/server/campaign-session.ts`, `mail-text.ts`), not
  the simulation: `{id, subject, paragraphs}` with the original's substitutions and the I.M.P. report assembled from
  `impass.edt`, Ian codes kept; `noSuchMail`, `noText`.

Hired mercs are `IN_TRANSIT` until the 07:30, 13:30 or 19:30 flight lands them in the landing zone. Events:
`laptopOpened`, `laptopClosed`, `mercHired {site, profile, soldier, arrivalMinute, sector}`, `mercArrived` (stops
compression), `arrivalRerouted`, `landingZoneReset`, `emailReceived {id, mail, sender}`, `historyAdded {code, profile,
sector}`, `moneyChanged`, `mercAccountStatus`, `bobbyRayOpen`, `shipmentDelivered {shipment, sector, items, stolen}`
(stops compression), `shipmentLost {shipment, reason: crashed|prevented|enemyHeld}`, `insurancePaid`. Silent profile
changes (a merc back home, away, dead elsewhere, the M.E.R.C. outage) raise no event; they show in the view.

**`laptop` view** (only while open; `src/server/laptop-view.ts`): what the pages print.

- `newMail` is the saved `fNewMailFlag` (set by every mail, cleared by `closeLaptop`; also in the strategic view).
- History rows carry `text` (`ProcessHistoryTransactionString` in the session's language; quest rows are rows 2q and
  2q + 1 of `binarydata/quests.edt`; codes without text give ""), `location` (`pHistoryLocations` without a sector, else
  the full `GetSectorIDString` of `src/server/sector-id-label.ts`, shared with the finance rows) and
  `questInProgress`; finance rows carry `text` and the view `financeSummary` (`21`).
- `personnel` (`src/server/personnel-view.ts`) holds `current` (team members without vehicles in team order, dead ones
  included, `CFOR_EACH_PERSONNEL`) and `departed` (dead, fired, other).
- A.I.M. mercs come in the order of `mercs-AIM-listings.json` with `contact` (`WillMercAcceptCall`) and
  `messageLeft`; M.E.R.C. appears once bookmarked; I.M.P. carries the page rules (`canCreate`, `beginRefusal` with
  `funds` before `teamFull`, the attribute budget and order, portraits and voices per gender, `quizAnswers`), while the
  draft of a character stays in the client until `impCreate`; Bobby Ray's shipments are priced as paid.
- **Hidden**: `dayBecomesAvailable`, hangovers, tolerances, hated and buddy lists, the current death rate and
  reputation, unhired deaths and improvements before they show, the restock state, theft counters, investigation
  outcomes, the outage roll, every queued event.

Native saves import the laptop sections.

## 22. Contracts

Rules: `22`. Map screen only (`mapScreenOnly` elsewhere: the original has no contract menu in tactical):

- `extendContract {soldier, length: day|week|twoWeeks}` (`MercContractHandling`): `notAimMerc`, `cannotExtend`,
  `tooBadlyHurt` (below OKLIFE), `notEnoughMoney`, `promptOpen` (answer the open renewal instead); a merc's refusal is
  `ok: true` with `{extended: false, reason}` (he said it).
- `dismiss {soldier}`: `dead`, `cannotExtend`, `inCombat`, `bleeding` (> 12); then the `mercDeparture` prompt.
- `removeMerc {soldier}`: dead or captured only (`StrategicRemoveMerc`; `notDeadOrCaptured`).
- Query `contractOptions {soldier}` → `{balance, options}`: the renewal menu's options and shading without opening the
  sequence (`cannotExtend`).

Prompts in `observe.contractPrompt` (deviations "Contract renewal sequence", "Contract prompts"), with the merc's
`name`, departure sectors as strings and the `balance`:

- `contractRenewal {soldier, fromSequence, options: [{choice: day|week|twoWeeks, cost, enabled, reason?}, {choice:
  dismiss, …}, {choice: letGo}]}`: opened by the sequence or `rehire`; `letGo` is Cancel; willing and unwilling mercs
  look the same, the quotes said tell the player which.
- `mercDeparture {soldier, sector, choices: here | here, elsewhere (+ rehire), elsewhereSector}`.
- `insuranceExtension {soldier, days, cost}`.

Events: `mercQuote {soldier, profile, id, quote, subject?}` (`quote` the camelCase enum name, `subject` the profile the
line names); `contractsExpiringSoon {soldiers}`; `contractExtended {soldier, days, cost, endsAt}`; `contractRefused
{soldier, reason: signedElsewhere|hatedMerc|learnedToHate|deathRate|morale}`; `insuranceUnaffordable`; `mercLeft
{soldier, profile, cause, history, equipment: here|elsewhere|carried|none, refund?, personnel: dead|fired|other}`;
`equipmentDelivered {sector, owner, items}`; `rpcUnpaid {soldier, amount}`; `mercAccountStatus`; `historyAdded`;
`mailDue`. Complaints about hated teammates are `mercQuote` events, and a merc who quits leaves through
`mercDeparture`.

View: strategic mercs carry `kind`, `contract` (A.I.M. and Slay: `{totalDays, remaining {days, hours}, endsAt {day,
hour}, lastContract, dailyRate, renewalCosts, medicalDeposit, insured, insuranceDays}`, map-screen `minutesLeft` (to
`iEndofContractTime`, capped at the length in transit) and `endMinutes`; M.E.R.C.: `{unpaidDays, daysHired, owed,
contractLength}`; R.P.C.: `{dailyRate}`), `morale` and `moraleText`, `daysServed`, `totalCost`. Never (not events
either): opinions, buddy and hated slots, tolerances, learn-to progress, precedents, `signedAnotherContract`, the
renewal list, reputation, death rate.

## 23. Merchants

Rules: `23`. A shop is a modal session (§5; deviations "Shop as commands", "Shop deduction prompt", "Unsellable
shop items", "Pricing merc", "Refused gift"): the clock stands and saving is refused.

- `openShop {dealer, soldier}` (`dealer` a profile id or internal name): checks in order, the first failure is the
  reason: the tactical flow, our turn and not acting in combat, `notADealer`, `dealerAbsent`, `outOfBusiness`,
  `dealerDown` (below OKLIFE or collapsed), `dealerHidden`, `dealerHostile`, `dealerMoving`, the merc's checks
  (`notOnCurrentSquad`, `mercCantTrade`, `noLineOfSight`, `tooFar`), `notEnoughAP` (`AP_TALK`), `npcWantsToTalk`,
  `shopClosedByScript`. Also `notInTactical`, a prompt or another shop open. Then 6 AP, facing, the repair delay, the
  last-visit time and finished repairs delivered at once. With NPC records it goes through a conversation (§13).
- `trade {soldier?, receiver?, buy?, sell?, cash?, repair?, useBalance?}`: one `PerformTransaction`. `soldier` switches
  the pricing merc (a living regular merc of the current squad, not an escort or the robot unless he opened the shop); `buy [{item, element?, count?}]` (`element` −1 or absent =
  perfect; `count` units of a stackable box or perfect gun boxes); `sell` and `repair [{soldier, slot, index?}]`; `cash
  [{soldier, slot, amount?}]`; `receiver` (default the pricing merc, `receiverCantTrade`) gets purchases and change;
  `useBalance` pre-answers the deduction box. Validation before any change: `shopNotOpen`, `noSuchBox`,
  `notEnoughInBox`, `itemNotFound`, `duplicateSource`, `notMoney`, `dealerOfferAreaFull` / `playerOfferAreaFull` (> 12
  objects), `wontBuy`, `worthless`, `wontRepair`, `notDamaged`, `tooManyToRepair`, then in `23`'s order the gift
  path, `noRoomForPurchases`, `cannotAfford {shortfall}`, `needBalance {amount}`, the repairman's cash check,
  `dealerCannotAfford`. Deliveries go in offer-area order (purchases, then change) with drops VISIBLE at the receiver's
  tile.
- `setShopPricing {soldier}`: the single merc panel's previous/next buttons and Space (`gpSMCurrentMerc`, whose weapon
  sale modifier prices everything) without a trade; `data.shop`; `shopNotOpen`, `noSuchPricingMerc`.
- `closeShop {}`: nothing is left on the table.
- Query `quoteTrade {…as trade}`: per entry the price (`CalcShopKeeperItemPrice`), the evaluation (rejected, worthless,
  value, "really damaged"; repair cost, time, done time), totals, change, balance needed, the refusal `trade` would
  give (including `dealerCannotAfford`, which the player learns by pressing the button), `quotes` (the shopkeeper quote
  ids the trade would emit, in order: evaluation quotes 4, 16–20, 27, 31 and transaction quotes 10, 22, 23; the client
  plays the evaluation ones when an item is offered, as `EvaluateItemAddedToPlayersOfferArea` does) and `poa` (the 12
  offer-area slots as `PerformTransaction` would see them: null or `{kind: money|sold|part, item, count, status,
  money?, owner, source?, value}`, `part` being what a repairman leaves after `SplitComplexObjectIntoSubObjects`).

View (`shop`, only while open): kind and `kindLabel`, the pricing merc and his weapon sale modifier, balance,
`canTrade`, merchant boxes `{key {item, element}, item, count, status, unitPrice, attachments, imprinted, ammo?}`
(dealer guns are sold empty but keep their magazine type, `MakeObjectOutOfDealerItems`) sorted as `23`,
repairman boxes `{key, item, status, owner, eta}` (ETA rounded up to 15 minutes), `repaired [{item, status, owner,
soldier}]` (the repairs collected this visit, the original's "REPAIRED" tiles; already delivered to `soldier`, the
owner else the pricing merc, null when dropped). Never the dealer's cash, list maxima, orders, strays or eligibility.
Outside a shop a visible merchant carries `merchant`. Events: `shopOpened`, `shopkeeperQuote {dealer, quote, textKey,
chars}` (quotes 10, 11, 16–20, 22–27, 29, 31, 33), `repairDelayed`, `itemsBought`, `itemsSold`, `giftGiven {dealer,
amount, accepted}`, `repairQueued {dealer, item, owner, doneAt}`, `repairCollected`, `itemsDropped`, `moneyChanged`,
`shopClosed`; restocks, customers and dealer cash produce none.

## 24. Quests, meanwhiles and the ending

Rules: `25` (quests), `26` (meanwhiles), `26` (prisoners), `26`, `26` (the end). Scenes and the
ending are not player actions: no command or prompt of their own; the flows `meanwhile`, `endgame` and `ended` lock the
UI as the original does (§5).

- **Quests** are hidden state; the player sees them only as history lines. `strategic.quests` holds one entry per
  quest with a "quest started" or "quest finished" history line, `{id, quest, started, finished}` (internal name, each
  step `{minute, sector}`, `sector` null for "n/a"); a quest changed without a history line (Alma's skip, a silent
  restart) does not appear. `questStarted` and `questFinished {quest, id, sector}` come with the `historyAdded` line.
- **Meduna scenes** (`src/sim/campaign/meanwhile-flow.ts`) resolve with the original's "played" semantics once their
  gates pass. On the map the clock stops (`compressionStopped {reason: meanwhile}`, which ends a default strategic
  `advance`); while a scene waits for its gates compression is refused (`meanwhileStarting`). Each scene emits
  `meanwhile {seq, scene, sector: 'P3', at}` (`scene` camelCase, `endOfPlayersFirstBattle` … `balimeLiberated`, `at`
  world seconds) and adds `{seq, scene, at}` to `strategic.meanwhiles`. Hidden: scheduled scenes, delays, Elliot's
  counter, the AI effects.
- **The interrogation** is a scripted tactical scene in N7: the flow is `meanwhile`, `observe.meanwhile` is `{seq,
  scene: 'interrogation'}`, the Queen's lines play in `conversation` and her lie question is `npcRequest {request: lie}`
  (`yes`, `no`, `lie`; the check stays hidden). `advance` stops with `decision` at the prompt and with `event` at
  `meanwhileEnded`; `meanwhileStarted` and `meanwhileEnded {seq, scene}` frame it. The session applies the menu music
  and N7's entry rule at `meanwhileStarted` (`TACTICAL_NOTHING`) and `TACTICAL_ENEMYPRESENT` at `meanwhileEnded`.
- **Prisoners**: `powsFound {sector, soldiers}` when I13 loads with captured mercs held there; `powFreed {soldier,
  sector}` for each prisoner a door or an explosion in I13 frees.
- **The end** (`src/sim/campaign/endgame-flow.ts`): `queenKilled {sector, gridNo, level, killer}` starts the flow
  `endgame`; `advance` plays the sequence (`squadMovedUpstairs {soldiers, sector: 'P3'}`, Derek's and Oliver's
  records). With the creature quest open, `endgameDeferred {reason: 'creatures'}` stops the advance and the campaign
  returns to `playing`; `creatureQueenKilled {killer}` resumes it later. `campaignWon {day, worldTime, difficulty,
  sciFi, ending: {miguelAlive, skyriderAlive}, mercDeaths}` ends it with stop reason `ended`; then `campaign` is `won`,
  `observe.ended` is `{outcome: 'victory', at, day, ending, mercDeaths}` beside the last view, and the `ended` row of §5
  applies (a new game needs `newSession`). There is no game over: with no usable merc left compression is refused
  (`noUsableMercs`) and `status` carries `noUsableMercs: true`.
- **`useRemote`** opens the O3 statue (§11).
- **Native saves** taken during a played scene or the endgame sequence are refused on import; other saves' scene state
  is imported.
- **The campaign identity** (`src/server/campaign-id.ts`): the game page keeps the help screens' seen mask per campaign
  (the original saves it, `SaveLoadGame.cc:1916`), so `welcome.campaign` names the campaign: a random identity made at
  `newSession {campaign}`, `import:<16 hex digits of the file's digest>` for a native import, absent for a sandbox;
  saved in `presentation.campaign` and restored by a load (an old save without one gets `save:<16 hex digits of the
  save's digest>`). Presentation only: the snapshot, the input log, the replay and the logic hash do not see it.

## 25. Text and languages

Two independent settings decide text (what each selects and how it reaches the simulation: `31`, `31`):

- **Data version**, a property of the content: detected once at server start like Stracciatella's guesser, overridden
  with `JA2_DATA_VERSION=english|russian|russianGold|german|dutch|french|italian|polish|simplifiedChinese` (Russian Gold
  must be named), `stubs` without original data. EDT text (dialogue, item names, mails) always comes in this language.
- **Display language** (`eng`, `rus`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`): only the UI string tables. Server
  default `JA2_LANG`, else the data version's language (stubs: `eng`); per session `newSession {language}`, shown by
  `status`, `GET /api/sessions` and `observe`; it never touches the simulation, its saves or its logs.

`TextService` (`src/server/text-service.ts`) resolves through the VFS: the user's EDT files
(`src/content/formats/edt.ts`) or the stub pack's invented lines (only on the `stubs` data version). The quote lengths
the simulation needs are computed at runtime by the content loader, never committed; a missing row has length 0 and is
silent. Tests never embed original text.

- **`GET /api/strings?lang=`** (ETag, `private, max-age=3600`) → `{language, files, tables, keys}`: `tables` holds the
  217 `L10n` keys (arrays checked against the sizes of `Localization.h`, `data/tables/l10n.json`) and the per-language
  files under their Stracciatella names (`new-strings`, `strategic-map-land-types`, `strategic-map-town-names`,
  `strategic-map-town-name-locatives`, `ammo-calibre`, `ammo-calibre-bobbyray`, `shipping-destinations`); `keys` maps
  machine tokens to `{table, index}`.
- **`GET /api/text`**: `?file=<edt>&row=R[&column=C]` for every EDT file the game reads, with its record layout from
  `data/tables/edt-layouts.json` → `{file, row, layout, columns, column, width, text}`; 400 for a file without a
  layout, 404 for a missing file or row. `?table=<L10n key or file>&index=I&lang=` and `?key=<token>&lang=` resolve UI
  strings → `{key?, table, index, language, text}`.
- **Text keys** (`src/server/text-keys.ts`): `morale.<great|good|stable|poor|panic|bad>` → `pMoralStrings`,
  `condition.<excellent…dead>` → `pConditionStrings`, `talkMenu.<…>` → `zTalkMenuStrings`, `shopKind.<…>` →
  `zDealerStrings`, `moveRefusal.<token>` → `pMapErrorString`, `assignment.<n>` → `pAssignmentStrings`,
  `refusal.<token>` (§5).
- `/api/health` and `listSaves` carry `engine {version, commit}`, so a client can predict `engineDiffers` before a
  load.

## 26. Saves

File format (one `<name>.j2s` per save in `$JA2_SAVE_DIR`), save rules, save modes, autosaves and load modes: `27` §1;
the input log and the modules: `04` §5.5. Clients pass names, never paths: `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`;
`QuickSave`, `Auto01`, `Auto02` and `Error` are reserved.

| Surface | Calls |
|---|---|
| MCP | `save {session?, name?, description?}`: without `name` a new save `<UTC time>-<slug of the description>` (Stracciatella's naming), `name: 'quick'` writes `QuickSave`, any other name writes or overwrites; `description` cut to 46 characters; `{ok, name, kind: player\|quick\|auto\|deadIsDead, header}` or `{ok: false, refused, reason}`. `load {name, session?, reseed?}` in place or, without `session`, into a new session (= `newSession {load, reseed?}`). `listSaves {}`: ja2-node saves (`native: false`, the header, `warnings` predicted from it) and native saves (`native: true`, read only), newest first, with `compatible` and `problems` (`versionTooNew`, `contentMismatch`, `needsOriginalData`). `deleteSave {name}` deletes a save and its log |
| HTTP | `GET /api/saves`; `POST /api/sessions/:id/save` (409 refusal, 400 bad name); `POST /api/sessions/:id/load`; `POST /api/sessions {load, reseed?}`; `DELETE /api/saves/:name` (404 when absent); `GET /api/saves/:name/file`; `PUT /api/saves/:name/file` (at most 32 MiB, else 413; parsed, version and content checked before it is written); developer only `POST /api/sessions/:id/snapshot`, which ignores the save rules. Load refusals map to 404 (`notFound`), 409 (`contentMismatch`, `versionTooNew`, `noMigration`) and 400 (`invalidName`, `notASave`, `corrupt`) |
| WebSocket | `save`, `load` → `result`; a load in place sends every subscriber a fresh `welcome` (a running real-time driver stops: `stopped {reason: 'loaded'}` first, the driver becomes manual); a client drops the frames still queued when the new `welcome` arrives |
| Events | `gameSaved {name, kind}` after a player or quick save and `gameLoaded {name, seed}` after a load, with the next report; autosaves and Dead is Dead saves send none, as in the original |

`status`, `GET /api/sessions` and `observe` show `saveMode`, `canSave` and `saveRefusal`, so an agent need not try.
Refusals of `save` (conditions and check order: `27` §1.6): `conversation` (also a scripted sequence or a busy dialogue
queue), `meanwhileStarting`, `promptOpen` (also an autoresolve battle), `shopOpen`, `ironMan`, `deadIsDead` (an
explicit save; `save {name: 'quick'}` writes the Dead is Dead file, or answers `actionInProgress` outside our turn or
while something acts), `invalidName`, `reservedName`, `notSaveable`. A won campaign can be saved; loading is never
restricted. Autosaves (`Auto01`/`Auto02`, on an accepted `endTurn` in ongoing combat) and the Dead is Dead save points
(also at session close and server stop): `27` §1.6, deviation "Dead is Dead save points".

A load is a player load by default: the exact state, then the main stream reseeded (`reseedMain`, `27` §1.5; deviation
"Player loads"), the seed returned as `seed` and logged as `reseed {seed}`; `reseed: false` is an exact load
(experiments, bug reports). The content is checked before anything is built (`04` §5.10); `warnings`:
`stubPackDiffers`, `dataVersionDiffers` (another data version or other quote lengths), `engineDiffers`. A load in place
first takes the session's Dead is Dead save point. Native saves (`$JA2_SAVES_DIR`) are imported with `newSession
{save}` (`14` §10); the answer carries the import report as `import`.

## 27. Game options, speech and music

**Game options** (`27` §2.2): session state, saved and shown as `options {difficulty: 1|2|3, sciFi, gunNut, saveMode:
anywhere|ironMan|deadIsDead, bloodAndGore}` in `status`, `observe`, `GET /api/sessions`, every save header and native
headers (`droppedOptions: ['turnTimeLimit']` when the original's timed turns were on: not ported). `newSession
{campaign: {options}}` sets them; missing fields take the original's defaults (sci-fi on, reduced guns, save anywhere,
blood on) except `difficulty`, 2 here (the original's is easy); `campaign.difficulty` and `campaign.saveMode` remain
aliases, refused when they contradict `options`. The sandbox uses the defaults. `setOption {bloodAndGore}` (logged,
replayed) is the only option that changes during a game, as on the original's options screen: any flow; `promptOpen`
while a prompt is open, `badOption` for anything else; it applies from the next tick and reports `optionChanged
{bloodAndGore}` (what it switches: `27` §2.2).

**Speech mode** (`speech`): `newSession {speech: 'skip'}` or `setSpeech {mode: 'skip'|'listen'}` makes every line end
on the tick after it is said, as if Backspace were pressed at once; its quote event carries `skipped: true` and a
client shows nothing for it. A session setting: logged (`speech` entries, replayed), kept across loads and passed to a
reloaded simulation, never saved, so a player loading the agent's save hears the lines. Under the manual driver lines
cost milliseconds anyway; it matters when the session runs in real time with nobody watching.

**Client settings** (volumes, speech, subtitles, key-advance speech, the sleep/wake notification, display toggles,
playback speed, language, meanwhile scenes seen, help, cover and LOS sizes; `27` §2.4) are per browser
(`src/ui/settings.ts`, `src/app/settings.ts`) and never reach the simulation; agents have none.

**Music** (`31`, `31`): the server computes the original's music mode (`none`, `mainMenu`, `laptop`,
`tacticalNothing`, `tacticalEnemyPresent`, `tacticalBattle`, `tacticalVictory`, `tacticalDefeat`) from the events and
the creature flag, so every client hears the same; `music {mode, creature, fastFade?}` goes out in `welcome` and in
frames when it changes (`fastFade` after a sector entry or exit) and is saved (`presentation.music`; a native import
starts at the saved mode). The browser chooses tracks, fades and loops. MCP `observe` carries no music and no sound.

## 28. Queries and cursor hints

Queries are commands that change nothing. Cursor feedback (path and AP under the pointer, chance to hit, drop targets,
plotting ETAs, enabled menu lines) is computed as the original computes it, with the rules' own functions, in the
browser (`28` §2.4) and on the server, over the **player-knowledge projection** (deviation "Cursor hints on the
projection").

**The projection** (`src/sim/knowledge/`). `knowledgeWorld(view, rules, {strict?})` builds from a player view (a
structural `KnowledgeView`; `sim` may not import `protocol`) and the rule content the minimal world the hints read:

- **Tactical**: a `TacticalState` over a fresh copy of the sector's world (`TacticalProjection`, two maps cached,
  synced per view) with doors set to `openDoors` and their perceived lock and trap from `doors`, containers to
  `openContainers`, the ground items, the light (base level and powered sprites, drawn by the simulation's lighting
  over the projected doors), the player's soldiers in full (view fields, inventory rebuilt as objects, the `hint`
  inputs), only the seen soldiers with their visible fields (position, stance, body, hand item class, health category
  as appearance stand-ins), a narrative port answering only `isEpc` and the robot control, and the boxing state.
  Unseen soldiers do not exist: they block no path, absorb no bullet and are no target.
- **Strategic**: a minimal state from the strategic view and the static rules (`strategic.ts`, `strategic-state.ts`,
  `strategic-crew.ts`).
- **Strict mode** (tests): a guard (`guard.ts`) makes every unsupplied field throw `UnsuppliedFieldError`, so a hint
  reading hidden state fails at once. Each such read was decided: supplied by the view, given a neutral value (others'
  tiles moved, awareness, collapse; deviations "Movement penalty in the estimate", "Other soldiers in the projection")
  or dropped (the melee chance to hit). `withTemporaryFields` and `preservingFields` keep hints from leaving writes
  behind. Not in the view: stat damage for stat healing (`enable_stat_healing`).

**Hint kinds** (`src/sim/hints/`, `answerHint`; answers `{ok, reason?, data}` with `data.refusal`; full field lists in
the MCP `act` description):

| Kind | Request | Answer |
|---|---|---|
| `previewMove` | `{soldier, to, mode?, reverse?, level?}` | `{destination: ok\|blocked\|heightDiffers\|robotUncontrolled, apCost, firstStepCost, affordable, steps [{gridNo, enterDir, leaveDir, band}], refusal?}`: `UIPlotPath`/`PlotPath` (`src/sim/tactical/plot-path.ts`: start cost, run start cost, the fence rule), the footstep bands (crawl, swat, walk, run, none; real time: none), `SelectedMercCanAffordMove`, `UIOKMoveDestination` and the land height check; `level` the interface level; `refusal` a view-level lock (`uiLocked`, `mercUnavailable`, `cannotAct`) |
| `estimateAttack` | `{soldier, target, level?, aimTime?, bodyPart?, burst?, weaponMode?, mode?}` | `{cursor, weaponMode, apCost, apCostByAim[0..4], actionPoints, chanceToHit, chanceToGetThrough, inRange, ammo {empty, canReload, reloadAp}, inReach?, pathClear?, landsAt?, landsOnLevel?, maxRange?}`: `GetActionModeCursor`, the reload cursors, `InRange`, the toss and trajectory branch with the launchable attachment and the attached launcher (`CalculateLaunchItemChanceToGetThrough` with the landing level). Without `burst`/`weaponMode` the mode `EnsureConsistentWeaponMode` would leave; `mode` the movement mode of a melee walk-up; a melee cursor over a tile with nobody at that level answers `inReach: false` with no costs; other hand items answer their cursor kind (`aid`, `remote` with `AP_USE_REMOTE`, `bomb`, `wirecutter`, `repair`, `refuel`, `jar`, `tincan`, `invalid`, `other`) without strike numbers. `chanceToHit` is null for melee |
| `previewAction` | `{soldier, gridNo, level?, kind, target?, mode?}`: `door`, `pickUp`, `talk`, `give`, `jump`, `swap`, `look`, `aid` (`steal`, `cutFence`, `repair`, `refuel`, `jar`, `can`, `bomb`, `enterVehicle`: `notSupported`) | `{kind, ok, refusal?, apCost, affordable, actionGridNo, steps, direction?, open?, menu?, inRange?, lineOfSight?}`: one branch of `DrawUIMovementPath` each with the action's AP (`doorAPs`, `AP_PICKUP_ITEM`, `AP_TALK`, `GetAPsToGiveItem`, `GetAPsToJumpOver`, `AP_EXCHANGE_PLACES`, `GetAPsToLook`, `GetAPsToBeginFirstAid`), the door menu for a door believed locked, `IsValidJumpLocation`, `ValidQuickExchangePosition` |
| `placements` | `{soldier, slot, count?, index?, mapScreen?}` | `{cursor {item, count}, slots [{slot, invalid, hatched, attach, merge, highlight, fits}], secondHandBlocked, applyOnMerc, compatibleMercs}`: `ReevaluateItemHatches` (`CanItemFitInPosition`, `ValidAttachment`, `ValidMerge`), `InternalHandleCompatibleAmmoUI` and a dry-run placement |
| `itemInfo` | `{soldier, slot, index?, metric?}` or `{item, metric?}` | the description box's numbers (`Weight()` per object, `GunRange`/10, impact, `BaseAPsToShootOrStab(20, 80)`, burst AP, the white highlights), the gun title, pros and cons as `Message` indices (`src/sim/tactical/item-description.ts`) |
| `exitSector {…, dryRun: true}` | the `exitSector` fields | `{minutes, who, load, target, level}` or the refusal (`OKForSectorExit` and the exit menu rules on a narrow `ExitWorld`, shared with the command; it cannot know mercs already walking off) |
| `exitSectorOptions` | `{soldier}` | the exit dialog's result, choices and `enemyInSector` (`InternalInitSectorExitMenu`) |
| `canEnterSector` | `{sector}` | `{allowed, reason?}`: an open strategic prompt, a battle in another loaded sector, `CanGoToTacticalInSector`, a map for the sector (deviation "Gates outside the hints") |
| `assignmentOptions` | `{soldier}` | `{box: assignment\|epc\|removeMerc, lines, squads, vehicles, repair, training, attributes}`, each line `{line, enabled, shade: none\|gray\|yellow, reason?, target?}` (`HandleShadingOfLinesForAssignmentMenus`, the `CanCharacter*` checks) |
| `previewRoute` | `{soldier, to, via?, shortest?, extend?, alone?}` | `{path, temp, edgeMinutes, etaMinutes}`: `BuildAStrategicPath` from the end of the merc's path and the ETA as the map screen shows it while plotting: `GetGroundTravelTimeOfSoldier` sums `GetPathTravelTimeDuringPlotting` over the temporary and the merc's path, so while the group is between sectors the remaining leg counts twice and the temporary path's first edge is dropped (`MapScreen.cc:939-1045`, `:7142-7153`; kept, D1). `alone` checks only that merc, not his group (the move box, before `routeGroup` regroups) |
| `previewHeliRoute` | `{to, via?, extend?}` | `{path, temp, distance, safe, unsafe, cost, etaMinutes, passengers, refusal?}`: `DistanceOfIntendedHelicopterPath` (9999 when it cannot fly), safe and unsafe counts with the original's first-node rules, safe × 100 + unsafe × 1000, the same ETA double count (`Map_Screen_Interface_Map.cc:2169-2226`) |
| `moveBoxOptions` | `{sector}` (surface) | `{soldiers [{soldier, listed, refusal?}]}` for every living merc of the sector outside transit and captivity: `listed` by `SetUpMovingListsForSector`, `refusal` from `CanCharacterMoveInStrategic` |

**Server-only queries** (`SERVER_QUERY_KINDS`): `hireCheck`, `impCheckCode`, `aimQuote`, `bobbyRayQuote`,
`insuranceQuote`, `impPreview`, `arrivalTime`, `quoteTrade`, `contractOptions` and `inventory` depend on state the
player does not see or price a decision; the query service passes them to the simulation's own handlers without
logging. The purity test (`src/server/query-purity.test.ts`) runs every one and compares the session snapshot byte for
byte.

**The channel.** WebSocket `{t: 'query', id, q}` → `{t: 'answer', id, ok, tick, reason?, data?}`; `SessionHost.query`
answers like `observe`: between ticks, outside the input queue, never logged, no frame, no instant-driver advance.
`isQueryCommand` (every hint kind, `exitSector` with `dryRun`, the server-only kinds) routes a query arriving as a
command (MCP `act`, WebSocket `cmd`) the same way; an old input log that holds one still dispatches it to the
simulation. `QueryService` (`src/server/query.ts`) keeps fresh world inputs (two maps) and the knowledge rules per
content and builds the projection per query (the first build for a map, with the world copy, about 0.1 s on A9, is
warmed when the map loads).

**Answers over the view the viewers hold.** While time stands, commands change the view without a step, so a tick does
not name a view. The session keeps `sentView` (the welcome with every published frame applied by `applyViewFrame`, the
client's own function) and, while it has viewers, answers every query over it and welcomes a later viewer with it;
frames and answers share one ordered socket, so an answer arrives on exactly the view it was computed on (at most one
capture, 50 ms, behind the simulation), and its `tick` is that view's. Without viewers (MCP only) queries use the
current view.

**Fairness** (D16, deviations "Attack estimate target", "Melee chance in the estimate", "Hints of actions with hidden
checks", "Strategic hints and enemy counts"): an unseen enemy on the target tile or the path changes no answer
(`src/server/hints-fairness.test.ts`); strategic hints read only the enemy counts the view shows. Where the original UI
read hidden state, the projection does not, and the command refuses on the full state with the original's message.
Client and server agree by construction (same code, checked by the engine commit; same inputs, checked by the rule pack
hash); the scenario suites compare them over sampled points (`tests/support/hints*.ts`). In Node on A9 the projection
sync costs 0.45 ms p50, 1.7 ms p95 and `previewMove` 0.18 ms p50, 1.15 ms p95 (the tail is a search to an unreachable
tile, which explores the whole map as the original does).

## 29. Endpoints and switches for the player UI

- **`GET /api/sessions/:id/profiles`** (`src/content/narrative/profile-presentation.ts`, ETag) → `{profiles: [{id,
  name, nickname, faceIndex, eyes, mouth, blinkFrequency, expressionFrequency, smallFace, aimBio, mercBio}]}`: the face
  index is the profile id (`LoadMercProfiles`; Herve, Peter, Alberto and Carlo share Herve's portrait), an I.M.P.
  character gets its portrait's face with zero eye and mouth offsets (`SelectMercFace`), `smallFace` from
  `mercs-rpc-small-faces.json`, the bios from rows of `aimbios.edt` and `mercbios.edt`. On stubs the faces come from
  `stubs/profiles.json` (optional `face {index, eyes, mouth, blinkFrequency, expressionFrequency}`); a stub sandbox has
  no profiles.
- **`GET /api/items?lang=`** (`src/server/item-catalogue.ts`, ETag, an hour's cache) → `{language, dataVersion, items:
  [{index, name, shortName, longName, description, bobbyRayName, bobbyRayDescription, class, classIndex,
  inventoryGraphics {small, big}, tileGraphic, weight, perPocket, price, coolness, reliability, repairEase, flags,
  weapon, magazine, armour, explosive}]}`: names and descriptions from `itemdesc.edt` of the data version, Bobby Ray's
  texts from `braydesc.edt` for weapons, armour and explosives (magazines: the short name; others: the name), calibre
  names from `ammo-calibre` and `ammo-calibre-bobbyray` in the display language with `showInHelpText` (from
  `calibres.json`, `GetHelpTextForItem`), the catalogue's rate of fire. `ItemDef` parses the graphics with
  `ItemModel`'s defaults (`interface/mdguns.sti` 0, `bigitems/gun00.sti` 0, `GUNS` 1).
- **Test switches of the game page** (URL parameters): `holdTime=1` keeps the map screen from starting game time by
  itself (explicit `advance` still works), `pinClock`, `shadowHints=1` (the client's shadow mode, `28` §2.4). The
  `window.__ja2Ui` hook exposes `frameStats` (`count`, `p50`, `p95`, `max` of the page's JavaScript time per frame,
  `resetFrameStats()`), `lagTicks` (latest received tick minus shown tick) with `skipPlayback()`, `lastCommand` and
  `lastResult` (`{ok, reason, refusal}`), and the hint statistics.

## 30. Diagnostics

The game page shows where time goes in Stracciatella's FPS overlay (`src/sgp/FPS.cc`): Ctrl+F on any screen (the key
reaches no screen, as in `SGP.cc`), white `SMALLFONT1` text at 11,23 refreshed once a second, a line light red when
slow (vanilla below 20 FPS), with the pointed cell above the sampled lines. `src/ui/diagnostics-overlay.ts` draws,
`src/app/game/diagnostics.ts` samples:

| Line | Source | Light red when |
|---|---|---|
| `cell G (x X, y Y), level L, map` | the top screen's `pointedCell()`, every frame: the tactical screen gives the cell under the pointer (the overhead map's while it is open, `cell: none` off the map), the interface level and the view's `mapPath`; other screens give none | never |
| `N FPS, N drawn, frame A ms (max M)` | animation and drawn frames per second, the page's JavaScript time per frame | below 20 FPS |
| `ping R ms, server loop L ms` | a `ping`'s round trip, the server's event-loop delay | R > 250 ms or L > 100 ms |
| `playback lag P ms, behind server B ms` | latest received minus shown tick; the tick of the last `pong` minus the shown tick | either > 250 ms |
| `waiting X A ms (N open), slowest reply Y S ms` | the oldest request without a reply, the slowest reply of the second | A or S > 1000 ms |
| `server queue N, last X: waited W ms, ran R ms, game time +G ms` | the session's health | N > 1, W + R > 250 ms or G > 250 ms |
| `reads N open, oldest A ms: path` | the page's unfinished `/vfs` reads | A > 1000 ms |

The client sends `ping {id}` once a second while the overlay is on; the WebSocket answers it outside the command order
with `pong {id, health}`. `SessionHost.health()` (the worker host asks its worker) returns `{tick, pending, last,
loopDelayMs}`: the simulation's tick, the inputs in the host's queue (the running one included), the last finished
input with its label, the milliseconds it waited and ran and the ticks it advanced, and the largest event-loop delay
since the previous `health` (`monitorEventLoopDelay`, 10 ms resolution; the worker host takes the larger of its
worker's and the main thread's). Viewers share that window. A failed health answers `pong {id}` without it. Nothing is
logged.
