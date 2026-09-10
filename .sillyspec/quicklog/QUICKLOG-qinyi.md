
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
