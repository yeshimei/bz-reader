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
 * 桌面与手机共用一条正文内视图（日志 / 路线图 / 功能建议 / 问题反馈），
 * 数据来自在线配置（可注入）。
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
  feedback: [
    { key: 'bug', items: [
      { id: 'fb1', source: 'qq-group', summary: '导入 EPUB 卡在 90%', title: 'EPUB 导入卡住', desc: '停在 90% 不动。', href: '', submittedAt: '2026-11-18', doneAt: '' },
    ] },
    { key: 'feature', items: [
      { id: 'fb2', source: 'github-issue', summary: '希望图片放大', title: '图片放大', desc: '点击放大内置图片。', href: 'https://github.com/yeshimei/bz-reader/issues/3', submittedAt: '2026-11-10', doneAt: '2026-11-15' },
    ] },
  ],
  stats: { reward: 456, pro: 1286, patrons: 328 },
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

  it('三个入口（路线图 / 功能建议 / 问题反馈）两端各一份，带条数角标', () => {
    const s = html();
    // 3 个入口 × 桌面/手机 2 套
    for (const key of ['roadmap', 'feature', 'bug']) {
      expect([...s.matchAll(new RegExp(`data-view-btn="${key}"`, 'g'))]).toHaveLength(2);
    }
    /* 角标数字：路线图 2 项 / 功能建议 1 项 / 问题反馈 1 项 */
    expect([...s.matchAll(/class="bzs-chgn-tooln">2</g)]).toHaveLength(2);
    expect([...s.matchAll(/class="bzs-chgn-tooln">1</g)]).toHaveLength(4);
  });

  it('带 issue 的日志条目后有 #N 链接，指向 GitHub', () => {
    const s = html();
    expect(s).toContain('href="https://github.com/yeshimei/bz-reader/issues/2"');
    expect(s).toContain('#2 ↗');
  });

  it('路线图不再是侧栏 / 全屏，改成正文内切换：两端各一份视图容器', () => {
    const s = html();
    expect([...s.matchAll(/class="bzs-chgn-views"/g)]).toHaveLength(2);
    /* 桌面与手机默认都在日志页 */
    expect([...s.matchAll(/data-view="log"/g)]).toHaveLength(2);
    /* 旧的抽屉 / 手机全屏容器已删干净 */
    expect(s).not.toContain('bzs-chgn-drawer');
    expect(s).not.toContain('bzs-chgn-mrm');
  });

  it('视图容器里都渲染两级路线图', () => {
    const s = html();
    for (const t of ['AI 能力', '阅读体验', '多轮追问', '自定义字体']) expect(s).toContain(t);
    /* 白名单链接：合法域名才渲染成可点 */
    expect(s).toContain('href="https://www.bilibili.com/"');
  });

  it('三个入口都在正文顶部，各配一个正文内视图页', () => {
    const s = html();
    // 桌面正文 + 手机正文各一份入口 / 一份视图页
    for (const key of ['roadmap', 'feature', 'bug']) {
      expect([...s.matchAll(new RegExp(`data-view-btn="${key}"`, 'g'))]).toHaveLength(2);
      expect([...s.matchAll(new RegExp(`data-view-page="${key}"`, 'g'))]).toHaveLength(2);
    }
    // 入口不再另开页签条 / 抽屉
    expect(s).not.toContain('data-rm-tab-btn');
    expect(s).not.toContain('data-rm-tab=');
  });

  it('反馈只留主标题 + 描述，不再显示摘要副标题；两态与日期保留', () => {
    const s = html();
    expect(s).toContain('EPUB 导入卡住');
    expect(s).toContain('图片放大');
    expect(s).not.toContain('希望图片放大');
    expect(s).toContain('待办');
    expect(s).toContain('已完成');
    expect(s).toContain('2026.11.10');
    expect(s).toContain('2026.11.15');
    expect(s).toContain('href="https://github.com/yeshimei/bz-reader/issues/3"');
  });

  it('不挂 title / aria-label（悬停气泡禁令）', () => {
    const s = html();
    expect(s).not.toContain('title=');
    expect(s).not.toContain('aria-label=');
  });
});

describe('反馈三态：待办 / 已完成 / 否决', () => {
  const THREE: BzrData = {
    ...DATA,
    roadmap: [],
    feedback: [
      { key: 'bug', items: [] },
      { key: 'feature', items: [
        { id: 'todo', source: 'github-issue', summary: 's', title: '还没做', desc: '', href: '', submittedAt: '2026-11-18', doneAt: '' },
        { id: 'done', source: 'github-issue', summary: 's', title: '做完了', desc: '', href: '', submittedAt: '2026-11-10', doneAt: '2026-11-15' },
        { id: 'rej', source: 'github-issue', summary: 's', title: '朗读接入 Edge TTS', desc: '', href: '', submittedAt: '2026-11-18', doneAt: '', rejectedAt: '2026-11-18' },
      ] },
    ],
  };

  it('被否决的：状态写「否决」、圆点与状态片挂 rejected，日期行带否决日', () => {
    const s = changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', NAMES, THREE);
    expect(s).toContain('bzs-chgn-fbdot rejected');
    expect(s).toContain('bzs-chgn-fbstate rejected">否决<');
    expect(s).toContain('→ 否决 2026.11.18');
    /* 另外两条仍是原来的两态，没被带跑 */
    expect(s).toContain('bzs-chgn-fbstate todo">待办<');
    expect(s).toContain('bzs-chgn-fbstate done">已完成<');
  });

  it('路线图清空后：入口角标是 0，面板显示空态而不是空白', () => {
    const s = changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', NAMES, THREE);
    expect(s).toContain('class="bzs-chgn-tooln">0<');
    expect(s).toContain('路线图暂无条目');
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
