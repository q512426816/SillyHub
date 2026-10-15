# 决策知识 — frontend_components

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 会话轮次导航 = 桌面常驻左栏 + 移动端收 ⋯ 菜单抽屉
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-prototype-pipeline
锚点：未记录
最近确认：ca9f19016291ccc7f363d1d03fe4eb84f828bcf9
理由：最大风险：Tailwind 全量 CSS 使每产物 ~150KB、七文件合计 ~1MB 入仓——接受（纯文本 git 增量压缩后很小；后续可加按视图 content 裁剪优化，非本变更范围）。次风险：视图静态渲染无水合，交互仅 vanilla JS 子集（主题切换/tab 过滤）——规约中明示，需要完整交互的原型走 dev 预览路由（后续变更）。 试过放弃：① mermaid 文本方案——渲染产物需浏览器运行时（内联 mermaid.js ~2MB/文件）或引入 puppeteer 重依赖，放弃；② 复用 @xyflow/react——交互式定位编辑超流程「描述类」原型所需，静态渲染下自动布局不稳定，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-session-fast-replay
锚点：未记录
最近确认：a2bdb21f8a1936075294b826d6cd225a84cb31c1
理由：最大风险：跳转直达的 prepend 装配链——单轮日志直接进 logsToTurns 需与既有 turns 正确衔接（复合游标去重依赖 ts 排序，单轮请求升序返回天然满足）；防护=复用既有 prepend 锚钉回+会话纪元防串台机制，测试覆盖跨页边界（目标轮与已加载窗口相邻/重叠两种情形）。第二风险：大纲摘要 SQL 窗口函数在超大日志表（15 万行）上的成本——指纹缓存吸收重复读，首算成本 DB 端扫描无传输（可接受；若实测慢再上物化投影，本次不做）。 试过放弃的方案：①全量历史虚拟滚动（@tanstack/react-virtual）——治渲染不治传输，且动态高度虚拟化复杂度高，hermes 实证聊天流不需要（窗口小），放弃；②大纲落库物化表+触发器维护——正确性最好但写路径侵入大，首版用指纹缓存（读时失效），实测不够再升级，放弃先行；③/runs 改分页——大纲端点已承担全量轻列职责，runs 保持现状语义只瘦身，避免双端点职责重叠。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-27-session-portal-ia-restructure
锚点：未记录
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83
理由：最大风险：session-panel-page.tsx（4615 行）JSX 大块迁移时破坏隐蔽行为——占位轮 SSE 抢先认领、触顶加载锚钉回、跳转抑制窗、发送窗口期打断回退等防呆逻辑都缝在 render 与 effect 的交界处。对策：只移动 JSX 块的容器位置，不动任何 hooks/回调/数据派生；每完成一个 task 跑相关测试再进下一步；收口时对 diff 逐行审查确认「仅 render 组织层」。实际暴露（独立评审 P1）：desktop 非 portal 宿主（分身浮层/悬浮助手）不传 onOpenSubagent，右列初版绑定宿主 props 导致它们的用量条与任务面板消失——已修复（右列容器与子代理 Provider 解耦，desktop 一律有右列）。另注：本变更工作区基线叠加于上一轮 2026-09-26-core-pages-visual-redesign 未提交的 staged 快照之上，冻结件 change.patch 因此含上一轮 38 文件捆绑（主仓库已分两笔 commit 剥离归属：先 staged 快照落地为上一轮 commit，再本变更独立 commit）。 试过放弃的方案：①ChatGPT 式单栏+抽屉布局（推翻三栏）——深链/群聊/文件模式/四分支全部重做，风险与收益不成比，放弃；②把 SessionConfigBar/CtxUsageBar 也收进右栏——配置与压缩上下文是输入前高频操作，收进右栏断操作流，放弃；③portal 层做统一四栏容器——群聊分支与文件树模式联动复杂，波及面大，放弃（改为 panel 层内解决）；④TaskExecutionPanel/UsageBar 彻底只留右栏——mobile 无右列会丢功能，放弃（mobile 维持原位）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-audit-risk-fixes
锚点：未记录
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938
理由：最大风险：黑名单收窄以「root 只进 spawn cwd、绝不拼命令串」为前提——若未来 knowledge 命令改为拼接 root，& 等字符会重新构成注入面；已在类注释钉死该前提，改命令构造时必须回看。containment 是真正的物理边界，黑名单仅异常值防线。 试过放弃的方案：把 issue-row 的 div onKeyDown 一并删除（F-3 同源直觉）——div role=button 无原生键盘激活，删了是可访问性回归；只删 underline-nav 的容器级处理（tab 是真 button，原生激活足够）。 不可修项留档：66ae9a0d4 提交点 ImportError 是 git 历史事实（HEAD 已由 723d325fd 补全），不改写历史。 评审 P2 裁决（change.patch 冻结区间夹带）：session_insights.py 的 `func.max(cast(AgentRunLog.id, String))` hunk 属并行会话提交 66393f432（turn-outline 指纹 PG 无 uuid 聚合修复，生产 500），非本变更交付文件面——baseline(b14ce676f)..HEAD 区间采集把它扫入冻结件，属区间机械现象（先例：多份归档提交的「并行会话增量不夹带」注记）。该 hunk 的行为承诺与测试（15 用例）在 66393f432 自身留档，本变更不重复承接，边界已裁决：可接受。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-change-ux-detail-batch
锚点：未记录
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5
理由：最大风险：布局类改动（grid/h-64/滚动）在真实浏览器的观感无法由 jsdom 断言——已按 tailwind 语义保守实现（md 两列、h-64 固定高、min-h-0 flex-1 overflow-y-auto 链条齐全），真机目验移交用户；列表行修复是标准 flex 陷阱修法（min-w-0），确定性高。放弃的方案：沉淀资产每组独立 max-h（行高不齐对不齐）——改统一 h-64 换取网格对齐；平台同步保留常驻但折叠——用户明确要求收进按钮，折叠态仍占一行。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-28-fr-review-batch
锚点：未记录
最近确认：bccffba0b0d15714673700b5743c33378eff8c06
理由：最大风险：子代理为凑数把不相关的测试绑上去（橡皮图章绑定）——防御：子代理指令明确「测试必须真实覆盖该 FR 行为，拿不准就报『无测试面』不动绑定」；evidence 必须是测试形态文件（CLI 强校验）；主会话抽查各域非 confirm 类裁决。次风险：内容修正误判（把仍准确的条目改错）——防御：仅在被当前代码证伪时最小修正，拿不准归「保留待人工」不碰。放弃的方案：①主会话单线程逐条处理 263 条——上下文与时长爆炸，放弃；②一次性九域全并行——波间无校验断点、失败面大，改为三波。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-09-29-change-detail-timeline-files-polish
锚点：未记录
最近确认：5307276fa19543342bc4b11b9fe3f165f53ecf87
理由：最大风险：现有时间线卡测试断言行级 className（text-amber-700 醒目态）与 testid——重构 DOM 结构时须保住这两个锚点；jsonl 预览的 mime 不确定性（后端 guess_type 对 .jsonl 在不同平台可能返回 None/application/json/text-plain）已用三层兜底（EXT_MAP + JsonPreviewer 名字转发 + 解析失败回落纯文本）覆盖。 试过放弃的方案：直接复用 primer Timeline 组件做事件轴——放弃：其节点 h-7 + pb-5 行距是稀疏事件范式（GitHub 活动流），事件密集的留痕时间线用它会把卡片撑得更高，与「限高防撑爆」目标矛盾；只借其「节点+连线+tone」视觉语言自建紧凑行。另放弃在 openFullscreenPreview 里把 meta.name 换成中文名——下载文件会得到中文名文件，破坏本地对照能力。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-06-opencode-session-send-incident
锚点：未记录
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6
理由：最大风险：①HTTPS_PROXY 绑定 daemon 本机代理端口（127.0.0.1:7897）——换机器/换端口失效，属环境耦合（notes 已注明，探活与会话报错即时暴露）；②上游网络环境变化（劫持消失/代理下线）时该 env 变冗余但无害（代理拒连才会断，可再清）。放弃的方案：①把 isToolReportBody 判定内联进 handleSend（session?.origin === ...）——治标不治本，渲染区 6 处消费点仍需变量，双源漂移；②在 llm-proxy（hub 服务器侧转发）承载 opencode 流量借服务器干净网络——那是 openai_chat 的 LiteLLM 路径，anthropic 直连形态无此通道，为绕网络劫持重开转换网关属方向性倒退（litellm 分叉仍未拍板）；③给 daemon 全局配代理——影响所有供应商（国内上游走代理反而劣化），per-provider extra_env 是正确粒度。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-turn-nav-hover-mark
锚点：未记录
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916
理由：最大风险：指向 ring 与浮层行既有 `hover:bg-muted/50` 底色叠加的视觉密度——选择仅 ring 描边不加底色，二者正交叠加不糊（token 均为主题语义阶，随 data-theme 换肤）。放弃方案：①指向行加底色（与 active 行 `bg-muted/60` 底色同型，视觉冲突辨识度差）；②刻度上挂原生 title/tooltip 显示轮号（>60 轮密集态刻度仅 6px 高命中差，且不满足「浮层卡片标记指向轮」的需求本体）；③浮层行高亮直接复用 active 同款样式（「我在指」与「聊天停在哪」两语义混同，正是本 bug 的认知混淆点）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-frontend-risk-fixes
锚点：未记录
最近确认：9f996f692b6c018f7db14109def4af2e137fb1e5
理由：最大风险：overview 等待最长 200s——期间 UI 无中间反馈（react-query isLoading 态），用户可能重复刷新；属既有 UX 债非本变更引入，后续可加进度提示。次风险：copyText 去掉可选链后，jsdom/旧浏览器上 clipboard 缺失路径从「静默 no-op」变为「失败提示」——全文路径复制（fulltext-link）调用方仍忽略返回值静默降级（本体是可见文本），锚点复制从假成功变真失败提示，方向正确。试过放弃：(a) 渲染级测试钉 onPointerDown 置位——放弃，jsdom 无 canvas 2D 上下文，rAF 循环 effect 早退不可观测，改为提取 shouldAutoRefit 纯函数 + 双源置位一行接线（仓库 graph-canvas.test 纯函数惯例）；(b) 后端并发化 overview 三 RPC 缩短总预算——放弃，RPC 客户端并发安全性未证且超出本变更（前端风险收口）范围。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-graph-raf-settle
锚点：未记录
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34
理由：最大风险：阈值/帧数参数不优——epsilon 过大在微振荡期早停（布局略欠收敛），过小则长尾难达（30 帧守卫要求持续静止，阻尼系统指数衰减下 0.25px/帧 可达，联测 6000 步内实证收敛）。终局 fit 只在未交互时执行，交互过的用户视口不受打扰。试过放弃：(a) 取消 rAF 按需重启——放弃，dirty 早退已让空帧成本趋零，接线面大；(b) 单帧判定收敛——放弃，弹簧转折点瞬时零速会误判（oscillator 在振幅处速度为零）；(c) 全局静止能量阈值——放弃，px/py 位移已是现成速度代理，无需新载体。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-pending-attachment-preview
锚点：未记录
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795
理由：最大风险：测试面——多处既有 harness 以工厂 mock `@/lib/api/session-attachments`，缺新用到的 `fetchAttachmentBlob` 导出时组件 import 可能拿到 undefined；本变更只在实际点击预览时调用该函数，且对涉及的 mock 顺手补齐该导出。放弃的方案：给 chip 整体包 `<button>` 再给 X `stopPropagation`——嵌套按钮非法 HTML 且事件冒泡补丁脆弱，改为文件名区与 X 两个独立兄弟按钮，无冒泡依赖。

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
最近确认：ad53f7271
理由：Grill 独立审查 UB-1 实证：daemon init 失败仍以 status='failed' 走 completeLease 上报（sillyhub-daemon/src/task-runner.ts:1070-1080），后端回写段只判 mode=='init' 不分成败（backend/app/modules/daemon/lease/service.py:531-542）——失败数秒内 init_synced_at 即被写入。修复：回写段加 `result.get("status") != "failed"` 门，失败跳过回写 + warn 日志 init_lease_failed_no_synced。这也是 FR-04 前端"轮询非空=成功"语义成立的前置。
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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-ws-create-spec-default-collapse
锚点：未记录
最近确认：1c4acf7a8a146975c41d153750f28c5054d58ac0
理由：- 最大风险：默认策略从「平台托管（不碰源项目）」翻转为「源项目即真理（扫描直接写源项目）」，新工作区默认行为变为写源项目 `.sillyspec`——已有 ⚠ 警示文案在收起态也保持可见（FR-05）来对冲用户无感知的风险；这是用户明确要求的默认值，属预期行为变化。 - 放弃的方案：CSS `display:none` 隐藏前两选项（不满足 FR-03 的 DOM 移除要求，且屏幕阅读器仍可聚焦）；把 spec 策略挪进独立的「高级设置」二级弹窗（改动面大、移动端无对应容器形态，收益低）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-att-ref-badge-hover
锚点：未记录
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0
理由：最大风险：角标显示后指针移向角标本体——离开 span 原始矩形瞬间若命中测试失败会闪灭循环。缓解：命中矩形外扩 8px 覆盖角标外挂区（-right-1.5 -top-1 = 6px）。放弃的方案：①纯 CSS group-hover——span 被 textarea 覆盖，:hover 永不触发（可行性死路）；②给 span 开 pointer-events-auto——挡住下方 textarea 的点击/选字，违反 FR-02；③mousemove 监听 textarea——指针移到角标（sibling）后事件不再冒泡到 textarea，同样闪灭。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-dialog-qa-inplace
锚点：未记录
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe
理由：- 最大风险：段时刻缺失（`startedAt`/`ts` 为 null 的旧段）与 ❓ 块（ts 视 0）混排时穿插位置退化——与「全部」视图同款既有语义（视 0 靠前 + 稳定保文档序），非新增风险；回退路径完全不动。 - 放弃方案「dialog 落 chat 日志行参与日志流」：需动后端写入链路 + 历史数据不回填 + 与 dialog 机制（不走 tool_use 日志）的既有裁决冲突，收益不抵面。 - 已知残留：`created_at` 精度为 dialog 请求时刻，与段时刻毫秒级并列排序理论上可同刻（稳定排序保互不跳序）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-session-turn-token-speed
锚点：未记录
最近确认：de31e3fa5b1cd6e9dc0d73ba8705374b124ac61c
理由：答：最大风险是 `duration_api_ms` 只有 Claude 系引擎上报（codex/cursor 等引擎 结果元数据可能缺省）→ 这些引擎的轮永远无速度显示。处置：FR-04 明确不显示即 预期行为，不伪造；后续若要全引擎覆盖需 daemon 各 driver 逐调用计时（独立变更）。 第二风险：api-types 重生成暴露无关旧测试债——按仓库规则 21 顺手补字段修好， 不回退手写（本次未暴露）。 试过但放弃的方案： - 实时运行中显示 Δoutput/Δt（tokens 事件差分 ÷ 墙钟）：分母含工具执行时间， 数字被稀释 5-10 倍，多供应商对比场景下误导性强，且 deepseek-harness 明确 拒绝该口径——放弃，宁可运行中不显示。 - 后端聚合端点加会话级总时长出「会话平均速度」：历史窗口化下前端求和必算少 （agent-log-turns.ts 注释既有结论），需新聚合查询，收益/成本比低——留后续。 - daemon 侧逐调用计时透传（对齐 deepseek-harness 的 decode 段口径）：跨 claude/codex/cursor 三引擎消息边界形状不一致，改动面大——本变更先用 duration_api_ms（含 TTFT 的近似 decode 口径），逐调用计时留独立变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-single-turn-nav-and-jump-head
锚点：未记录
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8
理由：- 最大风险：50 页上限内连续 prepend 大量 DOM（巨型会话全量加载），低配端渲染压力——已有 `content-visibility` 与 50 页上限兜底，且为用户显式点击触发（非自动）；toast 明示可续。 - 放弃方案 A「修触顶手感（阈值/锚定参数调优）」：无浏览器复现定位精确体感根因，动高测试密度滚动机制（触顶/锚定/贴底三方交互）回归面大；放弃方案 B「列表虚拟化」：属大改，超出轻量变更范围。 - 已知残留：滚动体感问题本身未根治（本变更提供绕开路径）；用户侧验证待部署后确认。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-system-opened-turn-usermsg
锚点：未记录
最近确认：f164a7fbca2264116fe5a3adaff5ad585a217b81
理由：- 最大风险：占位空组使「通知开轮」轮次的 prompt 恒空——若该轮实为用户真实发起但消息形态恰被剥空（如纯前导群聊注入开轮），顶部将无用户气泡——与既有「通知唯一开轮」形态一致，属既有语义而非新增缺失。 - 放弃方案「后端给 user_input 行加 opener 标记列」：需动表结构+迁移+双端联动，而时间戳数据本就正确、纯前端可判（首条+剥空），收益不抵面。 - 已知残留：首条判定按处理序而非严格 min(ts)——后端返回序即块内 ts 升序，理论乱序输入不在契约内。 - 评审 P3-2 披露补记：系统开轮后、首条输出段到达前的窄竞态窗口内，中途消息实时路径仍会写 prompt（无输出段可判），回放则渲染为 user_msg 段——两形态时序均正确，仅展示形态短暂不一致，窗口随首条输出到达自然闭合。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-variant-test-nav-flip
锚点：未记录
最近确认：589d2691b4a6dc32ae723617030bce6a58f4c339
理由：最大风险：无（断言翻转有组件测试 turn-nav-list「单轮渲染」用例与本次 6 文件 107/107 全绿双重佐证）。未试过其它方案——「改组件迁就旧断言」会直接违反已归档 FR-01，不在考虑内。

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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-ci-red-batch-fix
锚点：未记录
最近确认：8a1eb8fe3a033bfe20461f3e1c2f595c4e5d643f
理由：最大风险：daemon api-types.ts 的 872 行漂移里除已核实的改名外还可能藏其它 schema 形态变化，daemon 源码若引用了被改窄的类型会 typecheck 红灯——已用 `pnpm -C sillyhub-daemon typecheck`（0 错）实测兜住，残余风险由 daemon-ci 的 typecheck+test 复核。放弃的方案：给 PublishIntent.duration_api_ms 补默认值 `= None`（需移动字段位置避开 dataclass 非默认位序约束，会改变既有位置参数语义，波及 production 构造点，收益仅省一处夹具参数——不做）；让迁移锚测试改为不锚具体 revision（已有 test_migration_single_head.py 动态断言单头，本锚的价值恰在钉具体链尾，按惯例前移即可）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-mobile-subagent-drawer
锚点：未记录
最近确认：85f49e7333567bea28ef71b993f8b132fb4614b9
理由：- 最大风险：Drawer 内 SubagentDetailPanel 的 h-full 布局在 antd Drawer body 内的高度链——body 已设 flex column + 面板根 h-full（jsdom 无布局无法实测，真机验收项）；若异常退化方案为 body 加显式 height。 - 放弃方案「mobile 页宿主自持三 props（照 portal 装配）」：手机页无右栏可开，props 还得指回组件内状态，多一层无意义转发；放弃「mobile 复用内联展开 + 默认折叠」：信息密度仍高于紧凑卡且与 PC 形态不一致（用户点名要 PC 同构）。 - 已知残留：Drawer 无嵌套路由/返回键联动（移动端返回手势直接退页面而非关 Drawer）——后续可按需接 antd onClose 与历史栈。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-retire-components-page
锚点：未记录
最近确认：bc0cac931980b9a1145369a9bfd7ddd377776ee5
理由：<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-retire-components-page 留痕重锚 --> <!-- MACHINE-DRAFT:design-risks:end --> 最大风险：有外部脚本/书签直连 /components 路径——下线后 404。接受理由：该页 13/15 工作区 本就空数据，无可书签价值；信息已在关联仓回显。放弃的方案：①加「从模块索引生成」按钮复活 组件页（选项 B）——为空页续命而非解决问题；②后端端点一并删——破坏 openapi 面且无收益 （无人调用的 GET 无害）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-clipboard-helper-full-migration
锚点：未记录
最近确认：8fc2491b7ea87a435111d715cc74a2fc4fd1ed9e
理由：- 风险：机械迁移面大（15 文件）——以 grep 验收残留清零 + 全部触碰组件既有测试全绿 + tsc/eslint 门兜底；改动形态单一（换调用源），无逻辑重写。 - 放弃方案 A：只迁移「重要」调用点（命令卡/ID）留其余——半迁移态更不一致，且每处都同样机械，全量一次收口。 - 放弃方案 B：各组件就地复制降级逻辑——违背单一实现（helper 头注即为此而设），后续维护面翻倍。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-nullable-email-dto-fix
锚点：lib/admin.ts
最近确认：9e1023756c326d287faf5c93b00676f41b34fb11
理由：最大风险：前端既有代码把 `email` 当非空用的隐藏点位漏改，tsc 抓不全的 （如模板里直接插值）运行时渲染出空白。缓解：渲染点逐一回退处理 + workspace-member-row 补 null 用例 + tsc --noEmit 全量类型检查； `localeCompare` 调用点仅角色页聚合排序一处（已全局搜索确认）。 实际执行中 tsc 全量扫出 3 处（members/page 两处 + shared-daemon-manager 一处）， 另在 task-05 人工排查出 lib/admin.ts 手写 DTO 漏同步（tsc 因本地类型未改而放行）。 试过/考虑过但放弃的方案： - service 层兜底 `email=user.email or ""`：契约撒谎（空串≠无邮箱），且 前端无法区分"无邮箱"与"空邮箱"，弃。 - 只改 RoleUserRead 不动 workspace 两处：同类 500 隐患原地保留 （成员列表/搜索遇纯用户名账号必炸），修一半等于没修，弃。 - 邀请搜索补 `username ILIKE` 匹配：属于搜索行为增强，与本 500 无关， 留作后续独立小变更，避免本次 diff 膨胀。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-stale-run-askwait-fix
锚点：未记录
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8
理由：最大风险：**豁免过宽导致 run 永卡 running**——若提问落库形态判定漏/多。控制：信号仅两种窄形态（pending_input 通道、tool_call+tool_kind=ask，均实证于生产数据），且 daemon 死亡面有 sweep 独立兜底，宽限跳过与判死兜底（延迟复扫）链路不变。 试过但放弃的方案： - **复用 `_run_daemon_alive` 给启动清理加活性门**——放弃：启动清理发生在后端重启瞬间，daemon 可能尚未重连续约，lease updated_at 必然陈旧 → 活性门恒 False，等于没加；且多一次 lease/runtime/instance 三级查询。日志 ask 信号是重启免疫的确定性判据。 - **SessionDialogRequest pending 行作豁免信号**——放弃：生产实证交互会话的 AskUserQuestion 不落该表（run e31ec8fc 在 dialog 表 0 行），信号覆盖率不足。 - **error_detail 直接补 type/message 键**（不动前端）——放弃：调度层错误不是模型错误，硬塞 type 会进 8 类模型错误映射语义；且存量已落库的 {reason, finished_by} 行仍显示 unknown，前端回落才是全量修复。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-ws-ref-emoji-inline
锚点：未记录
最近确认：20058a3a97f47a4daab0165f5264f62f9fb442de
理由：最大风险：emoji 宽度在不同平台字体下的渲染差异（Windows/macOS/Linux 不一致）——但占位文本与 textarea 用同一字符同一字体栈，两侧永远同宽（同源对齐），风险仅剩视觉观感，可接受。放弃的方案：lucide inline 图标内嵌（撑宽背景块→后续 token 漂移，否决）；图标 absolute 悬浮在文字前（遮挡前文字符且盖住【，观感差，否决）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-ws-ref-hover-tip-flip
锚点：未记录
最近确认：1ec1af9dd914b8145359bc47258a258ae36335f4
理由：风险：TIP_EST_HEIGHT=48 是粗估（实际两行文本≈42px）——翻转判定略保守（早翻），只影响翻转时机不影响可见性。放弃的方案：渲染后读实际高度再翻（useLayoutEffect 二段定位）——复杂度不值（估高误差只导致提前翻转，无功能影响）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-ws-ref-hover-tip-portal
锚点：未记录
最近确认：f9406f124c645aa4092cefe74c91e05e6afd510f
理由：风险：body 直挂元素的测试断言路径变化——已同步改 document.querySelector 并隔离用例（unmount 后断言）。放弃的方案：向上排查移除页面祖先的 transform（根在布局容器/动画库，影响面大且布局再变会复发）；portal 是标准免疫方案。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-ws-ref-ws-name
锚点：未记录
最近确认：40622e032cbece20e57db17154d582ce835e67b2
理由：风险：无（纯显示增强，降级路径完备）。放弃的方案：两输入区各自拉工作区列表（重复请求+群聊面板无现成数据源）；历史标记协议加名称字段（协议污染，历史气泡本就显示路径不需要）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-agent-task-stuck-running
锚点：未记录
最近确认：4cc145d9dd4e9cebe7d743be0cb5d4c7ec5cf10e
理由：最大风险：前端 task_id 兜底把行吸收到**非派发段**（taskTaskId 撞车）。task_id 由 SDK harness 全局唯一生成（call id 亦然），且反查域限于单轮树，实际撞车概率趋零；即便撞车，后果仅是段元数据被终态覆盖（展示层），无数据损坏。 试过但放弃的方案：① backend 读侧把同名组 running 行也参与终态收敛——被 D-009@v1 裁决否决（同名多 running 是合法重试在途实例，会误杀），不动；② daemon 三无场景强行落行/emit——无 runId 载体（`onTurnMessage`/`_emitSessionEvent` 均必填 runId），强行造 run id 会产生脏轮，降级为 WARN 日志；③ 前端 upsertTurn 层按 task_id 跨轮路由——需在轮路由层解析行 content JSON（越层），且 2026-09-15 已有 parent_tool_use_id 跨轮路由覆盖「行落错轮」主场景，收益边际小、风险面大，不做；④ 修存量脏数据（迁移/清洗脚本）——项目未正式上线允许重置数据，且存量行经既有清扫（run 收口 60s / 启动清扫）→ stopped → 读侧去重收敛闭环，无需脚本。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-agentlog-write-diff
锚点：未记录
最近确认：e6cbde3e612c38d298b7c60ea5bcd22ff6b4a821
理由：最大风险：共享模块迁移（daemon/tool-args-detail → agent-log/tool-diff）破坏既有导入面。缓解：daemon 侧保留同名 re-export，既有测试（tool-args-detail.test.tsx 直接 import DiffView/parseStructuredPatch）零改动通过即证明。 放弃的方案：(a) agent-log 直接 import daemon/tool-args-detail 的 DiffView——会形成 tool-renderers ↔ tool-args-detail 循环依赖（后者已 import 前者的 CopyButton），放弃；(b) 同步接线 agent-log-card 会话化对话视图——其数据源是 daemon read_agent_log_messages（另一条链，daemon 侧需动 messages 解析），超出薄跑道范围，留后续变更；(c) Write 无 patch 时也整文件全绿（照搬会话面板行为）——本变更成功标准承诺零回归保持全文预览，且 agent-log 面已提供「原始数据」折叠兜底，不做双面不一致的行为扩散。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-change-files-view-polish
锚点：未记录
最近确认：b6df42cbc8653f688b25f861a5c203e191486d50
理由：最大风险：timeline.md/change.patch 是 sillyspec CLI 生成的固定格式，未来格式漂移导致解析不命中——两边都以「不命中回落既有渲染」兜底，漂移只降级不炸（与 knownJsonView 结构特征校验同一范式）。 试过但放弃的方案：按 emoji 前缀（🁢📄🔀⚠️📝✅）枚举给时间线节点逐类着色——emoji 集与 CLI 版本耦合，漂移即漏色；改为只识别「时刻开头行」的通用正则，emoji 随事件文本原样透传，节点统一品牌色圆点，不依赖枚举。

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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-editpatch-fullchain
锚点：未记录
最近确认：7b08406b35298e9620bb41056530a531114d5c60
理由：最大风险：响应体积——structuredPatch 大文件可达数十 KB，messages 窗口多条 patch 叠加膨胀。缓解：daemon 侧 64KB all-or-nothing 上限（残缺 JSON 无消费价值）+ 既有 200 段窗口/20MB 预算守门；超限走无 patch 回退不炸。 放弃的方案：(a) backend 用 extra="allow" 泛化透传 daemon 全部新字段——放宽契约面，字段漂移不可见，违背逐字对齐纪律，放弃（仍显式声明）；(b) edit_patch 附着到 tool_use 段——源数据在载体行（tool_result 侧），放 use 段要跨段回填，放弃；(c) 超限截断 JSON 而非整体丢弃——残缺 JSON 必然 parse 失败等价于丢弃但携带幻觉风险，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-editpatch-p3-cleanup
锚点：未记录
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128
理由：风险极低：判定收紧只会让更多超大 patch 走既有的无 patch 回退（前端 parseStructuredPatch 遇非法/超大本就回退全文/两块展示），不存在数据正确性风险；Buffer 在 daemon Node 运行时可用（同文件 20MB 预算先例）。 放弃的方案：(a) 把上限常量同步调大（如 256KB）——评审 P3 指向的是计量口径错误而非阈值大小，64KB 是上变更刚定的披露边界，无新证据不改阈值；(b) 用 TextEncoder 手算字节数——Buffer.byteLength 是同文件既有口径且更直接，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-load-earlier-full-turn
锚点：未记录
最近确认：a20ae3e3dea00f945697455f3c920858fcf01da5
理由：最大风险：摘窗口旧块的匹配键错误导致误摘（表现为内容丢失）——防护：匹配键取 `realRunId ?? stripPageKeySuffix(runId)`（与 upsertTurn / handleJumpToTurn 既有口径 同源），且只摘终态块（`TERMINAL_TURN_STATUSES` 闸），运行中轮（currentRunId 所在） 天然非终态不进集合。次风险：超长轮（>2000 行）被后端直达 ASC 上限截断丢最新段 ——采纳闸（评审 P2 修复）：直达行集未覆盖到当页该轮最新行即判定截断，该轮整体 降级现状分裂显示（内容零丢失），判定不依赖上限魔法数。试过放弃的 方案：① 续拉整页直到轮边界——多拉无关行、请求量翻倍且不解决显示分裂；② 装配层 跨块段合并（把已装配块的 segments 拼接）——段去重/prompt 归并/子代理重挂语义复杂， 触碰 SSE 共享装配器风险大；③ 探查改为「拉一页看首行」——多拉 400 行只为看一行， 浪费带宽。已裁决边界：limit=1 探查受后端 run 块序影响在交错 run 场景可能漏检页顶 切轮（假阴性，仅保持现状分裂显示，无内容丢失，可接受）；「回到会话开头」请求量约 增 1~2 倍（每页多探查/直达，显式重操作可接受）。

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

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-session-changefiles-archive-gate
锚点：未记录
最近确认：12c4cb4c9f30ce86631ca5388bd79f74ea20fe52
理由：最大风险：双条件口径若未来平台终态定义演进（如引入第四态），本 helper 需同步——缓解：helper 注释锚定三处同源文件（page.tsx/[cid]/page.tsx/mobile-change-detail.tsx），平台口径变更时 grep 可见。试过但放弃的方案：把判定改为依赖后端新增 computed 字段（如 `is_archived`）——需后端 schema 变更+gen:types，收益与前端两字段并集等价，成本不成比例（YAGNI）。已知边界：两套信号都未到平台时仍显示进行中——此为服务端同步面问题（需项目侧补推 progress 或平台 reparse 收敛），非本判定可解，已在用户反馈处置中说明。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-session-changefiles-select-fix
锚点：未记录
最近确认：bc898a68c4dac4dd9fba71daa57cb317429efc50
理由：最大风险：`closest('[role="dialog"]')` 依赖 radix DialogContent 的 `role="dialog"` 语义稳定——若未来 shadcn Dialog 实现变更（role 改名/自定义 DialogContent 包裹层），兜底回落 body 会静默退回旧 bug。缓解：既有 vitest 用例已加「下拉 DOM 必须在 `[role="dialog"]` 内」守护断言（`selectAntdOption` 内），实现变更会测试转红而非静默。试过但放弃的方案：①改用 shadcn `ui/dropdown-menu`（radix Dropdown）替代 antd Select——违背 FRONTEND_PAGE_STYLE「控件类继续 antd」且交互重写面大；②radix Dialog 改 `modal={false}`——牺牲遮罩/焦点管理语义，影响面远超本 bug；③把下拉挂到 Select 的 `parentElement`（DialogHeader）——头部容器层级/裁剪风险高于 `closest(role=dialog)`（DialogContent 是 radix 明确标记的可交互子树）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-session-scroll-layout-storm
锚点：未记录
最近确认：17abec741527b36896c20525f431558a43fa893a
理由：最大风险：rAF 合帧使钉回延迟至多一帧（16ms）——极端高惯性滚动下视口可能瞬时偏移一帧再被拉回，视觉上理论可感（单帧偏移 ≤ 一帧滚动量，watch interval 300ms 兜底跟进）；实测路径（webview 全场景回归）未观察到可感差异，Chrome 上的最终验证依赖用户复测（部署后由用户在原崩溃路径确认）。 试过但放弃的方案：① 删除钉回重申（anchorPinRef 机制）——回归 ql-20260916-019 修复的「未知写入者拉走视口」问题；② IntersectionObserver 重构 activeTurn 联动——联动已有 rAF 节流非风暴源，重构改动面大风险不成比例；③ 同时合并单页 4 份 useDaemonMachines 轮询——确认存在的独立问题，混入本变更扩大审查面，另立变更；④ 给 handleLoadEarlier 锚捕获段（全量行 rect 遍历）也做合帧——经核查它在 fetch await 之后、不在 scroll 事件栈内、每页至多一次，非反馈环成员，不动（禁止扩大改动面）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-session-taskwakeup-hide
锚点：未记录
最近确认：d3682fe53d3cdc5ef0cd710e03f3ecdb07461356
理由：最大风险是误伤用户手打的同前缀文本——该前缀由后端 TASK_WAKEUP 注入专属，用户消息不会以此开头，且既有 extract/strip 已按前缀特判多轮（2026-09-03 刷屏修复），风险口径与改前一致，不扩大。次要风险是共享文件混提交：session-log-assembler.ts / session-panel-page.tsx 工作区带有另一活跃变更（2026-10-13-subagent-stub-reconcile）的未提交 hunk，本次提交必须选择性暂存（仅暂存本变更 hunk），禁止整文件 add 裹挟。 试过但放弃的方案：①渲染侧过滤（turn-timeline / segment-view 对该前缀 return null）——需在每个渲染分支重复谓词、右栏详情面板易漏，且段数组仍被通知撑大，放弃；②后端不回传 TASK_WAKEUP user_input 日志——动协议面且丢失会话审计信息，超出小修复范围，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-sessions-portal-header-remove
锚点：未记录
最近确认：c7a48c2e1a9d161b1f79bdff052013cdc77fb317
理由：- 风险①：后续有人把 sr-only 改成 `hidden`/`display:none` 之类，标题会从可访问性树消失（等于删标题）——单测以 `toHaveClass("sr-only")` 锁形态。 - 风险②：高度链回归（有人给分栏行去 `flex-1`、或给标题块加回可见占位）——`sessions-portal-panes` 类名契约（flex-1 + min-h-0）与容器 `h-[calc(100vh-64px)]` 断言兜住。 - 风险③：workspace scope 顶部仍留一行 ≈26px 的紧凑 Git 条（保留功能件的代价，非回归）；用户若要求该 scope 也彻底全屏，属新诉求（可后续把 Git 条移入左栏头或折叠）。 - 放弃的方案：a) 整块删 PageHeader 且不留标题——丢无障碍一级标题 + 四处 scope 标题断言（回归面缩小）；b) Git 状态条一并删——未经要求的功能回归；c) Git 条塞进左栏面板头——左栏自有 📁/筛选控件，语义错位、改动面扩大；d) 用 `hidden` 隐藏标题——可访问性树同步丢失，即 a 的变体。 - 存量债风险：`page.test.tsx` 的 emoji token 断言修正属「测试跟随已交付实现」而非「改测试掩盖实现错误」——实现侧 token 形态由 2026-10-12-ws-ref-emoji-inline 交付且另有专门用例覆盖。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-slim-subagent-false-running
锚点：未记录
最近确认：e2f9ac59f5559975780f65378a7e491fd40307ec
理由：最大风险：回退键与行内解析键不一致造成错误合并——已用优先级消解（行内解析值恒优先；回退值仅当行内解析失败，此时行内无任何键可用，不存在二义）。次风险：孤儿 stub 误标把实时暂态 stub 变灰——标记只存在于 logsToSegments（历史批量）收尾，实时增量路径不经过该函数，结构性隔离。 放弃方案：① 前端对截断行按需拉全文再装配（getAgentSessionLogFull）——装配在 attach 同步路径上，逐条串行拉取拖慢秒开，且窗口翻页放大请求数；② 后端截断时保留 JSON 头部完整包络（截 args 保尾部）——需重排 daemon 落库格式，波及存量数据与 daemon 版本兼容，收益不成比例；③ 只做方案 C 不做 A——治标，配对仍断，子代理块状态/时长/任务徽标依旧缺失。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-subagent-stub-reconcile
锚点：未记录
最近确认：d8473ae21044785fe944065eaa431147d0b5a82e
理由：最大风险：对账把「真在跑」的 stub 误标终态——数据源是服务端权威行（清扫只会标 stopped 不会标 completed），误标面收敛为「快照行本身错误」，与任务清单页签同源同信，可接受。次风险：TurnRow memo 对新 prop 的比较——Map 以 useMemo 稳定引用，仅快照变化时重建，不破坏流式期间的 memo 收益。 试过但放弃的方案：① 装配器给 stub 补元数据槽并路由 [TASK_*] 行——窗口外行根本不在装配输入里，治不了根因，且动 stub 类型契约波及面大；② 时间线按 run 全量补拉日志（窗口截断的根治）——改分页架构，性能取舍（ql-20260916-013 有意为之）推翻成本高，收益仅此一处展示，不做；③ stub 徽章改中性文案「已结束(见任务清单)」——不解决名字问题且是降级不是修复；④ 后端给快照行补「是否关联时间线」之类新端点——现有 tool_use_id 关联键已够，零后端改动是本方案的显式优点。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-task-wakeup-remove
锚点：未记录
最近确认：3a61c468bef542e000e2a649bda6205eddaad508
理由：最大风险是产品语义回退：依赖自动唤醒续跑的多步后台工作流（主代理派发后台任务后结束本轮、等唤醒汇报）将停在空闲态，直到用户发下一条消息才继续——这是用户明确裁定的取舍（「没必要」，终态汇报轮的 token/轮次噪音 > 自动续跑便利），且与 2026-10-10 安静阈值（短任务不唤醒）同构，非全新形态。次要风险：若未来要恢复唤醒，需从 git 历史找回整链（机制代码彻底删除而非开关停用）——用户裁定没必要时彻底删优于留死开关（规则 18：注释与实现不一致是万恶之源）。 试过但放弃的方案：①backend inject 端点拒收 origin='task_wakeup'——动消费端防御面，backend 测试面大改且端点是通用能力；②加环境开关停用注入——留休眠代码与配置面，违反「彻底去掉」的用户意图；③仅前端隐藏（已完成于 2026-10-13-session-taskwakeup-hide）——汇报轮照跑照烧 token，治标不治本。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-turn-live-visibility
锚点：未记录
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128
理由：最大风险是共享文件混提交：turn-segment-views.tsx / session-panel-page.tsx 工作区带有进行中变更（2026-10-13-subagent-stub-reconcile、2026-10-13-session-taskwakeup-hide）的未提交 hunk，本变更提交必须选择性暂存（git add -p 仅取本变更 hunk），禁止整文件 add 裹挟。次要风险：①「running→终态对账提权」与 stub-reconcile 的「元数据>对账>段三态」优先级契约交叉——本变更只放宽 running 态方向（终态快照可收敛 running 元数据），契约在 subagentHeaderOf/reconcileTaskStatusForDisplay 注释双向写明；若其收口验证发现冲突，以并集语义（终态优先）收口。②daemon 提频的后端容量——最坏 2 条/s/call 的 usage_update 走既有落库+publish 批量管线，THINKING_FLUSH（字符/时间双节流）已是同量级先例；若后端观测到压力，时间门限 500ms→1000ms 单点可调。③dialog 旧宿主无 Provider——lookup null 路径全部回退既有推导（测试守卫）。 试过但放弃的方案：①前端按 tok/s 假插值补齐刷新（无真实增量的伪造数字，放弃）；②等待提示并入 TurnStatusBar 全局横幅（丢失时间线位置语义、与工具行信息重复，放弃）；③daemon 补发 [TASK_*] 终态行协议修复残留（动 daemon 协议面且 stub-reconcile 的快照对账已在同方向覆盖，放弃）；④段数据层收敛（turn-state reducer 把快照终态写回 segment.taskStatus）——侵入归并状态机、与装配器 [TASK_*] 路由双写打架，渲染层对账已覆盖全部消费面，放弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-turn-nav-initial-scroll
锚点：未记录
最近确认：ca86e918a7762cc0b88ec32abe61616ea3ed56dd
理由：最大风险：首挂载滚动在 flex 布局完成前执行的时序疑虑——useEffect 运行于 DOM commit 后，读取滚动几何会强制同步布局，且窄轨刻度高度固定（h-2.5/h-1.5）不受 markdown 异步撑高等影响，位置首挂载即最终位置，无竞态；jsdom 层以 scrollIntoView stub 断言调用事实（真实滚动行为由浏览器 block:"nearest" 标准语义担保）。 放弃的方案：① 首挂载改用 requestAnimationFrame 延帧滚动——刻度位置无异步依赖，延帧只增加闪跳窗口，无收益；② 在父层（session-panel-page）打开会话时显式触发滚轨——把组件内视觉态外泄到挂载方，破坏「受控纯组件、props 进回调出」契约（turn-catalog 先例约束）；③ 保留 mountedRef 但首渲用 useLayoutEffect 单独滚——双路径冗余，与既有 effect 维护同一语义却分两处，后续改联动易漏同步。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-turn-nav-rail-overflow-fix
锚点：未记录
最近确认：79968f77eb4ed6dc337f3c7fd2bd0bec5045acda
理由：最大风险：jsdom 无法断真实 flex 布局，契约测试只能断 className（若未来有人改回 shrink-0 而同时改 testid/类名结构，断言可能失守）——已用 `data-testid="turn-nav-rail"` 命中容器并把「无 shrink-0 + min-h-0」写成显式用例降低静默回归概率；真实视觉验收（50+ 轮会话）留人工确认项记入 visual-evidence.md。 放弃的方案：① 沿用 turn-catalog 结构把 nav 直接提为行的 stretch 子项——需重排把手/浮层 DOM 层级，改动面大于收益；② 提高密集阈值或按容器高度自适应刻度尺寸——只缓解不治本（溢出仍在），且引入测量逻辑复杂度；③ root 加 overflow-hidden 裁切——会连把手/浮层一起裁，且不可滚动更差。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-write-tool-diff
锚点：未记录
最近确认：757aad15b51c9a47acc9ce4bb23c680a88d6742e
理由：最大风险：无 patch 的覆盖写（非 claude provider）被整文件全绿展示，视觉上像新建文件。缓解：该分支标题保留「写入内容（N 行）」不称「新增文件」，复制按钮给完整原文兜底；claude 会话（主场景）覆盖写必有 patch、不受影响。 放弃的方案：(a) 嗅探 tool_result 文本（"File created successfully" vs "updated"）区分新建/覆盖——依赖各 provider 文案措辞，脆弱，放弃；(b) 同步接线 agent-log 变更运行日志视图——该视图 edit_patch 数据链未通（normalize 链需另动），超出薄跑道范围，留后续变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-ci-flaky-probe-mock
锚点：未记录
最近确认：0756c886494656426818263e03a6520f548b4185
理由：最大风险：探查返回空响应被组件判「页顶切轮」走直达整轮链路引入新调用。核对 0bd70bc47 语义：空响应 = 紧邻更早行不存在/同轮完整，不触发直达；同文件 105 行先例用例（3 次触顶翻页）已在此口径下稳定运行，本修复复用同一口径。 试过但放弃的方案： - 放宽断言为 `toBeLessThanOrEqual(3)`——否决：把竞速瞬态合法化，计数契约失真（翻页本体就是 2）。 - 修组件把探查与翻页在 tick 间去重——否决：探查是 0bd70bc47 有意设计且组件行为正确，生产代码零改动约束下不应动。 - 改用固定 waitFor 终态信号（入口消失）替代计数断言——部分吸收：保留原有后续断言（入口消失、scrollTop=0）不动，仅修计数口径，最小侵入。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-ci-flaky-render-anchor-sweep
锚点：未记录
最近确认：26bd59982827d1622c7b52e30f0c7ff7fa5a431c
理由：最大风险：waitFor 包裹后把「本应立即失败的断言」变成等满 1s 超时才失败，掩盖真实回归。已核对 6 处断言均为**应当出现的终态内容**（甄别阶段逐一读过组件 setState 路径），正常路径必渲染，超时仅发生在真回归——与既有正确写法先例同语义。 试过但放弃的方案： - 只修 CI 已暴露的个案、不做全量甄别——否决：本轮实证「每轮 CI 只暴露一个」，逐轮返工成本高于一次定向清扫。 - 放宽为 findByXxx 一把梭替换所有同步断言——否决：静态渲染内容的同步断言语义更清晰，只修确认脆弱的 6 处，零误报纪律。 - 全局 fake timers 消除时序——否决：侵入面大且与组件真实 rAF/interval 行为冲突，超出测试加固范围。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-ci-red-batch-fix
锚点：未记录
最近确认：ae2b08bd91813dbb3a7ede84d07b006e68ee85f6
理由：最大风险：seed 把 change_id 落 session 后误伤同文件其他用例。已核对调用面——gate_failover 仅一处调用传 `change_id=uuid.uuid4()`（即本次修复对象），其余缺省 None；cross 文件新参默认 None，多轮用例（run.change_id=None）判定路径不变；修复后已跑全文件用例验证。 试过但放弃的方案： - 放宽 `_apply_session_terminal_status` 兼容 run 级锚——否决：会复活 2fe772561 修复的生产误关会话事故（聊天轮被打轮级归因锚后每轮 completed 即误置 ended），方向性错误。 - CI 侧给 frontend vitest 加重试——否决：掩盖时序缺陷而非修复，且 CI 改动属生产配置，违背本变更零生产改动约束。 - 守卫测试直接删除字段集断言——否决：钉子测试的价值就在逐字段显式清单，补列即可。

