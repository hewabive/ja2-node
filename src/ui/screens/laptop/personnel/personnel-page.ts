// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Personnel.cc EnterPersonnel, RenderPersonnel, RenderPersonnelFace (the full name raised one line when
// @src it wraps), DisplayCharName (nickname and town unless POW or in transit, pLongAssignmentStrings),
// @src DisplayDepartedCharName (pPersonnelDepartedStateStrings), DisplayCharStats (the soldier's life, the profile's stats
// @src and deltas, n/a for the robot, the POW health text, kills, assists, hits, battles, wounds and the skill traits),
// @src DisplayDepartedCharStats (str_stat_* labels, no deltas, the dead at 0 life), DisplayEmploymentinformation,
// @src DisplayCharInventory (the slots in order from uiCurrentInventoryIndex, the condition or the rounds of a magazine stack,
// @src the calibre of a gun, the stack count; nothing for the robot), DisplayAmountOnChar, DisplayPersonnelSummary,
// @src DisplayCostOfCurrentTeam, DisplayStateOfPastTeamMembers, DisplayTeamStats (the living team without the robot, or every
// @src departed merc), UpDateStateOfStartButton (the three panel buttons and their enable rules), the button and region
// @src callbacks; Tactical/Soldier_Profile_Type.h NO_SKILLTRAIT, NUM_SKILLTRAITS. See docs/28 §9.3.

import type { PersonnelDepartedView, PersonnelMercView } from '../../../../protocol/view.ts';
import type { AssetKey } from '../../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { stringPixLength } from '../../../text/measure.ts';
import { sprintMoney } from '../../../text/money.ts';
import { lineWrap } from '../../../text/wrap.ts';
import { portraitPath } from '../../../widgets/portrait.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import {
  cyclePortrait,
  departedDown,
  departedDownEnabled,
  departedUp,
  departedUpEnabled,
  faceButtonsEnabled,
  hitPercentage,
  initialPersonnelState,
  inventoryDown,
  inventoryDownEnabled,
  inventoryUp,
  inventoryUpEnabled,
  NO_SELECTION,
  NUMBER_OF_INVENTORY_PERSONNEL,
  PERSONNEL_PORTRAIT_NUMBER,
  PERSONNEL_PORTRAIT_NUMBER_WIDTH,
  type PersonnelCounts,
  PersonnelInfo,
  type PersonnelState,
  remainingContractText,
  selectPortrait,
  showCurrentTeam,
  showDepartedTeam,
  signedDelta,
  skillLines,
  sliderTo,
  sliderZones,
  stepFace,
  teamCost,
  teamStatRow,
  zoneRelativeY,
} from './personnel-model.ts';

export const PERSONNEL_LAYOUT = 'laptop-personnel';
const NO_SKILLTRAIT = 0;
const NUM_SKILLTRAITS = 16;
const NO_TOWN = 0;
const TEAM_STAT_ROWS = 11;
const TEAM_STAT_GAP = 3;
const FULL_NAME_GAP = 1;
const STAT_VALUE_INSET = 20;
const DELTA_WIDTH = 30;
const SKILL_LABEL_GAP = 2;
const FIXED_POINT_WIDTH = 2;
const PERS_FONT = FontName.FONT10ARIAL;
const ATTRIBUTES = [
  'agility',
  'dexterity',
  'strength',
  'leadership',
  'wisdom',
  'experience',
  'marksmanship',
  'mechanical',
  'explosives',
  'medical',
] as const;
const DEPARTED_LABELS = [
  'str_stat_agility',
  'str_stat_dexterity',
  'str_stat_strength',
  'str_stat_leadership',
  'str_stat_wisdom',
  'str_stat_exp_level',
  'str_stat_marksmanship',
  'str_stat_mechanical',
  'str_stat_explosive',
  'str_stat_medical',
] as const;
const DEPARTURE_CONSTANTS: Readonly<Record<PersonnelDepartedView['state'], string>> = {
  dead: 'DEPARTED_DEAD',
  fired: 'DEPARTED_FIRED',
  married: 'DEPARTED_MARRIED',
  contractExpired: 'DEPARTED_CONTRACT_EXPIRED',
  quit: 'DEPARTED_QUIT',
};
const S = {
  screen: 'pPersonnelScreenStrings',
  team: 'pPersonelTeamStrings',
  departed: 'pPersonnelDepartedStateStrings',
  assignment: 'pLongAssignmentStrings',
  towns: 'strategic-map-town-names',
  strategic: 'gpStrategicString',
  pow: 'pPOWStrings',
  aimPopup: 'AimPopUpText',
  skills: 'gzMercSkillText',
  statList: 'str_stat_list',
  health: 'str_stat_health',
} as const;
const POW_HEALTH_TEXT = 1;
const TEAM_CURRENT = 0;
const TEAM_DEPARTED = 1;
const TEAM_DAILY_COST = 2;
const TEAM_HIGHEST_COST = 3;
const TEAM_LOWEST_COST = 4;
const TEAM_DEAD = 5;
const TEAM_FIRED = 6;
const TEAM_OTHER = 7;

