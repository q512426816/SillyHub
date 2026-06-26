---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: [task-06, task-09]
blocks: []
requirement_ids: [FR-08, FR-10]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
---

# task-11 — daemon task-runner `kind=change-write` 轻量分支

## 目标

daemon 轮询到 change-write 任务（task-09 端点下发的 `daemon_change_writes` 行）后，在本地 spec 目录写文件并回执，触发 spec 整树回灌。**纯文件写 + sync，不启动 agent driver**（与 batch agent-run lease `runLease` 严格区分，覆盖 FR-10）。

## 背景 / 依据

- design.md §5.3（Phase 3 daemon 代写 change，lease-polling 通道）、§7（`syncSpecTreeIfNeeded` 抽出契约）、7.5 生命周期契约表（write_change 下发/回执/回灌）。
- D-004@v1（daemon 代写 change 经 lease-polling，复用 pending-leases 同款轮询基础设施，不新增 daemon server）。
- 现有可复用基础设施（已核实）：
  - `spec-sync.ts:35 resolveSpecDir(wsId)` → `~/.sillyhub/daemon/specs/<wsId>`（wsId 含 `/\<` 拒绝，跨平台用 `os.homedir()`）。
  - `spec-sync.ts:119 postSpecSync(client, wsId, specRoot)` → pack+POST sync（task-06 的 `syncSpecTreeIfNeeded` 在其上包装 specSyncCtx→postSpecSync，本任务调 task-06 抽出的函数，不重复实现 pack）。
  - `spec-sync.ts:178 extractTar` 路径穿越防护范式（`name.includes('..') || isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)` + `relative(target, full).startsWith('..')` 双重校验）——change-write 写文件照搬。
  - `hub-client.ts` lease 风格方法（`getPendingLeases`/`claimLease`/`completeLease`，line 449/362/430）——change-write 三方法对齐同款 snake_case body + `satisfies` + `REST_PREFIX` 拼接。
  - `daemon.ts:1567` lease 轮询循环 + `daemon.ts:2305 _runLeaseStateMachine`（claim→execute→complete 三段）；`daemon.ts:501 _interactiveSpecSyncCtx: Map<leaseId, {workspaceId}>`（interactive sync 上下文登记范式）。
  - `task-runner.ts:284 runLease(ctx)` batch agent 执行入口（本任务**不调用**，FR-10）；`task-runner.ts:493-500` batch step 8.5 postSpecSync 调用点（参考其失败仅 warn 不阻塞语义）。

## 实现（implementation）

1. **hub-client.ts**（对齐 pending-leases/claim/complete 风格，additive，不破坏既有方法）：
   - `getPendingChangeWrites(runtimeId): Promise<Record<string,unknown>[]>` — GET `{REST_PREFIX}/runtimes/{rid}/pending-change-writes`（task-09 端点），与 `getPendingLeases` 同款 GET。
   - `claimChangeWrite(id, runtimeId, claimToken): Promise<Record<string,unknown>>` — POST `{REST_PREFIX}/change-writes/{id}/claim`，body `{ runtime_id, claim_token }`（claim_token 经 query/header 透传，按 task-09 端点契约定夺，snake_case）。
   - `completeChangeWrite(id, claimToken, payload): Promise<Record<string,unknown>>` — POST `{REST_PREFIX}/change-writes/{id}/complete`，body `{ claim_token, ok, files[] }`，与 `completeLease` 同款 `{ claim_token, result }` 风格（payload 内 ok/files 是 result 子字段）。
   - 错误语义对齐 `_request`：HTTP 非 2xx → `HubHttpError`；网络/超时透传。

2. **daemon.ts**（轮询循环扩展，与 lease 轮询同节奏）：
   - 在 lease 轮询循环（line 1567 附近）追加 change-write 轮询分支：`getPendingChangeWrites(rid)` → 对每条 `kind='change-write'`（或 change-write 专用响应）任务调 task-runner 轻量执行分支。
   - 与 `_runLeaseStateMachine` 互斥：**不走** claim→start→runLease→complete lease 三段；走独立的 change-write 流（claim → 本地写 → complete 回执 → sync）。
   - sync 触发：complete 成功后，构造 specSyncCtx（`{ workspaceId }`，对齐 `_interactiveSpecSyncCtx` 形态）调 task-06 抽出的 `syncSpecTreeIfNeeded(ctx, client)` 回灌 `changes/<key>/`（design §5.3 末段）。

