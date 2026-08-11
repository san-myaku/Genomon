/**
 * 待機モーションと反応アニメーション。
 *
 * 【方式】
 *   個体ごとに一意な keyframes を生成して <style> に注入する。
 *   CSS 変数を keyframes 内で使う方式はブラウザ差が出やすいので、
 *   uid 付きの keyframes 名で「その個体専用のアニメ」を作る方が確実。
 *
 *   構造（creature.ts の出力）:
 *     .gm-float  … 上下浮遊
 *     .gm-sway   … 体の傾ぎ
 *     .gm-breath … 呼吸（縦横の伸縮）
 *     .gm-eyeN   … まばたき
 *
 *   素体と性格で速度・振幅が変わる（model.motion に入っている）。
 */

import type { RenderModel } from '../core/types.ts';

export type ReactionKind =
  | 'happy'
  | 'delighted'
  | 'neutral'
  | 'dislike'
  | 'sleepy'
  | 'full'
  | 'eat'
  | 'drink'
  | 'pet';

const REACTION_MS: Record<ReactionKind, number> = {
  happy: 700,
  delighted: 1100,
  neutral: 420,
  dislike: 620,
  sleepy: 1400,
  full: 900,
  eat: 760,
  drink: 760,
  pet: 900,
};

const SHARED_STYLE_ID = 'gm-anim-shared';

/** 反応アニメーションの共通 keyframes（1 度だけ注入）。 */
const SHARED_CSS = `
.gm-svg{overflow:visible}
.gm-svg .gm-float,.gm-svg .gm-sway,.gm-svg .gm-breath,.gm-svg .gm-fx{transform-box:view-box;transform-origin:100px 150px}
.gm-svg .gm-breath{transform-origin:100px 178px}
.gm-svg .gm-fx{transform-origin:100px 170px}
.gm-svg [class*="gm-eye"]{transform-box:fill-box;transform-origin:center}
@media (prefers-reduced-motion: reduce){
  .gm-svg .gm-float,.gm-svg .gm-sway,.gm-svg .gm-breath,.gm-svg .gm-fx,.gm-svg [class*="gm-eye"]{animation:none !important}
}
@keyframes gm-r-happy{0%,100%{transform:translateY(0) scale(1,1)}22%{transform:translateY(-9px) scale(0.96,1.05)}44%{transform:translateY(0) scale(1.05,0.94)}66%{transform:translateY(-5px) scale(0.98,1.03)}}
@keyframes gm-r-delighted{0%,100%{transform:translateY(0) rotate(0) scale(1,1)}15%{transform:translateY(-14px) rotate(-6deg) scale(0.94,1.08)}35%{transform:translateY(0) rotate(5deg) scale(1.08,0.92)}55%{transform:translateY(-10px) rotate(-4deg) scale(0.96,1.05)}78%{transform:translateY(0) rotate(2deg) scale(1.03,0.97)}}
@keyframes gm-r-neutral{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes gm-r-dislike{0%,100%{transform:translateX(0) rotate(0)}20%{transform:translateX(-6px) rotate(-3deg)}40%{transform:translateX(6px) rotate(3deg)}60%{transform:translateX(-4px) rotate(-2deg)}80%{transform:translateX(3px) rotate(1deg)}}
@keyframes gm-r-sleepy{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(4px) scale(1.04,0.93)}}
@keyframes gm-r-full{0%,100%{transform:scale(1,1)}50%{transform:scale(1.08,1.06)}}
@keyframes gm-r-eat{0%,100%{transform:scale(1,1)}25%{transform:scale(1.09,0.9)}50%{transform:scale(0.94,1.08)}75%{transform:scale(1.04,0.96)}}
@keyframes gm-r-drink{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(3px) rotate(-4deg)}60%{transform:translateY(1px) rotate(3deg)}}
@keyframes gm-r-pet{0%,100%{transform:rotate(0) translateY(0)}25%{transform:rotate(-5deg) translateY(-3px)}55%{transform:rotate(4deg) translateY(-1px)}80%{transform:rotate(-2deg) translateY(0)}}
.gm-react{animation-timing-function:cubic-bezier(.34,1.56,.64,1);animation-fill-mode:both}
.gm-react-happy{animation-name:gm-r-happy}
.gm-react-delighted{animation-name:gm-r-delighted}
.gm-react-neutral{animation-name:gm-r-neutral}
.gm-react-dislike{animation-name:gm-r-dislike}
.gm-react-sleepy{animation-name:gm-r-sleepy}
.gm-react-full{animation-name:gm-r-full}
.gm-react-eat{animation-name:gm-r-eat}
.gm-react-drink{animation-name:gm-r-drink}
.gm-react-pet{animation-name:gm-r-pet}
`;

