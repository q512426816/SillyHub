
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
根因：admin/roles 操作列用 3 个原生 button(text-primary/destructive + hover:underline)+ align=right + justify-end gap-2,与规范(antd Button type=link size=small、删除 link danger、align center、fixed right、justify-center gap-1)不符;milestone-details 操作列已符合,唯独 admin/roles 不一致。
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
根因：task-01 只换了 Modal 外壳,内部 Key/名称用原生 input+inputCls、描述用原生 textarea+textareaCls、权限选择原生 checkbox + setIndeterminateRef,没换 antd 组件。
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
## ql-20260803-002-e6c7 | 2026-08-03 08:52:34 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/users/page.tsx, frontend/src/components/admin-user-drawer.tsx

需求：/admin/users 按 FRONTEND_PAGE_STYLE §2/§4/§5 调整 + 全 antd 化。
根因：该页混用 shadcn Button(@/components/ui/button,variant/size=sm)+ 操作列 align right + justify-end gap-1 + 工具栏顺序反(搜索重置左、新建右),与规范不符。
方案：删 shadcn Button import,统一 antd Button——工具栏新建左 type=primary|分隔|搜索 type=primary/重置 default;操作列 align center + fixed right + justify-center gap-1 + onCell 背景 + type=link/link danger size=small;error 重新加载 / 会话审计 Drawer 关闭 / 重置密码 modal / 删除 confirm / 撤销 全换 antd Button;admin-user-drawer 底部 Button shadcn→antd(取消 default/保存 primary)。
结果：2 文件改动(users/page.tsx + admin-user-drawer.tsx),shadcn 残留 0,typecheck 绿。
## ql-20260805-001-6dcd | 2026-08-05 09:24:29 | 修 daemon HostFsHandler allowed_roots 冻结
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/host-fs-handler.ts — HostFsHandlerOptions `allowed_roots` 改 `rootsProvider: () => string[]`；字段 `_allowedRoots` 改 `_rootsProvider`；17 处 `assertWithinAllowedRoots(x, this._allowedRoots)` 全改 `this._rootsProvider()`（stat/read_file/list_dir/git_apply/git_worktree_add/git_merge/git_worktree_remove/git_rev_parse/read_package_json）
- sillyhub-daemon/src/daemon.ts — `_registerHostFsRpcHandler` 构造 handler 传 `rootsProvider: () => this._effective AllowedRoots()`；新增 `_effectiveAllowedRoots()` 合并 `config.allowed_roots ∪ policyCache 各 runtime roots 并集`

需求：平台 scan-generate（初始化扫描）报 "root_path does not exist or is not a directory: F:/WorkNew/SillyHub"，但路径宿主机 + 容器内都实际存在。
根因：HostFsHandler._allowedRoots 构造时 readonly 快照（daemon.ts:2289 用 config.allowed_roots，host-fs-handler.ts:448,451），平台 PUT allowed_roots 只更新 daemon PolicyCache（_handlePolicyUpdate/_syncAllowedRoots），handler 永不刷新 → host_fs.stat 路径在旧根（默认 [homedir()] = C:\Users\12532）外抛 forbidden → backend DaemonRpcRemoteError 降级 {exists:False} → 报路径不存在。task-03（2026-07-06-daemon-host-fs-delegate）以来一贯 bug，非 daemon-version 引入。
方案：HostFsHandler 改 rootsProvider callback（每次 RPC 现取动态 allowed_roots，解决冻结），17 处用法全改 _rootsProvider()；daemon.ts 传 rootsProvider:()=>_effectiveAllowedRoots()，新增 _effectiveAllowedRoots 合并 config.allowed_roots ∪ policyCache 各 runtime roots 并集（platform PUT 热更新即时生效）。一处修复解决全部 9 个 host_fs 方法。
结果：pnpm build tsc 编译 OK 无 error；重启 daemon 后 scan-generate 不再报 root_path does not exist（host_fs stat 通过，冻结修复），9 个 host_fs 方法一次性解决；scan 新报错变为资产保护（F:/WorkNew/SillyHub 自身是 SillySpec 管理项目，平台 scan 会删 .sillyspec，属预期保护，非 host_fs bug）。

## ql-20260805-002-81bcea8 | 2026-08-05 14:07:35 | daemon 机器头启动时间改绝对显示（不要相对「几分钟前」）
状态：已完成
关联变更：2026-08-05-daemon-start-time（已归档；本条是其前端显示微调，非新 change）
文件：
- frontend/src/components/daemon/machine-card.tsx — started_at 显示由 formatRelativeTime（相对「N 分钟前」）改 new Date(iso).toLocaleString("zh-CN",{hour12:false})（绝对「2026/8/5 14:07:35」）；去 title tooltip 冗余（显示已绝对）；注释更新（相对→绝对）

