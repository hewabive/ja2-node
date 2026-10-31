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

**Not built as commands** (the client shows them disabled): planting bombs and using wire cutters, toolkits, gas cans,
jars and tin cans on a tile (gap "Unbuilt item actions"; `previewAction` answers `notSupported`); auto-bandage (gap
"Auto-bandage"); the placement GUI (deviation "Tactical placement"); drugs and alcohol (`notPorted`, gap "Drugs and
alcohol"); reloading the robot (`robotReload`, gap "Reloading the robot"); vehicles' condition and fuel (gap "Vehicles
as characters").

## 3. Fairness: what the agent never sees

The agent sees what the player's screen would show (D16, `04` §5.3): a view block or field exists only while an
original screen shows it, events about what the squad does not see are cut down to what it hears (§7), and the cursor
hints run over a projection of the view (§9). Where the original's UI read hidden state, the hint drops the answer (the
melee chance to hit is `null`) or leaves it to the command, which decides on the full state and refuses with the
original's message. Per domain:

| Domain | Shown | Never shown |
|---|---|---|
| Tactical | Our soldiers in full, with what the original's panels and face read; others in sight with their visible fields, `hostile` and the health category, and for a few 60 ms steps a soldier the squad has just lost (`fadingOut`, as the original draws him fading); doors with the lock and trap state the player knows | Others' life; unseen soldiers (absent from the view, events and hints); lock tables, trap levels, lock damage |
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
the campaign or, beside a real-time viewer, a timeout. Each report carries the world time in a campaign.

### 4.2 Decisions

A decision is a choice the game waits for (`hasPendingDecision`): an interrupt in our favour with nobody of ours
acting; an open prompt (`observe.prompt`, `observe.contractPrompt`, `observe.npcRequest`); a conversation waiting for a
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
- An AI interrupt shows nothing until `DisplayHiddenInterrupt`, then an `interrupt` event; while a hidden one runs the
  view shows our turn, as the original does, and orders are refused with `uiLocked`. A fully hidden one leaves no
  trace. `combat.aiTurn` names the AI soldier whose turn it is (the one the original highlights) while he is in the
  view, also in an AI interrupt once it shows and in the turn an AI attack starts.
- `endTurn` first runs `CheckForEndOfCombatMode(FALSE)`: when that ends combat the turn does not pass and the answer
  carries `data.combatEnded`.
- The selected merc (`turn.selected`: the merc of the last accepted order, at first `EnterCombatMode`'s choice) matters
  for `StandardInterruptConditionsMet`, `EndInterrupt` and `CheckForMercContMove`.

### 4.4 Time on the map

`compressTime {mode}` and `stopTime` are the map screen's clock buttons; the player's pause is not a command, the manual
driver is the pause. A strategic `advance` (one with a world-time field, `compressionStopped` or `mode`) starts
compression itself and stops where the original stops it (`04` §4.2); the clock's `canCompress` and `compressRefusal`
say beforehand whether it would start. `status.flow` names the flow (`tactical`, `strategic`, `autoresolve`, `laptop`,
`meanwhile`, `endgame`, `ended`); `mapScreen` and `tacticalScreen` switch between the first two like the original's
screen toggle, and the loaded sector stays frozen on the map (deviation "Map and tactical screens"). The sleep and wake
notification is a client setting: an agent that wants the original's stop passes `events: ['fellAsleep', 'wokeUp']`
beside its time target.

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
holds, after 30 s at most with `timeout` (call again), or `refused` when real time stops; a strategic advance is
refused, as the viewer compresses on the map screen (deviation "Advance with a real-time viewer"). The wait holds no
place in the host's input queue, so the player's commands go through meanwhile and nothing enters the input log. The
browser's own `advance` requests (a compression to a world time, autoresolve slices) still run ticks.

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
shows one box for the batch. Clients compare tokens, never `reason`. The text key `refusal.<token>`
(`/api/strings`, `/api/text?key=`) names the original's message where it has one; `REFUSAL_MESSAGES`
(`src/protocol/refusals.ts`, so the client prints it without the server) also says whether the original logs it or
shows a box, and the session adds the logged ones to the message list (§7), except for `exitSector`, whose lines the
exit cursor prints (`refusalEntry`, `src/server/message-entries.ts`).

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

**The view.** `observe` returns the `PlayerView` (`src/protocol/view.ts`, built by the session adapters: `04` §5.3)
with labels in the session's language beside the machine tokens (`labelledView`, `src/server/text-keys.ts`; null where
the original has no string); the browser gets the same blocks in view frames when they change. Campaign blocks (a
prompt, the shop, the laptop, a conversation, boxing, autoresolve, a meanwhile, the end) are present only while the
original shows them. Our soldiers carry what the original's panels and face read (the single merc panel's numbers, the
hatched face as `canAct`, the face's enemy count as `opponents`, the End key's target as `continueTo`). A soldier the
squad has just lost stays while he fades out, with `fadingOut` (`06`): he can still be targeted and his hits are told,
as in the original, until the fade ends or he reaches the next tile. The tactical world (corpses, smoke, light,
structure changes, blood; `src/sim/tactical/world-view.ts`) is sent whole on every change. Animation schedules,
palettes and light sprites serve the renderer and the devtools.

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
what the original only draws or plays: impacts, trails, ripples, shattered windows, creature calls, footsteps. The
session copies the cosmetic animations into `ViewFrame.effects` stamped with the session tick, and records the
bullets in flight after every tick as `ViewFrame.bullets`, since a flight usually falls between two frames. The client
derives all sound and cosmetic animation from them, the frames and the animation codes it replays (`31`); agents get
the same events, never audio.

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

