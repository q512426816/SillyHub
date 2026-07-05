---
id: task-06
title: daemon.ts _startInteractiveSession tar 模式 pullSpecBundle + onSessionEnd tar 模式 postSpecSync（X-001 核心改动点）（覆盖：FR-05, FR-06, D-003@v1, D-004@v1, D-007@v1）
priority: P0
estimated_hours: 3
depends_on: [task-04]
blocks: [task-09, task-11]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-003@v1, D-004@v1, D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-06：daemon.ts interactive 路径接入 spec-sync（tar 模式 pull + sync）

## 1. 目标与范围

在 `sillyhub-daemon/src/daemon.ts` 的 **interactive lease 执行路径**接入 task-04 抽出的
`spec-sync.ts` 共享 utility，实现 tar 模式 spec 文档的双向同步（D-003@v1）：

- **pull（backend → daemon 缓存）**：`_startInteractiveSession`（`daemon.ts:1711`）在 session
  创建后、SessionManager.create（driver 启动）**之前**，当 `execPayload.transport === 'tar'`
  时同步 `await pullSpecBundle(this._client, wsId)`，把 backend spec bundle 解到本地
  `~/.sillyhub/daemon/specs/{ws}` 缓存。`wsId` 从 `execPayload.workspaceId` 取。
- **sync（daemon → backend 回传）**：`onSessionEnd`（`daemon.ts:1164`，session 终态回调）在
  上报 `notifySessionEnd` 之后，当 tar 模式时调 `postSpecSync(this._client, wsId,
  resolveSpecDir(wsId))` 整树回传（一次性，D-004）。

**本任务只改 `daemon.ts`**。`spec-sync.ts` 的 4 个函数（task-04）、`types.ts` 的
`transport`/`workspaceId` 字段、`build_claim_payload` 的透传（task-03）均不在本任务范围。

**核心铁律（R-03 容错 + R-07 时序）**：
- pull 失败（404 已被 utility 容错为空目录，5xx/网络透传）**不阻塞 session 启动**——
  catch 后 warn 继续 create。
- sync 失败**仅 warn 不阻塞 session 终态上报**（对齐 batch `task-runner.ts:488-490`，R-03）。
- pull 必须 driver 启动前 `await` 完成（否则 agent 跑起来读不到缓存）；sync 必须在 session
  真正结束（终态回调内）后触发（R-07）。

## 2. 覆盖来源

| 来源 | 章节 | 关联点 |
|---|---|---|
| design.md §5.0 | X-001 修正：spec 同步在 interactive 路径（`_startInteractiveSession` pull + `onSessionEnd` sync） | 本任务存在的根因 |
| design.md §5.2 | tar 模式 5 步流程（② pull @ session 开始 / ④ sync @ session end） | 两处接入点的时序语义 |
| design.md §7.3 | daemon 侧改动「`daemon.ts` interactive 接入（X-001 核心改动点）」 | 接入伪代码 + 字段读取来源 |
| design.md §7.4 | 生命周期契约表（pull spec bundle / post spec sync 两事件） | 必需字段 + 状态变化 |
| design.md §10 R-03 | postSpecSync 失败仅 warn 不阻塞 session 终态上报 | sync 容错语义 |
| design.md §10 R-07 | pull/sync 与 SessionManager 生命周期时序 | 时序铁律 |
| decisions.md D-003@v1 | tar 模式双向同步（回传 + 按需拉取） | pull + sync 两个方向 |
| decisions.md D-004@v1 | shared 模式保持现状（不 pull 不 sync） | transport !== 'tar' 跳过分支 |
| decisions.md D-007@v1 | scan/stage 走 interactive，spec 同步在 interactive 路径 | 本任务是实现位置依据 |
| plan.md task-06 行 | `_startInteractiveSession` tar pull + `onSessionEnd` tar sync | 任务边界 |
| task-04.md §4.3/4.5 | `pullSpecBundle`/`postSpecSync` 函数签名（client 注入 + 返回值） | 调用契约 |

## 3. 修改文件

| 文件 | 改动 |
|---|---|
| `sillyhub-daemon/src/daemon.ts` | (1) import `pullSpecBundle`/`postSpecSync`/`resolveSpecDir` from `./spec-sync`；(2) `_startInteractiveSession` session 创建后、`_sessionManager.create` 前 tar 模式 await pull；(3) `onSessionEnd` 终态通知后 tar 模式调 sync；(4) 从 `execPayload`/session 上下文读 `transport`/`workspaceId` |

