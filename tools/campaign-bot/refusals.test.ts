import { describe, expect, it } from 'vitest';
import type { ItemTable } from '../../src/content/items/items.ts';
import type { StrategicMercView } from '../../src/protocol/view.ts';
import { CampaignBot } from './campaign.ts';
import { gridNo, tiles } from './grid.ts';
import type { ActResult, AdvanceRequest, Command, Game, Observation } from './mcp-game.ts';
import { descend } from './palace.ts';
import { Player } from './player.ts';
import { Palace } from './stub-world.ts';
import { enter, mapScreen, travel } from './travel.ts';

interface Table {
  view(): unknown;
  act(command: Command): ActResult;
  advance?(request: AdvanceRequest): void;
}

const ACCEPTED: ActResult = { ok: true };
const NO_ITEMS = { byName: new Map(), byIndex: new Map() } as unknown as ItemTable;
const TOO_TIRED_TO_TRAVEL = 30;
const RESTED = 80;
const SOUTH_OF_THE_STAIRS_ROOM = gridNo(66, 80);

function refusedWith(refusal: string): ActResult {
  return { ok: false, reason: `${refusal}: refused`, data: { refusal } };
}

function unused(): never {
  throw new Error('not used by these tests');
}

function playerAt(table: Table, trail: string[], lines: string[] = []): Player {
  const game: Game = {
    calls: 0,
    newSession: unused,
    status: unused,
    observe: async () => table.view() as Observation,
    act: async (_session, command) => {
      trail.push(command.type);
      return table.act(command);
    },
    advance: async (_session, request) => {
      trail.push(`advance ${Object.keys(request).join('+')}`);
      table.advance?.(request);
      return { tick: 0, reason: 'idle', events: [] };
    },
    save: unused,
    load: unused,
    deleteSave: unused,
    close: async () => {},
  };
  return new Player(game, 'session', NO_ITEMS, (line) => lines.push(line));
}

function screen(flow: string, extra: Record<string, unknown> = {}, mercs: readonly StrategicMercView[] = []): unknown {
  return { soldiers: [], strategic: { flow, mercs, groups: [], sectors: [] }, ...extra };
}

interface PalaceGrounds {
  sector: string;
  lead: number;
  stairsSeen: boolean;
}

function palace(grounds: PalaceGrounds): unknown {
  const lead = { id: 0, name: 'Ivan', team: 0, life: 80, gridNo: grounds.lead, level: 0 };
  return { soldiers: [lead], strategic: { flow: 'tactical', worldSector: grounds.sector, mercs: [], groups: [], sectors: [] } };
}

function palaceStairs(grounds: PalaceGrounds, seenFromBeside: boolean): Table {
  return {
    view: () => palace(grounds),
    act: (command) => {
      if (command.type === 'move') {
        grounds.lead = command.to as number;
        grounds.stairsSeen = seenFromBeside && tiles(grounds.lead, Palace.stairsDown) <= 1;
      }
      if (command.type !== 'exitSector') return ACCEPTED;
      if (!grounds.stairsSeen) return refusedWith('notRevealed');
      grounds.sector = Palace.basement;
      return ACCEPTED;
    },
  };
}

function merc(fields: Partial<StrategicMercView>): StrategicMercView {
  return {
    id: 0,
    name: 'Ivan',
    sector: 'A13',
    betweenSectors: false,
    squad: 0,
    assignment: 0,
    life: 80,
    lifeMax: 80,
    breath: 100,
    breathMax: 100,
    asleep: false,
    ...fields,
  };
}

