/**
 * 复习卡生成（data/review-card.ts）。
 *
 * 卡片是「交给复习计划的一篇笔记」，不是数据 dump：复习时用户只会看一眼，
 * 所以正文必须短、必须能辨认出自哪本书哪一章、必须能一键跳回原文那一句。
 * 这里钉住的是**产物形状**，不是拼字符串的实现。
 */
import { describe, it, expect } from 'vitest';
import {
  REVIEW_CARD_MARK,
  REVIEW_IDEA_END,
  REVIEW_IDEA_START,
  buildReviewCard,
  extractIdea,
  renderBody,
  reviewCardName,
  type ReviewCardInput,
} from '../src/data/review-card';

const base: ReviewCardInput = {
  bookTitle: '活着',
  bookId: 'bzr-8f2c',
  highlightId: 'hl-3a91',
  text: '她转过身，没有回头。',
  chapterTitle: '第十二章',
  backlink: '[[书/活着.epub#bzr-cfi=epubcfi(/6/14)|回到原文]]',
  createdAt: Date.UTC(2026, 10, 11, 4, 0),
};

describe('复习卡文件名', () => {
  it('用划线本身当文件名：搜那句话就能找到这张卡', () => {
    expect(reviewCardName(base)).toBe('她转过身，没有回头。');
  });

  it('过长的划线截断到 24 个字', () => {
    const long = { ...base, text: '一'.repeat(60) };
    expect(Array.from(reviewCardName(long))).toHaveLength(24);
  });

  it('换行压成空格、非法字符换成空格', () => {
    expect(reviewCardName({ ...base, text: '前一句\n后一句' })).toBe('前一句 后一句');
    expect(reviewCardName({ ...base, text: 'a/b:c*d?e' })).not.toMatch(/[/:*?]/);
  });

  it('空划线退回一个能建出来的默认名', () => {
    expect(reviewCardName({ ...base, text: '   ' })).toBe('未命名');
  });
});

describe('复习卡正文', () => {
  const md = buildReviewCard(base);

  it('frontmatter 带书、划线、日期三个可反查的键', () => {
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('book: "活着"');
    expect(md).toContain('bookId: "bzr-8f2c"');
    expect(md).toContain('highlight: "hl-3a91"');
    expect(md).toContain('created: 2026-11-11');
  });

  it('标题是「书名 · 章节」，一眼知道出处', () => {
    expect(md).toContain('# 活着 · 第十二章');
  });

  it('原文进引用块', () => {
    expect(md).toContain('> 她转过身，没有回头。');
  });

  it('带回到原文的双链', () => {
    expect(md).toContain('[[书/活着.epub#bzr-cfi=epubcfi(/6/14)|回到原文]]');
  });

  it('末尾有归属标记：下次生成靠它认「这篇是我们写的」', () => {
    expect(md.trimEnd().endsWith(REVIEW_CARD_MARK)).toBe(true);
  });

  it('有想法时单独成段', () => {
    expect(buildReviewCard({ ...base, comment: '她其实在告别' })).toContain('她其实在告别');
  });

  it('没想法时不写空段落', () => {
    expect(md).not.toContain('我的想法');
  });

  it('没有章节名时标题只有书名', () => {
    expect(buildReviewCard({ ...base, chapterTitle: '' })).toContain('# 活着\n');
  });

  it('没有双链时不出空链接行', () => {
    expect(buildReviewCard({ ...base, backlink: '' })).not.toContain('回到原文：');
  });

  it('书名里的多行与引号不会撑破 frontmatter', () => {
    const weird = buildReviewCard({ ...base, bookTitle: '书名"\n恶意键: 1' });
    const fm = weird.slice(0, weird.indexOf('\n---', 3));
    expect(fm).not.toContain('\n恶意键');
    expect(fm.split('\n').filter((l) => l.startsWith('book:')).length).toBe(1);
  });

  it('多行原文压成一行：引用块里换行会被当成两段（中文之间连空格也吃掉，与导出口径一致）', () => {
    expect(buildReviewCard({ ...base, text: '第一行\n第二行' })).toContain('> 第一行第二行');
  });
});

describe('正文模板', () => {
  it('只含空占位符的行整行消失，有内容时那行还在', () => {
    const tpl = '# {{book}}' + String.fromCharCode(10) + '{{comment}}' + String.fromCharCode(10) + '> {{text}}';
    expect(renderBody(tpl, { book: '书', text: '原文', comment: '' })).toBe('# 书' + String.fromCharCode(10) + '> 原文');
    expect(renderBody(tpl, { book: '书', text: '原文', comment: '**想法**' + String.fromCharCode(10) + '一句' })).toContain('一句');
  });

  it('自定义模板只换正文：frontmatter 与末尾标记仍在（否则下次生成会认不出这张卡）', () => {
    const md = buildReviewCard({ ...base, template: '## {{book}}' + String.fromCharCode(10) + String.fromCharCode(10) + '{{text}}' });
    expect(md).toContain('highlight: "hl-3a91"');
    expect(md).toContain('## 活着');
    expect(md.trimEnd().endsWith(REVIEW_CARD_MARK)).toBe(true);
  });

  it('模板留空等于内置格式', () => {
    expect(buildReviewCard({ ...base, template: '' })).toBe(buildReviewCard(base));
  });
});

describe('从旧卡里捞回想法', () => {
  it('认边界标记', () => {
    const md = '正文' + String.fromCharCode(10) + REVIEW_IDEA_START + String.fromCharCode(10) + '我的想法' + String.fromCharCode(10) + REVIEW_IDEA_END;
    expect(extractIdea(md)).toBe('我的想法');
  });

  it('老格式（没有标记）按「我的想法」标题兜底', () => {
    const md = '# 书' + String.fromCharCode(10) + String.fromCharCode(10) + '> 原文' + String.fromCharCode(10) + String.fromCharCode(10) + '**我的想法**' + String.fromCharCode(10) + String.fromCharCode(10) + '补的一段' + String.fromCharCode(10) + String.fromCharCode(10) + '回到原文：[[x]]';
    expect(extractIdea(md)).toBe('补的一段');
  });

  it('都没有就返回空：宁可丢一次刷新，也不把整篇当想法搬走', () => {
    expect(extractIdea('# 随便一篇' + String.fromCharCode(10) + String.fromCharCode(10) + '正文')).toBe('');
  });
});