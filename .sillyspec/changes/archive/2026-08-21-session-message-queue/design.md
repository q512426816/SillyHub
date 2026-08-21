---
author: qinyi
created_at: 2026-08-21T16:30:00
change: 2026-08-21-session-message-queue
scale: large
---

# 会话消息排队 + 组件统一

## 1. 背景与目标

### 问题
当前会话输入框在以下状态被禁用，用户无法输入：
- **`running`**（currentRunId 有值）→ "等待本轮完成..."
- **`reconnecting`**（daemon 恢复中）→ "恢复会话中…"
- **`ended`/`failed`** → "会话已结束，请新建会话"

用户期望：输入框始终可用，只有终态和离线才真正禁用。running/reconnecting 时消息排队，等条件满足后自动投递。

### 目标
1. 消息队列：输入框始终可用（除终态/离线），running/reconnecting 时消息排队
2. 自动投递：turn 结束或 reconnecting → active 后，自动取出队列第一条发送
3. 队列可视化：显示排队条目，支持删除、失败标记
4. 组件统一：`/runtimes` 页面的 `interactive-session-panel.tsx` 替换为 `/sessions` 页面的共享会话面板

### 非目标
- 后端改动（inject 仍需 status=active，前端负责时序）
- 跨窗口消息队列（单浏览器 tab 内）
- 消息优先级/重排序

## 2. 设计决策

### D-001 前端队列等 active（而非后端放行 reconnecting）
**决策**：reconnecting 时前端把消息放进队列，等 status 变 active 后自动投递。后端 inject 仍检查 `status != "active"`。
**理由**：后端零改动，风险最低。reconnecting 通常几秒内完成（daemon 恢复），队列延迟可接受。
**替代**：后端放行 reconnecting 状态 — 需改 `_inject_into_session` 守卫，daemon 在 restoreAndReconnect 过程中可能未准备好接收 SESSION_INJECT。

### D-002 队列上限 5 条
**决策**：最多排队 5 条消息，超过时输入框显示提示，不接受更多排队。
**理由**：防止无限堆积。5 条足够覆盖用户连续输入场景。

### D-003 失败留在队列头部
**决策**：inject 返回错误时，消息留在队列头部，标记 `status: "failed"`。用户可点重试或删除。不自动跳过。
**理由**：给用户控制权。自动重试可能重复失败浪费资源。

### D-004 附件排队
**决策**：排队条目包含 `attachmentIds: string[]`。附件在上传时已落库（SessionAttachment），排队只引用 id。发送时一次性带附件 ids。
**理由**：附件上传与消息发送解耦，排队不影响附件生命周期。

### D-005 组件统一策略
**决策**：从 `sessions/page.tsx` 提取 `SessionPanel` 作为共享组件。`interactive-session-panel.tsx` 同一变更内替换为 `SessionPanel`。
**理由**：用户明确要求统一会话组件。提取后两页面共享同一套 UI + 队列逻辑。
**风险**：`interactive-session-panel.tsx` 有约 1300 行代码，弹窗上下文（useAttach/useQuery 等）与 page 不同，需适配 props 接口。

**统一策略**：
1. 先在 `sessions/page.tsx` 上加消息队列（useMessageQueue + MessageQueueBar），验证队列逻辑正确
2. 从 `sessions/page.tsx` 提取 `SessionPanel`，props 接口设计覆盖两页面差异：
   - `mode: "page" | "dialog"` 区分全页/弹窗模式
   - `pendingRequests / onDialogResolved` 覆盖 askUserDialog 场景
   - `team / teamMission` 通过可选 props 透传
   - `viewMode / onViewModeChange` 支持对话/进度视图切换
3. `interactive-session-panel.tsx` 替换为 `SessionPanel`，保留原有 `useAttach/useQuery` 在弹窗父组件中，只替换面板内部渲染
4. 逐行对比两个面板的 turn 配置、SSE 事件处理、操作回调差异，确保零回归

## 3. 架构设计

### 3.1 新增文件

#### `frontend/src/hooks/use-message-queue.ts`
```typescript
interface QueueEntry {
  id: string;                    // 唯一标识
  prompt: string;                // 消息文本
  attachmentIds: string[];       // 附件 ids
  displayPrompt: string;         // 带附件标记行的展示文本
  status: "pending" | "sending" | "failed"; // 投递状态
  errorMsg?: string;             // 失败原因
  createdAt: number;             // 入队时间戳
}

interface UseMessageQueueOptions {
  sessionId: string;
  sessionActive: boolean;        // status === "active"
  hasCurrentRun: boolean;        // currentRunId != null
  onSend: (prompt: string, attachmentIds: string[]) => Promise<void>;
  maxQueue?: number;             // 默认 5
}

interface UseMessageQueueReturn {
  queue: QueueEntry[];
  enqueue: (prompt: string, attachmentIds: string[], displayPrompt: string) => boolean; // 返回 false 表示队列满
  removeEntry: (id: string) => void;
  retryEntry: (id: string) => Promise<void>;
  isQueueFull: boolean;
  queueCount: number;
}
```

