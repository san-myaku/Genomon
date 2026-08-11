/**
 * 開発者モード（指示書 §20）。
 *
 * 【セーブの扱い — ここが一番大事】
 *   このパネルはゲームの GameState を**メモリ上で**書き換える。
 *   localStorage の 'genomon.save.v1' へは、
 *   **利用者が「セーブに書き込む」を押したときだけ** 書き込む（既定は書き込まない）。
 *   さらに、はじめて書き込む直前に現在のセーブ文字列を
 *   開発ツール所有のキー（genomon.dev.savebackup.v1）へ丸ごと退避する。
 *   遊んでいるセーブを開発ツールが黙って壊すことが無いようにするため。
 *
 * 【game レイヤの触り方】
 *   原則 src/game/index.ts（API.md の契約）だけを使う。
 *   ただし「任意 seed の個体を足す」「即時孵化させる」は契約に無い操作なので、
 *   game/state.ts の createCreature と game/growth.ts の advanceStageIfReady を直に使う。
 *   どちらも読むだけ・呼ぶだけで、game 側のファイルは一切変更していない。
 */

import type { CatLocus, Creature, GameState, LifeState, Stage } from '../core/types.ts';
import { makeSeed, normalizeSeed } from '../core/rng.ts';
import { randomGenotype } from '../genetics/genotype.ts';
import { breed } from '../genetics/breeding.ts';
import { CAT_LOCI } from '../genetics/loci.ts';
import {
  applyTick,
  capacityUsed,
  getPhenotype,
  newGame,
  refreshUnlocks,
  releaseCreature,
} from '../game/index.ts';
import { createCreature } from '../game/state.ts';
import { advanceStageIfReady } from '../game/growth.ts';
import {
  SAVE_KEY,
  __readRawForTest,
  __writeRawForTest,
  clearSave,
  exportSave,
  load,
  save as saveToStorage,
  nextSeed,
} from '../save/index.ts';
import { $, delegate, esc, setHtml } from '../ui/dom.ts';
import { DEV_SAVE_BACKUP_KEY, getRaw, putRaw } from './labStore.ts';
import { copyText, downloadText, humanMs, pretty } from './util.ts';
import type { Mounted } from './visualLab.ts';

/** 0..100 のゲージ。UI に出す順。 */
const GAUGES: { key: keyof LifeState; label: string }[] = [
  { key: 'growth', label: '成長度' },
  { key: 'hatchProgress', label: '孵化進捗' },
  { key: 'hunger', label: '満腹' },
  { key: 'hydration', label: '水分' },
  { key: 'cleanliness', label: '清潔' },
  { key: 'mood', label: '機嫌' },
  { key: 'health', label: '健康' },
];

const STAGE_LABEL: Record<Stage, string> = { egg: '卵', juvenile: '幼体', adult: '成体' };

/** 時間を進めるプリセット（ミリ秒）。 */
const TIME_STEPS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

/**
 * tick.ts の OFFLINE_THRESHOLD_MS と同じ値（TIMING.tickMs * 8）。
 * これ以下の刻みで進めれば「オンライン扱い」の減衰・進行率になる。
 */
const ONLINE_STEP_MS = 2_000;
/** 刻み進行の上限回数。これを超えるならオフライン一括に切り替える。 */
const MAX_ONLINE_STEPS = 900;

export interface DevDeps {
  toast(msg: string, kind?: 'ok' | 'bad' | 'info'): void;
}

