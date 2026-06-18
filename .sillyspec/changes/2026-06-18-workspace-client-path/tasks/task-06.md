---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-06
title: "spec bundle/sync 端点（GET bundle / POST sync）"
priority: P0
depends_on: []
blocks: [task-09]
requirement_ids: [FR-05]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
---

# task-06 — spec bundle/sync 端点（GET bundle / POST sync）

> 注：任务清单 `tasks.md` 把本项标为 task-04，`plan.md` 任务总表标为 task-06。本文件以 plan.md 为准，编号 `task-06`。

## 1. 目标

为 daemon-client workspace 的 agent run / scan 派发提供 **spec 下发与回传**的中转端点。spec 真理源始终在服务器（D-003@v1），daemon 执行时按需借阅、执行后整树回传（D-006@v1，方案 A）。

- `GET  /api/workspaces/{workspace_id}/spec-workspace/bundle` → 打包服务器 `spec_root`（`{SPEC_DATA_ROOT}/{workspace_id}`，即 `.sillyspec` 托管目录）为 `application/x-tar` 流，排除 `.runtime/`。
- `POST /api/workspaces/{workspace_id}/spec-workspace/sync` body=`application/x-tar` → 解包覆盖服务器 `spec_root` → 调 `scan_docs.reparse(workspace_id)` 刷新 → 返回 `{ "ok": true, "reparsed": <int> }`。

## 2. 覆盖来源

| 来源 | 段落 | 关键约束 |
|---|---|---|
| requirements.md | FR-05 | bundle 拉 tar、解到 daemon 本地 `~/.sillyhub/daemon/specs/{ws_id}`；sync 整树 tar 回传，覆盖 + reparse；前端/列表始终读服务器真理源 |
| design.md §5 Phase 4 | spec 按需下发/回传 | backend bundle 打包服务器 spec_root；sync 覆盖 + reparse scan_docs |
| design.md §6 文件清单 L71-72 | router 新增 bundle/sync；service 新增 `build_bundle`/`apply_sync` | |
| design.md §7.2 | 端点签名与返回 | bundle `200 application/x-tar` 排除 `.runtime`；sync `200 {ok, reparsed}` |
| decisions.md D-003@v1 | spec 服务器平台托管 | 真理源 = backend `spec_root = {SPEC_DATA_ROOT}/{ws_id}`，daemon 不长期持有 |
| decisions.md D-006@v1 | spec 按需 bundle/sync | 整树覆盖（项目未上线，不做 diff）；不引入同步引擎 |
| design.md §3 非目标 | 不做 diff/冲突合并 | 整树覆盖即可 |

## 3. URL 与路径语义澄清（重要）

- 现状 `spec_workspace/router.py` 挂在 `main.py` 的 `include_router(spec_workspace_router, prefix="/api")`，router 自身 `prefix="/workspaces/{workspace_id}"`。
- design.md §7.2 写的是 `/api/spec-workspaces/{ws_id}/bundle`，但**实际挂载点是 `/api/workspaces/{workspace_id}/spec-workspace/...`**（与现有 `get_spec_workspace` / `import` / `sync` stub 端点同前缀）。本任务沿用现有挂载方式，URL 形态为：
  - `GET  /api/workspaces/{workspace_id}/spec-workspace/bundle`
  - `POST /api/workspaces/{workspace_id}/spec-workspace/sync`
- **`{workspace_id}` 含义 = 上层 workspace UUID**（不是 spec_workspace.id）。理由：
  1. daemon execution-context 仅透传 `workspace_id`（design §5 Phase 4、`agent/router.py:60` 现状），daemon 手里没有 spec_workspace.id。
  2. `scan_docs/service.py:reparse(workspace_id)` 以 workspace_id 为入参，现有 scan_docs/spec_workspace 调用链均以 workspace_id 为根。
  3. `SpecWorkspaceService.get(workspace_id)` 现状就是按 workspace_id 解析 spec_workspace 记录（`service.py:84-95`）。
