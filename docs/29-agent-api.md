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

**Observing less.** `observe` with `fields`, a list of top-level keys (`["soldiers", "combat", "prompt"]`), answers only
those (`src/server/observation.ts`, the one function behind the tool). It only leaves keys out (D16): a named key the
observation does not carry now stays absent, and an unknown key is refused with the list of the valid ones, which the
compiler keeps equal to the keys of the observation's type. Measured on the stub pack, a new campaign with six mercs
landed observes about 45 KB (`strategic` 25 KB, of it `mercs` 14 KB and `sectors` 6 KB; `soldiers` 15 KB) and a new
game in the laptop about 34 KB (`laptop` 21 KB, of it the A.I.M. listing 12.5 KB). Building the whole observation takes
about 2 ms, so the filter runs on the finished observation instead of skipping parts of it.

**Strengths and limits.** Turn-based combat, strategy and management suit an agent; the queries spare it the
arithmetic. Spatial reasoning over JSON (cover, elevation, roofs) is the weak part; `sectorExits` and `sectorLayout`
(§9) give the sector's exits and a text picture of it. Real time is played through the
manual driver, which pauses between any two ticks, or by waiting on a viewer's real time (§4.6); real-time control by
an LLM agent without pausing is a non-goal.

**Not built as commands** (the client shows it disabled): the placement GUI (gaps "Tactical placement").

## 3. Fairness: what the agent never sees

The agent sees what the player's screen would show (D16, `04` §5.3): a view block or field exists only while an
original screen shows it, events about what the squad does not see are cut down to what it hears (§7), and the cursor
hints run over a projection of the view (§9). Where the original's UI read hidden state, the hint drops the answer (the
melee chance to hit is `null`) or leaves it to the command, which decides on the full state and refuses with the
original's message. Per domain:

| Domain | Shown | Never shown |
|---|---|---|
| Tactical | Our soldiers in full, with what the original's panels and face read; others in sight with their visible fields, the sheet they show, their camouflage paint, `hostile` and the health category, and for a few 60 ms steps a soldier the squad has just lost (`fadingOut`, as the original draws him fading); doors with the lock and trap state the player knows | Others' life, but a vehicle's in sight and the bars of a speaker whose face popup draws them (`bars` on his line, §4.4); unseen soldiers (absent from the view, events and hints, but for the tile and radar colour of those an x-ray detector shows); lock tables, trap levels, lock damage; exit grids in a room until their tile is revealed (`sectorExits`) and the inside of a room under its roof (`sectorLayout`) |
| Sound, bullets, blood | The side and loudness of what the squad hears; bullets of shooters we see; blood pools as the squad last saw them (deviation "Blood on the ground") | The grid of an unseen source; bullets of unseen shooters |
| Conversations and NPCs | Lines, the menu, requests, NPCs in sight | Facts, quest states, records and their conditions, desire, approach values, opinions, NPC inventories and cash, balances beyond what a message printed (Kingpin's, the hospital's modifier and refund), profile whereabouts and schedules (`npcMoved` is not an event), NPC system events |
| Strategic map | Enemy counts by the player's knowledge (`16`), our groups; seen enemy soldiers in tactical show their class through the uniform | The Queen's state: garrisons, compositions, group routes, intentions, pool, alertness and the event queue (her evaluations, enemy arrivals, creature attacks, NPC timers, scheduled meanwhiles); enemy groups other than through the counts |
| Towns and mines | Loyalty once started and where the town uses it; mine status in the town box's order | Remaining ore, which mine will deplete |
| Helicopter | Debt, hits, safe and unsafe sectors, route cost | Skyrider's talk state and accumulated bill |
| Vehicles | Our vehicles with the condition and fuel percentage; the others a merc of ours could board; the condition and fuel percentage of any vehicle in sight, as the bars over it show them | The condition and fuel of other vehicles out of sight; fuel finer than a percent; other vehicles in the vehicle list, an enemy's tank among them |
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
choice, also one an NPC opened (`initiatedBy: npc`, deviation "Conversation prompt"); an open shop; the question a won
battle asks about auto-bandage once its lines are over (`beginAutoBandage`, §8.3) and its look for someone else in the
sector (`someoneElseInSector`, §8.10); the box of a meanwhile scene seen before (`meanwhile`, §8.14); `advance {idle}`
runs on until they open. A running `advance`
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
  (the merc selected when the squad left, else the first who may act, forced, then the return's), the helicopter drop
  (the first merc down, forced, and its first seat as the helicopter leaves or the Esc skip lands the rest), the end of
  the selected merc's skull, his removal from his squad or from the sector (the next merc of his squad, after a removal
  from the sector also the first of the next squad on the map).
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
  a talk and `openShop`, which stands for it, an escort's recruitment, a hospital assignment, and the close of the
  assignment menu, which every accepted `assign`, `assignSquad` and `unescort` in tactical stands for with its choice
  (`RebuildCurrentSquad`, `Strategic/Assignments.cc:5463`; on the map screen it changes nothing, as `SetCurrentSquad`
  returns there). A native save resumed in tactical selects its selected merc again, forced, before the screen entry; a
  ja2-node save restores the selection and the current squad as they were (deviation "Selection on load").
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
compression itself, at 5 world minutes per second unless `mode` says otherwise, and stops where the original stops it
(`04` §4.2); the clock's `canCompress` and `compressRefusal` say beforehand whether it would start. A timed bomb ticking
on the loaded map refuses compression (`activeTimedBomb`) until it goes off or the sector unloads. `status.flow` names
the flow (`tactical`, `strategic`, `autoresolve`, `laptop`, `meanwhile`, `endgame`, `ended`); `mapScreen` and
`tacticalScreen` switch between the first two like the original's screen toggle, and the loaded sector stays frozen on
the map but for the real-time turn below (deviation "Map and tactical screens"). `tacticalScreen` lifts the clock's
`paused` unless the player paused (`15`). A head miner's line other than "creatures gone" takes tactical to the map
screen before it is said (deviation "Head miner map switch"). The sleep and wake notification is a client setting: an
agent that wants the original's stop passes `events: ['fellAsleep', 'wokeUp']` beside its time target.

**Exits from the map.** `tacticalScreen`, `enterSector` from the map and `openLaptop` share the checks of the original's
exits (`AllowedToExitFromMapscreenTo`, `src/sim/campaign/map-screen-exits.ts`): each is refused while lines wait in the
dialogue queue (`dialogueQueued`), while a meanwhile scene is about to start (`meanwhileStarting`), while a pause lock
holds (`pauseLocked`: a line said on the map, below, among others), during the contract renewal sequence
(`renewalSequence`) and while a battle is about to begin (`battlePending`); `enterSector` to another sector also while a
battle goes on in the loaded one, a bloodcat ambush included (`battleElsewhere`). The clock's `exitRefusal` names the
first shared check that holds while the map is up, and the `canEnterSector` hint answers it after an open prompt and
before its own checks. Advancing past the lines opens the way: `advance {idle}` once compression is stopped (an
`advance` that ended at `compressionStopped` leaves it stopped; otherwise `stopTime` first), or `advance {ticks}`. The
client keeps its Laptop, Tactical and Options buttons and its save keys shut on the same token, and on its own boxes as
the original does (an item held, the town box, the militia popup, the sector inventory).

