import { describe, expect, it } from 'vitest';
import { KEPT_MASTER_LINES_PATH, translationPath } from '../text/strings.ts';
import { isRuleFile } from './families.ts';

describe('the rule pack families', () => {
  it('hold every file the server labels its views with, the kept master lines too', () => {
    expect(isRuleFile(translationPath('eng'))).toBe(true);
    expect(isRuleFile(KEPT_MASTER_LINES_PATH)).toBe(true);
  });
});
