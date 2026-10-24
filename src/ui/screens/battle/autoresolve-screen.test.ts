import { beforeAll, describe, expect, it } from 'vitest';
import { battleLayoutModels, FakeBattleSounds, loadStubImages, testBattleEnvironment } from '../../../../tests/support/battle-ui.ts';
import { KEY_TEXT } from '../../../../tests/support/map-screen.ts';
import { type TestRuntime, testRuntime } from '../../../../tests/support/ui-runtime.ts';
import type { CommandEnvelope, DriverMode, StopCondition } from '../../../protocol/messages.ts';
import type { AutoresolveCellView, AutoresolveView, PlayerView, PromptView, ViewFrame } from '../../../protocol/view.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import { AutoresolveScreen } from './autoresolve-screen.ts';
import type { BattleClient, BattleReply } from './environment.ts';

const OPENING_MS = 1000;
const FRAME_MS = 16;
const SLICE_MS = 1000;

let models: Map<string, LayoutModel>;

beforeAll(async () => {
  models = await battleLayoutModels();
});

const merc = (index: number, life: number): AutoresolveCellView => ({
  side: 'merc',
  index,
  kind: `Merc ${index}`,
  state: life >= 15 ? 'alive' : 'unconscious',
  soldier: index,
  name: `Merc ${index}`,
  profile: index,
  life,
  lifeMax: 80,
  bleeding: 0,
  breathMax: 100,
  morale: 50,
});

const enemy = (index: number): AutoresolveCellView => ({
  side: 'enemy',
  index,
  kind: 'troop',
  state: 'alive',
  health: 'excellent',
  hurt: false,
});

const START: AutoresolveView = {
  sector: 'D13',
  encounter: 'enemyEncounter',
  status: 'inProgress',
  battleSeconds: 0,
  alive: { mercs: 2, militia: 0, enemies: 5 },
  cells: [merc(0, 40), merc(1, 30), enemy(0), enemy(1), enemy(2), enemy(3), enemy(4)],
};

class FakeClient implements BattleClient {
  readonly commands: CommandEnvelope[] = [];
  readonly drives: DriverMode[] = [];
  readonly advances: StopCondition[] = [];
  replies: BattleReply[] = [];
  view: PlayerView;

  constructor(ar: AutoresolveView, prompt: PromptView | null = null) {
    this.view = { tick: 0, strategic: { flow: 'autoresolve' }, autoresolve: ar, prompt } as unknown as PlayerView;
  }

  async command(cmd: CommandEnvelope): Promise<BattleReply> {
    this.commands.push(cmd);
    return this.replies.shift() ?? { ok: true };
  }

  drive(driver: DriverMode): void {
    this.drives.push(driver);
  }

  async advance(until: StopCondition): Promise<void> {
    this.advances.push(until);
  }

  showLatest(): void {}

  show(ar: AutoresolveView | null, prompt: PromptView | null, flow = ar ? 'autoresolve' : 'strategic'): void {
    this.view = { ...this.view, autoresolve: ar, prompt, strategic: { flow } } as unknown as PlayerView;
  }
}

class FakeBoxes implements MessageBoxes {
  readonly alerts: string[] = [];

  async confirm(): Promise<boolean> {
    return true;
  }

  async alert(text: string): Promise<void> {
    this.alerts.push(text);
  }

  async ask(): Promise<number> {
    return 0;
  }
}

interface Harness {
  readonly t: TestRuntime;
  readonly client: FakeClient;
  readonly sounds: FakeBattleSounds;
  readonly boxes: FakeBoxes;
  readonly screen: AutoresolveScreen;
  readonly finished: string[];
  readonly exits: string[];
  frame(ms?: number): Promise<void>;
  click(id: string): Promise<void>;
  feed(ar: AutoresolveView | null, prompt: PromptView | null, events?: ViewFrame['events']): Promise<void>;
}

