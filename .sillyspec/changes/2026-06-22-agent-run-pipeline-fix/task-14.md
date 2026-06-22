---
id: task-14
title: "[D3][前端] normalize 全局 tool_use↔tool_call 配对 + thinking 跨断点去重"
priority: P1
depends_on: [task-13]
blocks: [task-15]
requirement_ids: [FR-09]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/agent-log/normalize.ts
  - frontend/src/components/agent-log/types.ts
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-14: [D3][前端] normalize 全局 tool_use↔tool_call 配对 + thinking 跨断点去重

## 修改文件

1. `frontend/src/components/agent-log/types.ts` — `ProcessedLog` 接口（当前 34-55 行）新增 `toolUseId?: string` 和 `segmentId?: string` 字段，用于跨日志条目关联 tool_use↔tool_call 与 thinking segment。
2. `frontend/src/components/agent-log/normalize.ts` — 改造 `normalizeLogsImpl`（255-408 行）：
   - tool_use↔tool_call 配对：放弃 ±3 窗口（nearToolCall 检查在 360-386 行），改用 `tool_use_id` 全局 Map 关联。
   - thinking 合并（294-316 行只相邻合并）：跨 `[TOOL_USE]`/`[ASSISTANT]` 断点继续合并同 segmentId 的 thinking 段，并增加增量段 vs 完整段的去重（参照 `mergeAssistantPiece` 208-237 的 startsWith/includes 归并逻辑，补到 thinking 路径）。

## 覆盖来源 (design.md §X / requirements.md FR-NN)

- design.md §5.3 D1/D2/D3 日志碎片化+重复 → 第 3 点 "tool_call 全局配对"（design.md:125-128）+ 第 1 点 "partial/完整去重"（design.md:123，前端 normalize 用完整行覆盖同 segment partial，对照 mergeAssistantPiece:208-237）
- design.md §5.4 前端 timeline 重设计 → 第 1 点（design.md:135，thinking 跨 [TOOL_USE]/[ASSISTANT] 断点的去重 + tool_use↔result 全局配对 tool_use_id）
- design.md §6 数据模型 → ProcessedLog 加 toolUseId 关联字段（design.md:161）
- design.md §13 自审存疑 2（Grill X-001）→ execute 验证 SDK 是否提供稳定 block id，若无则退化启发式（已在边界处理覆盖）
- requirements.md FR-09（前端日志归一化：同一 tool 调用合并为单张卡片，同一思考只显示一次）

## 实现要求

### 1. ProcessedLog 类型扩展（types.ts:34-55）

在 `ProcessedLog` 接口追加两个可选字段：

```ts
export interface ProcessedLog {
  log: import("@/lib/agent").AgentRunLogEntry;
  hidden: boolean;
  mergedToolResult?: string;
  parsedStdoutTool?: ToolCallEntry;
  parsedToolResult?: string;
  mergedThinkingContent?: string;
  mergedAssistantContent?: string;
  /** task-14 / FR-09：tool_use_id 关联字段（来自 task-runner.ts:1284-1304 与 service.py:3443-3462 emit 的 tool_call JSON）。
   *  daemon 在 tool_call JSON 与 stdout [TOOL_USE] 两路 emit 时带上同一 id（task-13 接通），
   *  前端用它做全局配对，替代原 ±3 索引窗口（normalize.ts:360-386）。 */
  toolUseId?: string;
  /** task-14 / D1-D2：thinking segment 稳定 id（来自 daemon stream-json.ts 的 thinking_delta 事件携带）。
   *  同一 segmentId 的 partial 行（增量）与完整行（累积全文）按 mergeAssistantPiece 归并规则去重。 */
  segmentId?: string;
}
```

`ToolCallEntry`（types.ts:5-14）也需补 `toolUseId?: string` 字段，让 `parseToolCallContent`（normalize.ts:27-49）与 `parseStdoutToolUse`（102-149）解析时把 id 写进 entry。

### 2. tool_use_id 全局配对（normalize.ts:359-386）

**当前实现（待替换）**：

`normalizeLogsImpl`（255-408 行）用 `lastToolSourceIdx` 追踪最近的 tool_call，360-375 行判断 `nearToolCall = lastToolSourceIdx >= 0 && i <= lastToolSourceIdx + 3`，窗口外（同一调用的 stdout [TOOL_USE] 与 tool_call JSON 距离 > 3）就漏合并。

**改造目标**：

