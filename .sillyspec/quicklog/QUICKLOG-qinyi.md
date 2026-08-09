
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
## ql-20260801-003-baf7 | 2026-08-01 23:00:26 | 交互式会话展示 AskUser 问答历史（已答/历史回看可见）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/permission_service.py — 新增 list_dialog_history（查全 status，不过滤 pending）
- backend/app/modules/daemon/router.py — 新增 GET /sessions/{id}/dialogs/history 端点
- backend/app/modules/daemon/tests/test_session_permissions.py — 新增 list_dialog_history 测试（断言 pending+answered 全返回、pending 端点只返回未答）
- backend/openapi.json — gen:types 重新 dump（345 paths 含新端点）
- frontend/src/lib/api-types.ts — gen:types 重新生成（SessionDialogRead 复用，paths 加 history）
- frontend/src/lib/daemon.ts — 新增 fetchSessionDialogHistory + SessionDialogRead 类型导出
- frontend/src/components/daemon/session-log-sanitize.ts — 新增 extractDialogQA 纯函数（payload/answer → 问题回答对）
- frontend/src/components/daemon/interactive-session-panel.tsx — 新增 dialogHistory state+effect+「提问记录」渲染区块（不受 failed/ended 限制）
- frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts — extractDialogQA 单测
- frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx — 补 fetchSessionDialogHistory mock（beforeEach mockResolvedValue，否则 .then 崩）

需求：交互式会话面板回看时看不到 AskUser 提问与回答，用户无法得知问过什么、答了什么。
根因：AskUser 调用已持久化在 session_dialog_requests（含问题/选项/回答，实测 25 条），但前端三道关卡叠加致"用完即焚"——session-log-sanitize.ts:66 过滤所有含 AskUserQuestion 的日志（不进工具记录）、AskUserDialogCard 回答后 onPermissionResolved 立即移除、interactive-session-panel.tsx:1092 对 failed/ended 会话不渲染卡片，历史回看完全无痕。
方案：后端新增 list_dialog_history（与 list_pending_dialogs 同结构但不过滤 status，返回 pending+answered 全部）+ GET /sessions/{id}/dialogs/history 端点；前端 daemon.ts 加 fetchSessionDialogHistory、session-log-sanitize 加 extractDialogQA 把持久化 payload/answer 归一成「问题→回答」对、interactive-session-panel 加 dialogHistory state+effect（sessionId 变化拉历史）+ 独立「提问记录」渲染区块（不受 view.status 限制，failed/ended 也能看）；gen:types 同步 openapi。
结果：backend test_session_permissions 21 passed（含新 list_dialog_history 测试）、frontend sanitize+panel 全过（extractDialogQA 单测 + panel 41 passed，修了 mock 漏 fetchSessionDialogHistory 致 .then 崩的坑）、typecheck exit 0；待部署本地 + 阿里云。
## ql-20260801-004-39b7 | 2026-08-01 23:54:30 | 交互式会话工具卡片状态徽章修复（Runtime Policy 拒绝正确显示✗）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-sanitize.ts（isToolResultDenied 收紧关键词：去 error/fail 防成功输出正文误判，保留 拒绝|denied|失败|禁止写入|not allowed）
- frontend/src/components/daemon/interactive-session-panel.tsx（onLog 实时配对：result 拒绝优先覆盖 use 的 success——isToolResultDenied(result)→deny 覆盖 ok/running，否则 success 权威；孤儿 result 降级不再硬编码 ok）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 历史配对：与 onLog 对称同改 result 拒绝覆盖 + 孤儿降级）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（新增 Runtime Policy 拒绝覆盖用例 success:true+拒绝result→deny + 孤儿拒绝→deny；更新 grep-fail 用例注释，断言 ok 不变）

需求：交互式会话 Write 工具被 Runtime Policy 拒绝执行，但工具卡片状态徽章仍显示✓（成功），应显示✗（失败/被拒）。
根因：双重叠加——①daemon task-runner.ts:1895 每个 tool_use 发的 tool_call JSON 硬编码 success:true，其语义是「该调用已被放行、进入执行」，并非「执行成功」（调用发起那一刻 daemon 还不可能知道结果）；②前端配对逻辑（interactive-session-panel.tsx:316-321 实时 / runtime-session-helpers.tsx:212-217 历史，两处对称）仅在工具还显示「执行中 ⏳」(status===running) 时才看 result 文本判 deny，一旦 success:true 把状态标成 ok，后续到达的拒绝 result 因 status 非 running 直接保留原值无法覆盖；孤儿 result（无配对 use）更直接硬编码 status:"ok"。而 Runtime Policy 拒绝只体现在 tool_result 文本（filesystem-policy.ts 固定文案「Runtime Policy 拒绝本次写入」），调用阶段 success:true 与拒绝结果矛盾时前端信了 success。这是 ql-20260730-003 把 success 设为「权威源」时埋的漏洞——它假设 success 是真实执行结果，但 daemon 恒 true。
方案：①isToolResultDenied 收紧关键词，去掉 error/fail（成功输出正文常含这些字样会误判，如 grep 命中 "fail"、测试报告 "0 errors"），保留明确的拒绝/失败信号「拒绝|denied|失败|禁止写入|not allowed」，宁可漏判（success 兜底 ok）不可误判正文；②两处配对逻辑改为 result 拒绝**优先覆盖** use 的 success——isToolResultDenied(result) 命中则一律 deny（覆盖 ok 与 running），否则保持 success 权威（正常成功路径不变）；③孤儿 result 降级同理用 isToolResultDenied 判定，不硬编码 ok。不改 daemon——tool_use 阶段确实不知结果，success:true 表「已放行」语义没错，错在前端拿它当最终执行结果。
结果：daemon 目录 3 测试文件 83 passed（session-log-sanitize 32 + runtime-session-helpers 10 含新增 Runtime Policy 拒绝覆盖 + 孤儿拒绝 2 用例 + interactive-session-panel 41；grep-fail 用例注释更新、断言 ok 不变零回归）；tsc --noEmit exit 0。改 4 文件，已 git add 未 commit；待部署本地 + 阿里云，建议浏览器实测确认拒绝的 Write 显示✗。
## ql-20260802-001-22dd | 2026-08-02 00:09:03 | AskUser 提问记录跟会话顺序穿插到对应轮次（不再堆顶）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/interactive-session-panel.tsx（SessionTurnView 加 realRunId 字段；渲染层 dialogHistory.filter(run_id 匹配) 把提问穿插到对应 turn 内过程项后答复前、不受 viewMode 限制；删除原顶部「📝 提问记录」堆叠区块）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 按 log.run_id 分组时保留真实 run_id 到 turn.realRunId——原 map 遍历 key 被丢弃）
- frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（新增 AC-10-01b：mock 含 run_id 的 dialog 断言提问穿插到 turn 内、顶部「提问记录」不出现）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（首个用例加 realRunId===run-1 断言）

