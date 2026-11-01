import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARRIVAL_WAIT_SECONDS,
  arrangeBattle,
  arrangeEnemyArrival,
  BATTLE_FORCES,
  BATTLE_SECTOR,
  BattleVariant,
  campaignOf,
  clearMilitia,
} from '../../../../tests/support/battle-entry.ts';
import { type MapUiKit, type MapUiTest, mapUiKit, mapUiTest } from '../../../../tests/support/map-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { parseSectorString, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicGroupView, StrategicMercView } from '../../../protocol/view.ts';
import { sectorInfo } from '../../../sim/strategic/map/sectors.ts';
import type { DrawItem } from '../../draw-list.ts';
import type { BattleEntryHook } from './battle-entry.ts';

const OPENING_MS = 1000;
const FRAME_MS = 16;
const CREATURES = 3;
const MILITIA = 2;
const MILITIA_TOWN = 'C13';
const MILITIA_TOWN_APPROACH = 'C14';
const UNCONSCIOUS_LIFE = 10;
const BLOODCAT_SECTOR = 'D14';
const BLOODCAT_PLACEMENTS = 5;
const BLOODCAT_TRIP_SECONDS = 6 * 3600;
const BOXES = 'interface/boxes.sti';
const ARRIVING_ARROWS = 'interface/merc_mvt_green_arrows.sti';
const BETWEEN_ARROWS = 'interface/merc_between_sector_icons.sti';
const SMALL_YELLOW_BOX = 0;
const SMALL_RED_BOX = 6;
const RETREAT_SECTOR = 'C13';
const NORTH_ARROW_FROM_BATTLE_SECTOR = { frame: 0, x: 548, y: 73 };
const SECTOR_BEFORE_BATTLE = 'C13';
const SECTOR_BEFORE_MERC = 99;
const BATTLE_SECTOR_FIRST_ICON = { x: 545, y: 83 };
const ICON_STEP_X = 3;
const NORTH = 0;
const EAST = 1;
const LEAVING_TO = 'D14';
const LEAVING_MINUTES = 30;

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

type ImageItem = Extract<DrawItem, { readonly kind: 'image' }>;

function images(f: MapUiTest, asset: string, frame?: number): ImageItem[] {
  return f
    .draw()
    .items.filter((i): i is ImageItem => i.kind === 'image' && i.asset === asset && (frame === undefined || i.frame === frame));
}

function pointAt(f: MapUiTest, x: number, y: number): void {
  f.t.runtime.input({ kind: 'pointerMove', x, y, button: 0, buttons: 0, wheel: 0, modifiers: 0 });
  f.t.frame(FRAME_MS);
}

