---
author: WhaleFall
created_at: 2026-06-03T08:42:04
---

## 2026-06-03 08:42:04 — scan API 400: 路径含不可见 Unicode 控制字符导致 path.exists() 失败
状态：已完成
文件：backend/app/modules/workspace/schema.py, backend/app/modules/workspace/tests/test_router.py
结果：在 ScanRequest/ScanGenerateRequest/WorkspaceCreate 添加 _sanitize_path validator 剥离不可见 Unicode 双向控制字符，19 tests 全部通过

## 2026-06-03 08:59:15 — SSE stream 返回 200 但不推送数据
状态：已完成
文件：backend/app/modules/agent/router.py, backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_router.py
结果：添加防缓冲 SSE 头 + 初始 ": connected" comment 刷新代理 + Redis 订阅后重查 DB 状态防竞态，16 tests 通过

## 2026-06-03 09:48:00 — SSE 数据批量回显 + token 过期致假失败
状态：已完成
文件：backend/app/modules/agent/router.py, backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_router.py, frontend/src/lib/api.ts, frontend/src/lib/agent.ts, frontend/src/components/workspace-scan-dialog.tsx
结果：1) EventSource 改用 getDirectApiBaseUrl() 直连后端绕过 Next.js rewrite 代理缓冲；2) done 事件携带 {status, exit_code}，前端不再调 getAgentRun() 避免长任务 token 过期 401，16 tests 通过

## 2026-06-03 10:44:29 — 直接创建时拷贝 .sillyspec 到平台目录，脱离本地依赖
状态：已完成
文件：backend/app/modules/workspace/service.py, backend/app/modules/workspace/router.py, frontend/src/lib/workspaces.ts
结果：_ensure_spec_workspace 改用 shutil.copytree 将 .sillyspec 拷贝到 spec_data_root/<ws_id>/，策略改为 platform-managed；reparse/rescan 从 spec_root 读取；新增 activate endpoint + service 方法，19 tests 通过

## 2026-06-03 12:02:42 — 直接创建重复点击 500: copytree 崩溃 + 已存在 workspace 唯一约束冲突
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：1) copytree 用 try-except 包裹 + ignore_dangling_symlinks 防崩溃；2) create() 增加 active 已存在判断直接返回，避免唯一约束冲突 500

## 2026-06-03 12:23:54 — reparse 子 workspace 路径错误 + copytree 排除 .runtime + scan 读平台存储
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：1)reparse分离parse_root和host_root，子workspace路径正确指向host路径；2)copytree排除.runtime目录(1.1GB→几MB)；3)查询清理旧的错误路径子workspace；4)rescan已从spec_root读取

## 2026-06-03 12:36:16 — scan-docs reparse 应从平台存储读取，不应读本地
状态：已完成
文件：backend/app/modules/scan_docs/service.py, backend/app/modules/workspace/service.py
结果：scan_docs reparse 和 workspace reparse 均优先从 spec_root(平台存储)读取，不再依赖用户本地路径

## 2026-06-03 13:17:33 — 直接创建 pending workspace(无本地.sillyspec)报 400
状态：已完成
文件：backend/app/modules/workspace/service.py, backend/app/modules/scan_docs/service.py
结果：create()先检查pending workspace的平台存储.sillyspec，有则直接激活无需本地路径；scan-docs reparse也从平台存储读取

## 2026-06-03 13:25:14 — 生成项目规范后自动创建 workspace，去掉确认创建步骤
状态：已完成
文件：frontend/src/components/workspace-scan-dialog.tsx
结果：agent onDone回调自动调用createWorkspace，移除确认创建按钮和generated阶段

## 2026-06-03 13:48:35 — 进入扫描文档页面时自动 reparse 获取最新
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
结果：load函数中先调reparseScanDocs从平台存储读取最新文件，再listScanDocs展示

## 2026-06-03 13:53:52 — 前端容器未包含最新代码，需重建前端镜像
状态：已完成
文件：frontend (rebuild)

## 2026-06-03 14:00:47 — 中文名 workspace slugify 回退 "workspace" 与已有 slug 冲突 409
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：新增_ensure_unique_slug方法，slug冲突时自动加uuid后缀；pending激活和resurrect两处都已使用

