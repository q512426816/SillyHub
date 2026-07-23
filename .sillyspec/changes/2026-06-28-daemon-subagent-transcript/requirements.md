---
author: qinyi
created_at: 2026-06-28 12:31:26
change: 2026-06-28-daemon-subagent-transcript
---

# Requirements · daemon 子代理日志可见性

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在前端 agent session 观察主 agent 执行过程，需要看到子代理活动以理解 agent 决策链路 |
| daemon 运行时 | 连本地 Claude Agent SDK，负责把子代理消息（含归属）透传给 backend |
| backend | 落库 `agent_run_logs`（带归属列），SSE 推前端 |
| 前端 | 渲染日志行，按归属 + depth 展示子代理徽标与层级 |

## 功能需求

### FR-01: 开启子代理 text/thinking 流出（Claude SDK）
覆盖决策：D-001@v1, D-006@v1
Given 主 agent 在 Claude interactive session 中调用 Task/Agent tool 派生子代理
When `ClaudeSdkDriver.start()` 设置 `options.forwardSubagentText = true`
Then 子代理的 text/thinking 作为带 `parent_tool_use_id` 的 assistant/user message 经主流 query generator 流入 daemon consume（心跳级 tool_use/tool_result 默认就有）

### FR-02: 子代理消息归属识别与原样透传
覆盖决策：D-001@v1, D-008@v1
Given daemon consume 收到一条带 `parent_tool_use_id` 非空的 SDK message（assistant 或 user）
When `_onMessage` 处理并经 `onTurnMessage` 转发
Then msg 顶层保留 `parent_tool_use_id`/`subagent_type`/`task_description`（原样，不剥离），backend `submit_messages` 收到完整归属字段

### FR-03: partial buffer 按 parent_tool_use_id 分桶隔离
覆盖决策：D-002@v1
Given 主 agent 与一个或多个子代理在同一 interactive session 并发产出 partial（streaming delta）
When `_bufferPartial` / `_clearPartialBufferSync` / `_flushPartial` / `_emitOverrideSignals` 处理 partial
Then 各自按 `parentKey = parent_tool_use_id ?? 'main'` 独立分桶；子代理完整 assistant message 只清自己的桶，不误清主 agent partial；segmentId 带 parent 前缀 `${parentKey}:${messageId}:${blockIndex}` 不撞 id

边界：主 agent 单代理场景（无子代理）走 'main' 桶，行为与现状逐字节等价（R-02 回归）。

### FR-04: agentSessionId 不被子代理 init 覆盖
覆盖决策：D-003@v1
Given 主 session 已写入 `agentSessionId`（主 system/init 先到），随后子代理 system/init 到达
When `_onMessage` 处理子代理 system/init
Then 直接跳过（`parent_tool_use_id` 非空守卫 + 现有 `===undefined` 守卫），主 session resume key 不被覆盖

### FR-05: depth 维护与透传
覆盖决策：D-007@v1
Given `SessionState.subagentDepth: Map<tool_use_id, depth>`
When `_onMessage` 处理 assistant message（含 tool_use blocks）与子代理消息
Then 预登记 `subagentDepth[tool_use.id] = msgDepth + 1`；子代理消息按其 `parent_tool_use_id` 查得 depth 注入 `msg.depth` 顶层；主 agent depth=0；退化（查不到）→ depth=1 并 warn（R-04）

边界：多层嵌套——子(depth1)发 tool_use spawn 孙代理 → 孙 depth=2。

### FR-06: agent_run_logs 加归属列 + migration
覆盖决策：D-004@v1
Given `agent_run_logs` 表（现有无归属列）
When 执行 alembic migration
Then 加 `parent_tool_use_id VARCHAR(200) NULL` / `subagent_type VARCHAR(100) NULL` / `depth INTEGER NULL` + 索引 `ix_agent_run_logs_parent`；revision id 唯一、`down_revision` 接当时真实 head；up + down 可逆；ORM `AgentRunLog` + `AgentRunLogEntry`/Read DTO 加三 nullable 字段（R-01）

### FR-07: _extract_sdk_messages 每条注入归属 + 落库
覆盖决策：D-008@v1
Given backend 收到 daemon 透传的 SDK message（带 parent_tool_use_id/subagent_type/depth）
When `_extract_sdk_messages` 展开为 flat records 且 `submit_messages` 落库
Then **每条** flat record 都带 parent_tool_use_id/subagent_type/depth（非首条 stamp，D-008）；落库 `AgentRunLog` 写三列；usage/session_id 仍走 stamp 首条

边界：同一 SDK message 多 block（text+thinking+tool_use）展开的多行 log 全部带相同归属。

### FR-08: 前端徽标 + 深度渲染
覆盖决策：D-005@v1
Given 前端收到带归属列的 `agent_run_logs` 行
When `agent-log-viewer` / `logsToTurns` 渲染
Then `subagent_type` 非空 → 行首渲染 `[子代理:<subagent_type>]` 徽标（中文）；`depth > 0` → 按 depth 缩进 + 深度标记；同 `parent_tool_use_id` 连续行视觉归组；主 agent 行（parent=null/depth=0）渲染不变；本期不实现折叠交互

### FR-09: 向后兼容
覆盖决策：D-004@v1, D-005@v1
Given 历史 `agent_run_logs` 行（归属列 NULL）或未升级 daemon 的旧路径（msg 无归属字段）
When 前端渲染
Then 按 main agent 渲染（parent=null/depth=NULL→0），行为与现状一致

## 非功能需求

- **兼容性**：历史日志 + 旧 daemon 路径 + 未升级前端，均退化为现状行为（FR-09）。
- **可回退**：migration down（drop 三列+索引）；driver `forwardSubagentText` 可独立关闭回退到心跳级。
- **可测试**：每个 FR 有 GWT 行为规格；R-01/R-02 两个 P0 风险有专项测试。
- **跨平台**：daemon/backend/前端改动无平台相关代码（CLAUDE.md 规则 12）。
- **性能**：partial 已 500ms 节流；`forwardSubagentText` 增量消息受节流控制（R-03）。
- **日志字节兼容**：`_extract_sdk_messages` 与 task-runner `_eventToMessages` 规则一致（interactive 与 batch 日志格式同构，虽 batch 路径本期不改 N6）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | 归属字段来源（assistant+user 均带） |
| D-002@v1 | FR-03 | partial 按 parent 分桶 |
| D-003@v1 | FR-04 | agentSessionId 守卫 |
| D-004@v1 | FR-06, FR-09 | 归属承载=新增列（方案 B） |
| D-005@v1 | FR-08, FR-09 | 分阶段展示（平铺带标签） |
| D-006@v1 | FR-01 | 只 Claude |
| D-007@v1 | FR-05 | daemon 维护 depth |
| D-008@v1 | FR-02, FR-07 | 归属每条注入（Grill X-001） |
