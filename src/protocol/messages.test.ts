import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './messages.ts';

describe('client messages', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage('{"t":"hello"}')).toEqual({ t: 'hello' });
    expect(parseClientMessage('{"t":"cmd","id":1,"cmd":{"type":"move","soldier":3}}')).toMatchObject({ t: 'cmd', id: 1 });
    expect(parseClientMessage('{"t":"advance","id":2,"until":{"idle":true}}')).toMatchObject({ t: 'advance' });
    expect(parseClientMessage('{"t":"drive","id":3,"driver":{"mode":"realtime","speed":4}}')).toMatchObject({ t: 'drive' });
  });

  it('rejects garbage and out-of-range values', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('{"t":"cmd","id":1,"cmd":{}}')).toBeNull();
    expect(parseClientMessage('{"t":"drive","id":3,"driver":{"mode":"realtime","speed":1000}}')).toBeNull();
    expect(parseClientMessage('{"t":"nuke"}')).toBeNull();
  });
});
