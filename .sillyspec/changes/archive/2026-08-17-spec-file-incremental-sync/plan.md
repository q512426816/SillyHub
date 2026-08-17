---
author: qinyi
created_at: 2026-08-17 10:20:00
plan_level: high
---

# 实现计划（Plan）— CLI 直跑 spec 文件增量同步

## 1. 复杂度分级

- **plan_level**: `high`
- **依据**：跨仓（main + sillyspec）、多模块（backend platform_sync/spec_workspace + CLI）、新增接口与鉴权通道、需要同步 OpenAPI/api-types。
- **审查 tier**: `independent`（规模 > 3 文件，需独立 QA 审查）
- **总任务数**: 10

## 2. 跨仓声明（SillySpec 工具读取 plan.md 内联块用）

```yaml
---repo/base/head---
main:
  base: origin/main
  head: sillyspec/2026-08-17-spec-file-incremental-sync
sillyspec:
  base: origin/main
  head: main
```

> 说明：跨仓 task 在 task 卡片 frontmatter 加 `repo: sillyspec`；main 仓 task 不加（缺省 main）。

## 3. Wave 划分

### Wave 1：后端 platform_sync 清单读取能力

**目标**：让 CLI 能读到服务器清单。

**依赖**：无。

- [x] task-01：新增 GET /api/changes/-/spec-manifest
  - repo: main
  - 文件：`backend/app/modules/platform_sync/router.py`、`schema.py`、`service.py`；`backend/app/modules/spec_workspace/service.py`。
  - 动作：
    1. `SpecWorkspaceService.get_manifest(workspace_id)`：查询 `SpecFileManifest` 全部行，返回 `dict[path, FileManifestEntry]`。
    2. `PlatformSyncService.get_spec_manifest(workspace_id)`：透调。
    3. `SpecManifestResponse` schema。
    4. router 新增端点，依赖 `require_platform_sync_write`（复用 `platform_sync/auth.py` 既有 helper，不新增鉴权逻辑）。
  - 验收：
    - GET 返回与 `SpecFileManifest` 表一致；
    - 未认证 401；非 shpsync_ token 403；
    - router 依赖为 `require_platform_sync_write`。

### Wave 2：后端 platform_sync 增量同步端点

**目标**：让 CLI 能调用增量同步端点。

**依赖**：Wave 1。

- [x] task-02：新增 POST /api/changes/-/spec-sync
  - repo: main
  - 文件：`backend/app/modules/platform_sync/router.py`、`schema.py`、`service.py`。
  - 动作：
    1. `SpecSyncRequest`（`ops: list[FileOp]`）、`SpecSyncResponse` schema。
    2. `PlatformSyncService.apply_spec_ops(workspace_id, ops)`：透调 `SpecWorkspaceService.apply_ops()`（单事务）。
    3. router 新增端点，依赖 `require_platform_sync_write`。
  - 验收：
    - add/update/delete/rename 正确落盘；
    - conflict 返回 `conflict=true` 且 `server_versions` 非空；
    - 空 ops 返回 `ok=true`。

### Wave 3：鉴权打通 + 后端测试

**目标**：确认 shpsync_ token 能走通新端点，并补充测试。

**依赖**：Wave 2。

- [x] task-03：鉴权与跨模块调用验证
  - repo: main
  - 文件：`backend/app/modules/platform_sync/tests/test_spec_sync.py`。
  - 动作：
    1. 用 shpsync_ token 调 GET/POST → 200。
    2. 用 JWT / shk_live_ 调 GET/POST → 403。
    3. 无 token → 401。
    4. conflict 场景：手动改 `SpecFileManifest.version` 后再推，返回 `conflict=true` 且 `server_versions` 指向冲突文件。
    5. 空 ops → 200 ok=true。
  - 验收：新增测试全绿；既有 `platform_sync`、`spec_workspace` 测试不红。

### Wave 4：CLI 增量同步模块 - walk 与 hash

**目标**：CLI 能本地扫描文件并计算哈希。

**依赖**：Wave 3。

- [x] task-04：本地文件扫描与哈希
  - repo: sillyspec
  - 文件：`sillyspec:src/spec-sync.js`。
  - 动作：
    1. `walkSpecTree(specRoot, excludeSets)`：复用 daemon 排除常量（来源：`sillyhub-daemon/src/spec-sync.ts` 中的 `UPLOAD_EXCLUDE_TOP_BASE` / `UPLOAD_PRUNE_NAMES_BASE`），返回 `{path, absPath, mtimeMs}` 列表。
    2. `hashFiles(entries)`：sha256，返回 `{path, hash, mtime}`。
  - 验收：
    - 正确排除 `.runtime`/`runtime`/`worktrees`/`projects`；
    - 输出路径为 POSIX（Windows 下 `\\` 转 `/`）。

### Wave 5：CLI 增量同步模块 - diff ops 生成

**目标**：CLI 能计算差异 ops。

**依赖**：Wave 4。

- [x] task-05：差异 ops 生成
  - repo: sillyspec
  - 文件：`sillyspec:src/spec-sync.js`。
  - 动作：
    1. `computeSpecOps(serverManifest, localFiles)`：生成 add/update/delete/rename ops，base_version 取自服务器清单；rename 仅当旧路径无、新路径有、hash 相同才生成。
  - 验收：
    - add/update/delete/rename 四种 op 的输入/输出映射符合 daemon 算法；
    - ops 为空时返回空数组。