Rules: `10` (turns, §4.3), `11` (attacks), `34` (throws), `07` (movement). One `stance` command carries the movement
mode the original keeps beside the stance (deviation "Stance") and refuses a height the merc cannot take where he stands
(`IsValidStance`: vehicles, the robot, water, an escort lying down, no room for the body), with the message of
`UIHandleSoldierStanceChange`; the `movementOptions` hint says which of run, sneak and crawl the movement menu offers.
A new `move` re-plans a halted move for any merc
("Continue a move") and, unless refused, drops what the merc was walking up to do (a melee attack, a pickup, a door, talk,
give or first aid), as `UIHandleCMoveMerc` does; `attack` takes the click's checks of a melee attack, which the original never confirms without them
(no path to a punch target, the APs with the walk: `combat/melee-order.ts`), but not the click's checks of a shot
("Attack refusals"); `pickUp` picks entries instead of the menu ("Picking up items"). A melee attack at a soldier out of
reach walks up first (`estimateAttack` gives `walkTo` and the footsteps), then strikes. A knife takes any tile of his
level, as the original's knife cursor does: at one without a soldier he stabs the ground, or cuts the head off a corpse
lying there (`11`); fists need a soldier (`needMeleeTarget`). `steal` is the hand cursor's click on a conscious hostile
soldier, with its AP check (`GetAPsToStealItem`); `previewAction` kind `steal` gives the cost and the walk the cursor
shows, and the `stealAttempt` event what came of it. Our merc's first pull of a
virgin rocket rifle takes his fingerprints and fires nothing, as the original's: `attack` answers `gunImprinted`, and
the next one fires; one imprinted on someone else is refused by `HandleItem` with `wrongFingerprint`. A launcher without
a round refuses `attack` with `noAmmo`, where the original shows the reload cursor. Throwing a grenade needs no command
of its own: move it to the hand, check with `estimateAttack`, `attack` the tile.

### 8.2 Doors, containers and remote triggers

Rules: `35` (doors, locks, traps; `src/sim/tactical/doors/`). `door` walks next to the door, then acts, unless he gets
there while dialogue plays or another merc still walks up to give an item: then the original drops the action and he
only stands there. `open` on a locked door answers the door menu as data after the start-of-menu trap check;
`openManually` is the menu's open button (deviation "Door menu"). `close` by our merc answers vanilla's closing menu
(`{closed: false, options}` and a `doorMenu {closing: true}` event), where only `closeManually` is enabled; other
soldiers close at once (deviation "Closing an open door"). Containers and switches take `open` and `close` with the
original's walk-up and `HandleStructChangeFromGridNo`; a sector remembers which were open when it is left. `useRemote`
presses the remote trigger in hand (the O3 statue, `26`).

### 8.3 Inventory, money and first aid

Rules: `12`. D15: everything the inventory panel, the item description box, the reload and medkit cursors and the money
box do is a command on the original's code paths (`src/sim/tactical/inventory-panel.ts`, `inventory-commands.ts`; the
map screen's `src/sim/campaign/map-inventory.ts`; `money-flow.ts`). The API replaces only the item cursor: a command
picks up, places and returns what is left in the cursor the way the original's cancel does (`CancelItemPointer`: the
slot it came from, else a free pocket, else the feet; on the map screen the sector inventory; deviation "Item
cursor"). A placement runs on copies first, so a refused move changes nothing. The message boxes for merges and
permanent attachments become refusals to repeat with `merge` or `permanent`; the description box charges its AP per
command (deviation "Attachment AP"). On the map screen the same commands cost no AP and pass items within one sector
only. Money moves through the cursor in the original: `withdrawCash`, `depositCash` and `splitMoney` do the click and
the drop at once (`splitMoney` on the map screen too, within a sector like `moveItem` there); money for another soldier
is `give`, for a dealer `trade`. `moveKey` is the key ring popup with the cursor (`src/sim/tactical/key-ring-panel.ts`):
`{ring}` names a position, which the view's `keys` give as `position` (deviation "Key ring cursor"). `switchHeadGear`
is CTRL+N for a squad (`src/sim/tactical/head-gear.ts`); the key alternates the night and the day gear, night first,
and the client keeps that turn.