需求：交互式会话的「📝 提问记录」把所有 AskUser 问答一股脑堆在会话顶部，割裂了上下文——提问应跟会话顺序，出现在它对应的那一轮里（用户消息之后、agent 答复/动作之前）。
根因：AskUserQuestion 不走 agent 日志流——daemon cli.ts:653-659 把它路由到 onUserDialog 回调，经 PERMISSION_REQUEST（带 dialog_kind/payload）推到前端，答案经 dialog_result 回喂 SDK，整个过程不产生 tool_use/tool_result 日志。ql-003 因此无法靠日志到达顺序插入 turn，改用独立顶部区块绕过展示，结果所有提问堆在 turns 列表之前。但 session_dialog_requests 表有 run_id 外键（model.py:234，FK→agent_runs 非空），SessionDialogRead 已暴露 run_id——提问其实能精确归属到产生它的那个 run（轮次）。
方案：①SessionTurnView 加 realRunId 字段；②logsToTurns 按 log.run_id 分组时把真实 run_id（map 的 key，原 `for (const [, entries])` 被丢弃）保留到 turn.realRunId，turn.runId 仍是伪 __attach_history_N__ 作 React key 不变；③panel 渲染层在每个 turn 内 `dialogHistory.filter(d => d.run_id === (turn.realRunId ?? turn.runId))` 把匹配的提问渲染到该 turn 过程项之后、答复之前（不受 viewMode 限制——提问是重要交互，对话视图也要可见），删除顶部堆叠区块；④实时 turn 的 runId 本就是真实 run_id，realRunId 留 undefined，匹配用 `realRunId ?? runId` fallback；⑤pending 实时交互卡片（AskUserDialogCard）保留顶部不变（进行中的提问仍需用户点选交互）。
结果：daemon 测试 session-log-sanitize 32 + runtime-session-helpers 10（含 realRunId 断言）+ interactive-session-panel 42（含 AC-10-01b 穿插用例）全绿、tsc --noEmit exit 0。改 4 文件，已 git add 未 commit；待部署本地 + 阿里云，建议浏览器实测确认提问出现在对应轮次内而非堆顶。
## ql-20260802-002-3b75 | 2026-08-02 00:45:12 | 「全部」视图 AskUser 渲染为工具调用卡片（和 Write/Bash 一致）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/interactive-session-panel.tsx（新建 AskUserToolCard 组件：蓝底工具卡片复用 ToolEventCard 样式——🔧AskUserQuestion + ✓已答/⏳待答徽章 + 问题→回答；渲染块改 viewMode 分支：「全部」视图用 AskUserToolCard、「对话」视图保留 ❓ 提问记录）
- frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（新增 AC-10-01c：切「全部」视图断言工具名 AskUserQuestion 可见 + 回答可见；默认对话视图无工具名）

需求：「全部」视图看不到 AskUser 工具调用记录及内容，应像 Write/Bash 一样在工具区有工具卡片。
根因：AskUserQuestion 走 onUserDialog 对话协议(cli.ts:653-659)不走 tool_use 日志流，而「全部」视图工具卡片(ToolEventCard)靠 tool_use 日志构建，故工具区无 AskUser；session-log-sanitize.ts:66 还丢弃含 AskUserQuestion 的日志。ql-005 用❓提问记录(提问历史接口)穿插但非工具卡片样式，不在工具区。
方案：新建 AskUserToolCard 组件(蓝底工具卡片复用 ToolEventCard 样式:🔧AskUserQuestion+✓已答/⏳待答徽章+问题→回答)；渲染层 viewMode 分支——「全部」视图用 AskUserToolCard、「对话」视图保留❓提问记录；都用 dialogHistory 按 run_id 穿插到对应 turn。pending 实时卡片不变。
结果：daemon 3 测试文件 84 passed(panel 43 含 AC-10-01c 全部视图工具卡片断言)、typecheck exit 0；待部署本地+阿里云。
## ql-20260802-003-98a0 | 2026-08-02 01:04:58 | AskUser 卡片显全部选项 + 思考/工具/提问按时间线连贯有序
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-sanitize.ts（extractDialogQA 升级：新 DialogOption+selected，提取全部 options，answer→answerText；修旧版只取 question+answer 丢 options）
- frontend/src/components/daemon/interactive-session-panel.tsx（SessionProcessItem 加 ts；onLog 5 处填 ts；turn 渲染「全部」视图合并 processItems+dialog 按 ts 排序统一渲染=AskUser 穿插时间线；TurnDetailsList 加 askUser 分支；AskUserToolCard 重构显全部选项 选中绿底✓/未选灰○/hover 显 description；对话视图改用 answerText）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 5 处填 ts，供历史回看时间穿插）
- frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts（extractDialogQA 5 case：含 options/selected 提取 + 未答全未选兜底）
- frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（AC-10-01c 改：dialog 加 options，断言全部视图选中项+未选项均可见）

