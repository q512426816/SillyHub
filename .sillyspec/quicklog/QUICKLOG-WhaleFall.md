
## ql-20260729-001-b3af | 2026-07-29 09:25:52 | 修 GET /api/llm-providers 500——deploy/.env 主密钥配成非 hex 标识串致 crypto.get_cipher() 崩溃，换合法 hex 密钥重建容器
状态：已完成
关联变更：（无）
文件：deploy/.env（第5行 SILLYSPEC_MASTER_KEY 由非十六进制标识串 msk-sillyhub-dev-90d223fd-... 替换为 v1:a3d891895cfe95451180d825586e01b9fec5bf57f349296b9e029821e5664894 合法主密钥；该文件 .gitignore 不入 git，仅本地部署生效，改动靠重建容器重读 env 落地）
需求：修复 GET /api/llm-providers 返回 500 Internal Server Error。
根因：deploy/.env 的 SILLYSPEC_MASTER_KEY 被配成非十六进制标识串 msk-sillyhub-dev-...，而 backend/app/core/crypto.py 的 _load_master_key() 用 bytes.fromhex() 解析，在 get_cipher() 阶段于位置0直接抛 ValueError，导致 list_providers 构造 LlmProviderService 时崩溃，所有走 CredentialCipher 的接口全部 500。
方案：用 secrets.token_hex(32) 生成合法主密钥 v1:a3d891...e5664894（v1:前缀+64位hex），替换 deploy/.env 第5行；docker compose up -d --force-recreate backend 重建容器重读 env（启动含 alembic upgrade head && uvicorn）。
结果：容器 healthy；新密钥已注入（v1:前缀/67字符）；GET /api/llm-providers 由 500 变为 401（get_cipher 不再崩溃、链路恢复），前端代理 3000 同为 401；未改代码无测试受影响；换密钥零数据风险（llm_providers/git_identities 表均空、api_keys 为 hash 存储不依赖 master key）。

## ql-20260729-002-4791 | 2026-07-29 11:11:12 | daemon 未配供应商时用宿主机 ~/.claude 配置(有启用才隔离)
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/spawn-env.ts（buildSpawnEnv 的 CLAUDE_CONFIG_DIR 条件化）+ sillyhub-daemon/tests/spawn-env.test.ts（+4 新测试 / 修 1 旧测试）
需求：没配置供应商、或配置了但没启用时，daemon spawn 的 claude 直接用宿主机 ~/.claude/settings.json（cc-switch/手配）；有启用的供应商才隔离运行。
根因：spawn-env.ts:155 无脑 `env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR`（强制隔离），未配供应商时 lease 不带 provider_config（层0 跳过）+ 隔离目录空（无 settings.json/credentials.json）→ claude CLI 无凭证 → 报 "Not logged in · Please run /login"。
方案：CLAUDE_CONFIG_DIR 条件化——仅 ctx.provider_config 存在（启用供应商，平台下发）时才设隔离目录（避免 cc-switch 污染平台注入）；否则不设 + 清 process.env 可能残留的 CLAUDE_CONFIG_DIR，claude CLI 回退读默认 ~/.claude/settings.json（cc-switch/手配生效）。加 4 个新测试覆盖（有 provider_config→隔离 / 无→不隔离 / null→不隔离 / 残留清理）；修 1 个旧测试（codex provider_config 存在但 injector 未注册 → 仍隔离，不再 toEqual absent）。
结果：spawn-env 27/27 passed；daemon 全量 2033 passed（5 failed 均为预存的 spy/路径失败，与本次无关）；tsc 0 error；bundle + dist 编译完成，npm 全局目录=项目目录已含新逻辑，daemon 已重启（registered+started）。

