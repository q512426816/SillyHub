---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-06
title: A2 stats 透传链路补全（adapter 拆 usage 累加 + _finish 透传 + completeLease 补全 + 后端写回）
priority: P0
depends_on: [task-05]
blocks: [task-12]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/daemon.ts
  - backend/app/modules/daemon/service.py
  - sillyhub-daemon/src/__tests__/stats-passthrough.test.ts
---

# task-06: A2 stats 透传链路补全

## 修改文件

- `sillyhub-daemon/src/adapters/stream-json.ts` — `extractResultStats`(495-513) 改造：拆 `usage` 为 `input_tokens/output_tokens` 并跨 message 累加；签名从 `(msg) => Record` 改为 `(resultMsg, accumulatedUsage) => Record`（对齐后端 SERVER `_extract_result_metadata` 的累加聚合策略）。
- `sillyhub-daemon/src/task-runner.ts` — `_spawnAndStream` 返回值新增 `stats?: Record<string, unknown>`（收集 complete 事件 metadata.stats）；`_finish`(776-810) extra 参数新增 `stats?: Record<string, unknown>` 字段并写入 TaskRunnerResult.stats；`runLease`(242-373) 在 _finish 调用处（287, 306, 358, 367）传 `stats: result.stats`。
- `sillyhub-daemon/src/daemon.ts` — `completeLease` payload(654-664) 补 `stats: taskResult.stats` + `exit_code: taskResult.exitCode`。
- `sillyhub-daemon/src/types.ts` — `TaskRunnerResult`(819-824) 新增 `stats?: Record<string, unknown>` 字段（透传层声明）。
- `backend/app/modules/daemon/service.py` — `complete_lease`(429-505) 补 stats 非空校验（既有 stats 写回逻辑 466-480 已存在但依赖 daemon 上报 stats；额外补 exit_code/num_turns 透传到 AgentRun，若 AgentRun 字段不存在则跳过）。
- `sillyhub-daemon/src/__tests__/stats-passthrough.test.ts`（新增）— adapter 拆 usage + 累加 + _finish 透传 + completeLease payload 完整性单测。

## 实现要求

1. `stream-json.ts` `extractResultStats`(495-513) 改造为支持累加：
   ```typescript
   /**
    * 从 result 消息提取 usage/cost 等 stats，并把 usage.input_tokens/output_tokens
    * 拆平到顶层 + 与历史累加值求和（对齐 SERVER _extract_result_metadata 聚合策略，
    * backend claude_code.py:199-235）。
    *
    * @param resultMsg      result 消息（type:'result' 那一行 JSON）
    * @param accumulated    跨 message 累加的 input_tokens/output_tokens（来自 assistant 事件）
    * @returns stats dict，含 input_tokens/output_tokens（已累加）+ total_cost_usd/num_turns 等
    */
   function extractResultStats(
     resultMsg: Record<string, unknown>,
     accumulated: { input_tokens: number; output_tokens: number },
   ): Record<string, unknown> {
     const stats: Record<string, unknown> = {};
     const knownKeys = [
       'total_cost_usd',
       'total_duration_ms',
       'total_api_duration_ms',
       'num_turns',
       'is_error',
       'duration_ms',
       'result',
     ];
     for (const key of knownKeys) {
       if (key in resultMsg) stats[key] = resultMsg[key];
     }
     // usage 拆平（优先取 result.usage；若 result 无则回落 accumulated）
     const usage = resultMsg.usage;
     if (isRecord(usage)) {
       stats.input_tokens = (typeof usage.input_tokens === 'number' ? usage.input_tokens : 0)
         + accumulated.input_tokens;
       stats.output_tokens = (typeof usage.output_tokens === 'number' ? usage.output_tokens : 0)
         + accumulated.output_tokens;
     } else {
       // result 无 usage → 仅用 accumulated（assistant 事件聚合值）
       if (accumulated.input_tokens > 0 || accumulated.output_tokens > 0) {
         stats.input_tokens = accumulated.input_tokens;
         stats.output_tokens = accumulated.output_tokens;
       }
     }
     return stats;
   }
   ```
   - **聚合策略对齐 SERVER**：SERVER `_extract_result_metadata`(claude_code.py:186-235) 优先用 result.usage（单次汇总），缺失时回落 assistant.message.usage 跨 turn 累加；本实现等价：result.usage 优先 + 累加 fallback（result.usage 本身已是 claude CLI 汇总值，累加 accumulated 是防御性双保险）。
   - **`isRecord` 复用既有工具函数**（grep 确认 stream-json.ts 已 import 或定义）。
