---
author: qinyi
created_at: 2026-08-17 08:52:32
scale: large
risk_level: integration-critical
---

# 设计文档（Design）— CLI 直跑 spec 文件增量同步

## 1. 背景

变更中心详情页有两类文件消费：
- **文档卡**：展示 change 四件套（proposal/design/requirements/tasks.md），内容由 `POST /api/changes/{name}/documents` 写入 `platform_change_progress.documents` 列。
- **变更文件树**：展示整个 `.sillyspec/` 目录（含 plan.md、tasks/、module-impact.md、verify-result.md 等），内容由 daemon 推送到服务器 `spec_root` 后，后端从文件系统读取。

2026-08-16-auto-sync-from-repo 已让 CLI 每步 `sync()` 自动推四件套（解决文档卡问题），但**文件树**在 CLI 直跑场景仍依赖 daemon 缓存链路：
- daemon 缓存（`~/.sillyhub/daemon/specs/<ws>`）可能不是最新仓库快照；
- 手动「同步到服务器」按钮已在 ql-20260816-002 改为从仓库 `.sillyspec` 打包，但需人工点击。

与此同时，daemon ↔ 后端链路已在 2026-08-13-platform-managed-file-sync 完成完整增量同步：
- 后端 `POST /api/spec-workspace/sync-incremental` 支持 add/update/delete/rename + `base_version` 乐观锁；
- `SpecFileManifest` 表保存每文件 `content_hash`/`version`/`exists`；
- daemon `computeIncrementalOps()` 实现本地清单 diff + rename 识别 + 本地清单缓存。

**本次变更目标**：把同一套增量同步能力接到 **CLI 直跑场景**（本地 agent 直接跑 `sillyspec`），让文件树也能随每步 `--done` 自动增量同步到平台，无需 daemon、无需手动按钮。

本变更不涉及新的生命周期契约（不适用 lifecycle contract：不新增 session/lease/agent_run 状态流转，也不发送/接收生命周期事件）。

## 2. 设计目标

1. CLI 直跑 sillyspec 时，每步 `--done` 后自动把本地 `.sillyspec/` 树与服务器 `spec_root` 做差异比对，只推送变化文件（增量）。
2. 复用 daemon 已验证的清单/乐观锁/rename 协议，不另造轮子。
3. 四件套直推保留（喂文档卡），与文件树增量同步正交、不冲突。
4. 冲突不静默覆盖：服务器版本已变 → 返回 conflict，CLI 提示但不阻塞流程。
5. 未连平台/老后端 404 → 静默跳过，不影响进度/文档同步主流程。

## 3. 非目标

- 不改造 daemon 已有增量链路（复用）。
- 不改造详情页文件树 UI 本身（只让它内容更新）。
- 不替代四件套直推（文档卡依赖 documents 列）。
- 不在 CLI 侧持久化清单缓存（短进程，以服务器清单为锚）。
- 不处理冲突自动合并（保持乐观锁「人工拍板」语义，与 daemon 一致）。

## 4. 拆分判断

多模块、跨仓（backend platform_sync + spec_workspace、CLI sillyspec）、有新增接口和鉴权通道，判定为 **large**，走完整 brainstorm → plan → execute → verify → archive 流程。

## 5. 总体方案

### 5.1 架构图

```
本地 .sillyspec/              平台
     │                          │
     │  ① GET /api/changes/-/spec-manifest
     │─────────────────────────>│
     │  服务器清单 {path: {hash,version,exists}}
     │<─────────────────────────│
     │                          │
     │  ② walk 本地树 + sha256
     │  diff → add/update/delete/rename ops
     │  （无差异则短路不发请求）
     │                          │
     │  ③ POST /api/changes/-/spec-sync
     │  body: FileOp[]          │
     │─────────────────────────>│ platform_sync 鉴权 (shpsync_)
     │                          │ 调 spec_workspace.apply_ops()
     │  {ok, new_versions, conflict, server_versions}
     │<─────────────────────────│ 落盘 SpecFileManifest + spec_root
```

### 5.2 后端：platform_sync 层新增两个端点

为避免与既有 `GET /api/changes/{name}/progress` 路径贪婪匹配冲突，固定片段端点使用 `-` 占位路径段，注册在 `backend/app/modules/platform_sync/router.py`：

- **GET `/api/changes/-/spec-manifest`**
  - 鉴权：沿用 `require_platform_sync_write`（shpsync_ token），从 token 派生 `workspace_id`。
  - 调用 `PlatformSyncService.get_spec_manifest(workspace_id)` → 内部查 `SpecFileManifest` 表，返回 `{ files: { path: { hash, version, exists } } }`。

