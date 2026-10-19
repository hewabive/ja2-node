import { describe, expect, it } from 'vitest';
import { type FrontEndTest, frontEndTest, listing } from '../../../../tests/support/front-end.ts';
import type { DrawItem } from '../../draw-list.ts';
import { LoadingController, loadingScreen } from './loading.ts';
import { SanMonaController, sanMonaScreen } from './san-mona.ts';

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function line(item: DrawItem): string {
  switch (item.kind) {
    case 'image':
      return `image ${item.asset}#${item.frame} ${item.x},${item.y}`;
    case 'glyphs': {
      const first = item.glyphs[0];
      return `glyphs ${item.font} ${first ? `${first.x},${first.y}` : '-'} n=${item.glyphs.length} fg=${item.foreground} sh=${item.shadow} bg=${item.background}`;
    }
    case 'fill':
      return `fill ${item.x},${item.y} ${item.width}x${item.height} ${hex(item.color)}`;
    case 'shadow':
      return `shadow ${item.x},${item.y} ${item.width}x${item.height} ${item.factor}`;
    case 'hatch':
      return `hatch ${item.pattern} ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'line':
    case 'rectangle':
      return `${item.kind} ${item.x1},${item.y1} ${item.x2},${item.y2} ${hex(item.color)}`;
    case 'clipPush':
      return `clip ${item.x},${item.y} ${item.width}x${item.height}`;
    default:
      return item.kind;
  }
}

function snapshot(f: FrontEndTest): string {
  return `${f.draw().items.map(line).join('\n')}\n`;
}

async function settled(build: (f: FrontEndTest) => Promise<void> | void): Promise<FrontEndTest> {
  const f = await frontEndTest();
  await build(f);
  await f.settle();
  return f;
}

describe('the draw lists of the front-end screens', () => {
  it('main menu with saves', async () => {
    const f = await settled((t) => {
      t.client.listings = [listing('a', '2026-10-01T00:00:00Z')];
      t.flow.mainMenu();
    });
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/main-menu.txt');
  });

  it('game init with Dead is Dead and gun nut chosen', async () => {
    const f = await settled((t) => t.flow.gameInit());
    f.click('saveMode2');
    f.click('guns1');
    f.t.move(0, 0);
    f.t.frame();
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/game-init.txt');
  });

  it('options from the main menu with a highlighted label', async () => {
    const f = await settled((t) => t.flow.options('mainMenu'));
    const { rect } = f.widget('toggleLabel3');
    f.t.move(rect.x + 2, rect.y + 2);
    f.t.frame();
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/options.txt');
  });

  it('save/load in load mode with a selection and a Dead is Dead save', async () => {
    const f = await settled(async (t) => {
      t.client.listings = [
        listing('first', '2026-10-01T00:00:00Z', {
          options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'deadIsDead', bloodAndGore: true },
        }),
        listing('second', '2026-10-02T00:00:00Z'),
      ];
      await t.flow.saveLoad('load', 'mainMenu');
    });
    f.t.move(0, 0);
    f.t.frame();
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/save-load.txt');
  });

  it('credits with the eyes closed and a hovered face', async () => {
    const f = await settled((t) => t.flow.credits());
    f.click('face0');
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/credits.txt');
  });

  it('the loading screen of a save load at 40 percent', async () => {
    const f = await frontEndTest();
    const controller = new LoadingController('save');
    controller.progress(2, 5);
    f.t.runtime.host.push(loadingScreen(f.env, controller));
    f.t.frame();
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/loading.txt');
  });

  it('the San Mona screen', async () => {
    const f = await frontEndTest();
    f.t.runtime.host.push(sanMonaScreen(f.env, new SanMonaController(() => undefined)));
    f.t.frame();
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/san-mona.txt');
  });
});
