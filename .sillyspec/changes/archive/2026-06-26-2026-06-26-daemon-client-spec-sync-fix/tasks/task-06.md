---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: []
blocks: [task-11]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/src/daemon.ts
---

# Task-06 — daemon 侧三合一：syncSpecTreeIfNeeded 抽离 + scan 终态触发 + packSpecDir 含 .runtime

## 目标

daemon-client workspace 的 spec 树当前只在 `onSessionEnd` 回灌（design §1 根因 A），而 scan 跑在长生命周期 interactive session（永不 end），导致 scan 终态后 scan-docs/knowledge/.runtime 一直不可见。本任务在 daemon 侧三处动手：

- (a) 把 `postSpecSync` 调用抽成可复用 `syncSpecTreeIfNeeded(ctx, client)`，ctx 为空/null 时 no-op；
- (b) scan run 到终态（completed/failed）收尾点额外触发一次（仅 scan/stage interactive，有 specSyncCtx 时），保留 `onSessionEnd` 兜底；
- (c) `packSpecDir` 不再排除 `.runtime`（push 路径，让 daemon 的 sillyspec.db 等回灌；pull 路径 `build_bundle` 仍排除，保持非对称，design §5.2 / R7）。

覆盖 FR-05（scan 终态即回灌）、FR-06（.runtime 纳入 push）、D-002@v1（scan 终态即回灌，保留 session-end 兜底）。

## 依据

- design.md §5.2 Phase 2（A 触发点 + runtime D-003 两端排除，spec-sync.ts:144-145 改为包含 .runtime）。
- design.md §11 R7（packSpecDir 与 build_bundle 都排除 .runtime，仅改 apply_sync 接收端不够）。
- design.md §12 D-002@v1 覆盖映射 → task-06。
- 现有源码：
  - `spec-sync.ts:119-127` `postSpecSync(client, wsId, specRoot)`（pack + client.postSpecSync）。
  - `spec-sync.ts:140-161` `packSpecDir`，line 144-145 排除 `.runtime`（任意层级，POSIX/Win 分隔符双覆盖）。
  - `daemon.ts:1380-1470` `onSessionEnd` → `_postInteractiveSpecSync(sessionId)`（私有，按 sessionId→sessionManager→leaseId→`_interactiveSpecSyncCtx.get(leaseId)` 反查 ctx → `postSpecSync`）。
  - `daemon.ts:2211` `_interactiveSpecSyncCtx.set(leaseId, { workspaceId })`（仅 scan/stage tar 模式 set；quick-chat/shared 不 set）。
  - `daemon.ts:1196-1215` scan run 终态收尾点（`onTurnResult` 内 `notifyRunResult` 调用处，state.leaseId 可直接拿到）。

## implementation

1. **`spec-sync.ts` 导出 `syncSpecTreeIfNeeded(ctx, client)`**：
   - 签名：`async function syncSpecTreeIfNeeded(ctx: { workspaceId: string } | null | undefined, client: HubClient): Promise<void>`。
   - 行为：`ctx` 为 null/undefined → 直接 return（no-op，quick-chat/shared 无 ctx 自然不触发）；否则等价 `postSpecSync(client, ctx.workspaceId, resolveSpecDir(ctx.workspaceId))`，内部 try/catch，失败仅 warn 不抛（对齐 R-03：sync 尽力而为，不改写 run/session 终态）。client 未实现 `postSpecSync` → no-op（mock 容错）。
   - 保留现有 `postSpecSync` 导出（task-runner batch 路径仍用），`syncSpecTreeIfNeeded` 是其 ctx-guarded 薄封装。
2. **`spec-sync.ts` `packSpecDir` 去掉 `.runtime` 排除分支**（line 144-145 附近）：删除 `if (e.relPath.split(/[\\/]/).includes('.runtime')) continue;`，让 `.runtime/`（含 sillyspec.db）进入 tar。同步更新方法 doc 注释（"排除 .runtime" → "包含 .runtime，design §5.2 D-003 push 路径"）。pull 路径 `build_bundle`（backend 侧，task-07 范围）仍排除，非对称保留。
3. **`daemon.ts` `onSessionEnd` 改调 `syncSpecTreeIfNeeded`**：
   - `_postInteractiveSpecSync` 内部把 `postSpecSync(this._client as never, ctx.workspaceId, resolveSpecDir(ctx.workspaceId))` 替换为 `syncSpecTreeIfNeeded(ctx, this._client as never)`（ctx 查不到时函数自身 no-op，省掉外层 `if (!ctx) return` 亦可，但保留反查/finally delete 逻辑不变以维持 onSessionEnd 幂等 AC-09）。
   - import 行（line 73）补 `syncSpecTreeIfNeeded`。
