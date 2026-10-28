import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARRIVAL_WAIT_SECONDS, arrangeBattle, BATTLE_SECTOR, BattleVariant, campaignOf } from '../../../../tests/support/battle-entry.ts';
import { type MapUiKit, type MapUiTest, mapUiKit, mapUiTest } from '../../../../tests/support/map-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { DrawItem } from '../../draw-list.ts';
import type { BattleEntryHook } from './battle-entry.ts';

const OPENING_MS = 1000;
const FRAME_MS = 16;
const CREATURES = 3;

let kit: StubSectorKit;
let ui: MapUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await mapUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function line(item: DrawItem): string {
  switch (item.kind) {
    case 'image':
      return `image ${item.asset}#${item.frame} ${item.x},${item.y}${item.shade ? ' shaded' : ''}`;
    case 'glyphs': {
      const first = item.glyphs[0];
      return `glyphs ${item.font} ${first ? `${first.x},${first.y}` : '-'} n=${item.glyphs.length} fg=${item.foreground}`;
    }
    case 'fill':
      return `fill ${item.x},${item.y} ${item.width}x${item.height} ${hex(item.color)}`;
    case 'shadow':
      return `shadow ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'snapshot':
      return `snapshot ${item.source} ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'clipPush':
      return `clip ${item.x},${item.y} ${item.width}x${item.height}`;
    default:
      return item.kind;
  }
}

function snapshotFrom(f: MapUiTest, marker: (item: DrawItem) => boolean): string {
  const items = f.draw().items;
  const from = items.findLastIndex(marker);
  return `${items.slice(Math.max(0, from)).map(line).join('\n')}\n`;
}

const fullScreenShadow = (item: DrawItem) => item.kind === 'shadow' && item.x === 0 && item.y === 0 && item.width >= 640;

function battle(f: MapUiTest): BattleEntryHook {
  return f.screen.battle.hook();
}

async function frames(f: MapUiTest, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) f.t.frame(FRAME_MS);
  await f.settle(1);
}

async function arrive(f: MapUiTest, variant: BattleVariant): Promise<void> {
  arrangeBattle(f.session, variant);
  f.session.advance({ worldSeconds: ARRIVAL_WAIT_SECONDS });
  f.deliver();
  await frames(f, OPENING_MS + FRAME_MS);
}

async function withBattle(variant: BattleVariant, run: (f: MapUiTest) => Promise<void>): Promise<void> {
  const f = await mapUiTest(kit, ui);
  try {
    await arrive(f, variant);
    await run(f);
  } finally {
    await f.dispose();
  }
}

async function finishBattle(f: MapUiTest): Promise<void> {
  await f.click('arFinish');
  f.deliver();
  await frames(f, FRAME_MS * 4);
}

function screenId(f: MapUiTest): string | null {
  return f.t.runtime.host.screen?.id ?? null;
}

