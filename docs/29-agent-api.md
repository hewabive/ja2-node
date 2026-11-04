# 29 — Agent API

*The agent API by topic: what an agent or a maintainer needs beyond the MCP tool descriptions. It is the browser's
session API (D13–D16) exposed over MCP. The descriptions and input schemas in `src/server/mcp.ts` list every command
with its fields and refusal tokens, every view field and every event; the types are `src/protocol/view.ts`,
`src/protocol/messages.ts`, `src/sim/events.ts` and the domain event files it imports. This doc gives the rules behind
them: transport, fairness, time and decisions from the agent's side, the modal states, and where each domain's rules
live. Time model and drivers: `04` §4; server, sessions, protocol and the player-view projection: `04` §5; saves and
options: `27`; the client: `28`; text and music: `31`; how each screen of the original became a command or a prompt:
`deviations.md` §6. Where this doc and the code differ, the code wins.*

## 1. Transport

- **LLM agents**: MCP over streamable HTTP at `http://127.0.0.1:7420/mcp` (`JA2_HOST` and `JA2_PORT` move it) with
  `Authorization: Bearer <.ja2/token>` (`04` §5.8); Claude Code adds it with `claude mcp add`. Each request builds a
  fresh MCP server over the shared game sessions (`handleMcpRequest`) and answers JSON; there is no stdio transport
  and no MCP session state.
- **The browser**: the WebSocket protocol of `04` §5.2.
- **Scripts and bots**: the same HTTP routes, MCP or the WebSocket directly; there is no client package. Users: the
  e2e tests, `tools/bench` and `pnpm cli campaign` (`tools/campaign-bot/`), which plays a whole stub campaign through
  MCP alone, from a new game to the Queen's death, with an exact and a reseeded reload on the way.

| HTTP route | Purpose |
|---|---|
| `GET /api/health` | Server identity: data, data version, default language, engine, rule pack |
| `GET`, `POST /api/sessions`; `DELETE /api/sessions/:id` | List, create (the `newSession` body), close (§6) |
| `/api/saves…`, `/api/sessions/:id/{save,load,snapshot}` | Saves (§10) |
| `GET /api/strings`, `GET /api/text` | UI strings and EDT text (§10) |
| `GET /api/sessions/:id/profiles`, `GET /api/items` | Profile presentation and the item catalogue (§11) |
| `GET /api/assets/manifest`, `GET /api/vfs`, `GET /vfs/…` | Assets (`04` §5.10) |
| `GET /login?token=` | Sets the token cookie, redirects to the launcher |

## 2. Playing through the API

**Few, coarse tools**: `status`, `observe`, `act`, `advance`, `newSession` and the save tools. Every tool but
`newSession`, `listSaves` and `deleteSave` takes `session` (default `sandbox`), so agents and tests need not share one
battle. Queries are `act` commands too (§9). Events come only in `advance` reports, those since the previous report,
never with `observe`.

**The loop.** `observe`, ask what the cursor would show (`estimateAttack`, `previewMove`, `previewRoute`, …), `act`,
then `advance` to idle, a decision or a watched event; the report's events and messages say what happened. A long
campaign is thousands of actions: read the events instead of observing after every step.

**Strengths and limits.** Turn-based combat, strategy and management suit an agent; the queries spare it the
arithmetic. Spatial reasoning over JSON (cover, elevation, roofs) is the weak part. Real time is played through the
manual driver, which pauses between any two ticks, or by waiting on a viewer's real time (§4.6); real-time control by
an LLM agent without pausing is a non-goal.

**Not built as commands** (the client shows them disabled): using wire cutters, toolkits, gas cans, jars and tin cans
on a tile, and the x-ray detector (gap "Unbuilt item actions"; `previewAction` answers `notSupported`,
`useRemote` refuses the detector); auto-bandage (gap "Auto-bandage"); the placement GUI (deviation "Tactical
placement"); vehicles' condition and fuel (gap "Vehicles as characters").

## 3. Fairness: what the agent never sees

The agent sees what the player's screen would show (D16, `04` §5.3): a view block or field exists only while an
original screen shows it, events about what the squad does not see are cut down to what it hears (§7), and the cursor
hints run over a projection of the view (§9). Where the original's UI read hidden state, the hint drops the answer (the
melee chance to hit is `null`) or leaves it to the command, which decides on the full state and refuses with the
original's message. Per domain:

| Domain | Shown | Never shown |
|---|---|---|
| Tactical | Our soldiers in full, with what the original's panels and face read; others in sight with their visible fields, the sheet they show, their camouflage paint, `hostile` and the health category, and for a few 60 ms steps a soldier the squad has just lost (`fadingOut`, as the original draws him fading); doors with the lock and trap state the player knows | Others' life; unseen soldiers (absent from the view, events and hints); lock tables, trap levels, lock damage |
| Sound, bullets, blood | The side and loudness of what the squad hears; bullets of shooters we see; blood pools as the squad last saw them (deviation "Blood on the ground") | The grid of an unseen source; bullets of unseen shooters |
| Conversations and NPCs | Lines, the menu, requests, NPCs in sight | Facts, quest states, records and their conditions, desire, approach values, opinions, NPC inventories and cash, balances beyond what a message printed (Kingpin's, the hospital's modifier and refund), profile whereabouts and schedules (`npcMoved` is not an event), NPC system events |
| Strategic map | Enemy counts by the player's knowledge (`16`), our groups; seen enemy soldiers in tactical show their class through the uniform | The Queen's state: garrisons, compositions, group routes, intentions, pool, alertness and the event queue (her evaluations, enemy arrivals, creature attacks, NPC timers, scheduled meanwhiles); enemy groups other than through the counts |
| Towns and mines | Loyalty once started and where the town uses it; mine status in the town box's order | Remaining ore, which mine will deplete |
| Helicopter | Debt, hits, safe and unsafe sectors, route cost | Skyrider's talk state and accumulated bill |
| Autoresolve | Cells, health categories, counts, battle time | Ratings, timers, pending bullets, exact enemy life, the capture roll |
| Laptop | What the pages print | `dayBecomesAvailable`, hangovers, tolerances, hated and buddy lists, death rate, reputation, unhired deaths and improvements before they show, restocks, theft counters, investigation outcomes, the M.E.R.C. outage roll, queued events |
| Contracts | The renewal options and their costs; willing and unwilling mercs look alike, only the quotes tell | Opinions, buddy and hated slots, tolerances, learn-to progress, precedents, `signedAnotherContract`, the renewal list |
| Shops | Boxes with prices, the pricing merc and his modifier | Dealer cash, list maxima, orders, strays, eligibility; restocks and customers raise no event |
| Story | Quests through their history lines; Meduna scenes once resolved | Scheduled scenes, delays, Elliot's counter, the interrogation's lie check |

## 4. Time and decisions

### 4.1 The clock

Sessions start under the manual driver: game time moves only inside `advance`, so the agent is a player with zero
reaction time and a pause between any two ticks (`04` §4.3, deviation "Real-time pause"). `advance` runs to a stop
condition (`04` §4.2): idle, a watched event, a tick count, a world time, a decision, a refusal, the budget, the end of
the campaign or, beside a real-time viewer, a timeout. Each report carries the world time in a campaign. In tactical
the world clock runs real time; it stands in turn-based combat and while the interface is locked: mercs walking off or
in, the action-item queue, the boxers leaving the ring, a scripted sequence (`15`).

### 4.2 Decisions

A decision is a choice the game waits for (`hasPendingDecision`): an interrupt in our favour with nobody of ours
acting; an open prompt (`observe.prompt`, which in the sandbox too holds the loaded sector's prompts of §8.1,
`observe.contractPrompt`, `observe.npcRequest`); a conversation waiting for a
choice, also one an NPC opened (`initiatedBy: npc`, deviation "Conversation prompt"); an open shop. A running `advance`
stops with `decision` when one arises, and the real-time driver holds without running ticks; a new `advance` answers
`decision` at once while a prompt is open and is refused while a conversation waits or a shop is open. Prompts are
answered with `answer {prompt?, choice}` (a wrong id or choice is refused); while one is open the clock and the ticks
stand still and other commands are refused (§5). The original's informational boxes (assignment done, fell asleep,
militia promoted, the boxes before a pre-battle panel) are events, not prompts (deviation "Strategic prompts").

### 4.3 Turn-based play

Rules: `10`. Orders are accepted only on our turn, with no attack resolving, no order queued as a game event and no
other merc of ours acting (deviation "Turn-based UI lock"). A gun attack starts with a queued `beginFireWeapon` game
event, as the original locks the UI after the click, so every order and `endTurn` are refused with `orderQueued` until
the agent advances. `advance {idle}` returns when it is our turn again and nobody of ours acts; it also waits for
bullets, queued game events and our soldiers' one-shot animations (getting up, picking up, climbing).

