import esbuild from "esbuild";
import fs from "fs";
import path from "path";

// 构建两个包：base（基础版）与 pro（高级版）。
// 不用 define 摇树而是两个入口：define 只能删掉 if(false){...} 里的代码，
// 静态 import 的模块仍会进 bundle；两个入口是物理隔离，不必赌 sideEffects 配置。
const args = process.argv.slice(2);
const mode = args.includes("production") ? "production" : args.includes("once") ? "once" : "watch";
const prod = mode === "production";
const only = (() => {
  const i = args.indexOf("--target");
  const v = i >= 0 ? args[i + 1] : "";
  return v === "base" || v === "pro" ? v : "";
})();

const TARGETS = only ? [only] : ["base", "pro"];

// 产物直出 vault 插件目录（安装即用）。只有「当前激活的那一版」会被同步过去，
// 默认 base；装 pro 时用 BZ_READER_ACTIVE=pro。缺省落「测试库」——开发时用可造数据的
// 库，别把半成品推给主库；要装到主库就 BZ_READER_VAULT="E:/Obsidian/叫我包仔/.obsidian/plugins/bz-reader"。
const VAULT_PLUGIN_DIR =
  process.env.BZ_READER_VAULT || "E:/Obsidian/测试/.obsidian/plugins/bz-reader";
const ACTIVE = process.env.BZ_READER_ACTIVE === "pro" ? "pro" : "base";

const DIST = path.join(process.cwd(), "dist");

function htmlFor() {
  return "";
}

/**
 * 样式组合：设计令牌 + 域样式 + 壳层，产物里不留 @import（Obsidian 只加载一个 styles.css）。
 * 壳层（src/shell/styles）是原型 1:1 移植，全部选择器限定在 .bzs-shell 内，
 * 放在最后，确保不被旧域样式意外覆盖。
 */
/* mobile.css 必须排在最后：它是覆盖层，同特异性靠顺序取胜 */
const SHELL_STYLES = ["tokens.css", "common.css", "study.css", "sidebar.css", "reader.css", "overlay.css", "mobile.css"];

/**
 * 给壳层样式加作用域前缀。
 *
 * 为什么需要：壳层沿用了 `bzr-` 前缀（为了避开 Obsidian 自己的类名），
 * 但 `bzr-` 早就是本插件的既有命名空间——旧统计面板里也有 `.bzr-heat`、
 * `.bzr-btn`、`.bzr-qcard`。两套同名规则一撞，后者（旧域样式，写在更前面
 * 但特异性相同、又带 background）就把壳层的样子盖了：热力图变成一块白底
 * 就是这条。
 *
 * 解法不是改名（那要动 3000 行 CSS 加全部模板字符串），而是把壳层的每条
 * 选择器限定在 `.bzs-shell` 下：特异性从 (0,1,0) 升到 (0,2,0)，同名也赢，
 * 而且顺带保证样式绝不外泄到宿主。
 *
 * 三种行必须原样放过：
 *   · 已带 .bzs-shell 的（tokens.css 里全是，幂等）
 *   · 宿主选择器（.workspace-leaf-content[…] 这两条是故意写宿主的）
 *   · @keyframes 的帧（`0%` / `from` / `to`）
 */
function scopeShellStyles(css) {
  return css
    .split("\n")
    .map((line) => {
      const brace = line.indexOf("{");
      if (brace < 0) return line;
      const head = line.slice(0, brace);
      const tail = line.slice(brace);
      const trimmed = head.trim();
      if (!trimmed || trimmed.startsWith("/*") || trimmed.startsWith("@")) return line;
      const parts = head.split(",").map((raw) => {
        const s = raw.trim();
        if (!s) return raw;
        if (s.startsWith(".bzs-shell")) return raw;
        if (s.startsWith(".workspace-leaf-content")) return raw;
        // 尺度变量挂在 :root（有一批旧域样式的元素不在 .bzs-shell 里），
        // 加前缀就变成「.bzs-shell :root」，永远匹配不上
        if (s.startsWith(":root")) return raw;
        if (/^(\d|from$|to$)/.test(s)) return raw;
        /**
         * `.bzs-` 开头的选择器已经是本插件专属命名空间，不再套 `.bzs-shell `。
         *
         * 这一条是踩出来的：根元素本身就同时带 `bzs-shell` 与 `bzs-reader`，
         * 一旦改写成 `.bzs-shell .bzs-reader`（后代），根元素自己就匹配不上了——
         * 表现是 `.bzs-reader{position:relative}` 失效，悬浮工具条按最近的
         * 定位祖先飞到 tab 栏上去了。弹层根 `.bzs-shell.bzs-overlay-root` 同理。
         *
         * 只给裸元素选择器（input / select / textarea / .dot 之类）加作用域，
         * 那才是真会和宿主撞的地方。
         */
        if (s.startsWith(".bzs-")) return raw;
        return `.bzs-shell ${s}`;
      });
      return parts.join(",") + tail;
    })
    .join("\n");
}