**核心逻辑**：
- `enqueue()`：检查上限 → 入队 → 返回成功/满
- `processQueue()`：条件满足时（active + 无 currentRun + 队列非空）→ 取第一条 → 标记 sending → 调 onSend → 成功移除/失败标记
- 触发时机：通过外部 effect 监听 `sessionActive` 和 `hasCurrentRun` 变化

#### `frontend/src/components/daemon/message-queue-bar.tsx`
队列条目展示组件：
- 水平滚动的 chips 栏，每条显示 prompt 前 40 字 + 附件数
- 失败条目红色边框 + 重试/删除按钮
- 队列满时显示 "队列已满（5/5）"
- 点击条目可展开查看完整内容

### 3.2 修改文件

#### `frontend/src/components/daemon/session-panel.tsx`（新建）
从 `sessions/page.tsx` 提取的共享会话面板组件：

```typescript
interface SessionPanelProps {
  sessionId: string;
  // 会话数据（由父级提供，react-query 或 prop）
  session: AgentSessionRead | null;
  // SSE 连接
  onStreamConnect?: (sessionId: string) => SessionStreamConnection;
  // 操作回调
  onSessionListRefresh?: () => void;
  // 弹窗模式（/runtimes 页面用）
  mode?: "page" | "dialog";
}
```

**组件职责**：
- 会话头部（标题、状态徽标、操作按钮）
- TurnTimeline（消息列表）
- SessionInputBar（输入区）
- MessageQueueBar（队列展示）
- SSE 连接管理
- turnState 管理
- 消息队列集成

#### `frontend/src/app/(dashboard)/sessions/page.tsx`
改为渲染 `<SessionPanel>`，移除内联会话面板代码（约 500 行 → ~50 行 wrapper）。

#### `/runtimes` 页面
`interactive-session-panel.tsx` → `<SessionPanel mode="dialog">`。需适配弹窗上下文（askUserDialog、team 等）。

### 3.3 状态机变更

```
发送消息：
  旧: ended || restoring || running → 禁用
  新: ended || offline → 禁用
      active + 无 currentRun → 立即发送
      active + 有 currentRun → 入队
      reconnecting → 入队
      pending → 入队

自动投递触发：
  turn_completed → clearCurrentRun → processQueue()
  session status polling → active → processQueue()
```

### 3.4 生命周期契约表

事件 | 发起方 | 接收方 | 必需字段 | 状态变化
---|---|---|---|---
enqueue | 前端用户 | useMessageQueue | prompt, attachmentIds | queue.push(entry)
processQueue | useMessageQueue | injectSession API | queue[0].prompt, queue[0].attachmentIds | entry.status: pending→sending
inject 成功 | useMessageQueue | turnState | run_id | currentRunId = run_id
inject 失败 | useMessageQueue | useMessageQueue | error | entry.status: sending→failed
removeEntry | 前端用户 | useMessageQueue | entry.id | queue.filter
retryEntry | 前端用户 | injectSession API | queue[0] | entry.status: failed→sending
turn_completed | SSE | useMessageQueue | run_id | processQueue()

## 4. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新建 | `frontend/src/hooks/use-message-queue.ts` | 消息队列 hook |
| 新建 | `frontend/src/components/daemon/message-queue-bar.tsx` | 队列展示组件 |
| 新建 | `frontend/src/components/daemon/session-panel.tsx` | 共享会话面板 |
| 修改 | `frontend/src/app/(dashboard)/sessions/page.tsx` | 改用 SessionPanel |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 替换 interactive-session-panel |
| 删除 | `frontend/src/components/daemon/interactive-session-panel.tsx` | 废弃（替换后） |

## 5. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| interactive-session-panel 有弹窗特有逻辑（askUserDialog、team），提取时可能遗漏 | /runtimes 页面功能回退 | D-005 四步策略：先加队列→提取组件→逐行对比替换→回归验证 |
| reconnecting 期间 SSE 可能断开，队列投递时 SSE 未重连 | 消息发送但无法收到响应 | inject 成功即视为投递成功，SSE 重连后自动恢复 |
| 队列中的附件在长时间排队后可能被清理（如过期） | 发送时附件 id 无效 | inject API 会返回 404，触发 failed 标记，用户可删除 |
| 两页面同时打开同一 session 时队列竞争 | 重复发送 | 单 tab 内不会同时打开两个 session panel（路由互斥） |

## 6. 自审

- [x] 目标明确：输入框始终可用，running/reconnecting 排队，active/turn_end 自动投递
- [x] D-001~D-005 决策有理由，无遗漏关键歧义
- [x] 生命周期契约表覆盖 enqueue/process/inject/turn_complete 全链路
- [x] 文件变更清单完整（3 新建 + 3 修改 + 1 删除）
- [x] 风险登记覆盖组件统一 + reconnecting + 附件过期 + 并发竞争
- [x] 后端零改动确认
- ⚠️ 自审存疑：interactive-session-panel 的 team/askUserDialog 逻辑是否能在 SessionPanel props 中完整表达，需 execute 阶段逐行对比确认
