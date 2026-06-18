---
id: task-10
title: 会话面板（SSE 进度 + 中途追问输入框 + 打断本轮/结束会话按钮）
wave: W4
priority: P1
depends_on: [task-04, task-05]
blocks: [task-11]
covers: [FR-10, Q1]
created_at: 2026-06-18 14:11:24
author: qinyi
change: 2026-06-18-daemon-interactive-session
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/lib/daemon.ts
---

# Task-10｜会话面板：SSE 进度 + 中途追问输入框 + 打断本轮/结束会话按钮

## 1. 目标

在 frontend 把现有 `runtimes/page.tsx` 的 `QuickChatPanel`（伪多轮：每轮新 run + resume）**升级为交互式会话面板**，对接 task-04 的 4 个 session REST 端点 + task-05 的 session 级 SSE，落地 design §5 Wave4 前端三件套：

1. **SSE 进度区**：用单个 SSE 连接（`GET /api/daemon/sessions/{id}/stream`，task-05）贯穿整个会话的多 turn，复用现有 `renderStreamMessage` 把 stream event 渲染到聊天框；按 payload 里的 `run_id` 区分 turn 边界（R-08）。
2. **中途追问输入框**：首 prompt 调 `createSession`（建会话 + interactive lease + 首 turn）；后续输入调 `inject`（注入新 prompt = 新 turn），不再每轮新开 quick-chat run。
3. **打断本轮按钮**（POST `/sessions/{id}/interrupt`）：停当前 turn，会话仍 active 可继续追问（FR-04，与「结束」分离）。
4. **结束会话按钮**（POST `/sessions/{id}/end`）：kill 进程 + session 标 ended，清空面板状态。

覆盖：**FR-10**（会话面板 UI：实时进度 + 追问 + 打断 + 结束）、**Q1**（前端管控台演进现有 quick-chat）。

> **不在本 task**：权限批准弹窗（Wave2 task-08 落地后由 task-11 接）、会话历史列表/回看（task-11）、resume 持久化恢复后前端重连（Wave3 task-09 配合）。本 task 只做「单会话面板」的交互闭环。

## 2. 前置依赖

- **task-04（backend session 侧）必须已合并**：
  - `POST /api/daemon/sessions`（create_session 返回 `{session_id, run_id, lease_id, stream_url}`）。
  - `POST /api/daemon/sessions/{id}/inject` / `/interrupt` / `/end` 三个端点已落地（§5.7）。
  - `main.py` quick-chat 升级已完成：首次建 session、后续 inject（task-04 §5.8）—— **本 task 不再调旧 `/api/daemon-chat`，直接调新 session REST**，旧 `quickChat` / `streamQuickChat` 保留供回退（§9）。
- **task-05（session 级 SSE 聚合）必须已合并**：
  - `GET /api/daemon/sessions/{id}/stream` SSE 端点已落地（task-05 §5.5）。
  - session channel 上的事件 payload 含 `event`（`log`/`messages`/`session_ended`）+ `run_id` 字段（task-05 §5.1）。
  - `end_session` publish `session_ended` → stream 发 `event: done`（task-05 §5.3 / §5.4）。
- daemon 侧（task-03）、Wave2/3 任务**不在本 task 依赖硬门**：前端可用 mock 后端 / 已合并的 backend 端点独立开发与单测（vitest + @testing-library/react），端到端联调在 task-06 / 后续集成。

> 代码现状确认：截至本 task 编写，`frontend/src/lib/daemon.ts` 只有 quick-chat 相关 API（`quickChat` / `getQuickChatResult` / `getQuickChatLogs` / `streamQuickChat`）与 `PROVIDER_META` / `MIN_VERSIONS`；无任何 session API。`runtimes/page.tsx` 的 `QuickChatPanel`（L372-843）按「每轮 new quickChat + streamQuickChat(run_id)」工作，`renderStreamMessage`（L481-517）解析 `QuickChatStreamMessage` 渲染 text/tool_use/tool_result/error。本 task 在该文件上**升级而非重写**，保留日志面板（`AgentLogViewer`）、provider 选择、model 输入等现有 UI。

## 3. 涉及文件

| 文件 | 改动概述 |
|---|---|
| `frontend/src/lib/daemon.ts` | 新增 4 个 session REST 调用：`createSession` / `injectSession` / `interruptSession` / `endSession`；新增 `streamSession` SSE 订阅（EventSource → `GET /api/daemon/sessions/{id}/stream`），事件 payload 类型 `SessionStreamEvent`（`log`/`messages`/`session_ended`，含 `run_id`）；保留 `quickChat`/`streamQuickChat` 作回退 |
| `frontend/src/app/(dashboard)/runtimes/page.tsx` | `QuickChatPanel` 升级为会话面板：首 prompt 调 `createSession`（建会话）→ 后续输入调 `injectSession`（新 turn）；SSE 切换为 `streamSession(session_id)` 单连接贯穿会话；新增「打断本轮」/「结束会话」按钮；按 `run_id` 分组渲染多 turn 输出；参照 `prototype-interactive-session.html` 线框布局 |

> 不改 `AgentLogViewer`（`agent-log-viewer.tsx`）：现有日志组件已足够（quick-chat 现状已在用），本 task 复用；多 turn 时 `activeRunId` 跟随当前 turn 的 run_id 切换（与现状行为一致）。不改 `lib/api.ts`（`apiFetch` / `getApiBaseUrl` 复用）。

## 4. 覆盖来源（文档 → 代码）

