
## ql-20260902-013-0571 | 2026-09-02 15:24:19 | 影子会话直接复用 SessionPanel 本体（dialog 模式内嵌 Drawer/全屏）+usage 端点放行群主读影子+直聊改走标准 inject 端点（后端把直聊头/GROUP标记逻辑下沉注入前置），实现与正常会话像素级一致（输入…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260902-014-953e | 2026-09-02 17:10:48 | 内嵌会话版式统一 page 分支：影子会话 Drawer 与分身浮层切 SessionPanel mode=page（与 /sessions 全页完全同构——头部工具栏/搜索/加载更早/视图切换/用量条），machines/llmProvi…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260902-015-41d9 | 2026-09-02 18:18:40 | 群聊 agent 运行态可见：①后端——影子 run 开始发 typing:true，run 终态（close_interactive_run 群分支）发 typing:false 止息（payload 加 member_name/kind…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260902-016-3a75 | 2026-09-02 18:39:22 | CI 修复：variant 回归锚跟上 contents 挂载层 + 后端 4 文件 ruff 格式
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx（两处回归锚更新到 contents 挂载层新 DOM）
- backend/app/modules/agent/execution.py（ruff 纯格式）
- backend/app/modules/agent/finalizer.py（ruff 纯格式）
- backend/app/modules/agent/tests/test_dispatch_worker_worktree.py（ruff 纯格式）
- backend/app/modules/daemon/tests/test_session_review_fixes.py（ruff 纯格式）
- .sillyspec/docs/SillyHub/modules/frontend_components.md（变更索引登记 ql-20260902-016-3a75）
需求：CI 修复：variant 回归锚跟上 contents 挂载层 + 后端 4 文件 ruff 格式
根因：065aa3532（ql-20260902-009）给会话主体有意包 display:contents 挂载点做触顶自动加载滚动监听，session-panel-variant.test.tsx 回归锚未同步（desktop 仍断 scroll.parentElement===panel、mobile 仍断外包层=scroll 父级）致 frontend-ci 连挂 4 次；backend 侧 4 文件提交时未跑 ruff format 致 backend-ci 自 09-01 晚连挂 9 次（非测试逻辑有误，锚与格式态过时）
方案：前端锚更新：desktop 改断挂载点 className==='contents' 且直挂面板根；mobile 改断挂载点父级为横向外包层（min-h-0 flex-1 + 表格横滚锁类仍全在）；后端 uv run ruff format 4 文件（纯格式变更）
结果：session-panel-variant 7/7 通过 + pnpm typecheck 0 错；后端 format --check 全仓 1110 clean + ruff check 通过 + 涉及两测试文件 31 passed
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/openapi.json, frontend/src/lib/api-types.ts

## ql-20260902-017-df5e | 2026-09-02 19:17:02 | 群聊注入体验三修：①注入分离展示——群触发 user_input 行 metadata 加 user_message（真实用户消息原文），SessionPanel/群面板用户气泡优先显示 user_message、简报/群背景折叠为『已注入…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260902-018-7203 | 2026-09-02 19:32:56 | backend-ci 两过时测试断言补同步（孙逐级回叫/影子详情读放行）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/tests/test_subsession_recursion_dispatch.py（grandchild pending 用例断言补同步逐级回叫）
- backend/app/modules/daemon/tests/test_group_logs_pagination.py（影子只读用例更名+详情断言改 200）
需求：backend-ci 两过时测试断言补同步（孙逐级回叫/影子详情读放行）
根因：两用例滞后于有意行为变更（非实现回归）：04d8be3e（quick-33956fb8）引入孙完成逐级回叫直接父，grandchild pending 用例仍断 injected==[]；8dcc562f4（quick-d4a8140d）放行影子详情读（allow_shadow_member_read=True，防成员卡 SessionPanel 详情轮询 404 误报恢复失败），shadow 只读用例仍断详情 404——此前被 ruff format 失败挡在 Pytest 步骤之前从未跑到
方案：① test_grandchild_worker_done_keeps_mission_busy_when_worker_pending 断注入恰一次且目标是分身（worker.id）+ 唤醒文案标记 + 主控不在注入列表；② shadow 只读用例更名 test_member_shadow_readonly_detail_ok_inject_blocked，详情断 200（含 body id 校验），inject 写路径仍断 404（for_update 分支不放行，service.py:6802 已核实）
结果：两测试文件 27/27 通过；ruff format --check + ruff check 两文件全过
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档

## ql-20260902-019-3023 | 2026-09-02 20:04:00 | 群聊 @补全连续选择：选中一个成员后自动追加 @ 并保持浮层打开（可连续点选多人），Esc/直接打字自然退出连续选择
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260902-020-ede6 | 2026-09-02 20:27:25 | 群聊两宿主接入：①移动端 m/workspaces/[id]/sessions 群聊能力（列表群聊分区+点开群聊面板 variant=mobile+建群向导）②悬浮会话弹窗（floating-session-host）群聊入口（列表分区+选…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260902-021-ea89 | 2026-09-02 20:49:06 | 群聊 URL 深链+样式对齐：①?session=<群id> 双向同步（深链验证按 session_kind=group 分流群选中；选中群/建群写参；切走清参）②群面板头部对齐会话工具栏（#id 短码+复制+群内搜索 q 浮层，复用后端 …
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260902-022-1ac4 | 2026-09-02 21:15:27 | 群聊运行徽标实时性+URL 深链+头部工具栏（合并收口）
状态：进行中
关联变更：2026-09-02-changes-overview-card
文件：（见实际改动）

