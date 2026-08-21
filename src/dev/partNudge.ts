/**
 * Visual Lab の「パーツをドラッグして動かす／大きさを変える」機能。
 *
 * 【何のためのものか — 製品オーナーとエージェントの伝達手段】
 *   「まつげがもう少し下」「もっと大きく」を言葉で伝えるのには限界がある。
 *   製品オーナーが実際にその場でパーツを動かして見せ、その **ずらし量を
 *   数値として** エージェントへ渡すための道具。
 *
 * 【なぜ「その個体だけ」動かすのか — 製品オーナーの判断】
 *   置きかたのルール（`LASH_PLACEMENT` など）を直接いじる案もあったが、
 *   「個体によって形態に大きく差があるので、一覧の全個体が動くとうまく
 *   いかない気がする」という理由でこちらを採った。
 *
 * 【なぜ絵ではなく「ずらし量」を保存するのか】
 *   ゲノモンの絵は `Genotype → Phenotype → RenderModel → SVG` で毎回ゼロから
 *   再構成される。SVG を直接編集しても次の描画で消えるし、エージェントにも
 *   何も伝わらない。パーツ単位の平行移動と倍率だけを持ち、描画時に上から掛ける。
 *
 * これは開発ツール専用。`lab.html` は本番ビルドに含まれない（AGENTS.md の
 * ルール 3）ので、ゲーム本体の描画には一切影響しない。
 */

import type { RenderModel } from '../core/types.ts';

/** パーツ 1 つの調整（viewBox 座標）。 */
export interface PartOffset {
  dx: number;
  dy: number;
  /** 倍率（1 で等倍）。 */
  k?: number;
  /** 拡大縮小の中心。子パーツは **親の中心** を使うので明示的に持たせる。 */
  ox?: number;
  oy?: number;
}

/** パーツ ID → 調整。 */
export type Nudges = Record<string, PartOffset>;

/** 中心のずれた拡大を防ぐため、倍率と中心はいつも一緒に扱う。 */
export const scaleOf = (o: PartOffset | undefined): number => o?.k ?? 1;

/**
 * 左右で対になるパーツ。片方を動かしたらもう片方も動かす（横は鏡）。
 *
 * 耳・角・触角などは **1 つのパーツの中に左右両方が描かれている** ので、
 * そのまま動かせば両方動く。ここに挙げるのは「左右が別パーツになっている」
 * ものだけ。額の 3 つめの目（`eye2` / `lash2`）に相方はいない。
 */
const MIRROR_PAIRS: Readonly<Record<string, string>> = {
  eye0: 'eye1',
  eye1: 'eye0',
  lash0: 'lash1',
  lash1: 'lash0',
};

export const mirrorPartOf = (id: string): string | null => MIRROR_PAIRS[id] ?? null;

/**
 * 「一緒に動くべき子パーツ」。
 *
 * まつげは目とは別パーツにしてあるが、**目を動かしたらまつげも付いていく**
 * のが自然（実際に目だけ動かすと、まつげがその場に取り残されて別物になる）。
 * 逆にまつげだけを動かしたいときは目は動かさない。親→子の一方向。
 */
const CHILD_PARTS: Readonly<Record<string, readonly string[]>> = {
  eye0: ['lash0'],
  eye1: ['lash1'],
  eye2: ['lash2'],
};

/**
 * あるパーツを掴んだとき、実際に動かす対象の一覧。
 *
 *   `sx`       … 横方向の符号（左右連動の相方は −1 ＝ 鏡）
 *   `originId` … 拡大縮小の中心に使うパーツ。**子は親の中心で拡大する**
 *                （それぞれ自分の中心で拡大すると、目とまつげが離れる）
 */
export function linkedTargets(id: string, mirror: boolean): { id: string; sx: number; originId: string }[] {
  const out = [{ id, sx: 1, originId: id }];
  for (const c of CHILD_PARTS[id] ?? []) out.push({ id: c, sx: 1, originId: id });
  if (mirror) {
    const mate = mirrorPartOf(id);
    if (mate) {
      out.push({ id: mate, sx: -1, originId: mate });
      for (const c of CHILD_PARTS[mate] ?? []) out.push({ id: c, sx: -1, originId: mate });
    }
  }
  return out;
}

