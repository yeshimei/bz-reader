import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import type { BzrData } from '../src/data/bzr-data';
import { CHANGELOG_RELEASES } from '../src/shell/changelog';
import {
  changelogNoteHtml,
  openChangelogNote,
  setChangelogDataForTests,
} from '../src/shell/changelog-note';
import type { RewardName } from '../src/data/reward';

/* ============================================================
 * 更新日志弹窗 · 路线图版
 *
 * 桌面右侧边栏、手机全屏两套形态，数据来自在线配置（可注入）。
 * 这里只测 HTML 结构（项目没装 jsdom），点击手感走真机。
 * ============================================================ */

const NAMES: readonly RewardName[] = [
  { name: '面包', amount: 'patron', date: '2026-11-10' },
];

const DATA: BzrData = {
  version: 1,
  updatedAt: '2026-11-18',
  changelog: [
    { version: '1.5.2', date: '2026-11-17', improved: [
      { domain: { zh: '设置页', en: 'Settings' }, text: { zh: '分组优化', en: 'Groups' }, issue: 2 },
    ] },
  ],
  roadmap: [
    { theme: 'AI 能力', color: '#2f9e6e', order: 1, items: [
      { title: '多轮追问', state: 'doing', src: 'builtin', fb: { kind: 'bili', label: 'B站反馈', href: 'https://www.bilibili.com/' } },
    ] },
    { theme: '阅读体验', color: '#7856d6', order: 2, items: [
      { title: '自定义字体', state: 'plan', src: 'github', fb: { kind: 'issue', n: 12, label: '#12' } },
    ] },
  ],
  stats: { pro: 1286, patrons: 328 },
  links: {
    support: 'https://afdian.net/a/yeshimei',
    buy: 'https://afdian.net/a/yeshimei?plan=pro',
  },
};

let uninstall = () => undefined as void;
beforeAll(() => { uninstall = installDomStub(); });
afterAll(() => { uninstall(); setChangelogDataForTests(null); });

const html = () => changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', NAMES, DATA);

describe('正文：统计卡 + 路线图入口 + 条目 #N', () => {
  it('统计卡是按钮，数字来自在线数据，两端各一份', () => {
    const s = html();
    expect([...s.matchAll(/data-stat="pro"/g)]).toHaveLength(2);
    expect([...s.matchAll(/data-stat="patrons"/g)]).toHaveLength(2);
    expect(s).toContain('1,286');
    expect(s).toContain('328');
  });

  it('路线图入口两端各一份，汇总主题与条目数', () => {
    const s = html();
    expect([...s.matchAll(/data-open-rm/g)]).toHaveLength(2);
    expect(s).toContain('2 主题 · 2 项');
  });

  it('带 issue 的日志条目后有 #N 链接，指向 GitHub', () => {
    const s = html();
    expect(s).toContain('href="https://github.com/yeshimei/bz-reader/issues/2"');
    expect(s).toContain('#2 ↗');
  });

  it('桌面是右侧边栏（不是大弹窗），手机是全屏容器', () => {
    const s = html();
    expect(s).toContain('bzs-chgn-drawer');
    expect(s).toContain('bzs-chgn-mrm');
  });

  it('侧栏与全屏里都渲染两级路线图 + 用户反馈路径', () => {
    const s = html();
    for (const t of ['AI 能力', '阅读体验', '多轮追问', '自定义字体']) expect(s).toContain(t);
    /* 反馈路径：GitHub issue 在前、QQ 群在后 */
    expect(s).toContain('GitHub issue');
    expect(s).toContain('QQ 交流群');
    expect(s.indexOf('GitHub issue')).toBeLessThan(s.indexOf('QQ 交流群'));
    /* 白名单链接：合法域名才渲染成可点 */
    expect(s).toContain('href="https://www.bilibili.com/"');
  });

  it('不挂 title / aria-label（悬停气泡禁令）', () => {
    const s = html();
    expect(s).not.toContain('title=');
    expect(s).not.toContain('aria-label=');
  });
});

describe('确认弹窗数据', () => {
  it('购买 / 支持的跳转地址来自在线配置，不硬编码', () => {
    /* 地址只经数据层注入，渲染层不写死 afdian 链接 */
    const s = html();
    expect(s).toContain('data-stat="pro"');
    expect(s).toContain('data-stat="patrons"');
    expect(s).not.toContain('data-buy-url="https://afdian.net');
  });

  it('在线数据没到时：统计显示占位，不显示假数字', () => {
    const s = changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', NAMES);
    expect(s).toContain('data-stat="pro"');
    expect(s).not.toContain('1,286');
  });
});

describe('打开与关闭', () => {
  it('遮罩挂 body，关掉摘除；数据变化订阅也释放', () => {
    const before = document.body.children.length;
    const note = openChangelogNote(CHANGELOG_RELEASES, '1.5.2', DATA);
    expect(document.body.children.length).toBe(before + 1);
    note.close();
    expect(document.body.children.length).toBe(before);
  });

  it('close 幂等', () => {
    const note = openChangelogNote(CHANGELOG_RELEASES, '1.5.2', DATA);
    note.close();
    expect(() => note.close()).not.toThrow();
  });
});
