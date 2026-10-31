// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Bottom.cc AllowedToTimeCompress (the refusal order),
// @src AnyUsableRealMercenariesOnTeam; Strategic/MapScreen.cc UpdatePausedStatesDueToTimeCompression;
// @src Strategic/Game_Clock.cc AdvanceClock (the reset of the player-knows-enemies flags); TileEngine/Environment.cc
// @src EnvironmentController (the ambient light).

import { type Sector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { type WorldTimeControl, type WorldTimeReading, worldTimeReading } from '../advance.ts';
import { TICK_MS } from '../clock.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { applyOptionChange, parseOptionChange } from '../options.ts';
import type { QueenContext, QueenContextOptions } from '../strategic/ai/context.ts';
import { hourlyProgressUpdate } from '../strategic/ai/difficulty.ts';
import { queenEconomyHooks, queenMineIncome } from '../strategic/ai/economy-link.ts';
import { areInMeanwhile, handleFlowersMeanwhileScene, handleScientistAwolMeanwhileScene } from '../strategic/ai/meanwhile.ts';
import { registerStrategicAiEvents, StrategicAi } from '../strategic/ai/strategic-ai.ts';
import { reEvaluateNothingToDoIfFlagged } from '../strategic/economy/assignment-done.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { createEconomyContext, type EconomySetup, economyWorldPort } from '../strategic/economy/context.ts';
import { createMerchantContext, type MerchantContext, type MerchantSetup, type ShopHours } from '../strategic/economy/merchants/context.ts';
import { dailyUpdateOfArmsDealersInventory } from '../strategic/economy/merchants/daily.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { applySquadAssignment } from '../strategic/economy/set-assignment.ts';
import { registerEconomyEvents } from '../strategic/economy/update.ts';
import { EncounterCode, SectorFlag } from '../strategic/forces/constants.ts';
import {
  createStrategicContext,
  handleGroupAboutToArriveEvent,
  handleGroupArrivalEvent,
  type StrategicContextOptions,
} from '../strategic/forces/context.ts';
import { wildernessSectorWithAllProfiledNpcsNotSpokenWith } from '../strategic/forces/npcs-of-note.ts';
import { defaultTacticalWorldPort, type StrategicContext, type TacticalWorldPort } from '../strategic/forces/ports.ts';
import { isSectorDesert } from '../strategic/map/sectors.ts';
import { Quest } from '../strategic/narrative/fact-ids.ts';
import { NOT_BOXING, QuestStatus, questStatus } from '../strategic/narrative/facts.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { createStrategicState, type StrategicState } from '../strategic/state.ts';
import { CompressMode, EventKind } from '../strategic/time/constants.ts';
import { EventDispatch } from '../strategic/time/dispatch.ts';
import { changeLightValue, timeOfDayAmbientLightLevel, updateTemperature } from '../strategic/time/environment.ts';
import {
  type ClockContext,
  type ClockScreen,
  CompressionStop,
  type CompressionStopReason,
  compressionStopReason,
  isTimeBeingCompressed,
  pauseGame,
  setGameTimeCompressionLevel,
  startTimeCompression,
  stopTimeCompression,
  unPauseGame,
  updateClock,
  worldDay,
  worldTotalMinutes,
} from '../strategic/time/world-clock.ts';
import { type ExperienceHooks, NO_EXPERIENCE_HOOKS } from '../tactical/combat/context.ts';
import { extractScheduleDoorLockAndUnlockInfo } from '../tactical/narrative/schedules.ts';
import { refuse } from '../tactical/refusal.ts';
import { hostileBloodcatsPresent } from '../tactical/sector-presence.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { assignmentAnimationHooks } from './assignment-animations.ts';
import { BattleFlow, type BattleSetup } from './battle-flow.ts';
import { dispatchStrategicCommand } from './commands.ts';
import { COMPRESSION_REFUSALS, type CompressionRefusal, compressionRefusalToken } from './compression-refusals.ts';
import type { ContractHooks } from './contracts/context.ts';
import { ContractFlow } from './contracts/contract-flow.ts';
import { CreatureFlow } from './creature-flow.ts';
import { EndgameFlow } from './endgame-flow.ts';
import { HelicopterFlow } from './helicopter-flow.ts';
import { mercArrives, teamJackedInAndGearedToGo } from './hiring.ts';
import { LaptopFlow, type LaptopSetup } from './laptop/laptop-flow.ts';
import { MapInventory } from './map-inventory.ts';
import { MeanwhileFlow } from './meanwhile-flow.ts';
import { MoneyFlow } from './money-flow.ts';
import { NarrativeFlow } from './narrative/narrative-flow.ts';
import { registerNarrativeEvents } from './narrative-port.ts';
import { flagNothingToDoAfterItemMove } from './nothing-to-do.ts';
import { PowFlow } from './pow.ts';
import { enterMapScreen, openMapScreen, openTacticalScreen } from './screens.ts';
import { dispatchSectorCommand, loadStartSector, SectorFlow, type SectorSetup, sectorWorldPort } from './sector-flow.ts';
import { ShopFlow } from './shop-flow.ts';
import { storyRefusal } from './story-refusals.ts';
import { type NarrativeSetup, TalkFlow } from './talk-flow.ts';

export interface CampaignCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type StrategicSetup = Omit<StrategicContextOptions, 'state' | 'clock'>;

export type SimConstruction = 'create' | 'createOnMapScreen' | 'restore';

const BOXING_UI_LOCK_TEXT = 'the interface is locked while the boxers leave the ring';
const PROMPT_OPEN_REFUSAL = 'promptOpen: a prompt is open, answer it first';

export interface CampaignHooks {
  readonly compressionRefusal?: (campaign: CampaignSim) => string | null;
  readonly loadStartSector?: (campaign: CampaignSim) => void;
  readonly strategic?: StrategicSetup;
  readonly economy?: EconomySetup;
  readonly queen?: QueenContextOptions;
  readonly sectors?: SectorSetup;
  readonly battle?: BattleSetup;
  readonly merchants?: MerchantSetup;
  readonly contracts?: Partial<ContractHooks>;
  readonly laptop?: LaptopSetup;
  readonly narrative?: NarrativeSetup;
}

export class CampaignSim {
  readonly state: StrategicState;
  readonly dispatchTable = new EventDispatch<CampaignSim>();
  tactical: TacticalSim | null;
  readonly strategic: StrategicContext | null;
  readonly economy: EconomyContext | null;
  readonly queen: QueenContext | null;
  readonly sectors: SectorFlow | null;
  readonly battle: BattleFlow | null;
  readonly creatures: CreatureFlow | null;
  readonly merchants: MerchantContext | null;
  readonly shop: ShopFlow | null;
  readonly contracts: ContractFlow | null;
  readonly laptop: LaptopFlow | null;
  readonly helicopter: HelicopterFlow;
  readonly talk: TalkFlow | null;
  readonly narrative: NarrativeFlow;
  readonly meanwhile: MeanwhileFlow;
  readonly endgame: EndgameFlow;
  readonly pows: PowFlow;
  readonly mapInventory: MapInventory;
  readonly money: MoneyFlow;
  readonly worldClock: WorldTimeControl;
  readonly #events: SimEvent[] = [];
  readonly #hooks: CampaignHooks;
  readonly #clock: ClockContext;

  constructor(
    state: StrategicState = createStrategicState(),
    tactical: TacticalSim | null = null,
    hooks: CampaignHooks = {},
    construction: SimConstruction = 'create',
  ) {
    const creating = construction !== 'restore';
    this.state = state;
    this.tactical = tactical;
    this.#hooks = hooks;
    if (construction === 'create' && tactical) state.flow = 'tactical';
    this.narrative = new NarrativeFlow(this);
    this.meanwhile = new MeanwhileFlow(this);
    this.endgame = new EndgameFlow(this);
    this.pows = new PowFlow(this);
    this.mapInventory = new MapInventory(this);
    this.money = new MoneyFlow(this);
    this.#clock = this.#clockContext();
    this.helicopter = new HelicopterFlow(this);
    const ai = hooks.queen
      ? new StrategicAi({
          mines: queenMineIncome(() => this.economy),
          ...hooks.queen,
          hooks: {
            creatureQuestEnded: () => this.#creatureQuestEnded(),
            profile: (id) => this.narrative.profile(id),
            startQuest: (quest, sector) => this.narrative.startQuest(quest, sector),
            ...hooks.queen.hooks,
          },
        })
      : null;
    this.strategic = hooks.strategic
      ? createStrategicContext({
          ...hooks.strategic,
          ...this.#narrativeWorldPorts(this.#helicopterPorts(this.#sectorPorts(this.#economyPorts()))),
          ...(ai ? { ai } : {}),
          state,
          clock: this.#clock,
        })
      : null;
    this.queen = ai && this.strategic ? ai.bind(this.strategic) : null;
    this.narrative.slots = { ...this.narrative.slots, scientistAwolMeanwhile: () => this.#scientistAwol() };
    this.economy = this.strategic && hooks.economy ? createEconomyContext(this.strategic, this.#economySetup(hooks.economy)) : null;
    this.sectors = this.strategic && hooks.sectors ? new SectorFlow(this, hooks.sectors) : null;
    const battleSetup = hooks.battle ?? hooks.sectors;
    this.battle = this.economy && battleSetup ? new BattleFlow(this, battleSetup) : null;
    this.#joinSquadsThroughTheEconomy();
    this.creatures = this.economy ? new CreatureFlow(this) : null;
    this.merchants = hooks.merchants ? this.#merchantContext(hooks.merchants) : null;
    this.shop = this.merchants ? new ShopFlow(this) : null;
    this.laptop =
      this.battle && hooks.laptop
        ? new LaptopFlow(this, hooks.laptop, { roster: this.battle.roster, tactical: this.battle.content })
        : null;
    const contractHooks: Partial<ContractHooks> = {
      ...this.laptop?.contractHooks(),
      slayDailyEvent: () => this.narrative.slayDailyEvent(),
      mercLeavingTeam: (m) => this.narrative.mercLeavingTeam(m),
      ...hooks.contracts,
    };
    this.contracts = this.battle
      ? new ContractFlow(this, { roster: this.battle.roster, content: this.battle.content, hooks: contractHooks })
      : null;
    this.talk = hooks.narrative ? new TalkFlow(this, hooks.narrative) : null;
    if (this.talk) this.narrative.slots = { ...this.narrative.slots, ...this.talk.narrativeSlots() };
    this.worldClock = this.#worldTimeControl();
    this.#registerEnvironment();
    this.#registerMovement();
    if (this.economy) registerEconomyEvents(this.dispatchTable, this.economy);
    if (this.queen) registerStrategicAiEvents(this.dispatchTable, this.queen);
    this.creatures?.register(this.dispatchTable);
    this.#registerMerchants();
    this.contracts?.register(this.dispatchTable);
    this.laptop?.register(this.dispatchTable);
    registerNarrativeEvents(this);
    if (this.strategic) this.helicopter.register();
    this.narrative.register(this.dispatchTable);
    if (creating && state.flow === 'tactical') setGameTimeCompressionLevel(this.#clock, CompressMode.X1);
    if (construction === 'createOnMapScreen') enterMapScreen(this);
    tactical?.attachWorldClock(state.clock);
    if (creating) this.#startSession();
  }

  #joinSquadsThroughTheEconomy(): void {
    const economy = this.economy;
    const roster = this.battle?.roster;
    if (!economy || !roster) return;
    roster.hooks = { ...roster.hooks, assignToSquad: (merc, squad) => applySquadAssignment(economy, merc, squad) };
  }

  static restore(state: StrategicState, tactical: TacticalSim | null, hooks: CampaignHooks): CampaignSim {
    return new CampaignSim(state, tactical, hooks, 'restore');
  }

  #startSession(): void {
    const s = this.state;
    s.session.tick = 0;
    s.session.compressing = isTimeBeingCompressed(s.clock);
    s.session.day = worldDay(s.clock);
  }

  #merchantContext(setup: MerchantSetup): MerchantContext {
    const s = this.state;
    return createMerchantContext(
      {
        ...setup,
        hooks: { shopHours: (profile) => this.#scheduleShopHours(profile), ...setup.hooks },
      },
      s.merchants,
      { random: s.rng, preRandom: s.pre },
      {
        gunNut: () => s.options.gunNut,
        highestProgress: () => s.status.highestProgress,
        worldDay: () => worldDay(s.clock),
        worldMinutes: () => worldTotalMinutes(s.clock),
      },
      s.narrative,
    );
  }

  #scheduleShopHours(profile: number): ShopHours | null {
    const t = this.tactical?.state;
    const dealer = t?.soldiers.find((x) => x !== undefined && (x.placed || x.offMap || x.away) && x.profile === profile);
    return t && dealer ? extractScheduleDoorLockAndUnlockInfo(t, dealer) : null;
  }

  #registerMerchants(): void {
    const merchants = this.merchants;
    if (!merchants) return;
    this.dispatchTable.register(EventKind.DAILY_UPDATE_BOBBY_RAY_INVENTORY, () => {
      this.laptop?.bobbyRayDaily();
      this.#hooks.merchants?.bobbyRayDaily?.();
      dailyUpdateOfArmsDealersInventory(merchants);
    });
  }

  #economySetup(setup: EconomySetup): EconomySetup {
    const queen = this.queen;
    const battleHooks = {
      moraleEvent: (kind: string, sector: { x: number; y: number; z: number }) => this.battle?.economyMoraleEvent(kind, sector),
      removeRandomItemsInSector: (sector: { x: number; y: number; z: number }, chance: number) =>
        this.battle?.removeRandomItemsInSector(sector, chance),
      mineClearOfMonsters: (mine: number) => this.creatures?.mineClear(mine) ?? true,
      checkConditionsForTriggeringCreatureQuest: () => this.creatures?.checkConditionsForQuest(),
      startCreatureQuest: (sector: { x: number; y: number; z: number }) => {
        if (questStatus(this.state.narrative, Quest.CREATURES) === QuestStatus.NOT_STARTED)
          this.narrative.startQuest(Quest.CREATURES, sector);
      },
      placeHeadMiner: (profile: number, sector: { x: number; y: number; z: number }, town: number) =>
        this.narrative.placeHeadMiner(profile, sector, town),
      headMinerTown: (profile: number) => this.narrative.headMinerTown(profile),
      headMinerAlive: (profile: number) => this.narrative.headMinerAlive(profile),
      history: (code: number, secondCode: number, sector: { x: number; y: number; z: number }) =>
        this.laptop?.economyHistory(code, secondCode, sector),
      ...assignmentAnimationHooks(this),
    };
    const moraleSlots = {
      updateBuddyAndHatedCounters: () => this.battle?.updateBuddyAndHatedCounters(),
      hourlyMoraleUpdate: () => this.battle?.hourlyMoraleUpdate(),
      decayTacticalMoraleModifiers: () => this.battle?.decayTacticalMoraleModifiers(),
      hourlyCamouflageUpdate: () => this.battle?.hourlyCamouflageUpdate(),
      payOffSkyriderDebtIfAny: () => this.helicopter.payOffSkyriderDebtIfAny(),
    };
    const narrativeSlots = this.narrative.periodicSlots(queen ? () => hourlyProgressUpdate(queen) : null);
    if (!queen)
      return { ...setup, hooks: { ...battleHooks, ...setup.hooks }, slots: { ...moraleSlots, ...narrativeSlots, ...setup.slots } };
    return {
      ...setup,
      hooks: { ...battleHooks, ...queenEconomyHooks(queen), ...setup.hooks },
      slots: { ...moraleSlots, ...narrativeSlots, ...setup.slots },
    };
  }

  #economyPorts(): Pick<StrategicSetup, 'mercs' | 'world'> {
    const economy = this.#hooks.economy;
    if (!economy) return {};
    const world = economyWorldPort(this.#laptopWorldPort(this.#hooks.strategic?.world ?? defaultTacticalWorldPort), () => this.economy);
    return { mercs: economy.crew, world };
  }

  #laptopWorldPort(base: TacticalWorldPort): TacticalWorldPort {
    if (!this.#hooks.laptop) return base;
    return {
      ...base,
      playerControlsSurfaceSector: (sector) => {
        base.playerControlsSurfaceSector?.(sector);
        this.laptop?.surfaceSectorTaken(sector);
      },
      airspaceControlUpdated: () => {
        base.airspaceControlUpdated?.();
        this.laptop?.airspaceControlUpdated();
      },
    };
  }

  #creatureQuestEnded(): void {
    this.creatures?.endQuest();
    this.narrative.endQuest(Quest.CREATURES, this.state.worldSector);
  }

  #scientistAwol(): void {
    if (this.queen) handleScientistAwolMeanwhileScene(this.queen);
  }

  scheduleFlowersMeanwhile(code: number): void {
    if (this.queen) handleFlowersMeanwhileScene(this.queen, code);
  }

  #helicopterPorts(ports: Pick<StrategicSetup, 'mercs' | 'world'>): Pick<StrategicSetup, 'mercs' | 'world' | 'helicopter'> {
    const base = ports.world ?? this.#hooks.strategic?.world ?? defaultTacticalWorldPort;
    return { ...ports, world: this.helicopter.worldPort(base), helicopter: this.helicopter.port() };
  }

  #narrativeWorldPorts<P extends Pick<StrategicSetup, 'world'>>(ports: P): P {
    const base = ports.world ?? this.#hooks.strategic?.world ?? defaultTacticalWorldPort;
    return {
      ...ports,
      world: {
        ...base,
        inMeanwhile: () => (this.queen ? areInMeanwhile(this.queen) : base.inMeanwhile()),
        boxing: () => this.state.narrative.boxing.state !== NOT_BOXING,
        npcOfNoteInSector: (sector) => this.#npcOfNoteInSector(sector),
      },
    };
  }

  #npcOfNoteInSector(sector: Sector): boolean {
    const strategic = this.strategic;
    return strategic !== null && wildernessSectorWithAllProfiledNpcsNotSpokenWith(strategic, sector, this.narrative.listedProfiles());
  }

  #sectorPorts(ports: Pick<StrategicSetup, 'mercs' | 'world'>): Pick<StrategicSetup, 'mercs' | 'world'> {
    if (!this.#hooks.sectors) return ports;
    const base = ports.world ?? this.#hooks.strategic?.world ?? defaultTacticalWorldPort;
    return { ...ports, world: sectorWorldPort(base, () => this.sectors) };
  }

  get tick(): number {
    return this.state.session.tick;
  }

  #clockContext(): ClockContext {
    const s = this.state;
    return {
      clock: s.clock,
      queue: s.queue,
      screen: (): ClockScreen => (s.flow === 'autoresolve' || s.flow === 'laptop' ? 'other' : s.flow),
      inCombat: () => this.tactical?.state.inCombat === true,
      execute: (e) => this.dispatchTable.execute(this, e),
      afterAdvance: () => this.#clearFlashingEnemyCounts(),
      compressionModeSet: () => teamJackedInAndGearedToGo(this, () => (this.#hooks.loadStartSector ?? loadStartSector)(this)),
      timeCompressionStarted: () => this.#clearTacticalStuffDueToTimeCompression(),
      compressionRefusal: () => this.#hooks.compressionRefusal?.(this) ?? this.#defaultRefusal(),
    };
  }

  noUsableMercs(): boolean {
    const roster = this.battle?.roster;
    if (!roster || !this.state.atLeastOneMercHired) return false;
    return !roster
      .all()
      .some(
        (m) =>
          m.life > 0 &&
          !m.isVehicle &&
          !m.isRobot &&
          !m.isEpc &&
          m.assignment !== Assignment.ASSIGNMENT_POW &&
          m.assignment !== Assignment.ASSIGNMENT_DEAD,
      );
  }

  compressionRefusalToken(): string | null {
    if (this.state.clock.pauseLocked) return 'pauseLocked';
    const reason = this.#clock.compressionRefusal();
    return reason === null ? null : compressionRefusalToken(reason);
  }

  #defaultRefusal(): string | null {
    const token = this.#defaultRefusalToken();
    return token ? COMPRESSION_REFUSALS[token] : null;
  }

  #defaultRefusalToken(): CompressionRefusal | null {
    const t = this.tactical?.state;
    if (this.strategic && !this.state.atLeastOneMercHired) return 'noMercsHired';
    if (this.state.meanwhile.trying) return 'meanwhileStarting';
    if (this.noUsableMercs()) return 'noUsableMercs';
    if (t?.inCombat) return 'inCombat';
    if (t?.turn.enemyInSector) return 'enemiesPresent';
    if (this.creatures?.playerInInfestedMine()) return 'creatureMine';
    if (this.state.encounter.code === EncounterCode.BLOODCAT_AMBUSH && t && hostileBloodcatsPresent(t)) return 'bloodcatAmbush';
    if (this.contracts?.sequenceOn) return 'contractRenewal';
    return null;
  }

  #registerEnvironment(): void {
    const d = this.dispatchTable;
    d.register(EventKind.CHANGELIGHTVAL, (c, e) => changeLightValue(c.state.env, e.param, c.#loadedSectorIsUnderground()));
    d.register(EventKind.TEMPERATURE_UPDATE, (c, e) => updateTemperature(c.state.env, e.param));
    d.register(EventKind.TURN_ON_NIGHT_LIGHTS, (c) => c.tactical?.powerNightLights(true));
    d.register(EventKind.TURN_OFF_NIGHT_LIGHTS, (c) => c.tactical?.powerNightLights(false));
    d.register(EventKind.TURN_ON_PRIME_LIGHTS, (c) => c.tactical?.powerPrimeLights(true));
    d.register(EventKind.TURN_OFF_PRIME_LIGHTS, (c) => c.tactical?.powerPrimeLights(false));
  }

  #registerMovement(): void {
    const ctx = this.strategic;
    if (!ctx) return;
    if (!this.#hooks.laptop) this.dispatchTable.register(EventKind.DELAYED_HIRING_OF_MERC, (c, e) => mercArrives(c, e.param));
    this.dispatchTable.register(EventKind.GROUP_ARRIVAL, (_, e) => handleGroupArrivalEvent(ctx, e));
    this.dispatchTable.register(EventKind.GROUP_ABOUT_TO_ARRIVE, () => handleGroupAboutToArriveEvent());
  }

  #environmentController(): void {
    const env = this.state.env;
    if (!env.doLighting || !this.tactical) return;
    this.tactical.setAmbientLight(timeOfDayAmbientLightLevel(env, this.state.worldSector?.z ?? 0, this.#loadedSectorIsDesert()));
    env.doLighting = false;
  }

  #loadedSectorIsDesert(): boolean {
    const world = this.state.worldSector;
    return world !== null && isSectorDesert(this.state.map, world);
  }

  #loadedSectorIsUnderground(): boolean {
    return (this.state.worldSector?.z ?? 0) > 0;
  }

  get clockContext(): ClockContext {
    return this.#clock;
  }

  get experienceHooks(): ExperienceHooks {
    return this.contracts?.experienceHooks ?? NO_EXPERIENCE_HOOKS;
  }

  refreshPauseState(): void {
    if (this.state.flow === 'strategic') this.#updatePausedStatesDueToTimeCompression();
  }

  stopCompression(reason: CompressionStopReason): void {
    stopTimeCompression(this.#clock, reason);
  }

  #updatePausedStatesDueToTimeCompression(): void {
    const c = this.state.clock;
    const allowed = this.#clock.compressionRefusal() === null;
    if (isTimeBeingCompressed(c)) {
      if (!allowed) pauseGame(c);
    } else if (c.compressionOn && c.mode !== CompressMode.X0 && !c.playerPause && allowed) unPauseGame(c);
  }

  #clearFlashingEnemyCounts(): void {
    const s = this.state;
    if (!s.battle.resetAllPlayerKnowsEnemiesFlags || this.tactical?.state.turn.enemyInSector) return;
    for (const info of s.map.sectors) info.flags &= ~SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE;
    s.battle.resetAllPlayerKnowsEnemiesFlags = false;
  }

  #worldTimeControl(): WorldTimeControl {
    return {
      worldTime: (): WorldTimeReading => worldTimeReading(this.state.clock.seconds),
      onMap: () => this.state.flow === 'strategic',
      modalRefusal: () => {
        const talk = this.talk?.modalRefusal();
        if (talk) return talk;
        if (this.shop?.isOpen()) return 'shopOpen: a shop is open, closeShop first';
        return this.laptop?.modalRefusal() ?? null;
      },
      compressing: () => isTimeBeingCompressed(this.state.clock),
      startCompression: (mode?: number) => {
        const refused = this.#compress(mode === undefined ? { type: 'compressTime' } : { type: 'compressTime', mode });
        if (!refused.ok) return refused.reason ?? 'time cannot be compressed';
        this.#syncClockEvents();
        return null;
      },
      stopCompression: () => {
        stopTimeCompression(this.#clock, CompressionStop.WORLD_TIME);
        this.#syncClockEvents();
      },
    };
  }

  #syncClockEvents(): void {
    const c = this.state.clock;
    const session = this.state.session;
    const compressing = isTimeBeingCompressed(c);
    if (compressing !== session.compressing) {
      session.compressing = compressing;
      if (compressing) this.#events.push({ type: 'compressionStarted', mode: c.mode, tick: session.tick });
      else this.#events.push({ type: 'compressionStopped', reason: compressionStopReason(c), tick: session.tick });
    }
    const day = worldDay(c);
    if (day !== session.day) {
      session.day = day;
      this.#events.push({ type: 'dayStarted', day, tick: session.tick });
    }
  }

  #collectEvents(): void {
    if (this.economy) for (const e of this.economy.events.splice(0)) this.#events.push({ ...e, tick: this.tick } as SimEvent);
    if (this.sectors) this.#events.push(...this.sectors.drainEvents());
    if (this.battle) this.#events.push(...this.battle.drainEvents());
    if (this.talk) this.#events.push(...this.talk.drainEvents());
    if (this.shop) this.#events.push(...this.shop.drainEvents());
    if (this.contracts) this.#events.push(...this.contracts.drainEvents());
    if (this.laptop) this.#events.push(...this.laptop.drainEvents());
    this.#events.push(...this.helicopter.drainEvents());
    this.#events.push(...this.narrative.drainEvents());
    this.#events.push(...this.meanwhile.drainEvents());
    this.#events.push(...this.endgame.drainEvents());
    this.#events.push(...this.pows.drainEvents());
    this.#events.push(...this.mapInventory.drainEvents());
    this.#events.push(...this.money.drainEvents());
  }

  ended(): boolean {
    return this.endgame.ended();
  }

  step(): void {
    if (this.ended()) return;
    if (this.battle?.hasPendingDecision() || this.shop?.isOpen() || this.laptop?.isOpen() || this.talk?.hasPendingDecision()) return;
    const s = this.state;
    s.session.tick++;
    if (s.flow === 'tactical' && this.tactical) {
      this.#environmentController();
      this.talk?.beforeTacticalStep();
      this.tactical.step();
      s.realMs = this.tactical.state.clockMs;
      this.#events.push(...this.tactical.drainEvents());
      this.talk?.afterTacticalStep();
      this.sectors?.afterTacticalStep();
    } else if (s.flow === 'autoresolve') this.battle?.stepAutoresolve();
    else {
      s.realMs += TICK_MS;
      this.talk?.afterStrategicStep();
      this.#updatePausedStatesDueToTimeCompression();
    }
    updateClock(this.#clock, s.realMs);
    this.meanwhile.afterStep();
    this.endgame.afterStep();
    if (s.flow === 'strategic') this.helicopter.afterStrategicStep();
    this.#collectEvents();
    this.battle?.afterStep();
    this.contracts?.settle();
    this.#reEvaluateNothingToDo();
    this.#collectEvents();
    this.#syncClockEvents();
  }

  #clearTacticalStuffDueToTimeCompression(): void {
    if (this.state.flow === 'strategic') this.tactical?.clearTacticalStuffDueToTimeCompression();
  }

  #reEvaluateNothingToDo(): void {
    if (this.economy) reEvaluateNothingToDoIfFlagged(this.economy);
  }

  isIdle(): boolean {
    const s = this.state;
    if (this.ended()) return true;
    if (this.endgame.active() || s.meanwhile.trying || s.meanwhile.inScene) return false;
    if (s.flow === 'autoresolve') return this.battle?.autoresolveIdle() ?? true;
    if (s.flow === 'tactical' && this.tactical) return this.tactical.isIdle() && (this.talk?.isIdle() ?? true);
    return !isTimeBeingCompressed(s.clock);
  }

  hasPendingDecision(): boolean {
    if (this.battle?.hasPendingDecision() || this.shop?.isOpen() || this.talk?.hasPendingDecision()) return true;
    return this.state.flow === 'tactical' && this.tactical !== null && this.tactical.hasPendingDecision();
  }

  drainEvents(): SimEvent[] {
    this.#collectEvents();
    return this.#events.splice(0).map((e) => this.#withQuoteText(e));
  }

  #withQuoteText(e: SimEvent): SimEvent {
    const talk = this.talk;
    if (!talk) return e;
    switch (e.type) {
      case 'mercQuote': {
        const sector = this.#speakerSector(e.soldier);
        return { ...(e.textKey ? {} : talk.quoteText(e.profile, e.id)), ...e, ...(sector ? { sector } : {}) };
      }
      case 'headMinerQuote':
        return e.quote < 0 ? e : { ...e, ...talk.quoteText(e.profile, e.quote) };
      case 'skyriderQuote':
        return { ...e, profile: Npc.SKYRIDER, ...talk.quoteText(Npc.SKYRIDER, e.quote) };
      case 'shopkeeperQuote':
        return e.quote < 0 || e.textKey ? e : { ...e, ...talk.quoteText(e.dealer, e.quote) };
      default:
        return e;
    }
  }

  #speakerSector(soldier: number): string | null {
    const merc = this.battle?.roster.get(soldier);
    if (!merc) return null;
    const s = merc.sector;
    return s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s);
  }

  dispatch(cmd: CampaignCommand): CommandResult {
    const result = this.#dispatch(cmd);
    flagNothingToDoAfterItemMove(this.state, cmd, result);
    this.#reEvaluateNothingToDo();
    if (this.state.flow === 'strategic') this.talk?.afterStrategicStep();
    this.#collectEvents();
    this.battle?.settle();
    this.contracts?.settle();
    this.#collectEvents();
    this.#syncClockEvents();
    return result;
  }

  #boxingUiLockRefusal(cmd: CampaignCommand): CommandResult | null {
    if (this.state.flow !== 'tactical' || !this.tactical?.state.boxing.uiLocked) return null;
    if (cmd.type === 'estimateAttack' || cmd.type === 'answer' || cmd.type === 'skipLine') return null;
    return refuse('boxingUiLock', BOXING_UI_LOCK_TEXT);
  }

  #promptOpen(): boolean {
    return this.battle?.hasPendingDecision() === true || this.talk?.requestOpen() === true;
  }

  #setOption(cmd: CampaignCommand): CommandResult {
    if (this.#promptOpen()) return refuse('promptOpen', PROMPT_OPEN_REFUSAL);
    const change = parseOptionChange(cmd);
    if (typeof change === 'string') return refuse('badOption', change);
    const options = this.state.options;
    applyOptionChange(options, change);
    this.#events.push({ type: 'optionChanged', bloodAndGore: options.bloodAndGore, tick: this.tick });
    return { ok: true, data: { options: { ...options } } };
  }

  #dispatch(cmd: CampaignCommand): CommandResult {
    if (cmd.type === 'setOption') return this.#setOption(cmd);
    const story = storyRefusal(this, cmd);
    if (story) return story;
    const locked = this.#boxingUiLockRefusal(cmd);
    if (locked) return locked;
    const talk = this.talk?.dispatch(cmd);
    if (talk) return talk;
    const shop = this.shop?.dispatch(cmd);
    if (shop) return shop;
    const laptop = this.laptop?.dispatch(cmd);
    if (laptop) return laptop;
    const battle = this.battle?.dispatch(cmd);
    if (battle) return battle;
    switch (cmd.type) {
      case 'compressTime':
        return this.#compress(cmd);
      case 'stopTime':
        stopTimeCompression(this.#clock, CompressionStop.REQUESTED);
        return { ok: true };
      case 'mapScreen':
        return openMapScreen(this, cmd.abandonFight === true);
      case 'tacticalScreen':
        return openTacticalScreen(this);
      default:
        return (
          this.money.dispatch(cmd) ??
          this.contracts?.dispatch(cmd) ??
          (this.strategic ? this.helicopter.dispatch(cmd) : null) ??
          dispatchSectorCommand(this, cmd) ??
          dispatchStrategicCommand(this, cmd) ??
          (this.battle ? this.mapInventory.dispatch(cmd) : null) ??
          (this.tactical ? this.tactical.dispatch(cmd) : refuse('unknownCommand', `unknown command ${cmd.type}`))
        );
    }
  }

  #compress(cmd: CampaignCommand): CommandResult {
    if (this.state.flow !== 'strategic') return refuse('mapScreenOnly', 'time compression works on the strategic map only');
    const mode = cmd.mode;
    if (mode !== undefined && (typeof mode !== 'number' || mode < CompressMode.MIN5 || mode > CompressMode.MIN60))
      return refuse('badMode', 'mode must be 2 (5 min/s), 3 (30 min/s) or 4 (60 min/s)');
    if (typeof mode === 'number') {
      const refused = setGameTimeCompressionLevel(this.#clock, mode);
      if (refused) return refuse(compressionRefusalToken(refused), refused);
      if (this.state.flow !== 'strategic') return { ok: true };
    }
    const refused = startTimeCompression(this.#clock);
    if (refused) return refuse(compressionRefusalToken(refused), refused);
    this.#updatePausedStatesDueToTimeCompression();
    return { ok: true };
  }
}
