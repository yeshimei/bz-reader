import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 构建期用 esbuild 的 define 注入这个标志；测试里必须有同一个名字，
  // 否则任何走到 `if (__BZ_READER_PRO__)` 的模块都会在 node 里抛 ReferenceError。
  define: {
    __BZ_READER_PRO__: 'true',
  },
  resolve: {
    // obsidian 只有类型没有运行时（main 为空），运行时 import 它会解析失败。
    // 凡是 import 了 Notice / Platform 的模块（core/notice、core/mobile）走这个替身。
    alias: {
      obsidian: fileURLToPath(new URL('./tests/helpers/obsidian-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
});