需求：用户反馈交互式会话「全部」视图三处问题——①AskUser 卡片样式跟 Write/Bash 工具卡片不一样；②只显示用户选中的那一个选项、看不到其余备选；③思考过程跟工具调用要连贯有顺序。
根因：①（选项不全）extractDialogQA 只取 question+answer，丢弃 dialog_payload.questions[].options（DB 实测每问 3-4 个 {label,description}），且 (Recommended) 是 option.label 自带不是渲染加的；②（样式割裂）AskUserToolCard 内容区（❓问题+单行→回答）与 ToolEventCard（mono 参数行+折叠结果）风格不一致；③（不连贯无序）AskUser 卡片由 dialogHistory.filter 单独渲染、固定堆在所有 processItems 之后，脱离思考/工具时间线——而 AskUser 走 onUserDialog 不进 tool_use 日志，原本无法与思考/工具共序。
方案：①extractDialogQA 升级提取全部 options 并按 answer.answer===option.label 标记 selected，answerText 兜底自由作答；②AskUserToolCard 重构为显全部选项（选中绿底✓ / 未选灰○ / hover 显 description），问题用 mono 参数风对齐 ToolEventCard；③SessionProcessItem 加可选 ts，onLog（实时 env.timestamp）与 logsToTurns（历史 entry.timestamp）5 处填 ts，turn 渲染「全部」视图把 processItems 与该 turn 的 dialog（ts=created_at）合并按 ts 排序统一交给 TurnDetailsList 渲染——思考/工具/AskUser 同一时间线连贯有序（sort 用 Number.isFinite 守 NaN）；对话视图保留 ❓+answerText 轻量记录。
结果：daemon 147 passed（13 files，新增 extractDialogQA options/selected 5 case + AC-10-01c 显全部选项断言）、tsc exit 0；待部署本地+阿里云。样式观感待浏览器实测。
## ql-20260803-003-cb34 | 2026-08-03 14:26:25 | POST /api/workspaces 复用已存在工作区（同 root_path active/pending/软删）时必须显式提示
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/workspace/schema.py（WorkspaceRead 加可选 `creation_notice`，仅创建端点填，列表/详情恒 None）
- backend/app/modules/workspace/service.py（`create` 加 `notice` 注入参数，默认 None 零影响；reused_active / activated_pending / resurrected 三分支填 kind）
- backend/app/modules/workspace/router.py（`_CREATION_NOTICE_TEXT` 中文提示 + `_creation_notice` 映射，create_workspace 按 notice 回填）
- backend/app/modules/workspace/tests/test_router.py（`test_create_duplicate_returns_existing` 补断言：新建无提示 + 复用必带「复用」文案）
- backend/openapi.json（gen:types 同步刷新）
- frontend/src/components/workspace-scan-dialog.tsx（创建成功读 `ws.creation_notice` 非空即 `notify.warning`，否则 success「工作区已创建」）
- frontend/src/lib/api-types.ts（gen:types 生成含 creation_notice）
- frontend/src/lib/errors.ts（useNotify 补 `warning` 键 → antd message.warning）

需求：POST /api/workspaces 复用已存在工作区（同 root_path active/pending/软删）时必须显式提示，杜绝「创建成功却看不到 / daemon 没绑定」困惑。
根因：service.create 对同 root_path 已存在 active 工作区直接 `return existing`（复用），pending 走激活、软删走复活，三条路都静默返回 201；router 无任何标记，前端对话框 `createWorkspace` 成功即 `onCreated()` 关闭，用户完全无感知。且复用分支不写 daemon 绑定，用户传的 daemon_id 被吞。
方案：后端 `WorkspaceRead` 加可选 `creation_notice`；`service.create` 加 `notice` 注入参数（默认 None，不动 12 处直接调 create 的测试签名）在复用/激活/复活三分支填 `kind`；router 用 `_CREATION_NOTICE_TEXT` 转中文提示（含「daemon 绑定未写入，请进工作区后配置」）；前端对话框收到非空即弹 warning；`useNotify` 补 `warning` 键。改后跑 `pnpm gen:types` 刷新 openapi.json + api-types.ts。
结果：后端 ruff/mypy 绿，workspace 模块 142 passed + 新增回归 2 passed；前端 tsc 全量 0 错、workspace 相关 57 passed；模块文档 backend.md / frontend.md 变更索引已同步。
## ql-20260804-001-4a3e | 2026-08-04 09:54:26 | borrow 前端清债：本地兜底类型切回 OpenAPI 生成类型 + 删过时注释
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/workspace-binding.ts（MemberBindingWithShared intersection 与 SharedDaemonView interface 改为生成类型别名，消费方 import 名不变零改动；同步更新 61-72 过时注释）
- frontend/src/components/agent/borrowed-solution-files.tsx（删 18-22 过时「后端无按 owner_type list 端点」注释，重写为现状：容器层 panel 已调 GET /api/file/list 拿 id 透传）
- frontend/src/components/workspace/shared-daemon-manager.tsx（180 行 shortId(d.daemon_id) → shortId(d.daemon_id ?? null)，适配生成类型 daemon_id 变 optional）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引追加本 ql 条目）

需求：清理 borrow 功能（change 2026-07-25-daemon-borrow-for-business 收尾）前端两处遗留小债——过时注释 + 本地兜底类型未切回生成类型。
根因：该 change task-12 落地时后端 openapi/api-types 尚未刷新含 shared 字段与 SharedDaemonView，前端用本地 intersection + 本地 interface 兜底并留 TODO；后续 gen:types 已补齐生成类型，但本地兜底未切回、注释未更新，形成类型债与误导性注释。
方案：① workspace-binding.ts 把 MemberBindingWithShared 与 SharedDaemonView 改为生成类型别名（消费方 import 名不变零改动）并更新过时注释；② borrowed-solution-files.tsx 重写过时注释为现状（容器层 panel 已调 listFiles）；③ shared-daemon-manager.tsx:180 适配生成类型 optional（daemon_id ?? null 归一化匹配本地 shortId(string|null)）。
结果：确认 api-types.ts 已含 MemberBindingView.shared 与 SharedDaemonView，无需 gen:types；pnpm run typecheck（tsc --noEmit）0 error 通过；frontend 模块文档变更索引已同步。
## ql-20260805-001-8d02 | 2026-08-05 08:32:21 | change 2026-08-04-agent-profile-ui-redesign 表述勘误：owner 离开后「仍可见」+ 聚合响应命名 AgentProfileAggregatedListResponse
状态：已完成
关联变更：2026-08-04-agent-profile-ui-redesign
文件：
- backend/app/modules/agent/profile/service.py（list_visible_all docstring 重写 R-07 段：owner 离开 ws 后 workspace 级档对 owner 仍可见——_can_read 对 owner 短路与 get 一致，并纠正原「clause 拼接法会因 owner 短路误放行」的颠倒对比）
- backend/app/modules/agent/tests/test_profile_service.py（R-07 测试注释更新：design 原措辞「不可见」系表述错误已勘误为「仍可见」，仲裁记录与不改 _can_read_async 的边界说明保留）
- .sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/design.md（§10 R-07 应对「owner 离开后不可见」→「仍可见」；§7.1 Response 200 由 AgentProfileListResponse 改为实建的 AgentProfileAggregatedListResponse 并注明独立类型非复用）
- .sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/tasks/task-01.md（implementation 与 acceptance 两行同源「owner-left-ws 该档不可见」→「该档仍可见」）

