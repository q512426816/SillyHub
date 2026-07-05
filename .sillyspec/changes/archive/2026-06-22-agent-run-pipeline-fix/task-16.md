---
id: task-16
title: "[token][前端] agent-run 累计 input/output token 消耗展示"
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-11]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/components/agent-run-panel.tsx
  - frontend/src/lib/agent.ts
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-16: [token][前端] agent-run 累计 input/output token 消耗展示

## 修改文件

1. `frontend/src/lib/agent.ts` — `AgentRun`（10-41 行）已含 `input_tokens: number | null`（34 行）和 `output_tokens: number | null`（35 行），**无需改 AgentRun 类型**。`StreamLogEvent`（106-111 行）当前不含 token 字段——如需流式期间从 SSE 事件实时刷新 token（而非等 done 事件读终态），需扩展 StreamLogEvent 类型 + use-agent-run-stream.ts hook 监听 `usage_update`。本 task **优先走"done 事件终态 + 周期性 getAgentRun 轮询刷新"方案**（最小改动，D-006@v1）。
2. `frontend/src/components/agent-run-panel.tsx` — `AgentRunPanel`（95-188 行）在 run 概要区展示累计 input/output tokens。新增 `summary` 节点（透传给 AgentLogViewer.summary，170-185 行已支持），渲染 token 统计徽标。需要从某处拿到当前 run 的 token 数据：
   - 方案 A（推荐）：AgentRunPanel 内部 `getAgentRun(workspaceId, runId)` 拿 run.input_tokens/output_tokens，存入本地 state，传入 summary。
   - 方案 B：父组件传入 `tokenSummary` prop（与 summary/actions 模式一致，显式列）。
   - 本 task 选 **方案 A**（最小改动，hook 已封装 run 状态），并配合 hook 的 done 事件刷新（onDone 触发时重新 getAgentRun 取终态 tokens）。

## 覆盖来源 (design.md §X / requirements.md FR-NN)

- design.md §5.5 Token 消耗展示（design.md:141-154）：
  - 数据源（已有，无需后端逻辑改动）：AgentRun 表 input_tokens/output_tokens；daemon.ts:1070-1080 assistant message usage 实时回写；daemon.ts:1000-1004 result 汇总；task-runner.ts:1192-1195 usage_update 透传
  - 前端展示：run 概要区（AgentRunPanel / AgentLogViewer 顶部）展示累计 input/output tokens（从 AgentRun 读，SSE done 事件终态 + 流式期间从 usage_update 刷新）
  - API 确认：确认 agent.ts 的 getAgentRun / StreamLogEvent 返回 input_tokens / output_tokens（design.md:152）
- design.md §11 决策覆盖 → D-006@v1 token 消耗展示（design.md:211）
- design.md §14 文件变更清单 → frontend/src/components/agent-run-panel.tsx（design.md:270）+ frontend/src/lib/agent.ts（design.md:271）
- requirements.md FR-11（agent-run 日志面板可见 input/output token 消耗，流式期间实时更新）

## 实现要求

### 1. AgentRun 类型确认（agent.ts:10-41）

**已就位**（无需改动）：

```ts
// agent.ts:34-35（已存在）
input_tokens: number | null;
output_tokens: number | null;
```

后端 `backend/app/modules/agent/schema.py:116-117` 已暴露这两个字段（`AgentRunRead` Pydantic schema），`getAgentRun`（agent.ts:78-80）走 `/api/workspaces/{id}/agent/runs/{runId}` 端点返回完整 AgentRun DTO，已含 tokens。

### 2. StreamLogEvent 扩展（agent.ts:106-111，如走流式刷新方案）

**当前实现**：

```ts
export interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
  log_id: string | null;
}
```

**若走 usage_update 流式刷新方案**（推荐），需扩展：

```ts
export interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
  log_id: string | null;
  // task-16 / FR-11：usage_update 事件携带的累积 token（daemon task-runner.ts:1192-1195 透传）
  input_tokens?: number;
  output_tokens?: number;
}
```

