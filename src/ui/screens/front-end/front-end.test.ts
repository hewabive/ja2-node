import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FrontEndTest, frontEndTest, listing } from '../../../../tests/support/front-end.ts';
import { loadMapTestFacts } from '../../../../tests/support/strategic.ts';
import { LoadingScreen } from '../../../content/strategic/loading-screens.ts';
import type { PlayerView, PromptView, ViewFrame } from '../../../protocol/view.ts';
import { LOW_PERCENT_SHADOW_FACTOR } from '../../draw-list.ts';
import { KeyModifier } from '../../input/events.ts';
import { SAVING_BOX } from '../../saves/saving-box.ts';
import type { Screen } from '../../screen.ts';
import { FADE_STEP_MS } from '../../widgets/fade.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import { FrontEndLayout } from './environment.ts';
import { type LaptopFlow, type LoadProgress, type MapPort, RECONNECTING_BOX, SESSION_ENDED_BOX, type TacticalPort } from './flow.ts';
import { LOADINGSCREEN_HELI, loadingPicturePath } from './loading.ts';
import { OPTION_TOGGLES } from './options.ts';
import { SaveLoadController, type SaveLoadMode } from './save-load.ts';
import { SECTOR_ZOOM, SECTOR_ZOOM_TIME } from './sector-zoom.ts';
import { INTRO_SPLASH_DURATION } from './splash.ts';

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

