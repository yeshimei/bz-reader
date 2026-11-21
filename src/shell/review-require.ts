/* ============================================================
 * bz-reader · 取 Review 门面并按流程弹提示（shell/review-require.ts）
 *
 * 「加入复习」的一条线：挑内容、制卡、回阅读器，三处入口都要先拿门面、
 * 再判这套流程支不支持。以前同一个判断在 review-add 与 review-cards-ui
 * 各抄一遍，提示文案也各写一份——条件一改就会出现两处说法不一致。
 * ============================================================ */
import type { App } from 'obsidian';
import { notify } from '../core/notice';
import { t } from '../i18n';
import {
  findReviewApi,
  reviewCardFlowReady,
  reviewReaderFlowReady,
  type ReviewApi,
} from '../data/review-bridge';

/** 要用的流程：card = 统一制卡界面，reader = 从阅读器挑内容 */
export type ReviewFlowKind = 'card' | 'reader';

/**
 * 拿门面；没装 / 版本太老就弹一句人话并返回 null。
 *
 * 没装与版本太老是两种提示：前者让人去装，后者让人去更新——合成一句
 * 用户不知道该做哪件事。
 */
export function requireReviewFlow(app: App | undefined, kind: ReviewFlowKind): ReviewApi | null {
  if (!app) return null;
  const api = findReviewApi(app);
  if (!api) {
    notify(t('review.needPlugin'), 'info');
    return null;
  }
  const ready = kind === 'reader' ? reviewReaderFlowReady(api) : reviewCardFlowReady(api);
  if (!ready) {
    notify(t('review.cardsNeedUpdate'), 'info');
    return null;
  }
  return api;
}
