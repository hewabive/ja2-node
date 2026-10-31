export interface RefusalData {
  readonly refusal: string;
  readonly [key: string]: unknown;
}

export interface CommandAccepted {
  readonly ok: true;
  readonly reason?: never;
  readonly data?: unknown;
}

export interface CommandRefused {
  readonly ok: false;
  readonly reason: string;
  readonly data: RefusalData;
}

export type CommandResult = CommandAccepted | CommandRefused;
