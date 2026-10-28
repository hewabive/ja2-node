// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/BobbyR.cc gubBobbyRPages (the order of the signs), EnterBobbyR (the sign regions disabled while the
// @src site is under construction), ExitBobbyR (guiLastBobbyRayPage), RenderBobbyR, HandleBobbyRUnderConstructionAni (five
// @src frames every 150 ms, the first one shown is frame 1), SelectBobbiesSignMenuRegionCallBack.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { FrameAnimator } from '../../../widgets/frame-animator.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const BOBBY_RAY_HOME_LAYOUT = 'bobby-ray-home';
export const BOBBY_RAY_SIGN_PAGES: readonly number[] = [
  LaptopMode.BOBBY_R_USED,
  LaptopMode.BOBBY_R_MISC,
  LaptopMode.BOBBY_R_GUNS,
  LaptopMode.BOBBY_R_AMMO,
  LaptopMode.BOBBY_R_ARMOR,
];
const UNDER_CONSTRUCTION_FRAMES = 5;
const UNDER_CONSTRUCTION_DELAY_MS = 150;
const FIRST_FRAME_SHOWN = 1;

export const BOBBY_RAY_HOME_CONTRACT: ControllerContract = {
  id: 'bobbyRayHome',
  actions: { sign: { args: 1 } },
  bindings: { open: 'boolean', closed: 'boolean', constructionFrame: 'number' },
};

export function bobbyRayHomePage(context: LaptopContext): LaptopPage {
  const model: Record<string, unknown> = {};
  const animation = new FrameAnimator(
    UNDER_CONSTRUCTION_FRAMES,
    UNDER_CONSTRUCTION_DELAY_MS,
    context.services.clock.ja2Now,
    FIRST_FRAME_SHOWN,
  );
  const refresh = (now: number) => {
    const open = context.view()?.bobbyRay.open === true;
    model.open = open;
    model.closed = !open;
    model.constructionFrame = open ? 0 : animation.update(now);
  };
  const controller = new ViewModelController(BOBBY_RAY_HOME_CONTRACT, model, {
    sign: ([i]) => {
      const page = BOBBY_RAY_SIGN_PAGES[i ?? 0];
      if (page !== undefined && model.open === true) context.shell.setPage(page);
    },
  });
  refresh(context.services.clock.ja2Now);
  return {
    layouts: [{ name: BOBBY_RAY_HOME_LAYOUT, controller }],
    update: refresh,
    dispose: () => {
      context.memory.bobbyRay.lastPage = LaptopMode.BOBBY_R;
    },
  };
}
