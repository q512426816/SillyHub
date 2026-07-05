---
id: task-05
title: daemon.ts 断连 FATAL 计数（不主动 degraded，复用 backend 45s offline）
priority: P1
wave: W1
depends_on: []
blocks: [task-06]
requirement_ids: [FR-03]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/config.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-05: daemon.ts 断连 FATAL 计数

> 来源：design.md §5 Phase1 断连感知（D-006）/ decisions.md D-003@v1+D-006@v1；plan.md Wave1 task-05。
> 本质：backend `DEFAULT_RUNTIME_STALE_SECONDS=45s`（runtime/service.py:23）已因心跳超时自然判 runtime offline。daemon **不主动**调 offline 端点上报 degraded（滞后冗余）。daemon 侧仅做连续断连计数 + 超阈值记一次 FATAL（运维感知）；网络恢复后 heartbeat 自动把 runtime 拉回 online。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/daemon.ts` | _heartbeatLoop 加断连计数 + 阈值 FATAL |
| 修改 | `sillyhub-daemon/src/config.ts` | 加 `disconnect_log_threshold_sec`（默认 30）+ `loop_restart_backoff_ms`（默认 5000，task-04 用） |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-03 | 断连 FATAL 计数，不主动 degraded | 计数 + 阈值 FATAL，不调 offline |
| D-003@v1 | runtime status 自由 String 无需 migration | 不改 backend |
| D-006@v1 | 断连不主动 degraded，复用 backend 45s offline | 不调 offline 端点 |

## 实现要求

1. **config.ts 加项**：`disconnect_log_threshold_sec: number`（默认 30）加入 DaemonConfig interface + DEFAULT_CONFIG（198 附近）+ normalize 校验（>0）。
2. **daemon 加断连状态**：类成员 `_heartbeatFailSince: number | null`（记录首次失败时间戳 ms，null=健康）。注意：Date.now() 在 daemon 运行时可用（非 sillyspec 脚本），本任务在 daemon 源码用 Date.now() 合规。
3. **_heartbeatLoop 成功分支**：heartbeat 成功 → `_heartbeatFailSince = null`（清零）。
4. **失败分支（1447-1450）**：累加——`if (_heartbeatFailSince===null) _heartbeatFailSince=Date.now()`；若 `Date.now()-_heartbeatFailSince >= threshold*1000` 且未告警过 → 记一次 FATAL `daemon_disconnect_degraded`（含 runtime_id + 持续时长），置 `_degradedWarned=true` 防重复。
5. **恢复清告警**：成功时 `_degradedWarned=false`，允许下次断连再次告警。
6. **不调 offline 端点**：明确不调 `this._client.markOffline`/offline 端点（D-006）。

## 接口定义

```ts
// daemon 类新增成员
private _heartbeatFailSince: number | null = null;
private _degradedWarned = false;

// _heartbeatLoop 内（伪码）
try { await this._client.heartbeat(rid);
  this._heartbeatFailSince = null;
  this._degradedWarned = false; }
catch (e) {
  if (this._heartbeatFailSince === null) this._heartbeatFailSince = Date.now();
  const elapsed = Date.now() - this._heartbeatFailSince;
  if (!this._degradedWarned && elapsed >= this._config.disconnect_log_threshold_sec * 1000) {
    this._logger.error('daemon_disconnect_degraded', { runtime_id: rid, elapsed_sec: Math.round(elapsed/1000) });
    this._degradedWarned = true;
  }
  this._logger.warn('heartbeat_failed', { runtime_id: rid, cause: extractCause(e) }); // task-02
}
```

控制流：heartbeat 成功→清零；失败→记首次时间→超阈值且未告警→FATAL 一次→置 warned。恢复→清零+清 warned。

## 边界处理

1. **恢复后清零**：成功即 `_heartbeatFailSince=null` + `_degradedWarned=false`，下次断连重新计时告警。
2. **多 runtime 计数独立**：当前 _heartbeatLoop 遍历 `_registeredRuntimes.values()`，多个 rid 共享一个计数器会串扰。**改为按 rid 维护**：`_heartbeatFailSince: Map<string, number>` + `_degradedWarned: Set<string>`，每 rid 独立。
3. **不调 offline 端点**（D-006）：明确禁止 `markOffline` 调用，backend 45s 自然判 offline。
4. **与 task-04 _fire 自愈关系**：_fire 自愈重启 _heartbeatLoop，重启后计数器保留（类成员，非 loop 局部），不重置（避免重启就清零误判健康）。
5. **阈值配置校验**：config normalize 时 `disconnect_log_threshold_sec` 非法/<=0 → 回填默认 30 + warn。
6. **FATAL 只一次**：`_degradedWarned` 防日志风暴，持续断连不反复刷。
7. **不修改 backend**（D-003）：runtime.status 自由 String，backend 无需感知 degraded 值（daemon 不上报）。

## 非目标

- 不调 offline 端点上报 degraded（D-006）。
- 不改 backend（D-003）。
- 不改 WS 重连（ws-client 5s 固定）。
- 不做前端健康展示（另一变更）。
- 不改 _fire 自愈逻辑（task-04）。

## 参考

- daemon.ts:1440-1458（_heartbeatLoop）
- config.ts:90-210（DaemonConfig + DEFAULT_CONFIG + normalize）
- backend runtime/service.py:23（DEFAULT_RUNTIME_STALE_SECONDS=45，backend 侧自然 offline）
- decisions.md D-003@v1 / D-006@v1
- design.md §5 Phase1 断连感知

## TDD 步骤

1. 写测试：mock heartbeat 连续失败，vitest fake timers 推进 30s+ → 断言 `daemon_disconnect_degraded` FATAL 记一次（非多次）；mock 成功 → 计数清零 + 下次断连可再告警。多 rid 独立。
2. 确认失败（当前无计数）。
3. 实现计数 + config 项。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归现有 daemon 测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | config 加 disconnect_log_threshold_sec | DEFAULT_CONFIG 含默认 30 |
| AC-02 | 断连超阈值记 FATAL 一次 | 测试：失败 30s+ → daemon_disconnect_degraded 记 1 次 |
| AC-03 | 持续断连不风暴 | 测试：失败 60s → FATAL 仍 1 次（_degradedWarned） |
| AC-04 | 恢复清零 | 测试：成功后 _heartbeatFailSince 清空 + warned 清 |
| AC-05 | 多 rid 独立 | 测试：rid A 断 rid B 正常 → 仅 A 告警 |
| AC-06 | 不调 offline 端点 | grep 确认无 markOffline 调用 |
| AC-07 | 现有测试全绿 | `cd sillyhub-daemon && pnpm test` 通过 |
