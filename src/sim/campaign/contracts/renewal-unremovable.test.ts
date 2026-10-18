import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { createContractCampaign } from '../../../../tests/support/contracts.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { CompressMode } from '../../strategic/time/constants.ts';
import { isTimeBeingCompressed } from '../../strategic/time/world-clock.ts';
import type { CampaignSim } from '../campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const KESTREL = 0;
const MORAGA = 2;
const STEPS = 400_000;
const PROMPT_ROUNDS = 6;

function untilRenewalPrompt(c: CampaignSim): void {
  for (let guard = 0; guard < 2000 && !c.hasPendingDecision(); guard++) {
    if (!isTimeBeingCompressed(c.state.clock)) c.dispatch({ type: 'compressTime', mode: CompressMode.MIN60 });
    for (let i = 0; i < STEPS && !c.hasPendingDecision() && isTimeBeingCompressed(c.state.clock); i++) c.step();
  }
}

function renewalPromptsWithCapturedMerc(): (number | undefined)[] {
  const { campaign: c, roster } = createContractCampaign(kit, {
    seed: 21,
    hires: [
      { profile: KESTREL, length: 1 },
      { profile: MORAGA, length: 1 },
    ],
  });
  landFirstSquad(c);
  for (let i = 0; i < 20_000 && !c.isIdle(); i++) c.step();
  expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  untilRenewalPrompt(c);
  const first = c.state.battle.prompt;
  expect(first).toMatchObject({ kind: 'contractRenewal', soldier: 0, fromSequence: true });
  roster.changeAssignment(0, Assignment.ASSIGNMENT_POW);
  const prompts: (number | undefined)[] = [];
  for (let round = 0; round < PROMPT_ROUNDS; round++) {
    const prompt = c.state.battle.prompt;
    if (prompt?.kind !== 'contractRenewal') break;
    prompts.push(prompt.soldier);
    expect(c.dispatch({ type: 'answer', prompt: prompt.id, choice: 'letGo' }).ok).toBe(true);
    for (let i = 0; i < 50; i++) c.step();
  }
  return prompts;
}

describe('a renewal sequence whose merc was captured before his turn', () => {
  it('goes on to the next merc once his prompt is answered instead of asking again', () => {
    expect(renewalPromptsWithCapturedMerc().slice(0, 2)).toEqual([0, 1]);
  });
});
