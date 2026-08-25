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

    // 【格は 1 か所にまとまっていること（§11）】
    //   名前・点数・記号が右上のひとつの塊に入り、素材もその塊が背負う。
    const cluster = card.locator('.gmc-v-rank');
    await expect(cluster).toHaveCount(1);
    await expect(cluster.locator('.gmc-v-rankname')).toHaveCount(1);
    await expect(cluster.locator('.gmc-v-score')).toHaveCount(1);
    await expect(cluster.locator('.gmc-v-pips i')).toHaveCount(5);
    expect(await cluster.getAttribute('class')).toMatch(/gmc-v-rank--\w+/);

    // 同じ希少度を他の場所へ重複表示していないこと。
    await expect(card.locator('.gmc-v-rankname')).toHaveCount(1);
    await expect(card.locator('.gmc-v-score')).toHaveCount(1);

    // 右上にあること（カードの右半分・上 1/4）。
    const pos = await page.evaluate(() => {
      const c = document.querySelector('#cards-showcase .holo-card')!.getBoundingClientRect();
      const r = document.querySelector('#cards-showcase .gmc-v-rank')!.getBoundingClientRect();
      return { cx: (r.left + r.width / 2 - c.left) / c.width, cy: (r.top + r.height / 2 - c.top) / c.height };
    });
    expect(pos.cx).toBeGreaterThan(0.55);
    expect(pos.cy).toBeLessThan(0.25);

    const score = (await cluster.locator('.gmc-v-score').textContent()) ?? '';
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
        const band = el.querySelector('.gmc-v-rank') as HTMLElement | null;
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

test.describe('Cards Lab v2 — 認証印とフレーバー', () => {
  /**
   * 【印は「あとから人が押した」ように見えること（§7〜§9）】
   *   小さくきれいに収まっていると装飾アイコンに見える。
   *   大きさ・重なり・個体ごとの揺らぎを機械的に守る。
   */
  test('印はカード幅の 3 割ほどあり、絵と情報欄の両方に重なる', async ({ page }) => {
    await openCards(page);
    const m = await page.evaluate(() => {
      const card = document.querySelector('#cards-showcase .holo-card')!.getBoundingClientRect();
      const seal = document.querySelector('#cards-showcase .gmc-v-seal .gmc-seal')!.getBoundingClientRect();
      const info = document.querySelector('#cards-showcase .gmc-v-info')!.getBoundingClientRect();
      const art = document.querySelector('#cards-showcase .gmc-art')!.getBoundingClientRect();
      const hit = (a: DOMRect, b: DOMRect): boolean =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return {
        wRatio: seal.width / card.width,
        insideCard: seal.left >= card.left - 2 && seal.right <= card.right + 2,
        overInfo: hit(seal, info),
        overArt: hit(seal, art),
      };
    });
    // 旧版は 19.5%（情報欄の柱に収めていた）。§7 の「1.7〜2 倍」を満たす。
    expect(m.wRatio).toBeGreaterThan(0.3);
    expect(m.wRatio).toBeLessThan(0.42);
    // カードからはみ出して切れてはいけない。
    expect(m.insideCard).toBe(true);
    // 絵と情報欄の両方にまたがる（レイアウトされた UI に見せない・§8）。
    expect(m.overInfo).toBe(true);
    expect(m.overArt).toBe(true);
  });

  test('個体ごとに押されかたが変わり、同じ個体では変わらない', async ({ page }) => {
    await openCards(page);
    const readStamp = (): Promise<string> =>
      page.evaluate(() => {
        const s = document.querySelector('#cards-showcase .gmc-v-seal .gmc-seal') as HTMLElement;
        return ['--seal-rot', '--seal-x', '--seal-y', '--seal-scale', '--seal-op']
          .map((k) => s.style.getPropertyValue(k))
          .join('|');
      });

    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      seen.add(await readStamp());
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(180);
    }
    // 6 個体でせめて 4 通り以上（全部同じ角度・同じ場所に見えない）
    expect(seen.size).toBeGreaterThanOrEqual(4);

    // 同じ個体へ戻したら、まったく同じ押されかたに戻る
    const now = await readStamp();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(180);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(180);
    expect(await readStamp()).toBe(now);
  });

  /**
   * 【フレーバーは最後に読むもの（§14・§15）】
   *   左下・名前よりずっと小さい・枠も引用符も付けない。
   *   ただし「読めない」にはしないので、px の下限も見る。
   */
  test('フレーバーは左下で、名前よりずっと小さく、枠を持たない', async ({ page }) => {
    await openCards(page);
    const m = await page.evaluate(() => {
      const card = document.querySelector('#cards-showcase .gmc-card')!;
      const cb = card.getBoundingClientRect();
      const fl = card.querySelector('.gmc-flavor')!;
      const fb = fl.getBoundingClientRect();
      const span = card.querySelector('.gmc-flavor span')!;
      const cs = getComputedStyle(span);
      const box = getComputedStyle(fl);
      return {
        left: (fb.left - cb.left) / cb.width,
        bottom: (fb.bottom - cb.top) / cb.height,
        font: parseFloat(cs.fontSize),
        nameFont: parseFloat(getComputedStyle(card.querySelector('.gmc-v-name')!).fontSize),
        borderTop: box.borderTopWidth,
        borderLeft: box.borderLeftWidth,
        style: cs.fontStyle,
      };
    });
    expect(m.left).toBeLessThan(0.12);
    expect(m.bottom).toBeGreaterThan(0.86);
    // 名前よりはっきり小さいこと。
    expect(m.font).toBeLessThan(m.nameFont * 0.7);
    // 【比率で見るのは広い画面だけ】
    //   スマホはカードの実寸が 313px しかなく、px の下限（8px）が先に効く。
    //   そこで比率を求めると「下限を守ったこと」を失敗として数えてしまう。
    //   狭い画面は下限そのものを見る。
    if ((page.viewportSize()?.width ?? 1280) >= 900) {
      expect(m.font).toBeLessThan(m.nameFont * 0.5);
    }
    // どの幅でも読める下限は割らない。
    expect(m.font).toBeGreaterThanOrEqual(7.5);
    // 枠で囲って「欄」にしない（§15）。
    expect(m.borderTop).toBe('0px');
    expect(m.borderLeft).toBe('0px');
    expect(m.style).toBe('italic');
  });

  test('スマホでもフレーバーが 8px を割らない', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openCards(page);
    const font = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('#cards-showcase .gmc-flavor span')!).fontSize),
    );
    expect(font).toBeGreaterThanOrEqual(7.5);
  });
});