While time is compressed the map screen runs the real-time turn every 20 ms of real time, at every speed, for every merc
of ours wherever he is and for the loaded sector's soldiers (`15` §2): wounded mercs bleed, tired ones get their
breath back, drugs wear off and the regeneration booster heals once per turn. Bleeding, breath and drugs per world
minute therefore depend on the speed: twelve times more at 5 minutes per second (the default) than at 60, so a wounded
merc loses about twelve times less life over a stretch compressed at 60 minutes per second. A merc who bleeds to death
on the map stops compression with `compressionStopped {reason: 'mercDied'}` after his `mercDied`, which ends an `advance`
unless it passed `compressionStopped: false`. Bleeding and dying lines pause the map while they are said (below).

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
takes no lock and leaves the pause; while lines wait in the queue `compressTime` is refused with `dialogueQueued`, and
the exits from the map with `dialogueQueued` or, while a line is said under its lock, `pauseLocked` (above). The
strategic lines go through this queue as in the original: assignment done, the tired complaint, contract,
relationship and morale lines, Skyrider and the head miners. Their `mercQuote`, `skyriderQuote` and `headMinerQuote`
events come when the queue says them, after the lines queued before, not at the step that caused them; a line whose
speaker can no longer talk when its turn comes is not said, and a save is refused while lines play (`27`). A Skyrider
or head miner line carries `panel` when a monologue (`{monologue}`) or the miner's mine (`{mine}`) placed the map
screen's face popup since the last line ended, `sector`, where the map screen's locator goes as it starts
(`helicopter` when that is Skyrider's helicopter), and `soldier` when a soldier has the speaker's profile, whose panel
the face popup takes, with `bars` `{life, lifeMax, bleeding, breath, breathMax, morale}`, his bars the popup draws while
he talks; a merc line without a soldier carries his profile's `sector`, and an `npcQuote` the `sector` of the NPC's
soldier or profile (none in a meanwhile) and, said on the map screen, his soldier's `bars`, which the popup a switch to
tactical gives the line draws. A Skyrider monologue brings `skyriderMonologue {topic, step}` as it
starts (`step` 0) and as the queue reaches each of its special events (1, 2): the map screen turns its airspace filter on
at each, and while he talks about them `strategic.skyriderHighlights` names the sectors that flash red there (the SAM
sites, the Cambria hospital or Estoni), in place of the speaker's locator.

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
  as `RenderTalkingMenu` shades it. A merc's face the original deletes while he talks (he leaves the team, is released
  as an escort, is married off or turns hostile with his civilian group, or Larry's profile swaps) ends his line on that
  tick: `soldierFaceDeleted {profile, saidAt}`, and the next line follows.
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
answer: the meanwhile box of a scene not seen yet or the interrogation (`ok`; a scene seen before asks with the
`meanwhile` decision prompt instead, §8.14), the map screen's update box (`continue`, `stop`), the lost sector, invasion and
pre-battle notices and the auto-bandage notices (`ok`). The page publishes it with an id taken from the game event, so every page shows the same id
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
| A meanwhile scene (flow `meanwhile`, §8.14) | `answer`, `skipLine`, `endMeanwhile` (a palace scene) | `inMeanwhile` | runs; stops at the interrogation's prompt and at `meanwhileEnded`; the box of a scene seen before is a prompt before the flow |
| The endgame (§8.14) | `answer`, `skipLine` | `endgameInProgress` | plays the sequence, `ended` at `campaignWon` |
| Won and over (flow `ended`) | nothing (`status` and `newSession` work) | `campaignOver`, also for the server-only queries | `ended` at once, no ticks |
| Boxing UI lock (§8.6) | `estimateAttack`, `answer`, `skipLine` | `boxingUiLock` | runs the walk out of the ring |
| Stop-time quote (§8.1) | `estimateAttack`, `answer`, `skipLine` | `stopTimeQuote` | runs the line to its end and its prompt |
| Auto-bandage (§8.3) | `endAutoBandage`, `skipLine`, `setOption`, the queries; saves are refused too | `autoBandaging` | runs the mode, a frame a tick; `idle` once nobody more can be bandaged; a world-time target is refused (`autoBandaging: …`) |
| Helicopter drop (`25`) | `skipHelicopterDrop`, `answer`, `skipLine`, `setOption`, the queries, loading a save; saves are refused too | `helicopterDrop` | runs the drop until the helicopter leaves; `idle` at its end or once it stalls, where only `skipHelicopterDrop` goes on |

`setOption` is accepted in every state but an open prompt (`promptOpen`).

## 6. Sessions

**Creating.** `newSession` and `POST /api/sessions` take one body (`NEW_SESSION_SHAPE`,
`src/server/session-registry.ts`): the sandbox (the A9 map and squad), a new campaign, a native savegame import (`14`)
or a ja2-node save (§10). A new campaign (`createCampaignSession`, `src/server/campaign-factory.ts`) starts the way a
player starts one: `initNewGame` leaves the game in the laptop on day 1, 01:00; the squad is hired through the
laptop's own commands with real prices, deposits and refusals; then, unless `land: false`, the first `compressTime`
loads the start sector at 07:00 (`15`) and the helicopter drops the squad one at a time, about 25 to 40 s of tactical
time the session runs before it answers; `land: "skip"` lands them at once as the Esc key does (`25`). `hire: []`
returns the session in the open laptop.

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
`08`). `interfaceLocked` stands while the original locks the interface under the wait cursor (`LOCKUI_MODE`;
`playerInterfaceLocked`, `src/sim/tactical/interface-lock.ts`), when tactical orders answer `uiLocked`. A soldier off
the ground (on a roof, climbing, a crow in flight) carries `heightAdjustment`, the pixels he is drawn above his tile
(`06`); a corpse carries it while it is not 0, the pixels it is drawn above its level (`33`). A
tank turning toward a new facing carries `turning`, and `hiResDirection`, its facing in 32 steps (0 north, clockwise,
four a direction), while that lies between two directions (`06`). Every
soldier in the view carries `surface`, the animation sheet he shows (an index of `tables/anim-surfaces.json`, chosen by
the simulation from his state, body, hand items, wounds, water and stance), `boundingFrame`, the script frame his
screen rectangle is measured on (the frame his last animation start or turn left, `SetSoldierLocatorOffsets`), with
`boundingDirection` and `boundingHiResDirection` while the facing that frame was converted in is not his own (`05`), and `camouflaged` while he wears camouflage
paint, ours and theirs alike, as the screen shows both (`06`). His `name` is his own (a profile's nickname, or what a
married merc keeps); a soldier without a profile on the enemy, militia, civilian or creature team has none and carries
`defaultName` (`enemy`, `militia`, `civilian`, `miner`, `crow`, `creature`, `bloodcat`), the default of his team the
original names him by (`Tactical/Soldier_Create.cc:880-905`), which the client prints from the string tables in its
own language (`src/protocol/soldier-names.ts`), `observe` gives in the session's as `defaultNameLabel`, and a message
naming him carries as a string reference (`06`). A
soldier the squad has just lost stays while he fades
out, with `fadingOut` (`06`): he can still be targeted and his hits are told, as in the original, until the fade ends or
he reaches the next tile. The tactical world (corpses, smoke, light, structure changes, blood;
`src/sim/tactical/world-view.ts`) is sent whole on every change. Its structure changes (`tileChanges`) are the map
changes since the load (`remove`; `add` at the head of the tile's structure layer, as a SAM terminal the Queen's
reinforcements repaired, `18`; `swap` in place of the tile removed just before it, a structure swapped for its partner
such as a broken window; `append` at its tail, for a tile the original adds with `AddStructToTail`: the rebel hideout's
trapdoor and crate, a SAM terminal repaired while its sector was not loaded, the structures earlier stays added, which a
sector entry and a native import add again, most wall end pieces; `object` at the head of the tile's object layer: a
destroyed structure's debris, `12`; `appendObject` at its tail: the hole of an opened pit, which the stay keeps and the
next entry drops, `12` §6), then the pieces of a helicopter standing in the sector (`append`; `25`). The client
draws them and lights over them (`20`). `addedExitGrids` lists the exit grids the sector added since its map loaded,
`{gridNo, sector}` with the sector each leads to (null for a pit opened in the sandbox, which has no sector): the O3
statue's way down (`26`), the rebel hideout's trapdoor (`35`), an opened pit's tiles (`12` §6), and those its earlier
stays added, which a sector entry and a native import add again. Each replaces the map's own exit grid on its tile, and
the client's exit grid cursor and exit box treat it as one of the map's at once, as `AddExitGridToWorld` puts it into
the world the cursor reads (`TileEngine/Exit_Grids.cc:53`); the tile it brings a merc to is not sent.
`slantRoofCeilings` lists the tiles where a slanted roof that a revealed room or a load took off shows its ceiling, the
tiles of the roof no merc has seen yet (`08`). `revealedAtLoad` lists, as runs
`[first gridNo, count]`, the tiles the last sector entry with saved revealed tiles or native import revealed, outside
rooms too, which the original reveals as a room reveal does (`08`). `revealedTiles` lists, as runs, every tile revealed
so far, by sight, a room reveal or a load, outside rooms too, which the picking's roof checks read, and the wire frames of
a client that missed the stay's recalculations (`05`); a frame carries only the runs it adds (`revealedTilesAdded`), or
the whole list once a tile is no longer revealed (a load, another sector). `knownMines` lists the tiles our side
knows to hold a mine (a blue flag, a mine the militia spotted, a mine one of our mercs planted), which the
paths of our team avoid unless the tile is the destination and the militia's always; where the enemy knows mines, trap
levels, bomb timers and owners are never shown (`12` §6). `radarContacts` is there only while an x-ray detector shows
soldiers the squad does not see: their tile and the colour the radar draws them in (`enemy`, `creature`, `militia`,
`civilian`, `hostileCivilian`, `namedCivilian`, `unconscious`), no id, as the radar shows no more. `helicopterDrop` is
there while a run of the helicopter drop goes on (`running`, the interface locked) and while a shadow it never took away
stays on the map (`25`): `engineVolume`, the 0–127 volume its engine sound is at (`31`), and `shadows`, the
helicopter's shadow at world pixels `x`, `y`, `z` pixels above the tile `gridNo` (`30`). Animation schedules, palettes
and light sprites serve the renderer and the devtools.

