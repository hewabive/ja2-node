import { spawn } from 'node:child_process';
import type { PlayerPlatform } from './dirs.ts';

export interface BrowserCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly verbatim: boolean;
}

export function hasDisplay({ os, env }: PlayerPlatform): boolean {
  return os === 'win32' || os === 'darwin' || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

export function browserCommand(os: NodeJS.Platform, url: string): BrowserCommand {
  if (os === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', `"${url}"`], verbatim: true };
  if (os === 'darwin') return { command: 'open', args: [url], verbatim: false };
  return { command: 'xdg-open', args: [url], verbatim: false };
}

export function openBrowser(url: string, platform: PlayerPlatform): boolean {
  if (!hasDisplay(platform)) return false;
  const { command, args, verbatim } = browserCommand(platform.os, url);
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
  child.on('error', () => {});
  child.unref();
  return true;
}
