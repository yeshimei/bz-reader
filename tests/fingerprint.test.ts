import { describe, expect, it } from 'vitest';
import { FINGERPRINT_VERSION, fingerprintOf } from '../src/data/fingerprint';

function bytes(n: number, fill: number): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

/** `n` 字节、整体填 7，只把 `at` 处改成 `fill` 的测试样本 */
function withByte(n: number, at: number, fill: number): Uint8Array {
  const b = bytes(n, 7);
  b[at] = fill;
  return b;
}

/**
 * 指纹是「同一份文件只能进书架一次」的唯一依据，所以它必须只看内容、
 * 不看路径/文件名。头尾各取 64KB 是有意的取舍：Obsidian 的 adapter
 * 没有「只读一段」的接口，整份读进来再切头尾，内存峰值才可控。
 */
describe('内容指纹', () => {
  it('同一份内容算出来是同一个指纹（与文件名无关）', () => {
    const a = fingerprintOf(bytes(1024, 42));
    const b = fingerprintOf(bytes(1024, 42));
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('大小相同、内容不同 → 指纹不同', () => {
    expect(fingerprintOf(bytes(4096, 1))).not.toBe(fingerprintOf(bytes(4096, 2)));
  });

  it('大小不同 → 指纹不同（大小也混进了哈希）', () => {
    expect(fingerprintOf(bytes(1024, 3))).not.toBe(fingerprintOf(bytes(1025, 3)));
  });

  it('空文件没有指纹：算不出来就不要拿它去查重', () => {
    expect(fingerprintOf(new Uint8Array(0))).toBeNull();
  });

  it('指纹带算法版本，换算法时能认出旧值', () => {
    expect(fingerprintOf(bytes(8, 1))).toMatch(new RegExp(`^v${FINGERPRINT_VERSION}-[0-9a-f]+$`));
  });

  it('大文件头部不同 → 指纹不同', () => {
    const a = withByte(200 * 1024, 150 * 1024, 9);
    const b = withByte(200 * 1024, 10, 9);
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b));
  });

  it('大文件尾部不同 → 指纹不同', () => {
    const a = withByte(200 * 1024, 150 * 1024, 9);
    const b = withByte(200 * 1024, 199 * 1024, 9);
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b));
  });

  it('已知边界：只比头尾各 64KB，中间改一个字节认不出来（取舍，不是 bug）', () => {
    const a = withByte(300 * 1024, 150 * 1024, 1);
    const b = withByte(300 * 1024, 150 * 1024, 2);
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });
});
