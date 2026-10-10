---
author: qinyi
created_at: 2026-10-10 23:30:00
change: 2026-10-10-linked-repos-local-echo
plan_level: full
reason: 跨三端（daemon/backend/frontend）14 文件；无 schema 变更；单链路 4 任务串行，复用上一变更同域基建
estimated_files: 14
cross_module: true
has_schema_change: false
has_state_machine_change: false
needs_parallel_execution: false
needs_human_review: true
---

# 实现计划（Plan）— 2026-10-10-linked-repos-local-echo

## 分级判定

- plan_level: **full**——design.md scale=large，跨三端；但紧凑单链路（4 任务串行，
  依赖链 task-01→02→03→04），复用 2026-10-10-workspec-maintenance 的卡片/编排/任务卡基建。

## Wave 分组（纯 ID 引用）

### Wave 1：daemon 只读快照
- task-01

### Wave 2：backend 快照端点与对照
- task-02

### Wave 3：backend 导入端点
- task-03

### Wave 4：前端本机现状区与类型再生成
- task-04

依赖关系：task-02←task-01；task-03←task-02；task-04←task-02,03。契约链：
task-01 提供 daemon-snapshot → task-02 消费并提供 snapshot-api → task-03 消费（前端条目
形态）并提供 import-api → task-04 消费 snapshot-api/import-api。

## 全局硬约束（跨 task）

- daemon 快照**只读铁律**：只 spawn `workspace status --json` 与 `config cat --spec-dir`，
  零写盘（D-005）；禁用任何写命令。
- config cat 输出只提取 repos: 段与 projects: 块（R-02 最小面），其余内容不出 daemon。
- 对照期双源合并（Grill Gap A）：同名 projects/repos 条目合并单条，rel_path 取 projects
  源、abs_path 取 repos 源；导入一次落 rel_path+my_path 双字段。
- binding_missing 不冒泡 409（Gap B）；四态降级（ok/offline/unsupported/binding_missing）。
- spawn 一律 execFile 数组形参；config cat 显式 `--spec-dir <工作区根>` 钉住定位。
- frontend api-types 禁手写（pnpm gen:types）；不自动拉快照（D-003 手动刷新）。
- 禁跑全量测试，仅跑本变更模块（CLAUDE.md 规则 0）。
- 不动既有下行链路（登记 CRUD/同步/落盘/状态回环）任何行为。

## 模块影响

见 module-impact.md（首版）。
