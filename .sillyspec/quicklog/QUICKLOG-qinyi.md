
## ql-20260824-014-f1bd | 2026-08-24 11:19:47 | 暗色去紫改青配色定案落地
状态：已完成
关联变更：2026-08-23-frontend-dark-theme
文件：
- frontend/src/styles/themes.ts（darkTheme 去紫改青+中性底）
- frontend/src/app/globals.css（dark 块整体换 zinc 底与 cyan 阶）
- frontend/src/styles/themes.test.ts（dark 断言改 cyan zinc 口径）
需求：暗色去紫改青配色定案落地
根因：用户两轮反馈紫在暗色下刺眼且可读性差，经原型对比定案去掉紫色
方案：dark 换 zinc-900 中性黑底（slate 阶换 zinc 翻转去蓝调振动），primary 换 cyan-600 hover cyan-500，brand 阶换 cyan 阶翻转（text-brand-600=cyan-400 对比 8:1），themes.ts 与 globals.css 成对同步
结果：tsc 零错误；主题相关 3 测试文件 35/35 绿；本地容器重建后实测 bg/primary/brand-600/slate-500 新值全部生效；两份选型原型归档变更目录

## ql-20260824-015-7d95 | 2026-08-24 11:37:33 | 暗色会话 MD 表格白底白字复发根治
状态：已完成
关联变更：2026-08-23-frontend-dark-theme
文件：
- frontend/src/app/globals.css（markdown 库表格覆盖块重写为 .markdown-text 高特异度元素级规则）
需求：暗色会话 MD 表格白底白字复发根治
根因：库的偶数行斑马纹规则 tr:nth-child(2n) 与此前修复同特异度且库 CSS 后加载靠源序取胜，并行会话的变量重定义方案也与库 :root 同特异度同样输在加载顺序，两路修复在系统浅色用户上双双失效
方案：改元素级覆盖并经 MarkdownText 恒定包装类 .markdown-text 把特异度抬到 0,4,3 与加载顺序无关，奇数行 偶数行 表头三类行底全透明随容器，边框走 var(--color-border)；修正 dark 块内变量覆盖注释标明其仅为系统暗色补充
结果：三行表忠实级联测试（库 CSS 后注入最坏顺序+系统浅色+手动 dark）奇偶表头行底全透明边框 zinc-700 全 PASS；浅色两主题零覆盖

## ql-20260824-017-a6ef | 2026-08-24 13:22:21 | 会话面板技能装载内容不再误入对话正文
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-assembler.ts（classifySessionLog 新增 kind=skill 分类规则 + attachSkillInjection 挂载辅助函数）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（第 10 组技能装载 6 用例）
需求：会话面板技能装载内容不再误入对话正文，归入过程（进度）视图
根因：Claude Code 装载技能时 SKILL.md 全文以 assistant 文本块注入（[ASSISTANT] Base directory for this skill: 前缀，DB run d01bd6d2 实证），前端 classifySessionLog 把它归 reply，整份技能说明直接刷进对话气泡
方案：session-log-assembler.ts 分类器识别该前缀归新 kind=skill（仅 [ASSISTANT] 前缀形态，裸文本不误吞）；装配器 attachSkillInjection 把全文追加到同桶内最近 Skill 工具段 result（进度视图工具卡展开可见，多技能各挂最近不串段，子代理桶路由照常），无 Skill 工具段时退化文本段不丢内容
结果：新增 6 测试用例 TDD 先红后绿；daemon+sessions 28 文件 403 测试全绿；tsc 0 错；eslint 仅存量 warning（520/577 行未改动代码）
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档（涉及模块：frontend）（已核对修正：模块文档 frontend.md 变更索引已同步本条，CLI 审计时该文件属 baseline 脏文件未计入本轮）

## ql-20260824-018-7f80 | 2026-08-24 13:38:17 | 会话「进度」视图 Write/Edit 工具卡展开补参数详情（内容预览与 old/new 对比）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/turn-segment-views.tsx（WriteArgsDetail/EditArgsDetail 参数详情组件 + ToolRowView 展开区接线）
- frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx（ToolRowView describe 追加 5 用例）
需求：会话「进度」视图 Write/Edit 工具卡展开补参数详情（内容预览与 old/new 对比）
根因：8-19 段模型改版后 ToolRowView 展开只渲染 tool_result，Write/Edit 仅显示一句成功消息，参数详情未从旧 agent-log/tool-renderers 日志渲染器迁移，用户看不到具体改动内容
方案：turn-segment-views.tsx 展开区上半部按工具名渲染参数详情——Write 内容预览（5 万字符截断+标注+复制完整原文）、Edit 红-原文本/绿+新文本对比（line-clamp-6），下方保留原 result；非 Write/Edit 工具 result-only 零变化；配色走主题 token；复用 tool-renderers 导出的 CopyButton
结果：新增 5 测试用例 TDD 先红后绿；daemon+sessions 28 文件 408 测试全绿；tsc 0 错；eslint 0 告警

