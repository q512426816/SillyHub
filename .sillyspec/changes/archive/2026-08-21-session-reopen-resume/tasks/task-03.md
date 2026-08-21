---
id: task-03
title: 'DS-4 confirm/mark-recovery-failed 可选 lease_id——router.py SessionRuntimeRequest（:1246）加可选字段，service 两函数（:2060/:2130 区域）提供时校验匹配当前 lease，不匹配幂等跳过；**保留既有"非 ended/failed → failed"翻转**（复审 gap：active→failed 供 async-fail 桥接 daemon.ts:1340-1389）；顺带定义 RECONNECTING_RETRY_WINDOW_SEC=180 常量；OpenAPI dump；测试：幂等、lease 不匹配跳过、无 lease_id 向后兼容、既有 recover 链路不变；顺带更新 test_session_reopen.py TestReopenConfirmLinkage 过时 docstring（:638-640）'
title_zh: 'DS-4 confirm/mark-recovery-failed 可选 lease_id——router.py SessionRuntimeRequest（:1246）加可选字段，service 两函数（:2060/:2130 区域）提供时校验匹配当前 lease，不匹配幂等跳过；**保留既有"非 ended/failed → failed"翻转**（复审 gap：active→failed 供 async-fail 桥接 daemon.ts:1340-1389）；顺带定义 RECONNECTING_RETRY_WINDOW_SEC=180 常量；OpenAPI dump；测试：幂等、lease 不匹配跳过、无 lease_id 向后兼容、既有 recover 链路不变；顺带更新 test_session_reopen.py TestReopenConfirmLinkage 过时 docstring（:638-640）'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P0
depends_on: []
blocks: [task-04, task-06, task-08]
requirement_ids: [FR-05, FR-04, NFR-01]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/openapi.json
provides:
  - contract: SessionRuntimeRequest
    fields: [lease_id]
    note: confirm-reconnected / mark-recovery-failed 共用请求体（router.py:1246）加可选 lease_id（uuid.UUID | None 默认 None，携带本次 SESSION_RESUME 的 lease_id 供陈旧确认防误翻；不传走既有行为，recover 链路向后兼容）
  - contract: RECONNECTING_RETRY_WINDOW_SEC
    fields: [RECONNECTING_RETRY_WINDOW_SEC]
    note: int 值 180，定义于 backend/app/modules/daemon/session/service.py 模块级常量，唯一落点——task-04 reopen 窗口与 task-05 sweeper 均 import，勿重复定义
expects_from: []
related_tests:
  - backend/app/modules/daemon/tests/test_session_reopen.py（TestReopenConfirmLinkage :638-640 docstring 声称 no lease/token check，本 task 加 lease_id 校验后过时，顺带更新）
goal: >
  confirm/mark-recovery-failed 增加可选 lease_id 陈旧确认防误翻（迟到的旧确认
  不误翻/误杀第二次 reopen 的 reconnecting），并定义 RECONNECTING_RETRY_WINDOW_SEC=180
  常量供后续窗口/巡检任务复用；不带 lease_id 时既有行为逐字节不变。
implementation:
  - 'router.py:1246 SessionRuntimeRequest 加 lease_id: uuid.UUID | None = None；:1296 confirm-reconnected 与 :1318 mark-recovery-failed 两端点透传 lease_id=data.lease_id 给 service 两函数。'
  - 'session/service.py confirm_session_reconnected（:2060-2122）加可选参数 lease_id: uuid.UUID | None = None：加载 session 行后，若 lease_id 提供且 != session 当前 lease_id → 幂等跳过（不翻转、不报错，返回当前状态，reconnecting 时即返回 reconnecting）；既有 reconnecting→active 翻转与非 reconnecting 幂等返回逻辑不变。'
  - 'mark_session_recovery_failed（:2130 起）加同样可选参数与同样不匹配幂等跳过；**保留既有非 ended/failed → failed 翻转（含 active→failed）**——daemon.ts:1340-1389 markRecoveredSessionFailed 异步 fail 桥接在 confirm 翻 active 后仍依赖它收敛，禁止收窄为 reconnecting-only。'
  - '两函数返回类型 Literal 按需放宽（lease 不匹配幂等跳过时返回当前状态，可能新增 reconnecting 等取值）；SessionRecoveryResponse.status 本为 str，响应 DTO 不变。'
  - 'session/service.py 模块级定义 RECONNECTING_RETRY_WINDOW_SEC = 180（唯一落点，task-04/05 import；本 task 只定义不消费）。'
  - '测试（test_session_reopen.py 扩展 TestReopenConfirmLinkage 或同文件新增用例）：lease_id 匹配翻 active；不匹配幂等跳过；不带 lease_id 既有行为不变（含 recover 链路回归）；mark-failed lease 不匹配跳过 + active→failed 翻转保留；顺带更新 :638-640 过时 docstring。'
  - 'OpenAPI dump：cd backend && uv run python scripts/dump_openapi.py 更新 backend/openapi.json（SessionRuntimeRequest.lease_id 进 schema）；frontend 侧 pnpm gen:types + api-types.ts 归 task-08，本 task 不跑前端。'
acceptance:
  - confirm 携带匹配当前 lease 的 lease_id 且 status=reconnecting → 翻 active（既有行为）。
  - confirm / mark-failed 携带不匹配 lease_id → 幂等跳过：状态不变、不报错、返回当前状态。
  - 两端点不带 lease_id → 行为与改动前逐字节一致（既有 daemon 重启 recover 链路向后兼容）。
  - mark-failed 保留非 ended/failed → failed 翻转（active→failed 不收窄）。
  - RECONNECTING_RETRY_WINDOW_SEC=180 可从 session/service.py import；backend/openapi.json 含 SessionRuntimeRequest.lease_id 可选字段。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_reopen.py app/modules/daemon/tests/test_session_service.py app/modules/daemon/tests/test_session_recovery.py -v
  - cd backend && uv run ruff check app/modules/daemon/router.py app/modules/daemon/session/service.py
  - cd backend && uv run mypy app
constraints:
  - '无 lease_id 分支必须保持既有行为不变（向后兼容硬约束；test_session_readiness / test_session_recovery 既有用例不回归）。'
  - '不收窄 mark-failed 翻转条件（daemon.ts:1340-1389 async-fail 桥接依赖 active→failed，plan task 表明文禁止）。'
  - 'notify_session_ready 端点维持仅记日志，状态翻转单一真理源 = confirm-reconnected（design DS-4）。'
  - '不动 reopen 前置校验（task-04 范围）；不动 daemon 侧代码（task-06 范围）。'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
