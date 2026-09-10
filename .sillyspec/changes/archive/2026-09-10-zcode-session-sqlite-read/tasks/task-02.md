---
id: task-02
title: 'implement-read-zcode-sqlite-reader'
title_zh: 'read-zcode-sqlite 读取器——node:sqlite 惰性只读开库、message×part 归一化、隐藏过滤、beforeSeq 窗口、容错'
author: 'qinyi'
created_at: 2026-09-10 11:50:52
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1, D-004@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - NEW:sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
provides:
  - contract: readZcodeSqliteMessages(sessId, beforeSeq) → AgentLogMessagesResult
    fields: [parsed messages, status, truncated, totalSegments]
expects_from:
  task-01:
    - contract: extractZcodeSessId 纯函数与 fixture SQLite 造库构造器
      needs: [sess-id 提取, fixture 造库 helper]
goal: >
  续写 task-01 已建骨架的 read-zcode-sqlite.ts 读取器：惰性 import('node:sqlite') 只读开库
  （默认 ~/.zcode/cli/db/db.sqlite），message×part 双层遍历归一化为 NormalizedLogMessage[]（design 实证映射表），让 rollout 文件已清理的历史 zcode 会话可完整对话化回看（FR-01）。
implementation:
  - 惰性 import('node:sqlite')——不可导入即抛「读取器不可用」（D-006@v1：生效版本 ≥22.13.0/≥23.4.0；22.5–22.12、23.0–23.3 带 flag 导入即抛错→调用方回落）；DatabaseSync 以 file:URI mode=ro 只读开库（WAL 并发读安全），默认库路径 ~/.zcode/cli/db/db.sqlite，模块级工厂可覆写库路径（fixture 注入）
  - 双层遍历归一化——message（按 sequence）×part（按 message_id+sequence），映射按 design 实证表：user 非隐藏下 part.type=text→user_input、assistant 下 text→reply、reasoning→thinking；ts=message.data.time.created（毫秒→ISO，取 {created,completed} 的 created）；seq 全局重编号 1 起，beforeSeq 切片（seq<beforeSeq）+ 最近窗口截断，truncated/totalSegments 语义对齐 parse-zcode-model-io
  - tool 单 part 产两段（D-004@v1）——tool_use（tool_name=data.tool、tool_use_id=data.callID、tool_input=state.input JSON.stringify 摘要首 2KB）+ tool_result（tool_result=state.output 摘要首 4KB、is_error=(status=='error')、附 tool_name）；state.status ∈ running/pending（无 output）只产 tool_use 段；2KB/4KB 截断口径对齐 parse-zcode-model-io
  - 隐藏消息整条跳过（D-003@v1）——data.semantics.uiVisibility=='hidden' || transcriptVisibility=='hidden' || visibility=='model-only' 任一命中即不产段；step-start/step-finish/timeline/file/compaction 及任何未知 part type 防御式忽略计入 skippedLines；坏行（data 非法 JSON/字段缺失）跳过计数不中断；会话不在库/查询异常直接抛出（回落归调用方，不伪造空结果）
  - 续写 tests/agent-log/read-zcode-sqlite.test.ts（复用 task-01 fixture 造库构造器）——主会话/子代理/空会话、tool completed/error/running/pending、隐藏三判据、未知 part 类型与坏行计数、beforeSeq 窗口与 truncated、开库失败抛「读取器不可用」
acceptance:
  - fixture 会话归一化输出 NormalizedLogMessage[]（九字段 snake_case），user_input/reply/thinking/tool_use/tool_result 与 design 实证表逐项一致；tool 摘要 2KB/4KB 截断生效
  - running/pending tool 只产 tool_use 段；隐藏三判据任一命中零段产出；未知类型与坏行计入 skippedLines 不中断；beforeSeq 切片返回 seq<beforeSeq 的最近窗口且 truncated/totalSegments 同文件 parser 口径
  - 开库失败（node:sqlite 不可导入/库文件缺失）抛「读取器不可用」；会话不在库/查询异常抛出而不吞（调用方可据此回落）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/read-zcode-sqlite.test.ts && pnpm typecheck
constraints:
  - 读取器不读 rollout 文件（文件读取属 task-03 回落路径）；对 zcode 库恒 mode=ro 只读连接，不写库
  - 不 bump engines（旧 Node 降级归调用方文件路径；@types/node bump 归 task-05）；不 import RpcError/ws-client（错误抛出交 handler 层）
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
