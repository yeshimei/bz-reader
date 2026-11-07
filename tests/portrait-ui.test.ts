/**
 * 全书画像的界面口径（shell/render/portrait.ts）。
 *
 * 这里错一步用户就要白花钱：准备页说「约 3 次请求」、实际发了 130 次，
 * 或者「暂停」按钮在跑完之后还留着。所以断言的是**同一时刻出哪些按钮**，
 * 而不是某个 class 长什么样。
 */
import { describe, expect, it } from 'vitest';
import {
  portraitBody,
  portraitFoot,
  portraitStage,
  portraitStatusLine,
  type PortraitView,
} from '../src/shell/render/portrait';
import { firstSentence, type PortraitFile } from '../src/data/portrait';
import type { BuildProgress } from '../src/data/portrait-build';
import { portraitNoteMarkdown } from '../src/shell/render/portrait';

function progress(patch: Partial<BuildProgress> = {}): BuildProgress {
  return {
    status: 'idle',
    plan: 'vector',
    bookId: 'b1',
    bookTitle: '心流',
    total: 0,
    done: 0,
    failed: 0,
    phase: '',
    extractDone: 0,
    extractTotal: 0,
    startedAt: 0,
    elapsedMs: 0,
    ...patch,
  };
}

function view(patch: Partial<PortraitView> = {}): PortraitView {
  return {
    mobile: false,
    chosen: 'vector',
    chars: 25000,
    bookTitle: '心流',
    progress: progress(),
    portrait: null,
    model: 'bge-m3',
    ...patch,
  };
}

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '心流',
    plan: 'compress',
    model: 'chat',
    chunkChars: 8000,
    total: 2,
    blocks: [
      { chapter: '第一章', chars: 100, digest: '讲注意力的有限', summary: '要点一' },
      { chapter: '第二章', chars: 100, digest: '讲心流的条件', summary: '要点二' },
    ],
    overview: '整本书讲的是如何进入心流',
    createdAt: 0,
    updatedAt: 0,
    done: true,
    ...patch,
  };
}

describe('阶段判定', () => {
  it('没跑过 → 准备页', () => {
    expect(portraitStage(view())).toBe('prepare');
  });

  it('手机端不建：除了已完成，一律只提示', () => {
    expect(portraitStage(view({ mobile: true }))).toBe('mobile');
    expect(portraitStage(view({ mobile: true, progress: progress({ status: 'running', total: 9, done: 1 }) }))).toBe(
      'mobile',
    );
    expect(portraitStage(view({ mobile: true, progress: progress({ status: 'done', total: 9, done: 9 }) }))).toBe('done');
  });

  it('在跑 / 暂停 → 进度页；暂停不是另一个页面', () => {
    expect(portraitStage(view({ progress: progress({ status: 'running', total: 9 }) }))).toBe('run');
    expect(portraitStage(view({ progress: progress({ status: 'paused', total: 9, done: 4 }) }))).toBe('run');
  });

  it('失败：一块都没切出来就退回准备页，有块就停在进度页（能重试）', () => {
    expect(portraitStage(view({ progress: progress({ status: 'error', message: 'x' }) }))).toBe('prepare');
    expect(portraitStage(view({ progress: progress({ status: 'error', total: 9, done: 3 }) }))).toBe('run');
  });
});

describe('底部按钮：同一时刻只有一条主路径', () => {
  it('准备页：关闭 + 开始', () => {
    const foot = portraitFoot(view());
    expect(foot).toContain('data-act="ptstart"');
    expect(foot).toContain('data-act="ptclose"');
    expect(foot).not.toContain('ptpause');
  });

  it('运行中只有「暂停」，暂停之后只有「继续」——互斥的两颗不并列', () => {
    const running = portraitFoot(view({ progress: progress({ status: 'running', total: 9, done: 2 }) }));
    expect(running).toContain('data-act="ptpause"');
    expect(running).not.toContain('data-act="ptresume"');
    const paused = portraitFoot(view({ progress: progress({ status: 'paused', total: 9, done: 2 }) }));
    expect(paused).toContain('data-act="ptresume"');
    expect(paused).not.toContain('data-act="ptpause"');
  });

  it('跑的时候取消和暂停都能点，取消排在前面（破坏性动作不贴身）', () => {
    const foot = portraitFoot(view({ progress: progress({ status: 'running', total: 9 }) }));
    expect(foot.indexOf('ptstop')).toBeLessThan(foot.indexOf('ptpause'));
  });

  it('完成页：开始提问是唯一主按钮；有失败块才出现重试', () => {
    const done = portraitFoot(view({ progress: progress({ status: 'done', total: 9, done: 9 }) }));
    expect(done).toContain('data-act="ptask"');
    expect(done).toContain('data-act="ptnote"');
    expect(done).toContain('data-act="ptrebuild"');
    expect(done).not.toContain('data-act="ptretry"');
    const failed = portraitFoot(view({ progress: progress({ status: 'done', total: 9, done: 7, failed: 2 }) }));
    expect(failed).toContain('data-act="ptretry"');
  });
});

