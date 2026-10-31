// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Mercs.cc EnterMercs (the visit only when entering from outside the site, the files button disabled
// @src without an account), RenderMercs, BtnAccountBoxButtonCallback, BtnFileBoxButtonCallback, ExitMercs (Speck stops),
// @src DisplayTextForSpeckVideoPopUp (the subtitle in quotes, at most 300 wide, centred on the laptop screen at
// @src MERC_TEXT_BOX_POS_Y), HandleSpeckTalking (the 48 x 43 face stretched to the video face rectangle);
// @src src/game/Laptop/Mercs_No_Account.cc BtnOpenAccountBoxButtonCallback (Speck thanks the player on the home page),
// @src BtnCancelBoxButtonCallback; src/game/Laptop/Mercs_Account.cc RenderMercsAccount (the account number "%05d"),
// @src DisplayHiredMercs (the mercs on the team or owed money, red when dead, "$%6d"), BtnMercAuthorizeButtonCallback,
// @src MercAuthorizePaymentMessageBoxCallBack, HandleMercsAccount (the transfer failure box, an English literal in
// @src Stracciatella), BtnMercBackButtonCallback; src/game/Laptop/Mercs_Files.cc RenderMercsFiles (the hire button enabled
// @src for a living merc on a valid, warned or suspended account), DisplayMercFace (dead in red, married, P.O.W., hired,
// @src unavailable), LoadAndDisplayMercBio, DisplayMercsStats (the current life, three-pixel numerals, the salary after
// @src its label), BtnMercPrevButtonCallback, BtnMercNextButtonCallback, BtnMercHireButtonCallback, MercFilesHireMerc,
// @src BtnMercFilesBackButtonCallback, EnableDisableMercFilesNextPreviousButton; src/game/Laptop/BrokenLink.cc
// @src RenderBrokenLink.

import { type DataVersion, displayLanguageOf } from '../../../../content/text/data-version.ts';
import { idiv } from '../../../../core/int.ts';
import { refusalOf } from '../../../../protocol/refusals.ts';
import type { MercListingView, MercSiteView } from '../../../../protocol/view.ts';
import type { Area, DrawList } from '../../../draw-list.ts';
import { MouseReason, Priority } from '../../../input/mouse.ts';
import type { MouseRegion } from '../../../input/regions.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { textBoxArt } from '../../../layout/styles.ts';
import type { LayoutView } from '../../../layout/view.ts';
import { FontName } from '../../../text/fonts.ts';
import { Labels } from '../../../text/labels.ts';
import { stringPixLength } from '../../../text/measure.ts';
import { sprintMoney } from '../../../text/money.ts';
import { printf } from '../../../text/printf.ts';
import { MercTextBox } from '../../../widgets/merc-text-box.ts';
import { MessageBoxFlag, MessageBoxReturn, MessageBoxStyleId } from '../../../widgets/message-box.ts';
import { portraitPath } from '../../../widgets/portrait.ts';
import { talkingTime } from '../aim/aim-conference.ts';
import { showArrivalBox } from '../arrival-box.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { MERC_SUB_PAGES } from './merc-session.ts';
import { SpeckMode, SpeckVideo } from './speck-video.ts';

export const MERC_HOME_LAYOUT = 'merc-home';
export const MERC_NO_ACCOUNT_LAYOUT = 'merc-no-account';
export const MERC_ACCOUNT_LAYOUT = 'merc-account';
export const MERC_FILES_LAYOUT = 'merc-files';
export const BROKEN_LINK_LAYOUT = 'broken-link';
export const SPECK = 159;