- design **§5 Wave 4**（前端管控台：演进 quick-chat；实时 SSE 进度；中途追问输入框 POST inject；打断本轮 POST interrupt / 结束会话 POST end；权限弹窗 → task-11；会话历史回看 → task-11）。
- design **§7.2 REST**（4 个端点签名 + session_id/run_id/stream_url 返回）。
- design **§7.2 末段 session 级 SSE 聚合**（`GET /sessions/{id}/stream` 单连接贯穿多 turn，事件带 `run_id`）。
- design **§9 兼容**（未配置交互式会话时行为不变：旧 quick-chat 端点保留，前端回退路径）。
- design **§10 R-08**（跨 turn 切换 run_id 失序 → 前端按 run_id 分组渲染）。
- decisions.md **D-005@v1**（三元关系 + session 级 SSE 聚合）。
- plan.md **task-10 行**（runtimes/page.tsx + lib/daemon.ts）。
- requirements.md **FR-10**（会话面板 UI）+ **Q1**（前端管控台演进 quick-chat）。
- `prototype-interactive-session.html` **② 交互式会话面板线框**：左侧会话列表（task-11）、中间消息流 + 输入 + 打断/结束按钮、右侧状态（本 task 做中间区 + 部分状态指示，左侧列表 / 右侧权限弹窗留 task-11）。
- 现状代码（必须对照）：
  - `frontend/src/lib/daemon.ts:56-70`（`quickChat`：`apiFetch` GET 拼参 POST，本 task 的 `createSession`/`injectSession` 改为 POST body JSON）。
  - `frontend/src/lib/daemon.ts:174-250`（`streamQuickChat`：EventSource + `getApiBaseUrl` + `accessToken` query 传 token + 扁平/聚合 payload 双形态识别；本 task `streamSession` 照此范式，事件形态不同）。
  - `frontend/src/lib/daemon.ts:121-160`（`QuickChatStreamMessage` + `_eventTypeFromChannel`：本 task 复用 channel→event_type 映射）。
  - `runtimes/page.tsx:367-843`（`QuickChatPanel` 整体：state `lastRunId`/`activeRunId`/`messages`/`sending`、`streamRun` 的 onMessage/onDone/onError + 60s 兜底回退、`handleSend` 的「completed 同步完成 / pending 占位 streaming」分支、provider/model 选择、AgentLogViewer 日志区、footer 输入框 + 发送按钮）。
  - `runtimes/page.tsx:481-517`（`renderStreamMessage`：text/tool_use/tool_result/error 分类渲染，跳过 `[SYSTEM|RESULT]` 系统消息；本 task 直接复用，传入 session 级事件包装后的 messages 数组）。

## 5. 实现步骤

### 5.1 `lib/daemon.ts` 新增 session 类型与 4 个 REST 调用

在文件末尾（`PROVIDER_META` 之前或之后均可，建议紧邻 quick-chat 区块之后）新增：

```ts
/* ---------- Interactive session (daemon-interactive-session / Wave4) ---------- */

export interface SessionCreateRequest {
  provider: string;
  prompt: string;
  model?: string | null;
  manual_approval?: boolean;
}

export interface SessionCreateResponse {
  session_id: string;
  run_id: string;
  lease_id: string;
  stream_url: string;
}

export interface SessionInjectResponse {
  run_id: string;
}

export interface SessionControlResponse {
  session_id: string;
  status: string;
}

/**
 * 创建交互式会话 + 首 prompt（建 AgentSession + interactive lease + 首 turn AgentRun）。
 * 对接 task-04 POST /api/daemon/sessions。
 */
export async function createSession(
  req: SessionCreateRequest,
): Promise<SessionCreateResponse> {
  return apiFetch<SessionCreateResponse>("/api/daemon/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

/**
 * 向 active 会话注入新 prompt（= 新 turn AgentRun）。
 * 对接 task-04 POST /api/daemon/sessions/{id}/inject。
 */
export async function injectSession(
  sessionId: string,
  prompt: string,
): Promise<SessionInjectResponse> {
  return apiFetch<SessionInjectResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/inject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    },
  );
}

/**
 * 打断当前 turn（SIGINT / turn interrupt），会话保持 active 可继续追问（FR-04）。
 * 对接 task-04 POST /api/daemon/sessions/{id}/interrupt。
 */
export async function interruptSession(
  sessionId: string,
): Promise<SessionControlResponse> {
  return apiFetch<SessionControlResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/interrupt`,
    { method: "POST" },
  );
}

/**
 * 结束会话（kill 进程 + session 标 ended）。与 interrupt 分离（FR-05）。
 * 对接 task-04 POST /api/daemon/sessions/{id}/end。
 */
export async function endSession(
  sessionId: string,
): Promise<SessionControlResponse> {
  return apiFetch<SessionControlResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: "POST" },
  );
}
```

要点：
- **POST body JSON**（不再像旧 `quickChat` 用 query 串拼 prompt）—— prompt 可能较长且含特殊字符，body 更稳。
- **`apiFetch` 已自带 `x-request-id` + accessToken header**（lib/api.ts），session REST 直接复用，无需手动塞 token。
- **错误处理**：`apiFetch` 抛 `ApiError`（含 code/message/details），调用方 catch 后映射成 UI 提示（404 session 不存在 / 409 session 非 active / 504 daemon 离线）。

### 5.2 `lib/daemon.ts` 新增 `streamSession` SSE 订阅 + 事件类型

紧邻 `streamQuickChat` 之后新增。事件 payload 对齐 task-05 §5.1（`log` / `messages` / `session_ended`，全部带 `run_id`）。

```ts
/* ---------- Interactive session SSE stream (task-05 GET /sessions/{id}/stream) ---------- */

