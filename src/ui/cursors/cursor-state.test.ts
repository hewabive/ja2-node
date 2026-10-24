import { beforeAll, describe, expect, it } from 'vitest';
import { stubFontSet } from '../../../tests/support/ui-fonts.ts';
import { cursorTable } from '../../../tests/support/ui-runtime.ts';
import { StaticImageCatalog, uniformImage } from '../assets.ts';
import { DrawList } from '../draw-list.ts';
import { FontName, type FontSet } from '../text/fonts.ts';
import type { ButtonSoundRequest } from '../widgets/button-sounds.ts';
import { CursorId, EXTERN_CURSOR, VIDEO_DEFAULT_TO_NO_CURSOR, VIDEO_NO_CURSOR } from './cursor-ids.ts';
import { CURSOR_ANIMATION_MS, CURSOR_FLASH_MS, CursorState, DELAY_START_MS } from './cursor-state.ts';
import { CursorFlag, type CursorTable } from './cursor-table.ts';

describe('the cursor database', () => {
  let table: CursorTable;
  let fonts: FontSet;

  beforeAll(async () => {
    table = await cursorTable();
    fonts = await stubFontSet();
  });

  function state(sizes: Readonly<Record<string, [number, number, number?]>> = {}, played: ButtonSoundRequest[] = []): CursorState {
    const images = new StaticImageCatalog();
    for (const file of table.files) {
      if (!file.path) continue;
      const [w, h, animated] = sizes[file.path] ?? [16, 16];
      images.set(file.path, uniformImage(12, w, h, animated ?? 0));
    }
    images.set('items/gun.sti', { kind: 'indexed', animatedFrames: 0, frames: [{ width: 30, height: 20, offsetX: 2, offsetY: 1 }] });
    return new CursorState(table, images, { sounds: { play: (request) => played.push(request) } });
  }

  it('transcribes 68 files and every CursorTypeDefines entry, and the named ids agree with it', () => {
    expect(table.files).toHaveLength(68);
    expect(table.cursors).toHaveLength(140);
    for (const [name, id] of Object.entries(CursorId)) expect(table.cursors[id]?.name).toBe(`CURSOR_${name}`);
  });

  it('draws the plain arrow at the hot spot 0,0 and clips the cursor to its size', () => {
    const cursors = state({ 'cursors/cursor.sti': [12, 18] });
    cursors.set(CursorId.NORMAL, 0);
    const composed = cursors.compose(0);
    expect(composed).toMatchObject({
      hotX: 0,
      hotY: 0,
      width: 12,
      height: 18,
      images: [{ asset: 'cursors/cursor.sti', frame: 0, x: 0, y: 0 }],
    });
    const list = new DrawList();
    if (composed) cursors.draw(list, 100, 50, composed, null);
    expect(list.items[0]).toMatchObject({ kind: 'clipPush', x: 100, y: 50, width: 12, height: 18 });
    expect(list.items[1]).toMatchObject({ kind: 'image', x: 100, y: 50 });
  });

  it('centres the hot spot and the centred sub-cursors on the largest composite, hidden ones included', () => {
    const cursors = state({ 'cursors/cur_tr.sti': [40, 30], 'cursors/cur_targ.sti': [20, 10] });
    cursors.set(CursorId.TARGET, 0);
    expect(cursors.compose(0)).toMatchObject({
      hotX: 20,
      hotY: 15,
      width: 40,
      height: 30,
      images: [{ asset: 'cursors/cur_targ.sti', x: 10, y: 10 }],
    });
  });

  it('shows the first or the second conditional composite by the special frame', () => {
    const cursors = state();
    const on1 = cursors.idOf('CURSOR_TARGETON1');
    cursors.set(on1, 0);
    expect(cursors.compose(0)?.images.map((i) => i.asset)).toEqual(['cursors/cur_tagr.sti', 'cursors/cur_tr.sti']);
    cursors.setSpecialFrame(on1, 1);
    expect(cursors.compose(0)?.images.map((i) => i.asset)).toEqual(['cursors/targblak.sti', 'cursors/cur_tr.sti']);
  });

  it('flashes every 250 ms where the region asks for it', () => {
    const cursors = state();
    cursors.set(CursorId.FLASH_TARGET, 0);
    const first = cursors.compose(0)?.images[0]?.asset;
    cursors.tick(CURSOR_FLASH_MS, false, false);
    expect(cursors.compose(0)?.images[0]?.asset).toBe(first);
    cursors.tick(2 * CURSOR_FLASH_MS, false, true);
    expect(cursors.compose(0)?.images[0]?.asset).not.toBe(first);
  });

  it('alternates the red and black crosshair of an aim cursor marked out of range and beeps as it turns black', () => {
    const played: ButtonSoundRequest[] = [];
    const cursors = state({}, played);
    const aim = cursors.idOf('CURSOR_TARGETON1');
    cursors.set(aim, 0);
    const red = cursors.compose(0)?.images[0]?.asset;
    cursors.setFlags(aim, CursorFlag.FLASH | CursorFlag.PLAY_SOUND);
    cursors.tick(CURSOR_FLASH_MS, false, true);
    const black = cursors.compose(0)?.images[0]?.asset;
    expect(black).not.toBe(red);
    expect(played).toEqual([{ sample: 'TARGET_OUT_OF_RANGE', volume: 65 }]);
    cursors.tick(2 * CURSOR_FLASH_MS, false, true);
    expect(cursors.compose(0)?.images[0]?.asset).toBe(red);
    expect(played).toHaveLength(1);
    cursors.tick(3 * CURSOR_FLASH_MS, false, true);
    expect(played).toHaveLength(2);
    cursors.removeFlags(aim, CursorFlag.FLASH | CursorFlag.PLAY_SOUND);
    cursors.setSpecialFrame(aim, 0);
    cursors.tick(4 * CURSOR_FLASH_MS, false, true);
    cursors.tick(5 * CURSOR_FLASH_MS, false, true);
    expect(cursors.compose(0)?.images[0]?.asset).toBe(red);
    expect(played).toHaveLength(2);
  });

  it('animates an AUX_ANIMATED_TILE file every 150 ms and delays a DELAY_START cursor by a second', () => {
    const cursors = state({ 'cursors/cur_wait.sti': [16, 16, 4] });
    cursors.set(CursorId.WAIT, 1000);
    expect(cursors.compose(1000 + DELAY_START_MS - 1)).toBeNull();
    const frames = [1, 2, 3, 4, 5].map((k) => {
      cursors.tick(1000 + k * CURSOR_ANIMATION_MS, true, false);
      return cursors.compose(1000 + DELAY_START_MS + k)?.images.find((i) => i.asset === 'cursors/cur_wait.sti')?.frame;
    });
    expect(frames).toEqual([1, 2, 3, 0, 1]);
    cursors.set(CursorId.WAIT_NODELAY, 5000);
    expect(cursors.compose(5000)).not.toBeNull();
  });

  it('shows the item in hand with index 254 skipped and the hot spot in its middle', () => {
    const cursors = state();
    cursors.setExternCursor('items/gun.sti', 0);
    cursors.set(EXTERN_CURSOR, 0);
    expect(cursors.compose(0)).toMatchObject({
      hotX: 16,
      hotY: 10,
      width: 32,
      height: 21,
      images: [{ asset: 'items/gun.sti', frame: 0, x: 0, y: 0, effect: { kind: 'outline', color: null } }],
    });
    cursors.set(VIDEO_DEFAULT_TO_NO_CURSOR, 0);
    expect(cursors.current).toBe(VIDEO_NO_CURSOR);
    expect(cursors.compose(0)).toBeNull();
  });

  it('outlines the thrown item in green, centred in the cursor', () => {
    const cursors = state({ 'cursors/throwg.sti': [40, 40] });
    cursors.setExternData('items/gun.sti', 0);
    cursors.set(cursors.idOf('CURSOR_ITEM_GOOD_THROW'), 0);
    const item = cursors.compose(0)?.images.find((i) => i.asset === 'items/gun.sti');
    expect(item).toMatchObject({ x: 5 - 2, y: 10 - 1, effect: { kind: 'outline', color: 0x00ff00 } });
  });

  it('prints the hit chance and the AP cost in TINYFONT1, the invalid cost flashing', () => {
    const cursors = state({ 'cursors/cur_tr.sti': [40, 30], 'cursors/cur_targ.sti': [20, 10] });
    const tiny = fonts.get(FontName.TINYFONT1);
    cursors.set(CursorId.TARGET, 0);
    cursors.mouseText = {
      location: 'HEAD',
      hitChance: '42%',
      actionPoints: { value: 7, center: true, offsetX: 0, offsetY: 0, invalid: true },
    };
    const shown = cursors.compose(0, tiny, true);
    expect(shown?.text.map((t) => t.text)).toEqual(['HEAD', '42%', '7']);
    expect((shown?.height ?? 0) > 30).toBe(true);
    const colors = [0, 160, 320, 700].map((now) => cursors.compose(now, tiny, true)?.text.at(-1)?.colors.foreground);
    expect(new Set(colors).size).toBe(2);
    expect(cursors.compose(0, tiny, false)?.text).toEqual([]);
  });
});
