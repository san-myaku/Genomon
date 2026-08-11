/**
 * ゲームプレイ層の性質テスト（ゲームプレイ担当）。
 *
 * 「動く」ではなく「設計どおりの性質を持っているか」を測る。
 *   - 展示会の採点が決定論的か
 *   - 派手な個体が常に勝たないか（装飾数と得点の相関）
 *   - 同じボタン連打より世話の巡回が得か
 *   - 性格で反応が変わるか
 *   - オフラインが上限で頭打ちになるか
 */

import { describe, expect, it } from 'vitest';

import {
  applyTick,
  canBreed,
  canExhibit,
  careAvailability,
  chooseEggs,
  creaturesByStage,
  doBreed,
  doCare,
  findCreature,
  getPhenotype,
  newGame,
  phenotypeCacheSize,
  rollEggChoices,
  runExhibition,
  TIMING,
} from '../src/game/index.ts';
import { createCreature } from '../src/game/state.ts';
import {
  beautyScore,
  careScore,
  characterScore,
  decorCount,
  healthScore,
  rarityScore,
} from '../src/game/exhibition.ts';
import { BREEDING, EXHIBITION } from '../src/game/config.ts';
import { PHENOTYPE_CACHE_LIMIT } from '../src/game/phenoCache.ts';
import { phenotypeOf, randomGenotype } from '../src/genetics/index.ts';
import type { CareAction, Creature, GameState, Genotype } from '../src/core/types.ts';

const T0 = 1_700_000_000_000;

/** 与えた遺伝子で成体を 1 体つくり、状態を固定する（遺伝の差だけを見るため）。 */
function pushAdult(state: GameState, genotype: Genotype, now: number): Creature {
  const c = createCreature(state, genotype, now, {
    parents: null,
    parentNames: null,
    generation: 1,
    fromBreeding: false,
  });
  c.life.stage = 'adult';
  c.life.growth = 100;
  c.life.hatchProgress = 100;
  c.life.hunger = 80;
  c.life.hydration = 80;
  c.life.cleanliness = 80;
  c.life.mood = 80;
  c.life.health = 90;
  c.life.careCount = 20;
  state.creatures.push(c);
  return c;
}

/** 幼体を 1 体つくる（世話のテスト用）。 */
function pushJuvenile(state: GameState, genotype: Genotype, now: number): Creature {
  const c = createCreature(state, genotype, now, {
    parents: null,
    parentNames: null,
    generation: 1,
    fromBreeding: false,
  });
  c.life.stage = 'juvenile';
  c.life.growth = 0;
  c.life.hatchProgress = 100;
  c.life.hunger = 50;
  c.life.hydration = 50;
  c.life.cleanliness = 50;
  c.life.mood = 50;
  c.life.health = 100;
  state.creatures.push(c);
  return c;
}

/** ピアソンの積率相関係数。 */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

const mean = (v: number[]): number => v.reduce((a, x) => a + x, 0) / v.length;

/** 平均・最小・最大・中央値。 */
function summarize(v: number[]): { mean: number; min: number; max: number; median: number } {
  const s = v.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return {
    mean: mean(v),
    min: s[0]!,
    max: s[s.length - 1]!,
    median: s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!,
  };
}

// ─────────────────────────────────────────────────────────
//  テスト 4: 採点の決定論
// ─────────────────────────────────────────────────────────

