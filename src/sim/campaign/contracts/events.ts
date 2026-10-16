export interface ContractEventBase {
  readonly tick: number;
}

export interface MercQuoteEvent extends ContractEventBase {
  readonly type: 'mercQuote';
  readonly soldier: number;
  readonly profile: number;
  readonly quote: string;
  readonly id: number;
  readonly subject?: number;
}

export interface ContractsExpiringSoonEvent extends ContractEventBase {
  readonly type: 'contractsExpiringSoon';
  readonly soldiers: readonly number[];
}

export interface ContractTime {
  readonly day: number;
  readonly hour: number;
}

export interface ContractExtendedEvent extends ContractEventBase {
  readonly type: 'contractExtended';
  readonly soldier: number;
  readonly days: number;
  readonly cost: number;
  readonly endsAt: ContractTime;
}

export type RefusalReason = 'signedElsewhere' | 'hatedMerc' | 'learnedToHate' | 'deathRate' | 'morale';

export interface ContractRefusedEvent extends ContractEventBase {
  readonly type: 'contractRefused';
  readonly soldier: number;
  readonly reason: RefusalReason;
}

export interface InsuranceUnaffordableEvent extends ContractEventBase {
  readonly type: 'insuranceUnaffordable';
  readonly soldier: number;
  readonly cost: number;
}

export type DepartureCause = 'contractExpired' | 'fired' | 'quit' | 'dead' | 'pow' | 'other';
export type DepartureEquipment = 'here' | 'elsewhere' | 'carried' | 'none';
export type PersonnelList = 'dead' | 'fired' | 'other';

export interface MercLeftEvent extends ContractEventBase {
  readonly type: 'mercLeft';
  readonly soldier: number;
  readonly profile: number;
  readonly cause: DepartureCause;
  readonly history: number;
  readonly equipment: DepartureEquipment;
  readonly personnel: PersonnelList;
  readonly refund?: number;
}

export interface EquipmentDeliveredEvent extends ContractEventBase {
  readonly type: 'equipmentDelivered';
  readonly sector: string;
  readonly owner: number;
  readonly items: number;
}

export interface RpcUnpaidEvent extends ContractEventBase {
  readonly type: 'rpcUnpaid';
  readonly soldier: number;
  readonly amount: number;
}

export interface MercAccountStatusEvent extends ContractEventBase {
  readonly type: 'mercAccountStatus';
  readonly status: string;
}

export interface HistoryAddedEvent extends ContractEventBase {
  readonly type: 'historyAdded';
  readonly code: number;
  readonly profile: number;
  readonly sector: string | null;
}

export type MailKind =
  | 'mercBackFromAssignment'
  | 'mercDiedOnOtherAssignment'
  | 'medicalDepositRefund'
  | 'medicalDepositPartialRefund'
  | 'medicalDepositNoRefund'
  | 'mercAccountFirstWarning'
  | 'mercAccountSuspended'
  | 'mercAccountInvalid'
  | 'mercWentUpALevel';

export interface MailDueEvent extends ContractEventBase {
  readonly type: 'mailDue';
  readonly mail: MailKind;
  readonly profile?: number;
  readonly amount?: number;
}

export type ContractEvent =
  | MercQuoteEvent
  | ContractsExpiringSoonEvent
  | ContractExtendedEvent
  | ContractRefusedEvent
  | InsuranceUnaffordableEvent
  | MercLeftEvent
  | EquipmentDeliveredEvent
  | RpcUnpaidEvent
  | MercAccountStatusEvent
  | HistoryAddedEvent
  | MailDueEvent;
