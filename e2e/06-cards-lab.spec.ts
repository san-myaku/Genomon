import { test, expect, type Page } from '@playwright/test';

/**
 * Cards Lab（開発ツールの第 3 タブ）の通し確認。
 *
 * 【何を守るテストか】
 *   1. `lab.html?tab=cards` で直接開ける（Cards Lab は動的 import なので、
 *      読み込みに失敗しても画面が白くならず気づけるようにする）。
 *   2. Showcase・Finish 比較・Design 比較・個体一覧が全部出る。
 *   3. **仕上げの違いがカードに反映されている**。ここは一度壊した箇所で、
 *      比較の 6 枚が 6 枚とも同じ絵に見えていた（静止時に箔が出ない設定だった）。
 *      data-effect と静止時の --card-opacity の両方を見る。
 *   4. **スマホで、カードがデッキバーに隠れず 1 枚まるごと見える。**
 *      ここも一度壊した箇所で、カードの下端が 29px 隠れていた。
 *   5. スマホの「つぎのカード」で次々にめくれ、「戻る」で戻れる。
 *   6. PC でもスマホ幅でも横スクロールしない。
 */

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 900;

const openCards = async (page: Page): Promise<string[]> => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/lab.html?tab=cards');
  await page.waitForSelector('#cards-showcase .holo-card', { timeout: 30_000 });
  return errors;
};

/**
 * 比較と一覧は狭い画面では畳んであり、**開くまで作られない**。
 * 中身を見るテストは、まず開く。
 */
const openFolds = async (page: Page): Promise<void> => {
  for (const id of [
    'cards-fold-rarity', 'cards-fold-finish', 'cards-fold-design',
    'cards-fold-gallery', 'cards-fold-settings',
  ]) {
    const details = page.locator(`#${id}`);
    if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) {
      await details.locator('> summary').click();
    }
  }
  await expect(page.locator('#cards-cmp-finish .holo-card').first()).toBeVisible();
};

