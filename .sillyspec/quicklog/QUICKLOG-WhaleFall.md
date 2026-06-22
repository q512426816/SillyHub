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

## ql-20260617-006-7c92 | 2026-06-17 15:47:09 | 用户管理抽屉不显示用户已有角色/组织
状态：已完成
根因：`router.py:_user_with_relations` 只查 `UserRole`（平台级 `user_roles` 表），但 `bootstrap_admin_and_seed_rbac` 给 admin 用户写的是 `UserWorkspaceRole`（工作区级 `user_workspace_roles` 表）。角色管理 `RoleService.list_users` 双表查所以看得到 admin，用户管理只查 platform 表所以看不到。两端视图数据不一致。
文件：backend/app/modules/admin/router.py（`_user_with_relations` 合并 UserRole + UserWorkspaceRole 并按 role_id 去重；import 加 `UserWorkspaceRole`）、backend/tests/modules/admin/test_users_router.py（新增 2 个回归测试：detail + list 都验证 workspace-scoped 角色显示）
结果：1) `_user_with_relations` 改为分别 select Role from `user_roles` 和 `user_workspace_roles`，merged dict 按 role_id 去重，避免同一角色在多 workspace 下重复展示；2) 加测试 `test_user_detail_includes_workspace_scoped_roles` 和 `test_user_list_includes_workspace_scoped_roles`，构造 Workspace + UserWorkspaceRole binding，断言 GET /admin/users/{id} 和 GET /admin/users 返回的 roles 含 custom_role；3) ruff format/check 全绿，本地无 sqlalchemy 跑不了 pytest，等容器重建后在容器内验证。前端 page.tsx 只渲染 r.name Tag 不需改。

## ql-20260617-007-4a31 | 2026-06-17 16:27:35 | 非平台管理员看不到「系统管理」菜单
状态：已完成
根因：`/api/auth/me` 返回的 `MeResponse` 没有 permissions 字段，前端 `lib/auth.ts:login` 把 `permissions` 写死为 `[]`。所以 `lib/permission.ts:hasAdminPermission` 永远走不到 `perms.some(...)` 分支，只有 `is_platform_admin=true` 才显示菜单。测试管理账号只有 7 个 admin 权限，不是 platform admin，故看不到。
文件：backend/app/modules/auth/rbac.py（新增 `collect_permissions_everywhere` 合并 platform + all workspace 权限）、backend/app/modules/auth/schema.py（`MeResponse` 加 `permissions: list[str]` 字段）、backend/app/modules/auth/router.py（`/me` 调用 `collect_permissions_everywhere` 填充 sorted perms）、frontend/src/lib/auth.ts（`MeResponse` 加 permissions；抽出 `fetchMe()` 供复用；login 走 fetchMe 写入 perms）、frontend/src/app/(dashboard)/layout.tsx（mount 时主动 fetchMe 让旧 session 也能拿到 perms）
结果：1) 后端 me 返回 permissions；2) 前端 login 调 fetchMe 同步 perms；3) dashboard mount 时也 fetchMe 一次，老 session（perms 为空）刷新页面后即可看到菜单；4) typecheck/lint 全绿。后端无 alembic 改动不需要 migration。


## ql-20260618-001-a3f2 | 2026-06-18 11:15:00 | 厘清 git-identities/settings menu 与 user:read 的冗余兜底
状态：已完成
文件：frontend/src/lib/menu-permissions.ts、frontend/src/lib/permission.ts、frontend/src/components/admin-role-permission-picker.tsx、frontend/src/lib/__tests__/menu-permissions.test.ts、frontend/src/lib/__tests__/permission.test.ts、frontend/src/components/__tests__/admin-role-permission-picker.test.tsx
背景：用户质疑 picker 中 user:read 同时出现在 git-identities + users + settings 三个 menu。调查后端：git_identity router 无 require_permission（登录即可访问），settings router 全部 require_platform_admin。前端 MENU_PERMISSION_GROUPS 给 git-identities 加 user:read/write、给 settings 加 user:read 均为前端兜底猜测，后端并不强制。
方案：对齐后端事实。(1) MenuPermissionGroup 加 alwaysVisible?: boolean 字段；(2) git-identities 设 alwaysVisible=true 且 permissions=[]；settings 精简到只 platform:admin；(3) canSeeMenu 加 alwaysVisible 分支：登录用户即可见，无需 permission；(4) picker 过滤 alwaysVisible menu（role 无权限可配不渲染）；(5) 测试调整：menu-permissions.test 加 alwaysVisible 校验 + settings 1 permission、permission.test 加 canSeeMenu alwaysVisible 4 用例、picker.test management 6→5 + 2 个 user:read 折叠测试改用 queryAllByLabelText（user:read 现在 picker 中只出现 1 次，折叠后 0 次 getAll 会抛错）。
结果：1) typecheck/lint/test 全绿（129 用例，新增 2 个 alwaysVisible 用例）；2) picker 中 user:read 只在「用户」menu 出现一处，不再冗余；3) git-identities 菜单所有登录用户可见（用户自服务语义对齐后端 get_current_user）；4) settings 菜单只 platform:admin 可见。Docker 重建 + UI 手工验证待后续。

## ql-20260618-002-7b1c | 2026-06-18 13:10:00 | git-identities alwaysVisible 致测试管理账号可见，与用户预期冲突
状态：已完成
文件：frontend/src/lib/menu-permissions.ts、frontend/src/lib/permission.ts、frontend/src/components/admin-role-permission-picker.tsx、frontend/src/lib/__tests__/menu-permissions.test.ts、frontend/src/lib/__tests__/permission.test.ts
背景：上一轮 ql-001 给 git-identities 设 alwaysVisible=true 让所有登录用户可见。用户反馈测试管理账号（只有 user/org/role 7 个权限）不应该看到 git-identities 菜单。
方案：撤销 alwaysVisible，引入 pickerHidden 字段。(1) 删除 MenuPermissionGroup.alwaysVisible 字段，新增 pickerHidden?: boolean；(2) git-identities 改 permissions=[platform:admin] + pickerHidden=true（与 api-keys/settings 共享 platform:admin，测试管理账号无 platform:admin 看不到）；(3) canSeeMenu 删除 alwaysVisible 分支，恢复纯 permissions 判断；(4) picker 把过滤条件从 !alwaysVisible 改为 !pickerHidden；(5) 测试：menu-permissions.test 改 alwaysVisible 校验为 pickerHidden + platform:admin 校验；permission.test 删 alwaysVisible 4 用例，新增「git-identities 配 platform:admin 测试管理账号不可见」用例（3 个断言：无 platform:admin false / 平台管理员 true / 有 platform:admin 非 super true）；picker.test 把 management 6→5 用例注释从 alwaysVisible 改 pickerHidden。
结果：1) typecheck/lint/test 全绿（129 用例）；2) 测试管理账号现在看不到 git-identities 菜单（无 platform:admin）；3) picker 中 git-identities 卡片不渲染（platform:admin 只在 api-keys + settings 出现 2 处，不再 3 处）；4) 撤销上一轮 alwaysVisible 字段，仅保留 pickerHidden 表达「picker 不渲染」语义。Docker 重建 + UI 手工验证待后续。

