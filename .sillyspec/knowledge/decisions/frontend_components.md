# 决策知识 — frontend_components

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 会话轮次导航 = 桌面常驻左栏 + 移动端收 ⋯ 菜单抽屉
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
文件：frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx, frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts, frontend/src/components/daemon/session-panel/preview-merge.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：fd96ae48
理由：ZCode 式导航用户定案；桌面常驻（刻度轨仅 ~30px 不占聊天宽度），mobile 触屏无 hover 走 ⋯ 菜单抽屉行式列表（点击即跳），dialog 宿主不挂载。

## D-002@v1 : 目录覆盖全部历史轮次（runs 补全 + 点击循环加载定位）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：高轮次回顾是核心痛点，仅已加载轮次不解决；未加载轮次由 runsMeta 补全为空心刻度，点击时复用触顶翻页链循环加载（≤8 页、suppress 触顶自动加载）到命中再 scrollIntoView。

## D-004@v1 : 目录数据 = 前端拼装（displayTurns + runsMeta），零后端改动
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：runsMeta（attach/每轮完成已全量拉刷）+ displayTurns 信息足够拼目录；方案 C（后端摘要端点）引新契约 YAGNI 拒绝、方案 B（仅已加载）违 D-002 排除；runs 接口无 prompt 字段，未加载条目 v1 元数据+点击回填（D-005）。

## D-006@v1 : 悬浮窗归 desktop variant 分支（Grill 修正，D-007 后零改动复用刻度轨）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/index.tsx`
文件：backend/app/modules/daemon/lease/service.py
最近确认：fd96ae48
理由：floating-session-host 不传 variant → index.tsx 默认 desktop，mobile ⋯ 菜单守卫在其不渲染；修正后的刻度轨仅 ~30px 宽，悬浮窗直接复用 desktop 形态无需折叠或特殊处理。

## D-001@v1 conventions.md 仅作原型演示样本，不沉淀新约定
状态：implemented
变更：2026-09-23-md-card-render
锚点：未记录
最近确认：322c55edd
理由：用户确认「只做演示样本」——原型 HTML 用 `.sillyspec/knowledge/conventions.md` 真实内容（含表格/标题/加粗/代码块）演示卡片渲染效果；不往 conventions.md 新增「卡片格式规范」条目。

## D-002@v1 卡片正文渲染全文，不折叠、不卡片内滚动
状态：implemented
变更：2026-09-23-md-card-render
锚点：未记录
最近确认：322c55edd
理由：用户确认渲染全文即可——卡片本就按 md H2 小节拆分（一个小节一张卡，entry-card-list.tsx detectEntryCardForm manual 形态），单卡内容天然可控；外层卡片列表容器已有滚动（page.tsx max-h + overflow-y-auto），无需折叠或卡片内二级滚动。

## D-003@v1 实现方案选 C——CardMarkdown 薄壳渲染 + 卡片视觉重构
状态：implemented
变更：2026-09-23-md-card-render
锚点：未记录
最近确认：322c55edd
理由：用户看完三方案原型（prototype-card-render.html 三 tab 对比，演示数据为 conventions.md 真实内容）后选定方案 C——含 B 的全部渲染能力（CardMarkdown 薄壳：MarkdownText compact + 表格横向滚动 + 字号对齐）+ 卡片视觉重构（卡片头品牌色条与 brand-50 底、小节标题 brand-700、锚点复制图标、frontmatter 元信息条、表头品牌色卡片化）。
故障面：①视觉重构触及卡片 DOM 结构，现有锚点定位（data-entry-anchor + scrollIntoView）与条目级 🔥 徽标渲染需回归验证；②frontmatter 元信息条新增解析依赖——无 frontmatter 的文件须优雅降级（不显示元信息条，不炸卡片）；③双主题（blue/ai-native）下品牌色条与表头色需经 brand-* 语义阶取值，禁硬编码 hex（FRONTEND_PAGE_STYLE §0.5 铁律）。
退役判据：若后续知识库/扫描文档页整体改版（如换卡片布局系统），本视觉规范随页面基线一并重估。

## D-001@v1 : 会话面板基元统一方向 = antd
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户拍板 antd（AskUserQuestion 2026-08-22）。

## D-002@v1 : 实施方式 = 一次性原子改造
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户选方案 A：同一变更内一次做完，单轮验收。

## D-003@v1 : TurnStatusBadge 纳入 antd 化（Grill U-01）
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户拍板一并换 antd（贯彻「整个会话 UI 家族统一」）。

## D-004@v1 : 按钮尺寸 = 主操作 32px / 打断 small 24px（Grill U-02）
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：用户拍板：主操作 antd 默认 32px，打断对齐 page 惯例 small 24px。

## D-005@v1 : 📎 附件按钮 antd 映射 = type="text"（Grill U-03）
状态：implemented
变更：2026-08-22-session-panel-unify
锚点：未记录
最近确认：6fdabce0
理由：设计内定 type="text"（对应 ghost 无边框语义）。

## D-001@v1 : 三入口统一为一个门户组件（以 /sessions 为准）
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：以 /sessions 为准抽共享 SessionsPortal（scope 判别联合），三入口渲染同一组件（用户三轮 AskUserQuestion 拍板：范围两处一起/方案A/设计确认）。

## D-002@v1 : 变更详情承载=专属路由门户
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：方案A：卡片变入口（前 3 条预览+打开按钮）跳专属路由（用户选，对比页内展开/全屏弹窗两案）。

## D-003@v2 : scope 列表数据源=全局端点+服务端过滤（取代 D-003@v1 客户端过滤）
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：后端 GET /sessions 增 workspace_id/change_id 可选过滤参；前端 scope 复用全局端点（owner-scoped+全字段+筛选+分页），v2 的降级矩阵/客户端过滤/筛选隐藏全部退场。
supersedes：D-003@v1

## D-004@v1 : ?session= 升级为门户统一能力
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：SessionsPortal 统一支持 ?session=<id> 初始选中（迁移旧 :95-113 能力，无效 id 静默忽略），三入口通用。

## D-005@v1 : ended 会话恢复自动→手动（以 /sessions 行为为准）
状态：implemented
变更：2026-08-22-workspace-sessions-portal
锚点：未记录
最近确认：c06c7934
理由：统一为 page 模式手动重开——用户「以 /sessions 为准」原则的直接推论；design §4.E 明示为有意交互变更。

## D-001@v1 : 方案 A——daemon 消费 SDK task_* + agent_task_status SSE 通道扩展
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：daemon session-manager 拦截 SDK `task_started/task_progress/task_notification` system 消息，映射为扩展的 `agent_task_status` SSE 事件（复用 Redis `agent_session:{id}` 频道模式），异步启动回执解析做兜底。否决方案 B（daemon 透传 system 落库、backend 解析派生：事件与日志两套真相源，历史回看重放解析脆弱）；否决方案 C（前端纯展示层聚合：永远缺终态信号，卡片转圈到会话结束）。

## D-002@v1 : 生命周期双写——SSE 事件 + [TASK_*] 持久日志行
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：生命周期节点除发 SSE 外，同步落 `[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION]` 前缀的 stdout 日志行（单行 JSON，行级带 parent_tool_use_id）。前端 assembler 识别前缀解析为段元数据，回放与实时同源；行带 parent 自动享受跨轮归位。

## D-003@v1 : 跨轮归位在 backend 落库时做（submit_messages 重映射 run_id）
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：backend `submit_messages` 落库时，带 parent_tool_use_id 的行查 tool_use_id→run_id 映射（进程内 LRU + agent_run_logs tool_call 行冷启动反查）改写为派发 run。否决前端会话级链接（每个消费日志的页面都要适配，容易漏）。历史数据不迁移（项目未上线）。

## D-004@v1 : 空 prompt 防御——后端 422 为主，前端禁点为辅
状态：implemented
变更：2026-08-27-background-subagent-progress
锚点：未记录
最近确认：debd368d
理由：backend `inject_session` 对 strip 后为空的 prompt 抛 422（中文文案，领域类 SessionEmptyPrompt，过 l10n 守护）；前端发送按钮空内容 disabled 为辅助。服务端拒绝是权威（防任何调用方）。

## D-002@v1 : ctx 指标落库（AgentRun 加列）
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：落库。不落库则刷新页面/重进会话后上下文环拿不到数值。项目未上线（CLAUDE.md 规则 11），允许直接加列迁移。