需求：change 2026-08-04-agent-profile-ui-redesign 归档前两处表述勘误（verify-result 已记录）：①service.py list_visible_all docstring + design §10 R-07 写「owner 离开后不可见」，与代码事实相悖；②design §7.1 聚合响应命名写复用 AgentProfileListResponse，实建为 AgentProfileAggregatedListResponse。
根因：`_can_read` 对 WORKSPACE 级 owner 短路（service.py:168 返 owner_user_id==actor.id、不查成员），owner 离开 ws 后该档仍可见；list_visible_all 逐档复用 _can_read_async，故聚合视图行为与 get() 一致 = 仍可见，docstring/design 原措辞误写「不可见」，且把 clause 拼接法行为描述颠倒。聚合端点（router.py:102）实建独立 `AgentProfileAggregatedListResponse`，design §7.1 误写复用 AgentProfileListResponse。
方案：service.py docstring 重写 R-07 段为「owner 离开后仍可见（owner 短路，与 get 一致）」并修正 clause 拼接法对比（clause 法按成员过滤，owner 离开后不放入）；design §10 R-07 同步为「仍可见」；design §7.1 Response 200 改 AgentProfileAggregatedListResponse；归档 task-01.md 两行同源表述同步；test R-07 注释更新为已勘误状态。改动全为 docstring/注释/文档，零功能变更。
结果：uv run pytest test_profile_service.py + test_profile_router.py 62 passed（含 R-07 owner-left-ws 用例 test_owner_left_ws_workspace_level_matches_get_behavior）；无 lint/type 影响（纯注释文档改动）。
## ql-20260805-002-6600 | 2026-08-05 13:54:11 | 工作区详情页去除冗余类型断言（MemberBindingWithShared 已成别名）
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - L29 移除失效的 `type MemberBindingWithShared` import（断言去除后全文件无引用）
  - L343 `shared={(myBinding as MemberBindingWithShared).shared}` → `shared={myBinding?.shared}`
  - L336-338 同块注释更正：「生成类型暂缺，按 MemberBindingWithShared 取用」→「生成类型已含（model 默认 false）」

需求：工作区详情页 page.tsx:343 的 `(myBinding as MemberBindingWithShared)` 类型断言已成冗余，去除后改用 `myBinding?.shared`，并保证 typecheck 通过。
根因：MemberBindingWithShared 已是 MemberBindingView 的纯别名（workspace-binding.ts:77），OpenAPI 生成类型 MemberBindingView 已含 shared 字段（api-types.ts:10378），myBinding 在 myBinding&& 守卫块内本身已是该类型，断言多余。
方案：表达式改为 shared={myBinding?.shared}；移除随之失效的 line 29 type MemberBindingWithShared import；更正同块「生成类型暂缺，按 MemberBindingWithShared 取用」过时注释为「生成类型已含」。
结果：pnpm run typecheck（tsc --noEmit）零错误通过。
## ql-20260805-003-7c2d | 2026-08-05 21:30:00 | change 2026-08-05-daemon-kill-channel-unify 文档同步（task-14）：CONCERNS/INTEGRATIONS/QUICKLOG + 4 处 spec 勘误
状态：已完成
关联变更：2026-08-05-daemon-kill-channel-unify
文件：
- .sillyspec/docs/multi-agent-platform/scan/CONCERNS.md（新增「daemon kill 通道」节：标历史 P0-1/P0-2 已修 d06d9a32/9e4faf06/372e52d8 + 本次 5 项新机制 task-01/02/04+05/08/10+11）
- .sillyspec/docs/multi-agent-platform/scan/INTEGRATIONS.md（§2.1 新增 WS 消息类型表：LEASE_CANCEL 新增行 + SESSION_INTERRUPT 收窄 + SESSION_END 扩大）
- .sillyspec/changes/2026-08-05-daemon-kill-channel-unify/design.md（RS-1 修 §5/§12「两 provider 都赋值 state.driverHandle」→ 实为 claude=state.query / codex=state.driverHandle 按 provider 分流；RS-2 修 §5/§6/§8「api-types.ts 含 budget_tokens」→ payload 是开放 dict 透传键非命名 schema 字段，typed 字段在 daemon types.ts）
- .sillyspec/changes/2026-08-05-daemon-kill-channel-unify/tasks/task-11.md（RS-5 注 allowed_paths 扩 scope：补 lease/service.py + session/service.py 两清空点）
- .sillyspec/changes/2026-08-05-daemon-kill-channel-unify/tasks/task-03.md（AC-3 勘误：close() 本身不吞错，异常由 _terminateSession 调用点 try/catch 兜底 R-01）
- .sillyspec/quicklog/QUICKLOG-qinyi.md（本条目）

