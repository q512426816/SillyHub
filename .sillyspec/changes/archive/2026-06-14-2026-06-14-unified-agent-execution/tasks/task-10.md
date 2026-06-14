---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-10
title: B2 超时可配（优先级链）+ B3 spawn 级失败自动重试
priority: P1
depends_on: [task-05]
blocks: [task-12]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/__tests__/task-runner-timeout.test.ts
  - sillyhub-daemon/src/__tests__/task-runner-retry.test.ts
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/service.py
---

# task-10: B2 超时可配（优先级链）+ B3 spawn 级失败自动重试

## 修改文件

- `sillyhub-daemon/src/task-runner.ts`（改 L483-494 看门狗 + L354-362 终态汇总 + 新增重试外层包装）—— B2 优先级链 + B3 重试编排。
- `sillyhub-daemon/src/config.ts`（改 DaemonConfig 接口 L64-78 + DEFAULT_CONFIG L101-113）—— 新增 `default_timeout_seconds` / `max_retries` 默认字段。
- `sillyhub-daemon/src/types.ts`（改 LeaseCtx L205-244 + 新增重试 metadata 类型）—— `timeout_seconds` 显式字段（与现有 `timeout` 共存或替换）+ 重试次数 metadata 字段。
- `sillyhub-daemon/src/__tests__/task-runner-timeout.test.ts`（新建）—— B2 优先级链测试。
- `sillyhub-daemon/src/__tests__/task-runner-retry.test.ts`（新建）—— B3 重试编排测试。
- `backend/app/modules/agent/placement.py`（改 `dispatch_to_daemon` L124-191）—— 新增可选 `timeout_seconds` 入参写 lease.metadata。
- `backend/app/modules/daemon/service.py`（改 `_build_claim_payload` L304-358）—— 从 lease.metadata 透传 `timeout_seconds` 到 claim payload。

> **现状核实**：
> - task-runner.ts:483-494 看门狗用 `ctx.timeout ?? 0`（types.ts:235 `timeout?: number` 已存在），但 `_build_claim_payload`（daemon/service.py:304-358）**不写 timeout** → ctx.timeout 恒 undefined → 恒为 0（不限）。本任务补透传链路。
> - task-runner.ts:354-362 终态汇总无重试逻辑，spawn 失败直接 `_finish('failed')`。
> - DaemonConfig（config.ts:64-78）当前无 timeout/retries 字段。

## 实现要求

### B2 超时可配

1. **优先级链**（从高到低）：
   - `lease.metadata.timeout_seconds`（dispatch_to_daemon 新增入参 → lease.metadata → _build_claim_payload → LeaseCtx.timeout）
   - daemon config `default_timeout_seconds`（新增 DaemonConfig 字段，默认 1800 秒 = 30 分钟）
   - 默认值 1800（兜底，若 config 也未配）

2. **task-runner.ts:485 改动**：当前 `const timeoutSec = ctx.timeout ?? 0;`（恒 0 = 不限）。改为接收已解析的 timeout（优先级解析放在 daemon.ts `_runLeaseStateMachine` 构造 LeaseCtx 时，或 task-runner.ts 入口解析；**推荐 task-runner.ts 入口解析**，便于单测）：

   ```typescript
   const timeoutSec = resolveTimeout(ctx, this._config); // 优先级链
   ```

   `resolveTimeout` 实现：
   ```typescript
   function resolveTimeout(ctx: LeaseCtx, config?: DaemonConfig): number {
     // 1. lease.metadata.timeout_seconds（ctx.timeoutSeconds）
     if (typeof ctx.timeoutSeconds === 'number' && ctx.timeoutSeconds > 0) return ctx.timeoutSeconds;
     // 2. daemon config default_timeout_seconds
     const cfg = config?.default_timeout_seconds;
     if (typeof cfg === 'number' && cfg > 0) return cfg;
     // 3. 兜底默认（1800 秒）
     return 1800;
   }
   ```

   **0 = 不限**语义保留：若上层显式传 `timeout_seconds=0` → resolveTimeout 第 1 步的 `> 0` 判断会跳过，走 config / 兜底。如需「显式不限」语义，约定传 `-1`（负数）→ resolveTimeout 检测 `< 0` 返回 0（不限）。