## D-unmapped-008@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-decision-anchor-change-qualified
原编号：D-001@v1
锚点：未记录
最近确认：0ef23e479d8a39229486671e590a4d19864849d5
理由：- 最大风险：复合属性是新增 DOM 契约，若未来其它消费方按 `[data-entry-anchor=…]` 全量枚举做统计会少算复合锚——已核查现网消费方（知识库页 selectEntry、沉淀资产卡弹窗、测试断言）均为「按值查单个」，无枚举面。 - 弃案 A：改裸 `data-entry-anchor` 的值为复合形态——会破坏旧深链与潜在收藏链接，且 INDEX/触达等裸锚消费方需同步迁移，改动面大收益零，弃。 - 弃案 B：后端 assets 响应给 decisions 条目加变更号字段（前端免传 changeKey）——需改 OpenAPI schema + gen:types + 前端类型同步，而 changeKey 在详情页现成可得，后端改动纯属多余，弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-logout-full-reload-clear-cache
锚点：未记录
最近确认：534cef161623ee81046dd08d697300c005071294
理由：最大风险：整页跳转比 SPA 跳转多一次完整文档加载（HTML/JS 重取，浏览器缓存可摊薄），登出是低频操作且 401 被动登出长期就是这个行为，体验一致性与数据正确性优先，可接受。放弃方案 A：登出时 `queryClient.clear()` + 逐个 reset 内存 store——需要 app-shell 拿到 QueryClient 并枚举所有 store，覆盖面靠人工维护，未来新增 store 即漏（本次 bug 正是此类漏网），且组件内闭包/SSE 状态仍难穷尽；放弃方案 B：给全部 query key 加用户维度——改动面遍历全站 hook，且不解决非 QueryClient 的内存 store 串台，收益/成本倒挂。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-session-bottom-follow-insert
锚点：未记录
最近确认：b9f3550f3e859a50537ab6745b5d7f2ec0b0ff06
理由：最大风险：既有测试若显式断言「末轮不变长度变不滚动」会回归——已跑贴底/翻页/竞态/跳转 6 文件 77 例 + preview 三件套 27 例全绿，证实无此断言面。放弃方案：①延长/重启重申窗口至大纲到达——治标且时序敏感（大纲无到达信号）；②page 层 outline effect 主动滚底——绕开 TurnTimeline 守卫链（prepend 静默窗不知情），有上拉弹回回归风险。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-session-bottom-grace-window
锚点：未记录
最近确认：82b966f8f85f16b2318e56541359a0c067783802
理由：最大风险：非输入型让权路径（如浏览器自动滚动/读屏器）在窗内被拉回一次——真实用户四类输入覆盖 99% 场景，10s 窗口短且只在内容变化时动作。放弃方案：①继续追凶（19 轮 1 复现，取证成本失控，用户在等）；②near 被清后无限复活（用户真滚后内容更新会被反复拉回，破坏让权语义）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-session-bottom-no-restore
锚点：未记录
最近确认：812678ebe2b78513d1a1cd7c48511354eedff88c
理由：最大风险：用户期望「刷新回到上次阅读位置」的语义被改（现改为落底）——与产品贴底跟随设计及用户本次诉求（刷新应落底）一致，且切换会话本就落底，语义统一。放弃方案：①识别恢复写入并重新贴底（恢复事件 isTrusted=true 无法与用户滚动区分，只能加时序启发式，脆弱）；②挂载后延时强贴底（时序赌注，恢复时机无上界）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-session-bottom-passive-grow
锚点：未记录
最近确认：97ac876340cce7dfb62e36a3a316d7da5a290652
理由：最大风险：阈 50px/容差 4px 经验值——过大误吞用户小步上滚（距底仍 <80px 无影响），过小 markdown 抖动穿透（回退到上轮形态）。放弃方案：CSS overflow-anchor（浏览器原生锚定，但对 content-visibility 估算高度不稳定且不可控）；在 [turns] effect 内直接跟随不设守卫（上滚读历史被拉底，ql-20260822-010 既有回归）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-session-bottom-resize-observer
锚点：未记录
最近确认：b615f2f92d33a1089b4b5ffffeb8ce6853fdd8b2
理由：最大风险：RO 高频回调性能（流式期间每 delta 触发）——rAF 合帧后每帧至多一次 scrollTo（与既有流式贴底同频，无增量）；MarkdownText memo 使未变行不重排，实际回调频率远低于帧率。放弃方案：①延长重申窗——时序赌注，图片加载时长无上界；②监听 img load 事件——只覆盖图片一类，markdown 迟渲染/注入仍漏；③MutationObserver——语义错位（观察结构不观察尺寸，且更贵）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-session-bottom-switch-remount
锚点：未记录
最近确认：d3ece657c9e2186a5fd27ffd727561afb4cda3ac
理由：最大风险：重挂载一次性成本（切会话时全量行重建）——切会话本就全量重渲 turns，增量成本可忽略。放弃方案：①TurnTimeline 内加 sessionId prop + effect 手动重置各 refs——枚举 refs 易漏（本轮正是漏了 scrollBaselineRef 才升级到 key），新增 ref 又要记得加；②只重置 isNearBottomRef——治标，其余残留（lastSigRef/firstTurnKeyRef/baseline）仍有竞态面。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-session-preview-defect-fixes
锚点：未记录
最近确认：88de2e76e1d0c8b890b0d8812b4ec9057acfac48
理由：最大风险：把「有 prompt」放行后，某些只有噪音 user_input（如纯前导/系统注入行）的轮被误判有内容而展开空壳。已用真零正文集成用例锁定空串不放行；纯前导内容由 steerMatchKey 类既有归一口径消化，属可接受边界。放弃方案：在 logsToTurns 内全局改批次编号（跨批次状态维护复杂、动共享装配器影响 dialog/群聊全消费方，风险面大）——归并层盖章只影响 page 模式消息流，改面最小。

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