## ql-20260902-023-6da2 | 2026-09-02 23:06:37 | 手机端群聊样式（成员栏改顶栏按钮抽屉，对话区优先）+本地 Agent 会话信息折叠收口（tool_report 激活后 CLI 上报轮收进顶部小按钮）
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260903-001-f2a2 | 2026-09-03 06:15:26 | 群聊 P1 五项：①群内打断成员端点+按钮（全员可用，design §8 member.interrupted 落地）②[[GROUP]] 忘标记兑底升级（投影回复首段摘要替代模板行）③建群 agent 成员 llm_provider 预检…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260903-002-cef1 | 2026-09-03 06:16:26 | 修复24h审计3高危3中危：worktree RPC超时跨层错配/孙分身重开工二波唤醒挡死/翻页伪runId撞React key/影子直聊隐私文案过诺/群时间线…
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/mcp_tools.py, backend/app/modules/agent/mission_context.py, backend/app/modules/agent/tests/test_worker_subsession_done.py, backend/app/modules/daemon/group/service.py, backend/app/modules/daemon/host_fs/delegate.py, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/session-panel.tsx, frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx, frontend/src/components/group-chat/group-chat-panel.tsx
需求：修复24h审计3高危3中危：worktree RPC超时跨层错配/孙分身重开工二波唤醒挡死/翻页伪runId撞React key/影子直聊隐私文案过诺/群时间线他人发言拽底/SSE增量写进更早块
根因：①daemon侧git上限提到120s但后端RPC仍30s默认，30-120s检出窗口后端先放弃且掩盖真实报错+收残竞态；②嵌套回叫幂等键是常量1纯SETNX无波次语义，孙重开工第二波被挡6h只能等patrol强收（声称根治的死锁在受支持流程复发）且调用点未按docstring声明做is_new_signal门控；③logsToTurns每次调用伪id从1重编号，prepend只给同run轮加后缀，多run更早页与当前窗口撞key；④直聊头承诺只在会话内可见，但影子会话日志/详情对全体群成员放行（有测试锁定、群定位协作群），文案与行为冲突；⑤own-send判定未过滤isSelf，群时间线他人发言触发强制回底拽走上滚视口；⑥upsertTurn对realRunId首中数组头部prepend的更早段块，运行中长run翻页后流式输出写进历史块
方案：①delegate._via_rpc_or_degrade补timeout透传，worktree add/merge/remove显式传_WORKTREE_RPC_TIMEOUT_SECONDS=150s（>daemon 120s）；②notify_parent_workers_done改F04同款时间戳波次（键值=本波done_at，SETNX失败新波严格大于才覆盖重投）+mcp_tools调用点hoist is_new_signal双消费方共用并传signal_at；③prepend每页伪runId全量加#e<全量数字游标>后缀（秒级短码改全量防同秒撞）；④直聊头如实表述不投影群时间线+群成员可查会话（保留测试断言短语）；⑤own-send判定补e.isSelf过滤+首帧分支播种own-send基线（修测试暴露的回放旧own消息误判）；⑥realRunId命中改从数组尾部反向取最末块，实时增量落当前尾部块
结果：后端：test_worker_subsession_done 20 passed（含新增孙重开工二波再唤醒用例）、test_group_direct+test_dispatch_worker_caller_worktree 24、test_group_logs_pagination 14、test_subsession_recursion_dispatch 13，ruff check+format 0；前端：page.test 28（新增多run翻页不撞key+长run翻页SSE增量落末块两用例）、group-chat-panel 29（新增他人发言不拽底用例）、variant+turn-timeline-scroll+runtime-session-helpers 34，tsc 0、eslint 0错误；模块文档4处同步；另登记docs/sillyspec/2026-09-03-quicksync-conflict-granularity.md（spec-sync整树冲突粒度活坑）
审计：⚖️ 归属切分：7 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/group/router.py, backend/app/modules/daemon/run_sync/service.py, backend/app/modules/daemon/tests/test_group_direct.py, backend/openapi.json, frontend/src/lib/api-types.ts, backend/app/modules/daemon/tests/test_group_p1.py, docs/sillyspec/2026-09-03-quicksync-conflict-granularity.md

## ql-20260903-003-1fdd | 2026-09-03 07:20:55 | 群聊 P2 第一波六项：①@全体二次确认（显示将触发 N 个成员）②typing 草稿预览默认关闭（改只显示正在输入，群设置可开）③置顶消息/群公告 ④会话闸满/触发失败群内系统提示 ⑤附件部分失败逐成员重发入口 ⑥『最近@我』扫描窗口扩至…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260903-004-14a4 | 2026-09-03 08:02:45 | 群聊 P2 第二波三项：①@全体并行触发（独立 session 工厂消除顺序等待）②消息引用回复（reply_to_log_id：发送可选引用+气泡渲染引用条）③未读分隔线（服务端 last_read位点+前端『以下为未读』）
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260903-005-cf45 | 2026-09-03 09:18:08 | 影子会话系统注入刷屏修复：直聊头 preamble 化（对话视图只见真实消息）+GROUP_CHAIN 标记行前端剥离+[后台任务通知] 整条折叠
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260903-006-1558 | 2026-09-03 09:42:24 | 修复变更文件 .md 预览崩溃：remarkChangeLink transformer 双层包装摧毁 mdast 树
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/change-autolink.ts（remarkChangeLink 单层 transformer + 契约注释）
- frontend/src/lib/change-autolink.test.ts（run 辅助修正 + toBeUndefined 契约守护）
需求：修复变更文件 .md 预览崩溃：remarkChangeLink transformer 双层包装摧毁 mdast 树
根因：插件返回 () => (tree) => {...} 双层箭头，违反 unified 契约（Plugin(options) 应直接返回 transformer）：unified 把外层箭头当 transformer 调用，其返回的内层函数被当成替换树，整棵 mdast 树被换成函数，react-markdown visit 读 undefined.type 抛 TypeError；旧测试用三层调用凑对错误实现未拦住
方案：change-autolink.ts 去掉双层包装直接返回单层 transformer 并注释记录契约与事故；测试 run 辅助改为 transformer(tree) 单次调用并加返回值必须 undefined 的契约守护断言
结果：change-autolink.test.ts 8/8 绿（修复前新契约断言红 3 例）；@uiw 完整管线端到端复现验证：修复前 module-impact.md 塌成空 div，修复后完整渲染 2195 字符 HTML 且变更名正确生成链接；两文件已 git add
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档

