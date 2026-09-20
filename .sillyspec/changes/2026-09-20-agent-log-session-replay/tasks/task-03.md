---
id: task-03
title: 'cursor-agent-transcript 解析器（{role,message} 行 + turn_ended 切轮，usage 恒缺省）'
title_zh: 'cursor-agent-transcript 解析器（{role,message} 行 + turn_ended 切轮，usage 恒缺省）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts
  - sillyhub-daemon/tests/agent-log/parse-cursor-agent-transcript.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts
  - NEW:sillyhub-daemon/tests/agent-log/parse-cursor-agent-transcript.test.ts
provides:
  - contract: parseCursorAgentTranscriptLog
    fields: [messages, truncated, totalSegments, skippedLines]
goal: >
  新增 cursor-agent CLI transcript（~/.cursor/projects/*/agent-transcripts/*/*.jsonl）解析器：
  {role,message} 行 + turn_ended 事件切轮，对话结构可解析；token 不落盘故 usage/totalUsage 恒缺省。
implementation:
  - 新建 sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts，签名对齐 AgentLogParser（sillyhub-daemon/src/agent-log/registry.ts:63）
  - 行形态解析：{role:'user'|'assistant', message:{content:[块]}} → role=user 且 text 块→user_input 段（tool_result 块→tool_result 段，toolUseId=块 call_id）；role=assistant 的 text 块→reply 段、tool_use 块→tool_use 段（toolUseId=call_id）
  - {type:'turn_ended',status} 生命周期事件→产 turn_end:true 的标记段（kind 复用 reply、text 置空，is_meta:true 防正文污染，前端按 turn_end 切轮忽略其渲染）
  - usage/totalUsage 恒不产出（缺省）；非 JSON 行计 skippedLines；未知块类型防御式忽略（Cursor 承诺向后兼容增字段）
  - 预算/窗口/beforeSeq 语义与 zcode 解析器对齐（20MB/200 段/5s）
  - 新建 sillyhub-daemon/tests/agent-log/parse-cursor-agent-transcript.test.ts：fixture 按本机真实 transcript 形状（role 行/turn_ended/非 JSON 行/tool_use 无 result）
acceptance:
  - fixture 解析：user/assistant text 正确分类；turn_ended 产 turn_end:true 标记段；tool_use/tool_result 按 call_id 字段配对
  - 全程无 usage/totalUsage 字段产出（undefined）
  - 非 JSON 行入 skippedLines 不炸；未知块类型忽略
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/parse-cursor-agent-transcript.test.ts
constraints:
  - 不改 registry.ts（注册属 task-05）；纯函数不 import RpcError/ws-client
  - 不虚构 token 数据（缺省即缺省，前端显示未知）
  - turn_end 标记段不进正文渲染（is_meta:true + text 空）
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
