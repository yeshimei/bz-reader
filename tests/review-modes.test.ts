import { describe, expect, it } from 'vitest';
import {
  estimateSendChars,
  makeDraft,
  markCardStates,
  mergeDraftQuestions,
  modeOptionParts,
  confirmCardView,
  dropPlanned,
  summaryParts,
  toCardPayload,
  type CardState,
  type CardSource,
  type DraftCard,
  type ReviewMode,
} from '../src/data/review-modes';
import {
  parseFlashcard,
  parseQuizQuestions,
  parseQuizTitle,
  buildFlashcardPrompt,
  buildQuizPrompt,
  generateDrafts,
} from '../src/data/review-cards-ai';

const SRC = { bookTitle: '围城', chapterTitle: '第一章', text: '婚姻像一座城。', comment: '很妙' };

describe('makeDraft：三种方式各造一张待确认的卡', () => {
  it('全文回忆：不调 AI，题面就是原文', () => {
    const d = makeDraft('plain', { ...SRC, key: 'k1' });
    expect(d.mode).toBe('plain');
    expect(d.front).toBe('婚姻像一座城。');
    expect(d.back).toBe('');
    expect(d.questions).toEqual([]);
  });

  it('抽认卡：题面是 AI 给的正面提醒，背面是完整原文', () => {
    const d = makeDraft('flashcard', { ...SRC, key: 'k2', front: '婚姻被比作什么？' });
    expect(d.mode).toBe('flashcard');
    expect(d.front).toBe('婚姻被比作什么？');
    expect(d.back).toBe('婚姻像一座城。');
  });

  it('做题：带上 AI 出的题', () => {
    const qs = [{ q: '婚姻像什么？', options: ['城', '船'], correct: [0], explain: '原文' }];
    const d = makeDraft('quiz', { ...SRC, key: 'k3', questions: qs });
    expect(d.mode).toBe('quiz');
    expect(d.questions).toHaveLength(1);
  });

  it('空原文不造卡', () => {
    expect(makeDraft('plain', { ...SRC, key: 'k4', text: '   ' })).toBeNull();
  });
});

describe('estimateSendChars：增强1，三选一每项标预计字数', () => {
  it('全文回忆不用 AI，估算是 0', () => {
    expect(estimateSendChars('plain', [SRC])).toBe(0);
  });

  it('抽认卡/做题按原文+想法计字', () => {
    // '婚姻像一座城。'=7 + '很妙'=2
    expect(estimateSendChars('flashcard', [SRC])).toBe(9);
    expect(estimateSendChars('quiz', [SRC])).toBe(9);
  });

  it('多条累加，空列表为 0', () => {
    expect(estimateSendChars('quiz', [SRC, SRC])).toBe(18);
    expect(estimateSendChars('quiz', [])).toBe(0);
  });
});

describe('mergeDraftQuestions：做题的删题/补题/重新生成', () => {
  const q1 = { q: '题一', options: ['A', 'B'], correct: [0] };
  const q2 = { q: '题二', options: ['A', 'B'], correct: [1] };
  const q3 = { q: '题三', options: ['A', 'B'], correct: [0] };

  it('按题面去重追加（补齐时 AI 补的题不会和已有的重复）', () => {
    expect(mergeDraftQuestions([q1], [q1, q2])).toHaveLength(2);
  });

  it('重新生成：传空基数 + 新题，换掉旧的', () => {
    expect(mergeDraftQuestions([], [q2, q3])).toEqual([q2, q3]);
  });

  it('删题：过滤后保留剩下的', () => {
    expect(mergeDraftQuestions([q1, q2, q3].filter((_, i) => i !== 1), [])).toHaveLength(2);
  });
});