describe('the campaign bot answers the refusals that name the next step', () => {
  it('stops time and waits out the queued lines before it enters a sector', async () => {
    const map = { compressing: true, linesQueued: true };
    const trail: string[] = [];
    const p = playerAt(
      {
        view: () => screen('strategic', { clock: { compressing: map.compressing } }),
        act: (command) => {
          if (command.type === 'stopTime') map.compressing = false;
          if (command.type === 'enterSector' && map.linesQueued) return refusedWith('dialogueQueued');
          return ACCEPTED;
        },
        advance: (request) => {
          if (request.idle && !map.compressing) map.linesQueued = false;
        },
      },
      trail,
    );
    expect(await enter(p, 'B13')).toBe(true);
    expect(trail).toEqual(['enterSector', 'stopTime', 'advance idle', 'enterSector', 'advance idle']);
  });

  it('answers the open prompt before it opens the map', async () => {
    const tactical = { flow: 'tactical', prompt: { id: 'p1', kind: 'autoresolveDone' } as unknown };
    const trail: string[] = [];
    const p = playerAt(
      {
        view: () => screen(tactical.flow, { prompt: tactical.prompt }),
        act: (command) => {
          if (command.type === 'answer') tactical.prompt = undefined;
          if (command.type !== 'mapScreen') return ACCEPTED;
          if (tactical.prompt) return refusedWith('promptOpen');
          tactical.flow = 'strategic';
          return ACCEPTED;
        },
      },
      trail,
    );
    expect(await mapScreen(p)).toBe(true);
    expect(trail).toEqual(['mapScreen', 'answer', 'mapScreen']);
  });

  it('lets a meanwhile scene start before it opens the laptop', async () => {
    const map = { meanwhileStarting: true };
    const trail: string[] = [];
    const p = playerAt(
      {
        view: () => screen('strategic'),
        act: (command) => (command.type === 'openLaptop' && map.meanwhileStarting ? refusedWith('meanwhileStarting') : ACCEPTED),
        advance: () => {
          map.meanwhileStarting = false;
        },
      },
      trail,
    );
    expect(await new CampaignBot(p).laptop(async () => 'read')).toBe('read');
    expect(trail).toEqual(['openLaptop', 'stopTime', 'advance idle', 'openLaptop', 'closeLaptop']);
  });

  it('gives up on a refusal that names no next step', async () => {
    const trail: string[] = [];
    const p = playerAt({ view: () => screen('strategic'), act: () => refusedWith('noMercThere') }, trail);
    expect(await enter(p, 'B13')).toBe(false);
    expect(trail).toEqual(['enterSector']);
  });

  it('rests a squad too tired to travel in its sector, then routes it again', async () => {
    const ivan = { sector: 'A13', betweenSectors: false, breathMax: TOO_TIRED_TO_TRAVEL - 5 };
    const trail: string[] = [];
    const rested: string[] = [];
    const p = playerAt(
      {
        view: () => screen('strategic', {}, [merc(ivan)]),
        act: (command) => {
          if (command.type !== 'route') return ACCEPTED;
          if (ivan.breathMax < TOO_TIRED_TO_TRAVEL) return refusedWith('tooTired');
          ivan.betweenSectors = true;
          return ACCEPTED;
        },
        advance: () => {
          if (ivan.betweenSectors) Object.assign(ivan, { sector: 'B13', betweenSectors: false });
        },
      },
      trail,
    );
    const rest = async (sector: string) => {
      rested.push(sector);
      ivan.breathMax = RESTED;
    };
    expect(await travel(p, 'B13', async () => 'won', rest)).toBe('arrived');
    expect(rested).toEqual(['A13']);
    expect(trail).toEqual(['route', 'route', 'advance worldSeconds']);
  });

  it('walks the lead beside the palace stairs when no merc has seen them yet, then takes them down', async () => {
    const grounds = { sector: Palace.sector, lead: SOUTH_OF_THE_STAIRS_ROOM, stairsSeen: false };
    const trail: string[] = [];
    const p = playerAt(palaceStairs(grounds, true), trail);
    expect(await descend(p)).toBe(true);
    expect(grounds.lead).toBe(gridNo(66, 75));
    expect(trail).toEqual(['exitSector', 'move', 'advance idle+ticks', 'exitSector', 'advance idle+ticks+events', 'advance idle+ticks']);
  });

  it('gives up on the palace stairs after a few walks that never reveal them', async () => {
    const grounds = { sector: Palace.sector, lead: SOUTH_OF_THE_STAIRS_ROOM, stairsSeen: false };
    const trail: string[] = [];
    const lines: string[] = [];
    const p = playerAt(palaceStairs(grounds, false), trail, lines);
    expect(await descend(p)).toBe(false);
    expect(trail.filter((step) => step === 'exitSector')).toHaveLength(4);
    expect(trail.filter((step) => step === 'move')).toHaveLength(3);
    expect(lines.at(-1)).toBe('  the stairs down are refused: notRevealed: refused');
  });
});
