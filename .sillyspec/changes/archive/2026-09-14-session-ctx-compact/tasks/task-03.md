---
id: task-03
title: 'daemon session_compact RPC handler + session-manager compact 六守卫 + driver 契约（compact?/CompactResult）'
title_zh: 'daemon session_compact RPC handler + session-manager compact 六守卫 + driver 契约（compact?/CompactResult）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 11:03:19
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v3]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/session-manager/index.ts
  - sillyhub-daemon/src/interactive/session-manager/compact.ts
  - sillyhub-daemon/tests/interactive/session-compact.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - NEW:sillyhub-daemon/src/interactive/session-manager/compact.ts
  - NEW:sillyhub-daemon/tests/interactive/session-compact.test.ts
provides:
  - contract: InteractiveDriver.compact
    fields: [CompactResult, ok, tokensBefore, estimatedTokensAfter, error]
expects_from:
  task-01:
    - contract: ProviderCaps
      needs: [compact]
goal: >
  daemon 侧承接 backend 的 session_compact RPC（D-003@v3 单点接线）：daemon.ts 在既有注册组旁
  注册 handler，session-manager 新增 compact() 入口——六守卫（running/reconnecting/ended/failed
  拒绝 + driver 无 compact 方法/caps false 拒绝，D-002 防御性双保险），driver.ts 定义可选
  compact?() 方法与 CompactResult 契约供 task-04/05 实现（FR-02 daemon 侧 + FR-04/05 契约层）。
implementation:
  - 'driver.ts 契约——export interface CompactResult { ok: boolean; tokensBefore?: number; estimatedTokensAfter?: number; error?: string }（pi 回执数字可选、codex 受理无数字）+ InteractiveDriver 接口加可选方法 compact?(handle: InteractiveDriverHandle): Promise<CompactResult>（可选方法先例 :221 close?()；cursor 不实现即不支持，既有四 driver 零改动零回归）'
  - 'NEW session-manager/compact.ts——照 sillyhub-daemon/src/interactive/session-manager/turn-control.ts:157 三态守卫先例落新子模块：compact(mgr, sessionId) 六守卫——① store 无该 session → SessionNotFoundError ② status=running 拒绝 ③ status=reconnecting 拒绝 ④ status=ended/failed 拒绝（SessionNotActiveError 形态）⑤ driver 未实现 compact 方法 → 拒绝 error ⑥ getProviderCaps(provider).compact=false → 拒绝 error；全通过 → driver.compact(handle) 透传 CompactResult；守卫拒绝 throw 使 RPC handler 上抛 → backend 收 DaemonRpcRemoteError 映射结构化 error'
  - 'session-manager.ts facade 加 compact(sessionId) 方法一行委托到子模块（照 2026-09-07-arch-large-file-split 拆分形态；子模块符号如需对外转发则同步 session-manager/index.ts）'
  - 'daemon.ts——ws.registerRpcHandler("session_compact", handler) 挂进既有注册组（:6434 _registerListDirRpcHandler 旁，同 list_dir/list_roots/get_spec_bundle 先例形态）：handler 取 params.session_id → this._sessionManager 为 null 时 throw（:1569 类型可空；AC-14 先例是 lease 记 error 不崩，此处 RPC 场景 throw 让 backend 收 RemoteError 而非静默成功）→ 调 sessionManager.compact(sessionId) → 返回 CompactResult 对象即 RPC result；session 不存在/守卫拒绝 → throw 上抛'
  - 'NEW tests/interactive/session-compact.test.ts——守卫矩阵（六守卫各一用例：四状态拒绝 + driver 缺方法 + caps false，各自错误形态断言）+ 分派断言（driver.compact 收到对应 handle、CompactResult 原样透传）+ handler 侧（_sessionManager=null → throw；正常路径 result 回传）'
acceptance:
  - 六守卫用例全绿（running/reconnecting/ended/failed/driver 缺方法/caps false 各自拒绝）
  - driver.compact 为可选契约：claude-sdk-driver/cursor-driver 零改动且 daemon typecheck 绿（契约向后兼容）
  - RPC handler 挂既有注册组，CompactResult 对象作为 RPC result 返回；_sessionManager=null 时 handler throw（backend 端映射归 task-02）
  - session-compact.test.ts 全绿 + 相邻 session-manager 套件零回归 + typecheck 绿
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/session-compact.test.ts
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/session-interrupt.test.ts
  - pnpm -C sillyhub-daemon exec tsc --noEmit
constraints:
  - v3 单点接线：protocol.ts 无新消息类型、control-dispatcher.ts 零改动、daemon.ts 只在既有注册组加一处 handler
  - claude 路 daemon 零改动（backend 直接走 inject）；本卡不实现 pi/codex driver.compact 本体（task-04/05）
  - handler 不吞异常——守卫/驱动错误如实 throw，映射责任在 backend（task-02）；守卫为 RPC 到达后的最终防线（R-04 窗口收窄）
  - daemon ESM 相对 import 带 .js 后缀（NodeNext）；Windows / Linux / macOS 兼容
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
