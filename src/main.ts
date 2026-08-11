/**
 * エントリポイント。
 *
 * index.html の `#app` にアプリを描画する。
 * ここでは「起動」と「最後の砦の例外処理」だけを行い、中身は ui/app.ts に任せる。
 */

import './ui/styles.css';
import { boot } from './ui/app.ts';
import { toast } from './ui/components/toast.ts';

const root = document.getElementById('app');

if (!root) {
  // index.html は リード所有なので、ここで作り直したりはしない。何が起きたかだけ残す。
  console.error('[ゲノモン] #app が 見つかりません。index.html を 確認してください。');
} else {
  // 想定外の例外でゲームが無言で止まるのを防ぐ（黙って壊れない、が方針）。
  window.addEventListener('error', (ev) => {
    console.error('[ゲノモン] 未処理エラー', ev.error ?? ev.message);
    toast('うまく いかない ところが ありました。画面を 読み込み直すと 直ることが あります。', 'bad');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    console.error('[ゲノモン] 未処理の reject', ev.reason);
  });

  void boot(root).catch((err: unknown) => {
    console.error('[ゲノモン] 起動に失敗', err);
    root.innerHTML =
      `<div class="title-screen"><div class="title-inner">` +
      `<h1 class="title-logo">ゲノモン</h1>` +
      `<p class="title-sub">起動できませんでした。<br>ブラウザを 更新して もう一度 お試しください。</p>` +
      `</div></div>`;
  });
}