/**
 * task-05 session 级 Redis channel `agent_session:{id}` 上的事件结构。
 * 三类 event：log（单条日志透传，带 run_id）/ messages（批次 summary）/ session_ended（会话结束）。
 * 所有事件都带 run_id（session_ended 除外），前端据此区分 turn 边界（R-08）。
 *
 * 对齐 backend task-05 §5.1 的 publish payload。
 */
export type SessionStreamEvent =
  | {
      event: "log";
      session_id: string;
      run_id: string;
      channel: "stdout" | "stderr" | "tool_call";
      content: string;
      timestamp: string;
      log_id: string;
    }
  | {
      event: "messages";
      session_id: string;
      run_id: string;
      lease_id: string;
      count: number;
      agent_run_status?: string;
    }
  | {
      event: "session_ended";
      session_id: string;
      reason: "manual" | "idle" | "failed";
      status: "ended" | "failed";
    };

export interface SessionStreamDone {
  status?: string;
  reason?: string;
}

/**
 * 订阅交互式会话的实时事件流（SSE）。
 *
 * 单个 EventSource 连接贯穿整个会话（多 turn），无需在 turn 切换时重订阅（R-08 / D-005）。
 * 走 nextjs rewrite proxy（与 streamQuickChat 同款），用 query 传 accessToken。
 *
 * onEvent: 每条 Redis pub/sub message 触发一次（log / messages / session_ended）。
 * onDone: 会话结束（session_ended 事件 → backend 发 event:done）时触发。
 * onError: 连接异常（404/401/网络中断）。
 *
 * 返回 EventSource 句柄，调用方负责 .close()。
 */
