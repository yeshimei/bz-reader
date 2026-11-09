import { describe, expect, it } from 'vitest';
import {
  IDEA_BUBBLE_MAX_CHARS,
  aiCardHtml,
  footnoteCardHtml,
  ideaConfirmHtml,
  ideaFullHtml,
  ideaNeedsExpand,
  markBubbleHtml,
  quoteCardHtml,
} from '../src/shell/reader-cards';

/**
 * S10 定稿的五张阅读浮卡。
 *
 * 共同口径（都是原型 showcase-read.html 上定下来的）：
 *   · 没有标题头、没有关闭按钮——点正文或 Esc 收起；
 *   · 只留真正要做的事，不放说明文字；
 *   · 卡片朝上长，叠在划词胶囊之上。
 */

describe('footnoteCardHtml · 脚注', () => {
  it('只有一个注文区，没有标题「脚注」', () => {
    const html = footnoteCardHtml('耽险：担着风险。');
    expect(html).toContain('bzs-fncard');
    expect(html).toContain('耽险：担着风险。');
    expect(html).not.toContain('脚注');
  });

  it('没有「跳到原文 / 关闭」这类按钮', () => {
    const html = footnoteCardHtml('注文');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('跳到原文');
  });

  it('注文里的 HTML 被转义', () => {
    expect(footnoteCardHtml('<b>x</b>')).toContain('&lt;b&gt;');
  });
});

describe('quoteCardHtml · 书摘', () => {
  const input = { text: '何我堂堂须眉', title: '红楼梦', author: '曹雪芹', chapter: '第一回' };

  it('左右两栏：引文在 main，动作在 side', () => {
    const html = quoteCardHtml(input);
    expect(html).toContain('bzs-quote-card');
    expect(html).toMatch(/<div class="main">[\s\S]*<div class="side">/);
    expect(html).toContain('class="q"');
  });

  it('出处由书名 · 作者 · 章节拼成', () => {
    expect(quoteCardHtml(input)).toContain('红楼梦 · 曹雪芹 · 第一回');
  });

  it('右栏默认两颗：复制引用 / 存笔记（没有「关闭」）', () => {
    const html = quoteCardHtml(input);
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain('复制引用');
    expect(html).toContain('存笔记');
    expect(html).not.toContain('关闭');
  });

  /* 「书摘卡片（可分享图片）」是高级版能力位 cap: 'card'。
     没解锁时整颗不出现（不做灰锁——每次划词都提醒一次没买更难受）。 */
  it('解锁后多一颗「复制图片」', () => {
    const html = quoteCardHtml({ ...input, canImage: true });
    expect(html.match(/<button/g)?.length).toBe(3);
    expect(html).toContain('data-act="quotecopyimg"');
    expect(html).toContain('复制图片');
  });

  it('复制引用带上引文与出处，粘进笔记就是一条完整的引用', () => {
    const html = quoteCardHtml(input);
    expect(html).toContain('「何我堂堂须眉」');
    expect(html).toContain('— 红楼梦 · 曹雪芹 · 第一回');
  });

  it('没有书名时不拼出一串空分隔符', () => {
    expect(quoteCardHtml({ text: 'x' })).toContain('<div class="from"></div>');
  });
});

describe('aiCardHtml · 划词 AI 卡', () => {
  it('结果、三档页签与三个动作都在', () => {
    const html = aiCardHtml({ ready: true, answer: '「须眉」指男子。' } as never);
    expect(html).toContain('data-role="aibody"');
    expect(html).toContain('复制');
    expect(html).toContain('重试');
    expect(html).toContain('存为笔记');
    /* 三档住在卡里（2026-11-07）：以前解释 / 翻译 / 摘要各是一条入口，
       问同一段话要关掉卡片回工具条上重新点一次 */
    for (const mode of ['explain', 'translate', 'summarize']) {
      expect(html).toContain(`data-mode="${mode}"`);
    }
  });

  it('没配服务时先说明，而不是空着等', () => {
    const html = aiCardHtml({ ready: false });
    expect(html).toContain('还没有配置 AI 服务');
  });

  it('结果是用户内容，必须转义', () => {
    expect(aiCardHtml({ ready: true, text: '<img>' })).toContain('&lt;img&gt;');
  });
});