test.describe('Cards Lab', () => {
  test('?tab=cards で直接開き、Showcase と 3 種類の比較がすべて出る', async ({ page }) => {
    const errors = await openCards(page);
    await expect(page.locator('#cards-showcase .holo-card')).toHaveCount(1);

    // 狭い画面では畳まれているので、開くまで作られていないこと自体も確かめる。
    if (isMobile(page)) {
      await expect(page.locator('#cards-cmp-finish .holo-card')).toHaveCount(0);
      await expect(page.locator('#cards-gallery .holo-card')).toHaveCount(0);
    }

    await openFolds(page);
    await expect(page.locator('#cards-cmp-rarity .holo-card')).toHaveCount(5);
    await expect(page.locator('#cards-cmp-finish .holo-card')).toHaveCount(6);
    // Collector v2 / Certified / Natural History / 旧 Collector の 4 案
    await expect(page.locator('#cards-cmp-design .holo-card')).toHaveCount(4);
    expect(await page.locator('#cards-gallery .holo-card').count()).toBeGreaterThanOrEqual(8);

    // カード比（63:88）が保たれている
    const box = await page.locator('#cards-showcase .holo-card').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(63 / 88, 2);

    expect(errors).toEqual([]);
  });

  test('Finish 比較は 6 種類とも別の箔で、静止状態でも箔が見えている', async ({ page }) => {
    await openCards(page);
    await openFolds(page);
    const cards = page.locator('#cards-cmp-finish .holo-card');

    const effects = await cards.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.effect ?? ''),
    );
    expect(new Set(effects).size).toBe(effects.length);

    // Standard 以外は、触っていなくても箔の層が見えていること。
    const opacities = await cards.evaluateAll((els) =>
      els.map((e) => Number(getComputedStyle(e.querySelector('.holo-card__shine')!).opacity)),
    );
    expect(opacities[0]).toBeDefined();
    for (const o of opacities.slice(1)) expect(o).toBeGreaterThan(0.05);
  });

  test('Design を切り替えると Showcase のカードが差し替わる', async ({ page }) => {
    await openCards(page);
    await openFolds(page);
    const card = page.locator('#cards-showcase .holo-card');
    // 既定は Collector v2（§4）。
    await expect(card).toHaveAttribute('data-design', 'collectorV2');

    await page.locator('[data-set="design=certified"]').click();
    await expect(page.locator('#cards-showcase .holo-card')).toHaveAttribute('data-design', 'certified');
    await expect(page.locator('#cards-cmp-finish .holo-card').first()).toHaveAttribute(
      'data-design',
      'certified',
    );
  });

  test('ゲノモンの SVG がカードの中に実際に描かれている', async ({ page }) => {
    await openCards(page);
    const svg = page.locator('#cards-showcase .gmc-art-inner svg.gm-svg');
    await expect(svg).toHaveCount(1);
    const seed = await svg.getAttribute('data-seed');
    expect(seed).toBeTruthy();
  });

  /**
   * 【scrollWidth では足りない】
   *   `body { overflow-x: hidden }` が効いているので、中身が画面より広くても
   *   `scrollWidth === clientWidth` になる。実際、`.cards-right` の暗黙カラムが
   *   max-content で 380px に固定され、320px の画面では右側が切れていたのに
   *   この検査は通っていた。要素の矩形そのものを見る。
   */
  test('どの幅でも、要素が画面からはみ出さない', async ({ page }) => {
    await openCards(page);
    for (const width of [320, 360, 393, 768]) {
      await page.setViewportSize({ width, height: 780 });
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const bad: string[] = [];
        for (const el of document.querySelectorAll('#lab-panel-cards *')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          // 横スクロールさせる帯（比較・一覧）の中身は対象外
          if (el.closest('.cards-strip, .cards-gallery')) continue;
          if (b.right > vw + 1 || b.left < -1) bad.push(String(el.className || el.tagName));
        }
        return bad.slice(0, 5);
      });
      expect(over, `viewport ${width}px`).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      ).toBe(true);
    }
  });

  test('スマホ幅でタップ対象が小さすぎない', async ({ page }) => {
    await openCards(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => {
      document.querySelectorAll('details.cards-fold').forEach((d) => {
        (d as HTMLDetailsElement).open = true;
      });
    });
    await page.waitForTimeout(600);

    const small = await page.evaluate(() => {
      const bad: { tag: string; h: number; txt: string }[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        '#lab-panel-cards button, #lab-panel-cards select, #lab-panel-cards summary, #lab-panel-cards input',
      )) {
        if (el instanceof HTMLInputElement && el.type === 'range') continue;
        // チェックボックスはラベル全体が押せればよい
        const target =
          el instanceof HTMLInputElement && el.type === 'checkbox' ? (el.closest('label') ?? el) : el;
        const b = target.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.height < 38) bad.push({ tag: el.tagName, h: Math.round(b.height), txt: (target.textContent ?? '').trim().slice(0, 16) });
      }
      return bad.slice(0, 6);
    });
    expect(small).toEqual([]);
  });

  test('Visual Lab の設定キーを Cards Lab が書き換えない', async ({ page }) => {
    await page.goto('/lab.html');
    await page.waitForSelector('#lab-single', { timeout: 30_000 });
    const before = await page.evaluate(() => localStorage.getItem('genomon.dev.prefs.v1'));

    await page.locator('[data-tab="cards"]').click();
    await page.waitForSelector('#cards-showcase .holo-card', { timeout: 30_000 });
    await openFolds(page);
    await page.locator('[data-set="grade=10"]').click();
    await page.locator('[data-set="design=natural"]').click();

    const after = await page.evaluate(() => localStorage.getItem('genomon.dev.prefs.v1'));
    expect(after).toBe(before);
    const cardPrefs = await page.evaluate(() => localStorage.getItem('genomon.dev.cardprefs.v1'));
    expect(cardPrefs).toContain('natural');
  });
});

/**
 * 【セレクタをデッキバーへ限定している理由】
 *   同じ `data-act` の操作は PC 側（カード直下の `.cards-deal`）にもある。
 *   ここはスマホの固定デッキバーそのものを見るテストなので、
 *   `.cards-deck` の中へ限定する（限定しないと 2 件に当たって落ちる）。
 */
