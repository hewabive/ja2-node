import { type MessagePort, parentPort, workerData } from 'node:worker_threads';
import type { CommandEnvelope, DriverMode } from '../protocol/messages.ts';
import type { StopCondition } from '../sim/advance.ts';
import type { SaveRequest } from './save-service.ts';
import { openSessionEnvironment } from './session-environment.ts';
import type { SessionHost } from './session-host.ts';
import { type FromWorker, type HostCall, type ToWorker, type WorkerStart, wireError } from './worker-host.ts';

type CallHandler = (host: SessionHost, args: readonly unknown[]) => Promise<unknown>;

const CALLS: Readonly<Record<Exclude<HostCall, 'close'>, CallHandler>> = {
  dispatch: (h, [cmd]) => h.dispatch(cmd as CommandEnvelope),
  prepareAndDispatch: (h, [cmd]) => h.prepareAndDispatch(cmd as CommandEnvelope),
  query: (h, [q]) => h.query(q as CommandEnvelope),
  advance: (h, [until, budget]) => h.advance(until as StopCondition, budget as number | undefined),
  setDriver: (h, [driver]) => h.setDriver(driver as DriverMode),
  save: (h, [request]) => h.save(request as SaveRequest),
  saveSnapshot: (h, [name, description]) => h.saveSnapshot(name as string, description as string | undefined),
  load: (h, [name, reseed]) => h.load(name as string, reseed as boolean),
  describe: (h) => h.describe(),
  observe: (h) => h.observe(),
  report: (h) => h.report(),
  snapshot: (h) => h.snapshot(),
  inputLog: (h) => h.inputLog(),
  profiles: (h) => h.profiles(),
};

interface Booted {
  readonly host: SessionHost;
  close(): Promise<void>;
}

async function boot(start: WorkerStart, post: (m: FromWorker) => void): Promise<Booted> {
  const environment = await openSessionEnvironment(start.config, (message) => post({ t: 'warn', message }));
  try {
    const host = await environment.createHost(start.id, start.request);
    return {
      host,
      close: async () => {
        await host.close();
        await environment.close();
      },
    };
  } catch (err) {
    await environment.close();
    throw err;
  }
}

function serve(port: MessagePort, booted: Booted, post: (m: FromWorker) => void): void {
  const subscriptions = new Map<number, () => void>();
  const answer = (seq: number, work: Promise<unknown>) =>
    work.then(
      (value) => post({ t: 'result', seq, value }),
      (err: unknown) => post({ t: 'error', seq, error: wireError(err) }),
    );
  port.on('message', (m: ToWorker) => {
    switch (m.op) {
      case 'subscribe':
        subscriptions.set(
          m.sub,
          booted.host.subscribe((message) => post({ t: 'message', sub: m.sub, message })),
        );
        return;
      case 'unsubscribe':
        subscriptions.get(m.sub)?.();
        subscriptions.delete(m.sub);
        return;
      case 'call':
        if (m.method === 'close') {
          for (const unsubscribe of subscriptions.values()) unsubscribe();
          subscriptions.clear();
          return void answer(m.seq, booted.close());
        }
        return void answer(m.seq, CALLS[m.method](booted.host, m.args));
    }
  });
}

function poster(port: MessagePort): (m: FromWorker) => void {
  return (m) => {
    try {
      port.postMessage(m);
    } catch (err) {
      if (m.t !== 'result') throw err;
      port.postMessage({ t: 'error', seq: m.seq, error: wireError(err) } satisfies FromWorker);
    }
  };
}

const port = parentPort;
if (!port) throw new Error('the session worker runs in a worker thread');
const post = poster(port);
boot(workerData as WorkerStart, post).then(
  (booted) => {
    serve(port, booted, post);
    post({ t: 'ready', savesAvailable: booted.host.savesAvailable });
  },
  (err: unknown) => post({ t: 'failed', error: wireError(err) }),
);