3. **placement.py dispatch_to_daemon 改动**（L124-191）：新增可选 `timeout_seconds: int | None = None`，写入 `lease.metadata['timeout_seconds']`：
   ```python
   if timeout_seconds is not None:
       metadata["timeout_seconds"] = timeout_seconds
   ```

4. **daemon/service.py `_build_claim_payload` 改动**（L344-351 段，lease_meta 读取处）：新增：
   ```python
   if lease_meta.get("timeout_seconds") is not None:
       payload["timeout_seconds"] = lease_meta["timeout_seconds"]
   ```

5. **types.ts LeaseCtx 改动**：新增 `timeoutSeconds?: number`（snake → camel 转换在 daemon.ts:629-647 构造 ctx 时处理；或保留 `timeout?: number` 兼容现有，新增 `timeoutSeconds` 二选一——**推荐**：`timeoutSeconds` 替换 `timeout`，daemon.ts 构造处同步改，保留 `timeout` 为 deprecated alias 兼容一个 release 周期）。

6. **超时触发信号**：保持现状 SIGTERM → 2s SIGKILL（task-runner.ts:487-494），不改优雅升级逻辑。

### B3 spawn 级失败重试

7. **重试编排**：在 task-runner.ts `runLease` 内包装 spawn 段（步骤 6-7），加 retry 循环：

   ```typescript
   const maxRetries = resolveMaxRetries(this._config); // 默认 1
   let attempt = 0;
   let lastResult: TaskRunnerResult | null = null;
   while (attempt <= maxRetries) {
     const r = await this._spawnAndStream({...}); // 现有步骤 6-7
     const shouldRetry = isSpawnLevelFailure(r) && attempt < maxRetries;
     if (!shouldRetry) { lastResult = packResult(r, attempt); break; }
     attempt++;
     await this._cleanupWorkspaceForRetry(workDir); // 清残留
     // 重试不传 resume_session_id（清空 ctx.resumeSessionId）
     ctx = { ...ctx, resumeSessionId: undefined };
   }
   ```

8. **isSpawnLevelFailure 判定**（仅以下情况重试，其他不重试）：
   - `r.status === 'timeout'`（超时）
   - `r.status === 'failed' && r.exitCode !== 0 && r.error 含 'spawn ENOENT'`（spawn 启动失败）
   - `r.status === 'failed' && r.exitCode !== 0 && 非 claude 业务报错`（如 OOM / 段错误，stderr 含 'segfault'/'oom'/'killed'）
   - **不重试**：`r.status === 'cancelled'`（用户 cancel）、claude 业务 `is_error=true`（task-runner.ts:354 `success` 判定含 is_error）、exitCode === 0 的 completed。

   实现要点：claude result 事件的 `is_error`（stream-json.ts:317 `lastResultInfo.isError`）必须区分于 spawn 级失败。**推荐**：在 `_spawnAndStream` 返回值新增 `businessError?: boolean` 字段（claude 主动报错时置 true），retry 判定优先看此字段。

9. **重试前清 workspace 残留**：新增 `_cleanupWorkspaceForRetry(workDir)`，删 workDir 下 claude 已生成的文件（git checkout -- . + git clean -fd，或直接 rm -rf workDir 重新 prepareWorkspace）。**推荐 rm -rf + 重新 prepareWorkspace**（最干净，避免 git 状态污染）。

10. **重试不传 resume_session_id**：retry 循环内清空 `ctx.resumeSessionId = undefined`，确保新 session（避免重复 side-effect，R-10 核心）。

11. **重试次数记 metadata**：`_finish` 的 `metadata`（task-runner.ts:808）新增 `retry_count` 字段，写入 complete_lease result（daemon.ts:663 段同步透传），后端可记录排查。

12. **业务 is_error 不重试**：claude 主动报错（`is_error=true`）→ `businessError=true` → isSpawnLevelFailure 返回 false → 直接 _finish failed，不重试。

13. **重试仍失败才标 failed**：maxRetries 用尽 → lastResult.status = failed，正常走 _finish failed 路径。

## 接口定义

