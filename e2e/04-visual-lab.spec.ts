import { test, expect } from '@playwright/test';

test.describe('Visual Lab の一覧個体', () => {
  test('絞り込みで固定した新形質がクリック後の拡大表示にも残る', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto('/lab.html');

    const loci = page.locator('select.gf-locus');
    const alleles = page.locator('select.gf-allele');
    await loci.nth(0).selectOption('ears');
    // アホロートルひれ（gill）は新規抽選から撤去済み。現行カタログの耳で
    // 「一覧の強制形質がクリック後も残る」導線だけを検証する。
    await alleles.nth(0).selectOption('bearEar');
    await loci.nth(1).selectOption('horns');
    await alleles.nth(1).selectOption('coralHorn');
    await loci.nth(2).selectOption('lashes');
    await alleles.nth(2).selectOption('long');
    await page.locator('button[data-act="grid"]').click();

    const first = page.locator('#lab-grid .cell').first();
    await expect(first).toBeVisible();
    await first.click();

    const single = page.locator('#lab-single');
    await expect(single).toContainText('bearEar');
    await expect(single).toContainText('coralHorn');
    await expect(single).toContainText('long');
    expect(pageErrors).toEqual([]);
  });

  test('PC／スマホで横スクロールせず、一覧カードが読みやすい列数になる', async ({ page }) => {
    await page.goto('/lab.html');
    const grid = page.locator('#lab-grid');
    await expect(grid.locator('.cell').first()).toBeVisible();

    const metrics = await grid.evaluate((el) => ({
      bodyScrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      columns: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
      cellWidth: el.querySelector<HTMLElement>('.cell')?.getBoundingClientRect().width ?? 0,
    }));
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    const minCellWidth = (page.viewportSize()?.width ?? 1280) < 600 ? 80 : 100;
    expect(metrics.cellWidth).toBeGreaterThanOrEqual(minCellWidth);
    if ((page.viewportSize()?.width ?? 1280) < 600) expect(metrics.columns).toBeLessThanOrEqual(3);
  });

  test('PCでは一覧と選択個体を同じ作業領域で確認でき、選択先へ移動する', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) < 600, 'PC専用の配置検証');
    await page.goto('/lab.html');
    const gridCard = page.locator('#lab-grid-card');
    const singleCard = page.locator('#lab-single-card');
    await expect(gridCard).toBeVisible();
    await expect(singleCard).toBeVisible();

    const layout = await Promise.all([gridCard.boundingBox(), singleCard.boundingBox()]);
    const gridBox = layout[0];
    const singleBox = layout[1];
    expect(gridBox).not.toBeNull();
    expect(singleBox).not.toBeNull();
    expect(singleBox!.x).toBeGreaterThan(gridBox!.x + gridBox!.width - 2);
    expect(Math.abs(singleBox!.y - gridBox!.y)).toBeLessThanOrEqual(2);

    const selected = page.locator('#lab-grid .cell').nth(3);
    await selected.click();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(singleCard).toBeInViewport();
  });
});