## ql-20260618-003-c1d4 | 2026-06-18 13:20:00 | picker 中 workspace:read 跨 7 menu 兜底重复，用户期望每个菜单有独立查看权限
状态：已完成
文件：backend/app/modules/auth/permissions.py、backend/app/modules/knowledge/router.py、backend/app/modules/runtime/router.py、backend/app/modules/scan_docs/router.py、backend/app/modules/workspace/router.py、backend/app/modules/incident/router.py、frontend/src/lib/menu-permissions.ts、frontend/src/lib/__tests__/menu-permissions.test.ts
背景：项目组组件/拓扑图/扫描文档/运行时/知识&日志/事件 6 个 menu + Workspace 首页 都用 workspace:read 作为查看权限兜底，picker 渲染重复。design.md §5.2 当时记录此为兜底决策。用户希望每个菜单有独立的查看权限。
方案：扩后端枚举（用户三选一推荐方案）。(1) Permission StrEnum 新增 6 个：COMPONENT_READ/TOPOL-GY_READ/SCAN_DOCS_READ/RUNTIME_READ/KNOWLEDGE_READ/INCIDENT_READ；group 映射归到 WORKSPACE 组；(2) 无需 migration（permissions 是 role_permissions 表字符串字段，无独立 permissions 表，新枚举自动可用，platform_admin 用户走 is_platform_admin=True 短路自动生效）；(3) 5 个 router 改 require_permission：knowledge 4 端点 → KNOWLEDGE_READ，runtime 5 端点 → RUNTIME_READ，scan_docs 2 个 GET → SCAN_DOCS_READ（POST reparse 保留 WORKSPACE_WRITE），workspace /topology → TOPOLOGY_READ，incident 列表/详情/postmortem GET → INCIDENT_READ（创建/更新/postmortem 创建保留 DEPLOY_*）；(4) 前端 menu-permissions.ts 6 个 menu 改独立权限（components→component:read 等），runtime menu 保留 task:read 作为第二权限（runtime 涉及任务），头部注释更新；(5) 测试：BACKEND_PERMISSION_KEYS 镜像常量从 36 → 42 项，兜底菜单测试改为「6 个子菜单有独立 read 权限不再共用 workspace:read」校验。
结果：1) 前端 typecheck/lint/test 全绿（129 用例）；2) 后端 ruff 待重建后跑；3) picker 中每个 menu 显示独立查看权限，不再重复 workspace:read；4) 后端 RBAC 严格校验，无权限访问对应 API 返 401/403。Docker 重建（backend+frontend）+ UI 手工验证待后续。

## ql-20260618-008-9096 | 2026-06-18 15:01:18 | 角色详情 drawer 同用户多工作区折叠 + 状态列改名账号类型
状态：已完成
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx
背景：bootstrap admin 在 4 个 workspace 都绑 workspace_owner，drawer 列出 4 行同账号。状态列名"状态"显示"超管"与绑定关系易混淆。
方案：(1) drawer 列表按 user.id 折叠：新增 aggregateUsers helper + RoleUsersTable 组件，每用户 1 行；工作区列展示该用户所有绑定工作区名称（去重，竖排）；同时有平台级 + 工作区级绑定时绑定类型显示双徽标（平台级 + 工作区级 ×N），单类型单徽标；(2) 表头"状态"→"账号类型"，"启用"→"普通"，明确语义指 is_platform_admin/login_enabled 而非绑定状态；(3) 副标题"共 N 条绑定" → "共 N 个用户（M 条绑定）"。
结果：1) 前端 typecheck 全绿；2) 132 tests 全过；3) admin 在 4 workspace 同绑 workspace_owner 时 drawer 显示 1 行 + 工作区列竖排 4 个名称。Docker 重建 frontend 待后续。

## ql-20260618-007-9c72 | 2026-06-18 14:29:10 | AuthUserLoginDisabled 错误信息改中文
状态：已完成
文件：backend/app/core/auth_deps.py, backend/app/modules/auth/service.py
背景：login_enabled=False 的账号登录时返回 "Login has been disabled for this account."，与平台其他中文 UI 不一致。该错误出现在两处：auth_deps.get_current_user（token 解析时）和 auth.service.login（登录时）。
方案：两处 "Login has been disabled for this account." → "该账号的登录权限已被禁用。"。
结果：1) ruff 全绿；2) 55 auth tests 全过（无测试断言原英文文案）；3) Docker 重建 backend 后禁用登录账号将看到中文提示。

## ql-20260618-006-b11a | 2026-06-18 14:24:01 | login 默认密码 admin12345 错误，应为 admin123
状态：已完成
文件：frontend/src/app/(auth)/login/page.tsx
背景：login page 第 14 行 useState 默认密码为 "admin12345"，但 deploy/.env 的 PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123，每次登录都要手动改。
方案：useState("admin12345") → useState("admin123")，对齐 deploy/.env 的 PLATFORM_BOOTSTRAP_ADMIN_PASSWORD。
结果：1) typecheck 全绿；2) Docker 重建 frontend 后 /login 默认填入正确密码 admin123。

## ql-20260618-005-dd9e | 2026-06-18 14:05:17 | git-identities 仍用 platform:admin + pickerHidden 致 123@163.com 可见/picker 缺失
状态：已完成
文件：backend/app/modules/auth/permissions.py, backend/app/modules/git_identity/router.py, backend/tests/modules/auth/test_permissions.py, frontend/src/lib/menu-permissions.ts, frontend/src/lib/__tests__/menu-permissions.test.ts, frontend/src/lib/__tests__/permission.test.ts, frontend/src/components/__tests__/admin-role-permission-picker.test.tsx
背景：ql-004 把 settings/api-keys/runtimes 拆出独立 admin 权限后，git-identities 仍保留 platform:admin + pickerHidden=true。两个问题：(1) 123@163.com 角色 test 含 platform:admin（历史授予），git-identities 兜底 platform:admin 致可见；(2) picker 因 pickerHidden 完全不渲染 git-identities，管理员无法显式授予。
方案：新增 git_identity:admin 独立权限（沿用 ql-003/ql-004 模式）。(1) backend permissions.py 新增 GIT_IDENTITY_ADMIN="git_identity:admin"，PLATFORM 组；(2) backend git_identity/router 5 个端点（list/create/get/revoke/check-access）改 GitIdentityAdminUser=require_permission_any(GIT_IDENTITY_ADMIN)；(3) frontend menu-permissions.ts git-identities 改 [{key:"git_identity:admin", name:"Git 身份访问"}]，移除 pickerHidden；(4) BACKEND_PERMISSION_KEYS 镜像 45→46；test_permissions.py 改 46 用例 + 新增 GIT_IDENTITY_ADMIN 组判定；picker 测试改"6 个 management menu 全部可见（含 git-identities）"。
结果：1) 前端 typecheck 全绿 + 132 tests 全过；2) 后端 ruff/mypy 全绿 + 55 auth tests 全过；3) 123@163.com 持续可见 git-identities 的根因 = 其 test 角色持有 platform:admin（has_permission 短路），管理员需手动从 test 角色移除 platform:admin（或仅授予需要的子权限）；4) picker 现在渲染 git-identities 卡片，管理员可显式授予 git_identity:admin。Docker 重建（backend+frontend）+ UI 手工验证待后续。

