import type {
  DestroyedHelicopterView,
  QuestLogEntryView,
  QuestStepView,
  StrategicHelicopterView,
  StrategicView,
} from '../../protocol/view.ts';
import type { CommandReply } from '../net/session-client.ts';

type Send = (cmd: { type: string; [key: string]: unknown }) => Promise<CommandReply>;
type Report = (text: string, error?: boolean) => void;

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

function stepText(step: QuestStepView | null): string {
  if (!step) return '';
  const day = Math.floor(step.minute / MINUTES_PER_DAY);
  const hour = Math.floor((step.minute % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minute = step.minute % MINUTES_PER_HOUR;
  const time = `day ${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return step.sector ? `${time} in ${step.sector}` : time;
}

function questRow(q: QuestLogEntryView): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const text of [q.quest, `started ${stepText(q.started)}`, q.finished ? `done ${stepText(q.finished)}` : 'in progress']) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  return tr;
}

function destroyed(h: StrategicHelicopterView | DestroyedHelicopterView): h is DestroyedHelicopterView {
  return 'destroyed' in h;
}

function helicopterState(h: StrategicHelicopterView): string {
  if (h.returning) return 'returning to base';
  if (h.hovering) return 'hovering';
  return h.airborne ? 'in the air' : 'on the ground';
}

function helicopterSummary(h: StrategicHelicopterView, names: (id: number) => string): string {
  const lines = [`${h.sector} · ${helicopterState(h)} · ${h.passengers.length}/${h.seats} aboard`];
  if (h.passengers.length > 0) lines.push(`passengers: ${h.passengers.map(names).join(', ')}`);
  if (h.path.length > 0) lines.push(`route ${h.path.join(' → ')}, ${h.etaMinutes} min, ~$${h.routeCost}`);
  lines.push(h.canFly ? 'can fly' : `grounded: ${h.reason ?? 'unknown'}`);
  if (h.owed > 0) lines.push(`Skyrider is owed $${h.owed}`);
  if (h.hits > 0) lines.push(`SAM hits: ${h.hits}`);
  lines.push(`refuel: ${h.refuelSites.map((r) => `${r.sector}${r.available ? '' : ' (closed)'}`).join(', ')}`);
  return lines.join('\n');
}

export class QuestPanel {
  readonly #table = el<HTMLTableElement>('quests');
  #shown: readonly QuestLogEntryView[] | null = null;

  update(view: StrategicView): void {
    if (view.quests === this.#shown) return;
    this.#shown = view.quests;
    this.#table.replaceChildren(...view.quests.map(questRow));
  }
}

export class HelicopterPanel {
  readonly #root = el('helicopter');
  readonly #info = el('helicopterInfo');
  readonly #send: Send;
  readonly #report: Report;
  readonly #picked: () => string | null;
  readonly #selected: () => readonly number[];

  constructor(send: Send, report: Report, picked: () => string | null, selected: () => readonly number[]) {
    this.#send = send;
    this.#report = report;
    this.#picked = picked;
    this.#selected = selected;
    el<HTMLButtonElement>('heliRoute').addEventListener('click', () => this.#fly());
    el<HTMLButtonElement>('heliCancel').addEventListener('click', () => {
      void this.#send({ type: 'heliCancel' }).then((r) => this.#reply(r, 'flight cancelled'));
    });
    el<HTMLButtonElement>('heliBoard').addEventListener('click', () => this.#eachSelected('boardVehicle', 'boarded'));
    el<HTMLButtonElement>('heliLeave').addEventListener('click', () => this.#eachSelected('leaveVehicle', 'left the vehicle'));
  }

  update(view: StrategicView): void {
    const h = view.helicopter;
    this.#root.hidden = !h;
    if (!h) return;
    const names = (id: number) => view.mercs.find((m) => m.id === id)?.name ?? `#${id}`;
    this.#info.textContent = destroyed(h) ? 'shot down' : helicopterSummary(h, names);
  }

  #fly(): void {
    const to = this.#picked();
    if (!to) return;
    void this.#send({ type: 'heliRoute', to }).then((r) => {
      const data = (r.data ?? {}) as { etaMinutes?: number };
      this.#reply(r, `flying to ${to}, ${data.etaMinutes ?? '?'} min`);
    });
  }

  #eachSelected(type: 'boardVehicle' | 'leaveVehicle', done: string): void {
    const soldiers = this.#selected();
    void (async () => {
      for (const soldier of soldiers) {
        const r = await this.#send(type === 'boardVehicle' ? { type, soldier, vehicle: 'helicopter' } : { type, soldier });
        this.#reply(r, `#${soldier} ${done}`);
        if (!r.ok) return;
      }
    })();
  }

  #reply(r: CommandReply, ok: string): void {
    const refusal = (r.data as { refusal?: string } | undefined)?.refusal;
    this.#report(r.ok ? ok : (refusal ?? r.reason ?? 'refused'), !r.ok);
  }
}
