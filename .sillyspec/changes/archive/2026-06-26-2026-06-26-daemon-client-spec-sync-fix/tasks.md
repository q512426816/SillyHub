---
author: qinyi
created_at: 2026-06-26 10:56:38
---

# Tasks — daemon-client workspace spec 树同步修复

任务只列名称、文件路径、覆盖的 FR/D。细节（Wave 分组、依赖、步骤）在 plan 阶段展开。

## Phase 1 — 契约对齐（B）

- **task-01** SpecPathResolver platform_managed mode + for_spec_workspace 工厂
  - 文件：`backend/app/core/spec_paths.py`
  - 覆盖：FR-01, FR-02, D-005@v1
- **task-02** scan_docs parser/service 按 mode 解析（去硬编码 `.sillyspec`）
  - 文件：`backend/app/modules/scan_docs/parser.py`、`backend/app/modules/scan_docs/service.py`
  - 覆盖：FR-01
- **task-03** runtime/service 按 for_spec_workspace 构造 resolver
  - 文件：`backend/app/modules/runtime/service.py`
  - 覆盖：FR-01（runtime 读端）
- **task-04** knowledge/service 重定向 spec_ws.spec_root + mode
  - 文件：`backend/app/modules/knowledge/service.py`、`backend/app/modules/knowledge/parser.py`
  - 覆盖：FR-03, R6
- **task-05** spec_workspace/validator projects 路径走 resolver
  - 文件：`backend/app/modules/spec_workspace/validator.py`
  - 覆盖：FR-01
- **task-06** post_scan_validator 核实并按 mode 适配（source_root vs spec_root 语义，R3）
  - 文件：`backend/app/modules/agent/post_scan_validator.py`
  - 覆盖：FR-01（核实，可能不改）
- **task-07** context_builder prompt platform-managed 分支去 `.sillyspec`
  - 文件：`backend/app/modules/agent/context_builder.py`
  - 覆盖：FR-04
- **task-08** Phase 1 测试：resolver mode 单测 + 各 reader 双模式单测 + server-local 回归测
  - 文件：`backend/app/modules/*/tests/`、`backend/app/core/tests/`
  - 覆盖：FR-01, FR-02, FR-03

## Phase 2 — sync 时机 + runtime（A + runtime）

- **task-09** daemon 抽 `syncSpecTreeIfNeeded` 可复用函数
  - 文件：`sillyhub-daemon/src/spec-sync.ts`
  - 覆盖：FR-05, D-002@v1
- **task-10** daemon scan run 终态触发 sync（interactive scan 专用）
  - 文件：`sillyhub-daemon/src/daemon.ts`
  - 覆盖：FR-05, D-002@v1
- **task-11** packSpecDir 不再排除 `.runtime`（push 路径）
  - 文件：`sillyhub-daemon/src/spec-sync.ts`
  - 覆盖：FR-06, R7
- **task-12** apply_sync 接收 `.runtime`（去 preserve-overwrite）+ 落 last_synced_at
  - 文件：`backend/app/modules/spec_workspace/service.py`
  - 覆盖：FR-06, FR-07
- **task-13** Phase 2 测试：scan 终态触发 sync daemon 单测 + apply_sync .runtime + last_synced_at 集成测 + double-sync 幂等测
  - 文件：`sillyhub-daemon/src/__tests__/`、`backend/app/modules/spec_workspace/tests/`
  - 覆盖：FR-05, FR-06, FR-07, NFR-02

## Phase 3 — daemon 代写 change（C）

- **task-14** backend daemon_change_writes 模型 + migration（或 daemon_task_leases.kind 扩展）
  - 文件：`backend/app/modules/daemon/model.py`、`backend/migrations/versions/`
  - 覆盖：FR-08, D-004@v1
- **task-15** backend 轮询/回执端点（pending-change-writes + claim/complete）
  - 文件：`backend/app/modules/daemon/change_write_router.py`、`backend/app/modules/daemon/router.py`
  - 覆盖：FR-08, NFR-05
- **task-16** change_writer proxy_create_change（runtime 校验 + 建任务 + 等回执 + 落库）+ proxy-create 端点 + schema
  - 文件：`backend/app/modules/change_writer/proxy.py`、`router.py`、`schema.py`、`service.py`
  - 覆盖：FR-08, FR-09
- **task-17** daemon task-runner `kind=change-write` 轻量分支（claim→本地写→sync，不启 agent）
  - 文件：`sillyhub-daemon/src/task-runner.ts`、`sillyhub-daemon/src/daemon.ts`
  - 覆盖：FR-08, FR-10, D-004@v1
- **task-18** 前端 changes 新建入口：daemon-client 调 proxy + 无 daemon 禁用引导
  - 文件：`frontend/src/.../changes`
  - 覆盖：FR-08, FR-09
- **task-19** Phase 3 测试：proxy_create_change 集成测 + daemon change-write handler 单测 + 无 session 错误测 + 超时兜底测 + 端到端（7cd27eb9 联调）
  - 文件：`backend/app/modules/change_writer/tests/`、`backend/app/modules/daemon/tests/`、`sillyhub-daemon/src/__tests__/`
  - 覆盖：FR-08, FR-09, FR-10, NFR-03, NFR-04
