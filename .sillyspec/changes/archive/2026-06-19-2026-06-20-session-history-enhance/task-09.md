---
id: task-09
title: frontend reopenSession + getAgentSession API
priority: P0
depends_on: [task-05, task-06]
blocks: [task-10]
requirement_ids: [FR-2]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
---

## 修改文件
- `frontend/src/lib/daemon.ts`：新增 `reopenSession` + `getAgentSession`

## 覆盖来源
- design.md §4.3.3、§13；decisions D-002@v1；requirements FR-2

## 实现要求
1. `reopenSession(sessionId: string): Promise<SessionReopenResponse>` → `POST /api/daemon/sessions/{id}/reopen`，经 `apiFetch`
2. `getAgentSession(sessionId: string): Promise<AgentSessionRead>` → `GET /api/daemon/sessions/{id}`（task-06 端点），用于 reopen 后轮询 status
3. 新增 type `SessionReopenResponse = { session_id: string; status: string }`
4. 错误走 `apiFetch` 统一 `ApiError`（含 409 code：`DAEMON_SESSION_RESUME_UNSUPPORTED` / `DAEMON_SESSION_NO_AGENT_SESSION` / `DAEMON_SESSION_NOT_ACTIVE` / `DAEMON_OFFLINE`）

## 接口定义
- `reopenSession(sessionId): Promise<{ session_id: string; status: string }>`
- `getAgentSession(sessionId): Promise<AgentSessionRead>`
- 均用 `apiFetch`（自动 token 注入 + ApiError）

## 边界处理
1. **409 各错误码**：抛 `ApiError`（含 `.code`），调用方（task-11）按 code 决定按钮置灰/提示
2. **网络错误**：`apiFetch` 抛 `ApiError`（非业务码），调用方提示重试
3. **sessionId 编码**：`encodeURIComponent`（与现有 deleteAgentSession :733 一致）

## 非目标
- 不实现 UI（task-10/11）
- 不实现轮询逻辑（task-10）

## 参考
- 现有 API 模式：`lib/daemon.ts` `deleteAgentSession`（:732）/ `getAgentSessionLogs`（:742）

## TDD 步骤
1. 写测试：reopenSession 调 POST /sessions/{id}/reopen 返回 {session_id,status}；getAgentSession 调 GET 返回 AgentSessionRead；409 抛 ApiError 带 code
2. 确认失败
3. 实现两个函数 + type
4. 确认通过
5. 回归 daemon.test.ts

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | reopenSession(id) | POST /sessions/{id}/reopen，返回 {session_id, status} |
| AC-02 | getAgentSession(id) | GET /sessions/{id}，返回 AgentSessionRead |
| AC-03 | 409 响应 | 抛 ApiError，`.code` 为对应业务码 |
| AC-04 | daemon.test.ts 回归 | 全绿 |