## ql-20260903-007-dc97 | 2026-09-03 09:48:38 | 24h审计4低危修复——群未读时钟域/排队链标记sender/host-fs超时杀树/presence续期独立任务
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/group-unread.ts（markGroupOpened服务端锚+头注时钟域说明）
- frontend/src/components/group-chat/group-chat-panel.tsx（回放lastTs/实时env.timestamp两写锚点，挂载撤客户端now）
- backend/app/modules/daemon/session/service.py（链标记sender段写入+正则+还原+派发注释对齐）
- backend/app/modules/agent/service.py（presence内联首触+独立续期任务+finally cancel）
- sillyhub-daemon/src/host-fs-handler.ts（killTree+runCmd超时检出杀树+timed out标记行）
- sillyhub-daemon/tests/host-fs-handler-runcmd-kill.test.ts（新增KT1/KT2杀树与误触发两用例）
需求：24h审计4低危修复——群未读时钟域/排队链标记sender/host-fs超时杀树/presence续期独立任务
根因：①已读锚写客户端时钟与last_mention服务端ts跨时钟域比较（浏览器快Δ秒吞红点不可恢复）；②排队链标记正则无sender捕获组而派发侧读sender_user_id恒None，普通成员排队附件404转失败（注释与实现不一致）；③execFile超时只杀直接子进程，git hook/filter孙进程残留继续写目录，且rev-parse的git_timeout映射对真实超时恒不命中；④presence触摸被get_message 25s量化（实际间隔~50s余量10s非注释15s）且生成器卡yield背压时touch停摆绿点被TTL误回收。低危②KEYS→SCAN已被并发会话修复跳过
方案：①markGroupOpened(serverIso)服务端锚优先：回放maxLogTimestamp+onLog env.timestamp两写锚点，空群不写锚，挂载不再写客户端now；②_prepend按turn_metadata.sender_user_id追加sender=<uuid>段（uuid校验防脏）+_split正则还原，旧格式条目零变化；③runCmd超时特征（err.killed+signal=SIGTERM）检出→killTree（win32 taskkill /PID /T /F；Unix仅SIGKILL直子——execFile未detached，kill(-pid)会自杀daemon进程组）+stderr追加timed out标记行；④presence连接内联首触（保测试确定性）+独立asyncio任务45s续期+finally cancel，与SSE产出节奏完全解耦
结果：后端：test_group_cross_mention+test_group_realtime 45 passed（新增sender roundtrip/集成sender断言/背压存活用例，节流测试改轮询）、mention_pipeline+group_direct相邻54 passed、ruff check+format 0；前端：group-chat-panel 47（重写挂载即写为服务端锚语义）、session-list-panel 71、mobile-session-list 17、tsc 0；daemon：host-fs-handler-runcmd-kill新2用例+worktree回归21 passed、typecheck 0。模块文档4处同步（sillyhub-daemon host-fs-handler/backend daemon×2/SillyHub frontend_lib）
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/file/router.py, backend/app/modules/file/tests/test_file_api.py, frontend/src/lib/__tests__/query-client.test.ts, frontend/src/lib/query-client.ts

## ql-20260903-008-3c76 | 2026-09-03 10:25:47 | 群聊成员面板高度对齐聊天区——根节点补 h-full 超出内部滚动
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/group-chat/member-panel.tsx（根 aside 补 h-full+高度契约注释）
- frontend/src/components/group-chat/group-chat-panel.tsx（右列加载/错误占位 aside 补 h-full）
需求：群聊成员面板高度对齐聊天区——根节点补 h-full 超出内部滚动
根因：MemberPanel 根 aside 高度 auto，挂载包装层是 block 容器未把 grid 拉伸的列高传下去，成员多时被内容撑高超出聊天区且 overflow-y-auto 永不触发
方案：member-panel.tsx MemberPanel 根 aside 补 h-full（宽屏右列 grid 拉伸项/窄屏 Drawer body 均定高，session-list-panel 根 h-full 同惯例），超出走根节点既有 overflow-y-auto；group-chat-panel.tsx 右列加载/错误占位 aside 同步补 h-full；frontend.changelog.md 追加 ql-20260903-008-3c76 条目
结果：群聊两组件 89 用例全绿（member-panel 42 + group-chat-panel 47），tsc --noEmit 0 错误；纯样式修复未动逻辑

