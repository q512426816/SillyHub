import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // 套件含大量真实文件 I/O（tar 解包/打包、mkdtemp、spec sync 等），在并发 fork 池
    // （84 文件并行）下受磁盘争用 + Windows AV 扫描影响，vitest 默认 5s testTimeout
    // 偶发超时（task-09 pull/push 等用例在满载下轮流 flaky，单文件/隔离均 <100ms）。
    // 30s 在本机 20 核已够；但 GitHub runner（2-4 核）满载下仍偶发饿过 30s
    // （2026-08-23 两次 run 各挂一个重 I/O 用例：task-09 pull rm -rf 解包 /
    // task-runner skillRefs 清理，均纯超时非断言失败，下轮自愈）→ 上限提到 60s
    // 兜底；不影响正常用例（timeout 是上限，<5s 的用例照常秒过）。
    testTimeout: 60000,
    // 本机 20 核 → vitest 默认开 20 个 fork 并行跑 84 个测试文件，I/O 密集用例
    // （tar 解包/打包、mkdtemp、spec sync）在 20 路磁盘争用 + Windows AV 扫描下极端
    // 饥饿，最重的 task-09 .runtime 用例偶发跑到 30s+。限制并行度到 8（40% 核），
    // 显著降低磁盘争用。CI runner 只有 2-4 核，maxForks 8 是 2-4 倍超订阅
    // （2026-08-23 两次超时 flaky 的直接机制），CI 显式压到 4。
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: process.env.CI ? 4 : 8 } },
  },
});
