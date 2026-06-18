---
author: qinyi
created_at: 2026-06-19T03:50:00
---

# 模块影响分析 — daemon-interactive-session

> 基于 git diff（commit 8afff51，76 文件）× `_module-map.yaml` 模块路径匹配。以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件（数）| 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend | 数据结构变更 + 接口变更 + 逻辑变更 + 配置变更 | 28（app 22 + tests 3 + migrations 2 + alembic.ini 1）| AgentSession 表 + lease.kind + agent_runs.agent_session_id FK（migration 202607040900）；session REST create/inject/interrupt/end + placement 两段式 dispatch（agent_run_id=NULL）；permission_service canUseTool 5min 超时；session SSE 聚合（stream_session_logs + 双 publish）；tool failure monitor；alembic.ini Windows gbk 编码修复 | false |
| sillyhub-daemon | 新增 + 逻辑变更 + 接口变更 + 配置变更 | 32（src 9 + tests 20 + package.json/.npmrc/pnpm-lock 3）| **新增 src/interactive/ SDK driver 层**（ClaudeSdkDriver + SessionManager + InputQueue + PermissionResolver + session-store-persistence + types）；daemon.ts kind 分流（batch→TaskRunner 零改动/interactive→SessionManager）+ WS 控制消息路由；protocol.ts 5 消息 + 4 payload；package.json 加 @anthropic-ai/claude-agent-sdk@0.3.181 + .npmrc pnpm.overrides 排 win32-x64 平台二进制 | **true**（src/interactive 全新模块；_module-map.yaml tag 仍标 daemon 为 [python,httpx,websockets] 已过时，实际 TypeScript/pnpm/vitest/SDK，doc-syncer 需更新模块文档 + tag）|
| frontend | 新增 + 逻辑变更 | 13（src 13）| 会话面板 InteractiveSessionPanel（演进 quick-chat，单一 SSE 贯穿多 turn）；permission-approval-card + permission-approval-dialog（审批卡/弹窗，复用 task-08 SSE 通道）；lib/daemon.ts session API + permission API；runtimes/page.tsx 会话列表 + live/历史切换 + SessionHistoryView；app/api/.../stream/route.ts SSE 代理 | false |

## 未匹配文件（不属于任何模块）

| 文件 | 说明 |
|---|---|
| `.sillyspec/changes/2026-06-18-daemon-interactive-session/*` | SillySpec 变更文档（proposal/design/plan/tasks/decisions/verify-result/module-impact 等），变更元数据非业务模块 |
| `.sillyspec/knowledge/uncategorized.md` | 知识库（新增 2 条环境坑：alembic.ini gbk 编码 + 全 Docker 部署 PG 端口未映射 host） |

## 影响类型汇总

- **数据结构变更**：backend（agent_sessions 表 + lease.kind + agent_session_id FK + migration）
- **接口变更**：backend（4 session REST + GET /sessions + GET /sessions/{id}/logs + GET /stream + permission REST/WS）、sillyhub-daemon（WS 5 控制消息 + SessionManager/Drier API + protocol 双侧契约）
- **新增模块**：sillyhub-daemon src/interactive/（SDK driver 层，与 TaskRunner 并存，D-002@v3 方案 A）
- **逻辑变更**：backend session 编排/SSE 聚合/tool failure monitor、sillyhub-daemon kind 分流/permission/resume、frontend 会话面板/列表/历史
- **配置变更**：sillyhub-daemon（SDK 依赖 + .npmrc pnpm.overrides）、backend（alembic.ini 编码修复）

## needs_review 说明

- **sillyhub-daemon = true**：src/interactive 是全新 SDK driver 层模块（ClaudeSdkDriver/SessionManager/PermissionResolver/session-store-persistence）；且 `_module-map.yaml` 的 sillyhub-daemon tags 仍标 `[python, httpx, websockets]`（**过时**，实际 TypeScript/pnpm/vitest/@anthropic-ai/claude-agent-sdk），doc-syncer 步骤必须更新模块文档 main_symbols/entrypoints/tags 为 TS 实际。
- backend = false：标准业务变更（数据模型 + REST + service），影响明确，无不确定。
- frontend = false：标准 UI 变更（会话面板 + permission 组件），影响明确。

## 三重交叉验证

- **声明范围**（design.md §6 文件清单）：与 git diff 一致（3 处合理 Reverse Sync 偏差已记 verify-result.md：main.py 未改 v3 前端承担 / schema.py 单数 / ws-client 单 onMessage）
- **任务范围**（plan.md 12 task / tasks/）：12 task 覆盖 git diff 全部业务文件（backend 28 + sillyhub-daemon 32 + frontend 13 = 73 业务文件 + 3 .sillyspec 元数据）
- **真实变更**（git diff 76 文件）：以 git diff 为准，模块匹配如上矩阵，无遗漏。
