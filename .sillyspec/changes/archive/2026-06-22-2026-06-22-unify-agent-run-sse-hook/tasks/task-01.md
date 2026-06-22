---
id: task-01
title: 新增 useAgentRunStream hook
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-02, FR-06, FR-07]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/use-agent-run-stream.ts
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
---

# task-01 新增 useAgentRunStream hook

> 本文件是 execute 子代理的唯一施工蓝图，读这一份即可动手。接口签名照搬 design.md §7.1，生命周期复刻 `page.tsx:284-342 connectBootstrapStream`。

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/lib/use-agent-run-stream.ts` | `useAgentRunStream` hook 唯一产物（types + function 同文件） |

- 本任务**不创建测试文件**（task-02 负责）、**不新增调用点**（task-05/06/07 负责）、**不改 agent-stream.ts / agent.ts / daemon.ts**（底层客户端与 API 层均不变）。
- `allowed_paths` 严格限定为单个新文件。若发现需要改动其它文件，停下并升级到 plan（不允许在 execute 阶段私扩路径）。

## 覆盖来源

| 来源 | 路径 / 锚点 | 取什么 |
|---|---|---|
| design §7.1 | `.sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/design.md` | 接口签名（照搬，见下「接口定义」） |
| design §7.3 | 同上 | 生命周期契约表（permission_request/resolved/done/dialogs/input 各事件处理） |
| design §11 | 同上 | D-001@v1（isActive 语义）、D-003@v1（dismissPerm 不调 API） |
| requirements FR-02 / FR-06 / FR-07 | `requirements.md` | GWT 验收点（活跃连接、非活跃只 prefetch、dialog 恢复） |
| 现有客户端 | `frontend/src/lib/agent-stream.ts:17-248` `AgentRunStreamClient` | hook 内部 new 出来的底层引擎，复用其 connect/disconnect/onMessage/onPermissionRequest/onPermissionResolved/onDone/onStatusChange |
| 现有 API | `frontend/src/lib/agent.ts:77 getAgentRun` / `:88 getAgentRunLogs` / `:182 submitAgentRunInput` / `:4 AgentRunStatus` / `:49 AgentRunLogEntry` | hook 内调用 + 类型 import |
| 现有 API | `frontend/src/lib/daemon.ts:360 SessionPermissionRequest` / `:385 SessionPermissionResolved` / `:481 fetchPendingDialogs` | perms 状态类型 + dialog 恢复 |
| token 来源 | `frontend/src/stores/session.ts:31` `useSession` | `useSession.getState().accessToken`（不订阅，getState 一次性取，避免组件重渲染） |
| 生命周期模板 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx:284-342 connectBootstrapStream` | hook useEffect 内复刻其 client 构造 + 5 个回调注册 + token 判空 + connect 调用 |

## 实现要求

### 步骤 1：文件骨架与 import

新建 `frontend/src/lib/use-agent-run-stream.ts`，顶部 import：

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentRunStreamClient,
  type StreamStatus,
} from "./agent-stream";
import {
  type AgentRun,
  type AgentRunLogEntry,
  type AgentRunStatus,
  getAgentRun,
  submitAgentRunInput,
} from "./agent";
import { type SessionPermissionRequest, fetchPendingDialogs } from "./daemon";
import { useSession } from "@/stores/session";
```

> 注意：`AgentRun` 仅用于 `getAgentRun` 返回值类型推断，无需单独 export 再用；若 lint 报「未使用」，移除该 import 仅保留 `AgentRunStatus`/`AgentRunLogEntry`。

### 步骤 2：状态声明（useState 一次性声明全部返回字段）

在 hook 函数体顶部：

```ts
const [logs, setLogs] = useState<AgentRunLogEntry[]>([]);
const [status, setStatus] = useState<AgentRunStatus | null>(null);
const [streaming, setStreaming] = useState(false);      // SSE connected/connecting（来自 client.onStatusChange）
const [loading, setLoading] = useState(false);           // prefetch 历史 / 建立连接中（D-001 + Grill X-004）
const [error, setError] = useState<string | null>(null);
const [perms, setPerms] = useState<SessionPermissionRequest[]>([]);

// pending_input 控件状态（FR-05，hook 持有，panel 负责 field 映射到 AgentLogInputControls）
const [inputValues, setInputValues] = useState<Record<string, string>>({});
const [submittingInputs, setSubmittingInputs] = useState<Record<string, boolean>>({});
const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
const [repliedInputs, setRepliedInputs] = useState<Set<string>>(new Set());