describe('展示会の採点', () => {
  it('同じ個体・同じ状態・同じ参加回数なら、いつ呼んでも同じ点数になる', () => {
    const base = newGame('exhibition-determinism');
    const c = pushAdult(base, randomGenotype('det-1'), T0);
    base.unlocks.exhibition = true;
    // 初回の下駄（firstTimeScoreFloor）を避けて、素の採点を比べる。
    base.stats.exhibitions = 3;

    const s1: GameState = structuredClone(base);
    const s2: GameState = structuredClone(base);

    const r1 = runExhibition(s1, c.id, T0);
    // 実時刻が違っても結果は変わらない（時刻は採点に混ぜていない）。
    const r2 = runExhibition(s2, c.id, T0 + 12_345_678);

    expect(r2).toEqual(r1);
    expect(s2.coins).toBe(s1.coins);

    // 参加回数が変わればゆらぎの seed が変わる（同じ点に固定されてはいない）。
    const s3: GameState = structuredClone(base);
    s3.creatures[0]!.exhibitionCount = 1;
    const r3 = runExhibition(s3, c.id, T0);

    // eslint-disable-next-line no-console
    console.log(
      `\n[展示会の決定論] 1回目 total=${r1.total} rank=${r1.rank} coins=${r1.coins} / ` +
        `同条件の再実行 total=${r2.total} / 参加回数だけ変えた場合 total=${r3.total}\n` +
        `  内訳: 美${r1.beauty} 健${r1.health} 個${r1.character} 希${r1.rarity} 育${r1.care}`,
    );
  });

  it('世話の差だけでランクが動く（プレイヤーの手入れが効く）', () => {
    const base = newGame('exhibition-care');
    const c = pushAdult(base, randomGenotype('care-1'), T0);
    base.unlocks.exhibition = true;
    base.stats.exhibitions = 3;

    const cared: GameState = structuredClone(base);
    const cw = cared.creatures[0]!.life;
    cw.mood = 100;
    cw.cleanliness = 100;
    cw.hunger = 100;
    cw.hydration = 100;
    cw.health = 100;

    const neglected: GameState = structuredClone(base);
    const nw = neglected.creatures[0]!.life;
    nw.mood = 20;
    nw.cleanliness = 20;
    nw.hunger = 20;
    nw.hydration = 20;
    nw.health = 40;

    const good = runExhibition(cared, c.id, T0);
    const bad = runExhibition(neglected, c.id, T0);

    expect(good.total).toBeGreaterThan(bad.total);
    expect(good.coins).toBeGreaterThan(bad.coins);

    // eslint-disable-next-line no-console
    console.log(
      `\n[世話の効き目] よく世話した個体 total=${good.total}(${good.rank}) coins=${good.coins} / ` +
        `放置した個体 total=${bad.total}(${bad.rank}) coins=${bad.coins} / 差 ${(good.total - bad.total).toFixed(1)} 点`,
    );
  });
});

// ─────────────────────────────────────────────────────────
//  クールダウンの永続化（セーブ v4）
// ─────────────────────────────────────────────────────────

describe('クールダウンの永続化', () => {
  it('展示会のクールダウンは保存・復元をまたいで維持される', () => {
    const s = newGame('cooldown-exhibition');
    const c = pushAdult(s, randomGenotype('cd-exh'), T0);
    s.unlocks.exhibition = true;

    const score = runExhibition(s, c.id, T0);
    expect(score.coins).toBeGreaterThan(0);
    expect(c.lastExhibitAt).toBe(T0);

    // 直後は出られない。
    const soon = canExhibit(s, c.id, T0 + 1000);
    expect(soon.ok).toBe(false);
    expect(soon.reason).toContain('さっき');

    // 実際のセーブと同じ JSON 往復（localStorage への保存・読み込み相当）。
    const restored: GameState = JSON.parse(JSON.stringify(s));
    const rc = findCreature(restored, c.id)!;
    expect(rc.lastExhibitAt).toBe(T0);

    // リロードしてもクールダウンは飛ばせない（コイン稼ぎの抜け道を塞ぐ）。
    const afterReload = canExhibit(restored, c.id, T0 + 1000);
    expect(afterReload.ok).toBe(false);
    expect(afterReload.reason).toContain('さっき');

    // 明ければ通る。
    const later = canExhibit(restored, c.id, T0 + EXHIBITION.cooldownMs + 1);
    expect(later.ok, later.reason).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `\n[クールダウン永続化] 展示会: lastExhibitAt=${rc.lastExhibitAt} を JSON 往復後も保持 / ` +
        `復元直後の再参加=拒否「${afterReload.reason}」/ ${EXHIBITION.cooldownMs / 60000} 分後=許可`,
    );
  });

  it('交配のクールダウンも保存・復元をまたいで維持される', () => {
    const s = newGame('cooldown-breeding');
    const a = pushAdult(s, randomGenotype('cd-a'), T0);
    const b = pushAdult(s, randomGenotype('cd-b'), T0);
    s.unlocks = { nursery: true, exhibition: true, shop: true, breeding: true, collection: true };
    s.coins = 500;

    applyTick(s, T0 + 1000);
    const bred = doBreed(s, a.id, b.id, T0 + 1000);
    expect(bred.ok, bred.reason).toBe(true);
    expect(a.lastBredAt).toBe(T0 + 1000);
    expect(b.lastBredAt).toBe(T0 + 1000);
    // 生まれた卵は未交配（0）。
    expect(findCreature(s, bred.eggId!)!.lastBredAt).toBe(0);

    const restored: GameState = JSON.parse(JSON.stringify(s));
    const ra = findCreature(restored, a.id)!;
    const rb = findCreature(restored, b.id)!;
    expect(ra.lastBredAt).toBe(T0 + 1000);

    // 復元直後（クールダウン中）は交配できない。機嫌はわざと満たしておく。
    ra.life.mood = 95;
    rb.life.mood = 95;
    restored.capacity.egg = 3;
    applyTick(restored, T0 + 2000);
    ra.life.mood = 95;
    rb.life.mood = 95;
    const denied = canBreed(restored, a.id, b.id);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toContain('休息中');

    // クールダウンが明ければ通る。
    applyTick(restored, T0 + BREEDING.cooldownMs + 5000);
    ra.life.mood = 95;
    rb.life.mood = 95;
    ra.life.health = 95;
    rb.life.health = 95;
    const allowed = canBreed(restored, a.id, b.id);
    expect(allowed.ok, allowed.reason).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `\n[クールダウン永続化] 交配: lastBredAt=${ra.lastBredAt} を JSON 往復後も保持 / ` +
        `復元直後=拒否「${denied.reason}」/ ${BREEDING.cooldownMs / 60000} 分後=許可`,
    );
  });
});

