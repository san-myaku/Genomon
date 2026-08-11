/**
 * ゲノモン — 保存・読込（localStorage）
 *
 * 【最重要】壊れた保存データによってゲーム全体が起動不能にならないこと（指示書 §27）。
 *
 * そのための多重防御:
 *   1. 保存のたびに 1 世代前を backup キーへ退避する。
 *   2. 本体が壊れていたら backup を読む（usedBackup: true で UI に通知できる）。
 *   3. 両方壊れていたら coerceState で救えるだけ救い、recovered として返す。
 *   4. どの経路でも throw しない。戻り値の判別可能ユニオンだけで表現する。
 *
 * 【localStorage が無い環境】
 *   Node のテストや、プライベートブラウズで localStorage が例外を投げる環境がある。
 *   その場合はプロセス内のメモリ Map へ透過的にフォールバックする（例外は投げない）。
 */

import { SAVE_VERSION, type GameState, type SaveData, type SaveLoadResult } from '../core/types.ts';
import { checksum, coerceState, validateState } from './schema.ts';
import { migrate } from './migrate.ts';

/** 本体キー。'v1' はストレージ配置の世代であり、SAVE_VERSION とは別物（指示どおり固定）。 */
export const SAVE_KEY = 'genomon.save.v1';
/** 1 世代前のバックアップキー。 */
export const BACKUP_KEY = 'genomon.save.backup';

// ─────────────────────────────────────────────────────────
//  ストレージ抽象（localStorage / メモリ）
// ─────────────────────────────────────────────────────────

interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage が使えない環境用のフォールバック。 */
const memoryStore = new Map<string, string>();

const memoryKV: KVStore = {
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
  setItem: (k, v) => {
    memoryStore.set(k, v);
  },
  removeItem: (k) => {
    memoryStore.delete(k);
  },
};

/** localStorage が実際に読み書きできるか、実書き込みで確かめる（存在チェックだけでは不十分）。 */
function probeLocalStorage(): KVStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__genomon_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls as unknown as KVStore;
  } catch {
    return null;
  }
}

/**
 * 毎回 probe すると遅いので結果を覚える。
 * ただしテストが globalThis.localStorage を差し替えられるよう、リセット手段を用意する。
 */
let cachedKV: KVStore | null = null;

function kv(): KVStore {
  if (cachedKV) return cachedKV;
  cachedKV = probeLocalStorage() ?? memoryKV;
  return cachedKV;
}

/** ストレージ判定のキャッシュを捨てる。テストで localStorage モックを差し替えたあとに呼ぶ。 */
export function resetStorageCache(): void {
  cachedKV = null;
}

/** メモリフォールバックを使用中か（開発者モードの表示用）。 */
export function isUsingMemoryFallback(): boolean {
  return kv() === memoryKV;
}

function readRaw(key: string): string | null {
  try {
    return kv().getItem(key);
  } catch {
    // 読み出しで例外を投げるストレージも存在する。ここで握って「無かった」ことにする。
    return null;
  }
}

/** QuotaExceededError かどうかを、ブラウザ差を吸収して判定する。 */
function isQuotaError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014
    );
  }
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && /quota/i.test(name);
}

// ─────────────────────────────────────────────────────────
//  保存
// ─────────────────────────────────────────────────────────

/**
 * 保存する。
 * 先に現在の本体をバックアップへ退避してから書くので、
 * 書き込み中に落ちても 1 世代前には必ず戻れる。
 */
