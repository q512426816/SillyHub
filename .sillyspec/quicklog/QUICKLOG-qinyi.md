
## ql-20260818-005-7561 | 2026-08-18 08:54:54 | 存量模块卡片标题补中文名收官——multi-agent-platform 项目 11 张补齐，frontend/daemon 由并行会话同期完成，全仓 211 张核验全过
状态：已完成
关联变更：（无；生成端根修见 sillyspec 仓 ql-20260818-005-a999——scan/archive 模板标题格式修复）
文件：
- .sillyspec/docs/multi-agent-platform/modules/backend.md（# 后端服务（backend））
- .sillyspec/docs/multi-agent-platform/modules/build.md（# 构建与任务编排（build））
- .sillyspec/docs/multi-agent-platform/modules/ci.md（# 持续集成（ci））
- .sillyspec/docs/multi-agent-platform/modules/deploy.md（# 部署编排（deploy））
- .sillyspec/docs/multi-agent-platform/modules/docs.md（# 设计文档库（docs））
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（# 前端控制台（frontend））
- .sillyspec/docs/multi-agent-platform/modules/prototype.md（# 交互线框原型（prototype））
- .sillyspec/docs/multi-agent-platform/modules/scripts.md（# 运维校验脚本（scripts））
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（# 本地守护进程（sillyhub-daemon））
- .sillyspec/docs/multi-agent-platform/modules/sillyspec.md（# 变更管理规范（sillyspec））
- .sillyspec/docs/multi-agent-platform/modules/spikes.md（# 技术验证（spikes））
需求：工具扫描生成的模块卡片缺少中文标题信息，平台文档列表一墙英文代号；对齐 # 中文名（module-id）平台约定
根因：sillyspec scan 子代理模板硬编码 # <module-id>（生成端已在 sillyspec 仓修复 ql-20260818-005-a999）；存量 94 张英文标题卡片中 frontend 86 张与 sillyhub-daemon 46 张由并行会话同期完成，multi-agent-platform 11 张由本会话子代理补齐
方案：11 张卡片各改标题一行（中文名从「## 定位」段职责提炼），git diff 每文件恰一行，已 add 并入暂存与并行会话的大变更集统一提交（避免拆分提交回滚标题行）
结果：全仓 211 张模块卡片独立脚本核验全部通过（中文名+括号 module-id+frontmatter module_id 三重匹配 0 bad）；纯 doc 改动未触及 src/test，npm test 按 CLAUDE.md 规则 8 跳过

## ql-20260818-006-85d6 | 2026-08-18 09:19:24 | 变更中心快速修复 tab 负责人参考进行中/已归档列表的负责人来源
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/quicklog_service.py（新增 _enrich_linked_change_owners：linked_changes→owner_id→users 按 ID 解析，list/get 接线；author 筛选含 owner_name）
- backend/app/modules/change/schema.py（QuicklogEntryListItem 增 owner_name 字段）
- backend/app/modules/change/router.py（列表/详情两装配点透传 owner_name）
- backend/app/modules/change/tests/test_quicklog_service.py（新增 owner 优先/兜底/筛选用例）
- backend/openapi.json + frontend/src/lib/api-types.ts（gen:types 重生成，owner_name 两 DTO）
- frontend/src/components/changes/quicklog-table.tsx（负责人列与下拉 owner_name 优先）
- frontend/src/components/changes/quicklog-drawer.tsx（负责人行 owner_name 优先）
- frontend/src/components/changes/__tests__/quicklog-table.test.tsx（owner 优先+回退链两用例，fixture 补 owner_name）
需求：变更中心快速修复 tab 负责人参考进行中/已归档列表的负责人来源，既有逻辑做兜底。
根因：quicklog 负责人原取 QUICKLOG 文件名推导的 author_raw 字符串按 users.username 猜匹配，非变更列表 owner_id（token 上行权威身份链）口径，username 不一致时显示偏差。
方案：后端 quicklog_service 新增 _enrich_linked_change_owners——条目 linked_changes → changes.owner_id（一次 IN）→ users 按 ID 批量解析（一次 IN，display_name 优先 username fallback，对齐 _resolve_user_names），list_entries/get_entry 接线，fail-soft；schema QuicklogEntryListItem 与 router 两装配点新增 owner_name 下发；author 筛选同步匹配 owner_name；前端 quicklog-table 负责人列与下拉、quicklog-drawer 负责人行 owner_name 优先 → author_name → author_raw → — 兜底；pnpm gen:types 重生成 api-types.ts+openapi.json。
结果：后端 change+platform_sync 479 passed 2 skipped，ruff format/check + mypy 干净；前端 vitest 1613/1613 全过、tsc 0 错；关联变更无 owner/无关联/用户已删时回退既有 author 链，向后兼容。

