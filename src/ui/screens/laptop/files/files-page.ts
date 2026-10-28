// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Files.cc EnterFiles (the last unread file when entered from the new-file icon), DisplayFilesList
// @src (pFilesSenderList in FILES_TEXT_FONT, the highlighted row filled with 240, 240, 200), FilesBtnCallBack (a click
// @src clears the selection and selects a row that holds a file, back on page 0), DisplayFileMessage and
// @src DisplayFormattedText (the white viewer, fRead set while the file is shown, a stale selection dropped),
// @src LoadStringsIntoFileList (FILE_STRING_SIZE records of ris.edt and files.edt), LoadPreviousPage, LoadNextPage,
// @src ScrollRegionCallback, HandleFileViewerButtonStates; iHighLightFileLine and giFilesPage kept across laptop sessions.

import type { LaptopView } from '../../../../protocol/view.ts';
import type { Area, DrawList } from '../../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LayoutView } from '../../../layout/view.ts';
import { FontName } from '../../../text/fonts.ts';
import { IAN_WRAP_NO_SHADOW, ianDisplayWrappedString, ianWrappedStringHeight } from '../../../text/wrap.ts';
import { portraitPath } from '../../../widgets/portrait.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { NO_FILE } from '../pages-memory.ts';
import {
  ENRICO_FILE,
  enricoFilePage,
  type FileGeometry,
  type FileLine,
  type FilePage,
  fileLength,
  fileOffset,
  fileProfile,
  lastUnreadFile,
  type Measure,
  terroristFilePage,
} from './file-pages.ts';

export const FILES_LAYOUT = 'laptop-files';
export const MAX_FILES_PAGE = 28;
export const RIS_TEXT_FILE = 'binarydata/ris.edt';
export const FILES_TEXT_FILE = 'binarydata/files.edt';
const SENDER_LIST = 'pFilesSenderList';
const FIRST_PAGE = 0;
const TEXT_COLORS = { foreground: 0, shadow: 0, background: 0 } as const;
const FILES_TITLE_FONT = FontName.FONT14ARIAL;
const FILES_TEXT_FONT = FontName.FONT10ARIAL;
const BOLD_FONT = FontName.FONT10ARIALBOLD;

export const FILES_CONTRACT: ControllerContract = {
  id: 'laptopFiles',
  actions: { selectRow: { args: 1 }, prevPage: {}, nextPage: {} },
  bindings: {
    rows: 'list',
    viewerOpen: 'boolean',
    portraitShown: 'boolean',
    portraitFace: 'number',
    picture: 'string',
    prevEnabled: 'boolean',
    nextEnabled: 'boolean',
  },
};

interface FileRow {
  readonly present: boolean;
  readonly highlighted: boolean;
  readonly sender: string;
}

const EMPTY_ROW: FileRow = { present: false, highlighted: false, sender: '' };

export function selectedAfterClick(row: number, files: number): number {
  return row < files ? row : NO_FILE;
}

