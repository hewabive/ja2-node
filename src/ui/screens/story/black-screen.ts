import { type DrawList, rgb } from '../../draw-list.ts';
import type { Modal, Screen } from '../../screen.ts';
import type { ScreenGeometry } from '../../services.ts';

export const STORY_BLACK_SCREEN = 'storyBlack';
const BLACK = rgb(0, 0, 0);

export class StoryBlackScreen implements Screen {
  readonly id: string = STORY_BLACK_SCREEN;
  readonly hidesCursor = true;
  readonly #geometry: () => ScreenGeometry;

  constructor(geometry: () => ScreenGeometry) {
    this.#geometry = geometry;
  }

  enter(): void {}

  exit(): void {}

  update(): void {}

  input(): boolean {
    return true;
  }

  render(list: DrawList): void {
    const { width, height } = this.#geometry();
    list.fill(0, 0, width, height, BLACK);
  }
}

export const STORY_BLACK_HOLD = 'storyBlackHold';

export class StoryBlackHold extends StoryBlackScreen implements Modal {
  override readonly id = STORY_BLACK_HOLD;
}
