import { afterEach, describe, expect, it, vi } from 'vitest';
import { overlayHtml } from '../src/shell/overlay';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { addHighlight } from '../src/data/notes';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

/**
 * 工具条合并后的浮层形状（S11 定稿）。
 *
 * 定下来的四件事，每一条在这里都有一个断言：
 *   1. 桌面点划线：想法气泡在**上**、工具条在**下**，整块再贴到划线上面；
 *   2. 桌面想法 / 书摘 / AI：正文在上、同一枚工具条在下，工具条不因换面板而换位置；
 *   3. 手机：不摆工具条、也不摆想法气泡，面板独立成遮罩弹窗（不跟工具条走）；
 *   4. 手机删除确认与书摘 / AI 同一张遮罩弹窗，桌面维持原来的浮卡。
 *
 * 只断言「有没有这一块、谁在谁前面」，不断言具体 class 拼写之外的东西。
 */

/* 手机 / 桌面在这里切：overlay 只按 isMobileEnv 分叉，不认 force-mobile 验收开关 */
const { flags } = vi.hoisted(() => ({ flags: { mobile: false } }));

vi.mock('../src/core/mobile', () => ({
  isMobileEnv: () => flags.mobile,
  isMobileShell: () => flags.mobile,
  LIBRARY_WIDE: 1000,
  isCompactLibrary: () => false,
}));

/* 这几层全在授权后面；形状测试只关心长得对不对，不关心卖什么 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

afterEach(() => {
  flags.mobile = false;
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
});

function install(books: unknown[]): void {
  setShellSource({
    app: makeApp(),
    repo: {
      all: () => books,
      byId: (id: string) => (books as Array<{ id: string }>).find((b) => b.id === id),
    },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS, exportDir: '书摘' }),
    searchText: async () => [],
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

/** 一本书 + 一条划线；`comment` 有值时这条划线带着想法 */
function marked(comment?: string): { book: ReturnType<typeof testBook>; markId: string } {
  const book = testBook('b1', '测试书');
  const mark = addHighlight(book as never, {
    text: '划线原文一段',
    cfiRange: 'cfi1',
    chapterTitle: '第一章',
    color: 'green',
    comment,
  });
  return { book, markId: mark.id };
}

/** 打开某个浮层并取它渲染出来的 HTML */
function render(kind: 'hltools' | 'idea' | 'quote' | 'ai' | 'confirmdel', markId = ''): string {
  setState({
    ...DEFAULT_SHELL_STATE,
    bookId: 'b1',
    overlay:
      kind === 'quote'
        ? { kind, text: '划线原文一段', bookId: 'b1', chapterTitle: '第一章', markId }
        : kind === 'ai'
          ? { kind, text: '划线原文一段', bookId: 'b1', markId }
          : { kind, markId, bookId: 'b1' },
  });
  return overlayHtml();
}

describe('桌面：想法气泡与工具条叠成一列', () => {
  it('点划线：气泡在上、工具条在下', () => {
    const { book, markId } = marked('这条想法');
    install([book]);
    const html = render('hltools', markId);

    expect(html).toContain('bzs-tb-stack');
    expect(html).toContain('bzs-mark-bubble');
    expect(html.indexOf('bzs-mark-bubble')).toBeLessThan(html.indexOf('class="bzs-tb"'));
  });

  it('六颗动作全走 hl*，且带上这条划线的 id', () => {
    const { book, markId } = marked('这条想法');
    install([book]);
    const html = render('hltools', markId);

    for (const act of ['hlcolor', 'hlidea', 'hlquote', 'hlai', 'copylink', 'hlcopy', 'hldel']) {
      expect(html).toContain(`data-act="${act}"`);
    }
    expect(html).toContain(`data-id="${markId}"`);
    /* 划词那套动作名不该漏进点划线的浮层：两套同名按钮会各发各的动作 */
    expect(html).not.toContain('selidea');
  });

  it('划线上没有想法时，不出现空气泡', () => {
    const { book, markId } = marked();
    install([book]);
    expect(render('hltools', markId)).not.toContain('bzs-mark-bubble');
  });

  it('桌面上没有「⋯」：五颗（+删除）全平铺', () => {
    const { book, markId } = marked();
    install([book]);
    expect(render('hltools', markId)).not.toContain('data-act="more"');
  });
});

