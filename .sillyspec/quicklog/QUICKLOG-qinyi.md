
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
