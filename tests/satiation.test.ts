/**
 * 「連打しても速くならない」を数式レベルで固定する。
 *
 * 【なぜ専用テストが要るのか】
 *   育成室の画面には「連打しても 早くは なりません。『効き目』が もどってから
 *   押すと よく 育ちます。」と**断定形で**書かれている。ところが
 *   `SATIATION.minFactor` が 0 より大きいと、この文が**数学的に偽**になる。
 *
 *       効果倍率 f(t) = minFactor + (1 - minFactor) × min(t / fullMs, 1)
 *       1 秒あたりの効率 rate(t) = f(t) / t
 *                                = minFactor / t + (1 - minFactor) / fullMs
 *
 *   第 1 項は t が小さいほど大きい。つまり minFactor > 0 なら**押す間隔を
 *   詰めるほど 1 秒あたり得**になり、連打が最適戦略になる。
 *   旧値 0.05 では連打（2秒間隔）が「がまん」（18秒間隔）の 1.40 倍速く、
 *   ゲームプレイ批評の実プレイ計測でも 1.7 倍という結果が出ていた。
 *
 *   この欠陥は既存のどのテストにも引っかからなかった。倍率そのものは
 *   仕様どおりに動いており、「1 秒あたりに直すと逆転する」という
 *   二階の性質を誰も見ていなかったため。ここで固定する。
 */

import { describe, it, expect } from 'vitest';
import { SATIATION, careEffectMultiplier } from '../src/game/config.ts';
import type { CareAction } from '../src/core/types.ts';

/** 間隔 t（ミリ秒）で同じ世話を繰り返したときの「1 秒あたりの効果」。 */
function ratePerSecond(action: CareAction, intervalMs: number): number {
  // 直前に同じ世話をした状態から intervalMs 後に押す
  const last: Record<string, number> = { [action]: 0 };
  const mult = careEffectMultiplier(last, action, intervalMs);
  return mult / (intervalMs / 1000);
}

/**
 * 5 種を巡回しながら間隔 t で押し続けたときの「1 秒あたりの効果」。
 *
 * 【ウォームアップを捨てる理由】
 *   1 押し目だけは「直前の世話が無い」ので満足度 100% になる。
 *   この 1 回ぶんの得が総時間で割られるため、総時間の短い連打側が
 *   見かけ上だけ有利に出てしまう（2 秒巡回 0.0667 vs 18 秒巡回 0.0556 の正体）。
 *   定常状態の効率を比べたいので、助走ぶんを計測から除く。
 */
function rotationRatePerSecond(actions: CareAction[], intervalMs: number): number {
  const last: Record<string, number> = {};
  let now = 0;
  const warmup = actions.length * 2;
  const steps = 200;
  // 助走: 計測に入れずに状態を作る
  for (let i = 0; i < warmup; i++) {
    const a = actions[i % actions.length]!;
    last[a] = now;
    now += intervalMs;
  }
  const startedAt = now;
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const a = actions[i % actions.length]!;
    total += careEffectMultiplier(last, a, now);
    last[a] = now;
    now += intervalMs;
  }
  return total / ((now - startedAt) / 1000);
}

describe('連打が有利にならないこと', () => {
  it('minFactor は 0（0 より大きいと連打が数学的に有利になる）', () => {
    expect(SATIATION.minFactor).toBe(0);
  });

  it('同じ世話の連打は、待って押すより 1 秒あたり効率が良くならない', () => {
    const wait = ratePerSecond('feed', SATIATION.fullMs);
    const rows: string[] = [];
    for (const t of [500, 1000, 2000, 3000, 6000, 12000, 18000]) {
      const r = ratePerSecond('feed', t);
      rows.push(`${(t / 1000).toFixed(1)}秒間隔: ${r.toFixed(5)}/秒`);
      // 浮動小数の誤差ぶんだけ許容する
      expect(r, `${t}ms 間隔の効率が「待って押す」を上回っている`).toBeLessThanOrEqual(wait * 1.001);
    }
    // eslint-disable-next-line no-console
    console.log(`[満足度] 同一世話の連打:\n  ${rows.join('\n  ')}\n  → 待って押す(${(SATIATION.fullMs / 1000)}秒): ${wait.toFixed(5)}/秒`);
  });

  it('5 種を巡回する連打も、待って巡回するより効率が良くならない', () => {
    // プレイヤーが実際にやるのは「押せるボタンを片端から」なので、
    // 同一世話だけでなく巡回でも逆転しないことを確かめる。
    const acts: CareAction[] = ['feed', 'water', 'clean', 'pet', 'play'];
    const fast = rotationRatePerSecond(acts, 2000);
    const slow = rotationRatePerSecond(acts, SATIATION.fullMs);
    // eslint-disable-next-line no-console
    console.log(`[満足度] 巡回 2秒間隔=${fast.toFixed(5)}/秒 / ${(SATIATION.fullMs / 1000)}秒間隔=${slow.toFixed(5)}/秒`);
    expect(fast, '巡回連打のほうが 1 秒あたり効率が良い＝画面の説明が嘘になる').toBeLessThanOrEqual(slow * 1.001);
  });

  it('待って押すほうが、同じ効果を得るのに必要なクリック数が少ない', () => {
    const acts: CareAction[] = ['feed', 'water', 'clean', 'pet', 'play'];
    const count = (intervalMs: number): number => {
      const last: Record<string, number> = {};
      let now = 0;
      let total = 0;
      let clicks = 0;
      while (total < 100 && clicks < 5000) {
        const a = acts[clicks % acts.length]!;
        total += careEffectMultiplier(last, a, now) * 10;
        last[a] = now;
        now += intervalMs;
        clicks++;
      }
      return clicks;
    };
    const mash = count(2000);
    const wait = count(SATIATION.fullMs);
    // eslint-disable-next-line no-console
    console.log(`[満足度] 効果100 に必要なクリック数: 連打=${mash} / 待って押す=${wait}`);
    expect(wait, '待って押しても手数が減らないなら、待つ意味がない').toBeLessThan(mash);
  });
});