## ql-20260818-007-22a9 | 2026-08-18 09:20:00 | 变更中心快速修复 tab 时间字段显示偏差 8 小时
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/quicklog_service.py（新增 _to_wallclock 输出边界剥 tzinfo，list 分页输出与 get_entry 详情下发 naive 墙钟）
- backend/app/modules/change/tests/test_quicklog_service.py（新增 test_output_timestamp_naive_wallclock）
需求：变更中心快速修复 tab 时间字段显示偏差 8 小时。
根因：CLI 落盘/推送的时间串是本地墙钟（无时区），后端 _norm_utc 为 stale 内部运算打上 UTC 标签后原样下发（带 Z），前端 new Date().toLocaleString 再按浏览器本地时区（UTC+8）换算 → 显示 = 实际 +8h 双重偏移。
方案：quicklog_service 新增 _to_wallclock 输出边界函数，list_entries 分页输出与 get_entry 详情返回均剥 tzinfo 下发 naive 墙钟；浏览器对 naive ISO 串按本地解析，展示与 CLI 落盘墙钟一致；stale 内部 aware 运算链路不动。
结果：test_quicklog_service+router 19 passed，新增 test_output_timestamp_naive_wallclock 断言列表与详情 tzinfo 均为 None 且墙钟原样；ruff format/check+mypy 干净；纯时间戳序列化格式变化无 openapi schema 变更，无需 gen:types。

## ql-20260818-008-ec6d | 2026-08-18 09:37:41 | 变更详情页「变更文件」Dialog 的文件预览区
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/change-file-tree.tsx（补 flex 限高链（section/grid/右列）+ FilePreview min-w-0 + pre 改 whitespace-pre 横向滚动 + 路径 truncate）
- frontend/src/components/changes/detail/change-files-card.tsx（Dialog 内容容器加 flex flex-col 打通限高链 + 注释同步）
需求：变更详情页「变更文件」Dialog 的文件预览区，垂直超长无滚动条（超出被裁）、水平超宽无横向滚动，希望预览区宽度固定。
根因：Dialog(85vh)→section→grid→右列整条链无 min-h-0/flex 限高约束，flex-1 overflow-auto 失效，超长内容被 Dialog 的 overflow-hidden 直接裁切；横向 flex 子项缺 min-w-0 被宽内容撑开，且源码 pre 用 whitespace-pre-wrap 软折行。
方案：change-file-tree.tsx——section 加 flex min-h-0 flex-1 flex-col、grid 加 min-h-0 flex-1 overflow-hidden + lg:grid-rows-[minmax(0,1fr)]、文件树列 lg 下满高滚动、右列改 flex flex-col、FilePreview 三分支统一 min-w-0（pre 改 whitespace-pre 不折行靠横向滚动看全、iframe 改 h-full+min-h-[60vh]）、文件路径 span 加 truncate；change-files-card.tsx——Dialog 内容容器加 flex flex-col 打通限高链 + 注释同步。
结果：针对性 vitest 2 文件 9 用例全过；pnpm lint 仅 stores/kanban.ts 预存 warning（与本改动无关）；模块文档 frontend.md 已同步条目并 git add。

