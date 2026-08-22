import { test, expect } from '@playwright/test';

test.describe('Cards Lab — フレーバーテキスト', () => {
  test('Showcase に個体固有の一文が出る', async ({ page }) => {
    await page.goto('/lab.html?tab=cards');
    await page.waitForSelector('#cards-showcase .holo-card', { timeout: 30_000 });

    const card = page.locator('#cards-showcase .gmc-card');
    await expect(card.locator('.gmc-flavor-preview')).toHaveCount(1);
    const text = (await card.locator('.gmc-flavor-preview').textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(8);
  });

  test('同じ seed なら再描画しても同じ一文になる', async ({ page }) => {
    await page.goto('/lab.html?tab=cards');
    await page.waitForSelector('#cards-showcase .gmc-flavor-preview', { timeout: 30_000 });
    const first = (await page.locator('#cards-showcase .gmc-flavor-preview').textContent())?.trim();

    await page.locator('[data-act="regen"]').click();
    await page.waitForSelector('#cards-showcase .gmc-flavor-preview', { timeout: 30_000 });
    const second = (await page.locator('#cards-showcase .gmc-flavor-preview').textContent())?.trim();
    expect(second).toBe(first);
  });

  test('個体をめくると一文も変わり得る', async ({ page }) => {
    await page.goto('/lab.html?tab=cards');
    await page.waitForSelector('#cards-showcase .gmc-flavor-preview', { timeout: 30_000 });
    const seen = new Set<string>();

    for (let i = 0; i < 8; i++) {
      const text = (await page.locator('#cards-showcase .gmc-flavor-preview').textContent())?.trim() ?? '';
      seen.add(text);
      await page.locator('[data-act="random"]').click();
      await page.waitForTimeout(80);
      await page.waitForSelector('#cards-showcase .gmc-flavor-preview', { timeout: 30_000 });
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test('lite の個体一覧にはフレーバーDOMを増やさない', async ({ page }) => {
    await page.goto('/lab.html?tab=cards');
    await page.waitForSelector('#cards-showcase .holo-card', { timeout: 30_000 });

    const fold = page.locator('#cards-fold-gallery');
    if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) {
      await fold.locator('> summary').click();
    }
    await page.waitForSelector('#cards-gallery .gmc-card', { timeout: 30_000 });
    await expect(page.locator('#cards-gallery .gmc-flavor-preview')).toHaveCount(0);
  });
});
