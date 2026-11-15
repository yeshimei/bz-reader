import { describe, expect, it } from 'vitest';
import { ttsResumeHtml } from '../src/view/tts-resume';
import {
  normalizeTtsResume,
  resumeAnchorOf,
  sameChapter,
  type TtsResumePoint,
} from '../src/core/tts-resume';

const point = (over: Partial<TtsResumePoint> = {}): TtsResumePoint => ({
  bookId: 'b1',
  chapterTitle: '第三章',
  chapterIndex: 2,
  block: 4,
  at: 12,
  len: 9,
  text: '他推开门走了进去。',
  index: 36,
  total: 214,
  updatedAt: 1_700_000_000_000,
  ...over,
});

describe('ttsResumeHtml', () => {
  it('只有两颗按钮：继续听 / 关闭', () => {
    const h = ttsResumeHtml(point());
    expect(h).toContain('data-act="ttsresume"');
    expect(h).toContain('data-act="ttsresumeclose"');
    expect(h.match(/data-act="/g)?.length).toBe(2);
  });

  it('说明里带句号与章名，用户一眼知道接着哪听', () => {
    const h = ttsResumeHtml(point());
    expect(h).toContain('第 37 句');
    expect(h).toContain('第三章');
  });

  it('章名为空时只说句号，不留一个孤零零的分隔点', () => {
    const h = ttsResumeHtml(point({ chapterTitle: '' }));
    expect(h).toContain('第 37 句');
    expect(h).not.toContain('·');
  });

  it('章名里的尖括号被转义', () => {
    const h = ttsResumeHtml(point({ chapterTitle: '<img src=x>' }));
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });

  it('浮窗有固定钩子，视图据此挂事件与量高度', () => {
    expect(ttsResumeHtml(point())).toContain('data-role="ttsresume"');
  });
});

describe('sameChapter', () => {
  const chapter = { title: '第三章', index: 2 };

  it('章名一致就算同章：目录顺序变了也认得', () => {
    expect(sameChapter(point({ chapterIndex: 9 }), chapter)).toBe(true);
  });

  it('章序一致就算同章：章名改过也认得', () => {
    expect(sameChapter(point({ chapterTitle: '第三章（修订）' }), chapter)).toBe(true);
  });

  it('章名和章序都对不上：不是同一章', () => {
    expect(sameChapter(point({ chapterTitle: '第四章', chapterIndex: 3 }), chapter)).toBe(false);
  });

  it('两边都没章名、章序也无效：不算同章，别把别的书当成本章', () => {
    expect(sameChapter(point({ chapterTitle: '', chapterIndex: -1 }), { title: '', index: -1 })).toBe(false);
  });
});

describe('resumeAnchorOf', () => {
  const blocks = [
    { tag: 'p', text: '第一章开头。', raw: '第一章开头。' },
    { tag: 'p', text: '他推开门走了进去。', raw: '他推开门走了进去。' },
  ];

  it('同章同块同偏移：直接对位，不搜文本', () => {
    const got = resumeAnchorOf(point({ block: 1, at: 0, len: 9 }), blocks, {
      title: '第三章',
      index: 2,
    });
    expect(got).toEqual({ block: 1, offset: 0 });
  });

  it('正文前面插了几句：按文本在块里找回真实偏移', () => {
    const moved = [
      { tag: 'p', text: '新加的一句。他推开门走了进去。', raw: '新加的一句。他推开门走了进去。' },
    ];
    const got = resumeAnchorOf(point({ block: 0, at: 0, len: 9 }), moved, {
      title: '第三章',
      index: 2,
    });
    expect(got).toEqual({ block: 0, offset: 6 });
  });

  it('块序号变了：按文本重找块', () => {
    const shifted = [
      { tag: 'p', text: '新段落。', raw: '新段落。' },
      { tag: 'p', text: '他推开门走了进去。', raw: '他推开门走了进去。' },
    ];
    const got = resumeAnchorOf(point({ block: 0, at: 0, len: 9 }), shifted, {
      title: '第三章',
      index: 2,
    });
    expect(got).toEqual({ block: 1, offset: 0 });
  });

  it('换了章：不给锚点', () => {
    expect(
      resumeAnchorOf(point({ chapterTitle: '第九章', chapterIndex: 8 }), blocks, {
        title: '第三章',
        index: 2,
      }),
    ).toBeNull();
  });

  it('正文改得找不到那句：返回 null，交给页首兜底', () => {
    expect(
      resumeAnchorOf(point({ text: '这句话已经不存在了。' }), blocks, {
        title: '第三章',
        index: 2,
      }),
    ).toBeNull();
  });
});

describe('normalizeTtsResume', () => {
  it('正常值原样回来', () => {
    const p = point();
    expect(normalizeTtsResume(p)).toEqual(p);
  });

  it('坏值 / 缺字段一律 null，不拿半条记录去跳页', () => {
    expect(normalizeTtsResume(null)).toBeNull();
    expect(normalizeTtsResume({})).toBeNull();
    expect(normalizeTtsResume({ bookId: 'b1' })).toBeNull();
    expect(normalizeTtsResume('nope')).toBeNull();
  });

  it('数字取整：存回来的可能是浮点数', () => {
    const got = normalizeTtsResume(point({ index: 37.8, total: 214.2, block: 4.9, at: 12.3 }));
    expect(got?.index).toBe(38);
    expect(got?.total).toBe(214);
    expect(got?.block).toBe(5);
    expect(got?.at).toBe(12);
  });

  it('负数的段号当坏值丢掉', () => {
    expect(normalizeTtsResume(point({ index: -1 }))).toBeNull();
  });
});