## ql-20260818-009-c287 | 2026-08-18 13:25:18 | 修 spec-sync 增量同步超时（事件循环被阻塞 + 无谓全量 reparse）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/spec_workspace/service.py（FS 段抽 helper 入 to_thread + archive_hit 收窄 delete/rename）
- backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py（归档用例翻新 scoped 断言 + 新增 rename/delete 入归档全量用例）
- .sillyspec/docs/backend/modules/spec_workspace.md（关键逻辑与人工备注同步 ql-20260818-009）
需求：修 spec-sync 增量同步超时（事件循环被阻塞 + 无谓全量 reparse）。
根因：① apply_ops 的 write_bytes/mkdir/utime/move 在事件循环上同步执行，Windows bind mount 连写卡死循环数十秒，被卡请求的连接撞 120s idle-in-transaction 超时（db.py:40 ql-20260728-008 前科）；② _compute_reparse_scope 对任何 archive 路径 op 都置 archive_hit 全量重扫（parsed 225），daemon 陈旧缓存重推归档文件即误触发。
方案：① 抽 _write_op_file/_move_op_file 同步 helper 五处 FS 段整体入 asyncio.to_thread；② archive_hit 仅在 delete/rename op 命中 archive 路径置位（真归档=跨根移动恒发 rename），add/update 走 scoped name，change_dirs 归档前缀剥前缀进 scoped；③ reparse 移出请求路径评估结论 defer——scoped <1s 全量 ~2s 且罕见，后台化复杂度不抵收益。
结果：spec_workspace 97 passed + change 386 passed（各含预存 skip），ruff format/check 与 mypy 全绿；残余风险为归档同时改内容时 rename 退化为 delete+add 的陈旧行残留，留待下次全量重扫收敛（与 scoped 零删除红线同哲学）。


## ql-20260818-010-f551 | 2026-08-18 22:42:28 | 工作区文件浏览页布局优化——树支持左右滑动、内容区固定高度内部滚动、预览细节优化
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx（PageContainer 锚定视口高度+overflow-hidden+左栏收窄 w-60+面包屑防换行）
- frontend/src/components/explorer/file-explorer.tsx（节点 nowrap 横向滚动+缩进 16px+搜索结果 nowrap）
- frontend/src/components/explorer/file-preview.tsx（纯文本不软折行+图片 max-h-full 自适应）
需求：工作区文件浏览页布局优化——树支持左右滑动、内容区固定高度内部滚动、预览细节优化。
根因：AppShell 根容器 min-h-screen 高度被内容撑开，页面内 flex-1/overflow-hidden 链条无视口高度锚点全部落空导致整页滚动；树节点标题 truncate 截断长文件名且行宽锁死容器宽导致永不出现横向滚动条。
方案：page.tsx 给 PageContainer 锚定 h-[calc(100vh-56px)]（TopBar h-14，sessions 页先例）+overflow-hidden，左栏收窄 w-60；file-explorer 节点改 whitespace-nowrap 靠容器 overflow-auto 横向滚动，缩进用任意选择器收 16px/层（antd v6 Tree 已无 indentSize prop），搜索结果同步 nowrap；file-preview 纯文本 pre 统一 whitespace-pre 横向滚动（与代码高亮分支一致），图片 max-h-[540px] 改 max-h-full 自适应容器。
结果：vitest explorer 相关 3 文件 36 用例全过，tsc --noEmit 0 错，eslint 三文件仅 1 条预存警告（HEAD 基线同位存在，非本次引入）。

## ql-20260819-001-4d85 | 2026-08-19 08:59:41 | explorer 文件树目录节点支持双击展开/收起
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/explorer/file-explorer.tsx（antd Tree 加 expandAction=doubleClick + 头注释同步）
- frontend/src/components/explorer/__tests__/file-explorer.test.tsx（补 dblClickNode 辅助 + 双击展开/收起/叶子 3 用例）
需求：explorer 文件树目录节点支持双击展开/收起
根因：无，纯交互增强——antd Tree 默认 expandAction=false 只能点 switcher 箭头展开，用户习惯 VSCode 式双击目录行切换
方案：file-explorer.tsx 的 antd Tree 加 expandAction=doubleClick（antd 6.4.4 透传 rc-tree 同名 prop），双击目录行走受控 onExpand+loadData 懒加载链路与 switcher 等价；单击仍只选中，叶子与 Ctrl/Shift 修饰键由 rc-tree 忽略；测试补双击展开/收起不重拉/叶子不触发 3 用例
结果：vitest file-explorer 17/17 passed，pnpm lint PASS（警告均预存无关文件），tsc --noEmit 0 error