export const PERSONNEL_CONTRACT: ControllerContract = {
  id: 'laptopPersonnel',
  actions: {
    select: { args: 2 },
    cycle: { args: 2 },
    prevFace: {},
    nextFace: {},
    showStats: {},
    showEmployment: {},
    showInventory: {},
    currentTeam: {},
    departedTeam: {},
    departedUp: {},
    departedDown: {},
    inventoryUp: {},
    inventoryDown: {},
    sliderTo: { args: 1 },
  },
  bindings: {
    currentMode: 'boolean',
    departedMode: 'boolean',
    portraitRows: 'list',
    selected: 'boolean',
    bigFace: 'number',
    bigFaceState: 'string',
    fullName: 'string',
    fullNameSingle: 'boolean',
    fullNameWraps: 'boolean',
    fullNameRaisedY: 'number',
    charName: 'string',
    charLocation: 'string',
    statsChecked: 'boolean',
    employmentChecked: 'boolean',
    inventoryChecked: 'boolean',
    statsEnabled: 'boolean',
    employmentEnabled: 'boolean',
    inventoryEnabled: 'boolean',
    money: 'string',
    statRows: 'list',
    skillLines: 'list',
    employmentRows: 'list',
    inventoryPanel: 'boolean',
    inventoryRows: 'list',
    sliderY: 'number',
    inventoryUpEnabled: 'boolean',
    inventoryDownEnabled: 'boolean',
    sliderZones: 'list',
    teamCountText: 'string',
    departedCountText: 'string',
    summaryRows: 'list',
    teamStatRows: 'list',
    teamStatTop: 'number',
    teamStatStep: 'number',
    faceButtonsEnabled: 'boolean',
    departedUpEnabled: 'boolean',
    departedDownEnabled: 'boolean',
  },
};

interface TextRow {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
}

const EMPTY_ROW: TextRow = { label: '', value: '', delta: '' };
const STAT_ROWS = 17;
const EMPLOYMENT_ROWS = 5;

export function conditionText(status: number, shots: number, count: number, ammoCapacity: number | null | undefined): string {
  if (ammoCapacity !== null && ammoCapacity !== undefined) return `${shots}/${count * ammoCapacity}`;
  return `${String(status).padStart(FIXED_POINT_WIDTH, ' ')}%`;
}

