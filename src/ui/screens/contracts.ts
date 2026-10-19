import type { ControllerContract } from '../layout/controller.ts';
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

export const MESSAGE_BOX_CONTRACT: ControllerContract = { id: 'messageBox', actions: {}, bindings: {} };

export const LAYOUT_CONTRACTS: Readonly<Record<string, ControllerContract>> = {
  [GALLERY_CONTRACT.id]: GALLERY_CONTRACT,
  [MESSAGE_BOX_CONTRACT.id]: MESSAGE_BOX_CONTRACT,
  ...Object.fromEntries(
    [
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
    ].map((c) => [c.id, c]),
  ),
};
