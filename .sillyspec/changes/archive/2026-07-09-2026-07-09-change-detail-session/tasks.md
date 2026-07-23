---
author: qinyi
created_at: 2026-07-09T18:08:00+08:00
---

# 任务清单（Tasks）

> 高层任务清单，按 design §5 的 3 Wave 分组。详细 Wave/依赖/执行顺序由后续 `sillyspec run plan` 细化为 plan.md。

## Wave 1 — 后端地基（数据模型 + 创建链路）

- **task-01**：`AgentSession` 加 `change_id`(FK changes.id, nullable, ON DELETE SET NULL) + `workspace_id`(FK workspaces.id, nullable) 列 + `ix_agent_sessions_change_id` 索引（`agent/model.py:373`）。
- **task-02**：Alembic 迁移 `add_change_workspace_to_agent_sessions`（先 `alembic heads` 确认单一 head，revision 唯一，down 接真实 head，downgrade DROP COLUMN）。
- **task-03**：`SessionCreateRequest`（`daemon/router.py:1502`）加可选 `change_id?`/`workspace_id?`；`create_session` 端点（:1675）透传。
- **task-04**：`DaemonService.create_session`（`session/service.py:319`）签名加 `change_id`/`workspace_id`；写入 AgentSession；workspace_id 非空时解析 cwd（复用既有路径解析）。
- **task-05**：dispatch 透传 workspace_id（R-02 接线：`prepare_interactive_dispatch` lease_meta 带 workspace_id，让 `lease/context.py` 解析 cwd/root_path）。补单测守护。
- **task-06**：`AgentSessionRead`（`daemon/schema.py:18`）回显 change_id/workspace_id。

## Wave 2 — 后端上下文 + 列表

- **task-07**：`build_change_context_preamble(db, change_id)`：拉 Change（标题/阶段）+ ChangeDocument（文档路径）+ `list_change_files`（已变更文件，X-01）拼【变更上下文】前导字符串。
- **task-08**：create_session 注入前导（X-02 纯后端）：dispatch prompt = `前导 + 用户消息`；`AgentRunLog(user_input)` 仍写干净 prompt（X-04）。
- **task-09**：新增 `GET /api/workspaces/{wid}/changes/{cid}/sessions`（change router，`require_permission(CHANGE_READ)`，X-03），返回该变更全部会话 + 作者 + 标题摘要。
- **task-10**：backend 单测：create_session 绑定/未绑定两路径、前导内容正确性、列表过滤（含跨成员）、零回归（旧 session 不出现）。

## Wave 3 — 前端接入

- **task-11**：`frontend/src/lib/daemon.ts`：`SessionCreateRequest`（:799）+ `createSession`（:831）加 `change_id?`/`workspace_id?`；新增 `listChangeSessions(wid,cid)`。
- **task-12**：`InteractiveSessionPanel`（`interactive-session-panel.tsx:114`）props 加可选 `changeId?`/`workspaceId?`；`handleSend`（:404）`createSession`（:427）带上。props 全可选保证 runtimes 零回归。
- **task-13**：新增 `change-session-section.tsx`：左历史列表（调 listChangeSessions）+「新建会话」+ 右复用 InteractiveSessionPanel + 切换历史会话恢复。
- **task-14**：变更详情页 `changes/[cid]/page.tsx` 在「Agent 执行日志」区块后插入 `<ChangeSessionSection workspaceId changeId />`。
- **task-15**：frontend 组件测试：区块渲染、props 透传、历史列表加载、新建会话带 change_id；runtimes 页 RuntimeSessionDialog 零回归。

## 验收（AC，待 plan 细化为 verify）

- AC-1：变更详情页出现会话区块，列表含该变更全部会话（跨成员，显作者）。
- AC-2：新建会话提问后，agent 首轮收到【变更上下文】前导 + 用户消息；用户消息在日志/列表中干净无前导。
- AC-3：切换变更 → 会话列表只含该变更的会话。
- AC-4：runtimes 页面会话零回归（不传 change_id 行为不变）。
- AC-5：迁移 down 可逆，backend 正常启动；PG（非 SQLite）验证迁移链无分叉。
