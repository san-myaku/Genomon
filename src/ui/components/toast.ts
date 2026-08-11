/**
 * トースト通知。
 *
 * 保存失敗のような「見逃してはいけない知らせ」を必ず目に入れるための部品。
 * aria-live で読み上げにも流す（画面の変化を音でも知らせる）。
 */

import { el, esc } from '../dom.ts';

export type ToastKind = 'good' | 'warn' | 'bad' | 'info';

let layer: HTMLElement | null = null;

function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = el('div', 'toasts');
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');
  document.body.appendChild(layer);
  // 画面が変わると足元の操作卓も変わる（卵の確定バー → 世話パネル）。
  // トーストは画面をまたいで生き残るので、そのたびに置き直す。
  window.addEventListener('resize', reposition);
  window.addEventListener('hashchange', reposition);
  return layer;
}

/** いま出ているトーストの位置を計算し直す。 */
function reposition(): void {
  if (!layer || !layer.isConnected) return;
  placeLayer(layer);
}

/** 画面下に貼り付く操作卓（世話パネル・卵の確定バー・演出のスキップ）。 */
const BOTTOM_BARS = ['.nursery__ctrl', '.confirmbar', '.exh-skip'];

/**
 * トーストを出す高さを決める。
 *
 * 上部に出すと「次の目標」の行を覆う。かといってナビの真上に固定すると、
 * 今度は世話パネルのボタン（いちばん押したいもの）を覆う。
 * どちらも実測して、そのとき画面下を占めているものの上に載せる。
 * PC 幅は右下に逃がしてあるので CSS に任せる（inline を消す）。
 */
function placeLayer(l: HTMLElement): void {
  if (window.innerWidth >= 900) {
    l.style.removeProperty('bottom');
    return;
  }
  const vh = window.innerHeight;
  const nav = document.querySelector<HTMLElement>('.nav');
  let bottom = 8;
  if (nav && !nav.hidden) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0) bottom = Math.max(bottom, vh - r.top + 8);
  }
  for (const sel of BOTTOM_BARS) {
    const bar = document.querySelector<HTMLElement>(sel);
    if (!bar) continue;
    const r = bar.getBoundingClientRect();
    if (r.height === 0) continue;
    bottom = Math.max(bottom, vh - r.top + 8);
  }
  // 持ち上げすぎると今度は生きものを覆うので、画面の 6 割で頭打ちにする。
  l.style.bottom = `${Math.round(Math.min(bottom, vh * 0.6))}px`;
}

/**
 * トーストを出す。
 * @param kind bad は自動で消える時間を長くする（読む時間を確保するため）。
 */
export function toast(message: string, kind: ToastKind = 'info', ms?: number): void {
  const host = ensureLayer();
  placeLayer(host);
  const node = el('div', `toast toast--${kind}`);
  node.innerHTML = esc(message);
  host.appendChild(node);
  // 画面遷移と同時に出るトースト（卵の確定 → 育成室 など）は、
  // 出した瞬間にはまだ移動先の操作卓が組み上がっていない。落ち着いてからもう一度測る。
  window.requestAnimationFrame(reposition);
  window.setTimeout(reposition, 320);

  const life = ms ?? (kind === 'bad' ? 6000 : kind === 'warn' ? 4200 : 2800);
  window.setTimeout(() => {
    node.style.transition = 'opacity 220ms, transform 220ms';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    window.setTimeout(() => node.remove(), 260);
  }, life);

  // 積み上がりすぎたら古いものから捨てる。
  while (host.children.length > 4) host.firstElementChild?.remove();
}
