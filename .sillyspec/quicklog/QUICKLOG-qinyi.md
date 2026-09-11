
## ql-20260909-024-02ba | 2026-09-09 20:52:08 | sessions/page.test.tsx 12 用例失败修复——三重根因（视觉焕新漏跑断言过时/刻度轨阈值夹具/once 队列泄漏污染）
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（12 失败归零——轮次胶囊节点级断言×4+头像 title 断言+跳转夹具补第三轮+beforeEach mockReset 防 once 队列泄漏）
需求：sessions/page.test.tsx 12 用例失败修复——三重根因（视觉焕新漏跑断言过时/刻度轨阈值夹具/once 队列泄漏污染）
根因：视觉焕新提交（618bdaec2）只跑相关 40 套件未含本文件——轮尾换 RoundDivider 胶囊后轮次标签与状态拆成兄弟文本节点、头像换 ChatMessageAvatar 失去 aria-label；ql-20260909-005 刻度轨 <3 轮整条隐藏而轮次导航夹具仅 1-2 个 run；两类失败又经 vi.clearAllMocks 不清 mockResolvedValueOnce 队列的缺口连锁污染后继用例首屏
方案：page.test.tsx 五处修——4 处 getByText(/第 N 轮 ·/) 改节点级 getByText("第 N 轮")；头像 getByLabelText("发送者 X") 改 getByTitle（我（名字）/他人名字）；桌面跳转公共夹具 2→3 轮（最旧 r-ancient completed 孤儿补建为已加载第1轮，UNLOADED_TICK_LABEL 第1轮→第2轮）+直跳单轮补两个更新 failed run；beforeEach 对 getAgentSessionLogs 加 mockReset 防 once 队列泄漏
结果：page.test.tsx 36/36 两轮全绿（原 12 失败归零，文件时长 60s→9.7s）；tsc 0 错；eslint 0 error（4 warning 全预存）；frontend.changelog.md 已登记并勘正 ql-20260909-022 条目「存量环境债」误判
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/brainstorm-gate-agent-unavailable-and-list-path-parse.md

## ql-20260909-025-b045 | 2026-09-09 21:12:57 | 修冲突对比假差异——仅行尾/末尾换行差异的文件不再判 modified
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/sillyspec_compare.py（identical 判定改 _lines_equal 行尾归一化（全等短路+splitlines），docstring 同步）
- backend/app/modules/daemon/tests/test_sillyspec_compare.py（新增 eol_only_diff_classified_identical 三形态用例（CRLF/LF、末尾换行、行尾+真实改动），平台侧 write_bytes 控行尾）
需求：修冲突对比假差异——仅行尾/末尾换行差异的文件不再判 modified
根因：状态判定用原始字符串全等（对 CRLF/LF 敏感），而 _aligned_diff_rows 用 splitlines（行尾不敏感），口径不一致——本地 Windows 检出 CRLF vs 平台副本 LF 的文件判 modified 但差异行全 equal、前端无高亮，实测某冲突记录 183 文件全为此类
方案：sillyspec_compare.py 新增 _lines_equal（全等短路 + splitlines 行尾归一化）替代 identical 分支的原始全等，与 diff 渲染口径拉齐；diff 行生成不变，真实内容差异仍 modified；模块文档 daemon.md + daemon.changelog.md 同步
结果：test_sillyspec_compare.py 24 passed（含新增 eol_only_diff_classified_identical 1 用例），ruff check/format 通过，mypy sillyspec_compare.py 0 错

## ql-20260909-026-ff18 | 2026-09-09 21:26:48 | 修复 codex 交互会话必现卡死——早到 inject 竞态下 turn/start 未等 threadId 就绪被静默跳过
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（_awaitThreadId 等待 + 超时 failed 收敛 + 可注入超时参数）
- sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（ql-20260909-026 两条竞态回归用例）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（常量行补 threadId 等待 + 人工备注条目）
需求：修复 codex 交互会话必现卡死——早到 inject 竞态下 turn/start 未等 threadId 就绪被静默跳过
根因：backend 建会话即派发首句，inject 走 inject_wait parked 路径在 create 完成后立即入队，consume 循环握手写完即取到输入，此刻 codex thread/start 响应未到（h.threadId=null），_writeTurnStart 静默 return 后死等 currentTurnPromise——消息丢失、run 永久 running、零日志（生产实机案会话 e05addf7）
方案：codex-app-server-driver.ts consume 循环 beginTurn 后先 _awaitThreadId（50ms check-first 轮询等 thread/start|resume 响应，就绪零延迟）再写 turn/start，超时（默认 30s 可注入）按 turn failed 收敛并 console.warn，循环继续消费后续 inject 不再挂死；补 2 条竞态回归测试 + interactive.md 模块文档记录
结果：vitest codex driver 套件 72 passed（含新增 2 条竞态回归）；pnpm typecheck 0 错误；本机 daemon bundle 更新与线上验证随后执行

## ql-20260909-027-4b26 | 2026-09-09 22:17:13 | 修复 codex 用量全漏——thread/tokenUsage/updated 才是用量真源，driver 差值记账
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（tokenUsage/updated 解析+差值记账）
- sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（ql-20260909-027 三条用例）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（人工备注条目）
需求：修复 codex 用量全漏——thread/tokenUsage/updated 才是用量真源，driver 差值记账
根因：codex 0.147 的 turn/completed 不带 usage，适配器旧提取点恒空；用量在每次 API 调用后的 thread/tokenUsage/updated 通知（total 线程累计），生产 3 个 codex run token 全 NULL 实证
方案：codex-app-server-driver.ts：handle 增 threadUsageTotal/usageBaseline 双基线；handleLine 解析该通知（在途时发本轮累计差值 usage_update 事件喂 ledger）；轮 start 快照基线、轮末差值补 outcome.usage（毛值拆桶：input=Δinput-Δcached-Δwrite）；total 回退时重置基线
结果：vitest codex driver 套件 75 passed（新增 3 条：多调用差值+live 事件、跨轮基线、无通知零回归）；tsc 0 错误；E2E 实机对账随后统一执行

