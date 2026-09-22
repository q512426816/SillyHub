---
author: sillyspec-fr-index
created_at: 2026-09-22T16:26:24.345Z
---

# FR 索引 — types

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/types.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-types-001 AgentEvent v2 统一事件契约
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `sillyhub-daemon/src/types.ts` 现有 5 型 AgentEvent（text/tool_use/tool_result/error；When 扩展类型联合（+thinking/status/turn_result）与一等可选字段（subtype/seq/tool_name/call_id/sessio；Then 类型与 zod schema（独立文件 agent-event-schema.ts）一致，批量 adapter 现有 5 型用法零破坏，交互式与批量共用一份 I
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-01
最近确认：c6c74aa49

## FR-types-002 Claude 交互式归一化下沉 daemon
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given ClaudeEventNormalizer（有状态类，每会话实例）接收一帧 SDK 完整消息 stream_event partial 流（content_bl；When normalizeMessage 展开为 AgentEvent[]（text/thinking/tool_use/tool_result 配对/usage/se；Then 输出与该函数现状行为逐字段等价（golden 对照） 产出 is_partial+segment_id 半截事件；override 信号产出 override:
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-02
最近确认：c6c74aa49

## FR-types-003 backend 双轨接收与落库
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given submit_lease_messages 收到 kind='agent_event' 消息 override:true+segment_id 事件到达 旧形态；When `_persist_agent_event` 处理 落库 走原 `_extract_sdk_messages` 路径 组装 run/session 双 chan；Then 按现行为合成同款文本行（[TOOL_USE] 等前缀，未升级前端渲染不断）+ 填充既有结构化列（tool_kind/parent 三列/segment_id/e
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-03
最近确认：c6c74aa49

## FR-types-004 前端双轨渲染
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given SSE/回放日志行携带 agent_event 字段 同一事件序列生成的两种载荷（旧文本行 vs agent_event 行）；When normalize 解析 分别过两条解析路径；Then 直接由结构化事件构造渲染模型（不进文本正则）；无 agent_event 字段时回退现有 [ASSISTANT] 文本协议解析 normalize 渲染模型树等
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-04
最近确认：c6c74aa49

## FR-types-005 provider 注册表
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given providers.ts 注册表（ProviderDescriptor：provider/family/displayName/createDriver/cap；When 新增 provider 经注册表路径创建 driver；Then 仅需注册表条目，不改 InteractiveProvider 类型（从注册表推导）；SessionManager._getDriver 改读注册表，未注册 pr
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-05
最近确认：c6c74aa49

## FR-types-006 能力矩阵三端表
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given ProviderCaps（resume/mcp/multimodal/thinking/subagent/permission_dialog/edit_patc；When daemon/backend/frontend 三份镜像表建立；Then 守护测试以源文件读取断言三端键值一致；前端 session-panel 与 backend daemon/session service 散落的 `=== 'c
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-06
最近确认：c6c74aa49

## FR-types-007 接入清单文档
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 新 provider 接入需求；When 查阅 docs/agent-provider-onboarding.md；Then 三档路径（换 wrapper 零代码/族内成员描述符/新协议族 driver+归一化器+注册）有可执行 checklist 与 multica 对照引用
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-07
最近确认：c6c74aa49
