import type { CommandRefused } from '../../command.ts';
import { type RefusalDetail, type RefusalTexts, refuseWithText } from '../../tactical/refusal.ts';
import type { AimHireRefusal } from './aim.ts';
import type { OrderRefusal } from './bobby-ray.ts';
import type { FlowerRefusal } from './florist.ts';
import type { LandingZoneRefusal } from './hire.ts';
import type { ImpRefusal } from './imp.ts';
import type { MercHireRefusal } from './merc-site.ts';

export type LaptopRefusal =
  | 'laptopOpen'
  | 'laptopClosed'
  | 'mapScreenOnly'
  | 'promptOpen'
  | 'battlePending'
  | 'renewalSequence'
  | LandingZoneRefusal
  | 'badSite'
  | 'noSuchMail'
  | 'noSuchFile'
  | 'noText'
  | AimHireRefusal
  | 'badGear'
  | 'notAway'
  | 'alreadyLeft'
  | MercHireRefusal
  | 'hasAccount'
  | 'nothingOwed'
  | ImpRefusal
  | 'badOrder'
  | OrderRefusal
  | 'notInsurable'
  | FlowerRefusal;

const LAPTOP_REFUSAL_TEXT: RefusalTexts<LaptopRefusal> = {
  laptopOpen: 'the laptop is open, closeLaptop first',
  laptopClosed: 'the laptop is closed, openLaptop first',
  mapScreenOnly: 'the laptop is used from the map screen only',
  promptOpen: 'answer the open prompt first',
  battlePending: 'a battle is about to begin: answer the pre-battle prompt first',
  renewalSequence: 'mercs are asking for contract renewals: answer them first',
  beforeFirstLanding: 'the landing zone moves only after the first landing',
  badSector: 'sector must be a surface sector such as B13',
  groundBarrier: 'the helicopter cannot drop mercs in that sector',
  enemyAirspace: 'the enemy controls the airspace over that sector',
  badSite: 'site must be bobbyRay, merc, funeral, florist, insurance or floristOrderForm',
  noBookmark: 'the site is not bookmarked yet',
  siteDown: 'the M.E.R.C. site is down',
  noSuchMail: 'no such mail',
  noSuchFile: 'no such file',
  noText: 'the mail has no text in this language',
  notAimMerc: 'profile must be an A.I.M. merc',
  badContract: 'contract must be 1, 7 or 14 days',
  badGear: 'gear must be true or false',
  noKit: 'the merc has no kit to buy',
  unavailable: 'the merc is not available',
  away: 'the merc is away: leave a message',
  hangover: 'the merc is hung over',
  hatesTeammate: 'the merc will not work beside someone on the team',
  deathRate: 'the merc refuses: too many of your mercs died',
  reputation: 'the merc refuses: your reputation is too low',
  funds: 'not enough money',
  cannotHire: 'the merc cannot be hired',
  teamFull: 'the team is full',
  notAway: 'the merc is not away',
  alreadyLeft: 'a message for the merc is already left',
  hasAccount: 'the account is already open',
  noAccount: 'open an account first',
  accountSuspended: 'the account is suspended until it is paid',
  accountInvalid: 'the account is closed',
  notListed: 'profile must be a merc the site lists',
  nothingOwed: 'nothing is owed',
  badCode: 'wrong access code',
  noSlot: 'no more I.M.P. characters can be made',
  badName: 'name, nickname and gender (male or female) are required',
  badAnswers: 'answers must be 16 valid answer indices',
  badSkills: 'skills must be two valid skills',
  badAttributes: 'attributes must spend the points within the limits',
  badPortrait: 'no such portrait',
  badVoice: 'no such voice',
  badOrder: 'lines and speed are required, and a destination to order',
  siteClosed: "Bobby Ray's site is not open yet",
  noLines: 'the order has no lines',
  tooManyLines: 'the order has too many lines',
  notInStock: 'not that many in stock',
  noDestination: 'no such destination',
  badSpeed: 'speed must be 0, 1 or 2',
  notInsurable: 'the merc cannot be insured',
  noSuchBouquet: 'no such bouquet',
  badExtra: 'no such extra',
};

export function laptopRefusal(token: LaptopRefusal, detail?: RefusalDetail): CommandRefused {
  return refuseWithText(LAPTOP_REFUSAL_TEXT, token, detail);
}