- 端点内通过 `SpecWorkspaceService(session).get(workspace_id)` 解析到 spec_workspace，再取 `spec_ws.spec_root`。
- 现有 `POST .../spec-workspace/sync`（stub，返回 `SpecWorkspaceRead`）与本任务新增的 `POST .../spec-workspace/bundle` 同路径前缀但**子路径不同**（`/sync` 已存在）。处理方式见 §7 边界处理 / §8 修改文件清单 —— stub `sync` 与新 sync 语义冲突，本任务**用 body 区分**：保留旧 stub 端点路径不动（它未来由 Phase 5/其他任务清理），新 sync 端点采用 **`/sync` 同路径但覆盖原 stub 实现**（因为 stub 无实际功能且任务 allowed_paths 仅 router/service）。具体见 §8「修改文件」决策。

## 4. 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/spec_workspace/router.py` | 新增 `GET .../spec-workspace/bundle`（StreamingResponse）；**重写** `POST .../spec-workspace/sync`（接收 `application/x-tar` body，调 `apply_sync`，返回 `{ok, reparsed}`）。新增响应 DTO `SpecSyncResponse`（内联于 router.py，避免改 schema.py 超出 allowed_paths） |
| 修改 | `backend/app/modules/spec_workspace/service.py` | 新增 `async def build_bundle(self, workspace_id) -> tuple[str, Iterator[bytes]]`（返回 spec_root 绝对路径 + tar 字节流生成器）；新增 `async def apply_sync(self, workspace_id, tar_bytes: bytes) -> int`（覆盖 spec_root + reparse，返回 reparse 统计） |

> 不改 `schema.py`（超出 allowed_paths）。`SpecSyncResponse` 作为 Pydantic BaseModel 定义在 router.py 顶部。
> 不改 `model.py`（spec_workspaces 表结构不变，D-003 明确真理源路径沿用现有 `spec_root`）。

## 5. 接口定义

### 5.1 端点签名

```python
# router.py

from fastapi.responses import StreamingResponse
from pydantic import BaseModel

class SpecSyncResponse(BaseModel):
    ok: bool
    reparsed: int


@router.get("/spec-workspace/bundle")
async def download_spec_bundle(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> StreamingResponse:
    """打包服务器 spec_root 为 tar 流（排除 .runtime/）。"""
    service = SpecWorkspaceService(session)
    spec_root, tar_stream = await service.build_bundle(workspace_id)
    return StreamingResponse(
        tar_stream,
        media_type="application/x-tar",
        headers={
            "Content-Disposition": f'attachment; filename="spec-bundle-{workspace_id}.tar"',
            "X-Spec-Root": spec_root,
        },
    )


@router.post("/spec-workspace/sync")
async def upload_spec_sync(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
    tar_bytes: bytes = Body(..., media_type="application/x-tar"),
) -> SpecSyncResponse:
    """接收 daemon 执行后的整树 tar，覆盖服务器 spec_root 并 reparse。"""
    service = SpecWorkspaceService(session)
    reparsed = await service.apply_sync(workspace_id, tar_bytes)
    return SpecSyncResponse(ok=True, reparsed=reparsed)
```

> 权限：bundle 用 `WORKSPACE_READ`（只读下发，与 `get_spec_workspace` 一致）；sync 用 `WORKSPACE_WRITE`（覆盖写，与现有 stub `sync` 端点权限一致）。
> Body 读取：使用 `Body(..., media_type="application/x-tar")` 让 FastAPI 注入原始 bytes；避免大文件 JSON 反序列化。daemon 端 `Content-Type: application/x-tar`。

### 5.2 build_bundle 伪代码

