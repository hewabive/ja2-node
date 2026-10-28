// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc UpdateTEAMPanel (End turn on our turn in combat, Map unless engaged in a
// @src conversation, everything off while the item pointer or the pickup menu disables the panel buttons), RenderTEAMPanel
// @src (the fast help of the hands: GetHelpTextForItem, DRIVER_POPUPTEXT, EXIT_VEHICLE_POPUPTEXT), MercFacePanelCallback*
// @src (left: locate or select, right: the SM panel unless dead, an EPC or in a vehicle), EnemyIndicatorClickCallback,
// @src TMClickFirstHandInvCallbackSecondary and TMClickSecondHandInvCallbackSecondary (swap hands, not the robot).

import type { ControllerContract, LayoutController } from '../../layout/controller.ts';
import { getPath } from '../../layout/controller.ts';
import type { ApColour } from './soldiers.ts';

export const TEAM_PANEL_SCREEN = 'tacticalTeam';

export const TEAM_PANEL_CONTRACT: ControllerContract = {
  id: TEAM_PANEL_SCREEN,
  actions: {
    selectFace: { args: 1 },
    openSmPanel: { args: 1 },
    faceHover: { args: 2 },
    enemyIndicator: { args: 1 },
    swapHands: { args: 1 },
    endTurn: {},
    mapScreen: {},
    toggleSquadList: {},
  },
  bindings: {
    slots: 'list',
    endTurnEnabled: 'boolean',
    mapScreenEnabled: 'boolean',
    squadEnabled: 'boolean',
    panelRegionsEnabled: 'boolean',
  },
};

export interface TeamSlotModel {
  readonly soldier: number | null;
  readonly occupied: boolean;
  readonly name: string;
  readonly stealth: boolean;
  readonly ap: string;
  readonly showAp: boolean;
  readonly apColor: ApColour;
  readonly statsHelp: string;
  readonly firstHandHelp: string;
  readonly secondHandHelp: string;
}

export interface TeamPanelModel {
  slots: TeamSlotModel[];
  endTurnEnabled: boolean;
  mapScreenEnabled: boolean;
  squadEnabled: boolean;
  panelRegionsEnabled: boolean;
}

export interface TeamPanelActions {
  selectFace(slot: number): void;
  openSmPanel(slot: number): void;
  faceHover(slot: number, on: boolean): void;
  enemyIndicator(slot: number): void;
  swapHands(slot: number): void;
  endTurn(): void;
  mapScreen(): void;
  toggleSquadList(): void;
}

export class TeamPanelController implements LayoutController {
  readonly contract = TEAM_PANEL_CONTRACT;
  model: TeamPanelModel = { slots: [], endTurnEnabled: false, mapScreenEnabled: false, squadEnabled: false, panelRegionsEnabled: false };
  readonly #actions: TeamPanelActions;

  constructor(actions: TeamPanelActions) {
    this.#actions = actions;
  }

  get(path: string): unknown {
    return getPath(this.model, path);
  }

  invoke(action: string, args: readonly number[]): void {
    const [slot = 0, extra = 0] = args;
    switch (action) {
      case 'selectFace':
        this.#actions.selectFace(slot);
        return;
      case 'openSmPanel':
        this.#actions.openSmPanel(slot);
        return;
      case 'faceHover':
        this.#actions.faceHover(slot, extra === 1);
        return;
      case 'enemyIndicator':
        this.#actions.enemyIndicator(slot);
        return;
      case 'swapHands':
        this.#actions.swapHands(slot);
        return;
      case 'endTurn':
        this.#actions.endTurn();
        return;
      case 'mapScreen':
        this.#actions.mapScreen();
        return;
      case 'toggleSquadList':
        this.#actions.toggleSquadList();
        return;
    }
  }
}
