import { handClass, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { createItem } from '../items/object.ts';
import { WeaponMode } from '../tactical/combat/types.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { newKeyRing } from '../tactical/doors/key-ring.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Opp } from '../tactical/perception/opp.ts';
import { createSoldier, NO_PROFILE, NOBODY, type Soldier, type SoldierStats, Team } from '../tactical/soldier.ts';
import type { WeaponModeView } from '../tactical/soldier-view.ts';
import { type GuardOptions, guardFields } from './guard.ts';
import { inventoryFromView } from './objects.ts';
import type { KnowledgeSoldier, OwnHintInputs } from './view.ts';

const SHOWN_FIELDS = [
  'id',
  'team',
  'bodyType',
  'gridNo',
  'x',
  'y',
  'level',
  'direction',
  'state',
  'placed',
  'visible',
  'structure',
  'multiTile',
  'overTerrain',
] as const;

const HIDDEN_WITH_NEUTRAL_VALUE = ['tilesMoved', 'oppList', 'life', 'collapsed'] as const;

const OWN_FIELDS = [
  ...SHOWN_FIELDS,
  'name',
  'profile',
  'side',
  'neutral',
  'inv',
  'stats',
  'life',
  'lifeMax',
  'morale',
  'bleeding',
  'breath',
  'breathMax',
  'actionPoints',
  'stealthMode',
  'camo',
  'weaponMode',
  'keyRing',
  'hasKeys',
  'blindedCounter',
  'serviceCount',
  'oppList',
  'skillTrait1',
  'skillTrait2',
  'personalityTrait',
  'shock',
  'lastTarget',
  'tilesMoved',
  'weightCarriedAtTurnStart',
  'collapsed',
  'underAiControl',
  'monsterOrAnimal',
] as const;

const WEAPON_MODES: Readonly<Record<WeaponModeView, number>> = {
  single: WeaponMode.NORMAL,
  burst: WeaponMode.BURST,
  launcher: WeaponMode.ATTACHED,
};

const NO_STATS: SoldierStats = {
  agility: 0,
  dexterity: 0,
  strength: 0,
  wisdom: 0,
  leadership: 0,
  marksmanship: 0,
  mechanical: 0,
  explosives: 0,
  medical: 0,
  experience: 0,
};

const NO_HINT_INPUTS: OwnHintInputs = {
  skills: [0, 0],
  personality: 0,
  shock: 0,
  lastTarget: -1,
  tilesMoved: 0,
  weightAtTurnStart: 0,
  collapsed: false,
  gassed: false,
  underAiControl: false,
};

const UNKNOWN_PALETTES = { hair: '', skin: '', vest: '', pants: '' };
const SEEN_BY_OUR_TEAM = 1;

export interface ProjectedSoldier {
  readonly soldier: Soldier;
  readonly raw: Soldier;
  readonly own: boolean;
}

const APPEARANCE_LIFE_BY_HEALTH = [14, 29, 44, 59, 74, 89, 100] as const;
const FULL_APPEARANCE_LIFE = 100;

function representativeHandItem(items: ItemTable, hand: string | undefined): number {
  if (!hand || hand === 'nothing') return NOTHING;
  for (const def of items.ordered) if (handClass(items, def.index) === hand) return def.index;
  return NOTHING;
}

function applyAppearanceStandIns(content: TacticalContent, s: Soldier, v: KnowledgeSoldier, ownIds: readonly number[]): void {
  const item = representativeHandItem(content.items, v.hand);
  if (item !== NOTHING) s.inv[InvSlot.HAND] = createItem(content.items, item, FULL_APPEARANCE_LIFE);
  s.life = APPEARANCE_LIFE_BY_HEALTH[v.healthIndex ?? APPEARANCE_LIFE_BY_HEALTH.length - 1] ?? FULL_APPEARANCE_LIFE;
  for (const id of ownIds) s.oppList[id] = Opp.SEEN_CURRENTLY;
}

function statsOf(v: KnowledgeSoldier): SoldierStats {
  const s = v.stats;
  if (!s) return NO_STATS;
  return {
    agility: s.agility,
    dexterity: s.dexterity,
    strength: s.strength,
    wisdom: s.wisdom,
    leadership: s.leadership,
    marksmanship: s.marksmanship,
    mechanical: s.mechanical,
    explosives: s.explosives,
    medical: s.medical,
    experience: s.level,
  };
}

function keyRingOf(v: KnowledgeSoldier) {
  const ring = newKeyRing();
  (v.keys ?? []).forEach((k, i) => {
    const slot = ring[i];
    if (!slot) return;
    slot.keyId = k.keyId;
    slot.count = k.count;
  });
  return ring;
}

function applyOwnFields(content: TacticalContent, s: Soldier, v: KnowledgeSoldier, guard: GuardOptions): void {
  const hint = v.hint ?? NO_HINT_INPUTS;
  s.life = v.life ?? 0;
  s.lifeMax = v.lifeMax ?? 0;
  s.breath = v.breath ?? 0;
  s.breathMax = v.breathMax ?? 0;
  s.bleeding = v.bleeding ?? 0;
  s.morale = v.morale ?? 0;
  s.actionPoints = v.ap ?? 0;
  s.camo = v.camo ?? 0;
  s.stealthMode = v.stealth ?? false;
  s.weaponMode = WEAPON_MODES[v.weaponMode ?? 'single'];
  s.blindedCounter = v.blinded ? 1 : 0;
  s.serviceCount = v.firstAid === 'patient' ? 1 : 0;
  s.keyRing = keyRingOf(v);
  s.hasKeys = (v.keys ?? []).length > 0;
  s.skillTrait1 = hint.skills[0];
  s.skillTrait2 = hint.skills[1];
  s.personalityTrait = hint.personality;
  s.shock = hint.shock;
  s.lastTarget = hint.lastTarget;
  s.tilesMoved = hint.tilesMoved;
  s.weightCarriedAtTurnStart = hint.weightAtTurnStart;
  s.collapsed = hint.collapsed;
  s.underAiControl = hint.underAiControl;
  for (const id of v.sees ?? []) s.oppList[id] = Opp.SEEN_CURRENTLY;
  const inv = inventoryFromView(content.items, v.inventory ?? [], `soldier ${v.id}`, guard);
  inv.forEach((o, slot) => {
    s.inv[slot] = o;
  });
}

export function soldierFromView(
  content: TacticalContent,
  v: KnowledgeSoldier,
  ownIds: readonly number[],
  guard: GuardOptions,
): ProjectedSoldier {
  const own = v.team === Team.OUR;
  const s = createSoldier({
    id: v.id,
    team: v.team,
    name: '',
    profile: v.profile ?? NO_PROFILE,
    bodyType: v.bodyType,
    palettes: UNKNOWN_PALETTES,
    stats: statsOf(v),
    life: v.life ?? 0,
    gridNo: v.gridNo,
    level: v.level,
    direction: v.direction,
    state: v.animation,
  });
  s.x = v.x;
  s.y = v.y;
  s.placed = true;
  s.visible = SEEN_BY_OUR_TEAM;
  s.servicePartner = NOBODY;
  if (own) applyOwnFields(content, s, v, guard);
  else applyAppearanceStandIns(content, s, v, ownIds);
  const fields = new Set<PropertyKey>(own ? OWN_FIELDS : [...SHOWN_FIELDS, ...HIDDEN_WITH_NEUTRAL_VALUE]);
  if (!own && v.profile !== undefined) fields.add('profile');
  return { soldier: guardFields(s, fields, `soldier ${v.id}`, guard), raw: s, own };
}