```python
# service.py
import io, tarfile

async def build_bundle(
    self, workspace_id: uuid.UUID
) -> tuple[str, "Iterator[bytes]"]:
    """打包服务器 spec_root 为 tar 字节流（排除 .runtime/）。

    返回 (spec_root 绝对路径, tar 字节流生成器)。
    """
    spec_ws = await self.get(workspace_id)          # SpecWorkspaceNotFound → 404
    spec_root = Path(spec_ws.spec_root)

    # spec_root 不存在 → 视为空 bundle（合法，daemon 解包即创建）
    if not spec_root.exists():
        spec_root.mkdir(parents=True, exist_ok=True)

    def _gen() -> Iterator[bytes]:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w|") as tar:  # 流式追加
            for path in sorted(spec_root.rglob("*")):
                # 路径过滤：跳过 .runtime/（顶层或任意层）
                rel = path.relative_to(spec_root)
                if any(part == ".runtime" for part in rel.parts):
                    continue
                if path.is_dir() and not any(path.iterdir()):
                    # 保留空目录条目（tarfile 会自动处理 add 的目录）
                    pass
                tar.add(path, arcname=str(rel), recursive=False)
            tar.close()
        buf.seek(0)
        yield from _chunked(buf)

    return str(spec_root), _gen()
```

- 用 `tarfile.open(mode="w|")`（流式，不可随机寻址）保证可逐块发送；或用 `w` 模式写入 BytesIO 后整体返回（简单实现，后续大目录再优化）。
- arcname 用相对路径（解包到 spec_root 即还原结构）。
- `.runtime/` 过滤：`any(part == ".runtime" for part in rel.parts)` —— 覆盖顶层 `.runtime/` 与嵌套 `.runtime/`。

### 5.3 apply_sync 伪代码

```python
# service.py
import io, tarfile, shutil, tempfile

async def apply_sync(
    self, workspace_id: uuid.UUID, tar_bytes: bytes
) -> int:
    """解包 tar 覆盖服务器 spec_root + reparse scan_docs。

    整树覆盖（D-006@v1，项目未上线不做 diff）。
    返回 reparse 统计（parsed 数）。
    """
    spec_ws = await self.get(workspace_id)          # SpecWorkspaceNotFound → 404
    spec_root = Path(spec_ws.spec_root)
    spec_root.mkdir(parents=True, exist_ok=True)

    # 1. 校验 tar + 路径穿越防护
    try:
        tf = tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*")
    except tarfile.TarError as e:
        raise SpecBundleInvalid(
            "Invalid tar payload.",
            details={"reason": str(e)},
        ) from e

    members = tf.getmembers()
    for m in members:
        # 禁绝对路径 / 盘符 / .. 穿越
        name = m.name.replace("\\", "/")
        if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
            raise SpecBundleInvalid(
                "Absolute path in tar is not allowed.",
                details={"member": m.name},
            )
        # 规范化后再次校验不逃逸 spec_root
        target = (spec_root / name).resolve()
        try:
            target.relative_to(spec_root.resolve())
        except ValueError:
            raise SpecBundleInvalid(
                "Tar member escapes spec_root.",
                details={"member": m.name},
            )

    # 2. 原子覆盖：先解包到临时目录，再 swap（失败可回滚）
    staging = Path(tempfile.mkdtemp(prefix="spec-sync-"))
    try:
        tf.extractall(staging)                       # safe：已校验所有 member
        tf.close()

        # 清空旧 spec_root（保留 .runtime/，sync 不动 daemon 运行态缓存）
        runtime_dir = spec_root / ".runtime"
        runtime_bak = None
        if runtime_dir.exists():
            runtime_bak = Path(tempfile.mkdtemp(prefix="runtime-bak-"))
            shutil.move(str(runtime_dir), str(runtime_bak / ".runtime"))

        # 清空 + 拷入新树
        for child in spec_root.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

        for child in staging.iterdir():
            shutil.move(str(child), str(spec_root / child.name))

        # 还原 .runtime
        if runtime_bak is not None:
            shutil.move(str(runtime_bak / ".runtime"), str(runtime_dir))
            shutil.rmtree(runtime_bak, ignore_errors=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    # 3. 更新 sync_status + reparse
    spec_ws.sync_status = "clean"
    spec_ws.last_synced_at = datetime.now(UTC)
    spec_ws.updated_at = datetime.now(UTC)
    await self._session.commit()

    # reparse（scan_docs 以 workspace_id 为入参）
    from app.modules.scan_docs.service import ScanDocsService
    scan_svc = ScanDocsService(self._session)
    stats, _ = await scan_svc.reparse(workspace_id)
    return int(stats.get("parsed", 0))
```