## D-003@v1 : 历史会话（无 ctx 数据）环显示未知
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：如实显示"未知/—"（不算百分比），不用旧口径估算（旧口径 input 是该轮所有调用求和，数字本身失真）。

## D-005@v1 : 实现方案选 A（复用 usage 附带管线 + daemon 按轮重置）
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：方案 A。daemon 在现有 usage 字典加 ctx_tokens（message_start 算本次调用 input+cache_read+cache_creation）；轮边界重置累积器使实时值=本轮至今量（与终态口径一致）；backend/frontend 全链路加字段透传（AgentRun.ctx_tokens 列 + SSE + SessionRunRead）。完全符合 D-001~D-004。否决 B（改动面翻倍且旧通道无法删除，两套并存反而更乱）；否决 C（环仍爆表、跳变仅被隐藏）。

## D-001@v2 : 统一=本轮增量；终态 SDK result 权威校准
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：统一仍为本轮增量；终态以 SDK result 值为权威覆盖（校准语义）。消除的是"语义级"跳变（会话累计暴涨→本轮骤降）；若两路数值有小出入，表现为终态定格时小幅校正。execute 首任务跑真实会话 spike 验证，偏差 >5% 启用 fallback（close 仅当 result > 实时值才覆盖 input/output）。
supersedes：D-001@v1

## D-006@v1 : ctx_tokens 仅 main 桶计算与注入
状态：implemented
变更：2026-08-27-session-token-usage-fix
锚点：未记录
最近确认：c7f48562
理由：lastCallCtxTokens 仅 'main' 桶计算与注入 pendingUsage；子桶 pendingUsage 不含 ctx_tokens（backend usage.get 缺失即跳过，天然兼容）。turnInput/turnOutput 所有桶照常（子代理计费量并入本轮）。

## D-001@v1 : 关联入口双向都要
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：双向都要——任务/问题侧提供"发起会话"入口（详情/列表处），会话输入框 @联想扩展支持选择 PPM 任务/问题，与现有变更/快速修复绑定体验一致。

## D-002@v1 : 全状态可关联
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：全状态可关联。列表/联想默认展示"进行中"，但已完成/未开始的任务也能手动关联（如复盘场景）。

## D-003@v1 : 附件真注入 + 降级文字清单
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：真附件注入——后端尝试读取附件内容作为真附件传给 agent（能看图/读文件）；读取失败的降级为文字清单（附件名+链接）。

## D-007@v1 : PPM 附件访问控制复用 _can_access
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：复用 FileService._can_access 同口径校验：有权条目物化注入；无权条目降级文字清单仅列文件名并注明「无权访问」（不带链接）。行为对齐 PPM UI 现状（batch_meta 同样静默剔除无权行），不引入跨用户文件读取。

## D-006@v1 : PPM 附件物化为 SessionAttachment
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：创建会话携带 ppm item 时，后端把任务 file_urls 对应 File 读取 bytes → 写入 session attachment storage → 物化 SessionAttachment 行（session_id 直接回填、user_id=创建者），并入现有 attachment_ids 组装链路（assemble_inject_attachments/download 回调/标记行/前端展示全复用，daemon 零改动）。

## D-005@v1 : 统一 PPM 绑定表（方案 B）
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：方案 B——一张 `ppm_item_session_links` 表（kind 字段区分 plan_task/problem），一套绑定 helper + 一个统一前导构建器；@联想/会话筛选/任务侧卡片前端逻辑复用一套。

## D-004@v2 : 工作区排序键定死 workspace_id 升序
状态：implemented
变更：2026-08-28-session-ppm-task-binding
锚点：未记录
最近确认：73a4eda3
理由：workspace_id 升序（UUID 字典序）为唯一排序键，后端 link.workspace_id 写入与前端预选同键，消除分叉。
supersedes：D-004@v1

## D-002@v1 : 服务器重新部署范围
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：仅后端进程重启（docker 容器重启/发新版镜像），数据库保留，daemon 的 api_key 与注册信息仍有效

## D-003@v1 : 前端回显纳入范围
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：包含关键前端修复——断线状态提示、卡住的「运行中」轮次兜底、审批面板断线重连

## D-004@v1 : 改造深度
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：允许结构改造——可新增接口/协议（控制消息补拉接口、lease 过期回收后台任务、SSE 游标增强等），彻底解决断线窗口丢消息

## D-005@v1 : 实现方案选型
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：方案 A——控制指令落库待发（参考 DaemonChangeWrite 占坑-轮询-GC 先例）+ WS 推送保即时性 + daemon 重连后 HTTP 补拉幂等消费；分层加固：daemon 退避重连+register 重试、终态上报入 outbox、backend lease GC 接线与 WS 断开即时降级、会话 suspended 挂起语义、前端连接状态与看门狗兜底

## D-006@v1 : 六段设计整体确认
状态：implemented
变更：2026-08-29-daemon-platform-resilience
锚点：未记录
最近确认：bdef3a21
理由：确认。变更名 2026-08-29-daemon-platform-resilience，原型 prototype-session-connection-states.html 六状态快照

## D-003@v2 : 磁盘旁路探测方式与 disk_change 直启路径（Grill B1/B2 修正）
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：探测=读 bundle 文件正则提取 BUILD_ID（gen-build-id.mjs 格式 regex 兼容，无 spawn）；disk_change 触发后走独立直启路径——不下载不查 manifest，空闲即 stop+respawn 到盘上版本（操作者换文件即意图，multica trySelfReload 同款）；server_command 仍走现有下载链
supersedes：D-003@v1

## D-004@v1 : 方案选型 A3 完整形态
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：A3——A1 全部（空闲屏障/所有权 CAS+失败释放/磁盘探测/pending 本地 status 可见）+ 心跳上报 pending_update 字段 + backend 机器视图透出 + 前端机器卡展示「等待空闲升级」原因

## D-005@v1 : 保留既有优势语义
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：保留「拉起失败旧进程保活」（multica 没有的优点）并补全其半边语义——交接失败必须释放更新所有权与屏障，让下一条 SELF_UPDATE 指令可再触发；下载原子替换/防降级/noop 保活等既有行为不变

## D-006@v1 : 设计整体确认
状态：implemented
变更：2026-08-29-daemon-selfupdate-safety
锚点：未记录
最近确认：HEAD
理由：确认。变更名 2026-08-29-daemon-selfupdate-safety，原型 prototype-machine-update-status.html

## D-004@v1 : 数据链路实现方案
状态：implemented
变更：2026-08-29-session-usage-stats
锚点：未记录
最近确认：0ea25728
理由：方案 A——新增 GET /api/daemon/sessions/{id}/usage 聚合端点：agent_run_model_usage 按 session 的 runs 聚合为主、AgentRun 六 token 列兜底无明细行的老 run，返回会话汇总+按模型分组；与 /runtimes/usage 先例同模式

## D-002@v1 : token 统计范围 = 派发执行 ∪ 关联会话执行（按 run 去重）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：并集去重（用户 AskUserQuestion 确认）。变更侧 = 直接挂 change_id 的 run ∪ 关联会话（change_session_links）内全部 run，按 run id 去重合并。跨变更共享会话时同一份消耗会在多个变更各显示一次——口径特性非 bug，详情页注明。快速修复无派发链路，恒走 quicklog_session_links→agent_sessions→agent_runs 会话链路（代码事实，非选项）。

## D-003@v1 : 落地方式 = 实时聚合计算字段（零迁移）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：实时聚合（用户 AskUserQuestion 确认）。查询时从 agent_runs / agent_run_model_usage 现算，DTO 计算字段，不新建表列、零 migration；数字与最新执行终态一致。列表用批量聚合（一条 SQL 按变更分组）。否决「冗余入表」。

## D-004@v1 : 展示位置 = 列表 + 详情都要
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：列表 + 详情都要（用户 AskUserQuestion 确认）。变更中心「变更」tab 与「快速修复」tab 列表各加摘要列（耗时 + token 总量档）；变更详情页与快速修复抽屉展示完整五指标（输入/输出/缓存读/缓存写/调用次数 + 轮次）+ 分模型明细。对齐运行时页/会话页用量卡先例。

