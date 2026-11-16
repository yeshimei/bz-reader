import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import { viewSidebar, type SidebarView } from '../src/shell/render/sidebar';
import type { AiContextItem } from '../src/shell/ai-context';

/* ============================================================
 * 侧栏 A 版聊天界面（2026-11-16）：
 *   · 输入框是多行 textarea，不是旧的单行 input；
 *   · 四类上下文 chip 和「发送」亮灭都由模板决定；
 *   · 笔记选择器只在打开时出现。
 * 只断言结构行为，不锁具体 class 的实现细节之外的东西。
 * ============================================================ */

function book(): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '围城', author: '钱钟书' },
    fileRef: { vaultPath: 'Books/围城.epub', format: 'epub' },
    reading: { position: { percent: 0.2 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 1,
  };
}

function view(patch: Partial<SidebarView> = {}): string {
  return viewSidebar({
    book: book(),
    tab: 'ai',
    toc: [],
    activeLabel: '',
    activeHref: '',
    aiLog: [],
    aiReady: true,
    aiIndex: { state: 'ready', chars: 260000, plan: 'compress', blocks: 128 },
    ...patch,
  });
}

const quote: AiContextItem = { kind: 'quote', text: '结婚仿佛金漆的鸟笼', meta: '第三章 · 划线' };
const body: AiContextItem = { kind: 'body', text: '这一屏正文', chars: 462 };
const note: AiContextItem = {
  kind: 'note',
  text: '围城里的三次围城',
  path: '读书笔记/围城/主题.md',
};
const shot: AiContextItem = {
  kind: 'shot',
  thumb: 'data:image/png;base64,AA',
  meta: '250 × 152',
};

describe('AI 页签 · A 版聊天结构', () => {
  it('输入框换成 textarea，保留 data-role="aiask" 钩子', () => {
    const html = view();
    expect(html).toContain('<textarea data-role="aiask"');
    expect(html).not.toMatch(/<input data-role="aiask"/);
    expect(html).toContain('问这本书…');
  });

  it('空对话只给一条 AI 提示，不加空态卡片', () => {
    const html = view();
    expect(html).toContain('选中一段文字可以问 AI');
    expect(html.match(/bzs-aibubble ai/g)?.length).toBe(1);
  });

  it('顶部元信息是「按全书回答 · N 块」和一枚「重建」下划线小字', () => {
    const html = view();
    expect(html).toContain('按全书回答 · 128 块');
    expect(html).toContain('>重建</button>');
    expect(html).not.toContain('重建索引</button>');
  });

  it('四类上下文各画出自己的 chip', () => {
    const html = view({ aiCtx: [quote, body, note, shot] });
    expect(html).toContain('结婚仿佛金漆的鸟笼');
    expect(html).toContain('正文 · 462 字');
    expect(html).toContain('围城里的三次围城');
    expect(html).toContain('截图');
    expect(html.match(/data-act="aictxdel"/g)?.length).toBe(4);
    expect(html).toContain('data:image/png');
  });

  it('发出去的气泡里也保留上下文 chip，但不能删', () => {
    const html = view({
      aiLog: [{ me: true, tag: '我', text: '这句什么意思', ctx: [quote] }],
    });
    expect(html).toContain('bzs-aictx is-sent');
    expect(html).toContain('这句什么意思');
    expect(html).not.toContain('data-act="aictxdel"');
  });

  it('只有空白时发送禁用；有上下文或打了字就亮', () => {
    expect(view({ aiDraft: '   ' })).toContain('bzs-ai-send" data-act="aiask" aria-label="发送" title="发送" disabled');
    expect(view({ aiDraft: '问' })).not.toContain('title="发送" disabled');
    expect(view({ aiCtx: [quote] })).not.toContain('title="发送" disabled');
  });

  it('三颗命令与发送都用 Obsidian 原生图标，而不是文字 / ↑ 字符', () => {
    const html = view();
    const bar = html.slice(html.indexOf('bzs-ai-cbar'));
    expect(bar.match(/data-act="aictx(?:body|shot|note)"/g)?.length).toBe(3);
    expect(bar.match(/class="bzs-ico-native"/g)?.length).toBe(4);
    expect(html).not.toContain('>↑</button>');
    expect(html).toContain('title="正文"');
    expect(html).toContain('title="截图"');
    expect(html).toContain('title="笔记"');
  });

  it('三颗命令换成更直白的图形：段落 / 图片 / 便签', () => {
    const html = view();
    const bar = html.slice(html.indexOf('bzs-ai-cbar'));
    /* 原来那三枚（文件 / 四角扫描框 / 线圈本）缩到 16px 分不出是干什么的：
       正文要和「截图」「笔记」并排看才认得出。 */
    expect(bar).toContain('data-icon="align-left"');
    expect(bar).toContain('data-icon="image"');
    expect(bar).toContain('data-icon="sticky-note"');
    expect(bar).not.toContain('data-icon="file-text"');
    expect(bar).not.toContain('data-icon="scan"');
    expect(bar).not.toContain('data-icon="notebook"');
  });

  it('笔记选择器默认关闭；打开后列最近笔记与搜索框', () => {
    expect(view()).not.toContain('bzs-picker');
    const html = view({
      aiNoteOpen: true,
      aiNotes: [{ title: '围城里的三次围城', path: '读书笔记/围城/主题.md', desc: '读书笔记/围城' }],
    });
    expect(html).toContain('连接笔记');
    expect(html).toContain('搜笔记…');
    expect(html).toContain('围城里的三次围城');
    expect(html).toContain('data-act="aictxnotepick"');
  });

  it('书名行带作者（原型 bookline 的口径）', () => {
    const html = view();
    expect(html).toMatch(/<b>围城<\/b><span class="author">钱钟书<\/span>/);
  });
});
