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
import { GROUP_ID } from '../data/entitlement';

/**
 * 解锁弹层里唯一的一颗群按钮：进群领试用，群号直接印在按钮上。
 * 「复制群号」和「领试用」是同一个动作（先加群），拆两颗只会让人以为
 * 有两条路，所以合并成这一颗。
 */
export function trialButtonHtml(): string {
  return `<button class="bzs-btn" data-act="jointrial">进群领试用 · ${GROUP_ID}</button>`;
}

export async function copyGroupIdForTrial(): Promise<void> {
  try {
    await navigator.clipboard.writeText(GROUP_ID);
    notify(`已复制群号 ${GROUP_ID}，进群后找管理员领取 7 天试用码`);
  } catch {
    notify(`复制失败，群号是 ${GROUP_ID}，进群找管理员领取 7 天试用`, 'error');
  }
}
