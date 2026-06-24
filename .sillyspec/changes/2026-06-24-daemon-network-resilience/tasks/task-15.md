---
id: task-15
title: 新增 resilience/outbox.ts（落盘 JSONL + markDelivered + load 恢复 + 容量上限）
priority: P0
wave: W3
depends_on: []
blocks: [task-13, task-17, task-18, task-23]
requirement_ids: [FR-06, FR-09]
decision_ids: [D-001@v2]
allowed_paths:
  - sillyhub-daemon/src/resilience/outbox.ts
  - sillyhub-daemon/src/resilience/__tests__/outbox.test.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-15: outbox.ts

> 来源：design.md §5 Phase3（落盘暂存）/ §7 Outbox 接口 / §10 R-04/R-07；plan.md Wave3 task-15。D-001@v2 幂等前提。
> 本质：落盘 JSONL outbox（`~/.sillyhub/daemon/outbox/<runId>.jsonl`）+ markDelivered 原子移除 + load 启动恢复 + 容量上限。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/resilience/outbox.ts` | Outbox 类 + Envelope/OutboxEntry 接口 |
| 新增 | `sillyhub-daemon/src/resilience/__tests__/outbox.test.ts` | 单测 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-06 | 用尽入 outbox + markDelivered | enqueue/markDelivered |
| FR-09 | daemon 重启 load 恢复 | load() |

## 实现要求

1. **接口**：
   ```ts
   export interface Envelope { message: Record<string, unknown>; dedup_key: string; }
   export interface OutboxEntry { leaseId: string; claimToken: string; runId: string; envelopes: Envelope[]; ts: string; }
   export interface Outbox {
     enqueue(entry: OutboxEntry): Promise<void>;
     markDelivered(runId: string, dedupKeys: string[]): Promise<void>;
     pendingByRun(runId: string): OutboxEntry[];
     load(): Promise<void>;
   }
   ```
2. **落盘**：每 run 一个 `<outboxDir>/<runId>.jsonl`，每 entry 一行 JSON append。
3. **markDelivered**：移除该 run 文件中匹配 dedup_key 的 entry；文件空则删文件。原子性：读全→过滤→重写临时文件→rename（防并发损坏）。
4. **load**：启动时 glob `<outboxDir>/*.jsonl`，读入内存 pending map（runId→entries）。
5. **容量上限**：enqueue 时检查 per-run（maxPerRun，默认 500）+ total（maxTotal，默认 5000），超限丢最旧 entry + warn（R-04）。
6. **路径**：`join(homedir(), '.sillyhub', 'daemon', 'outbox')`，ensureDir。
7. **dedup_key 在 entry 内**：markDelivered 按 dedup_key 匹配移除。

## 接口定义

见实现要求。Outbox 构造 `new Outbox(dir, { maxPerRun, maxTotal }, logger)`。

## 边界处理

1. **文件损坏/非法 JSON 行**：load 跳过该行 + warn，不整体崩。
2. **跨进程并发**：原子 rename 写；单 daemon 实例下无并发写同文件（ql-006 runtime lock 保证单实例）。
3. **容量超限**：丢最旧 entry + warn（R-04）。
4. **markDelivered 无匹配**：no-op。
5. **参数不可变**：entry 只读。
6. **lease 终态**：outbox 不主动判 lease/session 终态（task-18 drain 时校验），outbox 只管存取。
7. **空文件清理**：markDelivered 后文件空 → unlink。

## 非目标

- 不实现 drain（task-18）。
- 不实现 dedup_key 生成（task-16）。
- 不调 backend（纯本地）。
- 不加密（本地文件，明文 JSONL）。

## 参考

- design.md §5 Phase3 / §7 Outbox / §10 R-04/R-07
- config.ts homedir 模式
- D-001@v2（dedup_key 幂等前提）

## TDD 步骤

1. 写测试：enqueue 落盘文件 + 行数；markDelivered 移除匹配 + 空文件删；load 恢复 pending；容量超限丢最旧；损坏行跳过。
2. 确认失败。
3. 实现。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | enqueue 落盘 | 文件存在 + entry 行 |
| AC-02 | markDelivered 移除 | 匹配 dedup_key 的 entry 消失 |
| AC-03 | 空文件清理 | 全移除后文件 unlink |
| AC-04 | load 恢复 | 重启后 pendingByRun 返回 entries |
| AC-05 | 容量上限 | 超 maxPerRun/maxTotal 丢最旧 + warn |
| AC-06 | 损坏行跳过 | 非法 JSON 行不崩 |
| AC-07 | 测试全绿 | `pnpm test` 通过 |
