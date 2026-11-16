/* ============================================================
 * bz-reader · 扫描页的透明文字层（engine/pdf/ocr-layer.ts）
 *
 * 把识别出来的「一行一个框」铺成和 pdf.js 文字层同样结构的 DOM：
 * 绝对定位的 `<span>`，字是透明的，但能被选中、能被 Range 量出矩形。
 * 视觉上完全看不出来，用起来和文字版一样——这层就是「扫描版能划词」的全部实现。
 *
 * 四个必须做对的点：
 *  1. **基准是文字层容器本身**：容器 `inset: 0` 铺满页框，画布也是铺满页框的。
 *     所以 span 一律按容器的 clientWidth/clientHeight 摆，外部算出来的页面尺寸
 *     只在容器还没上屏时兜底。以前按渲染时算的 viewport 摆，页框尺寸一旦和它
 *     不同步（切缩放、双页、重排、重绘中途），整层字就会按比例整体错位，越往
 *     页下方偏得越多——真机上是「高亮条比字高半行，还越往下越偏」。
 *  2. **盒子尺寸写死**：left/top/width/height 全部按归一化比例乘基准尺寸。
 *     这样 `normRects` 拿 span 的 `getBoundingClientRect()` 反算出来的矩形，
 *     与识别时的框严格一致，划线和搜索高亮就不会偏。
 *  3. **宽度要拉伸到框宽**：每行字的自然排版宽度和识别框几乎不可能一样。
 *     不拉的话，拖动选字时落点按字形排，会少选/多选半行，整行高亮也盖不住
 *     行尾几个字；拉一下（scaleX）字宽就与画面上的字对齐了。pdf.js 同样这么干。
 *     注意**不能拿 scrollWidth 当自然宽**：绝对定位且已经写死 width 的 span，
 *     scrollWidth 就是框宽本身，比例永远算成 1，拉伸一步等于没做（2026-11-15 修）。
 *  4. **跟着页面旋转**：识别框存的是「未旋转页面坐标」，渲染时要按当前角度
 *     转一次（与划线、框选、反链同一套 rotateNormRect）。
 * ============================================================ */

import { rotateNormRect, type PdfRectArea } from './locator';
import { orderOcrLines, type OcrPage } from './ocr';

export interface OcrLayerBox {
  /** 页面在屏幕上的 CSS 宽高（已含缩放与旋转）；只作容器量不到时的兜底 */
  width: number;
  height: number;
}

/** 一行的像素几何（左上原点，单位 px） */
export interface OcrLinePlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 旋转角只认 0 / 90 / 180 / 270 的整数倍（和视图层同一口径） */
function normDeg(deg: number): number {
  const d = (((Math.round((Number(deg) || 0) / 90) * 90) % 360) + 360) % 360;
  return d;
}

/**
 * 这一层该按什么尺寸摆。
 *
 * 优先量容器自己：`inset: 0` 让它与页框同宽高，而画布也是铺满页框的，
 * 两者天然同一个基准。容器还没挂进 DOM 时 clientWidth/clientHeight 为 0，
 * 才退回调用方算出来的 viewport 尺寸。
 */
export function ocrLayerBox(
  container: Pick<HTMLElement, 'clientWidth' | 'clientHeight'> | null | undefined,
  fallback: OcrLayerBox | null | undefined,
): OcrLayerBox {
  const positive = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  const measuredW = positive(container?.clientWidth);
  const measuredH = positive(container?.clientHeight);
  return {
    width: measuredW || positive(fallback?.width) || 1,
    height: measuredH || positive(fallback?.height) || 1,
  };
}

/** 一行识别框 → 像素几何（旋转与尺寸换算都收在这里，便于单测） */
export function ocrLinePlacement(rect: PdfRectArea, rotation: number, box: OcrLayerBox): OcrLinePlacement {
  const deg = normDeg(rotation);
  const r = deg ? rotateNormRect(rect, deg) : rect;
  const width = Math.max(1, box?.width || 1);
  const height = Math.max(1, box?.height || 1);
  return {
    left: r.left * width,
    top: r.top * height,
    width: Math.max(1, r.width * width),
    height: Math.max(1, r.height * height),
  };
}

/** 一行字要横向拉伸多少；量不到自然宽 / 框宽就不拉，别把字拉飞 */
export function lineScaleX(natural: number, target: number): number {
  if (!(natural > 0) || !(target > 0) || !Number.isFinite(natural) || !Number.isFinite(target)) return 1;
  const scale = target / natural;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 把一页的识别结果铺进文字层容器（会先清空）。
 *
 * `container` 必须是页面里的 `.textLayer`：视图层的「这页有没有字可选」
 * 判的就是它的子元素数量，铺进来之后拖动自动从「框选」变成「划词」。
 */
export function paintOcrTextLayer(
  container: HTMLElement,
  ocr: OcrPage,
  box: OcrLayerBox,
  rotation: number,
): void {
  container.replaceChildren();
  if (!ocr?.layout || !ocr.lines?.length) return;
  const base = ocrLayerBox(container, box);
  const frag = createFragment();
  /* 每行自己的量（位置、框高、字号）必须内联写；绝对定位、`pre`、透明字、
     可选中这些静态规则由 `.bzr-pdf-page .textLayer span` 兜住。
     宽度这一步**先不写**：要量自然宽，就得让 `width: max-content` 那条
     类规则生效（内联宽度会压过它，事后再补内联框宽）。 */
  const targets: number[] = [];
  for (const line of orderOcrLines(ocr.lines)) {
    if (!line.rect) continue;
    const p = ocrLinePlacement(line.rect, rotation, base);
    const span = createSpan();
    span.className = 'bzr-ocr-line';
    span.textContent = line.text;
    span.style.left = `${p.left}px`;
    span.style.top = `${p.top}px`;
    span.style.height = `${p.height}px`;
    span.style.fontSize = `${p.height}px`;
    targets.push(p.width);
    frag.appendChild(span);
  }
  container.appendChild(frag);
  /* 宽度对齐要等节点进树之后测：没挂上去的元素量不出内容宽度。
     一页只强制重排一次：一次性量完所有行的自然宽，再逐行写回框宽。
     只做横向拉伸——纵向由 font-size = 框高保证。 */
  const spans = Array.from(container.querySelectorAll<HTMLElement>('.bzr-ocr-line'));
  const naturals = spans.map((span) => span.getBoundingClientRect().width || span.offsetWidth || 0);
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    const target = targets[i];
    span.style.width = `${target}px`;
    const scale = lineScaleX(naturals[i], target);
    if (Math.abs(scale - 1) > 0.01) span.style.transform = `scaleX(${scale})`;
  }
}