export function streamSession(
  sessionId: string,
  onEvent: (_ev: SessionStreamEvent) => void,
  onDone: (_data: SessionStreamDone) => void,
  onError?: (_error: Error) => void,
): EventSource {
  const base = getApiBaseUrl();
  const { accessToken } = useSession.getState();
  const url = new URL(`${base}/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`);
  if (accessToken) url.searchParams.set("token", accessToken);

  const es = new EventSource(url.toString());

  es.onmessage = (e: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || !("event" in parsed)) return;
      onEvent(parsed as unknown as SessionStreamEvent);
    } catch {
      onError?.(new Error(`Failed to parse session SSE data: ${e.data}`));
    }
  };

  es.addEventListener("done", (e: MessageEvent<string>) => {
    es.close();
    let data: SessionStreamDone = {};
    try {
      data = JSON.parse(e.data);
    } catch {
      // empty done data is valid
    }
    onDone(data);
  });

  es.onerror = () => {
    onError?.(new Error("Session EventSource connection error"));
    // 不在这里 close —— 同 streamQuickChat：让浏览器自动重连，业务侧用兜底 timer。
  };

  return es;
}
```

要点：
- **`onmessage` 收所有未命名 event**：backend（task-05 §5.4）用 `yield f"data: {data}\n\n"` 发 log/messages，用 `yield f"event: done\ndata: ..."` 发 done。前者落到 `onmessage`，后者落到 `addEventListener("done")`。`session_ended` 事件由 backend 转成 `event: done`（task-05 §5.4 L291-297），前端不会直接收到 `event: session_ended` 作为 message——**但保留类型分支以防 backend 透传**。
- **token 走 query**：EventSource 不支持自定义 header，与 `streamQuickChat` 同款（daemon.ts:181-183）。
- **不解析双形态**：task-05 的 session channel 只发结构化 JSON（不像 run channel 有扁平/聚合两种历史形态），前端只认 `event` 字段分发。

### 5.3 `runtimes/page.tsx` `QuickChatPanel` 升级为会话面板

**state 扩展**（在现有 `lastRunId`/`activeRunId`/`messages`/`sending` 基础上）：

```ts
// 会话级状态（替代 lastRunId 作为「当前会话」标识）
const [sessionId, setSessionId] = useState<string | null>(null);
const [sessionStatus, setSessionStatus] = useState<"idle" | "active" | "ended" | "failed">("idle");
const [currentRunId, setCurrentRunId] = useState<string | null>(null); // 当前 turn 的 run_id（用于日志面板）
const [actioning, setActioning] = useState<"interrupt" | "end" | null>(null); // 按钮加载态
// 多 turn 分组：把 streamSession 收到的事件按 run_id 归属到对应 agent 消息
const runIdToMsgIndexRef = useRef<Map<string, number>>(new Map());
```

> `lastRunId` 保留但语义改为「上一轮完成的 run_id」（用于 fallback GET），主流程用 `sessionId`。`activeRunId` 改为跟随 `currentRunId`（当前 turn），日志面板 `AgentLogViewer` 仍按 run_id 拉日志（与现状一致，每个 turn 一个 run_id）。

**SSE 订阅切换**：把 `streamRun(runId)`（run 级）替换为 `streamSession(sid)`（session 级），但保留 run 级 `getQuickChatResult` 作兜底。

### 5.4 `handleSend` 改造：首 prompt → createSession，后续 → injectSession

```ts
const handleSend = async () => {
  const prompt = input.trim();
  if (!prompt || sending || !hasOnlineProvider) return;
  if (sessionStatus === "ended" || sessionStatus === "failed") return; // 已结束的会话不允许追问

  setMessages((prev) => [...prev, { role: "user", content: prompt }]);
  setInput("");
  setSending(true);

  try {
    if (!sessionId) {
      // ── 首 prompt：建会话 + 首 turn ──
      const resp = await createSession({
        provider,
        prompt,
        model,
        manual_approval: false, // Wave1 默认自动批准，Wave2 task-07 加开关
      });
      setSessionId(resp.session_id);
      setSessionStatus("active");
      setCurrentRunId(resp.run_id);
      setActiveRunId(resp.run_id);
      setShowLogs(true);
      setRunLogs(null);
      // 占位 agent 消息（streamSession 期间填充）
      setMessages((prev) => [...prev, { role: "agent", content: "..." }]);
      runIdToMsgIndexRef.current.set(resp.run_id, messages.length + 1); // +1 因为已 push 用户消息
      await streamSessionEvents(resp.session_id);
    } else {
      // ── 后续 prompt：inject 新 turn ──
      const resp = await injectSession(sessionId, prompt);
      setCurrentRunId(resp.run_id);
      setActiveRunId(resp.run_id);
      setRunLogs(null);
      // 新 turn 新占位 agent 消息
      setMessages((prev) => {
        const idx = prev.length; // push 后的 index
        runIdToMsgIndexRef.current.set(resp.run_id, idx);
        return [...prev, { role: "agent", content: "..." }];
      });
      // 不重启 SSE —— streamSession 单连接贯穿，inject 后新 turn 的事件自动到达（R-08 核心）
    }
  } catch (err) {
    setMessages((prev) => [
      ...prev,
      {
        role: "agent",
        content: `错误：${err instanceof ApiError ? err.message : "发送失败"}`,
      },
    ]);
  } finally {
    setSending(false);
  }
};
```

要点：
- **inject 不重订阅 SSE**：这是 session 级 SSE 相对 run 级的核心优势（task-05 §1 / R-08）。SSE 在 createSession 时启动一次，inject 后新 turn 事件自动通过同一连接到达，前端按 `run_id` 路由到对应消息。
- **`runIdToMsgIndexRef`**：把每个 run_id 映射到 messages 数组的 index，streamSession 收到事件时据此找到要追加的 agent 消息（多 turn 不串）。
- **`sessionStatus` 守卫**：已 ended/failed 的会话不允许再 inject（backend 也会 409，前端先拦一层 UX 更好）。

### 5.5 `streamSessionEvents`：消费 session 级事件，按 run_id 分组渲染

替代现有 `streamRun`。复用 `renderStreamMessage`（L481-517）—— 把 session 级 `log` 事件包装成 `QuickChatStreamMessage` 形态喂给它。

```ts
const streamSessionEvents = (sid: string): Promise<void> => {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };

    // 60s 内没收到任何 log/messages → 视为连接异常，给提示（session 级 SSE 不做 GET 兜底，
    // 因为没有「单 run 最终结果」可拉；联调时若发现频繁超时，再考虑拉 session 状态）
    fallbackTimerRef.current = setTimeout(() => {
      if (!settled && !receivedAnyRef.current) {
        settled = true;
        cleanup();
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "agent" && (!last.content || last.content === "...")) {
            updated[updated.length - 1] = { role: "agent", content: "(连接超时，请检查 daemon 是否在线)" };
          }
          return updated;
        });
        resolve();
      }
    }, 60_000);

    const es = streamSession(
      sid,
      (ev) => {
        receivedAnyRef.current = true;
        if (ev.event === "log") {
          // 包装成 QuickChatStreamMessage 复用 renderStreamMessage
          const wrapped: QuickChatStreamMessage = {
            event: "messages",
            lease_id: "",
            count: 1,
            messages: [
              {
                event_type: _eventTypeFromChannel(ev.channel),
                content: ev.content,
              },
            ],
          };
          const text = renderStreamMessage(wrapped);
          if (!text) return;
          appendAgentText(ev.run_id, text);
        } else if (ev.event === "messages") {
          // 批次 summary：当前不渲染（count/agent_run_status 仅作状态指示），可更新 turn 计数
          // 预留：若 agent_run_status === "failed" 可标红当前 turn
        }
        // session_ended 不会到这里（backend 转 event:done）
      },
      (data) => {
        // onDone：会话结束
        if (settled) return;
        settled = true;
        cleanup();
        setSessionStatus(data.status === "failed" ? "failed" : "ended");
        // 若当前 turn 还在占位（agent 一字未吐），补提示
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "agent" && (!last.content || last.content === "...")) {
            updated[updated.length - 1] = {
              role: "agent",
              content: data.status === "failed" ? "(会话异常结束)" : "(会话已结束)",
            };
          }
          return updated;
        });
        resolve();
      },
      () => {
        // onError：SSE 连不上。session 级无 GET 兜底，仅提示。
        if (!settled && !receivedAnyRef.current) {
          // 让 60s timer 兜底，避免重复提示
        }
      },
    );
    eventSourceRef.current = es;
  });
};