export function save(state: GameState): { ok: true } | { ok: false; error: string } {
  let payload: string;
  try {
    const data: SaveData = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      checksum: checksum(state),
      state,
    };
    payload = JSON.stringify(data);
  } catch (err) {
    // 循環参照など、そもそも直列化できない state。呼び出し側のバグなので内容を出す。
    return { ok: false, error: `セーブデータを文字列化できませんでした: ${errText(err)}` };
  }

  const store = kv();

  // 1 世代前を退避。ここが失敗しても本体保存は続行する（バックアップは best-effort）。
  try {
    const prev = readRaw(SAVE_KEY);
    if (prev !== null) store.setItem(BACKUP_KEY, prev);
  } catch {
    /* バックアップ失敗は致命的ではないので握りつぶす */
  }

  try {
    store.setItem(SAVE_KEY, payload);
    return { ok: true };
  } catch (err) {
    if (isQuotaError(err)) {
      // 容量超過。バックアップを捨てて本体だけでも残せないか、もう一度だけ試す。
      try {
        store.removeItem(BACKUP_KEY);
        store.setItem(SAVE_KEY, payload);
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: 'ブラウザの保存容量がいっぱいです。他のサイトのデータを整理するか、セーブを書き出して削除してください。',
        };
      }
    }
    return { ok: false, error: `保存に失敗しました: ${errText(err)}` };
  }
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─────────────────────────────────────────────────────────
//  読込
// ─────────────────────────────────────────────────────────

/** 1 スロットぶんのデコード結果。 */
type SlotResult =
  | { kind: 'ok'; state: GameState; migratedFrom?: number }
  | { kind: 'empty' }
  | { kind: 'bad'; detail: string; recovered?: GameState };

/**
 * 文字列 1 本を GameState まで解決する。
 * ここが全ての防御の中心なので、どんな入力でも throw しない。
 */
function decodeSlot(text: string | null, label: string): SlotResult {
  if (text === null) return { kind: 'empty' };
  if (text.trim() === '') return { kind: 'bad', detail: `${label}: 中身が空でした` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // 書き込み途中で切れた JSON はここに来る。最も多い破損パターン。
    return { kind: 'bad', detail: `${label}: JSON として読めません（${errText(err)}）` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'bad', detail: `${label}: セーブの形式ではありません` };
  }
  const envelope = parsed as Record<string, unknown>;

  const version = typeof envelope['version'] === 'number' ? envelope['version'] : undefined;
  const body = envelope['state'];

  // 未来バージョンは触らない。migrate も null を返すが、ここで明示的に分かるメッセージにする。
  if (version !== undefined && version > SAVE_VERSION) {
    const recovered = coerceState(body) ?? undefined;
    return {
      kind: 'bad',
      detail: `${label}: このセーブは新しいバージョン（v${version}）で作られています。ゲームを更新してください。`,
      ...(recovered ? { recovered } : {}),
    };
  }

  // 現行バージョンならそのまま検証。
  if (version === SAVE_VERSION) {
    const v = validateState(body);
    if (v.ok) {
      // チェックサム不一致は「壊れている」ではなく「手で編集された」可能性が高い。
      // 構造が正しいなら起動を止める理由が無いので、そのまま採用する。
      return { kind: 'ok', state: v.state };
    }
    // 構造が壊れている。ここで coerce の結果を即採用しない。
    // 無傷の 1 世代前バックアップの方が、今のスロットを欠損補完したものより価値が高いため、
    // 救出結果は recovered に載せるだけにして、採否は load() に判断させる。
    const recovered = coerceState(body) ?? undefined;
    return {
      kind: 'bad',
      detail: `${label}: 内容が壊れています（${v.errors.slice(0, 5).join(' / ')}）`,
      ...(recovered ? { recovered } : {}),
    };
  }

  // 旧バージョン → マイグレーション。
  const migrated = migrate(envelope);
  if (migrated) {
    return { kind: 'ok', state: migrated.state, migratedFrom: migrated.from };
  }

  const recovered = coerceState(body) ?? undefined;
  return {
    kind: 'bad',
    detail: `${label}: バージョン ${version ?? '不明'} のセーブを読み込めませんでした`,
    ...(recovered ? { recovered } : {}),
  };
}

/**
 * セーブを読み込む。
 *
 * 本体 → バックアップ の順に試し、どちらも駄目なら救出できた分を recovered に載せて返す。
 * 例外は投げない。
 */