async function harness(ar: AutoresolveView = START, prompt: PromptView | null = null): Promise<Harness> {
  const t = await testRuntime();
  await loadStubImages(t);
  const client = new FakeClient(ar, prompt);
  const sounds = new FakeBattleSounds();
  const boxes = new FakeBoxes();
  const finished: string[] = [];
  const exits: string[] = [];
  const env = testBattleEnvironment({ t, text: KEY_TEXT, models, client, sounds, boxes, exitGame: () => exits.push('exit') });
  const screen = new AutoresolveScreen(env, ar, prompt, {
    backdrop: [],
    strategic: () => undefined,
    sectorName: (label) => `sector ${label}`,
    finished: () => finished.push('finished'),
  });
  t.runtime.host.push(screen);
  const frame = async (ms = FRAME_MS) => {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) t.frame(FRAME_MS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    t.frame(FRAME_MS);
  };
  const h: Harness = {
    t,
    client,
    sounds,
    boxes,
    screen,
    finished,
    exits,
    frame,
    click: async (id) => {
      const w = t.runtime.describe().find((x) => x.id === id);
      if (!w) throw new Error(`no widget ${id}`);
      t.move(w.rect.x + 2, w.rect.y + 2);
      t.frame(FRAME_MS);
      t.click(w.rect.x + 2, w.rect.y + 2);
      await frame();
    },
    feed: async (next, nextPrompt, events = []) => {
      client.show(next, nextPrompt);
      screen.frames([{ tick: 200, changed: [], removed: [], autoresolve: next, prompt: nextPrompt, events }]);
      await frame(events.length > 0 ? SLICE_MS + FRAME_MS : FRAME_MS * 2);
    },
  };
  await frame(OPENING_MS + FRAME_MS);
  return h;
}

function visible(h: Harness): string[] {
  return h.t.runtime
    .describe()
    .filter((w) => w.kind.startsWith('button') && w.visible)
    .map((w) => w.id);
}

