import type { ControllerContract } from '../layout/controller.ts';
import { CREDITS_CONTRACT } from './front-end/credits.ts';
import { EXIT_BOX_CONTRACT } from './front-end/exit-box.ts';
import { GAME_INIT_CONTRACT } from './front-end/game-init.ts';
import { LOADING_CONTRACT } from './front-end/loading.ts';
import { MAIN_MENU_CONTRACT } from './front-end/main-menu.ts';
import { OPTIONS_CONTRACT } from './front-end/options.ts';
import { PLACEHOLDER_CONTRACT } from './front-end/placeholder.ts';
import { SAN_MONA_CONTRACT } from './front-end/san-mona.ts';
import { SAVE_LOAD_CONTRACT } from './front-end/save-load.ts';
import { GALLERY_CONTRACT } from './gallery.ts';
import { AIM_MEMBER_CONTRACT } from './laptop/aim/aim-member.ts';
import {
  AIM_BAR_CONTRACT,
  AIM_CHROME_CONTRACT,
  AIM_HOME_CONTRACT,
  AIM_INDEX_CONTRACT,
  AIM_LINKS_CONTRACT,
  AIM_SORT_CONTRACT,
} from './laptop/aim/aim-pages.ts';
import { EMAIL_CONTRACT } from './laptop/email/email-page.ts';
import { FINANCES_CONTRACT } from './laptop/finances/finances-page.ts';
import { LAPTOP_SHELL_CONTRACT } from './laptop/laptop-screen.ts';
import { HUD_CONTRACT } from './tactical/hud.ts';
import { SM_PANEL_CONTRACT } from './tactical/sm-panel.ts';
import { TEAM_PANEL_CONTRACT } from './tactical/team-panel.ts';

export const MESSAGE_BOX_CONTRACT: ControllerContract = { id: 'messageBox', actions: {}, bindings: {} };

export const LAYOUT_CONTRACTS: Readonly<Record<string, ControllerContract>> = Object.fromEntries(
  [
    GALLERY_CONTRACT,
    MESSAGE_BOX_CONTRACT,
    MAIN_MENU_CONTRACT,
    GAME_INIT_CONTRACT,
    OPTIONS_CONTRACT,
    SAVE_LOAD_CONTRACT,
    CREDITS_CONTRACT,
    LOADING_CONTRACT,
    EXIT_BOX_CONTRACT,
    SAN_MONA_CONTRACT,
    PLACEHOLDER_CONTRACT,
    LAPTOP_SHELL_CONTRACT,
    EMAIL_CONTRACT,
    FINANCES_CONTRACT,
    AIM_CHROME_CONTRACT,
    AIM_BAR_CONTRACT,
    AIM_HOME_CONTRACT,
    AIM_SORT_CONTRACT,
    AIM_INDEX_CONTRACT,
    AIM_MEMBER_CONTRACT,
    AIM_LINKS_CONTRACT,
    TEAM_PANEL_CONTRACT,
    SM_PANEL_CONTRACT,
    HUD_CONTRACT,
  ].map((contract) => [contract.id, contract]),
);
