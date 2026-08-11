/**
 * DOM の小道具。
 *
 * 【方針】
 *   画面は「HTML 文字列を組み立てて innerHTML → data 属性で要素を拾ってハンドラを付ける」
 *   という素朴な形で書く。仮想 DOM を持ち込むほどの規模ではないうえ、
 *   ゲノモンの SVG が文字列で来るので文字列合成と相性が良い。
 *
 * 【安全】
 *   ユーザー由来・生成由来の文字列は必ず esc() を通してから埋め込む。
 *   名前は naming.ts の生成物なので安全だが、例外を作ると事故るので一律で通す。
 */

/** HTML エスケープ。属性値・テキストの両方に使える最小限の実装。 */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** タグ付きテンプレート。`${}` に入る値を自動でエスケープする。 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += Array.isArray(v) ? v.join('') : esc(v);
    out += strings[i + 1] ?? '';
  }
  return out;
}

/** エスケープしないで埋め込みたい断片（SVG など）を包むマーカー。 */
export function raw(s: string): string[] {
  return [s];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  inner?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (inner !== undefined) node.innerHTML = inner;
  return node;
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

/**
 * イベント委譲。root に 1 つだけリスナを付け、data 属性で対象を選ぶ。
 * 画面を innerHTML で作り直してもリスナが外れないので、この形に統一する。
 */
export function delegate(
  root: HTMLElement,
  type: string,
  selector: string,
  handler: (target: HTMLElement, ev: Event) => void,
): () => void {
  const fn = (ev: Event): void => {
    const start = ev.target as HTMLElement | null;
    if (!start) return;
    const hit = start.closest(selector) as HTMLElement | null;
    if (hit && root.contains(hit)) handler(hit, ev);
  };
  root.addEventListener(type, fn);
  return () => root.removeEventListener(type, fn);
}

/** 要素の中身を差し替える（同じ内容ならスキップして再描画のちらつきを防ぐ）。 */
export function setHtml(node: Element | null, s: string): void {
  if (!node) return;
  if (node.innerHTML !== s) node.innerHTML = s;
}

export function setText(node: Element | null, s: string): void {
  if (!node) return;
  if (node.textContent !== s) node.textContent = s;
}

/** アニメーションを 1 回だけ再生する（クラスの付け外し）。 */
export function playOnce(node: Element | null, cls: string, ms: number): void {
  if (!node) return;
  node.classList.remove(cls);
  void (node as HTMLElement).offsetWidth; // 強制リフローで再スタートさせる
  node.classList.add(cls);
  window.setTimeout(() => node.classList.remove(cls), ms + 40);
}

/** 粒子を弾けさせる（卵の選択・世話の反応・コイン獲得）。 */
export function burstSparkles(host: HTMLElement | null, count = 10, colors?: string[]): void {
  if (!host) return;
  if (document.documentElement.dataset.motion === 'reduced') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const layer = el('div', 'sparkles');
  const palette = colors ?? ['var(--brass)', 'var(--accent)', 'var(--leaf)', '#fff'];
  for (let i = 0; i < count; i++) {
    const s = el('span', 'sparkle');
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 30 + Math.random() * 46;
    s.style.left = `${44 + Math.random() * 12}%`;
    s.style.top = `${44 + Math.random() * 12}%`;
    s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(ang) * dist - 14}px`);
    s.style.background = palette[i % palette.length]!;
    s.style.animationDelay = `${Math.random() * 90}ms`;
    s.style.width = s.style.height = `${5 + Math.random() * 6}px`;
    layer.appendChild(s);
  }
  host.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1100);
}

/** 紙吹雪（展示会の結果発表）。 */
export function confetti(durationMs = 2600): void {
  if (document.documentElement.dataset.motion === 'reduced') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const layer = el('div', 'confetti');
  layer.setAttribute('aria-hidden', 'true');
  const colors = ['#ff9f6b', '#c2953f', '#6aa84f', '#8d6bc0', '#4f8bb0', '#ffd9a8'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length]!;
    p.style.setProperty('--t', `${1700 + Math.random() * 1500}ms`);
    p.style.animationDelay = `${Math.random() * 700}ms`;
    p.style.width = `${6 + Math.random() * 6}px`;
    p.style.height = `${10 + Math.random() * 8}px`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), durationMs + 900);
}

/** 秒待つ（演出のタイムライン用）。スキップ時は 0 待ちにする。 */
export function wait(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, Math.max(0, ms)));
}