需求：用户反馈 /runtimes 机器头「启动」显示「几分钟前」（相对），要看准确启动时刻。
根因：task-07 初版复用 formatRelativeTime 做相对时间（仿 last_heartbeat_at 鲜活），但启动时间不像心跳需相对鲜活，用户要绝对时刻。
方案：started_at 非 null 直接 new Date(iso).toLocaleString("zh-CN",{hour12:false}) 显绝对（年月日时分秒 24h），去 title tooltip 冗余；null 仍「—」（旧 daemon 兼容）。
结果：1 文件改动（machine-card.tsx，6 insertions 12 deletions），commit 81bcea8c，commit hook 全过（backend ruff + frontend lint/typecheck/test），rebuild frontend + recreate 部署中。

## ql-20260805-002-1ab4 | 2026-08-05 20:55:50 | 修复 interactive run 终态 lost update（迟到的 submit_messages 不覆盖 close 写入的 completed）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/run_sync/service.py（submit_messages 的 pending→running 分支由 ORM 内存读改写改为 `update().where(AgentRun.status=='pending')` 原子条件 UPDATE，rowcount=0 即 DB 已被 close 推进终态则不覆盖）
- backend/app/modules/daemon/tests/test_submit_messages_no_overwrite_terminal.py（新增：双 session 制造旧快照竞态，验证迟到的 submit 不覆盖 completed + 正常 pending→running 回归）
- .sillyspec/docs/SillyHub/modules/daemon.md（变更索引追加 ql-20260805-002-1ab4）

需求：修复 interactive run 终态并发 lost update——迟到的 submit_messages 协程用旧快照覆盖 close_interactive_run 写入的 completed，致 agent_runs 卡 running、前端一直显示「等待本轮完成」。
根因：run_sync/service.py submit_messages 的 pending→running 分支用 ORM 内存读改写（status=='pending' 判断基于 session 旧快照），无原子条件/行锁，与 close 并发时 lost update。
方案：line 702-711 改成 update().where(AgentRun.id==,AgentRun.status=='pending').values(running) 原子条件 UPDATE，rowcount=0 即 DB 已被 close 推进终态则不覆盖；新增 test_submit_messages_no_overwrite_terminal.py（双 session 制造旧快照竞态 + 正常路径回归）。
结果：2 新测试 PASS；反向验证还原修复后 late_submit FAIL 证有效；close/session_status/interactive 回归 37 passed；1 个 gap-2 测试 pre-existing 失败（no such table:llm_providers,conftest 未注册,stash 验证与本次无关）。
## ql-20260806-002-56a3 | 2026-08-06 22:34:14 | 切换供应商后运行中会话 reload 不应变 ended（实测 45723d1d/9eed466e reload 后 ended）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts

需求：切换供应商后运行中会话 reload 不应变 ended（实测 45723d1d/9eed466e reload 后 ended）。
根因：reloadWithProvider 在 driver.start 新 query 之前就 close 旧 query（session-manager.ts），close 拉动旧 consume 协程退出 → session 收尾 ended。
方案：把 close oldQuery 移到 driver.start 成功 + 替换 state.query 之后（新 query 就位再 close，旧 consume 退出是正常 query 结束非 session 收尾）；catch 失败保留未 close 的 oldQuery 可恢复。
结果：tsc 过 + reload-provider 10 passed（AC-4 断言改：start 抛错时 close 0 次）。daemon rebuild+重启+实测待做。
## ql-20260807-001-d667 | 2026-08-07 09:05:44 | 修复切换供应商热切换 reload 后运行中会话被错误标 ended 的并发 bug
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-manager.ts（_runConsume 加 isAuthoritative orphan 谓词：捕获启动时 target，判 target===state.query/driverHandle，onError/catch/onResult/onMessage 入口判 orphan 静默 no-op，reload 换 query 后旧 consume 终态回调不再 fail 误杀新会话）
- sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts（新增 makeMockDriverWithAbortOnClose 工厂：fakeQuery.close 触发该 query 对应 consume 的 onError，模拟真实 SDK close→迭代器抛 abort 错；AC-6 回归测试断言 reload 后 status=active/onSessionEnd 未调/新 query 未误杀）
- .sillyspec/docs/SillyHub/modules/daemon.md（变更索引加 ql-20260807-001 条目；ql-20260806-002 标注「必要前提非完整修复，真实根因见 001」）

