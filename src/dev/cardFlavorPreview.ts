/**
 * Cards Lab のフレーバーテキスト版面プレビュー。
 *
 * Cards Lab は base / palette を seed とは別に強制できるため、seed だけから
 * Phenotype を再生成すると「いまカードに載っている個体」と違う場合がある。
 * そこでここでは、文字量・余白・読みやすさを見るための seed 固定文だけを重ねる。
 * 本番の個体カードでは game/flavor.ts の deriveFlavorText(実Phenotype) を使う。
 */

import { Rng } from '../core/rng.ts';

const PREVIEW_LINES: readonly string[] = [
  '見た目だけで残した個体が、三代あとに系統の基準になった。',
  '一代の姿を見て、系統を語ってはいけない。',
  '記録紙をめくる音にだけ、ほんの少し耳を動かした。',
  '珍しい個体は探せる。残すべき個体は、育てなければ分からない。',
  '静かな日は、呼吸に合わせて模様まで動いて見える。',
  '最初の記録には、特徴より先に「よく見ること」とだけ書かれている。',
  '似ていることと、同じであることは違う。育種家はその差を残す。',
  'この子を選んだ理由は説明できなかった。次の世代を見て、ようやく分かった。',
  '古い標本帳では、この系統だけ余白が広く取られていた。',
  '育種家は、見えているものより見えていないものを長く覚える。',
];

const KIND: readonly string[] = ['FIELD NOTE', 'BREEDER NOTE', 'ARCHIVE', 'OLD SAYING'];

function preview(seed: string): { kind: string; text: string } {
  const rng = new Rng(seed).stream('card:flavor-preview');
  return { kind: rng.pick(KIND), text: rng.pick(PREVIEW_LINES) };
}

function enhance(card: HTMLElement): void {
  if (card.dataset.flavorPreview === '1' || card.classList.contains('gmc-q-lite')) return;
  const seed = card.dataset.seed;
  if (!seed) return;
  const body = card.querySelector<HTMLElement>('.gmc-body');
  if (!body) return;

  const f = preview(seed);
  const node = document.createElement('div');
  node.className = 'gmc-flavor-preview';
  node.setAttribute('aria-label', `${f.kind}: ${f.text}`);

  const design = card.dataset.design;
  if (design === 'collector') {
    node.innerHTML = `<span>“${escapeHtml(f.text)}”</span>`;
    node.style.cssText =
      'position:absolute;left:5.8%;right:5.8%;bottom:15.5%;z-index:4;' +
      'font-family:var(--gmc-serif);font-size:2.15cqw;line-height:1.45;' +
      'letter-spacing:.045em;color:var(--gmc-ink-soft);text-align:left;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;';
  } else if (design === 'natural') {
    node.innerHTML = `<b>${escapeHtml(f.kind)}</b><span>${escapeHtml(f.text)}</span>`;
    node.style.cssText =
      'position:absolute;left:7.2%;right:7.2%;bottom:5.0%;z-index:4;' +
      'display:flex;gap:.65em;align-items:baseline;border-top:.05em solid var(--gmc-ink);' +
      'padding-top:.45em;color:var(--gmc-ink-soft);pointer-events:none;';
    const b = node.querySelector<HTMLElement>('b');
    const span = node.querySelector<HTMLElement>('span');
    if (b) b.style.cssText = 'font-size:1.35cqw;letter-spacing:.22em;flex:0 0 auto;';
    if (span) span.style.cssText = 'font-family:var(--gmc-serif);font-size:1.55cqw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  } else {
    node.innerHTML = `<b>${escapeHtml(f.kind)}</b><span>“${escapeHtml(f.text)}”</span>`;
    node.style.cssText =
      'position:absolute;left:7%;right:7%;bottom:6.2%;z-index:4;' +
      'display:flex;gap:.6em;align-items:baseline;color:var(--gmc-ink-soft);pointer-events:none;';
    const b = node.querySelector<HTMLElement>('b');
    const span = node.querySelector<HTMLElement>('span');
    if (b) b.style.cssText = 'font-size:1.25cqw;letter-spacing:.2em;flex:0 0 auto;';
    if (span) span.style.cssText = 'font-family:var(--gmc-serif);font-size:1.5cqw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  }

  body.appendChild(node);
  card.dataset.flavorPreview = '1';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

export function installCardFlavorPreview(root: ParentNode = document): () => void {
  const scan = (node: ParentNode): void => {
    if (node instanceof HTMLElement && node.matches('.gmc-card')) enhance(node);
    node.querySelectorAll?.<HTMLElement>('.gmc-card').forEach(enhance);
  };

  scan(root);
  const target = root instanceof Document ? root.documentElement : root;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof HTMLElement) scan(n);
      }
    }
  });
  observer.observe(target, { childList: true, subtree: true });
  return () => observer.disconnect();
}
