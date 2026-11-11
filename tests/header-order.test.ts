import { describe, expect, it } from 'vitest';
import { moveHeaderAction } from '../src/shell/header-order';

/* ============================================================
 * 头栏图标排序（tests/header-order.test.ts）
 *
 * 背景（2026-11-11）：手机上收起并排 / 对照书籍 / 朗读三项后，设置页的
 * 「阅读页图标」不再列出它们，但顺序偏好里仍保留它们的位置（切回电脑原位
 * 复现）。于是「上下移」如果按完整顺序交换相邻一位，就可能换成一颗屏幕上
 * 看不见的项——用户点一下，画面里什么都没动，像按钮坏了。
 *
 * 这里钉的就是这条：交换只在**看得见**的项之间发生，看不见的项位置不动。
 * 判据（哪几项算看不见）由调用方给，纯函数不认平台。
 * ============================================================ */

const ALL = (): boolean => true;
/** 手机形态：这台设备不提供的三项看不见 */
const PHONE = (id: string): boolean => !['para', 'paraBook', 'tts'].includes(id);

describe('moveHeaderAction · 全部可见时就是相邻交换', () => {
  it('往下移：和紧跟的一颗换位', () => {
    expect(moveHeaderAction(['toc', 'search', 'mark'], 'search', 1, ALL)).toEqual(['toc', 'mark', 'search']);
  });

  it('往上移：和前面一颗换位', () => {
    expect(moveHeaderAction(['toc', 'search', 'mark'], 'search', -1, ALL)).toEqual(['search', 'toc', 'mark']);
  });

  it('不改原数组（调用方拿到的是一份新顺序）', () => {
    const order = ['toc', 'search', 'mark'];
    moveHeaderAction(order, 'search', 1, ALL);
    expect(order).toEqual(['toc', 'search', 'mark']);
  });
});

describe('moveHeaderAction · 看不见的项不参与交换', () => {
  it('中间夹一颗看不见的：跳过它，和下一颗看得见的换', () => {
    expect(moveHeaderAction(['toc', 'tts', 'mark'], 'toc', 1, PHONE)).toEqual(['mark', 'tts', 'toc']);
  });

  it('连着夹好几颗：一次跳到下一颗看得见的', () => {
    expect(moveHeaderAction(['toc', 'para', 'paraBook', 'mark'], 'toc', 1, PHONE)).toEqual([
      'mark',
      'para',
      'paraBook',
      'toc',
    ]);
  });

  it('往上移同样跳过看不见的', () => {
    expect(moveHeaderAction(['toc', 'tts', 'mark'], 'mark', -1, PHONE)).toEqual(['mark', 'tts', 'toc']);
  });

  it('看不见的项自己位置一点不动（切回电脑原位复现）', () => {
    const next = moveHeaderAction(['toc', 'para', 'search', 'tts', 'mark'], 'toc', 1, PHONE);
    expect(next).not.toBeNull();
    expect(next!.indexOf('para')).toBe(1);
    expect(next!.indexOf('tts')).toBe(3);
  });

  it('底下全是看不见的：动不了，返回 null（按钮该禁用）', () => {
    expect(moveHeaderAction(['toc', 'para', 'tts'], 'toc', 1, PHONE)).toBeNull();
  });

  it('顶上全是看不见的：动不了，返回 null', () => {
    expect(moveHeaderAction(['para', 'tts', 'mark'], 'mark', -1, PHONE)).toBeNull();
  });
});

describe('moveHeaderAction · 边界与坏输入', () => {
  it('第一颗往上移：null', () => {
    expect(moveHeaderAction(['toc', 'search'], 'toc', -1, ALL)).toBeNull();
  });

  it('最后一颗往下移：null', () => {
    expect(moveHeaderAction(['toc', 'search'], 'search', 1, ALL)).toBeNull();
  });

  it('id 不在顺序里：null', () => {
    expect(moveHeaderAction(['toc', 'search'], 'mark', 1, ALL)).toBeNull();
  });

  it('空顺序：null', () => {
    expect(moveHeaderAction([], 'toc', 1, ALL)).toBeNull();
  });
});