- An interrupt in our favour is a decision: only the mercs that have not moved may act (`OK_INTERRUPT_MERC`), and
  `endTurn` gives the turn back (deviation "Interrupt prompt").
- An interrupt in our favour names the soldier it stops (`interrupted`) and a shown AI interrupt its AI soldier
  (`interrupter`), both only while the squad sees them: the original slides the view to them (`Tactical/TeamTurns.cc:600`,
  `:397`).
- An AI interrupt shows nothing until `DisplayHiddenInterrupt`, then an `interrupt` event; while a hidden one runs the
  view shows our turn, as the original does, and orders are refused with `uiLocked`. A fully hidden one leaves no
  trace. `combat.aiTurn` names the AI soldier whose turn it is (the one the original highlights) while he is in the
  view, also in an AI interrupt once it shows and in the turn an AI attack starts.
- `endTurn` first runs `CheckForEndOfCombatMode(FALSE)`: when that ends combat the turn does not pass and the answer
  carries `data.combatEnded`.
- The selected merc (`turn.selected`, `src/sim/tactical/selection.ts`; in the view as `selected`, his id or null) is
  the original's: `select` sets it (the client sends one for every change the player makes and follows `selected` for
  the rest), and so do `EnterCombatMode`, the interrupts, `SelectNextAvailSoldier`, a conversation's talker and the
  original's own selections: the return from the map to the loaded sector (a selected merc out of control or asleep
  gives way to the team's first controllable merc, then the selected merc is selected again, forced), a sector load
  (the merc selected when the squad left, else the first who may act, forced, then the return's), the end of the first
  landing (the first merc dropped), the end of the selected merc's skull, his removal from his squad or from the
  sector (the next merc of his squad, after a removal from the sector also the first of the next squad on the map).
  Each has the checks, squad, wake-up and psycho `Random(50)` of `InternalSelectSoldier`. Any merc leaving the loaded
  sector while the map is up, and the departure of the selected merc, leave nobody selected, as in the original.
  It matters for `StandardInterruptConditionsMet`, `EndInterrupt` and `CheckForMercContMove`.
- The current squad (`forces.currentSquad`; in the view as `currentSquad`, null for none) is the original's
  `iCurrentTacticalSquad`, whose members the team panel shows: a selection makes the selected merc's squad current, and
  `selectSquad` makes a squad on the map current, as the squad keys and the squad list do. As `SetCurrentSquad` does,
  a new current squad's first merc is selected, forced, when the selected merc is not on it; only the first slot is
  tried, so a first merc who cannot be selected leaves the selection where it was. The server also changes it where
  the original does: a screen entry or an exit without a load while the current squad is off the map (the first squad
  on the map, or none), a merc joining a squad while the current one is empty, the selected merc joining another squad,
  a talk, an escort's recruitment and a hospital assignment. A native save resumed in tactical selects its selected
  merc again, forced, before the screen entry; a ja2-node save restores the selection and the current squad as they
  were (deviation "Selection on load").
- An order to one merc selects him first, once the turn locks and his own state let him act (`actRefusal`) and before
  the order reads its fields or draws, because the original's player selects a merc before ordering him. The selection,
  his wake-up and its draw stay when the order is then refused. An order given while he plays the wake-up takes over at
  once, as `EVENT_InitNewSoldierAnim` lets it (the wake-up is no `ANIM_NONINTERRUPT`); the orders to the other mercs
  wait for its end (deviation "Turn-based UI lock"). The original gives `turn` and `stance` also to the mercs of a
  real-time multi-selection without selecting them: with `multiSelected: true` these orders only wake their merc, as
  the multi-selection already did.

### 4.4 Time on the map

`compressTime {mode}` and `stopTime` are the map screen's clock buttons; the player's pause is not a command, the manual
driver is the pause. A strategic `advance` (one with a world-time field, `compressionStopped` or `mode`) starts
compression itself and stops where the original stops it (`04` §4.2); the clock's `canCompress` and `compressRefusal`
say beforehand whether it would start. A timed bomb ticking on the loaded map refuses compression (`activeTimedBomb`)
until it goes off or the sector unloads. `status.flow` names the flow (`tactical`, `strategic`, `autoresolve`, `laptop`,
`meanwhile`, `endgame`, `ended`); `mapScreen` and `tacticalScreen` switch between the first two like the original's
screen toggle, and the loaded sector stays frozen on the map (deviation "Map and tactical screens"). `tacticalScreen` and
a sector load from the map lift the clock's `pauseLocked`, and `tacticalScreen` its `paused` unless the player paused
(`15`). A head miner's line other than "creatures gone" takes tactical to the map screen before it is said (deviation
"Head miner map switch"). The sleep and wake notification is a client setting: an agent that wants the original's stop
passes `events: ['fellAsleep', 'wokeUp']` beside its time target.

`compressionStarted {mode}` and `compressionStopped {reason}` follow whether time runs compressed
(`IsTimeBeingCompressed`), so a speed picked while time stands and an unpause start it too; a line's pause (below) marks
neither.
`tacticalClearedForCompression` marks only a start by the start toggle (`StartTimeCompression`: `compressTime` without
`mode`, or an `advance` without `mode` that starts compression): the loaded sector's soldiers have stopped, their AI
actions and the game events not yet dequeued are gone, and the client empties its tactical message log, shown and queued
lines (`15` §2). The message list of §7 keeps every entry.

A line the dialogue queue says on the map pauses the game until it ends, as the original's `DialogueEventQuote` does
(`24`): world time stands for the line's ticks, the clock shows `paused` and `pauseLocked`, and `compressTime` is
refused with `pauseLocked`, a new speed too (`stopTime` still works). Compression that was on runs again at its speed
after the line, and a strategic `advance` runs through it; one that would start compression waits for the queued lines
to end first, and `advance {idle}` on the map waits for the queue to empty. A line said while the game is already paused
takes no lock and leaves the pause; while lines wait in the queue `compressTime` is refused with `dialogueQueued`. The
strategic lines go through this queue as in the original: assignment done, the tired complaint, contract,
relationship and morale lines, Skyrider and the head miners. Their `mercQuote`, `skyriderQuote` and `headMinerQuote`
events come when the queue says them, after the lines queued before, not at the step that caused them; a line whose
speaker can no longer talk when its turn comes is not said, and a save is refused while lines play (`27`).

### 4.5 Conversations in game time

As in the original (`HandleDialogue` pauses and locks the game while `ENGAGED_IN_CONV` is set; `24`), a conversation
stops the world clock and AI decisions while the tactical frame goes on: ordered walks, animations and the dialogue
queue, which says the next line when the face stops talking or at once on a click or Backspace.

- **Commands return at once.** `talk`, `approach`, `answer` on an NPC request, `unescort` in tactical, `give` and
  `openShop` do their step and return; the following ticks say the lines. An agent's `advance` runs them and stops with
  `decision` once the panel waits for a choice; under a viewer's real-time driver an NPC that walks off after its last
  line (Fatima with Enrico's letter) starts when the player sees the line end.
- **A line lasts the longer of its voice and its text, then 300 ms.** The original times a line by its sample with
  speech on and by 60 ms per character without (`SetFaceTalking`, `HandleTalkingAutoFace`), then keeps the mouth closed
  300 ms (`SetupFinalTalkingDelay`). Speech is a viewer option and one simulation serves every viewer, so the queue
  holds a line for the longer of the two (`voicedLineTicks`, `lineTicks`; voice lengths from the rule pack, `04`
  §5.10). Most original samples outlast 60 ms per character: the text length alone would leave a listening player
  behind.
- **The viewer that finished moves the line on.** The client sends `skipLine {profile, tick, talkEnded: true}` when it
  finished saying a line (its voice, or its text with speech off): only the final 300 ms remain. A player's cut (a
  click after 500 ms, Backspace, Esc with nothing queued) sends `skipLine {profile, tick}` and the face stops at once.
  `profile` and `tick` name the quote event, so a late skip does not cut the next line. With several viewers the first
  to finish moves the line on, and `lineCut` makes every screen follow; the menu greys out while `conversation.busy`,
  as `RenderTalkingMenu` shades it.
- **Agents playing alone**: the speech mode `skip` (`newSession {speech}` or `setSpeech`) ends every line on the tick
  after it is said, as if Backspace were pressed at once; its quote event carries `skipped: true`. It is a session
  setting, logged and kept across loads but never saved, so a player loading the agent's save hears the lines. Under
  the manual driver lines cost no wall time anyway; it matters when the session runs in real time with nobody
  watching.

