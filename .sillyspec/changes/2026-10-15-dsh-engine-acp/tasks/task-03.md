---
id: task-03
title: 'dsh-acp-driver.ts——ACP v1 驱动：spawn `dsh --profile acp`（.cmd shim 解析）、initialize/session new·resume/prompt/cancel、request_permission 代答桥（allow/deny/超时 fail-closed）、握手失败结构化错误、可选 set_config_option 思考档位；驱动单测（D-003 → FR-02/03/04）'
title_zh: 'dsh-acp-driver.ts——ACP v1 驱动：spawn `dsh --profile acp`（.cmd shim 解析）、initialize/session new·resume/prompt/cancel、request_permission 代答桥（allow/deny/超时 fail-closed）、握手失败结构化错误、可选 set_config_option 思考档位；驱动单测（D-003 → FR-02/03/04）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:45:27
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/dsh-acp-driver.ts
  - sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/dsh-acp-driver.ts
  - NEW:sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
goal: >
  ACP v1 驱动：spawn `dsh --profile acp` 子进程，实现 InteractiveDriver 契约（start/consume/interrupt + 可选思考档位），权限代答桥接现有 sessionPermission 管线，握手失败结构化报错。
expects_from:
  - "task-02: normalizeAcpUpdate(update) → AgentEvent[]（consume 内消费）"
provides:
  - "dsh-acp-driver: createDshAcpDriver() 工厂 + DshAcpDriver 类（providers.ts INTERACTIVE_PROVIDERS.createDriver 消费）"
implementation:
  - 新建 sillyhub-daemon/src/interactive/dsh-acp-driver.ts：复用 sillyhub-daemon/src/adapters/json-rpc.ts 分帧/关联（codex 同款）；start() = spawn（exePath 经 resolveWindowsCmdShim 解析 .cmd）→ initialize（protocolVersion/capabilities）→ session/new 或 session/resume（opts.resume 非空）→ 按 provider_config 经 session/set_config_option 设 model
  - consume()：每轮 session/prompt，把 session/update 通知经 normalizeAcpUpdate 转 AgentEvent 产出；caps.steering=false（无忙轮注入，排队由上层语义处理）
  - interrupt()：session/cancel；可选 setThinkingLevel/getThinkingLevels 经 set_config_option reasoning_effort（档位映射对齐 pi 的 mapPlatformLevelToEngine 先例）
  - session/request_permission 服务端请求代答：manual_approval → sessionPermission.requestPermission（allow→ACP allow 选项；deny/无注入/超时→fail-closed reject）；!manualApproval || askUserOnly → 自动放行（对齐 codex _handleApproval 语义，codex-app-server-driver.ts:2337-2388）
  - initialize/session 握手失败或协议错误 → 结构化 error 事件 + 会话 failed（D-002 兜底：不重试不降级）
  - 子进程清理阶梯：stdin EOF 优雅退出 → 宽限 → SIGTERM → SIGKILL（codex 先例）
  - 新建 sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts：mock 子进程（fake json-rpc stdio）覆盖握手/new/resume/prompt 流、代答三态（allow/deny/超时）、cancel、握手失败结构化错误
acceptance:
  - InteractiveDriver 契约实现完整（start/consume/interrupt 必选 + thinking 可选；compact 不实现）
  - 代答三态行为正确（allow→allow 选项回传；deny/超时→reject；askUserOnly→自动放行）
  - 握手失败产出结构化 error 且不重试
  - 驱动单测全绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/dsh-acp-driver.test.ts
constraints:
  - 零新 npm 依赖（D-004）；协议帧只用现有 adapters/json-rpc.ts
  - 无 token 级流式（提交点粒度，非目标）；不做 compact/steering
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
