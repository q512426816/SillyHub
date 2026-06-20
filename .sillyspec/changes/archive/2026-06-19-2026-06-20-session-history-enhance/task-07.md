---
id: task-07
title: backend reopen 状态转换 ended/failed→reconnecting + 新 lease + rotate claim_token + 发 daemon:session_resume
priority: P0
depends_on: [task-05, task-06]
blocks: [task-08]
requirement_ids: [FR-2]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/service.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/tests/
---

## 修改文件
- `backend/app/modules/daemon/service.py`：`reopen_session` 状态转换部分（在 task-05 骨架上补全）
- `backend/app/modules/agent/placement.py`：可能复用 `prepare_interactive_dispatch` 建 interactive lease（:375-385）
- 测试

## 覆盖来源
- design.md §4.3.1、§6.1、§6.2、§6.4、§13、§14；decisions D-002@v1；requirements FR-2

## 实现要求
1. 在 task-05 的 `reopen_session` 校验通过后，补全状态转换：
   - `session.status = "reconnecting"`
   - 新建 interactive lease：复用 `prepare_interactive_dispatch` 或直接建 `DaemonTaskLease(kind="interactive", runtime_id=<runtime.id>, status="pending", claim_token=secrets.token_hex(32), metadata={...})`；**不复活原 completed lease**（原 lease 保留，design §6.2）
   - `session.lease_id = <新lease.id>`；若切换 daemon 则 `session.runtime_id = <新runtime.id>`
   - `session.last_active_at = now`
   - commit
2. 发 WS `daemon:session_resume`（task-06 常量）via `send_session_control`，payload（design §6.4）：
   `{session_id, lease_id, agent_session_id, cwd, provider, runtime_id}`（best-effort，失败 warn 不回滚本地 reconnecting）
3. ⚠️ 实现时验证点（design §14）：确认 daemon resume 成功后 `markReconnected` → backend `confirm_session_reconnected`（:2352）的校验（runtime_id/lease_id/claim_token/kind==interactive）对**新建 lease + rotate token** 友好；若 confirm 校验绑定旧 lease 则需在 task-07 同步放宽/适配 confirm 校验

## 接口定义
- WS payload `daemon:session_resume`：`{session_id: str, lease_id: str, agent_session_id: str, cwd: str|null, provider: str, runtime_id: str}`
- reopen 后 session：`status="reconnecting"`、`lease_id`=新 lease、`agent_session_id`**不变**（resume key）

## 边界处理
1. **原 lease 已 completed**：不复活，新建独立 interactive lease；session.lease_id 指向新 lease
2. **claim_token rotate**：新 lease 新 token，confirm 链路用新 token
3. **切换 daemon（runtime_id 变）**：更新 session.runtime_id + 新 lease 绑定新 runtime
4. **WS 发送失败（daemon 离线）**：best-effort（send_session_control warn），本地仍 status=reconnecting；daemon 重连后由其拉取/或前端轮询发现
5. **cwd**：从 session.cwd（model.py 有该字段）取，传给 daemon resume（SDK resume 需 cwd 一致）
6. **agent_session_id 保留**：resume 的 key，绝不清空/变更

## 非目标
- 不实现 daemon 侧 resume（task-08）
- 不阻塞等 confirm（异步）
- 不改 end/inject

## 参考
- lease 建立：`placement.py:375-385`（prepare_interactive_dispatch）
- confirm 链路：`service.py:2352` confirm_session_reconnected
- send_session_control：`service.py:2010-2029`

## TDD 步骤
1. 写测试：reopen 后 session.status=reconnecting、有新 interactive lease（原 lease 仍 completed）、agent_session_id 不变、WS 消息发出（mock send_session_control）
2. 确认失败（task-05 骨架无 lease/WS）
3. 实现状态转换 + 新 lease + WS
4. 确认通过；补切换 daemon + WS 失败 best-effort 测试
5. ⚠️ 手动/集成验证 confirm 链路对新 lease 友好（design §14）

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | reopen 后 session | `status="reconnecting"`、`agent_session_id` 不变 |
| AC-02 | 新 lease | 新建一条 `kind="interactive"` lease，session.lease_id 指向它；原 lease 仍 completed |
| AC-03 | WS 消息 | `send_session_control` 以 `daemon:session_resume` + 完整 payload 调用 |
| AC-04 | 切换 daemon | session.runtime_id + 新 lease runtime 更新 |
| AC-05 | WS 失败 | 本地仍 reconnecting（best-effort 不回滚） |
| AC-06 | confirm 链路 | daemon resume 后 confirm_session_reconnected 能切 active（design §14 验证点） |
