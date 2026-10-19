import type { UiLanguage } from '../../content/text/data-version.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { Health, LoadSuccess, Refusal, SaveListing, SaveSuccess } from '../../ui/client/api-types.ts';
import { campaignRequest, DEFAULT_CAMPAIGN_FORM } from '../../ui/client/campaign-form.ts';
import type { FrontEndClient, NewCampaign, SessionStatus } from '../../ui/client/front-end-client.ts';
import type { CreatedSession, SaveRequest, SessionStart } from '../../ui/saves/save-controller.ts';
import { createSession, deleteSave, fetchHealth, fetchSaves, fetchSessions, saveSession } from '../launcher/api.ts';
import { SessionClient } from '../net/session-client.ts';

const SET_OPTION = 'setOption';

export type ConnectSession = (session: string) => Promise<SessionClient>;

export class HttpFrontEndClient implements FrontEndClient {
  onConnected: ((client: SessionClient | null) => void) | null = null;
  readonly #language: () => UiLanguage | null;
  readonly #connectTo: ConnectSession;
  #client: SessionClient | null = null;

  constructor(language: () => UiLanguage | null, connect: ConnectSession = (session) => SessionClient.connect(session)) {
    this.#language = language;
    this.#connectTo = connect;
  }

  get client(): SessionClient | null {
    return this.#client;
  }

  get session(): string | null {
    return this.#client?.session ?? null;
  }

  get view(): PlayerView | null {
    return this.#client?.view ?? null;
  }

  health(): Promise<Health> {
    return fetchHealth();
  }

  saves(): Promise<SaveListing[]> {
    return fetchSaves();
  }

  #languagePart(): { readonly language?: UiLanguage } {
    const language = this.#language();
    return language ? { language } : {};
  }

  async newCampaign(campaign: NewCampaign): Promise<string> {
    const request = campaignRequest(
      {
        ...DEFAULT_CAMPAIGN_FORM,
        ...campaign.options,
        squad: 'laptop',
        deadIsDeadName: campaign.deadIsDead?.name ?? DEFAULT_CAMPAIGN_FORM.deadIsDeadName,
      },
      this.#language(),
    );
    if (!request.ok) throw new Error(request.problem);
    const created = await createSession(request.body);
    await this.connect(created.session);
    return created.session;
  }

  async connect(session: string): Promise<void> {
    this.#client?.close();
    this.#client = null;
    this.#client = await this.#connectTo(session);
    this.onConnected?.(this.#client);
  }

  async status(): Promise<SessionStatus> {
    const session = this.session;
    const summary = session ? (await fetchSessions()).find((s) => s.session === session) : undefined;
    return { canSave: summary?.canSave ?? false, options: summary?.options ?? null };
  }

  async setBloodAndGore(on: boolean): Promise<void> {
    await this.#client?.command({ type: SET_OPTION, bloodAndGore: on });
  }

  async closeSession(): Promise<void> {
    this.leaveSession();
  }

  leaveSession(): void {
    this.#client?.close();
    this.#client = null;
    this.onConnected?.(null);
  }

  save(session: string, request: SaveRequest): Promise<SaveSuccess | Refusal> {
    return saveSession(session, request);
  }

  async loadInPlace(session: string, name: string): Promise<LoadSuccess> {
    const client = this.#client;
    if (!client || client.session !== session) throw new Error(`not connected to ${session}`);
    const reply = await client.load(name);
    if (!reply.ok) throw new Error(reply.reason ?? 'load refused');
    return reply.data as LoadSuccess;
  }

  async createSession(start: SessionStart): Promise<CreatedSession> {
    const created = await createSession({ ...this.#languagePart(), ...start });
    return { session: created.session, load: created.load ?? null };
  }

  deleteSave(name: string): Promise<boolean> {
    return deleteSave(name);
  }
}