## ql-20260824-019-03db | 2026-08-24 14:01:40 | 会话进度视图工具卡展开区补齐（Edit 行级 diff 行号+红绿高亮 + 各工具参数详情）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/tool-args-detail.tsx（新文件——ToolExpandBody 展开区单一入口 + computeLineDiff/DiffView 行级 diff + 各工具详情组件）
- frontend/src/components/daemon/turn-segment-views.tsx（删 ql-018 内联预览组件，改一行 ToolExpandBody 接线）
- frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx（computeLineDiff 纯函数 5 用例 + DiffView 渲染 1 用例）
- frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx（ToolRowView describe 追加 8 用例：Edit diff/replace_all/Grep/MCP JSON/Bash pre+复制/10 万截断/Read 行范围+复制/Agent Prompt/非 JSON 零回归）
需求：会话进度视图工具卡展开区补齐（Edit 行级 diff 行号+红绿高亮 + 各工具参数详情）
根因：段模型改版后工具卡展开只有一句成功结果：Write/Edit 之外的参数详情整体缺失（Grep 参数/命中数、Agent Prompt、Bash 输出误走 Markdown、Read 复制不到内容、无 args JSON），且 Edit 只显示两个裸代码块没有行号与高亮
方案：新建 tool-args-detail.tsx 收拢展开区内容（ToolExpandBody 单一入口）：Edit 行级 diff（computeLineDiff LCS + DiffView 双侧行号+红绿行底+超大回退两块+复制新文本）；Bash 输出纯文本 pre+复制输出+10 万截断；Read 行范围+复制内容；Grep 参数行+命中 N 条；Agent Prompt 预览+复制；其余工具通用参数 JSON pre 兜底；Write 预览保持。turn-segment-views 删上一轮内联组件改一行接线
结果：新增 14 测试用例（diff 纯函数 5+DiffView 1+工具展开 8）；daemon+sessions 29 文件 422 测试全绿；tsc 0 错；eslint 0 告警

## ql-20260824-020-6f01 | 2026-08-24 14:39:38 | 会话进度视图 Edit 展开 diff 显示文件内真实行号
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx, frontend/src/components/daemon/tool-args-detail.tsx
需求：会话进度视图 Edit 展开 diff 显示文件内真实行号
根因：Edit 展开的 computeLineDiff LCS 自算行号是 old_string/new_string 片段相对行号（1 起），不是文件内真实行号；SDK tool_use_result.structuredPatch 本就携带 oldStart/newStart 真实行号 hunks，但 _extract_sdk_messages 展开 tool_result 时丢弃未透传
方案：方案 A 三端透传 structuredPatch：backend _extract_sdk_messages 提取注入 flat record edit_patch + AgentRunLog 加 edit_patch Text 列（migration 20260824130000 串行链接并行变更 20260824120000）+ SSE run/session 双 channel 透传 + AgentRunLogEntry DTO 自动透传三处 logs 端点；前端 AgentRunLogEntry/SessionStreamEnvelope/AssemblerLogInput/TurnSegment 四类型加字段 + 三处归一映射 + 装配器 tool_result 配对/孤儿两分支写段 editPatch + 新 parseStructuredPatch（真实行号起计、多 hunk 分隔、非法回退 null），EditArgsDetail 优先 patch 渲染、无 patch 回退 LCS 相对行号
结果：backend daemon+agent 1785 passed（新增 test_extract_sdk_edit_patch 3 用例）；前端全量 183 文件 2063 绿（新增 7 用例：parseStructuredPatch 4 + ToolRowView 2 + 装配器 1）+ tsc 0 + eslint 0 error；openapi.json 重生成；随即重建 backend/frontend 容器部署（migration 容器启动自动应用）
审计：⚖️ 归属切分：12 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/agent/model.py, backend/app/modules/agent/schema.py, backend/openapi.json, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/runtime-session-helpers.tsx, frontend/src/components/daemon/session-panel.tsx, frontend/src/lib/agent.ts, frontend/src/lib/daemon.ts, backend/app/modules/daemon/tests/test_extract_sdk_edit_patch.py, backend/migrations/versions/20260824120000_agent_session_archive.py, backend/migrations/versions/20260824130000_agent_run_log_edit_patch.py

