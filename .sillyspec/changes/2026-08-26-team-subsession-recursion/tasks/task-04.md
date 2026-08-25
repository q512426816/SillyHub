---
id: task-04
title: 'worker_depth 透传链 + 会话闸——placement 写 metadata → context.py 白名单 → daemon.ts 归一化 → types.ts 四处类型 → session-store-persistence 保档 → session-manager 消费分层 + 会话总数闸（env 默认 20）'
title_zh: 'worker_depth 透传链 + 会话闸——placement 写 metadata → context.py 白名单 → daemon.ts 归一化 → types.ts 四处类型 → session-store-persistence 保档 → session-manager 消费分层 + 会话总数闸（env 默认 20）'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: ['task-01']
blocks: ['task-05']
requirement_ids: [FR-04, FR-06]
decision_ids: [D-003@v2]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/lease/context.py
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-store-persistence.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
provides:
  - contract: worker_depth_chain
    fields: [lease.metadata.worker_depth, claim payload worker_depth, execPayload 与 CreateSessionInput.worker_depth, SessionState.worker_depth, MainAgentMcpContext.worker_depth, PersistedSessionRecord.worker_depth]
  - contract: session_gate
    fields: [SILLYHUB_MAX_ACTIVE_SESSIONS env（默认 20，0=不限）, SessionLimitReached 拒绝错误]
goal: >
  打通分身深度全链透传 + daemon 会话总数闸（FR-04/FR-06、D-003@v2）——
  placement 写 lease metadata.worker_depth，经 context.py 白名单 → daemon.ts
  归一化 → SessionManager 四处类型载体承载并随 snapshot 保档（防重启非叶
  静默降级叶档），create 前置活会话计数闸拒进程风暴。
implementation:
  - 'placement.py——prepare_interactive_dispatch 新增 worker_depth: int | None = None 参数（写法逐字对齐 stage 先例 :627 与 :767-768 真值才写键），非 None 才写 metadata["worker_depth"]；调用方接线（mcp_tools 派发传子会话深度）归 task-02，本卡只提供参数'
  - 'context.py——build_claim_payload interactive 分支 stage 白名单（:478-480）旁同款透传 worker_depth（lease_meta 读键，缺键短路不加 payload 键，零回归）'
  - 'daemon.ts——execPayload 归一化（stage :4302 先例旁）worker_depth 取 rawExec.worker_depth ?? rawExec.workerDepth ?? payload.worker_depth；_startInteractiveSession 在 stage 透传点（:3927 旁）传 SessionManager.create'
  - '类型四处——types.ts 三载体（CreateSessionInput/SessionState/PersistedSessionRecord 各加 worker_depth?: number，紧随各 stage 字段）+ session-manager.ts MainAgentMcpContext.worker_depth（:319 stage 旁），命名统一 snake（对齐 budget_tokens 先例）'
  - 'session-manager.ts 三路承载——create 写 state.worker_depth + 归一化进 _resolveMainAgentMcp ctx（:1183-1194 旁）；restore 读 record 保档（:3047 与 :3082 旁）；reload ctx 补字段（:3637 旁）；snapshotPersistable 输出 rec.worker_depth（:2939 stage 旁，非 undefined 才写）'
  - 'session-store-persistence.ts——validateRecord 回填 worker_depth（P0-1 修复的四字段链 :209-226 同款容错：Number.isFinite 才写，类型非法丢字段保记录）'
  - '会话闸——SessionManager.create 前置计数 _store 活会话（status 非终态 ended/failed）数 ≥ SILLYHUB_MAX_ACTIVE_SESSIONS（Number(process.env.X) 读法对齐 :794 SESSION_IDLE_TIMEOUT_SEC 先例，默认 20，0=不限）→ 抛本文件导出的 SessionLimitReached；daemon.ts 既有 create 失败 P2b catch（:3994-4002 notifyRunResult error_during_execution）自动回传 run failed，无需新增上报路径'
acceptance:
  - '透传链贯通——placement 传 worker_depth=1 写 lease metadata → claim payload → daemon execPayload → CreateSessionInput → SessionState/MainAgentMcpContext 可读；snapshot 落盘重启 restore 后档位字段保持（M3：非叶不静默降级叶档）'
  - '缺省零回归——不传 worker_depth 的 lease（存量 quick-chat/主控/普通会话/旧 lease）全链无键（undefined 穿透），既有 interactive 测试零改动通过'
  - '会话闸——活会话数达上限时 create 拒绝（SessionLimitReached）且 daemon 侧 run 标 failed；restore/重连不受闸限；env=0 不限'
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm vitest run tests/interactive
  - cd backend && uv run pytest app/modules/agent app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/placement.py app/modules/daemon/lease/context.py && uv run mypy app
constraints:
  - '闸只限 create——restoreAndReconnect/重连路径不计数不拒绝（design §7 风险表「会话闸误伤 restore」）'
  - '文件所有权——mcp_tools.py 调用方接线归 task-02；工具集分档消费（谓词/env 判档）归 task-05，本卡 MainAgentMcpContext 只承载字段不判定档位'
  - '旧 lease 无 worker_depth 键 → undefined 全链穿透不伪造默认值（叶档兜底归 task-05 宁少勿多）'
  - '会话闸计数口径=内存 _store 活会话（终态延迟清理条目不计），不查 backend'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
