/**
 * Cards Lab の導出層（cardModel / cardRarity / cardHistory / cardSeal / cardBack）の検証。
 *
 * 【何を守るテストか】
 *   1. カードは「同じ個体からは必ず同じ結果」でなければならない
 *      （AGENTS.md §1）。証明書番号・発行番号・foil のテクスチャ seed・
 *      認証印の地紋は、すべて seed 由来の名前付きサブストリームから作る。
 *      うっかり `Date.now()` や `Math.random()` を混ぜると
 *      「開くたびに粒子配置が変わる Prism カード」になる。
 *   2. **段（rarity）の強制は見た目だけ**で、遺伝データに触らないこと。
 *      Cards Lab の研究用オーバーライドが Phenotype を書き換えていたら、
 *      そこで見た判断は全部無意味になる。
 *   3. 段ごとに **素材そのもの** が変わること（文字色だけの実装に戻さない）。
 *   4. 裏面が本物の遺伝データを載せ、Lab のダミー経歴と混ざらないこと。
 *
 * 描画（DOM）には触れない。cardDesign.ts / cardLab.ts はブラウザが要るので、
 * このテストは純粋な導出層と、文字列を組み立てるだけの裏面を対象にする。
 */

import { describe, expect, it } from 'vitest';
import { HOLO_EFFECTS } from '@kongyo2/cards-css';
import { CARD_CSS } from '../src/dev/cardStyles.ts';
import { phenotypeOf } from '../src/genetics/phenotype.ts';
import { randomGenotype } from '../src/genetics/genotype.ts';
import { CAT_LOCI, NUM_LOCI } from '../src/genetics/loci.ts';
import type { Genotype, Phenotype } from '../src/core/types.ts';
import {
  CARD_DESIGNS,
  CARD_DESIGN_BY_ID,
  CARD_FINISHES,
  CARD_GRADES,
  DEFAULT_DESIGN,
  deriveCardFacts,
  resolveFinish,
  toRoman,
  type CardGrade,
} from '../src/dev/cardModel.ts';
import {
  CARD_RANKS,
  CARD_RANK_BY_ID,
  forcedRankPreviewScore,
  pipHtml,
  pipText,
  rankMaxScore,
  rankOfScore,
  resolveRank,
  type CardRank,
} from '../src/dev/cardRarity.ts';
import { deriveLabHistory } from '../src/dev/cardHistory.ts';
import { sealBlock, sealSvg, sealUid } from '../src/dev/cardSeal.ts';
import { cardBackHtml } from '../src/dev/cardBack.ts';
import type { CardSpec } from '../src/dev/cardDesign.ts';

const SEEDS = ['CARD-A', 'CARD-B', 'GENOMON-CARD', 'ZLNX-BSZ2', 'PEARL-01'];

const genoOf = (seed: string): Genotype => randomGenotype(seed);
const phenoOf = (seed: string): Phenotype => phenotypeOf(genoOf(seed), 'adult');

/** 裏面を組み立てるための最小の CardSpec（DOM は要らない）。 */
function specOf(seed: string, rank: CardRank | 'auto' = 'auto'): CardSpec {
  const pheno = phenoOf(seed);
  const treatment = resolveRank(pheno.rarity.score, rank, seed);
  return {
    pheno,
    genotype: genoOf(seed),
    facts: deriveCardFacts(pheno, 9),
    history: deriveLabHistory(seed, treatment.def.id),
    rank: treatment,
    design: 'collectorV2',
    finish: resolveFinish('auto', treatment.def.id),
    finishFromRank: true,
    quality: 'full',
    creatureSvg: '<svg></svg>',
    visuals: { foil: 1, glare: 1, tilt: 1, depth: true, mask: true, security: true },
    sealStyle: 'auto',
    flippable: true,
  };
}

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

  it('Lab の仮の経歴も決定論（親・展示・発行番号が毎回同じ）', () => {
    for (const seed of SEEDS) {
      for (const def of CARD_RANKS) {
        expect(deriveLabHistory(seed, def.id)).toEqual(deriveLabHistory(seed, def.id));
      }
    }
  });

  it('認証印の SVG も決定論（地紋と微細目盛りが毎回同じ）', () => {
    for (const seed of SEEDS) {
      const f = deriveCardFacts(phenoOf(seed), 9);
      const opts = {
        material: 'holo' as const,
        certId: f.certId,
        certifiedOn: '2025.01.01',
        uid: sealUid(seed, 'test'),
        security: 1,
      };
      expect(sealSvg(opts)).toBe(sealSvg(opts));
      // uid は SVG 内 id の衝突回避なので、同じ用途なら同じ値になること。
      expect(sealUid(seed, 'test')).toBe(sealUid(seed, 'test'));
    }
  });
});

