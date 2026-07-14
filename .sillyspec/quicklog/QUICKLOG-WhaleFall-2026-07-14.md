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

## ql-20260701-003-c2d5 | 2026-07-01 10:11:43 | spec-workspace import 数据已导入但 frontend proxy ECONNRESET 500（daemon 打包 changes 12M 慢）
状态：已完成
文件：sillyhub-daemon/src/spec-sync.ts + sillyhub-daemon/src/daemon.ts + sillyhub-daemon/tests/spec-sync.test.ts
需求：重启 daemon 后 POST spec-workspace/import 仍报 500。
现状：根因=walkDir 无剪枝——packSpecDir 排除 .runtime 后仍在循环里 filter（只省 tar 写入不省遍历），仍递归 stat .runtime(2G worktrees)+changes(万级文件)。实测打包 16.8s/11.4M(排除.runtime 后)+WS传1.3M+reparse2.7s≈22s>frontend Next.js 14.2.5 rewrite proxy 超时→socket hang up ECONNRESET 500。但 backend 业务成功(spec_workspace.import_from_repo info，205 文档已导入，tar_bytes=11977728)。backend 无 OOM(0restart/25%mem)。reparse 只读 docs(实测2.7s/205文档)，不读 changes。
方案：packSpecDir 加 opts.excludeNames(顶层目录黑名单)+ walkDir 加 pruneTop 剪枝(排除目录不递归，避免遍历)；get_spec_bundle 传 excludeRuntime:true + excludeNames:['changes']（changes 是 SillySpec 流程档案，reparse 不读，非 spec 数据）。postSpecSync 不传 exclude 保持含 .runtime 回灌。
结果：剪枝后打包 16.8s→0.0s(1.3M，实测)。vitest spec-sync 8 过。tsc build 过。import 总耗时预计<5s，根治 proxy 超时。daemon 需用户重启本机 daemon(preflight 自更新)生效。

## ql-20260701-004-9e2a | 2026-07-01 14:24:58 | 变更中心页去掉 workspace tab + 查询区按 admin/roles 调整
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx + frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
需求：/workspaces/{id}/changes 页去掉顶部【概览/组件/变更/成员】tab，页面按 /admin/roles 样式调整。
现状：tab 来自 layout.tsx 的 WorkspaceTabs(所有 workspace 子页共享)；changes 页查询在 PageHeader actions(裸 input/select 横向)，DataTable 无 bordered/scroll.y。
方案：layout 改 client(usePathname)，changes 路径隐藏 WorkspaceTabs(其他页保留)；changes 页 PageHeader actions 只留 +新建变更/重新扫描，查询(关键词/阶段)移到列表 SectionCard 内 grid-cols-4 Field(antd Input/Select 垂直)，DataTable 加 bordered+scroll.y calc(100vh-430px)。保留 changes 业务(进行中/已归档 tab + 即时 filter + 生命周期图)。
结果：typecheck 0 error，eslint 无 warning。rebuild frontend 后生效（用户硬刷新浏览器）。随后又把进行中/已归档 tab 从查询区右上角移到 DataTable 上方左侧。

## ql-20260701-005-a1b2 | 2026-07-01 15:08:00 | 变更中心 DataTable 改后端分页查询
状态：已完成
文件：backend/app/modules/change/service.py + backend/app/modules/change/router.py + frontend/src/lib/changes.ts + frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
需求：变更中心的 table 改为分页查询（与 admin/roles 一致）。
现状：前端即时 filter（无分页，pagination=false），一次拉全量数据。
方案：backend list_ 加 search/page/page_size 参数（ILIKE 搜索 change_key/title，OFFSET/LIMIT 分页，func.count 返回 total）；router 加 Query 参数；前端 listChanges 加对应参数；changes 页 state 加 searchInput/search/items/total/page/pageSize，搜索改受控（搜索/重置按钮触发），DataTable pagination 用后端 total，tab 去计数。
结果：typecheck 0 error，ruff check+format 过。backend+frontend rebuild healthy。随后变更生命周期移到查询条件上方；layout 对 changes 路径返回 fragment（无 main wrapper），DOM 与 admin/roles 完全一致，宽度统一。列表 Link 加 prefetch={false} 避免 Next.js RSC 批量预取（每行 change 进入视口触发 ?_rsc 请求，20 条→20 个请求）。

## ql-20260702-001-d4e5 | 2026-07-02 08:47:15 | 变更中心【阶段】筛选没生效（改后端分页时漏了）
状态：已完成
文件：backend/app/modules/change/service.py + backend/app/modules/change/router.py + frontend/src/lib/changes.ts + frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
需求：查询条件【阶段】没生效。
现状：ql-005 改后端分页时，stageFilter 仍为前端 state 但 dataSource 用后端 items（不经前端 filter），所以 stage 筛选完全无效。
方案：backend list_ 加 current_stage 参数（WHERE current_stage=?）；router 加 current_stage Query；前端 listChanges 加 currentStage；changes 页 load 传 currentStage:stageFilter，useCallback 依赖加 stageFilter（Select onChange 即时触发后端查询）。
结果：typecheck 过，ruff 过。Select 选阶段即时触发后端分页查询。

## ql-20260702-002-e6f7 | 2026-07-02 09:09:05 | 导入的 change current_stage 全空（reparse 不推断 stage）
状态：已完成
文件：backend/app/modules/change/parser.py + backend/app/modules/change/service.py
需求：扫描到的 change 数据 current_stage 都是空的。
现状：current_stage 权威源是 sillyspec.db（SillySpec CLI 本地 SQLite），但 .runtime 被导入排除（ql-002，worktrees 2G）→ 平台读不到。reparse 只解析文件系统不读 sillyspec.db，dispatch 才同步 current_stage（但导入的 change 没经 dispatch）。
方案：parser ParsedChange 加 current_stage 字段 + _parse_change 从 change 目录文档存在性推断 stage（archive→archive / verify-result.md→verify / plan.md+tasks→plan / proposal+design→propose / 否则 scan）；service _apply_parsed 同步 parsed.current_stage 到 Change row。
结果：ruff+mypy 过。用户需点「重新扫描」触发 reparse 填充。推断是 fallback（非权威，精确 stage 仍需 sillyspec.db）。

## ql-20260702-003-a3b4 | 2026-07-02 09:15:00 | 阶段推断 propose 改 brainstorm
状态：已完成
文件：backend/app/modules/change/parser.py
需求：阶段还有 propose（SillySpec 主线无此 stage）。
方案：_infer_current_stage 有 proposal.md/design.md 时返回 brainstorm（不是 propose）。SillySpec 主线 scan→brainstorm→plan→execute→verify→archive。
结果：ruff 过。用户重新扫描后 propose 全变 brainstorm。

## ql-20260702-004-b5c6 | 2026-07-02 09:22:00 | 解析警告改中文
状态：已完成
文件：backend/app/modules/change/parser.py + frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
需求：reparse 返回的解析警告 detail 全英文，改中文。
方案：parser.py 5 处 ParseWarning detail 改中文（LEGACY_CHANGE_DIR/PATH_TRAVERSAL/LEGACY_CHANGE_PATH/LEGACY_FILENAME）；前端「个 warning」改「个警告」。
结果：ruff+typecheck 过。

## ql-20260702-005-c7d8 | 2026-07-02 09:30:00 | /runtimes 「可访问目录」改「可写目录」
状态：已完成
文件：frontend/src/app/(dashboard)/runtimes/page.tsx
需求：allowed_roots 实际是写白名单（读取不受限），UI 名称「可访问目录」误导，改「可写目录」。
方案：runtimes/page.tsx 全部「可访问目录」→「可写目录」（标签/按钮/tooltip/Modal 标题/描述/notify/aria-label/空态），Modal 描述明确「读取不受限，仅白名单内可写」。
结果：typecheck 过。（安全 bug：D 盘能写 不在 allowed_roots——需排查 daemon write-guard，另案处理。）

## ql-20260702-006-e8f9 | 2026-07-02 10:11:00 | 安全修复：Bash 间接写绕过 write-guard
状态：已完成
文件：sillyhub-daemon/src/interactive/write-guard.ts + sillyhub-daemon/tests/write-guard.test.ts
需求：allowed_roots 配了 ~/.sillyhub + F:/，CC 仍能在 D 盘写文件。
现状：write-guard WRITE_TOOLS 只有 Write/Edit/MultiEdit，Bash 一律 return true（放行）。CC 用 Bash echo > D:\file / cp / tee 间接写完全绕过白名单。
方案：write-guard 加 Bash 写检测——extractBashWritePaths 正则提取重定向(>/>>)/cp/mv/install/tee/mkdir/touch 目标路径，isWriteWithinAllowedRoots 对 Bash：纯读放行，含写则每个目标校验在 allowed_roots。提取 isPathUnderAnyRoot 独立函数（Write/Edit + Bash 共用）。17 vitest 测试覆盖。
结果：vitest 17 passed。commit 829e576e。后续发现 extractBashWritePaths 的 m[1]/m[2] 在 noUncheckedIndexedAccess 下为 string|undefined，push 到 string[] 报 TS2345 → bundle 编译失败、daemon 停留旧版 c85dec8c（829e576e 代码实际未进分发）。commit dbe8e956 提取 const+if 守卫收窄类型（逻辑零变化，17 测试仍过）。pnpm bundle 成功（BUILD_ID 829e576e-20260702102214）+ docker compose -f deploy/docker-compose.yml build/up backend，daemon version c85dec8c→829e576e-20260702102214 已生效（curl latest.json + 容器内 grep BUILD_ID 三重验证）。坑：compose 文件在 deploy/ 下、之前在仓库根目录跑 docker compose 报 no configuration file，且 `| tail` 掩盖退出码需 set -o pipefail。已 push（829e576e..dbe8e956）。本机若单独跑 daemon 会经 preflight 自更新拉新版。