## D-005@v1 : API 形态 = 方案 A（独立用量端点 + 列表内嵌摘要）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：方案 A（用户 AskUserQuestion 确认）。列表 DTO（ChangeSummary / QuicklogEntryListItem）内嵌摘要字段，批量聚合一条 SQL 挂既有富化管道（零 N+1）；完整五指标+分模型明细走两个新独立端点；前端一个可复用用量组件覆盖变更详情页与快速修复抽屉。否决 B（详情响应膨胀、分模型明细无处安放、与先例不一致）与 C（run DTO 仅输入/输出两维，数据面不成立——session-usage-stats 先例已核实）。

## D-006@v1 : 软删会话的执行计入统计
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：计入。消耗真实发生，用量口径=真实成本；UI 隐藏是展示层整洁考虑，两者不矛盾——详情卡注脚声明（R-07）。孤儿 run（agent_session_id 已置空）经派发锚点 change_id 仍可命中，不丢数。

## D-007@v1 : 用量卡取数用 react-query useQuery（非 useEffect）
状态：implemented
变更：2026-08-30-change-center-usage-stats
锚点：未记录
最近确认：84a5b960
理由：useQuery。两个目标渲染点的既有卡片（change-sessions-card.tsx:60 / quicklog-sessions-card.tsx:60）均用 useQuery 且都在 QueryClientProvider 内；session-usage-bar 规避的是会话浮窗零 react-query 约束，本变更两渲染点无此约束。变更详情页「本页禁新增网络请求」注释（[cid]/page.tsx:339）经核实为 last-signal 功能局部语境（禁的是为派生小字段加轮询，同页 sessions 卡已自取数）。

## D-001@v1 命令下发通道——机器级即时 WS 指令（方案 A）
状态：implemented
变更：2026-09-04-conflict-resolve-entry
锚点：未记录
最近确认：0d7e66502
理由：方案 A。复用机器级 fire-and-forget WS 指令先例（self_update/cleanup/sillyspec_update 同款，`POST /machines/{id}/sillyspec-update` router.py:1269）：backend 校验权限后经 DaemonWsHub 即时下发，daemon 侧 handler 本地 execFile 执行 sillyspec CLI（sillyspec-manager 30s 超时模式），执行结果缓存于 daemon 内存并随下次心跳 sillyspec_status 通道上报（≤60s 页面自动回绿）。B 的离线补拉增益对本场景为负（sillyspec 操作必须机器在线，离线排队上线时现场可能已变）且六处协议扩展过重；C 的 host_fs RPC 挂会话上下文无页面载体、字符级白名单对变长 change 名脆弱，不适配

## D-003@v1 操作权限——机器所有者 + 平台管理员
状态：implemented
变更：2026-09-04-conflict-resolve-entry
锚点：未记录
最近确认：0d7e66502
理由：机器所有者 + 平台管理员。冲突数据挂机器维度，机器主人最清楚现场，管理员兜底无主机器；其他成员只读红灯不可操作。活跃阶段变更（非 archived）的冲突行加警示标注 + 确认弹窗加重文案，不硬禁（机器主人有最终裁量）

## D-004@v1 心跳 sillyspec_command_result 落库语义——两态清除 + register 恒清（Grill X-04 修订）
状态：implemented
变更：2026-09-04-conflict-resolve-entry
锚点：未记录
最近确认：0d7e66502
理由：两态。对象=整包直写、键不出现=置 NULL 清除，与 sillyspec_status 现状（model.py:108-109、runtime/service.py:525-529）语义一致；daemon 终态窗过期后直接停发该键，不发送显式 null；register 恒清（service.py:232-235 先例）堵 daemon 重启后 DB 残留。三态需在心跳面新增 absent/null 判别，唯一先例 router.py:988 display_alias PUT 属 PUT 端点非心跳，无谓引入新机制

## D-002@v2 品牌色派生 token 三主题分值（blue 不继承紫）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：品牌色派生 token（--aurora-*/--row-active(-ring)/--shadow-glow/--shadow-primary）按既有 --shadow-primary 三主题分值惯例写满 :root/[data-theme="blue"]/[data-theme="dark"] 三块，blue 给蓝系取值
supersedes：D-002@v1

## D-003@v1 消息形态 = 气泡 + 头像
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：用户选定「气泡 + 头像」——现有气泡骨架保留，agent 消息加品牌渐变头像（Bot/引擎图标），用户消息维持右对齐品牌色气泡

## D-004@v1 范围含群聊面板
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：会话页 + 群聊一起改——group-chat-panel 的消息行同步焕新（头像/气泡层级/代码块已由 MarkdownText 共享自动获益）

## D-005@v1 dark 主题底色一起调
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：连主题底色一起调——dark 主题 card/border 取值微调拉大页面底与卡片反差（themes.ts darkTheme + globals.css dark 变量块同步，取值仍限 Tailwind v3 zinc 阶默认值）；全站受益，回归面经 build+主页面实拍控制

## D-006@v3 群聊 agent 成员无自定义头像时统一 Bot 渐变光环（取舍记录）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：取舍为维持统一光环——发送者区分由消息行成员名行承担且群聊本就渲染成员名；统一 agent 视觉锚点（与单聊一致）价值大于分色辨识（分色仍保留在成员面板/facepile 等非消息行场景）；自定义头像（avatar 入参）优先级不变
supersedes：D-006@v2

## D-007@v1 高级感设计语言（v2 原型定调）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：v2 原型定调六根杠杆——①环境极光背景（品牌色径向渐变光晕，浅/dark 双套取值）；②多层弥散阴影替代硬边框（边框统一降透明 --border-soft）；③玻璃拟态（顶栏/面板头/列表列 backdrop-blur + saturate）；④渐变点睛收敛到三处：标题「智能体」渐变字、agent 光环头像、发送按钮；⑤macOS 风深空代码块（三色窗点+语言标签+复制钮）；⑥微交互（发送钮 hover 浮起/点击回弹、plus 钮 hover 渐变填充、composer 聚焦光环+弥散阴影）

## D-008@v1 v3 修正——玻璃可读性 + 删流光顶条
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：①玻璃拟态不可读的根因是极光只铺内容区、玻璃面板底下是纯色底没有东西可透——v3 把极光铺满整个应用底（body background-attachment: fixed），侧栏/列表列/面板整体降透明 + backdrop-blur，玻璃下有色彩可透才读得出玻璃感；②panel-accent 渐变流光顶条整体删除——运行态氛围收敛为脉冲状态点 + 任务条 spinner 两个既有元素，克制优先，不再加新动效载体

## D-009@v1 v4 自查修正（用户要求"你自己看看效果图"后的逐项自审）
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：自审五条——①浅色下用户气泡紫色面积太大太吵（max-width 76%→72% + shadow-primary 降重：阴影 alpha 减半）；②composer 聚焦光环 v3 过浓且原型硬编码常驻焦点态（dark 下呈 RGB 霓虹圈游戏感）——改 3px/10% 透明度柔环、阴影不再跳档、原型展示常态；③列表/导航选中态两主题都太弱——inset 描边从 border-soft 换品牌色 22%/30% 透明度（--row-active-ring 新 token）；④浅色右上极光泛紫过浓（13%→9%）；⑤dark 极光太弱整体死黑（四团光晕各加 3-4 个百分点）

## D-010@v1 RoundDivider 状态六态映射
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：status 改六态判别联合，着色映射：completed=success / failed+killed=error / running=info / pending+interrupting=neutral

## D-011@v1 死 token 删除 + G-02 43px 悬空口径修正
状态：implemented
变更：2026-09-09-sessions-visual-refresh
锚点：未记录
最近确认：1f515ddce
理由：①四 token 全删（消费面 Tailwind 阶已达成同观感，留死定义徒增维护面）；②G-02 作废——task-05 的 43px 对齐要求删除（对话视图无过程行，全部视图按 G-03 不动，turn-segment-views 零改动是正确实现）；③design 文件清单 layout.tsx 行改指 app-shell.tsx（极光实际落点）

## D-001@v1 预会话草稿键细分，消除跨入口串台
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：frontend/src/components/daemon/session-panel/turn-state.ts:304
最近确认：39d3d8c5c
理由：代码查证：真会话草稿按 sessionId 隔离（sillyhub.sessions.draft.<sid>）且所有 7 个 SessionPanel 宿主均有 key={sessionId} 强制重挂载，rAF 门闩（draftHydratedRef）时序推演在重挂载/非重挂载两路径均正确；唯预会话（sessionId=null）草稿用固定键 __pre__（frontend/src/components/daemon/session-panel/turn-state.ts:304），跨工作区/跨机器入口共享——用户在不同入口开新会话时上一入口未发送内容必然带入，与用户「a 会话内容带到 b 会话」实测吻合。修复：预会话草稿键按 workspaceId+runtimeId 细分（__pre__:<ws>:<runtime>），真会话逻辑不动仅补测试覆盖。

