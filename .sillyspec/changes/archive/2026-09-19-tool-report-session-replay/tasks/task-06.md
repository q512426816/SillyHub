---
id: task-06
title: 'registry 注册两 format + host-fs-handler 透传新字段与 totalUsage'
title_zh: 'registry 注册两 format + host-fs-handler 透传新字段与 totalUsage'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-02', 'task-04', 'task-05']
blocks: ['task-07']
requirement_ids: [FR-02]
decision_ids: [D-006@v1]
expects_from:
  task-01:
    - contract: AgentLogMessagesResult
      needs: [totalUsage]
allowed_paths:
  - sillyhub-daemon/src/agent-log/registry.ts
  - sillyhub-daemon/src/host-fs-handler.ts
target_files:
  - sillyhub-daemon/src/agent-log/registry.ts
  - sillyhub-daemon/src/host-fs-handler.ts
goal: PARSERS 注册 'claude-code-jsonl' 与 'cursor-agent-transcript-jsonl' 两 format 键（key 与扫描上报层约定逐字一致），readAgentLogMessages 出口原样透传 task-01 契约扩展的新字段与 totalUsage，把 task-04/05 解析器接通到 RPC 出口（FR-02 / D-006@v1）。
implementation:
  - sillyhub-daemon/src/agent-log/registry.ts:64 PARSERS 增 'claude-code-jsonl' 与 'cursor-agent-transcript-jsonl' 两键，分别 import task-04（parse-claude-code-jsonl.ts）/ task-05（parse-cursor-agent-transcript.ts）产出的解析器注册（AgentLogParser 签名透传 content + beforeSeq）
  - 同步修正 registry.ts 头注释与 PARSERS 注释——「MVP 仅注册 zcode-model-io-jsonl」表述已过时（注释与实现不一致是万恶之源）
  - sillyhub-daemon/src/host-fs-handler.ts:2035 readAgentLogMessages 出口透传核对——parser(...)（:2119）与 readZcodeSqliteMessages(...)（:2063）返回值随 task-01 契约扩展自然携带新字段与 totalUsage，返回零改写，:2110-2112 返回字段列举注释同步补记
  - unsupported（:2082-2090）/ too_large（:2100-2108）早退分支零改动——返回形状仅既有五字段，design Phase 1.6 早退分支不受影响
acceptance:
  - getAgentLogParser('claude-code-jsonl') / getAgentLogParser('cursor-agent-transcript-jsonl') 返回对应解析器，未注册 format 仍返回 null 由调用方转 unsupported
  - readAgentLogMessages 对两新 format 走注册表分发进解析器，parsed 结果原样携带 sender/turn_id/model/duration_ms/usage 与 totalUsage，zcode sqlite 分派分支（host-fs-handler.ts:2063）返回值同样携带
  - unsupported / too_large / parse_error 返回形状与现状一致（新字段仅 parsed 路径出现）
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - unsupported / too_large 早退分支、白名单守卫与 zcode sqlite 分派逻辑零改动（分派条件仍仅 format==='zcode-model-io-jsonl'）
  - 注册表保持纯映射查询职责——不 import RpcError / ws-client / fs，错误与文件 IO 仍归 host-fs-handler
  - format 串不自造变体，与扫描上报层未来约定逐字一致（design Phase 1.5）
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