- 解包前**全量校验**所有 member 路径（防 Zip Slip / Tar Slip），校验失败抛 `SpecBundleInvalid`（新增 AppError 子类，422）。由于 `SpecBundleInvalid` 在 errors.py 定义会超出 allowed_paths，**实际实现方案**：复用现有 `AppError` 实例构造（`AppError("...", code="HTTP_422_SPEC_BUNDLE_INVALID", http_status=422, details=...)`），不新增类。task 文档里写明此约束。
- `.runtime/` 在 sync 覆盖时**保留**（daemon 运行态缓存，非 spec 数据）。
- 原子 swap：临时目录中转，失败可回滚（R-03 并发写：项目未上线、单 workspace 串行执行，可接受不加版本号）。
- 循环导入规避：`ScanDocsService` 延迟到函数内 import（`scan_docs/service.py:88` 已对 `SpecWorkspaceService` 做相同处理）。

## 6. 设计决策（任务级）

| 决策 | 选择 | 理由 |
|---|---|---|
| URL 用 workspace_id 还是 spec_workspace.id | **workspace_id** | daemon 仅持有 workspace_id；reparse 以 workspace_id 为入参；与现有端点前缀一致 |
| sync 整树覆盖还是 diff | **整树覆盖** | D-006@v1 明确；项目未上线（CLAUDE.md 规则7）；YAGNI |
| bundle 排除什么 | `.runtime/` | design §7.2 + R-02；运行态缓存不属于 spec 数据 |
| sync 是否覆盖 `.runtime/` | **保留不动** | daemon 运行态缓存，非 spec 数据；sync 只接管 spec 树 |
| tar 流式还是整包 | 流式（`w|`）+ 分块 yield | R-02 大目录性能；StreamingResponse 天然支持 |
| 响应 DTO 放哪 | router.py 内联 | allowed_paths 不含 schema.py |
| 错误类 | 复用 `AppError` 实例 + 现有 `SpecWorkspaceNotFound`/`SpecConflictNotFound` 风格 | allowed_paths 不含 errors.py |

## 7. 边界处理（≥5 条）

| # | 场景 | 处理 | 返回 |
|---|---|---|---|
| 1 | spec_workspace 记录不存在（`SpecWorkspaceService.get` 抛 `SpecWorkspaceNotFound`） | 不捕获，冒泡 → 现有错误处理器 | **404** `HTTP_404_SPEC_WORKSPACE_NOT_FOUND` |
| 2 | spec_root 目录不存在或为空（bundle） | `mkdir(parents=True, exist_ok=True)` 后打包（空 tar 合法，daemon 解包即建空目录） | **200** 空 tar 流 |
| 3 | sync body 非 tar / 损坏（`tarfile.TarError`、`ReadError`、`EOFError`） | 捕获 → `AppError(code="HTTP_422_SPEC_BUNDLE_INVALID", http_status=422, details={"reason": str(e)})` | **422** |
| 4 | sync tar 含**绝对路径**（`/foo`、`C:\bar`）或 `..` 穿越 | 解包前全量校验 member.name → 抛 `HTTP_422_SPEC_BUNDLE_INVALID` details={member}；**不写盘** | **422** |
| 5 | sync 解包中途失败（磁盘满 / 权限） | 临时目录中转，旧 spec_root 未被清空前不破坏；`finally` 清理 staging；spec_root 保持原状 | 抛 500（内部错误，日志记录） |
| 6 | reparse 失败（scan_docs 内部异常） | apply_sync 已 commit sync_status=clean；reparse 抛错 → 回滚？**不回滚 sync_status**（spec 文件已覆盖成功，reparse 是后置刷新），日志告警，向前端返回 500 + 已覆盖提示；或更保守：reparse 异常则把 sync_status 回滚为 dirty。**任务建议**：reparse 失败不回滚文件覆盖（文件已是真理源），sync_status 置回 `dirty` 并 500 | **500**（sync_status=dirty） |
| 7 | tar body 过大（> 内存阈值，如 256MB） | 可选：FastAPI `Body` 无原生大小限制；任务级**不实现硬限制**（daemon 整树 spec 通常 <100MB，R-02 监控），但在日志记录 payload 大小；后续如需可加 `Content-Length` 预检 | 记录但不阻塞 |
| 8 | spec_root 含符号链接指向外部 | bundle：tarfile 默认跟随符号链接？**不跟随**（`tar.add` 默认 `recursive=True` 但 symlink 以 link 形式记录，除非 `follow_symlinks=True`）。本任务**默认行为即可**，不在 task 范围额外处理；sync 解包符号链接照原样还原（已在路径校验内，逃逸即拒） | 默认 |