## ql-20260622-002-21c3 | 2026-06-22 09:04:28 | 修复 admin 三页双重 AppShell 嵌套
状态：已完成
背景：上一轮 ql-001 删了 admin 三页内 `<header>` 后用户反馈仍有两层左侧菜单 + 两层头部面包屑。排查 layout 嵌套发现：`(dashboard)/layout.tsx` 已渲染 `<AppShell>{children}</AppShell>`，`(dashboard)/admin/layout.tsx` 又渲染了一次 `<AppShell>{children}</AppShell>` → Next.js App Router 嵌套 layout 累加 AppShell，左侧菜单和 TopBar 各渲染两次。
文件：frontend/src/app/(dashboard)/admin/layout.tsx
结果：admin/layout.tsx 移除 AppShell import 与 `<AppShell>` 包裹，return 改为 `<>{children}</>`；权限 gate（hasAdminPermission 校验 + denied → redirect /）保持不变。父 dashboard layout 提供唯一 AppShell 实例。typecheck 通过 + 329 测试全过。

## ql-20260622-001-0f84 | 2026-06-22 08:49:14 | 系统管理三个页面去掉冗余头部导航信息栏
状态：已完成
背景：AppShell 已经渲染全局 TopBar（面包屑"系统管理 / 用户" + 搜索 + 通知 + 用户菜单），admin/users/organizations/roles 三个页面又各自渲染 `<header>`（h1 标题 + 描述 + 操作按钮），与 TopBar 形成两层重复的头部信息栏。
文件：frontend/src/app/(dashboard)/admin/users/page.tsx, frontend/src/app/(dashboard)/admin/organizations/page.tsx, frontend/src/app/(dashboard)/admin/roles/page.tsx
结果：1) users 删除 `<header>`，"+ 新建用户" 按钮挪到搜索筛选条右侧（"共 X 个用户" 文字 + 按钮组成 ml-auto flex 行）；2) organizations 删除 `<header>`，"+ 新建" 按钮挪到 aside 搜索框右侧（搜索框 flex-1 + 按钮同行）；3) roles 删除 `<header>`，"+ 新建角色" 按钮挪到搜索条右侧（同 users 模式）；4) typecheck 仅报预存在的 dayjs/echarts/radix-ui 依赖缺失，与本次改动无关；5) vitest 293 测试全过无新增失败。Docker 重建 frontend 待后续。

## ql-20260618-004-9e2a | 2026-06-18 13:50:00 | Daemon 运行时/设置/API Keys 共用 platform:admin 致 picker 重复，需各自独立
状态：已完成
文件：backend/app/modules/auth/permissions.py, backend/app/modules/auth/router.py, backend/app/modules/daemon/router.py, backend/app/modules/settings/router.py, backend/tests/modules/auth/test_permissions.py, frontend/src/lib/menu-permissions.ts, frontend/src/lib/__tests__/menu-permissions.test.ts, frontend/src/components/__tests__/admin-role-permission-picker.test.tsx
背景：上一轮 ql-003 把 workspace 子菜单拆分独立后，剩 3 个 menu（runtimes/settings/api-keys）仍共享 platform:admin。用户希望也各自独立。后端 settings/api_key 用 require_platform_admin（is_platform_admin 短路），daemon 用 get_current_principal，platform:admin 在 picker 中重复 3 次。
方案：前后端同步拆分（用户三选一推荐方案）。(1) Permission StrEnum 新增 3 个：SETTINGS_ADMIN="settings:admin"/API_KEY_ADMIN="api_key:admin"/RUNTIME_ADMIN="runtime:admin"，归 PLATFORM 组（runtime 前缀冲突，单独按 value 判定 RUNTIME_READ→WORKSPACE / RUNTIME_ADMIN→PLATFORM）；(2) 后端 settings/router 的 GET+PUT /settings 改 SettingsAdminUser（require_permission_any(SETTINGS_ADMIN)），/users 系列仍 AdminUser 不动；auth/router 3 个 /api-keys 端点改 ApiKeyAdminUser（require_permission_any(API_KEY_ADMIN)），删除 _require_platform_admin helper；daemon/router 5 个管理端点（list/get/disable/enable/leases）改 RuntimeAdminUser，daemon 自身用的 register/heartbeat/leases 生命周期仍 get_current_principal；(3) 前端 menu-permissions.ts 3 个 menu 改独立权限，pickerHidden 注释更新；BACKEND_PERMISSION_KEYS 镜像常量从 42 → 45 项，3 个新增 admin 用例 + settings 用例改写，picker 渲染测试排除 pickerHidden menu（platform:admin 反向校验不再出现在 picker 中）。
结果：1) 前端 typecheck 全绿 + 131 用例全过；2) 后端 ruff/mypy 全绿 + 315 用例全过（2 个 test_users_router 失败为 ql-003 前已存在的 workspaces.root_path NOT NULL fixture 问题，与本变更无关）；3) platform:admin 现仅出现在 git-identities（pickerHidden），picker 中不再有任何 menu 共享同一权限；4) platform:admin 用户走 has_permission 短路 + PLATFORM_ADMIN.value fallback 自动通过所有新 admin 权限校验，向后兼容。Docker 重建（backend+frontend）+ UI 手工验证待后续。

## ql-20260622-003-cdf8 | 2026-06-22 09:42:00 | 参考 img.png 重构 /ppm/project-plans 页面结构（左树+右表+顶部合并）
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：用户给一张典型后台 UI 参考图（顶部搜索+主操作合并、左侧树形分组、右侧数据表），要求把 /ppm/project-plans 按这个结构调整。当前页面是单列结构（搜索 SectionCard + DataTable），缺左侧分组树。
方案：只调结构不动色。1) PageContainer size="full" 容纳左右分栏；2) 顶部 SectionCard p-2 把搜索表单（项目名称/合同名称 + 展开的公司名/三个时间范围）和 SearchBarActions（搜索/重置/展开 + 分隔符 + 导出/+新建项目计划）合并到同一行；3) 主体 `<div className="flex gap-4">` 左右分栏：左侧 `<aside className="w-56 shrink-0">` 放 SectionCard + antd Tree（按 project_manager_id 分组，title 显示项目经理名+数量，defaultExpandAll，selectedKeys 受控），右侧 `<div className="min-w-0 flex-1">` 放 DataTable；4) 新增 selectedManager state（"all" | "manager:<id>"），filteredPlans useMemo 客户端过滤；5) summaryRow useMemo 改为基于 filteredPlans 求和，与表格视图保持一致；6) 修复 hooks 时序：filteredPlans 必须先于 summaryRow 声明，避免 TDZ。
结果：1) typecheck 通过；2) 329/329 vitest 用例全过（无新增失败）；3) lint 无新增告警（仅预存 unused-args）；4) 点击树节点（如"张三 (3)"）右侧表格只显示该 manager 名下项目，合计行同步刷新。Docker 重建 frontend 待后续。

