import { createServer, isIPv6 } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { LOOPBACK_HOSTS } from '../allowed-hosts.ts';

export const NETWORK_HOST = '0.0.0.0';
export const SERVER_NAME = 'ja2-node';
export const LOGIN_PATH = '/login';
export const HEALTH_PATH = '/api/health';

const WILDCARD_HOSTS: ReadonlySet<string> = new Set([NETWORK_HOST, '::', '[::]']);
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(['localhost', '::1', '[::1]']);
const LOOPBACK_V4_PREFIX = '127.';
const LINK_LOCAL_V6_PREFIX = 'fe80:';
const BROWSER_HOST = '127.0.0.1';
const MDNS_SUFFIX = '.local';
const PROBE_TIMEOUT_MS = 1500;

export type InterfaceTable = NodeJS.Dict<readonly NetworkInterfaceInfo[]>;

export type Access = 'local' | 'network' | 'custom';

export type PortState = 'free' | 'ours' | 'busy';

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_NAMES.has(host.toLowerCase()) || host.startsWith(LOOPBACK_V4_PREFIX);
}

export function isWildcardHost(host: string): boolean {
  return WILDCARD_HOSTS.has(host);
}

export function accessOf(host: string): Access {
  if (isLoopbackHost(host)) return 'local';
  return isWildcardHost(host) ? 'network' : 'custom';
}

function urlHost(address: string): string {
  return isIPv6(address) ? `[${address}]` : address;
}

function reachable(info: NetworkInterfaceInfo): boolean {
  return !info.internal && !info.address.toLowerCase().startsWith(LINK_LOCAL_V6_PREFIX);
}

export function lanAddresses(table: InterfaceTable): string[] {
  return Object.values(table)
    .flatMap((infos) => infos ?? [])
    .filter((info) => reachable(info) && info.family === 'IPv4')
    .map((info) => info.address);
}

export function allowedHostsFor(host: string, table: InterfaceTable, hostname: string): readonly string[] | undefined {
  if (isLoopbackHost(host)) return undefined;
  if (!isWildcardHost(host)) return [...LOOPBACK_HOSTS, urlHost(host).toLowerCase()];
  const addresses = Object.values(table)
    .flatMap((infos) => infos ?? [])
    .filter(reachable)
    .map((info) => urlHost(info.address).toLowerCase());
  const name = hostname.toLowerCase();
  return [...new Set([...LOOPBACK_HOSTS, ...addresses, name, `${name}${MDNS_SUFFIX}`])];
}

export function browserOrigin(host: string, port: number): string {
  return `http://${isWildcardHost(host) ? BROWSER_HOST : urlHost(host)}:${port}`;
}

export function networkOrigins(host: string, port: number, table: InterfaceTable): string[] {
  if (isLoopbackHost(host)) return [];
  const hosts = isWildcardHost(host) ? lanAddresses(table) : [urlHost(host)];
  return hosts.map((h) => `http://${h}:${port}`);
}

export function loginUrl(origin: string, token: string): string {
  return `${origin}${LOGIN_PATH}?token=${encodeURIComponent(token)}`;
}

export function portFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ host, port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

export async function serverAnswers(origin: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}${HEALTH_PATH}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const health = (await response.json()) as { name?: unknown } | null;
    return health?.name === SERVER_NAME;
  } catch {
    return false;
  }
}

export async function portState(host: string, port: number, token: string): Promise<PortState> {
  if (await portFree(host, port)) return 'free';
  return (await serverAnswers(browserOrigin(host, port), token)) ? 'ours' : 'busy';
}
