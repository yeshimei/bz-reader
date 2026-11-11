import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayHtml, runAiForOverlay } from '../src/shell/overlay';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT, resetAi } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { aiCardBegin, aiCardDone, aiCardDrop, aiCardFail, aiCardGet, aiCardKey, aiCardReset, aiModeOf } from '../src/shell/ai-card';
import { makeApp, makeStore } from './helpers/plugin-harness';
import { installDomStub } from './helpers/dom-stub';

/**
 * 划词 AI 卡（工具栏那条路，不是侧栏的全书问答）。
 *
 * 这一组测试守的是两件曾经真的坏掉的事：
 *
 *   1. **卡上的答案是渲染出来的，不是只写进 DOM 的**。以前答案写完就只在
 *      当前那一个节点里；弹层任何一次重画（点按钮、切档、授权变化）都会
 *      重建 DOM，页面上退回「正在请求…」，而「已请求过」的记号还在，
 *      于是永远停在那一行——用户以为 AI 卡死了。
 *   2. **三档（解释 / 翻译 / 摘要）住在卡里**，默认解释，切档就地发新请求。
 */

const { flags } = vi.hoisted(() => ({ flags: { mobile: false } }));

vi.mock('../src/core/mobile', () => ({
  isMobileEnv: () => flags.mobile,
  isMobileShell: () => flags.mobile,
  LIBRARY_WIDE: 1000,
  isCompactLibrary: () => false,
}));

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

/* 请求本身不是这组测试要验的：把它换成一句固定的回答，才能看清
   「答完之后去了哪儿」——卡片册子里有，侧栏日志里没有。 */
vi.mock('../src/data/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/ai')>();
  return { ...actual, aiAsk: async () => ({ text: '卡片里的答案' }) };
});

const TEXT = '划线原文一段';

function install(): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [], byId: () => undefined },
    store: makeStore(),
    settings: () => ({
      ...DEFAULT_SETTINGS,
      /* 地址、密钥、模型齐备：AI 卡走的是真实的 aiReady 判断 */
      ai: {
        baseUrl: 'https://api.test/v1',
        apiKey: 'k',
        model: 'm',
      },
    }),
    searchText: async () => [],
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

function open(mode?: string): void {
  setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', overlay: { kind: 'ai', bookId: 'b1', text: TEXT, mode } });
}

afterEach(() => {
  flags.mobile = false;
  aiCardReset();
  resetAi();
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('ai-card · 请求记账', () => {
  it('同一段文字、同一档算同一个键；换一档就是另一份', () => {
    expect(aiCardKey('ai', 'explain', TEXT)).toBe(aiCardKey('ai', 'explain', TEXT));
    expect(aiCardKey('ai', 'explain', TEXT)).not.toBe(aiCardKey('ai', 'translate', TEXT));
  });

  it('开始请求 → 有结果 → 失败，状态跟着走', () => {
    const key = aiCardKey('ai', 'explain', TEXT);
    expect(aiCardGet(key)).toBeUndefined();

    aiCardBegin(key);
    expect(aiCardGet(key)?.status).toBe('busy');

    aiCardDone(key, '这是解释');
    expect(aiCardGet(key)).toMatchObject({ status: 'done', text: '这是解释' });

    aiCardFail(key, '接口 401');
    expect(aiCardGet(key)).toMatchObject({ status: 'error', text: '接口 401' });

    aiCardDrop(key);
    expect(aiCardGet(key)).toBeUndefined();
  });

  it('不认识 / 缺省的 mode 一律按解释', () => {
    expect(aiModeOf(undefined)).toBe('explain');
    expect(aiModeOf('')).toBe('explain');
    expect(aiModeOf('nonsense')).toBe('explain');
    expect(aiModeOf('translate')).toBe('translate');
    expect(aiModeOf('summarize')).toBe('summarize');
  });
});

describe('ai-card · 渲染取自记账，不是只写在 DOM 上', () => {
  it('拿到答案之后，任何一次重画都还画着答案', () => {
    install();
    open('explain');
    aiCardDone(aiCardKey('ai', 'explain', TEXT), '「须眉」指男子。');

    /* 两次 render 就是「画一次、被重画一次」：以前第二次会退回占位文案 */
    expect(overlayHtml()).toContain('「须眉」指男子。');
    const again = overlayHtml();
    expect(again).toContain('「须眉」指男子。');
    expect(again).not.toContain('正在请求');
  });

  it('失败原因也一样留得住', () => {
    install();
    open('explain');
    aiCardFail(aiCardKey('ai', 'explain', TEXT), '连不上 AI 接口');

    expect(overlayHtml()).toContain('连不上 AI 接口');
  });

  it('还没结果时才显示正在请求', () => {
    install();
    open('explain');
    expect(overlayHtml()).toContain('正在请求');

    aiCardBegin(aiCardKey('ai', 'explain', TEXT));
    expect(overlayHtml()).toContain('正在请求');
  });
});

describe('ai-card · 三档页签', () => {
  it('卡里有解释 / 翻译 / 摘要三颗，默认亮解释', () => {
    install();
    open('explain');
    const html = overlayHtml();

    for (const mode of ['explain', 'translate', 'summarize']) {
      expect(html).toContain(`data-act="aimode" data-mode="${mode}"`);
    }
    expect(html).toMatch(/class="bzs-ai-mode on"[^>]*data-mode="explain"/);
  });

  it('当前档换了，亮的那颗跟着换', () => {
    install();
    open('translate');
    expect(overlayHtml()).toMatch(/class="bzs-ai-mode on"[^>]*data-mode="translate"/);
  });

  it('每档各自记答案：切回解释还是原来那一份', () => {
    install();
    open('explain');
    aiCardDone(aiCardKey('ai', 'explain', TEXT), '这是解释');
    aiCardDone(aiCardKey('ai', 'summarize', TEXT), '这是摘要');

    expect(overlayHtml()).toContain('这是解释');
    open('summarize');
    expect(overlayHtml()).toContain('这是摘要');
    open('explain');
    expect(overlayHtml()).toContain('这是解释');
  });
});

/**
 * 两条路：工具栏的 AI 问的是一小段，侧栏的 AI 问的是整本书。
 *
 * 以前卡片答完会把结果 push 进侧栏的问答记录，侧栏于是凭空多出一条
 * 没有提问的答案；用户接着在侧栏追问，会以为这条答案是基于全书的。
 * 现在卡片只写自己的册子。
 */
describe('ai-card · 和侧栏全书问答互不回填', () => {
  /* 请求回填要 querySelector 找 [data-role="aibody"]，这是唯一需要 document 的地方 */
  let off = (): void => undefined;
  beforeEach(() => {
    off = installDomStub();
  });
  afterEach(() => off());

  it('卡里问到答案，侧栏的问答记录里不会多出一条', async () => {
    install();
    open('explain');
    resetAi();

    await runAiForOverlay();

    expect(aiCardGet(aiCardKey('ai', 'explain', TEXT))).toMatchObject({
      status: 'done',
      text: '卡片里的答案',
    });
    expect(RT.aiLog).toHaveLength(0);
  });
});
