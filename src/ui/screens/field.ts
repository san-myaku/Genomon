/**
 * 飼育フィールド。
 *
 * 育成室が「一体を丁寧に世話する場所」なら、ここは複数個体の生活を眺め、
 * 汚れを見つけ、買った遊具を配置する場所。個体の SVG は既存の描画窓口を使い、
 * この画面は生活状態と操作の見通しに集中する。
 */

import type { CareResult, FieldObjectKind, Creature } from '../../core/types.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader } from '../app.ts';
import { burstSparkles, $, $$, delegate, esc, playOnce, setHtml } from '../dom.ts';
import { confirmDialog } from '../components/dialog.ts';
import { emptyState, stagePill } from '../components/bits.ts';
import { toast } from '../components/toast.ts';
import { icon, type IconName } from '../icons.ts';
import { CARE_SFX, generationLabel, levelOf, pct } from '../format.ts';
import { mountCreature, thumbSvg } from '../creatureView.ts';
import { playReaction, reactionForCare } from '../../render/anim.ts';
import { sfx } from '../../audio/index.ts';
import {
  FIELD,
  SHOP_ITEM_BY_ID,
  cleanDropping,
  doCare,
  fieldBehaviorFor,
  fieldMotionFor,
  fieldSlotPosition,
  type FieldGait,
  getPhenotype,
  placeFieldItem,
  removeFieldItem,
} from '../gameApi.ts';
import type { TickReport } from '../gameApi.ts';

const OBJECT_VIEW: Readonly<Record<FieldObjectKind, { icon: IconName; label: string; cls: string }>> = {
  log: { icon: 'fieldLog', label: '遊び木', cls: 'field-object--log' },
  pond: { icon: 'fieldPond', label: '水場', cls: 'field-object--pond' },
  flowerbed: { icon: 'fieldFlowerbed', label: '花壇', cls: 'field-object--flowerbed' },
  shade: { icon: 'fieldShade', label: 'ひさし', cls: 'field-object--shade' },
  food: { icon: 'fieldFood', label: 'ごはん箱', cls: 'field-object--food' },
  water: { icon: 'fieldWater', label: '水飲み場', cls: 'field-object--water' },
};

