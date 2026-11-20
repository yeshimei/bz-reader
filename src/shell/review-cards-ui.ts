/* ============================================================
 * bz-reader · 制卡入口（shell/review-cards-ui.ts）
 *
 * 2026-11-21 架构调整：**制卡界面整段搬进 bz-review**。
 *
 * 以前 Reader 自己做「三选一 → 出题 → 改题面 → 入库」，Review 另有一份
 * 「这段内容做成哪种卡」的列表弹窗，同一个产品两套制卡界面，还不给看题面。
 * 用户拍板：界面只留一套，流程归 Review——Reader 只负责挑内容。
 *
 * 所以这个文件现在只剩一层薄适配：
 *   · 单条 / 一批来源 → reviewApi.openCardFlow({ sources })
 *   · AI 挑重点的加载态 → reviewApi.openCardFlow({ load })
 *
 * 老版本 Review（契约 < v5）没有 openCardFlow：给一句「去升级」，而不是
 * 悄悄退回 Reader 自己那套——那正是这次要拆掉的第二套界面。
 * ============================================================ */
import type { App } from 'obsidian';
import { t } from '../i18n';
import { notify } from '../core/notice';
import {
  findReviewApi,
  reviewCardFlowReady,
  type CardFlowSource,
  type ReviewAddSummary,
} from '../data/review-bridge';

/** 加入成功后要补做的事（例如给划选的文字补一条划线）。 */
export interface CardsFlowHooks {
  onAdded?: (res: ReviewAddSummary) => void;
}

function flowApi(app: App | undefined) {
  if (!app) return null;
  const api = findReviewApi(app);
  if (!api) {
    notify(t('review.needPlugin'), 'info');
    return null;
  }
  if (!reviewCardFlowReady(api)) {
    notify(t('review.cardsNeedUpdate'), 'info');
    return null;
  }
  return api;
}

/** 打开统一制卡流程。sources 里一条就是一张待确认的卡。 */
export function openCardsFlow(
  app: App | undefined,
  sources: CardFlowSource[],
  hooks: CardsFlowHooks = {},
): void {
  if (!app || !sources.length) return;
  const api = flowApi(app);
  if (!api?.openCardFlow) return;
  api.openCardFlow({
    sources,
    onAdded: (res) => hooks.onAdded?.(res),
  });
}
