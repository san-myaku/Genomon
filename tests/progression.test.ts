/**
 * 進行のテスト（ゲームプレイ担当）。
 *
 * ここでいちばん重要なのは「通しプレイが最初から最後までデバッグ操作なしで完走すること」。
 * 個々の関数が正しくても、つながっていなければゲームとして成立しないため、
 * 実際のプレイ順で公開 API だけを叩いて最後まで到達できるかを見る。
 */

import { describe, expect, it } from 'vitest';

import {
  applyTick,
  availableItems,
  blockedCreatures,
  breedingPreview,
  buyItem,
  canBreed,
  canExhibit,
  careActionsFor,
  careAvailability,
  chooseEggs,
  creaturesByStage,
  doBreed,
  doCare,
  findCreature,
  newGame,
  nextObjective,
  releaseCreature,
  rollEggChoices,
  runExhibition,
  useItem,
} from '../src/game/index.ts';
import { createCreature } from '../src/game/state.ts';
import { BREEDING, DECAY, EXHIBITION, SHOP_CHEAPEST_PRICE } from '../src/game/config.ts';
import { randomGenotype } from '../src/genetics/index.ts';
import type { CareAction, Creature, GameState, ScreenId } from '../src/core/types.ts';

/** 仮想時刻の起点（実時間には一切依存しない）。 */
const T0 = 1_700_000_000_000;

const VALID_SCREENS: readonly string[] = [
  'title', 'eggSelect', 'nursery', 'collection', 'detail',
  'exhibition', 'shop', 'breeding', 'settings', 'visualLab',
] satisfies readonly ScreenId[];

/**
 * プレイヤーの代わりに遊ぶ人。
 * 公開 API しか使わない（life を直接いじる等のデバッグ操作をしない）。
 */
class Player {
  readonly state: GameState;
  now = T0;
  ops = 0;
  private readonly rotation = new Map<string, number>();
  readonly log: string[] = [];

  constructor(worldSeed: string) {
    this.state = newGame(worldSeed);
  }

  get elapsedSec(): number {
    return Math.round((this.now - T0) / 1000);
  }

  mark(label: string): void {
    this.log.push(
      `t=${String(this.elapsedSec).padStart(4)}秒  操作${String(this.ops).padStart(3)}回  ${label}`,
    );
  }

  /**
   * 時間を進める。
   * UI は 250ms ごとに applyTick を呼ぶので、テストも 1 秒刻みで呼ぶ。
   * ここで 4 秒まとめて呼ぶと tick.ts が「オフライン復帰」と判定して
   * 減衰が半分・進行が 6 割になり、**実プレイと違う条件で測ってしまう**。
   */
  tick(ms: number): void {
    for (let t = 0; t < ms; t += 1000) {
      this.now += 1000;
      applyTick(this.state, this.now);
    }
    // どの瞬間でも「次に何をすればよいか」が出ていること（指示書 §25）。
    const obj = nextObjective(this.state);
    expect(obj.text.length).toBeGreaterThan(0);
    expect(VALID_SCREENS).toContain(obj.screen);
  }

  /** 全個体に、順番に世話をする（同じボタンの連打をしない、ふつうの遊び方）。 */
  careEveryone(): void {
    for (const c of [...this.state.creatures]) {
      const acts = careActionsFor(c.life.stage).filter((a) => a !== 'rest');
      const i = this.rotation.get(c.id) ?? 0;
      const action = acts[i % acts.length] as CareAction;
      if (!careAvailability(this.state, c.id, action, this.now).enabled) continue;
      const r = doCare(this.state, c.id, action, this.now);
      if (r.ok) {
        this.ops++;
        this.rotation.set(c.id, i + 1);
      }
    }
  }

  /** 条件を満たすまで「世話 → 4 秒経過」を繰り返す。 */
  playUntil(cond: () => boolean, label: string, maxSteps = 500): void {
    let steps = 0;
    while (!cond() && steps < maxSteps) {
      this.careEveryone();
      this.tick(4000);
      steps++;
    }
    expect(cond(), `${label} に到達できなかった（${steps} ステップ / ${this.elapsedSec} 秒）`).toBe(true);
  }
}

