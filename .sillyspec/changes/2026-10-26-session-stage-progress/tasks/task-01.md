---
id: task-01
title: 'backend 协议与发布全集（DTO+helper+端点+状态机发布+测试+openapi）'
title_zh: 'backend 协议与发布全集（DTO+helper+端点+状态机发布+测试+openapi）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 03:49:02
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [FR-01, FR-06]
decision_ids: [D-004@v1, D-011@v1, D-012@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/notify.py
  - backend/app/modules/daemon/run_sync/service/publish.py
  - backend/app/modules/daemon/control_commands.py
  - backend/app/modules/daemon/tests/test_turn_phase_events.py
  - backend/openapi.json
target_files:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/notify.py
  - backend/app/modules/daemon/run_sync/service/publish.py
  - backend/app/modules/daemon/control_commands.py
  - NEW:backend/app/modules/daemon/tests/test_turn_phase_events.py
  - backend/openapi.json
goal: >
  backend 侧 turn_phase 协议与发布全集：DTO 进 OpenAPI、发布 helper、上报端点、
  控制指令状态机两翻转点发布 dispatched/delivered——W1 协议定稿，三端据此并行。
provides:
  - turn-phase 端点契约: "POST /api/daemon/sessions/{session_id}/turn-phase（X-API-Key daemon 鉴权）；body=TurnPhaseReportRequest{run_id: uuid 必填, phase: 7 值枚举, detail?: str}；响应 {ok: true}"
  - sse 载荷契约: "agent_session:{id} 频道 turn_phase 事件，payload 键 phase/detail/timestamp（ISO 8601 UTC，与事件名 event 同级）"
implementation:
  - backend/app/modules/daemon/schema.py 新增 TurnPhaseReportRequest（run_id: uuid 必填；phase: Literal["skills_sync","spec_sync","mcp_prefetch","spawning","ready","inject_received","first_event"]；detail: str | None = None）
  - backend/app/modules/daemon/run_sync/service/publish.py 新增 publish_turn_phase_event(session_id, run_id, phase, detail=None)——组装 {"event":"turn_phase","session_id","run_id","phase","detail","timestamp": iso-now} 经既有 publish_json_event 底座发布到 agent_session:{session_id}（异常吞噬+warning，对齐 publish_session_event 结构）
  - backend/app/modules/daemon/router/notify.py 新增 POST /sessions/{session_id}/turn-phase 端点，结构照抄同文件 notify_bash_status：daemon 鉴权依赖 → 会话归属校验（404 同款口径）→ 调 helper → 返回 {"ok": true}
  - backend/app/modules/daemon/control_commands.py：enqueue_and_push 下发成功点发布 phase=dispatched（WS push 成功与待补拉两路径都发——待补拉时 delivered=False 语义兼容）；daemon ack 回执处理点发布 phase=delivered（D-011：非 mark_delivered 的 push 成功点；ack 处理需从控制指令 payload 反查 session_id/run_id）。两处发布均 try/except 吞噬，失败不阻断状态机主流程
  - 新增 backend/app/modules/daemon/tests/test_turn_phase_events.py：①端点无凭据 401 / 跨会话 404 / 正常 200 且 Redis 收到 turn_phase 事件（断言键名 phase/detail/timestamp 逐字）；②enqueue 下发成功点发布 dispatched 断言 + ack 回执点发布 delivered 断言（mark_delivered push 成功点不发布——负向断言）；③发布 helper 注入 Redis 异常不抛出、状态机照常流转
  - 重导出 openapi.json（既有流程：后端 schema 变更同步 openapi.json 供 gen:types）
acceptance:
  - POST /api/daemon/sessions/{id}/turn-phase：无 X-API-Key 401、他 workspace 会话 404、合法上报 200 且 agent_session:{id} 频道收到 {"event":"turn_phase",...} 载荷，键名恰为 phase/detail/timestamp 三键（D-012 逐字断言）
  - 控制指令下发成功即发布 dispatched；仅 daemon ack 回执点发布 delivered，mark_delivered（WS push 成功）不发布（D-011 正负断言）
  - Redis 发布抛异常时 enqueue_and_push / ack 处理不抛出、控制指令状态照常落库（吞噬断言）
  - backend/openapi.json 含 TurnPhaseReportRequest 与新端点定义
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_turn_phase_events.py -q（输出落盘 .sillyspec/.runtime/logs/ 只看尾部）
  - cd backend && uv run ruff check app/modules/daemon/ && uv run mypy app（聚焦改动面）
constraints:
  - 禁改既有端点/事件语义；零表结构变更；publish 失败语义=异常吞噬+warning（D-009）
  - phase 枚举 7 值封闭（dispatched/delivered 不收上报——backend 自产）
  - 测试遵守 daemon 模块双目录惯例（app/modules/daemon/tests/ 为主）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
