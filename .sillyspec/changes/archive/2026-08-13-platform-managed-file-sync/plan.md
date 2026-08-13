---
author: qinyi
created_at: 2026-08-13 15:09:12
plan_level: full
---

# 实现计划（Plan）— 平台管理 spec 文件增量同步

> change: `2026-08-13-platform-managed-file-sync`
> 模块：`backend spec_workspace` + `backend scan_docs`（仅不碰）+ `sillyhub-daemon`（spec-sync / hub-client）
> 设计依据：design.md §5/§7/§9；需求：requirements.md FR-01~07, NFR-01~04；决策：decisions.md D-001~D-011（D-009 superseded）
> 数据源决策 D-011：独立 `spec_file_manifest` 表（不复用 scan_documents，scan_docs reparse 不碰）
> 核心契约变更（R-01）：文件同步从「整树 tar 全量覆盖」→「文件级增量 + base_version 乐观锁 + 软删备份」

## 关键落盘决策（execute 存疑项 + P2 在此锁死）

以下为本 plan 已锁定的 execute 存疑项与 P2 决策，执行时不再悬空，直接照此实现：

| 编号 | 决策 | 落盘结论 | 依据 |
|---|---|---|---|
| 存疑① | `SpecFileManifest` 放哪个 model 文件 | **`spec_workspace/model.py`**（spec_workspace 是增量同步唯一写者；scan_docs 模块职责=docs 扫描，D-011 职责分离） | design §6 自审存疑① / D-011 |
| 存疑② | 软删后 Change 行状态不恢复取舍（R-04） | **确认接受**：备份区仅恢复**文件内容**，不恢复 Change 行工作流状态（current_stage/gates）——change reparse 对磁盘消失行硬删（`change/service.py:1140`），恢复状态超出本变更范围（NG-06） | design §7 软删语义 / D-010 / R-04 |
| 存疑③ | 备份区具体路径 | `{settings.spec_data_root}/spec-backups/{workspace_id}/{timestamp}/{path}` —— spec_root（`spec_data_root/{ws}`）的**兄弟目录**，build_bundle 只 rglob spec_root 拉不到（BL-2） | design §8 / D-008 修订 / R-03 |
| P2 R-06 | 软删备份空间无限增长 | **默认保留 30 天**：备份写入 timestamped 子目录（`<ts>/<path>`），`apply_ops` 软删时**机会式修剪**该 workspace 备份区中早于 30 天的旧目录；不做独立清理任务/后台定时器 | design §10 R-06 |
| P2 R-07 | base_version=0 历史行歧义 | apply_ops 对**无服务器清单行**的 op 一律走 hash 兜底：`op.hash == 服务器已有记录 hash`（无记录视为新）→ 接受并 version=1（update/add 同处理）；delete op 无行 → no-op 成功（幂等） | design §10 R-07 / §9 |
| Q7 | 旧 tar push 后 version 漂移 | **旧 tar 全量落盘（`_write_spec_root`）时删除该 workspace 全部 `spec_file_manifest` 行** → 下一次 daemon 增量（本地清单仍在）发 op 时服务器按 R-07 兜底重建，强制全量重算 | design §5 Phase1 / §7 兼容 / R-01 |

## Wave 1（后端地基，并行，无依赖，独占 model+migration / schema）
- [x] task-01: `spec_file_manifest` 表模型（`spec_workspace/model.py`，不复用 scan_documents）+ alembic migration（ux(workspace_id,path)+index(version)）（覆盖：FR-03, D-003, D-004, D-011, NFR-01）
- [x] task-02: `spec_workspace/schema.py` 增量 DTO（FileOp / SpecIncrementalSyncRequest / SpecIncrementalSyncResponse）（覆盖：FR-01, FR-02, D-007）

## Wave 2（后端核心，依赖 Wave 1；service.py 独占故 task-03 串行）
- [x] task-03: `service.py` 新增 `apply_ops`（add/update/delete/rename + base_version 校验 409 + 软删 move 出 spec_root + 备份区 timestamped + containment 校验 + .runtime 拒 + 写 spec_file_manifest + R-07 兜底）+ 旧 tar 落盘失效 manifest（`_write_spec_root` 删行）（覆盖：FR-01, FR-02, FR-04, FR-05, FR-06, D-001, D-002, D-004, D-005, D-006, D-008, D-010, NFR-03）
- [x] task-04: `router.py` 新增 `POST /spec-workspace/sync-incremental` 端点（WORKSPACE_WRITE，409 透传 server_versions）（覆盖：FR-02, FR-07, D-001, D-007）

