import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import {
  formatSrcset,
  inlineMarkup,
  installBlobSrcdocPatches,
  parseSrcset,
  uninstallBlobSrcdocPatches,
} from '../src/engine/blob-srcdoc';

/**
 * A-07 / A-35：章节 HTML 里的资源内联。
 *
 * 移动端 iframe 只放行 data:，所以 blob 图片得转成 data URL；但
 *   · 超单张上限 / 整章预算耗尽时**必须保留原 blob 地址**（以前直接
 *     removeAttribute('src')，图片变成一个空壳，用户连「图裂了」都看不到）；
 *   · 预算按 blob 字节算，不是按 base64 字符串长度（后者虚高 33%）；
 *   · SVG 封面的 `<image href>`、`srcset` 里的每个候选项也要内联，
 *     否则封面/多倍图在移动端还是白的。
 */
let restoreDom: () => void;

class FakeFileReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then(
      (buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.();
      },
      () => this.onerror?.(),
    );
  }
}

beforeAll(() => {
  restoreDom = installDomStub();
  (globalThis as unknown as { FileReader: unknown }).FileReader = FakeFileReader;
});

afterAll(() => {
  restoreDom?.();
  delete (globalThis as unknown as { FileReader?: unknown }).FileReader;
});

beforeEach(() => {
  installBlobSrcdocPatches();
});

afterEach(() => {
  uninstallBlobSrcdocPatches();
  vi.restoreAllMocks();
});

/** 造一张指定字节数的「图」，走我们自己的 URL 补丁登记进表 */
function seedImage(bytes: number): string {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
}

function page(body: string): string {
  return `<html><head><title>t</title></head><body>${body}</body></html>`;
}

describe('inlineMarkup · 图片预算（A-07）', () => {
  it('小图内联成 data URL', async () => {
    const url = seedImage(64);
    const out = await inlineMarkup(page(`<p>正文</p><img src="${url}">`));
    expect(out).toContain('src="data:image/png;base64,');
    expect(out).not.toContain(url);
  });

  it('超过单张上限：保留原 blob 地址，不再删掉 src', async () => {
    const url = seedImage(3 * 1024 * 1024 + 1);
    const out = await inlineMarkup(page(`<img src="${url}">`));
    expect(out).toContain(`src="${url}"`);
    expect(out).not.toContain('src=""');
  });

  it('整章预算按 blob 字节算：4 张 2MB 内联、第 5 张保留原地址', async () => {
    const urls = Array.from({ length: 5 }, () => seedImage(2 * 1024 * 1024));
    const body = urls.map((u) => `<img src="${u}">`).join('');
    const out = await inlineMarkup(page(body));

    expect(out.match(/src="data:/g)?.length).toBe(4);
    expect(out).toContain(`src="${urls[4]}"`);
    for (const u of urls.slice(0, 4)) expect(out).not.toContain(`src="${u}"`);
  });

  it('图片读不出来时也保留原地址', async () => {
    const out = await inlineMarkup(page('<img src="blob:missing-image">'));
    expect(out).toContain('src="blob:missing-image"');
  });
});

describe('inlineMarkup · srcset / SVG 封面（A-35）', () => {
  it('img[srcset] 的每个候选项都转 data URL，描述符保留', async () => {
    const a = seedImage(32);
    const b = seedImage(48);
    const out = await inlineMarkup(page(`<img srcset="${a} 1x, ${b} 2x">`));

    expect(out).toContain('srcset="data:image/png;base64,');
    expect(out).toContain('1x');
    expect(out).toContain('2x');
    expect(out).not.toContain(a);
    expect(out).not.toContain(b);
  });

  it('source[srcset] 同样处理', async () => {
    const a = seedImage(24);
    const out = await inlineMarkup(page(`<picture><source srcset="${a} 2x"><img src="${a}"></picture>`));
    expect(out.match(/srcset="data:image\/png;base64,/g)?.length).toBe(1);
    expect(out.match(/src="data:image\/png;base64,/g)?.length).toBe(1);
  });

  it('srcset 里超预算的候选保留原 blob 地址', async () => {
    const big = seedImage(3 * 1024 * 1024 + 1);
    const out = await inlineMarkup(page(`<img srcset="${big} 1x">`));
    expect(out).toContain(`srcset="${big} 1x"`);
  });

  it('SVG <image> 的 href 与 xlink:href 都内联（封面）', async () => {
    const cover = seedImage(40);
    const out = await inlineMarkup(
      page(`<svg viewBox="0 0 10 10"><image href="${cover}" xlink:href="${cover}"/></svg>`),
    );
    expect(out).toMatch(/<image href="data:image\/png;base64,/);
    expect(out).toMatch(/xlink:href="data:image\/png;base64,/);
    expect(out).not.toContain(cover);
  });

  it('同一个 URL 只读一次（src 与 srcset 共用）', async () => {
    const url = seedImage(64);
    const readSpy = vi.spyOn(FakeFileReader.prototype, 'readAsDataURL');
    const out = await inlineMarkup(page(`<img src="${url}" srcset="${url} 1x">`));
    expect(out.match(/data:image\/png;base64,/g)?.length).toBe(2);
    expect(readSpy).toHaveBeenCalledTimes(1);
  });
});

describe('srcset 纯函数', () => {
  it('拆出 URL 与描述符', () => {
    expect(parseSrcset('a.png 1x, b.png 2x')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
    expect(parseSrcset('c.png')).toEqual([{ url: 'c.png', descriptor: '' }]);
  });

  it('data URL 里的逗号不当分隔符', () => {
    expect(parseSrcset('data:image/png;base64,AAA= 1x')).toEqual([
      { url: 'data:image/png;base64,AAA=', descriptor: '1x' },
    ]);
  });

  it('拼回去时描述符为空就不留尾随空格', () => {
    expect(formatSrcset([{ url: 'a.png', descriptor: '' }])).toBe('a.png');
    expect(
      formatSrcset([
        { url: 'a.png', descriptor: '1x' },
        { url: 'b.png', descriptor: '' },
      ]),
    ).toBe('a.png 1x, b.png');
  });
});

describe('inlineMarkup · 原有安全清理不回退', () => {  it('删 script / iframe / on* / CSP meta，保留正常内容', async () => {
    const out = await inlineMarkup(
      page(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">` +
          `<script>alert(1)</script><p onclick="x()">字</p><a href="javascript:x()">链接</a>`,
      ),
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('Content-Security-Policy');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('字');
    expect(out).toContain('链接');
  });

  it('CSS 里的 blob url() 内联成 data:', async () => {
    const url = seedImage(16);
    const out = await inlineMarkup(page(`<style>.c{background:url("${url}")}</style>`));
    expect(out).toContain('background:url("data:image/png;base64,');
    expect(out).not.toContain(url);
  });
});
