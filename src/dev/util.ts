/**
 * 開発ツール共通の小道具。
 * ゲーム本体（src/ui）に依存しない範囲の雑務だけを置く。
 */

/** クリップボードへコピー。失敗しても例外を投げず false を返す。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http:// や権限拒否の環境向けのフォールバック（隠しテキストエリア + execCommand）。
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 文字列をファイルとしてダウンロードさせる。 */
export function downloadText(name: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  triggerDownload(name, url);
  // revoke は次のタスクで（同期で消すと Firefox がダウンロードを取りこぼす）。
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function triggerDownload(name: string, url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 重い処理をフレームに分けて回す。
 * 500 体の検査を同期で回すとタブが固まり「動いているのか死んだのか」が分からない。
 * 一定件数ごとに描画へ制御を返し、進捗を出せるようにする。
 */
export async function runChunked(
  total: number,
  chunk: number,
  step: (index: number) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let i = 0;
  while (i < total) {
    const end = Math.min(total, i + chunk);
    for (; i < end; i++) step(i);
    onProgress?.(i, total);
    // rAF だと非表示タブで止まるので、確実に回る setTimeout(0) を使う。
    await new Promise<void>((r) => window.setTimeout(r, 0));
  }
}

/** 読みやすい JSON 文字列。循環参照があっても落ちない。 */
export function pretty(value: unknown, space = 2): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_k, v: unknown) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        return v;
      },
      space,
    );
  } catch (err) {
    return `（JSON にできませんでした: ${String(err)}）`;
  }
}

/** ms を「1分20秒」のような日本語にする。 */
export function humanMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}分${rest}秒` : `${m}分`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}時間${m % 60}分` : `${h}時間`;
}

// ─────────────────────────────────────────────────────────
//  Visual Lab のコメント付き個体を、開発サーバー経由でファイルへ同期する
// ─────────────────────────────────────────────────────────
//
// 【localStorage をやめてこちらへ一本化しなかった理由】
//   開発サーバー（`npx vite`）が動いていないと `/api/lab-feedback` は
//   存在しない（例えば `vite preview` や、サーバーを落とした後にタブだけ
//   開いている状態）。そのときに保存操作そのものを失敗させたくないので、
//   localStorage への保存は今までどおり必ず行い、ファイルへの反映は
//   「できればついでに」の位置づけにする。失敗しても呼び出し側には
//   `ok:false` を返すだけで、例外は投げない。

const FEEDBACK_ENDPOINT = '/api/lab-feedback';

export interface SyncResult {
  ok: boolean;
  detail: string;
}

/**
 * `docs/lab-feedback.json` の現在の中身を取ってくる。
 * 失敗（サーバーが無い・ファイルが壊れている）したら空配列を返す
 * （呼び出し側はこれを「ファイル側に何も無い」として扱ってよい —
 * マージは「新しい方を採用」なので、空配列を渡してもローカル側は消えない）。
 */
export async function fetchFeedbackFromServer(): Promise<unknown[]> {
  try {
    const res = await fetch(FEEDBACK_ENDPOINT);
    if (!res.ok) return [];
    const v: unknown = await res.json();
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 現在のブックマーク一覧を `docs/lab-feedback.json` へ書き込む。 */
export async function syncFeedbackToServer(list: unknown): Promise<SyncResult> {
  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(list),
    });
    if (!res.ok) return { ok: false, detail: `サーバーが ${res.status} を返しました` };
    return { ok: true, detail: 'docs/lab-feedback.json に保存しました' };
  } catch (err) {
    // 開発サーバーが無い / 落ちている、などが主因。localStorage 側は無傷なので
    // 静かに諦めてよい（呼び出し側が toast などで軽く伝える）。
    return { ok: false, detail: `開発サーバーに届きませんでした（${String(err)}）` };
  }
}