test.describe('Cards Lab v2 — 裏面の図表', () => {
  async function openBack(page: Page): Promise<void> {
    await openCards(page);
    await page.locator('#cards-showcase .gmc-flip-inner').click();
    await page.waitForSelector('#cards-showcase .gmc--back', { timeout: 10_000 });
    await page.waitForTimeout(500);
  }

  /**
   * 【図表は実データと一致すること】
   *   帯の長さや針の位置が、書いてある数字とずれていたら
   *   「図表がある鑑定書」ではなくただの飾りになる。
   */
  test('遺伝子構成の帯が、書いてある数と一致する', async ({ page }) => {
    await openBack(page);
    const m = await page.evaluate(() => {
      const back = document.querySelector('#cards-showcase .gmc--back')!;
      const bar = back.querySelector('.gmc-g-bar')!.getBoundingClientRect();
      const homo = back.querySelector('.gmc-g-homo')!.getBoundingClientRect();
      const het = back.querySelector('.gmc-g-het')!.getBoundingClientRect();
      return {
        barW: bar.width,
        homoW: homo.width,
        hetW: het.width,
        txt: back.querySelector('.gmc-g-legend')!.textContent ?? '',
        loci: back.querySelector('.gmc-b-substats')!.textContent ?? '',
      };
    });
    const num = (re: RegExp, s: string): number => Number(re.exec(s)?.[1]);
    const homo = num(/HOMO\s*(\d+)/, m.txt);
    const het = num(/HET\s*(\d+)/, m.txt);
    const total = num(/LOCI\s*(\d+)/, m.loci);
    expect(Number.isFinite(homo) && Number.isFinite(het) && Number.isFinite(total)).toBe(true);
    // ホモ＋ヘテロは全カテゴリ座に等しい
    expect(homo + het).toBe(total);
    // 帯の長さが割合と合っている
    expect(m.homoW / m.barW).toBeCloseTo(homo / total, 1);
    expect(m.hetW / m.barW).toBeCloseTo(het / total, 1);
  });

  test('希少度の針の位置が、書いてある「上位 x%」と一致する', async ({ page }) => {
    await openBack(page);
    const m = await page.evaluate(() => {
      const back = document.querySelector('#cards-showcase .gmc--back')!;
      const g = back.querySelector('.gmc-g-gauge')!.getBoundingClientRect();
      const pin = back.querySelector('.gmc-g-pin')!.getBoundingClientRect();
      return {
        pos: (pin.left + pin.width / 2 - g.left) / g.width,
        top: back.querySelector('.gmc-g-gauge-top b')!.textContent ?? '',
        inside: pin.left >= g.left - 8 && pin.right <= g.right + 8,
      };
    });
    const topPct = Number(/TOP\s*([\d.]+)%/.exec(m.top)?.[1]);
    expect(Number.isFinite(topPct)).toBe(true);
    // 針の位置 = 1 - 上位%
    expect(m.pos).toBeCloseTo(1 - topPct / 100, 1);
    // 針が枠から切れていない
    expect(m.inside).toBe(true);
  });

  test('数値形質の帯が 6 項目そろい、実データ由来である', async ({ page }) => {
    await openBack(page);
    const rows = await page.locator('#cards-showcase .gmc-g-trait').evaluateAll((els) =>
      els.map((e) => {
        const bar = e.querySelector('.gmc-g-tbar')!.getBoundingClientRect();
        const fill = e.querySelector('.gmc-g-tbar span')!.getBoundingClientRect();
        return {
          key: e.querySelector('b')!.textContent ?? '',
          value: Number((e.querySelector('em')!.textContent ?? '').replace(/[^\d.]/g, '')),
          ratio: fill.width / bar.width,
        };
      }),
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.ratio, r.key).toBeGreaterThanOrEqual(0);
      expect(r.ratio, r.key).toBeLessThanOrEqual(1.02);
      // SIZE だけ 0.8〜1.25 倍の実寸なので、正規化の基準が違う
      if (r.key !== 'SIZE') expect(r.ratio, r.key).toBeCloseTo(r.value, 1);
    }
    // 架空の固定値ではないこと（個体を変えれば値が変わる）
    const first = rows.map((r) => r.value).join(',');
    await page.locator('#cards-showcase .gmc-flip-inner').click();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.locator('#cards-showcase .gmc-flip-inner').click();
    await page.waitForSelector('#cards-showcase .gmc--back');
    await page.waitForTimeout(400);
    const second = await page.locator('#cards-showcase .gmc-g-trait em').allTextContents();
    expect(second.join(',')).not.toBe(first);
  });

  /**
   * 【裏も「同じカード」に見えること（§3）】
   *   明るい紙を貼らない。書類の面がカードの地とかけ離れて明るいと、
   *   めくった瞬間に別のカードになる。
   */
  test('書類の面が明るすぎない（別紙を貼ったように見えない）', async ({ page }) => {
    await openBack(page);
    const lum = await page.evaluate(() => {
      const doc = document.querySelector('#cards-showcase .gmc-b-doc')!;
      const cs = getComputedStyle(doc);
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(cs.backgroundImage + cs.backgroundColor);
      if (!m) return 1;
      return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
    });
    // 羊皮紙（0.85 前後）ではなく、暗い資料であること
    expect(lum).toBeLessThan(0.25);
  });

  test('一覧・比較には図表も裏面も作らない', async ({ page }) => {
    await openCards(page);
    for (const id of ['cards-fold-rarity', 'cards-fold-gallery']) await openFold(page, id);
    await page.waitForSelector('#cards-gallery .holo-card', { timeout: 30_000 });
    for (const sel of ['#cards-cmp-rarity', '#cards-gallery']) {
      await expect(page.locator(sel + ' .gmc-g-bar'), sel).toHaveCount(0);
      await expect(page.locator(sel + ' .gmc-g-gauge'), sel).toHaveCount(0);
      await expect(page.locator(sel + ' .gmc--back'), sel).toHaveCount(0);
    }
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
    for (const key of [
      'IDENTIFICATION', 'RARITY', 'GENETIC COMPOSITION', 'TRAIT PROFILE',
      'NOTABLE GENES', 'PEDIGREE',
    ]) {
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
    // 【一覧にも印は出す（今回の変更）】
    //   印が大きくなり 150px のカードでも 50px 前後になったので、
    //   段が一覧でも一目で読め、押されかたの揺らぎ（§20）も一覧で確認できる。
    //   ただし地紋と押しムラは省く（30 枚ぶんの turbulence は重い）。
    const gal = await page.evaluate(() => {
      const s = document.querySelector('#cards-gallery .gmc-v-seal');
      return {
        visible: s ? getComputedStyle(s).display !== 'none' : false,
        guilloche: document.querySelectorAll('#cards-gallery .gmc-seal-guilloche').length,
        // ライブラリ側も自前のノイズを持つので、**印の中**だけを数える。
        turbulence: document.querySelectorAll('#cards-gallery .gmc-seal filter').length,
      };
    });
    expect(gal.visible).toBe(true);
    expect(gal.guilloche).toBe(0);
    expect(gal.turbulence).toBe(0);
  });

  test('スマホではデッキバーの「面」で裏返せる', async ({ page }) => {
    test.skip(!isMobile(page), 'スマホ幅専用の検証');
    await openCards(page);
    await page.locator('[data-act="flip"]:visible').first().click();
    await expect(page.locator('#cards-showcase .gmc-flip')).toHaveAttribute('data-face', 'back');
    await expect(page.locator('#cards-deck-face')).toHaveText('裏');
  });
});