> **types.ts 字段依赖**：`LeaseCtx` 需有 `transport?: string` 与 `workspaceId?: string` 字段
>（task-03 透传 + types 定义）。本任务**只读**这两个字段，不改 types.ts。若 task-03/类型定义
> 任务尚未加字段，本任务实现时需确认 `execPayload.transport`/`execPayload.workspaceId`
> 可访问（camelCase），并兼容 snake_case 兜底（`transport_mode`/`workspace_id`），与
> `_runLeaseStateMachine` 行 1939-2014 的归一化风格一致。

## 4. 接口定义

### 4.1 import（daemon.ts 顶部 import 区）

```typescript
import { pullSpecBundle, postSpecSync, resolveSpecDir } from './spec-sync';
```

> `spec-sync.ts` 由 task-04 新增。`pullSpecBundle`/`postSpecSync` 首参为 `HubClient`（task-04
> §4.3/4.5）。daemon 持有的 `this._client`（`daemon.ts:402`，类型 `ClientLike`）须能传给
> utility——`ClientLike` 是 daemon 内部鸭子类型接口（`daemon.ts:182`），需确认其包含
> `getSpecBundle`/`postSpecSync` 方法签名；若 `ClientLike` 未声明这两个方法，本任务在
> `ClientLike` interface 内**补充方法签名**（仅类型声明，属 daemon.ts 同文件改动，不越
> allowed_paths），或调用处用类型断言 `as never`/最小接口。优先补 `ClientLike` 签名
>（与 `hub-client.ts:694/737` 实现对齐）。

### 4.2 transport / workspaceId 读取（从 execPayload）

`_startInteractiveSession` 入参 `execPayload: LeasePayload`（`daemon.ts:1713`），LeasePayload
= LeaseCtx（`types.ts:290`）。读取方式（camelCase 优先 + snake_case 兜底，对齐
`_runLeaseStateMachine` 行 1941-2013 归一化惯例）：

```typescript
// _startInteractiveSession 内，session 创建后、create 前
const transport =
  execPayload.transport ??
  (execPayload as { transport_mode?: string }).transport_mode ??
  'shared';
const workspaceId =
  execPayload.workspaceId ??
  (execPayload as { workspace_id?: string }).workspace_id;

if (transport === 'tar' && workspaceId) {
  // tar 模式：driver 启动前同步拉 backend spec 缓存（R-07 时序）
  try {
    const specDir = await pullSpecBundle(this._client as never, workspaceId);
    this._logger.info('interactive_spec_pulled', {
      lease_id: leaseId,
      workspace_id: workspaceId,
      spec_dir: specDir,
    });
  } catch (e) {
    // R-03 容错：pull 失败（5xx/网络，404 已被 utility 容错）不阻塞 session 启动。
    // agent 仍可跑（读不到缓存则 sillyspec 生成新文档），后续 sync 仍会回传。
    this._logger.warn('interactive_spec_pull_failed', {
      lease_id: leaseId,
      workspace_id: workspaceId,
      error: (e as Error)?.message ?? String(e),
    });
  }
}
// transport !== 'tar'（shared）→ 跳过，bind mount 共享现状不变（D-004）
// workspaceId 缺失 → 跳过 pull + warn（边界 4）
```

**接入位置**：`_startInteractiveSession`（`daemon.ts:1711`）内，**在
`this._interactiveSessionsByLease.set(leaseId, sessionId)`（行 1831）之后、
`await this._sessionManager.create({...})`（行 1834）之前**。

理由（R-07 时序）：
- 必须在 `set` 之后：保证 pull 失败/成功都不影响 AC-09 去重登记（WS 重放不重试）。
- 必须在 `create` 之前：driver（ClaudeSdkDriver）一旦 spawn 即开始跑 sillyspec scan/stage，
  读 `--spec-root` 指向的本地缓存目录——pull 须先完成才有内容可读。

### 4.3 onSessionEnd 接入 postSpecSync

`onSessionEnd`（`daemon.ts:1164`）当前只调 `notifySessionEnd`。tar 模式需在其后调
`postSpecSync`。问题：`onSessionEnd(sessionId, status)` 入参**没有 leaseId/workspaceId/
transport**，需从 session 状态反查。

**反查路径**：`this._sessionManager.get(sessionId)` 返回 `SessionState`（含 `leaseId`，
见 `daemon.ts:967/1083/1491/1654` 现有用法）。拿到 leaseId 后从
`_interactiveSessionsByLease` 反查不到 transport/workspaceId（该 map 只存
leaseId→sessionId），因此**需新增一个 lease→specSyncContext 的 map**，或在 session 创建时
把 transport/workspaceId 存入 SessionState。