/** アイコンではなく、部屋の中に置かれた家具として見える縮約 SVG。 */
function furnitureSvg(kind: FieldObjectKind): string {
  const common = 'class="field-furniture-svg" viewBox="0 0 180 120" aria-hidden="true" focusable="false"';
  switch (kind) {
    case 'log':
      return `<svg ${common}><ellipse cx="91" cy="104" rx="55" ry="8" fill="#6a543d" opacity=".18"/><path d="M27 82c8-12 19-17 34-18l83 6c10 1 17 7 18 16l-8 12-108-2c-12 0-19-6-19-14Z" fill="#9b6845" stroke="#654936" stroke-width="3"/><path d="M35 74c16-5 29 0 41-5 15-7 33-5 47 1 14 6 24 4 34-1" fill="none" stroke="#d49a61" stroke-width="4" stroke-linecap="round"/><path d="M126 64c4-16 9-26 18-35M145 57c9-8 16-10 24-9M137 45c-5-10-4-18 1-25" fill="none" stroke="#567b4b" stroke-width="7" stroke-linecap="round"/><path d="M126 64c4-16 9-26 18-35M145 57c9-8 16-10 24-9M137 45c-5-10-4-18 1-25" fill="none" stroke="#8fb46a" stroke-width="2" stroke-linecap="round"/></svg>`;
    case 'pond':
      return `<svg ${common}><ellipse cx="90" cy="97" rx="63" ry="10" fill="#476c7e" opacity=".18"/><ellipse cx="90" cy="76" rx="65" ry="29" fill="#7aa9b2" stroke="#4d7984" stroke-width="3"/><ellipse cx="90" cy="72" rx="52" ry="20" fill="#a7d7d0" opacity=".72"/><path d="M44 70c13-9 25 8 39 0s25-7 38 0 20 8 29-1M62 83c9-5 18 5 27 0s17-5 27 0" fill="none" stroke="#e0f4e5" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M40 58c6-7 12-8 18-6M125 51c7-5 14-4 18 1" fill="none" stroke="#78a66b" stroke-width="5" stroke-linecap="round"/></svg>`;
    case 'flowerbed':
      return `<svg ${common}><ellipse cx="91" cy="105" rx="48" ry="7" fill="#6d4f4e" opacity=".18"/><path d="M38 73h105l-8 28H46Z" fill="#c98262" stroke="#875442" stroke-width="3"/><path d="M46 75c19-13 71-12 90 0" fill="#6e503d" stroke="#503b31" stroke-width="3"/><path d="M59 76V45M84 76V35M111 76V48M130 76V39" stroke="#5a874b" stroke-width="4" stroke-linecap="round"/><circle cx="59" cy="42" r="10" fill="#eead72" stroke="#a85f5f" stroke-width="3"/><circle cx="84" cy="32" r="10" fill="#e18b9c" stroke="#a85f5f" stroke-width="3"/><circle cx="111" cy="45" r="10" fill="#f0cc67" stroke="#a85f5f" stroke-width="3"/><circle cx="130" cy="36" r="10" fill="#9db8e3" stroke="#6a789d" stroke-width="3"/><circle cx="59" cy="42" r="3" fill="#e6d18a"/><circle cx="84" cy="32" r="3" fill="#f3d887"/><circle cx="111" cy="45" r="3" fill="#e89178"/><circle cx="130" cy="36" r="3" fill="#f2d88b"/></svg>`;
    case 'shade':
      return `<svg ${common}><ellipse cx="90" cy="106" rx="55" ry="7" fill="#536c4e" opacity=".18"/><path d="M36 59c11-25 39-35 68-30 18 3 31 13 41 30Z" fill="#769963" stroke="#4f704d" stroke-width="3"/><path d="M41 57c21-13 76-14 99 0" fill="none" stroke="#b4cf87" stroke-width="4" stroke-linecap="round"/><path d="M51 58v41M130 58v41" stroke="#6a513c" stroke-width="7" stroke-linecap="round"/><path d="M45 101h91" stroke="#6a513c" stroke-width="5" stroke-linecap="round"/><path d="M67 77c8 9 14 9 21 0M98 76c8 9 14 9 21 0" fill="none" stroke="#a4bf7b" stroke-width="3" stroke-linecap="round"/></svg>`;
    case 'food':
      return `<svg ${common}><ellipse cx="90" cy="105" rx="48" ry="7" fill="#765038" opacity=".18"/><path d="M39 59h102v42H39Z" fill="#ae7548" stroke="#69452f" stroke-width="3"/><path d="M39 59 51 45h78l12 14Z" fill="#d29859" stroke="#69452f" stroke-width="3"/><path d="M54 78h72v17H54Z" fill="#75503a" stroke="#503728" stroke-width="3"/><circle cx="69" cy="85" r="5" fill="#e6b85e"/><circle cx="89" cy="89" r="5" fill="#d98b52"/><circle cx="108" cy="83" r="5" fill="#e6b85e"/><path d="M51 61h78" stroke="#f0c67c" stroke-width="3" stroke-linecap="round"/></svg>`;
    case 'water':
      return `<svg ${common}><ellipse cx="90" cy="105" rx="48" ry="7" fill="#536c73" opacity=".18"/><path d="M42 66c5-13 19-20 48-20s43 7 48 20l-8 27c-4 12-76 12-80 0Z" fill="#c8a789" stroke="#785a4a" stroke-width="3"/><ellipse cx="90" cy="67" rx="48" ry="17" fill="#9ccbd0" stroke="#5e949e" stroke-width="3"/><path d="M61 67c9-6 17 5 27 0s18-5 27 0 13 4 19-1" fill="none" stroke="#e4f5e8" stroke-width="3" stroke-linecap="round"/><path d="M90 40V28M90 28c-7-5-14-4-18 1M90 28c7-5 14-4 18 1" fill="none" stroke="#6c905d" stroke-width="4" stroke-linecap="round"/></svg>`;
  }
}

