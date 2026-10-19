import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { knowledgeRules, knowledgeWorld } from '../sim/knowledge/knowledge-world.ts';
import { answerHint } from '../sim/hints/answer.ts';
import { createSandboxSession } from './sandbox.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

describe('explore', () => {
  it('runs hints in strict mode', async () => {
    const session = await createSandboxSession(kit.read, false);
    const view = session.view();
    const rules = knowledgeRules(kit.content, { world: (p) => kit.world(p) });
    const errors = new Map<string, number>();
    const own = view.soldiers.filter((s) => s.team === 0);
    const others = view.soldiers.filter((s) => s.team !== 0);
    console.log('own', own.length, 'others', others.length, 'light', JSON.stringify(view.light).slice(0, 200));
    for (const s of own) {
      for (let k = 0; k < 40; k++) {
        const to = s.gridNo + (k % 8) * 3 + Math.trunc(k / 8) * 160 * 2;
        const strict = knowledgeWorld(view, rules, { strict: true });
        try {
          const a = answerHint(strict, { type: 'previewMove', soldier: s.id, to, mode: k % 2 ? 'run' : undefined });
          const b = answerHint(knowledgeWorld(view, rules), { type: 'previewMove', soldier: s.id, to, mode: k % 2 ? 'run' : undefined });
          expect(a).toEqual(b);
        } catch (err) {
          const msg = (err as Error).message;
          errors.set(msg, (errors.get(msg) ?? 0) + 1);
        }
      }
      for (const o of others) {
        try {
          const a = answerHint(knowledgeWorld(view, rules, { strict: true }), { type: 'estimateAttack', soldier: s.id, target: o.gridNo });
          console.log('estimate', JSON.stringify(a).slice(0, 300));
        } catch (err) {
          const msg = (err as Error).message;
          errors.set(msg, (errors.get(msg) ?? 0) + 1);
        }
      }
    }
    console.log([...errors.entries()].map(([m, n]) => `${n}x ${m}`).join('\n'));
  }, 120_000);
});
