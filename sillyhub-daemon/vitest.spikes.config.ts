import { defineConfig } from 'vitest/config';

// spike 专用 vitest config（spikes 不在默认 vitest.config.ts 的 include 里，
// 默认 include=tests/**/*.test.ts）。spike 探索性代码不进 CI 主测试套件。
//
// 运行：pnpm vitest run --config vitest.spikes.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['spikes/**/*.test.ts'],
    globals: false,
    testTimeout: 30000,
    // stdio 子进程 spawn + mock backend HTTP，单文件串行跑更稳。
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
  },
});
