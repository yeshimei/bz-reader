/* ============================================================
 * bz-reader · 离线听书包（tests/offline-pack.test.ts）
 *
 * 离线包 = 每章一个 mp3 + 一份 manifest.json。mp3 里没有句子边界，
 * 高亮全靠 manifest 里的时间轴，所以「包本身对不对」必须能在 node 里
 * 逐条断言：时间轴错位 = 满屏高亮乱跳，是用户一眼看得见的坏。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  OFFLINE_ROOT,
  OFFLINE_VERSION,
  alignMarks,
  buildMarks,
  estimateMs,
  markIndexAt,
  matchChapter,
  offlineTotals,
  packagePath,
  parseOfflineBook,
  safeName,
  serializeOfflineBook,
  type OfflineBook,
  type OfflineChapter,
} from '../src/core/offline-pack';

const chapter = (
  marks: Array<{ text: string; at: number; ms: number }>,
): {
  title: string;
  file: string;
  ms: number;
  bytes: number;
  marks: Array<{ text: string; at: number; ms: number }>;
} => ({ title: '第一章', file: '第一章.mp3', ms: 3000, bytes: 100, marks });

const book = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: OFFLINE_VERSION,
  title: '围城',
  bookId: 'b1',
  engine: 'local',
  voice: '中文女',
  format: 'mp3',
  madeAt: 1000,
  chapters: [chapter([{ text: '甲', at: 0, ms: 1000 }, { text: '乙', at: 1000, ms: 2000 }])],
  ...over,
});

describe('文件名', () => {
  it('去掉 Windows / URL 不认的字符，压缩空白', () => {
    expect(safeName('围城 / 上:下 *?')).toBe('围城 _ 上_下 __');
  });

  it('空串给默认名，不返回空', () => {
    expect(safeName('   ')).toBe('audio');
  });

  it('过长的名字截断到 80 字', () => {
    expect(safeName('一'.repeat(200)).length).toBe(80);
  });

  it('包路径是「根目录 / 书名」', () => {
    expect(packagePath('围城').startsWith(`${OFFLINE_ROOT}/围城-`)).toBe(true);
  });
});

describe('时间轴', () => {
  it('按每段时长累加出起点', () => {
    expect(buildMarks(['甲', '乙', '丙'], [1000, 2500, 500])).toEqual([
      { text: '甲', at: 0, ms: 1000 },
      { text: '乙', at: 1000, ms: 2500 },
      { text: '丙', at: 3500, ms: 500 },
    ]);
  });

  it('时长对不上文本时按较短的那一边截断，不抛', () => {
    expect(buildMarks(['甲', '乙'], [1000]).map((m) => m.text)).toEqual(['甲']);
    expect(buildMarks(['甲'], [1000, 2000]).map((m) => m.text)).toEqual(['甲']);
  });

  it('负时长 / 非数字按 0 处理', () => {
    expect(buildMarks(['甲', '乙'], [-5, Number.NaN])).toEqual([
      { text: '甲', at: 0, ms: 0 },
      { text: '乙', at: 0, ms: 0 },
    ]);
  });

  it('空输入给空数组', () => {
    expect(buildMarks([], [])).toEqual([]);
  });
});

describe('当前念到哪一句', () => {
  const marks = buildMarks(['甲', '乙', '丙'], [1000, 1000, 1000]);

  it('落在某句中间返回那一句', () => {
    expect(markIndexAt(marks, 0)).toBe(0);
    expect(markIndexAt(marks, 999)).toBe(0);
    expect(markIndexAt(marks, 1000)).toBe(1);
    expect(markIndexAt(marks, 2999)).toBe(2);
  });

  it('超出末尾返回最后一句，不返回 -1', () => {
    expect(markIndexAt(marks, 99_999)).toBe(2);
  });

  it('负时间返回第一句', () => {
    expect(markIndexAt(marks, -1)).toBe(0);
  });

  it('没有时间轴返回 -1', () => {
    expect(markIndexAt([], 0)).toBe(-1);
  });
});

describe('正文与时间轴重新对齐', () => {
  const marks = buildMarks(['甲', '乙', '丙'], [1000, 1000, 1000]);

  it('一字不差时一一对应', () => {
    expect(alignMarks(marks, ['甲', '乙', '丙'])).toEqual([0, 1, 2]);
  });

  it('正文中间插了一句：新句子不发音，后面的不错位', () => {
    expect(alignMarks(marks, ['甲', '新插的', '乙', '丙'])).toEqual([0, -1, 1, 2]);
  });

  it('正文删了一句：后面照样对上', () => {
    expect(alignMarks(marks, ['甲', '丙'])).toEqual([0, 2]);
  });

  it('一句话被改过：只有它掉，其余不受影响', () => {
    expect(alignMarks(marks, ['甲', '乙改', '丙'])).toEqual([0, -1, 2]);
  });

  it('整章对不上时全部 -1，而不是错位硬配', () => {
    expect(alignMarks(marks, ['完全', '不同的', '正文'])).toEqual([-1, -1, -1]);
  });

  it('没有时间轴时全部 -1', () => {
    expect(alignMarks([], ['甲'])).toEqual([-1]);
  });
});

describe('找出包里对应的那一章', () => {
  const ch = (title: string, texts: string[]): OfflineChapter => ({
    title,
    file: `${title}.mp3`,
    ms: texts.length * 1000,
    bytes: 100,
    marks: buildMarks(texts, texts.map(() => 1000)),
  });
  const pack: OfflineBook = {
    version: OFFLINE_VERSION,
    title: '围城',
    bookId: 'b1',
    engine: 'local',
    voice: '中文女',
    format: 'mp3',
    madeAt: 1,
    chapters: [ch('第一章', ['甲一', '甲二']), ch('第二章', ['乙一', '乙二']), ch('第三章', ['丙一', '丙二'])],
  };

  it('章名对上就用章名，不管包里的先后', () => {
    const got = matchChapter(pack, { title: '第三章', index: 0, texts: ['丙一', '丙二'] });
    expect(got?.chapter.title).toBe('第三章');
    expect(got?.matched).toBe(2);
  });

  it('章名对不上（TOC 与正文标题不同）时用章序兜底', () => {
    const got = matchChapter(pack, { title: '第三卷 第三章', index: 1, texts: ['乙一', '乙二'] });
    expect(got?.chapter.title).toBe('第二章');
    expect(got?.matched).toBe(2);
  });

  it('章名与章序都不对：按正文找最像的一章，而不是静默失败', () => {
    const got = matchChapter(pack, { title: '没这章', index: 9, texts: ['丙一', '丙二'] });
    expect(got?.chapter.title).toBe('第三章');
    expect(got?.matched).toBe(2);
  });

  it('正文和每一章都对不上：返回 null，由调用方提示「对不上」', () => {
    expect(matchChapter(pack, { title: '没这章', index: 9, texts: ['完全', '无关'] })).toBeNull();
  });

  /* 2026-11-14 真机：「高亮在当前页、声音从章首念」。根因是撞上一句到处都
     有的短句就认了章，播的是别的章的音频。相似度兜底要够像才算。 */
  it('只凑出一句通用短句：不认这一章，宁可回落实时合成', () => {
    const texts = ['他说。', '第一句别的', '第二句别的', '第三句别的', '第四句别的'];
    const got = matchChapter(pack, { title: '没这章', index: 9, texts });
    expect(got).toBeNull();
  });

  it('对上两成以上：按最像的一章认下来', () => {
    const texts = ['丙一', '丙二', '别的甲', '别的乙', '别的丙'];
    const got = matchChapter(pack, { title: '没这章', index: 9, texts });
    expect(got?.chapter.title).toBe('第三章');
    expect(got?.matched).toBe(2);
  });

  it('章名命中但正文改过：仍然返回这一章，matched 为 0（判过期）', () => {
    const got = matchChapter(pack, { title: '第一章', texts: ['被改掉的', '正文'] });
    expect(got?.chapter.title).toBe('第一章');
    expect(got?.matched).toBe(0);
  });

  it('包里一章都没有时返回 null', () => {
    expect(matchChapter({ ...pack, chapters: [] }, { texts: ['甲一'] })).toBeNull();
  });
});

