import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { AI_LOG_MARK, aiConversationMarkdown } from '../src/data/ai-save';
import { aiSessionById, aiSessions, seedAiSessions } from '../src/data/ai-session';
import { setDataDir } from '../src/core/plugin-path';
import {
  AI_LOG_LIMIT,
  aiLogPath,
  archiveAiSessionAndSave,
  dropLastAiTurnAndSave,
  loadAiLog,
  recordAiTurn,
  removeAiSessionAndSave,
  resetAiTurnGroups,
} from '../src/data/ai-log';
import { FakeAdapter } from './helpers/fake-adapter';

/**
 * 对话存档（2026-11-11）。
 *
 * 侧栏「问这本书」的多轮问答一直只活在内存（RT.aiLog），关掉插件就没了。
 * 这一层把它整理成一篇能存进库的 Markdown：谁问的、谁答的、依据是什么。
 *
 * 三条：
 *   1. 有标记（AI_LOG_MARK）：之后重新存档时认得出这是插件写的段落；
 *   2. 来源跟着答案走：脱离侧栏之后仍然知道「这一段出自哪一章」；
 *   3. 空对话返回空串：调用方据此不写盘、也不弹「已存档」。
 */

describe('aiConversationMarkdown', () => {
  const base = {
    bookTitle: '一本书',
    day: '2026-11-11',
    turns: [
      { me: true, text: '这本书讲了什么？' },
      { me: false, text: '讲了一个人在乱世里做选择。', sources: [{ title: '第一章', note: '第 1 块' }] },
    ],
  };

  it('标题带书名与日期，问与答按顺序写出', () => {
    const md = aiConversationMarkdown(base);
    expect(md).toContain('AI 对话 · 一本书 · 2026-11-11');
    expect(md).toContain('这本书讲了什么？');
    expect(md).toContain('讲了一个人在乱世里做选择。');
    expect(md.indexOf('这本书讲了什么')).toBeLessThan(md.indexOf('讲了一个人'));
  });

  it('答案的来源写在答案下面', () => {
    const md = aiConversationMarkdown(base);
    expect(md).toContain('来源');
    expect(md).toContain('第一章');
    expect(md).toContain('第 1 块');
  });

  it('末尾带标记', () => {
    const md = aiConversationMarkdown(base);
    expect(md.trimEnd().endsWith(AI_LOG_MARK)).toBe(true);
  });

  it('没有来源时不写来源行', () => {
    const md = aiConversationMarkdown({
      bookTitle: '一本书',
      day: '2026-11-11',
      turns: [{ me: false, text: '没有依据的回答' }],
    });
    expect(md).not.toContain('来源');
  });

  it('空对话 / 空白轮次返回空串', () => {
    expect(aiConversationMarkdown({ day: '2026-11-11', turns: [] })).toBe('');
    expect(aiConversationMarkdown({ day: '2026-11-11', turns: [{ me: true, text: '  ' }] })).toBe('');
  });

  it('没有书名时标题不出现空的书名段', () => {
    const md = aiConversationMarkdown({ day: '2026-11-11', turns: [{ me: true, text: '问' }] });
    expect(md).toContain('AI 对话 · 2026-11-11');
    expect(md).not.toContain('·  ·');
  });

  it('多轮问答全部保留', () => {
    const md = aiConversationMarkdown({
      day: '2026-11-11',
      turns: [
        { me: true, text: '第一问' },
        { me: false, text: '第一答' },
        { me: true, text: '第二问' },
        { me: false, text: '第二答' },
      ],
    });
    for (const s of ['第一问', '第一答', '第二问', '第二答']) expect(md).toContain(s);
  });
});

/* ============================================================
 * 对话记录落盘（2026-11-16）
 *
 * 书架「对话」页先前只读内存里的种子列表，关掉插件就没了。这一组锁住
 * `data/ai-log.ts` 的读写契约：坏文件不拖垮书架、200 条上限、归档 / 删除
 * 真的写回磁盘、同一轮追问合并成一条会话。
 *
 * 用 FakeAdapter + 每次一个临时数据目录，不碰真实磁盘。
 * ============================================================ */

