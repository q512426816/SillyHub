---
id: task-06
title: backend protocol SESSION_RESUME 常量 + GET /sessions/{id} 单查端点
priority: P0
depends_on: []
blocks: [task-07, task-08]
requirement_ids: [FR-2]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/tests/
---

## 修改文件
- `backend/app/modules/daemon/protocol.py`：新增 `DAEMON_MSG_SESSION_RESUME` 常量
- `backend/app/modules/daemon/router.py`：新增 `GET /sessions/{id}`
- `backend/app/modules/daemon/service.py`：新增 `get_agent_session`
- 测试

## 覆盖来源
- design.md §4.3.1、§6.4、§13；decisions D-002@v1；requirements FR-2

## 实现要求
1. `protocol.py` 新增（紧邻 :41-43 的 SESSION_END）：
   `DAEMON_MSG_SESSION_RESUME = "daemon:session_resume"`
2. `service.get_agent_session(session_id, user_id) -> AgentSessionRead`：
   - ownership 校验（user_id 不匹配 → 404 资源隐藏）
   - 返回 `AgentSessionRead`（现有 schema，list 端点已用的序列化逻辑可抽公共 `_to_session_read`）
3. router `GET /api/daemon/sessions/{id}` → 调 `get_agent_session`（紧邻 list :765 / logs :822）

## 接口定义
- `protocol.py`：`DAEMON_MSG_SESSION_RESUME: str = "daemon:session_resume"`
- `get_agent_session(session_id: UUID, user_id: UUID) -> AgentSessionRead`
- 路由：`GET /sessions/{session_id}`，`require_auth`，返回 `AgentSessionRead`

## 边界处理
1. **session 不存在**：404
2. **ownership 不匹配**：404 资源隐藏（不泄漏存在性）
3. **AgentSessionRead 序列化**：复用 list 端点的字段映射（id/runtime_id/lease_id/provider/status/agent_session_id/config/turn_count/created_at/last_active_at/ended_at）
4. **常量与 daemon 侧同步**：daemon task-08 用同名字符串 `daemon:session_resume`（protocol.ts）

## 非目标
- 不实现 reopen 状态转换（task-07）
- 不改 list/logs 端点

## 参考
- 现有 WS 常量：`protocol.py:41-43`（SESSION_END）
- list 端点 AgentSessionRead 序列化：`router.py` list_sessions + service

## TDD 步骤
1. 写测试：GET /sessions/{id} 返回 AgentSessionRead；不存在/非本人 → 404
2. 确认失败（无端点）
3. 实现 get_agent_session + 路由 + protocol 常量
4. 确认通过
5. 回归

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | GET /sessions/{id}（本人） | 200 AgentSessionRead（含 status/agent_session_id） |
| AC-02 | GET 不存在 session | 404 |
| AC-03 | GET 非本人 session | 404 |
| AC-04 | protocol.py | `DAEMON_MSG_SESSION_RESUME="daemon:session_resume"` 定义 |
| AC-05 | 现有 session 测试回归 | 全绿 |
