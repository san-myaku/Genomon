/**
 * 開発ツール専用の localStorage 層。
 *
 * 【絶対規則】
 *   ゲーム本体のセーブキー（'genomon.save.v1' / 'genomon.save.backup'）へは
 *   **このモジュールからは決して書き込まない**。
 *   ここが扱うキーはすべて 'genomon.dev.' 接頭辞を持つものに限り、
 *   putRaw() は接頭辞を実行時にも検査して、うっかり本体キーを渡しても弾く。
 *
 * 【なぜ実行時チェックまで要るか】
 *   Visual Lab は「問題のある seed を保存する」機能を持つ。
 *   保存先の文字列を一箇所間違えるだけで、遊んでいるセーブを壊しうる。
 *   型では防げないので、書き込みの直前に必ず通る関門を 1 つ置く。
 */

/** 開発ツールが使ってよいキーの接頭辞。 */
const DEV_PREFIX = 'genomon.dev.';

/** 問題のある seed のブックマーク。 */
export const SEEDS_KEY = `${DEV_PREFIX}seeds.v1`;
/** Visual Lab / 開発者モードの画面設定。 */
export const PREFS_KEY = `${DEV_PREFIX}prefs.v1`;
/** 開発者モードがセーブへ書き込む直前に取る、開発ツール所有のバックアップ。 */
export const DEV_SAVE_BACKUP_KEY = `${DEV_PREFIX}savebackup.v1`;

/** 開発ツールが触ってよいキーか。ここを通らない書き込みは存在しない。 */
function assertDevKey(key: string): void {
  if (!key.startsWith(DEV_PREFIX)) {
    throw new Error(`labStore: 開発ツール以外のキーへは書き込めません（${key}）`);
  }
}

export function getRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function putRaw(key: string, value: string): boolean {
  assertDevKey(key);
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function dropRaw(key: string): void {
  assertDevKey(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* 消せなくても続行 */
  }
}

// ─────────────────────────────────────────────────────────
//  問題 seed のブックマーク
// ─────────────────────────────────────────────────────────

export interface SavedSeed {
  seed: string;
  /** 記録した時点の段階。 */
  stage: string;
  /** inspectModel が出した問題（空なら「気になる個体」として手動保存）。 */
  issues: string[];
  /** 自由メモ（コメント）。 */
  note: string;
  savedAt: number;
  /**
   * 直近の変更時刻（コメント編集・対応済み切り替えのたびに更新）。
   * ブラウザとファイルをマージするとき「新しい方を勝たせる」決め手に使う。
   * 無い（旧データ）場合は savedAt を採用したものとして扱う。
   */
  updatedAt?: number;
  /** 対応済みか。 */
  resolved?: boolean;
  /** 対応済みにした時刻。 */
  resolvedAt?: number | null;
  /** 誰が対応済みにしたか（表示用）。 */
  resolvedBy?: 'user' | 'claude' | null;
}

/** 旧データ（新フィールドが無い）を補って形を揃える。 */
function normalizeSeedEntry(x: SavedSeed): SavedSeed {
  return {
    ...x,
    updatedAt: x.updatedAt ?? x.savedAt,
    resolved: x.resolved ?? false,
    resolvedAt: x.resolvedAt ?? null,
    resolvedBy: x.resolvedBy ?? null,
  };
}

export function loadSeeds(): SavedSeed[] {
  const raw = getRaw(SEEDS_KEY);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    // 壊れた要素は黙って捨てる（開発ツールが起動不能になる方が困る）。
    return v
      .filter((x): x is SavedSeed => !!x && typeof (x as SavedSeed).seed === 'string')
      .map(normalizeSeedEntry);
  } catch {
    return [];
  }
}

/**
 * ブラウザ側（local）とファイル側（remote）を、`seed+stage` ごとに
 * `updatedAt` の新しい方を採用してマージする。
 *
 * 【なぜ要るか — 一方通行の同期だった時の問題】
 *   以前は「ブラウザで変更 → ファイルへ上書き保存」の一方通行だった。
 *   Claude がファイルを直接編集して対応済みにしても、ユーザーがブラウザで
 *   何か 1 つ変更しただけで、その変更が**ブラウザの古い状態ごと**
 *   ファイルへ上書きされ、Claude の編集が消えてしまう
 *   （製品オーナー指摘：「対応済みが残り続けると混乱しないか」）。
 *   1 レコードずつ「最後に更新されたのはどちらか」で決めれば、
 *   同期のたびに両者の変更が両方とも残る。
 */
export function mergeSeeds(local: readonly SavedSeed[], remote: readonly SavedSeed[]): SavedSeed[] {
  const key = (s: SavedSeed): string => `${s.seed}::${s.stage}`;
  const byKey = new Map<string, SavedSeed>();
  for (const s of local) byKey.set(key(s), normalizeSeedEntry(s));
  for (const r of remote) {
    const rr = normalizeSeedEntry(r);
    const cur = byKey.get(key(rr));
    if (!cur || (rr.updatedAt ?? 0) > (cur.updatedAt ?? 0)) byKey.set(key(rr), rr);
  }
  // 保存順の目安として savedAt 降順にしておく（新しく保存したものが上に来る）。
  return [...byKey.values()].sort((a, b) => b.savedAt - a.savedAt);
}

export function putSeeds(list: readonly SavedSeed[]): boolean {
  return putRaw(SEEDS_KEY, JSON.stringify(list.slice(0, 500)));
}

/** 同じ seed + stage は上書きする（重複を溜めない）。 */
export function addSeed(entry: SavedSeed): SavedSeed[] {
  const list = loadSeeds().filter((s) => !(s.seed === entry.seed && s.stage === entry.stage));
  list.unshift(normalizeSeedEntry({ ...entry, updatedAt: entry.savedAt }));
  putSeeds(list);
  return list;
}

export function removeSeed(seed: string, stage: string): SavedSeed[] {
  const list = loadSeeds().filter((s) => !(s.seed === seed && s.stage === stage));
  putSeeds(list);
  return list;
}

/** 既存のブックマークのコメント（note）だけを書き換える。無ければ何もしない。 */
export function updateSeedNote(seed: string, stage: string, note: string): SavedSeed[] {
  const list = loadSeeds();
  const hit = list.find((s) => s.seed === seed && s.stage === stage);
  if (hit) {
    hit.note = note;
    hit.updatedAt = Date.now();
  }
  putSeeds(list);
  return list;
}

/**
 * 対応済み／未対応を切り替える。ユーザーも Claude（ファイルの直接編集）も
 * 同じ形でこのフラグを立てる。`by` は表示用の記録でしかなく、
 * 権限の区別には使っていない（開発ツールなので両者を対等に扱う）。
 */
export function setResolved(
  seed: string,
  stage: string,
  resolved: boolean,
  by: 'user' | 'claude',
): SavedSeed[] {
  const list = loadSeeds();
  const hit = list.find((s) => s.seed === seed && s.stage === stage);
  if (hit) {
    hit.resolved = resolved;
    hit.resolvedAt = resolved ? Date.now() : null;
    hit.resolvedBy = resolved ? by : null;
    hit.updatedAt = Date.now();
  }
  putSeeds(list);
  return list;
}

export function clearSeeds(): void {
  dropRaw(SEEDS_KEY);
}

// ─────────────────────────────────────────────────────────
//  画面設定
// ─────────────────────────────────────────────────────────

export function loadPrefs<T extends object>(fallback: T): T {
  const raw = getRaw(PREFS_KEY);
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fallback;
    return { ...fallback, ...(v as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function savePrefs(prefs: object): void {
  putRaw(PREFS_KEY, JSON.stringify(prefs));
}
