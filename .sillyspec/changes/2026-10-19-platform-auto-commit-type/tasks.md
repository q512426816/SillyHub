---
author: flow-machine-draft
created_at: 2026-10-19T03:07:50.552Z
---
# 任务注册表（Tasks）— 2026-10-19-platform-auto-commit-type

- [x] task-01: C 件 parser：reparse 对含 timeline.md 的变更，从「任务面」锚定哈希 × 🔀 行标题提取白名单内主类型（优先级 feat/fix > perf/refactor/test > docs/style > build/chore/revert），作权威类型（允许覆盖；flow-state.yaml 显式 commit_type 字段仍最优先，目录推断兜底不变）；无 timeline/无锚定哈希/无命中类型 → 回落不写
- [x] task-02: B 件同步重扫：spec-sync 落盘 ops 后，路径命中 flow-state.yaml 或 timeline.md 的变更键集合非空时，以后台任务对该集合跑 scoped reparse（独立 session、失败仅告警不阻断同步响应）
- [x] task-03: 聚焦测试：timeline 提取用例（含并行噪音排除/截断标题/无锚回退）+ 键集合提取纯函数用例 + 既有 parser/reparse 测试零回归；ruff/mypy 干净
- [x] task-04: 部署 dogfood：生产部署后对既有两工作区重扫描，timeline 可提取的变更类型分布扩大（此前 no_match 部分被补上），后续新归档变更无需任何人工操作自动带类型
