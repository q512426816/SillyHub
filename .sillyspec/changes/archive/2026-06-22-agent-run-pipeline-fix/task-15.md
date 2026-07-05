---
id: task-15
title: "[前端] timeline turn 分组渲染 + thinking 折叠 + tool 卡片状态徽标"
priority: P1
depends_on: [task-14]
blocks: []
requirement_ids: [FR-10]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/agent-log-viewer.tsx
  - frontend/src/components/agent-log/tool-renderers.tsx
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-15: [前端] timeline turn 分组渲染 + thinking 折叠 + tool 卡片状态徽标

## 修改文件

1. `frontend/src/components/agent-log-viewer.tsx` — 改造 `AgentLogViewer`（350-589 行）的渲染：从扁平 `filteredLogs.map` 改为 turn 分组（按 assistant 消息边界切分 turn，每个 turn = assistant 文本 + 其触发的 tool_use 集合 + 各自 result）。同时改造 `AgentLogRow`（173-344 行）：thinking 默认折叠成单行摘要（用现有 `CollapsibleSection`，title="思考"，点击展开），`semanticLineClass`（57-65 行）强化 channel 着色。
2. `frontend/src/components/agent-log/tool-renderers.tsx` — tool 卡片头部加状态徽标（✓ 绿 / ✗ 红 + 耗时秒数）。改造 `ToolCallPreview`（466-485，按 tool 名分派）入参，让分派前的卡片外壳统一渲染状态徽标；现有 `StatusBadge`（25-40 行）已支持 success/pending，需扩展显示耗时。

## 覆盖来源 (design.md §X / requirements.md FR-NN)

- design.md §5.4 前端 timeline 重设计（design.md:132-139）：
  - 第 2 点（design.md:136）：AgentLogViewer 渲染改 turn 分组（assistant 文本 + tool_use 集合 + result），AgentLogRow thinking 默认折叠单行摘要，tool_call JSON 收进卡片，channel 着色强化（user_input 紫 / thinking 灰 / assistant 亮 / tool 蓝 / 成功绿 / 失败红）
  - 第 3 点（design.md:137）：tool 卡片头部加状态徽标（✓/✗ + 耗时），点击展开参数与结果
- design.md §8 验收 → "前端" 行（design.md:181）：timeline turn 分组、thinking 折叠、tool 卡片状态徽标、无重复
- design.md §14 文件变更清单 → frontend 部分（design.md:266-268）
- requirements.md FR-10（前端 timeline 渲染：turn 分组、thinking 折叠、tool 卡片状态徽标、channel 着色）
- 参考原型 `prototype-agent-log-viewer.html`（§优化后面板 142-200 行的 turn-head/turn-body/tool-card/thinking-toggle 视觉结构）

## 实现要求

### 1. AgentLogViewer turn 分组（agent-log-viewer.tsx:350-589）

**当前实现**：`processedLogs`（395 行 normalize 后）→ `visibleLogs`（398 过滤 hidden）→ `filteredLogs`（399-401 按 channel 过滤）→ 直接 `filteredLogs.map` 渲染扁平 `AgentLogRow` 列表（560-582）。

**改造目标**：在 `filteredLogs` 与 `AgentLogRow` 之间加一层 turn 分组：

```tsx
// 新增工具函数：按 assistant 边界切分 turn
function groupIntoTurns(logs: ProcessedLog[]): ProcessedLog[][] {
  // 一个 turn = [user_input?] + thinking段 + assistant 文本 + 其触发的 tool_use/result 集合
  // 切分规则：遇到 channel=tool_call 或 parsedStdoutTool 时归入当前 turn；
  //           遇到 mergedAssistantContent/mergedThinkingContent 的"完整 assistant 消息"时开新 turn；
  //           user_input 开启新 turn（用户发言边界）。
  const turns: ProcessedLog[][] = [];
  let current: ProcessedLog[] = [];
  for (const p of logs) {
    const isTurnBoundary = p.log.channel === "user_input"
      || (p.mergedAssistantContent != null && p.mergedAssistantContent.trim().length > 0);
    if (isTurnBoundary && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}
```

渲染改为：

```tsx
{filteredLogs.length > 0 && (
  <div className="min-w-0 max-w-full divide-y divide-zinc-200">
    {groupIntoTurns(filteredLogs).map((turnLogs, turnIdx) => (
      <ErrorBoundary
        key={`turn-${turnIdx}`}
        label="agent-log-turn"
        fallback={() => <div className="px-3 py-2 text-[11px] text-red-600/70">该 turn 渲染失败</div>}
      >
        <TurnBlock turnLogs={turnLogs} turnIdx={turnIdx} compact={compact} inputControls={inputControls} />
      </ErrorBoundary>
    ))}
  </div>
)}
```