## ql-20260825-001-f85b | 2026-08-25 03:03:00 | 会话相关代码审查修复：SSE 钉死 DB 连接、daemon 内存泄漏与 reload 竞态、前端卸载竞态等 33 项
状态：已完成
关联变更：（无）
文件：
- backend/app/core/auth_deps.py（P0 SSE 钉死 DB 连接修复：四处鉴权点 expunge+rollback）
- backend/app/core/tests/test_auth_deps_db_release.py（新增 4 用例）
- backend/app/modules/agent/service.py（两处 SSE 生成器 finally 隔离+aclose（F1 遗留补修））
- backend/app/modules/agent/tests/test_router.py（mock 同步 aclose）
- backend/app/modules/daemon/run_sync/service.py（close_interactive_run 行锁+sync 终态守卫）
- backend/app/modules/daemon/router.py（SSE 清理/payload 防御/keepalive/5 端点归属校验（已随 ed954822 提交））
- backend/app/modules/daemon/schema.py（LeaseSyncRequest status Literal 四值（已随 ed954822 提交））
- backend/app/modules/daemon/session/service.py（归档信号/end_session 锁时序/failed 幂等等 9 项（已随 ed954822 提交））
- backend/app/modules/daemon/tests/test_session_review_fixes.py（新增 21 用例）
- backend/app/modules/daemon/tests/test_sessions_events_stream.py（keepalive/清理/非 dict payload 扩展）
- backend/app/modules/daemon/tests/test_session_plan_bash_events.py（归属守卫 4 用例）
- backend/app/modules/daemon/tests/test_session_readiness.py（有界语义+归属 404）
- backend/app/modules/daemon/tests/test_session_service.py（rollback 预取适配）
- backend/app/modules/daemon/tests/test_session_sse.py（mock 同步 aclose）
- backend/app/modules/daemon/tests/test_session_runs_endpoint.py（mock 同步 aclose）
- backend/tests/modules/daemon/test_session_sse.py（FakePubsub 补 aclose）
- sillyhub-daemon/src/interactive/session-manager.ts（P0 终态延迟清理+P0 reload 串行链+budget 泄漏）
- sillyhub-daemon/src/interactive/input-queue.ts（关闭哨兵修 fd 泄漏）
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（pendingServerRequests 应答即删+void catch）
- sillyhub-daemon/src/interactive/claude-transcript-dir.ts（迁移异步化 node:fs/promises）
- sillyhub-daemon/src/interactive/claude-sdk-driver.ts（回调异常隔离）
- sillyhub-daemon/src/daemon.ts（flatSeq 按 session 回收）
- sillyhub-daemon/src/api-types.ts（gen:types 重生成补旧债）
- sillyhub-daemon/tests/interactive/session-manager-terminal-cleanup.test.ts（新增 6）
- sillyhub-daemon/tests/interactive/session-manager-reload-serial.test.ts（新增 3）
- frontend/src/components/daemon/session-panel.tsx（P0 卸载竞态三守卫+bash 归约）
- frontend/src/components/sessions/sessions-portal.tsx（400ms 去抖）
- frontend/src/components/sessions/session-config-bar.tsx（统一 limit=100）
- frontend/src/lib/utils.ts（debounceLeadingTrailing）
- frontend/src/lib/daemon.ts（run_id 白名单）
- frontend/src/components/daemon/turn-timeline.tsx（zh-CN）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引条目）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引条目）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引条目）
需求：会话相关代码审查修复：SSE 钉死 DB 连接、daemon 内存泄漏与 reload 竞态、前端卸载竞态等 33 项
根因：四路并行审查（backend 会话服务/SSE 通道/daemon 会话管理器/前端会话 UI）定位 4 个 P0（SSE 每连接钉死一条 PG 连接 50 并发打满连接池、daemon 终态会话内存永不释放、并发 reload 产生孤儿 Query 僵尸进程沉默烧 token、前端 dialog SSE 建流卸载竞态产生永久重连僵尸连接）+ P1/P2 若干（归档不发列表信号、end_session 持锁等 WS 10s、run 终态并发覆盖、daemon 上行 5 端点无归属校验可越权注入事件、SSE finally 不隔离异常致 Redis 连接泄漏、Bash 卡片跨命令数据污染、chunks 无界增长、双查询键重复轮询、invalidate 无去抖风暴等），均为并行合并遗留或实现缺陷
方案：F1 backend SSE/鉴权：auth_deps 四处鉴权点 expunge+rollback 归还 DB 连接、SSE finally 两步清理隔离+aclose、非 dict payload 防御、25s 强制 keepalive、ready/plan-mode/bash-status/bash-chunk/agent-task-status 5 端点加 runtime owner 归属校验（get_session_for_runtime_owner 404 不泄露存在性）；F2 会话服务：archive/unarchive 补发 publish_sessions_changed、end_session 对齐 interrupt 先 commit 后发 WS、close_interactive_run 加 with_for_update、LeaseSyncRequest status 改 Literal 四值+终态守卫、failed 幂等+lease 非终态才收口、9 处早退补 rollback、readiness pop 键有界、reopen 显式抛不变量违规；F3 daemon：终态会话 10 分钟延迟清理（restore 重建防误删）、_reloadSession per-session promise 链串行化、resetForResubscribe 关闭哨兵修 fd 泄漏、pendingServerRequests 应答即删、transcript 迁移 node:fs/promises 异步化、consume 回调异常隔离继续迭代；F4 前端：establishStream disposed/epoch/in-flight 三守卫、bash 卡片跨命令重置归约、chunks 600 条 256KB 封顶、useDaemonMachines 统一 limit=100、SSE 信号 400ms leading+trailing 去抖、agent_task_status 补 run_id 白名单、toLocaleString zh-CN、两处过时注释修正；主控补修 agent/service.py 两处同款 finally 泄漏、daemon api-types 重生成补 plan-response 等旧债、backend/frontend/sillyhub-daemon 三份模块文档变更索引同步
结果：backend 全量 pytest 5343 通过+15 失败（全为 agent/service.py close→aclose 后未同步的 SSE mock）→补修 4 个测试文件 mock 后 42 复跑全绿，等效 5358 绿；daemon 全套件 156 文件 2726 过 9 跳过 0 失败+ tsc 0；frontend 全量 193 文件 2161 绿 + tsc 0；ruff 全过；gen:types:check 前端/daemon双端通过；未部署。注：router.py/schema.py/session service 部分修复被并行会话 ed954822 先行带入提交，其余在工作区未提交

