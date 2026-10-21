import { describe, expect, it } from 'vitest';
import { testRuntime, uniformImage } from '../../../../tests/support/ui-runtime.ts';
import type { StrategicMercView, ViewFrame } from '../../../protocol/view.ts';
import { DrawList } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';
import { FontName } from '../../text/fonts.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { Assignment } from './character-list.ts';
import { UpdateBox, UpdateQueue, UpdateReason, updatePanelGeometry } from './update-box.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];

const STRINGS: Readonly<Record<string, readonly string[]>> = {
  pUpdateMercStrings: [
    'Oops:',
    'Mercs Contract Expired:',
    'Mercs Completed Assignment:',
    'Mercs Back on the Job:',
    "Mercs Catching Some Z's:",
    'Contracts Expiring Soon:',
  ],
  pUpdatePanelButtons: ['Continue', 'Stop'],
};
const TEXT: UiTextService = { string: (table, index) => STRINGS[table]?.[index] ?? null, edt: () => null };
const PANEL = 'interface/group_confirm_tactical.sti';
const FACES = 'interface/panels.sti';

function merc(id: number, over: Partial<StrategicMercView> = {}): StrategicMercView {
  return {
    id,
    name: `M${id}`,
    assignment: Assignment.DOCTOR,
    squad: null,
    life: 60,
    lifeMax: 80,
    breath: 90,
    breathMax: 90,
    morale: 50,
    ...over,
  } as unknown as StrategicMercView;
}

describe('the update box queue', () => {
  const mercs = [merc(1), merc(2, { assignment: 0, squad: 0 }), merc(3, { life: 0 }), merc(4)];

  it('collects one box per frame with the reason set last', () => {
    const queue = new UpdateQueue();
    const events: FrameEvent[] = [
      { type: 'assignmentDone', soldier: 1, sayQuote: false } as FrameEvent,
      { type: 'fellAsleep', soldier: 4, collapsed: false } as FrameEvent,
    ];
    queue.observe(events, mercs, true);
    expect(queue.next()).toEqual({ reason: UpdateReason.ASLEEP_GOING_AUTO, soldiers: [1, 4] });
    expect(queue.next()).toBeNull();
  });

  it('leaves out the dead, collapses, squad mercs who wake up and sleep notices when they are off', () => {
    const queue = new UpdateQueue();
    queue.observe([{ type: 'assignmentDone', soldier: 3, sayQuote: false } as FrameEvent], mercs, true);
    queue.observe([{ type: 'fellAsleep', soldier: 1, collapsed: true } as FrameEvent], mercs, true);
    queue.observe([{ type: 'wokeUp', soldier: 2 } as FrameEvent], mercs, true);
    queue.observe([{ type: 'wokeUp', soldier: 1 } as FrameEvent], mercs, false);
    expect(queue.pending).toBe(0);
    queue.observe([{ type: 'wokeUp', soldier: 1 } as FrameEvent], mercs, true);
    expect(queue.next()).toEqual({ reason: UpdateReason.ASSIGNMENT_RETURNING, soldiers: [1] });
  });

  it('warns about contracts expiring soon', () => {
    const queue = new UpdateQueue();
    queue.observe([{ type: 'contractsExpiringSoon', soldiers: [4, 1] } as unknown as FrameEvent], mercs, true);
    expect(queue.next()).toEqual({ reason: UpdateReason.CONTRACT_EXPIRE_WARNING, soldiers: [4, 1] });
  });
});

describe('the update panel', () => {
  it('is two faces wide up to four mercs and four wide above, its bottom 280 pixels down the map', () => {
    expect(updatePanelGeometry(1, { x: 0, y: 0 })).toEqual({
      fourWide: false,
      wide: 2,
      high: 1,
      cells: 2,
      x: 388,
      y: 182,
      width: 140,
      height: 98,
    });
    expect(updatePanelGeometry(5, { x: 0, y: 0 })).toEqual({
      fourWide: true,
      wide: 4,
      high: 2,
      cells: 8,
      x: 318,
      y: 133,
      width: 280,
      height: 147,
    });
  });

  async function harness(soldiers: readonly StrategicMercView[]) {
    const t = await testRuntime();
    t.images.set(PANEL, uniformImage(21, 70, 15));
    t.images.set(FACES, uniformImage(2, 47, 31));
    const finished: (boolean | null)[] = [];
    let beeps = 0;
    const box = new UpdateBox({
      services: t.runtime,
      text: TEXT,
      origin: () => ({ x: 0, y: 0 }),
      mapFont: () => t.fonts.get(FontName.BLOCKFONT2),
      panel: PANEL,
      faces: FACES,
      merc: (id) => soldiers.find((m) => m.id === id) ?? null,
      face: (id) => `faces/65face/0${id}.sti`,
      ensure: () => true,
      beep: () => beeps++,
      finished: (c) => finished.push(c),
    });
    return { t, box, finished, beeps: () => beeps };
  }

  it('shows the faces, the reason and the two buttons, beeps, and continues time compression', async () => {
    const h = await harness([merc(1), merc(2)]);
    expect(h.box.show({ reason: UpdateReason.ASSIGNMENT_FINISHED, soldiers: [1, 2] })).toBe(true);
    expect(h.beeps()).toBe(1);
    const list = new DrawList();
    h.box.render(list);
    const images = list.items.flatMap((i) => (i.kind === 'image' ? [`${i.asset}#${i.frame}@${i.x},${i.y}`] : []));
    expect(images).toContain('faces/65face/01.sti#0@398,204');
    expect(images).toContain('faces/65face/02.sti#0@468,204');
    expect(images).toContain(`${PANEL}#19@384,248`);
    const widgets = h.box.describe();
    expect(widgets[0]?.text).toBe('Mercs Completed Assignment:');
    const continueButton = widgets.find((w) => w.id === 'updateBox.continue');
    expect(continueButton?.rect).toMatchObject({ x: 388, y: 262 });
    h.t.click((continueButton?.rect.x ?? 0) + 5, (continueButton?.rect.y ?? 0) + 5);
    expect(h.finished).toEqual([true]);
    expect(h.box.open).toBe(false);
  });

  it('stops time compression with Stop and closes on a right click without changing it', async () => {
    const h = await harness([merc(1)]);
    h.box.show({ reason: UpdateReason.ASSIGNMENT_FINISHED, soldiers: [1] });
    const stop = h.box.describe().find((w) => w.id === 'updateBox.stop');
    h.t.click((stop?.rect.x ?? 0) + 5, (stop?.rect.y ?? 0) + 5);
    h.box.show({ reason: UpdateReason.ASSIGNMENT_FINISHED, soldiers: [1] });
    h.t.click(5, 5, MouseButton.RIGHT);
    expect(h.finished).toEqual([false, null]);
  });

  it('does not open for the dead', async () => {
    const h = await harness([merc(1, { life: 0 })]);
    expect(h.box.show({ reason: UpdateReason.ASSIGNMENT_FINISHED, soldiers: [1] })).toBe(false);
    expect(h.box.open).toBe(false);
  });
});