需求：change 2026-08-05-daemon-kill-channel-unify（daemon kill 通道统一，Waves 1-4 全部实现 + review.json 全 pass）的文档同步收尾——scan CONCERNS.md 标历史 P0 已修 + 本次新机制、protocol 双端 WS 消息表、QUICKLOG 条目，外加 4 处 spec 文档与已验证实现不一致的措辞勘误（orchestrator 扩展的 RS-1/RS-2/RS-5/AC-3）。
根因：① scan 文档（CONCERNS/INTEGRATIONS）滞后于代码，未反映 kill 通道两层演进（历史 P0 backend→WS 信号层已修 + 本次 daemon 物理杀进程层）；② change 自身 spec 文档 4 处措辞与 task 子代理实际实现有出入——design §5/§12 称「两 provider 都赋值 state.driverHandle」（实际 claude 存 state.query，_terminateSession 按 provider 分流，task-01 review.json RS-1）、design §5/§6/§8 称「api-types.ts 含 budget_tokens 命名字段」（实际 LeaseClaimResponse.payload 是开放 dict，budget_tokens 是运行时键非命名 schema，typed 字段在 daemon types.ts task-08，task-07 review.json RS-2）、task-11 allowed_paths 漏列 lease/service.py + session/service.py 两清空点（CONTRACT_SCOPE_GAP 调度已批，task-11 review.json RS-5）、task-03 AC-3 称「close 调 query.close 且异常被 catch」（实际 close() 不吞错，异常在 _terminateSession 调用点 catch R-01，task-03 review.json RS）。
方案：纯文档改动零代码——① CONCERNS.md 新增「daemon kill 通道（interactive/batch 终止契约）」节，分「历史 P0 已修」（引 3 commit）+「本次新机制」（5 项：Claude END 接通 SDK kill 链 / cancel_lease 改发 SESSION_END / batch LEASE_CANCEL WS / budget 软切断 / terminating_at+sweeper，每项引 task 编号 + 文件路径）；② INTEGRATIONS.md §2.1 新增双端 WS 消息类型表（13 行），LEASE_CANCEL 标新增、SESSION_INTERRUPT 标收窄、SESSION_END 标扩大；③ QUICKLOG 加本条目；④ design.md §5 Phase1+§12 修 RS-1（按 provider 分流措辞）、§5 Phase3+§6+§8 修 RS-2（开放 dict 透传键非命名字段）；⑤ task-11.md allowed_paths 补 lease/service.py + session/service.py + 注 RS-5 扩 scope 缘由；⑥ task-03.md implementation 修 AC-3（close 不吞错、调用点 catch）。所有勘误均对照 review.json + 实际源码（claude-sdk-driver.ts:397/267、session-manager.ts:950/952/2164-2167、types.ts:431、protocol.py:64、protocol.ts:162、openapi.json LeaseClaimResponse.payload additionalProperties:true）核实。
结果：6 个文档全部更新；零代码改动、零测试运行（纯文档一致性核对，对照 review.json + 源码逐条核实措辞）。RS-1/RS-2/RS-5/AC-3 全部应用。无 BLOCKED。
## ql-20260806-001-0da9 | 2026-08-06 08:43:56 | gen:types 在 frontend/daemon node_modules 半坏时（openapi-typescript 包在但 .bin shim 缺）…
状态：已完成
关联变更：（无）
文件：
- frontend/scripts/gen-api-types.mjs — 加 assertOpenapiTypescriptShim()（跑 openapi-typescript 前查 node_modules/.bin/openapi-typescript，Win 查 .CMD+无后缀；缺则报期望路径 + node_modules 半坏 + pnpm install --force + 勿误判包坏，exit 1）；dump_openapi 与 openapi-typescript 两步 execSync 各包 try/catch 给明确指引。
- sillyhub-daemon/scripts/gen-api-types.mjs — 同款 assertOpenapiTypescriptShim() + openapi-typescript execSync try/catch（该脚本无 dump 步，只消费 openapi.json）。

需求：gen:types 在 frontend/daemon node_modules 半坏时（openapi-typescript 包在但 .bin shim 缺）报 stdout:null/stderr:null 裸 Error，极易误判成包坏了；要给明确可操作的报错。
根因：两脚本用 npx --no-install openapi-typescript，shim 缺失时 npx 找不到命令，execSync 抛裸 Error 对象（其 stdout/stderr 属性在 stdio:inherit 下为 null），错误信息丢失；CLAUDE.md 规则 20 已警告此场景但脚本侧无自检。
方案：frontend/scripts/gen-api-types.mjs + sillyhub-daemon/scripts/gen-api-types.mjs 一致加 assertOpenapiTypescriptShim()（跑前查 .bin/openapi-typescript，Win 查 .CMD+无后缀；缺则报期望路径+node_modules 半坏+pnpm install --force+勿误判包坏，exit 1）+ openapi-typescript execSync 包 try/catch 给明确指引；frontend dump_openapi 步也加 try/catch。
结果：happy path 两脚本 gen:types 成功；受控 error-path（临时改名 shim）新报错清晰可操作 exit 1，恢复后正常；无业务/类型改动，api-types.ts CRLF 噪声已还原。
## ql-20260807-001-f9ba | 2026-08-07 08:43:12 | pre-commit mypy 改单文件扫（staged .py）+ 全仓提醒不拦截
状态：已完成
关联变更：（无）
文件：
- `.claude/hooks/pre-commit-ci-check.cjs`（changedFiles 加 `--diff-filter=ACMR` 排删除态；mypy 块从写死 `uv run mypy app` 改成只扫 staged backend .py + log 提醒手动跑全仓）

需求：多子代理并发改同一 worktree 不同模块时，pre-commit 的全仓 `mypy app` 会扫到他人未提交的在途文件 / 预存 mypy 债，把彼此 commit 卡死（public-mcp-server task-12/14 实际撞过——各自模块 mypy 全绿却因别人的在途文件被拦，形成"不能改别人文件、hook 又扫全仓"的死锁）。
根因：hook 写死 `uv run mypy app`（全仓扫），与 worktree 多代理并发执行模型冲突。
方案：mypy 改传 staged 的 backend .py 文件列表（剥 `backend/` 前缀），mypy 默认 `--follow-imports=normal` 只报命令行显式文件的错误、依赖模块分析但不报 → commit 不被他人债拖累；全仓跨文件检查降级为 log 提醒（不拦截、不自动跑，免拖慢 commit）+ CI 兜底。另加 `--diff-filter=ACMR` 排删除态免 mypy 报 "Can't get file"。
结果：实测验证——临时 stage `backend/app/__init__.py` 喂 JSON 触发 hook，mypy 单文件扫 passed + 提醒 log 正常 + commit 放行；多文件引号在 Windows cmd 拼接正确（2 source files）；mypy 单文件扫只报显式文件行为正确。提交 49a80ea1（仅 hook 一个文件）。代价：跨文件类型错误（调用方传错类型给被改函数）单文件扫不到，靠提醒 + CI 兜底。

