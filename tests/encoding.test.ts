import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeTxtBytes } from '../src/engine/encoding';

/**
 * A-06：TXT 不能只按 UTF-8 解。
 *
 * 中文 TXT 实际有四种来路：UTF-8（带不带 BOM）、UTF-16（Windows 记事本的
 * 「Unicode」）、GBK/GB18030（绝大多数盗版 txt 与老作者稿）、Big5（台版书）。
 * 以前一律 `adapter.read`，GBK 书打开全是「锟斤拷」。
 */
const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('TXT 字节解码（A-06）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无 BOM 的 UTF-8 直接解', () => {
    expect(decodeTxtBytes(utf8('中文测试'))).toBe('中文测试');
  });

  it('UTF-8 BOM（EF BB BF）不留在正文里', () => {
    expect(decodeTxtBytes(bytes(0xef, 0xbb, 0xbf, ...utf8('中文测试')))).toBe('中文测试');
  });

  it('UTF-16LE BOM（FF FE）按 utf-16le 解', () => {
    // 「中文」：中 U+4E2D（LE 2D 4E）、文 U+6587（LE 87 65）
    expect(decodeTxtBytes(bytes(0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65))).toBe('中文');
  });

  it('UTF-16BE BOM（FE FF）按 utf-16be 解', () => {
    expect(decodeTxtBytes(bytes(0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87))).toBe('中文');
  });

  it('GBK 字节解出正确中文（不是替换符）', () => {
    // 「中文测试」的 GBK 编码
    const gbk = bytes(0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4);
    expect(decodeTxtBytes(gbk)).toBe('中文测试');
  });

  it('接受 ArrayBuffer（vault.adapter.readBinary 的返回类型）', () => {
    const gbk = bytes(0xd6, 0xd0, 0xce, 0xc4);
    expect(decodeTxtBytes(gbk.buffer as ArrayBuffer)).toBe('中文');
  });

  it('空文件返回空串，不抛', () => {
    expect(decodeTxtBytes(new Uint8Array(0))).toBe('');
  });

  it('UTF-8 解不了时按 gb18030 → big5 的顺序退', () => {
    const labels: string[] = [];
    const Real = globalThis.TextDecoder;
    class StubDecoder {
      private label: string;
      constructor(label = 'utf-8') {
        this.label = String(label).toLowerCase();
        labels.push(this.label);
      }
      decode(): string {
        if (this.label === 'utf-8') throw new Error('not utf-8');
        if (this.label === 'gb18030') throw new Error('not gbk');
        return '大五碼';
      }
    }
    vi.stubGlobal('TextDecoder', StubDecoder as unknown as typeof TextDecoder);

    expect(decodeTxtBytes(bytes(0xa4, 0xa4))).toBe('大五碼');
    expect(labels).toEqual(['utf-8', 'gb18030', 'big5']);
    expect(Real).toBeDefined();
  });

  it('所有严格候选都失败时退回宽松 UTF-8，不抛', () => {
    class StrictFailLenientStub {
      constructor(
        public label = 'utf-8',
        public opts?: { fatal?: boolean },
      ) {}
      decode(): string {
        if (this.opts?.fatal) throw new Error('no way');
        return '\uFFFD';
      }
    }
    vi.stubGlobal('TextDecoder', StrictFailLenientStub as unknown as typeof TextDecoder);

    expect(decodeTxtBytes(bytes(0xff, 0xff))).toBe('\uFFFD');
  });
});
