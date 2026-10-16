import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __ja2Strategic: {
      ready: boolean;
      session: string | null;
      worldSector: string | null;
      clock: string | null;
      error: string | null;
      lastResult: string | null;
    };
    __ja2Tactical: {
      ready: boolean;
      map: string | null;
      soldiers: number;
      drawnSoldiers: number;
      selected: number | null;
      selectedGridNo: number | null;
      tick: number;
      error: string | null;
      lastResult: string | null;
    };
  }
}

test('starts a campaign and keeps the squad in the garrisoned start sector', async ({ page }) => {
  await page.goto('/src/devtools/strategic/');
  await page.waitForFunction(() => window.__ja2Strategic?.ready || window.__ja2Strategic?.error !== null);
  await expect(page.locator('#status')).toContainText('no strategic layer');

  await page.selectOption('#difficulty', '3');
  await page.click('#newCampaign');
  await page.waitForURL(/\?session=/);
  await page.waitForFunction(() => window.__ja2Strategic?.ready && window.__ja2Strategic.worldSector !== null);
  expect(await page.evaluate(() => window.__ja2Strategic.worldSector)).toBe('A9');
  expect(await page.evaluate(() => window.__ja2Strategic.clock)).toBe('Day 1, 07:00');
  await expect(page.locator('#status')).toContainText('balance $30,000');
  await expect(page.locator('[data-sector="A9"] .badge.squad')).toHaveText('S1');
  await expect(page.locator('#mercs tr')).toHaveCount(5);

  const session = await page.evaluate(() => window.__ja2Strategic.session);
  await page.goto(`/src/devtools/tactical/?session=${session}`);
  await page.waitForFunction(() => window.__ja2Tactical?.ready || window.__ja2Tactical?.error !== null);
  expect(await page.evaluate(() => window.__ja2Tactical.error)).toBeNull();
  expect(await page.evaluate(() => window.__ja2Tactical.map)).toBe('stubs/world/maps/a9.dat');
  expect(await page.evaluate(() => window.__ja2Tactical.soldiers)).toBeGreaterThanOrEqual(4);

  await page.goto(`/src/devtools/strategic/?session=${session}`);
  await page.waitForFunction(() => window.__ja2Strategic?.ready && window.__ja2Strategic.worldSector !== null);
  for (const box of await page.locator('#mercs input[type="checkbox"]').all()) await box.check();
  await page.click('[data-sector="B9"]');
  await page.click('#route');
  await expect(page.locator('#result')).toHaveText('the squad cannot move: enemiesPresent');
  await expect(page.locator('[data-sector="B9"]')).not.toHaveClass(/route/);
  await page.click('#advance');
  await expect(page.locator('#result')).toContainText('stopped: refused (time compression works on the strategic map only)');
  await page.click('#mapScreen');
  await expect(page.locator('#status')).toContainText('strategic');
  await page.click('#advance');
  await expect(page.locator('#result')).toContainText('stopped: refused (enemies are present in the loaded sector)');
  await page.click('#tacticalScreen');
  await expect(page.locator('#status')).toContainText('tactical');
  await expect(page.locator('#battle')).toBeHidden();
});

test('extends and ends merc contracts from the map screen', async ({ page }) => {
  await page.goto('/src/devtools/strategic/');
  await page.waitForFunction(() => window.__ja2Strategic?.ready || window.__ja2Strategic?.error !== null);
  await page.click('#newCampaign');
  await page.waitForURL(/\?session=/);
  await page.waitForFunction(() => window.__ja2Strategic?.ready && window.__ja2Strategic.worldSector !== null);
  await expect(page.locator('#mercs tr').nth(1)).toContainText('7d 0h left');

  const boxes = page.locator('#mercs input[type="checkbox"]');
  await boxes.first().check();
  await page.click('[data-contract="day"]');
  await expect(page.locator('#result')).toHaveText('mapScreenOnly');
  await page.click('#mapScreen');
  await page.click('[data-contract="day"]');
  await expect(page.locator('#result')).toHaveText(/^extended for \$\d+$/);
  await expect(page.locator('#mercs tr').nth(1)).toContainText('8d 0h left');

  await boxes.first().uncheck();
  await boxes.last().check();
  await page.click('[data-contract="dismiss"]');
  await expect(page.locator('#battleTitle')).toHaveText('Decision: mercDeparture');
  await page.click('#choices [data-choice="here"]');
  await expect(page.locator('#battle')).toBeHidden();
  await expect(page.locator('#mercs tr')).toHaveCount(4);
});