function doc(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

export function ensureSharedStyles(): void {
  const d = doc();
  if (!d || d.getElementById(SHARED_STYLE_ID)) return;
  const st = d.createElement('style');
  st.id = SHARED_STYLE_ID;
  st.textContent = SHARED_CSS;
  d.head.appendChild(st);
}

/**
 * 個体固有の待機モーション CSS。
 * SSR/テストでも使えるよう、DOM に触らず文字列だけを返す。
 */
export function idleCss(model: RenderModel): string {
  const m = model.motion;
  const uid = model.uid;
  const delay = (m.phase * 2).toFixed(2);
  const amp = m.floatAmp.toFixed(2);
  const bAmp = m.breathAmp;
  const sway = m.swayDeg.toFixed(2);
  const cy = (model.bodyBox.y + model.bodyBox.h).toFixed(1);

  // まばたきの「閉じている時間」を全体周期に対する割合へ変換する
  const blinkClose = model.motion.blinkMs > 0 ? Math.min(6, (140 / model.motion.blinkMs) * 100) : 0;
  const k1 = (100 - blinkClose).toFixed(2);
  const k2 = (100 - blinkClose * 0.55).toFixed(2);

  return (
    `@keyframes gm-f-${uid}{0%,100%{transform:translateY(0)}50%{transform:translateY(-${amp}px)}}` +
    `@keyframes gm-s-${uid}{0%,100%{transform:rotate(-${sway}deg)}50%{transform:rotate(${sway}deg)}}` +
    `@keyframes gm-b-${uid}{0%,100%{transform:scale(1,1)}50%{transform:scale(${(1 + bAmp * 0.72).toFixed(3)},${(1 - bAmp).toFixed(3)})}}` +
    (blinkClose > 0
      ? `@keyframes gm-e-${uid}{0%,${k1}%,100%{transform:scaleY(1)}${(Number(k1) + 0.4).toFixed(2)}%,${k2}%{transform:scaleY(0.06)}}`
      : '') +
    `[data-uid="${uid}"] .gm-float{animation:gm-f-${uid} ${m.floatMs}ms ease-in-out infinite;animation-delay:-${delay}s}` +
    `[data-uid="${uid}"] .gm-sway{animation:gm-s-${uid} ${m.swayMs}ms ease-in-out infinite;animation-delay:-${delay}s;transform-origin:100px ${cy}px}` +
    `[data-uid="${uid}"] .gm-breath{animation:gm-b-${uid} ${m.breathMs}ms ease-in-out infinite;animation-delay:-${delay}s;transform-origin:100px ${cy}px}` +
    (blinkClose > 0
      ? `[data-uid="${uid}"] [class*="gm-eye"]{animation:gm-e-${uid} ${m.blinkMs}ms linear infinite;animation-delay:-${delay}s}`
      : '')
  );
}

/**
 * 待機モーションを DOM に適用する。戻り値を呼ぶと解除される。
 * reducedMotion が true のときは何もしない。
 */
export function applyIdleMotion(
  host: Element | null,
  model: RenderModel,
  opts: { reducedMotion?: boolean } = {},
): () => void {
  const d = doc();
  if (!d || !host) return () => {};
  ensureSharedStyles();
  if (opts.reducedMotion) return () => {};
  const id = `gm-anim-${model.uid}`;
  let st = d.getElementById(id) as HTMLStyleElement | null;
  if (!st) {
    st = d.createElement('style');
    st.id = id;
    st.textContent = idleCss(model);
    d.head.appendChild(st);
  }
  return () => {
    const el = d.getElementById(id);
    if (el && !d.querySelector(`[data-uid="${model.uid}"]`)) el.remove();
  };
}

/**
 * 短い反応演出を再生する。
 *
 * 掛け先は待機モーションを持たない `.gm-fx` 層。
 * `.gm-float` に掛けると `[data-uid=".."] .gm-float{animation:…}` の方が
 * 詳細度で勝ってしまい、反応がまったく再生されない。
 */
export function playReaction(el: Element | null, kind: ReactionKind): void {
  const d = doc();
  if (!d || !el) return;
  ensureSharedStyles();
  const target = (el.querySelector('.gm-fx') ?? el.querySelector('.gm-float') ?? el) as HTMLElement;
  const ms = REACTION_MS[kind] ?? 600;
  const cls = `gm-react-${kind}`;
  target.classList.remove('gm-react');
  for (const k of Object.keys(REACTION_MS)) target.classList.remove(`gm-react-${k}`);
  // 再スタートさせるために強制リフロー
  void (target as unknown as { offsetWidth: number }).offsetWidth;
  target.style.animationDuration = `${ms}ms`;
  target.classList.add('gm-react', cls);
  window.setTimeout(() => {
    target.classList.remove('gm-react', cls);
    target.style.animationDuration = '';
  }, ms + 40);
}

/** CareResult.reaction を演出種別へ写す。 */
export function reactionForCare(action: string, reaction: string): ReactionKind {
  if (reaction === 'dislike') return 'dislike';
  if (reaction === 'sleepy') return 'sleepy';
  if (reaction === 'full') return 'full';
  if (action === 'feed') return 'eat';
  if (action === 'water') return 'drink';
  if (action === 'pet' || action === 'touch') return 'pet';
  if (reaction === 'delighted') return 'delighted';
  if (reaction === 'happy') return 'happy';
  return 'neutral';
}