需求：修复切换供应商热切换 reload 后运行中会话被错误标 ended 的并发 bug。
根因：reloadWithProvider close 旧 query 时 SDK 迭代器抛 abort 错（Claude Code process aborted by user）→ driver consume catch → onError 静默 fail(sessionId)；reload 后 status=active 绕过 fail 守卫（只挡 ended/failed）→ _terminateSession 把新 session 打成 failed + close 新 query + onSessionEnd（backend ended）。ql-20260806-002 的 close 后移只是必要前提未堵此洞，mock consume 永不抛错致测试漏。
方案：_runConsume 加 isAuthoritative orphan 谓词（target===state.query），onError/catch/onResult/onMessage 入口判 orphan 静默 no-op；成立前提=c40b1319 先替换 state.query 再 close。加 AC-6 测试用 makeMockDriverWithAbortOnClose 模拟真实 close→抛错→onError。
结果：tsc --noEmit exit0；reload-provider 11 passed（含新 AC-6）；反向验证临时禁用守卫 AC-6 FAIL 复现 status=failed 证测试有效；daemon rebuild+部署待做。
## ql-20260807-002-cc75 | 2026-08-07 10:13:14 | 修复切换/停止供应商后 reload 运行中会话被 ended
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/input-queue.ts（新增 resetForResubscribe：reload 热切换前重置 _subscribed 订阅标记 + 清旧 _pending waiter，保留 _buffer pending inject，让新 query 能合法订阅同一队列——InputQueue 原单订阅设计第二次 [Symbol.asyncIterator] 抛 SessionQueueDoubleSubscribeError）
- sillyhub-daemon/src/interactive/session-manager.ts（reloadWithProvider driver.start 前调 inputQueue.resetForResubscribe + buildSpawnEnv 后强制 newEnv.CLAUDE_CONFIG_DIR=daemon 隔离目录；顶部 import CLAUDE_CONFIG_DIR from config.ts）
- .sillyspec/docs/SillyHub/modules/daemon.md（变更索引加 ql-20260807-002 真实根因条目；ql-001 orphan 守卫 + ql-006-002 close 后移标注为部分修复，ended 真正主因指向 002）

需求：修复切换/停止供应商后 reload 运行中会话被 ended。
根因：reload 复用 state.inputQueue 但 InputQueue 单订阅（_subscribed），create 时 SDK 已订阅，reload 新 query 第二次订阅抛 SessionQueueDoubleSubscribeError → SDK query abort（Operation aborted）→ onError → fail → onSessionEnd → backend end_session → session ended；停止（provider_config=null）buildSpawnEnv 不设 CLAUDE_CONFIG_DIR 回退 ~/.claude 但 jsonl 在 daemon claude-config → resume 找不到 → 启动失败 → fail。
方案：InputQueue 加 resetForResubscribe（reload driver.start 前 reset _subscribed+清旧 _pending，保留 _buffer pending inject）+ reloadWithProvider buildSpawnEnv 后强制 CLAUDE_CONFIG_DIR=daemon 隔离目录（停止也保持 jsonl 一致）；诊断日志（end-diag）全移除。
结果：tsc exit0；reload-provider 11 + input-queue 16 单测过；实测切换→停止→再切换四次 reload session 保持 active（DB status=active ended_at=空，daemon.log reload-diag success 无 fail）。
## ql-20260807-003-0c1b | 2026-08-07 13:03:03 | 排查 /model 偶发空白（重新进入才显示）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-manager.ts（_runConsume 的 onResult/onMessage 改 async+await，driver consume 串行等每条上报 HTTP 完成保证 message 先 result 落库/SSE——防御性修复，非 /model 主因但避免 close 先 message 后前端不渲染）
- sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts（AC-3a 断言更新：ql-002 停止路径强制 CLAUDE_CONFIG_DIR 后不再 undefined，旧 toBeUndefined 断言过时——ql-002 遗留测试债）
- .sillyspec/docs/SillyHub/modules/daemon.md（变更索引加 ql-003 条目：/model 空白根因[inject 时序] + cb async 防御 + AC-3a + C 方案待完整流程）

需求：排查 /model 偶发空白（重新进入才显示）。
根因：inject 在新会话 create_session 完成前到 daemon，daemon session 不存在直接丢 inject（不重试），/model 没进 claude；backend inject 只查 DB active 不查 daemon ready。
方案：本 quick 顺带 cb async 防御（_runConsume onResult/onMessage 改 async+await 串行保证 message 先 result）+ AC-3a 更新（ql-002 遗留测试债）；/model 真正修复 C 方案转完整流程。
结果：tsc 0；reload-provider 11 + input-queue 16 单测过；cb async + AC-3a 落地。
## ql-20260810-001-7f44 | 2026-08-10 15:54:02 | 修复重启 daemon 后 active interactive session 被错误标 ended（restoreAndReconnect resume 漏 CLAUDE_CONFIG_DIR）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-manager.ts（restoreAndReconnect 的 driverOpts env 从 undefined 改为 buildSpawnEnv 构造 + 显式设 CLAUDE_CONFIG_DIR=daemon 隔离目录，与 create/reloadWithProvider 对齐；_runConsume 加 [DIAG] 诊断日志 onError/catch/clean-exit 记录 resume 失败原因，供验证）
- sillyhub-daemon/src/daemon.ts（复用既有 [DIAG] onSessionEnd/restoreAndReconnect OK/markRecoveredSessionFailed 探针定位 resume→fail 路径，commit a784f1fa 为排查 /model 加）