describe('桌面：想法 / 书摘 / AI 的正文在上、工具条在下', () => {
  it('想法输入框在工具条上面，且「想法」是亮着的', () => {
    const { book, markId } = marked();
    install([book]);
    const html = render('idea', markId);

    expect(html).toContain('bzs-tb-stack');
    expect(html.indexOf('bzs-sheet-input')).toBeLessThan(html.indexOf('class="bzs-tb"'));
    expect(html).toContain('class="bzs-sbtn pri on" data-act="hlidea"');
  });

  it('书摘卡下面也是同一枚工具条，亮「书摘」', () => {
    const { book, markId } = marked();
    install([book]);
    const html = render('quote', markId);

    expect(html).toContain('bzs-tb-stack');
    expect(html.indexOf('bzs-qcard')).toBeLessThan(html.indexOf('class="bzs-tb"'));
    expect(html).toContain('class="bzs-sbtn on" data-act="hlquote"');
  });

  it('从刚划的选区开书摘（还没有划线）：走 sel*，且不出现删除', () => {
    const { book } = marked();
    install([book]);
    const html = render('quote');

    expect(html).toContain('class="bzs-sbtn on" data-act="selquote"');
    expect(html).not.toContain('data-act="hldel"');
  });

  it('AI 卡下面同理，亮「AI」', () => {
    const { book, markId } = marked();
    install([book]);
    const html = render('ai', markId);

    expect(html).toContain('bzs-tb-stack');
    expect(html).toContain('class="bzs-sbtn on" data-act="hlai"');
  });
});

describe('手机：面板独立成遮罩弹窗，不跟工具条', () => {
  it('想法：遮罩 + 独立弹窗，且没有工具条也没有气泡', () => {
    flags.mobile = true;
    const { book, markId } = marked('这条想法');
    install([book]);
    const html = render('idea', markId);

    expect(html).toContain('bzs-scrim');
    expect(html).toContain('bzs-text-scrim');
    expect(html).toContain('is-dialog');
    expect(html).not.toContain('class="bzs-tb"');
    expect(html).not.toContain('bzs-mark-bubble');
  });

  it('书摘：同样是一张独立弹窗', () => {
    flags.mobile = true;
    const { book } = marked();
    install([book]);
    const html = render('quote');

    expect(html).toContain('bzs-text-scrim');
    expect(html).not.toContain('class="bzs-tb"');
  });

  it('AI：同样是一张独立弹窗', () => {
    flags.mobile = true;
    const { book, markId } = marked();
    install([book]);
    const html = render('ai', markId);

    expect(html).toContain('bzs-text-scrim');
    expect(html).not.toContain('class="bzs-tb"');
  });

  it('点划线：工具条照旧贴字，但不摆想法气泡，其余动作收进「⋯」', () => {
    flags.mobile = true;
    const { book, markId } = marked('这条想法');
    install([book]);
    const html = render('hltools', markId);

    expect(html).toContain('class="bzs-tb"');
    expect(html).toContain('data-act="more"');
    expect(html).toContain('bzs-tb-more');
    expect(html).not.toContain('bzs-mark-bubble');
    expect(html).not.toContain('bzs-scrim');
  });

  it('删除确认也用同一张遮罩弹窗', () => {
    flags.mobile = true;
    const { book, markId } = marked();
    install([book]);
    expect(render('confirmdel', markId)).toContain('bzs-text-scrim');
  });
});

describe('桌面：删除确认保持原来的浮卡', () => {
  it('不套遮罩', () => {
    const { book, markId } = marked();
    install([book]);
    expect(render('confirmdel', markId)).not.toContain('bzs-text-scrim');
  });
});
