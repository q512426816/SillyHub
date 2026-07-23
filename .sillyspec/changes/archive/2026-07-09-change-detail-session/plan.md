---
author: qinyi
created_at: 2026-07-09T18:30:00+08:00
plan_level: full
---

# 实现计划（Plan）— 变更详情页内嵌会话

## Spike 前置验证

无 Spike。主要技术不确定性已在 brainstorm Design Grill 解决：
- R-03（前导注入）→ 纯后端方案，零 daemon 改动（X-02）
- R-04（已变更文件来源）→ 复用 `list_change_files` service（X-01）
- R-02（dispatch workspace_id 透传）→ 已定位集成点 `prepare_interactive_dispatch`

## Wave 1（后端地基：数据模型 + 创建链路）

- [x] task-01: AgentSession 加 change_id + workspace_id 列 + 索引（覆盖：FR-01, D-001@v1）
- [x] task-02: Alembic 迁移 add_change_workspace_to_agent_sessions（覆盖：FR-01）
- [x] task-03: SessionCreateRequest + POST /sessions 端点加 change_id?/workspace_id?（覆盖：FR-02, D-001@v1）
- [x] task-04: create_session service 写入绑定 + 解析 cwd（覆盖：FR-01, D-003@v1）
- [x] task-05: dispatch 透传 workspace_id（prepare_interactive_dispatch lease_meta 接线，R-02）（覆盖：FR-01, D-003@v1）
- [x] task-06: AgentSessionRead DTO 回显 change_id/workspace_id（覆盖：FR-02）

## Wave 2（后端上下文 + 列表，依赖 Wave 1）

- [x] task-07: build_change_context_preamble（标题/阶段/文档路径/list_change_files 文件清单）（覆盖：FR-03, D-004@v1）
- [x] task-08: create_session 注入前导（dispatch prompt=前导+用户消息；AgentRunLog 存干净 prompt，X-02/X-04）（覆盖：FR-03, D-004@v1）
- [x] task-09: GET /workspaces/{wid}/changes/{cid}/sessions 列表端点（跨成员，CHANGE_READ，X-03）（覆盖：FR-04, D-005@v1）
- [x] task-10: backend 单测（绑定/未绑定/前导/列表过滤/零回归）（覆盖：FR-01~04）

## Wave 3（前端接入，依赖 Wave 1+2）

- [x] task-11: lib/daemon.ts createSession 加字段 + listChangeSessions（覆盖：FR-02, FR-04）
- [x] task-12: InteractiveSessionPanel props 加 changeId?/workspaceId? 并透传 createSession（覆盖：FR-05, D-002@v1）
- [x] task-13: 新建 change-session-section.tsx（左历史列表+新建+右复用 Panel+切换恢复）（覆盖：FR-05, D-005@v1）
- [x] task-14: 变更详情页插入 ChangeSessionSection（执行日志区块后）（覆盖：FR-05）
- [x] task-15: frontend 组件测试（区块渲染/props 透传/历史/新建带 change_id/runtimes 零回归）（覆盖：FR-05）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | AgentSession 加列+索引 | W1 | P0 | — | FR-01, D-001 | model.py:373 |
| task-02 | Alembic 迁移 | W1 | P0 | task-01 | FR-01 | down 接真实 head（迁移链风险 R-01） |
| task-03 | SessionCreateRequest+端点扩展 | W1 | P0 | task-01 | FR-02, D-001 | daemon/router.py:1502/1675 |
| task-04 | create_session 写绑定+解析 cwd | W1 | P0 | task-01 | FR-01, D-003 | session/service.py:319 |
| task-05 | dispatch 透传 workspace_id | W1 | P0 | task-04 | FR-01, D-003 | lease/context.py 接线（R-02） |
| task-06 | AgentSessionRead 回显 | W1 | P1 | task-01 | FR-02 | daemon/schema.py:18 |
| task-07 | build_change_context_preamble | W2 | P0 | task-01 | FR-03, D-004 | 新建 session/context.py，复用 list_change_files（X-01） |
| task-08 | create_session 注入前导 | W2 | P0 | task-04, task-07 | FR-03, D-004 | 纯后端注入（X-02/X-04） |
| task-09 | 变更级会话列表端点 | W2 | P0 | task-01 | FR-04, D-005 | change/router.py，CHANGE_READ（X-03） |
| task-10 | backend 单测 | W2 | P0 | task-08, task-09 | FR-01~04 | 覆盖两路径+前导+过滤+零回归 |
| task-11 | 前端 lib createSession+list | W3 | P0 | task-03, task-06, task-09 | FR-02, FR-04 | lib/daemon.ts:799/831 |
| task-12 | Panel props 透传 | W3 | P0 | task-11 | FR-05, D-002 | interactive-session-panel.tsx:114/427 |
| task-13 | 新建 change-session-section | W3 | P0 | task-11, task-12 | FR-05, D-005 | 左历史+右 Panel+切换恢复 |
| task-14 | 变更详情页插入区块 | W3 | P0 | task-13 | FR-05 | changes/[cid]/page.tsx |
| task-15 | frontend 组件测试 | W3 | P0 | task-13, task-14 | FR-05 | 含 runtimes 零回归守护 |

