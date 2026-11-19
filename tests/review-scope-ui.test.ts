import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 真机走查 2026-11-20：书右键「加入复习」的第一屏在 loadStatus() 查完
 * 「已加过几条划线」后会重画一次。renderScopePick() 不清内容，于是用户
 * 看到两屏卡片叠在一起（第三屏是重复打开时的第三份）。
 */
const source = readFileSync(new URL('../src/shell/review-add.ts', import.meta.url), 'utf8');

describe('加入复习 · 范围选择屏重画', () => {
  it('renderScopePick 每次都先清空内容，旧卡片不留存', () => {
    const at = source.indexOf('private renderScopePick(el: HTMLElement): void {');
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, at + 900);
    expect(body).toContain('el.empty();');
    expect(body.indexOf('el.empty();')).toBeLessThan(body.indexOf('const newMarks'));
  });
});
