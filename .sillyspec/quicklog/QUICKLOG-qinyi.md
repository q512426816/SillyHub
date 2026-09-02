
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
