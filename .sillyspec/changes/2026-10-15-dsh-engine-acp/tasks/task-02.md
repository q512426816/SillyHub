---
id: task-02
title: 'dsh-acp-events.ts——session/update 通知 → AgentEvent 归一化器（assistant 消息/thought/tool_call/tool_result），ACP spec 样例事件序列单测钉映射（D-003 → FR-02）'
title_zh: 'dsh-acp-events.ts——session/update 通知 → AgentEvent 归一化器（assistant 消息/thought/tool_call/tool_result），ACP spec 样例事件序列单测钉映射（D-003 → FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:45:27
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/dsh-acp-events.ts
  - sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/dsh-acp-events.ts
  - NEW:sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts
goal: >
  ACP session/update 通知 → AgentEvent 归一化器：把 dsh ACP 的提交点通知（assistant 消息/thought/工具生命周期/context usage）映射为平台统一 AgentEvent（照 pi-events.ts / claude-events.ts 先例）。
provides:
  - "dsh-acp-events: normalizeAcpUpdate(update) → AgentEvent[] 纯函数（dsh-acp-driver 消费；无 IO 无状态）"
implementation:
  - 新建 sillyhub-daemon/src/interactive/dsh-acp-events.ts：处理 sessionUpdate 的 agent_message_chunk（committed 粒度）→ text、agent_thought_chunk → thinking、tool_call/tool_call_update → tool_use/tool_result（含 id/parent 关联）、context_usage → ctx_usage 事件；未知 sessionUpdate 类型安全忽略（前向兼容 dsh alpha 演进）
  - 对照 dsh 仓库 packages/acp/acp/README.md 能力矩阵与 sillyhub-daemon/src/types.ts:43-51 的 AgentEvent IR 写映射
  - 新建 sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts：ACP spec 样例事件序列钉映射（含乱序 tool_call_update、未知类型忽略、plan/modes 类不在列）
acceptance:
  - 样例序列映射输出与预期 AgentEvent 序列逐字段一致（text/thinking/tool_use/tool_result/ctx_usage）
  - 未知 sessionUpdate 类型不抛错不丢后续事件
  - 纯函数无 IO，可独立单测
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/dsh-acp-events.test.ts
constraints:
  - 只做归一化不做协议 IO（spawn/帧处理归 task-03）
  - plans/modes 类 update 不实现（ACP 明示 unsupported）
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