use-agent-run-stream.ts 的 `client.onMessage`（177-193 行）当前只取 log_id/channel/content/timestamp 4 个字段构造 AgentRunLogEntry，新增对 input_tokens/output_tokens 的提取——但因 AgentRunLogEntry（agent.ts:50-58）schema 不含 tokens 字段（backend schema.py:126-132 也无），tokens 不能塞进 AgentRunLogEntry。

**正确做法**：tokens 是 run 级累积值（非单条 log 的属性），应作为 hook 的独立状态（`tokenUsage: { input: number; output: number } | null`），从 StreamLogEvent 顶层字段读取，而非塞进 logs 数组。在 use-agent-run-stream.ts 新增：

```ts
const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number } | null>(null);

// client.onMessage 回调内：
client.onMessage((event) => {
  // ... 现有 logs 追加逻辑 ...
  // task-16：usage_update 事件刷新 token 累积值
  if (typeof event.input_tokens === "number" && typeof event.output_tokens === "number") {
    setTokenUsage({ input: event.input_tokens, output: event.output_tokens });
  }
});
```

**注**：use-agent-run-stream.ts 不在 allowed_paths（本 task 仅 agent-run-panel.tsx + agent.ts）。若需改 hook，需走方案 A（panel 内部 getAgentRun + done 后刷新），避免触碰 hook 文件。**本 task 选方案 A**。

### 3. AgentRunPanel 概要区 token 展示（agent-run-panel.tsx:95-188）

**当前实现**：`summary` prop（agent-run-panel.tsx:46-47）由父组件透传，AgentRunPanel 直接转发给 AgentLogViewer.summary（170-185 行）。父组件未必知道 run 的 token 数据。

**改造目标**：AgentRunPanel 内部主动拉取 token 数据并构造 summary 节点：

```tsx
export function AgentRunPanel({ workspaceId, runId, isActive, title, ... }: AgentRunPanelProps) {
  const { logs, loading, error, perms, dismissPerm, input } = useAgentRunStream(...);

  // task-16 / FR-11：拉取 run 累计 token，活跃期间周期性刷新（流式实时更新）
  const [tokenUsage, setTokenUsage] = useState<{ input: number | null; output: number | null } | null>(null);
  useEffect(() => {
    if (!runId) {
      setTokenUsage(null);
      return;
    }
    let cancelled = false;
    const fetchUsage = () => {
      getAgentRun(workspaceId, runId)
        .then((run) => {
          if (!cancelled) {
            setTokenUsage({ input: run.input_tokens, output: run.output_tokens });
          }
        })
        .catch(() => { /* 静默，token 拉取失败不阻断面板 */ });
    };
    fetchUsage();
    // 活跃 run 每 5s 轮询刷新（streaming 期间 token 累积）
    const interval = isActive ? setInterval(fetchUsage, 5000) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [workspaceId, runId, isActive]);

  // 合并外部传入的 summary 和 token 徽标
  const tokenBadge = tokenUsage ? <TokenUsageBadge input={tokenUsage.input} output={tokenUsage.output} /> : null;
  const composedSummary = (
    <>
      {tokenBadge}
      {summary}
    </>
  );

  return (
    <div className="min-w-0">
      {/* error 横幅 */}
      {error && (...)}
      <AgentLogViewer
        ...
        summary={composedSummary}
        ...
      />
    </div>
  );
}
```

新增 `TokenUsageBadge` 组件（agent-run-panel.tsx 内部，或抽到独立文件）：

```tsx
function TokenUsageBadge({ input, output }: { input: number | null; output: number | null }) {
  const fmt = (n: number | null) => {
    if (n == null) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };
  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-zinc-600">
      <span title="输入 tokens">↓ {fmt(input)}</span>
      <span className="text-zinc-300">|</span>
      <span title="输出 tokens">↑ {fmt(output)}</span>
    </span>
  );
}
```

格式化规则（参照 design.md:152 边界"1234 → 1.2k"）：

