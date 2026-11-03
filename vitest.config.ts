import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 构建期用 esbuild 的 define 注入这个标志；测试里必须有同一个名字，
  // 否则任何走到 `if (__BZ_READER_PRO__)` 的模块都会在 node 里抛 ReferenceError。
  define: {
    __BZ_READER_PRO__: 'true',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
});
