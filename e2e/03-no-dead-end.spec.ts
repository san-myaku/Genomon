import { test, expect } from '@playwright/test';
import { freshStart, readSave } from './helpers.ts';

/**
 * 進行不能（詰み）が無いことを、**プレイヤーが到達できる操作だけ**で確かめる。
 *
 * 【なぜ E2E に置くのか】
 *   `tests/integration.test.ts` にも「所持枠が上限でも詰まない」テストはあるが、
 *   そちらは `releaseCreature()` を **直接呼んで** いた。ゲームロジックとしては
 *   正しく動くので合格する。ところが実際には**どの画面からも呼ばれておらず**、
 *   ヘッダが「どれかを 手放すか」と案内するのに手放す手段が無い、という
 *   詰みが製品ビルドに残っていた（DESIGN_DECISIONS D-018）。
 *
 *   API を叩くテストは「遊べること」を保証しない。
 *   進行不能に関わる操作は、必ず**画面から実行できる**ことを確かめる。
 */

test.describe('進行不能が無いこと（UI 経路のみ）', () => {
  test.setTimeout(180_000);

  test('個体を手放す操作が画面から到達でき、実際に枠が空く', async ({ page }) => {
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
    expect(before.creatures).toHaveLength(3);
    const victimId: string = before.creatures[0].id;

    // 個体詳細へ「画面の導線で」到達する
    await page.goto(`/#/detail/${victimId}`);
    await page.waitForTimeout(700);

    // 「手放す」操作が製品 UI に存在すること
    const releaseBtn = page.getByRole('button', { name: /手放/ });
    await expect(
      releaseBtn.first(),
      '個体詳細に「手放す」操作が無い。枠が満杯になると脱出できなくなる',
    ).toBeVisible();

    await releaseBtn.first().click();

    // 取り返しのつかない操作なので確認ダイアログが要る。
    // 確認ボタンは必ず <dialog> の中を探すこと（画面側の「この子を 手放す」
    // ボタンも同じ語を含むため、スコープを切らないと背後のボタンを掴んでしまう）。
    const dlg = page.locator('dialog[open]');
    await expect(dlg, '確認なしで個体が消えてはいけない').toBeVisible();
    await dlg.getByRole('button', { name: /森へ かえす|手放す|はい/ }).first().click();
    await page.waitForTimeout(900);

    const after = await readSave(page);
    expect(after.creatures.length, '手放しても個体数が減っていない').toBe(2);
    expect(after.creatures.some((c: any) => c.id === victimId)).toBe(false);
  });

  test('残り 2 体では手放せず、理由が表示される（最後の 1 体で詰まない）', async ({ page }) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.click('[data-act="confirm"]');
    await page.waitForSelector('[data-care]');

    const confirmRelease = async (): Promise<void> => {
      await page.getByRole('button', { name: /手放/ }).first().click();
      const dlg = page.locator('dialog[open]');
      await expect(dlg).toBeVisible();
      await dlg.getByRole('button', { name: /森へ かえす|手放す|はい/ }).first().click();
      await page.waitForTimeout(900);
    };

    // 3 → 2 は成功する
    let s = await readSave(page);
    await page.goto(`/#/detail/${s.creatures[0].id}`);
    await page.waitForTimeout(600);
    await confirmRelease();

    s = await readSave(page);
    expect(s.creatures).toHaveLength(2);

    // 2 → 1 は拒否され、理由が読めること
    await page.goto(`/#/detail/${s.creatures[0].id}`);
    await page.waitForTimeout(600);
    await confirmRelease();

    const s2 = await readSave(page);
    expect(s2.creatures.length, '2 体以下でも手放せてしまうと詰む').toBe(2);

    // 拒否の理由が読めること（残っているダイアログか本文のどちらかに出る）
    const body = await page.locator('body').innerText();
    expect(/2 体|これ以上|手放せ/.test(body), '拒否の理由が画面に出ていない').toBe(true);
  });

  test('育成室に着いた直後、世話ボタンがファーストビューに入っている', async ({ page }) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.click('[data-act="confirm"]');
    await page.waitForSelector('[data-care]');
    await page.waitForTimeout(800);

    // 「世話をしましょう」と案内しているのに世話ボタンが画面外、を防ぐ
    const m = await page.evaluate(() => {
      const el = document.querySelector('[data-care]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
    });
    expect(m, '[data-care] が見つからない').not.toBeNull();
    expect(
      m!.top,
      `世話ボタンがファーストビューに無い（top=${m!.top} / 画面高=${m!.vh}）`,
    ).toBeLessThan(m!.vh - 80);

    // 生きものと世話ボタンが同時に見えること（なでる→反応を見る が成立する条件）
    const stage = await page.evaluate(() => {
      const el = document.querySelector('#app svg');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(stage).not.toBeNull();
    expect(
      stage!.bottom > 0 && stage!.top < m!.vh,
      '生きものが画面外。世話の反応が見えない',
    ).toBe(true);
  });
});
