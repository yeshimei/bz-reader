import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { CHANGELOG_RELEASES } from '../src/shell/changelog';
import { changelogNoteHtml } from '../src/shell/changelog-note';
import type { BzrData } from '../src/data/bzr-data';

/* ============================================================
 * 更新日志样式 v2（真机截图反馈）
 * 1) 统计卡三张：打赏 / 高级用户 / 赞助人，打赏来自在线数据
 * 2) 去掉路线图顶部的「用户反馈」整块
 * 3) 确认弹窗自带颜色变量（不依赖 .bzs-chgn 内的 --chg-*）
 * ============================================================ */

const DATA: BzrData = {
  version: 1, updatedAt: '2026-11-18',
  changelog: [{ version: '1.5.2', date: '2026-11-17', improved: [
    { domain: { zh: 'x', en: 'x' }, text: { zh: 'y', en: 'y' } },
  ] }],
  roadmap: [{ theme: 't', color: '#fff', order: 1, items: [
    { title: 'i', state: 'doing', src: 'builtin', fb: { kind: 'issue', n: 1, label: '#1', href: '' } },
  ] }],
  stats: { reward: 456, pro: 1286, patrons: 328 },
  links: { support: 'https://afdian.net/a/x', buy: 'https://afdian.net/a/x' },
};

let uninstall = () => undefined as void;
beforeAll(() => { uninstall = installDomStub(); });
afterAll(() => { uninstall(); });

const html = changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', [], DATA);

describe('统计卡', () => {
  it('三张卡：打赏在最前，后面是高级用户、赞助人（两端各一份）', () => {
    expect(html).toContain('data-stat="reward"');
    expect(html).toContain('data-stat="pro"');
    expect(html).toContain('data-stat="patrons"');
    expect([...html.matchAll(/data-stat="reward"/g)]).toHaveLength(2);
    const first = html.indexOf('data-stat="reward"');
    expect(first).toBeLessThan(html.indexOf('data-stat="pro"'));
    expect(html).toContain('6'); // 固定值 PIN_REWARD（随版本发版更新），不读在线 stats
  });
});

describe('正文顶部工具条', () => {
  it('旧反馈路径整块移除，三张统计与三个入口挤进同一条工具条', () => {
    expect(html).not.toContain('bzs-chgn-fbpath');
    expect(html).not.toContain('data-copy-qq');
    /* 桌面那条工具条：左边统计，右边三个视图入口 */
    const bar = html.slice(html.indexOf('bzs-chgn-toolbar'), html.indexOf('bzs-chgn-wrap'));
    expect(bar).toContain('data-stat="reward"');
    for (const key of ['roadmap', 'feature', 'bug']) {
      expect(bar).toContain(`data-view-btn="${key}"`);
    }
  });
});

describe('确认弹窗', () => {
  it('自带背景色变量，不依赖 .bzs-chgn 内的 --chg-*', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const css = fs.readFileSync('src/shell/styles/changelog-roadmap.css', 'utf8');
    /* 确认弹窗自己定义 --cc-* 局部令牌（面板色/文字色/强调色） */
    expect(css).toMatch(/\.bzs-chgn-confirm\s*\{[^}]*--cc-panel/);
    expect(css).toContain('.bzs-chgn-confirm-box');
    expect(css).toMatch(/\.bzs-chgn-confirm-box\s*\{[^}]*background:var\(--cc-panel/);
  });
});
