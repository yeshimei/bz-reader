/* ============================================================
 * bz-reader · 建画像的准入判定（data/portrait-gate.ts）
 *
 * 建画像之前要先答一个「现在能不能建」。以前这段判断散在
 * `portraitProblem()` 与 `startPortrait()` 里，各查一半：
 *
 *   · `portraitProblem` 只看服务（bz 在不在、Key 配没配）；
 *   · `startPortrait` 只看书（阅读视图里开着的是不是这本）；
 *   · 手机端两处都没看——只有界面把「开始」藏了，逻辑层没有防线。
 *
 * 合到一起是为了能被测试钉住：这个 bug 没有可见症状，取到另一本书的正文
 * 会算出一整本错向量，而界面一切正常。
 * ============================================================ */
import type { PortraitPlan } from './portrait';

export type PortraitBlockReason = 'mobile' | 'noBook' | 'otherBook' | 'noBz' | 'noAi';

export interface PortraitGateInput {
  plan: PortraitPlan;
  /** 手机端不建画像（决策 9）：建好的能读，但别在手机上跑几十次请求 */
  mobile: boolean;
  /** 要建的是这本 */
  bookId: string;
  /** 阅读视图里现在开着的那本（没开是空串） */
  openBookId: string;
  /** bz 门面的问题（没装 / 没启用 / 版本旧），可用时为 null */
  bzProblem: string | null;
  /** 自己的对话模型配好了没（只有压缩方案用得上） */
  aiReady: boolean;
}

/**
 * 能不能开始建：能就返回 null，不能返回原因。
 *
 * 顺序是刻意的：
 *   1. 手机端最先——手机上不管别的问题，只该看到「请在电脑上建」；
 *   2. 书其次——让用户先把这本书打开，再说缺什么服务；
 *   3. 服务最后。
 */
export function portraitBlock(g: PortraitGateInput): PortraitBlockReason | null {
  if (g.mobile) return 'mobile';
  if (!g.openBookId) return 'noBook';
  if (g.openBookId !== g.bookId) return 'otherBook';
  if (g.plan === 'vector') {
    if (g.bzProblem) return 'noBz';
    return null;
  }
  return g.aiReady ? null : 'noAi';
}
