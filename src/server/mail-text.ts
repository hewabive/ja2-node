// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/EMail.cc LoadEMailText, AddEmailMessage (the subject), ReplaceMercNameAndAmountWithProperData,
// @src HandleMailSpecialMessages, ModifyInsuranceEmails, PreProcessEmail (the body records, the subject skipped),
// @src HandleIMPCharProfileResultsMessage (the I.M.P. report from impass.edt, the profile of the mail or the last
// @src profiled character). See docs/21 §6.1.

import type { TextKey } from '../content/narrative/dialogue-text.ts';
import { mailOffset } from '../content/strategic/laptop-content.ts';
import { sprintMoney } from '../content/text/money.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { impReportRows } from '../sim/campaign/laptop/imp-report.ts';
import type { Email } from '../sim/campaign/laptop/laptop-state.ts';
import { PLAYER_GENERATED_CHARACTER_ID } from '../sim/campaign/laptop/save-import.ts';
import type { TextSource } from './campaign-session.ts';

export const MAIL_TEXT_FILE = 'binarydata/email.edt';
export const IMP_REPORT_FILE = 'binarydata/impass.edt';
export const MAIL_TEXT_FILES: readonly string[] = [MAIL_TEXT_FILE, IMP_REPORT_FILE];
const MAIL_STRING_SIZE = 320;
const MERC_NAME = '$MERCNAME$';
const AMOUNT = '$AMOUN$';
const SUBSTITUTED_MAILS: Readonly<Record<string, string>> = {
  INSUR_PAYMENT: 'INSUR_PAYMENT_LENGTH',
  INSUR_SUSPIC: 'INSUR_PAYMENT_LENGTH',
  INSUR_SUSPIC_2: 'INSUR_PAYMENT_LENGTH',
  INSUR_INVEST_OVER: 'INSUR_PAYMENT_LENGTH',
  INSUR_1HOUR_FRAUD: 'INSUR_1HOUR_FRAUD_LENGTH',
  MERC_DIED_ON_OTHER_ASSIGNMENT: 'MERC_DIED_ON_OTHER_ASSIGNMENT_LENGTH',
  AIM_MEDICAL_DEPOSIT_REFUND: 'AIM_MEDICAL_DEPOSIT_REFUND_LENGTH',
  AIM_MEDICAL_DEPOSIT_NO_REFUND: 'AIM_MEDICAL_DEPOSIT_REFUND_LENGTH',
  AIM_MEDICAL_DEPOSIT_PARTIAL_REFUND: 'AIM_MEDICAL_DEPOSIT_REFUND_LENGTH',
};
const IMP_RESULTS_MAIL = 'IMP_EMAIL_PROFILE_RESULTS';
const IMP_NAME_SEPARATOR = ' ';

export interface EmailText {
  readonly id: number;
  readonly subject: string;
  readonly paragraphs: readonly string[];
}

function mailKey(file: string, row: number): TextKey {
  return { file, row, width: MAIL_STRING_SIZE };
}

function record(texts: TextSource, row: number): string | null {
  return texts.text(mailKey(MAIL_TEXT_FILE, row));
}

function profileName(campaign: CampaignSim, profile: number): string {
  return campaign.laptop?.profileRecord(profile)?.name ?? '';
}

function substituted(campaign: CampaignSim, text: string, mail: Email): string {
  return text.replaceAll(AMOUNT, sprintMoney(mail.firstData)).replaceAll(MERC_NAME, profileName(campaign, mail.secondData));
}

export function mailSubject(campaign: CampaignSim, mail: Email, texts: TextSource | null): string {
  const text = texts ? record(texts, mail.offset) : null;
  return text === null ? '' : substituted(campaign, text, mail);
}

function substitutedLength(campaign: CampaignSim, mail: Email): number | null {
  const content = campaign.laptop?.content;
  if (!content) return null;
  for (const [name, lengthName] of Object.entries(SUBSTITUTED_MAILS))
    if (content.mail[name] === mail.offset) return content.mail[lengthName] ?? null;
  return null;
}

function bodyRecords(campaign: CampaignSim, mail: Email, texts: TextSource): string[] | null {
  const substitutions = substitutedLength(campaign, mail);
  const count = substitutions ?? mail.length;
  const rows: string[] = [];
  for (let i = 1; i < count; i++) {
    const text = record(texts, mail.offset + i);
    if (text === null) return null;
    rows.push(substitutions === null ? text : substituted(campaign, text, mail));
  }
  return rows;
}

function reportProfile(campaign: CampaignSim, mail: Email): number {
  const imp = campaign.state.laptop.imp;
  return imp.taken.includes(mail.firstData) ? mail.firstData : PLAYER_GENERATED_CHARACTER_ID + imp.voiceId;
}

function impReport(campaign: CampaignSim, mail: Email, texts: TextSource): string[] | null {
  const flow = campaign.laptop;
  const character = flow?.profileRecord(reportProfile(campaign, mail));
  if (!flow || !character) return null;
  const portraits = flow.content.imp.portraits;
  const rows = impReportRows(
    {
      sex: character.sex,
      faceIndex: character.faceIndex,
      personalityTrait: character.personalityTrait,
      attitude: character.attitude,
      skillTrait: character.skillTrait,
      skillTrait2: character.skillTrait2,
      initial: character,
    },
    portraits,
    mail.id % 2 === 0,
  );
  const out: string[] = [];
  for (const r of rows) {
    const text = texts.text(mailKey(IMP_REPORT_FILE, r.row));
    if (text === null) return null;
    out.push(r.appendName ? `${text}${IMP_NAME_SEPARATOR}${character.name}` : text);
  }
  return out;
}

export function emailText(campaign: CampaignSim, mail: Email, texts: TextSource): EmailText | null {
  const subject = record(texts, mail.offset);
  if (subject === null) return null;
  const content = campaign.laptop?.content;
  const isReport = content !== undefined && mail.offset === mailOffset(content, IMP_RESULTS_MAIL);
  const paragraphs = isReport ? impReport(campaign, mail, texts) : bodyRecords(campaign, mail, texts);
  if (paragraphs === null) return null;
  return { id: mail.id, subject: substituted(campaign, subject, mail), paragraphs };
}