describe('清单读写', () => {
  it('写出去再读回来不丢信息', () => {
    const parsed = parseOfflineBook(JSON.parse(serializeOfflineBook(book() as never)));
    expect(parsed?.title).toBe('围城');
    expect(parsed?.chapters[0].marks[1]).toEqual({ text: '乙', at: 1000, ms: 2000 });
  });

  it('逐句字节区间写出去再读回来不丢', () => {
    const marks = buildMarks(['甲', '乙'], [1000, 2000], [
      { off: 0, bytes: 400 },
      { off: 400, bytes: 800 },
    ]);
    const parsed = parseOfflineBook(
      JSON.parse(serializeOfflineBook(book({ chapters: [chapter(marks)] }) as never)),
    );
    expect(parsed?.chapters[0].marks).toEqual([
      { text: '甲', at: 0, ms: 1000, off: 0, bytes: 400 },
      { text: '乙', at: 1000, ms: 2000, off: 400, bytes: 800 },
    ]);
  });

  it('版本不一致就不认，免得半懂不懂地播', () => {
    expect(parseOfflineBook(book({ version: OFFLINE_VERSION + 1 }))).toBeNull();
    expect(parseOfflineBook(book({ version: 0 }))).toBeNull();
  });

  /* 2026-11-14 升到 v3：清单多记了每句的字节区间，播放器按区间一句一个
     音频对象播。v2 及更早的包没有区间，直接不认，免得又退回从章首念。 */
  it('v2 及第一代包（v1）不认', () => {
    expect(parseOfflineBook(book({ version: 2 }))).toBeNull();
    expect(parseOfflineBook(book({ version: 1 }))).toBeNull();
  });

  it('缺书名字段不认', () => {
    expect(parseOfflineBook(book({ title: '' }))).toBeNull();
    expect(parseOfflineBook(book({ title: 123 }))).toBeNull();
  });

  it('章节不是数组、或者一章都没有，都不认', () => {
    expect(parseOfflineBook(book({ chapters: 'nope' }))).toBeNull();
    expect(parseOfflineBook(book({ chapters: [] }))).toBeNull();
  });

  it('某一章缺音频文件名：只丢这一章，不整包作废', () => {
    const parsed = parseOfflineBook(
      book({
        chapters: [
          chapter([{ text: '甲', at: 0, ms: 1 }]),
          { title: '第二章', file: '', ms: 0, bytes: 0, marks: [] },
        ],
      }),
    );
    expect(parsed?.chapters.map((c) => c.title)).toEqual(['第一章']);
  });

  it('字符串进来（还没 JSON.parse）也能读', () => {
    expect(parseOfflineBook(JSON.stringify(book()))?.title).toBe('围城');
  });

  it('乱码给 null，不抛', () => {
    expect(parseOfflineBook('{')).toBeNull();
    expect(parseOfflineBook(null)).toBeNull();
    expect(parseOfflineBook(42)).toBeNull();
  });
});

describe('体积与时长', () => {
  it('整包汇总章数、总时长、总字节', () => {
    const parsed = parseOfflineBook(book())!;
    expect(offlineTotals(parsed)).toEqual({ chapters: 1, ms: 3000, bytes: 100 });
  });

  it('拿不到精确时长时按字节估算 mp3（64 kbps）', () => {
    expect(estimateMs(8000, 'mp3')).toBe(1000);
    expect(estimateMs(0, 'mp3')).toBe(0);
  });

  it('不认识的格式给 0，不瞎猜', () => {
    expect(estimateMs(8000, 'ogg')).toBe(0);
  });
});
