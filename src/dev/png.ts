/**
 * SVG 文字列 → PNG。
 *
 * 【やり方】
 *   SVG を data: URL にして <img> へ読ませ、canvas に描いて toDataURL する。
 *   ゲノモンの SVG は外部参照（フォント・画像・CSS）を一切持たない自己完結型なので、
 *   canvas が汚染されず toDataURL が使える。
 *
 * 【落とし穴と対処】
 *   1. <img> に読ませる SVG は width/height 属性が要る（100% だと 0×0 になる）。
 *      呼び出し側が px 値を渡す前提にしてある。
 *   2. 日本語を含むので btoa は使えない。encodeURIComponent でエスケープする。
 *   3. <img> 経由の SVG では :root[data-theme] が効かない（別文書扱いのため）。
 *      暗背景で書き出したい場合は background を渡して下地を塗る。
 */

/** SVG の width/height 属性を差し替える（無ければ足す）。 */
function withPixelSize(svg: string, w: number, h: number): string {
  let out = svg;
  out = /\swidth="[^"]*"/.test(out)
    ? out.replace(/\swidth="[^"]*"/, ` width="${w}"`)
    : out.replace('<svg', `<svg width="${w}"`);
  out = /\sheight="[^"]*"/.test(out)
    ? out.replace(/\sheight="[^"]*"/, ` height="${h}"`)
    : out.replace('<svg', `<svg height="${h}"`);
  return out;
}

export interface PngOpts {
  /** 出力ピクセル幅。 */
  width: number;
  height: number;
  /** 解像度倍率（既定 2）。 */
  scale?: number;
  /** 下地の色（null なら透過）。 */
  background?: string | null;
}

/** SVG を PNG の dataURL にする。 */
export function svgToPngDataUrl(svg: string, opts: PngOpts): Promise<string> {
  const scale = opts.scale ?? 2;
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const sized = withPixelSize(svg, w, h);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('2d コンテキストを取得できませんでした'));
          return;
        }
        if (opts.background) {
          ctx.fillStyle = opts.background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => reject(new Error('SVG を画像として読み込めませんでした'));
    img.src = url;
  });
}
