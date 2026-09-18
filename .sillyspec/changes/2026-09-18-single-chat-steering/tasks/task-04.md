---
id: task-04
title: 'claude SDK 队列 mid-turn 吸收 spike 实测（spike-02，queued_turn_count 断言，证据落盘 spike-claude-steering.md）'
title_zh: 'claude SDK 队列 mid-turn 吸收 spike 实测（spike-02，queued_turn_count 断言，证据落盘 spike-claude-steering.md）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-18-single-chat-steering/spike-claude-steering.md
  - sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts
target_files:
  # spike md 为规范产物（非代码交付）：文件已在 worktree commit 落盘并经 review/verify 核验；不进代码对账集
  - sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts
provides: >
  claude SDK 忙轮推流后命令队列 mid-turn 吸收时机实测结论（queued_turn_count
  ≥1 且未 interrupt 的证据），消费方 task-01 caps 取值收尾；预期驱动源码零改动。
goal: >
  实测 claude SDK 0.3.247 忙轮向 query({prompt: AsyncIterable}) 输入流推消息后
  命令队列是否 mid-turn 吸收（queued_turn_count ≥1、不 interrupt、消息在下一
  次 LLM 调用前生效），证据落盘 spike md 并在 claude-sdk-driver.test.ts 补守护
  用例（FR-01 / R-01）。
implementation:
  - '类型证据定位：sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts 的 queued_turn_count（:4672/:4726）、still_queued（:3821）与 absorbed mid-turn fold 语义注释（:1900），明确断言口径'
  - '实测会话：经 ClaudeSdkDriver.start 的输入 AsyncIterable（claude-sdk-driver.ts:402 实测签名 query({prompt: AsyncIterable, options})，:499 sdkQuery 调用点）先推一条长任务 turn，结果流进行中（工具调用间隙）再推第二条用户消息'
  - '断言吸收：推送后 queued_turn_count ≥1、全程未调 interrupt、第二条消息在下一次 LLM 调用前投递（流内 absorbed/queued fold 或次轮正常执行证据），原样记录到 spike md'
  - '补守护用例：sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts 按文件既有 mock 惯例追加用例——忙轮推第二条消息不触发 interrupt、次轮生效；既有用例零改动（真实机吸收证据以 spike md 为准，CI 不依赖网络/鉴权）'
  - '结论落盘：写 spike-claude-steering.md——环境（SDK 0.3.247）、会话与断言证据、吸收时机结论（mid-turn 吸收 / 轮边界吸收=降级可接受）、给 task-01 caps 取值收尾的输入'
acceptance:
  - 'spike md 存在且含：SDK 版本环境、忙轮推流证据（queued_turn_count 数值/未 interrupt/投递时机）、明确结论（mid-turn 吸收或轮边界吸收降级）'
  - 'claude-sdk-driver.test.ts 新增用例通过且既有用例零回归'
  - '驱动源码零改动（claude-sdk-driver.ts 不在 allowed_paths）'
verify:
  - 'cd sillyhub-daemon && npx vitest run tests/interactive/claude-sdk-driver.test.ts'
  - 'test -f .sillyspec/changes/2026-09-18-single-chat-steering/spike-claude-steering.md'
  - 'grep -n "结论" .sillyspec/changes/2026-09-18-single-chat-steering/spike-claude-steering.md（结论字段存在且含吸收时机定论）'
constraints:
  - '驱动源码预期零改动：实测推翻预期时不现场改 claude-sdk-driver.ts，先停下回报再扩卡或另立任务'
  - '降级可接受：若实测=轮结束才吸收，结论照落盘（效果=排队时延但不失败），caps 取值回改归 task-01 收尾'
  - '禁止跑全量测试，仅跑本卡相关测试；代码兼容 Windows/Linux/macOS'
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
