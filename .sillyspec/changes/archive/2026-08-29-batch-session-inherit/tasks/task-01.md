---
id: task-01
title: 'split suspension by parent_session_id (worker failed, main suspended)'
title_zh: 'backend 分流挂起——worker 子会话 failed(daemon_interrupted) 产重派种子，主会话 suspended 不变'
author: 'qinyi'
created_at: 2026-08-29 21:15:48
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/sweep.py
  - backend/app/modules/daemon/tests/test_session_suspend.py
  - backend/app/modules/daemon/tests/test_worker_redispatch.py
provides:
  - contract: WorkerSuspendSplit
    fields: [worker_sessions_failed, daemon_interrupted_error_code]
goal: >
  daemon 掉线两条挂起路径（suspend_sessions_for_daemon 与 session_offline_sweep_once）按 parent_session_id 分流——worker 子会话改判 failed(daemon_interrupted) 并产出重派种子（worker 列表供 task-02 异步重派），主会话 suspended 语义逐字不变。
implementation:
  - service.py 对齐 DAEMON_STOPPED_ERROR_CODE（:125）先例新增 DAEMON_INTERRUPTED_ERROR_CODE=daemon_interrupted；SuspendBatchResult（:659）加 workers 字段收集被中断 worker 会话 id——router.py:1667 仅读 suspended/runs_failed 两键响应契约天然不变（防 test_session_suspend.py:363-364 端点断言破）
  - suspend_sessions_for_daemon（service.py:4708）hit 查询带出 parent_session_id 分两组——worker 组（parent 非空）会话置 failed+ended_at、活跃 run 落 AgentRun.error_code=daemon_interrupted、终态行对齐 sweep 档发 session_ended+status_changed；主会话组（parent IS NULL）suspended+last_active_at+run error_code=daemon_stopped+仅 status_changed 逐字不变；lease cancelled 步骤两组共享
  - session_offline_sweep_once（sweep.py:197）active 档同款分流；pending 档（含 worker pending）维持既有 pending→failed 不加分流（design 显式边界）
  - 新增 tests/test_worker_redispatch.py 覆盖两路径 worker 分流+主会话回归；test_session_suspend.py 同步补 worker 场景断言（既有 _make_session 均无 parent 不受影响）
acceptance:
  - worker 子会话（parent_session_id 非空）经 suspend 与 offline sweep 两路径——session=failed+ended_at、活跃 run=failed 且 AgentRun.error_code=daemon_interrupted、lease=cancelled
  - 主会话（parent IS NULL）零变化——suspended+last_active_at、run error_code=daemon_stopped、广播仅 status_changed（回归锁定）
  - SuspendBatchResult.workers 返回 worker 会话 id 列表且 POST /sessions/suspend-batch 响应体仍只含 suspended 与 runs_failed 两键
  - sweep pending 档（含 worker pending）行为不变仍 pending→failed
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_suspend.py app/modules/daemon/tests/test_worker_redispatch.py -q --no-cov
  - cd backend && uv run mypy app
constraints:
  - 只写重派种子不执行重派——异步 fire 与 placement/patrol 改动全归 task-02
  - parent_session_id 非空是 worker 识别唯一口径（兼容 role=NULL 老 worker 行），禁用 role 词表兜底
  - 不改 POST /sessions/suspend-batch 响应 DTO 与 SSE 事件契约——workers 字段仅内部消费
  - 不新增 AgentSession 列——daemon_interrupted 只落 AgentRun.error_code（零迁移）；主会话与 sweep pending 档语义逐字不变
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
