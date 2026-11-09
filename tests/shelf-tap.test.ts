import { describe, expect, it } from 'vitest';
import {
  SHELF_TAP_ATTR,
  SHELF_TAP_BOOK_ATTR,
  bindShelfTap,
  isShelfTapStill,
  shelfTapFrom,
  shelfTapOf,
  type ShelfTap,
} from '../src/shell/shelf-tap';

/**
 * 分类管理在「手指抬起」那一刻打开（2026-11-09）。
 *
 * 背景：这个界面只能从 Obsidian 原生菜单进入，菜单项的点击回调里聚焦，
 * 手机上只给光标、不给键盘；touchend 才是真手势。这里测的是「怎么认出
 * 用户点的是哪一项」和「怎么算点了一下」，真机弹不弹键盘另由冒烟验证。
 */

describe('shelfTapOf', () => {
  it('认识两个标记值', () => {
    expect(shelfTapOf('manage')).toBe('manage');
    expect(shelfTapOf('new')).toBe('new');
  });

  it('别的值一律不认', () => {
    expect(shelfTapOf(null)).toBeNull();
    expect(shelfTapOf('')).toBeNull();
    expect(shelfTapOf('delete')).toBeNull();
  });
});

/** 造一条「菜单项 → 文字 span」的祖先链，返回最内层（手指真正点到的那层） */
function chain(attrs: Array<Record<string, string>>): Element {
  let parent: unknown = null;
  for (const a of attrs) {
    const el = {
      getAttribute: (k: string) => a[k] ?? null,
      parentElement: parent,
    };
    parent = el;
  }
  return parent as Element;
}

describe('shelfTapFrom', () => {
  it('点在文字上也能顺着祖先找到标记', () => {
    const text = chain([{ [SHELF_TAP_ATTR]: 'manage' }, {}]);
    expect(shelfTapFrom(text)).toEqual({ mode: 'manage' });
  });

  it('新建分类要带上那本书', () => {
    const el = chain([{ [SHELF_TAP_ATTR]: 'new', [SHELF_TAP_BOOK_ATTR]: 'b1' }]);
    expect(shelfTapFrom(el)).toEqual({ mode: 'new', bookId: 'b1' });
  });

  it('没挂标记的菜单项不抢——分类名、取消之类照旧走宿主', () => {
    expect(shelfTapFrom(chain([{}]))).toBeNull();
    expect(shelfTapFrom(null)).toBeNull();
  });

  it('点到左边图标那一侧，也能从同一个菜单项里找到标记', () => {
    const marked = {
      getAttribute: (k: string) => (k === SHELF_TAP_ATTR ? 'manage' : null),
    };
    const item = {
      getAttribute: () => null,
      querySelector: (sel: string) => (sel.includes(SHELF_TAP_ATTR) ? marked : null),
    };
    const icon = {
      getAttribute: () => null,
      parentElement: null,
      closest: (sel: string) => (sel === '.menu-item' ? item : null),
    };
    expect(shelfTapFrom(icon as unknown as Element)).toEqual({ mode: 'manage' });
  });
});

describe('isShelfTapStill', () => {
  const start = { x: 100, y: 100, at: 0 };

  it('原地轻点算点了一下', () => {
    expect(isShelfTapStill(start, { x: 104, y: 98, at: 120 })).toBe(true);
  });

  it('滑走了就不算——不能把「翻菜单时划了一下」当成点中', () => {
    expect(isShelfTapStill(start, { x: 140, y: 100, at: 120 })).toBe(false);
    expect(isShelfTapStill(start, { x: 100, y: 160, at: 120 })).toBe(false);
  });

  it('按太久也不算（长按多半是别的意图）', () => {
    expect(isShelfTapStill(start, { x: 100, y: 100, at: 700 })).toBe(false);
  });
});

/** 极简假文档：只要 add/remove/fire，够验绑定本身的行为 */
function fakeDoc() {
  const map = new Map<string, Set<(ev: unknown) => void>>();
  const opts = new Map<string, unknown>();
  return {
    addEventListener(type: string, fn: (ev: unknown) => void, options?: unknown) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn);
      if (type === 'touchend') opts.set(type, options);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void) {
      map.get(type)?.delete(fn);
    },
    fire(type: string, ev: unknown) {
      for (const fn of Array.from(map.get(type) ?? [])) fn(ev);
    },
    count(type: string) {
      return map.get(type)?.size ?? 0;
    },
    optionsOf(type: string) {
      return opts.get(type) as { capture?: boolean; passive?: boolean } | undefined;
    },
  };
}

