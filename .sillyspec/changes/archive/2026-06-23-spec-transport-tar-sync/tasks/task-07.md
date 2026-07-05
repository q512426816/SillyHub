---
id: task-07
title: 核实 spec-workspace/sync 端点放行 + apply_sync 复用 + 回退路径（覆盖：FR-07, D-005@v1, R-05）
priority: P0
estimated_hours: 1
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-07：核实 `/spec-workspace/sync` 端点放行 + `apply_sync` 复用 + 回退路径

## 修改文件

| 文件 | 预期改动 | 依据 |
|---|---|---|
| `backend/app/modules/spec_workspace/router.py` | **预计零改动**（核实后确认）。若 R-05 核实发现端点确有 platform-managed/tar 限制则补放行；当前代码核实为「用户级权限 WORKSPACE_WRITE，无策略过滤」已放行。 | design §6「确认/微调」、§10 R-05 |
| `backend/app/modules/spec_workspace/service.py` | **零改动**。`apply_sync`（行 288-398）已是完整实现（whole-tree overwrite + reparse + Tar Slip 防护），tar 回传直接复用。 | design §6「确认 无改动复用」、§7.4 契约表 |

> 本任务以「核实」为主，预期无代码产出。改动窗口留给 R-05 核实失败时的兜底放行（当前核实结论：无需改动）。

## 覆盖来源

- **FR-07**：scan tar 回传能正确落到 backend 权威源 `/data/{ws}` 并 reparse 入库（端点放行 + apply_sync 复用的功能诉求）。
- **D-005@v1**：数据可清不做迁移——切换 transport 出问题时清 `SPEC_TRANSPORT` 回退 shared + 重 scan 即可，实现不含任何迁移逻辑。
- **R-05**（design §10）：`/spec-workspace/sync` 端点可能限制为 daemon-client，platform-managed + tar 需放行——本 task 在 plan 阶段核实当前代码。
- 关联文档：design §4（拆分判断）、§7.4（生命周期契约表 apply_sync 行）、§9（兼容策略 + 回退路径）、§10 R-05、§13（X-001 已修正）；decisions.md D-005@v1；plan.md task-07 行。

## 实现要求

### 1. 核实端点放行（R-05）—— 以**当前代码**为准，spec_workspace.md 文档过时不可信

对 `router.py:117-136` 的 `sync_spec_workspace` 端点逐项核实：

1. **权限 `Permission.WORKSPACE_WRITE` 是否覆盖 tar 回传**：
   - 当前代码 `Depends(require_permission(Permission.WORKSPACE_WRITE))`（router.py:124）—— 这是**用户级权限**校验，任何持有该权限的认证用户均可调用。
   - daemon 回传由 backend→daemon claim 时下发的认证身份/服务令牌承担，端点本身不做 daemon-only 限制。
   - **结论**：权限层不阻拦 tar 回传，覆盖。
2. **是否对 `strategy=platform-managed` 放行**：
   - 当前代码端点签名仅取 `workspace_id`（路径参数），**不读 `SpecWorkspace.strategy`**，无 `if strategy == 'daemon-client'` 类过滤。
   - 任意 strategy（platform-managed / repo-mirrored / repo-native / daemon-client）的 workspace_id 均可调端点 → service.apply_sync。
   - **结论**：platform-managed 已天然放行。
3. **是否限制为 daemon-client（R-05 担心点）**：
   - grep 核实：端点函数体无 `strategy` / `daemon-client` 关键字，无 daemon-client 分支判断。
   - `service.apply_sync` 内部也不校验 strategy，直接操作 `spec_ws.spec_root`。
   - **结论**：无 daemon-client 限制，R-05 担心不成立，**无需补放行改动**。
4. **Body 契约**：
   - `tar_bytes: Annotated[bytes, Body(media_type="application/x-tar")]`（router.py:125）接收原始 tar 流，与 daemon `_packSpecDir` → `postSpecSync` 的 `application/x-tar` 上送契约一致（design §7.4）。
   - 返回 `SpecSyncResponse(ok, reparsed)`（router.py:52-56 / 136）。

> 若上述任一项核实发现实际限制（文档过时但代码可能也未跟上），则在 `router.py` 端点内补 platform-managed + tar 放行分支；当前核实结论为**零改动**。