- `null / undefined` → "—"（run 未开始或无 usage）
- `< 1000` → 原值（如 "847"）
- `1000 ≤ n < 1_000_000` → "1.2k" / "12.3k"
- `≥ 1_000_000` → "1.5M"

### 4. 流式期间实时刷新策略

**方案 A（本 task 选）**：panel 内部 `setInterval(fetchUsage, 5000)` 每 5s 调 getAgentRun 拉取最新 tokens。daemon.ts:1070-1080 已实时回写 AgentRun.input_tokens/output_tokens（assistant message 到达时），故轮询能拿到准实时数据。延迟 ≤ 5s，满足 FR-11"流式期间数字实时增长"。

**方案 B（YAGNI，不做）**：扩展 StreamLogEvent + use-agent-run-stream.ts hook 监听 usage_update 事件，零延迟刷新。需改 hook 文件（不在 allowed_paths），且 daemon 已在 task-runner.ts:1192-1195 把 usage_update 透传——但 backend submit_messages 是否把 usage 同步到 SSE StreamLogEvent 尚需验证。本变更不做（D-006 边界明确"run 级累计展示"够用）。

**done 事件终态刷新**：use-agent-run-stream.ts 的 onDone（210-214 行）触发时，panel 的 useEffect 依赖列表 `[workspaceId, runId, isActive]` 中 isActive 在 run 完成后会变（父组件切换），触发重新 fetchUsage 拿终态 tokens。若 isActive 不变，可在 onDone 回调内主动触发一次 fetchUsage（panel 接收 onDone 透传后调内部 fetchUsage）。

### 5. 后端字段确认

**已就位**（无需改后端）：

- `backend/app/modules/agent/schema.py:116-117` — AgentRunRead 已含 input_tokens/output_tokens
- `backend/app/modules/agent/model.py:210-214` — AgentRun ORM model 已含字段
- `backend/app/modules/agent/service.py:45-46` — input_tokens/output_tokens 在 AGENT_RUN_UPDATE_FIELDS 白名单内（submit_messages 实时更新）
- daemon.ts:1070-1080（已确认）— assistant message usage 提到顶层让 backend 实时回写
- daemon.ts:1000-1004（已确认）— result 事件 usage 汇总
- task-runner.ts:1192-1195（已确认）— usage_update 事件透传给 backend submit_messages

## 接口定义

### AgentRun（agent.ts:10-41，已存在）

```ts
export interface AgentRun {
  // ... 其他字段 ...
  input_tokens: number | null;   // 34 行（已存在）
  output_tokens: number | null;  // 35 行（已存在）
}
```

### StreamLogEvent（agent.ts:106-111）

**方案 A 下不改**（依赖轮询）。若 execute 时确认要流式刷新，扩展为：

```ts
export interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
  log_id: string | null;
  input_tokens?: number;    // 可选扩展
  output_tokens?: number;   // 可选扩展
}
```

### AgentRunPanel（agent-run-panel.tsx:31-65）

props 不变（workspaceId/runId/isActive/title/emptyText/summary/actions/compact/variant/maxHeightClass/isLive/onDone/onClose）。内部新增 tokenUsage state + TokenUsageBadge 渲染。

### 新增 TokenUsageBadge

```tsx
function TokenUsageBadge({
  input,
  output,
}: {
  input: number | null;
  output: number | null;
}): JSX.Element
```

## 边界处理（≥5 条）