export function filesPage(context: LaptopContext): LaptopPage {
  const memory = context.memory.pages;
  const constant = (name: string) => context.constant(FILES_LAYOUT, name);
  const fonts = context.services.fonts;
  const bold = fonts.get(BOLD_FONT);
  const gap = constant('FILE_GAP');
  const fontOf = (title: boolean) => fonts.get(title ? FILES_TITLE_FONT : FILES_TEXT_FONT);
  const measure: Measure = (width, title, text) => ianWrappedStringHeight(width, gap, fontOf(title), text, bold);
  const geometry: FileGeometry = {
    viewerX: constant('FILE_VIEWER_X'),
    viewerY: constant('FILE_VIEWER_Y'),
    pageSize: constant('MAX_FILE_MESSAGE_PAGE_SIZE'),
  };
  const model: Record<string, unknown> = {};
  const requested = new Set<number>();
  let onLastPage = false;
  let shown: FilePage | null = null;
  let loadedFace: number | null = null;
  void context.media.loadTexts([RIS_TEXT_FILE, FILES_TEXT_FILE]);
  const files = (): LaptopView['files'] => context.view()?.files ?? [];
  const records = (code: number): string[] => {
    const file = code === ENRICO_FILE ? RIS_TEXT_FILE : FILES_TEXT_FILE;
    return Array.from({ length: fileLength(code) }, (_, k) => context.text.edt(file, fileOffset(code) + k) ?? '');
  };
  const faceOf = (code: number): number | null => {
    const profile = fileProfile(code);
    return profile === null ? null : (context.data.profile(profile)?.faceIndex ?? null);
  };
  const openLastUnread = () => {
    if (context.takeOpenUnreadFileRequest()) memory.fileSelected = lastUnreadFile(files());
  };
  const layoutFile = (code: number): FilePage => {
    const page = memory.filePage;
    return code === ENRICO_FILE
      ? enricoFilePage(records(code), measure, page, geometry)
      : terroristFilePage(records(code), measure, page, geometry);
  };
  const markRead = (code: number, read: boolean) => {
    if (read || requested.has(code)) return;
    requested.add(code);
    void context.command({ type: 'readFile', code });
  };
  const refresh = () => {
    openLastUnread();
    const list = files();
    if (memory.fileSelected >= list.length) memory.fileSelected = NO_FILE;
    const open = list[memory.fileSelected];
    shown = open ? layoutFile(open.code) : null;
    if (open && shown) {
      onLastPage = shown.onLastPage;
      markRead(open.code, open.read);
    }
    model.rows = Array.from({ length: MAX_FILES_PAGE }, (_, i): FileRow => {
      const f = list[i];
      if (!f) return EMPTY_ROW;
      return { present: true, highlighted: i === memory.fileSelected, sender: context.string(SENDER_LIST, f.code) };
    });
    model.viewerOpen = shown !== null;
    const face = open ? faceOf(open.code) : null;
    model.portraitShown = shown?.portraitBefore !== null && shown?.portraitBefore !== undefined && face !== null;
    model.portraitFace = face ?? -1;
    if (face !== null && face !== loadedFace) {
      loadedFace = face;
      void context.media.loadImages([portraitPath(face, 'big')]);
    }
    model.picture = shown?.picture ?? '';
    model.prevEnabled = shown !== null && memory.filePage !== FIRST_PAGE;
    model.nextEnabled = shown !== null && !onLastPage;
  };
  const controller = new ViewModelController(FILES_CONTRACT, model, {
    selectRow: ([i]) => {
      memory.fileSelected = NO_FILE;
      const selected = selectedAfterClick(i ?? 0, files().length);
      if (selected === NO_FILE) return;
      memory.filePage = FIRST_PAGE;
      memory.fileSelected = selected;
    },
    prevPage: () => {
      if (memory.filePage !== FIRST_PAGE) memory.filePage--;
    },
    nextPage: () => {
      if (!onLastPage) memory.filePage++;
    },
  });
  const drawLines = (list: DrawList, view: LayoutView, lines: readonly FileLine[]) => {
    for (const line of lines)
      ianDisplayWrappedString(
        list,
        view.frame.x + line.x,
        view.frame.y + line.y,
        line.width,
        gap,
        fontOf(line.title),
        TEXT_COLORS,
        line.text,
        {
          bold,
          flags: IAN_WRAP_NO_SHADOW,
        },
      );
  };
  const head = (list: DrawList, _rect: Area, _params: Readonly<Record<string, unknown>>, view: LayoutView) => {
    if (!shown || shown.portraitBefore === null) return;
    drawLines(list, view, shown.lines.slice(0, shown.portraitBefore));
  };
  const tail = (list: DrawList, _rect: Area, _params: Readonly<Record<string, unknown>>, view: LayoutView) => {
    if (!shown) return;
    drawLines(list, view, shown.portraitBefore === null ? shown.lines : shown.lines.slice(shown.portraitBefore));
  };
  refresh();
  return { layouts: [{ name: FILES_LAYOUT, controller }], custom: { fileTextHead: head, fileTextTail: tail }, update: refresh };
}