export function personnelPage(context: LaptopContext): LaptopPage {
  const constant = (name: string) => context.constant(PERSONNEL_LAYOUT, name);
  const string = (table: string, index = 0) => context.string(table, index);
  const font = context.services.fonts.get(PERS_FONT);
  const lineHeight = fontHeight(font);
  const current = (): readonly PersonnelMercView[] => context.view()?.personnel.current ?? [];
  const departed = (): readonly PersonnelDepartedView[] => context.view()?.personnel.departed ?? [];
  const counts = (): PersonnelCounts => ({ team: current().length, past: departed().length });
  const pow = (slot: number) => current()[slot]?.assignment === constant('ASSIGNMENT_POW');
  const faceOf = (profile: number) => context.data.profile(profile)?.faceIndex ?? profile;
  const state: PersonnelState = initialPersonnelState(counts());
  const loaded = new Set<AssetKey>();
  const model: Record<string, unknown> = {};

  const selectedMerc = (): PersonnelMercView | undefined =>
    state.currentMode && state.selected !== NO_SELECTION ? current()[state.selected] : undefined;
  const selectedDeparted = (): PersonnelDepartedView | undefined =>
    !state.currentMode && state.selected !== NO_SELECTION ? departed()[state.upperLeft + state.selected] : undefined;
  const itemCount = () => selectedMerc()?.inventory.length ?? 0;

  const load = (paths: readonly AssetKey[]) => {
    const fresh = paths.filter((p) => !loaded.has(p));
    for (const p of fresh) loaded.add(p);
    if (fresh.length > 0) void context.media.loadImages(fresh);
  };

  const portraitRows = () => {
    const team = current();
    const past = departed();
    const deadLabel = string(S.aimPopup, constant('AIM_MEMBER_DEAD'));
    const slots = Array.from({ length: PERSONNEL_PORTRAIT_NUMBER }, (_, i) => {
      const selected = state.selected === i;
      if (state.currentMode) {
        const m = team[i];
        if (!m) return { present: false, face: -1, state: 'normal', deadLabel: '', selected };
        return {
          present: true,
          face: faceOf(m.profile),
          state: m.alive ? 'normal' : 'dead',
          deadLabel: m.alive ? '' : deadLabel,
          selected,
        };
      }
      const d = past[state.upperLeft + i];
      if (!d) return { present: false, face: -1, state: 'normal', deadLabel: '', selected };
      return { present: true, face: faceOf(d.profile), state: d.state === 'dead' ? 'dead' : 'normal', deadLabel: '', selected };
    });
    load(slots.filter((s) => s.present).map((s) => portraitPath(s.face, 'small')));
    return Array.from({ length: PERSONNEL_PORTRAIT_NUMBER / PERSONNEL_PORTRAIT_NUMBER_WIDTH }, (_, row) =>
      slots.slice(row * PERSONNEL_PORTRAIT_NUMBER_WIDTH, (row + 1) * PERSONNEL_PORTRAIT_NUMBER_WIDTH),
    );
  };

  const recordRows = (r: PersonnelMercView['record']): TextRow[] => [
    { label: `${string(S.screen, constant('PRSNL_TXT_KILLS'))}:`, value: String(r.kills), delta: '' },
    { label: `${string(S.screen, constant('PRSNL_TXT_ASSISTS'))}:`, value: String(r.assists), delta: '' },
    {
      label: string(S.screen, constant('PRSNL_TXT_HIT_PERCENTAGE')),
      value: `${hitPercentage(r.shotsFired, r.shotsHit)} %`,
      delta: '',
    },
    { label: `${string(S.screen, constant('PRSNL_TXT_BATTLES'))}:`, value: String(r.battlesFought), delta: '' },
    { label: `${string(S.screen, constant('PRSNL_TXT_TIMES_WOUNDED'))}:`, value: String(r.timesWounded), delta: '' },
  ];

  const currentStatRows = (m: PersonnelMercView): TextRow[] => {
    const isPow = m.assignment === constant('ASSIGNMENT_POW');
    const notApplicable = string(S.strategic, constant('STR_PB_NOTAPPLICABLE_ABBREVIATION'));
    const health: TextRow = {
      label: `${string(S.health)}:`,
      value: isPow ? string(S.pow, POW_HEALTH_TEXT) : `${m.life}/${m.lifeMax}`,
      delta: isPow ? '' : signedDelta(m.gains.health),
    };
    const attributes = ATTRIBUTES.map(
      (key, i): TextRow => ({
        label: `${string(S.statList, i + 1)}:`,
        value: m.robot ? notApplicable : String(m.stats[key]),
        delta: m.robot ? '' : signedDelta(m.gains[key]),
      }),
    );
    return [
      health,
      ...attributes,
      ...recordRows(m.record),
      { label: string(S.screen, constant('PRSNL_TXT_SKILLS')), value: '', delta: '' },
    ];
  };

  const departedStatRows = (d: PersonnelDepartedView): TextRow[] => {
    const health: TextRow = { label: `${string(S.health)}:`, value: `${d.state === 'dead' ? 0 : d.life}/${d.life}`, delta: '' };
    const attributes = ATTRIBUTES.map(
      (key, i): TextRow => ({ label: `${string(DEPARTED_LABELS[i] ?? '')}:`, value: String(d.stats[key]), delta: '' }),
    );
    return [health, ...attributes, ...recordRows(d.record), EMPTY_ROW];
  };

  const currentSkillLines = (m: PersonnelMercView) => {
    if (m.robot) return [];
    const statX = constant('pers_stat_x');
    const valueWidth = constant('TEXT_BOX_WIDTH') - STAT_VALUE_INSET;
    const label = string(S.screen, constant('PRSNL_TXT_SKILLS'));
    return skillLines(
      m.skills,
      {
        skill: (trait) => string(S.skills, trait),
        expert: string(S.skills, NUM_SKILLTRAITS),
        none: string(S.screen, constant('PRSNL_TXT_NOSKILLS')),
      },
      (text) => stringPixLength(text, font),
      {
        statX,
        valueWidth,
        deltaX: statX + valueWidth + constant('TEXT_DELTA_OFFSET'),
        deltaWidth: DELTA_WIDTH,
        minimumX: stringPixLength(label, font) + statX + SKILL_LABEL_GAP,
      },
      NO_SKILLTRAIT,
    );
  };

  const employmentRows = (m: PersonnelMercView): TextRow[] => {
    const e = m.employment;
    const days = string(S.strategic, constant('STR_PB_DAYS_ABBREVIATION'));
    const hours = string(S.strategic, constant('STR_PB_HOURS_ABBREVIATION'));
    const remaining =
      e.kind === 'aim'
        ? remainingContractText(e.minutesLeft, e.totalDays, { days, hours })
        : string(S.strategic, constant('STR_PB_NOTAPPLICABLE_ABBREVIATION'));
    const deposit: TextRow =
      e.kind === 'merc'
        ? { label: string(S.screen, constant('PRSNL_TXT_UNPAID_AMOUNT')), value: sprintMoney(e.unpaid) }
        : { label: string(S.screen, constant('PRSNL_TXT_MED_DEPOSIT')), value: sprintMoney(e.medicalDeposit) };
    return [
      { label: string(S.screen, constant('PRSNL_TXT_CURRENT_CONTRACT')), value: remaining },
      { label: string(S.screen, constant('PRSNL_TXT_TOTAL_SERVICE')), value: `${e.daysServed} ${days}` },
      { label: string(S.screen, constant('PRSNL_TXT_TOTAL_COST')), value: sprintMoney(e.totalCost) },
      { label: string(S.screen, constant('PRSNL_TXT_DAILY_COST')), value: sprintMoney(e.dailyCost) },
      deposit,
    ];
  };

  const inventoryRows = (m: PersonnelMercView | undefined) => {
    const rows = Array.from({ length: NUMBER_OF_INVENTORY_PERSONNEL }, () => ({
      present: false,
      graphic: null as unknown,
      name: '',
      condition: '',
      calibre: '',
      count: '',
    }));
    if (!m || m.robot) return rows;
    m.inventory.slice(state.inventoryIndex, state.inventoryIndex + NUMBER_OF_INVENTORY_PERSONNEL).forEach((entry, k) => {
      const item = context.data.item(entry.item);
      rows[k] = {
        present: true,
        graphic: item?.graphic ?? null,
        name: item?.name ?? item?.shortName ?? '',
        condition: conditionText(entry.status, entry.shots, entry.count, item?.ammoCapacity),
        calibre: item?.gunCalibre ?? '',
        count: entry.count > 1 ? `x${entry.count}` : '',
      };
    });
    return rows;
  };

  const summaryRows = (): TextRow[] => {
    if (state.currentMode) {
      const cost = teamCost(
        current()
          .filter((m) => m.alive)
          .map((m) => m.employment.dailyCost),
      );
      return [
        { label: string(S.team, TEAM_DAILY_COST), value: sprintMoney(cost.daily) },
        { label: string(S.team, TEAM_HIGHEST_COST), value: sprintMoney(cost.highest) },
        { label: string(S.team, TEAM_LOWEST_COST), value: sprintMoney(cost.lowest) },
      ];
    }
    const past = departed();
    const count = (states: readonly PersonnelDepartedView['state'][]) => String(past.filter((d) => states.includes(d.state)).length);
    return [
      { label: string(S.team, TEAM_DEAD), value: count(['dead']) },
      { label: string(S.team, TEAM_FIRED), value: count(['fired']) },
      { label: string(S.team, TEAM_OTHER), value: count(['married', 'contractExpired', 'quit']) },
    ];
  };

  const teamStatRows = () => {
    const members = state.currentMode
      ? current()
          .filter((m) => m.alive && !m.robot)
          .map((m) => ({ name: m.name, stats: m.teamStats }))
      : departed().map((d) => ({ name: d.nickname, stats: d.teamStats }));
    return Array.from({ length: TEAM_STAT_ROWS }, (_, k) => {
      const row = teamStatRow(members, k);
      const tone = k % 2 === 0 ? 'alternate' : 'normal';
      if (!row) return { tone, minName: '', minValue: '', average: '', maxName: '', maxValue: '' };
      return {
        tone,
        minName: row.minName,
        minValue: String(row.minValue),
        average: String(row.average),
        maxName: row.maxName,
        maxValue: String(row.maxValue),
      };
    });
  };

  const updateButtonStates = (m: PersonnelMercView | undefined) => {
    const c = counts();
    if (!state.currentMode) {
      model.statsEnabled = true;
      model.employmentEnabled = false;
      model.inventoryEnabled = false;
    } else if (c.team > 0) {
      const isPow = m !== undefined && m.assignment === constant('ASSIGNMENT_POW');
      if (isPow && state.info === PersonnelInfo.INVENTORY) state.info = PersonnelInfo.STATS;
      model.statsEnabled = true;
      model.employmentEnabled = true;
      model.inventoryEnabled = !isPow;
    } else {
      model.statsEnabled = false;
      model.employmentEnabled = false;
      model.inventoryEnabled = false;
    }
    model.statsChecked = state.info === PersonnelInfo.STATS;
    model.employmentChecked = state.info === PersonnelInfo.EMPLOYMENT;
    model.inventoryChecked = state.info === PersonnelInfo.INVENTORY;
  };

  const faceAndName = (profile: number, alive: boolean, fullName: string) => {
    const face = faceOf(profile);
    load([portraitPath(face, 'big')]);
    const wraps = lineWrap(font, constant('IMAGE_NAME_WIDTH'), fullName).length * (lineHeight + FULL_NAME_GAP) - 2 > lineHeight;
    model.bigFace = face;
    model.bigFaceState = alive ? 'normal' : 'dead';
    model.fullName = fullName;
    model.fullNameWraps = wraps;
    model.fullNameSingle = !wraps;
    model.fullNameRaisedY = constant('IMAGE_BOX_Y') + constant('IMAGE_FULL_NAME_OFFSET_Y') - lineHeight;
  };

  const refresh = () => {
    const c = counts();
    const m = selectedMerc();
    updateButtonStates(m);
    const d = selectedDeparted();
    model.currentMode = state.currentMode;
    model.departedMode = !state.currentMode;
    model.portraitRows = portraitRows();
    model.selected = m !== undefined || d !== undefined;
    model.fullNameSingle = false;
    model.fullNameWraps = false;
    model.charName = '';
    model.charLocation = '';
    model.money = '';
    let stats: TextRow[] = [];
    let skills: { x: number; text: string }[] = [];
    let employment: TextRow[] = [];
    if (m) {
      faceAndName(m.profile, m.alive, m.fullName);
      const town = m.town === NO_TOWN ? '' : string(S.towns, m.town);
      model.charName = town ? `${m.name} - ${town}` : m.name;
      model.charLocation = string(S.assignment, m.assignment);
      model.money = sprintMoney(m.money);
      if (state.info === PersonnelInfo.STATS) {
        stats = currentStatRows(m);
        skills = currentSkillLines(m);
      } else if (state.info === PersonnelInfo.EMPLOYMENT) employment = employmentRows(m);
    } else if (d) {
      faceAndName(d.profile, d.state !== 'dead', d.fullName);
      model.charName = d.nickname;
      model.charLocation = string(S.departed, constant(DEPARTURE_CONSTANTS[d.state]));
      stats = departedStatRows(d);
    }
    model.statRows = Array.from({ length: STAT_ROWS }, (_, k) => stats[k] ?? EMPTY_ROW);
    model.skillLines = [0, 1].map((k) => skills[k] ?? { x: 0, text: '' });
    model.employmentRows = Array.from({ length: EMPLOYMENT_ROWS }, (_, k) => employment[k] ?? EMPTY_ROW);
    const inventory = m !== undefined && state.info === PersonnelInfo.INVENTORY;
    const items = itemCount();
    model.inventoryPanel = inventory;
    model.inventoryRows = inventoryRows(inventory ? m : undefined);
    model.sliderY = constant('Y_OF_PERSONNEL_SCROLL_REGION') + state.sliderPosition;
    model.inventoryUpEnabled = inventoryUpEnabled(state);
    model.inventoryDownEnabled = inventoryDownEnabled(state, items);
    model.sliderZones = inventory ? sliderZones(items) : [];
    model.teamCountText = `${string(S.team, TEAM_CURRENT)} ( ${c.team} )`;
    model.departedCountText = `${string(S.team, TEAM_DEPARTED)} ( ${c.past} )`;
    model.summaryRows = summaryRows();
    model.teamStatRows = teamStatRows();
    model.teamStatStep = lineHeight + TEAM_STAT_GAP;
    model.teamStatTop = constant('PERS_STAT_AVG_Y') + lineHeight + TEAM_STAT_GAP;
    model.faceButtonsEnabled = faceButtonsEnabled(state, c);
    model.departedUpEnabled = departedUpEnabled(state);
    model.departedDownEnabled = departedDownEnabled(state, c);
  };

  const slot = (row: number | undefined, column: number | undefined) => (row ?? 0) * PERSONNEL_PORTRAIT_NUMBER_WIDTH + (column ?? 0);
  const controller = new ViewModelController(PERSONNEL_CONTRACT, model, {
    select: ([row, column]) => selectPortrait(state, slot(row, column), counts(), pow),
    cycle: ([row, column]) => cyclePortrait(state, slot(row, column), counts(), pow),
    prevFace: () => stepFace(state, counts(), false),
    nextFace: () => stepFace(state, counts(), true),
    showStats: () => {
      state.info = PersonnelInfo.STATS;
    },
    showEmployment: () => {
      state.info = PersonnelInfo.EMPLOYMENT;
    },
    showInventory: () => {
      state.info = PersonnelInfo.INVENTORY;
    },
    currentTeam: () => showCurrentTeam(state, counts()),
    departedTeam: () => showDepartedTeam(state, counts()),
    departedUp: () => departedUp(state),
    departedDown: () => departedDown(state, counts()),
    inventoryUp: () => inventoryUp(state, itemCount()),
    inventoryDown: () => inventoryDown(state, itemCount()),
    sliderTo: ([zone]) => sliderTo(state, itemCount(), zoneRelativeY(sliderZones(itemCount()), zone ?? 0)),
  });
  refresh();
  return { layouts: [{ name: PERSONNEL_LAYOUT, controller }], update: refresh };
}
