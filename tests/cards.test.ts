/**
 * Cards Lab のカード事実（cardModel.ts）の検証。
 *
 * 【何を守るテストか】
 *   カードの見た目は「同じ個体からは必ず同じ結果」でなければならない
 *   （AGENTS.md §1）。証明書番号・通し番号・foil のテクスチャ seed は
 *   すべて seed 由来の名前付きサブストリームから作っているが、
 *   うっかり `Date.now()` や `Math.random()` を混ぜると
 *   「開くたびに粒子配置が変わる Prism カード」になってしまう。
 *   ここで 2 回導出して完全一致することを機械的に確かめる。
 *
 * 描画（DOM）には触れない。cardDesign.ts / cardLab.ts はブラウザが要るので、
 * このテストは純粋な導出層だけを対象にする。
 */

import { describe, expect, it } from 'vitest';
import { HOLO_EFFECTS } from '@kongyo2/cards-css';
import { CARD_CSS } from '../src/dev/cardStyles.ts';
import { phenotypeOf } from '../src/genetics/phenotype.ts';
import { randomGenotype } from '../src/genetics/genotype.ts';
import {
  CARD_DESIGNS,
  CARD_FINISHES,
  CARD_GRADES,
  deriveCardFacts,
  toRoman,
  type CardGrade,
} from '../src/dev/cardModel.ts';

const SEEDS = ['CARD-A', 'CARD-B', 'GENOMON-CARD', 'ZLNX-BSZ2', 'PEARL-01'];

const phenoOf = (seed: string) => phenotypeOf(randomGenotype(seed), 'adult');

describe('cardModel — 決定論', () => {
  it('同じ個体・同じ Grade からは、毎回まったく同じカード事実が出る', () => {
    for (const seed of SEEDS) {
      const a = deriveCardFacts(phenoOf(seed), 9);
      const b = deriveCardFacts(phenoOf(seed), 9);
      expect(b).toEqual(a);
    }
  });

  it('foil のテクスチャ seed は個体ごとに違い、同じ個体では変わらない', () => {
    const seeds = new Set<number>();
    for (const seed of SEEDS) {
      const t1 = deriveCardFacts(phenoOf(seed), 9).textureSeed;
      const t2 = deriveCardFacts(phenoOf(seed), 6).textureSeed;
      expect(t2).toBe(t1); // Grade を変えても箔は変わらない
      expect(Number.isFinite(t1)).toBe(true);
      seeds.add(t1);
    }
    expect(seeds.size).toBe(SEEDS.length);
  });

  it('Grade を変えても、変わるのは Grade 表記だけ', () => {
    const base = deriveCardFacts(phenoOf('CARD-A'), 9);
    for (const g of CARD_GRADES) {
      const other = deriveCardFacts(phenoOf('CARD-A'), g);
      expect({ ...other, grade: base.grade, gradeWord: base.gradeWord }).toEqual(base);
    }
  });
});

describe('cardModel — カードに載る値', () => {
  it('証明書番号と通し番号が体裁どおりに出る', () => {
    for (const seed of SEEDS) {
      const f = deriveCardFacts(phenoOf(seed), 10);
      expect(f.certId).toMatch(/^GM-\d{8}$/);
      expect(f.code).toMatch(/^[A-Z]{4}-\d{2}$/);
      expect(f.print.text).toMatch(/^\d+\/\d+$/);
      expect(f.print.index).toBeGreaterThanOrEqual(1);
      expect(f.print.index).toBeLessThanOrEqual(f.print.total);
      expect(f.qrPayload).toBe(`genomon.app/g/${f.certId}`);
    }
  });

  it('模様・配色・希少度は Phenotype の実データを使う（ダミーにしない）', () => {
    for (const seed of SEEDS) {
      const pheno = phenoOf(seed);
      const f = deriveCardFacts(pheno, 8);
      expect(f.rarityScore).toBe(pheno.rarity.score);
      expect(f.rarityTier).toBe(pheno.rarity.tier);
      expect(f.baseLabel).toBe(pheno.baseLabel);
      const pattern = f.lines.find((l) => l.key === 'PATTERN');
      expect(pattern?.valueJa).toBe(pheno.traits.find((t) => t.locus === 'pattern')?.value);
    }
  });

  it('世代のローマ数字が正しい', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(8)).toBe('VIII');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(12)).toBe('XII');
  });
});

describe('cardModel — カタログの健全性', () => {
  it('すべての Finish がライブラリに実在する effect を指す', () => {
    const known = new Set<string>(HOLO_EFFECTS as readonly string[]);
    for (const f of CARD_FINISHES) {
      expect(known.has(f.effect), `${f.id} -> ${f.effect}`).toBe(true);
    }
  });

  it('主要 8 種がそろっていて、ID が重複しない', () => {
    const core = CARD_FINISHES.filter((f) => f.core).map((f) => f.id);
    expect(core).toEqual(['standard', 'silver', 'holo', 'prism', 'gold', 'aurora', 'crystal', 'cosmos']);
    expect(new Set(CARD_FINISHES.map((f) => f.id)).size).toBe(CARD_FINISHES.length);
    expect(new Set(CARD_DESIGNS.map((d) => d.id)).size).toBe(CARD_DESIGNS.length);
  });

  it('Grade は 6..10 の 5 段階', () => {
    expect(CARD_GRADES).toEqual([6, 7, 8, 9, 10] satisfies CardGrade[]);
  });
});

describe('cardStyles — テンプレートリテラルの事故を防ぐ', () => {
  /**
   * 【なぜこれを機械で見るか — 2 回壊した】
   *   CARD_CSS はテンプレートリテラルの中の CSS なので、次の 2 つを踏んだ。
   *     1. コメントに バッククォート を書いて文字列が途中で終わり、ビルドが止まった
   *     2. `content` の CSS エスケープが二重に潰れ、**制御文字**が焼き込まれて
   *        折りたたみの三角印が文字化けした（型検査もビルドも通ってしまう）
   *   2 番目は目で見ないと気づけないので、ここで機械的に弾く。
   */
  it('制御文字が混ざっていない', () => {
    const bad = [...CARD_CSS].filter((c) => {
      const n = c.codePointAt(0) ?? 0;
      return n < 9 || (n > 13 && n < 32) || n === 127;
    });
    expect(bad.map((c) => (c.codePointAt(0) ?? 0).toString(16))).toEqual([]);
  });

  it('波かっこの対応が取れている', () => {
    let depth = 0;
    for (const ch of CARD_CSS) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it('スマホの折りたたみ・デッキバー・幅の上限が消えていない', () => {
    // どれか 1 つでも落ちると、スマホでカードが画面に収まらなくなる。
    expect(CARD_CSS).toContain('.cards-deck');
    expect(CARD_CSS).toContain('--cards-deck-h');
    expect(CARD_CSS).toContain('.cards-fold');
    // .cards-right の暗黙カラムが max-content に戻ると、狭い画面で右が切れる。
    expect(CARD_CSS).toMatch(/\.cards-right\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  });
});
