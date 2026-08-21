/**
 * まつげの回帰テスト。
 *
 * 【なぜ専用のテストが要るのか】
 *   2026-08-15 のレビューで見つかった不良（まつげが目から浮いて黒い動物に
 *   見える／まぶたのインクと重なって黒い塊になる／とげが目の中へ垂れて檻に
 *   見える／体の輪郭を突き抜ける）は、**既存のテストを 221 件すべて通過して
 *   いた**。「SVG に差分がある」ことしか見ていなかったからで、
 *   *どこに* 描かれたかを誰も検査していなかった。
 *
 *   ここでは絵そのものではなく、**まつげと目の位置関係** を検査する。
 *   絵の良し悪しは目で見るしかないが、「目から離れている」「体から出ている」
 *   「そもそも描かれていない」は数値で捕まえられる。
 */

import { describe, expect, it } from 'vitest';
import type { Genotype } from '../src/core/types.ts';
import { phenotypeOf, randomGenotype } from '../src/genetics/index.ts';
import { buildRenderModel } from '../src/render/model.ts';
import { inspectModel } from '../src/render/inspect.ts';
import { isLowerLash, lashBaseY, styleOf, upperContourY } from '../src/render/parts/face.ts';

const EYE_SHAPES = ['round', 'oval', 'wide', 'sleepy', 'leaf', 'crescent', 'starry', 'smirk'] as const;
const LASHES = ['lash', 'mid', 'long', 'sideLong', 'upper', 'lower', 'sleepy', 'droopy'] as const;
const PUPILS = ['round', 'bead'] as const;

function forced(seed: string, over: Record<string, string>): Genotype {
  const base = randomGenotype(seed);
  const cat = { ...base.cat } as unknown as Record<string, readonly [string, string]>;
  for (const [k, v] of Object.entries(over)) cat[k] = [v, v];
  return { ...base, cat: cat as unknown as Genotype['cat'] };
}

function modelFor(seed: string, over: Record<string, string>, stage: 'adult' | 'juvenile' = 'adult') {
  return buildRenderModel(phenotypeOf(forced(seed, over), stage), null, {
    detail: 'full',
    uid: `lash-${seed}-${Object.values(over).join('-')}-${stage}`,
  });
}

/** 目パーツ。 */
function eyesOf(model: ReturnType<typeof buildRenderModel>) {
  return model.parts.filter((p) => /^eye\d+$/.test(p.id));
}

/**
 * 目と、その目に付いたまつげの組。
 *
 * まつげは Visual Lab で目とは別に掴めるよう **独立したパーツ**（`lash0` …）
 * として出している。位置の検査には「目の寸法（`eye.bbox`）」と
 * 「まつげの輪郭（`lash.probes`）」の両方が要るので、組にして扱う。
 */
function pairsOf(model: ReturnType<typeof buildRenderModel>) {
  return eyesOf(model).map((eye) => ({
    eye,
    lash: model.parts.find((p) => p.id === `lash${eye.id.slice(3)}`),
  }));
}

/**
 * まつげの検査点を、**目のローカル座標**（中心 0,0・傾きを戻した向き）へ直す。
 *
 * `probes` は親の座標系で入っているが、目のグループは形ごとに傾いている
 * （このは −14 度・したりめ 22 度）ので、そのまま水平・垂直を測ると
 * 傾きぶんずれる。SVG の transform から傾きを読み取って戻す。
 */
function toLocal(pair: ReturnType<typeof pairsOf>[number]) {
  const { eye, lash } = pair;
  const m = lash ? /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/.exec(lash.svg) : null;
  const probes = lash?.probes ?? [];
  if (!m || !probes.length || !eye.bbox) return null;
  const cx = Number(m[1]);
  const cy = Number(m[2]);
  const a = (-Number(m[3]) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    rx: eye.bbox.w / 2,
    ry: eye.bbox.h / 2,
    pts: probes.map((q) => {
      const dx = q.x - cx;
      const dy = q.y - cy;
      return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
    }),
  };
}