## ql-20260909-028-2582 | 2026-09-09 22:25:43 | 修复 pi 用量严重低报——逐调用累加替代 turn_end 定格值 replace
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/pi-rpc-driver.ts（逐调用累加+turn_end 注入轮累计）
- sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（ql-20260909-028 两条用例）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（人工备注条目（含对账数据））
需求：修复 pi 用量严重低报——逐调用累加替代 turn_end 定格值 replace
根因：pi 每条 message.usage 是单次调用量（jsonl ground truth 实证），turn_end 只定格最后一次调用，driver replace 语义丢轮内工具循环中间调用——实测全会话只记到真实 in 5.7%/out 8.5%/cacheRead 1.9%
方案：pi-rpc-driver.ts：handleLine 对 message_end assistant message.usage 逐条累加（turnUsageSum，轮 start 重置）；turn_end usage 事件以累加和为准（防定格值双计）并注入事件本体供 ledger/live；累加为空退回定格值零回归
结果：vitest pi 套件 79 passed（新增 2 条：多调用累加+注入、无 usage 回退）；tsc 0 错误；E2E 实机对账随后执行

## ql-20260910-001-4560 | 2026-09-10 03:27:52 | 影子会话 pending 提问读侧放开——群成员可见成员提问卡
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/permission_service.py（list_pending_dialogs 读侧影子分支（复用答题侧助手））
- backend/app/modules/daemon/tests/test_session_permissions.py（+3 读侧用例）
需求：影子会话 pending 提问读侧放开——群成员可见成员提问卡
根因：task-09 只放开答题端点，读侧 list_pending_dialogs 仍 owner/admin-only——非群主能答却看不见卡（askuser-pi-cursor 已知限制①）
方案：list_pending_dialogs ownership 404 时复用 _resolve_shadow_member_answer_session 影子成员分支（条件与答题侧同源），命中放行读否则 404；单聊/群会话语义零变化
结果：test_session_permissions 40 passed（+3：成员拉取成功/外人+移除成员 404/单聊非属主仍 404）；ruff/mypy/格式全净；未部署

## ql-20260910-002-dd6d | 2026-09-10 03:29:08 | 24h 审查风险修复第三批：群聊 pending 卡误关/pending 缓存 epoch 中毒/门户会话数据源断供/StrictMode 丢日志/多目标失败掩…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/pending_cache.py（get 返读时 epoch/set 纯盖章+NX 初始化）
- backend/app/modules/change/service.py（调用方透传 epoch）
- backend/app/modules/change/tests/test_pending_cache.py（防中毒回归 3 例+FakeRedis nx）
- frontend/src/components/group-chat/group-chat-panel.tsx（失败哨兵+快照开放态）
- frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx（拉取失败不关卡用例）
- frontend/src/components/sessions/sessions-portal.tsx（补参+第七入口快照）
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（includeSessions+续接快照用例，mock 透传参）
- frontend/src/components/floating/floating-session-host.tsx（补 includeSessions:true）
- frontend/src/lib/use-agent-run-stream.ts（去重移出 updater）
- frontend/src/lib/__tests__/use-agent-run-stream.test.ts（StrictMode 双调用例，旧实现验证变红）
- sillyhub-daemon/src/sillyspec-manager.ts（轮内聚合清空）
- sillyhub-daemon/tests/sillyspec-manager.test.ts（多目标掩蔽 4 例+harness targets/outcomeByCwd）
- .sillyspec/docs/SillyHub/modules/change.md / frontend_lib.md / frontend_components.changelog.md / .sillyspec/docs/sillyhub-daemon/modules/sillyspec-manager.changelog.md（模块文档四处同步）
需求：24h 审查风险修复第三批：群聊 pending 卡误关/pending 缓存 epoch 中毒/门户会话数据源断供/StrictMode 丢日志/多目标失败掩蔽/续接快照漏写六项
根因：①拉取失败与无卡混同致已见卡永久转已答 ②set 重读 epoch 把旧集合盖新章中毒 5 分钟 ③轮询拆分漏传 includeSessions 致 sessions 恒空 ④Set.add 副作用在 updater 内被 StrictMode 双调丢条目 ⑤单槽位 statusError 被同轮后位成功清掉 ⑥第七个选中入口不写工作区快照致文件树串档
方案：①queryFn 返回 failedShadowSessionIds+快照维持开放态 ②get 返读时 epoch/set 盖章不重读+NX 初始化 ③门户与悬浮宿主补 includeSessions:true ④去重移出 updater 纯追加 ⑤_collectOneTarget 返失败布尔+整轮聚合清空 ⑥onClick 补 setSelectedWorkspaceId(recentSession.workspace_id)
结果：backend change 507 passed+ruff/format/mypy 0 问题；daemon sillyspec-manager 64 passed+tsc 0；前端 11+53+31+93 用例全绿+tsc 0+eslint 0 错误；StrictMode 用例旧实现验证变红后转绿
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/lib/__tests__/use-agent-run-stream.test.ts, sillyhub-daemon/tests/sillyspec-manager.test.ts