// 底层客户端 ref：cleanup 时 disconnect，避免重复连接
const clientRef = useRef<AgentRunStreamClient | null>(null);
```

### 步骤 3：dismissPerm（D-003 核心 —— 不调 API，仅本地 perms 移除）

```ts
const dismissPerm = useCallback((requestId: string) => {
  setPerms((prev) => prev.filter((r) => r.request_id !== requestId));
}, []);
```

> 关键约束（D-003@v1）：**禁止**在此调 `respondSessionPermission`。卡片 onResolved 与 SSE permission_resolved 两条路径都收敛到 `dismissPerm`，真正的决策 API 由 `PermissionApprovalCard`/`AskUserDialogCard` 自调。

### 步骤 4：input.submit（FR-05 pending_input 回复）

```ts
const setInputValue = useCallback((logId: string, value: string) => {
  setInputValues((prev) => ({ ...prev, [logId]: value }));
}, []);

const submitInput = useCallback(
  async (logId: string) => {
    const value = inputValues[logId] ?? "";
    if (!value.trim()) {
      setInputErrors((prev) => ({ ...prev, [logId]: "内容不能为空" }));
      return;
    }
    setSubmittingInputs((prev) => ({ ...prev, [logId]: true }));
    setInputErrors((prev) => {
      const next = { ...prev };
      delete next[logId];
      return next;
    });
    try {
      await submitAgentRunInput(workspaceId, runId!, { content: value });
      setRepliedInputs((prev) => {
        const next = new Set(prev);
        next.add(logId);
        return next;
      });
    } catch (err) {
      setInputErrors((prev) => ({
        ...prev,
        [logId]: err instanceof Error ? err.message : "提交失败",
      }));
    } finally {
      setSubmittingInputs((prev) => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
    }
  },
  [inputValues, workspaceId, runId],
);
```

> `runId!` 非空断言安全：submit 由 UI 触发，UI 存在即表示 runId 已绑。若 runId 为 null，panel 不渲染 input 控件（task-03 保证）。

### 步骤 5：clear（状态重置，调用点切 runId 时用）

```ts
const clear = useCallback(() => {
  setLogs([]);
  setStatus(null);
  setStreaming(false);
  setLoading(false);
  setError(null);
  setPerms([]);
  setInputValues({});
  setSubmittingInputs({});
  setInputErrors({});
  setRepliedInputs(new Set());
}, []);
```

### 步骤 6：useEffect 生命周期（核心，复刻 page.tsx:284-342）

```ts
useEffect(() => {
  // —— Guard 1：runId=null 不连接，直接返回 no-op cleanup（design §7.1 注释）——
  if (!runId) {
    clientRef.current = null;
    return;
  }

  // —— Guard 2：token 缺失 —— set error 不连（复刻 page.tsx:335-341）——
  const { accessToken } = useSession.getState();
  if (!accessToken) {
    setError("会话已失效，请重新登录后查看实时日志");
    setLoading(false);
    setStreaming(false);
    return;
  }

  setError(null);
  setLoading(true);

  // —— 构造底层客户端（每次 runId/isActive 变化都 new 一个新实例）——
  const client = new AgentRunStreamClient(workspaceId, runId);
  clientRef.current = client;

  // —— 注册 5 个回调（对应 AgentRunStreamClient 现有能力）——

  // (a) status：connected/connecting → streaming=true；error → setError
  client.onStatusChange((s: StreamStatus) => {
    setStreaming(s === "connecting" || s === "connected");
    if (s === "error") setError("连接失败，请重试");
    if (s === "connected") setLoading(false);
  });

  // (b) message：log 追加（按 log_id 去重，与 page.tsx:297-311 一致）
  client.onMessage((event) => {
    setLogs((prev) => {
      if (event.log_id != null && prev.some((l) => l.id === event.log_id)) {
        return prev;
      }
      return [
        ...prev,
        {
          id: event.log_id ?? _safeRuntimeId(),
          run_id: runId,
          timestamp: event.timestamp,
          channel: event.channel,
          content_redacted: event.content ?? "",
        },
      ];
    });
  });

  // (c) permission_request：perms 增（按 request_id 去重，D-003 FR-04）
  client.onPermissionRequest((req) => {
    setPerms((prev) =>
      prev.some((r) => r.request_id === req.request_id) ? prev : [...prev, req],
    );
  });

  // (d) permission_resolved：dismissPerm（D-003，与卡片 onResolved 收敛）
  client.onPermissionResolved((resolved) => {
    dismissPerm(resolved.request_id);
  });

  // (e) done：终态 status + 通知父 + disconnect
  client.onDone((data) => {
    if (data.status) setStatus(data.status as AgentRunStatus);
    options.onDone?.(data.status ?? "");
    client.disconnect();
  });

  // —— D-001 分叉：isActive=false 只 prefetch 历史、不连 SSE ——
  if (!isActive) {
    // AgentRunStreamClient.connect 内已先 getAgentRunLogs 再建 EventSource；
    // 但 isActive=false 时我们要的是「只 prefetch、不连」。底层 connect 会建
    // EventSource，所以不能直接调 connect —— 改为手动调 getAgentRunLogs。
    getAgentRunLogs(workspaceId, runId)
      .then((history) => {
        setLogs(history);
        setLoading(false);
      })
      .catch(() => {
        // prefetch 失败不阻断 UI，清 loading 让面板展示空态
        setLoading(false);
      });
    return; // ← 不调 client.connect
  }

  // —— isActive=true：dialog 恢复（FR-07）+ 连 SSE ——
  // FR-07：getAgentRun 取 session_id → fetchPendingDialogs 恢复未答 dialog，
  // 合并进 perms（按 request_id 去重）。失败不阻断 SSE 连接。
  getAgentRun(workspaceId, runId)
    .then((run) => {
      if (!run.session_id) return;
      return fetchPendingDialogs(run.session_id);
    })
    .then((dialogs) => {
      if (!dialogs || dialogs.length === 0) return;
      setPerms((prev) => {
        const existing = new Set(prev.map((r) => r.request_id));
        const merged = [...prev];
        for (const d of dialogs) {
          if (!existing.has(d.request_id)) {
            merged.push(d);
            existing.add(d.request_id);
          }
        }
        return merged;
      });
    })
    .catch(() => {
      /* FR-07 失败不影响主流程 */
    });

  // 连 SSE（非阻塞）
  void client.connect(accessToken);

  // —— cleanup：runId/isActive/workspaceId 变化或组件卸载时 disconnect（R-01）——
  return () => {
    client.disconnect();
    clientRef.current = null;
  };
}, [workspaceId, runId, isActive, options.onDone, dismissPerm]);
```

### 步骤 7：返回值组装

```ts
const input: AgentRunInputStream = {
  values: inputValues,
  submitting: submittingInputs,
  errors: inputErrors,
  replied: repliedInputs,
  set: setInputValue,
  submit: submitInput,
};

return {
  logs,
  status,
  streaming,
  loading,
  error,
  perms,
  dismissPerm,
  input,
  clear,
};
```

### 步骤 8：辅助函数 `_safeRuntimeId`

文件底部（非 export，仅本文件用，避免 crypto 依赖）：

```ts
function _safeRuntimeId(): string {
  // 浏览器环境优先 crypto.randomUUID；fallback 用时间戳+随机数（与 page.tsx safeUUID 同义）
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
```

### useEffect 生命周期控制流（伪代码摘要）

```
[runId=null?] ──yes──> return no-op（不连、不 reset，保留上次 logs 供历史页查看）
       │ no
       ▼
[token 空?] ──yes──> setError("会话已失效...") + setLoading(false) + return
       │ no
       ▼
new AgentRunStreamClient(workspaceId, runId)
注册 5 回调：onStatusChange / onMessage / onPermissionRequest / onPermissionResolved / onDone
       │
       ▼
[isActive=false?] ──yes──> getAgentRunLogs → setLogs → setLoading(false) → return（D-001）
       │ no（isActive=true）
       ▼
getAgentRun → session_id → fetchPendingDialogs → setPerms（按 request_id 去重，FR-07）【失败静默】
       │
       ▼
client.connect(accessToken)（非阻塞，内部已先 prefetch 再建 EventSource）
       │
       ▼
[组件卸载 / deps 变化] ──> cleanup：client.disconnect() + clientRef=null（R-01）
```

## 接口定义

> 照搬 design.md §7.1，逐字一致。execute 阶段若需微调签名须先回 plan。

```ts
// frontend/src/lib/use-agent-run-stream.ts

export interface UseAgentRunStreamOptions {
  /** run 状态 pending/running → 连 SSE；否则仅 prefetch 历史（D-001） */
  isActive: boolean;
  /** run 结束（done 事件）通知父组件 */
  onDone?: (status: string) => void;
  // 注：不设 enabled —— runId=null 已表达"不连接"（useEffect guard），避免 YAGNI（Grill X-001）。
}

export interface AgentRunInputStream {
  values: Record<string, string>;
  submitting: Record<string, boolean>;
  errors: Record<string, string>;
  replied: Set<string>;
  set: (logId: string, value: string) => void;
  /** 调 submitAgentRunInput(workspaceId, runId, {content})，成功标记 replied */
  submit: (logId: string) => Promise<void>;
}

export interface UseAgentRunStreamResult {
  logs: AgentRunLogEntry[];
  status: AgentRunStatus | null;
  streaming: boolean;
  loading: boolean; // prefetch 历史 / 建立连接中（Grill X-004，喂给 AgentLogViewer.loading）
  error: string | null;
  perms: SessionPermissionRequest[];
  /** 本地移除 perm（卡片 onResolved 与 SSE permission_resolved 均调，D-003） */
  dismissPerm: (requestId: string) => void;
  input: AgentRunInputStream;
  clear: () => void;
}

export function useAgentRunStream(
  workspaceId: string,
  runId: string | null,
  options: UseAgentRunStreamOptions,
): UseAgentRunStreamResult;
```

> 类型 `AgentRunLogEntry` / `AgentRunStatus` 从 `./agent` import；`SessionPermissionRequest` 从 `./daemon` import（均 export 已存在，见「覆盖来源」表）。

## 边界处理

| # | 边界场景 | 处理（须落到代码，不可遗漏） |
|---|---|---|
| B-01 | `runId === null` | useEffect Guard 1：不构造 client、不 set loading、不 setError、return no-op cleanup。`clientRef.current` 置 null。保留组件上次 `logs`（历史展开场景需要旧数据）。 |
| B-02 | `isActive === false`（D-001@v1 / FR-06） | useEffect 在「注册回调后」分叉：调 `getAgentRunLogs` 一次性拉历史 → setLogs → setLoading(false)；**不调** `client.connect`（底层 connect 会建 EventSource，违背 D-001）；**不调** `fetchPendingDialogs`（非活跃 run 无 pending dialog 语义）。callback 仍注册是为了 connect 内部 prefetch 路径能 emit log（防御性，实际 isActive=false 不连，callbacks 不会被触发）。 |
| B-03 | `accessToken` 为空（page.tsx:335-341 复刻） | useEffect Guard 2：`setError("会话已失效，请重新登录后查看实时日志")` + `setLoading(false)` + `setStreaming(false)` + return（不构造 client、不连）。下次 deps 变化或重新登录后组件重渲染会再走一次。 |
| B-04 | `runId` 切换（R-01 / FR-02） | deps 含 `runId`：旧 useEffect cleanup 执行 `client.disconnect()` + `clientRef.current=null`；新 useEffect 重新 new client。日志/perm/input 状态**不主动 clear**（调用点决定何时 clear，避免闪烁）；但调用点切 runId 时应先 `clear()` 再传新 runId（task-05/06/07 负责）。本 hook 不在 useEffect 内 clear，因为 React 18 StrictMode 双调用会清掉合法数据。 |
| B-05 | `fetchPendingDialogs` 失败（FR-07 容错） | `.catch(() => {})` 静默吞掉，不 setError、不阻断 SSE 连接。pending dialog 只是「锦上添花」的恢复，实时 SSE 仍会推新 permission_request。 |
| B-06 | 重复 `permission_request`（同 request_id 二次到达 / dialog 恢复与 SSE 重复） | `setPerms((prev) => prev.some(r => r.request_id === req.request_id) ? prev : [...prev, req])` —— 按 request_id 去重（与 page.tsx:324-328 一致，FR-04 GWT 第二条保证）。fetchPendingDialogs 合并也走同样去重（B-04 中合并循环用 `existing` Set 判重）。 |
| B-07 | `input.submit` 失败（网络/后端 400） | `try/catch`：catch 内 `setInputErrors((prev) => ({...prev, [logId]: err.message}))`；finally 清 `submittingInputs[logId]`；**不**标记 replied（用户可重试）。空内容：直接 setError「内容不能为空」、不发请求。 |
| B-08 | `options.onDone` 在闭包内过期（stale closure） | deps 含 `options.onDone`：deps 变化会触发重连（代价可接受，onDone 通常稳定）。若调用点用 inline 函数导致频繁重连，由调用点用 `useCallback` 包裹（task-05/06/07 实现时注意）。本 hook 不做 ref 兜底（YAGNI）。 |
| B-09 | 组件卸载时 SSE 仍在连接 | cleanup `client.disconnect()`：底层会 `es.close()` + 清 reconnectTimer + setStatus("disconnected")。setState after unmount 由 React 18 自动吞掉警告，无需额外 flag。 |

## 非目标

- **不创建测试文件**（task-02 负责 `use-agent-run-stream.test.ts`）。
- **不新增/修改调用点**（task-05/06/07 负责 4 调用点迁移）。
- **不改 `AgentRunStreamClient`**（底层引擎已具备全部能力，本任务只是状态化封装）。
- **不接管已完成 run 的历史展开**（design §3：`agent/page.tsx` expandedLogs + 下载按钮保持现状，调用点直接用 `getAgentRunLogs` + `<AgentLogViewer>`）。
- **不调 `respondSessionPermission`**（D-003@v1：决策 API 维持卡片自调，hook 只暴露 `dismissPerm` 做本地 perms 移除）。
- **不订阅 `useSession`**（用 `useSession.getState()` 一次性取 token，避免 hook 重渲染级联）。
- **不做 `enabled` 参数**（Grill X-001：runId=null 已表达不连，加 enabled 是 YAGNI）。
- **不在 hook 内 clear 状态**（clear 由调用点显式触发，避免 React 18 StrictMode 双调用副作用）。

## 参考：connectBootstrapStream 模式（page.tsx:284-342）

```ts
function connectBootstrapStream(runId: string) {
  closeBootstrapStream();                              // ← 关旧连接（hook 用 useEffect cleanup 替代）
  const client = new AgentRunStreamClient(workspaceId, runId);
  streamClientRef.current = client;                    // ← hook 用 clientRef

  client.onStatusChange((status) => { ... });          // ← hook (a)
  client.onMessage((event) => { setBootstrapLogs(...) }); // ← hook (b)
  client.onDone((data) => { ...; client.disconnect(); }); // ← hook (e)
  client.onPermissionRequest((req) => { setBootstrapPerms(去重) }); // ← hook (c)
  client.onPermissionResolved((resolved) => { setBootstrapPerms(移除) }); // ← hook (d)

  const { accessToken } = useSession.getState();
  if (accessToken) {
    void client.connect(accessToken);                  // ← hook 最后一步
  } else {
    setBootstrapError("会话已失效...");                 // ← hook Guard 2
  }
}
```

hook 与之的差异：
1. 5 回调注册逻辑搬进 useEffect，cleanup 用 `client.disconnect()` 替代 `closeBootstrapStream()`。
2. 增加 D-001 分叉：`isActive=false` 走 `getAgentRunLogs` 不连 SSE。
3. 增加 FR-07 dialog 恢复：`isActive=true` 时先 `getAgentRun → fetchPendingDialogs`。
4. `dismissPerm` 抽成独立 `useCallback`（卡片 onResolved 与 SSE resolved 共用）。
5. 新增 `input`（pending_input 三处统一）与 `loading`（Grill X-004）字段。

## TDD 步骤

> 本任务只产出 hook 文件，**不写测试**（task-02 写测试）。但实现时须按 task-02 即将覆盖的用例方向编码，保证可测：

1. **RED 列出 task-02 将写的用例**（本任务执行时在脑中对照，不落盘）：
   - `isActive=true + runId + token` → 返回完整 9 字段；`client.connect` 被调用。
   - `isActive=false`（FR-06）→ `client.connect` **不**被调用；`getAgentRunLogs` 被调用；logs 填充。
   - `runId=null` → 不构造 client；无 SSE。
   - `token` 空 → `error === "会话已失效..."`；不连。
   - `runId` 切换：先 disconnect 旧 client，再 new 新 client（mock `AgentRunStreamClient` 断言调用次序）。
   - `permission_request` mock 触发 onPermissionRequest → perms 含该 req；再触发同 request_id → perms 长度不变（去重）。
   - `permission_resolved` → perms 移除对应 requestId。
   - `dismissPerm(requestId)` 直接调 → perms 移除（不调 respondSessionPermission）。
   - `input.submit(logId)` → 调用 `submitAgentRunInput`；成功后 `replied.has(logId)===true`。
   - `input.submit` 空内容 → `errors[logId]==="内容不能为空"`、不调 submitAgentRunInput。
   - `onDone(data)` → `status` 更新 + `options.onDone` 被调 + client.disconnect。
2. **GREEN 写实现**：按上文「实现要求」步骤 1-8 落码，保证回调签名与 mock 可注入（AgentRunStreamClient 的 5 个 on* 方法返回 unsubscribe，hook 内不必持有返回值——client.disconnect 时统一清掉）。
3. **REFACTOR**：确保 `useCallback` deps 正确（dismissPerm 为 `[]`、submitInput 含 `[inputValues, workspaceId, runId]`、clear 为 `[]`），避免 lint 警告。
4. **本任务交付前自测**（不写 test 文件，但须在脑中 dry-run 用例 1-11 全 pass）。

## 验收标准

| AC | 场景 | 期望 | 检查方式 |
|---|---|---|---|
| AC-01 | 文件存在且唯一 | `frontend/src/lib/use-agent-run-stream.ts` 创建；`grep -r useAgentRunStream frontend/src` 仅本文件 export（调用点迁移在 task-05/06/07） | `Glob` / `Grep` |
| AC-02 | 接口签名一致 | `export function useAgentRunStream(workspaceId: string, runId: string \| null, options: UseAgentRunStreamOptions): UseAgentRunStreamResult` 与 design §7.1 逐字一致；`UseAgentRunStreamOptions` / `AgentRunInputStream` / `UseAgentRunStreamResult` 三 interface 字段全齐（含 `loading`，无 `enabled`） | 人工 diff design §7.1 |
| AC-03 | 类型可编译 | `cd frontend && pnpm typecheck` exit 0（hook 无类型错误；import 路径正确） | bash |
| AC-04 | Lint 通过 | `cd frontend && pnpm lint` 对本文件无 error/warning（useCallback deps 完整、无 unused import） | bash |
| AC-05 | D-001 落地 | 源码内能定位 `if (!isActive)` 分叉，分支内调 `getAgentRunLogs` 且**不**调 `client.connect`；isActive=true 分支调 `client.connect(accessToken)` | grep / 读源 |
| AC-06 | D-003 落地 | `dismissPerm` 函数体仅 `setPerms(filter)`；全文 `grep respondSessionPermission` **无**结果（hook 不调决策 API） | grep |
| AC-07 | FR-07 dialog 恢复 | 源码内 `getAgentRun` → `run.session_id` → `fetchPendingDialogs` 链路存在；合并 perms 按 `request_id` 去重（含 `existing.has` 判重） | 读源 |
| AC-08 | token 来源 | `useSession.getState().accessToken`（非 `useSession((s)=>s.accessToken)` 订阅）；空 token 走 `setError("会话已失效...")` 分支 | grep / 读源 |
| AC-09 | R-01 生命周期 | useEffect cleanup return 内含 `client.disconnect()`；deps 数组含 `[workspaceId, runId, isActive, options.onDone, dismissPerm]` | 读源 |
| AC-10 | 5 回调齐 | 源码内能定位 `onStatusChange` / `onMessage` / `onPermissionRequest` / `onPermissionResolved` / `onDone` 五处注册 | grep |
| AC-11 | 返回值完整 | return 对象含 `logs/status/streaming/loading/error/perms/dismissPerm/input/clear` 共 9 字段；`input` 含 `values/submitting/errors/replied/set/submit` 共 6 字段 | 读源 |
| AC-12 | 未触及 allowed_paths 外文件 | `git diff --name-only` 仅 `frontend/src/lib/use-agent-run-stream.ts`（新文件）；无 agent-stream.ts / agent.ts / daemon.ts / page.tsx 改动 | bash |
| AC-13 | 底层零改动 | `git diff frontend/src/lib/agent-stream.ts frontend/src/lib/agent.ts frontend/src/lib/daemon.ts` 为空 | bash |

完成 AC-01..AC-13 全部 pass 后，task-01 交付，task-02（单测）/task-03（panel）解锁。
