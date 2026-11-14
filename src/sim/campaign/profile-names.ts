// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc NPC_ACTION_TERRORIST_REVEALS_SELF (the profile's zNickname every later
// @src line, screen and record reads).

import type { CampaignSim } from './campaign-sim.ts';

function recordNickname(campaign: CampaignSim, profile: number): string | null {
  return campaign.laptop?.profileRecord(profile)?.nickname ?? campaign.battle?.content.profiles[profile]?.nickname ?? null;
}

export function shownNickname(campaign: CampaignSim, profile: number): string | null {
  return campaign.state.profiles.get(profile)?.nickname ?? recordNickname(campaign, profile);
}

export function nicknameOverrides(campaign: CampaignSim): Readonly<Record<number, string>> {
  const overrides: Record<number, string> = {};
  for (const [profile, progress] of campaign.state.profiles)
    if (progress.nickname !== undefined && progress.nickname !== recordNickname(campaign, profile)) overrides[profile] = progress.nickname;
  return overrides;
}