// ─────────────────────────────────────────────────────────
//  5 項目のスケール
// ─────────────────────────────────────────────────────────

describe('展示会の 5 項目のスケール', () => {
  it('100 体の実測で、5 項目が同じ尺度（おおむね 40〜75）に収まる', () => {
    const items: Record<string, number[]> = {
      美しさ: [], 健康: [], 個性: [], 希少性: [], 育成: [], 総合: [],
    };

    for (let i = 0; i < 100; i++) {
      const st = newGame(`scale-${i}`);
      const c = pushAdult(st, randomGenotype(`scale-${i}`), T0);
      // 世話の質を「ふつうに遊んだ範囲」で振る（放置ぎみ 〜 手厚い）。
      const q = i / 99;
      c.life.hunger = 45 + 55 * q;
      c.life.hydration = 45 + 55 * q;
      c.life.cleanliness = 45 + 55 * q;
      c.life.mood = 45 + 55 * q;
      c.life.health = 55 + 45 * q;
      c.life.careCount = Math.round(8 + 32 * q);
      st.unlocks.exhibition = true;
      st.stats.exhibitions = 5; // 初回の下駄を避ける

      const ph = getPhenotype(c, 'adult');
      items['美しさ']!.push(beautyScore(ph));
      items['健康']!.push(healthScore(ph, c.life));
      items['個性']!.push(characterScore(ph));
      items['希少性']!.push(rarityScore(ph));
      items['育成']!.push(careScore(c.life));
      items['総合']!.push(runExhibition(st, c.id, T0).total);
    }

    const lines = Object.entries(items).map(([name, v]) => {
      const t = summarize(v);
      return `  ${name.padEnd(4)} 平均${t.mean.toFixed(1).padStart(5)} 中央${t.median.toFixed(1).padStart(5)} 最小${t.min.toFixed(1).padStart(5)} 最大${t.max.toFixed(1).padStart(5)}`;
    });

    // 希少性だけは「交配で伸ばす項目」なので、到達可能な上限も併記する。
    const topRarity = rarityScore({ rarity: { score: 100 } } as never);
    const goodRarity = rarityScore({ rarity: { score: 70 } } as never);

    // eslint-disable-next-line no-console
    console.log(
      `\n[展示会 5 項目のスケール] 成体 100 体（世話の質を 45〜100 で振った）\n${lines.join('\n')}\n` +
        `  ※ 希少性は交配で伸びる項目。score=70 → ${goodRarity.toFixed(1)} 点 / score=100(precious 最高) → ${topRarity.toFixed(1)} 点`,
    );

    for (const [name, v] of Object.entries(items)) {
      if (name === '総合') continue;
      const t = summarize(v);
      expect(t.mean, `${name} の平均が 40〜75 に収まらない`).toBeGreaterThanOrEqual(40);
      expect(t.mean, `${name} の平均が 40〜75 に収まらない`).toBeLessThanOrEqual(75);
      expect(t.min, `${name} の最小が 25 未満`).toBeGreaterThanOrEqual(25);
      expect(t.max, `${name} の最大が 100 超`).toBeLessThanOrEqual(100);
    }

    // 優秀な個体が 85 以上に届くこと（希少性は交配前提なので曲線側で確認）。
    expect(Math.max(...items['美しさ']!)).toBeGreaterThanOrEqual(85);
    expect(Math.max(...items['個性']!)).toBeGreaterThanOrEqual(85);
    expect(Math.max(...items['健康']!)).toBeGreaterThanOrEqual(85);
    expect(Math.max(...items['育成']!)).toBeGreaterThanOrEqual(85);
    expect(topRarity).toBeGreaterThanOrEqual(85);
    expect(goodRarity).toBeGreaterThanOrEqual(80);
  });
});

