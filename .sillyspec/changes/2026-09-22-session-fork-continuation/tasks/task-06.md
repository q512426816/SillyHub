---
id: task-06
title: 'daemon fork 透传——execPayload 解析+CreateSessionInput 增键+driverOpts 组装+claude driver resumeSessionAt/forkSession+driver-factory 独立转发分支（R-07）+（条件）pi 原生路径+单测（depends_on: task-05）'
title_zh: 'daemon fork 透传——execPayload 解析+CreateSessionInput 增键+driverOpts 组装+claude driver resumeSessionAt/forkSession+driver-factory 独立转发分支（R-07）+（条件）pi 原生路径+单测（depends_on: task-05）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-004@v1, D-007@v1]
expects_from:
  - task-05 lease.metadata 键 resume_at_uuid/fork_session（execPayload 契约）
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/session-manager/types.ts
  - sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/session-fork.test.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/types.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/session-manager/types.ts
  - sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - NEW:sillyhub-daemon/tests/session-fork.test.ts
goal: >
  daemon 侧 fork 参数透传：execPayload 解析 resume_at_uuid/fork_session → CreateSessionInput → driverOpts → claude driver SDK options（resumeSessionAt+forkSession），fork 转发与 systemPrompt 守卫解耦（R-07）；pi 视 D-008 定档条件接入。
implementation:
  - daemon.ts execPayload 解析（:9278-9281 resume 链旁）增 fork 四键透传 CreateSessionInput（D-012：resumeAtUuid/forkSession/forkAnchorEntryId/forkMode；session-manager/types.ts 增键）
  - session-manager/index.ts 建会话路径把两键并入 driverOpts（driverOpts.resume 旁，:1050-1054 同款）
  - driver-factory.ts 为 fork 参数建独立转发分支——不复用嵌在 systemPrompt 热切换守卫内的既有 forkSession 转发点（:245-260，R-07 解耦要求）
  - claude-sdk-driver.ts options 增 resumeSessionAt/forkSession（forkSession 生产先例 :476-479；resumeSessionAt 锚点语义按 task-02 spike D-008 结论）
  - （确认实装，D-008 pi=native）pi-rpc-driver.ts：pi fork 走活 RPC 会话发 fork 命令（{type:"fork", entryId}，createBranchedSession 语义）+ 用户消息 entryId 补挂：driver 层在归一化产物上把 entryId 写入用户消息 AgentEvent.metadata['engineAnchor']（D-011——pi-events 归一化层丢弃 entryId，driver 持 raw 视角可补挂；不碰 pi-events.ts/event-wire.ts 契约）
  - （D-011 新增）claude-sdk-driver.ts 锚点补挂：consume() 在 normalizeMessage 产物上把 raw record 顶层 uuid 写入 assistant 消息 AgentEvent.metadata['engineAnchor']（claude-events.ts 只读 message.id，链 UUID 在 driver 层才可见；resumeSessionAt 只收链 UUID 不收 msg_xxx——错值比 NULL 糟，D-008）
  - 新建 sillyhub-daemon/tests/session-fork.test.ts：execPayload 解析/Input 增键/driverOpts 组装/claude options 透传断言
acceptance:
  - fork 两键从 execPayload 到 claude SDK options 全链可见（单测逐跳断言）
  - 两键缺省时既有 resume/create 路径零回归
  - fork 转发分支与 systemPrompt 守卫互不触发（R-07 验收点）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/session-fork.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不新增 WS 协议消息类型（复用 lease 认领链）
  - claude driver 禁传 resumeDropsTurn（含 undefined——序列化 null 硬崩，D-008）；后台 job worker lane 禁用截断参数对
  - pi 分支按 D-008 native 定值确认实装（活 RPC fork 命令路径）
  - 禁跑全量测试
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