describe('ideaConfirmHtml · 想法的二次确认', () => {
  it('问一句，两个出口', () => {
    const html = ideaConfirmHtml();
    expect(html).toContain('还有没保存的内容，要丢弃吗？');
    expect(html).toContain('继续写');
    expect(html).toContain('丢弃');
    expect(html.match(/<button/g)?.length).toBe(2);
  });

  it('继续写在丢弃左边（先给退路）', () => {
    const html = ideaConfirmHtml();
    expect(html.indexOf('data-act="ideakeep"')).toBeLessThan(html.indexOf('data-act="ideadiscard"'));
  });

  it('丢弃走 ideadiscard，继续写走 ideakeep', () => {
    const html = ideaConfirmHtml();
    expect(html).toContain('data-act="ideakeep"');
    expect(html).toContain('data-act="ideadiscard"');
  });
});

describe('markBubbleHtml · 划线气泡', () => {
  it('想法原样显示，带自己的类名', () => {
    const html = markBubbleHtml('「裙钗」是全书的入口');
    expect(html).toContain('bzs-mark-bubble');
    expect(html).toContain('「裙钗」是全书的入口');
  });

  it('想法里的 HTML 被转义', () => {
    expect(markBubbleHtml('<b>x</b>')).toContain('&lt;b&gt;');
  });

  /* 想法放在一个单独的滚动区里：超长时滚的是这一段，不是整张浮层 */
  it('想法正文有自己的滚动区', () => {
    expect(markBubbleHtml('想法')).toContain('class="tx"');
  });
});

/**
 * 长想法：气泡里只露一截，底部给一个「展开全文」的出口。
 *
 * 500 / 1000 字的想法在气泡里滚，工具条不能被顶出屏幕；
 * 但滚到底也只是「看完这一截」，要整篇读得点开那张只读弹窗。
 */
describe('markBubbleHtml · 长想法与展开全文', () => {
  it('短想法不出现「展开全文」', () => {
    const html = markBubbleHtml('一句话', undefined, { markId: 'm1', bookId: 'b1' });
    expect(html).not.toContain('ideaexpand');
    expect(html).not.toContain('is-long');
  });

  it('超过上限的想法带一枚「展开全文」，并记住是哪条标注', () => {
    const long = '长'.repeat(IDEA_BUBBLE_MAX_CHARS + 1);
    const html = markBubbleHtml(long, undefined, { markId: 'm1', bookId: 'b1' });

    expect(html).toContain('is-long');
    expect(html).toContain('data-act="ideaexpand"');
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
    expect(html).toContain('展开全文');
  });

  it('不知道是哪条标注时不出展开（点了也没处可去）', () => {
    const long = '长'.repeat(IDEA_BUBBLE_MAX_CHARS + 1);
    expect(markBubbleHtml(long)).not.toContain('ideaexpand');
  });

  it('判断只看字数，两端共用同一条线', () => {
    expect(ideaNeedsExpand('短'.repeat(IDEA_BUBBLE_MAX_CHARS))).toBe(false);
    expect(ideaNeedsExpand('长'.repeat(IDEA_BUBBLE_MAX_CHARS + 1))).toBe(true);
    expect(ideaNeedsExpand('   ')).toBe(false);
  });
});

describe('ideaFullHtml · 只读全文', () => {
  it('原文原样显示，保留换行，HTML 被转义', () => {
    const html = ideaFullHtml('第一行\n第二行 <b>x</b>');
    expect(html).toContain('bzs-idea-full');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('第一行\n第二行');
  });
});

/**
 * 知识盒链接（2026-11-08）：气泡里单独一行可点标签，不再混进想法正文。
 *
 * 用户原话是「正常显示而不是纯文本，点击可以打开对应笔记」——所以这里要的是
 * 一枚带 data-act 的按钮，不是 `[[…]]` 那几个字符。
 */
describe('markBubbleHtml · 知识盒标签', () => {
  it('没有链接：输出里没有 kbopen，也没有多余的空行容器', () => {
    const html = markBubbleHtml('想法');
    expect(html).not.toContain('kbopen');
    expect(html).toContain('想法');
  });

  it('存过名词：带一枚可点标签（类型 + 笔记名 + 路径）', () => {
    const html = markBubbleHtml('想法', [{ kind: 'term', path: '文献/心流.md', at: 1 }]);
    expect(html).toContain('data-act="kbopen"');
    expect(html).toContain('data-path="文献/心流.md"');
    expect(html).toContain('心流');
    expect(html).toContain('名词');
  });

  it('只有链接、没有想法：气泡仍显示这一行', () => {
    const html = markBubbleHtml('', [{ kind: 'passage', path: '文献/注意力.md', at: 1 }]);
    expect(html).toContain('data-act="kbopen"');
    expect(html).toContain('段落');
  });
});
