---
schema_version: 1
doc_type: module-card
module_id: lib-daemon
author: qinyi
created_at: 2026-08-18 01:45:00
---

# daemon 域客户端（lib-daemon）

## 定位
daemon 域的浏览器侧 API 客户端 + 会话 SSE 接入层（`frontend/src/lib/daemon.ts`，约 1300 行，前端最大的单个 lib 文件）。覆盖 `/api/daemon/**`（运行时/机器/实例/版本/用量/文件浏览 RPC/会话生命周期/权限对话）与两处 workspace 侧会话查询端点，并把 session SSE 流解析成结构化事件交给回调。所有 REST 走 `apiFetch`（401 自动刷新、错误归一 `ApiError`）；SSE 走 `lib/fetch-sse`（token 进 Authorization header）。依赖面广：pages、components-daemon / components-sessions / components-permissions / components-agent-log、lib 内部（query-keys、use-daemon-machines、workspace-daemon-status、workspace-path）均 import 本模块。

## 契约摘要
按子域分组（全部顶层 export；DTO 大量采用「api-types 生成版 + Omit/交叉窄化」，见注意事项）：

**runtime 管理**
- `listDaemonRuntimes()` → 数组形态（FR-06 兼容，下拉选择器复用）；`listDaemonRuntimesPage(params)` → admin 全局分页（q/type/status/user_id/limit/offset）。
- `getDaemonRuntime` / `updateDaemonRuntime`（PATCH display_alias）/ `updateRuntimeAllowedRoots`（PUT 目录沙箱）/ `disableDaemonRuntime` / `enableDaemonRuntime` / `deleteDaemonRuntime`（物理删，级联 leases/agent_sessions）。
- `DaemonRuntimeRead`：含 `daemon_instance_id`；`version`（provider CLI 版本）与 `daemon_version`/`daemon_build_id`（daemon 进程版本）双轨，勿混用。

**machine 两级视图（2026-07-07-daemon-machine-runtime-hierarchy）**
- `DaemonMachineRead`：machine=daemon 实例聚合（hostname/alias/os/arch/version/build_id/started_at + runtime_count/online_runtime_count + 全量 `runtimes[]`，0-runtime 机器为 []）。
- `listDaemonMachines(params)`（机器级分页）、`updateDaemonMachine`（0-runtime 机器也能改别名）、`triggerMachineSelfUpdate`（按 instance 路由，不再借道 runtime_id）、`triggerMachineCleanup`（POST machines/{id}/cleanup，按 instance 路由推送 daemon:cleanup 缓存清理指令，返回 `{sent}`；破坏性操作，页面侧走 modal.confirm）。

**daemon 实例与版本**
- `listDaemonInstances()`：当前用户在线守护进程 + 各自已启用 providers（workspace-daemon-switcher 下拉 + provider 徽标）。
- `getDaemonVersion()`：公开端点 `/api/daemon/version`；新字段 `latest_version`/`latest_build_id`，旧 `latest`/`minRequired`/`downloadUrl` 为 install.sh 兼容保留。
- `triggerDaemonSelfUpdate(runtimeId)`：runtime 维度，后端经 WS 下发 `daemon:self_update`，daemon 下载 bundle 替换并重启；失败抛 ApiError（504 离线等）。

**文件浏览 RPC（backend 转发 daemon）**
- `listRoots(runtimeId)`：daemon 主机根锚点（Windows 盘符 / Unix 根），RemoteFolderPicker 初始根。
- `listDir(runtimeId, path)`：受 allowed_roots 白名单限制，越界 403。

**Provider 元信息**
- `PROVIDER_META`：12 个 provider 的 label/icon emoji/Tailwind color；`MIN_VERSIONS`（claude/codex/copilot，仅 UI 警告）；`isVersionBelow(version, min)` 语义版本比较。

**会话权限（provider 无关归一化）**
- `SessionPermissionRequest`：`dialog_kind` 存在 → AskUserDialogCard 结构化问答（ask_user / codex_request_user_input / mcp_elicitation，daemon 侧双向归一化，前端零分支），否则普通 allow/deny 卡；`dialog_payload` 含 questions/options；`workspace_name`/`session_type`/`run_summary`/`created_at` 为来源上下文（查询路齐全，SSE 路缺省由查询回填）。
- `respondSessionPermission(sessionId, requestId, decision, message?, dialog_result?)`；`parseSessionPermissionEvent(data)`（非 permission_* 事件返回 null）；`fetchPendingDialogs`（刷新恢复待答对话）、`fetchSessionDialogHistory`（返回 api-types 的 SessionDialogRead）、`listWorkspaceDialogs`（workspace 维度 DB 兜底）。

