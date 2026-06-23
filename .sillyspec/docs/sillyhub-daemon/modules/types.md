---
schema_version: 1
doc_type: module-card
module_id: types
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# types

## 定位
sillyhub-daemon 共享类型定义中枢（`src/types.ts`）。仅导出 type/interface，无运行时代码。字段名与 Python dataclass 1:1 对应（保留 snake/camel 原名以便对照调试，与 server JSON 契约一致），是 adapters / task-runner / daemon / client 共用的中间表示（IR）与传输 DTO。

## 契约摘要
- **Agent 事件 IR**：`AgentEventType`（5 元组 text/tool_use/tool_result/error/complete）、`AgentEvent`（type + content + 可选 metadata）。所有协议 adapter 的 parse() 产出此结构；Python 原 6 类收敛掉 status/thinking（合入 text + metadata）。
- **Backend 结果**：`TaskResultStatus`（completed/failed/timeout/aborted）、`BackendTaskResult`（adapter 子进程返回）。
- **TaskRunner 终态**：`TaskResult`（success/exitCode/patch/filesChanged/insertions/deletions/output/error/durationMs/metadata），序列化为 `LeaseCompleteResult` 提交 server。
- **任务状态**：`TaskState`（pending/running/completed/failed/cancelled）。
- **WS 消息**：`DaemonMessage<T extends MsgType>`（type + payload unknown，使用点收窄）、`TaskAvailablePayload`。
- **Lease 上下文**：`LeaseCtx`（leaseId/runtimeId/agentRunId/workspaceName/workspaceSlug/rootPath/repoUrl/branch/claudeMd/provider/cmdPath/cmd/prompt/model/sessionId/resumeSessionId/timeout/timeoutSeconds/kind/agentSessionId/toolConfig/claimToken/manualApproval/askUserOnly）、`LeasePayload = LeaseCtx`、`ExecutionContextPayload`（snake_case，GET execution-context 响应）、`LeaseClaimResult`、`LeaseMessage`（submit_messages 单条）、`ToolConfig = Record<string,string>`。

## 关键逻辑
纯类型聚合，逻辑即字段映射约定：
- IR 收敛：Python 6 类事件 → Node 5 类（thinking/status 入 metadata）。
- LeaseCtx 双字段兼容：`cmdPath`（Python cmd_path）与 `cmd`（design 命名）二选一；`timeout`（旧）与 `timeoutSeconds`（新，优先级最高）并存，resolveTimeout 在使用点裁决。
- ExecutionContextPayload（snake_case）→ LeaseCtx（camelCase）映射，但 prompt 不从 fetch 覆盖（保留 payload.prompt 作最终意图）。
- `kind: 'batch' | 'interactive'` 决定 lease 走 TaskRunner 还是 SessionManager；未定义一律按 batch 兼容。

## 注意事项
- 仅 type-only import `MsgType` from protocol.js，不引入运行时依赖。
- 字段命名有意不统一为纯 camelCase：与 Python dataclass / server schema 对齐优先，便于联调。
- `DaemonMessage.payload` 是 unknown，各 handler 必须在使用点用类型守卫/断言收窄，编译期不保证形状。
- 改动任一接口字段需同步：adapters 产出端、task-runner/daemon 消费端、server JSON 契约、Python 对照源。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
