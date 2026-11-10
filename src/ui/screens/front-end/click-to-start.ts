import { FontColor } from '../../../content/text/font-colors.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import type { Screen } from '../../screen.ts';
import { FontName } from '../../text/fonts.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { FrontEndEnvironment } from './environment.ts';

export const CLICK_TO_START = 'clickToStart';
const BLACK = rgb(0, 0, 0);

export class ClickToStartScreen implements Screen {
  readonly id = CLICK_TO_START;
  readonly #env: FrontEndEnvironment;

  constructor(env: FrontEndEnvironment) {
    this.#env = env;
  }

  enter(): void {}

  exit(): void {}

  update(): void {}

  input(): boolean {
    return true;
  }

  render(list: DrawList): void {
    const { width, height } = this.#env.runtime.geometry();
    list.fill(0, 0, width, height, BLACK);
    const font = this.#env.runtime.fonts.get(FontName.FONT14ARIAL);
    const text = this.#env.labels().text('clickToStart');
    const at = hCenterVCenterAlign(0, 0, width, height, text, font);
    mprint(list, font, at.x, at.y, text, fontColors(FontColor.MCOLOR_WHITE));
  }
}
