import esbuild from "esbuild";
import fs from "fs";
import path from "path";

// 只出一个包：完整功能版（等价于原来的 pro）。
// 功能是否可用由激活码在运行期判定（can() → entitlement().unlocked），
// 不再有「基础版把高级模块换成空实现」这条线——两个包曾经导致
// 「授权有效但高级功能全不可用」，因为用户装到了 base 包。
const args = process.argv.slice(2);
const mode = args.includes("production") ? "production" : args.includes("once") ? "once" : "watch";
const prod = mode === "production";
const TARGETS = ["pro"];

// 产物直出 vault 插件目录（安装即用）。缺省落「测试库」——开发时用可造数据的库，
// 别把半成品推给主库；要装到主库就
// BZ_READER_VAULT="E:/Obsidian/叫我包仔/.obsidian/plugins/bz-reader"。
const VAULT_PLUGIN_DIR =
  process.env.BZ_READER_VAULT || "E:/Obsidian/测试/.obsidian/plugins/bz-reader";
const ACTIVE = "pro";

const DIST = path.join(process.cwd(), "dist");

/* 版本号只有一个来源：manifest.json。构建时再拼上时间戳，
   真机角标/日志里读到的就是「这一包到底是哪次构建」，不用手改常量。 */
const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "manifest.json"), "utf8"));
const BUILD_TAG = `${MANIFEST.version}+${new Date()
  .toISOString()
  .slice(0, 16)
  .replace(/[-:]/g, "")
  .replace("T", ".")}`;

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

/* 只有一个包：完整功能版。以前这里的「base 构建把高级模块换成空实现」
   （PRO_ONLY_STUBS / stubProModules）已经随双包一起撤掉；留着只会让下一个人
   以为还有两条产线。能力门控在运行期由激活码决定（data/entitlement.ts）。 */

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
    define: { __BZ_READER_PRO__: "true", __BZ_BUILD_TAG__: JSON.stringify(BUILD_TAG) },
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
