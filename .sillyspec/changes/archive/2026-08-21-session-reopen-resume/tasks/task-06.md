---
id: task-06
title: 'DS-3 daemon 双向确认——daemon.ts _routeSessionResume 显式供给 runtimeId（写 _recoveryRuntimeBySession 映射或封装加参，任务卡定案二选一）+ 成功调 confirmReconnected（携 lease_id）；失败路径（restore 抛错 + SessionAlreadyExistsError try 前分支）调 markRecoveryFailed；best-effort 不阻塞；修正 daemon.ts:2932 矛盾注释；补 daemon-session-resume-route.test.ts createMockClient 缺失的 confirmReconnected/markRecoveryFailed mock（:41-56）；签名统一记录于任务卡（design.md 不回改保持 hash 稳定）'
title_zh: 'DS-3 daemon 双向确认——daemon.ts _routeSessionResume 显式供给 runtimeId（写 _recoveryRuntimeBySession 映射或封装加参，任务卡定案二选一）+ 成功调 confirmReconnected（携 lease_id）；失败路径（restore 抛错 + SessionAlreadyExistsError try 前分支）调 markRecoveryFailed；best-effort 不阻塞；修正 daemon.ts:2932 矛盾注释；补 daemon-session-resume-route.test.ts createMockClient 缺失的 confirmReconnected/markRecoveryFailed mock（:41-56）；签名统一记录于任务卡（design.md 不回改保持 hash 稳定）'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: []
expects_from:
  task-03:
    - contract: SessionRuntimeRequest
      needs: [lease_id]
      note: 字段名 lease_id / 类型 uuid（daemon 侧序列化为字符串）/ 可选缺省 None，不传维持现状
provides:
  - contract: HubClientConfirmApi
    fields: [confirmReconnected, markRecoveryFailed]
    note: '最终签名（本卡定案，design.md 不回改）——confirmReconnected(sessionId: string, opts?: { leaseId?: string; runtimeId?: string }): Promise<void>；markRecoveryFailed(sessionId: string, reason?: string, opts?: { leaseId?: string; runtimeId?: string }): Promise<void>'
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/daemon-session-resume-route.test.ts
goal: >
  DS-3 daemon 双向确认：_routeSessionResume 恢复成功后调 confirmReconnected、
  失败（含 SessionAlreadyExistsError try 前抛出）后调 markRecoveryFailed，均显式
  携带 payload 的 runtimeId 与 leaseId（参数透传定案，解 F1 静默吞），让后端
  真正翻 reconnecting → active / failed（FR-03/FR-04）。
