// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc CreateAssignmentsBox ("On Duty(N)" for a merc in squad N), CreateEPCBox,
// @src CreateSquadBox ("Squad  N ( n/size )" up to GetLastSquadListedInSquadMenu, then Cancel), DisplayVehicleMenu,
// @src DisplayRepairMenu (vehicles but the helicopter, the robot, Items, Cancel), CreateTrainingBox, CreateAttributeBox,
// @src CreateMercRemoveAssignBox, DetermineBoxPositions (submenus right of the assignment box, the repair box four lines
// @src and the training box five lines lower, the attribute box right of the training box), UpdateMapScreenAssignmentPositions
// @src (the vehicle box three lines lower), AssignmentMenuBtnCallbackPrimary, AssignmentMenuBtnCallbackSecondary,
// @src SquadMenuBtnCallback (the squad error strings), VehicleMenuBtnCallback (STR_LATE_18 for a full vehicle),
// @src RepairMenuBtnCallback (shaded lines ignored), TrainingMenuBtnCallbackPrimary (the militia checks and their
// @src messages), TrainingMenuBtnCallbackSecondary, AttributesMenuBtnCallback, RemoveMercMenuBtnCallback,
// @src SetAssignmentForList, NotifyPlayerOfAssignmentAttemptFailure (pMapErrorString[18], [48] for militia),
// @src HandleShadingOfLinesForAssignmentMenus and its siblings (the shading comes from the assignmentOptions hint).
// @src See docs/28 §7.4.

