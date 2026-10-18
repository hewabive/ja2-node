import { type CreditNode, FontColour } from '../../content/formats/credits.ts';
import { integerScale } from '../video/player.ts';
import { CREDIT_TEXT_WIDTH, CREDIT_TEXT_X, CREDITS_SCREEN_HEIGHT, CREDITS_SCREEN_WIDTH, CreditRoll, type RolledNode } from './roll.ts';
import { CreditRowFeed, type FetchCreditRow, fetchCreditRow } from './rows.ts';

export type CreditsOutcome = 'finished' | 'escaped';

export interface CreditsMonitor {
  running: boolean;
  rowsRead: number;
  nodesShown: number;
  visible: number;
  scrolledPixels: number;
  outcome: CreditsOutcome | null;
  error: string | null;
}

export interface CreditsOptions {
  readonly parent?: HTMLElement;
  readonly fetchRow?: FetchCreditRow;
  readonly monitor?: CreditsMonitor;
  readonly signal?: AbortSignal;
}

const END_KEY = 'Escape';
const OVERLAY_Z_INDEX = '1000';
const TITLE_FONT_PX = 14;
const ACTIVE_FONT_PX = 12;
const LINE_GAP_PX = 2;
const TEXT_TOP_PADDING_PX = 1;
const DEFAULT_COLOUR = '#c8c8c8';
const FONT_COLOUR_CSS: Readonly<Record<number, string>> = {
  [FontColour.WHITE]: '#ffffff',
  [FontColour.DARK_WHITE]: DEFAULT_COLOUR,
  [FontColour.DARK_GRAY]: '#7c7c7c',
  [FontColour.LIGHT_BLUE]: '#7ca8ff',
  [FontColour.LIGHT_RED]: '#ff7c7c',
  [FontColour.RED]: '#e03c3c',
  [FontColour.DARK_RED]: '#a02020',
};

export function createCreditsMonitor(): CreditsMonitor {
  return { running: false, rowsRead: 0, nodesShown: 0, visible: 0, scrolledPixels: 0, outcome: null, error: null };
}

function createStage(parent: HTMLElement): { overlay: HTMLDivElement; column: HTMLDivElement } {
  const overlay = document.createElement('div');
  overlay.className = 'ja2-credits';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: '#000',
    display: 'grid',
    placeItems: 'center',
    zIndex: OVERLAY_Z_INDEX,
  });
  const stage = document.createElement('div');
  const scale = integerScale(CREDITS_SCREEN_WIDTH, CREDITS_SCREEN_HEIGHT, globalThis.innerWidth, globalThis.innerHeight);
  Object.assign(stage.style, {
    position: 'relative',
    width: `${CREDITS_SCREEN_WIDTH}px`,
    height: `${CREDITS_SCREEN_HEIGHT}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'center',
  });
  const column = document.createElement('div');
  Object.assign(column.style, {
    position: 'absolute',
    left: `${CREDIT_TEXT_X}px`,
    top: '0',
    width: `${CREDIT_TEXT_WIDTH}px`,
    height: `${CREDITS_SCREEN_HEIGHT}px`,
    overflow: 'hidden',
  });
  stage.append(column);
  overlay.append(stage);
  parent.append(overlay);
  return { overlay, column };
}

function nodeElement(node: CreditNode): HTMLDivElement {
  const fontPx = node.title ? TITLE_FONT_PX : ACTIVE_FONT_PX;
  const element = document.createElement('div');
  element.textContent = node.text;
  Object.assign(element.style, {
    position: 'absolute',
    left: '0',
    width: `${CREDIT_TEXT_WIDTH}px`,
    boxSizing: 'border-box',
    paddingTop: `${TEXT_TOP_PADDING_PX}px`,
    font: `${node.title ? 'bold ' : ''}${fontPx}px/${fontPx + LINE_GAP_PX}px Arial, Helvetica, sans-serif`,
    color: FONT_COLOUR_CSS[node.colour] ?? DEFAULT_COLOUR,
    textAlign: node.justification,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  });
  return element;
}

export function playCredits(options: CreditsOptions = {}): Promise<CreditsOutcome> {
  const monitor = options.monitor ?? createCreditsMonitor();
  Object.assign(monitor, createCreditsMonitor(), { running: true });
  const { overlay, column } = createStage(options.parent ?? document.body);
  const feed = new CreditRowFeed(options.fetchRow ?? fetchCreditRow);
  const elements = new Map<RolledNode['node'], HTMLDivElement>();
  const measure = (node: CreditNode): number => {
    const element = nodeElement(node);
    element.style.top = `${CREDITS_SCREEN_HEIGHT}px`;
    column.append(element);
    elements.set(node, element);
    monitor.nodesShown++;
    return element.offsetHeight + TEXT_TOP_PADDING_PX;
  };
  const roll = new CreditRoll(performance.now(), () => feed.take(), measure);
  return new Promise((resolve) => {
    let frame = 0;
    const finish = (outcome: CreditsOutcome) => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      options.signal?.removeEventListener('abort', onAbort);
      overlay.remove();
      Object.assign(monitor, { running: false, outcome, error: feed.error });
      resolve(outcome);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === END_KEY) finish('escaped');
    };
    const onAbort = () => finish('escaped');
    window.addEventListener('keyup', onKeyUp, { capture: true });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const tick = (now: number) => {
      const before = roll.nodes[0]?.y ?? null;
      roll.update(now);
      const after = roll.nodes[0]?.y ?? null;
      if (before !== null && after !== null && after < before) monitor.scrolledPixels += before - after;
      const alive = new Set(roll.nodes.map((rolled) => rolled.node));
      for (const [node, element] of elements) {
        if (alive.has(node)) continue;
        element.remove();
        elements.delete(node);
      }
      for (const rolled of roll.nodes) {
        const element = elements.get(rolled.node);
        if (element) element.style.top = `${rolled.y}px`;
      }
      monitor.rowsRead = roll.rowsRead;
      monitor.visible = roll.nodes.length;
      if (roll.finished) finish('finished');
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}
