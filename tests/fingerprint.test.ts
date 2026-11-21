import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_VERSION,
  fingerprintOf,
  isCurrentFingerprint,
  needsFingerprintUpgrade,
} from '../src/data/fingerprint';

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
 * 不看路径/文件名。v2 起用整本书的 SHA-256（v1 只取头尾各 64KB，
 * 中间改一个字节认不出——那是已知取舍，v2 把它消掉）。
 */
describe('内容指纹 v2（整本书 SHA-256）', () => {
  it('版本号是 2，指纹带版本前缀和大小', async () => {
    expect(FINGERPRINT_VERSION).toBe(2);
    expect(await fingerprintOf(bytes(8, 1))).toMatch(/^v2-[0-9a-f]{64}-8$/);
  });

  it('同一份内容算出来是同一个指纹（与文件名无关）', async () => {
    const a = await fingerprintOf(bytes(1024, 42));
    const b = await fingerprintOf(bytes(1024, 42));
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('大小相同、内容不同 → 指纹不同', async () => {
    expect(await fingerprintOf(bytes(4096, 1))).not.toBe(await fingerprintOf(bytes(4096, 2)));
  });

  it('大小不同 → 指纹不同（大小也拼进了指纹串）', async () => {
    expect(await fingerprintOf(bytes(1024, 3))).not.toBe(await fingerprintOf(bytes(1025, 3)));
  });

  it('空内容没有指纹：算不出来就不要拿它去查重', async () => {
    expect(await fingerprintOf(new Uint8Array(0))).toBeNull();
  });

  it('整本书参与哈希：中间改一个字节也能认出来（v1 的已知边界已消除）', async () => {
    const a = withByte(300 * 1024, 150 * 1024, 1);
    const b = withByte(300 * 1024, 150 * 1024, 2);
    expect(await fingerprintOf(a)).not.toBe(await fingerprintOf(b));
  });

  it('头尾相同、中间不同 → 指纹不同（这正是 v2 相对 v1 的改进）', async () => {
    const a = bytes(200 * 1024, 7);
    const b = bytes(200 * 1024, 7);
    b[100 * 1024] = 9;
    expect(await fingerprintOf(a)).not.toBe(await fingerprintOf(b));
  });

  it('大文件不再因 64MB 上限被跳过（取消上限，全书都算）', async () => {
    // 刚好跨过旧上限 1 字节；只验证「能算出指纹」，不拿它做基准
    const big = bytes(64 * 1024 * 1024 + 1, 5);
    const fp = await fingerprintOf(big);
    expect(fp).toMatch(new RegExp(`^v2-[0-9a-f]{64}-${big.length}$`));
    // 同一批内容再算一次要稳定
    expect(await fingerprintOf(big)).toBe(fp);
  });
});

describe('指纹版本判定（升级闸门）', () => {
  it('v2 指纹视作当前版本，不需升级', () => {
    expect(isCurrentFingerprint('v2-abcdef-123')).toBe(true);
    expect(needsFingerprintUpgrade('v2-abcdef-123')).toBe(false);
  });

  it('v1 指纹需要升级', () => {
    expect(isCurrentFingerprint('v1-0123456789abcdef01234567')).toBe(false);
    expect(needsFingerprintUpgrade('v1-0123456789abcdef01234567')).toBe(true);
  });

  it('没有指纹需要补算', () => {
    expect(needsFingerprintUpgrade(undefined)).toBe(true);
    expect(needsFingerprintUpgrade('')).toBe(true);
  });
});
