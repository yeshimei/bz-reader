import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { setLocale } from '../src/i18n';
import { REWARD_NAMES, formatRewardDate, type RewardName } from '../src/data/reward';
import { REPO_URL } from '../src/data/entitlement';
import { openSupportDialog, supportDialogHtml, supportListHtml } from '../src/shell/support-dialog';

/* ============================================================
 * 支持作者弹窗（tests/support-dialog.test.ts）
 *
 * 两段：
 *   1. **纯函数**：名单怎么排、金额怎么写、日期怎么显示、空态与转义。
 *      这些是「纸上写错字」的地方，错了没人会报 bug，只会觉得不体面。
 *   2. **挂载与收口**：开得起来、关得掉、连开两次不叠遮罩。
 *
 * 版式、抽屉高度、滚动这些走真机（AGENTS 第 6 节：不测真实布局）。
 * ============================================================ */

const NAMES: readonly RewardName[] = [
  { name: '面包', amount: 'patron', date: '2026-11-10' },
  { name: '执徐', amount: 12, date: '2026-11-08', message: '伟大无需多言！' },
];

let uninstall = () => undefined as void;

beforeAll(() => {
  uninstall = installDomStub();
});

afterAll(() => {
  uninstall();
});

afterEach(() => {
  setLocale('zh');
});

describe('支持者名单 · 编号', () => {
  /* 最新一位是最大号：名单按时间倒序存，序号却要读起来像「第几位来过」。
     两个方向都得对——只测一头会让「新加一位」时整列错开。 */
  it('倒序编号：最新的排第一行、拿最大号', () => {
    const html = supportListHtml(NAMES);
    const nos = [...html.matchAll(/bzs-sup-no">(\d+)</g)].map((m) => m[1]);
    expect(nos).toEqual(['02', '01']);
  });

  it('两位时补足两位：加一位变 03，原来的顺延', () => {
    const html = supportListHtml([{ name: '新朋友', amount: 6, date: '2026-11-11' }, ...NAMES]);
    const nos = [...html.matchAll(/bzs-sup-no">(\d+)</g)].map((m) => m[1]);
    expect(nos).toEqual(['03', '02', '01']);
  });
});

describe('支持者名单 · 金额与日期', () => {
  it('数字金额补 ¥、不铺小数', () => {
    expect(supportListHtml(NAMES)).toContain('¥12');
    expect(supportListHtml(NAMES)).not.toContain('¥12.00');
  });

  /* 没走赞赏码的那条路（在赞助商店买了东西）：金额位写「赞助人」，
     原样显示、不加货币符号——它不是一个数字。 */
  it('不是数字的金额原样显示，不加 ¥', () => {
    const html = supportListHtml([{ name: '面包', amount: 'patron', date: '2026-11-10' }]);
    expect(html).toContain('赞助人');
    expect(html).not.toContain('¥');
  });

  it('日期转成点分：2026-11-10 → 2026.11.10', () => {
    expect(formatRewardDate('2026-11-10')).toBe('2026.11.10');
    expect(supportListHtml(NAMES)).toContain('2026.11.10');
  });

  it('解析不了的日期原样返回，不猜', () => {
    expect(formatRewardDate('')).toBe('');
    expect(formatRewardDate('去年十一月')).toBe('去年十一月');
  });
});

describe('支持者名单 · 留言与空态', () => {
  it('有留言就登出来', () => {
    expect(supportListHtml(NAMES)).toContain('伟大无需多言！');
  });

  it('没留言就不留空行（不写空串占位）', () => {
    const html = supportListHtml([{ name: '面包', amount: 'patron', date: '2026-11-10' }]);
    expect(html).not.toContain('bzs-sup-msg');
  });

  it('一个都没有：给空态那句话，不是一张空白纸', () => {
    const html = supportListHtml([]);
    expect(html).toContain('bzs-sup-empty');
    expect(html).toContain('还没有人打赏');
  });

  /* 名字与留言是别人写进来的字：签名保证来源，不保证字符安全 */
  it('名字里的尖括号被转义', () => {
    const html = supportListHtml([{ name: '<b>坏人</b>', amount: 1, date: '2026-11-10' }]);
    expect(html).not.toContain('<b>坏人</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('弹窗内容', () => {
  it('该有的五件：码、扫码说明、赞助入口、收藏入口、知道了', () => {
    const html = supportDialogHtml(NAMES);
    expect(html).toContain('bzs-sup-code');
    expect(html).toContain('微信扫码');
    expect(html).toContain('成为赞助人');
    expect(html).toContain('给个 Star');
    expect(html).toContain('知道了');
  });

  /* 两个出口并成一行（2026-11-11 用户拍板）：赞助在前、收藏在后，中间一个
     不可点的间隔点；地址单源在 data 层——这里不另写字面量，也不钉死两处。 */
  it('收藏入口：与赞助入口同一行，中间的点只作分隔', () => {
    const html = supportDialogHtml(NAMES);
    const rowAt = html.indexOf('bzs-sup-exits');
    const sponsorAt = html.indexOf('data-role="supsponsor"');
    const starAt = html.indexOf('data-role="supstar"');
    expect(rowAt).toBeGreaterThan(-1);
    expect(sponsorAt).toBeGreaterThan(rowAt);
    expect(starAt).toBeGreaterThan(sponsorAt);
    expect(html).toContain('bzs-sup-exit-sep');
    expect(REPO_URL).toBe('https://github.com/yeshimei/bz-reader');
  });

  it('名单跟着进来：人数就是名单长度', () => {
    expect(supportDialogHtml(NAMES)).toContain('伟大无需多言！');
    expect(supportDialogHtml([])).toContain('还没有人打赏');
  });

  /* 别把真人姓名钉进断言：名单每来一笔就多一行，钉死人名等于每记一位都要改测试。
     这里守的是名单的形态——非空、时间倒序、金额位只有两种写法。 */
  it('内置名单：非空、最新在前、金额位只有数字或 patron', () => {
    expect(REWARD_NAMES.length).toBeGreaterThan(0);

    const stamps = REWARD_NAMES.map((r) => Date.parse(`${r.date}T00:00:00Z`));
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]!).toBeLessThanOrEqual(stamps[i - 1]!);
    }

    for (const r of REWARD_NAMES) {
      expect(typeof r.amount === 'number' || r.amount === 'patron').toBe(true);
    }
  });

  it('内置名单真的进了弹窗：第一行就是最新那一位', () => {
    expect(supportDialogHtml(REWARD_NAMES)).toContain(REWARD_NAMES[0]!.name);
  });
});

describe('打开与收口', () => {
  it('遮罩挂到 body 上，关掉之后摘除', () => {
    const before = document.body.children.length;
    const handle = openSupportDialog();
    expect(document.body.children.length).toBe(before + 1);

    handle.close();
    expect(document.body.children.length).toBe(before);
  });

  it('close 幂等：连点两下关闭不抛错', () => {
    const handle = openSupportDialog();
    handle.close();
    expect(() => handle.close()).not.toThrow();
  });

  /* 顶部栏和更新日志页脚都能开它：两层遮罩叠着会看着像关不掉 */
  it('连开两次只留一层遮罩', () => {
    const first = openSupportDialog();
    const before = document.body.children.length;
    const second = openSupportDialog();

    expect(document.body.children.length).toBe(before);

    second.close();
    expect(document.body.children.length).toBe(before - 1);
    expect(() => first.close()).not.toThrow();
  });
});