const SPEECH_VOLUME = 127;
const NPC_SPEECH_DIR = 'npc_speech';
const FACE_SOURCE = 'speckVideoFace';
const SMALL_FACE_WIDTH = 48;
const SMALL_FACE_HEIGHT = 43;
const SUBTITLE_WIDTH = 300;
const MERC_ACCOUNT_TEXT = 'MercAccountText';
const MERC_INFO = 'MercInfo';
const POW_STRINGS = 'pPOWStrings';
const DEPARTED_STRINGS = 'pPersonnelDepartedStateStrings';
const MARRIED_STATE = 2;
const ACCOUNT_DIGITS = 5;
const MONEY_DIGITS = 6;
const SALARY_GAP = 1;
const HIRE_ACCOUNTS: ReadonlySet<string> = new Set(['valid', 'suspended', 'firstWarning']);

function threeDigits(n: number): string {
  return String(n).padStart(3, '0');
}

function dollars(amount: number): string {
  return `$${String(amount).padStart(MONEY_DIGITS, ' ')}`;
}

function mercSite(context: LaptopContext): MercSiteView | null {
  return context.view()?.merc ?? null;
}

export const MERC_HOME_CONTRACT: ControllerContract = {
  id: 'mercHome',
  actions: { account: {}, files: {}, closeVideo: {} },
  bindings: {
    hasAccount: 'boolean',
    noAccount: 'boolean',
    filesEnabled: 'boolean',
    video: 'boolean',
    black: 'boolean',
    faceShown: 'boolean',
  },
};

export const MERC_NO_ACCOUNT_CONTRACT: ControllerContract = { id: 'mercNoAccount', actions: { open: {}, cancel: {} }, bindings: {} };

export const MERC_ACCOUNT_CONTRACT: ControllerContract = {
  id: 'mercAccount',
  actions: { authorize: {}, home: {} },
  bindings: { accountNumber: 'string', rows: 'list', total: 'string', authorizeEnabled: 'boolean' },
};

export const MERC_FILES_CONTRACT: ControllerContract = {
  id: 'mercFiles',
  actions: { previous: {}, next: {}, hire: {}, home: {} },
  bindings: {
    face: 'number',
    faceState: 'string',
    overlay: 'string',
    name: 'string',
    bio: 'string',
    additional: 'string',
    hasAdditional: 'boolean',
    stats: 'list',
    salary: 'string',
    salaryX: 'number',
    hireEnabled: 'boolean',
    previousEnabled: 'boolean',
    nextEnabled: 'boolean',
  },
};

export const BROKEN_LINK_CONTRACT: ControllerContract = { id: 'brokenLink', actions: {}, bindings: {} };

function speckFace(context: LaptopContext): number {
  return context.data.profile(SPECK)?.faceIndex ?? SPECK;
}