## ql-20260730-001-04ac | 2026-07-30 08:34:29 | agent 会话气泡三层(思考/工具折叠+回复突出)
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/session-log-sanitize.ts（加 classifySessionLog 分类 + sanitize 剥 TOOL 前缀）+ frontend/src/components/daemon/interactive-session-panel.tsx（SessionTurnView 加 thinking/toolEvents + SessionToolEvent 类型 + onLog 分流 + 占位×3 + 渲染三层）+ frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 历史同步分流）+ frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts（改 tool_call 测试 + 加 classify 6 测试）+ frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（mock turn 加字段）
需求：agent 会话气泡里思考过程/工具调用/回复混排不直观，要按原型（思考+工具折叠默认收起，回复突出）。
根因：interactive-session-panel turn.output 把一回合所有日志（[THINKING]+[TOOL_USE]+[TOOL_RESULT]+[ASSISTANT]）拼成一串整段 MarkdownText 渲染；sanitize 只剥 [THINKING] 前缀但保留思考内容，导致思考混进正文。
方案：① sanitize 加 classifySessionLog（按 [THINKING]/[TOOL_USE]/[TOOL_RESULT] 标记 + channel 分 thinking/tool_use/tool_result/assistant/skip）+ 剥 TOOL 前缀（去 tool_call 🔧 分支，tool 走卡片自带图标）；② SessionTurnView 加 thinking（思考累积）+ toolEvents（SessionToolEvent 列表，raw/result/status）；onLog 按 classify 分流（thinking 累积 / tool_use push / tool_result 配对最近 running 的 ok/deny / assistant 进 output）；占位 turn×3 + newTurn 加字段；③ 渲染 agent 气泡三层（复用 agent-log CollapsibleSection：思考默认折叠 50 字摘要 / 工具默认折叠 N 个 + ✓✗⏳ 状态 + 命令+结果 / 回复 MarkdownText 突出，分隔线隔开）；④ logsToTurns 历史会话同步分流。
结果：tsc --noEmit 0 error；全量 118 文件 1152 passed（0 fail）。

## ql-20260730-002-2356 | 2026-07-30 09:05:00 | agent 会话工具卡片命令形式+复制按钮(优化 ql-001)
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/interactive-session-panel.tsx（加 parseToolRaw helper + 工具卡片渲染改命令形式+复制）
需求：工具调用卡片显示原始 JSON 对象（{"tool":"Bash","args":{...},...}），优化成命令形式 + 复制按钮。
根因：ql-001 的 toolEvents.raw 直接整段渲染（daemon 推的完整 JSON），未解析，难看。
方案：加 parseToolRaw helper（JSON.parse raw → 按工具类型提取：Bash→command / Write,Edit,Read→file_path+content / Agent→description / 通用→args JSON）；工具卡片渲染：工具名标签用解析的 tool 名（替代固定"工具"）、命令显示 primary（command/file_path 等，代码字体）、加"复制"按钮（navigator.clipboard.writeText copyText）。解析失败（非 JSON）原样显示 raw 兼容。
结果：tsc --noEmit 0 error。

## ql-20260730-003-4a35 | 2026-07-30 09:21:41 | 会话折叠样式对齐原型(灰底思考/蓝底工具)
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/interactive-session-panel.tsx（加 SessionCollapsible 组件 + 替换 CollapsibleSection + 删 import）
需求：思考/工具折叠样式和原型差别大，对齐原型（灰底思考 / 蓝底工具折叠条）。
根因：复用了 agent-log 的 CollapsibleSection（纯文字小箭头 text-zinc-500 + Chevron + 斜体摘要，无卡片视觉），与原型的灰底/蓝底折叠条不搭。
方案：加 SessionCollapsible 组件（对齐原型：思考 bg-zinc-100 border-zinc-200 text-zinc-600 / 工具 bg-blue-50 border-blue-200 text-blue-700；▶▼ 箭头 + 摘要 truncate；展开内容区白底带顶边框），替换两处 CollapsibleSection，删其 import。
结果：tsc --noEmit 0 error；interactive-session-panel 40 测试过。
## ql-20260730-004-9f0a | 2026-07-30 15:21:13 | 会话回复格式修复——reply 流式 delta 改直接 concat(去掉 \n 拼接)
状态：已完成
关联变更：（无）
文件：frontend/src/components/daemon/interactive-session-panel.tsx（onLog reply 分支 :323 去掉 (output?'\n':'')，改直接 concat output+seg.text）
     + frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns :237 outputs.join('\n')→join('')，与实时 onLog 一致）
     + frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（:48 reply 拼接断言改 concat 语义）
