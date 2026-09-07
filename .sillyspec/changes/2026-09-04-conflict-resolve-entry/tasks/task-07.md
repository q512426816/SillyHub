---
id: task-07
title: 'daemon tests — sillyspec platform command (dispatch / flag mapping / timeout / busy reject / heartbeat carry and expiry stop)'
title_zh: 'daemon 测试（case 分发/strategy→flag 映射/超时/非零退出/忙拒/心跳携带与过期停发）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: ['task-05', 'task-06']
blocks: []
requirement_ids: [FR-02, FR-03, FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/tests/config.test.ts
  - sillyhub-daemon/tests/protocol-session-contract.test.ts
  - sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts
goal: >
  为 task-05 协议分发与 task-06 执行器/结果槽补齐 daemon 侧测试——case 分发、strategy→flag 单点映射、
  超时/非零退出/忙拒/无根 failed、心跳携带与 10min 过期停发（不发显式 null），并同步更新被新契约
  确定性破坏的既有测试（config 键表 / MSG 计数 / 心跳深比较）。
implementation:
  - 新建 tests/sillyspec-platform-command.test.ts——风格照 daemon-heartbeat-sillyspec.test.ts（fetch mock + 真实构造 Daemon + DaemonOptions 注入假 manager、makeConfig overrides 拉满循环间隔）与 control-dispatcher.test.ts（路由透传）；manager 执行器用例照 sillyspec-manager.test.ts 的 execFile mock 形态
  - case 分发与 flag 映射——WS SILLYSPEC_RESOLVE（payload change+strategy）→ manager.runResolve、SILLYSPEC_GHOST_CLEANUP → manager.runGhostCleanup，fire-and-forget（void 不 await、全路径 catch 不 reject，对齐 daemon.ts:5527 SILLYSPEC_UPDATE case 先例）；mock execFile 断言数组参数为 platform resolve --change 变更名 再接 --keep-local 或 --take-platform（payload 下划线 strategy 单点映射 CLI 中划线 flag，不经 shell）
  - 无根与失败矩阵——_sillyspecStatusRoot 为空 → 不 spawn 直接记 failed；超时（sillyspec_command_timeout_sec 注入调小，不真等 120s）与非零退出 → state=failed + exit_code + error（截断 ≤200 字符用例）；in-flight（含 npm 升级链共用判定）时新指令立即记 failed 且 error='another sillyspec command is running'；ghost-cleanup 两步顺序——先 doctor --cleanup-ghosts --confirm 再 platform sync（两步 spawn 顺序断言）
  - 心跳携带与过期——终态窗口内每跳 body 含 sillyspec_command_result 七键对象；10min 过期（时钟注入）后键完全不出现且不发显式 null（hub-client 可选参 undefined 即键缺席，D-004@v1）；latest-wins 新结果覆盖旧槽
  - 既有测试同步更新（确定性破坏点，2026-09-02 变更 task-04 漏列教训不重蹈）——config.test.ts 的 DEFAULT_CONFIG 键名 1:1 与默认值断言补 sillyspec_command_timeout_sec 默认 120；protocol-session-contract.test.ts 的 Object.keys(MSG) 计数断言因新增 2 常量改 24；daemon-heartbeat-sillyspec.test.ts 心跳 call.length 与整 body 深比较若因追加参破坏按落地形态同步（undefined 不占位惯例下应零破坏，破坏即实现偏离先例）
acceptance:
  - case 分发全绿——两消息各路由到 manager 对应方法且 payload 原样透传，fire-and-forget 不 await 不 reject
  - flag 映射与无根全绿——keep_local 与 take_platform 各映射正确 CLI flag（数组参数不经 shell）；无 status 根不 spawn 直接记 failed
  - 失败矩阵全绿——超时与非零退出记 failed 且 error 截 ≤200；忙拒 error 文案精确；ghost-cleanup 两步 spawn 顺序正确
  - 心跳两态全绿——窗口内携带七键对象 / 过期停发键不发显式 null / latest-wins 覆盖
  - 新文件与三个被更新既有测试全绿；全程 mock execFile/fetch 不真 spawn，时钟全注入不依赖真实 120s/10min
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/sillyspec-platform-command.test.ts
  - cd sillyhub-daemon && pnpm exec vitest run tests/config.test.ts tests/protocol-session-contract.test.ts tests/daemon-heartbeat-sillyspec.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 测试为主——仅当测试暴露被测源缺陷时可修 allowed_paths 内 src 文件，回 design §5 Phase 2 对照修正，禁止弱化断言迁就实现
  - 不真 spawn node、不依赖真实时钟（超时与 10min 窗口注入常量；Windows 安全）
  - 仅跑本文件与被更新文件，不跑 sillyhub-daemon 全量（CLAUDE.md 规则 0）
related_tests:
  - 'sillyhub-daemon/tests/config.test.ts（DEFAULT_CONFIG 键名 1:1 与默认值断言——新增 config 键必破，须补条目）'
  - 'sillyhub-daemon/tests/protocol-session-contract.test.ts（Object.keys(MSG) toHaveLength(22)——新增 2 常量后必破改 24）'
  - 'sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts（心跳 call.length 与整 body 深比较——追加结果参后如破按落地形态更新）'
expects_from:
  - 'task-05 MSG 常量与 payload 类型 + _handleWsMessage 两直连 case 形态'
  - 'task-06 runResolve/runGhostCleanup 执行器契约 + _lastCommandResult 槽与 10min 过期语义 + config 键默认 120'
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