## ql-20260819-002-4c90 | 2026-08-19 10:18:32 | 为跨工作区团队执行变更补可视化原型图
状态：已完成
关联变更：2026-08-19-cross-workspace-team-mission
文件：
- .sillyspec/changes/2026-08-19-cross-workspace-team-mission/design.md（在 §3 总体方案后插入方案示意图（Mermaid 数据流 + 概念映射表 + ASCII 页面线框））
需求：为跨工作区团队执行变更补可视化原型图。
根因：design.md 纯文字描述对 anchor/scope/target/representative binding 概念不够直观。
方案：在 design.md §3 总体方案后新增 §3.1 方案示意图，含系统数据流 Mermaid 图、核心概念映射表、前端项目团队会话页 ASCII 线框。
结果：仅改 design.md 一个文档，未触代码与测试，无需跑 test/lint。

## ql-20260819-003-ad54 | 2026-08-19 13:05:55 | 扫描文档树徽标「⚠ 冲突N」语义误导
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx（徽标 destructive 红改 outline 灰，文案改历史N版，加 title 悬浮解释）
- .sillyspec/docs/frontend/modules/app-workspace-pages.md（ScanDocsPage 条目补文档树徽标语义）
需求：扫描文档树徽标「⚠ 冲突N」语义误导，改为中性叫法与配色。
根因：conflict_count 实为 last-write-wins 覆盖存档历史计数（conflict_service D-001@V1），红色 destructive 徽标被误读成待解决冲突。
方案：page.tsx 徽标改「🕘 历史N版」outline 灰配色加 title 悬浮说明（旧版本存档备查无需处理），模块文档同步徽标语义。
结果：vitest 全量 1677/1677 通过加 tsc 0 错加 lint 0 错，无 API 字段变更。

## ql-20260819-004-695a | 2026-08-19 13:20:49 | 修复 spec-sync 增量同步的软删行复活缺陷
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/spec_workspace/service.py（apply_ops 软删复活三分支+docstring 同步）
- backend/app/modules/spec_workspace/tests/test_sync_incremental.py（TestSoftDeleteRevival 4 用例）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引补 ql-20260819-004 行）
需求：修复 spec-sync 增量同步的软删行复活缺陷，un-archive 愈合同步不再永久冲突。
根因：apply_ops 把 rename 目标路径的 exists=false 软删墓碑当占用判 conflict（2026-08-19 quick 误归档事故卡死主因），add 落软删行走同内容豁免 no-op 留僵尸行。
方案：service.py 三处——add 落软删行原地复活、rename 目标墓碑不算占用且原地复活（避开 flush 先 INSERT 后 DELETE 撞唯一约束）、R-07 无旧行 rename 同款处理；test_sync_incremental.py 增 TestSoftDeleteRevival 4 用例（含事故组合守护，证明 rename 蒸发疑点隔离不可复现）。
结果：pytest 29 passed+1 skipped（symlink 平台预存），ruff format/check 过，mypy 0 error；backend.md 模块卡补 ql-20260819-004 索引行。

## ql-20260819-005-4950 | 2026-08-19 16:57:47 | 在 /ppm/projects 项目维护页行操作加「Agent 团队」入口
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/projects/__tests__/projects-page.test.tsx, frontend/src/app/(dashboard)/ppm/projects/page.tsx
需求：在 /ppm/projects 项目维护页行操作加「Agent 团队」入口，从项目数据进入 /projects/{id}/missions。
根因：无，纯新增入口（原页面仅支持 URL 直达）。
方案：在 page.tsx 的 extraActions 新增 Button，点击 router.push(`/projects/${row.id}/missions`)；新建 __tests__/projects-page.test.tsx 用 Testing Library + vitest 覆盖按钮渲染与跳转。
结果：新增测试 2 passed；pnpm exec tsc --noEmit 0 错误；改动文件已 git add。