## 8. 非目标（本任务不做）

- ❌ 不做 spec diff / 冲突合并（D-006@v1 明确整树覆盖；design §3）。
- ❌ 不做 bundle 增量 / 版本号（YAGNI，R-03 后续按需）。
- ❌ 不做 sync 并发写锁（项目未上线，单 workspace 串行执行；R-03 接受）。
- ❌ 不改 `schema.py` / `model.py` / `errors.py`（超出 allowed_paths；响应 DTO 内联 router，错误用 AppError 实例）。
- ❌ 不实现 bundle 内容大小硬限制（监控而非阻断）。
- ❌ 不清理旧 `POST .../spec-workspace/sync` stub 的其他调用方（本任务**覆盖** stub 实现，stub 无实际功能可安全替换；若其他代码依赖 stub 返回 `SpecWorkspaceRead`，需在实现前全局 grep 确认无调用 —— 见 §10 TDD 前置检查）。
- ❌ 不实现 daemon 端拉取/回传（那是 task-09，本任务仅 backend 端点）。

## 9. 与现有 stub sync 端点的冲突处理（关键）

现状 `router.py:85-102` 有 `POST .../spec-workspace/sync` 返回 `SpecWorkspaceRead`（stub，`service.sync()` 仅改 sync_status）。本任务要新增同路径 `POST .../spec-workspace/sync` 但语义不同（接 tar body）。

**处理方案（在 §8 allowed_paths 内）**：
1. **实现前先 grep**：确认 frontend / daemon / 其他后端代码**无任何代码调用**旧 stub `sync` 端点（旧 stub 是 dead code，design §3 / plan 都把同步引擎列为非目标）。
2. 若确认无调用 → **直接覆盖** router 的 `sync` 端点实现（改为接 tar body）+ **删除/改写** `service.sync()` stub（改为 `apply_sync` 的薄封装，或直接移除并在 router 调 `apply_sync`）。
3. 若有调用 → 报告冲突，不在本 task 内私自改 API 契约（escalate 到 plan 阶段）。

`import_from_repo` stub 保持不动（不在本任务范围）。

## 10. TDD 实现顺序

遵循 CLAUDE.md 执行顺序：**文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收**。

测试文件：`backend/app/modules/spec_workspace/tests/test_bundle_sync.py`（注意：allowed_paths 仅列 router/service，但测试文件惯例放在 `tests/` 下，且测试是验证实现必需。**任务 allowed_paths 应扩展包含测试文件** —— 若严格执行 allowed_paths，则测试需归入 task-06 但路径未声明；本 task 文档标注此点，建议 plan/execute 阶段确认测试文件是否纳入 allowed_paths 或单独 task。）

### 10.1 前置检查（实现前 grep）
```
grep -rn "spec-workspace/sync\|\.sync(workspace_id" backend/app frontend/src sillyhub-daemon/src
```
确认旧 stub 无调用方。