**Events** (`src/sim/events.ts` and the domain event files) come with `advance` reports; a browser gets the same in
`ViewFrame.events`. Events a command emits (a talk's lines, a shop's quotes, money events) reach the frame captured
right after the command, and the `Session` holds them for the next report.

**The message list** (`src/server/message-entries.ts`, `src/protocol/message-log.ts`): a presentation module outside
`sim` turns events, and the refusals the original prints, into entries of the original's message list
(`Utils/Message.cc`): a table, an index and arguments, never text, so every client prints them in its own language;
`quoted` marks the lines the original wraps in double quotes. The session keeps the last 256 in its presentation block:
saved, sent whole in `welcome`, new ones in frames and in every `advance` report (`messages`). The simulation never
reads them (deviation "Message list").

**A merc of ours dying off the tactical map** (of bleeding, gas or electricity while he is not on the loaded map, or
while the map screen is up; `33`) comes as `mercDied {soldier, sector, mapScreen?, cry?}`, never as `soldierDied`: the
strategic bookkeeping at once, no corpse and no skull. `sector` is his own, the one he left for a traveller. His death
cry and the samples `DOORCR_1` and `HEADCR_1` play for it (`Tactical/Soldier_Control.cc:5407`): `cry {voice, bodyType,
team, gridNo?}` names the battle-sound voice and where it comes from, his team and, on the loaded map, his tile; it is
absent for a muted soldier, who makes only the samples (`31`). Off the tactical screen,
which `mapScreen` marks, `pMercDeadString` goes into the message list (`Strategic/Strategic_Merc_Handler.cc:71`). On
the map screen his body, items and keys go into that sector's records, every able merc of ours says his buddy line and
compression stops (`compressionStopped {reason: mercDied}`, `Strategic/Strategic.cc:32`). A soldier of another team of
the loaded sector who bleeds to death while the map screen is up comes as `mercDied` too, with the same consequences:
the original's strategic death tests no team (`33`).

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
(`corpseLocated {gridNo, level}`, `Tactical/Rotting_Corpses.cc:1318`), a soldier hurt by bleeding, gas or electricity
(`damageFeedback {soldier, cause, conscious?, mapScreen?, unseen?, heard?, cry?}`, `Tactical/Soldier_Control.cc:8760`):
the portrait of a seen one flashes, a merc of ours off the loaded map included, and he grunts, at most once a second;
one in sight hurt by gas or electricity cries his death sound first (`:5370`), and `conscious` marks a gassed one who
grunts again (`TileEngine/Explosion_Control.cc:845`); one out of sight carries `unseen` and `heard` as a hit does, a
merc of ours off the loaded map `cry` as `mercDied` does, a muted soldier neither, and `mapScreen` routes the sound as
`mercDied`'s does (`31`); the sounds of a few more moments: our merc's OK as a pickup or search sets out on a path longer
than 5 steps (`pickupConfirmed {soldier}`, `Tactical/Handle_Items.cc:1130`), the glass of jars a fall broke
(`jarsBroken {soldier}`, `Tactical/Items.cc:3243`), Dr. Q's chop as he strikes with martial arts (`martialArtsChop
{soldier, spinKick?}`, `Tactical/Soldier_Control.cc:504`), a point of life a merc of ours bleeds, which makes him the map screen's info
character (`mercBled {soldier, lifeMaxLost?}`, `SoldierBleed`, `:7935`; `lifeMaxLost` when, dying, he lost a point of
maximum life too: `STR_LOSES_1_HP` in the message list, `:7883`, and his maximum life red on the map screen) and the
interface level the original switches to (`interfaceLevel {soldier, level}`: at every selection, a forced reselection of the selected
merc included, and when the selected merc of ours ends a climb onto or off a roof, `Tactical/Soldier_Ani.cc:261`,
`:1165`). `wireframesRecalculated {tiles, revealed}` comes each time the original works the wall wire frames out again
(`CalculateWorldWireFrameTiles`): as a look reveals a room, within two tiles of it, and after a blast that changed a
structure, in its radius around the bomb; `tiles` are the tiles worked out and `revealed` those of the tiles it reads that
were revealed then, both as runs (`05`). `ambientLightSet {level}` comes each time the original sets its base light again and draws every light over it
(`LightSetBaseLevel`: every dawn and dusk step and every temperature update, the level unchanged too), from when on the
roof marker takes the roof's shade (`05`). `sectorLoaded` carries `located`, the merc a sector entry selects, whom the view centres on with his locator;
a load sends no `sectorLoaded` (deviation "View after a load"). `helicopterDropStarted {gridNo}` starts a run of the
helicopter drop and centres the view on the north entry point, with no locate to the entry's merc
(`GameScreen.cc:351`); `mercDropped {soldier}` comes as the helicopter lands a merc, at his drop or at the skip, with the
original's "has arrived" line, which a `mercArrived` with `helicopter` (a merc the helicopter brings) leaves to it
(`Tactical/Merc_Hiring.cc:289`); `helicopterDropEnded {first}` ends a run, `first` on the first landing's, whose end
plays the enemy-present music (`25`). While a run goes on
every other command is refused with `helicopterDrop` (§6's modal states); `skipHelicopterDrop`, the Esc key, lands
the seats left at once and ends the run (`noHelicopterDrop` with none under way). The session copies the cosmetic animations into
`ViewFrame.effects` stamped with the session tick, and records the bullets in flight after every tick as
`ViewFrame.bullets`, since a flight usually falls between two frames. The client derives all sound and cosmetic
animation from them, the frames and the animation codes it replays (`31`); agents get the same events, never audio.

**What the squad does not see, it hears** (`08`; deviations "Sounds out of sight", "Bullets of unseen shooters"). A
source out of sight carries `heard {by, direction, volumeClass}` instead of its grid: the merc of ours who hears it
loudest by `CalcEffVolume`, the side as `TellPlayerAboutNoise` names it, the loudness class of `pNoiseVolStr`. A
`shotFired` of an unseen shooter drops `target`, `chance` and `hit`; a `soldierHit` or `soldierDied` of an unseen
victim carries `unseen` and a grid only when the attacker is seen or ours; bullets are recorded only for our soldiers
and those the squad sees. `arrived` (ja2-node's event for the end of a walk), `itemsPickedUp`, `itemDropped` and
`reloaded`, which nothing on the original's screen or speakers marks for a soldier out of sight (the pickup's sound is
our merc's alone, the drop's and the reload's a visible soldier's: `Tactical/Handle_Items.cc:1269`, `:975`,
`Tactical/Items.cc:1288`), come only for our soldiers and those the squad sees, or for everyone while the original
shows every soldier (`SHOW_ALL_MERCS` in a palace meanwhile scene, `Strategic/Meanwhile.cc:385`; `shownInSector`,
`src/sim/tactical/state.ts`): an unseen patrol neither stops an `advance {events: ['arrived']}` nor shows its tiles,
and an unseen soldier's pickups, drops and reloads change the items and his gun as they do but tell nothing. A death
cry and a creature's call make no noise in the original; they are heard as loud as the crier's loudest scream
(`CalcScreamVolume`'s cap of 10 − experience level).

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
`notInTactical`, a merc aboard a vehicle with `inVehicle`, a vehicle of ours with nobody aboard with `noDriver`, a merc
out of control with `cannotAct` or `onAssignment`, one without a move in our interrupt with `mercUnavailable` and its
message, the selected merc with `alreadySelected`) and under the order locks; `group` (the other members, possibly
none, never a vehicle or a merc aboard one: `badGroup`, as select-all and the rubber band skip them) ends a real-time
multi-selection: every member wakes before the selection, which is skipped when the chosen merc is selected already, as
in `EndMultiSoldierSelection`, and `data.woke` lists who woke. A selection wakes a sleeper even when he collapsed, which
`wake` refuses. `selectSquad` is the squad key's
`ChangeCurrentSquad`: it refuses a squad with nobody in the loaded sector (`squadNotHere`, `IsSquadOnCurrentTacticalMap`),
a number outside 0..19 (`badSquad`) and another screen (`notInTactical`), and takes `select`'s order locks for the
squad's first merc; the current squad itself changes nothing. `previewMove`'s `affordable` is
`SelectedMercCanAffordMove` (`Handle_UI.cc:2478`): only the first step with the stance change into the mode
(`firstStepCost`), the one AP check `move` makes before it accepts (`notEnoughAP` otherwise); on a path that costs
more he walks until his APs run out (`stopped` with `outOfAPs`). Whether the whole path fits his turn is `apCost`
against his `actionPoints`, the check that turns the cursor's AP figure red (`HandleUIMovementCursor`,
`Handle_UI.cc:2956`); per tile, the footsteps in `steps` (every tile before the destination) take band 4 from where no
movement mode reaches on his APs (in real time every band is 4). A new `move` re-plans a halted move for any merc
("Continue a move") and, unless refused, drops what the merc was walking up to do (a melee attack, a pickup, a door, talk,
give, first aid or a robot reload), as `UIHandleCMoveMerc` does. A `moveGroup` sends every merc to the one tile
(`HandleMultiSelectionMove`), and the walk shares it out as the original's does (`07`): the first there keeps it, a merc
whose next step is onto his final tile while somebody takes it stops where he is with no `arrived`, and one held up by a
squad mate heads for the closest free tile around his final tile and reports `arrived` there. A merc whose way is barred
by a squad mate standing on his own final tile, with no way around, waits there without end while his final tile is
5 tiles or more away (`07`): `advance {idle}` runs to its budget until the mate moves or the merc gets a new order or a
`stop`. A `move` with `reverse` is
the Alt move (`bReverse`): he walks or swats backwards facing away from his path, or side-steps when he faces across it,
for one more AP a tile; a body without those states, as a civilian escort's, pays the first step and stays where he is
(`06`). A blinded merc who runs and a drunk one in any move may trip from the second tile of a move on (`07`): he falls
where he stands with some APs lost, the move ends there, and `fellDown {soldier, cause: blind|drunk}` brings his CURSE1
and the original's line, for our soldiers and those the squad sees (deviation "Falls out of sight"). Marbles on a floor
or road tile, hidden ones too, make anyone slip there the same way and are gone: `slippedOnMarbles {soldier}`, with the
line for our mercs only. A FORGETFUL merc may stop on the way with his personality line once he has walked 200 tiles
since he last forgot. In deep water a soldier swims and treads; a non-swimmer loses breath five times as fast there, and
medium or deep water damages items and washes camouflage off (`camoWashedOff {soldier}`). A merc waiting on a squad mate
walks at the mate's speed until he stops at his destination (`07`).
A merc aboard a vehicle in the loaded sector is no controllable merc (`OK_CONTROLLABLE_MERC`, his assignment is the
vehicle): every order to him, `stop`, `mute` and the inventory and money commands included, refuses `inVehicle` (`talk`,
`give` and `openShop` refuse `canAct` with its reason), and so does an inventory command that names him as the other
merc; no order takes him as its target, as the cursor never finds him (`FindSoldier`): `pass`, `steal`, `swapPlaces` and
`talk` refuse `noSuchTarget`, `bandage` `noTarget`.
A vehicle of ours with nobody aboard is not ours to command (`IsOwnedMerc`): its orders and `select` refuse `noDriver`.
The hints refuse the same way (`blocked`). A vehicle never moves on the tactical map (`HandleMoveModeInteractiveClick`):
`move`, `swapPlaces` with `cursor`, a `moveGroup` naming one and `enterVehicle` by one refuse `vehicleCantMove`. It
leaves a sector by strategic travel, or through `exitSector` with `who: merc`, never as a squad (its passengers are on
no squad), when it drives toward the edge as the original's walk-off does, as far as it goes without turning, and then
leaves as its own group with everybody aboard at the vehicle's speed, burning its fuel on arrival (deviation "Vehicle
sector exit"): a load seats them at the vehicle, which enters at the entry point of its side.
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
carries his NOTHING battle sound, as on the tile of a closed container, whose items stay hidden until it is opened
(§8.2). `previewAction pickUp` gives what the cursor shows over such a tile, the walk plus a
pickup's 3 AP, of which the search pays only the walk (deviation "Hand cursor over hidden items"). A `stop` during the
pickup animation still picks up, as the animation reads the order's data (`12` §3). A melee attack at a
soldier out of reach walks up first (`estimateAttack` gives `walkTo` and the footsteps), then strikes. A knife takes any tile of his
level, as the original's knife cursor does: at one without a soldier he stabs the ground, or cuts the head off a corpse
lying there (`11`); fists need a soldier (`needMeleeTarget`). `steal` is the hand cursor's click on a conscious hostile
soldier, with its AP check (`GetAPsToStealItem`); `previewAction` kind `steal` gives the cost and the walk the cursor
shows, and the `stealAttempt` event what came of it. Our merc's first pull of a
virgin rocket rifle takes his fingerprints and fires nothing, as the original's: `attack` answers `gunImprinted`, and
the next one fires; one imprinted on someone else is refused by `HandleItem` with `wrongFingerprint`. An empty gun or a
launcher without a round refuses `attack` with `noAmmo`, where the original shows the reload cursor
(`UI_Cursors.cc:413-420`): `data.canReload` and `data.reloadAp` are that cursor, as `estimateAttack`'s `ammo` gives it,
so the next step is a `reload` for those APs, or none when no matching ammunition is carried. Out of combat, a neutral NPC with a
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
the tile (`trapSetOff` with CURSE1) but those our mercs planted, which stay under their flag; `no` asks `removeBlueFlag`.

An armed pit action item our merc steps on opens a pit around its tile (`pitOpened {gridNo}`, the cave collapse
sound): its hole in `tileChanges`, exit grids down to the sector below on its tiles (`addedExitGrids`), which paths
then avoid, and every soldier standing on it with a body that has the fall animation, of any team, falls through and
leaves the map (`fellIntoPit {soldier, gridNo}` for those the squad sees). A merc of ours goes to the sector below on a
squad of his own, to come in at the pit's tile (`12` §6). The original maps hold no pit, and a map's pit loads unarmed.

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
there while dialogue plays or a merc of ours still holds a give (walking up to give, or after giving on the spot until
his next order): then the original drops the action and he only stands there. `open` on a locked door answers the door menu as data after the start-of-menu trap check;
`openManually` is the menu's open button (deviation "Door menu"). `close` by our merc answers vanilla's closing menu
(`{closed: false, options}` and a `doorMenu {closing: true}` event), where only `closeManually` is enabled; other
soldiers close at once (deviation "Closing an open door"). A door swings for up to 375 ms after it changes; an order to
act on it meanwhile stops the merc (`{started: busy}`), as `InteractWithOpenableStruct` does, and advance may reach idle
before the door stops. A door that changes out of the squad's sight raises no `doorChanged` and keeps its place in
`openDoors` until a merc sees it. Containers and switches take `open` and `close` with the
original's walk-up and `HandleStructChangeFromGridNo`; a sector remembers which were open when it is left. A door,
container or switch he reaches in combat without the APs of his door handle code halts him there with the order kept
(`doorResult {result: notEnoughAp}`). One gone when he gets there keeps him walking on the spot, never idle, until
`stop` or another order; one swapped since the order (opened and closed again by somebody else) gets his opening to no
effect, as the original looks for the structure the order named. A closed container hides what it holds: items put
into it, a Bobby Ray delivery to the Drassen crate among them, go in hidden (`Handle_Items.cc:1511`), sight never shows
them (`FOV.cc:545` takes only `INVISIBLE` ones), a `pickUp` on its tile searches and finds nothing (`nothingFound`,
`Handle_Items.cc:1369`) and `door open` shows them (`TileEngine/Interactive_Tiles.cc:164`). The original's hand cursor
over a container opens it (`Turn_Based_Input.cc:3062`); the API leaves that choice to the agent, so `sectorLayout` marks
containers and switches at cell 1 (`C` closed, `c` open) and `previewAction` kind `door` gives their walk beside, the
3 AP of `doorAPs[HANDLE_DOOR_OPEN]` and the stand-up, as the cursor over an interactive tile does
(`Handle_UI.cc:3161`; `src/server/bobby-ray-crate-original.test.ts`). `useRemote`
presses the remote trigger in hand: the O3 statue's at once (`26`, deviation "Remote trigger"); the remote bomb trigger
after its hand item roll (`itemBroken`) for 2 AP, standing through its animation for 2 more, then `remoteFrequency`
asks, and the answer sets off every armed remote bomb of that frequency through the bomb queue (`remoteUsed {result:
bombs, frequency}`). The x-ray detector takes `useRemote` too: after its hand item roll, 2 AP and no animation, it uses
8 to 12 points of its batteries (`remoteUsed {result: xray}`; without batteries it does nothing more) and shows every
soldier of another team within 40 tiles on the radar (`radarContacts`, §7) until the merc's next turn starts in combat
or more than 5 world seconds have passed at a real-time turn.

The tools of the original's item cursors on a tile are commands of their own (`src/sim/tactical/tile-tools.ts`, rules
`12` §7), each `{soldier, gridNo}` with `HandleItem`'s walk beside the tile and AP check: `cutFence` (wire cutters on a
whole wire fence at his level 0; `fenceCut`, a `swap` in `tileChanges`, and soldiers pass the cut fence), `fillJar` (an
empty jar beside a corpse: `jarFilled {item}` with creature, queen creature or human blood, the one Gabby makes elixir
of being the creature blood; no corpse there gives his NOTHING battle sound, `nothingFound`) and `attachCan` (the tin
can on a string on a door's tile: `canAttached`, and the door makes three times the noise when opened). Refusals:
`noWireCutters`, `noJar`, `noCan` (the hand gives no such cursor), `noFence` (the cursor's check of
`UIMouseOnValidAttackLocation`), `noInteractiveTile`, then the hand item roll (`itemBroken`), `noPath` and `notEnoughAP`.
`previewAction` kinds `cutFence`, `jar` and `can` give what their cursors show: the walk beside the tile, the APs and,
as `ok`, whether the cursor turns good. The toolkit and the gas can on a vehicle are `repair` and `refuel` (§8.8).

### 8.3 Inventory, money and first aid

Rules: `12`. D15: everything the inventory panel, the item description box, the reload and medkit cursors and the money
box do is a command on the original's code paths (`src/sim/tactical/inventory-panel.ts`, `inventory-commands.ts`; the
map screen's `src/sim/campaign/map-inventory.ts`; `money-flow.ts`). The API replaces only the item cursor: a command
picks up, places and returns what is left in the cursor the way the original's cancel does (`CancelItemPointer`: the
slot it came from, else a free pocket, else the feet, and the feet at once for what `detach` or `unload` swaps out of
their `to` pocket, as a cursor that took nothing out of a slot has none to go back to; on the map screen the sector
inventory; deviation "Item cursor"). `moveItem` puts its leftover back into that slot only when it moves nothing else there, and `data.leftover`
names the pocket it went to, on which the UI keeps its cursor; one object of a stack moved into its own slot goes to the
stack's end, as the original's put-back stacks it. A placement runs on copies first, so a refused move changes nothing. The message boxes for merges and
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

Auto-bandage (`src/sim/tactical/auto-bandage.ts`, `12` §8; deviation "Auto-bandage") is the `a` key and the end-of-battle
question as commands. `autoBandage` refuses with the original's OK boxes in its order (`sectorNotCleared`,
`nobodyToBandage`, `noMedKit`, `cannotAutoBandage`, after `uiLocked`) or opens the `beginAutoBandage` prompt; a won
battle opens the same prompt by itself once its lines are over and nobody of ours has an action pending (walking up to
act, or after a give or a pickup on the spot that left one until his next order, `12` §3), or gives
`autoBandageRefused {refusal}` when the sector changed meanwhile. `yes` starts the mode (`autoBandageStarted {medics,
patients}`): the world clock stands, every tick is one frame of the original's `HandleAutoBandage`, and
`observe.autoBandage {complete, medics, patients}` is the box of medics and patients, whose bars the soldiers' own
fields carry. Every other command is refused with `autoBandaging`, saves too. `advance {idle}` stops at completion
(`autoBandageComplete`): everybody bandaged, the kits used up or a patient no medic can reach; the mode and its AI run on,
as the box waits for Done, until `endAutoBandage`, which ends it at the end of the next tick (`autoBandageEnded {failed,
worldSecondsWarped}`; `failed` is the original's warning box). A world-time target in the mode is refused rather than run
to the budget: the clock it waits for stands. `outOfBandages` carries CURSE1 only outside the mode.

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
placement"); `exitSector` applies the exit dialog's rules (deviation "Exit dialog") and is a query with `dryRun: true`;
`sectorExits` answers for every edge and exit grid at once where a squad can leave and from which tiles, and
`sectorLayout` draws the sector around them (§9).
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
flight"). Ground vehicles move through a passenger's `route`. A merc boarding a ground vehicle on the loaded map sits
at its tile. The tactical `soldiers` list him with `vehicle {id, driver}` (the vehicle's id, whether he drives) at the
vehicle's tile, which he does not occupy: the client draws no sprite and no light for him and its cursor never finds
him, while the radar and the overhead map mark his tile as the original's do. A vehicle of ours lists the mercs aboard
in seat order as `passengers` (none: not ours to command, `noDriver`); its squad's team panel shows them in its place,
a click on one of their faces selecting the vehicle; the driver's `ap` is the vehicle's, as his panel shows
(`GetUIApsToDisplay`). The mercs aboard look, hear and radio (`08`); our vehicle never looks. Any other vehicle in sight,
an enemy tank or a civilian car, carries `life`, `lifeMax`, `breath` (its fuel in percent) and `breathMax`, which the
bars over it show (`Tactical/Interface.cc:1050`); other soldiers not ours carry only their health word.

On the tactical screen (`src/sim/tactical/vehicle-boarding.ts`, `src/sim/campaign/vehicle-boarding.ts`),
`enterVehicle {soldier, vehicle, cursor}` is the click on a vehicle with the hand cursor (`cursor: "hand"`, the
default) or the move cursor (`"move"`), `vehicle` the vehicle's soldier id: he walks to the free tile closest to it by
rows and columns within 5, never his own, so he always walks (a quirk, `25`), and on arrival gets into
whatever enterable vehicle stands there. A civilian vehicle becomes ours on boarding: a merc of `kind` `vehicle` with
soldier id 18, then 19, the vehicle keeping its id; the vehicle is selected and its squad made current. Refusals in
order: `notInCampaign` (the sandbox), the order's own (`inVehicle`, `noDriver`, …), `vehicleCantMove`, `noSuchTarget`
(no vehicle the squad sees), `notEnterable` (a tank, a wreck below 15 life, no vehicle), `notAllowed` (the Hummer and
the ice cream truck before their facts), `vehicleOccupied` (the move cursor over a vehicle with somebody aboard),
`noPath` (no free tile within 5, or no walk), `notEnoughAP`; `data.actionGridNo` is the tile he walks to.
`previewAction` kind `enterVehicle` with `target` and `cursor` gives that walk and its APs with the same refusals.
`exitVehicle {soldier}` is the team panel's Exit Vehicle button for a merc aboard: he stands on the free tile closest to
the vehicle within 5 tiles, else within 20, knows the vehicle, looks around, joins a squad of his own, made current,
and is selected; the vehicle left empty drops its squad for its group and is not ours to command. Refusals:
`notInCampaign`, `noSuchSoldier`, `notInVehicle`; `data.gridNo` is his tile. The map screen's `boardVehicle` takes a
civilian vehicle of the loaded sector over the same way, a third vehicle of ours refused as `noVehicleSlot` (deviation
"Third vehicle of ours"), and its `leaveVehicle` in the loaded sector puts the merc where `exitVehicle` does.
`vehicleBoarded` and `vehicleLeft {soldier, vehicle, gridNo}` carry the vehicle's tile, where the enter sound plays,
while the vehicle stands on the loaded map.

A toolkit or a gas can in hand repairs or refuels a vehicle of any team at ground level, an enemy tank included, as the
original's item cursors do (`src/sim/tactical/tile-tools.ts`, rules `25`): `repair {soldier, gridNo}` and
`refuel {soldier, gridNo}`, `gridNo` any tile of the vehicle. The merc walks towards the free tile closest to the
vehicle within 5 (the walk ends beside that tile when one beside is nearer) and, arriving, crouches: the toolkit puts
him on the `REPAIR` assignment, off his squad, under the vehicle soldier's id, which names no vehicle, so he repairs
nothing and finishes at the next hour (deviation "Toolkit repair in tactical"; nothing changes when nothing around needs
a repair); the gas can pours 50 fuel per point of its status, up to a full tank, losing a point per whole 50 poured and
vanishing at 0 (`vehicleRefuelled {soldier, vehicle, gridNo}`, the vehicle's id and tile; a full tank takes nothing).
Neither costs more than the walk and the crouch; a merc who already stands where he would walk to does nothing (a
quirk, `25`). Refusals: `notInCampaign` (the sandbox), the order's own (`inVehicle`, …), `noToolKit` or `noGasCan` (the
hand gives no such cursor), `noVehicle` (no vehicle on the tile at ground level, or the merc is on a roof), the hand item
roll (`itemBroken`), `noPath`, `notEnoughAP` (the walk plus the crouch and 5 for a repair or 10 for a
refuel). `previewAction` kinds `repair` and `refuel` give the cursor's walk and APs and, as `ok`, whether it turns good
(`noVehicle` where it does not); the walk is the cursor's, beside a door maybe another tile than the order's (`25`).

`strategic.vehicles` names our vehicles and the helicopter, and another vehicle only while a merc of ours could board
it (`IsThisVehicleAccessibleToSoldier`: in his sector, neither moving, `OKUseVehicle`), the map screen's vehicle menu;
an enemy's tank never, though the vehicle list holds it while its sector is loaded.

A vehicle of ours is a merc of `kind` `vehicle` whose `vehicle` names the vehicle it is; its condition is its `life` and
`lifeMax`, its fuel in percent its `breath`, as the map screen's status bars show them, and its entry in
`strategic.vehicles` repeats them as `life`, `lifeMax` and `fuel`. Other vehicles and the helicopter show neither.
Travel burns fuel (`16`); the leg that empties the tank brings `vehicleOutOfGas {vehicle, sector}`, the original's box,
before the arrival's `groupArrived`, and the group stops there. A vehicle with an empty tank refuses to move as
`vehicleNoGas` (after `vehicleEmpty` and `vehicleDamaged`), and so does the route of anyone aboard, naming the vehicle
soldier. The hints read the fuel from the percentage shown, so a tank a gas can left below 1 % refuses there while
the command moves it (deviation "Strategic hints and enemy counts"). A mechanic repairs a vehicle by the hour (`18`).

A vehicle in the loaded sector, an enemy tank among them, takes hits by the original's vehicle rules (`33`) and gets 35
APs more a turn, up to 50 (`10`). The hit that destroys it brings `vehicleDestroyed {soldier, vehicle, killer}` (the
vehicle soldier, the vehicle's id, the attacker or null) before the `explosion` of its wreck, credited to that attacker,
and its `soldierDied`; the mercs aboard die with it.

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

**Someone else in the sector.** Three seconds after a tactical battle is won, boxing included, in a wilderness sector
whose profiled NPCs nobody has spoken with, the `someoneElseInSector` prompt (`ok`, the original's OK box) opens; while
auto-bandage runs or its question waits, a line plays, another prompt is up or a conversation is open it looks again
2 s later, and the map screen, a shop or a meanwhile drop it (`src/sim/campaign/someone-else-in-sector.ts`, deviation
"Someone else in sector timer"). While a look that will open the box waits, the session is not idle, so `advance
{idle}` runs on to the box and stops with `decision`; a look in a sector with nobody to tell of does not hold it.

**Autoresolve is a flow** (deviation "Autoresolve session"): world time is frozen and `advance` runs slices of 1000
battle ms, one per 200 ticks (`TICKS_PER_AUTORESOLVE_SLICE`): `{idle}` to the end or a prompt, `{ticks: n}` ⌊n / 200⌋
slices (so a real-time driver paces it), `{events}` up to the slice in which one happened. Under the instant driver
`answer autoresolve` runs to the first stop at once. `autoresolveRetreat` applies before the next slice. The end opens
`autoresolveDone`: `bandage` leaves it open, as the original's two buttons leave the box up: it answers
`data.bandaged` (`complete` or `incomplete`) with the reopened prompt's new id in `data.prompt` and its answers in
`data.choices`; only `done` closes it and returns to the strategic flow. A battle that no fighter can
change any more ends with the status `stalemate`, which the original never reaches (deviation "Autoresolve stalemate").

### 8.11 Laptop and hiring

Rules: `21`; `src/sim/campaign/laptop/`; views `src/server/laptop-view.ts`, `personnel-view.ts`. The laptop is a modal
flow (deviation "Laptop as commands"): a new game starts in it, `openLaptop` opens it from the map screen, and the clock
stands still while it is open. One command per decision of the pages: `aimHire`, `mercHire`, `impCreate`,
`bobbyRayOrder` (the whole cart, atomic), `insure`, `orderFlowers`. `visitSite` is entering a page where entering has
effects: Bobby Ray's construction mail, bookmarks, the M.E.R.C. visit counter and Speck's opening, the florist order
form's draw (deviations "Speck's opening", "Florist order form entry"). The I.M.P. draft stays in the client until
`impCreate`; under the rule pack's `imp.pick_skills_directly` (`imp.pickSkillsDirectly` in the view) it takes `skills`,
at most two of the view's `imp.specialties`, in place of `answers`, and `imp.attributes.specialtyBonus` gives what they
add to the attribute pool. The laptop's queries answer before money moves; `emailText` is answered by the server's campaign adapter
(`src/server/campaign-session.ts`, `mail-text.ts`) with the original's substitutions and the I.M.P. report, not by the
simulation, and goes through the command path although it changes nothing. Silent profile changes (a merc back home,
away, dead elsewhere, the M.E.R.C. outage) raise no event; they show in the view. The view carries `newGameLaptop` and
`atLeastOneMercHired` (`gfNewGameLaptop`, `gfAtLeastOneMercWasHired`), which decide whether the canvas laptop powers down
with its zoom (`30`).

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

Rules: `25` (quests), `26` (meanwhiles, prisoners, the end). Scenes and the ending are not player actions: they have no
prompt of their own but the box of a scene seen before and the interrogation's lie, and no command but Esc's in a
palace scene; the flows `meanwhile`, `endgame` and `ended` lock the UI as the original does (§5).

- **Quests** are hidden state: `strategic.quests` (`src/server/quest-view.ts`) lists only quests with a "started" or
  "finished" history line, so a quest changed without one (Alma's skip, a silent restart) stays invisible.
- **Meanwhile scenes** (`src/sim/campaign/meanwhile-flow.ts`) are played in the `meanwhile` flow once their gates
  pass, each between `meanwhileStarted {seq, scene, gridNo, mapScreen?}` and `meanwhileEnded {seq, scene}`, where
  `advance` always stops; `gridNo` is the tile the view goes to as the scene's sector loads, the camera tile of the
  meanwhile scheduled last (`26` §3), and `mapScreen` marks a scene started on the map screen;
  on the map the clock stops (`compressionStopped {reason: meanwhile}`), and while a scene waits for its gates
  compression is refused. `observe.meanwhile` names the scene under way and `strategic.meanwhiles` logs the scenes
  played and skipped (`{seq, scene, at, skipped?: true}`).
- **The box of a scene seen before** on this server (`installation.json` beside its saves, as the original's `Ja2.set`;
  never the interrogation) is the `meanwhile` prompt (`{scene, choices: ['ok', 'skip']}`), where `advance` stops with
  `decision` under the meanwhile pause. `ok` plays the scene, its `meanwhileStarted` carrying the prompt's id; `skip`
  runs the scene's implications alone and reports `meanwhileSkipped {seq, scene, prompt}`: no flow `meanwhile`, no
  `meanwhileStarted` or `meanwhileEnded`, no NPC moved, nothing loaded, the clock running as before the box. The answer
  says `{scene, skipped}`. A scene that ends played, by Esc too, is marked seen; a skipped one is not.
- **Palace scenes** load P3 (`sectorLoaded`), play the Queen's records and load the sector before again (or unload the
  hall when none was loaded) as they end; the view shows every soldier of the hall while one runs. `endMeanwhile`, the
  Esc key, ends one at once with its implications and the way back; it is the only way on once a scene stalls (the
  missile-site count with all four sites held picks no line), and it is refused with `noPalaceScene` outside a palace
  scene and in the interrogation.
- **The interrogation** is a scripted tactical scene in N7: the Queen's lines are a conversation, her lie question an
  `npcRequest`; `advance` stops at the prompt.
- **The end** (`src/sim/campaign/endgame-flow.ts`): `queenKilled` starts the `endgame` flow and `advance` plays the
  sequence; with the creature quest open `endgameDeferred` stops it and the campaign plays on until
  `creatureQueenKilled`; `campaignWon` ends it. There is no game over: with no usable merc left compression is refused
  and `status.noUsableMercs` is true.
- **Native saves** taken during a played scene or the endgame sequence are refused on import, and so is one whose
  animation restart on load reaches a campaign hook, the error naming the soldier, his animation and code and the hook
  (deviation "Animations on load reaching the campaign"); one taken with no sector loaded continues on the strategic
  map with none loaded, one taken on the map screen with a sector loaded continues on the map with it loaded
  (`tacticalScreen` enters it), one taken in tactical in tactical (`14`).

## 9. Queries and cursor hints

Queries are commands that change nothing: the cursor hints (`src/sim/hints/`, `answerHint`), `exitSector` with
`dryRun`, and the server-only kinds. Cursor feedback (path and AP under the pointer, chance to hit, drop targets,
plotting ETAs, enabled menu lines) is computed as the original computes it, with the rules' own functions, in the
browser (`28` §4) and on the server, over the player-knowledge projection (deviation "Cursor hints on the
projection").

**The projection** (`src/sim/knowledge/`, `knowledgeWorld`) builds from a player view and the rule content the minimal
world the hints read. In tactical it is a `TacticalState` over a fresh copy of the sector's world with the view's
structure changes replayed over it (`tileChanges`: a cut fence, a blown wall), the exit grids it added
(`addedExitGrids`, which paths keep off and the exit hints lead through), its doors, containers, items, known mines
and light, the loaded sector of the strategic view (`worldSector`, which the phobias read), our
soldiers in full and the seen soldiers with their visible fields only: unseen
soldiers do not exist, so they block no path, absorb no bullet and are no target. A projection kept for the map replays
only the structure changes added since the last view, with the doors and containers set back as the map placed them,
since a removed door is named by its tile in the map; a view whose changes do not extend the replayed ones (a new entry
to the sector, a landed helicopter's pieces, which come last) gets a fresh projection (`ProjectionCache`,
`src/sim/knowledge/knowledge-world.ts`). On the map it is a minimal strategic state from the strategic view. In strict
mode (tests) every unsupplied field throws (`guard.ts`, `UnsuppliedFieldError`), so a hint that reads hidden state
fails at once; each such read was decided: supplied by the view, given a neutral value (deviations "Movement penalty in
the estimate", "Other soldiers in the projection") or dropped (the melee chance to hit).

**Exits.** `sectorExits` (`src/sim/hints/sector-exits.ts`) gathers what the exit arrows at the four screen edges and the
exit grid cursor answer for one merc: per edge the adjacent sector, the travel time, `exitSector`'s answer now, and the
edge's band, the tiles from which `SoldierOKForSectorExit` lets a merc leave (`Strategic/StrategicMap.cc:1945`), as a
bound on `x - y` or `x + y`, since the band is a strip of the screen. The exit grids are those the cursor shows: it
shows none on a tile in a room until that tile is revealed (`Tactical/Handle_UI.cc:838`), and the client's cursor and
`exitSector` follow the same check (`src/content/world/exit-grid-cursor.ts`): `exitSector` refuses such a tile as
`notRevealed` before it looks for an exit grid there, so the refusal does not tell whether the room holds one, and a
click there is a move, which the exit grid's tile blocks (`noPath`). `walkTo` is ja2-node's own pick, not the original's
`PickGridNoNearestEdge`, which the exit itself still uses for the mercs it walks off: for each merc of the squad the
nearest band tile he can reach and stand on, none shared, from one flood per group of mercs that can reach each other,
so an agent can send the squad there and leave together. Measured on the original data (A9 after the landing, B13, C13
and D13 from native saves) the answer is 630–690 bytes and takes about 5 ms.

**Layout.** `sectorLayout` (`src/sim/hints/sector-layout.ts`) draws the loaded sector as text, one character per cell of
`cell` × `cell` tiles, laid out by gridNo (x right, y down) rather than as the screen's diamond, so that a cell's corner
is plain gridNo arithmetic. Every cell comes from what the client draws for the whole map, over the projection: the
movement costs of the map with the view's structure changes and doors, the terrain, our soldiers and the exit grids
`sectorExits` lists; at cell 1 also the containers and switches the screen draws, which `door` opens and closes (§8.2).
The ground under a roof the screen still draws is `R` and nothing else: a flat roof stays on until
its room is revealed or a load took it off, as `SetGridNoRevealedFlag` takes it off (`TileEngine/Render_Fun.cc:73`), and
a slanted roof's ceiling covers each tile no merc has seen (`:131`; the client's `src/render/world/reveal.ts`);
underground, where the map's roofs cover the rock for good, that is the rock. The roof level (`level: 1`) is the roof
view, which draws every roof (`Tactical/Handle_UI.cc:1137`), and marks where a merc can stand by the roof's movement
costs. Items, mines and soldiers other than ours never enter it. A cave is drawn as its light leaves it, dark but drawn,
so the layout shows it whole. Measured on the original data (A9, B13, C13, D13) the whole sector is 1.8 KB at the
default cell 4 (the legend is 0.3 KB of it), 2.7 KB at cell 3, 5.2 KB at cell 2, the roof level 1.5 KB and a window of
radius 12 at cell 1 1.3 KB; the answer takes about 5 ms.

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