/** 動かしても意味が無い／動かすと分かりにくくなるパーツ。 */
const NOT_DRAGGABLE = new Set(['shadow', 'glow', 'body', 'outline']);

export const isDraggablePart = (id: string): boolean => !NOT_DRAGGABLE.has(id);

/** 何も変えていない状態か。 */
export const isNoop = (o: PartOffset | undefined): boolean =>
  !o || (Math.abs(o.dx) < 0.05 && Math.abs(o.dy) < 0.05 && Math.abs(scaleOf(o) - 1) < 0.005);

const round = (v: number): number => Math.round(v * 100) / 100;

/** SVG の transform 文字列。 */
function transformOf(o: PartOffset): string {
  const k = scaleOf(o);
  const move = `translate(${round(o.dx)} ${round(o.dy)})`;
  if (Math.abs(k - 1) < 0.005) return move;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  return `${move} translate(${round(ox)} ${round(oy)}) scale(${round(k)}) translate(${round(-ox)} ${round(-oy)})`;
}

/** 点に同じ変換を掛ける（bbox・検査点をずらすため）。 */
function mapPoint(o: PartOffset, x: number, y: number): { x: number; y: number } {
  const k = scaleOf(o);
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  return { x: ox + (x - ox) * k + o.dx, y: oy + (y - oy) * k + o.dy };
}

/**
 * 調整を反映した RenderModel を返す（元のモデルは変更しない）。
 * パーツの SVG を `<g transform="…">` で包むだけ。
 */
export function applyNudges(model: RenderModel, nudges: Nudges): RenderModel {
  if (!Object.values(nudges).some((o) => !isNoop(o))) return model;
  return {
    ...model,
    parts: model.parts.map((p) => {
      const o = nudges[p.id];
      if (isNoop(o)) return p;
      const off = o!;
      const k = scaleOf(off);
      return {
        ...p,
        svg: `<g transform="${transformOf(off)}">${p.svg}</g>`,
        ...(p.bbox
          ? (() => {
              const a = mapPoint(off, p.bbox.x, p.bbox.y);
              return { bbox: { x: a.x, y: a.y, w: p.bbox.w * k, h: p.bbox.h * k } };
            })()
          : {}),
        ...(p.probes ? { probes: p.probes.map((q) => mapPoint(off, q.x, q.y)) } : {}),
      };
    }),
  };
}

/** 人が読める 1 行（コメント欄やレポートに貼る用）。 */
export function nudgeSummary(nudges: Nudges): string {
  return Object.entries(nudges)
    .filter(([, o]) => !isNoop(o))
    .map(([id, o]) => {
      const k = scaleOf(o);
      const s = Math.abs(k - 1) < 0.005 ? '' : ` ×${round(k)}`;
      return `${id}:(${round(o.dx)},${round(o.dy)})${s}`;
    })
    .join(' ');
}

/** パーツの中心（拡大の基準）を引くための関数。 */
export type CenterOf = (id: string) => { x: number; y: number } | null;

/** 矢印ボタンなど、ドラッグ以外から動かす。 */
export function nudgeBy(nudges: Nudges, id: string, dx: number, dy: number, mirror: boolean): Nudges {
  const next: Nudges = { ...nudges };
  for (const t of linkedTargets(id, mirror)) {
    const cur = next[t.id] ?? { dx: 0, dy: 0 };
    next[t.id] = { ...cur, dx: round(cur.dx + dx * t.sx), dy: round(cur.dy + dy) };
  }
  return next;
}

/**
 * 拡大縮小。`factor` は 1.08 なら 8% 大きく、1/1.08 なら小さく。
 *
 * 中心は **掴んだパーツ（またはその相方）の中心**。子パーツも同じ中心で
 * 拡大するので、目を大きくするとまつげも一緒に大きくなり、位置関係が保たれる。
 */
export function scaleBy(
  nudges: Nudges,
  id: string,
  factor: number,
  mirror: boolean,
  centerOf: CenterOf,
): Nudges {
  const next: Nudges = { ...nudges };
  for (const t of linkedTargets(id, mirror)) {
    const c = centerOf(t.originId);
    if (!c) continue;
    const cur = next[t.id] ?? { dx: 0, dy: 0 };
    next[t.id] = {
      ...cur,
      // 中心は最初に決めたものを保つ（毎回引き直すと、ずらした後に
      // 拡大したとき中心も動いて絵が飛ぶ）。
      ox: cur.ox ?? c.x,
      oy: cur.oy ?? c.y,
      k: Math.max(0.2, Math.min(4, round(scaleOf(cur) * factor))),
    };
  }
  return next;
}