/** 把文本追加到 run_id 对应的 agent 消息（多 turn 分组核心）。 */
const appendAgentText = (runId: string, text: string) => {
  const idx = runIdToMsgIndexRef.current.get(runId);
  if (idx === undefined) return;
  setMessages((prev) => {
    if (idx >= prev.length) return prev;
    const target = prev[idx];
    if (target?.role !== "agent") return prev;
    const prevContent = target.content === "..." ? "" : target.content;
    const updated = [...prev];
    updated[idx] = {
      role: "agent",
      content: prevContent + (prevContent && !prevContent.endsWith("\n") ? "" : "") + text,
    };
    return updated;
  });
};
```

要点：
- **复用 `renderStreamMessage`**：不重写渲染逻辑，把 session 级 `log` 事件包装成单元素 `messages` 数组的 `QuickChatStreamMessage`，现有 text/tool_use/tool_result/error 分类与 `[SYSTEM|RESULT]` 过滤逻辑全部沿用。
- **`_eventTypeFromChannel`**：复用 daemon.ts:151-160 的映射（stdout→text / stderr→error / tool_call→tool_use）。
- **按 run_id 路由**：`appendAgentText(runId, text)` 用 `runIdToMsgIndexRef` 定位 messages index，避免不同 turn 的输出串到同一条消息（R-08）。
- **session 级无 GET 兜底**：与 run 级 `streamRun` 不同，session 没有单个「最终结果」可拉；超时仅提示，不轮询。联调若发现需要，可拉 `GET /api/daemon/sessions/{id}`（task-04 未提供 GET，本 task 不依赖）。

### 5.6 新增「打断本轮」/「结束会话」按钮（参照 prototype 线框）

在 footer 输入框右侧（现有发送按钮之后）加两个按钮，仅在 `sessionId` 存在且 `sessionStatus === "active"` 时启用：

```tsx
// footer 内，发送按钮之后
{sessionId && sessionStatus === "active" && (
  <>
    <Button
      variant="outline"
      onClick={handleInterrupt}
      disabled={actioning !== null || !currentRunId}
      className="h-10 shrink-0 gap-1.5 px-3"
      title="打断当前 turn（保留会话，可继续追问）"
    >
      {actioning === "interrupt" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
      <span className="hidden sm:inline">打断本轮</span>
    </Button>
    <Button
      variant="destructive"
      onClick={handleEnd}
      disabled={actioning !== null}
      className="h-10 shrink-0 gap-1.5 px-3"
      title="结束会话（kill 进程，不可继续）"
    >
      {actioning === "end" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
      <span className="hidden sm:inline">结束会话</span>
    </Button>
  </>
)}
```

> 图标沿用已 import 的 `Ban` / `Power` / `RefreshCw`（page.tsx:6/16/17），不新增 import。

**`handleInterrupt`**：

```ts
const handleInterrupt = async () => {
  if (!sessionId || actioning) return;
  setActioning("interrupt");
  try {
    await interruptSession(sessionId);
    // backend 推 daemon:session_interrupt → daemon SIGINT → 当前 turn 的 AgentRun 标 cancelled
    // session 级 SSE 不会因此发 done（session 仍 active），前端仅 UX 反馈
    // 当前 turn 占位消息若未填充，补一句提示
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "agent" && last.content === "...") {
        updated[updated.length - 1] = { role: "agent", content: "(本轮已打断，可继续追问)" };
      }
      return updated;
    });
  } catch (err) {
    setError(err instanceof ApiError ? err.message : "打断失败");
  } finally {
    setActioning(null);
  }
};
```

**`handleEnd`**：

```ts
const handleEnd = async () => {
  if (!sessionId || actioning) return;
  setActioning("end");
  try {
    await endSession(sessionId);
    // backend 推 daemon:session_end + publish session_ended → streamSession 收 event:done
    // onDone 内会 setSessionStatus("ended") + 清理 SSE
    // 这里不重复 setStatus，让 SSE done 回调统一处理（避免竞态）
  } catch (err) {
    // 即便 backend 报错（daemon 离线 504），DB 侧 session 已标 ended（task-04 §5.6 步骤 3 不阻塞）
    // 前端仍按 ended 处理
    setSessionStatus("ended");
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setError(err instanceof ApiError ? err.message : "结束失败");
  } finally {
    setActioning(null);
  }
};
```

要点：
- **interrupt 不改 sessionStatus**：仍是 active（FR-04 核心，打断 ≠ 结束）。
- **end 依赖 SSE done 回调收尾**：backend `end_session` publish `session_ended` → streamSession onDone → setSessionStatus("ended") + cleanup。若 SSE 已断（极端），catch 内手动 setStatus。
- **按钮加载态**：`actioning` 区分 interrupt/end，避免重复点击。

### 5.7 「新建会话」按钮收尾逻辑对齐

现有「新建会话」按钮（L690-705）清空 `lastRunId`/`activeRunId`/`messages`/`showLogs`。扩展为清空 session 状态：

```ts
onClick={() => {
  // 若当前会话仍 active，先静默结束（不阻塞 UX；backend 会处理 daemon 离线）
  if (sessionId && sessionStatus === "active") {
    void endSession(sessionId).catch(() => {});
  }
  if (eventSourceRef.current) {
    eventSourceRef.current.close();
    eventSourceRef.current = null;
  }
  setSessionId(null);
  setSessionStatus("idle");
  setCurrentRunId(null);
  setActiveRunId(null);
  setLastRunId(null);
  setMessages([]);
  setShowLogs(false);
  setRunLogs(null);
  runIdToMsgIndexRef.current.clear();
}}
```

要点：
- **静默 end 旧会话**：用户点「新建」时若旧会话还 active，后台调 end（不 await，不阻塞 UX）。daemon 离线时 backend 仍标 ended（task-04 §5.6 步骤 3）。
- **清空 runId 映射**：`runIdToMsgIndexRef.clear()` 避免下一会话的 run_id 撞到旧 index。

### 5.8 头部状态指示（参照 prototype 右侧「会话状态」精简版）

在 header 的 `lastRunId` 显示位（L684）改为显示 `sessionId` + `sessionStatus` pill：

```tsx
<p className="text-[11px] text-muted-foreground">
  {sessionId
    ? `会话 ${shortId(sessionId)} · ${sessionStatusLabel(sessionStatus)}`
    : "新的本地会话"}
