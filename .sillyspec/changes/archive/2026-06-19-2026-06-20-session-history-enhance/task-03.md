---
id: task-03
title: backend delete_agent_session 去 active 拒绝、active 先内部 end 再硬删
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-3]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/
---

## 修改文件
- `backend/app/modules/daemon/service.py`：`delete_agent_session`（:2473-2509）
- 测试：`backend/app/modules/daemon/tests/`（session delete 测试）

## 覆盖来源
- design.md §4.2、§6.2、§13；decisions D-003@v1；requirements FR-3

## 实现要求
1. 删除 `:2494-2501` 的 `status∈ACTIVE_SESSION_STATUSES → 409 DaemonSessionDeleteConflict` 拒绝
2. 改为：若 `session.status ∈ {pending, active, reconnecting}`，**先内部 end 收口**：
   - 发 `daemon:session_end` WS（复用 end_session :2010-2029 的 `send_session_control`，best-effort daemon 离线只 warn 不阻断）
   - 把当前非终态 run 标 `killed` + `finished_at` + `exit_code=-1`（复用 end_session :2034-2037）
   - lease 置 `completed` + `updated_at=now`（:2045-2046）
3. 再执行现有硬删：`UPDATE agent_runs SET agent_session_id=NULL WHERE agent_session_id=:id`（:2503-2507，断外键）+ `session.delete()`（:2508）
4. 实现方式：抽 `_end_session_for_delete(session)` 私有方法封装 end 收口核心，或直接在 delete 内调 end_session 的核心逻辑（避免 best-effort WS 在 delete 路径抛错回滚）

## 接口定义
- `delete_agent_session(session_id, user_id)` 签名不变（router.py:765 调用方不变）
- `ACTIVE_SESSION_STATUSES`（service.py:158）= `{"pending","active","reconnecting"}`
- 删除返回：现有 void/204（router 不变）

## 边界处理
1. **active 删除 daemon 离线**：`send_session_control` 发 WS 失败只 warn（同 end_session :2023-2029），本地仍强制删；daemon 侧 session 由其空闲超时清理
2. **pending 删除（无活跃 run）**：跳过 run killed（无 current run），仍发 SESSION_END + lease completed + 硬删
3. **reconnecting 删除**：同 active 处理（先 end 收口再删）
4. **ended/failed 删除**：直接硬删，不触发 end 收口（已 terminal）
5. **ownership**：`user_id` 不匹配 → 404 资源隐藏（现有 :2489-2492 保留）
6. **并发删除/同时 end**：`SELECT ... FOR UPDATE`（现有 :2485-2488 行锁）

## 非目标
- 不改 DELETE 路由签名/返回（router.py:765-775）
- 不级联删 run/logs（保留 :2503-2507 断外键语义）
- 不处理 lease 孤儿行（completed lease 保留，与现状一致）

## 参考
- end_session 收口逻辑：`service.py:1961-2067`（WS + run killed + lease completed）
- 现有 delete 断外键保历史：`service.py:2503-2507`

## TDD 步骤
1. 写测试：delete active session → 成功（不再 409）；DB lease completed、session 删除、run 的 agent_session_id=NULL、logs 保留
2. 确认失败（当前 409）
3. 实现去拒绝 + active 先 end
4. 确认通过；补 pending/reconnecting/ended 删除测试 + daemon 离线 best-effort 测试
5. 回归现有 delete/end 测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | DELETE active session | 204，不再 409 |
| AC-02 | active 删除后 lease | `status="completed"` |
| AC-03 | active 删除后 run/logs | `agent_run_logs` 保留、`agent_runs.agent_session_id=NULL` |
| AC-04 | DELETE pending/reconnecting | 同 active，先 end 收口再删 |
| AC-05 | DELETE ended/failed | 直接删，run/logs 保留 |
| AC-06 | daemon 离线删 active | 本地仍删成功（best-effort WS） |
| AC-07 | 现有 delete/end 测试回归 | 全绿 |
