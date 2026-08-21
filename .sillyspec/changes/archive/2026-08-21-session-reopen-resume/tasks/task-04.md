---
id: task-04
title: 'DS-5+DS-7 reopen 前置校验扩展——①reconnecting 且 last_active_at>RECONNECTING_RETRY_WINDOW_SEC 放行重开（旧 lease 置 cancelled，新建旋转 token 重发；last_active_at=now 已写 service.py:2414 复核）②cwd 空 409 专用错误 + 中文文案（原独立 DS-7 任务并入）；测试：窗口内外两分支 + cwd 空 409'
title_zh: 'DS-5+DS-7 reopen 前置校验扩展——①reconnecting 且 last_active_at>RECONNECTING_RETRY_WINDOW_SEC 放行重开（旧 lease 置 cancelled，新建旋转 token 重发；last_active_at=now 已写 service.py:2414 复核）②cwd 空 409 专用错误 + 中文文案（原独立 DS-7 任务并入）；测试：窗口内外两分支 + cwd 空 409'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-06, FR-08]
decision_ids: [D-005@v1]
expects_from:
  task-03:
    - contract: RECONNECTING_RETRY_WINDOW_SEC
      needs: [RECONNECTING_RETRY_WINDOW_SEC]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
goal: >
  reopen 前置校验两处扩展（DS-5/DS-7）：①reconnecting 且 last_active_at 距今超过
  RECONNECTING_RETRY_WINDOW_SEC（180s）时放行二次 reopen（旧挂起 lease 置 cancelled、
  新建 lease 旋转 token 重发 SESSION_RESUME），窗口内维持 409；②cwd 为空 409 专用错误。
  解决"卡 reconnecting 后 reopen/inject 两头 409 堵死"的手动重试兜底（FR-06/FR-08）。
implementation:
  - '前置取 now：窗口判断需要时间基准，把 :2384 既有 `now = datetime.now(UTC)` 上移到前置校验前共用（后续翻转/新建 lease 复用同一 now，避免双取漂移）'
  - '校验①（:2353 现有 `session.status in ACTIVE_SESSION_STATUSES` → DaemonSessionNotActive 409 处）改为分支放行：status == "reconnecting" 且 last_active_at 非 NULL 且 (now - session.last_active_at).total_seconds() > RECONNECTING_RETRY_WINDOW_SEC → 放行；其余（reconnecting 窗口内 / last_active_at 为 NULL 保守不放行 / pending / active）维持 DaemonSessionNotActive 409 现文案。超时基准锁 last_active_at（F2 修复），禁止用 lease.created_at——recover 路径（:1926-1941）只轮换既有 lease 不新建行，长会话 created_at 必然超窗会误判'
  - '放行分支旧 lease 收敛：按 session.lease_id 取挂起 interactive lease 置 status="cancelled"（design DS-6 取值依据：expired 仅适用 lease_expires_at 非 NULL 的租约 lease/service.py:853-864，interactive 恒 NULL；cancelled 与"恢复放弃"语义一致）；ended/failed 正常路径不动旧 lease（已终态）。随后复用 :2389-2404 既有新建 lease（旋转 claim_token）+ :2411-2432 状态翻转与 SESSION_RESUME 重发逻辑，不改动其本身'
  - '常量获取：import task-03 落点的 RECONNECTING_RETRY_WINDOW_SEC（plan.md 同文件约束：唯一落点 session/service.py，本卡不重复定义）'
  - '校验②（DS-7）：在 agent_session_id 校验（:2348）之后新增——session.cwd 为空 → 抛新异常类；异常类按异常区 :181-213 惯例（DaemonSessionNoAgentSession :213 同款 AppError 子类 + code + http_status + docstring），命名 DaemonSessionNoCwd，code=HTTP_409_DAEMON_SESSION_NO_CWD，中文文案"该会话无关联工作目录，无法恢复对话记录"（scan/bootstrap 会话不写 cwd：agent/service.py:1709、bootstrap.py:498，空 cwd 必然 resume 失败，提前拒绝）'
  - '复核 :2414 reopen 路径已写 `session.last_active_at = now`（本次代码读取已确认存在；execute 时复核防代码漂移——F2 基准成立前提，若缺失则补写）'
  - '测试（test_session_reopen.py 追加用例）：①reconnecting 且 last_active_at 距今 >180s → 二次 reopen 成功，断言 status 回 reconnecting、新 lease 创建、旧 lease=cancelled、SESSION_RESUME 重发；②reconnecting 未超窗（如 60s 前）→ 仍 409 DaemonSessionNotActive；③cwd 空会话 → 409 新错误码 + 中文文案，不新建 lease、不发 SESSION_RESUME；④ended/failed 既有 reopen 回归不变（fixture cwd 默认非空 :73，存量用例不受影响）'
acceptance:
  - 'reconnecting 且超 180s：二次 reopen 成功，旧挂起 lease 终态 cancelled，新 interactive lease 持新 claim_token，SESSION_RESUME 按新 lease 重发'
  - 'reconnecting 未超窗口（≤180s）：DaemonSessionNotActive 409 行为与文案不变'
  - 'cwd 为空：reopen 得 409 专用错误码，detail 文案"该会话无关联工作目录，无法恢复对话记录"，不新建 lease、不下发 SESSION_RESUME'
  - 'ended/failed 正常 reopen 路径回归全绿；pending/active 仍 409 不变'
verify:
  - 'cd backend && uv run pytest app/modules/daemon/tests/test_session_reopen.py -v'
  - 'cd backend && uv run ruff check app/modules/daemon/session/service.py app/modules/daemon/tests/test_session_reopen.py'
  - 'cd backend && uv run mypy app/modules/daemon/session/service.py'
constraints:
  - '不改 :2389-2432 既有新建 lease / 状态翻转 / SESSION_RESUME 重发逻辑本身，仅在 reconnecting 超时放行分支前置旧 lease cancelled 收敛'
  - '超时基准锁死 last_active_at（F2）；禁止改用 lease.created_at'
  - 'RECONNECTING_RETRY_WINDOW_SEC 不在本卡定义，import task-03 唯一落点（session/service.py）'
  - '仅 reconnecting 超时是 ACTIVE_SESSION_STATUSES 例外；pending/active 仍 409'
  - '不动 confirm/mark-failed 校验（task-03 范围）、sweeper（task-05 范围）、前端（task-08 范围）'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