2. `stream-json.ts` 调用点（338）改：
   ```typescript
   // 改前
   stats: extractResultStats(msg),
   // 改后（需把 accumulated 传进来；当前 parse 入口签名是 parse(line: string)）
   stats: extractResultStats(msg, this._accumulatedUsage),
   ```
   - 在 StreamJsonAdapter class 内新增字段 `private _accumulatedUsage = { input_tokens: 0, output_tokens: 0 };`（类成员，跨行持久）。
   - 在 `parseAssistant`（或解析 assistant 事件处）累加 `event.message.usage.input_tokens/output_tokens` 进 `_accumulatedUsage`（grep 确认 parseAssistant 位置；若 stream-json.ts 无 parseAssistant，需在主 parse 分支处理 assistant event 时累加）。
   - **adapter 是 lease 级实例还是全局单例？** —— 需 execute 时确认 task-runner.ts 步骤4 `getBackend(provider)`(282) 每次返回新实例还是缓存单例。若是单例，`_accumulatedUsage` 必须 reset（在 runLease 步骤4 拿到 adapter 后调 `adapter.resetAccumulator?.()` 或在 _spawnAndStream 入口重置）。**默认实现：reset 方法 + 调用方重置**，避免跨 lease 污染。
3. `task-runner.ts` `_spawnAndStream` 返回值（406 类型 + 600 返回）补 stats：
   ```typescript
   // 返回类型（406）
   private async _spawnAndStream(params: ...): Promise<{
     status: 'completed' | 'failed' | 'timeout' | 'cancelled';
     exitCode: number;
     error?: string;
     stats?: Record<string, unknown>;  // 新增
   }> {
     // ...
     // 收集 complete 事件 stats（在 _handleLine 内 parse 后）
     // 需在 _handleLine 入参 env 加 onStats 回调
   }
   ```
   - `_handleLine`(609-691) env 参数(613-619)新增 `onStats: (stats: Record<string, unknown>) => void`；遍历 events(660-677) 时若 `ev.type === 'complete' && ev.metadata?.stats` 调 `env.onStats(ev.metadata.stats as Record<string, unknown>)`。
   - `_spawnAndStream` 内新增局部 `let lastStats: Record<string, unknown> | undefined;`，onStats 赋值（覆盖式，complete 事件通常仅一个）。
   - 返回（600）补 `stats: lastStats`。
4. `task-runner.ts` `_finish`(776-810) extra 参数 + 返回值补 stats：
   ```typescript
   private _finish(
     leaseId: string,
     startTime: number,
     success: boolean,
     exitCode: number,
     status: TaskStatus,
     output: string,
     error: string,
     sessionId: string,
     extra: {
       diff: { patch: string; files_changed: number; insertions: number; deletions: number; stats: string };
       error?: string;
       exitCode?: number;
       spawnStatus?: string;
       stats?: Record<string, unknown>;  // 新增
     },
   ): TaskRunnerResult {
     // ...
     return {
       // ... 既有字段
       stats: extra.stats,  // 新增（undefined 也允许，调用方判空）
     };
   }
   ```
   - 4 处 `_finish` 调用（287, 306, 358, 367）补 stats：前两处（unsupported provider / cmdPath 空）传 `stats: undefined`；后两处（success / catch）传 `stats: result.stats`（仅 358 success 路径有真实 stats，367 catch 路径 undefined）。
5. `types.ts` `TaskRunnerResult`(819-824) 补字段：
   ```typescript
   export interface TaskRunnerResult extends TaskResult {
     status: TaskStatus;
     sessionId: string;
     /** claude result 消息 stats（cost/tokens/turns）；失败路径可能 undefined。 */
     stats?: Record<string, unknown>;  // 新增
   }
   ```
6. `daemon.ts` `completeLease` payload(654-664) 补 stats + exit_code：
   ```typescript
   await this._client.completeLease(leaseId, claimToken, {
     success: taskResult.success,
     output: taskResult.output,
     error: taskResult.error,
     patch: taskResult.patch,
     files_changed: taskResult.filesChanged,
     insertions: taskResult.insertions,
     deletions: taskResult.deletions,
     duration_ms: taskResult.durationMs,
     session_id: taskResult.metadata?.session_id ?? taskResult.sessionId ?? '',
     stats: taskResult.stats,          // 新增
     exit_code: taskResult.exitCode,   // 新增（exit_code 入 stats 或平铺皆可；后端 stats.exit_code 已支持，平铺更稳妥）
     status: taskResult.status,        // 新增（complete_lease 447 读 result.status）
   });
   ```
   - **status 字段**：complete_lease(447) `result_status = result.get("status", "completed")` 已消费 status，当前 daemon payload 没传（默认 completed）。补上后 failed lease 能正确标 AgentRun.failed（而非误判 completed）。
