import { test, expect } from '@playwright/test';
import { freshStart } from './helpers.ts';

test.describe('飼育フィールド', () => {
  test('3体が同じフィールドで観察でき、配置モードへ入れる', async ({ page }, testInfo) => {
    await freshStart(page);
    await page.click('[data-act="start"]');
    await page.waitForSelector('[data-egg]');
    const eggs = page.locator('[data-egg]');
    await eggs.nth(0).click();
    await eggs.nth(1).click();
    await eggs.nth(2).click();
    await page.locator('[data-act="confirm"]').click();
    await page.waitForSelector('[data-care]');

    await page.goto('/#/field');
    await page.waitForSelector('[data-field-scene]');
    await expect(page.locator('[data-field-creature]')).toHaveCount(3);
    await expect(page.locator('[data-field-creature-art] svg')).toHaveCount(3);
    await expect(page.locator('[data-field-creature-art] .gm-float')).toHaveCount(3);
    await expect(page.locator('.field-creature__name')).toHaveCount(0);
    await expect(page.locator('[data-field-status]')).toContainText('フィールドの 清潔度');
    await expect(page.locator('[data-clean-field]')).toHaveCount(0);

    const first = page.locator('[data-field-creature]').first();
    const label = await first.getAttribute('aria-label');
    expect(label).toContain('を なでる');
    const isMobile = testInfo.project.name === 'mobile';
    const beforeTap = isMobile ? await first.boundingBox() : null;
    if (isMobile) {
      const tapStyle = await first.evaluate((el) => {
        const scene = el.closest('.field-scene');
        const fieldPage = el.closest('.field-page');
        const style = getComputedStyle(el);
        const sceneStyle = scene ? getComputedStyle(scene) : null;
        const fieldPageStyle = fieldPage ? getComputedStyle(fieldPage) : null;
        return {
          userSelect: style.userSelect,
          sceneUserSelect: sceneStyle?.userSelect,
          fieldPageUserSelect: fieldPageStyle?.userSelect,
          fieldPageTouchAction: fieldPageStyle?.touchAction,
          touchAction: style.touchAction,
          tapHighlight: style.webkitTapHighlightColor,
        };
      });
      expect(tapStyle).toMatchObject({
        userSelect: 'none',
        sceneUserSelect: 'none',
        fieldPageUserSelect: 'none',
        fieldPageTouchAction: 'manipulation',
        touchAction: 'manipulation',
        tapHighlight: 'rgba(0, 0, 0, 0)',
      });
    }
    await first.click();
    if (isMobile) {
      await page.waitForTimeout(300);
      const afterTap = await first.boundingBox();
      expect(afterTap).not.toBeNull();
      expect(Math.abs((afterTap?.width ?? 0) - (beforeTap?.width ?? 0))).toBeLessThan(1);
    }
    await expect(page.locator('[data-field-inspector]')).toContainText('育成室で 世話する');
    await expect(page.locator('[data-field-status]')).not.toContainText('次の 排泄まで');

    await page.locator('[data-field-edit]').click();
    await expect(page.locator('[data-field-editor]')).toBeVisible();
    await expect(page.locator('[data-field-slot]')).toHaveCount(12);

    // 個体の背後にある排泄物でも、透明なタップ層から 1 回で掃除できる。
    // 見た目の層を前へ出すだけだと顔を隠すため、両方を同時に回帰確認する。
    await page.goto('/sheet.html?n=1');
    await page.evaluate(() => {
      const raw = localStorage.getItem('genomon.save.v1');
      if (!raw) throw new Error('save missing');
      const envelope = JSON.parse(raw);
      const creatureId = envelope.state.creatures[0].id;
      envelope.state.field.droppings = [{
        id: 'e2e-overlapped-drop', creatureId, x: 50, y: 70, createdAt: Date.now(),
      }];
      localStorage.setItem('genomon.save.v1', JSON.stringify(envelope));
    });
    await page.goto('/#/field');
    await page.waitForSelector('[data-field-dropping="e2e-overlapped-drop"]');
    await page.evaluate(() => {
      const creature = document.querySelector<HTMLElement>('[data-field-creature]');
      const hit = document.querySelector<HTMLElement>('[data-field-dropping="e2e-overlapped-drop"]');
      const art = document.querySelector<HTMLElement>('[data-field-dropping-art="e2e-overlapped-drop"]');
      if (!creature || !hit || !art) throw new Error('field fixtures missing');
      hit.style.left = art.style.left = creature.style.left;
      hit.style.top = art.style.top = creature.style.top;
    });
    await page.locator('[data-field-dropping="e2e-overlapped-drop"]').click();
    await expect(page.locator('[data-field-dropping-art="e2e-overlapped-drop"]')).toHaveCount(0);
    await expect(page.locator('.sparkle')).not.toHaveCount(0);
  });
});
