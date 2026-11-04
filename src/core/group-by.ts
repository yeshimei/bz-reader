/* ============================================================
 * groupBy polyfill（src/core/group-by.ts）
 *
 * vendor/foliate 用了 groupBy：foliate-js 的 epub.js 在解析 OPF 元数据时
 * 调 `Object.groupBy` / `Map.groupBy`（src/vendor/foliate/epub.js:180、202、
 * 206、208、260）。这两个方法是 ES2024 才进标准的，Chromium < 117 /
 * Safari < 17.4 都没有——Obsidian 跑在较旧的 Electron 或 iPadOS WebView
 * 上时就会缺，缺了会在打开 EPUB 的瞬间抛 TypeError。
 *
 * 只在缺失时安装，绝不覆盖宿主已有的实现：原生实现更快，也避免和别的
 * polyfill 抢同一个属性。
 * ============================================================ */

/** groupBy 的回调：值 + 从 0 开始的下标。 */
type GroupByCallback<T, K> = (value: T, index: number) => K;

/** TC39 的 Object.groupBy：键按 PropertyKey 规则归一（symbol 保留，其余 String()）。 */
function objectGroupBy<T, K extends PropertyKey>(
  items: Iterable<T>,
  callback: GroupByCallback<T, K>,
): Record<K, T[]> {
  assertCallback(callback);
  const out = Object.create(null) as Record<PropertyKey, T[]>;
  let index = 0;
  for (const value of items) {
    const key = callback(value, index);
    index += 1;
    // ToPropertyKey：symbol 原样，其余走 String()（-0 → "0"、null → "null"）。
    const prop: PropertyKey = typeof key === 'symbol' ? key : String(key);
    const bucket = out[prop];
    if (bucket) bucket.push(value);
    else out[prop] = [value];
  }
  return out;
}

/** TC39 的 Map.groupBy：键用 SameValueZero（NaN 同组、0 与 -0 同组），不做字符串化。 */
function mapGroupBy<T, K>(
  items: Iterable<T>,
  callback: GroupByCallback<T, K>,
): Map<K, T[]> {
  assertCallback(callback);
  const out = new Map<K, T[]>();
  let index = 0;
  for (const value of items) {
    const key = callback(value, index);
    index += 1;
    const bucket = out.get(key);
    if (bucket) bucket.push(value);
    else out.set(key, [value]);
  }
  return out;
}

function assertCallback(callback: unknown): void {
  if (typeof callback !== 'function') {
    throw new TypeError('groupBy callback must be a function');
  }
}

/** 宿主没有原生实现时补上；已有实现（原生或别的 polyfill）一律不碰。 */
export function installGroupByPolyfill(): void {
  const objectCtor = Object as unknown as { groupBy?: typeof objectGroupBy };
  if (typeof objectCtor.groupBy !== 'function') {
    objectCtor.groupBy = objectGroupBy;
  }

  const mapCtor = Map as unknown as { groupBy?: typeof mapGroupBy };
  if (typeof mapCtor.groupBy !== 'function') {
    mapCtor.groupBy = mapGroupBy;
  }
}
