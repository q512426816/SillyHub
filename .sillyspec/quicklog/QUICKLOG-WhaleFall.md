---
author: WhaleFall
created_at: 2026-06-24T19:19:38
---

<!-- 本文件从空开始。ql-ID 续号规则：扫描同目录所有 QUICKLOG*.md 文件，
     取当天(YYYYMMDD)最大序号 +1。归档历史见 QUICKLOG-WhaleFall-<DATE>.md。 -->

## ql-20260624-011-b8f2 | 2026-06-24 19:34:11 | 项目计划新增/编辑选中项目后带出公司名+项目经理唯一时自动带入
状态：已完成
文件：frontend/src/components/ppm-project-plan-form.tsx
需求：项目计划[新增、编辑]时，选中项目后①带出公司名称；②如果该项目只有 1 个项目经理，自动带入项目经理。
现状:onProjectChange 试图回填 company_name,但依赖 listSimpleProjects 的 raw,而 simple-list 只返回 {id,project_name} 无 company_name → 公司名带出本就不工作;项目经理无论几个都清空。
方案:onProjectChange 改 async,选中项目后 Promise.all 并行查 getProject(id)(拿 company_name)+ listProjectMembers({pm_project_id,role_name:项目经理})(拿项目经理);company_name 回填,members.length===1 时带入 project_manager_id+name。
结果:① import 补 getProject + listProjectMembers;② onProjectChange 改 async,先同步重置 project_name/company_name/项目经理 清掉旧值,id 非空时 Promise.all 并行查项目详情(含 company_name)+ 项目经理,公司名回填、唯一项目经理自动带入 project_manager_id+name,查询失败静默不阻断选项目。raw 类型去掉无用 company_name。managers[0] 加 if(m) 判空适配 noUncheckedIndexedAccess。typecheck + 单文件 eslint exit 0 + 480 tests 全过无回归。后端无改动(ilike 过滤复用 ql-010)。Docker frontend 待重建部署。

## ql-20260625-001-7a3c | 2026-06-25 14:05:00 | 参考 ppm/project-plans 样式调整 admin/users 页面（布局+查询条件+列表）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
需求：参考 http://127.0.0.1:3000/ppm/project-plans 的样式，调整 http://127.0.0.1:3000/admin/users 的【查询条件、列表、布局】。
现状:admin/users 用裸 div max-w-7xl + 裸 input/select/按钮 flex-wrap + 裸 antd Table，与 project-plans 的 PageContainer/PageHeader/SectionCard/grid-cols-4 Field/DataTable 模式不一致。
方案:①布局裸div→PageContainer(size full)+PageHeader(用户管理);②查询→SectionCard 包裹;③列表裸Table→DataTable(bordered+emptyText)。逻辑 load/handlers/columns/Drawer 不变。
结果:commit 8e86679b。第一版用 SectionCard+SearchBar+SearchBarActions(横向)+无列表高度,用户反馈"搜索条件布局/新建按钮位置/列表高度"三处不对 → 见 ql-20260625-002 修正。typecheck/lint/48 passed 全过,rebuild frontend healthy。

## ql-20260625-002-7a3c | 2026-06-25 14:20:00 | 修正 admin/users 对齐偏差（顶部按钮行 + Field 表单 + 列表高度）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
需求：用户反馈 ql-001 三处偏差:①搜索条件布局和 project-plans 完全不一样;②新建用户按钮位置不对;③列表高度没设定。
现状:ql-001 用横向 SearchBar(控件左+按钮 SearchBarActions 右)、列表 scroll 无 y。
方案（精确复刻 project-plans 结构）:①查询区改 SectionCard 内顶部操作按钮行(搜索/重置/分隔/+新建用户,justify-end 右对齐)+ grid-cols-4 垂直 Field 表单;②控件原生 input/select → antd Input/Select,关键词保留 debounce + 搜索按钮/回车(onPressEnter);③新建按钮移到顶部按钮行右端;④列表 scroll.y=calc(100vh - 430px);⑤加文件内 Field 组件(垂直 label)+ handleSearchClick/handleResetClick;⑥去掉冗余顶部"共N"(分页 showTotal 已有)。
结果:commit ca9e99c6。typecheck no errors、lint 无 page.tsx 相关、rebuild frontend healthy。注:ql-001/ql-002 错误地走了 sillyspec run quick --change default 记到 default/tasks.md,实际应记 QUICKLOG-WhaleFall.md(本次补记,5e8516d5 后续补记 commit)。

