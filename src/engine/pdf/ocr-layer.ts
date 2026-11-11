/* ============================================================
 * bz-reader · 扫描页的透明文字层（engine/pdf/ocr-layer.ts）
 *
 * 把识别出来的「一行一个框」铺成和 pdf.js 文字层同样结构的 DOM：
 * 绝对定位的 `<span>`，字是透明的，但能被选中、能被 Range 量出矩形。
 * 视觉上完全看不出来，用起来和文字版一样——这层就是「扫描版能划词」的全部实现。
 *
 * 三个必须做对的点：
 *  1. **盒子尺寸写死**：left/top/width/height 全部按归一化比例乘页面像素尺寸。
 *     这样 `normRects` 拿 span 的 `getBoundingClientRect()` 反算出来的矩形，
 *     与识别时的框严格一致，划线和搜索高亮就不会偏。
 *  2. **宽度要拉伸到框宽**：每行字的自然排版宽度和识别框几乎不可能一样。
 *     不拉的话，拖动选字时落点按字形排，会少选/多选半行；拉一下（scaleX）
 *     字宽就与画面上的字对齐了。pdf.js 自己也是这么干的。
 *  3. **跟着页面旋转**：识别框存的是「未旋转页面坐标」，渲染时要按当前角度
 *     转一次（与划线、框选、反链同一套 rotateNormRect）。
 * ============================================================ */

import { rotateNormRect } from './locator';
import { orderOcrLines, type OcrPage } from './ocr';

export interface OcrLayerBox {
  /** 页面在屏幕上的 CSS 宽高（已含缩放与旋转） */
  width: number;
  height: number;
}

/** 旋转角只认 0 / 90 / 180 / 270 的整数倍（和视图层同一口径） */
function normDeg(deg: number): number {
  const d = (((Math.round((Number(deg) || 0) / 90) * 90) % 360) + 360) % 360;
  return d;
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
  const width = Math.max(1, box?.width ?? 1);
  const height = Math.max(1, box?.height ?? 1);
  const deg = normDeg(rotation);
  const frag = document.createDocumentFragment();
  for (const line of orderOcrLines(ocr.lines)) {
    if (!line.rect) continue;
    const rect = deg ? rotateNormRect(line.rect, deg) : line.rect;
    const w = Math.max(1, rect.width * width);
    const h = Math.max(1, rect.height * height);
    const span = document.createElement('span');
    span.className = 'bzr-ocr-line';
    span.textContent = line.text;
    span.style.position = 'absolute';
    span.style.left = `${rect.left * width}px`;
    span.style.top = `${rect.top * height}px`;
    span.style.width = `${w}px`;
    span.style.height = `${h}px`;
    span.style.fontSize = `${h}px`;
    span.style.lineHeight = '1';
    span.style.whiteSpace = 'pre';
    span.style.transformOrigin = '0 0';
    span.style.color = 'transparent';
    span.style.userSelect = 'text';
    frag.appendChild(span);
  }
  container.appendChild(frag);
  /* 宽度对齐要等节点进树之后测：没挂上去的元素量不出内容宽度。
     只做横向拉伸——纵向由 font-size = 框高保证。 */
  for (const span of Array.from(container.querySelectorAll<HTMLElement>('.bzr-ocr-line'))) {
    const target = Number.parseFloat(span.style.width) || 0;
    const natural = span.scrollWidth || 0;
    if (target <= 0 || natural <= 0) continue;
    const scale = target / natural;
    if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.01) {
      span.style.transform = `scaleX(${scale})`;
    }
  }
}
