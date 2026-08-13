/**
 * マイグレーションのテスト。
 *
 * v1 / v2 は実際には出荷されていない仮想的な旧形式だが、
 * 「マイグレーション機構が実際に動く」ことを証明するために実データを作って検証する（指示書 §27）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { SAVE_VERSION } from '../src/core/types.ts';
import {
  OLDEST_SUPPORTED_VERSION,
  SAVE_KEY,
  __writeRawForTest,
  createNewGameState,
  detectVersion,
  load,
  migrate,
  resetStorageCache,
  save,
  validateState,
} from '../src/save/index.ts';
import { BREEDING, CAPACITY_DEFAULT, EXHIBITION } from '../src/game/config.ts';

// ─────────────────────────────────────────────────────────
//  localStorage モック
// ─────────────────────────────────────────────────────────

function installMockStorage(): void {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    get length() {
      return m.size;
    },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
  };
  resetStorageCache();
}

beforeEach(() => {
  installMockStorage();
});

// ─────────────────────────────────────────────────────────
//  仮想的な旧形式のフィクスチャ
// ─────────────────────────────────────────────────────────

const GENOTYPE = {
  seed: 'AB12-CD34',
  cat: {
    base: ['maru', 'slime'],
    eyeCount: ['two', 'one'],
    plant: ['none', 'leaf'],
  },
  num: {
    size: [0.51, 0.62],
    hue: [0.31, 0.42],
  },
};

/**
 * v3 以前の個体。lastExhibitAt / lastBredAt を「持たない」ことがこのフィクスチャの要点。
 * v4 のマイグレーションが実際にこの欠落を埋めることを検証する。
 */
function oldCreature(id: string, stage: 'egg' | 'juvenile' | 'adult') {
  return {
    id,
    seed: 'AB12-CD34',
    name: 'はつみどり',
    genotype: GENOTYPE,
    life: {
      stage,
      ageMs: 300_000,
      growth: stage === 'adult' ? 100 : 55,
      hunger: 66,
      hydration: 58,
      cleanliness: 81,
      mood: 74,
      health: 92,
      hatchProgress: stage === 'egg' ? 42 : 100,
      careCount: 21,
      lastCareAt: { feed: 1_700_000_000_000 },
      lastTickAt: 1_700_000_005_000,
      restingUntil: 0,
    },
    parents: null,
    parentNames: null,
    generation: 1,
    bornAt: 1_699_000_000_000,
    bestScore: 64,
    exhibitionCount: 2,
    favorite: true,
    fromBreeding: false,
  };
}

/**
 * v1 の仮想セーブ。
 *   - coins が無く money という名前だった
 *   - capacity が無く固定だった
 *   - unlocks.collection も future も無い（v2 の追加分より前なので当然無い）
 */
function makeV1Save() {
  return {
    version: 1,
    savedAt: 1_700_000_010_000,
    checksum: 'legacy-v1',
    state: {
      version: 1,
      createdAt: 1_699_000_000_000,
      updatedAt: 1_700_000_010_000,
      seedCounter: 4,
      worldSeed: 'w-legacy-1',
      money: 250, // ← v1 の名前
      creatures: [oldCreature('old-1', 'adult')],
      pendingEggs: null,
      inventory: { honeyMossBall: 2 },
      owned: ['sunnyLamp'],
      unlocks: { nursery: true, exhibition: true, shop: true, breeding: false },
      // capacity は存在しない
      settings: { volume: 0.5, muted: false, reducedMotion: false, skipCutscenes: false },
      tutorial: { done: ['chooseEgg'], current: null },
      stats: { hatched: 1, grownUp: 1, bred: 0, exhibitions: 2, coinsEarned: 250, careActions: 40 },
      activeCreatureId: 'old-1',
      // future は存在しない
    },
  };
}

/**
 * v2 の仮想セーブ。
 *   - money → coins の改名は済んでいる / capacity もある
 *   - unlocks.collection が無い
 *   - future が無い
 */