### 4.6 Agents beside a viewer

While a viewer runs the session in real time (the browser's default), MCP `advance` runs no ticks: it watches the
real-time batches with the same stop conditions (`Session.waitInRealtime`, `AdvanceRun.observe`) and answers when one
holds, after 30 s at most with `timeout` (call again), or `refused` when real time stops. The wait holds no place in
the host's input queue, so the player's commands go through meanwhile and nothing enters the input log. A strategic
advance (`worldTime`, `worldSeconds`, `compressionStopped`, `mode`) on the map screen runs its own ticks instead, as the
browser's own advances (a compression to a world time, autoresolve slices) do: the map has no ×1 pace to keep, and the
viewer plays its frames back at the compressed pace; on the tactical screen it is refused (deviation "Advance with a
real-time viewer"). `status` shows the driver, `viewers`, the pages watching, and `timeHeld`, the reasons a viewer
holds time for (`04` §4.3): `modal` (a message box, menu or screen on the page waits for a click), the map screen's
`updateBox`, `townBox`, `moveBox`, `militia`, `menus`, `inventory`, `plotting`, `mapPaused` and `catchingUp`, and
`tacticalPause`. Real time then runs no ticks and a wait ends in `timeout` until the viewer closes it. When the last
viewer leaves, the session falls back to the manual driver and a waiting `advance` answers `refused`.

**Viewer prompts.** A box a page shows for the game, not for its player's own action, is also a prompt any client may
answer: the meanwhile box (`ok`, or `ok` and `skip` for a scene seen before, as `BringupMeanwhileBox`,
`Strategic/Meanwhile.cc:225`), the map screen's update box (`continue`, `stop`), the lost sector, invasion and
pre-battle notices (`ok`). The page publishes it with an id taken from the game event, so every page shows the same id
(`showPrompt`, `src/ui/viewer-prompts.ts`); `observe.viewerPrompts` and `status` list the open ones, and `answer` with
that id closes the box on every page as the click would (`Session.answerViewerPrompt`). A viewer's own click answers it
the same way. These answers are presentation: they run outside the input queue and never enter the input log; the
session remembers the last ones so a page that shows the box late closes it at once. Boxes a player opens for himself
(confirmations, options, saves, menus) stay his and show only as `timeHeld`.

## 5. Commands, refusals and modal states

**Commands.** `act {command: {type, …}}` → `{ok, reason?, data?}`. Every command goes into the input log and is
replayed; queries are not (§9). The conventions (gridNo, directions, sectors, inventory slots) are in the `act`
description.

**Refusals.** Every refusal of every command, queries and argument errors included, carries its machine token in
`data.refusal` and readable text in `reason`, often headed by the token (`<token>: <text>`). The sim builds them with
`refuse` (`src/sim/tactical/refusal.ts`); `CommandResult` (`src/sim/command.ts`) makes a refusal without a token a type
error. Argument errors name the argument (`badSector`, `badSlot`, `badChoice`, `badOrder`, …); a wrong prompt answer
is `noPrompt`, `wrongPrompt`, `badChoice` or the token of the disabled option. Details sit beside the token in `data`
(a hire's `charge`, a trade's `shortfall`, an exit's `minutes`). `assign` answers per soldier in `data.results`
(`{ok, refusal, reason}` for a failure) and names the first failure in `data.refusal` and `reason`, as the original
shows one box for the batch. A movement refusal (`route`, `routeGroup`, the `previewRoute` hint) names in `data.soldier`
the merc who cannot move, who may be another member of the group, as the original's box names him. Clients compare
tokens, never `reason`. The text key `refusal.<token>` (`/api/strings`, `/api/text?key=`) names the original's message
where it has one, `refusal.<token>.female` its form for a woman where the original picks the text by the profile's sex
(`escortAlone`, by the strategic merc's `female`); `REFUSAL_MESSAGES` (`src/protocol/refusals.ts`, so the client prints
it without the server) also says whether the original logs it or shows a box, and the session adds the logged ones to
the message list (§7), except for `exitSector`, whose lines the exit cursor prints (`refusalEntry`,
`src/server/message-entries.ts`).

**Modal states.** What the game accepts while something modal is open, besides `observe` and the cursor hints:

| State | Accepted | Refused with | `advance` |
|---|---|---|---|
| Prompt open (§4.2) | `answer`, `skipLine` | `promptOpen` | stops at once with `decision` |
| Shop open (§8.13) | `quoteTrade`, `trade`, `setShopPricing`, `closeShop`, `skipLine` | `shopOpen` | `refused` (`shopOpen: …`) |
| Laptop open (§8.11) | laptop commands and queries, `skipLine` | `laptopOpen` | `refused` (`laptopOpen: …`) |
| Conversation waiting for a choice (§8.4) | `approach`, `give`, `closeTalk`, `skipLine` | `conversationOpen` | `refused` (`conversationOpen`) |
| Scripted sequence | `skipLine` | `scriptedSequence` | runs it until it ends or a panel or prompt opens |
| The interrogation (flow `meanwhile`, §8.14) | `answer`, `skipLine` | `inMeanwhile` | runs; stops at its prompt and at `meanwhileEnded` |
| The endgame (§8.14) | `answer`, `skipLine` | `endgameInProgress` | plays the sequence, `ended` at `campaignWon` |
| Won and over (flow `ended`) | nothing (`status` and `newSession` work) | `campaignOver`, also for the server-only queries | `ended` at once, no ticks |
| Boxing UI lock (§8.6) | `estimateAttack`, `answer`, `skipLine` | `boxingUiLock` | runs the walk out of the ring |
| Stop-time quote (§8.1) | `estimateAttack`, `answer`, `skipLine` | `stopTimeQuote` | runs the line to its end and its prompt |

`setOption` is accepted in every state but an open prompt (`promptOpen`).

## 6. Sessions

**Creating.** `newSession` and `POST /api/sessions` take one body (`NEW_SESSION_SHAPE`,
`src/server/session-registry.ts`): the sandbox (the A9 map and squad), a new campaign, a native savegame import (`14`)
or a ja2-node save (§10). A new campaign (`createCampaignSession`, `src/server/campaign-factory.ts`) starts the way a
player starts one: `initNewGame` leaves the game in the laptop on day 1, 01:00; the squad is hired through the
laptop's own commands with real prices, deposits and refusals; then, unless `land: false`, the first `compressTime`
lets the helicopter drop load the start sector at 07:00 (`15`). `hire: []` returns the session in the open laptop.

**Closing.** WebSocket `closeSession` and `DELETE /api/sessions/:id` take the session's Dead is Dead save point (`27`)
and release it; the default session cannot be closed. WebSocket `leave` (the Main Menu of the game page) closes the
session only when no other connection watches it (`04` §5.2). Every viewer of a closing session gets `closed`; MCP
calls on it then fail with `no session <id>`.

**Campaign identity** (`src/server/campaign-id.ts`): the game page keeps the help screens' seen mask per campaign, as
the original saves it (`SaveLoadGame.cc:1916`), so `welcome.campaign` names the campaign: a random id for a new
campaign, `import:<digest>` for a native import, absent for the sandbox, `save:<digest>` for an old save without one.
It is presentation: saved in the save's presentation part and restored by a load, never seen by the snapshot, the
input log, the replay or the logic hash.

## 7. The view, events and messages

**The view.** `observe` returns the `PlayerView` (`src/protocol/view.ts`, built by the session adapters: `04` §5.3) with
labels in the session's language beside the machine tokens (`labelledView`, `src/server/text-keys.ts`; null where the
original has no string); the browser gets the same blocks in view frames when they change. Campaign blocks (a prompt,
the shop, the laptop, a conversation, boxing, autoresolve, a meanwhile, the end) are present only while the original
shows them. Our soldiers carry what the original's panels and face read (the single merc panel's numbers, the hatched
face as `canAct`, the face's enemy count as `opponents`, the End key's target as `continueTo`, the climb button's roof
edge, APs and fence as `climb`, the APs for the cheapest attack on the last target that keep the AP number out of dark
red as `enoughApToAttack`, the move's final tile behind the face's moving highlight as `destination`, the hit animation
that holds the portrait flash as `gettingHit`, the drink and adrenaline behind the face's drug icons and the light blue
AP number as `drunk` (`feelingGood`, `borderline`, `drunk`, `hungover`) and `adrenaline` (`active`, or `crash` for its
after-effect), each absent without it; strategic mercs carry the same two for the map screen's faces). The drug
counters, and so the turns a course has left, are never shown, and other soldiers carry no drug state (`12` §5).
`itemLocatorsLocked` stands while the original's item locators wait for the items-seen quote (`fLockItemLocators`,
`08`). A soldier off the ground (on a roof, climbing, a crow in flight) carries `heightAdjustment`, the pixels he is
drawn above his tile (`06`); a corpse carries it while it is not 0, the pixels it is drawn above its level (`33`). Every
soldier in the view carries `surface`, the animation sheet he shows (an index of `tables/anim-surfaces.json`, chosen by
the simulation from his state, body, hand items, wounds, water and stance), and `camouflaged` while he wears camouflage
paint, ours and theirs alike, as the screen shows both (`06`). A soldier the squad has just lost stays while he fades
out, with `fadingOut` (`06`): he can still be targeted and his hits are told, as in the original, until the fade ends or
he reaches the next tile. The tactical world (corpses, smoke, light, structure changes, blood;
`src/sim/tactical/world-view.ts`) is sent whole on every change. Its structure changes (`tileChanges`) are the map
changes since the load (`remove`; `add` at the head of the tile's structure layer, as a SAM terminal the Queen's
reinforcements repaired, `18`; `swap` in place of the tile removed just before it, a structure swapped for its partner
such as a broken window; `append` at its tail, for a tile the original adds with `AddStructToTail`: the rebel hideout's
trapdoor and crate, a SAM terminal repaired while its sector was not loaded, the structures earlier stays added, which a
sector entry and a native import add again, most wall end pieces; `object` at the head of the tile's object layer: a
destroyed structure's debris, `12`), then the pieces of a helicopter standing in the sector (`append`; `25`). The client
draws them and lights over them (`20`). `slantRoofCeilings` lists the tiles where a slanted roof that a revealed room
took off shows its ceiling, the tiles of the roof no merc has seen yet (`08`). `knownMines` lists the tiles our side
knows to hold a mine (a blue flag, a mine the militia spotted, a mine one of our mercs planted), which the
paths of our team avoid unless the tile is the destination and the militia's always; where the enemy knows mines, trap
levels, bomb timers and owners are never shown (`12` §6). Animation schedules, palettes and light sprites serve the
renderer and the devtools.

**Events** (`src/sim/events.ts` and the domain event files) come with `advance` reports; a browser gets the same in
`ViewFrame.events`. Events a command emits (a talk's lines, a shop's quotes, money events) reach the frame captured
right after the command, and the `Session` holds them for the next report.

**The message list** (`src/server/message-entries.ts`, `src/protocol/message-log.ts`): a presentation module outside
`sim` turns events, and the refusals the original prints, into entries of the original's message list
(`Utils/Message.cc`): a table, an index and arguments, never text, so every client prints them in its own language;
`quoted` marks the lines the original wraps in double quotes. The session keeps the last 256 in its presentation block:
saved, sent whole in `welcome`, new ones in frames and in every `advance` report (`messages`). The simulation never
reads them (deviation "Message list").

**Presentation events** never enter the state or an outcome: optional fields (materials, sound facts) and events for
what the original only draws or plays: impacts, trails, ripples, shattered windows, creature calls, footsteps, the
window a friendly bullet first meets in combat, where show misses moves the view (`bulletLocated`, `27` §2.4), and the
soldiers the original moves the view to (`soldierLocated {soldier, locator: none|normal|fast}`: a seen soldier not of
ours turning to shoot, our merc hit in combat, the seen NPC a trigger waits for, a seen Hicks turning hostile at night,
our merc who sights an enemy on the enemy's turn; with `slide` the view slides: to that enemy while the squad sees him,
and to an opponent turning visible in combat or before the sector's first sighting, `Tactical/OppList.cc:1916`, `:2440`;
deviation "Locates of unseen soldiers"), the items' tile the view slides to as the items-seen quote starts or an escort
sees items (`itemsLocated {gridNo}`, `Tactical/Overhead.cc:6180`), the locator at a mine a merc of ours spotted, after
his line (`mineLocator {gridNo, level}`, `Tactical/Handle_Items.cc:3154`; deviation "Mine locator"), the locator at a rotting corpse a merc comments on
(`corpseLocated {gridNo, level}`, `Tactical/Rotting_Corpses.cc:1318`), the portrait flash of a seen soldier hurt by
bleeding, gas or electricity (`damageFeedback {soldier}`, `Tactical/Soldier_Control.cc:8770`) and the interface level
the original switches to (`interfaceLevel {soldier, level}`: at every selection, a forced reselection of the selected
merc included, and when the selected merc of ours ends a climb onto or off a roof, `Tactical/Soldier_Ani.cc:261`,
`:1165`). `sectorLoaded` carries `located`, the merc a sector entry selects, whom the view centres on with his locator;
a load sends no `sectorLoaded` (deviation "View after a load"). The session copies the cosmetic animations into
`ViewFrame.effects` stamped with the session tick, and records the bullets in flight after every tick as
`ViewFrame.bullets`, since a flight usually falls between two frames. The client derives all sound and cosmetic
animation from them, the frames and the animation codes it replays (`31`); agents get the same events, never audio.

**What the squad does not see, it hears** (`08`; deviations "Sounds out of sight", "Bullets of unseen shooters"). A
source out of sight carries `heard {by, direction, volumeClass}` instead of its grid: the merc of ours who hears it
loudest by `CalcEffVolume`, the side as `TellPlayerAboutNoise` names it, the loudness class of `pNoiseVolStr`. A
`shotFired` of an unseen shooter drops `target`, `chance` and `hit`; a `soldierHit` or `soldierDied` of an unseen
victim carries `unseen` and a grid only when the attacker is seen or ours; bullets are recorded only for our soldiers
and those the squad sees. A death cry and a creature's call make no noise in the original; they are heard as loud as
the crier's loudest scream (`CalcScreamVolume`'s cap of 10 − experience level).

## 8. Commands by domain

The `act` description lists the commands with their fields and refusals, and `deviations.md` §6 how each replaces a
screen of the original. Each subsection names the domain's rule spec and code, points to those deviations and adds
what the description does not say.

### 8.1 Tactical orders

Rules: `10` (turns, §4.3), `11` (attacks), `34` (throws), `07` (movement). In a campaign every tactical order (moves,
turns, stances, attacks, doors, pickups, throws, first aid, talk, give, `select`, `endTurn`, …) is refused with
`notInTactical` off the tactical screen, which alone runs the loaded sector (`TACTICAL_SCREEN_ORDERS` in
`src/sim/campaign/campaign-sim.ts`); inventory commands work on both screens. One `stance` command carries the movement
mode the original keeps beside the stance (deviation "Stance") and refuses a height the merc cannot take where he stands
(`IsValidStance`: vehicles, the robot, water, an escort lying down, no room for the body), with the message of
`UIHandleSoldierStanceChange`; the `movementOptions` hint says which of run, sneak and crawl the movement menu offers.
`select` is the player's selection (§4.3): it refuses where `InternalSelectSoldier` returns early (another screen with
`notInTactical`, a merc out of control with `cannotAct` or `onAssignment`, one without a move in our interrupt with
`mercUnavailable` and its message, the selected merc with `alreadySelected`) and under the order locks; `group` (the
other members, possibly none) ends a real-time multi-selection: every member wakes before the selection, which is
skipped when the chosen merc is selected already, as in `EndMultiSoldierSelection`, and `data.woke` lists who woke. A
selection wakes a sleeper even when he collapsed, which `wake` refuses. `selectSquad` is the squad key's
`ChangeCurrentSquad`: it refuses a squad with nobody in the loaded sector (`squadNotHere`, `IsSquadOnCurrentTacticalMap`),
a number outside 0..19 (`badSquad`) and another screen (`notInTactical`), and takes `select`'s order locks for the
squad's first merc; the current squad itself changes nothing. A new `move` re-plans a halted move for any merc
("Continue a move") and, unless refused, drops what the merc was walking up to do (a melee attack, a pickup, a door, talk,
give, first aid or a robot reload), as `UIHandleCMoveMerc` does. A `move` with `reverse` is the Alt move (`bReverse`):
he walks or swats backwards facing away from his path, or side-steps when he faces across it, for one more AP a tile; a
body without those states, as a civilian escort's, pays the first step and stays where he is (`06`). A blinded merc who
runs and a drunk one in any move may trip from the second tile of a move on (`07`): he falls where he stands with some
APs lost, the move ends there, and `fellDown {soldier, cause: blind|drunk}` brings his CURSE1 and the original's line,
for our soldiers and those the squad sees (deviation "Falls out of sight").
`attack` takes the click's checks of a melee attack, which the original never confirms without them
(no path to a punch target, the APs with the walk: `combat/melee-order.ts`), but not the click's checks of a shot
("Attack refusals"); `pickUp` picks entries instead of the menu ("Picking up items"); its `zLevel` is the height the original's
click passes: 1 for the items lying on a structure (`height` in the view: a table, inside an open cabinet, which the
world does not draw), 0 for the floor, by default 1 when any item of the tile lies on a structure
(`GetLargestZLevelOfItemPool`, `Handle_Items.cc:1703`). On a tile that shows no item, `pickUp` without `items` is the
hand cursor's search (`Turn_Based_Input.cc:3079`): it takes the click's morale check (`refusesOrder`, and the merc says
his refusing line) but no AP check, so in combat he may stop short of the tile. An escort may neither pick up nor search:
`escortCannotDoThat`, the hand cursor's `EPC_CANNOT_DO_THAT` (`Turn_Based_Input.cc:3051`, `:3081`, `:3148`), which
`previewAction pickUp` answers too. Hidden items turn up with his
spotted-something line; otherwise, and whenever a pile is gone by the time he gets there, the `nothingFound` event
carries his NOTHING battle sound. `previewAction pickUp` gives what the cursor shows over such a tile, the walk plus a
pickup's 3 AP, of which the search pays only the walk (deviation "Hand cursor over hidden items"). A melee attack at a
soldier out of reach walks up first (`estimateAttack` gives `walkTo` and the footsteps), then strikes. A knife takes any tile of his
level, as the original's knife cursor does: at one without a soldier he stabs the ground, or cuts the head off a corpse
lying there (`11`); fists need a soldier (`needMeleeTarget`). `steal` is the hand cursor's click on a conscious hostile
soldier, with its AP check (`GetAPsToStealItem`); `previewAction` kind `steal` gives the cost and the walk the cursor
shows, and the `stealAttempt` event what came of it. Our merc's first pull of a
virgin rocket rifle takes his fingerprints and fires nothing, as the original's: `attack` answers `gunImprinted`, and
the next one fires; one imprinted on someone else is refused by `HandleItem` with `wrongFingerprint`. A launcher without
a round refuses `attack` with `noAmmo`, where the original shows the reload cursor. Out of combat, a neutral NPC with a
usable weapon who sees the merc may draw first on an `attack` made with a weapon in hand (`NPCFirstDraw`, `35`): nothing
is fired, the order is refused with `npcDrewFirst`, and the NPC turns hostile or says his hostile line. Throwing a grenade needs no command
of its own: move it to the hand, check with `estimateAttack`, `attack` the tile.