```typescript
// sillyhub-daemon/src/config.ts（DaemonConfig 接口新增字段）
export interface DaemonConfig {
  // ... 现有字段 ...
  /** 单任务默认超时秒数（lease.metadata.timeout_seconds 未指定时用），默认 1800。 */
  default_timeout_seconds: number;
  /** spawn 级失败最大重试次数，默认 1（业务 is_error 不重试）。 */
  max_retries: number;
}

// DEFAULT_CONFIG 新增：
//   default_timeout_seconds: 1800,
//   max_retries: 1,

// sillyhub-daemon/src/types.ts（LeaseCtx 新增字段）
export interface LeaseCtx {
  // ... 现有字段 ...
  /** 执行超时秒数（lease.metadata 透传，优先级最高）。0=不限，-1=显式不限。 */
  timeoutSeconds?: number;
}

// sillyhub-daemon/src/task-runner.ts（新增工具函数）
export function resolveTimeout(ctx: LeaseCtx, config?: DaemonConfig): number;
export function resolveMaxRetries(config?: DaemonConfig): number;
export function isSpawnLevelFailure(
  r: { status: string; exitCode: number; error?: string; businessError?: boolean },
): boolean;

// _spawnAndStream 返回值新增 businessError 字段
interface SpawnResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  exitCode: number;
  error?: string;
  /** claude 业务报错（is_error=true）置 true，区分 spawn 级失败。 */
  businessError?: boolean;
}
```

```python
# backend/app/modules/agent/placement.py（dispatch_to_daemon 签名扩展）
async def dispatch_to_daemon(
    self,
    agent_run_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    provider: str | None = None,
    prompt: str | None = None,
    resume_session_id: str | None = None,
    timeout_seconds: int | None = None,  # 新增
) -> uuid.UUID | None:
    # ...
    if timeout_seconds is not None:
        metadata["timeout_seconds"] = timeout_seconds
    # ...

# backend/app/modules/daemon/service.py（_build_claim_payload 透传）
# 在 lease_meta.get("resume_session_id") 段后新增：
if lease_meta.get("timeout_seconds") is not None:
    payload["timeout_seconds"] = lease_meta["timeout_seconds"]
```

## 边界处理

1. **null/空值（timeout 未配）**：`lease.metadata.timeout_seconds` 不存在 + `config.default_timeout_seconds` 也未配 → resolveTimeout 兜底返回 1800（30 分钟），不返回 0（避免无限执行挂死 daemon）。

2. **timeout 显式不限语义**：上层传 `timeout_seconds=0` → resolveTimeout `> 0` 判断跳过 → 走 config/兜底。**约定**：传 `-1` 表示显式不限，resolveTimeout 检测 `< 0` 返回 0（spawn 看门狗不启动，task-runner.ts:486 `if (timeoutSec > 0)` 不进入）。文档化此约定。

3. **重试 workspace 残留清理失败**：`_cleanupWorkspaceForRetry` 失败（rm -rf EACCES / git 状态污染）→ 不阻塞重试，log warn 后继续 retry 循环（最坏情况重试在新 session 但带旧文件，side-effect 风险由「不传 resume_session_id」+ claude 自身幂等性兜底）。

4. **重试上限保护**：`max_retries` 上限硬编码 ≤ 3（防止 config 误配大值导致无限重试拖垮 daemon）；resolveMaxRetries 检测 `> 3` 截断为 3，log warn。

5. **业务 is_error vs spawn 级失败歧义**：claude 退出码非 0 但非 OOM/段错误（如 claude 自身逻辑错误返回非 0）→ 归为业务失败，不重试。`isSpawnLevelFailure` 用 stderr 关键字（'segfault'/'oom'/'killed'/'ENOENT'）+ `businessError` 字段双重判定，**保守不重试**（宁可漏重试不可重复 side-effect）。

6. **用户 cancel 不重试**：`r.status === 'cancelled'`（AbortSignal 触发）→ 不重试，直接 _finish cancelled（task-runner.ts:579-581 已有此分支，retry 循环尊重之）。

7. **重试不传 resume_session_id（R-10 核心）**：retry 循环内 `ctx.resumeSessionId = undefined`（task-runner.ts:318 `resumeSessionId: ctx.resumeSessionId` 会拿到 undefined，stream-json.ts:115 `if (opts?.resumeSessionId)` 不追加 `--resume`，新 session）。

