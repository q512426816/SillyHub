
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

## ql-20260903-002-cef1 | 2026-09-03 06:16:26 | 修复24h审计3高危3中危：worktree RPC超时跨层错配/孙分身重开工二波唤醒挡死/翻页伪runId撞React key/影子直聊隐私文案过诺/群时间线…
状态：已完成
关联变更：（无）
文件：backend/app/modules/agent/mcp_tools.py, backend/app/modules/agent/mission_context.py, backend/app/modules/agent/tests/test_worker_subsession_done.py, backend/app/modules/daemon/group/service.py, backend/app/modules/daemon/host_fs/delegate.py, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/session-panel.tsx, frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx, frontend/src/components/group-chat/group-chat-panel.tsx
需求：修复24h审计3高危3中危：worktree RPC超时跨层错配/孙分身重开工二波唤醒挡死/翻页伪runId撞React key/影子直聊隐私文案过诺/群时间线他人发言拽底/SSE增量写进更早块
根因：①daemon侧git上限提到120s但后端RPC仍30s默认，30-120s检出窗口后端先放弃且掩盖真实报错+收残竞态；②嵌套回叫幂等键是常量1纯SETNX无波次语义，孙重开工第二波被挡6h只能等patrol强收（声称根治的死锁在受支持流程复发）且调用点未按docstring声明做is_new_signal门控；③logsToTurns每次调用伪id从1重编号，prepend只给同run轮加后缀，多run更早页与当前窗口撞key；④直聊头承诺只在会话内可见，但影子会话日志/详情对全体群成员放行（有测试锁定、群定位协作群），文案与行为冲突；⑤own-send判定未过滤isSelf，群时间线他人发言触发强制回底拽走上滚视口；⑥upsertTurn对realRunId首中数组头部prepend的更早段块，运行中长run翻页后流式输出写进历史块
方案：①delegate._via_rpc_or_degrade补timeout透传，worktree add/merge/remove显式传_WORKTREE_RPC_TIMEOUT_SECONDS=150s（>daemon 120s）；②notify_parent_workers_done改F04同款时间戳波次（键值=本波done_at，SETNX失败新波严格大于才覆盖重投）+mcp_tools调用点hoist is_new_signal双消费方共用并传signal_at；③prepend每页伪runId全量加#e<全量数字游标>后缀（秒级短码改全量防同秒撞）；④直聊头如实表述不投影群时间线+群成员可查会话（保留测试断言短语）；⑤own-send判定补e.isSelf过滤+首帧分支播种own-send基线（修测试暴露的回放旧own消息误判）；⑥realRunId命中改从数组尾部反向取最末块，实时增量落当前尾部块
结果：后端：test_worker_subsession_done 20 passed（含新增孙重开工二波再唤醒用例）、test_group_direct+test_dispatch_worker_caller_worktree 24、test_group_logs_pagination 14、test_subsession_recursion_dispatch 13，ruff check+format 0；前端：page.test 28（新增多run翻页不撞key+长run翻页SSE增量落末块两用例）、group-chat-panel 29（新增他人发言不拽底用例）、variant+turn-timeline-scroll+runtime-session-helpers 34，tsc 0、eslint 0错误；模块文档4处同步；另登记docs/sillyspec/2026-09-03-quicksync-conflict-granularity.md（spec-sync整树冲突粒度活坑）
审计：⚖️ 归属切分：7 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/group/router.py, backend/app/modules/daemon/run_sync/service.py, backend/app/modules/daemon/tests/test_group_direct.py, backend/openapi.json, frontend/src/lib/api-types.ts, backend/app/modules/daemon/tests/test_group_p1.py, docs/sillyspec/2026-09-03-quicksync-conflict-granularity.md

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