## D-002@v2 拖拽不使用 setPointerCapture（Grill 修正）
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：未记录
最近确认：39d3d8c5c
理由：不用。frontend/src/components/ui/panel-resizer.tsx:11-13 真实先例明文因 jsdom 无实现而不用 setPointerCapture，window 级 pointermove/pointerup 监听已保证拖出元素收事件；测试走 fireEvent(window) 同路径（explorer-page.test.tsx 补坐标方案）。@v1 表述中「+ setPointerCapture」为 brainstorm 期误引，以本版为准。
supersedes：D-002@v1

## D-003@v1 群聊跨工作区可见性——后端返回可见工作区集合
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：未记录
最近确认：39d3d8c5c
理由：选后端方案：list_groups 响应组装时为每个群计算 visible_workspace_ids（直接 workspace_id + project 经 PpmProjectWorkspace 关联的全部 workspace_id，批量查询无 N+1），GroupChatListItemRead 加字段；前端各消费点（桌面 session-list-panel / 移动 mobile-session-list / 悬浮宿主如有群分区）过滤改为 includes 判定。理由：单一数据源、全部消费点免费获益、避免每个消费点各自拉项目-工作区映射造成数据不一致与重复查询。可见性口径：仅放宽列表展示（用户须是群成员才看得到，现有 member 过滤不动），打开群后的访问控制仍走群成员校验，权限语义零变化。

## D-004@v1 整体方案选 A——后端可见集合 + 预会话键细分 + Pointer Events
状态：implemented
变更：2026-09-13-session-group-ux-fixes
锚点：未记录
最近确认：39d3d8c5c
理由：用户选定方案 A。理由要点：单一数据源、全部消费点免费获益、改动聚焦（backend 2 + frontend 5 文件）；否决 B（逻辑复制 3 处、映射独立加载有时序窗口）；否决 C（真会话串台未证实，为未证实问题重构违反 YAGNI）。

## D-001@v1 repoPath 不出 daemon（本地路径隐私）
状态：implemented
变更：2026-09-20-scope-audit-cross-repo-platform
锚点：未记录
最近确认：42c464536
理由：不透传。daemon 投影白名单不含 repoPath——先例 ql-20260911-003-355a P2：daemon 原始消息含本机路径只进服务端结构化日志、不随 details 下发客户端。前端分组与展示用 repo key（sub-grid-security 等）足够；排查需要真实路径时看服务端日志或本机 CLI。

## D-002@v1 全链 additive 兼容，不加版本门禁
状态：implemented
变更：2026-09-20-scope-audit-cross-repo-platform
锚点：未记录
最近确认：42c464536
理由：三层各自缺省回退：daemon 侧 parsed.repos 非数组 → 投影 repos=null；backend 侧 result.repos 非法形态 → repos=[]；前端 repos 空/缺 → 走现状单段渲染（三态 chips 从 rows 统计）。不新增 sillyspec_capability_missing 类版本门禁错误——契约 v2 是 additive，旧 CLI 输出仍合法 v1。

## D-005@v1 实现方案选 A——全链投影 + 按仓分段
状态：implemented
变更：2026-09-20-scope-audit-cross-repo-platform
锚点：未记录
最近确认：42c464536
理由：方案A。daemon 投影行级 cross_repo + 信封 repos[]（每仓锚点/三态计数/降级），backend schema 全量透传 + gen:types，前端卡面按仓分段 + 明细按仓分节 + note 顶摘要层。理由：任务书验收「主仓段+各跨仓段真实三态与锚点档」只有 A 同时具备行级仓归属（明细分组/单文件 diff 联动判仓）与信封级汇总（卡面分段计数单一源）；B 缺行级仓归属致明细层不可按仓分组；C 不满足已确认的按仓分类展示诉求。

## D-002@v1 分叉溯源 UX = 子代理式「块 + 点击浮层看原会话」
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户要「类似子代理这样，点击可以看原会话信息」——复用分身浮层形态（WorkerSessionOverlay 内嵌完整 SessionPanel），方向反过来指向父会话；多跳分叉呈链式可逐级回看。

## D-004@v1 引擎两档——claude 原生真分叉 + codex/pi 种子式降级
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户拍板「claude 真分叉 + 其余种子式」——claude 走 SDK resumeSessionAt+forkSession 真截断；codex/pi 用「截至分叉点的前情转述作首条消息」降级（新会话读到的是转述而非原生历史）。能力位按引擎分档，UI 明确标注两档语义差异。
故障面：种子档被误当真分叉——前情细节有损（转述≠原文），UI 不标注会引发「模型忘了」误报；能力位取值错误会让 codex/pi 走到原生参数路径直接失败
退役判据：codex/pi 引擎出现原生任意点恢复能力时，该档能力位置 true 并退役种子链路

## D-005@v1 原会话分叉后保留可继续（git 语义）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户选「保留可继续」——分叉对原会话零状态影响，两边并行各聊各的；防双活约束不适用于通用分叉场景，handoff 特例的「交接后冻结」语义由后置变更另行定义。

## D-006@v1 handoff 自动续接不并入本变更
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户选「不并入，后置独立变更」——本变更只交付通用手动分叉闭环（选点→分叉→谱系展示→溯源回看）；handoff 触发器、种子链、sillyspec CLI --json 补种子字段全部后置。

## D-007@v1 分叉执行链路 = 方案C（backend 主导管道扩展 + pi 原生 fork 接线）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：用户选方案C——以方案A为基座（backend 主导：claude 走既有 create-with-resume 管道加 fork 参数透传 resumeSessionAt+forkSession，daemon 不新增协议消息；种子组装在 backend 读库），追加 pi 原生 fork 接线：pi RPC 的 fork/switch_session 截断语义先 spike 实测，能截断则 pi 原生档、不能则退种子档；codex v1 种子档。
故障面：pi spike 失败退种子档（预期内降级）；pi fork 若实为「整文件分叉无截断」而误标原生档 → 分叉点语义错误，必须以 spike 断言截断行为定档
退役判据：codex 后续版本提供任意点恢复 API 时升原生档，退役种子链路

## D-008@v1 双 spike 定档——pi 档位与 claude 锚点结论
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：实测 pi=native（判据：RPC fork 命令以用户消息 entryId 为锚实测截断成立——fork 后 get_messages 6→2、新会话探针「name=Alice; code=none; color=none」不知截去轮、原会话文件零改动；截断唯一入口是 RPC fork 命令，CLI --fork 旗标为全量复制）；claude 锚点=轮末最后一个 chain-entry 消息 UUID（普通轮=轮末 SDKAssistantMessage.uuid，resume+resumeSessionAt+forkSession 实机断言知前2轮不知第3轮、transcript 物理截断；end-turn tool 轮/中断轮细则按 sdk.d.ts 归纳标待实机确认）；resumeDropsTurn 守卫=CLI 2.1.216 不支持 --resume-drops-turn（真 UUID 亦 unknown option 硬崩 exit 1、query() reject），SDK 0.3.247 类型已声明——守卫不可启用，省略即官方明示的未校验截断（截断语义不受影响），v1 driver 禁传该参数
故障面：pi 会话上游 API 错误被静默吞成空 assistant 轮（无错误事件，daemon 侧不浮出）；锚点取「末 assistant uuid」遇 end-turn tool 轮/中断轮时按细则应取轮末最后条目，取错会触发守卫拒绝或截断错位（守卫当前不可用则静默错位）；claude CLI 后续升级支持 --resume-drops-turn 前，任何传参尝试都是进程级硬崩
退役判据：claude CLI 升级支持 --resume-drops-turn 后启用守卫并补校验拒绝路径实测；pi 若大版本改 fork 锚语义须重跑本 spike