export function mercHomePage(context: LaptopContext): LaptopPage {
  const session = context.sites.merc;
  const fonts = context.services.fonts;
  const model: Record<string, unknown> = {};
  let subtitle: string | null = null;
  let subtitleRegion: MouseRegion | null = null;
  let disposed = false;
  const video = new SpeckVideo({
    say: (quote) => {
      const text = context.text.edt(`npcdata/${threeDigits(SPECK)}.edt`, quote) ?? '';
      subtitle = context.settings.subtitles && text !== '' ? `"${text}"` : null;
      if (context.settings.speech) context.playSound(`${NPC_SPEECH_DIR}/${threeDigits(SPECK)}_${threeDigits(quote)}.wav`, SPEECH_VOLUME);
      return talkingTime(text);
    },
    stop: () => {
      subtitle = null;
    },
  });
  const now = () => context.services.clock.ja2Now;
  const fromSubPage = MERC_SUB_PAGES.has(context.shell.previousMode);

  const refresh = (time: number) => {
    video.update(time);
    const site = mercSite(context);
    const hasAccount = site !== null && site.accountStatus !== 'noAccount';
    model.hasAccount = hasAccount;
    model.noAccount = !hasAccount;
    model.filesEnabled = hasAccount;
    model.video = video.displayed;
    model.black = video.black;
    model.faceShown = video.mode === SpeckMode.VIDEO;
    if (!video.talking) subtitle = null;
  };

  const controller = new ViewModelController(MERC_HOME_CONTRACT, model, {
    account: () => {
      const site = mercSite(context);
      context.shell.setPage(site?.accountStatus === 'noAccount' ? LaptopMode.MERC_NO_ACCOUNT : LaptopMode.MERC_ACCOUNT);
    },
    files: () => context.shell.setPage(LaptopMode.MERC_FILES),
    closeVideo: () => video.close(now()),
  });

  const drawFaceSource = (list: DrawList, rect: Area): void => {
    if (video.mode !== SpeckMode.VIDEO) return;
    list.image(portraitPath(speckFace(context), 'small'), 0, rect.x, rect.y);
    list.capture(FACE_SOURCE);
  };
  const drawFace = (list: DrawList, rect: Area): void => {
    if (video.mode !== SpeckMode.VIDEO) return;
    list.snapshot(FACE_SOURCE, { x: rect.x, y: rect.y, width: SMALL_FACE_WIDTH, height: SMALL_FACE_HEIGHT }, rect);
  };
  const drawSubtitle = (list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void => {
    if (!subtitle || !video.talking) {
      subtitleRegion?.remove();
      subtitleRegion = null;
      return;
    }
    const style = typeof params.style === 'string' ? params.style : '';
    const box = new MercTextBox(
      textBoxArt(view.model, view.model.style(style)),
      { text: subtitle, width: SUBTITLE_WIDTH, marginX: 0, marginTop: 0, marginBottom: 0, icon: 'none' },
      { text: fonts.get(FontName.FONT12ARIAL), bold: fonts.get(FontName.FONT10ARIALBOLD) },
    );
    const left = view.frame.x + view.number('LAPTOP_SCREEN_UL_X', {});
    const right = view.frame.x + view.number('LAPTOP_SCREEN_LR_X', {});
    const x = idiv(right - box.width - left, 2) + left;
    box.render(list, x, rect.y);
    if (!subtitleRegion || subtitleRegion.x1 !== x || subtitleRegion.y2 !== rect.y + box.height) {
      subtitleRegion?.remove();
      subtitleRegion = context.services.regions.define({
        x1: x,
        y1: rect.y,
        x2: x + box.width,
        y2: rect.y + box.height,
        priority: Priority.HIGH,
        owner: video,
        id: 'speckSubtitle',
        onButton: (_r, reason) => {
          if (reason & (MouseReason.LBUTTON_UP | MouseReason.RBUTTON_UP)) video.shutUp();
        },
      });
    }
  };

  const start = () => {
    void context.media.loadImages([portraitPath(speckFace(context), 'small')]);
    void context.media.loadTexts([`npcdata/${threeDigits(SPECK)}.edt`]);
    const arrival = session.takeArrival();
    if (arrival) showArrivalBox(context, arrival);
    if (fromSubPage) {
      video.enqueue(session.takeQuotes(), now());
      return;
    }
    session.takeQuotes();
    void context.command({ type: 'visitSite', site: 'merc' }).then((reply) => {
      if (disposed || !reply.ok) return;
      const speck = (reply.data as { speck?: number[] } | undefined)?.speck ?? [];
      video.enqueue(speck, now());
    });
  };

  start();
  refresh(now());
  return {
    layouts: [{ name: MERC_HOME_LAYOUT, controller }],
    custom: { speckFaceSource: drawFaceSource, speckFace: drawFace, speckSubtitle: drawSubtitle },
    update: refresh,
    dispose: () => {
      disposed = true;
      video.dispose();
      subtitleRegion?.remove();
      subtitleRegion = null;
    },
  };
}

export function mercNoAccountPage(context: LaptopContext): LaptopPage {
  const session = context.sites.merc;
  let busy = false;
  const controller = new ViewModelController(
    MERC_NO_ACCOUNT_CONTRACT,
    {},
    {
      open: () => {
        if (busy) return;
        busy = true;
        void context.command({ type: 'mercOpenAccount' }).then((reply) => {
          busy = false;
          if (reply.ok) session.pendingQuotes = (reply.data as { quotes?: number[] } | undefined)?.quotes ?? [];
          context.shell.setPage(LaptopMode.MERC);
        });
      },
      cancel: () => context.shell.setPage(LaptopMode.MERC),
    },
  );
  return { layouts: [{ name: MERC_NO_ACCOUNT_LAYOUT, controller }], update: () => undefined };
}

export function mercAccountPage(context: LaptopContext): LaptopPage {
  const session = context.sites.merc;
  const model: Record<string, unknown> = {};
  let busy = false;
  const accountText = (name: string) => context.string(MERC_ACCOUNT_TEXT, context.constant(MERC_ACCOUNT_LAYOUT, name));
  const refresh = () => {
    const site = mercSite(context);
    model.accountNumber = `${accountText('MERC_ACCOUNT_ACCOUNT')} ${String(site?.accountNumber ?? 0).padStart(ACCOUNT_DIGITS, '0')}`;
    model.rows = (site?.account ?? []).map((row) => ({
      name: row.name,
      days: String(row.days),
      rate: dollars(row.rate),
      charge: dollars(row.charge),
      dead: row.dead,
    }));
    const total = (site?.account ?? []).reduce((sum, row) => sum + row.charge, 0);
    model.total = dollars(total);
    model.authorizeEnabled = total !== 0;
  };
  const pay = () => {
    busy = true;
    void context.command({ type: 'mercPay' }).then((reply) => {
      busy = false;
      if (reply.ok) {
        session.pendingQuotes = (reply.data as { quotes?: number[] } | undefined)?.quotes ?? [];
        context.shell.setPage(LaptopMode.MERC);
        return;
      }
      if (refusalOf(reply.data) === 'funds') {
        const labels = new Labels(displayLanguageOf(context.dataVersion as DataVersion), null);
        context.messageBox(labels.text('mercTransferFailed'), MessageBoxFlag.OK, undefined, MessageBoxStyleId.BLUE_ON_GREY);
      }
    });
  };
  const controller = new ViewModelController(MERC_ACCOUNT_CONTRACT, model, {
    authorize: () => {
      if (busy || model.authorizeEnabled !== true) return;
      const total = (mercSite(context)?.account ?? []).reduce((sum, row) => sum + row.charge, 0);
      const question = printf(accountText('MERC_ACCOUNT_AUTHORIZE_CONFIRMATION'), [sprintMoney(total)]);
      context.messageBox(
        question,
        MessageBoxFlag.YESNO,
        (result) => {
          if (result === MessageBoxReturn.YES && total !== 0) pay();
        },
        MessageBoxStyleId.BLUE_ON_GREY,
      );
    },
    home: () => context.shell.setPage(LaptopMode.MERC),
  });
  refresh();
  return { layouts: [{ name: MERC_ACCOUNT_LAYOUT, controller }], update: refresh };
}

const STAT_ORDER: readonly (keyof MercListingView['stats'])[] = [
  'health',
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
];

export function mercFaceOverlay(context: LaptopContext, merc: MercListingView): { state: string; overlay: string } {
  const info = (name: string) => context.string(MERC_INFO, context.constant(MERC_FILES_LAYOUT, name));
  if (merc.state === 'dead') return { state: 'dead', overlay: info('MERC_FILES_MERC_IS_DEAD') };
  if (merc.married) return { state: 'shaded', overlay: context.string(DEPARTED_STRINGS, MARRIED_STATE) };
  if (merc.state === 'pow') return { state: 'shaded', overlay: context.string(POW_STRINGS, 0) };
  if (merc.state === 'hired') return { state: 'shaded', overlay: info('MERC_FILES_ALREADY_HIRED') };
  if (merc.state === 'onAssignment') return { state: 'shaded', overlay: info('MERC_FILES_MERC_UNAVAILABLE') };
  return { state: 'normal', overlay: '' };
}

export function mercFilesPage(context: LaptopContext): LaptopPage {
  const session = context.sites.merc;
  const model: Record<string, unknown> = {};
  const fonts = context.services.fonts;
  let busy = false;
  const listed = (): readonly MercListingView[] => mercSite(context)?.listed ?? [];
  const info = (name: string) => context.string(MERC_INFO, context.constant(MERC_FILES_LAYOUT, name));
  const current = () => listed()[session.index];
  const bioRow = (merc: MercListingView) => context.data.profile(merc.profile)?.mercBio ?? null;

  const load = () => {
    const merc = current();
    if (!merc) return;
    const face = context.data.profile(merc.profile)?.faceIndex ?? merc.profile;
    void context.media.loadImages([portraitPath(face, 'big')]);
    void context.media.loadTexts(['binarydata/mercbios.edt']);
  };

  const refresh = () => {
    const site = mercSite(context);
    const list = listed();
    if (session.index > list.length - 1) session.index = Math.max(0, list.length - 1);
    const merc = current();
    model.previousEnabled = session.index > 0;
    model.nextEnabled = session.index <= list.length - 2;
    if (!merc) {
      model.hireEnabled = false;
      return;
    }
    const face = mercFaceOverlay(context, merc);
    model.face = context.data.profile(merc.profile)?.faceIndex ?? merc.profile;
    model.faceState = face.state;
    model.overlay = face.overlay;
    model.name = merc.name;
    const row = bioRow(merc);
    model.bio = row === null ? '' : (context.text.edt('binarydata/mercbios.edt', row * 2) ?? '');
    model.additional = row === null ? '' : (context.text.edt('binarydata/mercbios.edt', row * 2 + 1) ?? '');
    model.hasAdditional = model.additional !== '';
    model.stats = STAT_ORDER.map((stat) => String(merc.stats[stat]));
    const salaryLabel = info('MERC_FILES_SALARY');
    model.salaryX =
      context.constant(MERC_FILES_LAYOUT, 'MERC_STATS_SECOND_COL_X') +
      stringPixLength(salaryLabel, fonts.get(FontName.FONT14ARIAL)) +
      SALARY_GAP;
    model.salary = `${merc.dailyFee} ${info('MERC_FILES_PER_DAY')}`;
    model.hireEnabled = merc.state !== 'dead' && HIRE_ACCOUNTS.has(site?.accountStatus ?? '');
  };

  const hire = () => {
    const merc = current();
    if (!merc || busy) return;
    busy = true;
    void context.command({ type: 'mercHire', profile: merc.profile }).then((reply) => {
      busy = false;
      const quotes = (reply.data as { quotes?: number[] } | undefined)?.quotes ?? [];
      if (reply.ok) {
        const arrival = (reply.data as { arrival?: { minute: number; sector: string } } | undefined)?.arrival;
        session.pendingQuotes = quotes;
        session.arrival = { profile: merc.profile, arrivalMinute: arrival?.minute ?? 0, sector: arrival?.sector ?? '' };
        context.shell.setPage(LaptopMode.MERC);
        return;
      }
      if (refusalOf(reply.data) === 'teamFull') {
        context.messageBox(info('MERC_FILES_HIRE_TO_MANY_PEOPLE_WARNING'), MessageBoxFlag.OK);
        return;
      }
      if (quotes.length > 0) {
        session.pendingQuotes = quotes;
        context.shell.setPage(LaptopMode.MERC);
      }
    });
  };

  const controller = new ViewModelController(MERC_FILES_CONTRACT, model, {
    previous: () => {
      if (session.index > 0) session.index--;
      load();
    },
    next: () => {
      if (session.index <= listed().length - 2) session.index++;
      load();
    },
    hire,
    home: () => context.shell.setPage(LaptopMode.MERC),
  });
  load();
  refresh();
  return { layouts: [{ name: MERC_FILES_LAYOUT, controller }], update: refresh };
}

export function brokenLinkPage(): LaptopPage {
  return {
    layouts: [{ name: BROKEN_LINK_LAYOUT, controller: new ViewModelController(BROKEN_LINK_CONTRACT, {}, {}) }],
    update: () => undefined,
  };
}
