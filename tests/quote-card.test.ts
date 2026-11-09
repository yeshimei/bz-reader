import { describe, expect, it } from 'vitest';
import { CARD_TEMPLATES, normalizeCardTemplate } from '../src/shell/card-template';
import { cardTemplateChipsHtml, quoteCardHtml } from '../src/shell/render/quote-card';

const card = (template?: string) =>
  quoteCardHtml({
    text: '落霞与孤鹜齐飞',
    bookTitle: '滕王阁序',
    author: '王勃',
    chapter: '第一段',
    template,
  });

describe('书摘卡模板（多模板）', () => {
  it('至少三种版式，id 不重复', () => {
    expect(CARD_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const ids = CARD_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('认不出的模板退回经典（旧弹层状态 / 手改的 mode 不该白屏）', () => {
    expect(normalizeCardTemplate(undefined)).toBe('classic');
    expect(normalizeCardTemplate('不存在')).toBe('classic');
    expect(normalizeCardTemplate('night')).toBe('night');
  });

  it('经典版式不带后缀，其余版式带 tpl-* 类', () => {
    expect(card('classic')).toContain('class="bzs-qcard"');
    expect(card('night')).toContain('tpl-night');
    expect(card()).toContain('class="bzs-qcard"');
  });

  it('卡片正文仍然转义（书名里出现 < 不破坏结构）', () => {
    const h = quoteCardHtml({
      text: 'a < b',
      bookTitle: '<script>',
      author: '作者',
      chapter: '章',
      template: 'letter',
    });
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;');
    expect(h).toContain('tpl-letter');
  });

  it('不再带「bz 阅读」印章（展示窗右下角留白）', () => {
    for (const tpl of ['classic', 'letter', 'night', 'film'] as const) {
      const h = card(tpl);
      expect(h).not.toContain('stamp');
      expect(h).not.toContain('bz 阅读');
    }
  });

  it('模板切换按钮里当前版式高亮，每个按钮带 cardtpl 动作', () => {
    const h = cardTemplateChipsHtml('film');
    expect((h.match(/data-act="cardtpl"/g) ?? []).length).toBe(CARD_TEMPLATES.length);
    expect(h).toMatch(/data-v="film"[^>]*class="[^"]*on|class="[^"]*on[^"]*"[^>]*data-v="film"/);
  });
});
