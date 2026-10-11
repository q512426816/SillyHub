---
author: flow-machine-draft
created_at: 2026-10-11T04:11:49.668Z
---
# 任务注册表（Tasks）— 2026-10-11-junction-fallback-backup-sweep

- [x] task-01: 测试先行：test_init_lease.test.ts 加 fs/promises 透传式 symlink mock + 半交换 symlink/mkdir 失败降级用例 + 备份清扫用例（utimes 构造 8 天/10 分钟备份 + 11/5 分钟 tmp）——旧实现先红
- [x] task-02: ensureSpecJunction 半交换收口：post-rename mkdir+symlink 收进 try/catch，失败 warn junction_create_failed_fallback + return false 走降级 pull——降级用例转绿
- [x] task-03: sweepStalePullScraps 增 .pre-junction-backup- 前缀 7 天保留期 + pullSpecBundle 顶部清扫调用（覆盖 repo-native 早返回路径）——清扫用例转绿，tmp/trash 零回归
- [x] task-04: 全文件回归 + daemon tsc 零错，显式 pathspec 提交（消息带 task-NN）
