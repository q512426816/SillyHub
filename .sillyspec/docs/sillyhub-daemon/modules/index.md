---
schema_version: 1
doc_type: module-card
module_id: index
author: qinyi
created_at: 2026-06-14T10:40:45+08:00
---

# index

## 定位
sillyhub-daemon 包的入口聚合文件 `src/index.ts`。通过 ESM re-export 把各核心模块的公开 API 暴露为单一包入口，供 `sillyhub-daemon` 作为 npm 包被外部消费（例如 daemon CLI、测试、未来嵌入其他 runtime）。本文件不实现逻辑。

## 契约摘要
- 重新导出：`Daemon`、`HubClient`、`DaemonConfig`、`TaskRunner`、`CredentialManager`、`WorkspaceManager`、`AgentDetector`、`getBackend`、`ProtocolAdapter`、`MSG` / `LEASE_STATE`、`AgentEvent` / `TaskResult` / `DaemonMessage` / `LeasePayload` 等
- 子路径 import（`sillyhub-daemon/adapters/stream-json` 等）仍可用（Node ESM exports）

## 关键逻辑
```
// 仅 re-export，无副作用
export * from "./config"
export * from "./client"
export * from "./credential"
export * from "./workspace"
export * from "./version"
export * from "./agent-detector"
export * from "./task-runner"
export * from "./daemon"
export * from "./protocol"
export * from "./types"
export * from "./adapters/index"
```

## 注意事项
- 不在 index.ts 中放任何运行时逻辑，避免循环依赖与初始化顺序问题
- 新增对外公开的模块需在此 re-export，否则包消费者看不到
- 延迟加载或可选依赖（如 adapter 的动态 import）不应在 index 顶层触发
- 被 npm 包入口 `package.json.exports["."]` 指向

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