需求：会话气泡里 agent 回复的 markdown 标题/列表与正文粘成一行、没格式重点（实测会话 7fb9227d logs 确诊）。
根因：agent 一段连续回复被 daemon 拆成多个 ASSISTANT 流式 delta（7fb9227d 的 #30/#31/#32/#33/#34 是同一段流式输出的连续片段），前端 onLog/logsToTurns 却当独立段落用 \n 拼接，在原本连续的文本（如 #32 结尾"这" + #33"通常需要在" 本是连续的"这通常需要在"）里插入 \n，破坏 markdown 连续结构和列表；delta 内部换行（\n\n）数据层是有的、没丢，问题在前端拼接。
方案：reply 流式 delta 直接 concat（去掉 \n 分隔）——它们是同一段流式输出的连续片段（非独立段落），换行保留在各 delta 内部，直接拼接让 agent 原始 markdown 连续完整渲染。实时 onLog（interactive-session-panel.tsx:323）+ 历史回看 logsToTurns（runtime-session-helpers.tsx:237）两处同改保持一致。不碰 thinking/tool/stderr 的 processItems（独立过程项仍按到达顺序）、不碰 daemon（重复 #35 是 daemon bug 另行处理）、不改 MarkdownText 渲染器。
结果：vitest 3 文件 77 passed（runtime-session-helpers 8 + interactive-session-panel 41 + session-log-sanitize 28，含更新后的 reply concat 断言）；daemon 当前 offline 无法实跑验证，靠单测验证拼接逻辑。