## ql-20260903-009-e4a2 | 2026-09-03 10:55:00 | 群聊卡「加载中」永不退出修复——GET默认超时+网络错误可重试+失败态重试入口+头像缓存
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/api.ts（apiFetch 读请求 GET/HEAD 缺省 30s 超时；写请求仍需显式 timeoutMs）
- frontend/src/lib/query-client.ts（retry 策略纳入 status=0 网络错误/超时，最多 3 次）
- frontend/src/components/group-chat/group-chat-panel.tsx（群详情 isError 失败态：右列/时间线空态/手机抽屉三处重试入口，替换假文案「稍后自动重试」）
- backend/app/modules/file/router.py（inline 图片响应补 Cache-Control: private, max-age=86400）
- frontend/src/lib/__tests__/api.test.ts + query-client.test.ts（默认超时/网络错误重试用例改写）
- backend/app/modules/file/tests/test_file_api.py（inline 缓存头/attachment 不加两断言）
需求：用户实测：点击群聊后「群消息加载中…群成员加载中…」一直卡住不退出
根因：三层叠加——①docker 重建窗口（backend 应用启动需~2分钟）期间前端代理连接挂起（无响应也无网络错误），查询 isLoading 恒真且 AbortController 无超时永不触发；②ECONNREFUSED 形态下 ApiError(status=0) 被 retry 策略（仅 status>=500）一次拒绝永不重试；③群详情失败态只有假文案「稍后自动重试」无任何恢复入口（refetchOnWindowFocus 需切浏览器窗口才触发）。浏览器全链路实测复现：停 backend 打开群聊页永久挂「加载中」，恢复 backend 后旧实例也不自愈
方案：①apiFetch 读请求缺省 30s 超时（ql-20260831-006 的 timeoutMs 能力推广到 GET/HEAD；写操作防慢写误杀重发仍需显式传）——挂起有界化，4 次尝试（1+3 重试）×30s≈2 分钟自动自愈窗口正好覆盖典型部署重启；②retry 谓词加 status===0——超时/网络错误进入指数退避重试，backend 恢复后下一次尝试即自愈；③GroupChatPanel 三处失败态（右列成员面板/时间线空态/手机抽屉）补「点击重试」按钮调 detailQ.refetch()；④顺手修头像刷屏：inline 图片加私有缓存一天（file_id 内容寻址不可变，安全；实测单次打开群聊重复拉同一头像数十次）
结果：前端 api 9+query-client 6+group-chat-panel 47+sessions-portal 39 全绿 tsc 0；后端 file 38 passed（venv）ruff 0。Docker 重建后浏览器故障演练全链路验证：停 backend→群聊页进入有界重试（「加载中」最多~2分钟）→超窗转「加载群聊失败：请求超时，请重试」+重新加载按钮（修复前永久卡加载中）→恢复 backend 后自动自愈实测逮到（群列表自动出现）→深链重开群聊面板完整装配（时间线+成员+历史消息+0加载中）；curl 验证头像响应带 cache-control: private, max-age=86400
审计：✅ 无新欠账。并行会话协同：与 ql-20260903-008-3c76（成员面板 h-full）同文件不同区域共存无冲突，本提交捎带其对 group-chat-panel.tsx 的一行 h-full（member-panel.tsx 主体与 changelog 留其自行提交）

## ql-20260903-010-f11d | 2026-09-03 11:03:41 | 群聊页面优化——时间线行 memo 化+回放分页+回到底部悬浮按钮
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/group-chat/group-chat-panel.tsx（行 memo 化+回放分页+回底悬浮按钮）
- frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx（harness 动态 logs 响应器+分页/回底 4 新用例）
- .sillyspec/docs/SillyHub/modules/frontend_components.md（group-chat-panel 条目补群 P3 quick 说明）
- .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md（ql 变更索引条目）
需求：群聊页面优化——时间线行 memo 化+回放分页+回到底部悬浮按钮
根因：流式输出时每个 token 触发全时间线重渲染且行组件无 memo；挂载回放全量拉回历史；上滚读历史后无回底入口、离开期间新消息无任何提示
方案：GroupTimelineRow memo 化+props 全稳定（NO_REPLYING 常量/handlePin/handleQuoteReply useCallback）；初始回放 limit 200，顶部「加载更早消息」按 before 游标翻页（applyGroupTimelineEvent 归并+scrollTop 增量视口保持）；回到底部悬浮按钮+离开期间新消息计数
结果：group-chat 目录 93 用例全过（新增 4：分页入口/翻页游标/失败重试/回底按钮全链路）；tsc --noEmit 零错误；两文件 lint 无新增告警；模块文档 frontend_components.md+frontend.changelog.md 已同步

## ql-20260903-011-1b58 | 2026-09-03 14:56:33 | CLI 鉴权瞬时失败自动重投加前端中文错误卡片（远端 401 误报 Not logged in 修复）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/run_sync/service.py（自动重投 helper 加 close 挂接加签名正则）
- backend/app/modules/daemon/tests/test_auth_transient_autoretry.py（5 用例钉死入队与防循环与不误伤）
- frontend/src/components/agent-log/normalize.ts（签名识别与错误卡片升级）
- frontend/src/components/agent-log/__tests__/normalize.test.ts（补 4 用例）
- docs/sillyspec/2026-09-03-cli-401-misreported-as-not-logged-in.md（根证与缓解与排查教训）
- .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md（变更索引）
- .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md（变更索引）
需求：CLI 鉴权瞬时失败自动重投加前端中文错误卡片（远端 401 误报 Not logged in 修复）
根因：claude CLI 把模型网关 401 统一合成 Not logged in Please run login 误导文案注入对话且 retryable 为 false，用户只能手动重发；实证 2026-09-03 会话 cb56fabf 同一进程同密钥 13 秒后重发即成功，纯远端瞬时抖动，与部署与供应商配置无关
方案：一 后端 run_sync close_interactive_run 终态 commit 后挂 maybe_autoretry_auth_transient_turn，error.raw 命中 CLI 鉴权签名且会话仍 active 时把本 run 的 user_input 追加为排队消息，携带 run 的 llm_provider_id 与 agent_profile_id 快照和 sender 归属，由 close 末尾既有排队派发钩子随即重放一次，双保险防循环，上一条同会话同 prompt run 亦鉴权失败则跳过，外加同文 pending 去重，全程静默容错；二 前端 normalize 的 isAssistantApiErrorText 增识 CLI 鉴权签名使合成错误行归 error 类不再当 agent 回复文本渲染，buildErrorLogItem 升级为 auth_failed 加 retryable 加中文文案；三 坑记录落 docs sillyspec
结果：后端新增 test_auth_transient_autoretry 5 用例加 close 既有 7 用例回归共 12 绿，ruff check 与 format 0；前端 normalize 套件补 4 用例共 67 绿，tsc 0，eslint 0 error 仅 1 预存 warning；backend 与 frontend changelog 两处同步
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/agent-log/__tests__/normalize.test.ts, frontend/src/components/agent-log/normalize.ts