4. **`daemon.ts` scan run 终态收尾点触发**：在 `onTurnResult` 的 `notifyRunResult` 调用之后（line 1215 `}` 之后、方法结束前），追加：
   ```ts
   // task-06（FR-05 / D-002@v1）：scan run 终态额外触发 spec 树回灌（独立于 session end）。
   // 仅 scan/stage interactive 有 specSyncCtx（quick-chat/shared 不 set → syncSpecTreeIfNeeded no-op）。
   // 幂等：apply_sync 整树覆写（D-006@v1），与后续 onSessionEnd double-sync 无害。
   await syncSpecTreeIfNeeded(this._interactiveSpecSyncCtx.get(state.leaseId) ?? null, this._client as never);
   ```
   - 注：终态点不 delete ctx（保留给后续 onSessionEnd 兜底再同步一次，幂等无害）；onSessionEnd 的 finally delete 维持原样（AC-09）。
   - scan failed 时 `onTurnResult` 仍会走此路径（resultMeta 存在即触发），R5「scan failed 仍回灌 partial output」由本路径覆盖；若 failed 不经 onTurnResult（driver crash 走 onSessionEnd），由 onSessionEnd 兜底覆盖。

## acceptance

- scan run 终态（completed/failed）触发 `postSpecSync` 回灌，**独立于 session end**（session 仍 active 时 scan-docs 即可见，G1）。
- `packSpecDir` 产出的 tar 含 `.runtime/`（含 sillyspec.db），apply_sync（task-07）有 .runtime 可收（G2 / FR-06）。
- double-sync（scan 终态 + 后续 session-end）幂等无害（依赖 backend apply_sync 整树覆写 D-006@v1，本任务不改 backend）。
- quick-chat / shared（transport!=='tar'）interactive 不触发（无 specSyncCtx → `syncSpecTreeIfNeeded` no-op）。
- `onSessionEnd` 兜底语义不变（finally delete ctx + AC-09 幂等）。

### 执行记录（2026-06-26）

- `spec-sync.ts`：`syncSpecTreeIfNeeded(ctx, client)` 抽离（ctx null/undefined→no-op，失败仅 warn R-03）+ `packSpecDir` 去掉 `.runtime` 排除（push 含 `.runtime`，D-003）。
- `daemon.ts`：scan run 终态点（`onTurnResult` 收尾，`notifyRunResult` 后）触发 `syncSpecTreeIfNeeded`；`onSessionEnd` 改调同函数（复用，finally delete 不变 → AC-09）。
- 验证：`npx vitest run tests/spec-sync.test.ts` **6 passed**（ctx null/undefined no-op、workspaceId 触发 postSpecSync、失败仅 warn 不抛、packSpecDir 含 `.runtime/sillyspec.db`）；`tsc --noEmit` 通过。
- 注：daemon 全量 vitest 有 2 个 `cli.test.ts` 失败（`status_shows_config` / `logs_no_file`），系本机真实 `~/.sillyhub` 环境泄露（daemon 在线运行读到真实 config/log），与本 task 改动无关；ci-check hook 不跑 daemon 测试故不阻塞 commit。

## verify

```bash
cd sillyhub-daemon && pnpm test      # spec-sync + daemon 测试（packSpecDir 含 .runtime、scan 终态触发、double-sync 幂等）
cd sillyhub-daemon && pnpm exec tsc --noEmit
```

重点测试用例：`packSpecDir` 输出 tar 含 `.runtime/sillyspec.db` entry；`syncSpecTreeIfNeeded(null/undefined, client)` 不调 client.postSpecSync；scan run 终态回调触发一次 postSpecSync（mock client 计数）；onSessionEnd 兜底仍触发；double-sync 无异常。

## constraints

- 仅 scan/stage interactive（tar 模式，有 specSyncCtx）触发终态 sync；quick-chat / shared 不触发。
- 保留 `onSessionEnd` 兜底（不改其反查/finally delete 逻辑）；终态点不 delete ctx，留给 session-end 兜底。
- 幂等依赖 backend `apply_sync` 整树覆写（D-006@v1，本任务不改 backend）。
- 仅改 `allowed_paths` 内两文件；pull 路径 `build_bundle` 排除 `.runtime` 不变（backend 侧，task-07）。
- `postSpecSync` 导出保留（batch task-runner 路径依赖）。
- Windows/Linux/macOS 兼容（路径仍走 `resolveSpecDir`→`homedir()`，无新增平台依赖）。

## out_of_scope

- backend `apply_sync` 接收 `.runtime` + 落 `last_synced_at`（task-07）。
- backend `build_bundle` pull 路径（继续排除 .runtime，task-07）。
- Phase 3 change-write 分支（task-08~12；task-11 复用本任务产出的 `syncSpecTreeIfNeeded`，故本任务 blocks task-11）。
