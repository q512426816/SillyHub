---
id: task-01
title: backend create_session/inject_session 落 AgentRunLog(channel=user)
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-1]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/tests/
---

## 修改文件
- `backend/app/modules/daemon/service.py`：`create_session`（:1587）、`inject_session`（:1770）
- 测试：`backend/app/modules/daemon/tests/`（新建 test_session_user_log.py 或加入现有 session 测试）

## 覆盖来源
- design.md §4.1、§5、§13；decisions.md D-001@v1、D-005@v1；requirements FR-1

## 实现要求
1. `create_session`：建首 `AgentRun`（:1659 附近）flush 之后、发 `SESSION_INJECT` WS（:1696）之前，插入一条 `AgentRunLog(run_id=<首run.id>, channel="user", content_redacted=<脱敏 prompt>, timestamp=<now UTC>)`
2. `inject_session`：建新 `AgentRun`（:1815）之后、发 `SESSION_INJECT`（:1850）之前，插入同样一条 user log（`run_id=<新run.id>`）
3. 脱敏：复用现有 `content_redacted` 写入路径（与 `submit_messages` 写 agent 输出一致的脱敏机制），user channel 显式写，**不经** `_channel_from_event_type`（:2753）
4. `get_agent_session_logs`（:2511）SQL **不改**：现有 JOIN 已返回该 session 全部 AgentRunLog，user log 天然按 run 分组、anchor_ts 排序不变
5. 无 Alembic migration（`AgentRunLog.channel` 为 String 列，新增取值 `"user"` 无需 DDL）

## 接口定义
- `AgentRunLog` 字段（`agent/model.py:237-264`）：`id` / `run_id`(FK) / `timestamp` / `channel`(String) / `content_redacted`(String)
- channel 新增合法取值：`"user"`（与现有 `stdout/stderr/tool_call` 并列，无枚举约束）
- 插入：`session.add(AgentRunLog(run_id=<run.id>, channel="user", content_redacted=<脱敏prompt>, timestamp=datetime.now(timezone.utc)))`，随所在事务 commit

## 边界处理
1. **prompt 为空**：`SessionCreateRequest`/`SessionInjectRequest` schema 已 `min_length=1`（router.py:548/566）拦截，不触达
2. **inject turn conflict（409，有 active run）**：`inject_session` 在建 run 前返回（:1804-1812），不插 user log（无 run 可挂）✓
3. **inject WS 发送失败、run 收敛 failed**（:1861-1878）：user log 已插入（run 存在但 failed），回看可见该 prompt + failed run（用户确实发过，合理）
4. **create 失败（lease/runtime 错）**：在插 user log 前 raise，事务回滚，不插
5. **timestamp 排序**：user log 用插入时刻 now，早于 daemon 运行后写入的 agent log → 同 run 内 user 在前，跨 run anchor_ts 正确
6. **脱敏**：prompt 可能含敏感信息，必须经 content_redacted 脱敏，不写明文 content

## 非目标
- 不改 `get_agent_session_logs` SQL
- 不补存量历史会话的 prompt（D-005）
- 不给 AgentRun/AgentSession 加 prompt 字段
- 不改前端（task-02 负责）

## 参考
- 现有 user message 模式：`submit_messages` 写 agent 输出 log（service.py，含脱敏）
- `AgentRunLog` model：`backend/app/modules/agent/model.py:237-264`

## TDD 步骤
1. 写测试：`create_session` 成功后查 DB 有 1 条 `channel="user"` log，`run_id`=首 run
2. 确认失败（当前不落库）
3. 实现 create 落 user log
4. 确认通过；补 inject 落 user log 测试 + inject turn conflict 不插测试 + get_agent_session_logs 返回 user log 测试
5. 回归现有 session 测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | create_session 成功后查 `agent_run_logs` | 有 1 条 `channel="user"`、`run_id`=首 run、`content_redacted`=脱敏 prompt |
| AC-02 | inject_session 成功后查 | 新增 1 条 `channel="user"`、`run_id`=新 run |
| AC-03 | inject 在 turn conflict（409）路径 | 不新增 user log |
| AC-04 | `GET /sessions/{id}/logs` 返回 | 含 user log，按 run 分组、user 在 turn 开头 |
| AC-05 | 现有 session 测试回归 | 全绿 |
