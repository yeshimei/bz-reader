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

/* ============================================================
 * 操作行与停止（2026-11-17 真机）
 *
 *   1. 气泡里那颗「停止」删掉——它把「正在生成回答」那一行撑成了两行；
 *   2. 停止能力挪到发送键：生成中同一位置换成方标，点了照样能停；
 *   3. 「复制 / 重答」原来是两个块级按钮，各自换行摞在右下角，收成一行图标。
 * ============================================================ */
describe('AI 页签 · 操作行与停止', () => {
  const asked = [
    { me: true as const, tag: '我', text: '这是谁说的？' },
    { me: false as const, tag: 'AI · 全书', text: '是汪太太说的。' },
  ];

  it('等待气泡里不再有停止按钮（它只留「在干什么」一行）', () => {
    const html = view({ aiLog: asked.slice(0, 1), aiStage: 'model' });
    expect(html).toContain('正在生成回答…');
    /* 只看等待气泡那一段：发送键上那颗停止是另一处，不算「气泡里的停止」 */
    const at = html.indexOf('is-pending');
    const bubble = html.slice(at, html.indexOf('bzs-ai-composer'));
    expect(bubble).not.toContain('data-act="aistop"');
    expect(bubble).not.toContain('bzs-ai-stop');
  });

  it('生成中发送键就地换成停止键', () => {
    const html = view({ aiLog: asked.slice(0, 1), aiStage: 'model' });
    const bar = html.slice(html.indexOf('bzs-ai-cbar'));
    expect(bar).toContain('data-act="aistop"');
    expect(bar).not.toContain('data-act="aiask"');
    expect(bar).toContain('data-icon="stop"');
  });

  it('没在生成时发送键还是发送', () => {
    const html = view({ aiLog: asked });
    const bar = html.slice(html.indexOf('bzs-ai-cbar'));
    expect(bar).toContain('data-act="aiask"');
    expect(bar).not.toContain('data-act="aistop"');
  });

  it('复制与重答收在同一行、用原生图标，不再各占一行', () => {
    const html = view({ aiLog: asked });
    const at = html.indexOf('bzs-ai-acts');
    expect(at).toBeGreaterThan(0);
    const acts = html.slice(at, at + 700);
    expect(acts).toContain('data-act="aicopyone"');
    expect(acts).toContain('data-act="airetry"');
    expect(acts).toContain('data-icon="copy"');
    expect(acts).toContain('data-icon="rotate-ccw"');
    /* 旧样式是块级下划线文字，两个按钮必然上下摞 */
    expect(acts).not.toContain('bzs-ai-copy');
  });
});

describe('AI 页签 · 旧索引提示', () => {
  const answerWith = (title: string): string =>
    view({
      aiLog: [
        { me: true, tag: '我', text: '问' },
        { me: false, tag: 'AI', text: '答', sources: [{ title, bookId: 'b1', note: '第 319 块 · 摘录' }] },
      ],
    });

  it('依据写着「第 16 节」这种按顺序编的假章名：说明索引是旧版', () => {
    const html = answerWith('第 16 节');
    expect(html).toContain('bzs-aisrc-old');
    expect(html).toContain('索引是旧版');
  });

  it('真章名不打扰', () => {
    expect(answerWith('第一章')).not.toContain('bzs-aisrc-old');
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

/* ============================================================
 * 流式补字（2026-11-16）
 *
 * 字是一个一个落下来的：气泡要挂 is-live，界面才知道这条还在写
 * （光标动画挂在那个类上；直接改写的那一行 DOM 也靠它找）。
 * ============================================================ */
describe('侧栏 · 流式中', () => {
  it('正在写的那条挂 is-live', () => {
    const html = view({
      aiLog: [
        { me: true, tag: '我', text: '这本书讲了什么' },
        { me: false, tag: 'AI', text: '从斯洛文尼亚开始', live: true },
      ],
    });
    expect(html).toContain('is-live');
    expect(html).toContain('从斯洛文尼亚开始');
  });

  it('收尾之后不再挂（光标要停）', () => {
    const html = view({
      aiLog: [
        { me: true, tag: '我', text: '这本书讲了什么' },
        { me: false, tag: 'AI', text: '从斯洛文尼亚开始。' },
      ],
    });
    expect(html).not.toContain('is-live');
  });
});
