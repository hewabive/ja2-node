import type { MercProfile } from '../../../content/formats/prof.ts';
import type { LaptopContent } from '../../../content/strategic/laptop-content.ts';
import type { Sector } from '../../../content/strategic/sector-ids.ts';
import type { RollSource } from '../../strategic/forces/ports.ts';
import type { StrategicState } from '../../strategic/state.ts';
import type { ClockContext } from '../../strategic/time/world-clock.ts';
import type { TacticalContent } from '../../tactical/content.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { FinanceRecord } from '../finances.ts';
import type { Roster, RosterMerc } from '../roster.ts';
import type { LaptopEventWithoutTick } from './events.ts';
import type { Email, LaptopState } from './laptop-state.ts';
import type { MailSpec } from './mail.ts';

export interface LaptopRandom {
  readonly main: RollSource;
  readonly pre: RollSource;
}

export interface MailOptions {
  readonly firstData?: number;
  readonly secondData?: number;
  readonly read?: boolean;
}

export interface LaptopContext {
  readonly state: StrategicState;
  readonly laptop: LaptopState;
  readonly content: LaptopContent;
  readonly tactical: TacticalContent;
  readonly roster: Roster;
  readonly rng: LaptopRandom;
  readonly clockContext: ClockContext;
  now(): number;
  day(): number;
  profile(id: number): ProfileProgress | null;
  profileRecord(id: number): MercProfile | null;
  mercType(id: number): number | undefined;
  team(): readonly RosterMerc[];
  emit(e: LaptopEventWithoutTick): void;
  mail(spec: MailSpec, sender: number, options?: MailOptions): Email;
  history(code: number, secondCode: number, sector: Sector | null): void;
  emitMoney(record: FinanceRecord): void;
  startSector(): number;
}
