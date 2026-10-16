import { type WorldTimeControl, type WorldTimeReading, worldTimeReading } from '../advance.ts';
import { TICK_MS } from '../clock.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import type { QueenContext, QueenContextOptions } from '../strategic/ai/context.ts';
import { queenEconomyHooks, queenEconomySlots, queenMineIncome } from '../strategic/ai/economy-link.ts';
import { registerStrategicAiEvents, StrategicAi } from '../strategic/ai/strategic-ai.ts';
import { createEconomyContext, type EconomySetup, economyWorldPort } from '../strategic/economy/context.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { registerEconomyEvents } from '../strategic/economy/update.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import {
  createStrategicContext,
  handleGroupAboutToArriveEvent,
  handleGroupArrivalEvent,
  type StrategicContextOptions,
} from '../strategic/forces/context.ts';
import { defaultTacticalWorldPort, type StrategicContext } from '../strategic/forces/ports.ts';
import { isSectorDesert } from '../strategic/map/sectors.ts';
import { createStrategicState, type StrategicState } from '../strategic/state.ts';
import { CompressMode, EventKind } from '../strategic/time/constants.ts';
import { EventDispatch } from '../strategic/time/dispatch.ts';
import { changeLightValue, timeOfDayAmbientLightLevel, updateTemperature } from '../strategic/time/environment.ts';
import {
  type ClockContext,
  type ClockScreen,
  CompressionStop,
  compressionStopReason,
  isTimeBeingCompressed,
  pauseGame,
  setGameTimeCompressionLevel,
  startTimeCompression,
  stopTimeCompression,
  unPauseGame,
  updateClock,
  worldDay,
} from '../strategic/time/world-clock.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { BattleFlow, type BattleSetup } from './battle-flow.ts';
import { dispatchStrategicCommand } from './commands.ts';
import { mercArrives, teamJackedInAndGearedToGo } from './hiring.ts';
import { openMapScreen, openTacticalScreen } from './screens.ts';
import { dispatchSectorCommand, loadStartSector, SectorFlow, type SectorSetup, sectorWorldPort } from './sector-flow.ts';

export interface CampaignCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type StrategicSetup = Omit<StrategicContextOptions, 'state' | 'clock'>;

export interface CampaignHooks {
  readonly compressionRefusal?: (campaign: CampaignSim) => string | null;
  readonly loadStartSector?: (campaign: CampaignSim) => void;
  readonly strategic?: StrategicSetup;
  readonly economy?: EconomySetup;
  readonly queen?: QueenContextOptions;
  readonly sectors?: SectorSetup;
  readonly battle?: BattleSetup;
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
  readonly worldClock: WorldTimeControl;
  readonly #events: SimEvent[] = [];
  readonly #hooks: CampaignHooks;
  readonly #clock: ClockContext;
  #tick = 0;
  #compressing = false;
  #day = 0;

  constructor(state: StrategicState = createStrategicState(), tactical: TacticalSim | null = null, hooks: CampaignHooks = {}) {
    this.state = state;
    this.tactical = tactical;
    this.#hooks = hooks;
    if (tactical) state.flow = 'tactical';
    this.#clock = this.#clockContext();
    const ai = hooks.queen ? new StrategicAi({ mines: queenMineIncome(() => this.economy), ...hooks.queen }) : null;
    this.strategic = hooks.strategic
      ? createStrategicContext({
          ...hooks.strategic,
          ...this.#sectorPorts(this.#economyPorts()),
          ...(ai ? { ai } : {}),
          state,
          clock: this.#clock,
        })
      : null;
    this.queen = ai && this.strategic ? ai.bind(this.strategic) : null;
    this.economy = this.strategic && hooks.economy ? createEconomyContext(this.strategic, this.#economySetup(hooks.economy)) : null;
    this.sectors = this.strategic && hooks.sectors ? new SectorFlow(this, hooks.sectors) : null;
    const battleSetup = hooks.battle ?? hooks.sectors;
    this.battle = this.economy && battleSetup ? new BattleFlow(this, battleSetup) : null;
    this.worldClock = this.#worldTimeControl();
    this.#registerEnvironment();
    this.#registerMovement();
    if (this.economy) registerEconomyEvents(this.dispatchTable, this.economy);
    if (this.queen) registerStrategicAiEvents(this.dispatchTable, this.queen);
    if (state.flow === 'tactical') setGameTimeCompressionLevel(this.#clock, CompressMode.X1);
    tactical?.attachWorldClock(state.clock);
    this.#compressing = isTimeBeingCompressed(state.clock);
    this.#day = worldDay(state.clock);
  }

  #economySetup(setup: EconomySetup): EconomySetup {
    const queen = this.queen;
    const battleHooks = {
      moraleEvent: (kind: string, sector: { x: number; y: number; z: number }) => this.battle?.economyMoraleEvent(kind, sector),
      removeRandomItemsInSector: (sector: { x: number; y: number; z: number }, chance: number) =>
        this.battle?.removeRandomItemsInSector(sector, chance),
    };
    if (!queen) return { ...setup, hooks: { ...battleHooks, ...setup.hooks } };
    return {
      ...setup,
      hooks: { ...battleHooks, ...queenEconomyHooks(queen), ...setup.hooks },
      slots: { ...queenEconomySlots(queen), ...setup.slots },
    };
  }

  #economyPorts(): Pick<StrategicSetup, 'mercs' | 'world'> {
    const economy = this.#hooks.economy;
    if (!economy) return {};
    const world = economyWorldPort(this.#hooks.strategic?.world ?? defaultTacticalWorldPort, () => this.economy);
    return { mercs: economy.crew, world };
  }

  #sectorPorts(ports: Pick<StrategicSetup, 'mercs' | 'world'>): Pick<StrategicSetup, 'mercs' | 'world'> {
    if (!this.#hooks.sectors) return ports;
    const base = ports.world ?? this.#hooks.strategic?.world ?? defaultTacticalWorldPort;
    return { ...ports, world: sectorWorldPort(base, () => this.sectors) };
  }

  get tick(): number {
    return this.#tick;
  }

  #clockContext(): ClockContext {
    const s = this.state;
    return {
      clock: s.clock,
      queue: s.queue,
      screen: (): ClockScreen => (s.flow === 'autoresolve' ? 'other' : s.flow),
      inCombat: () => this.tactical?.state.inCombat === true,
      execute: (e) => this.dispatchTable.execute(this, e),
      afterAdvance: () => this.#clearFlashingEnemyCounts(),
      compressionModeSet: () => teamJackedInAndGearedToGo(this, () => (this.#hooks.loadStartSector ?? loadStartSector)(this)),
      firstCompressionSinceMapEntry: () => {},
      compressionRefusal: () => this.#hooks.compressionRefusal?.(this) ?? this.#defaultRefusal(),
    };
  }

  #defaultRefusal(): string | null {
    const t = this.tactical?.state;
    if (this.strategic && !this.state.atLeastOneMercHired) return 'no merc has been hired yet';
    if (t?.inCombat) return 'combat is in progress';
    if (t?.turn.enemyInSector) return 'enemies are present in the loaded sector';
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
    this.dispatchTable.register(EventKind.DELAYED_HIRING_OF_MERC, (c, e) => mercArrives(c, e.param));
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
    const compressing = isTimeBeingCompressed(c);
    if (compressing !== this.#compressing) {
      this.#compressing = compressing;
      if (compressing) this.#events.push({ type: 'compressionStarted', mode: c.mode, tick: this.#tick });
      else this.#events.push({ type: 'compressionStopped', reason: compressionStopReason(c), tick: this.#tick });
    }
    const day = worldDay(c);
    if (day !== this.#day) {
      this.#day = day;
      this.#events.push({ type: 'dayStarted', day, tick: this.#tick });
    }
  }

  #collectEvents(): void {
    if (this.sectors) this.#events.push(...this.sectors.drainEvents());
    if (this.battle) this.#events.push(...this.battle.drainEvents());
  }

