export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}