implementation:
  - '【定案】runtimeId 供给 = 参数透传（opts.runtimeId），不写 _recoveryRuntimeBySession 映射。理由（读完代码后定，design.md DS-3 二选一授权）：①leaseId 绑定本就要求两方法加可选 opts（DS-3 gap 修复），同一 opts 加 runtimeId 边际成本≈0；而写映射方案仍要加 opts，还得为 daemon.ts 开公共写入口——_recoveryRuntimeBySession 是 hub-client.ts:278 private Map，外部不可直接写；②映射是一次性状态（:817/:834 调用后 delete）且与 recover 链路共享：markRecoveredSessionFailed 桥接（daemon.ts:1364-1375）无参调 markRecoveryFailed 依赖映射存在，reopen 路径写映射会被跨路径误消费/误删；③参数透传下 recover 调用点（:1331/:1369/:1389）经 hub-client 内 `opts?.runtimeId ?? 映射查表` fallback 零改动，语义不变。结论：改动最小且不破坏 recover 链路'
  - 'hub-client.ts 签名落地（:809/:824）：confirmReconnected(sessionId, opts?: { leaseId?: string; runtimeId?: string })；markRecoveryFailed(sessionId, reason?, opts?: { leaseId?: string; runtimeId?: string })。runtimeId 解析改 `opts?.runtimeId ?? this._recoveryRuntimeBySession.get(sessionId)`；保留 if (!runtimeId) return 静默 guard（无任何来源不误调 backend）；opts.leaseId 存在时 body 带 lease_id；:817/:834 映射 delete-on-call 保持（仅查表来源有意义）；同步更新 :766-768 / :807 / :821 注释——"接口只传 sessionId 经映射查表"表述已不完备'
  - 'daemon.ts ClientLike（:265）追加可选方法声明 confirmReconnected?/markRecoveryFailed?（带上述 opts 签名；可选 ? 有 markOffline? :283 先例，不破坏既有测试 mock）；RecoveryCoordinator 接口（:516/:518）不动——TS 可选参数不破坏 HubClient 到接口的结构兼容，recover 链路契约锁死'
  - 'daemon.ts _routeSessionResume（:2944-3008）①：从 raw 归一化取 runtimeId（raw.runtime_id ?? raw.runtimeId ?? ""，snake/camel 双写同款 ql-20260616-006；protocol.ts:114 payload 已含 runtime_id）'
  - '②失败路径：restoreAndReconnect（:2998）+ markReconnected（:2999）整体包 try/catch——SessionAlreadyExistsError（session-manager.ts:2438-2440 在进入内部 try 前直接 throw，现有 onSessionEnd(failed) 收敛不覆盖）与其它抛错一并落入；catch 内 best-effort 调 this._client.markRecoveryFailed(sessionId, String(e), { leaseId, runtimeId })（自身再包 try/catch，失败仅 warn 不抛），记 error 日志后不再向上抛（与 _routeProviderConfigChanged catch 收敛风格一致，不再依赖 _handleWsMessage 的 void catch）'
  - '③成功路径：markReconnected 之后调 await this._client.confirmReconnected(sessionId, { leaseId, runtimeId })，包 try/catch 失败仅 warn（best-effort：不回滚本地已恢复 active，后端 180s sweeper 兜底收敛）；notifySessionReady（:3008）保持在其后'
  - '④注释修正：:2932 区块注释"backend 收 confirm 切 status=active"随实现落地成为事实（核对表述准确）；:2995-2997"resume 是 daemon 主动触发的 reopen，无需 backend 二次 confirm"与实现矛盾，必须改写为 confirm 调用说明（CLAUDE.md 规则 18：注释与实现不一致是万恶之源）'
  - '⑤补 daemon-session-resume-route.test.ts createMockClient（:41-56）缺失的 confirmReconnected/markRecoveryFailed mock（vi.fn(async () => ({}))，plan 连带测试债清单 task-06/07 承接）；并加最小行为用例：成功路径 confirmReconnected 收到 (sessionId, { leaseId, runtimeId }) 实参（防 F1 回归）、restoreAndReconnect 抛错（含 SessionAlreadyExistsError 场景）走 markRecoveryFailed 携 reason 与 opts、confirmReconnected mock 抛错不阻塞（markReconnected/notifySessionReady 仍执行）。完整防回归深化归 task-07'
  - '⑥签名定案只记录本卡（provides 字段 + 本节），design.md 不回改（plan.md 既定：保持已过审 hash 稳定）'
acceptance:
  - 'SESSION_RESUME 成功路径：confirmReconnected 以 (sessionId, { leaseId, runtimeId }) 真实发出，runtimeId 取自 payload（protocol.ts:114），不依赖 _recoveryRuntimeBySession 映射（F1 静默吞解除）'
  - 'SessionAlreadyExistsError（store 已有 session，session-manager.ts:2439 try 前抛出）与 restoreAndReconnect/markReconnected 其它抛错：markRecoveryFailed(sessionId, reason, { leaseId, runtimeId }) 发出'
  - 'confirmReconnected/markRecoveryFailed 自身失败（HTTP 抛错）仅 warn：不回滚本地已恢复状态、不阻塞 notifySessionReady 与后续消息处理（best-effort）'
  - 'recover 链路（daemon.ts:1331/:1369/:1389 无 opts 既有调用）行为不变：仍经映射查表供 runtime_id，写删配对（:800/:817/:834）不变'
  - '既有 daemon-session-resume-route 6 用例不破（mock 补齐后全绿）'
verify:
  - 'cd sillyhub-daemon && pnpm typecheck'
  - 'cd sillyhub-daemon && pnpm test'
constraints:
  - '不动 recover 链路语义：daemon.ts:1331/:1369/:1389 既有调用与 _recoveryRuntimeBySession 写删配对（:800/:817/:834）保持，hub-client 内 fallback 查表保证'
  - 'best-effort：confirm/markRecoveryFailed 失败不得回滚已恢复状态（本地 active 保持，交后端 sweeper 兜底）'
  - '禁止依赖映射里不存在的 runtimeId（F1 禁项）：reopen 路径 runtimeId 唯一来源 = SESSION_RESUME payload'
  - 'RecoveryCoordinator 接口（daemon.ts:500）语义不动；ClientLike 新声明用可选方法（?）不破坏既有 mock'
  - 'design.md 不回改：签名定案记录于本卡；深化防回归断言归 task-07'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
