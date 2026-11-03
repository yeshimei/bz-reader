import { describe, expect, it } from 'vitest';
import { isFloatOverlay, overlayKey } from '../src/shell/state';

describe('overlayKey', () => {
  it('关闭状态是空串', () => {
    expect(overlayKey(null)).toBe('');
    expect(overlayKey(undefined)).toBe('');
  });

  it('同 kind 换内容（第二条脚注）也要换键', () => {
    const a = overlayKey({ kind: 'footnote', text: '注一', href: 'x#1' });
    const b = overlayKey({ kind: 'footnote', text: '注二', href: 'x#2' });
    expect(a).not.toBe(b);
  });

  it('同 kind 换标注（划线卡）也要换键', () => {
    expect(overlayKey({ kind: 'hlcard', markId: 'm1' })).not.toBe(overlayKey({ kind: 'hlcard', markId: 'm2' }));
  });

  it('锚点变化也算内容变化（卡片要跟着挪）', () => {
    const a = overlayKey({ kind: 'hlcard', markId: 'm1', anchor: { left: 10, top: 20 } });
    const b = overlayKey({ kind: 'hlcard', markId: 'm1', anchor: { left: 11, top: 20 } });
    expect(a).not.toBe(b);
  });

  it('完全相同的内容键稳定', () => {
    const make = () => overlayKey({ kind: 'idea', markId: 'm1', bookId: 'b1' });
    expect(make()).toBe(make());
  });
});

describe('isFloatOverlay', () => {
  it('无遮罩浮层（含阅读页工具条）为真', () => {
    for (const kind of ['typography', 'hlcard', 'hltools', 'footnote', 'idea'] as const) {
      expect(isFloatOverlay(kind)).toBe(true);
    }
  });

  it('有遮罩的弹层为假（点正文不该关它）', () => {
    for (const kind of ['search', 'import', 'unlock', 'finish'] as const) {
      expect(isFloatOverlay(kind)).toBe(false);
    }
    expect(isFloatOverlay(undefined)).toBe(false);
  });
});
