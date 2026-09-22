---
id: task-03
title: 'driver 契约（可选两方法+StartOptions.thinkingLevel）+session-manager 子模块+两 RPC handler+execPayload 归一化+测试'
title_zh: 'driver 契约（可选两方法+StartOptions.thinkingLevel）+session-manager 子模块+两 RPC handler+execPayload 归一化+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 00:48:35
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/session-manager/index.ts
  - sillyhub-daemon/src/interactive/session-manager/thinking-level.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/interactive/session-thinking-level.test.ts
target_files:
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - NEW:sillyhub-daemon/src/interactive/session-manager/thinking-level.ts
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/tests/interactive/session-thinking-level.test.ts
provides:
  - contract: InteractiveDriver 可选两方法+启动字段
    fields: [getThinkingLevels, setThinkingLevel, ThinkingLevels, ThinkingLevelResult, InteractiveDriverStartOptions.thinkingLevel, CreateSessionInput.thinkingLevel, session_get_thinking_levels, session_set_thinking_level]
expects_from:
  task-01:
    - contract: ProviderCaps
      needs: [thinking_level]
  task-02:
    - contract: thinking-levels 单源
      needs: [mapPlatformLevelToEngine, isValidPlatformLevel]
goal: >
  daemon 侧承接思考档位 RPC 与创建透传（D-002 照 compact 单点接线形态）：driver.ts 定义
  可选 getThinkingLevels?(handle, model?)/setThinkingLevel?(handle, level) 两契约方法与
  ThinkingLevels/ThinkingLevelResult 类型+InteractiveDriverStartOptions.thinkingLevel 启动
  字段；NEW session-manager/thinking-level.ts 子模块（set 六守卫照 compact.ts+分派传
  state.model 给 claude）+session-manager.ts facade 两方法与 _buildDriverOptions 透传
  （plan-review P1-4）；daemon.ts 两 RPC handler+execPayload 归一化——FR-02 契约层+
  FR-03 创建链 daemon 段（三 driver 本体归 task-04）。
implementation:
  - 'driver.ts 契约——export interface ThinkingLevels { levels: string[]; current?: string } + export interface ThinkingLevelResult { ok: boolean; error?: string }（design §接口定义原文）；InteractiveDriver 加可选 getThinkingLevels?(handle: InteractiveDriverHandle, model?: string): Promise<ThinkingLevels>（model 参数供 claude supportedModels 按当前模型过滤，Grill P1-5）与 setThinkingLevel?(handle: InteractiveDriverHandle, level: string): Promise<ThinkingLevelResult>（可选方法先例 :221 close?() 与 compact?()；cursor 不实现即不支持，既有 driver 零改动零回归）；InteractiveDriverStartOptions 加 thinkingLevel?: string（三 driver 启动设置契约字段，Grill P1-9）'
  - 'types.ts——CreateSessionInput 加 thinkingLevel?: string（:377 model?: string 同款邻位，注释标 FR-03 创建链 daemon 入口）'
  - 'NEW session-manager/thinking-level.ts——照 compact.ts 六守卫先例落子模块：① setThinkingLevel(mgr, sessionId, level) 六守卫——store 无 session → SessionNotFoundError / status=running 拒绝 / status=reconnecting 拒绝 / status=ended+failed 非活跃拒绝（SessionNotActiveError 形态，仅空闲约束 D-002 前轮拍板）/ driver 未实现 setThinkingLevel 方法 → 拒绝 / getProviderCaps(provider).thinking_level=false → 拒绝（防御性双保险）；全过 → driver.setThinkingLevel(handle, level) 透传 ThinkingLevelResult ② getThinkingLevels(mgr, sessionId) 轻守卫——session 存在+driver 有方法+caps true（running 期间可查现值不打断在跑轮，R-04 切换后查询刷新依赖）；分派调 driver.getThinkingLevels(handle, state.model)（state.model 传参给 claude 过滤路径，Grill P1-5；types.ts :277 SessionState.model 现成）'
  - 'session-manager.ts——① facade 加 getThinkingLevels(sessionId)/setThinkingLevel(sessionId, level) 两方法一行委托子模块（照 compact() facade 形态；子模块符号如需对外转发同步 session-manager/index.ts）② _buildDriverOptions 调用处（:1031-1033 exePath/model 邻位，plan-review P1-4）加 thinkingLevel: input.thinkingLevel 透传（可选字段直传，driver 侧 !== undefined 判定）'
  - 'daemon.ts——① ws.registerRpcHandler("session_get_thinking_levels") 与 ws.registerRpcHandler("session_set_thinking_level") 挂 :6477 session_compact 旁既有注册组：取 params.session_id（set 另取 params.level，非法档 throw 拒绝）→ this._sessionManager 为 null 时 throw（RemoteError 上抛，映射责任在 backend task-05）→ 调 facade → ThinkingLevels/ThinkingLevelResult 对象即 RPC result；守卫拒绝/不存在 → throw 上抛 ② execPayload 归一化（:9175 rawExec.model ?? payload.model 同款，Grill P0-1）加 thinkingLevel: (rawExec.thinkingLevel as string | undefined) ?? (rawExec.thinking_level as string | undefined) ?? payload.thinkingLevel'
  - 'NEW session-thinking-level.test.ts——① set 六守卫矩阵（无 session/running/reconnecting/ended/driver 缺方法/caps false 各一用例+各自错误形态断言）② get 轻守卫（无 session/driver 缺方法；running 可查）③ 分派断言：driver.getThinkingLevels 收到 state.model（mock driver 记录参数）、ThinkingLevels 原样透传；driver.setThinkingLevel 收到原档位串 ④ handler 侧：非法 level throw、_sessionManager=null throw、result 回传形态 ⑤ _buildDriverOptions 透传断言（input.thinkingLevel → driverOpts.thinkingLevel，mock driver 构造参数捕获）'
acceptance:
  - setThinkingLevel 六守卫用例全绿（running/reconnecting 拒绝——仅空闲约束 D-002）；getThinkingLevels 轻守卫绿（running 期间可查）
  - 可选契约向后兼容：cursor-driver 等未实现方零改动且 daemon typecheck 绿；分派传 state.model 断言绿（Grill P1-5）
  - 两 RPC handler 挂既有注册组、result 对象回传、_sessionManager=null 时 throw；execPayload 归一化用例绿（rawExec.thinkingLevel/rawExec.thinking_level/payload.thinkingLevel 三源回退）
  - session-thinking-level.test.ts 全绿 + 相邻 session-compact/session-interrupt 套件零回归 + typecheck 绿
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/session-thinking-level.test.ts
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/session-compact.test.ts tests/interactive/session-interrupt.test.ts
  - pnpm -C sillyhub-daemon exec tsc --noEmit
constraints:
  - 照 compact 单点接线：protocol.ts 无新消息类型、control-dispatcher.ts 零改动、daemon.ts 只在既有注册组加两 handler
  - 本卡不实现三 driver 方法本体（task-04）；本卡分派测试用 mock driver 实现两方法
  - handler 不吞异常——守卫/驱动错误如实 throw，RemoteError→「请升级 daemon」文案映射责任在 backend（task-05）；守卫为 RPC 到达后的最终防线
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