**推荐方案（最小侵入）**：新增 `private readonly _interactiveSpecSyncCtx = new Map<string,
{ workspaceId: string }>()`，在 `_startInteractiveSession` pull 成功/tar 模式时
`set(leaseId, { workspaceId })`；`onSessionEnd` 通过 sessionId → sessionManager.get →
leaseId → 该 map 取 workspaceId。session 结束后 `delete`。

```typescript
// daemon.ts 类成员区（与 _interactiveSessionsByLease 同区，行 431 附近）
private readonly _interactiveSpecSyncCtx = new Map<string, { workspaceId: string }>();

// _startInteractiveSession 内 pull 分支成功后（4.2 代码块末尾）：
this._interactiveSpecSyncCtx.set(leaseId, { workspaceId });

// onSessionEnd（行 1164）改写：
async onSessionEnd(sessionId: string, status: SessionStatus): Promise<void> {
  const mappedStatus: 'ended' | 'failed' =
    status === 'failed' ? 'failed' : 'ended';
  const reason = mappedStatus === 'failed' ? 'driver_error' : 'manual';

  // 1. 终态通知（现有逻辑，保持顺序：先上报终态，再 spec 回传）
  try {
    await this._client.notifySessionEnd(sessionId, mappedStatus, reason);
  } catch (e) {
    this._logger.warn('on_session_end_notify_failed', {
      session_id: sessionId,
      status: mappedStatus,
      error: e,
    });
  }

  // 2. tar 模式 spec 整树回传（R-07：session 真正结束后触发）
  //    反查 leaseId → _interactiveSpecSyncCtx 取 workspaceId
  await this._postInteractiveSpecSync(sessionId);
}

// 新增私有方法
private async _postInteractiveSpecSync(sessionId: string): Promise<void> {
  if (!this._sessionManager) return;
  let leaseId: string | undefined;
  try {
    const state = this._sessionManager.get(sessionId);
    leaseId = state?.leaseId;
  } catch (e) {
    this._logger.warn('interactive_spec_sync_state_lookup_failed', {
      session_id: sessionId,
      error: (e as Error)?.message ?? String(e),
    });
    return;
  }
  if (!leaseId) return;
  const ctx = this._interactiveSpecSyncCtx.get(leaseId);
  if (!ctx) return; // 非 tar 模式 / pull 未登记 → 跳过（D-004 shared 现状）

  try {
    const resp = await postSpecSync(
      this._client as never,
      ctx.workspaceId,
      resolveSpecDir(ctx.workspaceId),
    );
    this._logger.info('interactive_spec_sync_ok', {
      session_id: sessionId,
      lease_id: leaseId,
      workspace_id: ctx.workspaceId,
      resp,
    });
  } catch (e) {
    // R-03 容错：sync 失败仅 warn，不阻塞、不改写 session 终态。
    //（notifySessionEnd 已上报，sync 失败 backend 标 sync_status=dirty 重试）
    this._logger.warn('interactive_spec_sync_failed', {
      session_id: sessionId,
      lease_id: leaseId,
      workspace_id: ctx.workspaceId,
      error: (e as Error)?.message ?? String(e),
    });
  } finally {
    this._interactiveSpecSyncCtx.delete(leaseId);
  }
}
```

**关键：sync 在 `notifySessionEnd` 之后**。理由（R-07）：
- session 须真正结束（driver 已退出、SessionManager 已 end/fail）后才回传，避免回传时
  sillyspec 还在写文件导致 tar 不完整。
- `onSessionEnd` 由 SessionManager 在 end/fail 时触发（`daemon.ts:1142-1150` 注释），此时
  session 已终态，sync 在通知后执行满足时序。
- 即便 notifySessionEnd 失败（warn），仍继续尝试 sync——sync 是尽力而为，失败也仅 warn。

### 4.4 错误处理总览（R-03 容错语义）

| 接入点 | 失败类型 | 处理 | 是否阻塞 |
|---|---|---|---|
| pull（`_startInteractiveSession`） | getSpecBundle 404 | utility 内已容错（mkdir 空目录返回路径） | 不阻塞 |
| pull | getSpecBundle 5xx/网络 | catch → warn `interactive_spec_pull_failed` | 不阻塞 session 启动 |
| pull | wsId 缺失 / transport 非 tar | 跳过（不进 pull 分支） | — |
| sync（`onSessionEnd`） | postSpecSync HTTP 非 2xx/网络 | catch → warn `interactive_spec_sync_failed` | 不阻塞（notifySessionEnd 已上报） |
| sync | sessionManager null / state 查不到 | return（跳过） | — |
| sync | leaseId 未登记 specSyncCtx | return（非 tar 模式） | — |
| 终态通知 | notifySessionEnd 抛错 | warn（现有逻辑不变） | 不阻塞后续 sync |