## ql-20260730-005-1891 | 2026-07-30 15:45:17 | /ppm/weekly-plan 页面加独立菜单权限 ppm:weekly-plan:view
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/auth/permissions.py（新增枚举 PPM_WEEKLY_PLAN_VIEW = "ppm:weekly-plan:view"，group 靠 ppm: 前缀自动归 PPM 组）
- backend/migrations/versions/202607041000_seed_ppm_permissions.py（PPM_PERMISSIONS 列表双写 "ppm:weekly-plan:view"，覆盖新环境从头 seed + 单一真源完整）
- backend/migrations/versions/202607301000_seed_ppm_weekly_plan_perm.py（新建增量 migration：down_revision=202607291100 head，幂等给已上线 platform_admin 补种，downgrade 精确删单条）
- backend/tests/modules/auth/test_ppm_permissions.py（EXPECTED_PPM_PERMISSIONS 加 PPM_WEEKLY_PLAN_VIEW，count 用例 17→18）
- backend/openapi.json（gen:types 重新 dump，Permission 枚举含 ppm:weekly-plan:view）
- frontend/src/lib/menu-permissions.ts（ppm-weekly-plan 菜单 permissions:[] → [{key:"ppm:weekly-plan:view",name:"项目计划查看"}]）
- frontend/src/lib/__tests__/menu-permissions.test.ts（镜像 BACKEND_PERMISSION_KEYS 63→64、PPM 注释 16→17、删 weekly-plan 跳过、加 ppm-weekly-plan 精确匹配用例）
- frontend/src/lib/api-types.ts（gen:types 生成，含新枚举）
- sillyhub-daemon/src/api-types.ts（gen:types 同步，含新枚举）
需求：/ppm/weekly-plan「项目计划」页面对所有登录用户无门槛可见，需像其它 ppm 菜单（如看板 ppm:kanban:view）一样配独立菜单权限，使无此权限的用户侧边栏看不到、角色管理可分配/回收。
根因：menu-permissions.ts 中 ppm-weekly-plan 菜单 permissions 为空数组 []，canSeeMenu 对空权限组放行致全员可见；后端亦无 ppm:weekly-plan:view 枚举与 platform_admin seed，角色管理无从分配。
方案：①后端 permissions.py 新增 PPM_WEEKLY_PLAN_VIEW 枚举（group 靠 ppm: 前缀自动归 PPM 组，无需改 group 判定）；②20260741000 PPM_PERMISSIONS 列表双写该 key 覆盖新环境 seed，并新建增量 migration 202607301000（down_revision=202607291100 head）幂等给已上线 platform_admin 补种——因 PPM 已上线、原 seed revision 已应用不会重跑，必须增量补，否则连平台管理员都看不到该菜单；③前端 menu-permissions.ts 填权限 key；④ppm 域后端 router 统一 get_current_principal + DataScope 仅认证不授权（data_scope.py 注释"与功能权限正交"），故不改 plan/router.py，与 kanban 等其它 ppm 菜单一致；⑤gen:types 刷新 backend/openapi.json + frontend 与 daemon 两处 api-types.ts，避免类型落后后端。
结果：后端 pytest test_ppm_permissions.py 24 passed（含 count=18、新增成员存在、platform_admin seed 含 weekly-plan、归 PPM 组、非系统角色回归）；前端 vitest menu-permissions + permission 共 60 passed（含 ppm-weekly-plan 精确匹配、镜像常量 64、删跳过后全菜单≥1 权限）；alembic 单 head 202607301000、chain 202607291100→202607301000 正确无多 head；gen:types 三处类型文件均含 ppm:weekly-plan:view。遗留：weekly-plan 与 ppm-project-plans 的 menuLabel 均为「项目计划」系既有重名，不在本次范围，未处理。
## ql-20260730-006-a837 | 2026-07-30 16:22:48 | 将 /ppm/weekly-plan 改名为「实施计划汇总」（消除与 ppm-project-plans 重名）
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/menu-permissions.ts（ppm-weekly-plan 菜单 menuLabel「项目计划」→「实施计划汇总」，权限 name「项目计划查看」→「实施计划汇总查看」）
- frontend/src/app/(dashboard)/ppm/weekly-plan/page.tsx（PageHeader title + 文件头注释「项目计划」→「实施计划汇总」，subtitle 不含该词保留）
- frontend/src/lib/ppm/weekly-plan.ts（API client 文件头/分页/导出注释 + 导出默认文件名 项目计划.xlsx→实施计划汇总.xlsx）
- frontend/src/lib/ppm/types.ts（Weekly Plan 段 3 处类型注释：段头/行/查询参数）
- backend/app/modules/ppm/plan/router.py（weekly-plan 段：导出文件名 timestamped_filename + 4 docstring + 段注释；仅 weekly-plan 段，不动 project-plan 段）
- backend/app/modules/auth/permissions.py（PPM_WEEKLY_PLAN_VIEW 枚举注释）
- frontend/src/lib/__tests__/menu-permissions.test.ts（BACKEND_PERMISSION_KEYS 上方注释）
- backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts（gen:types 同步，weekly-plan 端点描述更新）
需求：/ppm/weekly-plan 与 ppm-project-plans 侧边栏菜单都叫「项目计划」，两个同名菜单并列易混淆，需把 weekly-plan 改成区分名「实施计划汇总」。
根因：weekly-plan 的侧边栏 menuLabel、页面 PageHeader title、前后端 Excel 导出文件名等全套沿用「项目计划」，与 ppm-project-plans（PsProjectPlan 数据）完全撞名。
方案：把 weekly-plan 专属的 21 处「项目计划」文案统一改为「实施计划汇总」——侧边栏 menuLabel + 权限显示名（角色管理）+ 页面标题 + 前端导出默认名 + 后端导出文件名 + 相关代码注释/docstring；改后端 router docstring 后跑 gen:types 同步 openapi.json 与 frontend/daemon 两处 api-types.ts 的端点描述。严格只动 weekly-plan 专属文案，绝不碰 ppm-project-plans（PsProjectPlan）任何「项目计划」；移动端工作台 m/ppm/workbench:931 的「项目计划」入口经确认 href 指向 /ppm/project-plans，不在本次范围。
结果：纯 weekly-plan 文件（page.tsx/weekly-plan.ts）残留「项目计划」=0；21 处「实施计划汇总」落点全为 weekly-plan 相关；ruff format/check 全过；前端 vitest menu-permissions+permission 共 60 passed（无字面断言依赖改名）；gen:types 三处类型同步。后端导出文件名改动需重建 backend 容器才生效。
## ql-20260731-001-2290 | 2026-07-31 13:25:03 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx

需求：/ppm/milestone-details 查询条件右上角按钮布局对齐 /ppm/projects(个性化按钮在左,搜索/重置/展开在右)。
根因：milestone-details 顶部按钮行现状为【重置|分隔|导出|新建里程碑|刷新】(重置在最左、个性化在右),与 projects(PpmResourceTable D-006:数据组左|分隔|基础组右)相反。
方案：重排 milestone-details(page.tsx:611-640)按钮为【导出|新建里程碑|刷新】(数据组/个性化,左) | 竖分隔 | 【重置】(基础组,最右),对齐 projects;注释同步。本页无搜索/展开按钮(前端实时过滤 grid + 查询条件无折叠)。
结果：1 文件改动(frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx),typecheck 绿 + milestone-details 24 测试绿,无回归。
## ql-20260731-002-46ef | 2026-07-31 13:50:27 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx

需求：milestone-details 刷新按钮归基础功能组(右)+文案改搜索,对齐 projects 基础组(搜索|重置)。
根因：上个 quick 把刷新归到了数据组(个性化,左),但刷新属于基础查询操作(同搜索/重置/展开),应在基础组(右)。
方案：刷新按钮从数据组(分隔前)移到基础组(分隔后,重置前),文案刷新→搜索,type=primary(对齐 projects 搜索),功能保持 reload(重新拉数据+应用过滤)。数据组只剩导出/新建里程碑。
结果：1 文件改动(milestone-details/page.tsx),typecheck 绿 + 24 测试绿,无回归。
## ql-20260731-003-85ca | 2026-07-31 14:24:06 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx

需求：/admin/roles 查询条件右上角按钮布局对齐 /ppm/projects(FRONTEND_PAGE_STYLE §2 规范:数据组左|分隔|基础组右)。
根因：/admin/roles 工具栏现状为【搜索|重置|分隔|新建角色】(基础组在左、数据组在右),与规范相反;且用 size=sm(规范 §5 禁 small,字顶边框)。
方案：重排为【+新建角色】(数据组,左) | 竖分隔 |【搜索|重置】(基础组,右);去 size=sm 用默认 middle;新建角色/搜索 variant=default(主操作)、重置 outline(次)。shadcn Button 保持(整页一致),variant 对应 antd type 语义。规范文档(FRONTEND_PAGE_STYLE §2)已完整,本次只是应用,不改规范。
结果：1 文件改动(admin/roles/page.tsx),typecheck 绿(admin/roles 无测试文件),无回归。
## ql-20260731-004-13f4 | 2026-07-31 14:39:09 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx

需求：/admin/roles 操作列样式对齐 /ppm/projects 与 milestone-details(走 FRONTEND_PAGE_STYLE §4/§5 规范)。
根因：admin/roles 操作列用 3 个原生 <button>(text-primary/destructive + hover:underline)+ align=right + justify-end gap-2,与规范(antd Button type=link size=small、删除 link danger、align center、fixed right、justify-center gap-1)不符;milestone-details 操作列已符合,唯独 admin/roles 不一致。
方案：操作列 3 个原生 button → antd Button(别名 AntButton,因 shadcn Button 已占名)type=link size=small(编辑/禁用启用)、type=link danger size=small(删除);align right→center;加 fixed=right + width=180 + onCell 不透明背景(防固定列穿透);justify-end gap-2 → justify-center gap-1。
结果：1 文件改动(admin/roles/page.tsx),typecheck 绿,操作列与 projects/milestone-details 统一。
## ql-20260731-005-6824 | 2026-07-31 15:44:01 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx

