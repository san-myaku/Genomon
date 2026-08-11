/**
 * ゲノモン — セーブデータのマイグレーション
 *
 * 【なぜ v1 / v2 が存在するのか】
 *   実際に出荷された v1・v2 は無い。それでも「マイグレーション機構が実際に動く」ことを
 *   証明するために、仮想的な旧形式を定義してテストしている（指示書 §27）。
 *
 * 【v3 → v4 は実際に起きたスキーマ変更】
 *   展示会・交配のクールダウンをモジュール内 Map で持っていたため、
 *   リロードするとクールダウンが消え、展示会を回してコインを稼げる抜け道になっていた。
 *   そこで Creature に lastExhibitAt / lastBredAt を追加した（リード判断・型契約変更）。
 *   仮想ではない本物の移行なので、この機構が本番で機能することの実証になっている。
 *
 * 【旧形式】
 *   v1: coins が無く money という名前だった / capacity が無く固定だった
 *   v2: unlocks.collection が無かった / future フィールドが無かった
 *   v3: Creature に lastExhibitAt / lastBredAt が無かった
 *
 * 【設計方針】
 *   - 連鎖マイグレーション（v1 → v2 → v3）。飛び越えない。
 *   - 各 step は「そのバージョン差分だけ」を直す。欠損の一般的な穴埋めは
 *     coerceState() に任せ、step を薄く保つ。
 *   - 未知の未来バージョンは null。起動不能にせず「読み込めない」と伝えるだけにする。
 */

import { SAVE_VERSION, type GameState } from '../core/types.ts';
import { CAPACITY_DEFAULT } from '../game/config.ts';
import { coerceState } from './schema.ts';

/** マイグレーション途中の、まだ GameState とは呼べない中間表現。 */
type Loose = Record<string, unknown>;

/** サポートする最古のバージョン。これより古いものは読めない。 */
export const OLDEST_SUPPORTED_VERSION = 1;

function isObj(x: unknown): x is Loose {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * v1 → v2
 *   - money → coins へ改名
 *   - capacity が無かったので既定値を入れる
 */
function v1_to_v2(s: Loose): Loose {
  const out: Loose = { ...s };

  // money → coins。両方あれば coins を優先し、money だけなら引き継ぐ。
  if (out['coins'] === undefined) {
    const money = out['money'];
    out['coins'] = typeof money === 'number' && Number.isFinite(money) ? money : 0;
  }
  delete out['money'];

  // v1 は所持枠が固定だったため、セーブに capacity が存在しない。
  if (!isObj(out['capacity'])) {
    out['capacity'] = { ...CAPACITY_DEFAULT };
  }

  out['version'] = 2;
  return out;
}

/**
 * v2 → v3
 *   - unlocks.collection を追加（標本帳の解放フラグ）
 *   - future（将来のオンライン機能用の予約領域）を追加
 */
function v2_to_v3(s: Loose): Loose {
  const out: Loose = { ...s };

  const unlocks = isObj(out['unlocks']) ? { ...out['unlocks'] } : {};
  if (typeof unlocks['collection'] !== 'boolean') {
    // 既に孵化済みの個体がいるセーブなら標本帳は開いていたはず、と推定して復元する。
    const creatures = Array.isArray(out['creatures']) ? out['creatures'] : [];
    const hasHatched = creatures.some((c) => {
      if (!isObj(c)) return false;
      const life = c['life'];
      return isObj(life) && (life['stage'] === 'juvenile' || life['stage'] === 'adult');
    });
    unlocks['collection'] = hasHatched;
  }
  out['unlocks'] = unlocks;

  if (!isObj(out['future'])) {
    out['future'] = { marketListings: [], tradeHistory: [], rankingCache: null };
  }

  out['version'] = 3;
  return out;
}

/**
 * v3 → v4
 *   - Creature に lastExhibitAt / lastBredAt を追加（展示会・交配のクールダウン保存）。
 *
 * 実際に発生したスキーマ変更。旧セーブの個体には「いつ展示会に出たか」の記録が
 * そもそも存在しないため、0（＝クールダウン明け）で補う。
 * Date.now() で埋めると、旧セーブのプレイヤーが身に覚えのない待ち時間を課される。
 * 抜け道の心配は無い —— 旧セーブでは元々クールダウンが機能していなかったので、
 * 0 を入れることで悪化することはなく、以降は正しく保存される。
 */
function v3_to_v4(s: Loose): Loose {
  const out: Loose = { ...s };

  const creatures = Array.isArray(out['creatures']) ? out['creatures'] : [];
  out['creatures'] = creatures.map((c) => {
    if (!isObj(c)) return c;
    const next: Loose = { ...c };
    if (typeof next['lastExhibitAt'] !== 'number' || !Number.isFinite(next['lastExhibitAt'])) {
      next['lastExhibitAt'] = 0;
    }
    if (typeof next['lastBredAt'] !== 'number' || !Number.isFinite(next['lastBredAt'])) {
      next['lastBredAt'] = 0;
    }
    return next;
  });

  out['version'] = 4;
  return out;
}

/** バージョン n → n+1 の変換表。ここに追記するだけで拡張できる。 */
const STEPS: Readonly<Record<number, (s: Loose) => Loose>> = {
  1: v1_to_v2,
  2: v2_to_v3,
  3: v3_to_v4,
};

/** 生データからバージョン番号を読み取る。封筒（SaveData）と中身（GameState）の両方を見る。 */
export function detectVersion(raw: unknown): number | null {
  if (!isObj(raw)) return null;
  const direct = raw['version'];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const state = raw['state'];
  if (isObj(state)) {
    const v = state['version'];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * 旧バージョンのセーブを現行 SAVE_VERSION まで引き上げる。
 *
 * @param raw SaveData 封筒（{version, state, ...}）でも、裸の GameState でも受け付ける。
 * @returns 成功したら現行形式の state と、元のバージョン番号。
 *          未知の未来バージョン・復元不能なデータは null（呼び出し側は新規ゲームへ落とす）。
 */
export function migrate(raw: unknown): { state: GameState; from: number } | null {
  if (!isObj(raw)) return null;

  // 封筒なら中身を取り出す。裸の state ならそのまま使う。
  const envelopeState = raw['state'];
  const body: Loose = isObj(envelopeState) ? { ...envelopeState } : { ...raw };

  const detected = detectVersion(raw);
  if (detected === null) return null;

  // 未来のバージョンは解釈できない。壊れたと決めつけず「読めない」と返す。
  if (detected > SAVE_VERSION) return null;
  // 古すぎるバージョンもサポート外。
  if (detected < OLDEST_SUPPORTED_VERSION) return null;

  let cur: Loose = body;
  cur['version'] = detected;

  let v = detected;
  // 1 段ずつ確実に上げる。無限ループ防止のため上限回数を切ってある。
  for (let guard = 0; v < SAVE_VERSION && guard <= SAVE_VERSION; guard++) {
    const step = STEPS[v];
    if (!step) return null; // 変換経路が無い＝機構の不備。黙って壊すより null。
    cur = step(cur);
    const next = cur['version'];
    if (typeof next !== 'number' || next <= v) return null;
    v = next;
  }
  if (v !== SAVE_VERSION) return null;

  // 旧形式には現行の必須フィールドが揃っていないことがある。
  // 個別の step で全部埋めるのは保守が破綻するので、最後に coerce で一括補完する。
  const state = coerceState(cur);
  if (!state) return null;

  return { state, from: detected };
}
