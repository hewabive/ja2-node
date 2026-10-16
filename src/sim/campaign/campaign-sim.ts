import { TICK_MS } from '../clock.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import {
  createStrategicContext,
  handleGroupAboutToArriveEvent,
  handleGroupArrivalEvent,
  type StrategicContextOptions,
} from '../strategic/forces/context.ts';
import type { StrategicContext } from '../strategic/forces/ports.ts';
import { isSectorDesert } from '../strategic/map/sectors.ts';
import { createStrategicState, type StrategicState } from '../strategic/state.ts';
import { CompressMode, EventKind } from '../strategic/time/constants.ts';
import { EventDispatch } from '../strategic/time/dispatch.ts';
import { changeLightValue, timeOfDayAmbientLightLevel, updateTemperature } from '../strategic/time/environment.ts';
import {
  type ClockContext,
  type ClockScreen,
  isTimeBeingCompressed,
  setGameTimeCompressionLevel,
  startTimeCompression,
  stopTimeCompression,
  updateClock,
} from '../strategic/time/world-clock.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';

export interface CampaignCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type StrategicSetup = Omit<StrategicContextOptions, 'state' | 'clock'>;

export interface CampaignHooks {
  readonly compressionRefusal?: (campaign: CampaignSim) => string | null;
  readonly strategic?: StrategicSetup;
}

export class CampaignSim {
  readonly state: StrategicState;
  readonly dispatchTable = new EventDispatch<CampaignSim>();
  tactical: TacticalSim | null;
  readonly strategic: StrategicContext | null;
  readonly #events: SimEvent[] = [];
  readonly #hooks: CampaignHooks;
  readonly #clock: ClockContext;
  #tick = 0;

  constructor(state: StrategicState = createStrategicState(), tactical: TacticalSim | null = null, hooks: CampaignHooks = {}) {
    this.state = state;
    this.tactical = tactical;
    this.#hooks = hooks;
    if (tactical) state.flow = 'tactical';
    this.#clock = this.#clockContext();
    this.strategic = hooks.strategic ? createStrategicContext({ ...hooks.strategic, state, clock: this.#clock }) : null;
    this.#registerEnvironment();
    this.#registerMovement();
    if (state.flow === 'tactical') setGameTimeCompressionLevel(this.#clock, CompressMode.X1);
    tactical?.attachWorldClock(state.clock);
  }

  get tick(): number {
    return this.#tick;
  }

  #clockContext(): ClockContext {
    const s = this.state;
    return {
      clock: s.clock,
      queue: s.queue,
      screen: (): ClockScreen => s.flow,
      inCombat: () => this.tactical?.state.inCombat === true,
      execute: (e) => this.dispatchTable.execute(this, e),
      afterAdvance: () => {},
      compressionModeSet: () => {},
      firstCompressionSinceMapEntry: () => {},
      compressionRefusal: () => this.#hooks.compressionRefusal?.(this) ?? this.#defaultRefusal(),
    };
  }

  #defaultRefusal(): string | null {
    const t = this.tactical?.state;
    if (t?.inCombat) return 'combat is in progress';
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

  step(): void {
    const s = this.state;
    this.#tick++;
    if (s.flow === 'tactical' && this.tactical) {
      this.#environmentController();
      this.tactical.step();
      s.realMs = this.tactical.state.clockMs;
      this.#events.push(...this.tactical.drainEvents());
    } else s.realMs += TICK_MS;
    updateClock(this.#clock, s.realMs);
  }

  isIdle(): boolean {
    const s = this.state;
    if (s.flow === 'tactical' && this.tactical) return this.tactical.isIdle();
    return !isTimeBeingCompressed(s.clock);
  }

  hasPendingDecision(): boolean {
    return this.state.flow === 'tactical' && this.tactical !== null && this.tactical.hasPendingDecision();
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  dispatch(cmd: CampaignCommand): CommandResult {
    switch (cmd.type) {
      case 'compressTime':
        return this.#compress(cmd);
      case 'stopTime':
        stopTimeCompression(this.#clock);
        return { ok: true };
      default:
        return this.tactical ? this.tactical.dispatch(cmd) : { ok: false, reason: `unknown command ${cmd.type}` };
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
    }
    const refused = startTimeCompression(this.#clock);
    return refused ? { ok: false, reason: refused } : { ok: true };
  }
}
