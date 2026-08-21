---
id: task-07
title: 'daemon vitest——confirm 真实发出断言（runtimeId 供给，防 F1 回归）、SessionAlreadyExists 失败分支、best-effort 语义'
title_zh: 'daemon vitest——confirm 真实发出断言（runtimeId 供给，防 F1 回归）、SessionAlreadyExists 失败分支、best-effort 语义'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: [NFR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/daemon-session-resume-route.test.ts
  - sillyhub-daemon/tests/daemon-session-resume-confirm.test.ts
goal: >
  NFR-02 daemon 侧测试收口：用 vitest 锁死 task-06 的双向确认契约，核心是
  F1 防回归——恢复成功后 confirmReconnected 必须真实发出且实参 runtimeId/
  leaseId 非空，防止 hub-client `if (!runtimeId) return` 静默 guard 缺陷复发。
expects_from:
  task-06:
    - contract: HubClientConfirmApi
      needs: [confirmReconnected, markRecoveryFailed]
      note: confirmReconnected 实参含 runtimeId（来源 SESSION_RESUME payload）与 leaseId；markRecoveryFailed 实参含 runtimeId/leaseId/reason；恢复成功与失败（restore 抛错 + SessionAlreadyExists）两分支的调用点
implementation:
  - 先还连带测试债（plan 连带测试债清单第 2 行）——daemon-session-resume-route.test.ts createMockClient（:41-56）补缺失的 confirmReconnected / markRecoveryFailed 两个 mock（风格对齐既有 vi.fn(async () => ({}))）；buildDaemon（:86-98）改造为同时返回 client 句柄供用例断言（既有用例断言不动，只多拿返回值）
  - 用例组 1（F1 防回归，核心）——emit SESSION_RESUME（payload 带 runtime_id/lease_id）→ restoreAndReconnect 成功后断言 client.confirmReconnected 被真实调用 ≥1 次，且实参 runtimeId === payload.runtime_id、leaseId === payload.lease_id（断言非 undefined/非空串——hub-client 静默 guard `if (!runtimeId) return` 复发时实参即 undefined，此断言必红）
  - 用例组 2——restoreAndReconnect mock reject SessionAlreadyExistsError（模拟 session-manager.ts:2439 在进入 try 块之前抛出的场景，现有 onSessionEnd(failed) 收敛不覆盖它）→ 断言 markRecoveryFailed 被调用且实参含 leaseId 与 reason；markReconnected / notifySessionReady 不被调用
  - 用例组 3——restoreAndReconnect mock reject 一般 Error → 断言 markRecoveryFailed 被调用（恢复失败立即上报后端置 failed，不等兜底巡检）
  - 用例组 4（best-effort）——confirmReconnected mock reject → 恢复流程不回滚——markReconnected 仍保持已调用（本地 active 不回退）、emit（_handleWsMessage 透传调用）不向调用方抛错（对齐 daemon.ts:1330-1339 既有 recover 链路的 confirm 失败仅 warn 语义）
  - mock 手法照抄本文件既有——createMockSessionManager / buildDaemon / emit（_handleWsMessage 经 unknown 透传，:100-111）+ await new Promise(r => setTimeout(r, 5)) 等 void Promise 分发落地；新用例并入 route 文件或新建 daemon-session-resume-confirm.test.ts（复用同套 helper）均可
acceptance:
  - 四组断言全绿——①confirm 真发出且 runtimeId/leaseId 实参非空（F1 防回归）②SessionAlreadyExists → markRecoveryFailed ③restore 抛错 → markRecoveryFailed ④confirm 抛错不回滚不崩主循环
  - 既有 daemon-session-resume-route.test.ts 用例（AC-01/05/06、camelCase 兼容、null manager）零回归
  - pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 只动 sillyhub-daemon/tests/ 下测试文件，不改 src/ 任何实现——测试暴露实现缺陷时回 task-06 修，不在本卡改源码迁就测试
  - 断言全部基于 mock client 句柄（vi.fn 调用记录与实参），不起真 WS/HTTP、不引新测试依赖
  - 若 task-06 对 confirm 供给方式二选一（映射写入 or 参数透传）落定了不同签名，以 task-06 任务卡记录的签名为准调整断言实参形态，四组用例语义不变
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