function touchAt(x: number, y: number, target?: Element) {
  const ev = {
    touches: [],
    changedTouches: [{ clientX: x, clientY: y }],
    target: target ?? null,
    defaultPrevented: false,
    preventDefault() {
      ev.defaultPrevented = true;
    },
  };
  return ev;
}

describe('bindShelfTap', () => {
  it('点中「分类管理」就交出去', () => {
    const doc = fakeDoc();
    const seen: ShelfTap[] = [];
    bindShelfTap(doc as unknown as Document, (tap) => seen.push(tap));
    const item = chain([{ [SHELF_TAP_ATTR]: 'manage' }]);

    doc.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }] });
    doc.fire('touchend', touchAt(10, 10, item));

    expect(seen).toEqual([{ mode: 'manage' }]);
  });

  /* 2026-11-09 真机：点菜单项只弹一下键盘又收回去，弹窗始终不出来。
     原因是我们先在 touchend 里叫键盘，页面被顶起来，宿主随后那次 click
     落到别处（WebKit r188405 记录过同一现象），菜单项的 onClick 从没跑过。
     现在这一下由我们接管：拦掉默认行为，自己关菜单、自己开弹层。 */
  it('点中时拦掉默认行为：宿主那次 click 不能再落到别处', () => {
    const doc = fakeDoc();
    bindShelfTap(doc as unknown as Document, () => undefined);
    const item = chain([{ [SHELF_TAP_ATTR]: 'manage' }]);

    doc.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }] });
    const ev = touchAt(10, 10, item);
    doc.fire('touchend', ev);

    expect(ev.defaultPrevented).toBe(true);
  });

  it('普通菜单项不拦：分类名、取消这些照旧交给宿主', () => {
    const doc = fakeDoc();
    bindShelfTap(doc as unknown as Document, () => undefined);

    doc.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }] });
    const ev = touchAt(10, 10, chain([{}]));
    doc.fire('touchend', ev);

    expect(ev.defaultPrevented).toBe(false);
  });

  it('touchend 必须是非 passive：被动监听里的 preventDefault 是空操作', () => {
    const doc = fakeDoc();
    bindShelfTap(doc as unknown as Document, () => undefined);

    expect(doc.optionsOf('touchend')?.passive).toBe(false);
    expect(doc.optionsOf('touchend')?.capture).toBe(true);
  });

  it('手指滑走了不打开', () => {
    const doc = fakeDoc();
    const seen: ShelfTap[] = [];
    bindShelfTap(doc as unknown as Document, (tap) => seen.push(tap));
    const item = chain([{ [SHELF_TAP_ATTR]: 'manage' }]);

    doc.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }] });
    doc.fire('touchend', touchAt(60, 10, item));

    expect(seen).toEqual([]);
  });

  it('普通菜单项不动，宿主自己处理', () => {
    const doc = fakeDoc();
    const seen: ShelfTap[] = [];
    bindShelfTap(doc as unknown as Document, (tap) => seen.push(tap));

    doc.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }] });
    doc.fire('touchend', touchAt(10, 10, chain([{}])));

    expect(seen).toEqual([]);
  });

  it('两根手指按下去不算点选', () => {
    const doc = fakeDoc();
    const seen: ShelfTap[] = [];
    bindShelfTap(doc as unknown as Document, (tap) => seen.push(tap));
    const item = chain([{ [SHELF_TAP_ATTR]: 'manage' }]);

    doc.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }, { clientX: 40, clientY: 40 }] });
    doc.fire('touchend', touchAt(10, 10, item));

    expect(seen).toEqual([]);
  });

  it('解绑之后不再管', () => {
    const doc = fakeDoc();
    const seen: ShelfTap[] = [];
    const off = bindShelfTap(doc as unknown as Document, (tap) => seen.push(tap));
    const item = chain([{ [SHELF_TAP_ATTR]: 'manage' }]);
    off();

    doc.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }] });
    doc.fire('touchend', touchAt(10, 10, item));

    expect(seen).toEqual([]);
    expect(doc.count('touchend')).toBe(0);
  });
});
