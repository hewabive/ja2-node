import type { CommandEnvelope, DriverMode, StopCondition } from '../../src/protocol/messages.ts';
import type { PlayerView, ViewFrame } from '../../src/protocol/view.ts';
import type { Session } from '../../src/server/session.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { ORIGINAL_SKIN } from '../../src/ui/layout/types.ts';
import type { MessageBoxes } from '../../src/ui/message-boxes.ts';
import {
  BATTLE_LAYOUTS,
  type BattleClient,
  type BattleEnvironment,
  type BattleLayout,
  type BattleReply,
  type BattleSoundRequest,
  type BattleSounds,
} from '../../src/ui/screens/battle/environment.ts';
import type { UiTextService } from '../../src/ui/text/text-service.ts';
import { planStubSkin, readOriginalLayouts } from '../../stubs/ui/skin.ts';
import { projectLayoutLoader, type TestRuntime } from './ui-runtime.ts';

export async function loadStubImages(t: TestRuntime): Promise<void> {
  for (const plan of planStubSkin(await readOriginalLayouts()).values())
    t.images.set(plan.path, {
      kind: 'indexed',
      animatedFrames: plan.animated,
      frames: plan.frames.map((f) => ({ width: f.width, height: f.height, offsetX: 0, offsetY: 0 })),
    });
}

export async function battleLayoutModels(): Promise<Map<BattleLayout, LayoutModel>> {
  const loader = projectLayoutLoader();
  const models = new Map<BattleLayout, LayoutModel>();
  for (const name of BATTLE_LAYOUTS) models.set(name, await loader.load(ORIGINAL_SKIN, name));
  return models;
}

function reply(result: { readonly ok: boolean; readonly reason?: string; readonly data?: unknown }): BattleReply {
  return JSON.parse(
    JSON.stringify({
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
    }),
  );
}

export interface ViewSource {
  readonly view: PlayerView | null;
  refresh(): void;
}

export class BattleSessionClient implements BattleClient {
  readonly commands: { readonly cmd: CommandEnvelope; readonly reply: BattleReply }[] = [];
  readonly drives: DriverMode[] = [];
  readonly advances: StopCondition[] = [];
  readonly #session: Session;
  readonly #source: ViewSource;
  readonly #frames: ViewFrame[] = [];

  constructor(session: Session, source: ViewSource) {
    this.#session = session;
    this.#source = source;
    session.subscribe((m) => {
      if (m.t === 'frames') this.#frames.push(...m.frames);
    });
  }

  get view(): PlayerView | null {
    return this.#source.view;
  }

  takeFrames(): ViewFrame[] {
    this.#source.refresh();
    return this.#frames.splice(0);
  }

  async command(cmd: CommandEnvelope): Promise<BattleReply> {
    const answer = reply(await this.#session.prepareAndDispatch(cmd));
    this.commands.push({ cmd, reply: answer });
    this.#source.refresh();
    return answer;
  }

  drive(driver: DriverMode): void {
    this.drives.push(driver);
  }

  async advance(until: StopCondition): Promise<void> {
    this.advances.push(until);
    this.#session.advance(until);
    this.#source.refresh();
  }

  showLatest(): void {}
}

export class FakeBattleSounds implements BattleSounds {
  readonly played: BattleSoundRequest[] = [];
  powerUps = 0;

  powerUp(): void {
    this.powerUps++;
  }

  play(request: BattleSoundRequest): void {
    this.played.push(request);
  }
}

export interface BattleEnvironmentParts {
  readonly t: TestRuntime;
  readonly text: UiTextService;
  readonly models: ReadonlyMap<string, LayoutModel>;
  readonly client: BattleClient;
  readonly sounds: BattleSounds;
  readonly boxes: MessageBoxes;
  readonly exitGame?: () => void;
}

export function testBattleEnvironment(parts: BattleEnvironmentParts): BattleEnvironment {
  let die = 0;
  return {
    runtime: parts.t.runtime,
    text: parts.text,
    layout: (name) => {
      const model = parts.models.get(name);
      if (!model) throw new Error(`battle layout ${name} is not loaded`);
      return model;
    },
    client: parts.client,
    sounds: parts.sounds,
    media: { image: () => true, faceIndex: (profile) => profile },
    boxes: parts.boxes,
    flow: { exitGame: () => parts.exitGame?.() },
    random: (range) => (die++ * 5) % Math.max(1, range),
  };
}
