import { playUrl } from '../../ui/client/campaign-form.ts';

export type OpenPage = 'play' | 'strategic' | 'tactical';
export type PlayFlag = readonly [param: string, value: string];

export interface SessionScreens {
  readonly strategic: boolean;
  readonly tactical: boolean;
}

export function reachablePage(page: OpenPage, screens: SessionScreens): OpenPage {
  if (page === 'strategic' && !screens.strategic) return 'tactical';
  if (page === 'tactical' && !screens.tactical) return 'strategic';
  return page;
}

export function gamePageUrl(session: string, flags: readonly PlayFlag[]): string {
  return `${playUrl(session)}${flags.map(([param, value]) => `&${param}=${value}`).join('')}`;
}

export function openPageUrl(page: OpenPage, session: string, flags: readonly PlayFlag[]): string {
  if (page === 'play') return gamePageUrl(session, flags);
  return `/src/devtools/${page}/?session=${encodeURIComponent(session)}`;
}
