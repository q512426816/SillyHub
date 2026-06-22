---
id: task-04
title: AgentRunPanel 集成测试
priority: P0
estimated_hours: 2
depends_on: [task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
allowed_paths:
  - frontend/src/components/agent-run-panel.test.tsx
---

# task-04

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/agent-run-panel.test.tsx` | AgentRunPanel 组件集成测试（vitest + @testing-library/react） |

依赖产物（task-02/task-03 完成后存在）：

- `frontend/src/components/agent-run-panel.tsx`（`AgentRunPanel` 组件）
- `frontend/src/lib/use-agent-run-stream.ts`（`useAgentRunStream` hook 及其返回类型 `UseAgentRunStreamResult`）

测试只 mock hook，不真连 SSE，不依赖真实 backend。

## 覆盖来源

| 需求 ID | 来源章节 | 覆盖点 |
|---|---|---|
| FR-04 | requirements.md §FR-04（GWT 两段） | 非空 perms → 审批卡片渲染；卡片决策/permission_resolved → 卡片消失 |
| D-003@v1 | decisions.md §D-003 | hook 仅暴露 `dismissPerm`，AgentRunPanel 把 AgentLogViewer.onPermissionResolved 接到 dismissPerm；决策 API 由卡片自调，测试不直接验证 API 调用 |

bug 根因覆盖（design.md §1）：原 `streamAgentRunLogs` 在 `onmessage` 把无 timestamp 的 `permission_request` 事件直接丢弃（agent.ts:137 `if (!parsed.timestamp) return`）；现经 `useAgentRunStream`→`AgentRunPanel`→`AgentLogViewer` 正常渲染审批卡片，不再 5min 兜底超时。

## 测试策略

**核心：mock `useAgentRunStream` hook**，注入可控的 `perms` / `input` / `loading` / `status` / `logs`，渲染 `<AgentRunPanel>` 后断言 `AgentLogViewer` 内部是否渲染 `PermissionApprovalCard` 或 `AskUserDialogCard`。

### mock 方式

```ts
vi.mock("@/lib/use-agent-run-stream", () => ({
  useAgentRunStream: vi.fn(),
}));
```

每个用例通过 `vi.mocked(useAgentRunStream).mockReturnValue({...})` 注入不同 hook 返回值，模拟 SSE 到达 permission_request / permission_resolved 后的 perms 状态。

### 为什么 mock hook 而非 mock SSE

- FR-04 的 bug 路径是「hook→panel→viewer→卡片」，bug 根因在 `streamAgentRunLogs`（旧 SSE 客户端丢弃事件）。hook 单测（task-02）已覆盖 SSE→perms；panel 集成测试聚焦 panel 把 perms 正确喂给 viewer 并渲染卡片，与 SSE 链路解耦。
- mock hook 使测试稳定、无定时器抖动、无 EventSource polyfill 依赖。

### 断言要点

- 卡片出现在 DOM：`PermissionApprovalCard` 渲染「工具调用审批」+ `tool_name` badge + `request_id` 前 12 字符；`AskUserDialogCard` 渲染「ask_user」badge + 问题文本。
- 卡片不出现：`queryByText(/工具调用审批/)` 为 null。
- `data-request-id` 属性存在（permission-approval-card.tsx:114），用于精准定位单卡。
- onPermissionResolved→dismissPerm：渲染时 panel 把 `dismissPerm` 作为 `onPermissionResolved` prop 传给 viewer（D-003），触发后 viewer 调 onResolved → hook 的 perms 应移除该卡片。测试通过重新 mock hook 返回值（perms 减一）模拟此状态转换。

### 辅助 fixtures

```ts
function makePermRequest(overrides: Partial<SessionPermissionRequest> = {}): SessionPermissionRequest {
  return {
    session_id: "sess-1",
    run_id: "run-1",
    request_id: "req-abc123",
    tool_name: "Bash",
    input: { command: "ls -la" },
    ...overrides,
  };
}

function makeDialogRequest(overrides: Partial<SessionPermissionRequest> = {}): SessionPermissionRequest {
  return {
    ...makePermRequest({ tool_name: "AskUserQuestion", request_id: "req-dialog-1" }),
    dialog_kind: "ask_user",
    dialog_payload: {
      questions: [
        {
          question: "使用哪个运行时目录？",
          header: "运行时目录",
          multiSelect: false,
          options: [{ label: "项目本地", description: "项目内", preview: "/local" }],
        },
      ],
    },
    ...overrides,
  };
}

function mockHook(overrides: Partial<UseAgentRunStreamResult> = {}): UseAgentRunStreamResult {
  return {
    logs: [],
    status: "running",
    streaming: true,
    loading: false,
    error: null,
    perms: [],
    dismissPerm: vi.fn(),
    input: {
      values: {},
      submitting: {},
      errors: {},
      replied: new Set(),
      set: vi.fn(),
      submit: vi.fn(),
    },
    clear: vi.fn(),
    ...overrides,
  };
}
```

## 测试用例清单

| # | 用例名 | hook 返回（关键） | 断言 | 覆盖 |
|---|---|---|---|---|
| 1 | perms 为空 → 不渲染任何审批卡片 | `perms: []` | `queryByText(/工具调用审批/)` 为 null 且 `queryByText("ask_user")` 为 null | FR-04 baseline |
| 2 | 单条普通 permission_request → 渲染一张 PermissionApprovalCard | `perms: [makePermRequest()]` | 出现「工具调用审批」+ `Bash` badge + `req-abc123…`；`data-request-id="req-abc123"` 存在；只渲染 1 张卡 | FR-04 case1 |
| 3 | 单条 AskUserQuestion dialog → 渲染 AskUserDialogCard | `perms: [makeDialogRequest()]` | 出现「使用哪个运行时目录？」+「ask_user」badge；不出现「工具调用审批」 | FR-04 case1 |
| 4 | 多条 perms（普通 + dialog 混合）→ 两类卡片都渲染 | `perms: [makePermRequest(), makeDialogRequest()]` | 「工具调用审批」和「使用哪个运行时目录？」均出现；`data-request-id` 各自存在 | FR-04 多卡去重 |
| 5 | permission_resolved 后 perms 移除 → 卡片消失 | 第一次 render `perms:[makePermRequest()]`，rerender `perms:[]` | 第一次「工具调用审批」可见，rerender 后 queryByText 为 null | FR-04 case2（dismissPerm 两路径收敛） |
| 6 | 卡片 onResolved 触发 → 调用 hook.dismissPerm(requestId) | `perms:[makePermRequest()]`，spy `dismissPerm` | 点击「允许」或「拒绝」成功后（mock fetch 200）`dismissPerm` 被以 `request_id` 调用一次 | D-003@v1（panel 把 onPermissionResolved 接到 dismissPerm） |
| 7 | loading=true → AgentLogViewer 显示「加载日志中」而非卡片 | `loading: true, perms: [makePermRequest()]` | 出现「加载日志中...」；卡片不渲染（loading 优先） | viewer 加载语义 |
| 8 | AgentRunPanel 定制 prop 透传到 AgentLogViewer | `title="Bootstrap run"`，`emptyText="暂无日志"`，`actions=<div>act</div>`，`isLive` | 出现 title 文本、LIVE 徽标、actions 节点；perms=[] 时显示 emptyText | FR-03 prop 透传（顺带覆盖） |
| 9 | runId=null → hook 返回 logs=[] 且不渲染卡片 | hook 返回 `perms: [], logs: []` | 卡片不渲染；不抛错（panel/hook 对 null runId 容错） | 边界（runId 切换瞬间） |

> 用例 6 需 mock `globalThis.fetch` 返回 200（卡片自调 `respondSessionPermission`，参考 ask-user-dialog-card.test.tsx:167-202 现有模式）。

## 边界处理

- **runId=null**：AgentRunPanel 收到 null runId 时应正常渲染（hook 内部 guard 不连），用例 9 覆盖。
- **loading 优先于卡片**：AgentLogViewer loading 分支在 hasPermissionCards 之前（agent-log-viewer.tsx:510-518），loading=true 时即使 perms 非空也不渲染卡片，用例 7 覆盖。
- **dialog_payload 缺失**：AskUserDialogCard 已有兜底提示（ask-user-dialog-card.test.tsx:336-339），panel 测试不重复覆盖（卡片层单测已守住）。
- **多卡 key 冲突**：viewer 用 `req.request_id` 作 React key（agent-log-viewer.tsx:527/543），用例 4 用不同 request_id 保证 key 唯一。
- **定时器抖动**：PermissionApprovalCard 有每秒倒计时（permission-approval-card.tsx:73-76），用例 6 用 `vi.useFakeTimers` 或快速点击避免抖动；或断言用 `data-request-id` 而非倒计时文本。
- **mock 清理**：每个 `beforeEach` `vi.restoreAllMocks()` + `vi.mocked(useAgentRunStream).mockReset()`，避免用例间污染。

## 非目标

- **不测 SSE 实际连接 / EventSource**：hook 单测（task-02）负责。
- **不测 respondSessionPermission API 细节**（body 字段/错误码）：卡片层单测已覆盖（ask-user-dialog-card.test.tsx / permission-approval-dialog.test.tsx）。
- **不测 4 调用点的页面级端到端**（page.tsx / agent/page.tsx / changes/[cid]/page.tsx）：W3 迁移任务负责，tsc/lint 兜底。
- **不测 pending_input input 控件交互**：FR-05 由 panel 单测或调用点测试覆盖。
- **不测 dialog 恢复（fetchPendingDialogs）**：FR-07 由 hook 单测覆盖。
- **不快照测试**：用语义断言（文本/role/data-attr），避免样式微调触发误报。

## 参考

- design.md §1（bug 根因）、§5.1（分层 hook→panel→viewer）、§7.2（AgentRunPanel props）、§7.3（permission 事件契约表）
- requirements.md §FR-04（两段 GWT）
- decisions.md §D-003@v1（dismissPerm 本地移除、卡片自调决策 API）
- 现有测试参考：`frontend/src/components/ask-user-dialog-card.test.tsx`（mock fetch + onResolved 断言模式）
- 卡片渲染条件：`frontend/src/components/agent-log-viewer.tsx:403-409`（hasPermissionCards）、`:515-560`（ASK 区渲染分支）、`:526`（dialog_kind ? AskUserDialogCard : PermissionApprovalCard）
- 卡片组件：`frontend/src/components/permission-approval-card.tsx`（「工具调用审批」文案、`data-request-id`）、`frontend/src/components/ask-user-dialog-card.tsx`（「ask_user」badge、问题文本）

## TDD 步骤

1. **Red**：新建 `agent-run-panel.test.tsx`，先写用例 1（perms=[] 不渲染卡片）+ 用例 2（单条普通 perm 渲染 PermissionApprovalCard），跑 `pnpm test agent-run-panel` → 应失败（AgentRunPanel 组件尚未存在或导出不全）。
2. **依赖确认**：task-03 应已交付 `agent-run-panel.tsx`，导入 `AgentRunPanel` 编译通过；若 task-03 未完成则本任务 blocked（depends_on: [task-03]）。
3. **Green**：补齐用例 3-9，逐个跑通；若某用例失败，反馈给 task-03 修正 panel（而非在测试里妥协断言）。
4. **Refactor**：抽取 `makePermRequest` / `makeDialogRequest` / `mockHook` 公共 fixture 到文件顶部；保持每个用例独立 `render`（不共享 DOM）。
5. **全量验证**：`pnpm test`（全 frontend 测试）+ `pnpm typecheck` + `pnpm lint` 全过。

## 验收标准

| # | 标准 | 验证命令 / 方式 |
|---|---|---|
| 1 | 测试文件存在且语法正确 | `pnpm typecheck` 无错 |
| 2 | 9 个用例全部通过 | `pnpm test agent-run-panel` → 9 passed |
| 3 | 用例 2/3/4 卡片渲染断言成立（PermissionApprovalCard / AskUserDialogCard 文本+badge+data-request-id） | 测试报告 green |
| 4 | 用例 5/6 覆盖 FR-04 case2（dismissPerm 移除 + onResolved 接通） | 测试报告 green |
| 5 | 不引入新依赖（仅用现有 vitest + @testing-library/react） | `git diff package.json` 无变更 |
| 6 | frontend 全量测试无回归 | `pnpm test` 全过 |
| 7 | lint/typecheck 无新增告警 | `pnpm lint && pnpm typecheck` 全过 |
