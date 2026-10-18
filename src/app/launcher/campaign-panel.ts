import type { Difficulty, SaveMode } from './api.ts';
import { type CampaignForm, DEFAULT_CAMPAIGN_FORM, MAX_SQUAD_SIZE, type SquadChoice, type StartPage } from './campaign-form.ts';
import type { Labels } from './labels.ts';

const SERVER_DEFAULT_SIZE = '';

function form(): HTMLFormElement {
  return document.getElementById('campaignForm') as HTMLFormElement;
}

function radio(name: string): string {
  return form().querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
}

function checkbox(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement).checked;
}

export class CampaignPanel {
  readonly #size = document.getElementById('squadSize') as HTMLSelectElement;
  readonly #deadIsDeadBox = document.getElementById('deadIsDeadBox') as HTMLElement;

  constructor(start: () => void) {
    form().addEventListener('submit', (event) => {
      event.preventDefault();
      start();
    });
    form().addEventListener('change', () => this.#update());
    this.#update();
  }

  renderSizes(labels: Labels): void {
    const chosen = this.#size.value;
    const sizes = Array.from({ length: MAX_SQUAD_SIZE }, (_, i) => String(i + 1));
    this.#size.replaceChildren(
      ...[SERVER_DEFAULT_SIZE, ...sizes].map((value) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = value === SERVER_DEFAULT_SIZE ? labels.text('serverDefault') : value;
        o.selected = value === chosen;
        return o;
      }),
    );
  }

  #update(): void {
    const values = this.read();
    this.#deadIsDeadBox.hidden = values.saveMode !== 'deadIsDead';
    this.#size.disabled = values.squad !== 'default';
    (document.getElementById('land') as HTMLInputElement).disabled = values.squad !== 'default';
  }

  read(): CampaignForm {
    const d = DEFAULT_CAMPAIGN_FORM;
    const size = this.#size.value;
    return {
      difficulty: (Number(radio('difficulty')) || d.difficulty) as Difficulty,
      sciFi: radio('style') !== 'realistic',
      gunNut: radio('guns') === 'gunNut',
      saveMode: (radio('saveMode') || d.saveMode) as SaveMode,
      bloodAndGore: checkbox('bloodAndGore'),
      deadIsDeadName: (document.getElementById('deadIsDeadName') as HTMLInputElement).value,
      squad: (radio('squad') || d.squad) as SquadChoice,
      squadSize: size === SERVER_DEFAULT_SIZE ? null : Number(size),
      land: checkbox('land'),
      page: (radio('page') || d.page) as StartPage,
    };
  }

  busy(on: boolean): void {
    (document.getElementById('startCampaign') as HTMLButtonElement).disabled = on;
  }
}