## D-010@v1 执行期裁决——D-008 pi=native 的规格落实（FR-07 修订+卡片定值）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：①caps 定值：pi sessionFork=native（task-03 直接落值，不再待定）；②engine_anchor 语义分档——claude=该轮末 chain-entry UUID（轮终态回填，task-04 原案）；pi=该轮首条用户消息 entryId（daemon 上报链落库）；pi 档 fork 语义=「分叉在第 N 轮后」→ 取第 N+1 轮 engine_anchor 为锚 position before，N 为末轮则走 clone 全量分叉；codex 恒 NULL；③task-06 claude driver 禁传 resumeDropsTurn（undefined 序列化 null 硬崩）+后台 job lane 禁用截断参数对；pi 分支确认实装（活 RPC 会话发 fork 命令）。
故障面：pi entryId 若不在既有上报链，需 daemon 侧增报字段（task-06 范围内），漏报则 pi 档 fork 拿不到锚
退役判据：同 D-008

## D-011@v1 执行期裁决——锚点数据源改走消息级 metadata 通道，task-04 依赖反转挪 W5
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：走消息级 metadata 通道：task-06 两个 driver 在归一化产物上补挂引擎原生锚进 AgentEvent.metadata 固定键 engineAnchor（claude=record 顶层 uuid；pi=用户消息 entryId），不碰 event-wire 平铺契约（metadata 键现成，event-wire.ts:81-116）不碰 claude-events/pi-events（driver 层持有 raw+归一化双视角，均在 task-06 allowed_paths 内）；backend 侧 AgentRunLog.metadata_ 列现成持久。task-04 改为消费端：从该轮已落库消息 metadata.engineAnchor 取值回填 AgentRun.engine_anchor（claude=轮末 assistant 消息；pi=轮首 user 消息）。task-04 因此增依赖 task-06、从 W2 挪 W5（与 task-08 同波，文件正交）；不降档、不推翻 D-008（正是落实其锚值语义）。
故障面：driver 漏挂或 backend 漏读该键→engine_anchor 恒 NULL→该轮入口灰（R-05 既有降级面，不炸链路）
退役判据：引擎侧原生提供可截断锚的上报 API 时收敛为单一来源

## D-012@v1 执行期裁决——lease.metadata fork 参数组统一契约（claude/pi 双形态）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：未记录
最近确认：1d33bda33
理由：lease.metadata fork 参数组四键：resume_at_uuid（claude 链 UUID）、fork_session(bool)、fork_anchor_entry_id（pi 用户 entryId）、fork_mode('resume_at'|'rpc_fork'|'clone')。fork.py 按 provider×锚可得性定 mode：claude→engine_anchor 有=resume_at、无=422；pi→at_run 下一轮 engine_anchor 有=rpc_fork、末轮=clone；codex(seed)→不写 fork 键纯种子。daemon（task-06）按 mode 消费：resume_at→claude SDK options 三件（禁 resumeDropsTurn）；rpc_fork→对源会话活 RPC 发 fork 命令（源死则加载源文件起临时 RPC 再 fork）；clone→pi 全量分叉。CreateSessionInput 对应增 resumeAtUuid/forkSession/forkAnchorEntryId/forkMode 四可选键。
故障面：rpc_fork 时源 pi 会话文件不可达（跨机/已删）→ fork 失败 4xx，文案提示
退役判据：pi 提供 spawn 期截断参数时收敛为 resume_at 同形态

## D-014@v1 执行期裁决——W4 双卡裁决汇总（pi 预 fork 方案/路径漂移//runs DTO 增列归属）
状态：implemented
变更：2026-09-22-session-fork-continuation
锚点：interactive/types.ts
最近确认：1d33bda33
理由：①pi fork 采用「短命 RPC 预 fork」替代卡面「源会话活 RPC」——实证 pi fork/clone 会劫持 RPC 进程自身活跃会话（teardownCurrent+apply），活 RPC 方案须 switch_session 切回且违反 D-005 零侵扰；短命方案（临时 pi --mode rpc --session <源> → fork/clone → get_state 读新分支 → 杀 temp → B 以分支文件 spawn）附带支持源会话已结束场景，失败原样上抛不降级。②pi entryId 不在 message 事件（仅 SessionEntry 落盘后存在）→ message_end(role=user) 回查 get_fork_messages 取轮首锚，失败仅 warn=锚缺失入口灰。③task-07 发现 /runs SessionRunRead 未透出 AgentRun.engine_anchor（native 档门控无数据源）→ session_insights.py 一行增列+gen:types 归 task-08，engineAnchor prop 由 /runs 数据接线。另：task-06 路径漂移两处（建会话真身在 session-manager.ts 非 index.ts facade；CreateSessionInput 在 interactive/types.ts）=代码现实修正。

## D-001@v1 init 时写入 skill 走 sillyspec init 自带 skills 复制（去掉 --no-skills）
状态：implemented
变更：2026-10-09-workspace-init-skill-gate
锚点：未记录
最近确认：ad53f7271
理由：用户明确「sillyspec init 里面会写 skill」——即启用 sillyspec CLI init 自带的 skills 复制段（daemon 侧 runSillyspecInit 当前以 --no-skills 关闭）。本决策修订 2026-08-15-init-trigger-sillyspec-init 变更 D-004@v1（supersedes）。
故障面：双渠道在 .claude/skills/sillyspec-* 上后写覆盖（skill-manager spawn 前 link 覆盖 init 时写入），版本可能漂移（daemon 本地 npm 包 vs 服务器 bundle 静态目录），无害。
退役判据：skill-manager 升级为多端分发时，可再次关闭 init 复制段恢复单渠道。

## D-002@v1 未初始化门禁仅前端引导，后端不硬拦
状态：implemented
变更：2026-10-09-workspace-init-skill-gate
锚点：未记录
最近确认：ad53f7271
理由：用户选「仅前端引导」——后端不加硬门禁（不返回 409），前端在成员绑定未初始化（init_synced_at 为空）时对工作区使用入口做引导提示，引导用户去初始化。门禁维度为成员/机器（一台机器未初始化不影响另一台）。
故障面：直接调 API 绕过前端引导仍可对未初始化工作区派任务（用户已知情选择）。

## D-003@v1 创建完成后前端串行调用初始化
状态：implemented
变更：2026-10-09-workspace-init-skill-gate
锚点：未记录
最近确认：ad53f7271
理由：用户选「前端串行调用」——创建接口成功返回后，前端紧接着调现有初始化接口（POST /api/workspaces/{id}/init），创建弹窗内展示初始化进度直到完成（复用 handleInit 轮询模式）。创建时未绑定 daemon_id（无法定位机器）则跳过自动初始化，保持现状等用户绑定机器后手动初始化。

## D-006@v1 init lease 失败禁止回写 init_synced_at（成败门）
状态：implemented
变更：2026-10-09-workspace-init-skill-gate
锚点：未记录
文件：backend/app/modules/daemon/lease/service.py
最近确认：ad53f7271
理由：Grill 独立审查 UB-1 实证：daemon init 失败仍以 status='failed' 走 completeLease 上报（sillyhub-daemon/src/task-runner.ts:1070-1080），后端回写段只判 mode=='init' 不分成败（backend/app/modules/daemon/lease/service.py:551）——失败数秒内 init_synced_at 即被写入。修复：回写段加 `result.get("status") != "failed"` 门，失败跳过回写 + warn 日志 init_lease_failed_no_synced。这也是 FR-04 前端"轮询非空=成功"语义成立的前置。
故障面：init 失败后 init_synced_at 恒 NULL，若用户不重试则详情页长期显示"未初始化"——正确语义，重试路径通畅（新 lease 行）。
退役判据：无（字段语义修正，不回退）。

## D-005@v1 方案A 最小链路
状态：implemented
变更：2026-10-09-workspace-init-skill-gate
锚点：未记录
最近确认：ad53f7271
理由：用户选方案A：daemon 去掉 --no-skills 让 sillyspec init 按 --tool 交集写多端 skill；版本门控提升 ≥3.32.2；前端创建弹窗串行初始化展示进度；详情页轻引导。否决理由——B：三端抽公共组件改动面大收益小（新增 UI 仅创建弹窗一处，详情页已有完整实现）；C：初始化时刻本地仍无 skill 不满足直接诉求，且动任务执行热路径（skill-manager 每次 spawn 前跑）。
故障面：前端串行链路任一环失败（initDispatch 5xx / 轮询超时）都会让"创建即初始化"降级为"已创建待手动初始化"——出口文案必须明示两态，防止用户误以为创建失败。
退役判据：若后端 create 接口未来内嵌派发（原子化），前端串行状态机整体退役。