7. `backend/app/modules/daemon/service.py` `complete_lease`(429-505) **既有 stats 写回逻辑(466-480) 已正确**，本任务只需补：
   - 非空校验：`if stats and isinstance(stats, dict):` 块内 `exit_code` 写回 AgentRun.exit_code（既有 479-480 已有，确认）；若 AgentRun 无 `num_turns` 字段则跳过（grep 确认 AgentRun model 是否有 num_turns；无则 stats.num_turns 忽略，不入库）。
   - `agent_run.duration_ms` 写回(461-462) 优先用 result.duration_ms；stats.duration_ms(471-472) 覆盖（已是既有逻辑，确认 stats.duration_ms 优先级高于 result.duration_ms，不冲突）。
   - **改动最小**：本任务后端代码改动仅在既有 stats 块加日志或调试字段（验证透传到位），核心写回逻辑零改动。
8. 新增测试 `__tests__/stats-passthrough.test.ts`：
   - case1（adapter 拆 usage）：mock result 消息 `{ usage: { input_tokens: 100, output_tokens: 50 }, total_cost_usd: 0.01 }` + accumulated `{ input_tokens: 30, output_tokens: 20 }` → extractResultStats 返回 `{ input_tokens: 130, output_tokens: 70, total_cost_usd: 0.01 }`。
   - case2（result 无 usage）：result 无 usage + accumulated `{ input_tokens: 30, output_tokens: 20 }` → stats.input_tokens=30, output_tokens=20。
   - case3（_finish 透传）：mock _spawnAndStream 返回 `stats: { total_cost_usd: 0.05 }` → _finish 返回 TaskRunnerResult.stats 含此值。
   - case4（completeLease payload 完整）：runLease 成功路径 → spy on client.completeLease，断言 result 含 `stats` / `exit_code` / `status` 字段。
   - case5（adapter reset）：跨两次 runLease，第一次 result 有 usage 100/50，第二次无 usage → 第二次 stats.input_tokens 不含第一次的 100（reset 生效）。

## 接口定义

```typescript
// stream-json.ts
class StreamJsonAdapter {
  private _accumulatedUsage: { input_tokens: number; output_tokens: number };
  /** 跨 lease 重置（task-runner 每次拿到 adapter 后调用，避免单例污染）。 */
  resetAccumulator(): void;
}

function extractResultStats(
  resultMsg: Record<string, unknown>,
  accumulated: { input_tokens: number; output_tokens: number },
): Record<string, unknown>;
// stats 输出含：input_tokens, output_tokens, total_cost_usd?, total_duration_ms?,
//               total_api_duration_ms?, num_turns?, is_error?, duration_ms?, result?

// task-runner.ts
interface _SpawnAndStreamResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  exitCode: number;
  error?: string;
  stats?: Record<string, unknown>;  // 新增
}

// types.ts
interface TaskRunnerResult extends TaskResult {
  status: TaskStatus;
  sessionId: string;
  stats?: Record<string, unknown>;  // 新增
}

// daemon.ts completeLease payload（snake_case 对齐 backend Pydantic）
{
  success, output, error, patch, files_changed, insertions, deletions,
  duration_ms, session_id,
  stats: TaskRunnerResult.stats,        // 新增
  exit_code: TaskRunnerResult.exitCode, // 新增
  status: TaskRunnerResult.status,      // 新增（complete_lease 447 消费）
}

// backend complete_lease stats 写回字段（既有，无新增）：
//   AgentRun.total_cost_usd / duration_ms / input_tokens / output_tokens
//   / session_id / exit_code
```

## 边界处理

1. **null/空值**：`taskResult.stats` undefined（失败路径 / claude 无 result 消息）→ completeLease payload `stats: undefined` → JSON.stringify 丢弃该字段 → 后端 `result.get("stats")` 返回 None → 既有 `if stats and isinstance(stats, dict)` 跳过写回（无副作用）。
2. **兼容性 brownfield**：backend `complete_lease` 既有 stats 写回逻辑(466-480) 已存在且正确，daemon 不传 stats 时后端正常空跑；本任务补 daemon 上报侧，后端零破坏性改动。
3. **异常不静默吞**：extractResultStats 内 usage 字段类型校验失败（非 number）→ 当 0 处理（防御性），不抛出；adapter parse 异常已有 try/catch（650-653）保护单行不中断。
4. **参数不可变**：accumulated 是值类型（{ input_tokens, output_tokens }），extractResultStats 内不 mutate 入参；adapter._accumulatedUsage 仅在 parseAssistant 重置点 + resetAccumulator 修改。
5. **歧义/冲突**：
   - stats.duration_ms（来自 result）vs result.duration_ms（顶层）vs agent_run.duration_ms：后端优先级是 `result.duration_ms`(461) → stats.duration_ms 覆盖(471)；daemon 侧 result.duration_ms 即 taskResult.durationMs（实际墙钟），stats.duration_ms 是 claude API 累计；**两者语义不同**，让后端既有覆盖逻辑决定（stats.duration_ms 覆盖 result.duration_ms 写入 AgentRun.duration_ms）—— 不在 daemon 侧干预。
   - stats.session_id vs result.session_id vs taskResult.sessionId：后端 `if result.get("session_id")`(463) 优先，stats.session_id(477) 覆盖；三者应一致（claude result 消息带 session_id），冲突时 stats 优先（最新源）。
