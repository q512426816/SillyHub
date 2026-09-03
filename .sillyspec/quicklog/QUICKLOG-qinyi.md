
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
