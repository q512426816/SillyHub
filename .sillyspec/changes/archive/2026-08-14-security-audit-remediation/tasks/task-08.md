---
id: task-08
title: "quick-chat 归属"
title_zh: "quick-chat 四端点归属过滤（lease metadata actor_user_id 链）"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-005@v1, D-001@v1]
allowed_paths:
  - backend/app/main.py
  - backend/app/modules/agent/placement.py
  - backend/tests/modules/agent/test_quick_chat_ownership.py
goal: >
  quick-chat 四个读/杀端点按 agent_runs.lease_id → daemon_task_leases.metadata.actor_user_id 归属链校验，非本人 run 一律 404。
implementation:
  - 第一步核实——placement.py dispatch_to_daemon 的 daemon_task_leases INSERT（约 :471-489）未携带 agent_runs.lease_id 回填，metadata 中也无 actor_user_id 字段（metadata 组装段 :391-448 只写 prompt/provider/model 等），确认两处缺口均属实
  - placement.py 修两处——其一在 metadata 组装段补写 metadata 键 actor_user_id 取值为 str(user_id)（D-005 归属链锚点）；其二在 lease INSERT 之后（:524 UPDATE agent_runs SET agent_session_id 同一事务窗口）补一条 UPDATE agent_runs SET lease_id 回写 run 行，否则归属链在 agent_runs 侧断链
  - main.py 四端点（get_quick_chat_result :324 / stream_quick_chat :346 / kill_quick_chat :421 / get_quick_chat_logs :476）各加归属校验——按 run_id 查询时 join daemon_task_leases 取 metadata.actor_user_id，与当前 user.id 比对，不匹配或链缺失统一 HTTP 404（与不存在同语义，D-001）
  - 归属校验抽成 _register_quick_chat 内的局部 helper（如 _assert_run_owner），四个端点复用，避免四份重复 SQL
  - stream_quick_chat 的短 session 校验段（:377-394）同步扩展为带归属判定的查询，校验完归还连接池的既有模式不变
  - prev_run_id resume 路径（:253-268）同样校验 prev run 归属，他人 prev_run_id 视为不存在（resume_session_id 置 None，不泄探）
  - 新建 backend/tests/modules/agent/test_quick_chat_ownership.py，先写失败用例——他人 GET result 404、他人 GET logs 404、他人 POST kill 404、他人 GET stream 404（SSE 端点断言 404 响应码非事件流）、本人四端点回归 200/201
acceptance:
  - 用户 B GET /api/daemon-chat/{A 的 run_id}，期望 HTTP 404
  - 用户 B POST /api/daemon-chat/{A 的 run_id}/kill，期望 HTTP 404
  - 用户 B GET /api/daemon-chat/{A 的 run_id}/logs 与 /stream，期望 HTTP 404
  - 用户 A 对本人 run 四端点行为回归不变（200 与 SSE 事件流正常）
  - dispatch_to_daemon 创建的 lease metadata 含 actor_user_id 字段且 agent_runs.lease_id 已回填（可直接 SQL 断言）
  - 存量无 actor_user_id 的 run 统一 404（未上线可接受，兼容策略）
verify:
  - cd backend && uv run pytest tests/modules/agent/test_quick_chat_ownership.py -q --no-cov
  - cd backend && uv run pytest tests/modules/agent/test_placement_scan_mode.py tests/modules/agent/test_stage_dispatch.py -q --no-cov
constraints:
  - 不给 agent_runs 加 user_id 列（D-005 明确走 lease metadata 链，无 DB migration）
  - main.py 的 quick-chat 块只在 _register_quick_chat 内改动，不动路由注册顺序与其它模块
  - placement.py 只补 metadata 键与 lease_id 回填 UPDATE，不改 lease INSERT 语句结构与 WS wake-up 逻辑
  - kill 端点对非 pending/running 终态的幂等返回语义保持（归属校验先于终态判断）
  - task-03 同 Wave 触及 lease 域，本 task 不动 daemon/lease/service.py
related_tests: []
---