需求：重启 daemon 后 /runtimes 里「进行中」的会话（轮次已完成=空闲 active）变成「已结束」，重启不应变更会话状态。
根因：daemon 重启 _recoverSessionsOnBoot → restoreAndReconnect 调 driver.start({resume}) 恢复 session，但 driverOpts env=undefined → ClaudeSdkDriver 回退裸 process.env（无 CLAUDE_CONFIG_DIR）→ claude 子进程用默认 ~/.claude → 找不到 daemon claude-config/projects/<cwd>/<sid>.jsonl（jsonl 由 create 时隔离 CLAUDE_CONFIG_DIR 写在此）→ resume 失败 → claude 非 0 退出 → SDK getProcessExitError exitError → driver consume onError → SessionManager.fail → onSessionEnd(failed) → backend notifySessionEnd → end_session（router 只取 reason 不取 status，service 总设 ended）→ session 显示「已结束」。证据：8/10 06:09 backend 日志 recover→reconnecting→active(43.01s)→1 秒后 daemon POST /end(44s)；4 个 provider-switch session 里只有被 recover 的 2 个(70aa/be2d)ended，未 recover 的(5cf2/989b)仍 active；SDK sdk.mjs getProcessExitError(exitCode!=0)->Error。与 ql-20260807-002 同源（reload 路径已修 CLAUDE_CONFIG_DIR，restore 路径遗漏）。
方案：restoreAndReconnect 用 buildSpawnEnv({provider_config:undefined},{credential}) 构造 env + 显式 restoreEnv.CLAUDE_CONFIG_DIR=CLAUDE_CONFIG_DIR（对齐 reloadWithProvider:2627-2636），让 resume 的 claude 读 daemon 隔离目录的 jsonl。恢复路径无 provider_config（敏感不落盘）第 0 层自然跳过，凭证靠 process.env（与 create 同源）+ credentials.json。
结果：tsc exit0；daemon-recovery-boot 11 + reload-provider + pending-switch 共 31 测试 passed。**真实验证完成**：构造 DB test session（agent_session_id 指向 daemon claude-config 真实 jsonl 06e286c4）+ sessions.json，重启 daemon → restoreAndReconnect resume 成功 → session_recovered recovered=1 failed=0 → DB status=**active**（修复前同场景 driver.start 因 jsonl 找不到 fail→ended；对比 8/10 06:09 真实故障 70aa/be2d recover→active→1 秒 ended）。**诊断日志已全部清理**（session-manager _runConsume onError/catch + restoreAndReconnect catch 的 [DIAG]，+ daemon.ts 3 处 a784f1fa 探针 [DIAG]）；清理后 daemon-recovery-boot 11 passed；daemon 干净版重启（pid 34900）。

## ql-20260810-002-6e32 | 2026-08-10 17:09:26 | 修复 /runtimes 会话弹窗点「新建会话」误结束当前会话 + 会话列表不刷新
状态：已完成
关联变更：（无）
文件：
- sillyhub-frontend/... 前端 frontend/src/components/daemon/interactive-session-panel.tsx（handleNewSession 不再 active 时先 handleEnd 结束当前会话，改为直接断开 SSE + 重置面板到新建模式，backend session 保持 active）
- frontend/src/components/daemon/runtime-session-dialog.tsx（handleSessionReset 结束会话后追加 reloadSessions 刷新左侧列表）

需求：/runtimes 会话弹窗中，选中会话后点右上角「新建会话」不应结束当前会话；点「结束会话」后左侧会话列表状态应即时刷新。
根因：InteractiveSessionPanel 内部 handleNewSession 在 view.status==='active' 时先调 handleEnd() 结束当前会话再返回（历史简化设计），导致「点新建=误结束当前会话」；且结束后 handleSessionReset 只 setSelectedId(null) 不 reloadSessions，列表状态停在旧值（active 实际已 ended）。
方案：① panel handleNewSession 去掉 active→handleEnd 分支，一律 closeStream+setView(INITIAL_VIEW)（新建会话仅切面板，不结束 backend session，需继续可重新 attach）；② 父级 handleSessionReset 追加 void reloadSessions() 刷新列表。
结果：interactive-session-panel 50 + runtime-session-dialog 10 + session-list-layout 共 69 tests passed；tsc --noEmit exit0。补充：InteractiveSessionPanel.handleEnd 成功即调 onSessionReset（原实现不调，父级 handleSessionReset 的 reloadSessions 不触发致列表不刷新），runtime-session-dialog.handleSessionReset 已加 reloadSessions；interactive-session-panel.test.tsx「改动一」断言随行为变更更新（结束会话也调 onSessionReset，1→2 次）。