describe('cardModel — カードに載る値', () => {
  it('証明書番号と型式番号が体裁どおりに出る', () => {
    for (const seed of SEEDS) {
      const f = deriveCardFacts(phenoOf(seed), 10);
      expect(f.certId).toMatch(/^GM-\d{8}$/);
      expect(f.code).toMatch(/^[A-Z]{4}-\d{2}$/);
      expect(f.qrPayload).toBe(`genomon.app/g/${f.certId}`);
    }
  });

  it('発行番号は Lab の経歴側にあり、段が上がるほど発行枚数が少ない', () => {
    for (const seed of SEEDS) {
      let prevTotal = Infinity;
      for (const def of CARD_RANKS) {
        const h = deriveLabHistory(seed, def.id);
        expect(h.print.text).toMatch(/^\d+\/\d+$/);
        expect(h.print.index).toBeGreaterThanOrEqual(1);
        expect(h.print.index).toBeLessThanOrEqual(h.print.total);
        expect(h.print.total).toBeLessThan(prevTotal);
        prevTotal = h.print.total;
      }
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

  /**
   * 【`traits` ではなく `parts` から数える（AGENTS.md §2.9 と同じ判断）】
   *   遺伝的に発現していても素体の都合で描かれない形質がある。
   *   表面の「見えている特徴」にそれを載せると、カードに描かれていないものを
   *   刷ってしまう。実際に描かれた対立遺伝子だけが並ぶこと。
   */
  it('表に出す特徴は、実際に描かれた対立遺伝子だけ', () => {
    for (let i = 0; i < 200; i++) {
      const seed = `headline-${i}`;
      const pheno = phenoOf(seed);
      const parts = pheno.parts as unknown as Record<string, unknown>;
      for (const line of deriveCardFacts(pheno, 9).headlineTraits) {
        const label = line.split('：')[0];
        const def = CAT_LOCI.find((d) => d.label === label);
        if (!def) continue;
        const drawn = parts[def.locus];
        if (typeof drawn === 'string') {
          expect(drawn, `${seed} / ${label} は姿に出ていない`).not.toBe('none');
        }
      }
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

describe('cardRarity — 段の体系', () => {
  it('既定の版面は Collector v2', () => {
    expect(DEFAULT_DESIGN).toBe('collectorV2');
    expect(CARD_DESIGNS[0]?.id).toBe(DEFAULT_DESIGN);
    expect(CARD_DESIGN_BY_ID[DEFAULT_DESIGN].legacy).toBe(false);
  });

  it('旧 Collector は消さずに残してある（比較用）', () => {
    const legacy = CARD_DESIGN_BY_ID.collector;
    expect(legacy).toBeDefined();
    expect(legacy.legacy).toBe(true);
    // 3 案（Certified / Natural History / 旧 Collector）が全部残っていること。
    for (const id of ['certified', 'natural', 'collector'] as const) {
      expect(CARD_DESIGN_BY_ID[id]).toBeDefined();
    }
  });

  it('段は 5 つ・しきい値は昇順・記号は 1..5 で重複しない', () => {
    expect(CARD_RANKS).toHaveLength(5);
    for (let i = 1; i < CARD_RANKS.length; i++) {
      expect(CARD_RANKS[i]!.minScore).toBeGreaterThan(CARD_RANKS[i - 1]!.minScore);
      expect(CARD_RANKS[i]!.pips).toBeGreaterThan(CARD_RANKS[i - 1]!.pips);
    }
    expect(CARD_RANKS.map((r) => r.pips)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(CARD_RANKS.map((r) => r.label)).size).toBe(CARD_RANKS.length);
  });

  it('点数から段が引ける（境界を含む）', () => {
    for (const def of CARD_RANKS) {
      expect(rankOfScore(def.minScore).id).toBe(def.id);
      expect(rankOfScore(rankMaxScore(def.id)).id).toBe(def.id);
      if (def.minScore > 0) expect(rankOfScore(def.minScore - 1).id).not.toBe(def.id);
    }
    expect(rankOfScore(0).id).toBe(CARD_RANKS[0]!.id);
    expect(rankOfScore(100).id).toBe(CARD_RANKS[CARD_RANKS.length - 1]!.id);
  });

  /**
   * 【§7 — 文字色だけを変える実装に戻さない】
   *   段が上がるにつれて「箔の量」「箔を掛ける場所」「地紋」「認証印の素材」
   *   「縁」「帯の質感」が **すべて** 変わること。どれか 1 つでも
   *   全段同じ値になったら、それは色替えに戻っている。
   */
  it('段ごとに素材そのものが変わる（色替えではない）', () => {
    const foils = CARD_RANKS.map((r) => r.foil);
    for (let i = 1; i < foils.length; i++) expect(foils[i]!).toBeGreaterThan(foils[i - 1]!);
    expect(foils[0]).toBe(0); // STANDARD は箔ゼロ

    // 光る場所は段が上がるほど増える（減ってはいけない）。
    for (let i = 1; i < CARD_RANKS.length; i++) {
      const prev = new Set(CARD_RANKS[i - 1]!.zones);
      for (const z of prev) expect(CARD_RANKS[i]!.zones, CARD_RANKS[i]!.id).toContain(z);
      expect(CARD_RANKS[i]!.zones.length).toBeGreaterThanOrEqual(prev.size);
    }

    for (const key of ['seal', 'edge', 'band'] as const) {
      expect(new Set(CARD_RANKS.map((r) => r[key])).size, key).toBe(CARD_RANKS.length);
    }
    const sec = CARD_RANKS.map((r) => r.security);
    for (let i = 1; i < sec.length; i++) expect(sec[i]!).toBeGreaterThanOrEqual(sec[i - 1]!);
  });

  it('認証印は「インク → 箔押し → ホロ箔押し」の順に進化する', () => {
    expect(CARD_RANK_BY_ID.standard.seal).toBe('ink');
    expect(CARD_RANK_BY_ID.notable.seal).toBe('inkFoil');
    expect(CARD_RANK_BY_ID.rare.seal).toBe('silver');
    expect(CARD_RANK_BY_ID.exceptional.seal).toBe('gold');
    expect(CARD_RANK_BY_ID.mythic.seal).toBe('holo');
  });

  it('記号は埋まっている数だけ光る', () => {
    for (const def of CARD_RANKS) {
      expect(pipText(def)).toHaveLength(CARD_RANKS.length);
      expect((pipHtml(def).match(/class="on"/g) ?? []).length).toBe(def.pips);
      expect((pipHtml(def).match(/<i/g) ?? []).length).toBe(CARD_RANKS.length);
    }
  });

  it('Finish の AUTO は段の既定を返す', () => {
    for (const def of CARD_RANKS) {
      expect(resolveFinish('auto', def.id)).toBe(def.finish);
      // 明示指定は段に関係なくそのまま通る。
      expect(resolveFinish('cosmos', def.id)).toBe('cosmos');
    }
  });
});

describe('cardRarity — 強制表示は見た目だけ（§19）', () => {
  /**
   * ここが崩れると、Cards Lab で見た判断がすべて無意味になる。
   * 「MYTHIC で見たときの遺伝子構成」が実物と違っていたら研究にならない。
   */
  it('段を強制しても Phenotype も Genotype も一切変わらない', () => {
    for (const seed of SEEDS) {
      const before = JSON.stringify({ g: genoOf(seed), p: phenoOf(seed) });
      for (const def of CARD_RANKS) {
        const t = resolveRank(phenoOf(seed).rarity.score, def.id, seed);
        expect(t.forced).toBe(true);
        expect(t.def.id).toBe(def.id);
        // 本当の点数は保持されたまま
        expect(t.trueScore).toBe(phenoOf(seed).rarity.score);
      }
      expect(JSON.stringify({ g: genoOf(seed), p: phenoOf(seed) })).toBe(before);
    }
  });

  it('強制しても、カードの事実（遺伝由来の値）は同じ', () => {
    for (const seed of SEEDS) {
      const auto = specOf(seed, 'auto');
      for (const def of CARD_RANKS) {
        const forced = specOf(seed, def.id);
        // 段で変わってよいのは経歴（発行枚数）と仕上げだけ。
        expect(forced.facts).toEqual(auto.facts);
        expect(forced.genotype).toEqual(auto.genotype);
        expect(forced.pheno.rarity).toEqual(auto.pheno.rarity);
      }
    }
  });

  it('AUTO は実データそのもの', () => {
    for (const seed of SEEDS) {
      const pheno = phenoOf(seed);
      const t = resolveRank(pheno.rarity.score, 'auto', seed);
      expect(t.forced).toBe(false);
      expect(t.score).toBe(pheno.rarity.score);
      expect(t.def.id).toBe(rankOfScore(pheno.rarity.score).id);
    }
  });

  it('強制時に刷る点数は、その段の範囲に収まっていて決定論', () => {
    for (const seed of SEEDS) {
      for (const def of CARD_RANKS) {
        const s1 = forcedRankPreviewScore(def.id, seed);
        expect(s1).toBe(forcedRankPreviewScore(def.id, seed));
        expect(s1).toBeGreaterThanOrEqual(def.minScore);
        expect(s1).toBeLessThanOrEqual(rankMaxScore(def.id));
      }
    }
  });
});

describe('cardSeal — 認証印', () => {
  const MATERIALS = ['ink', 'inkFoil', 'silver', 'gold', 'holo'] as const;

  it('どの素材でも印そのものが必ず出る', () => {
    for (const material of MATERIALS) {
      const svg = sealSvg({
        material,
        certId: 'GM-00012345',
        certifiedOn: '2025.06.01',
        uid: 'u1',
        security: material === 'ink' ? 0 : 1,
      });
      expect(svg).toContain('GENOMON APPRAISAL OFFICE');
      expect(svg).toContain('CERTIFIED');
      expect(svg).toContain('GM-00012345');
      // 【<rect> を使わない】ライブラリ CSS の width:auto で幅 0 に潰れる。
      expect(svg).not.toContain('<rect');
    }
  });

  it('箔の素材だけが円盤と艶の層を持つ（インクは紙に押しただけ）', () => {
    for (const material of MATERIALS) {
      const block = sealBlock({
        material,
        certId: 'GM-00012345',
        certifiedOn: '2025.06.01',
        uid: 'u2',
        security: 1,
      });
      const foil = material === 'silver' || material === 'gold' || material === 'holo';
      expect(block.includes('gmc-seal-shine'), material).toBe(foil);
      expect(block).toContain(`gmc-seal--${material}`);
    }
  });

  it('地紋は段が上のときだけ入る（STANDARD は素の印）', () => {
    const base = { certId: 'GM-00012345', certifiedOn: '2025.06.01', uid: 'u3' } as const;
    const plain = sealSvg({ ...base, material: 'ink', security: 0 });
    const secure = sealSvg({ ...base, material: 'holo', security: 1 });
    expect(plain).not.toContain('gmc-seal-guilloche');
    expect(plain).not.toContain('gmc-seal-ticks');
    expect(secure).toContain('gmc-seal-guilloche');
    expect(secure).toContain('gmc-seal-ticks');
    // 微細表現を入れても 430px で潰れないよう、線は細くしすぎない。
    for (const w of secure.match(/stroke-width="([\d.]+)"/g) ?? []) {
      expect(Number(w.replace(/\D*([\d.]+)\D*/, '$1'))).toBeGreaterThanOrEqual(0.3);
    }
  });
});

describe('cardBack — 裏面', () => {
  it('遺伝の欄は実データ。座の数はカタログから取る（固定値を書かない）', () => {
    const html = cardBackHtml(specOf('CARD-A'));
    expect(html).toContain(`${CAT_LOCI.length}<i>cat</i>${NUM_LOCI.length}<i>num</i>`);
    expect(html).toContain(`${CAT_LOCI.length + NUM_LOCI.length} LOCI`);
  });

  it('§14 — 全座をベタで並べない（要約と主要な数座まで）', () => {
    for (const seed of SEEDS) {
      const html = cardBackHtml(specOf(seed));
      const rows = (html.match(/<tr>/g) ?? []).length;
      expect(rows).toBeLessThanOrEqual(6);
      expect(html).toContain('GENETIC SUMMARY');
      expect(html).toContain('NOTABLE GENES');
    }
  });

  it('血統・交配・展示・認証・QR の欄がそろっている（§13）', () => {
    const html = cardBackHtml(specOf('CARD-B'));
    for (const key of [
      'IDENTIFICATION', 'RARITY', 'GENETIC SUMMARY', 'NOTABLE GENES',
      'PEDIGREE', 'BREEDING RECORD', 'SHOW RECORD',
      'GENOMON', 'APPRAISAL OFFICE', 'FULL GENETIC REPORT',
    ]) {
      expect(html, key).toContain(key);
    }
    expect(html).toContain('gmc-b-qr');
    expect(html).toContain('gmc-b-seal');
  });

  it('同じ個体・同じ設定なら、裏面は 1 文字も変わらない', () => {
    for (const seed of SEEDS) {
      expect(cardBackHtml(specOf(seed))).toBe(cardBackHtml(specOf(seed)));
    }
  });

  it('どの段でも認証印が裏面にある', () => {
    for (const def of CARD_RANKS) {
      const html = cardBackHtml(specOf('CARD-A', def.id));
      expect(html, def.id).toContain(`gmc-seal--${def.seal}`);
      expect(html, def.id).toContain(def.label);
    }
  });

  it('Lab の経歴はダミーだと型で分かる', () => {
    const spec = specOf('CARD-A');
    expect(spec.history.labOnly).toBe(true);
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
   *     2. content の CSS エスケープが二重に潰れ、**制御文字**が焼き込まれて
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

  it('裏返しの 3D と、動きを減らす設定への配慮が消えていない', () => {
    expect(CARD_CSS).toContain('.gmc-flip');
    expect(CARD_CSS).toContain('transform-style:preserve-3d');
    expect(CARD_CSS).toContain('backface-visibility:hidden');
    // reduced-motion では回さない（面の入れ替えだけにする）。
    const reduced = CARD_CSS.slice(CARD_CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('.gmc-flip[data-face="back"] .gmc-flip-inner{transform:none}');
  });

  /**
   * 【裏面の文字の下限 — 実測して入れた】
   *   cqw だけで組むと、スマホのカード実寸（258〜331px）では本文が 6px 台に
   *   落ちて読めなかった。px の下限が消えたら同じことが起きる。
   */
  it('裏面の文字寸法に px の下限が入っている', () => {
    expect(CARD_CSS).toMatch(/\.gmc--back\{font-size:max\(\d+px,/);
  });

  it('段ごとの帯と認証印の素材が CSS 側にそろっている', () => {
    for (const def of CARD_RANKS) {
      expect(CARD_CSS, def.band).toContain(`.gmc-v-band--${def.band}`);
      expect(CARD_CSS, def.seal).toContain(`.gmc-seal--${def.seal}`);
    }
    // ホロ箔だけが分光する。銀・金は方向のある艶。
    expect(CARD_CSS).toMatch(/\.gmc-seal--holo \.gmc-seal-shine\{[^}]*conic-gradient/);
    expect(CARD_CSS).not.toMatch(/\.gmc-seal--ink \.gmc-seal-shine\{[^}]*conic-gradient/);
  });
});
