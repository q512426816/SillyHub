---
author: qinyi
created_at: 2026-10-10 19:15:00
change: 2026-10-10-workspec-maintenance
plan_level: full
reason: 三端跨模块（backend/daemon/frontend）+ 三表 schema 迁移 + WS RPC 协议扩展，17 文件，需 Wave 编排与跨 task 契约对账
estimated_files: 17  # = design 文件清单 19 行扣除 2 个再生成产物（api-types.ts/openapi.json）
cross_module: true
has_schema_change: true
has_state_machine_change: false
needs_parallel_execution: false
needs_human_review: true
---

# 实现计划（Plan）— 2026-10-10-workspec-maintenance

## 分级判定

- plan_level: **full**——design.md scale=large，跨 backend/sillyhub-daemon/frontend 三端，
  新增三表（schema 变更）+ WS RPC 协议扩展 + 前端新卡片，任务间存在 provides/expects_from
  契约链（db-schema → crud-api/sync-rpc → daemon-sync/linked-repos-ui → typed-api）。
- 串行 Wave（needs_parallel_execution=false）：单会话顺序执行；task-04 与 task-05 理论可并行
  （不同仓），但按共享上下文与 R-05 顺序约束收进独立 Wave 顺序执行，降低协调成本。

## Wave 分组（纯 ID 引用，任务语义见 tasks/task-NN.md）

### Wave 1：backend 数据层
- task-01

### Wave 2：backend CRUD API
- task-02

### Wave 3：backend 同步编排
- task-03

### Wave 4：daemon 落盘链路
- task-04

### Wave 5：frontend 卡片
- task-05

### Wave 6：类型再生成与联调收尾
- task-06

依赖关系：task-02←task-01；task-03←task-01,02；task-04←task-03；task-05←task-02,03；
task-06←task-02,03,04,05。契约链（provides/expects_from）已在各任务卡 frontmatter 对齐：
task-01 提供 db-schema；task-02 提供 crud-api；task-03 提供 sync-rpc（消费 db-schema/crud-api）；
task-04 提供 daemon-sync（消费 sync-rpc）；task-05 提供 linked-repos-ui（消费 crud-api/sync-rpc）；
task-06 消费全部（含 daemon-sync 的跨端冒烟）并产出 typed-api。

## 全局硬约束（跨 task，逐字自 design.md）

- 路由挂载：linked_repos router 在 backend/app/main.py sibling include（仿 members_router
  先例 backend/app/main.py:867）；**禁止**在 workspace/router.py 嵌套挂载（main.py:864-868
  注释警告 `ValueError: Duplicated param name workspace_id`）。
- 落盘一律经 sillyspec CLI 命令（spawn `workspace add` / `register-repo`），daemon 不拼 yaml、
  不手改 local.yaml（D-008）。
- spawn 一律 execFile 数组形参（不经 shell 拼接），路径统一正斜杠化（R-06，Windows 安全）。
- 落库唯一通道 = daemon REST 回报端点；RPC 响应仅即时反馈不写 sync_states（分层要点 4）。
- RPC 超时：base 30s + 每仓 15s，上限 180s。
- frontend/src/lib/api-types.ts 禁手写，一律 `pnpm gen:types`（CLAUDE.md 规则 21）；
  gen:types 前验 node_modules 健康。
- 禁跑全量测试，仅跑本变更模块相关测试（CLAUDE.md 规则 0）。
- 兼容 Windows/Linux/macOS；对既有心跳/lease 协议 additive。
- R-05 顺序约束：task-04 开工前确认活跃变更 2026-10-10-borrow-sandbox-workspace-context
  已收口归档（同触 sillyhub-daemon/src/daemon.ts；protocol.ts 为本变更新增触点，无冲突）。
- 前端样式：FRONTEND_PAGE_STYLE.md 工作台页面规范（primer 结构组件 + antd 控件 +
  brand-* 语义阶 + themes.ts 单一源 + 空值 —）。

## 模块影响

见 module-impact.md（首版，plan 阶段生成；execute 后按实际改动复核）。
