import type { CommandRefused } from '../command.ts';
import type { TradeRefusalToken } from '../strategic/economy/merchants/trade.ts';
import { type RefusalDetail, type RefusalTexts, refuse } from '../tactical/refusal.ts';

export type ShopRefusal =
  | 'shopOpen'
  | 'shopNotOpen'
  | 'shopUnavailable'
  | 'notInTactical'
  | 'promptOpen'
  | 'noSuchSoldier'
  | 'canAct'
  | 'notADealer'
  | 'dealerAbsent'
  | 'outOfBusiness'
  | 'dealerDown'
  | 'dealerHidden'
  | 'dealerHostile'
  | 'dealerMoving'
  | 'mercCantTrade'
  | 'notOnCurrentSquad'
  | 'noLineOfSight'
  | 'tooFar'
  | 'notEnoughAP'
  | 'npcWantsToTalk'
  | 'shopClosedByScript'
  | 'noSuchPricingMerc'
  | 'receiverCantTrade'
  | 'badTradeList'
  | 'duplicateSource'
  | 'itemNotFound'
  | 'notMoney'
  | 'notEnoughMoney'
  | TradeRefusalToken;

const SHOP_REFUSAL_TEXT: RefusalTexts<ShopRefusal> = {
  shopOpen: 'a shop is open, trade or closeShop first',
  shopNotOpen: 'no shop is open',
  shopUnavailable: 'the dealer cannot open his shop now',
  notInTactical: 'shops open in the loaded sector only',
  promptOpen: 'answer the open prompt first',
  noSuchSoldier: 'no such soldier of yours',
  canAct: 'the soldier cannot act now',
  notADealer: 'dealer must be a merchant',
  dealerAbsent: 'the dealer is not in the sector',
  outOfBusiness: 'the dealer is out of business',
  dealerDown: 'the dealer is down',
  dealerHidden: 'the squad does not see the dealer',
  dealerHostile: 'the dealer is hostile',
  dealerMoving: 'the dealer is walking',
  mercCantTrade: 'that merc cannot trade',
  notOnCurrentSquad: 'the merc is not on the current squad',
  noLineOfSight: 'the merc does not see the dealer',
  tooFar: 'the merc is too far from the dealer',
  notEnoughAP: 'not enough APs to talk',
  npcWantsToTalk: 'the dealer has something to say first: talk to him',
  shopClosedByScript: 'the dealer does not trade now',
  noSuchPricingMerc: 'soldier must be a regular merc of the current squad who can trade',
  receiverCantTrade: 'the receiver cannot trade',
  badTradeList: 'buy, sell, repair and cash must be lists of objects',
  duplicateSource: 'an item is offered twice',
  itemNotFound: 'no such item in that slot',
  notMoney: 'cash must name a money pocket',
  notEnoughMoney: 'not that much money in the pocket',
  noSuchBox: 'no such box on the dealer shelves',
  notEnoughInBox: 'not that many in the box',
  dealerOfferAreaFull: "the dealer's offer area is full",
  wontBuy: 'the dealer does not buy that item',
  worthless: 'the item is worthless to the dealer',
  playerOfferAreaFull: 'the offer area is full',
  wontRepair: 'the dealer does not repair that item',
  tooManyToRepair: 'too many items to repair at once',
  notDamaged: 'the item is not damaged',
  noRoomForPurchases: 'no room for the purchases',
  cannotAfford: 'the balance and the offer do not cover the cost',
  needBalance: 'the offer does not cover the cost: repeat with useBalance to pay the rest from the balance',
  repairmanShort: 'not enough money for the repairs',
  dealerCannotAfford: 'the dealer has not the cash to pay for the offer',
  nothingToTrade: 'nothing is offered',
};

export function shopRefusal(token: ShopRefusal, detail?: RefusalDetail, text: string = SHOP_REFUSAL_TEXT[token]): CommandRefused {
  return refuse(token, `${token}: ${text}`, detail);
}
