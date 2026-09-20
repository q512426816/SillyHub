---
author: qinyi
created_at: 2026-09-20 09:36:39
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在 Web 会话面板查看 SillySpec CLI 自动上报的本地 Agent 会话回放 |
| 平台开发者 | 维护 daemon 解析器矩阵 / 平台 schema / 前端回放组件 |

## 功能需求

### FR-01: 回放主体按会话样式渲染（TurnTimeline 直适配）
覆盖决策：D-001@v1
承接: FR-host-fs-handler-001（退役理由：主体由日志元数据卡列表改为会话时间线直适配并纳入 token 与系统事件语义）
Given origin=tool_report 且 turn_count===0 的会话，本机存在已上报的 agent 日志
When 用户在会话面板（page 形态或 dialog 形态）打开该会话
Then 会话主体为 TurnTimeline 渲染的对话流（用户气泡/答复正文/思考折叠/工具卡片/轮徽标），非元数据卡列表

#### 场景：主/子日志结构
Given 会话挂多条日志，其中含 session_id 或 log_path 带 subagent 标识的子代理日志
When 打开回放
Then 正文=按 first_seen_at 最新的**主日志**对话流；子代理日志以顶部「工作会话（N）」入口呈现，点击可在回放中查看其自身对话并可返回；子代理日志不并入正文

#### 场景：多个主日志
Given 同一会话挂多条主日志（多次本地 CLI 主会话）
When 打开回放
Then 默认展示最新主日志，其余以「更早的本地会话」入口切换

#### 场景：dialog 形态
Given dialog（悬浮窗）形态打开同类会话
When 渲染
Then 同样挂载回放主体（现状为空时间线，一并修复），分支判定经 getAgentSession 轻查询取 origin/turn_count

#### 场景：首屏落点与分页
Given 主日志总段数超过单窗口（200 段）
When 打开回放
Then 首屏顺序翻页至最早可得窗口（上限 10 页，超限停驻并提示）正序渲染；顶部「加载更早」按 beforeSeq 前插

### FR-02: 系统事件归一化与多 harness 解析器矩阵
承接: FR-host-fs-handler-002（退役理由：归一化语义统一收口到 stderr 样式系统事件原语，且扩展至 claude-code/cursor-agent 两家新解析器）
Given 消息流含系统注入内容（zcode `<task-notification>`/`<system-reminder>` 前缀文本、claude-code is_meta=true 文本）
When 适配层构建轮次
Then 系统注入内容渲染为该轮 processItems 首项 stderr 样式条目（⚙ 前缀，不占用户气泡），对话视图隐藏、全部视图可见；只有真人输入配用户气泡

Given claude-code-jsonl 格式日志（type=user/assistant 行、content 块 text/thinking/tool_use、tool_result 载体 user 行、isMeta 行、usage 含 cache 四项）
When 走 read_agent_log_messages（format=claude-code-jsonl）
Then 解析为 NormalizedLogMessage 对话流：纯 tool_result 块 user 行→tool_result 段、isMeta 文本段置 is_meta 位、真人文本→user_input；status=parsed 且预算/窗口/beforeSeq 语义与 zcode 解析器一致

Given cursor-agent transcript（{role,message} 行 + turn_ended 事件）
When 走 read_agent_log_messages（format=cursor-agent-transcript）
Then 解析为对话流并按 turn_ended 标记轮边界（turn_end 位）；usage/totalUsage 恒缺省

### FR-03: token 与轮次数据四层打通
承接: FR-host-fs-handler-003（退役理由：字段全量口径统一（input 含缓存命中/写入）并扩展 claude-code 归一，daemon 内层 snake_case 直通替代逐字段映射）
Given zcode 日志每次 API 调用含 response.usage 五项与顶层 turnId/model.modelId
When 解析
Then 消息段携带 usage（input_tokens/output_tokens/cache_read_tokens/cache_write_tokens 全量口径）、turn_id、model；解析结果携带 totalUsage 全会话累计；RPC → 平台 schema（messages 内层零改名、外层仅 totalUsage→totals）→ OpenAPI → api-types → 前端逐跳透传

Given claude-code usage（Anthropic 惯例 input 不含缓存）
When 解析
Then 归一为全量口径 input_tokens = input + cache_read_input_tokens + cache_creation_input_tokens（zcode 原生已满足不重算）

#### 场景：轮 token 展示
When 回放渲染
Then 轮徽标=轮内 usage 求和（inputTokens/outputTokens）；上下文环取轮末次调用 usage.input_tokens；顶部用量汇总条=totals（输入/输出/缓存命中/模型）

#### 场景：无 token 数据源
Given cursor-agent transcript 或老 daemon（无新字段）或 sqlite 路径实证不可得
When 渲染
Then 徽标/汇总条显示「未知」，不报错不假数据

#### 场景：轮次切分双保险
Given 消息流含 turn_id 变化或 turn_end 标记或真人 user_input
When 适配层切轮
Then 三者任一触发新轮；无 turn_id 的老数据退化为真人 user_input 单保险

### FR-04: 不可用态显式化与回落
承接: FR-host-fs-handler-004（退役理由：回落收口到回放主体内逐条目独立处理并补离线元数据态）
Given 解析分层失败（unsupported/parse_error/too_large）或 HTTP 失败（422 老 daemon/409 二进制/404/5xx）
When 读取消息
Then 该条目回落原文 <pre>（尾部 256KB）+ 黄条原因，不弹错框；仅原文端点自身失败保留红条

#### 场景：机器离线
Given 上报机器 daemon 不在线
When 打开回放
Then 主体显示离线提示 + 可复制元数据（harness/短码/路径），不白屏不假加载

## 非功能需求
- 兼容性：老 daemon（无新字段/无 messages RPC）、老数据（无 turn_id/usage）、已激活 tool_report 会话、普通会话、群聊——行为与现状逐条一致（design §3.4 兼容矩阵）；
- 双主题铁律：新顶部条/浮层/徽标用 brand-* 语义阶与主题 token，不硬编码 hex；
- 可回退：回放主体组件整体可摘除（挂载点单点替换），解析器新字段全可选不影响既有消费方；
- 可测试：适配层/解析器纯函数单测（fixture=实证消息形状），组件 smoke 覆盖 page+dialog 两分支与回落/离线态；
- 工程：代码全在 replay-redo worktree；gen:types 需 PYTHONPATH=<worktree>/backend；api-types.ts/openapi.json 随变更提交。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 方案 A：TurnTimeline 直适配（用户亲选；B/C 否决） |