## ql-20260625-003-9e2f | 2026-06-25 14:50:49 | admin/users 搜索改纯受控（输入不查询，点搜索/回车才查）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
需求：①搜索按钮点击即查询，去多余逻辑；②关键词输入框输入不自动查询，手动点搜索/回车才触发。
现状:handleSearchInput 有 debounce 400ms 自动 setSearch；handleSearchClick/handleResetClick 带 debounceRef.current clearTimeout。
方案:handleSearchInput 只 setSearchInput(去 debounce)；handleSearchClick=setSearch(searchInput)+setPage(1)；handleResetClick 同步清空；去 debounceRef+useRef import(若不再用)。状态 Select onChange 即筛保留。
结果:①import 去 useRef；②删 debounceRef 声明；③handleSearchInput 只 setSearchInput；④handleSearchClick/ResetClick 去 clearTimeout。查询改为输入纯受控 + 搜索按钮/回车(onPressEnter)触发，状态 Select 即筛保留。typecheck no errors、lint 无 page.tsx 相关。

## ql-20260625-004-b51a | 2026-06-25 15:10:00 | admin/users 搜索按钮强制查询（条件不变也刷新）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
需求：即使查询条件没变，点击搜索也查询。
根因:ql-003 后 handleSearchClick 只 setSearch(searchInput)+setPage(1)，load=useCallback([search,statusFilter,page,pageSize])+useEffect([load])，条件不变→state 不变→load 不重建→useEffect 不触发→不查询。
方案:handleSearchClick 加 noChange 判断(searchInput===search && page===1)，条件没变时手动 void load() 强制刷新；变了则 setSearch/setPage 自然触发 useEffect。
结果:handleSearchClick 加 noChange(searchInput===search && page===1) 判断 + 不变时 void load() 强制刷新。typecheck no errors。

## ql-20260625-005-c4d8 | 2026-06-25 15:25:00 | admin/roles 按用户页最终模式调整（布局+查询+列表+搜索行为）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx
需求：admin/roles 按 admin/users 最终模式(ql-001~004)调整。
现状:裸 div max-w-6xl + 裸 input+debounce useEffect(500ms) + 右侧共N/新建 + 裸 antd Table。
方案:①裸div→PageContainer(size full)+PageHeader(角色管理/平台角色与权限管理);②查询→SectionCard(p-2)内顶部按钮行(搜索/重置/分隔/+新建角色 justify-end)+grid-cols-4 Field(关键词 Input);③搜索行为对齐 ql-003/004(去 debounce,纯受控,handleSearchClick noChange 强制 load,回车触发);④裸Table→DataTable(bordered+emptyText+scroll y calc(100vh-430px))。复用 Field 组件定义。子组件 RoleDrawer/DeleteConfirm/RoleUsersDrawer 不变。
结果:5处 Edit 完成(布局/查询/列表/搜索行为全对齐 admin/users)。typecheck no errors、lint 无 roles/page 相关。子组件未动。

## ql-20260625-006-3d7e | 2026-06-25 19:55:00 | admin/users 左侧组织树加宽 + 节点文字截断修复
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx + frontend/src/components/admin-org-tree.tsx
需求：组织树太窄(w-56)，公司名长/多层时文字超出溢出。
方案：①aside w-56→w-64 加宽；②orgNodeTitle name span +min-w-0 flex-1(flex 里 truncate 生效不挤 count)；③count span +shrink-0(不被挤)。
结果:typecheck no errors。组织名长时 truncate 省略，人数不被挤压。