6. **累加器污染**：adapter 单例情况下 _accumulatedUsage 跨 lease 累加错误；**必须** resetAccumulator 在 runLease 入口或 _spawnAndStream 入口调用（execute 时确认 adapter 生命周期）。
7. **adapter 累加 assistant.usage 字段路径**：claude stream-json assistant 事件的 usage 在 `event.message.usage`（claude_code.py:222-225 确认）；adapter 解析 assistant event 时需读 `msg.message.usage.input_tokens`。execute 时确认 stream-json.ts 的 assistant 解析分支正确路径。

## 非目标

- 不改 complete_lease 的 patch 应用逻辑（507-528，task-07 关心 diff）。
- 不实现 A3 conversation log 汇总文本（task-08 决策）。
- 不改 AgentRun 数据模型（无 schema 变更，design §8）。
- 不改 submit_messages 实时流（A1 已等价，task-08 仅验证）。
- 不改后端 `redact_output`（task-07 复用）。

## TDD 步骤

1. **写测试** → 新增 `__tests__/stats-passthrough.test.ts` 5 case（见实现要求 8）。
2. **确认失败** → `cd sillyhub-daemon && pnpm vitest run stats-passthrough`（extractResultStats 签名变更导致既有调用编译错，或 _finish 不透传 stats）。
3. **写实现** → stream-json.ts（adapter 字段 + extractResultStats 改签名 + parseAssistant 累加 + resetAccumulator）→ task-runner.ts（_spawnAndStream 收集 + _finish 透传 + 4 处调用补字段）→ types.ts（TaskRunnerResult.stats）→ daemon.ts（completeLease payload）。
4. **确认通过** → `cd sillyhub-daemon && pnpm vitest run stats-passthrough` 全绿。
5. **回归** → `cd sillyhub-daemon && pnpm test`（含既有 task-runner / stream-json 套件不退化）+ `cd backend && uv run pytest -q backend/app/modules/daemon/tests`（complete_lease 写回不退化）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `grep -n "function extractResultStats\|extractResultStats(" sillyhub-daemon/src/adapters/stream-json.ts` | 签名含 `accumulated` 第二参数；调用点(338)传入 `this._accumulatedUsage` |
| AC-02 | `grep -n "_accumulatedUsage\|resetAccumulator" sillyhub-daemon/src/adapters/stream-json.ts` | adapter 类含字段 + reset 方法；parseAssistant 分支累加 message.usage.input_tokens/output_tokens |
| AC-03 | `grep -n "stats" sillyhub-daemon/src/task-runner.ts \| grep -c "_finish\|result.stats"` | _finish 返回含 stats；_spawnAndStream 返回含 stats；4 处 _finish 调用 stats 字段补齐 |
| AC-04 | `grep -n "stats:" sillyhub-daemon/src/daemon.ts` | completeLease payload(654-664) 含 `stats: taskResult.stats` + `exit_code` + `status` |
| AC-05 | `cd sillyhub-daemon && pnpm vitest run stats-passthrough` | 5 case 全绿（拆 usage + 累加 + 透传 + payload 完整 + reset） |
| AC-06 | 端到端冒烟（需真实 claude CLI）：触发一个 task run 完成 | `SELECT total_cost_usd, input_tokens, output_tokens, session_id, exit_code FROM agent_runs WHERE id=...` **全部非空**且对齐 claude result 消息（手工比对 daemon 日志 complete 事件 stats） |
| AC-07 | `grep -n "stats\|exit_code\|num_turns" backend/app/modules/daemon/service.py \| grep -A1 complete_lease` | complete_lease(429-505) 既有 stats 写回块(466-480) 完整，含 total_cost_usd/duration_ms/input_tokens/output_tokens/session_id/exit_code 6 字段（duration_ms 优先级确认） |
