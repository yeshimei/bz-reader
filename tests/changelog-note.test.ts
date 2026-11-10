import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { CHANGELOG_RELEASES } from '../src/shell/changelog';
import { changelogNoteHtml, openChangelogNote } from '../src/shell/changelog-note';
import { REWARD_NAMES } from '../src/data/reward';

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

describe('更新日志 · 页脚的支持作者入口', () => {
  /* 位置（右下角）与人数都靠标记与文案钉住：人数只有名单长度一个来源，
     别在别处再存一份计数（bz 那边的 `REWARD_COUNT` 就是反面教材）。 */
  it('桌面页脚有一枚带人数的支持作者', () => {
    const html = changelogNoteHtml(CHANGELOG_RELEASES, '0.4.1');
    expect(html).toContain('data-role="chgnsupport"');
    expect(html).toContain(`已有 ${REWARD_NAMES.length} 位`);
  });

  it('手机底条也有同一枚（两端共用一份数据，不另画一个）', () => {
    const html = changelogNoteHtml(CHANGELOG_RELEASES, '0.4.1');
    expect([...html.matchAll(/data-role="chgnsupport"/g)]).toHaveLength(2);
  });
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

  /* 连点两下「更新日志」、或提示弹出来的瞬间又点设置页：新窗开之前先收掉旧的，
     否则两层遮罩叠着，关掉上面那层下面还在（看着像关不掉）。 */
  it('连开两次只留一层遮罩', () => {
    const first = openChangelogNote(CHANGELOG_RELEASES, '0.1.2');
    const before = document.body.children.length;
    const second = openChangelogNote(CHANGELOG_RELEASES, '0.1.1');

    expect(document.body.children.length).toBe(before);

    second.close();
    expect(document.body.children.length).toBe(before - 1);
    expect(() => first.close()).not.toThrow(); // 旧句柄已经关过了，再关一次也不炸
  });

  /* 渐隐提示跟着 window resize 重算（D6）。窗关掉后这个监听必须摘掉：
     不摘的话每次改窗口大小都会去碰已经离树的节点，弹窗开过几次就攒几个。 */
  it('关窗时把 window 上的 resize 监听摘掉', () => {
    const added: Array<{ type: string; fn: unknown }> = [];
    const removed: Array<{ type: string; fn: unknown }> = [];
    const w = window as unknown as Record<string, unknown>;
    const prevAdd = w.addEventListener;
    const prevRemove = w.removeEventListener;
    w.addEventListener = (type: string, fn: unknown) => void added.push({ type, fn });
    w.removeEventListener = (type: string, fn: unknown) => void removed.push({ type, fn });
    try {
      const note = openChangelogNote(CHANGELOG_RELEASES, '0.1.2');
      const resizes = added.filter((a) => a.type === 'resize');
      expect(resizes.length).toBe(1);

      note.close();
      expect(removed.filter((r) => r.type === 'resize').map((r) => r.fn)).toContain(resizes[0]!.fn);
    } finally {
      w.addEventListener = prevAdd;
      w.removeEventListener = prevRemove;
    }
  });
});
