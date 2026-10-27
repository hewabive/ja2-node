export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export type StepObserver = () => void;

export const UNOBSERVED_STEPS: StepObserver = () => {};
