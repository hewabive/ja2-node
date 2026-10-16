import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { WorldTimeTarget } from '../sim/advance.ts';
import type { Session } from './session.ts';
import { describeSession, NEW_SESSION_SHAPE, openSession, type SessionFactory } from './session-registry.ts';

const SERVER_INFO = { name: 'ja2-node', version: '0.1.0' };

function worldTimeTarget(target: number | { day: number; hour?: number | undefined; minute?: number | undefined }): WorldTimeTarget {
  if (typeof target === 'number') return target;
  return {
    day: target.day,
    ...(target.hour !== undefined ? { hour: target.hour } : {}),
    ...(target.minute !== undefined ? { minute: target.minute } : {}),
  };
}

function text(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] };
}

export function buildMcpServer(sessions: Map<string, Session>, defaultSession: string, createSession?: SessionFactory): McpServer {
  const server = new McpServer(SERVER_INFO);
  const pick = (id: string | undefined): Session => {
    const s = sessions.get(id ?? defaultSession);
    if (!s) throw new Error(`no session ${id ?? defaultSession}`);
    return s;
  };
  const sessionArg = { session: z.string().optional().describe('Session id; defaults to the sandbox session') };

  server.registerTool(
    'status',
    { description: 'Game status: tick, map, time driver, soldier count, whether the simulation is idle.', inputSchema: sessionArg },
    async ({ session }) => text(describeSession(pick(session))),
  );
  if (createSession) {
    server.registerTool(
      'newSession',
      {
        description:
          'Start a fresh game in its own session and return its id; pass it as "session" to the other tools. With nothing else it is the tactical sandbox (same map and squad, independent state). With "campaign" it is a new campaign: the strategic layer runs (world clock, Queen, towns, travel), the squad is hired through the laptop (real A.I.M. prices, deposits and refusals; "hire": [{profile, contract: 1|7|14, gear}], or "mercs": the size of the default squad, hired while affordable; "imp": an impCreate command) and, unless land is false, flown into the start sector at 07:00 on day 1; with "hire": [] the session stays in the open laptop on day 1, 01:00. With "save" (a file name from the original game\'s SavedGames folder without .sav, e.g. SaveGame07) it continues that native savegame. Optional seed for the random streams.',
        inputSchema: NEW_SESSION_SHAPE,
      },
      async (request) => {
        const created = await openSession(sessions, defaultSession, createSession, request);
        return text(describeSession(created));
      },
    );
  }
  server.registerTool(
    'observe',
    {
      description:
        "What the player can see right now: own soldiers (with AP, life, breath and inventory: slot 0-18, item, index, count, per-object status (rounds for magazines), loaded ammo, attachments, money) and the others the squad sees, with gridNo, level, sub-tile position, direction and animation; open doors and the doors with a known lock or trap state; key rings of own soldiers; items the squad has seen on the ground; in turn-based combat whose turn it is, the round and whether an interrupt is open; in a campaign also the clock, strategic map, open prompt (contract prompts in contractPrompt), autoresolve battle, open shop and open laptop (observe.laptop: balance, mails, history, finances, files, personnel, A.I.M. mercs with salaries and kit, M.E.R.C. listings and account, I.M.P., Bobby Ray stock and shipments, insurance offers, mercs in transit, landing zone); the strategic view shows landingZone and unreadMail and quests (the quest log from the history: [{id, quest, started: {minute, sector}|null, finished: {minute, sector}|null}]; a quest changed without a history line is not listed) and in-transit mercs their arrival; strategic mercs show their contract, morale, days served and cost (merchant NPCs carry merchant: buySell|buy|sell|repair); the strategic view lists vehicles (passengers, seats, path) and, once Skyrider's helicopter is available, helicopter {sector, next, airborne, hovering, returning, passengers, canFly, reason, owed, hits, path, etaMinutes, safeSectors, unsafeSectors, routeCost, refuelSites} ({destroyed: true} after it was shot down); mercs in a vehicle carry vehicle; in a conversation observe.conversation {npc, profile, name, talker, initiatedBy, menu, lastQuotes [{profile, quote, record, textKey, text}]} and observe.scriptedSequence; a yes/no question from an NPC in observe.npcRequest {id, kind: npcRequest, request: escort|hire|boxingBet|fightAgain|buyVest|payDoctor|freeTreatment|buyVehicle|spareKrott|marryDaryl|lie, npc, name, merc?, amount?, pair?, choices}; seen soldiers carry talkable (npc|epc|civilian) and profile. Civilians follow their map schedules: when time passes on the map screen they are moved, put to bed or sent off the map at once; in tactical they walk to their spots, use doors and leave or re-enter the map; a civilian off the map is absent from soldiers.",
      inputSchema: sessionArg,
    },
    async ({ session }) => text(pick(session).sim.view()),
  );
  server.registerTool(
    'act',
    {
      description:
        'Issue one game command and get whether it was accepted (refusals say why). Commands: {"type":"move","soldier":<id>,"to":<gridNo>,"mode":"walk"|"run"|"swat"|"crawl"} (mode defaults to the current stance), {"type":"turn","soldier":<id>,"direction":0-7} or {"type":"turn","soldier":<id>,"toward":<gridNo>}, {"type":"stance","soldier":<id>,"stance":"stand"|"crouch"|"prone"}, {"type":"stop","soldier":<id>}, {"type":"attack","soldier":<id>,"target":<gridNo>,"level":0|1,"aimTime":0-4,"bodyPart":"head"|"torso"|"legs"|"random","burst":true|false} (uses what is in hand: fires a gun or a grenade launcher, throws a grenade or rock at the tile, stabs with a knife at a soldier on a side tile, punches a soldier on any adjacent tile with empty hands; aimTime adds one AP and about 10% to hit per point), {"type":"estimateAttack", same fields} (no action; returns data.apCost, data.chanceToHit, data.chanceToGetThrough and for melee data.inReach; for throws data.apCost, data.chanceToHit, data.pathClear, data.landsAt and data.maxRange), {"type":"pickUp","soldier":<id>,"gridNo":<gridNo>,"items":[<index>...]} (walks there and picks up the visible items on that tile, all by default, indices into the observed item list of that tile; 3 AP), {"type":"drop","soldier":<id>,"slot":"hand"|0-18} (drops at the feet), {"type":"climb","soldier":<id>} (onto the adjacent roof edge, or down when on a roof), {"type":"door","soldier":<id>,"gridNo":<door gridNo>,"action":"open"|"close"|"unlock"|"lock"|"pickLock"|"force"|"crowbar"|"explode"|"untrap"|"examine"} (walks next to the door, then acts; data.walking while on the way; open on a locked door does not open it but returns data.opened false, locked true and the door menu as data.options [{action, ap, enabled, reason}]; the other actions need a closed locked door and the tool (key, crowbar, lockpick kit, shaped charge); refusals in data.refusal: noDoor, alreadyOpen, alreadyClosed, doorOpen, notLocked, noLock, alreadyLocked, noKey, noCrowbar, noLockpickKit, noShapedCharge, escortCannot, alreadyKnown, notEnoughAp, noPath; outcomes arrive as doorMenu, doorResult {action, result}, doorTrap and lockDestroyed events; observe.doors shows the lock and trap state the squad knows, own soldiers carry keys), {"type":"endTurn"} (turn-based combat; also closes an interrupt). In a campaign session also strategic commands: {"type":"route","soldier":<id>,"to":"B9"} (plots and confirms travel for the merc\'s squad; data.path, data.etaMinutes; refused while the squad\'s sector holds enemies, in combat, for the badly wounded or busy), {"type":"cancelRoute","soldier":<id>}, {"type":"assignSquad","soldier":<id>,"squad":0-19|"new"|"any"}, {"type":"assign","soldiers":[<id>...],"to":{"kind":"doctor"|"patient"|"repair"|"trainMilitia"} or {"kind":"trainSelf"|"trainTeammate"|"trainByOther","stat":<n>}}, {"type":"sleep"|"wake","soldier":<id>}, {"type":"enterSector","sector":"B9"} (loads a sector where mercs stand), {"type":"exitSector","soldier":<id>,"direction":"north"|"east"|"south"|"west" (or "exitGrid":<gridNo>),"who":"squad"|"merc","load":true|false} (walks off the map edge into the next sector), {"type":"mapScreen"} and {"type":"tacticalScreen"} (switch between the strategic map, where time can be compressed, and the loaded sector, which stays frozen while the map is open), {"type":"compressTime","mode":2|3|4} (map only; 5, 30 or 60 world minutes per real second; time moves only while the session advances; refused with enemies in the loaded sector), {"type":"stopTime"}, {"type":"answer","prompt":"<id from observe.prompt, optional>","choice":...} (preBattle: "autoresolve"|"enterSector"|"retreat"; surrender: "accept"|"reject"; autoresolveDone: "bandage"|"done"; simultaneousArrival: "coordinate"|"separately"; npcOfNote: "continue"|"stop"; contractRenewal: "day"|"week"|"twoWeeks"|"dismiss"|"letGo"; mercDeparture: "here"|"elsewhere"|"rehire"; insuranceExtension: "yes"|"no"; npcRequest: "yes"|"no" (also "lie" for request lie; the prompt id is observe.npcRequest.id; data is the talk result {conversation, lines, npcRequest?}); while a prompt is open other commands are refused), {"type":"autoresolveRetreat","soldier":<id>} or {"type":"autoresolveRetreat"} (all; during an autoresolve battle, whose cells, counts and status are in observe.autoresolve), {"type":"autoresolveBattle"} (autoresolve a tactical battle in progress instead of fighting it). Helicopter and vehicles (map screen): {"type":"heliRoute","to":"B13"} (Skyrider flies his helicopter there, replacing its route and taking off; data.path, data.etaMinutes; route/cancelRoute for a merc aboard do the same), {"type":"heliCancel"}, {"type":"boardVehicle","soldier":<id>,"vehicle":"helicopter"|<vehicle id>} (the vehicle must stand in the merc\'s sector; data.seat), {"type":"leaveVehicle","soldier":<id>,"squad":0-19} (joins that squad, default the first empty one, in the vehicle\'s sector; refused while the helicopter flies or returns). Refusals in data.refusal: noHelicopter, skyriderOwed, returningToBase, grounded, skyriderUnwilling, emptyHelicopterHint (shown once when the helicopter would leave empty while mercs stand in its sector; asking again flies it), noRoute, noSuchVehicle, notAccessible, alreadyAboard, vehicleFull, notAllowed, vehicleNotOurs, notInVehicle, helicopterInFlight, combat, unconscious, moving, underground, inTransit, prisoner, squadFull, squadElsewhere, squadMoving, squadHasVehicle. Skyrider bills $100 per sector of friendly and $1000 per sector of enemy airspace at the end of each flight (a debt grounds him until paid, hourly from the balance); SAM sites may hit the helicopter in enemy airspace (two hits send it home, the third destroys it with everyone aboard); after 10 minutes of hovering he warns, after 20 he drops the passengers in a safe sector and returns to base. Contracts (map screen only): {"type":"extendContract","soldier":<id>,"length":"day"|"week"|"twoWeeks"} (pays from the balance; the merc may refuse: data.extended false with the reason), {"type":"contractOptions","soldier":<id>} (no action; the renewal options with costs and why some are disabled), {"type":"dismiss","soldier":<id>} (then a mercDeparture prompt: where the gear stays), {"type":"removeMerc","soldier":<id>} (dead or captured mercs only). Conversations (campaign, tactical): {"type":"talk","soldier":<id>,"target":<soldier id>|{"npc":<profile id or name>}} (a named NPC in sight; beyond 4 tiles the soldier walks up first: data.walking, data.to, and the conversation opens during advance; 6 AP in combat; an own merc answers with a bark in data.bark; refusals in data.refusal: noSuchTarget, notTalkable, targetHidden, targetMoving, talkerIsRobot, noLineOfSight, targetCollapsed, refusesToTalk, civilianBark, noPath, notEnoughAP, promptOpen, shopOpen, sessionOpen, scriptedSequence), {"type":"approach","kind":"repeat"|"friendly"|"direct"|"threaten"|"recruit"|"whoAreYou"|"buySell"|"give"} (one entry of observe.conversation.menu; buySell at a merchant opens the shop, give closes the panel; refusals noConversation, busy, unknownApproach, notADealer, isADealer), {"type":"closeTalk"}. talk and approach return data {conversation, lines: [{profile, quote, record, textKey, text}], scriptedSequence, shop, npcRequest (a yes/no question from an NPC; answer it before any other command)}; while a conversation is open only approach and closeTalk are accepted (refusal conversationOpen) and time stands still; during a scripted sequence (the NPC acts on its own) commands are refused with scriptedSequence until advance has run it. Merchants: {"type":"openShop","dealer":<profile id or name>,"soldier":<id>} (the soldier talks to a merchant it sees within 4 tiles, 6 AP; data is the shop as in observe.shop: kind, boxes with unit prices, balance; while a shop is open only quoteTrade, trade and closeShop are accepted and time stands still; openShop goes through a conversation: when the merchant speaks first, data is the talk result instead of the shop), {"type":"trade","buy":[{"item":<id>,"element":<n>,"count":<n>}],"sell":[{"soldier":<id>,"slot":0-18|"hand","index":<n>}],"cash":[{"soldier":<id>,"slot":...,"amount":<n>}],"repair":[{"soldier":<id>,"slot":...}],"useBalance":true|false} (one exchange; purchases go to the soldier, or to the floor; refusals such as cannotAfford, dealerCannotAfford, wontBuy, wontRepair carry details in data), {"type":"quoteTrade", same fields} (no action; returns costs, values, repair times and the refusal the trade would get), {"type":"closeShop"}. Laptop (map screen): {"type":"openLaptop"} (a modal session: time stands still, only laptop commands and queries are accepted, advance is refused), {"type":"closeLaptop"}, {"type":"setLandingZone","sector":"B13"} (map screen, after the first landing), {"type":"readEmail"|"deleteEmail","id":<n>}, {"type":"aimHire","profile":0-39,"contract":1|7|14,"gear":true|false} (pays salary, kit and medical deposit; data.arrival {minute, shownMinute, sector}; refusals such as away, hangover, hatesTeammate, deathRate, reputation, funds, teamFull), {"type":"aimLeaveMessage","profile":<n>}, {"type":"mercOpenAccount"}, {"type":"mercHire","profile":<n>}, {"type":"mercPay"}, {"type":"impCreate","code":"XEP624","name":"…","nickname":"…","gender":"male"|"female","answers":[16 answer indices],"attributes":{"health","agility","dexterity","strength","wisdom","leadership","marksmanship","medical","mechanical","explosives"},"portrait":<n>,"voice":<n>}, {"type":"bobbyRayOrder","lines":[{"item":<id>,"used":true|false,"quantity":<n>}],"destination":<id>,"speed":0|1|2}, {"type":"insure","soldier":<id>}, {"type":"orderFlowers","bouquet":0-9,"destination":<id>,"nextDay":true|false,"extras":["crushed"|"blackRoses"|"wilted"|"fruitCake"]}; queries without action at any time: aimQuote {profile, contract, gear}, bobbyRayQuote {lines, destination, speed}, insuranceQuote {soldier}, impPreview {answers, gender}, arrivalTime. In combat every action costs AP and only soldiers that have not finished their turn may act; no order is accepted while an attack is still resolving. gridNo = y*160 + x; direction 0 = north (up-right on screen), clockwise.',
      inputSchema: { ...sessionArg, command: z.object({ type: z.string() }).passthrough() },
    },
    async ({ session, command }) => text(await pick(session).prepareAndDispatch(command)),
  );
  server.registerTool(
    'advance',
    {
      description:
        'Let game time run. Tactical: until our soldiers are idle (in combat: it is our turn again and nobody is acting), a listed event happens (arrived, stopped, noPath, doorChanged, doorMenu, doorResult, doorTrap, lockDestroyed, noiseHeard, enemySighted, combatStarted, turnStarted, interrupt, combatEnded, shotFired, meleeStrike, explosion, structureDamaged, soldierHit, soldierDied, attackResolved, itemsPickedUp, itemDropped), or a tick limit (5 ms per tick) is reached. Campaign (strategic map): pass worldTime (world seconds or {day, hour, minute}), worldSeconds (from now), compressionStopped (default true: stop whenever compression stops, e.g. a squad arrived; false: restart it and keep going) and mode (2, 3 or 4: 5, 30 or 60 world minutes per second); compression starts by itself. A conversation is a decision too: an NPC that starts talking, or the end of a talk walk-up, stops advance with decision and observe.conversation; with a conversation open advance is refused (conversationOpen); a scripted sequence runs until it ends or a conversation opens. Conversation events: conversationOpened, conversationClosed, npcQuote (with text), npcMessage, scriptedSequence, talkAborted, npcRequest, npcGaveItem, terroristRevealed, townDiscovered, sexScene, boxingBell (npcMessage kinds include teamFull, recruited, nowEscorted, balanceOwed, itemPlacedOnGround, vehicleRefuelled). Campaign reports also list questStarted and questFinished events {quest, id, sector}. The helicopter\'s arrivals, SAM hits, hovering warnings, its return and Skyrider\'s debts stop compression; the report\'s events carry heliArrived, heliHit, heliHovering, heliReturning, heliLanded, heliDestroyed, heliPaid, heliOwed, passengersDropped, skyriderQuote, skyriderMonologue and samSitesRevealed. Every report carries worldTime; reason is idle, event, ticks, worldTime, budget, refused (with refusal, e.g. enemies in the loaded sector, a shop or the laptop is open) or decision. A decision is a pending choice: an interrupt in our favour (act with the listed soldiers, then endTurn) or an open prompt in observe.prompt (preBattle, surrender, autoresolveDone, simultaneousArrival, npcOfNote) or observe.contractPrompt (contractRenewal, mercDeparture, insuranceExtension) or observe.npcRequest (a yes/no question from an NPC; the clock and ticks stand still until it is answered), answered with act {"type":"answer","choice":...}. During an autoresolve battle advance runs its slices (200 ticks = one battle second).',
      inputSchema: {
        ...sessionArg,
        idle: z.boolean().optional(),
        ticks: z.number().int().positive().max(200_000).optional(),
        events: z.array(z.string()).optional(),
        worldTime: z
          .union([
            z.number().int().nonnegative(),
            z.object({
              day: z.number().int().nonnegative(),
              hour: z.number().int().min(0).max(23).optional(),
              minute: z.number().int().min(0).max(59).optional(),
            }),
          ])
          .optional(),
        worldSeconds: z.number().int().positive().optional(),
        compressionStopped: z.boolean().optional(),
        mode: z.number().int().min(2).max(4).optional(),
      },
    },
    async ({ session, idle, ticks, events, worldTime, worldSeconds, compressionStopped, mode }) => {
      const report = pick(session).advance({
        ...(idle ? { idle: true as const } : {}),
        ...(ticks ? { ticks } : {}),
        ...(events ? { events: events as never } : {}),
        ...(worldTime !== undefined ? { worldTime: worldTimeTarget(worldTime) } : {}),
        ...(worldSeconds ? { worldSeconds } : {}),
        ...(compressionStopped !== undefined ? { compressionStopped } : {}),
        ...(mode ? { mode } : {}),
      });
      return text({
        tick: report.tick,
        reason: report.reason,
        ...(report.worldTime ? { worldTime: report.worldTime } : {}),
        ...(report.refusal ? { refusal: report.refusal } : {}),
        events: report.events,
      });
    },
  );
  return server;
}

export async function handleMcpRequest(
  request: Request,
  sessions: Map<string, Session>,
  defaultSession: string,
  createSession?: SessionFactory,
): Promise<Response> {
  const server = buildMcpServer(sessions, defaultSession, createSession);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