test.describe('Cards Lab — スマホでの持ちかた', () => {
  test('カードが最初に見え、デッキバーに隠れない', async ({ page }) => {
    test.skip(!isMobile(page), 'スマホ幅専用の検証');
    await openCards(page);

    const m = await page.evaluate(() => {
      const card = document.querySelector('#cards-showcase .holo-card')!.getBoundingClientRect();
      const deck = document.querySelector('.cards-deck')!.getBoundingClientRect();
      const cap = document.querySelector('#cards-caption')!.getBoundingClientRect();
      return {
        cardTop: card.top,
        cardBottom: card.bottom,
        capBottom: cap.bottom,
        deckTop: deck.top,
        deckDisplay: getComputedStyle(document.querySelector('.cards-deck')!).display,
        vh: window.innerHeight,
      };
    });

    // 1 枚まるごと、スクロールせずに見えること。
    expect(m.cardTop).toBeGreaterThanOrEqual(0);
    expect(m.cardBottom).toBeLessThanOrEqual(m.deckTop);
    // 説明文もデッキバーの裏に潜らないこと。
    expect(m.capBottom).toBeLessThanOrEqual(m.deckTop + 1);
    expect(m.deckDisplay).toBe('flex');
  });

  test('「つぎのカード」で次々めくれ、「戻る」で戻れる', async ({ page }) => {
    test.skip(!isMobile(page), 'スマホ幅専用の検証');
    await openCards(page);

    const seedOf = (): Promise<string | null> =>
      page.locator('#cards-showcase .holo-card').getAttribute('data-seed');

    const first = await seedOf();
    const seen = new Set<string>([first ?? '']);
    for (let i = 0; i < 4; i++) {
      await page.locator('.cards-deck [data-act="next"]').click();
      await expect(page.locator('#cards-showcase .holo-card')).not.toHaveAttribute(
        'data-seed',
        [...seen][seen.size - 1] ?? '',
      );
      seen.add((await seedOf()) ?? '');
    }
    // 4 回めくって 4 体とも別の個体になっている
    expect(seen.size).toBe(5);

    const last = await seedOf();
    await page.locator('.cards-deck [data-act="prev"]').click();
    await expect(page.locator('#cards-showcase .holo-card')).not.toHaveAttribute('data-seed', last ?? '');
    // 履歴の位置が説明文に出る
    await expect(page.locator('.cards-count')).toContainText('/5');
  });

  test('デッキバーの「版面」「箔」で 1 タップずつ切り替わる', async ({ page }) => {
    test.skip(!isMobile(page), 'スマホ幅専用の検証');
    await openCards(page);
    const card = page.locator('#cards-showcase .holo-card');

    const design0 = await card.getAttribute('data-design');
    await page.locator('[data-act="cycle-design"]').click();
    await expect(page.locator('#cards-showcase .holo-card')).not.toHaveAttribute(
      'data-design',
      design0 ?? '',
    );

    const finish0 = await page.locator('#cards-showcase .holo-card').getAttribute('data-finish');
    await page.locator('[data-act="cycle-finish"]').click();
    await expect(page.locator('#cards-showcase .holo-card')).not.toHaveAttribute(
      'data-finish',
      finish0 ?? '',
    );
  });

  test('左右スワイプでカードがめくれる', async ({ page }) => {
    test.skip(!isMobile(page), 'スマホ幅専用の検証');
    await openCards(page);
    const before = await page.locator('#cards-showcase .holo-card').getAttribute('data-seed');

    const box = (await page.locator('#cards-stage').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.dispatchEvent('#cards-stage', 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: box.x + box.width - 24,
      clientY: y,
      isPrimary: true,
    });
    await page.evaluate(
      ({ x, y: cy }) => {
        window.dispatchEvent(
          new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true }),
        );
      },
      { x: box.x + 24, y },
    );

    await expect(page.locator('#cards-showcase .holo-card')).not.toHaveAttribute('data-seed', before ?? '');
  });

  test('狭い画面でもデッキバーが 1 段に潰れず、主役が押せる幅を保つ', async ({ page }) => {
    test.skip(!isMobile(page), 'スマホ幅専用の検証');
    await openCards(page);
    for (const width of [320, 360, 393]) {
      await page.setViewportSize({ width, height: 720 });
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const main = document.querySelector('.cards-deck-main')!.getBoundingClientRect();
        const card = document.querySelector('#cards-showcase .holo-card')!.getBoundingClientRect();
        const deck = document.querySelector('.cards-deck')!.getBoundingClientRect();
        return { mainW: main.width, mainH: main.height, cardBottom: card.bottom, deckTop: deck.top };
      });
      // 「つぎのカード」が 1 行に収まる幅（折り返すと 2 行になり高さが伸びる）
      expect(m.mainH, `viewport ${width}px`).toBeLessThan(60);
      expect(m.mainW, `viewport ${width}px`).toBeGreaterThanOrEqual(100);
      // カードはデッキバーに隠れない
      expect(m.cardBottom, `viewport ${width}px`).toBeLessThanOrEqual(m.deckTop);
    }
  });

  test('デッキバーは PC 幅では出ない', async ({ page }) => {
    test.skip(isMobile(page), 'PC 幅専用の検証');
    await openCards(page);
    await expect(page.locator('.cards-deck')).toBeHidden();
    // PC では畳まずに全部見せる
    await expect(page.locator('#cards-fold-finish')).toHaveAttribute('open', '');
    await expect(page.locator('#cards-fold-settings')).toHaveAttribute('open', '');
  });
});
