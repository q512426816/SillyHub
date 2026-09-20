---
id: task-02
title: 'claude-code-jsonl 解析器（行过滤/段映射/usage 全量口径归一/isMeta/真人切轮）'
title_zh: 'claude-code-jsonl 解析器（行过滤/段映射/usage 全量口径归一/isMeta/真人切轮）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts
  - sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts
  - NEW:sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
provides:
  - contract: parseClaudeCodeJsonlLog
    fields: [messages, totalUsage, truncated, totalSegments, skippedLines]
goal: >
  新增 claude-code JSONL 解析器，把生产库存量 4 条 claude-code 日志从「原文回落」升级为
  对话化解析，并透传 usage（全量口径归一）与 is_meta 标记。
implementation:
  - 新建 sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts，签名对齐 AgentLogParser（sillyhub-daemon/src/agent-log/registry.ts:63：content + {beforeSeq} → AgentLogMessagesResult）
  - 行过滤：type∈{user,assistant} 产出；queue-operation/attachment/last-prompt/mode/system 行静默跳过；非 JSON 行计 skippedLines
  - assistant 行 content 块映射：text→reply 段、thinking→thinking 段、tool_use→tool_use 段（toolUseId=块 id、raw=JSON.stringify(input)）
  - usage 归一（全量口径）：usage.input_tokens = message.usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens；cache_read_tokens = cache_read_input_tokens；cache_write_tokens = cache_creation_input_tokens；output_tokens 原样；挂该行全部产出段；totalUsage 全文件求和（窗口前）
  - user 行：content 纯 tool_result 块→tool_result 段（toolUseId=块 tool_use_id、body=content 文本）；含 text 且非 isMeta→user_input 段（真人）；isMeta=true→reply 段照常产出但置 is_meta:true（系统事件由前端适配层处理）
  - 预算/窗口/beforeSeq/skippedLines/5s 超时语义与 sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts 逐字对齐（20MB 前置判定→too_large）
  - 新建 sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts：fixture 按本机真实日志形状（type 全集/tool_result 载体 user 行/isMeta/usage 含 cache 四项/坏行）
acceptance:
  - fixture 解析：tool_result 载体 user 行产出 tool_result 段非 user_input；isMeta 文本段带 is_meta:true；真人文本→user_input
  - usage 归一命中全量口径（input 含缓存读+写）；totalUsage=全文件和
  - beforeSeq 切片 + 200 段窗口 + truncated/totalSegments 语义与 zcode 解析器一致；>20MB 前置 too_large
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/parse-claude-code-jsonl.test.ts
constraints:
  - 不改 registry.ts（注册属 task-05）；不 import RpcError/ws-client（纯函数，错误走 status 分层）
  - 不改既有 parse-zcode-model-io.ts；不新增运行时依赖
  - usage 键 snake_case 直通（无 camelCase 中转）
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
