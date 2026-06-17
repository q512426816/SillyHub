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

## ql-20260609-010-d6e7 | 2026-06-09 15:00:00 | Agent 控制台全屏按钮 + 频道过滤器(INFO/TOOL/WARN/ASK/REPLY)
状态：已完成
文件：frontend/src/components/agent-log-viewer.tsx, frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
结果：AgentLogViewer 新增全屏模式(fixed inset-0 z-50 + body scroll lock)和频道过滤(Set<string> toggle)，Agent 控制台和 Bootstrap 页面共用

## ql-20260609-011-c8f9 | 2026-06-09 15:30:00 | 扫描自检摘要卡片 parseScanCheckOutput 正则修复
状态：已完成
文件：frontend/src/components/agent-log-viewer.tsx
根因：原始正则匹配英文格式但实际输出为中文格式（"7份scan文档"、"19个模块"），宽泛回退 `module.*?(\d+)` 误匹配路径段 "modules/992cedec"
结果：仅保留精确中文格式匹配，移除所有宽泛英文回退正则；commit 34c4e4 已推送部署

## ql-20260609-012-a1b2 | 2026-06-09 16:00:00 | Agent 控制台日志10项优化全量验证 + parseScanCheckOutput 最终修复
状态：已完成
文件：frontend/src/components/agent-log-viewer.tsx
结果：逐项验证10项需求均已实现（Bash tool 结构化渲染、command 折叠、stdout/stderr 分离、原始数据折叠、扫描自检摘要卡片、结果摘要列、状态区分、全屏+频道过滤、自动滚动、复制/下载），修复 parseScanCheckOutput 正则精确匹配中文格式

## ql-20260609-013-a3f7 | 2026-06-09 16:20:00 | Agent 日志事件归一化 + 工具专属渲染(Write/Agent/Grep/Read/Edit)
状态：已完成
文件：frontend/src/components/agent-log/types.ts, frontend/src/components/agent-log/normalize.ts, frontend/src/components/agent-log/tool-renderers.tsx, frontend/src/components/agent-log-viewer.tsx
结果：1) normalizeLogs 归一化：隐藏重复 TOOL_USE stdout、合并 TOOL_RESULT 到 tool_call 卡片；2) 6 种工具专属渲染器（Write 文件信息+内容折叠、Agent description+prompt折叠、Bash 增强输出折叠、Grep/Glob pattern+命中预览、Read 文件路径+内容折叠、Edit 变更对比折叠）；3) Thinking/System stdout 默认折叠+半透明；4) 通用 fallback 保留参数折叠；5) 全部 backward-compatible export

## ql-20260609-014-c3d8 | 2026-06-09 16:50:00 | 修复 stdout [TOOL_USE] 文本事件被当作普通 INFO 渲染
状态：已完成
文件：frontend/src/components/agent-log/types.ts, frontend/src/components/agent-log/normalize.ts, frontend/src/components/agent-log-viewer.tsx
结果：1) normalizeLogs 新增 parseStdoutToolUse 解析 stdout [TOOL_USE] ToolName: {json} 为 ToolCallEntry；2) 有 channel=tool_call 时隐藏 stdout 重复，无时转为 parsedStdoutTool 走工具专属卡片渲染；3) AgentLogRow 新增 parsedStdoutTool 分支；4) 默认渲染通过 filterToolProtocolLines 过滤 [TOOL_USE]/[TOOL_RESULT]；5) TypeScript 编译通过