## ql-20260807-004-e5bf | 2026-08-07 20:26:54 | opencode 供应商预设数据先备（仅前端数据模块）
状态：已完成
关联变更：（无）
文件：
- frontend/src/config/opencodeProviderPresets.ts（新建：8 家 opencode 供应商预设常量——Kimi/Kimi For Coding/智谱GLM/DeepSeek/MiniMax/百炼/StepFun/OpenRouter；数据逐字抄 cc-switch `opencodeProviderPresets.ts` 的 npm+base_url+models+set_cache_key，剔除全部 affiliate 参数；导出 `OPENCODE_PRESETS_BY_CATEGORY`/`OPENCODE_PRESET_BY_KEY` 供未来表单消费）
- frontend/src/config/__tests__/opencodeProviderPresets.test.ts（新建：7 用例钉数据不变量——key 唯一/npm 白名单/base_url 无尾斜杠/URL 无 affiliate/不携带明文 apiKey/models 合法/分组索引保序）

需求：参考 cc-switch 供应商数据，把 opencode 供应商预设默认加到平台；范围=先只加前端预设数据（表单/后端当前仍 claude-only）。
根因：无，纯新增数据模块——opencode 配置形态（opencode.json 的 `provider.<名字>` 块：npm+options.baseURL+options.apiKey+models）与 claude 的 ANTHROPIC_* env 注入完全不同，不能复用 `llmProviderPresets.ts` 的 env 块结构，需独立数据文件先把供应商数据备好。
方案：新建 `config/opencodeProviderPresets.ts`，扁平化承载 opencode `provider.<name>` 块（key/name/npm/base_url/set_cache_key/models/website_url/api_key_url/icon_color），数据逐字抄 cc-switch `opencodeProviderPresets.ts`（R-05 不臆造模型名/URL），affiliate 参数（?aff=/?ic=/?from=/invitecode/utm_/ref=/ac=）全部剔除；分类复用 cn_official/aggregator，导出分组/按键索引；`name` 同时是 opencode config 的 provider key 故保持英文名。新建同目录 `__tests__/opencodeProviderPresets.test.ts` 钉不变量防抄录手滑。
结果：前端单测 7/7 全过，`tsc --noEmit` 0 错；frontend 模块文档变更索引已追加 ql-ID 并暂存；当前表单/后端仍 claude-only，本数据模块暂未被消费，待 opencode agent 全链路支持（backend agent_kind 放开 + daemon OpenCodeCredentialInjector + 表单预设选择器）时接入。已 git add（2 数据/测试文件 + frontend.md）未 commit。
## ql-20260808-001-4068 | 2026-08-08 23:25:47 | 安全加固三联：gateway 子进程环境隔离 + admin 支配权校验 + PPM 成员经理校验
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/worktree/exec_env.py（build_env_vars 补 `_OS_ENV_ALLOWLIST` 非密 OS 白名单——Win: SYSTEMROOT/TEMP/TMP/PATHEXT/COMSPEC；POSIX: TMPDIR/LANG/LC_*。支撑 gateway 子进程最小隔离且跨平台可启动，Win 缺 SYSTEMROOT 会致 python 子进程启动失败；SECRET_KEY/DB 密码/API key 一律不在列）
- backend/app/modules/git_gateway/service.py（execute 子进程 env 弃 `{**os.environ}`，改用 `ExecEnvBuilder.build_env_vars(lease.path)` + 作者身份 env；删 import os、local import 升顶层）
- backend/app/modules/tool_gateway/service.py（execute 构造 `_build_isolated_env(lease)` 经 `_dispatch` 透传 env 给 `_handle_shell_exec`/`_handle_run_tests` 的 `create_subprocess_exec(env=...)`；http_get 不起子进程不传）
- backend/app/modules/admin/users_service.py（新增 `_roles_carry_platform_admin` + `_assert_actor_may_grant_platform_admin`；create/update_user 授 `is_platform_admin=True` 或绑定含 `platform:admin` 的角色前校验 actor `is_platform_admin`，否则 `PermissionDenied(PLATFORM_ADMIN_GRANT_FORBIDDEN)`）
- backend/app/modules/ppm/project/router.py（项目成员 create/update/delete 复用 `_require_project_manager`：create 用 `body.pm_project_id`；update/delete 先 `ProjectMemberService.get(entity_id)` 取 `existing.pm_project_id`）
- backend/app/modules/worktree/tests/test_exec_env.py（build_env_vars 断言白名单透传 + 宿主主密钥不泄漏 + 任意宿主 env 排除）
- backend/app/modules/git_gateway/tests/test_router.py（新增 test_git_env_excludes_host_os_environ：子进程 env 无 SECRET_KEY/DATABASE_URL）
- backend/app/modules/tool_gateway/tests/test_router.py（新增 shell_exec/run_tests 隔离 env 断言）
- backend/app/modules/tool_gateway/tests/test_policy.py（run_tests 两直调 handler 测试适配新增 env 参数传 `{}`，非弱化断言）
- backend/tests/modules/admin/test_users_dominance.py（新建 8 用例：非平台管理员授 admin/绑 platform:admin 角色被拒、绑普通角色放行、平台管理员放行）
- backend/tests/modules/ppm/test_project_member_manager_guard.py（新建 9 用例：非经理非超管 403 / 经理放行 / 超管放行 × create/update/delete）
- .sillyspec/docs/backend/modules/{admin,git_gateway,tool_gateway,worktree,ppm}.md（正文注意事项 + 变更索引各追加本 ql-ID）
- 来源说明：`.sillyspec/docs/SillyHub/scan/CONCERNS.md`（2026-08-08 多代理安全审计报告）是本次 3 条的**来源**，非本 quick 代码改动，未暂存；--done 用 `--force-baseline --allow-new` 压制其危险路径判定

