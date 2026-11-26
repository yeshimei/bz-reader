/* ============================================================
 * bz-reader · 划线排序（data/mark-order.ts）
 *
 * 侧栏划线页有两档排法（2026-11-26，群友反馈后作者定稿）：
 *   · `time` 按添加时间——默认，等于升级前的行为；
 *   · `text` 按书中原文位置——跟着书里出现的先后走。
 *
 * 为什么从定位串里读位置，而不是落笔时记一个「第几段」：
 * 用户已经存下来的几十条线没有那个字段，改完也只有新划的能排对，
 * 老数据一切换还是乱的。CFI / PDF 定位串是现成的唯一线索。
 *
 * 只做纯计算，不碰 store、不碰 DOM。
 * ============================================================ */
import { parsePdfLocator } from '../engine/pdf/locator';

/** 划线列表的排法：按时间 / 按原文 */
export type MarkSort = 'time' | 'text';

/** 宿主里存下来的定位串（EPUB 是 CFI，PDF 是 `pdf/<页>/<起点>-<终点>`） */
export interface OrderableMark {
  cfiRange?: string;
  createdAt?: number;
}

const EPUB_PREFIX = 'epubcfi(';

/**
 * 把一条定位串压成「书里谁在前」的可比较键：数字逐段比大小。
 *
 * EPUB CFI 的路径本身是树里的坐标，逐段比较就是书内顺序：
 *   `epubcfi(/6/4!/4/2/2,/1:0,/1:12)` → [6,4,4,2,2,1,0]
 *   `epubcfi(/6/6!/4/2/2,/1:400,/1:412)` → [6,6,4,2,2,1,400]
 *
 * 三个坑，都在这里收掉：
 *   1. 范围形式 `path,start,end` 的**终点**不能参与比较——否则长划线
 *      永远排在短划线后面；只取起点。
 *   2. 方括号里是元素 id（`[c01]`），里面的数字跟「第几段」无关，
 *      先剔掉再抽数字。
 *   3. PDF 的页与页内字符起点直接给键，和 EPUB 那一套不混。
 *
 * 认不出来返回 null：调用方把这些条目排到最后，再按添加时间兜底。
 */
export function locatorOrderKey(locator: string | undefined): number[] | null {
  const s = String(locator ?? '').trim();
  if (!s) return null;
  if (!s.startsWith(EPUB_PREFIX)) {
    const pdf = parsePdfLocator(s);
    return pdf ? [pdf.page, pdf.start] : null;
  }
  let inner = s.slice(EPUB_PREFIX.length);
  if (inner.endsWith(')')) inner = inner.slice(0, -1);
  /* 范围形式 `path,start,end`：主体 + 起点；没有逗号就是单点定位 */
  const parts = inner.split(',');
  const head = parts.length >= 2 ? `${parts[0]}${parts[1]}` : parts[0];
  const bare = head.replace(/\[[^\]]*\]/g, '');
  const nums = bare.match(/\d+/g);
  return nums && nums.length ? nums.map(Number) : null;
}

/** 两个键逐段比大小；一方是另一方的前缀时短的在前（父路径先于子路径） */
function compareKeys(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * 按原文先后比较两条标注。**只用于同一章内部**——跨章由调用方先按
 * chapterIndex 分组，再拿它排组内。
 *
 * 没有定位的排最后；两边都认不出位置时退回添加时间，保证顺序稳定
 * （同一批数据每次渲染出来的次序一致，不会来回跳）。
 */
export function compareMarkText(a: OrderableMark, b: OrderableMark): number {
  const ka = locatorOrderKey(a.cfiRange);
  const kb = locatorOrderKey(b.cfiRange);
  if (ka && kb) {
    const byKey = compareKeys(ka, kb);
    if (byKey) return byKey;
  } else if (ka) {
    return -1;
  } else if (kb) {
    return 1;
  }
  return (a.createdAt || 0) - (b.createdAt || 0);
}