## D-unmapped-011@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-change-assets-graph
原编号：D-001@v1
锚点：未记录
最近确认：249bb1fd79725b47073e1b16827848f61df6503c
理由：- 风险一：在途变更（未注册图节点）neighbors 查询锚点未命中——可能形态为 available=false 或 data.nodes 空；双态都收敛到「整区隐藏」，实测时用归档变更核对。缓解：空 nodes 与 unavailable 同走隐藏分支，不出现半渲染。 - 风险二：资产卡测试既有 fixture 未 mock getKnowledgeGraphQuery——jsdom fetch 报错 → react-query error → 隐藏，既有用例不受扰；显式在新组件测试中 mock 全两态（可用/不可用）。 - 试过放弃：①把图谱分区做成弹窗（点「查看图谱」再开 Dialog）——用户原话是「图放卡片中」，弹窗多一步且复刻了被用户否掉的「点了看不到东西」反模式；②复用图谱页整页三栏（左表单/右结果 tab）——资产卡内只需要画布+节点详情两块，表单/图例属图谱页职责，嵌入会撑爆卡片。

## D-unmapped-009@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-15-ci-recurrence-guard
原编号：D-001@v1
锚点：未记录
最近确认：2c669d90e1853c52f575c56980410ab75fe55ee9
理由：最大风险：⑦ 三件套过度触发（如 ppm 区加菜单不改 permission.test.ts 的分区条目）——按既有口径走「确认不触及钉子断言则纳入评审说明」逃生门，fail-closed 优于 CI 补红。试过但放弃：把菜单数量锚改为从源常量推导（task-05 rejected）——推导锚等于断言与被测同源，钉子失去「源码长大必须显式跟」的契约语义，复发根因是本地缺拦截面而非锚形式，闸门⑦补齐已治本；另考虑过 pre-commit 阶段跑 typecheck（放弃：每次提交 1 分钟不可接受）。

