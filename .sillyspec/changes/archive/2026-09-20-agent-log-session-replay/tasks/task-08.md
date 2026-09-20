---
id: task-08
title: '回放主体组件 agent-log-replay-body.tsx + 挂载点（page:3520 + dialog:1913）+ AgentLogSessionBody 移除 + 注释同步 + agent-log-card.test.tsx 用例组迁移/删除 + 组件 smoke 两分支'
title_zh: '回放主体组件 agent-log-replay-body.tsx + 挂载点（page:3520 + dialog:1913）+ AgentLogSessionBody 移除 + 注释同步 + agent-log-card.test.tsx 用例组迁移/删除 + 组件 smoke 两分支'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/agent-log-replay-body.tsx
  - frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
target_files:
  - NEW:frontend/src/components/daemon/agent-log-replay-body.tsx
  - NEW:frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
expects_from:
  task-07:
    - contract: buildReplayTurns
      needs: [isSubagentLog, selectMainLogs, 'SessionTurnView[]']
related_tests:
  - path: frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
    reason: AgentLogSessionBody 删除后其 describe 用例组（会话主体形态）需迁移到 replay-body 测试或删除，import 行同步
goal: >
  回放主体组件与双挂载点：tool_report 空轮会话的主体换为会话样式回放（page+dialog），
  顶部条承载来源/工作会话/用量汇总，逐条目回落与离线态显式化，移除被取代的 AgentLogSessionBody。
implementation:
  - 新建 frontend/src/components/daemon/agent-log-replay-body.tsx：listAgentLogs(sessionId) → selectMainLogs 默认最新主日志 → readAgentLogMessages 顺序翻页到最早窗口（上限 10 页，超限停驻提示）→ buildReplayTurns 正序渲染；「加载更早」pill 顶部前插（beforeSeq=最小 seq）
  - 顶部条：harness chip + 主日志 chip +「工作会话（N）」浮层（isSubagentLog 条目列表，点击切换 selectedEntryId 查看子代理回放、可返回）+ 用量汇总（totals：输入/输出/缓存命中/模型，null→「未知」）+ 刷新（invalidate queryKeys.agentLogs.all，保留 30s 轮询）
  - TurnTimeline 挂载：viewMode 本地态默认 'all' 可切 'conversation'；errorMsg=null、pendingRequests=[]、dialogHistory=[]、onDialogResolved/onResend/onSwitchProvider=noop、sessionStatus='ended'、hasOnlineProvider=机器在线、emptyProviderLabel=provider 展示名；容器 min-h-0 flex-1 overflow-y-auto 与 TurnTimeline 同构
  - 回落：status≠parsed（unsupported/parse_error/too_large）或 ApiError（422/409/404/5xx）→ 该条目原文 <pre>（复用 RawLogContent 形态）+ 黄条原因；机器离线 → 离线提示 + 元数据（harness/短码/路径可复制）
  - 挂载：frontend/src/components/daemon/session-panel/session-panel-page.tsx:3520 isToolReportBody 分支换 AgentLogReplayBody；session-panel-dialog.tsx:1913 TurnTimeline 前加分支（useQuery getAgentSession 判 origin/turn_count，frontend/src/lib/daemon/sessions.ts:586 既有 API）
  - 移除 frontend/src/components/daemon/agent-log-card.tsx AgentLogSessionBody 导出与实现（:1016）；AgentLogCard 与「查看内容」内联面板保留
  - 注释同步三处：session-panel/page-helpers.tsx:69、session-panel-page.tsx:4014 与 :4048 的 AgentLogSessionBody 引用改写
  - 测试：新建 agent-log-replay-body.test.tsx（page 挂载分支 + dialog 挂载分支 + 回落原文 + 离线态 smoke）；agent-log-card.test.tsx AgentLogSessionBody 用例组迁移/删除
acceptance:
  - tool_report 空轮会话（page 与 dialog）主体渲染会话样式对话流：真人用户气泡/系统事件行/思考折叠/工具卡片/轮 token 徽标/用量汇总条
  - 子代理日志经「工作会话」浮层切换查看，不并入正文；多主日志默认最新可切换
  - unsupported/parse_error/too_large/422/409/404/5xx 回落原文+黄条；离线态提示+元数据；无 token 显示「未知」
  - 已激活 tool_report 会话不进本路径（isToolReportBody=false 走正常对话流），AgentLogCard 顶部栏保留
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/agent-log-replay-body.test.tsx src/components/daemon/__tests__/agent-log-card.test.tsx
constraints:
  - TurnTimeline 组件零改动；双主题铁律（brand-* 语义阶/主题 token，不硬编码 hex）
  - 输入区/首条消息懒激活语义不动（session-panel 既有保留）；不改 AgentLogCard 折叠栏与查看内容面板
  - 30s 轮询与刷新语义沿用 useSessionAgentLogs 既有形态
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
