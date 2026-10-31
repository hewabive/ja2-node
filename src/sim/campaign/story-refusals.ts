import type { CommandResult } from '../command.ts';
import { refuse } from '../tactical/refusal.ts';
import type { CampaignCommand, CampaignSim } from './campaign-sim.ts';
import { campaignStatus } from './ending-state.ts';

export const StoryRefusal = {
  IN_MEANWHILE: 'inMeanwhile',
  ENDGAME: 'endgameInProgress',
  CAMPAIGN_OVER: 'campaignOver',
} as const;

const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  [StoryRefusal.IN_MEANWHILE]: 'the interrogation scene is running: advance it and answer its prompt',
  [StoryRefusal.ENDGAME]: 'the end of the campaign is playing: advance until it finishes',
  [StoryRefusal.CAMPAIGN_OVER]: 'the campaign is won and over: observe still works, start a new game with newSession',
};

const QUERY_COMMANDS: ReadonlySet<string> = new Set([
  'estimateAttack',
  'quoteTrade',
  'contractOptions',
  'aimQuote',
  'bobbyRayQuote',
  'insuranceQuote',
  'impPreview',
  'arrivalTime',
  'inventory',
]);

function storyRefused(code: string): CommandResult {
  return refuse(code, `${code}: ${REFUSAL_TEXT[code] ?? 'refused'}`);
}

export function storyRefusal(campaign: CampaignSim, cmd: CampaignCommand): CommandResult | null {
  if (campaign.ended()) return storyRefused(StoryRefusal.CAMPAIGN_OVER);
  if (QUERY_COMMANDS.has(cmd.type) || cmd.type === 'answer' || cmd.type === 'skipLine') return null;
  if (campaign.state.meanwhile.inScene) return storyRefused(StoryRefusal.IN_MEANWHILE);
  if (campaignStatus(campaign.state.ending) === 'endgame') return storyRefused(StoryRefusal.ENDGAME);
  return null;
}

export function storyFlow(campaign: CampaignSim): 'meanwhile' | 'endgame' | 'ended' | null {
  if (campaign.ended()) return 'ended';
  if (campaignStatus(campaign.state.ending) === 'endgame') return 'endgame';
  return campaign.state.meanwhile.inScene ? 'meanwhile' : null;
}
