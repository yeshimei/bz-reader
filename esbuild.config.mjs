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

/** 样式组合：设计令牌 + 域样式，产物里不留 @import（Obsidian 只加载一个 styles.css） */
function buildStyles() {
  const parts = [path.join(process.cwd(), "src/core/ui/tokens.css"), path.join(process.cwd(), "src/styles.css")];
  const css = parts
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, "utf8"))
    .join("\n\n");
  fs.writeFileSync(path.join(process.cwd(), "styles.css"), css, "utf8");
  return css;
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
