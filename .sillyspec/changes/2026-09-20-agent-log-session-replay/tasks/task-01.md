---
id: task-01
title: 'zcode 解析器字段扩展（usage/turn_id/model/is_meta/turn_end + totalUsage，内层 snake_case 直通）'
title_zh: 'zcode 解析器字段扩展（usage/turn_id/model/is_meta/turn_end + totalUsage，内层 snake_case 直通）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts
target_files:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts
provides:
  - contract: NormalizedLogMessage
    fields: [turn_id, model, usage, is_meta, turn_end]
  - contract: ZcodeModelIoParseResult
    fields: [totalUsage]
goal: >
  zcode model-io 解析器透传既有但被丢弃的用量与轮次数据：消息段增 turn_id/model/usage/is_meta/turn_end
  可选字段、解析结果增 totalUsage 全会话累计，为回放 token 徽标与轮次切分供数。
implementation:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66 NormalizedLogMessage 增可选字段：turn_id/model（string|null）、is_meta（boolean）、turn_end（boolean）、usage（{input_tokens,output_tokens,cache_read_tokens,cache_write_tokens}|null，内层键 snake_case 直通）
  - 解析主循环（parseZcodeModelIoLog，:147 起）：每行提取顶层 turnId→turn_id、model.modelId→model，产出段（reply/thinking/tool_use）挂该行 response.usage 五项原值（zcode inputTokens 已含缓存命中，原样填 input_tokens 不重算）；user_input/tool_result 段 usage=null
  - ZcodeModelIoParseResult 增 totalUsage：全量行 usage 求和（窗口截断/beforeSeq 切片前计算），外层键 camelCase
  - sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts 增断言：带 turnId/usage 的 fixture 段字段命中、totalUsage=全量和；既有 fixture（无新字段）行为不变回归
acceptance:
  - 带 usage/turnId 的 fixture 解析后段携带 turn_id/model/usage，totalUsage 等于各行 usage 五项之和
  - 既有 fixture（无新字段）解析结果新字段为 undefined，既有断言全绿（零行为回归）
  - 内层 usage 键为 snake_case（input_tokens/output_tokens/cache_read_tokens/cache_write_tokens）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/parse-zcode-model-io.test.ts
constraints:
  - 不改既有段 kind 语义/预算常量（20MB/200 段/5s）/beforeSeq 协议；不新增端点或 RPC 参数
  - 新字段全部可选，缺省不破坏老消费方
  - zcode inputTokens 已含缓存命中，usage.input_tokens 原样透传不重算（全量口径归一只发生在 claude-code 解析器）
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