## 5. 边界处理（≥5）

| # | 边界场景 | 处理 | 来源 |
|---|---|---|---|
| 1 | **transport !== 'tar'（shared 模式，D-004）** | pull/sync 均跳过——`_startInteractiveSession` 不进 pull 分支、`_interactiveSpecSyncCtx` 不 set、`onSessionEnd` 的 `_postInteractiveSpecSync` 查不到 ctx return。bind mount 共享现状零改动 | D-004@v1 / design §5.1 |
| 2 | **pull 404（首次 scan backend 无 bundle，R-02）** | `pullSpecBundle` utility 内已容错（mkdir 空目录返回路径非 null，task-04 §4.3），daemon 侧无感知；pull 分支正常 set specSyncCtx，保证后续 sync 触发 | design §7.2 E-01 / §10 R-02 |
| 3 | **pull 5xx/网络失败** | `_startInteractiveSession` catch → warn `interactive_spec_pull_failed`，**不阻塞 session 启动**（R-03）；agent 仍跑，读不到缓存则生成新文档，sync 仍回传；**不 set specSyncCtx**（pull 失败则不触发 sync，避免回传空/残缺目录——可选：仍 set 让 sync 尝试，本任务取保守不 set） | design §10 R-03 |
| 4 | **sync 失败（postSpecSync 抛错）** | `onSessionEnd` catch → warn `interactive_spec_sync_failed`，**不阻塞 session 终态上报**（notifySessionEnd 已先行上报）；backend 侧 sync_status=dirty 由 UI 提示重试（design §10 R-03 应对） | design §10 R-03 / task-runner.ts:488-490 |
| 5 | **workspaceId 缺失（execPayload 无 workspaceId/workspace_id）** | `_startInteractiveSession` pull 分支条件 `transport === 'tar' && workspaceId` 不满足 → 跳过 pull + warn `interactive_spec_pull_no_workspace`（提示 task-03 透传链路异常）；不 set specSyncCtx | design §7.2 X-004 / task-03 |
| 6 | **pull 时序：须 driver 启动前 await 完成（R-07）** | pull 调用放在 `_interactiveSessionsByLease.set` 之后、`_sessionManager.create` 之前，且用 `await`（非 fire-and-forget）；driver spawn 前缓存已就绪 | design §10 R-07 |
| 7 | **sync 时序：须 session 真正结束后（R-07）** | sync 在 `onSessionEnd` 内、且在 `notifySessionEnd` 之后触发（session 已终态）；不放在 `_startInteractiveSession` 或 driver 运行中 | design §10 R-07 |
| 8 | **sessionManager null（AC-14 过渡期）** | `_startInteractiveSession` 行 1721 已 return（不进 pull）；`_postInteractiveSpecSync` 开头 `if (!this._sessionManager) return` | daemon.ts:1721 现有逻辑 |
| 9 | **onSessionEnd 重复触发（SessionManager 幂等）** | `_postInteractiveSpecSync` finally 内 `delete` specSyncCtx，二次进入查不到 ctx return（幂等） | daemon.ts:1148 幂等注释 |
| 10 | **leaseId 反查失败（sessionManager.get 抛错/state 无 leaseId）** | `_postInteractiveSpecSync` catch → warn `interactive_spec_sync_state_lookup_failed` return（不阻塞） | daemon.ts:967 现有 get 用法 |
| 11 | **`_client` 类型与 utility 期望的 HubClient 不完全匹配** | `ClientLike`（daemon.ts:182）补 `getSpecBundle`/`postSpecSync` 方法签名（同文件改动），或调用处 `as never` 断言；优先补签名 | task-04 §4.3 client 注入 |

## 6. 非目标

- **不改 `spec-sync.ts`**：utility 由 task-04 新增，本任务只调用（allowed_paths 只含 daemon.ts）。
- **不改 `task-runner.ts`**：batch 路径改调 utility 属 task-05（纯重构），interactive 与 batch
  相互独立。
- **不改 `hub-client.ts`**：`getSpecBundle`/`postSpecSync` 已存在（hub-client.ts:694/737），
  本任务只经 `_client` 调用。