## ql-20260812-002-78f5 | 2026-08-12 16:19:41 | 变更详情页阶段操作区合并为推进横幅+档案选择器+触发按钮的单卡片
状态：已完成
关联变更：2026-08-12-dispatch-bind-agent-profile
文件：
- frontend/src/components/changes/detail/change-stage-actions.tsx (合并推进横幅+档案选择器+触发按钮为单 violet 卡片，对齐原型)
需求：变更详情页阶段操作区合并为推进横幅+档案选择器+触发按钮的单卡片，对齐原型 option-a（用户反馈实现与原型不一致，两块没合并）
根因：execute 时只把 provider/model 换成档案选择器，没真正合并两块 UI 为统一卡片（保留两个独立 section）
方案：重构 change-stage-actions.tsx 渲染结构，档案选择器+提示+底部按钮区（推进/验证门禁/触发）合并进单一 violet 卡片（border-violet-500/40 bg-violet-50/40），推进横幅条件逻辑内移，触发按钮也进卡片
结果：前端 17 测试全过（change-stage-actions 9 + page-team-toggle 8），tsc 全过（exit=0），eslint 干净。仅改 1 文件。待 rebuild 前端镜像部署。

## ql-20260812-006-cce7 | 2026-08-12 19:45:38 | 用户新建变更后三个问题——(1)没走 agent
状态：已完成
关联变更：（无）
文件：backend/app/modules/change_writer/proxy.py, backend/app/modules/change_writer/service.py, frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx, backend/app/modules/change_writer/classifier.py, backend/app/modules/change_writer/tests/test_classifier.py
需求：用户新建变更后三个问题——(1)没走 agent；(2)列表「类型」空；(3)列表「阶段」显示英文 draft。
根因：(1)proxy_create_change 设计上只占坑不自动派发 agent，需用户手动推进，属设计行为非 bug；(2)前端创建页未传 change_type，后端默认 None 落 NULL；(3)后端硬编码 current_stage=draft，但 draft 非 SillySpec VALID_STAGES，前端 STAGE_LABEL 无映射回退显示英文。
方案：后端新增 classifier.py 按 quick/prototype/feature 关键词自动推导 change_type；proxy.py+service.py 创建时 current_stage 从 draft 改 brainstorm 对齐标准流程、change_type 为 None 时自动推导；前端 changes/page.tsx STAGE_LABEL 加 draft:草稿 兜底旧数据。
结果：classifier 9 用例逻辑验证全绿（修正 1 个测试用例期望）；3 个后端文件 ast.parse 语法编译 OK；前端 tsc --noEmit 无错误。问题(1)未改属设计行为。

## ql-20260813-003-6a59 | 2026-08-13 13:57:11 | stage dispatch(quick/brainstorm/plan/execute/verify)的 agent 调 AskUserQuestion 提问…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/placement.py（raw SQL INSERT 建 agent_sessions 加 config 列(manual_approval+ask_user_only),解 permission_service 硬门控）
- backend/app/modules/agent/tests/test_interactive_session_placement.py（加 test_dispatch_to_daemon_session_config_has_manual_approval 回归测试断言 session.config）
需求：stage dispatch(quick/brainstorm/plan/execute/verify)的 agent 调 AskUserQuestion 提问传不到前端、agent 死等。
根因：placement.py:491 raw SQL INSERT 建 agent_sessions 漏 config 列(只写了 lease.metadata 的 manual_approval),session.config=NULL 被 permission_service.py:320 硬门控吞掉,不建 dialog,前端收不到。
方案：该 INSERT 加 config 列,值 {manual_approval:True, ask_user_only:True},对齐 scan(service.py:1645)；加回归测试断言 session.config(原测试只断言 lease.metadata 漏了 session.config,正是 bug 漏掉原因)。
结果：placement+dispatch_metadata 17 passed(原16+新1),ruff+mypy 全绿；1 文件 5 行代码修复 + 1 回归测试。另改测试文件 test_interactive_session_placement.py(加回归保护,超出启动 --files 锁的 placement.py)。

