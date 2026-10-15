---
id: task-03
title: 'zcode-events.ts——通知 → AgentEvent 归一化器：stream.chunk（text/thought 双通道）、tool_call/tool.lifecycle、usage.delta、turn 边界、state.updated 模型目录；实测事件序列样例单测钉映射 （D-005 → FR-02）'
title_zh: 'zcode-events.ts——通知 → AgentEvent 归一化器：stream.chunk（text/thought 双通道）、tool_call/tool.lifecycle、usage.delta、turn 边界、state.updated 模型目录；实测事件序列样例单测钉映射 （D-005 → FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-005@v1, D-008@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/zcode-events.ts
  - sillyhub-daemon/tests/interactive/zcode-events.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/zcode-events.ts
  - NEW:sillyhub-daemon/tests/interactive/zcode-events.test.ts
provides:
  - normalizeZcodeNotification(notification): AgentEvent[] 归一化器 + state.updated 模型目录/reasoning levels 提取（task-04/05 消费）
expects_from:
  - task-02: ZcodeEnvelope 入站通知的已解码对象形状
goal: >
  ZCode 通知流 → 平台 AgentEvent 归一化：text/thought 双通道 token 流、工具生命周期、
  上下文用量、turn 边界、模型目录缓存。照 pi-events.ts/claude-events.ts 先例。
implementation:
  - v4/telemetry/event kind=stream.chunk：channel='text' → 文本增量事件；channel='thought' → 思考增量事件（chunkLength/firstChunk/assistantMessageId/partId 透传聚合键）
  - kind=tool_call / tool.lifecycle / tool_input_delta → tool_use/tool_result 生命周期事件（状态机：call→update→result）
  - kind=usage.delta → ctx_tokens 用量事件；kind=turn.started/turn.terminal + computer-use/operation-event turn-started/turn-completed → turn 边界事件
  - state.updated → 模型目录缓存（providerId/modelId/contextWindow/maxOutputTokens/reasoning levels）与状态补丁事件
  - 单测：以 2026-10-15 实测抓包序列（startup 5 条 + create + send + ~40 stream.chunk + usage.delta + turn-completed + state.updated）做 fixtures 钉映射
acceptance:
  - 实测 fixtures 序列归一化产出：text/thought 增量事件序、turn 边界、usage 事件、模型目录缓存——与抓包逐条对账
  - 未知 kind/通道安全忽略（不抛错不丢 turn 边界）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/zcode-events.test.ts
constraints:
  - 归一化器纯函数（无进程/IO 依赖）；未知事件 fail-soft 忽略
  - 不在本任务接线驱动（task-04 消费）
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
