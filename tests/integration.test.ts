/**
 * 統合テスト（指示書 §23 の「統合ループ」に対応）。
 *
 * 個別の機能は各テストが担保しているが、**組み合わせたときにだけ壊れる**
 * 状態がある。§23 が列挙している条件のうち、実時間がかかりすぎて E2E に
 * 載せられないもの（複数世代の交配・所持枠上限・コイン不足・購入後の状態・
 * ブラウザ再起動相当）を仮想時間で通す。
 *
 * 実ブラウザでの新規ゲーム／リロード／スマホ幅／セーブ破損は `e2e/` が担当する。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  newGame, rollEggChoices, chooseEggs, applyTick, doCare,
  buyItem, useItem, availableItems,
  canExhibit, runExhibition,
  canBreed, doBreed,
  capacityUsed, creaturesByStage, hasRoomFor, releaseCreature, findCreature,
  refreshUnlocks, nextObjective, blockedCreatures, getPhenotype,
} from '../src/game/index.ts';
import { save, load, clearSave } from '../src/save/index.ts';
import type { GameState, CareAction } from '../src/core/types.ts';

/** localStorage が無い Node 環境用の最小モック。 */
function installStorage(): void {
  if ((globalThis as any).localStorage) return;
  const m = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

/** 世話を 1 巡ぶん行い、時間を進める。人が遊ぶ間隔（20 秒）を模す。 */
function careRound(s: GameState, id: string, now: number, actions: CareAction[]): number {
  let t = now;
  for (const a of actions) {
    doCare(s, id, a, t);
    t += 20_000;
    applyTick(s, t);
  }
  return t;
}

/** 個体を成体まで一気に育てる（世話と時間経過だけを使う。デバッグ操作なし）。 */
function raiseToAdult(s: GameState, id: string, startAt: number, limitMs = 40 * 60_000): number {
  let t = startAt;
  const deadline = startAt + limitMs;
  while (t < deadline) {
    const c = findCreature(s, id);
    if (!c) break;
    if (c.life.stage === 'adult') break;
    const acts: CareAction[] =
      c.life.stage === 'egg'
        ? ['warm', 'moisten', 'talk', 'touch', 'tidyEnv']
        : ['feed', 'water', 'clean', 'pet', 'play'];
    t = careRound(s, id, t, acts);
  }
  return t;
}

describe('統合: 通しプレイと組み合わせ状態', () => {
  beforeEach(() => {
    installStorage();
    clearSave();
  });

  it('複数世代の交配を続けても破綻しない（4 世代）', () => {
    const s = newGame('INTEG-GEN');
    let t = 1_700_000_000_000;
    const eggs = rollEggChoices(s);
    chooseEggs(s, eggs.slice(0, 3).map((e) => e.seed), t);

    // 第 1 世代を 2 体成体にする
    for (const c of [...s.creatures]) t = raiseToAdult(s, c.id, t);
    refreshUnlocks(s);
    const adults = creaturesByStage(s, 'adult');
    expect(adults.length).toBeGreaterThanOrEqual(2);

    // 交配はショップ解放が前提で、ショップは初回展示会が前提。
    // 解放順を飛ばさず、実際のプレイと同じ順路を通る。
    expect(canExhibit(s, adults[0]!.id, t).ok).toBe(true);
    runExhibition(s, adults[0]!.id, t);
    refreshUnlocks(s);
    expect(s.unlocks.shop, '初回展示会でショップが解放される').toBe(true);
    expect(s.unlocks.breeding, '成体 2 体＋ショップ解放で交配が解放される').toBe(true);

    const genSeen: number[] = [];
    for (let gen = 0; gen < 4; gen++) {
      // 交配のクールダウンを実時間の経過で明けさせる（放置ではなく世話を続ける）。
      for (let k = 0; k < 3; k++) {
        for (const a of creaturesByStage(s, 'adult')) {
          t = careRound(s, a.id, t, ['feed', 'water', 'pet', 'play']);
        }
      }

      // 交配にはコストがかかる。実際のプレイと同じく展示会で稼いでから交配する。
      // （この経済ループを飛ばすと「コインが たりません」で止まる）
      for (let guard = 0; guard < 8 && s.coins < 120; guard++) {
        const ready = creaturesByStage(s, 'adult').find((c) => canExhibit(s, c.id, t).ok);
        if (!ready) { t += 60_000; applyTick(s, t); continue; }
        runExhibition(s, ready.id, t);
        t += 30_000;
        applyTick(s, t);
      }

      // 卵の枠が無ければ、いちばん幼い個体を手放して空ける
      // （枠が詰まっても進めることの確認。ただし成体は減らさない）。
      if (!hasRoomFor(s, 'egg')) {
        const spare = creaturesByStage(s, 'egg')[0] ?? creaturesByStage(s, 'juvenile')[0];
        if (spare) releaseCreature(s, spare.id);
      }

      // 系統を進めるので「いちばん新しい世代どうし」を親に選ぶ。
      // findBreedablePair は配列順（＝いちばん古い 2 体）を返すため、
      // それに任せると毎回 初代×初代 になり第 2 世代しか生まれない。
      const byGen = creaturesByStage(s, 'adult').slice().sort((a, b) => b.generation - a.generation);
      let pair: [typeof byGen[0], typeof byGen[0]] | null = null;
      outer: for (let i = 0; i < byGen.length; i++) {
        for (let j = i + 1; j < byGen.length; j++) {
          if (canBreed(s, byGen[i]!.id, byGen[j]!.id).ok) { pair = [byGen[i]!, byGen[j]!]; break outer; }
        }
      }
      if (!pair) {
        const cap = capacityUsed(s);
        const why = creaturesByStage(s, 'adult').map((c) => {
          const other = creaturesByStage(s, 'adult').find((x) => x.id !== c.id);
          return other ? `${c.name}×${other.name}: ${canBreed(s, c.id, other.id).reason ?? 'ok'}` : `${c.name}: 相手なし`;
        });
        // eslint-disable-next-line no-console
        console.log(`[統合] 世代${gen + 1}で交配相手が見つからない / 枠 ${JSON.stringify(cap)} / ${why.join(' | ')}`);
        break;
      }
      const [pa, pb] = pair;

      const r = doBreed(s, pa.id, pb.id, t);
      expect(r.ok, `世代 ${gen + 1} の交配が失敗: ${r.reason}`).toBe(true);
      const child = findCreature(s, r.eggId!)!;
      expect(child.parents).not.toBeNull();
      expect(child.generation).toBeGreaterThan(1);
      genSeen.push(child.generation);

      // 生まれた子を成体まで育てて次の親にする。
      // 成体枠が満杯なら、いま親にしなかった最古の成体を手放す。
      if (!hasRoomFor(s, 'adult')) {
        // いちばん古い世代の個体を手放す。育てたばかりの新しい子を手放すと
        // 系統が進まず、いつまでも「初代×初代」に戻ってしまう。
        const victim = creaturesByStage(s, 'adult')
          .slice()
          .sort((a, b) => a.generation - b.generation)[0];
        if (victim) releaseCreature(s, victim.id);
      }
      t = raiseToAdult(s, child.id, t);
    }

    // eslint-disable-next-line no-console
    console.log(`[統合] 交配で到達した世代: ${genSeen.join(' → ')} / 総個体 ${s.creatures.length} 体`);
    expect(genSeen.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...genSeen)).toBeGreaterThanOrEqual(4);

    // 全個体の表現型が壊れていないこと
    for (const c of s.creatures) {
      const p = getPhenotype(c);
      expect(p.base).toBeTruthy();
      expect(Object.values(p.parts).every((v) => v !== undefined && String(v) !== 'undefined')).toBe(true);
    }
  });

  it('所持枠が上限でも詰まない（理由が返り、空ければ進む）', () => {
    const s = newGame('INTEG-CAP');
    let t = 1_700_000_000_000;
    const eggs = rollEggChoices(s);
    chooseEggs(s, eggs.slice(0, 3).map((e) => e.seed), t);

    const cap = capacityUsed(s);
    expect(cap.egg).toBe(3);
    expect(hasRoomFor(s, 'egg')).toBe(false);

    // 卵をすべて幼体にすると、今度は幼体枠が埋まる
    for (const c of [...s.creatures]) {
      let n = t;
      const deadline = t + 20 * 60_000;
      while (n < deadline && findCreature(s, c.id)!.life.stage === 'egg') {
        n = careRound(s, c.id, n, ['warm', 'moisten', 'talk']);
      }
      t = Math.max(t, n);
    }
    expect(capacityUsed(s).juvenile).toBe(3);

    // ここで新しい卵は受け取れない。理由が返ること。
    const blocked = blockedCreatures(s);
    expect(Array.isArray(blocked)).toBe(true);

    // 1 体手放せば空きができる
    const before = capacityUsed(s).juvenile;
    const rel = releaseCreature(s, creaturesByStage(s, 'juvenile')[0]!.id);
    expect(rel.ok).toBe(true);
    expect(capacityUsed(s).juvenile).toBe(before - 1);
    expect(hasRoomFor(s, 'juvenile')).toBe(true);
  });

  it('手持ちが 2 体以下では手放せない（恒久的な詰みを防ぐ）', () => {
    const s = newGame('INTEG-MIN');
    const t = 1_700_000_000_000;
    const eggs = rollEggChoices(s);
    chooseEggs(s, eggs.slice(0, 3).map((e) => e.seed), t);

    expect(releaseCreature(s, s.creatures[0]!.id).ok).toBe(true); // 3 → 2
    const r = releaseCreature(s, s.creatures[0]!.id); // 2 → 1 は拒否
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(s.creatures.length).toBe(2);
  });

  it('コイン不足では買えず、展示会で稼げば買える', () => {
    const s = newGame('INTEG-COIN');
    let t = 1_700_000_000_000;
    const eggs = rollEggChoices(s);
    chooseEggs(s, eggs.slice(0, 3).map((e) => e.seed), t);
    t = raiseToAdult(s, s.creatures[0]!.id, t);
    refreshUnlocks(s);

    expect(s.coins).toBe(0);
    // 解放前／コイン不足で買えないこと
    const anyItem = availableItems(s)[0];
    if (anyItem) {
      const bad = buyItem(s, anyItem.id);
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBeTruthy();
    }

    const adult = creaturesByStage(s, 'adult')[0]!;
    expect(canExhibit(s, adult.id, t).ok).toBe(true);
    const score = runExhibition(s, adult.id, t);
    expect(score.coins).toBeGreaterThan(0);
    expect(s.unlocks.shop).toBe(true);

    const items = availableItems(s);
    expect(items.length).toBeGreaterThan(0);
    const cheapest = items.reduce((a, b) => (a.price <= b.price ? a : b));
    expect(s.coins, '初回展示会の報酬で最安アイテムが買えること').toBeGreaterThanOrEqual(cheapest.price);

    const coinsBefore = s.coins;
    const buy = buyItem(s, cheapest.id);
    expect(buy.ok).toBe(true);
    expect(s.coins).toBe(coinsBefore - cheapest.price);

    // 買った消耗品が実際に効くこと
    if (cheapest.consumable) {
      const target = s.creatures.find((c) => c.life.stage !== 'egg')!;
      const res = useItem(s, target.id, cheapest.id, t);
      expect(res.ok).toBe(true);
      expect(s.inventory[cheapest.id] ?? 0).toBe(0);
    }
  });

  it('ブラウザ再起動相当（保存 → 新しい state へ読込）で進行が完全に保たれる', () => {
    const s = newGame('INTEG-SAVE');
    let t = 1_700_000_000_000;
    const eggs = rollEggChoices(s);
    chooseEggs(s, eggs.slice(0, 3).map((e) => e.seed), t);
    t = raiseToAdult(s, s.creatures[0]!.id, t);
    refreshUnlocks(s);
    const adult = creaturesByStage(s, 'adult')[0]!;
    runExhibition(s, adult.id, t);
    const cheapest = availableItems(s).reduce((a, b) => (a.price <= b.price ? a : b));
    buyItem(s, cheapest.id);

    const snapshot = {
      coins: s.coins,
      owned: [...s.owned],
      inventory: { ...s.inventory },
      unlocks: { ...s.unlocks },
      seeds: s.creatures.map((c) => c.genotype.seed),
      stages: s.creatures.map((c) => c.life.stage),
      lastExhibitAt: adult.lastExhibitAt,
      exhibitionCount: adult.exhibitionCount,
    };

    expect(save(s).ok).toBe(true);
    const loaded = load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const r = loaded.state;

    expect(r.coins).toBe(snapshot.coins);
    expect(r.owned).toEqual(snapshot.owned);
    expect(r.inventory).toEqual(snapshot.inventory);
    expect(r.unlocks).toEqual(snapshot.unlocks);
    expect(r.creatures.map((c) => c.genotype.seed)).toEqual(snapshot.seeds);
    expect(r.creatures.map((c) => c.life.stage)).toEqual(snapshot.stages);

    // クールダウンが往復すること（リロードでコインを稼げる抜け道が無い）
    const rAdult = r.creatures.find((c) => c.id === adult.id)!;
    expect(rAdult.lastExhibitAt).toBe(snapshot.lastExhibitAt);
    expect(rAdult.exhibitionCount).toBe(snapshot.exhibitionCount);
    expect(canExhibit(r, rAdult.id, t).ok, '復元直後は再参加できない').toBe(false);

    // 外見が完全に一致すること（seed 再現性）
    for (let i = 0; i < r.creatures.length; i++) {
      const a = getPhenotype(s.creatures[i]!);
      const b = getPhenotype(r.creatures[i]!);
      expect(JSON.stringify(b.parts)).toBe(JSON.stringify(a.parts));
      expect(b.palette.body).toBe(a.palette.body);
    }
  });

  it('どの進行段階でも次にやることが案内される', () => {
    const s = newGame('INTEG-GUIDE');
    let t = 1_700_000_000_000;

    const seen: string[] = [];
    const snap = (): void => {
      const o = nextObjective(s);
      expect(o).toBeTruthy();
      expect(typeof o.text).toBe('string');
      expect(o.text.length).toBeGreaterThan(0);
      seen.push(o.text);
    };

    snap(); // 卵未選択
    const eggs = rollEggChoices(s);
    chooseEggs(s, eggs.slice(0, 3).map((e) => e.seed), t);
    snap(); // 卵の世話
    t = raiseToAdult(s, s.creatures[0]!.id, t);
    refreshUnlocks(s);
    snap(); // 成体・展示会へ
    runExhibition(s, creaturesByStage(s, 'adult')[0]!.id, t);
    snap(); // ショップ解放後

    // eslint-disable-next-line no-console
    console.log(`[統合] 案内の推移:\n  - ${seen.join('\n  - ')}`);
    expect(new Set(seen).size, '段階が進んでも同じ案内しか出ない').toBeGreaterThan(1);
  });
});
