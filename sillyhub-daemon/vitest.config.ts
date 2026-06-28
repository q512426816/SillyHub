import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // 套件含大量真实文件 I/O（tar 解包/打包、mkdtemp、spec sync 等），在并发 fork 池
    // （84 文件并行）下受磁盘争用 + Windows AV 扫描影响，vitest 默认 5s testTimeout
    // 偶发超时（task-09 pull/push 等用例在满载下轮流 flaky，单文件/隔离均 <100ms）。
    // 30s 给足余量；不影响正常用例（timeout 是上限，<5s 的用例照常秒过）。
    testTimeout: 30000,
    // 本机 20 核 → vitest 默认开 20 个 fork 并行跑 84 个测试文件，I/O 密集用例
    // （tar 解包/打包、mkdtemp、spec sync）在 20 路磁盘争用 + Windows AV 扫描下极端
    // 饥饿，最重的 task-09 .runtime 用例偶发跑到 30s+。限制并行度到 8（40% 核），
    // 显著降低磁盘争用；CI 环境（通常 ≤8 核）天然不受影响。
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 8 } },
  },
});
