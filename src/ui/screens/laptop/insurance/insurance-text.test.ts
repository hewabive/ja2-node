import { describe, expect, it } from 'vitest';
import type { InsuranceOfferView } from '../../../../protocol/view.ts';
import { InfoSubPagesVisited, insuranceCard } from './insurance-pages.ts';
import {
  contractStatus,
  displayedGrids,
  INSURANCE_MULTI_FILE,
  INSURANCE_SINGLE_FILE,
  InsuranceText,
  insuranceTextRow,
  nextGridIndex,
  nextGridsEnabled,
  previousGridIndex,
  previousGridsEnabled,
} from './insurance-text.ts';

const OFFER: InsuranceOfferView = {
  soldier: 3,
  profile: 7,
  name: 'Seven',
  contractDaysLeft: 6,
  insuredDaysLeft: 0,
  insured: false,
  offeredLength: 5,
  premium: 1234,
  nickname: 'Sev',
  dead: false,
  contractLength: 7,
};

describe('the insurance texts', () => {
  it('reads single-line texts from insurancesingle.edt and the rest one row below their number less the boundary', () => {
    expect(insuranceTextRow(InsuranceText.FRAUD)).toEqual({ file: INSURANCE_SINGLE_FILE, row: 16 });
    expect(insuranceTextRow(31)).toEqual({ file: INSURANCE_MULTI_FILE, row: 0 });
    expect(insuranceTextRow(InsuranceText.ONE_HOUR_EXCLUSION_B)).toEqual({ file: INSURANCE_MULTI_FILE, row: 35 });
  });

  it('picks the contract status text and its colour as DisplayOrderGrid', () => {
    expect(contractStatus({ dead: true, insured: true, offeredLength: 0 })).toEqual({ text: InsuranceText.DEAD_WITH_CONTRACT, red: true });
    expect(contractStatus({ dead: true, insured: false, offeredLength: 0 })).toEqual({ text: InsuranceText.DEAD_NO_CONTRACT, red: true });
    expect(contractStatus({ dead: false, insured: false, offeredLength: 4 })).toEqual({ text: InsuranceText.NOCONTRACT, red: true });
    expect(contractStatus({ dead: false, insured: true, offeredLength: 2 })).toEqual({ text: InsuranceText.PARTIALLY_INSURED, red: true });
    expect(contractStatus({ dead: false, insured: true, offeredLength: 0 })).toEqual({ text: InsuranceText.CONTRACT, red: false });
  });

  it('shows three grids a page and pages by three with the original enable rules', () => {
    expect(displayedGrids(7, 0)).toBe(3);
    expect(displayedGrids(7, 6)).toBe(1);
    expect(displayedGrids(2, 3)).toBe(0);
    expect(nextGridsEnabled(7, 3)).toBe(true);
    expect(nextGridsEnabled(6, 3)).toBe(false);
    expect(previousGridsEnabled(2)).toBe(false);
    expect(previousGridsEnabled(3)).toBe(true);
    expect(previousGridIndex(2)).toBe(2);
    expect(previousGridIndex(3)).toBe(0);
    expect(nextGridIndex(3)).toBe(6);
  });

  it('fills a card: n/a and $0 for the dead, 0 insured days without a policy, the premium only while a length is offered', () => {
    const text = (n: number) => `t${n}`;
    expect(insuranceCard(OFFER, 9, text, 'n/a')).toMatchObject({
      face: 9,
      state: 'normal',
      nickname: 'Sev',
      status: `t${InsuranceText.NOCONTRACT}`,
      statusColor: 'red',
      contractLength: '7',
      contractDays: '6',
      insuredDays: '0',
      premium: '$1,234',
      offeredLength: '5',
      canAccept: true,
    });
    expect(insuranceCard({ ...OFFER, insured: true, insuredDaysLeft: 5, offeredLength: 0 }, 9, text, 'n/a')).toMatchObject({
      insuredDays: '5',
      premium: '$0',
      canAccept: false,
      statusColor: 'normal',
    });
    expect(insuranceCard({ ...OFFER, dead: true, offeredLength: 0 }, 9, text, 'n/a')).toMatchObject({
      state: 'dead',
      contractDays: 'n/a',
      insuredDays: 'n/a',
      premium: '$0',
    });
  });

  it('forgets the first four visited info sub-pages with every laptop session but not the last one', () => {
    const game = new Set<number>();
    const first = new InfoSubPagesVisited(new Set(), game);
    expect([first.visit(1), first.visit(1), first.visit(4)]).toEqual([false, true, false]);
    const second = new InfoSubPagesVisited(new Set(), game);
    expect([second.visit(1), second.visit(4)]).toEqual([false, true]);
  });
});