## ql-20260625-007-2c5f | 2026-06-25 20:18:00 | admin/users 组织树纵向滚动条 + 展开/收起交互
状态：已完成
文件：frontend/src/components/admin-org-tree.tsx
需求：组织多/多层时树纵向溢出页面（需滚动条）；节点不能展开/收起（expandedKeys 固定全展开无 onExpand）。
方案：①expandedKeys 改 state（受控，初始全展开，用户可点箭头折叠/展开）+ onExpand 回调；②Tree 外层 div maxHeight calc(100vh-200px) + overflow-y-auto 纵向滚动；③Tailwind max-h-[calc()] 方括号与 jsdom CSS selector 冲突，改 inline style。
结果:commit 449d74ce。vitest 8 passed、typecheck no errors、rebuild frontend healthy。
注：本次未走 sillyspec run quick 流程（直接改+commit），quicklog 补记。

## ql-20260626-002-7d2a | 2026-06-26 10:06:57 | scan-docs 文档树增加最大高度+内部滚动
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
需求：扫描文档页（/workspaces/[id]/scan-docs）左侧文档树无高度限制，文档多时撑长页面。增加最大高度（一屏可显示），超出滚动条。参考 admin/users 表格高度做法。
现状:scan-docs/page.tsx 文档树 SectionCard(title=文档树 bodyPadding=p-2)内直接渲染 <TreeView>，无任何高度限制。
方案:TreeView 外层包 <div className="max-h-[calc(100vh-220px)] overflow-auto">。偏移 220px = TopBar h-14(56) + PageContainer py-6(24×2) + PageHeader 两行标题(55) + gap-4(16) + SectionCard header(40)，参考 admin/users 表格 scroll.y=calc(100vh-430px) 思路（admin 偏移大因表格上方还有筛选表单+操作行+分页）。不动 SectionCard 组件本身，只改用法。
结果:commit 2fc490c3。typecheck no errors、lint 无 page.tsx 相关（仅已有 warning）、提交 hook lint+typecheck+test 全过、rebuild frontend healthy、grep 确认 "100vh-220px" 已编译进 /app/.next/server/.../scan-docs/page.js。后端无改动。frontend_app 模块文档同步追加该样式约定。
注：本次错误走了 sillyspec run quick --change（项目有多个活跃 change + CLI 预生成 change 目录，skill 要求多变更带 --change），记录误入 changes/tasks.md。实际应记本文件（同 ql-20260625-002 坑）。本次补记，并删除该 change 目录回归 quicklog。

## ql-20260626-003-e8a1 | 2026-06-26 10:32:05 | 修复 agent run logs 500（agent_run_logs.dedup_key schema 漂移）
状态：已完成
文件：（无代码改动；DB schema hotfix）
需求：GET /api/workspaces/{id}/agent/runs/{rid}/logs 返回 500 Internal Server Error。
根因：schema 漂移。migration 202606241300_add_agent_run_log_dedup_key 存在且正确（加 dedup_key 列 + 部分唯一索引 ux_agent_run_logs_dedup），DB alembic_version=202606251900（在 241300 之后），alembic 认定 241300 已执行 → upgrade head 不会重跑；但 agent_run_logs 表实际无 dedup_key 列、无该索引（某次 DB 被推进到 head 时 241300 的 DDL 未真正落地）。ORM AgentRunLog 查 dedup_key → asyncpg UndefinedColumnError → 500。调用链 router.py:398 get_agent_run_logs → service.py:704 get_run_logs。
修复：直接补 DDL（幂等）—— ALTER TABLE agent_run_logs ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(200)；CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_run_logs_dedup ON agent_run_logs(run_id,dedup_key) WHERE dedup_key IS NOT NULL。对现有数据零影响（新列 NULL、部分索引不约束旧行）。
验证：① DB 列+索引已落地（information_schema.columns + pg_indexes 确认）；② 复现 service.get_run_logs 的 SELECT 不再报错（count 0）；③ 全表 ORM-vs-DB 列对比（63 ORM 表 vs 66 DB 表）漂移数=0，dedup_key 是唯一缺失且已补，无其他遗漏。未改代码/未 rebuild 镜像（migration 文件本就正确，DB 已直接修复）。
注：alembic upgrade head 不重跑已标记完成的旧 migration，遇类似漂移需直接补 DDL 或 alembic stamp 回退后重跑。本次为运维 hotfix，无代码 commit。