`TurnBlock` 是新增子组件，内部渲染 turn 头（Turn N + 时间范围 06:24:04 → 06:24:20，参照 prototype:151-155）+ turn body（按顺序渲染 user_input / thinking（折叠）/ assistant / tool 卡片）。保留单条 `AgentLogRow` 的 ErrorBoundary 隔离（565-580）——某条日志渲染失败不影响同 turn 其他条目。

### 2. AgentLogRow thinking 折叠（agent-log-viewer.tsx:173-344 + 253-268）

**当前实现**：thinking 渲染在 253-268 行已用 `CollapsibleSection title="思考"`，但 `defaultOpen=true`（tool-renderers.tsx:68 `CollapsibleSection` 默认值），导致默认展开占大量空间。

**改造目标**：

- thinking 行的 CollapsibleSection 改 `defaultOpen={false}`，并在折叠态展示单行摘要（取 `mergedThinkingContent.slice(0, 60) + "..."`，参照 prototype:66 thinking-summary 的 `text-overflow: ellipsis`）。
- 卡片头部展示"思考 · N 段合并"小徽标（参照 prototype:163 thinking-count）——段数可通过统计 `mergedThinkingContent.split("\n").length` 估算。
- assistant / tool 行的 CollapsibleSection 保持 `defaultOpen=true` 不变。

### 3. tool 卡片状态徽标 + 耗时（tool-renderers.tsx）

**当前实现**：`ToolCallPreview`（466-485）按 tool 名 switch 分派到 WriteToolPreview / BashToolPreview 等，每个子组件头部用 `StatusBadge`（25-40）显示 "已通过"/"失败"/"待审批" 文字徽标。无耗时显示。

**改造目标**：

- 扩展 `StatusBadge`（25-40）入参：新增 `durationMs?: number`，显示 "✓ 5.7s" / "✗ 1.2s"（参照 prototype:179 `.tool-status.st-ok`）。
- 耗时来源：tool 卡片通常成对出现（tool_use 在前、tool_result 在后），耗时 = result.timestamp - tool_use.timestamp。task-14 已合并到单张卡片，故在 `ProcessedLog` 渲染时由 AgentLogRow 计算并传入 ToolCallPreview。
- ToolCallPreview 入参从 `{entry, mergedResult}` 扩展为 `{entry, mergedResult, durationMs?}`，透传到内部 StatusBadge。
- 状态图标：成功用 ✓（emerald-500）、失败用 ✗（red-500）、pending 用 ⏳（amber-500），配合现有 badgeClass。
- channel 着色强化：参照 prototype 着色方案与 `semanticLineClass`（agent-log-viewer.tsx:57-65）：
  - user_input：紫色边框 + 紫色文字（`border-violet-300 bg-violet-50 text-violet-800`，logChannelMeta:95-101 现已用 sky，改为 violet 强化）
  - thinking：灰色（保持现有 zinc-600，60 行）
  - assistant：亮黑（保持现有 zinc-900，63 行）
  - tool：蓝色（保持现有 blue-700，58 行）
  - 成功 result：绿色（保持 emerald-700，59 行）
  - 失败 result：红色（新增——当前 59 行 TOOL_RESULT 统一 emerald，需根据 success 切红）

### 4. 兼容现有功能

- channel 过滤按钮（426-432 + 468-481）保留——按 channel 过滤后 turn 分组仍正常工作（visibleLogs 在过滤后才进 groupIntoTurns）。
- 全屏切换（491-498）、LIVE 徽标（460-465）、ASK 区审批卡片（521-559）保留。
- 下载日志功能（actions prop 透传）不受影响——turn 分组只改渲染层，不改 logs 数据源。

## 接口定义

### AgentLogViewer（agent-log-viewer.tsx:350-388）

props 完全不变（title/runId/logs/loading/emptyText/maxHeightClass/compact/variant/isLive/containerRef/summary/actions/inputControls/permissionRequests/onPermissionResolved），内部渲染逻辑改 turn 分组。

### 新增 TurnBlock 子组件

```tsx
function TurnBlock({
  turnLogs,
  turnIdx,
  compact,
  inputControls,
}: {
  turnLogs: ProcessedLog[];
  turnIdx: number;
  compact?: boolean;
  inputControls?: AgentLogInputControls;
}): JSX.Element
```

渲染 turn-head（Turn N + 时间范围）+ turn-body（按顺序渲染各 AgentLogRow，thinking 折叠）。

### AgentLogRow（agent-log-viewer.tsx:173-183）

props 不变，内部 thinking 渲染分支（253-268）改为 `defaultOpen={false}` + 摘要展示。

### ToolCallPreview（tool-renderers.tsx:466）

