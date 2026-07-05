---
id: task-10
title: daemon.onTurnMessage 改调 _resilience.submitWithRetry（+ 未注入回退直接调 HubClient）
priority: P0
wave: W2
depends_on: [task-08]
blocks: [task-14]
requirement_ids: [FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-10: onTurnMessage 改调 submitWithRetry

> 来源：design.md §5 Phase2（onTurnMessage 仅改一处）/ §9 兼容（未注入回退）；plan.md Wave2 task-10。D-005 范围 B。
> 本质：daemon.onTurnMessage:1287 的 `_client.submitMessages(...)` → `_resilience.submitWithRetry(...)`。`_resilience` 未注入时回退直接调 `_client`（向后兼容 + 测试可注入 mock）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/daemon.ts` | onTurnMessage 调用点 + Daemon 构造接 _resilience 可选注入 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-04 | interactive submit 走重试 | onTurnMessage 改调 submitWithRetry |
| D-005@v1 | 范围 B（interactive 路径覆盖） | interactive onTurnMessage |

## 实现要求

1. **Daemon 构造**：加可选 `_resilience: ResilienceService | null`（构造参数或 setter，由 task-13 cli 注入；未注入=null）。
2. **onTurnMessage（1287）改造**：
   ```ts
   // 修改前
   await this._client.submitMessages(state.leaseId, state.claimToken, runId, [fwdMsg]);
   // 修改后
   if (this._resilience) {
     await this._resilience.submitWithRetry(state.leaseId, state.claimToken, runId,
       [{ message: fwdMsg, dedup_key: dedupKeyFor(fwdMsg, runId, turnSeq) }]);
   } else {
     await this._client.submitMessages(state.leaseId, state.claimToken, runId, [fwdMsg]); // 回退
   }
   ```
3. **dedup_key 生成**：调 `dedupKeyFor`（task-16）。task-16 在 W3，本 task 可先用占位（如 `fwdMsg.id ?? runId+seq`）或直接内联简单逻辑，task-16 统一。**注意**：为避免 W2 阻塞 W3，本 task 先内联 dedup_key 简易生成（Claude msg.id 优先，否则 `${runId}:${turnSeq}`），task-16 落地后替换为统一 dedupKeyFor。
4. **catch 不变**：onTurnMessage 的 try/catch（1293）保留，submitWithRetry 用尽入 outbox 后不抛（task-08 内部 warn），catch 仅兜未预期。task-02 的 cause 展开保留。

## 接口定义

见实现要求伪码。dedup_key：`fwdMsg.id`（Claude SDK message 带 id）优先；否则 `${runId}:${turnSeq}`（turnSeq 由 onTurnMessage 维护计数器或用 Date.now 兜底）。

## 边界处理

1. **_resilience 未注入**：回退直接调 _client（行为同今，无重试），向后兼容。
2. **dedup_key 缺失 msg.id**：用 runId+seq 兜底（task-16 统一）。
3. **空 runId**：onTurnMessage 已有 `on_turn_message_empty_run_id` 守卫（1231），不到此。
4. **不阻塞 turn**：submitWithRetry 内部 async 重试，await 不阻塞 driver（driver 产 message 是流式，每条 await 提交；与现有 fire-and-forget 不同——注意 batch task-runner 保持非阻塞，interactive onTurnMessage 现状是 await，本 task 保持 await 不改语义）。
5. **catch 兜底**：submitWithRetry 用尽已 warn 入 outbox 不抛；catch 仅兜 outbox.enqueue 自身异常。
6. **参数不可变**：fwdMsg 只读。

## 非目标

- 不改 batch task-runner（task-11）。
- 不改终态上报（task-12）。
- 不实现 dedupKeyFor 最终版（task-16）。
- 不改 onTurnMessage 的 usage 提取逻辑（1259-1286）。

## 参考

- daemon.ts:1201-1300（onTurnMessage）
- task-08 ResilienceService.submitWithRetry
- task-16 dedupKeyFor（W3 统一）
- design.md §5 Phase2 / D-005@v1

## TDD 步骤

1. 写测试：注入 mock _resilience → onTurnMessage 调 submitWithRetry（而非直接 _client）；未注入 → 调 _client（回退）；dedup_key 生成断言。
2. 确认失败。
3. 实现改造。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归 daemon-interactive-bridge.test.ts。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 改调 submitWithRetry | 注入 _resilience → 调 submitWithRetry |
| AC-02 | 未注入回退 | _resilience null → 调 _client.submitMessages |
| AC-03 | dedup_key 生成 | envelope.dedup_key 非空（msg.id 或 runId:seq） |
| AC-04 | catch 保留 | submitWithRetry 用尽不抛，turn 继续 |
| AC-05 | 现有测试绿 | `pnpm test` 通过（含 interactive bridge） |