### 8.4 Conversations

Rules: `24`. A conversation with a named NPC is a modal talk session (`src/sim/campaign/talk-flow.ts`) over the NPC
records and the dialogue queue (`src/sim/narrative/`); deviation "Talk session time". `talk` runs the original's checks
in its order, walks up beyond 4 tiles (the talk starts on arrival during `advance`) and returns at once with the talk
reply; the lines follow in game time (§4.5) as quote events, collected in `conversation.lastQuotes`. An idle open
session is modal (§5). A scripted sequence (`ENGAGED_IN_CONV` without a panel, a pending conversation, the 500 ms
trigger wait) refuses player commands until `advance` has run it. Saving is refused throughout (`27`).

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
the whole group's move first, so a squad cannot leave the start sector before it is cleared; `extend` appends legs
like the map screen's plotting, otherwise the path is replaced. `routeGroup` is the move box: mercs parting from their
unit regroup on this command rather than at Done (deviation "Move box regrouping"). `enterSector` loads with automatic
placement (deviation "Tactical placement"); `exitSector` applies the exit dialog's rules (deviation "Exit dialog") and
is a query with `dryRun: true`. On a creature lair level after the creature quest, `strategic.surfaceWarp` names the
surface sector the exit dialog first offers (so does `exitSectorOptions`); `exitSector` with `warp: true` at a valid
exit takes every conscious merc of the sector there and loads it (`campaign/sector-exits.ts`).

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
event carries what the panel showed with Autoresolve pressed, and autoresolve begins. `showBattle` opens the
non-persistent panel where the original calls `InitPreBattleInterface(0, false)` (a click on the battle sector while
the locator is on, a compression attempt during a tactical battle), with its side effects; `autoresolveBattle` skips
the panel (deviation "Non-persistent pre-battle interface").

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
sequence", "Contract prompts"). `contractOptions` gives the renewal menu's options and shading without opening the
sequence.

### 8.13 Merchants

Rules: `23`; `src/sim/campaign/shop-flow.ts`, `src/sim/strategic/economy/merchants/`. A shop is a modal session: the
clock stands and saving is refused (deviations "Shop as commands", "Shop deduction prompt", "Unsellable shop items",
"Pricing merc", "Refused gift"). `openShop` checks in the original's order and refuses with the first failure; with NPC
records it goes through a conversation (deviation "Talking to dealers"). `trade` is one `PerformTransaction`,
validated before anything changes; deliveries go in offer-area order, with drops VISIBLE at the receiver's tile.
`quoteTrade` answers what pressing the button would show, `dealerCannotAfford` included, which the player learns only
by pressing it (its `refusal` is the `data` a refused `trade` carries), and the shopkeeper quotes the trade would emit,
which the client plays as items are offered (`EvaluateItemAddedToPlayersOfferArea`).

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
doors, containers, items and light, our soldiers in full and the seen soldiers with their visible fields only: unseen
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
`saveRefusal`, so an agent need not try. A load is a player load by default: the main stream is reseeded, the seed
returned and logged (deviation "Player loads"); `reseed: false` is an exact load for experiments and bug reports.
`gameSaved` and `gameLoaded` come with the next report; autosaves and Dead is Dead saves send none, as in the original.

**Options** (`27` §2). The game options are chosen once, in `newSession {campaign: {options}}`; `setOption
{bloodAndGore}` (logged and replayed) is the only one that changes during a game, as on the original's options screen.
Client settings (volumes, subtitles, display toggles, …) live in the browser and never reach the simulation; agents
have none. The server computes the music mode from the events, so every client hears the same (`31`); MCP `observe`
carries no music and no sound.

## 11. Endpoints for the player UI, and diagnostics

- `GET /api/sessions/:id/profiles` (`src/content/narrative/profile-presentation.ts`): names, faces and bios for the
  client's faces and pages; on stubs from `stubs/profiles.json`.
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