## Wave 3（后端测试 + daemon 客户端，依赖 Wave 2；hub-client 独立可并行）
- [x] task-05: 后端测试 `tests/test_sync_incremental.py`（各 op / 409 / 软删备份 move / .runtime 拒 / containment 拒 / 旧 tar 失效）（覆盖：FR-01~06, D-001~D-011 行为验收）
- [x] task-06: `sillyhub-daemon/src/hub-client.ts` 新增 `postSpecSyncIncremental`（JSON POST，409 → conflict 透传）（覆盖：FR-02, FR-07, D-007）

## Wave 4（daemon diff 客户端 + 测试 + 兼容收尾，依赖 Wave 3）
- [x] task-07: `spec-sync.ts` `postSpecSync` 内部改增量 diff（本地 hash→变化 ops；本地清单缓存 `~/.sillyhub/daemon/manifests/<ws>.json` 移出 specDir；首同步走旧 tar；增量 404/失败回退旧 tar；rename 检测）（覆盖：FR-01, FR-02, FR-05, FR-06, FR-07, D-001, D-004, D-005, D-006, NFR-02, NFR-03, NFR-04）
- [x] task-08: daemon 测试（diff 客户端 / 缓存位置 / rename / 回退旧 tar / 首同步全量）（覆盖：FR-01, FR-02, FR-05, FR-07, NFR-02, NFR-04）
- [x] task-09: 兼容收尾（旧 tar 端点保留核验 / 单成员快速路径 / .runtime 垃圾 ScanDocument 行可选清洗 / P2 R-04+R-06 落盘验收）（覆盖：FR-06, FR-07, D-008, D-010, R-04, R-06）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | spec_file_manifest 表模型 + migration | W1 | P0 | — | FR-03, D-003/004/011, NFR-01 | spec_workspace/model.py，不复用 scan_documents（D-011） |
| task-02 | 增量 DTO（FileOp/Request/Response） | W1 | P0 | — | FR-01/02, D-007 | schema.py 纯 DTO，无 DB 依赖 |
| task-03 | service.apply_ops + 软删备份 + 旧 tar 失效 | W2 | P0 | task-01,02 | FR-01/02/04/05/06, D-001/002/004/005/006/008/010, NFR-03 | 最大任务：containment 对齐 service.py:544-556 + 备份区 + R-07 兜底 |
| task-04 | router sync-incremental 端点 | W2 | P0 | task-02,03 | FR-02/07, D-001/007 | 409 + server_versions |
| task-05 | 后端测试 test_sync_incremental.py | W3 | P0 | task-03,04 | FR-01~06 验收 | 含软删备份/containment/旧 tar 失效 |
| task-06 | hub-client.postSpecSyncIncremental | W3 | P0 | — | FR-02/07, D-007 | JSON POST 客户端方法 |
| task-07 | spec-sync.ts 增量 diff 客户端 | W4 | P0 | task-06 | FR-01/02/05/06/07, D-001/004/005/006, NFR-02/03/04 | 本地缓存移出 specDir + 回退旧 tar |
| task-08 | daemon 测试 | W4 | P0 | task-07 | FR-01/02/05/07, NFR-02/04 | diff/缓存/rename/回退 |
| task-09 | 兼容收尾 + P2 落盘 | W4 | P1 | task-05,07 | FR-06/07, D-008/010, R-04/06 | 纯核验 + 可选 .runtime 垃圾行清洗 |

## 关键路径

task-01 → task-03 → task-04 → task-05（后端清单表 → apply_ops → 端点 → 测试）+ task-06 → task-07 → task-08（daemon 客户端 → diff → 测试），两条线在 task-09 汇合（兼容收尾）。前端侧线性，无分叉。

## 全局验收标准

