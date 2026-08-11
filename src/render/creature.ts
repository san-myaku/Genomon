/**
 * RenderModel → 完全な SVG 文字列。
 *
 * 出力構造:
 *   <svg><defs/>
 *     <g class="gm-float"><g class="gm-sway"><g class="gm-breath"><g class="gm-fx">
 *       <g class="gm-part gm-<id>">…</g> × z 昇順
 *     </g></g></g></g>
 *   </svg>
 *
 * 待機モーション（浮遊 / 傾ぎ / 呼吸）と反応演出は別のグループに掛ける。
 * 同じ要素に両方を掛けると CSS の詳細度で片方が消え、反応が再生されない。
 * gm-fx は待機モーションを持たない「反応専用」の層。
 * 静止画として使う場合は class が付いているだけで無害。
 */

import type { RenderModel } from '../core/types.ts';
import { n } from './svg.ts';

/**
 * 接地影のテーマ切り替え。
 *
 * 影を「黒の低 alpha」だけで描くと暗背景で完全に消え、生きものが虚空に浮く。
 * body.ts が明背景用（暗い影）と暗背景用（明るい溜まり）の 2 枚を出しているので、
 * ここで片方だけを見せる。SVG 内 <style> はインライン SVG では文書に効くため
 * `:root[data-theme]`（ui/app.ts が html に付ける）も拾える。
 * 単体の .svg として使われた場合は prefers-color-scheme 側が効く。
 */
const SHADOW_THEME_CSS =
  '.gm-sh-dark{display:none}' +
  '@media(prefers-color-scheme:dark){.gm-sh-light{display:none}.gm-sh-dark{display:inline}}' +
  ':root[data-theme="light"] .gm-sh-light{display:inline}' +
  ':root[data-theme="light"] .gm-sh-dark{display:none}' +
  ':root[data-theme="dark"] .gm-sh-light{display:none}' +
  ':root[data-theme="dark"] .gm-sh-dark{display:inline}';

export interface RenderSvgOpts {
  /** ルート svg に付ける追加クラス。 */
  className?: string;
  /** 幅・高さ属性（省略時は 100%）。 */
  width?: number | string;
  height?: number | string;
  /** 紙の背景を描くか。 */
  background?: string | null;
  /** アニメーション用のグループを出力するか（既定 true）。 */
  animatable?: boolean;
  /** アクセシビリティ用のタイトル。 */
  title?: string;
}

export function renderCreatureSvg(model: RenderModel, opts: RenderSvgOpts = {}): string {
  const vb = model.viewBox;
  const w = opts.width ?? '100%';
  const h = opts.height ?? '100%';
  const cls = ['gm-svg', `gm-base-${model.base}`, `gm-stage-${model.stage}`, opts.className]
    .filter(Boolean)
    .join(' ');

  const body = model.parts
    .map((p) => `<g class="gm-part gm-${p.id}">${p.svg}</g>`)
    .join('');

  const inner = opts.animatable === false
    ? body
    : `<g class="gm-float"><g class="gm-sway"><g class="gm-breath"><g class="gm-fx">${body}</g></g></g></g>`;

  const bg = opts.background
    ? `<rect x="${n(vb.x)}" y="${n(vb.y)}" width="${n(vb.w)}" height="${n(vb.h)}" fill="${opts.background}"/>`
    : '';

  const title = opts.title ? `<title>${opts.title}</title>` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}"` +
    ` width="${w}" height="${h}" class="${cls}" data-seed="${model.seed}" data-uid="${model.uid}"` +
    ` role="img" preserveAspectRatio="xMidYMid meet">` +
    `${title}<style>${SHADOW_THEME_CSS}</style><defs>${model.defs}</defs>${bg}${inner}</svg>`
  );
}

/** デバッグ用のオーバーレイ（bodyBox / faceBox / アンカー / パーツ bbox）。 */
export function renderDebugOverlay(model: RenderModel): string {
  const b = model.bodyBox;
  const f = model.faceBox;
  let s = '';
  s += `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="none" stroke="#3a7bd5" stroke-width="0.8" stroke-dasharray="3 2"/>`;
  s += `<rect x="${n(f.x)}" y="${n(f.y)}" width="${n(f.w)}" height="${n(f.h)}" fill="none" stroke="#d55a3a" stroke-width="0.8" stroke-dasharray="3 2"/>`;
  for (const p of model.parts) {
    if (!p.bbox) continue;
    s += `<rect x="${n(p.bbox.x)}" y="${n(p.bbox.y)}" width="${n(p.bbox.w)}" height="${n(p.bbox.h)}" fill="none" stroke="#8a8a8a" stroke-width="0.5" opacity="0.7"/>`;
  }
  for (const a of model.anchors) {
    s += `<circle cx="${n(a.x)}" cy="${n(a.y)}" r="1.8" fill="#e0a52a" stroke="#4b3b34" stroke-width="0.5"/>`;
  }
  return s;
}