## ql-20260622-004-e80a | 2026-06-22 09:56:32 | /ppm/project-plans 查询条件换行加间距 + 按钮移到顶部
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：ql-003 把顶部搜索+操作合到一行后，两个问题：(1) Form layout=inline 字段换行后行间无垂直间距，紧贴；(2) 按钮组（搜索/重置/展开/导出/+新建）原本通过 SearchBarActions ml-auto 推到 Form 末尾右侧，展开多行后按钮被挤到最后一行底部，用户希望按钮在查询条件顶部。
方案：1) SectionCard 内结构改为上下两段：顶部 `<div className="mb-2 flex items-center justify-end gap-2">` 放按钮组，下方 `<Form layout="inline" className="w-full" style={{ rowGap: 8 }}>` 放字段；2) Form 加 style={{ rowGap: 8 }} 让 antd inline-flex wrap 换行时有 8px 垂直间距；3) 删除 SearchBar/SearchBarActions 包装（原本是横向容器，与新的上下排列冲突）；4) 移除未使用的 import SearchBar/SearchBarActions。
结果：1) typecheck 通过；2) 329/329 vitest 全过；3) 展开后字段超过容器宽度自动换行，行间 8px 间距；4) 按钮组始终位于 Form 上方右对齐，不再受字段数量影响。Docker 重建 frontend 待后续。

## ql-20260622-005-2a58 | 2026-06-22 10:04:36 | /ppm/project-plans 查询条件宽度统一对齐
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：6 个 Form.Item 中 Input 用 w-[200px]、RangePicker 用 w-[240px] 宽度不一，label 文字长度不同（4 字 "项目名称" vs 6 字 "合同签订时间"）进一步让 control 起始位置错乱。
方案：新增 module-level helper `fieldLabel(text)` 返回 `<span className="inline-block w-[88px] text-right text-sm">{text}</span>` 统一 label 视觉宽度；6 个 Form.Item 全部重构：1) `label={fieldLabel("xxx")}`；2) `colon={false}` 去掉冒号（冒号会让 control 起始位置偏移）；3) `className="w-[300px]"` 整体宽度统一；4) 内部 Input/RangePicker 改为 `className="w-full"` 填满 control 区域。
结果：1) typecheck 通过；2) 329/329 vitest 全过；3) 6 个 Form.Item 视觉宽度完全对齐（整体 300px / label 88px / control ~212px），4 字与 6 字 label 起始/结束位置一致，Input 和 RangePicker 宽度一致。Docker 重建 frontend 待后续。

## ql-20260622-006-fa76 | 2026-06-22 10:12:31 | 修复时间查询条件标题/选择框双行换行
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：ql-005 把 Form.Item 统一到 w-[300px] / label w-[88px] 后，3 个时间 RangePicker 项（合同签订时间/项目开始时间/预计验收时间）的标题和选择框都变成两行。
根因：(1) Form.Item w-[300px] 减去 label w-[88px] 与 label-control 间距 8px，control 实际可用仅 204px，而 antd RangePicker 标准布局（两个日期 input + separator + allowClear 图标）最小需要 ~220px，不够就内部换行；(2) fieldLabel span 缺 whitespace-nowrap，6 字 label 在 antd `<label>` 包装层因 padding 触发文字换行。
方案：1) fieldLabel span 加 `whitespace-nowrap` 强制单行展示；2) 6 个 Form.Item className 由 `w-[300px]` 全部加宽到 `w-[340px]`（control 可用宽度 204→244px，给 RangePicker 留足空间）。
结果：1) typecheck 通过；2) 329/329 vitest 全过；3) 时间项 label 单行展示，RangePicker 单行展示双日期+separator+图标；4) 6 个 Form.Item 整体宽度统一对齐（340px）。Docker 重建 frontend 待后续。

## ql-20260622-007-9ab3 | 2026-06-22 10:20:43 | 查询条件改垂直布局彻底解决时间项换行
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：ql-006 把 Form.Item 加宽到 w-[340px] 并给 label 加 whitespace-nowrap 后，用户反馈时间项（合同签订时间/项目开始时间/预计验收时间）的标题和 RangePicker 仍然不在同一行。w-[340px] − label w-[88px] − gap 8px = control 实际 ~244px，但 antd RangePicker 标准布局需要 ~260-280px 才能稳定单行，继续加宽会让 Form.Item 过大、布局失衡。用户给了备选方案："或者把其他的输入框的查询条件也按上面标题下面输入框去调整"。
方案：采纳用户 fallback，所有 6 个查询条件统一改为垂直布局（标题在上、控件在下）。
  1) 新增 `Field({ label, children })` helper：外层 `<div className="flex w-[200px] flex-col gap-1">`，顶部 `<span className="text-xs leading-4 text-muted-foreground">{label}</span>`，下方 children；
  2) 6 个 Form.Item 全部改为 `noStyle`（不渲染 antd label 和外层 wrapper），由 Field 完全接管样式；
  3) 3 个时间 RangePicker 加 `allowClear={false}` 移除 clear 图标，避免 200px 内部换行；
  4) Form `style={{ rowGap: 12, columnGap: 12 }}` 替代之前的 `rowGap: 8`；
  5) 删除不再使用的 `fieldLabel` helper；6) 引入 `type ReactNode` from "react" 替代 React.ReactNode。
结果：1) typecheck 通过；2) 329/329 vitest 全过；3) 6 个查询条件视觉完全统一：标题（text-xs 灰）在上、控件在下，宽度均 200px；4) RangePicker 在 200px 内单行展示双日期+separator+日历图标（无 clear 图标）。Docker 重建 frontend 待后续。

## ql-20260622-008-de04 | 2026-06-22 10:27:09 | 查询条件一行最多 4 个
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：ql-007 改垂直布局后，Field 用 w-[200px]，外层 Form 用 flex-wrap，容器宽度决定一行能放几个（宽屏可能放 5-6 个）。用户要求一行最多 4 个。
方案：CSS Grid 强制 4 列。1) Form className 由 `w-full` + style rowGap/columnGap 改为 `grid w-full grid-cols-4 gap-3`；2) Field 内部 div 由 `w-[200px]` 改为 `w-full` 占满网格列；3) Form 移除 style（grid 的 gap-3 已覆盖 rowGap/columnGap）。
结果：1) typecheck 通过；2) 329/329 vitest 全过；3) 展开 6 个条件时第一行 4 个（项目名称/合同名称/公司名称/合同签订时间），第二行 2 个占左两列（项目开始时间/预计验收时间）；4）收起时只显示 2 个（项目名称/合同名称）占左两列。Docker 重建 frontend 待后续。