## ql-20260903-012-7976 | 2026-09-03 18:08:06 | 会话/群聊错误提示出口统一修复（英文报错中文化 + 附件截断告知）
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/api.ts（非 JSON 错误体中文兜底（502/503/504 专用文案 + 请求失败（HTTP N）））
- frontend/src/components/daemon/session-panel.tsx（11 处 ApiError.message 直出改 errMessage（含顺带发现的首句创建会话 2 处同类））
- frontend/src/components/group-chat/group-chat-panel.tsx（搜索失败 notify.error 两参形态 + 附件截断 warning + 上传失败 errMessage + 注释修正）
- frontend/src/components/group-chat/group-member-avatar.tsx（固定文案 notify.error(字符串) 改 notify.warning）
- frontend/src/components/daemon/session-input-bar.tsx（接入 useNotify/errMessage + 截断 warning + 上传失败 errMessage）
- frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx（新建 2 用例（截断告知 + 网络错误中文兜底））
- frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx（mock errMessage 改真实现 + 新增 2 用例）
- frontend/src/lib/__tests__/api.test.ts（新增 3 用例）
- frontend/src/lib/errors.test.ts（新增字符串误传契约用例）
- .sillyspec/docs/frontend/modules/lib-api.md（错误体契约注记）
- .sillyspec/docs/frontend/modules/lib-errors.md（固定文案误传陷阱注记）
- docs/sillyspec/2026-09-03-spec-sync-conflict-no-accept-server-option.md（顺手记录 spec-sync 冲突工具缺陷）
需求：会话/群聊错误提示出口统一修复（英文报错中文化 + 附件截断告知）
根因：调用方绕过 lib/errors.ts 统一出口——session-panel 11 处直取 ApiError.message（断网时英文 Failed to fetch 直显红条）、群聊 2 处 notify.error 误传文案字符串（被 errMessage 吞成「操作失败」）、api.ts 非 JSON 错误体透传英文 statusText（Bad Gateway）、单聊/群聊附件超 10 个静默截断无提示
方案：session-panel 11 处与群聊附件上传失败改 errMessage(err, 中文fallback)；搜索失败改 notify.error(err, fallback) 两参、头像固定文案改 notify.warning(msg)；api.ts 新增 502/503/504 中文兜底与其余「请求失败（HTTP N）」；两输入条新增 MAX_ATTACHMENTS_PER_BATCH=10 截断 toast 告知，并修正群聊附件注释与实现不一致（toast→行内红字）
结果：5 个相关测试文件 102 用例全绿（新增 8 用例：输入条上传 2 + api 兜底 3 + errors 契约 1 + 群聊搜索/截断 2）；typecheck 0 错误；未部署
审计：⚖️ 归属切分：14 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/agent/model.py, backend/app/modules/agent/schema.py, backend/app/modules/daemon/group/router.py, backend/app/modules/daemon/group/service.py, backend/app/modules/daemon/tests/test_group_chat_management.py, backend/migrations/versions/20260903170000_add_group_chat_archived_at.py, frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx, frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/session-list-panel.tsx, frontend/src/components/sessions/sessions-portal.tsx, frontend/src/lib/__tests__/api.test.ts, frontend/src/lib/errors.test.ts, docs/sillyspec/2026-09-03-spec-sync-conflict-no-accept-server-option.md

## ql-20260903-013-b057 | 2026-09-03 18:44:33 | backend-ci 连续失败修复——worktree mock 缺 timeout + patrol 对照缺 token + 迁移测试撞名 flaky
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/host_fs/tests/test_delegate_worktree.py（_MockWsRpc.send_rpc 补 timeout 形参）
- backend/app/modules/daemon/tests/test_worker_redispatch.py（_make_run 补 resume_token + 失败测试两 run 带 token）
- backend/tests/test_platform_deleted_hidden_migration.py（_load_migration 子串改精确前缀匹配）
- .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md（ql-20260903-013-b057 登记）
需求：backend-ci 连续失败修复——worktree mock 缺 timeout + patrol 对照缺 token + 迁移测试撞名 flaky
根因：6f92dc49d 给 worktree 三方法传 150s 超时但 mock 没跑没更新；6a2248ccc 引入 NULL resume_token 跳过守卫漏改旧对照测试；merge 迁移文件名 30f7418b14cf_merge_heads_20260829130000_.py 的 slug 嵌了父 revision 字符串，子串匹配按 os.listdir 顺序随机遮蔽真实迁移文件
方案：mock send_rpc 补 timeout 形参对齐协议并记入 calls；_make_run 工厂补 resume_token 形参且失败测试两 run 均带 token（中断排除只来自 error_code 过滤，保原始意图）；_load_migration 改精确前缀 f.startswith(revision_id_)。生产代码零改动
结果：worktree 10 + redispatch 26 + migration 15 用例全绿，ruff check/format 0，mypy 0 错；backend.changelog.md 登记 ql-20260903-013-b057

## ql-20260903-014-639e | 2026-09-03 19:18:32 | 排队消息静默失败补反馈——真实失败可见化
状态：已完成
关联变更：（无）
文件：
- frontend/src/hooks/use-message-queue.ts（五操作失败分层（竞态静默/真实失败 toast）+ QUEUE_MAX_PENDING 导出）
- frontend/src/components/daemon/session-panel.tsx（页面+弹窗超长/队满守卫 toast 化，弹窗补 useNotify）
- frontend/src/hooks/__tests__/use-message-queue.test.ts（errors mock + 竞态静默改 ApiError 断言 + 新增真实失败用例）
- .sillyspec/docs/frontend/modules/hooks-message-queue.md（契约修正为服务端排队现状 + 失败分层语义）
需求：排队消息静默失败补反馈——真实失败可见化
根因：五操作（删除/重试/重排/编辑/立即发送）catch 一律静默，网络/服务端故障时用户编辑保存后文字弹回、删除后条目复活零解释；队列满与消息超 8000 字的发送守卫同样静默 return，按钮亮着按 Enter 毫无反应
方案：hook 增加 notifyUnlessReconcile 统一出口——404/409/422 已知竞态保持静默（load 以服务端为准收敛的 R-02 语义不变），其余 notify.error；页面+弹窗两份 handleSend 的超长与队满守卫改 warning toast，QUEUE_MAX_PENDING 导出供文案取值
结果：use-message-queue 13 用例全绿（含新增竞态静默 ApiError 形态断言与真实失败 toast 用例）；typecheck 0 错；未部署