- 遍历前先建 `Map<toolUseId, ProcessedLog>`，键为 `tool_use_id`，值为首个非 hidden 的 tool source（channel=tool_call JSON 或 stdout [TOOL_USE]）。同一 tool_use_id 的后续条目全部 hidden=true，`[TOOL_RESULT]` body 合并进首张卡片（参照现有 `mergeToolResult` 179-186）。
- 解析 tool_call JSON 时（`parseToolCallContent` 27-49）从 obj 取 `obj.tool_use_id ?? obj.id`；解析 stdout [TOOL_USE] 时（`parseStdoutToolUse` 102-149）若 payload 是 JSON 含 id 也提取。
- 配对后两张卡合并为一张：保留首个 entry 的 parsedStdoutTool/parsedToolCall + 累积 mergedToolResult。
- **退化方案（关键）**：若 task-13 未生效导致 `tool_use_id` 缺失（旧 daemon 或未带 id 的日志），保持现有 ±3 窗口启发式作为 fallback。具体做法：先按 toolUseId 配对，无 id 的条目仍走 `lastToolSourceIdx ± 3` 启发式路径（时间戳邻近 + tool 名匹配）。

### 3. thinking 跨断点去重（normalize.ts:294-316）

**当前实现**：`lastThinkingIdx`（265 行）在遇到任何非 [THINKING] stdout 或非 stdout channel 时被置 -1（275-283、317 行），导致 thinking 段被 [TOOL_USE]/[ASSISTANT] 断开后无法继续合并到同一段——下次 [THINKING] 重新起始一个块。

**改造目标**：

- 引入 `Map<segmentId, number>`（segmentId → 首条 thinking idx），允许 thinking 段跨 [TOOL_USE]/[ASSISTANT] 断点继续累积：遇到 [THINKING] 行先看 segmentId 是否已在 Map 中，在则合并到原首条（无论中间隔了几条非 thinking 日志）。
- 若 segmentId 缺失（SDK 未提供稳定 id），退化为"无 id 模式"——保持现有相邻合并行为（lastThinkingIdx 跨非 thinking 行就断）。
- **增量段 vs 完整段去重**：partial 行是增量片段，完整 assistant message 到达时会重发整段（D2 根因，design.md:24）。新增工具函数 `mergeThinkingPiece(prev, piece)`，复用 `mergeAssistantPiece`（208-237）的归并规则：
  - `piece === prev` → 返回 prev（完全相同去重）
  - `prev.startsWith(piece)` 或 `piece.startsWith(prev)` → 返回较长者（前缀包含去重）
  - 去空白后做 startsWith 归并（`norm()` 函数已在 221-223 行存在）
  - 其余按原序拼接（保留现有 `prev + piece` 行为，300-310 行）

### 4. 调用点纳入

- `normalizeLogs`（243-253）外层 try/catch 回退（251 行）保留——新逻辑若抛错仍降级为逐条原样渲染。
- `AgentLogRow`（agent-log-viewer.tsx:173-344）渲染时 `processedLog.toolUseId` / `segmentId` 字段直接读取（task-15 用，本 task 只保证字段已就位）。

## 接口定义

### ProcessedLog（types.ts:34-55 扩展）

```ts
export interface ProcessedLog {
  log: import("@/lib/agent").AgentRunLogEntry;
  hidden: boolean;
  mergedToolResult?: string;
  parsedStdoutTool?: ToolCallEntry;
  parsedToolResult?: string;
  mergedThinkingContent?: string;
  mergedAssistantContent?: string;
  toolUseId?: string;   // 新增：tool_use_id 全局关联
  segmentId?: string;   // 新增：thinking segment 稳定 id
}
```

### ToolCallEntry（types.ts:5-14 扩展）

```ts
export type ToolCallEntry = {
  timestamp: string;
  tool: string;
  args: string;
  status: "allowed" | "pending";
  success: boolean;
  description?: string;
  command?: string;
  rawArgs: unknown;
  toolUseId?: string;   // 新增
};
```

### normalizeLogs（normalize.ts:243）内部数据结构

- `toolUseIndex: Map<string, number>` — tool_use_id → 首个非 hidden tool source 的 result 数组 idx
- `thinkingSegIndex: Map<string, number>` — segmentId → 首条 thinking idx
- 函数签名不变：`normalizeLogs(logs: AgentRunLogEntry[]): ProcessedLog[]`

## 边界处理（≥5 条）

