/* ============================================================
 * bz-reader · 支持作者弹窗（src/shell/support-dialog.ts）
 *
 * 设置页顶部栏与更新日志页脚的「支持作者」共用这一个窗：
 *   · 抬头一句实话（插件与教程都是一个人在做）；
 *   · 一张微信赞赏码 + 「或者成为赞助人」的备用出口；
 *   · 支持者名单（时间倒序、序号倒排，空名单时给一张空态）。
 *
 * 版式**不照搬 bz 那张米白描金纸**：bz 是免费插件，那张纸是它的气质；
 * bz-reader 的弹窗一律跟随宿主主题与强调色，跟更新日志弹窗同一族
 * （见 shell/styles/support.css）。这里是「插件的一部分」，不是一张信笺。
 *
 * 关闭动线四路（× / 点遮罩 / ESC /「知道了」）全部交给 uiModal，
 * 与更新日志弹窗完全一致；**关掉时不问任何问题**——这是和 bz 唯一的
 * 行为差别：bz 会在关更新日志时弹一句「要不要支持作者」，这里不弹，
 * 用户点 × 就是关掉。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';
import { REWARD_NAMES, SPONSOR_URL, formatRewardDate, type RewardName } from '../data/reward';
import { esc } from './render/html';
import rewardCodeUrl from './assets/reward-code.png';

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

/** 金额位：数字补 ¥；「赞助人」走语言包，不在这里写死中文 */
function amountHtml(amount: number | 'patron'): string {
  return amount === 'patron' ? esc(t('support.amountPatron')) : `¥${amount}`;
}

/**
 * 名单本体。
 *
 * 序号是**倒着排的**：名单按时间倒序存，最新一位是最大号——读起来像
 * 「第几位来过」，而不是「第几行」。一个都没有时给空态，不留一张空白纸。
 */
export function supportListHtml(names: readonly RewardName[]): string {
  if (!names.length) {
    return `<div class="bzs-sup-empty">${esc(t('support.empty'))}</div>`;
  }
  const total = names.length;
  const items = names
    .map((it, i) => {
      const no = String(total - i).padStart(2, '0');
      const msg = it.message ? `<p class="bzs-sup-msg">${esc(it.message)}</p>` : '';
      return (
        '<li class="bzs-sup-item">' +
        `<span class="bzs-sup-no">${no}</span>` +
        '<div class="bzs-sup-who-col">' +
        '<div class="bzs-sup-who-row">' +
        `<b class="bzs-sup-who">${esc(it.name)}</b>` +
        '<span class="bzs-sup-meta">' +
        `<span class="bzs-sup-amt">${amountHtml(it.amount)}</span>` +
        `<time class="bzs-sup-when">${esc(formatRewardDate(it.date))}</time>` +
        '</span></div>' +
        msg +
        '</div></li>'
      );
    })
    .join('');
  return `<ol class="bzs-sup-names">${items}</ol>`;
}

/**
 * 弹窗正文（整块 HTML）。
 *
 * `names` 与 `codeUrl` 可注入：测试用短名单、真机用内置的那份与内联的码。
 */
export function supportDialogHtml(
  names: readonly RewardName[] = REWARD_NAMES,
  codeUrl: string = rewardCodeUrl,
): string {
  const close = t('support.close');
  return (
    '<div class="bzs-sup">' +
    `<button class="bzs-sup-close" type="button" data-role="supclose" aria-label="${esc(close)}" title="${esc(close)}">${CLOSE_SVG}</button>` +
    '<header class="bzs-sup-hd">' +
    `<div class="bzs-sup-kicker">${esc(t('support.title'))}</div>` +
    `<p class="bzs-sup-lead">${esc(t('support.lead'))}</p>` +
    '</header>' +
    '<div class="bzs-sup-code">' +
    `<div class="bzs-sup-code-box"><img src="${esc(codeUrl)}" alt="${esc(t('support.codeAlt'))}" /></div>` +
    `<p class="bzs-sup-ways">${esc(t('support.ways'))}</p>` +
    `<button class="bzs-sup-sponsor" type="button" data-role="supsponsor">${esc(t('support.sponsor'))}</button>` +
    '</div>' +
    '<div class="bzs-sup-list">' +
    `<div class="bzs-sup-list-hd"><b>${esc(t('support.list'))}</b><span>${names.length}</span></div>` +
    `<div class="bzs-sup-list-body">${supportListHtml(names)}</div>` +
    '</div>' +
    '<footer class="bzs-sup-ft">' +
    `<span class="bzs-sup-note">${esc(t('support.note'))}</span>` +
    `<button class="bzs-sup-done" type="button" data-role="supdone">${esc(t('support.done'))}</button>` +
    '</footer>' +
    '</div>'
  );
}

export interface SupportDialogHandle {
  /** 关闭弹窗（插件卸载 / 测试收口）；正常交互走 ×、点遮罩、ESC、「知道了」 */
  close: () => void;
}

/**
 * 当前活着的那一个。
 *
 * 顶部栏和更新日志页脚各有一个入口：连点两下会叠两层遮罩（关了上面那层
 * 下面还在，看着像关不掉）。新开之前先收掉旧的，全插件恒只有一个。
 */
let live: SupportDialogHandle | null = null;

/** 打开支持作者弹窗；返回关闭句柄（幂等） */
export function openSupportDialog(): SupportDialogHandle {
  live?.close();
  live = null;

  const modal = uiModal({
    content: supportDialogHtml(),
    className: 'bzs-sup-dialog',
    title: t('support.title'),
    // 不抢焦点：这是「看看怎么支持」的窗，打开就把焦点从用户手上拽走很粗暴
    autofocus: false,
  });
  /* 遮罩要能被样式认出来：手机的「贴底抽屉」是靠 .bzs-sup-mask 覆盖
     .bzr-overlay-mask 的居中排布（changelog-note 的抽屉同口径）。 */
  modal.mask.classList.add('bzs-sup-mask');

  /* 一处委托管三件事：关闭 / 知道了 / 赞助商店。
     赞助链接不走 <a>：Obsidian 会把裸链交给阅读视图，移动端常常点了没反应。 */
  modal.popup.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest) return;
    if (target.closest('[data-role="supclose"]') || target.closest('[data-role="supdone"]')) {
      modal.close();
      return;
    }
    if (target.closest('[data-role="supsponsor"]')) {
      window.open(SPONSOR_URL, '_blank', 'noopener,noreferrer');
    }
  });

  const handle: SupportDialogHandle = {
    close: () => {
      if (live === handle) live = null;
      modal.close();
    },
  };
  live = handle;
  return handle;
}
