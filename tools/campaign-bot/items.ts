import { type ItemTable, loadItemTable } from '../../src/content/items/items.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';

export async function loadItems(): Promise<ItemTable> {
  const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR });
  try {
    return await loadItemTable(async (path) => JSON.parse(new TextDecoder().decode(await data.vfs.read(path))));
  } finally {
    await data.close();
  }
}