describe('the autoresolve screen', () => {
  it('starts with Play pressed, keeps Fast through Space and Pause as the original does, and exits with Alt+X', async () => {
    const h = await harness();
    expect(h.screen.hook()).toMatchObject({
      opening: false,
      interface: 'battle',
      speed: 'play',
      paused: false,
      ratio: 'gzLateLocalizedString[16]',
    });
    expect(visible(h)).toEqual(['arPlay', 'arFast', 'arFinish', 'arPause', 'arRetreat']);
    expect(h.sounds.powerUps).toBe(1);
    await h.click('arFast');
    expect(h.client.drives.at(-1)).toEqual({ mode: 'realtime', speed: 4 });
    h.t.runtime.input({ kind: 'keyDown', key: ' ', code: 'Space', modifiers: 0 });
    await h.frame();
    expect(h.screen.hook()).toMatchObject({ paused: true, speed: 'fast' });
    expect(h.client.drives.at(-1)).toEqual({ mode: 'manual' });
    h.t.runtime.input({ kind: 'keyDown', key: ' ', code: 'Space', modifiers: 0 });
    await h.frame();
    expect(h.screen.hook()).toMatchObject({ paused: false, speed: 'fast' });
    expect(h.client.drives.at(-1)).toEqual({ mode: 'realtime', speed: 4 });
    h.t.runtime.input({ kind: 'keyDown', key: 'x', code: 'KeyX', modifiers: 4 });
    await h.frame();
    expect(h.exits).toEqual(['exit']);
  });

  it('orders one merc to retreat with a click on his cell and blinks RETREATING', async () => {
    const h = await harness();
    await h.click('arCell.merc:1');
    expect(h.client.commands.at(-1)).toEqual({ type: 'autoresolveRetreat', soldier: 1 });
    expect(h.screen.hook().cells.find((c) => c.key === 'merc:1')?.state).toBe('retreating');
  });

  it('offers the surrender with Yes and No, hides every button after a refusal and shows CAPTURED', async () => {
    const h = await harness();
    const offer: PromptView = { id: 'surrender-1', kind: 'surrender', context: 'autoresolve', choices: ['accept', 'reject'] };
    await h.feed(START, offer);
    expect(h.screen.hook().interface).toBe('surrender');
    expect(visible(h)).toEqual(['arYes', 'arNo']);
    expect(h.client.drives.at(-1)).toEqual({ mode: 'manual' });
    await h.click('arNo');
    expect(h.client.commands.at(-1)).toEqual({ type: 'answer', prompt: 'surrender-1', choice: 'reject' });
    await h.feed(START, null);
    expect(h.screen.hook().interface).toBe('hidden');
    expect(visible(h)).toEqual([]);
    expect(h.client.drives.at(-1)).toEqual({ mode: 'realtime', speed: 1 });
    const captured = { ...START, status: 'captured', battleSeconds: 30 };
    const done: PromptView = { id: 'autoresolveDone-2', kind: 'autoresolveDone', status: 'captured', canBandage: false, choices: ['done'] };
    await h.feed(captured, done, [{ type: 'arBattleOver', tick: 400, battleMs: 10000, status: 'captured' }]);
    expect(h.screen.hook()).toMatchObject({ status: 'captured', interface: 'done', result: 'gpStrategicString[14]' });
    expect(h.screen.hook().elapsed).toBe('gpStrategicString[21]:  0gsTimeStrings[1] 30gsTimeStrings[2]');
    expect(visible(h)).toEqual(['arDoneLose']);
  });

  it('accepts the surrender and shows SURRENDERED', async () => {
    const h = await harness();
    await h.feed(START, { id: 'surrender-1', kind: 'surrender', context: 'autoresolve', choices: ['accept', 'reject'] });
    await h.click('arYes');
    expect(h.client.commands.at(-1)).toMatchObject({ choice: 'accept' });
    const done: PromptView = {
      id: 'autoresolveDone-2',
      kind: 'autoresolveDone',
      status: 'surrendered',
      canBandage: false,
      choices: ['done'],
    };
    await h.feed({ ...START, status: 'surrendered' }, done);
    expect(h.screen.hook()).toMatchObject({ status: 'surrendered', result: 'gpStrategicString[13]' });
  });

  it('bandages after a victory, shows the result box and closes with Done', async () => {
    const h = await harness();
    const won = { ...START, status: 'victory', battleSeconds: 75, alive: { mercs: 2, militia: 0, enemies: 0 } };
    const done: PromptView = {
      id: 'autoresolveDone-3',
      kind: 'autoresolveDone',
      status: 'victory',
      canBandage: true,
      choices: ['bandage', 'done'],
      bandageRefusal: null,
    };
    await h.feed(won, done, [{ type: 'arBattleOver', tick: 400, battleMs: 25000, status: 'victory' }]);
    expect(visible(h)).toEqual(['arBandage', 'arDoneWin']);
    expect(h.screen.hook().elapsed).toBe('gpStrategicString[21]:  1gsTimeStrings[1] 15gsTimeStrings[2]');
    h.client.replies = [{ ok: true, data: { bandaged: 'complete' } }];
    await h.click('arBandage');
    expect(h.client.commands.at(-1)).toEqual({ type: 'answer', prompt: 'autoresolveDone-3', choice: 'bandage' });
    expect(h.boxes.alerts).toEqual(['gzLateLocalizedString[12]']);
    const again: PromptView = {
      id: 'autoresolveDone-4',
      kind: 'autoresolveDone',
      status: 'victory',
      canBandage: false,
      choices: ['done'],
      bandageRefusal: 'nobodyWounded',
    };
    await h.feed(won, again);
    expect(h.t.runtime.describe().find((w) => w.id === 'arBandage')).toMatchObject({ enabled: false });
    await h.click('arDoneWin');
    expect(h.client.commands.at(-1)).toEqual({ type: 'answer', prompt: 'autoresolveDone-4', choice: 'done' });
    h.client.show(null, null);
    await h.frame();
    expect(h.finished).toEqual(['finished']);
  });

  it('finishes at once: the server runs to the end, the sounds stop and the composite sound plays', async () => {
    const h = await harness();
    await h.click('arFinish');
    expect(h.client.advances[0]).toEqual({ idle: true });
    expect(h.sounds.played).toEqual([{ kind: 'effect', name: 'AUTORESOLVE_FINISHFX', loud: true }]);
    await h.feed(START, null, [{ type: 'arSound', tick: 200, battleMs: 1000, sound: 'impact', variant: 0 }]);
    expect(h.sounds.played).toHaveLength(1);
  });
});
