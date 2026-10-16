import type {
  AimMercView,
  BobbyRayStockView,
  LaptopTimeView,
  LaptopView,
  MercListingView,
  ShippingDestinationView,
} from '../../protocol/view.ts';
import type { CommandReply } from '../net/session-client.ts';

type Send = (cmd: { type: string; [key: string]: unknown }) => Promise<CommandReply>;

const TABS = ['mail', 'aim', 'merc', 'imp', 'bobbyRay', 'insurance', 'records'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Readonly<Record<Tab, string>> = {
  mail: 'mail',
  aim: 'A.I.M.',
  merc: 'M.E.R.C.',
  imp: 'I.M.P.',
  bobbyRay: 'Bobby Ray',
  insurance: 'insurance',
  records: 'records',
};
const CONTRACT_DAYS = [1, 7, 14] as const;
const SPEEDS = ['standard', 'express', 'overnight'] as const;
const RECENT_RECORDS = 25;
const IMP_QUIZ_QUESTIONS = 16;
const IMP_START_ATTRIBUTE = 55;
const IMP_ATTRIBUTES = [
  'health',
  'agility',
  'dexterity',
  'strength',
  'wisdom',
  'leadership',
  'marksmanship',
  'medical',
  'mechanical',
  'explosives',
] as const;

interface HireData {
  readonly charge?: { readonly total: number };
  readonly arrival?: { readonly shownMinute: number; readonly sector: string };
}

interface QuoteData {
  readonly total?: number;
  readonly shipping?: number;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, data?: Record<string, string>): HTMLButtonElement {
  const b = node('button', label);
  b.type = 'button';
  for (const [k, v] of Object.entries(data ?? {})) b.dataset[k] = v;
  b.addEventListener('click', onClick);
  return b;
}

function row(cells: readonly (string | HTMLElement)[], header = false): HTMLTableRowElement {
  const tr = node('tr');
  for (const c of cells) {
    const td = node(header ? 'th' : 'td');
    if (typeof c === 'string') td.textContent = c;
    else td.append(c);
    tr.append(td);
  }
  return tr;
}

function table(header: readonly string[], rows: readonly HTMLTableRowElement[]): HTMLTableElement {
  const t = node('table');
  t.className = 'mercs';
  t.append(row(header, true), ...rows);
  return t;
}

function select<T extends string | number>(
  options: readonly { value: T; label: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const s = node('select');
  for (const o of options) {
    const opt = node('option', o.label);
    opt.value = String(o.value);
    opt.selected = o.value === current;
    s.append(opt);
  }
  s.addEventListener('change', () => {
    const picked = options.find((o) => String(o.value) === s.value);
    if (picked) onChange(picked.value);
  });
  return s;
}

function textInput(value: string, onInput: (v: string) => void, size = 12): HTMLInputElement {
  const i = node('input');
  i.value = value;
  i.size = size;
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

function when(t: LaptopTimeView): string {
  return `day ${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

function worldMinute(minute: number): string {
  const day = Math.trunc(minute / MINUTES_PER_DAY);
  const inDay = minute - day * MINUTES_PER_DAY;
  return when({ day, hour: Math.trunc(inDay / MINUTES_PER_HOUR), minute: inDay % MINUTES_PER_HOUR });
}

function statLine(s: AimMercView['stats']): string {
  return `${s.health}/${s.agility}/${s.dexterity}/${s.strength}/${s.wisdom} · ${s.marksmanship}/${s.medical}/${s.mechanical}/${s.explosives}/${s.leadership} · ${s.experience}`;
}

export class LaptopPanel {
  readonly #root = el('laptop');
  readonly #title = el('laptopTitle');
  readonly #tabs = el('laptopTabs');
  readonly #body = el('laptopBody');
  readonly #result = el('laptopResult');
  readonly #send: Send;
  #shown: LaptopView | null = null;
  #tab: Tab = 'mail';
  #contract: (typeof CONTRACT_DAYS)[number] = 7;
  #gear = true;
  #order = new Map<string, number>();
  #destination: number | null = null;
  #speed = 0;
  #imp = { code: '', name: '', nickname: '', gender: 'male', portrait: 0, voice: 0 };

  constructor(send: Send) {
    this.#send = send;
    el<HTMLButtonElement>('closeLaptop').addEventListener('click', () => {
      void this.#send({ type: 'closeLaptop' }).then((r) => this.#report(r, 'laptop closed'));
    });
  }

  get result(): string {
    return this.#result.textContent ?? '';
  }

  update(laptop: LaptopView | null): void {
    if (laptop === this.#shown) return;
    this.#shown = laptop;
    this.#root.hidden = !laptop;
    if (!laptop) return;
    this.#render(laptop);
  }

  #render(laptop: LaptopView): void {
    const unread = laptop.emails.filter((m) => !m.read).length;
    this.#title.textContent = `Laptop · balance $${laptop.balance.toLocaleString('en-US')} · landing zone ${laptop.landingZone} · ${unread} unread`;
    this.#tabs.replaceChildren(
      ...TABS.map((t) => {
        const b = button(TAB_LABELS[t], () => this.#switch(t), { tab: t });
        b.classList.toggle('active', t === this.#tab);
        return b;
      }),
    );
    this.#body.replaceChildren(...this.#tabBody(laptop));
  }

  #switch(tab: Tab): void {
    this.#tab = tab;
    if (this.#shown) this.#render(this.#shown);
  }

  #tabBody(laptop: LaptopView): HTMLElement[] {
    switch (this.#tab) {
      case 'mail':
        return this.#mail(laptop);
      case 'aim':
        return this.#aim(laptop);
      case 'merc':
        return this.#merc(laptop);
      case 'imp':
        return this.#impForm(laptop);
      case 'bobbyRay':
        return this.#bobbyRay(laptop);
      case 'insurance':
        return this.#insurance(laptop);
      case 'records':
        return this.#records(laptop);
    }
  }

  #mail(laptop: LaptopView): HTMLElement[] {
    const rows = [...laptop.emails]
      .reverse()
      .map((m) =>
        row([
          when(m.date),
          `sender ${m.sender}`,
          m.type,
          m.read ? '' : 'new',
          button('read', () => this.#run({ type: 'readEmail', id: m.id }, `mail ${m.id} read`), { mail: String(m.id) }),
          button('delete', () => this.#run({ type: 'deleteEmail', id: m.id }, `mail ${m.id} deleted`)),
        ]),
      );
    return [table(['date', 'from', 'mail', '', '', ''], rows)];
  }

  #aim(laptop: LaptopView): HTMLElement[] {
    const controls = node('div');
    controls.className = 'actions';
    controls.append(
      'contract',
      select(
        CONTRACT_DAYS.map((d) => ({ value: d, label: d === 1 ? '1 day' : `${d} days` })),
        this.#contract,
        (v) => {
          this.#contract = v;
        },
      ),
      this.#gearToggle(),
    );
    const rows = laptop.aim.map((m) => this.#aimRow(m));
    const legend = node('div', 'stats: hp/agi/dex/str/wis · mrk/med/mech/expl/lead · level');
    legend.className = 'hint';
    return [controls, legend, table(['merc', 'status', 'stats', 'salary d/w/2w', 'deposit', 'kit', ''], rows)];
  }

  #gearToggle(): HTMLLabelElement {
    const label = node('label');
    const box = node('input');
    box.type = 'checkbox';
    box.checked = this.#gear;
    box.addEventListener('change', () => {
      this.#gear = box.checked;
    });
    label.append(box, ' with kit');
    return label;
  }

  #aimRow(m: AimMercView): HTMLTableRowElement {
    const actions = node('span');
    actions.className = 'row-actions';
    actions.append(
      button('hire', () => this.#hire(m.profile), { hire: String(m.profile) }),
      button('message', () => this.#run({ type: 'aimLeaveMessage', profile: m.profile }, `message left for ${m.nickname}`)),
    );
    return row([
      `${m.nickname} (${m.profile})`,
      m.face,
      statLine(m.stats),
      `${m.salary.day}/${m.salary.week}/${m.salary.twoWeeks}`,
      m.medicalDeposit === null ? '' : `$${m.medicalDeposit}`,
      m.kit ? `$${m.kit.cost}` : '',
      actions,
    ]);
  }

  #hire(profile: number): void {
    void this.#send({ type: 'aimHire', profile, contract: this.#contract, gear: this.#gear }).then((r) => {
      const data = r.data as HireData | undefined;
      const arrival = data?.arrival ? `, arrives ${worldMinute(data.arrival.shownMinute)} in ${data.arrival.sector}` : '';
      this.#report(r, `hired for $${data?.charge?.total ?? 0}${arrival}`);
    });
  }

  #merc(laptop: LaptopView): HTMLElement[] {
    const site = laptop.merc;
    const info = node(
      'div',
      `bookmarked: ${site.bookmarked ? 'yes' : 'no'} · site ${site.siteDown ? 'down' : 'up'} · account ${site.accountStatus}${site.accountNumber === null ? '' : ` #${site.accountNumber}`} · owed $${site.totalOwed}`,
    );
    const controls = node('div');
    controls.className = 'actions';
    controls.append(
      button('open account', () => this.#run({ type: 'mercOpenAccount' }, 'account opened')),
      button('pay Speck', () => this.#run({ type: 'mercPay' }, 'paid')),
    );
    const rows = site.listed.map((m: MercListingView) =>
      row([
        `${m.nickname} (${m.profile})`,
        m.state,
        statLine(m.stats),
        `$${m.dailyFee}`,
        m.owed > 0 ? `$${m.owed} (${m.unpaidDays}d)` : '',
        button('hire', () => this.#mercHire(m.profile), { mercHire: String(m.profile) }),
      ]),
    );
    return [info, controls, table(['merc', 'status', 'stats', 'daily', 'owed', ''], rows)];
  }

  #mercHire(profile: number): void {
    void this.#send({ type: 'mercHire', profile }).then((r) => {
      const data = r.data as HireData | undefined;
      this.#report(r, data?.arrival ? `hired, arrives ${worldMinute(data.arrival.shownMinute)} in ${data.arrival.sector}` : 'hired');
    });
  }

  #impForm(laptop: LaptopView): HTMLElement[] {
    const imp = laptop.imp;
    const info = node(
      'div',
      `bookmarked: ${imp.bookmarked ? 'yes' : 'no'} · cost $${imp.cost} · characters left ${imp.charactersLeft} · ${imp.canCreate ? 'can create' : 'cannot create'}`,
    );
    const form = node('div');
    form.className = 'actions';
    const f = this.#imp;
    form.append(
      'code',
      textInput(
        f.code,
        (v) => {
          f.code = v;
        },
        8,
      ),
      'name',
      textInput(f.name, (v) => {
        f.name = v;
      }),
      'nickname',
      textInput(
        f.nickname,
        (v) => {
          f.nickname = v;
        },
        8,
      ),
      select(
        [
          { value: 'male', label: 'male' },
          { value: 'female', label: 'female' },
        ],
        f.gender,
        (v) => {
          f.gender = v;
        },
      ),
      button('create', () => this.#createImp(imp.pickSkillsDirectly)),
    );
    const hint = node('div', 'quiz answers all first, attributes at the start value, first portrait and voice');
    hint.className = 'hint';
    return [info, form, hint];
  }

  #createImp(pickSkillsDirectly: boolean): void {
    const f = this.#imp;
    const attributes = Object.fromEntries(IMP_ATTRIBUTES.map((k) => [k, IMP_START_ATTRIBUTE]));
    const answersOrSkills = pickSkillsDirectly ? { skills: [] } : { answers: new Array(IMP_QUIZ_QUESTIONS).fill(0) };
    const cmd = {
      type: 'impCreate',
      code: f.code,
      name: f.name,
      gender: f.gender,
      ...(f.nickname ? { nickname: f.nickname } : {}),
      ...answersOrSkills,
      attributes,
      portrait: f.portrait,
      voice: f.voice,
    };
    this.#run(cmd, `${f.name} created`);
  }

  #bobbyRay(laptop: LaptopView): HTMLElement[] {
    const shop = laptop.bobbyRay;
    if (!shop.open) return [node('div', 'Bobby Ray is not open yet.'), ...this.#shipments(laptop)];
    const deliverable = shop.destinations.filter((d) => d.canDeliver);
    const destination = this.#destination ?? deliverable.find((d) => d.primary)?.id ?? deliverable[0]?.id ?? 0;
    this.#destination = destination;
    const controls = node('div');
    controls.className = 'actions';
    controls.append(
      'to',
      select(
        shop.destinations.map((d: ShippingDestinationView) => ({ value: d.id, label: `${d.name}${d.canDeliver ? '' : ' (no delivery)'}` })),
        destination,
        (v) => {
          this.#destination = v;
        },
      ),
      select(
        SPEEDS.map((s, i) => ({ value: i, label: s })),
        this.#speed,
        (v) => {
          this.#speed = v;
        },
      ),
      button('quote', () => this.#bobbyRayCommand('bobbyRayQuote')),
      button('order', () => this.#bobbyRayCommand('bobbyRayOrder')),
    );
    return [
      controls,
      node('h3', 'new'),
      this.#stockTable(shop.newStock, false),
      node('h3', 'used'),
      this.#stockTable(shop.usedStock, true),
      ...this.#shipments(laptop),
    ];
  }

  #stockTable(stock: readonly BobbyRayStockView[], used: boolean): HTMLTableElement {
    const rows = stock
      .filter((s) => s.quantity > 0)
      .map((s) => {
        const key = `${used ? 'u' : 'n'}${s.item}`;
        const qty = node('input');
        qty.type = 'number';
        qty.min = '0';
        qty.max = String(s.quantity);
        qty.value = String(this.#order.get(key) ?? 0);
        qty.className = 'qty';
        qty.dataset.order = key;
        qty.addEventListener('input', () => {
          const n = Math.max(0, Math.trunc(Number(qty.value) || 0));
          if (n > 0) this.#order.set(key, n);
          else this.#order.delete(key);
        });
        return row([s.name, `$${s.price}`, `×${s.quantity}`, `${s.quality}%`, qty]);
      });
    return table(['item', 'price', 'stock', 'quality', 'order'], rows);
  }

  #orderLines(): { item: number; used: boolean; quantity: number }[] {
    return [...this.#order].map(([key, quantity]) => ({ item: Number(key.slice(1)), used: key.startsWith('u'), quantity }));
  }

  #bobbyRayCommand(type: 'bobbyRayQuote' | 'bobbyRayOrder'): void {
    const cmd = { type, lines: this.#orderLines(), destination: this.#destination, speed: this.#speed };
    void this.#send(cmd).then((r) => {
      const quote = r.data as QuoteData | undefined;
      const summary = `total $${quote?.total ?? 0} (shipping $${quote?.shipping ?? 0})`;
      if (r.ok && type === 'bobbyRayOrder') this.#order.clear();
      this.#report(r, type === 'bobbyRayOrder' ? `ordered: ${summary}` : summary);
    });
  }

  #shipments(laptop: LaptopView): HTMLElement[] {
    const shipments = laptop.bobbyRay.shipments.filter((s) => s.active);
    if (shipments.length === 0) return [];
    const names = new Map(laptop.bobbyRay.destinations.map((d) => [d.id, d.name]));
    const rows = shipments.map((s) =>
      row([
        String(s.index),
        names.get(s.destination) ?? String(s.destination),
        SPEEDS[s.speed] ?? String(s.speed),
        `day ${s.orderDay}`,
        s.lines.map((l) => `${l.name}${l.used ? ' (used)' : ''} ×${l.count}`).join(', '),
      ]),
    );
    return [node('h3', 'shipments'), table(['#', 'to', 'speed', 'ordered', 'items'], rows)];
  }

  #insurance(laptop: LaptopView): HTMLElement[] {
    const rows = laptop.insurance.map((o) =>
      row([
        o.name,
        `${o.contractDaysLeft}d`,
        o.insured ? `${o.insuredDaysLeft}d` : 'no',
        `${o.offeredLength}d for $${o.premium}`,
        button('insure', () => this.#run({ type: 'insure', soldier: o.soldier }, `${o.name} insured`), { insure: String(o.soldier) }),
      ]),
    );
    return [table(['merc', 'contract', 'insured', 'offer', ''], rows)];
  }

  #records(laptop: LaptopView): HTMLElement[] {
    const transit = laptop.inTransit.map((t) => row([t.name, when(t.arrival), t.sector]));
    const history = laptop.history
      .slice(-RECENT_RECORDS)
      .reverse()
      .map((h) => row([when(h.date), String(h.code), String(h.secondCode), h.sector ?? '']));
    const finances = laptop.finances
      .slice(-RECENT_RECORDS)
      .reverse()
      .map((f) => row([when(f.date), String(f.code), String(f.secondCode), `$${f.amount}`, `$${f.balanceAfter}`]));
    const p = laptop.personnel;
    return [
      node('h3', 'in transit'),
      table(['merc', 'arrival', 'sector'], transit),
      node('h3', 'finances'),
      table(['date', 'code', 'data', 'amount', 'balance'], finances),
      node('h3', 'history'),
      table(['date', 'code', 'data', 'sector'], history),
      node(
        'div',
        `personnel: dead ${p.dead.length}, left ${p.left.length}, other ${p.other.length} · files ${laptop.files.length} · bookmarks ${laptop.bookmarks.join(', ')}`,
      ),
    ];
  }

  #run(cmd: { type: string; [key: string]: unknown }, ok: string): void {
    void this.#send(cmd).then((r) => this.#report(r, ok));
  }

  #report(r: CommandReply, ok: string): void {
    const data = r.data as Record<string, unknown> | undefined;
    const details = !r.ok && data ? ` ${JSON.stringify(data)}` : '';
    this.#result.textContent = r.ok ? ok : `${r.reason ?? 'refused'}${details}`;
    this.#result.classList.toggle('error', !r.ok);
  }
}
