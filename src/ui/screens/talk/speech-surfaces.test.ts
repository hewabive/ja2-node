import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { civQuoteLifetime, FINAL_TALKING_DELAY_MS, SpeechSurface, textDelay } from '../../speech.ts';
import { civQuotePosition } from './speech-surfaces.ts';
import { type SpeechPlacement, SpeechScreen, TalkingUi } from './talking-ui.ts';

const COLS = 160;
const VILLAGER_TILE = 75 * COLS + 88;
const NEAR_VILLAGER = VILLAGER_TILE + 2;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

describe('civilian quote placement', () => {
  it('centres the box on the soldier and clamps it to the screen and the viewport', () => {
    const bounds = { screenWidth: 640, viewportTop: 20, viewportBottom: 360 };
    expect(civQuotePosition({ x: 300, y: 200 }, 100, 40, bounds)).toEqual({ x: 250, y: 180 });
    expect(civQuotePosition({ x: 10, y: 0 }, 100, 40, bounds)).toEqual({ x: 0, y: 20 });
    expect(civQuotePosition({ x: 630, y: 400 }, 100, 40, bounds)).toEqual({ x: 540, y: 320 });
  });
});

describe('speech surfaces in a stub campaign', () => {
  it('shows a merc bark in the subtitle box at 110, 20 until the line ends', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const [first = 0, second = 0] = a10.mercs;
    const bark = await f.client.command({ type: 'talk', soldier: first, target: second });
    expect(bark.ok, bark.reason).toBe(true);
    a10.session.advance({ ticks: 1 });
    f.deliver();
    const line = f.screen.dialogue.presenter.current;
    expect(line?.line.surface).toBe('tactical');
    const box = f.widget('speechTextBox');
    expect(box.rect).toMatchObject({ x: 110, y: 20 });
    expect(box.text?.startsWith('"')).toBe(true);
    expect(f.find('speechFacePopup')).toBeUndefined();
    f.t.frame(textDelay(line?.line.chars ?? 0) + FINAL_TALKING_DELAY_MS + 1);
    f.t.frame();
    expect(f.find('speechTextBox')).toBeUndefined();
  });

  it('shows a civilian quote over the villager and closes it on a click after 300 ms', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const second = a10.mercs[1] ?? 0;
    expect((await f.client.command({ type: 'move', soldier: second, to: NEAR_VILLAGER, mode: 'walk' })).ok).toBe(true);
    a10.session.advance({ idle: true });
    f.deliver();
    const villager = f.client.view.soldiers.find((s) => s.talkable === 'civilian');
    if (!villager) throw new Error('no civilian in sight');
    const bark = await f.client.command({ type: 'talk', soldier: second, target: villager.id });
    expect(bark.ok, bark.reason).toBe(true);
    if ((bark.data as { walking?: boolean }).walking) a10.session.advance({ idle: true });
    f.deliver();
    const civ = f.screen.dialogue.presenter.civQuote;
    expect(civ?.soldier).toBe(villager.id);
    expect(f.widget('civQuoteBox').text).toBe(`"${civ?.text}"`);
    await f.click('civQuoteBox');
    expect(f.find('civQuoteBox')).toBeDefined();
    f.t.frame(400);
    await f.click('civQuoteBox');
    expect(f.find('civQuoteBox')).toBeUndefined();
    expect(civQuoteLifetime(civ?.chars ?? 0)).toBeGreaterThan(500);
  });

  it('routes a Skyrider line to the external surface with the subtitle box', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.frames([
      {
        tick: f.client.view.tick,
        changed: [],
        removed: [],
        events: [
          {
            type: 'skyriderQuote',
            tick: f.client.view.tick,
            quote: 3,
            profile: 97,
            textKey: { file: 'npcdata/097.edt', row: 3, width: 240 },
            chars: 12,
            text: 'Hop in, mate',
          } as never,
        ],
      },
    ]);
    expect(f.screen.dialogue.presenter.current?.line).toMatchObject({ surface: 'external', profile: 97, soldier: null });
    expect(f.widget('speechTextBox').text).toBe('"Hop in, mate"');
    f.t.frame(textDelay(12) + FINAL_TALKING_DELAY_MS + 1);
    f.t.frame();
    expect(f.find('speechTextBox')).toBeUndefined();
  });

  it('gives a line carried over from the map screen the popup at 10, 20 with speech off, its box staying where the map put it', async () => {
    const f = await tacticalUiTest(kit, ui);
    const presenter = f.screen.dialogue.presenter;
    const mapBox = { x: 417, y: 117, width: 240 };
    const map: SpeechPlacement = {
      screen: SpeechScreen.MAP,
      textBox: () => mapBox,
      facePopup: () => null,
      carriedPopup: () => null,
    };
    const skyrider = { surface: SpeechSurface.EXTERNAL, profile: 97, soldier: null, text: 'Hop in, mate', chars: 12, voice: null };
    presenter.enqueue({ ...skyrider, sector: null, keyWait: false });
    TalkingUi.of(presenter).follow(presenter.current, map, false);
    expect(f.find('speechFacePopup')).toBeUndefined();
    f.t.frame();
    expect(f.widget('speechFacePopup').rect).toMatchObject({ x: 10, y: 20, width: 99, height: 98 });
    expect(f.widget('speechTextBox').rect).toMatchObject({ x: mapBox.x, y: mapBox.y });
  });

  it('takes no line from a frame the map screen took first, as both screens hear every frame', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tick = f.client.view.tick;
    const textKey = { file: 'npcdata/097.edt', row: 3, width: 240 };
    const quote = { type: 'skyriderQuote', tick, quote: 3, profile: 97, textKey, chars: 12, text: 'Hop in, mate' } as never;
    const frame = { tick, changed: [], removed: [], events: [quote] };
    expect(f.screen.dialogue.presenter.takesFrame(frame)).toBe(true);
    f.frames([frame]);
    expect(f.screen.dialogue.presenter.current).toBeNull();
    f.frames([{ ...frame }]);
    expect(f.screen.dialogue.presenter.current?.line).toMatchObject({ surface: 'external', profile: 97 });
  });
});
