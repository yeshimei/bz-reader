/**
 * 剪藏本空库提醒弹窗（src/shell/clip-empty-dialog.ts）。
 *
 * 两段：正文的纯函数（文案走 i18n、两个出口的 data-role 固定），
 * 以及挂载/收口（开得起来、关得掉、连开两层只留一层）。
 * 版式与按钮位置走真机，仓库里不测布局。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { setLocale } from '../src/i18n';
import { clipEmptyHtml, openClipEmptyDialog } from '../src/shell/clip-empty-dialog';

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

describe('正文', () => {
  it('两个出口都在，各带固定 data-role', () => {
    const html = clipEmptyHtml();
    expect(html).toContain('data-role="clipempty-settings"');
    expect(html).toContain('data-role="clipempty-tutorial"');
    expect(html).toContain('去设置');
    expect(html).toContain('看教程');
  });

  it('说清为什么是空的，不只是一句「空的」', () => {
    const html = clipEmptyHtml();
    expect(html).toContain('剪藏成书');
    expect(html).toContain('订阅源');
  });

  it('主操作是实心钮，次操作是描边钮', () => {
    const html = clipEmptyHtml();
    expect(html).toMatch(/class="bzr-btn is-primary" type="button" data-role="clipempty-settings"/);
    expect(html).toMatch(/class="bzr-btn" type="button" data-role="clipempty-tutorial"/);
  });

  it('文案跟语言包走，不写死中文', () => {
    setLocale('en');
    const html = clipEmptyHtml();
    expect(html).toContain('Open settings');
    expect(html).toContain('Watch tutorial');
    expect(html).not.toContain('去设置');
  });
});

describe('挂载与收口', () => {
  it('挂到 body 上，关掉之后摘除', () => {
    const before = document.body.children.length;
    const close = openClipEmptyDialog({ settings: () => undefined, tutorial: () => undefined });
    expect(document.body.children.length).toBe(before + 1);
    close();
    expect(document.body.children.length).toBe(before);
  });

  it('连开两层只留一层：后开的把前一层收掉', () => {
    const before = document.body.children.length;
    const first = openClipEmptyDialog({ settings: () => undefined, tutorial: () => undefined });
    const second = openClipEmptyDialog({ settings: () => undefined, tutorial: () => undefined });
    expect(document.body.children.length).toBe(before + 1);
    second();
    expect(document.body.children.length).toBe(before);
    /* 旧的句柄再调一次也不该把已经关掉的层数算错 */
    first();
    expect(document.body.children.length).toBe(before);
  });
});
