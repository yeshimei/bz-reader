import { describe, expect, it } from 'vitest';
import { viewSidebar } from '../src/shell/render/sidebar';

/**
 * 书还没解析出目录时，旧界面只丢一句「这本书还没有解析出目录」，
 * 用户没有任何下一步。现在给一个「打开当前书籍」按钮。
 */
describe('目录空态', () => {
  it('给「打开当前书籍」按钮，而不是死文案', () => {
    const html = viewSidebar({
      book: { id: 'b1', meta: { title: '红楼梦' } },
      tab: 'toc',
      toc: [],
      aiLog: [],
      aiReady: false,
      aiProvider: '',
    } as never);
    expect(html).toContain('data-act="openbook"');
    expect(html).toContain('打开当前书籍');
    expect(html).not.toContain('还没有解析出目录');
  });
});
