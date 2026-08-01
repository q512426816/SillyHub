
## ql-20260729-004-5845 | 2026-07-29 14:31:35 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log/__tests__/normalize.test.ts

结果：需求：补 normalize.test.ts 的 task-08 模型错误可见性测试覆盖(model-error-visibility 归档遗留测试债)。根因：归档 verify 探针发现 normalize.test.ts(原 ~50 测)零覆盖 task-08 新增逻辑(buildErrorLogItem/isAssistantApiErrorText/classifyLog :352 修正/normalizeLogs 结构化错误项/brownfield 兜底/R-02/零回归)。方案：normalize.test.ts 追加 1 个 describe 块,含 buildErrorLogItem 8 类 type 参数化+type非法→unknown+message缺失→运行失败+retryable严格===true+code/hint/raw缺失→null+null非对象→null,isAssistantApiErrorText 识别/不误判,classifyLog [ASSISTANT]+API Error→error,normalizeLogs errorDetail 追加结构化 error 项+[ASSISTANT] API Error 行 hasStructuredError 时 hidden,brownfield 兜底,成功路径零回归。结果：normalize.test.ts 60 tests 全过(含 8 类参数化);node_modules 半坏 vitest shim 丢失 pnpm install --force 修复;frontend.md 变更索引追加 ql-ID。已 git add(normalize.test.ts+frontend.md)未 commit。
## ql-20260729-005-6122 | 2026-07-29 22:18:14 | /runtimes 会话弹窗对话/过程分流（对话·全部二态切换）+ 气泡视觉升级
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-sanitize.ts（新增 classifySessionLog 分类纯函数：reply/thinking/tool/stderr，丢弃规则与原 sanitize 一致；原 sanitizeSessionLogContent 改为薄包装保持旧行为兼容）
- frontend/src/components/daemon/interactive-session-panel.tsx（SessionTurnView 加 details 过程项；SSE onLog 改 classify 分流，output 只装答复正文；头部加「对话/全部」二态 tab；新增 TurnDetailsList：思考折叠块复用 CollapsibleSection + 工具蓝行 + stderr 琥珀行；气泡大圆角 + 助手 Bot 图标 + text-sm leading-6 + 运行中「正在思考…」三点动效占位；删除旧 renderLogContent）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 改走 classifySessionLog：reply→output、thinking/tool/stderr→details 按到达顺序，去重键改 kind:text）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（新增：logsToTurns 分流 4 例）
- frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts（追加 classifySessionLog 8 例）
- frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（追加对话/全部切换 3 例：默认隐藏过程项/切全部展示/运行中思考占位/attach 历史 details）

需求：/runtimes 会话弹窗默认只展示对话（用户消息 + agent 答复正文），thinking/工具调用等其他信息经一个简洁切换再展示（类似运行日志但按钮更少），并优化会话展示视觉效果（原观感太简陋）。
根因：面板把 thinking/tool_call/stderr 全部拼接进 turn.output 同一答复气泡——thinking 仅剥 [THINKING] 前缀正文照显、tool_call 加 🔧、stderr 加 ⚠️，无对话/过程分流机制；展示层只有朴素 rounded-md 小气泡 + text-xs，观感简陋。
方案：① classifySessionLog 分类纯函数把日志分 reply/thinking/tool/stderr 四类（丢弃规则不变）；② SessionTurnView 加 details 过程项，实时 SSE onLog 与历史 logsToTurns 两条链路都走 classify 分流，output 只装答复正文；③ 面板头部加「对话/全部」二态切换（参考 agent-log-viewer 的对话/全部 tab，但无二级筛选按钮组），全部视图过程项渲染在答复气泡前：思考=默认折叠灰块（复用运行日志 CollapsibleSection）、工具=蓝色 Wrench 单行、stderr=琥珀 ⚠ 行；④ 气泡视觉升级：rounded-2xl 大圆角、agent 侧 Bot 图标头像、text-sm leading-6、运行中无答复时三点动效「正在思考…」占位。

