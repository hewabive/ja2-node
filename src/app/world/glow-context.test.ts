import { describe, expect, it } from 'vitest';
import type { CombatView, SoldierView } from '../../protocol/view.ts';
import { soldierLook } from '../../render/world/glow.ts';
import { GREY_GLOW_OFFSET, SOLDIER_GLOW_ROWS } from '../../render/world/soldier-palettes.ts';
import { glowContext } from './glow-context.ts';

const BURNING = 99;

function soldier(id: number, team: number, extra: Partial<SoldierView> = {}): SoldierView {
  return {
    id,
    team,
    name: '',
    bodyType: 0,
    gridNo: 0,
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    frame: 0,
    palettes: ['', '', '', ''],
    hand: '',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...extra,
  } as SoldierView;
}

const merc = soldier(0, 0, { sees: [21] });
const seen = soldier(21, 1, { hostile: true });
const unseen = soldier(22, 1, { hostile: true });
const burning = soldier(23, 1, { hostile: true, animation: BURNING });
const enemyTurn: CombatView = { team: 1, round: 1, interrupt: false, uiLocked: true, topMessage: null, ai: null, aiTurn: null };
const PEAK_MS = 2400;

function context(selected: number | null, combat: CombatView | null) {
  return glowContext({
    soldiers: [merc, seen, unseen, burning],
    combat,
    clockMs: PEAK_MS,
    hovered: null,
    selected,
    hostile: (s) => s.hostile === true,
    ungreyed: (s) => s.animation === BURNING,
  });
}

const look = (s: SoldierView, ctx: ReturnType<typeof context>) =>
  soldierLook({ id: s.id, level: 0, hostile: s.hostile === true, nodeShade: 4, fadeShade: null }, ctx);

describe('the glow context from the view', () => {
  it('greys the hostiles the selected merc does not see, except a burning one', () => {
    const ctx = context(merc.id, null);
    expect(ctx.selectedSees(21)).toBe(true);
    expect(ctx.selectedSees(22)).toBe(false);
    expect(ctx.selectedSees(23)).toBe(true);
    expect(look(seen, ctx).row).toBe(SOLDIER_GLOW_ROWS + ctx.frame);
    expect(look(unseen, ctx).row).toBe(SOLDIER_GLOW_ROWS + ctx.frame + GREY_GLOW_OFFSET);
  });

  it('knows nothing without a selected merc and glows only the baton holder the combat view names in the enemy turn', () => {
    expect(context(null, null).selectedSees(22)).toBeNull();
    const ctx = context(merc.id, { ...enemyTurn, aiTurn: 22 });
    expect(ctx.ourTurn).toBe(false);
    expect(look(unseen, ctx).row).toBe(SOLDIER_GLOW_ROWS + ctx.frame);
    expect(look(seen, ctx).topmost).toBe(false);
    expect(look(seen, ctx).row).not.toBe(SOLDIER_GLOW_ROWS + ctx.frame);
  });

  it('glows no hostile in the enemy turn while the view names no baton holder', () => {
    const ctx = context(merc.id, enemyTurn);
    for (const s of [seen, unseen, burning]) expect(look(s, ctx).row).not.toBe(SOLDIER_GLOW_ROWS + ctx.frame);
  });
});
