import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 解锁弹层里的群入口。
 *
 * 2026-11-03 起不对外发试用，弹层里那颗按钮只做一件事：把群号递出去。
 * 所以它必须**常驻可见**（不是试用期的奖励），文案里也不能出现「试用」——
 * 用户加进去却领不到码，比没有入口更难看。
 */

/* notify 走 Obsidian 的 Notice，node 里拿不到弹出来的那条；换成收集器 */
const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

/* entitlement() 读宿主存储；弹层只需要「现在是什么档位」这一个事实 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    entitlement: () => ({
      tier: 'free' as const,
      unlocked: false,
      trialLeft: 0,
      trialUsed: 0,
      exp: 0,
      license: '',
      trialVoid: false,
      installId: 'test',
      days: [],
    }),
  };
});

import { GROUP_ID, TRIAL_ACTIVE, planTotals } from '../src/data/entitlement';
import { setLocale, t } from '../src/i18n';
import { copyGroupId, groupButtonHtml } from '../src/shell/group';
import { overlayUnlock } from '../src/shell/overlay';

afterEach(() => {
  setLocale('zh');
  notices.length = 0;
  vi.unstubAllGlobals();
});

describe('解锁弹层 · 交流群入口', () => {
  it('免费版弹层里就有这颗按钮，印着群号', () => {
    const html = overlayUnlock();
    expect(html).toContain(GROUP_ID);
    expect(html).toContain('QQ');
  });

  it('不提试用：界面上的字不能指向一枚不再发出的码', () => {
    expect(TRIAL_ACTIVE).toBe(false);
    expect(groupButtonHtml()).not.toContain('试用');
    expect(overlayUnlock()).not.toContain('试用');
  });

  it('按钮挂着设置页那条复制动作，不是单独的试用分支', () => {
    expect(groupButtonHtml()).toContain('data-act="copygroup"');
  });

  it('换界面语言后按钮还在，群号不随语言漂移', () => {
    setLocale('en');
    const html = overlayUnlock();
    expect(html).toContain(GROUP_ID);
    expect(html).toContain('QQ');
  });

  it('带输入框的弹层要有 has-input：不然手机键盘把激活码框盖住', () => {
    /* 激活码输入框在页脚（foot），弹层自带的判定只看正文，
       手机上仍按底部抽屉弹，软键盘一开输入框就落在屏幕外。 */
    expect(overlayUnlock()).toMatch(/class="bzs-scrim[^"]*\bhas-input\b/);
  });

  it('购买入口固定在页脚：正文对照表再长，也滚不走它', () => {
    const html = overlayUnlock();
    const footAt = html.indexOf('<div class="bzs-mfoot">');
    expect(footAt).toBeGreaterThan(-1);
    const body = html.slice(0, footAt);
    const foot = html.slice(footAt);
    expect(foot).toContain('bzs-unlock-buy');
    expect(foot).toContain('bzs-unlock-act');
    expect(body).not.toContain('bzs-unlock-buy');
  });
});

describe('解锁弹层 · 点按钮', () => {
  it('复制群号本身，提示去 QQ 搜索而不是领试用', async () => {
    const writes: string[] = [];
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    });

    await copyGroupId();

    expect(writes).toEqual([GROUP_ID]);
    expect(notices.join('')).toContain(GROUP_ID);
    expect(notices.join('')).not.toContain('试用');
  });
});

/**
 * 版式：照商品图（docs/images/plan-compare.png）那一版。
 *
 * 钉的是「图和弹层说的是同一件事」：
 *   · 表头两列都有副标，跟商店页的口径一致（免费不限时 / 一次买断永久）；
 *   · 底部合计与 `PLAN_TABLE` 同源——加一行就变，不是另一份手写数字；
 *   · 表头在表上面，滚到第 30 行时还看得见「哪列是哪版」（样式上钉住它）。
 */
describe('解锁弹层 · 商品图那版版式', () => {
  it('表头两列都带副标：基础版免费不限时、高级版一次买断永久', () => {
    const html = overlayUnlock();
    expect(html).toContain('bzs-plan-head');
    expect(html).toContain(t('unlock.col.base'));
    expect(html).toContain(t('unlock.col.base.sub'));
    expect(html).toContain(t('unlock.col.pro'));
    expect(html).toContain(t('unlock.col.pro.sub'));
  });

  it('表头排在表格上面，滚到表尾也知道哪列是哪版', () => {
    const html = overlayUnlock();
    const head = html.indexOf('bzs-plan-head');
    const first = html.indexOf('阅读与书架');
    expect(head).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(-1);
    expect(head).toBeLessThan(first);
  });

  it('底部合计跟着表走，不是另一份写死的数字', () => {
    const html = overlayUnlock();
    const at = html.indexOf('bzs-plan-row is-total');
    expect(at).toBeGreaterThan(-1);
    /* 合计行里只有两个数字：基础版项数、高级版项数 */
    const nums = [...html.slice(at).matchAll(/<b>(\d+)<\/b>/g)].map((m) => Number(m[1]));
    const totals = planTotals();
    expect(nums.slice(0, 2)).toEqual([totals.free, totals.pro]);
    expect(html).toContain(t('unlock.total'));
    expect(html).toContain(t('unlock.unit'));
  });

  it('换语言后副标与合计一起换，不残留中文', () => {
    setLocale('en');
    const html = overlayUnlock();
    expect(html).toContain(t('unlock.col.base.sub'));
    expect(html).toContain(t('unlock.total'));
    expect(html).not.toContain('免费 · 不限时');
  });
});