补漏（2026-07-29 第二轮）：实测发现对话里仍显示 tool 信息——daemon task-runner 把每次工具调用**双发**两条日志（channel=stdout 的 `[TOOL_USE] Name: {…}` 文本行 + channel=tool_call 的 JSON），原分类只拦 channel=tool_call 的 JSON，stdout 的 `[TOOL_USE]`/`[TOOL_RESULT]` 文本行漏判成 reply 混进对话。修复：classifySessionLog 增加按内容前缀识别 `[TOOL_USE]`/`[TOOL_RESULT]`（含无 channel=null 情况）归 tool 过程项并剥前缀；`[TOOL_RESULT] User answered` 丢弃规则保持在先判。实时 SSE 与历史 logsToTurns 两链路同源生效。
结果：新增 classify 11 例（含 [TOOL_USE]/[TOOL_RESULT] 3 例补漏）+ logsToTurns 分流 4 例 + 面板切换 3 例，受影响 4 个测试文件 78 测试全绿（首轮 6 文件 83 全绿）；tsc --noEmit 通过、eslint 0 error（warning 均为预存）；frontend 模块文档变更索引已同步；未部署，视觉效果建议浏览器实测确认。

## ql-20260730-001-70ae | 2026-07-30 10:55:00 | PPM 执行记录「开始=结束时间」修复（任务计划+问题清单）
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/ppm/execute-time.ts（新建：pickExecuteEndIso 纯函数——中间天返回当天 23:59:59Z，最后一天返回提交时刻 now，now 早于 start 倒置兜底退回日末）
- frontend/src/lib/ppm/execute-time.test.ts（新建：6 用例覆盖中间天/末天提交时刻/倒置兜底/now==start 边界）
- frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx（handleSubmit 跨天提交：循环外固定 now，每日 start 保持原值，end 改用 pickExecuteEndIso 替换原 end=start）
- frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx（与任务计划对称改造）

需求：PPM 任务计划与问题清单的执行记录显示「开始时间」与「结束时间」完全相同，要求修复使其不再相同。
根因：两个详情弹窗的 handleSubmit 在跨天拆分填报时，为绕过后端 D-004「执行起止时间不可跨天」校验，把每条 TaskExecute 记录的 actual_end_time 故意写成等于 actual_start_time——首条 end 取 in-flight 的真实 start，后续天的 start 与 end 同设为当天 12:00——导致每条记录开始=结束，显示必然相同。真实工时由 time_spent（人天）承载，actual 起止本应是有意义的时刻。
方案：① 抽纯函数 pickExecuteEndIso(date, isLast, startIso, now)：中间天返回当天 23:59:59Z；最后一天（=提交当天）返回提交时刻 now，若 now 早于当天 start（上午提交且 start 占位 12:00）倒置兜底退回日末。拆分循环天然保证「末条即今天、中间天均过去日期」，故 start/end 同日不触发跨天校验、且 end>=start。② task/problem-detail-modal 的 handleSubmit 对称改造：循环外固定一次提交时刻 now 避免逐天漂移，每日 start 保持原值（首条=in-flight 真实启动时刻，后续天=当天 12:00 占位），end 改用 pickExecuteEndIso 替换原 end=start。③ 新增 execute-time.test.ts 6 用例。
结果：vitest 3 文件 23 测试全绿（纯函数 6 + 任务弹窗 5 + 问题弹窗 12，零回归）；tsc --noEmit 通过；后端零改动。任务计划与问题清单同款缺陷一并修正，未部署，建议浏览器实测确认开始/结束不再相同。