## ql-20260610-003-b5d4 | 2026-06-10 09:41:32 | Bootstrap 成功后增加"生成项目组件"按钮
状态：已完成
文件：backend/app/modules/workspace/service.py, backend/app/modules/workspace/router.py, frontend/src/app/(dashboard)/workspaces/[id]/page.tsx, frontend/src/lib/spec-workspaces.ts
结果：1) 后端 generate_projects 从 _module-map.yaml 按前缀分组生成 projects/*.yaml + reparse 创建子 workspace；2) 前端 Bootstrap 成功且无组件时显示"生成项目组件"按钮；3) TypeScript 编译通过

## ql-20260610-002-e7c3 | 2026-06-10 09:31:16 | 修复 agent run 被误标为 failed（cleanup_stale_runs 覆盖已完成 run）
状态：已完成
根因：backend 重启时 cleanup_stale_runs 无条件将 status=running 的 run 标为 failed/exit_code=-1，但 agent 实际已完成（metadata 已写入 DB），只是 status commit 在重启中丢失
文件：backend/app/modules/agent/service.py
结果：1) cleanup_stale_runs 增加已有 metadata 检查（num_turns>0 且 exit_code>=0），恢复为 completed/failed 而非一律标 failed；2) 直接修复 run 2fcf4c69 数据 status→completed, exit_code→0

## ql-20260610-001-f2a1 | 2026-06-10 09:13:46 | 修复 GET /api/workspaces 500（后端连接池耗尽）
状态：已完成
根因：之前调试时在容器内执行 curl 健康检查未加 `-m` 超时，堆积 20+ 僵尸 curl 进程耗尽 uvicorn 连接池，导致所有请求（包括 health）超时。重启 backend 清理后恢复。
文件：无代码改动

## ql-20260609-015-d4e9 | 2026-06-09 17:20:00 | 修复 stdout [TOOL_RESULT] 大段内容被当作普通 INFO 展示
状态：已完成
文件：frontend/src/components/agent-log/types.ts, frontend/src/components/agent-log/normalize.ts, frontend/src/components/agent-log/tool-renderers.tsx, frontend/src/components/agent-log-viewer.tsx
结果：1) normalize.ts 新增 extractToolResultBody 解析完整 TOOL_RESULT body；2) normalizeLogs 重构 TOOL_RESULT 处理：有 tool source 时合并并隐藏，无时存入 parsedToolResult 独立渲染；3) tool-renderers.tsx 新增 ToolResultCard（长结果折叠+前5行摘要）和 WorkflowSpecResultCard（检测 YAML workflow spec 并展示摘要）；4) filterToolProtocolLines 扩展过滤 THINKING/SYSTEM/ASSISTANT；5) AgentLogRow 新增 parsedToolResult 渲染分支

## ql-20260610-004-c7f3 | 2026-06-10 15:43:55 | 重置密码后展示明文密码（后端生成随机密码并返回）
状态：已完成
文件：backend/app/modules/settings/service.py, backend/app/modules/settings/schema.py, backend/app/modules/settings/router.py, frontend/src/lib/settings.ts, frontend/src/app/(dashboard)/settings/page.tsx
结果：service.py 新增 _generate_password 生成12位随机密码，reset_password 返回明文；schema.py 新增 ResetPasswordResponse；router.py 改为返回200+ResetPasswordResponse；前端去掉手动输入改为一键生成+展示明文+复制按钮

## ql-20260616-001-8b4e | 2026-06-16 09:05:00 | 修复 Windows 上 sillyhub-daemon spawn claude 报 ENOENT
状态：已完成
根因：Windows 上 npm 全局安装的 claude 同时生成无扩展名 sh wrapper（git-bash 用）和 claude.cmd。agent-detector.ts:188 WINDOWS_EXTS 把 '' 放首位 → findOnPath 返回 sh wrapper；task-runner.ts:472 spawn 没传 shell:true → Windows Node 无法 CreateProcess 无扩展名脚本 → ENOENT，同时 stdin.write 因 stdio 关闭报 EPIPE
文件：sillyhub-daemon/src/agent-detector.ts, sillyhub-daemon/src/task-runner.ts
结果：1) WINDOWS_EXTS 把 '' 移到末尾（'.exe', '.cmd', '.bat', '.ps1', ''），优先返回真正可执行的 .cmd；2) task-runner spawn 前 check Windows + /\.(cmd|bat)$/i 命中则传 shell:true，与 detectVersion 的 exec 分支行为对齐；3) daemon rebuild + 重启后 task 执行链路恢复

## ql-20260616-002-f4ce | 2026-06-16 09:35:52 | /runtimes 快速对话本地终端 + 前端流式显示执行过程
状态：已完成
文件：sillyhub-daemon/src/task-runner.ts, backend/app/main.py, frontend/src/lib/daemon.ts, frontend/src/app/(dashboard)/runtimes/page.tsx, frontend/src/app/api/daemon-chat/[runId]/stream/route.ts
结果：1) task-runner.ts 加 echoAgentEvent/echoTaskBoundary 两个纯函数，每个 AgentEvent 实时打印到 daemon 本地 stdout（前缀 [task leaseId前8位]，单条截断 2000 字符），start/end 边界打印 spawn cmd 和 exit status；2) backend main.py 新增 GET /api/daemon-chat/{run_id}/stream，复用 AgentService.stream_run_logs 订阅 Redis agent_run:{run_id} 频道（同 agent router 的 stream_agent_run_logs 模式）；3) 前端新建 nextjs route handler /api/daemon-chat/[runId]/stream/route.ts 透传 SSE 避开 nextjs rewrite 缓冲；4) daemon.ts 新增 streamQuickChat + QuickChatStreamMessage/QuickChatStreamDone 类型，与 streamAgentRunLogs 一致用 query token；5) runtimes/page.tsx QuickChatPanel 改用 streamRun，逐条 SSE message 实时 append 到聊天框（text/tool_use/tool_result/error 分别 emoji 渲染），60s 内没收到任何消息自动回退到 GET 轮询兜底，组件卸载清理 SSE+timer。TS/lint/ruff 全部通过。

## ql-20260616-003-2d2a | 2026-06-16 10:30:30 | daemon 弹独立终端观察 Claude 执行（不破坏平台事件流）
状态：已完成
文件：sillyhub-daemon/src/config.ts, sillyhub-daemon/src/cli.ts, sillyhub-daemon/src/task-runner.ts, sillyhub-daemon/src/terminal-launcher.ts (新增), sillyhub-daemon/src/terminal-observer.ts (新增), sillyhub-daemon/tests/cli.test.ts, sillyhub-daemon/tests/config.test.ts, sillyhub-daemon/tests/terminal-launcher.test.ts (新增), sillyhub-daemon/tests/terminal-observer.test.ts (新增), sillyhub-daemon/tests/task-runner-terminal-observer.test.ts (新增)
结果：1) config.ts 新增 4 个 terminal_observer_* 字段（enabled/mode/close_on_exit/command），默认 enabled=false/mode=parsed/close_on_exit=false/command=null；2) 新增 terminal-launcher.ts 跨平台终端弹窗（Windows wt.exe→cmd.exe fallback / macOS osascript / Linux x-terminal-emulator 候选链 + custom 模式支持 {log}/{title} 占位符），detached+unref+静默吞错确保不影响业务；3) 新增 terminal-observer.ts 写 ~/.sillyhub/daemon/runs/<leaseId>/terminal.log + header + 可选 launchTerminal 弹独立窗口 tail，writeParsed/writeRawStdout/writeRawStderr 按 mode 分流（parsed/raw/both），close 幂等；4) task-runner.ts 重构成 fire-and-forget（spawn 同步执行，observer promise 后台 resolve），extract renderAgentEvent/renderTaskBoundary 纯函数同时写 daemon stdout + observer 日志保证字节一致，所有 5 个返回路径（cancelled/timeout/spawnError/非零/completed）都走 finishAttempt 收尾；5) cli.ts 新增 4 个 CLI 选项（--open-terminal/--terminal-mode/--terminal-close-on-exit/--terminal-command）+ mode 非法值返回 exit 1，修复了第 4 参 config 漏传 TaskRunner 构造的 bug；6) 新增 27 个单测覆盖全链路（config 16 字段 / cli 4 选项+非法 mode / launcher 4 平台分支+unref+不抛错 / observer header+3 mode+close 幂等+launchTerminal 抛错降级+NOOP / task-runner 集成 7 场景含失败/成功/stderr/raw stdout/observer 抛错降级）。所有新测试在 isolation 通过，typecheck/build 干净。

## ql-20260617-001-3aed | 2026-06-17 11:32:52 | 角色管理新增「查看角色下用户」功能
状态：进行中
文件：backend/app/modules/admin/router.py, backend/app/modules/admin/roles_service.py, backend/app/modules/admin/schema.py, backend/tests/modules/admin/test_roles_router.py, frontend/src/lib/admin.ts, frontend/src/app/(dashboard)/admin/roles/page.tsx
状态：已完成
文件：backend/app/modules/admin/schema.py, backend/app/modules/admin/roles_service.py, backend/app/modules/admin/router.py, backend/tests/modules/admin/test_roles_router.py, backend/conftest.py, frontend/src/lib/admin.ts, frontend/src/app/(dashboard)/admin/roles/page.tsx
结果：1) schema.py 加 RoleUserRead（binding_type=Literal["platform","workspace"] + workspace_id/workspace_name 可选）+ RoleUserListResponse；2) roles_service.py 加 list_users() 方法，user_roles 和 user_workspace_roles 两表分别 JOIN User，绑两种类型则各返回一条；3) router.py 加 GET /api/admin/roles/{role_id}/users（require_permission_any(ROLE_READ)）；4) test 加 3 个用例（平台+工作区合并 / 空角色 / 角色不存在 404）；5) admin.ts 加 RoleUserRead/RoleUserListResponse 类型 + listRoleUsers()；6) roles/page.tsx 把「X 用户」改成可点击按钮 + RoleUsersDrawer 显示邮箱/显示名/绑定类型/工作区/状态表格；7) 顺带修复 conftest.py 漏 import app.modules.admin.model 导致 user_roles 表在 SQLite 测试库不存在（pre-existing test_create_role_success isolation 失败的根因）。ruff/mypy/pytest 13/13/pnpm test 75/75 全绿。

## ql-20260617-002-21d4 | 2026-06-17 13:55:00 | 用户管理抽屉组织/角色多选显示"暂无选项"
状态：已完成
根因：users/page.tsx 用 listRoles({ size: 200 }) 加载角色，但后端 GET /api/admin/roles 的 size 上限是 le=100，200 直接被 422 拒；Promise.all 是 fail-fast 的，roles 失败连带把 organizations 一起拖死；catch 块又写成了 silent "// ignore — drawer will show empty selects"，错误被吞所以表象就是两个多选都空白
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
结果：1) size=200 → size=100 匹配后端 le=100；2) Promise.all → Promise.allSettled 单个失败不连坐，organizations 能正常加载；3) catch 改成 console.error 把错误打到控制台，避免再次 silent。lint/typecheck/test(75/75) 全绿

## ql-20260617-003-3757 | 2026-06-17 14:05:00 | 用户管理/角色管理分页（默认 20 条/页）
状态：已完成
根因：users/page.tsx 写死 limit=200 一次性拉全部，roles/page.tsx 走后端默认 size=20 但前端无翻页 UI，超过 20 条直接看不到
文件：frontend/src/components/ui/pagination.tsx (新增), frontend/src/app/(dashboard)/admin/users/page.tsx, frontend/src/app/(dashboard)/admin/roles/page.tsx
结果：1) 新增 components/ui/pagination.tsx 通用分页（上一页/下一页 + 共X条·第N/M页）；2) roles/page.tsx 加 page state + listRoles 传 page/size=20 + 搜索变化时 setPage(1)；3) users/page.tsx 删 limit=200 改为 limit=20+offset=(page-1)*20，搜索/状态变化时 setPage(1)；4) 两个页面表格下方挂 Pagination。lint/typecheck/test(75/75) 全绿

## ql-20260617-004-02d5 | 2026-06-17 14:15:00 | 角色/用户管理改用 antd Table + 每页数量可选
状态：已完成
背景：用户要求"可以选择每页数量，使用 Ant Design 的 Table 组件"，AskUserQuestion 二选一后确认走 antd 路线（不是扩展自定义 Pagination）
文件：frontend/package.json, frontend/src/app/layout.tsx, frontend/src/components/antd-providers.tsx (新增), frontend/src/app/(dashboard)/admin/roles/page.tsx, frontend/src/app/(dashboard)/admin/users/page.tsx, frontend/src/components/ui/pagination.tsx (删除)
结果：1) 装 antd 6.4 + @ant-design/nextjs-registry 1.3 + @ant-design/icons 6.2；2) 新建 components/antd-providers.tsx (client)，导出 AntdProviders 包 ConfigProvider（zhCN locale + colorPrimary/borderRadius token + Table headerBg/rowHoverBg），App 组件提供 message/notification context；3) layout.tsx 包 AntdRegistry + AntdProviders 注入 CSS-in-JS；4) roles/page.tsx 原生 table 改 antd Table，columns 用对象数组+render 函数，pagination showSizeChanger + pageSizeOptions [10,20,50,100] + showTotal，pageSize state + onChange(p,s) 同步 setPage/setPageSize；5) users/page.tsx 同上 + scroll.x=max-content 应对操作列宽度；6) 删除 components/ui/pagination.tsx（被 antd Table 内置分页替代）。typecheck/lint/test(75/75)/build 全绿。admin/roles 和 admin/users bundle 从 ~100KB 升到 ~300KB（+200KB 是 antd cost）

## ql-20260617-005-2682 | 2026-06-17 14:35:00 | 系统角色 name/description 中文化
状态：已完成
背景：用户要求"角色的名称和组织的名称都改为中文的"。组织没有系统种子数据，全是用户创建，无需迁移；系统角色在 migration `202605280900_create_auth_and_rbac.py` SYSTEM_ROLES + `service.py:seed_platform_admin_role` fallback 中以英文硬编码，需要中文化。
坑点：首次尝试新建 migration 用 revision ID `202606170900`，撞上已有的 `202606170900_add_change_workflow_fields.py`，alembic 报 "Revision 202606170900 is present more than once" + "Cycle is detected"，backend 容器无限 Restarting。`git revert HEAD --no-edit` 回滚后，改用 revision ID `202607010900` 重做。
文件：backend/migrations/versions/202605280900_create_auth_and_rbac.py, backend/app/modules/auth/service.py, backend/migrations/versions/202607010900_rename_system_roles_to_zh.py (新增)
结果：1) SYSTEM_ROLES 七条 name/description 改中文（平台管理员/工作区所有者/组件负责人/开发者/审核人/测试工程师/访客）；2) `seed_platform_admin_role` fallback Role 改中文 name/description；3) 新增 migration `202607010900`（down_revision=202606300900），UPDATE roles SET name/description WHERE key=? AND is_system=TRUE，downgrade 还原英文；4) 修 ruff N806（downgrade 内局部变量改小写）。ruff 通过。DB 当前在 202606161200（之前 cycle 卡住没追上），重建后 alembic 会一路推到 202607010900 并把存量 roles UPDATE 成中文。
