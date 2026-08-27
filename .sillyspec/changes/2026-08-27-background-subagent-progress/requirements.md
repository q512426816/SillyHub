---
author: qinyi
created_at: 2026-08-27 09:25:00
change: 2026-08-27-background-subagent-progress
---

# Requirements · 后台异步子代理进度可视化

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话页观察后台异步子代理的真实状态、进度与时长，判断"还在跑/卡死/完成了" |
| daemon 运行时 | 消费 SDK task_* 生命周期消息与异步启动回执，发扩展 agent_task_status 事件 + 落 [TASK_*] 日志行 |
| backend | 事件 schema 扩展与 SSE 透传；子代理日志跨轮归位；空 prompt 拒绝 |
| 前端 | 卡片/目录/会话块全生命周期渲染，回放与实时同源 |

## 功能需求

### FR-01: daemon 消费 SDK 任务生命周期消息（D-001@v1）
Given interactive session 中 CLI 发出 `system` 消息 subtype 为 task_started / task_progress / task_notification
When daemon session-manager `_onMessage` 识别到上述 subtype
Then 注册/更新/注销会话级任务表，并发出对应 `agent_task_status` 事件：started→running（含 task_id/tool_use_id/task_name）；progress→running（含 last_tool_name/summary/elapsed_ms/total_tokens/tool_uses）；notification→completed|failed|stopped（含 summary/elapsed_ms）；task_updated 仅 status/is_backgrounded 变化时转发轻量事件。

### FR-02: 异步启动回执解析兜底（D-001@v1）
Given Task/Agent 工具的 tool_result 文本含 "Async agent launched successfully" 与 agentId（CLI 不发 task_* 的场景）
When daemon user tool_result 分支解析命中
Then 以该 tool_use_id 注册任务表并发出 `agent_task_status {status:'running', async:true, task_id:<agentId>, tool_use_id}`——前端据此不得将块判为已完成。

### FR-03: [TASK_*] 持久日志行（D-002@v1）
Given FR-01/02 的任一生命周期节点触发
When daemon 落库通道写入
Then 产生单行 JSON 的 `[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION]` stdout 日志行（行级带 parent_tool_use_id；[TASK_PROGRESS] 节流 ≥2s 合并；终态行不节流），刷新/历史回看可重建状态。

### FR-04: backend 事件 schema 扩展与透传（D-001@v1）
Given daemon 发出扩展字段的 agent_task_status
When backend `notify_agent_task_status` 接收并发布到 Redis `agent_session:{id}`
Then 新字段（status 终态值/tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async）全量透传；旧 daemon 仅发 running+task_id/task_name 时向后兼容不报错。

### FR-05: 子代理日志跨轮归位（D-003@v1）
Given submit_messages 收到带 parent_tool_use_id 的日志行，且该 tool_use 属于早前已完成的派发 run
When backend 落库
Then 行的 run_id 归写为派发 run（进程内 LRU + tool_call 行冷启动反查）；查不到映射时保持现状不报错；历史行不迁移。

### FR-06: 后台卡片全生命周期展示（D-005@v1）
Given 头部"后台"下拉中的 AgentTaskCard 处于 running
Then 显示"正在做什么"（last_tool_name+summary）、走秒计时（本地 tick + elapsed_ms 校准）、tokens/工具次数、最后活跃时间（>5 分钟无动静显示橙色"最后活跃 X 分钟前"）；收到终态事件后定格为 completed/failed/stopped（服务端 elapsed_ms 权威时长 + summary 摘要），不再永久转圈。

### FR-07: 子代理目录与会话块异步感知（D-005@v1）
Given 子代理块/目录行对应异步派发（async 标记或 [TASK_*] 元数据）
When tool_result（启动回执）到达
Then 块状态保持"后台运行中"且时长走秒（不判 done/不用往返差值）；终态由 TASK_NOTIFICATION 驱动显示服务端真实时长；前台（阻塞式）子代理状态推导路径不变（零回归）。

### FR-08: 空 prompt 注入防御（D-004@v1）
Given 调用方 POST /inject 且 prompt strip 后为空
When backend `inject_session` 处理
Then 返回 422（中文文案，不创建 AgentRun/不写 user_input 行）；前端发送按钮对空内容 disabled。

### FR-09: spike 验证 SDK 运行时发射（R-01）
Given 本地 daemon + 后台 Agent 会话
When session-manager 记录 task_* 到达情况
Then 验证结论（发/不发、task_progress 频率）回填 design.md §10，确定兜底路径权重与节流参数。

## 非功能需求

- **NFR-01 兼容**：Windows/Linux/macOS 三端可跑（CLAUDE.md 规则 13）；旧日志（无 [TASK_*] 前缀）渲染零回归。
- **NFR-02 主题**：新 UI 元素取色走 brand-* 语义阶，三主题（blue/ai-native/dark）适配（CLAUDE.md 规则 20 铁律）。
- **NFR-03 类型**：后端 schema 改动同变更内重生成 api-types.ts + openapi.json 提交（CLAUDE.md 规则 21）。

## 决策覆盖核对

D-001@v1→FR-01/02/04；D-002@v1→FR-03；D-003@v1→FR-05；D-004@v1→FR-08；D-005@v1→FR-06/07 + NFR-02。全部当前版本决策已覆盖，无剩余风险。
