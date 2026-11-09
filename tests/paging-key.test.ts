import { describe, expect, it } from 'vitest';
import { pagingKeyAction } from '../src/view/paging-key';

describe('翻页键位（A-26）', () => {
  it('滚动模式下方向键 / PageUp / PageDown / 空格都不算翻页', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ']) {
      expect(pagingKeyAction(key, { flow: 'scroll', contentVertical: false })).toBeNull();
      expect(pagingKeyAction(key, { flow: 'scroll', contentVertical: true })).toBeNull();
    }
  });

  it('分页模式：横排左 / PageUp 上一页，右 / PageDown / 空格下一页', () => {
    const ctx = { flow: 'paged', contentVertical: false } as const;
    expect(pagingKeyAction('ArrowLeft', ctx)).toBe('prev');
    expect(pagingKeyAction('PageUp', ctx)).toBe('prev');
    expect(pagingKeyAction('ArrowRight', ctx)).toBe('next');
    expect(pagingKeyAction('PageDown', ctx)).toBe('next');
    expect(pagingKeyAction(' ', ctx)).toBe('next');
  });

  it('竖排正文方向反过来（左键 = 下一页）', () => {
    const ctx = { flow: 'paged', contentVertical: true } as const;
    expect(pagingKeyAction('ArrowLeft', ctx)).toBe('next');
    expect(pagingKeyAction('ArrowRight', ctx)).toBe('prev');
  });

  it('RTL 书：左键 = 下一页（与点按同一条反转规则，B1）', () => {
    const ctx = { flow: 'paged', contentVertical: false, contentRtl: true } as const;
    expect(pagingKeyAction('ArrowLeft', ctx)).toBe('next');
    expect(pagingKeyAction('ArrowRight', ctx)).toBe('prev');
    /* PageUp / PageDown 说的是「上一屏 / 下一屏」，与左右方向无关，不跟着反 */
    expect(pagingKeyAction('PageUp', ctx)).toBe('prev');
    expect(pagingKeyAction('PageDown', ctx)).toBe('next');
  });

  it('竖排 + RTL：两次反转抵消', () => {
    const ctx = { flow: 'paged', contentVertical: true, contentRtl: true } as const;
    expect(pagingKeyAction('ArrowLeft', ctx)).toBe('prev');
    expect(pagingKeyAction('ArrowRight', ctx)).toBe('next');
  });

  it('其它键不拦', () => {
    const ctx = { flow: 'paged', contentVertical: false } as const;
    expect(pagingKeyAction('a', ctx)).toBeNull();
    expect(pagingKeyAction('Escape', ctx)).toBeNull();
  });

  it('上下键默认不接管（EPUB 的分页器里没有对应动作）', () => {
    const ctx = { flow: 'paged', contentVertical: false } as const;
    expect(pagingKeyAction('ArrowDown', ctx)).toBeNull();
    expect(pagingKeyAction('ArrowUp', ctx)).toBeNull();
  });

  it('PDF 打开 verticalKeys 之后 ↓ 下一页、↑ 上一页，且不受竖排/RTL 影响', () => {
    const ctx = { flow: 'paged', contentVertical: false, verticalKeys: true } as const;
    expect(pagingKeyAction('ArrowDown', ctx)).toBe('next');
    expect(pagingKeyAction('ArrowUp', ctx)).toBe('prev');
    /* 「上一屏 / 下一屏」与书写方向无关：竖排书按 ↓ 也是往后翻 */
    const vertical = { flow: 'paged', contentVertical: true, verticalKeys: true } as const;
    expect(pagingKeyAction('ArrowDown', vertical)).toBe('next');
    expect(pagingKeyAction('ArrowUp', vertical)).toBe('prev');
  });

  it('滚动模式下即使开了 verticalKeys，上下键也交回浏览器', () => {
    const ctx = { flow: 'scroll', contentVertical: false, verticalKeys: true } as const;
    expect(pagingKeyAction('ArrowDown', ctx)).toBeNull();
    expect(pagingKeyAction('ArrowUp', ctx)).toBeNull();
  });
});
