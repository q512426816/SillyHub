---
author: qinyi
created_at: 2026-10-11 17:05:00
change: 2026-10-11-linked-repo-workspace-ref
plan_level: full
reason: 跨三端 13 文件含 schema 迁移；两任务串行依赖链清晰
estimated_files: 13
cross_module: true
has_schema_change: true
has_state_machine_change: false
needs_parallel_execution: false
needs_human_review: true
---

# 实现计划（Plan）— 2026-10-11-linked-repo-workspace-ref

## 分级判定

plan_level: **full**——schema 迁移+跨三端；但紧凑（2 任务串行 task-02←task-01），复用两前序变更基建。

## Wave 分组（纯 ID 引用）

### Wave 1：backend 迁移+模型+API+回显匹配
- task-01

### Wave 2：frontend 下拉+跳转+提示+gen:types
- task-02

依赖：task-02←task-01（ref-workspace-api 契约）。

## 全局硬约束（跨 task）

- 软删读时降级：摘要 join 与 matched 匹配一律 `deleted_at IS NULL` 过滤（Grill X-001）；DB SET NULL 仅防御。
- matched_workspace 仅 local_only 条目、限定当前用户可见工作区集（Grill X-002）、tie-break name→slug→id 最小。
- 挂载校验三路径（不存在/软删/自身）统一 422 REF_WORKSPACE_INVALID。
- PATCH null=摘除（exclude_unset 既有语义）。
- api-types 禁手写（pnpm gen:types）；禁跑全量测试（规则 0）。
- 不自动写库匹配、不双向、不级联删（D-002）。

## 模块影响

见 module-impact.md。
