import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import type { BuildProgress } from '../src/data/portrait-build';
import { viewSidebar, type AiIndexView, type SidebarView } from '../src/shell/render/sidebar';

/**
 * 侧栏 AI 页签：先建索引，再提问（2026-11-07 定稿）。
 *
 * 这一版换掉了弹窗：
 *   · 打开 AI 页签先看索引建没建；没建就给「建立索引」+「观看视频教程」；
 *   · 建法选择与进度**都在这块侧栏里**，不再弹「全书问答准备」；
 *   · 索引建好之后才出现输入框，提问一律按全书回答，没有档位可选。
 */
function book(): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '瓦尔登湖', author: '梭罗' },
    fileRef: { vaultPath: 'Books/walden.epub', format: 'epub' },
    reading: { position: { percent: 0.2 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 1,
  };
}

function idx(patch: Partial<AiIndexView> = {}): AiIndexView {
  return { state: 'none', chars: 260000, plan: 'vector', ...patch };
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
    aiProvider: '模型',
    aiIndex: idx(),
    ...patch,
  });
}

function running(patch: Partial<BuildProgress> = {}): BuildProgress {
  return {
    status: 'running',
    plan: 'vector',
    bookId: 'b1',
    bookTitle: '瓦尔登湖',
    total: 130,
    done: 12,
    failed: 0,
    phase: 'embed',
    extractDone: 6,
    extractTotal: 6,
    startedAt: 0,
    elapsedMs: 0,
    ...patch,
  };
}

describe('AI 页签 · 没建索引', () => {
  it('给「建立索引」和「观看视频教程」两颗按钮', () => {
    const html = view();
    expect(html).toContain('data-act="aiidx"');
    expect(html).toContain('建立索引');
    expect(html).toContain('data-act="aitutorial"');
    expect(html).toContain('观看视频教程');
  });

  it('没有索引就不出现输入框（建好之前问不了）', () => {
    const html = view();
    expect(html).not.toContain('data-role="aiask"');
    expect(html).not.toContain('data-act="aiask"');
  });

  it('还在读索引状态时先不摆按钮，避免建过的书闪一下「建立索引」', () => {
    const html = view({ aiIndex: idx({ loading: true }) });
    expect(html).not.toContain('data-act="aiidx"');
  });

  it('手机上不建索引，但教程按钮保留', () => {
    const html = view({ aiIndex: idx({ mobile: true }) });
    expect(html).toContain('data-act="aitutorial"');
    expect(html).not.toContain('data-act="aiidx"');
  });

  it('需要重建时把原因写在按钮上面', () => {
    const html = view({ aiIndex: idx({ state: 'stale' }) });
    expect(html).toContain('需要重建');
    expect(html).toContain('data-act="aiidx"');
  });
});

describe('AI 页签 · 索引建好', () => {
  it('建好之后才出现输入框与「问」', () => {
    const html = view({ aiIndex: idx({ state: 'ready', blocks: 130 }) });
    expect(html).toContain('data-role="aiask"');
    expect(html).toContain('data-act="aiask"');
  });

  it('建好之后不再占着「建立索引」的大按钮', () => {
    const html = view({ aiIndex: idx({ state: 'ready' }) });
    expect(html).not.toContain('data-act="aiidx"');
  });

  it('提问按全书回答，没有三档可切', () => {
    const html = view({ aiIndex: idx({ state: 'ready' }) });
    expect(html).not.toContain('当前这一屏');
    expect(html).not.toContain('连接 AI 知识库');
    expect(html).not.toContain('data-act="aiscreen"');
    expect(html).not.toContain('data-act="aiscope"');
  });

  it('草稿跟着重绘走：没建索引时提示完，打好的问题还在', () => {
    /* 侧栏是整页重建（setHtml），输入框不存草稿就会被换成一个空的 */
    const html = view({ aiIndex: idx({ state: 'ready' }), aiDraft: '这本书讲了什么' });
    expect(html).toContain('value="这本书讲了什么"');
  });
});

describe('AI 页签 · 建索引的过程留在侧栏里', () => {
  it('点了「建立索引」就地给两种建法，不弹窗', () => {
    const html = view({ aiIndex: idx({ choosing: true }) });
    expect(html.match(/data-act="aiplan"/g)?.length).toBe(2);
    expect(html).toContain('data-act="aistart"');
  });

  it('选择页把块数与请求数写在按钮上（先看代价再决定）', () => {
    const html = view({ aiIndex: idx({ choosing: true }) });
    expect(html).toMatch(/约 \d+ 次嵌入请求/);
    expect(html).toMatch(/约 \d+ 次 AI 请求/);
  });

  it('跑起来之后显示进度、暂停与取消', () => {
    const html = view({ aiIndex: idx({ state: 'building', progress: running() }) });
    expect(html).toContain('第 12 / 130 块');
    expect(html).toContain('data-act="ptpause"');
    expect(html).toContain('data-act="aiidxstop"');
  });

  it('暂停之后按钮换成「继续」', () => {
    const html = view({ aiIndex: idx({ state: 'building', progress: running({ status: 'paused' }) }) });
    expect(html).toContain('data-act="ptresume"');
  });

  it('有失败块时给「只重试失败块」', () => {
    const html = view({ aiIndex: idx({ state: 'building', progress: running({ failed: 3 }) }) });
    expect(html).toContain('data-act="ptretry"');
  });

  it('建到一半时也不出现输入框', () => {
    const html = view({ aiIndex: idx({ state: 'building', progress: running() }) });
    expect(html).not.toContain('data-role="aiask"');
  });
});

describe('AI 页签 · 没配好服务', () => {
  it('没配 AI 时只说去哪儿配，不给「建立索引」', () => {
    const html = view({ aiReady: false, aiIndex: idx() });
    expect(html).toContain('设置');
    expect(html).not.toContain('data-act="aiidx"');
    expect(html).not.toContain('data-role="aiask"');
  });

  /* 没装 bz / 没配 AI 的人，正是最需要先看一遍教程的人：
     教程按钮不该跟着「能不能提问」一起消失。 */
  it('没配 AI 也留着「观看视频教程」', () => {
    expect(view({ aiReady: false, aiIndex: idx() })).toContain('data-act="aitutorial"');
  });
});

/* 向量归第二大脑（2026-11-07 决策回摆）：卡上要说的不再是「没配嵌入模型」，
   而是 bz 那边缺什么；压缩方案不碰向量库，bz 不在照样可选。 */
describe('AI 页签 · bz 不提供向量时', () => {
  it('向量卡说明缺的是第二大脑，不是本地某个设置项', () => {
    const html = view({ aiIndex: idx({ choosing: true, plan: 'vector', embedReady: false }) });
    expect(html).toContain('第二大脑');
    expect(html).not.toContain('嵌入模型填');
  });

  it('只影响向量卡：选着压缩方案时不显示这条缺什么', () => {
    const html = view({ aiIndex: idx({ choosing: true, plan: 'compress', embedReady: false }) });
    expect(html).not.toContain('第二大脑');
  });
});