## ql-20260825-002-3e67 | 2026-08-25 07:16:22 | 会话优化第二轮：inject 锁外附件组装、词表单源统一、pg_trgm 搜索索引、daemon tmp 恢复与子代理桶清理、前端装配器 O(n²) 消除与订阅…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（附件锁外预组装+激活透传+词表别名+行锁+前导提前）
- backend/app/modules/agent/model.py（ACTIVE_RUN_STATUSES 单源）
- backend/app/modules/agent/finalizer.py（词表切换）
- backend/app/modules/agent/patrol.py（词表切换+注释修正）
- backend/app/modules/agent/mcp_tools.py（词表切换+注释修正）
- backend/app/modules/agent/mission_context.py（陈旧注释修正）
- backend/app/modules/daemon/router.py（_session_has_active_turn 词表切换）
- backend/migrations/versions/20260825150000_agent_run_logs_trgm_index.py（pg_trgm GIN 索引迁移（新增））
- backend/app/modules/daemon/tests/test_session_optimize_round2.py（12 用例（新增））
- sillyhub-daemon/src/interactive/session-store-persistence.ts（tmp 恢复+过期清理）
- sillyhub-daemon/src/interactive/session-manager.ts（子代理桶收缩+下载超时+终态通知串行链）
- sillyhub-daemon/src/interactive/types.ts（SessionAttachmentTimeoutError）
- sillyhub-daemon/tests/interactive/session-store-persistence.test.ts（恢复 6 用例）
- sillyhub-daemon/tests/interactive/session-manager-subagent-shrink.test.ts（新增 5）
- sillyhub-daemon/tests/interactive/session-manager-inject-attachment.test.ts（新增 6）
- sillyhub-daemon/tests/interactive/session-manager-terminal-notify-order.test.ts（新增 5）
- sillyhub-daemon/src/api-types.ts（gen:types 重生成补 page_context）
- frontend/src/components/daemon/session-log-assembler.ts（增量投影+幂等记忆+id 索引）
- frontend/src/components/daemon/session-panel.tsx（transferAssemblerInternals+unmount 守卫）
- frontend/src/lib/daemon.ts（resync 超时+onConnected）
- frontend/src/components/sessions/sessions-portal.tsx（onConnected 盲窗补偿）
- frontend/src/components/daemon/__tests__/session-log-assembler-perf.test.ts（新增 7）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（第二轮条目）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（第二轮条目）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（第二轮条目）
需求：会话优化第二轮：inject 锁外附件组装、词表单源统一、pg_trgm 搜索索引、daemon tmp 恢复与子代理桶清理、前端装配器 O(n²) 消除与订阅盲窗补偿
根因：上轮审查修复时有项需重构或跨模块联动的优化被有意搁置：inject 在 FOR UPDATE 行锁内读 MinIO 附件（锁窗口可数十秒）、活跃 run 状态词表在 daemon 与 agent 模块双份硬编码（漏判 pending_approval）、会话搜索 q 前导通配 ilike 无索引全扫、daemon sessions.json 落盘非原子窗口 tmp 不回收、子代理桶跨 turn 无界增长、inject 附件下载无超时且队列关闭错误泄漏给 WS 调用方、end 与在飞 turn result 通知乱序、前端装配器每条日志全量重投影 O(n²)、resync REST 无超时挂起重连、SSE 订阅建立与初始快照之间盲窗丢事件
方案：后端 6 项：附件组装与 gate 解析移到取锁前（普通读归属校验+锁内重校验 status/活跃 turn/gate 漂移）、_activate_tool_report_session 签名扩收切换字段与附件在激活事务内应用（空 prompt 409 中文拒绝防 pending 死轮）、agent/model.py 建 ACTIVE_RUN_STATUSES frozenset 单源（6 判定点切换+5 处陈旧注释修正）、_merge_lease_metadata 改 ORM with_for_update（方言感知）、create_session 前导组装提前到写事务外、迁移 20260825150000 建 pg_trgm 扩展+content_redacted GIN 索引（PG 守卫对称 downgrade）；daemon 4 项：load 目标缺失/空时按 mtime 从 tmp 恢复+save 后清过期 tmp、_shrinkSubagentBuffers turn 收尾清非 main 桶（token 折算进 main 保预算语义）、下载 60s 超时+SessionQueueClosedError 转译 SessionNotActiveError、_notifyChains per-session 串行链保 result→end 顺序（空链同步直调保时序）；前端 4 项：装配器增量投影 cell（symbol 键流转）+共享 seenLogIds 单槽幂等记忆（StrictMode 双调防丢日志）+段 id 索引 O(1)、resync REST 10s AbortSignal 超时、subscribeAgentSessionsEvents onConnected 补拉盲窗、三处 unmount 守卫
结果：backend 全量 pytest 5370 passed 0 failed（6 skipped 3 xfail 1 已知 xpass）；daemon 全套件 159 文件 2748 过 9 跳过 + tsc 0；frontend 全量 194 文件 2171 绿 + tsc 0；ruff 全过；alembic 单头 20260825150000（dev PG 未 upgrade 留部署时应用）；daemon api-types 重生成补 page_context 欠账（未提交故 gen:types:check exit 1 属预期）；未部署
审计：📝 文档欠账（D-8）：19 个源码文件改动未同步任何模块文档（涉及模块：backend · frontend · sillyhub-daemon）

