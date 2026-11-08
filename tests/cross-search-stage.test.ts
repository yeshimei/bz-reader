import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crossSearchStage, disposeCrossSearchStage } from '../src/engine/cross-search';
import { installDomStub } from './helpers/dom-stub';

/* ============================================================
 * 跨书搜索的离屏舞台（fix/release-hygiene，P2-07）。
 *
 * 原来每扫一本书就 createDiv + appendChild(document.body) + remove()，
 * 搜索途中卸载插件会把没走完 finally 的那个留在 body 上。现在整轮、
 * 乃至连续几轮共用一个节点，卸载时一次摘干净。
 * ============================================================ */

let off: () => void;
const g = globalThis as unknown as Record<string, unknown>;
let prevCreateDiv: unknown;
let hadCreateDiv = false;

beforeAll(() => {
  off = installDomStub();
  /* 插件里的 createDiv 是 Obsidian 的全局助手，桩里只补了 createEl */
  hadCreateDiv = 'createDiv' in g;
  prevCreateDiv = g.createDiv;
  g.createDiv = () => document.createElement('div');
});

afterAll(() => {
  disposeCrossSearchStage();
  if (hadCreateDiv) g.createDiv = prevCreateDiv;
  else delete g.createDiv;
  off();
});

describe('crossSearchStage', () => {
  it('多次取用是同一个节点：不会每本书往 body 里挂一个', () => {
    const a = crossSearchStage();
    const b = crossSearchStage();
    expect(a).toBe(b);
    expect(a.className).toBe('bzr-xs-stage');
  });

  it('dispose 之后能重新建，且旧节点已经脱离文档', () => {
    const old = crossSearchStage();
    disposeCrossSearchStage();
    expect((old as unknown as { parent: unknown }).parent).toBeNull();

    const fresh = crossSearchStage();
    expect(fresh).not.toBe(old);
    expect((fresh as unknown as { parent: unknown }).parent).not.toBeNull();
  });
});
