---
author: flow-machine-draft
created_at: 2026-10-11T04:49:03.217Z
---
# 任务注册表（Tasks）— 2026-10-11-linked-repos-path-guard

- [x] task-01: 测试先行：linked-repos-snapshot/sync 两测试文件新增形态校验用例（相对 root_path 抛错 / 三绝对形态放行 / rel_path 绝对形态层 failed / abs_path 相对形态层 failed / 非法层零 spawn）——旧实现先红
- [x] task-02: 新增 linked-repos-path.ts（isAbsoluteLikePath 纯函数，平台无关三形态）+ 快照/同步入口 root_path 守卫——FR-01/02 用例转绿
- [x] task-03: sync 逐仓 rel_path 相对形态 / abs_path 绝对形态校验（违者层 failed 不 spawn，合法约定零回归）——FR-03/04/05 用例转绿
- [x] task-04: 两测试文件全量回归 + daemon tsc 零错 + 显式 pathspec 提交（消息带 task-NN）
