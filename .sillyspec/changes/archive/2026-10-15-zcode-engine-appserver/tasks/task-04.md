---
id: task-04
title: 'zcode-app-server-driver.ts——驱动：spawn `node zcode.cjs app-server`、startup 就绪门、session/create-send-stop-close-setModel-setThoughtLevel-compact、requestPermission 代答桥（allow/deny/超时 fail-closed）、runtimePreferences/McpAuthHeaders/requestUserInput 自动应答、getThinkingLevels（state.updated reasoning levels）、握手失败结构化错误；驱动单测 （D-005 → FR-02/03/04/08）'
title_zh: 'zcode-app-server-driver.ts——驱动：spawn `node zcode.cjs app-server`、startup 就绪门、session/create-send-stop-close-setModel-setThoughtLevel-compact、requestPermission 代答桥（allow/deny/超时 fail-closed）、runtimePreferences/McpAuthHeaders/requestUserInput 自动应答、getThinkingLevels（state.updated reasoning levels）、握手失败结构化错误；驱动单测 （D-005 → FR-02/03/04/08）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04, FR-08]
decision_ids: [D-005@v1, D-008@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/zcode-app-server-driver.ts
  - sillyhub-daemon/src/interactive/thinking-levels.ts
  - sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/zcode-app-server-driver.ts
  - sillyhub-daemon/src/interactive/thinking-levels.ts
  - NEW:sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts
provides:
  - ZcodeAppServerDriver implements InteractiveDriver（start/consume/interrupt 必选 + compact/setThinkingLevel/getThinkingLevels 可选）——task-05 createDriver 工厂消费
expects_from:
  - task-01: _agentPaths 'zcode' 条目（exePath 发现，.cjs 经 process.execPath spawn）
  - task-02: ZcodeEnvelope 信封层
  - task-03: normalizeZcodeNotification 归一化器
# 边界补全（execute 期）：setThinkingLevel 依赖 thinking-levels.ts ENGINE_LEVEL_MATRIX 的 zcode 行（mapPlatformLevelToEngine 单源机制）——纯增量加行，纳入本卡 allowed_paths。
goal: >
  ZCode 引擎驱动：spawn app-server 子进程、就绪门、会话生命周期方法面、
  服务端请求分发（运行时偏好自动应答 + 权限代答桥）、协议失败结构化错误。
implementation:
  - start：spawn [process.execPath, exePath, 'app-server', '--cwd', cwd]，env 注入 ZCODE_DATA_BASE_DIR=<per-session>；等 startup/storageState phase='ready'（超时→结构化 error）；session/create {workspace:{workspacePath,workspaceKey}}；期间信封分发器自动应答 session/requestRuntimePreferences（{askUserQuestionAutoResolutionEnabled:true,memoryEnabled:false,modelContextBudgetStrategy:'preflight-v1',nativeSearchEnhancementsEnabled:true}）与 interaction/requestOfficialMcpAuthHeaders（空）
  - consume：每轮 session/send {sessionId, content}；通知流经 zcode-events 归一化产出 TurnMessageEnvelope；turn.terminal 收束轮
  - interrupt：session/stop {sessionId}；close：session/close {sessionId} + stdin EOF + 清理阶梯（EOF 宽限→SIGTERM→SIGKILL，照 codex-app-server-driver.ts 清理先例）
  - interaction/requestPermission 代答桥：manual_approval 走 sessionPermission.requestPermission 闭包（allow→回对应选项；deny/无注入/超时→fail-closed reject）；!manualApproval 自动放行（对齐 codex _handleApproval）；interaction/requestUserInput 回 cancelled（阶段 1）
  - 可选通道：compact() → session/compact；setThinkingLevel → session/setThoughtLevel；getThinkingLevels 由 state.updated reasoning levels 填充（driver.ts:438-441 可选方法）
  - 单测：就绪门超时/create-send 生命周期/权限三态/stop/close/握手失败结构化错误（fake 子进程脚本注入）
acceptance:
  - fake app-server 脚本（测试内置）全链路：spawn→ready→create→send→流式事件→stop→close 干净退出
  - requestRuntimePreferences 未答场景由分发器兜底（不超时挂死）；协议错误帧 → 会话 failed + 结构化 error 事件
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/zcode-app-server-driver.test.ts
constraints:
  - 零新增 npm 依赖；不动 adapters/json-rpc.ts；Windows .cjs 路径 spawn 经 process.execPath
  - 每会话一进程（D-007）；协议失败不重试不降级（D-004）
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