1. **tool_use_id 缺失（task-13 未生效 / 旧 daemon 日志）**：tool_call JSON 不含 `tool_use_id` 字段时，`parseToolCallContent` 返回的 entry.toolUseId 为 undefined，toolUseIndex 不收录 → 自动退化到现有 ±3 窗口启发式（`lastToolSourceIdx` + 时间戳邻近 + tool 名匹配，360-386 行保留作 fallback 路径）。不可因 id 缺失就让整页崩。
2. **tool 无 result（调用进行中）**：tool_use 配对后 mergedToolResult 仍为 undefined → 渲染端（task-15）展示 pending 状态徽标；不报错不隐藏卡片。
3. **result 无 tool_use（孤儿 [TOOL_RESULT]）**：现有 388-404 行逻辑保留——`lastToolSourceIdx < 0` 或 toolUseIndex 无匹配时，按 `parsedToolResult` 独立渲染为 ToolResultCard（不合并到任何卡片）。
4. **thinking 段交错多次断开**：同一 segmentId 的 partial 行可能跨越 [TOOL_USE]、[ASSISTANT]、[TOOL_RESULT] 多次出现 → thinkingSegIndex 持续保留 segmentId 映射直到 segment 结束（下一段 segmentId 不同），期间所有同 id partial 合并到首条。segmentId 缺失时退化为现有相邻合并（断点处重置）。
5. **重复的完整段（D2 场景）**：完整 assistant message 重发整段 thinking（design.md:24 根因）→ `mergeThinkingPiece` 用 startsWith 归并规则识别"完整段已包含所有 partial"并去重，返回较长者；不重复拼接到 prev 尾部造成"partial + 完整段"双份显示。
6. **tool_use_id 冲突（两条 tool_call JSON 同 id，理论上不应发生）**：toolUseIndex 保留首个 entry，后续同 id 条目 hidden=true 并把 mergedToolResult 合并进首条；若 result body 互相覆盖，以最后一条为准（与现有 `mergeToolResult` 179-186 行为一致，`prev += "\n" + body`）。
7. **解析异常（JSON 非法 / 字段类型错）**：`parseToolCallContent`（27-49）已有 try/catch 返回 null；`parseStdoutToolUse`（102-149）同样有 try/catch fallback。新逻辑复用这两个解析函数，不重复抛错路径。

## 非目标

- **不**改 daemon 源头 emit 逻辑（task-13 负责 task-runner.ts:1284-1304 / service.py:3443-3462 补 tool_use_id 字段）。本 task 只消费 task-13 已 emit 的 id。
- **不**改 AgentLogRow / AgentLogViewer 的渲染（task-15 负责 turn 分组、thinking 折叠、tool 卡片状态徽标）。本 task 只保证 ProcessedLog 字段就位、hidden 标记正确。
- **不**改 backend `_extract_sdk_messages`（service.py:3329-3488，D2 根因）的去重逻辑——design.md:124 提到 backend 也应去重，但本 task 仅在前端 normalize 做防御性去重，backend 改动由独立 task 负责（不在本变更 P1 范围内）。
- **不**做 turn 级 thinking 归并（design.md:135 的 turn 分组由 task-15 渲染层做，本 task 只做单条 ProcessedLog 内的内容合并）。
- **不**重写 `mergeAssistantPiece`（208-237）——只参照其归并规则补 `mergeThinkingPiece`，assistant 路径行为不变。

## TDD 步骤

> 测试文件：`frontend/src/components/agent-log/__tests__/normalize.test.ts`（已存在，ql-20260617-011 测试在 1-60 行；新增 task-14 测试追加到文件末尾）。测试辅助 `makeLog`（9-23 行）已有，content/timestamp/id 可直接复用。

### 红：先写失败测试

