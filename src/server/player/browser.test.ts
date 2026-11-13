import { describe, expect, it } from 'vitest';
import { browserCommand, hasDisplay } from './browser.ts';

describe('opening the game in the browser', () => {
  const url = 'http://127.0.0.1:7420/login?token=abc';

  it('asks each system for its default browser', () => {
    expect(browserCommand('linux', url)).toEqual({ command: 'xdg-open', args: [url], verbatim: false });
    expect(browserCommand('darwin', url)).toEqual({ command: 'open', args: [url], verbatim: false });
    expect(browserCommand('win32', url)).toEqual({ command: 'cmd', args: ['/c', 'start', '""', `"${url}"`], verbatim: true });
  });

  it('does not try without a display on Linux, as over SSH', () => {
    expect(hasDisplay({ os: 'linux', env: {}, home: '/h' })).toBe(false);
    expect(hasDisplay({ os: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, home: '/h' })).toBe(true);
    expect(hasDisplay({ os: 'win32', env: {}, home: 'C:\\h' })).toBe(true);
  });
});
