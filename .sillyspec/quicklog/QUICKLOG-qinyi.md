
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