**Booby traps, switches and mines** (`12` §6). A pickup stops at a trapped item: a merc who does not notice the trap sets it
off (`trapSetOff`, a mini grenade with nobody as its owner), one who notices it (`trapSpotted {kind: item}`) warns with
his booby-trap line and the `disarmTrap` prompt opens once the line is said; a trap known before asks at once. `yes`
takes his disarm check: the item comes untrapped into his pockets, or stays on the ground when they are full
(`trapDisarmed`), or the trap goes off (`trapSetOff` with CURSE1); `no` leaves it. A switch is not picked up:
`activateSwitch` asks, and `yes` fires its frequency (`switchActivated`, the original's line). The pickup's APs are paid
all the same.

Every soldier checks for mines as he walks: the tile ahead before each step, the tiles around after each arrival. A
pressure-triggered bomb within his trap detect level stops him. Our merc stops with the whole squad out of combat,
`trapSpotted {kind: ground}` names the mine's tile, where the view moves, and he warns with his suspicious-ground line;
then `mineLocator` and the `placeBlueFlag` prompt: `yes` puts a blue flag there (a tile change, and the tile joins
`knownMines`), `no` leaves the mine known but unmarked, so nobody warns of it again and paths do not avoid it. A merc
with a metal detector anywhere in his pockets flags the mines of trap level 10 or less he finds at once, without a word;
an enemy carrying one does the same for us. A `pickUp` or search on a tile in `knownMines` asks `disarmTrap` with
`buried` for the bomb under it, before the items there and without the pickup's APs: `yes` takes his disarm check,
which digs the bomb up into his pockets, or onto the ground when they are full (a switch comes up as a remote bomb
trigger, another action item as a detonator), and takes the blue flag off (`trapDisarmed`), or sets off every bomb of
the tile (`trapSetOff` with CURSE1); `no` asks `removeBlueFlag`.

`plantBomb {soldier, gridNo}` is the bomb cursor's click (`HandleItem`, `Handle_Items.cc:758`): it takes a mine, trip
flare or trip klaxon in hand, or an explosive with a detonator or remote detonator attached, walks onto the tile (his own
by default) and plants it there; the hand item roll comes first, as for a shot (`itemBroken`). Standing he plays the
plant, which costs 3 AP at its start; crouched or prone he plants at once and for nothing. A mine goes in buried and armed
at once with 25 explosives chances: the tile joins `knownMines`, our team and the militia walk over it, and the trap
level is his explosives and experience (at most 10). An explosive with a detonator asks `bombSetting` instead, after
the walk and halfway through the plant: the turns of its timer (one more out of combat) or its frequency, `1` to `4`.
The answer takes his planting check: passed, the bomb lies armed and visible with the setting and 25 chances; missed by
20 or less, 10 chances and the setting off by one either way (in combat a timer of 1 may come out as 0, which runs
through 255 turns; a frequency of 4 as 5, which no trigger reaches); missed by more, it explodes at his feet (`bombFumbled`) and
stays in his hand. Our own planted bomb is a booby trap to our mercs who pick it up. `bombPlanted {soldier, gridNo,
item}` marks a plant. Refusals: `notABomb`, `badTile` (nobody could stand there), and in combat `noPath` before
`badTile`, then `notEnoughAP` for the walk and the plant, as `previewAction` kind `bomb` gives them; out of combat a
walk that cannot start is `noPath` after the roll. The remote bomb trigger in hand takes `useRemote` (§8.2).

These prompts belong to the loaded sector and come in `observe.prompt` of the sandbox too:
`disarmTrap {id, soldier, gridNo, buried, item?, choices}` (`item` names a trap the merc can see), `activateSwitch
{id, soldier?, choices}` (`soldier` when he is ours), `placeBlueFlag {id, soldier, gridNo, choices}` and
`removeBlueFlag {id, soldier, gridNo, choices}`, all with `yes` and `no`; `bombSetting {id, soldier, gridNo, item,
detonator: timed|remote, choices}` and `remoteFrequency {id, soldier, choices}` with `1` to `4` and no way out, as the
original's four numbered buttons. As with the original's message boxes,
one is open at a time and a second one asked for meanwhile is never shown. While the merc warns, the game stands as the
original's does: one more tactical frame, then only the line and the clocks run until it ends, and commands are refused
with `stopTimeQuote` (§5); in the sandbox, which has no dialogue, the prompt opens at once.

### 8.2 Doors, containers and remote triggers

Rules: `35` (doors, locks, traps; `src/sim/tactical/doors/`). `door` walks next to the door, then acts, unless he gets
there while dialogue plays or another merc still walks up to give an item: then the original drops the action and he
only stands there. `open` on a locked door answers the door menu as data after the start-of-menu trap check;
`openManually` is the menu's open button (deviation "Door menu"). `close` by our merc answers vanilla's closing menu
(`{closed: false, options}` and a `doorMenu {closing: true}` event), where only `closeManually` is enabled; other
soldiers close at once (deviation "Closing an open door"). A door swings for up to 375 ms after it changes; an order to
act on it meanwhile stops the merc (`{started: busy}`), as `InteractWithOpenableStruct` does, and advance may reach idle
before the door stops. A door that changes out of the squad's sight raises no `doorChanged` and keeps its place in
`openDoors` until a merc sees it. Containers and switches take `open` and `close` with the
original's walk-up and `HandleStructChangeFromGridNo`; a sector remembers which were open when it is left. `useRemote`
presses the remote trigger in hand: the O3 statue's at once (`26`, deviation "Remote trigger"); the remote bomb trigger
after its hand item roll (`itemBroken`) for 2 AP, standing through its animation for 2 more, then `remoteFrequency`
asks, and the answer sets off every armed remote bomb of that frequency through the bomb queue (`remoteUsed {result:
bombs, frequency}`).

### 8.3 Inventory, money and first aid

Rules: `12`. D15: everything the inventory panel, the item description box, the reload and medkit cursors and the money
box do is a command on the original's code paths (`src/sim/tactical/inventory-panel.ts`, `inventory-commands.ts`; the
map screen's `src/sim/campaign/map-inventory.ts`; `money-flow.ts`). The API replaces only the item cursor: a command
picks up, places and returns what is left in the cursor the way the original's cancel does (`CancelItemPointer`: the
slot it came from, else a free pocket, else the feet; on the map screen the sector inventory; deviation "Item
cursor"). A placement runs on copies first, so a refused move changes nothing. The message boxes for merges and
permanent attachments become refusals to repeat with `merge` or `permanent`; the description box charges its AP per
command (deviation "Attachment AP"). On the map screen the same commands cost no AP and pass items within one sector
only; the `passTargets` hint names the mercs an item held there could pass to (`src/sim/campaign/item-passing.ts`), the
only ones the map screen makes the info character while it is held, with the enemy in the loaded sector read from the
view (deviation "Strategic hints and enemy counts"). Money moves through the cursor in the original: `withdrawCash`, `depositCash` and `splitMoney` do the click and
the drop at once (`splitMoney` on the map screen too, within a sector like `moveItem` there); money for another soldier
is `give`, for a dealer `trade`. `moveKey` is the key ring popup with the cursor (`src/sim/tactical/key-ring-panel.ts`):
`{ring}` names a position, which the view's `keys` give as `position` (deviation "Key ring cursor"); one key taken off a
stack in a slot, by `moveKey` or `moveItem`, keeps the lock of the stack (deviation "Single key off a stack"). The
commands of the item cursor take keys off the ring with `slot: {ring}` and `count` (`src/sim/tactical/item-source.ts`):
`drop`, `toss`, `pass`, `give` and `previewAction` kind `toss`, and on the map screen `moveItem` with `from: {ring}` to
the ground and `discardItem`; the keys leave the ring when the command acts, a give's with the order as money split off
a pocket does, and what a pass or the stash leaves goes back onto the ring. The strategic view lists our mercs' `keys`
as the soldiers' do, and on the map screen `moveKey` and `combineStack` work for every merc with an inventory there,
with the map's passing rules. CTRL+click is `combineStack` (`src/sim/tactical/stack-cleanup.ts`): `soldier` holds the
cursor and `from` names its objects (a slot, with `index` for one object of its stack; `{ring}`; `{magazine: slot}`, the
gun's magazine taken out in the description box; `{attachment, slot}`), `toSoldier` owns the stack in `slot` when it is
another merc's; without `from` the stack is only cleaned up. Another merc's cursor needs 3 AP of each conscious merc in
combat and charges none; on the tactical screen an attachment or a merge onto a hand or armour slot comes first
(`useAttach`, `mergePrompt`), on the map screen the cleanup comes first and the client still picks the stack up, as
`MAPInvClickCallbackPrimary` does. `data.left` counts the objects still in the cursor; one object taken from the clicked
stack itself goes back on top of it, at `data.index`.
`applyItem` is the cursor dropped on the single merc panel's portrait (`SMInvClickCamoCallback`): one object of the
stack, `index` for the one the stack popup picks, `count: 'all'` for the SHIFT stack (`BeginItemPointer`). Drugs and
drinks cost no AP (`src/sim/tactical/drugs.ts`, `12` §5); syringes are no drug (`cannotApply`). As with `combineStack`,
`data.left` counts the objects still in the cursor, which the original keeps for the next click, and one object left
goes back on top of its stack, at `data.index`. `itemApplied` names the canteen's drinking sound by the drinker's
profile (`sound`, `Tactical/Items.cc:3458`); the client says COOL1 after the other items, as the panel does.
`switchHeadGear` is CTRL+N for a squad (`src/sim/tactical/head-gear.ts`); the key alternates the night and the day
gear, night first, and the client keeps that turn.

The item cursor's click on the map (`HandleItemPointerClick`) is one of four commands, picked as the original picks its
branch (`src/ui/screens/tactical/input/item-tile-cursor.ts`): `give` to a talkable soldier (a named NPC, an escort, the
robot; after the right click's swap a squad mate instead, while an NPC or an escort takes a toss), `drop` with `gridNo`
on the merc's tile or the next one, `pass` to a merc of ours within 3 tiles who is no escort and no vehicle, and `toss`
for anything farther or anybody else (`src/sim/tactical/item-pointer.ts`, `toss.ts`). `drop` puts the object beside him
when that tile is no place to stand on or one step away (`DROP_ADJACENT_OBJECT`, `itemDropped` with `beside`), else at his
feet. An escort, an unconscious merc and a swimmer in deep water click for nothing (`Interface_Items.cc:3146`): `drop`,
`toss` and `pass` refuse them as `cannotDrop`, `cannotToss` and `cannotPass`, and `give` as `giverCannotGive`; an
escort takes a give like a named NPC (`Handle_UI.cc:4606`) but never a pass or a catch. `pass` charges both mercs their
3 AP before the object goes into the catcher's pockets, so a catcher without room
for all of it keeps what fits and both have paid (`data.passed` false and `passFailed`). `previewAction` kind `toss` is
the cursor's landing tile (`landsAt`, `landsOnLevel`, `pathClear`) with the refusals of the command but its AP.

### 8.4 Conversations

Rules: `24`. A conversation with a named NPC is a modal talk session (`src/sim/campaign/talk-flow.ts`) over the NPC
records and the dialogue queue (`src/sim/narrative/`); deviation "Talk session time". `talk` runs the original's checks
in its order, walks up beyond 4 tiles (the talk starts on arrival during `advance`) and returns at once with the talk
reply; the lines follow in game time (§4.5) as quote events, collected in `conversation.lastQuotes`. An idle open
session is modal (§5). A scripted sequence (`ENGAGED_IN_CONV` without a panel, a pending conversation, the 500 ms
trigger wait) refuses player commands until `advance` has run it. Saving is refused throughout (`27`). The talk face
shows what the original's face without a soldier shows: Elliot's beaten variants (`faceVariant`) and, with `drunk`,
the drink icon of Father Walker or Micky from a drink counter of 5 (`Tactical/Faces.cc:944`).

**Quote text.** The simulation carries only `textKey {file, row, width}` and `chars` (the line's length in characters,
which times it), never text: not in state, saves, the input log or stored events. The session resolves keys to `text`
in `observe`, command results and events (§10).

### 8.5 Giving, recruiting, escorts and the robot

Rules: `24` (giving, recruiting, escorts), `25` (the robot). `give` is the drag of an item onto a soldier
(`src/sim/tactical/give.ts`, `src/sim/campaign/give-flow.ts`): it returns at once, and the walk, the hand-over and, to
an NPC, the `GIVINGITEM` conversation run during `advance` as a scripted sequence (deviations "Give command", "Returned
items", "Giving to a dealer"). To a squad mate or a recruited R.P.C. the whole source pocket is emptied even when one
item of a stack was given, as in the original. Recruiting has no command: `approach recruit` runs the NPC's records,
the pay or escort requestor opens an `npcRequest`, `answer yes` triggers the recruiting record, and the recruit gets a
new soldier id on our team (`ChangeSoldierTeam`). `unescort` is the assignment menu's "remove escort" (deviation
"Releasing an escort"). The robot takes orders only while a conscious non-escort of its squad in its sector wears the
remote control in a head slot (`src/sim/campaign/robot-control.ts`).

`give` to the robot reloads its gun instead (`src/sim/tactical/robot-reload.ts`): it needs the walk plus 4 AP and ammo
of the gun's calibre (else `robotNeedsCalibre` with the gun's `calibre` index), takes one object off the pocket at once
and returns `{reload, walking, to}` or `{reload}`; the merc walks next to the robot and kneels, and at the end of his
animation the robot reloads from the given object, paying the reload's APs in combat, with the `reloaded` event. What
is left of the object, or the robot's old magazine, goes into the merc's pockets, and is lost when they are full, as
in the original. A move, stop, collapse or a robot gone from its tile puts the magazine back (deviation "Robot reload
without the reload"). `previewAction give` on the robot answers `reload: true` with the walk plus 4 AP.

### 8.6 NPC actions, civilians, surrender and boxing

NPC actions (`35`, `src/sim/tactical/narrative/npc-actions/`), NPCs acting on their own (`24`: approaches, assassins,
first sightings, hostile declarations, guides) and schedules (`35`) have no command, prompt or view field of their
own: their lines arrive as quote events and their effects where they always show (history lines, mails, the shop,
soldiers in sight, `doorChanged`). A requestor action closes the panel and opens an `npcRequest` prompt (deviation "NPC
requestors"); the answer runs the original's callback, then the queue as `talk` does. `talk` to an unnamed civilian, a
militiaman or a visible enemy with a merc body opens no panel and answers a civilian quote
(`src/sim/narrative/civ-quotes.ts`, deviation "Civilian quote boxes"). The enemy's surrender offer is a `surrender`
prompt with `context: tactical`; the sandbox declines it at once (deviation "Surrender in tactical combat"). Boxing
(`25`) is played with `talk`, `answer`, `give`, `move` and `attack`; after a round the boxing UI lock of §5 runs our
boxer out of the ring (deviations "Boxing UI lock", "Abandoning a fight").

### 8.7 Strategic map, travel and squads

Rules: `16` (map, movement, sector entry and exit), `17` (the Queen), `15` (time); `src/sim/campaign/commands.ts`,
`sector-exits.ts`; views `src/server/strategic-view.ts`, `map-screen-view.ts`. There is no "exit tactical" command: the
strategic view is always observable, and a sector is left by `exitSector` or by routing everyone away. `route` checks
the whole group's move first, so a squad cannot leave the start sector before it is cleared; `extend` appends legs like
the map screen's plotting, otherwise the path is replaced. As in the original, a move from the loaded sector during a
bloodcat ambush is refused as `inCombat`, and a merc standing in the museum rooms of L12 while any merc carries the
chalice and Eldin lives as `museumChalice` (`src/sim/strategic/forces/move-permission.ts`); the hints check neither, as
the view has neither the encounter nor the rooms. A merc awake with `breathMax` below 30, or asleep and `collapsed`,
refuses a move as `tooTired` (in a vehicle only the one who must drive); a group that has such a merc when it reaches a
sector short of its destination stops there: its paths are cleared, compression stops (`halted`), each such merc says
his need for sleep (the next ones "me too") and drops asleep, `collapsed` until rested (`fellAsleep {collapsed: true}`),
so `wake` refuses him. `routeGroup` is the move box: mercs parting from their unit regroup on this command rather than
at Done (deviation "Move box regrouping"). `enterSector` loads with automatic placement (deviation "Tactical
placement"); `exitSector` applies the exit dialog's rules (deviation "Exit dialog") and is a query with `dryRun: true`.
On a creature lair level after the creature quest, `strategic.surfaceWarp` names the surface sector the exit dialog
first offers (so does `exitSectorOptions`); `exitSector` with `warp: true` at a valid exit takes every conscious merc of
the sector there and loads it (`campaign/sector-exits.ts`).

### 8.8 Vehicles and the helicopter

Rules: `25` (Skyrider, billing, SAM hits, hovering), `16` (vehicle movement); `src/sim/campaign/helicopter-flow.ts`.
The helicopter exists once the escorted Skyrider reaches his chopper or a native save owns it; its commands work on the
map screen only (deviation "Helicopter interface"). `heliPlot` is the click on the helicopter before plotting:
Skyrider's greeting or why he cannot fly, and once the empty-helicopter hint as a refusal; `heliRoute` without
`plotted` asks him the same way first. `route`, `cancelRoute` and `shortenRoute` for a merc aboard act on the
helicopter. Passengers can neither leave nor change squads while it flies (deviation "Leaving the helicopter in
flight"). Ground vehicles move through a passenger's `route`.

### 8.9 Towns, militia, mines and assignments

Rules: `18`. `assign` runs `SetAssignmentForList` per soldier in the given order, each checked on its own; the original
shows one failure box for the batch, so `data.refusal` names the first failure (§5). Militia training asks before it charges:
`assign trainMilitia` opens `militiaPayment`, a finished session `militiaContinue` (deviation "Militia payment and
continue prompts"). `distributeMilitia` is the AUTO button and keeps the original's rule that the militia of a sector
with hostiles are dealt out while they also stay there (`18`). A merc who joins another squad (`assignSquad`, `assign`
to a squad, a vehicle left, a hit while on another assignment) wakes unless he collapsed, as `AddCharacterToSquad` does.
The events the original pairs with `StopTimeCompression` or a box stop a strategic advance. The hint
`assignmentOptions` shades the menu (§9).

### 8.10 Battles: pre-battle, autoresolve and retreat

Rules: `19`; `src/sim/campaign/battle-flow.ts`, `pre-battle-panel.ts`; views `src/server/battle-view.ts`. The
`preBattle` prompt freezes time until `answer` (deviation "Pre-battle interface"); saving is refused while it is open,
as the original disables the options button. Automatic starts open no prompt: a `preBattle {autoStart: true, panel}`
event carries what the panel showed with Autoresolve pressed, and autoresolve begins. The OK box the original opens
before the panel of an arrival comes as the event's `notice`: `bloodcatAmbush`, `bloodcatLair` or
`unconsciousMercsAttacked` (no merc able to fight and no militia); an invasion's box is the `invasion` event.
`showBattle` opens the non-persistent panel where the original calls `InitPreBattleInterface(0, false)` (a click on the
battle sector while the locator is on, a compression attempt during a tactical battle), with its side effects;
`autoresolveBattle` skips the panel (deviation "Non-persistent pre-battle interface").

**Autoresolve is a flow** (deviation "Autoresolve session"): world time is frozen and `advance` runs slices of 1000
battle ms, one per 200 ticks (`TICKS_PER_AUTORESOLVE_SLICE`): `{idle}` to the end or a prompt, `{ticks: n}` ⌊n / 200⌋
slices (so a real-time driver paces it), `{events}` up to the slice in which one happened. Under the instant driver
`answer autoresolve` runs to the first stop at once. `autoresolveRetreat` applies before the next slice. The end opens
`autoresolveDone`: `bandage` answers and reopens it, `done` returns to the strategic flow.

### 8.11 Laptop and hiring

Rules: `21`; `src/sim/campaign/laptop/`; views `src/server/laptop-view.ts`, `personnel-view.ts`. The laptop is a modal
flow (deviation "Laptop as commands"): a new game starts in it, `openLaptop` opens it from the map screen, and the clock
stands still while it is open. One command per decision of the pages: `aimHire`, `mercHire`, `impCreate`,
`bobbyRayOrder` (the whole cart, atomic), `insure`, `orderFlowers`. `visitSite` is entering a page where entering has
effects: Bobby Ray's construction mail, bookmarks, the M.E.R.C. visit counter and Speck's opening, the florist order
form's draw (deviations "Speck's opening", "Florist order form entry"). The I.M.P. draft stays in the client until
`impCreate`. The laptop's queries answer before money moves; `emailText` is answered by the server's campaign adapter
(`src/server/campaign-session.ts`, `mail-text.ts`) with the original's substitutions and the I.M.P. report, not by the
simulation, and goes through the command path although it changes nothing. Silent profile changes (a merc back home,
away, dead elsewhere, the M.E.R.C. outage) raise no event; they show in the view.

### 8.12 Contracts

Rules: `22`; `src/sim/campaign/contracts/`. Map screen only: the original has no contract menu in tactical. A merc who
refuses an extension says so: `extendContract` answers `ok: true` with `extended: false` and the reason. The renewal
sequence, the departure box and the insurance box are prompts in `observe.contractPrompt` (deviations "Contract renewal
sequence", "Contract prompts"). The renewal menu and the departure box wait behind the merc's lines in the dialogue
queue, as in the original: a `dismiss` or a renewal opens its prompt once his lines are said, so `advance` stops with
`decision` then. `contractOptions` gives the renewal menu's options and shading without opening the sequence.

### 8.13 Merchants

Rules: `23`; `src/sim/campaign/shop-flow.ts`, `src/sim/strategic/economy/merchants/`. A shop is a modal session: the
clock stands and saving is refused (deviations "Shop as commands", "Shop deduction prompt", "Unsellable shop items",
"Pricing merc", "Refused gift"). `openShop` checks in the original's order and refuses with the first failure; with NPC
records it goes through a conversation (deviation "Talking to dealers"). `trade` is one `PerformTransaction`,
validated before anything changes; deliveries go in offer-area order, with drops VISIBLE at the receiver's tile.
`quoteTrade` answers what pressing the button would show, `dealerCannotAfford` included, which the player learns only
by pressing it (its `refusal` is the `data` a refused `trade` carries), and the shopkeeper quotes the trade would emit,
which the client plays as items are offered (`EvaluateItemAddedToPlayersOfferArea`). Its `poa` lists the player's offer
area as the trade leaves it, the parts a repairman splits off included, each with the offered pocket it came from as
`source`. The `compatibleItems` hint with `rule: shop` names the items the shop screen outlines for the one under the
pointer (`IsGunOrAmmoOfSameTypeSelected`).

### 8.14 Quests, meanwhiles and the ending

Rules: `25` (quests), `26` (meanwhiles, prisoners, the end). Scenes and the ending are not player actions and have no
command or prompt of their own; the flows `meanwhile`, `endgame` and `ended` lock the UI as the original does (§5).

- **Quests** are hidden state: `strategic.quests` (`src/server/quest-view.ts`) lists only quests with a "started" or
  "finished" history line, so a quest changed without one (Alma's skip, a silent restart) stays invisible.
- **Meduna scenes** (`src/sim/campaign/meanwhile-flow.ts`) resolve with the original's "played" semantics once their
  gates pass; on the map the clock stops (`compressionStopped {reason: meanwhile}`), and while a scene waits for its
  gates compression is refused.
- **The interrogation** is a scripted tactical scene in N7 played in the `meanwhile` flow: the Queen's lines are a
  conversation, her lie question an `npcRequest`; `advance` stops at the prompt and at `meanwhileEnded`.
- **The end** (`src/sim/campaign/endgame-flow.ts`): `queenKilled` starts the `endgame` flow and `advance` plays the
  sequence; with the creature quest open `endgameDeferred` stops it and the campaign plays on until
  `creatureQueenKilled`; `campaignWon` ends it. There is no game over: with no usable merc left compression is refused
  and `status.noUsableMercs` is true.
- **Native saves** taken during a played scene or the endgame sequence are refused on import; one taken with no sector
  loaded continues on the strategic map with none loaded, one taken on the map screen with a sector loaded continues on
  the map with it loaded (`tacticalScreen` enters it), one taken in tactical in tactical (`14`).

## 9. Queries and cursor hints

Queries are commands that change nothing: the cursor hints (`src/sim/hints/`, `answerHint`), `exitSector` with
`dryRun`, and the server-only kinds. Cursor feedback (path and AP under the pointer, chance to hit, drop targets,
plotting ETAs, enabled menu lines) is computed as the original computes it, with the rules' own functions, in the
browser (`28` §4) and on the server, over the player-knowledge projection (deviation "Cursor hints on the
projection").

**The projection** (`src/sim/knowledge/`, `knowledgeWorld`) builds from a player view and the rule content the minimal
world the hints read. In tactical it is a `TacticalState` over a fresh copy of the sector's world with the view's
doors, containers, items, known mines and light, the loaded sector of the strategic view (`worldSector`, which the phobias read), our
soldiers in full and the seen soldiers with their visible fields only: unseen
soldiers do not exist, so they block no path, absorb no bullet and are no target. On the map it is a minimal strategic
state from the strategic view. In strict mode (tests) every unsupplied field throws (`guard.ts`,
`UnsuppliedFieldError`), so a hint that reads hidden state fails at once; each such read was decided: supplied by the
view, given a neutral value (deviations "Movement penalty in the estimate", "Other soldiers in the projection") or
dropped (the melee chance to hit).

**Server-only queries** (`SERVER_QUERY_KINDS`: the laptop's quotes and checks, `quoteTrade`, `contractOptions`,
`inventory`) depend on state the player does not see or price a decision; the query service passes them to the
simulation's own handlers without logging. `src/server/query-purity.test.ts` runs every one and compares the session
snapshot byte for byte.

**The channel.** WebSocket `query` → `answer`; `SessionHost.query` answers between ticks, outside the input queue,
never logged, with no frame and no instant-driver advance. `isQueryCommand` routes a query arriving as a command (MCP
`act`, WebSocket `cmd`) the same way. `QueryService` (`src/server/query.ts`) keeps the world inputs and rules per
content and builds the projection per query.

**Answers over the view the viewers hold.** While time stands, commands change the view without a step, so a tick does
not name a view. While a session has viewers it answers every query over `sentView` (the welcome with every published
frame applied by the client's own `applyViewFrame`) and welcomes a later viewer with it; frames and answers share one
ordered socket, so an answer arrives on exactly the view it was computed on, and its `tick` is that view's. Without
viewers (MCP only) queries use the current view.

**Fairness** (D16; deviations "Attack estimate target", "Melee chance in the estimate", "Hints of actions with hidden
checks", "Strategic hints and enemy counts", "Gates outside the hints"): an unseen enemy on the target tile or the path
changes no answer (`src/server/hints-fairness.test.ts`), and strategic hints read only the enemy counts the view
shows. Client and server agree by construction: the same code (checked by the engine commit) over the same inputs
(checked by the rule pack hash); the scenario suites compare them over sampled points (`tests/support/hints*.ts`). The
plotting ETA of `previewRoute` and `previewHeliRoute` keeps the original's count of the remaining leg twice while a
group travels (`MapScreen.cc:7142-7153`, `30`).

## 10. Text, saves and options

**Text.** The simulation holds no text (§8.4). The session resolves text keys in `observe`, command results and events
(`TextService`, `src/server/text-service.ts`) and labels UI tokens in the session's display language; what the data
version and the display language each decide: `31`. Clients fetch the tables themselves: `GET /api/strings?lang=`
gives a language's UI string tables (the `L10n` arrays and the per-language files under their Stracciatella names) and
`keys`, the map from machine tokens to `{table, index}` (`TEXT_KEYS`, `src/server/text-keys.ts`); `GET /api/text`
resolves one EDT record cell with its layout (`data/tables/edt-layouts.json`) or one UI string by table or key.

**Saves** (`27` owns the file, the rules, the modes and the autosaves). Clients pass names, never paths. MCP has the
`save`, `load`, `listSaves` and `deleteSave` tools; HTTP has `GET /api/saves`, `POST /api/sessions/:id/{save,load}`,
`DELETE /api/saves/:name`, download and upload at `/api/saves/:name/file` (an upload is parsed and checked before it is
written) and the developer-only `POST /api/sessions/:id/snapshot`, which ignores the save rules; the WebSocket has
`save` and `load`. A load in place sends every viewer a fresh `welcome`, after `stopped {reason: 'loaded'}` when a
real-time driver ran (it becomes manual). `status`, `GET /api/sessions` and `observe` show `saveMode`, `canSave` and
`saveRefusal`, so an agent need not try. A load is a player load by default: as in the original the dialogue queue is
emptied and the line being said ends, so lines queued at the save and what they lead to (a contract ending) are
dropped, and the main stream is reseeded, the seed returned and logged (deviation "Player loads"); `reseed: false` is
an exact load for experiments and bug reports, which keeps the queued lines.
`gameSaved` and `gameLoaded` come with the next report; autosaves and Dead is Dead saves send none, as in the original.

**Options** (`27` §2). The game options are chosen once, in `newSession {campaign: {options}}`; `setOption
{bloodAndGore}` (logged and replayed) is the only one that changes during a game, as on the original's options screen.
Client settings (volumes, subtitles, display toggles, …) live in the browser and never reach the simulation; agents
have none. The server computes the music mode from the events, so every client hears the same (`31`); MCP `observe`
carries no music and no sound.

## 11. Endpoints for the player UI, and diagnostics

- `GET /api/sessions/:id/profiles` (`src/content/narrative/profile-presentation.ts`): names, faces and bios for the
  client's faces and pages; on stubs from `stubs/profiles.json`. A profile free for I.M.P. is listed only once a
  character is created there (`profileFaceRecords`, `src/server/campaign-session.ts`), so the map and tactical screens,
  which fetch the list again when the team shows a profile they do not know, pick up a character created after they
  loaded; the laptop fetches it again after `impCreate` (`src/ui/screens/laptop/imp/imp-pages.ts`).
- `GET /api/items?lang=` (`src/server/item-catalogue.ts`): the item catalogue with names, descriptions, graphics and the
  numbers the client's screens print.
- The game page's test switches (URL parameters `holdTime=1`, `pinClock`, `shadowHints=1`) and its `window.__ja2Ui`
  hook (`src/app/game/ui-hook.ts`) serve the e2e tests and frame measurements (`28`).
- **Diagnostics.** Ctrl+F on any screen toggles Stracciatella's FPS overlay (`src/sgp/FPS.cc`) with ja2-node's own
  lines: the pointed cell, frames and the page's JavaScript time per frame, the ping round trip and the server's
  event-loop delay, playback lag, the oldest unanswered request and the slowest reply, the session's input queue, and
  the open `/vfs` reads; a line turns light red past its threshold (`src/ui/diagnostics-overlay.ts` draws,
  `src/app/game/diagnostics.ts` samples). While the overlay is on the client sends `ping {id}` once a second; the
  WebSocket answers outside the command order with `pong {id, health}`: `SessionHost.health()` gives the tick, the
  inputs in the host's queue, the last finished input with its wait, run time and ticks, and the largest event-loop
  delay since the previous call (the worker host takes the larger of its worker's and the main thread's). Nothing is
  logged.