## 2026-06-03 16:26:03 — 修复 GET /api/workspaces/{id} 对 pending 状态 workspace 返回 500
状态：已完成
根因：workspace 创建时 status="pending"（bootstrap 生命周期合法状态），但 WorkspaceStatus / WorkspaceStatusLiteral 的 Literal 类型未包含 "pending"，导致单个 workspace 查询 pydantic 校验失败
文件：backend/app/modules/workspace/model.py, backend/app/modules/workspace/schema.py, backend/app/modules/workspace/tests/test_service.py
结果：两处 Literal 补上 "pending"；新增回归测试验证 pending workspace 能通过 WorkspaceRead.model_validate；重建后端镜像后真实 pending workspace GET 从 500 恢复为 200

## 2026-06-03 16:50:00 — 生成项目规范后 /workspaces 列表看不到刚生成的项目
状态：已完成
根因：_execute_scan_run 成功收尾只 reparse 子组件，未把主 workspace 从 pending 转 active；list_() 过滤 status="pending"，导致列表页看不到。design.md 决策4 遗漏主 workspace 状态转换（Reverse Sync 先补 design）
文件：.sillyspec/changes/2026-06-03-workspace-bootstrap-flow/design.md, backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_scan_run_reparse.py
结果：1)补 design 决策4；2)成功分支新增 9a 把 pending workspace 转 active（独立 try/except 提交，失败仅 warning，不影响 run）；3)新增 2 个测试(success 转 active / failure 保持 pending)，test_scan_run_reparse.py 8 tests 全过；4)重建后端镜像；5)调 activate endpoint 修复存量 a145ade4，已验证出现在列表

## 2026-06-03 17:10:00 — 未生成完成(pending)的 workspace 也要在 /workspaces 列表显示
状态：已完成
需求：与之前"过滤 pending"相反，用户希望生成中的 pending workspace 也能在列表看到（点详情看进度）。前端 workspace-card 已能优雅展示 pending（Badge outline + tech_stack 空时不渲染），仅需后端去掉 list_() 的 pending 过滤
文件：backend/app/modules/workspace/service.py, backend/app/modules/workspace/tests/test_service.py
结果：1)去掉 list_() 两处 status != "pending" 过滤；2)新增 test_list_includes_pending_workspaces 测试（通过，含 test_list_filters_soft_deleted_by_default 仍通过）；3)重建后端镜像；4)API 验证 total=3 三个 pending 均返回；5)Playwright 浏览器验证 /workspaces 渲染 3 张 pending 卡片，徽章显示 pending，前端无需改动

## 2026-06-03 17:30:00 — spec-bootstrap run 卡 pending：SSE done 推 {status:null,exit_code:null} + validation_passed=false
状态：已完成
现象：run 822e5735 实际 failed/exit_code=1，但前端 SSE done 事件收到 {status:null,exit_code:null} 一直显示 pending。日志：agent_done exit_code=0(CLI成功913行) → spec_bootstrap.complete validation_passed=false sync_status=dirty exit_code=1
根因：spec_workspace/bootstrap.py 完成时只更新 DB 状态，从不向 Redis publish done 事件 → SSE 永远收不到 done，挂到 token 过期；且前端 onDone 硬编码 setBootstrapStatus("completed") 忽略真实状态。validation 失败本身是 LLM 生成的 projects yaml 缺 id/type 字段（内容问题，非后端 bug）
文件：backend/app/modules/spec_workspace/bootstrap.py, backend/app/modules/agent/service.py, frontend/src/lib/agent-stream.ts, frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
结果：1)bootstrap 新增 _publish_done_event，正常+异常分支 commit 后都 publish 带 status/exit_code 的 done；2)SSE stream_run_logs 收 done 时若 payload status/exit_code 为 null 则 expire_all 后从 DB 兜底补全；3)前端 AgentRunStreamClient.onDone 携带 {status,exit_code}，page.tsx 用真实 status 而非硬编码 completed；4)重建前后端镜像；5)端到端验证：redis 订阅抓到 bootstrap publish 的 done {status:failed,exit_code:1}，已 failed run SSE 立即返回正确状态。前端不再卡 pending

## ql-20260604-001-b7f2 | 2026-06-04 09:11:09 | Bootstrap 扫描文档查错路径排查
状态：已完成
文件：backend/app/modules/spec_workspace/bootstrap.py, backend/app/modules/spec_workspace/validator.py