/** テスト用に成体を 1 体つくる（枠・コイン系の状況を作るための土台）。 */
function pushAdult(state: GameState, seed: string, now: number): Creature {
  const c = createCreature(state, randomGenotype(seed), now, {
    parents: null,
    parentNames: null,
    generation: 1,
    fromBreeding: false,
  });
  c.life.stage = 'adult';
  c.life.growth = 100;
  c.life.hatchProgress = 100;
  c.life.hunger = 85;
  c.life.hydration = 85;
  c.life.cleanliness = 85;
  c.life.mood = 90;
  c.life.health = 95;
  c.life.careCount = 20;
  state.creatures.push(c);
  return c;
}

// ─────────────────────────────────────────────────────────
//  テスト 1: 通しプレイ
// ─────────────────────────────────────────────────────────

describe('通しプレイ', () => {
  it('卵選択から交配・親子の共存までデバッグ操作なしで到達できる', () => {

    const p = new Player('genomon-playthrough');
    const s = p.state;

    // ── 卵選択 ────────────────────────────────────────
    expect(nextObjective(s).screen).toBe('eggSelect');

    const choices = rollEggChoices(s);
    expect(choices.length).toBe(9);
    // 何度呼んでも同じ 9 個（API.md 規約 5）。
    expect(rollEggChoices(s).map((e) => e.seed)).toEqual(choices.map((e) => e.seed));
    p.mark(`卵候補を ${choices.length} 個 提示`);
    expect(nextObjective(s).screen).toBe('eggSelect');

    const picked = [choices[0]!.seed, choices[3]!.seed, choices[6]!.seed];
    const chose = chooseEggs(s, picked, p.now);
    expect(chose.ok, chose.reason).toBe(true);
    expect(s.creatures.length).toBe(3);
    expect(s.pendingEggs).toBeNull();
    p.ops += 1;
    p.mark(`卵を 3 個 えらんだ（${s.creatures.map((c) => c.name).join('・')}）`);

    // ── 孵化 ──────────────────────────────────────────
    expect(nextObjective(s).screen).toBe('nursery');
    p.playUntil(() => s.stats.hatched >= 1, '最初の孵化');
    p.mark(`最初の孵化（孵化 ${s.stats.hatched} 体）`);
    expect(s.unlocks.collection).toBe(true);

    p.playUntil(() => creaturesByStage(s, 'juvenile').length + creaturesByStage(s, 'adult').length >= 3, '3 体すべての孵化');
    p.mark('3 体すべてが 幼体になった');

    // ── 成体化 → 展示会の解放 ────────────────────────
    p.playUntil(() => creaturesByStage(s, 'adult').length >= 1, '最初の成体');
    expect(s.unlocks.exhibition).toBe(true);
    const adultA = creaturesByStage(s, 'adult')[0]!;
    p.mark(`${adultA.name} が 成体になった → 展示会 解放`);

    // ── 展示会 ────────────────────────────────────────
    expect(nextObjective(s).screen).toBe('exhibition');
    const can = canExhibit(s, adultA.id, p.now);
    expect(can.ok, can.reason).toBe(true);

    const score1 = runExhibition(s, adultA.id, p.now);
    p.ops += 1;
    expect(score1.coins).toBeGreaterThanOrEqual(EXHIBITION.firstTimeMinCoins);
    expect(score1.total).toBeGreaterThanOrEqual(EXHIBITION.firstTimeScoreFloor);
    expect(score1.comments.length).toBeGreaterThanOrEqual(3);
    expect(s.coins).toBe(score1.coins);
    expect(s.unlocks.shop).toBe(true);
    p.mark(
      `展示会: ${score1.rank} ランク ${score1.total} 点 / ${score1.coins} コイン（審査員 ${score1.judge}）→ ショップ 解放`,
    );
    p.log.push(`        審査コメント: ${score1.comments.join(' ／ ')}`);

    // ── ショップ ──────────────────────────────────────
    expect(nextObjective(s).screen).toBe('shop');
    const items = availableItems(s);
    expect(items.length).toBeGreaterThan(0);
    const buyable = items.filter((i) => i.consumable && i.price <= s.coins);
    expect(buyable.length).toBeGreaterThan(0);
    expect(SHOP_CHEAPEST_PRICE).toBeLessThanOrEqual(score1.coins);

    const item = buyable[0]!;
    const coinsBefore = s.coins;
    const bought = buyItem(s, item.id);
    p.ops += 1;
    expect(bought.ok, bought.reason).toBe(true);
    expect(s.coins).toBe(coinsBefore - item.price);
    expect(s.inventory[item.id]).toBe(1);
    p.mark(`「${item.name}」を ${item.price} コインで 購入（残り ${s.coins}）`);

    const used = useItem(s, adultA.id, item.id, p.now);
    p.ops += 1;
    expect(used.ok, used.reason).toBe(true);
    expect(s.inventory[item.id]).toBeUndefined();
    p.mark(`「${item.name}」を ${adultA.name} に使用（${used.reaction}: ${used.speech}）`);

    // ── 2 体目の成体 → 交配の解放 ────────────────────
    p.playUntil(() => creaturesByStage(s, 'adult').length >= 2, '2 体目の成体');
    expect(s.unlocks.breeding).toBe(true);
    const adultB = creaturesByStage(s, 'adult')[1]!;
    p.mark(`${adultB.name} が 成体になった → 交配 解放`);

    // 2 体目も展示会へ（クールダウンは個体別なので、別の子ならすぐ出せる）。
    const can2 = canExhibit(s, adultB.id, p.now);
    expect(can2.ok, can2.reason).toBe(true);
    const score2 = runExhibition(s, adultB.id, p.now);
    p.ops += 1;
    expect(score2.coins).toBeGreaterThanOrEqual(EXHIBITION.minCoins);
    p.mark(`展示会 2 回目: ${score2.rank} ランク ${score2.total} 点 / ${score2.coins} コイン（所持 ${s.coins}）`);

    // ── 交配 ──────────────────────────────────────────
    // コインが足りるまで遊びながら待つ（足りていれば即通過）。
    p.playUntil(() => s.coins >= BREEDING.costCoins, '交配費用が貯まる', 50);

    const preview = breedingPreview(adultA, adultB);
    expect(preview.length).toBeGreaterThanOrEqual(5);
    expect(preview.every((row) => row.label.length > 0 && row.detail.length > 0)).toBe(true);

    const canB = canBreed(s, adultA.id, adultB.id);
    expect(canB.ok, canB.reason).toBe(true);
    expect(nextObjective(s).screen).toBe('breeding');

    const coinsBeforeBreed = s.coins;
    const bred = doBreed(s, adultA.id, adultB.id, p.now);
    p.ops += 1;
    expect(bred.ok, bred.reason).toBe(true);
    expect(s.coins).toBe(coinsBeforeBreed - BREEDING.costCoins);

    const child = findCreature(s, bred.eggId!)!;
    expect(child).toBeTruthy();
    expect(child.life.stage).toBe('egg');
    expect(child.generation).toBe(2);
    expect(child.parents).toEqual([adultA.id, adultB.id]);
    expect(child.parentNames).toEqual([adultA.name, adultB.name]);
    expect(child.fromBreeding).toBe(true);
    p.mark(`交配: ${adultA.name} × ${adultB.name} → 卵「${child.name}」が 生まれた`);

    // ── 子の孵化・親子の共存 ─────────────────────────
    p.playUntil(() => findCreature(s, child.id)!.life.stage !== 'egg', '子の孵化');
    p.mark(`子「${child.name}」が 孵化（世代 ${child.generation}）`);

    expect(findCreature(s, adultA.id)).toBeTruthy();
    expect(findCreature(s, adultB.id)).toBeTruthy();
    expect(findCreature(s, child.id)!.life.stage).toBe('juvenile');
    p.mark(
      `親子が 共存: 親 ${adultA.name}・${adultB.name} / 子 ${child.name}（合計 ${s.creatures.length} 体）`,
    );

    // ── 到達したことの総括 ───────────────────────────
    expect(s.stats.hatched).toBeGreaterThanOrEqual(4);
    expect(s.stats.grownUp).toBeGreaterThanOrEqual(2);
    expect(s.stats.bred).toBe(1);
    expect(s.stats.exhibitions).toBe(2);
    expect(s.unlocks).toEqual({
      nursery: true,
      exhibition: true,
      shop: true,
      breeding: true,
      collection: true,
      breeder: false,
      staff: true,
    });

    // eslint-disable-next-line no-console
    console.log(
      ['', '─── 通しプレイ ログ ───', ...p.log,
        `合計: 仮想時間 ${p.elapsedSec} 秒（約 ${(p.elapsedSec / 60).toFixed(1)} 分） / 操作 ${p.ops} 回 / 世話 ${s.stats.careActions} 回`,
        '',
      ].join('\n'),
    );
  });
});

