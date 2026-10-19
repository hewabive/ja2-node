// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc EnterAIMMembers, ExitAIMMembers (the conference mode kept for the next entry unless
// @src a popup was up), RenderAIMMembers, UpdateMercInfo (the salaries, the medical deposit line moved up when it wraps to
// @src more than two lines, the bio and the additional information), DisplayMercsInventory (eight boxes, "xN", the short
// @src name wrapped in two lines and centred when it fits in one), DisplayMercsFace (the overlays), DisplayMercStats and
// @src DrawStat (white from 80, dark white below, the level always white), DisplayDots (a dot every 7 pixels),
// @src BtnPreviousButtonCallback, BtnNextButtonCallback (wrapping over MAX_NUMBER_MERCS), BtnContactButtonCallback,
// @src SelectFaceRegionCallBackPrimary/Secondary, SelectFaceMovementRegionCallBack, DisplayVideoConferencingDisplay,
// @src DisplayMercsVideoFace (the terminal's 3-pixel shadow), DisplayTalkingMercFaceForVideoPopUp (the 48 x 43 face
// @src stretched into 96 x 86, the answering machine shaded with its caption), DrawButtonSelection and DisplaySelectLights
// @src (an 8 x 8 fill, green when selected, at +105, +7), DisplayMercChargeAmount, DisplayAimPopUpBox,
// @src DisplayPopUpBoxExplainingMercArrivalLocationAndTime (nickname, sector, day = arrival / 1440, "HH:00"; the German
// @src argument order). See docs/28 §9.4.

import { idiv } from '../../../../core/int.ts';
import type { AimMercView } from '../../../../protocol/view.ts';
import type { Area, DrawList } from '../../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { textBoxArt } from '../../../layout/styles.ts';
import type { LayoutView } from '../../../layout/view.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { stringPixLength } from '../../../text/measure.ts';
import { sprintMoney } from '../../../text/money.ts';
import { fontColors, mprint } from '../../../text/print.ts';
import { printf } from '../../../text/printf.ts';
import { displayWrappedString, lineWrap, TextFlag } from '../../../text/wrap.ts';
import { MercTextBox } from '../../../widgets/merc-text-box.ts';
import { MessageBoxFlag } from '../../../widgets/message-box.ts';
import { portraitPath } from '../../../widgets/portrait.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { Conference, ContractLength, TITLE_ITERATIONS, talkingTime, titleBarRect, VideoMode } from './aim-conference.ts';
import { aimBar, aimChrome, mugShotState } from './aim-pages.ts';

