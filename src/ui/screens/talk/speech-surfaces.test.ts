import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { idiv } from '../../../core/int.ts';
import { civQuoteLifetime, FINAL_TALKING_DELAY_MS, SpeechSurface, textDelay } from '../../speech.ts';
import { civQuotePosition } from './speech-surfaces.ts';
import { type SpeechPlacement, SpeechScreen, TalkingUi } from './talking-ui.ts';

const COLS = 160;
const VILLAGER_TILE = 75 * COLS + 88;
const NEAR_VILLAGER = VILLAGER_TILE + 2;
const MINER_SOLDIER = 40;
const MINER_KEY = { file: 'npcdata/106.edt', row: 3, width: 240 };
const SPEECH_ON = { speech: true, subtitles: true, keyAdvance: false };
const BAR_HEIGHT = 42;
const POPUP_LIFE_BAR_X = 10 + 69 + 1;
const POPUP_BARS_BOTTOM = 20 + 47;

function lifeBarTop(f: TacticalUiTest): number | null {
  const bar = f.draw().items.find((item) => item.kind === 'line' && item.x1 === POPUP_LIFE_BAR_X && item.y1 === POPUP_BARS_BOTTOM);
  return bar?.kind === 'line' ? bar.y2 : null;
}

function panels(f: TacticalUiTest): Set<string> {
  return new Set(
    f.draw().items.flatMap((item) => (item.kind === 'image' && item.asset.includes('communicationpopup') ? [item.asset] : [])),
  );
}

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

  it("gives Skyrider or a head miner with a soldier the soldier's panel, the panel without a soldier otherwise (RenderFaceOverlay)", async () => {
    const f = await tacticalUiTest(kit, ui);
    const presenter = f.screen.dialogue.presenter;
    const map: SpeechPlacement = { screen: SpeechScreen.MAP, textBox: () => null, facePopup: () => null, carriedPopup: () => null };
    const panels = () =>
      new Set(f.draw().items.flatMap((item) => (item.kind === 'image' && item.asset.includes('communicationpopup') ? [item.asset] : [])));
    const miner = { surface: SpeechSurface.EXTERNAL, profile: 106, soldier: null, text: 'Out of ore', chars: 10, voice: null };
    const carried = (externalSoldier?: number) => {
      presenter.skip(f.t.now, true);
      f.t.frame(FINAL_TALKING_DELAY_MS + 1);
      presenter.enqueue({ ...miner, sector: null, keyWait: false, ...(externalSoldier === undefined ? {} : { externalSoldier }) });
      TalkingUi.of(presenter).follow(presenter.current, map, false);
      f.t.frame();
      return panels();
    };
    expect(carried(MINER_SOLDIER)).toEqual(new Set(['interface/communicationpopup.sti']));
    expect(carried()).toEqual(new Set(['interface/communicationpopup_2.sti']));
  });

  it("draws the bars a line carries for Skyrider's or a head miner's soldier in his popup (RenderFaceOverlay, DrawSoldierUIBars)", async () => {
    const f = await tacticalUiTest(kit, ui);
    f.speechSettings = SPEECH_ON;
    const tick = f.client.view.tick;
    const miner = { type: 'headMinerQuote', tick, mine: 1, profile: 106, quote: 3, textKey: MINER_KEY, chars: 10, text: 'Out of ore' };
    const bars = { life: 61, lifeMax: 75, bleeding: 4, breath: 50, breathMax: 90, morale: 33 };
    f.frames([{ tick, changed: [], removed: [], events: [{ ...miner, soldier: MINER_SOLDIER, bars } as never] }]);
    expect(f.widget('speechFacePopup').rect).toMatchObject({ x: 10, y: 20 });
    expect(lifeBarTop(f)).toBe(POPUP_BARS_BOTTOM - idiv(BAR_HEIGHT * bars.life, 100));
    f.screen.dialogue.presenter.skip(f.t.now, true);
    f.t.frame(FINAL_TALKING_DELAY_MS + 1);
    f.frames([{ tick, changed: [], removed: [], events: [{ ...miner, soldier: MINER_SOLDIER } as never] }]);
    expect(f.widget('speechFacePopup').rect).toMatchObject({ x: 10, y: 20 });
    expect(lifeBarTop(f)).toBeNull();
  });

  it("draws the bars of a merc of ours off the loaded map from his strategic entry, in the soldier's panel (FindSoldierByProfileID)", async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    f.speechSettings = SPEECH_ON;
    const away = a10.mercs[0] ?? 0;
    const soldier = a10.campaign.campaign.tactical?.state.soldiers[away];
    if (!soldier) throw new Error('no soldier');
    soldier.placed = false;
    f.deliver();
    const merc = f.client.view.strategic?.mercs.find((m) => m.id === away);
    if (!merc) throw new Error('no strategic merc');
    const tick = f.client.view.tick;
    const textKey = { file: `mercedt/${String(merc.profile).padStart(3, '0')}.edt`, row: 17, width: 240 };
    const line = {
      type: 'mercQuote',
      tick,
      soldier: away,
      profile: merc.profile,
      quote: 'quote17',
      id: 17,
      textKey,
      chars: 3,
      text: 'Hm.',
    };
    f.frames([{ tick, changed: [], removed: [], events: [{ ...line, sector: 'B9' } as never] }]);
    expect(f.client.view.soldiers.some((s) => s.id === away)).toBe(false);
    expect(panels(f)).toEqual(new Set(['interface/communicationpopup.sti']));
    expect(lifeBarTop(f)).toBe(POPUP_BARS_BOTTOM - idiv(BAR_HEIGHT * merc.life, 100));
  });

  it("gives an NPC's line outside a conversation neither the popup nor the subtitle box with speech on (CreateTalkingUI, HandleTacticalNPCTextUI)", async () => {
    const f = await tacticalUiTest(kit, ui);
    f.speechSettings = SPEECH_ON;
    const tick = f.client.view.tick;
    const textKey = { file: 'npcdata/060.edt', row: 3, width: 240 };
    const npc = { type: 'npcQuote', tick, profile: 60, soldier: null, quote: 3, textKey, chars: 12, text: 'Hello there.' };
    f.frames([{ tick, changed: [], removed: [], events: [npc as never] }]);
    expect(f.screen.dialogue.presenter.current?.line).toMatchObject({ surface: 'tactical', npcUi: true, text: 'Hello there.' });
    expect(f.find('speechFacePopup')).toBeUndefined();
    expect(f.find('speechTextBox')).toBeUndefined();
    f.screen.dialogue.presenter.skip(f.t.now, true);
    f.t.frame(FINAL_TALKING_DELAY_MS + 1);
    const skyrider = { type: 'skyriderQuote', tick, quote: 3, profile: 97, textKey: MINER_KEY, chars: 12, text: 'Hop in, mate' };
    f.frames([{ tick, changed: [], removed: [], events: [skyrider as never] }]);
    expect(f.widget('speechFacePopup').rect).toMatchObject({ x: 10, y: 20 });
    expect(f.widget('speechTextBox').text).toBe('"Hop in, mate"');
  });

  it('takes the face popup and the subtitle box of a line down at once as the simulation deletes the face talking (DeleteFace)', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    f.speechSettings = SPEECH_ON;
    const speaker = a10.mercs[0] ?? 0;
    const merc = f.client.view.strategic?.mercs.find((m) => m.id === speaker);
    if (!merc) throw new Error('no strategic merc');
    const tick = f.client.view.tick;
    const textKey = { file: `mercedt/${String(merc.profile).padStart(3, '0')}.edt`, row: 17, width: 240 };
    const line = {
      type: 'mercQuote',
      tick,
      soldier: speaker,
      profile: merc.profile,
      quote: 'quote17',
      id: 17,
      textKey,
      chars: 3,
      text: 'Hm.',
    };
    f.frames([{ tick, changed: [], removed: [], events: [line as never] }]);
    expect(f.find('speechTextBox')).toBeDefined();
    const deleted = { type: 'soldierFaceDeleted', tick: tick + 1, profile: merc.profile ?? -1, saidAt: tick } as const;
    f.frames([{ tick: tick + 1, changed: [], removed: [], events: [deleted] }]);
    f.t.frame();
    expect([f.find('speechTextBox'), f.find('speechFacePopup'), f.screen.dialogue.presenter.current]).toEqual([undefined, undefined, null]);
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