## ql-20260702-007-f1a8 | 2026-07-02 10:52:54 | 修复 allowed_roots 配盘符根（D:\）后 write-guard 仍 deny
状态：已完成
文件：sillyhub-daemon/src/interactive/write-guard.ts + sillyhub-daemon/tests/write-guard.test.ts
需求：/runtimes 配 D 盘为 allowed_root（可写目录）后，新会话（8438086b）CC 仍不能在 D 盘创建文件；未配时失败属正常（ed544515 会话）。
现状：write-guard isPathUnderAnyRoot 对盘符根 root 失效——pathResolve('D:/')='D:\'（结尾已是 sep），原逻辑 prefix=rl+sep 产生 'D:\\' 双反斜杠，target.startsWith 永远 false → 配 D 盘仍 deny 所有写。Unix 根 '/' 同理（容器侧 allowed_roots 通常非根未暴露）。node 实测确认 starts=false。
方案：isPathUnderAnyRoot 加 endsWith(sep) 判断——root 已含尾部 sep 时 prefix 不再补 sep（Windows 盘符根 D:\ + Unix 根 /）。Write/Edit 与 Bash 间接写共用此函数，一并修复。
结果：vitest 22 passed 1 skipped（+6 新用例：5 Windows 盘符根 + 1 Unix 根，Unix 根在 Windows 跳过）。daemon 模块文档同步（write-guard 首次登记 + 注意事项 + 变更索引）。待 bundle rebuild + 部署后用户本机 daemon self-update 即生效。

## ql-20260702-008-c2e4 | 2026-07-02 11:37:24 | daemon allowed_roots 不同步 D:/（启动管道 SIGPIPE 损坏心跳）
状态：已完成
文件：~/.sillyhub/daemon/bin/sillyhub-daemon.js（运维修复）+ 启动方式（nohup+redirect，无代码变更）
需求：配 D 盘为 allowed_root 后，新会话（46effdc0）CC 仍不能在 D 盘写（未配时失败属正常）。
根因（curl + 代码 + DB + 前台日志多重确认）：
  1. backend 正常：REST heartbeat 下发 ["~/.sillyhub","F:/","D:/"]（X-API-Key curl 实证），DB runtime 462d0e85（本机 claude provider）allowed_roots 含 D:/。
  2. daemon 代码正常：_syncAllowedRoots（daemon.ts:1683）+ normalizeAllowedRoots（config.ts:355）逻辑正确，前台跑 daemon 35s 捕获到 allowed_roots_synced count=4（含 D:/）。
  3. 真根因：daemon background 启动时 stdout 接管道（排查中曾用 `sillyhub-daemon start | head -8`），head 关闭后 daemon 写 stdout 收 SIGPIPE，损坏心跳循环 → _syncAllowedRoots 不执行 → 内存 config 无 D:/ → write-guard deny D:。前台/无管道启动心跳正常。
  4. write-guard 用内存 config（cli.ts:528），磁盘 config.json 无 D:/ 是 _syncAllowedRoots 不落盘（设计），非 bug。
修复：替换本机 bin 为 4b3dada9（含 ql-006/007，补齐虽非根因）+ `nohup sillyhub-daemon start > daemon.log 2>&1 & disown` 启动（redirect stdout 避免 SIGPIPE + 独立持久）。重启后 allowed_roots_synced count=4、心跳正常（15s 间隔）、daemon.log 落盘。
结果：daemon 内存 config 含 D:/，write-guard 放行 D 盘写。用户重开 CC 会话即可写 D 盘。无代码变更（daemon 代码正确）。
遗留（后续）：
  - preflight fetch /daemon/latest.json 经 frontend 3000 → 404（frontend 未代理该路径），daemon bin 无法自动升级（本机曾长期停 13403c71）。待修 frontend proxy 或 preflight 路径。
  - _syncAllowedRoots 不落盘 config.json：磁盘配置不可见 + 重启窗口期（首次心跳前内存无 D:/）。可考虑落盘。
  - daemon 对 SIGPIPE 不 resilient：background+管道启动损坏心跳循环，可增强 EPIPE 处理或 install.sh 规范 redirect。

## ql-20260702-009-a1b3 | 2026-07-02 14:15:17 | write-guard Bash git bash 路径绕过（pathResolve 不认 /e/ 盘符映射）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/write-guard.ts + sillyhub-daemon/tests/write-guard.test.ts
需求：CC 会话 04273031/系统 93ff417f 中，Write 工具对 E 盘正确 deny(path outside allowed_roots)，但 CC 改用 Bash 重定向(echo > /e/file)写 E 盘成功绕过——应无法创建而非 Bash 重定向写成功。
根因：write-guard extractBashWritePaths 提取重定向目标 /e/test.txt 后直接 pathResolve。Node pathResolve 是 Windows 语义，不认 git bash 的 /e/→E:\ 盘符映射，把 /e/test.txt resolve 成 daemon cwd 盘符下路径 F:\e\test.txt，恰好落在盘根 allowed_root F:/ 内 → 误判 allow；而 git bash 实际写 E:\test.txt 越界。node 实测 resolve('/e/test.txt')=F:\e\test.txt, inRoot(F:/)=true。daemon 跑 npm dist（已含 ql-006 Bash 检测），非版本问题，是路径解析语义漏洞。
方案：write-guard 加 normalizeBashWritePath——strip 外层引号 + Windows(sep==='\\')下 git bash /x/... 归一化为 X:/...(pathResolve 转 X:\...)，Linux 不动(真 Unix 路径)。extractBashWritePaths 返回前对每个路径 map 归一化。类型修正：正则捕获组 m[0]/m[1] 在 noUncheckedIndexedAccess 下 string|undefined，提 const+守卫。
结果：vitest 28 passed 1 skipped(+6 git bash 用例：echo>/e/ deny、echo>/f/白名单内 allow、echo>/d/ D盘根 allow、带引号 deny、cp /e/ deny、mkdir /e/ deny，Windows 平台)。pnpm build(tsc)通过 dist 含 normalizeBashWritePath。pnpm bundle BUILD_ID 878e4c6e-20260702142817。daemon 跑 npm dist 需 pnpm build 已就位；backend rebuild 后容器分发 bundle 为新代码；本机 daemon 需重启加载新 dist。

## ql-20260703-001-7e3a | 2026-07-03 14:15:00 | session-manager Bash tool 跨 shell 提取遗漏（PowerShell Set-Content 绕过 PolicyEngine）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts + sillyhub-daemon/tests/interactive/session-manager-allowed-roots.test.ts
需求：e2e 回归步骤 4（design §13 #6 PowerShell）：claude Bash tool 跑 `powershell -Command "Set-Content E:/a.txt"` 越界写成功绕过（Write 工具/bash 重定向/cmd mkdir 都拦了，唯 PowerShell 漏），E:/a.txt 真实落盘。
根因：claude 只暴露 Bash tool（无独立 PowerShell/CMD tool），`_shellKindOfTool('Bash')`→`'bash'`，`extractShellWritePaths(command,'bash')`→`extractBashWritePaths` 不识别 PowerShell cmdlet（Set-Content/Add-Content/Out-File/Copy-Item 等），写路径未提取→canWrite 未调→绕过。bash 重定向/mkdir 恰被 bash 提取覆盖所以拦了，PowerShell cmdlet 名 bash 正则不匹配所以漏。
方案：`_extractWritePathsForTool` shell 分支合并 bash+powershell+cmd 三种提取取并集（`[...new Set(...)]` 去重）。正则各自精确（PowerShell cmdlet 名不匹配 bash/cmd 命令，反之亦然），合并安全无误提取。
结果：已完成。修复 _extractWritePathsForTool shell 分支合并 bash+powershell+cmd 三提取取并集（[...new Set(...)] 去重）。typecheck 零错。session-manager-allowed-roots 20 passed（17 原 + 3 新跨 shell：Bash tool 跑 powershell Set-Content -Path / 位置参数 / pwsh Out-File 越界全 deny）。shell-paths 30 passed 无回归。修复前 Bash tool 跑 powershell cmdlet 越界写绕过（真机 E:/a.txt 落盘），修复后拦截。待 commit+bundle+部署后 daemon 真机复测。