## D-004@v1 SILLYSPEC_VALID_TOOLS 同步 CLI v3.32.2 补 zcode
状态：implemented
变更：2026-10-09-workspace-init-skill-gate
锚点：未记录
最近确认：ad53f7271
理由：代码查证：sillyspec CLI v3.32.2 VALID_TOOLS = [claude, zcode, cursor, openclaw, codex, gemini, opencode]（含 zcode），daemon 端 SILLYSPEC_VALID_TOOLS 落后缺 zcode（注释自述「CLI 新增工具时同步此表」）。zcode 技能复制双层缺口于 2026-10-09 修复（sillyspec commit 016968bd，v3.32.2）。
故障面：机器上 sillyspec 版本 <3.32.2 时 zcode 端技能复制静默缺失（CLI 静默忽略未知 tool）。
退役判据：无（跟随 CLI VALID_TOOLS 演进同步）。

## D-002@v1 选区引用本期只覆盖代码/纯文本预览分支
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：用户确认本期只做代码（SyntaxHighlighter）与纯文本（pre）分支；.md 富文本态不做选区引用，后续需要再补「源码视角」。
故障面：用户在 .md 预览选中文字右键无菜单，可能误以为功能失效（tooltip/引导文案缓解）

## D-003@v1 引用为「指向」语义——只存路径+行号，不嵌选中文本快照
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：不嵌入。token 置换为 [代码引用:wid|path|L起-L止]，智能体按路径+行号自读最新内容（原型确认轮）。
故障面：发送后文件内容变化，智能体读到的是新内容而非用户选择时的内容（接受：引用语义即指向）
退役判据：若用户反馈需要快照语义，再评估嵌入文本或版本号锚定

## D-004@v1 正式引用文本协议三类标记，后端零改动
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：复用附件引用的正文透传机制，扩展三类标记：[文件引用:wid|path] / [目录引用:wid|path] / [代码引用:wid|path|L起-L止]；wid=工作区 id，path=相对工作区根 POSIX 路径；后端/API/schema 零改动。
故障面：协议字面被用户手改正文破坏 → 解析不命中降级为纯文本显示（与附件引用孤儿降级同口径）
退役判据：若未来引用升级为结构化消息块（非文本协议），三类标记整体退役

## D-005@v1 附件 token 与工作区引用 token 序号池合并
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：唯一化分配池合并两类 token（附件 id 映射 + 工作区引用映射共用 existingTokens 并集）；序号按「完整显示基名」分配——显示文本不同（如文件 design.md vs 代码块 design.md:10-16）不加序号，完全相同才 ·2 起。
故障面：两池若漏合并，同名附件+同名文件引用 token 文本撞车，置换时错绑
退役判据：两类 token 若改为不同括号形态（如工作区引用用『』），池分离后本决策退役

## D-006@v1 预览区无选区右键不拦截；非文本分支无选区功能
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：仅当预览内容区存在非折叠选区且落在行元素内才拦截右键弹自定义菜单；无选区/选区在行号槽外不拦截（浏览器默认菜单）；图片/PDF/二进制分支永不拦截。
故障面：用户期望无选区也能右键添加整个文件——本期预览区菜单只有选区项（整文件入口在文件树右键），引导文案说明

## D-008@v2 组装位以 grep 实测现状为准（7 处，非 R-04 旧记 8 处）
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：2026-10-10 独立审查（review-2026-10-10-131956 UB-1）grep 实测 substituteAttRefsForSend 调用点 7 处：session-panel-dialog.tsx:312/392/1343、session-panel-page.tsx:835/2748/3258、group-chat-panel.tsx:1969（2026-10-09 R-04 记 8 处已漂移）。
supersedes：D-008@v1
故障面：照抄旧清单漏接新点位（如 dialog:1343）导致该路径 token 直发
退役判据：无（与 D-008@v1 同生命周期）

## D-009@v1 实现架构=扩展附件引用库（方案 A）
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：frontend/src/lib/attachment-refs.ts
最近确认：38bb5b21e
理由：用户选 A（2026-10-10 方案选择轮）：扩展 frontend/src/lib/attachment-refs.ts 纯函数库 + 复用 InputRefOverlay——附件与工作区引用共用同一 token 机制/退格/角标；序号池合并（D-005）在同库自然落地；原型即此方案已实测。
故障面：函数签名需同时容纳 uuid 锚（附件）与 wid+path 锚（工作区），泛化不当会复杂化既有附件路径（设计时统一为「引用描述符」结构化解耦）
退役判据：若附件与工作区引用未来分化为不同编辑器体系，再评估拆库

## D-012@v1 槽位透传经 SessionPanel 分发器（index.tsx）——plan allowed_paths 通道缺口补齐
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：按 design 接口定义的 props 正路实现：index.tsx SessionPanelProps 增两个可选 prop（pendingWsRefInsert/onPendingWsRefInsertHandled）并在 page 分支显式透传（dialog 分支既有 {...props} spread 自动携带）；槽位类型 interface 定义在 session-panel-page.tsx（task-07 allowed_paths 内）随签名并入，page-helpers.tsx 不动。
故障面：透传遗漏会让 portal 下发的槽位在分发器层断链（输入区收不到）——sessions-portal 测试覆盖三分支断言兜底

## D-013@v1 预览区右键菜单内联实现（不复用 floating-context-menu）
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：execute 验收评审偏差 1（execute-review-2026-10-10-164613）：task-02 与 task-03 同 Wave 并行，预览区内联实现避免对并行新建组件的运行时依赖；同为看板 fixed div 同模式，行为等价。
故障面：两处菜单样式/行为漂移（接受：体量小，视觉走同一 token 体系）
退役判据：第二个菜单需求出现时统一收敛

## D-014@v1 FR-07 历史渲染内聚至 InlineAttRefTextWithPreview（turn-segment-views 零改动）
状态：implemented
变更：2026-10-10-workspace-ref-intake
锚点：未记录
最近确认：38bb5b21e
理由：execute 验收评审偏差 2：组件内部升级（InlineAttRefText 换 parseInlineRefs + WithPreview 按 kind 分流 fetchDownload/mime=null）使单聊+群聊全部既有消费点自动获得三类渲染，覆盖面优于逐点接线。
故障面：组件承担多职责（解析+预览分流）；可接受（与附件引用先例同构）
退役判据：若预览分流逻辑复杂化再拆独立 hook

## D-001@v2 掩码公式收紧（len<16 全掩）与敏感字段清单明文枚举
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：公式收紧为 len<16 整值掩为 '***'、len≥16 前4+'***'+后4；字段清单明文枚举 SENSITIVE_CONFIG_FIELDS=['token','api_key']（DaemonConfig 实测凭据类字段仅此两项，config.ts:256-444 范围核对），新增凭据字段须同步维护
supersedes：D-001@v1
故障面：未来 DaemonConfig 新增凭据字段而漏加清单 → 明文泄露；靠「新增凭据字段时同步清单」评审纪律 + 清单常量注释兜底
退役判据：若 daemon 配置引入统一的凭据字段声明机制（如 schema 标注），可改为声明驱动

## D-005@v1 方案 A（零 daemon 改动，backend 拼 allowed_roots 路径 + host_fs.read_file）被否决
状态：rejected
变更：2026-10-13-daemon-log-config-view
锚点：sillyhub-daemon/src/host-fs-handler.ts:871
最近确认：255a46d66
理由：否决。两个硬伤：① backend 拼不出 daemon 机器上 ~/.sillyhub/daemon/daemon.log 的绝对路径——host_fs.read_file 需绝对路径（sillyhub-daemon/src/host-fs-handler.ts:871 pathResolve），backend 不知道 daemon 侧 home 目录，且 SILLYHUB_DAEMON_DIR 环境变量可整体重定向状态目录（sillyhub-daemon/src/config.ts:57-62），重定向后 backend 拼的路径静默失效；② read_file 为全量读取（readFile utf8 无 tail 参数），daemon.log 无轮转纯追加，大文件全量传输有 RPC 超时/内存风险；③ 脱敏逻辑放 backend 会与 daemon 配置结构演进脱钩
否决理由：路径不可靠（重定向即失效）+ 全量读大文件超时风险 + 脱敏逻辑远离数据源易漂移
复潮条件：host_fs RPC 若支持 ~ 约定寻址 + tail 参数 + 字节上限，硬伤①②消解时可重评