export function mountDevMode(host: HTMLElement, deps: DevDeps): Mounted {
  let state: GameState = loadState();
  let dirty = 0;
  /** 時間を進めるときにオンライン扱いで刻むか。 */
  let chunked = true;
  let timeInput = 10;

  function loadState(): GameState {
    const r = load();
    if (r.ok) {
      refreshUnlocks(r.state);
      return r.state;
    }
    if (r.reason === 'corrupt' && r.recovered) return r.recovered;
    return newGame();
  }

  const touch = (): void => {
    dirty++;
    render();
  };

  // ── セーブへの書き込み（明示操作のときだけ） ──────────

  function writeSave(): void {
    // 初回だけ、現在のセーブ文字列を開発ツール所有のキーへ丸ごと退避する。
    if (!getRaw(DEV_SAVE_BACKUP_KEY)) {
      const raw = __readRawForTest(SAVE_KEY);
      if (raw) putRaw(DEV_SAVE_BACKUP_KEY, raw);
    }
    state.updatedAt = Date.now();
    const r = saveToStorage(state);
    if (r.ok) {
      dirty = 0;
      deps.toast('セーブに書き込みました。', 'ok');
    } else {
      deps.toast(`書き込めませんでした: ${r.error}`, 'bad');
    }
    render();
  }

  function restoreBackup(): void {
    const raw = getRaw(DEV_SAVE_BACKUP_KEY);
    if (!raw) {
      deps.toast('開発ツールのバックアップがありません。', 'bad');
      return;
    }
    if (!window.confirm('開発ツールのバックアップでセーブを上書きします。よろしいですか？')) return;
    __writeRawForTest(SAVE_KEY, raw);
    state = loadState();
    dirty = 0;
    deps.toast('バックアップから復元しました。', 'ok');
    render();
  }

  // ── 時間 ───────────────────────────────────────────────

  function advanceTime(deltaMs: number): void {
    if (deltaMs <= 0 || state.creatures.length === 0) {
      deps.toast('進める対象がありません。', 'bad');
      return;
    }
    const steps = chunked ? Math.ceil(deltaMs / ONLINE_STEP_MS) : 1;
    const useChunk = chunked && steps <= MAX_ONLINE_STEPS;
    let left = deltaMs;
    let hatched = 0;
    let grownUp = 0;
    const unlocked: string[] = [];

    while (left > 0) {
      const d = useChunk ? Math.min(left, ONLINE_STEP_MS) : left;
      left -= d;
      // 「最後に tick した時刻」を巻き戻してから通常の applyTick を通す。
      // 未来の now を渡すと lastTickAt が未来に飛び、以後の実時間 tick が全部無効になる。
      for (const c of state.creatures) c.life.lastTickAt -= d;
      const r = applyTick(state, Date.now());
      hatched += r.hatched.length;
      grownUp += r.grownUp.length;
      unlocked.push(...r.unlocked);
    }

    const mode = useChunk ? 'オンライン扱い（等倍）' : 'オフライン扱い（減衰0.5倍・進行0.6倍）';
    deps.toast(
      `${humanMs(deltaMs)} 進めました｜${mode}｜孵化 ${hatched} / 成体化 ${grownUp}` +
        (unlocked.length ? ` / 解放 ${unlocked.join(',')}` : ''),
      'ok',
    );
    touch();
  }

  // ── 個体の操作 ─────────────────────────────────────────

  function creatureById(id: string): Creature | undefined {
    return state.creatures.find((c) => c.id === id);
  }

  function forceStage(c: Creature, to: 'juvenile' | 'adult'): void {
    const now = Date.now();
    if (to === 'juvenile') {
      if (c.life.stage !== 'egg') {
        deps.toast('卵ではありません。', 'bad');
        return;
      }
      c.life.hatchProgress = 100;
    } else {
      if (c.life.stage === 'adult') {
        deps.toast('すでに成体です。', 'bad');
        return;
      }
      // 卵からいきなり成体にする場合は 2 段階を通す（hatch の初期化を飛ばさない）。
      if (c.life.stage === 'egg') {
        c.life.hatchProgress = 100;
        const first = advanceStageIfReady(state, c, now);
        if (first.blocked) {
          deps.toast(first.blocked, 'bad');
          touch();
          return;
        }
      }
      c.life.growth = 100;
    }
    const r = advanceStageIfReady(state, c, now);
    if (r.blocked) deps.toast(r.blocked, 'bad');
    else deps.toast(`${c.name} を ${STAGE_LABEL[r.evolved ?? c.life.stage]} にしました。`, 'ok');
    refreshUnlocks(state);
    touch();
  }

  function addFromSeed(rawSeed: string): void {
    const seed = normalizeSeed(rawSeed);
    const g = randomGenotype(seed);
    const c = createCreature(state, g, Date.now(), {
      parents: null,
      parentNames: null,
      generation: 1,
      fromBreeding: false,
    });
    state.creatures.push(c);
    if (!state.activeCreatureId) state.activeCreatureId = c.id;
    deps.toast(`seed ${seed} の卵（${c.name}）を追加しました。`, 'ok');
    touch();
  }

  function makeChild(aId: string, bId: string, mutationScale: number, locus: string, allele: string): void {
    const a = creatureById(aId);
    const b = creatureById(bId);
    if (!a || !b) {
      deps.toast('親を 2 体えらんでください。', 'bad');
      return;
    }
    const force: Partial<Record<CatLocus, string>> | undefined =
      locus && allele ? ({ [locus]: allele } as Partial<Record<CatLocus, string>>) : undefined;
    const childSeed = nextSeed(state);
    const genotype = breed(a.genotype, b.genotype, childSeed, { mutationScale, force });
    const egg = createCreature(state, genotype, Date.now(), {
      parents: [a.id, b.id] as const,
      parentNames: [a.name, b.name] as const,
      generation: Math.max(a.generation, b.generation) + 1,
      fromBreeding: true,
    });
    state.creatures.push(egg);
    state.stats.bred += 1;
    deps.toast(
      `${a.name} × ${b.name} の子（${egg.name} / ${childSeed}）を作りました` +
        `｜変異率 ${mutationScale}×${force ? ` / 強制 ${locus}=${allele}` : ''}`,
      'ok',
    );
    touch();
  }

  // ── 描画 ───────────────────────────────────────────────

  function render(): void {
    const used = capacityUsed(state);
    setHtml(
      host,
      `<div class="card">` +
        `<h2>セーブの状態</h2>` +
        `<p class="tagline">` +
        `<span>worldSeed <code>${esc(state.worldSeed)}</code></span>` +
        `<span>コイン ${state.coins}</span>` +
        `<span>個体 ${state.creatures.length}（卵${used.egg}/幼体${used.juvenile}/成体${used.adult}）</span>` +
        `<span>解放 ${esc(Object.entries(state.unlocks).filter(([, v]) => v).map(([k]) => k).join(' '))}</span>` +
        `<span>統計 孵化${state.stats.hatched} 成体${state.stats.grownUp} 交配${state.stats.bred} 展示${state.stats.exhibitions}</span>` +
        `</p>` +
        `<div class="row">` +
        `<button data-act="reload">セーブを読み直す</button>` +
        `<button data-act="export">JSON を書き出す</button>` +
        `<button data-act="copy-state">JSON をコピー</button>` +
        `<button data-act="restore">開発バックアップから復元</button>` +
        `<button class="danger" data-act="reset">セーブを初期化</button>` +
        `</div>` +
        `<p class="hint">この画面の操作は<strong>メモリ上の state</strong> にだけ効きます。` +
        `<code>genomon.save.v1</code> へは「セーブに書き込む」を押したときだけ書き込みます` +
        `（初回書き込みの直前に <code>genomon.dev.savebackup.v1</code> へ退避します）。</p>` +
        `</div>` +
        timeCard() +
        coinCard() +
        unlockCard() +
        seedCard() +
        breedCard() +
        creaturesCard() +
        dirtyBar(),
    );
  }

  function timeCard(): string {
    return (
      `<div class="card"><h2>時間を進める</h2><div class="row">` +
      TIME_STEPS.map((ms) => `<button data-act="time" data-ms="${ms}">${esc(humanMs(ms))}</button>`).join('') +
      `<label class="f">任意 <input type="number" id="d-time" min="1" max="720" step="1" value="${timeInput}" style="width:5em">分</label>` +
      `<button class="primary" data-act="time-custom">進める</button>` +
      `<label class="f"><input type="checkbox" id="d-chunked"${chunked ? ' checked' : ''}>` +
      `オンライン扱いで刻む（2 秒ずつ・等倍）</label>` +
      `</div><p class="hint">チェックを外すと 1 回のオフライン復帰として扱われます` +
      `（減衰 0.5 倍・進行 0.6 倍・上限 2 時間）。刻みが ${MAX_ONLINE_STEPS} 回を超える場合は自動でオフライン扱いになります。</p></div>`
    );
  }

  function coinCard(): string {
    return (
      `<div class="card"><h2>コイン</h2><div class="row">` +
      [10, 100, 1000, 10000].map((v) => `<button data-act="coin" data-v="${v}">+${v}</button>`).join('') +
      `<button data-act="coin" data-v="-100">-100</button>` +
      `<button data-act="coin-zero">0 にする</button>` +
      `<span class="mono">いま ${state.coins}</span></div></div>`
    );
  }

  function unlockCard(): string {
    const keys = Object.keys(state.unlocks) as (keyof GameState['unlocks'])[];
    return (
      `<div class="card"><h2>解放</h2><div class="row">` +
      keys
        .map(
          (k) =>
            `<button data-act="unlock" data-k="${esc(k)}" aria-pressed="${state.unlocks[k] ? 'true' : 'false'}">` +
            `${state.unlocks[k] ? '✓ ' : ''}${esc(k)}</button>`,
        )
        .join('') +
      `<button class="primary" data-act="unlock-all">全部 解放</button>` +
      `<button data-act="unlock-refresh">条件を再評価</button>` +
      `</div></div>`
    );
  }

  function seedCard(): string {
    return (
      `<div class="card"><h2>任意 seed を読み込む</h2><div class="row">` +
      `<label class="f">個体 seed <input type="text" id="d-seed" value="LAB-0001" size="14"></label>` +
      `<button class="primary" data-act="add-seed">この seed の卵を追加</button>` +
      `<button data-act="add-random">ランダム seed で追加</button>` +
      `</div><div class="row">` +
      `<label class="f">worldSeed <input type="text" id="d-world" value="${esc(state.worldSeed)}" size="20"></label>` +
      `<button class="danger" data-act="new-world">この worldSeed で新規ゲーム</button>` +
      `</div></div>`
    );
  }

  function breedCard(): string {
    // 親B の既定は 2 体目にする（両方 1 体目だと「自分と自分」の子ができて紛らわしい）。
    const optionsFor = (defaultIndex: number): string =>
      state.creatures
        .map(
          (c, i) =>
            `<option value="${esc(c.id)}"${i === defaultIndex ? ' selected' : ''}>` +
            `${esc(c.name)}（${esc(STAGE_LABEL[c.life.stage])} / ${esc(c.seed)}）</option>`,
        )
        .join('');
    const opts = optionsFor(0);
    const optsB = optionsFor(Math.min(1, state.creatures.length - 1));
    const locusOpts =
      `<option value="">（強制なし）</option>` +
      CAT_LOCI.map((l) => `<option value="${l.locus}">${esc(l.label)}（${l.locus}）</option>`).join('');
    return (
      `<div class="card"><h2>親を指定して子を作る</h2><div class="row">` +
      `<label class="f">親A <select id="d-pa">${opts}</select></label>` +
      `<label class="f">親B <select id="d-pb">${optsB}</select></label>` +
      `</div><div class="row">` +
      `<label class="f">突然変異率 <input type="range" id="d-mut" min="0" max="20" step="0.5" value="1" style="width:150px">` +
      `<output id="d-mut-out" class="mono">1×</output></label>` +
      `<label class="f">形質を強制 <select id="d-flocus">${locusOpts}</select></label>` +
      `<label class="f"><select id="d-fallele"><option value="">（なし）</option></select></label>` +
      `<button class="primary" data-act="child">子を作る</button>` +
      `</div><p class="hint">交配の条件（成体・機嫌・健康・コスト・クールダウン）は無視して直接 breed() を呼びます。` +
      `突然変異率 20× なら 1 座あたり約 36% で変異します。</p></div>`
    );
  }

  function creaturesCard(): string {
    if (!state.creatures.length) {
      return `<div class="card"><h2>個体</h2><p class="hint">個体がいません。上の「任意 seed を読み込む」で追加できます。</p></div>`;
    }
    return (
      `<div class="card"><h2>個体（${state.creatures.length}）</h2>` +
      state.creatures.map((c) => creatureBlock(c)).join('') +
      `</div>`
    );
  }

  function creatureBlock(c: Creature): string {
    const p = getPhenotype(c);
    return (
      `<div class="card" style="background:var(--panel)">` +
      `<div class="row"><strong class="grow">${esc(c.name)}` +
      `<span class="mono" style="font-weight:400;color:var(--fg-soft)"> ${esc(c.seed)} / ${esc(c.id)}</span></strong>` +
      `<span class="mono">${esc(STAGE_LABEL[c.life.stage])} · ${esc(p.base)} · ${esc(p.palette.family)} · ${esc(p.rarity.tier)} · 第${c.generation}世代</span>` +
      `</div>` +
      `<div class="row" style="margin-top:6px">` +
      `<button data-act="hatch" data-id="${esc(c.id)}">即時 孵化</button>` +
      `<button data-act="grow" data-id="${esc(c.id)}">即時 成体化</button>` +
      `<button data-act="fill" data-id="${esc(c.id)}">全ゲージ 100</button>` +
      `<button data-act="empty" data-id="${esc(c.id)}">全ゲージ 10</button>` +
      `<button data-act="copy-c" data-id="${esc(c.id)}">JSON をコピー</button>` +
      `<button class="danger" data-act="release" data-id="${esc(c.id)}">手放す</button>` +
      `</div>` +
      `<div style="margin-top:6px">` +
      GAUGES.map((g) => {
        const v = Math.round(Number(c.life[g.key]));
        return (
          `<label class="gauge"><span>${esc(g.label)}</span>` +
          `<input type="range" min="0" max="100" step="1" value="${v}" data-gauge="${esc(g.key)}" data-id="${esc(c.id)}">` +
          `<output>${v}</output></label>`
        );
      }).join('') +
      `</div>` +
      `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--fg-soft)">個体データ（JSON）</summary>` +
      `<div class="scroll" style="margin-top:4px"><pre class="mono" style="margin:0;padding:6px;font-size:11px">` +
      esc(pretty({ creature: c, phenotype: p })) +
      `</pre></div></details>` +
      `</div>`
    );
  }

  function dirtyBar(): string {
    return (
      `<div class="dirtybar">` +
      `<strong class="grow">${dirty ? `未保存の変更 ${dirty} 件` : '未保存の変更はありません'}</strong>` +
      `<button class="primary" data-act="write">セーブに書き込む</button>` +
      `<button data-act="reload">破棄して読み直す</button>` +
      `</div>`
    );
  }

  // ── 入力 ───────────────────────────────────────────────

  const offInput = delegate(host, 'input', 'input,select', (t) => {
    const el = t as HTMLInputElement;

    const gauge = el.dataset.gauge as keyof LifeState | undefined;
    if (gauge && el.dataset.id) {
      const c = creatureById(el.dataset.id);
      if (c) {
        (c.life[gauge] as number) = Number(el.value);
        const out = el.parentElement?.querySelector('output');
        if (out) out.textContent = el.value;
        dirty++;
        const bar = $('.dirtybar strong', host);
        if (bar) bar.textContent = `未保存の変更 ${dirty} 件`;
      }
      return;
    }

    switch (el.id) {
      case 'd-time':
        timeInput = Number(el.value) || 1;
        break;
      case 'd-chunked':
        chunked = el.checked;
        break;
      case 'd-mut': {
        const o = $('#d-mut-out', host);
        if (o) o.textContent = `${el.value}×`;
        break;
      }
      case 'd-flocus': {
        const def = CAT_LOCI.find((l) => l.locus === el.value);
        const sel = $<HTMLSelectElement>('#d-fallele', host);
        if (sel) {
          sel.innerHTML =
            `<option value="">（なし）</option>` +
            (def ? def.alleles.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}（${esc(a.id)}）</option>`).join('') : '');
        }
        break;
      }
      default:
        break;
    }
  });

  const offClick = delegate(host, 'click', 'button', (t) => {
    const act = t.dataset.act;
    const id = t.dataset.id;
    const c = id ? creatureById(id) : undefined;

    switch (act) {
      case 'reload':
        state = loadState();
        dirty = 0;
        deps.toast('セーブを読み直しました。');
        render();
        break;
      case 'write':
        writeSave();
        break;
      case 'restore':
        restoreBackup();
        break;
      case 'export':
        downloadText(`genomon-save-${Date.now()}.json`, exportSave(state), 'application/json');
        break;
      case 'copy-state':
        void copyText(exportSave(state)).then((ok) => deps.toast(ok ? 'コピーしました。' : 'コピーできませんでした', ok ? 'ok' : 'bad'));
        break;
      case 'reset':
        if (!window.confirm('セーブを初期化します（genomon.save.v1 と backup を消して新規 state にします）。よろしいですか？')) break;
        clearSave();
        state = newGame();
        dirty = 0;
        deps.toast('初期化しました。', 'ok');
        render();
        break;
      case 'time':
        advanceTime(Number(t.dataset.ms) || 0);
        break;
      case 'time-custom':
        advanceTime(Math.max(1, timeInput) * 60_000);
        break;
      case 'coin':
        state.coins = Math.max(0, state.coins + (Number(t.dataset.v) || 0));
        touch();
        break;
      case 'coin-zero':
        state.coins = 0;
        touch();
        break;
      case 'unlock': {
        const k = t.dataset.k as keyof GameState['unlocks'] | undefined;
        if (k) state.unlocks[k] = !state.unlocks[k];
        touch();
        break;
      }
      case 'unlock-all':
        for (const k of Object.keys(state.unlocks) as (keyof GameState['unlocks'])[]) state.unlocks[k] = true;
        touch();
        break;
      case 'unlock-refresh': {
        const opened = refreshUnlocks(state);
        deps.toast(opened.length ? `解放: ${opened.join(', ')}` : '新たに解放されたものはありません。');
        touch();
        break;
      }
      case 'add-seed':
        addFromSeed($<HTMLInputElement>('#d-seed', host)?.value ?? '');
        break;
      case 'add-random':
        addFromSeed(makeSeed(`dev/${Date.now()}`, Math.floor(Math.random() * 1e9)));
        break;
      case 'new-world': {
        const w = $<HTMLInputElement>('#d-world', host)?.value.trim();
        if (!w) break;
        if (!window.confirm(`worldSeed "${w}" で新規 state を作ります（メモリ上のみ）。よろしいですか？`)) break;
        state = newGame(w);
        deps.toast(`新規 state を作りました（worldSeed=${w}）。`, 'ok');
        touch();
        break;
      }
      case 'child':
        makeChild(
          $<HTMLSelectElement>('#d-pa', host)?.value ?? '',
          $<HTMLSelectElement>('#d-pb', host)?.value ?? '',
          Number($<HTMLInputElement>('#d-mut', host)?.value ?? '1'),
          $<HTMLSelectElement>('#d-flocus', host)?.value ?? '',
          $<HTMLSelectElement>('#d-fallele', host)?.value ?? '',
        );
        break;
      case 'hatch':
        if (c) forceStage(c, 'juvenile');
        break;
      case 'grow':
        if (c) forceStage(c, 'adult');
        break;
      case 'fill':
        if (c) {
          for (const g of GAUGES) (c.life[g.key] as number) = 100;
          touch();
        }
        break;
      case 'empty':
        if (c) {
          for (const g of GAUGES) (c.life[g.key] as number) = 10;
          touch();
        }
        break;
      case 'copy-c':
        if (c) {
          void copyText(pretty({ creature: c, phenotype: getPhenotype(c) })).then((ok) =>
            deps.toast(ok ? 'コピーしました。' : 'コピーできませんでした', ok ? 'ok' : 'bad'),
          );
        }
        break;
      case 'release':
        if (c) {
          const r = releaseCreature(state, c.id);
          deps.toast(r.reason ?? (r.ok ? '手放しました。' : '手放せません。'), r.ok ? 'ok' : 'bad');
          touch();
        }
        break;
      default:
        break;
    }
  });

  render();

  return {
    dispose() {
      offInput();
      offClick();
    },
  };
}
