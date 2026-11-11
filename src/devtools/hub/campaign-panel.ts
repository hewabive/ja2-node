import type { Difficulty, SaveMode } from '../../ui/client/api-types.ts';
import { type CampaignForm, DEFAULT_CAMPAIGN_FORM, MAX_SQUAD_SIZE, type SquadChoice } from '../../ui/client/campaign-form.ts';
import type { OpenPage } from './open-page.ts';

export interface CampaignChoice {
  readonly form: CampaignForm;
  readonly page: OpenPage;
  readonly seed: number | null;
}

const SERVER_DEFAULT_SIZE = '';
const DEFAULT_PAGE: OpenPage = 'play';
const SEED = /^\d+$/;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

export class CampaignPanel {
  readonly #form = element<HTMLFormElement>('campaignForm');
  readonly #size = element<HTMLSelectElement>('squadSize');
  readonly #land = element<HTMLInputElement>('land');
  readonly #seed = element<HTMLInputElement>('seed');
  readonly #deadIsDeadBox = element('deadIsDeadBox');

  constructor(start: () => void, startSandbox: () => void, seed: string | null) {
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      start();
    });
    element('startSandbox').addEventListener('click', startSandbox);
    this.#form.addEventListener('change', () => this.#update());
    if (seed !== null && SEED.test(seed)) this.#seed.value = seed;
    this.#renderSizes();
    this.#update();
  }

  #radio(name: string): string {
    return this.#form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
  }

  #checked(id: string): boolean {
    return element<HTMLInputElement>(id).checked;
  }

  #renderSizes(): void {
    const sizes = Array.from({ length: MAX_SQUAD_SIZE }, (_, i) => String(i + 1));
    this.#size.replaceChildren(
      ...[SERVER_DEFAULT_SIZE, ...sizes].map((value) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = value === SERVER_DEFAULT_SIZE ? 'server default' : value;
        return o;
      }),
    );
  }

  #update(): void {
    const { form } = this.read();
    this.#deadIsDeadBox.hidden = form.saveMode !== 'deadIsDead';
    this.#size.disabled = form.squad !== 'default';
    this.#land.disabled = form.squad !== 'default';
  }

  read(): CampaignChoice {
    const d = DEFAULT_CAMPAIGN_FORM;
    const size = this.#size.value;
    const seed = this.#seed.value.trim();
    return {
      form: {
        difficulty: (Number(this.#radio('difficulty')) || d.difficulty) as Difficulty,
        sciFi: this.#radio('style') !== 'realistic',
        gunNut: this.#radio('guns') === 'gunNut',
        saveMode: (this.#radio('saveMode') || d.saveMode) as SaveMode,
        bloodAndGore: this.#checked('bloodAndGore'),
        deadIsDeadName: element<HTMLInputElement>('deadIsDeadName').value,
        squad: (this.#radio('squad') || d.squad) as SquadChoice,
        squadSize: size === SERVER_DEFAULT_SIZE ? null : Number(size),
        land: this.#land.checked,
      },
      page: (this.#radio('page') || DEFAULT_PAGE) as OpenPage,
      seed: SEED.test(seed) ? Number(seed) : null,
    };
  }

  busy(on: boolean): void {
    element<HTMLButtonElement>('startCampaign').disabled = on;
    element<HTMLButtonElement>('startSandbox').disabled = on;
  }
}
