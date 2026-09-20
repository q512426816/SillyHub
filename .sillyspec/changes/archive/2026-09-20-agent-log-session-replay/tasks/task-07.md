---
id: task-07
title: '前端适配层 agent-log-replay.ts（系统事件→stderr 首项/双保险切轮/轮 token 求和/主子日志判定）+ 单测'
title_zh: '前端适配层 agent-log-replay.ts（系统事件→stderr 首项/双保险切轮/轮 token 求和/主子日志判定）+ 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/agent-log-replay.ts
  - frontend/src/lib/__tests__/agent-log-replay.test.ts
target_files:
  - NEW:frontend/src/lib/agent-log-replay.ts
  - NEW:frontend/src/lib/__tests__/agent-log-replay.test.ts
provides:
  - contract: buildReplayTurns
    fields: ['SessionTurnView[]', isSubagentLog, selectMainLogs]
expects_from:
  task-06:
    - contract: AgentLogMessagesResponse
      needs: [turn_id, model, is_meta, turn_end, usage, totals]
goal: >
  回放适配层纯函数：把 NormalizedLogMessage[] 适配成 TurnTimeline 可渲染的 SessionTurnView[]，
  完成系统事件归一化、轮边界双保险切轮、轮 token 求和与主/子日志判定。
implementation:
  - 新建 frontend/src/lib/agent-log-replay.ts：isSubagentLog(entry)（session_id 或 log_path 含 'subagent'）+ 主日志排序（first_seen_at 升序，selectMainLogs 返回主列表）
  - buildReplayTurns(messages)：轮边界三保险=真人 user_input / turn_id 变化 / turn_end 标记；系统事件判定（zcode 文本 <task-notification> 或 <system-reminder> 前缀、is_meta=true 文本段）→ 该轮 processItems 首项 {kind:'stderr', text:'⚙ 系统事件 · '+摘要}（不占用户气泡，对话视图隐藏）
  - 段映射：reply→output 拼接（\n\n 连接）；thinking→processItems thinking；tool_use→tool 段（raw=tool_input、result=配对 tool_result、status: is_error→'deny' 否则 'ok'；无配对 result→result 缺省 + raw 前缀「[结果未记录]」，不假 running）
  - token：轮内 usage 求和 → inputTokens/outputTokens（无任何 usage→null）；ctxTokens=轮末次 usage.input_tokens
  - SessionTurnView 八字段必填契约：runId=`replay-<seq>`、turn:null、prompt=真人文本（系统触发轮 ''）、output（空串兜底）、status:'completed'、seenLogIds:new Set()（frontend/src/components/daemon/turn-timeline.tsx:220 类型契约）
  - 新建 frontend/src/lib/__tests__/agent-log-replay.test.ts：fixture 覆盖系统事件/双保险切轮/无 usage null/token 求和/子代理判定/多主日志排序（fixture 形状来自 2026-09-19 实证调研）
acceptance:
  - 系统注入消息不产用户气泡（落 stderr processItems 首项）；真人文本产 prompt
  - turn_id 变化与 turn_end 均切新轮；无 turn_id 数据退化为 user_input 单保险
  - 轮 token 求和正确、无 usage 全 null；isSubagentLog 命中 subagent_agent_ 前缀样例
verify:
  - cd frontend && pnpm vitest run src/lib/__tests__/agent-log-replay.test.ts
constraints:
  - 纯函数零 React/零网络（组件属 task-08）；TurnTimeline 零改动
  - 不虚构 token（null 即 null）；不新建 SessionProcessItem 种类（系统事件复用 stderr）
  - 消息字段读 api-types 生成类型（snake_case 原样访问，先例 agent-log-card.tsx:120）
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