1. **token 为 null / undefined（run 未开始或无 usage）**：AgentRun.input_tokens/output_tokens 在 run 创建时为 null（model.py:210-214 默认 None），首次 assistant message 到达前 daemon 未回写。TokenUsageBadge 显示 "↓ — | ↑ —"，不报错不隐藏徽标。run 完成后若无 usage（agent 异常退出），保持 "—"。
2. **流式实时更新（usage_update 事件）**：方案 A 走 5s 轮询——daemon.ts:1070-1080 每 assistant message 实时回写 AgentRun，故轮询能拿到最新累积值。延迟 ≤ 5s。若需零延迟（方案 B），需扩展 StreamLogEvent + hook，但本 task 不做（YAGNI）。
3. **大数字格式化（1234 → 1.2k）**：fmt 函数处理 ≥1000 转 k、≥1M 转 M。极大数字（如 100M tokens）格式化为 "100.0M"，不溢出徽标宽度（徽标 inline-flex + max-w）。
4. **缓存 token 累积**：panel 切换 runId 时，useEffect cleanup 清 interval + cancelled flag 防止 stale setTokenUsage（旧 run 的 fetch 完成后写入新 run state）。runId=null 时 setTokenUsage(null) 清空徽标。
5. **0 token 场景**：run 完成但 agent 全程未触发 LLM（如立即被 kill）→ input_tokens=0 / output_tokens=0 → TokenUsageBadge 显示 "↓ 0 | ↑ 0"，不与 null 混淆（null 是"未知/未回写"，0 是"确认零消耗"）。
6. **getAgentRun 失败**：fetchUsage catch 静默，不阻断面板——token 徽标保持上一次值（或初始 null）。连续失败时徽标可能显示过期数据，但面板其他功能（logs / perms / input）正常。
7. **onDone 终态刷新**：use-agent-run-stream.ts onDone（210-214）触发后，panel 应立即 fetchUsage 拿终态 tokens（避免等到下次 5s 轮询）。实现方式：onDone 回调内调 panel 内部的 fetchUsage（需把 fetchUsage 提升为 useCallback 并加入 onDone 处理逻辑），或依赖 isActive 状态变化触发 useEffect 重新执行。
8. **multiple AgentRunPanel 实例（mission 多 worker）**：每个 panel 实例独立 fetchUsage 自己的 runId，互不干扰。token 徽标只展示当前 run 的累计，不汇总 mission 级（mission 级汇总由父组件用 Mission.cost_so_far，不在本 task 范围）。

## 非目标

- **不**改 backend（design.md:143 明确"数据源已有，无需后端逻辑改动"；schema.py:116-117 字段已暴露）。
- **不**改 daemon（daemon.ts:1070-1080 / task-runner.ts:1192-1195 已实现 usage 实时回写与透传）。
- **不**做 turn 级 token 增量展示（design.md:150 明确 YAGNI——turn 级需前端对相邻 assistant message 的 usage 差分，先做 run 级累计）。
- **不**改 use-agent-run-stream.ts hook（不在 allowed_paths；方案 A 走 panel 内部轮询，避免改 hook）。
- **不**做 mission 级 / workspace 级 token 汇总（本 task 仅 run 级累计）。
- **不**展示 cost_usd（AgentRun.total_cost_usd 已有字段，但本 task 范围是 token；cost 展示留给独立任务或父组件 summary）。
- **不**做 token 速率 / token-per-second 等高级指标（YAGNI）。

## TDD 步骤

> 测试文件：新建 `frontend/src/components/__tests__/agent-run-panel.test.tsx`（@testing-library/react + msw mock fetch）。若项目无该测试基建，退化用 vitest 对 `formatTokenCount` 纯函数做单测——把 fmt 从 TokenUsageBadge 抽出为可独立导出的工具函数。

### 红：先写失败测试

```tsx
// frontend/src/lib/__tests__/format-token.test.ts
import { describe, it, expect } from "vitest";
import { formatTokenCount } from "@/lib/format-token";

describe("task-16: formatTokenCount 数字格式化 (FR-11)", () => {
  it("null / undefined 返回占位符", () => {
    expect(formatTokenCount(null)).toBe("—");
    expect(formatTokenCount(undefined)).toBe("—");
  });

  it("小于 1000 原值显示", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(847)).toBe("847");
  });

  it("1000-999999 显示 k 后缀（1 位小数）", () => {
    expect(formatTokenCount(1234)).toBe("1.2k");
    expect(formatTokenCount(12345)).toBe("12.3k");
    expect(formatTokenCount(999999)).toBe("1000.0k");
  });

  it("≥ 1_000_000 显示 M 后缀（1 位小数）", () => {
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
    expect(formatTokenCount(123_456_789)).toBe("123.5M");
  });
});
```