function makeV2Save() {
  return {
    version: 2,
    savedAt: 1_700_000_020_000,
    checksum: 'legacy-v2',
    state: {
      version: 2,
      createdAt: 1_699_500_000_000,
      updatedAt: 1_700_000_020_000,
      seedCounter: 7,
      worldSeed: 'w-legacy-2',
      coins: 480,
      creatures: [oldCreature('old-2', 'juvenile'), oldCreature('old-3', 'adult')],
      pendingEggs: null,
      inventory: {},
      owned: [],
      unlocks: { nursery: true, exhibition: true, shop: true, breeding: true },
      capacity: { egg: 4, juvenile: 3, adult: 3 },
      settings: { volume: 0.9, muted: true, reducedMotion: true, skipCutscenes: false },
      tutorial: { done: ['chooseEgg', 'firstCare'], current: 'firstBreeding' },
      stats: { hatched: 3, grownUp: 2, bred: 1, exhibitions: 5, coinsEarned: 900, careActions: 120 },
      activeCreatureId: 'old-3',
      // future は存在しない
    },
  };
}

/**
 * v3 の実セーブ。
 *   - coins / capacity / unlocks.collection / future はすべて揃っている
 *   - Creature に lastExhibitAt / lastBredAt が無い ← v4 で追加された実際の差分
 */
function makeV3Save() {
  return {
    version: 3,
    savedAt: 1_700_000_030_000,
    checksum: 'legacy-v3',
    state: {
      version: 3,
      createdAt: 1_699_800_000_000,
      updatedAt: 1_700_000_030_000,
      seedCounter: 9,
      worldSeed: 'w-legacy-3',
      coins: 610,
      creatures: [oldCreature('old-4', 'adult'), oldCreature('old-5', 'adult')],
      pendingEggs: null,
      inventory: { evergreenTonic: 1 },
      owned: ['sunnyLamp', 'specimenShelf'],
      unlocks: { nursery: true, exhibition: true, shop: true, breeding: true, collection: true },
      capacity: { egg: 3, juvenile: 3, adult: 4 },
      settings: { volume: 0.6, muted: false, reducedMotion: false, skipCutscenes: true },
      tutorial: { done: ['chooseEgg', 'firstCare', 'firstExhibition'], current: null },
      stats: { hatched: 5, grownUp: 4, bred: 2, exhibitions: 8, coinsEarned: 1400, careActions: 260 },
      activeCreatureId: 'old-4',
      future: { marketListings: [], tradeHistory: [], rankingCache: null },
    },
  };
}

// ─────────────────────────────────────────────────────────
//  v1 → v4
// ─────────────────────────────────────────────────────────