</p>
```

加一个小的状态辅助函数：

```ts
function sessionStatusLabel(status: "idle" | "active" | "ended" | "failed"): string {
  switch (status) {
    case "active": return "进行中";
    case "ended": return "已结束";
    case "failed": return "异常";
    default: return "待发起";
  }
}
```

> prototype 右侧「会话状态」面板（session/lease/agent_sid/turn/权限模式）属 task-11 的会话详情侧栏，本 task 仅做 header 精简指示，不引入右侧栏布局改动。

### 5.9 卸载清理 + 状态守卫

- **现有卸载 useEffect（L399-414）已关闭 eventSource + 清 timer**：本 task 不改结构，eventSource 现在装的是 session 级 EventSource，close 行为一致。
- **组件卸载时静默 end 会话**（可选 UX，避免悬挂 session）：在卸载 useEffect 内补 `if (sessionId && sessionStatus === "active") void endSession(sessionId).catch(() => {})`。但这会在页面切换时结束会话——**本 task 默认不做**（用户可能切 tab 回来继续），留 task-11 决策（会话列表 + 持久化后跨页面恢复）。
- **provider 切换时清会话**（L726-729 现有逻辑）：切换 provider 会 `setLastRunId(null)`，扩展为清 `sessionId`/`sessionStatus`/`currentRunId`（不同 provider 不能共用 session）。同时静默 end 旧 session。

### 5.10 回退路径（§9 兼容）

若 task-04/05 后端端点未就绪（404/501），`createSession` 抛 `ApiError`，`handleSend` catch 后在聊天框显示错误。**不自动回退到旧 quick-chat**（避免双链路混乱）；用户看到错误后可手动刷新或等后端就绪。旧 `quickChat` / `streamQuickChat` 函数保留在 `lib/daemon.ts`（不删），供其他页面或回退调试用。

> 本项目未上线、数据可清空（CLAUDE.md 规则 7），前端无需做「检测后端版本自动切换新旧链路」的兼容逻辑。

## 6. 接口定义（最终签名汇总）

```ts
// lib/daemon.ts 新增
export interface SessionCreateRequest { provider: string; prompt: string; model?: string | null; manual_approval?: boolean; }
export interface SessionCreateResponse { session_id: string; run_id: string; lease_id: string; stream_url: string; }
export interface SessionInjectResponse { run_id: string; }
export interface SessionControlResponse { session_id: string; status: string; }
export type SessionStreamEvent = /* log | messages | session_ended，见 §5.2 */;
export interface SessionStreamDone { status?: string; reason?: string; }