describe('the splash at start', () => {
  const stillPath = 'interface/splash.sti';
  const logoPath = 'interface/sirtechsplash.sti';
  const images = () => f.draw().items.flatMap((item) => (item.kind === 'image' ? [item.asset] : []));
  const shades = () => f.draw().items.filter((item) => item.kind === 'shadow' && item.factor === LOW_PERCENT_SHADOW_FACTOR).length;
  const cursorShown = () => f.t.runtime.cursorReport().visible;

  it('stretches the still over the screen, holds it with no cursor or music, darkens it frame by frame, then starts the menu music and cursor on black before the menu', async () => {
    f.t.move(100, 100);
    let done = false;
    void f.flow.splash('still').then(() => {
      done = true;
    });
    f.t.frame();
    expect(f.screen()).toBe('splash');
    expect(images()).toEqual([stillPath]);
    expect(f.draw().items.find((item) => item.kind === 'snapshot')).toMatchObject({
      sourceArea: { x: 0, y: 0, width: 640, height: 480 },
      x: 0,
      y: 0,
      width: 640,
      height: 480,
    });
    f.t.frame(INTRO_SPLASH_DURATION - 16);
    expect([shades(), cursorShown(), f.host.modes]).toEqual([0, false, []]);
    const darkening: number[] = [];
    for (let frame = 0; frame < 8; frame++) {
      f.t.frame(FADE_STEP_MS);
      darkening.push(shades());
    }
    expect(darkening).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([cursorShown(), f.host.modes]).toEqual([false, []]);
    f.t.frame(FADE_STEP_MS);
    expect([shades(), cursorShown(), f.host.modes, f.draw().items.at(-1)]).toEqual([
      0,
      false,
      [],
      { kind: 'fill', x: 0, y: 0, width: 640, height: 480, color: 0 },
    ]);
    f.t.frame(FADE_STEP_MS);
    expect([cursorShown(), f.host.modes, done]).toEqual([true, ['mainMenu'], false]);
    f.t.frame(FADE_STEP_MS);
    await f.settle(1);
    expect(done).toBe(true);
  });

  it('shows the logo after the splash video in the std640 frame instead of the still', async () => {
    void f.flow.splash('logo');
    f.t.frame();
    expect(images()).toEqual([logoPath]);
    expect(f.draw().items.some((item) => item.kind === 'snapshot')).toBe(false);
  });
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

  it('enables Load with a save, and Alt+click or Alt+C open the load screen', async () => {
    f.client.listings = [listing('old', '2026-10-01T00:00:00Z'), listing('newest', '2026-10-05T00:00:00Z')];
    f.flow.mainMenu();
    await f.settle();
    expect(f.widget('loadGame').enabled).toBe(true);
    f.click('loadGame', KeyModifier.ALT);
    await until(() => f.screen() === 'saveLoad');
    f.key('Escape');
    f.key('Escape');
    await until(() => f.screen() === 'mainMenu');
    f.key('c', 'up', KeyModifier.ALT);
    await until(() => f.screen() === 'saveLoad');
    expect(f.client.loads).toEqual([]);
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
    await until(() => f.screen() === 'laptopUnavailable');
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
    await until(() => f.screen() === 'laptopUnavailable');
    expect(f.client.campaigns[0]).toMatchObject({
      options: { saveMode: 'deadIsDead' },
      deadIsDead: { name: null, description: 'Last stand' },
    });
  });

  it('keeps Alt+Load on the load screen after a Dead is Dead game named its save', async () => {
    f.click('saveMode2');
    f.click('start');
    await answer('messageBox', 'yes');
    await answer('messageBox', 'yes');
    await answer('messageBox', 'ok');
    await until(() => f.screen() === 'saveLoad');
    f.click('row0');
    await f.settle();
    f.type('Last stand');
    f.key('Enter', 'up');
    await until(() => f.screen() === 'laptopUnavailable');
    f.client.listings = [listing('old', '2026-10-01T00:00:00Z'), listing('newest', '2026-10-05T00:00:00Z')];
    f.flow.mainMenu();
    await f.settle();
    f.click('loadGame', KeyModifier.ALT);
    await until(() => f.screen() === 'saveLoad');
    expect(f.client.loads).toEqual([]);
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

  it('in a game enables Save by the session, pauses the game and returns to the main menu by quitting the session', async () => {
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
    expect(f.client.calls).toContain('quitSession');
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
    await until(() => f.screen() === 'mapUnavailable');
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
    await until(() => f.screen() === 'laptopUnavailable');
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

  it('takes the focus off the description with Tab and gives it back with the next Tab', async () => {
    await f.client.newCampaign({ options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } });
    await f.flow.saveLoad('save', 'game');
    await f.settle();
    f.key('Enter', 'up');
    f.type('Bridge');
    f.key('Tab');
    expect(f.widget('description.0').state).toBe('inactive');
    f.type(' ignored');
    f.key('Tab');
    expect(f.widget('description.0').state).toBe('editing');
    expect(f.widget('description.0').text).toBe('Bridge');
    f.key('End');
    f.type(' at dawn');
    expect(f.widget('description.0').text).toBe('Bridge at dawn');
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

  it('names the town or land type of each save from the map tables: every secret found to load, the running game to save', async () => {
    f.host.facts = await loadMapTestFacts();
    f.client.listings = [
      listing('prison', '2026-10-03T00:00:00Z', { sector: 'J9' }),
      listing('dungeon', '2026-10-02T00:00:00Z', { sector: 'J9-1' }),
      listing('start', '2026-10-01T00:00:00Z', { sector: null, world: { day: 1, hour: 1, minute: 0 } }),
    ];
    await f.flow.saveLoad('load', 'mainMenu');
    await f.settle();
    expect([f.widget('sector0').text, f.widget('sector1').text, f.widget('sector2').text]).toEqual(['J9: Tixa', 'J9: Tixa Dungeon', 'N/A']);
    await f.client.newCampaign({ options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } });
    await f.flow.saveLoad('save', 'game');
    await f.settle();
    expect(f.widget('sector1').text).toBe('J9: Desert');
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
    expect(f.client.calls).not.toContain('quitSession');
    expect(f.screen()).toBe('mainMenu');
    expect(f.pauses).toEqual([true, false]);
  });

  it('says that the connection was lost while it reconnects and closes the box once the session answers again', async () => {
    f.client.connectionChanged({ state: 'reconnecting' });
    await until(() => f.modal() === RECONNECTING_BOX);
    expect(f.widget(RECONNECTING_BOX).text).toContain('The connection to the game server was lost.');
    f.client.connectionChanged({ state: 'open' });
    await until(() => f.modal() === null);
    expect(f.screen()).toBe('laptopUnavailable');
    expect(f.client.calls).not.toContain('leaveSession');
  });

  it('leaves the game for the main menu when the player stops waiting for the server', async () => {
    f.client.connectionChanged({ state: 'reconnecting' });
    f.client.connectionChanged({ state: 'reconnecting' });
    await answer(RECONNECTING_BOX, 'ok');
    expect(f.modal()).toBeNull();
    expect(f.client.calls).toContain('leaveSession');
    expect(f.screen()).toBe('mainMenu');
  });

  it('returns to the main menu and says why when the session ends on the server', async () => {
    f.client.connectionChanged({ state: 'reconnecting' });
    await until(() => f.modal() === RECONNECTING_BOX);
    f.client.connectionChanged({ state: 'ended', reason: 'gone' });
    await until(() => f.modal() === SESSION_ENDED_BOX);
    expect(f.screen()).toBe('mainMenu');
    expect(f.client.calls).toContain('leaveSession');
    expect(f.widget(SESSION_ENDED_BOX).text).toBe('The game session no longer exists on the server.');
    await answer(SESSION_ENDED_BOX, 'ok');
    expect(f.modal()).toBeNull();
    expect(f.screen()).toBe('mainMenu');
  });

  it('names a server that stopped and a session closed elsewhere', async () => {
    f.client.connectionChanged({ state: 'ended', reason: 'shutdown' });
    await until(() => f.modal() === SESSION_ENDED_BOX);
    expect(f.widget(SESSION_ENDED_BOX).text).toBe('The game server was stopped.');
    await answer(SESSION_ENDED_BOX, 'ok');
    await f.client.newCampaign({ options: { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } });
    f.flow.enterGame();
    await f.settle();
    f.client.connectionChanged({ state: 'ended', reason: 'closed' });
    await until(() => f.modal() === SESSION_ENDED_BOX);
    expect(f.widget(SESSION_ENDED_BOX).text).toBe('The game session was closed on the server.');
  });

  it('quick saves under the quick save name and answers a refusal with the Iron Man message', async () => {
    expect(await f.flow.quickSave()).toBeNull();
    expect(f.client.saved).toEqual([{ session: 'session-1', request: { name: 'quick' } }]);
    f.client.saveRefusal = { ok: false, refused: 'ironMan', reason: 'enemies in the sector' };
    expect(await f.flow.quickSave()).toBe(f.env.labels().text('ironManCannotSave'));
    expect(f.screen()).toBe('laptopUnavailable');
  });

  it('quick loads the quick save in place without the warning box, and does nothing without one', async () => {
    f.client.listings = [listing('newer', '2026-10-05T00:00:00Z')];
    await f.flow.quickLoad();
    expect(f.client.loads).toEqual([]);
    f.client.listings = [listing('QuickSave', '2026-10-01T00:00:00Z', { kind: 'quick' }), listing('newer', '2026-10-05T00:00:00Z')];
    f.client.nextFlow = 'tactical';
    void f.flow.quickLoad();
    await until(() => f.screen() === 'tacticalUnavailable');
    expect(f.client.loads).toEqual([{ session: 'session-1', name: 'QuickSave' }]);
    await until(() => f.modal() === null);
  });

  it('loads a save in place from the in-game load screen', async () => {
    f.client.listings = [listing('newer', '2026-10-05T00:00:00Z')];
    f.client.nextFlow = 'tactical';
    f.key('l', 'down', KeyModifier.CTRL);
    await until(() => f.screen() === 'saveLoad');
    f.click('loadButton');
    await until(() => f.screen() === 'tacticalUnavailable');
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
    expect(f.screen()).toBe('laptopUnavailable');
  });
});

function idleScreen(id: string): Screen {
  return { id, enter: () => undefined, exit: () => undefined, update: () => undefined, input: () => false, render: () => undefined };
}

function clockScreen(id: string): Screen {
  return { ...idleScreen(id), render: (list) => list.fill(0, 0, f.client.view?.clock?.hour ?? 0, 1, 0) };
}

function showView(flow: NonNullable<PlayerView['strategic']>['flow'], prompt: PromptView | null = null, hour = 0): void {
  const strategic = { flow } as NonNullable<PlayerView['strategic']>;
  const clock = { day: 1, hour, minute: 0, compressing: false };
  f.client.view = { tick: 0, mapPath: 'maps/a9.dat', soldiers: [], strategic, prompt, clock };
}

function hourDrawn(): number | null {
  const first = f.t.list.items[0];
  return first?.kind === 'fill' ? first.width : null;
}

function frame(events: ViewFrame['events'] = []): ViewFrame {
  return { tick: 1, changed: [], removed: [], events };
}

const SECTOR_LOADED = { type: 'sectorLoaded', sector: 'A9', hostiles: 0 } as NonNullable<ViewFrame['events']>[number];
const PRE_BATTLE = { id: 'pbi-1', kind: 'preBattle' } as PromptView;
const SECTOR_ZOOM_SOUND = { file: 'sounds/final psionic blast 01 (16-44).wav', volume: 127 };

describe('the zooms out of the map screen', () => {
  let tacticalLoads: number;
  let tacticalLoaded: boolean;
  let laptopFlows: LaptopFlow[];

  beforeEach(async () => {
    tacticalLoads = 0;
    tacticalLoaded = false;
    laptopFlows = [];
    const map: MapPort = {
      loaded: true,
      load: async () => undefined,
      preload: () => undefined,
      screen: () => clockScreen('map'),
      enter: async () => ({ ok: true }),
    };
    const tactical: TacticalPort = {
      get loaded() {
        return tacticalLoaded;
      },
      stale: false,
      loadScreen: null,
      load: async () => {
        tacticalLoads++;
        tacticalLoaded = true;
      },
      screen: () => clockScreen('tactical'),
    };
    f.host.mapPort = map;
    f.host.tacticalPort = tactical;
    f.host.laptopPort = {
      open: async (opened) => {
        laptopFlows.push(opened);
        return idleScreen('laptop');
      },
    };
    f.host.zooms = true;
    f.client.session = 'session-1';
    showView('strategic');
    f.flow.enterGame();
    await until(() => f.screen() === 'map');
  });

  async function zoomFor(ms: number): Promise<void> {
    for (let elapsed = 0; elapsed <= ms; elapsed += 16) f.t.frame(16);
    await f.settle(1);
  }

  it('zooms into a sector the map screen loads with the game held, then loads the sector', async () => {
    showView('tactical');
    f.flow.frames([frame([SECTOR_LOADED])]);
    expect(f.modal()).toBe(SECTOR_ZOOM);
    expect(f.pauses).toEqual([true]);
    expect(f.t.sounds.played).toContainEqual(SECTOR_ZOOM_SOUND);
    f.flow.frames([frame()]);
    await zoomFor(SECTOR_ZOOM_TIME / 2);
    expect(f.screen()).toBe('map');
    expect(f.t.list.items.some((i) => i.kind === 'snapshot')).toBe(true);
    expect(tacticalLoads).toBe(0);
    await zoomFor(SECTOR_ZOOM_TIME / 2);
    await until(() => f.screen() === 'tactical');
    expect(f.modal()).toBeNull();
    expect(f.pauses).toEqual([true, false]);
    expect(tacticalLoads).toBe(1);
  });

  it('zooms into the frame the map screen presented before the batch that leaves it, then shows the tactical screen of that batch', async () => {
    const FIRST_HOUR = 1;
    const ARRIVAL_HOUR = 7;
    showView('strategic', null, FIRST_HOUR);
    f.t.frame(16);
    showView('tactical', null, ARRIVAL_HOUR);
    f.flow.frames([frame([SECTOR_LOADED])]);
    f.t.frame(16);
    expect([f.modal(), hourDrawn()]).toEqual([SECTOR_ZOOM, FIRST_HOUR]);
    await zoomFor(SECTOR_ZOOM_TIME);
    await until(() => f.screen() === 'tactical');
    expect(hourDrawn()).toBe(ARRIVAL_HOUR);
  });

  it("zooms into the loaded sector the pre-battle panel's Enter goes to, but not into the one the Tactical button goes to", async () => {
    showView('strategic', PRE_BATTLE);
    f.flow.frames([frame()]);
    showView('tactical');
    f.flow.frames([frame()]);
    expect(f.modal()).toBe(SECTOR_ZOOM);
    await zoomFor(SECTOR_ZOOM_TIME);
    await until(() => f.screen() === 'tactical');
    showView('strategic');
    f.flow.frames([frame()]);
    await until(() => f.screen() === 'map');
    showView('tactical');
    f.flow.frames([frame()]);
    await until(() => f.screen() === 'tactical');
    expect(f.t.sounds.played.filter((s) => 'file' in s && s.file === SECTOR_ZOOM_SOUND.file)).toHaveLength(1);
  });

  it('zooms into no sector a meanwhile loads, nor with the zooms off', async () => {
    showView('meanwhile');
    f.flow.frames([frame([SECTOR_LOADED])]);
    await until(() => f.screen() === 'tactical');
    expect(f.modal()).toBeNull();
    showView('strategic');
    f.flow.frames([frame()]);
    await until(() => f.screen() === 'map');
    f.host.zooms = false;
    showView('tactical');
    f.flow.frames([frame([SECTOR_LOADED])]);
    await until(() => f.screen() === 'tactical');
    expect(f.t.sounds.played).not.toContainEqual(SECTOR_ZOOM_SOUND);
  });

  it('opens the laptop as coming from the map screen', async () => {
    showView('laptop');
    f.flow.frames([frame()]);
    await until(() => f.screen() === 'laptop');
    expect(laptopFlows.map((l) => l.fromMap)).toEqual([true]);
  });
});

describe('the pictures of the loading screen (DisplayLoadScreenWithID, LoadSavedGame)', () => {
  const { NIGHTWILD, DAYTOWN1 } = LoadingScreen;
  let tacticalLoaded: boolean;
  let finishTacticalLoad: () => void;

  beforeEach(() => {
    tacticalLoaded = false;
    finishTacticalLoad = () => undefined;
    f.host.tacticalPort = {
      get loaded() {
        return tacticalLoaded;
      },
      stale: false,
      loadScreen: DAYTOWN1,
      load: () =>
        new Promise<void>((resolve) => {
          finishTacticalLoad = () => {
            tacticalLoaded = true;
            resolve();
          };
        }),
      screen: () => idleScreen('tactical'),
    };
  });

  const pathOf = (picture: number) => loadingPicturePath(f.env.layout(FrontEndLayout.LOADING), picture);
  const pictureDrawn = () => f.draw().items.find((i) => i.kind === 'image' && i.asset.startsWith('loadscreens/'));

  it('loads the picture a sector load shows before the loading screen shows it, black until then', async () => {
    const path = pathOf(DAYTOWN1);
    if (!path) throw new Error('no picture');
    const info = f.t.images.info.bind(f.t.images);
    let release = () => {};
    let loaded = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.t.images, 'info').mockImplementation((key) => (key === path && !loaded ? undefined : info(key)));
    const load = vi.spyOn(f.t.images, 'load').mockImplementation(async () => {
      await gate;
      loaded = true;
      return true;
    });
    f.client.session = 'session-1';
    showView('tactical');
    f.flow.enterGame();
    await f.settle(2);
    expect([f.screen(), load.mock.calls]).toEqual(['black', [[path]]]);
    release();
    await until(() => f.screen() === 'loading');
    expect(pictureDrawn()).toMatchObject({ asset: path });
    expect(f.widget('sectorBar').visible).toBe(true);
  });

  it("shows the save's picture through its load and the tactical load after it, and the helicopter for a header without one", async () => {
    f.client.nextFlow = 'tactical';
    void f.flow.loadSave(listing('wild', '2026-10-05T00:00:00Z', { loadScreen: NIGHTWILD }), 'mainMenu');
    await until(() => f.client.loads.length === 1 && f.screen() === 'loading');
    await f.settle(2);
    expect([pictureDrawn(), f.widget('saveBar').visible]).toEqual([expect.objectContaining({ asset: pathOf(NIGHTWILD) }), true]);
    finishTacticalLoad();
    await until(() => f.screen() === 'tactical');
    tacticalLoaded = false;
    void f.flow.loadSave(listing('old', '2026-10-01T00:00:00Z'), 'mainMenu');
    await until(() => f.client.loads.length === 2 && f.screen() === 'loading');
    await f.settle(2);
    expect(pictureDrawn()).toMatchObject({ asset: pathOf(LOADINGSCREEN_HELI) });
  });
});

describe('the map screen loaded in the background, since the original enters it with no loading screen', () => {
  const { NIGHTWILD } = LoadingScreen;
  const MAP_LOAD_STEPS = 4;
  let mapLoaded: boolean;
  let mapLoads: number;
  let mapProgress: LoadProgress;
  let finishMapLoad: () => void;
  let shown: string[];

  beforeEach(() => {
    mapLoaded = false;
    mapLoads = 0;
    mapProgress = () => undefined;
    finishMapLoad = () => undefined;
    let running: Promise<void> | null = null;
    const load = (progress: LoadProgress = () => undefined): Promise<void> => {
      mapProgress = progress;
      running ??= new Promise<void>((resolve) => {
        mapLoads++;
        finishMapLoad = () => {
          mapLoaded = true;
          running = null;
          resolve();
        };
      });
      return running;
    };
    f.host.mapPort = {
      get loaded() {
        return mapLoaded;
      },
      load,
      preload: () => {
        if (!mapLoaded) void load();
      },
      screen: () => idleScreen('map'),
      enter: async () => ({ ok: true }),
    };
    shown = [];
    const screens = f.t.runtime.host;
    for (const method of ['push', 'replace'] as const) {
      const original = screens[method].bind(screens);
      vi.spyOn(screens, method).mockImplementation((screen) => {
        shown.push(screen.id);
        original(screen);
      });
    }
  });

  const shownSince = (id: string) => shown.slice(shown.lastIndexOf(id));

  function loadedTactical(): TacticalPort {
    return { loaded: true, stale: false, loadScreen: null, load: async () => undefined, screen: () => idleScreen('tactical') };
  }

  it('loads it during the beginning video of a new game and enters it from the laptop without a loading screen', async () => {
    let loadsAtBeginning = 0;
    f.host.playBeginning = async () => {
      loadsAtBeginning = mapLoads;
      finishMapLoad();
    };
    let laptop: LaptopFlow | null = null;
    f.host.laptopPort = {
      open: async (opened) => {
        laptop = opened;
        return idleScreen('laptop');
      },
    };
    f.flow.mainMenu();
    await f.settle();
    f.click('newGame');
    await until(() => f.screen() === 'gameInit');
    f.click('start');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptop');
    showView('strategic');
    (laptop as LaptopFlow | null)?.closed();
    await until(() => f.screen() === 'map');
    expect([loadsAtBeginning, mapLoads, shownSince('laptop')]).toEqual([1, 1, ['laptop', 'map']]);
  });

  it('loads it once the tactical screen is up and enters it from tactical without a loading screen', async () => {
    let mapLoadsDuringTacticalLoad = -1;
    let tacticalLoaded = false;
    f.host.tacticalPort = {
      get loaded() {
        return tacticalLoaded;
      },
      stale: false,
      loadScreen: null,
      load: async () => {
        mapLoadsDuringTacticalLoad = mapLoads;
        tacticalLoaded = true;
      },
      screen: () => idleScreen('tactical'),
    };
    f.client.session = 'session-1';
    showView('tactical');
    f.flow.enterGame({ pageStart: true });
    await until(() => f.screen() === 'tactical');
    expect([mapLoadsDuringTacticalLoad, mapLoads]).toEqual([0, 1]);
    finishMapLoad();
    await f.settle(1);
    showView('strategic');
    f.flow.frames([frame()]);
    await until(() => f.screen() === 'map');
    expect(shownSince('tactical')).toEqual(['tactical', 'map']);
  });

  it('waits on black for a map screen still loading when entered from tactical', async () => {
    f.host.tacticalPort = loadedTactical();
    f.client.session = 'session-1';
    showView('tactical');
    f.flow.enterGame();
    await until(() => f.screen() === 'tactical');
    showView('strategic');
    f.flow.frames([frame()]);
    await until(() => f.screen() === 'black');
    finishMapLoad();
    await until(() => f.screen() === 'map');
    expect([mapLoads, shownSince('tactical')]).toEqual([1, ['tactical', 'black', 'map']]);
  });

  it("waits for it on the loading screen on a page's first screen and on the save's after a save load, the bar following the load", async () => {
    f.client.session = 'session-1';
    showView('strategic');
    f.flow.enterGame({ pageStart: true });
    await until(() => f.screen() === 'loading' && mapLoads === 1);
    mapProgress(2, MAP_LOAD_STEPS);
    await f.settle(1);
    expect([f.widget('saveBar').visible, f.widget('saveBar').state]).toEqual([true, 50]);
    finishMapLoad();
    await until(() => f.screen() === 'map');
    mapLoaded = false;
    f.client.nextFlow = 'strategic';
    void f.flow.loadSave(listing('wild', '2026-10-05T00:00:00Z', { loadScreen: NIGHTWILD }), 'mainMenu');
    await until(() => f.client.loads.length === 1 && mapLoads === 2);
    await f.settle(2);
    expect(f.screen()).toBe('loading');
    expect(f.draw().items.find((i) => i.kind === 'image' && i.asset.startsWith('loadscreens/'))).toMatchObject({
      asset: loadingPicturePath(f.env.layout(FrontEndLayout.LOADING), NIGHTWILD),
    });
    finishMapLoad();
    await until(() => f.screen() === 'map');
  });
});

describe('the laptop port', () => {
  it('opens the laptop screen for a laptop session and enters the map once the server has left the laptop', async () => {
    let flow: LaptopFlow | null = null;
    const laptopScreen: Screen = {
      id: 'laptop',
      enter: () => undefined,
      exit: () => undefined,
      update: () => undefined,
      input: () => false,
      render: () => undefined,
    };
    f.host.laptopPort = {
      open: async (opened) => {
        flow = opened;
        return laptopScreen;
      },
    };
    f.client.nextFlow = 'laptop';
    f.flow.mainMenu();
    await f.settle();
    f.click('newGame');
    await until(() => f.screen() === 'gameInit');
    f.click('start');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptop');
    expect((flow as LaptopFlow | null)?.fromMap).toBe(false);
    (flow as LaptopFlow | null)?.closed();
    await f.settle();
    expect(f.screen()).toBe('laptop');
    const view = f.client.view;
    if (!view?.strategic) throw new Error('no strategic view');
    f.client.view = { ...view, strategic: { ...view.strategic, flow: 'strategic' } };
    f.flow.frames([{ tick: 1, changed: [], removed: [] }]);
    await f.settle();
    expect(f.screen()).toBe('mapUnavailable');
  });
});

describe('a game screen that cannot be opened', () => {
  beforeEach(async () => {
    f.flow.mainMenu();
    await f.settle();
    f.click('newGame');
    await f.settle();
  });

  const laptopScreen: Screen = {
    id: 'laptop',
    enter: () => undefined,
    exit: () => undefined,
    update: () => undefined,
    input: () => false,
    render: () => undefined,
  };

  it('names the screen and the lost connection without a box, and Retry opens it once the server answers', async () => {
    let online = false;
    f.host.laptopPort = {
      open: async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return laptopScreen;
      },
    };
    f.click('start');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptopUnavailable');
    expect(f.widget('heading').text).toBe('The laptop could not be opened.');
    expect(f.widget('reason').text).toBe('The connection to the server was lost (Failed to fetch).');
    expect(f.widget('session').text).toBe('Session session-1');
    expect(f.modal()).toBeNull();
    online = true;
    f.click('retry');
    await until(() => f.screen() === 'laptop');
    expect(f.client.calls).toContain('connect session-1');
  });

  it('stays on the panel with the new reason when reconnecting fails', async () => {
    f.host.laptopPort = {
      open: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    f.click('start');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptopUnavailable');
    f.client.connect = async () => {
      throw new Error('cannot connect to the game server');
    };
    f.click('retry');
    await until(() => f.widget('reason').text === 'cannot connect to the game server');
    expect(f.screen()).toBe('laptopUnavailable');
  });

  it('shows any other failure as it is and leaves for the main menu', async () => {
    f.host.laptopPort = {
      open: async () => {
        throw new Error('/vfs/laptop/laptop3.sti: HTTP 500');
      },
    };
    f.click('start');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptopUnavailable');
    expect(f.widget('reason').text).toBe('/vfs/laptop/laptop3.sti: HTTP 500');
    f.click('mainMenu');
    await until(() => f.screen() === 'mainMenu');
    expect(f.client.calls).toContain('leaveSession');
  });

  it('says it is not connected when the host has no port for the screen', async () => {
    f.click('start');
    await answer('messageBox', 'yes');
    await until(() => f.screen() === 'laptopUnavailable');
    expect(f.widget('reason').text).toBe('Not connected to a game session.');
  });
});

describe('the current save, the refusals of the save key and the saving box', () => {
  const OPTIONS = { difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true } as const;
  const MESSAGE_BOX = 'messageBox';

  beforeEach(async () => {
    await f.client.newCampaign({ options: OPTIONS });
    f.client.listings = [
      listing('quick', '2026-10-06T00:00:00Z', { kind: 'quick' }),
      listing('newer', '2026-10-05T00:00:00Z'),
      listing('older', '2026-10-01T00:00:00Z'),
    ];
  });

  function saveScreen(mode: SaveLoadMode, currentSave: string | null): SaveLoadController {
    return new SaveLoadController({
      mode,
      listings: f.client.listings,
      labels: f.env.labels,
      saves: f.flow.saves,
      boxes: f.env.boxes,
      session: null,
      namesSaveOnly: false,
      currentSave,
      actions: { leave: () => undefined, saved: () => undefined, load: () => undefined, nameSave: () => undefined },
    });
  }

  it('selects the current save on both screens, and the first row without one or for a save the screen hides (EnterSaveLoadScreen)', () => {
    expect(saveScreen('load', 'older').selected).toBe(2);
    expect(saveScreen('save', 'older').selected).toBe(2);
    expect(saveScreen('load', 'gone').selected).toBe(0);
    expect(saveScreen('load', null).selected).toBe(0);
    expect(saveScreen('save', 'quick').selected).toBe(0);
  });

  it('remembers every save and load but an automatic one, across sessions in the settings (SaveGame, LoadSavedGame)', async () => {
    expect(await f.flow.quickSave()).toBeNull();
    expect(f.settings.settings.currentSave).toBe('quick');
    expect(f.settings.persisted?.currentSave).toBe('quick');
    const older = f.client.listings.at(-1);
    if (!older) throw new Error('no save');
    void f.flow.loadSave(older, 'game');
    await until(() => f.settings.settings.currentSave === 'older');
    await until(() => f.client.loads.length === 1);
    void f.flow.loadSave(listing('Auto01', '2026-10-07T00:00:00Z', { kind: 'auto' }), 'game');
    await until(() => f.client.loads.length === 2);
    await f.settle(3);
    expect(f.settings.settings.currentSave).toBe('older');
  });

  it('answers the save key with the Iron Man box and keeps the save screen shut (HandleModCtrl, RequestTriggerExitFromMapscreen)', async () => {
    f.client.options = { ...OPTIONS, saveMode: 'ironMan' };
    f.client.canSave = false;
    f.client.statusRefusal = 'ironMan';
    void f.flow.requestSaveScreen();
    await until(() => f.modal() === MESSAGE_BOX);
    expect(f.widget(MESSAGE_BOX).text).toBe(f.env.labels().text('ironManCannotSave'));
    expect(f.screen()).not.toBe('saveLoad');
  });

  it('answers the save key with its own box in a Dead is Dead game, whose table has no line for it', async () => {
    f.client.options = { ...OPTIONS, saveMode: 'deadIsDead' };
    void f.flow.requestSaveScreen();
    await until(() => f.modal() === MESSAGE_BOX);
    expect(f.widget(MESSAGE_BOX).text).toBe(f.env.labels().text('deadIsDeadCannotSave'));
    expect(f.screen()).not.toBe('saveLoad');
  });

  it('opens the save screen when the game can be saved', async () => {
    void f.flow.requestSaveScreen();
    await until(() => f.screen() === 'saveLoad');
  });

  it('stores an empty description as the original does (MSG_NODESC)', async () => {
    await f.flow.saves.saveNew('session-1', '   ');
    expect(f.client.saved.at(-1)?.request).toEqual({ description: 'No description' });
  });

  it('shows the saving box while the game is written, and none for the quick save of a Dead is Dead game (SaveGame)', async () => {
    const send = f.client.save.bind(f.client);
    let finish: () => void = () => undefined;
    f.client.save = (session, request) =>
      new Promise((resolve) => {
        finish = () => resolve(send(session, request));
      });
    const saving = f.flow.quickSave();
    await until(() => f.modal() === SAVING_BOX);
    expect(f.widget(SAVING_BOX).text).toBe(f.env.labels().text('saving'));
    finish();
    await saving;
    expect(f.modal()).toBeNull();
    f.client.options = { ...OPTIONS, saveMode: 'deadIsDead' };
    const silent = f.flow.quickSave();
    await f.settle(3);
    expect(f.modal()).toBeNull();
    finish();
    await silent;
  });
});