describe('v1 からのマイグレーション', () => {
  it('現行バージョン（v4）になり、validateState を通る', () => {
    const r = migrate(makeV1Save());
    expect(r).not.toBeNull();
    expect(r!.from).toBe(1);
    expect(r!.state.version).toBe(SAVE_VERSION);

    const v = validateState(r!.state);
    expect(v.ok, v.ok ? '' : v.errors.join(' / ')).toBe(true);
  });

  it('v1 → v2 → v3 → v4 の全段を通過し、各段の差分がすべて反映される', () => {
    const r = migrate(makeV1Save())!;
    // v1→v2 の差分
    expect(r.state.coins).toBe(250);
    expect(r.state.capacity).toEqual(CAPACITY_DEFAULT);
    // v2→v3 の差分
    expect(r.state.unlocks.collection).toBe(true);
    expect(r.state.future).toEqual({ marketListings: [], tradeHistory: [], rankingCache: null });
    // v3→v4 の差分
    for (const c of r.state.creatures) {
      expect(c.lastExhibitAt).toBe(0);
      expect(c.lastBredAt).toBe(0);
    }
    expect(r.state.version).toBe(SAVE_VERSION);
  });

  it('money が coins へ引き継がれ、money は残らない', () => {
    const r = migrate(makeV1Save())!;
    expect(r.state.coins).toBe(250);
    expect((r.state as unknown as Record<string, unknown>)['money']).toBeUndefined();
  });

  it('欠けていた capacity が既定値で補われる', () => {
    const r = migrate(makeV1Save())!;
    expect(r.state.capacity).toEqual(CAPACITY_DEFAULT);
  });

  it('欠けていた unlocks.collection と future が補われる', () => {
    const r = migrate(makeV1Save())!;
    // 成体がいるセーブなので標本帳は開いていたはず、と推定して true になる。
    expect(r.state.unlocks.collection).toBe(true);
    expect(r.state.future).toEqual({ marketListings: [], tradeHistory: [], rankingCache: null });
  });

  it('既存のデータが失われていない', () => {
    const r = migrate(makeV1Save())!;
    expect(r.state.worldSeed).toBe('w-legacy-1');
    expect(r.state.seedCounter).toBe(4);
    expect(r.state.creatures).toHaveLength(1);
    expect(r.state.creatures[0]!.id).toBe('old-1');
    expect(r.state.creatures[0]!.name).toBe('はつみどり');
    expect(r.state.creatures[0]!.genotype.cat).toEqual(GENOTYPE.cat);
    expect(r.state.creatures[0]!.life.stage).toBe('adult');
    expect(r.state.creatures[0]!.favorite).toBe(true);
    expect(r.state.inventory).toEqual({ honeyMossBall: 2 });
    expect(r.state.owned).toEqual(['sunnyLamp']);
    expect(r.state.settings.volume).toBe(0.5);
    expect(r.state.stats.exhibitions).toBe(2);
    expect(r.state.activeCreatureId).toBe('old-1');
  });

  it('卵しかいない v1 では collection が false のままになる', () => {
    const raw = makeV1Save();
    raw.state.creatures = [oldCreature('egg-1', 'egg')];
    raw.state.activeCreatureId = 'egg-1';
    const r = migrate(raw)!;
    expect(r.state.unlocks.collection).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
//  v2 → v3
// ─────────────────────────────────────────────────────────

describe('v2 からのマイグレーション', () => {
  it('現行バージョン（v4）になり、validateState を通る', () => {
    const r = migrate(makeV2Save());
    expect(r).not.toBeNull();
    expect(r!.from).toBe(2);
    expect(r!.state.version).toBe(SAVE_VERSION);

    const v = validateState(r!.state);
    expect(v.ok, v.ok ? '' : v.errors.join(' / ')).toBe(true);
  });

  it('unlocks.collection と future が追加される', () => {
    const r = migrate(makeV2Save())!;
    expect(r.state.unlocks.collection).toBe(true);
    expect(r.state.future).toEqual({ marketListings: [], tradeHistory: [], rankingCache: null });
  });

  it('v2 で既にあった capacity は上書きされない', () => {
    const r = migrate(makeV2Save())!;
    expect(r.state.capacity).toEqual({ egg: 4, juvenile: 3, adult: 3 });
  });

  it('coins と個体が保持される', () => {
    const r = migrate(makeV2Save())!;
    expect(r.state.coins).toBe(480);
    expect(r.state.creatures.map((c) => c.id)).toEqual(['old-2', 'old-3']);
    expect(r.state.settings.muted).toBe(true);
    expect(r.state.tutorial.current).toBe('firstBreeding');
  });
});

// ─────────────────────────────────────────────────────────
//  v3 → v4（実際に発生したスキーマ変更）
// ─────────────────────────────────────────────────────────

describe('v3 からのマイグレーション（クールダウンの保存対応）', () => {
  it('v4 になり、validateState を通る', () => {
    const r = migrate(makeV3Save());
    expect(r).not.toBeNull();
    expect(r!.from).toBe(3);
    expect(r!.state.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(7);

    const v = validateState(r!.state);
    expect(v.ok, v.ok ? '' : v.errors.join(' / ')).toBe(true);
  });

  it('v3 の個体には lastExhibitAt / lastBredAt が存在しない（前提の確認）', () => {
    // フィクスチャが本当に「欠落している旧形式」であることを保証する。
    // ここが崩れると、以降のテストが何も検証しなくなる。
    for (const c of makeV3Save().state.creatures) {
      expect('lastExhibitAt' in c).toBe(false);
      expect('lastBredAt' in c).toBe(false);
    }
    // v3 のままでは検証を通らないこと＝マイグレーションが必須であること。
    expect(validateState(makeV3Save().state).ok).toBe(false);
  });

  it('全個体に lastExhibitAt / lastBredAt が 0 で補われる', () => {
    const r = migrate(makeV3Save())!;
    expect(r.state.creatures).toHaveLength(2);
    for (const c of r.state.creatures) {
      expect(c.lastExhibitAt).toBe(0);
      expect(c.lastBredAt).toBe(0);
    }
  });

  it('0 埋めなので、旧セーブのプレイヤーが身に覚えのない待ち時間を課されない', () => {
    const r = migrate(makeV3Save())!;
    const now = Date.now();
    for (const c of r.state.creatures) {
      // 経過時間 = now - 0 は巨大な値になり、どんなクールダウンも明けている扱いになる。
      expect(now - c.lastExhibitAt).toBeGreaterThan(EXHIBITION.cooldownMs);
      expect(now - c.lastBredAt).toBeGreaterThan(BREEDING.cooldownMs);
    }
  });

  it('既に値を持つ個体は上書きされない（v4 同士の再適用でも壊れない）', () => {
    const raw = makeV3Save();
    (raw.state.creatures[0] as unknown as Record<string, unknown>)['lastExhibitAt'] = 1_700_000_029_000;
    (raw.state.creatures[0] as unknown as Record<string, unknown>)['lastBredAt'] = 1_700_000_028_000;

    const r = migrate(raw)!;
    expect(r.state.creatures[0]!.lastExhibitAt).toBe(1_700_000_029_000);
    expect(r.state.creatures[0]!.lastBredAt).toBe(1_700_000_028_000);
    // 持っていなかった 2 体目は 0 のまま。
    expect(r.state.creatures[1]!.lastExhibitAt).toBe(0);
  });

  it('壊れた値（NaN・文字列）が入っていても 0 に正規化される', () => {
    const raw = makeV3Save();
    (raw.state.creatures[0] as unknown as Record<string, unknown>)['lastExhibitAt'] = 'きのう';
    (raw.state.creatures[1] as unknown as Record<string, unknown>)['lastBredAt'] = NaN;

    const r = migrate(raw)!;
    expect(r.state.creatures[0]!.lastExhibitAt).toBe(0);
    expect(r.state.creatures[1]!.lastBredAt).toBe(0);
    expect(validateState(r.state).ok).toBe(true);
  });

  it('v3 の他のデータは一切失われない', () => {
    const r = migrate(makeV3Save())!;
    expect(r.state.coins).toBe(610);
    expect(r.state.worldSeed).toBe('w-legacy-3');
    expect(r.state.seedCounter).toBe(9);
    expect(r.state.capacity).toEqual({ egg: 3, juvenile: 3, adult: 4 });
    expect(r.state.owned).toEqual(['sunnyLamp', 'specimenShelf']);
    expect(r.state.inventory).toEqual({ evergreenTonic: 1 });
    expect(r.state.settings.skipCutscenes).toBe(true);
    expect(r.state.stats.exhibitions).toBe(8);
    expect(r.state.activeCreatureId).toBe('old-4');
    expect(r.state.creatures.map((c) => c.id)).toEqual(['old-4', 'old-5']);
    expect(r.state.creatures[0]!.exhibitionCount).toBe(2);
    expect(r.state.creatures[0]!.bestScore).toBe(64);
  });

  it('個体が 0 体の v3 でも落ちない', () => {
    const raw = makeV3Save();
    raw.state.creatures = [];
    // フィクスチャは string 型に推論されるため、null を入れるには明示的に緩める。
    (raw.state as { activeCreatureId: string | null }).activeCreatureId = null;
    const r = migrate(raw)!;
    expect(r.state.creatures).toEqual([]);
    expect(validateState(r.state).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
//  現行 / 未来 / 異常系
// ─────────────────────────────────────────────────────────

describe('バージョンの取り扱い', () => {
  it('detectVersion が封筒と裸 state の両方を読める', () => {
    expect(detectVersion(makeV1Save())).toBe(1);
    expect(detectVersion(makeV2Save().state)).toBe(2);
    expect(detectVersion({})).toBeNull();
    expect(detectVersion(null)).toBeNull();
    expect(detectVersion('x')).toBeNull();
  });

  it('現行バージョンはそのまま通る（from = 現行）', () => {
    const state = createNewGameState('w-current');
    const r = migrate({ version: SAVE_VERSION, savedAt: Date.now(), checksum: 'x', state });
    expect(r).not.toBeNull();
    expect(r!.from).toBe(SAVE_VERSION);
    expect(validateState(r!.state).ok).toBe(true);
  });

  it('封筒なしの裸 state でもマイグレーションできる', () => {
    const r = migrate(makeV1Save().state);
    expect(r).not.toBeNull();
    expect(r!.from).toBe(1);
    expect(r!.state.coins).toBe(250);
  });

  it('未来バージョン（99）は null を返す', () => {
    expect(migrate({ version: 99, state: { version: 99, coins: 1 } })).toBeNull();
    expect(migrate({ version: SAVE_VERSION + 1, state: {} })).toBeNull();
  });

  it('サポート外の古すぎるバージョンは null を返す', () => {
    expect(migrate({ version: 0, state: {} })).toBeNull();
    expect(migrate({ version: OLDEST_SUPPORTED_VERSION - 1, state: {} })).toBeNull();
  });

  it('バージョン不明・非オブジェクトは null を返す（例外を投げない）', () => {
    expect(() => migrate(null)).not.toThrow();
    expect(migrate(null)).toBeNull();
    expect(migrate('セーブ')).toBeNull();
    expect(migrate([])).toBeNull();
    expect(migrate({})).toBeNull();
    expect(migrate({ version: 'いち' })).toBeNull();
  });

  it('中身がほぼ空の v1 でも起動できる state になる', () => {
    const r = migrate({ version: 1, state: { version: 1 } });
    expect(r).not.toBeNull();
    expect(validateState(r!.state).ok).toBe(true);
    expect(r!.state.capacity).toEqual(CAPACITY_DEFAULT);
    expect(r!.state.unlocks.nursery).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
//  storage 経由の統合
// ─────────────────────────────────────────────────────────

describe('load() 経由のマイグレーション', () => {
  it('保存済みの v1 セーブが load でそのまま v4 として読める', () => {
    __writeRawForTest(SAVE_KEY, JSON.stringify(makeV1Save()));

    const r = load();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('load に失敗した');
    expect(r.migratedFrom).toBe(1);
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.coins).toBe(250);
    expect(validateState(r.state).ok).toBe(true);
  });

  it('保存済みの v2 セーブが load でそのまま v4 として読める', () => {
    __writeRawForTest(SAVE_KEY, JSON.stringify(makeV2Save()));

    const r = load();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('load に失敗した');
    expect(r.migratedFrom).toBe(2);
    expect(r.state.unlocks.collection).toBe(true);
  });

  it('保存済みの v3 セーブが load で v4 になり、クールダウンが保存される状態になる', () => {
    __writeRawForTest(SAVE_KEY, JSON.stringify(makeV3Save()));

    const r = load();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('load に失敗した');
    expect(r.migratedFrom).toBe(3);
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.coins).toBe(610);
    for (const c of r.state.creatures) {
      expect(c.lastExhibitAt).toBe(0);
      expect(c.lastBredAt).toBe(0);
    }
    expect(validateState(r.state).ok).toBe(true);
  });

  it('v3 → v4 の移行後、保存し直すとクールダウンが往復する（抜け道が塞がる）', () => {
    __writeRawForTest(SAVE_KEY, JSON.stringify(makeV3Save()));

    const first = load();
    if (!first.ok) throw new Error('load に失敗した');

    // 展示会に参加した想定でクールダウンを刻み、保存する。
    const now = 1_800_000_000_000;
    first.state.creatures[0]!.lastExhibitAt = now;
    first.state.creatures[0]!.lastBredAt = now - 1000;
    expect(save(first.state)).toEqual({ ok: true });

    // リロード相当。以前は Map に置いていたためここで消えていた。
    const second = load();
    if (!second.ok) throw new Error('再 load に失敗した');
    expect(second.state.creatures[0]!.lastExhibitAt).toBe(now);
    expect(second.state.creatures[0]!.lastBredAt).toBe(now - 1000);
    expect(second.migratedFrom).toBeUndefined(); // 既に v4 なので再マイグレーションは起きない
  });

  it('未来バージョンのセーブでも load が例外を投げず、呼び出し側は新規開始できる', () => {
    __writeRawForTest(SAVE_KEY, JSON.stringify({ version: 99, savedAt: 1, checksum: 'x', state: { version: 99 } }));

    let r!: ReturnType<typeof load>;
    expect(() => {
      r = load();
    }).not.toThrow();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('未来バージョンが ok になった');
    expect(r.reason).toBe('corrupt');

    // 起動不能にならないこと＝ここから新規ゲームを始められること。
    const fresh = createNewGameState('after-future-version');
    expect(validateState(fresh).ok).toBe(true);
  });

  it('壊れた v1 が本体にあり、健全な v1 がバックアップにあれば復旧する', () => {
    const good = JSON.stringify(makeV1Save());
    __writeRawForTest(SAVE_KEY, good.slice(0, 50)); // 途中で切れた v1
    __writeRawForTest('genomon.save.backup', good);

    const r = load();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('復旧できなかった');
    expect(r.usedBackup).toBe(true);
    expect(r.migratedFrom).toBe(1);
    expect(r.state.coins).toBe(250);
  });
});
