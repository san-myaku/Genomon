import type { Page } from '@playwright/test';

/**
 * E2E 共通ヘルパ。
 *
 * 【重要】セーブの消しかた
 *   アプリは離脱時（unload）に自分の状態を保存する。そのため
 *   「localStorage.clear() → reload」では、離脱の瞬間に古い状態が書き戻され、
 *   まっさらな状態にならない（リードが実機検証中に踏んだ落とし穴）。
 *   アプリを持たないページ（sheet.html）へ移動してから消すこと。
 */
export async function freshStart(page: Page): Promise<void> {
  await page.goto('/sheet.html?n=1');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('[data-act="start"]', { timeout: 15_000 });
}

/** ゲーム状態を localStorage から読む（アサーション用）。 */
export async function readSave(page: Page): Promise<any | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('genomon.save.v1');
    if (!raw) return null;
    try {
      return JSON.parse(raw).state;
    } catch {
      return null;
    }
  });
}

/**
 * 世話を 1 巡ぶん行う。
 *
 * 世話には全体クールダウン（2 秒）があり、さらに `SATIATION` により
 * 直前の世話からの経過時間に比例して効果が入る。連打しても速くならないので、
 * 実際のプレイと同じく間隔を空けて巡回する。
 */
export async function careRound(page: Page, gapMs = 2300): Promise<number> {
  const btns = page.locator('[data-care]');
  const n = await btns.count();
  let done = 0;
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    if (await b.isDisabled().catch(() => true)) continue;
    await b.click({ timeout: 5000 }).catch(() => {});
    done++;
    await page.waitForTimeout(gapMs);
  }
  return done;
}

/** 横方向にはみ出していないか。指示書 §25「スマートフォンで横方向にはみ出さない」 */
export async function horizontalOverflow(page: Page): Promise<{ scrollW: number; clientW: number; over: boolean }> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth, over: d.scrollWidth > d.clientWidth + 1 };
  });
}

/**
 * 画面に出ているゲノモンの SVG を、インスタンス固有 id を潰して正規化した文字列で返す。
 *
 * `id="..."` や `url(#...)` は描画のたびに変わるので、そこを伏せないと
 * 「同じ個体か」を比較できない。seed 再現性の検証に使う。
 */
export async function creatureSvgFingerprint(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('#app svg');
    if (!el) return null;
    return el.outerHTML.replace(/(id="|url\(#|href="#|xlink:href="#)[^")]*/g, '$1UID');
  });
}