import type { AssignmentLine, AssignmentOptions } from '../../../protocol/hints.ts';
import type { StrategicView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { RegionDispatcher } from '../../input/regions.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { LineShade, PopupBoxStyle, PopupLine } from '../../widgets/popup-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { Assignment, mercById } from './character-list.ts';
import { MapMenu } from './map-menu.ts';

const ASSIGN_MENU_ON_DUTY = 0;
const ASSIGN_MENU_DOCTOR = 1;
const ASSIGN_MENU_PATIENT = 2;
const ASSIGN_MENU_VEHICLE = 3;
const ASSIGN_MENU_REPAIR = 4;
const ASSIGN_MENU_TRAIN = 5;
const EPC_MENU_ON_DUTY = 0;
const EPC_MENU_PATIENT = 1;
const EPC_MENU_VEHICLE = 2;
const EPC_MENU_REMOVE = 3;
const TRAIN_MENU_SELF = 0;
const TRAIN_MENU_TOWN = 1;
const TRAIN_MENU_TEAMMATES = 2;
const TRAIN_MENU_TRAIN_BY_OTHER = 3;
const ATTRIB_MENU_CANCEL = 9;
const SQUAD_SIZE = 6;
const ASSIGNMENT_X = 120;
const VEHICLE_X = 160;
const SQUAD_CANCEL = 20;
const STRINGS = {
  assign: 'pAssignMenuStrings',
  epc: 'pEpcMenuStrings',
  squad: 'pSquadMenuStrings',
  vehicle: 'pVehicleStrings',
  repair: 'pRepairStrings',
  training: 'pTrainingMenuStrings',
  attribute: 'pAttributeMenuStrings',
  remove: 'pRemoveMercStrings',
  marks: 'zMarksMapScreenText',
  errors: 'pMapErrorString',
  late: 'gzLateLocalizedString',
  longAssignment: 'pLongAssignmentStrings',
  towns: 'strategic-map-town-names',
} as const;
const REPAIR_ITEMS = 0;
const REPAIR_CANCEL = 2;
const REPAIR_ROBOT = 3;
const DOCTOR_NO_KIT = 18;
const REPAIR_NO_KIT = 17;
const MILITIA_NOT_ALLOWED = 31;
const LOYALTY_TOO_LOW = 19;
const MILITIA_FULL = 20;
const STR_LATE_47 = 46;
const STR_LATE_18 = 17;
const MAX_MILITIA_TRAINERS_PER_SECTOR = 2;
const SOME_FAILED = 18;
const SOME_FAILED_MILITIA = 48;
const SQUAD_ERROR: Readonly<Record<string, number>> = {
  squadMoving: 36,
  squadHasVehicle: 37,
  squadElsewhere: 20,
  squadFull: 19,
  cannotJoinSquad: 38,
};

type TrainingMode = 'trainSelf' | 'trainTeammate' | 'trainByOther';

export interface AssignmentCommandReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export interface AssignmentMenuHost {
  readonly regions: RegionDispatcher;
  readonly text: UiTextService;
  readonly owner: unknown;
  readonly style: (name: 'assignment' | 'squad') => PopupBoxStyle;
  readonly origin: () => { x: number; y: number };
  readonly strategic: () => StrategicView | undefined;
  readonly others: (soldier: number) => readonly number[];
  readonly resetSelected: () => void;
  readonly send: (cmd: { type: string; [key: string]: unknown }) => Promise<AssignmentCommandReply>;
  readonly options: (soldier: number) => Promise<AssignmentOptions | null>;
  readonly box: (text: string) => void;
  readonly feedback: (text: string) => void;
  readonly townOf: (sector: string) => number;
  readonly fontHeight: () => number;
  readonly closed: () => void;
}

function shadeOf(line: AssignmentLine | undefined): LineShade {
  if (!line || line.shade === 'none') return 'none';
  return line.shade === 'yellow' ? 'secondary' : 'shade';
}

export class AssignmentMenus {
  readonly #host: AssignmentMenuHost;
  #soldier = -1;
  #options: AssignmentOptions | null = null;
  #main: MapMenu | null = null;
  #squad: MapMenu | null = null;
  #vehicle: MapMenu | null = null;
  #repair: MapMenu | null = null;
  #training: MapMenu | null = null;
  #attribute: MapMenu | null = null;
  #mode: TrainingMode = 'trainSelf';
  #boxY = 0;
  #pending = false;

  constructor(host: AssignmentMenuHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#main !== null;
  }

  get soldier(): number {
    return this.#soldier;
  }

  #menus(): MapMenu[] {
    return [this.#main, this.#squad, this.#vehicle, this.#repair, this.#training, this.#attribute].filter((m): m is MapMenu => m !== null);
  }

  #name(): string {
    return mercById(this.#host.strategic(), this.#soldier)?.name ?? '';
  }

  async show(soldier: number, boxY: number): Promise<void> {
    if (this.#pending) return;
    this.close(false);
    this.#pending = true;
    const options = await this.#host.options(soldier);
    this.#pending = false;
    if (!options) return;
    this.#soldier = soldier;
    this.#options = options;
    this.#boxY = boxY;
    const text = this.#host.text;
    const merc = mercById(this.#host.strategic(), soldier);
    const strings = options.box === 'epc' ? STRINGS.epc : options.box === 'removeMerc' ? STRINGS.remove : STRINGS.assign;
    const lines: PopupLine[] = options.lines.map((l, i) => {
      let label = text.string(strings, i) ?? l.line;
      if (options.box === 'assignment' && i === ASSIGN_MENU_ON_DUTY && merc && merc.assignment < Assignment.ON_DUTY)
        label = `${label}(${merc.assignment + 1})`;
      return { text: label, shade: shadeOf(l) };
    });
    const o = this.#host.origin();
    this.#main = this.#menu('assignmentMenu', 'assignment', o.x + ASSIGNMENT_X, o.y + boxY, lines, (line) => this.#mainSelect(line));
    this.#main.show();
  }

  #menu(
    id: string,
    style: 'assignment' | 'squad',
    x: number,
    y: number,
    lines: readonly PopupLine[],
    select: (line: number) => void,
    secondary?: (line: number) => void,
  ): MapMenu {
    return new MapMenu(this.#host.style(style), x, y, lines, {
      id,
      owner: this.#host.owner,
      regions: this.#host.regions,
      select,
      ...(secondary ? { secondary } : {}),
    });
  }

  #rightOfMain(): number {
    const box = this.#main?.box;
    return box ? box.x + box.width : 0;
  }

  #lineY(lines: number): number {
    return (this.#main?.box.y ?? 0) + (this.#host.fontHeight() + 2) * lines;
  }

  #submenuOpen(): boolean {
    return this.#squad !== null || this.#vehicle !== null || this.#repair !== null || this.#training !== null || this.#attribute !== null;
  }

  #mainSelect(line: number): void {
    const options = this.#options;
    if (!options || this.#submenuOpen()) return;
    const entry = options.lines[line];
    if (options.box === 'removeMerc') {
      if (line === 0) void this.#host.send({ type: 'removeMerc', soldier: this.#soldier });
      this.close(true);
      return;
    }
    if (options.box === 'epc') {
      if (line === EPC_MENU_ON_DUTY && entry?.enabled) this.#openSquads();
      else if (line === EPC_MENU_PATIENT && entry?.enabled) void this.#assign({ kind: 'patient' });
      else if (line === EPC_MENU_VEHICLE && entry?.enabled) this.#openVehicles();
      else if (line === EPC_MENU_REMOVE) {
        void this.#host.send({ type: 'unescort', soldier: this.#soldier });
        this.close(true);
      } else if (line === options.lines.length - 1) this.#cancel();
      return;
    }
    switch (line) {
      case ASSIGN_MENU_ON_DUTY:
        if (entry?.enabled) this.#openSquads();
        return;
      case ASSIGN_MENU_DOCTOR:
        if (entry?.enabled) void this.#assign({ kind: 'doctor' });
        else if (entry?.shade === 'yellow')
          this.#host.box(printf(this.#host.text.string(STRINGS.marks, DOCTOR_NO_KIT) ?? '', [this.#name()]));
        return;
      case ASSIGN_MENU_PATIENT:
        if (entry?.enabled) void this.#assign({ kind: 'patient' });
        return;
      case ASSIGN_MENU_VEHICLE:
        if (entry?.enabled) this.#openVehicles();
        return;
      case ASSIGN_MENU_REPAIR:
        if (entry?.enabled) this.#openRepair();
        else if (entry?.shade === 'yellow')
          this.#host.box(printf(this.#host.text.string(STRINGS.marks, REPAIR_NO_KIT) ?? '', [this.#name()]));
        return;
      case ASSIGN_MENU_TRAIN:
        if (entry?.enabled) this.#openTraining();
        return;
      default:
        this.#cancel();
    }
  }

  #cancel(): void {
    this.close(true);
    this.#host.resetSelected();
  }

  #openSquads(): void {
    const options = this.#options;
    if (!options) return;
    const text = this.#host.text;
    const strategic = this.#host.strategic();
    const count = (q: number) => (strategic?.mercs ?? []).filter((m) => m.squad === q).length;
    const lines: PopupLine[] = options.squads.map((l, i) => ({
      text: `${text.string(STRINGS.squad, l.target ?? i) ?? ''} ( ${count(l.target ?? i)}/${SQUAD_SIZE} )`,
      shade: shadeOf(l),
    }));
    lines.push({ text: text.string(STRINGS.squad, SQUAD_CANCEL) ?? '' });
    const o = this.#host.origin();
    const box = this.#main?.box;
    let y = box?.y ?? 0;
    this.#squad = this.#menu('squadMenu', 'squad', this.#rightOfMain(), y, lines, (line) => this.#squadSelect(line));
    const maxY = o.y + 480 - this.#squad.box.height;
    if (y > maxY) {
      y = maxY;
      this.#squad.moveTo(this.#rightOfMain(), y);
    }
    this.#main?.pin(ASSIGN_MENU_ON_DUTY);
    this.#squad.show();
  }

  async #squadSelect(line: number): Promise<void> {
    const options = this.#options;
    if (!options) return;
    if (line >= options.squads.length) {
      this.#squad?.hide();
      this.#squad = null;
      this.#main?.unpin();
      return;
    }
    const squad = options.squads[line]?.target ?? line;
    const name = this.#name();
    const reply = await this.#host.send({ type: 'assignSquad', soldier: this.#soldier, squad });
    const refusal = (reply.data as { refusal?: string } | undefined)?.refusal ?? null;
    if (!reply.ok && refusal !== 'alreadyInSquad') {
      const index = SQUAD_ERROR[refusal ?? ''] ?? SQUAD_ERROR.cannotJoinSquad ?? 38;
      const where = this.#host.text.string(STRINGS.longAssignment, squad) ?? '';
      this.#host.box(printf(this.#host.text.string(STRINGS.errors, index) ?? '', [name, where]));
    } else this.close(true);
    const others = this.#host.others(this.#soldier);
    if (others.length > 0) {
      const results = await this.#host.send({ type: 'assign', soldiers: others, to: { kind: 'squad', squad } });
      this.#reportList(results, false);
    }
  }

  #openVehicles(): void {
    const options = this.#options;
    if (!options || options.vehicles.length === 0) return;
    const text = this.#host.text;
    const strategic = this.#host.strategic();
    const lines: PopupLine[] = options.vehicles.map((l) => {
      const v = (strategic?.vehicles ?? []).find((x) => x.id === l.target);
      return { text: text.string(STRINGS.vehicle, v?.type ?? 0) ?? '', shade: 'none' };
    });
    lines.push({ text: text.string(STRINGS.squad, SQUAD_CANCEL) ?? '' });
    const o = this.#host.origin();
    this.#vehicle = this.#menu('vehicleMenu', 'assignment', o.x + VEHICLE_X, this.#lineY(ASSIGN_MENU_VEHICLE), lines, (line) =>
      this.#vehicleSelect(line),
    );
    this.#main?.pin(this.#options?.box === 'epc' ? EPC_MENU_VEHICLE : ASSIGN_MENU_VEHICLE);
    this.#vehicle.show();
  }

  async #vehicleSelect(line: number): Promise<void> {
    const options = this.#options;
    if (!options) return;
    const entry = options.vehicles[line];
    if (!entry) {
      this.#vehicle?.hide();
      this.#vehicle = null;
      this.#main?.unpin();
      return;
    }
    if (entry.shade === 'yellow') {
      const v = (this.#host.strategic()?.vehicles ?? []).find((x) => x.id === entry.target);
      this.#host.feedback(
        printf(this.#host.text.string(STRINGS.late, STR_LATE_18) ?? '', [this.#host.text.string(STRINGS.vehicle, v?.type ?? 0) ?? '']),
      );
    } else await this.#host.send({ type: 'boardVehicle', soldier: this.#soldier, vehicle: entry.target });
    this.close(true);
    for (const id of this.#host.others(this.#soldier)) await this.#host.send({ type: 'boardVehicle', soldier: id, vehicle: entry.target });
  }

  #openRepair(): void {
    const options = this.#options;
    if (!options) return;
    const text = this.#host.text;
    const strategic = this.#host.strategic();
    const lines: PopupLine[] = options.repair.map((l) => {
      if (l.line === 'repairVehicle') {
        const v = (strategic?.vehicles ?? []).find((x) => x.id === l.target);
        return { text: text.string(STRINGS.vehicle, v?.type ?? 0) ?? '', shade: shadeOf(l) };
      }
      return { text: text.string(STRINGS.repair, l.line === 'repairRobot' ? REPAIR_ROBOT : REPAIR_ITEMS) ?? '', shade: shadeOf(l) };
    });
    lines.push({ text: text.string(STRINGS.repair, REPAIR_CANCEL) ?? '' });
    this.#repair = this.#menu('repairMenu', 'assignment', this.#rightOfMain(), this.#lineY(ASSIGN_MENU_REPAIR), lines, (line) =>
      this.#repairSelect(line),
    );
    this.#main?.pin(ASSIGN_MENU_REPAIR);
    this.#repair.show();
  }

  #repairSelect(line: number): void {
    const options = this.#options;
    if (!options) return;
    const entry = options.repair[line];
    if (!entry) {
      this.#repair?.hide();
      this.#repair = null;
      this.#main?.unpin();
      return;
    }
    if (entry.shade !== 'none') return;
    if (entry.line === 'repairVehicle') void this.#assign({ kind: 'repair', vehicle: entry.target });
    else if (entry.line === 'repairRobot') void this.#assign({ kind: 'repair', robot: true });
    else void this.#assign({ kind: 'repair' });
  }

  #openTraining(): void {
    const options = this.#options;
    if (!options) return;
    const text = this.#host.text;
    const lines: PopupLine[] = options.training.map((l, i) => ({ text: text.string(STRINGS.training, i) ?? '', shade: shadeOf(l) }));
    lines.push({ text: text.string(STRINGS.training, options.training.length) ?? '' });
    this.#training = this.#menu(
      'trainingMenu',
      'assignment',
      this.#rightOfMain(),
      this.#lineY(ASSIGN_MENU_TRAIN),
      lines,
      (line) => this.#trainingSelect(line),
      () => this.#closeAttributes(),
    );
    this.#main?.pin(ASSIGN_MENU_TRAIN);
    this.#training.show();
  }

  #closeAttributes(): boolean {
    if (!this.#attribute) return false;
    this.#attribute.hide();
    this.#attribute = null;
    this.#training?.unpin();
    return true;
  }

  #trainingSelect(line: number): void {
    if (this.#closeAttributes()) return;
    const options = this.#options;
    if (!options) return;
    const entry = options.training[line];
    switch (line) {
      case TRAIN_MENU_SELF:
        this.#openAttributes('trainSelf', line);
        return;
      case TRAIN_MENU_TOWN:
        if (entry && entry.shade !== 'gray') void this.#trainMilitia();
        return;
      case TRAIN_MENU_TEAMMATES:
        if (entry?.enabled) this.#openAttributes('trainTeammate', line);
        return;
      case TRAIN_MENU_TRAIN_BY_OTHER:
        if (entry?.enabled) this.#openAttributes('trainByOther', line);
        return;
      default:
        this.#training?.hide();
        this.#training = null;
        this.#main?.unpin();
        this.#host.resetSelected();
    }
  }

  async #trainMilitia(): Promise<void> {
    const reply = await this.#host.send({
      type: 'assign',
      soldiers: [this.#soldier, ...this.#host.others(this.#soldier)],
      to: { kind: 'trainMilitia' },
    });
    if (reply.ok) {
      this.close(true);
      return;
    }
    const first = Array.isArray(reply.data) ? (reply.data[0] as { ok: boolean; reason?: string } | undefined) : undefined;
    const reason = first && !first.ok ? first.reason : reply.reason;
    const text = this.#host.text;
    const merc = mercById(this.#host.strategic(), this.#soldier);
    const town = merc ? this.#host.townOf(merc.sector) : 0;
    const where = town !== 0 ? (text.string(STRINGS.towns, town) ?? '') : (merc?.sector.split('-')[0] ?? '');
    if (reason === 'noMilitiaHere') this.#host.box(printf(text.string(STRINGS.errors, MILITIA_NOT_ALLOWED) ?? '', [where]));
    else if (reason === 'loyaltyTooLow') this.#host.box(text.string(STRINGS.marks, LOYALTY_TOO_LOW) ?? '');
    else if (reason === 'militiaFull') this.#host.box(printf(text.string(STRINGS.marks, MILITIA_FULL) ?? '', [where]));
    else if (reason === 'tooManyTrainers')
      this.#host.box(printf(text.string(STRINGS.late, STR_LATE_47) ?? '', [MAX_MILITIA_TRAINERS_PER_SECTOR]));
    else this.#reportList(reply, true);
    if (first?.ok) this.close(true);
  }

  #openAttributes(mode: TrainingMode, trainingLine: number): void {
    const options = this.#options;
    if (!options) return;
    this.#mode = mode;
    const text = this.#host.text;
    const source =
      mode === 'trainSelf' ? options.attributes.self : mode === 'trainTeammate' ? options.attributes.teammate : options.attributes.byOther;
    const lines: PopupLine[] = source.map((l, i) => ({ text: text.string(STRINGS.attribute, i) ?? '', shade: shadeOf(l) }));
    lines.push({ text: text.string(STRINGS.attribute, ATTRIB_MENU_CANCEL) ?? '' });
    const training = this.#training?.box;
    if (!training) return;
    this.#attribute = this.#menu('attributeMenu', 'assignment', training.x + training.width, training.y, lines, (line) =>
      this.#attributeSelect(line),
    );
    this.#training?.pin(trainingLine);
    this.#attribute.show();
  }

  #attributeSelect(line: number): void {
    const options = this.#options;
    if (!options) return;
    if (line === ATTRIB_MENU_CANCEL) {
      this.#closeAttributes();
      return;
    }
    const source =
      this.#mode === 'trainSelf'
        ? options.attributes.self
        : this.#mode === 'trainTeammate'
          ? options.attributes.teammate
          : options.attributes.byOther;
    if (!source[line]?.enabled) return;
    void this.#assign({ kind: this.#mode, stat: line });
  }

  async #assign(to: { kind: string; [key: string]: unknown }): Promise<void> {
    const reply = await this.#host.send({ type: 'assign', soldiers: [this.#soldier, ...this.#host.others(this.#soldier)], to });
    this.close(true);
    this.#reportList(reply, to.kind === 'trainMilitia');
  }

  #reportList(reply: AssignmentCommandReply, militia: boolean): void {
    if (!Array.isArray(reply.data)) return;
    const failed = (reply.data as { ok: boolean }[]).some((r) => !r.ok);
    if (failed) this.#host.box(this.#host.text.string(STRINGS.errors, militia ? SOME_FAILED_MILITIA : SOME_FAILED) ?? '');
  }

  escape(): boolean {
    if (this.#attribute) return this.#closeAttributes();
    if (this.#training) {
      this.#training.hide();
      this.#training = null;
      this.#main?.unpin();
      return true;
    }
    if (this.#squad) {
      this.#squad.hide();
      this.#squad = null;
      this.#main?.unpin();
      return true;
    }
    if (this.#repair) {
      this.#repair.hide();
      this.#repair = null;
      this.#main?.unpin();
      return true;
    }
    if (this.#vehicle) {
      this.#vehicle.hide();
      this.#vehicle = null;
      this.#main?.unpin();
      return true;
    }
    if (this.#main) {
      this.close(true);
      return true;
    }
    return false;
  }

  close(notify: boolean): void {
    const wasOpen = this.#main !== null;
    for (const m of this.#menus()) m.hide();
    this.#main = this.#squad = this.#vehicle = this.#repair = this.#training = this.#attribute = null;
    this.#options = null;
    if (wasOpen && notify) this.#host.closed();
  }

  render(list: DrawList): void {
    for (const m of this.#menus()) m.render(list);
  }

  describe(): WidgetInfo[] {
    return this.#menus().flatMap((m) => m.describe());
  }

  get boxY(): number {
    return this.#boxY;
  }
}