### 10.2 测试用例（pytest + httpx AsyncClient，参考 test_backfill.py 模式）

| 用例 | 输入 | 期望 |
|---|---|---|
| `test_bundle_returns_tar_stream` | spec_root 下有 `docs/A.md`、`.runtime/cache.log` | 200，`content-type=application/x-tar`，解 tar 后含 `docs/A.md`、**不含** `.runtime/` |
| `test_bundle_empty_spec_root` | spec_root 不存在 | 200，空 tar（无 member 或仅根目录） |
| `test_bundle_workspace_not_found` | workspace_id 无对应 spec_workspace | 404 `HTTP_404_SPEC_WORKSPACE_NOT_FOUND` |
| `test_sync_overwrites_and_reparses` | spec_root 有旧 `docs/A.md`，sync tar 含 `docs/B.md` | 200 `{ok:true, reparsed:1}`；spec_root 下 `docs/B.md` 存在、`docs/A.md` 已删；scan_docs 表更新（mock reparse 或用真实 parser） |
| `test_sync_preserves_runtime_dir` | spec_root 有 `.runtime/x.log`，sync tar 不含 `.runtime` | sync 后 `.runtime/x.log` 仍在 |
| `test_sync_invalid_tar` | body=`b"not a tar"` | 422 `HTTP_422_SPEC_BUNDLE_INVALID` |
| `test_sync_rejects_absolute_path` | tar 含 member name `/etc/passwd` | 422，spec_root 未被修改 |
| `test_sync_rejects_path_traversal` | tar 含 `../../escape` | 422，spec_root 未被修改 |
| `test_sync_workspace_not_found` | workspace_id 无对应 spec_workspace | 404 |
| `test_sync_requires_write_permission` | 无 WORKSPACE_WRITE 权限用户 | 403 |
| `test_bundle_requires_read_permission` | 无 WORKSPACE_READ 权限用户 | 403 |

### 10.3 实现顺序
1. 写测试（红）：先写 `test_bundle_*` 3 个 + `test_sync_*` 6 个。
2. 实现 `build_bundle`（绿 bundle 部分）。
3. 实现 `apply_sync`（绿 sync 部分）。
4. 覆盖 router sync stub（§9 确认无调用后）。
5. 跑 `uv run pytest backend/app/modules/spec_workspace/tests/test_bundle_sync.py`。
6. 跑 `uv run ruff check backend/app/modules/spec_workspace`。
7. 对照 §12 验收表逐项核对。

## 11. 实现要求（硬性）

- **流式**：bundle 用 `StreamingResponse` + tarfile `w|` 模式，不一次性把整树读进内存（R-02）。
- **路径安全**：sync 解包前全量校验所有 member，禁绝对路径 / 盘符 / `..`；校验通过才写盘。
- **原子性**：sync 用临时目录中转 + swap，旧 spec_root 在新树完整就绪前不被清空。
- **保留 `.runtime/`**：bundle 排除、sync 不覆盖。
- **不引入新同步引擎**：纯 pull/push，无 diff/merge（D-006）。
- **不新增 errors.py 类**：用 `AppError` 实例 + `code`/`http_status` 覆盖（allowed_paths 约束）。
- **不改 schema.py/model.py**：响应 DTO 内联 router.py。
- **reparse 入参对齐**：用 `workspace_id`（与 `scan_docs/service.py:reparse(workspace_id)` 一致），不用 spec_workspace.id。
- **循环导入规避**：`ScanDocsService` 在 `apply_sync` 函数内 import（镜像 `scan_docs/service.py:88` 对 `SpecWorkspaceService` 的延迟 import）。

## 12. 验收表