function buildStyles() {
  const legacy = [
    path.join(process.cwd(), "src/core/ui/tokens.css"),
    path.join(process.cwd(), "src/styles.css"),
  ]
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, "utf8"));

  const shell = SHELL_STYLES.map((f) => path.join(process.cwd(), "src/shell/styles", f))
    .filter((p) => fs.existsSync(p))
    .map((p) => scopeShellStyles(fs.readFileSync(p, "utf8")));

  const css = [...legacy, ...shell].join("\n\n");
  fs.writeFileSync(path.join(process.cwd(), "styles.css"), css, "utf8");
  return css;
}

/* ── 基础版物理剔除高级模块 ──
 *
 * define（__BZ_READER_PRO__）只能让 `if (false) { … }` 这块代码消失，
 * 静态 import 进来的模块照样躺在 bundle 里——pro 与 base 之前只差 182 字节，
 * 就是因为 AI / 朗读 / 统计 / 跨书搜索全是静态 import，运行时 if 拦不住。
 *
 * 要真的不留代码就得在解析阶段换文件：base 构建时把这几个模块替换成同签名的
 * 空实现，包里连一句 speechSynthesis、一个 AI endpoint 都不会有。
 * 调用方拿到的 null / 空对象就是「这个包没有这项功能」。
 */
const PRO_ONLY_STUBS = {
  "src/core/speak.ts": `
    export function speak() { return null; }
    export function stopSpeaking() {}
  `,
  "src/data/ai.ts": `
    export const AI_TASK_LABELS = { summarize: '', explain: '', translate: '' };
    export async function aiAsk() { return { text: '' }; }
  `,
  "src/ui/stats-panel.ts": `
    export function openStats() {}
  `,
  "src/ui/cross-search-panel.ts": `
    export function openCrossSearch() {}
  `,
};

function stubProModules(target) {
  if (target === "pro") return [];
  const root = process.cwd();
  return [
    {
      name: "stub-pro-modules",
      setup(build) {
        build.onLoad({ filter: /\.ts$/ }, (args) => {
          const rel = path.relative(root, args.path).replace(/\\/g, "/");
          const stub = PRO_ONLY_STUBS[rel];
          if (!stub) return null;
          return { contents: stub, loader: "js", resolveDir: path.dirname(args.path) };
        });
      },
    },
  ];
}

const contexts = [];

for (const target of TARGETS) {
  const outDir = path.join(DIST, target);
  fs.mkdirSync(outDir, { recursive: true });

  const ctx = await esbuild.context({
    entryPoints: [`src/entry/${target}.ts`],
    bundle: true,
    external: ["obsidian", "electron", "@codemirror/*", "os", "node:fs", "node:path"],
    format: "cjs",
    // foliate 的 mobi loader 用 BigInt 字面量，es2018 编不过；Obsidian 跑在近两年的
    // Chromium / iOS WKWebView 上，es2020 全绿（可选链、BigInt、globalThis 都支持）。
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    minify: prod,
    charset: "utf8",
    define: { __BZ_READER_PRO__: target === "pro" ? "true" : "false" },
    plugins: stubProModules(target),
    outfile: path.join(outDir, "main.js"),
  });
  contexts.push({ ctx, outDir, target });
}

function copyStatic() {
  buildStyles();
  for (const { outDir } of contexts) {
    for (const file of ["manifest.json", "styles.css"]) {
      const src = path.join(process.cwd(), file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, file));
    }
  }
  // 同步到 vault：只同步当前激活的那一版
  if (fs.existsSync(VAULT_PLUGIN_DIR)) {
    const srcDir = path.join(DIST, ACTIVE);
    for (const file of ["main.js", "manifest.json", "styles.css"]) {
      const src = path.join(srcDir, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(VAULT_PLUGIN_DIR, file));
    }
    console.log(`✓ 已同步 ${ACTIVE} → ${VAULT_PLUGIN_DIR}`);
  } else {
    console.log(`! vault 插件目录不存在，跳过同步：${VAULT_PLUGIN_DIR}`);
  }
}

if (mode === "watch") {
  for (const { ctx } of contexts) await ctx.watch();
  copyStatic();
  console.log("watching for changes...");
} else {
  for (const { ctx } of contexts) await ctx.rebuild();
  copyStatic();
  for (const { ctx } of contexts) await ctx.dispose();
  process.exit(0);
}