```tsx
// frontend/src/components/__tests__/agent-run-panel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentRunPanel } from "@/components/agent-run-panel";
// mock useAgentRunStream + getAgentRun...

describe("task-16: AgentRunPanel token 徽标展示 (FR-11)", () => {
  it("run 有 token 时徽标显示 ↓ input | ↑ output", async () => {
    // mock getAgentRun 返回 { input_tokens: 1234, output_tokens: 567, ... }
    render(<AgentRunPanel workspaceId="ws" runId="r1" isActive={false} title="t" />);
    expect(await screen.findByText(/1\.2k/)).toBeInTheDocument();
    expect(screen.getByText(/567/)).toBeInTheDocument();
  });

  it("run token 为 null 时显示 — 占位", async () => {
    // mock getAgentRun 返回 { input_tokens: null, output_tokens: null, ... }
    render(<AgentRunPanel workspaceId="ws" runId="r1" isActive={false} title="t" />);
    expect(await screen.findAllByText(/—/)).not.toHaveLength(0);
  });

  it("runId=null 时不渲染徽标", () => {
    render(<AgentRunPanel workspaceId="ws" runId={null} isActive={false} title="t" />);
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
  });
});
```

### 绿：实现至测试通过

1. 新建 `frontend/src/lib/format-token.ts` 导出 `formatTokenCount(n: number | null | undefined): string`
2. agent-run-panel.tsx 引入 formatTokenCount + 新增 TokenUsageBadge 组件
3. AgentRunPanel 内部新增 tokenUsage state + useEffect 轮询 getAgentRun（方案 A）
4. composedSummary 合并 tokenBadge + 外部 summary prop
5. （可选）如走方案 B，扩展 agent.ts StreamLogEvent + 改 use-agent-run-stream.ts（需申请扩大 allowed_paths）

### 重构 / 回归

- 现有 AgentRunPanel 调用点（工作流页面 / mission 面板）行为不变——summary prop 仍由外部传入，内部 composedSummary 只追加 tokenBadge 到前面。
- 跑 `pnpm --filter frontend lint && pnpm --filter frontend typecheck && pnpm --filter frontend test` 全套通过（pre-commit ci-check hook 要求）。
- 手动验证：跑一个 agent run，观察面板头部 token 徽标随 assistant 消息到达数字增长，done 后徽标显示终态值（与 AgentRun 表一致）。

## 验收标准

| # | 验收点 | 验证方法 |
|---|---|---|
| 1 | agent-run 日志面板可见 input/output token 消耗徽标 | 手动验证：打开 agent run 面板，header 区可见 "↓ input \| ↑ output" 徽标 |
| 2 | 流式期间数字实时增长（5s 轮询延迟内） | 手动验证：跑一个活跃 run，观察 token 数字每 5s 内增长一次 |
| 3 | 终态与 AgentRun 表一致（done 事件后） | 手动验证：run 完成后徽标数字与 DB AgentRun.input_tokens/output_tokens 一致 |
| 4 | token 为 null 时显示 "—" 占位 | 单测 "null 返回 —" 通过 + 手动验证新创建 run 在首次 assistant message 前显示 "—" |
| 5 | 大数字格式化（1234 → 1.2k，1.5M → 1.5M） | 单测 "数字格式化" 全分支通过 |
| 6 | runId=null 时不渲染徽标 | 单测 "runId=null 不渲染徽标" 通过 |
| 7 | 无 lint / typecheck / test 错误 | `pnpm --filter frontend lint && pnpm --filter frontend typecheck && pnpm --filter frontend test` 退出码 0 |
| 8 | 切换 runId 时 tokenUsage 正确清理（不显示上一个 run 的数据） | 手动验证：面板切换不同 run，徽标数字随之切换；runId=null 时徽标消失 |