补漏（2026-07-30 第二轮，真实数据实测）：用户反馈执行记录结束时间仍异常——① 时区：中间天 end 用 `${date}T23:59:59Z`（UTC），+8 下显示成次日 07:59:59、日期晚一天；后续天 start `12:00:00Z` 显示成 20:00。根因是把本地日期直接拼成 UTC 字面量。② 最后一天未记提交时刻：提交时刻早于占位 start（12:00 UTC=本地 20:00）时触发「倒置兜底」被退回日末。修复：新增 localDayTimeToIso(date, time) 按本地时刻解析再转 UTC（前端 dayjs 回显停当天）；pickExecuteEndIso 去掉 startIso 参数与倒置兜底，最后一天恒返回 now.toISOString()；两个 handleSubmit 的 start 占位改 localDayTimeToIso(d.date,"12:00:00")，顺带删去不再使用的 inflightRec / startIso。验证：execute-time 测试改为时区无关断言（本地→UTC→本地往返一致），3 文件 23 测试全绿，tsc exit=0。
## ql-20260730-003-f13c | 2026-07-30 13:08:25 | /runtimes 会话弹窗工具 use/result 配对+状态徽章+思考同类合并
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-sanitize.ts（classifySessionLog 拆 tool→tool_use/tool_result，分别剥 [TOOL_USE]/[TOOL_RESULT] 前缀；新增 isToolResultDenied 纯函数，命中 拒绝/denied/error/失败/fail 判 deny，供 onLog 与 logsToTurns 共用避免两处正则不一致）
- frontend/src/components/daemon/interactive-session-panel.tsx（SessionTurnView 改 processItems 有序过程项替代旧 toolEvents+details；onLog 按真实到达顺序构建——tool_use 推 running、tool_result 配对最近 running 设 ok/deny、孤儿降级 raw 空 tool 项；TurnDetailsList 连续同类合并：连续 thinking 拼成单卡片、被工具穿插则分段保持顺序；ToolEventCard 工具结果 defaultOpen=false 默认折叠 + ✓/✗/⏳ 徽章；思考与工具结果均 MarkdownText 渲染）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 同源 processItems：reply→output、tool_use 推 running、tool_result 配对 ok/deny、孤儿 raw 空兜底；turn 对象 processItems 字段）
- frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts（classify tool_use/tool_result 断言更新 4 例）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（logsToTurns 配对专项 ok/deny/孤儿 3 例 + 原 tool 断言改 toolEvents）
- frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（attach 历史 details 的非法 kind:tool 改走 toolEvents）

需求：会话弹窗恢复工具 use/result 配对+状态徽章（前次 merge 融合时因数据模型冲突被丢弃），且思考过程等同类信息不要一节一节展示、要拼接成一段（参考 agent 执行日志的 mergedThinkingContent 合并展示）。
根因：ql-005 融合后 classifySessionLog 仍把工具统一归单 tool 类、SessionTurnView.toolEvents 字段闲置、onLog/logsToTurns 把所有非 reply 塞 details，导致 use 与 result 无法配对、无状态徽章；另每个 [THINKING] chunk 各自渲染一个折叠卡片，阅读时一节一节割裂。
方案：① classifySessionLog 拆 tool→tool_use/tool_result，新增 isToolResultDenied 共享纯函数；② SessionTurnView 改 processItems 有序过程项，onLog 实时链路与 logsToTurns 历史链路同源——tool_use 推 running、tool_result 配对最近 running 设 ok/deny、孤儿 result 降级 raw 空 tool 项兜底不丢数据；③ ToolEventCard 渲染配对工具卡片（✓ 成功 / ✗ 失败·被拒 / ⏳ 执行中 状态徽章 + 默认折叠 result 太长 + parseToolRaw 命令格式 + 复制）；④ TurnDetailsList 连续同类合并——连续相邻 [THINKING] 拼成一个思考过程卡片，被工具/打断则分段保持真实顺序。
修正（Feedback B+C，2026-07-30）：首版把一个 turn 内所有 [THINKING] 一股脑拼成单个卡片，工具穿插在思考之间时会丢顺序、内容混杂——改为按真实到达顺序入 processItems，仅连续相邻 thinking 合并、被工具打断分段；工具结果默认展开太长，改 defaultOpen=false 默认折叠；思考与工具结果改 MarkdownText 渲染（与对话气泡一致，支持 md 格式）。
结果：daemon 目录 3 测试文件 71 测试全绿（session-log-sanitize 23 + runtime-session-helpers 7 含连续思考被工具打断保持顺序专项 + interactive-session-panel 41）；tsc --noEmit 0 错；frontend.md 变更索引已同步；已 git add（6 源文件 + frontend.md + QUICKLOG）未 commit；已部署本地 docker（镜像 grep「工具结果」「思考过程」字符串命中 + frontend healthy）。
## ql-20260731-001-3abf | 2026-07-31 14:50:34 | 平台技能清单显示每个技能描述（manifest 增 skills 摘要字段）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/skills_bundle_service.py（新增 _parse_skill_frontmatter 解析 SKILL.md 开头 YAML frontmatter 取 name/description，无围栏 / YAML 错 / 解码错均返回空 dict 不抛；新增 _summarize_skills 按顶层目录聚合 name/description/file_count，name=目录名与 daemon 同步路径一致；build_skills_manifest 返回新增 skills 字段，不动 files）
- backend/app/modules/daemon/tests/test_skills_bundle.py（加 4 测试：frontmatter 解析 / 聚合 / 端到端 description / 无 frontmatter 空兜底；新增 skills_dir_with_descriptions fixture）
- frontend/src/lib/custom-skills.ts（加 PlatformSkillSummary 类型 name/description/file_count；PlatformSkillsManifest 加可选 skills 字段，端点 dict[str,Any] 未进 OpenAPI 继续手写）
- frontend/src/app/(dashboard)/settings/skills/page.tsx（deriveSkillGroups 回退结构对齐 skill→name / fileCount→file_count；platformGroups 优先 manifest.skills 兜底 deriveSkillGroups；表格说明列渲染 g.description || 通用文案）
- frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx（加 description 渲染测试：mock manifest 带 skills 断言描述显示）

