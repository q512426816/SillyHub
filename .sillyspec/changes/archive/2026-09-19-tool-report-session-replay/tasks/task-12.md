---
id: task-12
title: 'session-panel-page 挂载切换 + AgentLogSessionBody 退役删除（连带清理 agent-log-card.test.tsx 专属 describe）+ agent-logs.ts 类型注释'
title_zh: 'session-panel-page 挂载切换 + AgentLogSessionBody 退役删除（连带清理 agent-log-card.test.tsx 专属 describe）+ agent-logs.ts 类型注释'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-11']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
expects_from:
  task-11:
    - contract: AgentReplayBody
      needs: [sessionId, focusEntryId]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/lib/agent-logs.ts
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/lib/agent-logs.ts
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
goal: >
  把 isToolReportBody 会话主体从 AgentLogSessionBody 换挂为 AgentReplayBody，
  退役删除 AgentLogSessionBody 及其专属测试 describe，并同步 agent-logs.ts
  类型注释（design Phase 3.6 + 兼容策略回退单行分支）。
implementation:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx:3520 sessionBody 的 isToolReportBody 分支换挂 AgentReplayBody（sessionId 传 session.id），:67 import 行同步替换，:3474 isToolReportBody 判定逻辑本身零改动
  - frontend/src/components/daemon/agent-log-card.tsx 删除 AgentLogSessionBody（:1016 起）与「形态二」区块及模块头注释相应行（:4/:16/:441），保留 AgentLogCard（:877）/ AgentLogEntry /「查看内容」交互（design Phase 3.6）
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx 删除「7. AgentLogSessionBody（tool_report 会话主体）」describe 块（:844）及 setupSessionBody 辅助与 import 项（:48），其余 describe（AgentLogCard 折叠栏/复制/静默隐藏/查看内容/徽标）逐块保留
  - frontend/src/lib/agent-logs.ts 文件头与 readAgentLogMessages 注释同步新字段语义（sender/turn_id/model/duration_ms/usage 与 total_usage，类型已由 task-08 gen:types 生成），仍一律引用 api-types 生成 schema 禁手写
  - session-panel-page.tsx 注释中 AgentLogSessionBody 字样一并更正（:4014/:4048/:4071），保持注释与实现一致；frontend/src/components/daemon/session-panel/page-helpers.tsx:69 纯注释字样不在本卡 allowed_paths 不动
acceptance:
  - tool_report 纯日志会话（turn_count===0）主体渲染 AgentReplayBody；activated（turn_count>0）路径与 chat 会话渲染零改动（FR-01/D-001）
  - AgentLogSessionBody 全仓代码/测试/注释零残留（page-helpers.tsx 除外），前端类型检查通过（命令见 verify 字段）
  - agent-log-card.test.tsx 保留 describe 全绿，AgentLogCard 顶部折叠栏行为不变
  - agent-logs.ts 注释与新字段一致且无手写接口类型
verify:
  - cd frontend && pnpm test -- src/components/daemon/__tests__/agent-log-card
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - isToolReportBody 判定逻辑（session-panel-page.tsx:3474）与首条消息懒激活派发机制零改动；回退路径保持单行分支可 git revert
  - 不动 AgentReplayBody / agent-log-turns.ts / turn-timeline.tsx（task-11/09/10 产物），本卡仅换挂与退役清理
  - 不跑全量测试，仅跑 agent-log-card 相关测试与 tsc
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