function iconSlot(slot: number): { x: number; y: number } {
  return { x: BATTLE_SECTOR_FIRST_ICON.x + slot * ICON_STEP_X, y: BATTLE_SECTOR_FIRST_ICON.y };
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

  it('boxes the invasion of a town held by militia alone before the automatic start of the panel', async () => {
    const f = await mapUiTest(kit, ui);
    try {
      const campaign = campaignOf(f.session).campaign;
      const town = parseSectorString(MILITIA_TOWN);
      const element = campaign.state.map.elements[strategicIndex(town)];
      if (element) element.enemyControlled = false;
      sectorInfo(campaign.state.map, town).militia.splice(0, 1, MILITIA);
      arrangeEnemyArrival(f.session, BATTLE_FORCES.victory, undefined, { from: MILITIA_TOWN_APPROACH, to: MILITIA_TOWN });
      f.session.advance({ worldSeconds: ARRIVAL_WAIT_SECONDS });
      f.deliver();
      await frames(f, OPENING_MS + FRAME_MS);
      expect(f.widget('messageBox').text).toBe(`Deidranna's forces have just invaded ${MILITIA_TOWN}: Drassen`);
      expect(battle(f).preBattle).toBeNull();
      f.key('Enter');
      await frames(f, FRAME_MS);
      expect(battle(f).preBattle).toMatchObject({ autoStart: true, encounter: 'enemyInvasion' });
    } finally {
      await f.dispose();
    }
  });

  it('boxes an attack on mercs who cannot fight before the automatic start of the panel', async () => {
    const f = await mapUiTest(kit, ui);
    try {
      clearMilitia(f.session);
      for (const m of campaignOf(f.session).campaign.battle?.roster.all() ?? []) m.soldier.life = UNCONSCIOUS_LIFE;
      arrangeEnemyArrival(f.session, BATTLE_FORCES.victory);
      f.session.advance({ worldSeconds: ARRIVAL_WAIT_SECONDS });
      f.deliver();
      await frames(f, OPENING_MS + FRAME_MS);
      expect(f.widget('messageBox').text).toBe(
        `Enemies attack your mercs in sector ${BATTLE_SECTOR}: Drassen Mine.  None of your mercs are able to fight!`,
      );
      expect(battle(f).preBattle).toBeNull();
      f.key('Enter');
      await frames(f, FRAME_MS);
      expect(battle(f).preBattle).toMatchObject({ autoStart: true, phase: 'opening' });
    } finally {
      await f.dispose();
    }
  });

  it('boxes a bloodcat ambush before the panel of its prompt opens', async () => {
    const f = await mapUiTest(kit, ui);
    try {
      const campaign = campaignOf(f.session).campaign;
      const lair = sectorInfo(campaign.state.map, parseSectorString(BLOODCAT_SECTOR));
      lair.numAdmins = 0;
      lair.numTroops = 0;
      lair.numElites = 0;
      lair.bloodCatPlacements = BLOODCAT_PLACEMENTS;
      campaign.state.encounter.autoAmbush = true;
      expect(f.session.dispatch({ type: 'route', soldier: f.mercs[0], to: BLOODCAT_SECTOR }).ok).toBe(true);
      f.session.advance({ worldSeconds: BLOODCAT_TRIP_SECONDS });
      f.deliver();
      await frames(f, FRAME_MS * 2);
      expect(f.client.view.prompt?.kind).toBe('preBattle');
      expect(f.widget('messageBox').text).toBe(`You have been ambushed by bloodcats in sector ${BLOODCAT_SECTOR}: Water!`);
      expect(battle(f).preBattle).toBeNull();
      f.key('Enter');
      await frames(f, FRAME_MS);
      expect(battle(f).preBattle).toMatchObject({ persistent: true, encounter: 'bloodcatAmbush', phase: 'opening' });
    } finally {
      await f.dispose();
    }
  });

  it('shows the retreat arrows toward the previous sector and hides the squad while the pointer is on the Retreat button', () =>
    withBattle(BattleVariant.RETREAT, async (f) => {
      const { rect } = f.widget('preBattleRetreat');
      expect(f.client.view.strategic?.groups.map((g) => g.prev)).toEqual([RETREAT_SECTOR]);
      expect(images(f, BOXES, SMALL_YELLOW_BOX)).toHaveLength(f.mercs.length);
      expect(images(f, ARRIVING_ARROWS)).toEqual([]);
      pointAt(f, rect.x + 1, rect.y + 1);
      expect(images(f, ARRIVING_ARROWS).map(({ frame, x, y }) => ({ frame, x, y }))).toEqual([NORTH_ARROW_FROM_BATTLE_SECTOR]);
      expect(images(f, BETWEEN_ARROWS)).toEqual([]);
      expect(images(f, BOXES, SMALL_YELLOW_BOX)).toEqual([]);
      pointAt(f, rect.x + rect.width + 1, rect.y + 1);
      expect(images(f, ARRIVING_ARROWS)).toEqual([]);
      expect(images(f, BOXES, SMALL_YELLOW_BOX)).toHaveLength(f.mercs.length);
    }));

  it('counts the pixel past the bottom right of the Retreat button as on it, as the original bounds include it', () =>
    withBattle(BattleVariant.RETREAT, async (f) => {
      const { rect } = f.widget('preBattleRetreat');
      pointAt(f, rect.x + rect.width, rect.y + rect.height);
      expect(images(f, ARRIVING_ARROWS)).toHaveLength(1);
      pointAt(f, rect.x + rect.width, rect.y + rect.height + 1);
      expect(images(f, ARRIVING_ARROWS)).toEqual([]);
    }));

  it('draws the enemies of the sector the squad retreats from after the icons of the sector drawn before it', () =>
    withBattle(BattleVariant.RETREAT, async (f) => {
      const mercs = f.client.view.strategic?.mercs as StrategicMercView[];
      const squadMerc = mercs[0];
      if (!squadMerc) throw new Error('no merc in the view');
      mercs.push({ ...squadMerc, id: SECTOR_BEFORE_MERC, sector: SECTOR_BEFORE_BATTLE });
      f.t.frame(FRAME_MS);
      const firstEnemy = () => images(f, BOXES, SMALL_RED_BOX)[0];
      expect(firstEnemy()).toMatchObject(iconSlot(f.mercs.length));
      const { rect } = f.widget('preBattleRetreat');
      pointAt(f, rect.x + 1, rect.y + 1);
      expect(firstEnemy()).toMatchObject(iconSlot(1));
    }));

  it('shows a group leaving the battle sector as about to arrive back in its previous sector while the panel is up', () =>
    withBattle(BattleVariant.RETREAT, async (f) => {
      const groups = f.client.view.strategic?.groups as StrategicGroupView[];
      const squad = groups[0];
      if (!squad) throw new Error('no squad in the view');
      groups[0] = { ...squad, betweenSectors: true, next: LEAVING_TO, nextArrivalMinutes: LEAVING_MINUTES };
      f.t.frame(FRAME_MS);
      expect(images(f, ARRIVING_ARROWS).map((i) => i.frame)).toEqual([NORTH]);
      expect(images(f, BETWEEN_ARROWS).map((i) => i.frame)).toEqual([EAST]);
    }));

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
