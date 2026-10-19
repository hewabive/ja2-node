import type { ControllerContract } from '../layout/controller.ts';
import { GALLERY_CONTRACT } from './gallery.ts';

export const MESSAGE_BOX_CONTRACT: ControllerContract = { id: 'messageBox', actions: {}, bindings: {} };

export const LAYOUT_CONTRACTS: Readonly<Record<string, ControllerContract>> = {
  [GALLERY_CONTRACT.id]: GALLERY_CONTRACT,
  [MESSAGE_BOX_CONTRACT.id]: MESSAGE_BOX_CONTRACT,
};
