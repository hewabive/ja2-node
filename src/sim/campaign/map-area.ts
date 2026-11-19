// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc MapViewRegionPrimaryCallback, MapViewRegionSecondaryCallback (the map area ignores
// @src its left and right clicks while fDisableMapInterfaceDueToBattle is set: the plotting, the move box and the militia
// @src panel it opens, the bullseye move and the battle sector's panel), HandleMapUI; the plot's confirming and cancelling
// @src clicks (2026-11-19).

import type { CommandRefused } from '../command.ts';
import type { StrategicState } from '../strategic/state.ts';
import { refuse } from '../tactical/refusal.ts';

const MAP_AREA_COMMANDS: ReadonlySet<string> = new Set([
  'route',
  'shortenRoute',
  'regroupForMove',
  'routeGroup',
  'heliRoute',
  'shortenHeliRoute',
  'setLandingZone',
  'showBattle',
  'moveMilitia',
  'distributeMilitia',
  'redistributeMilitia',
]);

const BATTLE_PENDING_TEXT = 'battlePending: a battle is about to begin and the map ignores clicks on it until the pre-battle prompt opens';

export function mapInterfaceDisabledDueToBattle(state: StrategicState): boolean {
  return state.movement.disableMapInterfaceDueToBattle;
}

const MAP_AREA_PLOT_ENDS: ReadonlySet<unknown> = new Set(['confirm', 'cancel']);

function clicksOnTheMap(cmd: { readonly type: string; readonly outcome?: unknown }): boolean {
  return MAP_AREA_COMMANDS.has(cmd.type) || (cmd.type === 'endPlot' && MAP_AREA_PLOT_ENDS.has(cmd.outcome));
}

export function mapAreaRefusal(state: StrategicState, cmd: { readonly type: string; readonly outcome?: unknown }): CommandRefused | null {
  if (!mapInterfaceDisabledDueToBattle(state) || !clicksOnTheMap(cmd)) return null;
  return refuse('battlePending', BATTLE_PENDING_TEXT);
}
