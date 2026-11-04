/* groupBy polyfill 的回归测试。
 *
 * Node 24 自带 Object.groupBy / Map.groupBy，所以每个用例先删掉全局实现，
 * 再调用 installGroupByPolyfill()，断言补上的实现与 TC39 语义一致；
 * 跑完把原实现按原描述符装回去，不污染同进程里的其他用例。
 *
 * 排序断言用字符串键（整数键会被 JS 对象规则提前，这是对象本身的语义，
 * 不是 polyfill 的事）。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installGroupByPolyfill } from '../src/core/group-by';

type ObjectGroupBy = <T, K extends PropertyKey>(
  items: Iterable<T>,
  callback: (value: T, index: number) => K,
) => Record<K, T[]>;

type MapGroupBy = <T, K>(
  items: Iterable<T>,
  callback: (value: T, index: number) => K,
) => Map<K, T[]>;

interface ObjectHolder {
  groupBy?: ObjectGroupBy;
}

interface MapHolder {
  groupBy?: MapGroupBy;
}

const objectHolder = Object as unknown as ObjectHolder;
const mapHolder = Map as unknown as MapHolder;

const savedObject = Object.getOwnPropertyDescriptor(Object, 'groupBy');
const savedMap = Object.getOwnPropertyDescriptor(Map, 'groupBy');

function restore(target: object, key: string, descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else delete (target as Record<string, unknown>)[key];
}

beforeEach(() => {
  delete objectHolder.groupBy;
  delete mapHolder.groupBy;
});

afterEach(() => {
  restore(Object, 'groupBy', savedObject);
  restore(Map, 'groupBy', savedMap);
});

describe('Object.groupBy', () => {
  it('按首次出现顺序分组', () => {
    installGroupByPolyfill();
    const grouped = objectHolder.groupBy!([1, 2, 3, 4, 5, 6], (n) => (n % 2 === 0 ? 'even' : 'odd'));
    expect(Object.keys(grouped)).toEqual(['odd', 'even']);
    expect(grouped.odd).toEqual([1, 3, 5]);
    expect(grouped.even).toEqual([2, 4, 6]);
  });

  it('返回 null 原型对象', () => {
    installGroupByPolyfill();
    const grouped = objectHolder.groupBy!(['a'], () => 'k');
    expect(Object.getPrototypeOf(grouped)).toBeNull();
    expect(grouped.k).toEqual(['a']);
  });

  it('非 symbol 键按 String() 归一', () => {
    installGroupByPolyfill();
    const grouped = objectHolder.groupBy!([1, 2, '1'], () => 1);
    expect(Object.keys(grouped)).toEqual(['1']);
    expect(grouped['1']).toEqual([1, 2, '1']);

    const coerced = objectHolder.groupBy!(
      ['undefined', 'null', 'zero', 'bool'],
      (kind) => {
        if (kind === 'undefined') return undefined as unknown as string;
        if (kind === 'null') return null as unknown as string;
        if (kind === 'zero') return -0 as unknown as string;
        return true as unknown as string;
      },
    );
    // "0" 是整数索引键，按 JS 对象的规则排在字符串键前面；原生实现同样如此。
    expect(Object.keys(coerced)).toEqual(['0', 'undefined', 'null', 'true']);
  });

  it('symbol 键保持原样', () => {
    installGroupByPolyfill();
    const tag = Symbol('tag');
    const grouped = objectHolder.groupBy!([1, 2], () => tag);
    expect(Object.getOwnPropertySymbols(grouped)).toEqual([tag]);
    expect(grouped[tag]).toEqual([1, 2]);
  });

  it('callback 拿到 (value, index)，index 从 0 递增', () => {
    installGroupByPolyfill();
    const seen: Array<[string, number]> = [];
    objectHolder.groupBy!(['a', 'b', 'c'], (value, index) => {
      seen.push([value, index]);
      return 'k';
    });
    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('接受任意 iterable', () => {
    installGroupByPolyfill();
    const grouped = objectHolder.groupBy!(new Set(['a', 'bb', 'cc']), (s) => s.length);
    expect(Object.keys(grouped)).toEqual(['1', '2']);
    expect(grouped['2']).toEqual(['bb', 'cc']);
  });

  it('callback 不是函数时抛 TypeError', () => {
    installGroupByPolyfill();
    expect(() =>
      objectHolder.groupBy!([1], null as unknown as (value: number) => string),
    ).toThrow(TypeError);
  });
});

describe('Map.groupBy', () => {
  it('返回 Map，键保持原值且按首次出现排序', () => {
    installGroupByPolyfill();
    const grouped = mapHolder.groupBy!([1, '1', 2, 1], (v) => v);
    expect(grouped).toBeInstanceOf(Map);
    expect([...grouped.keys()]).toEqual([1, '1', 2]);
    expect(grouped.get(1)).toEqual([1, 1]);
    expect(grouped.get('1')).toEqual(['1']);
    expect(grouped.get(2)).toEqual([2]);
  });

  it('键用 SameValueZero：NaN 同组，0 与 -0 同组', () => {
    installGroupByPolyfill();
    const grouped = mapHolder.groupBy!([Number.NaN, Number.NaN, 0, -0], (v) => v);
    expect([...grouped.keys()]).toEqual([Number.NaN, 0]);
    expect(grouped.get(Number.NaN)).toEqual([Number.NaN, Number.NaN]);
    expect(grouped.get(0)).toEqual([0, -0]);
  });

  it('callback 拿到 (value, index)', () => {
    installGroupByPolyfill();
    const seen: Array<[string, number]> = [];
    mapHolder.groupBy!(['a', 'b'], (value, index) => {
      seen.push([value, index]);
      return index;
    });
    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('callback 不是函数时抛 TypeError', () => {
    installGroupByPolyfill();
    expect(() =>
      mapHolder.groupBy!([1], null as unknown as (value: number) => string),
    ).toThrow(TypeError);
  });
});

describe('installGroupByPolyfill', () => {
  it('两个方法都缺失时一起补上', () => {
    expect(objectHolder.groupBy).toBeUndefined();
    expect(mapHolder.groupBy).toBeUndefined();
    installGroupByPolyfill();
    expect(typeof objectHolder.groupBy).toBe('function');
    expect(typeof mapHolder.groupBy).toBe('function');
  });

  it('不覆盖已有实现', () => {
    const objectSentinel = (() => ({ sentinel: true })) as unknown as ObjectGroupBy;
    const mapSentinel = (() => new Map()) as unknown as MapGroupBy;
    objectHolder.groupBy = objectSentinel;
    mapHolder.groupBy = mapSentinel;
    installGroupByPolyfill();
    expect(objectHolder.groupBy).toBe(objectSentinel);
    expect(mapHolder.groupBy).toBe(mapSentinel);
  });

  it('重复调用是幂等的', () => {
    installGroupByPolyfill();
    const objectImpl = objectHolder.groupBy;
    const mapImpl = mapHolder.groupBy;
    installGroupByPolyfill();
    expect(objectHolder.groupBy).toBe(objectImpl);
    expect(mapHolder.groupBy).toBe(mapImpl);
  });

  it('缺一个补一个', () => {
    const mapSentinel = (() => new Map()) as unknown as MapGroupBy;
    mapHolder.groupBy = mapSentinel;
    installGroupByPolyfill();
    expect(typeof objectHolder.groupBy).toBe('function');
    expect(mapHolder.groupBy).toBe(mapSentinel);
  });
});