describe('まつげの位置', () => {
  it('どの目の形・どの種類でも、まつげが実際に描かれる', () => {
    const missing: string[] = [];
    for (const shape of EYE_SHAPES) {
      for (const kind of LASHES) {
        for (const pupil of PUPILS) {
          const model = modelFor('LASH-DRAWN', { eyeShape: shape, pupil, lashes: kind, eyeCount: 'two' });
          const withProbes = pairsOf(model).filter((q) => (q.lash?.probes?.length ?? 0) > 0);
          if (withProbes.length !== 2) missing.push(`${shape}/${pupil}/${kind}:${withProbes.length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * 【いちばん大事な検査 — レビュー A-1 / A-2 の再発防止】
   *   まつげは「まぶたのインクの下辺」まで下りてきて、インクと **重なる**
   *   のが正しい。目の外側の輪郭に載せると地肌の上に浮いた別の塊になり、
   *   みかづき／したりめでは黒い動物に、ねむたげ／このは では
   *   まぶたの上に積み上がった黒いヘルメットになる。
   *
   *   ここは実際に出力されたまつげの点を、目のローカル座標へ戻して測る
   *   （置きかたの計算式ではなく **結果** を見る）。
   */
  it('まつげの下辺が、まぶたのインクの下辺まで下りている', () => {
    const bad: string[] = [];
    for (const shape of EYE_SHAPES) {
      for (const kind of LASHES) {
        if (isLowerLash(kind)) continue; // 下まつげは下辺が基準なので別扱い
        for (const pupil of PUPILS) {
          const model = modelFor('LASH-BASE', { eyeShape: shape, pupil, lashes: kind, eyeCount: 'two' });
          for (const pair of pairsOf(model)) {
            const local = toLocal(pair);
            if (!local) continue;
            const { rx, ry, pts } = local;
            const eye = pair.eye;
            // 置く基準になっている中央付近だけを見る。検査点は輪郭から
            // 間引いて拾っているので、窓が狭すぎると 1 点も入らない原画がある。
            const near = pts.filter((q) => Math.abs(q.x) < rx * 0.45);
            if (!near.length) { bad.push(`${shape}/${pupil}/${kind}/${eye.id}: 中央に点が無い`); continue; }
            const lowest = Math.max(...near.map((q) => q.y));
            const base = lashBaseY(
              { parts: { pupil }, mood: { droop: 0 }, strokeW: 3 } as never,
              shape,
              styleOf(shape),
              rx,
              ry,
              0,
            );
            // `LASH_PLACEMENT.sink` の下限は −0.14（おねむ＝インクへ引き上げる）。
            // そのぶんの余裕を見てもなお、外周基準に戻したら落ちる厳しさ。
            if (lowest < base - ry * 0.2) {
              bad.push(`${shape}/${pupil}/${kind}/${eye.id}: 下辺${lowest.toFixed(1)} < 基準${base.toFixed(1)}`);
            }
          }
        }
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  });

  /**
   * 上の検査は「基準線 `lashBaseY` に対して、まつげがそこまで下りているか」を
   * 見ている。基準線そのものを外周へ戻されると、まつげも一緒に上がるので
   * あの検査は通ってしまう。**基準線の意味** はここで別に固定する。
   *
   *   まつげを置く線は、目の外周ではなく **上のインクの下辺**。
   *   ＝ 外周より必ず内側（下）にある。
   *
   * 白目を持たない点目（`bead`）は面全体がインクで、外周がそのまま
   * インクの上端なので対象外（沈める量 `sink` が重なりを作る）。
   */
  it('まつげの基準線は、目の外周より内側にある（外周に戻していない）', () => {
    const bad: string[] = [];
    for (const shape of EYE_SHAPES) {
      const rx = 16;
      const ry = shape === 'oval' ? 22 : 14;
      const base = lashBaseY(
        { parts: { pupil: 'round' }, mood: { droop: 0 }, strokeW: 3 } as never,
        shape,
        styleOf(shape),
        rx,
        ry,
        0,
      );
      const outer = upperContourY(shape, rx, ry, 0);
      if (base < outer + 1) bad.push(`${shape}: base=${base.toFixed(2)} outer=${outer.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  });

  /**
   * 【白目を持たない目で、まつげを器の中へ沈めてはいけない — 第2ラウンドの指摘】
   *   たまご（べた目）と つぶら（点目）は器の中がまるごと濃い虹彩で、
   *   インクとの明度差は 1.2〜1.8:1（1.0 で同色）しかない。ここへ深く沈めると
   *   沈めた部分は **色が同じで見えなくなり**、地肌へはみ出した細い毛だけが
   *   残って「目から離れて浮いた毛」に見える（実個体 `QHJS-K7MY` ほか）。
   *   白目のある目の `sink`（0.30ry）をそのまま使わせないよう上限を固定する。
   */
  it('白目の無い目では、まつげを器の中へ深く沈めない', () => {
    const bad: string[] = [];
    // たまご＝べた目 / つぶら＝点目。どちらも白目を持たない。
    const cases: [string, string][] = [
      ['oval', 'round'],
      ['round', 'bead'],
      ['wide', 'bead'],
      ['leaf', 'bead'],
    ];
    for (const [shape, pupil] of cases) {
      for (const kind of LASHES) {
        if (isLowerLash(kind)) continue;
        const model = modelFor('LASH-SOLID', { eyeShape: shape, pupil, lashes: kind, eyeCount: 'two' });
        for (const pair of pairsOf(model)) {
          const local = toLocal(pair);
          if (!local) continue;
          const { rx, ry, pts } = local;
          const eye = pair.eye;
          const near = pts.filter((q) => Math.abs(q.x) < rx * 0.45);
          if (!near.length) continue;
          const lowest = Math.max(...near.map((q) => q.y));
          const outer = upperContourY(shape, rx, ry, 0);
          // 輪郭リング（線幅 strokeW*0.82）に重なるぶんまで。
          // それより深いと、まつげ本体が濃い虹彩に溶けて見えなくなる。
          // 沈める上限は `strokeW * 0.35`（≒1.0）という **絶対量** なので、
          // 下限を 1.8 に置く（`ry` 比だけだと小さい点目で厳しくなりすぎる）。
          // 白目のある目と同じ 0.30ry を使うと、たまごでは約 7 も沈むので
          // この閾値では確実に落ちる。
          const limit = outer + Math.max(ry * 0.26, 2.4);
          if (lowest > limit) {
            bad.push(`${shape}/${pupil}/${kind}/${eye.id}: 下辺${lowest.toFixed(1)} > 限界${limit.toFixed(1)}`);
          }
        }
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  });

  /**
   * まつげは目のふちに触れていなければならない。
   * 検査点の中に「目の中心の高さより上」だけでなく、
   * **目の器の縦の範囲に食い込んでいる点** があることを確かめる。
   */
  it('まつげのインクが、目の器の範囲に食い込んでいる（浮いていない）', () => {
    const floating: string[] = [];
    for (const shape of EYE_SHAPES) {
      for (const kind of LASHES) {
        const model = modelFor('LASH-TOUCH', { eyeShape: shape, lashes: kind, eyeCount: 'two' });
        for (const { eye, lash } of pairsOf(model)) {
          const b = eye.bbox!;
          const probes = lash?.probes ?? [];
          const inside = probes.filter(
            (q) => q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h,
          );
          // 器の矩形に 1 点も入っていない ＝ 完全に外に浮いている
          if (inside.length === 0) floating.push(`${shape}/${kind}/${eye.id}`);
        }
      }
    }
    expect(floating).toEqual([]);
  });

  /**
   * 原画は「外向きに跳ねる」構図で、左右の目は `scale(-1 1)` で鏡にしている。
   * ここが壊れると両目とも同じ側へ跳ねる。左右対称な個体では、2 つの目の
   * まつげが顔の中心線に対してぴったり鏡像になっていなければならない。
   *
   * 目の傾き（このは −14 度・したりめ 22 度）に依存しない検査なので、
   * 全部の形にそのまま掛けられる。
   */
  it('左右の目のまつげが、顔の中心線に対して鏡像になる', () => {
    // 目が回る個体（asymmetry > 0.5）は左右で傾きが変わるので、
    // 鏡像にならないのが正しい。対称な個体を選ぶ。
    let seed = '';
    for (let i = 0; i < 500 && !seed; i++) {
      const s = `LASH-MIRROR-${i}`;
      if (phenotypeOf(randomGenotype(s), 'adult').asymmetry <= 0.5) seed = s;
    }
    expect(seed, '左右対称な個体が見つからない').not.toBe('');

    const wrong: string[] = [];
    for (const shape of EYE_SHAPES) {
      for (const kind of LASHES) {
        // ねむたげ・このは の白目は **それ自体が左右非対称** な形で、しかも
        // 左右の目に同じ向きで描かれる（グループは回すだけで鏡にしない）。
        // 下まつげはその下辺に沿わせるので、左右で形が違うのが正しい。
        if (isLowerLash(kind) && (shape === 'sleepy' || shape === 'leaf')) continue;
        const ps = pairsOf(modelFor(seed, { eyeShape: shape, lashes: kind, eyeCount: 'two' }));
        if (ps.length !== 2) continue;
        const [a, b] = ps as [(typeof ps)[0], (typeof ps)[0]];
        const faceCx =
          (a.eye.bbox!.x + a.eye.bbox!.w / 2 + b.eye.bbox!.x + b.eye.bbox!.w / 2) / 2;
        const key = (pts: readonly { x: number; y: number }[], sign: number) =>
          pts
            .map((q) => `${(sign * (q.x - faceCx)).toFixed(2)},${q.y.toFixed(2)}`)
            .sort()
            .join(' ');
        if (key(a.lash?.probes ?? [], 1) !== key(b.lash?.probes ?? [], -1)) {
          wrong.push(`${shape}/${kind}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * まつげは目尻の外へはみ出し、目頭側へはほとんど出ない。
   *
   * 目のグループは形ごとに傾いている（このは −14 度・したりめ 22 度）ため、
   * 回転すると「外へどれだけ出たか」を水平距離で測れなくなる。
   * ここは傾きの小さい形だけで、原画の向きが反転していないことを見る。
   */
  it('傾きの小さい目では、まつげが目頭側より目尻側へ大きくはみ出す', () => {
    const wrong: string[] = [];
    for (const shape of ['round', 'oval', 'wide', 'starry'] as const) {
      for (const kind of LASHES) {
        const ps = pairsOf(modelFor('LASH-DIR', { eyeShape: shape, lashes: kind, eyeCount: 'two' }));
        if (ps.length < 2) continue;
        const faceCx = ps.reduce((s, q) => s + (q.eye.bbox!.x + q.eye.bbox!.w / 2), 0) / ps.length;
        for (const { eye, lash } of ps) {
          const b = eye.bbox!;
          const probes = lash?.probes ?? [];
          if (!probes.length) continue;
          const outerIsRight = b.x + b.w / 2 > faceCx;
          let outer = 0;
          let inner = 0;
          for (const q of probes) {
            outer = Math.max(outer, outerIsRight ? q.x - (b.x + b.w) : b.x - q.x);
            inner = Math.max(inner, outerIsRight ? b.x - q.x : q.x - (b.x + b.w));
          }
          // 左右対称な下まつ毛・おねむは差が出ないので、逆転だけを不合格にする。
          if (outer < inner - 0.5) wrong.push(`${shape}/${kind}/${eye.id}: 外${outer.toFixed(1)} < 内${inner.toFixed(1)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('まつげが他を壊さないこと', () => {
  it('まつげを足しても、体からのはみ出し・目の重なりが増えない', () => {
    const introduced: string[] = [];
    for (let i = 0; i < 250; i++) {
      const seed = `LASH-REG-${i}`;
      const before = new Set(
        inspectModel(modelFor(seed, { lashes: 'none' })).issues.map((s) => s.replace(/\([\d.]+\)/, '')),
      );
      for (const kind of LASHES) {
        for (const issue of inspectModel(modelFor(seed, { lashes: kind })).issues) {
          const key = issue.replace(/\([\d.]+\)/, '');
          if (!before.has(key)) introduced.push(`${seed}/${kind}: ${issue}`);
        }
      }
    }
    expect(introduced.slice(0, 10)).toEqual([]);
  });

  it('幼体でも、まつげが体の輪郭からのはみ出しを増やさない', () => {
    const bad: string[] = [];
    for (let i = 0; i < 120; i++) {
      const seed = `LASH-JUV-${i}`;
      // まつげと無関係な既存のはみ出し（目そのものが輪郭を割っている個体）が
      // あるので、必ず同じ seed の `none` と比べる。
      const before = new Set(
        inspectModel(modelFor(seed, { lashes: 'none' }, 'juvenile')).issues.map((s2) => s2.replace(/\([\d.]+\)/, '')),
      );
      for (const kind of ['long', 'sideLong', 'sleepy'] as const) {
        for (const issue of inspectModel(modelFor(seed, { lashes: kind }, 'juvenile')).issues) {
          const key = issue.replace(/\([\d.]+\)/, '');
          if (!before.has(key)) bad.push(`${seed}/${kind}: ${issue}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});
