// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Turn_Based_Input.cc PopupAssignmentMenuInTactical; src/game/Strategic/Assignments.cc
// @src SetTacticalPopUpAssignmentBoxXY (30 pixels right of the merc's screen rectangle, 90 back near the screen's right
// @src edge), CreateDestroyScreenMaskForAssignmentAndContractMenus (the mask's normal cursor outside the map screen),
// @src SetAssignmentForList (no list outside the map screen).

import type { AssignmentOptions } from '../../../protocol/hints.ts';
import type { SoldierView, StrategicView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { popupBoxStyle } from '../../layout/styles.ts';
import { fontHeight } from '../../text/bitmap-font.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { AssignmentMenus } from '../map/assignment-menus.ts';
import { MenuMask } from '../map/map-menu.ts';
import { type TacticalEnvironment, TacticalLayout } from './environment.ts';

const OWNER = 'tacticalAssignmentMenu';
const NORMAL_CURSOR = 0;
const BOX_RIGHT_OF_MERC = 30;
const RIGHT_EDGE_MARGIN = 50;
const BOX_BACK_NEAR_EDGE = 90;
const MAP_SCREEN_FONT = 'MAP_SCREEN_FONT';

export interface AssignmentPopupHost {
  readonly env: TacticalEnvironment;
  readonly strategic: () => StrategicView | undefined;
  readonly viewportBottom: () => number;
  readonly feedback: (text: string) => void;
  readonly log: (text: string) => void;
  readonly townOf: (sector: string) => number;
}

export class AssignmentPopup {
  readonly #host: AssignmentPopupHost;
  readonly #menus: AssignmentMenus;
  readonly #mask: MenuMask;
  #start = { x: 0, y: 0 };

  constructor(host: AssignmentPopupHost) {
    this.#host = host;
    const { env } = host;
    const model = env.layout(TacticalLayout.INPUT);
    const style = (name: string) => popupBoxStyle(model, model.style(name) as Readonly<Record<string, unknown>>, env.runtime.fonts);
    this.#mask = new MenuMask(env.runtime.regions, OWNER, () => this.close(), NORMAL_CURSOR);
    this.#menus = new AssignmentMenus({
      regions: env.runtime.regions,
      text: env.text,
      owner: OWNER,
      style: (name) => style(name === 'squad' ? 'squadPopup' : 'assignmentPopup'),
      origin: () => ({ x: 0, y: 0 }),
      strategic: host.strategic,
      others: () => [],
      resetSelected: () => undefined,
      send: (cmd) => env.client.command(cmd),
      options: (soldier) => this.#options(soldier),
      box: (text) => void env.boxes.alert(text),
      refused: () => undefined,
      feedback: host.feedback,
      note: host.log,
      townOf: host.townOf,
      fontHeight: () => fontHeight(env.runtime.fonts.get(model.font(MAP_SCREEN_FONT))),
      closed: () => this.#mask.sync(false, false),
      pointer: env.runtime,
      placement: {
        start: () => this.#start,
        screenWidth: () => env.runtime.geometry().width,
        viewportBottom: host.viewportBottom,
      },
    });
  }

  get open(): boolean {
    return this.#menus.open;
  }

  get soldier(): number {
    return this.#menus.soldier;
  }

  openFor(s: SoldierView): boolean {
    const start = this.#startOf(s);
    if (!start || !this.#host.strategic()) return false;
    this.#start = start;
    this.#mask.sync(true, true);
    void this.#menus.show(s.id, 0).then(() => this.#mask.sync(this.#menus.open, false));
    return true;
  }

  #startOf(s: SoldierView): { x: number; y: number } | null {
    const { world, runtime } = this.#host.env;
    const box = world.soldierBox(s.id);
    if (!box) return null;
    const { width, height } = runtime.geometry();
    let x = Math.max(box.x, 0) + BOX_RIGHT_OF_MERC;
    if (x > width - RIGHT_EDGE_MARGIN) x -= BOX_BACK_NEAR_EDGE;
    return { x, y: Math.min(Math.max(box.y, 0), height) };
  }

  async #options(soldier: number): Promise<AssignmentOptions | null> {
    const answer = await this.#host.env.client.hintNow({ type: 'assignmentOptions', soldier });
    return answer.ok ? (answer.data as AssignmentOptions) : null;
  }

  close(): void {
    this.#menus.close(false);
    this.#mask.sync(false, false);
  }

  render(list: DrawList): void {
    this.#menus.render(list);
  }

  describe(): WidgetInfo[] {
    return this.#menus.describe();
  }
}