// ─────────────────────────────────────────────────────────
//  テスト 5: 派手な個体が常に勝たないこと
// ─────────────────────────────────────────────────────────

describe('派手さと得点', () => {
  it('装飾数と展示会の総合得点に、強い正の相関（>0.5）が無い', () => {
    // 装飾数の分布を作り、少ない 50 体と多い 50 体を取り出す。
    const candidates: { genotype: Genotype; decor: number; rarity: number }[] = [];
    for (let i = 0; i < 800; i++) {
      const g = randomGenotype(`decor-${i}`);
      const p = phenotypeOf(g, 'adult');
      candidates.push({ genotype: g, decor: decorCount(p.parts), rarity: p.rarity.score });
    }
    candidates.sort((a, b) => a.decor - b.decor);
    const low = candidates.slice(0, 50);
    const high = candidates.slice(-50);
    const samples = [...low, ...high];

    const decors: number[] = [];
    const totals: number[] = [];
    for (const cand of samples) {
      // 体調・世話はすべて同一にして、遺伝の差だけを見る。
      const st = newGame('decor-correlation');
      const c = pushAdult(st, cand.genotype, T0);
      st.unlocks.exhibition = true;
      st.stats.exhibitions = 5; // 初回の下駄を避ける
      const score = runExhibition(st, c.id, T0);
      decors.push(cand.decor);
      totals.push(score.total);
    }

    const r = pearson(decors, totals);
    const lowTotals = totals.slice(0, 50);
    const highTotals = totals.slice(50);

    // eslint-disable-next-line no-console
    console.log(
      `\n[派手さの検証] 装飾数と総合得点の相関係数 r = ${r.toFixed(3)}\n` +
        `  装飾が少ない群: 装飾 平均${mean(low.map((c) => c.decor)).toFixed(2)} 個 → 得点 平均${mean(lowTotals).toFixed(1)} ` +
        `(最小${Math.min(...lowTotals).toFixed(1)} 最大${Math.max(...lowTotals).toFixed(1)})\n` +
        `  装飾が多い群  : 装飾 平均${mean(high.map((c) => c.decor)).toFixed(2)} 個 → 得点 平均${mean(highTotals).toFixed(1)} ` +
        `(最小${Math.min(...highTotals).toFixed(1)} 最大${Math.max(...highTotals).toFixed(1)})\n` +
        `  参考: 希少度スコア 少ない群 平均${mean(low.map((c) => c.rarity)).toFixed(1)} / 多い群 平均${mean(high.map((c) => c.rarity)).toFixed(1)}`,
    );

    expect(r).toBeLessThan(0.5);
    // 逆に「装飾が多いと必ず負ける」でもないこと（最高点が片方に偏りきらない）。
    expect(Math.max(...highTotals)).toBeGreaterThan(mean(lowTotals));
  });
});

// ─────────────────────────────────────────────────────────
//  テスト 6: 世話の飽き
// ─────────────────────────────────────────────────────────