## 关键路径

task-01 → task-04 → task-05 → task-08 → task-13 → task-14 → task-15（最长依赖链，决定交付周期）

## 全局验收标准

- [ ] 所有单元测试通过（backend + frontend，零既有回归）
- [ ] （brownfield）未传 change_id/workspace_id 时所有既有路径行为不变（runtimes 页零回归）
- [ ] 变更详情页出现会话区块，列出该变更全部会话（跨成员，显作者）
- [ ] 新建会话首轮 agent 收到【变更上下文】前导（标题/阶段/工作目录/文档路径/已变更文件）+ 用户消息；用户消息在日志/列表中干净无前导
- [ ] 切换变更 → 会话列表只含该变更的会话
- [ ] Alembic 迁移可逆（down 删列），backend 正常启动；PG（非 SQLite）验证迁移链无分叉

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-06 | AC: 迁移可逆 + 字段持久化 + 回显 |
| D-002@v1 | task-12, task-15 | AC: 复用既有权限配置 + runtimes 零回归 |
| D-003@v1 | task-04, task-05 | AC: cwd=workspace 本地根（dispatch 透传） |
| D-004@v1 | task-07, task-08 | AC: 前导注入且用户消息干净 |
| D-005@v1 | task-09, task-13 | AC: 列表跨成员可见 + 显作者 |
| FR-01 | task-01, task-02, task-04, task-05 | AC: 绑定持久化 + 未绑定零回归 |
| FR-02 | task-03, task-06, task-11 | AC: 端点接收 + DTO 回显 |
| FR-03 | task-07, task-08 | AC: 前导内容完整 + 注入 |
| FR-04 | task-09, task-11 | AC: 列表过滤正确 |
| FR-05 | task-12, task-13, task-14, task-15 | AC: 区块渲染 + 新建/切换 |

## 跨任务契约（自查，plan-postcheck 硬校验）

- **change_id/workspace_id 字段链**：task-03(router 请求) → task-04(service 接收) → task-06(DTO 回显) → task-11(前端 lib 发送) → task-12(panel 透传)，五处字段名统一为 `change_id` / `workspace_id`（snake_case 后端，前端 lib 同名）。
- **前导注入契约**：task-07 `build_change_context_preamble(db, change_id) -> str` 被 task-08 调用；返回纯文本前导。
- **列表响应契约**：task-09 响应 `AgentSessionListItem{id,provider,status,turn_count,author{user_id,display_name},last_active_at,title}` 被 task-11 listChangeSessions / task-13 消费。

## 文件覆盖自查（design 文件变更清单 ↔ task）

| design 文件 | 覆盖 task |
|---|---|
| backend/app/modules/agent/model.py | task-01 |
| backend/app/migrations/versions/<rev>_add_change_workspace_to_agent_sessions.py | task-02 |
| backend/app/modules/daemon/router.py | task-03 |
| backend/app/modules/daemon/session/service.py | task-04, task-08 |
| backend/app/modules/daemon/schema.py | task-06 |
| backend/app/modules/daemon/session/context.py（新） | task-07 |
| backend/app/modules/change/router.py | task-09 |
| backend/app/modules/daemon/lease/context.py | task-05 |
| frontend/src/lib/daemon.ts | task-11 |
| frontend/src/components/daemon/interactive-session-panel.tsx | task-12 |
| frontend/src/components/changes/change-session-section.tsx（新） | task-13 |
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | task-14 |

全部 12 文件被覆盖，无遗漏。