## D-unmapped-010@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-graph-type-cluster
原编号：D-001@v1
锚点：未记录
最近确认：2fc26800908a29fc957f059032fbaff1678b793b
理由：- 风险一：增益过大会把同类压成重叠团、破坏边弹簧自然长（同类型配对收敛距离被压到自然长以下）。缓解：增益取小（与 CENTER_PULL 同数量级、略强），单测以「类内紧 + 类间分」双断言钉住平衡带，实测定值。 - 风险二：neighbors 切片的锚点节点被拉离画布中心。锚点受其类型簇牵引 + 全邻居弹簧拉向均值，形态为居中偏簇边，选中环与高亮交互不受影响，可接受。 - 试过放弃：①固定扇区锚（每类型钉画布固定方位）——需按类型数动态排布锚点、与向心力直接打架、实现面大，放弃；②仅按类型排序 seedSpiral 初始位——黄金角螺旋相邻索引角差约 137.5°，排序不产生视觉聚堆，且初始位不改变收敛终态，放弃。

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

## D-unmapped-014@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-session-status-dot-semantics
原编号：D-001@v1
锚点：未记录
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec
理由：最大风险：转圈信号取活性 working 依赖 agent 日志上报链路（无日志/未上报的会话活性缺失 → 非终态行留白，用户可能觉得「跑着的会话没转圈」）。缓解：活性链路是既有成熟机制（工作台总览卡同源），且终态红/绿点不依赖活性，最坏退化为留白而非错误标识。放弃的方案：a) status=active 即转圈——会让所有未结束聊天会话永久转圈（用户确认否掉）；b) 保留行尾灯只改行首点——两套点并存，语义打架的根源不除（用户确认移除并入）；c) 把完成通知做进 use-session-liveness hook——完成是会话 status 转移不是日志 state 转移，数据源不同，硬塞进 hook 会让 hook 依赖会话列表数据，耦合更差，故检测放面板层。