## ql-20260630-001-a1b2 | 2026-06-30 09:38:40 | runtimes allowed_roots 沙箱（完整变更 + 3 修复 + 部署）
状态：已完成（3 commit 本地，push 待 GitHub 网络 port 443 连不上）
文件：backend/daemon/model.py+router.py+runtime/service.py+schema.py+service.py+migration 202606291030；sillyhub-daemon/src/daemon.ts+config.ts+permission-rules.ts+adapters/stream-json.ts+task-runner.ts+adapters/protocol-adapter.ts+interactive/session-manager.ts+interactive/write-guard.ts+cli.ts；frontend/src/app/(dashboard)/runtimes/page.tsx+lib/daemon.ts；backend/app/modules/agent/execution.py
需求：/runtimes 页面查看并配置 daemon 守护进程可访问目录（allowed_roots 沙箱）。Agent 团队 CC 写 D:/ 不受限 + cwd 空 mirror + permission allow 不含 F:/。
排查 + 修复（3 个 bug，跨 runtimes allowed_roots 完整变更 SillySpec brainstorm→execute）：
1. permission allow 不含 F:/：根因——claude/hermes 两 runtime allowed_roots 不同（claude=[~/.sillyhub,F:/]，hermes=[~/.sillyhub]），_syncAllowedRoots 单 runtime 覆盖全局 config → hermes 心跳覆盖丢 F:/ 振荡。修——per-runtime map + 并集（daemon 一台机器一个沙箱，所有 runtime allowed_roots 取并集）。
2. interactive CC 写不受限：根因——interactive（/runtimes 对话/quick-chat 走 claude-sdk-driver）没 permission 注入（只 batch stream-json --settings）。SDK(claude-agent-sdk)不支持 settings JSON。修——write-guard.ts(isWriteWithinAllowedRoots 纯函数,写工具校验 file_path 在 allowed_roots 内,读自由) + session-manager _wrapWithWriteGuard(canUseTool 前置写校验,白名单内 allow/外 deny,默认 chat 也注入不只 enableApproval) + cli allowedRootsProvider。
3. Agent 团队 cwd 空 mirror：根因——dispatch_worker(mission Wave3 execution.py:112)调 dispatch_to_daemon 没传 root_path → lease.metadata 无 root_path → daemon prepareWorkspace 分支0 无 rootPath → fallback 空 mirror(C:\\Users\\12532\\.sillyhub\\daemon\\workspaces\\default) → CC 在空目录找不到代码(沙箱锁定)。修——从 workspace 取 root_path + resolve_root_path_for_daemon 改写容器→宿主机,传给 dispatch_to_daemon。
完整变更（runtimes allowed_roots，SillySpec change 2026-06-29-runtime-allowed-roots-config）：backend daemon_runtimes+allowed_roots(JSONB 默认 ["~/.sillyhub"])+migration 202606291030+PUT /runtimes/{id}/allowed-roots(admin+路径校验)+心跳响应带 allowed_roots；daemon _syncAllowedRoots(心跳拉取同步本地 config,展开 ~/.sillyhub+合并 homedir)；CC permission 注入 batch(stream-json --settings buildCcSettingsJson allow Write 白名单+deny Write(**)+读自由)+interactive(canUseTool 写守卫)；frontend /runtimes RuntimeCard allowed_roots 展示+admin 编辑 Modal(多路径增删)。
commit：13403c71(feat runtimes allowed_roots 完整变更) + d3153988(fix interactive 写守卫+多 runtime 并集) + a3a2dc3d(fix Worker root_path 透传)。
测试：backend daemon pytest 415p(3 既存 session SSE failed 无关)/sillyhub-daemon vitest 1514p(含 permission-rules 7p+session-manager-allowed-roots 16p)/frontend typecheck+18 runtimes 测试。部署：backend rebuild a3a2dc3d + daemon pnpm bundle + 重启(allowed_roots_synced count=3 含 F:/)。全栈 healthy。
注：CC permission 验证——claude --help 确认 --settings+Tool(spec) 格式(Write(path/**))+--disallowedTools；SDK(sdk.d.ts)确认 disallowedTools/permissionMode/canUseTool 但无 settings JSON → interactive 用 canUseTool 回调。Codex provider 写拦截未实现(走 sessionPermission 非 canUseTool)。Bash 间接写文件不拦(读自由语义)。push 待 GitHub 网络。

## ql-20260701-001-7a1c | 2026-07-01 09:10:18 | spec-workspace import 错误码语义透传（daemon 离线不再误报 502）
状态：已完成
文件：backend/app/modules/spec_workspace/service.py + backend/app/modules/spec_workspace/tests/test_import.py
需求：POST /api/workspaces/{id}/spec-workspace/import 返回 502 SPEC_IMPORT_RPC_FAILED "daemon runtime offline"，排查并修正。
现状：根因=环境问题。workspace 8f8a1d7f 绑定的 claude runtime 462d0e85 当前 offline（最后心跳 2026-06-30 17:49，全部 2 个 runtime 均 offline）；root_path=F:\WorkNew\SillyHub 是宿主机路径，容器读不到，daemon-client 必须 daemon 在线才能打包 .sillyspec，import 失败本身正确。代码缺陷：import_from_repo 用 except Exception 把 DaemonRuntimeOffline(504)/DaemonRpcTimeout(504)/DaemonRpcConflict(409)/DaemonRpcRemoteError(403|502) 全吞成 502 SPEC_IMPORT_RPC_FAILED，破坏既有错误码体系，前端无法区分 daemon 离线 vs 真 RPC 失败。
方案：import_from_repo except 链拆分——DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcConflict 直接 raise(504/504/409)；DaemonRpcRemoteError re-map(forbidden→403 HTTP_403_DAEMON_RPC_FORBIDDEN / 其他→502 HTTP_502_DAEMON_RPC_REMOTE)；其余兜底 502 SPEC_IMPORT_RPC_FAILED。前端只显 err.message 不依赖 code，改 code 安全。
结果：新增 test_import.py 4 测试(offline→504/remote→502/forbidden→403/正常→200)，spec_workspace 全模块 37 测试全过，ruff 通过。daemon 离线时用户需启动 daemon（物理限制：容器读不到宿主机 .sillyspec）。注：sillyspec run quick --done 不持久化 step 进度（progress.json quick.steps 始终 pending，每次 --done 重置到 step1），疑似 CLI 缺陷。

## ql-20260701-002-b3e4 | 2026-07-01 09:43:51 | spec-workspace import 卡死 500（daemon get_spec_bundle 打包 2G .runtime/worktrees）
状态：已完成
文件：sillyhub-daemon/src/spec-sync.ts + sillyhub-daemon/src/daemon.ts + sillyhub-daemon/tests/spec-sync.test.ts
需求：POST spec-workspace/import 返回 500（点击导入报错）。
现状：根因=daemon get_spec_bundle(packSpecDir) 打包项目 .sillyspec 整树含 .runtime/worktrees（2.1G/117787 文件），卡满 60s RPC timeout→backend HTTP_504_DAEMON_RPC_TIMEOUT→Next.js proxy 500。daemon 现已 online（心跳11s）故 TIMEOUT 非 OFFLINE（ql-001 的 OFFLINE 场景已不适用）。packSpecDir 按注释包含 .runtime（task-06 D-003 push 路径），但 get_spec_bundle（import 项目源）不该含 .runtime（项目 runtime cache 含 worktrees，可达 GB，非 spec 数据）。
方案：spec-sync.ts packSpecDir 加 opts.excludeRuntime 参数（默认 false，postSpecSync 回灌保持含 .runtime）；daemon.ts get_spec_bundle 调 packSpecDir(specDir,{excludeRuntime:true}) 排除 .runtime（与 backend build_bundle 排除 .runtime 对称）。tests/spec-sync.test.ts 加 excludeRuntime 排除测试。
结果：vitest spec-sync 7 过（含新增 excludeRuntime）。tsc --noEmit 仅 pre-existing build-id.ts 缺失（bundle 生成）。daemon 改动需用户重新 bundle + 重启本机 daemon 生效（用户本机 daemon 仍跑旧代码）；backend 镜像 rebuild 后容器内 daemon + 分发为新代码。