### Wave 6：CLI 增量同步模块 - syncSpecTree 组装

**目标**：CLI 能组装 syncSpecTree 并错误降级。

**依赖**：Wave 5。

- [x] task-06：syncSpecTree 组装与错误降级
  - repo: sillyspec
  - 文件：`sillyspec:src/spec-sync.js`。
  - 动作：
    1. `syncSpecTree(cwd, changeName)`：读 local.yaml → GET 清单 → walk/hash → diff → 无差异短路 → POST ops → conflict warn。
    2. 错误处理：未连接/404/网络 → 静默返回；conflict → `console.warn`。
  - 验收：
    - 无差异时不发 POST；
    - conflict 时函数仍返回且主流程不抛错；
    - 404 时静默返回。

### Wave 7：CLI sync.js 接入

**目标**：CLI 每步 done 后自动调用 syncSpecTree。

**依赖**：Wave 6。

- [x] task-07：CLI sync.js 接入 syncSpecTree
  - repo: sillyspec
  - 文件：`sillyspec:src/sync.js`。
  - 前置：确认 `sillyspec:src/sync.js` 已基于 2026-08-16-auto-sync-from-repo 合并后的 main（避免 hunk 冲突）。
  - 动作：在 `sync()` 成功路径、四件套直推之后追加：
    ```js
    try { await this.syncSpecTree(changeName); } catch (err) { debugLog(...); }
    ```
  - 验收：运行 `sillyspec run quick --done` 后，CLI 不报错；mock 后端收到 `/api/changes/-/spec-sync` 请求。

### Wave 8：CLI 测试

**目标**：验证 CLI 增量同步行为。

**依赖**：Wave 7。

- [x] task-08：CLI 测试
  - repo: sillyspec
  - 文件：`sillyspec:test/platform-spec-sync-incremental.test.mjs`。
  - 动作：CLI 测试 4 断言：
    - a) 有差异时生成正确 ops；
    - b) 无差异时短路不发 POST；
    - c) conflict 时仍返回 synced=1 且不抛错；
    - d) Windows 路径生成 POSIX op path。
  - 验收：CLI 测试通过。

### Wave 9：OpenAPI 与 api-types 同步

**目标**：后端 schema 改动后同步类型产物。

**依赖**：Wave 1~2。

- [x] task-09：OpenAPI 与 api-types 同步
  - repo: main
  - 文件：`backend/openapi.json`、`frontend/src/lib/api-types.ts`。
  - 动作：
    1. 后端跑 `pnpm gen:types`：
       - 前置健康检查：`pnpm exec tsc --version`；失败则 `pnpm install --force` 后再试。
    2. 提交 `openapi.json` + `api-types.ts`。
  - 验收：gen:types 后无新增 tsc 错误。

### Wave 10：verify 全量回归与模块文档更新

**目标**：全量回归测试 + 更新模块文档。

**依赖**：Wave 8~9。

- [x] task-10：verify 全量回归 + 模块文档更新
  - repo: main + sillyspec
  - 文件：
    - `.sillyspec/docs/multi-agent-platform/modules/sillyspec.md`
    - `.sillyspec/docs/multi-agent-platform/modules/backend.md`
    - `backend/app/modules/platform_sync/tests/`（回归）
    - `sillyspec:test/`（回归）
  - 动作：
    1. main 仓回归：backend pytest（platform_sync + spec_workspace）+ frontend vitest。
    2. sillyspec 仓回归：CLI 测试套件。
    3. 更新模块文档：sillyspec.md 说明 CLI 直跑增量同步；backend.md（platform_sync 归档处，无独立模块卡）说明新增两个端点。
    4. 产出 `verify-result.md`。
  - 验收：全绿；verify-result.md PASS。

## 4. 依赖图

```
Wave 1 (task-01) ──> Wave 2 (task-02) ──> Wave 3 (task-03) ──> Wave 4 (task-04) ──> Wave 5 (task-05) ──> Wave 6 (task-06) ──> Wave 7 (task-07) ──> Wave 8 (task-08) ──> Wave 9 (task-09) ──> Wave 10 (task-10)
```

## 5. 关键约束

- `sillyspec:src/sync.js` 已被 2026-08-16-auto-sync-from-repo 修改；task-07 前置动作确认 baseline 对齐。
- 新增端点路径带 `-` 占位，避免与 `/api/changes/{name}` 贪婪匹配冲突。
- execute 阶段跑 `pnpm gen:types` 前先 `pnpm exec tsc --version` 确认 node_modules 健康，半坏时 `pnpm install --force`。

## 6. 验收标准（整体）

1. 本地跑 `sillyspec run quick --done` 后，平台该 change 的文件树自动出现/更新新文件，无需手动同步。
2. 只改一个 plan.md 时，`POST /api/changes/-/spec-sync` 请求体只含该文件 op。
3. 冲突场景 CLI 提示但不报错；进度同步与四件套直推不受影响。
4. 老后端 404 时 CLI 静默跳过。
5. 后端新增测试 + CLI 测试 + 既有回归测试全绿；tsc 0 错误。