describe('summaryParts：增强6，批量结果一句话收口', () => {
  it('全成功只有一段', () => {
    expect(summaryParts({ added: 12, exists: 0, rejected: 0, failed: 0 })).toEqual([
      { key: 'review.done', params: { n: '12' } },
    ]);
  });
  it('带已在计划/超额/失败时，一段都不漏', () => {
    expect(summaryParts({ added: 8, exists: 2, rejected: 3, failed: 1 })).toEqual([
      { key: 'review.done', params: { n: '8' } },
      { key: 'review.doneExists2', params: { exists: '2' } },
      { key: 'review.doneRejected', params: { n: '3' } },
      { key: 'review.doneFailed', params: { n: '1' } },
    ]);
  });
  it('一条没加时直说', () => {
    expect(summaryParts({ added: 0, exists: 5, rejected: 0, failed: 0 })).toEqual([
      { key: 'review.doneAllExists', params: { exists: '5' } },
    ]);
    expect(summaryParts({ added: 0, exists: 0, rejected: 0, failed: 0 })).toEqual([
      { key: 'review.doneEmpty', params: {} },
    ]);
  });
});

describe('AI prompt 与解析（题面要在确认前生成）', () => {
  it('抽认卡 prompt 要 AI 只给一句正面提醒', () => {
    const p = buildFlashcardPrompt(SRC.bookTitle, SRC.chapterTitle, SRC.text);
    expect(p).toContain(SRC.text);
    expect(p).toContain('正面');
  });
  it('做题 prompt 要求不少于三道', () => {
    const p = buildQuizPrompt(SRC.bookTitle, SRC.chapterTitle, SRC.text);
    expect(p).toContain('至少');
    expect(p).toContain('3');
  });
  it('做题 prompt 让 AI 顺带给一句标题', () => {
    const p = buildQuizPrompt(SRC.bookTitle, SRC.chapterTitle, SRC.text);
    expect(p).toContain('title');
    expect(p).toContain('标题');
  });
  it('解析做题标题：宽容代码块，取不到返回 null', () => {
    expect(parseQuizTitle('```json\n{"title":"婚姻的隐喻","questions":[]}\n```')).toBe('婚姻的隐喻');
    expect(parseQuizTitle('乱七八糟')).toBeNull();
  });
  it('做题 prompt 可指定只出一道（补一道题就是一道）', () => {
    const p = buildQuizPrompt(SRC.bookTitle, SRC.chapterTitle, SRC.text, 1);
    expect(p).toContain('出1道');
    expect(p).toContain('至少 1 道');
    expect(p).not.toContain('出3道');
  });
  it('解析抽认卡：宽容代码块，取 front', () => {
    expect(parseFlashcard('```json\n{"front":"婚姻像什么？"}\n```')).toBe('婚姻像什么？');
    expect(parseFlashcard('乱七八糟')).toBeNull();
  });
  it('解析做题：过滤缺字段的题', () => {
    const reply = JSON.stringify({
      questions: [
        { q: '题一', options: ['A', 'B'], correct: [0] },
        { q: '缺选项', options: [] },
      ],
    });
    const out = parseQuizQuestions(reply);
    expect(out).toHaveLength(1);
    expect(out[0]!.q).toBe('题一');
  });
  it('correct 下标越界的题丢掉', () => {
    const reply = JSON.stringify({ questions: [{ q: '题', options: ['A'], correct: [3] }] });
    expect(parseQuizQuestions(reply)).toHaveLength(0);
  });
});

describe('markCardStates：增强2，列表里每张卡标新增/已在计划/超额', () => {
  it('已在计划的标 exists，不占额度', () => {
    const states = markCardStates(['a', 'b'], new Set(['a']), 10);
    expect(states).toEqual(['exists', 'new']);
  });
  it('基础版剩 2 个名额：前两张新卡 new，第三张起 over', () => {
    const states = markCardStates(['a', 'b', 'c', 'd'], new Set(), 2);
    expect(states).toEqual(['new', 'new', 'over', 'over']);
  });
  it('已在计划的不算进剩余名额', () => {
    const states = markCardStates(['old', 'a', 'b'], new Set(['old']), 1);
    expect(states).toEqual(['exists', 'new', 'over']);
  });
  it('不限额度（Infinity）时新卡都是 new', () => {
    const states = markCardStates(['a', 'b', 'c'], new Set(), Infinity);
    expect(states.every((s: CardState) => s === 'new')).toBe(true);
  });
});