## ql-20260813-004-f29e | 2026-08-13 14:42:21 | 在智能体档案中为 CC（Claude Code）和 GLM（智谱）各补充 5 个专家级角色模板（架构师、前端工程师、后端工程师、项目经理、测试工程师）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/profile/seed.py（新增 ensure_role_template_profiles 与 10 个专家角色模板）
- backend/app/main.py（lifespan 启动时调用角色模板补种）
- backend/app/modules/agent/tests/test_profile_seed.py（新增角色模板幂等/不覆盖/补种测试）
- .sillyspec/docs/SillyHub/modules/agent.md（变更索引追加 ql-ID）
需求：在智能体档案中为 CC（Claude Code）和 GLM（智谱）各补充 5 个专家级角色模板（架构师、前端工程师、后端工程师、项目经理、测试工程师），并补全 system_prompt 描述。
根因：现有平台默认档案仅含 provider/name，缺少按角色细分的专家人格与详细工作描述，无法满足按角色派发的需求。
方案：在 backend/app/modules/agent/profile/seed.py 新增 ensure_role_template_profiles，以确定性 UUID 按 provider×role 补种 10 条 platform 级模板（is_system_default=False，不影响兜底链）；backend/app/main.py lifespan 启动时调用；更新 .sillyspec/docs/SillyHub/modules/agent.md 变更索引与 test_profile_seed.py 测试。
结果：test_profile_seed.py 15 条全绿，profile service/router 62 条全绿；所有相关文件已 git add 待提交。

## ql-20260813-005-7d39 | 2026-08-13 15:34:39 | 删除智能体档案里 5 个 GLM 平台级专家角色模板（glm × 架构师/前端/后端/项目经理/测试）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/profile/seed.py（删 glm provider 留 CC×5 + 新增 _DEPRECATED_ROLE_TEMPLATE_IDS 按 glm×5 确定性UUID 回收废弃 GLM 模板 + ensure 返回 (inserted,pruned)）
- backend/app/main.py（lifespan 解构 role_seeded/role_pruned 分别 log + 注释 CC/GLM→CC）
- backend/app/modules/agent/tests/test_profile_seed.py（角色模板测试 10→5（plants/idempotent/overwrite/replant/coexist）+ 新增 test_role_templates_prune_deprecated_glm 回收测试）
- .sillyspec/docs/SillyHub/modules/agent.md（变更索引追加 ql-20260813-005-7d39）
需求：删除智能体档案里 5 个 GLM 平台级专家角色模板（glm × 架构师/前端/后端/项目经理/测试）。
根因：ql-20260813-004 补种了 CC/GLM × 5 共 10 条平台模板，现需移除 GLM 方向；ensure_role_template_profiles 只补不删，仅删代码会让 DB 残留 5 条 GLM 孤儿模板、前端仍显示。
方案：seed.py 删 _ROLE_TEMPLATE_PROVIDERS 的 glm 条目留 CC×5，新增 _DEPRECATED_ROLE_TEMPLATE_IDS（glm×5 确定性UUID）在 ensure 内 delete 回收废弃模板（幂等、新环境删0条、严格只删 namespace 内已知废弃 id 不碰用户 uuid4 档案），返回值改 (inserted,pruned)；main.py log 解构；测试 10→5 + 新增回收测试；agent.md 追加变更索引。
结果：pytest test_profile_seed.py 16 passed（含 test_role_templates_prune_deprecated_glm 验证 5 条 GLM 被回收+用户自建档案保留），ruff check + format 干净；待部署 rebuild backend 重启触发回收。

## ql-20260813-006-f3f0 | 2026-08-13 22:41:18 | 排查智能体执行日志 ef9f8b55 已执行完但前端状态没变
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, backend/app/modules/daemon/tests/test_run_sync_gate_enqueue.py
需求：排查智能体执行日志 ef9f8b55 已执行完但前端状态没变。
根因：close_interactive_run 对所有 change_id 非空+completed 的 run 无差别 enqueue verify gate，quick stage run 被拉跑 sillyspec gate verify，对非 verify 变更（quick 独立 quicklog、change_key 含中文）stdout 非 JSON 解析失败 exit 2 误报核验失败，且 gate_result 仅落 agent_run 未回写 last_dispatch，刷新后徽标消失（用户感知状态没变）。
方案：加 _gate_applicable 守门（仅 current_stage==verify+completed+change_id 非空），close_interactive_run 设 gate_status=pending(:1067) 与 enqueue(:1149) 两处共用，quick/brainstorm/plan/execute/archive 跳过；扩 test_run_sync_gate_enqueue.py 加非 verify stage 跳过 gate 用例（_attach_change stage 参数化）；止血清掉该 run 误判的 gate_status/gate_result。
结果：pytest 32 passed（enqueue+close_interactive_run+gate_decision_task），ruff 全绿；该 run gate_status 已清 NULL 恢复正常显示。