## ql-20260910-003-0d35 | 2026-09-10 03:33:09 | codex/pi/cursor 用量接按模型明细表——驱动带 modelUsage 会话累计快照
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/driver.ts（DriverModelUsage 类型+helpers）
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（threadModel+快照+result 附带）
- sillyhub-daemon/src/interactive/pi-rpc-driver.ts（model_change+快照+result 附带）
- sillyhub-daemon/src/interactive/cursor-driver.ts（init 模型+快照+result 附带）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（人工备注条目）
需求：codex/pi/cursor 用量接按模型明细表——驱动带 modelUsage 会话累计快照
根因：daemon 的 model_usage 差分拆行管线只服务 claude（SDK modelUsage 透传），其余三家 result 无该字段 → agent_run_model_usage 无行、按模型统计页空、api_requests 不写
方案：InteractiveDriverResult 增 modelUsage（driver.ts 公共类型+helpers）；codex=thread/started 模型+tokenUsage 净值快照覆盖、pi=model_change 模型+message_end 逐调用累加、cursor=init 帧模型+result 帧逐轮累加，失败轮统一附带；daemon.ts/backend 零改动复用既有管线
结果：相关 5 套件 200 passed（新增 3 条）+ daemon-interactive 58 passed、tsc 0 错误；E2E 实机验证 agent_run_model_usage 行随后执行
审计：⚖️ 归属切分：5 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/lib/__tests__/use-agent-run-stream.test.ts, sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts, sillyhub-daemon/tests/interactive/cursor-driver.test.ts, sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts, sillyhub-daemon/tests/sillyspec-manager.test.ts

## ql-20260910-004-db16 | 2026-09-10 03:55:23 | AskUser answered_by 透传链补全——他答人名缺失与 409 英文文案双收口
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/permission_service.py（DTO 双层 answered_by + 409 details 透传）
- backend/app/modules/daemon/tests/test_session_permissions.py（+1 透传双通道用例）
- frontend/src/components/ask-user-dialog-card.tsx（onAlreadyResolved 回调 + 409 本地关闭态）
- frontend/src/components/group-chat/group-chat-panel.tsx（409 接线成员表映射人名）
- frontend/src/components/ask-user-dialog-card.test.tsx（+2 409 用例）
- frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx（+1 他答 409 带名用例）
需求：AskUser answered_by 透传链补全——他答人名缺失与 409 英文文案双收口
根因：SessionDialogRead 无 answered_by 字段：历史/恢复读无法渲染答题人；409 已答抬错 details 也不带——第二答题端只能干等 ≤10s 轮询且永远无人名，并直出英文报错
方案：backend：SessionDialogRead/WorkspaceDialogRead 增 answered_by（from_model 透传）+ DaemonDialogAlreadyResolved details 携带 answered_by；frontend：ask-user-dialog-card 增 onAlreadyResolved 回调（409 即时本地翻已答关闭态，不直出英文），group-chat-panel 接线经成员表映射人名
结果：backend 41 passed（+1 双通道断言）+ workspace dialogs 9 不回归；frontend dialog-card 31（+2）+聚合 12（+1）全绿、tsc 0、eslint 0 error；双端生产构建 exit 0；dev 库验证数据已清零
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/interactive/replay-real-log.test.ts

## ql-20260910-005-ea38 | 2026-09-10 04:17:44 | 24h 审查风险修复第四批：并发答题先到先得原子化+软删群反例+reparse 停机排空+compare 行边界口径收紧
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/permission_service.py（条件 UPDATE 先到先得）
- backend/app/modules/daemon/sillyspec_compare.py（_normalized_lines 单一源）
- backend/app/main.py（停机排空 reparse）
- backend/app/modules/daemon/tests/test_session_permissions.py（竞态+软删群两用例）
- backend/app/modules/daemon/tests/test_sillyspec_compare.py（口径矩阵+管线用例）
需求：24h 审查风险修复第四批：并发答题先到先得原子化+软删群反例+reparse 停机排空+compare 行边界口径收紧
根因：①守卫段 dialog 行无锁快照且行锁随守卫 commit 释放，并发双答后到者覆写 answered_by/answer 且 SSE 双发，影子答题放开后可达性放大 ②软删群答题反例无测试覆盖（审查 1.2 缺口）③停机 finally 不排空在飞 reparse 短事务 ④裸 splitlines 把 \v 等罕见分隔符当行边界吞掉，字节不同判 identical 超出原声称范围
方案：①条件 UPDATE 仅 pending 可翻+0 行重读按终态抛 409 携先到者 ②软删群 404 用例+竞态窗口模拟用例 ③shutdown finally 补 drain_reparse_workers ④两处共用 _normalized_lines 单一源只归一三种真行尾
结果：test_session_permissions 43+test_sillyspec_compare 26 全绿（竞态用例旧实现验证变红）；daemon+spec_workspace 全量 2144 passed 1 skipped（平台存量跳过）；ruff/format/mypy 0 问题
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/src/interactive/driver.ts

