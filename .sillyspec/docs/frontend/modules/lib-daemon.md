---
schema_version: 1
doc_type: module-card
module_id: lib-daemon
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-daemon

## 定位
守护进程（daemon runtime）与运行时会话（interactive/quick-chat session）的浏览器侧 API 客户端 + SSE 流式接入层。封装后端 `/api/daemon/**`、`/api/daemon-chat/**`、`/api/daemon/sessions/**` 端点，向上层页面与 `components-daemon` 提供「列表/CRUD/快速问答/交互会话生命周期/权限对话」的统一调用入口，并把 EventSource 流解析成结构化事件交给回调。依赖 `lib-api` 的 `apiFetch`（401 自动刷新）与 `getApiBaseUrl`。

## 契约摘要
按子域分组（均为顶层 export，参数/返回走 TS interface，错误统一抛 `ApiError`）：

- 运行时管理：`listDaemonRuntimes` / `listOnlineRuntimes` / `getDaemonRuntime` / `disableDaemonRuntime` / `enableDaemonRuntime` / `deleteDaemonRuntime`，类型 `DaemonRuntimeRead`。
- 文件浏览：`listDir(path)` → `ListDirResponse`（含 `DirEntry[]`）。
- 快速问答（一次性）：`quickChat(provider, prompt)` → `QuickChatResponse`（拿 runId）；`getQuickChatResult(runId)` 轮询；`getQuickChatLogs(runId)`；`streamQuickChat(runId, handlers)` 返回 EventSource 连接，按 `text/tool_use/error/done` 分类回调。
- 交互会话（多轮）：`createSession` / `injectSession` / `interruptSession` / `endSession`，返回 `SessionCreateResponse` 等；`streamSession(sessionId, handlers, {cursor})` 建立 SSE，通过 `SessionStreamHandlers`（onText/onToolUse/onPermissionRequest/onSessionEnd/onError 等）派发，支持断线 `cursor` 续传；附带 `listAgentSessions` / `deleteAgentSession` 等会话管理。
- 权限对话：`fetchPendingDialogs` / `respondSessionPermission` / `parseSessionPermissionEvent`，处理会话内权限请求弹窗。
- 版本/Provider 元信息：`PROVIDER_META`、`MIN_VERSIONS`、`isVersionBelow(version, min)`（语义版本比较）。

## 关键逻辑
SSE 流接入（`streamSession` / `streamQuickChat`）核心：
```
url = base + "/api/daemon/sessions/<id>/stream"
  + "?token=" + accessToken   // SSE 无法带 header，token 走 query
  + "&cursor=" + lastEventId  // 断线续传
es = new EventSource(url)
dispatch(raw): JSON.parse(data) → envelope.event kind 分发到对应 handler
  // 解析失败不回传原始 payload（防泄露），仅 onError
  // lastEventId 持续更新，供重连；sessionEnded 幂等只触发一次
return { close(): es.close() }   // 调用方负责断开
```
`isVersionBelow`：按 `.` 切段转数字数组，逐段比较（前段相等才看后段），等长返回 false。

## 注意事项
- SSE 鉴权：EventSource 不支持自定义 header，故 accessToken 通过 URL query 传递——不可在 URL 中拼敏感 prompt 内容，仅 token。
- 错误统一收敛到 `apiFetch` 抛 `ApiError`（含 409 业务码等），上层用 try/catch 或 `.catch` 处理；流解析失败不泄露原始 payload。
- `streamSession` 的 `cursor` 续传依赖后端 `Last-Event-ID`，重连时需把上次 `lastEventId` 透传回来。
- 交互会话 provider 区分 `claude` / `codex`（`InteractiveProvider`），不同 provider 的会话能力有差异。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
