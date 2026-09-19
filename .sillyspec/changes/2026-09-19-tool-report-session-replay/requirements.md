---
author: qinyi
created_at: 2026-09-19 20:55:00
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在 SillyHub 前端查看 SillySpec CLI 自动上报会话的回放、token 用量 |
| 开发者 | 维护 daemon 解析器矩阵 / 平台 schema / 前端回放组件 |

## 功能需求

### FR-01: 会话样式回放主体
覆盖决策：D-001@v1, D-002@v1, D-005@v1, D-008@v1

#### 场景：纯 tool_report 会话打开
Given 会话 origin=tool_report 且 turn_count===0，挂有日志条目
When 用户打开该会话
Then 主体渲染为会话时间线（TurnTimeline：对话/全部视图、轮次导航），数据源为主日志
的对话化消息；不再显示日志元数据卡列表

#### 场景：主/子日志结构
Given 会话挂 1 条主日志 + N 条 `subagent_agent_` 前缀子代理日志（或多条主日志）
When 渲染回放
Then 主日志（最新一条）为正文；子代理与更早主日志收进「工作会话（N）」折叠条，
条目点击进入该日志的回放（同组件）

#### 场景：轮次切分
Given 消息带 turn_id（zcode turnId / cursor turn_ended / claude-code 真人 user 边界）
When 构造回放轮次
Then 按 turn_id 变化或真人 user_input 切轮；轮起点有真人文本显示原文，系统触发
轮显示系统事件标记；不伪造 CLI 命令文本

#### 场景：分页
Given 日志段数超过单窗口（200 段）
When 用户触顶
Then 「加载更早」按 beforeSeq 前插更早一页，滚动位置不跳动

### FR-02: 跨 harness 归一化与解析器矩阵
覆盖决策：D-003@v1, D-006@v1

#### 场景：伪用户消息归一
Given user 角色消息为系统注入（zcode task-notification/system-reminder、claude-code
isMeta/注入前缀/纯 tool_result 载体行）
When 解析与渲染
Then 归一为 system_event（中性行）或工具段；仅真人输入渲染用户气泡

#### 场景：claude-code 对话化
Given format=claude-code-jsonl 的日志条目
When 读取 messages
Then status=parsed 且产出对话化消息（含 thinking/text/tool_use/tool_result 配对与
usage），不再 unsupported 回落原文

#### 场景：cursor-agent 对话化（上报落地后生效）
Given format=cursor-agent-transcript-jsonl 的日志条目
When 读取 messages
Then status=parsed，按 turn_ended 切轮，token 字段缺省（显示「未知」）

#### 场景：cursor IDE 二进制
Given format 含 sqlite（cursor IDE store.db）
When 用户尝试查看
Then 显式中文说明（不支持对话化、仅元数据），不再是无解释的 409 死胡同

### FR-03: token 链路四层打通
覆盖决策：D-004@v1, D-005@v1

#### 场景：zcode/claude-code token 展示
Given 日志含 usage（zcode response.usage / claude-code message.usage）
When 回放渲染
Then 每轮显示 inputTokens/outputTokens（ctx=该轮末次 inputTokens），会话显示累计
（daemon 返回 totalUsage，前端不求和）

#### 场景：无 token 数据源
Given 数据源不落盘 token（cursor-agent）或 sqlite 库缺 usage（R-01 核对结果为缺）
When 回放渲染
Then token 显示「未知」，不显示 0、不伪造

#### 场景：老 daemon 兼容
Given daemon 为旧版本（messages 不含新字段 / 422 无方法）
When 前端读取
Then 字段缺省走「未知」/既有回落（黄条+原文），不报错

### FR-04: 不可用态显式化
覆盖决策：D-007@v1

#### 场景：机器离线
Given 上报机器 daemon 不在线
When 打开回放
Then 显示「机器离线，无法读取日志内容」类提示 + 元数据（harness/大小/调用数/时间）可见

#### 场景：格式不支持 / 文件缺失
Given unsupported / 409 / not_found
When 打开回放
Then 对应中文提示行，元数据保留可见，不弹错框

## 非功能需求
- 兼容性：老 daemon 可选字段缺省；activated 路径与 chat 会话零改动；上报/归属链路零改动
- 可回退：AgentReplayBody 挂载为单分支，revert 单提交粒度可回退
- 可测试：适配器/解析器均为纯函数，用真实日志脱敏 fixture 单测；组件测试覆盖三态

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 主体=TurnTimeline 真组件复用（适配器映射 SessionTurnView） |
| D-002@v1 | FR-01 | 主/子日志结构（subagent_agent_ 前缀分类） |
| D-003@v1 | FR-02 | 伪用户消息归一化通则（sender=system_event） |
| D-004@v1 | FR-03 | token 四层打通 + totalUsage 由 daemon 返回 |
| D-005@v1 | FR-01, FR-03 | 轮次边界（turnId/turn_ended/user） |
| D-006@v1 | FR-02 | 解析器矩阵与 cursor IDE 降级 |
| D-007@v1 | FR-04 | L3 不做、不可用态显式化 |
| D-008@v1 | FR-01~FR-04 | 方案 A 适配复用 |