- [ ] 后端 `cd backend && uv run pytest app/modules/spec_workspace -q --no-cov` 全绿（test_sync_incremental.py 新增：各 op / 409 / 软删备份 / .runtime 拒 / containment 拒 / 旧 tar 失效）
- [ ] alembic migration：`spec_file_manifest` 表存在（ux workspace_id+path 唯一 + version 索引），`uv run alembic upgrade head` 后查询确认
- [ ] 增量端点各 op 正确：add/update 写 spec_root + 清单（version+1）；rename 移动文件 + 更新清单 path；delete 文件移出 spec_root 到 `spec_data_root/spec-backups/{ws}/{ts}/{path}` + 清单 exists=false + version+1
- [ ] base_version 过期 → 409 + server_versions（服务器当前版本），**不落盘**；同 workspace 不同文件互不冲突
- [ ] `.runtime/*` op 拒；containment 校验拒 `../` / 绝对路径 / symlink 逃逸（422，对齐 service.py:544-556）；软删备份目标同校验落 `spec-backups/` 内
- [ ] 旧 tar `apply_sync` 落盘后 `spec_file_manifest` 该 workspace 全表清空 → 下一次增量全量重算（R-07 兜底重建）
- [ ] 备份区 30 天保留：软删时机会式修剪早于 30 天的旧备份目录
- [ ] daemon `cd sillyhub-daemon && pnpm test` 全绿（diff 客户端 / 缓存位置 / rename / 回退）；`pnpm exec tsc --noEmit` 0 error
- [ ] daemon 首同步（无本地清单）走旧 tar；增量 404/失败回退旧 tar，不阻塞；本地清单缓存 `~/.sillyhub/daemon/manifests/<ws>.json`（不在 specDir 内，pull 不清）
- [ ] （brownfield）旧 tar 端点保留，旧客户端/旧 daemon 仍可用（R-01 兼容）
- [ ] P2 落盘：R-04 软删仅恢复文件内容不恢复 Change 行工作流状态（已接受取舍）；R-06 保留 30 天机会式修剪（见「关键落盘决策」）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 多写者+乐观锁 | task-03, task-04 | base_version 过期 409 + server_versions |
| D-002@v1 删除传播=软删+锁 | task-03 | delete op 移备份区 + base_version 校验 |
| D-003@v1 SHA-256 | task-01, task-07 | content_hash 列 + 本地 hash 比对 |
| D-004@v1 文件级版本 | task-01, task-03 | version 列 + base_version 逐文件比对 |
| D-005@v1 rename 显式 op | task-03, task-07 | rename op 移动 + daemon rename 检测 |
| D-006@v1 .runtime 移出 | task-03, task-07 | .runtime/* 拒 + diff 排除 |
| D-007@v1 方案A JSON ops 增量端点 | task-04, task-07 | sync-incremental 端点 + 客户端 |
| D-008@v1 软删备份位置 | task-03, task-09 | 备份区移出 spec_root（BL-2） |
| D-010@v1 软删明确为 move | task-03, task-09 | 磁盘真移 + exists=false 语义 |
| D-011@v1 独立 spec_file_manifest 表 | task-01 | 不复用 scan_documents，scan_docs reparse 不碰 |

| FR | 覆盖任务 |
|---|---|
| FR-01 增量推送 | task-02, task-03, task-05, task-07, task-08 |
| FR-02 多写者乐观锁 | task-02, task-03, task-04, task-06, task-07, task-08 |
| FR-03 服务器权威清单 | task-01, task-03 |
| FR-04 软删除备份 | task-03, task-05 |
| FR-05 rename 显式 op | task-03, task-05, task-07, task-08 |
| FR-06 .runtime 移出 | task-03, task-05, task-07, task-09 |
| FR-07 兼容 | task-04, task-06, task-07, task-08, task-09 |
| NFR-01 迁移 | task-01 |
| NFR-02 降级安全 | task-07, task-08 |
| NFR-03 跨平台 | task-03, task-07 |
| NFR-04 性能 | task-07, task-08 |

---

## task-01

```yaml
id: task-01
title: spec_file_manifest 表模型 + alembic migration（spec_workspace/model.py，不复用 scan_documents）
goal: 建独立增量清单表 spec_file_manifest（path/content_hash/version/exists/updated_at），scan_docs reparse 不碰此表（D-011 职责分离）
implementation: |
  1. `spec_workspace/model.py` 新增 `SpecFileManifest(BaseModel, table=True)`：id(uid pk) / workspace_id(FK workspaces CASCADE) / path(str 相对 spec_root) / content_hash(str SHA-256 hex) / version(int 默认 1) / exists(bool 默认 True) / updated_at(datetime UTC)
  2. `__table_args__`：`Index("ux_spec_manifest_ws_path", "workspace_id", "path", unique=True)` + `Index("ix_spec_manifest_version", "version")`
  3. alembic migration：新建 revision（down_revision=当前 head `20260811150000`，execute 时若 head 已推进按实际 head 修正，参照 20260811150000 模板头部注释格式），建表 + 两索引
  4. `app/models/base.py` BaseModel 已含 created_at/updated_at 语义则复用；否则显式声明
  5. 不新增 scan_documents 任何列、不写 scan_docs 模块文件（D-011 独立表）
acceptance:
  - `spec_file_manifest` 表存在（migration 后 `uv run alembic upgrade head` 可查询）
  - 模型字段齐全：workspace_id/path/content_hash/version/exists/updated_at
  - ux(workspace_id, path) 唯一索引生效（同 ws 同 path 重复插入 IntegrityError）
  - scan_docs 模块零改动（D-011 不碰）
verify:
  - cd backend && uv run alembic upgrade head && uv run python -c "from app.modules.spec_workspace.model import SpecFileManifest; print('ok')"
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov（现有测试不回归）
constraints:
  - 表名 `spec_file_manifest`，不复用 `scan_documents`（D-011，BL-1）
  - migration down_revision 用 execute 时实际 alembic head，不能写死旧 head（多 change 并发 head 会推进）
  - 不引入 scan_docs 依赖（职责分离）
depends_on: []
allowed_paths:
  - backend/app/modules/spec_workspace/model.py
  - backend/migrations/versions/*.py
provides:
  - contract: spec_file_manifest_model
    fields: [SpecFileManifest, workspace_id, path, content_hash, version, exists, updated_at, ux(workspace_id,path)]
    desc: 增量清单表 ORM 模型，含字段与唯一索引
  - contract: spec_file_manifest_migration
    fields: [migration, table spec_file_manifest]
    desc: alembic 建表 migration
expects_from: []
```

## task-02

```yaml
id: task-02
title: spec_workspace/schema.py 增量 DTO（FileOp / Request / Response）
goal: 定义增量同步端点的请求/响应契约（design §7 接口定义逐字实现）
implementation: |
  1. `FileOp(BaseModel)`：`op: Literal["add","update","delete","rename"]` / `path: str` / `new_path: str | None`（rename 用）/ `hash: str | None`（SHA-256，add/update 用；rename 且 hash 相同可不传）/ `content: str | None`（base64，add/update 用）/ `base_version: int`
  2. `SpecIncrementalSyncRequest(BaseModel)`：`ops: list[FileOp]`
  3. `SpecIncrementalSyncResponse(BaseModel)`：`ok: bool` / `new_versions: dict[str, int]` / `conflict: bool = False` / `server_versions: dict[str, int] | None = None`
acceptance:
  - 三个 DTO 类存在，字段与 design §7 逐字一致
  - content 为 base64 字符串（文档写明），hash 为 SHA-256 hex
verify:
  - cd backend && uv run ruff check app/modules/spec_workspace/schema.py
constraints:
  - 纯 DTO 无 DB 依赖（可与 task-01 并行）
  - 不改旧 DTO（SpecWorkspaceRead 等）
depends_on: []
allowed_paths:
  - backend/app/modules/spec_workspace/schema.py
provides:
  - contract: spec_incremental_dto
    fields: [FileOp, SpecIncrementalSyncRequest, SpecIncrementalSyncResponse]
    desc: 增量同步端点请求/响应契约
expects_from: []
```

## task-03

```yaml
id: task-03
title: service.py apply_ops（add/update/delete/rename + base_version 409 + 软删 move + 备份区 + containment + .runtime 拒 + 写清单）+ 旧 tar 落盘失效 manifest
goal: 实现增量同步核心——apply_ops 落盘 + 乐观锁 + 软删备份，并让旧 tar 全量落盘失效文件级清单
implementation: |
  1. `apply_ops(workspace_id, ops) -> dict`：逐 op 处理，返回 `{"new_versions": {...}, "conflict": bool, "server_versions": {...} | None}`
  2. **containment 校验**（对齐旧 tar `_extract_spec_tar_to_staging:544-556`）：每个 `path`/`new_path` 先 `name.replace("\\","/")`，拒 `startswith("/")` 绝对路径与盘符（`name[1]==":"`），`(spec_root/name).resolve()` + `relative_to(spec_root_resolved)` 抛 ValueError 捕获 `..`/symlink 逃逸 → `_spec_bundle_invalid` 422
  3. `.runtime/` 拒：op.path 首段为 `.runtime` → 422（D-006）
  4. 逐 op 语义：
     - 查 `spec_file_manifest` 行（workspace_id+path）。**有行且 `row.version != op.base_version`** → conflict（收集 `server_versions[path]=row.version`，跳过不落盘）
     - **无行**（首推/旧 tar 失效后）→ R-07 hash 兜底：add/update 视为新建，version=1；delete 无行 → no-op 成功（幂等）；rename 无行 → 按 add new_path 处理
     - add/update：写盘（path 落 spec_root）+ upsert 清单（content_hash/version+1/exists=True/updated_at）
     - delete：**软删 move**——文件移出 spec_root 到 `spec_data_root/spec-backups/{ws}/{timestamp}/{path}`（`settings.spec_data_root` 取配置；备份目标同 containment 校验落 spec-backups 内），清单 exists=False + version+1；机会式修剪该 ws 备份区早于 30 天的旧 timestamp 目录（R-06）
     - rename：校验 new_path 同 containment → `shutil.move` 旧→新 + 清单 path 更新（version+1；hash 相同可保留原 content）
  5. **旧 tar 失效**：`_write_spec_root`（旧 tar 落盘点，apply_sync/import 共用）提交后 `DELETE FROM spec_file_manifest WHERE workspace_id=?` → 下一次增量全量重算（Q7/R-01）
  6. 校验失败不落盘、不写清单、不 commit 该 op；冲突 op 跳过其余照常 apply，整体返回 conflict=True + server_versions
acceptance:
  - add/update 写 spec_root + 清单 version+1；rename 移动 + 清单 path 更新；delete 文件移备份区 + exists=False + version+1
  - base_version 过期 → conflict=True + server_versions 返回服务器当前版本，冲突文件不落盘
  - `.runtime/*` / 越界 path（../、绝对路径、symlink）→ 422（对齐 service.py:544-556 校验逻辑）
  - 软删备份落 `spec_data_root/spec-backups/{ws}/{ts}/{path}`（spec_root 外，build_bundle rglob 不到）；30 天机会式修剪
  - 旧 tar `apply_sync` 后该 ws spec_file_manifest 行清空
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov
  - cd backend && uv run ruff check app/modules/spec_workspace/service.py
constraints:
  - containment 校验必须与 `_extract_spec_tar_to_staging:544-556` 机制一致（R-09），复用同一报错语义（422）
  - 软删是 move 不是 copy（D-010）；备份区在 spec_root 外（D-008/BL-2）
  - 冲突时部分 apply 不静默覆盖（NFR-02）；单成员快速路径天然成立（base_version 恒匹配）
  - spec_file_manifest 唯一写者=apply_ops，scan_docs reparse 不碰（D-011）
depends_on: [task-01, task-02]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
provides:
  - contract: apply_ops
    fields: [ops, base_version, new_versions, conflict, server_versions, soft_delete_move, backup_dir, containment, runtime_reject, hash_fallback]
    desc: 增量 op 应用 + 乐观锁 + 软删备份 + 路径校验
  - contract: old_tar_invalidates_manifest
    fields: [delete manifest rows on old tar push]
    desc: 旧 tar 全量落盘失效文件级清单（Q7）
expects_from:
  - contract: spec_file_manifest_model
    provider: task-01
  - contract: spec_incremental_dto
    provider: task-02
```

## task-04

```yaml
id: task-04
title: router.py 新增 POST /spec-workspace/sync-incremental 端点
goal: 暴露增量同步端点，409 时返回服务器当前版本供 daemon 侧提示冲突
implementation: |
  1. `router.py` 新增 `@router.post("/spec-workspace/sync-incremental", response_model=SpecIncrementalSyncResponse)`，路径前缀沿用 `/workspaces/{workspace_id}`（实际 URL `/api/workspaces/{wsId}/spec-workspace/sync-incremental`）
  2. 鉴权 `require_permission(Permission.WORKSPACE_WRITE)`（对齐现有 sync 端点）
  3. 调 `service.apply_ops(workspace_id, payload.ops)` → `SpecIncrementalSyncResponse`；conflict=True 时仍返回 200（body 带 conflict+server_versions，对齐 design §7——409 由 daemon 侧据 conflict 字段提示，端点不额外抛）
  4. 抛错：containment/.runtime 越界 → 422 AppError 透传
acceptance:
  - 端点存在且鉴权 WORKSPACE_WRITE
  - 正常返回 new_versions；冲突返回 conflict=True + server_versions
  - 越界 payload → 422
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov
  - cd backend && uv run ruff check app/modules/spec_workspace/router.py
constraints:
  - 路径前缀与现有 spec-workspace 端点一致；鉴权对齐 sync 端点
  - 不新增依赖 / 不改旧端点
  - design §7 接口定义为准（op/Request/Response 逐字一致）
depends_on: [task-02, task-03]
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
provides:
  - contract: sync_incremental_endpoint
    fields: [POST /api/workspaces/{wsId}/spec-workspace/sync-incremental, FileOp[], conflict, server_versions, new_versions]
    desc: 增量同步 HTTP 端点
expects_from:
  - contract: apply_ops
    provider: task-03
  - contract: spec_incremental_dto
    provider: task-02
```

## task-05

```yaml
id: task-05
title: 后端测试 tests/test_sync_incremental.py
goal: 覆盖增量端点全部行为，作为 execute/verify 回归锚点
implementation: |
  1. 新建 `backend/app/modules/spec_workspace/tests/test_sync_incremental.py`（参照 test_bundle_sync.py 的 _make_workspace/_make_spec_workspace 夹具模式 + httpx AsyncClient）
  2. 用例覆盖：
     - add/update：文件落 spec_root + 清单 version 递增 + content_hash 正确
     - rename：文件移动 + 清单 path 更新（含 new_path containment 校验）
     - delete：文件移出 spec_root 到 spec-backups/{ws}/{ts}/{path}（断言不在 spec_root 下）+ 清单 exists=False + version+1
     - base_version 过期 → conflict=True + server_versions 含服务器当前版本，冲突文件未落盘
     - .runtime/* op → 422
     - containment 越界（../、绝对路径、symlink 逃逸）→ 422
     - 备份目标越界（path 逃出 spec-backups）→ 422
     - 旧 tar apply_sync 后 spec_file_manifest 行清空 + 下一次增量 add 重建
     - 无行 op（R-07 兜底）：update 无行视为新建 version=1；delete 无行 no-op 成功
     - 备份 30 天机会式修剪（构造早于 30 天的备份目录断言被删）
acceptance:
  - test_sync_incremental.py 全部用例绿
  - 覆盖 design §7 全部语义 + R-07 兜底 + R-06 修剪 + Q7 旧 tar 失效
verify:
  - cd backend && uv run pytest app/modules/spec_workspace/tests/test_sync_incremental.py -q --no-cov
constraints:
  - 真实断言不 mock 绕过（CLAUDE.md 规则 11/18）
  - 不改测试逻辑本身来「通过」；若实现有缺陷回改实现
depends_on: [task-03, task-04]
allowed_paths:
  - backend/app/modules/spec_workspace/tests/test_sync_incremental.py
provides:
  - contract: backend_tests_green
    fields: [test_sync_incremental]
    desc: 增量端点行为回归锚点
expects_from:
  - contract: sync_incremental_endpoint
    provider: task-04
  - contract: spec_file_manifest_migration
    provider: task-01
```

## task-06

```yaml
id: task-06
title: hub-client.ts 新增 postSpecSyncIncremental（JSON POST）
goal: daemon 侧增量推送的 HTTP 客户端方法，409 冲突透传给调用方
implementation: |
  1. `hub-client.ts` 新增 `async postSpecSyncIncremental(wsId: string, ops: FileOp[]) -> { ok, new_versions, conflict, server_versions }`
  2. URL：`${baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/sync-incremental`；`Content-Type: application/json`；auth 头对齐现有 postSpecSync（X-API-Key / Bearer）
  3. JSON body：`{ ops }`（FileOp 字段与 backend schema 一致：op/path/new_path/hash/content/base_version）
  4. 返回解析；HTTP 非 2xx → 抛 HubHttpError（对齐 _request 语义）；conflict=True 不抛错，由调用方据字段提示
  5. 导出 FileOp 接口类型（或从 types.ts 引入）供 spec-sync.ts 复用
acceptance:
  - postSpecSyncIncremental 方法存在，JSON body + 正确 URL/auth
  - 返回含 ok/new_versions/conflict/server_versions
  - 非 2xx 抛 HubHttpError；conflict=True 不抛（返回体）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 不改现有 postSpecSync（旧 tar 路径保留）
  - FileOp 字段命名与 backend schema.py 逐字一致（避免 422）
depends_on: []
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
provides:
  - contract: postSpecSyncIncremental
    fields: [wsId, ops, new_versions, conflict, server_versions]
    desc: daemon 增量推送客户端方法
expects_from: []
```

## task-07

```yaml
id: task-07
title: spec-sync.ts postSpecSync 内部改增量 diff + 本地清单缓存移出 specDir + 回退旧 tar
goal: daemon 推送从整树 tar 改文件级增量 diff，首同步/回退仍走旧 tar
implementation: |
  1. `postSpecSync(client, wsId, specRoot)` 改：先读本地清单缓存 `~/.sillyhub/daemon/manifests/<wsId>.json`（路径取 `os.homedir()`，**移出 specDir**，BL-4/R-03）
  2. 缓存格式：`{ version, files: { [path]: { hash, version, mtime } } }`；mtime 用于 R-05（mtime 未变跳过重算 hash）
  3. **首同步**（无缓存文件）：走旧 tar `client.postSpecSync(wsId, tarBuf)`（packSpecDir 保留），成功后写本地清单缓存（全量快照 + version 对齐 server）
  4. **增量路径**：walk 本地 specDir → 逐文件 hash（mtime 未变复用缓存）→ 与缓存 diff：
     - 新文件 → add op；内容变 → update op；缓存有本地无 → delete op
     - **rename 检测**：内容 hash 相同但路径变的文件对（旧路径消失 + 新路径出现同 hash）→ rename op（不重传内容，R-02 注意 Windows 大小写）
     - `.runtime/`（有点）与 `runtime/`（无点）/`worktrees` 跳过（对齐 packSpecDir 排除逻辑，D-006）
  5. op 带 per-file base_version（缓存里该文件 version；缓存无 → 0）
  6. `client.postSpecSyncIncremental(wsId, ops)`：
     - 成功 → 按 new_versions 更新本地缓存 version
     - `conflict=True` → 抛 SpecPushConflict（调用方 syncSpecTreeIfNeeded catch 后 warn 不阻塞，人工拍板 NFR-02）
     - 404（旧后端无端点）/ 网络失败 / 端点错误 → **回退旧 tar** `client.postSpecSync(wsId, tarBuf)`
  7. 缓存写失败 try/catch warn（不阻塞推送主流程）；本地缓存与 specDir 分离后 pull 的 rm -rf specDir 不清缓存
acceptance:
  - postSpecSync 首同步走旧 tar + 写缓存；之后走增量 diff（仅变化 op）
  - 本地清单缓存在 `~/.sillyhub/daemon/manifests/<wsId>.json`（不在 specDir 内）
  - 增量 404/失败回退旧 tar；conflict 抛错不静默覆盖
  - rename 检测（同 hash 异路径）+ .runtime 排除
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/spec-sync.test.ts tests/spec-transport-tar-sync/spec-sync.test.ts（现有测试同步更新契约断言）
constraints:
  - 不改 pull 侧（build_bundle/pullSpecBundle，NG-04）；packSpecDir 保留（首同步/回退用）
  - 现有测试 `spec-transport-tar-sync/`、`task-09-spec-pull-push.test.ts` 锁定 postSpecSync 契约（含 `.runtime` 有点 push），本任务更新其断言为新行为（增量默认 + 旧 tar 回退），不删测试逻辑
  - rename 检测兼容 Windows 大小写不敏感（R-02）
depends_on: [task-06]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
provides:
  - contract: incremental_diff_push
    fields: [local hash diff, ops, base_version, rename detection, old tar fallback, first sync full]
    desc: daemon 增量 diff 推送 + 首同步/回退
  - contract: local_manifest_cache
    fields: [~/.sillyhub/daemon/manifests/<ws>.json, hash, version, mtime]
    desc: 本地清单缓存（移出 specDir）
expects_from:
  - contract: postSpecSyncIncremental
    provider: task-06
```

## task-08

```yaml
id: task-08
title: daemon 测试（diff 客户端 / 缓存位置 / rename / 回退）
goal: 覆盖 task-06/07 的增量 diff 行为，作为回归锚点
implementation: |
  1. 新建/扩展 `sillyhub-daemon/tests/` 下 spec-sync 增量用例（参照 spec-transport-tar-sync/spec-sync.test.ts mock 模式）
  2. 用例覆盖：
     - 首同步（无缓存）走 client.postSpecSync（旧 tar）且写缓存
     - 有缓存：新增→add op / 修改→update op / 删除→delete op / 同 hash 异路径→rename op
     - op 带 base_version（缓存 version；无缓存 0）；.runtime 排除
     - 缓存文件路径在 `~/.sillyhub/daemon/manifests/`（mock homedir 断言）
     - 增量 404 → 回退 client.postSpecSync（旧 tar）；conflict=True → 抛错不静默
     - new_versions 回写缓存 version
acceptance:
  - 全部用例绿
  - 覆盖首同步/增量 diff/rename/.runtime/回退/conflict/缓存回写
verify:
  - cd sillyhub-daemon && pnpm exec vitest run <新增文件>（或主批+maxForks=1 策略，见 local.yaml）
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 真实断言；fragile 3 文件（task-09-spec-pull-push / spec-transport-tar-sync / daemon-borrow-sandbox）按 local.yaml 独占策略跑
depends_on: [task-07]
allowed_paths:
  - sillyhub-daemon/tests/**
provides:
  - contract: daemon_tests_green
    fields: [incremental diff, cache, rename, fallback]
    desc: daemon 增量同步测试全绿
expects_from:
  - contract: incremental_diff_push
    provider: task-07
```

## task-09

```yaml
id: task-09
title: 兼容收尾（旧 tar 端点保留核验 / 单成员快速路径 / .runtime 垃圾行可选清洗 / P2 R-04+R-06 落盘验收）
goal: 收尾兼容性与 P2 决策验收，确认旧客户端可用、无回归
implementation: |
  1. **旧 tar 端点保留核验**：确认 `POST /spec-workspace/sync`（tar 流 apply_sync）未改仍可用；旧 daemon/旧客户端走旧 tar 行为不变（R-01 兼容）
  2. **单成员快速路径**：单成员 workspace 下 base_version 恒匹配，增量不冲突（用例断言）
  3. **P2 落盘验收**：R-04 软删仅恢复文件内容不恢复 Change 行工作流状态（test_sync_incremental 已有断言）；R-06 备份 30 天修剪（task-03 实现，此处验收）
  4. **.runtime 垃圾 ScanDocument 行可选清洗**（FR-06 可选）：现状旧 tar 曾给 `.runtime/*` 建垃圾 ScanDocument 行（service.py:663-676 无过滤），若本次测试暴露存在则补过滤；否则记录为已知残留不扩范围（NG-03）
acceptance:
  - 旧 tar 端点可用（apply_sync 回归测试绿）
  - 单成员增量不冲突（用例绿）
  - R-04/R-06 落盘决策在 plan「关键落盘决策」记录且实现验证通过
  - .runtime 垃圾行：有则清洗，无则记录为已知残留（不扩范围）
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov
constraints:
  - 不改旧 tar 端点契约（R-01 兼容）；NG-03 不为 .runtime 垃圾行扩范围（除非本次直接暴露）
  - P2 决策以「关键落盘决策」节为准，不在此 re-litigate
depends_on: [task-05, task-07]
allowed_paths:
  - backend/app/modules/spec_workspace/tests/test_sync_incremental.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/scan_docs/service.py
provides:
  - contract: compat_verified
    fields: [old tar retained, single member fast path, P2 recorded, runtime garbage optional]
    desc: 兼容性 + P2 决策验收
expects_from:
  - contract: backend_tests_green
    provider: task-05
  - contract: incremental_diff_push
    provider: task-07
```
