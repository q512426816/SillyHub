---
schema_version: 1
doc_type: module-card
module_id: types
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 共享类型定义中枢（types）

## 定位
sillyhub-daemon 共享类型定义中枢（`src/types.ts`，635 行）。仅导出 type/interface，
无运行时代码；唯一 import 是 type-only `MsgType` from protocol.js
（protocol ↔ types 互相引用，实测存在的循环，靠 type-only 不引入运行时耦合）。
字段名与 Python dataclass / server JSON 契约 1:1 对齐
（有意保留 snake/camel 混排以便联调对照）。是 adapters / task-runner / daemon /
client / spawn-env / credential-injector / claude-settings 共用的中间表示（IR）
与传输 DTO。

## 契约摘要
- **Agent 事件 IR**：
  - `AgentEventType` 5 元组：text/tool_use/tool_result/error/complete
    （Python 6 类收敛掉 thinking/status，合入 text + metadata）；
  - `AgentEvent {type, content, metadata?}`——已知 metadata key：tool_name /
    call_id / tool_input / tool_output / status / level / session_id / usage / model。
- **执行结果链**：`TaskResultStatus`（completed/failed/timeout/aborted）→
  `BackendTaskResult`（adapter 子进程返回，status/output/error?/durationMs?/
  sessionId?/events?）→ `TaskResult`（task-runner 终态，output ≤10000 /
  error ≤5000 字符）→ `LeaseCompleteResult`（complete_lease 线上序列化形态）；
  另 `TaskState`（pending/running/completed/failed/cancelled）。
- **WS 信封**：`DaemonMessage<T extends MsgType> {type, payload: unknown}`。
- **Lease 族**：
  - `LeaseCtx`：claim/task_available 执行上下文（字段见关键逻辑与注意事项）；
  - `LeasePayload = LeaseCtx`（task_available 阶段尚无 claim_token）；
  - `ExecutionContextPayload`：GET execution-context 响应（snake_case）；
  - `LeaseClaimResult`（claimToken 必填）；`LeaseMessage`（submit_messages 单条，
    非空字段才序列化）；`ToolConfig = Record<string,string>`（凭据 map）。
- **治理/供应商**：`ToolGovernanceConfig {mode?, allowed_tools?, max_turns?}`、
  `ProviderConfig`（平台下发 LLM 配置，字段见关键逻辑）。

## 关键逻辑
```
tool_config 二义性（CC-10，同一 payload key 两形态）:
  toolConfig（camelCase, Record<string,string>）= 凭据渲染 env
  tool_config（snake_case, ToolGovernanceConfig）= worker 工具治理
    （allowed_tools → ClaudeSdkDriver allowedTools 白名单，read_only 物制）
ProviderConfig: agent_kind / base_url / api_key(明文,R-02 严禁入日志与上报) /
  auth_field / model / model_role_mappings(one_m=true→模型名加[1m]后缀触发 1M) /
  default_fallback_model / extra_env / settings_config{env,attribution,
  enabledPlugins,model,skipDangerousModePermissionPrompt} + LiteLLM 族:
  api_format('anthropic'|'openai_chat') / litellm_base_url / litellm_proxy
  (代理形态:backend 不发 master key,daemon 注自身 apiKey) / litellm_model_name /
  litellm_auth_token(老直连形态向后兼容保留)
LeaseCtx 双字段兼容: cmdPath(Python)/cmd(design) 二选一；timeout(旧)/
  timeoutSeconds(新,优先;0=不限,-1=显式不限)；kind 缺省一律按 batch 兼容
```

## 注意事项
- `DaemonMessage.payload` 是 unknown，各 handler 必须在使用点收窄，
  编译期不保证形状。
- LeaseCtx 按引入时间已高度扩容（新字段均带决策编号溯源注释）：
  - rootPath/workspaceSlug（ql-20260617-009 直连真实目录，不可达回落 mirror）；
  - transport/workspaceId（tar 模式 pullSpecBundle 配对）；
  - specStrategy（platform-managed/repo-mirrored/repo-native 三分支初始化）；
  - mode='init' + platformConfig/latestSpecVersion（init lease 不 spawn agent）；
  - stage='orchestrator'（team 主 agent 判定，注入 daemon MCP 5 工具）；
  - stage_meta/stage_dispatch（skill 投递，注 STAGE_META env）；
  - mcpRefs/skillRefs/effectiveAllowedRoots（AgentProfile ∩ 收紧，空=不过滤）；
  - budget_tokens（D-009 口径 input+output 不含 cache，超限软切断回传
    reason='budget_exceeded'）；systemPrompt（profile 注入）；
  - manualApproval/askUserOnly（scan 真阻塞人审）；claimToken（WS 流程注入）。
- ExecutionContextPayload → LeaseCtx 映射时 **prompt 不从 fetch 覆盖**
  （保留 payload.prompt 作最终意图）；provider_config 取
  `execCtx ?? execPayload`（execution-context 端点是最新源）。
- 改任一接口字段需四端同步：adapters 产出端、task-runner/daemon 消费端、
  server JSON 契约、Python 对照源。
- `src/interactive/types.ts` 与本文件是两个独立类型文件，勿混淆。
- 纯类型文件，卡片刻意短于实现模块；字段全量语义以文件内注释为准。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