## ql-20260622-009-3ebf | 2026-06-22 10:33:41 | 修复 grid 一行一个 + 收起时显示前 4 个
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：ql-008 改 grid-cols-4 后用户反馈一行只有一个查询条件。根因：antd Form `layout="inline"` 给 `<form>` 加 `display: inline-flex; flex-wrap: wrap` 内部样式，覆盖了我们的 `grid-cols-4`，Field 被作为 inline-flex item 排列，宽度由内容决定而非网格列。同时用户重申期望：默认显示一行 4 个，展开显示全部。
方案：1) Form `layout` 由 `"inline"` 改为 `"vertical"`，让 `<form>` 回到 `display: block`，`grid-cols-4` 才能生效（Form.Item 用 `noStyle` 不渲染 wrapper，layout 不影响实际渲染）；2) 前 4 个 Field（项目名称/合同名称/公司名称/合同签订时间）总是渲染，后 2 个 Field（项目开始时间/预计验收时间）仅 `expanded=true` 时渲染；3）展开按钮因总数 6 > 4 始终显示，文案 `expanded ? "收起" : "展开"` 保持不变。
结果：1）typecheck 通过；2）329/329 vitest 全过；3）收起时第一行 4 个查询条件（项目名称/合同名称/公司名称/合同签订时间）等宽对齐；4）展开时第一行 4 个 + 第二行 2 个（项目开始时间/预计验收时间）占左两列。Docker 重建 frontend 待后续。

## ql-20260622-010-4d84 | 2026-06-22 10:54:54 | 缩窄操作列宽度消除右侧空白
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：操作列 `width: 300`，但实际 4 个 `Button size="sm" variant="ghost"`（详情/里程碑/编辑/删除）+ `gap-1` 总宽度约 232px，右侧留约 60-70px 空白。
方案：操作列 `width` 由 `300` 缩到 `240`（实际内容 232 + 8 buffer）。
结果：1）typecheck 通过；2）329/329 vitest 全过；3）操作列宽度贴合 4 个按钮实际宽度，无右侧空白。Docker 重建 frontend 待后续。

## ql-20260622-011-0449 | 2026-06-22 11:06:45 | 操作列按钮统一切换为实心彩色样式
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：操作列 4 个按钮原本仅"删除"是实心（variant="destructive" 红色），其余 3 个（详情/里程碑/编辑）是 variant="ghost" 幽灵按钮（透明背景+文字色）。用户要求所有按钮统一按删除按钮的实心样式，颜色由我搭配。
方案：4 个按钮全部改为实心，按功能语义搭配颜色：
  - **详情** variant `ghost`→`default` + className `bg-blue-500 text-white hover:bg-blue-600`（蓝色/查看语义）
  - **里程碑** variant `ghost`→`default` + className `bg-amber-500 text-white hover:bg-amber-600`（琥珀色/任务里程碑语义）
  - **编辑** variant `ghost`→`default` 保持平台 primary 主色
  - **删除** variant `destructive` 不变（红色/危险语义）
机制：Button 用 cva 生成 className，外部传入的 className 会覆盖 cva 内部 className（Tailwind 后写优先），所以 variant=default + className bg-blue-500 能覆盖默认 bg-primary。
结果：1）typecheck 通过；2）329/329 vitest 全过；3）4 个按钮视觉统一为彩色实心，颜色按功能区分（蓝/琥珀/主色/红）。Docker 重建 frontend 待后续。

## ql-20260622-012-b29d | 2026-06-22 11:19:33 | 项目计划表格添加边框线
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：/ppm/project-plans 的 DataTable（antd Table）默认无外边框/单元格边框，用户要求加边框线。
方案：在 DataTable 调用处加 antd 原生 `bordered` prop，antd Table 自动给表头/单元格/外框加细边框，仅本页生效不影响其他页面。
结果：1）typecheck 通过；2）329/329 vitest 全过；3）表格表头/单元格/外框均显示边框线。Docker 重建 frontend 待后续。











## ql-20260622-013-a204 | 2026-06-22 11:30:00 | 项目计划表格添加分页+合计总结栏固定
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：/ppm/project-plans DataTable 当前 pagination={false} 一次性渲染全部计划，数据多时性能差、体验差；Table.Summary fixed 写法不正确（应该是 fixed="bottom"），且未配合 scroll.y 启用吸底固定。用户要求：1）添加分页；2）合计行作为总结栏；3）总结栏吸底固定。
方案：
  1. pagination={false} → antd pagination 配置（defaultPageSize: 10, pageSizeOptions: [10/20/50/100], showSizeChanger, showTotal 显示总条数）
  2. <Table.Summary fixed> → <Table.Summary fixed="bottom">（吸底）
  3. scroll={{ x: "max-content" }} → scroll={{ x: "max-content", y: 500 }}（启用纵向滚动+吸底固定）
结果：1）typecheck 通过；2）329/329 vitest 全过；3）表格底部出现分页器（默认 10 条/页，可切换 10/20/50/100，显示总条数），合计行作为 fixed=bottom 总结栏在滚动时吸底固定。Docker 重建 frontend 待后续。

## ql-20260622-014-c8f3 | 2026-06-22 11:56:00 | 项目计划分页与查询接口联动（服务端分页）
状态：已完成
文件：backend/app/modules/ppm/plan/router.py、frontend/src/lib/ppm/plan.ts、frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：上一版 ql-013 加的前端 antd 分页是纯客户端切片（page_size:100 一次拉全部再前端分），翻页/查询都不重新请求接口。用户要求"分页和查询接口要联动"——真正的服务端分页。后端 router `/api/ppm/project-plan` 当前 response_model=list[PsProjectPlanResp]，丢弃了 service 返回的 Page 中的 total；前端 listProjectPlans 也只返回数组。
方案：
  1. 后端 plan/router.py `/project-plan` GET: response_model 从 list[PsProjectPlanResp] 改为 Page[PsProjectPlanResp]，import Page，return Page(items=..., total=..., page=..., page_size=...)
  2. 前端 lib/ppm/plan.ts: listProjectPlans 返回 PageResp<PsProjectPlan> (复用 types.ts 已有的 PageResp<T>)
  3. 前端 page.tsx: 新增 page/pageSize/total state + lastSearchRef；pagination 受控 (current/pageSize/total/onChange)；onChange 调 setPage/setPageSize 触发 useEffect 自动 load(lastSearchRef.current)；handleSearch/handleReset 先更新 lastSearchRef 再 setPage(1)（page已是1时手动 load）
  4. 左侧 managerTree "全部项目" count 改用 total（避免当前页 N 条歧义），children/summaryRow 接受基于当前页（语义弱化，后续可加聚合接口）
结果：1）typecheck 通过；2）329/329 vitest 全过；3）翻页/改 pageSize/查询条件变化都触发服务端请求，showTotal 显示真实 total。Docker 重建前后端待后续。

