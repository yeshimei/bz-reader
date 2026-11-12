import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import {
  chapterSandbox,
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

/* ── B2：循环 @import 不能把主线程递归到栈溢出 ───────────────── */

describe('样式表循环 import（B2）', () => {
  /** 没登记进 blob 表的地址会走 window.fetch：用它造一个「自己 import 自己」的表 */
  function stubFetch(css: string): { calls: () => number; restore: () => void } {
    const g = window as unknown as { fetch?: unknown };
    const prev = g.fetch;
    let n = 0;
    g.fetch = async () => {
      n += 1;
      return { text: async () => css, blob: async () => new Blob([]) };
    };
    return {
      calls: () => n,
      restore: () => {
        g.fetch = prev;
      },
    };
  }

  it('样式表 import 自己：删掉那条 import，其余规则仍然展开', async () => {
    const url = 'blob:loop-css';
    const f = stubFetch(`@import url("${url}");
.loop{color:red}`);
    try {
      const out = await inlineMarkup(page(`<style>@import url("${url}");</style>`));
      expect(out).toContain('.loop{color:red}');
      /* 见过就不再展开：读一次就够，不会一路递归到栈溢出 */
      expect(f.calls()).toBeLessThanOrEqual(2);
    } finally {
      f.restore();
    }
  });

  it('style 里的 blob url() 与 @import 混在一起也能收尾', async () => {
    const img = seedImage(32);
    const f = stubFetch(`@import url("blob:loop-x"); .x{background:url("${img}")}`);
    try {
      const out = await inlineMarkup(page(`<style>@import url("blob:loop-x");</style>`));
      expect(out).toContain('background:url("data:image/png;base64,');
    } finally {
      f.restore();
    }
  });
});

/* ── B6：CSS 图与正文图共用一份字节池 ───────────────────────── */

describe('CSS 图与正文图共享预算（B6）', () => {
  it('背景图先吃掉一半，正文就少内联两张（不再各算 8MB）', async () => {
    const MB = 1024 * 1024;
    const bg1 = seedImage(2 * MB);
    const bg2 = seedImage(2 * MB);
    const pics = [seedImage(2 * MB), seedImage(2 * MB), seedImage(2 * MB)];
    const out = await inlineMarkup(
      page(
        `<style>.a{background:url("${bg1}")}.b{background:url("${bg2}")}</style>` +
          pics.map((u) => `<img src="${u}">`).join(''),
      ),
    );

    /* 4MB（背景）+ 2MB + 2MB = 8MB 用满；第三张正文图保留原地址 */
    expect(out.match(/background:url\("data:/g)?.length).toBe(2);
    expect(out.match(/src="data:/g)?.length).toBe(2);
    expect(out).toContain(`src="${pics[2]}"`);
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

/**
 * iOS WebKit bug 218086：`srcdoc` + `sandbox=allow-same-origin`（不带
 * `allow-scripts`）时，**父页面注册在 iframe 文档上的监听全部收不到事件**，
 * 控制台报 `Blocked script execution in 'about:srcdoc'`。
 *
 * 症状正是 iPhone 上的那一条：正文能选中、目录能跳章，但点按翻页、滑动、
 * 划词工具条全哑——这三件都靠父页面挂在 iframe doc 上的监听，选字和跳章
 * 走的是浏览器原生行为与宿主按钮，所以看着「一切正常，就是翻不了页」。
 * Android 的 Chromium 没这个 bug，所以只有 iOS 中招。
 *
 * 解法是官方 workaround：加回 `allow-scripts`，同时在 srcdoc 最前面插一条
 * `script-src 'none'` 的 CSP——书里的脚本照样一行都跑不了。
 */
describe('章节 iframe 的 sandbox 与 CSP（iOS WebKit 218086）', () => {
  it('sandbox 必须带 allow-scripts，否则 iOS 上父页面一条事件都收不到', () => {
    expect(chapterSandbox()).toContain('allow-same-origin');
    expect(chapterSandbox()).toContain('allow-scripts');
  });

  it('srcdoc 的 head 最前面注入 script-src none，书里的脚本仍然跑不了', async () => {
    const out = await inlineMarkup(page('<p>字</p>'));
    expect(out).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy" content="script-src 'none';?">/);
  });

  it('书自带的 CSP 仍然被删掉，只留我们自己那条', async () => {
    const out = await inlineMarkup(
      page(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'"><p>字</p>`),
    );
    expect(out).not.toContain("default-src 'self'");
    expect(out).toContain("script-src 'none'");
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
    /* 书自带的那条被删了；留下的是我们自己注入的 script-src 'none' */
    expect(out).not.toContain("default-src 'self'");
    expect(out).toContain("script-src 'none'");
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

/*
 * 剪藏本的视频章要在书页里放播放器（2026-11-13）：
 * 章节 HTML 由我们自己生成，里面那个 `<iframe>` 是**内容**，不是书里夹带的脚本。
 * 一律删掉的话，B 站视频章就只剩一行「下面应该是一个播放器」。
 * 约定：生成方打 `data-bzr-keep` 标记；标记只对 https 地址生效，且用完就摘掉。
 */
describe('inlineMarkup · 剪藏本内嵌视频', () => {
  const BILI = 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1';

  it('带标记、https 地址的 iframe 保留，标记属性摘掉', async () => {
    const out = await inlineMarkup(page(`<p>视频</p><iframe data-bzr-keep="video" src="${BILI}"></iframe>`));
    expect(out).toContain('<iframe');
    expect(out).toContain('player.bilibili.com');
    expect(out).not.toContain('data-bzr-keep');
  });

  it('没标记的 iframe 照旧删掉（书里夹带的一律不认）', async () => {
    const out = await inlineMarkup(page(`<iframe src="${BILI}"></iframe><p>字</p>`));
    expect(out).not.toContain('<iframe');
    expect(out).toContain('字');
  });

  it('标记了但地址不是 https 的一样删（javascript: / http: 都不放行）', async () => {
    const out = await inlineMarkup(
      page(
        `<iframe data-bzr-keep="video" src="javascript:alert(1)"></iframe>` +
          `<iframe data-bzr-keep="video" src="http://plain.example/x"></iframe>`,
      ),
    );
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('javascript:');
  });

  it('保留下来的视频 iframe 仍然要过 on* 清理', async () => {
    const out = await inlineMarkup(
      page(`<iframe data-bzr-keep="video" src="${BILI}" onload="alert(1)"></iframe>`),
    );
    expect(out).toContain('<iframe');
    expect(out).not.toContain('onload');
  });
});
