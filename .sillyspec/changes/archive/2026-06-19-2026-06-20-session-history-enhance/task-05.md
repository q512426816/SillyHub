---
id: task-05
title: backend reopen_session 方法 + POST /sessions/{id}/reopen 路由 + 错误码
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-2]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/core/errors.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/
---

## 修改文件
- `backend/app/modules/daemon/service.py`：新增 `reopen_session`（方法骨架 + 校验，状态转换细节在 task-07）
- `backend/app/modules/daemon/router.py`：新增 `POST /sessions/{id}/reopen`（紧邻 inject :734 / end）
- `backend/app/core/errors.py`：新增错误码类
- `backend/app/modules/daemon/schema.py`：新增 `SessionReopenResponse`（`{session_id, status}`）
- 测试

## 覆盖来源
- design.md §4.3.1、§6.1、§13；decisions D-002@v1、D-004@v1；requirements FR-2

## 实现要求
1. `core/errors.py` 新增（沿用 AppError 子类体系，参考现有 DaemonSession* 错误）：
   - `DaemonSessionResumeUnsupported`（409）— provider≠claude
   - `DaemonSessionNoAgentSession`（409）— `agent_session_id IS NULL`（D-004）
   - `DaemonOffline`（409）— 目标 runtime 离线（如已有则复用）
2. `reopen_session(session_id, user_id)`：
   - `SELECT AgentSession FOR UPDATE` + ownership 校验（user_id，否则 404）
   - 前置校验（按序）：`provider != "claude"` → `DaemonSessionResumeUnsupported`；`agent_session_id is None` → `DaemonSessionNoAgentSession`；`status ∈ {active,pending,reconnecting}` → `DaemonSessionNotActive`（409，引导 inject）；目标 runtime 离线 → `DaemonOffline`
   - **task-07 补全**：状态转换 + 新 lease + rotate claim_token + 发 WS（本任务先 `session.status="reconnecting"` 占位 + commit + 返回）
   - 返回 `SessionReopenResponse(session_id=str(id), status="reconnecting")`（不阻塞等 confirm，design §4.3.1 step7）
3. router：`POST /api/daemon/sessions/{id}/reopen` → 调 `service.reopen_session`，返回 `SessionReopenResponse`

## 接口定义
- `reopen_session(session_id: UUID, user_id: UUID) -> SessionReopenResponse`
- `SessionReopenResponse(BaseModel)`：`session_id: str`、`status: str`
- 路由：`POST /sessions/{session_id}/reopen`，依赖 `require_auth`，调 `DaemonService().reopen_session(session_id, user.id)`

## 边界处理
1. **provider≠claude（codex）**：409 `DAEMON_SESSION_RESUME_UNSUPPORTED`
2. **agent_session_id IS NULL**：409 `DAEMON_SESSION_NO_AGENT_SESSION`（D-004，create 阶段失败的会话）
3. **status 仍 active/pending/reconnecting**：409 `DAEMON_SESSION_NOT_ACTIVE`（引导直接 inject）
4. **runtime 离线**：409 `DAEMON_OFFLINE`（reopen 需在线 daemon 执行 SDK resume）
5. **ownership 不匹配**：404 资源隐藏
6. **并发 reopen**：`FOR UPDATE` 行锁；二次 reopen 已 reconnecting → 被 status 校验拦（3）

## 非目标
- 不实现 SDK resume（daemon task-08）
- 不阻塞等 daemon confirm（异步，design §4.3.1）
- 不改 inject/end 现有逻辑

## 参考
- recover_session_after_daemon_restart：`service.py:2071-2234`（ownership/状态校验模式）
- create_session：`service.py:1587`（lease 建立模式，task-07 用）
- AppError 体系：`core/errors.py`

## TDD 步骤
1. 写测试：reopen ended claude 会话（有 agent_session_id）→ 200 `{status:"reconnecting"}`；各 409 场景
2. 确认失败（无端点）
3. 实现错误码 + reopen_session 骨架 + 路由
4. 确认通过；补 ownership 404 + 并发测试
5. 回归现有 session 测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | reopen ended claude 会话（有 agent_session_id） | 200 `{session_id, status:"reconnecting"}` |
| AC-02 | reopen codex 会话 | 409 RESUME_UNSUPPORTED |
| AC-03 | reopen agent_session_id=NULL 会话 | 409 NO_AGENT_SESSION |
| AC-04 | reopen active 会话 | 409 NOT_ACTIVE |
| AC-05 | reopen 目标 runtime 离线 | 409 OFFLINE |
| AC-06 | reopen 非本人会话 | 404 |
| AC-07 | 现有 session 测试回归 | 全绿 |
