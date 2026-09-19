---
id: task-11
title: 'AgentReplayBody 组件（主/子分类、加载更早、TurnTimeline 挂载 11 props 取值、工作会话折叠条、不可用三态、total_usage）+ 组件测试'
title_zh: 'AgentReplayBody 组件（主/子分类、加载更早、TurnTimeline 挂载 11 props 取值、工作会话折叠条、不可用三态、total_usage）+ 组件测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-09', 'task-10']
blocks: []
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-001@v1, D-002@v1]
expects_from:
  task-09:
    - contract: buildReplayTurns
      needs: [processItems, inputTokens, outputTokens, ctxTokens]
  task-10:
    - contract: SessionProcessItem
      needs: [system_event]
provides:
  - contract: AgentReplayBody
    fields: [sessionId, focusEntryId]
allowed_paths:
  - NEW:frontend/src/components/daemon/agent-replay-body.tsx
  - NEW:frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/agent-replay-body.tsx
  - NEW:frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx
goal: >
  新建 AgentReplayBody 回放主体组件与组件测试，把 tool_report 纯日志会话主体从
  元数据卡列表升级为 TurnTimeline 会话时间线——主/子分类、触顶加载更早、工作
  会话折叠条、不可用三态、total_usage 显示一并落地（design Phase 3.2-3.5）。
implementation:
  - 新建 frontend/src/components/daemon/agent-replay-body.tsx 导出 AgentReplayBody，props 为 sessionId（拉日志列表）与可选 focusEntryId（工作会话入口直读该 entry，design 接口定义节），容器 min-h-0 flex-1 overflow-y-auto 与 TurnTimeline 根同构（对齐 agent-log-card.tsx:1013 既有约定）
  - useQuery 挂 queryKeys.agentLogs.list（frontend/src/lib/query-keys.ts:88）调 listAgentLogs（frontend/src/lib/agent-logs.ts:43），按 log_path 含 subagent_agent_ 前缀分主/子（R-04 排序键 first_seen_at 同秒用 id 稳定）；无前缀主日志多条时最新为主、更早主日志归入折叠条
  - 主日志或 focusEntryId 指定条目调 readAgentLogMessages（frontend/src/lib/agent-logs.ts:88）取最近窗口，仅 status=parsed 进回放，buildReplayTurns（task-09）产物作 turns 挂 TurnTimeline（frontend/src/components/daemon/turn-timeline.tsx:327）；必填 props 回放取值逐项按 design Phase 3.2 清单——errorMsg=null、daemonRestartedHint=null、autoResumeEntries=[]、sessionStatus=idle、pendingRequests=[]、dialogHistory=[]、onDialogResolved/onResend/onSwitchProvider 均 no-op、hasOnlineProvider=false、emptyProviderLabel 空串、viewMode 本地 state 切换（对话/全部同款控件）、highlightTurnKey=跳转选中轮、suppressFollowBottom=跳转翻页期间置位
  - 触顶「加载更早」以当前窗口首条 seq 作 beforeSeq 前插（frontend/src/lib/agent-logs.ts:85 既有分页语义），truncated=false 后不再发起
  - 工作会话折叠条「工作会话（N）」形态对齐 AgentLogCard 折叠栏（frontend/src/components/daemon/agent-log-card.tsx:877 头部细栏+展开列表+刷新），条目点击置 focusEntryId 直读该日志回放（同组件复用）
  - 不可用三态顶部中文提示行——404 daemon 离线 / status=unsupported 或 409 格式不支持 / not_found 文件缺失，元数据 harness/大小/调用数/时间保留可见，parse_error/too_large 原文回落语义逐字保留；total_usage 由 daemon 返回前端不求和，显示在底部输入区旁，缺省显示「未知」不显示 0
  - 新建 frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx，覆盖时间线渲染分支（真人用户气泡+系统事件中性行）/ 三态提示 / 折叠条展开与条目进入 / 触顶加载更早分页 / total_usage 显示与未知兜底
acceptance:
  - 纯日志会话主体渲染为 TurnTimeline 时间线，主日志为正文、真人输入作用户气泡、系统事件走 system_event 中性行，必填 props 取值与 design Phase 3.2 清单逐项一致（FR-01/D-001）
  - 「工作会话（N）」折叠条可展开，条目点击进入该日志回放；多条主日志时最新为主、更早进折叠条（FR-01/D-002）
  - 触顶加载更早 beforeSeq 前插生效且到头后不再请求；total_usage 显示在输入区旁、缺省「未知」
  - daemon 离线/格式不支持/文件缺失三态中文提示行且元数据保留可见（FR-04）
  - 新增组件测试全绿且相关既有测试不回归（不跑全量）
verify:
  - cd frontend && pnpm test -- src/components/daemon/__tests__/agent-replay-body
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅新增两文件，不改 turn-timeline.tsx / agent-log-turns.ts / session-panel-page.tsx（分属 task-10/09/12 契约面与挂载切换）
  - token 缺失显示「未知」不显示 0 不伪造；累计只用 daemon 返回值前端不求和；样式双主题铁律 brand-* 语义阶不硬编码 hex
  - 不跑全量测试，仅跑本组件测试与 tsc
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
