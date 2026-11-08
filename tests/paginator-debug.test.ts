import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 分页器 vendor 的守卫：调试埋点 + 「跨页选择完全禁止」。
 *
 * 埋点是排查「划词时页面跳到固定位置」的唯一现场来源。2026-11-08 从四条
 * 细到十三条：位置写入（scrollTo）、翻页（pageTurn）、吸附（snap）、重排
 * （render）、换章（chapter）、原始选区（selRaw）、拖选（selDrag）、抬手
 * 判定（touchEnd）、原生滚动（scrollSel）、吸回（snapBack）——删掉任何
 * 一条，真机日志就会缺一段因果。
 *
 * 同一天定稿：上游的「拖选越界自动翻页」整段删掉（真机日志里两次跳章都是
 * 它），粗指针拖选时把容器吸回整页（页面完全不动）。
 *
 * 升级 foliate 或重装依赖把补丁冲掉时，这几条会先红。 */
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
  'snapBack',
  'snapGo',
  'turnPage',
];

describe('paginator 调试埋点', () => {
  it('十四条关键路径都接上了全局钩子', () => {
    for (const key of KEYS) {
      expect(src).toContain(`__bzrDbg?.('${key}'`);
    }
  });
});

describe('paginator 跨页行为', () => {
  it('边缘自动翻页已经删干净', () => {
    expect(src).not.toContain('checkPointerSelection');
    expect(src).not.toContain('isPointerSelecting');
  });

  it('粗指针拖选把容器吸回整页', () => {
    expect(src).toContain("(pointer: coarse)");
    expect(src).toContain('this.containerPosition = snapped');
  });

  it('有选区时触摸移动不让浏览器滚容器', () => {
    const at = src.indexOf("globalThis.__bzrDbg?.('selDrag'");
    expect(at).toBeGreaterThan(0);
    /* preventDefault 必须紧挨着 selDrag 那一段之前（同一分支里） */
    expect(src.slice(Math.max(0, at - 400), at)).toContain('e.preventDefault()');
  });
});
