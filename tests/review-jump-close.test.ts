/**
 * 点划线工具框上的「去复习」跳走后，工具框必须跟着关（2026-11-20）。
 *
 * 该划线已在复习计划里时，hlreview 会调 Review 的 focusCard 跳到那张卡。
 * 以前跳完浮层还留在屏幕上，像一张撕不掉的便签。这里把「跳走即关」
 * 钉成行为断言：无论 focusCard 成功失败，工具框都不能继续挂着。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource } from '../src/shell/source';
import { forgetReviewMarks, setMarkReviewPlanned } from '../src/shell/review-marks';
import { markCardKey } from '../src/data/review-bridge';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

const focusCard = vi.fn(async (_key: string) => undefined);

/** app 上挂一个最小的 Review 门面：只有 focusCard 被用到 */
function appWithReview(): unknown {
  const app = makeApp() as any;
  app.plugins = { plugins: { 'bz-review': { reviewApi: { addCards: async () => ({}), focusCard } } } };
  return app;
}

function install(bookId: string, markId: string): void {
  const book = testBook(bookId, '书');
  book.notes.highlights.push({ id: markId, cfiRange: 'epubcfi(/6/4)', text: '要复习的话' } as never);
  setShellSource({
    app: appWithReview(),
    repo: { all: () => [book] },
    store: makeStore(),
  } as never);
}

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  forgetReviewMarks();
  focusCard.mockClear();
});

describe('去复习：跳走前关掉文字工具框', () => {
  it('已在复习计划的划线点「去复习」，关浮层并定位到那张卡', () => {
    install('b1', 'h1');
    setMarkReviewPlanned('b1', 'h1');
    /* 点划线弹出的是 hltools 浮层 */
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', overlay: { kind: 'hltools', markId: 'h1', bookId: 'b1' } });
    const el = { dataset: { id: 'h1', book: 'b1' } } as unknown as HTMLElement;

    dispatchAction('hlreview', el);

    expect(focusCard).toHaveBeenCalledWith(markCardKey('b1', 'h1'));
    /* 跳转发生了，工具框必须已经消失 */
    expect(getState().overlay).toBeNull();
  });
});