- **不改 `translateSpecRoot`**：spec_root_map 翻译（daemon.ts:1741-1773）是 shared 模式的
  容器路径→宿主路径映射，tar 模式 prompt 直接用 daemon 本地路径（backend helper 输出
  `~/.sillyhub/daemon/specs/{ws}`），两者正交，不互改。
- **不改 batch task-runner 路径**：interactive 与 batch（`_runLeaseStateMachine` →
  TaskRunner.runLease）是 kind 分流后的两条独立路径（daemon.ts:2019-2023），本任务只动
  interactive 分支。
- **不做增量同步**：整树 tar 一次性回传（D-004），无 diff/增量逻辑。
- **不处理 transport 切换的数据迁移**：D-005 已定不做（数据可清）。

## 7. 参考

### 7.1 batch task-runner 步骤 8.5 容错语义（sync 失败不阻塞 agent 结果）

`sillyhub-daemon/src/task-runner.ts:476-491`（D-006@v1 spec 整树回传）：
```typescript
// 步骤 8.5：daemon-client spec 整树回传。仅当 specRoot 非空（即步骤 1.5 触发了 pull）时触发。
// 失败不阻塞 agent 结果（FR-05 + §5 E-02）：sync 失败仅 warn，_finish 仍按 agent 实际
// exitCode/status 汇总 TaskResult，绝不把 success=true 改写为 failed。
if (specRoot) {
  try {
    const tarBuf = await this._packSpecDir(specRoot);
    if (typeof this.client.postSpecSync === 'function') {
      const wsId = (ctx as { workspaceId?: string }).workspaceId!;
      const resp = await this.client.postSpecSync(wsId, tarBuf);
      console.info('task_runner: spec_sync_ok', leaseId, resp);
    }
  } catch (e) {
    console.warn('task_runner: spec_sync_failed', leaseId, e);
  }
}
```
**interactive 路径对齐**：sync 失败仅 warn、不改写 session 终态、不阻塞 notifySessionEnd
（已先行上报）。唯一差异：interactive 的"agent 结果"是 session 终态（ended/failed），由
SessionManager 决定，sync 失败不能反过来改终态。

### 7.2 daemon.ts 现有接入点

- `_startInteractiveSession`：`daemon.ts:1711-1871`（session 创建 + driver 启动）
- `onSessionEnd`：`daemon.ts:1164-1185`（session 终态回调，当前只 notifySessionEnd）
- `_interactiveSessionsByLease`：`daemon.ts:431`（leaseId → sessionId 去重 map，本任务新增
  并列的 `_interactiveSpecSyncCtx`）
- `_client`：`daemon.ts:402`（`ClientLike`，传给 utility 作 client 参数）
- `_sessionManager.get(sessionId)`：`daemon.ts:967/1083/1491/1654`（反查 SessionState.leaseId）
- `_runLeaseStateMachine` execPayload 归一化：`daemon.ts:1939-2014`（snake_case 兜底惯例）

### 7.3 spec-sync utility 契约（task-04）

- `pullSpecBundle(client, wsId, opts?): Promise<string | null>`：404 容错返回路径非 null；
  5xx/网络透传；无 wsId/existingSpecRoot/mock 未实现返回 null。
- `postSpecSync(client, wsId, specRoot): Promise<{ok, reparsed} | null>`：失败透传；mock 未
  实现返回 null。
- `resolveSpecDir(wsId): string`：`join(homedir(), '.sillyhub', 'daemon', 'specs', wsId)`。

## 8. TDD（测试先行，本任务测试代码属 task-09，但 daemon.ts 改动须可独立验证）

task-09 覆盖的 interactive 接入测试用例（daemon.ts 改动须满足）：

1. **tar 模式 pull 触发**：构造 `execPayload.transport='tar'` + `workspaceId='ws-1'`，调
   `_startInteractiveSession` → 断言 `pullSpecBundle` 被调（mock client.getSpecBundle）、
   调用在 `_sessionManager.create` 之前（时序断言：pull 的 await 先 resolve）。
2. **shared 模式不 pull**：`execPayload.transport='shared'`（或缺省）→ `pullSpecBundle` 未被调。
3. **pull 404 不阻塞**：mock getSpecBundle 抛 `{status:404}` → session 仍 create 成功（utility
   容错 mkdir，daemon 侧无感知）。
4. **pull 5xx 不阻塞 session 启动**：mock getSpecBundle 抛 `{status:500}` →
   `pullSpecBundle` 透传 → daemon catch warn → `_sessionManager.create` 仍被调。