3. **task-runner.ts**（`kind=change-write` 轻量执行分支，**不调 agent driver**）：
   - 新增 `runChangeWrite(ctx): Promise<ChangeWriteResult>`（或同名轻量方法，与 `runLease` 并列）。
   - 流程：`resolveSpecDir(wsId)` 定位本地 spec 根 → 目标子目录 `join(specDir, 'changes', changeKey)` → 遍历 `files[]{path, content}`：
     - **path traversal 校验**（照搬 spec-sync.ts:198 范式）：`path` 含 `..` 段、绝对路径、Win 盘符 `[A-Za-z]:[\\/]` → 抛错拒绝（仅允许落在 `changes/<changeKey>/` 内）；`join` 后 `relative(changesDir, fullPath).startsWith('..')` 二次校验。
     - `mkdir(dirname(fullPath), {recursive:true})` + `writeFile(fullPath, content)`（utf-8）。
   - 回执：`completeChangeWrite(id, claimToken, { ok:true, files:[...writtenRelPaths] })`。
   - sync：调 task-06 `syncSpecTreeIfNeeded({workspaceId: wsId}, client)`（复用，不重复 pack/postSpecSync 实现；task-06 未抽出时退化为直接 `postSpecSync(client, wsId, specDir)`）。
   - **不 import / 不调用 agent driver**（SessionManager / claude driver），FR-10。

## 验收（acceptance）

- claim 成功后，本地 `~/.sillyhub/daemon/specs/<wsId>/changes/<key>/` 下文件按 `files[]{path,content}` 正确写入（utf-8，跨平台路径）。
- `completeChangeWrite` 回执后，backend 落 `Change` + `ChangeDocument` 行（task-09 端点消费回执）。
- **不启动 agent run**（无 AgentRun 行、无 session/driver 协程）；执行栈不经过 `runLease`。
- path traversal 拒绝：`path='../foo'` / `path='/etc/x'` / `path='C:\\x'` / `path='foo/../../bar'` 全部抛错且不写任何文件。
- sync 触发后 backend `spec_workspaces.last_synced_at` 更新、`changes/` 子树回灌可见（与 task-06 同口径）。

## 验证（verify）

- `cd sillyhub-daemon && pnpm test`：新增 task-runner `runChangeWrite` 分支单测——含 claim→写文件→complete→sync 主路径、path traversal 四类拒绝、不调 driver 守卫（mock 断言 `runLease` / SessionManager 未被调用）。
- `cd sillyhub-daemon && pnpm exec tsc --noEmit`：类型通过（hub-client 三新方法签名 + task-runner 新方法签名）。
- 不改既有 batch lease 测试（`runLease` / interactive session 测试零回归）。

## 约束（constraints）

- 仅文件写 + sync，**不启 agent**（FR-10）；不调 `runLease` / SessionManager / driver。
- path traversal 防 `../`、绝对路径、Win 盘符；写入严格限制在 `changes/<key>/` 内。
- 跨平台路径：`os.homedir()` + `node:path.join`（不硬编码 `/` 或 `\`），与 `resolveSpecDir` 一致。
- 复用 task-06 `syncSpecTreeIfNeeded`（或退化 `postSpecSync`），**不重复实现** pack/walkDir/postSpecSync。
- hub-client 三方法 additive，不破坏既有 `getPendingLeases`/`claimLease`/`completeLease`/`postSpecSync` 签名。
- sync 失败仅 warn 不阻塞回执（对齐 task-runner.ts:493-500 / design R-03 既有语义）。

## 执行记录（2026-06-26）

- 提交：`0f5ff821 feat(daemon): execute change-write tasks without agent (task-11)`。
- 实现：`HubClient` 新增 pending/claim/complete change-write 方法；daemon 轮询循环增加 change-write 分支和 inflight 去重；`TaskRunner.runChangeWrite` 写入 `changes/<key>/`、校验 traversal、complete 回执并触发 `syncSpecTreeIfNeeded`。
- 验证：`pnpm vitest run tests/task-11-change-write.test.ts tests/spec-sync.test.ts` 通过，`26 passed`；`pnpm exec tsc --noEmit` 通过。
- 设计取舍：`runChangeWrite` 先 complete 后 sync；sync 失败按设计只 warn、不改写 ok，避免回灌失败把本地写入误判为失败。真实跨边界回灌仍由 task-14 验证。