- **POST `/api/changes/-/spec-sync`**
  - 鉴权同上。
  - 请求体：`{ ops: FileOp[] }`（复用 `spec_workspace/schema.py` 的 `FileOp`）。
  - 调用 `PlatformSyncService.apply_spec_ops(workspace_id, ops)` → **直接调用 `SpecWorkspaceService.apply_ops()`** 落盘。
  - 权限说明：`spec_workspace` 的权限检查在 router 层完成；`apply_ops()` service 方法本身不校验权限。platform_sync 端点已通过 `require_platform_sync_write` 完成 workspace 级鉴权，因此可直接调用。
  - 事务说明：`apply_ops()` 内部把全部 ops 包在一次 DB 事务中提交（成功则全部落盘，失败则全部回滚），保证一次 POST 的原子性。
  - 响应：`{ ok: bool, new_versions: dict, conflict: bool, server_versions: dict | None }`。

平台同步 token（shpsync_）此前只开放给 platform_sync 三个 POST 端点（progress/documents/approval）。本次新增两个端点走同一鉴权，让 CLI 能用同一份 `local.yaml platform.token` 调用。

### 5.3 后端：清单读取能力

`SpecWorkspaceService` 新增 `get_manifest(workspace_id)`：
- `select SpecFileManifest where workspace_id = ?`；
- 返回全部行（含 `exists=False` 的软删文件），让 CLI diff 能识别服务器侧已删文件。

### 5.4 CLI：sync() 成功后追加 syncSpecTree()

在 `sillyspec/src/sync.js` 的 `sync()` 成功路径末尾、四件套直推之后，追加：

```js
try {
  await this.syncSpecTree(changeName);
} catch (err) {
  debugLog(`[sync] spec 树增量同步失败（不影响进度）: ${changeName}: ${err.message}`);
}
```

`syncSpecTree()` 拆到新的 `sillyspec/src/spec-sync.js` 模块，职责单一：
1. 读 `local.yaml platform` 配置；未连接则 return。
2. `GET /api/changes/-/spec-manifest` 拿服务器清单。
3. walk 本地 `.sillyspec/`：
   - 排除 `.runtime/`、`runtime/`、`worktrees/`、`projects/`（复用 daemon 常量集合）。
   - 用 `crypto.createHash('sha256')` 算每个文件 hash。
4. diff 生成 `FileOp[]`：
   - 服务器无、本地有 → `add`（base_version=0）。
   - 服务器有、本地无 → `delete`（base_version=服务器 version）。
   - 同路径 hash 不同 → `update`（base_version=服务器 version）。
   - 缓存有、本地无，且本地新路径 hash 与缓存某路径相同 → `rename`（base_version=缓存旧路径 version）。
5. ops 为空则短路，不发请求。
6. `POST /api/changes/-/spec-sync` 推送 ops。
7. conflict → console.warn 提示用户，不抛错、不阻塞。
8. 404/网络/老后端 → debugLog，静默跳过。

### 5.5 CLI 与 daemon 并发推同一 spec_root

两条链路都写同一服务器 `spec_root`，但都以服务器清单的 `base_version` 为乐观锁：
- CLI 先推 → version 增加；daemon 后推同文件 → base_version 过期 → conflict → daemon/CLI 侧提示人工拍板。
- CLI 和 daemon 都从仓库 `.sillyspec` 取源时，内容一致，不会冲突；daemon 从旧缓存推时才会冲突，这正是乐观锁要暴露的问题。

### 5.6 触发时机

与四件套直推一致：CLI 每步 `--done` 成功后触发。无差异时短路（只多一次 GET + 本地 walk），量小可忽略。

## 6. 文件变更清单

### main 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/platform_sync/router.py | 新增 GET/POST 两个端点（路径用 `/api/changes/-/spec-*` 避免与 `{name}` 贪婪匹配冲突） |
| 修改 | backend/app/modules/platform_sync/schema.py | 新增 SpecManifestResponse、SpecSyncRequest、SpecSyncResponse |
| 修改 | backend/app/modules/platform_sync/service.py | 新增 get_spec_manifest / apply_spec_ops 包装 |
| 修改 | backend/app/modules/spec_workspace/service.py | 新增 get_manifest() 查 SpecFileManifest 表 |
| 新增 | backend/app/modules/platform_sync/tests/test_spec_sync.py | 清单接口 + 增量同步 + 冲突 + 鉴权测试 |
| 修改 | backend/openapi.json | 后端 schema 改动后跑 `pnpm gen:types` 自动生成 |
| 修改 | frontend/src/lib/api-types.ts | 后端 schema 改动后跑 `pnpm gen:types` 自动生成 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/sillyspec.md | 关键逻辑补「CLI 直跑平台同步」三层上行条目（task-10） |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/backend.md | platform_sync 同步层条目追加 spec-manifest/spec-sync 2 端点说明（task-10；无独立 platform_sync.md 模块卡，backend.md 是既有归档处） |

### sillyspec 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | src/spec-sync.js | CLI 增量同步核心：读清单/walk/hash/diff/POST ops |
| 修改 | src/sync.js | sync() 成功路径追加 syncSpecTree() 调用 |
| 新增 | test/platform-spec-sync-incremental.test.mjs | CLI 增量同步 3 断言（有差异/无差异/conflict 不阻塞） |

## 7. 接口定义

### GET /api/changes/-/spec-manifest

请求头：
```
Authorization: Bearer <shpsync_...>
```