## ql-20260825-003-6b7e | 2026-08-25 08:48:28 | 会话团队任务上下文贯通（主控简报+mission_status+非git直通+新会话派团队）
状态：进行中
关联变更：2026-08-24-session-team-mission-context
文件：（见实际改动）

## ql-20260825-004-7ef6 | 2026-08-25 11:23:48 | 悬浮会话页面上下文每轮注入——inject 不携带+显示不随页面更新
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/router.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/session/service.py, frontend/src/components/daemon/session-panel.tsx, frontend/src/components/floating/floating-session-host.tsx, frontend/src/lib/daemon.ts
需求：悬浮会话页面上下文每轮注入——inject 不携带+显示不随页面更新
根因：injectSession 不携带 page_context，后续追问 AI 不知道用户当前页面；上下文条用 store.pageContext 持久值不随 URL 变化
方案：后端 SessionInjectRequest/inject_session/_inject_into_session 加 page_context 字段+每轮 build_page_context_preamble；前端 sendFromQueue 每轮从 URL 派生 context 传入 injectSession；上下文条改用 derivedLabel 实时显示
结果：backend 18 page_context 测试绿+frontend 2185 测试全绿+tsc 零错误+gen:types 已同步
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/sessions/session-list-panel.tsx

## ql-20260825-005-5c1f | 2026-08-25 12:37:55 | CI 修复：create_session 前导提前实现补回（66bbccc5 剥离 hunk 致 main 红）+ inject 门面 page_context 补漏 + backend-ci 超时 45m
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/session/service.py, backend/app/modules/daemon/service.py, .github/workflows/backend-ci.yml
需求：扫描最近 CI 运行，列出失败/不稳定测试并完整修复
根因：①66bbccc5 提交了 test_preamble_assembled_before_write_txn 但「前导组装提前到写事务外」实现 hunk 按当时惯例剥离工作区未随提交（service.py 66bbccc5→2732239e 零差异佐证），be24345b 合并进 main 后 backend-ci 持续红（断言 ['flush','flush','preamble'] ≠ ['preamble','commit','flush']）；②ql-004 暂存半成品漏改 DaemonService.inject_session 门面签名，router 传 page_context 致 2 个 router 测试 TypeError；③backend-ci 30m 裕量被 5300+ 用例再次撞顶（7df39644 run 30:19 取消）；④frontend-ci 7df39644 的 typecheck 错误已在 2732239e 前修复无需处理
方案：create_session try 块顶部组装 change/page 前导（只读+to_thread 磁盘 IO）后立即 commit 收口只读事务再开写块（expire_on_commit=False 保证跨收口取属性安全，写块仍共用末尾唯一 commit）；DaemonService.inject_session 门面补 page_context 透传；backend-ci timeout-minutes 30→45
结果：test_session_optimize_round2 12 绿 / daemon 模块 1052 绿 / tests/modules/daemon 78 绿 / agent 域 946 绿 / 全量 5382 passed 0 failed 0 rerun（-n auto --reruns 2 与 CI 同参）/ mypy 706 文件零错 / ruff check+format 过
审计：工作区含 ql-004 暂存改动（inject page_context），本次修复以未暂存增量叠加未覆盖；全量绿同时覆盖两批改动

