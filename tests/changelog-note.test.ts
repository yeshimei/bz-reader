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

describe('更新日志 · 页脚入口', () => {
  /* 底栏照 bz 的更新日志小窗（2026-11-10 用户拍板）：一排纯图标整组靠右，
     最后一个是「支持作者」胶囊（文字 + 淡底 + 右上角「+人数」角标）；
     不再有「知道了」，关窗只走右上角 × / 点遮罩 / ESC。
     入口就 bz 那三个：GitHub / QQ 群 / B 站；「问题反馈」不要。 */
  const html = () => changelogNoteHtml(CHANGELOG_RELEASES, '0.4.1');

  it('三个图标入口：GitHub / QQ 群 / B 站', () => {
    const s = html();
    for (const act of ['chgnrepo', 'chgnqq', 'chgnvideo']) {
      expect(s, act).toContain(`data-act="${act}"`);
    }
  });

  it('「问题反馈」不再出现', () => {
    expect(html()).not.toContain('chgnissues');
  });

  it('两端各一组：桌面页脚与手机浮条共用同三个入口', () => {
    expect([...html().matchAll(/data-act="chgnrepo"/g)]).toHaveLength(2);
  });

  it('照 bz 去掉「知道了」：弹窗里不再有那颗主按钮', () => {
    const s = html();
    expect(s).not.toContain('chgndone');
    expect(s).not.toContain('知道了');
  });

  /* 人数只有名单长度一个来源，别在别处再存一份计数（bz 那边的
     `REWARD_COUNT` 就是反面教材）。角标照 bz 带「+」，读起来是「已有几位」。 */
  it('支持作者是带文字与人数的胶囊，角标带 + 号', () => {
    const s = html();
    expect([...s.matchAll(/data-role="chgnsupport"/g)]).toHaveLength(2);
    expect(s).toContain(`+${REWARD_NAMES.length}</span>`);
    expect(s).toContain('>支持作者</span>');
    expect(s).toContain(`已有 ${REWARD_NAMES.length} 位`);
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
