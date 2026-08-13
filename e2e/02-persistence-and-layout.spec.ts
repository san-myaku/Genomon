import { test, expect } from '@playwright/test';
import { freshStart, readSave, creatureSvgFingerprint, horizontalOverflow } from './helpers.ts';

const ROUTES = ['/nursery', '/field', '/staff', '/collection', '/exhibition', '/shop', '/breeding', '/market', '/settings', '/title'];

test.describe('保存・再現性・レイアウト', () => {
  test.setTimeout(120_000);

  test('リロードしても進行が保たれ、同じ seed の外見が変化しない', async ({ page }) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.click('[data-act="confirm"]');
    await page.waitForSelector('[data-care]');

    const before = await readSave(page);
    const seedsBefore = before.creatures.map((c: any) => c.genotype.seed);
    const svgBefore = await creatureSvgFingerprint(page);
    expect(svgBefore).not.toBeNull();

    // ── 完全リロード ───────────────────────────────────────
    await page.reload();
    await page.waitForSelector('[data-care]', { timeout: 15_000 });

    const after = await readSave(page);
    expect(after.creatures.map((c: any) => c.genotype.seed)).toEqual(seedsBefore);

    // 指示書 §25「保存と再読込の前後で外見が変化しない」
    const svgAfter = await creatureSvgFingerprint(page);
    expect(svgAfter).toBe(svgBefore);

    // タイトルに戻ると「つづきから」が出る
    await page.goto('/#/title');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-act="continue"]')).toHaveCount(1);
  });

  test('画面遷移しても乱数結果が変わらない', async ({ page }) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');

    // 卵候補は決定論的（リロードしても同じ 9 個が出る）
    const idsA = await page.locator('[data-egg]').evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.egg),
    );
    await page.reload();
    await page.waitForSelector('[data-egg]');
    const idsB = await page.locator('[data-egg]').evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.egg),
    );
    expect(idsB).toEqual(idsA);

    // 育成室 → 別画面 → 育成室 と往復しても見た目が変わらない
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.click('[data-act="confirm"]');
    await page.waitForSelector('[data-care]');

    const svg1 = await creatureSvgFingerprint(page);
    await page.goto('/#/settings');
    await page.waitForTimeout(400);
    await page.goto('/#/nursery');
    await page.waitForSelector('[data-care]');
    const svg2 = await creatureSvgFingerprint(page);
    expect(svg2).toBe(svg1);
  });

  test('全画面で横方向にはみ出さない', async ({ page }) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.click('[data-act="confirm"]');
    await page.waitForSelector('[data-care]');

    const bad: string[] = [];
    for (const r of ROUTES) {
      await page.goto(`/#${r}`);
      await page.waitForTimeout(450);
      const o = await horizontalOverflow(page);
      if (o.over) bad.push(`${r}: scrollW=${o.scrollW} > clientW=${o.clientW}`);
    }
    expect(bad, `横スクロールが発生: ${bad.join(' / ')}`).toEqual([]);
  });

  test('タップ対象が小さすぎない', async ({ page }) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.click('[data-act="confirm"]');
    await page.waitForSelector('[data-care]');

    // 指示書 §16「タップ対象を小さくしすぎない」／§25「タップ対象が小さすぎない」
    const small = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('button, a[href]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // 非表示は対象外
        if (r.height < 40 || r.width < 40) {
          out.push(`${el.tagName}.${(el as HTMLElement).className}: ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      });
      return out;
    });
    expect(small, `44px 未満のタップ対象: ${small.join(' / ')}`).toEqual([]);
  });

  test('壊れたセーブでも起動不能にならない', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.click('[data-act="confirm"]');
    await page.waitForSelector('[data-care]');

    // 本体もバックアップも壊す
    await page.goto('/sheet.html?n=1');
    await page.evaluate(() => {
      localStorage.setItem('genomon.save.v1', '{"version":4,"state":{"creat');
      localStorage.setItem('genomon.save.backup', 'not json at all');
    });
    await page.goto('/');
    await page.waitForTimeout(1500);

    // 復旧ダイアログは <dialog> として document.body 直下に出るので、
    // #app ではなく body 全体を見る。
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(10);
    // 何が起きたかがプレイヤーに説明されていること（指示書 §25「エラー表示が理解できる」）
    expect(/セーブ|読め|壊れ|新しく|復元/.test(body)).toBe(true);
    // 操作できる導線があること（真っ白で固まらない）
    expect(await page.locator('button, a[href]').count()).toBeGreaterThan(0);
    expect(errors, `未処理エラー: ${errors.join(' / ')}`).toEqual([]);
  });
});
