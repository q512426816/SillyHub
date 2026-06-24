---
id: task-09
title: config.ts 新增 retry_*/outbox_*/loop_restart_backoff_ms 配置项 + 默认值
priority: P1
wave: W2
depends_on: []
blocks: [task-13, task-14]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/config.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-09: config 新增可靠性配置项

> 来源：design.md §5 Phase2/3 / §9 兼容（config 有默认值）；plan.md Wave2 task-09。
> 本质：config.ts 加重试/outbox/循环退避配置项 + 默认值 + normalize 校验。供 ResilienceService/Outbox/daemon 使用。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/config.ts` | DaemonConfig interface + DEFAULT_CONFIG + normalize 加项 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-04 | 重试参数可配 | retry_max_attempts/base_delay_ms/backoff_factor/jitter |

## 实现要求

新增配置项（interface + DEFAULT_CONFIG 默认 + normalize）：
- `retry_max_attempts: number`（默认 3）
- `retry_base_delay_ms: number`（默认 1000）
- `retry_backoff_factor: number`（默认 2）
- `retry_jitter: number`（默认 0.2）
- `outbox_max_per_run: number`（默认 500）
- `outbox_max_total: number`（默认 5000）
- `disconnect_log_threshold_sec: number`（默认 30，task-05 用；若 task-05 已加则不重复）
- `loop_restart_backoff_ms: number`（默认 5000，task-04 用；若 task-04 已加则不重复）

normalize 校验：各数值 <=0 或非法 → 回填默认 + warn；retry_jitter 限制 [0,1]。

## 接口定义

```ts
// DaemonConfig 追加字段
retry_max_attempts: number;
retry_base_delay_ms: number;
retry_backoff_factor: number;
retry_jitter: number;
outbox_max_per_run: number;
outbox_max_total: number;
disconnect_log_threshold_sec: number;  // 若 task-05 已加，跳过
loop_restart_backoff_ms: number;        // 若 task-04 已加，跳过
```

## 边界处理

1. **缺字段/非法**：normalize 回填默认（与现有 normalizeAllowedRoots 等模式一致）。
2. **向后兼容**：旧 config.json 无这些字段 → normalize 补默认，不报错。
3. **jitter 范围**：<0→0，>1→1。
4. **max_attempts 下限**：<1→1。
5. **不破坏现有字段**：仅追加。
6. **与 task-04/05 去重**：若 task-04/05 已加 loop_restart_backoff_ms/disconnect_log_threshold_sec，本 task 不重复加，仅补其余。

## 非目标

- 不实现 ResilienceService 消费（task-08/13）。
- 不改 config.json 现有字段。
- 不加 CLI option（--retry-* 等，YAGNI，config.json 覆盖即可）。

## 参考

- config.ts:90-210（DaemonConfig + DEFAULT_CONFIG + normalize 模式）
- task-04 loop_restart_backoff_ms / task-05 disconnect_log_threshold_sec
- design.md §5 / §9

## TDD 步骤

1. 写测试：DEFAULT_CONFIG 含新项默认值；normalize 缺字段补默认；非法值回填；jitter 裁剪。
2. 确认失败。
3. 实现。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归现有 config 测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 新字段有默认值 | DEFAULT_CONFIG 含 retry_max_attempts=3 等 |
| AC-02 | 缺字段补默认 | load 空 config → 字段为默认 |
| AC-03 | 非法回填 | retry_max_attempts=0 → 3 |
| AC-04 | jitter 裁剪 | jitter=5 → 1 |
| AC-05 | 不重复加已有项 | task-04/05 已加的不重复 |
| AC-06 | 现有测试绿 | `pnpm test` 通过 |
