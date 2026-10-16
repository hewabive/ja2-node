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
      laptopOpen: boolean;
      laptopResult: string;
    };
  }
}

test('starts a campaign and keeps the squad in the garrisoned start sector', async ({ page }) => {
  await page.goto('/src/devtools/strategic/?seed=1');
  await page.waitForFunction(() => window.__ja2Strategic?.ready || window.__ja2Strategic?.error !== null);
  await expect(page.locator('#status')).toContainText('no strategic layer');

  await page.selectOption('#difficulty', '3');
  await page.click('#newCampaign');
  await page.waitForURL(/\?session=/);
  await page.waitForFunction(() => window.__ja2Strategic?.ready && window.__ja2Strategic.worldSector !== null);
  expect(await page.evaluate(() => window.__ja2Strategic.worldSector)).toBe('A9');
  expect(await page.evaluate(() => window.__ja2Strategic.clock)).toBe('Day 1, 07:00');
  await expect(page.locator('#status')).toContainText(/balance \$\d{1,2},\d{3}/);
  await expect(page.locator('[data-sector="A9"] .badge.squad')).toHaveText('S1');
  expect(await page.locator('#mercs tr').count()).toBeGreaterThan(1);

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
  await page.goto('/src/devtools/strategic/?seed=1');
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

test('hires through the laptop panel and lands the hired merc', async ({ page }) => {
  await page.goto('/src/devtools/strategic/?seed=1');
  await page.waitForFunction(() => window.__ja2Strategic?.ready || window.__ja2Strategic?.error !== null);
  await page.check('#hireInLaptop');
  await page.click('#newCampaign');
  await page.waitForURL(/\?session=/);
  await page.waitForFunction(() => window.__ja2Strategic?.ready && window.__ja2Strategic.laptopOpen);
  await expect(page.locator('#laptopTitle')).toContainText('landing zone A9');

  await page.click('#advance');
  await expect(page.locator('#result')).toContainText('the laptop is open');
  await page.click('[data-tab="aim"]');
  await page.click('#laptopBody [data-hire="1"]');
  await expect(page.locator('#laptopResult')).toHaveText(/^hired for \$\d+, arrives day 1 07:30 in A9$/);
  await page.click('[data-tab="records"]');
  await expect(page.locator('#laptopBody')).toContainText('in transit');

  await page.click('#closeLaptop');
  await page.waitForFunction(() => !window.__ja2Strategic.laptopOpen);
  await expect(page.locator('#mercs tr')).toHaveCount(2);
  await page.click('[data-compress="4"]');
  await page.click('#advance');
  await page.waitForFunction(() => window.__ja2Strategic.worldSector === 'A9');
  await page.click('#openLaptop');
  await expect(page.locator('#result')).toHaveText('mapScreenOnly');
});