export function createSession(req: SessionCreateRequest): Promise<SessionCreateResponse>;
export function injectSession(sessionId: string, prompt: string): Promise<SessionInjectResponse>;
export function interruptSession(sessionId: string): Promise<SessionControlResponse>;
export function endSession(sessionId: string): Promise<SessionControlResponse>;
export function streamSession(
  sessionId: string,
  onEvent: (_ev: SessionStreamEvent) => void,
  onDone: (_data: SessionStreamDone) => void,
  onError?: (_error: Error) => void,
): EventSource;
```

## 7. 完成标准（AC）

| AC# | 验收项 | 验证方式 | 关联 |
|---|---|---|---|
| AC-01 | 首次输入 prompt → 调 `POST /api/daemon/sessions`，返回 `{session_id, run_id, ...}`；面板 header 显示「会话 xxx · 进行中」 | 手动 + 单测（mock fetch） | FR-10 / FR-01 |
| AC-02 | 首 turn SSE 启动（`GET /sessions/{id}/stream`），agent 输出实时追加到首条 agent 消息 | 手动 + 单测（mock EventSource） | FR-10 / FR-03 |
| AC-03 | 中途追问（首 turn 进行中或完成后输入第二个 prompt）→ 调 `POST /sessions/{id}/inject`，新 turn 的输出**追加为新 agent 消息**（按 run_id 分组，不串到首 turn 消息） | 手动 + 单测（多 turn run_id 路由） | FR-10 / FR-02 / R-08 |
| AC-04 | inject 后**不重订阅 SSE**：同一 EventSource 连接接收两个 turn 的事件（grep 确认 handleSend 的 inject 分支未调 streamSession） | 单测 + 代码审查 | FR-03 / D-005 / R-08 |
| AC-05 | 「打断本轮」按钮：POST `/interrupt` 成功；sessionStatus 仍 active；当前 turn 占位消息补「(本轮已打断)」；输入框仍可继续追问 | 手动 + 单测 | FR-10 / FR-04 |
| AC-06 | 「结束会话」按钮：POST `/end` 成功 → SSE 收 `event:done` → sessionStatus=ended；按钮区禁用；输入框禁用追问 | 手动 + 单测 | FR-10 / FR-05 |
| AC-07 | 会话结束后（ended/failed），输入框/发送按钮禁用，header 显示「已结束」/「异常」 | 手动 | FR-10 UX |
| AC-08 | 「新建会话」按钮：清空 sessionId/messages/runId 映射；若旧会话 active 则后台静默 end | 手动 + 单测 | FR-10 UX |
| AC-09 | 切换 provider：清空当前 session 状态（静默 end 旧 session），下次输入走新 createSession | 手动 | UX 一致性 |
| AC-10 | SSE 连接异常（onerror / 60s 无消息）：占位 agent 消息提示「(连接超时...)」；不卡死面板 | 单测（fake timer + mock EventSource error） | 稳健性 |
| AC-11 | 404（session 不存在）/ 409（session 非 active）/ 504（daemon 离线）：catch ApiError，聊天框显示后端 message | 单测（mock fetch 返回各状态） | 错误处理 |
| AC-12 | 现有 quick-chat 旧函数（`quickChat`/`streamQuickChat`）保留未删，不影响其他潜在引用（grep 确认无回归） | 代码审查 | §9 兼容 |
| AC-13 | `cd frontend && pnpm build` 通过（TypeScript 编译 + Next.js 构建） | 构建命令 | 工程约束 |
| AC-14 | `cd frontend && pnpm test`（vitest）通过，含新增会话面板单测 | 测试命令 | 工程约束 |
| AC-15 | 端到端（需 task-04/05 合并）：发起会话 → 首 turn 出结果 → 中途追问第二 turn 出结果 → 打断 → 结束，全链路 UI 可用，参照 prototype 线框 | 手动联调 | plan.md 全局 AC-1/2/3 |

## 8. 测试要点（vitest + @testing-library/react）

新增测试文件 `frontend/src/app/(dashboard)/runtimes/__tests__/session-panel.test.tsx`（或扩展现有 runtimes 测试）。Mock 策略：
- `@/lib/daemon` 的 `createSession`/`injectSession`/`interruptSession`/`endSession` 用 `vi.mock` 替换为 `vi.fn()`。
- `streamSession` mock 为返回一个 fake EventSource（`{ onmessage, addEventListener, close, ... }`），测试代码手动触发 `onmessage`/`done` 回调。
- `@/stores/session` 提供 fake accessToken。
- `listDaemonRuntimes` mock 返回至少一个 online runtime（让 `hasOnlineProvider=true`）。

| # | 用例 | 给定 | 当 | 则 |
|---|---|---|---|---|
| T1 | 首 prompt 建 session | mock createSession 返回 `{session_id:"s1", run_id:"r1", ...}` | 输入 "hi" 点发送 | createSession 被调用一次（参数含 provider/prompt）；header 显示「会话 s1... · 进行中」；streamSession("s1") 被调用 |
| T2 | 首 turn SSE 渲染 | T1 后 mock streamSession onMessage 推 `{event:"log", run_id:"r1", channel:"stdout", content:"hello"}` | 触发回调 | 首条 agent 消息内容含 "hello"（占位 "..." 被替换） |
| T3 | 多 turn 分组 | T2 后再输入 "more" | 点发送 | injectSession("s1","more") 被调用；新 agent 消息 push（占位）；**不**再次调用 streamSession |
| T4 | 第二 turn 事件路由 | T3 后 mock 推 `{event:"log", run_id:"r2", channel:"stdout", content:"world"}`（r2 为 inject 返回的 run_id） | 触发回调 | 第二条 agent 消息内容含 "world"，首条 agent 消息内容**不变**（不串） |
| T5 | inject 追问时首 turn 未完成 | 首 turn agent 消息还是 "..."（agent 未吐字）时输入第二个 prompt | 点发送 | injectSession 调用；首 turn 占位保留或补提示；第二 turn 新占位 |
| T6 | 打断本轮 | active session + 当前 turn 占位 | 点「打断本轮」 | interruptSession("s1") 调用；sessionStatus 仍 active；占位消息变「(本轮已打断...)」 |
| T7 | 结束会话 | active session + SSE 已连 | 点「结束会话」 | endSession("s1") 调用；mock SSE done 回调触发 → sessionStatus=ended；输入框/按钮禁用 |
| T8 | ended 后不能再追问 | sessionStatus=ended | 输入并点发送 | handleSend 直接 return（不调 inject/createSession） |
| T9 | 新建会话清空 | active session + 有 messages | 点「新建会话」 | endSession 后台调用；sessionId=null；messages=[]；runId 映射清空 |
| T10 | 切换 provider 清空 | active session（provider=claude） | 切 provider 到 codex | 旧 session 静默 end；sessionId=null；下次输入走 createSession |
| T11 | createSession 错误 | mock createSession reject ApiError(503,"无在线 daemon") | 输入点发送 | 聊天框显示「错误：无在线 daemon」；sessionId 仍 null |
| T12 | inject 409（session 非 active） | mock injectSession reject ApiError(409) | 输入点发送 | 聊天框显示错误；sessionStatus 可标 ended（视后端 details） |
| T13 | SSE 超时兜底 | mock streamSession 60s 内不推任何消息 | 用 vitest fake timer 推进 60s | 占位消息变「(连接超时...)」；不卡死 |
| T14 | tool_use/error 事件渲染 | mock 推 `{event:"log", run_id:"r1", channel:"tool_call", content:"Read foo.ts"}` | 触发回调 | agent 消息含「🔧 tool: Read foo.ts」（复用 renderStreamMessage） |
| T15 | [SYSTEM|RESULT] 过滤 | mock 推 content="[SYSTEM:thread_started]" | 触发回调 | agent 消息内容**不含**该系统消息（renderStreamMessage 过滤） |

测试约束：
- 用 `@testing-library/react` 的 `render` / `fireEvent` / `screen` / `waitFor`。
- EventSource mock：`vi.stubGlobal("EventSource", class FakeES { ... })`，每个 case 构造可控实例。
- fake timer：`vi.useFakeTimers()` + `vi.advanceTimersByTime(60_000)` 测超时。
- 不依赖真实后端（纯前端单测）；端到端 AC-15 在 task-06 联调时覆盖。

## 9. 风险与注意

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-08（前端侧） | 跨 turn 切换 run_id 时事件串到错误消息 | P1 | `runIdToMsgIndexRef` 按 run_id 路由到 messages index；`appendAgentText` 严格校验 index 与 role；T4 单测覆盖 |
| SSE-断连 | session 级 EventSource 中途断（网络/Redis 重启），后端 task-05 §10 不做自动重订阅 | P2 | 浏览器 EventSource 默认自动重连；onerror 不 close 让其重连；60s 兜底提示。Wave3 task-09 崩溃恢复后可补显式重连 UX |
| inject 不重订阅假设 | 假设 session 级 SSE 在 inject 后自动收到新 turn 事件——依赖 task-05 双 publish 正确 | P1 | AC-04 显式验证（grep + 单测）；联调时 task-06 端到端覆盖（inject 后第二 turn 事件到达） |
| 占位消息竞态 | "..." 占位在 agent 首字到达前被 interrupt/end 替换 | P2 | appendAgentText/interrupt/end 各自检查 `content === "..."` 才替换；单测 T6/T7 覆盖 |
| 旧 quick-chat 共存 | 旧 `quickChat`/`streamQuickChat` 保留但本 task 不用，可能误调 | P2 | grep 确认 runtimes/page.tsx 不再 import 旧函数（仅留 createSession 等新函数）；旧函数保留供回退调试 |
| EventSource token query 泄露 | accessToken 在 URL，可能进 server log | P2 | 与现有 streamQuickChat 同款（daemon.ts:181-183 已用），接受既有风险；长期方案走 nextjs route handler proxy 加 header（本 task 不改） |
| Next.js 14 App Router 约定 | `(dashboard)` 路由组 + `"use client"` 组件，session SSE 在 client 跑 | P3 | 现状 QuickChatPanel 已是 client component，本 task 不改架构；EventSource 仅在浏览器可用，SSR 不触发（组件 client-only） |
| 多 turn 日志面板 | AgentLogViewer 按 activeRunId（= currentRunId）拉日志，turn 切换时日志面板切到新 run | P3 | 与现状行为一致（quick-chat 每轮切 run）；用户若想看历史 turn 日志，task-11 的会话历史回看解决；本 task 仅当前 turn |
| manual_approval 开关 | Wave1 默认 false，前端不暴露开关 UI | P3 | createSession 硬编码 `manual_approval: false`；Wave2 task-07/08 落地后 task-11 加开关 + 权限弹窗 |

## 10. 与其他 task 的边界

- **task-04（依赖）**：提供 4 个 session REST 端点。本 task 的 `createSession`/`injectSession`/`interruptSession`/`endSession` 直接调这些端点。task-04 的 `main.py` quick-chat 升级（prev_run_id → prev_session_id）**本 task 不依赖**——本 task 直接调 `/api/daemon/sessions*`，不走 `/api/daemon-chat`。
- **task-05（依赖）**：提供 `GET /api/daemon/sessions/{id}/stream` + session channel 事件结构（`log`/`messages`/`session_ended`，带 `run_id`）。本 task 的 `streamSession` + `SessionStreamEvent` 类型严格对齐 task-05 §5.1。
- **task-06（联调）**：Wave1 端到端验证「发起会话 → 首 turn → 中途追问第二 turn → 打断 → 结束」全链路（AC-15）。本 task 的前端在 task-06 联调时与 task-03 daemon / task-04 backend / task-05 SSE 一起验证。
- **task-11（被 blocks）**：会话列表 + 历史回看 + 权限批准弹窗。本 task 只做单会话面板；task-11 加左侧会话列表（prototype 左栏）、右侧详情/权限侧栏（prototype 右栏）、历史回看（拉 agent_sessions + 关联 AgentRunLog）。本 task 的 `sessionId` state 可提升到父组件供 task-11 列表切换。
- **task-07/08（Wave2 权限）**：manual_approval 开关 + permission_request 弹窗。本 task 不做权限 UI（createSession 硬编码 false）；task-11 接权限弹窗时复用本 task 的 session 面板布局。
- **task-09（Wave3 resume）**：daemon 重启恢复后，前端可能需要重连 SSE + 显示 reconnecting 状态。本 task 的 `sessionStatus` 预留 `"reconnecting"` 态（type 可扩展），task-09 落地时补重连 UX。

## 11. 实现顺序建议

1. 确认 task-04（4 个 REST 端点）+ task-05（session SSE 端点）已合并到工作分支；本地起 backend 手动 curl 验证端点存在。
2. `lib/daemon.ts` 加 session 类型 + 4 个 REST + `streamSession`（§5.1 / §5.2）——纯类型与 fetch 封装，可独立单测。
3. `runtimes/page.tsx` 改 `QuickChatPanel` state（§5.3）+ `handleSend` 分支（§5.4）——先跑通首 prompt → createSession → streamSession → 首 turn 渲染。
4. 加 `streamSessionEvents` + `appendAgentText`（§5.5）——多 turn 分组核心，单测 T2/T4。
5. 加打断/结束按钮（§5.6）+ 新建会话清空（§5.7）+ header 状态（§5.8）。
6. 写单测（§8）——T1-T15，重点 T3/T4（多 turn 路由）、T6/T7（打断/结束）、T13（超时）。
7. `cd frontend && pnpm test && pnpm build` 全绿。
8. 联调（task-06 时）：真实 daemon + backend，跑 AC-15 全链路；参照 prototype 线框对照 UI。
