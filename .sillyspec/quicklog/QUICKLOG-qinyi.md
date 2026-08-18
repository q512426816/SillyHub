
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