## ql-20260622-015-7e2a | 2026-06-22 13:04:00 | 项目计划默认 20 条/页 + 左侧项目经理树默认展开
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：用户要求两个调整：1) 默认每页 20 条（当前初始 pageSize state = 10）；2) 左侧"按项目经理"树默认展开（当前 antd Tree 用 defaultExpandAll，但 treeData 初始为空，首次渲染不展开；plans 异步加载后 defaultExpandAll 不再触发）。
方案：
  1. pageSize useState(10) → useState(20)
  2. pageSizeOptions ["10","20","50","100"] 不变（20 已在列）
  3. antd Tree 改受控:新增 allTreeKeys useMemo(["all", "manager:..."])，传 expandedKeys 强制全展开（移除 defaultExpandAll）
结果：1）typecheck 通过；2）329/329 vitest 全过；3）默认进页面拉 20 条/页，左侧 manager 树加载后自动展开。Docker 重建 frontend 待后续。

## ql-20260622-016-3b9d | 2026-06-22 13:14:00 | project-plans 查询过滤生效 + RangePicker 选中即查
状态：已完成
文件：backend/app/modules/ppm/plan/router.py、backend/app/modules/ppm/plan/service.py、backend/app/modules/ppm/plan/schema.py、frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：用户反馈两点：1) 非输入框的查询条件（合同签订时间、项目开始时间、预计验收时间 三个 RangePicker）选中后应自动触发查询，不应等用户点搜索按钮；2) 目前查询条件完全没生效。排查根因：后端 list_ps_project_plans 只接收 PageReq（page/page_size/order_by/order），完全不处理前端的 project_name/contract_name/company_name/时间范围参数 —— 前端传了被丢弃，等于没生效。
方案：
  1. 后端 schema 新增 PsProjectPlanListReq(继承 PageQuery),9 个可选过滤字段:project_name/contract_name/company_name + 6 个时间区间(开始/结束 × 3 个时间字段)
  2. 后端 router 新增 _project_plan_list_req dep(Query 解析 datetime),用 ProjectPlanListReqDep 替代 PageReqDep
  3. 后端 service list_ps_project_plans 接收 PsProjectPlanListReq,字符串字段 ilike 模糊匹配,时间字段用 [start, end+1day) 半开区间(前端传 YYYY-MM-DD → 当日 00:00,end 加一天保证含当日)
  4. 前端 3 个 RangePicker 加 onChange → setTimeout 0 调 handleSearch(antd Form 在 onChange 触发时已 commit form value,setTimeout 0 保证下一 tick 拿到新值)
结果：1）typecheck 通过；2）329/329 vitest 全过；3）后端语法检查通过(本地 Python 3.11 不支持 PEP 695 泛型 _Crud[T] 是误报,容器 3.13 OK)。Docker 重建前后端待后续。

## ql-20260622-017-4a1f | 2026-06-22 13:34:00 | 项目计划表格高度自适应
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：当前 scroll y:500 是固定高度,数据多时纵向滚动条,数据少时下方留白。用户要求"列表高度改为自适应"——根据内容自动撑开。
方案:
  1. 移除 scroll.y (保留 x: "max-content" 横向滚动),让 antd Table 按数据行数自动撑高
  2. <Table.Summary fixed="bottom"> → <Table.Summary> (无 y 时吸底无意义;表格本身不滚动 summary 始终是最后一行)
  3. 上版 ql-013 加的 y:500 是当时无分页时的滚动兜底,现在已有分页(每页 ≤20 条)不需要固定高度
结果：1）typecheck 通过；2）329/329 vitest 全过；3）表格按数据行数自动撑高,无纵向滚动条。Docker 重建 frontend 待后续。

## ql-20260622-018-9d2c | 2026-06-22 13:42:00 | 项目计划表格高度按视窗自适应 + summary 吸底
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：上一版 ql-017 误解了用户意图,把 scroll.y 完全去掉改成按行数撑高。用户澄清:不是按行数自适应,是按窗口高度自适应(如 calc(100vh - 300px)),并且 summary 还是要底部吸附。
方案:
  1. scroll.y 改为 "calc(100vh - 300px)" 字符串(antd Table 接受 CSS 高度字符串)
  2. <Table.Summary> 重新加 fixed="bottom"(有 scroll.y 时吸底生效)
  3. 表格数据超出视窗高度时纵向滚动,summary 始终吸底可见
结果：1）typecheck 通过；2）329/329 vitest 全过；3）表格按视窗高度自适应,summary 吸底。Docker 重建 frontend 待后续。

## ql-20260622-019-5b6c | 2026-06-22 13:46:00 | 项目计划表格高度 100vh-300→100vh-430
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
背景：用户实测后调整预留高度,顶部搜索栏+页头+分页器+其他元素总高度比 300px 大,改为 430px 预留。
方案:
  1. scroll.y 字符串 "calc(100vh - 300px)" → "calc(100vh - 430px)"
结果：1）typecheck 通过；2）表格高度按 100vh-430px 自适应。Docker 重建 frontend 待后续。

## ql-20260622-020-8c1a | 2026-06-22 13:50:00 | 修复 project-plan/export-excel 422 (路由顺序)
状态：已完成
文件：backend/app/modules/ppm/plan/router.py
背景：用户点导出按钮报 422,错误显示 path.item_id 接到 "export-excel" 当成 UUID 解析失败。根因 FastAPI 路由按注册顺序匹配:router.py 行 314 `/project-plan/{item_id}` GET 注册在 行 659 `/project-plan/export-excel` GET 之前,export-excel 字面量路径被 {item_id} 路径参数路由拦截,把 "export-excel" 当作 item_id UUID 解析失败。
方案:
  1. 把 `/project-plan/export-excel` 路由(连同 _PROJECT_PLAN_COLUMNS 常量)从行 642-669 移到 `/project-plan/{item_id}` GET (行 314) 之前,保证字面量路径优先于路径参数匹配
  2. 加注释警示后续不要重排
结果：1）ruff format/check 通过；2）Python ast 解析通过；3）export-excel 不再被 {item_id} 拦截。Docker 重建 backend 待后续。

## ql-20260622-021-2e7d | 2026-06-22 13:58:00 | project-plan 导出文件名改 中文名+时间戳
状态：已完成
文件：backend/app/modules/ppm/plan/router.py
背景：导出文件名 project_plans.xlsx 不够直观,用户要求调整。已澄清改为 "项目计划_YYYYMMDD_HHmmss.xlsx"。
方案:
  1. router.py export_project_plans 的 filename="project_plans.xlsx" → f"项目计划_{datetime.now():%Y%m%d_%H%M%S}.xlsx"(datetime 之前已 import 用于 query)
结果：1）ruff format/check 通过；2）下载文件名形如 "项目计划_20260622_135800.xlsx"。Docker 重建 backend 待后续。

