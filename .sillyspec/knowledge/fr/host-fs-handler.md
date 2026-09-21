## FR-host-fs-handler-001 会话样式回放主体
变更：2026-09-19-tool-report-session-replay
状态：superseded
superseded_by：FR-host-fs-handler-005
取代链：FR-host-fs-handler-001 ← FR-host-fs-handler-005（2026-09-20-agent-log-session-replay 承接）
退役理由：主体由日志元数据卡列表改为会话时间线直适配并纳入 token 与系统事件语义
摘要：纯 tool_report 会话打开；主/子日志结构；轮次切分；分页
全文：.sillyspec/changes/archive/2026-09-19-tool-report-session-replay/requirements.md#FR-01
最近确认：3e703c193

## FR-host-fs-handler-002 跨 harness 归一化与解析器矩阵
变更：2026-09-19-tool-report-session-replay
状态：active
摘要：伪用户消息归一；claude-code 对话化；cursor-agent 对话化（上报落地后生效）；cursor IDE 二进制
场景正文：
- 场景：伪用户消息归一 — Given user 角色消息为系统注入（zcode task-notification/system-reminder、claude-code；When 解析与渲染；Then 归一为 system_event（中性行）或工具段；仅真人输入渲染用户气泡
- 场景：claude-code 对话化 — Given format=claude-code-jsonl 的日志条目；When 读取 messages；Then status=parsed 且产出对话化消息（含 thinking/text/tool_use/tool_result 配对与
- 场景：cursor-agent 对话化（上报落地后生效） — Given format=cursor-agent-transcript-jsonl 的日志条目；When 读取 messages；Then status=parsed，按 turn_ended 切轮，token 字段缺省（显示「未知」）
- 场景：cursor IDE 二进制 — Given format 含 sqlite（cursor IDE store.db）；When 用户尝试查看；Then 显式中文说明（不支持对话化、仅元数据），不再是无解释的 409 死胡同
全文：.sillyspec/changes/archive/2026-09-19-tool-report-session-replay/requirements.md#FR-02
最近确认：53c67e02a

## FR-host-fs-handler-003 token 链路四层打通
变更：2026-09-19-tool-report-session-replay
状态：active
摘要：zcode/claude-code token 展示；无 token 数据源；老 daemon 兼容
场景正文：
- 场景：zcode/claude-code token 展示 — Given 日志含 usage（zcode response.usage / claude-code message.usage）；When 回放渲染；Then 每轮显示 inputTokens/outputTokens（ctx=该轮末次 inputTokens），会话显示累计
- 场景：无 token 数据源 — Given 数据源不落盘 token（cursor-agent）或 sqlite 库缺 usage（R-01 核对结果为缺）；When 回放渲染；Then token 显示「未知」，不显示 0、不伪造
- 场景：老 daemon 兼容 — Given daemon 为旧版本（messages 不含新字段 / 422 无方法）；When 前端读取；Then 字段缺省走「未知」/既有回落（黄条+原文），不报错
全文：.sillyspec/changes/archive/2026-09-19-tool-report-session-replay/requirements.md#FR-03
最近确认：53c67e02a

## FR-host-fs-handler-004 不可用态显式化
变更：2026-09-19-tool-report-session-replay
状态：superseded
superseded_by：FR-host-fs-handler-008
取代链：FR-host-fs-handler-004 ← FR-host-fs-handler-008（2026-09-20-agent-log-session-replay 承接）
退役理由：回落收口到回放主体内逐条目独立处理并补离线元数据态
摘要：机器离线；格式不支持 / 文件缺失
全文：.sillyspec/changes/archive/2026-09-19-tool-report-session-replay/requirements.md#FR-04
最近确认：3e703c193

## FR-host-fs-handler-005 回放主体按会话样式渲染（TurnTimeline 直适配）
变更：2026-09-20-agent-log-session-replay
状态：active
摘要：默认场景；主/子日志结构；多个主日志；dialog 形态；首屏落点与分页
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given origin=tool_report 且 turn_count===0 的会话，本机存在已上报的 agent 日志；When 用户在会话面板（page 形态或 dialog 形态）打开该会话；Then 会话主体为 TurnTimeline 渲染的对话流（用户气泡/答复正文/思考折叠/工具卡片/轮徽标），非元数据卡列表
- 场景：主/子日志结构 — Given 会话挂多条日志，其中含 session_id 或 log_path 带 subagent 标识的子代理日志；When 打开回放；Then 正文=按 first_seen_at 最新的**主日志**对话流；子代理日志以顶部「工作会话（N）」入口呈现，点击可在回放中查看其自身对话并可返回；子代理日志不
- 场景：多个主日志 — Given 同一会话挂多条主日志（多次本地 CLI 主会话）；When 打开回放；Then 默认展示最新主日志，其余以「更早的本地会话」入口切换
- 场景：dialog 形态 — Given dialog（悬浮窗）形态打开同类会话；When 渲染；Then 同样挂载回放主体（现状为空时间线，一并修复），分支判定经 getAgentSession 轻查询取 origin/turn_count
- 场景：首屏落点与分页 — Given 主日志总段数超过单窗口（200 段）；When 打开回放；Then 首屏顺序翻页至最早可得窗口（上限 10 页，超限停驻并提示）正序渲染；顶部「加载更早」按 beforeSeq 前插
全文：.sillyspec/changes/archive/2026-09-20-agent-log-session-replay/requirements.md#FR-01
最近确认：3e703c193

