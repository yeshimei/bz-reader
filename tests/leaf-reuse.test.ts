import { describe, expect, it } from 'vitest';
import { isDeferredViewOf, viewTypeOf } from '../src/view/leaf-reuse';

describe('延迟加载视图的识别（A-11）', () => {
  it('只有 getViewType、不是视图类实例，也能认出类型', () => {
    const deferred = { getViewType: () => 'bzs-study' };
    expect(viewTypeOf(deferred)).toBe('bzs-study');
    expect(isDeferredViewOf(deferred, 'bzs-study')).toBe(true);
    expect(isDeferredViewOf(deferred, 'bz-reader-toc')).toBe(false);
  });

  it('getViewType 抛错 / 不是函数时退回空串，不把卸载流程带崩', () => {
    expect(viewTypeOf({ getViewType: () => { throw new Error('boom'); } })).toBe('');
    expect(viewTypeOf({ getViewType: 'bzs-study' })).toBe('');
    expect(viewTypeOf(null)).toBe('');
    expect(viewTypeOf(undefined)).toBe('');
  });
});
