import { DEFAULT_STUBS_DIR } from '../../src/node/repo.ts';
import { STUB_PACK_ENV } from '../support/stub-pack.ts';

export default function useTheDevServersStubPack(): void {
  process.env[STUB_PACK_ENV] = DEFAULT_STUBS_DIR;
}
