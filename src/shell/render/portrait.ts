/* ============================================================
 * bz-reader · 全书画像的界面片段（shell/render/portrait.ts）
 *
 * 2026-11-07：建画像整套界面搬进了侧栏 AI 页签（render/sidebar.ts 的
 * indexBody），原来那个「全书问答准备」弹层连同它的准备 / 进度 / 完成三块
 * 一起删掉了——同一件事在两处出现，用户还得记住哪一处会真的开始跑。
 *
 * 这里只剩两处还在用的东西：
 *   · `portraitEstimate`：侧栏选建法时写「约 N 块 / N 次请求」；
 *   · `portraitStatusLine`：书籍详情页那一行「未建 / 建到一半 / 已建 / 需要重建」。
 * ============================================================ */
import { t } from '../../i18n';
import { estimateOf } from '../../data/portrait-build';
import { estimateRequests, type PortraitFile, type PortraitPlan } from '../../data/portrait';

/** 块数：切完块就用真实值，没切之前按字数估（界面上一律写「约」） */
export function portraitEstimate(chars: number, plan: PortraitPlan, total = 0): { blocks: number; requests: number } {
  if (total > 0) return { blocks: total, requests: estimateRequests(total, plan) };
  return estimateOf(chars, plan);
}

/** 详情页那一行：已建 / 未建 / 建到一半 / 需要重建 */
export function portraitStatusLine(portrait: PortraitFile | null, model: string, building = false): string {
  if (building) return t('detail.portrait.building');
  if (!portrait) return t('detail.portrait.none');
  if (!portrait.done) return t('detail.portrait.building');
  if (portrait.plan === 'vector' && portrait.model && model && portrait.model !== model) {
    return t('detail.portrait.stale');
  }
  return t('detail.portrait.ready');
}