## D-006@v1 方案 C（心跳携带日志/配置快照入库）被否决
状态：rejected
变更：2026-10-13-daemon-log-config-view
锚点：sillyhub-daemon/src/config.ts
最近确认：255a46d66
理由：否决。心跳每 15s 一次（sillyhub-daemon/src/config.ts 默认 heartbeat_interval=15），携带日志尾部会让心跳 payload 持续膨胀；日志时效性锁定在最后一次心跳时刻，排障场景价值低；为低频排障需求引入持续存储开销与配置变更检测复杂度，收益成本倒挂
否决理由：心跳 payload 持续膨胀 + 日志时效性锁死于最后一次心跳 + 为低频排障引入持续存储开销
复潮条件：出现「离线机器也要看最后快照」的强需求，且心跳带宽/存储不再敏感时可重评

## D-007@v1 配置下载恒脱敏（明暗态一致）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户裁定「恒脱敏下载」：无论页面处于掩码态还是明文态，下载永远输出脱敏 JSON；要核对明文在页面上点「显示明文」看即可，下载（外带动作）不携带明文凭据
故障面：用户预期「所见即所载」时可能困惑——UI 文案明确标注下载恒脱敏

## D-008@v1 测试文件路径对齐 tests/modules/daemon/ 目录结构
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：backend/tests/modules/daemon/test_daemon_machine_diag.py
最近确认：255a46d66
理由：路径校正为 backend/tests/modules/daemon/test_daemon_machine_diag.py；design.md 文件清单与 task-02 allowed_paths/target_files 已同步
故障面：无（纯路径校正，语义不变）

## D-002@v1 落选方案 B（详情列内嵌区块）— rejected
状态：rejected
变更：2026-10-13-session-change-files-hover
锚点：未记录
最近确认：f2d9879bb
理由：方案 B：在右侧「会话详情」列 TaskExecutionPanel 下方内嵌「关联变更」区块，点变更名开弹窗看文件树。
否决理由：详情列仅约 320px 宽，塞变更列表+文件入口拥挤；`detailColumnVisible = !mobile && (subagentPanelOpen || detailOpen)`，详情列与子代理面板互斥且可被用户折叠，入口可见性不稳定；与用户「悬浮展示」的原始诉求不符。
复潮条件：若未来产品决策砍掉悬浮元素、且详情列拓宽并常驻（不再与子代理面板互斥），可重新评估。

## D-003@v1 落选方案 C（纯前端拼凑）— rejected
状态：rejected
变更：2026-10-13-session-change-files-hover
锚点：未记录
最近确认：f2d9879bb
理由：方案 C：不改后端，前端用 `AgentSessionRead.change_id` + `current_change_id` 两个字段逐个 `getChange` 拼变更列表。
否决理由：两个字段最多覆盖 2 个变更（创建绑定 + 当前绑定），`change_session_links` M:N 表才是一个会话全部关联变更的唯一真相；历史执行过的其它变更全部丢失，不满足「一个会话内多个变更、归档可展开」的核心需求；且逐个串行请求无排序/归档分组信息（还要逐条补 ChangeSummary）。
复潮条件：若后端把关联变更全量内嵌进会话详情 DTO（目前评估为 DTO 膨胀、实时性差而否决），纯前端方案的自然上限才会解除。

## D-001@v1 方案方向定为「消息流预览卡 + 跳转附近预取」
状态：implemented
变更：2026-10-14-session-turn-preview-cards
锚点：未记录
最近确认：e785e71f9
理由：用户在探索阶段从 5 个候选方案（预览卡/附近预取/一键全载/静默回填/头尾折叠）中亲手选定组合「预览卡 + 附近预取」（AskUserQuestion 实选记录于 2026-10-14 会话）。
故障面：预览卡渲染量大（数百轮会话）需依赖既有 content-visibility 屏外跳过；预取请求翻倍需已加载判重防重复 prepend。
退役判据：若未来后端提供轮次分页 API（按轮批量取全文），预览卡+直达链路可整体替换为虚拟滚动方案。

## D-002@v1 后端零改动，纯前端实现
状态：implemented
变更：2026-10-14-session-turn-preview-cards
锚点：未记录
最近确认：e785e71f9
理由：不需要。turn-outline 接口（GET /api/daemon/sessions/{id}/turn-outline）已一次下发全量轮次摘要（prompt_summary 60 字/answer_summary/时间/状态/发送者），左侧导航正在消费；run_id 单轮直达（getAgentSessionLogs({run_id})）已支持整轮日志拉取；2026-10-13-load-earlier-full-turn 已铺轮边界合并机制。

## D-004@v1 实现架构采用合并式单一数据源（方案 A）
状态：implemented
变更：2026-10-14-session-turn-preview-cards
锚点：未记录
最近确认：e785e71f9
理由：用户选定方案 A 合并式：大纲条目在 displayTurns 派生层归并（已加载轮用真实 turn，未加载轮合成预览骨架条目），turn-timeline 对骨架条目渲染预览卡分支。方案 B 双源拼接因「两套数据对账竞态」历史高发（ql-20260903-002 同 run 双块 / 2026-09-29-jump-empty-turn-dup 重复直达 / ql-20260916-016 空壳墙）被否决。
故障面：displayTurns 派生复杂度上升（归并逻辑需纯函数外提单测）；outline 刷新触发全量重派生（outline 仅会话切换拉取一次，成本可接受）。
退役判据：若后端未来提供轮次分页全文 API，归并层可替换为服务端分页驱动。

## D-unmapped-015@v1 互@模式建模——主开关布尔保留 + 新增模式枚举
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-001@v1
锚点：未记录
最近确认：eaa3e314b
理由：`AgentGroupChat` 保留现有布尔 `agent_cross_mention` 作为互@总开关，新增 `cross_mention_mode` 枚举（`'private'` | `'public'`，server default `'private'`）；模式仅在总开关开启时生效，总开关关闭=严格 openclaw 模式语义不变。项目未上线、数据可清空，迁移直接加列。
故障面：布尔与枚举双字段可能出现「开关关、模式 public」的悬挂态——读取侧必须以开关优先，设置界面在开关关闭时禁用模式选择器。
退役判据：若后续互@语义简化为单一公开/关闭两态（私聊模式被淘汰），可并回布尔字段并删除枚举。

## D-unmapped-016@v1 默认值——存量群与新群均默认私聊化（可否决）
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-002@v1
锚点：未记录
最近确认：eaa3e314b
理由：沿用 2026-09-10 群级开关变更 D-002「存量群零变化」惯例：存量群行为不变（等价 private），新建群默认 private；公开委派作为建群向导第三步与群设置里的可选项呈现。用户提问未及作答，AI 保守裁定。

## D-unmapped-017@v1 公开委派 v1 投影口径——只投影最终结果（可否决）
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-003@v1
锚点：未记录
最近确认：eaa3e314b
理由：v1 只投影被委派成员的**最终回复**（复用 [[GROUP]] 标记抽取），干活过程留在影子会话不刷群；进度播报（DS Bot 式阶段性播报+短句合流）留作后续独立增量。理由：D-005 当初互@私聊化的动机是「分歧讨论污染群时间线」，最小口径（只进结果）直接化解该动机，先把「群里看得到协作结果」的核心价值验证掉。
故障面：委派耗时长的场景群里长时间无动静——缓解：发起方触发时群内系统行「已把任务转给 X」即时可见（依托现有 typing/系统行通道，不新增投影）。

## D-unmapped-018@v2 轻注入原语修正——新增纯日志 helper，不复用 send_direct_message
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-004@v2
锚点：未记录
文件：backend/app/modules/daemon/group/service/delegation_notice.py
最近确认：eaa3e314b
理由：不成立。评审 UB-1 实证：send_direct_message（backend/app/modules/daemon/group/service/messages.py:732）为触发语义（:806-818 新建群载体 run、:848-849 busy_strategy=inject 注入活跃轮），无「只插日志行不触发」的可抽取对应物；且「载体 run」术语与代码冲突（载体 run 恒挂群会话）。修正为：新增 _inject_delegation_notice 纯写日志 helper（NEW:backend/app/modules/daemon/group/service/delegation_notice.py），直接向发起方影子会话最近 run 追加 AgentRunLog(user_input, delegation_notice metadata)，不建 run/不入队/不派发，失败静默降级记 warning。轻注入不触发的行为语义（v1 核心）不变。
supersedes：D-004@v1
故障面：注入行与影子会话日志读取口径不符（成员会话视图异常行）——单测断言可渲染（R-03）。
退役判据：若后续改为自动触发发起方接话（D-010 复潮），轻通知 helper 可被触发路径复用或删除。