## ql-20260903-015-0ac4 | 2026-09-03 19:30:05 | ws_hub RPC 按 daemon 归属取消——跨用户误杀随机 504 修复
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/ws_hub.py（pending RPC 绑定 daemon_id + cancel_pending_for_daemon）
- backend/app/modules/daemon/tests/test_ws_rpc.py（新增跨 daemon 隔离用例 + 种子元组化）
- .sillyspec/docs/backend/modules/daemon.md（RPC 关键逻辑同步）
需求：ws_hub RPC 按 daemon 归属取消——跨用户误杀随机 504 修复
根因：_pending_rpcs 只按 rpc_id 索引不绑定 daemon，任一 daemon 断开/逐出触发 cancel_all_pending 整表清空，其它机器（其它用户）正在等待的 RPC 一并被 cancel 成 DaemonRuntimeOffline 504，报错机器与故障机器无关
方案：_pending_rpcs 值改 (daemon_id, future) 元组；disconnect/_evict_stale 改调新增 cancel_pending_for_daemon 精准取消，移除整表清空方法；resolve/_cancel_rpc 适配元组；新增跨 daemon 隔离测试（A 断开 B 照常完成）
结果：ws 相关 4 测试文件 61 用例全绿（含新增隔离用例）；ruff format/check 0；mypy 0；未部署

## ql-20260903-016-ea8a | 2026-09-03 19:44:21 | 派发失败收链——run 判死后取消 pending 指令（消息复活修复）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/control_commands.py（cancel_pending + cancelled 终态 + GC 清理）
- backend/app/modules/daemon/session/service.py（注入/打断失败分支接 _cancel_pending_control_command）
- backend/app/modules/daemon/tests/test_control_commands.py（新增 4 用例）
- .sillyspec/docs/backend/modules/daemon.md（人工备注收链语义）
需求：派发失败收链——run 判死后取消 pending 指令（消息复活修复）
根因：inject/interrupt 推送失败（daemon 离线）时 run 已收敛 failed 并向用户报 504「未能发送」，但 enqueue_and_push 落库的 pending 指令行保留——daemon 在 TTL 内重连补拉会照常执行：界面报错后消息复活，用户重发则同一条消息执行两遍；interrupt 迟到补拉还会误伤新一轮
方案：control_commands 新增 cancel_pending（pending→cancelled 终态幂等，fetch_pending 不取，GC 按 acked 同款保留期清理）；session/service 注入失败与打断失败两分支经 _cancel_pending_control_command（best-effort）同步取消；会话创建与 tool_report 激活两处有意不取消（lease metadata 兜底是设计语义）
结果：test_control_commands 20 用例全绿（新增取消/GC 清理/助手 4 例）+ dispatch/resilience 回归 26 绿；ruff format/check 0；mypy 0；未部署

## ql-20260903-017-e12a | 2026-09-03 20:51:37 | failed 会话收链清理排队消息——队列不再永久等待中
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/sweep.py（_fail_pending_queued_bulk + 三档接入）
- backend/app/modules/daemon/session/service.py（mark_session_recovery_failed 补排队收口）
- backend/app/modules/daemon/tests/test_session_reconnect_sweep.py（新增 3 用例）
- .sillyspec/docs/backend/modules/daemon.md（人工备注收链语义）
需求：failed 会话收链清理排队消息——队列不再永久等待中
根因：排队消息派发只在 run 终态钩子触发（dispatch_queued_messages），会话被巡检/恢复失败收敛成 failed 后永无终态——用户之前排队的消息永久显示等待中，不派发也不报错
方案：sweep.py 新增 _fail_pending_queued_bulk（批量 UPDATE，与广播同份终态复查防误伤活会话，按档写可读中文原因）接入 reconnecting 超时档与离线 pending/worker 档、suspended 超龄 GC；mark_session_recovery_failed 复用 _fail_pending_queued_messages 先例在 commit 前收口
结果：test_session_reconnect_sweep 13 用例全绿（新增 3：超时收敛清队 / 离线 pending 清队 / 窗口内不误伤）+ suspend/redispatch/resilience 52 绿 + recovery 5 绿；ruff format/check 0；mypy 0；未部署
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_session_reconnect_sweep.py

## ql-20260903-018-9afb | 2026-09-03 21:00:47 | 会话切换竞态修复——加载更早防串台 + tool_report 触顶加载失效
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（纪元守卫 + abort + 触顶监听常驻化）
- frontend/src/components/daemon/__tests__/session-panel-history-race.test.tsx（新建竞态回归 2 用例）
- .sillyspec/docs/frontend/modules/components-daemon.md（加载更早守卫契约注记）
需求：会话切换竞态修复——加载更早防串台 + tool_report 触顶加载失效
根因：「加载更早」请求不带取消不校验会话身份：A 会话翻页在途切到 B，A 的历史被 prepend 进 B 的时间线闪现串台；触顶滚动监听按 isToolReportBody 渲染期 ref 早退，effect 依赖不含该翻转维度——tool_report 会话聊过首句后主体切到时间线，监听永不挂载、触顶加载静默失效
方案：sessionEpochRef 换会话自增 + handleLoadEarlier 响应纪元归属校验丢弃 + AbortController 换会话 abort 在途；触顶监听常驻挂载（监听器按 data-testid 自过滤，AgentLog 主体滚动不触发），删渲染期镜像 ref
结果：新建 session-panel-history-race.test.tsx 2 用例全绿（摘守卫验证过测试转红咬得住）+ 相关 4 测试文件 50 用例全绿；typecheck 0 错；未部署