export interface DragHooks {
  /** いま有効な調整を読む。 */
  get(): Nudges;
  /** ドラッグ確定時に呼ばれる。 */
  commit(next: Nudges): void;
  /** 掴んでいるパーツが変わったとき（表示更新用）。 */
  onPick(id: string | null): void;
  /** 左右連動するか。 */
  mirror(): boolean;
}

/**
 * `container` の中の SVG に、パーツのドラッグを取り付ける。
 * 戻り値を呼ぶと解除できる（再描画のたびに付け直す）。
 */
export function attachPartDrag(container: HTMLElement, hooks: DragHooks): () => void {
  const svg = container.querySelector('svg');
  if (!svg) return () => {};

  /**
   * 【この時点で SVG に「焼き込まれている」調整量】
   *
   *   再描画のとき `applyNudges` がパーツの中へ transform を入れている。
   *   ドラッグ中の表示は **外側の `[data-part]` グループ** に transform を
   *   置くので、合計値をそのまま書くと確定済みのぶんと **二重に掛かる**。
   *   2 回目以降のドラッグで「離した瞬間にパッと戻る」のがこれだった
   *   （実測：確定量ぶんちょうど戻る）。外側に書くのは差分だけにする。
   */
  const baked = hooks.get();
  const bakedOf = (id: string): { dx: number; dy: number } => {
    const o = baked[id];
    return { dx: o?.dx ?? 0, dy: o?.dy ?? 0 };
  };

  let dragging: {
    id: string;
    targets: { id: string; sx: number; originId: string }[];
    startX: number;
    startY: number;
    base: { dx: number; dy: number };
  } | null = null;

  /** 画面座標 → SVG の viewBox 座標。拡大率や余白を自分で計算しないで済む。 */
  const toUser = (ev: PointerEvent): { x: number; y: number } | null => {
    const ctm = (svg as SVGSVGElement).getScreenCTM();
    if (!ctm) return null;
    const pt = (svg as SVGSVGElement).createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const u = pt.matrixTransform(ctm.inverse());
    return { x: u.x, y: u.y };
  };

  const paint = (id: string, total: { dx: number; dy: number }): void => {
    const g = svg.querySelector<SVGGElement>(`[data-part="${CSS.escape(id)}"]`);
    if (!g) return;
    const b = bakedOf(id);
    g.setAttribute('transform', `translate(${round(total.dx - b.dx)} ${round(total.dy - b.dy)})`);
  };

  const onDown = (ev: PointerEvent): void => {
    const target = (ev.target as Element | null)?.closest('[data-part]');
    if (!target) return;
    const id = target.getAttribute('data-part') ?? '';
    if (!id || !isDraggablePart(id)) return;
    const u = toUser(ev);
    if (!u) return;
    const cur = hooks.get()[id];
    dragging = {
      id,
      targets: linkedTargets(id, hooks.mirror()),
      startX: u.x,
      startY: u.y,
      base: { dx: cur?.dx ?? 0, dy: cur?.dy ?? 0 },
    };
    hooks.onPick(id);
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!dragging) return;
    const u = toUser(ev);
    if (!u) return;
    const dx = dragging.base.dx + (u.x - dragging.startX);
    const dy = dragging.base.dy + (u.y - dragging.startY);
    // 相方は横だけ鏡にする（顔の中心線に対して外向き／内向きを揃えるため）。
    for (const t of dragging.targets) paint(t.id, { dx: dx * t.sx, dy });
  };

  const onUp = (ev: PointerEvent): void => {
    if (!dragging) return;
    const u = toUser(ev);
    const d = dragging;
    dragging = null;
    if (!u) return;
    const dx = round(d.base.dx + (u.x - d.startX));
    const dy = round(d.base.dy + (u.y - d.startY));
    const next: Nudges = { ...hooks.get() };
    for (const t of d.targets) {
      next[t.id] = { ...(next[t.id] ?? { dx: 0, dy: 0 }), dx: round(dx * t.sx), dy };
    }
    hooks.commit(next);
  };

  svg.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  return () => {
    svg.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
}
