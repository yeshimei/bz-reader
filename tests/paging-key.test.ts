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

  it('其它键不拦', () => {
    const ctx = { flow: 'paged', contentVertical: false } as const;
    expect(pagingKeyAction('a', ctx)).toBeNull();
    expect(pagingKeyAction('Escape', ctx)).toBeNull();
  });
});
