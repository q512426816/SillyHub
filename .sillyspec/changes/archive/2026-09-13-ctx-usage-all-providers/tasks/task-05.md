---
id: task-05
title: 'claude-events 改调共享 helper（行为零变化）+ 既有测试回归'
title_zh: 'claude-events 改调共享 helper（行为零变化）+ 既有测试回归'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 01:12:24
priority: P1
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
expects_from:
  task-01:
    - contract: usage-ctx-helper
      needs: [ctxTokensFromNetInput]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-events.ts
target_files:
  - sillyhub-daemon/src/interactive/claude-events.ts
goal: >
  claude-events.ts :946 三分量求和 (startInput ?? 0) + startCrV + startCcV 改调
  共享 helper ctxTokensFromNetInput（FR-05 派生公式单源，claude / pi / cursor
  同式一处定义）——公式同式、行为零变化（风险 R-03），仅消除口径三处重复定义；
  差分路径（:1007-1008）无法直接复用三和 helper，原样保留并以注释锚定不变式。
implementation:
  - import { ctxTokensFromNetInput } from './usage-ctx.js'（task-01 产出；ESM .js 后缀）
  - :943-949 main 桶起始重建改调 helper——buf.lastCallCtxTokens = ctxTokensFromNetInput(startInput, startCr, startCc) ?? 0：三入参均 number | undefined，由 helper 内部按缺失=0 处理（startInput 可能 undefined）；?? 0 兜底三分量全缺分支（helper 全缺→undefined，旧代码恒 0，?? 0 恢复旧行为，字段类型 number :124 不变）；startCrV / startCcV 变量保留（:947-948 lastCallCacheReadTokens / lastCallCacheCreationTokens 赋值仍用）
  - :1007-1008 message_delta 差分路径（lastCallCtxTokens - prevCr - prevCc + newCr + newCc）原样保留零改动；:998-999 注释追加锚定「共享 helper ctxTokensFromNetInput 保持 lastCallCtxTokens = input + cache_read + cache_creation 不变式，delta 差分为其增量维护形态」
  - 全文件复核 lastCallCtxTokens 其余读写点（:124 声明 / :885 初始化 / :986 input 差量累加 / :1019 pendingUsage 条件携带）零改动
acceptance:
  - 既有 claude-events.test.ts 全绿零断言改动——含 golden 行为快照（full-message-mixed :106）、partial 流式实时 usage（:366）、ctx 派生断言（:392-394 / :442-449）
  - 行为零变化——对任一 fixture 输入，重构前后产出事件序列逐字段一致（ctx_tokens 值 / 事件序 / metadata 均不变）
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/claude-events.test.ts
  - pnpm -C sillyhub-daemon run typecheck
constraints:
  - 行为零变化是硬约束（R-03）——不改任何断言、不改差分路径、不动子代理桶恒 0 语义与 main 桶限定（NG-01）；测试红即实现漂移，修实现不修测试
  - golden 测试与既有断言一律不动
  - 只改 claude-events.ts（含注释）；claude-sdk-driver.ts SDK 透传路径不在本卡
  - 不强行重构差分路径复用 helper（设计明示增量维护公式无法直接复用三和 helper，注释锚定即可）
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
