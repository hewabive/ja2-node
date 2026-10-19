import { beforeEach, describe, expect, it } from 'vitest';
import { type FrontEndTest, frontEndTest, listing } from '../../../../tests/support/front-end.ts';
import { KeyModifier } from '../../input/events.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import { OPTION_TOGGLES } from './options.ts';

let f: FrontEndTest;

async function until(condition: () => boolean, frames = 80): Promise<void> {
  for (let i = 0; i < frames && !condition(); i++) await f.settle(1);
  expect(condition()).toBe(true);
}

async function answer(id: string, button: 'yes' | 'no' | 'ok'): Promise<void> {
  await until(() => f.find(`${id}.${button}`) !== undefined);
  f.click(`${id}.${button}`);
  await f.settle(2);
}

beforeEach(async () => {
  f = await frontEndTest();
});

describe('the main menu', () => {
  it('grays Load without saves, shows the version and the copyright and plays the main menu music', async () => {
    f.flow.mainMenu();
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
    expect(f.widget('loadGame').enabled).toBe(false);
    expect(f.widget('version').text).toBe('0.7.0 (abcdef0)');
    expect(f.widget('copyright').text).toContain('Sir-tech');
    expect(f.host.modes.at(-1)).toBe('mainMenu');
    expect(f.widget('newGame').rect).toMatchObject({ x: 240, y: 277 });
  });

  it('enables Load with a save, and Alt+click or Alt+C loads the newest save at once', async () => {
    f.client.listings = [listing('old', '2026-10-01T00:00:00Z'), listing('newest', '2026-10-05T00:00:00Z')];
    f.flow.mainMenu();
    await f.settle();
    expect(f.widget('loadGame').enabled).toBe(true);
    f.click('loadGame', KeyModifier.ALT);
    await until(() => f.screen() === 'mapPlaceholder');
    expect(f.client.loads).toEqual([{ session: null, name: 'newest' }]);
    expect(f.client.calls).toContain('connect loaded-1');
  });

  it('opens the screens by their keys on release and ignores a bare Escape', async () => {
    f.flow.mainMenu();
    await f.settle();
    f.key('Escape');
    expect(f.screen()).toBe('mainMenu');
    expect(f.host.quits).toBe(0);
    f.key('o');
    await f.settle();
    expect(f.screen()).toBe('options');
    f.key('Escape');
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
    f.key('s');
    await f.settle();
    expect(f.screen()).toBe('credits');
    f.key('Escape', 'up');
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
    f.key('q', 'up', KeyModifier.CTRL);
    expect(f.host.quits).toBe(1);
  });
});

