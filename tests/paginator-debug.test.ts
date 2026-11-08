import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 分页器 vendor 的调试埋点守卫。
 *
 * 这些埋点是排查「划词时页面跳到固定位置」的唯一现场来源：focusin 记谁
 * 拿走了焦点，anchor 记哪条路要求滚动，goTo 记换章节，afterScroll 记位置
 * 变化。删掉任何一条，真机日志就会缺一段因果。
 *
 * 升级 foliate 或重装依赖把补丁冲掉时，这条会先红。 */
const PAGINATOR = new URL('../node_modules/foliate-js/paginator.js', import.meta.url);
const src = readFileSync(PAGINATOR, 'utf8');

describe('paginator 调试埋点', () => {
  it('四条关键路径都接上了全局钩子', () => {
    for (const key of ['focusin', 'anchor', 'goTo', 'afterScroll']) {
      expect(src).toContain(`__bzrDbg?.('${key}'`);
    }
  });
});