### 2. 确认 `apply_sync` 无需改（复用）

对 `service.py:288-398` 的 `apply_sync(workspace_id, tar_bytes) -> int` 逐项确认：

- **whole-tree overwrite**：staging 落盘 → 备份 `.runtime/` → 清空旧 `spec_root` → 移入新树 → 恢复 `.runtime/`（行 312-365），与 D-006@v1 whole-tree overwrite + scan 整树回传语义一致。
- **Tar Slip 防护**（行 315-331）：拒绝绝对路径 `/`、Windows 盘符 `X:`、`resolve()` 逃出 `spec_root` 的成员 —— 对 daemon 上送 tar 安全（untrusted 入口）。
- **`.runtime/` 保留**（行 339-360）：daemon runtime cache 不被覆盖，符合 R-02/§7.2。
- **reparse**（行 376-392）：`ScanDocsService(self._session).reparse(workspace_id)`，将新文档落 ScanDocument 表（G1 后端独占真理源落库）。
- **状态流转**：成功 → `sync_status=clean` + `last_synced_at=now`（行 370-374）；reparse 失败 → `sync_status=dirty` + re-raise（行 381-390），与 SC-4（回传失败不阻塞但标记 dirty）一致。
- **返回值**：`reparsed` 计数，喂给 `SpecSyncResponse.reparsed`。
- **结论**：scan tar 回传整树覆盖 + reparse 已满足，**零改动复用**。spec_workspace.md 标注的 stub 指的是 `sync()`（service.py:183，仍 stub）—— 那是另一条路径（repo 双向同步），与 tar 回传 `apply_sync` 无关。

### 3. 回退路径文档化（D-005@v1）

在 task 报告/实现说明中固化回退路径（无需写代码，文档级）：

- **触发条件**：tar 模式异机部署出问题（回传失败、文件丢失、reparse 异常等）。
- **回退操作**：
  1. 清除 `SPEC_TRANSPORT` 环境变量（或显式设 `SPEC_TRANSPORT=shared`）→ backend `Settings.spec_transport` 回退默认 shared。
  2. 重新 scan（数据可清，D-005@v1 / N4，无需迁移历史 spec）。
  3. shared 模式恢复现有同机 bind mount 行为（D-004@v1）。
- **数据清理范围**（可清）：backend `/data/spec-workspaces/{ws}/` 下旧 spec 树、ScanDocument 表记录、daemon 本地 `~/.sillyhub/daemon/specs/{ws}` 缓存均可清空重来。
- **不实现的内容**：无任何 transport 切换的自动迁移/转换逻辑（D-005@v1 normalized_requirement）。

## 接口定义

### 端点当前签名（router.py:117-136，已核实为最终态）

```python
class SpecSyncResponse(BaseModel):
    """Response DTO for the spec sync endpoint (FR-05)."""
    ok: bool
    reparsed: int

@router.post(
    "/workspaces/{workspace_id}/spec-workspace/sync",   # router prefix 拼接
    response_model=SpecSyncResponse,
)
async def sync_spec_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
    tar_bytes: Annotated[bytes, Body(media_type="application/x-tar")],
) -> SpecSyncResponse:
    """Receive a daemon-uploaded spec tar, overwrite the server spec_root,
    and reparse scan_docs (FR-05 / D-006@v1)."""
    service = SpecWorkspaceService(session)
    reparsed = await service.apply_sync(workspace_id, tar_bytes)
    return SpecSyncResponse(ok=True, reparsed=reparsed)
```

- **鉴权**：`WORKSPACE_WRITE`（用户级，非 daemon-client 限定）。
- **入参**：`workspace_id`（路径）、`tar_bytes`（raw `application/x-tar` body）。
- **出参**：`{ ok: bool, reparsed: int }`。
- **放行改动**：无（R-05 核实通过，端点对所有 strategy 放行）。

### `apply_sync` 签名（service.py:288-398，零改动复用）

```python
async def apply_sync(
    self,
    workspace_id: uuid.UUID,
    tar_bytes: bytes,
) -> int:
    """Overwrite the server spec_root with the uploaded tar, then reparse.
    D-006@v1: whole-tree overwrite, no diff/merge. .runtime/ preserved.
    Returns the reparse parsed count."""
```