  step(): void {
    if (this.battle?.hasPendingDecision()) return;
    const s = this.state;
    this.#tick++;
    if (s.flow === 'tactical' && this.tactical) {
      this.#environmentController();
      this.tactical.step();
      s.realMs = this.tactical.state.clockMs;
      this.#events.push(...this.tactical.drainEvents());
      this.sectors?.afterTacticalStep();
    } else if (s.flow === 'autoresolve') this.battle?.stepAutoresolve();
    else {
      s.realMs += TICK_MS;
      this.#updatePausedStatesDueToTimeCompression();
    }
    updateClock(this.#clock, s.realMs);
    this.#collectEvents();
    this.battle?.afterStep();
    this.#collectEvents();
    this.#syncClockEvents();
  }

  isIdle(): boolean {
    const s = this.state;
    if (s.flow === 'autoresolve') return this.battle?.autoresolveIdle() ?? true;
    if (s.flow === 'tactical' && this.tactical) return this.tactical.isIdle();
    return !isTimeBeingCompressed(s.clock);
  }

  hasPendingDecision(): boolean {
    if (this.battle?.hasPendingDecision()) return true;
    return this.state.flow === 'tactical' && this.tactical !== null && this.tactical.hasPendingDecision();
  }

  drainEvents(): SimEvent[] {
    this.#collectEvents();
    return this.#events.splice(0);
  }

  dispatch(cmd: CampaignCommand): CommandResult {
    const result = this.#dispatch(cmd);
    this.#collectEvents();
    this.battle?.settle();
    this.#collectEvents();
    this.#syncClockEvents();
    return result;
  }

  #dispatch(cmd: CampaignCommand): CommandResult {
    const battle = this.battle?.dispatch(cmd);
    if (battle) return battle;
    switch (cmd.type) {
      case 'compressTime':
        return this.#compress(cmd);
      case 'stopTime':
        stopTimeCompression(this.#clock, CompressionStop.REQUESTED);
        return { ok: true };
      case 'mapScreen':
        return openMapScreen(this);
      case 'tacticalScreen':
        return openTacticalScreen(this);
      default:
        return (
          dispatchSectorCommand(this, cmd) ??
          dispatchStrategicCommand(this, cmd) ??
          (this.tactical ? this.tactical.dispatch(cmd) : { ok: false, reason: `unknown command ${cmd.type}` })
        );
    }
  }

  #compress(cmd: CampaignCommand): CommandResult {
    if (this.state.flow !== 'strategic') return { ok: false, reason: 'time compression works on the strategic map only' };
    const mode = cmd.mode;
    if (mode !== undefined && (typeof mode !== 'number' || mode < CompressMode.MIN5 || mode > CompressMode.MIN60))
      return { ok: false, reason: 'mode must be 2 (5 min/s), 3 (30 min/s) or 4 (60 min/s)' };
    if (typeof mode === 'number') {
      const refused = setGameTimeCompressionLevel(this.#clock, mode);
      if (refused) return { ok: false, reason: refused };
      if (this.state.flow !== 'strategic') return { ok: true };
    }
    const refused = startTimeCompression(this.#clock);
    if (refused) return { ok: false, reason: refused };
    this.#updatePausedStatesDueToTimeCompression();
    return { ok: true };
  }
}