## ql-20260703-002-c2d4 | 2026-07-03 14:57:00 | runtimeIdProvider 用 config.runtime_id（非注册 runtime）致 PolicyCache 永久 miss，配 allowed_roots 后 interactive session 仍 deny
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/daemon.ts + sillyhub-daemon/src/interactive/session-manager.ts + sillyhub-daemon/src/cli.ts
需求：真机 e2e：在【守护进程运行时】页面给 Claude Code 配 E:/ 为可写目录，resume 上次对话（claude --resume 49ef9eac / 系统 session bf2a461a）后仍 deny 写 E 盘。
根因：cli.ts:609 `runtimeIdProvider: () => config.runtime_id`（config 4f24728c），但 daemon 注册的 claude runtime 是 462d0e85（`_registeredRuntimes`，心跳 _syncAllowedRoots 按 462d0e85 存 PolicyCache）。session-manager canWrite(4f24728c, path) → PolicyCache.get(4f24728c)=undefined → fail-closed deny（无论配没配 E:/ 都 deny）。session-manager:937 注释本就写"runtimeIdProvider 闭包解析 daemon._registeredRuntimes.get(provider)"但实现没这么做（task-14 遗留 E2E-3）。
方案：daemon.ts 加 public `resolveRuntimeId(provider)`；session-manager runtimeIdProvider 签名改 `(provider: string) => string`，_judgeWriteViaPolicyEngine 传 provider；cli.ts runtimeIdProvider 改 `(provider) => daemon?.resolveRuntimeId(provider) ?? ''`。
结果：已完成。daemon.ts 加 public `resolveRuntimeId(provider)`；session-manager runtimeIdProvider 签名 `(sessionId)=>string` 改 `(provider)=>string`，_judgeWriteViaPolicyEngine 传 provider；cli.ts runtimeIdProvider 改 `(provider) => daemon?.resolveRuntimeId(provider) ?? ''`。typecheck 零错。session-manager-allowed-roots 20 passed 无回归。daemon-multi-runtime 8 errors 是 preflight.ts:208 process.exit 在 vitest 触发（git stash 确认非本次引起，423359c6 既有问题，独立）。待 commit+bundle+部署后真机复测（配 E:/ → resume → 应可写）。
=== ql-003 记录追加 ===
## ql-20260703-003-f9d7 | 2026-07-03 15:30:00 | 审计页强制 wid 致「未提供 workspace 来源」——后端加免 wid 路由 + 前端适配
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/audit/router.py + frontend/src/lib/daemon-audit.ts + frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx + page.test.tsx
需求：步骤 5 审计页显示「未提供 workspace 来源（URL 需带 ?wid=）」。task-20 遗留（E2E-2）：GET 端点强制 workspace_id path 段，但 DaemonRuntime 无 workspace_id（audit workspace_id daemon best-effort 可空），真正语义按 runtime_id 查。
根因：task-10 GET /workspaces/{wid}/runtimes/{rid}/policy-audit 强制 wid（UUID path 段）。task-21 入口 /runtimes/{id}/audit 不带 wid → 前端显示无 wid 提示，无法查审计。
方案：后端 audit/router.py 加 GET /runtimes/{runtime_id}/policy-audit（service.query(workspace_id=None) 跳过 workspace 过滤）。前端 daemon-audit.ts 加 fetchPolicyAuditByRuntime + usePolicyAuditByRuntime；audit/page.tsx 改用新 hook，删 workspaceId 依赖 + wid 提示。
结果：已完成。backend ruff All checks passed + frontend 22 passed（daemon-audit 17 + page 5）+ lint ok。待 commit+bundle+backend rebuild 后生效。
## ql-20260703-004-1a2b | 2026-07-03 16:10:00 | frontend 镜像未 rebuild 致审计页仍显旧 wid 提示（ql-003 修复未部署）
状态：已完成
关联变更：（无）
文件：（无代码改动，仅 Docker rebuild）
需求：步骤 5 审计页仍显示「未提供 workspace 来源」。ql-003 已删 page.tsx 该提示 + 加免 wid 路由，但 frontend Docker 镜像 3 小时前构建（旧代码含提示），未随 backend rebuild。
根因：ql-003 commit 后只 rebuild backend + daemon bundle，漏 rebuild frontend。frontend 镜像跑旧代码（grep 容器 .next 确认含「未提供 workspace 来源」，本地 page.tsx 已 0 处）。
方案：rebuild frontend 镜像（docker compose up --build --force-recreate -d frontend）。
结果：已完成。frontend rebuild 后容器内「未提供 workspace 来源」零命中（新代码），审计页 /runtimes/{id}/audit HTTP 200，backend+frontend healthy，backend commit_sha 0b363804c9dd（= main HEAD 含免 wid 路由）。用户刷新审计页应正常显示记录。
## ql-20260703-005-3f4c | 2026-07-03 16:40:00 | 审计日志空——AuditSink sender body 缺 runtime_id/claim_token 致 POST 422 落盘 audit-failed.jsonl
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/cli.ts + backend/app/modules/daemon/audit/schema.py + backend/app/modules/daemon/audit/router.py
需求：策略审计日志页空。DB policy_audit_log 0 行。
根因：cli.ts makeAuditSender 的 postBatch body 只传 `{events}`，缺 backend AuditBatchRequest 要求的 `runtime_id` + `claim_token`（required）→ backend 422 → sender 重试耗尽落盘 `~/.sillyhub/daemon/audit-failed.jsonl`（6.5KB DENY 事件）。且 daemon AuditEvent 含 runtimeId 但 backend AuditEventIn extra=forbid 不接收。
方案：cli.ts postBatch 按 runtimeId 分组 + 去掉每事件 runtimeId 字段 + body 加 `runtime_id`；backend schema claim_token 改 Optional（daemon X-API-Key 已鉴权，装配期不持有 lease token）；router claim_token None 时跳过 _verify_claim_token。
结果：已完成。typecheck 零错 + ruff All checks passed。daemon bundle + backend rebuild。积压 audit-failed.jsonl 6.5KB 需手动重报（或丢弃，新 audit 上报正常后增量）。

## ql-20260706-001-7b2e | 2026-07-06 08:41:50 | 策略审计页决策列(ALLOW/DENY)回显中文「放行/拒绝」+ 原因列多行换行
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx + frontend/src/app/(dashboard)/runtimes/[id]/audit/page.test.tsx
需求：/runtimes/<id>/audit 审计页【决策】列显示 ALLOW/DENY 英文；【原因/拒绝理由】列 daemon 上报的多行中文 reason 被 span 压成一行难读。用户要求回显中文。
根因：page.tsx 决策列 render 直接回显 {v}（ALLOW/DENY 英文枚举）；原因列 span 默认不渲染 reason 里的 \n（daemon buildDenyReason 产出 "Runtime Policy 拒绝本次写入。\nAgent：...\n目标路径：...\n原因：..." 多行中文长文），挤成一行。后端 reason 本身已是中文，无需改。
方案：决策列 ALLOW→放行(绿 Tag)/DENY→拒绝(红 Tag)；原因列加 whitespace-pre-line + break-words 让多行 reason 按换行符正常折行；ALLOW 空串仍显「—」。同步 page.test.tsx 决策断言 DENY/ALLOW→拒绝/放行。
结果：已完成。vitest 5/5 passed + tsc --noEmit exit 0 + pnpm lint exit 0（仅既有 unused-vars warning）。待 commit + frontend docker rebuild 后真机生效。

## ql-20260706-002-c5d8 | 2026-07-06 09:32:37 | backend alembic multiple heads（20260705_tool_kind + dceb0c45ab3e 未 merge）致部署 crash loop
状态：已完成
关联变更：（无）
文件：backend/migrations/versions/20260706_merge_heads.py
需求：rebuild backend 镜像部署后，容器 crash loop（10 restarts，unhealthy），日志报 "Multiple head revisions are present for given argument 'head'"，alembic upgrade head 启动失败。
根因：alembic heads --verbose 确认当前有两个独立 head——①20260705_tool_kind（down_revision=202607041800，文件 20260705_add_agent_run_log_tool_kind.py）②dceb0c45ab3e（merge point，已 merge p0la1ud1t006+202607022300，文件 dceb0c45ab3e_merge.py）。9561babd 加的 dceb0c45ab3e_merge 漏掉 20260705_tool_kind 分支（agent-log-type-tags 变更引入），未收编，仍是 multiple heads。
方案：在 backend/migrations/versions/ 新增 merge migration 20260706_merge_heads.py，down_revision=("20260705_tool_kind","dceb0c45ab3e")，upgrade/downgrade 空实现。然后 rebuild backend 镜像 + 重启 + 验证 alembic heads 只剩 1 个 + healthy + commit_sha=93d98789。
结果：已完成。新增 20260706_merge_heads.py（down_revision=(20260705_tool_kind,dceb0c45ab3e)，空 upgrade/downgrade）。挂载最新 migrations 跑 alembic heads 确认只剩 1 个 head（20260706_merge_heads）。rebuild backend 后启动日志完整 upgrade 链（p0la1ud1t006->b16bf63a5d05->202607041800->20260705_tool_kind + dceb0c45ab3e->20260706_merge_heads），backend healthy（status/db/redis ok），镜像内 alembic heads 只 1 个。附带修复部署回归 commit_sha=unknown：根因是 compose `environment COMMIT_SHA: ${COMMIT_SHA:-}` 在 up 时插值并覆盖镜像 baked ENV（Dockerfile line 60 已 `ENV COMMIT_SHA=${COMMIT_SHA:-}`），仅 build 时 export 不够，up 时也必须 export COMMIT_SHA；已 `COMMIT_SHA=$(git rev-parse HEAD) up backend`，验证 commit_sha=93d98789bf7b6964408bf418e1850ce83f8d7a43 生效。