5. **tar 模式 sync 触发**：tar 模式 session 跑通后调 `onSessionEnd` → 断言 `postSpecSync`
   被调、在 `notifySessionEnd` 之后（时序断言）。
6. **sync 失败不阻塞终态上报**：mock postSpecSync 抛错 → `notifySessionEnd` 仍被调（先于
   sync）、`onSessionEnd` 不抛错。
7. **shared 模式不 sync**：非 tar 模式 `onSessionEnd` → `postSpecSync` 未被调。
8. **workspaceId 缺失跳过 pull + warn**：`transport='tar'` 但无 workspaceId → pull 未调、
   log 含 `interactive_spec_pull_no_workspace`。
9. **onSessionEnd 幂等**：同一 sessionId 二次调 `onSessionEnd` → `postSpecSync` 只被调一次
  （specSyncCtx 已 delete）。
10. **sessionManager null**：未注入 SessionManager → pull/sync 均安全跳过不抛错。

> 本任务实现时**先写 daemon.ts 改动 + 上述测试的本地 smoke 验证**（mock SessionManager +
> client，可在 task-09 正式落地前用 `pnpm vitest` 临时跑），确认两处接入点时序与容错成立。
> task-09 负责把测试正式纳入 `sillyhub-daemon/tests/`。

## 9. 验收标准

| AC | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | `_startInteractiveSession` tar 模式（`transport==='tar' && workspaceId`）在 session 创建后、`_sessionManager.create` 前 `await pullSpecBundle` | 代码审查 + task-09 测试 #1（时序断言 pull 先 resolve） |
| AC-2 | shared 模式（`transport!=='tar'` 或缺省）不触发 pull | task-09 测试 #2 |
| AC-3 | pull 404 不阻塞 session 启动（utility 容错，daemon 侧 pull 分支正常返回） | task-09 测试 #3 |
| AC-4 | pull 5xx/网络失败 catch 后 warn，`_sessionManager.create` 仍被调（R-03 不阻塞 session 启动） | task-09 测试 #4 |
| AC-5 | `onSessionEnd` tar 模式在 `notifySessionEnd` 之后调 `postSpecSync`（R-07 时序） | task-09 测试 #5（时序断言） |
| AC-6 | sync 失败仅 warn，不阻塞、不改写 session 终态（notifySessionEnd 已先行上报）（R-03） | task-09 测试 #6 |
| AC-7 | shared 模式 `onSessionEnd` 不调 `postSpecSync`（D-004 现状不变） | task-09 测试 #7 |
| AC-8 | workspaceId 缺失跳过 pull + warn（task-03 透传链路守护） | task-09 测试 #8 |
| AC-9 | `onSessionEnd` 幂等（specSyncCtx delete，二次进入不重复 sync） | task-09 测试 #9 |
| AC-10 | sessionManager null 时 pull/sync 安全跳过不抛错（AC-14 过渡期） | task-09 测试 #10 |
| AC-11 | transport/workspaceId 从 execPayload 读，camelCase 优先 + snake_case 兜底（与 `_runLeaseStateMachine` 归一化风格一致） | 代码审查 |
| AC-12 | 新增 `_interactiveSpecSyncCtx` map，pull 登记 / sync 消费 / finally delete 生命周期完整 | 代码审查 |
| AC-13 | `ClientLike` 含 `getSpecBundle`/`postSpecSync` 签名（或调用处类型断言），tsc 通过 | `cd sillyhub-daemon && pnpm tsc --noEmit` |
| AC-14 | `git diff --name-only` 只含 `sillyhub-daemon/src/daemon.ts`（含 ClientLike 同文件签名补充） | git diff |
| AC-15 | D-003@v1 双向同步：pull（session 开始）+ sync（session end）两接入点齐全 | 代码审查 + design §7.4 契约映射 |
| AC-16 | D-004@v1 shared 现状不变：transport 非 tar 时 pull/sync 均跳过 | AC-2 + AC-7 |
| AC-17 | D-007@v1：spec 同步在 interactive 路径实现（非 task-runner），task-04 utility 被复用 | import from './spec-sync' + 两接入点 |
| AC-18 | R-03 容错：pull/sync 失败均 warn 不阻塞（AC-4 + AC-6） | 代码审查 |
| AC-19 | R-07 时序：pull 在 driver 启动前 await 完成、sync 在 session 终态后（AC-1 + AC-5） | 代码审查 + 时序测试 |
