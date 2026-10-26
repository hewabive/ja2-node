import { describe, expect, it } from 'vitest';
import { Labels } from '../text/labels.ts';
import { failureText, lostConnection } from './failure-text.ts';

const english = new Labels('eng', null);
const russian = new Labels('rus', null);

describe('the text of a failed request', () => {
  it("names a lost connection in each browser's words and keeps them", () => {
    for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'fetch failed'])
      expect(lostConnection(new TypeError(message))).toBe(true);
    expect(failureText(english, new TypeError('Failed to fetch'))).toBe('The connection to the server was lost (Failed to fetch).');
    expect(failureText(russian, new TypeError('Failed to fetch'))).toBe('Связь с сервером потеряна (Failed to fetch).');
  });

  it('keeps any other failure as it is, a programming error included', () => {
    expect(lostConnection(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(lostConnection(new Error('Failed to fetch'))).toBe(false);
    expect(failureText(english, new Error('/vfs/laptop/laptop3.sti: HTTP 500'))).toBe('/vfs/laptop/laptop3.sti: HTTP 500');
    expect(failureText(english, 'refused')).toBe('refused');
  });
});
