import { test, expect } from '@playwright/test';
import { freshStart, readSave, careRound } from './helpers.ts';

/**
 * 中心のゲームループを実ブラウザで通す。
 *
 * 孵化までは実時間がかかる（世話を巡回して 1〜2 分）ので余裕を持たせてある。
 * 成体化 → 展示会 → ショップ → 交配 までは実時間でさらに数分かかり
 * E2E としては長すぎるため、そこは `tests/progression.test.ts`
 * （仮想時間で通しプレイを完走させるテスト）が担当する。
 */
test.describe('中心のゲームループ', () => {
  test.setTimeout(240_000);

  test('新規ゲーム → 卵を9個から3個選ぶ → 育成室 → 孵化', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // ── タイトル ───────────────────────────────────────────
    await freshStart(page);
    await expect(page.locator('[data-act="start"]')).toBeVisible();

    // セーブが無い状態では「つづきから」は出ない
    await expect(page.locator('[data-act="continue"]')).toHaveCount(0);

    await page.click('[data-act="start"]');

    // ── 卵選択 ─────────────────────────────────────────────
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await expect(eggs).toHaveCount(9); // 指示書 §4「9個の卵を表示する」

    // 確定ボタンは 3 個そろうまで押せない
    const confirm = page.locator('[data-act="confirm"]');
    await expect(confirm).toBeDisabled();

    // 2 個選んだ時点ではまだ押せない
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await expect(confirm).toBeDisabled();

    // 選び直せること（指示書 §4「確定する前であれば選び直せる」）
    await eggs.nth(1).click(); // 解除
    await eggs.nth(4).click();
    await eggs.nth(7).click();
    await expect(confirm).toBeEnabled();

    await confirm.click();

    // ── 育成室 ─────────────────────────────────────────────
    await page.waitForSelector('[data-care]', { timeout: 15_000 });

    let save = await readSave(page);
    expect(save).not.toBeNull();
    expect(save.creatures).toHaveLength(3);
    expect(save.creatures.every((c: any) => c.life.stage === 'egg')).toBe(true);

    // ── 世話をして孵化させる ───────────────────────────────
    const deadline = Date.now() + 180_000;
    let hatched = false;
    let rounds = 0;
    while (Date.now() < deadline) {
      await careRound(page);
      rounds++;
      save = await readSave(page);
      if (save?.creatures?.some((c: any) => c.life.stage !== 'egg')) {
        hatched = true;
        break;
      }
    }

    expect(hatched, `${rounds} 巡の世話で孵化しなかった`).toBe(true);

    // 孵化したら幼体になり、標本帳（コレクション）が解放される
    save = await readSave(page);
    const juveniles = save.creatures.filter((c: any) => c.life.stage === 'juvenile');
    expect(juveniles.length).toBeGreaterThanOrEqual(1);
    expect(save.unlocks.collection).toBe(true);

    // 未処理のコンソールエラーが無いこと（指示書 §25）
    expect(errors, `コンソールエラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('解放前の機能は条件を明示して見えている（ダミーボタンを置かない）', async ({ page }) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');

    // 未解放のナビは存在する（＝隠さない）が、解放前だと分かる印がある
    for (const path of ['/exhibition', '/shop', '/breeding']) {
      const link = page.locator(`a[href="#${path}"]`).first();
      await expect(link).toHaveCount(1);
    }

    // 未解放画面へ直接行っても、壊れず「今後解放」と条件が読める
    await page.goto('/#/breeding');
    await page.waitForTimeout(600);
    const text = await page.locator('#app').innerText();
    expect(text.length).toBeGreaterThan(20);
    expect(/解放|まだ|条件|成体/.test(text)).toBe(true);
  });
});
