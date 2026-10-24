import type { PlayerView } from '../../protocol/view.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import { ORIGINAL_SKIN } from '../../ui/layout/types.ts';
import { HELP_SCREEN_LAYOUT } from '../../ui/screens/help/help-overlay.ts';
import { type HelpScreenKind, mapHelpScreen } from '../../ui/screens/help/help-pages.ts';
import { type HelpSeenStore, HelpSystem } from '../../ui/screens/help/help-system.ts';
import { MapScreen } from '../../ui/screens/map/map-screen.ts';
import { helpScreenSeen, markHelpScreenSeen, updateSettings } from '../../ui/settings.ts';
import { loadSettings, saveSettings } from '../settings.ts';
import type { GamePage } from './game-page.ts';
import type { BrowserSettingsStore } from './settings-store.ts';
import { preloadLayout, type UiBoot } from './ui-boot.ts';

const TACTICAL_SCREEN = 'tactical';
const LAPTOP_SCREEN = 'laptop';
const PRE_BATTLE_PROMPT = 'preBattle';

export interface HelpHostOptions {
  readonly page: GamePage;
  readonly ui: UiBoot;
  readonly settings: BrowserSettingsStore;
  readonly campaign: () => string | null;
  readonly view: () => PlayerView | null;
}

export interface HelpHook {
  open: string | null;
  forced: boolean;
  page: number;
  top: number;
  totalLines: number;
}

export class HelpHost {
  readonly hook: HelpHook = { open: null, forced: false, page: 0, top: 0, totalLines: 0 };
  readonly #o: HelpHostOptions;
  #system: HelpSystem | null = null;

  constructor(options: HelpHostOptions) {
    this.#o = options;
  }

  async load(): Promise<void> {
    const model: LayoutModel = await this.#o.ui.layouts.load(ORIGINAL_SKIN, HELP_SCREEN_LAYOUT);
    await preloadLayout(this.#o.ui, model);
    this.#system = new HelpSystem({ runtime: this.#o.ui.runtime, text: this.#o.ui.text, model, store: () => this.#store() });
  }

  #store(): HelpSeenStore | null {
    const campaign = this.#o.campaign();
    if (!campaign) return null;
    const settings = this.#o.settings;
    return {
      hidden: () => settings.current().helpHidden,
      seen: (bit) => helpScreenSeen(settings.current(), campaign, bit),
      markSeen: (bit) => {
        const next = markHelpScreenSeen(loadSettings(), campaign, bit);
        saveSettings(next);
        settings.change({ helpScreensSeen: next.helpScreensSeen });
      },
      setHidden: (hidden) => {
        saveSettings(updateSettings(loadSettings(), { helpHidden: hidden }));
        settings.change({ helpHidden: hidden });
      },
    };
  }

  #mapKind(screen: MapScreen): HelpScreenKind {
    const strategic = this.#o.view()?.strategic;
    return mapHelpScreen({
      sectorInventoryOpen: screen.mapInventory.pool.open,
      anyMercsHired: (strategic?.mercs.length ?? 0) > 0,
      gameJustStarted: strategic?.gameJustStarted === true,
    });
  }

  #kindOf(): HelpScreenKind | null {
    const screen = this.#o.page.host.screen;
    if (!screen) return null;
    if (screen instanceof MapScreen) return this.#mapKind(screen);
    if (screen.id === TACTICAL_SCREEN) return 'tactical';
    if (screen.id === LAPTOP_SCREEN) return 'laptop';
    return null;
  }

  #blocked(kind: HelpScreenKind | null): boolean {
    if (this.#o.page.host.modal) return true;
    return kind === 'tactical' && this.#o.view()?.prompt?.kind === PRE_BATTLE_PROMPT;
  }

  frame(): void {
    const system = this.#system;
    if (!system) return;
    const kind = this.#kindOf();
    system.frame({ screen: this.#o.page.host.screen, kind, blocked: this.#blocked(kind) });
    this.#syncHook(system);
  }

  force(kind: HelpScreenKind): void {
    this.#system?.force(kind);
  }

  forceMap(): void {
    const screen = this.#o.page.host.screen;
    this.force(screen instanceof MapScreen ? this.#mapKind(screen) : 'map');
  }

  #syncHook(system: HelpSystem): void {
    const overlay = system.overlay;
    this.hook.open = overlay?.kind ?? null;
    this.hook.forced = overlay?.forced ?? false;
    this.hook.page = overlay?.page ?? 0;
    this.hook.top = overlay?.top ?? 0;
    this.hook.totalLines = overlay?.totalLines ?? 0;
  }
}