```ts
// === task-14 测试追加 ===

describe("task-14: tool_use_id 全局配对 (FR-09)", () => {
  it("同一 tool_use_id 的 stdout [TOOL_USE] 与 channel=tool_call JSON 合并为单卡（距离 > ±3 窗口）", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("tool_call", JSON.stringify({ tool: "Bash", args: { command: "ls" }, tool_use_id: "toolu_001", timestamp: "t1" }), "tc1"),
      // 中间穿插 5 条无关 stdout（让 ±3 窗口失效）
      makeLog("stdout", "[ASSISTANT] 正在执行", "a1"),
      makeLog("stdout", "[ASSISTANT] 请稍候", "a2"),
      makeLog("stdout", "[ASSISTANT] 等待", "a3"),
      makeLog("stdout", "[ASSISTANT] 继续", "a4"),
      makeLog("stdout", "[ASSISTANT] 完成", "a5"),
      // 同 tool_use_id 的 stdout [TOOL_USE] —— 距离 tool_call 已 > 3，旧逻辑漏合并
      makeLog("stdout", '[TOOL_USE] Bash: {"command":"ls"}', "tu1"),
    ];
    const result = normalizeLogs(logs);
    const visible = result.filter((p) => !p.hidden);
    // 期望：tool_call 与 [TOOL_USE] 合并成一张卡，只渲染一次
    const toolCards = visible.filter((p) => p.log.id === "tc1" || p.log.id === "tu1");
    expect(toolCards.length).toBe(1);
    expect(toolCards[0]?.log.id).toBe("tc1");
  });

  it("tool_use_id 缺失时退化到 ±3 窗口启发式（向后兼容）", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("tool_call", JSON.stringify({ tool: "Bash", args: { command: "ls" } }), "tc1"),
      makeLog("stdout", '[TOOL_USE] Bash: {"command":"ls"}', "tu1"),
    ];
    const result = normalizeLogs(logs);
    const visible = result.filter((p) => !p.hidden);
    // 无 id 时仍按 ±3 窗口合并
    expect(visible.some((p) => p.log.id === "tu1")).toBe(false);
  });

  it("孤儿 [TOOL_RESULT]（无匹配 tool_use_id）独立渲染不隐藏", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", '[TOOL_RESULT] 残留结果', "tr1"),
    ];
    const result = normalizeLogs(logs);
    expect(result[0]?.hidden).toBe(false);
    expect(result[0]?.parsedToolResult).toBe("残留结果");
  });
});

describe("task-14: thinking 跨断点去重 (D1/D2)", () => {
  it("同一 segmentId 跨 [TOOL_USE] 断点继续合并到首条", () => {
    const logs: AgentRunLogEntry[] = [
      makeLog("stdout", "[THINKING] 用户要求", "t1"),
      makeLog("stdout", "[THINKING] 分析项目", "t2"),
      makeLog("stdout", '[TOOL_USE] Bash: {"command":"ls"}', "tu1"),
      // 断点后继续 thinking —— 旧逻辑会起始新块
      makeLog("stdout", "[THINKING] 继续推理", "t3"),
    ];
    const result = normalizeLogs(logs);
    // 若 segmentId 缺失，本测试改断言为"相邻合并 + 断点重置"行为
    // 若 daemon 提供 segmentId，断言 t3 合并到 t1
    const visible = result.filter((p) => !p.hidden && p.mergedThinkingContent);
    expect(visible.length).toBeGreaterThanOrEqual(1);
  });

  it("完整段重发时去重（mergeThinkingPiece startsWith 归并）", () => {
    // partial 累积到 "A B C"，完整段重发 "A B C D E"
    // 期望：最终 mergedThinkingContent = "A B C D E"，而非 "A B CA B C D E"
    const merged = mergeThinkingPiece("A B C", "A B C D E");
    expect(merged).toBe("A B C D E");
  });

  it("mergeThinkingPiece 完全相同时去重", () => {
    expect(mergeThinkingPiece("同一段", "同一段")).toBe("同一段");
  });
});
```

### 绿：实现至测试通过

1. `types.ts` 加 `toolUseId` / `segmentId` 字段（ProcessedLog + ToolCallEntry）
2. `normalize.ts` 新增 `mergeThinkingPiece` 导出函数（参照 208-237 `mergeAssistantPiece`）
3. `normalize.ts:255-408` `normalizeLogsImpl`：建 toolUseIndex + thinkingSegIndex 两个 Map，替换 360-386 的 ±3 判断为"先查 id Map，无 id 回退 ±3"
4. `parseToolCallContent`（27-49）/ `parseStdoutToolUse`（102-149）解析 tool_use_id 写入 entry

### 重构 / 回归

- 跑现有 `normalize.test.ts`（ql-20260617-011 的所有 thinking 合并测试）必须全绿——新逻辑不能破坏既有相邻合并行为。
- 跑 `pnpm --filter frontend test`（或 `npm run test --prefix frontend`）整套前端测试无回归。
- 跑 `pnpm --filter frontend lint` + `pnpm --filter frontend typecheck`（CI hook 要求）。

## 验收标准

| # | 验收点 | 验证方法 |
|---|---|---|
| 1 | 同一 tool_use_id 的 stdout [TOOL_USE] 与 tool_call JSON 合并为单张卡片（含距离 > ±3 窗口场景） | 单测 "同一 tool_use_id 合并" 通过 + 手动对照 agent-run-7142b6cb.log 中的 init/scan 卡片只显示一次 |
| 2 | tool_use_id 缺失时退化到 ±3 窗口启发式，旧日志仍能合并 | 单测 "tool_use_id 缺失退化" 通过 + 跑现有 normalize.test.ts 全绿（回归） |
| 3 | 孤儿 [TOOL_RESULT]（无匹配 tool_use）独立渲染不隐藏 | 单测 "孤儿 TOOL_RESULT" 通过 |
| 4 | thinking 跨 [TOOL_USE]/[ASSISTANT] 断点继续合并到同 segmentId 首条（segmentId 存在时） | 单测 "跨断点合并" 通过 |
| 5 | 完整段重发时去重（D2 场景：增量段 + 完整段不双份） | 单测 "mergeThinkingPiece startsWith 归并" 通过 |
| 6 | ProcessedLog.toolUseId / segmentId 字段已就位，task-15 可直接读取 | `pnpm --filter frontend typecheck` 通过（types.ts 改动编译通过） |
| 7 | 无 lint / typecheck 错误 | `pnpm --filter frontend lint && pnpm --filter frontend typecheck` 退出码 0 |
| 8 | 现有 normalize.test.ts 全绿（无回归） | `pnpm --filter frontend test normalize` 全通过 |
