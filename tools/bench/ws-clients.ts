import { parentPort, workerData } from 'node:worker_threads';

export type ClientRole = 'viewer' | 'battle';

export interface ClientPlan {
  readonly url: string;
  readonly sessions: readonly { readonly id: string; readonly role: ClientRole }[];
  readonly windowMs: number;
  readonly realtimeSpeed: number;
}

export interface ClientReport {
  readonly bytes: number;
  readonly viewerBytes: number;
  readonly messages: number;
  readonly frames: number;
  readonly turnMs: readonly number[];
  readonly battlesOver: number;
  readonly errors: readonly string[];
  readonly elapsedMs: number;
}

interface ServerMessage {
  readonly t: string;
  readonly id?: number;
  readonly ok?: boolean;
  readonly frames?: readonly unknown[];
  readonly message?: string;
}

const DRIVE_ID = 1;
const FIRST_COMMAND_ID = 2;

function run(plan: ClientPlan): Promise<ClientReport> {
  const started = performance.now();
  let bytes = 0;
  let viewerBytes = 0;
  let messages = 0;
  let frames = 0;
  let battlesOver = 0;
  const turnMs: number[] = [];
  const errors: string[] = [];
  const sockets: WebSocket[] = [];
  let closing = false;
  const connect = (id: string, role: ClientRole) => {
    const ws = new WebSocket(plan.url);
    sockets.push(ws);
    let nextId = FIRST_COMMAND_ID;
    let sentAt = 0;
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const endTurn = () => {
      sentAt = performance.now();
      send({ t: 'cmd', id: nextId++, cmd: { type: 'endTurn' } });
    };
    ws.addEventListener('open', () => {
      send({ t: 'hello', session: id });
      sentAt = performance.now();
      send({ t: 'drive', id: DRIVE_ID, driver: role === 'viewer' ? { mode: 'realtime', speed: plan.realtimeSpeed } : { mode: 'instant' } });
    });
    ws.addEventListener('message', (event) => {
      const text = String(event.data);
      const size = Buffer.byteLength(text);
      bytes += size;
      if (role === 'viewer') viewerBytes += size;
      messages++;
      const m = JSON.parse(text) as ServerMessage;
      if (m.t === 'frames') frames += m.frames?.length ?? 0;
      if (m.t === 'error') errors.push(`${id}: ${m.message ?? ''}`);
      if (role !== 'battle' || m.t !== 'result' || closing) return;
      turnMs.push(performance.now() - sentAt);
      if (m.id === DRIVE_ID || m.ok) endTurn();
      else battlesOver++;
    });
    ws.addEventListener('error', () => {
      if (!closing) errors.push(`${id}: socket error`);
    });
  };
  for (const s of plan.sessions) connect(s.id, s.role);
  return new Promise((resolve) => {
    setTimeout(() => {
      closing = true;
      for (const ws of sockets) ws.close();
      resolve({ bytes, viewerBytes, messages, frames, turnMs, battlesOver, errors, elapsedMs: performance.now() - started });
    }, plan.windowMs);
  });
}

if (parentPort && workerData) {
  const port = parentPort;
  void run(workerData as ClientPlan).then((report) => port.postMessage(report));
}