需求：平台技能设置页「系统自带技能」清单每个技能（如 sillyspec-archive）只显示技能名，「说明」列所有技能写死同一句通用文案「只读 · 随部署更新，AI 启动自动加载」，看不到各技能自己的描述（如 archive 是「用于归档已验证完成的变更」）。用户反馈连续两轮被误判为「自定义技能空状态」问题，实际是系统自带技能清单缺描述展示。
根因：后端 build_skills_manifest 返回的 manifest 只有 files[{path, sha256}]（daemon 同步用），没带每个 skill 的 description；前端 PlatformSkillsManifest 类型无 description 字段，deriveSkillGroups 只从 files 聚合技能名+文件数，表格「说明」列无数据可显只能写死通用文案。数据链路断在中间——前端拿不到描述，想显示也显示不出来。
方案：① 后端 skills_bundle_service 新增 _parse_skill_frontmatter（解析 SKILL.md 开头 YAML frontmatter 取 name+description，无围栏 / YAML 错 / 解码错均返回空 dict 不抛异常）+ _summarize_skills（按顶层目录聚合 {name, description, file_count}，name=目录名与 daemon 同步路径、前端 deriveSkillGroups 口径一致，注意目录名 sillyspec-archive ≠ frontmatter name sillyspec:archive）；build_skills_manifest 返回新增 skills 字段，不动 files（daemon 同步与 version 计算零影响）。② 前端 custom-skills.ts 加 PlatformSkillSummary 类型 + manifest 加可选 skills 字段（端点 dict[str,Any] 未进 OpenAPI 生成范围，手写对齐后端）；page.tsx platformGroups 优先用 manifest.skills（deriveSkillGroups 兜底），表格说明列渲染 g.description || 通用文案。
结果：后端 test_skills_bundle 15 passed（含 4 新测试：frontmatter 解析 / 聚合 / 端到端 description / 无 frontmatter 空兜底）；前端 page.test 7 passed（含 description 渲染新测试）；gen:types 无 diff（manifest 端点 dict[str,Any] 不影响 OpenAPI schema）；前端 tsc --noEmit exit 0。改 5 代码文件 + 2 模块文档（backend.md / frontend.md 变更索引同步），已 git add 未 commit。未部署，建议重启 backend + 浏览器实测确认各技能描述显示。