8. **重试次数记 metadata**：`_finish` 的 metadata（task-runner.ts:808）新增 `retry_count`，daemon.ts:663 complete_lease result 透传（后端 AgentRun 无对应字段则忽略，仅 lease.metadata 存档）。后端可不消费（YAGNI），但 daemon 侧必须记录供排查。

9. **超时与重试交互**：超时触发 SIGTERM → `r.status='timeout'` → isSpawnLevelFailure 返回 true → 重试。重试后仍超时 → 用尽 max_retries → _finish timeout（task-runner.ts:582-584）。

10. **参数不可变**：resolveTimeout / resolveMaxRetries / isSpawnLevelFailure 纯函数，不修改入参；retry 循环内 `ctx = { ...ctx, resumeSessionId: undefined }` 用展开拷贝（不修改原 ctx）。

## 非目标

- 不做超时分级（如 idle timeout vs wall clock）—— 单一 wall clock 超时。
- 不实现 design B6 heartbeat 执行中/空闲分档（P2，独立 change）。
- 不实现 design B4 workspace 复用/缓存（P2，与重试清理策略冲突，独立 change）。
- 不做重试指数退避（默认重试 1 次，立即重试）。
- 不实现 retry 次数动态调整（按 lease.metadata 或 config，硬上限 3）。
- 不改 `_killChild` 优雅升级逻辑（SIGTERM → 2s → SIGKILL 已正确）。

## TDD 步骤

1. 写测试 → `task-runner-timeout.test.ts`（B2 优先级链 3 条）+ `task-runner-retry.test.ts`（B3 重试编排 5+ 条）。
2. 确认失败 → 跑两文件，全红（config 无新字段、task-runner 无重试）。
3. 写实现 → config.ts 加字段 + types.ts 加 timeoutSeconds + task-runner.ts 加 resolveTimeout / isSpawnLevelFailure / retry 循环 + placement.py / daemon/service.py 透传。
4. 确认通过 → 全绿。
5. 回归 → `cd sillyhub-daemon && pnpm test` + `cd backend && uv run pytest -q` 全量。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `grep -n "default_timeout_seconds\|max_retries" sillyhub-daemon/src/config.ts` | DaemonConfig 接口 + DEFAULT_CONFIG 均含两字段 |
| AC-02 | `grep -n "resolveTimeout\|isSpawnLevelFailure\|retry" sillyhub-daemon/src/task-runner.ts` | 命中（task-runner 已集成优先级链 + 重试编排） |
| AC-03 | `grep -n "timeout_seconds" backend/app/modules/agent/placement.py backend/app/modules/daemon/service.py` | 两文件均命中（dispatch 新增入参 + _build_claim_payload 透传） |
| AC-04 | `cd sillyhub-daemon && pnpm vitest run src/__tests__/task-runner-timeout.test.ts` | 全部通过（≥3 条：lease.metadata 优先 / config 兜底 / 默认值） |
| AC-05 | `cd sillyhub-daemon && pnpm vitest run src/__tests__/task-runner-retry.test.ts` | 全部通过（≥5 条：spawn 失败重试 / 业务 is_error 不重试 / cancel 不重试 / 重试不传 resume_session_id / 重试用尽标 failed） |
| AC-06 | 测试断言：ctx.timeoutSeconds=10 → spawn 看门狗 setTimeout 10 秒触发 SIGTERM | 断言通过（优先级链 lease.metadata 最高） |
| AC-07 | 测试断言：spawn ENOENT 失败 → 自动重试 1 次 → 仍失败 → _finish failed + metadata.retry_count=1 | 断言通过 |
| AC-08 | 测试断言：claude result is_error=true → businessError=true → 不重试，直接 _finish failed | 断言通过（业务错误不重试） |
| AC-09 | 测试断言：重试循环内 ctx.resumeSessionId 被清空（stream-json.buildArgs 不追加 `--resume`） | 断言通过（R-10 side-effect 不重复） |
| AC-10 | 测试断言：max_retries 配置为 10 → resolveMaxRetries 截断为 3，log warn | 断言通过（硬上限保护） |
| AC-11 | `cd backend && uv run pytest -q tests/test_daemon_service.py -k timeout` | 后端测试通过（_build_claim_payload 透传 timeout_seconds） |