需求：/admin/roles 完全 antd 化(FRONTEND_PAGE_STYLE §5「全部用 antd Button,不用 shadcn Button」)。
根因：该页混用 antd+shadcn+自定义,工具栏 Button/Badge/删除确认 modal Button 是 shadcn(@/components/ui/button + @/components/ui/badge),不符 §5。
方案：删 shadcn Button/Badge import;统一 antd Button——工具栏新建/搜索 type=primary、重置 default;error 重新加载 default size=small;删除确认 modal 取消 default/确认 type=primary danger;操作列 AntButton 别名→Button(type=link/link danger size=small);shadcn Badge→antd Tag(平台级 color=blue、工作区级默认、超管/普通 color=success、禁止登录 color=error)。逻辑不变,仅组件库统一。
结果：1 文件改动(admin/roles/page.tsx),shadcn 残留 0,typecheck 绿。
## ql-20260731-006-e2f3 | 2026-07-31 16:37:49 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx, frontend/src/components/admin-role-permission-picker.tsx

需求：新建角色 Modal 内部组件全部 antd 化(用户看到 antd Modal 外壳但内部原生 input,不像 antd)。
根因：task-01 只换了 Modal 外壳,内部 Key/名称用原生 <input>+inputCls、描述用原生 <textarea>+textareaCls、权限选择原生 checkbox + setIndeterminateRef,没换 antd 组件。
方案：Key/名称原生 input→antd Input;描述原生 textarea→antd Input.TextArea(rows=3);权限单选原生 checkbox→antd Checkbox;全选原生 checkbox+setIndeterminateRef→antd Checkbox(indeterminate prop 支持,删 ref 手写)。逻辑不变,仅组件库统一。
结果：2 文件改动(admin/roles page.tsx + admin-role-permission-picker.tsx),typecheck 绿 + picker 7 测试绿(antd Checkbox 不破坏现有断言)。
## ql-20260801-001-f6f1 | 2026-08-01 15:29:05 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx

需求：/admin/roles 权限列显示中文(现在显示英文 key 不直观)。
根因：权限列 renderPermissionsCell(:367)直接 join 权限 key 数组(workspace:read/change:create 等英文),用户看不懂;menu-permissions 已有 {key, 中文name} 但没用上。
方案：建 PERMISSION_NAME_MAP(从 MENU_PERMISSION_GROUPS flatMap 全部 {key:name}),权限列把 key 转中文 name 显示(找不到 name 兜底保留原 key),前 3 个中文 + '+N more',加 title 悬停显示全部中文。
结果：1 文件改动(admin/roles page.tsx),typecheck 绿。
## ql-20260801-002-5932 | 2026-08-01 16:06:43 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx

需求：/admin/roles 权限列中英混杂(部分系统权限 key 显示英文)。
根因：ql-001 建的 PERMISSION_NAME_MAP 只覆盖 menu-permissions 的 59 个 key,但 DB 有 68 个 key,其中 9 个系统/旧权限(component:admin/write/daemon:borrow/platform:admin/billing/ppm:plan:read/problem-change:read/problem:read/task:read)不在 menu-permissions 定义 → map 兜底英文 → 混杂。
方案：PERMISSION_NAME_MAP 补 9 个 fallback 中文(component:admin 组件管理/component:write 组件编辑/daemon:borrow daemon 借用/platform:admin 平台管理/platform:billing 平台计费/ppm:plan:read 计划查看/ppm:problem-change:read 问题变更查看/ppm:problem:read 问题查看/ppm:task:read 任务查看)。
结果：1 文件改动(admin/roles page.tsx),typecheck 绿,权限列全中文(68 key 覆盖)。
## ql-20260803-001-18e1 | 2026-08-03 08:33:39 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/roles/page.tsx

需求：权限列悬停查看用 antd Tooltip(现在用原生 title 属性)。
根因：ql-001 用原生 HTML title 属性做悬停提示(浏览器原生样式,非 antd,延迟长+无样式控制)。
方案：import Tooltip from antd;renderPermissionsCell 的 <span title=...> → <Tooltip title=中文(顿号分隔) overlayStyle maxWidth=400><span>...</span></Tooltip>。antd Tooltip 统一悬停样式+可控宽度。
结果：1 文件改动(admin/roles page.tsx),typecheck 绿。