import { test, expect, type Page } from '@playwright/test';

/**
 * Cards Lab 第 2 世代 —— 段（rarity）・認証印・裏返し。
 *
 * 【何を守るテストか】
 *   1. **既定の版面が Collector v2**。ここが戻ると研究の対象が変わる。
 *   2. **段ごとに素材が変わる**。文字色だけの実装に戻ったら、
 *      並べても格の差が読めない（§7）。
 *   3. **強制表示は見た目だけ**。遺伝データが動いていたら、
 *      Cards Lab で見た判断がすべて無意味になる（§19）。
 *   4. **裏面は Showcase だけ**。一覧 30 枚が二重の DOM を持ったら、
 *      「次から次にめくる」が成立しなくなる（§22）。
 *   5. **動きを減らす設定では 3D で回さない**（§11）。
 */

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 900;

async function openCards(page: Page): Promise<void> {
  await page.goto('/lab.html?tab=cards');
  await page.waitForSelector('#cards-showcase .holo-card', { timeout: 30_000 });
}

async function openFold(page: Page, id: string): Promise<void> {
  const d = page.locator(`#${id}`);
  if (!(await d.evaluate((x) => (x as HTMLDetailsElement).open))) {
    await d.locator('> summary').click();
  }
}

test.describe('Cards Lab v2 — 段（rarity）', () => {
  test('既定は Collector v2 で、表に格の 4 層が全部出ている', async ({ page }) => {
    await openCards(page);
    const card = page.locator('#cards-showcase .holo-card');
    await expect(card).toHaveAttribute('data-design', 'collectorV2');

    // 1. ランク名 2. 点数 3. 記号 4. 素材（帯の質感クラス）
    await expect(card.locator('.gmc-v-rankname')).toHaveCount(1);
    await expect(card.locator('.gmc-v-score')).toHaveCount(1);
    await expect(card.locator('.gmc-v-pips i')).toHaveCount(5);
    const bandClass = await card.locator('.gmc-v-band').getAttribute('class');
    expect(bandClass).toMatch(/gmc-v-band--\w+/);

    const score = (await card.locator('.gmc-v-score').textContent()) ?? '';
    expect(score).toMatch(/^\d+\.\d$/);
  });

  test('同一個体 × 5 段が並び、段ごとに素材そのものが違う', async ({ page }) => {
    await openCards(page);
    await openFold(page, 'cards-fold-rarity');
    const cards = page.locator('#cards-cmp-rarity .holo-card');
    await expect(cards).toHaveCount(5);

    const m = await cards.evaluateAll((els) =>
      els.map((e) => {
        const el = e as HTMLElement;
        const band = el.querySelector('.gmc-v-band') as HTMLElement | null;
        const seal = el.querySelector('.gmc-seal') as HTMLElement | null;
        return {
          rank: el.dataset.rank ?? '',
          seal: el.dataset.seal ?? '',
          effect: el.dataset.effect ?? '',
          bandClass: band?.className ?? '',
          bandBg: band ? getComputedStyle(band).backgroundImage : '',
          pips: el.querySelectorAll('.gmc-v-pips i.on').length,
          hasSeal: seal !== null,
          shine: Number(getComputedStyle(el.querySelector('.holo-card__shine')!).opacity),
        };
      }),
    );

    // 5 段が全部そろい、重複しない
    expect(new Set(m.map((x) => x.rank)).size).toBe(5);
    // 認証印の素材が段ごとに違う（インク → 箔 → ホロ箔）
    expect(new Set(m.map((x) => x.seal)).size).toBe(5);
    // 帯の質感クラスも段ごとに違う（色替えではない）
    expect(new Set(m.map((x) => x.bandClass)).size).toBe(5);
    // 記号は 1..5 で増える
    expect(m.map((x) => x.pips)).toEqual([1, 2, 3, 4, 5]);
    // どの段にも認証印がある
    for (const x of m) expect(x.hasSeal, x.rank).toBe(true);
    // 箔の量は段が上がるほど増え、STANDARD は光らない
    expect(m[0]!.shine).toBeLessThan(0.02);
    for (let i = 1; i < m.length; i++) {
      expect(m[i]!.shine, m[i]!.rank).toBeGreaterThan(m[i - 1]!.shine);
    }
  });

  test('MYTHIC の認証印だけがホログラム、STANDARD はホロなしのインク', async ({ page }) => {
    await openCards(page);
    await openFold(page, 'cards-fold-rarity');

    const m = await page.locator('#cards-cmp-rarity .holo-card').evaluateAll((els) =>
      els.map((e) => {
        const el = e as HTMLElement;
        const seal = el.querySelector('.gmc-seal') as HTMLElement;
        const shine = seal.querySelector('.gmc-seal-shine');
        return {
          rank: el.dataset.rank ?? '',
          material: seal.dataset.seal ?? '',
          hasShine: shine !== null,
          shineBg: shine ? getComputedStyle(shine).backgroundImage : '',
        };
      }),
    );
    const byRank = Object.fromEntries(m.map((x) => [x.rank, x]));

    expect(byRank.standard!.material).toBe('ink');
    expect(byRank.standard!.hasShine).toBe(false);

    expect(byRank.mythic!.material).toBe('holo');
    expect(byRank.mythic!.hasShine).toBe(true);
    expect(byRank.mythic!.shineBg).toContain('conic-gradient');

    // 金・銀は方向のある艶（分光ではない）
    expect(byRank.rare!.shineBg).toContain('linear-gradient');
    expect(byRank.exceptional!.shineBg).toContain('linear-gradient');
  });

  /**
   * 【§19 — 強制は視覚オーバーライドでしかない】
   *   段を変えても、描かれるゲノモンの SVG が 1 文字も変わらないこと。
   *   ここが動いたら「別の個体を見て判断した」ことになる。
   */
  test('段を強制しても、遺伝データも描かれる姿も変わらない', async ({ page }) => {
    await openCards(page);
    const artOf = (): Promise<string> =>
      page.locator('#cards-showcase .gmc-art-inner').innerHTML();
    const seedOf = (): Promise<string | null> =>
      page.locator('#cards-showcase .holo-card').getAttribute('data-seed');

    await openFold(page, 'cards-fold-settings');
    const art0 = await artOf();
    const seed0 = await seedOf();

    for (const rank of ['standard', 'mythic', 'rare', 'auto']) {
      await page.locator(`[data-set="rarity=${rank}"]`).click();
      await page.waitForTimeout(220);
      expect(await seedOf(), rank).toBe(seed0);
      expect(await artOf(), rank).toBe(art0);
    }
  });

  test('強制中は、実データの希少度も説明文に併記される', async ({ page }) => {
    await openCards(page);
    await openFold(page, 'cards-fold-settings');
    await page.locator('[data-set="rarity=mythic"]').click();
    await page.waitForTimeout(250);
    const cap = (await page.locator('#cards-caption').textContent()) ?? '';
    expect(cap).toContain('強制');
    expect(cap).toContain('実データ');
  });
});