describe('generateDrafts：把一组内容按方式变成待确认卡片', () => {
  const sources: CardSource[] = [
    { key: 'k1', bookTitle: '围城', chapterTitle: '第一章', text: '婚姻像一座城。' },
    { key: 'k2', bookTitle: '围城', chapterTitle: '第一章', text: '城外的人想进去。' },
  ];

  it('全文回忆不调 AI，每张卡题面就是原文', async () => {
    let calls = 0;
    const ask = async () => { calls += 1; return ''; };
    const drafts = await generateDrafts('plain', sources, ask);
    expect(calls).toBe(0);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.front).toBe('婚姻像一座城。');
  });

  it('抽认卡逐条调 AI，取正面提醒', async () => {
    const ask = async (p: string) => JSON.stringify({ front: p.includes('婚姻') ? '婚姻像什么？' : '城外的人想做什么？' });
    const drafts = await generateDrafts('flashcard', sources, ask);
    expect(drafts[0]!.front).toBe('婚姻像什么？');
    expect(drafts[0]!.back).toBe('婚姻像一座城。');
  });

  it('抽认卡某条解析失败：保底用原文当正面，不留空白卡', async () => {
    const ask = async (p: string) => (p.includes('婚姻') ? '乱码' : JSON.stringify({ front: '城外的人想做什么？' }));
    const drafts = await generateDrafts('flashcard', sources, ask);
    expect(drafts[0]!.front).toBe('婚姻像一座城。');
    expect(drafts[1]!.front).toBe('城外的人想做什么？');
  });

  it('做题逐条出题', async () => {
    const ask = async () => JSON.stringify({ questions: [{ q: '题', options: ['A', 'B'], correct: [0] }] });
    const drafts = await generateDrafts('quiz', sources, ask);
    expect(drafts[0]!.questions).toHaveLength(1);
  });

  it('做题：AI 给的标题落到待确认卡上', async () => {
    const ask = async () => JSON.stringify({
      title: '婚姻的隐喻',
      questions: [{ q: '题', options: ['A', 'B'], correct: [0] }],
    });
    const drafts = await generateDrafts('quiz', sources, ask);
    expect(drafts[0]!.title).toBe('婚姻的隐喻');
  });

  it('做题：AI 没给标题时回退第一题题干，绝不空着', async () => {
    const ask = async () => JSON.stringify({ questions: [{ q: '第一题题干', options: ['A', 'B'], correct: [0] }] });
    const drafts = await generateDrafts('quiz', sources, ask);
    expect(drafts[0]!.title).toBe('第一题题干');
  });

  it('补一道题时传 min=1，prompt 只要求一道（不会一次补三道）', async () => {
    const prompts: string[] = [];
    const ask = async (p: string) => {
      prompts.push(p);
      return JSON.stringify({ questions: [{ q: '题', options: ['A', 'B'], correct: [0] }] });
    };
    await generateDrafts('quiz', [sources[0]!], ask, 1);
    expect(prompts[0]).toContain('出1道');
    expect(prompts[0]).not.toContain('出3道');
  });

  it('一条失败不影响其他（catch 后保底）', async () => {
    let n = 0;
    const ask = async () => {
      n += 1;
      if (n === 1) throw new Error('timeout');
      return JSON.stringify({ front: '第二条的提醒' });
    };
    const drafts = await generateDrafts('flashcard', sources, ask);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.front).toBe('婚姻像一座城。');
    expect(drafts[1]!.front).toBe('第二条的提醒');
  });
});

