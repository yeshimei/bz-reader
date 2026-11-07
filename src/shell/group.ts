/* ============================================================
 * bz-reader · 交流群（shell/group.ts）
 *
 * 只做一件事：把群号放到按钮上，点一下复制。
 *
 * 为什么不用链接：`https://qm.qq.com/q/bzreader` 实测 404，
 * `qm.qq.com/q/<群号>` 也不是群号——短码是另一套东西。群里改版、
 * 换短码时链接又会失效，而群号本身不会再变。复制 + 去 QQ 搜索
 * 是唯一不依赖第三方链接格式的路。
 * ============================================================ */

import { notify } from '../core/notice';
import { t } from '../i18n';
import { GROUP_ID, TRIAL_ACTIVE } from '../data/entitlement';

/**
 * 解锁弹层里的群按钮。
 *
 * `TRIAL_ACTIVE = false`（2026-11-03 起不对外发试用）时**整颗不渲染**：
 * 授权状态机明确要求界面上一个字都不提试用，留一颗「进群领试用」等于
 * 让用户去群里领一个根本不存在的码。合并成一颗按钮的理由见下方注释，
 * 恢复试用时把开关打开即可，这里不用再改。
 */
export function trialButtonHtml(): string {
  if (!TRIAL_ACTIVE) return '';
  return `<button class="bzs-btn" data-act="jointrial">进群领试用 · ${GROUP_ID}</button>`;
}

export async function copyGroupIdForTrial(): Promise<void> {
  try {
    await navigator.clipboard.writeText(GROUP_ID);
    notify(t('notice.group.trialOk', { id: GROUP_ID }));
  } catch {
    notify(t('notice.group.trialFail', { id: GROUP_ID }), 'error');
  }
}

/**
 * 关于条里那颗「交流群」：只是加群，不谈试用。
 *
 * 和上面那颗分开写是为了文案：解锁弹层里的人正准备掏钱，「进群领试用」
 * 才是他要的下一步；设置页里的人只是想知道群里在哪，再提试用就成了推销。
 */
export async function copyGroupId(): Promise<void> {
  try {
    await navigator.clipboard.writeText(GROUP_ID);
    notify(t('notice.group.plainOk', { id: GROUP_ID }));
  } catch {
    notify(t('notice.group.plainFail', { id: GROUP_ID }), 'error');
  }
}