describe('the game init screen', () => {
  beforeEach(async () => {
    f.flow.mainMenu();
    await f.settle();
    f.click('newGame');
    await f.settle();
  });

  it('starts with the original defaults in four radio groups', () => {
    expect(f.screen()).toBe('gameInit');
    expect([f.widget('difficulty0').state, f.widget('style1').state, f.widget('guns0').state, f.widget('saveMode0').state]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    f.click('difficulty2');
    expect([f.widget('difficulty0').state, f.widget('difficulty2').state]).toEqual([false, true]);
  });

  it('asks for the difficulty, then starts a campaign that opens the laptop with nobody hired', async () => {
    f.click('difficulty1');
    f.click('guns1');
    f.click('start');
    await until(() => f.modal() === 'messageBox');
    expect(f.widget('messageBox').text).toContain('EXPERIENCED');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptopPlaceholder');
    expect(f.client.campaigns).toEqual([
      { options: { difficulty: 2, sciFi: true, gunNut: true, saveMode: 'anywhere', bloodAndGore: true } },
    ]);
    expect(f.host.beginnings).toBe(1);
    expect(f.host.modes).toContain('none');
    expect(f.host.modes.at(-1)).toBe('session');
  });

  it('resets Iron Man to save anywhere when its warning is declined, and Enter goes through the confirmations', async () => {
    f.click('saveMode1');
    f.key('Enter');
    await until(() => f.modal() === 'messageBox');
    await answer('messageBox', 'no');
    expect(f.widget('saveMode0').state).toBe(true);
    expect(f.client.campaigns).toEqual([]);
    f.key('Escape');
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
  });

  it('sends the client default of blood and gore with the campaign', async () => {
    f.settings.change({ bloodAndGore: false });
    f.click('start');
    await answer('messageBox', 'yes');
    await until(() => f.client.campaigns.length === 1);
    expect(f.client.campaigns[0]?.options.bloodAndGore).toBe(false);
  });

  it('names the Dead is Dead save on the save screen before the campaign starts', async () => {
    f.click('saveMode2');
    f.click('start');
    await answer('messageBox', 'yes');
    await answer('messageBox', 'yes');
    await answer('messageBox', 'ok');
    await until(() => f.screen() === 'saveLoad');
    expect(f.widget('saveButton').visible).toBe(true);
    f.click('row0');
    await f.settle();
    f.type('Last stand');
    f.key('Enter', 'up');
    await until(() => f.screen() === 'laptopPlaceholder');
    expect(f.client.campaigns[0]).toMatchObject({
      options: { saveMode: 'deadIsDead' },
      deadIsDead: { name: null, description: 'Last stand' },
    });
  });
});

describe('the options screen', () => {
  it('maps the 23 toggles to the client settings and keeps speech or subtitles on', async () => {
    expect(OPTION_TOGGLES).toHaveLength(23);
    await f.flow.options('mainMenu');
    await f.settle();
    expect(f.widget('saveGame').enabled).toBe(false);
    expect(f.widget('toggle17').state).toBe(true);
    f.click('toggle17');
    expect(f.settings.current().display.treeTops).toBe(false);
    f.click('toggleLabel12');
    expect(f.settings.current().display.useMetricSystem).toBe(false);
    expect(f.t.sounds.names()).toEqual(expect.arrayContaining(['BIG_SWITCH3_IN', 'BIG_SWITCH3_OUT']));
    f.click('toggle0');
    expect(f.settings.current().speech).toBe(false);
    f.click('toggle2');
    await until(() => f.modal() === 'messageBox');
    expect(f.settings.current().subtitles).toBe(true);
    await answer('messageBox', 'ok');
    f.click('done');
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
    expect(f.settings.persisted?.display.treeTops).toBe(false);
  });

  it('plays the test sample 75 ms after the effects slider stops and applies the music volume at once', async () => {
    await f.flow.options('mainMenu');
    await f.settle();
    const slider = f.widget('effectsVolume').rect;
    f.t.move(slider.x + 5, slider.y);
    f.t.frame();
    f.t.down(slider.x + 5, slider.y);
    f.t.frame();
    f.t.up(slider.x + 5, slider.y);
    expect(f.settings.current().volumes.effects).toBe(127);
    for (let i = 0; i < 8; i++) f.t.frame();
    expect(f.t.sounds.played).toContainEqual({ file: 'sounds/weapons/lmg reload.wav', volume: 127 });
  });

  it('in a game enables Save by the session, pauses the game and returns to the main menu through the closing of the session', async () => {
    await f.client.newCampaign({ options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } });
    await f.flow.options('game');
    await f.settle();
    expect(f.widget('saveGame').enabled).toBe(true);
    expect(f.pauses).toEqual([true]);
    f.click('toggle5');
    expect(f.client.bloodAndGore).toEqual([false]);
    expect(f.settings.current().bloodAndGore).toBe(true);
    f.click('mainMenu');
    await until(() => f.modal() === 'messageBox');
    await answer('messageBox', 'yes');
    await f.settle();
    expect(f.client.calls).toContain('closeSession');
    expect(f.screen()).toBe('mainMenu');
    expect(f.pauses).toEqual([true, true, false, false]);
  });
});

