import { describe, it, expect } from 'vitest';
import { findTooltipAttrs } from '../scripts/check-tooltip-attrs.mjs';

describe('禁止悬停气泡属性', () => {
  it('抓到模板字符串里的 aria-label 与 title', () => {
    const src = '<button aria-label="关闭" title="关闭">✕</button>';
    expect(findTooltipAttrs(src).length).toBeGreaterThan(0);
  });

  it('抓到 setAttribute 与 setTooltip', () => {
    const src = "el.setAttribute('aria-label', '关闭'); btn.setTooltip('提示');";
    expect(findTooltipAttrs(src).length).toBe(2);
  });

  it('数据字段的 title 赋值不算违规', () => {
    const clean = `book.meta.title = m.title;\nconst o = { title: 'x' }; o.title = 'y';`;
    expect(findTooltipAttrs(clean)).toEqual([]);
  });

  it('视觉隐藏文本写法不算违规', () => {
    const clean = `el.appendChild(srText('关闭')); span.className = 'bzrv-sr-only';`;
    expect(findTooltipAttrs(clean)).toEqual([]);
  });

  it('抓到 DOM 元素的 .title = 赋值（门禁原来漏检这种写法）', () => {
    const src = `if (annot.contents) mark.title = annot.contents.slice(0, 300);`;
    expect(findTooltipAttrs(src).length).toBeGreaterThan(0);
  });
});
