import { afterEach, describe, expect, it } from 'vitest';
import { overlayHtml } from '../src/shell/overlay';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import {
  aiCardDone,
  aiCardFollowBegin,
  aiCardFollowDone,
  aiCardFollowFail,
  aiCardKey,
  aiCardReset,
  followHistory,
} from '../src/shell/ai-card';
import { t } from '../src/i18n';
import { makeApp, makeStore } from './helpers/plugin-harness';

/**
 * 追问在卡上的样子（2026-11-10）。
 *
 * 只验「画出来了没有」：输入框、按钮、已经问过的轮次。真正的请求链在
 * tests/ai-follow.test.ts（prompt）与 ai-card.test.ts（记账）里。
 */

const TEXT = '划线原文一段';
const KEY = aiCardKey('ai', 'explain', TEXT);

function install(configured = true): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [], byId: () => undefined },
    store: makeStore(),
    settings: () => ({
      ...DEFAULT_SETTINGS,
      /* AI 三件套：配置齐 / 未配置两种状态 */
      ai: configured
        ? {
            baseUrl: 'https://api.test/v1',
            apiKey: 'k',
            model: 'm',
          }
        : { baseUrl: '', apiKey: '', model: '' },
    }),
    searchText: async () => [],
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
  setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', overlay: { kind: 'ai', bookId: 'b1', text: TEXT, mode: 'explain' } });
}

afterEach(() => {
  aiCardReset();
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('AI 卡 · 发出即回声（2026-11-11 真机反馈）', () => {
  /**
   * 以前：点「追问」之后卡片一动不动，要等十几秒答案回来才「突然多出一大段」。
   * 现在：这一问发出时就进轮次，卡上立刻有「你：…」与「正在回复…」。
   */
  it('点了追问立刻能看到自己那句话与「正在回复」', () => {
    install();
    aiCardDone(KEY, '这是解释');
    aiCardFollowBegin(KEY, '那作者为什么这么写？');
    const html = overlayHtml();
    expect(html).toContain('那作者为什么这么写？');
    expect(html).toContain(t('ai.follow.thinking'));
  });

  it('答案回来之后占位被替换，同一问不会留下两条', () => {
    install();
    aiCardDone(KEY, '这是解释');
    aiCardFollowBegin(KEY, '为什么要这样写');
    aiCardFollowDone(KEY, '为什么要这样写', '因为要留白。');
    const html = overlayHtml();
    expect(html).not.toContain(t('ai.follow.thinking'));
    expect(html).toContain('因为要留白。');
    expect(html.split('为什么要这样写').length - 1).toBe(1);
  });

  it('失败的一轮同样把问题留住，只把占位换成原因', () => {
    install();
    aiCardDone(KEY, '这是解释');
    aiCardFollowBegin(KEY, '一个问不出来的问题');
    aiCardFollowFail(KEY, '一个问不出来的问题', '接口 500');
    const html = overlayHtml();
    expect(html).toContain('一个问不出来的问题');
    expect(html).toContain('接口 500');
    expect(html).not.toContain(t('ai.follow.thinking'));
  });

  it('还在路上的那轮不喂给模型（没有答案的孤儿提问）', () => {
    const turns = [
      { q: '问过的', a: '答过的' },
      { q: '还在路上', a: '', pending: true },
    ];
    const history = followHistory('初次答案', turns);
    const text = history.map((h) => h.content).join('|');
    expect(text).toContain('问过的');
    expect(text).toContain('答过的');
    expect(text).not.toContain('还在路上');
  });
});

describe('AI 卡 · 底部按钮固定在卡片下沿', () => {
  /* 真机反馈：答案一长，输入行下面的「复制 / 重试 / 存为笔记」被挤出可视区。
     结构上把可滚动的部分单独包一层，输入行与按钮放在它外面。 */
  it('输入行与底部按钮在滚动区之外', () => {
    install();
    aiCardDone(KEY, '这是解释');
    const html = overlayHtml();
    const scrollEnd = html.indexOf('data-role="aiturns"');
    expect(html).toContain('class="ai-scroll"');
    expect(scrollEnd).toBeGreaterThan(-1);
    /* 追问输入行与底部按钮都出现在轮次之后 */
    expect(html.indexOf('data-role="aifollow"')).toBeGreaterThan(scrollEnd);
    expect(html.indexOf('data-act="aisave"')).toBeGreaterThan(scrollEnd);
  });
});

describe('AI 卡 · 追问入口', () => {
  it('配好服务时，卡上有追问输入框与按钮', () => {
    install();
    const html = overlayHtml();
    expect(html).toContain('data-role="aifollow"');
    expect(html).toContain('data-act="aifollow"');
  });

  it('没配服务时不摆追问输入框（切了也不会有结果）', () => {
    install(false);
    expect(overlayHtml()).not.toContain('data-role="aifollow"');
  });

  it('有答案之后追问框还在', () => {
    install();
    aiCardDone(KEY, '这是解释');
    const html = overlayHtml();
    expect(html).toContain('这是解释');
    expect(html).toContain('data-role="aifollow"');
  });
});

describe('AI 卡 · 轮次渲染', () => {
  it('问过的轮次画在答案下面，问题和答案都能看到', () => {
    install();
    aiCardDone(KEY, '这是解释');
    aiCardFollowDone(KEY, '为什么这么说？', '因为原文里还有一句。');
    const html = overlayHtml();
    expect(html).toContain('为什么这么说？');
    expect(html).toContain('因为原文里还有一句。');
    expect(html.indexOf('这是解释')).toBeLessThan(html.indexOf('为什么这么说？'));
  });

  it('失败的轮次也留得住：问题与原因都在，重试入口不丢', () => {
    install();
    aiCardDone(KEY, '这是解释');
    aiCardFollowFail(KEY, '问了一半的问题', '接口 401');
    const html = overlayHtml();
    expect(html).toContain('问了一半的问题');
    expect(html).toContain('接口 401');
  });

  it('换个档看不到另一档的追问（各记各的）', () => {
    install();
    aiCardDone(KEY, '这是解释');
    aiCardFollowDone(KEY, '解释档的追问', '解释档的回答');
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'ai', bookId: 'b1', text: TEXT, mode: 'translate' },
    });
    const html = overlayHtml();
    expect(html).not.toContain('解释档的追问');
  });
});
