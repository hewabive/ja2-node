import { expect, type Page } from '@playwright/test';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import { type BattleResult, fightHere, hostilesInSight, ourTurn } from '../../tools/campaign-bot/battle.ts';
import { HIRE_PREFERENCE } from '../../tools/campaign-bot/campaign.ts';
import { loadItems } from '../../tools/campaign-bot/items.ts';
import type { McpGame, Observation } from '../../tools/campaign-bot/mcp-game.ts';
import { Player } from '../../tools/campaign-bot/player.ts';
import {
  clickAt,
  clickVisible,
  expectNoShadowDifference,
  modalIs,
  pointAt,
  screenIs,
  shadowStats,
  showLatest,
  waitShadowSettled,
  waitVisible,
  waitWhileLoading,
  watchLoading,
} from './play-flow.ts';
import { clickWidget, nextFrames, openUiPage, widgets } from './ui-capture.ts';

export const MAIN_FLOW_PAGE = '/play?shadowHints=1&drive=manual';
export const MAIN_FLOW_SETTINGS = { websiteLoadingTimeScale: 0 };
const LOAD_TIMEOUT_MS = 120_000;
const HINT_TIMEOUT_MS = 30_000;
const CURSOR_TIMEOUT_MS = 20_000;
const HINT_POLL_MS = 500;
const API_HIRE_CONTRACT_DAYS = 7;
const MUG_ROWS = 5;
const MUG_COLUMNS = 8;
const OUR_TEAM = 0;
const COLS = 160;
const REAL_TIME_STEPS = [-2, 3, -2 * COLS, 2 * COLS + 1];
const COMBAT_STEPS = [2, -3 * COLS, 3 * COLS - 1];
const AIM_ABOVE_FEET = 15;
const DESTINATION_COLUMN = 4;
const FIRST_ROW = 0;
const MAX_BEGINNING_VIDEOS = 8;
const HIRE_TIMEOUT_MS = 120_000;
const SAVE_DESCRIPTION_FIELD = 'description.0';
const STEP_TIMEOUT_MS = 120_000;
const MARKER_TIMEOUT_MS = 5_000;

export interface ShadowTally {
  tactical: number;
  map: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

async function tacticalReady(page: Page): Promise<void> {
  await waitWhileLoading(page, () => window.__ja2Ui.screen === 'tactical' && window.__ja2Ui.tactical?.ready === true);
  await waitWhileLoading(page, () => window.__ja2Ui.tactical?.pendingImages === 0);
  await nextFrames(page, 4);
}

async function mapReady(page: Page): Promise<void> {
  await waitWhileLoading(page, () => window.__ja2Ui.screen === 'map' && window.__ja2Ui.map?.ready === true);
  await modalIs(page, null);
  await nextFrames(page, 4);
}

async function warmTacticalHints(page: Page, request: CommandEnvelope): Promise<void> {
  await page.waitForFunction(() => window.__ja2Ui.hints?.ready === true, null, { timeout: LOAD_TIMEOUT_MS });
  expect(await page.evaluate(() => window.__ja2Ui.hints?.error ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__ja2Ui.hints?.usable), 'the client rules and engine match the server').toBe(true);
  await page.waitForFunction(
    async (q) => {
      const hints = window.__ja2Ui.hints;
      if (!hints) return false;
      const before = hints.stats.local;
      await hints.hintNow(q);
      return hints.stats.local > before;
    },
    request,
    { polling: HINT_POLL_MS, timeout: LOAD_TIMEOUT_MS },
  );
}

async function soldierPoint(page: Page, id: number): Promise<Point> {
  const at = await page.evaluate((s) => window.__ja2Ui.tactical?.soldierScreen(s) ?? null, id);
  if (!at) throw new Error(`soldier ${id} has no screen position`);
  return at;
}

async function hoverTiles(page: Page, from: number, steps: readonly number[]): Promise<number> {
  let marked = 0;
  for (const step of steps) {
    const tile = from + step;
    const at = await page.evaluate((g) => window.__ja2Ui.tactical?.gridNoScreen(g) ?? null, tile);
    if (!at) continue;
    await pointAt(page, at.x, at.y);
    const shown = await page
      .waitForFunction((g) => window.__ja2Ui.tactical?.markers.some((m) => m.startsWith(`${g}:`)) === true, tile, {
        timeout: MARKER_TIMEOUT_MS,
      })
      .then(() => true)
      .catch(() => false);
    if (shown) marked++;
  }
  return marked;
}

export class MainFlow {
  readonly page: Page;
  readonly game: McpGame;
  readonly shadow: ShadowTally = { tactical: 0, map: 0 };
  session = '';
  #player: Player | null = null;

