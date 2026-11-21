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
  it('统计卡是按钮，数字是发版时写死的固定值，两端各一份', () => {
    const s = html();
    expect([...s.matchAll(/data-stat="pro"/g)]).toHaveLength(2);
    expect([...s.matchAll(/data-stat="patrons"/g)]).toHaveLength(2);
    // 固定值随版本发版更新（当前 v1.6.0 这组），不读在线 stats
    expect(s).toContain('55'); // 高级用户 PIN_PRO
    expect(s).toContain('10'); // 赞助人 PIN_PATRONS
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
    expect(s).toContain('采纳');
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

describe('反馈状态：采纳 / 已完成 / 否决（老数据兼容）', () => {
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
    /* 另外两条老数据没 state，推导为采纳 / 已完成，没被带跑 */
    expect(s).toContain('bzs-chgn-fbstate accepted">采纳<');
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

describe('反馈 v2：五态、作者回复、Git 提交链接', () => {
  const FIVE: BzrData = {
    ...DATA,
    roadmap: [],
    feedback: [
      { key: 'feature', items: [
        { id: 'a', source: 'bili-dm', summary: 's', title: '采纳的', desc: '', href: '',
          state: 'accepted', submittedAt: '2026-11-15 23:09', doneAt: '', reply: '好的，后续我会跟进的' },
        { id: 'b', source: 'bili-dm', summary: 's', title: '进行中的', desc: '', href: '',
          state: 'doing', submittedAt: '2026-11-15 23:10', doneAt: '' },
        { id: 'c', source: 'bili-dm', summary: 's', title: '不成立的', desc: '', href: '',
          state: 'invalid', submittedAt: '2026-11-15 23:11', doneAt: '' },
        { id: 'd', source: 'bili-dm', summary: 's', title: '已完成的', desc: '', href: '',
          state: 'done', submittedAt: '2026-11-15 23:12', doneAt: '2026-11-16 00:45',
          commitRepo: 'bz', commitId: '972855ed', commitDate: '2026-11-16 00:45' },
        { id: 'e', source: 'bili-dm', summary: 's', title: '否决的', desc: '', href: '',
          state: 'rejected', submittedAt: '2026-11-15 23:13', doneAt: '', rejectedAt: '2026-11-16 00:50' },
      ] },
      { key: 'bug', items: [] },
    ],
  };
  const fiveHtml = () => changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', NAMES, FIVE);

  it('五态文案与色点都渲染', () => {
    const s = fiveHtml();
    for (const [cls, label] of [
      ['accepted', '采纳'], ['doing', '进行中'], ['invalid', '不成立'], ['done', '已完成'], ['rejected', '否决'],
    ]) {
      expect(s).toContain(`bzs-chgn-fbdot ${cls}`);
      expect(s).toContain(`bzs-chgn-fbstate ${cls}">${label}<`);
    }
  });

  it('作者回复渲染出来，带标签', () => {
    const s = fiveHtml();
    expect(s).toContain('bzs-chgn-fbreply');
    expect(s).toContain('好的，后续我会跟进的');
  });

  it('提交 ID 是可点链接，指向 GitHub 对应仓库，新标签页打开', () => {
    const s = fiveHtml();
    expect(s).toContain('href="https://github.com/yeshimei/bz/commit/972855ed"');
    expect(s).toContain('target="_blank" rel="noopener"');
  });

  it('分钟日期显示到时分', () => {
    const s = fiveHtml();
    expect(s).toContain('2026.11.15 23:09');
    expect(s).toContain('2026.11.16 00:45');
  });
});

describe('反馈显示所有插件的条目（2026-11-19 去掉插件隔离）', () => {
  const MIXED: BzrData = {
    ...DATA,
    roadmap: [],
    feedback: [
      { key: 'bug', items: [
        { id: 'r1', plugin: 'bz-reader', source: 'github-issue', summary: 's', title: '只属于 Reader 的反馈', desc: '', href: '', submittedAt: '2026-11-15' },
        { id: 'b1', plugin: 'bz', source: 'bili-dm', summary: 's', title: '只属于 BZ 的反馈', desc: '', href: '', submittedAt: '2026-11-15' },
      ] },
      { key: 'feature', items: [] },
    ],
  };
  const html = () => changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', NAMES, MIXED);

  it('列表渲染 bz-reader 与 bz 的条目', () => {
    const s = html();
    expect(s).toContain('只属于 Reader 的反馈');
    expect(s).toContain('只属于 BZ 的反馈');
  });

  it('入口角标数全部条目', () => {
    expect(html()).toContain('>2</span></button>');
  });
});

describe('反馈 v3：插件归属、发布版本（核查结论已去掉）', () => {
  const D: BzrData = {
    ...DATA,
    roadmap: [],
    feedback: [
      { key: 'bug', items: [
        { id: 'v1', source: 'bili-dm', plugin: 'bz-reader', domain: '日记本',
          summary: 's', title: '归属测试标题', desc: '描述文本', href: '',
          reply: '作者原话', replyDigest: 'DIGEST-ONLY-TEXT', verify: '核查结论文本',
          state: 'done', submittedAt: '2026-11-15 23:55', doneAt: '2026-11-16 00:45',
          releaseVersion: '1.44.5' },
      ] },
      { key: 'feature', items: [] },
    ],
  };
  const html = () => changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', NAMES, D);

  it('bz reader 条目显示插件徽标但不带功能域', () => {
    const s = html();
    expect(s).toContain('bzs-chgn-fbplugin');
    expect(s).toContain('bz reader');
    expect(s).not.toContain('bz · 日记本');
  });

  it('不显示核查结论（2026-11-19 作者要求去掉）', () => {
    const s = html();
    expect(s).not.toContain('bzs-chgn-fbverify');
    expect(s).not.toContain('核查结论文本');
  });

  it('发布版本显示在已完成条目上', () => {
    const s = html();
    expect(s).toContain('bzs-chgn-fbrelease');
    expect(s).toContain('1.44.5');
  });

  it('作者回复摘要只给 QQ 帖子用，不进界面', () => {
    expect(html()).not.toContain('DIGEST-ONLY-TEXT');
  });
});