## ql-20260820-001-579d | 2026-08-20 01:05:34 | 修复 change 模块 test_router.py 等 26 个 fixture ERROR（基线旧债
状态：已完成
关联变更：（无）
文件：backend/app/modules/change/tests/test_router.py, backend/app/modules/change/tests/test_sync_documents_traversal.py
需求：修复 change 模块 test_router.py 等 26 个 fixture ERROR（基线旧债，与 spec-mirror-tombstone-sync 无关）
根因：2026-08-19-workspace-role-type 把 Workspace Create.type 收成必填枚举后，4 个测试文件的 POST /api/workspaces fixture payload 未带 type → 422 建档失败 → 后续全部断言 ERROR
方案：test_router / test_dispatch / test_files_router / test_sync_documents_traversal 四文件 payload 补 type=other（受控词表最中性值）
结果：change 模块 388 passed / 2 skipped（26 ERROR→0）；spec_workspace 106 passed 交叉无影响；ruff check + format 全过
审计：📝 文档欠账（D-8）：4 个源码文件改动未同步任何模块文档（涉及模块：backend）
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/change/tests/test_dispatch.py, backend/app/modules/change/tests/test_files_router.py

## ql-20260820-002-8469 | 2026-08-20 02:09:11 | 全量审计平台缺陷/安全/性能/质量后按优先级修复（docs/platform-audit-2026-08-20.md 批次A+B：后端安全7项+质量9项+基线测…
状态：已完成
关联变更：（无）
文件：backend/.env.example, backend/app/core/config.py, backend/app/core/security.py, backend/app/main.py, backend/app/modules/admin/router.py, backend/app/modules/admin/schema.py, backend/app/modules/admin/users_service.py, backend/app/modules/auth/router.py, backend/app/modules/auth/schema.py, backend/app/modules/change/dispatch.py, backend/app/modules/change_writer/service.py, backend/app/modules/daemon/session/service.py, backend/app/modules/daemon/tests/test_session_service.py, backend/app/modules/explorer/router.py, backend/app/modules/file/router.py, backend/app/modules/knowledge/service.py, backend/app/modules/knowledge/tests/test_router.py, backend/app/modules/platform_sync/tests/test_quicklog_push.py, backend/app/modules/platform_sync/tests/test_quicklog_table_smoke.py, backend/app/modules/ppm/common/export.py, backend/app/modules/ppm/plan/router.py, backend/app/modules/ppm/plan/service.py, backend/app/modules/ppm/plan/tests/test_detail_task_link.py, backend/app/modules/ppm/plan/tests/test_service.py, backend/app/modules/ppm/problem/router.py, backend/app/modules/ppm/problem/service.py, backend/app/modules/ppm/task/router.py, backend/app/modules/ppm/task/service.py, backend/app/modules/scan_docs/tests/test_router.py, backend/app/modules/settings/router.py, backend/app/modules/spec_workspace/service.py, backend/app/modules/task/tests/test_router.py, backend/app/modules/worktree/git_runner.py, backend/create_tables.py, backend/seed_workbench_demo.py, backend/tests/modules/admin/test_users_dominance.py, backend/tests/modules/admin/test_users_router.py, backend/tests/modules/change/test_router_transition.py, backend/tests/modules/workspace/test_scan_generate.py, backend/tests/modules/workspace/test_scan_generate_service.py, docs/sillyspec/finished/2026-08-20-doctor-sqlite3-dep-and-ghost-cleanup.md
需求：全量审计平台缺陷/安全/性能/质量后按优先级修复（docs/platform-audit-2026-08-20.md 批次A+B：后端安全7项+质量9项+基线测试债39例）
根因：tar fully_trusted符号链接逃逸；XFF取最左段可伪造绕过限流；PPM子域写接口仅认证不授权；默认口令硬编码；事件循环同步IO；导出走分页截断；模板路径依赖CWD；基线债=scan_generate改三元返回后测试未跟+workspace type必填后4文件漏补+daemon会话管理员404
方案：tar改filter=data并拒绝链接成员；XFF取最右段；里程碑/明细上溯计划can_operate断言+模板CRDD平台管理员门控；初始口令secrets随机一次性下发+复杂度校验复用弱口令黑名单；CD去引号；stderr套redact_output；非dev关docs端点；prod拒minioadmin；导出改list_for_export(5000)；模板锚定__file__；knowledge/change_writer移线程池；gate孤儿in_批量；excel builder收敛公共模块；删create_tables.py+seed_workbench_demo.py；基线债按新契约修测试
结果：ruff format/check过、mypy 657文件0错、后端全量pytest由19 failed/20 errors清零（4619+新增通过）；新增初始口令随机化+PPM越权403共3个安全回归测试

