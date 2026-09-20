---
id: task-05
title: 'registry 注册两新格式 + host-fs-handler 透传确认 + read-agent-log-messages 测试'
title_zh: 'registry 注册两新格式 + host-fs-handler 透传确认 + read-agent-log-messages 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: ['task-01', 'task-02', 'task-03']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/registry.ts
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts
target_files:
  - sillyhub-daemon/src/agent-log/registry.ts
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts
provides:
  - contract: AgentLogMessagesResult
    fields: [totalUsage]
expects_from:
  task-01:
    - contract: ZcodeModelIoParseResult
      needs: [totalUsage]
goal: >
  注册表挂载两个新解析器格式 key 并让 RPC 结果带 totalUsage：daemon 侧分发面收口，
  使 claude-code/cursor-agent 日志经既有 read_agent_log_messages RPC 直接可解析。
implementation:
  - sillyhub-daemon/src/agent-log/registry.ts:77 PARSERS 增 'claude-code-jsonl'→parseClaudeCodeJsonlLog、'cursor-agent-transcript'→parseCursorAgentTranscriptLog（key 与 CLI 上报 format 串逐字一致约定不变）
  - registry.ts AgentLogMessagesResult 增可选 totalUsage（外层 camelCase，注释注明 platform 侧映射 totals）
  - sillyhub-daemon/src/host-fs-handler.ts:2035 readAgentLogMessages 确认 result 结构透传（预期零逻辑改动，类型注释/返回结构对齐即可；sqlite 分支返回值同构）
  - sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts 增断言：两新 format 分发命中、未注册 format 仍 unsupported、totalUsage 随 result 上行
acceptance:
  - getAgentLogParser('claude-code-jsonl')/('cursor-agent-transcript') 返回解析器，未知 format 仍 null→unsupported
  - handler 层测试证明 totalUsage 随解析结果原样上行（zcode 文件路径 mock）
  - 既有 unsupported/too_large/lstat 预判用例全绿（零回归）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/read-agent-log-messages.test.ts
constraints:
  - host-fs-handler 只做透传确认，不加业务逻辑；白名单守卫/zcode sqlite 优先分派不动
  - format key 与 CLI 上报串逐字一致（cursor-agent-transcript 为跨仓契约，sillyspec 仓上报落地前本仓先备好解析器）
  - 二进制格式（sqlite/zstd）仍由平台侧 409 黑名单拦截，daemon 侧兜底 unsupported 不变
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
