import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { CHANGELOG_RELEASES } from '../src/shell/changelog';
import { openChangelogNote } from '../src/shell/changelog-note';

/* ============================================================
 * 弹窗的挂载与收口。
 *
 * 项目没装 jsdom，这里只验证「开得起来、关得掉、不往 body 上留垃圾」；
 * 版式与切换手感走真机（AGENTS 第 6 节：不测真实布局）。
 * ============================================================ */

let uninstall = () => undefined as void;

beforeAll(() => {
  uninstall = installDomStub();
});

afterAll(() => {
  uninstall();
});

describe('打开更新日志', () => {
  it('遮罩挂到 body 上，关掉之后摘除', () => {
    const before = document.body.children.length;
    const note = openChangelogNote(CHANGELOG_RELEASES, '0.1.2');
    expect(document.body.children.length).toBe(before + 1);

    note.close();
    expect(document.body.children.length).toBe(before);
  });

  it('close 幂等：连点两下关闭不抛错', () => {
    const note = openChangelogNote(CHANGELOG_RELEASES, '0.1.2');
    note.close();
    expect(() => note.close()).not.toThrow();
  });

  it('一版日志都没有：不开空窗，返回一个空句柄', () => {
    const before = document.body.children.length;
    const note = openChangelogNote([], '0.1.2');
    expect(document.body.children.length).toBe(before);
    expect(() => note.close()).not.toThrow();
  });
});