describe('the pre-battle interface on the stub map-screen campaign', () => {
  it('opens the persistent panel over the map with the stretch, then shows the three buttons with their fast help', async () => {
    const f = await mapUiTest(kit, ui);
    try {
      arrangeBattle(f.session, BattleVariant.RETREAT);
      f.session.advance({ worldSeconds: ARRIVAL_WAIT_SECONDS });
      f.deliver();
      f.t.frame(FRAME_MS);
      expect(battle(f).preBattle).toMatchObject({ persistent: true, encounter: 'enemyInvasion', phase: 'opening' });
      expect(f.battleSounds.powerUps).toBe(1);
      expect(f.draw().items.some((i) => i.kind === 'snapshot' && i.source === 'preBattle.opening')).toBe(true);
      await frames(f, OPENING_MS);
      expect(battle(f).preBattle?.phase).toBe('shown');
      expect(f.widget('preBattleAutoresolve')).toMatchObject({ enabled: true, rect: { x: 27, y: 54 } });
      expect(f.widget('preBattleGoToSector')).toMatchObject({ enabled: true, rect: { x: 98, y: 54 } });
      expect(f.widget('preBattleRetreat')).toMatchObject({ enabled: true, rect: { x: 169, y: 54 } });
      expect(f.widget('preBattle.panel').text).toBe(f.screen.battle.panel ? 'ENEMY INVASION' : null);
      expect(snapshotFrom(f, (i) => i.kind === 'image' && i.asset === 'interface/prebattlepanel.sti' && i.frame === 0)).toMatchSnapshot();
    } finally {
      await f.dispose();
    }
  });

  it('answers Autoresolve with the a key and switches to the autoresolve screen over the shaded map', () =>
    withBattle(BattleVariant.VICTORY, async (f) => {
      f.key('a', 0, 'KeyA');
      await frames(f, FRAME_MS * 2);
      expect(f.battleClient.commands.at(-1)?.cmd).toMatchObject({ type: 'answer', choice: 'autoresolve' });
      expect(screenId(f)).toBe('autoresolve');
      expect(battle(f).screen).toBe('autoresolve');
      expect(battle(f).autoresolve?.opening).toBe(true);
      expect(f.draw().items.some(fullScreenShadow)).toBe(true);
      await frames(f, OPENING_MS + FRAME_MS);
      expect(battle(f).autoresolve).toMatchObject({ opening: false, interface: 'battle', speed: 'play', paused: false });
      expect(f.battleClient.drives.at(-1)).toEqual({ mode: 'realtime', speed: 1 });
      expect(snapshotFrom(f, fullScreenShadow)).toMatchSnapshot();
    }));

  it('plays the stream at Fast, finishes a victory, offers Done and Bandage, and returns to the map', () =>
    withBattle(BattleVariant.VICTORY, async (f) => {
      await f.click('preBattleAutoresolve');
      await frames(f, OPENING_MS + FRAME_MS * 3);
      await f.click('arFast');
      expect(f.battleClient.drives.at(-1)).toEqual({ mode: 'realtime', speed: 4 });
      f.session.advance({ ticks: 200 });
      f.deliver();
      await frames(f, 300);
      expect(battle(f).autoresolve?.pending).toBe(0);
      await finishBattle(f);
      expect(f.battleClient.advances).toContainEqual({ idle: true });
      expect(f.battleSounds.played).toContainEqual({ kind: 'effect', name: 'AUTORESOLVE_FINISHFX', loud: true });
      const ar = battle(f).autoresolve;
      expect(ar).toMatchObject({ status: 'victory', interface: 'done' });
      expect(ar?.elapsed).toMatch(/\d+.* \d\d/);
      expect(f.widget('arDoneWin').visible).toBe(true);
      expect(f.widget('arBandage').visible).toBe(true);
      expect(f.widget('arDoneLose').visible).toBe(false);
      await f.click('arDoneWin');
      await frames(f, FRAME_MS * 2);
      expect(f.battleClient.commands.at(-1)?.cmd).toMatchObject({ type: 'answer', choice: 'done' });
      expect(screenId(f)).toBe('map');
      expect(battle(f).screen).toBeNull();
    }));

  it('retreats every merc with the Retreat button and ends RETREATED', () =>
    withBattle(BattleVariant.RETREAT, async (f) => {
      await f.click('preBattleAutoresolve');
      await frames(f, OPENING_MS + FRAME_MS * 3);
      await f.click('arRetreat');
      expect(f.battleClient.commands.at(-1)?.cmd).toEqual({ type: 'autoresolveRetreat' });
      expect(
        battle(f)
          .autoresolve?.cells.filter((c) => c.key.startsWith('merc:'))
          .every((c) => c.state === 'retreating'),
      ).toBe(true);
      await finishBattle(f);
      expect(battle(f).autoresolve).toMatchObject({ status: 'retreat', interface: 'done' });
      expect(f.widget('arDoneLose').visible).toBe(true);
      expect(f.widget('arBandage').visible).toBe(false);
    }));

  it('ends a hopeless battle in DEFEAT with the lone Done button', () =>
    withBattle(BattleVariant.DEFEAT, async (f) => {
      await f.click('preBattleAutoresolve');
      await frames(f, OPENING_MS + FRAME_MS * 3);
      await finishBattle(f);
      expect(battle(f).autoresolve).toMatchObject({ status: 'defeat', interface: 'done' });
      expect(f.widget('arDoneLose').visible).toBe(true);
      expect(f.widget('arDoneWin').visible).toBe(false);
    }));

  it('shows an automatic start as the panel with Autoresolve pressed, then the autoresolve screen', async () => {
    const f = await mapUiTest(kit, ui);
    try {
      const campaign = campaignOf(f.session).campaign;
      campaign.state.creatures.attack.sectorId = sectorId(parseSectorString(BATTLE_SECTOR));
      campaign.state.creatures.attack.numAttacking = CREATURES;
      campaign.battle?.openCreatureAttack(true);
      f.session.advance({ ticks: 1 });
      f.deliver();
      await frames(f, FRAME_MS);
      expect(battle(f).preBattle).toMatchObject({ autoStart: true, encounter: 'creatureAttack', phase: 'opening' });
      expect(f.widget('preBattleGoToSector').enabled).toBe(false);
      expect(f.widget('preBattleRetreat').enabled).toBe(false);
      await frames(f, OPENING_MS + FRAME_MS * 3);
      expect(screenId(f)).toBe('autoresolve');
      expect(battle(f).autoresolve?.ratio).toMatch(/4/);
    } finally {
      await f.dispose();
    }
  });

  it('opens BATTLE IN PROGRESS from the battle locator during the tactical battle and closes it with Esc', () =>
    withBattle(BattleVariant.RETREAT, async (f) => {
      await f.click('preBattleGoToSector');
      expect(f.battleClient.commands.at(-1)?.reply.ok).toBe(true);
      expect(f.client.view.strategic?.flow).toBe('tactical');
      expect(f.session.dispatch({ type: 'mapScreen' }).ok).toBe(true);
      f.client.refresh();
      await frames(f, FRAME_MS * 2);
      expect(battle(f).preBattle).toBeNull();
      await f.clickSector(BATTLE_SECTOR);
      expect(f.battleClient.commands.at(-1)?.cmd).toEqual({ type: 'showBattle' });
      await frames(f, FRAME_MS);
      expect(battle(f).preBattle).toMatchObject({ persistent: false, phase: 'opening' });
      await frames(f, OPENING_MS);
      expect(f.widget('preBattle.panel').text).toBe('BATTLE IN PROGRESS');
      expect(f.widget('preBattleRetreat').enabled).toBe(false);
      f.key('Escape', 0, 'Escape');
      await frames(f, FRAME_MS * 2);
      expect(f.battleClient.commands.at(-1)?.cmd).toMatchObject({ type: 'answer', choice: 'close' });
      expect(battle(f).preBattle).toBeNull();
    }));
});