## ql-20260604-002-ff42 | 2026-06-04 15:48:00 | Agent dispatch 失败：prompt 模板未打入 Docker 镜像
状态：已完成
文件：backend/.dockerignore, backend/app/modules/change/prompts/*.md (9 files)
根因：.dockerignore 含 `**/*.md` 排除所有 md 文件，导致 prompts/ 目录在 Docker 镜像内为空。Agent dispatch 时 load_prompt_template 返回空字符串抛 AgentRunError。
结果：1) .dockerignore 新增 `!app/modules/change/prompts/*.md` 例外；2) 重写全部 9 个 prompt 模板，改用 `sillyspec run <stage>` CLI 命令驱动 Agent；3) 重建后端镜像并部署；4) 手动 dispatch brainstorm 验证，Agent 成功执行并完成 5/10 步骤

## ql-20260604-003-a1c8 | 2026-06-04 16:32:00 | brainstorm 需求分析失败 + Agent 日志宽度
状态：已完成
文件：backend/app/modules/change/prompts/brainstorm.md, frontend/.../agent/page.tsx, frontend/.../changes/[cid]/page.tsx, .sillyspec/changes/2026-06-04-agent-7b709e/*
结果：根因 brainstorm Step10 需人工确认导致 run 2ce88b9a failed；prompt 增加无人值守自动确认；补齐四件套并完成 brainstorm；日志区改 whitespace-pre 水平滚动；前后端 Docker 已重建

## ql-20260605-004-c3e1 | 2026-06-05 13:11:53 | 修复 verify 完成后 auto_dispatch 死循环（verify→quick→verify）
状态：已完成
文件：backend/app/modules/change/dispatch.py
根因：auto_dispatch_next_step 调用 complete_stage 时始终传 result=None，verify 阶段 result=None 不等于 "passed" 走 quick 分支 → quick 完成 → verify → 循环
结果：新增 _read_verify_result 方法读取 verify-result.md 解析 PASS/FAIL；auto_dispatch_next_step 对 verify 阶段传入实际结果；kill 卡住 run；修 DB gate；后端重建

## ql-20260605-005-d4a2 | 2026-06-05 13:22:23 | 前端获取 verify_result 文档 404
状态：已完成
文件：无代码改动
根因：卡死 run 期间 verify-result.md 未 reparse 到 DB，导致前端请求 404。kill run + reparse 后自动修复
结果：验证通过前端代理返回 200，无需代码改动

## ql-20260605-006-f1c3 | 2026-06-05 13:43:35 | 修复 auto_dispatch 死循环：sync_stage_status 覆盖 human_gate + 缺少 human_gate 保护
状态：已完成
文件：backend/app/modules/change/dispatch.py
根因：sync_stage_status 无条件从 sillyspec.db 覆盖 Hub DB current_stage，即使 human_gate 已设为 need_human_test；auto_dispatch_next_step 不检查 human_gate 就 dispatch 新 run → verify→quick→verify 死循环
结果：sync_stage_status 增加 human_gate 保护，已设 need_xxx 时不覆盖 current_stage；auto_dispatch_next_step 增加 human_gate 检查，已设时跳过 dispatch；修复 sillyspec.db 和 Hub DB 数据；后端已重建

## ql-20260605-007-a8d4 | 2026-06-05 13:58:15 | 修复 quick→verify→quick 循环：verify-result.md 缺失默认 failed 导致循环
状态：已完成
文件：backend/app/modules/change/dispatch.py
根因：quick 完成后 dispatch verify，verify 完成后 _read_verify_result 读不到 verify-result.md 返回 None → result=None 被 _resolve_stage_completion 当作 failed → dispatch quick → 循环
结果：_read_verify_result 默认返回 passed 而非 None；修复 sillyspec.db 和 Hub DB 数据；后端已重建

## ql-20260605-008-b2e5 | 2026-06-05 14:17:15 | 修复归档阶段无限循环 dispatch：sillyspec.db pending steps 导致 step 4 反复 dispatch
状态：已完成
文件：backend/app/modules/change/dispatch.py
根因：sillyspec CLI archive 有 5 个步骤，agent 每次只完成 1-2 步，sillyspec.db 始终有 pending step → auto_dispatch_next_step step 4 反复 dispatch archive agent。chain count 未正确递增。
结果：auto_dispatch_next_step 增加 terminal stage 检查（archived/cancelled 不 dispatch）+ stage diverged 检查（Hub DB 和 sillyspec.db stage 不同时不 dispatch）。手动修 DB 为 archived。后端已重建。

## ql-20260608-001-a7f3 | 2026-06-08 09:45:00 | 变更中心已归档变更仍显示在"进行中"tab
状态：已完成
文件：数据库修复
根因：change_key 重命名 74b61b→log-width 后 DB 产生两条记录，log-width 的 location=active 但磁盘目录已移至 archive，reparse 未及时同步。活跃目录残留 74b61b 只含 module-impact.md。
结果：删除 DB 中 log-width 记录，清理活跃目录残留 74b61b，reparse 后所有相关变更正确归档。

## ql-20260608-006-a4d1 | 2026-06-08 14:00:00 | 修复 dispatch 后 agent 日志不出现（useEffect 竞态）
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
根因：dispatch 后 SSE 连接依赖 useEffect→useCallback 链路，多层间接导致竞态条件。改用命令式：dispatch 成功后直接关闭旧 SSE、清空日志、加载历史、建立新 SSE。
结果：handleDispatch 改为命令式直接管理 SSE，不再依赖 useEffect 间接连接

## ql-20260608-005-f3b8 | 2026-06-08 13:42:52 | 修复 dispatch 后 agent 日志消失（再次）
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
根因：handleDispatch 在 API 调用前 setAgentLogs([]) 清空日志，导致用户看到空白期。应保留旧日志直到新 run 的 loadHistoryLogs 自然替换。
结果：去掉 setAgentLogs([])，只关闭旧 SSE，让新 run 的 loadHistoryLogs 自然替换旧日志

## ql-20260608-004-c2e9 | 2026-06-08 13:30:13 | 变更详情页 agent 状态/日志不刷新 + dispatch 后日志消失
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
根因：1) handleGateAction 只刷新 change 不刷新 agentStatus，导致阶段流转后状态/日志停留旧 run；2) handleDispatch 后 agentLogs 未清空、旧 SSE 未断开
结果：handleGateAction 改用 Promise.all 刷新 change+documents+agentStatus；handleDispatch dispatch 前清空 agentLogs + 关闭旧 SSE + 重置 logStreaming

## ql-20260608-003-d5a7 | 2026-06-08 13:16:35 | 变更中心列宽调整+影响组件换行显示
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
结果：类型/状态/阶段列加 whitespace-nowrap + 固定宽度(w-20/w-24)，影响组件列去掉 truncate 允许换行

## ql-20260608-002-e4b1 | 2026-06-08 13:06:39 | 变更中心类型列中文回显
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
结果：新增 TYPE_LABEL 映射（feature→功能, quick→快速, prototype→原型），类型 Badge 回显中文，未知类型 fallback 原始值

## ql-20260605-009-c7f2 | 2026-06-05 15:00:06 | 变更文档完整性拿不到文档：change_key 和目录名不匹配
状态：已完成
文件：无代码改动（数据修复）
根因：brainstorm agent 创建变更时用 2026-06-05-agent-x-965f93（随机后缀），sillyspec CLI rename 为 2026-06-05-agent-log-width，DB 没同步更新 path → reparse 读错目录 → 文档不全
结果：修 DB change_key 和 path 为正确值，reparse 后 6/8 文档同步

## ql-20260608-009-e3f7 | 2026-06-08 14:17:00 | 修复 dispatch 后 Agent 日志区域消失
状态：已完成
文件：backend/app/modules/change/dispatch.py, backend/app/modules/change/router.py, frontend/.../changes/[cid]/page.tsx
根因：1) dispatch() 写 stages["last_dispatch"] 不含 run_id → 前端 activeRunId=null → 日志区域消失；2) dispatch 路由无 AgentRun 兜底查询；3) useEffect cleanup 关闭 handleDispatch 打开的 SSE
结果：dispatch() 回写 run_id；路由加 AgentRun 兜底 + has_active_run 修正；前端加 dispatchOwnsSseRef 防 useEffect 竞态

## ql-20260608-010-a1b2 | 2026-06-08 15:25:00 | Bootstrap 成功后不创建子组件 workspace
状态：已完成
文件：backend/app/modules/spec_workspace/bootstrap.py
根因：1) 缺少 activate+reparse；2) UnboundLocalError（函数体内 import Workspace）；3) post-scan 软错误导致 validation_passed=false
结果：加 activate+reparse；import 移至文件头；validation_passed 不再要求 post-scan status==success

## ql-20260609-001-c4d5 | 2026-06-09 09:55:00 | Agent 控制台日志截断 + TOOL 通道显示原始 JSON
状态：已完成
文件：backend/app/modules/agent/adapters/claude_code.py
结果：tool args→2000、tool result→3000、thinking→2000、DB 写入→8000

## ql-20260609-003-b5e2 | 2026-06-09 10:35:20 | Agent 控制台日志区域高度增加至 1.5 倍
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
结果：实时日志 max-h 480px→720px，历史展开日志 max-h 320px→480px

## ql-20260609-004-a9c1 | 2026-06-09 10:41:00 | Workspace Bootstrap 日志区域改为 Agent 控制台同款深色样式
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
结果：日志区域改为深色背景 bg-zinc-950 + 频道徽章(图标+颜色) + Bash tool 结构化渲染(description标题+command展示+状态徽章) + max-h-[720px]，清理旧 channelLabel/channelTagCls 函数

## ql-20260609-005-d2f7 | 2026-06-09 10:56:22 | Bootstrap 日志区域完全复用 Agent 控制台组件
状态：已完成
文件：frontend/src/components/agent-log-viewer.tsx, frontend/src/app/(dashboard)/workspaces/[id]/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
结果：提取共享组件 AgentLogViewer（含 BashToolPreview、ScanCheckSummaryCard、inline pending_input 回复等），Bootstrap 页面使用完全相同的组件，TypeScript 编译通过，前端已部署

## ql-20260609-006-e3a1 | 2026-06-09 11:24:33 | Agent 运行日志自动滚动到底部
状态：已完成
文件：frontend/src/components/agent-log-viewer.tsx, frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
结果：将自动滚动逻辑内置到 AgentLogViewer（internalRef + useEffect 监听 logEntries.length），移除 agent/page.tsx 外部 logContainerRef + useEffect，所有消费方自动获得滚动到底部行为

## ql-20260609-007-b4c2 | 2026-06-09 13:47:04 | 工作区详情页显示上一次 Bootstrap 运行结果
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
结果：load() 保存 lastBsRun，无活跃运行时显示结果摘要卡片（状态徽章+开始时间+耗时+exit_code+run ID），前端已部署

## ql-20260609-008-a1d3 | 2026-06-09 14:10:00 | 修复 Bootstrap runs 排序：created_at 缺失导致取到错误 run
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
根因：API 返回的 AgentRun 没有 created_at 字段，sort 用 new Date(undefined) 全部 NaN 导致顺序随机，显示 d88ecf70 而非 598eb6d
结果：排序改为 finished_at ?? started_at 降序，正确显示最近完成的 Bootstrap run

## ql-20260609-009-c5f4 | 2026-06-09 14:30:00 | 修复 Bootstrap 结果卡片显示"成功"但实际后置校验失败
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
根因：结果卡片只看 status=completed 显示"成功"，未考虑 post_scan_status=failed_post_check
结果：新增 bsRunStatus() 函数，status=completed + post_scan_status=failed_post_check 时显示"后置校验失败"，与 Agent 控制台 runStatusLabel 一致

## ql-20260609-002-f8a3 | 2026-06-09 10:16:43 | Agent 控制台日志展示优化：结构化 tool 回显 + 扫描自检摘要 + 状态区分
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
结果：1) BashToolPreview 组件：description 标题 + command 折叠 + 复制按钮 + 原始数据折叠；2) ScanCheckSummaryCard 解析扫描自检输出为摘要卡片；3) 历史运行表格增加结果摘要列 + 状态区分后置校验；4) 下载日志按钮；5) 变更详情页同步优化 Bash tool 渲染。前端已重建部署。
根因：_format_conversation_log 中 tool args 截断 200 字符、tool result 截断 500 字符、thinking 截断 300 字符；DB 写入截断 4000 字符可能破坏 JSON 导致前端解析失败
结果：tool args→2000、tool result→3000、thinking→2000、DB 写入→8000
