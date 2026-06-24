---
id: task-16
title: dedupKeyFor（Claude msg.id 优先；否则 runId:turnSeq:flatSeq）
priority: P0
wave: W3
depends_on: []
blocks: [task-17, task-23]
requirement_ids: [FR-08]
decision_ids: [D-001@v2]
allowed_paths:
  - sillyhub-daemon/src/resilience/error-classify.ts
  - sillyhub-daemon/src/resilience/__tests__/dedup-key.test.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-16: dedupKeyFor

> 来源：design.md §7 dedupKeyFor / §10 R-01；plan.md Wave3 task-16。D-001@v2。
> 本质：为每条 flat message 生成稳定 dedup_key。Claude SDK message 带 id 优先；否则 `${runId}:${turnSeq}:${flatSeq}` 确定性。避免 content-hash（相同内容误去重 R-01）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/resilience/error-classify.ts` | 加 dedupKeyFor |
| 新增 | `sillyhub-daemon/src/resilience/__tests__/dedup-key.test.ts` | 单测 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-08 | 稳定 dedup_key | dedupKeyFor |

## 实现要求

1. **`dedupKeyFor(msg, runId, turnSeq, flatSeq)`**：
   - `msg.id`（Claude SDK assistant message 带 id，字符串）存在且非空 → 用之。
   - Codex flat message 无 id → `${runId}:${turnSeq}:${flatSeq}`。
   - 兜底：无 turnSeq/flatSeq → `${runId}:${Date.now()}`（极端，不应常态）。
2. **确定性**：同 message 同 seq → 同 key（重发命中 backend ON CONFLICT）。
3. **避免 content-hash**：相同内容不同 turn/seq 不去重（R-01）。
4. **替换 task-10/11 内联简易版**：本 task 落地后，task-10/11 的内联 dedup_key 改调 dedupKeyFor 统一。

## 接口定义

```ts
export function dedupKeyFor(
  msg: Record<string, unknown>, runId: string, turnSeq: number, flatSeq: number,
): string {
  const id = typeof msg.id === 'string' && msg.id ? msg.id : '';
  if (id) return id;
  return `${runId}:${turnSeq}:${flatSeq}`;
}
```

## 边界处理

1. **msg.id 缺失**：用 runId:turnSeq:flatSeq。
2. **turnSeq/flatSeq 缺失**：兜底 runId:timestamp（warn，非常态）。
3. **避免 content-hash**：明确不用内容哈希（R-01 误去重）。
4. **参数不可变**。
5. **key 长度**：msg.id 可能长，backend dedup_key 列 String(200)（task-20 设宽）足够；本 task 不截断。
6. **确定性**：同输入同输出。

## 非目标

- 不实现 backend 去重（task-21）。
- 不实现 content-hash。
- 不改 backend 列宽（task-20）。

## 参考

- design.md §7 / §10 R-01
- task-10/11 内联简易版（本 task 替换）
- D-001@v2

## TDD 步骤

1. 写测试：msg.id 存在→用 id；无 id→runId:turnSeq:flatSeq；确定性（同输入同输出）；不同 seq 不同 key。
2. 确认失败。
3. 实现 + 替换 task-10/11 内联版。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | msg.id 优先 | 有 id → key===id |
| AC-02 | 无 id 确定性 | 无 id → `${runId}:${turnSeq}:${flatSeq}` |
| AC-03 | 同输入同输出 | 确定性 |
| AC-04 | 不同 seq 不同 key | 不误去重 |
| AC-05 | task-10/11 改调 | grep dedupKeyFor 命中 daemon/task-runner |
| AC-06 | 测试全绿 | `pnpm test` 通过 |