## ql-20260910-006-4d12 | 2026-09-10 08:25:25 | 会话面板头部后台下拉弹层被消息流背景盖住
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel/page-helpers.tsx（面板头常量补 relative z-20）
- frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx（回归锚字面量同步）
- .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md（变更索引条目）
需求：会话面板头部后台下拉弹层被消息流背景盖住
根因：2026-09-09-sessions-visual-refresh task-07 给面板头部加 backdrop-blur-md 玻璃头，backdrop-filter 使头部自成层叠上下文，头部内 absolute z-30 弹层 z 值被困其中，被树序在后的消息流 relative 外包层（bg-background 不透明背景）整体覆盖
方案：page-helpers.tsx 的 PANEL_HEADER_CLS_DESKTOP/MOBILE 补 relative z-20 抬升头部层叠层级（一并救活同头部子代理目录/搜索/mobile ⋯ 菜单弹层），同步更新 session-panel-variant.test.tsx 字面量回归锚与 frontend.changelog.md 变更索引
结果：session-panel-variant 7 + activity-catalog 5 + session-panel-ctx-tokens 4 + session-panel-team 18 共 34 用例全绿，eslint 两改动文件 0 告警

## ql-20260910-007-ce62 | 2026-09-10 08:58:37 | codex 会话 AskUser 不弹选择的根因修复——spawn 内置官方特性开关
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（spawn args 内置 AskUser 特性开关）
- sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（+1 spawn 断言 + 3 旧 args 断言适配）
需求：codex 会话 AskUser 不弹选择的根因修复——spawn 内置官方特性开关
根因：codex 官方将 request_user_input 工具锁 Plan 模式（生产案会话 118406c3 模型自证），平台 app-server 无以 plan 建线程、运行时特性开关对 underDevelopment 不生效——工具从未被调用，桥接无从触发
方案：daemon codex spawn 参数 unshift -c features.default_mode_request_user_input=true（app-server 子命令前；旧版未知键非 strict 仅告警向前兼容）；本机 ~/.codex/config.toml [features] 同步加键立即生效
结果：0.147/0.154 双版本端到端探针验证工具真弹出（GOT requestUserInput + questions 载荷）；codex 驱动两套件 77 passed（+1 断言）；tsc 0；生产待用户重启 daemon/新开会话验证

## ql-20260910-008-415c | 2026-09-10 10:42:27 | run-error-item 系统错误码映射补齐——daemon_restarted 等三码进映射表，修「运行失败 · unknown」吓人兜底
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/agent-log/run-error-item.tsx（三码映射+errorMetaFor+徽标键）
需求：run-error-item 系统错误码映射补齐——daemon_restarted 等三码进映射表，修「运行失败 · unknown」吓人兜底
根因：MODEL_ERROR_META 仅按模型错误 type 查表，调度层系统码走 item.code 落 unknown 兜底，且徽标固定拼 item.type 露「… · unknown」
方案：SYSTEM_ERROR_CODE_META 三码（服务重启中断/服务停止中断/任务中断，友好 defaultHint）+ errorMetaFor 统一入口（code 命中优先 type）+ 徽标键系统码命中显示 code；hint 链序不变
结果：42 用例全绿（新增 5）；tsc/eslint 0；模块 changelog 已记

## ql-20260910-009-14b6 | 2026-09-10 10:43:59 | 变更详情会话调试卡显示会话名称（title 优先空回退 id 短码）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/changes/detail/change-sessions-card.tsx（名称 title 优先/空回退短码）
- frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx（fixture 增 title 参数+两断言）
- .sillyspec/docs/frontend/modules/components-changes.md（卡片形态描述刷新）
需求：变更详情会话调试卡显示会话名称（title 优先空回退 id 短码）
根因：卡片恒渲染 id.slice(0,8) 短码，后端列表端点早已注入 title（首条 user_input 摘要前 30 字）未被使用
方案：条目名称 title 优先、null 回退短码（回退保留 font-mono，标题 truncate 防溢出）+ 测试补 title 优先与回退断言 + 模块文档同步入口卡现状
结果：change-sessions-card vitest 3 用例全绿

## ql-20260910-010-7626 | 2026-09-10 11:44:03 | MCP gateway 部署与派发链路实测缺陷修复（spike P2 六项）
状态：已完成
关联变更：（无）
文件：backend/app/core/config.py, backend/app/modules/mcp_gateway/router.py, backend/app/modules/mcp_gateway/tools.py, docs/mcp/getting-started.md, docs/mcp/tools-reference.md
需求：MCP gateway 部署与派发链路实测缺陷修复（spike P2 六项）
根因：远端 nginx 未路由 /mcp 且 SDK DNS rebinding 防护默认只放行 localhost 系 Host（反代域名过鉴权后 421）；token 签发不回接入地址致 url/token 三头分裂；派发前无 daemon 在线性查询面；no-creator 报错无修复动作；参数文档缺口；agent_type 硬编码默认与实际执行器不一致
方案：nginx 加 /mcp 路由 + mount_mcp 按部署配置重建 TransportSecuritySettings 白名单（MCP_GATEWAY_PUBLIC_BASE_URL/MCP_ALLOWED_HOSTS）；McpTokenCreated 成对下发 gateway_url（配置优先/转发头推导）；新增 get_daemon_status 工具（binding 明细+45s 阈值+ws_hub 实时态）；no-creator 文案与 hint 指明修复动作；dispatch_worker agent_type 默认改 ws.default_agent 驱动；tools-reference/getting-started/deploy SKILL 文档化全参数与成对原则；远端部署新 backend 镜像
结果：mcp_gateway 126 passed + agent dispatch_worker 3 passed，ruff/format/mypy 0，gen:types 同步；远端实测回归（sillyspec client.js 直连公网）initialize/tools/list/get_daemon_status（daemon_online=true ws_connected=true）/create_mission external（workers=[] 零 orchestrator）/dispatch_worker read_only 真派发 completed（$0.65）/get_run_logs 全通；mcp_tokens 无 spike 残留、回归数据已清理
审计：⚖️ 归属切分：7 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：.zcode/skills/deploy-to-server/SKILL.md, backend/app/modules/mcp_gateway/server.py, backend/app/modules/mcp_gateway/tests/test_router.py, backend/app/modules/mcp_gateway/tests/test_tools_new.py, backend/openapi.json, docs/mcp/README.md, frontend/src/lib/api-types.ts