## FR-host-fs-handler-006 系统事件归一化与多 harness 解析器矩阵
变更：2026-09-20-agent-log-session-replay
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 消息流含系统注入内容（zcode `<task-notification>`/`<system-reminder>` 前缀文本、claude-code is_m；When 适配层构建轮次 走 read_agent_log_messages（format=claude-code-jsonl） 走 read_agent_log_mes；Then 系统注入内容渲染为该轮 processItems 首项 stderr 样式条目（⚙ 前缀，不占用户气泡），对话视图隐藏、全部视图可见；只有真人输入配用户气泡 解
全文：.sillyspec/changes/archive/2026-09-20-agent-log-session-replay/requirements.md#FR-02
最近确认：3e703c193

## FR-host-fs-handler-007 token 与轮次数据四层打通
变更：2026-09-20-agent-log-session-replay
状态：active
摘要：默认场景；轮 token 展示；无 token 数据源；轮次切分双保险
场景正文：
- 场景：默认场景 — Given zcode 日志每次 API 调用含 response.usage 五项与顶层 turnId/model.modelId claude-code usage（A；When 解析 解析；Then 消息段携带 usage（input_tokens/output_tokens/cache_read_tokens/cache_write_tokens 全量口径
- 场景：轮 token 展示 — When 回放渲染；Then 轮徽标=轮内 usage 求和（inputTokens/outputTokens）；上下文环取轮末次调用 usage.input_tokens；顶部用量汇总条=
- 场景：无 token 数据源 — Given cursor-agent transcript 或老 daemon（无新字段）或 sqlite 路径实证不可得；When 渲染；Then 徽标/汇总条显示「未知」，不报错不假数据
- 场景：轮次切分双保险 — Given 消息流含 turn_id 变化或 turn_end 标记或真人 user_input；When 适配层切轮；Then 三者任一触发新轮；无 turn_id 的老数据退化为真人 user_input 单保险
全文：.sillyspec/changes/archive/2026-09-20-agent-log-session-replay/requirements.md#FR-03
最近确认：3e703c193

## FR-host-fs-handler-008 不可用态显式化与回落
变更：2026-09-20-agent-log-session-replay
状态：active
摘要：默认场景；机器离线
场景正文：
- 场景：默认场景 — Given 解析分层失败（unsupported/parse_error/too_large）或 HTTP 失败（422 老 daemon/409 二进制/404/5xx）；When 读取消息；Then 该条目回落原文 <pre>（尾部 256KB）+ 黄条原因，不弹错框；仅原文端点自身失败保留红条
- 场景：机器离线 — Given 上报机器 daemon 不在线；When 打开回放；Then 主体显示离线提示 + 可复制元数据（harness/短码/路径），不白屏不假加载
全文：.sillyspec/changes/archive/2026-09-20-agent-log-session-replay/requirements.md#FR-04
最近确认：3e703c193

## FR-host-fs-handler-009 zcode 日志对话化渲染
变更：2026-08-23-agent-log-conversation-view
状态：active
摘要：默认场景
依据决策：D-002@v1、D-004@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 本地 Agent 会话下一条 `format=zcode-model-io-jsonl` 的日志条目 日志内容含 role=system 消息、request.；When 用户点击「查看内容 ▾」 解析产出消息段；Then 面板以对话流渲染：user_input 用户气泡、reply 走 Markdown、thinking 折叠块、 以上内容一律不进入 NormalizedLogM
全文：.sillyspec/changes/archive/2026-08-23-agent-log-conversation-view/requirements.md#FR-01
最近确认：f7f73d86c

## FR-host-fs-handler-010 daemon 本地解析与 KB 级传输
变更：2026-08-23-agent-log-conversation-view
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given zcode 日志文件存在于 daemon 宿主机且在 allowed_roots 白名单内；When backend 经 ws rpc 调 `host_fs.read_agent_log_messages {path, format}`；Then daemon 本地全量读文件（预算 20MB 上限）、按绝对 offset 对齐合并
全文：.sillyspec/changes/archive/2026-08-23-agent-log-conversation-view/requirements.md#FR-02
最近确认：f7f73d86c

## FR-host-fs-handler-011 失败回落与兼容
变更：2026-08-23-agent-log-conversation-view
状态：active
摘要：默认场景
依据决策：D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 任一情形：format 无解析器（unsupported）/ 解析失败（parse_error）/ 文件超；When 前端请求 messages 端点；Then 一律静默回落现有原文 `<pre>` 查看或沿用既有错误文案，不弹错误框；
全文：.sillyspec/changes/archive/2026-08-23-agent-log-conversation-view/requirements.md#FR-03
最近确认：f7f73d86c

## FR-host-fs-handler-012 二进制格式维持拦截
变更：2026-08-23-agent-log-conversation-view
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given format 含 sqlite/zstd 的日志条目；When 请求 messages 端点；Then 维持既有 409「二进制暂不支持」语义（复用共享 helper 黑名单）
全文：.sillyspec/changes/archive/2026-08-23-agent-log-conversation-view/requirements.md#FR-04
最近确认：f7f73d86c

## FR-host-fs-handler-013 段窗口与加载更早
变更：2026-08-23-agent-log-conversation-view
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 会话段数超过 200；When 请求 messages 端点 用户点「加载更早」带 before_seq 再请求；Then 返回最近 200 段 + truncated=true + total_segments； daemon 无状态重解析按 seq 切片返回更早窗口（seq 不连
全文：.sillyspec/changes/archive/2026-08-23-agent-log-conversation-view/requirements.md#FR-05
最近确认：f7f73d86c
