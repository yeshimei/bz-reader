import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayHtml, runAiForOverlay } from '../src/shell/overlay';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT, resetAi } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import {
  aiCardAppend,
  aiCardBegin,
  aiCardDone,
  aiCardDrop,
  aiCardDropTurn,
  aiCardFail,
  aiCardFollowAppend,
  aiCardFollowBegin,
  aiCardFollowDone,
  aiCardGet,
  aiCardKey,
  aiCardReset,
  aiModeOf,
  sessionToCard,
} from '../src/shell/ai-card';
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

  it('还没结果时才显示等待气泡', () => {
    install();
    open('explain');
    expect(overlayHtml()).toContain('bzs-typing');

    aiCardBegin(aiCardKey('ai', 'explain', TEXT));
    expect(overlayHtml()).toContain('bzs-typing');
  });
});

describe('ai-card · 菜单与浮框是同一个位置的两态', () => {
  it('菜单打开时只有五项那一行，没有浮框', () => {
    install();
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'ai', bookId: 'b1', text: TEXT, mode: 'explain', menu: true },
    });
    const html = overlayHtml();
    expect(html).toContain('bzs-aimenu');
    expect(html).not.toContain('bzs-aifloat');
  });

  it('每档各自记答案：切回解释还是原来那一份', () => {
    install();
    open('explain');
    aiCardDone(aiCardKey('ai', 'explain', TEXT), '这是解释');
    aiCardDone(aiCardKey('ai', 'summarize', TEXT), '这是总结');

    expect(overlayHtml()).toContain('这是解释');
    open('summarize');
    expect(overlayHtml()).toContain('这是总结');
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

/* ============================================================
 * 流式补字（2026-11-16）
 *
 * 浮框里的追问原来要等整条回答回来才动一下：本地 14B 一问 77 秒，
 * 这 77 秒卡片只有一个等待动画。改成流式之后，账本必须「边收边长」，
 * 而且中途不能被当成「已经答完」——`status` 还是 busy。
 * ============================================================ */
describe('AI 卡 · 流式补字', () => {
  const key = aiCardKey('ai', 'follow', '方鸿渐站在甲板上。', 'm1');

  beforeEach(() => aiCardReset());
  afterEach(() => aiCardReset());

  it('首答边收边长，状态仍是 busy（还在跑）', () => {
    aiCardBegin(key, '他后来怎么了', '10:00');
    expect(aiCardAppend(key, '他')).toBe('他');
    expect(aiCardAppend(key, '走了')).toBe('他走了');
    expect(aiCardGet(key)).toMatchObject({ status: 'busy', text: '他走了' });
  });

  it('首问的 ask 与时刻不被流式冲掉（归档要用）', () => {
    aiCardBegin(key, '他后来怎么了', '10:00');
    aiCardAppend(key, '他走了');
    expect(aiCardGet(key)).toMatchObject({ ask: '他后来怎么了', at: '10:00' });
  });

  it('追问只长最后一轮，前几轮一个字不动', () => {
    aiCardBegin(key, '第一问', '10:00');
    aiCardDone(key, '第一答');
    aiCardFollowBegin(key, '第二问');
    expect(aiCardFollowAppend(key, '第二问', '答')).toBe('答');
    expect(aiCardFollowAppend(key, '第二问', '案')).toBe('答案');

    const entry = aiCardGet(key)!;
    expect(entry.text).toBe('第一答');
    expect(entry.turns).toHaveLength(1);
    expect(entry.turns![0]).toMatchObject({ q: '第二问', a: '答案', pending: true });
  });

  it('对不上那一轮就返回 null（不往别人的答案里追加）', () => {
    aiCardBegin(key, '第一问', '10:00');
    aiCardDone(key, '第一答');
    aiCardFollowBegin(key, '第二问');
    expect(aiCardFollowAppend(key, '别的问题', '答')).toBeNull();
  });

  it('卡片已经被清掉（换档 / 关卡 / 清空对话）返回 null', () => {
    expect(aiCardAppend(key, '字')).toBeNull();
    expect(aiCardFollowAppend(key, '问', '字')).toBeNull();
  });

  it('收尾换成完整文本：流里拼的那份只是过程显示', () => {
    aiCardBegin(key, '问', '10:00');
    aiCardAppend(key, '半截');
    aiCardDone(key, '完整答案，比流里拼的多两个字。');
    expect(aiCardGet(key)).toMatchObject({
      status: 'done',
      text: '完整答案，比流里拼的多两个字。',
    });
  });
});

describe('ai-card · 浮框来源与删单轮（2026-11-17）', () => {
  const key = aiCardKey('ai', 'explain', '婚姻是一座围城');

  beforeEach(() => aiCardReset());
  afterEach(() => aiCardReset());

  it('首答与追问的来源各自存进账本', () => {
    const head = [{ title: '第一章', bookId: 'b1' }];
    const tail = [{ title: '第二章', bookId: 'b1' }];
    aiCardBegin(key, '解释', '10:00');
    aiCardDone(key, '首答', head);
    aiCardFollowBegin(key, '后来呢');
    aiCardFollowDone(key, '后来呢', '追问答', tail);

    const entry = aiCardGet(key)!;
    expect(entry.sources).toEqual(head);
    expect(entry.turns?.[0].sources).toEqual(tail);
  });

  it('删单轮：只删指定那一对，别的轮次下标前移照常画', () => {
    aiCardBegin(key, '解释', '10:00');
    aiCardDone(key, '首答');
    aiCardFollowBegin(key, '问一');
    aiCardFollowDone(key, '问一', '答一');
    aiCardFollowBegin(key, '问二');
    aiCardFollowDone(key, '问二', '答二');

    expect(aiCardDropTurn(key, 0)).toBe(true);
    expect(aiCardGet(key)!.turns?.map((t) => t.q)).toEqual(['问二']);
    /* 越界与坏下标都不动账本 */
    expect(aiCardDropTurn(key, 5)).toBe(false);
    expect(aiCardDropTurn(key, -1)).toBe(false);
    expect(aiCardGet(key)!.turns).toHaveLength(1);
  });

  it('恢复落盘会话时把来源带回卡片', () => {
    const entry = sessionToCard({
      id: 'id-1',
      bookId: 'b1',
      bookTitle: '围城',
      kind: 'explain',
      when: 1_700_000_000_000,
      turns: [
        { me: true, text: '解释' },
        { me: false, text: '首答', sources: [{ title: '第一章', bookId: 'b1' }] },
        { me: true, text: '后来呢' },
        { me: false, text: '追问答', sources: [{ title: '第二章', bookId: 'b1' }] },
      ],
    });
    expect(entry.sources?.[0].title).toBe('第一章');
    expect(entry.turns?.[0].sources?.[0].title).toBe('第二章');
  });
});
