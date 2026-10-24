import { BobbyRayCart } from './bobby-ray/bobby-ray-session.ts';
import { MercSession } from './merc/merc-session.ts';

export interface LaptopSites {
  readonly bobbyRay: BobbyRayCart;
  readonly merc: MercSession;
  readonly impVisited: Set<number>;
}

export function laptopSites(): LaptopSites {
  return { bobbyRay: new BobbyRayCart(), merc: new MercSession(), impVisited: new Set() };
}
