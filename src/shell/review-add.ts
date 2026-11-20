/* ============================================================
 * bz-reader · 「加入复习」薄入口（shell/review-add.ts）
 *
 * 2026-11-21 起，复习的一切逻辑都搬进 bz Review：挑范围、AI 挑重点、字数
 * 与每章上限、确认页、样式、弹窗全在 Review 那边。Reader 只负责两个「内容
 * 供货」接口（`readerApi.reviewCatalog` / `reviewChapterText`）和这里三个
 * 入口——侧栏批量、书右键批量、工具条单条 / 划选。
 *
 * 前两个入口只做一件事：找到 Review 的门面，把书 id 递过去。没装 Review，
 * 或 Review 还是老版本（契约 < v6），就说一句话让用户去装 / 更新，绝不退回
 * 旧流程——旧流程已随这次搬迁删除，也不该再留第二套挑内容的实现。
 *
 * 工具条的两个入口仍是单条：一条划线 / 一段划选就是一张卡，没有「挑哪些
 * 章节」的问题，所以直接走 Review 的统一制卡窗口（openCardFlow）。
 * ============================================================ */
import type { App } from 'obsidian';
import { t } from '../i18n';
import { notify } from '../core/notice';
import type { ReaderBook } from '../data/schema';
import { aiCardKey, findReviewApi, markCardKey, reviewReaderFlowReady, type ReviewApi } from '../data/review-bridge';
import { openCardsFlow } from './review-cards-ui';
import { getShellSource, liveBooks } from './source';
import { DEFAULT_HIGHLIGHT_COLOR, ensureHighlight } from '../data/notes';
import { mutateState } from './state';
import { emitNotesChanged } from './runtime';
import { setMarkReviewPlanned } from './review-marks';

/** 侧栏「划线」页那颗按钮的入口（批量：挑哪些划线 / 章节） */
export async function openReviewAdd(app: App | undefined, book: ReaderBook | undefined): Promise<void> {
  if (!app) return;
  if (!book) {
    notify(t('side.empty'), 'info');
    return;
  }
  openReaderFlow(app, book);
}

/** 书右键「加入复习」的入口（同样是批量，归 Review 的窗口管） */
export async function openBookReviewAdd(app: App | undefined, book: ReaderBook | undefined): Promise<void> {
  if (!app || !book) return;
  openReaderFlow(app, book);
}

/**
 * 把「从阅读器挑内容」交给 Review：Reader 只递书 id，不参与挑。
 *
 * 两级提示分开说：没装 → 去装；装了但契约 < v6 → 去更新。AI 也不再在
 * 门口拦（2026-11-19 的结论仍然成立：第一屏「每条一张」不调 AI），由 Review
 * 在真的要挑的时候自己引导。
 */
function openReaderFlow(app: App, book: ReaderBook): void {
  const api = findReviewApi(app);
  if (!api) {
    notify(t('review.needPlugin'), 'info');
    return;
  }
  if (!reviewReaderFlowReady(api)) {
    notify(t('review.cardsNeedUpdate'), 'info');
    return;
  }
  api.openReaderFlow?.({ bookId: book.id });
}

/** 这条钥匙是不是已经在复习计划里（查询失败当「不在」，照常往下走） */
async function alreadyPlanned(api: ReviewApi, key: string): Promise<boolean> {
  if (!api.statusOf) return false;
  try {
    const rows = await api.statusOf([key]);
    return rows.some((r) => r.path === key && r.planned);
  } catch {
    return false;
  }
}

/**
 * 工具条上的「加入复习」：点开一条已经划好的线 → 弹统一制卡窗口。
 *
 * 一条划线就是一张卡，没有「挑哪些章节」的问题。重复点不会排两次——
 * 钥匙由 `reader:<书>:<划线>` 决定，Review 那边见到已存在就跳过。
 * 2026-11-19 起入口处就先问一句：已经在计划里的，不再开界面、也不再
 * 让 AI 白出一遍题。
 */
export async function addMarkToReview(app: App | undefined, book: ReaderBook | undefined, markId: string | undefined): Promise<void> {
  if (!app || !book) return;
  const h = (book.notes?.highlights ?? []).find((x) => x.id === markId);
  if (!h) {
    notify(t('notice.mark.notFound'), 'error');
    return;
  }
  const key = markCardKey(book.id, h.id);
  const api = findReviewApi(app);
  if (api && (await alreadyPlanned(api, key))) {
    notify(t('review.alreadyPlanned'), 'info');
    return;
  }
  openCardsFlow(app, [{
    key,
    bookTitle: book.meta.title || '',
    chapterTitle: h.chapterTitle,
    text: h.text,
    comment: h.comment,
  }], {
    /* 入库成功后工具条那颗按钮直接改叫「已在复习」，不必等下次开书重查 */
    onAdded: () => setMarkReviewPlanned(book.id, h.id),
  });
}

/**
 * 工具条上的「加入复习」：划了一段还没保存 → 弹三选一制卡。
 *
 * 不先落一条划线：用户点的是「去复习」，不是「在书里标一笔」。钥匙按
 * 「书 + 章节 + 原文」算，同一段文字重复加不会排两次。
 */
export async function addSelectionToReview(
  app: App | undefined,
  sel: {
    text: string;
    bookId: string;
    chapterTitle?: string;
    /** 选区定位串：入库成功后据此补一条划线（PDF 是 `pdf/<页>/…`，EPUB 是 CFI 范围） */
    cfiRange?: string;
    chapterIndex?: number;
  } | null | undefined,
): Promise<void> {
  if (!app || !sel || !String(sel.text ?? '').trim()) return;
  const book = liveBooks().find((b) => b.id === sel.bookId);
  if (!book) return;
  const title = sel.chapterTitle || '';
  const key = aiCardKey(book.id, title, sel.text);
  const api = findReviewApi(app);
  if (api && (await alreadyPlanned(api, key))) {
    notify(t('review.alreadyPlanned'), 'info');
    return;
  }
  openCardsFlow(app, [{
    key,
    bookTitle: book.meta.title || '',
    chapterTitle: title || undefined,
    text: String(sel.text).trim(),
  }], {
    /* 确认加入后把这段文字顺手划上：用户点的是「加入复习」，
       但回头看原文时也该能找到是哪一段（2026-11-19）。
       不先划线、只在这时补，取消弹窗就不会在书里留痕。
       2026-11-20：补完划线立刻清掉正文里的选区高亮（否则选区一直亮着挡正文），
       也不再弹那条带撤销按钮的通知——「已加入 N 条复习」本身就是回执。 */
    onAdded: () => {
      const id = ensureSelectionMark(book, sel);
      if (!id) return;
      setMarkReviewPlanned(book.id, id);
      getShellSource()?.clearSelection();
    },
  });
}

/** 给划选的文字补一条划线（同位置已有就复用，不叠第二条、不改用户颜色） */
function ensureSelectionMark(
  book: ReaderBook,
  sel: { text: string; cfiRange?: string; chapterTitle?: string; chapterIndex?: number },
): string {
  const text = String(sel.text ?? '').trim();
  if (!text || !sel.cfiRange) return '';
  const { highlight, created } = ensureHighlight(book, {
    text,
    cfiRange: sel.cfiRange,
    chapterTitle: sel.chapterTitle,
    chapterIndex: sel.chapterIndex,
    color: DEFAULT_HIGHLIGHT_COLOR,
  });
  if (created) {
    getShellSource()?.store.touch();
    mutateState(() => undefined);
    emitNotesChanged();
  }
  return highlight.id;
}