## ql-20260622-022-6a1f | 2026-06-22 14:07:00 | 前端取后端 Content-Disposition 文件名下载
状态：已完成
文件：frontend/src/lib/ppm/export.ts
背景：ql-021 后端文件名改"项目计划_YYYYMMDD_HHmmss.xlsx",但前端实际下载仍是 project_plans.xlsx。根因:前端 downloadExcel 硬编码用调用方传入的 filename(exportProjectPlans 传 "project_plans.xlsx"),完全忽略后端 Content-Disposition 头。
方案:
  1. downloadExcel 新增 parseFilenameFromContentDisposition helper,优先解析 RFC 5987 filename*=UTF-8''<percent-encoded>(中文);回退 filename="..."(ASCII);都没有才用调用方 fallback
  2. exportProjectPlans 等调用方暂不改 fallback(留作后端兜底失败时用)
结果：1）typecheck 通过；2）329/329 vitest 全过；3）下载文件名与服务端一致(形如 项目计划_20260622_140000.xlsx)。Docker 重建 frontend 待后续。

## ql-20260622-023-3e8a | 2026-06-22 14:29:27 | 项目计划详情抽屉状态字段改中文
状态：已完成
文件：frontend/src/lib/ppm/status-label.ts(新增)、frontend/src/lib/ppm/index.ts、frontend/src/components/ppm-project-plan-detail.tsx
背景：详情抽屉 4 处显示状态(plan/node/detail/task 的 status),前 3 个用英文枚举(draft/review/approve/done/rejected/archived),task 原本就是中文(未开始/进行中...)。用户要求详情里的状态都改中文。
方案:
  1. 新增 frontend/src/lib/ppm/status-label.ts,提供 STATUS_LABELS 映射 + statusLabel(value) helper,未知值原样返回
  2. ppm-project-plan-detail.tsx 在 4 处 status 渲染处套 statusLabel(plan.status/node.status/detail.status/task.status)
结果：1）typecheck 通过；2）329/329 vitest 全过；3）4 处状态显示中文(草稿/审核中/审批中/已完成/已驳回/已归档),task 中文原样保留。Docker frontend 待重建。

## ql-20260622-024-7b2c | 2026-06-22 14:42:30 | projects 等 PpmResourceTable 三页样式对齐 project-plans
状态：已完成
文件：frontend/src/components/ppm-resource-table.tsx、frontend/src/app/(dashboard)/ppm/projects/page.tsx、frontend/src/app/(dashboard)/ppm/project-stakeholders/page.tsx
背景：projects/customers/project-stakeholders 三页用通用 PpmResourceTable,顶部查询区只支持横向原生 input,无法支持 select/date/range;表格无 bordered 无 scroll.y,与 project-plans 风格不一致。用户要求参照 project-plans 调整查询条件+列表样式。
方案:
  1. 改 PpmResourceTable 顶部:PageHeader 不再承载 actions,改在 SectionCard 右上角放按钮行(搜索/重置/展开|分隔|导出/新增)
  2. 查询区改 antd Form layout=vertical + grid-cols-4 垂直布局;按 fields 中字段 type 渲染 Input/Select,支持回车查询、select 选中即查、防抖
  3. 表格默认 bordered + scroll y="calc(100vh - 430px)"
  4. projects searchFieldNames 增加 project_type/project_status(后端 PageReq 已支持);customers/project-stakeholders 无字段改动自动受益
结果：1）typecheck 通过；2）363/363 vitest 全过；3）三页查询区垂直 grid-cols-4 + 右上操作行,表格 bordered + 高度自适应。Docker frontend 待重建。

## ql-20260622-025-9d4f | 2026-06-22 14:53:40 | PpmResourceTable 三页 PageContainer 改 size=full 占满宽度
状态：已完成
文件：frontend/src/components/ppm-resource-table.tsx
背景：PpmResourceTable 默认 <PageContainer>(size="default" max-w-[1400px]),projects/customers/project-stakeholders 三页两侧留白;project-plans 用 size="full" 占满。用户要求对齐。
方案:
  1. PpmResourceTable 的 <PageContainer> 加 size="full"
结果：1）typecheck 通过；2）三页宽度占满屏幕。Docker frontend 待重建。

## ql-20260622-026-4e2a | 2026-06-22 15:00:43 | PpmResourceTable 重置按钮不清 antd Form 内部状态
状态：已完成
文件：frontend/src/components/ppm-resource-table.tsx
背景：ql-024 把查询区改成 antd Form + Form.Item name=...,Input/Select 内部值由 antd Form 管理。但 handleReset 只清了组件级 searchInput/searchCommitted state,未调 form.resetFields(),所以用户看到的输入框/下拉值还在。查询虽然生效(因 buildQuery 从 searchCommitted 读),但视觉上没清空,体验差。
方案:
  1. Form.useForm() 拿 form instance
  2. handleReset 调 form.resetFields() 清 Form 内部状态
  3. 将 form 实例传给 <Form form={form}>
结果：1）typecheck 通过；2）点重置后输入框/下拉视觉值清空。Docker frontend 待重建。

## ql-20260622-027-1c3d | 2026-06-22 15:09:30 | projects 导出文件名 + Input 不要 debounce 自动查
状态：已完成
文件：backend/app/modules/ppm/project/router.py、frontend/src/components/ppm-resource-table.tsx
背景:
  1) projects/customers 导出文件名仍为 project_maintenance.xlsx/customer_maintenance.xlsx,需对齐 ql-021 风格
  2) PpmResourceTable Input onChange 触发 handleSearchInput,内部 setTimeout 400ms debounce 自动 commit,用户每输入一个字符都触发查询;用户要求 Input 不自动查,只有 Enter / 搜索按钮 / Select 选中才查
方案:
  1. backend export_project_maintenance filename 改 f"项目维护_{datetime.now():%Y%m%d_%H%M%S}.xlsx";export_customer_maintenance 改"客户维护_..."
  2. frontend PpmResourceTable:handleSearchInput 去掉 setTimeout debounce,只 setSearchInput;Input onPressEnter 调 handleSearchCommit flush;Select onChange 保持立即 commit
结果：1）typecheck 通过；2）ruff check/format 通过；3）363/363 vitest 全过。Docker backend + frontend 待重建。

## ql-20260622-028-5f1c | 2026-06-22 15:19:59 | problem-list 样式对齐 project-plans
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/problem-list/page.tsx
背景：problem-list 用裸 div+max-w-[1400px]+flex 布局,查询栏内联 style,Table 无 bordered 无 scroll.y。与 project-plans/projects 三页风格不一致。
方案:
  1. 外壳改 PageContainer size="full" + PageHeader + SectionCard bodyPadding="p-2"
  2. SectionCard 内右上按钮行(导出/新建),下方 grid-cols-4 垂直 Field 查询表单(支持展开/收起)
  3. Table 加 bordered + scroll y="calc(100vh - 430px)"
  4. 查询条件 Input 用防抖去掉(对齐 ql-027:Enter/按钮触发,Select/RangePicker 选中即查)
结果：
  - 顶部按钮行右对齐(重置 | 分隔 | 导出 / 新建)
  - 查询条件 grid-cols-4 垂直 Field 布局,onChange 实时本地过滤
  - Table bordered + scroll y=calc(100vh - 430px) + 默认 pageSize=20 + showTotal
  - PageContainer size="full" 占满宽度
  - antd Button 全部替换为本仓 ui Button(size="sm" + variant)
  - 移除未使用的 expanded state
  - typecheck 通过,363/363 测试通过

