---
author: qinyi
created_at: 2026-09-03 23:46:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台开发者 | 接入新 agent CLI 的开发人员（本变更主要受益者） |
| 会话用户 | 通过前端会话面板与 agent 交互的最终用户（验收基准=Claude 体验零变化） |
| daemon | 执行边缘节点（归一化新落点） |
| backend | 编排/持久化中心（双轨接收） |

## 功能需求

### FR-01: AgentEvent v2 统一事件契约
覆盖决策：D-001@v1

Given `sillyhub-daemon/src/types.ts` 现有 5 型 AgentEvent（text/tool_use/tool_result/error/complete）
When 扩展类型联合（+thinking/status/turn_result）与一等可选字段（subtype/seq/tool_name/call_id/session_id/usage/parent_tool_use_id/subagent_type/depth/segment_id/is_partial/override/edit_patch）
Then 类型与 zod schema（独立文件 agent-event-schema.ts）一致，批量 adapter 现有 5 型用法零破坏，交互式与批量共用一份 IR

Given 一条待上报的事件
When 序列化为 `{"kind":"agent_event","event":{...},"dedup_key":...}` 消息 dict
Then 可与现有消息 dict 共存于 `LeaseMessagesRequest.messages`（list[dict]）同一数组，OpenAPI schema 零变化

### FR-02: Claude 交互式归一化下沉 daemon
覆盖决策：D-002@v1, D-003@v1, D-004@v1

Given ClaudeEventNormalizer（有状态类，每会话实例）接收一帧 SDK 完整消息
When normalizeMessage 展开为 AgentEvent[]（text/thinking/tool_use/tool_result 配对/usage/session_id/子代理归属/Edit structuredPatch，移植自 backend `_extract_sdk_messages`）
Then 输出与该函数现状行为逐字段等价（golden 对照）

Given stream_event partial 流（content_block_delta）
When 归一化器缓冲并按节流 flush（移植自 session-manager flush 链）
Then 产出 is_partial+segment_id 半截事件；override 信号产出 override:true+segment_id 撤回事件（[ASSISTANT_OVERRIDE] 等价语义）；depth 状态机由实例字段跨消息维护

Given 任意携带 usage 的事件（含 partial flush）
When daemon 上报
Then backend 更新 agent_runs token 统计并经 SSE summary 实时透传（对齐现 attachUsage/lift/publish 链）

Given 会话级信号（system/init→agentSessionId、codex thread_started、bash_chunk/bash_status、plan_mode、agent_task_status、task_notification）
When 归一化器吸收为 status 型 + subtype 事件
Then SessionManager 按 subtype 分发：session_started 随 submitMessages 触发 resume 指针 pin（backend 无行化）；其余走既有 onSessionEvent 独立通道（不落库）；SessionManager/daemon.ts/cli.ts 对 raw SDK 形状依赖清零（raw 仅 SILLYHUB_DEBUG_RAW_EVENTS=1 调试携带）

### FR-03: backend 双轨接收与落库
覆盖决策：D-001@v1, D-004@v1

Given submit_lease_messages 收到 kind='agent_event' 消息
When `_persist_agent_event` 处理
Then 按现行为合成同款文本行（[TOOL_USE] 等前缀，未升级前端渲染不断）+ 填充既有结构化列（tool_kind/parent 三列/segment_id/edit_patch）+ 完整事件存 metadata_['agent_event']（零 DDL）

Given override:true+segment_id 事件到达
When 落库
Then 先 DELETE (run_id, segment_id) 已落库 partial 再 INSERT 完整行（对齐现有 stale 撤回链）

Given 旧形态消息（无 kind 键）
When 走原 `_extract_sdk_messages` 路径
Then 行为与现状完全一致（兼容轨）

Given SSE publish
When 组装 run/session 双 channel payload
Then log payload 增加可选 agent_event 字段（取自 metadata_['agent_event']）

### FR-04: 前端双轨渲染
覆盖决策：D-001@v1

Given SSE/回放日志行携带 agent_event 字段
When normalize 解析
Then 直接由结构化事件构造渲染模型（不进文本正则）；无 agent_event 字段时回退现有 [ASSISTANT] 文本协议解析

Given 同一事件序列生成的两种载荷（旧文本行 vs agent_event 行）
When 分别过两条解析路径
Then normalize 渲染模型树等价（忽略 log_id/timestamp 等非渲染字段）——Claude 零回归验收判据

### FR-05: provider 注册表
覆盖决策：D-002@v1

Given providers.ts 注册表（ProviderDescriptor：provider/family/displayName/createDriver/caps/envKeys 预留/contextFile 预留）
When 新增 provider
Then 仅需注册表条目，不改 InteractiveProvider 类型（从注册表推导）；SessionManager._getDriver 改读注册表，未注册 provider 仍抛 UnsupportedProviderError

Given 现有 claude/codex 会话
When 经注册表路径创建 driver
Then 行为与现状一致（P2 为纯重构，守护测试断言门控取值逐一相等）

### FR-06: 能力矩阵三端表
覆盖决策：D-002@v1

Given ProviderCaps（resume/mcp/multimodal/thinking/subagent/permission_dialog/edit_patch/model_select，全 boolean 缺省 false）
When daemon/backend/frontend 三份镜像表建立
Then 守护测试以源文件读取断言三端键值一致；前端 session-panel 与 backend daemon/session service 散落的 `=== 'claude'` 门控改为查表且行为不变

### FR-07: 接入清单文档
Given 新 provider 接入需求
When 查阅 docs/agent-provider-onboarding.md
Then 三档路径（换 wrapper 零代码/族内成员描述符/新协议族 driver+归一化器+注册）有可执行 checklist 与 multica 对照引用

## 非功能需求

- 兼容性：旧 daemon/旧前端/旧 backend 三向兼容（design §9）；升级顺序约定 backend 先于 daemon + `SILLYHUB_LEGACY_TEXT_EVENTS=1` 回退开关
- 可回退：daemon 侧 legacy 开关强制走旧透传形态；backend 双轨并存
- 可测试：归一化器/映射表全部纯函数或可注入状态，golden fixture（真实 SDK 消息序列）驱动
- 跨平台：三端改动兼容 Windows/Linux/macOS（daemon Windows .cmd wrapper 解析等既有逻辑不动）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03, FR-04 | 渐进下沉路线：双轨兼容、稳定后退役 |
| D-002@v1 | FR-02, FR-05, FR-06 | 会话级信号事件化 + 有状态归一化器 + raw 降格 |
| D-003@v1 | FR-02 | usage 实时透传（任意携带事件即更新） |
| D-004@v1 | FR-02, FR-03 | override 撤回事件化（override:true + segment_id） |

无未覆盖决策。