describe('准备页：代价写在按钮上面', () => {
  it('两种方案各有做法 / 好处 / 代价 / 适合，并给出预估块数与请求数', () => {
    const html = portraitBody(view({ chars: 30000 }));
    expect(html).toContain('向量化检索');
    expect(html).toContain('AI 信息压缩');
    expect(html).toContain('做法');
    expect(html).toContain('代价');
    /* 两张卡片各有一行预估：一张说嵌入请求，一张说 AI 请求 */
    expect(html).toContain('次嵌入请求');
    expect(html).toContain('次 AI 请求');
  });

  it('选了哪个方案，卡片就是哪张亮着', () => {
    const html = portraitBody(view({ chosen: 'compress' }));
    expect(html).toContain('data-act="ptplan" data-v="compress" aria-pressed="true"');
    expect(html).toContain('data-act="ptplan" data-v="vector" aria-pressed="false"');
  });
});

describe('完成页', () => {
  it('块数 / 耗时 / 失败 / 模型 四件事都说清楚', () => {
    /* 块数以画像文件为准：进度里的 total 是「切了多少」，文件里是「真有几个」 */
    const html = portraitBody(
      view({ progress: progress({ status: 'done', total: 3, done: 3, elapsedMs: 65_000 }), portrait: portrait() }),
    );
    expect(html).toContain('2 块');
    expect(html).toContain('1 分');
    expect(html).toContain('chat');
  });

  it('压缩方案顺手给三条章摘要（能立刻判断值不值）', () => {
    const html = portraitBody(view({ progress: progress({ status: 'done', total: 2, done: 2 }), portrait: portrait() }));
    expect(html).toContain('讲注意力的有限');
    expect(html).toContain('讲心流的条件');
  });
});

describe('一句话摘要', () => {
  it('取第一个句末标点', () => {
    expect(firstSentence('注意力是有限的。所以要做减法。')).toBe('注意力是有限的。');
  });

  it('没有标点就整句截断，并补省略号', () => {
    expect(firstSentence('字'.repeat(80))).toBe(`${'字'.repeat(60)}…`);
  });

  it('空输入给空串（不要一个孤零零的省略号）', () => {
    expect(firstSentence('   ')).toBe('');
  });
});

describe('状态行：详情页那一行', () => {
  it('没有 = 未建；没跑完 = 建到一半；模型换了 = 需要重建', () => {
    expect(portraitStatusLine(null, 'bge-m3')).toBe('未建');
    expect(portraitStatusLine(portrait({ plan: 'vector', done: false }), 'bge-m3')).toBe('建到一半');
    expect(portraitStatusLine(portrait({ plan: 'vector', model: 'old', done: true }), 'bge-m3')).toBe('需要重建');
    expect(portraitStatusLine(portrait({ plan: 'vector', model: 'bge-m3', done: true }), 'bge-m3')).toBe('已建');
  });

  it('压缩方案不受嵌入模型影响（摘要换个模型照样读得懂）', () => {
    expect(portraitStatusLine(portrait({ plan: 'compress', model: 'gpt-x' }), 'bge-m3')).toBe('已建');
  });

  it('正在建时优先说「建到一半」，不让人以为没开始', () => {
    expect(portraitStatusLine(null, 'bge-m3', true)).toBe('建到一半');
  });
});

describe('存为笔记', () => {
  it('带上书名、方案、模型、块数、总述与每章一句话', () => {
    const md = portraitNoteMarkdown(portrait());
    expect(md).toContain('# 心流');
    expect(md).toContain('AI 信息压缩');
    expect(md).toContain('2 块');
    expect(md).toContain('整本书讲的是如何进入心流');
    expect(md).toContain('### 第一章');
    expect(md).toContain('讲注意力的有限');
  });

  it('向量方案不写向量本身（那串 base64 对读者没有意义）', () => {
    const md = portraitNoteMarkdown(portrait({ plan: 'vector', overview: undefined }));
    expect(md).not.toContain('base64');
    expect(md).toContain('向量化检索');
  });
});

/**
 * 已经建过却还看到准备页，必须说清为什么（换了嵌入模型）。
 * 不说的话用户会以为「我明明建过」，然后不敢点开始。
 */
describe('准备页 · 换过模型', () => {
  const built = (model: string): PortraitFile => ({
    version: 1,
    bookId: 'b1',
    bookTitle: '心流',
    plan: 'vector',
    model,
    chunkChars: 1000,
    dim: 1024,
    total: 2,
    done: true,
    blocks: [
      { chapter: '第一章', chars: 10, vec: 'AA==', text: '正文' },
      { chapter: '第二章', chars: 10, vec: 'AA==', text: '正文' },
    ],
    createdAt: 1,
    updatedAt: 2,
  });

  it('模型对不上：准备页说明要重建', () => {
    const html = portraitBody(view({ portrait: built('旧模型'), model: '新模型' }));
    expect(html).toContain('另一个嵌入模型');
    expect(portraitStage(view({ portrait: built('旧模型'), model: '新模型' }))).toBe('prepare');
  });

  it('模型一致：只是没开始建，不吓人', () => {
    const html = portraitBody(view({ portrait: null, model: '新模型' }));
    expect(html).not.toContain('另一个嵌入模型');
  });
});