## ql-20260706-003-8a3f | 2026-07-06 10:27:15 | runtimes 页可写目录（allowed_roots）配置后不回显（_runtime_read 漏填 instance.allowed_roots）
状态：进行中
关联变更：（无）
文件：backend/app/modules/daemon/router.py
需求：/runtimes 页给 cc runtime（780cae63）配可写目录后，DB（daemon_instances.allowed_roots）有数据但页面不回显，前端读 runtime.allowed_roots 拿到默认值 ["~/.sillyhub"] 而非真实配置。之前正常，近期改坏。
根因：2026-07-03-daemon-entity-binding（52101447）把 allowed_roots 从 DaemonRuntime 上提到 DaemonInstance（model.py:76，DaemonRuntime 已无此属性）。service.list_runtimes_page（runtime/service.py:467）SQL outerjoin(DaemonInstance) 已 JOIN instance，但 router._runtime_read（router.py:401-422）instance 分支只填 daemon_version/daemon_build_id，漏填 allowed_roots；model_validate(runtime) 因 runtime ORM 无此属性 fallback 到 DaemonRuntimeRead.allowed_roots default ["~/.sillyhub"]。PUT /runtimes/{id}/allowed-roots（router.py:567）同样 DaemonRuntimeRead.model_validate(runtime) 不传 instance——尽管端点内已 session.get(DaemonInstance) 拿到 instance（用于 WS push line 536），返回时却没用它填 allowed_roots。回归点：b989bf62 加 daemon_version/build_id 填充时漏带 allowed_roots。
方案：①_runtime_read instance 分支加 update["allowed_roots"]=list(getattr(instance,"allowed_roots",None) or [])；②PUT 端点 return 改用 _runtime_read(runtime, instance=instance) 复用同一填充逻辑。两处统一修复 list + PUT 链路。
结果：已完成 + 验证通过。router.py 两处修复：①_runtime_read instance 分支加 allowed_roots 填充；②update_runtime_allowed_roots return 改 _runtime_read(runtime, instance=instance)。ruff All checks passed。容器挂载本地代码实测（_verify_fix.py 跑完已删）：对 runtime 780cae63（instance 4f24728c），修复前 _runtime_read 返回 default ['~/.sillyhub']，修复后返回 ['~/.sillyhub','D:/']（= DB daemon_instances.allowed_roots 真实值）。待 rebuild backend + 部署 + 前端真机确认回显。

## ql-20260706-004-9d2e | 2026-07-06 13:20:00 | GET /runtimes/page 500（disabled runtime allowed_roots=None 致 DaemonRuntimeRead 校验失败）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/schema.py
需求：GET /api/daemon/runtimes/page 返回 500（pydantic ValidationError: allowed_roots list_type input_value=None）。
根因：2026-07-06-allowed-roots-per-runtime task-01 迁移 copy instance→runtime，但 disabled runtime（462d0e85/5f8f2098 daemon_instance_id=null）copy NULL → daemon_runtimes.allowed_roots=None。DaemonRuntimeRead.model_validate(runtime) 时 allowed_roots=None（显式 None，Field default_factory 不触发）→ pydantic list_type 校验失败 500。
方案：schema.py DaemonRuntimeRead 加 field_validator("allowed_roots", mode=before) None→[]（兼容 NULL 列）。
结果：已完成。ruff format+check 通过。容器挂载本地代码验证 disabled runtime（462d0e85 allowed_roots=None）_runtime_read 返回 []（不再 500）。

## ql-20260706-005-b1e3 | 2026-07-06 14:08:19 | heartbeat 端点 ImportError: col（误从 sqlalchemy 导入，应为 sqlmodel）致 daemon 拿不到 per-runtime allowed_roots，CC 配的可写目录全 deny
状态：进行中
关联变更：2026-07-06-allowed-roots-per-runtime
文件：backend/app/modules/daemon/router.py, sillyhub-daemon/src/daemon.ts
需求：守护进程 CC runtime（780cae63）在 UI 配了可写目录 ["~/.sillyhub","D:/"]，DB 里 daemon_runtimes.allowed_roots 值正确，但 CC 实际写任何路径都被 Runtime Policy 拒绝（"目标目录未配置为可写目录"），policy_audit_log 该 runtime ALLOW 记录 0 条。
根因：①backend router.py:355 `from sqlalchemy import col as _col` 是错误导入——col 属 sqlmodel（service.py:13 `from sqlmodel import col` 用对了），sqlalchemy 顶层无 col → ImportError → POST /api/daemon/heartbeat 每次都 500（backend 日志 + curl 实测确认）。daemon 每 15s 心跳全失败，_syncAllowedRoots 永远拿不到 per-runtime runtimes[] map，PolicyCache[780cae63] 停滞在 register 初始值（不含用户配的 D:/），CC 写 D:/、F:/ 全 deny。②daemon.ts:936 `_syncPolicyCache(config.allowed_roots)` 无条件执行，会覆盖 925-932 register 响应刚 set 的 per-runtime allowed_roots（即使 heartbeat 修好，register 后首次心跳前 PolicyCache 仍是 config 而非用户配值）。
方案：①router.py:355 改 `from sqlmodel import col as _col`（与 service.py 一致），heartbeat 恢复返 per-runtime map；②daemon.ts:936 兜底改条件执行——仅当 backend 未返任何 per-runtime allowed_roots 时才用 config 兜底，保留 register 响应设的正确值。
状态：已完成
结果：已完成 + 验证通过。ruff All checks passed。rebuild backend 镜像 + recreate 容器后，curl POST /api/daemon/heartbeat 返 200 + per-runtime runtimes map（CC 780cae63 → ["~/.sillyhub","D:/"]，hermes 23bab2e2 → ["~/.sillyhub"]），backend 日志多条 heartbeat 200 OK（daemon 心跳恢复，不再 ImportError 500）。daemon 心跳 _syncAllowedRoots 现拿得到 runtimes[]，PolicyCache[780cae63] 每 15s 校正为 [~/.sillyhub→homedir/.sillyhub, D:/, homedir]，CC 写这些路径恢复 allow。daemon.ts:936 修复已 tsc build 到 dist（全局 daemon symlink → 本地），下次 daemon 重启 register 时不再覆盖 per-runtime 值；当前 daemon 已过 register 阶段、心跳已校正 PolicyCache，无需重启即恢复写入。

## ql-20260707-001-a3f2 | 2026-07-07 09:17:32 | runtimes 可写目录输入框改系统原生文件夹选择对话框（daemon PowerShell FolderBrowserDialog）
状态：进行中
关联变更：（无）
文件：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/file-rpc.ts, backend/app/modules/daemon/router.py, frontend/src/lib/daemon.ts, frontend/src/app/(dashboard)/runtimes/page.tsx
需求：/runtimes 页守护进程的「可写目录」原是纯文本输入框，用户希望改成像软件安装时选目录那样——点「浏览」直接弹系统原生文件夹选择对话框，选完路径自动回填。
方案演进（3 轮迭代）：
  1. 第一轮：前端实现树形目录浏览器（antd Tree + 地址栏）。daemon list_dir 放开 allowed_roots 白名单限制（file-rpc.ts fallbackRoots 空时跳过权限校验；daemon.ts 传空 fallbackRoots）。但用户反馈「不直观，想要系统原生的不是自己实现的」。
  2. 第二轮：改用系统原生 FolderBrowserDialog。daemon 新增 browse_folder RPC（PowerShell 调 System.Windows.Forms.FolderBrowserDialog）；backend 新增 POST /runtimes/{rid}/browse-folder 端点转发；frontend 新增 browseFolder API + 「浏览」按钮直接调（取消树形 modal，保留代码作 fallback 未用）。用户反馈「中文路径乱码」。
  3. 第三轮：PowerShell 脚本头部加 [Console]::OutputEncoding = UTF8 修中文。用 -EncodedCommand（UTF-16LE base64）传脚本避免引号转义。用户反馈「多屏总在主屏弹」。
  4. 第四轮：PowerShell 读 [Cursor]::Position + Screen.FromPoint 找鼠标所在屏，建透明隐藏 Form（Opacity=0，Size=1x1，Show+Hide）作 ShowDialog 的父窗口，对话框跟随鼠标屏弹。
改动细节：
  - daemon.ts: import exec（node:child_process）+ RpcError；新增 browse_folder RPC handler（仅 win32，PS 脚本 EncodedCommand 调用，cancelled→空 path，timeout 180s）；list_dir 改传空 fallbackRoots（放开浏览限制）。
  - file-rpc.ts: listDir 权限校验加 else if (fallbackRoots.length > 0)——空数组跳过 assertWithinAllowedRoots（目录浏览读自由，读操作无安全风险）。
  - backend router.py: 新增 BrowseFolderResponse(BaseModel) + POST /runtimes/{rid}/browse-folder 端点（send_rpc browse_folder，cancelled→返空 path 非错误，其他 daemon error→502）。
  - frontend lib/daemon.ts: 新增 browseFolder(runtimeId) → POST /browse-folder，返 path 字符串。
  - frontend runtimes/page.tsx: 「浏览」按钮 onClick 改 handleBrowseNative（调 browseFolder，成功回填输入框，失败 notify.error）。保留树形 modal 代码（handleBrowseDir/handleLoadTreeData/treeData 等）但不再触发，作非 Windows 平台 fallback。
