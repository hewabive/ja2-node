import type { Labels } from '../text/labels.ts';

const LOST_CONNECTION_MESSAGES = [
  /^Failed to fetch$/,
  /^NetworkError when attempting to fetch resource\.?$/,
  /^Load failed$/,
  /^fetch failed$/,
];

export function lostConnection(err: unknown): err is TypeError {
  return err instanceof TypeError && LOST_CONNECTION_MESSAGES.some((message) => message.test(err.message));
}

export function failureText(labels: Labels, err: unknown): string {
  if (lostConnection(err)) return labels.format('connectionLost', err.message);
  return err instanceof Error ? err.message : String(err);
}