**交互会话生命周期**
- `createSession(input)`：`SessionCreateRequest` = 生成版 Omit 后放宽 `manual_approval`/`ask_user_only` 可选（省略走后端默认 true）；可选 provider/runtime_id/agent_profile_id/llm_provider_id/change_id/workspace_id。
- `injectSession(sessionId, prompt, options?)`：下一 turn = 新 AgentRun（非写 stdin）；options 携带 agent_profile_id/llm_provider_id 触发轮次配置热切换。
- `interruptSession`（只收敛 currentRun，session 保持 active）、`endSession`。

**会话查询**
- `listAgentSessions(params)`：分页 + status/runtime_id/machine_id/provider/q 筛选；`AgentSessionRead` 含 `config_snapshot` 摘要（chips 直显免二次查询）与 `title`（首条输入前 30 字）。
- `getAgentSession`、`reopenSession`（409 业务码 DAEMON_SESSION_RESUME_UNSUPPORTED / NO_AGENT_SESSION / NOT_ACTIVE / DAEMON_OFFLINE）、`getAgentSessionLogs`（跨 AgentRun 历史回看，run_id 保留 turn 边界）、`deleteAgentSession`。
- `listSessionRuns`：`SessionRunRead` 含 `error_detail`（模型层 ModelError 序列化）、`agent_profile_snapshot`、`llm_provider_id`、input/output_tokens、`user_id`/`sender_name`（轮次发送者）。
- `listChangeSessions`（变更级跨成员可见）、`listWorkspaceAgentSessions`（include_ended/mode）。

**用量**
- `getRuntimesUsage(window)`：window = 1d/7d/30d；summary + 时间序列（20 分钟桶/小时桶/日桶）；codex/OpenAI 系无 cache，cache_* 恒 0 前端显示「—」。

## 关键逻辑
`streamSession(sessionId, handlers, {cursor})` 的 dispatch 主干：
```
url = base + "/api/daemon/sessions/<id>/stream" + "?cursor="   // token 不进 URL
conn = fetchSse(url, { token })                // Authorization: Bearer header
conn.onmessage = (raw) => {
  env = JSON.parse(raw.data)        // 失败仅 onError，不泄露原始 payload；无 event 字段忽略
  校验 env.session_id === sessionId；turn_started/log/turn_completed/tokens 必须带 run_id
  switch env.event:
    turn_started / log / turn_completed / tokens → 对应 handler（log 记录 lastEventId）
    session_ended → 幂等触发一次 onSessionEnded 并 close
    permission_request / permission_resolved → parseSessionPermissionEvent → 对应回调
}
```
`isVersionBelow`：剥 `v` 前缀、逐段取数字前缀（非标后缀如 `-beta` 丢弃）成 3 元数组逐段比较，等值返回 false。

## 注意事项
- **token 走 Authorization header**（fetch-sse），不再拼 URL query——旧卡「SSE 无法带 header 故 token 进 query」已过时。
- **无自动重连**：fetch-sse 有意取舍，onerror 只通知组件；断流由调用方重建连接 / 查询兜底（fetchPendingDialogs / getAgentSessionLogs 等即兜底面）。
- backend 的 turn/log/permission_* 事件发**默认 data 帧**（无 `event:` 行），必须走 onmessage 单通道按 payload.event 分发；addEventListener 命名事件只收得到 done/error。
- **一次性 quickChat 已不存在**：`quickChat` / `getQuickChatResult` / `streamQuickChat` 已删除（索引残留符号），多轮交互会话是唯一入口。
- 类型策略（「规则 20」）：主体迁 api-types 生成版，Omit 掉后端无法表达的字段后手写窄化（AgentSessionRead 的 status 枚举 / config_snapshot 具名结构 / title 必填；SessionCreateRequest / SessionInjectRequest 的可选放宽）。字段漂移在 gen:types 时暴露，勿改回全手写。
- `injectSession` 的 `llm_provider_id === ""`（切回本机默认）必须下发——判 `undefined` 而非真值。
- 流式分片撤回：`SessionStreamEnvelope.segment_id`（partial 半截行标记，形如 "main:<msg_id>"）+ override 令箭（stale=true）；旧 backend 缺字段时 undefined 空转，不误撤回；正文分类在 components-agent-log 的 classifySessionLog。
- `AgentSessionListResponseSchema`（zod）仅 dev-time 校验，不进业务层。
- 测试分布：`lib/daemon.test.ts` + `lib/__tests__/daemon-session.test.ts`（会话/SSE）、`daemon-permission.test.ts`（权限事件解析）、`daemon-usage.test.ts`（用量聚合）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
