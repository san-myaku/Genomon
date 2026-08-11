/**
 * UI アイコンの検証。
 *
 * 【なぜ型ではなくテストなのか】
 *   世話ボタンのアイコンは `CareDef.icon`（core/types.ts）、
 *   ショップの分類アイコンは `ITEM_ICON`（ui/format.ts）に置いてある。
 *   これらを `IconName` 型にすれば綴り間違いを型検査で止められるが、
 *   `CareDef` は core の型なので、core が ui/icons.ts に依存することになる。
 *   層の向きを壊す代償のほうが大きいので、`string` のままにして、
 *   **実在しない名前が混ざっていないこと**をここで機械的に確かめる。
 *
 *   `iconOrText()` は名前でなければ文字としてそのまま出す。つまり綴りを
 *   間違えると画面に「flame」と英単語が出る（実際に一度出した）。
 *   このテストはその再発を止めるためにある。
 */

import { describe, expect, it } from 'vitest';
import { icon, isIconName } from '../src/ui/icons.ts';
import { CARE_DEFS } from '../src/game/config.ts';
import { DECOR_VIEW, GAUGES_EGG, GAUGES_LIVE, ITEM_ICON, STAGE_ICON } from '../src/ui/format.ts';

describe('UI アイコン', () => {
  it('世話アクションのアイコンはすべて実在する', () => {
    const bad = Object.values(CARE_DEFS)
      .filter((d) => !isIconName(d.icon))
      .map((d) => `${d.action}: ${d.icon}`);
    expect(bad).toEqual([]);
  });

  it('ゲージ・段階・品目・装飾のアイコンはすべて実在する', () => {
    const entries: [string, string][] = [
      ...GAUGES_LIVE.map((g) => [`gauge:${String(g.key)}`, g.icon] as [string, string]),
      ...GAUGES_EGG.map((g) => [`gaugeEgg:${String(g.key)}`, g.icon] as [string, string]),
      ...Object.entries(STAGE_ICON).map(([k, v]) => [`stage:${k}`, v] as [string, string]),
      ...Object.entries(ITEM_ICON).map(([k, v]) => [`item:${k}`, v] as [string, string]),
      ...Object.entries(DECOR_VIEW).map(([k, v]) => [`decor:${k}`, v.glyph] as [string, string]),
    ];
    const bad = entries.filter(([, v]) => !isIconName(v)).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it('同じ画面に並ぶアイコンは重複しない', () => {
    // ゲージは 1 か所に並ぶので、同じ絵が 2 つあると読み分けられない。
    const live = GAUGES_LIVE.map((g) => g.icon);
    expect(new Set(live).size).toBe(live.length);
    const egg = GAUGES_EGG.map((g) => g.icon);
    expect(new Set(egg).size).toBe(egg.length);

    // 世話ボタンも段階ごとに 1 画面へ並ぶ。
    for (const stage of ['egg', 'juvenile', 'adult'] as const) {
      const icons = Object.values(CARE_DEFS)
        .filter((d) => d.stages.includes(stage))
        .map((d) => d.icon);
      expect(new Set(icons).size, `${stage} の世話ボタンで絵が重複している`).toBe(icons.length);
    }
  });

  it('出力は外部を参照しない自己完結した SVG である', () => {
    const svg = icon('sprout');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('stroke="currentColor"');
    // 画像・フォント・スクリプトを引っぱってこないこと（生きものと同じ規約）。
    expect(svg).not.toMatch(/https?:|<image|<script|url\(/);
  });

  it('label を渡すと読み上げ用の名前が付き、渡さなければ装飾扱いになる', () => {
    expect(icon('lock', { label: '今後解放' })).toContain('aria-label="今後解放"');
    expect(icon('lock')).toContain('aria-hidden="true"');
  });

  it('アイコン名でない文字列は名前として認識されない', () => {
    expect(isIconName('🌱')).toBe(false);
    expect(isIconName('sproutt')).toBe(false);
    expect(isIconName('constructor')).toBe(false);
  });
});