export const AIM_MEMBER_LAYOUT = 'aim-member';
const STAT_NAMES = [
  'str_stat_health',
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
const EXPERIENCE_ROW = 6;
const HIGH_STAT = 80;
const DOT_STEP = 7;
const WEAPONBOX_NUMBER = 8;
const AIM_BIOS_FILE = 'binarydata/aimbios.edt';
const BIO_COLUMNS = 2;
const CHARACTER_INFO = 'CharacterInfo';
const AIM_MEMBER_OPTIONAL_GEAR = 10;
const AIM_MEMBER_MEDICAL_DEPOSIT_REQ = 11;
const AIM_POPUP_TEXT = 'AimPopUpText';
const AIM_MEMBER_DEAD = 5;
const AIM_MEMBER_ON_ASSIGNMENT = 3;
const AIM_MEMBER_ALREADY_HAVE_20_MERCS = 6;
const AIM_MEMBER_FUNDS_TRANSFER_SUCCESFUL = 0;
const AIM_MEMBER_FUNDS_TRANSFER_FAILED = 1;
const AIM_MEMBER_NOT_ENOUGH_FUNDS = 2;
const AIM_MEMBER_MESSAGE_RECORDED = 8;
const VIDEO_TEXT = 'VideoConfercingText';
const AIM_MEMBER_VIDEO_CONF_WITH = 12;
const AIM_MEMBER_WITH_MEDICAL = 14;
const POW_STRINGS = 'pPOWStrings';
const MERC_INFO = 'MercInfo';
const MERC_FILES_ALREADY_HIRED = 5;
const MESSAGE_STRINGS = 'pMessageStrings';
const MSG_JUST_HIRED_MERC_ARRIVAL_LOCATION_POPUP = 66;
const TOWN_NAMES = 'strategic-map-town-names';
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const FACE_SOURCE = 'aimVideoFace';
const TITLE_SOURCE = 'aimVideoTitle';
const SMALL_FACE_WIDTH = 48;
const SMALL_FACE_HEIGHT = 43;
const SPEECH_VOLUME = 127;
const GERMAN_DATA = 'german';
const AIM_MEMBER_PRERECORDED_MESSAGE = 7;
const CAPTION_COLOR = 145;
const CAPTION_DY = 20;
const CAPTION_GAP = 2;
const POPUP_TEXT_COLOR = 0;
const POPUP_TEXT_SHADOW = 170;
const POPUP_GAP = 2;
const POPUP_SECOND_DY = 4;
const NO_FACE = -1;
const GREEN = 0x00ff00;
const BLACK = 0x000000;
const VIDEO_TITLE_ASSET = 'laptop/videotitlebar.sti';
const SNOW_ASSET = 'laptop/bwsnow.sti';

export const AIM_MEMBER_CONTRACT: ControllerContract = {
  id: 'aimMember',
  actions: {
    prev: {},
    next: {},
    contact: {},
    faceClick: {},
    faceRight: {},
    faceHover: { args: 1 },
    hire: {},
    hangUp: {},
    contract: { args: 1 },
    equipment: { args: 1 },
    transfer: {},
    cancel: {},
    leaveMessage: {},
    popupOk: {},
    shutUp: {},
  },
  bindings: {
    name: 'string',
    stats: 'list',
    salaryDay: 'string',
    salaryWeek: 'string',
    salaryTwoWeeks: 'string',
    medicalNormal: 'list',
    medicalTall: 'list',
    medicalText: 'string',
    medicalLift: 'number',
    bio: 'string',
    additionalInfo: 'string',
    hasAdditional: 'boolean',
    gearCost: 'string',
    gearShift: 'number',
    kit: 'list',
    nameBox: 'number',
    face: 'number',
    faceState: 'string',
    faceOverlay: 'string',
    contactEnabled: 'boolean',
    faceHelp: 'boolean',
    terminal: 'boolean',
    connecting: 'boolean',
    conferencing: 'boolean',
    confTitle: 'string',
    firstContact: 'boolean',
    hireMode: 'boolean',
    answeringMachine: 'boolean',
    unavailable: 'boolean',
    chargeText: 'string',
    buyEnabled: 'boolean',
    hireButtonsEnabled: 'boolean',
    hireEnabled: 'boolean',
    leaveEnabled: 'boolean',
    answeringEnabled: 'boolean',
    popup: 'boolean',
    closeEnabled: 'boolean',
    talking: 'boolean',
  },
};

interface KitCell {
  readonly present: boolean;
  readonly graphic: { readonly path: string; readonly frame: number } | null;
  readonly count: string;
  readonly name: string;
  readonly oneLine: boolean;
  readonly twoLines: boolean;
}

const EMPTY_CELL: KitCell = { present: false, graphic: null, count: '', name: '', oneLine: false, twoLines: false };

function statValues(merc: AimMercView): number[] {
  const s = merc.stats;
  return [
    s.health,
    s.agility,
    s.dexterity,
    s.strength,
    s.leadership,
    s.wisdom,
    s.experience,
    s.marksmanship,
    s.mechanical,
    s.explosives,
    s.medical,
  ];
}

function threeDigits(n: number): string {
  return String(n).padStart(3, '0');
}

export function aimMemberPage(context: LaptopContext): LaptopPage {
  const memory = context.aim.memory;
  const fonts = context.services.fonts;
  const model: Record<string, unknown> = {};
  let hovering = false;
  let subtitle: string | null = null;
  let speaker = NO_FACE;
  let charge: number | null = null;
  let chargeKey = '';
  let disposed = false;
  const mercs = () => context.view()?.aim ?? [];
  const current = () => context.aim.current(mercs());
  const faceOf = (merc: AimMercView) => context.data.profile(merc.profile)?.faceIndex ?? merc.profile;

  const conference = new Conference(
    {
      contact: () => current()?.contact ?? 'answeringMachine',
      hasKit: () => current()?.kit !== null && current()?.kit !== undefined,
      hireCheck: async () => {
        const merc = current();
        if (!merc) return { accepted: false, quote: null };
        const reply = await context.command({ type: 'hireCheck', profile: merc.profile });
        const data = reply.data as { accepted?: boolean; quote?: { id: number } | null } | undefined;
        return { accepted: reply.ok && data?.accepted === true, quote: data?.quote?.id ?? null };
      },
      hire: async (contract, gear) => {
        const merc = current();
        if (!merc) return 'refused';
        const reply = await context.command({ type: 'aimHire', profile: merc.profile, contract, gear });
        if (reply.ok) {
          const arrival = (reply.data as { arrival?: { minute: number; sector: string } } | undefined)?.arrival;
          memory.lastHired = { profile: merc.profile, arrivalMinute: arrival?.minute ?? 0, sector: arrival?.sector ?? '' };
          return 'hired';
        }
        if (reply.reason === 'funds') return 'funds';
        if (reply.reason === 'teamFull') return 'teamFull';
        return 'refused';
      },
      leaveMessage: () => {
        const merc = current();
        if (merc) void context.command({ type: 'aimLeaveMessage', profile: merc.profile });
      },
      say: (quote) => {
        const merc = current();
        if (!merc) return 0;
        const voice = threeDigits(merc.profile);
        const text = context.text.edt(`mercedt/${voice}.edt`, quote) ?? '';
        subtitle = context.settings.subtitles ? `"${text}"` : null;
        speaker = merc.profile;
        if (context.settings.speech) context.playSound(`speech/${voice}_${threeDigits(quote)}.wav`, SPEECH_VOLUME);
        return talkingTime(text);
      },
      stopTalking: () => {
        subtitle = null;
      },
      popdownDone: () => arrivalBox(),
      teamFullBox: () => context.messageBox(context.string(AIM_POPUP_TEXT, AIM_MEMBER_ALREADY_HAVE_20_MERCS), MessageBoxFlag.OK),
    },
    context.settings.slideStepMs ?? 16,
  );

  const sectorLabel = (sector: string): string => {
    const town = context.client.strategic()?.sectors.find((s) => s.sector === sector)?.town ?? 0;
    return town > 0 ? `${sector}: ${context.string(TOWN_NAMES, town)}` : sector;
  };

  const arrivalBox = (): void => {
    const hired = memory.lastHired;
    if (!hired) return;
    memory.lastHired = null;
    const nickname = context.data.profile(hired.profile)?.nickname ?? '';
    const day = idiv(hired.arrivalMinute, MINUTES_PER_DAY);
    const time = `${String(idiv(hired.arrivalMinute % MINUTES_PER_DAY, MINUTES_PER_HOUR)).padStart(2, '0')}:00`;
    const template = context.string(MESSAGE_STRINGS, MSG_JUST_HIRED_MERC_ARRIVAL_LOCATION_POPUP);
    const sector = sectorLabel(hired.sector);
    const args = context.dataVersion === GERMAN_DATA ? [nickname, day, time, sector] : [nickname, sector, day, time];
    context.messageBox(printf(template, args), MessageBoxFlag.OK);
  };

  const loadMerc = (): void => {
    const merc = current();
    if (!merc) return;
    void context.media.loadImages([portraitPath(faceOf(merc), 'big'), portraitPath(faceOf(merc), 'small')]);
    const graphics = (merc.kit?.items ?? []).flatMap((i) => {
      const item = context.data.item(i.item);
      return item ? [item.graphic.path] : [];
    });
    void context.media.loadImages([...new Set(graphics)]);
    void context.media.loadTexts([`mercedt/${threeDigits(merc.profile)}.edt`]);
  };

  const quoteCharge = (): void => {
    const merc = current();
    if (!merc || conference.mode !== VideoMode.HIRE) return;
    const contract = [1, 7, 14][conference.contractLength] ?? 7;
    const key = `${merc.profile}/${contract}/${conference.buyEquipment}`;
    if (key === chargeKey) return;
    chargeKey = key;
    void context.command({ type: 'aimQuote', profile: merc.profile, contract, gear: conference.buyEquipment }).then((reply) => {
      if (disposed || key !== chargeKey || !reply.ok) return;
      charge = (reply.data as { charge?: { total: number } } | undefined)?.charge?.total ?? null;
    });
  };

  const overlay = (merc: AimMercView): string => {
    switch (merc.face) {
      case 'dead':
        return context.string(AIM_POPUP_TEXT, AIM_MEMBER_DEAD);
      case 'pow':
        return context.string(POW_STRINGS, 0);
      case 'hired':
        return context.string(MERC_INFO, MERC_FILES_ALREADY_HIRED);
      case 'onAssignment':
        return context.string(AIM_POPUP_TEXT, AIM_MEMBER_ON_ASSIGNMENT);
      default:
        return '';
    }
  };

  const kitCells = (merc: AimMercView): KitCell[] => {
    const font = fonts.get(FontName.FONT10ARIAL);
    const width = context.constant(AIM_MEMBER_LAYOUT, 'AIM_MEMBER_WEAPON_NAME_WIDTH');
    const items = (merc.kit?.items ?? []).slice(0, WEAPONBOX_NUMBER);
    return Array.from({ length: WEAPONBOX_NUMBER }, (_, i): KitCell => {
      const entry = items[i];
      if (!entry) return EMPTY_CELL;
      const item = context.data.item(entry.item);
      const name = item?.shortName ?? entry.name;
      const oneLine = lineWrap(font, width, name).length === 1;
      return {
        present: true,
        graphic: item ? item.graphic : null,
        count: entry.count > 1 ? `x${entry.count}` : '',
        name,
        oneLine,
        twoLines: !oneLine,
      };
    });
  };

  const refreshMerc = (merc: AimMercView): void => {
    const font12 = fonts.get(FontName.FONT12ARIAL);
    model.name = merc.name;
    model.stats = statValues(merc).map((value, row) => {
      const high = row === EXPERIENCE_ROW || value >= HIGH_STAT;
      return { value: String(value), high, low: !high };
    });
    model.salaryDay = sprintMoney(merc.salary.day);
    model.salaryWeek = sprintMoney(merc.salary.week);
    model.salaryTwoWeeks = sprintMoney(merc.salary.twoWeeks);
    const medical =
      merc.medicalDeposit === null
        ? ''
        : `${sprintMoney(merc.medicalDeposit)} ${context.string(CHARACTER_INFO, AIM_MEMBER_MEDICAL_DEPOSIT_REQ)}`;
    const tall = medical !== '' && lineWrap(font12, context.constant(AIM_MEMBER_LAYOUT, 'AIM_MEDICAL_DEPOSIT_WIDTH'), medical).length > 2;
    model.medicalText = medical;
    model.medicalNormal = medical !== '' && !tall ? [1] : [];
    model.medicalTall = tall ? [1] : [];
    model.medicalLift = -fontHeight(font12);
    const bioRow = context.data.profile(merc.profile)?.aimBio ?? null;
    model.bio = bioRow === null ? '' : (context.text.edt(AIM_BIOS_FILE, bioRow * BIO_COLUMNS) ?? '');
    model.additionalInfo = bioRow === null ? '' : (context.text.edt(AIM_BIOS_FILE, bioRow * BIO_COLUMNS + 1) ?? '');
    model.hasAdditional = model.additionalInfo !== '';
    model.gearCost = sprintMoney(merc.kit?.cost ?? 0);
    model.gearShift = stringPixLength(context.string(CHARACTER_INFO, AIM_MEMBER_OPTIONAL_GEAR), font12) + 5;
    model.kit = kitCells(merc);
    model.nameBox = 2 * fontHeight(fonts.get(FontName.FONT10ARIAL));
    model.face = faceOf(merc);
    model.faceState = mugShotState(merc);
    model.faceOverlay = overlay(merc);
    model.contactEnabled = merc.face !== 'dead';
  };

  const refreshConference = (merc: AimMercView): void => {
    const mode = conference.mode;
    model.terminal = conference.terminalShown;
    model.connecting = mode === VideoMode.INIT;
    model.conferencing = conference.terminalShown && mode !== VideoMode.INIT;
    model.confTitle = `${context.string(VIDEO_TEXT, AIM_MEMBER_VIDEO_CONF_WITH)} ${merc.name}`;
    model.firstContact = mode === VideoMode.FIRST_CONTACT;
    model.hireMode = mode === VideoMode.HIRE;
    model.answeringMachine = mode === VideoMode.ANSWERING_MACHINE;
    model.unavailable = mode === VideoMode.UNAVAILABLE;
    model.lights = [
      conference.contractLength === ContractLength.ONE_DAY,
      conference.contractLength === ContractLength.ONE_WEEK,
      conference.contractLength === ContractLength.TWO_WEEKS,
      !conference.buyEquipment,
      conference.buyEquipment,
    ].map((on) => ({ on, off: !on }));
    const amount = charge === null ? '' : sprintMoney(charge);
    model.chargeText = merc.medicalDeposit === null ? amount : `${amount} ${context.string(VIDEO_TEXT, AIM_MEMBER_WITH_MEDICAL)}`;
    model.buyEnabled = merc.kit !== null && !conference.hireButtonsDisabled;
    model.hireButtonsEnabled = !conference.hireButtonsDisabled;
    model.hireEnabled = !conference.hireDisabled;
    model.leaveEnabled = !merc.messageLeft && !conference.answeringButtonsDisabled;
    model.answeringEnabled = !conference.answeringButtonsDisabled;
    const popup = conference.popup;
    model.popup = popup !== null;
    model.popupText1 =
      popup?.kind === 'success'
        ? context.string(AIM_POPUP_TEXT, AIM_MEMBER_FUNDS_TRANSFER_SUCCESFUL)
        : popup?.kind === 'failure'
          ? context.string(AIM_POPUP_TEXT, AIM_MEMBER_FUNDS_TRANSFER_FAILED)
          : ' ';
    model.popupText2 =
      popup?.kind === 'failure'
        ? context.string(AIM_POPUP_TEXT, AIM_MEMBER_NOT_ENOUGH_FUNDS)
        : popup?.kind === 'message'
          ? context.string(AIM_POPUP_TEXT, AIM_MEMBER_MESSAGE_RECORDED)
          : '';
    model.closeEnabled = popup === null;
    model.talking = conference.talking;
  };

  const refresh = (now: number): void => {
    conference.update(now);
    const merc = current();
    if (!merc) return;
    quoteCharge();
    refreshMerc(merc);
    refreshConference(merc);
    model.faceHelp = hovering && !conference.displayed;
  };

  const switchMerc = (delta: number): void => {
    conference.close();
    context.aim.step(mercs(), delta);
    chargeKey = '';
    charge = null;
    loadMerc();
  };

  const controller = new ViewModelController(AIM_MEMBER_CONTRACT, model, {
    prev: () => switchMerc(-1),
    next: () => switchMerc(1),
    contact: () => conference.open(context.services.clock.ja2Now),
    faceClick: () => {
      if (current()?.face !== 'dead') conference.open(context.services.clock.ja2Now);
    },
    faceRight: () => context.shell.setPage(LaptopMode.AIM_MEMBERS_FACIAL_INDEX),
    faceHover: ([on]) => {
      hovering = on === 1;
    },
    hire: () => conference.hire(),
    hangUp: () => conference.hangUp(),
    contract: ([i]) => conference.setContract(i ?? ContractLength.ONE_WEEK),
    equipment: ([i]) => conference.setEquipment(i === 1),
    transfer: () => conference.transferFunds(),
    cancel: () => conference.cancelHire(),
    leaveMessage: () => conference.leaveMessage(),
    popupOk: () => conference.popupOk(),
    shutUp: () => conference.stopTalking(),
  });

  const drawDots = (list: DrawList, _rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void => {
    const font = fonts.get(FontName.FONT12ARIAL);
    const color = view.model.color('AIM_M_COLOR_STATIC_TEXT', 0);
    const rows = Array.isArray(params.rows) ? (params.rows as [string, string][]) : [];
    const nameWidth = view.number('STAT_NAME_WIDTH', {});
    rows.forEach(([x, y], row) => {
      const left = view.frame.x + view.number(x, {});
      const top = view.frame.y + view.number(y, {});
      const label = context.string(STAT_NAMES[row] ?? STAT_NAMES[0]);
      const end = left + stringPixLength(label, font);
      for (let at = left + nameWidth; end <= at; at -= DOT_STEP) mprint(list, font, at, top, '.', fontColors(color));
    });
  };

  const drawTerminalShadow = (list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>): void => {
    if (!conference.terminalShown) return;
    const asset = typeof params.asset === 'string' ? params.asset : '';
    const frame = context.services.images.info(asset)?.frames[0];
    if (!frame) return;
    const { x, y } = rect;
    list.shadow(x + 3, y + frame.height, x + frame.width, y + frame.height + 3);
    list.shadow(x + frame.width, y + 3, x + frame.width + 3, y + frame.height);
  };

  const drawFaceSource = (list: DrawList, rect: Area): void => {
    if (!conference.terminalShown || conference.face !== 'face') return;
    const merc = current();
    if (!merc) return;
    list.image(portraitPath(faceOf(merc), 'small'), 0, rect.x, rect.y);
    list.capture(FACE_SOURCE);
  };

  const drawFace = (list: DrawList, rect: Area): void => {
    if (!conference.terminalShown) return;
    if (conference.face === 'black') list.fill(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, BLACK);
    else if (conference.face === 'snow') list.image(SNOW_ASSET, conference.snowFrame, rect.x, rect.y);
    else if (conference.face === 'face') {
      list.snapshot(FACE_SOURCE, { x: rect.x, y: rect.y, width: SMALL_FACE_WIDTH, height: SMALL_FACE_HEIGHT }, rect);
      if (conference.mode === VideoMode.ANSWERING_MACHINE) {
        list.shadow(rect.x, rect.y, rect.x + rect.width - 1, rect.y + rect.height - 1);
        const caption = context.string(AIM_POPUP_TEXT, AIM_MEMBER_PRERECORDED_MESSAGE);
        const font = fonts.get(FontName.FONT14ARIAL);
        displayWrappedString(
          list,
          rect.x,
          rect.y + CAPTION_DY,
          rect.width,
          CAPTION_GAP,
          font,
          fontColors(CAPTION_COLOR),
          caption,
          TextFlag.CENTER_JUSTIFIED,
        );
      }
    }
  };

  const drawLight = (list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>): void => {
    if (conference.mode !== VideoMode.HIRE) return;
    const index = typeof params.index === 'number' ? params.index : 0;
    const on = (model.lights as { on: boolean }[] | undefined)?.[index]?.on === true;
    list.fill(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, on ? GREEN : BLACK);
  };

  const drawPopupTexts = (list: DrawList, rect: Area): void => {
    const popup = conference.popup;
    if (!popup) return;
    const font = fonts.get(FontName.FONT12ARIAL);
    const colors = fontColors(POPUP_TEXT_COLOR, POPUP_TEXT_SHADOW);
    const first = String(model.popupText1 ?? '');
    const second = String(model.popupText2 ?? '');
    let y = rect.y;
    if (first !== '') y += displayWrappedString(list, rect.x, y, rect.width, POPUP_GAP, font, colors, first, TextFlag.CENTER_JUSTIFIED);
    if (second !== '')
      displayWrappedString(list, rect.x, y + POPUP_SECOND_DY, rect.width, POPUP_GAP, font, colors, second, TextFlag.CENTER_JUSTIFIED);
  };

  const drawSubtitle = (list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void => {
    if (!subtitle || !conference.talking || speaker !== current()?.profile) return;
    const style = typeof params.style === 'string' ? params.style : '';
    const box = new MercTextBox(
      textBoxArt(view.model, view.model.style(style)),
      { text: subtitle, width: rect.width, marginX: 0, marginTop: 0, marginBottom: 0, icon: 'none' },
      { text: fonts.get(FontName.FONT12ARIAL), bold: fonts.get(FontName.FONT10ARIALBOLD) },
    );
    const right = view.frame.x + view.number('LAPTOP_SCREEN_LR_X', {});
    box.render(list, idiv(view.frame.x + right - box.width, 2), rect.y);
  };

  loadMerc();
  void context.media.loadTexts([AIM_BIOS_FILE]);
  void context.media.loadImages([SNOW_ASSET, VIDEO_TITLE_ASSET]);
  if (memory.conferenceSubPage !== VideoMode.NOT_DISPLAYED) memory.conferenceSubPage = VideoMode.NOT_DISPLAYED;
  refresh(context.services.clock.ja2Now);

  return {
    layouts: [aimChrome(context), { name: AIM_MEMBER_LAYOUT, controller }, aimBar(context, LaptopMode.AIM_MEMBERS)],
    custom: {
      statDots: drawDots,
      terminalShadow: drawTerminalShadow,
      videoFaceSource: drawFaceSource,
      videoFace: drawFace,
      selectLight: drawLight,
      subtitle: drawSubtitle,
      popupTexts: drawPopupTexts,
    },
    update: refresh,
    dispose: () => {
      disposed = true;
      conference.close();
    },
    blocksNewMail: () => conference.displayed,
    renderOverlay: (list, redraw) => {
      if (conference.mode !== VideoMode.POPUP && conference.mode !== VideoMode.POPDOWN) return;
      const width = context.constant(AIM_MEMBER_LAYOUT, 'AIM_MEMBER_VIDEO_TITLE_BAR_WIDTH');
      const height = context.constant(AIM_MEMBER_LAYOUT, 'AIM_MEMBER_VIDEO_TITLE_BAR_HEIGHT');
      const fromY = context.constant(AIM_MEMBER_LAYOUT, 'AIM_MEMBER_VIDEO_TITLE_START_Y');
      const { stdX, stdY } = context.services.geometry();
      const step = Math.min(conference.titleStep, TITLE_ITERATIONS - 1);
      const rect = titleBarRect(step, fromY, 96);
      list.image(VIDEO_TITLE_ASSET, 0, stdX, stdY);
      list.capture(TITLE_SOURCE);
      redraw(list);
      list.snapshot(TITLE_SOURCE, { x: stdX, y: stdY, width, height }, { x: stdX + rect.x, y: stdY + rect.y, width: rect.width, height });
    },
  };
}