验证：tsc --noEmit 零错。ruff All checks passed。backend + frontend rebuild 镜像部署，daemon kill+重启加载新 dist。点击「浏览」→ 弹 Windows 系统 FolderBrowserDialog → 选含中文的文件夹路径正确回填（UTF-8 编码）→ 鼠标在副屏时对话框在副屏弹（多屏适配）。
结果：已完成 + 部署生效（按用户要求不 commit/push）。注意 daemon 改动需 kill 旧进程 + 清 ~/.sillyhub/daemon/locks/* 再重启（全局 daemon symlink 指向本地 dist）。

## ql-20260707-002-b7e1 | 2026-07-07 09:29:42 | browse-folder 端点 504（WS RPC 默认 10s 超时，用户选文件夹超时）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/router.py
需求：点击「浏览」弹系统文件夹对话框，前端收到 504 Gateway Timeout（POST /api/daemon/runtimes/{rid}/browse-folder）。
根因：ws_hub.py `RPC_DEFAULT_TIMEOUT = 10.0` 秒，send_rpc 默认 10s 超时。用户在 FolderBrowserDialog 里浏览+选文件夹远超 10s，daemon 还在等 PowerShell 返回，backend 先超时 → DaemonRpcGatewayError（http_status=504，service.py:94-98）→ 前端 504。
方案：browse_folder 端点显式传 `timeout=180.0` 给 send_rpc（对齐 daemon 端 PowerShell exec 的 180s timeout，service.py DaemonRpcTimeout → router except 映射）。
结果：已完成 + 部署。ruff All checks passed。rebuild backend 镜像 + recreate 容器 healthy。用户现在有 3 分钟在系统对话框里选文件夹，不再 504。

## ql-20260707-003-c4d2 | 2026-07-07 09:53:53 | 浏览文件夹时默认定位到输入框已有目录（initial_path → SelectedPath）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/daemon.ts, backend/app/modules/daemon/router.py, frontend/src/lib/daemon.ts, frontend/src/app/(dashboard)/runtimes/page.tsx
需求：配置可写目录时，若输入框已有正确路径值（如 D:/WorkNew），再点「浏览」希望系统对话框直接定位到该目录，而不是总从「此电脑」开始。
方案：前端把当前输入框 path 作 initial_path 传 backend → WS RPC 转发 daemon → PowerShell 展开 ~（homedir）+ Test-Path -LiteralPath 校验存在且是目录后，设 $d.SelectedPath = (Resolve-Path).Path；不存在则跳过（FolderBrowserDialog 用默认起点）。PS 单引号转义（' → ''）防注入。
改动：
  - daemon.ts: browse_folder handler 改收 params，读 initial_path，JS 端先展开 ~ → homedir，PS 脚本加 `$initial = '<safe>'` + `if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) { $d.SelectedPath = (Resolve-Path -LiteralPath $initial).Path }`。
  - router.py: 新增 BrowseFolderRequest(initial_path: str | None)，端点 body 接收，rpc_params 透传 initial_path（snake_case 满足 ruff N815）。
  - lib/daemon.ts: browseFolder 增 initialPath 形参，body.initial_path 发送。
  - page.tsx: handleBrowseNative 增 currentPath 形参，按钮 onClick 传当前 path。
结果：已完成 + 部署。ruff/tsc/build 全过。backend+frontend rebuild + daemon 重启。点「浏览」时对话框默认定位到输入框已有目录（路径存在时）。

## ql-20260707-004-d5e8 | 2026-07-07 11:18:53 | workspace 项目组件页去掉头部【概览/组件/变更/成员】tab 行
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx
需求：/workspaces/{id}/components 项目组件页头部不要显示 WorkspaceTabs 的【概览/组件/变更/成员】tab 行（同 changes 页处理）。
现状：layout.tsx 仅 changes 路径返回 fragment（无 main wrapper + 无 WorkspaceTabs），其他路径（含 components）都包 WorkspaceTabs 显示 tab 行。components 页自带 PageContainer，不需要外层 tab。
方案：layout.tsx 的 isStandalone 判断从仅 changes 扩展为 changes 或 components 路径，两者都返回 <>{children}</> fragment（DOM 对齐 admin/roles，dashboard layout main 直接接 page）。
结果：已完成 + 部署。tsc 零错。frontend --build --force-recreate 重建部署（首次 --build 缓存未重建，--force-recreate 后容器 03:20 StartedAt 确认新镜像）。用户刷新 /workspaces/{id}/components 应不再显示头部 tab 行。代码未提交。

## ql-20260708-001-b7e4 | 2026-07-08 13:35:00 | runtime 卡 sparkline 补全 7d/30d 完整序列（降采样日桶 + 缺失天补 0）
状态：进行中
关联变更：（无）
文件：frontend/src/components/daemon/runtime-card-helpers.tsx、frontend/src/components/daemon/runtime-card.tsx
需求：/runtimes 页 runtime 卡 sparkline 统计 7d 用量，但 daily 只返有 run 的桶（无数据桶不返），折线只显零星几点，不像连续 7 天趋势。
现状：backend _bucket_unit 7d=小时桶，_build_daily_sql GROUP BY bucket 只返有 run 的桶（无 generate_series 补全）；前端 RuntimeUsageLineChart 直接用 daily，缺桶不补 0。
方案：前端补全——runtime-card-helpers 加 buildSparkSeries(daily, window)：7d/30d 降采样到日桶（UTC date sum 同日）+ 补全最近 N 天（缺失天 0）；1d 保持。RuntimeCard 用它喂 sparkline。不动 backend。
结果：已完成 + 已提交（fdfd63b7）。buildSparkSeries 3 新用例 + runtime-card.test 适配。tsc 零错。frontend rebuild 部署。该 commit 同含 browse-folder -NonInteractive→-Sta + tooltip 时间格式化（后证明 -Sta 未根治弹窗，见 ql-20260708-002）。

## ql-20260708-002-9f3a | 2026-07-08 16:36:00 | browse-folder 点浏览不弹窗（FolderBrowserDialog 卡死）→ 改 Shell.BrowseForFolder
状态：进行中
关联变更：（无）
文件：sillyhub-daemon/src/daemon.ts
需求：/runtimes 页配置可写目录点「浏览」不弹系统对话框，前端报 500（POST /api/daemon/runtimes/{id}/browse-folder）。
根因：daemon 端 browse_folder RPC 用 System.Windows.Forms.FolderBrowserDialog.ShowDialog。该 API 在 PowerShell 子进程（node exec 启动）里缺 WinForms 消息循环，ShowDialog 卡死不弹窗（实测 12s/20s 超时被杀 exit=124）→ daemon exec 等 180s → backend DaemonRpcTimeout 504（后端日志确认 08:15:59 rpc timed out + late reply）→ next.js proxy 30s 超时转 500。上次 commit fdfd63b7 把 -NonInteractive 改 -Sta 未根治（-Sta 本就是 powershell 默认，ShowDialog 仍卡）。多屏适配的 $dummy.Show()/Hide() 非根因（简化版无 dummy 同样卡）。Shell.Application.BrowseForFolder（COM SHBrowseForFolder）实测 exit=0 正常弹窗 + 用户取消返 null。
方案：browse_folder handler PowerShell 脚本整体替换为 Shell.BrowseForFolder 版——去 System.Windows.Forms/Drawing Add-Type + $dummy 多屏适配，改 New-Object -ComObject Shell.Application + BrowseForFolder(0, 描述, 0x0040, $root)。initial_path 作 RootFolder（Test-Path 校验存在才传；空则从"此电脑"开始）。exec -Sta -EncodedCommand timeout 180s windowsHide:false 不变；cancelled→空 path 逻辑不变；stdout.trim() 取 $folder.Self.Path（CLIXML 走 stderr 不污染 stdout，已验证）。
改动：仅 daemon.ts browse_folder handler（line 2107-2169），PowerShell 脚本段替换 + 注释更新。backend/frontend 无改动。
结果：tsc --noEmit 零错 + tsc build 成功（dist/daemon.js 含 BrowseForFolder×4）。daemon kill PID1584 + 清 locks + 重启 PID24760（per-daemon WS + session recovered + 心跳 allowed_roots_synced_per_runtime 正常）。待用户 UI 点浏览确认弹窗 + 选路径回填。

## ql-20260709-001-7e3a | 2026-07-09 16:35:00 | RemoteFolderPicker 打开定位当前输入框路径 + 修目录树双滚动条
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/remote-folder-picker.tsx, frontend/src/app/(dashboard)/runtimes/page.tsx
结果：tsc exit 0。打开时定位输入框当前路径（listRoots 后探 listDir 校验选中 initialPath，失败降级首根）；目录树外层 div 去 overflow-auto+maxHeight，由 Tree height={300} 虚拟滚动承担，修双滚动条。

## ql-20260709-002-b5c8 | 2026-07-09 16:55:00 | RemoteFolderPicker 弹窗最大高度占页面 70%（Tree height 动态响应 70vh）
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/remote-folder-picker.tsx
结果：tsc exit 0。加 treeHeight state + resize useEffect，Tree height 动态响应视口 70vh（减去地址栏/已选/header-footer ≈ 180px，最小 200），弹窗最大占页面 70%。

## ql-20260710-002-56f0 | 2026-07-10 10:03:37 | 回退 ql-20260710-001-202d（runtimes 页 daemon 安装命令端口推导修复，用户要求撤销）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/runtimes/page.tsx, .sillyspec/docs/frontend/modules/app-pages.md
操作：git revert 5481b858 → b40735fb（反向 commit，不改写已推送的共享历史）。page.tsx 恢复写死 :3001→:8001 端口推导（变更前原状）；app-pages 模块文档的变更索引条目 + 注意事项补充同步移除。frontend rebuild 还原部署。原 ql-20260710-001-202d 条目随 revert 一并移除，本条目为回退操作留痕。

## ql-20260710-003-34ec | 2026-07-10 10:42:17 | daemon install.sh 检测不到非 C 盘 node（cmd.exe /c 被 MSYS 路径转换破坏 + 盘符转换只处理 C:）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/scripts/install.sh
需求：用户本机（node 装在 E:\Software\nodejs）跑 `curl <SERVER>/daemon/install.sh | bash` 报"未检测到 node，安装中止"。
根因（4 重，全在 git-bash 分支）：①1c 兜底 `cmd.exe /c "where node"` 的 `/c` 被 MSYS 路径转换成 `C:/`，cmd.exe 收到 `C:/ "where node"` 不执行 where、反打印 Windows 欢迎横幅→取横幅文本非路径→`[[ -f ]]` 失败；②即便 where 能跑，1c 盘符转换 `sed 's|\\|/|g'` 在 MSYS 下本身报 `unterminated 's'`（`|` 分隔符+`\\` 冲突），且只转 `C:/c:` 不转其他盘符；③用户从 cmd pipe 启动的 bash 会话 PATH 不含 node（1a `command -v` 失败），1c where 又被 MSYS 搞坏→1a/1b/1c 全失败；④ensure_path 的 `echo %PATH%`/setx 同样 `cmd.exe /c` 被 MSYS 破坏（PATH 写入也坏）。
方案：①1c where 改 `MSYS_NO_PATHCONV=1 cmd.exe /c`；②盘符转换弃 sed，改 `tr '\134' '/'`（八进制反斜杠）+ bash `${d,,}` 小写盘符（通用任意盘符，跨平台无 sed 转义坑）；③新增 1d PowerShell 注册表 PATH(User+Machine) 兜底（读注册表不依赖当前 shell PATH，覆盖新开终端 PATH 未刷新/nvm 切换/当前 shell PATH 缺失等场景，Linux/macOS 无 PS 自动跳过）；④ensure_path 两处 `cmd.exe /c` 加 `MSYS_NO_PATHCONV=1`。WSL 分支（`/mnt/c/...` 完整路径）非 MSYS 不动。
结果：`bash -n` SYNTAX_OK；分段验证——1c 完整链路（where→tr→bash 小写→-f）= `/e/Software/nodejs/node.exe` -f YES v24.14.1；1d 注册表查询（正常 PATH）= `E:\Software\nodejs\node.exe` 正确；grep 确认 3 处 git-bash 分支 `cmd.exe /c` 全加 `MSYS_NO_PATHCONV`，WSL 分支未动。待 backend rebuild 部署 + 端到端（curl 新 install.sh 实跑 check_node）验证。

## ql-20260713-001-9f3e | 2026-07-13 14:54:04 | ql-20260710-003 修复未部署——服务端 install.sh 仍是 420 行旧版（缺 1d），rebuild backend Docker 让修复版上线 + 端到端验证 node 检测
状态：已完成
关联变更：（无）
文件：backend/Dockerfile（apt 换清华源——唯一 git tracked 源码改动）+ sillyhub-daemon/build/bundle/*（pnpm bundle 重产，gitignored）+ backend Docker 镜像重建；install.sh 源码未改（commit a6d60955 已是修复版）
需求：用户实跑 `curl <SERVER>:8000/daemon/install.sh | bash` 仍报"未检测到 node，安装中止"（与 ql-20260710-003 同样症状）。ql-20260710-003 当时状态写"待 backend rebuild 部署 + 端到端验证"，端到端验证未做。
根因：代码层已修复（本地 install.sh 475 行含 1d，commit a6d60955 已 push），但 Docker 镜像未 rebuild——容器 `/app/daemon-dist/install.sh` 仍是 420 行旧版（grep "注册表 PATH" = 0），Dockerfile L91 `COPY --from=daemon scripts/install.sh` 在 build 时直拷源文件，镜像旧 = 脚本旧。本地 build/bundle/ 还是 7/10 10:22 陈旧产物（连 mcp-server.js 都没有，BUILD_ID=d6734499-20260710102237），rebuild 前必须重跑 pnpm bundle。
方案：①`pnpm -C sillyhub-daemon run bundle` 重产 sillyhub-daemon.js + mcp-server.js（build-id.ts gitignored 不污染工作区）；②export COMMIT_SHA 后 `docker compose up --build --force-recreate -d backend`；③验证容器内 install.sh = 475 行 + 含 1d；④端到端 curl 新 install.sh 跑 check_node，确认检测到 E:\Software\nodejs 的 node。
结果：①pnpm bundle 成功 → sillyhub-daemon.js(2.29MB) + mcp-server.js(1.06MB)，BUILD_ID=c013fc2c-20260713145548；②首次 rebuild backend 失败——`[runtime 3/14] apt-get update` 连不上 deb.debian.org（Connection refused；根因：base image python:3.12-slim digest 漂移致 apt 层缓存失效需重联网，而 deb.debian.org 国内不可达；pip/npm 都配国内源唯独 apt 漏配）；③补修 Dockerfile L66-76 加 `find /etc/apt \( -name sources.list -o -name '*.sources' \) -exec sed deb.debian.org→mirrors.tuna.tsinghua.edu.cn`（trixie DEB822 debian.sources + 旧版 sources.list 双覆盖，find 找不到时 -exec 不执行无副作用），rebuild 成功，容器 Recreated+Started healthy；④容器内 /app/daemon-dist/install.sh = 475 行（旧 420），1d/MSYS 标记 7 处（旧 0），powershell 7 行，bundle 三件齐全（时间戳 07:08 UTC）；⑤服务端 curl :8000/daemon/install.sh = 475 行 7 处 1d 标记（修复版已上线）；⑥端到端子 shell 模拟用户场景（PATH 清掉 node），check_node 1a 失败 → 1d PowerShell 注册表兜底成功 = `找到 node（注册表 PATH）: /e/Software/nodejs/node.exe`，v24.14.1>=20 通过，exit 0。ql-20260710-003「待 backend rebuild 部署 + 端到端验证」闭环。

## ql-20260713-002-4c8a | 2026-07-13 15:38:22 | 前端 3000 访问 /daemon/install.sh 404——端口推导硬编码 :3001→:8001 不匹配实际部署 + 前端 rewrite 未代理 /daemon/*
状态：已完成
关联变更：（无）
文件：frontend/next.config.mjs（rewrites 加 /daemon/:path* → backend）+ frontend/src/app/(dashboard)/runtimes/page.tsx（server-url 改用 window.location.origin，去掉 :3001→:8001 硬编码，2 处：CopyDaemonCommand L105 + InstallDaemonBlock L170）
需求：用户在 runtimes 页复制安装命令（server-url=http://127.0.0.1:3000）实跑 `curl .../daemon/install.sh` 返回 404。
根因：①page.tsx 两处 serverUrl 推导 `frontendUrl.replace(/:3001$/, ":8001")` 硬编码端口映射，用户实际部署 FRONTEND_PORT=3000/BACKEND_PORT=8000，正则匹配不到 → serverUrl 保持前端地址 :3000；②next.config.mjs rewrites 只代理 /api/:path*，不代理 /daemon/:path*，故前端 :3000/daemon/install.sh 命中 Next.js 404（backend :8000/daemon/install.sh GET 本身是通的，HEAD 才 405）。
方案：放弃脆弱的端口字符串替换——server-url 直接用 window.location.origin（客户端实际访问地址，本机/局域网自适应），前端 next.config rewrites 加 `/daemon/:path*` → `${apiBaseUrl}/daemon/:path*`（与 /api 同代理目标 INTERNAL_API_BASE_URL=http://backend:8000）。daemon 全程连前端地址，/api/* 与 /daemon/* 均经前端代理到 backend。bundle 2.29MB 静态 FileResponse 非长处理，无 knowledge 2026-07-01 的 proxy socket hang up 风险（该坑是 backend 业务处理慢 >20-30s 触发，静态文件立即返回）。
结果：①next.config.mjs rewrites 加 /daemon/:path* → backend；②page.tsx 两处端口推导改用 window.location.origin——CopyDaemonCommand L103-106（删 frontendUrl 中间变量 + :3001→:8001 replace）+ InstallDaemonBlock useEffect L167-170，过时注释「由 nginx 托管」更新为 backend dist_router FileResponse；③本机 `pnpm -C frontend typecheck` 通过；④rebuild frontend（compose 联动重建 backend），两容器 Recreated+Started healthy；⑤验证——前端 3000 /daemon/install.sh = 475 行修复版（旧 404），/daemon/latest.json 正确，/daemon/latest/sillyhub-daemon.js 经 proxy 下载 2289711 字节 = 源文件字节（大文件无损，证实 knowledge 2026-07-01 socket hang up 坑对静态 FileResponse 不适用），mcp-server.js 可达；⑥端到端：从用户原始命令地址 3000 拉 install.sh + PATH 无 node 跑 check_node → 1d 注册表兜底成功检测 /e/Software/nodejs/node.exe v24.14.1。用户原始 404 命令（curl ...:3000/daemon/install.sh | bash）现已可用。

## ql-20260713-003-b3d7 | 2026-07-13 16:37:50 | WSL 下 install.sh 1c/1d 盘符转换 bug——Windows 路径只转 /e/（Git Bash 风格），WSL（/mnt/e/）下 -f 失败 → CMD→bash(WSL) 跑报"未检测到 node"
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/scripts/install.sh（1c/1d 盘符转换抽 win_to_unix_path 函数，按 IS_WSL 决定 /mnt/drive/ vs /drive/）
需求：用户 node 装在 E:\Software\nvm（nvm-windows，NVM_SYMLINK=E:\Software\nodejs → E:\Software\nvm\v24.14.1），从 CMD 跑 `curl .../daemon/install.sh | bash` 报"未检测到 node，安装中止"。
根因：用户系统装了 WSL（Ubuntu+docker-desktop），CMD 敲 `bash` 解析到 WSL bash.exe（不是 Git Bash），install.sh 在 WSL 跑（IS_WSL=1）。1c（cmd.exe where node）+ 1d（powershell 注册表 PATH）都成功找到 Windows node `E:\Software\nodejs\node.exe`，但盘符转换硬编码 `/${drive}${path:2}`（Git Bash 风格 /e/），WSL 下访问 /e/ 不存在（应 /mnt/e/）→ `[[ -f /e/... ]]` 失败 → NODE_BIN 空 → 未检测到 node。诊断实证：WSL 下 /mnt/e/Software/nodejs/node.exe 存在（91MB），/mnt/c/ 下 cmd.exe+powershell.exe 可达；WSL bash 跑 check_node 完美复现"未检测到 node"。1a command -v node 也失败（WSL PATH 不含 Windows node），1b 候选无 /mnt/e/，故 1c/1d 是唯一救命稻草却被盘符转换坑了。
方案：抽 `win_to_unix_path` 函数（反斜杠→正斜杠 + 小写盘符 + 按 IS_WSL 加 /mnt/ 前缀），1c（L132-134）+ 1d（L167-169）两处盘符转换改调它。Git Bash（IS_WSL=0）输出 /e/... 不变；WSL（IS_WSL=1）输出 /mnt/e/... 修复。
结果：①install.sh 加 win_to_unix_path 函数 + 1c/1d 两处盘符转换改调它（注释同步更新）；②`bash -n` SYNTAX_OK；③Git Bash（IS_WSL=0）win_to_unix_path 输出 /e/（不变）+ check_node 1a 命中（没改坏）；④WSL 内层（IS_WSL=1）跑改后脚本 check_node = 找到 node（注册表 PATH）: **/mnt/e/Software/nodejs/node.exe**（原转 /e/ -f 失败，现转 /mnt/e/ -f 成功）；⑤rebuild backend 部署（Dockerfile COPY scripts/install.sh 层更新，daemon bundle 未重打——install.sh 是独立脚本不经 ncc），容器 healthy；⑥端到端：服务端 3000 install.sh 含 win_to_unix_path（grep 4 处），WSL 内层从 3000 curl 拉脚本 + check_node = 找到 /mnt/e/Software/nodejs/node.exe v24.14.1 满足要求。用户原始 CMD→bash(WSL) `curl 3000/daemon/install.sh | bash` 命令现已能通过 node 检测。

