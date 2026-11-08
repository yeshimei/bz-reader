import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 分页器 vendor 的守卫：调试埋点 + 「跨页选择完全禁止」+ 拖选锁。
 *
 * 埋点是排查「划词时页面跳到固定位置」的唯一现场来源。2026-11-08 从四条
 * 细到十五条：位置写入（scrollTo）、翻页（pageTurn）、吸附（snap）、重排
 * （render）、换章（chapter）、原始选区（selRaw）、拖选（selDrag）、抬手
 * 判定（touchEnd）、原生滚动（scrollSel）、拦截（freeze）——删掉任何一条，
 * 真机日志就会缺一段因果。
 *
 * 同一天定稿：上游的「拖选越界自动翻页」整段删掉（真机日志里两次跳章都是
 * 它）；浏览器为把选区滚进视野而动的 scrollLeft 一律锁回按下那一刻的位置。
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
  'freeze',
  'iframeScroll',
  'relocate',
  'setSel',
  'snapGo',
  'turnPage',
];

describe('paginator 调试埋点', () => {
  it('十八条关键路径都接上了全局钩子', () => {
    for (const key of KEYS) {
      expect(src).toContain(`__bzrDbg?.('${key}'`);
    }
  });
});

describe('paginator 边缘自动翻页', () => {
  it('整段删干净，不留开关', () => {
    expect(src).not.toContain('checkPointerSelection');
    expect(src).not.toContain('isPointerSelecting');
  });
});

/* 拖选锁（2026-11-08 第三版）：社区同一个问题（foliate-js#84/#86、epub.js#1366）
 * 的通行解法——记下按下那一刻的容器位置，scroll 时同步写回。第一版吸回「最近
 * 的整页」，偏移过半页会吸到相邻页；第二版吸回「程序认定的页位置」，仍会横移
 * 一段再回来，用户看到的是闪。第三版改成精确像素，解锁改成延时。 */
describe('paginator 拖选锁', () => {
  it('锁的是精确像素位置，不再有任何「整页取整」的目标', () => {
    expect(src).toContain('this.#selFreezePos');
    expect(src).toContain('this.containerPosition = this.#selFreezePos');
    expect(src).not.toContain('#goodPos');
    expect(src).not.toContain('Math.round(pos / size) * size');
  });

  it('手指按下就上锁，覆盖手指拖选这一路', () => {
    const at = src.indexOf('#onTouchStart(e) {');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 500)).toContain('this.#lockSelectionScroll()');
  });

  it('选区出现也上锁、折叠才延时解锁，覆盖手柄拖动', () => {
    expect(src).toContain('#lockSelectionScroll() {');
    expect(src).toContain('#unlockSelectionScrollSoon(');
    const at = src.indexOf("globalThis.__bzrDbg?.('selRaw'");
    expect(at).toBeGreaterThan(0);
    const after = src.slice(at, at + 900);
    expect(after).toContain('this.#unlockSelectionScrollSoon()');
    expect(after).toContain('this.#lockSelectionScroll()');
  });

  it('程序滚动前先松开锁，落定后按选区状态重新锁回', () => {
    const scrollTo = src.indexOf('async #scrollTo(offset, reason, smooth) {');
    expect(scrollTo).toBeGreaterThan(0);
    expect(src.slice(scrollTo, scrollTo + 900)).toContain('this.#selFreezePos = null');
    const after = src.indexOf('#afterScroll(reason) {');
    expect(after).toBeGreaterThan(0);
    expect(src.slice(after, after + 1100)).toContain('this.#lockSelectionScroll()');
  });

  it('只拦粗指针上的原生滚动，已锁才写回', () => {
    expect(src).toContain("(pointer: coarse)");
    expect(src).toContain('if (this.#selFreezePos == null');
  });
});

describe('paginator 触摸手势', () => {
  it('手指压在选区上拖动直接拦下滚动，不靠写回', () => {
    const at = src.indexOf("globalThis.__bzrDbg?.('selDrag'");
    expect(at).toBeGreaterThan(0);
    /* 有选区那一段必须在 selDrag 之前 preventDefault：写回虽然能把位置
       拉回来，但每写一次 scrollLeft 都要重新合成，选区高亮跟着重绘——那
       正是「闪」。手指这一路是唯一能「根本不滚」的。 */
    expect(src.slice(Math.max(0, at - 500), at)).toContain('e.preventDefault()');
  });
});

/* 2026-11-08 第三轮：外层锁上之后页面不整页跳了，但用户报「闪的是选中
 * 文字覆盖的区域」。外层 #container 并不是离选区最近的可滚容器——正文
 * 自己的 viewport 才是，浏览器先滚它。它一滚，外层位置没变，只有正文
 * 内容连同选区高亮平移，看起来就是那一块在闪。 */
describe('paginator 正文 viewport 的滚动', () => {
  it('分页模式把根元素设成不可滚（overflow: clip），并留 hidden 兜底', () => {
    expect(src).toContain("supports?.('overflow', 'clip')");
    expect(src).toContain("'overflow': clipOverflow ? 'clip' : 'hidden'");
  });

  it('不支持 clip 的老 WebView 由 scroll 写回兜底，且每次都记日志', () => {
    expect(src).toContain("__bzrDbg?.('iframeScroll'");
    expect(src).toContain('se.scrollLeft = se.scrollTop = 0');
  });
});

/* 2026-11-08 第四轮：两层滚动都锁上之后仍然闪。真正会「闪」的不是位置，
 * 是选区本身被重设 / 页面被 re-anchor：
 *   - relocate 里的 setSelectionTo 走 removeAllRanges + addRange，高亮会
 *     消失一帧再出现；
 *   - focusin 在拖选期间无条件 re-anchor，把页面滚到焦点所在页，滚动锁再
 *     把它拉回来，一来一回就是闪；
 *   - expand 同理。
 * fork-weave 对这三处都加了「有非空选区就不做」的守卫，我们一处都没有。 */
describe('paginator 拖选期间不碰选区与锚点', () => {
  it('relocate 在有非空选区时不重设选区，并记日志', () => {
    const at = src.indexOf("this.addEventListener('relocate'");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 1400);
    expect(block).toContain("__bzrDbg?.('relocate'");
    expect(block).toContain('if (dragging) return');
  });

  it('focusin 在粗指针或已有选区时不 re-anchor', () => {
    const at = src.indexOf("doc.addEventListener('focusin'");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 1600);
    expect(block).toContain('#isCoarsePointer()');
    expect(block).toContain('!current.isCollapsed');
  });

  it('expand 在已有选区时不 re-anchor', () => {
    const at = src.indexOf('onExpand:');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 400)).toContain('!sel.isCollapsed');
  });
});