  constructor(page: Page, game: McpGame) {
    this.page = page;
    this.game = game;
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
  }

  async newGame(): Promise<string> {
    const page = this.page;
    watchLoading(page);
    await openUiPage(page, MAIN_FLOW_PAGE);
    await screenIs(page, 'mainMenu');
    await clickWidget(page, 'newGame');
    await screenIs(page, 'gameInit');
    expect((await widgets(page)).find((w) => w.id === 'difficulty0')?.state).toBe(true);
    await clickWidget(page, 'start');
    await modalIs(page, 'messageBox');
    await clickWidget(page, 'messageBox.yes');
    await this.#skipBeginningVideos();
    const session = await page.evaluate(() => window.__ja2Ui.session);
    if (!session) throw new Error('no session after a new game');
    this.session = session;
    expect((await this.game.status(session)).flow).toBe('laptop');
    return session;
  }

  async #skipBeginningVideos(): Promise<void> {
    const page = this.page;
    for (let video = 0; video < MAX_BEGINNING_VIDEOS; video++) {
      await waitWhileLoading(page, () => window.__ja2Ui.screen === 'laptop' || (window.__ja2Ui.video?.progress.framesShown ?? 0) > 0);
      if (await page.evaluate(() => window.__ja2Ui.screen === 'laptop')) return;
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__ja2Ui.screen === 'laptop' || (window.__ja2Ui.video?.progress.framesShown ?? 0) === 0);
    }
    await screenIs(page, 'laptop');
  }

  async cheapestAnsweringMerc(): Promise<string> {
    const aim = (await this.game.observe(this.session)).laptop?.aim ?? [];
    const cost = (m: (typeof aim)[number]) => m.salary.week + (m.kit?.cost ?? 0) + (m.medicalDeposit ?? 0);
    const answering = aim.filter((m) => m.face === 'available' && m.contact === 'firstContact').sort((a, b) => cost(a) - cost(b));
    const [cheapest] = answering;
    if (!cheapest) throw new Error('no A.I.M. merc answers');
    return cheapest.nickname;
  }

  async hireThroughAim(wanted: string | null): Promise<string> {
    const page = this.page;
    const nickname = wanted ?? (await this.cheapestAnsweringMerc());
    await clickVisible(page, 'newMailOk');
    await waitVisible(page, 'newMailOk', false);
    await clickVisible(page, 'webButton');
    await clickVisible(page, 'bookmarkRegion0');
    await clickVisible(page, 'memberCardLink');
    await clickVisible(page, 'toMugShotsLink');
    await waitVisible(page, 'mugRegion0_0');
    const mug = await page.evaluate(
      ([wanted, rows, columns]) => {
        const find = (id: string) => window.__ja2Ui.widgets.find((w) => w.id === id);
        for (let row = 0; row < rows; row++)
          for (let column = 0; column < columns; column++) {
            const name = find(`mugName${row}_${column}`)?.text ?? '';
            const away = find(`mugOverlay${row}_${column}`)?.text ?? '';
            if (name && !away && name === wanted) return { region: `mugRegion${row}_${column}`, name };
          }
        return null;
      },
      [nickname, MUG_ROWS, MUG_COLUMNS] as const,
    );
    if (!mug) throw new Error(`no available mug shot of ${nickname}`);
    await clickWidget(page, mug.region);
    await clickVisible(page, 'aimContact');
    await clickVisible(page, 'hire');
    await clickVisible(page, 'transferFunds');
    await waitVisible(page, 'popupOk');
    const popup = (await widgets(page)).find((w) => w.id === 'popupTexts')?.text ?? '';
    await clickWidget(page, 'popupOk');
    await page
      .waitForFunction(() => window.__ja2Ui.modal === 'messageBox', null, { timeout: HIRE_TIMEOUT_MS })
      .catch(() => {
        throw new Error(`no arrival box after the hire; the popup said "${popup}"`);
      });
    await clickWidget(page, 'messageBox.ok');
    await modalIs(page, null);
    const team = (await this.game.observe(this.session)).laptop?.aim.filter((m) => m.face === 'hired') ?? [];
    expect(team).toHaveLength(1);
    return mug.name;
  }

  async hireThroughApi(count: number): Promise<number> {
    const aim = (await this.game.observe(this.session)).laptop?.aim ?? [];
    const available = aim.filter((m) => m.face === 'available').map((m) => m.profile);
    const order = [
      ...HIRE_PREFERENCE.filter((p) => available.includes(p)),
      ...available.filter((p) => !HIRE_PREFERENCE.includes(p as never)),
    ];
    let hired = 0;
    for (const profile of order) {
      if (hired >= count) break;
      const result = await this.game.act(this.session, { type: 'aimHire', profile, contract: API_HIRE_CONTRACT_DAYS, gear: true });
      if (result.ok) hired++;
    }
    return hired;
  }

  async land(): Promise<void> {
    const page = this.page;
    await clickVisible(page, 'powerButton');
    await mapReady(page);
    expect(await page.evaluate(() => window.__ja2Ui.map?.screen?.flow)).toBe('strategic');
    await clickWidget(page, 'compressMore');
    await tacticalReady(page);
    const view = await this.game.observe(this.session);
    expect(view.strategic?.flow).toBe('tactical');
    expect(view.soldiers.filter((s) => s.team === OUR_TEAM).length).toBeGreaterThan(0);
  }

  async ourMerc(): Promise<{ readonly id: number; readonly gridNo: number }> {
    const merc = await this.page.evaluate(() => window.__ja2Ui.tactical?.soldiers().find((s) => s.team === 0) ?? null);
    if (!merc) throw new Error('no merc of ours in view');
    return merc;
  }

  async checkHud(): Promise<void> {
    const page = this.page;
    const hook = await page.evaluate(() => window.__ja2Ui.tactical);
    expect(hook?.panel).toBe('team');
    expect(hook?.faces.length).toBeGreaterThan(0);
    expect(hook?.slots.some((s) => s !== null)).toBe(true);
    expect(hook?.drawnSoldiers).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__ja2Ui.draw?.missingImages ?? [])).toEqual([]);
    for (const id of ['teamFaceRegion0', 'teamMapScreen', 'teamEndTurn', 'teamSquad'])
      expect(
        (await widgets(page)).some((w) => w.id === id && w.visible),
        id,
      ).toBe(true);
  }

  async cursorsInRealTime(): Promise<void> {
    const page = this.page;
    const merc = await this.ourMerc();
    await warmTacticalHints(page, { type: 'previewMove', soldier: merc.id, to: merc.gridNo + 2, mode: 'walk', level: 0 });
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.uiMode)).toBe('MOVE_MODE');
    expect(await hoverTiles(page, merc.gridNo, REAL_TIME_STEPS)).toBeGreaterThan(0);
    await this.settleTacticalShadow();
  }

  async player(): Promise<Player> {
    this.#player ??= new Player(this.game, this.session, await loadItems(), () => {});
    return this.#player;
  }

  async approach(): Promise<BattleResult> {
    const player = await this.player();
    const result = await fightHere(player, { done: (view: Observation) => ourTurn(view) && hostilesInSight(player, view).length > 0 });
    await showLatest(this.page);
    return result;
  }

  async cursorsInCombat(): Promise<void> {
    const page = this.page;
    await page.waitForFunction(() => window.__ja2Ui.tactical?.topMessage === 'playerTurn', null, { timeout: LOAD_TIMEOUT_MS });
    await clickWidget(page, 'teamFaceRegion0');
    const selected = await page.evaluate(() => window.__ja2Ui.tactical?.selected ?? null);
    expect(selected).not.toBeNull();
    const merc = (await page.evaluate(() => window.__ja2Ui.tactical?.soldiers() ?? [])).find((s) => s.id === selected);
    if (!merc) throw new Error('the selected merc is not in view');
    await page.evaluate((g) => window.__ja2Ui.tactical?.centerOn(g), merc.gridNo);
    await nextFrames(page, 2);
    expect(await hoverTiles(page, merc.gridNo, COMBAT_STEPS)).toBeGreaterThan(0);
    await this.settleTacticalShadow();
    const face = (await widgets(page)).find((w) => w.id === 'teamFaceRegion0');
    if (!face) throw new Error('no face');
    await clickAt(page, face.rect.x + Math.floor(face.rect.width / 2), face.rect.y + Math.floor(face.rect.height / 2), 'right');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.panel === 'sm');
    expect((await widgets(page)).some((w) => w.id === 'slot5' && w.visible)).toBe(true);
    await page.keyboard.press('Backquote');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.panel === 'team');
  }

  async aimedShot(): Promise<boolean> {
    const page = this.page;
    const enemy = (await page.evaluate(() => window.__ja2Ui.tactical?.soldiers() ?? [])).find((s) => s.team !== OUR_TEAM);
    if (!enemy) return false;
    await page.evaluate((g) => window.__ja2Ui.tactical?.centerOn(g), enemy.gridNo);
    await nextFrames(page, 2);
    const at = await soldierPoint(page, enemy.id);
    await pointAt(page, at.x, at.y - AIM_ABOVE_FEET);
    await page.waitForFunction(() => window.__ja2Ui.tactical?.uiMode === 'CONFIRM_ACTION_MODE', null, { timeout: CURSOR_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.uiCursor)).toMatch(/^ACTION_/);
    expect(await page.evaluate(() => window.__ja2Ui.cursor?.visible)).toBe(true);
    await this.settleTacticalShadow();
    await page.waitForFunction(() => window.__ja2Ui.tactical?.feedback === null, null, { timeout: CURSOR_TIMEOUT_MS });
    await clickAt(page, at.x, at.y - AIM_ABOVE_FEET);
    await page.waitForFunction(() => window.__ja2Ui.tactical?.commands.at(-1)?.type === 'attack', null, { timeout: CURSOR_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__ja2Ui.tactical?.commands.at(-1))).toEqual({ type: 'attack', ok: true, reason: null });
    return true;
  }

  async win(): Promise<BattleResult> {
    const result = await fightHere(await this.player());
    await showLatest(this.page);
    return result;
  }

  async settleTacticalShadow(): Promise<void> {
    await waitShadowSettled(this.page, 'tactical');
    this.shadow.tactical = Math.max(this.shadow.tactical, expectNoShadowDifference((await shadowStats(this.page)).tactical, 'tactical'));
  }

  async settleMapShadow(): Promise<void> {
    await waitShadowSettled(this.page, 'map');
    this.shadow.map = Math.max(this.shadow.map, expectNoShadowDifference((await shadowStats(this.page)).map, 'map'));
  }

  async closeConversation(): Promise<void> {
    const page = this.page;
    await this.game.advance(this.session, { idle: true });
    await showLatest(page);
    if (!(await this.game.observe(this.session)).conversation) return;
    await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.open === true && window.__ja2Ui.tactical.talk.busy === false);
    await clickWidget(page, 'talkDone');
    await page.waitForFunction(() => window.__ja2Ui.tactical?.talk.open === false);
  }

  async mapScreen(): Promise<void> {
    const page = this.page;
    await this.closeConversation();
    await page.waitForFunction(() => {
      const talk = window.__ja2Ui.tactical?.talk;
      return talk !== undefined && !talk.busy && talk.line === null && talk.queued === 0;
    });
    await page.waitForFunction(() => window.__ja2Ui.widgets.some((w) => w.id === 'teamMapScreen' && w.visible && w.enabled));
    await clickWidget(page, 'teamMapScreen');
    await page.waitForFunction(() => window.__ja2Ui.lastCommand === 'mapScreen');
    expect(await page.evaluate(() => window.__ja2Ui.lastResult)).toMatchObject({ ok: true });
    await mapReady(page);
    expect(await this.page.evaluate(() => window.__ja2Ui.map?.screen?.flow)).toBe('strategic');
  }

  async plotRoute(sector: string): Promise<number> {
    const page = this.page;
    const row = await page.evaluate(([r, c]) => window.__ja2Ui.map?.rowPoint(r, c) ?? null, [FIRST_ROW, DESTINATION_COLUMN] as const);
    if (!row) throw new Error('no first row in the character list');
    await clickAt(page, row.x, row.y);
    await page.waitForFunction(() => window.__ja2Ui.map?.screen?.plotting?.mode === 'merc');
    const soldier = (await page.evaluate(() => window.__ja2Ui.map?.screen?.plotting?.soldier)) ?? -1;
    const target = await page.evaluate((s) => window.__ja2Ui.map?.sectorPoint(s) ?? null, sector);
    if (!target) throw new Error(`no sector ${sector} on the map`);
    const before = await page.evaluate(() => window.__ja2Ui.map?.hints.stats.local ?? 0);
    await pointAt(page, target.x, target.y);
    await page.waitForFunction((n) => (window.__ja2Ui.map?.hints.stats.local ?? 0) > n, before, { timeout: HINT_TIMEOUT_MS });
    await clickAt(page, target.x, target.y);
    await page.waitForFunction((s) => window.__ja2Ui.map?.screen?.plotting?.legs.at(-1) === s, sector);
    await clickAt(page, target.x, target.y);
    await page.waitForFunction(() => window.__ja2Ui.map?.commands.at(-1)?.type === 'route', null, { timeout: HINT_TIMEOUT_MS });
    expect(await page.evaluate(() => window.__ja2Ui.map?.commands.at(-1))).toEqual({ type: 'route', ok: true, reason: null });
    expect(await page.evaluate(() => window.__ja2Ui.map?.screen?.plotting ?? null)).toBeNull();
    await this.settleMapShadow();
    return soldier;
  }

  async saveGame(description: string): Promise<void> {
    const page = this.page;
    await clickWidget(page, 'optionsButton');
    await screenIs(page, 'options');
    expect((await widgets(page)).find((w) => w.id === 'saveGame')?.enabled).toBe(true);
    await clickWidget(page, 'saveGame');
    await screenIs(page, 'saveLoad');
    await clickWidget(page, 'row0');
    await page.keyboard.type(description);
    await page.waitForFunction(([id, text]) => window.__ja2Ui.widgets.some((w) => w.id === id && w.text === text), [
      SAVE_DESCRIPTION_FIELD,
      description,
    ] as const);
    await clickWidget(page, 'saveButton');
    await mapReady(page);
  }

  async loadGame(description: string): Promise<void> {
    const page = this.page;
    await clickWidget(page, 'optionsButton');
    await screenIs(page, 'options');
    await clickWidget(page, 'loadGame');
    await screenIs(page, 'saveLoad');
    const row = (await widgets(page)).find((w) => w.id.startsWith('description') && w.text === description);
    if (!row) throw new Error(`no save row "${description}"`);
    await clickWidget(page, row.id.replace('description', 'row'));
    await clickWidget(page, 'loadButton');
    await mapReady(page);
    expect(await page.evaluate(() => window.__ja2Ui.session)).toBe(this.session);
  }

  async state(): Promise<unknown> {
    return this.page.evaluate(() => {
      const ui = window.__ja2Ui;
      const t = ui.tactical;
      return {
        screen: ui.screen,
        modal: ui.modal,
        lagTicks: ui.lagTicks,
        tactical: t
          ? {
              mode: t.uiMode,
              lock: t.uiLock,
              top: t.topMessage,
              panel: t.panel,
              talk: t.talk,
              commands: t.commands.slice(-5),
              feedback: t.feedback,
              cursorItem: t.cursorItem,
              pickupOpen: t.pickupOpen,
              mapButton: ui.widgets.find((w) => w.id === 'teamMapScreen') ?? null,
            }
          : null,
        map: ui.map
          ? { ready: ui.map.ready, error: ui.map.error, commands: ui.map.commands.slice(-5), prompt: ui.map.screen?.prompt }
          : null,
        widgets: ui.widgets.filter((w) => w.visible && w.enabled && w.id.includes('.')).map((w) => w.id),
      };
    });
  }

  async savedNamed(description: string): Promise<string | null> {
    const saves = (await this.page.request.get('/api/saves').then((r) => r.json())) as {
      name: string;
      header?: { description?: string };
    }[];
    return saves.find((s) => s.header?.description === description)?.name ?? null;
  }
}