export function load(): SaveLoadResult {
  const mainText = readRaw(SAVE_KEY);
  const backupText = readRaw(BACKUP_KEY);

  // 本体もバックアップも無い＝新規プレイヤー。
  if (mainText === null && backupText === null) return { ok: false, reason: 'empty' };

  const main = decodeSlot(mainText, '本体');
  if (main.kind === 'ok') {
    return main.migratedFrom !== undefined
      ? { ok: true, state: main.state, migratedFrom: main.migratedFrom }
      : { ok: true, state: main.state };
  }

  // 本体が駄目ならバックアップ。ここが「起動不能にしない」ための本命。
  const backup = decodeSlot(backupText, 'バックアップ');
  if (backup.kind === 'ok') {
    return backup.migratedFrom !== undefined
      ? { ok: true, state: backup.state, migratedFrom: backup.migratedFrom, usedBackup: true }
      : { ok: true, state: backup.state, usedBackup: true };
  }

  // 本体が空でバックアップだけが壊れている、という状態は「セーブ無し」として扱う。
  // （ここへ到達する時点で backup.kind は 'empty' | 'bad' に絞られている）
  if (main.kind === 'empty' && backup.kind === 'empty') {
    return { ok: false, reason: 'empty' };
  }

  const details: string[] = [];
  if (main.kind === 'bad') details.push(main.detail);
  if (backup.kind === 'bad') details.push(backup.detail);
  if (details.length === 0) details.push('セーブを読み込めませんでした');

  // 最後の望み: 壊れた本体から拾えるだけ拾う。UI は「一部だけ復元しますか？」を出せる。
  const recovered = (main.kind === 'bad' ? main.recovered : undefined) ?? (backup.kind === 'bad' ? backup.recovered : undefined);

  return recovered
    ? { ok: false, reason: 'corrupt', detail: details.join(' / '), recovered }
    : { ok: false, reason: 'corrupt', detail: details.join(' / ') };
}

/** セーブが存在するか（タイトル画面の「つづきから」表示判定用）。 */
export function hasSave(): boolean {
  return readRaw(SAVE_KEY) !== null || readRaw(BACKUP_KEY) !== null;
}

/** セーブを消す。バックアップも一緒に消さないと「消したのに復活した」事故になる。 */
export function clearSave(): void {
  const store = kv();
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    /* 消せなくても続行 */
  }
  try {
    store.removeItem(BACKUP_KEY);
  } catch {
    /* 消せなくても続行 */
  }
}

// ─────────────────────────────────────────────────────────
//  書き出し・読み込み（開発者モード用）
// ─────────────────────────────────────────────────────────

/** セーブを JSON 文字列として書き出す。人が読めるよう整形しておく。 */
export function exportSave(state: GameState): string {
  const data: SaveData = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    checksum: checksum(state),
    state,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * JSON 文字列からセーブを読み込む（ストレージには書かない）。
 * 貼り付けミスや別ゲームの JSON を投げ込まれても throw しない。
 */
export function importSave(json: string): SaveLoadResult {
  if (typeof json !== 'string' || json.trim() === '') {
    return { ok: false, reason: 'empty' };
  }
  const r = decodeSlot(json, '読み込んだデータ');
  if (r.kind === 'ok') {
    return r.migratedFrom !== undefined ? { ok: true, state: r.state, migratedFrom: r.migratedFrom } : { ok: true, state: r.state };
  }
  if (r.kind === 'empty') return { ok: false, reason: 'empty' };
  return r.recovered
    ? { ok: false, reason: 'corrupt', detail: r.detail, recovered: r.recovered }
    : { ok: false, reason: 'corrupt', detail: r.detail };
}

// ─────────────────────────────────────────────────────────
//  テスト・開発補助
// ─────────────────────────────────────────────────────────

/** 生の保存文字列を直接書き込む（破損シナリオの再現とテスト専用）。 */
export function __writeRawForTest(key: string, value: string | null): void {
  const store = kv();
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* テスト補助なので握りつぶす */
  }
}

/** 生の保存文字列を直接読む（テスト・開発者モード専用）。 */
export function __readRawForTest(key: string): string | null {
  return readRaw(key);
}
