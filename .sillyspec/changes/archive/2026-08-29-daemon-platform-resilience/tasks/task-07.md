---
id: task-07
title: 'daemon-uplink-reliability-backend-idempotent-endpoints'
title_zh: 'daemon 上行可靠化与 backend 幂等端点（outbox 终态入箱、422 对账、权限 HTTP 上行）'
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: [task-06]
blocks: [task-08]
requirement_ids: [FR-03]
decision_ids: [D-004@v1, D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/resilience/service.ts
  - sillyhub-daemon/src/resilience/outbox.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/resilience/outbox.test.ts
  - sillyhub-daemon/tests/resilience/resilience-service.test.ts
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/tests/test_permission_http_uplink.py
  - backend/app/modules/daemon/tests/test_terminal_idempotent.py
provides:
  - contract: OutboxTerminalKinds
    fields: [kind, pending_token]
related_tests:
  - path: sillyhub-daemon/tests/resilience/outbox.test.ts
    reason: entry 加 kind 字段且文件命名维度由 runId 泛化为 dedupId 后，既有 run-1.jsonl 命名与 entry 形状断言需同步，并补旧文件缺 kind 按 messages 兼容用例
  - path: sillyhub-daemon/tests/resilience/resilience-service.test.ts
    reason: SubmitClient 扩展 notifyRunResult 与 notifySessionEnd 后 drain 按 kind 路由，既有 drain 仅断言 submitMessages 的分发断言需同步扩展
goal: >
  把 daemon 上行三类载荷（流式消息、run 终态、session 结束）与权限请求全部可靠化——outbox 扩展 kind 路由、终态用尽落箱重放、422 对账刷新 claim_token、权限请求 HTTP 上行兜底，backend 对应端点幂等化，消除断线窗口上行丢失与人审误拒。
implementation:
  - outbox.ts 按 D-007 扩展 OutboxEntry 加 kind 字段（messages/run_result/session_end，缺省 messages）；load 对旧 runId 文件缺 kind 按 messages 兼容解析；文件命名维度由 runId 泛化为 dedupId（messages 与 run_result 沿用 runId，session_end 用 sessionId）
  - service.ts 的 SubmitClient 接口扩展 notifyRunResult 与 notifySessionEnd 两方法，drainOutbox 按 entry.kind 路由三类补发；notifyRunResult/notifySessionEnd 调用点先走 retryTerminal 快路径，用尽后落 outbox（run_result 携带完整 result payload 无需 claimToken，session_end 以 sessionId 为 dedupId）由 drain 重放
  - submitWithRetry 遇 422（claim_token 失效）不再丢弃——消息入 outbox 并触发一次会话详情对账（getAgentSession）刷新 claim_token 供重放；no_claim_token 空窗上报入箱带 pending_token 标记，待 SESSION_INJECT 刷新 token 后 drain 重放
  - hub-client.ts 新增 submitPermissionRequest 走 POST /api/daemon/sessions/{id}/permission-requests；daemon.ts 的 PERMISSION_REQUEST WS 上行失败时改走 HTTP 创建待审记录，等待响应依赖 backend 5min 超时加 daemon 既有 fallback timer 兜底，不再 fail-closed deny
  - backend 新增 permission-requests 端点（router.py 挂路由，permission_service.py 复用 handle_permission_request 校验建待审记录，plain approval 挂 5min 超时 timer 而 dialog 类不挂）；runs/result 与 sessions 会话 end 两端点幂等化（重复同 payload 返回 200 no-op 不翻转终态）；新增 test_permission_http_uplink.py 与 test_terminal_idempotent.py，同步更新 outbox.test.ts 与 resilience-service.test.ts 既有断言
acceptance:
  - 终态重放幂等——outbox 落箱的 run_result/session_end 重复提交同 payload，backend 端点返回 200 no-op，无重复副作用与终态翻转
  - 422 后 token 刷新可重放——claim_token 失效消息入箱，会话详情刷新恢复 token 后 drain 重放成功并 markDelivered
  - WS 不通时权限请求走 HTTP 上行创建待审记录（人审挂起等待而非直接 deny），backend 侧 WS 与 HTTP 两路共用同一待审记录
  - 旧 outbox runId 文件 load 兼容（缺 kind 按 messages），drain 按 kind 正确路由三类 entry，既有 resilience 测试与新增 backend 测试全绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/resilience/ && pnpm exec tsc --noEmit
  - cd backend && uv run pytest app/modules/daemon/tests/test_permission_http_uplink.py app/modules/daemon/tests/test_terminal_idempotent.py -q
constraints:
  - 不动 ws-client 重连与控制指令消费（task-06 范围）；outbox 保持 JSONL append 加原子重写的既有持久化语义，不新增 daemon 侧审批等待时限（依赖 backend 5min 超时与既有 fallback timer 兜底）
  - backend 幂等化不改变首次提交语义与鉴权链（X-API-Key 与 X-Claim-Token），不动 run_sync 与权限下行补拉（下行归 task-04）
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
