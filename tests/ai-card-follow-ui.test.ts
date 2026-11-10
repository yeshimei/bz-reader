import { afterEach, describe, expect, it } from 'vitest';
import { overlayHtml } from '../src/shell/overlay';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import {
  aiCardDone,
  aiCardFollowDone,
  aiCardFollowFail,
  aiCardKey,
  aiCardReset,
} from '../src/shell/ai-card';
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
      /* 2026-11-11：AI 设置分服务商存，测试统一走「自定义」（地址/密钥/模型齐备） */
      ai: configured
        ? {
            provider: 'custom' as const,
            baseUrl: 'https://api.test/v1',
            keys: { custom: 'k' },
            models: { custom: 'm' },
          }
        : { provider: 'custom' as const, baseUrl: '', keys: {}, models: {} },
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
