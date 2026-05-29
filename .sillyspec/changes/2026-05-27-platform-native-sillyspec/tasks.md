---
author: qinyi
created_at: 2026-05-27 10:13:27
---

# Tasks

## Wave 1 — 数据层与基础设施

- [x] Spec workspace 数据模型与迁移
  - `backend/app/modules/spec_workspace/model.py`
  - `backend/migrations/versions/202606100900_create_spec_workspaces.py`

- [x] Agent spec profile manifest
  - `backend/app/modules/spec_profile/model.py`
  - `backend/app/modules/spec_profile/provider.py`
  - `backend/app/modules/spec_profile/schema.py`

- [x] StagePolicy / DocumentPolicy 冲突处理
  - `backend/app/modules/spec_profile/policy.py`

## Wave 2 — 扫描与 API

- [x] Workspace 创建流程允许普通项目
  - `backend/app/modules/workspace/scanner.py`
  - `backend/app/modules/workspace/service.py`
  - `backend/app/modules/workspace/schema.py`

- [x] Spec workspace API
  - `backend/app/modules/spec_workspace/router.py`
  - `backend/app/main.py`

- [x] AgentSpecBundle 上下文构建
  - `backend/app/modules/agent/base.py`
  - `backend/app/modules/agent/context_builder.py`

## Wave 3 — Agent 与前端

- [x] Claude Code adapter 消费完整规范 bundle
  - `backend/app/modules/agent/adapters/claude_code.py`
  - `backend/app/modules/agent/service.py`

- [x] Agent run 后台化与审计扩展
  - `backend/app/modules/agent/service.py`
  - `backend/app/modules/agent/model.py`
  - `backend/app/modules/agent/schema.py`

- [x] 前端工作区创建策略选择
  - `frontend/src/components/workspace-scan-dialog.tsx`
  - `frontend/src/lib/workspaces.ts`
  - `frontend/src/lib/spec-workspaces.ts`

## Wave 4 — 收尾

- [x] 前端 Agent 类型与执行入口修正
  - `frontend/src/lib/agent.ts`
  - `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx`

- [x] 设置页增加 spec profile 与 Agent 配置
  - `frontend/src/app/(dashboard)/settings/page.tsx`

- [x] 测试覆盖
  - `backend/app/modules/workspace/tests/test_service.py`
  - `backend/app/modules/spec_profile/tests/test_policy.py`
  - `backend/app/modules/agent/tests/test_context_builder.py`
  - `backend/app/modules/agent/tests/test_router.py`

## Wave 5 — V2 设计修正（ADR-04/05/06）

- [x] Spec Data Root 独立目录（ADR-04）
  - `backend/app/core/config.py` — 新增 `spec_data_root` 配置项
  - `backend/app/modules/spec_workspace/model.py` — `spec_root` 改为绝对路径
  - `backend/app/modules/spec_workspace/service.py` — `create` 使用 `spec_data_root` 计算路径
  - `backend/app/modules/workspace/service.py` — `_ensure_spec_workspace` 使用 `spec_data_root`
  - `backend/app/modules/component/service.py` — 改读 `spec_root`
  - `backend/app/modules/scan_docs/service.py` — 改读 `spec_root`
  - `backend/app/modules/change/service.py` — 改读 `spec_root`
  - `backend/app/modules/task/service.py` — 改读 `spec_root`

- [x] SillySpec CLI 作为 Agent 工具（ADR-05）
  - `backend/app/modules/agent/base.py` — `AgentSpecBundle` 新增 `available_tools` 字段
  - `backend/app/modules/agent/context_builder.py` — `build_spec_bundle` 包含 `available_tools`
  - `backend/app/modules/agent/adapters/claude_code.py` — 确保 `sillyspec` CLI 在执行环境中可用
  - `backend/app/modules/spec_workspace/bootstrap.py` — 新增 `SpecBootstrapService`
  - `backend/app/modules/spec_workspace/router.py` — 新增 `/spec-bootstrap` 端点

- [x] SpecValidator 程序验证（ADR-06）
  - `backend/app/modules/spec_workspace/validator.py` — 新增 `SpecValidator` 类
  - `backend/app/modules/spec_workspace/bootstrap.py` — bootstrap 完成后自动触发验证
  - 验证失败 → 写入 `SpecConflict` 记录，`sync_status = "dirty"`
  - 验证通过 → `sync_status = "clean"`

- [x] V2 测试覆盖
  - `backend/app/modules/spec_workspace/tests/test_validator.py`
  - `backend/app/modules/spec_workspace/tests/test_bootstrap.py`
  - 更新已有测试适配 `spec_data_root`

## Wave 6 — 部署验证与运行时修复

- [x] AgentRun FK 约束修复
  - `backend/app/modules/agent/model.py` — `task_id`/`lease_id` 改为 nullable（bootstrap 无真实 task/lease）
  - `backend/migrations/versions/202606120900_agent_runs_nullable_task_lease.py` — Alembic 迁移
  - `backend/app/modules/agent/service.py` — `list_runs` 兼容 nullable task_id

- [x] ClaudeCodeAdapter 环境变量与权限修复
  - `backend/app/modules/agent/adapters/claude_code.py` — 继承 `os.environ`（修复 ANTHROPIC_BASE_URL 丢失）
  - `backend/app/modules/agent/adapters/claude_code.py` — 添加 `--dangerously-skip-permissions`
  - `backend/app/modules/spec_workspace/bootstrap.py` — 超时从 600s 调整为 1800s
  - `backend/app/modules/spec_workspace/bootstrap.py` — run 状态由验证结果决定（不再依赖 CLI exit code）

- [x] 组件 Parser 兼容 SillySpec CLI 输出
  - `backend/app/modules/component/parser.py` — `id` 缺失时 fallback 到 `name` 字段

- [x] SpecValidator 兼容 SillySpec CLI 输出
  - `backend/app/modules/spec_workspace/validator.py` — 必填字段从 `{id,name,type}` 放宽为 `{name}`

## Wave 7 — 设计文档核对补齐

- [x] 侧边栏补齐 4 个缺失导航入口
  - `frontend/src/components/app-shell.tsx` — 添加拓扑图、运行时、知识&日志、发布

- [x] Runtime 页补齐 user-inputs 和 artifacts
  - `backend/app/modules/runtime/service.py` — 新增 `get_user_inputs_raw`/`get_artifacts`/`get_artifact_content`，改读 spec_root
  - `backend/app/modules/runtime/schema.py` — 新增 `UserInputEntry`/`ArtifactEntry`
  - `backend/app/modules/runtime/router.py` — 新增 4 个端点
  - `frontend/src/lib/runtime.ts` — 新增 API 客户端
  - `frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx` — 补齐用户输入记录、步骤产物、本地运行态标记

- [x] Workspace 详情页补充摘要信息
  - `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` — 新增组件数/活跃变更/归档变更/运行时阶段卡片