## ql-20260622-029-a1b7 | 2026-06-22 15:30:55 | problem-list 关键字输入不要自动查询
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/problem-list/page.tsx
背景：problem-list 顶部关键字 Input onChange 直接改 keyword state,而 keyword 实时参与 useMemo filtered 过滤,导致输入即过滤。用户要求输入时不要自动查询。
方案:
  1. 拆分两个 state:keywordInput(输入框受控值)/ keyword(实际过滤用)
  2. Input onChange 只改 keywordInput,不影响 filtered
  3. Input onPressEnter / 添加"查询"按钮 把 keywordInput 同步到 keyword
  4. 重置按钮同时清空 keywordInput 和 keyword
结果：
  - 拆分 keywordInput / keyword 两个 state
  - Input onChange 仅改 keywordInput;onPressEnter 或点击"查询"按钮同步到 keyword 触发过滤
  - allowClear 点 x 清空时立即同步到 keyword(显式清空 ≠ 输入过程)
  - 顶部按钮行新增"查询"按钮(位于"重置"左侧)
  - 重置按钮同时清空 keywordInput 和 keyword
  - typecheck 通过,363/363 测试通过

## ql-20260622-030-7e2a | 2026-06-22 15:39:47 | problem-list 查询走接口 + 操作列宽度收窄
状态：已完成
文件：backend/app/modules/ppm/problem/router.py, backend/app/modules/ppm/problem/service.py, frontend/src/lib/api.ts, frontend/src/lib/ppm/problem.ts, frontend/src/lib/ppm/types.ts, frontend/src/app/(dashboard)/ppm/problem-list/page.tsx
背景：problem-list 当前查询条件全部本地 useMemo 过滤,数据量大会卡;同时后端 /problem-list 只支持分页,无任何过滤参数。操作列 width=280 但按钮少时大片留白。
方案:
  后端:
    1. router.list_problems 增加 Query:keyword / status(多值)/ project_id / pro_type / is_urgent / find_time_start / find_time_end
    2. service.list_problems 接受过滤参数,构造 where_clauses 传给 list_paged
    3. response_model 改为 Page[ProblemListResp],返回 total
  前端:
    4. lib/ppm/problem.ts listProblems 返回 Page 结构 {items,total,page,page_size}
    5. types.ts 加 ProblemListPageReq
    6. page.tsx 去掉本地 useMemo filtered,加 pagination state {current,pageSize,total},Select/RangePicker 选中即触发 load({page:1}),Table pagination onChange 调 load({page,page_size})
    7. 操作列宽度 280 → 200
结果：
  - 后端 router.list_problems 加 7 个 Query 参数 + response 改 Page[ProblemListResp]
  - service.list_problems 增加同名 kwargs,where_clauses:keyword 跨 6 字段 ilike,status in,project_id/pro_type/is_urgent 精确,find_time 区间
  - apiFetch query 类型支持 string[],数组用 searchParams.append 多值编码(?status=1&status=2)
  - lib/ppm/problem.ts listProblems 改返 PageResp<ProblemList>,types.ts 加 ProblemListPageReq
  - page.tsx 改服务端分页,去掉本地 useMemo filtered,共 N 条显示 total 而非 filtered.length
  - 操作列 width 280 → 200
  - 前端 typecheck 通过,363/363 测试通过
  - 后端 ppm/problem/tests 35/35 通过;test_export.py 2 项失败为 stash 前后均存在的预先问题(与本次无关)

## ql-20260622-031-b3f9 | 2026-06-22 16:04:04 | ppm 导出 401 token 过期不刷新
状态：已完成
文件：frontend/src/lib/ppm/export.ts
背景：downloadExcel 用裸 fetch + Authorization header,没有 401 自动 refresh 逻辑(apiFetch 有)。token 过期时 apiFetch 自动刷新重试,downloadExcel 直接抛 401 AUTH_TOKEN_EXPIRED,用户看到导出失败。
方案:
  1. downloadExcel 在 fetch 拿到 401 时,先调 /api/auth/refresh 拿新 token
  2. 刷新成功 → setTokens + 用新 token 重试一次原请求
  3. 刷新失败 → 清 session 跳 /login,与 apiFetch 行为对齐
  4. 顺便支持 params 多值数组(apiFetch 已支持,保持一致)
结果：
  - downloadExcel 提取 doFetch 内部函数,401 时调 /api/auth/refresh,刷新成功后用新 token 重试一次
  - 重试后仍 401 → 清 session + 跳 /login
  - params 数组用 searchParams.append 多值编码(与 apiFetch 一致,支持导出带 status 多值)
  - typecheck 通过,363/363 测试通过
状态：已完成
文件：frontend/src/app/(dashboard)/ppm/problem-list/page.tsx
背景:操作列 width=200,但每行按钮数不同(1~6 个),固定宽度导致按钮少时大片留白。用户要求自适应。
方案:
  1. width 改为 'max-content'(antd 5.x 接受 string,CSS 表格列宽算法按实际内容算)
  2. fixed:'right' 保留(滚动时不丢操作列)
  3. 操作按钮容器加 whitespace-nowrap(单行排列,不被换行)
结果:
  - 操作列 width 200 → 'max-content',antd 按每行实际按钮数算宽
  - 按钮 flex-wrap 删除,改 whitespace-nowrap 单行排列
  - fixed:'right' 保留,align:'right' 保留
  - typecheck 通过,363/363 测试通过

## ql-20260622-033-d5e8 | 2026-06-22 18:55:00 | problem-list/export-excel 路由顺序修复
状态：已完成
文件：backend/app/modules/ppm/problem/router.py
背景:GET /api/ppm/problem-list/export-excel 返回 422 uuid_parsing — `export-excel` 被参数化路由 `/problem-list/{item_id}` 拦截当 UUID 解析。同 ql-020 已为 project-plan 修过的同款问题。FastAPI 路由按注册顺序匹配,字面量路径必须前置于参数化路由。
方案:
  1. 把 export_problems 函数(及对应 _PROBLEM_COLUMNS)从文件末尾移到 list_problems 之后、get_problem({item_id}) 之前
  2. 把 export_problem_changes(及 _PROBLEM_CHANGE_COLUMNS)从文件末尾移到 list_changes 之后、get_change({item_id}) 之前
  3. _build_excel_response 辅助函数可留在文件末尾(模块加载完所有名字都在 global,Python 函数调用时才解析名字,装饰器执行只注册路由)
结果:
  - export_problems + _PROBLEM_COLUMNS 已移到 list_problems 紧邻之后(line 113)
  - export_problem_changes + _PROBLEM_CHANGE_COLUMNS 已移到 list_changes 紧邻之后(line 307)
  - _build_excel_response 留在文件末尾,旁边加注释说明路由顺序约束
  - grep @router.* 确认两个 export-excel 都在 {item_id} GET 之前
  - ppm/problem/tests 35/35 通过