```tsx
interface ToolPreviewProps {
  entry: ToolCallEntry;
  mergedResult?: string;
  durationMs?: number;   // 新增：tool_use→tool_result 耗时
}
```

### StatusBadge（tool-renderers.tsx:25-40）

```tsx
function StatusBadge({
  status,
  success,
  durationMs,
}: {
  status: "allowed" | "pending";
  success: boolean;
  durationMs?: number;   // 新增
}): JSX.Element
```

## 边界处理（≥5 条）

1. **空 turn**：`groupIntoTurns` 返回空数组（filteredLogs.length === 0）→ 已有 515-518 行的空态文案分支兜底，不会进入 turn 渲染。某 turn 内 turnLogs.length === 0（理论不应发生，但防御）→ TurnBlock 跳过渲染，turnIdx 仍递增。
2. **超长 thinking（折叠摘要截断）**：`mergedThinkingContent.slice(0, 60)` 仅展示前 60 字符 + "..."。折叠态不渲染完整内容（性能 + 可读性），展开后渲染全文（已有 259-261 行逻辑）。
3. **嵌套 tool（Agent 工具调用子 agent）**：AgentToolPreview（167-211）已支持嵌套——子 agent 的 run_id 在 mergedResult 中展示摘要。turn 分组时 Agent tool 与其触发的子 agent 日志可能跨 turn——按 task-14 的 tool_use_id 配对合并到当前 turn 即可，不强行归并子 agent 的子 turn（YAGNI）。
4. **embedded / compact variant 兼容**：`variant`（373）与 `compact`（374）透传到 TurnBlock / AgentLogRow。compact 模式下 turn-head 简化（不显示时间范围，只显示 Turn N）；embedded 模式下 turn 边框弱化（无 border，仅底部 divider）。
5. **ErrorBoundary 单 turn 崩溃不整页崩**：每个 TurnBlock 外包 ErrorBoundary（参照现有 565-580 单条 AgentLogRow 的隔离模式），某 turn 渲染失败时显示"该 turn 渲染失败"占位，不影响其他 turn。AgentLogRow 内部已有 ErrorBoundary（565），TurnBlock 再加一层——双层隔离。
6. **下载日志功能不受影响**：actions prop（agent-log-viewer.tsx:378）透传的下载按钮在 panel header（491）渲染，与 turn 分组独立。下载内容来自 `logs`（原始数据）而非 `filteredLogs`（分组后视图），数据源不变。
7. **channel 过滤与 turn 分组交互**：用户点 INFO/TOOL/ASK/REPLY 过滤按钮后，visibleLogs 先按 channel 过滤再 groupIntoTurns——过滤掉的日志不参与 turn 切分，可能导致 turn 边界变化（如过滤掉 user_input 后 turn 边界消失，全部归为 1 个 turn）。这是预期行为（用户主动过滤即不要看这些 channel），不需特殊处理。
8. **耗时计算（result 无 timestamp）**：durationMs 计算时若 result 缺失（tool 进行中）或 result.timestamp 解析失败，返回 undefined → StatusBadge 不显示耗时秒数，只显示状态文字。不报错。

## 非目标

- **不**改 normalize.ts（task-14 负责 tool_use_id 配对 + thinking 去重，本 task 只消费 ProcessedLog 字段）。
- **不**改 backend daemon（耗时数据来自现有 timestamp 字段，无需后端新增字段）。
- **不**做 turn 级 token 增量展示（design.md:150 明确 YAGNI，turn 级 usage 差分留给未来）。
- **不**做日志全文搜索 / 高级过滤增强（design.md:218 明确 YAGNI）。
- **不**重写 AskUserDialogCard / PermissionApprovalCard（521-559 保留现状，仅 turn 分组外壳改）。
- **不**改 channel filter 按钮逻辑（426-432 + 468-481 保留）。
- **不**做 dark mode（prototype 是 dark 主题，本 task 实现沿用现有 zinc 白色主题——视觉对照原型但配色与现有 viewer 一致）。

## TDD 步骤

> 测试文件：新建 `frontend/src/components/__tests__/agent-log-viewer.test.tsx`（用 @testing-library/react 渲染）。若项目无该测试基建，退化用 vitest 对 `groupIntoTurns` 纯函数做单测——把 groupIntoTurns 从 TurnBlock 抽出为可独立导出的工具函数。

### 红：先写失败测试