## D-unmapped-019@v1 consensus 互斥——汇总模式开启时公开模式不接管
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-005@v1
锚点：未记录
最近确认：eaa3e314b
理由：`consensus_mode=true` 的群，协作轮走 consensus 自有语义（私下转交+coordinator 收口），互@模式不改变其行为；两者是互斥的协作策略，consensus 优先。仅当 consensus_mode=false 且互@模式=public 时走公开委派。

## D-unmapped-020@v1 投影谓词改造——新增公开委派轮型，私聊轮拦截不变
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-006@v1
锚点：未记录
最近确认：eaa3e314b
理由：互@触发时按群模式分流：public 群的被@成员轮 turn metadata 记 `dm_kind='agent_public'`（不含 dm_target），role_prompt 用公开委派指令（要求 [[GROUP]] 标记给群结论 + 注明「结果将直接进群」）；projection_blocked 谓词仅拦 `dm_kind='agent_dm'`（私聊）与 consensus 协作轮，agent_public 轮放行走 [[GROUP]] 投影。护栏（链深≤群设置、同链同成员 2 次、限频滑窗、Redis fail-closed）三层原样沿用，公开模式不放宽。
故障面：轮型标记错误会导致该进群的没进/不该进的进了——单测双断言钉死两种轮型的投影矩阵。
退役判据：若投影口径统一为按 [[GROUP]] 标记单一判定（轮型无关），dm_kind 分支可收敛。

## D-unmapped-021@v2 打断语义修正——零注入成立，流式已投影不撤回
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-007@v2
锚点：未记录
最近确认：eaa3e314b
理由：v1 的「零投影」承诺过强——[[GROUP]] 段投影发生在 submit_messages 流式双写（与 run 终态无关，普通 @ 轮同款现状语义），打断前已投影的内容不可能也不应撤回。修正为：**零注入**（轻通知挂接点仅在 completed，成立）；**流式已投影内容不撤回**（现状一致）。实测证据：test_interrupted_round_no_notice 初版断言「零投影」失败（submit 时投影行已落载体）。
supersedes：D-007@v1
故障面：无（收紧承诺到现状可兑现语义）。
退役判据：若未来引入投影撤回机制（override DELETE 扩展到打断轮），可恢复「零投影」承诺。

## D-unmapped-022@v1 实现方案选定——方案 A（结果单投 + 轻注入）
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-008@v1
锚点：未记录
最近确认：eaa3e314b
理由：选方案 A：互@触发按群模式分流轮型，public 群被@成员轮记 dm_kind='agent_public'（无 dm_target）+ 公开委派 role_prompt，投影谓词放行该轮 [[GROUP]] 投影，收口时向发起方影子会话纯注入轻通知（不触发运行）；护栏三层原样沿用。理由：改动面最小且集中（mentions/group_bridge/模型加列/设置 UI）、私聊路径零回归（轮型分流互不干扰）、零新增运行成本；B/C 的增量（双写/进度播报/自动接话）均可在 A 之上独立叠加，演进路径开放。【AskUserQuestion 未及作答，AI 按推荐裁定，待用户否决——否决则本条 supersede】
故障面：轮型分流漏判会导致公开群互@仍走私聊——触发分流单测钉死 public/private 两群型的 dm_kind 断言。
退役判据：若方案 C（进度播报+自动接话）复潮并取代最小口径，本条随 D-003/D-010 复议一并 supersede。

## D-unmapped-023@v1 落选——方案 B（结果双投：群投影 + 发起方 DM 注入）
状态：rejected
变更：2026-10-15-group-cross-mention-visibility
原编号：D-009@v1
锚点：未记录
最近确认：eaa3e314b
理由：落选。
否决理由：同一回复 token 双份消耗（群投影+DM 注入各自进入模型上下文），且对群的回复注入私聊会话语境错位，与轻通知语义重叠需后续拆除，违反 D-004。
复潮条件：用户明确要求发起方在下次触发前就拥有委派结果全文（而非摘要通知），且可接受双份 token 成本时重议。

## D-unmapped-024@v1 落选——方案 C（完整 DS Bot 语义：进度播报 + 自动接话）
状态：rejected
变更：2026-10-15-group-cross-mention-visibility
原编号：D-010@v1
锚点：未记录
最近确认：eaa3e314b
理由：落选（v1 范围）。
否决理由：流式分段投影+合流窗口状态防刷屏改动面最大，每次委派多一轮运行成本且 A↔B 乒乓风险上升，v1 未验证核心价值前风险收益比最差，违反 D-003/D-004。
复潮条件：方案 A 上线后用户反馈「委派过程黑盒/结果无人接话」成为高频诉求，且护栏实测足以约束乒乓时，作为独立增量变更重议。

## D-unmapped-025@v1 互@分流三态优先级——源轮 consensus_task_id 优先于群模式
状态：implemented
变更：2026-10-15-group-cross-mention-visibility
原编号：D-011@v1
锚点：未记录
最近确认：eaa3e314b
理由：会（若无优先级）。修正：互@触发分流按三态优先级执行——①源轮 consensus_task_id 非空 → consensus 协作轮型（现状，带 dm_target、投影拦截）；②群 cross_mention_mode='public' → agent_public；③其余 → agent_dm 现路径。现路径本就按源轮 consensus_task_id 优先记 dm_kind='consensus'（mentions.py:460-469），本决策把该优先级显式化并钉进单测。
故障面：无（纯优先级显式化，收紧泄漏窗口）。
退役判据：若 consensus 与互@模式未来统一为单一协作策略引擎，三态判定收敛进该引擎。

## D-frontend_components-001@v1 决策 pill 类型范围——三类全含，后两类仅实时 pending
状态：implemented
变更：2026-10-16-session-decision-pill
原编号：D-001@v1
锚点：未记录
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26
理由：用户选择"三类全要，但后两类只看当前待决策"：AskUser 提问含 pending+已答历史；工具审批（canUseTool）与 Plan 审批仅聚合当前实时 pending，不追历史（历史用聊天时间线回看）。
故障面：工具审批/Plan 审批 pending 依赖 SSE 实时态——页面刷新后丢失（与聊天流卡片同现状），pill 上不显示刷新前漏掉的实时审批
退役判据：后续若为工具审批/Plan 新增持久化，本边界升级为全类型含历史

## D-frontend_components-002@v1 pending 项点击动作——定位回聊天流卡片，普通工具审批跳聚合页
状态：implemented
变更：2026-10-16-session-decision-pill
原编号：D-002@v1
锚点：未记录
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26
理由：用户选方案 1（定位回聊天流卡片）：pending 卡 sticky top-0 常驻聊天流顶部不会滚丢，被最小化的可还原。普通工具审批（无 dialog_kind）会话页无卡，跳 approvals 聚合页作答（现有唯一作答面）。

## D-frontend_components-003@v1 实现方案——C 前端自包含聚合（仅 AskUser 提问 + Plan 审批）
状态：implemented
变更：2026-10-16-session-decision-pill
原编号：D-004@v1
锚点：未记录
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26
理由：用户选方案 C：新组件仿 session-change-files-hover 自包含——pending 复用父级现有 SSE 状态链（pendingRequests + planPending），历史组件内 react-query fetchSessionDialogHistory；普通工具审批不收集（门户会话不会发生）。
故障面：普通审批若未来权限模式变更后发生，pill 不显示（缺口明确记录，非静默失败）
退役判据：权限模式支持普通审批人审的会话入口上线时，升级聚合范围

## D-frontend_components-004@v1 rejected 方案 A——前端聚合 + 普通审批实时收集
状态：rejected
变更：2026-10-16-session-decision-pill
原编号：D-005@v1
锚点：未记录
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26
理由：（落选）
否决理由：门户会话（manual_approval=true + ask_user_only=true）除 AskUserQuestion 外全部自动放行，普通审批收集是死代码，白增状态面
复潮条件：出现普通审批人审的会话入口（ask_user_only=false 的门户会话/新权限模式），且用户需要在会话内看到这些等待点