describe('the save/load screen', () => {
  beforeEach(() => {
    f.client.listings = [
      listing('quick', '2026-10-09T00:00:00Z', { kind: 'quick' }),
      listing('older', '2026-10-01T00:00:00Z', {
        options: { difficulty: 3, sciFi: false, gunNut: true, saveMode: 'deadIsDead', bloodAndGore: true },
      }),
      listing('newer', '2026-10-05T00:00:00Z'),
    ];
  });

  it('lists every save newest first in load mode with the option tooltip, and loads from the main menu into a new session', async () => {
    await f.flow.saveLoad('load', 'mainMenu');
    await f.settle();
    expect([f.widget('description0').text, f.widget('description1').text, f.widget('description2').text]).toEqual([
      'quick',
      'newer',
      'older',
    ]);
    expect(f.widget('mark2').visible).toBe(true);
    expect(f.widget('row2').text).toContain('Expert');
    expect(f.widget('date1').text).toBe('Day 2, 09:05');
    f.click('row1');
    f.click('loadButton');
    await until(() => f.screen() === 'mapPlaceholder');
    expect(f.client.loads).toEqual([{ session: null, name: 'newer' }]);
  });

  it('hides quick and auto saves when saving, offers a new row first and saves over a row after asking', async () => {
    await f.client.newCampaign({ options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } });
    await f.flow.saveLoad('save', 'game');
    await f.settle();
    expect(f.widget('newSave0').visible).toBe(true);
    expect([f.widget('description1').text, f.widget('description2').text]).toEqual(['newer', 'older']);
    expect(f.find('description3')?.visible).toBe(false);
    f.click('row1');
    f.click('saveButton');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptopPlaceholder');
    expect(f.client.saved).toEqual([{ session: 'session-1', request: { name: 'newer', description: 'newer' } }]);
  });

  it('types a description for a new save and saves it with Enter', async () => {
    await f.client.newCampaign({ options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } });
    await f.flow.saveLoad('save', 'game');
    await f.settle();
    f.key('Enter', 'up');
    expect(f.widget('description.0').state).toBe('editing');
    f.type('Before the bridge');
    f.key('Enter', 'up');
    await until(() => f.client.saved.length === 1);
    expect(f.client.saved[0]?.request).toEqual({ description: 'Before the bridge' });
  });

  it('clears the selection with Escape first, then leaves; Delete asks first', async () => {
    await f.flow.saveLoad('load', 'mainMenu');
    await f.settle();
    f.click('row2');
    f.key('Delete', 'up');
    await answer('messageBox', 'yes');
    expect(f.client.deleted).toEqual(['older']);
    f.click('row0');
    f.key('Escape', 'up');
    expect(f.widget('loadButton').enabled).toBe(false);
    expect(f.screen()).toBe('saveLoad');
    f.key('Escape', 'up');
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
  });

  it('moves the selection with the arrow keys and scrolls a long list with the wheel', async () => {
    f.client.listings = Array.from({ length: 15 }, (_, i) =>
      listing(`save${String(i).padStart(2, '0')}`, `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    );
    await f.flow.saveLoad('load', 'mainMenu');
    await f.settle();
    expect(f.widget('description0').text).toBe('save14');
    f.click('scrollDown');
    expect(f.widget('description0').text).toBe('save13');
    for (let i = 0; i < 12; i++) f.key('ArrowDown');
    expect(f.widget('description10').text).toBe('save02');
  });
});

describe('the credits screen', () => {
  it('blinks every face at once on entry, names the hovered face and ends on Escape', async () => {
    f.flow.credits();
    await f.settle();
    const eyes = f.draw().items.filter((i) => i.kind === 'image' && i.asset === 'interface/credit faces.sti');
    expect(eyes).toHaveLength(15);
    f.click('face3');
    expect(f.widget('name').visible).toBe(true);
    expect(f.widget('name').text).toBe(f.env.text.string('gzCreditNames', 3));
    f.key('Escape', 'up');
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
  });

  it('ends when the rows run out', async () => {
    f.flow.credits();
    for (let i = 0; i < 400 && f.screen() === 'credits'; i++) f.t.frame(50);
    await f.settle();
    expect(f.screen()).toBe('mainMenu');
  });
});

describe('in the game', () => {
  beforeEach(async () => {
    await f.client.newCampaign({ options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } });
    f.flow.enterGame();
    await f.settle();
  });

  it('asks before leaving the game with Alt+X and keeps the session on the server', async () => {
    f.key('x', 'down', KeyModifier.ALT);
    await until(() => f.modal() === 'exitBoxLaptop');
    expect(f.pauses).toEqual([true]);
    await answer('exitBoxLaptop', 'yes');
    expect(f.client.calls).toContain('leaveSession');
    expect(f.client.calls).not.toContain('closeSession');
    expect(f.screen()).toBe('mainMenu');
    expect(f.pauses).toEqual([true, false]);
  });

  it('loads a save in place from the in-game load screen', async () => {
    f.client.listings = [listing('newer', '2026-10-05T00:00:00Z')];
    f.client.nextFlow = 'tactical';
    f.key('l', 'down', KeyModifier.CTRL);
    await until(() => f.screen() === 'saveLoad');
    f.click('loadButton');
    await until(() => f.screen() === 'tacticalPlaceholder');
    expect(f.client.loads).toEqual([{ session: 'session-1', name: 'newer' }]);
    expect(MessageBoxReturn.YES).toBe(2);
  });

  it('shows the San Mona screen on sexScene and returns to the game', async () => {
    f.flow.frames([{ tick: 1, changed: [], removed: [], events: [{ type: 'sexScene', soldier: 1 } as never] }]);
    await f.settle();
    expect(f.screen()).toBe('sanMona');
    expect(f.t.sounds.played).toContainEqual({ file: 'sounds/sex.wav', volume: 127 });
    expect(f.draw().items.some((i) => i.kind === 'image' && i.asset === 'interface/luckysmile.sti')).toBe(true);
    for (let i = 0; i < 300 && f.screen() === 'sanMona'; i++) f.t.frame(16);
    expect(f.screen()).toBe('laptopPlaceholder');
  });
});
