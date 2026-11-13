import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  accessOf,
  allowedHostsFor,
  browserOrigin,
  HEALTH_PATH,
  type InterfaceTable,
  lanAddresses,
  loginUrl,
  networkOrigins,
  portFree,
  portState,
} from './network.ts';

function info(address: string, internal = false): NetworkInterfaceInfo {
  const common = { address, internal, mac: '00:00:00:00:00:00', cidr: null, netmask: '255.255.255.0' };
  return address.includes(':') ? { ...common, family: 'IPv6', scopeid: 0 } : { ...common, family: 'IPv4' };
}

const TABLE: InterfaceTable = {
  lo: [info('127.0.0.1', true), info('::1', true)],
  eth0: [info('192.168.1.5'), info('fe80::1'), info('2001:db8::5')],
};

describe('who may reach the server', () => {
  it('tells the access of an address', () => {
    expect(accessOf('127.0.0.1')).toBe('local');
    expect(accessOf('localhost')).toBe('local');
    expect(accessOf('0.0.0.0')).toBe('network');
    expect(accessOf('192.168.1.5')).toBe('custom');
  });

  it('keeps the loopback default on this computer only', () => {
    expect(allowedHostsFor('127.0.0.1', TABLE, 'box')).toBeUndefined();
  });

  it('lets the other devices of the network in by address and by name', () => {
    expect(allowedHostsFor('0.0.0.0', TABLE, 'Box')).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
      '192.168.1.5',
      '[2001:db8::5]',
      'box',
      'box.local',
    ]);
    expect(allowedHostsFor('192.168.1.5', TABLE, 'box')).toEqual(['localhost', '127.0.0.1', '[::1]', '192.168.1.5']);
  });

  it('opens the browser on this computer and names the links for the others', () => {
    expect(browserOrigin('0.0.0.0', 7420)).toBe('http://127.0.0.1:7420');
    expect(browserOrigin('::1', 7420)).toBe('http://[::1]:7420');
    expect(lanAddresses(TABLE)).toEqual(['192.168.1.5']);
    expect(networkOrigins('0.0.0.0', 7420, TABLE)).toEqual(['http://192.168.1.5:7420']);
    expect(networkOrigins('127.0.0.1', 7420, TABLE)).toEqual([]);
    expect(loginUrl('http://127.0.0.1:7420', 'abc')).toBe('http://127.0.0.1:7420/login?token=abc');
  });
});

describe('a port the game wants', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function listening(name: string): Promise<number> {
    server = createServer((req, res) => {
      const ours = req.url === HEALTH_PATH && req.headers.authorization === 'Bearer secret';
      res.writeHead(ours ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ours ? { ok: true, name } : { error: 'unauthorized' }));
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    return (server.address() as AddressInfo).port;
  }

  it('is free, taken by a running ja2-node, or taken by another program', async () => {
    const port = await listening('ja2-node');
    expect(await portFree('127.0.0.1', port)).toBe(false);
    expect(await portState('127.0.0.1', port, 'secret')).toBe('ours');
    expect(await portState('127.0.0.1', port, 'other token')).toBe('busy');
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    expect(await portState('127.0.0.1', port, 'secret')).toBe('free');
    expect(await portState('127.0.0.1', await listening('something else'), 'secret')).toBe('busy');
  });
});
