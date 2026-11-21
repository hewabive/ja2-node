import { describe, expect, it } from 'vitest';
import { KEPT_MASTER_LINES_PATH, translationPath } from '../text/strings.ts';
import { isRuleFile } from './families.ts';

describe('the rule pack families', () => {
  it('hold every file the server labels its views with, the kept master lines too', () => {
    expect(isRuleFile(translationPath('eng'))).toBe(true);
    expect(isRuleFile(KEPT_MASTER_LINES_PATH)).toBe(true);
  });

  it("hold the light templates the simulation reads, the user's and the stub pack's, and no other light picture", () => {
    for (const path of ['l-r05.lht', 'light2', 'stubs/l-r05.lht', 'stubs/light6']) expect(isRuleFile(path), path).toBe(true);
    for (const path of ['light2.sti', 'transluc.lht', 'light9']) expect(isRuleFile(path), path).toBe(false);
  });
});