// ─────────────────────────────────────────────────────────
//  テスト 2: 進行不能が無いこと
// ─────────────────────────────────────────────────────────

describe('詰みが起きないこと', () => {
  it('幼体の枠が満杯でも孵化は保留されるだけで、手放せば進む', () => {
    const s = newGame('capacity-hatch');
    const now0 = T0;
    rollEggChoices(s);
    const seeds = s.pendingEggs!.slice(0, 3).map((e) => e.seed);
    expect(chooseEggs(s, seeds, now0).ok).toBe(true);

    // 幼体の枠を 2 にして「3 個目が入らない」状況を作る。
    s.capacity.juvenile = 2;

    // 放置だけで卵は孵る（世話ゼロでも詰まない設計）。
    // 幼体になった直後で止めたいので、孵化に届くぶんだけ進める。
    let now = now0;
    for (let i = 0; i < 2; i++) {
      now += 300_000;
      applyTick(s, now);
    }

    expect(creaturesByStage(s, 'juvenile').length).toBe(2);
    const blocked = blockedCreatures(s);
    expect(blocked.length).toBe(1);
    expect(blocked[0]!.creature.life.stage).toBe('egg');
    expect(blocked[0]!.creature.life.hatchProgress).toBe(100);
    expect(blocked[0]!.reason).toContain('枠');

    // 「次に何をすればよいか」が、詰まりの解き方を案内していること。
    const obj = nextObjective(s);
    expect(obj.text).toContain('枠');
    expect(obj.text).toContain('手放す');

    // 手放せば進む。
    const victim = creaturesByStage(s, 'juvenile')[0]!;
    const released = releaseCreature(s, victim.id);
    expect(released.ok, released.reason).toBe(true);

    now += 1000;
    const report = applyTick(s, now);
    expect(report.hatched).toContain(blocked[0]!.creature.id);
    expect(blockedCreatures(s).length).toBe(0);
  });

  it('最後の 2 体は手放せない（新しい卵を産めなくなる詰みを防ぐ）', () => {
    const s = newGame('min-keep');
    const a = pushAdult(s, 'keep-a', T0);
    const b = pushAdult(s, 'keep-b', T0);
    const c = pushAdult(s, 'keep-c', T0);
    s.capacity.adult = 3;

    expect(releaseCreature(s, c.id).ok).toBe(true);
    const denied = releaseCreature(s, b.id);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toContain('手放す');
    expect(s.creatures.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('卵の枠が満杯なら交配は理由を返し、空ければ通る', () => {
    const s = newGame('capacity-breed');
    const a = pushAdult(s, 'breed-a', T0);
    const b = pushAdult(s, 'breed-b', T0);
    s.unlocks = { nursery: true, exhibition: true, shop: true, breeding: true, collection: true, breeder: false, staff: false };
    s.coins = 500;
    s.capacity.egg = 1;

    // 卵枠を埋める。
    const filler = createCreature(s, randomGenotype('filler'), T0, {
      parents: null, parentNames: null, generation: 1, fromBreeding: false,
    });
    s.creatures.push(filler);

    applyTick(s, T0 + 1000);
    const blockedBreed = doBreed(s, a.id, b.id, T0 + 1000);
    expect(blockedBreed.ok).toBe(false);
    expect(blockedBreed.reason).toContain('卵の枠');

    expect(releaseCreature(s, filler.id).ok).toBe(true);
    const ok = doBreed(s, a.id, b.id, T0 + 2000);
    expect(ok.ok, ok.reason).toBe(true);
    expect(findCreature(s, ok.eggId!)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────
//  人間らしい間欠的なプレイ（リードの手プレイでの不合格を受けた回帰テスト）
// ─────────────────────────────────────────────────────────

describe('人間らしい間欠的なプレイ', () => {
  /** いま いちばん困っている子と、それに効く世話を 1 つ選ぶ（人が実際にやること）。 */
  const NEED: readonly { key: 'hunger' | 'hydration' | 'cleanliness' | 'mood'; action: CareAction }[] = [
    { key: 'hunger', action: 'feed' },
    { key: 'hydration', action: 'water' },
    { key: 'cleanliness', action: 'clean' },
    { key: 'mood', action: 'pet' },
  ];

  function pickMostNeeded(
    state: GameState,
    now: number,
    only?: readonly string[],
  ): { id: string; action: CareAction } | null {
    const cands: { id: string; action: CareAction; value: number }[] = [];
    for (const c of state.creatures) {
      if (c.life.stage === 'egg') continue;
      if (only && !only.includes(c.id)) continue;
      for (const m of NEED) cands.push({ id: c.id, action: m.action, value: c.life[m.key] });
    }
    cands.sort((a, b) => a.value - b.value);
    for (const cand of cands) {
      if (careAvailability(state, cand.id, cand.action, now).enabled) {
        return { id: cand.id, action: cand.action };
      }
    }
    return null;
  }

  const avgCare = (c: Creature): number =>
    (c.life.hunger + c.life.hydration + c.life.cleanliness + c.life.mood) / 4;

  const readyForBreeding = (c: Creature): boolean =>
    c.life.mood >= BREEDING.minMood && c.life.health >= BREEDING.minHealth;

  it('60〜90 秒に 1 回だけ 1 体を世話する遊び方でも、3 体が壊れず交配に届く', () => {
    const s = newGame('human-pace');
    rollEggChoices(s);
    expect(chooseEggs(s, s.pendingEggs!.slice(0, 3).map((e) => e.seed), T0).ok).toBe(true);

    // まず「まったく世話をしない」で 3 体を孵す。いちばん不利な入り方。
    let now = T0;
    for (let i = 0; i < 900 && creaturesByStage(s, 'juvenile').length < 3; i++) {
      now += 1000;
      applyTick(s, now);
    }
    expect(creaturesByStage(s, 'juvenile').length).toBe(3);
    const startedAt = now;

    const minHealth = new Map<string, number>();
    const minMood = new Map<string, number>();
    let ops = 0;
    let firstReadyMs: number | null = null;

    const track = (): void => {
      for (const c of s.creatures) {
        if (c.life.stage === 'egg') continue;
        minHealth.set(c.id, Math.min(minHealth.get(c.id) ?? 100, c.life.health));
        minMood.set(c.id, Math.min(minMood.get(c.id) ?? 100, c.life.mood));
      }
      if (firstReadyMs === null && s.creatures.filter(readyForBreeding).length >= 2) {
        firstReadyMs = now - startedAt;
      }
    };

    /** 60 / 75 / 90 秒 待って、1 体に 1 アクションだけ。待っているあいだも UI は tick を回す。 */
    const waits = [60_000, 75_000, 90_000];
    const playFor = (durationMs: number, only?: readonly string[]): void => {
      const until = now + durationMs;
      while (now < until) {
        const wait = waits[ops % waits.length]!;
        for (let t = 0; t < wait && now < until; t += 1000) {
          now += 1000;
          applyTick(s, now);
          track();
        }
        const pick = pickMostNeeded(s, now, only);
        if (pick) {
          expect(doCare(s, pick.id, pick.action, now).ok).toBe(true);
          ops++;
        }
        track();
      }
    };

    // ── 前半 15 分: ふつうの維持（いちばん困っている子を見る）──
    playFor(15 * 60 * 1000);
    const maintain = s.creatures.map((c) => ({ name: c.name, avg: avgCare(c), health: c.life.health }));

    // ── 後半 5 分: 「そろそろ交配したい」と思った人の遊び方 ──
    // 健康の高い 2 体に絞って世話をする（画面の案内もこの 2 体を指す）。
    const focus = s.creatures
      .slice()
      .sort((a, b) => b.life.health - a.life.health)
      .slice(0, 2)
      .map((c) => c.id);
    playFor(5 * 60 * 1000, focus);

    const rows = s.creatures.map((c) => {
      const h = minHealth.get(c.id) ?? 100;
      const m = minMood.get(c.id) ?? 100;
      return (
        `  ${c.name.padEnd(7)} ${c.life.stage.padEnd(8)} ` +
        `健康 最低${h.toFixed(1).padStart(5)} → 現在${c.life.health.toFixed(1).padStart(5)} / ` +
        `機嫌 最低${m.toFixed(1).padStart(5)} → 現在${c.life.mood.toFixed(1).padStart(5)} / ` +
        `おなか${c.life.hunger.toFixed(0).padStart(4)} みず${c.life.hydration.toFixed(0).padStart(4)} きれい${c.life.cleanliness.toFixed(0).padStart(4)}` +
        `${readyForBreeding(c) ? '  ← 交配できる' : ''}`
      );
    });
    const readyNow = s.creatures.filter(readyForBreeding).length;

    // eslint-disable-next-line no-console
    console.log(
      `
─── 人間らしい間欠プレイ 20 分（世話 ${ops} 回 ＝ 平均 ${(1200 / ops).toFixed(0)} 秒に 1 回）───
` +
        `${rows.join('\n')}
` +
        `  15 分時点の世話ゲージ平均: ${maintain.map((m) => `${m.name} ${m.avg.toFixed(0)}`).join(' / ')}
` +
        `  交配条件（機嫌≥${BREEDING.minMood}・健康≥${BREEDING.minHealth}）を満たす個体: ` +
        `最初にそろったのは ${firstReadyMs === null ? '—' : `${Math.round(firstReadyMs / 1000)} 秒`}、20 分後は ${readyNow} 体`,
    );

    // 1) どの個体の健康も 20 を下回らない。
    for (const c of s.creatures) {
      expect(minHealth.get(c.id)!, `${c.name} の健康が 20 を下回った`).toBeGreaterThanOrEqual(20);
    }
    // 2) 20 分後の時点で、交配できる個体が 2 体そろっている。
    expect(readyNow, '20 分 遊んでも交配条件を満たす 2 体がそろわない').toBeGreaterThanOrEqual(2);
    const pair = s.creatures.filter(readyForBreeding);
    s.unlocks = { nursery: true, exhibition: true, shop: true, breeding: true, collection: true, breeder: false, staff: false };
    s.coins = BREEDING.costCoins;
    const canB = canBreed(s, pair[0]!.id, pair[1]!.id);
    expect(canB.ok, `交配できない: ${canB.reason}`).toBe(true);

    // ── 追加検証 A: まったく世話をしないと どうなるか（世話に意味があること）──
    const beforeNeglect = s.creatures.map((c) => ({ avg: avgCare(c), health: c.life.health }));
    for (let t = 0; t < 30 * 60 * 1000; t += 1000) {
      now += 1000;
      applyTick(s, now);
    }
    const neglected = s.creatures.map((c) => ({ name: c.name, avg: avgCare(c), health: c.life.health }));
    for (let i = 0; i < neglected.length; i++) {
      expect(neglected[i]!.avg, '30 分放置してもゲージが落ちないなら世話に意味が無い').toBeLessThan(
        beforeNeglect[i]!.avg - 25,
      );
      expect(neglected[i]!.health, '放置で健康が下限を割った').toBeGreaterThanOrEqual(DECAY.healthFloor - 0.01);
    }

    // ── 追加検証 B: 戻ってきて世話をすれば、健康は取り戻せる ──
    const patient = s.creatures[0]!;
    const worst = patient.life.health;
    for (let round = 0; round < 12; round++) {
      const action = NEED[round % NEED.length]!.action;
      if (careAvailability(s, patient.id, action, now).enabled) doCare(s, patient.id, action, now);
      for (let t = 0; t < 30_000; t += 1000) {
        now += 1000;
        applyTick(s, now);
      }
    }
    const recovered = patient.life.health;

    // eslint-disable-next-line no-console
    console.log(
      `
─── 放置と回復 ───
` +
        neglected
          .map(
            (n, i) =>
              `  ${n.name.padEnd(7)} 30 分放置: 世話ゲージ平均 ${beforeNeglect[i]!.avg.toFixed(1)} → ${n.avg.toFixed(1)} / ` +
              `健康 ${beforeNeglect[i]!.health.toFixed(1)} → ${n.health.toFixed(1)}（下限 ${DECAY.healthFloor}）`,
          )
          .join('\n') +
        `
  そこから 6 分（世話 12 回）で ${patient.name} の健康: ${worst.toFixed(1)} → ${recovered.toFixed(1)}`,
    );

    expect(recovered, '世話を再開しても健康が戻らない').toBeGreaterThan(worst + 25);
  });
});

// ─────────────────────────────────────────────────────────
//  tick が止まっていても破綻しないこと
// ─────────────────────────────────────────────────────────

describe('applyTick を一度も呼ばない場合', () => {
  it('世話だけで 孵化 → 成体化 → 展示会 まで進み、案内も壊れない', () => {
    const s = newGame('no-tick');
    rollEggChoices(s);
    // 卵は 1 個だけ選べるように枠を絞る（世話の回数を現実的にするため）。
    s.capacity.egg = 1;
    expect(chooseEggs(s, [s.pendingEggs![0]!.seed], T0).ok).toBe(true);

    const c = s.creatures[0]!;
    let now = T0;
    let ops = 0;
    const rotate = (stage: 'egg' | 'juvenile'): CareAction[] =>
      careActionsFor(stage).filter((a) => a !== 'rest');

    // applyTick は一度も呼ばない。
    for (let i = 0; i < 400 && c.life.stage !== 'adult'; i++) {
      const acts = rotate(c.life.stage === 'egg' ? 'egg' : 'juvenile');
      const action = acts[i % acts.length]!;
      if (careAvailability(s, c.id, action, now).enabled) {
        doCare(s, c.id, action, now);
        ops++;
      }
      now += 4000;
      // どの時点でも案内が出ること。
      expect(nextObjective(s).text.length).toBeGreaterThan(0);
    }

    expect(c.life.stage).toBe('adult');
    // 解放は tick 任せにせず、canExhibit / runExhibition 側でも取り直される。
    const can = canExhibit(s, c.id, now);
    expect(can.ok, can.reason).toBe(true);
    const score = runExhibition(s, c.id, now);
    expect(score.coins).toBeGreaterThan(0);
    expect(s.unlocks.exhibition).toBe(true);
    expect(s.unlocks.shop).toBe(true);
    expect(buyItem(s, 'springWater').ok).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `\n[tick なし] 世話だけで 成体化まで ${ops} 操作 / 仮想 ${(now - T0) / 1000} 秒 → ` +
        `展示会 ${score.rank} ${score.total} 点・${score.coins} コイン、ショップ解放も成立`,
    );
  });
});

// ─────────────────────────────────────────────────────────
//  テスト 3: コイン不足
// ─────────────────────────────────────────────────────────

describe('ショップの拒否理由', () => {
  it('コイン不足・未解放・未入荷がそれぞれ分かる理由で返る', () => {
    const s = newGame('shop-reasons');

    // 未解放
    const locked = buyItem(s, 'springWater');
    expect(locked.ok).toBe(false);
    expect(locked.reason).toContain('解放');

    // 解放したがコインが無い
    s.unlocks.shop = true;
    s.stats.exhibitions = 1;
    s.coins = 10;
    const poor = buyItem(s, 'springWater');
    expect(poor.ok).toBe(false);
    expect(poor.reason).toContain('たりません');
    expect(poor.reason).toContain('25'); // 35 - 10

    // 展示会の回数が足りない商品
    const notYet = buyItem(s, 'sunfruitJam');
    expect(notYet.ok).toBe(false);
    expect(notYet.reason).toContain('入荷');

    // 買えるようにすると通る
    s.coins = 200;
    const ok = buyItem(s, 'springWater');
    expect(ok.ok, ok.reason).toBe(true);
    expect(s.coins).toBe(165);

    // 買い切りの装飾は二度買えない
    s.coins = 500;
    expect(buyItem(s, 'sunnyLamp').ok).toBe(true);
    const twice = buyItem(s, 'sunnyLamp');
    expect(twice.ok).toBe(false);
    expect(twice.reason).toContain('すでに');
    expect(availableItems(s).some((i) => i.id === 'sunnyLamp')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
//  テスト 9: nextObjective
// ─────────────────────────────────────────────────────────

describe('nextObjective', () => {
  it('あらゆる進行段階で、行き先つきの案内を返す', () => {
    const seen: string[] = [];
    const check = (state: GameState, label: string, screen?: string): void => {
      const obj = nextObjective(state);
      expect(obj.text.length, `${label} の案内が空`).toBeGreaterThan(0);
      expect(VALID_SCREENS, `${label} の画面 ID が不正: ${obj.screen}`).toContain(obj.screen);
      if (screen) expect(obj.screen, `${label}`).toBe(screen);
      seen.push(`${label.padEnd(24)} → [${obj.screen}] ${obj.text}`);
    };

    // 1) まっさら
    const s = newGame('objective');
    check(s, '個体なし', 'eggSelect');

    // 2) 卵候補を提示中
    rollEggChoices(s);
    check(s, '卵候補の提示中', 'eggSelect');

    // 3) 卵を持っている
    chooseEggs(s, s.pendingEggs!.slice(0, 3).map((e) => e.seed), T0);
    check(s, '卵を世話する段階', 'nursery');

    // 4) 危険な状態の子がいる
    s.creatures[0]!.life.hunger = 5;
    check(s, 'おなかが空いている', 'nursery');
    s.creatures[0]!.life.hunger = 80;

    // 5) 幼体
    let now = T0;
    for (let i = 0; i < 2; i++) {
      now += 300_000;
      applyTick(s, now);
    }
    expect(creaturesByStage(s, 'juvenile').length).toBe(3);
    check(s, '幼体を育てる段階', 'nursery');

    // 6) 成体（展示会 未実施）
    const s2 = newGame('objective-adult');
    const a = pushAdult(s2, 'obj-a', T0);
    applyTick(s2, T0 + 1000);
    check(s2, '成体・展示会 未実施', 'exhibition');

    // 7) 展示会のあと（ショップ解放）
    runExhibition(s2, a.id, T0 + 2000);
    check(s2, '初回展示会のあと', 'shop');

    // 8) 交配できる
    const b = pushAdult(s2, 'obj-b', T0);
    s2.coins = 500;
    s2.owned.push('sunnyLamp');
    applyTick(s2, T0 + 3000);
    expect(s2.unlocks.breeding).toBe(true);
    check(s2, '交配できる', 'breeding');

    // 9) 交配の条件が足りない（機嫌不足）
    b.life.mood = 10;
    const moodObj = nextObjective(s2);
    expect(moodObj.text.length).toBeGreaterThan(0);
    seen.push(`${'交配の条件不足'.padEnd(24)} → [${moodObj.screen}] ${moodObj.text}`);
    b.life.mood = 90;

    // 10) 枠が満杯で保留
    const s3 = newGame('objective-blocked');
    rollEggChoices(s3);
    chooseEggs(s3, s3.pendingEggs!.slice(0, 3).map((e) => e.seed), T0);
    s3.capacity.juvenile = 1;
    let n3 = T0;
    for (let i = 0; i < 2; i++) {
      n3 += 300_000;
      applyTick(s3, n3);
    }
    check(s3, '枠が満杯で保留', 'nursery');
    expect(nextObjective(s3).text).toContain('枠');

    // eslint-disable-next-line no-console
    console.log(['', '─── nextObjective の実測 ───', ...seen, ''].join('\n'));
  });
});
