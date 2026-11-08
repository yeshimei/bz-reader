import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 分页器 vendor 的调试埋点守卫。
 *
 * 这些埋点是排查「划词时页面跳到固定位置」的唯一现场来源。2026-11-08 从
 * 四条细到十三条：位置写入（scrollTo）、翻页（pageTurn）、吸附（snap）、
 * 重排（render）、换章（chapter）、原始选区（selRaw）、拖选（selDrag）、
 * 抬手判定（touchEnd）、原生滚动（scrollSel）——删掉任何一条，真机日志
 * 就会缺一段因果。
 *
 * 升级 foliate 或重装依赖把补丁冲掉时，这条会先红。 */
const PAGINATOR = new URL('../node_modules/foliate-js/paginator.js', import.meta.url);
const src = readFileSync(PAGINATOR, 'utf8');

const KEYS = [
  'focusin',
  'anchor',
  'goTo',
  'afterScroll',
  'scrollTo',
  'pageTurn',
  'snap',
  'render',
  'chapter',
  'selRaw',
  'selDrag',
  'touchEnd',
  'scrollSel',
];

describe('paginator 调试埋点', () => {
  it('十三条关键路径都接上了全局钩子', () => {
    for (const key of KEYS) {
      expect(src).toContain(`__bzrDbg?.('${key}'`);
    }
  });
});