test.describe('Cards Lab v2 — 裏返し', () => {
  test('クリックで裏返り、裏に鑑定書が出る', async ({ page }) => {
    await openCards(page);
    const flip = page.locator('#cards-showcase .gmc-flip');
    await expect(flip).toHaveAttribute('data-face', 'front');
    // 裏面は「初めて裏返した瞬間」まで作られない（§22）。
    await expect(page.locator('#cards-showcase .gmc--back')).toHaveCount(0);

    await page.locator('#cards-showcase .gmc-flip-inner').click();
    await expect(flip).toHaveAttribute('data-face', 'back');
    await expect(page.locator('#cards-showcase .gmc--back')).toHaveCount(1);
    await expect(page.locator('#cards-showcase .gmc-flip-inner')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const back = page.locator('#cards-showcase .gmc--back');
    for (const key of ['IDENTIFICATION', 'RARITY', 'GENETIC SUMMARY', 'NOTABLE GENES', 'PEDIGREE']) {
      await expect(back).toContainText(key);
    }
    // 裏にも認証印がある
    await expect(back.locator('.gmc-b-seal')).toHaveCount(1);

    await page.locator('#cards-showcase .gmc-flip-inner').click();
    await expect(flip).toHaveAttribute('data-face', 'front');
  });

  test('キーボードでも裏返せる', async ({ page }) => {
    await openCards(page);
    await page.locator('#cards-showcase .gmc-flip-inner').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cards-showcase .gmc-flip')).toHaveAttribute('data-face', 'back');
    await page.keyboard.press('Space');
    await expect(page.locator('#cards-showcase .gmc-flip')).toHaveAttribute('data-face', 'front');
  });

  test('裏面の文字が枠からはみ出さない', async ({ page }) => {
    await openCards(page);
    await page.locator('#cards-showcase .gmc-flip-inner').click();
    await page.waitForSelector('#cards-showcase .gmc--back', { timeout: 10_000 });
    await page.waitForTimeout(700);

    const over = await page.evaluate(() => {
      const back = document.querySelector('#cards-showcase .gmc--back')!;
      const bb = back.getBoundingClientRect();
      const bad: string[] = [];
      for (const el of back.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        // 横だけ見る（縦は書類の中でスクロールする作り）
        if (b.right > bb.right + 1 || b.left < bb.left - 1) {
          bad.push(String((el as HTMLElement).className || el.tagName));
        }
      }
      return bad.slice(0, 5);
    });
    expect(over).toEqual([]);
  });

  /**
   * 【§22 — 一覧に重い裏面 DOM を作らない】
   *   30 枚の一覧が表裏 2 枚ずつ持ったら、めくるたびに 60 枚を作ることになる。
   */
  test('比較と一覧には裏面も裏返しの器も作らない', async ({ page }) => {
    await openCards(page);
    for (const id of ['cards-fold-rarity', 'cards-fold-finish', 'cards-fold-design', 'cards-fold-gallery']) {
      await openFold(page, id);
    }
    await page.waitForSelector('#cards-gallery .holo-card', { timeout: 30_000 });

    for (const sel of ['#cards-cmp-rarity', '#cards-cmp-finish', '#cards-cmp-design', '#cards-gallery']) {
      await expect(page.locator(`${sel} .gmc--back`), sel).toHaveCount(0);
      await expect(page.locator(`${sel} .gmc-flip`), sel).toHaveCount(0);
    }
    // 一覧は認証印も持たない（150px では潰れるので間引いてある）
    const sealVisible = await page.evaluate(() => {
      const s = document.querySelector('#cards-gallery .gmc-v-seal');
      return s ? getComputedStyle(s).display !== 'none' : false;
    });
    expect(sealVisible).toBe(false);
  });

  test('スマホではデッキバーの「面」で裏返せる', async ({ page }) => {
    test.skip(!isMobile(page), 'スマホ幅専用の検証');
    await openCards(page);
    await page.locator('[data-act="flip"]:visible').first().click();
    await expect(page.locator('#cards-showcase .gmc-flip')).toHaveAttribute('data-face', 'back');
    await expect(page.locator('#cards-deck-face')).toHaveText('裏');
  });
});

test.describe('Cards Lab v2 — 動きを減らす設定', () => {
  /**
   * 【`test.use({ reducedMotion })` に頼らない】
   *   プロジェクト側の `devices[...]` と合成された結果、この describe では
   *   reduce が効かず、**3D 回転したまま「回していない」ことになって**
   *   テストが通ってしまう危険があった（実際にここで嘘の緑を踏みかけた）。
   *   ページごとに明示的にエミュレートする。
   */
  test('3D で回さず、面の入れ替えだけで裏返る', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCards(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await page.locator('#cards-showcase .gmc-flip-inner').click();
    await page.waitForSelector('#cards-showcase .gmc--back', { timeout: 10_000 });
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const inner = document.querySelector('#cards-showcase .gmc-flip-inner')!;
      const front = document.querySelector('#cards-showcase .gmc-flip-face--front')!;
      return {
        innerTransform: getComputedStyle(inner).transform,
        frontVisibility: getComputedStyle(front).visibility,
        face: (document.querySelector('#cards-showcase .gmc-flip') as HTMLElement).dataset.face,
      };
    });
    expect(m.face).toBe('back');
    // rotateY を掛けない（matrix3d が出ない）
    expect(m.innerTransform === 'none' || !m.innerTransform.includes('matrix3d')).toBe(true);
    expect(m.frontVisibility).toBe('hidden');
  });
});
