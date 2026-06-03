---
author: qinyi
created_at: 2026-06-03T20:45:00+08:00
---

# 模块影响分析

> 说明：`.sillyspec/workflows/archive-impact.yaml` 不存在，按规则提示并继续。
> 本变更为历史变更，提交已与后续修复交织，`git diff HEAD~1` 无法准确对应；
> 以 design.md「文件变更清单」声明范围为依据，结合 `_module-map.yaml`（顶层粒度）匹配模块。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 逻辑变更 / 接口变更 | `backend/app/modules/spec_workspace/bootstrap.py`、`router.py`、`tests/test_bootstrap.py`；`backend/app/modules/agent/router.py`、`service.py` | spec bootstrap 从直接 CLI 改为异步 AgentRun + ClaudeCodeAdapter 后台执行 + 验证收尾；`/spec-bootstrap` 立即返回 run 信息；新增 AgentRun 用户指导输入记录与 SSE 推送 | false |
| frontend | 逻辑变更 / 接口变更 | `frontend/src/lib/spec-workspaces.ts`、`agent.ts`；`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`、`agent/page.tsx` | BootstrapResult 改为 run/stream 语义；新增用户指导提交 API；Workspace 详情页内联连接 SSE 展示日志与输入；Agent 控制台展示 pending input 入口 | false |
| sillyspec | 文档同步 | `.sillyspec/docs/backend/modules/spec_workspace.md`、`agent.md`；`.sillyspec/docs/frontend/scan/INTEGRATIONS.md`、`PROJECT.md` | 记录 bootstrap Agent 执行链路、用户指导事件、SSE 行为与 Workspace 初始化流程 | false |

## 未匹配文件

无。所有声明的变更文件均匹配到已知模块。

## 数据模型影响

不新增表，复用现有模型（`AgentRun`、`AgentRunLog`、`AgentRunWorkspace`、`SpecWorkspace`、`SpecConflict`、`AuditLog`）。新增字符串约定通道 `user_input` / `pending_input`，不改 schema enum。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml`（backend/frontend/sillyspec） | 顶层模块 paths/depends_on/used_by/entrypoints 均未变化 | 无需更新 |
| `modules/spec_workspace.md` | bootstrap 异步执行语义（AgentRun + ClaudeCodeAdapter）已在 execute task-09 同步（提交 aeaf8c0） | 已是最新 |
| `modules/agent.md` | `submit_run_input()`、`POST /runs/{id}/input`、`pending_input`/`user_input` 通道约定已在 execute task-09 同步 | 已是最新 |
| `frontend/scan/INTEGRATIONS.md`、`PROJECT.md` | bootstrap stream/API 交互与 Workspace 初始化流程已在 execute 阶段同步 | 已是最新 |

> 模块卡片在变更 execute 阶段（task-09）已随代码同步更新，归档阶段核验确认语义完整，无需重复修改。