```tsx
// frontend/src/components/__tests__/agent-log-viewer.test.tsx
import { describe, it, expect } from "vitest";
import { groupIntoTurns } from "@/components/agent-log-viewer";
import type { AgentRunLogEntry } from "@/lib/agent";
import type { ProcessedLog } from "@/components/agent-log/types";

function makeProcessed(channel: AgentRunLogEntry["channel"], content: string | null, id: string): ProcessedLog {
  return {
    log: {
      id, run_id: "r1", channel,
      content_redacted: content,
      timestamp: "2026-06-22T10:00:00.000Z",
    } as AgentRunLogEntry,
    hidden: false,
  };
}

describe("task-15: groupIntoTurns 按 assistant 边界切分", () => {
  it("user_input 开启新 turn", () => {
    const logs: ProcessedLog[] = [
      makeProcessed("user_input", "第一次提问", "u1"),
      makeProcessed("stdout", "[ASSISTANT] 回答1", "a1"),
      makeProcessed("user_input", "第二次提问", "u2"),
      makeProcessed("stdout", "[ASSISTANT] 回答2", "a2"),
    ];
    const turns = groupIntoTurns(logs);
    expect(turns.length).toBe(2);
    expect(turns[0]?.map((p) => p.log.id)).toEqual(["u1", "a1"]);
    expect(turns[1]?.map((p) => p.log.id)).toEqual(["u2", "a2"]);
  });

  it("assistant 文本后触发的 tool_use 归入同一 turn", () => {
    const logs: ProcessedLog[] = [
      makeProcessed("stdout", "[ASSISTANT] 我来执行", "a1"),
      makeProcessed("tool_call", JSON.stringify({ tool: "Bash" }), "tc1"),
      makeProcessed("stdout", "[TOOL_RESULT] 完成", "tr1"),
    ];
    const turns = groupIntoTurns(logs);
    expect(turns.length).toBe(1);
    expect(turns[0]?.length).toBe(3);
  });

  it("空数组返回空数组", () => {
    expect(groupIntoTurns([])).toEqual([]);
  });
});
```

### 绿：实现至测试通过

1. 抽出 `groupIntoTurns` 函数（agent-log-viewer.tsx 顶部 export）
2. 改造 AgentLogViewer 渲染（560-582）为 turn 分组
3. 新增 TurnBlock 子组件
4. 改造 AgentLogRow thinking 渲染（253-268）：CollapsibleSection defaultOpen=false + 摘要
5. 改造 StatusBadge（tool-renderers.tsx:25-40）+ ToolCallPreview（466-485）支持 durationMs
6. AgentLogRow 计算 durationMs 传入 ToolCallPreview

### 重构 / 回归

- 现有 AgentLogViewer / AgentLogRow 行为不破坏：跑 e2e 或手动验证历史 run 日志面板仍能正常展开 tool 卡片、提交 pending_input、下载日志。
- 跑 `pnpm --filter frontend lint && pnpm --filter frontend typecheck && pnpm --filter frontend test` 全套通过（pre-commit ci-check hook 要求）。
- 手动对照 prototype-agent-log-viewer.html 的优化后面板（142-200）——turn 分组视觉与原型一致。

## 验收标准

| # | 验收点 | 验证方法 |
|---|---|---|
| 1 | 日志按 turn 分组展示，turn-head 显示 Turn N + 时间范围 | 单测 groupIntoTurns 通过 + 手动对照 prototype:151-155 |
| 2 | thinking 默认折叠为单行摘要（60 字符 + "..."），点击展开全文 | 手动验证：打开 agent run 日志面板，thinking 行默认折叠，点击 chevron 展开 |
| 3 | tool 卡片头部显示状态徽标 ✓/✗ + 耗时秒数（如 "✓ 5.7s"） | 手动验证：tool_use+result 配对成功的卡片头部显示耗时；失败 tool 显示 "✗" |
| 4 | channel 着色区分：user_input 紫 / thinking 灰 / assistant 亮 / tool 蓝 / 成功绿 / 失败红 | 手动对照 prototype 着色方案 + semanticLineClass（57-65）/ logChannelMeta（67-110）改色 |
| 5 | 同一 tool 调用只一张卡片（依赖 task-14 的 tool_use_id 配对） | 手动验证：agent-run-7142b6cb.log 中 init/scan 卡片只显示一次（与 task-14 联动） |
| 6 | compact / embedded variant 下 turn 分组正常 | 手动验证：embedded 模式（如嵌在工作流卡片内）turn 边框弱化但仍可分组展开 |
| 7 | 单 turn 渲染失败不影响其他 turn（ErrorBoundary 隔离） | 手动验证：注入异常数据（mock 一条 content_redacted 为非法类型），该 turn 显示"渲染失败"占位，其他 turn 正常 |
| 8 | 下载日志功能不受影响 | 手动验证：点下载按钮仍能下载完整日志（含所有 channel，非过滤后视图） |
| 9 | 无 lint / typecheck / test 错误 | `pnpm --filter frontend lint && pnpm --filter frontend typecheck && pnpm --filter frontend test` 退出码 0 |
