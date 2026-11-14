import { describe, expect, it } from 'vitest';
import type { ProfilePresentation } from '../../content/narrative/profile-presentation.ts';
import type { CatalogueItem, ItemCatalogue } from '../../protocol/items.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import { TacticalMediaStore } from './tactical-media.ts';

function catalogueItem(index: number, small: string, big: string): CatalogueItem {
  return {
    index,
    name: `ITEM_${index}`,
    inventoryGraphics: { small: { path: small, subImageIndex: index }, big: { path: big, subImageIndex: 0 } },
  } as unknown as CatalogueItem;
}

describe('the item media of the map and tactical hosts', () => {
  it('preloads every small item picture of the catalogue once, as the original loads them all at the start (Interface_Items.cc:5205-5221)', async () => {
    const loaded: string[] = [];
    const assets = {
      image: async (path: string) => {
        loaded.push(path);
        return true;
      },
    } as unknown as UiAssets;
    const catalogue = {
      items: [
        catalogueItem(1, 'interface/mdguns.sti', 'bigitems/gun01.sti'),
        catalogueItem(2, 'interface/mdguns.sti', 'bigitems/gun02.sti'),
        catalogueItem(3, 'interface/mdp1items.sti', 'bigitems/p1item03.sti'),
      ],
    } as unknown as ItemCatalogue;
    const store = new TacticalMediaStore(assets, catalogue, [], false);
    await store.preload(store.smallItemPictures());
    expect(loaded).toEqual(['interface/mdguns.sti', 'interface/mdp1items.sti']);
  });
});

describe('the profile names of the map and tactical hosts', () => {
  it('shows the nickname the view renames a profile to, as every screen reads the overwritten zNickname (NPC_ACTION_TERRORIST_REVEALS_SELF)', () => {
    const profile = (id: number, nickname: string) => ({ id, name: `${nickname} Full`, nickname }) as unknown as ProfilePresentation;
    const store = new TacticalMediaStore(
      {} as UiAssets,
      { items: [] } as unknown as ItemCatalogue,
      [profile(1, 'Annie'), profile(2, 'Bob')],
      false,
    );
    store.useNicknames({ 1: 'Annie Full' });
    expect([store.profile(1)?.nickname, store.profile(2)?.nickname]).toEqual(['Annie Full', 'Bob']);
    store.useProfiles([profile(1, 'Annie'), profile(2, 'Bob')]);
    expect(store.profile(1)?.nickname).toBe('Annie Full');
    store.useNicknames({});
    expect(store.profile(1)?.nickname).toBe('Annie');
  });
});