describe('世話の飽き', () => {
  it('同じ世話の 5 連打より、5 種を巡回したほうが効率がよい', () => {
    const s = newGame('boredom');
    const g = randomGenotype('boredom-target');
    const spammer = pushJuvenile(s, g, T0);
    const rotator = pushJuvenile(s, g, T0);

    const spam: CareAction[] = ['pet', 'pet', 'pet', 'pet', 'pet'];
    const cycle: CareAction[] = ['feed', 'water', 'clean', 'pet', 'play'];

    let multSpam = 0;
    let multCycle = 0;
    let now = T0;

    for (let i = 0; i < 5; i++) {
      now += 7000; // どちらも同じ間隔（pet のクールダウン 5 秒を満たす）

      multSpam += careAvailability(s, spammer.id, spam[i]!, now).effectiveness;
      expect(doCare(s, spammer.id, spam[i]!, now).ok).toBe(true);

      multCycle += careAvailability(s, rotator.id, cycle[i]!, now).effectiveness;
      expect(doCare(s, rotator.id, cycle[i]!, now).ok).toBe(true);
    }

    const growthSpam = spammer.life.growth;
    const growthCycle = rotator.life.growth;

    // eslint-disable-next-line no-console
    console.log(
      `\n[飽きの検証] 7 秒間隔で 5 回ずつ\n` +
        `  同じ世話を 5 連打 : 効果倍率の合計 ${multSpam.toFixed(3)} / 成長 +${growthSpam.toFixed(2)}\n` +
        `  5 種を巡回       : 効果倍率の合計 ${multCycle.toFixed(3)} / 成長 +${growthCycle.toFixed(2)}\n` +
        `  巡回は連打の ${(multCycle / multSpam).toFixed(2)} 倍 効率がよい`,
    );

    expect(multCycle).toBeGreaterThan(multSpam);
    expect(multCycle / multSpam).toBeGreaterThan(1.2);
    expect(growthCycle).toBeGreaterThan(growthSpam);

    // 連打側は「あきているみたい」と分かること（ボタンは押せるまま）。
    const av = careAvailability(s, spammer.id, 'pet', now + 6000);
    expect(av.enabled).toBe(true);
    expect(av.reason).toBeTruthy();
    expect(av.effectiveness).toBeLessThan(1);
  });
});

// ─────────────────────────────────────────────────────────
//  テスト 7: 性格による反応差
// ─────────────────────────────────────────────────────────

describe('性格による反応差', () => {
  /** 条件に合う遺伝子を探す（見つからなければテストを落とす）。 */
  function findGenotype(pred: (g: Genotype) => boolean, label: string): Genotype {
    for (let i = 0; i < 4000; i++) {
      const g = randomGenotype(`persona-${i}`);
      if (pred(g)) return g;
    }
    throw new Error(`${label} に該当する個体が見つからない`);
  }

  it('人なつこい子と慎重な子で「なでる」の反応が変わる', () => {
    const friendly = findGenotype((g) => {
      const p = phenotypeOf(g, 'juvenile').personality;
      return p.affection >= 0.72;
    }, '人なつこい個体');

    const shy = findGenotype((g) => {
      const p = phenotypeOf(g, 'juvenile').personality;
      return p.affection <= 0.28 && p.dependence < 0.6;
    }, '慎重な個体');

    const s = newGame('personality');
    const a = pushJuvenile(s, friendly, T0);
    const b = pushJuvenile(s, shy, T0);

    const now = T0 + 30_000;
    const ra = doCare(s, a.id, 'pet', now);
    const rb = doCare(s, b.id, 'pet', now);

    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(ra.reaction).toBe('delighted');
    expect(rb.reaction).toBe('dislike');
    expect(ra.reaction).not.toBe(rb.reaction);
    expect(ra.speech).not.toBe(rb.speech);
    // 喜んだほうが機嫌の上がりも大きい。
    expect(ra.deltas.mood!).toBeGreaterThan(rb.deltas.mood!);

    // eslint-disable-next-line no-console
    console.log(
      `\n[性格差] なでる\n` +
        `  人なつこい子（affection ${getPhenotype(a).personality.affection.toFixed(2)}）: ${ra.reaction} 「${ra.speech}」 機嫌 +${ra.deltas.mood}\n` +
        `  慎重な子（affection ${getPhenotype(b).personality.affection.toFixed(2)}）: ${rb.reaction} 「${rb.speech}」 機嫌 +${rb.deltas.mood}`,
    );
  });

  it('食いしんぼうと小食で「えさ」の反応が変わる', () => {
    const bigEater = findGenotype((g) => phenotypeOf(g, 'juvenile').personality.appetite >= 0.72, '食いしんぼう');
    const smallEater = findGenotype((g) => phenotypeOf(g, 'juvenile').personality.appetite <= 0.28, '小食');

    const s = newGame('appetite');
    const a = pushJuvenile(s, bigEater, T0);
    const b = pushJuvenile(s, smallEater, T0);
    // どちらも「そこそこ満ちている」状態にそろえる。
    a.life.hunger = 70;
    b.life.hunger = 70;

    const now = T0 + 30_000;
    const ra = doCare(s, a.id, 'feed', now);
    const rb = doCare(s, b.id, 'feed', now);

    expect(ra.reaction).toBe('delighted');
    expect(rb.reaction).toBe('full');

    // eslint-disable-next-line no-console
    console.log(
      `\n[性格差] えさ（どちらも 満腹度 70）\n` +
        `  食いしんぼう: ${ra.reaction} 「${ra.speech}」 満腹 +${ra.deltas.hunger}\n` +
        `  小食        : ${rb.reaction} 「${rb.speech}」 満腹 +${rb.deltas.hunger}`,
    );
  });
});

