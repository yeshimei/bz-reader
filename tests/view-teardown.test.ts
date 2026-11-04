import { describe, expect, it, vi } from 'vitest';
import { teardownView } from '../src/engine/view-teardown';
import type { FoliateView } from '../src/types/foliate';

/**
 * A-08：`view.close()` 抛错时不能只 catch 掉。
 *
 * 分页器 destroy 里一旦抛（例如 `#view` 已被置空），`view.close()` 就停在
 * 半路：`renderer.sections` 还钉着整本书，`#mediaQuery` 监听也没摘——
 * 关书之后这些对象全活着，翻几十本手机就吃满。
 */
function fakeView(close: () => void, renderer: unknown): FoliateView {
  return { close, renderer } as unknown as FoliateView;
}

describe('视图拆卸兜底（A-08）', () => {
  it('close 正常时只关一次，不重复 destroy', () => {
    const destroy = vi.fn();
    const renderer: { sections: unknown; destroy: () => void } = { sections: [1, 2, 3], destroy };
    const view = fakeView(() => undefined, renderer);

    teardownView(view);

    expect(destroy).not.toHaveBeenCalled();
    expect(renderer.sections).toEqual([1, 2, 3]);
  });

  it('close 抛错：清空 renderer.sections 并补一次 destroy', () => {
    const destroy = vi.fn();
    const renderer = { sections: [{ id: 'a' }, { id: 'b' }], destroy };
    const view = fakeView(() => {
      throw new Error('already closed');
    }, renderer);

    teardownView(view);

    expect(renderer.sections).toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('兜底的 destroy 自己再抛也不外泄', () => {
    const renderer = {
      sections: [1],
      destroy: () => {
        throw new Error('boom');
      },
    };
    const view = fakeView(() => {
      throw new Error('close failed');
    }, renderer);

    expect(() => teardownView(view)).not.toThrow();
    expect(renderer.sections).toEqual([]);
  });

  it('没有 renderer（open 还没跑完就关书）也不抛', () => {
    const view = fakeView(() => {
      throw new Error('no renderer');
    }, null);
    expect(() => teardownView(view)).not.toThrow();
  });

  it('view 为 null 时安全返回', () => {
    expect(() => teardownView(null)).not.toThrow();
  });
});
