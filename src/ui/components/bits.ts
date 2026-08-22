/**
 * 小さな表示部品（HTML 断片を返す純関数）。
 *
 * ボタン・カード・ゲージ・ピルの見た目をここに集約して、
 * 全画面で同じ形・同じ色・同じ間隔になるようにする（指示書 §16「デザインを統一する」）。
 */

import type { Creature, Phenotype, Rarity, Stage } from '../../core/types.ts';
import { esc } from '../dom.ts';
import {
  GAUGES_EGG,
  GAUGES_LIVE,
  RARITY_LABEL,
  STAGE_ICON,
  STAGE_LABEL,
  generationLabel,
  levelOf,
  pct,
} from '../format.ts';
import type { GaugeDef } from '../format.ts';
import { thumbSvg } from '../creatureView.ts';
import { icon, iconOrText } from '../icons.ts';

/** ゲージ 1 本。 */
export function gauge(def: GaugeDef, value: number, big = false): string {
  const v = pct(value);
  const lv = levelOf(v);
  return (
    `<div class="gauge${big ? ' gauge--big' : ''}" data-gauge="${esc(String(def.key))}">` +
    `<div class="gauge__head"><span>${iconOrText(def.icon)} ${esc(def.label)}</span>` +
    `<span class="gauge__val">${v}</span></div>` +
    `<div class="gauge__track" role="meter" aria-label="${esc(def.label)}" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100">` +
    `<i class="gauge__fill" data-level="${lv}" style="width:${v}%"></i></div></div>`
  );
}

/** 段階に応じたゲージ一式。 */
export function gaugesFor(c: Creature): string {
  const defs = c.life.stage === 'egg' ? GAUGES_EGG : GAUGES_LIVE;
  const inner = defs
    .map((d) => {
      let v = Number(c.life[d.key] ?? 0);
      // 成体は成長が打ち止めなので、満タン表示にして「もう伸びない」ことを見せる。
      if (d.key === 'growth' && c.life.stage === 'adult') v = 100;
      return gauge(d, v);
    })
    .join('');
  return `<div class="gauges">${inner}</div>`;
}

/** 希少度ピル。伏せる段階では「？」を出す。 */
export function rarityPill(rarity: Rarity | null, stage: Stage): string {
  if (!rarity) {
    const why =
      stage === 'egg'
        ? 'たまごのうちは分かりません'
        : stage === 'juvenile'
          ? '成体になると、見た目から少し分かるようになります'
          : '正確な希少度は鑑定すると分かります';
    return `<span class="pill" title="${esc(why)}">${icon('spark')} めずらしさ ？</span>`;
  }
  return `<span class="pill rar rar--${rarity.tier}">${icon('spark')} ${esc(RARITY_LABEL[rarity.tier])}</span>`;
}

export function stagePill(stage: Stage): string {
  return `<span class="pill">${iconOrText(STAGE_ICON[stage])} ${esc(STAGE_LABEL[stage])}</span>`;
}

/** 「今後解放」の案内。ダミーボタンの代わりにこれを出す。 */
export function lockedNotice(title: string, hint: string, ico = 'lock'): string {
  return (
    `<div class="locked"><span class="locked__ico" aria-hidden="true">${iconOrText(ico)}</span>` +
    `<span class="locked__body"><strong class="locked__title">${esc(title)}｜今後解放</strong>${esc(hint)}</span></div>`
  );
}

export function emptyState(ico: string, lines: string[]): string {
  return (
    `<div class="empty"><span class="empty__ico" aria-hidden="true">${iconOrText(ico)}</span>` +
    lines.map((l) => esc(l)).join('<br>') +
    `</div>`
  );
}

export interface CardOpts {
  /** 押したときの遷移先ハッシュ。省略時は button として扱う。 */
  href?: string;
  /** 選択状態（交配・展示会の選択で使う）。 */
  pressed?: boolean;
  /** data-id に入れる値。 */
  id?: string;
  /** 追加のピル。 */
  extraPills?: string[];
  /** 副題を差し替える。 */
  meta?: string;
  /** 希少度を出すか（幼体では伏せる判断は呼び出し側でする）。 */
  rarity?: Rarity | null;
  /** クリック対象の data 属性名。 */
  action?: string;
}

/** 個体カード（標本帳・展示会・交配で共通）。 */
export function creatureCard(c: Creature, pheno: Phenotype, o: CardOpts = {}): string {
  const art = thumbSvg(pheno, c.life, `${c.name}（${STAGE_LABEL[c.life.stage]}）`);
  const pills = [stagePill(c.life.stage), rarityPill(o.rarity ?? null, c.life.stage), ...(o.extraPills ?? [])].join('');
  const meta = o.meta ?? `${generationLabel(c.generation)}${c.bestScore > 0 ? ` / 最高${Math.round(c.bestScore)}点` : ''}`;
  // 絵は aria-hidden。SVG 内の <style> が textContent に混じり、
  // 読み上げソフトが CSS を読んでしまうのを防ぐ（名前は下の span で読める）。
  const inner =
    `<span class="ccard__art" aria-hidden="true">${art}</span>` +
    `<span class="ccard__name">${esc(c.name)}</span>` +
    `<span class="ccard__meta">${esc(meta)}</span>` +
    `<span class="ccard__pills">${pills}</span>`;

  if (o.href) {
    return `<a class="ccard" href="${esc(o.href)}" data-id="${esc(c.id)}">${inner}</a>`;
  }
  return (
    `<button type="button" class="ccard" data-${esc(o.action ?? 'pick')}="${esc(c.id)}"` +
    ` aria-pressed="${o.pressed ? 'true' : 'false'}">${inner}</button>`
  );
}