## ql-20260713-004-7e2a | 2026-07-13 20:44:51 | WSL 下 install.sh INSTALL_DIR 用 WSL $USER(=root) 拼 /mnt/c/Users/root/ 不存在 → mkdir Permission denied；改用 cmd.exe %USERPROFILE% 拿真实 Windows 用户目录
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/scripts/install.sh（WSL 分支 INSTALL_DIR 改用 cmd.exe echo %USERPROFILE%，不再用 WSL $USER）
需求：ql-003 修复 node 检测后，install.sh 过了 check_node + fetch_latest，但 download_bundle 的 `mkdir -p "$BIN_DIR"` 报 `mkdir: Permission denied`，安装中止。
根因：install.sh WSL 分支（L36-43）`INSTALL_DIR="/mnt/c/Users/${USER}/.sillyhub/daemon"`，注释假设"WSL $USER = Windows 用户名"——错。WSL 的 $USER 是 Linux 用户名（用户 WSL 默认 root，whoami=root），≠ Windows 用户名（12532）。故 INSTALL_DIR=/mnt/c/Users/root/.sillyhub/daemon，/mnt/c/Users/root 不存在（Windows 用户目录是 12532），mkdir -p 在 C:\Users\ 下建 root/ 被 drvfs 拒（Permission denied）。诊断实证：WSL $USER=root、Windows cmd echo %USERPROFILE%=C:\Users\12532、/mnt/c/Users/ 下有 12532 无 root、mkdir /mnt/c/Users/root/... 复现 Permission denied。
方案：WSL 分支用 `/mnt/c/Windows/System32/cmd.exe /c "echo %USERPROFILE%"` 拿真实 Windows 用户目录（当前 Windows 会话用户，最准；powershell $env:USERPROFILE 在 WSL root 下不展开不可用），转 /mnt/<drive>/... 拼 INSTALL_DIR。cmd.exe 不可用时 fallback $USER（极少触发）。
结果：①install.sh WSL 分支 INSTALL_DIR 改用 cmd.exe echo %USERPROFILE% 拿真实 Windows 用户目录（C:\Users\12532），转 /mnt/c/Users/12532/.sillyhub/daemon；cmd.exe 不可用时 fallback $USER；②`bash -n` SYNTAX_OK；③诊断实证 cmd.exe echo %USERPROFILE%=C:\Users\12532（powershell $env:USERPROFILE 在 WSL root 下不展开）；④WSL 内层 bash -x 跑改后 install.sh → download_bundle 输出 "下载 sillyhub-daemon.js -> **/mnt/c/Users/12532/.sillyhub/daemon/bin/**..."，证明 INSTALL_DIR 正确指向 12532（原 root → Permission denied）+ mkdir 成功（进到下载步骤）；⑤rebuild backend 部署，服务端 3000 install.sh 含 USERPROFILE（grep 3 处）。mkdir Permission denied 已解决，install 流程推进到 download 阶段（download 用默认 8001 失败是 source 未传 server-url，用户实际传 3000 可下载）。

