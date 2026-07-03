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