## ql-20260903-019-1b62 | 2026-09-03 21:15:35 | 静默失败补反馈收尾——删除会话结果 + 群回放失败空态 + 群 SSE 断连横幅
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/sessions-portal.tsx（onDeleteSessions 返回失败个数）
- frontend/src/components/floating/floating-session-host.tsx（同口径）
- frontend/src/components/sessions/session-list-panel.tsx（删除结果 toast + prop 类型 Promise<number|void>）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（新增删除结果用例）
- frontend/src/components/group-chat/group-chat-panel.tsx（回放失败空态+重试 + SSE 断连横幅）
- .sillyspec/docs/frontend/modules/components-sessions.md（删除契约注记）
需求：静默失败补反馈收尾——删除会话结果 + 群回放失败空态 + 群 SSE 断连横幅
根因：删除会话 allSettled 结果整体丢弃（连成功提示都没有，全失败时会话原地复现零解释）；群回放失败被吞后与真空群同显「还没有消息」（有几百条历史的群网络抖动时像记录丢了）；群 SSE 断连完全静默（时间线冻结不报错也不更新，单聊有重连横幅群聊没有）
方案：门户+浮层宿主 onDeleteSessions 返回失败个数（照归档口径），面板删除按结果 toast；群面板 replayFailed 状态区分空态并给「点击重试」（驱动回放+SSE 重建）；onStatusChange 接连接状态横幅（reconnecting 常驻/reconnected 2s 自动消失，样式对齐单聊）
结果：session-list-panel 81 用例全绿（新增删除结果 toast 用例）+ group-chat-panel/member-panel/floating-host 164 全绿；typecheck 0 错；未部署

## ql-20260903-020-fdf4 | 2026-09-03 22:17:36 | end_group 解散容错分层——意外异常不再留半死群
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/group/service.py（_end_member_shadow 容错分层 + end_group 行锁取群）
- backend/app/modules/daemon/tests/test_group_chat_management.py（新增意外异常用例）
- .sillyspec/docs/backend/modules/daemon.md（人工备注）
需求：end_group 解散容错分层——意外异常不再留半死群
根因：_end_member_shadow 只捕 AppError：DB 抖动等非 AppError 会带着此前成员影子已逐个 commit 的半途状态把整个解散请求打 500，群行 ended_at 未写、部分成员影子已终止——群在列表里活着但成员全没反应
方案：异常捕获扩大到 Exception（rollback 复位事务态+栈日志+继续下一成员）并返回 bool；end_group 取群改 _get_group_locked（FOR UPDATE 防与发消息/改设置并发交错）；shadow_status=ended 只写真终止的成员（失败成员保持原状态留 sweep 收敛）
结果：test_group_chat_management 35 用例全绿（新增意外异常用例：群终态照常落库+失败成员不伪造 ended+其余成员照常终止）；ruff 0；mypy 0；未部署
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_group_chat_management.py

## ql-20260903-021-9499 | 2026-09-03 22:25:26 | SSE 永久错误停连——单聊/群聊订阅对 401/403/404 不再永久循环重连
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/daemon.ts（两处 onerror 补永久错误停连）
- frontend/src/lib/__tests__/daemon-session-stream-done.test.ts（harness streamStatus 注入 + 404 用例）
- .sillyspec/docs/frontend/modules/lib-daemon.md（停连契约注记）
需求：SSE 永久错误停连——单聊/群聊订阅对 401/403/404 不再永久循环重连
根因：streamSession/streamGroupChat 的 onerror 无条件 scheduleReconnect：打开无权限或已删除的会话/群面板后，每 30s 一轮必败请求（resync runs/logs + stream）永久循环，后台标签页持续空耗并刷日志（审批流与影子查看器已有 PERMANENT_SSE_ERROR_STATUSES 停连，这两处漏齐）
方案：两处 onerror 照 2118 行先例逐字对齐：status 命中名单即 close 置 closed 停止重连；无 status 保持退避重连
结果：daemon-session-stream-done 4 用例全绿（新增 404 停连：推进 120s stream/runs/logs 零增长）+ stream-sync/events/fetch-sse 34 绿；tsc 0 错；未部署
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/lib/__tests__/daemon-session-stream-done.test.ts

## ql-20260903-022-4a7c | 2026-09-03 22:31:10 | 群聊草稿按群持久化——切群/刷新不丢
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/group-chat/group-chat-panel.tsx（草稿读写 helper + 惰性回读 + 变化即写）
- frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx（新增持久化用例）
需求：群聊草稿按群持久化——切群/刷新不丢
根因：群面板按 key={groupId} 重挂载，draft 是裸 useState——在 A 群打一半切去 B 群再回来字全没了；单聊却有完整草稿持久化，规则不一致
方案：readGroupDraft/writeGroupDraft 照单聊模式（localStorage 按群键），useState 惰性初始化回读 + effect 随 draft 写入，发送成功清空同步清存
结果：group-chat-panel 54 用例全绿（新增持久化用例：卸载重挂回填 + 发送清存）；tsc 0 错；未部署
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx

## ql-20260903-023-74fd | 2026-09-03 22:44:53 | 单聊回到底部悬浮按钮 + 新消息计数——照群聊实现移植
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/turn-timeline.tsx（回到底部按钮 + 计数锚定 + relative 包装层）
- frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx（新增 2 用例）
- frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx（结构锚同步（新包装层字面量））
- .sillyspec/docs/frontend/modules/components-daemon.md（TurnTimeline 契约注记）
需求：单聊回到底部悬浮按钮 + 新消息计数——照群聊实现移植
根因：Agent 长篇输出时用户上翻历史，下面来了多少新内容毫无感知，只能自己一点点拖回去——群聊有回到底部悬浮按钮（N 条新消息），单聊没有
方案：TurnTimeline 移植群聊同款：nearBottom 驱动按钮显隐、离开期间新增轮计数（末轮身份锚定防触顶翻页误计、渲染期计算防 ref 滞后）、点击平滑回底；组件根加 relative 包装层承载定位，variant 回归锚同步
结果：turn-timeline-scroll 13 用例全绿（新增显隐/计数/回底 + prepend 不误计 2 例）+ variant/history-race/pre-session 回归 52 绿；tsc 0 错；未部署

