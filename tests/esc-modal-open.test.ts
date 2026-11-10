import { afterEach, describe, expect, it } from 'vitest';
import { hostModalOpen } from '../src/core/esc-manager';

/* ============================================================
 * 「宿主自己的弹窗是不是开着」。
 *
 * ESC 的分层约定是：宿主的设置 / 命令面板 / 确认框在上面，就先让它关。
 * 这里只判 body 下有没有 `.modal-container` 这一层壳，不关心里面是什么。
 * 以前用 document.querySelector 找它，社区目录的机器审查把 querySelector
 * 标成弃用写法；改成按类名取集合判长度，语义完全一样。
 * ============================================================ */

const g = globalThis as unknown as { document?: unknown };
const prev = g.document;

afterEach(() => {
  if (prev === undefined) delete g.document;
  else g.document = prev;
});

function withDocument(value: unknown): void {
  g.document = value;
}

describe('hostModalOpen', () => {
  it('有 .modal-container 时算开着', () => {
    withDocument({ getElementsByClassName: () => ({ length: 1 }) });
    expect(hostModalOpen()).toBe(true);
  });

  it('一个都没有时算没开', () => {
    withDocument({ getElementsByClassName: () => ({ length: 0 }) });
    expect(hostModalOpen()).toBe(false);
  });

  it('没有 document（node 环境）时不炸', () => {
    delete g.document;
    expect(hostModalOpen()).toBe(false);
  });

  it('宿主换了实现、取不到集合时按没开处理', () => {
    withDocument({});
    expect(hostModalOpen()).toBe(false);
  });
});