// ─────────────────────────────────────────────────────────
//  テスト 8: オフライン
// ─────────────────────────────────────────────────────────

describe('オフライン経過', () => {
  it('24 時間の放置でも maxOfflineMs で頭打ちになり、値が範囲外にならない', () => {
    const s = newGame('offline');
    rollEggChoices(s);
    const seeds = s.pendingEggs!.slice(0, 3).map((e) => e.seed);
    expect(chooseEggs(s, seeds, T0).ok).toBe(true);

    const twoHours: GameState = structuredClone(s);
    const oneDay: GameState = structuredClone(s);

    const r2h = applyTick(twoHours, T0 + TIMING.maxOfflineMs);
    const r24h = applyTick(oneDay, T0 + 24 * 60 * 60 * 1000);

    expect(r2h.offlineMs).toBe(TIMING.maxOfflineMs);
    expect(r24h.offlineMs).toBe(TIMING.maxOfflineMs);

    // 2 時間ぶんと 24 時間ぶんで、まったく同じ結果になる＝上限が効いている。
    for (let i = 0; i < s.creatures.length; i++) {
      const a = twoHours.creatures[i]!.life;
      const b = oneDay.creatures[i]!.life;
      expect(b.stage).toBe(a.stage);
      expect(b.growth).toBeCloseTo(a.growth, 6);
      expect(b.hatchProgress).toBeCloseTo(a.hatchProgress, 6);
      expect(b.hunger).toBeCloseTo(a.hunger, 6);
      expect(b.health).toBeCloseTo(a.health, 6);
    }

    // すべての値が 0..100 に収まっていること。
    for (const c of oneDay.creatures) {
      for (const key of ['growth', 'hunger', 'hydration', 'cleanliness', 'mood', 'health', 'hatchProgress'] as const) {
        expect(c.life[key], `${c.name}.${key} = ${c.life[key]}`).toBeGreaterThanOrEqual(0);
        expect(c.life[key], `${c.name}.${key} = ${c.life[key]}`).toBeLessThanOrEqual(100);
      }
      expect(Number.isFinite(c.life.ageMs)).toBe(true);
    }

    // 放置だけでは全部終わらない（指示書 §5）。24 時間空けても成体はいない。
    expect(creaturesByStage(oneDay, 'adult').length).toBe(0);
    expect(creaturesByStage(oneDay, 'juvenile').length).toBe(3);

    const sample = oneDay.creatures[0]!.life;
    // eslint-disable-next-line no-console
    console.log(
      `\n[オフライン] 24 時間放置 → 適用された経過 ${(r24h.offlineMs / 3600000).toFixed(1)} 時間（上限 ${(TIMING.maxOfflineMs / 3600000).toFixed(1)} 時間）\n` +
        `  結果: 孵化 ${r24h.hatched.length} 体 / 成体 0 体 / 例: ${oneDay.creatures[0]!.name} ` +
        `stage=${sample.stage} growth=${sample.growth.toFixed(1)} hunger=${sample.hunger.toFixed(1)} health=${sample.health.toFixed(1)}`,
    );
  });

  it('壊れた数値（NaN）が入っていても、保存できる状態に直る', () => {
    // NaN は JSON.stringify で null になり、セーブ全体が「壊れている」判定になる。
    // 実際に開発中、3 体とも health: null で保存され、起動時に復元ダイアログが出た。
    const s = newGame('nan-guard');
    rollEggChoices(s);
    chooseEggs(s, s.pendingEggs!.slice(0, 3).map((e) => e.seed), T0);

    const victim = s.creatures[0]!;
    victim.life.health = Number.NaN;
    victim.life.hunger = Number.POSITIVE_INFINITY;
    s.creatures[1]!.life.mood = Number.NaN;

    applyTick(s, T0 + 1000);

    for (const c of s.creatures) {
      for (const key of ['growth', 'hunger', 'hydration', 'cleanliness', 'mood', 'health', 'hatchProgress'] as const) {
        expect(Number.isFinite(c.life[key]), `${c.name}.${key} が有限でない`).toBe(true);
      }
    }
    // JSON 往復で null にならない＝セーブが壊れない。
    const round = JSON.parse(JSON.stringify(s)) as GameState;
    for (const c of round.creatures) {
      expect(c.life.health).not.toBeNull();
      expect(typeof c.life.health).toBe('number');
    }

    // 世話も NaN を書き込まない。
    const before = victim.life.health;
    victim.life.mood = Number.NaN;
    const r = doCare(s, victim.id, 'talk', T0 + 20_000);
    expect(r.ok).toBe(true);
    expect(Number.isFinite(victim.life.mood)).toBe(true);
    expect(Number.isFinite(before)).toBe(true);
  });

  it('時計が巻き戻っても壊れない', () => {
    const s = newGame('clock-back');
    rollEggChoices(s);
    chooseEggs(s, s.pendingEggs!.slice(0, 3).map((e) => e.seed), T0);
    applyTick(s, T0 + 60_000);
    const before = structuredClone(s.creatures[0]!.life);

    // 端末の時刻が巻き戻ったケース。
    const report = applyTick(s, T0 - 10_000);
    expect(report.offlineMs).toBe(0);
    expect(s.creatures[0]!.life.hatchProgress).toBeCloseTo(before.hatchProgress, 6);
    expect(s.creatures[0]!.life.lastTickAt).toBe(T0 - 10_000);
  });
});