响应 200：
```json
{
  "files": {
    "changes/2026-08-17-foo/design.md": {
      "hash": "aabb...",
      "version": 3,
      "exists": true
    },
    "changes/2026-08-17-bar/tasks.md": {
      "hash": "ccdd...",
      "version": 1,
      "exists": false
    }
  }
}
```

### POST /api/changes/-/spec-sync

请求头：
```
Authorization: Bearer <shpsync_...>
Content-Type: application/json
```

请求体（复用 spec_workspace FileOp）：
```json
{
  "ops": [
    { "op": "add", "path": "changes/x/plan.md", "hash": "...", "content": "base64", "base_version": 0 },
    { "op": "update", "path": "changes/x/design.md", "hash": "...", "content": "base64", "base_version": 2 },
    { "op": "delete", "path": "changes/x/old.md", "base_version": 1 },
    { "op": "rename", "path": "changes/x/a.md", "new_path": "changes/x/b.md", "base_version": 1 }
  ]
}
```

响应 200：
```json
{
  "ok": true,
  "new_versions": { "changes/x/plan.md": 1, "changes/x/design.md": 3 },
  "conflict": false,
  "server_versions": null
}
```

冲突时：
```json
{
  "ok": true,
  "new_versions": {},
  "conflict": true,
  "server_versions": { "changes/x/design.md": 5 }
}
```

## 8. 数据模型

复用既有 `spec_workspace` 模块模型：

- `SpecFileManifest`：每文件一行（workspace_id, path, content_hash, version, exists, updated_at）。
- `SpecWorkspace.spec_version`：每次 spec_root 重写时自增，用于 daemon 客户端判断是否需要重新 pull。增量同步不改它（apply_ops 只改单文件 version）。

本次不新增表。

## 9. 兼容策略（brownfield）

- **未连接平台**：`_getPlatform()` 返回 null，syncSpecTree 直接 return，零影响。
- **老 SillyHub 后端无新端点**：GET/POST 404 → catch 后 debugLog，静默跳过，进度/文档同步照常。
- **daemon 旧客户端**：不受影响，继续走 `/spec-workspace/sync-incremental`。
- **首次同步**：CLI 无本地缓存，服务器清单为空（或 partial）→ 所有本地文件生成 add ops，base_version=0，后端走 R-07 兜底新建 version=1。
- **shpsync_ 以外的 token**：后端 403，CLI 静默跳过（debugLog）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | CLI 每次全量 walk+hash 本地 .sillyspec 树，大仓库可能慢 | P2 | 排除 .runtime/projects/worktrees；实测普通变更树几十~几百文件，ms 级；后续可加 mtime 缓存优化 |
| R-02 | CLI 与 daemon 并发推同文件触发 conflict，用户困惑 | P2 | 冲突时 console.warn 明确提示「spec 文件在平台被其他客户端更新，请检查」；不阻塞流程 |
| R-03 | 平台 sync 端点新增扩大 shpsync_ token 权限面 | P1 | 端点仍只接受 shpsync_；鉴权逻辑复用 platform_sync 既有 helper；权限仍是 workspace 级 |
| R-04 | rename 误识别（不同路径同 hash） | P2 | 复用 daemon 已验证的 rename 算法；内容 hash 相同才判 rename |
| R-05 | 路径分隔符 Windows/Unix 差异导致 diff 漂移 | P1 | walk 生成 POSIX 路径；与 daemon relPath 对齐 |
| R-06 | 后端新增端点需同步生成 openapi.json + api-types.ts | P1 | execute 阶段跑 `pnpm gen:types`，文件清单已列明 |
| R-07 | 与 auto-sync-from-repo 同时修改 sillyspec:src/sync.js 产生 hunk 冲突 | P1 | execute 前确认基于已合并 auto-sync-from-repo 的最新 main，如有冲突手工对齐顺序（先 syncDocuments 后 syncSpecTree） |

## 11. 决策追踪

| 决策 | 版本 | 覆盖 |
|---|---|---|
| D-001@v1 复用 daemon 增量协议 | accepted（用户确认） | §5.2/§5.4 |
| D-002@v1 platform_sync 层新增端点（非改 spec_workspace 鉴权） | accepted | §5.2 |
| D-003@v1 四件套直推保留 | accepted | §3/§5.6 |
| D-004@v1 CLI 无本地缓存，以服务器清单为锚 | accepted | §5.4/§9 |
| D-005@v1 conflict 不阻塞主流程 | accepted | §5.4 |

## 12. 自审

- ✅ 背景与目标清晰；非目标明确排除四件套替代。
- ✅ 文件变更清单按仓分段，含新增/修改/测试。
- ✅ 接口定义含请求/响应示例、冲突示例。
- ✅ 数据模型无新增表，复用 SpecFileManifest。
- ✅ 兼容五层覆盖（未连接/老后端/旧 daemon/首次同步/非 shpsync token）。
- ✅ 风险登记 5 项，含并发冲突、权限面、rename 误判、平台差异、性能。
- ✅ 决策追踪 5 条，与用户确认点对应。
- ✅ 命中 daemon 关键词但明确声明「不涉及新的生命周期契约」。