describe('ai-sessions.json · 落盘与读回', () => {
  let adapter: FakeAdapter;
  let app: App;
  const base = {
    bookId: 'b1',
    bookTitle: '围城',
    author: '钱钟书',
    kind: 'explain' as const,
    ask: '这句什么意思？',
    answer: '城外的人想进去，城里的人想出来。',
    when: 1_700_000_000_000,
  };

  function disk(): { version: number; sessions: Array<Record<string, unknown>> } {
    const text = adapter.files.get(aiLogPath(app));
    expect(text, '文件应该已经写出来了').toBeTruthy();
    return JSON.parse(text!) as { version: number; sessions: Array<Record<string, unknown>> };
  }

  beforeEach(() => {
    seedAiSessions([]);
    /* 每次换一个临时数据目录：路径只是 FakeAdapter 里的键，不落真实磁盘 */
    setDataDir(`tmp/ai-log-test-${Math.random().toString(36).slice(2, 8)}`);
    adapter = new FakeAdapter();
    app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  });

  afterEach(() => {
    seedAiSessions([]);
    vi.restoreAllMocks();
  });

  it('空文件：读出空列表，不抛', async () => {
    await expect(loadAiLog(app)).resolves.toEqual([]);
    expect(aiSessions()).toEqual([]);
  });

  it('坏 JSON / 字段缺失：降级成空列表，不抛', async () => {
    adapter.files.set(aiLogPath(app), '{ 半截');
    await expect(loadAiLog(app)).resolves.toEqual([]);

    /* 版本对、但会话缺字段：坏记录丢掉，别拿半条去画卡片 */
    adapter.files.set(
      aiLogPath(app),
      JSON.stringify({ version: 1, sessions: [{ id: 'x', when: 1 }, { id: 'y', kind: 'book' }] }),
    );
    await expect(loadAiLog(app)).resolves.toEqual([]);
  });

  it('追加一条：读回来 kind、turns、quote 都完整', async () => {
    const id = await recordAiTurn(app, {
      ...base,
      quote: '  婚姻是一座围城  ',
    });

    const file = disk();
    expect(file.version).toBe(1);
    expect(file.sessions).toHaveLength(1);
    const s = file.sessions[0] as {
      id: string;
      kind: string;
      quote?: string;
      turns: Array<{ me: boolean; text: string }>;
      bookId: string;
      bookTitle: string;
      author?: string;
      when: number;
    };
    expect(id).toBeTruthy();
    expect(s.id).toBe(id);
    expect(s.id).toMatch(/^id-\d+-[a-z0-9]{4}$/);
    expect(s.bookId).toBe('b1');
    expect(s.bookTitle).toBe('围城');
    expect(s.author).toBe('钱钟书');
    expect(s.kind).toBe('explain');
    expect(s.quote).toBe('婚姻是一座围城');
    expect(s.when).toBe(base.when);
    expect(s.turns).toEqual([
      { me: true, text: base.ask },
      { me: false, text: base.answer },
    ]);

    /* 重启：清空内存再读，字段还在 */
    seedAiSessions([]);
    await loadAiLog(app);
    expect(aiSessionById(id!)?.kind).toBe('explain');
    expect(aiSessionById(id!)?.turns).toHaveLength(2);
  });

  it('全书问答不写引文（kind=book 时 quote 为空）', async () => {
    await recordAiTurn(app, { ...base, kind: 'book', quote: '不该出现的引文' });
    const s = disk().sessions[0] as { kind: string; quote?: string };
    expect(s.kind).toBe('book');
    expect(s.quote).toBeUndefined();
  });

  it('来源与半截标记落盘，重启读回来还在（2026-11-17）', async () => {
    const sources = [
      { title: '第一章 归国', bookId: 'b1', text: '红海早过了', note: '出处' },
      { title: '第二章', path: 'books/围城.md' },
      { title: '' }, // 没标题的坏数据，应该被丢掉
    ];
    await recordAiTurn(app, { ...base, kind: 'book', sources, truncated: true });

    const s = disk().sessions[0] as {
      turns: Array<{ me: boolean; text: string; sources?: unknown[]; truncated?: boolean }>;
    };
    const answer = s.turns[1];
    expect(answer.sources).toHaveLength(2);
    expect(answer.sources![0]).toMatchObject({ title: '第一章 归国', bookId: 'b1' });
    expect(answer.truncated).toBe(true);
    /* 用户那一轮不该带这些 */
    expect(s.turns[0].sources).toBeUndefined();

    seedAiSessions([]);
    await loadAiLog(app);
    const back = aiSessionById('') ?? aiSessions()[0];
    expect(back?.turns[1].sources?.[0].title).toBe('第一章 归国');
    expect(back?.turns[1].truncated).toBe(true);
  });

  it('重答：删掉最后一轮再落盘，下次读回不剩旧答案', async () => {
    const id = await recordAiTurn(app, { ...base, kind: 'book' });
    await dropLastAiTurnAndSave(app, id);

    await expect(loadAiLog(app)).resolves.toEqual([]);
    expect(aiSessions()).toEqual([]);
  });

  it('第 201 条：最旧的被丢掉，只剩最近 200 条', async () => {
    expect(AI_LOG_LIMIT).toBe(200);
    let firstId = '';
    for (let i = 0; i < AI_LOG_LIMIT + 1; i += 1) {
      const id = await recordAiTurn(app, {
        ...base,
        kind: 'book',
        ask: `问 ${i}`,
        answer: `答 ${i}`,
        when: base.when + i,
      });
      if (i === 0) firstId = id!;
    }

    const file = disk();
    expect(file.sessions).toHaveLength(200);
    const ids = file.sessions.map((s) => (s as { id: string }).id);
    expect(ids).not.toContain(firstId);
    expect((file.sessions[0] as { when: number }).when).toBe(base.when + 200);
    expect((file.sessions.at(-1) as { when: number }).when).toBe(base.when + 1);
    expect(aiSessions()).toHaveLength(200);
  });

  it('归档一条：重新读文件，archivedAt 还在', async () => {
    const id = (await recordAiTurn(app, base))!;
    const at = 1_700_000_999_000;
    await expect(archiveAiSessionAndSave(app, id, at)).resolves.toBe(true);
    expect((disk().sessions[0] as { archivedAt?: number }).archivedAt).toBe(at);

    seedAiSessions([]);
    await loadAiLog(app);
    expect(aiSessionById(id)?.archivedAt).toBe(at);
  });

  it('删除一条：重新读文件，记录没了', async () => {
    const id = (await recordAiTurn(app, base))!;
    await expect(removeAiSessionAndSave(app, id)).resolves.toBe(true);
    expect(disk().sessions).toEqual([]);

    seedAiSessions([]);
    await loadAiLog(app);
    expect(aiSessionById(id)).toBeUndefined();
  });

  it('同一轮追问：追加到同一条 turns，不新建会话', async () => {
    const group = 'ai|explain|婚姻是一座围城';
    const first = (await recordAiTurn(app, { ...base, group, ask: '解释一下', answer: '首答' }))!;
    const again = (await recordAiTurn(app, {
      ...base,
      group,
      when: base.when + 60_000,
      ask: '那笼子呢？',
      answer: '再答',
    }))!;

    expect(again).toBe(first);
    const file = disk();
    expect(file.sessions).toHaveLength(1);
    expect((file.sessions[0] as { turns: unknown[] }).turns).toHaveLength(4);
    expect((file.sessions[0] as { when: number }).when).toBe(base.when);

    /* 换一轮（没有 group）就是另一条会话 */
    await recordAiTurn(app, { ...base, ask: '换个问题', answer: '另起一条' });
    expect(disk().sessions).toHaveLength(2);
  });

  it('引文截到 120 字，超长补省略号', async () => {
    await recordAiTurn(app, { ...base, quote: '字'.repeat(300) });
    const quote = (disk().sessions[0] as { quote: string }).quote;
    expect(Array.from(quote)).toHaveLength(120);
    expect(quote.endsWith('…')).toBe(true);
  });

  it('写盘失败只 warn 一条，问答照常返回', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    adapter.write = async () => {
      throw new Error('disk full');
    };
    await expect(recordAiTurn(app, base)).resolves.toBeTruthy();
    expect(aiSessions()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
 * 对话绑到划线上（2026-11-16）
 *
 * 点「解释 / 总结 / 翻译 / 追问」时先给这段字落一条划线，对话记在这条
 * 线上。再点回那条线就能把整段问答捞回来——所以「重启后还认得」这件事
 * 靠的是 markId，不是进程里的分组映射。
 * ============================================================ */
describe('对话绑到划线上', () => {
  let adapter: FakeAdapter;
  let app: App;
  const base = {
    bookId: 'b1',
    bookTitle: '围城',
    kind: 'explain' as const,
    ask: '这句话什么意思？',
    answer: '意思是这样。',
    when: 1_700_000_000_000,
  };

  beforeEach(() => {
    seedAiSessions([]);
    setDataDir(`tmp/ai-mark-test-${Math.random().toString(36).slice(2, 8)}`);
    adapter = new FakeAdapter();
    app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  });

  afterEach(() => {
    seedAiSessions([]);
    vi.restoreAllMocks();
  });

  it('markId 与 cfi 写进文件，重启读回来还在', async () => {
    await recordAiTurn(app, { ...base, markId: 'm1', cfi: 'epubcfi(/6/4!/4)' });
    const saved = JSON.parse(adapter.files.get(aiLogPath(app))!).sessions[0] as {
      markId?: string;
      cfi?: string;
    };
    expect(saved.markId).toBe('m1');
    expect(saved.cfi).toBe('epubcfi(/6/4!/4)');

    seedAiSessions([]);
    await loadAiLog(app);
    expect(aiSessions()[0].markId).toBe('m1');
    expect(aiSessions()[0].cfi).toBe('epubcfi(/6/4!/4)');
  });

  it('重启后分组映射没了，仍按 markId 追加进同一条', async () => {
    const group = 'ai|explain|m1|原文';
    const first = (await recordAiTurn(app, {
      ...base,
      group,
      markId: 'm1',
      ask: '解释一下',
      answer: '首答',
    }))!;

    /* 模拟重启：进程内的 group → id 映射被清掉 */
    resetAiTurnGroups();

    const again = (await recordAiTurn(app, {
      ...base,
      group,
      markId: 'm1',
      when: base.when + 60_000,
      ask: '那笼子呢',
      answer: '追问的答案',
    }))!;

    expect(again).toBe(first);
    expect(aiSessions()).toHaveLength(1);
    expect(aiSessions()[0].turns).toHaveLength(4);
  });

  it('侧栏给了会话 id：落盘就用它，重启后仍追加进同一条', async () => {
    const group = 'id-1700000000000-aaaa';
    const id = (await recordAiTurn(app, {
      ...base,
      kind: 'book',
      group,
      sessionId: group,
      ask: '第一问',
      answer: '第一答',
    }))!;
    expect(id).toBe(group);

    resetAiTurnGroups();
    const again = (await recordAiTurn(app, {
      ...base,
      kind: 'book',
      group,
      sessionId: group,
      when: base.when + 60_000,
      ask: '第二问',
      answer: '第二答',
    }))!;

    expect(again).toBe(group);
    expect(aiSessions()).toHaveLength(1);
    expect(aiSessions()[0].turns).toHaveLength(4);
  });

  it('两条不同的划线各记各的', async () => {
    await recordAiTurn(app, { ...base, markId: 'm1' });
    await recordAiTurn(app, {
      ...base,
      markId: 'm2',
      when: base.when + 1000,
      ask: '另一条线',
      answer: '另一份答案',
    });
    expect(aiSessions()).toHaveLength(2);
  });
});