## ql-20260814-001-ec76 | 2026-08-14 09:39:17 | 删除 5 个 CC 平台级专家角色模板（CC 架构师/前端/后端/项目经理/测试工程师）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/profile/seed.py（_ROLE_TEMPLATE_PROVIDERS 清空 + _DEPRECATED_ROLE_TEMPLATE_IDS 扩 glm+claude×10）
- backend/app/main.py（启动补种注释更新）
- backend/app/modules/agent/tests/test_profile_seed.py（角色模板测试改写为 0 补种+回收10）
- .sillyspec/docs/backend/modules/agent.md（ql-20260814-001 变更索引）
- .sillyspec/docs/SillyHub/modules/agent.md（同上）
需求：删除 5 个 CC 平台级专家角色模板（CC 架构师/前端/后端/项目经理/测试工程师）。
根因：平台角色模板此前分 CC/GLM 双供应商，GLM 已于 ql-20260813-005 下线，CC×5 仍由 ensure_role_template_profiles 每次启动补种，用户要求一并移除。
方案：mirror GLM 下线套路——seed.py 清空 _ROLE_TEMPLATE_PROVIDERS、把 CC×5 确定性 UUID 并入 _DEPRECATED_ROLE_TEMPLATE_IDS（与 GLM×5 合计 10），ensure 启动按 id 回收 DB 残留、不再补种；main.py 注释更新；test_profile_seed.py 角色模板测试改写为「0 补种 + 回收 10」；agent.md×2 加 ql-20260814-001 变更索引。
结果：pytest test_profile_seed.py 14 passed（含 prune 回收 10 + 用户档案保留），ruff check 干净；待部署 backend 重启触发 ensure 实际回收 DB 中 5 条 CC 残留。

## ql-20260814-002-cdee | 2026-08-14 10:18:29 | 全局档案页个人/平台级档案（workspace_id=null）删不掉
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/agent-profiles.ts（加 deleteAgentProfile(pid) → DELETE /api/agent-profiles/{pid}）
- frontend/src/app/(dashboard)/agent-profiles/page.tsx（useSession isPlatformAdmin + handleConfirmDelete admin 分支 + 注释）
- frontend/src/app/(dashboard)/agent-profiles/__tests__/page.test.tsx（mock useSession + deleteAgentProfile + admin 删用例 + 非 admin 拦截用例）
需求：全局档案页个人/平台级档案（workspace_id=null）删不掉，提示「进入归属工作区」但个人级无归属工作区=死路。
根因：lib/agent-profiles.ts 只暴露 workspace 级 delete client（需 workspaceId），全局页对 workspace_id=null 档案拦截删除；而后端有 platform 级 /api/agent-profiles/{pid} DELETE（service.delete 按三级 visibility 鉴权）却没被前端接线。
方案：lib 加 deleteAgentProfile(pid) → DELETE /api/agent-profiles/{pid}；page 引入 useSession isPlatformAdmin，handleConfirmDelete 对 workspace_id=null 改 admin→deleteAgentProfile、非 admin→「请联系管理员」提示；test mock useSession + 加 admin 删用例 + 原 private/platform 拦截用例改非 admin。
结果：vitest 9 passed（+1 admin 用例）、eslint 0、tsc 0；admin（admin2）现已可从全局页删个人/平台档案。普通用户删自己的 private 档仍需后端另开 owner-gated 端点（后续）。

## ql-20260815-001-9358 | 2026-08-15 16:45:28 | /sessions 新建会话的②智能体选择器显示成机器名（如 DESKTOP-2BN7FDC）
状态：已完成
关联变更：2026-08-14-sessions-portal-fix
文件：frontend/src/components/sessions/__tests__/new-session-form.test.tsx, frontend/src/components/sessions/new-session-form.tsx
需求：/sessions 新建会话的②智能体选择器显示成机器名（如 DESKTOP-2BN7FDC），应显示智能体引擎名（Claude Code、Codex 等）。
根因：new-session-form.tsx 的 runtimeLabel 优先级为 display_alias→name→provider，而 runtime.name 默认值就是机器主机名，无别名时主机名被当成智能体标签。
方案：runtimeLabel 改为引擎名优先——复用 lib/daemon.ts 既有 PROVIDER_META（claude→Claude Code/codex→Codex/cursor→Cursor 等 12 引擎），弃用 name；用户自定义别名时显示「别名 · 引擎名」保留个性化。测试 mock 改 importOriginal 保留真常量只 mock createSession；新增回归用例（name=主机名→纯引擎名；别名→别名·引擎名；智能体区不含主机名）。
结果：组件测试 13/13 通过（新增 1 条回归）；前端全量 151 文件/1509 用例全绿；eslint 0 告警。前端已待部署（见后续 commit+rebuild）。

