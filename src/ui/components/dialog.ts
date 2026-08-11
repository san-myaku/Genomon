/**
 * ダイアログ。
 *
 * ネイティブの <dialog showModal()> を使う。理由:
 *   - フォーカストラップと Escape での閉じるがブラウザ実装で得られる
 *   - ::backdrop が使える
 *   - 自前でフォーカス管理を書くより、アクセシビリティの取りこぼしが少ない
 */

import { el, esc } from '../dom.ts';
import { iconOrText } from '../icons.ts';

export interface DialogAction {
  /** ボタンに出す文字。 */
  label: string;
  /** 解決値。 */
  value: string;
  /** 見た目。 */
  kind?: 'primary' | 'ghost' | 'danger';
  /** Escape / backdrop で閉じたときに返る値にするか。 */
  cancel?: boolean;
}

export interface DialogOpts {
  title: string;
  /** 本文（HTML 断片を許可する。呼び出し側でエスケープ済みのものだけ渡すこと）。 */
  bodyHtml: string;
  icon?: string;
  actions?: DialogAction[];
}

/**
 * ダイアログを開き、押されたボタンの value を返す。
 * Escape や backdrop クリックでは cancel 指定のある value（無ければ 'cancel'）を返す。
 */
export function openDialog(opts: DialogOpts): Promise<string> {
  const actions: DialogAction[] = opts.actions?.length
    ? opts.actions
    : [{ label: 'とじる', value: 'close', kind: 'primary', cancel: true }];

  const dlg = el('dialog', 'dlg') as HTMLDialogElement;
  const cancelValue = actions.find((a) => a.cancel)?.value ?? 'cancel';

  const buttons = actions
    .map((a, i) => {
      const cls =
        a.kind === 'danger' ? 'btn btn--danger' : a.kind === 'ghost' ? 'btn btn--ghost' : 'btn';
      return `<button type="button" class="${cls}" data-val="${esc(a.value)}" data-i="${i}">${esc(a.label)}</button>`;
    })
    .join('');

  dlg.innerHTML =
    `<form method="dialog" class="dlg__in">` +
    `<h2 class="dlg__title">${opts.icon ? `<span aria-hidden="true">${iconOrText(opts.icon)}</span>` : ''}${esc(opts.title)}</h2>` +
    `<div class="dlg__body">${opts.bodyHtml}</div>` +
    `<div class="dlg__actions">${buttons}</div>` +
    `</form>`;

  document.body.appendChild(dlg);

  return new Promise<string>((resolve) => {
    let settled = false;
    const finish = (v: string): void => {
      if (settled) return;
      settled = true;
      resolve(v);
      dlg.close();
      window.setTimeout(() => dlg.remove(), 60);
    };

    dlg.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement | null)?.closest('button[data-val]') as HTMLElement | null;
      if (t) {
        ev.preventDefault();
        finish(t.dataset.val ?? cancelValue);
        return;
      }
      // backdrop クリック（dialog 自身がイベント対象になる）で閉じる
      if (ev.target === dlg) finish(cancelValue);
    });

    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      finish(cancelValue);
    });

    dlg.showModal();
    // 最初のボタンにフォーカスを置く（キーボードだけで進めるように）
    (dlg.querySelector('button[data-val]') as HTMLElement | null)?.focus();
  });
}

/** はい／いいえの確認。破壊的操作の前に必ず通す。 */
export async function confirmDialog(
  title: string,
  bodyHtml: string,
  okLabel = 'はい',
  danger = false,
): Promise<boolean> {
  const v = await openDialog({
    title,
    bodyHtml,
    icon: danger ? 'warn' : 'question',
    actions: [
      { label: 'やめる', value: 'no', kind: 'ghost', cancel: true },
      { label: okLabel, value: 'yes', kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === 'yes';
}
