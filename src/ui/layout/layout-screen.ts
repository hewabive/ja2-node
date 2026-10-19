import type { DrawList } from '../draw-list.ts';
import type { UiInputEvent } from '../input/events.ts';
import type { Screen } from '../screen.ts';
import type { UiScreenKind } from '../widgets/button-sounds.ts';
import type { WidgetInfo } from '../widgets/widget-info.ts';
import { LayoutView, type LayoutViewOptions } from './view.ts';

export interface LayoutScreenOptions extends LayoutViewOptions {
  readonly id?: string;
  readonly soundScreen?: UiScreenKind;
  readonly onUpdate?: (now: number) => void;
  readonly onRender?: (list: DrawList, view: LayoutView) => void;
}

export class LayoutScreen implements Screen {
  readonly id: string;
  readonly soundScreen: UiScreenKind | undefined;
  readonly rendersTooltips: boolean;
  readonly view: LayoutView;
  readonly #options: LayoutScreenOptions;

  constructor(options: LayoutScreenOptions) {
    this.#options = options;
    this.id = options.id ?? options.model.json.screen;
    this.soundScreen = options.soundScreen;
    this.rendersTooltips = options.model.json.tooltips === true;
    this.view = new LayoutView(options);
  }

  enter(): void {
    this.view.build();
  }

  exit(): void {
    this.view.dispose();
  }

  update(now: number): void {
    this.#options.onUpdate?.(now);
    this.view.update();
  }

  input(event: UiInputEvent): boolean {
    return this.view.input(event);
  }

  render(list: DrawList): void {
    this.view.render(list);
    this.#options.onRender?.(list, this.view);
  }

  describe(): readonly WidgetInfo[] {
    return this.view.describe();
  }
}