## ql-20260820-003-6de8 | 2026-08-20 03:23:01 | 批次C修 daemon 安全/健壮/死代码（DA-1/2/4/5/6/7/11/12/13/15）
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/spikes/06-mcp-server/README.md, sillyhub-daemon/spikes/06-mcp-server/server.ts, sillyhub-daemon/spikes/06-mcp-server/spike.test.ts, sillyhub-daemon/src/.gitkeep, sillyhub-daemon/src/adapters/stream-json.ts, sillyhub-daemon/src/agent-detector.ts, sillyhub-daemon/src/config.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/file-rpc.ts, sillyhub-daemon/src/host-fs-handler.ts, sillyhub-daemon/src/index.ts, sillyhub-daemon/src/task-runner.ts, sillyhub-daemon/tests/.gitkeep
需求：批次C修 daemon 安全/健壮/死代码（DA-1/2/4/5/6/7/11/12/13/15）
根因：shell:true 参数零转义注入；get_spec_bundle 无守卫；词法校验不解析 junction；SIGKILL 留孤儿孙进程；env 可劫持 PATH；凭证无 0600；toRpcError 双实现；detector exec 拼引号；占位/结题残留
方案：shell 元字符硬失败+model 白名单；补 assertWithinAllowedRoots；收敛 isPathUnderAnyRoot(realpath)；taskkill /T /F 杀树；剔除受保护 env 键；chmod 0600；toRpcError 单实现；cmd-shim+execFile；删 src/index.ts+spikes/06
结果：tsc 0 错；vitest 2447 passed 全绿

## ql-20260820-004-dbc3 | 2026-08-20 03:34:52 | docs/platform-audit-2026-08-20.md 批次D前端（FE-2/3/4/5/8/9）
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：docs/platform-audit-2026-08-20.md 批次D前端（FE-2/3/4/5/8/9）
根因：无（测试同步+死代码清理+小改）
方案：__setBindingMap 改hoisted状态；placeholder三元；删stage-team-config/workspace-binding-dialog/use-agent-runs及stub断言；审批卡终态停表；formatter去any
结果：tsc 0错、vitest 1695 passed、lint 0 error

## ql-20260820-005-68e3 | 2026-08-20 03:35:48 | docs/platform-audit-2026-08-20.md 批次E（HY-1/4/5/6/7/8/9/10/11/13/14/15）
状态：已完成
关联变更：（无）
文件：.github/workflows/backend-ci.yml, .github/workflows/scan-drift.yml, .gitignore, .sillyspec-platform-cleaned, Makefile, README.md, deploy/.env.example, deploy/docker-compose.dev.yml, deploy/docker-compose.yml, meta.json, .codex/skills/deploy-to-server/, .codex/skills/sillyhub-docker-deploy/, .codex/skills/verify-per-user/, .github/workflows/daemon-ci.yml
需求：docs/platform-audit-2026-08-20.md 批次E（HY-1/4/5/6/7/8/9/10/11/13/14/15）
根因：无（CI补齐+部署收紧+卫生清理）
方案：daemon-ci.yml新增；compose端口/口令收紧；meta.json等untrack；CI死配置清理；Makefile/README/.codex补齐；本地垃圾物理删除
结果：YAML全过、释放约400MB、git状态干净

