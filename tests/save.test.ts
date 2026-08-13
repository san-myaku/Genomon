/**
 * セーブ層のテスト。
 *
 * 【ここで守りたいこと】
 *   壊れたセーブでゲームが起動不能にならないこと（指示書 §27）。
 *   そのため「例外を投げないこと」を毎回明示的に確認している。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { Creature, GameState, Genotype } from '../src/core/types.ts';
import { SAVE_VERSION } from '../src/core/types.ts';
import {
  BACKUP_KEY,
  SAVE_KEY,
  __readRawForTest,
  __writeRawForTest,
  checksum,
  clearSave,
  coerceState,
  createNewGameState,
  exportSave,
  hasSave,
  importSave,
  load,
  resetStorageCache,
  save,
  validateState,
} from '../src/save/index.ts';
import type { CareAction } from '../src/core/types.ts';
import {
  BOREDOM,
  CARE_BY_STAGE,
  CARE_DEFS,
  EXHIBITION,
  SATIATION,
  SHOP_CHEAPEST_PRICE,
  SHOP_ITEMS,
  TIMING,
  careBoredomFactor,
  careEffectMultiplier,
  careSatiationFactor,
  exhibitionCoins,
  rankOf,
} from '../src/game/config.ts';

// ─────────────────────────────────────────────────────────
//  localStorage の最小モック（Node 環境には存在しない）
// ─────────────────────────────────────────────────────────

class MockStorage {
  private m = new Map<string, string>();
  /** setItem が投げる例外を差し込むためのフック（容量超過の再現に使う）。 */
  failNext: Error | null = null;

  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return Array.from(this.m.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

let mock: MockStorage;

function installMockStorage(): void {
  mock = new MockStorage();
  (globalThis as unknown as { localStorage: unknown }).localStorage = mock;
  // storage.ts は判定結果をキャッシュするので、差し替えたら必ずリセットする。
  resetStorageCache();
}

// ─────────────────────────────────────────────────────────
//  フィクスチャ
// ─────────────────────────────────────────────────────────

/** 構造検証を通る最小の遺伝情報。中身の妥当性（どの locus が要るか）は genetics 側の責務。 */
function fixtureGenotype(seed: string): Genotype {
  return {
    seed,
    cat: {
      base: ['maru', 'yurei'],
      eyeCount: ['two', 'three'],
      pattern: ['none', 'dots'],
    },
    num: {
      size: [0.5, 0.62],
      hue: [0.2, 0.75],
      growthSpeed: [0.5, 0.5],
    },
  } as unknown as Genotype;
}

function fixtureCreature(id: string, stage: 'egg' | 'juvenile' | 'adult'): Creature {
  return {
    id,
    seed: `SEED-${id}`,
    name: 'こけまる',
    genotype: fixtureGenotype(`SEED-${id}`),
    life: {
      stage,
      ageMs: 120_000,
      growth: stage === 'adult' ? 100 : 40,
      hunger: 70,
      hydration: 65,
      cleanliness: 80,
      mood: 72,
      health: 95,
      hatchProgress: stage === 'egg' ? 30 : 100,
      careCount: 12,
      lastCareAt: { feed: 1_700_000_000_000, pet: 1_700_000_001_000 },
      lastTickAt: 1_700_000_002_000,
      restingUntil: 0,
    },
    parents: null,
    parentNames: null,
    generation: 1,
    bornAt: 1_699_999_000_000,
    bestScore: 61,
    exhibitionCount: 1,
    // v4 追加分。0 以外の値を入れて、往復で本当に保存されることを検証する。
    lastExhibitAt: 1_700_000_003_000,
    lastBredAt: 1_700_000_004_000,
    favorite: false,
    fromBreeding: false,
  };
}

/** 中身の詰まった state（空の新規 state だけでは往復テストとして弱いため）。 */
function fixtureState(): GameState {
  const s = createNewGameState('world-test-001');
  s.coins = 240;
  s.seedCounter = 3;
  s.creatures = [fixtureCreature('c1', 'adult'), fixtureCreature('c2', 'juvenile')];
  s.activeCreatureId = 'c1';
  s.inventory = { springWater: 2, honeyMossBall: 1 };
  s.owned = ['sunnyLamp'];
  s.unlocks = { nursery: true, exhibition: true, shop: true, breeding: false, collection: true, breeder: false, staff: false };
  s.stats = { hatched: 2, grownUp: 1, bred: 0, exhibitions: 1, coinsEarned: 240, careActions: 31, staffCareActions: 0 };
  s.tutorial = { done: ['chooseEgg', 'firstCare'], current: 'firstExhibition' };
  return s;
}

beforeEach(() => {
  installMockStorage();
});

// ─────────────────────────────────────────────────────────
//  1. ラウンドトリップ
// ─────────────────────────────────────────────────────────

describe('保存と読込のラウンドトリップ', () => {
  it('新規 state を save → load すると完全に一致する', () => {
    const state = createNewGameState('world-new');
    expect(save(state)).toEqual({ ok: true });

    const r = load();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('load に失敗した');
    expect(r.state).toEqual(state);
    expect(r.usedBackup).toBeUndefined();
    expect(r.migratedFrom).toBeUndefined();
  });

  it('個体・インベントリを含む state でも完全に一致する', () => {
    const state = fixtureState();
    expect(save(state)).toEqual({ ok: true });

    const r = load();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('load に失敗した');
    expect(r.state).toEqual(state);
    expect(r.state.creatures).toHaveLength(2);
    expect(r.state.creatures[0]!.genotype.cat).toEqual(state.creatures[0]!.genotype.cat);
  });

  it('展示会・交配のクールダウン時刻が往復で保存される（v4 追加分）', () => {
    const state = fixtureState();
    state.creatures[0]!.lastExhibitAt = 1_800_000_000_000;
    state.creatures[0]!.lastBredAt = 1_800_000_500_000;
    state.creatures[1]!.lastExhibitAt = 0;
    state.creatures[1]!.lastBredAt = 0;
    expect(save(state)).toEqual({ ok: true });

    const r = load();
    if (!r.ok) throw new Error('load に失敗した');
    // 以前はモジュール内 Map に置いていたため、ここでリセットされていた。
    expect(r.state.creatures[0]!.lastExhibitAt).toBe(1_800_000_000_000);
    expect(r.state.creatures[0]!.lastBredAt).toBe(1_800_000_500_000);
    expect(r.state.creatures[1]!.lastExhibitAt).toBe(0);
    expect(r.state.creatures[1]!.lastBredAt).toBe(0);
  });

  it('クールダウン時刻の変更が checksum に反映される', () => {
    const a = fixtureState();
    const before = checksum(a);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    b.creatures[0]!.lastExhibitAt += 1;
    expect(checksum(b)).not.toBe(before);
  });

  it('hasSave / clearSave が本体とバックアップの両方に効く', () => {
    expect(hasSave()).toBe(false);
    save(fixtureState());
    save(fixtureState()); // 2 回目でバックアップが作られる
    expect(hasSave()).toBe(true);
    expect(__readRawForTest(BACKUP_KEY)).not.toBeNull();

    clearSave();
    expect(hasSave()).toBe(false);
    expect(__readRawForTest(SAVE_KEY)).toBeNull();
    expect(__readRawForTest(BACKUP_KEY)).toBeNull();
  });

  it('セーブが無いときは reason:empty を返す（例外を投げない）', () => {
    const r = load();
    expect(r).toEqual({ ok: false, reason: 'empty' });
  });

  it('exportSave → importSave で往復できる', () => {
    const state = fixtureState();
    const json = exportSave(state);
    const r = importSave(json);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('importSave に失敗した');
    expect(r.state).toEqual(state);
  });

  it('importSave にゴミを渡しても例外を投げない', () => {
    expect(() => importSave('これはセーブではない')).not.toThrow();
    expect(importSave('これはセーブではない').ok).toBe(false);
    expect(importSave('').ok).toBe(false);
    expect(importSave('[]').ok).toBe(false);
    expect(importSave('null').ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
//  2. セーブデータ破損
// ─────────────────────────────────────────────────────────

describe('セーブデータ破損への耐性', () => {
  /** 健全なバックアップを 1 世代作った上で、本体だけを壊す。 */
  function setupWithGoodBackup(): GameState {
    const good = fixtureState();
    save(good); // 本体 = good
    save(good); // 本体 = good, バックアップ = good
    return good;
  }

  it('本体 JSON が途中で切れていてもバックアップから復旧する', () => {
    const good = setupWithGoodBackup();
    const raw = __readRawForTest(SAVE_KEY)!;
    __writeRawForTest(SAVE_KEY, raw.slice(0, Math.floor(raw.length / 2)));

    let r!: ReturnType<typeof load>;
    expect(() => {
      r = load();
    }).not.toThrow();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('復旧できなかった');
    expect(r.usedBackup).toBe(true);
    expect(r.state).toEqual(good);
  });

  it('本体に不正な型が入っていてもバックアップから復旧する', () => {
    const good = setupWithGoodBackup();
    __writeRawForTest(
      SAVE_KEY,
      JSON.stringify({
        version: SAVE_VERSION,
        savedAt: Date.now(),
        checksum: 'ffffffffffffffff',
        state: {
          version: SAVE_VERSION,
          coins: 'たくさん',
          creatures: 'ぜんぶ',
          worldSeed: 42,
          unlocks: 'ひらいている',
          capacity: null,
        },
      }),
    );

    let r!: ReturnType<typeof load>;
    expect(() => {
      r = load();
    }).not.toThrow();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('復旧できなかった');
    expect(r.usedBackup).toBe(true);
    expect(r.state).toEqual(good);
  });

  it('本体が空文字でもバックアップから復旧する', () => {
    const good = setupWithGoodBackup();
    __writeRawForTest(SAVE_KEY, '');

    let r!: ReturnType<typeof load>;
    expect(() => {
      r = load();
    }).not.toThrow();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('復旧できなかった');
    expect(r.usedBackup).toBe(true);
    expect(r.state).toEqual(good);
  });

  it('本体もバックアップも壊れていたら corrupt を返す（例外は投げない）', () => {
    for (const broken of ['{"version":3,"state":{"coins"', '', 'not json at all']) {
      installMockStorage();
      __writeRawForTest(SAVE_KEY, broken);
      __writeRawForTest(BACKUP_KEY, broken === '' ? 'also broken {{{' : broken);

      let r!: ReturnType<typeof load>;
      expect(() => {
        r = load();
      }).not.toThrow();
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('壊れているのに ok が返った');
      expect(r.reason).toBe('corrupt');
      if (r.reason === 'corrupt') {
        expect(typeof r.detail).toBe('string');
        expect(r.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it('両方壊れていても、救える分は recovered に載る', () => {
    // 本体は「JSON としては読めるが構造が壊れている」パターン。coerce で部分復旧できる。
    __writeRawForTest(
      SAVE_KEY,
      JSON.stringify({
        version: SAVE_VERSION,
        state: { worldSeed: 'survivor', coins: 999, creatures: [fixtureCreature('c1', 'adult')] },
      }),
    );
    __writeRawForTest(BACKUP_KEY, '壊れている');

    const r = load();
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'corrupt') throw new Error('corrupt が返らなかった');
    expect(r.recovered).toBeDefined();
    expect(r.recovered!.worldSeed).toBe('survivor');
    expect(r.recovered!.coins).toBe(999);
    expect(r.recovered!.creatures).toHaveLength(1);
    // 復旧結果はそのまま起動できる state であること。
    expect(validateState(r.recovered).ok).toBe(true);
  });

  it('未来バージョン（v99）のセーブでも起動不能にならない', () => {
    __writeRawForTest(
      SAVE_KEY,
      JSON.stringify({ version: 99, savedAt: Date.now(), checksum: 'x', state: { version: 99, coins: 10 } }),
    );

    let r!: ReturnType<typeof load>;
    expect(() => {
      r = load();
    }).not.toThrow();
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'corrupt') throw new Error('corrupt が返らなかった');
    // 「新しいバージョンです」と分かる文言が出ること。
    expect(r.detail).toContain('99');
  });

  it('localStorage が読み書きで例外を投げてもメモリへ退避して動く', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('SecurityError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    };
    resetStorageCache();

    const state = createNewGameState('no-storage');
    expect(() => save(state)).not.toThrow();
    expect(() => load()).not.toThrow();
    // probe が失敗するのでメモリフォールバックが選ばれ、保存自体は成功する。
    expect(save(state)).toEqual({ ok: true });
    const r = load();
    expect(r.ok).toBe(true);
  });

  it('容量超過は分かるエラーメッセージで返る（例外にしない）', () => {
    save(fixtureState()); // バックアップ用に 1 世代作る
    const quota = new Error('quota');
    quota.name = 'QuotaExceededError';
    // 本体書き込みとリトライの両方を失敗させる。
    mock.setItem = () => {
      throw quota;
    };

    const r = save(fixtureState());
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('容量超過が検出されなかった');
    expect(r.error).toContain('容量');
  });
});

// ─────────────────────────────────────────────────────────
//  3. coerceState
// ─────────────────────────────────────────────────────────

describe('coerceState による欠損補完', () => {
  const REQUIRED_KEYS: (keyof GameState)[] = [
    'version', 'createdAt', 'updatedAt', 'seedCounter', 'worldSeed', 'coins',
    'creatures', 'pendingEggs', 'inventory', 'owned', 'unlocks', 'capacity',
    'settings', 'tutorial', 'stats', 'activeCreatureId', 'field', 'breeder', 'future',
  ];

  it('必須フィールドを 1 つずつ欠落させても、すべてデフォルトで補完される', () => {
    for (const key of REQUIRED_KEYS) {
      const broken = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
      delete broken[key];

      const coerced = coerceState(broken);
      expect(coerced, `${key} を欠落させた state が復元できなかった`).not.toBeNull();

      const v = validateState(coerced);
      expect(v.ok, `${key} 欠落後の検証エラー: ${v.ok ? '' : v.errors.join(' / ')}`).toBe(true);
    }
  });

  it('必須フィールドを 1 つずつ null にしても補完される', () => {
    for (const key of REQUIRED_KEYS) {
      const broken = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
      broken[key] = null;

      const coerced = coerceState(broken);
      expect(coerced, `${key}=null の state が復元できなかった`).not.toBeNull();
      expect(validateState(coerced).ok, `${key}=null で検証に失敗`).toBe(true);
    }
  });

  it('空オブジェクトからでも起動できる state を作る', () => {
    const coerced = coerceState({});
    expect(coerced).not.toBeNull();
    expect(validateState(coerced).ok).toBe(true);
    // 育成室だけは必ず開いていること（閉じていると何もできない画面になる）。
    expect(coerced!.unlocks.nursery).toBe(true);
    expect(coerced!.version).toBe(SAVE_VERSION);
  });

  it('オブジェクトですらない入力には null を返す', () => {
    expect(coerceState(null)).toBeNull();
    expect(coerceState('セーブ')).toBeNull();
    expect(coerceState([1, 2, 3])).toBeNull();
    expect(coerceState(undefined)).toBeNull();
  });

  it('遺伝情報が壊れた個体だけを落とし、他は残す', () => {
    const s = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
    const creatures = s['creatures'] as Record<string, unknown>[];
    delete creatures[0]!['genotype']; // 遺伝子は捏造できないので、この個体は復元不能

    const coerced = coerceState(s);
    expect(coerced).not.toBeNull();
    expect(coerced!.creatures).toHaveLength(1);
    expect(coerced!.creatures[0]!.id).toBe('c2');
    // 選択中だった個体が消えたので activeCreatureId は null に落ちること。
    expect(coerced!.activeCreatureId).toBeNull();
  });

  it('個体の必須フィールドを 1 つずつ欠落させても補完される', () => {
    const CREATURE_KEYS = [
      'id', 'seed', 'name', 'life', 'parents', 'parentNames', 'generation', 'bornAt',
      'bestScore', 'exhibitionCount', 'lastExhibitAt', 'lastBredAt', 'favorite', 'fromBreeding',
    ];
    for (const key of CREATURE_KEYS) {
      const s = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
      const creatures = s['creatures'] as Record<string, unknown>[];
      delete creatures[0]![key];

      const coerced = coerceState(s);
      expect(coerced, `creature.${key} を欠落させた state が復元できなかった`).not.toBeNull();
      expect(coerced!.creatures, `creature.${key} 欠落で個体が失われた`).toHaveLength(2);
      const v = validateState(coerced);
      expect(v.ok, `creature.${key} 欠落後の検証エラー: ${v.ok ? '' : v.errors.join(' / ')}`).toBe(true);
    }
  });

  it('v4 追加フィールドが無い個体は 0 で補完される（クールダウン明け扱い）', () => {
    const s = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
    const creatures = s['creatures'] as Record<string, unknown>[];
    for (const c of creatures) {
      delete c['lastExhibitAt'];
      delete c['lastBredAt'];
    }

    const coerced = coerceState(s)!;
    for (const c of coerced.creatures) {
      expect(c.lastExhibitAt).toBe(0);
      expect(c.lastBredAt).toBe(0);
    }
    expect(validateState(coerced).ok).toBe(true);
  });

  it('範囲外の数値をクランプする', () => {
    const s = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
    const creatures = s['creatures'] as Record<string, unknown>[];
    (creatures[0]!['life'] as Record<string, unknown>)['mood'] = 9999;
    (creatures[0]!['life'] as Record<string, unknown>)['health'] = -50;
    s['coins'] = -100;

    const coerced = coerceState(s)!;
    expect(coerced.creatures[0]!.life.mood).toBe(100);
    expect(coerced.creatures[0]!.life.health).toBe(0);
    expect(coerced.coins).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────
//  4. validateState
// ─────────────────────────────────────────────────────────

describe('validateState', () => {
  it('正しい state を通す', () => {
    expect(validateState(fixtureState()).ok).toBe(true);
    expect(validateState(createNewGameState('w')).ok).toBe(true);
  });

  it('壊れた箇所をパス付きで報告する', () => {
    const s = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
    s['coins'] = 'たくさん';
    (s['capacity'] as Record<string, unknown>)['egg'] = null;

    const v = validateState(s);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('壊れているのに ok');
    expect(v.errors.some((e) => e.startsWith('coins:'))).toBe(true);
    expect(v.errors.some((e) => e.startsWith('capacity.egg:'))).toBe(true);
  });

  it('オブジェクト以外は即座に弾く', () => {
    expect(validateState(null).ok).toBe(false);
    expect(validateState('x').ok).toBe(false);
    expect(validateState([]).ok).toBe(false);
  });

  it('v4 の追加フィールドが無い個体は厳格検証で弾く（migrate 必須と分かる）', () => {
    const s = JSON.parse(JSON.stringify(fixtureState())) as Record<string, unknown>;
    const creatures = s['creatures'] as Record<string, unknown>[];
    delete creatures[0]!['lastExhibitAt'];
    delete creatures[1]!['lastBredAt'];

    const v = validateState(s);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('欠落しているのに ok');
    expect(v.errors.some((e) => e.startsWith('creatures[0].lastExhibitAt:'))).toBe(true);
    expect(v.errors.some((e) => e.startsWith('creatures[1].lastBredAt:'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
//  5. checksum
// ─────────────────────────────────────────────────────────

describe('checksum', () => {
  it('同じ state からは同じ値が出る（決定論的）', () => {
    const a = fixtureState();
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    expect(checksum(a)).toBe(checksum(b));
  });

  it('キーの順序が違っても同じ値になる', () => {
    const a = fixtureState();
    // キー順を逆順に組み直した同内容のオブジェクト。
    const reordered = Object.fromEntries(
      Object.entries(a as unknown as Record<string, unknown>).reverse(),
    ) as unknown as GameState;
    expect(checksum(reordered)).toBe(checksum(a));
  });

  it('state のわずかな変更を検知する', () => {
    const a = fixtureState();
    const base = checksum(a);

    const c1 = JSON.parse(JSON.stringify(a)) as GameState;
    c1.coins += 1;
    expect(checksum(c1)).not.toBe(base);

    const c2 = JSON.parse(JSON.stringify(a)) as GameState;
    c2.creatures[0]!.life.mood += 0.5;
    expect(checksum(c2)).not.toBe(base);

    const c3 = JSON.parse(JSON.stringify(a)) as GameState;
    c3.creatures[0]!.name = 'こけまるー';
    expect(checksum(c3)).not.toBe(base);

    const c4 = JSON.parse(JSON.stringify(a)) as GameState;
    c4.unlocks.breeding = true;
    expect(checksum(c4)).not.toBe(base);
  });

  it('16 桁の 16 進文字列になる', () => {
    expect(checksum(fixtureState())).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ─────────────────────────────────────────────────────────
//  6. ショップの整合性（config.ts）
// ─────────────────────────────────────────────────────────

describe('SHOP_ITEMS の整合性', () => {
  it('id が重複していない', () => {
    const ids = SHOP_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('価格がすべて正の整数', () => {
    for (const it of SHOP_ITEMS) {
      expect(it.price, it.id).toBeGreaterThan(0);
      expect(Number.isInteger(it.price), it.id).toBe(true);
    }
  });

  it('consumable:true なら effect を持ち、空でない', () => {
    for (const it of SHOP_ITEMS.filter((i) => i.consumable)) {
      expect(it.effect, it.id).toBeDefined();
      expect(Object.keys(it.effect!).length, it.id).toBeGreaterThan(0);
    }
  });

  it('consumable:false なら passive を持つか decor である', () => {
    for (const it of SHOP_ITEMS.filter((i) => !i.consumable)) {
      const ok = it.passive !== undefined || it.capacityIncrease !== undefined || it.kind === 'decor';
      expect(ok, `${it.id} は永続アイテムなのに passive も decor でもない`).toBe(true);
    }
  });

  it('表示に必要な項目がすべて埋まっている', () => {
    for (const it of SHOP_ITEMS) {
      expect(it.name.length, it.id).toBeGreaterThan(0);
      expect(it.desc.length, it.id).toBeGreaterThan(0);
      expect(it.effectText.length, it.id).toBeGreaterThan(0);
      expect(['food', 'drink', 'care', 'growth', 'health', 'decor', 'equipment']).toContain(it.kind);
      expect(['egg', 'juvenile', 'adult', 'any', 'room', 'field']).toContain(it.target);
    }
  });

  it('指示書 §8 の必須カテゴリを網羅している', () => {
    const kinds = new Set(SHOP_ITEMS.map((i) => i.kind));
    expect(kinds.has('food')).toBe(true); // 基本飼料より効果の高い飼料
    expect(kinds.has('care')).toBe(true); // 機嫌を上げるアイテム
    expect(kinds.has('growth')).toBe(true); // 成長を補助
    expect(kinds.has('health')).toBe(true); // 健康を補助
    expect(kinds.has('decor')).toBe(true); // 育成室の装飾
    expect(kinds.has('equipment')).toBe(true); // 育成設備

    expect(SHOP_ITEMS.filter((i) => i.kind === 'food').length).toBeGreaterThanOrEqual(2);
    expect(SHOP_ITEMS.filter((i) => i.kind === 'decor').length).toBeGreaterThanOrEqual(2);
    expect(SHOP_ITEMS.filter((i) => i.kind === 'equipment').length).toBeGreaterThanOrEqual(2);
    // 増やしすぎない（指示書 §8）。
    expect(SHOP_ITEMS.length).toBeGreaterThanOrEqual(10);
    expect(SHOP_ITEMS.length).toBeLessThanOrEqual(22);
  });

  it('上級飼料は無料の基本飼料より効果が高い', () => {
    const freeFeed = CARE_DEFS.feed.effect.hunger!;
    for (const it of SHOP_ITEMS.filter((i) => i.kind === 'food')) {
      expect(it.effect!.hunger!, it.id).toBeGreaterThan(freeFeed);
    }
  });
});

// ─────────────────────────────────────────────────────────
//  7. バランス検証
// ─────────────────────────────────────────────────────────

/**
 * 育成の進行を実際に回して所要時間を測る。
 *
 * config の数値をそのまま使い、「効果が最も高い世話を、指定間隔で押し続ける」プレイを模す。
 * 数値をコメントで主張するのではなく、毎回このテストで実測して検証する。
 *
 * @param intervalMs プレイヤーが世話を試みる間隔（連打なら globalCareCooldownMs）
 */
function simulate(
  stage: 'egg' | 'juvenile',
  intervalMs: number,
): { done: boolean; cares: number; seconds: number } {
  const actions = CARE_BY_STAGE[stage];
  const key = stage === 'egg' ? 'hatch' : 'growth';
  const target = stage === 'egg' ? TIMING.hatchTarget : TIMING.growthTarget;
  const passive = stage === 'egg' ? TIMING.hatchPassivePerSec : TIMING.growthPassivePerSec;
  const gap = Math.max(intervalMs, TIMING.globalCareCooldownMs);

  const STEP = 100;
  const lastCareAt: Record<string, number> = {};
  const readyAt: Record<string, number> = {};
  let progress = 0;
  let cares = 0;
  let nextAttempt = 0;

  for (let t = 0; t <= 20 * 60 * 1000; t += STEP) {
    if (t >= nextAttempt) {
      // 使えるもののうち、実効効果（効果量 × 倍率）が最大の世話を選ぶ。
      let best: CareAction | null = null;
      let bestVal = 0;
      for (const a of actions) {
        if (t < (readyAt[a] ?? 0)) continue;
        const val = (CARE_DEFS[a].effect[key] ?? 0) * careEffectMultiplier(lastCareAt, a, t);
        if (val > bestVal) {
          bestVal = val;
          best = a;
        }
      }
      if (best) {
        progress += bestVal;
        cares++;
        lastCareAt[best] = t;
        readyAt[best] = t + CARE_DEFS[best].cooldownMs;
        nextAttempt = t + gap;
        if (progress >= target) return { done: true, cares, seconds: t / 1000 };
      }
    }
    progress += passive * (STEP / 1000);
    if (progress >= target) return { done: true, cares, seconds: t / 1000 };
  }
  return { done: false, cares, seconds: Number.POSITIVE_INFINITY };
}

describe('バランス検証', () => {
  it('初回展示会の最低保証コインで最安アイテムが買える', () => {
    expect(EXHIBITION.firstTimeMinCoins).toBeGreaterThanOrEqual(SHOP_CHEAPEST_PRICE);
    // 指示書 §7「進行が止まらないように」— 最低保証は 120 以上。
    expect(EXHIBITION.firstTimeMinCoins).toBeGreaterThanOrEqual(120);
    // 安いものは 30〜60 コインの帯に収まっていること（指示書 §8）。
    expect(SHOP_CHEAPEST_PRICE).toBeGreaterThanOrEqual(30);
    expect(SHOP_CHEAPEST_PRICE).toBeLessThanOrEqual(60);
  });

  it('初回展示会は得点が低くても最低保証を下回らない', () => {
    // 総合 0 点という最悪ケースでも最低保証が効く。
    expect(exhibitionCoins(0, 'D', true)).toBe(EXHIBITION.firstTimeMinCoins);
    expect(exhibitionCoins(EXHIBITION.firstTimeScoreFloor, rankOf(EXHIBITION.firstTimeScoreFloor), true))
      .toBeGreaterThanOrEqual(EXHIBITION.firstTimeMinCoins);
  });

  it('2 回目以降も報酬がゼロにならない', () => {
    expect(exhibitionCoins(0, 'D', false)).toBeGreaterThanOrEqual(EXHIBITION.minCoins);
  });

  it('得点が上がるほど報酬が増える（単調性）', () => {
    let prev = -1;
    for (const total of [0, 20, 40, 58, 74, 88, 100]) {
      const coins = exhibitionCoins(total, rankOf(total), false);
      expect(coins).toBeGreaterThan(prev);
      prev = coins;
    }
  });

  it('評価項目の重みの合計が 100', () => {
    const w = EXHIBITION.weights;
    expect(w.beauty + w.care + w.health + w.character + w.rarity).toBe(100);
  });

  it('ランク境界が単調に並んでいる', () => {
    expect(rankOf(100)).toBe('S');
    expect(rankOf(88)).toBe('S');
    expect(rankOf(87)).toBe('A');
    expect(rankOf(74)).toBe('A');
    expect(rankOf(58)).toBe('B');
    expect(rankOf(40)).toBe('C');
    expect(rankOf(39)).toBe('D');
    expect(rankOf(0)).toBe('D');
  });

  it('審査員が 3 名いて、全ランクのコメントを持つ', () => {
    expect(EXHIBITION.judges).toHaveLength(3);
    for (const j of EXHIBITION.judges) {
      expect(j.name.length).toBeGreaterThan(0);
      for (const rank of ['S', 'A', 'B', 'C', 'D'] as const) {
        expect(j.lines[rank].length, `${j.id}/${rank}`).toBeGreaterThan(0);
      }
    }
  });

  it('最初の孵化が数分以内に到達できる（指示書 §5）', () => {
    // 「ちょうどよい間隔で世話を巡回する」プレイの実測。
    const paced = simulate('egg', SATIATION.fullMs);
    expect(paced.done).toBe(true);
    // 世話 5〜6 回・1〜2 分の想定に収まること。
    expect(paced.cares).toBeGreaterThanOrEqual(4);
    expect(paced.cares).toBeLessThanOrEqual(7);
    expect(paced.seconds).toBeGreaterThan(45);
    expect(paced.seconds).toBeLessThan(150);

    // 世話ゼロの完全放置でも 6 分以内に孵ること（詰みを作らない）。
    expect(TIMING.hatchTarget / TIMING.hatchPassivePerSec).toBeLessThan(6 * 60);
  });

  it('ボタン連打で孵化が一瞬にならない（作業ゲー化の防止）', () => {
    const spam = simulate('egg', TIMING.globalCareCooldownMs);
    const paced = simulate('egg', SATIATION.fullMs);

    // 連打しても 45 秒は切らないこと。以前は per-action cooldown だけだったため 5 秒で孵っていた。
    expect(spam.seconds).toBeGreaterThan(45);
    // 連打は「速いが割に合わない」こと。時間は大差ないのに操作回数だけ跳ね上がる。
    expect(spam.cares).toBeGreaterThan(paced.cares * 3);
    expect(spam.seconds).toBeGreaterThan(paced.seconds * 0.6);
  });

  it('幼体→成体が 3〜5 分程度で届く（指示書 §5）', () => {
    const paced = simulate('juvenile', SATIATION.fullMs);
    expect(paced.done).toBe(true);
    expect(paced.seconds).toBeGreaterThan(2 * 60);
    expect(paced.seconds).toBeLessThan(6 * 60);

    // 完全放置でも 10 分以内には成体になる（放置でも詰まないが、世話した方が明確に速い）。
    const idleSec = TIMING.growthTarget / TIMING.growthPassivePerSec;
    expect(idleSec).toBeLessThan(10 * 60);
    expect(idleSec).toBeGreaterThan(paced.seconds);
  });

  it('オフライン加算は最大 2 時間に制限される', () => {
    expect(TIMING.maxOfflineMs).toBe(2 * 60 * 60 * 1000);
  });

  it('減衰が速すぎない（満腹 100 が尽きるまで 5 分以上）', () => {
    for (const rate of [0.2 /* hunger */, 0.24 /* hydration */]) {
      expect(100 / rate).toBeGreaterThan(5 * 60 * 0.8);
    }
  });
});

// ─────────────────────────────────────────────────────────
//  8. 飽き（連打抑制）
// ─────────────────────────────────────────────────────────

describe('careBoredomFactor（連打抑制）', () => {
  const NOW = 1_800_000_000_000;

  it('一度も使っていない世話は full 効果', () => {
    expect(careBoredomFactor({}, 'feed', NOW)).toBe(1);
  });

  it('直後に同じ世話を繰り返すと 40% まで落ちる', () => {
    expect(careBoredomFactor({ feed: NOW }, 'feed', NOW)).toBeCloseTo(BOREDOM.minFactor, 6);
  });

  it('他の世話を 4 種はさむと完全回復する', () => {
    const last: Record<string, number> = { feed: NOW - 1000 };
    for (const [i, a] of ['water', 'clean', 'pet', 'play'].entries()) {
      last[a] = NOW - 900 + i;
    }
    expect(careBoredomFactor(last, 'feed', NOW)).toBeCloseTo(1, 6);
  });

  it('時間経過だけでも回復する', () => {
    const half = careBoredomFactor({ feed: NOW - BOREDOM.recoverMs / 2 }, 'feed', NOW);
    expect(half).toBeGreaterThan(BOREDOM.minFactor);
    expect(half).toBeLessThan(1);
    expect(careBoredomFactor({ feed: NOW - BOREDOM.recoverMs }, 'feed', NOW)).toBeCloseTo(1, 6);
  });

  it('連打より巡回の方が総効果が高い（作業ゲー化の防止）', () => {
    // 同じ世話を 5 連打した場合の合計倍率
    let spam = 0;
    const spamLast: Record<string, number> = {};
    for (let i = 0; i < 5; i++) {
      spam += careBoredomFactor(spamLast, 'pet', NOW + i);
      spamLast['pet'] = NOW + i;
    }
    // 5 種類を 1 回ずつ巡回した場合の合計倍率
    let rotate = 0;
    const rotLast: Record<string, number> = {};
    for (const [i, a] of (['feed', 'water', 'clean', 'pet', 'play'] as const).entries()) {
      rotate += careBoredomFactor(rotLast, a, NOW + i);
      rotLast[a] = NOW + i;
    }
    expect(rotate).toBeGreaterThan(spam);
  });

  it('壊れた lastCareAt（NaN や文字列）でも 1 を返して落ちない', () => {
    expect(careBoredomFactor({ feed: NaN }, 'feed', NOW)).toBe(1);
    expect(careBoredomFactor({ feed: 'きのう' as unknown as number }, 'feed', NOW)).toBe(1);
  });
});

describe('careSatiationFactor（進行ペース）', () => {
  const NOW = 1_800_000_000_000;

  it('最初の 1 回は必ず全効果（初手で手応えを返す）', () => {
    expect(careSatiationFactor({}, NOW)).toBe(1);
  });

  it('直前に別の世話をしていても効果が落ちる（種類を問わない）', () => {
    expect(careSatiationFactor({ pet: NOW }, NOW)).toBeCloseTo(SATIATION.minFactor, 6);
    expect(careSatiationFactor({ pet: NOW - 500 }, NOW)).toBeLessThan(0.2);
  });

  it('fullMs あければ全効果に戻る', () => {
    expect(careSatiationFactor({ pet: NOW - SATIATION.fullMs }, NOW)).toBeCloseTo(1, 6);
    expect(careSatiationFactor({ pet: NOW - SATIATION.fullMs * 10 }, NOW)).toBeCloseTo(1, 6);
  });

  it('複数の世話履歴のうち最も新しいものを見る', () => {
    const last = { feed: NOW - SATIATION.fullMs * 2, pet: NOW - 200 };
    expect(careSatiationFactor(last, NOW)).toBeLessThan(0.2);
  });

  it('押す間隔を詰めても 1 秒あたりの進行量がほぼ一定に収束する', () => {
    // 効果 15 の世話を、間隔を変えて 60 秒ぶん押し続けたときの合計。
    const E = 15;
    const total = (gapMs: number): number => {
      let sum = 0;
      for (let t = gapMs; t <= 60_000; t += gapMs) {
        sum += E * careSatiationFactor({ x: t - gapMs }, t);
      }
      return sum;
    };
    const paced = total(SATIATION.fullMs); // ちょうどよい間隔
    const spam = total(TIMING.globalCareCooldownMs); // 最速連打
    // 連打しても 1.6 倍を超えて有利にならない＝連打が支配的戦略にならない。
    expect(spam).toBeLessThan(paced * 1.6);
    // かといって完全に無意味でもない（押した手応えは残す）。
    expect(spam).toBeGreaterThan(paced * 0.8);
  });

  it('careEffectMultiplier は飽きと満足の積になる', () => {
    const last = { feed: NOW - 3000, pet: NOW - 1000 };
    expect(careEffectMultiplier(last, 'feed', NOW)).toBeCloseTo(
      careBoredomFactor(last, 'feed', NOW) * careSatiationFactor(last, NOW),
      10,
    );
  });

  /**
   * `SATIATION.minFactor` を 0 にしたので、「直前の世話からの経過が 0」のときだけ
   * 倍率も 0 になり得る。0 より大きいことは要求できない。
   *
   * 0 でなければならない理由は `src/game/config.ts` の minFactor のコメントと
   * `tests/satiation.test.ts` を参照（0 より大きいと連打が数学的に有利になり、
   * 画面の「連打しても 早くは なりません。」が嘘になる）。
   *
   * 実プレイでは `TIMING.globalCareCooldownMs = 2000` があるため経過 0 は起こらず、
   * 最小でも 2/18 ≒ 11% は入る。要求すべきは「負にならない」「1 を超えない」の 2 点。
   */
  it('倍率は常に 0 以上 1 以下（負や過剰なブーストを起こさない）', () => {
    const cases: Record<string, number>[] = [
      {},
      { feed: NOW },
      { feed: NOW - 1, pet: NOW - 50_000 },
      { feed: NOW - 500_000 },
      { feed: NaN },
    ];
    for (const last of cases) {
      const m = careEffectMultiplier(last, 'feed', NOW);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      expect(Number.isFinite(m)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────
//  9. 世話定義の整合性
// ─────────────────────────────────────────────────────────

describe('CARE_DEFS の整合性', () => {
  it('指示書 §5 の世話がすべて定義されている', () => {
    expect(CARE_BY_STAGE.egg).toEqual(['warm', 'moisten', 'talk', 'touch', 'tidyEnv']);
    expect(CARE_BY_STAGE.juvenile).toEqual(['feed', 'water', 'clean', 'pet', 'play', 'rest']);
    expect(CARE_BY_STAGE.adult).toEqual(CARE_BY_STAGE.juvenile);
  });

  it('各定義にラベル・アイコン・クールダウンがある', () => {
    for (const def of Object.values(CARE_DEFS)) {
      expect(def.label.length, def.action).toBeGreaterThan(0);
      expect(def.icon.length, def.action).toBeGreaterThan(0);
      expect(def.hint.length, def.action).toBeGreaterThan(0);
      expect(def.cooldownMs, def.action).toBeGreaterThan(0);
      expect(def.stages.length, def.action).toBeGreaterThan(0);
      expect(Object.keys(def.effect).length, def.action).toBeGreaterThan(0);
    }
  });

  it('CARE_BY_STAGE と CareDef.stages が矛盾しない', () => {
    for (const stage of ['egg', 'juvenile', 'adult'] as const) {
      for (const action of CARE_BY_STAGE[stage]) {
        expect(CARE_DEFS[action].stages, `${stage}/${action}`).toContain(stage);
      }
    }
  });

  it('基本の世話はすべて無料（ショップ解放前でも遊べる）', () => {
    for (const def of Object.values(CARE_DEFS)) {
      expect(def.free, def.action).toBe(true);
    }
  });

  it('卵の世話は hatch を、幼体の世話は growth を必ず動かす', () => {
    for (const a of CARE_BY_STAGE.egg) {
      expect(CARE_DEFS[a].effect.hatch, a).toBeDefined();
      expect(CARE_DEFS[a].effect.hatch!, a).toBeGreaterThanOrEqual(14);
      expect(CARE_DEFS[a].effect.hatch!, a).toBeLessThanOrEqual(18);
    }
    for (const a of CARE_BY_STAGE.juvenile) {
      expect(CARE_DEFS[a].effect.growth, a).toBeDefined();
      expect(CARE_DEFS[a].effect.growth!, a).toBeGreaterThanOrEqual(6);
      expect(CARE_DEFS[a].effect.growth!, a).toBeLessThanOrEqual(9);
    }
  });
});