| # | 验收项 | 通过标准 | 关联 FR/D |
|---|---|---|---|
| 1 | `GET .../spec-workspace/bundle` 返回 `application/x-tar` 流 | 200，content-type 正确，可被 `tarfile.open` 正常解析 | FR-05, D-003 |
| 2 | bundle 排除 `.runtime/` | 解 tar 后无任何 `.runtime` 路径成员 | FR-05, design §7.2 |
| 3 | bundle 对 spec_workspace 不存在返回 404 | `HTTP_404_SPEC_WORKSPACE_NOT_FOUND` | FR-05 |
| 4 | bundle 对空 spec_root 返回 200 空 tar | 不报错，daemon 可解包 | FR-05, §7 边界 2 |
| 5 | `POST .../spec-workspace/sync` 整树覆盖成功 | spec_root 内容 == tar 内容（旧文件删除、新文件写入） | FR-05, D-006 |
| 6 | sync 后调用 `scan_docs.reparse` | `{ok:true, reparsed:N}`，N == reparse parsed 统计 | FR-05, D-006 |
| 7 | sync 保留 `.runtime/` | sync 后 `.runtime/` 内容不变 | design §7.2, §7 边界 |
| 8 | sync 拒绝绝对路径 tar | 422 `HTTP_422_SPEC_BUNDLE_INVALID`，spec_root 未变 | §7 边界 4 |
| 9 | sync 拒绝路径穿越 tar | 422，spec_root 未变 | §7 边界 4 |
| 10 | sync 损坏 tar 返回 422 | `HTTP_422_SPEC_BUNDLE_INVALID` | §7 边界 3 |
| 11 | 权限：bundle 需 WORKSPACE_READ，sync 需 WORKSPACE_WRITE | 无权限 403 | 现有权限模型 |
| 12 | 旧 stub `POST .../sync`（返回 SpecWorkspaceRead）已被新实现替换，且无调用方报错 | grep 确认 + 测试通过 | §9 |
| 13 | `uv run ruff check backend/app/modules/spec_workspace` 通过 | 无 lint 错误 | 全局验收 |
| 14 | `uv run pytest backend/app/modules/spec_workspace/tests/test_bundle_sync.py` 通过 | 全绿 | TDD |
| 15 | 全局：`uv run ruff check . && uv run pytest` 通过 | 不破坏其他测试 | plan 全局验收 |
| 16 | 不改 schema.py / model.py / errors.py | diff 范围仅 router.py + service.py（+ 测试文件） | allowed_paths |
| 17 | 循环导入：apply_sync 内 import ScanDocsService 不触发循环 | 导入无 `ImportError` | §11 实现要求 |

## 13. 依赖关系

- **depends_on**: []（本任务独立，spec_workspace model/service 现状已具备 `get`/`spec_root`）
- **blocks**: [task-09]（daemon 端 `getSpecBundle(ws_id)` / `postSpecSync(ws_id, tar)` 调用本任务端点；task-09 实现前本端点必须就绪）

## 14. 与其他任务的接口契约（供 task-09 对齐）

task-09（daemon task-runner）将调用：
- `GET  {HUB}/api/workspaces/{workspace_id}/spec-workspace/bundle`
  - 认证：daemon token（现有 daemon 认证）
  - 响应：`application/x-tar` 流
- `POST {HUB}/api/workspaces/{workspace_id}/spec-workspace/sync`
  - body：`application/x-tar`（整树，相对路径，含 `.sillyspec` 子树）
  - 响应：`200 {"ok": true, "reparsed": <int>}`

`workspace_id` 来自 execution-context（daemon 收到的 lease_meta / execution_context）。

## 15. 备注

- tasks.md 主清单编号（task-04）与 plan.md 任务总表编号（task-06）不一致，本文件以指令指定 + plan.md 为准 = `task-06`。
- 测试文件 `test_bundle_sync.py` 是否纳入 allowed_paths：建议 execute 阶段确认（CLAUDE.md 执行顺序要求写测试，测试文件属合理产物）。
- 未来若 server-local 也需 bundle/sync（目前仅 daemon-client 用），本端点天然兼容（spec_root 服务器路径对两类 workspace 均有效）。