## ql-20260825-006-57c4 | 2026-08-25 13:16:48 | 会话输入框支持 Ctrl+V 粘贴图片/文件直接作为附件发送
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-input-bar.tsx（textarea onPaste 读 clipboardData.files 非空 preventDefault+复用 handleFiles；📎 title 补粘贴提示；头注释登记 ql）
- frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx（+4 粘贴用例；模块级 mock @/lib/api/session-attachments（factory 含 fetchAttachmentObjectUrl））
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引登记 ql-20260825-006-57c4）
需求：会话输入框支持 Ctrl+V 粘贴图片/文件直接作为附件发送
根因：无，纯新增——附件此前仅 📎 按钮选文件一个入口，用户复制截图/文件后需先落盘再选文件，链路长
方案：session-input-bar textarea 加 onPaste——clipboardData.files 非空则 preventDefault 并复用现有 handleFiles 上传管线（与 📎 完全等价，含 attachmentsDisabled 门控与 10 个上限），纯文本粘贴放行默认插入；📎 title 补粘贴提示
结果：新增 4 粘贴用例（图片 kind=image+chip+父级回传+事件取消 / 普通文件 kind=file / 纯文本不拦截 / disabled 门控），先红后绿；daemon+sessions 关联套件 33 文件 494 passed；tsc 0 错；eslint 0 新告警
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx, frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx

## ql-20260825-006-9d4c | 2026-08-25 13:20:05 | 会话页 AskUserQuestion 提问卡补最小化（task-08 只接了 approvals 聚合页，TurnTimeline 漏接）
状态：已完成
关联变更：2026-08-24-platform-session-feedback-fix（task-08 FR-04 / D-003 同款交互）
文件：frontend/src/components/permissions/minimized-dialog-capsule.tsx（共享胶囊组件（新增））, frontend/src/components/permissions/session-permission-panel.tsx（胶囊抽共享+resolvePendingTitle re-export）, frontend/src/components/daemon/turn-timeline.tsx（最小化状态+接线+胶囊）, frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx（6 用例（新增））
需求：会话页面 AskUserQuestion 这个弹窗还是没有最小化按钮操作
根因：task-08 的最小化（FR-04 / D-003@v1）当时只给 approvals 聚合页 SessionPermissionPanel 接线（passing minimized/onMinimize + 内联右下角胶囊）；会话页提问卡渲染在 TurnTimeline（page/dialog 两模式共用），AskUserDialogCard 未传 onMinimize——卡组件契约是「缺省不渲染最小化按钮」（向后兼容），故会话页恒无按钮
方案：①SessionPermissionPanel 内联胶囊 + resolvePendingTitle 抽为共享组件 minimized-dialog-capsule.tsx（DOM 逐节点等价，既有 session-permission-minimize 测试口径零改动全过；resolvePendingTitle 原地 re-export 保持导出面）；②TurnTimeline 内接同款交互：minimizedIds 内存态（卡收 minimized=true 渲染 null 但保持挂载→已选选项/手动输入保留）+ handleMinimize/handleRestore + pendingRequests 变化 prune effect（父级移除卡→胶囊计数同步清，覆盖提交与 permission_resolved 两条路径）+ ended/failed 门控同步胶囊 + 全部最小化时 sticky 容器去视觉框仅作挂载占位 + 胶囊渲染在滚动容器外（fixed 锚 viewport 不随日志滚）
结果：新增 turn-timeline-dialog-minimize 6 用例（默认按钮/最小化胶囊+角标+sticky 框移除/还原保留已填内容/多卡明细定点还原/父级移除 prune/ended 门控）全绿；回归 session-permission-minimize 8 + session-permission-panel 12 + turn-timeline-session-input-bar 14 绿；frontend 全量 195 文件 2194 测试绿 + tsc 0 错误
审计：未提交（工作区含 ql-003 进行中与 ql-004/005 暂存改动，待用户侧统一提交）