// ─────────────────────────────────────────────────────────
//  表現型キャッシュ
// ─────────────────────────────────────────────────────────

describe('表現型キャッシュ', () => {
  it('同じ個体は同一オブジェクトを返し、上限を超えて溜まらない', () => {
    const s = newGame('pheno-cache');
    const c = pushAdult(s, randomGenotype('cache-1'), T0);

    const p1 = getPhenotype(c);
    const p2 = getPhenotype(c);
    expect(p2).toBe(p1); // メモ化されている（参照が同じ）
    expect(getPhenotype(c, 'juvenile')).not.toBe(p1); // 段階が違えば別

    // 上限を超えて個体を触っても、キャッシュは上限で止まる。
    for (let i = 0; i < PHENOTYPE_CACHE_LIMIT + 120; i++) {
      const tmp = createCreature(s, randomGenotype(`cache-${i}`), T0, {
        parents: null, parentNames: null, generation: 1, fromBreeding: false,
      });
      getPhenotype(tmp, 'adult');
    }
    expect(phenotypeCacheSize()).toBeLessThanOrEqual(PHENOTYPE_CACHE_LIMIT);

    // eslint-disable-next-line no-console
    console.log(
      `\n[キャッシュ] ${PHENOTYPE_CACHE_LIMIT + 120} 体ぶん参照後のキャッシュ件数 = ${phenotypeCacheSize()}（上限 ${PHENOTYPE_CACHE_LIMIT}）`,
    );
  });
});