## ql-20260713-005-c4a1 | 2026-07-13 21:10:57 | 里程碑明细新建报 plan_workload string_type + 计划开始/完成时间选择不回显
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（明细 + 模块表单 plan_workload 提交转 String；明细 + 模块时间 Form.Item 加 name + getValueProps/normalize）
需求：里程碑明细新建提交报 `plan_workload` validation_error string_type（input 5）；计划开始/完成时间 DatePicker 选择后不回显。
根因（双）：①plan_workload 类型——表单 InputNumber 返回 number，明细提交 L1560 `(vals.plan_workload as string) || null` 是 TS 类型断言（运行时仍 number），模块提交 L1009 `vals.plan_workload ?? null` 也是 number；后端 ppm/plan schema `plan_workload: str | None`（String(64)）→ Pydantic string_type 报错。②时间不回显——明细表单 L1789/1802 + 模块表单 L1053/1063 的 DatePicker Form.Item **无 name 属性**，Form 不接管这俩字段，DatePicker value={toDay(form.getFieldValue(...))} + onChange setFieldValue 手动绑，但 setFieldValue 更新 Form store 不触发无 name 的 Form.Item 重渲染 → DatePicker value 不刷新 → 选了不回显（对比 L2294/2308 第三个表单时间字段有 name，正常）。
方案：①明细 L1560 + 模块 L1009 plan_workload 提交改 `vals.plan_workload != null && vals.plan_workload !== "" ? String(vals.plan_workload) : null`（运行时转 string）。②明细 + 模块时间 Form.Item 加 name（plan_begin_time/plan_complete_time）+ getValueProps（store string → DatePicker value dayjs）+ normalize（DatePicker dayjs → store string），Form 接管后回显；明细删 DatePicker 手动 onChange（联动改由已存在的 Form onValuesChange L1732 触发 recomputeComplete）。
结果：①明细 L1560 + 模块 L1009 plan_workload 提交改 String() 转换；②明细 L1789/1802 + 模块 L1053/1063 时间 Form.Item 加 name(plan_begin_time/plan_complete_time) + getValueProps(string→dayjs value) + normalize(dayjs→string store)，删手动 value/onChange；Form 接管后时间回显 + 联动改由已存在的 onValuesChange(L1732) 触发 recomputeComplete；③`pnpm typecheck` 通过；④eslint 单文件 0 error（18 warning 全既有 unused/hooks-deps，非本次引入），recomputeComplete 仍被 onValuesChange 调用未变 unused；⑤rebuild frontend 部署（compose 联动 backend），两容器 healthy，前端 3000 可访问(200)。UI 端到端（时间回显 + 提交 plan_workload=string 不再报 string_type）待用户浏览器验证。

## ql-20260713-006-2f8b | 2026-07-13 21:37:55 | 里程碑明细新建 Drawer 加「提交」按钮（创建+提交审核）+ 提交/保存成功刷新明细列表
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailDrawer 加提交按钮 + submitForReview；主组件 onSaved 加 detailTick 刷新 + expandRender 子表 key 联动重 mount）
需求：①新建里程碑明细 Drawer 在「保存」（创建草稿）旁增加「提交」按钮（创建并提交审核，draft→review）；②提交或保存成功后明细列表刷新（用户确认要加「提交」按钮区分保存）。
根因：①create 模式 footer 只有「保存」(submitText L1673 create→保存)，无「提交审核」入口——提交审核 = savePlanNodeDetailProcess `/process/save`（draft→review），对照 PlanDetailActions(ppm-status-actions.tsx L153-164) draft 状态「提交审核」按钮调 `onSubmit(id,"save")`；②DetailDrawer submit 成功调 onSaved(L1576)，主组件 onSaved(L670) 只 setDrawer 关抽屉不刷新——明细列表在里程碑展开行子表(ModuleLevelTable/DetailLevelTable)，三层各自 reload(useEffect [planNodeId])，主组件不触发子表刷新。
方案：①DetailDrawer 加 submitForReview 函数（create→拿 id→savePlanNodeDetailProcess 推进 draft→review；edit→update→save），footer create/edit 模式在「保存」旁加「提交」按钮；②主组件加 detailTick state，onSaved 关抽屉 + setDetailTick+1 + reload(psNodes)；expandRender 子表 key={`${node.id}-${detailTick}`}，detailTick 变子表重 mount 触发 reload（模块+明细）。
结果：①主组件加 detailTick state，onSaved(L670) 改为关抽屉 + setDetailTick+1 + reload(psNodes)；expandRender 两子表(ModuleLevelTable/DetailLevelTable)加 key={`${node.id}-${detailTick}`} + useCallback 依赖加 detailTick，detailTick 变→子表重 mount→reload(模块+明细)，解决三层各自 reload 主组件触达不到的难题；②DetailDrawer submit 加 autoSubmit 参数：create 拿 created.id/edit 用 detail.id，autoSubmit 时 savePlanNodeDetailProcess(id) 推进 draft→review（对照 PlanDetailActions draft「提交审核」=onSubmit(id,"save")）；footer create/edit 模式渲染「保存」(outline,submit()) + 「提交」(default,submit(true)) 两个按钮，其他模式保持原 submitText 按钮；③`pnpm typecheck` 通过；④eslint 单文件 0 error（18 warning 全既有）；⑤rebuild frontend 部署，两容器 healthy。UI 端到端（新建明细保存/提交 + 列表刷新）待用户浏览器验证。

