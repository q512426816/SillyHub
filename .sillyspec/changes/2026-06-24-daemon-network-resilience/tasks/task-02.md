---
id: task-02
title: daemon.ts 两处 warn（onTurnMessage/heartbeat）展开 cause
priority: P0
wave: W1
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-02: daemon.ts 两处 warn 展开 cause

> 来源：design.md §5 Phase1；plan.md Wave1 task-02。依赖 task-01 的 `extractCause`。
> 本质：`daemon.ts:1294`（onTurnMessage catch）与 `:1449`（_heartbeatLoop heartbeat catch）的 warn，error 字段从直接放 `e` 改为展开 `{ message, cause: extractCause(e) }`，让 fetch failed 日志暴露底层 code。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/daemon.ts` | 1294 + 1449 两处 warn error 字段改用 extractCause |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-01 | 日志暴露底层 cause code | 两处 warn 展开 extractCause(e) |

## 实现要求

1. **import extractCause**：daemon.ts 顶部从 `./hub-client.js` 导入 `extractCause`（task-01 导出）。
2. **onTurnMessage catch（1293-1300）**：
   ```ts
   // 修改前
   } catch (e) {
     this._logger.warn('on_turn_message_submit_failed', {
       session_id: sessionId, lease_id: state.leaseId, run_id: runId, error: e,
     });
   }
   // 修改后
   } catch (e) {
     this._logger.warn('on_turn_message_submit_failed', {
       session_id: sessionId, lease_id: state.leaseId, run_id: runId,
       message: (e as Error)?.message ?? String(e),
       cause: extractCause(e),
     });
   }
   ```
3. **_heartbeatLoop heartbeat catch（1447-1450）**：同构，`error: e` → `message + cause: extractCause(e)`，保留 runtime_id 字段。
4. **保持 warn 不抛**：catch 仍只 warn 不向上抛（onTurnMessage 边界，不阻塞 turn；heartbeat 单 rid 失败不影响其他）。

## 接口定义

无新接口。复用 `extractCause(err): CauseInfo`（task-01）。日志字段从 `error: e` 扁平化为 `message: string` + `cause: {message, code?, status?}`。

控制流：catch e → `extractCause(e)` → warn({ ..., message, cause })。

## 边界处理

1. **e 不是 Error**（如 reject 了非 Error 值）：`(e as Error)?.message ?? String(e)` 兜底，extractCause 内部也兜底，不抛。
2. **HubHttpError（4xx/5xx）**：extractCause 返回 status，cause.code 缺失（业务错误无 undici code），日志显示 status 便于区分"网络层"vs"backend 业务拒绝"。
3. **AbortError/TimeoutError**：extractCause code='TimeoutError'/'AbortError'，区分主动停止 vs 超时。
4. **不改变 catch 语义**：仍 warn 不抛；onTurnMessage 丢弃该条 message（重试/暂存在 task-08/17，本 task 只改日志）。
5. **参数不可变**：extractCause 只读。
6. **日志字段命名稳定**：`message` + `cause`，供运维 grep `cause.code` 定位。

## 非目标

- 不加重试/暂存（task-08/17）。
- 不改其他 warn（仅这两处涉及网络错误；interactive_spec_sync_failed 等已有 message 字段）。
- 不改 _logger 实现。
- 不处理 onSessionEnd notify 失败的 warn（task-12 终态重试时一并）。

## 参考

- daemon.ts:1287-1300（onTurnMessage → submitMessages + catch）
- daemon.ts:1440-1458（_heartbeatLoop → heartbeat + catch）
- task-01 extractCause
- design.md §5 Phase1

## TDD 步骤

1. 写测试：spy _logger.warn，mock submitMessages reject TypeError({cause:{code:'ECONNREFUSED'}}) → 断言 warn 调用参数含 `cause.code==='ECONNREFUSED'`；mock heartbeat reject → 同理。
2. 确认失败（当前 error: e 不展开）。
3. 实现两处 warn 改造 + import。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归现有 daemon 测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 两处 warn 展开 cause | grep -n "cause: extractCause" daemon.ts 命中 2 处（1294/1449 附近） |
| AC-02 | import extractCause | daemon.ts 顶部从 hub-client.js 导入 extractCause |
| AC-03 | 网络错误日志含 code | 测试：submit reject TypeError cause code=ECONNREFUSED → warn cause.code==='ECONNREFUSED' |
| AC-04 | 业务错误日志含 status | 测试：HubHttpError 503 → warn cause.status===503 |
| AC-05 | catch 仍不抛 | submit reject 不影响 turn 继续 / heartbeat 继续循环 |
| AC-06 | 现有测试全绿 | `cd sillyhub-daemon && pnpm test` 通过 |
| AC-07 | typecheck 通过 | `pnpm typecheck` 通过 |
