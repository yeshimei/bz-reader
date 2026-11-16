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

/* ============================================================
 * 侧栏问答的三件「像真正的 AI」（2026-11-16）
 *
 *   1. 发出问题立刻有反馈：等依据 / 等回答时挂一条带跳动点的气泡，
 *      以前这段时间侧栏一片空白，看着像没点动；
 *   2. 每条回答能复制，底部能复制整段 / 归档 —— 与划词浮框对齐；
 *   3. 有历史 / 新建 / 清除三颗，重启之后还找得回上次的对话。
 * ============================================================ */
describe('AI 页签 · 等待态与对话操作', () => {
  const asked = [
    { me: true as const, tag: '我', text: '这是谁说的？' },
    { me: false as const, tag: 'AI · 全书', text: '是汪太太说的。' },
  ];

  it('等依据时挂一条跳动点气泡，说清楚在干什么', () => {
    const html = view({ aiLog: asked.slice(0, 1), aiStage: 'evidence' });
    expect(html).toContain('bzs-aibubble ai is-pending');
    expect(html).toContain('bzs-typing');
    expect(html).toContain('正在检索依据…');
  });

  it('拿到依据后字样换成「正在生成回答」', () => {
    const html = view({ aiLog: asked.slice(0, 1), aiStage: 'model' });
    expect(html).toContain('正在生成回答…');
  });

  it('没有在等的时候不画等待气泡', () => {
    const html = view({ aiLog: asked, aiStage: '' });
    expect(html).not.toContain('is-pending');
  });

  it('每条 AI 回答下都有「复制」，并且带得住下标', () => {
    const html = view({ aiLog: asked });
    expect(html).toContain('data-act="aicopyone" data-i="1"');
  });

  it('有回答才有「复制整段 / 归档」，空对话不给这两颗', () => {
    const html = view({ aiLog: asked });
    expect(html).toContain('data-act="aicopychat"');
    expect(html).toContain('data-act="aisavelog"');
    /* 空对话只有一条提示，没有可复制的东西 */
    const empty = view({ aiLog: [] });
    expect(empty).not.toContain('data-act="aicopychat"');
  });

  it('元信息行给出历史 / 新建 / 清除', () => {
    const html = view({ aiLog: asked });
    for (const act of ['aihist', 'ainew', 'aiclear']) expect(html).toContain(`data-act="${act}"`);
  });

  it('历史面板列出每条对话：首问摘要、轮数、当前那条标出来', () => {
    const html = view({
      aiLog: asked,
      aiChatId: 'id-2',
      aiHistOpen: true,
      aiHist: [
        { id: 'id-2', head: '这是谁说的？', n: 3, when: '11-16 14:32', here: true },
        { id: 'id-1', head: '方鸿渐是谁', n: 1, when: '11-15 09:10', here: false },
      ],
    });
    expect(html).toContain('bzs-aihist');
    expect(html).toContain('这是谁说的？');
    expect(html).toContain('3 轮 · 11-16 14:32');
    expect(html).toContain('is-here');
    expect(html).toContain('data-act="aihistdel" data-id="id-1"');
  });

  it('没有别的对话时历史面板说明白，不是一片空白', () => {
    const html = view({ aiLog: [], aiHistOpen: true, aiHist: [] });
    expect(html).toContain('还没有别的对话');
  });
});

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

/* ============================================================
 * 引文告警（2026-11-16）
 *
 * 答案里的引文回依据里核不上的时候，气泡下面要有一行说明。
 * 正常答案不该多这个字——所以两条都锁：有 warn 才有行，没有就没有。
 * ============================================================ */
describe('侧栏 · 引文告警', () => {
  const answer = (warn?: string): string =>
    view({
      aiLog: [
        { me: true, tag: '我', text: '船叫什么' },
        { me: false, tag: 'AI', text: '叫「白拉日隆子爵号」。', warn },
      ],
    });

  it('核不上时给一行告警', () => {
    const html = answer('有 1 处引文和依据对不上，重要结论请回原文核对。');
    expect(html).toContain('bzs-aiwarn');
    expect(html).toContain('1 处引文');
  });

  it('全部对得上时不出现', () => {
    expect(answer()).not.toContain('bzs-aiwarn');
  });

  it('用户自己的消息不挂告警（warn 只属于回答）', () => {
    const html = view({ aiLog: [{ me: true, tag: '我', text: '问', warn: '不该出现' }] });
    expect(html).not.toContain('不该出现');
  });
});
