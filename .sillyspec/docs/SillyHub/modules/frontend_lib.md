---
schema_version: 1
doc_type: module-card
module_id: frontend_lib
author: qinyi
created_at: 2026-08-18 01:45:00
updated_at: 2026-09-04 09:00:00
---

# 前端 API 封装层（frontend_lib）

## 定位
SillyHub 前端 API 客户端层与基础设施库（frontend/src/lib/**）。全部后端通信经 `apiFetch` / `fetch-sse` 收口（鉴权、错误分类、request-id、SSE 流）；承载 OpenAPI 生成类型、react-query 装配、领域取数 hooks 与格式化工具。无 UI、无路由，是 frontend_app / frontend_components / frontend_stores 三方的共同底座。

## 契约摘要
- 基础层 `api.ts`：
  - `apiFetch<T>(path, {json, query, ...})` — 从 `useSession.getState()` 读 token 注入 Bearer
  - 自动生成 `x-request-id`（服务端日志按请求关联）
  - 数组 query 编码为重复 key（`?k=a&k=b`，FastAPI list 接收方式，空数组跳过）
  - URL 解析：浏览器端相对 URL（走 Next rewrite /api/* → backend，任意 origin 可访问，不硬编码后端地址）
  - SSR / 服务端直取用 `INTERNAL_API_BASE_URL`（fallback NEXT_PUBLIC_API_BASE_URL / localhost:8000）；`getApiBaseUrl()` 供 EventSource 类 helper 解析后端 origin
  - `ApiError{code, status, requestId, details}` — 后端错误 payload 结构化透传；网络层异常抛 `code="network_error"`
  - 可选请求超时（ql-20260831-006-6d67）：`timeoutMs` 到时 abort 并抛 `code="timeout"`（文案经 `timeoutMessage` 定制，缺省「请求超时，请重试」）；调用方自带 `signal` 的外部 abort 仍走 `network_error`（streamSession resync 静默语义不回归）。当前接入点：`injectSession` 30s + 「草稿已保留」专用文案——后端劣化请求挂起时撤占位轮 + 错误横幅兜底，占位轮不再永久「排队中」
  - 401 处理：非 /api/auth/* 端点且未带 `x-auth-retry` 时单飞刷新拿新 token 重试一次（防无限重试）
- `token-refresh.ts`：`ensureFreshAccessToken()` — 模块级 inflight 单飞，并发 401 风暴只发一次 POST /api/auth/refresh 并写回 store；未登录/未 hydrate/refresh 失败返 null；`decodeJwtExp` 解析过期时间。
- `fetch-sse.ts`：fetch + ReadableStream 的 EventSource 替代品。
  - 动机：EventSource 无法自定义请求头，token 只能拼 URL query 会被访问日志明文记录；本 helper 把 token 放 Authorization header（backend auth_deps 已 header-only）。
  - 接口形状贴齐 EventSource（onopen/onmessage/onerror/addEventListener/readyState/close），从 EventSource 迁移只改构造方式。
- `api-types.ts`：OpenAPI 生成（pnpm gen:types），后端 schema 改动必须同 change 内重生成并成对提交 backend/openapi.json，禁手写。
  - 已知例外债：lib/api/llm-providers.ts 手写 DTO（文件头显式登记，整体迁移到生成类型是独立坑）。
- `agent-logs.ts`：本地 Agent 会话日志双通道（2026-08-23-agent-log-conversation-view）——`readAgentLogMessages(entryId, beforeSeq?)` 对话化归一化消息（status 四值均 200 分层，仅 parsed 可渲染，蛇形字段原样）；`readAgentLogContent` 原文尾部 256KB（回落与二进制格式唯一通道）；ApiError 一律抛出交调用方回落。
- `api/session-attachments.ts`：`fetchAttachmentBlob(id)`（2026-08-25-session-attachment-preview）——预览 Modal 用的 Blob 拉取（docx/xlsx/md 渲染需 ArrayBuffer/text），401 经 ensureFreshAccessToken 单飞刷新重试一次（对齐 file/api.ts 的 fetchFileBlob 语义）；既有 `fetchAttachmentObjectUrl`（objectURL 版）行为不变。
- `change-files.ts`：`fetchChangeFileRaw(workspaceId, changeId, path)`（2026-08-26-file-fullscreen-preview，D-009）——变更文件二进制 Blob 拉取（GET files/raw），裸 fetch+Bearer+401 单飞重试（对齐 explorer.ts fetchDownload 范式）；变更文件预览（全屏弹窗/图片内联）恒走此函数，不走 1MB 截断的 getChangeFileContent（编辑流仍走 content 端点）。
- react-query 装配：
  - `query-client.ts` `makeQueryClient()` — freshness-first 默认：staleTime 15s + refetchOnWindowFocus（仅对 >15s 数据重取）；retry 仅 ApiError 5xx ≤3 次（4xx 含 401/403/404 不重试）；全局不设 refetchInterval。
  - `providers.tsx` `AppProviders` — QueryClientProvider 用 useState 工厂建每会话实例（禁模块级单例，防 SSR 跨请求泄漏缓存）；DevTools 仅 dev。
- 领域客户端（每后端域一文件，约 40 个）：
  - 工作区族：workspaces / workspace.ts / workspace-binding / workspace-members / workspace-skills-view / workspace-path / workspace-daemon-status / workspace-types / git-log（Git 日志三端点 fetch + queryKey 工厂 + useQuery hooks，2026-08-25-workspace-git-log；2026-08-26-workspace-git-status 增第四端点 status：`fetchGitLogStatus`/`useGitLogStatus` + status 系三生成类型（GitLogStatusResponse/DirtyItem/FetchItem），staleTime 60s 显式覆盖全局 15s——两页共享缓存只触发一次 daemon 远程 fetch，git-log 页刷新按钮 `["git-log", wid]` 前缀 invalidate 天然覆盖 status key）
  - 会话与运行：agent / daemon / runtime / changes / change-files / tasks / quicklog / approvals / audit / daemon-audit
  - 群聊客户端（lib/daemon.ts 内，2026-09-01-session-group-chat）：11 个函数——
    listGroupChats / getGroupChat / createGroupChat / updateGroupChat / endGroupChat /
    addGroupMember / updateGroupMember / removeGroupMember / resetGroupMemberMemory /
    sendGroupMessage / sendGroupTyping（typing 心跳上报，节流在前端）+
    GroupChat*/GroupMember* 系生成类型 re-export；`streamGroupChat` 群流封装
    （GroupChatStreamEnvelope 扩展 sender/member 身份字段、GroupChatTypingEvent、
    GroupReplayLogEntry 回放行带 metadata 身份——平铺排序与身份还原的取数基座；
    ql-20260904-011-6f3f 增 GroupChatPresenceEvent/onPresence 分支——成员上/下线
    即时事件，group-chat-panel 以覆盖层合并进 onlineMemberIds，事件不可回放故
    重连 reconnected 作废覆盖层 + 强拉群列表对账）
  - 群聊「@我」未读记忆（lib/group-unread.ts，2026-09-02）：localStorage 已读锚
    单源（session-list-panel 红点渲染 / group-chat-panel 写锚共用防口径漂移）；
    ql-20260903-007 起锚改**服务端时间戳**（回放 maxLogTimestamp / 实时事件
    env.timestamp）——判定方 last_mention.ts 是后端时钟，此前客户端 now 跨时钟域
    比较会吞红点/出假红点；空群（无服务端 ts）不写锚，缺省参数回落客户端时钟
  - 平台管理：admin / settings / api-keys / mcp-tokens / mcp-settings / menu-permissions / permission / agent-profiles / custom-skills
  - spec 域：scan-docs / scan-docs-tree / spec-workspaces / knowledge / incidents / releases / health / git-identities / file/ / auth(+auth/ 子目录) / ppm/*（含 format / types / kanban）/ api/llm-providers（拆分客户端首例）
- 取数 hooks：
  - `use-agent-run-stream` — run 级 SSE 订阅
  - `use-agent-runs` — Agent 运行列表 5s 条件轮询
  - `use-daemon-machines` — 机器级列表 + 会话，refetchInterval 15s
  - `use-workspace-context` — 从 URL 重建工作区上下文写 workspace store
  - `agent-stream` — agent 事件流底层
- 工具：
  - `errors.ts` — errMessage 等统一错误文案提取
  - `format-token` — token 数量级格式化
  - `status-labels` — 状态值→中文标签映射
  - `query-keys` — react-query 查询键常量
  - `client-path` / `workspace-path` — 客户端与工作区路径处理
  - `workspace-types` — 工作区类型 8 值受控词表前端单一事实源
    （WorkspaceType 从 api-types WorkspaceCreate.type 派生禁手抄 +
    WORKSPACE_TYPE_OPTIONS 中文标签/徽标配色 + workspaceTypeBadge
    三态兜底：NULL=未分类灰 / 词表值=中文徽标 / 未知值=原值灰；
    2026-08-18-workspace-role-type）
  - `utils.ts` — cn（clsx + tailwind-merge）

## 关键逻辑
```
组件调 listX() → apiFetch(path, {json, query})
  → Bearer(useSession.getState()) + x-request-id + accept:json → fetch
  → !ok: 解析后端 payload 抛 ApiError{code,message,details}
     401 且非 auth 端点: ensureFreshAccessToken()（单飞）
       → 新 token → x-auth-retry:1 重试一次
SSE: fetchSSE(path) → Authorization header 订阅 text/event-stream
     （Next route handler 透传防缓冲）
react-query: makeQueryClient() 每会话一实例；staleTime 15s 治焦点刷新风暴；
  实时性由各 hook 自带 refetchInterval（agent 5s / machine 15s / session 详情 1.5s）
```

## 注意事项
- `apiFetch` 在 store 未 hydrate 时读到 null token——调用方须在认证守卫之后使用（dashboard layout 已保证）。
- QueryClient 禁止导出模块级单例（SSR 跨请求泄漏缓存）。
- staleTime 15s 是治「焦点刷新风暴」的调参（原 0 导致切回标签重发全部挂载查询，叠加详情页多路轮询），再动需评估。
- retry 仅 5xx：4xx（含 401/403/404）重试无意义，401 由 token-refresh 层处理。
- SSE 一律走 fetch-sse + Next route handler 透传，不用 EventSource（token 进 URL 会泄访问日志；backend auth_deps 已 header-only）。
- api-types.ts 与 backend/openapi.json 成对提交；gen:types 前确认前端 node_modules 健康（半坏会报假的 CSSProperties/缺模块错误，须 pnpm install --force）。
- 日期展示必须显式 `toLocaleString("zh-CN")`（CI en-US 红本地不复现）；Number 千分位除外。
- lib/api/llm-providers.ts 手写类型与 api-types.ts 生成的 LlmProvider* 并存：改后端 schema 两边都要核对（登记的债）。
- SessionStreamEnvelope（lib/daemon.ts）含子代理归属字段 parent_tool_use_id/subagent_type/depth + tool_kind（2026-08-19-session-stream-ux 补声明；backend session channel 早已透传，消费方为 session-log-assembler）。
- 领域客户端文件与后端模块一一对应，新增后端域时同步建 lib 文件 + gen:types，不让页面直接 fetch。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