test.describe('Cards Lab v2 — PC でも次々にめくれる', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) < 900, 'PC 幅専用の検証');

  /**
   * 【PC の主動線はカードの真下】
   *   以前は「つぎのカード」が設定パネルの中にしか無く、めくるたびに
   *   カードから目を離して左端まで狙う必要があった。スマホのデッキバーと
   *   同じ並びを、固定バーではなくカードの直下へ置いてある。
   */
  test('カードの真下に「つぎのカード」と表裏があり、押すとめくれる', async ({ page }) => {
    await openCards(page);
    const deal = page.locator('.cards-deal');
    await expect(deal).toBeVisible();
    // スマホのデッキバーは PC では出ない（二重に置かない）
    await expect(page.locator('.cards-deck')).toBeHidden();

    const seedOf = (): Promise<string | null> =>
      page.locator('#cards-showcase .gmc-flip-face--front .holo-card').getAttribute('data-seed');

    const first = await seedOf();
    await deal.locator('[data-act="next"]').click();
    await expect
      .poll(seedOf, { message: 'つぎのカードで個体が変わる' })
      .not.toBe(first);

    const second = await seedOf();
    await deal.locator('[data-act="prev"]').click();
    await expect.poll(seedOf, { message: '戻るで前の個体へ' }).toBe(first);
    expect(second).not.toBe(first);
  });

  test('矢印キーでめくれ、F で裏返る', async ({ page }) => {
    await openCards(page);
    const seedOf = (): Promise<string | null> =>
      page.locator('#cards-showcase .gmc-flip-face--front .holo-card').getAttribute('data-seed');

    const first = await seedOf();
    await page.keyboard.press('ArrowRight');
    await expect.poll(seedOf).not.toBe(first);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(seedOf).toBe(first);

    await page.keyboard.press('f');
    await expect(page.locator('#cards-showcase .gmc-flip')).toHaveAttribute('data-face', 'back');
    await page.keyboard.press('f');
    await expect(page.locator('#cards-showcase .gmc-flip')).toHaveAttribute('data-face', 'front');
  });

  /**
   * 【文字入力を奪わない】
   *   seed を打っている最中に矢印キーを取ると、カーソルが動かせなくなる。
   */
  test('seed を入力しているあいだは矢印キーを奪わない', async ({ page }) => {
    await openCards(page);
    const fold = page.locator('#cards-fold-settings');
    if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open))) {
      await fold.locator('> summary').click();
    }
    const seedOf = (): Promise<string | null> =>
      page.locator('#cards-showcase .gmc-flip-face--front .holo-card').getAttribute('data-seed');

    const before = await seedOf();
    await page.locator('#cards-seed').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    expect(await seedOf()).toBe(before);
  });

  /**
   * 【連打しても重い所を作り直さない】
   *   PC は折りたたみが全部開いているので、1 枚めくるたびに 20 枚超を
   *   作り直していた。5 連打が 1500ms のはずのところ 2687ms かかっていた
   *   （実測）。手が止まってから追いつく形に変えてある。
   */
  test('連続でめくっても、比較の作り直しで詰まらない', async ({ page }) => {
    await openCards(page);
    await page.waitForTimeout(800);
    const elapsed = await page.evaluate(async () => {
      const btn = document.querySelector('.cards-deal [data-act="next"]') as HTMLElement;
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) {
        btn.click();
        await new Promise((r) => setTimeout(r, 300));
      }
      return performance.now() - t0;
    });
    // 理想は 1500ms。作り直しが毎回走ると 2600ms を超える。
    expect(elapsed).toBeLessThan(2100);
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