## ql-20260815-010-37a7 | 2026-08-15 20:25:43 | /sessions 实测三个问题——①whoLine 第二轮起显示「未指定/本机默认」（首轮正常）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/session/service.py, backend/app/modules/daemon/tests/test_session_switch_config.py, frontend/src/app/(dashboard)/sessions/page.tsx, frontend/src/components/sessions/session-config-bar.tsx
需求：/sessions 实测三个问题——①whoLine 第二轮起显示「未指定/本机默认」（首轮正常）；②配置条四个下拉点击后浮层都渲染在最左侧；③「未命名会话」后加会话 id 供复制。
根因：①_inject_into_session 仅切换分支给 AgentRun 落 agent_profile_id/snapshot/llm_provider_id，普通 inject 轮全 NULL，前端 whoLine 读 run 快照如实显示未指定（违反 D-008 每轮快照）；②ConfigDropdown absolute left-0 锚定到整条 barRef（relative）而非各控件；③标题区无 id 展示。
方案：①effective 档案/供应商解析移出 config_switch 条件（未切维度也按会话当前 id 取行），run 三字段盖章改无条件（切换轮=新值/普通轮=会话当前值/无配置=NULL）；②ctrlButton 改 span.relative.inline-flex 包装 + 四个 ConfigDropdown 内嵌为第 5 参数，锚到各控件；③标题旁 #id[:8] 按钮，clipboard.writeText 复制完整 id，✓ 已复制 2s 反馈。
结果：后端 daemon 全量 798 passed（零回归用例按新语义更新：普通轮 run 断言携带会话当前配置）；前端全量 153 文件/1551 全绿（config-bar 17+page 8 含既有断言不破坏）；tsc 0 错、eslint 0 error、ruff 全过。待部署（commit+push+rebuild backend/frontend）。

## ql-20260815-011-2d94 | 2026-08-15 21:26:52 | ①会话面板配置条的智能体控件与下拉仍显示 DESKTOP-2BN7FDC（ql-001 只修了新建表单没修到 config-bar）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/sessions/page.tsx, frontend/src/components/sessions/__tests__/session-config-bar.test.tsx, frontend/src/components/sessions/session-config-bar.tsx
需求：①会话面板配置条的智能体控件与下拉仍显示 DESKTOP-2BN7FDC（ql-001 只修了新建表单没修到 config-bar），且长主机名把下拉框撑得难看；②「未命名会话」占位文字不显示，复制 id 的 ✓ 反馈改成 Message 提示。
根因：①session-config-bar.tsx 有独立 runtimeLabel（仍 name 优先=主机名），且控件当前值 agentName 读 config_snapshot.agent_name——后端快照存的 runtime.name 本来就默认是主机名；②page.tsx 标题 || '未命名会话' 占位渲染，复制反馈用 setState 交换按钮文字。
方案：①runtimeLabel 改 PROVIDER_META 引擎名优先（别名=别名·引擎名），agentName 改引擎显示名（快照 agent_name 降为引擎缺失时兜底）——标签变短下拉恢复正常观感；②title 空时不渲染 span，复制成功 message.success('已复制会话 ID')/失败 message.error，删除 idCopied 状态与 2s 定时器；测试 mock 改 importOriginal 保留 PROVIDER_META 真常量。
结果：config-bar 17 用例+page 8 用例全过，前端全量 153 文件/1551 全绿，tsc 0 错，eslint 0 error。待 commit+push+rebuild frontend 部署。

## ql-20260817-001-1ce1 | 2026-08-17 08:52:49 | 310px 列宽下第二行五个 Tag（机器+引擎+档案+供应商+轮数）太挤
状态：已完成
关联变更：（无）
文件：frontend/src/components/sessions/session-list-panel.tsx
需求：310px 列宽下第二行五个 Tag（机器+引擎+档案+供应商+轮数）太挤，机器主机名长把整行撑爆。
根因：chips 全部默认 Tag 样式（默认 padding/字号 12px）无宽度约束，机器/档案/供应商名长短不可控。
方案：Tag 紧凑化（rounded-sm px-1 py-0 text-[10px] leading-4）；机器/档案/供应商长名 max-w（104/110/104px）+truncate + title 悬停全名；引擎与轮数 shrink-0 恒可见；行 gap 1→0.5、pl-3→pl-2.5。虚拟行高 64px 不变（虚拟滚动约束）。
结果：list-panel 13 用例全过（含 chips 断言），前端全量 155 文件/1589 全绿，tsc 0 错、eslint 0。待部署。