- **内部行为**：validate every member → staging extract → `.runtime/` 备份 → 清旧 `spec_root` → 移新树 → 恢复 `.runtime/` → commit(sync_status=clean) → reparse → 失败回 dirty + re-raise。
- **错误码**：`SPEC_BUNDLE_INVALID_CODE = "HTTP_422_SPEC_BUNDLE_INVALID"`（service.py:39），invalid tar / Tar Slip → 422。
- **复用方**：router.sync_spec_workspace（本 task）；daemon `postSpecSync` 经此端点回传（task-04/06）。

## 边界处理

1. **apply_sync 零改动**：service.py:288-398 不动一行，tar 回传整树覆盖 + reparse 已是完整实现。本 task 改 `apply_sync` 视为越界。
2. **端点放行 platform-managed**：核实确认 router.py:117 端点不读 `SpecWorkspace.strategy`，platform-managed/repo-mirrored/repo-native/daemon-client 均放行；若实现中发现隐藏 strategy 过滤则补放行（兜底）。
3. **tar workspace_id 校验**：端点 + apply_sync 内部均以路径 `workspace_id` 为准，`service.get(workspace_id)` 不存在则 `SpecWorkspaceNotFound` → 404，天然校验非法 ws。
4. **回退清 env**：D-005@v1 回退路径 = 清 `SPEC_TRANSPORT`（回 shared 默认）+ 重 scan，数据可清；不实现自动迁移。
5. **sync_status clean/dirty 流转**：apply_sync 成功置 clean + last_synced_at=now（service.py:370-374）；reparse 失败置 dirty + re-raise（service.py:381-390）—— 与 SC-4「回传失败不阻塞 scan 完成但标记 dirty」一致；端点 500 时前端据 sync_status=dirty 提示重试。
6. **Tar Slip 安全边界**：apply_sync 对 daemon 上送 tar 做 untrusted 处理（行 315-331 拒绝绝对路径/盘符/逃逸），即使 daemon 被攻破也不会越权写 spec_root 外文件。
7. **`.runtime/` 保留边界**：whole-tree overwrite 不覆盖 daemon runtime cache（行 339-360），避免 daemon 状态丢失。
8. **stub 误读边界**：spec_workspace.md 称端点 stub 是过时描述（指向 `sync()` 而非 `apply_sync`）；核实以代码 `apply_sync` 完整实现为准，文档不可信。

## 非目标

- **不改 `apply_sync` 逻辑**：whole-tree overwrite / staging swap / `.runtime/` 保留 / reparse 全部维持现状（design §6「确认 无改动复用」）。
- **不碰 `SpecWorkspace` 表结构**：不加 transport 字段（D-001@v1）、不改 sync_status/last_synced_at 语义（design §8）。
- **不实现 transport 切换数据迁移**：D-005@v1 / N4 明确不做。
- **不新增端点**：复用现有 `/spec-workspace/sync`，不新建 `/spec-workspace/sync-tar` 等。
- **不改 daemon-client 既有路径**：task-runner（batch）走 task-05 改调 utility，本 task 不涉及 daemon 侧。
- **不改权限模型**：WORKSPACE_WRITE 维持用户级，不引入 daemon 服务账号专有权限。

## 参考

- **apply_sync 现有 Tar Slip 防护**：`service.py:315-331`（`name.startswith("/")` / 盘符 / `target.relative_to(spec_root_resolved)` ValueError → `_spec_bundle_invalid` 422）。
- **whole-tree overwrite 原子性**：`service.py:333-360`（staging 落盘成功后才清旧树 + 移入；`.runtime/` 备份/恢复）。
- **reparse 容错**：`service.py:376-392`（reparse 异常 → dirty + re-raise，文件已落盘为真理源）。
- **端点契约**：design §7.4 契约表 `apply_sync` 行（backend 本地，入 workspace_id + tar_bytes，出 spec_root 覆盖 + reparse → ScanDocument）。
- **回退路径**：design §9（兼容策略 brownfield：未配置 SPEC_TRANSPORT 默认 shared；回退清 env + 重 scan）。
- **关联 task**：task-04（spec-sync.ts `postSpecSync` 上送方）、task-06（daemon interactive `onSessionEnd` 触发回传）—— 本 task 是它们的 backend 接收侧守门。

