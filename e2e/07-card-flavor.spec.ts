import { test, expect, type Page } from '@playwright/test';

/**
 * Cards Lab のフレーバー版面。
 *
 * 【本番と同じ文を出していること】
 *   ここは版面（文字量・行数・余白）を判断する場所なので、Cards Lab 専用の
 *   仮テキストを置くと本番と違う長さで判断してしまう。カードに出る文は
 *   `game/flavor.ts` の deriveFlavorText（本編と同じ）から来る。
 *
 * 【読める大きさであること】
 *   最初の版は 430px のカードで 6.1px しかなく、文として読めなかった。
 *   実測で下限を固定する。
 */

async function openCards(page: Page): Promise<void> {
  await page.goto('/lab.html?tab=cards');
  await page.waitForSelector('#cards-showcase .gmc-flavor', { timeout: 30_000 });
}

async function openSettings(page: Page): Promise<void> {
  const fold = page.locator('#cards-fold-settings');
  if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await fold.locator('> summary').click();
  }
}

test.describe('Cards Lab — フレーバーテキスト', () => {
  test('Showcase に個体固有の一文が出る', async ({ page }) => {
    await openCards(page);
    const card = page.locator('#cards-showcase .gmc-card');
    await expect(card.locator('.gmc-flavor')).toHaveCount(1);
    const text = (await card.locator('.gmc-flavor').textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(8);
  });

  test('同じ seed なら再描画しても同じ一文になる', async ({ page }) => {
    await openCards(page);
    await openSettings(page);
    const first = (await page.locator('#cards-showcase .gmc-flavor').textContent())?.trim();

    await page.locator('[data-act="regen"]').click();
    await page.waitForSelector('#cards-showcase .gmc-flavor', { timeout: 30_000 });
    const second = (await page.locator('#cards-showcase .gmc-flavor').textContent())?.trim();
    expect(second).toBe(first);
  });

  test('個体をめくると一文も変わり得る', async ({ page }) => {
    await openCards(page);
    await openSettings(page);
    const seen = new Set<string>();

    for (let i = 0; i < 8; i++) {
      const text = (await page.locator('#cards-showcase .gmc-flavor').textContent())?.trim() ?? '';
      seen.add(text);
      await page.locator('[data-act="random"]').click();
      await page.waitForSelector('#cards-showcase .gmc-flavor', { timeout: 30_000 });
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test('lite の個体一覧にはフレーバーDOMを増やさない', async ({ page }) => {
    await openCards(page);

    const fold = page.locator('#cards-fold-gallery');
    if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) {
      await fold.locator('> summary').click();
    }
    await page.waitForSelector('#cards-gallery .gmc-card', { timeout: 30_000 });
    await expect(page.locator('#cards-gallery .gmc-flavor')).toHaveCount(0);
  });
});

test.describe('Cards Lab — フレーバーの版面', () => {
  test('読める大きさで、2 行までに収まっている', async ({ page }) => {
    await openCards(page);
    const m = await page.evaluate(() => {
      const card = document.querySelector('#cards-showcase .gmc-card')!;
      const span = card.querySelector('.gmc-flavor span')!;
      const cs = getComputedStyle(span);
      return {
        cardW: card.getBoundingClientRect().width,
        fontPx: parseFloat(cs.fontSize),
        lineClamp: cs.webkitLineClamp,
        h: span.getBoundingClientRect().height,
        lineH: parseFloat(cs.lineHeight),
      };
    });
    // 【カード幅比ではなく px の下限で見る】
    //   最初の版は 6.1px しかなく読めなかったので、カード幅に対する比率で
    //   下限を引いていた。その後フレーバーをさらに小さくする判断になり、
    //   スマホでは **px の下限（max(8px, .58em)）が先に効く** ようになった。
    //   比率で見ると「下限を守ったこと」を失敗として数えてしまうので、
    //   文として読める絶対の大きさそのものを見る。
    expect(m.fontPx).toBeGreaterThanOrEqual(7.5);
    // 2 行を超えて版面を押し広げないこと。
    expect(m.h).toBeLessThanOrEqual(m.lineH * 2 + 2);
  });

  test('すべての版面に出る（比較で見比べられる）', async ({ page }) => {
    await openCards(page);
    const fold = page.locator('#cards-fold-design');
    if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) {
      await fold.locator('> summary').click();
    }
    await page.waitForSelector('#cards-cmp-design .gmc-card', { timeout: 30_000 });
    await expect(page.locator('#cards-cmp-design .gmc-flavor')).toHaveCount(4);
  });

  // 【左下に置かれていること・名前より小さいことは 08-cards-v2 が見る】
  //   あちらは枠を持たないこと・斜体であること・狭い画面では比率ではなく
  //   px の下限で見ることまで含めて検査している。二重に持たない。
});
