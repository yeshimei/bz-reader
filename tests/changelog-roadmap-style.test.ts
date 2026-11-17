import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDomStub } from './helpers/dom-stub';
import { CHANGELOG_RELEASES } from '../src/shell/changelog';
import { changelogNoteHtml } from '../src/shell/changelog-note';
import type { BzrData } from '../src/data/bzr-data';

/* ============================================================
 * 路线图弹窗的样式契约（真机截图反馈后的回归）
 *
 * 1) 路线图 / 功能建议 / 问题反馈 是正文内视图，靠 data-view 切换；
 * 2) 状态筛选第一颗是「全部」，不是「用户反馈」；
 * 3) 确认弹窗有独立 reset，不吃宿主 button 样式。
 * 只测 HTML 结构 / CSS 文本约定，不测真实布局（项目没装 jsdom）。
 * ============================================================ */

const DATA: BzrData = {
  version: 1, updatedAt: '2026-11-18',
  changelog: [{ version: '1.5.2', date: '2026-11-17', improved: [
    { domain: { zh: 'x', en: 'x' }, text: { zh: 'y', en: 'y' } },
  ] }],
  roadmap: [{ theme: 't', color: '#fff', order: 1, items: [
    { title: 'i', state: 'doing', src: 'builtin', fb: { kind: 'issue', n: 1, label: '#1', href: '' } },
  ] }],
  stats: { reward: 3, pro: 1, patrons: 2 },
  links: { support: 'https://afdian.net/a/x', buy: 'https://afdian.net/a/x' },
};

let uninstall = () => undefined as void;
beforeAll(() => { uninstall = installDomStub(); });
afterAll(() => { uninstall(); });

describe('路线图弹窗结构与样式契约', () => {
  const html = changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', [], DATA);

  it('不再有状态筛选栏（2026-11-18 作者要求删掉）', () => {
    expect(html).not.toContain('data-f="');
    expect(html).not.toContain('bzs-chgn-rmfilters');
    const css = readFileSync('src/shell/styles/changelog-roadmap.css', 'utf8');
    expect(css).not.toContain('rmfilters');
  });

  it('不渲染搜索框，也不渲染底部来源说明', () => {
    expect(html).not.toContain('data-rm-search');
    expect(html).not.toContain('bzs-chgn-rmfoot');
    expect(html).not.toContain('本地缓存 6 小时');
  });

  it('正文内切换视图：日志与三个视图页互斥，靠容器上的 data-view 显隐', () => {
    expect(html).toContain('data-view="log"');
    const css = readFileSync('src/shell/styles/changelog-roadmap.css', 'utf8');
    /* 切到路线图：正文日志藏起来、视图容器露出来 */
    expect(css).toMatch(/\.bzs-chgn\[data-view="roadmap"\] \.bzs-chgn-wrap/);
    expect(css).toMatch(/\.bzs-chgn-view\[data-view-page="bug"\]/);
    /* 桌面 / 手机两套都要覆盖 */
    expect(css).toMatch(/\.bzs-chgn-m\[data-view="feature"\] \.bzs-chgn-mpage/);
    /* 旧的抽屉与手机全屏容器不留死样式 */
    expect(css).not.toContain('.bzs-chgn-drawer');
    expect(css).not.toContain('.bzs-chgn-mrm');
  });

  it('反馈是双列卡片网格，路线图主题是卡片、条目在卡内（2026-11-18 定稿）', () => {
    const css = readFileSync('src/shell/styles/changelog-roadmap.css', 'utf8');
    /* 反馈：网格 + 自动列宽，桌面两列、窄屏自己回落单列 */
    expect(css).toMatch(/\.bzs-chgn-fblist\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.bzs-chgn-fblist\{[^}]*grid-template-columns:\s*repeat\(auto-fill/);
    expect(css).toMatch(/\.bzs-chgn-fbit\{[^}]*border:/);
    /* 路线图：主题整块是卡片，条目在 .rmitems 里排 */
    expect(css).toMatch(/\.bzs-chgn-rmtheme\{[^}]*border:/);
    expect(css).toMatch(/\.bzs-chgn-rmtheme\{[^}]*overflow:\s*hidden/);
  });

  it('状态点与标题同一行垂直居中：不再用 margin-top 目测对位', () => {
    const css = readFileSync('src/shell/styles/changelog-roadmap.css', 'utf8');
    /* 两套头行（反馈 / 路线图）都是 flex 居中 */
    expect(css).toMatch(/\.bzs-chgn-fbhd\{[^}]*display:\s*flex[^}]*align-items:\s*center/);
    expect(css).toMatch(/\.bzs-chgn-rmhd\{[^}]*display:\s*flex[^}]*align-items:\s*center/);
    /* 点本身不许再带 margin-top：那是上一版对不齐的根因 */
    expect(css).not.toMatch(/\.bzs-chgn-(?:dot|fbdot)\{[^}]*margin-top/);
  });

  it('确认弹窗 1:1 照原型：挂 body、样式自带 reset', () => {
    /* 弹窗挂 body，不在 changelogNoteHtml 里；样式契约从 CSS 断言 */
    expect(html).not.toContain('bzs-chgn-confirm-box');
    const css = readFileSync('src/shell/styles/changelog-roadmap.css', 'utf8');
    expect(css).toContain('.bzs-chgn-confirm-box');
    expect(css).toContain('.bzs-chgn-confirm-acts button');
  });
});