function droppingSvg(): string {
  return `<svg class="field-dropping-svg" viewBox="0 0 72 58" aria-hidden="true" focusable="false"><ellipse cx="36" cy="49" rx="27" ry="5" fill="#4f3426" opacity=".2"/><path d="M15 41c-1-7 4-12 11-14-2-8 3-14 10-14 5 0 9 3 10 8 8-1 13 4 12 10 7 3 9 9 5 14-5 6-17 7-29 6-11-1-18-4-19-10Z" fill="#805039" stroke="#5a3526" stroke-width="3" stroke-linejoin="round"/><path d="M28 25c7-5 16-3 18 3 1 5-3 8-8 9" fill="none" stroke="#b9794c" stroke-width="3" stroke-linecap="round"/><path d="M34 31c-2 2-2 5 1 6" fill="none" stroke="#d29459" stroke-width="2.5" stroke-linecap="round"/><circle cx="23" cy="39" r="2.4" fill="#b9794c"/><circle cx="52" cy="39" r="2.4" fill="#b9794c"/></svg>`;
}

function floorDroppingY(value: number): number {
  const safe = Number.isFinite(value) ? value : 54;
  return safe < 48 ? 54 + safe * 0.35 : safe;
}

function fieldCleanlinessLabel(value: number): string {
  const v = pct(value);
  if (v >= 80) return 'とても きれい';
  if (v >= 50) return 'ほどよく きれい';
  if (v >= 25) return '少し よごれている';
  return '掃除が 必要';
}

