---
id: task-12
title: Sync api-types.ts (frontend + daemon) remove path_source/daemon_runtime_id + daemon comment update
title_zh: api-types.ts 手动同步（frontend+sillyhub-daemon 删 path_source/daemon_runtime_id 类型）+daemon spec-sync.ts/task-runner.ts 注释更新
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P1
depends_on: [task-01]
blocks: [task-14]
requirement_ids: [FR-7]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/src/task-runner.ts
---

## goal

手动同步两份 `api-types.ts`（frontend 与 sillyhub-daemon 各一份，OpenAPI 生成产物但本项目无自动化 codegen，R-03），删除 Workspace 相关类型里的 `path_source` / `daemon_runtime_id` 字段及 `PathSourceLiteral` 对应的 TS 联合类型，使 TS 类型与 task-01 定型后的 backend schema 一致；并更新 daemon `spec-sync.ts` / `task-runner.ts` 中引用 server-local 的注释（wsId 现在永远非空，server-local 模式已不存在）。本任务为 Wave 4 纯类型同步 + 注释清理，无功能改动，依赖 task-01 schema 定型。覆盖 design §5 Phase 4 手动同步条目 + §5 Phase 5 daemon 最小改动 + R-03。

## implementation

### frontend/src/lib/api-types.ts

逐个 schema 删 `path_source` 字段（含上方 `@enum`/`@default` 注释块）+ `daemon_runtime_id` 字段（含上方 `Daemon Runtime Id` 注释）。据 grep 命中点（行号为当前 main 快照，execute 时按实际偏移）：

1. `ScanGenerateRequest`（约 line 10872-10879）：删 `path_source`（10704 `"server-local" | "daemon-client"` 联合 + 上方 4 行 Path Source 注释）+ `daemon_runtime_id`（10706 + 上方注释）。保留 `spec_strategy` / `daemon_id`。
2. `WorkspaceCreate`（约 line 12628-12633）：删 `path_source`（12630 + 上方注释）+ `daemon_runtime_id`（12632 + 上方注释）。保留 `daemon_id`（12634）。
3. `WorkspaceRead`（约 line 12752-12757）：删 `path_source`（12754 + 上方注释）+ `daemon_runtime_id`（12756 + 上方注释，注意此字段在 Read 是非可选 `string | null`）。保留 `owner` / `spec_strategy`。
4. `WorkspaceUpdate`（约 line 12830-12835）：删 `path_source`（12832 可选联合 + 上方注释）+ `daemon_runtime_id`（12834 + 上方注释）。
5. 若文件内存在 `PathSourceLiteral` 或等价 TS 联合类型别名（grep 确认；当前两份 api-types.ts 内联联合未抽别名，删字段即清零），一并删除。
6. 不动 `MemberBindingView.path_source`（约 line 7844/7865）——这是 per-member binding 视图的 spec 同步策略字段，语义与 workspace.path_source 无关，保留（task-01 不删此列）。

### sillyhub-daemon/src/api-types.ts

与 frontend 同步删对应 4 个 schema 的 `path_source` + `daemon_runtime_id`（grep 命中 10702-10706 / 12455-12459 / 12577-12581 / 12655-12659），保留 `daemon_id` / `spec_strategy` / `MemberBindingView.path_source`（约 7748/7844/7865，per-member spec 策略字段，非 workspace.path_source）。

### sillyhub-daemon/src/spec-sync.ts

- `pullSpecBundle`（line 93）：`if (!wsId) return null;` 注释 `// server-local / 非 daemon-client` 更新为反映 wsId 现永远非空（server-local 已移除，此处仅作防御性兜底/quick-chat 无 workspace 场景）。

### sillyhub-daemon/src/task-runner.ts

注释更新（不改逻辑，仅文字）：
- line 165（`getSpecBundle` docstring「可选方法 —— server-local / 旧 mock client 未实现时」）→ 改为「旧 mock client 未实现时」（server-local 不存在）。
- line 418（步骤 1.5 注释「server-local（无 workspaceId / specRoot 已有值）→ pullSpecBundle 返回 null」）→ 更新为仅 quick-chat/无 workspace 场景。
- line 426（「lease 未透传 latest_spec_version（旧 backend / server-local）」）→ 删 server-local 字样。
- line 455（「仅 daemon-client（wsId 非空）路径有意义；server-local pullSpecBundle 返回 null 跳过」）→ 更新为 wsId 现永远非空。

## 验收标准

- 两份 `api-types.ts` 的 `ScanGenerateRequest` / `WorkspaceCreate` / `WorkspaceRead` / `WorkspaceUpdate` 四个 schema 均无 `path_source` / `daemon_runtime_id` 字段。
- 两份文件均无游离的 `PathSourceLiteral` / `"server-local" | "daemon-client"` 联合（Workspace 上下文；MemberBindingView 的 spec 策略字段保留）。
- `MemberBindingView.path_source`（per-member spec 同步策略）保留不动（非 workspace.path_source）。
- `spec-sync.ts` / `task-runner.ts` 注释不再出现「server-local」字样（保留行为代码不变）。
- 两份 `api-types.ts` / `spec-sync.ts` / `task-runner.ts` 四文件无功能性逻辑改动（纯删类型字段 + 注释文字）。

## verify

```bash
# 1. frontend typecheck（类型与 backend openapi.json 一致性守，R-03）
cd frontend
pnpm typecheck

# 2. daemon typecheck
cd ../sillyhub-daemon
pnpm typecheck

# 3. grep 零残留（四文件，排除 MemberBindingView 的 spec 策略字段）
# 预期：Workspace 四 schema 上下文无 path_source/daemon_runtime_id；MemberBindingView 保留
```

全量 `pnpm test`（frontend vitest / daemon vitest）在 task-14 守，本任务只跑 typecheck（类型同步正确性的直接证据）。前端组件测试若引用了已删字段会编译失败，由 typecheck 捕获。

## constraints

- **必须等 task-01 schema 定型后执行**——backend DTO 删字段后 openapi.json 才是目标态，两份 api-types.ts 据此同步（depends_on: task-01）。
- **两份 api-types.ts 字段必须与 backend openapi.json 一致**——typecheck 是一致性守门（frontend 消费已删字段的组件会在 task-10/11 改完前 typecheck 失败，故本任务与 task-10/11 同 Wave 4，execute 时注意 ordering：若 task-10/11 未完成导致 typecheck 暂失败，属预期，以 task-14 全量 typecheck 为最终守门）。
- **不动 MemberBindingView.path_source**——这是 spec 同步策略三值（platform-managed/repo-mirrored/repo-native）的成员级覆盖字段，与 workspace.path_source（server-local/daemon-client 路径来源）同名不同义，task-01 不删此列。
- **不改 daemon 功能逻辑**——spec-sync.ts / task-runner.ts 仅注释文字更新，`if (!wsId) return null` 等防御性代码保留（quick-chat / shared session 无 workspace 场景仍需兜底）。
- **无 codegen**——本项目无 OpenAPI 自动生成脚本，两份 api-types.ts 是手动维护产物（R-03），execute 时对照 backend/openapi.json 全量核对，不靠 codegen 重生成。
- blocks task-14（前端测试精简）：本任务删类型字段后，引用字段的组件测试需 task-14 同步清理。