需求：堵三处安全洞——(1)tool_gateway/git_gateway 子进程继承宿主 os.environ 致主密钥泄漏；(2)admin users 持 USER_WRITE 的非平台管理员可越权授 is_platform_admin 或平台权限角色；(3)PPM 项目成员 create/update/delete 无经理校验可自提权。
根因：git_gateway execute 直接 {**os.environ}、tool_gateway shell_exec/run_tests 不传 env 默认全继承（build_env_vars 已有最小隔离却唯独这两条路径漏接）；users_service create/update 无支配权校验（USER_WRITE≠is_platform_admin）；ppm 成员写端点仅认证不授权未校验项目经理。
方案：worktree/exec_env.py build_env_vars 补非密 OS 白名单（Win SYSTEMROOT 等/POSIX locale）保证子进程跨平台可启动；git_gateway/tool_gateway 子进程改用 build_env_vars(lease.path) 最小隔离（git 叠加作者 env）弃 **os.environ；users_service 新增 _roles_carry_platform_admin+_assert_actor_may_grant_platform_admin，create/update 授 is_platform_admin=True 或绑定 platform:admin 角色前校验 actor is_platform_admin 否则 PermissionDenied；ppm/project/router 成员 create/update/delete 复用 _require_project_manager（create 用 body.pm_project_id，update/delete 先 get 取 pm_project_id）。
结果：worktree+git_gateway+tool_gateway 172 passed；ppm 499 passed（含新守卫 9 用例，test_member_http_crud 不破）；admin 88 passed+支配权 8 用例过；唯一失败 test_update_username_change_success 429 登录限流已在干净 HEAD（git stash）复现=预存缺陷与本改动无关；ruff format/check+mypy 全过；模块文档 admin/git_gateway/tool_gateway/worktree/ppm 已同步并暂存。CONCERNS.md(2026-08-08 多代理审计报告，本 quick 任务的来源)非本 quick 代码改动，未暂存，用 --force-baseline 压制其危险路径判定。
## ql-20260809-001-c283 | 2026-08-09 06:36:18 | 修 complete_stage 的 stages 非深拷贝（last_stage_completion 不落库）
状态：已完成
关联变更：2026-08-09-complete-stage-deepcopy
文件：
- backend/app/modules/change/service.py（complete_stage:1571 `stages = change.stages or {}` → `dict(change.stages or {})` 浅拷贝，加普通 Column(JSON) 非 MutableDict 的 set 事件同对象不标记 dirty 机理注释）
- backend/app/modules/change/tests/test_complete_stage.py（+`test_complete_stage_persists_last_stage_completion_to_db`：complete_stage 后 refresh 真读 DB，断言 last_stage_completion 落库 + team_mode 保留，锁持久化契约）
- .sillyspec/docs/backend/modules/change.md（人工备注 MANUAL_NOTES 追加 ql-20260809-001-c283 变更索引，含 7 处同模式外溢标注）

需求：修 ChangeService.complete_stage（service.py:1571）的 stages 非深拷贝 bug——last_stage_completion 字段不落库（change-center-on-demand task-16 发现的遗留项）。
根因：change.stages 是普通 Column(JSON) 非 MutableDict.as_mutable（model.py:155），complete_stage 用 stages = change.stages or {} 取引用、原地改 stages["last_stage_completion"]、再 change.stages = stages 回赋同对象；SQLAlchemy 标量属性 set 事件见 new is old（同对象）不标记 dirty，flush 的 UPDATE 不带 stages 列 → 该键丢失（current_stage 走独立列故正常）。
方案：改 dict(change.stages or {}) 浅拷贝（与 transition_with_dispatch:763 同源范式），新对象回赋被检测为变更而落库。TDD：先写 test_complete_stage_persists_last_stage_completion_to_db（refresh 真读 DB 锁持久化契约）→ 跑 FAIL 实证 bug → 改 → 跑 PASS。
结果：新测试 PASS + test_complete_stage.py 全 17 passed 无回归；ruff check/format + mypy 全过。3 文件已 git add（service.py / test_complete_stage.py / change.md 模块文档同步 ql 索引）。⚠️ 系统性外溢发现：同文件另有 7 处同模式非 copy 站点（685 transitions / 846 last_feedback / 1327,1386,1457,1621,1718 review_history；934 只读无 bug）潜在同样不落库 bug，本次按 scoped 不扩，建议另开 sweep change。
## ql-20260809-002-4219 | 2026-08-09 06:49:05 | sweep 关闭 ql-001 的 7 处 stages 非深拷贝外溢
状态：已完成
关联变更：2026-08-09-stages-deepcopy-sweep
文件：
- backend/app/modules/change/service.py（8 处 `stages = change.stages or {}` → `dict(change.stages or {})`：transition / submit_feedback / proposal_review / plan_review / human_test / rerun_stage / archive_confirm 7 个 mutating 方法 + `check_archive_gate:934` 只读站点一并标准化消除危险 idiom）
- backend/app/modules/change/tests/test_stages_persistence.py（新建 7 用例；`_seed` 显式置 `{"team_mode": True}` 复现「非空 stages」触发条件，refresh 真读 DB 锁各方法 stages 键 transitions/last_feedback/review_history 持久化契约）
- .sillyspec/docs/backend/modules/change.md（人工备注追加 ql-20260809-002-4219 变更索引，关闭 ql-001 的 7 处外溢标注）
需求：sweep 关闭 ql-20260809-001-c283 标注的 7 处同模式 stages 非深拷贝外溢（transition/submit_feedback/proposal_review/plan_review/human_test/rerun_stage/archive_confirm 的 stages 键不落库）。
根因：同 ql-001——change.stages 普通 Column(JSON) 非 MutableDict.as_mutable，各方法 stages = change.stages or {} 取引用原地改 + 回赋同对象，set 事件见 new is old 不标记 dirty，flush 不带 stages 列。⚠️ 进阶发现：bug 仅在 change.stages 非空时触发（falsy 时 or {} 取新对象被检测→不触发），故 _create_test_change 默认 stages={} 的既有测试全漏网。
方案：新建 test_stages_persistence.py，_seed 显式置 {team_mode: True} 复现，7 用例 refresh 真读 DB 锁各方法 stages 键持久化；replace_all 改 service.py 8 处 stages = change.stages or {} → dict(change.stages or {})（7 mutating + check_archive_gate 只读站点一并标准化）。
结果：7 用例改前全 FAIL → 改后全 PASS；change 全模块 206 passed/2 skip 无回归；ruff check/format + mypy 全过。3 文件已 git add（service.py / test_stages_persistence.py / change.md 模块文档同步 ql 索引）。