## ql-20260820-006-2297 | 2026-08-20 08:43:37 | /ppm/projects 页「Agent 团队」按钮点击跳转 /projects/{id}/missions 时被拦截
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/layout.test.tsx, frontend/src/app/(dashboard)/layout.tsx
需求：/ppm/projects 页「Agent 团队」按钮点击跳转 /projects/{id}/missions 时被拦截，直接重定向回工作区选择器 /workspaces。
根因：(dashboard)/layout.tsx 工作区守卫白名单 WORKSPACE_WHITELIST 没有 /projects 前缀，pathname 命中守卫第 3 分支 router.replace('/workspaces')。该页是 2026-08-19-cross-workspace-team-mission task-15 新增的平台级跨工作区视图，不依赖所选工作区上下文，属漏配（与 /agent-profiles、/sessions 历史先例同型）。
方案：白名单加入 /projects 并附注释说明；layout.test.tsx 按 TDD 先补 /projects/A/missions 放行用例（改前红、复现 replace /workspaces；改后绿）。
结果：layout.test 18 用例全绿，projects/ppm-projects 页面测试 9 绿，tsc --noEmit 0 错；重建 frontend 镜像重启容器后浏览器实测：点「Agent 团队」→ /projects/{id}/missions 正常停留并渲染「项目团队会话」页（scope 候选正常列出），不再弹回 /workspaces。文件：frontend/src/app/(dashboard)/layout.tsx、frontend/src/app/(dashboard)/layout.test.tsx

## ql-20260820-007-6109 | 2026-08-20 09:59:22 | 修复 spec 同步策略 repo-native/repo-mirrored 在 daemon init 与 batch 路径静默失效
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/spec-sync.ts（handleInitLease 重排 pull→writeDaemonState + bumpLocalSpecVersion 缺失重建）
- sillyhub-daemon/src/task-runner.ts（batch pullSpecBundle 补传 strategy/rootPath + 修两处过时注释）
- sillyhub-daemon/tests/test_init_lease.test.ts（新增策略分支/bump 重建/batch 透传 7 用例，更新 5xx 与顺序用例断言）
- sillyhub-daemon/tests/test_spec_version_refresh.test.ts（bump 缺失与损坏 JSON 两用例更新到重建契约（启动未声明，事后归属））
- backend/app/modules/daemon/lease/context.py（仅注释：.sillyspec-platform.json 旧名改 .runtime/spec-version.json 现行为）
需求：修复 spec 同步策略 repo-native/repo-mirrored 在 daemon init 与 batch 路径静默失效
根因：handleInitLease 的 writeDaemonState 先于 pull 写 .runtime 占位缓存根，阻塞 repo-native junction 守卫与 repo-mirrored 首拷判定（2026-08-15-init-trigger 时序回归）且 pull 的 rm -rf 反删状态文件；batch pullSpecBundle 漏传 strategy/rootPath 永远 platform-managed；bump 状态文件缺失不重建致保鲜永久失效
方案：init 编排重排 pull→writeDaemonState→init（pull 失败 daemonState=null 契约变更）；batch 补传 ctx.specStrategy/ctx.rootPath；bump 缺失/损坏时完整重建 2 字段并补建 .runtime；顺带修 backend context.py 两处过时注释
结果：test_init_lease 新增 7 用例并更新 2 旧断言，test_spec_version_refresh 2 用例更新到重建契约，daemon 全量 143 文件 2453 测试全绿，tsc 干净，backend 注释文件语法通过，模块文档 sillyhub-daemon.md 已同步暂存
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/test_spec_version_refresh.test.ts