## ql-20260910-011-3d92 | 2026-09-10 12:49:33 | 修复会话轮次排序错位:派发失败轮 started_at 为空被甩队尾
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/router/session_insights.py（排序 created_at + DTO created_at）
- backend/app/modules/daemon/router/session_crud.py（current_run 排序统一）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（orderedRuns 空值兜底）
- frontend/src/lib/daemon/sessions.ts（interface 补 created_at）
- frontend/src/lib/api-types.ts+backend/openapi.json（gen:types 重生成）
- backend/app/modules/daemon/tests/test_session_runs_endpoint.py（新增 NULL started_at 定序用例）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（新增派发失败轮用例+fixture 补字段）
- frontend/src/components/daemon/__tests__/*.test.tsx（2 个 fixture 补 created_at）
需求：修复会话轮次排序错位:派发失败轮 started_at 为空被甩队尾
根因：派发失败轮(daemon 离线 inject 发送失败即收敛 failed)的 started_at 永远为空(run_sync 首事件才写),而 list_session_runs 按 started_at.desc() 排序(PG DESC 默认 NULLS FIRST 排首位)且前端轮次刻度 orderedRuns 按 started_at 正序把空值排队尾,导致线上会话 e3d7ddfa 第 8 轮被排到第 11 位、第 8~11 轮轮号与对话流时间线全体错位
方案：后端排序统一改 created_at.desc()(轮次真实语义=run 创建序,对齐 agent 模块仓库惯例),SessionRunRead DTO/interface 透出 created_at;前端 orderedRuns 空值 fallback created_at(与对话流 user_input 日志时间轴一致);session_crud current_run 查询同款统一
结果：后端 test_session_runs_endpoint 13 passed(新增 NULL started_at 用例)+session_router/service 71 passed;前端 page.test 53 passed(新增回真实轮位用例)+variant 7 passed;tsc 0 错误;gen:types 已重生成;待部署阿里云验证
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/__tests__/session-panel-ctx-tokens.test.tsx, frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx

## ql-20260910-012-392f | 2026-09-10 15:14:09 | 平台同步区串台修复——变更中心改读工作区级 sillyspec 快照
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/changes/platform-sync-section.tsx（取数 map 优先 + 注释同步）
- frontend/src/components/changes/__tests__/platform-sync-section.test.tsx（+2 工作区级取数用例）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引 +ql-20260910-012；总览卡数据源描述纠正）
需求：平台同步区串台修复——变更中心改读工作区级 sillyspec 快照
根因：platform-sync-section.tsx 仍读机器级 sillyspec_status 单槽位；daemon 工作区级化后每轮采集逐目标覆盖单槽位，多工作区绑定时变更中心显示别区数据（总览卡 14a50351d 已改 map 优先，本组件漏改），用户实证总览卡 3 条冲突而变更中心不可见、无法在平台裁决
方案：取数对齐 changes-overview-card 同款：sillyspec_status_map 非空按当前 workspaceId 取（缺席=整卡不渲染，不回退单槽位防串台）；map 为 null（旧 daemon）回退机器级单槽位；组件头注释与 frontend.md 模块文档同步（含总览卡数据源描述纠正 map 优先）
结果：vitest 组件套件 14/14 passed（含新增 2 用例：map 优先不串台 / map 缺席整卡不渲染）；tsc --noEmit 零错；未重部署（阿里云需另行 deploy）

## ql-20260910-013-3b38 | 2026-09-10 15:42:50 | 变更详情页删除「任务看板」摘要卡与「审核历史」卡（用户裁定方案 A）。根因：平台审批链路零使用——本地 PG 341 变更 stages 带 review_hi…
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx（删两卡挂载/导入/taskBoard 取数/reviewHistory 派生，513→492 行）
- frontend/src/components/changes/detail/change-task-board-card.tsx（删除（连同测试））
- frontend/src/components/changes/detail/change-review-history-card.tsx（删除（连同测试，normalizeReviewHistory 一并退役））
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx（清两卡 vi.mock，保留只读展示区断言收窄）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx（清两卡 vi.mock 与 getTaskBoard mock）
- frontend/src/components/__tests__/delete-change-confirm.test.tsx（清两卡 vi.mock + daemon mock 改 importActual 部分 mock（修 SESSION_ENGINE_OPTIONS 收集期炸旧债））
- frontend/src/components/mobile/mobile-change-detail.tsx（X-03 落位清单 7/8 条注释标注桌面卡已删）
- .sillyspec/docs/frontend/modules/components-changes.md（detail 卡 9→7、定位段记录 ql-20260910-013）
- .sillyspec/docs/frontend/modules/app-workspace-pages.md（ChangeDetailPage 行数/右辅构成更新）
- .sillyspec/docs/frontend/modules/lib-tasks.md（getTaskBoard 消费方变更记录）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引追加 ql-20260910-013-3b38）
需求：变更详情页删除「任务看板」摘要卡与「审核历史」卡（用户裁定方案 A）。
根因：平台审批链路零使用——本地 PG 341 变更 stages 带 review_history 为 0 条、写入代码 2026-08-14 上线而平台内审批最后一次 2026-08-12（CLI 驱动工作流审批不落平台表），审核历史卡恒空；任务看板摘要须手动 reparse 才更新、状态英文裸显，与步骤条/时间线三重展示进度，均无消费价值。
方案：page.tsx 删两卡挂载/导入/taskBoard 取数/reviewHistory 派生；删两组件及测试 4 文件；三个页面级测试清 vi.mock 并收窄断言；mobile-change-detail 复用清单注释同步；顺手修 delete-change-confirm.test 的 @/lib/daemon 整模块 mock 缺 SESSION_ENGINE_OPTIONS 旧债（改 importActual 部分 mock）；后端 review_history 写入端点与 lib/tasks getTaskBoard 保留。
结果：4 个受影响测试文件 47 用例全绿、tsc --noEmit 0 错、eslint 零新增、docs check 824 处引用全过。

## ql-20260910-014-6c29 | 2026-09-10 19:03:51 | 变更中心展示 scope-audit 范围对账命令（变更详情页与快速修复抽屉各挂可复制命令卡，表格版+--json 版）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/sillyspec-manager.ts（SillySpecStatusChangeItem 可选 ql_id + _attachChangeQlIds 后处理）
- backend/app/modules/daemon/router/heartbeat.py（DaemonHeartbeatSillySpecChange 可选 ql_id）
- frontend/src/components/changes/scope-audit-command-card.tsx（新组件，命令前缀单一取值点）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx（右辅侧栏尾挂载（与并行会话删卡改动同文件，行不重叠））
- frontend/src/components/changes/quicklog-drawer.tsx（结构化视图底部挂载）
- backend/openapi.json（gen:types 重导出（含追平此前已提交后端改动））
需求：变更中心展示 scope-audit 范围对账命令（变更详情页与快速修复抽屉各挂可复制命令卡，表格版+--json 版）
根因：sillyspec 工具新增 scope-audit 命令（对账计划改动×实际改动），用户要求在变更中心可复制执行；快速修复条目平台侧只有 ql_id 而 scope-audit 只认 quick-<8hex> 会话名，缺一条 daemon→前端映射链
方案：daemon 心跳 sillyspec_status.changes[] 对 quick-* 名 best-effort 读 guard.json 补可选 ql_id（镜像 pending_conflicts 同款先例）+ backend 心跳 DTO 宽松可选字段透传 + gen:types 三端同步；前端新组件 scope-audit-command-card（前缀单一取值点 node src/index.js，工具发版后改 sillyspec 只动一处），变更详情页代入 change_key、快速修复抽屉经机器快照按 ql_id 反查会话名（查不到回退占位符+手动替换提示）
结果：daemon vitest 两套件 50 passed + tsc 0；backend pytest 39 passed + ruff 0；前端组件 6 + drawer 5 + 变更中心 6 相关套件 97 passed、tsc 0、eslint 定向 0 告警；docs check 无新增；未部署（daemon 升级+后端重启后生效）

## ql-20260910-014-0a5d | 2026-09-10 20:52:00 | MCP 资产库 verify NOTES ②③ 两项优化——cipher 懒加载 + daemon 端点 503 补结构化日志（mcp-central-registry 归档后收尾，用户 AskUserQuestion 裁决"现在做"）
状态：已完成（分支 sillyspec/2026-09-10-mcp-central-registry 提交 83932255e，待随分支 ff 合并）
关联变更：2026-09-10-mcp-central-registry（archive）
文件：
- backend/app/modules/mcp_registry/service.py（__init__ 饿汉 cipher → 懒 property：纯读路径 list/detail 不再被 master key 配置扣死——畸形 key 时列表 503 的根因，集成实测发现；显式注入 cipher 的测试路径不受影响）
- backend/app/modules/daemon/router/daemon_rpc.py（渲染 503 except 补 log.warning daemon_mcp_render_failed：error_type/摘要 200 截断/user_id/workspace_id——原异常细节只进 HTTPException from 链，排障只能复现；补 get_logger 导入）
验证：backend 176 passed（mcp_registry 153 + daemon mcp 端点 23）+ ruff/mypy clean
备注：master key v2 重生成同窗口执行（backend/.env，用户裁决；dev 库 9 行 llm_provider 旧 v1 密文需重录）

## ql-20260910-015-8e1b | 2026-09-10 22:30:53 | 用量上限类报错前端升级分类，Cursor usage limit 失败卡不再显「运行失败 · unknown」
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/agent-log/normalize.ts（buildErrorLogItem 增 isUsageLimitRaw + unknown 升级 quota_exceeded 分支）
- frontend/src/components/agent-log/__tests__/normalize.test.ts（ql-20260910-015 describe +4 用例）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引加 ql-20260910-015 条目）
需求：用量上限类报错前端升级分类，Cursor usage limit 失败卡不再显「运行失败 · unknown」
根因：daemon 分类器非 claude 引擎一律兜底 unknown（D-001 扩展点未覆盖 cursor/codex），claude 规则 quota 判定又被 has429 前置——Cursor 的 usage limit 报错无 429 两条路都认不出，页面只剩兜底文案（生产实例会话 7fb5022f）
方案：normalize.ts buildErrorLogItem 增 isUsageLimitRaw 特征识别（usage limit / insufficient[_ ]quota / exceeded your current quota / 中文额度·使用上限），type 未识别（unknown）且 raw 命中时升 quota_exceeded + 中文 message「供应商额度或用量已达上限」+ 切换/升级套餐 hint，raw 原样保留供查看详情；历史已落库 run 不改数据即修好显示（三消费点 turn-timeline/session-panel page/dialog 都走该函数）；后端已明确分类的不覆盖。照 isCliAuthTransient（ql-20260903-011）同款先例
结果：normalize.test.ts +4 用例共 91 全绿；下游 session-panel-dialog + turn-timeline-auto-resume-badge + run-error-item 102 用例绿；tsc 我方 0 错误（scope-audit-command-card 2 个为并行会话在途预存）；未部署，需重新打包前端镜像后生效

## ql-20260910-016-e8e0 | 2026-09-10 22:43:49 | user_input 日志行 5000 截断放宽到 50000 单一常量，会话页长输入不再截断
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/model.py（USER_INPUT_LOG_MAX_CHARS 常量定义）
- backend/app/modules/daemon/session/service/create.py（首 turn 写点）
- backend/app/modules/daemon/session/service/inject.py（后续 turn 写点）
- backend/app/modules/daemon/session/service/control.py（活跃 run 中途注入写点）
- backend/app/modules/daemon/session/service/ppm_activation.py（PPM 激活写点）
- backend/app/modules/daemon/group/service/messages.py（群聊消息写点）
- backend/app/modules/daemon/group/service/shadow.py（群聊影子首句写点）
- backend/app/modules/agent/worker_redispatch.py（worker 重派写点）
- backend/app/modules/agent/mcp_tools.py（MCP 工具建会话写点）
- backend/app/modules/spec_workspace/bootstrap.py（scan step_prompt 写点）
- backend/app/modules/daemon/session/service/auto_resume.py（G5 截断检测改引单一源）
- backend/app/modules/daemon/tests/test_session_user_log.py（截断断言 5000→常量）
- backend/app/modules/daemon/tests/test_session_recovery.py（G5 反例夹具随口径）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引加 ql-20260910-016 条目）
需求：user_input 日志行 5000 截断放宽到 50000 单一常量，会话页长输入不再截断
根因：后端 9 个写点硬编码 content[:5000] 落 AgentRunLog(channel=user_input)，长输入的展示与「重新发送」都吃截断副本（生产库多条 user_input 行 len=5000 实证）；agent 实收的 SESSION_INJECT prompt 本就是全文，纯展示层截断
方案：agent/model.py 新增 USER_INPUT_LOG_MAX_CHARS=50_000 单一取值源（模型层无服务依赖不成环），9 写点统一引用；auto_resume 截断检测常量改别名同值；对齐 run_sync submit 50k 既有口径，DB 列 Text 无上限；两处测试断言随口径适配
结果：test_session_user_log + test_session_recovery + test_auto_resume_integration 34 passed；group_direct/group_mention_pipeline/mcp_tools/bootstrap_provider_model 115 passed；worker 派发 14 passed；ruff 全过 mypy 0 issue；未部署，需重发后端镜像生效

## ql-20260910-017-2006 | 2026-09-10 22:49:24 | 变更中心点击具体文件展示内容变化比对（红绿高亮弹窗，参考冲突比对弹窗视觉；快速修复抽屉与变更文件树两入口）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/sillyspec-manager.ts（fileDiff 方法 + Outcome 可选 stderr + 256KB 护栏）
- sillyhub-daemon/src/daemon.ts（sillyspec_file_diff RPC 注册）
- backend/app/modules/change/scope_audit.py（新 service（git_log 范式））
- backend/app/modules/change/router.py（/sillyspec/file-diff 端点）
- frontend/src/components/changes/scope-file-diff-modal.tsx（新弹窗（复用 parseUnifiedDiff））
- frontend/src/components/changes/scope-audit-command-card.tsx（useQuickSessionName 抽出共用）
- frontend/src/components/changes/quicklog-drawer.tsx（文件行点击入口）
- frontend/src/components/change-file-tree.tsx（变化比对按钮（changeKey 可选 prop））
需求：变更中心点击具体文件展示内容变化比对（红绿高亮弹窗，参考冲突比对弹窗视觉；快速修复抽屉与变更文件树两入口）
根因：scope-audit --file 已能在本地看单文件 diff，但平台侧无入口——用户要求在查看变化时可直接点击文件比对；锚点解析逻辑在工具（quick=HEAD 窗口/归档=快照基点），平台三端需一条 daemon RPC + 工作区级端点 + 弹窗的透传链
方案：daemon 新 sillyspec_file_diff RPC：spawn 本机 sillyspec 跑 scope-audit --change --file --json（锚点同源零自研，256KB 截断，未知命令→能力缺失错误码；Outcome 补可选 stderr 支撑能力检测）；backend change 模块 scope_audit.py service（git_log 范式绑定解析+RPC 转发+AppError 错误族）+ GET /workspaces/{ws}/sillyspec/file-diff（避开 /changes/{uuid} 段匹配坑）；前端新 scope-file-diff-modal（复用 git-log parseUnifiedDiff 红绿行渲染，note 态/422 升级引导/重试态分型）+ useQuickSessionName 抽出共用，抽屉文件行与变更文件树「变化比对」按钮两入口
结果：daemon 4 套件 122 passed + tsc 0；backend 7 passed + mypy 0 + ruff 0；前端弹窗 5 + 抽屉 7 + 变更中心 14 套件 164 passed、tsc 0、eslint 零新增；gen:types 三端重生成；docs check 无新增；未部署（daemon 升级 + sillyspec 新版发布后端到端可用，版本门弹窗有分型引导）
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/src/api-types.ts

## ql-20260910-018-d305 | 2026-09-10 23:13:27 | get_daemon_status 暴露 worker 执行器配额池标识，review-dispatch 消费方派发前预判独立兜底是否成立（P0-2 增补…
状态：已完成
关联变更：2026-09-10-review-dispatch-platform-fixes
文件：
- backend/app/modules/mcp_gateway/tools.py（quota_pool 探测+docstring 口径）
- backend/app/modules/mcp_gateway/tests/test_tools_new.py（3 新用例+_make_llm_provider fixture）
- .sillyspec/docs/backend/modules/mcp_gateway.md（13 tool 校正+quota_pool 行）
需求：get_daemon_status 暴露 worker 执行器配额池标识，review-dispatch 消费方派发前预判独立兜底是否成立（P0-2 增补，关联 2026-09-10-review-dispatch-platform-fixes）。
根因：该 tool 此前只有执行器（effective_agent）与在线性，无凭证池归属信息——worker 实际落在哪个配额池（独立 key 还是 daemon 本机凭证同池）派发前不可判，P0-2 的「本地耗尽平台兜底」价值无法预验证。
方案：per-daemon quota_pool = binding 属主在 effective agent_kind 下的用户默认 LlmProvider 身份（claim 三级解析第三级；五键 {llm_provider_id,name,agent_kind,api_format,is_default}，不 decrypt 不出 key 材料）+ 顶层 effective_quota_pool 镜像首个 online 项；一条批量 in 查询不进循环；effective_agent 为 None 不查池。
结果：test_tools_new.py 24 passed（3 新用例覆盖池命中/kind 过滤/跨属主映射、非默认行不构成池、无执行器不查池），ruff check+format 过；模块卡同步（13 个 tool 校正 + quota_pool 口径）；待部署远端后消费方即可预判。

## ql-20260911-001-c0be | 2026-09-11 08:28:41 | scope-audit 命令卡升级为结果卡——对账结果（三态表+行数）在页面内直接跑出来渲染，不再只展示可复制命令
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/sillyspec-manager.ts（auditTable + _runScopeAuditJson 共享执行器）
- sillyhub-daemon/src/daemon.ts（sillyspec_scope_audit RPC）
- backend/app/modules/change/scope_audit.py（_send_scope_rpc 共享 helper + get_scope_audit）
- backend/app/modules/change/router.py（/sillyspec/scope-audit 端点）
- frontend/src/components/changes/scope-audit-command-card.tsx（结果卡重构（摘要+明细弹窗+行联动 diff+命令折叠））
- frontend/src/lib/changes.ts（getScopeAudit 取数）
需求：scope-audit 命令卡升级为结果卡——对账结果（三态表+行数）在页面内直接跑出来渲染，不再只展示可复制命令
根因：用户反馈命令卡只是展示命令不够——命令不是目的，看对账结果才是；daemon→backend→前端透传链已由单文件比对（ql-20260910-017-2006）建好，缺表模式一跳与结果渲染
方案：daemon 新 sillyspec_scope_audit RPC（auditTable 方法跑 CLI 表模式 --json，信封投影：锚点短化/rows 500 护栏/totals 透传；执行器抽 _runScopeAuditJson 与 fileDiff 共享）+ backend 同族端点 GET /sillyspec/scope-audit（_send_scope_rpc 错误族抽共享 helper）+ 前端命令卡重构：挂载即取数出锚点+合计+三态计数 chips（full-flow verdict / quick attribution），查看明细弹窗渲染三态全表且行点击联动单文件 diff 弹窗，本地命令折叠为卡尾兜底
结果：daemon 12 用例+回归 76 passed、tsc 0；backend 9 passed、mypy/ruff 0；前端卡 7 用例重写+变更中心 21 套件 237 passed、tsc 0、eslint 0；gen:types 三端重生成；docs check 无新增；未部署（daemon 升级+sillyspec 新版后端到端可用，降级态有命令兜底）
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, sillyhub-daemon/src/api-types.ts

## ql-20260911-002-4755 | 2026-09-11 08:51:11 | external 模式（orchestration_mode=external…
状态：已完成
关联变更：2026-09-10-review-dispatch-platform-fixes
文件：
- backend/app/modules/agent/model.py（resolve 回退 _mission_from_session_runs）
- backend/app/modules/agent/mcp_tools.py（_worker_done_core external 成员资格）
- backend/app/modules/agent/tests/test_worker_subsession_done.py（TestExternalModeWorkerDone 三例）
- .sillyspec/docs/backend/modules/agent.md（external 打通条目）
需求：external 模式（orchestration_mode=external，review-dispatch 经 MCP gateway 派发）worker 的 artifacts 恒空——daemon 代报 worker_done 被 404。
根因：resolve_mission_for_session 沿 parent 链爬根（external worker parent=NULL 爬到自身）按 mission.session_id 匹配（external=NULL）必 miss；mission_worker_sessions_tree 对 external 恒 [] 会再 422。活体证据：backend 日志 POST /api/missions/worker_done 404 + lease metadata 已有 stage=mission_worker（①②③全非断点：stage 打标正常、caps.mcp=false 代报路径已走、pi override 提取正常 output_redacted=503 字符）。
方案：resolve 爬根 miss 后按 run 归属回退（会话下最早带 mission_id 的 run 反查 mission，active/terminal 双形态）；_worker_done_core 成员资格对 external 以首 run 锚代替空树（session 模式树 422 判定序原样）。
结果：test_worker_subsession_done.py 23 passed（external 三例：200+artifact+零唤醒/终态 409/无归属 404），广域 550 passed，ruff/mypy 过；daemon 侧零改动（代报本就工作）。
