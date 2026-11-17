import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { CHANGELOG_RELEASES } from '../src/shell/changelog';
import { changelogNoteHtml } from '../src/shell/changelog-note';
import type { BzrData } from '../src/data/bzr-data';

/* ============================================================
 * 路线图弹窗的样式契约（真机截图反馈后的回归）
 *
 * 1) 侧栏打开是靠「弹窗加宽」延伸，不是把正文挤窄；
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
  stats: { pro: 1, patrons: 2 },
  links: { support: 'https://afdian.net/a/x', buy: 'https://afdian.net/a/x' },
};

let uninstall = () => undefined as void;
beforeAll(() => { uninstall = installDomStub(); });
afterAll(() => { uninstall(); });

describe('路线图弹窗结构与样式契约', () => {
  const html = changelogNoteHtml(CHANGELOG_RELEASES, '1.5.2', [], DATA);

  it('状态筛选第一颗是「全部」（不是误用「用户反馈」文案）', () => {
    const m = /<button[^>]*data-f="all"[^>]*>([^<]*)<\/button>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('全部');
  });

  it('不渲染搜索框，也不渲染底部来源说明', () => {
    expect(html).not.toContain('data-rm-search');
    expect(html).not.toContain('bzs-chgn-rmfoot');
    expect(html).not.toContain('本地缓存 6 小时');
  });

  it('侧栏与正文分离：打开时给弹窗挂加宽类，而不是只挤 grid', () => {
    expect(html).toContain('data-rm-drawer');
    /* 加宽规则在独立样式文件里：.bzs-chgn-dialog.rm-wide */
    const fs = require('node:fs') as typeof import('node:fs');
    const css = fs.readFileSync('src/shell/styles/changelog-roadmap.css', 'utf8');
    expect(css).toContain('.bzs-chgn-dialog.rm-wide');
    expect(css).toContain('width:min(1060px');
  });

  it('确认弹窗带独立 reset 类，按钮不吃宿主默认高度', () => {
    expect(html).toContain('bzs-chgn-confirm-box');
    expect(html).toContain('bzs-chgn-confirm-acts');
    expect(html).toContain('data-confirm-ok');
  });
});