## ql-20260820-008-fcb7 | 2026-08-20 10:17:21 | 快速修复列表默认显示空壳占位条目（进行中 quick 会话平台可见）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/changes/quicklog-table.tsx（showPlaceholder 默认 true + hasFilter 翻转为 !showPlaceholder）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx（tab 计数带 include_placeholder=true）
- frontend/src/components/changes/detail/quicklog-linked-card.tsx（关联卡带 include_placeholder=true）
- frontend/src/components/changes/__tests__/quicklog-table.test.tsx（默认显示/取消勾选两断言翻转）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx（计数用例补 include_placeholder 断言）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx（关联卡精确参数断言同步新契约）
- .sillyspec/docs/frontend/modules/lib-quicklog.md（占位口径+消费点更新）
- .sillyspec/docs/frontend/modules/components-changes.md（Table/LinkedCard 描述更新）
需求：快速修复列表默认显示空壳占位条目（进行中 quick 会话平台可见）
根因：quick 会话进行中 CLI 只落「(quick 任务)」占位标题（真实标题 step3 --done 才回填），平台三消费点全按默认隐藏占位口径请求，会话全程在平台不可见
方案：前端三消费点默认/显式传 include_placeholder=true——表格 showPlaceholder 默认勾选（复选框保留、取消=收窄筛选）、tab 计数与详情关联卡显式带参；hasFilter 空态语义同步翻转为「隐藏占位才算筛选」；后端 API 默认语义不动
结果：受影响 3 个测试文件全绿（43+13 用例），前端全量 1770 用例全绿，typecheck 通过
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx

## ql-20260820-012-3dbc | 2026-08-20 15:29:02 | 恢复 commit 漏收且被清工作区的四轮 quick 改动（质感/卡片按钮/顶栏 sticky/两文档）
状态：已完成
关联变更：（无）
文件：.claude/CLAUDE.md, .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md, frontend/src/app/globals.css, frontend/src/components/antd-providers.tsx, frontend/src/components/app-shell.tsx, frontend/src/components/layout/data-table.tsx, frontend/src/components/layout/section-card.tsx, frontend/src/components/top-bar.tsx, frontend/src/components/workspace-card.tsx, frontend/tailwind.config.ts
需求：恢复 commit 漏收且被清工作区的四轮 quick 改动（质感/卡片按钮/顶栏 sticky/两文档），源码与已部署容器一致化
根因：提交主题变更时 quick 后续改动未纳入且工作区被清理，质感/顶栏/文档回退 HEAD
方案：按会话内已验证 diff 逐文件重放十个文件（globals/tailwind/antd-providers/五组件/两文档）；FRONTEND_PAGE_STYLE.md 为有意文档更新（§0.5 主题系统），--force-baseline 显式解锁
结果：tsc 0 error、eslint 0、相关 61 用例过、部署 200、容器产物五项标识全命中，源码=容器=文档一致

## ql-20260820-013-cc92 | 2026-08-20 21:34:14 | 工作区页四点反馈修复——Tabs 风格统一、信息区卡片化、编辑折叠冲突、统计卡换快速修复
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/page.tsx, frontend/src/components/workspace-tabs.tsx, frontend/src/components/workspace/stats-row.tsx
需求：工作区页四点反馈修复——Tabs 风格统一、信息区卡片化、编辑折叠冲突、统计卡换快速修复
根因：子导航下划线旧风格不协调；ghost Collapse 无卡片外观且面板头点击区与编辑按钮事件冲突；运行时阶段卡信息价值低
方案：Tabs 胶囊分段主题化；Collapse 移除改 SectionCard 平铺（基本信息全宽+配置两列）；stats 第四卡 currentStage→quickTotal（listQuicklogEntries 取 total 替换 getRuntimeProgress）
结果：tsc 0 error、eslint 0、页面测试 10/10、全量 168 文件 1793 用例复跑两轮全绿（首轮 1 超时用例为满载 flaky 非本次引入）
审计：📝 文档欠账（D-8）：4 个源码文件改动未同步任何模块文档（涉及模块：frontend）