export function screenField(app: App, host: HTMLElement): Screen {
  let editMode = false;
  let selectedItemId: string | null = null;
  const creatureMotionCleanup = new Map<string, () => void>();
  const motionDisplay = new Map<string, { x: number; y: number; lastAt: number }>();
  const freshMotionIds = new Set<string>();
  let motionFrame = 0;

  function creatureById(id: string): Creature | undefined {
    return app.state.creatures.find((c) => c.id === id);
  }

  function safeMotionMargin(node: HTMLElement, scale: number): number {
    const scene = $('[data-field-scene]', host);
    const sceneWidth = scene?.clientWidth ?? 0;
    if (!sceneWidth || !node.offsetWidth) return 8;
    const halfWidthPct = (node.offsetWidth * scale / sceneWidth) * 50;
    return Math.max(8, Math.min(30, halfWidthPct + 1));
  }

  function syncSelectedCreature(): void {
    const activeId = app.state.activeCreatureId;
    for (const node of $$<HTMLButtonElement>('[data-field-creature]', host)) {
      const selected = node.dataset.fieldCreature === activeId;
      node.classList.toggle('field-creature--selected', selected);
      node.setAttribute('aria-pressed', String(selected));
    }
  }

  function updateInspector(): void {
    const inspector = $('[data-field-inspector]', host);
    const head = inspector?.querySelector('.section__head');
    if (!inspector || !head) return;
    setHtml(inspector, `<div class="section__head">${head.innerHTML}</div>${renderInspector()}`);
  }

  function mountFieldCreature(creature: Creature, artHost: HTMLElement): void {
    creatureMotionCleanup.get(creature.id)?.();
    creatureMotionCleanup.set(
      creature.id,
      mountCreature(artHost, getPhenotype(creature, creature.life.stage), creature.life, {
        detail: 'full',
        creature,
        title: `${creature.name}（${creature.life.stage}）`,
        reducedMotion: app.reducedMotion,
      }),
    );
  }

  function renderDecor(): string {
    return app.state.field.placements
      .map((placement) => {
        const item = SHOP_ITEM_BY_ID[placement.itemId];
        if (!item?.fieldObject) return '';
        const view = OBJECT_VIEW[item.fieldObject];
        const pos = fieldSlotPosition(placement.slot);
        const remove = editMode
          ? `<button type="button" class="field-object__remove" data-remove-field-item="${esc(item.id)}" aria-label="${esc(item.name)}を 外す">×</button>`
          : '';
        return (
          `<div class="field-object ${view.cls}" style="left:${pos.x}%;top:${pos.y}%" title="${esc(item.name)}">` +
          `<span class="field-object__art">${furnitureSvg(item.fieldObject)}</span>` +
          `<span class="field-object__label">${esc(view.label)}</span>${remove}</div>`
        );
      })
      .join('');
  }

  function renderSlots(): string {
    if (!editMode) return '';
    const occupied = new Map(app.state.field.placements.map((p) => [p.slot, p]));
    const slots: string[] = [];
    for (let i = 0; i < FIELD.slotCount; i++) {
      const placement = occupied.get(i);
      const pos = fieldSlotPosition(i);
      if (placement) {
        slots.push(
          `<span class="field-slot field-slot--occupied" style="left:${pos.x}%;top:${pos.y}%" aria-hidden="true"></span>`,
        );
      } else {
        slots.push(
          `<button type="button" class="field-slot${selectedItemId ? ' field-slot--ready' : ''}" ` +
          `style="left:${pos.x}%;top:${pos.y}%" data-field-slot="${i}" ` +
          `aria-label="フィールドの ${i + 1} 番目の場所に置く">＋</button>`,
        );
      }
    }
    return `<div class="field-slots" aria-label="配置グリッド">${slots.join('')}</div>`;
  }

  function renderDroppings(): string {
    return app.state.field.droppings
      .map(
        (drop) =>
          `<span class="field-dropping" style="left:${drop.x}%;top:${floorDroppingY(drop.y)}%" data-field-dropping-art="${esc(drop.id)}" aria-hidden="true">` +
          `${droppingSvg()}</span>`,
      )
      .join('');
  }

  function renderDroppingHits(): string {
    return app.state.field.droppings
      .map(
        (drop) =>
          `<button type="button" class="field-dropping-hit" style="left:${drop.x}%;top:${floorDroppingY(drop.y)}%" ` +
          `data-field-dropping="${esc(drop.id)}" aria-label="排泄物を掃除"></button>`,
      )
      .join('');
  }

  function renderCreatures(): string {
    const now = Date.now();
    const total = app.state.creatures.length;
    return app.state.creatures
      .map((c, index) => {
        const motion = fieldMotionFor(c, now, index, total);
        const display = motionDisplay.get(c.id);
        const initialX = display?.x ?? motion.x;
        const initialY = display?.y ?? motion.y;
        if (!display) {
          motionDisplay.set(c.id, { x: motion.x, y: motion.y, lastAt: now });
          freshMotionIds.add(c.id);
        }
        const selected = c.id === app.state.activeCreatureId;
        return (
          `<button type="button" class="field-creature${selected ? ' field-creature--selected' : ''}" ` +
          `data-field-creature="${esc(c.id)}" data-field-gait="${motion.gait}" data-field-facing="${motion.facing}" ` +
          `style="left:${initialX}%;top:${initialY}%;z-index:${Math.round(initialY)};--field-scale:${motion.scale};--field-facing:${motion.facing};--field-gait-delay:-${motion.gaitPhaseMs}ms" ` +
          `aria-pressed="${selected ? 'true' : 'false'}" aria-label="${esc(c.name)}を なでる">` +
          `<span class="field-creature__halo" aria-hidden="true"></span>` +
          `<span class="field-creature__art" data-field-creature-art="${esc(c.id)}" aria-hidden="true"></span>` +
          `<span class="field-life-cue" aria-hidden="true"></span>` +
          `</button>`
        );
      })
      .join('');
  }

  function renderScene(): string {
    return (
      `<div class="field-scene${editMode ? ' field-scene--edit' : ''}" data-field-scene role="region" aria-label="ゲノモンが暮らすフィールド">` +
      `<div class="field-surface" aria-hidden="true"><div class="field-room__window"></div><div class="field-room__shelf"><i></i><i></i><i></i></div><div class="field-room__floor"></div><div class="field-room__rug"></div></div>` +
      renderSlots() +
      `<div class="field-decor" data-field-decor>${renderDecor()}</div>` +
      `<div class="field-droppings" data-field-droppings>${renderDroppings()}</div>` +
      `<div class="field-creatures" data-field-creatures>${renderCreatures()}</div>` +
      `<div class="field-dropping-hits" data-field-dropping-hits>${renderDroppingHits()}</div>` +
      `</div>`
    );
  }

  function renderStatus(): string {
    const field = app.state.field;
    const clean = pct(field.cleanliness);
    const objectCount = field.placements.length;
    const robot = app.state.owned.includes('cleaningRobot');
    const live = app.state.creatures.filter((c) => c.life.stage !== 'egg');
    const robotNote = robot ? 'おそうじロボットが 古いものから 片づけます。' : '';
    return (
      `<div class="field-status__top"><span class="field-status__label">フィールドの 清潔度</span>` +
      `<strong>${clean}</strong><span>/ 100</span></div>` +
      `<div class="field-clean-meter"><i data-level="${levelOf(clean)}" style="width:${clean}%"></i></div>` +
      `<p class="field-status__state">${esc(fieldCleanlinessLabel(clean))} ／ 排泄物 ${field.droppings.length} 個</p>` +
      `<dl class="field-facts"><div><dt>暮らしている子</dt><dd>${live.length} 体</dd></div>` +
      `<div><dt>置いている物</dt><dd>${objectCount} 個</dd></div></dl>` +
      (robotNote ? `<p class="section__note">${esc(robotNote)}</p>` : '')
    );
  }

  function renderInspector(): string {
    const c = creatureById(app.state.activeCreatureId ?? '');
    if (!c) {
      return emptyState('glass', [
        'フィールドの子を えらぶと、',
        'ここに くわしい様子が 出ます。',
      ]);
    }
    return (
      `<div class="field-inspector__head"><div class="field-inspector__art" aria-hidden="true">` +
      `${thumbSvg(getPhenotype(c, c.life.stage), c.life, c.name)}</div>` +
      `<div><h3>${esc(c.name)}</h3><div class="row row--tight">${stagePill(c.life.stage)}<span class="pill">${esc(generationLabel(c.generation))}</span></div></div></div>` +
      `<p class="field-inspector__mood">機嫌 ${pct(c.life.mood)} ／ 清潔 ${pct(c.life.cleanliness)} ／ 健康 ${pct(c.life.health)}</p>` +
      `<div class="row field-inspector__actions">` +
      `<a class="btn btn--sm" href="#/nursery" data-goto="/nursery" data-creature="${esc(c.id)}">育成室で 世話する</a>` +
      `<a class="btn btn--ghost btn--sm" href="#/detail/${encodeURIComponent(c.id)}" data-goto="/detail/${encodeURIComponent(c.id)}" data-creature="${esc(c.id)}">記録を見る</a>` +
      `</div>`
    );
  }

  function renderEditor(): string {
    if (!editMode) return '';
    const items = app.state.owned
      .map((id) => SHOP_ITEM_BY_ID[id])
      .filter((item): item is NonNullable<typeof item> => !!item?.fieldObject);
    if (items.length === 0) {
      return emptyState('vase', ['ショップで 遊具を 買うと、', 'フィールドに 配置できます。']);
    }
    const placed = new Set(app.state.field.placements.map((p) => p.itemId));
    const choices = items
      .map((item) => {
        const view = OBJECT_VIEW[item.fieldObject!];
        const isPlaced = placed.has(item.id);
        const isSelected = selectedItemId === item.id;
        return (
          `<button type="button" class="field-item-choice${isSelected ? ' field-item-choice--selected' : ''}" ` +
          `data-select-field-item="${esc(item.id)}" aria-pressed="${isSelected ? 'true' : 'false'}"${isPlaced ? ' disabled' : ''}>` +
          `<span aria-hidden="true">${icon(view.icon)}</span><span><strong>${esc(item.name)}</strong>` +
          `<small>${isPlaced ? '配置ずみ' : '選んでから 空きマスを 押す'}</small></span></button>`
        );
      })
      .join('');
    const placedRows = app.state.field.placements
      .map((placement) => {
        const item = SHOP_ITEM_BY_ID[placement.itemId];
        return item
          ? `<li><span>${esc(item.name)}</span><button type="button" class="btn btn--ghost btn--sm" data-remove-field-item="${esc(item.id)}">外す</button></li>`
          : '';
      })
      .join('');
    return (
      `<div class="field-editor__choices">${choices}</div>` +
      `<p class="section__note">${selectedItemId ? 'フィールドの光るマスを 押して置きます。' : '置く物を選んでから、フィールドのマスを押してください。'}</p>` +
      (placedRows ? `<div class="field-editor__placed"><strong>配置ずみ</strong><ul>${placedRows}</ul></div>` : '')
    );
  }

  function render(): void {
    const oldMotionCleanup = [...creatureMotionCleanup.values()];
    creatureMotionCleanup.clear();
    freshMotionIds.clear();
    setHtml(
      host,
      pageHeader(
        '飼育フィールド',
        'みんなの 暮らしを 見守り、汚れを見つけ、遊び場を 整えます。',
        'globe',
      ) +
        `<div class="field-page">` +
        `<div class="field-toolbar card"><div><strong>${editMode ? '配置モード' : '観察モード'}</strong>` +
        `<p>${editMode ? '置く物を選び、フィールドのマスを押してください。' : '個体を押すと、様子と世話への導線が出ます。'}</p></div>` +
        `<div class="row field-toolbar__actions"><button type="button" class="btn btn--ghost btn--sm" data-field-edit>` +
        `${icon(editMode ? 'check' : 'fieldFlowerbed')} ${editMode ? '配置を 終える' : 'フィールドを 整える'}</button></div></div>` +
        renderScene() +
        `<div class="field-columns">` +
        `<div class="card field-status" data-field-status><div class="section__head"><h2 class="section__title">${icon('bubbles')} 環境</h2></div>${renderStatus()}</div>` +
        `<div class="card field-inspector" data-field-inspector><div class="section__head"><h2 class="section__title">${icon('glass')} 観察メモ</h2></div>${renderInspector()}</div>` +
        `<div class="card field-editor" data-field-editor${editMode ? '' : ' hidden'}><div class="section__head"><h2 class="section__title">${icon('fieldFlowerbed')} 配置する</h2></div>${renderEditor()}</div>` +
        `</div></div>`,
    );
    for (const cleanup of oldMotionCleanup) cleanup();
    for (const artHost of $$<HTMLElement>('[data-field-creature-art]', host)) {
      const creature = creatureById(artHost.dataset.fieldCreatureArt ?? '');
      if (!creature) continue;
      mountFieldCreature(creature, artHost);
    }
    for (const node of $$<HTMLButtonElement>('[data-field-creature]', host)) {
      const id = node.dataset.fieldCreature;
      const display = id ? motionDisplay.get(id) : undefined;
      if (!id || !display || !freshMotionIds.has(id)) continue;
      const scale = Number(node.style.getPropertyValue('--field-scale')) || 1;
      const margin = safeMotionMargin(node, scale);
      const x = Math.max(margin, Math.min(100 - margin, display.x));
      motionDisplay.set(id, { x, y: display.y, lastAt: Date.now() });
      node.style.left = `${x}%`;
    }
  }

  function updateCreaturePositions(): void {
    if (app.reducedMotion) return;
    const now = Date.now();
    const nodes = $$<HTMLButtonElement>('[data-field-creature]', host);
    for (const [index, node] of nodes.entries()) {
      const c = creatureById(node.dataset.fieldCreature ?? '');
      if (!c) continue;
      const motion = fieldMotionFor(c, now, index, nodes.length);
      const behavior = fieldBehaviorFor(app.state, c, now, index);
      const previous = motionDisplay.get(c.id);
      const fallbackX = Number(node.style.left.replace('%', ''));
      const fallbackY = Number(node.style.top.replace('%', ''));
      const state = previous ?? {
        x: Number.isFinite(fallbackX) ? fallbackX : motion.x,
        y: Number.isFinite(fallbackY) ? fallbackY : motion.y,
        lastAt: now,
      };
      const elapsed = Math.max(0, Math.min(250, now - state.lastAt));
      const scale = motion.scale;
      const margin = safeMotionMargin(node, scale);
      const desiredX = behavior.target?.x ?? motion.x;
      const desiredY = behavior.target?.y ?? motion.y;
      const targetX = Math.max(margin, Math.min(100 - margin, desiredX));
      const dx = targetX - state.x;
      const dy = desiredY - state.y;
      const distance = Math.hypot(dx, dy);
      // ルートの再計算（世話・オフライン経過・体調変化）で目標が飛んでも、
      // 1フレームで追いつかず、歩いて戻るようにする。通常の巡回速度より
      // 十分速いが、画面を横切る瞬間移動にはならない上限にする。
      const catchingUp = distance > 1.2;
      const arrived = !!behavior.target && distance < 5;
      const livingAction = arrived ? behavior.kind : behavior.kind === 'wander' ? 'wander' : 'approach';
      const gait: FieldGait = behavior.kind === 'sleep' && arrived
        ? 'rest'
        : behavior.target && !arrived
          ? 'walk'
          : catchingUp && motion.gait === 'rest' ? 'walk' : motion.gait;
      const maxStep = elapsed * (gait === 'run' ? 0.01 : 0.0065);
      const step = distance > 0 && maxStep > 0 ? Math.min(distance, maxStep) : 0;
      const x = distance > 0 ? state.x + (dx / distance) * step : state.x;
      const y = distance > 0 ? state.y + (dy / distance) * step : state.y;
      const actualDx = x - state.x;
      const facing: -1 | 1 = Math.abs(actualDx) > 0.02 ? (actualDx > 0 ? 1 : -1) : motion.facing;
      motionDisplay.set(c.id, { x, y, lastAt: now });
      node.style.left = `${x}%`;
      node.style.top = `${y}%`;
      node.style.zIndex = String(Math.round(y));
      node.style.setProperty('--field-scale', String(scale));
      node.dataset.fieldGait = gait;
      node.dataset.fieldBehavior = livingAction;
      node.dataset.fieldFacing = String(facing);
      node.style.setProperty('--field-facing', String(facing));
      node.style.setProperty('--field-gait-delay', `-${motion.gaitPhaseMs}ms`);
    }
  }

  function startMotionLoop(): void {
    if (motionFrame || app.reducedMotion || typeof window.requestAnimationFrame !== 'function') return;
    const frame = (): void => {
      motionFrame = 0;
      updateCreaturePositions();
      if (!app.reducedMotion) motionFrame = window.requestAnimationFrame(frame);
    };
    motionFrame = window.requestAnimationFrame(frame);
  }

  function updateLiveParts(): void {
    syncSelectedCreature();
    const status = $('[data-field-status]', host);
    if (status) {
      const head = status.querySelector('.section__head');
      if (head) setHtml(status, `<div class="section__head">${head.innerHTML}</div>${renderStatus()}`);
    }
    updateCreaturePositions();
  }

  function showFieldReaction(button: HTMLElement, art: HTMLElement | null, result: CareResult, before: Creature['life']['stage']): void {
    button.querySelectorAll('.field-reaction').forEach((node) => node.remove());
    if (before === 'egg') playOnce(art, 'egg-wobble', 780);
    else playReaction(art, reactionForCare('pet', result.reaction));

    const effect = document.createElement('span');
    effect.className = `field-reaction field-reaction--${result.reaction}`;
    effect.setAttribute('aria-hidden', 'true');
    const glyph = document.createElement('span');
    glyph.className = 'field-reaction__glyph';
    glyph.textContent = result.reaction === 'dislike' ? '…' : result.reaction === 'delighted' ? '✦' : '♡';
    effect.appendChild(glyph);
    if (result.speech) {
      const speech = document.createElement('span');
      speech.className = 'field-reaction__speech';
      speech.textContent = result.speech;
      effect.appendChild(speech);
    }
    button.appendChild(effect);
    window.setTimeout(() => effect.remove(), 2_400);
    if (result.reaction === 'delighted') burstSparkles(button, 12);
  }

  function petFromField(creatureId: string): void {
    const creature = creatureById(creatureId);
    if (!creature) return;
    const before = creature.life.stage;
    app.state.activeCreatureId = creature.id;
    app.markDirty();
    const result = doCare(app.state, creature.id, 'pet', Date.now());
    if (!result.ok) {
      // 連続タップの待ち時間を秒数トーストで叱らない。位置と選択だけを保つ。
      // 失敗時もフィールドを作り直さず、歩行中の個体の位置を保持する。
      updateLiveParts();
      updateInspector();
      return;
    }

    sfx.play(CARE_SFX.pet);
    // 世話直後に画面全体を再描画すると、時刻と体調変化で再計算された
    // ルートの初期位置へ個体が飛んで見える。DOMを残して情報部分だけ更新する。
    updateLiveParts();
    updateInspector();
    if (result.evolved) {
      const current = creatureById(creature.id);
      const artHost = $$<HTMLElement>('[data-field-creature-art]', host).find(
        (node) => node.dataset.fieldCreatureArt === creature.id,
      );
      if (current && artHost) mountFieldCreature(current, artHost);
    }
    app.save('フィールドでなでる');

    const button = $$<HTMLButtonElement>('[data-field-creature]', host).find(
      (node) => node.dataset.fieldCreature === creature.id,
    );
    if (!button) return;
    const art = button.querySelector<HTMLElement>('[data-field-creature-art]');
    const tapVariant = (creature.life.careCount % 3) + 1;
    button.dataset.fieldTap = String(tapVariant);
    window.setTimeout(() => delete button.dataset.fieldTap, 900);
    showFieldReaction(button, art, result, before);

    const current = creatureById(creature.id);
    if (current && before !== 'egg') {
      window.setTimeout(() => {
        const live = creatureById(creature.id);
        if (live && live.life.stage !== 'egg') {
          sfx.voice(live.seed, getPhenotype(live, live.life.stage).personality, result.reaction);
        }
      }, 150);
    }
  }

  async function removePlaced(itemId: string): Promise<void> {
    const item = SHOP_ITEM_BY_ID[itemId];
    if (!item) return;
    const ok = await confirmDialog(
      `${item.name}を 外しますか？`,
      `<p>ショップで買った所有権は残ります。フィールドからだけ 外します。</p>`,
      '外す',
      false,
    );
    if (!ok) return;
    const result = removeFieldItem(app.state, itemId, Date.now());
    if (!result.ok) {
      toast(result.reason ?? '外せませんでした。', 'warn');
      return;
    }
    selectedItemId = null;
    app.save('フィールド配置の変更');
    app.rerender();
    toast(`${item.name}を 外しました。`, 'info');
  }

  const off = delegate(host, 'click', '[data-field-dropping],[data-field-creature],[data-field-edit],[data-select-field-item],[data-field-slot],[data-remove-field-item]', (target) => {
    const droppingId = target.dataset.fieldDropping;
    if (droppingId) {
      const result = cleanDropping(app.state, droppingId, Date.now());
      if (!result.ok) {
        toast(result.reason ?? 'その汚れは もうありません。', 'info');
        return;
      }
      app.save('フィールドの個別掃除');
      const visual = host.querySelector<HTMLElement>(`[data-field-dropping-art="${CSS.escape(droppingId)}"]`);
      visual?.remove();
      target.classList.add('field-dropping--cleaned');
      burstSparkles(target, 9, ['#fff6c7', '#f2cf62', '#9ed7c6', '#ffffff']);
      window.setTimeout(() => target.remove(), 720);
      updateLiveParts();
      return;
    }
    const creatureId = target.dataset.fieldCreature;
    if (creatureId) {
      petFromField(creatureId);
      return;
    }
    if (target.dataset.fieldEdit !== undefined) {
      editMode = !editMode;
      selectedItemId = null;
      render();
      return;
    }
    const itemId = target.dataset.selectFieldItem;
    if (itemId) {
      selectedItemId = selectedItemId === itemId ? null : itemId;
      render();
      return;
    }
    const slot = target.dataset.fieldSlot;
    if (slot !== undefined) {
      if (!selectedItemId) {
        toast('まず 置く物を えらんでください。', 'info');
        return;
      }
      const result = placeFieldItem(app.state, selectedItemId, Number(slot), Date.now());
      if (!result.ok) {
        toast(result.reason ?? 'そこには 置けません。', 'warn');
        return;
      }
      const item = SHOP_ITEM_BY_ID[selectedItemId];
      selectedItemId = null;
      app.save('フィールド配置');
      app.rerender();
      toast(`${item?.name ?? '遊具'}を 置きました。`, 'good');
      return;
    }
    const removeId = target.dataset.removeFieldItem;
    if (removeId) void removePlaced(removeId);
  });

  render();
  startMotionLoop();

  return {
    update: render,
    tick(report: TickReport): void {
      if (report.fieldEvent) render();
      else updateLiveParts();
    },
    dispose() {
      off();
      if (motionFrame) window.cancelAnimationFrame(motionFrame);
      motionFrame = 0;
      for (const cleanup of creatureMotionCleanup.values()) cleanup();
      creatureMotionCleanup.clear();
      motionDisplay.clear();
    },
  };
}