## ql-20260825-007-17cb | 2026-08-25 13:39:01 | dialog 弹窗会话输入框（含排队）接通附件管线
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（dialog 组件附件三件套/门控派生/handleSend D-7+enqueue 附件/submitFollowup 透传/三处 meta 清理/排队条 onRemove 补清理）
- frontend/src/components/daemon/session-input-bar.tsx（新 props attachmentsDisabledTitle（禁用原因文案））
- frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx（新建 5 用例（门控×2/追问/排队/D-7））
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引登记 ql-20260825-007）
需求：dialog 弹窗会话输入框（含排队）接通附件管线，Ctrl+V 粘贴附件真正发送
根因：ql-006 粘贴是 SessionInputBar 组件级能力，page 模式全链路通，但 dialog 模式不传附件 props 且 enqueue 硬编码空数组——📎/粘贴能上传但发送被静默丢弃；后端 injectSession 早已支持 attachment_ids，仅前端断链
方案：session-panel dialog 组件镜像 page 管线：附件状态三件套+门控（codex 引擎或无 sessionId 首句禁，新 attachmentsDisabledTitle 区分原因文案）+D-7 附件豁免空文本+enqueue 带 ids 与标记行+submitFollowup 透传 injectSession（无附件保持两参调用形态）+投递/移除/新建三处元数据清理+排队条 onRemove 补清理
结果：新建 5 用例先红后绿；daemon+sessions 34 文件 499 passed；tsc 0 错；eslint 0 error
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/session-input-bar.tsx