## ql-20260809-003-56db | 2026-08-09 06:56:24 | 多代理审计 8 个低风险单点修复（release 死路由 / incident 漏校验 / request_id / OOM / 时区 / SSE 日志 / 升级按钮 / 调试 log）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/release/router.py（promote 路由 require_permission→require_permission_any；路径无 workspace_id 占位符，原装饰器恒 422，改后 200 draft→staging）
- backend/app/modules/incident/service.py（update 补 VALID_SEVERITIES 校验，与 create 对称，堵住 update 直接入库非法 severity）
- backend/app/core/errors.py（_request_id 优先读 request.state.request_id，再回退 header、最后生成 uuid；与中间件 main.py:183 写 state 及 x-request-id 响应头/慢请求日志对齐）
- backend/app/modules/knowledge/parser.py（_read_file_safe 超大文件改限量读前 MAX_CONTENT_BYTES//4 字节，不再整文件读入内存后切片，OOM 防护）
- backend/app/modules/ppm/kanban/service.py（_parse_date_range 的 datetime.combine 补 tzinfo=UTC；PlanTask.end_time 是 timestamptz，生产 PG 对 naive datetime 会报错/时区错移）
- frontend/src/lib/daemon.ts（删生产 SSE onmessage 的 console.log("[SSE-raw]", ...)，泄漏前 150 字 + 性能噪声）
- frontend/src/components/daemon/machine-card.tsx（升级按钮 disabled 加 || upgrading + title 提示「升级中…」，防双击双发自更新）
- sillyhub-daemon/src/interactive/session-manager.ts（删 3 处 [reload-diag] 调试 console.log 及配套 eslint-disable 注释）
- backend/app/core/tests/test_errors.py（新建：_request_id 三分支——优先 state / 回退 header / 兜底 uuid）
- backend/app/modules/incident/tests/test_service.py（+2：update 非法 severity 抛 IncidentError / 合法 severity 落库）
- backend/app/modules/knowledge/tests/test_parser.py（+2：小文件不截断 / 超大文件限量读不整读）
- backend/app/modules/ppm/kanban/tests/test_kanban.py（+2：_parse_date_range 返回 UTC-aware / 空输入返回 None）
- backend/app/modules/release/tests/test_router.py（+1：promote 端点 200 draft→staging，回归死路由修复）
需求：修复 CONCERNS.md「2026-08-08 多代理审计」中 8 个低风险单点问题（release promote 死路由 / incident update 漏校验 severity / errors request_id 不一致 / knowledge parser 大文件 OOM / kanban 日期缺时区 / 前端 SSE 日志泄漏 / 升级按钮可双击 / daemon 调试日志残留）。
根因：均为审计发现的既有缺陷——鉴权装饰器误用 require_permission vs require_permission_any、update 路径与 create 校验不对称、中间件已写 state 但错误处理器只读 header、大文件整读再切片、datetime.combine 缺 tzinfo、生产代码残留 console.log、按钮缺 upgrading 守卫。
方案：后端 5 处（release router 改 require_permission_any；incident update 补 VALID_SEVERITIES 校验；errors _request_id 优先读 request.state；knowledge parser 改限量读前 MAX_CONTENT_BYTES//4 字节；kanban _parse_date_range 加 tzinfo=UTC）+ 前端 2 处（daemon.ts 删 SSE console.log；machine-card 升级按钮加 upgrading 守卫）+ daemon 1 处（session-manager 删 3 处 reload-diag 调试 log），每条配针对性测试。
结果：后端 pytest 110 passed、前端 machine-card vitest 9 passed、daemon reload-provider vitest 11 passed；后端 ruff check+format 全过、daemon tsc 无错、前端 eslint 0 error（16 预存 warning 与本次无关）。

## ql-20260809-004-298c | 2026-08-09 14:14:22 | 修复 backend 登录测试 redis 跨测试污染 flaky（全量 HTTP_423 captcha 误触发）
状态：已完成
关联变更：（无）
文件：
- backend/conftest.py（+autouse async fixture `_reset_redis_state`，function scope：每测试 setup 重置 `redis._client=None` 强制当前 loop 重建 + `flushdb()` 清 db15 残留；teardown `aclose`+置 None 防连接池跨 loop 泄漏；redis 不可用 best-effort 跳过）
需求：修复 backend 登录测试 order-dependent flaky（全量 HTTP_423 LOGIN_CAPTCHA_REQUIRED 误触发，单跑全过），让全量 pytest 稳定全绿。
根因：captcha_service 把登录失败计数 INCR login:fail:{ip} 写共享 redis db15（conftest REDIS_URL），测试客户端同 IP 127.0.0.1 跨测试累计过 auth_login_fail_threshold 触发 captcha(423)；叠加 get_redis() 进程级单例连接池绑首个 loop，pytest-asyncio 每测试新 loop 致 INCR 报 Event loop is closed；conftest 完全无 redis reset。
方案：backend/conftest.py 加 autouse async fixture _reset_redis_state（function scope），每测试 setup 重置 _client=None 强制 get_redis() 在当前 loop 重建（解跨 loop）+ flushdb() 清 db15 残留计数；teardown aclose+置 None 防连接池泄漏；redis 不可用 try/except 降级跳过。纯测试侧，零生产代码改动。
结果：复现范围 auth+admin/users_router 修复前 7 failed→修复后 177 passed/0 failed；全量 backend 修复前 3651 passed/5 failed→修复后 3656 passed/0 failed（exit 0，1772s）。flaky 彻底消除。已暂存 backend/conftest.py。