## ql-20260903-024-aa3e | 2026-09-03 23:20:30 | 群列表端点 N+1 批量化——250 串行查询降为常数轮
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/group/service.py（三族批量重写 + presence bulk + memberships 批量）
- backend/app/modules/daemon/group/router.py（列表 presence 改 bulk 单次）
- backend/app/modules/daemon/tests/test_group_p2.py（新增多群回归）
- .sillyspec/docs/backend/modules/daemon.md（人工备注）
需求：群列表端点 N+1 批量化——250 串行查询降为常数轮
根因：列表端点逐群查询：LIMIT 1 摘要 + 成员行×2 + COUNT 未读 + Redis SCAN 各一遍，50 群 ≈250 串行查询（SCAN 的 MATCH 只过滤不省游标，逐群各扫全键空间）；群多的用户打开会话门户明显变慢，DB 压力随群数线性放大
方案：三个查询族各改批量（窗口函数 rn=1 / UNION ALL 阈值表 JOIN GROUP BY / 窗口 rn≤200 + Python 匹配）；presence 一次 SCAN group_presence:* 分桶回填，单群版委托 bulk；成员行 IN 单查共享
结果：test_group_p2 18 用例全绿（新增多群不同位点三族互不串组回归）+ management/logs_pagination 49 绿；ruff 0；mypy 0；未部署
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_group_p2.py

## ql-20260903-025-abf5 | 2026-09-03 23:33:21 | 单聊流式渲染热路径优化——delta 不再全树重解析
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（displayTurns 身份稳定守卫 + dialog 回放分页）
- frontend/src/components/daemon/turn-timeline.tsx（标记解析缓存）
- frontend/src/components/ui/markdown-text.tsx（memo 包裹）
- .sillyspec/docs/frontend/modules/components-daemon.md、components-ui.md（热路径契约注记）
需求：单聊流式渲染热路径优化——delta 不再全树重解析
根因：流式期间每个 SSE delta：displayTurns 把 runsMeta 命中的所有 turn 全量 clone（引用全变击穿下游一切 memo）+ 每轮 prompt 每次渲染重复正则拆分 + MarkdownText 无 memo 全文重新 remark parse/sanitize + dialog 回放全量拉日志——流式输出卡、打字顿的直接来源
方案：displayTurns 身份稳定守卫（enrichOne 提取 + 逐字段比对，全一致返回原对象）；标记解析内容级缓存（FIFO 500）；MarkdownText memo；dialog 回放对齐 page 分页 limit=100
结果：5 个相关测试文件 65 用例全绿（variant/history-race/pre-session/scroll/markdown）；tsc 0 错；未部署。遗留 listSessionRuns limit 需后端配合（文档已记）

## ql-20260904-001-649e | 2026-09-04 02:40:00 | 单聊时间线行级 memo——流式 delta 只重渲染变化行
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/turn-timeline.tsx（TurnRow memo 行组件抽取）
- frontend/src/components/daemon/session-panel.tsx（page/dialog onResend/onSwitchProvider useCallback 化）
- frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx（渲染计数回归 + 夹具 props 稳定化）
- .sillyspec/docs/frontend/modules/components-daemon.md（行级 memo 契约注记）
需求：单聊时间线行级 memo——流式 delta 只重渲染变化行
根因：ql-025 已让未变 turn 引用稳定，但行 JSX 仍内联在 map 里——React 依旧逐行重渲染（JSX 重建 + 包装节点），段级/markdown memo 之外仍有整行开销；行级 memo 是渲染热路径三件套的最后一件
方案：TurnRow = memo(...) 行组件抽取（脚本原文搬运）；page/dialog 内联 onResend/onSwitchProvider 提升 useCallback（memo 生效前提）；markdown 渲染计数回归用例守护（delta 只 +1）
结果：turn-timeline-scroll 8 用例全绿（新增 memo 计数用例 2→3→4）+ dialog-minimize/variant/history-race/pre-session/stream-done 45 绿；tsc 0 错；未部署

## ql-20260904-002-401d | 2026-09-04 02:50:57 | 群聊时间线流式排序增量化——SSE 事件二分插入替代全量重排
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/group-chat/group-chat-panel.tsx（insertSortedGroupEntry + 事件应用替换 + newCount memo）
- frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx（等价性 2 用例）
需求：群聊时间线流式排序增量化——SSE 事件二分插入替代全量重排
根因：applyGroupTimelineEvent 每条实时事件 sortGroupTimeline([...base, entry]) 全量复制+重排序（O(n log n)/事件），翻页加载后条目上千时流式期间滚动掉帧、打字指示追加变卡；buildTimelineFromReplay 逐行同路径 ≈200 次全量 sort
方案：insertSortedGroupEntry 二分插入（末尾 append 快路径——直播/回放日志本就时序时零比较）；事件应用替换调用；newCount reduce 改 useMemo；等价性由乱序注入 vs 稳定全量排序的单测锚定
结果：group-chat-panel+member-panel 98 用例全绿（新增等价性 2 例）；tsc 0 错；未部署

## ql-20260904-003-8e4a | 2026-09-04 02:53:43 | 修复 _inject_into_session 派发失败收链 _row 未绑定 UnboundLocalError（de664fb69 引入，24h 审计 H1）
状态：进行中
关联变更：（无）
文件：backend/app/modules/daemon/session/service.py