describe('toCardPayload：确认后转成 Review 入库格式', () => {
  it('全文回忆传 mode=plain，背面空、无题', () => {
    const d = makeDraft('plain', { ...SRC, key: 'k' })!;
    expect(toCardPayload(d)).toEqual({
      key: 'k', bookTitle: '围城', chapterTitle: '第一章', text: '婚姻像一座城。', mode: 'plain',
    });
  });
  it('抽认卡把正面提醒放进 qa', () => {
    const d = makeDraft('flashcard', { ...SRC, key: 'k', front: '提醒' })!;
    const p = toCardPayload(d);
    expect(p.mode).toBe('flashcard');
    expect(p.qa).toEqual({ q: '提醒', a: '婚姻像一座城。' });
  });
  it('做题把题带过去，key 稳定', () => {
    const q = { q: '题', options: ['A', 'B'], correct: [0] };
    const d = makeDraft('quiz', { ...SRC, key: 'k', questions: [q] })!;
    const p = toCardPayload(d);
    expect(p.mode).toBe('quiz');
    expect(p.questions).toHaveLength(1);
    expect(p.key).toBe('k');
  });
  it('做题把用户改过的标题带过去，复习列表就显示它', () => {
    const q = { q: '第一题题干', options: ['A', 'B'], correct: [0] };
    const d = makeDraft('quiz', { ...SRC, key: 'k', questions: [q], title: '用户改过的标题' })!;
    const p = toCardPayload(d);
    expect((p as { displayTitle?: string }).displayTitle).toBe('用户改过的标题');
  });
});

describe('ReviewMode 子集', () => {
  it('三选一只有 plain/flashcard/quiz，不含 fill-in / context', () => {
    const modes: ReviewMode[] = ['plain', 'flashcard', 'quiz'];
    expect(modes).toEqual(['plain', 'flashcard', 'quiz']);
  });
});

describe('modeOptionParts：三选一只留标题与发送字数', () => {
  it('全文回忆没有第二行，也不显示「不用 AI」', () => {
    expect(modeOptionParts('plain', 0)).toEqual({ titleKey: 'review.mode.plain' });
  });

  it('抽认卡/做题标题在上、字数在下，不带描述 key', () => {
    expect(modeOptionParts('flashcard', 99)).toEqual({
      titleKey: 'review.mode.flashcard',
      hintKey: 'review.mode.estChars',
      hintParams: { chars: '99' },
    });
    expect(modeOptionParts('quiz', 1200)).toEqual({
      titleKey: 'review.mode.quiz',
      hintKey: 'review.mode.estChars',
      hintParams: { chars: '1,200' },
    });
  });
});

describe('confirmCardView：确认页不重复显示原文', () => {
  it('抽认卡只在背面显示一次原文', () => {
    const d = makeDraft('flashcard', { ...SRC, key: 'k', front: '提醒' })!;
    expect(confirmCardView(d)).toEqual({ showSource: false, showBack: true });
  });

  it('全文回忆的题面就是原文，仍要显示', () => {
    const d = makeDraft('plain', { ...SRC, key: 'k' })!;
    expect(confirmCardView(d)).toEqual({ showSource: true, showBack: false });
  });

  it('做题只列题目，不显示背面原文', () => {
    const d = makeDraft('quiz', { ...SRC, key: 'k', questions: [{ q: '题', options: ['A', 'B'], correct: [0] }] })!;
    expect(confirmCardView(d)).toEqual({ showSource: false, showBack: false });
  });
});

describe('dropPlanned：已在计划里的不再打一次', () => {
  const A: CardSource = { key: 'k-a', bookTitle: '围城', text: '甲' };
  const B: CardSource = { key: 'k-b', bookTitle: '围城', text: '乙' };
  const C: CardSource = { key: 'k-c', bookTitle: '围城', text: '丙' };

  it('剔掉已存在的，其余保持原顺序', () => {
    const r = dropPlanned([A, B, C], new Set(['k-b']));
    expect(r.kept.map((x) => x.key)).toEqual(['k-a', 'k-c']);
    expect(r.skipped).toBe(1);
  });

  it('全都在计划里：一条不剩，skipped 照实计数', () => {
    const r = dropPlanned([A, B], new Set(['k-a', 'k-b']));
    expect(r.kept).toHaveLength(0);
    expect(r.skipped).toBe(2);
  });

  it('空输入不炸', () => {
    expect(dropPlanned([], new Set(['x']))).toEqual({ kept: [], skipped: 0 });
  });
});

// 让 DraftCard 类型被实际引用，避免 noUnusedLocals
const _t: DraftCard | null = null;
void _t;