## ql-20260713-007-a93e | 2026-07-13 22:07:23 | 修 ql-006 遗留：edit 模式 footer「提交审核」(PlanDetailActions) 与「提交」(submit(true)) 重复 + 「提交审核」走 handleSubmit 不刷新列表
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（footer 提交按钮只 create 模式；handleSubmit 成功后 reload + setDetailTick）
需求：保存后再编辑（edit 模式），footer 同时出现「提交审核」(PlanDetailActions) 和「提交」(ql-006 加的)，重复；点「提交审核」(PlanDetailActions→onSubmit→handleSubmit) 后页面列表不刷新。
根因：①footer L1699-1715 PlanDetailActions 在 detail 存在 + mode!==create 时渲染（draft→「提交审核」+「变更」），ql-006 加的「提交」按钮(submit(true))条件是 create||edit，edit 模式两者都显示 → 重复（且都调 savePlanNodeDetailProcess 提交审核，功能重复）；②「提交审核」走 PlanDetailActions onSubmit→主组件 handleSubmit(L273)，handleSubmit 成功后只 showToast 不 reload（只在并发错误 reload L342），明细状态变了但列表不刷新。
方案：①footer「提交」按钮条件从 (create||edit) 收窄到 create——edit 模式用 PlanDetailActions 的「提交审核」（detail 存在时 PlanDetailActions 提供），create 模式（无 detail，PlanDetailActions 不显示）才加「提交」；②handleSubmit try 末尾（save/reject/change 三分支成功后）统一加 setDetailTick+1 + reload(psNodes)，刷新明细列表。
结果：①footer 提交按钮条件收窄到 create——create 模式渲染「保存」+「提交」两按钮；edit/audit/approve/change/changeApprove 模式只渲染 submitText 按钮（edit 模式的「提交审核」由 PlanDetailActions 提供，不再与「提交」重复）；②handleSubmit try 末尾(save/reject/change 成功后)统一加 setDetailTick+1 + reload(psNodes)，流程动作成功后刷新明细列表；③`pnpm typecheck` 通过；④eslint 单文件 0 error（18 warning 全既有）；⑤rebuild frontend 部署 healthy。edit 模式不再有重复按钮，「提交审核」/「驳回」/「变更」成功后列表刷新。

## ql-20260713-008-3d7c | 2026-07-13 22:30:14 | 新建明细空表单能提交（缺必填校验）+ 审核人回显上次编辑明细的 UUID（onAddDetail 没清 detail 残留）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（onAddDetail 两处 setDrawer 加 detail:undefined；task_theme/审核人/审批人 Form.Item 加 required rules）
需求：①新建里程碑明细什么都不填都能提交（无必填校验）；②新建时审核人字段回显了上次编辑明细的审核人 UUID（如 1b689e04），用户没选却被填。
根因：①明细表单字段全无 rules（仅模块表单 module_name 有 required L1054），后端 create schema 全 optional（`| None = None`）不校验 → 空表单 validateFields 通过 → 提交；②onAddDetail 两处 setDrawer（L497-503/L519-525）只设 {open,mode:create,planNodeId,moduleId}，没清 detail——DetailDrawerState 部分更新 merge，detail 保持上次值（上次 edit 明细的 audit_user_id 残留）→ DetailDrawer detail=该明细 → initialValues audit_user_id=detail.audit_user_id → 回显上次审核人 UUID。
方案：①onAddDetail 两处 setDrawer 加 detail:undefined（清残留，新建时 detail 强制空）；②task_theme/audit_user_id/approve_user_id 三个 Form.Item 加 rules=[{required:true}]（任务主题是明细核心，审核人/审批人是流程必需）。
结果：①两处 onAddDetail（ModuleLevelTable L497 / DetailLevelTable L519）setDrawer 加 detail:undefined，新建时 detail 强制清空，initialValues 不再取残留明细的 audit_user_id；②task_theme/audit_user_id/approve_user_id 三个 Form.Item 加 rules=[{required:true}]，validateFields 校验必填，空表单提交被拦；③`pnpm typecheck` 通过；④eslint 单文件 0 error（18 warning 全既有）；⑤milestone-details 18 tests 全过；⑥rebuild frontend 部署 ready。新建明细空表单不能提交、审核人不再回显上次 UUID。

## ql-20260713-009-6e1a | 2026-07-13 22:54:09 | 全局关闭里程碑明细审批流程——去审核/审批人字段 + PlanDetailActions（列表行+footer）+ 提交审核按钮 + submit autoSubmit
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
需求：里程碑明细暂时不需要审批流程——用户选「全局关闭审批」，新建/编辑/列表所有审核审批操作去掉。
方案：前端去掉所有审批 UI：①列表明细行 PlanDetailActions(L1279) 去；②DetailDrawer footer PlanDetailActions(L1725 edit 流程动作) 去；③footer「提交」按钮(create 模式 L1756) 去，只留「保存」；④新建表单审核/审批人 grid div(L1898 审核+审批 Form.Item) 去；⑤submit autoSubmit(L1555 签名 + L1598 if save 推进审核) 去，恢复只 create/update。明细 create 后保持 draft（不走 review/approve）。后端状态机不改（保留，前端不触发审批流转）。
结果：①列表明细行 PlanDetailActions(L1279) 去掉；②DetailDrawer footer 去掉 PlanDetailActions + 「提交」按钮，简化为「关闭」+ submitText 按钮（create=保存）；③新建表单审核/审批人 grid div 去掉；④submit 去 autoSubmit 签名 + savedId + if save 逻辑，恢复只 create/update；⑤`pnpm typecheck` 通过；⑥eslint 0 error（19 warning，+1 为去 PlanDetailActions 后 onSubmitDetail prop 暂留，无害）；⑦milestone-details 18 tests 过；⑧rebuild frontend ready。明细全局不再有审批入口（无审核/审批人字段、无提交审核/审核通过/变更按钮），create 后保持 draft。注：handleSubmit/审核信息块(L1941+ view 模式展示历史 audit 数据) 保留，不破坏已有明细查看。

## ql-20260713-010-5b2d | 2026-07-13 23:18:11 | 里程碑明细新建恢复「提交」按钮——提交=创建为正式(done，不走审核)，保存=草稿(draft)
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/schema.py（PsPlanNodeDetailCreate 加 status optional）+ frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（footer create 恢复「保存」+「提交」按钮 + submit autoSubmit 传 status=done）
需求：ql-009 全局关闭审批后用户反馈"提交功能也没了"，用户选「保存+提交都要」——保存=草稿，提交=创建为正式（直接生效，不走审核）。
根因：ql-009 去掉「提交」按钮（当时提交=提交审核 draft→review，审批流程一部分）。但用户要的"提交"=创建为正式（done），不是审核。后端 fsm draft→done 不允许（draft 只能→review），但 create 走 ORM 直接建（_Crud.create `**data`，L140 不走 fsm transition），故 create 时传 status=done 可直接创建为 done。
方案：①后端 schema PsPlanNodeDetailCreate 加 status: str | None = None（默认 None→model default draft）；②前端 footer create 模式恢复「保存」+「提交」两按钮；③submit 加回 autoSubmit 参数，create 时传 status= autoSubmit ? "done" : None——提交=done（正式/已完成），保存=draft（草稿）。
结果：①backend schema PsPlanNodeDetailCreate 加 status: str | None = None；②frontend ppm/types.ts PsPlanNodeDetailCreate 加 status?: string | null；③page.tsx footer create 模式恢复「保存」+「提交」两按钮（其他模式保持 submitText 单按钮）；④submit 加回 autoSubmit 参数，create 时 autoSubmit 传 status="done"（提交=正式），不传=draft（保存=草稿）；⑤backend ruff check 过 + frontend typecheck 过；⑥frontend milestone-details 18 tests + backend plan 41 tests 全过；⑦rebuild backend+frontend ready。新建明细「保存」=草稿、「提交」=创建为正式(done，不走审核)。


## ql-20260714-001-8c02 | 2026-07-14 09:08:08 | 里程碑明细导出按钮 422——plan 子域 export-excel 路由被 {item_id} 拦截
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/router.py（/plan-node-detail/export-excel + /plan-node/export-excel 前置于各自 {item_id} 路由）+ backend/app/modules/ppm/plan/tests/test_router.py（新增路由顺序回归测试 2 例）
根因：FastAPI 按路由注册顺序匹配。/plan-node-detail/{item_id}(原 L490) 注册在 /plan-node-detail/export-excel(原 L689) 之前，字面量 export-excel 被路径参数吞掉当 UUID 解析 → 422。同源 bug：/plan-node/export-excel 被 /plan-node/{item_id} 同样拦截。先例：/project-plan/export-excel(L333 前置于 {item_id}) + problem 子域 ql-020 同款修复。
方案：把两个 export-excel 路由（连同各自 _xxx_COLUMNS）从文件底部移到各自 {item_id} GET 路由前注册，加 ⚠ 注释引用 ql-020 先例；底部 section header 改为「Excel 响应构造」（只剩 _build_excel_response）；新增 test_router.py 参数化回归测试断言两路径返回 200+xlsx（修复前应为 422）。
结果：①router.py 两路由顺序修正（grep 确认 export-excel 均在 {item_id} 前）；②test_router.py 2 例过；③plan 模块 49 测试全过 + ruff 过；④QUICKLOG 510 行轮转为 dated 归档。里程碑明细 + 计划节点模板导出按钮恢复正常。











