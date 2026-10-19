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
  ].map((contract) => [contract.id, contract]),
);
