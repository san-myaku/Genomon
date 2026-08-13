/** 飼育員の募集・雇用画面。プロフィールを比べてから、固定費を確認して雇う。 */

import type { StaffCandidate } from '../../core/types.ts';
import { icon } from '../icons.ts';
import type { App, Screen } from '../app.ts';
import { pageHeader, section } from '../app.ts';
import { delegate, esc, setHtml } from '../dom.ts';
import { openDialog } from '../components/dialog.ts';
import { toast } from '../components/toast.ts';
import { num } from '../format.ts';
import {
  dismissStaff,
  hiredStaff,
  hireStaff,
  refreshStaffCandidates,
  rerollStaffCandidates,
  STAFF,
  staffConfig,
  staffRoleLabel,
} from '../gameApi.ts';
import type { TickReport } from '../gameApi.ts';

function minutesAndSeconds(ms: number): string {
  const safe = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return min > 0 ? `${min}分 ${sec.toString().padStart(2, '0')}秒` : `${sec}秒`;
}

function percent(value: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(100, Math.round(((value - lo) / (hi - lo)) * 100)));
}

export function screenStaff(app: App, host: HTMLElement): Screen {
  function candidateCard(candidate: StaffCandidate): string {
    const cfg = staffConfig(candidate.role);
    const affordable = app.state.coins >= cfg.hiringFee;
    return (
      `<article class="staff-candidate card">` +
      `<div class="staff-candidate__head"><span class="staff-candidate__avatar" aria-hidden="true">${icon('staff')}</span>` +
      `<div class="staff-candidate__name"><h2>${esc(candidate.name)}</h2><span class="pill">${esc(staffRoleLabel(candidate.role))}</span></div></div>` +
      `<p class="staff-candidate__profile">${esc(candidate.profile)}</p>` +
      `<dl class="staff-candidate__facts"><div><dt>応募理由</dt><dd>${esc(candidate.reason)}</dd></div><div><dt>仕事のくせ</dt><dd>${esc(candidate.quirk)}</dd></div></dl>` +
      `<div class="staff-meter"><div><span>世話の 技量</span><strong>${Math.round(candidate.skill * 100)}%</strong></div>` +
      `<i><b style="width:${percent(candidate.skill, 0.65, 1.35)}%"></b></i></div>` +
      `<div class="staff-meter"><div><span>勤務の 安定さ</span><strong>${Math.round(candidate.reliability * 100)}%</strong></div>` +
      `<i><b style="width:${Math.round(candidate.reliability * 100)}%"></b></i></div>` +
      `<div class="staff-candidate__terms"><span>採用費 <strong>${num(cfg.hiringFee)}</strong> コイン</span><span>給与 <strong>${num(cfg.wage)}</strong> / 5分</span><span>1回に ${cfg.coverage}体</span></div>` +
      `<button type="button" class="btn ${affordable ? 'btn--leaf' : 'btn--ghost'} staff-candidate__hire" data-hire-staff="${esc(candidate.id)}"${affordable ? '' : ' disabled'}>` +
      `${affordable ? `${icon('hands')} この人を 雇う` : 'コインが たりません'}</button>` +
      `</article>`
    );
  }

  function hiredPanel(candidate: StaffCandidate): string {
    const cfg = staffConfig(candidate.role);
    const now = Date.now();
    const nextPay = Math.max(0, STAFF.payIntervalMs - (now - app.state.staff.lastPaidAt));
    const unpaid = app.state.staff.unpaidSince > 0;
    return (
      `<div class="card staff-employed card--done">` +
      `<div class="staff-employed__head"><span class="staff-candidate__avatar" aria-hidden="true">${icon('staff')}</span>` +
      `<div><p class="eyebrow">雇用中</p><h2>${esc(candidate.name)}</h2><span class="pill">${esc(staffRoleLabel(candidate.role))}</span></div>` +
      `<span class="staff-employed__ok">${icon('check')} 稼働中</span></div>` +
      `<p class="staff-candidate__profile">${esc(candidate.profile)}</p>` +
      `<div class="staff-employed__grid"><div><span>次の給与</span><strong>${unpaid ? '未払い' : `あと ${minutesAndSeconds(nextPay)}`}</strong></div>` +
      `<div><span>給与</span><strong>${num(cfg.wage)} コイン / 5分</strong></div>` +
      `<div><span>巡回</span><strong>${cfg.coverage}体 / 約${Math.round(cfg.serviceIntervalMs / 1000)}秒</strong></div></div>` +
      (unpaid
        ? `<p class="staff-alert">所持コインが 足りません。${Math.round(STAFF.unpaidGraceMs / 60_000)}分以内に 支払えないと 雇用が 終わります。</p>`
        : `<p class="section__note">汚れた子・おなかが空いた子から順に、自動で世話をします。フィールドの掃除は おそうじロボットの仕事です。</p>`) +
      `<div class="row row--end"><button type="button" class="btn btn--ghost" data-dismiss-staff>雇用を 終える</button><a class="btn btn--leaf" href="#/field">${icon('globe')} フィールドを見る</a></div>` +
      `</div>`
    );
  }

  function render(): void {
    const hired = hiredStaff(app.state);
    const candidates = hired ? [] : refreshStaffCandidates(app.state, Date.now());
    const intro = hired
      ? '雇った飼育員が、手の足りない子から順番に世話をします。'
      : 'プロフィールと条件を比べて、あなたの温室に合う人を選びます。';

    setHtml(
      host,
      pageHeader('飼育員', intro, 'staff') +
        (hired
          ? hiredPanel(hired)
          : section(
              '募集中の 3人',
              `<div class="staff-candidates">${candidates.map(candidateCard).join('')}</div>` +
                `<div class="row row--end staff-reroll"><button type="button" class="btn btn--ghost btn--sm" data-reroll-staff>${icon('cross')} この候補を 見送る</button></div>`,
              '採用費はその場で一度だけ。給与は 5分ごとに自動で引き落とされます。',
              'pair',
            )) +
        section(
          '雇う前に',
          `<ul class="lines"><li>能力は候補者ごとに違います。雇った後も同じ人として残ります。</li>` +
            `<li>コインが足りないときは、展示会で稼いでから戻れます。</li>` +
            `<li>雇用を終えても、すでに払った採用費と給与は戻りません。</li></ul>`,
          undefined,
          'info',
        ),
    );
  }

  async function onHire(candidateId: string): Promise<void> {
    const candidate = app.state.staff.candidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    const cfg = staffConfig(candidate.role);
    const picked = await openDialog({
      title: `${candidate.name}を 雇いますか？`,
      icon: 'staff',
      bodyHtml: `<p>${esc(staffRoleLabel(candidate.role))}。採用費 <strong>${num(cfg.hiringFee)} コイン</strong>、給与 <strong>${num(cfg.wage)} コイン / 5分</strong>です。</p>`,
      actions: [
        { label: 'やめる', value: 'cancel', kind: 'ghost', cancel: true },
        { label: '雇う', value: 'ok', kind: 'primary' },
      ],
    });
    if (picked !== 'ok') return;
    const result = hireStaff(app.state, candidateId, Date.now());
    if (!result.ok) {
      toast(result.reason ?? '雇えませんでした。', 'warn');
      return;
    }
    toast(`${candidate.name}を 雇いました。`, 'good');
    app.save('飼育員の採用');
    app.rerender();
  }

  async function onDismiss(): Promise<void> {
    const candidate = hiredStaff(app.state);
    if (!candidate) return;
    const picked = await openDialog({
      title: `${candidate.name}との 雇用を終えますか？`,
      icon: 'warn',
      bodyHtml: '<p>採用費と、これまでに支払った給与は 戻りません。</p>',
      actions: [
        { label: 'もどる', value: 'cancel', kind: 'ghost', cancel: true },
        { label: '雇用を終える', value: 'ok', kind: 'danger' },
      ],
    });
    if (picked !== 'ok') return;
    dismissStaff(app.state, Date.now());
    toast('雇用を 終えました。新しい候補を 募集できます。', 'info');
    app.save('飼育員の解雇');
    app.rerender();
  }

  const off = delegate(host, 'click', '[data-hire-staff],[data-reroll-staff],[data-dismiss-staff]', (target) => {
    const hire = target.dataset.hireStaff;
    if (hire) {
      void onHire(hire);
      return;
    }
    if (target.dataset.rerollStaff !== undefined) {
      const result = rerollStaffCandidates(app.state, Date.now());
      if (result.ok) {
        toast('新しい候補が 到着しました。', 'info');
        app.save('飼育員の募集更新');
        app.rerender();
      } else toast(result.reason ?? '募集を更新できませんでした。', 'warn');
      return;
    }
    if (target.dataset.dismissStaff !== undefined) void onDismiss();
  });

  render();
  return {
    update: render,
    tick(report: TickReport) {
      if (report.staffChanged || report.staffEvent) render();
    },
    dispose() {
      off();
    },
  };
}