## TDD

本 task 以核实为主，无新增功能代码，TDD 侧重**回归守护**（确保复用路径不被后续 task 破坏）：

1. **现有测试不回归**：跑 `backend/tests/modules/spec_workspace/` 下涉及 `apply_sync` / sync 端点的测试（如 `test_router.py` / `test_service.py`），确认 whole-tree overwrite + reparse + Tar Slip 拒绝用例全绿。
2. **端点放行守护测试（若不存在则 task-09 补，本 task 标注需求）**：
   - platform-managed strategy 的 workspace 调 `/spec-workspace/sync` 应 200（非 403/404）。
   - 非法 workspace_id 调端点应 404（SpecWorkspaceNotFound）。
   - Tar Slip payload（含 `../escape` 成员）应 422（SPEC_BUNDLE_INVALID）。
3. **回退路径验证（手动，task-12 端到端覆盖）**：清 `SPEC_TRANSPORT` + 重 scan 后，shared 模式行为不变（SC-1）。

> 注：本 task 无独立新增测试文件——端点放行/apply_sync 行为已由 spec_workspace 模块现有测试覆盖；tar 回传链路的端到端测试落在 task-09（daemon + claim 透传）和 task-12（异机 e2e）。

## 验收

| AC ID | 验收项 | 验证方式 | 覆盖 |
|---|---|---|---|
| AC-07-1 | router.py:117 `/spec-workspace/sync` 端点对 platform-managed strategy 的 workspace 放行（不 403/不 strategy 过滤） | 读代码核实 + spec_workspace 现有端点测试（platform-managed ws 调用应 200） | R-05, FR-07 |
| AC-07-2 | 端点权限为 WORKSPACE_WRITE（用户级），无 daemon-client 限定 | 读代码核实 router.py:124 `require_permission(Permission.WORKSPACE_WRITE)` | R-05 |
| AC-07-3 | 端点 Body 接收 `application/x-tar` raw 流，契约与 daemon postSpecSync 一致 | 读代码核实 router.py:125 + 对照 task-04 `postSpecSync` 实现 | FR-07 |
| AC-07-4 | `service.apply_sync`（service.py:288）**零改动**，whole-tree overwrite + reparse 完整复用 | git diff 确认 service.py 本 task 无改动；现有 apply_sync 测试全绿 | FR-07, D-006@v1 |
| AC-07-5 | apply_sync Tar Slip 防护对 daemon 上送 tar 生效（绝对路径/盘符/逃逸 → 422） | 现有 Tar Slip 测试用例绿（spec_workspace 测试） | FR-07 |
| AC-07-6 | apply_sync 成功置 sync_status=clean + last_synced_at=now；reparse 失败置 dirty + re-raise | 读代码核实 service.py:370-390 + 现有状态流转测试 | SC-4 |
| AC-07-7 | 回退路径文档化：清 SPEC_TRANSPORT → shared + 重 scan，数据可清无迁移逻辑 | task 报告含回退步骤；git diff 确认无迁移代码 | D-005@v1 |
| AC-07-8 | spec_workspace.md 过时文档（称端点 stub）不作为核实依据，以当前代码 apply_sync 完整实现为准 | task 报告注明文档过时、代码为准 | 铁律 |
| AC-07-9 | backend `uv run pytest`（spec_workspace 模块）全绿 | 本地跑测试 | 全局 |
| AC-07-10 | backend `uv run mypy` + `uv run ruff check .` 通过（本 task 零改动则天然满足） | 本地跑 | 全局 |

**核心核实结论（实现前填写）**：
- R-05 **通过**：端点 router.py:117-136 为用户级 WORKSPACE_WRITE 权限、无 strategy 过滤、无 daemon-client 限定 → platform-managed + tar 已天然放行，**无需代码改动**。
- `apply_sync` **零改动复用**：service.py:288-398 已是 whole-tree overwrite + reparse + Tar Slip 完整实现，scan tar 回传直接复用。
- 回退路径 **D-005@v1 落实**：清 SPEC_TRANSPORT + 重 scan，数据可清。
