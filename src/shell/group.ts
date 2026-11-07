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
import { GROUP_ID } from '../data/entitlement';

/**
 * 解锁弹层里的群按钮。
 *
 * 2026-11-03 起不对外发试用，这颗按钮从「进群领试用」退成纯加群入口：
 * 常驻渲染、只印群号。留着试用字样等于让用户去群里领一枚根本不存在的码。
 * 动作与设置页「关于」条那颗共用（`copygroup`），两处点下去说同一句话。
 */
export function groupButtonHtml(): string {
  return `<button class="bzs-btn" data-act="copygroup">${t('unlock.group', { id: GROUP_ID })}</button>`;
}

/**
 * 点一下复制群号。
 *
 * 解锁弹层与设置页关于条都走这里：两个入口的目的地相同（去 QQ 搜群号），
 * 就该只有一套话术。
 */
export async function copyGroupId(): Promise<void> {
  try {
    await navigator.clipboard.writeText(GROUP_ID);
    notify(t('notice.group.plainOk', { id: GROUP_ID }));
  } catch {
    notify(t('notice.group.plainFail', { id: GROUP_ID }), 'error');
  }
}
