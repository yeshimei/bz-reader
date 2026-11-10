import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 构建期用 esbuild 的 define 注入这个标志；测试里必须有同一个名字，
  // 否则任何走到 `if (__BZ_READER_PRO__)` 的模块都会在 node 里抛 ReferenceError。
  define: {
    __BZ_READER_PRO__: 'true',
    __BZ_DEV__: 'true',
    __BZ_BUILD_TAG__: '"test"',
  },
  // 赞赏码是构建期 dataurl 内联的 png（esbuild 的 loader，见 esbuild.config.mjs）。
  // 测试里也要能 import：assetsInclude 让 Vite 当资源处理、返回一个路径字符串，
  // 不会去解析二进制。断言只看结构，不看 src 的内容。
  assetsInclude: ['**/*.png'],
  resolve: {
    // obsidian 只有类型没有运行时（main 为空），运行时 import 它会解析失败。
    // 凡是 import 了 Notice / Platform 的模块（core/notice、core/mobile）走这个替身。
    alias: {
      obsidian: fileURLToPath(new URL('./tests/helpers/obsidian-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // vendor/foliate 在模块顶层读 NodeFilter 等 DOM 常量，import 前先补上
    setupFiles: ['tests/helpers/globals-stub.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
});