## ql-20260825-008-e1a2 | 2026-08-25 15:06:16 | 页面说明书知识库升级：内联小抄 → page_docs/*.md 结构化专业文档
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/page_docs/*.md（新建 13 份说明书：12 注册页 + ppm_project_detail 实体页，结构=功能定位/核心概念/页面结构与操作/典型工作流/常见问题）
- backend/app/modules/daemon/session/context.py（PAGE_MANUALS 内联字典 → _load_page_manuals() 从 page_docs/ 读文件，缺失页 log.warning 降级仅标签；ppm 分支硬编码"功能/使用"两行改走 ppm_project_detail.md；新增 PPM_PROJECT_MANUAL_KEY 常量）
- backend/app/modules/daemon/tests/test_page_context_preamble.py（断言从"- 功能：/- 使用："改为"## 功能定位"；新增 TestPageManualsIntegrity 键覆盖+结构完整性守护）
需求：用户反馈说明书"太简单了，要专业点"，并提议集成 .sillyspec/docs+knowledge 文档（经评估 dev 视角文档不适合直接注入用户会话，用户拍板先只完成说明书升级；向量检索留作二期）
根因：ae00176b 首版为 12 条 ≤6 行内联小抄，信息密度不足以支撑专业使用指导；且内联在 .py 里不便持续维护
方案：说明书落盘为独立 markdown（与代码同仓演进，backend Dockerfile `COPY . .` 整树进镜像，部署零额外配置）；加载在模块 import 时一次完成（OSError 静默降级不阻断会话）；完整性由测试守护防"加注册键忘写说明书"
结果：19/19 前导测试绿（含新增完整性守护）；daemon 模块全量 1152 passed；ruff/mypy 0 问题
审计：⚖️ 工作区存在并行会话未提交改动（daemon/service.py、session/service.py、前端多文件属 ql-002/004/006/007 在途），本次仅范围提交本条目文件

## ql-20260825-009-ca4d | 2026-08-25 15:17:17 | 团队任务简报注入 workspace root_path
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/orchestrator.py（collect_single_workspace_status 返回 dict 加 root_path、render_scope_brief 行格式加 path= 字段、render_session_orchestrator_briefing 锚点行加路径）
- backend/app/modules/agent/schema.py（ScopeWorkspaceStatus DTO 加 root_path 字段）
- backend/app/modules/agent/tests/test_mission_context.py（简报组装测试补 root_path 断言 + token 预算 1500→1600）
- backend/app/modules/agent/tests/test_mission_status.py（scope 条目测试补 root_path 断言）
- backend/app/modules/agent/tests/test_orchestrator_project_context.py（collect_scope_workspace_statuses 结构化字段测试补 root_path 断言）
需求：团队任务简报注入 workspace root_path
根因：主控 agent 拿到 workspace ID 后缺本地路径无法只读调研，Workspace 模型已有 root_path 但简报渲染未带上
方案：collect_single_workspace_status 返回 dict 加 root_path、ScopeWorkspaceStatus schema 加 root_path 字段、render_scope_brief 渲染行加 path= 字段、render_session_orchestrator_briefing 锚点行加路径；简报 token 预算 1500→1600
结果：42 针对性测试全绿、agent 模块全量回归中本次改动的 3 个测试文件零失败零错误、ruff 0 告警、mypy 无新增错误

## ql-20260825-010-db67 | 2026-08-25 15:34:25 | 会话页筛选胶囊 SVG 图标与文字换行修复
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/session-list-panel.tsx（FilterPill 内层 `<span class="min-w-0 truncate">` → `<span class="inline-flex min-w-0 items-center gap-0.5 overflow-hidden">`；两层筛选行容器恢复 `flex flex-wrap gap-1.5`）
需求：机器/智能体筛选胶囊内 SVG 图标与文字显示在同一行，同时所有机器胶囊全部可见
根因：Tailwind `truncate` 生成 `display:block`，SVG preflight 也是 `display:block`，block SVG 独占一行将文字推到第二行（pill 高度 33.6px → 应为 21.6px）；外层容器改 `nowrap`/`overflow-scroll` 导致部分机器被隐藏
方案：FilterPill 内层 span 改为 `inline-flex items-center gap-0.5 overflow-hidden`（flex 子项并排 + 溢出裁剪，保留 `max-w-[160px]` 截断），外层保持 `flex-wrap` 确保所有机器可见
结果：vitest 2204/2204 绿；tsc 零错；Playwright DOM 验证：全部 5 个机器胶囊 `display:flex`、`pillH=21.6px`、`sameRow=true`；docker fix 镜像重建后容器内 API 代理正常（/api/health 200）

## ql-20260825-011-76cf | 2026-08-25 18:21:40 | 会话聊天页 UX 修复：队列后端排队、发送中可打断+输入框本地缓存、文字可选中、上下文注入收进进度tab、团队/Bash/子代理折叠、左树工作区别名优先
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260825-012-89d6 | 2026-08-25 19:13:37 | daemon 会话恢复丢 stage 修复：validateRecord 补 stage/profile 三字段回填
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-store-persistence.ts（validateRecord 补 isStringArray 守卫 + stage/mcpRefs/skillRefs/effectiveAllowedRoots 四字段容错回填）
- sillyhub-daemon/tests/interactive/session-store-persistence.test.ts（新增 4 用例：回填完整/save-load 往返/非法类型丢字段保记录/stage 空串丢弃）
需求：daemon 会话恢复丢 stage 修复：validateRecord 补 stage/profile 三字段回填
根因：落盘侧 snapshotPersistable 写了 stage/mcpRefs/skillRefs/effectiveAllowedRoots，恢复侧 restoreAndReconnect 也读，唯独 load 校验 validateRecord 漏拷四字段——重启后 mission_worker 会话 stage 变 undefined，isMainAgentSession 谓词命中空串分支被静默注入 5 个派工 MCP 工具，防递归防线失效；profile 的 MCP 过滤与写守卫收紧恢复后也丢失
方案：validateRecord 新增 isStringArray 守卫（数组且元素全 string），stage 非空字符串回填、三数组字段守卫通过才回填，非法类型丢字段保记录（与既有损坏隔离风格一致）；测试先行补 4 个用例锁定回填语义
结果：目标文件 26/26 passed，interactive 全量 45 文件 561/561 passed，pnpm typecheck 0 错误
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/interactive/session-store-persistence.test.ts
