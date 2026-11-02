import { describe, expect, it } from 'vitest';
import { KEY_TEXT } from '../../../../tests/support/map-screen.ts';
import type { StrategicView } from '../../../protocol/view.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';
import { departureBox, type PromptContext, promptBox } from './map-prompts.ts';

const SOLDIER = 7;

function context(female: boolean): PromptContext {
  const strategic = { mercs: [{ id: SOLDIER, name: 'Ivan', ...(female ? { female } : {}) }] } as unknown as StrategicView;
  return { text: KEY_TEXT, strategic, sectorName: (label) => label, townOf: () => 0 };
}

function departure(choices: readonly string[], elsewhereSector: string | null) {
  return { soldier: SOLDIER, name: 'Ivan', sector: 'B13', choices, elsewhereSector };
}

describe("the departing merc's equipment box (NotifyPlayerOfMercDepartureAndPromptEquipmentPlacement)", () => {
  it("asks where a woman leaves her equipment with the she-form and a man's with the he-form", () => {
    const where = departure(['here', 'elsewhere'], 'A9');
    expect(departureBox(context(false), where).text).toBe('str_he_leaves_where_drop_equipment[0]');
    expect(departureBox(context(true), where).text).toBe('str_she_leaves_where_drop_equipment[0]');
  });

  it('tells where she drops it with the she-form when there is no choice', () => {
    const here = departure(['here'], null);
    expect(departureBox(context(false), here).text).toBe('str_he_leaves_drops_equipment[0]');
    expect(departureBox(context(true), here).text).toBe('str_she_leaves_drops_equipment[0]');
  });
});

describe('the surrender box (ShutDownQuoteBox, SurrenderMessageBoxCallBack)', () => {
  it('asks Message[STR_SURRENDER] for an offer in tactical and answers accept or reject', () => {
    const box = promptBox(context(false), { id: 'p', kind: 'surrender', context: 'tactical', soldier: 20, choices: ['accept', 'reject'] });
    expect(box?.text).toBe('Message[54]');
    expect([box?.answer(MessageBoxReturn.YES), box?.answer(MessageBoxReturn.NO)]).toEqual(['accept', 'reject']);
  });

  it('answers the autoresolve offer with accept or reject too', () => {
    const box = promptBox(context(false), { id: 'p', kind: 'surrender', context: 'autoresolve', choices: ['accept', 'reject'] });
    expect(box?.text).toBe('gpStrategicString[3]');
    expect([box?.answer(MessageBoxReturn.YES), box?.answer(MessageBoxReturn.NO)]).toEqual(['accept', 'reject']);
  });
});
