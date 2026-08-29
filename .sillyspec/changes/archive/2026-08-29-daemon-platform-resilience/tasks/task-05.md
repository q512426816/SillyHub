---
id: task-05
title: backend-session-suspend-semantics
title_zh: backend 会话挂起语义（suspended 状态＋suspend-batch 端点＋offline sweep 改挂起＋24h 超龄 GC＋recover 用例锁定）
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: [task-01]
blocks: [task-08, task-10]
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/sweep.py
  - backend/app/modules/daemon/tests/test_session_suspend.py
  - backend/app/modules/daemon/tests/test_session_reconnect_sweep.py
  - backend/app/modules/daemon/tests/test_session_events_cross.py
goal: >
  为 AgentSession 引入 suspended 挂起态并统一优雅停止 suspend-batch 与 offline sweep 两条挂起路径（pending 会话维持 failed），配 24h 超龄 GC 防泄漏与 recover 三态用例锁定，支撑 daemon 重启后会话自动恢复可继续对话。
implementation:
  - agent/model.py——AgentSession.status 词表注释补 suspended（String(20) free-form 列无 DB 枚举，应用层词表扩展，无新迁移）
  - router.py 新增 POST /api/daemon/sessions/suspend-batch——按 daemon_local_id 定位该 daemon 全部 active 会话，事务内三步收敛（中断 run 置 failed 且 error_code=daemon_stopped、会话置 suspended、挂起 lease 置 cancelled），返回 suspended 与 runs_failed 计数
  - session/service.py 落地 suspend 批量逻辑——条件 UPDATE 重挂状态条件保证幂等可重入，供 daemon 优雅停止调用（调用方 daemon 侧属 task-08）
  - sweep.py offline sweep 改语义——active 会话收敛 suspended（原 failed），pending 会话维持 failed，挂起 run 置 failed 与 lease 置 cancelled 两步维持现状；suspended 非终态只广播 status_changed 不发 session_ended
  - sweep.py 新增 suspended 超龄 GC——SUSPENDED_MAX_AGE_SEC 模块常量可配（默认 24h，对齐 RUNTIME_OFFLINE_GRACE_SEC 先例），超龄 suspended 置 failed 并入既有常驻 sweeper 轮
  - recover 维持非白名单现状——不加 suspended 白名单分支，非终态一律可 recover；新增用例锁定 suspended、pending、reconnecting 三态 recover 均翻 reconnecting 且 claim_token 轮换
  - 同步修既有测试——test_session_reconnect_sweep.py offline 档 active→failed 断言改 suspended（pending 维持 failed）；test_session_events_cross.py offline 广播断言随 suspended 非终态调整；新增 tests/test_session_suspend.py
acceptance:
  - 优雅停止路径——suspend-batch 后 active 会话 suspended、中断 run failed（error_code=daemon_stopped）、挂起 lease cancelled，返回计数正确
  - offline sweep 路径——active 会话收敛 suspended 不再 failed，pending 会话仍 failed，run failed 与 lease cancelled 两步与现状一致
  - suspended 未超龄可 recover 翻 reconnecting（claim_token 轮换），pending 与 reconnecting 态 recover 同样成功（三态用例锁定）
  - suspended 超 SUSPENDED_MAX_AGE_SEC（默认 24h）被 GC 置 failed，幂等可重入不重复写
  - suspend-batch 与 offline sweep 双路径重复执行不产生二次副作用（条件 UPDATE 幂等）
  - suspended 会话广播只发 status_changed 不发 session_ended（非终态语义）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_suspend.py -q
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_reconnect_sweep.py app/modules/daemon/tests/test_session_events_cross.py app/modules/daemon/tests/test_session_recovery.py -q
constraints:
  - recover 不新增白名单分支（D-007 非白名单语义用例锁定，不改既有 recover 状态守卫逻辑）
  - pending 会话离线归宿维持 failed（daemon 本地无 sessions.json 快照记录，suspended 无人 recover）
  - suspended 为非终态——终态集合与状态词表常量按语义审慎纳入；SUSPENDED_MAX_AGE_SEC 以 sweep.py 模块常量表达可配，不新增 Settings 字段
  - status 列 free-form String(20) 无新 alembic 迁移；daemon 侧调用方属 task-08、前端展示属 task-10，本卡不改
  - 仅跑本卡相关测试，全量留 CI
related_tests:
  - path: backend/app/modules/daemon/tests/test_session_reconnect_sweep.py
    reason: offline sweep active→failed 断言改为 suspended，pending 会话维持 failed 需同步断言
  - path: backend/app/modules/daemon/tests/test_session_events_cross.py
    reason: offline sweep 后 suspended 为非终态，session_ended 广播断言改为 status_changed
provides:
  - contract: SuspendBatchResponse
    fields: [suspended, runs_failed]
  - contract: SessionStatusSuspended
    fields: [suspended]
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
