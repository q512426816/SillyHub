---
id: task-11
title: task-runner batch submit 改走 submitWithRetry + 生成 dedup_key（保持非阻塞）
priority: P0
wave: W2
depends_on: [task-08]
blocks: [task-14]
requirement_ids: [FR-10]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-11: batch task-runner 走 submitWithRetry

> 来源：design.md §5 Phase2（范围 B 两条路径）/ §10 R-11；plan.md Wave2 task-11。D-005 范围 B。
> 本质：batch task-runner.ts:1147 的 `_client.submitMessages(...)`（原 fire-and-forget）改走 `_resilience.submitWithRetry` + 生成 dedup_key，**保持非阻塞**（不 await 阻塞 stdout readline）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/task-runner.ts` | _submitEvent/submit 调用点改走 resilience |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-10 | batch task-runner 走 submitWithRetry + dedup_key | 改调用点 |
| D-005@v1 | 范围 B（batch 路径覆盖） | batch fire-and-forget 改走重试 |

## 实现要求

1. **读 task-runner.ts:1147**：当前 `.submitMessages(env.leaseId, env.claimToken, env.agentRunId, messages)` fire-and-forget（注释 1142-1144 说明不阻塞 readline）。
2. **改走 resilience**：
   ```ts
   // 修改前
   this._client.submitMessages(env.leaseId, env.claimToken, env.agentRunId, messages);
   // 修改后（保持非阻塞：void 不 await）
   void this._resilience?.submitWithRetry(env.leaseId, env.claimToken, env.agentRunId,
     messages.map(m => ({ message: m, dedup_key: dedupKeyFor(m, env.agentRunId, seq++) })))
     .catch(e => this._logger.warn('batch_submit_failed', { run_id: env.agentRunId, cause: toCauseInfo(e) }));
   ```
   - `_resilience` 未注入 → 回退原 `_client.submitMessages` fire-and-forget。
3. **保持非阻塞**：`void ... .catch()` 不 await，readline 不阻塞（R-11）。
4. **dedup_key**：同 task-10，task-16 统一前内联简易生成。
5. **claimToken 空**：现有容错（293 注释，容忍空 token）保留。

## 接口定义

见实现要求伪码。dedup_key 同 task-10（msg.id 优先，否则 runId:seq）。

## 边界处理

1. **保持非阻塞**：void + catch，不 await（R-11，否则阻塞 stdout readline 丢数据）。
2. **_resilience 未注入**：回退原 _client fire-and-forget。
3. **空 agentRunId**：现有 ql-004 守卫（1144）不调，保留。
4. **dedup_key 缺失**：runId:seq 兜底。
5. **catch 兜底**：submitWithRetry 用尽入 outbox 不抛；catch 仅兜未预期 + warn。
6. **seq 计数**：每 run 维护递增 seq（或用 message 内 seq）。
7. **参数不可变**：messages 只读 map。

## 非目标

- 不改 interactive onTurnMessage（task-10）。
- 不改终态上报（task-12）。
- 不改 _eventToMessage 转换逻辑（1154）。
- 不实现 dedupKeyFor 最终版（task-16）。

## 参考

- task-runner.ts:1142-1155（submitMessages fire-and-forget）
- task-08 ResilienceService
- design.md §5 Phase2 / §10 R-11 / D-005@v1

## TDD 步骤

1. 写测试：注入 mock _resilience → batch submit 调 submitWithRetry（非阻塞，不 await）；未注入回退 _client；dedup_key 生成；非阻塞断言（调用立即返回）。
2. 确认失败。
3. 实现。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归现有 task-runner 测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 改调 submitWithRetry | 注入 _resilience → 调 submitWithRetry |
| AC-02 | 非阻塞 | void 不 await，readline 不阻塞 |
| AC-03 | 未注入回退 | null → _client.submitMessages |
| AC-04 | dedup_key 生成 | envelopes 含 dedup_key |
| AC-05 | catch 兜底 | 用尽 warn 不崩 |
| AC-06 | 现有测试绿 | `pnpm test` 通过 |
